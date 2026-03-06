# OpenCode Studio

[English](../../../README.md) | [简体中文](../zh-CN/README.md) | [Español](../es/README.md) | [हिंदी](../hi-IN/README.md) | [العربية](../ar-SA/README.md) | [Português (Brasil)](../pt-BR/README.md) | Français

<p align="center">
  <img src="../../../web/public/apple-touch-icon-180x180.png" width="128" alt="Icone OpenCode Studio" />
</p>

<p align="center">
  <strong>Espace de travail tout-en-un pour des workflows OpenCode efficaces.</strong><br />
  Chat, fichiers, terminal, Git et parametres dans une interface unique.<br />
  Concu pour un usage local rapide et un deploiement service fiable.
</p>

<p align="center">
  <a href="https://github.com/canxin121/opencode-studio/releases/latest">Telecharger la release</a>
  ·
  <a href="../../technical-reference.md">Documentation technique</a>
  ·
  <a href="../../service.md">Installation du service</a>
  ·
  <a href="../README.md">Index des langues</a>
  ·
  <a href="https://github.com/canxin121/opencode-studio/issues">Signaler un probleme</a>
</p>

## Prise en charge des langues

Le frontend i18n et la documentation principale prennent en charge:

- `zh-CN`: chinois simplifie
- `en-US`: anglais
- `es-ES`: espagnol (Espagne)
- `hi-IN`: hindi (Inde)
- `ar-SA`: arabe (Arabie saoudite)
- `pt-BR`: portugais (Bresil)
- `fr-FR`: francais (France)

## Demarrage rapide (2 minutes)

1. Installez OpenCode CLI (choisissez une methode):

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

2. Verifiez l'installation:

```bash
opencode --version
```

3. Ouvrez dans le navigateur:
- Installation avec frontend: `http://127.0.0.1:3210`
- Installation API uniquement: `http://127.0.0.1:3210/health`

## Documentation supplementaire

- [`docs/technical-reference.md`](../../technical-reference.md)
- [`docs/service.md`](../../service.md)
- [`docs/packaging.md`](../../packaging.md)
- [`desktop/README.md`](../../../desktop/README.md)
- [`SECURITY.md`](../../../SECURITY.md)
- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
- [`docs/i18n/README.md`](../README.md)

## Licence

MIT. Voir [`LICENSE`](../../../LICENSE).
