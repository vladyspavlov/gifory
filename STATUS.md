## Last completed
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
1. user — redeploy bot: `sudo docker compose up -d`
2. user — enable "inline feedback" in BotFather at 100% so chosen_inline_result events fire
   (BotFather → your bot → Bot Settings → Inline Feedback → 100%)

## Blockers
- None

## Active Automation
- None
