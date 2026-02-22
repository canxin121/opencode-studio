# Service installation

This document describes installing the Rust server (`opencode-studio`) as a background service.

The service can run in two modes:

- Backend-only: only provides `/api/*` and other endpoints; UI can be hosted elsewhere.
- Backend + static UI: serve `web/dist` via `--ui-dir`.

The server also manages an OpenCode connection. If `opencode` is in `PATH`, Studio can spawn
`opencode serve` automatically. Otherwise, configure it to connect to an existing OpenCode.

## Linux / macOS (curl | bash)

Install backend-only:

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh | bash
```

Install backend + UI:

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh | bash -s -- --with-frontend
```

Pin a release version (recommended for production-like installs):

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh | bash -s -- --version v0.1.0 --with-frontend
```

After installation:

- Linux systemd user service: `systemctl --user status opencode-studio`
- Linux system service: `sudo systemctl status opencode-studio`
- macOS launchd agent: `launchctl list | grep opencode`

Uninstall service unit (keeps binary/data unless you delete them):

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/uninstall-service.sh | bash
```

## Windows (PowerShell)

The Windows installer script installs a Windows service via `sc.exe`.

Run in an elevated PowerShell:

Backend-only:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.ps1) }"
```

Backend + UI:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.ps1) } -WithFrontend"
```

Uninstall:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/uninstall-service.ps1) }"
```

## Config

The installer writes a simple environment file / service arguments. Adjust these to change:

- `OPENCODE_STUDIO_PORT`
- `OPENCODE_HOST` / `OPENCODE_PORT` (connect to existing OpenCode)
- `OPENCODE_STUDIO_UI_DIR` (serve frontend dist)
