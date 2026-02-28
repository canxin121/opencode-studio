# OpenCode Studio Technical Reference

English | [简体中文](technical-reference.zh-CN.md)

This document centralizes technical details and parameter references that are intentionally kept out of the main README.

## Tech Stack

- Backend: Rust 2024, Axum, Tokio, tower-http
- Frontend: Vue 3 + TypeScript, Vite, Tailwind CSS 4, Pinia, Monaco Editor, xterm.js, PWA (service worker)

## Repository Layout

- `server/`: Rust backend (HTTP API + OpenCode bridge + static file serving)
- `web/`: Vue frontend app (build output in `web/dist`)
- `scripts/`: cross-platform install/uninstall scripts
- `docs/`: operational and packaging docs

## Prerequisites

- Rust toolchain (stable)
- Bun (CI policy: latest stable via `bun-version: latest`)
- OpenCode CLI installed and available on `PATH` (`opencode --version`)
- Windows service install only: elevated PowerShell + `sc.exe`

Install OpenCode (examples):

```bash
curl -fsSL https://opencode.ai/install | bash
# or
brew install anomalyco/tap/opencode
```

```powershell
scoop install opencode
# or
choco install opencode
# or
bun add -g opencode-ai@latest
```

## Installation Paths

OpenCode Studio supports two install paths:

1) Package install (desktop app)

- Install native packages from GitHub Releases (`.msi`/`.exe`, `.dmg`, `.AppImage`/`.deb`/`.rpm`).
- Includes frontend UI and bundled backend sidecar.
- Best for local desktop use.

2) Service install

- Install backend service via `scripts/install-service.sh` (Unix) or `scripts/install-service.ps1` (Windows).
- Best for always-on/service-managed environments (`systemd`/`sc`).
- Service-install variants:
  - with frontend: service install + bundled web UI artifacts
  - API-only: service install without bundled UI
- Default install roots:
  - Unix/macOS: `~/opencode-studio`
  - Windows: `%USERPROFILE%\\opencode-studio`

## Local Quickstart (From Source)

1) Install web dependencies

```bash
bun install --cwd web
```

2) Build the UI bundle

```bash
bun run --cwd web build
```

3) Run Studio server (serves UI + `/api/*`)

```bash
cargo run -p opencode-studio -- \
  --ui-dir web/dist
```

Open `http://127.0.0.1:3000`.

Notes:

- CI uses frozen installs: `bun install --cwd web --frozen-lockfile`.
- `--ui-dir` (or `OPENCODE_STUDIO_UI_DIR`) is optional; unset means API-only/headless mode.
- If `--opencode-port` / `OPENCODE_PORT` is not provided, Studio will try to spawn `opencode serve`.

## Connect to an Existing OpenCode Server

```bash
cargo run -p opencode-studio -- \
  --opencode-port 16000 \
  --opencode-host 127.0.0.1 \
  --ui-dir web/dist
```

Equivalent env vars:

- `OPENCODE_PORT=16000`
- `OPENCODE_HOST=127.0.0.1`

## Service Installer Parameter Reference

### Unix installer (`scripts/install-service.sh`)

| Parameter | Default | Description |
| --- | --- | --- |
| `--with-frontend` | disabled | Install backend + bundled web UI |
| `--repo owner/repo` | `canxin121/opencode-studio` | GitHub repo for release artifacts |
| `--version vX.Y.Z` | latest | Pin release version |
| `--install-dir PATH` | `~/opencode-studio` | Install root for `bin/`, optional `dist/`, and `opencode-studio.toml` |
| `--mode user|system` | `user` | Linux systemd installation mode |

### Windows installer (`scripts/install-service.ps1`)

| Parameter | Default | Description |
| --- | --- | --- |
| `-WithFrontend` | disabled | Install bundled web UI in addition to backend |
| `-Repo owner/repo` | `canxin121/opencode-studio` | GitHub repo for release artifacts |
| `-Version vX.Y.Z` | latest | Pin release version |
| `-InstallDir PATH` | `%USERPROFILE%\\opencode-studio` | Install root for `bin\\`, optional `dist\\`, and `opencode-studio.toml` |
| `-Port PORT` | `3000` | Initial backend port in generated config |

## Runtime Parameters (CLI Flags / Env Vars)

### Core backend

| Name | Default | Notes |
| --- | --- | --- |
| `OPENCODE_STUDIO_CONFIG` / `--config` | `<exe-dir>/opencode-studio.toml` | Runtime TOML config path; auto-loads from executable directory when unset |
| `OPENCODE_STUDIO_HOST` / `--host` | `127.0.0.1` | Bind address |
| `OPENCODE_STUDIO_PORT` / `--port` | `3000` | HTTP port |
| `OPENCODE_STUDIO_UI_DIR` / `--ui-dir` | (unset) | Built UI directory; unset means API-only/headless |

### OpenCode bridge

| Name | Default | Notes |
| --- | --- | --- |
| `OPENCODE_PORT` / `--opencode-port` | (unset) | Connect to existing OpenCode instance |
| `OPENCODE_HOST` / `--opencode-host` | `127.0.0.1` | Used together with `OPENCODE_PORT` |
| `OPENCODE_STUDIO_SKIP_OPENCODE_START` / `--skip-opencode-start` | `false` | Do not spawn `opencode serve` |
| `OPENCODE_STUDIO_OPENCODE_LOG_LEVEL` / `--opencode-log-level` | (unset) | Log level passed to managed OpenCode |
| `OPENCODE_STUDIO_OPENCODE_LOGS` | (unset) | `true/1/yes/on` forwards managed OpenCode logs |

### UI auth and data

| Name | Default | Notes |
| --- | --- | --- |
| `OPENCODE_STUDIO_UI_PASSWORD` / `--ui-password` | (disabled) | Enables cookie-based UI login |
| `OPENCODE_STUDIO_DATA_DIR` | `~/.config/opencode-studio` | Stores `settings.json`, terminal registry, etc. |

### Advanced (selected)

| Name | Default | Notes |
| --- | --- | --- |
| `OPENCODE_CONFIG` | (unset) | Extra OpenCode config file path |
| `OPENCODE_STUDIO_GIT_TIMEOUT_MS` | `60000` | Timeout for git operations |
| `OPENCODE_STUDIO_TERMINAL_IDLE_TIMEOUT_SECS` | (unset) | Auto-clean idle terminals when positive |

## Config Files and Paths

- Runtime config (service/backend): `opencode-studio.toml`
  - Service install default: `<install-root>/opencode-studio.toml` (service units pass `--config` explicitly)
  - Manual run fallback: auto-discovered from current executable directory
  - Override with `--config <path>` or `OPENCODE_STUDIO_CONFIG`
- Studio settings: `~/.config/opencode-studio/settings.json`
  - Override base dir with `OPENCODE_STUDIO_DATA_DIR`
- OpenCode config layers (read/edited in Studio):
  - User: `~/.config/opencode/opencode.json`
  - Project: `opencode.json` / `opencode.jsonc` (or `.opencode/`)
  - Custom: `OPENCODE_CONFIG`

Default installer-generated runtime config locations:

- Unix: `~/opencode-studio/opencode-studio.toml`
- Windows: `%USERPROFILE%\\opencode-studio\\opencode-studio.toml`

Reference example: `docs/opencode-studio.toml.example`

## Development Commands

Web:

```bash
bun run --cwd web fmt
bun run --cwd web test
bun run --cwd web build:rust-debug
```

Rust:

```bash
cargo test -q --manifest-path server/Cargo.toml
```

Tip: for UI debugging, use `build:rust-debug` and point `--ui-dir` to `web/dist-rust-debug`.

## Security Note

The service exposes powerful local capabilities (workspace-scoped file read/write, git operations, terminal spawning). Keep it on localhost, or enable `OPENCODE_STUDIO_UI_PASSWORD` and place it behind a trusted reverse proxy if exposure is required.

For threat model and reporting guidance, see `SECURITY.md`.
