import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { getUserScopes } from "../scopes.js";

export async function onScopes(ctx: MyContext): Promise<void> {
  const userId = ctx.from!.id;
  const scopes = await getUserScopes(userId);

  if (scopes.length === 0) {
    await ctx.reply(
      "У вас немає жодної спільноти.\n\n" +
      "• /create <назва> — створити нову\n" +
      "• Або додайте бота до своєї групи"
    );
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
    ? `📋 Ваші спільноти (активна: ${activeName}):`
    : `📋 Ваші спільноти — оберіть активну:`;

  await ctx.reply(header, { reply_markup: keyboard });
}

export async function onScopeSetCallback(ctx: MyContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const scopeId = data.replace("scope:set:", "");

  ctx.session.activeScopeId = scopeId;

  const scopes = await getUserScopes(ctx.from!.id);
  const scope = scopes.find((s) => s.id === scopeId);

  await ctx.editMessageText(
    scope
      ? `✅ Активна спільнота: ${scope.name}`
      : "✅ Спільноту обрано."
  );
  await ctx.answerCallbackQuery();
}
