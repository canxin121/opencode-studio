# Backend Accel/Parity Review (Studio)

English | [简体中文](backend-accel-parity-review.zh-CN.md)

## What was implemented now

- Added a persisted local attachment cache with a SQLite metadata index and on-disk base64 blobs (`server/src/attachment_cache.rs`).
- Wired attachment caching into assistant message forwarding (`server/src/opencode_proxy.rs`) so repeated `serverPath` attachments can reuse a local persisted payload path instead of always re-reading and re-encoding source files.
- Wired upload-time cache registration into `/fs/upload` (`server/src/fs.rs`) so uploaded files are immediately reusable by assistant flows.
- Added local-first/fallback session status behavior (`server/src/opencode_proxy.rs`):
  - `?local=true` / `?preferLocal=true` returns status directly from Studio's runtime index.
  - Automatic local fallback when OpenCode is unavailable/restarting/request fails.
- Improved cross-directory parent-child session handling (`server/src/opencode_session.rs`):
  - Root/children views now backfill missing parent records from cache + SQLite by parent ID, so child sessions can still resolve lineage when parent directory differs.
- Hardened SQLite read path behavior (`server/src/opencode_session/sqlite_dao.rs`):
  - Added busy/locked retries.
  - Added safer read pragmas and performance-oriented read settings.
  - Added DAO support for direct fetch by session IDs for parent-chain backfill.

## Why these changes are high impact

- The attachment cache removes repeated expensive file-read+base64 work on common resend/edit/retry loops.
- Local status fallback avoids brittle UX when OpenCode is transiently unavailable.
- Cross-directory parent-chain backfill closes a major hierarchy gap in workbench-style layouts.
- Busy-retry handling reduces transient degraded responses under SQLite lock contention.

## Additional opportunities (next)

- Add bounded cache eviction (size- and age-based) for attachment blobs and metadata.
- Persist and expose attachment cache hit/miss metrics for tuning.
- Add local-first fast paths for selected read-only endpoints beyond `/session/status`.
- Extend parent-chain hydration to JSON-storage fallback for environments without SQLite.
- Add shared consistency tracing IDs between session list and status APIs for easier debugging.
