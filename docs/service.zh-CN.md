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
  - 首次安装可访问外网下载 NSSM（后续会缓存到 `%TEMP%`，并复制到 `<install-root>\\tools\\nssm.exe`）

可选但推荐（CI/共享出口环境）：

- 运行 Windows 安装脚本前设置 `GITHUB_TOKEN` 或 `GH_TOKEN`，避免读取 GitHub Release 元数据时触发 API 限流

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
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend
```

安装仅 API 版本：

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash
```

自定义监听地址 / 端口 / 密码安装：

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend --host 0.0.0.0 --port 3210 --ui-password "change-me"
```

指定版本安装（建议用于类生产环境）：

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --version v0.1.0 --with-frontend
```

安装后：

- Linux systemd 用户服务：`systemctl --user status opencode-studio`
- Linux systemd 系统服务：`sudo systemctl status opencode-studio`
- macOS launchd agent：`launchctl list | grep opencode`

仅卸载服务单元（保留安装文件）：

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash
```

卸载服务单元并同时删除安装文件（默认 `~/opencode-studio`）：

```bash
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.sh | bash -s -- --remove-install-dir
```

## Windows（PowerShell）

安装脚本通过 NSSM（`nssm.exe`）注册服务，并使用 `sc.exe` 管理生命周期。

Windows 安装会创建两个服务：

- `OpenCodeStudio-OpenCode`（运行 `opencode serve --port 16000`）
- `OpenCodeStudio`（依赖 `OpenCodeStudio-OpenCode`）

请在管理员权限 PowerShell 中运行：

安装含前端版本：

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend"
```

安装仅 API 版本：

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) }"
```

自定义监听地址 / 端口 / 密码安装：

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.ps1) } -WithFrontend -Host 0.0.0.0 -Port 3210 -UiPassword 'change-me'"
```

卸载：

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.ps1) }"
```

卸载并同时删除安装文件（默认 `%USERPROFILE%\\opencode-studio`）：

```powershell
iex "& { $(irm https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/uninstall-service.ps1) } -RemoveInstallDir"
```

## 浏览器访问

- 默认服务地址：`http://127.0.0.1:3210`。
- 生成配置里的默认 UI 密码为空（`ui_password = ""`），即默认不启用密码登录。
- 含前端安装：直接打开 `http://127.0.0.1:3210`。
- 仅 API 安装：访问 `http://127.0.0.1:3210/health` 验证服务健康状态。
- 若仅 API 模式后续要启用 UI，可在 `opencode-studio.toml` 设置 `ui_dir` 指向有效 `dist` 路径，或重新安装为含前端模式。
- 需远程访问时，将 `host = "0.0.0.0"`，重启服务后访问 `http://<server-ip>:3210`。

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
- `ui_password`（空字符串表示关闭 UI 密码登录）
- `opencode_host` / `opencode_port`（连接已有 OpenCode）
- `ui_dir`（托管前端 dist）

Windows 安装脚本会写入 `skip_opencode_start = true` 与 `opencode_port = 16000`，并通过
`OpenCodeStudio-OpenCode` 伴随服务托管 OpenCode。
为保证与桌面版一致，安装脚本还会向两个 Windows 服务注入用户目录相关环境变量
（`HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`OPENCODE_STUDIO_DATA_DIR`，以及可选
的 `OPENCODE_CONFIG`）。

安装脚本生成的服务单元会显式使用：
`--config <install-root>/opencode-studio.toml`。
你仍可通过 `--config <path>` 或 `OPENCODE_STUDIO_CONFIG` 覆盖配置路径。
