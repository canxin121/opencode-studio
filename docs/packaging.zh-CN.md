# Packaging

[English](packaging.md) | 简体中文

本仓库从同一套代码产出多种交付物。

仓库结构：

- `web/`：Vue 应用（Vite）-> `web/dist`
- `server/`：Rust Axum 服务端二进制（`opencode-studio`）
- `desktop/`：Tauri 桌面打包（完整应用）

## 产物类型

1) `frontend-dist`

- 内容：构建后的 Web UI 输出（`web/dist`）。
- 用途：放到 nginx/CDN，或由 Rust 服务端（`--ui-dir`）托管。
- 产出命令：`bun run --cwd web build`。

2) `backend-bin`

- 内容：仅 Rust 服务端二进制（`opencode-studio`）。
- 用途：在机器上以服务方式运行；可选通过 `--ui-dir` 托管 UI。
- 产出命令：`cargo build --manifest-path server/Cargo.toml --release`。

3) `full-app`（桌面）

- 内容：单个桌面安装包/应用包，包含：
  - 前端 UI
  - 作为 Tauri sidecar 打包的 Rust 服务端（`opencode-studio`）
  - 托盘图标 + 关闭到托盘行为
- 行为：
  - 启动应用时自动拉起后端 sidecar。
  - 关闭窗口仅隐藏，后端继续在托盘运行。
  - 托盘菜单可 start/stop/restart 后端，打开日志/配置，退出应用。
- 构建配置：`desktop/src-tauri/tauri.conf.full.json`。

## 本地构建

### 构建 `frontend-dist`

```bash
bun install --cwd web
bun run --cwd web build
```

输出：`web/dist`

### 构建 `backend-bin`

```bash
cargo build --manifest-path server/Cargo.toml --release --locked --target-dir server/target
```

输出：

- Linux/macOS：`server/target/release/opencode-studio`
- Windows：`server/target/release/opencode-studio.exe`

### 构建 `full-app`

完整应用会将 Rust 服务端作为 Tauri sidecar 打包。

```bash
./scripts/build-frontend-dist.sh

# 构建并复制后端到 desktop/src-tauri/binaries/
./desktop/scripts/prepare-sidecar.sh

cd desktop/src-tauri
cargo tauri build --config tauri.conf.full.json
```

说明：

- sidecar 文件名必须带 `-$TARGET_TRIPLE` 后缀（Tauri 要求）。
- 在 `full-app` 模式下，Tauri 直接打开后端 URL，前端资源由打包的后端 sidecar（`--ui-dir`）托管。
- 后端 API 默认端口是 `3000`；如果端口被占用，请修改 `opencode-studio.toml`。

### 使用 CEF 运行时构建桌面版（`-cef`）

本仓库包含一个实验性桌面变体，使用 Tauri 的 CEF 运行时。
其目录为 `desktop/src-tauri-cef/`，构建时需要启用 `cef` cargo feature。

前置依赖：

- 安装 CEF 版本的 Tauri CLI：

```bash
cargo install tauri-cli --locked --git https://github.com/tauri-apps/tauri --branch feat/cef
```

构建（full / 内置后端）：

```bash
./desktop/scripts/build-full-cef.sh
```

## 运行配置（桌面）

桌面应用首次启动时会写入用户可编辑配置：

- macOS：`~/Library/Application Support/<...>/opencode-studio.toml`（具体路径与平台细节有关）
- Linux：`~/.config/<...>/opencode-studio.toml`
- Windows：`%APPDATA%\\<...>\\opencode-studio.toml`

托盘菜单中提供了直接打开该文件的入口。

## CI 输出

相关工作流主要有两个：

- `CI`（`.github/workflows/ci.yml`）：对 `web/` 与 `server/` 执行 lint/test。
- `Package`（`.github/workflows/package.yml`）：手动触发（workflow_dispatch），为当前 ref 构建产物。桌面安装包会构建两套：
  - main（系统 WebView）
  - CEF 运行时（后缀 `-cef`，基于 Tauri `feat/cef` 分支）

`Package` 使用的架构矩阵：

- Linux：`x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu`
- Windows：`x86_64-pc-windows-msvc`
- macOS：`aarch64-apple-darwin`、`x86_64-apple-darwin`

`Package` 产物命名策略：

- 后端归档：`opencode-studio-<target>.tar.gz`（Unix）/ `opencode-studio-<target>.zip`（Windows）
- 桌面安装包：`opencode-studio-desktop-<target><suffix>.<ext>`
- 上传到 Actions 的 artifact 名称始终包含 `<target>`，可直接区分架构。

移动端场景：使用托管的 Web UI（`web/dist`）。

Release 场景：

- `Release`（`.github/workflows/release.yml`）：在 tag `v*` 时创建 GitHub Release，并附加：
  - web dist 压缩包
  - macOS/Windows/Linux 后端归档
  - 桌面安装包（full）原生产物（可用时）：
    - Windows：`.msi`（以及/或 `.exe`）
    - macOS：`.dmg`
    - Linux：`.AppImage` + `.deb` + `.rpm`
    同时附加 CEF 运行时版本（后缀 `-cef`）

`Release` 使用的架构矩阵：

- Linux：`x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu`
- Windows：`x86_64-pc-windows-msvc`
- macOS：`aarch64-apple-darwin`、`x86_64-apple-darwin`

`Release` 资产命名策略：

- 后端归档（服务端版本产物）：
  - `opencode-studio-backend-<target>-<tag>.tar.gz`（Unix）
  - `opencode-studio-backend-<target>-<tag>.zip`（Windows）
  - 元数据：`opencode-studio-backend-<target>-<tag>.json`
- 桌面安装包（安装包版本产物）：
  - `opencode-studio-desktop-<target><suffix>-<tag>.<ext>`

target/runner 守护：

- 打包和发布工作流会在构建前执行 `python scripts/assert_native_target.py <target>`，
  即使本机无法完整跨编译，也能在 CI 中尽早发现矩阵与目标三元组不匹配的问题。

服务安装脚本不会作为 release 资产发布，请直接使用 GitHub raw 链接，例如：

- `https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh`
- `https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.ps1`

## 未签名构建

本项目构建不要求 Apple/Windows 签名密钥。Release 资产默认是未签名状态：

- macOS：用户可能看到 Gatekeeper 的未签名告警。
- Windows：SmartScreen 可能对未签名安装包/二进制给出提示。
