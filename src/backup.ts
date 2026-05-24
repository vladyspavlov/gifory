import cron from "node-cron";
import { Bot, InputFile } from "grammy";
import { getAllGifs } from "./meili.js";
import { getAllScopes } from "./scopes.js";
import { MyContext } from "./session.js";

export function startBackupScheduler(bot: Bot<MyContext>): void {
  cron.schedule("0 3 * * 0", async () => {
    console.log("[Backup] Starting weekly backup for all scopes...");
    const scopes = await getAllScopes();

    for (const scope of scopes) {
      try {
        const docs = await getAllGifs(scope.id);
        if (docs.length === 0) continue;

        const date = new Date().toISOString().split("T")[0].replace(/-/g, "_");
        const filename = `backup_${scope.id}_${date}.json`;
        const buffer = Buffer.from(JSON.stringify(docs, null, 2), "utf-8");
        const recipient = scope.admin_ids[0];
        if (!recipient) continue;

        await bot.api.sendDocument(
          recipient,
          new InputFile(buffer, filename),
          {
            caption:
              `📦 Щотижневий бекап — ${scope.name}\n` +
              `🗂 Гіфок у базі: ${docs.length}`,
          }
        );
        console.log(`[Backup] Scope "${scope.name}": ${docs.length} records → user ${recipient}`);
      } catch (err) {
        console.error(`[Backup] Failed for scope "${scope.id}":`, err);
      }
    }
  });

  console.log("[Backup] Scheduler started (every Sunday at 03:00)");
}
