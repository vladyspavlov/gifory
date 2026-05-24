import { InputFile } from "grammy";
import { MyContext } from "../session.js";
import { getAllGifs } from "../meili.js";

export async function onBackup(ctx: MyContext): Promise<void> {
  await ctx.reply("⏳ Створюю бекап...");

  try {
    const docs = await getAllGifs();
    const buffer = Buffer.from(JSON.stringify(docs, null, 2));
    const filename = `backup_${Date.now()}.json`;

    await ctx.replyWithDocument(new InputFile(buffer, filename), {
      caption: `📦 Ручний бекап\n🗂 Гіфок у базі: ${docs.length}`,
    });
  } catch (err) {
    console.error("[Backup] Manual backup failed:", err);
    await ctx.reply("❌ Помилка під час створення бекапу.");
  }
}