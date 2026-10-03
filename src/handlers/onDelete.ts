import type { MyContext } from "../session.js";
import { askConfirmation, blockNewOperation, showArchive } from "./onManagement.js";
import { promptScopeSelect } from "./onScopes.js";
export async function onDelete(ctx: MyContext): Promise<void> {
  if (await blockNewOperation(ctx)) return;
  if (!ctx.currentScopeId) { await promptScopeSelect(ctx, "manage"); return; }
  const gif = ctx.message?.reply_to_message?.animation;
  if (!gif) { await showArchive(ctx, ctx.currentScopeId); return; }
  await askConfirmation(ctx, { action: "delete", scopeId: ctx.currentScopeId, gifUniqueId: gif.file_unique_id });
}
