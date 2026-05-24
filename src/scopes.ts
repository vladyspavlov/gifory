import { randomBytes } from "crypto";
import { redis } from "./redis.js";

export interface Scope {
  id: string;
  name: string;
  type: "group" | "manual";
  admin_ids: number[];
  created_at: number;
}

export async function createScope(
  id: string,
  name: string,
  type: "group" | "manual",
  adminIds: number[]
): Promise<Scope> {
  const scope: Scope = { id, name, type, admin_ids: adminIds, created_at: Date.now() };
  await redis.set(`scope:${id}`, JSON.stringify(scope));
  for (const adminId of adminIds) {
    await redis.sadd(`user_scopes:${adminId}`, id);
  }
  return scope;
}

export async function getScope(id: string): Promise<Scope | null> {
  const data = await redis.get(`scope:${id}`);
  return data ? (JSON.parse(data) as Scope) : null;
}

export async function updateScope(scope: Scope): Promise<void> {
  await redis.set(`scope:${scope.id}`, JSON.stringify(scope));
}

export async function getAllScopes(): Promise<Scope[]> {
  const keys = await redis.keys("scope:*");
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  return values.filter(Boolean).map((v) => JSON.parse(v!) as Scope);
}

export async function getUserScopes(userId: number): Promise<Scope[]> {
  const scopeIds = await redis.smembers(`user_scopes:${userId}`);
  if (scopeIds.length === 0) return [];
  const scopes = await Promise.all(scopeIds.map(getScope));
  return scopes.filter(Boolean) as Scope[];
}

export async function getScopeAdmins(scopeId: string): Promise<number[]> {
  const scope = await getScope(scopeId);
  return scope?.admin_ids ?? [];
}

export async function isAdminOfScope(userId: number, scopeId: string): Promise<boolean> {
  const scope = await getScope(scopeId);
  return scope?.admin_ids.includes(userId) ?? false;
}

export async function isMemberOfScope(userId: number, scopeId: string): Promise<boolean> {
  const scope = await getScope(scopeId);
  if (!scope) return false;
  if (scope.type === "group") return true;
  const result = await redis.sismember(`scope_members:${scopeId}`, String(userId));
  return result === 1;
}

export async function addUserToScope(userId: number, scopeId: string): Promise<void> {
  await redis.sadd(`user_scopes:${userId}`, scopeId);
  await redis.sadd(`scope_members:${scopeId}`, String(userId));
}

export async function syncGroupAdmins(scopeId: string, adminIds: number[]): Promise<void> {
  const scope = await getScope(scopeId);
  if (!scope) return;
  scope.admin_ids = adminIds;
  await updateScope(scope);
  for (const adminId of adminIds) {
    await redis.sadd(`user_scopes:${adminId}`, scopeId);
  }
}

export async function createInviteToken(scopeId: string): Promise<string> {
  const token = randomBytes(8).toString("hex");
  await redis.set(`invite:${token}`, scopeId, "EX", 86400);
  return token;
}

export async function consumeInviteToken(
  token: string,
  userId: number
): Promise<string | null> {
  const scopeId = await redis.get(`invite:${token}`);
  if (!scopeId) return null;
  await addUserToScope(userId, scopeId);
  await redis.del(`invite:${token}`);
  return scopeId;
}

export function generateScopeId(): string {
  return randomBytes(6).toString("hex");
}
