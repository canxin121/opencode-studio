# Contributing

English | [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for your interest in improving OpenCode Studio.

## Local development

Requirements:

- Rust toolchain (stable)
- Bun
- Node.js (CI uses Node 20+)

Web app:

```bash
bun install --cwd web
bun run --cwd web test
bun run --cwd web build
```

Rust server:

```bash
cargo test -q --manifest-path server/Cargo.toml
```

## Pull requests

- Keep PRs small and focused; explain the why.
- Include how you verified the change (commands + expected behavior).
