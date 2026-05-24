import { InlineQueryResultCachedMpeg4Gif } from "grammy/types";
import { MyContext } from "../session.js";
import { searchGifs } from "../meili.js";

export async function onInline(ctx: MyContext): Promise<void> {
  const query = ctx.inlineQuery?.query ?? "";
  const offset = parseInt(ctx.inlineQuery?.offset || "0", 10);
  const safeOffset = isNaN(offset) ? 0 : offset;

  const gifs = await searchGifs(query, 50, safeOffset);

  const results: InlineQueryResultCachedMpeg4Gif[] = gifs.map((gif) => ({
    type: "mpeg4_gif",
    id: gif.id,
    mpeg4_file_id: gif.file_id,
  }));

  const hasMore = gifs.length === 50;

  await ctx.answerInlineQuery(results, {
    cache_time: 10,
    is_personal: true,
    next_offset: hasMore ? String(safeOffset + 50) : "",
  });
}