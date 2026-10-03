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
- **Guided navigation** — Home, role-aware community cards, Add GIF, GIF previews, member actions and Settings
- **Explicit destinations** — global inline search by default, community-only search from community/tag buttons, named save receipts
- **Recoverable operations** — retained uploads, paused/resumable prompts and `/cancel`; destructive actions require confirmation
- **Notifications** — source-aware admin messages with per-community opt-out
- **Weekly backups** — Sunday 03:00 Europe/Kyiv, full recovery archive to the owner and isolated scope archives to current admins
- **Manual backup** — `/backup` on demand

## Stack

| Component | Technology |
|-----------|------------|
| Bot framework | [grammY](https://grammy.dev/) v1.46 |
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
# Your Telegram user ID for full recovery backups and /botstats
# SUPER_ADMIN_ID=123456789
```

### 2. Enable inline mode

In [@BotFather](https://t.me/BotFather):
- **Bot Settings → Inline Mode** → enable; use a placeholder such as “Search your saved GIFs by word or emoji” (BotFather setting)
- **Bot Settings → Inline Feedback** → set to **100%** (required for usage statistics)

### 3. Run with Docker Compose

```bash
docker-compose up --build -d
```

Starts three containers: `bot`, `redis`, and `meilisearch`.

### 4. Local development

```bash
npm ci
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
| `SUPER_ADMIN_ID` | For full backups | — | Bot-owner private user ID for full recovery archives and /botstats |

## Using Gifory

Open the bot and press Start. Home recognizes whether you already belong to a community. New users can open an invite from an admin, create an invite-only community, or add the bot to a Telegram group.

- **Search GIFs** searches all your accessible communities. Choose a destination chat, enter a word or emoji after the bot username, and select a result to send it.
- **Communities** opens a sorted, paginated list showing your role and each community's type. Open a card to search only that community, browse its tags/emojis, or manage it if you are an admin.
- **Use for private GIF changes** explicitly sets the destination for GIFs sent directly to the bot. Opening a community or a shared GIF's About link does not switch this preference. Group actions always use that group's archive.
- **Add GIF** asks for an animation and its labels, such as `#happy #reaction 😂` or `#радість #реакція 😂`. Caption labels are also accepted. Prompts and receipts name the destination. If no destination is selected, the bot retains the upload while you choose or create one.
- **Manage → GIF archive** provides previews and actions for adding/replacing labels, explicitly replacing a file, and confirming deletion. **Members & roles** provides member selection, removal, promotion, demotion and handing over your admin role.
- **Settings** changes language; a community's Manage screen controls its new-GIF notifications. Help has short task-specific topics rather than one command wall.

Navigation pauses a pending operation without discarding it. Use Resume or `/cancel`. Input prompts and confirmations expire after 15 minutes; sessions last one hour. In groups, reply to the latest prompt meant for you. A new animation does not silently overwrite an unfinished operation.

### Group setup and saving

Adding/promoting the bot acknowledges setup and provides a membership-checked link for opening the archive privately. Make the bot a group admin for reliable membership checks and updates. Existing group members can use that link even before the bot has tracked them through a message.

**Ordinary group GIFs are not saved automatically.** Group admins use `/add` in reply to a GIF, or tap Add GIF and reply to the upload prompt. Sending a GIF in reply to another GIF no longer replaces its file; use Replace GIF file from the management preview. The bot's own inline results do not trigger uploads or duplicate prompts.

Group membership, admin roles and names are managed in Telegram. `/syncadmins` refreshes archive admins. Group archives cannot be left or closed independently of Telegram membership; invite-only community admins have equal authority, and the last admin cannot leave or be demoted. An admin can hand over their role to a member and remain a member. Only the sole admin can close an invite-only community, after a button confirmation and typing its exact name; download a backup first.

### Command shortcuts

Buttons are the primary interface; these commands remain available:

| Command | Behavior |
|---|---|
| `/start`, `/home` | Context-aware Home and keyboard |
| `/search` | Search/send tutorial and destination chooser |
| `/scopes` | Community cards; opens personal navigation privately from groups |
| `/create [name]` | Create an invite-only community; prompts for a name when omitted |
| `/join [token]` | Join via invite, or show joining instructions |
| `/tags` | Tags and emojis of the selected/current community; resumes after selection |
| `/leave` | Confirm leaving the selected invite-only community |
| `/settings`, `/lang` | Settings and language |
| `/help` | Role-aware task help |
| `/cancel` | Cancel the pending operation |
| `/add` | Start a named upload; in groups can reply to an animation |
| `/manage` | Community management, available to its admins |
| `/edit [#tags 😀]` | Reply to a GIF to review a label replacement; without labels opens its preview |
| `/del` | Reply to a GIF to confirm removal; without a reply opens the archive |
| `/invite` | Generate a **single-use** link expiring after 24 hours, or explain group access |
| `/members` | Paginated tracked members and role actions |
| `/kick [userId/@username]`, `/promote [userId/@username]` | Confirm a member action; without a target opens the member list |
| `/rename [name]` | Rename an invite-only community; prompts if name is omitted |
| `/backup` | Deliver the current community's compressed recovery metadata privately |
| `/stats` | Inline usage statistics with scoped GIF previews |
| `/syncadmins` | Refresh Telegram group admins |

`/kick` and `/promote` also support replying to a member's message. Removing a member revokes all unused invites, with this consequence shown before confirmation. Replying with `/edit` or `/del` to a bot notification or managed preview preserves its source community instead of using an unrelated private destination.

Regular inline search merges accessible communities and presents one matching copy of duplicate GIFs. The chosen result retains its scoped ID for source links and usage attribution. Community/tag buttons insert a scoped inline query; an inaccessible or malformed scope never falls back to a different collection. Membership is rechecked and temporary Telegram verification errors produce retry instructions without erasing membership.

See [UX_IMPLEMENTATION_2026-10-03.md](UX_IMPLEMENTATION_2026-10-03.md) for finding-by-finding coverage, test evidence and rollout checks.

## Backup and recovery

See [BACKUP.md](BACKUP.md) for backup contents, privacy, file delivery, and the dry-run restore command. Weekly delivery includes unchanged archives.

## Verification

```bash
npm run build
npm test
```

`npm test` runs offline checks. `bash scripts/check.sh` builds the Docker image and runs the complete regression suite against disposable pinned databases, cleaning up its own containers afterward. The integration suite requires disposable Redis and Meilisearch containers and is enabled with `GIFORY_INTEGRATION=1`; it refuses hostnames other than `gifory-test-redis` and `http://gifory-test-meili:7700`. The suite includes an empty-target backup/restore round trip. Never point it at production.

## Migrating from Single-Tenant

The production single-tenant migration has already run. Do not run it again. For a separate installation that still has GIFs without a `scope_id`, the historical migration command was:

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
