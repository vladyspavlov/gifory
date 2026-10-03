import { InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { consumeInviteToken, getScope, addUserToScope, setActiveScopeId, getActiveScopeId } from "../scopes.js";
import { getScopeAccess, ScopeVerificationError } from "../access.js";
import { getMainKeyboard } from "../keyboard.js";
import { showCommunity } from "./onScopes.js";
import { isPrivate, screen, homeButton } from "../ui.js";
import { privateNavigation } from "./onHome.js";

export async function onJoinScope(ctx: MyContext): Promise<void> {
  if (!isPrivate(ctx)) { await privateNavigation(ctx); return; }
  const text = ctx.message?.text ?? "";
  const token = text.match(/^\/join(?:@\w+)?\s+(\S+)/i)?.[1] ?? text.match(/^\/start(?:@\w+)?\s+join_(\S+)/i)?.[1];
  if (!token) { await screen(ctx, ctx.t("join_help"), homeButton(ctx).row().text(ctx.t("btn_communities"), "nav:scopes")); return; }
  const scopeId = await consumeInviteToken(token, ctx.from!.id);
  if (!scopeId) {
    await ctx.reply(ctx.t("join_invalid"), { reply_markup: new InlineKeyboard().text(ctx.t("btn_communities"), "nav:scopes").row().text(ctx.t("btn_join_help"), "nav:join") }); return;
  }
  // Joining adds search coverage; it never silently changes an existing save destination.
  if (!(await getActiveScopeId(ctx.from!.id))) { await setActiveScopeId(ctx.from!.id, scopeId); ctx.currentScopeId = scopeId; }
  const scope = await getScope(scopeId);
  await ctx.reply(ctx.t("join_success", { name: scope?.name ?? scopeId }), { reply_markup: getMainKeyboard(ctx.t) });
  await showCommunity(ctx, scopeId);
}

/** Public GIF/about and group opening links reveal no private data and grant no manual membership. */
export async function onDirectJoinScope(ctx: MyContext, scopeId: string): Promise<void> {
  const scope = await getScope(scopeId);
  if (!scope) { await ctx.reply(ctx.t("scope_gone"), { reply_markup: homeButton(ctx) }); return; }
  const status = await getScopeAccess(ctx.api, ctx.from!.id, scope);
  if (status === "unavailable") throw new ScopeVerificationError();
  if (status !== "allowed") { await ctx.reply(ctx.t("join_access_required"), { reply_markup: new InlineKeyboard().text(ctx.t("btn_join_help"), "nav:join").row().text(ctx.t("btn_home"), "nav:home") }); return; }
  if (scope.type === "group") await addUserToScope(ctx.from!.id, scopeId);
  await ctx.reply(ctx.t("btn_open"), { reply_markup: getMainKeyboard(ctx.t) });
  await showCommunity(ctx, scopeId);
}
