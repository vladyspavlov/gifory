import { Api } from "grammy";
import { getScope } from "./scopes.js";
import { getUserLang, t } from "./i18n/index.js";
import { getUserProfile } from "./users.js";
import { canAdminScope } from "./access.js";
import { redis } from "./redis.js";
import { rememberGifMessage } from "./ui.js";

export async function broadcastNewGif(api: Api, authorId: number, fileId: string, tags: string[], emojis: string[], scopeId: string, uniqueId?: string): Promise<void> {
  const scope = await getScope(scopeId);
  if (!scope) return;
  const profile = await getUserProfile(authorId);
  for (const id of scope.admin_ids.filter(id => id !== authorId)) {
    try {
      if (await redis.exists(`notify_muted:${scopeId}:${id}`) || !(await canAdminScope(api, id, scopeId))) continue;
      const lang = await getUserLang(id);
      const author = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") : t(lang, "user_fallback", { id: authorId });
      const lines = [t(lang, "broadcast_new_gif", { name: scope.name, author })];
      if (tags.length) lines.push(t(lang, "broadcast_tags", { tags: tags.join(" ") }));
      if (emojis.length) lines.push(t(lang, "broadcast_emojis", { emojis: emojis.join(" ") }));
      // Opening this source must never use the recipient's unrelated active scope.
      const { randomBytes } = await import("node:crypto");
      const handle = randomBytes(6).toString("hex");
      if (uniqueId) await redis.set(`ux:gif:${handle}`, JSON.stringify({ userId: id, scopeId, gifUniqueId: uniqueId }), "EX", 3600);
      const message = await api.sendAnimation(id, fileId, { caption: lines.join("\n").slice(0, 1000), reply_markup: { inline_keyboard: [[{ text: t(lang, "btn_open"), callback_data: uniqueId ? `archive:open:${handle}` : `nav:open:${scopeId}` }], [{ text: t(lang, "btn_manage"), callback_data: `nav:manage:${scopeId}` }]] } });
      if (uniqueId) await rememberGifMessage(id, message.message_id, id, scopeId, uniqueId);
    } catch (error) { console.warn(`[Broadcast] Could not notify admin ${id}:`, error instanceof Error ? error.message : error); }
  }
}
