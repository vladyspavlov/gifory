## Last completed
- 2026-10-04: Committed, pushed and deployed the unreachable-group navigation fix (`bcb3e9e`) through the Oracle VPS skill. Production Docker build passed; bot polling resumed and all three services are healthy with zero restarts. Verified the reported Communities/Search/Tags/Help keyboard handlers in English and Ukrainian against production data with replies captured locally, and global inline search returned 50 results exclusively from the two verified manual communities. No test Telegram messages were sent. The unavailable group remains excluded without deleting its archive or stored memberships; actual Telegram client rendering remains a separate check.
- 2026-10-04: Fixed private navigation/global inline search being blocked by one unreachable group. Read-only Oracle inspection confirmed Telegram returns `400: chat not found` for one stored group while two manual communities remain available. Access enumeration now omits unverified groups when other communities are verified, preserves membership/archive data, and retains retry behavior when no community can be verified. Help instructions are public and independent of membership checks. Added English/Ukrainian keyboard, partial/global search, strict scoped-access and total-outage regressions. Local TypeScript/offline checks and all 41 disposable Docker integration/recovery checks passed. Changes are local; no commit, push or deployment was performed.
- 2026-10-04: Committed and deployed the dependency, reliability/recovery and guided UX changes to Oracle using Git bundles so production verification preceded the GitHub push. Fixed deployment checks to use IPv4 loopback for Meilisearch and give the non-root runtime user ownership of copied application files. All 40 disposable integration/regression checks passed; the final Docker image passed a runtime-user readability check. Production bot/Redis/Meilisearch are healthy with zero restarts; polling, scoped queries across all 3 communities, all 1,487 retained GIF documents, inline capability and localized Telegram menus/descriptions were verified. Pre-deploy Meilisearch snapshot and Redis RDB are retained outside the app checkout in the deploy user's private gifory-release-backups/20261004 directory. Real-client rendering, participant research and a delivered full recovery archive remain separate checks.
- 2026-10-03: Implemented all 25 UX findings with guided Home/community/Add GIF/Manage flows, explicit global and scoped search, retained uploads and pause/resume/cancel, deliberate group saving, scoped GIF/member previews and confirmations, manual role handover/closure, notification preferences, contextual recovery and bilingual menus. Local TypeScript build and all 40 Docker integration/regression checks passed without skips. UX_IMPLEMENTATION_2026-10-03.md maps findings to changes and records rollout/validation limits. No deployment or live Telegram client/participant testing was performed.
- 2026-10-03: Completed the code-based UX review in UX_REVIEW_2026-10-03.md: 25 prioritized findings, onboarding/member/admin/group journeys, community/search semantics, documented comparisons with @gif, @TagdBot, @Stickers, Manybot and Telegram's sticker editor, proposed English/Ukrainian screens, delivery sequence and acceptance scenarios. Local source links and tag-parser examples were checked. No bot changes, production access, deployment, live Telegram interaction or participant usability testing were performed.
- 2026-10-03: Final Docker build and all 18 regression checks passed on disposable Redis/Meilisearch containers, including full recovery, multipart integrity, access isolation, concurrent mutations, and shutdown during an active handler. No production writes or deployment were performed.
- 2026-10-03: Implemented the review fixes: missing-expiry search, captured-scope authorization, safe GIF replacement/task completion, restricted direct links/live group membership, robust file probes/pagination, isolated operation-bound sessions, atomic scope/invite mutations, escaped/paginated members, bounded analytics, coordinated shutdown, image pins/health/memory limits, and localization.
- 2026-10-03: Added weekly full recovery archives to the configured owner plus private isolated scope archives, coordinated Redis/Meilisearch snapshots, gzip/multipart/checksum delivery, and a dry-run empty-target restore command. BACKUP.md documents recovery and retained secrets/media requirements. Existing user changes are preserved; production was inspected read-only and was not deployed.
- 2026-10-03: Reviewed the current working tree and updated all retained npm dependencies to registry latest stable versions. Removed redundant @types/node-cron, added package-lock.json, switched Docker to npm ci, excluded Redis data/.git from build context, and retained RESP2 explicitly for ioredis 6.
- 2026-10-03: Local TypeScript 7 build and Node 24 Alpine Docker build passed; npm outdated is empty and npm audit reports zero vulnerabilities. Isolated runtime checks verified dependency compatibility and reproduced application defects; details and validation limits are in CODE_REVIEW_2026-10-03.md. Production was not accessed and the migration was not run.
- solo: Migration of 802 GIFs to "Legacy Archive" scope — scripts/migrate.ts ran successfully
- solo: Full multi-tenant refactor shipped — src/, Dockerfile (Node 24 LTS), docker-compose.yml
- solo: i18n system + usage stats shipped (build passes):
  - src/i18n/en.ts, src/i18n/uk.ts, src/i18n/index.ts — all UI strings extracted, ctx.t() injected via middleware
  - All handlers updated to use ctx.t() — no hardcoded Ukrainian strings remain in code
  - src/stats.ts — Redis sorted-set usage tracking (recordGifUsage, getTopGifs)
  - src/handlers/onChosenInlineResult.ts — tracks which GIF was selected from inline results
  - src/handlers/onStats.ts — /stats admin command (top-5 all-time + top-5 weekly)
  - src/handlers/onLang.ts — /lang command + lang:set:en/uk callbacks
  - Language auto-detect: stored pref → Telegram language_code.startsWith("uk") → "en"

- solo: /help command added — src/handlers/onHelp.ts, en.ts, uk.ts
- solo: persistent ReplyKeyboard added — src/keyboard.ts, src/handlers/onKeyboardButton.ts; keyboard shown on /start and /help
- solo: inline search fixed — onInline now catches DOCUMENT_INVALID, probes file_ids via getFile, auto-purges invalid GIFs from Meilisearch
- solo: member management added — /members, /kick, /promote, /rename (admin-only); scopes.ts extended with getScopeMembers, removeUserFromScope, promoteToAdmin, renameScope, revokeAllInvites

## In progress
- (none)

## Next steps (in order)
1. Validate the implemented UX with a separate Telegram test bot and participant walkthroughs; see UX_IMPLEMENTATION_2026-10-03.md. Check mobile English/Ukrainian rendering, group privacy/admin settings, ForceReply, inline destinations and blocked-DM recovery. Notify existing group admins that saving now requires `/add` followed by a reply to the prompt.
2. Monitor the deployed release via .claude/skills/oracle-vps/SKILL.md and retain recovery files off-server.
3. After deployment, verify Telegram membership permissions and the full archive delivery to the configured owner, and retain successful recovery files off-server.
4. user — enable "inline feedback" in BotFather at 100% so chosen_inline_result events fire
   (BotFather → your bot → Bot Settings → Inline Feedback → 100%)
5. user — configure the inline placeholder in BotFather and verify the localized profile descriptions on real Telegram clients.

## Blockers
- None

## Active Automation
- None
