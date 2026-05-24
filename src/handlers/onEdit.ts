import { MyContext } from "../session.js";
import { extractTags, extractEmojis } from "../utils/tags.js";
import { editTags } from "../meili.js";

export async function onEdit(ctx: MyContext): Promise<void> {
  const msg = ctx.message;
  if (!msg?.text) return;

  const replyAnimation = msg.reply_to_message?.animation;
  if (!replyAnimation) {
    await ctx.reply("Зробіть Reply на гіфку, теги якої хочете змінити.");
    return;
  }

  const tags = extractTags(msg.text);
  const emojis = extractEmojis(msg.text);

  if (tags.length === 0 && emojis.length === 0) {
    await ctx.reply(
      "Не знайдено жодного тегу чи емоджі.\nФормат: /edit #тег1 #тег2 😀"
    );
    return;
  }

  const success = await editTags(replyAnimation.file_unique_id, tags, emojis);

  if (success) {
    await ctx.react("👍");
  } else {
    await ctx.reply("Цю гіфку не знайдено в базі.");
  }
}