import type { Api } from "grammy";
import type { ChatMember } from "grammy/types";
import { getScope, getUserScopes, isMemberOfScope, removeUserFromScope, type Scope } from "./scopes.js";
import { mapLimit } from "./utils/concurrency.js";

export function isChatMember(member: ChatMember): boolean {
  return member.status === "creator" || member.status === "administrator" || member.status === "member" ||
    (member.status === "restricted" && member.is_member);
}

/** Fail closed on Telegram outages without deleting membership on uncertain errors. */
async function verifiedGroupMember(api: Api, userId: number, scope: Scope): Promise<ChatMember | null> {
  try {
    const member = await api.getChatMember(scope.id, userId);
    if (isChatMember(member)) return member;
    await removeUserFromScope(userId, scope.id, { protectLastAdmin: false });
  } catch (error) {
    console.warn(`[Access] Could not verify membership in ${scope.id}:`, error instanceof Error ? error.message : error);
  }
  return null;
}

export async function canAccessScope(api: Api, userId: number, scopeId: string): Promise<boolean> {
  const scope = await getScope(scopeId);
  if (!scope) return false;
  if (scope.type === "manual") return isMemberOfScope(userId, scopeId);
  return (await verifiedGroupMember(api, userId, scope)) !== null;
}

export async function canAdminScope(api: Api, userId: number, scopeId: string): Promise<boolean> {
  const scope = await getScope(scopeId);
  if (!scope?.admin_ids.includes(userId)) return false;
  if (scope.type === "manual") return true;
  const member = await verifiedGroupMember(api, userId, scope);
  return member?.status === "administrator" || member?.status === "creator";
}

export async function getAccessibleScopes(api: Api, userId: number): Promise<Scope[]> {
  const scopes = await getUserScopes(userId);
  const accessible = await mapLimit(scopes, 4, async scope =>
    await canAccessScope(api, userId, scope.id) ? scope : null);
  return accessible.filter((scope): scope is Scope => scope !== null);
}
