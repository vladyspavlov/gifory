# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Gifory** — a public multi-tenant Telegram bot (grammY + TypeScript) for archiving and inline-searching GIFs. Each community is a **scope** with its own GIF collection, admins, and members. Inline search merges results across every scope the querying user belongs to.

**This bot is live in production.** It runs on an Oracle VPS at `/opt/gifory` and serves real users right now. Assume any change you make is one `git pull` away from production — see [Deployment](#deployment).

## Deployment

Deployment, logs, container health, and anything else touching the Oracle VPS: **use the `oracle-vps` skill** (`.claude/skills/oracle-vps/SKILL.md`). Do not improvise SSH or Docker commands against the server — the skill carries the correct paths, the no-`sudo` rule, and the data directories that must never be deleted.

Never edit files directly on the VPS. Change → commit → push → pull on the VPS.

## Commands

The project builds inside Docker; dependencies can be installed locally with `npm ci`. A regression suite now exists (`npm test` for offline checks; `bash scripts/check.sh` for Docker-based integration and recovery checks).

```bash
npm run build     # tsc → dist/  (only if you have deps installed locally)
npm run dev       # tsx watch src/index.ts
```

In practice, type-checking happens in the Docker builder stage: a TypeScript error is a failed image build. Verify a change by building, then reading `docker compose logs bot` (see the skill).

`scripts/migrate.ts` (`npm run migrate`) was a one-shot migration of the pre-scope archive into a "Legacy Archive" scope. It has already run. Do not re-run it.

## Architecture

**Request flow** (`src/bot.ts`, in registration order — grammY runs middleware in the order it is registered):

```
Telegram update (long polling)
  → state snapshot lock       (src/state.ts — serializes updates with backup capture)
  → authMiddleware            (src/middleware/auth.ts — passthrough; bot is public)
  → session                   (Redis, 3600s TTL; per-chat privately, per-chat/sender in groups)
  → i18nMiddleware            (sets ctx.t() from stored lang → Telegram language_code → "en")
  → profile cache             (awaited saveUserProfile + trackUser for consistent snapshots)
  → resolveScope              (sets ctx.currentScopeId)
  → my_chat_member / chat_member (bot lifecycle + user joins/departures/admin changes)
  → inline_query / chosen_inline_result   (no scope context — merges all user scopes)
  → public navigation         (/home /search /settings /cancel plus existing public commands)
  → onKeyboardButton          (message:text — reply-keyboard labels, before the admin gate)
  → guided flows/callbacks     (community cards, scoped catalogs/previews, confirmations, naming, retained uploads)
  → animation handler          (authorizes captured destination; group saving is deliberate)
  → isAdmin gate              (src/middleware/isAdmin.ts — scope-specific, live Telegram verification for groups)
  → adminComposer             (/add /manage /edit /del /backup /invite /stats /members
                               /kick /promote /rename /syncadmins, gif: callbacks, text state machine)
```

**Scope resolution** (`resolveScope` in `src/bot.ts`):
- Group/supergroup → `ctx.currentScopeId = String(chat.id)`; the scope is auto-created on first interaction (Telegram group admins become scope admins; later membership/admin updates and `/syncadmins` keep permissions aligned), and the sender is added as a member.
- Private chat → `ctx.currentScopeId` comes from `user_active_scope:{userId}`, explicitly chosen with the community card’s destination action. It lives **outside the session on purpose**: the session carries a 1h TTL, which used to reset the user's community roughly once an hour. `SessionData.activeScopeId` survives only as a deprecated migration path.
- Inline query → **no** `currentScopeId`; `onInline` reads all accessible scopes by default; `in:<scopeId> query` is emitted by community/tag buttons and reauthorized without fallback. Global presentation deduplicates GIFs but preserves the chosen scoped document ID.

**Services** (`docker-compose.yml`, project name `gifory`):
- `bot` — Node 24 Alpine, runs `dist/src/index.js`
- `redis` — sessions + all relational-ish state, append-only persistence
- `meilisearch` — the GIF search index

## Key files

| File | Role |
|---|---|
| `src/index.ts` / `src/lifecycle.ts` | Entry and coordinated startup/polling/health/shutdown |
| `src/bot.ts` | Middleware chain, scope resolution, i18n injection, all handler registration |
| `src/scopes.ts` | Scope CRUD, membership, admin sync, invite tokens (Redis) |
| `src/redis.ts` | The single shared `ioredis` client — import this, don't construct new ones |
| `src/meili.ts` | Every Meilisearch operation; all of them take a `scopeId` |
| `src/session.ts` | `SessionData`, state machine states, `MyContext` (adds `currentScopeId` + `t`) |
| `src/config.ts` | Env loading; `BOT_TOKEN` required, everything else defaulted |
| `src/i18n/` | `en.ts`, `uk.ts` (all UI strings), `index.ts` (`t()`, `getUserLang`, `setUserLang`) |
| `src/stats.ts` | Per-scope GIF usage (Redis sorted sets) → `/stats` |
| `src/broadcast.ts` | DMs scope admins when a new GIF is added |
| `src/commands.ts` | Publishes the Telegram command menu (per locale, per scope) at startup |
| `src/utils/target.ts` | Resolves `/kick` and `/promote` targets (reply / user ID / @username) |
| `src/analytics.ts` | Bot-wide counters (users/usage/scopes/gifs) → `/botstats` |
| `src/users.ts` | Cached Telegram profiles + `formatUserLink()` for member lists |
| `src/keyboard.ts` | Home reply keyboard (Search, Communities, Help, Settings) |
| `src/ui.ts` | Shared screen/input helpers, user-bound GIF handles, source-aware reply references |
| `src/handlers/onHome.ts` / `onNavigation.ts` | Home/settings/search and community action routing |
| `src/handlers/onManagement.ts` | Scoped GIF browser/previews, confirmations, role handover and manual closure |
| `src/backup.ts` | Weekly cron (Sunday 03:00 Europe/Kyiv) — full recovery archive to the owner + isolated archives to current scope admins; see BACKUP.md |
| `src/handlers/` | One file per update type / command |

## Data model

```typescript
interface GifDocument {
  id: string;             // `${scopeId}_${fileUniqueId}` — Meilisearch primary key
  file_unique_id: string; // Telegram file_unique_id (dedup within a scope)
  file_id: string;        // Telegram file_id (used to send)
  scope_id: string;
  tags: string[];
  emojis: string[];
  created_at: number;
  expired?: boolean;     // file_id confirmed unreachable; excluded from search
}

interface Scope {
  id: string;             // chat_id for groups, hex slug for manual scopes
  name: string;
  type: "group" | "manual";
  admin_ids: number[];
  created_at: number;
}
```

The same GIF in two scopes is **two documents** with different `id`s and the same `file_unique_id`. Never key anything on `file_unique_id` alone.

**Redis keys:**

| Key | Contents |
|---|---|
| `scope:{id}` | JSON `Scope` |
| `user_scopes:{userId}` | Set of scope IDs — drives inline search |
| `scope_members:{scopeId}` | Set of user IDs |
| `invite:{token}` | scopeId, single-use, TTL 24h |
| `scope_invites:{scopeId}` | Set of live tokens (for `/invite` revocation) |
| `user_lang:{userId}` | `"en"` \| `"uk"` — explicit override only |
| `user_active_scope:{userId}` | Active scope for private chats — **no TTL**, deliberately outside the session |
| `user_profile:{userId}` | Cached Telegram profile, TTL 30d |
| `stats:total:{scopeId}` | Sorted set: member = gifId, score = all-time uses |
| `stats:week:{scopeId}:{YYYY-Www}` | Same, weekly, TTL 14d |
| `analytics:{users,usage,scopes,gifs}` | Sorted sets scored by timestamp (usage events retained 31 days) |
| `analytics:usage_total` | Persistent all-time GIF usage counter |
| `notify_muted:{scopeId}:{userId}` | Per-community notification opt-out, no TTL |
| `ux:gif:{token}` | User-bound scope/GIF preview reference, TTL 1h |
| `ux:message:{chatId}:{messageId}` | Scoped preview/notification reply reference, TTL 30d |
| `ux:prompt:{chatId}:{messageId}` | Prompt owner for stale-input recovery, TTL 2h |
| `ux:commands:{userId}` | Private menu language/role/type cache, TTL 1h |

## Session state machine

`IDLE` → `WAITING_FOR_GIF_ACTION` (duplicate-GIF menu) / `WAITING_FOR_NEW_TAGS` (GIF posted with no caption tags) / `WAITING_TO_REPLACE_TAGS` / `WAITING_TO_APPEND_TAGS` (both entered from the duplicate-GIF inline keyboard). `src/handlers/onText.ts` consumes these.

`pendingScopeId` is captured alongside `pendingGifUniqueId` so a multi-step flow stays bound to the scope it started in, even if the user switches active scope midway. `WAITING_FOR_UPLOAD`, `WAITING_FOR_REPLACEMENT` and `WAITING_FOR_NAME` support guided flows. Incoming private uploads survive community selection and creation. Navigation pauses input; Resume refreshes the prompt, `/cancel` clears it, and prompts expire in 15 minutes. Confirmations carry an expiring token, scope/target and prompt message ID. Group input must reply to the latest prompt for that sender. Ordinary group animations and the bot’s own inline results are ignored. File replacement is explicit; delete/member actions are confirmed.

## Auth model

- `isAdmin` calls `isAdminOfScope(userId, ctx.currentScopeId)` — permissions are **per scope**, never global.
- Group scopes: Telegram admins are synced at creation, on membership/admin updates, and on `/syncadmins`; current membership/admin status is checked before access. The bot should be a Telegram group admin for reliable membership queries and updates.
- Manual scopes: the creator is admin; others join via `/invite` → `/join <token>` by an admin. `/start scope_<id>` opens a scope only after membership verification; it no longer grants access.
- Everyone (no membership needed): inline search of their own scopes, `/tags`, `/scopes`, `/create`, `/join`, `/lang`, `/help`.
- `SUPER_ADMIN_ID` gates `/botstats` and receives full recovery archives. It grants no per-scope permissions.

## Conventions

- ESM throughout — **relative imports must carry the `.js` extension** (`./scopes.js`), even from `.ts` files. `moduleResolution: "NodeNext"`, `strict: true`.
- **No user-facing string belongs in a handler.** Add the key to both `src/i18n/en.ts` and `src/i18n/uk.ts` and call `ctx.t("key", { params })`. Ukrainian is a first-class locale, not a translation afterthought.
- New Meilisearch queries must filter by `scope_id`. A missing filter leaks one community's GIFs into another's search.
- Import the shared client from `src/redis.ts`; don't open new connections.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`.
- All markdown in this repo is written in English.

## Session continuity

`STATUS.md` tracks work across sessions (last completed / in progress / next steps / blockers). Read it at session start and update it as work completes.

## Recovery and session isolation

- Private session keys remain chat IDs; group session keys include chat ID and sender ID. Old shared group pending operations are discarded. New GIF callbacks carry a per-operation token and match their prompt message.
- Weekly full recovery JSON includes Redis DUMP/absolute expiry entries, all scoped GIF documents, and Meilisearch settings/version. Only the configured owner receives full tenant data. Community admins receive isolated scope archives.
- `scripts/restore.ts` defaults to validation/dry run and requires `--apply` with empty replacement databases at matching engine versions. Production recovery and deployment still use the Oracle VPS skill.
- Redis usage history is retained for 31 days with all-time count in `analytics:usage_total`. Scope mutations and invite consumption are atomic Lua operations.
