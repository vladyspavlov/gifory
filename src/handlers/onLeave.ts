import type { MyContext } from "../session.js";
import { onScopes } from "./onScopes.js";
import { askConfirmation, blockNewOperation } from "./onManagement.js";
import { isPrivate } from "../ui.js";
import { privateNavigation } from "./onHome.js";
export async function onLeave(ctx: MyContext): Promise<void> {
  if (!isPrivate(ctx)) { await privateNavigation(ctx); return; }
  if (await blockNewOperation(ctx)) return;
  if (ctx.currentScopeId) await askConfirmation(ctx, { action: "leave", scopeId: ctx.currentScopeId });
  else await onScopes(ctx);
}
export async function onLeaveCallback(ctx: MyContext): Promise<void> {
  const scopeId = ctx.callbackQuery?.data?.match(/^leave:ask:([^:]+)$/)?.[1];
  if (!isPrivate(ctx)) { await privateNavigation(ctx); await ctx.answerCallbackQuery(); return; }
  if (!scopeId) { await ctx.answerCallbackQuery({ text: ctx.t("operation_stale"), show_alert: true }); return; }
  if (!(await blockNewOperation(ctx))) await askConfirmation(ctx, { action: "leave", scopeId });
  await ctx.answerCallbackQuery();
}
