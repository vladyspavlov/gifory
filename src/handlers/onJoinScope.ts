import { MyContext } from "../session.js";
import { consumeInviteToken, getScope } from "../scopes.js";

export async function onJoinScope(ctx: MyContext): Promise<void> {
  const text = ctx.message?.text ?? "";

  // Accepts both /join <token> and /start join_<token> (deep link)
  let token = "";
  const joinMatch = text.match(/^\/join\s+(\S+)/i);
  const startMatch = text.match(/^\/start\s+join_(\S+)/i);

  if (joinMatch) token = joinMatch[1];
  else if (startMatch) token = startMatch[1];

  if (!token) {
    await ctx.reply(ctx.t("join_needs_token"));
    return;
  }

  const userId = ctx.from!.id;
  const scopeId = await consumeInviteToken(token, userId);

  if (!scopeId) {
    await ctx.reply(ctx.t("join_invalid"));
    return;
  }

  const scope = await getScope(scopeId);
  ctx.session.activeScopeId = scopeId;

  await ctx.reply(ctx.t("join_success", { name: scope?.name ?? scopeId }));
}
