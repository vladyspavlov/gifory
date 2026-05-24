import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { extractTags, extractEmojis } from "../utils/tags.js";
import { upsertGif, replaceGif, getGifInScope } from "../meili.js";
import { broadcastNewGif } from "../broadcast.js";

export async function onAnimation(ctx: MyContext): Promise<void> {
  const msg = ctx.message;
  if (!msg?.animation) return;

  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply(ctx.t("no_scope_for_gifs"));
    return;
  }

  const animation = msg.animation;
  const replyAnimation = msg.reply_to_message?.animation;

  if (replyAnimation) {
    const success = await replaceGif(
      replyAnimation.file_unique_id,
      animation.file_unique_id,
      animation.file_id,
      scopeId
    );
    if (success) await ctx.react("👍");
    return;
  }

  const uniqueId = animation.file_unique_id;
  const fileId = animation.file_id;

  const existing = await getGifInScope(uniqueId, scopeId);

  if (existing) {
    const keyboard = new InlineKeyboard()
      .text(ctx.t("gif_btn_replace_all"), "gif:replace_tags")
      .text(ctx.t("gif_btn_add_new"), "gif:append_tags")
      .row()
      .text(ctx.t("gif_btn_no"), "gif:no_changes");

    ctx.session.pendingGifUniqueId = uniqueId;
    ctx.session.pendingScopeId = scopeId;

    await ctx.reply(
      ctx.t("gif_already_exists", {
        tags: existing.tags?.join(" ") || "—",
        emojis: existing.emojis?.join(" ") || "—",
      }),
      { reply_markup: keyboard }
    );
    return;
  }

  const tags = extractTags(msg.caption);
  const emojis = extractEmojis(msg.caption);

  if (tags.length === 0 && emojis.length === 0) {
    ctx.session.state = "WAITING_FOR_NEW_TAGS";
    ctx.session.pendingGifUniqueId = uniqueId;
    ctx.session.pendingFileId = fileId;
    ctx.session.pendingScopeId = scopeId;

    const keyboard = new InlineKeyboard().text(ctx.t("gif_btn_cancel"), "gif:cancel");
    await ctx.reply(ctx.t("gif_enter_tags"), { reply_markup: keyboard });
    return;
  }

  const { isNew } = await upsertGif(uniqueId, fileId, tags, emojis, scopeId);
  await ctx.react("👍");

  if (isNew) {
    await broadcastNewGif(ctx.api, ctx.from!.id, fileId, tags, emojis, scopeId);
  }
}
