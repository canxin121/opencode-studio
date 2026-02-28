# 服务安装

[English](service.md) | 简体中文

本文介绍如何将 Rust 服务端（`opencode-studio`）安装为后台服务。

服务安装支持两种运行形态：

- 仅 API（默认）：仅后端（`/api/*` 等）
- 含前端：后端 + 静态 UI（在生成配置中设置 `--ui-dir`）

服务通过本地 `opencode serve` 管理 OpenCode 连接，因此需要提前安装 `opencode` 并确保在 `PATH` 中可用。

## 前置依赖

- 所有平台都需要已安装 OpenCode CLI（`opencode` 可在 `PATH` 中找到）。
- Windows 服务安装还需要：
  - 管理员权限 PowerShell（Run as Administrator）
  - `sc.exe`（Windows 标准组件内置）

安装 OpenCode（任选其一）：

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

验证：

```bash
opencode --version
```

## Linux / macOS（curl | bash）

安装含前端版本：

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh | bash -s -- --with-frontend
```

安装仅 API 版本：

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh | bash
```

指定版本安装（建议用于类生产环境）：

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh | bash -s -- --version v0.1.0 --with-frontend
```

安装后：

- Linux systemd 用户服务：`systemctl --user status opencode-studio`
- Linux systemd 系统服务：`sudo systemctl status opencode-studio`
- macOS launchd agent：`launchctl list | grep opencode`

卸载服务单元（不会自动删除二进制和数据，除非你手动删除）：

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/uninstall-service.sh | bash
```

## Windows（PowerShell）

安装脚本通过 `sc.exe` 创建 Windows 服务。

请在管理员权限 PowerShell 中运行：

安装含前端版本：

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.ps1) } -WithFrontend"
```

安装仅 API 版本：

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.ps1) }"
```

卸载：

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/uninstall-service.ps1) }"
```

## 浏览器访问

- 默认服务地址：`http://127.0.0.1:3000`。
- 含前端安装：直接打开 `http://127.0.0.1:3000`。
- 仅 API 安装：访问 `http://127.0.0.1:3000/health` 验证服务健康状态。
- 若仅 API 模式后续要启用 UI，可在 `opencode-studio.toml` 设置 `ui_dir` 指向有效 `dist` 路径，或重新安装为含前端模式。
- 需远程访问时，将 `host = "0.0.0.0"`，重启服务后访问 `http://<server-ip>:3000`。

## 配置

服务安装默认使用集中目录：

- Unix/macOS：`~/opencode-studio`
- Windows：`%USERPROFILE%\\opencode-studio`

默认目录结构：

- `bin/opencode-studio`（Windows 为 `bin/opencode-studio.exe`）
- `dist/`（仅含前端安装时存在）
- `opencode-studio.toml`

可在 `opencode-studio.toml` 中调整 `[backend]` 字段来修改运行行为：

- `host` / `port`
- `opencode_host` / `opencode_port`（连接已有 OpenCode）
- `ui_dir`（托管前端 dist）

安装脚本生成的服务单元会显式使用：
`--config <install-root>/opencode-studio.toml`。
你仍可通过 `--config <path>` 或 `OPENCODE_STUDIO_CONFIG` 覆盖配置路径。
