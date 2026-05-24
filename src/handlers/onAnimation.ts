import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { extractTags, extractEmojis } from "../utils/tags.js";
import { upsertGif, replaceGif, gifIndex } from "../meili.js";
import { broadcastNewGif } from "../broadcast.js";

export async function onAnimation(ctx: MyContext): Promise<void> {
  const msg = ctx.message;
  if (!msg?.animation) return;

  const animation = msg.animation;
  const replyAnimation = msg.reply_to_message?.animation;

  // ── Кейс: заміна гіфки (reply з новою гіфкою на стару) ──────────────────
  if (replyAnimation) {
    const success = await replaceGif(
      replyAnimation.file_unique_id,
      animation.file_unique_id,
      animation.file_id
    );
    if (success) await ctx.react("👍");
    return;
  }

  const uniqueId = animation.file_unique_id;
  const fileId = animation.file_id;

  // ── Перевірка дубліката ──────────────────────────────────────────────────
  let existing = null;
  try {
    existing = await gifIndex.getDocument(uniqueId);
  } catch {}

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

    // Зберігаємо id в сесії для callback-обробника
    ctx.session.pendingGifUniqueId = uniqueId;

    await ctx.reply(info, { reply_markup: keyboard });
    return;
  }

  // ── Нова гіфка ───────────────────────────────────────────────────────────
  const tags = extractTags(msg.caption);
  const emojis = extractEmojis(msg.caption);

  if (tags.length === 0 && emojis.length === 0) {
    // Немає тегів → очікуємо введення
    ctx.session.state = "WAITING_FOR_NEW_TAGS";
    ctx.session.pendingGifUniqueId = uniqueId;
    ctx.session.pendingFileId = fileId;

    const keyboard = new InlineKeyboard().text("❌ Скасувати", "gif:cancel");
    await ctx.reply("🏷 Введіть теги та/або емоджі для цієї гіфки:", {
      reply_markup: keyboard,
    });
    return;
  }

  // Є теги/емоджі → одразу зберігаємо
  const { isNew } = await upsertGif(uniqueId, fileId, tags, emojis);
  await ctx.react("👍");

  if (isNew) {
    await broadcastNewGif(ctx.api, ctx.from!.id, fileId, tags, emojis);
  }
}