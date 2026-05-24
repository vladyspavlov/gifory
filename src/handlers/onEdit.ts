import { MyContext } from "../session.js";
import { extractTags, extractEmojis } from "../utils/tags.js";
import { editTags } from "../meili.js";

export async function onEdit(ctx: MyContext): Promise<void> {
  const msg = ctx.message;
  if (!msg?.text) return;

  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply(ctx.t("select_scope"));
    return;
  }

  const replyAnimation = msg.reply_to_message?.animation;
  if (!replyAnimation) {
    await ctx.reply(ctx.t("reply_to_edit"));
    return;
  }

  const tags = extractTags(msg.text);
  const emojis = extractEmojis(msg.text);

  if (tags.length === 0 && emojis.length === 0) {
    await ctx.reply(ctx.t("no_tags_found"));
    return;
  }

  const success = await editTags(replyAnimation.file_unique_id, tags, emojis, scopeId);

  if (success) {
    await ctx.react("👍");
  } else {
    await ctx.reply(ctx.t("gif_not_found"));
  }
}
