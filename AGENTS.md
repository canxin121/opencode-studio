# AGENTS Acceptance Gates (Aligned with CI)

English | [简体中文](AGENTS.zh-CN.md)

This file defines the minimum acceptance gates that agents must satisfy before handing off changes.
Baseline source: `.github/workflows/ci.yml`.
If this file and CI config diverge, CI is the source of truth.

## Scope Rules

- Run commands at the repository root.
- Any code change should satisfy the checks below before commit.
- Do not bypass checks by lowering standards (for example removing `--locked` or `-D warnings`).

## Version Updates

- When updating project version numbers, use the Python script under `scripts/` instead of manually editing manifests.
- Command: `python3 scripts/version_sync.py set <version>` (example: `python3 scripts/version_sync.py set 0.1.0`).
- After updating versions, run `python3 scripts/version_sync.py check` as part of local validation.

## Required Checks

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

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test -q --locked --manifest-path server/Cargo.toml
python3 -m json.tool desktop/src-tauri/tauri.conf.json >/dev/null
python3 -m json.tool desktop/src-tauri/tauri.conf.full.json >/dev/null
python3 -m json.tool desktop/src-tauri/capabilities/default.json >/dev/null
```

## Acceptance Criteria

- All commands above must exit successfully (`exit code 0`).
- Any failed command means acceptance is not met.

## Version Alignment

- Bun version policy follows CI (`bun-version: latest`).
- When CI version policy changes, update this file accordingly.
