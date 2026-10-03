import { InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { screen, searchButtons } from "../ui.js";

export async function onHelp(ctx: MyContext): Promise<void> {
  const keyboard = new InlineKeyboard().text(ctx.t("btn_help_search"), "help:search").row().text(ctx.t("btn_join_help"), "nav:join").row();
  // Instructions are public; reading them must not require group verification.
  keyboard.text(ctx.t("btn_help_add"), "help:add").row().text(ctx.t("btn_help_manage"), "help:manage").row();
  keyboard.text(ctx.t("btn_communities"), "nav:scopes").text(ctx.t("btn_home"), "nav:home");
  await screen(ctx, ctx.t("help"), keyboard);
}
export async function onHelpTopic(ctx: MyContext): Promise<void> {
  const topic = ctx.callbackQuery?.data?.slice(5);
  const text = topic === "search" ? ctx.t("search_prompt", { username: ctx.me.username, example: ctx.t("search_example") }) + "\n\n" + ctx.t("search_recovery") : ctx.t(topic === "add" ? "help_add" : "help_manage");
  const keyboard = topic === "search" ? searchButtons(ctx) : new InlineKeyboard().text(ctx.t("btn_communities"), "nav:scopes");
  keyboard.row().text(ctx.t("tags_btn_back"), "nav:help");
  await screen(ctx, text, keyboard);
  await ctx.answerCallbackQuery();
}
