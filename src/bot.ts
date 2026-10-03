import { Bot, Composer, NextFunction, session } from "grammy";
import { withStateLock } from "./state.js";
import { BOT_TOKEN } from "./config.js";
import {
  MyContext,
  SessionData,
  createRedisStorage,
  initialSessionData,
  getSessionKey,
} from "./session.js";
import {
  createScope,
  getScope,
  syncGroupAdmins,
  addUserToScope,
  getActiveScopeId,
  setActiveScopeId,
  renameScope,
} from "./scopes.js";
import { getScopeAccess, ScopeVerificationError } from "./access.js";
import { onChatMember } from "./handlers/onChatMember.js";
import { getUserLang, t } from "./i18n/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { isAdmin } from "./middleware/isAdmin.js";
import { onAdd, onAnimation } from "./handlers/onAnimation.js";
import { onText } from "./handlers/onText.js";
import { onGifCallback } from "./handlers/onCallback.js";
import { onTags, onTagsPageCallback } from "./handlers/onTags.js";
import { onInline } from "./handlers/onInline.js";
import { onEdit } from "./handlers/onEdit.js";
import { onDelete } from "./handlers/onDelete.js";
import { onBackup } from "./handlers/onBackup.js";
import { onMyChatMember } from "./handlers/onMyChatMember.js";
import { onCreateScope } from "./handlers/onCreateScope.js";
import { onJoinScope, onDirectJoinScope } from "./handlers/onJoinScope.js";
import { onLeave, onLeaveCallback } from "./handlers/onLeave.js";
import { onInvite } from "./handlers/onInvite.js";
import { onScopes, onScopeSetCallback, onScopePickCallback } from "./handlers/onScopes.js";
import { onLang, onLangSetCallback } from "./handlers/onLang.js";
import { onHelp, onHelpTopic } from "./handlers/onHelp.js";
import { onKeyboardButton } from "./handlers/onKeyboardButton.js";
import { onChosenInlineResult } from "./handlers/onChosenInlineResult.js";
import { onStats } from "./handlers/onStats.js";
import { onMembers, onMembersPageCallback, onMemberCallback } from "./handlers/onMembers.js";
import { onKick } from "./handlers/onKick.js";
import { onPromote } from "./handlers/onPromote.js";
import { onRename } from "./handlers/onRename.js";
import { onHome, onSearch, onSettings, onCancel } from "./handlers/onHome.js";
import { onNavigation, onManage } from "./handlers/onNavigation.js";
import { onArchiveCallback, onConfirmCallback, blockNewOperation } from "./handlers/onManagement.js";
import { pauseForNavigation, isPrivate, replyScope } from "./ui.js";
import { InlineKeyboard } from "grammy";
import { saveUserProfile } from "./users.js";
import { trackUser } from "./analytics.js";
import { onBotStats } from "./handlers/onBotStats.js";

// ── Scope resolution middleware ─────────────────────────────────────────────
async function resolveScope(ctx: MyContext, next: NextFunction): Promise<void> {
  if (ctx.chatMember || ctx.myChatMember) { await next(); return; }
  const chatType = ctx.chat?.type;

  if (chatType === "group" || chatType === "supergroup") {
    const chatId = String(ctx.chat!.id);
    ctx.currentScopeId = chatId;

    // Auto-create scope on first interaction in this group (one-time, no ongoing sync)
    if (!(await getScope(chatId))) {
      const admins = await ctx.getChatAdministrators();
      const adminIds = admins.filter((m) => !m.user.is_bot).map((m) => m.user.id);
      const title = "title" in ctx.chat! ? (ctx.chat as any).title ?? chatId : chatId;
      await createScope(chatId, title, "group", adminIds);
    }

    const existingScope = await getScope(chatId);
    if (existingScope && "title" in ctx.chat! && existingScope.name !== ctx.chat!.title) await renameScope(chatId, (ctx.chat as { title: string }).title);

    // Track user as scope member for inline search
    if (ctx.from && !ctx.chatMember && !ctx.myChatMember && !ctx.from.is_bot && !ctx.message?.sender_chat) {
      await addUserToScope(ctx.from.id, chatId);
    }
  } else if (chatType === "private" && ctx.from) {
    let active = await getActiveScopeId(ctx.from.id);

    // Migrate sessions written before the active scope moved out of the session
    if (!active && ctx.session?.activeScopeId) {
      active = ctx.session.activeScopeId;
      await setActiveScopeId(ctx.from.id, active);
    }
    ctx.session.activeScopeId = undefined;

    // Drop a stale pointer to a community the user has since left
    if (active) {
      const scope = await getScope(active);
      const status = scope ? await getScopeAccess(ctx.api, ctx.from.id, scope) : "denied";
      // Keep the pointer on uncertain verification. Each scoped action checks access again.
      if (status === "denied") active = undefined;
    }

    ctx.currentScopeId = active;
  }
  // inline_query and chosen_inline_result: no currentScopeId — handled per-handler
  if (/^\/(?:edit|del)(?:@\w+)?(?:\s|$)/.test(ctx.message?.text ?? "")) {
    ctx.currentScopeId = await replyScope(ctx) ?? ctx.currentScopeId;
  }

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
  const bot = new Bot<MyContext>(BOT_TOKEN, { client: { timeoutSeconds: 60 } });

  // ── 1. Global access check ────────────────────────────────────────────────
  bot.use((_ctx, next) => withStateLock(next));
  bot.use(authMiddleware);

  // ── 2. Redis sessions ─────────────────────────────────────────────────────
  bot.use(session<SessionData, MyContext>({
    initial: initialSessionData,
    storage: createRedisStorage(),
    getSessionKey,
  }));

  // ── 3. i18n (needs ctx.from, which is always present after session) ───────
  bot.use(i18nMiddleware);

  // ── 3b. Profile cache (awaited for coordinated snapshots) ───────────────────────────────────
  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) {
      await saveUserProfile({
        id: ctx.from.id,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
        username: ctx.from.username,
      }).catch(() => {});
      await trackUser(ctx.from.id).catch(() => {});
    }
    await next();
  });

  // ── 4. Scope resolution (needs session to read activeScopeId) ─────────────
  bot.use(resolveScope);

  // ── 5. Group lifecycle ────────────────────────────────────────────────────
  bot.on("my_chat_member", onMyChatMember);
  bot.on("chat_member", onChatMember);

  // ── 6. Inline (public, no scope context needed) ───────────────────────────
  bot.on("inline_query", onInline);
  bot.on("chosen_inline_result", onChosenInlineResult);

  // Navigation pauses pending input while retaining its captured destination.
  bot.use(async (ctx, next) => {
    const command = ctx.message?.text?.match(/^\/(\w+)(?:@\w+)?(?:\s|$)/)?.[1];
    if (command && ["start", "home", "help", "search", "scopes", "tags", "settings", "lang", "join", "backup", "stats", "invite", "members", "manage", "syncadmins"].includes(command)) await pauseForNavigation(ctx);
    if (command && ["add", "edit", "del", "kick", "promote"].includes(command) && await blockNewOperation(ctx)) return;
    if (/^(help:|members:page:|member:open:|archive:open:|tags:page:|lang:set:|scope:set:)/.test(ctx.callbackQuery?.data ?? "")) await pauseForNavigation(ctx);
    await next();
  });

  // ── 7. Public commands (all users) ───────────────────────────────────────
  bot.command("home", onHome);
  bot.command("search", onSearch);
  bot.command("settings", onSettings);
  bot.command("cancel", onCancel);
  bot.command("tags", onTags);
  bot.command("botstats", onBotStats);
  bot.command("scopes", onScopes);
  bot.command("create", onCreateScope);
  bot.command("join", onJoinScope);
  bot.command("leave", onLeave);
  bot.command("lang", onLang);
  bot.command("help", onHelp);
  // Deep-link: /start join_<token>
  bot.command("start", async (ctx) => {
    const payload = ctx.match;
    if (payload?.startsWith("join_")) {
      await onJoinScope(ctx);
    } else if (payload?.startsWith("scope_")) {
      await onDirectJoinScope(ctx, payload.slice(6));
    } else {
      if (payload === "communities") await onScopes(ctx);
      else if (payload === "search") await onSearch(ctx);
      else if (payload?.startsWith("backup_")) {
        ctx.currentScopeId = payload.slice(7);
        await onBackup(ctx);
      } else await onHome(ctx);
    }
  });
  bot.callbackQuery(/^tags:page:/, onTagsPageCallback);
  bot.callbackQuery(/^nav:/, onNavigation);
  bot.callbackQuery(/^pick(?:page)?:/, onScopePickCallback);
  bot.callbackQuery(/^help:/, onHelpTopic);
  bot.callbackQuery(/^archive:/, onArchiveCallback);
  bot.callbackQuery(/^member:/, onMemberCallback);
  bot.callbackQuery(/^confirm:/, onConfirmCallback);
  bot.callbackQuery("tags:noop", (ctx) => ctx.answerCallbackQuery());
  bot.callbackQuery(/^scope:set:/, onScopeSetCallback);
  bot.callbackQuery(/^leave:/, onLeaveCallback);
  bot.callbackQuery(/^lang:set:/, onLangSetCallback);
  // Pending operations authorize their captured scope, independently of the active one.
  bot.callbackQuery(/^gif:/, onGifCallback);
  bot.callbackQuery(/^members:page:/, onMembersPageCallback);
  bot.callbackQuery("members:noop", ctx => ctx.answerCallbackQuery());

  // ── 8. Keyboard button handler (public, before admin gate) ───────────────
  bot.on("message:text", onKeyboardButton);
  bot.on("message:text", async (ctx, next) => {
    if ((ctx.session.state !== "IDLE" || ctx.session.pendingIntent || ctx.session.confirmation) && !ctx.message.text.startsWith("/")) {
      await onText(ctx);
    } else {
      await next();
    }
  });

  // Upload authorization happens in the handler so an incoming GIF can resume after selection.
  bot.on("message:animation", onAnimation);
  const ADMIN_COMMANDS = new Set(["add", "manage", "edit", "del", "backup", "invite", "stats", "members", "kick", "promote", "rename", "syncadmins"]);
  bot.use(async (ctx, next) => {
    if (!ctx.message) { await next(); return; }
    const command = ctx.message.text?.match(/^\/(\w+)/)?.[1];
    if (command && ADMIN_COMMANDS.has(command)) { await next(); return; }
    if (ctx.message.text) { await onText(ctx); return; }
    if (isPrivate(ctx) || (ctx.session.state !== "IDLE" && ctx.message.reply_to_message?.message_id === ctx.session.pendingMessageId)) {
      await ctx.reply(ctx.t("unsupported_media"), { reply_markup: new InlineKeyboard().text(ctx.t("btn_communities"), "nav:scopes").row().text(ctx.t("btn_resume"), "nav:resume") });
    }
  });

  // ── 9. Admin-only (isAdmin gate → adminComposer) ──────────────────────────
  const adminComposer = new Composer<MyContext>();
  adminComposer.command("add", onAdd);
  adminComposer.command("manage", onManage);
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
      if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
        await ctx.reply(ctx.t("syncadmins_error"));
        return;
      }
      const admins = await ctx.getChatAdministrators();
      const adminIds = admins.filter((m) => !m.user.is_bot).map((m) => m.user.id);
      await syncGroupAdmins(scopeId, adminIds);
      await ctx.reply(ctx.t("syncadmins_success", { count: adminIds.length }));
    } catch {
      await ctx.reply(ctx.t("syncadmins_error"));
    }
  });
  adminComposer.on("message:text", onText);

  bot.use(isAdmin, adminComposer);

  // ── 9. Global error handler ───────────────────────────────────────────────
  // Without a reply here, a failed handler leaves the user staring at silence.
  bot.catch(async (err) => {
    console.error("[Bot] Unhandled error:", err.message, err.error);

    const ctx = err.ctx;
    // ctx.t is missing if the failure happened before the i18n middleware ran
    const key = err.error instanceof ScopeVerificationError ? "access_unavailable" : "error_generic";
    const message = ctx.t ? ctx.t(key) : t("en", key);

    try {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: message });
      } else if (ctx.inlineQuery) {
        await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true, button: { text: message.slice(0, 64), start_parameter: "search" } });
      } else if (ctx.chat) {
        await ctx.reply(message, { reply_markup: new InlineKeyboard().text(ctx.t ? ctx.t("btn_retry") : t("en", "btn_retry"), "nav:home") });
      }
    } catch (replyErr) {
      console.error("[Bot] Failed to notify user of error:", replyErr);
    }
  });

  return bot;
}
