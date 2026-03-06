# Contributing

[English](../../../CONTRIBUTING.md) | [简体中文](../zh-CN/CONTRIBUTING.md) | [Español](../es/CONTRIBUTING.md) | [हिंदी](../hi-IN/CONTRIBUTING.md) | [العربية](../ar-SA/CONTRIBUTING.md) | Português (Brasil) | [Français](../fr-FR/CONTRIBUTING.md)

Obrigado pelo interesse em contribuir com o OpenCode Studio.

## Desenvolvimento local

Requisitos:

- Rust toolchain (stable)
- Bun

Aplicacao web:

```bash
bun install --cwd web
bun run --cwd web test
bun run --cwd web build
```

Servidor Rust:

```bash
cargo test -q --manifest-path server/Cargo.toml
```

Atualizacao de versao:

```bash
python3 scripts/version_sync.py set <version>
python3 scripts/version_sync.py check
```

## Pull requests

- Mantenha PRs pequenos e focados; explique o motivo da mudanca.
- Inclua como voce validou a mudanca (comandos + comportamento esperado).
- A validacao local deve incluir `python3 scripts/version_sync.py check`.
