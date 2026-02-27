# Packaging

This repo produces multiple deliverables from the same codebase.

Repository layout:

- `web/`: Vue app (Vite) -> `web/dist`
- `server/`: Rust Axum server binary (`opencode-studio`)
- `desktop/`: Tauri desktop packaging (full app)

## Artifacts

1) `frontend-dist`

- What: the built web UI output (`web/dist`).
- Use cases: host behind nginx, serve from CDN, or serve via the Rust server (`--ui-dir`).
- Produced by: `bun run --cwd web build`.

2) `backend-bin`

- What: Rust server binary only (`opencode-studio`).
- Use cases: run as a service on a machine; optionally serve UI with `--ui-dir`.
- Produced by: `cargo build --manifest-path server/Cargo.toml --release`.

3) `full-app` (desktop)

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
cargo build --manifest-path server/Cargo.toml --release --locked --target-dir server/target
```

Output:

- Linux/macOS: `server/target/release/opencode-studio`
- Windows: `server/target/release/opencode-studio.exe`

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
- In `full-app`, Tauri opens the backend URL directly and frontend assets are
  served by the bundled backend sidecar (`--ui-dir`).
- Backend API port defaults to `3000`; if this port is occupied, update
  `opencode-studio.toml` to use another port.

### Build desktop with CEF runtime (`-cef`)

This repo includes an experimental desktop variant that uses Tauri's CEF runtime.
It lives under `desktop/src-tauri-cef/` and must be built with the `cef` cargo feature.

Prereqs:

- Install the CEF-enabled Tauri CLI:

```bash
cargo install tauri-cli --locked --git https://github.com/tauri-apps/tauri --branch feat/cef
```

Build (full / bundled backend):

```bash
./desktop/scripts/build-full-cef.sh
```

## Runtime config (desktop)

The desktop app writes a user-editable config file on first launch:

- macOS: `~/Library/Application Support/<...>/opencode-studio.toml` (exact path is platform-dependent)
- Linux: `~/.config/<...>/opencode-studio.toml`
- Windows: `%APPDATA%\\<...>\\opencode-studio.toml`

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
  - desktop installers (full) as native artifacts when available:
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
