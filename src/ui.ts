import { InlineKeyboard } from "grammy";
import { randomBytes } from "node:crypto";
import type { MyContext } from "./session.js";
import { redis } from "./redis.js";
import { getScope } from "./scopes.js";
import { getScopeAccess, canAdminScope, ScopeVerificationError } from "./access.js";
import { escapeHtml } from "./utils/html.js";
import { formatUserLink } from "./users.js";

export const FLOW_TTL = 15 * 60_000;
export const token = () => randomBytes(6).toString("hex");
export const isPrivate = (ctx: MyContext) => ctx.chat?.type === "private";
export const scopeQuery = (scopeId: string, query = "") => `in:${scopeId} ${query}`;
export const clip = (value: string, size = 44) => Array.from(value).length > size ? Array.from(value).slice(0, size - 1).join("") + "…" : value;
export const commandArgument = (ctx: MyContext) => (ctx.message?.text ?? "").replace(/^\/\w+(?:@\w+)?(?:\s+|$)/u, "").trim();

/** Message/caption callbacks stay navigable without trying to edit a caption as text. */
export async function screen(ctx: MyContext, text: string, keyboard: InlineKeyboard): Promise<void> {
  if (ctx.callbackQuery?.message && "text" in ctx.callbackQuery.message) {
    // Repeated taps on an already displayed screen are harmless.
    if (ctx.callbackQuery.message.text === text && JSON.stringify(ctx.callbackQuery.message.reply_markup?.inline_keyboard) === JSON.stringify(keyboard.inline_keyboard)) return;
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

export function searchButtons(ctx: MyContext, query = "", label = ctx.t("btn_search_all")): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (isPrivate(ctx)) keyboard.switchInline(ctx.t("btn_send_chat"), query).row();
  return keyboard.switchInlineCurrent(label, query);
}

export function homeButton(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard().text(ctx.t("btn_home"), "nav:home");
}

export function communityBack(ctx: MyContext, scopeId: string): InlineKeyboard {
  return new InlineKeyboard().text(ctx.t("btn_open"), `nav:open:${scopeId}`);
}

export async function requireScope(ctx: MyContext, scopeId: string, admin = false) {
  const scope = await getScope(scopeId);
  if (!scope) { await ctx.reply(ctx.t("scope_gone"), { reply_markup: homeButton(ctx) }); return null; }
  const status = await getScopeAccess(ctx.api, ctx.from!.id, scope);
  if (status === "unavailable") throw new ScopeVerificationError();
  if (status !== "allowed") { await ctx.reply(ctx.t("scope_gone"), { reply_markup: homeButton(ctx) }); return null; }
  if (admin && !(await canAdminScope(ctx.api, ctx.from!.id, scopeId))) {
    await ctx.reply(ctx.t("no_permissions_scope", { name: scope.name }), { reply_markup: communityBack(ctx, scopeId).row().text(ctx.t("btn_communities"), "nav:scopes") });
    return null;
  }
  return scope;
}

/** Preview buttons use short, user-bound opaque handles instead of oversized file IDs. */
export async function gifHandle(ctx: MyContext, scopeId: string, gifUniqueId: string): Promise<string> {
  const handle = token();
  await redis.set(`ux:gif:${handle}`, JSON.stringify({ userId: ctx.from!.id, scopeId, gifUniqueId }), "EX", 3600);
  return handle;
}
export async function readGifHandle(ctx: MyContext, handle: string): Promise<{ scopeId: string; gifUniqueId: string } | null> {
  if (!/^[a-f0-9]{12}$/.test(handle)) return null;
  const raw = await redis.get(`ux:gif:${handle}`);
  if (!raw) return null;
  const value = JSON.parse(raw);
  return value.userId === ctx.from!.id ? value : null;
}

export async function rememberGifMessage(chatId: number, messageId: number, userId: number, scopeId: string, gifUniqueId: string): Promise<void> {
  await redis.set(`ux:message:${chatId}:${messageId}`, JSON.stringify({ userId, scopeId, gifUniqueId }), "EX", 30 * 86400);
}
export async function replyScope(ctx: MyContext): Promise<string | undefined> {
  const reply = ctx.message?.reply_to_message;
  if (!reply || !ctx.chat) return undefined;
  const raw = await redis.get(`ux:message:${ctx.chat.id}:${reply.message_id}`);
  if (!raw) return undefined;
  const ref = JSON.parse(raw);
  return ref.userId === ctx.from!.id ? ref.scopeId : undefined;
}

export async function scopeName(scopeId: string): Promise<string> {
  return (await getScope(scopeId))?.name ?? scopeId;
}

export async function inputPrompt(ctx: MyContext, text: string): Promise<void> {
  ctx.session.pendingExpiresAt = Date.now() + FLOW_TTL;
  ctx.session.paused = false;
  const promptText = isPrivate(ctx) ? text : `${formatUserLink(ctx.from!.id, { id: ctx.from!.id, first_name: ctx.from!.first_name })}\n${escapeHtml(text)}`;
  const message = await ctx.reply(promptText, isPrivate(ctx)
    ? { reply_markup: new InlineKeyboard().text(ctx.t("gif_btn_cancel"), "nav:cancel") }
    : { parse_mode: "HTML", reply_markup: { force_reply: true, selective: true }, reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined });
  ctx.session.pendingMessageId = message.message_id;
  if (ctx.chat) await redis.set(`ux:prompt:${ctx.chat.id}:${message.message_id}`, String(ctx.from!.id), "EX", 7200);
}

export function pendingAlive(ctx: MyContext): boolean {
  return !ctx.session.pendingExpiresAt || ctx.session.pendingExpiresAt > Date.now();
}

/** Navigation pauses input consumption instead of silently discarding an upload. */
export async function pauseForNavigation(ctx: MyContext): Promise<void> {
  if (ctx.session.paused) return;
  if (ctx.session.state === "IDLE" && !ctx.session.pendingIntent && !ctx.session.confirmation) return;
  ctx.session.paused = true;
  await ctx.reply(ctx.t("pending_notice"), {
    reply_markup: new InlineKeyboard().text(ctx.t("btn_resume"), "nav:resume").row().text(ctx.t("gif_btn_cancel"), "nav:cancel"),
  });
}
