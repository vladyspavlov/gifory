import { InlineKeyboard } from "grammy";
import type { MyContext, ScopeIntent } from "../session.js";
import { getAccessibleScopes, canAdminScope } from "../access.js";
import { getActiveScopeId, setActiveScopeId } from "../scopes.js";
import { getArchivePage } from "../meili.js";
import { clip, FLOW_TTL, isPrivate, screen, searchButtons, scopeQuery, token, requireScope, pendingAlive } from "../ui.js";
import { entryButtons, privateNavigation } from "./onHome.js";
import { updatePrivateCommands } from "../commands.js";

const PAGE_SIZE = 6;
export async function showScopePicker(ctx: MyContext, page = 0, intent?: ScopeIntent): Promise<void> {
  if (!isPrivate(ctx)) { await privateNavigation(ctx); return; }
  let scopes = await getAccessibleScopes(ctx.api, ctx.from!.id);
  const activeId = await getActiveScopeId(ctx.from!.id);
  const roles = new Map<string, boolean>();
  for (const scope of scopes) roles.set(scope.id, await canAdminScope(ctx.api, ctx.from!.id, scope.id));
  if (intent && intent !== "tags") scopes = scopes.filter(scope => roles.get(scope.id));
  scopes.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  if (!scopes.length) {
    if (intent) {
      ctx.session.pendingIntent = intent;
      ctx.session.pendingSelectionExpiresAt = Date.now() + FLOW_TTL;
    }
    const keyboard = entryButtons(ctx);
    if (intent) keyboard.row().text(ctx.t("gif_btn_cancel"), "nav:cancel");
    await screen(ctx, ctx.t(intent && intent !== "tags" ? "no_admin_scopes" : "scopes_none"), keyboard.row().text(ctx.t("btn_home"), "nav:home")); return;
  }
  const pageCount = Math.ceil(scopes.length / PAGE_SIZE);
  page = Math.min(Math.max(0, page), pageCount - 1);
  const keyboard = new InlineKeyboard();
  const selectionToken = intent ? ctx.session.pendingSelectionToken ?? token() : undefined;
  if (intent) {
    ctx.session.pendingIntent = intent;
    ctx.session.pendingSelectionToken = selectionToken;
    ctx.session.pendingSelectionExpiresAt = Date.now() + FLOW_TTL;
  }
  for (const scope of scopes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const duplicate = scopes.filter(other => other.name === scope.name).length > 1;
    const label = `${scope.id === activeId ? "✅ " : ""}${clip(scope.name, 24)} · ${ctx.t(roles.get(scope.id) ? "role_admin" : "role_member")} · ${ctx.t(scope.type === "group" ? "scope_type_group_short" : "scope_type_manual_short")}${duplicate ? ` (${scope.id.slice(-6)})` : ""}`;
    keyboard.text(label, intent ? `pick:${selectionToken}:${scope.id}` : `nav:open:${scope.id}`).row();
  }
  if (page > 0) keyboard.text(ctx.t("tags_btn_back"), intent ? `pickpage:${selectionToken}:${page - 1}` : `nav:scopes:${page - 1}`);
  if (page + 1 < pageCount) keyboard.text(ctx.t("tags_btn_forward"), intent ? `pickpage:${selectionToken}:${page + 1}` : `nav:scopes:${page + 1}`);
  keyboard.row();
  if (intent) keyboard.text(ctx.t("gif_btn_cancel"), "nav:cancel").row();
  else keyboard.text(ctx.t("btn_create"), "nav:create").row().text(ctx.t("btn_join_help"), "nav:join").row();
  keyboard.text(ctx.t("btn_home"), "nav:home");
  const text = ctx.t(intent && intent !== "tags" ? "select_destination" : "scopes_header", { page: page + 1, total: pageCount });
  // Pending action pickers are new messages, bound to this user's operation.
  if (intent) {
    const message = await ctx.reply(text, { reply_markup: keyboard });
    ctx.session.pendingSelectionMessageId = message.message_id;
  } else await screen(ctx, text, keyboard);
}

export async function onScopes(ctx: MyContext): Promise<void> { await showScopePicker(ctx); }
export async function promptScopeSelect(ctx: MyContext, intent?: ScopeIntent): Promise<void> { await showScopePicker(ctx, 0, intent); }

export async function showCommunity(ctx: MyContext, scopeId: string): Promise<void> {
  if (!isPrivate(ctx)) { await privateNavigation(ctx); return; }
  const scope = await requireScope(ctx, scopeId);
  if (!scope) return;
  const admin = await canAdminScope(ctx.api, ctx.from!.id, scopeId);
  const { total } = await getArchivePage(scopeId);
  const activeId = await getActiveScopeId(ctx.from!.id);
  let text = ctx.t("community_card", { name: scope.name, type: ctx.t(scope.type === "group" ? "scope_type_group" : "scope_type_manual"), role: ctx.t(admin ? "role_admin" : "role_member"), count: total, access: ctx.t(admin ? "community_admin_note" : "community_member_note") });
  if (!total && admin) text += "\n\n" + ctx.t("community_empty_admin");
  text += "\n\n" + ctx.t("community_id", { id: scopeId });
  if (activeId === scopeId) text += "\n" + ctx.t("destination_note", { name: scope.name });
  const keyboard = searchButtons(ctx, scopeQuery(scopeId), ctx.t("btn_search_scope")).row().text(ctx.t("btn_tags"), `nav:tags:${scopeId}`);
  if (admin) keyboard.row().text(ctx.t("btn_add"), `nav:add:${scopeId}`).text(ctx.t("btn_manage"), `nav:manage:${scopeId}`);
  if (activeId !== scopeId) keyboard.row().text(ctx.t("btn_destination"), `nav:destination:${scopeId}`);
  keyboard.row().text(ctx.t("btn_leave"), `leave:ask:${scopeId}`).row().text(ctx.t("btn_communities"), "nav:scopes").text(ctx.t("btn_home"), "nav:home");
  await screen(ctx, text, keyboard);
}

/** Compatibility for old active-community keyboards. */
export async function onScopeSetCallback(ctx: MyContext): Promise<void> {
  const scopeId = ctx.callbackQuery!.data!.slice("scope:set:".length);
  if (!isPrivate(ctx)) { await privateNavigation(ctx); await ctx.answerCallbackQuery(); return; }
  if (await requireScope(ctx, scopeId)) {
    await setActiveScopeId(ctx.from!.id, scopeId);
    ctx.currentScopeId = scopeId;
    await updatePrivateCommands(ctx, await canAdminScope(ctx.api, ctx.from!.id, scopeId));
    await showCommunity(ctx, scopeId);
  }
  await ctx.answerCallbackQuery();
}

export async function onScopePickCallback(ctx: MyContext): Promise<void> {
  const match = ctx.callbackQuery?.data?.match(/^(pick|pickpage):([a-f0-9]{12}):([^:]+)$/);
  if (!match || !isPrivate(ctx) || match[2] !== ctx.session.pendingSelectionToken || ctx.callbackQuery?.message?.message_id !== ctx.session.pendingSelectionMessageId || !ctx.session.pendingIntent || ctx.session.paused || !pendingAlive(ctx) || (ctx.session.pendingSelectionExpiresAt ?? 0) <= Date.now()) {
    await ctx.answerCallbackQuery({ text: ctx.t("operation_stale"), show_alert: true }); return;
  }
  const intent = ctx.session.pendingIntent;
  if (match[1] === "pickpage") { await showScopePicker(ctx, Number(match[3]), intent); await ctx.answerCallbackQuery(); return; }
  const scopeId = match[3];
  if (!(await requireScope(ctx, scopeId, intent !== "tags"))) { await ctx.answerCallbackQuery(); return; }
  await setActiveScopeId(ctx.from!.id, scopeId);
  ctx.currentScopeId = scopeId;
  ctx.session.pendingIntent = undefined;
  ctx.session.pendingSelectionToken = undefined;
  ctx.session.pendingSelectionMessageId = undefined;
  ctx.session.pendingSelectionExpiresAt = undefined;
  ctx.session.paused = false;
  await updatePrivateCommands(ctx, await canAdminScope(ctx.api, ctx.from!.id, scopeId));
  await ctx.answerCallbackQuery();
  const { runScopeAction } = await import("./onNavigation.js");
  await runScopeAction(ctx, intent, scopeId);
}
