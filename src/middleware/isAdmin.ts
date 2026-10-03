import type { NextFunction } from "grammy";
import type { MyContext, ScopeIntent } from "../session.js";
import { canAdminScope } from "../access.js";
import { promptScopeSelect } from "../handlers/onScopes.js";
import { requireScope } from "../ui.js";

export async function isAdmin(ctx: MyContext, next: NextFunction): Promise<void> {
  const scopeId = ctx.currentScopeId;
  const userId = ctx.from?.id;
  if (userId && scopeId && await canAdminScope(ctx.api, userId, scopeId)) { await next(); return; }
  if (!scopeId) {
    const command = ctx.message?.text?.match(/^\/(\w+)/)?.[1];
    const intent: ScopeIntent = command === "edit" || command === "del" ? "manage" : command === "kick" || command === "promote" ? "members" : command === "syncadmins" ? "manage" : command as ScopeIntent;
    await promptScopeSelect(ctx, intent || "manage"); return;
  }
  await requireScope(ctx, scopeId, true);
}
