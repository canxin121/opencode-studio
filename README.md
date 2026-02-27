# OpenCode Studio

English | [简体中文](README.zh-CN.md)

OpenCode Studio is a local-first web UI for OpenCode. It runs a Rust (Axum) server that serves the built Vue app and bridges/proxies requests to an OpenCode server (`opencode serve`).

> Note: This is a community project and is not built by the OpenCode team and is not affiliated with them. Upstream OpenCode: https://github.com/anomalyco/opencode

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

# Any platform with Node.js
npm i -g opencode-ai@latest
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
3. Install and launch the app; the bundled backend sidecar starts automatically.

### Option 2: Service Install

Best for always-on hosts, server-like usage, or environments managed by `systemd` / `sc`.

Unix (Linux/macOS):

```bash
# service install with bundled UI
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh | bash -s -- --with-frontend

# service install API-only (no bundled UI)
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh | bash
```

Windows PowerShell (run as Administrator):

```powershell
# service install with bundled UI
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.ps1) } -WithFrontend"

# service install API-only (no bundled UI)
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.ps1) }"
```

## After Install: Open in Browser

- Default service address is `http://127.0.0.1:3000` (from `host` + `port` in config).
- If installed with frontend, open `http://127.0.0.1:3000` directly.
- If installed API-only, use `http://127.0.0.1:3000/health` to verify service is running.
- To enable UI after API-only install, set `ui_dir` in `opencode-studio.toml` to a valid `dist` directory, or reinstall with `--with-frontend` / `-WithFrontend`.
- For remote machine access, change `host` to `0.0.0.0`, restart service, then visit `http://<server-ip>:3000`.

## After Install: Update Configuration

### Service install

The installer generates `opencode-studio.toml`:

- Unix: `~/opencode-studio/opencode-studio.toml`
- Windows: `%USERPROFILE%\\opencode-studio\\opencode-studio.toml`

Edit key values under `[backend]` to update host/port, UI serving path, or OpenCode connection mode:

```toml
[backend]
host = "127.0.0.1"
port = 3000
skip_opencode_start = false
opencode_host = "127.0.0.1"
# opencode_port = 16000
# ui_dir = "/absolute/path/to/web/dist"
```

Apply changes by restarting the service:

- Linux user service: `systemctl --user restart opencode-studio`
- Linux system service: `sudo systemctl restart opencode-studio`
- Windows service: `sc stop OpenCodeStudio` then `sc start OpenCodeStudio`

### Package install

In package mode, runtime config is stored in the app data directory. Use the tray menu action to open the config file directly.

## After Install: Manage Service (systemd / sc)

The commands below apply to the service-install path.

Linux (default user-mode install):

```bash
systemctl --user status opencode-studio
systemctl --user start opencode-studio
systemctl --user stop opencode-studio
systemctl --user restart opencode-studio
```

Linux (`--mode system` install):

```bash
sudo systemctl status opencode-studio
sudo systemctl start opencode-studio
sudo systemctl stop opencode-studio
sudo systemctl restart opencode-studio
```

Windows (default service name `OpenCodeStudio`):

```powershell
sc query OpenCodeStudio
sc start OpenCodeStudio
sc stop OpenCodeStudio
```

## Technical Details and Parameters

All technical details, configuration parameters, and developer-centric references are consolidated in:

- `docs/technical-reference.md`

Related docs:

- `docs/service.md` (service install/uninstall details)
- `docs/packaging.md` (package artifacts and build outputs)
- `docs/opencode-studio.toml.example` (runtime config example)
- `SECURITY.md` (security notes)
- `CONTRIBUTING.md` (contribution guide)

## License

MIT.

See `LICENSE`.
