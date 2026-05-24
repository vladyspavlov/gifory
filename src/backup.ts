import cron from "node-cron";
import { Bot, InputFile } from "grammy";
import { getAllGifs } from "./meili.js";
import { ADMIN_USER_ID } from "./config.js";
import { MyContext } from "./session.js";

export function startBackupScheduler(bot: Bot<MyContext>): void {
  cron.schedule("0 3 * * 0", async () => {
    console.log("[Backup] Starting weekly backup...");
    try {
      const docs = await getAllGifs();
      const date = new Date().toISOString().split("T")[0].replace(/-/g, "_");
      const filename = `backup_${date}.json`;
      const buffer = Buffer.from(JSON.stringify(docs, null, 2), "utf-8");

      await bot.api.sendDocument(
        ADMIN_USER_ID,
        new InputFile(buffer, filename),
        { caption: `📦 Щотижневий бекап\n🗂 Гіфок у базі: ${docs.length}` }
      );
      console.log(`[Backup] Done. Sent ${docs.length} records as ${filename}`);
    } catch (err) {
      console.error("[Backup] Failed:", err);
    }
  });

  console.log("[Backup] Scheduler started (every Sunday at 03:00)");
}