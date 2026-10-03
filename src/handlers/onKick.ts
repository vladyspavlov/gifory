import { MyContext } from "../session.js";
import { getScope, isMemberOfScope, removeUserFromScope } from "../scopes.js";
import { getUserProfile, formatUserLink } from "../users.js";
import { promptScopeSelect } from "./onScopes.js";
import { resolveTargetUser } from "../utils/target.js";

export async function onKick(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await promptScopeSelect(ctx);
    return;
  }

  const scope = await getScope(scopeId);
  if (!scope) return;

  if (scope.type !== "manual") {
    await ctx.reply(ctx.t("kick_manual_only"));
    return;
  }

  const targetId = await resolveTargetUser(ctx, scopeId);
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

  const result = await removeUserFromScope(targetId, scopeId, { actorId: ctx.from!.id, revokeInvites: true });
  if (result !== "removed") {
    await ctx.reply(ctx.t(result === "last_admin" ? "leave_last_admin" : "no_permissions", { name: scope.name }));
    return;
  }

  const profile = await getUserProfile(targetId);
  const userLink = formatUserLink(targetId, profile);
  await ctx.reply(ctx.t("kick_success", { user: userLink }), { parse_mode: "HTML" });
}
