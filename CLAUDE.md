# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Global Claude Code Rules

## Session Start Protocol
At the start of every session:
1. Read CLAUDE.md fully
2. Check if .claude/agents/ directory exists and contains agent files
3. Check if .claude/hooks/ directory exists and contains hook files
4. Activate the appropriate mode based on what is found (see below)
5. If STATUS.md exists — read it and continue from where work left off
6. If STATUS.md does not exist — create it before starting any work

---

## Agent Team Mode
*Active when .claude/agents/ contains agent definition files.*

- Always delegate tasks to the appropriate specialized agent based on domain
- Never mix responsibilities between agents
- Run the code reviewer agent last, before any git commit
- Do not commit code that has not passed the code reviewer agent
- Each agent must update STATUS.md after every completed subtask

---

## Solo Mode
*Active when no agent definitions are found.*

- You handle all domains yourself: backend, frontend, database, infra, review
- After completing each module, do a self-review before committing:
  - Check for security issues
  - Check for consistency with CLAUDE.md
  - Check test coverage
- Document self-review result in STATUS.md before committing

---

## Hooks Mode
*Active when .claude/hooks/ contains hook files.*

- Read all hook files in .claude/hooks/ to understand what is automated
- Do not manually perform any action that is already handled by a hook
- If a hook covers git add, do not run it manually
- If a hook covers formatting or linting, do not run those manually either
- Mention active hooks in STATUS.md under a "## Active Automation" section so the next session is aware

---

## Mode Combinations
All modes are independent and can be active simultaneously:

| Agents | Hooks | Behavior |
|---|---|---|
| ✅ | ✅ | Agent Team Mode + defer automated tasks to hooks |
| ✅ | ❌ | Agent Team Mode + handle all automation manually |
| ❌ | ✅ | Solo Mode + defer automated tasks to hooks |
| ❌ | ❌ | Solo Mode + handle all automation manually |

---

## Session Continuity (all modes)

Always maintain STATUS.md in the project root:

```markdown
## Last completed
- [agent or "solo"] [what was done] — [file paths affected]

## In progress
- [agent or "solo"] [what was being done] — [file paths] — [what exactly was left]

## Next steps (in order)
1. [agent or "solo"] — [exact task]
2. [agent or "solo"] — [exact task]

## Blockers
- [anything unclear or needs a decision]

## Active Automation
- [hook name] — [what it handles]
```

### Rules
- Update STATUS.md after every completed subtask
- When /status shows context at 70%+, commit current work and update STATUS.md before continuing
- Always commit completed work before ending a session

---

## Git Rules (all modes)
- Never commit without a code review step (agent or self-review)
- Only run git add -A manually if no hook already handles it
- Commit after every completed module, not at the end of everything
- Use conventional commit messages: feat:, fix:, chore:, docs:

---

## File Authoring
- All markdown files used by Claude Code must be written in English
- CLAUDE.md, agent definitions, commands, hooks — always English

## Commands

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm start

# Docker (all services: bot + Redis + Meilisearch)
docker-compose up --build
docker-compose down
```

No test suite exists in this project.

## Architecture

Gifory — a public multi-tenant Telegram bot. Each community ("scope") has its own GIF collection and admins. Inline search merges results across all scopes the user belongs to.

**Request flow:**
```
Telegram update (long polling)
  → auth middleware (src/middleware/auth.ts) — passthrough
  → session middleware (Redis, 3600s TTL)
  → scope resolution middleware (src/bot.ts) — sets ctx.currentScopeId
  → public handlers (onInline, onTags, onScopes, onCreateScope, onJoinScope)
  → isAdmin gate (src/middleware/isAdmin.ts) — checks scope admin via Redis
  → admin-only handlers (onAnimation, onText, onCallback, onEdit, onDelete, onBackup, onInvite, syncadmins)
  → Meilisearch (full-text search + scope_id filter)
```

**Scope resolution:**
- Group/supergroup chat → `ctx.currentScopeId = String(chat.id)`, scope auto-created on first message
- Private chat → `ctx.currentScopeId = ctx.session.activeScopeId` (set via `/scopes`)
- Inline query → no `currentScopeId`; `onInline` fetches all user scopes and merges results

**Services (docker-compose):**
- `bot` — Node.js 22 Alpine, runs compiled `dist/index.js`
- `redis` — session storage + scope/membership data
- `meilisearch` — search engine (port 7700)

## Key Files

| File | Role |
|------|------|
| `src/index.ts` | Entry point: init Meilisearch, create bot, start backup cron |
| `src/bot.ts` | Middleware chain, scope resolution middleware, handler registration |
| `src/scopes.ts` | Scope CRUD, user membership, invite token generation (Redis) |
| `src/redis.ts` | Shared Redis client (imported by session.ts and scopes.ts) |
| `src/meili.ts` | All Meilisearch operations — all accept `scopeId` param |
| `src/session.ts` | Session type (`activeScopeId`, `pendingScopeId`, state machine) + Redis storage |
| `src/config.ts` | Env var loading (`BOT_TOKEN`, `MEILI_MASTER_KEY`) |
| `src/backup.ts` | Weekly cron (Sunday 03:00) — per-scope backup to first scope admin |
| `src/handlers/` | One file per Telegram update type |

## Data Model

```typescript
interface GifDocument {
  id: string;            // `${scopeId}_${fileUniqueId}` — Meilisearch PK
  file_unique_id: string; // Telegram file_unique_id (for dedup within scope)
  file_id: string;        // Telegram file_id for sending
  scope_id: string;       // owning scope
  tags: string[];
  emojis: string[];
  created_at: number;
}

interface Scope {
  id: string;           // chat_id (group) or hex slug (manual)
  name: string;
  type: "group" | "manual";
  admin_ids: number[];
  created_at: number;
}
```

**Redis keys:**
- `scope:{id}` → JSON Scope object
- `user_scopes:{userId}` → Set of scope IDs (drives inline search)
- `scope_members:{scopeId}` → Set of user IDs (manual scopes)
- `invite:{token}` → scopeId, TTL 24h

## Session State Machine

States (defined in `src/session.ts`):
- `IDLE` — default
- `WAITING_FOR_NEW_TAGS` — GIF sent without tags, waiting for text input
- `WAITING_TO_REPLACE_TAGS` — replace all tags flow
- `WAITING_TO_APPEND_TAGS` — append tags flow

`pendingScopeId` is saved alongside `pendingGifUniqueId` so the scope context survives the multi-step flow.

## Auth Model

- `isAdmin` middleware calls `isAdminOfScope(userId, ctx.currentScopeId)` — scope-specific
- Group scopes: Telegram group admins are scope admins (synced on join + `/syncadmins`)
- Manual scopes: creator is admin; others join via invite token (`/invite` → `/join <token>`)
- All users: inline search, `/tags`, `/scopes`

## Environment Variables

See `.env.example`. Required: `BOT_TOKEN`, `MEILI_MASTER_KEY`.  
Default `MEILI_HOST` is `http://meilisearch:7700`; default `REDIS_HOST` is `redis`.  
Optional `SUPER_ADMIN_ID` for bot-owner-level operations.
