import { MyContext } from "../session.js";
import { recordGifUsage } from "../stats.js";

export async function onChosenInlineResult(ctx: MyContext): Promise<void> {
  const result = ctx.chosenInlineResult;
  if (!result?.result_id) return;

  const resultId = result.result_id;
  const sep = resultId.indexOf("_");
  if (sep === -1) return;

  const scopeId = resultId.slice(0, sep);
  await recordGifUsage(resultId, scopeId);
}
