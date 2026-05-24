import { Bot, Composer, NextFunction, session } from "grammy";
import { BOT_TOKEN } from "./config.js";
import {
  MyContext,
  SessionData,
  createRedisStorage,
  initialSessionData,
} from "./session.js";
import { createScope, getScope, syncGroupAdmins, addUserToScope } from "./scopes.js";
import { getUserLang, t } from "./i18n/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { isAdmin } from "./middleware/isAdmin.js";
import { onAnimation } from "./handlers/onAnimation.js";
import { onText } from "./handlers/onText.js";
import { onGifCallback } from "./handlers/onCallback.js";
import { onTags, onTagsPageCallback } from "./handlers/onTags.js";
import { onInline } from "./handlers/onInline.js";
import { onEdit } from "./handlers/onEdit.js";
import { onDelete } from "./handlers/onDelete.js";
import { onBackup } from "./handlers/onBackup.js";
import { onMyChatMember } from "./handlers/onMyChatMember.js";
import { onCreateScope } from "./handlers/onCreateScope.js";
import { onJoinScope } from "./handlers/onJoinScope.js";
import { onInvite } from "./handlers/onInvite.js";
import { onScopes, onScopeSetCallback } from "./handlers/onScopes.js";
import { onLang, onLangSetCallback } from "./handlers/onLang.js";
import { onHelp } from "./handlers/onHelp.js";
import { onKeyboardButton } from "./handlers/onKeyboardButton.js";
import { onChosenInlineResult } from "./handlers/onChosenInlineResult.js";
import { onStats } from "./handlers/onStats.js";
import { onMembers } from "./handlers/onMembers.js";
import { onKick } from "./handlers/onKick.js";
import { onPromote } from "./handlers/onPromote.js";
import { onRename } from "./handlers/onRename.js";
import { getMainKeyboard } from "./keyboard.js";
import { saveUserProfile } from "./users.js";

// ── Scope resolution middleware ─────────────────────────────────────────────
async function resolveScope(ctx: MyContext, next: NextFunction): Promise<void> {
  const chatType = ctx.chat?.type;

  if (chatType === "group" || chatType === "supergroup") {
    const chatId = String(ctx.chat!.id);
    ctx.currentScopeId = chatId;

    // Auto-create scope on first interaction in this group (one-time, no ongoing sync)
    if (!(await getScope(chatId))) {
      let adminIds: number[] = [];
      try {
        const admins = await ctx.getChatAdministrators();
        adminIds = admins.filter((m) => !m.user.is_bot).map((m) => m.user.id);
      } catch {}
      const title = "title" in ctx.chat! ? (ctx.chat as any).title ?? chatId : chatId;
      await createScope(chatId, title, "group", adminIds);
    }

    // Track user as scope member for inline search
    if (ctx.from) {
      addUserToScope(ctx.from.id, chatId).catch(() => {});
    }
  } else if (chatType === "private") {
    ctx.currentScopeId = ctx.session?.activeScopeId;
  }
  // inline_query and chosen_inline_result: no currentScopeId — handled per-handler

  await next();
}

// ── i18n middleware ──────────────────────────────────────────────────────────
async function i18nMiddleware(ctx: MyContext, next: NextFunction): Promise<void> {
  const lang = ctx.from
    ? await getUserLang(ctx.from.id, ctx.from.language_code)
    : "en";
  ctx.t = (key, params) => t(lang, key, params);
  await next();
}

export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(BOT_TOKEN);

  // ── 1. Global access check ────────────────────────────────────────────────
  bot.use(authMiddleware);

  // ── 2. Redis sessions ─────────────────────────────────────────────────────
  bot.use(session<SessionData, MyContext>({
    initial: initialSessionData,
    storage: createRedisStorage(),
  }));

  // ── 3. i18n (needs ctx.from, which is always present after session) ───────
  bot.use(i18nMiddleware);

  // ── 3b. Profile cache (fire-and-forget) ───────────────────────────────────
  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) {
      saveUserProfile({
        id: ctx.from.id,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
        username: ctx.from.username,
      }).catch(() => {});
    }
    await next();
  });

  // ── 4. Scope resolution (needs session to read activeScopeId) ─────────────
  bot.use(resolveScope);

  // ── 5. Group lifecycle ────────────────────────────────────────────────────
  bot.on("my_chat_member", onMyChatMember);

  // ── 6. Inline (public, no scope context needed) ───────────────────────────
  bot.on("inline_query", onInline);
  bot.on("chosen_inline_result", onChosenInlineResult);

  // ── 7. Public commands (all users) ───────────────────────────────────────
  bot.command("tags", onTags);
  bot.command("scopes", onScopes);
  bot.command("create", onCreateScope);
  bot.command("join", onJoinScope);
  bot.command("lang", onLang);
  bot.command("help", onHelp);
  // Deep-link: /start join_<token>
  bot.command("start", async (ctx) => {
    const payload = ctx.match;
    if (payload?.startsWith("join_")) {
      await onJoinScope(ctx);
    } else {
      await ctx.reply(ctx.t("start_welcome"), { reply_markup: getMainKeyboard(ctx.t) });
    }
  });
  bot.callbackQuery(/^tags:page:\d+$/, onTagsPageCallback);
  bot.callbackQuery("tags:noop", (ctx) => ctx.answerCallbackQuery());
  bot.callbackQuery(/^scope:set:/, onScopeSetCallback);
  bot.callbackQuery(/^lang:set:/, onLangSetCallback);

  // ── 8. Keyboard button handler (public, before admin gate) ───────────────
  bot.on("message:text", onKeyboardButton);

  // ── 9. Admin-only (isAdmin gate → adminComposer) ──────────────────────────
  const adminComposer = new Composer<MyContext>();
  adminComposer.on("message:animation", onAnimation);
  adminComposer.command("edit", onEdit);
  adminComposer.command("del", onDelete);
  adminComposer.command("backup", onBackup);
  adminComposer.command("invite", onInvite);
  adminComposer.command("stats", onStats);
  adminComposer.command("members", onMembers);
  adminComposer.command("kick", onKick);
  adminComposer.command("promote", onPromote);
  adminComposer.command("rename", onRename);
  adminComposer.command("syncadmins", async (ctx) => {
    const scopeId = ctx.currentScopeId;
    if (!scopeId) return;
    try {
      const admins = await ctx.getChatAdministrators();
      const adminIds = admins.filter((m) => !m.user.is_bot).map((m) => m.user.id);
      await syncGroupAdmins(scopeId, adminIds);
      await ctx.reply(ctx.t("syncadmins_success", { count: adminIds.length }));
    } catch {
      await ctx.reply(ctx.t("syncadmins_error"));
    }
  });
  adminComposer.callbackQuery(/^gif:/, onGifCallback);
  adminComposer.on("message:text", onText);

  bot.use(isAdmin, adminComposer);

  // ── 9. Global error handler ───────────────────────────────────────────────
  bot.catch((err) => {
    console.error("[Bot] Unhandled error:", err.message, err.error);
  });

  return bot;
}
