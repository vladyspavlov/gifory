# Gifory dependency update and code review

Reviewed on 2026-10-03 against the current working tree, including changes that were already uncommitted. The earlier `REVIEW.md` is preserved. Production was not accessed; no Telegram requests, deployment, or migration were performed.

## Dependency changes

Versions were checked against each package's npm registry `latest` tag, excluding prereleases.

| Package | Previous declared version | Updated version |
| --- | --- | --- |
| @grammyjs/storage-redis | 2.5.1 | 2.6.0 |
| dotenv | 17.4.2 | 18.0.5 |
| emoji-regex | 10.6.0 | 11.0.0 |
| grammy | 1.42.0 | 1.46.0 |
| ioredis | 5.10.1 | 6.0.0 |
| meilisearch | 0.57.0 | 0.62.0 |
| node-cron | 4.2.1 | 4.6.0 |
| @types/node | 25.6.0 | 26.6.4 |
| tsx | 4.21.0 | 4.23.15 |
| typescript | 6.0.2 | 7.0.2 |
| @types/node-cron | 3.0.11 | Removed: node-cron 4 ships its own types |

`package-lock.json` now locks the full dependency tree. Both Docker stages use `npm ci`. `.dockerignore` now excludes Redis data and Git history. The retained version ranges still use the existing caret convention; `npm ci` installs the locked versions.

The ioredis 6 default changes to RESP3. Both existing Redis constructors now explicitly use `protocol: 2`, preserving the previous protocol and compatibility with older Redis servers. The migration script was only compiled, never executed. See the [ioredis release notes](https://github.com/redis/ioredis/releases/tag/v6.0.0).

TypeScript 7 uses a native compiler, so the actual Node 24 Alpine Docker build was checked, including the compiler's optional platform package. See [Microsoft's release announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). dotenv's existing `dotenv/config` import and environment precedence remain usable; its preload is quiet by default in this release. See the [dotenv changelog](https://github.com/motdotla/dotenv/blob/master/CHANGELOG.md).

Docker retains Node 24. `@types/node` follows the requested latest release (26), so future additions could type-check against APIs absent from the deployed runtime. Matching types to Node 24 would be preferable if runtime accuracy takes precedence over using every package's latest major. The current emitted code passed the Node 24 smoke checks.

## Validation

- `npm run build`: passed with TypeScript 7, including `scripts/migrate.ts`.
- `docker build -t gifory:dependency-review .`: passed both clean dependency installs and compilation on Node 24.21.0 Alpine, linux/x64.
- `npm outdated`: no outdated retained direct dependencies.
- `tsx`: passed a TypeScript import and Ukrainian-tag/emoji parsing smoke check.
- `npm audit`: zero reported vulnerabilities; this does not establish that the application has no security defects.
- `git diff --check`: passed.
- Isolated containers, without production data mounts, checked Redis session read/write/delete and TTL, memberships, invite consumption, persistent active scopes, sorted-set usage stats, Ukrainian/English key parity, tag and emoji extraction, cron construction/destruction, and bot construction without starting polling.
- Meilisearch SDK checks passed for writes, scope-filtered document retrieval, tag updates, search/facets with explicit `expired: false`, and expiry/healing. The locally available Meilisearch image reports 1.53.0; the production server version was not checked.
- The ordinary upload/search path failed: documents without `expired` were invisible. This is an existing application defect, documented below, rather than a package installation or compilation failure.
- Isolated reproductions confirmed the pending-scope permission bypass, same-GIF replacement deletion, last-admin leave bypass, and expiry on transient Telegram file-probe failure. Telegram methods were mocked, with a fake bot token.

At the initial review, there was no automated test suite. These initial checks do not establish live Telegram behavior, production data compatibility, or native compilation on the VPS architecture. The findings below describe the pre-fix code. The follow-up implementation status is recorded in the resolution section below.

## Follow-up resolution

Implemented on 2026-10-03 after the review:

- Search and facets include documents with missing `expired`; new uploads explicitly set false.
- Pending GIF mutations recheck captured-scope admin rights; callbacks bind operation/message and group sessions isolate senders.
- Same-GIF replacement refreshes rather than deletes; existing destinations merge tags. Every mutation waits for successful task completion and genuine storage errors propagate.
- Direct scope links never grant manual membership. Group membership/admin access is verified with Telegram, and membership updates revoke departures.
- File probes expire only definitive invalid-ID errors; unknown errors preserve storage; re-sends heal matching IDs. Pagination handles both temporary omissions and removal of expired documents.
- Scope mutations, last-admin protection, active-pointer cleanup, invite consumption/revocation, and actor authorization use atomic Redis scripts.
- Member lists escape HTML, paginate, and limit profile lookup concurrency. Weekly backups and analytics use both locales.
- Redis key enumeration uses SCAN. Usage events retain 31 days, preserving all-time totals with a separate counter.
- Shutdown waits for running middleware, cron, and Redis closure. Docker uses a non-root bot user, health checks, configured memory limits, and database digests read from the deployed versions. The server itself was only inspected.
- Weekly backups now include full recovery state for the owner and isolated scope bundles for admins; large archives use compression/verified multipart delivery. Added a dry-run, empty-target restore command and BACKUP.md.

Final verification: `bash scripts/check.sh` passed the Node 24 Docker build and all 18 regression checks against disposable containers using the pinned deployed database versions. Checks include full recovery, compression/multipart integrity, tenant isolation, concurrent mutations, transient upload failures, and shutdown during active middleware. Telegram methods are mocked; live delivery and production recovery still require operational verification after deployment.

Meilisearch does not offer an atomic cross-document replacement through these APIs. The implementation confirms the destination write before deleting the source and reports any failure. An interrupted deletion can leave both documents; retrying replacement safely merges/reuses the destination and completes deletion. This preserves data rather than claiming a transaction across both steps.

The original review was performed without production access. During the fixes, the Oracle VPS skill was used for read-only image/version/capacity inspection and confirmation that an owner backup recipient is configured. No deployment, migration, production restore, or backup DM was performed.

## Findings in the pre-fix code, ordered by severity

### P1: ordinary uploads can be invisible in inline search and the tag catalog

**Locations:** `src/meili.ts:62`, `src/meili.ts:192`, `src/meili.ts:242`.

New GIF documents omit the optional `expired` field. On the tested server, `expired != true` does not match a missing field: a successfully indexed document appeared in `getAllGifs` but returned no inline search hit or tag facet. Explicitly setting `expired: false` made it searchable. Older migrated documents can have the same missing field.

**Recommendation:** use `(expired NOT EXISTS OR expired = false)` in both search and facet filters, retaining the scope filter, and write `expired: false` for new documents. Verify behavior against the deployed server before rollout.

### P1: pending operations authorize the active scope but write to a different scope

**Locations:** `src/middleware/isAdmin.ts:13`, `src/handlers/onText.ts:15`, `src/handlers/onText.ts:41`.

Start editing scope A, switch to scope B, then lose admin rights in A. If still an admin in B, the gate passes and `onText` writes to captured `pendingScopeId` A without checking A's permissions. An isolated reproduction changed A's tags after its admin list was cleared. Conversely, switching to a scope where the user is not an admin unnecessarily blocks an otherwise permitted pending operation.

**Recommendation:** check admin rights for `pendingScopeId` immediately before each pending mutation and clear or reject operations after permission loss.

### P1: replacing a GIF with itself deletes the archive record

**Locations:** `src/handlers/onAnimation.ts:21`, `src/meili.ts:155`, `src/meili.ts:164`.

Reply to an archived animation with the same animation. `replaceGif` adds the document under the existing ID and then deletes that same ID. The isolated reproduction ended with no document. Replacement with an already archived different GIF can also overwrite that destination's tags.

**Recommendation:** treat identical IDs as a refresh/no-op and define a merge or rejection policy for an existing destination. Wait for successful add-task completion before submitting deletion; an accepted Meilisearch task can still fail asynchronously.

### P1: direct join links bypass invites and membership controls

**Locations:** `src/handlers/onInline.ts:65`, `src/handlers/onJoinScope.ts:54`.

Every inline GIF carries a permanent `scope_<id>` join link. `onDirectJoinScope` grants access after checking only that the scope exists. Anybody receiving one GIF can join the whole archive; a kicked user can immediately rejoin without a fresh invite. Group scopes are exposed through the same path without verifying Telegram group membership.

**Recommendation:** explicitly decide whether all archives are public. For restricted scopes, require an invite or approved join request for manual scopes and Telegram membership verification for group scopes. This finding is a privacy defect when restricted access is intended; permanent public discovery may be deliberate product behavior.

### P1: group departures do not revoke archive access

**Locations:** `src/bot.ts:68`, `src/scopes.ts:44`, `src/scopes.ts:64`, `src/handlers/onMyChatMember.ts:4`.

Group interaction adds persistent Redis membership, but no `chat_member` handler removes users who leave or are banned. Inline search trusts `user_scopes`; `isMemberOfScope` even returns true for any user when the scope is a group. `my_chat_member` describes the bot's membership, not other users'.

**Recommendation:** handle departures and membership changes, explicitly request `chat_member` updates, and account for the Telegram admin-rights requirement. Verification on access can close gaps when updates were missed. See [Telegram's Update documentation](https://core.telegram.org/bots/api#update).

### P1: transient file-probe errors permanently hide valid GIFs

**Locations:** `src/handlers/onInline.ts:23`, `src/handlers/onInline.ts:89`, `src/handlers/onAnimation.ts:44`.

After a `DOCUMENT_INVALID` answer, every rejected `getFile` probe is classified as invalid, including timeouts, 429s, or Telegram outages. An isolated 429 reproduction set `expired: true` on a valid document. The handler also relies on an undocumented `animations/` path prefix. Re-uploading with the same file ID does not clear expiry because the healing call requires a changed ID. Filtering a 50-item page down to 49 also clears `next_offset`, hiding later valid hits.

**Recommendation:** expire only on definitive invalid-file errors, preserve unknown results on transient errors, clear expiry on valid re-upload even when the ID matches, and calculate pagination from the fetched page.

### P2: group tagging sessions are shared by all senders

**Locations:** `src/bot.ts:111`, `src/session.ts:20`, `src/handlers/onCallback.ts:17`, `src/handlers/onAnimation.ts:53`.

No custom session key is configured. grammY defaults to one session per chat, so two group admins overwrite each other's pending GIF fields. Callback data such as `gif:replace_tags` identifies neither the operation nor its owner; an old button acts on whichever GIF is currently pending. The duplicate-GIF branch also leaves the previous `state` and `pendingFileId` intact, allowing a previous new-GIF tagging state to consume tags for a different GIF before a button is selected.

**Recommendation:** key pending flows by chat and sender, bind callback messages to an operation/owner, and initialize every pending field together. See [grammY session defaults](https://grammy.dev/ref/core/sessionoptions).

### P2: last-admin protection is only checked before confirmation

**Locations:** `src/handlers/onLeave.ts:54`, `src/handlers/onLeave.ts:76`.

The confirm branch removes the user without rechecking the admin count. Two admins can both obtain confirmations and then leave sequentially, orphaning the community. Calling the confirm branch for a sole admin reproduced an empty admin list.

**Recommendation:** enforce the invariant at confirmation and atomically with the Redis mutation. Also verify that the sender is still a member.

### P2: unescaped HTML in member-management replies

**Locations:** `src/users.ts:84`, `src/handlers/onMembers.ts:46`, `src/handlers/onMembers.ts:73`.

Display names and scope names enter HTML messages without escaping. A name containing `<` or `&` can make Telegram reject the reply; crafted markup can change admin-facing formatting or links. `/kick` and `/promote` reuse the unsafe user-link formatter.

**Recommendation:** escape `&`, `<`, and `>` in labels and scope names before interpolation, while preserving the intended anchor markup.

### P2: successful API responses are confused with completed search-index writes

**Locations:** `src/meili.ts:20`, `src/meili.ts:54`, `src/meili.ts:88`, `src/meili.ts:164`.

Meilisearch mutation methods return enqueued tasks. Startup announces readiness and handlers report success without waiting for task completion. Replacement can delete the source after the replacement task fails. Broad catches also treat service/auth failures as missing documents, which can cause an upsert to overwrite an existing document's metadata. `onText` ignores `false`/`null` mutation results and still says the GIF was saved.

**Recommendation:** distinguish document-not-found from other errors, wait for task success where correctness depends on completion, and propagate missing-document failures to localized user feedback. See [Meilisearch task statuses](https://www.meilisearch.com/docs/reference/api/async-task-management/list-tasks).

### P2: state and resource limits need attention

- `src/scopes.ts:153`: invite consumption is a GET/add/DEL sequence. Concurrent uses can both join; use atomic consumption. Scope admin changes are also read/modify/write and can lose concurrent updates.
- `src/analytics.ts:25`: usage adds a unique sorted-set member forever. Keep an all-time counter and bound the retained event window.
- `src/scopes.ts:38`: `KEYS scope:*` blocks Redis while scanning the keyspace; use `SCAN` for backups.
- `src/handlers/onMembers.ts:73`: one unbounded message eventually exceeds Telegram's message size limit. Paginate or split member lists and limit parallel profile fetches.
- `src/index.ts:18`: no signal handling or explicit shutdown of polling, cron, and Redis. Add coordinated shutdown for container replacement.
- `src/backup.ts:28` and `src/handlers/onBotStats.ts:11`: user-facing backup and analytics strings bypass the locale dictionaries.
- `docker-compose.yml:5` and `docker-compose.yml:12`: floating server image tags make database-engine upgrades implicit. Pin known versions and plan upgrades around persisted data compatibility. No server-image update was attempted here.

## Positive observations

GIF primary keys include the scope ID, and search/document/facet operations reviewed retain scope filters. The shared Redis client is used throughout application code. Active scope selection persists outside expiring sessions. Both locale dictionaries have matching keys. The separation between handlers, persistence, and translations is straightforward to maintain.

## Next work

Review and deploy the fixes through the Oracle VPS skill. Verify live Telegram membership permissions and successful weekly archive delivery after deployment, then keep a private off-server recovery copy. See BACKUP.md for restore instructions and the limits of Telegram file-ID backups.
