# OpenCode Studio

[English](../../../README.md) | [简体中文](../zh-CN/README.md) | [Español](../es/README.md) | [हिंदी](../hi-IN/README.md) | العربية | [Português (Brasil)](../pt-BR/README.md) | [Français](../fr-FR/README.md)

<p align="center">
  <img src="../../../web/public/apple-touch-icon-180x180.png" width="128" alt="OpenCode Studio icon" />
</p>

<p align="center">
  <strong>مساحة عمل متكاملة ومركزة لتدفقات OpenCode.</strong><br />
  دردشة وملفات وطرفية وGit وإعدادات في واجهة واحدة.<br />
  مناسبة للاستخدام المحلي السريع والنشر كخدمة بشكل موثوق.
</p>

<p align="center">
  <a href="https://github.com/canxin121/opencode-studio/releases/latest">تنزيل الإصدار</a>
  ·
  <a href="../../technical-reference.md">المرجع التقني</a>
  ·
  <a href="../../service.md">تثبيت الخدمة</a>
  ·
  <a href="../README.md">فهرس اللغات</a>
  ·
  <a href="https://github.com/canxin121/opencode-studio/issues">الإبلاغ عن مشكلة</a>
</p>

## دعم اللغات

يدعم i18n في الواجهة الأمامية والوثائق الرئيسية اللغات التالية:

- `zh-CN`: الصينية المبسطة
- `en-US`: الإنجليزية
- `es-ES`: الإسبانية (إسبانيا)
- `hi-IN`: الهندية (الهند)
- `ar-SA`: العربية (السعودية)
- `pt-BR`: البرتغالية (البرازيل)
- `fr-FR`: الفرنسية (فرنسا)

## البدء السريع (دقيقتان)

1. ثبّت OpenCode CLI (اختر طريقة واحدة):

```bash
# macOS / Linux (official install script)
curl -fsSL https://opencode.ai/install | bash

# macOS / Linux (Homebrew)
brew install anomalyco/tap/opencode
```

```powershell
# Windows (Scoop)
scoop install opencode

# Windows (Chocolatey)
choco install opencode

# Any platform with Bun
bun add -g opencode-ai@latest
```

2. التحقق من التثبيت:

```bash
opencode --version
```

3. الوصول عبر المتصفح:
- تثبيت مع الواجهة: `http://127.0.0.1:3210`
- تثبيت API فقط: `http://127.0.0.1:3210/health`

## وثائق إضافية

- [`docs/technical-reference.md`](../../technical-reference.md)
- [`docs/service.md`](../../service.md)
- [`docs/packaging.md`](../../packaging.md)
- [`desktop/README.md`](../../../desktop/README.md)
- [`SECURITY.md`](../../../SECURITY.md)
- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
- [`docs/i18n/README.md`](../README.md)

## الترخيص

MIT. راجع [`LICENSE`](../../../LICENSE).
