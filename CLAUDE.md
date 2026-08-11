# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Gifory** — a public multi-tenant Telegram bot (grammY + TypeScript) for archiving and inline-searching GIFs. Each community is a **scope** with its own GIF collection, admins, and members. Inline search merges results across every scope the querying user belongs to.

**This bot is live in production.** It runs on an Oracle VPS at `/opt/gifory` and serves real users right now. Assume any change you make is one `git pull` away from production — see [Deployment](#deployment).

## Deployment

Deployment, logs, container health, and anything else touching the Oracle VPS: **use the `oracle-vps` skill** (`.claude/skills/oracle-vps/SKILL.md`). Do not improvise SSH or Docker commands against the server — the skill carries the correct paths, the no-`sudo` rule, and the data directories that must never be deleted.

Never edit files directly on the VPS. Change → commit → push → pull on the VPS.

## Commands

The project builds inside Docker; there is no local `node_modules` and **no test suite**.

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
  → authMiddleware            (src/middleware/auth.ts — passthrough; bot is public)
  → session                   (Redis, 3600s TTL)
  → i18nMiddleware            (sets ctx.t() from stored lang → Telegram language_code → "en")
  → profile cache             (fire-and-forget saveUserProfile + trackUser)
  → resolveScope              (sets ctx.currentScopeId)
  → my_chat_member            (group join/leave lifecycle)
  → inline_query / chosen_inline_result   (no scope context — merges all user scopes)
  → public commands           (/tags /scopes /create /join /lang /help /start /botstats)
  → onKeyboardButton          (message:text — reply-keyboard labels, before the admin gate)
  → isAdmin gate              (src/middleware/isAdmin.ts — scope-specific)
  → adminComposer             (GIF upload, /edit /del /backup /invite /stats /members
                               /kick /promote /rename /syncadmins, gif: callbacks, text state machine)
```

**Scope resolution** (`resolveScope` in `src/bot.ts`):
- Group/supergroup → `ctx.currentScopeId = String(chat.id)`; the scope is auto-created on first interaction (Telegram group admins become scope admins, one time only — later changes need `/syncadmins`), and the sender is added as a member.
- Private chat → `ctx.currentScopeId = ctx.session.activeScopeId`, chosen via `/scopes`.
- Inline query → **no** `currentScopeId`; `onInline` reads all of the user's scopes and merges hits.

**Services** (`docker-compose.yml`, project name `gifory`):
- `bot` — Node 24 Alpine, runs `dist/src/index.js`
- `redis` — sessions + all relational-ish state, append-only persistence
- `meilisearch` — the GIF search index

## Key files

| File | Role |
|---|---|
| `src/index.ts` | Entry: init Meilisearch, create bot, start backup cron, long-poll |
| `src/bot.ts` | Middleware chain, scope resolution, i18n injection, all handler registration |
| `src/scopes.ts` | Scope CRUD, membership, admin sync, invite tokens (Redis) |
| `src/redis.ts` | The single shared `ioredis` client — import this, don't construct new ones |
| `src/meili.ts` | Every Meilisearch operation; all of them take a `scopeId` |
| `src/session.ts` | `SessionData`, state machine states, `MyContext` (adds `currentScopeId` + `t`) |
| `src/config.ts` | Env loading; `BOT_TOKEN` required, everything else defaulted |
| `src/i18n/` | `en.ts`, `uk.ts` (all UI strings), `index.ts` (`t()`, `getUserLang`, `setUserLang`) |
| `src/stats.ts` | Per-scope GIF usage (Redis sorted sets) → `/stats` |
| `src/analytics.ts` | Bot-wide counters (users/usage/scopes/gifs) → `/botstats` |
| `src/users.ts` | Cached Telegram profiles + `formatUserLink()` for member lists |
| `src/keyboard.ts` | Persistent reply keyboard |
| `src/backup.ts` | Weekly cron (Sunday 03:00) — per-scope JSON backup DM'd to the first scope admin |
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
| `invite:{token}` | scopeId, TTL 24h |
| `scope_invites:{scopeId}` | Set of live tokens (for `/invite` revocation) |
| `user_lang:{userId}` | `"en"` \| `"uk"` — explicit override only |
| `user_profile:{userId}` | Cached Telegram profile, TTL 30d |
| `stats:total:{scopeId}` | Sorted set: member = gifId, score = all-time uses |
| `stats:week:{scopeId}:{YYYY-Www}` | Same, weekly, TTL 14d |
| `analytics:{users,usage,scopes,gifs}` | Sorted sets scored by timestamp (period counts) |

## Session state machine

`IDLE` → `WAITING_FOR_NEW_TAGS` (GIF posted with no caption tags) / `WAITING_TO_REPLACE_TAGS` / `WAITING_TO_APPEND_TAGS` (both entered from the duplicate-GIF inline keyboard). `src/handlers/onText.ts` consumes these.

`pendingScopeId` is captured alongside `pendingGifUniqueId` so a multi-step flow stays bound to the scope it started in, even if the user switches active scope midway.

## Auth model

- `isAdmin` calls `isAdminOfScope(userId, ctx.currentScopeId)` — permissions are **per scope**, never global.
- Group scopes: Telegram group admins are synced at scope creation and on `/syncadmins`.
- Manual scopes: the creator is admin; others join via `/invite` → `/join <token>` or a `/start scope_<id>` deep link.
- Everyone (no membership needed): inline search of their own scopes, `/tags`, `/scopes`, `/create`, `/join`, `/lang`, `/help`.
- `SUPER_ADMIN_ID` (optional env) gates `/botstats` only.

## Conventions

- ESM throughout — **relative imports must carry the `.js` extension** (`./scopes.js`), even from `.ts` files. `moduleResolution: "NodeNext"`, `strict: true`.
- **No user-facing string belongs in a handler.** Add the key to both `src/i18n/en.ts` and `src/i18n/uk.ts` and call `ctx.t("key", { params })`. Ukrainian is a first-class locale, not a translation afterthought.
- New Meilisearch queries must filter by `scope_id`. A missing filter leaks one community's GIFs into another's search.
- Import the shared client from `src/redis.ts`; don't open new connections.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`.
- All markdown in this repo is written in English.

## Session continuity

`STATUS.md` tracks work across sessions (last completed / in progress / next steps / blockers). Read it at session start and update it as work completes.
