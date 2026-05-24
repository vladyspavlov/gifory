import { Api } from "grammy";
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

/** Fetch a user's profile from Telegram when it's not cached, then save it. */
export async function fetchAndCacheProfile(
  api: Api,
  userId: number,
  groupChatId?: string
): Promise<UserProfile | null> {
  // getChatMember is reliable for group chats the bot is in
  if (groupChatId) {
    try {
      const member = await api.getChatMember(groupChatId, userId);
      const u = member.user;
      const profile: UserProfile = {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        username: u.username,
      };
      await saveUserProfile(profile);
      return profile;
    } catch {}
  }

  // Fallback: getChat works if the user has ever started a private chat with the bot
  try {
    const chat = await api.getChat(userId);
    if ("first_name" in chat) {
      const c = chat as { first_name: string; last_name?: string; username?: string };
      const profile: UserProfile = {
        id: userId,
        first_name: c.first_name,
        last_name: c.last_name,
        username: c.username,
      };
      await saveUserProfile(profile);
      return profile;
    }
  } catch {}

  return null;
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
