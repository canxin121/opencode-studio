# Contributing

[English](../../../CONTRIBUTING.md) | [简体中文](../zh-CN/CONTRIBUTING.md) | [Español](../es/CONTRIBUTING.md) | [हिंदी](../hi-IN/CONTRIBUTING.md) | العربية | [Português (Brasil)](../pt-BR/CONTRIBUTING.md) | [Français](../fr-FR/CONTRIBUTING.md)

شكرا لاهتمامك بالمساهمة في OpenCode Studio.

## التطوير المحلي

المتطلبات:

- Rust toolchain (stable)
- Bun

تطبيق الويب:

```bash
bun install --cwd web
bun run --cwd web test
bun run --cwd web build
```

خادم Rust:

```bash
cargo test -q --manifest-path server/Cargo.toml
```

تحديث الإصدار:

```bash
python3 scripts/version_sync.py set <version>
python3 scripts/version_sync.py check
```

## طلبات السحب

- اجعل PR صغيرا ومركزا، واشرح سبب التغيير.
- أضف طريقة التحقق (الأوامر + السلوك المتوقع).
- يجب أن تتضمن التحقق المحلي `python3 scripts/version_sync.py check`.
