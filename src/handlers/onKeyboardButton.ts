import type { NextFunction } from "grammy";
import type { MyContext } from "../session.js";
import { en } from "../i18n/en.js";
import { uk } from "../i18n/uk.js";
import { onTags } from "./onTags.js";
import { onScopes } from "./onScopes.js";
import { onHelp } from "./onHelp.js";
import { onLang } from "./onLang.js";
import { onSearch, onSettings, onHome } from "./onHome.js";
import { pauseForNavigation } from "../ui.js";

export async function onKeyboardButton(ctx: MyContext, next: NextFunction): Promise<void> {
  const text = ctx.message?.text ?? "";
  const matches = (key: "btn_search" | "btn_tags" | "btn_communities" | "btn_help" | "btn_lang" | "btn_settings" | "btn_home") => text === en[key] || text === uk[key];
  let handler: ((ctx: MyContext) => Promise<void>) | undefined;
  if (matches("btn_search") || text === "🔍 Search" || text === "🔍 Пошук") handler = onSearch;
  else if (matches("btn_tags") || text === "🏷 Tags" || text === "🏷 Теги") handler = onTags;
  else if (matches("btn_communities")) handler = onScopes;
  else if (matches("btn_help")) handler = onHelp;
  else if (matches("btn_lang")) handler = onLang;
  else if (matches("btn_settings")) handler = onSettings;
  else if (matches("btn_home")) handler = onHome;
  if (!handler) { await next(); return; }
  await pauseForNavigation(ctx);
  await handler(ctx);
}
