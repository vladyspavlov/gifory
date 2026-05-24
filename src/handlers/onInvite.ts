import { MyContext } from "../session.js";
import { getScope, isAdminOfScope, createInviteToken } from "../scopes.js";

export async function onInvite(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;

  if (!scopeId) {
    await ctx.reply(
      "Спочатку оберіть активну спільноту через /scopes або використовуйте команду у групі."
    );
    return;
  }

  const scope = await getScope(scopeId);
  if (!scope) {
    await ctx.reply("Спільноту не знайдено.");
    return;
  }

  if (scope.type === "group") {
    await ctx.reply(
      "Для групових спільнот запрошення не потрібні — достатньо додати бота до групи."
    );
    return;
  }

  const userId = ctx.from!.id;
  if (!(await isAdminOfScope(userId, scopeId))) {
    await ctx.reply("Тільки адміни можуть створювати запрошення.");
    return;
  }

  const token = await createInviteToken(scopeId);
  const botInfo = await ctx.api.getMe();

  await ctx.reply(
    `🔗 Запрошення до "${scope.name}":\n\n` +
    `https://t.me/${botInfo.username}?start=join_${token}\n\n` +
    `⏳ Дійсне 24 години.`
  );
}
