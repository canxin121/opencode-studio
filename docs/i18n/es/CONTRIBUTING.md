# Contributing

[English](../../../CONTRIBUTING.md) | [简体中文](../zh-CN/CONTRIBUTING.md) | Español | [हिंदी](../hi-IN/CONTRIBUTING.md) | [العربية](../ar-SA/CONTRIBUTING.md) | [Português (Brasil)](../pt-BR/CONTRIBUTING.md) | [Français](../fr-FR/CONTRIBUTING.md)

Gracias por tu interes en mejorar OpenCode Studio.

## Desarrollo local

Requisitos:

- Rust toolchain (stable)
- Bun

Aplicacion web:

```bash
bun install --cwd web
bun run --cwd web test
bun run --cwd web build
```

Servidor Rust:

```bash
cargo test -q --manifest-path server/Cargo.toml
```

Actualizacion de version:

```bash
python3 scripts/version_sync.py set <version>
python3 scripts/version_sync.py check
```

## Pull requests

- Mantener PRs pequenos y enfocados; explica el por que del cambio.
- Incluye como verificaste el cambio (comandos + comportamiento esperado).
- La validacion local debe incluir `python3 scripts/version_sync.py check`.
