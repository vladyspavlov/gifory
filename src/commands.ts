import { Bot } from "grammy";
import { MyContext } from "./session.js";
import { Lang, t } from "./i18n/index.js";
import { Messages } from "./i18n/en.js";
import { getUserLang } from "./i18n/index.js";
import { redis } from "./redis.js";
import { getScope } from "./scopes.js";

const LANGS: Lang[] = ["en", "uk"];

/** Commands every user can run. */
const PUBLIC: { command: string; key: keyof Messages }[] = [
  { command: "home", key: "cmd_home" },
  { command: "search", key: "cmd_search" },
  { command: "help",   key: "cmd_help" },
  { command: "scopes", key: "cmd_scopes" },
  { command: "tags",   key: "cmd_tags" },
  { command: "create", key: "cmd_create" },
  { command: "join",   key: "cmd_join" },
  { command: "leave",  key: "cmd_leave" },
  { command: "lang",   key: "cmd_lang" },
  { command: "settings", key: "cmd_settings" },
  { command: "cancel", key: "cmd_cancel" },
];

/** Additionally shown to chat administrators. */
const ADMIN: { command: string; key: keyof Messages }[] = [
  { command: "add", key: "cmd_add" },
  { command: "manage", key: "cmd_manage" },
  { command: "edit",       key: "cmd_edit" },
  { command: "del",        key: "cmd_del" },
  { command: "invite",     key: "cmd_invite" },
  { command: "members",    key: "cmd_members" },
  { command: "promote",    key: "cmd_promote" },
  { command: "kick",       key: "cmd_kick" },
  { command: "rename",     key: "cmd_rename" },
  { command: "stats",      key: "cmd_stats" },
  { command: "backup",     key: "cmd_backup" },
  { command: "syncadmins", key: "cmd_syncadmins" },
];

function render(lang: Lang, list: typeof PUBLIC) {
  return list.map(({ command, key }) => ({ command, description: t(lang, key) }));
}

/**
 * Publishes the command menu to Telegram so clients show autocomplete.
 * Registered per language and per scope; failures are logged, never fatal —
 * a rate-limited menu update must not stop the bot from starting.
 */
export async function registerCommands(bot: Bot<MyContext>): Promise<void> {
  try {
    for (const lang of LANGS) {
      // `language_code: "en"` would shadow the default for English clients only,
      // so English doubles as the fallback list with no language_code.
      const opts = lang === "en" ? {} : { language_code: lang };

      const groupPublic = PUBLIC.filter(item => !["create", "join", "leave"].includes(item.command));
      const groupAdmin = ADMIN.filter(item => !["kick", "promote", "rename"].includes(item.command));
      await bot.api.setMyCommands(render(lang, groupPublic), opts);
      await bot.api.setMyCommands(render(lang, PUBLIC), { ...opts, scope: { type: "all_private_chats" } });
      await bot.api.setMyCommands(render(lang, [...groupPublic, ...groupAdmin]), {
        ...opts,
        scope: { type: "all_chat_administrators" },
      });
      await bot.api.setMyDescription(t(lang, "profile_description"), opts);
      await bot.api.setMyShortDescription(t(lang, "profile_short"), opts);
    }
    console.log("[Commands] Menu published for locales: " + LANGS.join(", "));
  } catch (err) {
    console.error("[Commands] Failed to publish command menu:", err);
  }
}

/** Menu presentation follows the explicit language; access is still checked by handlers. */
export async function updatePrivateCommands(ctx: MyContext, admin: boolean): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const lang = await getUserLang(ctx.from!.id, ctx.from!.language_code);
  const scopeType = ctx.currentScopeId ? (await getScope(ctx.currentScopeId))?.type : undefined;
  const signature = `ux-v1:${lang}:${admin}:${scopeType}`;
  const cacheKey = `ux:commands:${ctx.from!.id}`;
  try {
    if (await redis.get(cacheKey) === signature) return;
    const adminCommands = ADMIN.filter(item => item.command !== "syncadmins" && (scopeType !== "group" || !["kick", "promote", "rename"].includes(item.command)));
    const list = render(lang, admin ? [...PUBLIC, ...adminCommands] : PUBLIC);
    for (const language_code of ["", "en", "uk"] as const) {
      await ctx.api.setMyCommands(list, { scope: { type: "chat", chat_id: ctx.chat.id }, ...(language_code ? { language_code } : {}) });
    }
    await redis.set(cacheKey, signature, "EX", 3600);
  } catch (error) { console.warn("[Commands] Private menu update failed:", error instanceof Error ? error.message : error); }
}
