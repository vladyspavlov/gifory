import { NextFunction } from "grammy";
import { MyContext } from "../session.js";
import { ADMIN_IDS /*, USER_IDS */ } from "../config.js";

/** Мовчки ігнорує всіх, хто не в ADMIN_IDS і не в USER_IDS */
export async function authMiddleware(
  ctx: MyContext,
  next: NextFunction
): Promise<void> {
  // const userId = ctx.from?.id;
  // if (!userId) return;

  // if (ADMIN_IDS.includes(userId) || USER_IDS.includes(userId)) {
    await next();
  // }
}
