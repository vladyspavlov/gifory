import { createBot } from "./bot.js";
import { setupMeilisearch } from "./meili.js";
import { startBackupScheduler } from "./backup.js";

async function main(): Promise<void> {
  console.log("[App] Starting Smart GIF Archive v2.0...");

  await setupMeilisearch();

  const bot = createBot();
  startBackupScheduler(bot);

  await bot.start({
    onStart: (info) => {
      console.log(`[Bot] @${info.username} is running (long polling)`);
    },
  });
}

main().catch((err) => {
  console.error("[App] Fatal error:", err);
  process.exit(1);
});