import { MyContext, clearPendingOperation } from "../session.js";
import { extractTags, extractEmojis } from "../utils/tags.js";
import { upsertGif, replaceTags, appendTags } from "../meili.js";
import { broadcastNewGif } from "../broadcast.js";
import { canAdminScope } from "../access.js";

export async function onText(ctx: MyContext): Promise<void> {
  const { state, pendingGifUniqueId: uniqueId, pendingFileId: fileId, pendingScopeId: scopeId } = ctx.session;
  if (state === "IDLE" || !ctx.message?.text) return;
  if (!uniqueId || !scopeId) { clearPendingOperation(ctx.session); return; }
  // Recheck the captured scope right before a mutation, even if the active scope changed.
  if (!(await canAdminScope(ctx.api, ctx.from!.id, scopeId))) {
    clearPendingOperation(ctx.session);
    await ctx.reply(ctx.t("no_permissions"));
    return;
  }
  if (state === "WAITING_FOR_GIF_ACTION") {
    await ctx.reply(ctx.t("gif_choose_action"));
    return;
  }
  const tags = extractTags(ctx.message.text);
  const emojis = extractEmojis(ctx.message.text);
  if (!tags.length && !emojis.length) {
    await ctx.reply(ctx.t("gif_tags_required"));
    return;
  }
  let finalTags = tags;
  let finalEmojis = emojis;
  let saved = true;
  let isNew = false;
  if (state === "WAITING_FOR_NEW_TAGS") {
    if (!fileId) { clearPendingOperation(ctx.session); return; }
    ({ isNew } = await upsertGif(uniqueId, fileId, tags, emojis, scopeId));
  } else if (state === "WAITING_TO_REPLACE_TAGS") {
    saved = await replaceTags(uniqueId, tags, emojis, scopeId);
  } else if (state === "WAITING_TO_APPEND_TAGS") {
    const updated = await appendTags(uniqueId, tags, emojis, scopeId);
    saved = updated !== null;
    if (updated) { finalTags = updated.tags; finalEmojis = updated.emojis; }
  }
  clearPendingOperation(ctx.session);
  if (!saved) { await ctx.reply(ctx.t("gif_not_found")); return; }
  await ctx.reply(ctx.t("gif_saved", { tags: finalTags.join(" ") || "—", emojis: finalEmojis.join(" ") || "—" }));
  if (isNew && fileId) await broadcastNewGif(ctx.api, ctx.from!.id, fileId, finalTags, finalEmojis, scopeId);
}
