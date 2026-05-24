import { InputFile } from "grammy";
import { MyContext } from "../session.js";
import { getAllGifs } from "../meili.js";
import { getScope } from "../scopes.js";

export async function onBackup(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply("Оберіть активну спільноту через /scopes.");
    return;
  }

  await ctx.reply("⏳ Створюю бекап...");

  try {
    const docs = await getAllGifs(scopeId);
    const scope = await getScope(scopeId);
    const buffer = Buffer.from(JSON.stringify(docs, null, 2));
    const filename = `backup_${scope?.name ?? scopeId}_${Date.now()}.json`;

    await ctx.replyWithDocument(new InputFile(buffer, filename), {
      caption:
        `📦 Ручний бекап — ${scope?.name ?? scopeId}\n` +
        `🗂 Гіфок у базі: ${docs.length}`,
    });
  } catch (err) {
    console.error("[Backup] Manual backup failed:", err);
    await ctx.reply("❌ Помилка під час створення бекапу.");
  }
}
