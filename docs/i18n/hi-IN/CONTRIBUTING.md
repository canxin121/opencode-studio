# Contributing

[English](../../../CONTRIBUTING.md) | [简体中文](../zh-CN/CONTRIBUTING.md) | [Español](../es/CONTRIBUTING.md) | हिंदी | [العربية](../ar-SA/CONTRIBUTING.md) | [Português (Brasil)](../pt-BR/CONTRIBUTING.md) | [Français](../fr-FR/CONTRIBUTING.md)

OpenCode Studio ko better banane me interest ke liye dhanyavad.

## Local development

Requirements:

- Rust toolchain (stable)
- Bun

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

Version update:

```bash
python3 scripts/version_sync.py set <version>
python3 scripts/version_sync.py check
```

## Pull requests

- PR chhota aur focused rakhen; badlav ka reason batayen.
- Verification details dein (commands + expected behavior).
- Local validation me `python3 scripts/version_sync.py check` shamil hona chahiye.
