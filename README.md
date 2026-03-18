# OpenCode Studio

English | [简体中文](docs/i18n/zh-CN/README.md) | [Español](docs/i18n/es/README.md) | [हिंदी](docs/i18n/hi-IN/README.md) | [العربية](docs/i18n/ar-SA/README.md) | [Português (Brasil)](docs/i18n/pt-BR/README.md) | [Français](docs/i18n/fr-FR/README.md)

<p align="center">
  <img src="web/public/apple-touch-icon-180x180.png" width="128" alt="OpenCode Studio desktop app icon" />
</p>

<p align="center">
  <strong>OpenCode Studio for focused OpenCode workflows.</strong><br />
  One workspace for chat, files, terminal, Git, and settings.<br />
  Built for fast local usage and reliable always-on deployment.
</p>

<p align="center">
  <a href="https://github.com/canxin121/opencode-studio/releases/latest">Get Release</a>
  ·
  <a href="docs/technical-reference.md">Technical Docs</a>
  ·
  <a href="docs/service.md">Service Install</a>
  ·
  <a href="docs/i18n/README.md">Language Index</a>
  ·
  <a href="https://github.com/canxin121/opencode-studio/issues">Issue Tracker</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/canxin121/opencode-studio/ci.yml?branch=master&style=flat-square&label=build" alt="Build status" />
  <img src="https://img.shields.io/github/v/release/canxin121/opencode-studio?style=flat-square&label=release" alt="Latest release" />
  <img src="https://img.shields.io/github/license/canxin121/opencode-studio?style=flat-square&label=license" alt="License" />
  <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-2F855A?style=flat-square" alt="Supported platforms" />
  <img src="https://img.shields.io/badge/modes-Desktop%20%7C%20Service-1f6feb?style=flat-square" alt="Run modes" />
</p>

> Note: This is a community project and is not built by the OpenCode team and is not affiliated with them. Upstream OpenCode: [anomalyco/opencode](https://github.com/anomalyco/opencode)

<a id="language-support"></a>
## Language Support

OpenCode Studio frontend i18n and top-level docs support the following locales:

- `zh-CN`: Simplified Chinese
- `en-US`: English
- `es-ES`: Spanish (Spain)
- `hi-IN`: Hindi (India)
- `ar-SA`: Arabic (Saudi Arabia)
- `pt-BR`: Portuguese (Brazil)
- `fr-FR`: French (France)

See [`docs/i18n/README.md`](docs/i18n/README.md) for the language matrix and cross-links.

<a id="contents"></a>
## Contents

- [Language Support](#language-support)
- [Why OpenCode Studio](#why-opencode-studio)
- [Recommended Plugin: Managed Web Previews](#recommended-plugin-managed-web-previews)
- [UI Preview](#ui-preview)
- [Quick Start (2 minutes)](#quick-start)
- [Installation Details](#installation-details)
- [After Install](#after-install)
- [Troubleshooting](#troubleshooting)
- [Service Management](#service-management)
- [Technical Details and Parameters](#technical-details-and-parameters)
- [License](#license)

<a id="why-opencode-studio"></a>
## Why OpenCode Studio

- Unified workflow across chat, files, terminal, and Git in one workspace.
- OpenCode event-stream bridge with real-time updates and resume behavior.
- Performance-focused proxy path with payload pruning and response shaping for long sessions.
- Pagination-first data access (`offset`/`limit`) to reduce initial load pressure.
- Lazy-loading strategy so heavier content is fetched and rendered on demand.
- Studio-only plugin UI system: discovers plugins via `opencode.json`, loads `studio.manifest.json`, and exposes actions in UI.
- Local-first plus ops-friendly deployment: package install for desktop use, or managed service install for always-on usage.

<a id="recommended-plugin-managed-web-previews"></a>
## Recommended Plugin: Managed Web Previews

If you do frontend work in OpenCode Studio, install [`opencode-web-preview`](https://github.com/canxin121/opencode-web-preview) in OpenCode. This plugin is built specifically for Studio and cannot be used standalone: Studio owns preview session storage, proxy routing, and preview lifecycle, while the plugin lets the agent start, stop, restart, and inspect local dev servers with Studio-compatible preview links.

- npm package: [`opencode-web-preview`](https://www.npmjs.com/package/opencode-web-preview)
- Plugin repo: [`canxin121/opencode-web-preview`](https://github.com/canxin121/opencode-web-preview)

Add it to your OpenCode config file `opencode.json`:

- Unix/macOS: `~/.config/opencode/opencode.json`
- Windows: `%USERPROFILE%\\.config\\opencode\\opencode.json` (for example: `C:\\Users\\<your-user>\\.config\\opencode\\opencode.json`)

```jsonc
{
  "plugin": ["opencode-web-preview"]
}
```

OpenCode installs npm plugins automatically when the session starts.

Example prompt:

```text
Use web_preview_helper to start a managed preview for this frontend workspace.
```

<a id="ui-preview"></a>
## UI Preview

<p align="center">
  <a href="assets/studio-chat.png"><img src="assets/studio-chat.png" width="300" alt="Chat view" /></a>
  <a href="assets/studio-files.png"><img src="assets/studio-files.png" width="300" alt="Files explorer and editor" /></a>
  <a href="assets/studio-terminal.png"><img src="assets/studio-terminal.png" width="300" alt="Integrated terminal" /></a>
</p>
<p align="center">
  <a href="assets/studio-git.png"><img src="assets/studio-git.png" width="300" alt="Git status and diff" /></a>
  <a href="assets/studio-settings.png"><img src="assets/studio-settings.png" width="300" alt="Settings" /></a>
</p>

- Chat view: sessions, streaming messages, and tool traces.
- Files view: workspace browsing, editing, and search/replace.
- Terminal view: integrated PTY session for command workflows.
- Git view: status, diff, branch/worktree helpers.
- Settings view: OpenCode config layers plus Studio-local settings.

<a id="quick-start"></a>
## Quick Start (2 minutes)

1. Install OpenCode CLI first (choose one method).

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

2. Verify installation.

```bash
opencode --version
```

3. Choose an installation path.

| Scenario | Recommended path | What you get |
| --- | --- | --- |
| Local desktop usage | Package install | Native desktop app with bundled backend service |
| Always-on host / server-like environment | Service install | Managed service via `systemd`, `launchd`, or Windows SCM |

4. Open in browser:
- Frontend-enabled install: `http://127.0.0.1:3210`
- API-only install: `http://127.0.0.1:3210/health`

<a id="installation-details"></a>
## Installation Details

### Option 1: Package Install (Desktop App)

Best for local desktop usage.

1. Open [GitHub Releases](https://github.com/canxin121/opencode-studio/releases/latest)
2. Download your platform package:
   - Windows: `.msi` / `.exe`
   - macOS: `.dmg`
   - Linux: `.AppImage` / `.deb` / `.rpm`
3. Install and launch the app; the bundled backend service starts automatically.

### Option 2: Service Install

Best for always-on hosts, server-like usage, or environments managed by `systemd` / `launchd` / `sc` (Windows uses an NSSM service wrapper under SCM).

On Windows, installer scripts register two services:
- `OpenCodeStudio-OpenCode` (managed `opencode serve` on port `16000`)
- `OpenCodeStudio` (web/API service depending on `OpenCodeStudio-OpenCode`)

Unix (Linux/macOS):

```bash
# Service install with bundled UI
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend

# Service install API-only (no bundled UI)
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash

# Service install with custom bind host/port/password
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend --host 0.0.0.0 --port 3210 --ui-password "change-me"
```

Windows PowerShell (run as Administrator):

```powershell
# Service install with bundled UI
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend"

# Service install API-only (no bundled UI)
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) }"

# Service install with custom bind host/port/password
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend -Host 0.0.0.0 -Port 3210 -UiPassword 'change-me'"
```

<a id="after-install"></a>
## After Install

### Open in browser

- Default service address is `http://127.0.0.1:3210` (from `host` + `port` in config).
- Default generated auth password is empty (`ui_password = ""`), so password login is disabled.
- If installed with frontend, open `http://127.0.0.1:3210` directly.
- If installed API-only, use `http://127.0.0.1:3210/health` to verify service health.
- To enable UI after API-only install, set `ui_dir` in `opencode-studio.toml` to a valid `dist` directory, or reinstall with `--with-frontend` / `-WithFrontend`.
- For remote machine access, change `host` to `0.0.0.0`, restart service, then visit `http://<server-ip>:3210`.

### Update configuration

For service install, the installer generates `opencode-studio.toml`:
- Unix: `~/opencode-studio/opencode-studio.toml`
- Windows: `%USERPROFILE%\\opencode-studio\\opencode-studio.toml`

Edit key values under `[backend]`:

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

Windows service installs default to `skip_opencode_start = true` so the service can start reliably under SCM. The installer also writes `opencode_port = 16000` and manages a companion `OpenCodeStudio-OpenCode` service.

Apply changes by restarting the service:
- Linux user service: `systemctl --user restart opencode-studio`
- Linux system service: `sudo systemctl restart opencode-studio`
- Windows service: `sc stop OpenCodeStudio` then `sc start OpenCodeStudio`

For package install, runtime config is stored in the app data directory. Use the tray menu action to open the config file directly.

<a id="troubleshooting"></a>
<details>
<summary><strong>Troubleshooting</strong></summary>

### macOS: app is damaged and can't be opened

This usually means macOS Gatekeeper is blocking a downloaded (non-notarized) build.

1. Open the `.dmg` and drag `OpenCode Studio.app` into `/Applications`.
2. In Finder, open `/Applications`, right-click the app -> Open -> confirm.
3. If it still shows the "damaged" dialog, remove the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/OpenCode Studio.app"
```

Then launch the app again.

</details>

<a id="service-management"></a>
## Service Management

The commands below apply to the service-install path.

<details>
<summary><strong>Linux (default user-mode install)</strong></summary>

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

</details>

<details>
<summary><strong>Linux (--mode system install)</strong></summary>

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

</details>

<details>
<summary><strong>macOS (launchd, label: cn.cxits.opencode-studio)</strong></summary>

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

</details>

<details>
<summary><strong>Windows (services: OpenCodeStudio-OpenCode, OpenCodeStudio)</strong></summary>

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

</details>

<a id="technical-details-and-parameters"></a>
## Technical Details and Parameters

All technical details, configuration parameters, and developer-centric references are consolidated in:

- [`docs/technical-reference.md`](docs/technical-reference.md)

Related docs:
- [`docs/service.md`](docs/service.md) (service install/uninstall details)
- [`docs/packaging.md`](docs/packaging.md) (package artifacts and build outputs)
- [`desktop/README.md`](desktop/README.md) (desktop packaging notes)
- [`docs/opencode-studio.toml.example`](docs/opencode-studio.toml.example) (runtime config example)
- [`docs/backend-accel-parity-review.md`](docs/backend-accel-parity-review.md) (backend acceleration parity review)
- [`docs/i18n/README.md`](docs/i18n/README.md) (language matrix)
- [`SECURITY.md`](SECURITY.md) (security notes)
- [`CONTRIBUTING.md`](CONTRIBUTING.md) (contribution guide)

## License

MIT. See [`LICENSE`](LICENSE).
