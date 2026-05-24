import { MyContext } from "../session.js";
import { deleteGif } from "../meili.js";

export async function onDelete(ctx: MyContext): Promise<void> {
  const msg = ctx.message;
  if (!msg) return;

  const replyAnimation = msg.reply_to_message?.animation;
  if (!replyAnimation) {
    await ctx.reply("Зробіть Reply на гіфку, яку хочете видалити.");
    return;
  }

  const success = await deleteGif(replyAnimation.file_unique_id);

  if (success) {
    await ctx.react("👍");
  } else {
    await ctx.reply("Цю гіфку не знайдено в базі.");
  }
}