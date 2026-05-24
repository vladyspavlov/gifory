import { Bot, Composer, session } from "grammy";
import { BOT_TOKEN } from "./config.js";
import {
  MyContext,
  SessionData,
  createRedisStorage,
  initialSessionData,
} from "./session.js";
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

export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(BOT_TOKEN);

  // ── 1. Глобальна перевірка доступу ───────────────────────────────────────
  bot.use(authMiddleware);

  // ── 2. Redis-сесії ────────────────────────────────────────────────────────
  bot.use(session<SessionData, MyContext>({
    initial: initialSessionData,
    storage: createRedisStorage(),
  }));

  // ── 3. Доступно всім дозволеним користувачам ─────────────────────────────
  bot.on("inline_query", onInline);
  bot.command("tags", onTags);
  bot.callbackQuery(/^tags:page:\d+$/, onTagsPageCallback);
  bot.callbackQuery("tags:noop", (ctx) => ctx.answerCallbackQuery());

  // ── 4. Тільки адміни (isAdmin gate → adminComposer) ──────────────────────
  //
  //  Як це працює в grammY:
  //   bot.use(m1, m2) — m1 запускається першим.
  //   Якщо m1 не викликає next() (юзер без прав) — m2 (adminComposer) не запускається.
  //   Якщо m1 викликає next() (адмін) — m2 маршрутизує апдейт до відповідного хендлера.
  //
  const adminComposer = new Composer<MyContext>();
  adminComposer.on("message:animation", onAnimation);
  adminComposer.command("edit", onEdit);
  adminComposer.command("del", onDelete);
  adminComposer.command("backup", onBackup);
  adminComposer.callbackQuery(/^gif:/, onGifCallback);
  // Текст — обов'язково після команд (grammY обробляє в порядку реєстрації)
  adminComposer.on("message:text", onText);

  bot.use(isAdmin, adminComposer);

  // ── 5. Глобальний обробник помилок ────────────────────────────────────────
  bot.catch((err) => {
    console.error("[Bot] Unhandled error:", err.message, err.error);
  });

  return bot;
}