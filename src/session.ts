import { Context, SessionFlavor } from "grammy";
import { RedisAdapter } from "@grammyjs/storage-redis";
import { redis } from "./redis.js";
import { TFunction } from "./i18n/index.js";

export type SessionState =
  | "IDLE"
  | "WAITING_FOR_GIF_ACTION"
  | "WAITING_FOR_NEW_TAGS"
  | "WAITING_TO_REPLACE_TAGS"
  | "WAITING_TO_APPEND_TAGS"
  | "WAITING_FOR_UPLOAD"
  | "WAITING_FOR_REPLACEMENT"
  | "WAITING_FOR_NAME";

export type ScopeIntent = "tags" | "add" | "manage" | "members" | "invite" | "stats" | "backup" | "rename";
export interface Confirmation {
  token: string;
  messageId: number;
  expiresAt: number;
  scopeId: string;
  action: "delete" | "kick" | "promote" | "demote" | "handover" | "close" | "edit" | "leave";
  targetId?: number;
  gifUniqueId?: string;
  tags?: string[];
  emojis?: string[];
  awaitingName?: boolean;
}

export interface SessionData {
  state: SessionState;
  /**
   * @deprecated Active scope now lives in `user_active_scope:{userId}` (no TTL).
   * Retained only so `resolveScope` can migrate sessions written before the move.
   */
  activeScopeId?: string;
  // Scope captured at the start of a multi-step GIF operation
  pendingScopeId?: string;
  pendingGifUniqueId?: string;
  pendingFileId?: string;
  pendingOperationId?: string;
  pendingMessageId?: number;
  pendingExpiresAt?: number;
  pendingCaption?: string;
  pendingIntent?: ScopeIntent;
  pendingSelectionToken?: string;
  pendingSelectionMessageId?: number;
  pendingSelectionExpiresAt?: number;
  pendingNameAction?: "create" | "rename";
  paused?: boolean;
  confirmation?: Confirmation;
}

export type MyContext = Context &
  SessionFlavor<SessionData> & {
    // Resolved by scope middleware: group chat_id, or the user's active scope
    currentScopeId?: string;
    // Injected by i18n middleware — synchronous translation function
    t: TFunction;
  };

export function createRedisStorage(): RedisAdapter<SessionData> {
  return new RedisAdapter<SessionData>({ instance: redis, ttl: 3600 });
}

export function initialSessionData(): SessionData {
  return { state: "IDLE" };
}

/** Keep private chat keys compatible; discard unsafe shared group sessions. */
export function getSessionKey(ctx: Pick<Context, "chat" | "from">): string | undefined {
  if (!ctx.chat || !ctx.from) return undefined;
  return ctx.chat.type === "private" ? String(ctx.chat.id) : `${ctx.chat.id}:${ctx.from.id}`;
}

export function clearPendingOperation(session: SessionData): void {
  session.state = "IDLE";
  session.pendingScopeId = undefined;
  session.pendingGifUniqueId = undefined;
  session.pendingFileId = undefined;
  session.pendingOperationId = undefined;
  session.pendingMessageId = undefined;
  session.pendingExpiresAt = undefined;
  session.pendingCaption = undefined;
  session.pendingIntent = undefined;
  session.pendingSelectionToken = undefined;
  session.pendingSelectionMessageId = undefined;
  session.pendingSelectionExpiresAt = undefined;
  session.pendingNameAction = undefined;
  session.paused = undefined;
  session.confirmation = undefined;
}
