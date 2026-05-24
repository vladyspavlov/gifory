import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { getUserScopes } from "../scopes.js";

export async function onScopes(ctx: MyContext): Promise<void> {
  const userId = ctx.from!.id;
  const scopes = await getUserScopes(userId);

  if (scopes.length === 0) {
    await ctx.reply(ctx.t("scopes_none"));
    return;
  }

  const activeId = ctx.session.activeScopeId;
  const keyboard = new InlineKeyboard();

  for (const scope of scopes) {
    const isActive = scope.id === activeId;
    const label = isActive ? `✅ ${scope.name}` : scope.name;
    keyboard.text(label, `scope:set:${scope.id}`).row();
  }

  const activeName = scopes.find((s) => s.id === activeId)?.name;
  const header = activeName
    ? ctx.t("scopes_header_active", { name: activeName })
    : ctx.t("scopes_header");

  await ctx.reply(header, { reply_markup: keyboard });
}

/** Show the scope picker, or the "no communities" message if none exist. */
export async function promptScopeSelect(ctx: MyContext): Promise<void> {
  const userId = ctx.from!.id;
  const scopes = await getUserScopes(userId);

  if (scopes.length === 0) {
    await ctx.reply(ctx.t("scopes_none"));
    return;
  }

  const activeId = ctx.session.activeScopeId;
  const keyboard = new InlineKeyboard();

  for (const scope of scopes) {
    const isActive = scope.id === activeId;
    const label = isActive ? `✅ ${scope.name}` : scope.name;
    keyboard.text(label, `scope:set:${scope.id}`).row();
  }

  await ctx.reply(ctx.t("scopes_header"), { reply_markup: keyboard });
}

export async function onScopeSetCallback(ctx: MyContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const scopeId = data.replace("scope:set:", "");

  ctx.session.activeScopeId = scopeId;

  const scopes = await getUserScopes(ctx.from!.id);
  const scope = scopes.find((s) => s.id === scopeId);

  const searchKeyboard = new InlineKeyboard()
    .switchInlineCurrent(ctx.t("btn_search_gifs"), "");

  await ctx.editMessageText(
    scope
      ? ctx.t("scope_set_active", { name: scope.name })
      : ctx.t("scope_set"),
    { reply_markup: searchKeyboard }
  );
  await ctx.answerCallbackQuery();
}
