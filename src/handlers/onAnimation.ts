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
    await ctx.reply(
      "Оберіть активну спільноту через /scopes, щоб додавати гіфки."
    );
    return;
  }

  const animation = msg.animation;
  const replyAnimation = msg.reply_to_message?.animation;

  // ── Replace GIF (reply with new GIF onto old one) ───────────────────────
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

  // ── Duplicate check ──────────────────────────────────────────────────────
  const existing = await getGifInScope(uniqueId, scopeId);

  if (existing) {
    const info =
      `📌 Гіфка вже є в базі!\n` +
      `🏷 Теги: ${existing.tags?.join(" ") || "—"}\n` +
      `😀 Емоджі: ${existing.emojis?.join(" ") || "—"}`;

    const keyboard = new InlineKeyboard()
      .text("🔄 Замінити всі", "gif:replace_tags")
      .text("➕ Додати нові", "gif:append_tags")
      .row()
      .text("❌ Ні", "gif:no_changes");

    ctx.session.pendingGifUniqueId = uniqueId;
    ctx.session.pendingScopeId = scopeId;

    await ctx.reply(info, { reply_markup: keyboard });
    return;
  }

  // ── New GIF ──────────────────────────────────────────────────────────────
  const tags = extractTags(msg.caption);
  const emojis = extractEmojis(msg.caption);

  if (tags.length === 0 && emojis.length === 0) {
    ctx.session.state = "WAITING_FOR_NEW_TAGS";
    ctx.session.pendingGifUniqueId = uniqueId;
    ctx.session.pendingFileId = fileId;
    ctx.session.pendingScopeId = scopeId;

    const keyboard = new InlineKeyboard().text("❌ Скасувати", "gif:cancel");
    await ctx.reply("🏷 Введіть теги та/або емоджі для цієї гіфки:", {
      reply_markup: keyboard,
    });
    return;
  }

  const { isNew } = await upsertGif(uniqueId, fileId, tags, emojis, scopeId);
  await ctx.react("👍");

  if (isNew) {
    await broadcastNewGif(ctx.api, ctx.from!.id, fileId, tags, emojis, scopeId);
  }
}
