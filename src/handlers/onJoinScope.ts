import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { consumeInviteToken, getScope, addUserToScope } from "../scopes.js";
import { getMainKeyboard } from "../keyboard.js";

export async function onJoinScope(ctx: MyContext): Promise<void> {
  const text = ctx.message?.text ?? "";

  // Accepts both /join <token> and /start join_<token> (deep link)
  let token = "";
  const joinMatch = text.match(/^\/join\s+(\S+)/i);
  const startMatch = text.match(/^\/start\s+join_(\S+)/i);

  if (joinMatch) token = joinMatch[1];
  else if (startMatch) token = startMatch[1];

  if (!token) {
    await ctx.reply(ctx.t("join_needs_token"));
    return;
  }

  const userId = ctx.from!.id;
  const scopeId = await consumeInviteToken(token, userId);

  if (!scopeId) {
    await ctx.reply(ctx.t("join_invalid"));
    return;
  }

  const scope = await getScope(scopeId);
  ctx.session.activeScopeId = scopeId;

  const keyboard = new InlineKeyboard()
    .switchInlineCurrent(ctx.t("btn_search_gifs"), "");

  await ctx.reply(
    ctx.t("join_success", { name: scope?.name ?? scopeId }),
    { reply_markup: getMainKeyboard(ctx.t) }
  );
  await ctx.reply(ctx.t("btn_search_gifs"), { reply_markup: keyboard });
}

/** Handles /start scope_<scopeId> — direct permanent join from inline GIF button. */
export async function onDirectJoinScope(ctx: MyContext, scopeId: string): Promise<void> {
  const scope = await getScope(scopeId);
  if (!scope) {
    await ctx.reply(ctx.t("join_invalid"));
    return;
  }
  await addUserToScope(ctx.from!.id, scopeId);
  ctx.session.activeScopeId = scopeId;

  const keyboard = new InlineKeyboard()
    .switchInlineCurrent(ctx.t("btn_search_gifs"), "");

  await ctx.reply(
    ctx.t("join_success", { name: scope.name }),
    { reply_markup: getMainKeyboard(ctx.t) }
  );
  await ctx.reply(ctx.t("btn_search_gifs"), { reply_markup: keyboard });
}
