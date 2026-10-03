import { NextFunction } from "grammy";
import { MyContext } from "../session.js";
import { canAdminScope } from "../access.js";
import { promptScopeSelect } from "../handlers/onScopes.js";

/**
 * Terminal gate for admin-only handlers. Everything that reaches it has already
 * failed to match a public command, so the rejection message doubles as the
 * bot's catch-all reply — it must tell the user which of three things is wrong.
 */
export async function isAdmin(ctx: MyContext, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  const scopeId = ctx.currentScopeId;

  if (userId && scopeId && (await canAdminScope(ctx.api, userId, scopeId))) {
    await next();
    return;
  }

  // Stray callback query (e.g. a stale keyboard from before a permission change):
  // answer it inline instead of posting a new message into the chat.
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: ctx.t("no_permissions"), show_alert: true });
    return;
  }

  // No active community — the user hasn't chosen one yet, which is not a
  // permission problem. Show the picker (it handles the "no communities" case).
  if (!scopeId) {
    await promptScopeSelect(ctx);
    return;
  }

  // Has a community but isn't an admin there. Only say so when the user was
  // plausibly attempting an admin action; otherwise they typed something the
  // bot simply doesn't understand.
  const attemptedAdminAction =
    !!ctx.message?.animation || (ctx.message?.text?.startsWith("/") ?? false);

  if (attemptedAdminAction) {
    await ctx.reply(ctx.t("no_permissions"));
    return;
  }

  // Unrecognized chatter: worth a nudge in a private chat, pure noise in a group.
  if (ctx.chat?.type === "private") {
    await ctx.reply(ctx.t("unknown_input"));
  }
}
