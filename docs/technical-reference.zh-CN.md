# OpenCode Studio 技术参考

[English](technical-reference.md) | 简体中文

本文集中收录主 README 中刻意下沉的技术细节与参数参考。

## 技术栈

- 后端：Rust 2024、Axum、Tokio、tower-http
- 前端：Vue 3 + TypeScript、Vite、Tailwind CSS 4、Pinia、Monaco Editor、xterm.js、PWA（service worker）

## 仓库结构

- `server/`：Rust 后端（HTTP API + OpenCode bridge + 静态资源托管）
- `web/`：Vue 前端应用（构建输出在 `web/dist`）
- `scripts/`：跨平台安装/卸载脚本
- `docs/`：运维与打包文档

## 前置依赖

- Rust 工具链（stable）
- Bun（CI 策略：通过 `bun-version: latest` 持续跟随稳定版）
- 已安装 OpenCode CLI，且在 `PATH` 可用（`opencode --version`）
- 仅 Windows 服务安装：管理员权限 PowerShell + `sc.exe`

安装 OpenCode 示例：

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

## 安装路径

OpenCode Studio 支持两条安装路径：

1) 安装包安装（桌面应用）

- 从 GitHub Releases 下载原生安装包（`.msi`/`.exe`、`.dmg`、`.AppImage`/`.deb`/`.rpm`）。
- 包含前端 UI 和内置后端 sidecar。
- 适合本机桌面使用。

2) 服务安装

- 通过 `scripts/install-service.sh`（Unix）或 `scripts/install-service.ps1`（Windows）安装后端服务。
- 适合长期运行或服务化管理场景（`systemd`/`sc`）。
- 服务安装形态：
  - 含前端：服务安装 + 内置 web UI 产物
  - 仅 API：服务安装，不包含内置 UI
- 默认安装根目录：
  - Unix/macOS：`~/opencode-studio`
  - Windows：`%USERPROFILE%\\opencode-studio`

## 本地快速开始（源码运行）

1) 安装 Web 依赖

```bash
bun install --cwd web
```

2) 构建 UI

```bash
bun run --cwd web build
```

3) 启动 Studio 服务（托管 UI + `/api/*`）

```bash
cargo run -p opencode-studio -- \
  --ui-dir web/dist
```

访问 `http://127.0.0.1:3000`。

说明：

- CI 使用冻结安装：`bun install --cwd web --frozen-lockfile`。
- `--ui-dir`（或 `OPENCODE_STUDIO_UI_DIR`）为可选；不设置时为仅 API/headless 模式。
- 若未提供 `--opencode-port` / `OPENCODE_PORT`，Studio 会尝试拉起 `opencode serve`。

## 连接已有 OpenCode 服务

```bash
cargo run -p opencode-studio -- \
  --opencode-port 16000 \
  --opencode-host 127.0.0.1 \
  --ui-dir web/dist
```

对应环境变量：

- `OPENCODE_PORT=16000`
- `OPENCODE_HOST=127.0.0.1`

## 服务安装脚本参数参考

### Unix 安装脚本（`scripts/install-service.sh`）

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--with-frontend` | disabled | 安装后端 + 内置 Web UI |
| `--repo owner/repo` | `canxin121/opencode-studio` | Release 资产来源仓库 |
| `--version vX.Y.Z` | latest | 指定安装版本 |
| `--install-dir PATH` | `~/opencode-studio` | 安装根目录（含 `bin/`、可选 `dist/`、`opencode-studio.toml`） |
| `--mode user|system` | `user` | Linux systemd 安装模式 |

### Windows 安装脚本（`scripts/install-service.ps1`）

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-WithFrontend` | disabled | 除后端外同时安装内置 Web UI |
| `-Repo owner/repo` | `canxin121/opencode-studio` | Release 资产来源仓库 |
| `-Version vX.Y.Z` | latest | 指定安装版本 |
| `-InstallDir PATH` | `%USERPROFILE%\\opencode-studio` | 安装根目录（含 `bin\\`、可选 `dist\\`、`opencode-studio.toml`） |
| `-Port PORT` | `3000` | 生成配置时的初始后端端口 |

## 运行参数（CLI Flags / Env Vars）

### 后端核心参数

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCODE_STUDIO_CONFIG` / `--config` | `<exe-dir>/opencode-studio.toml` | 运行时 TOML 配置路径；未设置时可从可执行文件目录自动加载 |
| `OPENCODE_STUDIO_HOST` / `--host` | `127.0.0.1` | 监听地址 |
| `OPENCODE_STUDIO_PORT` / `--port` | `3000` | HTTP 端口 |
| `OPENCODE_STUDIO_UI_DIR` / `--ui-dir` | (unset) | 前端构建目录；未设置则为仅 API/headless |

### OpenCode bridge 参数

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCODE_PORT` / `--opencode-port` | (unset) | 连接已运行的 OpenCode 实例 |
| `OPENCODE_HOST` / `--opencode-host` | `127.0.0.1` | 与 `OPENCODE_PORT` 搭配使用 |
| `OPENCODE_STUDIO_SKIP_OPENCODE_START` / `--skip-opencode-start` | `false` | 不自动拉起 `opencode serve` |
| `OPENCODE_STUDIO_OPENCODE_LOG_LEVEL` / `--opencode-log-level` | (unset) | 传给托管 OpenCode 的日志级别 |
| `OPENCODE_STUDIO_OPENCODE_LOGS` | (unset) | 设为 `true/1/yes/on` 时转发托管 OpenCode 日志 |

### UI 认证与数据

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCODE_STUDIO_UI_PASSWORD` / `--ui-password` | (disabled) | 启用基于 Cookie 的 UI 登录 |
| `OPENCODE_STUDIO_DATA_DIR` | `~/.config/opencode-studio` | 存放 `settings.json`、终端注册信息等 |

### 高级参数（节选）

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCODE_CONFIG` | (unset) | 额外 OpenCode 配置文件路径 |
| `OPENCODE_STUDIO_GIT_TIMEOUT_MS` | `60000` | Git 操作超时 |
| `OPENCODE_STUDIO_TERMINAL_IDLE_TIMEOUT_SECS` | (unset) | 设为正整数时自动清理空闲终端 |

## 配置文件与路径

- 运行配置（服务/后端）：`opencode-studio.toml`
  - 服务安装默认：`<install-root>/opencode-studio.toml`（服务单元会显式传 `--config`）
  - 手动运行回退：从当前可执行文件目录自动发现
  - 可用 `--config <path>` 或 `OPENCODE_STUDIO_CONFIG` 覆盖
- Studio 设置：`~/.config/opencode-studio/settings.json`
  - 可用 `OPENCODE_STUDIO_DATA_DIR` 覆盖基目录
- OpenCode 配置层（可在 Studio 中读取/编辑）：
  - 用户层：`~/.config/opencode/opencode.json`
  - 项目层：`opencode.json` / `opencode.jsonc`（或 `.opencode/`）
  - 自定义层：`OPENCODE_CONFIG`

安装脚本生成的运行配置默认位置：

- Unix：`~/opencode-studio/opencode-studio.toml`
- Windows：`%USERPROFILE%\\opencode-studio\\opencode-studio.toml`

参考样例：`docs/opencode-studio.toml.example`

## 开发命令

Web：

```bash
bun run --cwd web fmt
bun run --cwd web test
bun run --cwd web build:rust-debug
```

Rust：

```bash
cargo test -q --manifest-path server/Cargo.toml
```

提示：如果要更好地调试 UI，可使用 `build:rust-debug`，并将 `--ui-dir` 指向 `web/dist-rust-debug`。

## 安全说明

该服务暴露了较强的本地能力（工作区范围文件读写、git 操作、终端拉起）。建议仅绑定 localhost；若必须对外暴露，请启用 `OPENCODE_STUDIO_UI_PASSWORD` 并置于可信反向代理之后。

威胁模型和漏洞上报流程见 `SECURITY.md`。
