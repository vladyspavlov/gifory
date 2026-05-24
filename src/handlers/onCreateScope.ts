import { MyContext } from "../session.js";
import { createScope, generateScopeId } from "../scopes.js";

export async function onCreateScope(ctx: MyContext): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Команда /create доступна лише в особистих повідомленнях.");
    return;
  }

  const text = ctx.message?.text ?? "";
  const name = text.replace(/^\/create\s*/i, "").trim();

  if (!name) {
    await ctx.reply("Вкажіть назву спільноти: /create МоєСпільнота");
    return;
  }

  const userId = ctx.from!.id;
  const scopeId = generateScopeId();

  await createScope(scopeId, name, "manual", [userId]);

  ctx.session.activeScopeId = scopeId;

  await ctx.reply(
    `✅ Спільноту "${name}" створено!\n\n` +
    `Команди:\n` +
    `• /invite — запросити учасників\n` +
    `• /scopes — ваші спільноти\n` +
    `• /backup — резервна копія`
  );
}
