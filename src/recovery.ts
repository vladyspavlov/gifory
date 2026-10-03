import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Meilisearch, MeilisearchApiError, type EnqueuedTask } from "meilisearch";
import { redis } from "./redis.js";
import { MEILI_HOST, MEILI_API_KEY, INDEX_NAME } from "./config.js";
import type { FullBackup, RedisBackupEntry } from "./backupData.js";
import type { GifDocument } from "./meili.js";

const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === "string"); }
function validScope(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && typeof value.name === "string" &&
    ["group", "manual"].includes(String(value.type)) && Number.isFinite(value.created_at) &&
    Array.isArray(value.admin_ids) && value.admin_ids.every(id => Number.isSafeInteger(id) && id > 0);
}
function validDocument(value: unknown, scopes: Set<string>): value is GifDocument {
  return record(value) && typeof value.scope_id === "string" && scopes.has(value.scope_id) &&
    typeof value.file_unique_id === "string" && value.id === `${value.scope_id}_${value.file_unique_id}` &&
    typeof value.file_id === "string" && strings(value.tags) && strings(value.emojis) &&
    Number.isFinite(value.created_at) && (value.expired === undefined || typeof value.expired === "boolean");
}
function validEntry(value: unknown): value is RedisBackupEntry {
  return record(value) && typeof value.key === "string" && typeof value.dump === "string" && value.dump.length > 0 &&
    Buffer.from(value.dump, "base64").toString("base64") === value.dump &&
    (value.expiresAt === null || Number.isSafeInteger(value.expiresAt));
}
export function validateFullBackup(value: unknown): asserts value is FullBackup {
  if (!record(value) || value.format !== "gifory-full-backup" || value.schemaVersion !== 1 ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.redisVersion !== "string" || !Array.isArray(value.scopes) || !value.scopes.every(validScope) ||
      !Array.isArray(value.redis) || !value.redis.every(validEntry) || !record(value.meilisearch) ||
      value.meilisearch.index !== INDEX_NAME || !record(value.meilisearch.settings) || !record(value.meilisearch.version) ||
      !Array.isArray(value.meilisearch.documents)) throw new Error("Invalid or unsupported full backup");
  const entries = value.redis;
  const scopes = new Set(value.scopes.map(scope => scope.id as string));
  if (scopes.size !== value.scopes.length || !value.meilisearch.documents.every(doc => validDocument(doc, scopes)) ||
      new Set(value.meilisearch.documents.map(doc => doc.id)).size !== value.meilisearch.documents.length ||
      new Set(value.redis.map(entry => entry.key)).size !== value.redis.length ||
      !value.scopes.every(scope => entries.some(entry => entry.key === `scope:${scope.id}`))) {
    throw new Error("Backup has duplicate records, invalid GIFs, or missing scope state");
  }
}

export async function readFullBackup(path: string): Promise<FullBackup> {
  let data = await readFile(path);
  if (path.endsWith(".manifest.json")) {
    const manifest: unknown = JSON.parse(data.toString("utf8"));
    if (!record(manifest) || manifest.format !== "gifory-backup-parts" || manifest.schemaVersion !== 1 ||
        !Array.isArray(manifest.parts) || !manifest.parts.length || typeof manifest.sha256 !== "string") throw new Error("Invalid backup manifest");
    const parts: Buffer[] = [];
    for (const part of manifest.parts) {
      if (!record(part) || typeof part.name !== "string" || basename(part.name) !== part.name ||
          typeof part.sha256 !== "string" || !Number.isSafeInteger(part.bytes)) throw new Error("Invalid backup part");
      const bytes = await readFile(join(dirname(path), part.name));
      if (bytes.length !== part.bytes || hash(bytes) !== part.sha256) throw new Error(`Backup part failed checksum: ${part.name}`);
      parts.push(bytes);
    }
    data = Buffer.concat(parts);
    if (hash(data) !== manifest.sha256) throw new Error("Combined backup failed checksum");
  }
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data, { maxOutputLength: 1024 * 1024 * 1024 });
  const value: unknown = JSON.parse(data.toString("utf8"));
  validateFullBackup(value);
  return value;
}

/** Recovery is intentionally limited to empty targets; it cannot overwrite a live bot. */
export async function restoreFullBackup(snapshot: FullBackup, apply = false): Promise<void> {
  validateFullBackup(snapshot);
  console.log(`[Restore] Valid full backup: ${snapshot.scopes.length} scopes, ${snapshot.meilisearch.documents.length} GIFs, ${snapshot.redis.length} Redis keys`);
  if (!apply) { console.log("[Restore] Dry run; no connections or writes were requested by recovery"); return; }
  const info = await redis.info("server");
  const version = info.match(/^redis_version:(.+)$/m)?.[1].trim();
  if (version !== snapshot.redisVersion) throw new Error(`Use Redis ${snapshot.redisVersion} to restore its binary key dumps`);
  if (await redis.dbsize() !== 0) throw new Error("Restore refused: Redis target is not empty");
  const client = new Meilisearch({ host: MEILI_HOST, apiKey: MEILI_API_KEY, timeout: 15_000 });
  const currentVersion = await client.getVersion();
  if (currentVersion.pkgVersion !== snapshot.meilisearch.version.pkgVersion) throw new Error(`Use Meilisearch ${snapshot.meilisearch.version.pkgVersion} for recovery, then upgrade separately`);
  const index = client.index<GifDocument>(INDEX_NAME);
  let indexExists = true;
  try { if ((await index.getStats()).numberOfDocuments !== 0) throw new Error("Restore refused: Meilisearch index is not empty"); }
  catch (error) {
    if (!(error instanceof MeilisearchApiError) || error.cause?.code !== "index_not_found") throw error;
    indexExists = false;
  }
  const wait = async (enqueued: EnqueuedTask) => {
    const task = await client.tasks.waitForTask(enqueued, { timeout: 60_000, interval: 100 });
    if (task.status !== "succeeded") throw new Error(`Restore indexing failed: ${task.error?.code ?? task.status}`);
  };
  if (!indexExists) await wait(await client.createIndex(INDEX_NAME, { primaryKey: "id" }));
  await wait(await index.updateSettings(snapshot.meilisearch.settings));
  for (let offset = 0; offset < snapshot.meilisearch.documents.length; offset += 500) {
    await wait(await index.addDocuments(snapshot.meilisearch.documents.slice(offset, offset + 500)));
  }
  // Each RESTORE creates a key, never replaces one. Expired keys are deliberately skipped.
  for (const entry of snapshot.redis) {
    const ttl = entry.expiresAt === null ? 0 : entry.expiresAt - Date.now();
    if (entry.expiresAt !== null && ttl <= 0) continue;
    await redis.restore(entry.key, ttl, Buffer.from(entry.dump, "base64"));
  }
  if ((await index.getStats()).numberOfDocuments !== snapshot.meilisearch.documents.length) throw new Error("Restored document count mismatch");
  console.log("[Restore] Complete; verify scopes, permissions, and inline search before starting polling");
}
