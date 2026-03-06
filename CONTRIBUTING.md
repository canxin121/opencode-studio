# Contributing

English | [简体中文](docs/i18n/zh-CN/CONTRIBUTING.md) | [Español](docs/i18n/es/CONTRIBUTING.md) | [हिंदी](docs/i18n/hi-IN/CONTRIBUTING.md) | [العربية](docs/i18n/ar-SA/CONTRIBUTING.md) | [Português (Brasil)](docs/i18n/pt-BR/CONTRIBUTING.md) | [Français](docs/i18n/fr-FR/CONTRIBUTING.md)

Thanks for your interest in improving OpenCode Studio.

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

Version updates:

```bash
python3 scripts/version_sync.py set <version>
python3 scripts/version_sync.py check
```

## Pull requests

- Keep PRs small and focused; explain the why.
- Include how you verified the change (commands + expected behavior).
- Local verification must include `python3 scripts/version_sync.py check`.
