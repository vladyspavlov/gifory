import { MyContext } from "../session.js";
import { getScope, getScopeMembers } from "../scopes.js";
import { getUserProfiles, formatUserLink } from "../users.js";

export async function onMembers(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply(ctx.t("select_scope"));
    return;
  }

  const scope = await getScope(scopeId);
  if (!scope) return;

  const allMembers = await getScopeMembers(scopeId);
  const adminSet = new Set(scope.admin_ids);
  const regularMembers = allMembers.filter((id) => !adminSet.has(id));

  const allIds = [...new Set([...scope.admin_ids, ...allMembers])];
  const total = allIds.length;

  if (total === 0) {
    await ctx.reply(ctx.t("members_empty"));
    return;
  }

  const profiles = await getUserProfiles(allIds);

  const lines: string[] = [ctx.t("members_header", { name: scope.name, count: total })];

  if (scope.admin_ids.length > 0) {
    lines.push("");
    lines.push(ctx.t("members_admins"));
    for (const id of scope.admin_ids) {
      lines.push(`• ${formatUserLink(id, profiles.get(id) ?? null)}`);
    }
  }

  if (regularMembers.length > 0) {
    lines.push("");
    lines.push(ctx.t("members_users"));
    for (const id of regularMembers) {
      lines.push(`• ${formatUserLink(id, profiles.get(id) ?? null)}`);
    }
  }

  if (scope.type === "group") {
    lines.push("");
    lines.push(ctx.t("members_group_note"));
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
