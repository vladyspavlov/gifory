# Gifory — Code & UX Review

**Date:** 2026-08-11
**Reviewed at:** commit `3ebc6ab` (matches production on the Oracle VPS as of this date)
**Scope:** all of `src/` and `scripts/` (~2,570 lines), plus `Dockerfile`, `docker-compose.yml`, `tsconfig.json`, and the live Telegram configuration of the production bot `@giforybot` (`getMe`, `getMyName`, `getMyCommands`, `getMyDescription`, `getMyShortDescription`).

Findings are ordered by severity. Every item cites the file and line it was found at.

---

## Status

UX findings were fixed on 2026-08-11 (see the ✅ markers below). Everything else — the P1 privacy findings, and the P2 build/ops findings — remains open.

**Fixed:** P0 #2, #3, #4 · P2 #12 · all P3 duplication and dead-key items · every item in "UX gaps" except scope deletion.

**Open:** P0 #1 (needs your decision) · P1 #5, #6, #7 · P2 #8, #9, #10, #11, #13 · remaining P3 items.

---

## P0 — Live, user-facing, wrong right now

### 1. The local `.env` points at a different bot

Production polls as **`@giforybot`** (bot id `8718778676`, display name "Gifory") — confirmed from the VPS logs. The `BOT_TOKEN` in the local `.env` belongs to bot id `8600947442`, **`@aliftina_gifs_bot`** — the bot's earlier, pre-rename identity.

This is harmless as long as it is deliberate: a separate dev bot is the correct local setup, because both tokens cannot long-poll at once. Pointing local `.env` at the production token and running `npm run dev` would trigger `409 Conflict` and **pull live updates away from the VPS**.

**Action:** decide explicitly which it is. If `@aliftina_gifs_bot` is the intended dev bot, note that in `.env.example`. If it is just stale, replace it — but never with the production token while the VPS is polling.

### 2. No commands are registered with Telegram ✅ fixed

`getMyCommands` returns `[]` on `@giforybot`, and there is no `setMyCommands` call anywhere in the codebase. Users get no autocomplete menu for the 14 commands the bot supports, so `/help` is the only discovery path.

This is the one remaining gap in the bot's Telegram-side configuration: the name ("Gifory"), description, and short description are all set correctly in BotFather.

**Fix:** call `bot.api.setMyCommands(...)` at startup in `src/index.ts`, ideally per-language via `language_code`.

### 3. The active community silently resets every hour ✅ fixed

`activeScopeId` is stored in the session (`src/session.ts:15`), and the Redis session TTL is `3600` seconds (`src/session.ts:31`).

An admin who selects a community in private chat and returns 90 minutes later is back to "no scope selected" — every subsequent GIF upload dumps them into the scope picker. The same TTL silently kills a half-finished tagging flow (`WAITING_FOR_NEW_TAGS` and friends).

Scope selection is a *preference*, not session state. `user_lang` is already stored persistently outside the session; `activeScopeId` should be too.

**Fix:** move `activeScopeId` to its own Redis key (`user_active_scope:{userId}`, no TTL). Keep the pending-GIF fields in the session where a TTL is appropriate.

### 4. "You don't have permission" is the catch-all reply to everything ✅ fixed

`src/middleware/isAdmin.ts:12` replies on failure, and it is the terminal middleware in the chain (`src/bot.ts:173`).

Any unrecognized private message from a user without a scope — including a plain "hi" from someone who just discovered the bot — receives *"You don't have permission to add or edit GIFs. You can only search."*

**Fix:** distinguish three cases:
- no scope selected → show the scope picker
- has scope, not an admin → the current message
- unrecognized input → nudge toward `/help`

---

## P1 — Security and privacy

### 5. HTML injection in `/members`, `/kick`, `/promote`

`formatUserLink` (`src/users.ts:84`) interpolates `first_name` / `last_name` / `username` into `<a href="tg://user?id=...">{label}</a>`, and `src/handlers/onMembers.ts:65` sends the result with `parse_mode: "HTML"`. `onKick.ts:56` and `onPromote.ts:60` do the same.

- A user whose display name contains `<` breaks the message — Telegram returns 400 and the admin sees nothing at all.
- A deliberately-named user (`<a href="https://evil.example">Admin</a>`) injects a clickable link into an admin-facing member list.

`members_header` has the same problem with `scope.name`, which any admin controls via `/rename` and any group controls via its chat title.

**Fix:** HTML-escape every interpolated value (`&`, `<`, `>`) before it reaches a `parse_mode: "HTML"` message.

### 6. Scope IDs are permanent bearer tokens

`/start scope_<id>` (`src/handlers/onJoinScope.ts:44`) joins anyone to any scope, with no verification and no expiry.

That same scope ID is embedded in the join button attached to **every inline GIF result** (`src/handlers/onInline.ts:65`), which travels into whatever chat the GIF is posted to.

Net effect: post one GIF from a community into a public chat, and everyone in that chat can permanently join that community and read its entire archive. The `/invite` system — 24-hour TTL, revocable, admin-gated — is bypassed completely by this path.

Whether or not the viral behavior is intended, the consequence should be stated plainly: **there is currently no such thing as a private community.**

**Fix (if privacy is wanted):** make the direct-join button opt-in per scope, or have it create a join *request* that an admin approves, rather than granting membership outright.

### 7. Leaving a group never revokes access

There is no `chat_member` handler anywhere — only `my_chat_member`, which tracks the bot's own membership (`src/handlers/onMyChatMember.ts`).

`user_scopes:{userId}` retains the group forever, and `getUserScopes` is what drives inline search. A user who leaves or is banned from a group keeps searching that group's GIF archive indefinitely.

`/kick` cannot help: it hard-refuses group scopes (`src/handlers/onKick.ts:29`), and `isMemberOfScope` returns `true` unconditionally for group scopes (`src/scopes.ts:64`).

**Fix:** handle `chat_member` updates and call `removeUserFromScope` on `left` / `kicked`.

---

## P2 — Correctness and operations

### 8. Builds are not reproducible

There is no `package-lock.json`, and the Dockerfile runs `npm install` (`Dockerfile:5`). Every `--build` re-resolves the `^` ranges from scratch — including `typescript: ^6.0.2` and `@types/node: ^25.6.0`.

A rebuild months from now can fail to compile or change runtime behavior, with no known-good dependency state to roll back to. On a bot that deploys by rebuilding in place on the VPS, this is the highest-variance operational risk in the repo.

**Fix:** commit `package-lock.json` and switch the Dockerfile to `npm ci`.

### 9. No graceful shutdown

No `SIGTERM` / `SIGINT` handler exists and `bot.stop()` is never called. On `docker compose up -d --build`, the container is killed mid-poll and the update offset is not committed, so updates can be reprocessed — a GIF upload can be handled twice.

**Fix:** `process.once("SIGTERM", () => bot.stop())` (and `SIGINT`) in `src/index.ts`.

### 10. `analytics:usage` grows without bound

`trackUsage` (`src/analytics.ts:24`) adds a uniquely-suffixed member per GIF send, and nothing ever trims the sorted set. It is the one analytics key not bounded by an entity count — it grows monotonically for the life of the bot.

**Fix:** periodically `ZREMRANGEBYSCORE` entries older than 30 days, and keep the all-time total as a separate `INCR` counter.

### 11. Weekly backup caption is hardcoded Ukrainian

`src/backup.ts:28` sends `"📦 Щотижневий бекап — ..."` directly, bypassing i18n. English-speaking scope admins receive a Ukrainian DM every Sunday. This is precisely the rule CLAUDE.md states: no user-facing string belongs outside `src/i18n/`.

**Fix:** resolve the recipient's language with `getUserLang(recipient)` and use `t(lang, ...)`, as `src/broadcast.ts:18` already does correctly.

### 12. Errors are invisible to users ✅ fixed

`bot.catch` (`src/bot.ts:176`) logs and returns. Any handler failure leaves the user staring at nothing, with no indication the bot even received the message.

**Fix:** reply with a generic localized error string from the catch handler where `ctx.chat` is available.

### 13. `replaceGif` is not atomic

`src/meili.ts:155-164` adds the new document and then deletes the old one, with no rollback. A failure between the two leaves both, so the GIF appears twice in search results.

---

## P3 — Code quality

- ✅ ~~`parseTargetUserId` duplicated in `onKick.ts` and `onPromote.ts`~~ — extracted to `src/utils/target.ts`.
- ✅ ~~`onScopes` and `promptScopeSelect` near-identical~~ — both now wrap a shared `showScopePicker`.
- ✅ ~~Four dead i18n keys~~ — removed from both locales (`scope_set` too, dead after the picker rework).
- `src/handlers/onInvite.ts:30` calls `ctx.api.getMe()` on every invocation instead of using the cached `ctx.me`.
- `src/middleware/auth.ts` is a pure passthrough — a dead abstraction left over from the pre-scope, allowlist-based design.
- `getAllScopes` uses `redis.keys("scope:*")` (`src/scopes.ts:38`), which is blocking and O(N). Only the weekly backup hits it, so impact is low, but `SCAN` is the correct call.
- `.dockerignore` excludes `meili_data` but **not `redis_data`** — the entire Redis dump is shipped into every build context. `.git` is also missing.
- The container runs as root; there is no `HEALTHCHECK`; and neither `redis` nor `meilisearch` has a memory limit in `docker-compose.yml`.

---

## UX gaps worth a roadmap line

All fixed on 2026-08-11 except scope deletion.

- ✅ ~~**No `/leave`.**~~ Added: `/leave` shows a picker, then a confirmation step, and refuses to let the sole admin of a community orphan it. **Scope deletion is still missing** — it needs a decision about what happens to the GIFs, so it was left out deliberately.
- ✅ ~~`/kick` and `/promote` require a numeric user ID.~~ `@username` now resolves against the cached profiles of the community's own members (Telegram exposes no username → ID API, and these commands only ever act on members).
- ✅ ~~`/rename` accepts unbounded input.~~ Both `/rename` and `/create` now cap names at 64 characters.
- ✅ ~~`/stats` performs N sequential `getDocument` calls.~~ Documents are de-duplicated across both top-lists and fetched once, in parallel.
- ✅ ~~A successful GIF add confirms with only a 👍 reaction.~~ The bot now echoes the tags and emojis it actually parsed, so a malformed `#tag` is visible immediately.

---

## What is in good shape

- **i18n discipline is real.** Both locales carry exactly 85 keys with no drift, no duplicates, and no missing entries on either side. Ukrainian is genuinely maintained as a first-class locale rather than a stale translation.
- **Scope isolation holds.** Every Meilisearch operation in `src/meili.ts` takes a `scopeId`, and no query was found missing its `scope_id` filter. The `${scopeId}_${fileUniqueId}` primary key correctly keeps the same GIF in two communities as two independent documents.
- **The multi-step flows are scope-safe.** `pendingScopeId` is captured alongside `pendingGifUniqueId` (`src/session.ts:18`), so a tagging flow stays bound to the scope it started in even if the user switches active scope midway.
- **The expired-`file_id` healing path** (`onInline.ts:76-93`, `meili.ts:203-218`) is a thoughtful piece of engineering: it catches `DOCUMENT_INVALID`, probes each file individually, marks the dead ones, and re-answers — preserving tag metadata rather than deleting the record.

---

## Documentation follow-ups

✅ Both resolved. `CLAUDE.md` now lists `src/broadcast.ts` (plus the new `src/commands.ts` and `src/utils/target.ts`), documents the `expired?: boolean` field on `GifDocument`, and records `user_active_scope:{userId}` in the Redis key table.

---

## Suggested first branch

Findings **#2 and #3** are small, high-impact, and mutually independent: registering the command list, and moving `activeScopeId` out of the TTL'd session. Both fix things users hit today. Finding **#4** is slightly larger but is the single biggest first-impression improvement.
