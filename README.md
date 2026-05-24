# Gifory

A Telegram bot for managing and searching a private GIF collection. Admins can upload GIFs with hashtag/emoji tags, then find them instantly via inline search or a browsable tag catalog.

## Features

- Upload GIFs with `#hashtag` and emoji tags
- Full-text inline search (`@botname query`)
- Browsable tag catalog with pagination
- Edit, delete, and replace GIFs
- Weekly automated JSON backups (Sunday 03:00)
- New-GIF broadcast to all admins
- Redis-backed session state, Meilisearch-powered search

## Stack

| Component | Technology |
|-----------|------------|
| Bot framework | [grammY](https://grammy.dev/) |
| Search engine | [Meilisearch](https://www.meilisearch.com/) |
| Session storage | Redis via [ioredis](https://github.com/luin/ioredis) |
| Language | TypeScript / Node.js 22 |
| Deployment | Docker Compose |

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=<your Telegram bot token>
MEILI_MASTER_KEY=<strong random key, min 16 chars>
ADMIN_IDS=<comma-separated Telegram user IDs>
```

### 2. Run with Docker Compose

```bash
docker-compose up --build -d
```

This starts three containers: the bot, Redis, and Meilisearch.

### 3. Local development

```bash
npm install
npm run dev   # hot-reload via tsx
```

Requires a running Redis and Meilisearch. Update `REDIS_HOST` and `MEILI_HOST` in `.env` accordingly.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BOT_TOKEN` | ✅ | — | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `MEILI_MASTER_KEY` | ✅ | — | Meilisearch master key (≥16 chars) |
| `ADMIN_IDS` | ✅ | — | Comma-separated admin user IDs |
| `USER_IDS` | — | — | Comma-separated user IDs (reserved, not enforced) |
| `REDIS_HOST` | — | `redis` | Redis hostname |
| `MEILI_HOST` | — | `http://meilisearch:7700` | Meilisearch URL |

## Bot Commands

| Command | Access | Description |
|---------|--------|-------------|
| `/tags` | All | Browse GIF tag catalog |
| `/edit` | Admin | Edit tags on a GIF (reply to it) |
| `/del` | Admin | Delete a GIF (reply to it) |
| `/backup` | Admin | Trigger a manual JSON backup |

Send a GIF (as admin) to add it to the archive. Use inline mode (`@botname <query>`) to search.

## Project Structure

```
src/
├── index.ts          # Entry point
├── bot.ts            # Middleware chain & handler registration
├── config.ts         # Environment variable loading
├── meili.ts          # Meilisearch operations
├── session.ts        # Redis session state machine
├── backup.ts         # Weekly backup cron
├── broadcast.ts      # New-GIF admin notifications
├── handlers/         # One handler per Telegram update type
├── middleware/       # auth, isAdmin
└── utils/            # Tag/emoji extraction, array chunking
```

## License

MIT
