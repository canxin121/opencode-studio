# OpenCode Studio

[English](README.md) | 简体中文

OpenCode Studio 是一个面向 OpenCode 的本地优先 Web UI。它运行一个 Rust (Axum) 服务端：负责托管构建后的 Vue 前端资源，并将请求桥接/代理到 OpenCode 服务（`opencode serve`）。

> 说明：本项目为社区实现，非 OpenCode 团队官方项目，与其不存在官方隶属关系。OpenCode 上游项目：https://github.com/anomalyco/opencode

<p align="center">
  <img src="web/public/apple-touch-icon-180x180.png" width="128" alt="OpenCode Studio 桌面版图标" />
</p>

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

## 你会得到什么

- 事件流代理与过滤控制（心跳、`Last-Event-ID` 恢复、可配置 activity/tool 过滤、payload 精简）
- 聊天界面与会话侧边栏（session/message 列表支持 `offset`/`limit` 分页）
- 文件浏览 + 搜索/替换（目录列表支持 `offset`/`limit` 分页；可选遵循 `.gitignore`；范围限制在工作区内）
- Git UI 能力（status/diff/分支/worktree 等）
- 内置终端会话（PTY；若系统可用则可选 tmux 后端）
- 设置页：编辑 OpenCode 多层配置 + Studio 本地设置
- Studio 侧插件运行时（从 `opencode.json` 发现插件、加载 `studio.manifest.json`、调用 action、事件流订阅）

## 技术栈

- 后端：Rust 2024、Axum、Tokio、tower-http
- 前端：Vue 3 + TypeScript、Vite、Tailwind CSS 4、Pinia、Monaco Editor、xterm.js、PWA（Service Worker）

## 目录结构

- `server/`：Rust 后端（HTTP API + OpenCode bridge + 静态资源托管）
- `web/`：Vue 前端（构建产物输出到 `web/dist`）

## 运行前准备

- Rust 工具链（stable）
- Bun（推荐，CI 使用 Bun）与 Node.js（CI 使用 Node 20+）
- OpenCode 服务满足其一：
  - `opencode` 可在 `PATH` 中找到（Studio 可自动拉起 `opencode serve`），或
  - 你已经单独运行了 OpenCode 服务，并能提供 host/port

## 快速开始（本地运行）

1) 安装 Web 依赖

```bash
bun install --cwd web
```

2) 构建前端资源

```bash
bun run --cwd web build
```

3) 运行 Studio 服务端（托管 UI + `/api/*`）

```bash
cargo run -p opencode-studio -- \
  --ui-dir web/dist
```

浏览器打开 `http://127.0.0.1:3000`。

说明：

- CI 使用冻结安装（`bun install --cwd web --frozen-lockfile`）。如果 Bun 提示 lockfile 会发生变化，请先不带 `--frozen-lockfile` 重新安装以更新 `web/bun.lock`。
- `--ui-dir`（或 `OPENCODE_STUDIO_UI_DIR`）是必填项，需要指向包含 `index.html` 的 Vite `dist/` 目录。
- 启动时 Studio 会确保 OpenCode 可用；若未提供 `--opencode-port` / `OPENCODE_PORT`，会尝试自动拉起 `opencode serve`。

## 连接到已运行的 OpenCode 服务

如果你单独运行 OpenCode，可通过 port（可选 host）连接：

```bash
cargo run -p opencode-studio -- \
  --opencode-port 16000 \
  --opencode-host 127.0.0.1 \
  --ui-dir web/dist
```

对应的环境变量：

- `OPENCODE_PORT=16000`
- `OPENCODE_HOST=127.0.0.1`

## 配置

### CLI 参数 / 环境变量

服务端基础配置：

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCODE_STUDIO_HOST` / `--host` | `127.0.0.1` | 监听地址 |
| `OPENCODE_STUDIO_PORT` / `--port` | `3000` | 监听端口 |
| `OPENCODE_STUDIO_UI_DIR` / `--ui-dir` |（必填）| 前端构建目录（Vite `dist/`）|

OpenCode 连接配置：

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCODE_PORT` / `--opencode-port` |（未设置）| 指定后，Studio 连接到该 OpenCode 实例 |
| `OPENCODE_HOST` / `--opencode-host` | `127.0.0.1` | 与 `OPENCODE_PORT` 搭配使用 |
| `OPENCODE_STUDIO_SKIP_OPENCODE_START` / `--skip-opencode-start` | `false` | 不自动拉起 `opencode serve` |
| `OPENCODE_STUDIO_OPENCODE_LOG_LEVEL` / `--opencode-log-level` |（未设置）| 传递给托管的 `opencode serve` 的日志级别 |
| `OPENCODE_STUDIO_OPENCODE_LOGS` |（未设置）| 设为 `true/1/yes/on` 时转发托管 OpenCode 的 stdout/stderr |

UI 登录（可选）：

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCODE_STUDIO_UI_PASSWORD` / `--ui-password` |（关闭）| 启用基于 Cookie 的 UI 登录 |

Studio 数据目录：

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCODE_STUDIO_DATA_DIR` | `~/.config/opencode-studio` | 存放 `settings.json`、终端会话注册表等 |

高级配置（节选）：

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCODE_CONFIG` |（未设置）| 自定义 OpenCode 配置文件路径（作为额外配置层） |
| `OPENCODE_STUDIO_GIT_TIMEOUT_MS` | `60000` | Git 操作超时时间 |
| `OPENCODE_STUDIO_TERMINAL_IDLE_TIMEOUT_SECS` |（未设置）| 设置为正整数时，自动清理空闲终端 |

### 配置文件

- Studio 设置（项目列表、部分 UI 相关配置）：`~/.config/opencode-studio/settings.json`（可用 `OPENCODE_STUDIO_DATA_DIR` 修改基目录）。
- OpenCode 多层配置（可在 Studio 设置页读取/编辑）：
  - 用户层：`~/.config/opencode/opencode.json`
  - 项目层：`opencode.json` / `opencode.jsonc`（或 `.opencode/` 目录下）
  - 自定义层：`OPENCODE_CONFIG`（可选）

## 开发相关命令

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

提示：想获得更好的调试体验，可用 `build:rust-debug` 构建 UI，并把服务端的 `--ui-dir` 指向 `web/dist-rust-debug`。

## 安全提示

本服务提供了较强的本地能力（在工作区范围内读写文件、执行 git 操作、启动终端等）。推荐仅在 localhost 使用；如必须对外提供访问，请启用 `OPENCODE_STUDIO_UI_PASSWORD` 并放在可信的反向代理之后。

更完整的威胁模型与上报建议见 `SECURITY.md`。

## 参与贡献

提交 PR 前请先阅读 `CONTRIBUTING.md`。

## License

本项目采用 MIT License，详见 `LICENSE`。
