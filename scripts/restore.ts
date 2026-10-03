/** Explicit recovery for empty replacement databases. Never run against production stores. */
import { readFullBackup, restoreFullBackup } from "../src/recovery.js";
import { redis } from "../src/redis.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find(arg => !arg.startsWith("--"));
  if (!file || args.some(arg => arg.startsWith("--") && arg !== "--apply")) {
    throw new Error("Usage: npm run restore -- <full-backup.json|.json.gz|.manifest.json> [--apply]");
  }
  try {
    const snapshot = await readFullBackup(file);
    await restoreFullBackup(snapshot, args.includes("--apply"));
  } finally { redis.disconnect(); }
}
main().catch(error => { console.error("[Restore] Failed:", error); process.exitCode = 1; redis.disconnect(); });
