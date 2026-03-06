# Security

[English](../../../SECURITY.md) | [简体中文](../zh-CN/SECURITY.md) | [Español](../es/SECURITY.md) | [हिंदी](../hi-IN/SECURITY.md) | [العربية](../ar-SA/SECURITY.md) | Português (Brasil) | [Français](../fr-FR/SECURITY.md)

## Modelo de ameacas

O OpenCode Studio roda localmente e expoe capacidades poderosas via HTTP API e UI:

- Leitura/escrita no sistema de arquivos (limitada ao workspace selecionado)
- Operacoes de Git
- Sessoes de terminal (PTY)
- Acesso proxy/bridge para um servidor OpenCode

OpenCode Studio **nao** e sandbox.

Se voce precisa de isolamento, execute em VM/container e exponha apenas para clientes confiaveis.

## Execucao segura

- Prefira bind em localhost.
- Se precisar expor pela rede, habilite `OPENCODE_STUDIO_UI_PASSWORD` e coloque atras de um reverse proxy confiavel com TLS.

## Reporte de vulnerabilidades

Nao abra issue publica com detalhes de exploracao.

- Use o fluxo de GitHub Security Advisory deste repositorio (Security -> "Report a vulnerability"), se disponivel.
