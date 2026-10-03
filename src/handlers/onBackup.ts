import { GrammyError, InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { captureScopeBackup } from "../backupData.js";
import { sendBackup } from "../backup.js";
import { promptScopeSelect } from "./onScopes.js";
import { requireScope } from "../ui.js";

export async function onBackup(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) { await promptScopeSelect(ctx, "backup"); return; }
  const scope = await requireScope(ctx, scopeId, true);
  if (!scope) return;
  await ctx.reply(ctx.t("backup_description", { name: scope.name }));
  await ctx.reply(ctx.t("backup_creating"));
  try {
    const snapshot = await captureScopeBackup(scopeId);
    if (!(await requireScope(ctx, scopeId, true))) return;
    await sendBackup({ api: ctx.api }, ctx.from!.id, snapshot, `backup_${scopeId}_${Date.now()}`, ctx.t("backup_caption", { scopeName: snapshot.scope.name, count: snapshot.meilisearch.documents.length }));
    await ctx.reply(ctx.t("backup_sent_private"), { reply_markup: new InlineKeyboard().text(ctx.t("btn_manage"), `nav:manage:${scopeId}`) });
  } catch (error) {
    if (error instanceof GrammyError && [400, 403].includes(error.error_code) && /chat not found|blocked|initiate|deactivated|forbidden/i.test(error.description)) {
      await ctx.reply(ctx.t("backup_open_private"), { reply_markup: new InlineKeyboard().url(ctx.t("btn_open"), `https://t.me/${ctx.me.username}?start=backup_${scopeId}`) }); return;
    }
    console.error("[Backup] Manual backup failed:", error);
    await ctx.reply(ctx.t("backup_error"), { reply_markup: new InlineKeyboard().text(ctx.t("btn_retry"), `nav:backup:${scopeId}`) });
  }
}
