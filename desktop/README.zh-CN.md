## Desktop packaging (Tauri)

[English](README.md) | 简体中文

该目录包含 OpenCode Studio 的 Tauri 桌面打包工程。

我们有意将其与仓库根目录下的 Rust workspace 分离，
这样只针对 server 的 CI lint/test 任务不需要编译 Tauri。

构建模式：

- `full`：打包桌面应用，并将 `opencode-studio` 服务端作为 sidecar 一起打包并自动启动。
- 在 `full` 模式下，Tauri 直接打开后端 URL；前端资源由打包的后端 sidecar 提供。

本地快速开始（需要 Rust、Bun 以及平台相关 Tauri 依赖）：

```bash
bun install --cwd web
bun run --cwd web build

# Full app（包含 backend sidecar；需要先构建并放置 sidecar）
# 完整本地构建步骤见 docs/packaging.md
```
