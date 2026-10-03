import type { MyContext } from "../session.js";
import { clearPendingOperation } from "../session.js";
import { renameScope } from "../scopes.js";
import { commandArgument, requireScope, inputPrompt, token } from "../ui.js";
import { promptScopeSelect, showCommunity } from "./onScopes.js";
import { blockNewOperation } from "./onManagement.js";

export async function onRename(ctx: MyContext): Promise<void> {
  if (await blockNewOperation(ctx)) return;
  const scopeId = ctx.currentScopeId;
  if (!scopeId) { await promptScopeSelect(ctx, "rename"); return; }
  const scope = await requireScope(ctx, scopeId, true);
  if (!scope) return;
  if (scope.type === "group") { await ctx.reply(ctx.t("group_roles")); return; }
  const name = ctx.callbackQuery ? "" : commandArgument(ctx);
  if (name) { await finishRename(ctx, scopeId, name); return; }
  clearPendingOperation(ctx.session);
  ctx.session.state = "WAITING_FOR_NAME";
  ctx.session.pendingNameAction = "rename";
  ctx.session.pendingScopeId = scopeId;
  ctx.session.pendingOperationId = token();
  await inputPrompt(ctx, ctx.t("rename_prompt", { name: scope.name, max: 64 }));
}
export async function finishRename(ctx: MyContext, scopeId: string, name: string): Promise<void> {
  name = name.trim();
  if (Array.from(name).length > 64) { await ctx.reply(ctx.t("scope_name_too_long", { max: 64 })); return; }
  if (!name.replace(/[\p{C}\p{Z}]/gu, "") || /[\p{C}]/u.test(name.replaceAll("\u200d", "").replaceAll("\u200c", ""))) { await ctx.reply(ctx.t("scope_name_invalid")); return; }
  const scope = await requireScope(ctx, scopeId, true);
  if (!scope) return;
  if (scope.type !== "manual") { await ctx.reply(ctx.t("group_roles")); return; }
  if (!(await renameScope(scopeId, name, ctx.from!.id))) { await ctx.reply(ctx.t("scope_gone")); return; }
  clearPendingOperation(ctx.session);
  await ctx.reply(ctx.t("rename_success", { name }));
  await showCommunity(ctx, scopeId);
}
