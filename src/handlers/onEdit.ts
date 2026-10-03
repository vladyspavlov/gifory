import type { MyContext } from "../session.js";
import { extractTags, extractEmojis, hasInvalidTags, labelsWithinLimit } from "../utils/tags.js";
import { askConfirmation, blockNewOperation, showArchive, previewGif } from "./onManagement.js";
import { promptScopeSelect } from "./onScopes.js";
export async function onEdit(ctx: MyContext): Promise<void> {
  if (await blockNewOperation(ctx)) return;
  if (!ctx.currentScopeId) { await promptScopeSelect(ctx, "manage"); return; }
  const gif = ctx.message?.reply_to_message?.animation;
  if (!gif) { await showArchive(ctx, ctx.currentScopeId); return; }
  if (hasInvalidTags(ctx.message?.text)) { await ctx.reply(ctx.t("gif_tags_invalid", { example: ctx.t("gif_tag_example") })); return; }
  const tags = extractTags(ctx.message?.text), emojis = extractEmojis(ctx.message?.text);
  if (!labelsWithinLimit(tags, emojis)) { await ctx.reply(ctx.t("labels_too_many")); return; }
  if (!tags.length && !emojis.length) { await previewGif(ctx, ctx.currentScopeId, gif.file_unique_id); return; }
  await askConfirmation(ctx, { action: "edit", scopeId: ctx.currentScopeId, gifUniqueId: gif.file_unique_id, tags, emojis });
}
