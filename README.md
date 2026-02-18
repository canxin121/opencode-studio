# OpenCode Studio

English | [简体中文](README.zh-CN.md)

OpenCode Studio is a local-first web UI for OpenCode. It runs a Rust (Axum) server that serves the built Vue app and bridges/proxies requests to an OpenCode server (`opencode serve`).

> Note: This is a community project and is not built by the OpenCode team and is not affiliated with them. Upstream OpenCode: https://github.com/anomalyco/opencode

## What you get

- Event stream proxy with filtering/control (heartbeats, `Last-Event-ID` resume, configurable activity/tool filters, payload pruning)
- Chat + session sidebar (sessions + message history use `offset`/`limit` pagination)
- File explorer + search/replace (paged directory listing via `offset`/`limit`; optional `.gitignore` filtering)
- Git UI helpers (status/diff/branches/worktrees, etc.)
- Integrated terminal sessions (PTY; optional tmux backend if available)
- Settings UI that edits OpenCode config layers and Studio-local settings
- Studio-side plugin runtime (discovers plugins from `opencode.json`, loads `studio.manifest.json`, invokes actions, streams events)

## Tech stack

- Backend: Rust 2024, Axum, Tokio, tower-http
- Frontend: Vue 3 + TypeScript, Vite, Tailwind CSS 4, Pinia, Monaco Editor, xterm.js, PWA (service worker)

## Repository layout

- `server/`: Rust backend (HTTP API + OpenCode bridge + static file serving)
- `web/`: Vue app (builds to `web/dist`)

## Prerequisites

- Rust toolchain (stable)
- Bun (recommended; used in CI) and Node.js (CI uses Node 20+)
- OpenCode server:
  - Either `opencode` is available on `PATH` (Studio can spawn `opencode serve`), or
  - You already have an OpenCode server running and can provide its host/port

## Quickstart (local)

1) Install web dependencies

```bash
bun install --cwd web
```

2) Build the UI bundle

```bash
bun run --cwd web build
```

3) Run the Studio server (serves UI + `/api/*`)

```bash
cargo run -p opencode-studio -- \
  --ui-dir web/dist
```

Open `http://127.0.0.1:3000`.

Notes:

- CI uses a frozen install (`bun install --cwd web --frozen-lockfile`). If Bun reports the lockfile would change, re-run without `--frozen-lockfile` to refresh `web/bun.lock`.
- `--ui-dir` (or `OPENCODE_STUDIO_UI_DIR`) is required and must point at a Vite `dist/` folder that contains `index.html`.
- On startup, Studio will try to ensure OpenCode is reachable. If you did not set `--opencode-port` / `OPENCODE_PORT`, it will try to spawn `opencode serve`.

## Connect to an existing OpenCode server

If you run OpenCode separately, pass its port (and optionally host):

```bash
cargo run -p opencode-studio -- \
  --opencode-port 16000 \
  --opencode-host 127.0.0.1 \
  --ui-dir web/dist
```

Equivalent env vars:

- `OPENCODE_PORT=16000`
- `OPENCODE_HOST=127.0.0.1`

## Configuration

### CLI flags / env vars

Core server settings:

| Name | Default | Notes |
| --- | --- | --- |
| `OPENCODE_STUDIO_HOST` / `--host` | `127.0.0.1` | Bind address |
| `OPENCODE_STUDIO_PORT` / `--port` | `3000` | HTTP port |
| `OPENCODE_STUDIO_UI_DIR` / `--ui-dir` | (required) | Built UI directory (Vite `dist/`) |

OpenCode connection:

| Name | Default | Notes |
| --- | --- | --- |
| `OPENCODE_PORT` / `--opencode-port` | (unset) | When set, Studio connects to that OpenCode instance |
| `OPENCODE_HOST` / `--opencode-host` | `127.0.0.1` | Used with `OPENCODE_PORT` |
| `OPENCODE_STUDIO_SKIP_OPENCODE_START` / `--skip-opencode-start` | `false` | Do not spawn `opencode serve` |
| `OPENCODE_STUDIO_OPENCODE_LOG_LEVEL` / `--opencode-log-level` | (unset) | Log level passed to managed `opencode serve` |
| `OPENCODE_STUDIO_OPENCODE_LOGS` | (unset) | Set to `true/1/yes/on` to forward managed OpenCode logs |

UI auth (optional):

| Name | Default | Notes |
| --- | --- | --- |
| `OPENCODE_STUDIO_UI_PASSWORD` / `--ui-password` | (disabled) | Enables cookie-based UI login |

Studio data directory:

| Name | Default | Notes |
| --- | --- | --- |
| `OPENCODE_STUDIO_DATA_DIR` | `~/.config/opencode-studio` | Stores `settings.json`, terminal session registry, etc. |

Advanced (selected):

| Name | Default | Notes |
| --- | --- | --- |
| `OPENCODE_CONFIG` | (unset) | Custom path for OpenCode config file (used as an extra config layer) |
| `OPENCODE_STUDIO_GIT_TIMEOUT_MS` | `60000` | Timeout for git operations |
| `OPENCODE_STUDIO_TERMINAL_IDLE_TIMEOUT_SECS` | (unset) | Auto-cleanup idle terminals when set to a positive integer |

### Config files

- Studio settings (projects list, a few UI knobs): `~/.config/opencode-studio/settings.json` (override base dir via `OPENCODE_STUDIO_DATA_DIR`).
- OpenCode config layers (read/edited via the Studio UI):
  - User: `~/.config/opencode/opencode.json`
  - Project: `opencode.json` / `opencode.jsonc` (or under `.opencode/`)
  - Custom: `OPENCODE_CONFIG` (optional)

## Development

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

Tip: for UI iteration with better debugging, use `build:rust-debug` and point the server at `web/dist-rust-debug`.

## Security notes

This server exposes powerful local capabilities (filesystem read/write within a selected workspace, git operations, terminal spawning). Run it on localhost, or enable `OPENCODE_STUDIO_UI_PASSWORD` and put it behind a trusted reverse proxy if you must expose it.

For a threat model and reporting guidance, see `SECURITY.md`.

## Contributing

See `CONTRIBUTING.md`.

## License

MIT.

See `LICENSE`.
