# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

Gifory — a Telegram bot for managing and searching a GIF collection.

**Request flow:**
```
Telegram update (long polling)
  → auth middleware (src/middleware/auth.ts) — currently bypassed
  → session middleware (Redis, 3600s TTL)
  → public handlers (onInline, onTags)
  → isAdmin gate (src/middleware/isAdmin.ts)
  → admin-only handlers (onAnimation, onText, onCallback, onEdit, onDelete, onBackup)
  → Meilisearch (full-text search + faceted tag index)
```

**Services (docker-compose):**
- `bot` — Node.js 22 Alpine, runs compiled `dist/index.js`
- `redis` — session storage
- `meilisearch` — search engine (port 7700)

## Key Files

| File | Role |
|------|------|
| `src/index.ts` | Entry point: init Meilisearch, create bot, start backup cron |
| `src/bot.ts` | Middleware chain + handler registration |
| `src/meili.ts` | All Meilisearch operations (upsert, search, replace, delete) |
| `src/session.ts` | Session type definition + Redis storage factory |
| `src/config.ts` | Env var loading (`BOT_TOKEN`, `MEILI_MASTER_KEY`, `ADMIN_IDS`) |
| `src/backup.ts` | Weekly cron (Sunday 03:00) — exports all docs as JSON, sends to first admin |
| `src/handlers/` | One file per Telegram update type |

## Data Model

```typescript
interface GifDocument {
  id: string;        // file_unique_id (Meilisearch primary key)
  file_id: string;   // Telegram file_id for sending
  tags: string[];    // Lowercase hashtags extracted from caption
  emojis: string[];  // Emoji characters extracted from caption
  created_at: number; // Unix ms timestamp
}
```

## Session State Machine

States (defined in `src/session.ts`):
- `IDLE` — default
- `WAITING_FOR_NEW_TAGS` — after `/edit`, before new tags are entered (replaces all tags)
- `WAITING_TO_REPLACE_TAGS` — replace specific tags flow
- `WAITING_TO_APPEND_TAGS` — append additional tags flow

## Auth Model

- `isAdmin` middleware checks if `ctx.from.id` is in the `ADMIN_IDS` env var (comma-separated)
- Admins: upload GIFs, edit/delete, trigger `/backup`
- All users: inline search, tag catalog (`/tags`)
- `auth.ts` exists but is currently a pass-through (user whitelist not enforced)

## Environment Variables

See `.env.example`. Required: `BOT_TOKEN`, `MEILI_MASTER_KEY`, `ADMIN_IDS`.  
Default `MEILI_HOST` is `http://meilisearch:7700`; default `REDIS_HOST` is `redis`.
