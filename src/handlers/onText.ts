import { InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { clearPendingOperation } from "../session.js";
import { extractTags, extractEmojis, hasInvalidTags, labelsWithinLimit } from "../utils/tags.js";
import { upsertGif, replaceTags, appendTags, getGifInScope } from "../meili.js";
import { broadcastNewGif } from "../broadcast.js";
import { requireScope, pendingAlive, isPrivate } from "../ui.js";
import { savedReceipt } from "./onAnimation.js";
import { finishCreate } from "./onCreateScope.js";
import { finishRename } from "./onRename.js";
import { executeConfirmation } from "./onManagement.js";
import { getScope } from "../scopes.js";
import { redis } from "../redis.js";

export async function onText(ctx: MyContext): Promise<void> {
  if (!ctx.message?.text) return;
  const session = ctx.session;
  const pending = session.state !== "IDLE" || session.pendingIntent || session.confirmation;
  if (!pending) {
    const replyId = ctx.message.reply_to_message?.message_id;
    if (replyId && ctx.chat && await redis.get(`ux:prompt:${ctx.chat.id}:${replyId}`) === String(ctx.from!.id)) {
      await ctx.reply(ctx.t("pending_expired")); return;
    }
    if (isPrivate(ctx)) await ctx.reply(ctx.t(ctx.message.text.startsWith("/") ? "unknown_command" : "unknown_input"), { reply_markup: new InlineKeyboard().text(ctx.t("btn_search"), "nav:search").text(ctx.t("btn_communities"), "nav:scopes") });
    return;
  }
  if (!pendingAlive(ctx) || (session.confirmation && session.confirmation.expiresAt <= Date.now()) || (session.pendingSelectionExpiresAt && session.pendingSelectionExpiresAt <= Date.now())) {
    clearPendingOperation(session); await ctx.reply(ctx.t("pending_expired")); return;
  }
  if (!isPrivate(ctx) && ctx.message.reply_to_message?.message_id !== session.pendingMessageId) return;
  if (session.paused || session.pendingIntent) {
    await ctx.reply(ctx.t("pending_notice"), { reply_markup: new InlineKeyboard().text(ctx.t("btn_resume"), "nav:resume").text(ctx.t("gif_btn_cancel"), "nav:cancel") }); return;
  }
  if (session.confirmation?.awaitingName) {
    const request = session.confirmation;
    const scope = await requireScope(ctx, request.scopeId, true);
    if (!scope) { clearPendingOperation(session); return; }
    if (ctx.message.text !== scope.name) { await ctx.reply(ctx.t("close_name_mismatch")); return; }
    clearPendingOperation(session);
    await executeConfirmation(ctx, request); return;
  }
  if (session.confirmation) { await ctx.reply(ctx.t("gif_choose_action")); return; }
  if (session.state === "WAITING_FOR_NAME") {
    if (session.pendingNameAction === "create") await finishCreate(ctx, ctx.message.text);
    else if (session.pendingScopeId) await finishRename(ctx, session.pendingScopeId, ctx.message.text);
    return;
  }
  const { state, pendingGifUniqueId: uniqueId, pendingFileId: fileId, pendingScopeId: scopeId } = session;
  if (!scopeId) { clearPendingOperation(session); return; }
  if (!(await requireScope(ctx, scopeId, true))) { clearPendingOperation(session); return; }
  if (state === "WAITING_FOR_GIF_ACTION") { await ctx.reply(ctx.t("gif_choose_action")); return; }
  if (state === "WAITING_FOR_UPLOAD" || state === "WAITING_FOR_REPLACEMENT") { await ctx.reply(ctx.t(state === "WAITING_FOR_UPLOAD" ? "upload_prompt" : "replacement_prompt", { name: (await getScope(scopeId))!.name })); return; }
  if (!uniqueId) { clearPendingOperation(session); return; }
  if (hasInvalidTags(ctx.message.text)) { await ctx.reply(ctx.t("gif_tags_invalid", { example: ctx.t("gif_tag_example") })); return; }
  const tags = extractTags(ctx.message.text), emojis = extractEmojis(ctx.message.text);
  if (!tags.length && !emojis.length) { await ctx.reply(ctx.t("gif_tags_required", { example: ctx.t("gif_tag_example") })); return; }
  if (!labelsWithinLimit(tags, emojis)) { await ctx.reply(ctx.t("labels_too_many")); return; }
  let finalTags = tags, finalEmojis = emojis, saved = true, isNew = false;
  if (state === "WAITING_FOR_NEW_TAGS") {
    if (!fileId) { clearPendingOperation(session); return; }
    ({ isNew } = await upsertGif(uniqueId, fileId, tags, emojis, scopeId));
  } else if (state === "WAITING_TO_REPLACE_TAGS") saved = await replaceTags(uniqueId, tags, emojis, scopeId);
  else if (state === "WAITING_TO_APPEND_TAGS") {
    const current = await getGifInScope(uniqueId, scopeId);
    if (current && !labelsWithinLimit([...new Set([...current.tags, ...tags])], [...new Set([...current.emojis, ...emojis])])) { await ctx.reply(ctx.t("labels_too_many")); return; }
    const updated = await appendTags(uniqueId, tags, emojis, scopeId);
    saved = updated !== null;
    if (updated) { finalTags = updated.tags; finalEmojis = updated.emojis; }
  }
  clearPendingOperation(session);
  if (!saved) { await ctx.reply(ctx.t("gif_not_found")); return; }
  await savedReceipt(ctx, scopeId, finalTags, finalEmojis);
  if (isNew && fileId) await broadcastNewGif(ctx.api, ctx.from!.id, fileId, finalTags, finalEmojis, scopeId, uniqueId);
}
