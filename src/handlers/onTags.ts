import { InlineKeyboard } from "grammy";
import { MyContext } from "../session.js";
import { getTagFacets } from "../meili.js";
import { chunkArray } from "../utils/chunks.js";
import { promptScopeSelect } from "./onScopes.js";

const TAGS_PER_PAGE = 12;

async function buildTagsPage(
  ctx: MyContext,
  scopeId: string,
  page: number
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const facets = await getTagFacets(scopeId);
  const entries = Object.entries(facets).sort((a, b) => b[1] - a[1]);
  const pages = chunkArray(entries, TAGS_PER_PAGE);
  const totalPages = Math.max(pages.length, 1);
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const items = pages[currentPage] ?? [];

  const keyboard = new InlineKeyboard();

  items.forEach(([tag, count], i) => {
    keyboard.switchInlineCurrent(`${tag} (${count})`, tag);
    if ((i + 1) % 3 === 0) keyboard.row();
  });

  keyboard.row();
  if (currentPage > 0) {
    keyboard.text(ctx.t("tags_btn_back"), `tags:page:${currentPage - 1}`);
  }
  keyboard.text(`${currentPage + 1}/${totalPages}`, "tags:noop");
  if (currentPage < totalPages - 1) {
    keyboard.text(ctx.t("tags_btn_forward"), `tags:page:${currentPage + 1}`);
  }

  const text =
    entries.length === 0
      ? ctx.t("tags_empty")
      : ctx.t("tags_catalog", { count: entries.length, page: currentPage + 1, total: totalPages });

  return { text, keyboard };
}

export async function onTags(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await promptScopeSelect(ctx);
    return;
  }

  const { text, keyboard } = await buildTagsPage(ctx, scopeId, 0);
  await ctx.reply(text, { reply_markup: keyboard });
}

export async function onTagsPageCallback(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) { await ctx.answerCallbackQuery(); return; }

  const data = ctx.callbackQuery?.data ?? "";
  const page = parseInt(data.replace("tags:page:", ""), 10);

  const { text, keyboard } = await buildTagsPage(ctx, scopeId, isNaN(page) ? 0 : page);
  await ctx.editMessageText(text, { reply_markup: keyboard });
  await ctx.answerCallbackQuery();
}
