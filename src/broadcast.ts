import { Api } from "grammy";
import { ADMIN_IDS /*, USER_IDS */ } from "./config.js";

export async function broadcastNewGif(
  api: Api,
  authorId: number,
  fileId: string,
  tags: string[],
  emojis: string[]
): Promise<void> {
  const recipients = [...ADMIN_IDS /*, ...USER_IDS */].filter((id) => id !== authorId);
  if (recipients.length === 0) return;

  const caption = [
    "🆕 Додано нову гіфку!",
    tags.length > 0 ? `🏷 Теги: ${tags.join(" ")}` : null,
    emojis.length > 0 ? `😀 Емоджі: ${emojis.join(" ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  for (const id of recipients) {
    try {
      await api.sendAnimation(id, fileId, { caption });
    } catch (err) {
      console.error(`[Broadcast] Failed to send to ${id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[Broadcast] Sent to ${recipients.length} recipients`);
}
