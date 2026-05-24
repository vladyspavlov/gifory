import { redis } from "./redis.js";

export interface UserProfile {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export async function saveUserProfile(user: UserProfile): Promise<void> {
  await redis.set(`user_profile:${user.id}`, JSON.stringify(user), "EX", 30 * 86400);
}

export async function getUserProfile(userId: number): Promise<UserProfile | null> {
  const data = await redis.get(`user_profile:${userId}`);
  return data ? (JSON.parse(data) as UserProfile) : null;
}

export async function getUserProfiles(userIds: number[]): Promise<Map<number, UserProfile>> {
  if (userIds.length === 0) return new Map();
  const keys = userIds.map((id) => `user_profile:${id}`);
  const values = await redis.mget(...keys);
  const map = new Map<number, UserProfile>();
  for (let i = 0; i < userIds.length; i++) {
    const raw = values[i];
    if (raw) map.set(userIds[i], JSON.parse(raw) as UserProfile);
  }
  return map;
}

export function formatUserLink(userId: number, profile: UserProfile | null): string {
  let label: string;
  if (profile?.username) {
    label = `@${profile.username}`;
  } else if (profile?.first_name) {
    label = profile.last_name
      ? `${profile.first_name} ${profile.last_name}`
      : profile.first_name;
  } else {
    label = `User #${userId}`;
  }
  return `<a href="tg://user?id=${userId}">${label}</a>`;
}
