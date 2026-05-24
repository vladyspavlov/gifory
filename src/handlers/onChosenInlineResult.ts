import { MyContext } from "../session.js";
import { recordGifUsage } from "../stats.js";

export async function onChosenInlineResult(ctx: MyContext): Promise<void> {
  const resultId = ctx.chosenInlineResult?.result_id;
  if (!resultId) return;

  // resultId format: `${scopeId}_${fileUniqueId}`
  const sep = resultId.indexOf("_");
  if (sep === -1) return;

  const scopeId = resultId.slice(0, sep);
  await recordGifUsage(resultId, scopeId);
}
