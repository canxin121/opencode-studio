# OpenCode Studio

English | [简体中文](README.zh-CN.md)

OpenCode Studio is a local-first workspace for OpenCode that brings chat, files, terminal, Git, and settings into one place. It works on Windows, macOS, and Linux, and supports both desktop package install and service-mode deployment.

> Note: This is a community project and is not built by the OpenCode team and is not affiliated with them. Upstream OpenCode: [anomalyco/opencode](https://github.com/anomalyco/opencode)

<p align="center">
  <img src="web/public/apple-touch-icon-180x180.png" width="128" alt="OpenCode Studio desktop app icon" />
</p>

## UI Preview

<details>
<summary><strong>Screenshots</strong> (click to expand)</summary>

<p align="center">
  <a href="assets/studio-chat.png"><img src="assets/studio-chat.png" width="320" alt="Chat view" /></a>
  <a href="assets/studio-files.png"><img src="assets/studio-files.png" width="320" alt="Files explorer + editor" /></a>
  <a href="assets/studio-terminal.png"><img src="assets/studio-terminal.png" width="320" alt="Integrated terminal" /></a>
  <a href="assets/studio-git.png"><img src="assets/studio-git.png" width="320" alt="Git status + diff" /></a>
  <a href="assets/studio-settings.png"><img src="assets/studio-settings.png" width="320" alt="Settings" /></a>
</p>

</details>

- Chat view: sessions, streaming messages, and tool traces.
- Files view: workspace browsing, editing, and search/replace.
- Terminal view: integrated PTY session for command workflows.
- Git view: status, diff, branch/worktree helpers.
- Settings view: OpenCode config layers + Studio-local settings.

## Functional Overview

- Unified workflow across chat, files, terminal, and Git in one workspace.
- OpenCode event-stream bridge with real-time updates and resume behavior.
- Visual configuration editing from the settings page.
- Plugin action entry points rendered in the Studio UI.

## Key Differentiators

- Performance-focused proxy path: payload pruning and response shaping for long sessions.
- Pagination-first data access: core lists use `offset`/`limit` to reduce initial load pressure.
- Lazy-loading strategy: heavier content is fetched/rendered on demand.
- Studio-only plugin UI system: discovers plugins via `opencode.json`, loads `studio.manifest.json`, and exposes actions in UI.
- Local-first plus ops-friendly deployment: use desktop package install or managed service install.

## Prerequisites

- OpenCode CLI is required on all platforms; install it before installing/running Studio service.
- Windows service install requires `sc.exe` (built into standard Windows) and an elevated PowerShell.
- Linux service install requires `systemctl` when you want managed autostart/service control.

Install OpenCode first (choose one method):

```bash
# macOS / Linux (official install script)
curl -fsSL https://opencode.ai/install | bash

# macOS / Linux (Homebrew)
brew install anomalyco/tap/opencode
```

```powershell
# Windows (Scoop)
scoop install opencode

# Windows (Chocolatey)
choco install opencode

# Any platform with Bun
bun add -g opencode-ai@latest
```

Verify before installing Studio service:

```bash
opencode --version
```

## Quick Install

Choose one of two installation paths based on your scenario.

### Option 1: Package Install (Desktop App)

Best for local desktop usage.

1. Open [GitHub Releases](https://github.com/canxin121/opencode-studio/releases/latest)
2. Download your platform package:
   - Windows: `.msi` / `.exe`
   - macOS: `.dmg`
   - Linux: `.AppImage` / `.deb` / `.rpm`
3. Install and launch the app; the bundled backend service starts automatically.

### Option 2: Service Install

Best for always-on hosts, server-like usage, or environments managed by `systemd` / `sc` (Windows uses an NSSM service wrapper under SCM).

On Windows, installer scripts register two services:

- `OpenCodeStudio-OpenCode` (managed `opencode serve` on port `16000`)
- `OpenCodeStudio` (web/API service depending on `OpenCodeStudio-OpenCode`)

Unix (Linux/macOS):

```bash
# service install with bundled UI
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend

# service install API-only (no bundled UI)
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash

# service install with custom bind host/port/password
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend --host 0.0.0.0 --port 3210 --ui-password "change-me"
```

Windows PowerShell (run as Administrator):

```powershell
# service install with bundled UI
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend"

# service install API-only (no bundled UI)
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) }"

# service install with custom bind host/port/password
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend -Host 0.0.0.0 -Port 3210 -UiPassword 'change-me'"
```

## After Install: Open in Browser

- Default service address is `http://127.0.0.1:3210` (from `host` + `port` in config).
- Default generated auth password is empty (`ui_password = ""`), which keeps password login disabled.
- If installed with frontend, open `http://127.0.0.1:3210` directly.
- If installed API-only, use `http://127.0.0.1:3210/health` to verify service is running.
- To enable UI after API-only install, set `ui_dir` in `opencode-studio.toml` to a valid `dist` directory, or reinstall with `--with-frontend` / `-WithFrontend`.
- For remote machine access, change `host` to `0.0.0.0`, restart service, then visit `http://<server-ip>:3210`.

## After Install: Update Configuration

### Service install

The installer generates `opencode-studio.toml`:

- Unix: `~/opencode-studio/opencode-studio.toml`
- Windows: `%USERPROFILE%\\opencode-studio\\opencode-studio.toml`

Edit key values under `[backend]` to update host/port, UI serving path, or OpenCode connection mode:

```toml
[backend]
host = "127.0.0.1"
port = 3210
ui_password = ""
skip_opencode_start = false
opencode_host = "127.0.0.1"
# opencode_port = 16000
# ui_dir = "/absolute/path/to/web/dist"
```

Windows service installs default to `skip_opencode_start = true` so the service can start reliably under SCM.
The installer also writes `opencode_port = 16000` and manages a companion `OpenCodeStudio-OpenCode` service.

Apply changes by restarting the service:

- Linux user service: `systemctl --user restart opencode-studio`
- Linux system service: `sudo systemctl restart opencode-studio`
- Windows service: `sc stop OpenCodeStudio` then `sc start OpenCodeStudio`

### Package install

In package mode, runtime config is stored in the app data directory. Use the tray menu action to open the config file directly.

## After Install: Manage Service (start/stop/restart/autostart/uninstall)

The commands below apply to the service-install path.

Linux (default user-mode install):

```bash
# status / start / stop / restart
systemctl --user status opencode-studio
systemctl --user start opencode-studio
systemctl --user stop opencode-studio
systemctl --user restart opencode-studio

# autostart on login
systemctl --user enable opencode-studio
systemctl --user disable opencode-studio

# uninstall service unit
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash

# uninstall service unit + installed files
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash -s -- --remove-install-dir
```

Linux (`--mode system` install):

```bash
# status / start / stop / restart
sudo systemctl status opencode-studio
sudo systemctl start opencode-studio
sudo systemctl stop opencode-studio
sudo systemctl restart opencode-studio

# autostart on boot
sudo systemctl enable opencode-studio
sudo systemctl disable opencode-studio

# uninstall service unit
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash

# uninstall service unit + installed files
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash -s -- --remove-install-dir
```

macOS (launchd, label: `cn.cxits.opencode-studio`):

```bash
# status
launchctl list | grep opencode

# restart
launchctl kickstart -k gui/$(id -u)/cn.cxits.opencode-studio

# stop autostart (unload agent)
launchctl unload "$HOME/Library/LaunchAgents/cn.cxits.opencode-studio.plist"

# enable autostart again (load agent)
launchctl load "$HOME/Library/LaunchAgents/cn.cxits.opencode-studio.plist"

# uninstall service agent
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash

# uninstall service agent + installed files
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash -s -- --remove-install-dir
```

Windows (service names: `OpenCodeStudio-OpenCode`, `OpenCodeStudio`):

```powershell
# status / start / stop / restart
sc query OpenCodeStudio-OpenCode
sc query OpenCodeStudio
sc start OpenCodeStudio-OpenCode
sc start OpenCodeStudio
sc stop OpenCodeStudio
sc stop OpenCodeStudio-OpenCode
sc stop OpenCodeStudio; sc start OpenCodeStudio

# autostart
sc config OpenCodeStudio-OpenCode start= auto
sc config OpenCodeStudio start= auto

# disable autostart
sc config OpenCodeStudio start= demand
sc config OpenCodeStudio-OpenCode start= demand

# uninstall services
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.ps1) }"

# uninstall services + installed files
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.ps1) } -RemoveInstallDir"
```

## Technical Details and Parameters

All technical details, configuration parameters, and developer-centric references are consolidated in:

- [`docs/technical-reference.md`](docs/technical-reference.md)

Related docs:

- [`docs/service.md`](docs/service.md) (service install/uninstall details)
- [`docs/packaging.md`](docs/packaging.md) (package artifacts and build outputs)
- [`docs/opencode-studio.toml.example`](docs/opencode-studio.toml.example) (runtime config example)
- [`SECURITY.md`](SECURITY.md) (security notes)
- [`CONTRIBUTING.md`](CONTRIBUTING.md) (contribution guide)

## License

MIT.

See [`LICENSE`](LICENSE).
