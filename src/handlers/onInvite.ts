import { MyContext } from "../session.js";
import { getScope, isAdminOfScope, createInviteToken } from "../scopes.js";

export async function onInvite(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;

  if (!scopeId) {
    await ctx.reply(ctx.t("invite_needs_scope"));
    return;
  }

  const scope = await getScope(scopeId);
  if (!scope) {
    await ctx.reply(ctx.t("invite_not_found"));
    return;
  }

  if (scope.type === "group") {
    await ctx.reply(ctx.t("invite_group_scope"));
    return;
  }

  const userId = ctx.from!.id;
  if (!(await isAdminOfScope(userId, scopeId))) {
    await ctx.reply(ctx.t("invite_admin_only"));
    return;
  }

  const token = await createInviteToken(scopeId);
  const botInfo = await ctx.api.getMe();

  await ctx.reply(
    ctx.t("invite_link", {
      name: scope.name,
      link: `https://t.me/${botInfo.username}?start=join_${token}`,
    })
  );
}
