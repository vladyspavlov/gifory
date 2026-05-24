import { MyContext } from "../session.js";
import { getScope, isMemberOfScope, promoteToAdmin } from "../scopes.js";
import { getUserProfile, formatUserLink } from "../users.js";

function parseTargetUserId(ctx: MyContext): number | null {
  const replyFrom = ctx.message?.reply_to_message?.from;
  if (replyFrom && !replyFrom.is_bot) return replyFrom.id;

  const arg = ctx.message?.text?.split(/\s+/)[1];
  if (arg) {
    const id = Number(arg);
    if (!isNaN(id) && id > 0) return id;
  }

  return null;
}

export async function onPromote(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply(ctx.t("select_scope"));
    return;
  }

  const scope = await getScope(scopeId);
  if (!scope) return;

  if (scope.type !== "manual") {
    await ctx.reply(ctx.t("promote_manual_only"));
    return;
  }

  const targetId = parseTargetUserId(ctx);
  if (!targetId) {
    await ctx.reply(ctx.t("promote_usage"));
    return;
  }

  if (targetId === ctx.from!.id) {
    await ctx.reply(ctx.t("promote_self"));
    return;
  }

  if (scope.admin_ids.includes(targetId)) {
    await ctx.reply(ctx.t("promote_already_admin"));
    return;
  }

  const isMember = await isMemberOfScope(targetId, scopeId);
  if (!isMember) {
    await ctx.reply(ctx.t("promote_not_member"));
    return;
  }

  await promoteToAdmin(targetId, scopeId);

  const profile = await getUserProfile(targetId);
  const userLink = formatUserLink(targetId, profile);
  await ctx.reply(ctx.t("promote_success", { user: userLink }), { parse_mode: "HTML" });
}
