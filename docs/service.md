# Service installation

English | [简体中文](service.zh-CN.md)

This document describes installing the Rust server (`opencode-studio`) as a background service.

Service install has two runtime variants:

- API-only (default): backend-only (`/api/*` etc.)
- With frontend: backend + static UI (`--ui-dir` in generated config)

The server manages an OpenCode connection through local `opencode serve`, so `opencode`
must be installed and available on `PATH`.

## Prerequisites

- OpenCode CLI must already be installed on every platform (`opencode` available on `PATH`).
- Windows service install requires:
  - elevated PowerShell (Run as Administrator)
  - `sc.exe` (built into standard Windows installations)
  - outbound access to download NSSM on first install (cached later under `%TEMP%` and copied to `<install-root>\\tools\\nssm.exe`)

Optional but recommended for CI/shared egress hosts:

- set `GITHUB_TOKEN` or `GH_TOKEN` before running the Windows installer to avoid GitHub API rate limits when resolving release metadata

Install OpenCode (choose one):

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

Verify:

```bash
opencode --version
```

## Linux / macOS (curl | bash)

Install with bundled frontend:

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend
```

Install API-only:

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash
```

Install with custom bind host / port / password:

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend --host 0.0.0.0 --port 3210 --ui-password "change-me"
```

Pin a release version (recommended for production-like installs):

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --version v0.1.0 --with-frontend
```

After installation:

- Linux systemd user service: `systemctl --user status opencode-studio`
- Linux system service: `sudo systemctl status opencode-studio`
- macOS launchd agent: `launchctl list | grep opencode`
- macOS launchd note: installer writes `EnvironmentVariables.PATH` into the plist (including detected `opencode` dir plus Homebrew/Bun defaults), so `opencode` can be found even when your interactive shell uses custom zsh/fish PATH setup.

Uninstall service unit only (keeps install files):

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash
```

Uninstall service unit and also remove install files (`~/opencode-studio` by default):

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash -s -- --remove-install-dir
```

## Windows (PowerShell)

The installer registers services through NSSM (`nssm.exe`) and controls lifecycle with `sc.exe`.

Windows installs create two services:

- `OpenCodeStudio-OpenCode` (runs `opencode serve --port 16000`)
- `OpenCodeStudio` (depends on `OpenCodeStudio-OpenCode`)

Run in an elevated PowerShell:

Install with bundled frontend:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend"
```

Install API-only:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) }"
```

Install with custom bind host / port / password:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend -Host 0.0.0.0 -Port 3210 -UiPassword 'change-me'"
```

Uninstall:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.ps1) }"
```

Uninstall and also remove installed files (`%USERPROFILE%\\opencode-studio` by default):

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.ps1) } -RemoveInstallDir"
```

## Access in Browser

- Default service URL: `http://127.0.0.1:3210`.
- Default generated UI password is empty (`ui_password = ""`), so password login is disabled by default.
- If installed with frontend, open `http://127.0.0.1:3210` directly.
- If installed API-only, use `http://127.0.0.1:3210/health` to verify service health.
- To enable UI after API-only install, set `ui_dir` in `opencode-studio.toml` to a valid `dist` path, or reinstall with frontend.
- For remote access from another machine, set `host = "0.0.0.0"`, restart service, then open `http://<server-ip>:3210`.

## Config

Service install uses a centralized root directory by default:

- Unix/macOS: `~/opencode-studio`
- Windows: `%USERPROFILE%\\opencode-studio`

Default layout under that directory:

- `bin/opencode-studio` (or `bin/opencode-studio.exe` on Windows)
- `dist/` (only when installing with frontend)
- `opencode-studio.toml`

Adjust `[backend]` fields in `opencode-studio.toml` to change runtime behavior:

- `host` / `port`
- `ui_password` (empty string disables UI password login)
- `opencode_host` / `opencode_port` (connect to existing OpenCode)
- `ui_dir` (serve frontend dist)

Windows installer writes `skip_opencode_start = true` and `opencode_port = 16000`, then manages
OpenCode via the companion `OpenCodeStudio-OpenCode` service.
To keep behavior consistent with desktop mode, the installer also injects user-profile environment
variables (`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `OPENCODE_STUDIO_DATA_DIR`, and
optional `OPENCODE_CONFIG`) into both Windows services.

Service units generated by the installer explicitly start with
`--config <install-root>/opencode-studio.toml`.
You can still override runtime config with `--config <path>` or `OPENCODE_STUDIO_CONFIG`.
