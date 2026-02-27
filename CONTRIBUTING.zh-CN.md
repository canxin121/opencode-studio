# Contributing

[English](CONTRIBUTING.md) | 简体中文

感谢你对 OpenCode Studio 的关注与贡献。

## 本地开发

环境要求：

- Rust 工具链（stable）
- Bun
- Node.js（CI 使用 Node 20+）

Web 应用：

```bash
bun install --cwd web
bun run --cwd web test
bun run --cwd web build
```

Rust 服务端：

```bash
cargo test -q --manifest-path server/Cargo.toml
```

## Pull Request

- 尽量保持 PR 小而聚焦，并说明为什么这么改。
- 请附上你的验证方式（命令 + 预期行为）。
