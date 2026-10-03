import { MyContext } from "../session.js";
import { getTopGifs } from "../stats.js";
import { gifIndex } from "../meili.js";
import { getScope } from "../scopes.js";
import { promptScopeSelect } from "./onScopes.js";

export async function onStats(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await promptScopeSelect(ctx);
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

  // Fetch every referenced document once, in parallel, instead of serially
  // inside the render loop.
  const gifIds = [...new Set([...totalTop, ...weekTop].map((s) => s.gifId))];
  const labels = new Map<string, string>();
  await Promise.all(
    gifIds.map(async (gifId) => {
      try {
        const doc = await gifIndex.getDocument(gifId);
        const parts = [...(doc.tags ?? []), ...(doc.emojis ?? [])];
        if (parts.length > 0) labels.set(gifId, parts.join(" "));
      } catch {}
    })
  );

  const formatList = (items: typeof totalTop, header: string): void => {
    if (items.length === 0) return;
    lines.push(header);
    items.forEach(({ gifId, count }, i) => {
      lines.push(
        ctx.t("stats_item", { rank: i + 1, tags: labels.get(gifId) ?? "—", count })
      );
    });
    lines.push("");
  };

  formatList(totalTop, ctx.t("stats_total_header", { count: totalTop.length }));
  formatList(weekTop, ctx.t("stats_week_header", { count: weekTop.length }));

  await ctx.reply(lines.join("\n").trimEnd());
}
