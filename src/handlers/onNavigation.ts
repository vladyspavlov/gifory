import { InlineKeyboard } from "grammy";
import type { MyContext, ScopeIntent } from "../session.js";
import { getScope, setActiveScopeId } from "../scopes.js";
import { canAdminScope } from "../access.js";
import { redis } from "../redis.js";
import { isPrivate, requireScope, screen, pauseForNavigation } from "../ui.js";
import { onHome, onSearch, onSettings, onCancel, onResume, privateNavigation } from "./onHome.js";
import { showCommunity, showScopePicker, promptScopeSelect } from "./onScopes.js";
import { onCreateScope } from "./onCreateScope.js";
import { onLang } from "./onLang.js";
import { onHelp } from "./onHelp.js";
import { showTags } from "./onTags.js";
import { onAdd, startUpload } from "./onAnimation.js";
import { showArchive, askConfirmation, blockNewOperation } from "./onManagement.js";
import { onMembers } from "./onMembers.js";
import { onInvite } from "./onInvite.js";
import { onStats } from "./onStats.js";
import { onBackup } from "./onBackup.js";
import { onRename } from "./onRename.js";
import { updatePrivateCommands } from "../commands.js";

export async function showManage(ctx: MyContext, scopeId: string): Promise<void> {
  if (!isPrivate(ctx)) { await privateNavigation(ctx); return; }
  const scope = await requireScope(ctx, scopeId, true);
  if (!scope) return;
  const muted = await redis.exists(`notify_muted:${scopeId}:${ctx.from!.id}`);
  const keyboard = new InlineKeyboard().text(ctx.t("btn_archive"), `nav:archive:${scopeId}`).row()
    .text(ctx.t("btn_add"), `nav:add:${scopeId}`).row().text(ctx.t("btn_members"), `nav:members:${scopeId}`).row();
  if (scope.type === "manual") keyboard.text(ctx.t("btn_invite"), `nav:invite:${scopeId}`).row().text(ctx.t("btn_rename"), `nav:rename:${scopeId}`).row();
  keyboard.text(ctx.t("btn_stats"), `nav:stats:${scopeId}`).row().text(ctx.t("btn_backup"), `nav:backup:${scopeId}`).row()
    .text(ctx.t(muted ? "btn_notifications_off" : "btn_notifications_on"), `nav:notify:${scopeId}:${muted ? "on" : "off"}`).row();
  if (scope.type === "manual" && scope.admin_ids.length === 1) keyboard.text(ctx.t("btn_close"), `nav:close:${scopeId}`).row();
  keyboard.text(ctx.t("btn_open"), `nav:open:${scopeId}`).row().text(ctx.t("btn_communities"), "nav:scopes");
  await screen(ctx, ctx.t("manage_header", { name: scope.name }) + (scope.type === "group" ? "\n\n" + ctx.t("group_roles") : ""), keyboard);
}

export async function runScopeAction(ctx: MyContext, intent: ScopeIntent, scopeId: string): Promise<void> {
  if (!(await requireScope(ctx, scopeId, intent !== "tags"))) return;
  ctx.currentScopeId = scopeId;
  switch (intent) {
    case "tags": await showTags(ctx, scopeId); break;
    case "add": await startUpload(ctx, scopeId); break;
    case "manage": await showManage(ctx, scopeId); break;
    case "members": await onMembers(ctx); break;
    case "invite": await onInvite(ctx); break;
    case "stats": await onStats(ctx); break;
    case "backup": await onBackup(ctx); break;
    case "rename": await onRename(ctx); break;
  }
}

export async function onManage(ctx: MyContext): Promise<void> {
  if (!ctx.currentScopeId) { await promptScopeSelect(ctx, "manage"); return; }
  await showManage(ctx, ctx.currentScopeId);
}

export async function onNavigation(ctx: MyContext): Promise<void> {
  const [, action, scopeId, option] = (ctx.callbackQuery?.data ?? "").split(":");
  // Personal navigation in groups opens privately and does not alter shared preferences.
  if (!isPrivate(ctx) && !["add", "tags", "cancel", "resume", "home", "help", "search"].includes(action)) {
    await privateNavigation(ctx); await ctx.answerCallbackQuery(); return;
  }
  const creatingDestination = action === "create" && ctx.session.pendingIntent === "add" && !ctx.session.pendingScopeId && ctx.session.state === "IDLE";
  if (!creatingDestination && ["add", "create", "rename", "close"].includes(action) && await blockNewOperation(ctx)) { await ctx.answerCallbackQuery(); return; }
  if (!["add", "create", "rename", "close", "cancel", "resume"].includes(action)) await pauseForNavigation(ctx);
  await ctx.answerCallbackQuery();
  switch (action) {
    case "home": await onHome(ctx); break;
    case "search": await onSearch(ctx); break;
    case "scopes": await showScopePicker(ctx, Number(scopeId) || 0); break;
    case "open": if (scopeId) await showCommunity(ctx, scopeId); break;
    case "settings": await onSettings(ctx); break;
    case "help": await onHelp(ctx); break;
    case "lang": await onLang(ctx); break;
    case "cancel": await onCancel(ctx); break;
    case "resume": await onResume(ctx); break;
    case "create": await onCreateScope(ctx); break;
    case "join": await screen(ctx, ctx.t("join_help"), new InlineKeyboard().text(ctx.t("btn_communities"), "nav:scopes").row().text(ctx.t("btn_home"), "nav:home")); break;
    case "destination":
      if (scopeId && await requireScope(ctx, scopeId)) {
        await setActiveScopeId(ctx.from!.id, scopeId);
        ctx.currentScopeId = scopeId;
        await updatePrivateCommands(ctx, await canAdminScope(ctx.api, ctx.from!.id, scopeId));
        await ctx.reply(ctx.t("scope_set_active", { name: (await getScope(scopeId))!.name }));
        await showCommunity(ctx, scopeId);
      }
      break;
    case "archive": if (scopeId) await showArchive(ctx, scopeId, Number(option) || 0); break;
    case "notify":
      if (scopeId && await requireScope(ctx, scopeId, true)) {
        if (option === "off") await redis.set(`notify_muted:${scopeId}:${ctx.from!.id}`, "1");
        else await redis.del(`notify_muted:${scopeId}:${ctx.from!.id}`);
        await showManage(ctx, scopeId);
      }
      break;
    case "close": if (scopeId) await askConfirmation(ctx, { action: "close", scopeId }); break;
    case "tags": case "add": case "manage": case "members": case "invite": case "stats": case "backup": case "rename":
      if (scopeId) await runScopeAction(ctx, action, scopeId);
      break;
    default: await ctx.reply(ctx.t("operation_stale"));
  }
}
