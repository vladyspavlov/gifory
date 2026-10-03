import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import {
  getUserScopes,
  getScope,
  removeUserFromScope,
} from "../scopes.js";

/** `/leave` — pick a community to leave. Destructive, so it asks twice. */
export async function onLeave(ctx: MyContext): Promise<void> {
  const scopes = await getUserScopes(ctx.from!.id);

  if (scopes.length === 0) {
    await ctx.reply(ctx.t("scopes_none"));
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const scope of scopes) {
    keyboard.text(scope.name, `leave:ask:${scope.id}`).row();
  }

  await ctx.reply(ctx.t("leave_pick"), { reply_markup: keyboard });
}

export async function onLeaveCallback(ctx: MyContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const userId = ctx.from!.id;

  const askMatch = data.match(/^leave:ask:(.+)$/);
  const confirmMatch = data.match(/^leave:confirm:(.+)$/);

  if (data === "leave:cancel") {
    await ctx.editMessageText(ctx.t("operation_cancelled"));
    await ctx.answerCallbackQuery();
    return;
  }

  const scopeId = askMatch?.[1] ?? confirmMatch?.[1];
  if (!scopeId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const scope = await getScope(scopeId);
  if (!scope) {
    await ctx.editMessageText(ctx.t("scope_gone"));
    await ctx.answerCallbackQuery();
    return;
  }

  const scopes = await getUserScopes(userId);
  if (!scopes.some(memberScope => memberScope.id === scopeId)) {
    await ctx.answerCallbackQuery({ text: ctx.t("scope_gone"), show_alert: true });
    return;
  }

  if (askMatch) {
    // Refuse to orphan a community whose only admin is the person leaving
    if (scope.admin_ids.length === 1 && scope.admin_ids[0] === userId) {
      await ctx.editMessageText(ctx.t("leave_last_admin", { name: scope.name }));
      await ctx.answerCallbackQuery();
      return;
    }

    const keyboard = new InlineKeyboard()
      .text(ctx.t("leave_btn_confirm"), `leave:confirm:${scopeId}`)
      .text(ctx.t("gif_btn_cancel"), "leave:cancel");

    const prompt =
      scope.type === "group"
        ? ctx.t("leave_confirm_group", { name: scope.name })
        : ctx.t("leave_confirm", { name: scope.name });

    await ctx.editMessageText(prompt, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
    return;
  }

  const result = await removeUserFromScope(userId, scopeId);
  if (result !== "removed") {
    await ctx.editMessageText(ctx.t(result === "last_admin" ? "leave_last_admin" : "scope_gone", { name: scope.name }));
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.editMessageText(ctx.t("leave_success", { name: scope.name }));
  await ctx.answerCallbackQuery();
}
