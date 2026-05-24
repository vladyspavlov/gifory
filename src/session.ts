import { Context, SessionFlavor } from "grammy";
import { RedisAdapter } from "@grammyjs/storage-redis";
import { redis } from "./redis.js";

export type SessionState =
  | "IDLE"
  | "WAITING_FOR_NEW_TAGS"
  | "WAITING_TO_REPLACE_TAGS"
  | "WAITING_TO_APPEND_TAGS";

export interface SessionData {
  state: SessionState;
  // Active scope for private-chat operations (set via /scopes selector)
  activeScopeId?: string;
  // Scope captured at the start of a multi-step GIF operation
  pendingScopeId?: string;
  pendingGifUniqueId?: string;
  pendingFileId?: string;
}

export type MyContext = Context &
  SessionFlavor<SessionData> & {
    // Resolved by scope middleware: group chat_id or session activeScopeId
    currentScopeId?: string;
  };

export function createRedisStorage(): RedisAdapter<SessionData> {
  return new RedisAdapter<SessionData>({ instance: redis, ttl: 3600 });
}

export function initialSessionData(): SessionData {
  return { state: "IDLE" };
}
