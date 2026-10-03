import type { MyContext } from "../session.js";
import { clearPendingOperation } from "../session.js";
import { createScope, generateScopeId, setActiveScopeId } from "../scopes.js";
import { commandArgument, inputPrompt, isPrivate, token } from "../ui.js";
import { showCommunity } from "./onScopes.js";
import { blockNewOperation } from "./onManagement.js";

export const MAX_SCOPE_NAME_LENGTH = 64;
export async function onCreateScope(ctx: MyContext): Promise<void> {
  if (!isPrivate(ctx)) { await ctx.reply(ctx.t("create_private_only")); return; }
  const creatingDestination = ctx.session.pendingIntent === "add" && !ctx.session.pendingScopeId && ctx.session.state === "IDLE";
  if (!creatingDestination && await blockNewOperation(ctx)) return;
  const queued = creatingDestination ? { uniqueId: ctx.session.pendingGifUniqueId, fileId: ctx.session.pendingFileId, caption: ctx.session.pendingCaption } : undefined;
  const name = ctx.callbackQuery ? "" : commandArgument(ctx);
  if (name) { await finishCreate(ctx, name); return; }
  clearPendingOperation(ctx.session);
  if (queued) {
    ctx.session.pendingGifUniqueId = queued.uniqueId;
    ctx.session.pendingFileId = queued.fileId;
    ctx.session.pendingCaption = queued.caption;
  }
  ctx.session.state = "WAITING_FOR_NAME";
  ctx.session.pendingNameAction = "create";
  ctx.session.pendingOperationId = token();
  await inputPrompt(ctx, ctx.t("create_needs_name", { max: MAX_SCOPE_NAME_LENGTH }));
}
export async function finishCreate(ctx: MyContext, name: string): Promise<void> {
  name = name.trim();
  if (Array.from(name).length > MAX_SCOPE_NAME_LENGTH) { await ctx.reply(ctx.t("scope_name_too_long", { max: MAX_SCOPE_NAME_LENGTH })); return; }
  if (!name.replace(/[\p{C}\p{Z}]/gu, "") || /[\p{C}]/u.test(name.replaceAll("\u200d", "").replaceAll("\u200c", ""))) { await ctx.reply(ctx.t("scope_name_invalid")); return; }
  const scopeId = generateScopeId();
  const queued = { uniqueId: ctx.session.pendingGifUniqueId, fileId: ctx.session.pendingFileId, caption: ctx.session.pendingCaption };
  await createScope(scopeId, name, "manual", [ctx.from!.id]);
  await setActiveScopeId(ctx.from!.id, scopeId);
  ctx.currentScopeId = scopeId;
  clearPendingOperation(ctx.session);
  await ctx.reply(ctx.t("create_success", { name }));
  await showCommunity(ctx, scopeId);
  if (queued.uniqueId && queued.fileId) {
    const { saveIncomingGif } = await import("./onAnimation.js");
    await saveIncomingGif(ctx, scopeId, queued.uniqueId, queued.fileId, queued.caption);
  }
  const { updatePrivateCommands } = await import("../commands.js");
  await updatePrivateCommands(ctx, true);
}
