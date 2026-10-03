import type { MyContext } from "../session.js";
import { addUserToScope, getScope, removeUserFromScope, syncGroupAdmins } from "../scopes.js";
import { isChatMember } from "../access.js";

export async function onChatMember(ctx: MyContext): Promise<void> {
  const update = ctx.chatMember;
  if (!update || update.new_chat_member.user.is_bot) return;
  const scopeId = String(update.chat.id);
  if (!(await getScope(scopeId))) return;
  const member = update.new_chat_member;
  if (isChatMember(member)) await addUserToScope(member.user.id, scopeId);
  else await removeUserFromScope(member.user.id, scopeId, { protectLastAdmin: false });
  // Re-sync when an admin is promoted, demoted, or departs. Never erase admins on API failure.
  const wasAdmin = ["creator", "administrator"].includes(update.old_chat_member.status);
  const isAdmin = ["creator", "administrator"].includes(member.status);
  if (wasAdmin || isAdmin) {
    const admins = await ctx.getChatAdministrators();
    await syncGroupAdmins(scopeId, admins.filter(m => !m.user.is_bot).map(m => m.user.id));
  }
}
