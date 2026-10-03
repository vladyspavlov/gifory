import { GrammyError, type Api } from "grammy";
import type { InlineQueryResultCachedMpeg4Gif } from "grammy/types";
import type { MyContext } from "../session.js";
import { GifDocument, searchGifs, markGifExpired } from "../meili.js";
import { getAccessibleScopes } from "../access.js";
import { mapLimit } from "../utils/concurrency.js";

function invalidFile(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code === 400 &&
    /invalid file[_ ]id|wrong file identifier|file[_ ]id.*(?:invalid|expired)|file not found/i.test(error.description);
}

/** Unknown/temporary failures are omitted from this answer, never expired in storage. */
export async function findValidGifs(api: Api, gifs: GifDocument[]): Promise<{ valid: GifDocument[]; invalid: GifDocument[] }> {
  const probes = await mapLimit(gifs, 4, async gif => {
    try { await api.getFile(gif.file_id); return "valid"; }
    catch (error) { return invalidFile(error) ? "invalid" : "unknown"; }
  });
  return {
    valid: gifs.filter((_, index) => probes[index] === "valid"),
    invalid: gifs.filter((_, index) => probes[index] === "invalid"),
  };
}

export async function onInline(ctx: MyContext): Promise<void> {
  const query = ctx.inlineQuery?.query ?? "";
  const offset = Number(ctx.inlineQuery?.offset || "0");
  const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const scopes = await getAccessibleScopes(ctx.api, ctx.from!.id);
  if (!scopes.length) {
    await ctx.answerInlineQuery([], {
      cache_time: 0, is_personal: true,
      button: { text: ctx.t("join_community"), start_parameter: "start" },
    });
    return;
  }
  const gifs = await searchGifs(query, scopes.map(scope => scope.id), 50, safeOffset);
  const results = (docs: GifDocument[]): InlineQueryResultCachedMpeg4Gif[] => docs.map(gif => ({
    type: "mpeg4_gif", id: gif.id, mpeg4_file_id: gif.file_id,
    // This link opens the scope only for existing members; it never grants access.
    reply_markup: ctx.me.username ? { inline_keyboard: [[{
      text: ctx.t("inline_join_btn"), url: `https://t.me/${ctx.me.username}?start=scope_${gif.scope_id}`,
    }]] } : undefined,
  }));
  // Do not cache access-controlled results after someone leaves a community.
  // Pagination follows the source page even when temporary failures are omitted.
  const options = { cache_time: 0, is_personal: true,
    next_offset: gifs.length === 50 ? String(safeOffset + gifs.length) : "" };
  try {
    await ctx.answerInlineQuery(results(gifs), options);
  } catch (error) {
    if (!(error instanceof GrammyError) || error.error_code !== 400 || !error.description.includes("DOCUMENT_INVALID")) throw error;
    const { valid, invalid } = await findValidGifs(ctx.api, gifs);
    await Promise.all(invalid.map(gif => markGifExpired(gif)));
    const retryOptions = { ...options, next_offset: gifs.length === 50
      ? String(safeOffset + gifs.length - invalid.length) : "" };
    await ctx.answerInlineQuery(results(valid), retryOptions);
  }
}
