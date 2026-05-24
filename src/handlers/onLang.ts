import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { setUserLang, Lang, t } from "../i18n/index.js";
import { getMainKeyboard } from "../keyboard.js";

export async function onLang(ctx: MyContext): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("English 🇬🇧", "lang:set:en")
    .text("Українська 🇺🇦", "lang:set:uk");

  await ctx.reply(ctx.t("lang_select"), { reply_markup: keyboard });
}

export async function onLangSetCallback(ctx: MyContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const lang = data.replace("lang:set:", "") as Lang;

  if (lang !== "en" && lang !== "uk") {
    await ctx.answerCallbackQuery();
    return;
  }

  await setUserLang(ctx.from!.id, lang);

  // Build a fresh TFunction in the new language — ctx.t still carries the old one
  const newT = (key: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) =>
    t(lang, key, params);

  await ctx.editMessageText(newT("lang_set"));
  await ctx.answerCallbackQuery();
  await ctx.reply(newT("start_welcome"), { reply_markup: getMainKeyboard(newT) });
}
