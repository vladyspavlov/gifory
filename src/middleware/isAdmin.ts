import { NextFunction } from "grammy";
import { MyContext } from "../session.js";
import { isAdminOfScope } from "../scopes.js";

export async function isAdmin(ctx: MyContext, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  const scopeId = ctx.currentScopeId;

  if (userId && scopeId && (await isAdminOfScope(userId, scopeId))) {
    await next();
  } else {
    await ctx.reply(
      "У вас немає прав для додавання чи редагування гіфок. Ви можете лише шукати."
    );
  }
}
