import { InlineQueryResultCachedMpeg4Gif } from "grammy/types";
import { MyContext } from "../session.js";
import { searchGifs } from "../meili.js";
import { getUserScopes } from "../scopes.js";

export async function onInline(ctx: MyContext): Promise<void> {
  const query = ctx.inlineQuery?.query ?? "";
  const offset = parseInt(ctx.inlineQuery?.offset || "0", 10);
  const safeOffset = isNaN(offset) ? 0 : offset;

  const userId = ctx.from!.id;
  const scopes = await getUserScopes(userId);
  const scopeIds = scopes.map((s) => s.id);

  if (scopeIds.length === 0) {
    await ctx.answerInlineQuery([], {
      cache_time: 10,
      is_personal: true,
      switch_pm_text: "Приєднайтесь до спільноти",
      switch_pm_parameter: "start",
    });
    return;
  }

  const gifs = await searchGifs(query, scopeIds, 50, safeOffset);

  const results: InlineQueryResultCachedMpeg4Gif[] = gifs.map((gif) => ({
    type: "mpeg4_gif",
    id: gif.id,
    mpeg4_file_id: gif.file_id,
  }));

  await ctx.answerInlineQuery(results, {
    cache_time: 10,
    is_personal: true,
    next_offset: gifs.length === 50 ? String(safeOffset + 50) : "",
  });
}
