import { MyContext } from "../session.js";
import { getScope, isMemberOfScope, removeUserFromScope, revokeAllInvites } from "../scopes.js";

function parseTargetUserId(ctx: MyContext): number | null {
  // Reply to a message → use that message's author
  const replyFrom = ctx.message?.reply_to_message?.from;
  if (replyFrom && !replyFrom.is_bot) return replyFrom.id;

  // Explicit argument: /kick 123456789
  const arg = ctx.message?.text?.split(/\s+/)[1];
  if (arg) {
    const id = Number(arg);
    if (!isNaN(id) && id > 0) return id;
  }

  return null;
}

export async function onKick(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply(ctx.t("select_scope"));
    return;
  }

  const scope = await getScope(scopeId);
  if (!scope) return;

  if (scope.type !== "manual") {
    await ctx.reply(ctx.t("kick_manual_only"));
    return;
  }

  const targetId = parseTargetUserId(ctx);
  if (!targetId) {
    await ctx.reply(ctx.t("kick_usage"));
    return;
  }

  if (targetId === ctx.from!.id) {
    await ctx.reply(ctx.t("kick_self"));
    return;
  }

  const isMember = await isMemberOfScope(targetId, scopeId);
  if (!isMember && !scope.admin_ids.includes(targetId)) {
    await ctx.reply(ctx.t("kick_not_member"));
    return;
  }

  await removeUserFromScope(targetId, scopeId);
  await revokeAllInvites(scopeId);

  await ctx.reply(ctx.t("kick_success"));
}
