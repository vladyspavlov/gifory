import cron from "node-cron";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Bot, InputFile, GrammyError, HttpError } from "grammy";
import { MyContext } from "./session.js";
import { getUserLang, t } from "./i18n/index.js";
import { canAdminScope } from "./access.js";
import { captureFullBackup, scopeBackup, type FullBackup } from "./backupData.js";
import { SUPER_ADMIN_ID } from "./config.js";
import { trimUsage } from "./analytics.js";
import { withStateLock } from "./state.js";

// Keep each upload below Telegram's standard Bot API limit, including overhead.
export const BACKUP_PART_BYTES = 40 * 1024 * 1024;
async function uploadDocument(
  bot: Pick<Bot<MyContext>, "api">, recipient: number, file: InputFile, caption?: string
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await bot.api.sendDocument(recipient, file, caption ? { caption } : {}); return; }
    catch (error) {
      const transient = error instanceof HttpError || (error instanceof GrammyError &&
        (error.error_code === 429 || error.error_code >= 500));
      if (!transient || attempt >= 2) throw error;
      const delay = error instanceof GrammyError && error.parameters.retry_after
        ? error.parameters.retry_after * 1000 : 1000 * (attempt + 1);
      if (delay > 30_000) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export async function sendBackup(
  bot: Pick<Bot<MyContext>, "api">, recipient: number, payload: unknown, filename: string, caption: string, partBytes = BACKUP_PART_BYTES
): Promise<void> {
  if (!Number.isSafeInteger(partBytes) || partBytes <= 0 || partBytes > BACKUP_PART_BYTES) throw new Error("Invalid backup part size");
  const json = Buffer.from(JSON.stringify(payload, null, 2));
  if (json.length <= partBytes) {
    await uploadDocument(bot, recipient, new InputFile(json, `${filename}.json`), caption);
    return;
  }
  const compressed = gzipSync(json);
  if (compressed.length <= partBytes) {
    await uploadDocument(bot, recipient, new InputFile(compressed, `${filename}.json.gz`), caption);
    return;
  }
  const parts = [];
  for (let offset = 0, number = 1; offset < compressed.length; offset += partBytes, number++) {
    const data = compressed.subarray(offset, offset + partBytes);
    const name = `${filename}.json.gz.part${String(number).padStart(3, "0")}`;
    parts.push({ name, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
    await uploadDocument(bot, recipient, new InputFile(data, name));
  }
  // A manifest is sent only after every part succeeds; it marks a complete set.
  const manifest = { format: "gifory-backup-parts", schemaVersion: 1, filename: `${filename}.json.gz`,
    sha256: createHash("sha256").update(compressed).digest("hex"), parts };
  await uploadDocument(bot, recipient, new InputFile(Buffer.from(JSON.stringify(manifest, null, 2)), `${filename}.manifest.json`), caption);
}

export async function deliverWeeklyBackup(bot: Bot<MyContext>, snapshot: FullBackup): Promise<void> {
  const date = snapshot.createdAt.replaceAll(/[:.]/g, "_");
  if (SUPER_ADMIN_ID) {
    const lang = await getUserLang(SUPER_ADMIN_ID);
    // Full tenant/user data is sent exclusively to the configured bot owner.
    try {
      await sendBackup(bot, SUPER_ADMIN_ID, snapshot, `gifory_full_${date}`, t(lang, "backup_full_caption"));
      console.log("[Backup] Full recovery archive delivered to the configured owner");
    } catch (error) {
      console.error("[Backup] Full recovery delivery failed:", error);
    }
  } else {
    console.error("[Backup] Full recovery delivery requires SUPER_ADMIN_ID; scope backups do not cover all bot state");
  }
  for (const scope of snapshot.scopes) {
    const payload = scopeBackup(snapshot, scope);
    let delivered = false;
    for (const recipient of scope.admin_ids) {
      try {
        // Check again immediately before delivering: permissions may have changed since capture.
        if (!(await withStateLock(() => canAdminScope(bot.api, recipient, scope.id)))) continue;
        const lang = await getUserLang(recipient);
        await sendBackup(bot, recipient, payload, `backup_${scope.id}_${date}`,
          t(lang, "backup_weekly_caption", { scopeName: scope.name.slice(0, 64), count: payload.meilisearch.documents.length }));
        delivered = true;
        break; // One reachable current admin receives the scope archive.
      } catch (error) {
        console.error(`[Backup] Delivery failed for scope ${scope.id}; trying another admin:`, error);
      }
    }
    if (!delivered) console.error(`[Backup] No reachable authorized recipient for scope ${scope.id}`);
  }
}

export function startBackupScheduler(bot: Bot<MyContext>): { stop: () => Promise<void> } {
  let active: Promise<void> | undefined;
  const task = cron.schedule("0 3 * * 0", async () => {
    active = (async () => {
      await withStateLock(trimUsage);
      const snapshot = await captureFullBackup();
      await deliverWeeklyBackup(bot, snapshot);
    })();
    try { await active; }
    catch (error) { console.error("[Backup] Weekly backup failed:", error); }
    finally { active = undefined; }
  }, { timezone: "Europe/Kyiv", noOverlap: true });
  console.log("[Backup] Scheduler started (Sunday 03:00 Europe/Kyiv)");
  return { stop: async () => {
    await task.stop();
    await active?.catch(() => {});
    await task.destroy();
  } };
}
