import { InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { createInviteToken } from "../scopes.js";
import { requireScope } from "../ui.js";
import { promptScopeSelect } from "./onScopes.js";
export async function onInvite(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) { await promptScopeSelect(ctx, "invite"); return; }
  const scope = await requireScope(ctx, scopeId, true);
  if (!scope) return;
  if (scope.type === "group") {
    await ctx.reply(ctx.t("invite_group_scope"), { reply_markup: new InlineKeyboard().url(ctx.t("btn_open"), `https://t.me/${ctx.me.username}?start=scope_${scopeId}`) }); return;
  }
  const token = await createInviteToken(scopeId, ctx.from!.id);
  await ctx.reply(ctx.t("invite_link", { name: scope.name, link: `https://t.me/${ctx.me.username}?start=join_${token}` }), {
    reply_markup: new InlineKeyboard().text(ctx.t("btn_invite"), `nav:invite:${scopeId}`).row().text(ctx.t("btn_manage"), `nav:manage:${scopeId}`),
  });
}
