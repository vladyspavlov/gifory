import { InlineKeyboard, NextFunction } from "grammy";
import { MyContext } from "../session.js";
import { onTags } from "./onTags.js";
import { onScopes } from "./onScopes.js";
import { onHelp } from "./onHelp.js";
import { onLang } from "./onLang.js";

export async function onKeyboardButton(ctx: MyContext, next: NextFunction): Promise<void> {
  const text = ctx.message?.text ?? "";

  // Match on emoji prefix — works regardless of display language
  let matched = true;
  if (text.startsWith("🔍")) {
    // Clear any pending GIF operation so the user isn't stuck
    ctx.session.state = "IDLE";
    ctx.session.pendingGifUniqueId = undefined;
    ctx.session.pendingFileId = undefined;
    ctx.session.pendingScopeId = undefined;
    await ctx.reply(ctx.t("search_prompt"), {
      reply_markup: new InlineKeyboard().switchInlineCurrent(ctx.t("btn_search_inline"), ""),
    });
  } else if (text.startsWith("🏷")) {
    await onTags(ctx);
  } else if (text.startsWith("📋")) {
    await onScopes(ctx);
  } else if (text.startsWith("❓")) {
    await onHelp(ctx);
  } else if (text.startsWith("🌐")) {
    await onLang(ctx);
  } else {
    matched = false;
  }

  if (!matched) await next();
}
