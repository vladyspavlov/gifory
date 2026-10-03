import { InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { getTopGifs } from "../stats.js";
import { gifIndex } from "../meili.js";
import { promptScopeSelect } from "./onScopes.js";
import { requireScope, clip, gifHandle } from "../ui.js";

export async function onStats(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) { await promptScopeSelect(ctx, "stats"); return; }
  const scope = await requireScope(ctx, scopeId, true);
  if (!scope) return;
  const [totalTop, weekTop] = await Promise.all([getTopGifs(scopeId, "total", 5), getTopGifs(scopeId, "week", 5)]);
  const lines = [ctx.t("stats_header", { name: scope.name }), ""];
  const keyboard = new InlineKeyboard();
  const docs = new Map<string, { tags: string[]; emojis: string[]; file_unique_id: string }>();
  await Promise.all([...new Set([...totalTop, ...weekTop].map(item => item.gifId))].map(async id => {
    try { const doc = await gifIndex.getDocument(id); if (doc.scope_id === scopeId) docs.set(id, doc); }
    catch (error) { if (!(error instanceof Error) || !("cause" in error) || (error.cause as { code?: string })?.code !== "document_not_found") throw error; }
  }));
  for (const [items, header] of [[totalTop, "stats_total_header"], [weekTop, "stats_week_header"]] as const) {
    if (!items.length) continue;
    lines.push(ctx.t(header, { count: items.length }));
    for (const [i, item] of items.entries()) {
      const doc = docs.get(item.gifId);
      const label = doc ? [...doc.tags, ...doc.emojis].join(" ") || "—" : "—";
      lines.push(ctx.t("stats_item", { rank: i + 1, tags: clip(label, 140), count: item.count }));
    }
    lines.push("");
  }
  if (!totalTop.length && !weekTop.length) lines.push(ctx.t("stats_empty", { name: scope.name }));
  lines.push(ctx.t("stats_note"));
  for (const [id, doc] of docs) keyboard.text(clip([...doc.tags, ...doc.emojis].join(" ") || id), `archive:open:${await gifHandle(ctx, scopeId, doc.file_unique_id)}`).row();
  keyboard.text(ctx.t("btn_manage"), `nav:manage:${scopeId}`);
  await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
}
