import { NextFunction } from "grammy";
import { MyContext } from "../session.js";

export async function authMiddleware(
  _ctx: MyContext,
  next: NextFunction
): Promise<void> {
  await next();
}
