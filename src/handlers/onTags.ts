import { InlineKeyboard } from "grammy";
import type { MyContext } from "../session.js";
import { getTagFacets, getArchivePage } from "../meili.js";
import { promptScopeSelect } from "./onScopes.js";
import { requireScope, screen, scopeQuery, clip } from "../ui.js";

export async function showTags(ctx: MyContext, scopeId: string, page = 0): Promise<void> {
  const scope = await requireScope(ctx, scopeId);
  if (!scope) return;
  const entries = Object.entries(await getTagFacets(scopeId)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const pages = Math.max(1, Math.ceil(entries.length / 12));
  page = Math.max(0, Math.min(page, pages - 1));
  const keyboard = new InlineKeyboard();
  for (const [index, [tag, count]] of entries.slice(page * 12, (page + 1) * 12).entries()) {
    keyboard.switchInlineCurrent(`${clip(tag, 24)} (${count})`, scopeQuery(scopeId, tag));
    if ((index + 1) % 2 === 0) keyboard.row();
  }
  keyboard.row();
  if (page > 0) keyboard.text(ctx.t("tags_btn_back"), `tags:page:${scopeId}:${page - 1}`);
  if (page + 1 < pages) keyboard.text(ctx.t("tags_btn_forward"), `tags:page:${scopeId}:${page + 1}`);
  keyboard.row().text(ctx.t("btn_open"), `nav:open:${scopeId}`);
  if (!entries.length && scope.admin_ids.includes(ctx.from!.id)) keyboard.row().text(ctx.t("btn_add"), `nav:add:${scopeId}`);
  const { total } = await getArchivePage(scopeId);
  await screen(ctx, entries.length ? `${scope.name}\n` + ctx.t("tags_catalog", { count: entries.length, page: page + 1, total: pages }) : ctx.t(total ? "tags_empty" : "archive_empty", { name: scope.name }), keyboard);
}
export async function onTags(ctx: MyContext): Promise<void> {
  if (!ctx.currentScopeId) { await promptScopeSelect(ctx, "tags"); return; }
  await showTags(ctx, ctx.currentScopeId);
}
export async function onTagsPageCallback(ctx: MyContext): Promise<void> {
  const match = ctx.callbackQuery?.data?.match(/^tags:page:([^:]+):(\d+)$/);
  if (!match) { await ctx.answerCallbackQuery({ text: ctx.t("operation_stale"), show_alert: true }); return; }
  await showTags(ctx, match[1], Number(match[2]));
  await ctx.answerCallbackQuery();
}
