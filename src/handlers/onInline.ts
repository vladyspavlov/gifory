import { Api } from "grammy";
import { InlineQueryResultCachedMpeg4Gif } from "grammy/types";
import { MyContext } from "../session.js";
import { GifDocument, searchGifs, markGifExpired } from "../meili.js";
import { getUserScopes } from "../scopes.js";

async function findValidGifs(
  api: Api,
  gifs: GifDocument[]
): Promise<{ valid: GifDocument[]; invalid: GifDocument[] }> {
  const results = await Promise.allSettled(
    gifs.map(async (gif) => {
      const file = await api.getFile(gif.file_id);
      // Animation file_ids (mpeg4_gif) live under animations/ on Telegram's CDN
      const ok = file.file_path?.startsWith("animations/") ?? false;
      return { gif, ok };
    })
  );

  const valid: GifDocument[] = [];
  const invalid: GifDocument[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value.ok) {
      valid.push(gifs[i]);
    } else {
      invalid.push(gifs[i]);
    }
  }

  return { valid, invalid };
}

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
      button: { text: ctx.t("join_community"), start_parameter: "start" },
    });
    return;
  }

  const gifs = await searchGifs(query, scopeIds, 50, safeOffset);

  const toResults = (docs: GifDocument[]): InlineQueryResultCachedMpeg4Gif[] =>
    docs.map((gif) => ({ type: "mpeg4_gif", id: gif.id, mpeg4_file_id: gif.file_id }));

  const answerOpts = (count: number, cacheTime = 10) => ({
    cache_time: cacheTime,
    is_personal: true,
    next_offset: count === 50 ? String(safeOffset + count) : "",
  });

  try {
    await ctx.answerInlineQuery(toResults(gifs), answerOpts(gifs.length));
  } catch (err: any) {
    if (err?.error_code !== 400 || !err?.description?.includes("DOCUMENT_INVALID")) {
      throw err;
    }

    // One or more file_ids are not valid mpeg4_gif files. Probe each via getFile,
    // delete the bad ones from Meilisearch, and re-answer with what's left.
    const { valid, invalid } = await findValidGifs(ctx.api, gifs);

    for (const gif of invalid) {
      console.warn(`[Inline] Marking expired GIF ${gif.id} (file_id: ${gif.file_id})`);
      markGifExpired(gif.id).catch(() => {});
    }

    await ctx.answerInlineQuery(toResults(valid), answerOpts(valid.length, 0));
  }
}
