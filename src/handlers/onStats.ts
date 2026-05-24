import { MyContext } from "../session.js";
import { getTopGifs } from "../stats.js";
import { gifIndex } from "../meili.js";
import { getScope } from "../scopes.js";

export async function onStats(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply(ctx.t("no_scope_for_stats"));
    return;
  }

  const [totalTop, weekTop] = await Promise.all([
    getTopGifs(scopeId, "total", 5),
    getTopGifs(scopeId, "week", 5),
  ]);

  if (totalTop.length === 0 && weekTop.length === 0) {
    await ctx.reply(ctx.t("stats_empty"));
    return;
  }

  const scope = await getScope(scopeId);
  const lines: string[] = [ctx.t("stats_header", { name: scope?.name ?? scopeId }), ""];

  const formatList = async (items: typeof totalTop, header: string): Promise<void> => {
    if (items.length === 0) return;
    lines.push(header);
    for (let i = 0; i < items.length; i++) {
      const { gifId, count } = items[i];
      let tags = "—";
      try {
        const doc = await gifIndex.getDocument(gifId);
        const parts = [...(doc.tags ?? []), ...(doc.emojis ?? [])];
        tags = parts.length > 0 ? parts.join(" ") : "—";
      } catch {}
      lines.push(ctx.t("stats_item", { rank: i + 1, tags, count }));
    }
    lines.push("");
  };

  await formatList(totalTop, ctx.t("stats_total_header", { count: totalTop.length }));
  await formatList(weekTop, ctx.t("stats_week_header", { count: weekTop.length }));

  await ctx.reply(lines.join("\n").trimEnd());
}
