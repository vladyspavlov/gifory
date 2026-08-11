---
name: oracle-vps
description: Connect to, inspect, deploy, or troubleshoot Gifory on its Oracle VPS using the local `OracleVPS` SSH alias. Use when a task involves the bot's Oracle server, Docker Compose deployment, container logs, Meilisearch/Redis data, or runtime health.
---

# Oracle VPS (Gifory)

Use the local SSH alias `OracleVPS`. It already selects the correct host, user, port, and private key. Never print, copy, edit, or commit its resolved host address or key path.

Remote app directory: **`/opt/gifory`** (owned by `ubuntu`). It is a full git checkout of `origin` — deploys are `git pull`, not file copies. The deploy user is in the `docker` group, so **`sudo` is not needed** for any `docker` / `docker compose` command.

Compose project name is `gifory`; containers are `gifory-bot-1`, `gifory-redis-1`, `gifory-meilisearch-1`.

## Preflight

1. Confirm the alias without exposing configuration:

   ```bash
   ssh -o BatchMode=yes -o ConnectTimeout=10 OracleVPS 'printf "connected\n"'
   ```

2. Inspect before changing anything:

   ```bash
   ssh OracleVPS 'cd /opt/gifory && git log --oneline -3 && git status --short && docker compose ps'
   ```

3. Treat the VPS `.env` as secret and VPS-local. Never sync it from the workspace, print it, or include it in logs. Only key *names* may be discussed.

## Deploy

The VPS pulls from GitHub (`git@github.com:vladyspavlov/gifory.git`). Push local work first, then:

```bash
ssh OracleVPS 'cd /opt/gifory && git status --short'          # must be clean before pulling
ssh OracleVPS 'cd /opt/gifory && git pull --ff-only origin main'
ssh OracleVPS 'cd /opt/gifory && docker compose up -d --build bot'
ssh OracleVPS 'cd /opt/gifory && docker compose ps && docker compose logs --tail=100 bot'
```

There is no test suite and `npm` is not used on the host — TypeScript is compiled inside the builder stage of the image. A type error surfaces as a **failed image build**, so always read the build output before declaring a deploy successful.

If the working tree on the VPS is dirty, stop and report it — someone edited production directly. Recover those changes (`git diff` on the VPS) before overwriting them.

If `.env` is absent, create it on the VPS from `.env.example`, set values securely, `chmod 600 .env`, then start the stack. Required keys: `BOT_TOKEN`, `MEILI_MASTER_KEY`. Optional: `SUPER_ADMIN_ID` (enables `/botstats`), `REDIS_HOST`.

## Inspect and recover

```bash
ssh OracleVPS 'cd /opt/gifory && docker compose ps'
ssh OracleVPS 'cd /opt/gifory && docker compose logs -f --tail=100 bot'
ssh OracleVPS 'cd /opt/gifory && docker compose restart bot'
```

Read logs and configuration before restarting.

### Data stores

Both are bind-mounted under `/opt/gifory` and hold the only copy of production data:

- `meili_data/` — the `gifs` Meilisearch index (all archived GIFs, tags, scope assignment)
- `redis_data/` — sessions, scopes, memberships, invite tokens, language prefs, usage stats

Never delete these directories, and never run `docker compose down -v`. Redis is append-only (`--appendonly yes`), so a plain `restart` is safe.

Query the archive read-only through the bot container's network:

```bash
ssh OracleVPS 'cd /opt/gifory && docker compose exec redis redis-cli --scan --pattern "scope:*"'
```

## Prohibited without explicit user request

Do not run `docker compose down`, `docker system prune`, `rsync --delete`, `git reset --hard`, `git clean`, or any command that removes `meili_data/` or `redis_data/`. Never place bot tokens or chat IDs in shell history, source code, or project documentation.
