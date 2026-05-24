import { MyContext } from "../session.js";
import { deleteGif } from "../meili.js";

export async function onDelete(ctx: MyContext): Promise<void> {
  const msg = ctx.message;
  if (!msg) return;

  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply(ctx.t("select_scope"));
    return;
  }

  const replyAnimation = msg.reply_to_message?.animation;
  if (!replyAnimation) {
    await ctx.reply(ctx.t("reply_to_delete"));
    return;
  }

  const success = await deleteGif(replyAnimation.file_unique_id, scopeId);

  if (success) {
    await ctx.react("👍");
  } else {
    await ctx.reply(ctx.t("gif_not_found"));
  }
}
