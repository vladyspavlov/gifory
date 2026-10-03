import { InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { clearPendingOperation } from "../session.js";
import { getAccessibleScopes, canAdminScope } from "../access.js";
import { getActiveScopeId, getScope } from "../scopes.js";
import { getMainKeyboard } from "../keyboard.js";
import { isPrivate, screen, searchButtons, pendingAlive, inputPrompt } from "../ui.js";
import { updatePrivateCommands } from "../commands.js";

export function entryButtons(ctx: MyContext): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(ctx.t("btn_join_help"), "nav:join").row().text(ctx.t("btn_create"), "nav:create");
  if (ctx.me.username) keyboard.row().url(ctx.t("btn_group_setup"), `https://t.me/${ctx.me.username}?startgroup=setup&admin=manage_chat`);
  return keyboard;
}

export async function privateNavigation(ctx: MyContext): Promise<void> {
  const name = ctx.currentScopeId ? (await getScope(ctx.currentScopeId))?.name ?? ctx.currentScopeId : "";
  const keyboard = new InlineKeyboard();
  if (ctx.me.username) keyboard.url(ctx.t("btn_communities"), `https://t.me/${ctx.me.username}?start=communities`);
  await screen(ctx, ctx.t("private_navigation", { name }), keyboard);
}

export async function onHome(ctx: MyContext): Promise<void> { await showHome(ctx); }

export async function showHome(ctx: MyContext, refreshKeyboard = false): Promise<void> {
  if (!isPrivate(ctx)) { const { showGroupSetup } = await import("./onMyChatMember.js"); await showGroupSetup(ctx); return; }
  const scopes = await getAccessibleScopes(ctx.api, ctx.from!.id);
  const active = scopes.find(scope => scope.id === ctx.currentScopeId);
  // Refresh autocomplete using the explicit language override and current per-community role.
  await updatePrivateCommands(ctx, active ? await canAdminScope(ctx.api, ctx.from!.id, active.id) : false);
  // Refresh the persistent keyboard after /start or language changes.
  if (!ctx.callbackQuery || refreshKeyboard) await ctx.reply(ctx.t("btn_home"), { reply_markup: getMainKeyboard(ctx.t) });
  if (!scopes.length) { await screen(ctx, ctx.t("home_new"), entryButtons(ctx)); return; }
  const activeId = await getActiveScopeId(ctx.from!.id);
  const destination = scopes.find(scope => scope.id === activeId);
  let text = ctx.t("home_returning", { count: scopes.length }) + "\n\n" + (destination ? ctx.t("destination_note", { name: destination.name }) : ctx.t("destination_none"));
  const keyboard = searchButtons(ctx).row().text(ctx.t("btn_communities"), "nav:scopes");
  if (destination) keyboard.row().text(ctx.t("btn_open"), `nav:open:${destination.id}`);
  keyboard.row().text(ctx.t("btn_help"), "nav:help").text(ctx.t("btn_settings"), "nav:settings");
  if (ctx.session.state !== "IDLE" || ctx.session.pendingIntent || ctx.session.confirmation) {
    ctx.session.paused = true;
    text += "\n\n" + ctx.t("pending_notice");
    keyboard.row().text(ctx.t("btn_resume"), "nav:resume").text(ctx.t("gif_btn_cancel"), "nav:cancel");
  }
  await screen(ctx, text, keyboard);
}

export async function onSearch(ctx: MyContext): Promise<void> {
  const scopes = await getAccessibleScopes(ctx.api, ctx.from!.id);
  if (!scopes.length) { await onHome(ctx); return; }
  await screen(ctx, ctx.t("search_prompt", { username: ctx.me.username, example: ctx.t("search_example") }) + "\n\n" + ctx.t("search_recovery"),
    searchButtons(ctx).row().text(ctx.t("btn_communities"), "nav:scopes").text(ctx.t("btn_home"), "nav:home"));
}

export async function onSettings(ctx: MyContext): Promise<void> {
  if (!isPrivate(ctx)) { await privateNavigation(ctx); return; }
  await screen(ctx, ctx.t("settings_header"), new InlineKeyboard().text(ctx.t("btn_lang"), "nav:lang").row().text(ctx.t("btn_communities"), "nav:scopes").row().text(ctx.t("btn_home"), "nav:home"));
}

export async function onCancel(ctx: MyContext): Promise<void> {
  const scopeId = ctx.session.pendingScopeId ?? ctx.session.confirmation?.scopeId;
  clearPendingOperation(ctx.session);
  await screen(ctx, ctx.t("operation_cancelled"), new InlineKeyboard().text(ctx.t("btn_home"), "nav:home").row().text(ctx.t("btn_communities"), "nav:scopes"));
  if (scopeId && !isPrivate(ctx)) ctx.currentScopeId = scopeId;
}

export async function onResume(ctx: MyContext): Promise<void> {
  if (!pendingAlive(ctx) || (ctx.session.confirmation && ctx.session.confirmation.expiresAt <= Date.now())) {
    clearPendingOperation(ctx.session);
    await ctx.reply(ctx.t("pending_expired")); return;
  }
  ctx.session.paused = false;
  if (ctx.session.pendingIntent) {
    const { promptScopeSelect } = await import("./onScopes.js");
    await promptScopeSelect(ctx, ctx.session.pendingIntent); return;
  }
  if (ctx.session.confirmation) {
    const { repeatConfirmation } = await import("./onManagement.js");
    await repeatConfirmation(ctx); return;
  }
  if (ctx.session.state === "WAITING_FOR_NAME") {
    const scope = ctx.session.pendingScopeId ? await getScope(ctx.session.pendingScopeId) : null;
    await inputPrompt(ctx, ctx.t(ctx.session.pendingNameAction === "create" ? "create_needs_name" : "rename_prompt", { name: scope?.name ?? "", max: 64 })); return;
  }
  if (ctx.session.state !== "IDLE") {
    const { resumeGifFlow } = await import("./onAnimation.js");
    await resumeGifFlow(ctx); return;
  }
  await onHome(ctx);
}
