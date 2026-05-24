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
      await ctx.editMessageText(ctx.t("changes_cancelled"));
      break;
    }

    case "gif:replace_tags": {
      ctx.session.state = "WAITING_TO_REPLACE_TAGS";
      const kb = new InlineKeyboard().text(ctx.t("gif_btn_cancel"), "gif:cancel");
      await ctx.editMessageText(ctx.t("enter_new_tags"), { reply_markup: kb });
      break;
    }

    case "gif:append_tags": {
      ctx.session.state = "WAITING_TO_APPEND_TAGS";
      const kb = new InlineKeyboard().text(ctx.t("gif_btn_cancel"), "gif:cancel");
      await ctx.editMessageText(ctx.t("enter_append_tags"), { reply_markup: kb });
      break;
    }

    case "gif:cancel": {
      ctx.session.state = "IDLE";
      ctx.session.pendingGifUniqueId = undefined;
      ctx.session.pendingFileId = undefined;
      ctx.session.pendingScopeId = undefined;
      await ctx.editMessageText(ctx.t("operation_cancelled"));
      break;
    }
  }

  await ctx.answerCallbackQuery();
}
