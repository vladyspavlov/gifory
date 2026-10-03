import { MyContext } from "../session.js";
import { captureScopeBackup } from "../backupData.js";
import { sendBackup } from "../backup.js";
import { promptScopeSelect } from "./onScopes.js";
import { canAdminScope } from "../access.js";

export async function onBackup(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) { await promptScopeSelect(ctx); return; }
  await ctx.reply(ctx.t("backup_creating"));
  try {
    const snapshot = await captureScopeBackup(scopeId);
    if (!(await canAdminScope(ctx.api, ctx.from!.id, scopeId))) { await ctx.reply(ctx.t("no_permissions")); return; }
    // Backup membership and usage state is delivered privately to its requesting admin.
    await sendBackup({ api: ctx.api }, ctx.from!.id, snapshot, `backup_${scopeId}_${Date.now()}`,
      ctx.t("backup_caption", { scopeName: snapshot.scope.name.slice(0, 64), count: snapshot.meilisearch.documents.length }));
    await ctx.reply(ctx.t("backup_sent_private"));
  } catch (error) {
    console.error("[Backup] Manual backup failed:", error);
    await ctx.reply(ctx.t("backup_error"));
  }
}
