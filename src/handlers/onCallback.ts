import type { MyContext } from "../session.js";
import { clearPendingOperation } from "../session.js";
import { requireScope, pendingAlive, communityBack } from "../ui.js";
import { resumeGifFlow } from "./onAnimation.js";

export async function onGifCallback(ctx: MyContext): Promise<void> {
  const match = ctx.callbackQuery?.data?.match(/^gif:(no_changes|replace_tags|append_tags|cancel):([a-f0-9]{12})$/);
  const session = ctx.session;
  if (!match || match[2] !== session.pendingOperationId || ctx.callbackQuery?.message?.message_id !== session.pendingMessageId || !session.pendingScopeId || !pendingAlive(ctx) || session.paused) {
    await ctx.answerCallbackQuery({ text: ctx.t("operation_stale"), show_alert: true }); return;
  }
  const scope = await requireScope(ctx, session.pendingScopeId, true);
  if (!scope) { clearPendingOperation(session); await ctx.answerCallbackQuery(); return; }
  const action = match[1];
  if (action === "cancel" || action === "no_changes") {
    clearPendingOperation(session);
    await ctx.editMessageText(ctx.t(action === "cancel" ? "operation_cancelled" : "changes_cancelled"), { reply_markup: communityBack(ctx, scope.id) });
  } else if (session.state === "WAITING_FOR_GIF_ACTION") {
    session.state = action === "replace_tags" ? "WAITING_TO_REPLACE_TAGS" : "WAITING_TO_APPEND_TAGS";
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await resumeGifFlow(ctx);
  } else { await ctx.answerCallbackQuery({ text: ctx.t("operation_stale"), show_alert: true }); return; }
  await ctx.answerCallbackQuery();
}
