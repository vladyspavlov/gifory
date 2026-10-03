import { InlineKeyboard, GrammyError } from "grammy";
import type { MyContext } from "../session.js";
import { clearPendingOperation } from "../session.js";
import { extractTags, extractEmojis, hasInvalidTags, labelsWithinLimit } from "../utils/tags.js";
import { upsertGif, replaceGif, getGifInScope, refreshGifFileId, getTagFacets } from "../meili.js";
import { broadcastNewGif } from "../broadcast.js";
import { promptScopeSelect } from "./onScopes.js";
import { requireScope, scopeName, isPrivate, token, FLOW_TTL, inputPrompt, pendingAlive, searchButtons, scopeQuery } from "../ui.js";
import { canAdminScope } from "../access.js";

export async function savedReceipt(ctx: MyContext, scopeId: string, tags: string[], emojis: string[]): Promise<void> {
  await ctx.reply(ctx.t("gif_saved", { name: await scopeName(scopeId), tags: tags.join(" ") || "—", emojis: emojis.join(" ") || "—" }), {
    reply_markup: searchButtons(ctx, scopeQuery(scopeId), ctx.t("btn_search_scope")).row().text(ctx.t("btn_add_another"), `nav:add:${scopeId}`).row().text(ctx.t("btn_open"), `nav:open:${scopeId}`),
  });
}

export async function startUpload(ctx: MyContext, scopeId: string): Promise<void> {
  if (!(await requireScope(ctx, scopeId, true))) return;
  if (ctx.session.pendingFileId && ctx.session.pendingGifUniqueId && ctx.session.pendingScopeId === undefined) {
    ctx.session.pendingScopeId = scopeId;
    await saveIncomingGif(ctx, scopeId, ctx.session.pendingGifUniqueId, ctx.session.pendingFileId, ctx.session.pendingCaption);
    return;
  }
  clearPendingOperation(ctx.session);
  ctx.session.state = "WAITING_FOR_UPLOAD";
  ctx.session.pendingScopeId = scopeId;
  ctx.session.pendingOperationId = token();
  await inputPrompt(ctx, ctx.t("upload_prompt", { name: await scopeName(scopeId) }));
}

export async function onAdd(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) { await promptScopeSelect(ctx, "add"); return; }
  if (!(await requireScope(ctx, scopeId, true))) return;
  const animation = ctx.message?.reply_to_message?.animation;
  if (animation) { await saveIncomingGif(ctx, scopeId, animation.file_unique_id, animation.file_id, ctx.message?.reply_to_message?.caption); return; }
  await startUpload(ctx, scopeId);
}

export async function onAnimation(ctx: MyContext): Promise<void> {
  const msg = ctx.message;
  if (!msg?.animation || (msg.via_bot && msg.via_bot.id === ctx.me.id)) return;
  const session = ctx.session;
  if (session.state !== "IDLE" || session.pendingIntent || session.confirmation) {
    if (!pendingAlive(ctx)) { clearPendingOperation(session); await ctx.reply(ctx.t("pending_expired")); return; }
    const waitingForFile = ["WAITING_FOR_UPLOAD", "WAITING_FOR_REPLACEMENT"].includes(session.state);
    if (session.paused || !waitingForFile) {
      if (isPrivate(ctx) || msg.reply_to_message?.message_id === session.pendingMessageId) {
        session.paused = true;
        await ctx.reply(ctx.t("pending_notice"), { reply_markup: new InlineKeyboard().text(ctx.t("btn_resume"), "nav:resume").text(ctx.t("gif_btn_cancel"), "nav:cancel") });
      }
      return;
    }
    if (!isPrivate(ctx) && msg.reply_to_message?.message_id !== session.pendingMessageId) return;
    const scopeId = session.pendingScopeId;
    if (!scopeId || !(await requireScope(ctx, scopeId, true))) return;
    if (session.state === "WAITING_FOR_REPLACEMENT") {
      const success = await replaceGif(session.pendingGifUniqueId!, msg.animation.file_unique_id, msg.animation.file_id, scopeId);
      clearPendingOperation(session);
      await ctx.reply(ctx.t(success ? "gif_replaced" : "gif_not_found", { name: await scopeName(scopeId) }), { reply_markup: new InlineKeyboard().text(ctx.t("btn_archive"), `nav:archive:${scopeId}`) });
      return;
    }
    await saveIncomingGif(ctx, scopeId, msg.animation.file_unique_id, msg.animation.file_id, msg.caption); return;
  }
  // Group saving is deliberate (/add or reply to an upload prompt).
  if (!isPrivate(ctx)) return;
  const scopeId = ctx.currentScopeId;
  if (!scopeId || !(await canAdminScope(ctx.api, ctx.from!.id, scopeId))) {
    session.pendingGifUniqueId = msg.animation.file_unique_id;
    session.pendingFileId = msg.animation.file_id;
    session.pendingCaption = msg.caption;
    session.pendingExpiresAt = Date.now() + FLOW_TTL;
    await promptScopeSelect(ctx, "add"); return;
  }
  await saveIncomingGif(ctx, scopeId, msg.animation.file_unique_id, msg.animation.file_id, msg.caption);
}

export async function saveIncomingGif(ctx: MyContext, scopeId: string, uniqueId: string, fileId: string, caption?: string): Promise<void> {
  if (!(await requireScope(ctx, scopeId, true))) return;
  clearPendingOperation(ctx.session);
  ctx.session.pendingScopeId = scopeId;
  ctx.session.pendingGifUniqueId = uniqueId;
  ctx.session.pendingFileId = fileId;
  ctx.session.pendingOperationId = token();
  ctx.session.pendingExpiresAt = Date.now() + FLOW_TTL;
  const existing = await getGifInScope(uniqueId, scopeId);
  if (existing) {
    if (existing.file_id !== fileId || existing.expired) await refreshGifFileId(uniqueId, fileId, scopeId);
    ctx.session.state = "WAITING_FOR_GIF_ACTION";
    await resumeGifFlow(ctx); return;
  }
  const tags = extractTags(caption), emojis = extractEmojis(caption);
  if (hasInvalidTags(caption) || !labelsWithinLimit(tags, emojis) || (!tags.length && !emojis.length)) {
    ctx.session.state = "WAITING_FOR_NEW_TAGS";
    if (hasInvalidTags(caption)) await ctx.reply(ctx.t("gif_tags_invalid", { example: ctx.t("gif_tag_example") }));
    else if (!labelsWithinLimit(tags, emojis)) await ctx.reply(ctx.t("labels_too_many"));
    await resumeGifFlow(ctx); return;
  }
  const { isNew } = await upsertGif(uniqueId, fileId, tags, emojis, scopeId);
  clearPendingOperation(ctx.session);
  // Reactions are supplementary; lack of reaction permission cannot undo a save receipt.
  if (ctx.react) await ctx.react("👍").catch(() => {});
  await savedReceipt(ctx, scopeId, tags, emojis);
  if (isNew) await broadcastNewGif(ctx.api, ctx.from!.id, fileId, tags, emojis, scopeId, uniqueId);
}

export async function resumeGifFlow(ctx: MyContext): Promise<void> {
  const scopeId = ctx.session.pendingScopeId;
  if (!scopeId || !(await requireScope(ctx, scopeId, true))) return;
  ctx.session.paused = false;
  const name = await scopeName(scopeId);
  const state = ctx.session.state;
  if (state === "WAITING_FOR_GIF_ACTION") {
    const existing = await getGifInScope(ctx.session.pendingGifUniqueId!, scopeId);
    if (!existing) { clearPendingOperation(ctx.session); await ctx.reply(ctx.t("gif_not_found")); return; }
    const operationId = ctx.session.pendingOperationId = token();
    ctx.session.pendingExpiresAt = Date.now() + FLOW_TTL;
    const prompt = await ctx.reply(ctx.t("gif_already_exists", { name, tags: existing.tags.join(" ") || "—", emojis: existing.emojis.join(" ") || "—" }), {
      reply_markup: new InlineKeyboard().text(ctx.t("gif_btn_replace_all"), `gif:replace_tags:${operationId}`).row().text(ctx.t("gif_btn_add_new"), `gif:append_tags:${operationId}`).row().text(ctx.t("gif_btn_no"), `gif:no_changes:${operationId}`),
    });
    ctx.session.pendingMessageId = prompt.message_id; return;
  }
  let labels = "—";
  if (ctx.session.pendingGifUniqueId && state !== "WAITING_FOR_NEW_TAGS") {
    const doc = await getGifInScope(ctx.session.pendingGifUniqueId, scopeId);
    if (!doc) { clearPendingOperation(ctx.session); await ctx.reply(ctx.t("gif_not_found")); return; }
    labels = [...doc.tags, ...doc.emojis].join(" ") || "—";
  }
  const key = state === "WAITING_FOR_UPLOAD" ? "upload_prompt" : state === "WAITING_FOR_REPLACEMENT" ? "replacement_prompt" : state === "WAITING_TO_REPLACE_TAGS" ? "enter_new_tags" : state === "WAITING_TO_APPEND_TAGS" ? "enter_append_tags" : "gif_enter_tags";
  let text = ctx.t(key, { name, labels, example: ctx.t("gif_tag_example") });
  if (["WAITING_FOR_NEW_TAGS", "WAITING_TO_APPEND_TAGS", "WAITING_TO_REPLACE_TAGS"].includes(state)) {
    const suggestions = Object.entries(await getTagFacets(scopeId)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label]) => label);
    if (suggestions.length) text += "\n\n" + ctx.t("tag_suggestions", { labels: suggestions.join(" ") });
  }
  await inputPrompt(ctx, text);
}
