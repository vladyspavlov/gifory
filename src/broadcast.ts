import { Api } from "grammy";
import { getScopeAdmins } from "./scopes.js";
import { getUserLang, t } from "./i18n/index.js";

export async function broadcastNewGif(
  api: Api,
  authorId: number,
  fileId: string,
  tags: string[],
  emojis: string[],
  scopeId: string
): Promise<void> {
  const allAdmins = await getScopeAdmins(scopeId);
  const recipients = allAdmins.filter((id) => id !== authorId);
  if (recipients.length === 0) return;

  for (const id of recipients) {
    const lang = await getUserLang(id);
    const lines = [t(lang, "broadcast_new_gif")];
    if (tags.length > 0) lines.push(t(lang, "broadcast_tags", { tags: tags.join(" ") }));
    if (emojis.length > 0) lines.push(t(lang, "broadcast_emojis", { emojis: emojis.join(" ") }));

    try {
      await api.sendAnimation(id, fileId, { caption: lines.join("\n") });
    } catch (err) {
      console.error(`[Broadcast] Failed to send to ${id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[Broadcast] Sent to ${recipients.length} recipients`);
}
