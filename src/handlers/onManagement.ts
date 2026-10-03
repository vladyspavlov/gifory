import { InlineKeyboard, GrammyError } from "grammy";
import type { MyContext, Confirmation } from "../session.js";
import { clearPendingOperation } from "../session.js";
import { getScope, getScopeMembers, isMemberOfScope, removeUserFromScope, promoteToAdmin, changeAdminRole, closeManualScope } from "../scopes.js";
import { getGifInScope, getArchivePage, getAllGifs, deleteGif, deleteScopeGifs, replaceTags } from "../meili.js";
import { getUserProfile } from "../users.js";
import { redis } from "../redis.js";
import { requireScope, token, FLOW_TTL, screen, clip, gifHandle, readGifHandle, inputPrompt, isPrivate, scopeQuery, searchButtons, communityBack, rememberGifMessage } from "../ui.js";
import { resumeGifFlow, savedReceipt } from "./onAnimation.js";
import { canAdminScope } from "../access.js";

export async function showArchive(ctx: MyContext, scopeId: string, page = 0): Promise<void> {
  if (!(await requireScope(ctx, scopeId, true))) return;
  const scope = (await getScope(scopeId))!;
  let data = await getArchivePage(scopeId, page, 8, true);
  const pages = Math.max(1, Math.ceil(data.total / 8));
  if (page >= pages) { page = pages - 1; data = await getArchivePage(scopeId, page, 8, true); }
  const keyboard = new InlineKeyboard();
  for (const [i, doc] of data.gifs.entries()) {
    const label = [...doc.tags, ...doc.emojis].join(" ") || ctx.t("gif_label_fallback", { number: page * 8 + i + 1 });
    keyboard.text((doc.expired ? "⚠️ " : "") + clip(label), `archive:open:${await gifHandle(ctx, scopeId, doc.file_unique_id)}`).row();
  }
  if (page > 0) keyboard.text(ctx.t("tags_btn_back"), `nav:archive:${scopeId}:${page - 1}`);
  if (page + 1 < pages) keyboard.text(ctx.t("tags_btn_forward"), `nav:archive:${scopeId}:${page + 1}`);
  keyboard.row().text(ctx.t("btn_add"), `nav:add:${scopeId}`).row().text(ctx.t("btn_manage"), `nav:manage:${scopeId}`);
  await screen(ctx, ctx.t(data.total ? "archive_header" : "archive_empty", { name: scope.name, page: page + 1, total: pages }), keyboard);
}

export async function previewGif(ctx: MyContext, scopeId: string, uniqueId: string): Promise<void> {
  const scope = await requireScope(ctx, scopeId, true);
  if (!scope) return;
  const doc = await getGifInScope(uniqueId, scopeId);
  if (!doc) { await ctx.reply(ctx.t("gif_not_found"), { reply_markup: communityBack(ctx, scopeId) }); return; }
  const handle = await gifHandle(ctx, scopeId, uniqueId);
  const keyboard = searchButtons(ctx, scopeQuery(scopeId, doc.tags[0] ?? doc.emojis[0] ?? ""), ctx.t("btn_search_scope"))
    .row().text(ctx.t("gif_btn_add_new"), `archive:append:${handle}`).text(ctx.t("gif_btn_replace_all"), `archive:replace:${handle}`)
    .row().text(ctx.t("btn_replace_file"), `archive:file:${handle}`).text(ctx.t("btn_delete"), `archive:delete:${handle}`)
    .row().text(ctx.t("btn_archive"), `nav:archive:${scopeId}`);
  const caption = ctx.t("gif_preview", { name: scope.name, labels: clip([...doc.tags, ...doc.emojis].join(" ") || "—", 700), status: doc.expired ? ctx.t("gif_unavailable") : "" });
  try {
    const message = await ctx.replyWithAnimation(doc.file_id, { caption, reply_markup: keyboard });
    if (ctx.chat) await rememberGifMessage(ctx.chat.id, message.message_id, ctx.from!.id, scopeId, uniqueId);
  }
  catch (error) {
    if (!(error instanceof GrammyError) || error.error_code !== 400 || !/file|document/i.test(error.description)) throw error;
    await ctx.reply(caption + "\n" + ctx.t("gif_unavailable"), { reply_markup: keyboard });
  }
}

export async function onArchiveCallback(ctx: MyContext): Promise<void> {
  const match = ctx.callbackQuery?.data?.match(/^archive:(open|append|replace|file|delete):([a-f0-9]{12})$/);
  const handle = match ? await readGifHandle(ctx, match[2]) : null;
  if (!match || !handle) { await ctx.answerCallbackQuery({ text: ctx.t("operation_stale"), show_alert: true }); return; }
  if (!(await requireScope(ctx, handle.scopeId, true))) { await ctx.answerCallbackQuery(); return; }
  if (match[1] === "open") { await ctx.answerCallbackQuery(); await previewGif(ctx, handle.scopeId, handle.gifUniqueId); return; }
  if (await blockNewOperation(ctx)) { await ctx.answerCallbackQuery(); return; }
  if (match[1] === "delete") { await ctx.answerCallbackQuery(); await askConfirmation(ctx, { action: "delete", scopeId: handle.scopeId, gifUniqueId: handle.gifUniqueId }); return; }
  clearPendingOperation(ctx.session);
  ctx.session.state = match[1] === "append" ? "WAITING_TO_APPEND_TAGS" : match[1] === "replace" ? "WAITING_TO_REPLACE_TAGS" : "WAITING_FOR_REPLACEMENT";
  ctx.session.pendingScopeId = handle.scopeId;
  ctx.session.pendingGifUniqueId = handle.gifUniqueId;
  ctx.session.pendingOperationId = token();
  await ctx.answerCallbackQuery();
  await resumeGifFlow(ctx);
}

export async function blockNewOperation(ctx: MyContext): Promise<boolean> {
  if (ctx.session.state === "IDLE" && !ctx.session.pendingIntent && !ctx.session.confirmation) return false;
  const expired = (ctx.session.pendingExpiresAt && ctx.session.pendingExpiresAt <= Date.now()) || (ctx.session.confirmation && ctx.session.confirmation.expiresAt <= Date.now()) || (ctx.session.pendingSelectionExpiresAt && ctx.session.pendingSelectionExpiresAt <= Date.now());
  if (expired) { clearPendingOperation(ctx.session); await ctx.reply(ctx.t("pending_expired")); return false; }
  ctx.session.paused = true;
  await ctx.reply(ctx.t("pending_notice"), { reply_markup: new InlineKeyboard().text(ctx.t("btn_resume"), "nav:resume").text(ctx.t("gif_btn_cancel"), "nav:cancel") });
  return true;
}

export async function askConfirmation(ctx: MyContext, request: Omit<Confirmation, "token" | "messageId" | "expiresAt">): Promise<void> {
  const scope = await requireScope(ctx, request.scopeId, request.action !== "leave");
  if (!scope) return;
  let text: string;
  if (request.action === "leave") {
    if (scope.type === "group") { await ctx.reply(ctx.t("group_leave_note"), { reply_markup: communityBack(ctx, scope.id) }); return; }
    if (scope.admin_ids.length === 1 && scope.admin_ids[0] === ctx.from!.id) {
      await ctx.reply(ctx.t("leave_last_admin", { name: scope.name }), { reply_markup: new InlineKeyboard().text(ctx.t("btn_members"), `nav:members:${scope.id}`).row().text(ctx.t("btn_close"), `nav:close:${scope.id}`) }); return;
    }
    text = ctx.t("leave_confirm", { name: scope.name });
  } else if (request.action === "delete" || request.action === "edit") {
    const gif = await getGifInScope(request.gifUniqueId!, scope.id);
    if (!gif) { await ctx.reply(ctx.t("gif_not_found")); return; }
    const labels = [...gif.tags, ...gif.emojis].join(" ") || "—";
    text = request.action === "delete" ? ctx.t("delete_confirm", { name: scope.name, labels: clip(labels, 900) }) : ctx.t("edit_confirm", { name: scope.name, old: clip(labels, 900), labels: clip([...(request.tags ?? []), ...(request.emojis ?? [])].join(" "), 900) });
  } else if (request.action === "close") {
    if (!isPrivate(ctx) || scope.type !== "manual" || scope.admin_ids.length !== 1 || scope.admin_ids[0] !== ctx.from!.id) { await ctx.reply(ctx.t("close_policy")); return; }
    text = ctx.t("close_confirm", { name: scope.name });
  } else {
    if (scope.type !== "manual") { await ctx.reply(ctx.t("group_roles")); return; }
    if (!request.targetId || !(await isMemberOfScope(request.targetId, scope.id))) { await ctx.reply(ctx.t("kick_not_member")); return; }
    if (request.targetId === ctx.from!.id && request.action !== "demote") { await ctx.reply(ctx.t("kick_self")); return; }
    if (request.action === "promote" && scope.admin_ids.includes(request.targetId)) { await ctx.reply(ctx.t("promote_already_admin")); return; }
    if (request.action === "demote" && (!scope.admin_ids.includes(request.targetId) || scope.admin_ids.length <= 1)) { await ctx.reply(ctx.t("leave_last_admin", { name: scope.name })); return; }
    const profile = await getUserProfile(request.targetId);
    const user = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") : ctx.t("user_fallback", { id: request.targetId });
    const actionKeys = { kick: "btn_kick", promote: "btn_promote", demote: "btn_demote", handover: "btn_handover" } as const;
    const consequenceKeys = { kick: "kick_consequence", promote: "promote_consequence", demote: "demote_consequence", handover: "handover_consequence" } as const;
    text = ctx.t("member_confirm", { action: ctx.t(actionKeys[request.action]), user, name: scope.name, consequence: ctx.t(consequenceKeys[request.action]) });
  }
  const confirmation = { ...request, token: token(), messageId: 0, expiresAt: Date.now() + FLOW_TTL };
  ctx.session.confirmation = confirmation;
  ctx.session.paused = false;
  const message = await ctx.reply(text, { reply_markup: new InlineKeyboard().text(ctx.t("btn_confirm"), `confirm:yes:${confirmation.token}`).text(ctx.t("gif_btn_cancel"), `confirm:no:${confirmation.token}`) });
  confirmation.messageId = message.message_id;
}

export async function repeatConfirmation(ctx: MyContext): Promise<void> {
  const request = ctx.session.confirmation;
  if (!request) return;
  await askConfirmation(ctx, { ...request, awaitingName: undefined });
}

export async function onConfirmCallback(ctx: MyContext): Promise<void> {
  const match = ctx.callbackQuery?.data?.match(/^confirm:(yes|no):([a-f0-9]{12})$/);
  const request = ctx.session.confirmation;
  if (!match || !request || request.token !== match[2] || request.messageId !== ctx.callbackQuery?.message?.message_id || request.expiresAt <= Date.now() || ctx.session.paused || request.awaitingName) {
    await ctx.answerCallbackQuery({ text: ctx.t("operation_stale"), show_alert: true }); return;
  }
  if (match[1] === "no") {
    ctx.session.confirmation = undefined;
    await ctx.editMessageText(ctx.t("operation_cancelled"), { reply_markup: communityBack(ctx, request.scopeId) });
    await ctx.answerCallbackQuery(); return;
  }
  if (!(await requireScope(ctx, request.scopeId, request.action !== "leave"))) { ctx.session.confirmation = undefined; await ctx.answerCallbackQuery(); return; }
  if (request.action === "close") {
    request.awaitingName = true;
    await ctx.answerCallbackQuery();
    await inputPrompt(ctx, ctx.t("close_name_prompt", { name: (await getScope(request.scopeId))!.name }));
    return;
  }
  ctx.session.confirmation = undefined;
  await ctx.answerCallbackQuery();
  await executeConfirmation(ctx, request);
}

export async function executeConfirmation(ctx: MyContext, request: Confirmation): Promise<void> {
  const scope = await requireScope(ctx, request.scopeId, request.action !== "leave");
  if (!scope) return;
  let success = false;
  if (request.action === "leave") {
    if (scope.type !== "manual") { await ctx.reply(ctx.t("group_leave_note")); return; }
    success = await removeUserFromScope(ctx.from!.id, scope.id) === "removed";
    await ctx.reply(ctx.t(success ? "leave_success" : "leave_last_admin", { name: scope.name }));
    if (success) {
      const { getActiveScopeId } = await import("../scopes.js");
      ctx.currentScopeId = await getActiveScopeId(ctx.from!.id);
      const { onHome } = await import("./onHome.js"); await onHome(ctx);
    }
    return;
  }
  if (request.action === "delete") {
    success = await deleteGif(request.gifUniqueId!, scope.id);
    await ctx.reply(ctx.t(success ? "gif_deleted" : "gif_not_found", { name: scope.name }), { reply_markup: new InlineKeyboard().text(ctx.t("btn_archive"), `nav:archive:${scope.id}`) }); return;
  }
  if (request.action === "edit") {
    success = await replaceTags(request.gifUniqueId!, request.tags ?? [], request.emojis ?? [], scope.id);
    if (success) await savedReceipt(ctx, scope.id, request.tags ?? [], request.emojis ?? []);
    else await ctx.reply(ctx.t("gif_not_found"));
    return;
  }
  if (scope.type !== "manual") { await ctx.reply(ctx.t("group_roles")); return; }
  if (request.action === "close") {
    if (scope.admin_ids.length !== 1 || scope.admin_ids[0] !== ctx.from!.id) { await ctx.reply(ctx.t("close_policy")); return; }
    const docs = await getAllGifs(scope.id);
    await deleteScopeGifs(scope.id);
    success = await closeManualScope(scope.id, ctx.from!.id);
    if (success) {
      for (const pattern of [`stats:week:${scope.id}:*`, `notify_muted:${scope.id}:*`]) {
        let cursor = "0";
        do { const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100); cursor = next; if (keys.length) await redis.del(...keys); } while (cursor !== "0");
      }
      if (docs.length) {
        for (let i = 0; i < docs.length; i += 200) await redis.zrem("analytics:gifs", ...docs.slice(i, i + 200).map(doc => doc.id));
      }
      clearPendingOperation(ctx.session);
      ctx.currentScopeId = undefined;
      const { onHome } = await import("./onHome.js");
      await ctx.reply(ctx.t("community_closed", { name: scope.name })); await onHome(ctx);
    }
    return;
  }
  if (!request.targetId || !(await isMemberOfScope(request.targetId, scope.id))) { await ctx.reply(ctx.t("kick_not_member")); return; }
  if (request.action === "kick") success = await removeUserFromScope(request.targetId, scope.id, { actorId: ctx.from!.id, revokeInvites: true }) === "removed";
  if (request.action === "promote") success = await promoteToAdmin(request.targetId, scope.id, ctx.from!.id);
  if (request.action === "demote" || request.action === "handover") success = await changeAdminRole(scope.id, ctx.from!.id, request.targetId, request.action === "handover");
  const profile = await getUserProfile(request.targetId);
  const user = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") : ctx.t("user_fallback", { id: request.targetId });
  await ctx.reply(ctx.t(success ? request.action === "kick" ? "kick_success" : "member_updated" : "scope_gone", { name: scope.name, user }), { reply_markup: communityBack(ctx, scope.id) });
  if (request.action === "handover" || request.targetId === ctx.from!.id) {
    const { updatePrivateCommands } = await import("../commands.js");
    await updatePrivateCommands(ctx, await canAdminScope(ctx.api, ctx.from!.id, scope.id));
  }
}
