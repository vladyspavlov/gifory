import { MyContext } from "../session.js";
import { getScope, getScopeMembers } from "../scopes.js";
import { getUserProfiles } from "../users.js";

/**
 * Resolves the user an admin command is aimed at, in order of reliability:
 *   1. the author of the replied-to message
 *   2. a numeric Telegram user ID argument
 *   3. an @username argument
 *
 * Telegram exposes no username → ID lookup, so (3) is resolved against the
 * cached profiles of the scope's own members. A username outside the community
 * is therefore unresolvable — which is fine, since every command using this
 * only acts on members anyway.
 */
export async function resolveTargetUser(
  ctx: MyContext,
  scopeId: string
): Promise<number | null> {
  const replyFrom = ctx.message?.reply_to_message?.from;
  if (replyFrom && !replyFrom.is_bot) return replyFrom.id;

  const arg = ctx.message?.text?.split(/\s+/)[1];
  if (!arg) return null;

  const id = Number(arg);
  if (Number.isInteger(id) && id > 0) return id;

  if (!arg.startsWith("@")) return null;
  const username = arg.slice(1).toLowerCase();
  if (!username) return null;

  const scope = await getScope(scopeId);
  const members = await getScopeMembers(scopeId);
  const candidates = [...new Set([...(scope?.admin_ids ?? []), ...members])];

  const profiles = await getUserProfiles(candidates);
  for (const [userId, profile] of profiles) {
    if (profile.username?.toLowerCase() === username) return userId;
  }

  return null;
}
