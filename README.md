# Gifory

A public multi-tenant Telegram bot for managing and searching GIF collections. Each community ("scope") has its own GIF archive, its own admins, and its own tag catalog. Users who belong to multiple communities get merged inline search results.

## Features

- **Multi-tenant** — independent GIF collections per community, isolated by scope
- **Inline search** — `@giforybot query` searches across all your communities at once
- **Tag & emoji system** — `#hashtag` and emoji tags, full-text search via Meilisearch
- **Tag catalog** — `/tags` with pagination and tap-to-search buttons
- **Group scopes** — add the bot to a Telegram group; it auto-creates a scope with group admins
- **Manual scopes** — create a private community with `/create`, invite members via `/invite`
- **Member management** — list members, kick, promote to admin, rename community
- **Usage statistics** — track which GIFs are used most, weekly and all-time top-5
- **Localization** — English and Ukrainian UI; auto-detected from Telegram client, manual `/lang` switch
- **Persistent keyboard** — main actions always one tap away
- **Weekly backups** — Sunday 03:00, per-scope JSON backup sent to first admin
- **Manual backup** — `/backup` on demand

## Stack

| Component | Technology |
|-----------|------------|
| Bot framework | [grammY](https://grammy.dev/) v1.42 |
| Search engine | [Meilisearch](https://www.meilisearch.com/) |
| Session & scope storage | Redis via [ioredis](https://github.com/luin/ioredis) |
| Language | TypeScript / Node.js 24 |
| Deployment | Docker Compose |

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=<your Telegram bot token from @BotFather>
MEILI_MASTER_KEY=<strong random key, min 16 chars>
# Optional: your Telegram user ID for emergency operations
# SUPER_ADMIN_ID=123456789
```

### 2. Enable inline mode

In [@BotFather](https://t.me/BotFather):
- **Bot Settings → Inline Mode** → enable
- **Bot Settings → Inline Feedback** → set to **100%** (required for usage statistics)

### 3. Run with Docker Compose

```bash
docker-compose up --build -d
```

Starts three containers: `bot`, `redis`, and `meilisearch`.

### 4. Local development

```bash
npm install
npm run dev   # hot-reload via tsx
```

Set `REDIS_HOST` and `MEILI_HOST` in `.env` to point at your local services.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BOT_TOKEN` | ✅ | — | Telegram bot token |
| `MEILI_MASTER_KEY` | ✅ | — | Meilisearch master key (≥16 chars) |
| `REDIS_HOST` | — | `redis` | Redis hostname |
| `MEILI_HOST` | — | `http://meilisearch:7700` | Meilisearch URL |
| `SUPER_ADMIN_ID` | — | — | Bot-owner user ID for emergency ops |

## Bot Commands

### All users

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + persistent keyboard |
| `/help` | Full command reference |
| `/scopes` | List your communities, set active |
| `/create <name>` | Create a new manual community (you become admin) |
| `/join <token>` | Join a community via invite link |
| `/tags` | Browse the tag catalog (tap a tag to search) |
| `/lang` | Switch UI language (English / Ukrainian) |

### Admin only

| Command | Description |
|---------|-------------|
| Send GIF | Add to archive — include `#tags 😀` in caption, or enter them after |
| Reply GIF → GIF | Replace file, keep existing tags |
| `/edit #tags 😀` | Replace all tags (reply to a GIF) |
| `/del` | Delete a GIF (reply to it) |
| `/invite` | Generate a 24-hour invite link |
| `/members` | List all members and admins |
| `/kick <userId>` | Remove a member (revokes all pending invite links) |
| `/promote <userId>` | Promote a member to admin |
| `/rename <name>` | Rename the community |
| `/backup` | Download archive as JSON |
| `/stats` | Top-5 GIFs — all-time and this week |
| `/syncadmins` | Re-sync admins from Telegram group (group scopes only) |

For `/kick` and `/promote` you can also reply to any message from the target user instead of typing their ID.

## How Scopes Work

**Group scopes** are created automatically when the bot is added to a Telegram group. All current group admins become scope admins. Members are tracked as they send messages.

**Manual scopes** are created with `/create <name>` in a private chat. The creator is the first admin. New members join via an invite link generated with `/invite`. Invite links expire after 24 hours. Kicking a member revokes all outstanding invite links, so they cannot re-join without a new one.

A user can belong to multiple scopes. Inline search (`@giforybot query`) returns merged results from all of them.

## Migrating from Single-Tenant

If you have existing GIFs without a `scope_id`, run the migration script once:

```bash
docker compose run --rm bot node dist/scripts/migrate.js
```

Options (env vars):
- `LEGACY_SCOPE_ID` — scope id for migrated GIFs (default: `legacy`)
- `LEGACY_SCOPE_NAME` — display name (default: `Legacy Archive`)
- `ADMIN_IDS` — comma-separated user IDs to assign as admins
- `DRY_RUN=1` — preview without writing

## Project Structure

```
src/
├── index.ts               # Entry point: init Meilisearch, start bot, backup cron
├── bot.ts                 # Middleware chain, scope resolution, handler registration
├── config.ts              # Environment variable loading
├── meili.ts               # All Meilisearch operations (scoped)
├── scopes.ts              # Scope CRUD, membership, invite tokens (Redis)
├── redis.ts               # Shared Redis client
├── session.ts             # Session type, state machine, MyContext
├── stats.ts               # GIF usage tracking (Redis sorted sets)
├── keyboard.ts            # Persistent reply keyboard builder
├── backup.ts              # Weekly backup cron
├── broadcast.ts           # New-GIF notifications to scope admins
├── i18n/                  # Localization (en.ts, uk.ts, index.ts)
├── handlers/              # One file per Telegram update type
├── middleware/             # auth, isAdmin
└── utils/                 # Tag/emoji extraction, array chunking
scripts/
└── migrate.ts             # One-time single→multi-tenant migration
```

## License

MIT
