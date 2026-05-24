import { InputFile } from "grammy";
import { MyContext } from "../session.js";
import { getAllGifs } from "../meili.js";
import { getScope } from "../scopes.js";

export async function onBackup(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply(ctx.t("select_scope"));
    return;
  }

  await ctx.reply(ctx.t("backup_creating"));

  try {
    const docs = await getAllGifs(scopeId);
    const scope = await getScope(scopeId);
    const buffer = Buffer.from(JSON.stringify(docs, null, 2));
    const filename = `backup_${scope?.name ?? scopeId}_${Date.now()}.json`;

    await ctx.replyWithDocument(new InputFile(buffer, filename), {
      caption: ctx.t("backup_caption", {
        scopeName: scope?.name ?? scopeId,
        count: docs.length,
      }),
    });
  } catch (err) {
    console.error("[Backup] Manual backup failed:", err);
    await ctx.reply(ctx.t("backup_error"));
  }
}
