import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";

export async function onGifCallback(ctx: MyContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";

  switch (data) {
    case "gif:no_changes": {
      ctx.session.state = "IDLE";
      ctx.session.pendingGifUniqueId = undefined;
      ctx.session.pendingFileId = undefined;
      ctx.session.pendingScopeId = undefined;
      await ctx.editMessageText("🚫 Зміни відмінено.");
      break;
    }

    case "gif:replace_tags": {
      ctx.session.state = "WAITING_TO_REPLACE_TAGS";
      const kb = new InlineKeyboard().text("❌ Скасувати", "gif:cancel");
      await ctx.editMessageText(
        "✏️ Введіть нові теги та емоджі (старі буде повністю замінено):",
        { reply_markup: kb }
      );
      break;
    }

    case "gif:append_tags": {
      ctx.session.state = "WAITING_TO_APPEND_TAGS";
      const kb = new InlineKeyboard().text("❌ Скасувати", "gif:cancel");
      await ctx.editMessageText(
        "➕ Введіть теги та емоджі для додавання до існуючих:",
        { reply_markup: kb }
      );
      break;
    }

    case "gif:cancel": {
      ctx.session.state = "IDLE";
      ctx.session.pendingGifUniqueId = undefined;
      ctx.session.pendingFileId = undefined;
      ctx.session.pendingScopeId = undefined;
      await ctx.editMessageText("🚫 Операцію відмінено.");
      break;
    }
  }

  await ctx.answerCallbackQuery();
}
