import { InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { createScope, getScope, syncGroupAdmins } from "../scopes.js";

export async function showGroupSetup(ctx: MyContext, ready?: boolean): Promise<void> {
  const chat = ctx.chat ?? ctx.myChatMember?.chat;
  if (!chat || !["group", "supergroup"].includes(chat.type)) return;
  const scopeId = String(chat.id);
  const scope = await getScope(scopeId);
  if (ready === undefined) {
    try { const member = await ctx.api.getChatMember(chat.id, ctx.me.id); ready = member.status === "administrator"; }
    catch { await ctx.reply(ctx.t("access_unavailable")); return; }
  }
  const keyboard = new InlineKeyboard().text(ctx.t("btn_add"), `nav:add:${scopeId}`).row().switchInlineCurrent(ctx.t("btn_search_scope"), `in:${scopeId} `);
  if (ctx.me.username) keyboard.row().url(ctx.t("btn_open"), `https://t.me/${ctx.me.username}?start=scope_${scopeId}`);
  await ctx.reply(ctx.t("group_setup", { name: scope?.name ?? ("title" in chat ? chat.title ?? scopeId : scopeId) }) + (ready ? "" : "\n\n" + ctx.t("group_admin_missing")), { reply_markup: keyboard });
}

export async function onMyChatMember(ctx: MyContext): Promise<void> {
  const update = ctx.myChatMember;
  if (!update || !["group", "supergroup"].includes(update.chat.type)) return;
  const { new_chat_member, old_chat_member, chat } = update;
  const status = new_chat_member.status;
  if (status !== "member" && status !== "administrator") return;
  const chatId = String(chat.id);
  const admins = await ctx.getChatAdministrators();
  const ids = admins.filter(member => !member.user.is_bot).map(member => member.user.id);
  if (!(await getScope(chatId))) await createScope(chatId, "title" in chat ? chat.title ?? chatId : chatId, "group", ids);
  else await syncGroupAdmins(chatId, ids);
  if (old_chat_member.status !== status) await showGroupSetup(ctx, status === "administrator");
}
