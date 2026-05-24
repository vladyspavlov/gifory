import { NextFunction } from "grammy";
import { MyContext } from "../session.js";
import { ADMIN_IDS } from "../config.js";

/** Пропускає адмінів. Звичайним юзерам повертає повідомлення про відсутність прав */
export async function isAdmin(
  ctx: MyContext,
  next: NextFunction
): Promise<void> {
  if (ctx.from && ADMIN_IDS.includes(ctx.from.id)) {
    await next();
  } else {
    await ctx.reply(
      "У вас немає прав для додавання чи редагування гіфок. Ви можете лише шукати."
    );
  }
}