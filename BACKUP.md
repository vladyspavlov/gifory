# Backup and recovery

## What is delivered

Every Sunday at 03:00 **Europe/Kyiv**, Gifory delivers backups even when no archive content changed.

- **Bot owner (`SUPER_ADMIN_ID`):** one `gifory-full-backup` archive containing every Redis key (including memberships, scope definitions/admins, usage statistics, analytics, preferences, profiles, invites, and sessions), all GIF documents including expired records, and the Meilisearch index settings. The archive records both database versions.
- **Community admins:** a separate `gifory-scope-backup` archive containing only that community's metadata, member set, usage stats, GIFs, and search settings. Delivery tries current admins in order until one succeeds. It rechecks authorization before sending, including Telegram group admin status.
- **`/backup`:** the requesting admin receives a scope archive in their private chat. Start the bot privately first so Telegram permits that DM.

The owner must start the bot privately and configure a positive user ID as `SUPER_ADMIN_ID`. Full tenant data is never sent to scope admins. Without this setting, only scope archives are delivered and the bot logs that full recovery delivery is unavailable.

The bot pauses state mutations while capturing Redis and Meilisearch, and releases that lock before uploading. This assumes **one polling bot process** and no out-of-band database writes during capture. Settings updates and document writes wait for Meilisearch task completion. Unexpected orphan documents cause capture to fail rather than silently producing an incomplete archive.

Redis keys use binary `DUMP` values encoded as base64. Expiring keys include an absolute expiration time, so old sessions and invite tokens do not get a fresh TTL during recovery. The backup preserves scope IDs and the `${scopeId}_${fileUniqueId}` document IDs.

## Files, failures, and retention

Small archives are JSON. Larger ones are gzip-compressed. If the compressed archive still exceeds 40 MiB, it is split into numbered parts and a final manifest containing part lengths and SHA-256 checksums. The manifest is sent only after all parts succeed. Download **all parts plus the manifest** into the same directory; never treat an incomplete set as a recovery copy.

Temporary network/server/rate-limit errors are retried up to three attempts with bounded delays. Permanent delivery failures are logged; a failed scope recipient falls back to another admin. Weekly cron runs cannot overlap. Empty scopes are included so a last-GIF deletion is represented in the next archive.

Telegram is an off-server delivery channel, not a managed retention policy. Keep recent successful archives and an older known-good copy in private storage outside the VPS. Do not share full recovery archives: they contain all communities' state and personal profile/membership data. Telegram bot chats do not provide end-to-end encryption.

## What an archive does not replace

Retain these separately:

- The application checkout/commit and pinned Docker images, or access to their repositories.
- The VPS-local `.env` values, particularly the **same bot's `BOT_TOKEN`** and the Meilisearch master key. Secrets are intentionally excluded from the archive. The Meilisearch key can be replaced when creating a fresh server, provided bot and server settings agree.
- Any infrastructure, access credentials, and DNS/configuration needed to recreate the deployment.

GIF exports contain Telegram file IDs and metadata, not the original media bytes. Restoring the same bot's identity lets it reuse its file IDs while Telegram still serves them. Neither a Redis dump nor a Meilisearch dump protects against Telegram itself losing access to a file; irreplaceable media should also be retained independently.

A weekly schedule permits up to one week of state loss. Monitoring successful delivery and periodically practicing recovery are necessary to know the backups remain usable.

## Restoring a full archive

Use replacement databases and keep polling stopped. Do not restore into the running production stores. Follow the repository's Oracle VPS skill for any server operation; the examples below describe recovery tooling, not authorization to modify the VPS.

1. Recreate the services with the exact database versions recorded in the archive. Current pins match the inspected deployed Redis 8.6.2 and Meilisearch 1.42.1 images. Upgrade engines only after successful recovery.
2. Download the `.json`, `.json.gz`, or `.manifest.json` and its numbered parts. Mount that directory read-only into a one-off bot container, with Redis/Meilisearch pointing to the replacement services.
3. Validate first (the default is a dry run):

   ```bash
   node dist/scripts/restore.js /recovery/gifory_full_backup.json
   ```

4. Apply explicitly to **empty** replacement databases:

   ```bash
   node dist/scripts/restore.js /recovery/gifory_full_backup.json --apply
   ```

   `npm run restore -- <file> [--apply]` invokes the same command. It validates the format/schema, document scope IDs, unique keys, missing scope records, multipart checksums, and database versions. It refuses non-empty Redis or a non-empty GIF index. If recovery fails partway, do not rerun blindly against partially restored stores; investigate and use another empty replacement target. The command does not delete or overwrite existing data.

5. Check scope names, admins, memberships, language preferences, counts, and searches against the archive. Resume the same Telegram bot only after verification. Keep the old data directories intact until recovery has been checked.

The current restore tool accepts the **full** archive. Scope archives are useful for individual community recovery, but are not a substitute for full recovery and are deliberately rejected by this command.

## Verification performed

`bash scripts/check.sh` passed the Docker build and all 18 regression checks.

The regression suite captures real Redis/Meilisearch state in disposable containers running the pinned engine versions, serializes a full archive, reads its compressed representation, rejects non-empty restore targets, and restores into empty stores. It verifies GIF search, scope metadata, preferences, persistent keys, and that expired keys are skipped. Telegram delivery is mocked; no production restore or backup DM is sent by the checks.
