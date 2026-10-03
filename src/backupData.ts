import { redis } from "./redis.js";
import { getAllScopes, getScope, type Scope } from "./scopes.js";
import { getAllGifs, getSearchBackupMetadata, type GifDocument } from "./meili.js";
import { withStateLock } from "./state.js";
import { INDEX_NAME } from "./config.js";

export interface RedisBackupEntry {
  key: string;
  dump: string;
  expiresAt: number | null;
}
export interface FullBackup {
  format: "gifory-full-backup";
  schemaVersion: 1;
  createdAt: string;
  redisVersion: string;
  redis: RedisBackupEntry[];
  scopes: Scope[];
  meilisearch: {
    index: string;
    settings: Awaited<ReturnType<typeof getSearchBackupMetadata>>["settings"];
    version: Awaited<ReturnType<typeof getSearchBackupMetadata>>["version"];
    documents: GifDocument[];
  };
}

/** DUMP and expiry are read together. Absolute expiry prevents resurrecting old invites. */
async function redisSnapshot(): Promise<RedisBackupEntry[]> {
  const entries = new Map<string, RedisBackupEntry>();
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "COUNT", 100);
    cursor = next;
    for (const key of keys) {
      const result = await redis.callBuffer("EVAL", `
        local dump = redis.call('DUMP', KEYS[1])
        if not dump then return false end
        local ttl = redis.call('PTTL', KEYS[1])
        local now = redis.call('TIME')
        local expiry = ttl >= 0 and (tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000) + ttl) or -1
        return {dump, string.format('%.0f', expiry)}
      `, 1, key) as [Buffer, Buffer] | null;
      if (result) entries.set(key, { key, dump: result[0].toString("base64"),
        expiresAt: Number(result[1].toString()) < 0 ? null : Number(result[1].toString()) });
    }
  } while (cursor !== "0");
  return [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The lock excludes bot writes while both stores are read; uploads happen afterward. */
export async function captureFullBackup(): Promise<FullBackup> {
  return withStateLock(async () => {
    const scopes = (await getAllScopes()).sort((a, b) => a.id.localeCompare(b.id));
    const documents: GifDocument[] = [];
    for (const scope of scopes) documents.push(...await getAllGifs(scope.id));
    // Detect orphaned documents rather than silently making an incomplete backup.
    const metadata = await getSearchBackupMetadata();
    if (metadata.documentCount !== documents.length) throw new Error("Backup refused: index contains documents outside known scopes");
    const info = await redis.info("server");
    return {
      format: "gifory-full-backup", schemaVersion: 1, createdAt: new Date().toISOString(),
      redisVersion: info.match(/^redis_version:(.+)$/m)?.[1].trim() ?? "unknown",
      scopes, redis: await redisSnapshot(),
      meilisearch: { index: INDEX_NAME, ...metadata, documents },
    };
  });
}

export function scopeBackup(snapshot: FullBackup, scope: Scope) {
  const memberEntry = snapshot.redis.find(entry => entry.key === `scope_members:${scope.id}`);
  const scopeEntries = snapshot.redis.filter(entry =>
    entry.key === `scope:${scope.id}` || entry.key === memberEntry?.key ||
    entry.key === `stats:total:${scope.id}` || entry.key.startsWith(`stats:week:${scope.id}:`));
  return {
    format: "gifory-scope-backup", schemaVersion: 1, createdAt: snapshot.createdAt,
    scope, redisVersion: snapshot.redisVersion, redis: scopeEntries,
    meilisearch: { index: snapshot.meilisearch.index, settings: snapshot.meilisearch.settings,
      version: snapshot.meilisearch.version,
      documents: snapshot.meilisearch.documents.filter(doc => doc.scope_id === scope.id) },
  };
}

/** Called from /backup while the update middleware already owns the state lock. */
export async function captureScopeBackup(scopeId: string) {
  const scope = await getScope(scopeId);
  if (!scope) throw new Error("Backup scope does not exist");
  const metadata = await getSearchBackupMetadata();
  const info = await redis.info("server");
  const snapshot: FullBackup = {
    format: "gifory-full-backup", schemaVersion: 1, createdAt: new Date().toISOString(),
    redisVersion: info.match(/^redis_version:(.+)$/m)?.[1].trim() ?? "unknown",
    scopes: [scope], redis: await redisSnapshot(),
    meilisearch: { index: INDEX_NAME, ...metadata, documents: await getAllGifs(scopeId) },
  };
  return scopeBackup(snapshot, scope);
}
