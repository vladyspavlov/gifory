import { redis } from "./redis.js";

const KEYS = {
  users:  "analytics:users",
  usage:  "analytics:usage",
  scopes: "analytics:scopes",
  gifs:   "analytics:gifs",
};

function startOf(daysAgo: number): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Record a user's first interaction (NX = only insert if not already present). */
export async function trackUser(userId: number): Promise<void> {
  await redis.zadd(KEYS.users, "NX", Date.now(), String(userId));
}

/** Record one inline GIF send. */
export async function trackUsage(userId: number): Promise<void> {
  const member = `${Date.now()}:${userId}:${Math.random().toString(36).slice(2, 6)}`;
  await redis.zadd(KEYS.usage, Date.now(), member);
}

/** Record a new scope creation. */
export async function trackScope(scopeId: string): Promise<void> {
  await redis.zadd(KEYS.scopes, Date.now(), scopeId);
}

/** Record a new GIF added to the archive. */
export async function trackGif(gifDocId: string): Promise<void> {
  await redis.zadd(KEYS.gifs, Date.now(), gifDocId);
}

interface PeriodStats {
  today: number;
  week: number;
  month: number;
  allTime: number;
}

async function countPeriods(key: string): Promise<PeriodStats> {
  const todayMs  = startOf(0);
  const weekMs   = startOf(7);
  const monthMs  = startOf(30);

  const [today, week, month, allTime] = await Promise.all([
    redis.zcount(key, todayMs, "+inf"),
    redis.zcount(key, weekMs,  "+inf"),
    redis.zcount(key, monthMs, "+inf"),
    redis.zcard(key),
  ]);

  return { today, week, month, allTime };
}

export interface AnalyticsSnapshot {
  users:  PeriodStats;
  usage:  PeriodStats;
  scopes: PeriodStats;
  gifs:   PeriodStats;
}

export async function getAnalytics(): Promise<AnalyticsSnapshot> {
  const [users, usage, scopes, gifs] = await Promise.all([
    countPeriods(KEYS.users),
    countPeriods(KEYS.usage),
    countPeriods(KEYS.scopes),
    countPeriods(KEYS.gifs),
  ]);
  return { users, usage, scopes, gifs };
}
