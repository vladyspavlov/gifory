import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { getAccessibleScopes } from "../access.js";
import { getActiveScopeId, setActiveScopeId } from "../scopes.js";

/** Inline keyboard listing the user's communities, active one marked. */
function buildScopeKeyboard(
  activeId: string | undefined,
  scopes: { id: string; name: string }[]
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const scope of scopes) {
    const label = scope.id === activeId ? `✅ ${scope.name}` : scope.name;
    keyboard.text(label, `scope:set:${scope.id}`).row();
  }
  return keyboard;
}

/**
 * Shows the community picker.
 * @param withActiveHeader when true, names the active community in the header
 *   (`/scopes`); when false, uses the neutral prompt (a handler needing a scope).
 */
async function showScopePicker(ctx: MyContext, withActiveHeader: boolean): Promise<void> {
  const userId = ctx.from!.id;
  const scopes = await getAccessibleScopes(ctx.api, userId);

  if (scopes.length === 0) {
    await ctx.reply(ctx.t("scopes_none"));
    return;
  }

  const activeId = await getActiveScopeId(userId);
  const keyboard = buildScopeKeyboard(activeId, scopes);

  const activeName = scopes.find((s) => s.id === activeId)?.name;
  const header =
    withActiveHeader && activeName
      ? ctx.t("scopes_header_active", { name: activeName })
      : ctx.t("scopes_header");

  await ctx.reply(header, { reply_markup: keyboard });
}

export async function onScopes(ctx: MyContext): Promise<void> {
  await showScopePicker(ctx, true);
}

/** Show the picker when a handler needs an active community and none is set. */
export async function promptScopeSelect(ctx: MyContext): Promise<void> {
  await showScopePicker(ctx, false);
}

export async function onScopeSetCallback(ctx: MyContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const scopeId = data.replace("scope:set:", "");
  const userId = ctx.from!.id;

  const scopes = await getAccessibleScopes(ctx.api, userId);
  const scope = scopes.find((s) => s.id === scopeId);

  // The user may have been removed from this community since the keyboard was sent
  if (!scope) {
    await ctx.editMessageText(ctx.t("scope_gone"));
    await ctx.answerCallbackQuery();
    return;
  }

  await setActiveScopeId(userId, scopeId);

  const searchKeyboard = new InlineKeyboard()
    .switchInlineCurrent(ctx.t("btn_search_gifs"), "");

  await ctx.editMessageText(ctx.t("scope_set_active", { name: scope.name }), {
    reply_markup: searchKeyboard,
  });
  await ctx.answerCallbackQuery();
}
