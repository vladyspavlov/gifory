import { redis } from "./redis.js";

function currentWeekKey(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export async function recordGifUsage(gifId: string, scopeId: string): Promise<void> {
  const totalKey = `stats:total:${scopeId}`;
  const weeklyKey = `stats:week:${scopeId}:${currentWeekKey()}`;
  await Promise.all([
    redis.zincrby(totalKey, 1, gifId),
    redis.zincrby(weeklyKey, 1, gifId).then(() =>
      redis.expire(weeklyKey, 14 * 86400)
    ),
  ]);
}

export interface GifStat {
  gifId: string;
  count: number;
}

export async function getTopGifs(
  scopeId: string,
  period: "total" | "week",
  limit = 5
): Promise<GifStat[]> {
  const key =
    period === "total"
      ? `stats:total:${scopeId}`
      : `stats:week:${scopeId}:${currentWeekKey()}`;

  const raw = await redis.zrevrange(key, 0, limit - 1, "WITHSCORES");
  const stats: GifStat[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    stats.push({ gifId: raw[i], count: Number(raw[i + 1]) });
  }
  return stats;
}
