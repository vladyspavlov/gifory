import { MyContext } from "../session.js";
import { recordGifUsage } from "../stats.js";
import { getScope } from "../scopes.js";

export async function onChosenInlineResult(ctx: MyContext): Promise<void> {
  const result = ctx.chosenInlineResult;
  if (!result?.result_id) return;

  const resultId = result.result_id;
  const sep = resultId.indexOf("_");
  if (sep === -1) return;

  const scopeId = resultId.slice(0, sep);
  await recordGifUsage(resultId, scopeId);

  const inlineMsgId = result.inline_message_id;
  if (!inlineMsgId || !ctx.me.username) return;

  const scope = await getScope(scopeId);
  if (!scope) return;

  const url = `https://t.me/${ctx.me.username}?start=scope_${scopeId}`;

  ctx.api.raw.editMessageReplyMarkup({
    inline_message_id: inlineMsgId,
    reply_markup: {
      inline_keyboard: [[{ text: ctx.t("inline_join_btn"), url }]],
    },
  }).catch(() => {});
}
