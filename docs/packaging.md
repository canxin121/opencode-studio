# Packaging

This repo produces multiple deliverables from the same codebase.

Repository layout:

- `web/`: Vue app (Vite) -> `web/dist`
- `server/`: Rust Axum server binary (`opencode-studio`)
- `desktop/`: Tauri desktop packaging (frontend-only + full app)

## Artifacts

1) `frontend-dist`

- What: the built web UI output (`web/dist`).
- Use cases: host behind nginx, serve from CDN, or serve via the Rust server (`--ui-dir`).
- Produced by: `bun run --cwd web build`.

2) `backend-bin`

- What: Rust server binary only (`opencode-studio`).
- Use cases: run as a service on a machine; optionally serve UI with `--ui-dir`.
- Produced by: `cargo build --manifest-path server/Cargo.toml --release`.

3) `frontend-only-app` (desktop)

- What: a desktop app that *only* embeds the frontend (no bundled Rust server sidecar).
- Use cases: connect the UI to a remote/local server, or run the server separately.
- Built from: `desktop/src-tauri/tauri.conf.frontend.json`.

4) `full-app` (desktop)

- What: one desktop installer/bundle that includes:
  - the frontend UI
  - the Rust server (`opencode-studio`) bundled as a Tauri sidecar
  - tray icon + close-to-tray behavior
- Behavior:
  - App startup automatically starts the backend sidecar.
  - Closing the window hides it; the backend continues in the tray.
  - Tray menu can start/stop/restart backend, open logs/config, quit.
- Built from: `desktop/src-tauri/tauri.conf.full.json`.

## Local builds

### Build `frontend-dist`

```bash
bun install --cwd web
bun run --cwd web build
```

Output: `web/dist`


### Build `backend-bin`

```bash
cargo build --manifest-path server/Cargo.toml --release --locked
```

Output:

- Linux/macOS: `server/target/release/opencode-studio`
- Windows: `server/target/release/opencode-studio.exe`

### Build `frontend-only-app`

Prereqs:

- Rust toolchain
- Bun
- Linux: install Tauri deps (WebKitGTK etc)

Build:

```bash
./scripts/build-frontend-dist.sh
cd desktop/src-tauri
cargo tauri build --config tauri.conf.frontend.json
```

### Build `full-app`

The full app bundles the Rust server as a Tauri sidecar.

```bash
./scripts/build-frontend-dist.sh

# Build and copy the backend into desktop/src-tauri/binaries/
./desktop/scripts/prepare-sidecar.sh

cd desktop/src-tauri
cargo tauri build --config tauri.conf.full.json
```

Notes:

- The sidecar must be named with a `-$TARGET_TRIPLE` suffix (Tauri requirement).
- The desktop app uses a fixed backend port by default (`3000`). If it is already
  in use, edit the generated config file (see below).

## Runtime config (desktop)

The desktop app writes a user-editable config file on first launch:

- macOS: `~/Library/Application Support/<...>/desktop-config.json` (exact path is platform-dependent)
- Linux: `~/.config/<...>/desktop-config.json`
- Windows: `%APPDATA%\\<...>\\desktop-config.json`

The tray menu has an item to open this file.

## CI outputs

Two workflows are relevant:

- `CI` (`.github/workflows/ci.yml`): lint/test for `web/` and `server/`.
- `Package` (`.github/workflows/package.yml`): manual (workflow_dispatch) builds artifacts for the current ref. Desktop installers are built twice:
  - main (system WebView)
  - CEF runtime (suffix `-cef`, using Tauri's `feat/cef` branch)

Mobile: use the hosted web UI (`web/dist`).

For releases:

- `Release` (`.github/workflows/release.yml`): on tag `v*` it creates a GitHub Release and attaches:
  - web dist archives
  - backend binaries for macOS/Windows/Linux
  - desktop installers (frontend-only + full) as native artifacts when available:
    - Windows: `.msi` (and/or `.exe`)
    - macOS: `.dmg`
    - Linux: `.AppImage` + `.deb` + `.rpm`
    plus the same again using Tauri's CEF runtime (suffix `-cef`)
  - service installer scripts

## Unsigned builds

This project does not require Apple/Windows signing keys to build. Release assets are produced
unsigned by default:

- macOS: users may see Gatekeeper warnings for unsigned apps.
- Windows: SmartScreen may warn for unsigned installers/binaries.
