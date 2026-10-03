import { Bot } from "grammy";
import { MyContext } from "./session.js";
import { Lang, t } from "./i18n/index.js";
import { Messages } from "./i18n/en.js";

const LANGS: Lang[] = ["en", "uk"];

/** Commands every user can run. */
const PUBLIC: { command: string; key: keyof Messages }[] = [
  { command: "help",   key: "cmd_help" },
  { command: "scopes", key: "cmd_scopes" },
  { command: "tags",   key: "cmd_tags" },
  { command: "create", key: "cmd_create" },
  { command: "join",   key: "cmd_join" },
  { command: "leave",  key: "cmd_leave" },
  { command: "lang",   key: "cmd_lang" },
];

/** Additionally shown to chat administrators. */
const ADMIN: { command: string; key: keyof Messages }[] = [
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

      await bot.api.setMyCommands(render(lang, PUBLIC), opts);
      await bot.api.setMyCommands(render(lang, [...PUBLIC, ...ADMIN]), {
        ...opts,
        scope: { type: "all_chat_administrators" },
      });
    }
    console.log("[Commands] Menu published for locales: " + LANGS.join(", "));
  } catch (err) {
    console.error("[Commands] Failed to publish command menu:", err);
  }
}
