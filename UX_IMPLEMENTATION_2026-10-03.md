# Gifory UX implementation — 2026-10-03

Implemented the guided chat design from [the UX review](UX_REVIEW_2026-10-03.md), covering all 25 findings. Deployed to Oracle on 2026-10-04 after the build and 40 automated checks passed. Production verification confirmed healthy services, long polling, scoped queries across all three communities, all 1,487 retained GIF documents and localized Telegram menus/descriptions. The table describes implemented behavior; automated checks do not establish usability on actual Telegram clients.

## Finding coverage

| Finding | Implemented fix |
| --- | --- |
| F01 — Search boundaries | Global search remains the default. Community cards provide explicitly scoped search; opening a card and setting the private upload destination are separate actions. |
| F02 — Write destination | Upload, duplicate, tag, file replacement, confirmation and receipt screens name the captured community. Scope authorization is checked again before changes. |
| F03 — Onboarding | Home distinguishes newcomers and returning members. Community cards show roles and archive counts, with Add GIF guidance for empty archives administered by the user. |
| F04 — Lost intent | Destination pickers retain the requested action and uploaded GIF. Creating a first community also resumes the retained upload without requiring a resend. |
| F05 — Admin discovery | Authorized cards expose Add GIF and Manage. Private command menus reflect the selected community's role and the user's language. |
| F06 — Community picker | Sorted, paginated lists show role/type and disambiguate duplicate names. Cards show counts, identifiers and destination status. Create and Join are available from navigation. |
| F07 — Catalog scope | Catalog pagination remains bound to its original community and rechecks access. Tag buttons search that community. |
| F08 — Emoji catalog | Both hashtag and emoji facets appear in browsing; empty archives have contextual guidance. |
| F09 — Inline recovery | Empty results include a bot recovery entry. Scoped queries are strict; inaccessible scopes never fall back to global results. Global presentation deduplicates identical GIFs while preserving scoped records and usage attribution. |
| F10 — Send destination | Private search offers Telegram's chat chooser and a secondary current-chat action. The bot's own inline results do not implicitly start archival flows. |
| F11 — Community information | The inline information link opens an authorized community card without claiming a new join or changing the private upload destination. |
| F12 — Invitations | Copy explains the one-person, 24-hour limit, with another-invite and expired/used-link recovery actions. |
| F13 — Group setup | Installation/admin changes show readiness, explain bot-admin requirements and provide a membership-checked private opening link. Group invitations explain membership access. |
| F14 — Deliberate group saving | Ordinary group GIFs remain quiet. Saving requires Add GIF or `/add` and a reply to its prompt. Replacing a file is a separate explicit action. |
| F15 — Group selection | Group actions use that group's archive; personal community selection opens privately. |
| F16 — Pending flows | Navigation pauses rather than discards pending work. Resume, Cancel and `/cancel` are available; prompts expire and group inputs are bound to replies. New uploads cannot silently overwrite pending work. |
| F17 — Duplicate actions | Buttons explicitly say Replace tags, Add tags and Keep current tags, with current labels and community context. |
| F18 — Unexpected input | Keyboard matching uses complete labels. Unknown commands, idle text and unsupported media receive contextual private guidance; ordinary group conversation stays quiet. |
| F19 — Tag syntax | Prompts include localized examples and existing-label suggestions. Unicode hashtags and emojis are normalized/deduplicated; malformed/truncated hashtags and oversized label sets are rejected while retaining the flow. |
| F20 — Management lifecycle | Paged GIF previews and member cards expose actions. Delete, label replacement, removal and role changes require named confirmations. Manual communities support demotion, handover and guarded closure; group roles remain managed in Telegram. |
| F21 — Help and language | Help expands by task and role. Language changes return to Home and refresh the keyboard and private command menu. All new UI copy is available in English and Ukrainian. |
| F22 — Notifications | Notifications identify community and actor, provide scoped GIF actions and support per-community muting. Reply commands retain the notification's source community. |
| F23 — Stats and backup | Statistics link to scoped GIF previews and explain inline usage/empty states. Backup guidance describes compressed recovery metadata and includes a private-chat retry path when DMs are blocked. |
| F24 — Verification outages | Temporary Telegram verification failures produce an unavailable/retry state while preserving membership and destination data. Access still fails closed. |
| F25 — Names and profile | Mentioned commands parse correctly; naming is prompted and validated by Unicode character count. Long labels are clipped without splitting code points. Localized descriptions are published during startup. Client rendering and BotFather configuration remain release checks. |

## Behavior and data notes

- Existing group admins need notice that ordinary posted GIFs are no longer automatically archived. Use `/add`, then reply to the upload prompt.
- Manual communities have equal admins. Handover makes the selected member an admin and the initiating admin a member. The last admin cannot leave or be demoted; closure is available only to the sole remaining admin and requires confirmation plus typing the community name.
- Closing a manual community removes its GIF documents, memberships, invitations, private destination references, statistics and notification preferences. The same GIF stored in another community remains intact.
- No one-shot migration is required or was run. New operation/preview references use expiring Redis keys; private destination storage remains persistent. GIF records remain scoped even when global results are deduplicated.
- Archive browsing uses document pagination, including beyond Meilisearch's default 1,000-result search window. Search ordering is stable across equal timestamps.

## Validation

`npm run build` and `bash scripts/check.sh` passed. The Docker suite ran **40 checks, all passing, with no skipped checks**, against disposable Redis/Meilisearch services. Coverage includes captured-scope authorization, queued uploads and first-community creation, pause/resume/expiry, explicit file replacement, operation-bound confirmations, member role changes, community closure isolation, notification reply origins, group middleware, scoped/global search, emoji/Unicode labels, an archive containing more than 1,000 GIFs, unavailable membership verification, language menus, backup delivery recovery and the existing full recovery checks. Telegram API calls in these tests are mocked.

Before release, use a separate Telegram test bot to verify narrow-screen English/Ukrainian labels, chat chooser behavior, ForceReply and privacy/admin settings, media previews, blocked-DM recovery and profile descriptions on real clients. Set the inline placeholder and verify Inline Feedback at 100% in BotFather. Participant walkthroughs and the task-success thresholds in the review have not been measured. Production deployment must follow [the Oracle VPS skill](.claude/skills/oracle-vps/SKILL.md).
