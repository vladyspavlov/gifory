import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { getScope, getScopeMembers } from "../scopes.js";
import { getUserProfiles, fetchAndCacheProfile, formatUserLink } from "../users.js";
import { promptScopeSelect } from "./onScopes.js";
import { canAdminScope } from "../access.js";
import { escapeHtml } from "../utils/html.js";
import { mapLimit } from "../utils/concurrency.js";

const PAGE_SIZE = 8;
async function membersPage(ctx: MyContext, scopeId: string, requestedPage: number): Promise<void> {
  if (!(await canAdminScope(ctx.api, ctx.from!.id, scopeId))) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: ctx.t("no_permissions"), show_alert: true });
    else await ctx.reply(ctx.t("no_permissions"));
    return;
  }
  const scope = await getScope(scopeId);
  if (!scope) return;
  const members = await getScopeMembers(scopeId);
  const admins = new Set(scope.admin_ids);
  const ids = [...scope.admin_ids, ...members.filter(id => !admins.has(id)).sort((a, b) => a - b)];
  const pageCount = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const pageIds = ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const profiles = await getUserProfiles(pageIds);
  await mapLimit(pageIds.filter(id => !profiles.has(id)), 4, async id => {
    const profile = await fetchAndCacheProfile(ctx.api, id, scope.type === "group" ? scopeId : undefined);
    if (profile) profiles.set(id, profile);
  });
  const lines = [ctx.t("members_header", { name: escapeHtml(scope.name.slice(0, 64)), count: ids.length })];
  for (const id of pageIds) {
    const user = formatUserLink(id, profiles.get(id) ?? null, ctx.t("user_fallback", { id }));
    lines.push(`${admins.has(id) ? "⭐" : "•"} ${user}`);
  }
  if (!ids.length) lines.push(ctx.t("members_empty"));
  if (scope.type === "group") lines.push(ctx.t("members_group_note"));
  const keyboard = new InlineKeyboard();
  if (page > 0) keyboard.text(ctx.t("tags_btn_back"), `members:page:${scopeId}:${page - 1}`);
  keyboard.text(`${page + 1}/${pageCount}`, "members:noop");
  if (page + 1 < pageCount) keyboard.text(ctx.t("tags_btn_forward"), `members:page:${scopeId}:${page + 1}`);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
  }
}
export async function onMembers(ctx: MyContext): Promise<void> {
  if (!ctx.currentScopeId) { await promptScopeSelect(ctx); return; }
  await membersPage(ctx, ctx.currentScopeId, 0);
}
export async function onMembersPageCallback(ctx: MyContext): Promise<void> {
  const match = ctx.callbackQuery?.data?.match(/^members:page:([^:]+):(\d+)$/);
  if (!match) { await ctx.answerCallbackQuery(); return; }
  await membersPage(ctx, match[1], Number(match[2]));
}
