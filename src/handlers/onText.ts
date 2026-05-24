import { MyContext } from "../session.js";
import { extractTags, extractEmojis } from "../utils/tags.js";
import { upsertGif, replaceTags, appendTags } from "../meili.js";
import { broadcastNewGif } from "../broadcast.js";

export async function onText(ctx: MyContext): Promise<void> {
  const state = ctx.session.state;
  if (state === "IDLE") return;

  const text = ctx.message?.text;
  if (!text) return;

  const uniqueId = ctx.session.pendingGifUniqueId;
  const fileId = ctx.session.pendingFileId;
  const scopeId = ctx.session.pendingScopeId;

  const clearSession = () => {
    ctx.session.state = "IDLE";
    ctx.session.pendingGifUniqueId = undefined;
    ctx.session.pendingFileId = undefined;
    ctx.session.pendingScopeId = undefined;
  };

  if (!uniqueId || !scopeId) {
    clearSession();
    return;
  }

  const tags = extractTags(text);
  const emojis = extractEmojis(text);

  let finalTags = tags;
  let finalEmojis = emojis;

  if (state === "WAITING_FOR_NEW_TAGS") {
    if (!fileId) { clearSession(); return; }
    await upsertGif(uniqueId, fileId, tags, emojis, scopeId);
    await broadcastNewGif(ctx.api, ctx.from!.id, fileId, tags, emojis, scopeId);

  } else if (state === "WAITING_TO_REPLACE_TAGS") {
    await replaceTags(uniqueId, tags, emojis, scopeId);

  } else if (state === "WAITING_TO_APPEND_TAGS") {
    const updated = await appendTags(uniqueId, tags, emojis, scopeId);
    if (updated) {
      finalTags = updated.tags;
      finalEmojis = updated.emojis;
    }
  }

  clearSession();

  await ctx.reply(
    ctx.t("gif_saved", {
      tags: finalTags.join(" ") || "—",
      emojis: finalEmojis.join(" ") || "—",
    })
  );
}
