import { createBot } from "./bot.js";
import { setupMeilisearch } from "./meili.js";
import { startBackupScheduler } from "./backup.js";
import { registerCommands } from "./commands.js";
import { redis } from "./redis.js";
import { trimUsage } from "./analytics.js";
import { writeFile, rm } from "node:fs/promises";

export async function runBot(bot = createBot()): Promise<void> {
  console.log("[App] Starting Gifory...");
  let scheduler: ReturnType<typeof startBackupScheduler> | undefined;
  let stopping = false;
  let shutdown: Promise<void> | undefined;
  let polling: Promise<void> | undefined;
  const stop = () => {
    if (shutdown) return shutdown;
    stopping = true;
    shutdown = (async () => {
      console.log("[App] Shutting down...");
      await rm("/tmp/gifory-ready", { force: true });
      // Cap shutdown so a stalled network/backup cannot keep the container alive indefinitely.
      const deadline = setTimeout(() => process.exit(1), 55_000);
      deadline.unref();
      try {
        if (bot.isRunning()) await bot.stop();
        // stop() confirms the offset but does not wait for the running middleware.
        await polling?.catch(() => {});
        await scheduler?.stop();
        if (redis.status !== "end") {
          const ended = new Promise<void>(resolve => redis.once("end", resolve));
          if (redis.status === "wait") redis.disconnect();
          else await redis.quit();
          await ended;
        }
      } finally { clearTimeout(deadline); }
    })();
    return shutdown;
  };
  const onSignal = () => { void stop().catch(error => { console.error("[App] Shutdown failed:", error); process.exitCode = 1; }); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await rm("/tmp/gifory-ready", { force: true });
    await setupMeilisearch();
    if (stopping) return;
    await trimUsage();
    await registerCommands(bot);
    if (stopping) return;
    scheduler = startBackupScheduler(bot);
    polling = bot.start({
      allowed_updates: ["message", "callback_query", "inline_query", "chosen_inline_result", "my_chat_member", "chat_member"],
      onStart: async info => {
        if (stopping) return;
        await writeFile("/tmp/gifory-ready", String(process.pid));
        if (stopping) { await rm("/tmp/gifory-ready", { force: true }); return; }
        console.log(`[Bot] @${info.username} is running (long polling)`);
      },
    });
    await polling;
  } finally {
    await stop();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
