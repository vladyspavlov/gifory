import { MyContext } from "../session.js";
import { getAnalytics } from "../analytics.js";
import { SUPER_ADMIN_ID } from "../config.js";

export async function onBotStats(ctx: MyContext): Promise<void> {
  if (!SUPER_ADMIN_ID || ctx.from?.id !== SUPER_ADMIN_ID) return;
  const stats = await getAnalytics();
  const lines = [ctx.t("analytics_header")];
  for (const [key, label] of [
    ["users", "analytics_users"], ["usage", "analytics_usage"],
    ["scopes", "analytics_scopes"], ["gifs", "analytics_gifs"],
  ] as const) {
    lines.push("", ctx.t(label), ctx.t("analytics_periods", { ...stats[key] }));
  }
  await ctx.reply(lines.join("\n"));
}
