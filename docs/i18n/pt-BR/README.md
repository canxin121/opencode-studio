# OpenCode Studio

[English](../../../README.md) | [简体中文](../zh-CN/README.md) | [Español](../es/README.md) | [हिंदी](../hi-IN/README.md) | [العربية](../ar-SA/README.md) | Português (Brasil) | [Français](../fr-FR/README.md)

<p align="center">
  <img src="../../../web/public/apple-touch-icon-180x180.png" width="128" alt="Icone do OpenCode Studio" />
</p>

<p align="center">
  <strong>Workspace all-in-one para fluxos OpenCode com foco em produtividade.</strong><br />
  Chat, arquivos, terminal, Git e configuracoes em uma unica interface.<br />
  Pronto para uso local rapido e deploy confiavel em modo servico.
</p>

<p align="center">
  <a href="https://github.com/canxin121/opencode-studio/releases/latest">Baixar release</a>
  ·
  <a href="../../technical-reference.md">Documentacao tecnica</a>
  ·
  <a href="../../service.md">Instalacao de servico</a>
  ·
  <a href="../README.md">Indice de idiomas</a>
  ·
  <a href="https://github.com/canxin121/opencode-studio/issues">Reportar problema</a>
</p>

## Suporte de idiomas

O i18n do frontend e a documentacao principal suportam:

- `zh-CN`: Chines simplificado
- `en-US`: Ingles
- `es-ES`: Espanhol (Espanha)
- `hi-IN`: Hindi (India)
- `ar-SA`: Arabe (Arabia Saudita)
- `pt-BR`: Portugues (Brasil)
- `fr-FR`: Frances (Franca)

## Inicio rapido (2 minutos)

1. Instale o OpenCode CLI (escolha um metodo):

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

2. Verifique a instalacao:

```bash
opencode --version
```

3. Acesse no navegador:
- Instalacao com frontend: `http://127.0.0.1:3210`
- Instalacao somente API: `http://127.0.0.1:3210/health`

## Documentacao adicional

- [`docs/technical-reference.md`](../../technical-reference.md)
- [`docs/service.md`](../../service.md)
- [`docs/packaging.md`](../../packaging.md)
- [`desktop/README.md`](../../../desktop/README.md)
- [`SECURITY.md`](../../../SECURITY.md)
- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
- [`docs/i18n/README.md`](../README.md)

## Licenca

MIT. Veja [`LICENSE`](../../../LICENSE).
