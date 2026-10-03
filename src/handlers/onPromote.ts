import { MyContext } from "../session.js";
import { getScope, isMemberOfScope, promoteToAdmin } from "../scopes.js";
import { getUserProfile, formatUserLink } from "../users.js";
import { promptScopeSelect } from "./onScopes.js";
import { resolveTargetUser } from "../utils/target.js";

export async function onPromote(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await promptScopeSelect(ctx);
    return;
  }

  const scope = await getScope(scopeId);
  if (!scope) return;

  if (scope.type !== "manual") {
    await ctx.reply(ctx.t("promote_manual_only"));
    return;
  }

  const targetId = await resolveTargetUser(ctx, scopeId);
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

  if (!(await promoteToAdmin(targetId, scopeId, ctx.from!.id))) {
    await ctx.reply(ctx.t("error_generic"));
    return;
  }

  const profile = await getUserProfile(targetId);
  const userLink = formatUserLink(targetId, profile);
  await ctx.reply(ctx.t("promote_success", { user: userLink }), { parse_mode: "HTML" });
}
