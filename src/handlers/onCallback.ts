import { InlineKeyboard } from "grammy";
import { MyContext, clearPendingOperation } from "../session.js";
import { canAdminScope } from "../access.js";

export async function onGifCallback(ctx: MyContext): Promise<void> {
  const match = ctx.callbackQuery?.data?.match(/^gif:(no_changes|replace_tags|append_tags|cancel):([a-f0-9]{12})$/);
  const session = ctx.session;
  if (!match || match[2] !== session.pendingOperationId ||
      ctx.callbackQuery?.message?.message_id !== session.pendingMessageId || !session.pendingScopeId) {
    await ctx.answerCallbackQuery({ text: ctx.t("operation_stale"), show_alert: true });
    return;
  }
  if (!(await canAdminScope(ctx.api, ctx.from!.id, session.pendingScopeId))) {
    clearPendingOperation(session);
    await ctx.answerCallbackQuery({ text: ctx.t("no_permissions"), show_alert: true });
    return;
  }
  const action = match[1];
  if (action === "cancel" || action === "no_changes") {
    clearPendingOperation(session);
    await ctx.editMessageText(ctx.t(action === "cancel" ? "operation_cancelled" : "changes_cancelled"));
  } else if (session.state === "WAITING_FOR_GIF_ACTION") {
    session.state = action === "replace_tags" ? "WAITING_TO_REPLACE_TAGS" : "WAITING_TO_APPEND_TAGS";
    const kb = new InlineKeyboard().text(ctx.t("gif_btn_cancel"), `gif:cancel:${match[2]}`);
    await ctx.editMessageText(ctx.t(action === "replace_tags" ? "enter_new_tags" : "enter_append_tags"), { reply_markup: kb });
  } else {
    await ctx.answerCallbackQuery({ text: ctx.t("operation_stale"), show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
}
