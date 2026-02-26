# Service installation

This document describes installing the Rust server (`opencode-studio`) as a background service.

The service installer supports two modes:

- Headless: backend-only (`/api/*` etc.); UI can be hosted elsewhere.
- Desktop: backend + static UI (`--ui-dir`).

The server also manages an OpenCode connection. If `opencode` is in `PATH`, Studio can spawn
`opencode serve` automatically. Otherwise, configure it to connect to an existing OpenCode.

## Linux / macOS (curl | bash)

Install desktop mode (default):

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install.sh | bash -s -- --desktop
```

Install headless mode:

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install.sh | bash -s -- --headless
```

Pin a release version (recommended for production-like installs):

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install.sh | bash -s -- --version v0.1.0 --desktop
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

Desktop mode:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install.ps1) } -Variant desktop"
```

Headless mode:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install.ps1) } -Variant headless"
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
