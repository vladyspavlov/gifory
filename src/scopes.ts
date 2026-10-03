import { randomBytes } from "node:crypto";
import { redis } from "./redis.js";
import { trackScope } from "./analytics.js";

export interface Scope {
  id: string;
  name: string;
  type: "group" | "manual";
  admin_ids: number[];
  created_at: number;
}

// Each mutation reads the current document inside Redis, avoiding lost updates.
const scopePrelude = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'not_member' end
local scope = cjson.decode(raw)
local function hasAdmin(id)
  for _, admin in ipairs(scope.admin_ids) do if tostring(admin) == id then return true end end
  return false
end
local function save()
  local encoded = cjson.encode(scope)
  encoded = string.gsub(encoded, '"admin_ids":{}', '"admin_ids":[]')
  redis.call('SET', KEYS[1], encoded)
end
`;

export async function createScope(id: string, name: string, type: Scope["type"], adminIds: number[]): Promise<Scope> {
  const scope: Scope = { id, name, type, admin_ids: [...new Set(adminIds)], created_at: Date.now() };
  const created = await redis.eval(`
    if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
    redis.call('SET', KEYS[1], ARGV[1])
    local scope = cjson.decode(ARGV[1])
    for _, admin in ipairs(scope.admin_ids) do
      redis.call('SADD', 'user_scopes:' .. tostring(admin), scope.id)
      redis.call('SADD', 'scope_members:' .. scope.id, tostring(admin))
    end
    return 1
  `, 1, `scope:${id}`, JSON.stringify(scope));
  if (created === 1) await trackScope(id).catch(console.error);
  return (await getScope(id))!;
}

export async function getScope(id: string): Promise<Scope | null> {
  const data = await redis.get(`scope:${id}`);
  return data ? JSON.parse(data) as Scope : null;
}

export async function getAllScopes(): Promise<Scope[]> {
  const scopes: Scope[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "scope:*", "COUNT", 100);
    cursor = next;
    if (keys.length) {
      const values = await redis.mget(...keys);
      for (const value of values) if (value) scopes.push(JSON.parse(value) as Scope);
    }
  } while (cursor !== "0");
  return [...new Map(scopes.map(scope => [scope.id, scope])).values()];
}

export async function getUserScopes(userId: number): Promise<Scope[]> {
  const ids = await redis.smembers(`user_scopes:${userId}`);
  const scopes = await Promise.all(ids.map(getScope));
  return scopes.filter((scope): scope is Scope => scope !== null);
}
export async function getScopeAdmins(scopeId: string): Promise<number[]> {
  return (await getScope(scopeId))?.admin_ids ?? [];
}
export async function isAdminOfScope(userId: number, scopeId: string): Promise<boolean> {
  return (await getScopeAdmins(scopeId)).includes(userId);
}
export async function isMemberOfScope(userId: number, scopeId: string): Promise<boolean> {
  const scope = await getScope(scopeId);
  return !!scope && (scope.admin_ids.includes(userId) ||
    await redis.sismember(`scope_members:${scopeId}`, String(userId)) === 1);
}
export async function addUserToScope(userId: number, scopeId: string): Promise<void> {
  await redis.eval(`
    if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
    redis.call('SADD', KEYS[2], ARGV[1])
    redis.call('SADD', KEYS[3], ARGV[2])
    return 1
  `, 3, `scope:${scopeId}`, `user_scopes:${userId}`, `scope_members:${scopeId}`, scopeId, String(userId));
}

export async function syncGroupAdmins(scopeId: string, adminIds: number[]): Promise<void> {
  await redis.eval(scopePrelude + `
    if scope.type ~= 'group' then return 'not_member' end
    scope.admin_ids = cjson.decode(ARGV[1])
    save()
    for _, admin in ipairs(scope.admin_ids) do
      redis.call('SADD', 'user_scopes:' .. tostring(admin), scope.id)
      redis.call('SADD', 'scope_members:' .. scope.id, tostring(admin))
    end
    return 'updated'
  `, 1, `scope:${scopeId}`, JSON.stringify([...new Set(adminIds)]));
}

export async function getActiveScopeId(userId: number): Promise<string | undefined> {
  return (await redis.get(`user_active_scope:${userId}`)) ?? undefined;
}
export async function setActiveScopeId(userId: number, scopeId: string): Promise<void> {
  await redis.set(`user_active_scope:${userId}`, scopeId);
}
export async function clearActiveScopeId(userId: number): Promise<void> {
  await redis.del(`user_active_scope:${userId}`);
}
export async function getScopeMembers(scopeId: string): Promise<number[]> {
  return (await redis.smembers(`scope_members:${scopeId}`)).map(Number).filter(Number.isSafeInteger);
}

export type RemovalResult = "removed" | "last_admin" | "not_member" | "forbidden";
export async function removeUserFromScope(
  userId: number, scopeId: string,
  options: { protectLastAdmin?: boolean; actorId?: number; revokeInvites?: boolean } = {}
): Promise<RemovalResult> {
  return await redis.eval(scopePrelude + `
    if ARGV[3] ~= '' and not hasAdmin(ARGV[3]) then return 'forbidden' end
    local isAdmin = hasAdmin(ARGV[1])
    local member = redis.call('SISMEMBER', KEYS[3], ARGV[1]) == 1
    if not isAdmin and not member then return 'not_member' end
    if ARGV[2] == '1' and isAdmin and #scope.admin_ids == 1 then return 'last_admin' end
    local admins = {}
    for _, admin in ipairs(scope.admin_ids) do
      if tostring(admin) ~= ARGV[1] then table.insert(admins, admin) end
    end
    scope.admin_ids = admins
    save()
    redis.call('SREM', KEYS[2], scope.id)
    redis.call('SREM', KEYS[3], ARGV[1])
    if redis.call('GET', KEYS[4]) == scope.id then redis.call('DEL', KEYS[4]) end
    if ARGV[4] == '1' then
      for _, token in ipairs(redis.call('SMEMBERS', KEYS[5])) do redis.call('DEL', 'invite:' .. token) end
      redis.call('DEL', KEYS[5])
    end
    return 'removed'
  `, 5, `scope:${scopeId}`, `user_scopes:${userId}`, `scope_members:${scopeId}`,
  `user_active_scope:${userId}`, `scope_invites:${scopeId}`, String(userId),
  options.protectLastAdmin === false ? "0" : "1", options.actorId === undefined ? "" : String(options.actorId),
  options.revokeInvites ? "1" : "0") as RemovalResult;
}

export async function promoteToAdmin(userId: number, scopeId: string, actorId?: number): Promise<boolean> {
  const result = await redis.eval(scopePrelude + `
    if ARGV[2] ~= '' and not hasAdmin(ARGV[2]) then return 'forbidden' end
    if scope.type ~= 'manual' or hasAdmin(ARGV[1]) then return 'not_member' end
    if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 0 then return 'not_member' end
    table.insert(scope.admin_ids, tonumber(ARGV[1]))
    save()
    redis.call('SADD', KEYS[3], scope.id)
    return 'updated'
  `, 3, `scope:${scopeId}`, `scope_members:${scopeId}`, `user_scopes:${userId}`, String(userId), actorId === undefined ? "" : String(actorId));
  return result === "updated";
}
export async function renameScope(scopeId: string, newName: string, actorId?: number): Promise<boolean> {
  const result = await redis.eval(scopePrelude + `
    if ARGV[2] ~= '' and not hasAdmin(ARGV[2]) then return 'forbidden' end
    scope.name = ARGV[1]
    save()
    return 'updated'
  `, 1, `scope:${scopeId}`, newName, actorId === undefined ? "" : String(actorId));
  return result === "updated";
}

export async function revokeAllInvites(scopeId: string): Promise<void> {
  await redis.eval(`
    for _, token in ipairs(redis.call('SMEMBERS', KEYS[1])) do redis.call('DEL', 'invite:' .. token) end
    redis.call('DEL', KEYS[1])
    return 1
  `, 1, `scope_invites:${scopeId}`);
}
export async function createInviteToken(scopeId: string, actorId?: number): Promise<string> {
  const token = randomBytes(8).toString("hex");
  const result = await redis.eval(scopePrelude + `
    if scope.type ~= 'manual' or (ARGV[2] ~= '' and not hasAdmin(ARGV[2])) then return 'forbidden' end
    redis.call('SET', KEYS[2], scope.id, 'EX', 86400)
    redis.call('SADD', KEYS[3], ARGV[1])
    redis.call('EXPIRE', KEYS[3], 86400)
    return 'updated'
  `, 3, `scope:${scopeId}`, `invite:${token}`, `scope_invites:${scopeId}`, token, actorId === undefined ? "" : String(actorId));
  if (result !== "updated") throw new Error("Invite scope missing or unauthorized");
  return token;
}
export async function consumeInviteToken(token: string, userId: number): Promise<string | null> {
  return await redis.eval(`
    local id = redis.call('GET', KEYS[1])
    if not id then return false end
    local raw = redis.call('GET', 'scope:' .. id)
    if not raw or cjson.decode(raw).type ~= 'manual' then return false end
    redis.call('DEL', KEYS[1])
    redis.call('SREM', 'scope_invites:' .. id, ARGV[1])
    redis.call('SADD', 'user_scopes:' .. ARGV[2], id)
    redis.call('SADD', 'scope_members:' .. id, ARGV[2])
    return id
  `, 1, `invite:${token}`, token, String(userId)) as string | null;
}
export function generateScopeId(): string { return randomBytes(6).toString("hex"); }

/** Manual community admins have equal authority; never remove the final admin. */
export async function changeAdminRole(scopeId: string, actorId: number, targetId: number, handover = false): Promise<boolean> {
  const result = await redis.eval(scopePrelude + `
    if scope.type ~= 'manual' or not hasAdmin(ARGV[1]) then return 'forbidden' end
    if redis.call('SISMEMBER', KEYS[2], ARGV[2]) == 0 then return 'not_member' end
    if ARGV[3] == '1' then
      if ARGV[1] == ARGV[2] then return 'forbidden' end
      if not hasAdmin(ARGV[2]) then table.insert(scope.admin_ids, tonumber(ARGV[2])) end
      local admins = {}
      for _, id in ipairs(scope.admin_ids) do if tostring(id) ~= ARGV[1] then table.insert(admins, id) end end
      scope.admin_ids = admins
    else
      if not hasAdmin(ARGV[2]) or #scope.admin_ids <= 1 then return 'last_admin' end
      local admins = {}
      for _, id in ipairs(scope.admin_ids) do if tostring(id) ~= ARGV[2] then table.insert(admins, id) end end
      scope.admin_ids = admins
    end
    save()
    return 'updated'
  `, 2, `scope:${scopeId}`, `scope_members:${scopeId}`, String(actorId), String(targetId), handover ? "1" : "0");
  return result === "updated";
}

/** Called only after scoped media deletion succeeds, under the update/snapshot lock. */
export async function closeManualScope(scopeId: string, actorId: number): Promise<boolean> {
  const result = await redis.eval(scopePrelude + `
    if scope.type ~= 'manual' or #scope.admin_ids ~= 1 or not hasAdmin(ARGV[1]) then return 'forbidden' end
    for _, user in ipairs(redis.call('SMEMBERS', KEYS[2])) do
      redis.call('SREM', 'user_scopes:' .. user, scope.id)
      if redis.call('GET', 'user_active_scope:' .. user) == scope.id then redis.call('DEL', 'user_active_scope:' .. user) end
    end
    for _, invite in ipairs(redis.call('SMEMBERS', KEYS[3])) do redis.call('DEL', 'invite:' .. invite) end
    redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4])
    redis.call('ZREM', 'analytics:scopes', scope.id)
    return 'closed'
  `, 4, `scope:${scopeId}`, `scope_members:${scopeId}`, `scope_invites:${scopeId}`, `stats:total:${scopeId}`, String(actorId));
  return result === "closed";
}
