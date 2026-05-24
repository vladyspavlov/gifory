import { MyContext } from "../session.js";
import { createScope, getScope, syncGroupAdmins } from "../scopes.js";

export async function onMyChatMember(ctx: MyContext): Promise<void> {
  const update = ctx.myChatMember;
  if (!update) return;

  const { new_chat_member, chat } = update;
  if (chat.type !== "group" && chat.type !== "supergroup") return;

  const chatId = String(chat.id);
  const status = new_chat_member.status;

  if (status === "member" || status === "administrator") {
    const existing = await getScope(chatId);

    let adminIds: number[] = [];
    try {
      const admins = await ctx.getChatAdministrators();
      adminIds = admins.filter((m) => !m.user.is_bot).map((m) => m.user.id);
    } catch {}

    if (!existing) {
      const title = "title" in chat ? (chat.title ?? chatId) : chatId;
      await createScope(chatId, title, "group", adminIds);
      console.log(`[Scopes] Created group scope "${chatId}" with ${adminIds.length} admins`);
    } else {
      await syncGroupAdmins(chatId, adminIds);
    }
  }
}
