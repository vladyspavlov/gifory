import { MyContext } from "../session.js";
import { getAnalytics } from "../analytics.js";
import { SUPER_ADMIN_ID } from "../config.js";

function fmt(n: number): string {
  return n.toLocaleString("en");
}

function row(label: string, s: { today: number; week: number; month: number; allTime: number }): string {
  return (
    `${label}\n` +
    `  Today: ${fmt(s.today)} · 7d: ${fmt(s.week)} · 30d: ${fmt(s.month)} · All-time: ${fmt(s.allTime)}`
  );
}

export async function onBotStats(ctx: MyContext): Promise<void> {
  if (!SUPER_ADMIN_ID || ctx.from?.id !== SUPER_ADMIN_ID) return;

  const s = await getAnalytics();

  const lines = [
    "📊 <b>Bot Analytics</b>",
    "",
    row("👥 Users (new)",     s.users),
    "",
    row("📤 GIF Usage",       s.usage),
    "",
    row("🗂 Scopes created",  s.scopes),
    "",
    row("🖼 GIFs added",      s.gifs),
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}
