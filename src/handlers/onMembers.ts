import { InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { getScopeMembers } from "../scopes.js";
import { getUserProfiles, fetchAndCacheProfile, formatUserLink, getUserProfile } from "../users.js";
import { promptScopeSelect } from "./onScopes.js";
import { escapeHtml } from "../utils/html.js";
import { mapLimit } from "../utils/concurrency.js";
import { requireScope, clip, screen, isPrivate } from "../ui.js";
import { askConfirmation, blockNewOperation } from "./onManagement.js";
import { privateNavigation } from "./onHome.js";

const PAGE_SIZE = 8;
async function membersPage(ctx: MyContext, scopeId: string, requestedPage: number): Promise<void> {
  const scope = await requireScope(ctx, scopeId, true);
  if (!scope) return;
  const members = await getScopeMembers(scopeId);
  const admins = new Set(scope.admin_ids);
  const ids = [...scope.admin_ids, ...members.filter(id => !admins.has(id)).sort((a, b) => a - b)];
  const pages = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  const pageIds = ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const profiles = await getUserProfiles(pageIds);
  await mapLimit(pageIds.filter(id => !profiles.has(id)), 4, async id => {
    const profile = await fetchAndCacheProfile(ctx.api, id, scope.type === "group" ? scopeId : undefined);
    if (profile) profiles.set(id, profile);
  });
  const lines = [ctx.t("members_header", { name: escapeHtml(scope.name), count: ids.length })];
  const keyboard = new InlineKeyboard();
  for (const id of pageIds) {
    const profile = profiles.get(id) ?? null;
    lines.push(`${admins.has(id) ? "⭐" : "•"} ${formatUserLink(id, profile, ctx.t("user_fallback", { id }))}`);
    if (isPrivate(ctx)) {
      const name = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") : ctx.t("user_fallback", { id });
      keyboard.text(`${admins.has(id) ? "⭐ " : ""}${clip(name)}`, `member:open:${scopeId}:${id}`).row();
    }
  }
  if (!ids.length) lines.push(ctx.t("members_empty"));
  if (scope.type === "group") lines.push(ctx.t("members_group_note"));
  if (page > 0) keyboard.text(ctx.t("tags_btn_back"), `members:page:${scopeId}:${page - 1}`);
  keyboard.text(`${page + 1}/${pages}`, "members:noop");
  if (page + 1 < pages) keyboard.text(ctx.t("tags_btn_forward"), `members:page:${scopeId}:${page + 1}`);
  keyboard.row().text(ctx.t("btn_manage"), `nav:manage:${scopeId}`);
  if (ctx.callbackQuery?.message && "text" in ctx.callbackQuery.message) await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
  else await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
}
export async function onMembers(ctx: MyContext): Promise<void> {
  if (!ctx.currentScopeId) { await promptScopeSelect(ctx, "members"); return; }
  await membersPage(ctx, ctx.currentScopeId, 0);
}
export async function onMembersPageCallback(ctx: MyContext): Promise<void> {
  const match = ctx.callbackQuery?.data?.match(/^members:page:([^:]+):(\d+)$/);
  if (match) await membersPage(ctx, match[1], Number(match[2]));
  await ctx.answerCallbackQuery();
}
export async function onMemberCallback(ctx: MyContext): Promise<void> {
  if (!isPrivate(ctx)) { await privateNavigation(ctx); await ctx.answerCallbackQuery(); return; }
  const match = ctx.callbackQuery?.data?.match(/^member:(open|kick|promote|demote|handover):([^:]+):(\d+)$/);
  if (!match) { await ctx.answerCallbackQuery(); return; }
  const scope = await requireScope(ctx, match[2], true);
  if (!scope) { await ctx.answerCallbackQuery(); return; }
  const id = Number(match[3]);
  const members = await getScopeMembers(scope.id);
  if (!members.includes(id) && !scope.admin_ids.includes(id)) { await ctx.answerCallbackQuery({ text: ctx.t("scope_gone"), show_alert: true }); return; }
  if (match[1] !== "open") {
    if (!(await blockNewOperation(ctx))) await askConfirmation(ctx, { action: match[1] as "kick" | "promote" | "demote" | "handover", scopeId: scope.id, targetId: id });
    await ctx.answerCallbackQuery(); return;
  }
  const profile = await getUserProfile(id);
  const user = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") : ctx.t("user_fallback", { id });
  const admin = scope.admin_ids.includes(id);
  const keyboard = new InlineKeyboard();
  if (scope.type === "manual") {
    if (!admin) keyboard.text(ctx.t("btn_promote"), `member:promote:${scope.id}:${id}`).row();
    else if (scope.admin_ids.length > 1) keyboard.text(ctx.t("btn_demote"), `member:demote:${scope.id}:${id}`).row();
    if (id !== ctx.from!.id) keyboard.text(ctx.t("btn_handover"), `member:handover:${scope.id}:${id}`).row().text(ctx.t("btn_kick"), `member:kick:${scope.id}:${id}`).row();
  }
  keyboard.text(ctx.t("btn_members"), `nav:members:${scope.id}`).row().text(ctx.t("btn_manage"), `nav:manage:${scope.id}`);
  await screen(ctx, ctx.t("member_card", { user, name: scope.name, role: ctx.t(admin ? "role_admin" : "role_member") }) + (scope.type === "group" ? "\n\n" + ctx.t("group_roles") : ""), keyboard);
  await ctx.answerCallbackQuery();
}
