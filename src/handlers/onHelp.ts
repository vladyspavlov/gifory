import { MyContext } from "../session.js";
import { getMainKeyboard } from "../keyboard.js";

export async function onHelp(ctx: MyContext): Promise<void> {
  await ctx.reply(ctx.t("help"), { reply_markup: getMainKeyboard(ctx.t) });
}
