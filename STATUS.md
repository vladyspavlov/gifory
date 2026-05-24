## Last completed
- solo: Multi-tenant scope refactor + self-review — all src/ files, scripts/migrate.ts, docker-compose.yml

## Self-review (Solo Mode)
- Security: ✅ cross-scope protection via Meilisearch composite PK, invite tokens consumed on use
- Consistency: ✅ all handlers use ctx.currentScopeId, pendingScopeId persists across multi-step flows
- Bug fixed: removed per-message admin sync in resolveScope (was calling getChatAdministrators on every non-admin message)
- Tests: N/A (no test suite)

## In progress
- (none)

## Next steps (in order)
1. user — run migration dry run: `docker compose run --rm bot sh -c "DRY_RUN=1 ADMIN_IDS=136652097,570131786 tsx scripts/migrate.ts"`
2. user — run real migration: `docker compose run --rm bot sh -c "ADMIN_IDS=136652097,570131786 tsx scripts/migrate.ts"`
3. user — redeploy: `docker compose up --build -d`

## Blockers
- None

## Active Automation
- None
