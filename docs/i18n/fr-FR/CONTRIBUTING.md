# Contributing

[English](../../../CONTRIBUTING.md) | [简体中文](../zh-CN/CONTRIBUTING.md) | [Español](../es/CONTRIBUTING.md) | [हिंदी](../hi-IN/CONTRIBUTING.md) | [العربية](../ar-SA/CONTRIBUTING.md) | [Português (Brasil)](../pt-BR/CONTRIBUTING.md) | Français

Merci pour votre interet a contribuer a OpenCode Studio.

## Developpement local

Prerequis:

- Rust toolchain (stable)
- Bun

Application web:

```bash
bun install --cwd web
bun run --cwd web test
bun run --cwd web build
```

Serveur Rust:

```bash
cargo test -q --manifest-path server/Cargo.toml
```

Mise a jour de version:

```bash
python3 scripts/version_sync.py set <version>
python3 scripts/version_sync.py check
```

## Pull requests

- Gardez des PRs petites et ciblees; expliquez le pourquoi.
- Indiquez comment vous avez verifie le changement (commandes + comportement attendu).
- La verification locale doit inclure `python3 scripts/version_sync.py check`.
