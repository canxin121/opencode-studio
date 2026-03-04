# OpenCode Studio

[English](README.md) | 简体中文

OpenCode Studio 是一个面向 OpenCode 的本地优先 Web UI。它运行一个 Rust (Axum) 服务端：负责托管构建后的 Vue 前端资源，并将请求桥接/代理到 OpenCode 服务（`opencode serve`）。

> 说明：本项目为社区实现，非 OpenCode 团队官方项目，与其不存在官方隶属关系。OpenCode 上游项目：https://github.com/anomalyco/opencode

<p align="center">
  <img src="web/public/apple-touch-icon-180x180.png" width="128" alt="OpenCode Studio 桌面版图标" />
</p>

## 页面展示

<details>
<summary><strong>界面截图</strong>（点击展开）</summary>

<p align="center">
  <a href="assets/studio-chat.png"><img src="assets/studio-chat.png" width="320" alt="聊天界面" /></a>
  <a href="assets/studio-files.png"><img src="assets/studio-files.png" width="320" alt="文件浏览与编辑" /></a>
  <a href="assets/studio-terminal.png"><img src="assets/studio-terminal.png" width="320" alt="内置终端" /></a>
  <a href="assets/studio-git.png"><img src="assets/studio-git.png" width="320" alt="Git 状态与 Diff" /></a>
  <a href="assets/studio-settings.png"><img src="assets/studio-settings.png" width="320" alt="设置页" /></a>
</p>

</details>

- 聊天页面：会话管理、消息流、工具调用可视化。
- 文件页面：工作区浏览、编辑、搜索/替换。
- 终端页面：集成 PTY 终端，支持常见命令操作。
- Git 页面：状态查看、差异对比、分支/worktree 辅助。
- 设置页面：OpenCode 配置层与 Studio 本地配置集中管理。

## 功能介绍

- 多面板协同：聊天、文件、终端、Git 在一个工作区内联动。
- OpenCode 事件流桥接：支持实时流式消息和会话恢复。
- 配置可视化：可在设置页读取与编辑多层配置。
- 插件交互入口：可加载插件 UI 描述并触发插件动作。

## 特性介绍

- 性能优化链路：在代理层进行事件裁剪、结果精简与传输减负，降低长会话卡顿。
- 分页机制：会话列表、消息列表、目录列表等核心数据走 `offset`/`limit` 分页，减少首屏压力。
- 懒加载策略：较重内容按需请求与展开，避免一次性加载全部上下文。
- 独有插件 UI 系统：从 `opencode.json` 发现插件，加载 `studio.manifest.json` 并在 UI 中提供可操作入口。
- 本地优先与可运维：既能桌面安装即开即用，也能以系统服务稳定常驻。

## 前置依赖

- 所有平台都需要提前安装 OpenCode CLI，再安装/运行 Studio 服务。
- Windows 服务安装依赖 `sc.exe`（Windows 标准组件内置），并需使用管理员权限 PowerShell。
- Linux 想使用系统服务管理时，需要 `systemctl`。

先安装 OpenCode（任选一种方式）：

```bash
# macOS / Linux（官方安装脚本）
curl -fsSL https://opencode.ai/install | bash

# macOS / Linux（Homebrew）
brew install anomalyco/tap/opencode
```

```powershell
# Windows（Scoop）
scoop install opencode

# Windows（Chocolatey）
choco install opencode

# 任意平台（已安装 Bun）
bun add -g opencode-ai@latest
```

安装 Studio 服务前建议先确认：

```bash
opencode --version
```

## 快速安装

你可以按场景选择两种安装方式：

### 方式一：安装包安装（Desktop App）

适合本机桌面使用（开箱即用）。

1. 打开 [GitHub Releases 页面](https://github.com/canxin121/opencode-studio/releases/latest)
2. 按系统下载安装包：
   - Windows：`.msi` / `.exe`
   - macOS：`.dmg`
   - Linux：`.AppImage` / `.deb` / `.rpm`
3. 安装并启动应用后，内置后端服务会自动启动。

### 方式二：服务安装（Service）

适合服务器、开发机常驻、或需要用 `systemd` / `sc` 统一管理的场景（Windows 由 SCM + NSSM 包装运行服务进程）。

Windows 安装脚本会注册两个服务：

- `OpenCodeStudio-OpenCode`（托管 `opencode serve`，端口 `16000`）
- `OpenCodeStudio`（Web/API 服务，依赖 `OpenCodeStudio-OpenCode`）

Unix（Linux/macOS）：

```bash
# 服务安装（含内置 UI）
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend

# 服务安装（仅 API，不带内置 UI）
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash

# 服务安装（自定义监听地址 / 端口 / 密码）
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend --host 0.0.0.0 --port 3210 --ui-password "change-me"
```

Windows PowerShell（管理员权限）：

```powershell
# 服务安装（含内置 UI）
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend"

# 服务安装（仅 API，不带内置 UI）
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) }"

# 服务安装（自定义监听地址 / 端口 / 密码）
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend -Host 0.0.0.0 -Port 3210 -UiPassword 'change-me'"
```

## 安装后：如何在浏览器访问

- 服务默认地址是 `http://127.0.0.1:3210`（由配置里的 `host` + `port` 决定）。
- 生成配置里的默认认证密码为空（`ui_password = ""`），即默认不启用密码登录。
- 如果是“含内置 UI”安装，直接打开 `http://127.0.0.1:3210`。
- 如果是“仅 API”安装，可访问 `http://127.0.0.1:3210/health` 确认服务是否正常。
- 仅 API 模式想启用网页 UI，可在 `opencode-studio.toml` 中设置 `ui_dir` 指向有效的 `dist` 目录，或重新用 `--with-frontend` / `-WithFrontend` 安装。
- 需要远程机器访问时，把 `host` 改为 `0.0.0.0`，重启服务后通过 `http://<服务器IP>:3210` 访问。

## 安装后：如何调整配置文件

### 服务安装

安装完成后会生成 `opencode-studio.toml`：

- Unix：`~/opencode-studio/opencode-studio.toml`
- Windows：`%USERPROFILE%\\opencode-studio\\opencode-studio.toml`

可直接修改 `[backend]` 下的关键项，例如监听地址、端口、UI 路径、OpenCode 连接方式：

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

Windows 服务安装默认写入 `skip_opencode_start = true`，以提高在 SCM 下的启动稳定性。
安装脚本还会写入 `opencode_port = 16000`，并自动托管 `OpenCodeStudio-OpenCode` 伴随服务。

修改后重启服务生效：

- Linux 用户服务：`systemctl --user restart opencode-studio`
- Linux 系统服务：`sudo systemctl restart opencode-studio`
- Windows 服务：`sc stop OpenCodeStudio` 后执行 `sc start OpenCodeStudio`

### 安装包安装

安装包模式下，配置文件位于应用数据目录；可通过托盘菜单直接打开配置文件（Open Config）进行修改。

## 安装后：服务管理（启动/停止/重启/自启动/卸载）

以下命令适用于“服务安装”模式。

Linux（默认 user 模式）：

```bash
# 状态 / 启动 / 停止 / 重启
systemctl --user status opencode-studio
systemctl --user start opencode-studio
systemctl --user stop opencode-studio
systemctl --user restart opencode-studio

# 登录自启动
systemctl --user enable opencode-studio
systemctl --user disable opencode-studio

# 卸载服务单元
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash
```

Linux（`--mode system` 安装）：

```bash
# 状态 / 启动 / 停止 / 重启
sudo systemctl status opencode-studio
sudo systemctl start opencode-studio
sudo systemctl stop opencode-studio
sudo systemctl restart opencode-studio

# 开机自启动
sudo systemctl enable opencode-studio
sudo systemctl disable opencode-studio

# 卸载服务单元
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash
```

macOS（launchd，标签：`cn.cxits.opencode-studio`）：

```bash
# 状态
launchctl list | grep opencode

# 重启
launchctl kickstart -k gui/$(id -u)/cn.cxits.opencode-studio

# 关闭自启动（卸载 agent）
launchctl unload "$HOME/Library/LaunchAgents/cn.cxits.opencode-studio.plist"

# 重新开启自启动（加载 agent）
launchctl load "$HOME/Library/LaunchAgents/cn.cxits.opencode-studio.plist"

# 卸载服务 agent
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash
```

Windows（服务名：`OpenCodeStudio-OpenCode`、`OpenCodeStudio`）：

```powershell
# 状态 / 启动 / 停止 / 重启
sc query OpenCodeStudio-OpenCode
sc query OpenCodeStudio
sc start OpenCodeStudio-OpenCode
sc start OpenCodeStudio
sc stop OpenCodeStudio
sc stop OpenCodeStudio-OpenCode
sc stop OpenCodeStudio; sc start OpenCodeStudio

# 开机自启动
sc config OpenCodeStudio-OpenCode start= auto
sc config OpenCodeStudio start= auto

# 关闭自启动
sc config OpenCodeStudio start= demand
sc config OpenCodeStudio-OpenCode start= demand

# 卸载服务
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.ps1) }"

# 卸载服务 + 删除安装文件
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.ps1) } -RemoveInstallDir"
```

## 技术细节与参数

技术栈、目录结构、CLI/环境变量参数、安装脚本参数、连接外部 OpenCode、开发命令等统一放在：

- `docs/technical-reference.md`

补充文档：

- `docs/service.md`（服务安装/卸载细节）
- `docs/packaging.md`（安装包与构建产物说明）
- `docs/opencode-studio.toml.example`（配置模板）
- `SECURITY.md`（安全说明）
- `CONTRIBUTING.md`（贡献指南）

## License

本项目采用 MIT License，详见 `LICENSE`。
