import { MyContext } from "../session.js";
import { extractTags, extractEmojis } from "../utils/tags.js";
import { upsertGif, replaceTags, appendTags, gifIndex } from "../meili.js";
import { broadcastNewGif } from "../broadcast.js";

export async function onText(ctx: MyContext): Promise<void> {
  const state = ctx.session.state;
  if (state === "IDLE") return;

  const text = ctx.message?.text;
  if (!text) return;

  const uniqueId = ctx.session.pendingGifUniqueId;
  const fileId = ctx.session.pendingFileId;

  const tags = extractTags(text);
  const emojis = extractEmojis(text);

  const clearSession = () => {
    ctx.session.state = "IDLE";
    ctx.session.pendingGifUniqueId = undefined;
    ctx.session.pendingFileId = undefined;
  };

  if (!uniqueId) {
    clearSession();
    return;
  }

  let finalTags = tags;
  let finalEmojis = emojis;

  if (state === "WAITING_FOR_NEW_TAGS") {
    if (!fileId) { clearSession(); return; }
    await upsertGif(uniqueId, fileId, tags, emojis);
    await broadcastNewGif(ctx.api, ctx.from!.id, fileId, tags, emojis);

  } else if (state === "WAITING_TO_REPLACE_TAGS") {
    await replaceTags(uniqueId, tags, emojis);

  } else if (state === "WAITING_TO_APPEND_TAGS") {
    await appendTags(uniqueId, tags, emojis);
    // Показуємо фінальний злитий стан
    try {
      const doc = await gifIndex.getDocument(uniqueId);
      finalTags = doc.tags;
      finalEmojis = doc.emojis;
    } catch {}
  }

  clearSession();

  await ctx.reply(
    `✅ Успішно збережено!\n` +
    `🏷 Теги: ${finalTags.join(" ") || "—"}\n` +
    `😀 Емоджі: ${finalEmojis.join(" ") || "—"}`
  );
}