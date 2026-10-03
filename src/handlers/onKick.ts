import type { MyContext } from "../session.js";
import { resolveTargetUser } from "../utils/target.js";
import { askConfirmation, blockNewOperation } from "./onManagement.js";
import { onMembers } from "./onMembers.js";
import { promptScopeSelect } from "./onScopes.js";
export async function onKick(ctx: MyContext): Promise<void> {
  if (await blockNewOperation(ctx)) return;
  if (!ctx.currentScopeId) { await promptScopeSelect(ctx, "members"); return; }
  const id = await resolveTargetUser(ctx, ctx.currentScopeId);
  if (!id) { await onMembers(ctx); return; }
  await askConfirmation(ctx, { action: "kick", scopeId: ctx.currentScopeId, targetId: id });
}
