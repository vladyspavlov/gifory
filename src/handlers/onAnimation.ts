import { InlineKeyboard } from "grammy";
import { randomBytes } from "node:crypto";
import { MyContext, clearPendingOperation } from "../session.js";
import { extractTags, extractEmojis } from "../utils/tags.js";
import { upsertGif, replaceGif, getGifInScope, refreshGifFileId } from "../meili.js";
import { broadcastNewGif } from "../broadcast.js";
import { promptScopeSelect } from "./onScopes.js";

export async function onAnimation(ctx: MyContext): Promise<void> {
  const msg = ctx.message;
  if (!msg?.animation) return;

  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await promptScopeSelect(ctx);
    return;
  }

  clearPendingOperation(ctx.session);
  const animation = msg.animation;
  const replyAnimation = msg.reply_to_message?.animation;

  if (replyAnimation) {
    const success = await replaceGif(
      replyAnimation.file_unique_id,
      animation.file_unique_id,
      animation.file_id,
      scopeId
    );
    if (success) {
      await ctx.react("👍");
      await ctx.reply(ctx.t("gif_replaced"));
    } else {
      await ctx.reply(ctx.t("gif_not_found"));
    }
    return;
  }

  const uniqueId = animation.file_unique_id;
  const fileId = animation.file_id;

  const existing = await getGifInScope(uniqueId, scopeId);

  if (existing) {
    // Re-sending an existing GIF — always refresh file_id so expired IDs get healed
    if (existing.file_id !== fileId || existing.expired) {
      await refreshGifFileId(uniqueId, fileId, scopeId);
    }
    const operationId = randomBytes(6).toString("hex");
    const keyboard = new InlineKeyboard()
      .text(ctx.t("gif_btn_replace_all"), `gif:replace_tags:${operationId}`)
      .text(ctx.t("gif_btn_add_new"), `gif:append_tags:${operationId}`)
      .row()
      .text(ctx.t("gif_btn_no"), `gif:no_changes:${operationId}`);

    ctx.session.state = "WAITING_FOR_GIF_ACTION";
    ctx.session.pendingOperationId = operationId;
    ctx.session.pendingGifUniqueId = uniqueId;
    ctx.session.pendingScopeId = scopeId;

    const prompt = await ctx.reply(
      ctx.t("gif_already_exists", {
        tags: existing.tags?.join(" ") || "—",
        emojis: existing.emojis?.join(" ") || "—",
      }),
      { reply_markup: keyboard }
    );
    ctx.session.pendingMessageId = prompt.message_id;
    return;
  }

  const tags = extractTags(msg.caption);
  const emojis = extractEmojis(msg.caption);

  if (tags.length === 0 && emojis.length === 0) {
    const operationId = randomBytes(6).toString("hex");
    ctx.session.pendingOperationId = operationId;
    ctx.session.state = "WAITING_FOR_NEW_TAGS";
    ctx.session.pendingGifUniqueId = uniqueId;
    ctx.session.pendingFileId = fileId;
    ctx.session.pendingScopeId = scopeId;

    const keyboard = new InlineKeyboard().text(ctx.t("gif_btn_cancel"), `gif:cancel:${operationId}`);
    const prompt = await ctx.reply(ctx.t("gif_enter_tags"), { reply_markup: keyboard });
    ctx.session.pendingMessageId = prompt.message_id;
    return;
  }

  const { isNew } = await upsertGif(uniqueId, fileId, tags, emojis, scopeId);
  await ctx.react("👍");

  // Echo what was actually parsed — a malformed #tag is otherwise invisible
  // until a search fails to find the GIF weeks later.
  await ctx.reply(
    ctx.t("gif_saved", {
      tags: tags.join(" ") || "—",
      emojis: emojis.join(" ") || "—",
    })
  );

  if (isNew) {
    await broadcastNewGif(ctx.api, ctx.from!.id, fileId, tags, emojis, scopeId);
  }
}
