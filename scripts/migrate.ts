/**
 * Migration: single-tenant → multi-tenant scopes
 *
 * Transforms all existing GIFs (id = file_unique_id, no scope_id)
 * into the new format (id = `${scopeId}_${file_unique_id}`, scope_id = scopeId)
 * and creates the corresponding legacy scope in Redis.
 *
 * Run inside Docker:
 *   docker compose run --rm bot node dist/scripts/migrate.js
 *
 * Optional env overrides:
 *   LEGACY_SCOPE_ID   — scope id to assign (default: "legacy")
 *   LEGACY_SCOPE_NAME — display name        (default: "Legacy Archive")
 *   ADMIN_IDS         — comma-separated user IDs for the legacy scope
 *   DRY_RUN=1         — print what would happen without writing anything
 */

import "dotenv/config";
import { Meilisearch } from "meilisearch";
import { Redis } from "ioredis";

// ── Config ────────────────────────────────────────────────────────────────────

const MEILI_HOST = process.env.MEILI_HOST      ?? "http://meilisearch:7700";
const MEILI_KEY  = process.env.MEILI_MASTER_KEY ?? process.env.MEILI_API_KEY ?? "";
const REDIS_HOST = process.env.REDIS_HOST       ?? "redis";
const INDEX_NAME = "gifs";

const SCOPE_ID   = process.env.LEGACY_SCOPE_ID   ?? "legacy";
const SCOPE_NAME = process.env.LEGACY_SCOPE_NAME ?? "Legacy Archive";
const ADMIN_IDS  = (process.env.ADMIN_IDS ?? "")
  .split(",").map((s: string) => Number(s.trim())).filter((n: number) => !isNaN(n) && n > 0);
const DRY_RUN    = process.env.DRY_RUN === "1";

const BATCH_SIZE = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

interface OldDoc {
  id: string;
  file_id: string;
  tags: string[];
  emojis: string[];
  created_at: number;
  scope_id?: string; // present if partially migrated already
}

interface NewDoc {
  id: string;
  file_unique_id: string;
  file_id: string;
  scope_id: string;
  tags: string[];
  emojis: string[];
  created_at: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[migrate] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (DRY_RUN) log("DRY RUN — no writes will be performed.");

  const meili = new Meilisearch({ host: MEILI_HOST, apiKey: MEILI_KEY });
  const redis = new Redis({ host: REDIS_HOST, port: 6379 });

  redis.on("error", (err: Error) => console.error("[Redis]", err));

  // ── Step 1: Update index settings ─────────────────────────────────────────
  log("Updating Meilisearch index settings...");
  const index = meili.index<OldDoc>(INDEX_NAME);

  if (!DRY_RUN) {
    await index.updateFilterableAttributes(["tags", "scope_id"]);
    await index.updateFaceting({ maxValuesPerFacet: 1000 });
    // Give Meilisearch a moment to apply settings before we write documents
    await sleep(2000);
  }
  log("Index settings updated.");

  // ── Step 2: Fetch all old-format docs ─────────────────────────────────────
  log("Fetching existing documents...");
  const allOldDocs: OldDoc[] = [];
  let offset = 0;

  while (true) {
    const page = await index.getDocuments<OldDoc>({ limit: BATCH_SIZE, offset });
    allOldDocs.push(...page.results);
    if (page.results.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  log(`Found ${allOldDocs.length} total documents.`);

  const oldFormatDocs = allOldDocs.filter((d) => !d.scope_id);
  const alreadyMigrated = allOldDocs.length - oldFormatDocs.length;

  if (alreadyMigrated > 0) {
    log(`${alreadyMigrated} documents already have scope_id — skipping.`);
  }
  if (oldFormatDocs.length === 0) {
    log("Nothing to migrate. Exiting.");
    await redis.quit();
    return;
  }

  log(`Migrating ${oldFormatDocs.length} documents → scope "${SCOPE_ID}" (${SCOPE_NAME})`);
  if (ADMIN_IDS.length > 0) log(`Admin IDs: ${ADMIN_IDS.join(", ")}`);

  // ── Step 3: Create legacy scope in Redis ──────────────────────────────────
  if (!DRY_RUN) {
    await redis.set(`scope:${SCOPE_ID}`, JSON.stringify({
      id: SCOPE_ID,
      name: SCOPE_NAME,
      type: "manual",
      admin_ids: ADMIN_IDS,
      created_at: Date.now(),
    }));
    for (const adminId of ADMIN_IDS) {
      await redis.sadd(`user_scopes:${adminId}`, SCOPE_ID);
      await redis.sadd(`scope_members:${SCOPE_ID}`, String(adminId));
    }
    log(`Scope "${SCOPE_NAME}" created in Redis.`);
  } else {
    log(`[dry] Would create scope "${SCOPE_NAME}" with admins: ${ADMIN_IDS.join(", ")}`);
  }

  // ── Step 4: Index new-format docs ─────────────────────────────────────────
  const newDocs: NewDoc[] = oldFormatDocs.map((doc) => ({
    id: `${SCOPE_ID}_${doc.id}`,
    file_unique_id: doc.id,
    file_id: doc.file_id,
    scope_id: SCOPE_ID,
    tags: doc.tags ?? [],
    emojis: doc.emojis ?? [],
    created_at: doc.created_at ?? Date.now(),
  }));

  let indexed = 0;
  for (let i = 0; i < newDocs.length; i += BATCH_SIZE) {
    const batch = newDocs.slice(i, i + BATCH_SIZE);
    if (!DRY_RUN) {
      await index.addDocuments(batch);
    }
    indexed += batch.length;
    log(`Submitted new docs ${indexed}/${newDocs.length}`);
  }

  // Wait for Meilisearch to index new docs before deleting old ones.
  // New and old doc IDs are disjoint, but we want the index settled first.
  if (!DRY_RUN) {
    log("Waiting 5s for indexing to settle...");
    await sleep(5000);
  }

  // ── Step 5: Delete old-format docs ────────────────────────────────────────
  const oldIds = oldFormatDocs.map((d) => d.id);

  for (let i = 0; i < oldIds.length; i += BATCH_SIZE) {
    const batch = oldIds.slice(i, i + BATCH_SIZE);
    if (!DRY_RUN) {
      await index.deleteDocuments(batch);
    }
    log(`Submitted deletion ${i + 1}–${Math.min(i + BATCH_SIZE, oldIds.length)}/${oldIds.length}`);
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  log("─".repeat(60));
  log(`Migration complete${DRY_RUN ? " (dry run)" : ""}:`);
  log(`  Documents migrated : ${oldFormatDocs.length}`);
  log(`  Scope created      : "${SCOPE_NAME}" (id: ${SCOPE_ID})`);
  log(`  Admins             : ${ADMIN_IDS.length > 0 ? ADMIN_IDS.join(", ") : "(none)"}`);
  if (!DRY_RUN) log("  Meilisearch tasks are processing asynchronously (takes a few seconds).");
  log("─".repeat(60));

  await redis.quit();
}

main().catch((err: Error) => {
  console.error("[migrate] Fatal error:", err);
  process.exit(1);
});
