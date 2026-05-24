import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { createScope, generateScopeId } from "../scopes.js";

export async function onCreateScope(ctx: MyContext): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(ctx.t("create_private_only"));
    return;
  }

  const text = ctx.message?.text ?? "";
  const name = text.replace(/^\/create\s*/i, "").trim();

  if (!name) {
    await ctx.reply(ctx.t("create_needs_name"));
    return;
  }

  const userId = ctx.from!.id;
  const scopeId = generateScopeId();

  await createScope(scopeId, name, "manual", [userId]);
  ctx.session.activeScopeId = scopeId;

  const keyboard = new InlineKeyboard()
    .switchInlineCurrent(ctx.t("btn_search_gifs"), "");

  await ctx.reply(ctx.t("create_success", { name }), { reply_markup: keyboard });
}
