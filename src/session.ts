import { Context, SessionFlavor } from "grammy";
import { Redis } from "ioredis";
import { RedisAdapter } from "@grammyjs/storage-redis";
import { REDIS_HOST } from "./config.js";

export type SessionState =
  | "IDLE"
  | "WAITING_FOR_NEW_TAGS"
  | "WAITING_TO_REPLACE_TAGS"
  | "WAITING_TO_APPEND_TAGS";

export interface SessionData {
  state: SessionState;
  pendingGifUniqueId?: string;
  pendingFileId?: string;
}

export type MyContext = Context & SessionFlavor<SessionData>;

export function createRedisStorage(): RedisAdapter<SessionData> {
  const redis = new Redis({ host: REDIS_HOST, port: 6379 });

  redis.on("error", (err) => {
    console.error("[Redis] Connection error:", err);
  });

  return new RedisAdapter<SessionData>({ instance: redis, ttl: 3600 });
}

export function initialSessionData(): SessionData {
  return { state: "IDLE" };
}