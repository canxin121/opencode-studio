# AGENTS Local Acceptance Gates (Quick)

English | [简体中文](docs/i18n/zh-CN/AGENTS.md)

This file defines the **local** acceptance gates agents should satisfy before handing off changes.
GitHub Actions CI still runs the full suite and is the source of truth.

## Scope Rules

- Run commands at the repository root.
- Any code change should satisfy the quick checks below before commit.
- Do not bypass checks by lowering standards (for example removing `--locked` or skipping formatting).

## Version Updates

- When updating project version numbers, use the Python script under `scripts/` instead of manually editing manifests.
- Command: `python3 scripts/version_sync.py set <version>` (example: `python3 scripts/version_sync.py set 0.1.0`).
- After updating versions, run `python3 scripts/version_sync.py check` as part of local validation.

## Required Checks (Local Quick Gates)

### Formatting

```bash
cargo fmt --all
bun run --cwd web fmt -- --cache --cache-location .prettier-cache
```

These commands can modify files. Commit the formatting changes as part of your PR/commit (don’t leave them uncommitted).
If you only want to *verify* formatting without changing files, use `cargo fmt --all -- --check` and `bun run --cwd web fmt:check`.

### Build / Sanity

```bash
bun install --cwd web --frozen-lockfile
bun run --cwd web vite build
cargo check --workspace --all-targets --locked
```

## CI Checks (GitHub Actions)

CI runs these jobs on every PR/push. If CI fails, treat it as a hard blocker even if the quick gates pass.

### Version consistency (CI job: `version`)

```bash
python3 scripts/version_sync.py check
```

### Web (CI job: `web`)

```bash
bun install --cwd web --frozen-lockfile
bun run --cwd web fmt:check -- --cache --cache-location .prettier-cache
bun run --cwd web vue-tsc -b
bun run --cwd web vite build
bun test --cwd web
```

### Rust (CI job: `rust`)

Linux (fmt + clippy + tests + desktop JSON validation):

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test -q --locked --manifest-path server/Cargo.toml
python3 -m json.tool desktop/src-tauri/tauri.conf.json >/dev/null
python3 -m json.tool desktop/src-tauri/tauri.conf.full.json >/dev/null
python3 -m json.tool desktop/src-tauri/capabilities/default.json >/dev/null
```

macOS (server/plugin runtime tests):

```bash
cargo test -q --locked --manifest-path server/Cargo.toml
```

Windows (server/plugin runtime tests):

```powershell
cargo test -q --locked --manifest-path server/Cargo.toml
```

### Service installer end-to-end (CI job: `service-installers`)

All platforms first resolve stable release tags from GitHub Releases (`latest` and previous stable),
then validate install -> upgrade -> uninstall using those tags.

Linux:

```bash
bun add -g opencode-ai@latest
bash scripts/test-unix-service-flow.sh --mode system --version <previous-stable-tag> --upgrade-to-version <latest-stable-tag>
```

macOS:

```bash
bun add -g opencode-ai@latest
bash scripts/test-unix-service-flow.sh --version <previous-stable-tag> --upgrade-to-version <latest-stable-tag>
```

Windows (elevated PowerShell):

```powershell
bun add -g opencode-ai@latest
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-service-flow.ps1 -Version <previous-stable-tag> -UpgradeToVersion <latest-stable-tag>
```

## Acceptance Criteria

- Local handoff: all commands under **Required Checks (Local Quick Gates)** must exit successfully (`exit code 0`).
- CI is the source of truth: GitHub Actions must pass before merge/release.
- CI-only checks are not required to be re-run locally unless you are debugging a CI failure.

## Version Alignment

- Bun version policy follows CI (`bun-version: latest`).
- When CI version policy changes, update this file accordingly.
