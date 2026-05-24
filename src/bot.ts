import { Bot, Composer, NextFunction, session } from "grammy";
import { BOT_TOKEN } from "./config.js";
import {
  MyContext,
  SessionData,
  createRedisStorage,
  initialSessionData,
} from "./session.js";
import { createScope, getScope, syncGroupAdmins, addUserToScope } from "./scopes.js";
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
    // Use the session's active scope for private chats
    ctx.currentScopeId = ctx.session?.activeScopeId;
  }
  // inline_query: no currentScopeId — merged search across user's scopes

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

  // ── 3. Scope resolution (needs session to read activeScopeId) ─────────────
  bot.use(resolveScope);

  // ── 4. Group lifecycle ────────────────────────────────────────────────────
  bot.on("my_chat_member", onMyChatMember);

  // ── 5. Public commands (all users) ───────────────────────────────────────
  bot.on("inline_query", onInline);
  bot.command("tags", onTags);
  bot.command("scopes", onScopes);
  bot.command("create", onCreateScope);
  bot.command("join", onJoinScope);
  // Deep-link: /start join_<token>
  bot.command("start", async (ctx) => {
    const payload = ctx.match;
    if (payload?.startsWith("join_")) {
      await onJoinScope(ctx);
    } else {
      await ctx.reply(
        "👋 Gifory — персональний архів гіфок.\n\n" +
        "Команди:\n" +
        "• /create <назва> — створити спільноту\n" +
        "• /scopes — ваші спільноти\n" +
        "• /tags — каталог тегів"
      );
    }
  });
  bot.callbackQuery(/^tags:page:\d+$/, onTagsPageCallback);
  bot.callbackQuery("tags:noop", (ctx) => ctx.answerCallbackQuery());
  bot.callbackQuery(/^scope:set:/, onScopeSetCallback);

  // ── 6. Admin-only (isAdmin gate → adminComposer) ──────────────────────────
  const adminComposer = new Composer<MyContext>();
  adminComposer.on("message:animation", onAnimation);
  adminComposer.command("edit", onEdit);
  adminComposer.command("del", onDelete);
  adminComposer.command("backup", onBackup);
  adminComposer.command("invite", onInvite);
  adminComposer.command("syncadmins", async (ctx) => {
    const scopeId = ctx.currentScopeId;
    if (!scopeId) return;
    try {
      const admins = await ctx.getChatAdministrators();
      const adminIds = admins.filter((m) => !m.user.is_bot).map((m) => m.user.id);
      await syncGroupAdmins(scopeId, adminIds);
      await ctx.reply(`✅ Адміни синхронізовані (${adminIds.length} осіб).`);
    } catch {
      await ctx.reply("❌ Не вдалося отримати список адмінів.");
    }
  });
  adminComposer.callbackQuery(/^gif:/, onGifCallback);
  adminComposer.on("message:text", onText);

  bot.use(isAdmin, adminComposer);

  // ── 7. Global error handler ───────────────────────────────────────────────
  bot.catch((err) => {
    console.error("[Bot] Unhandled error:", err.message, err.error);
  });

  return bot;
}
