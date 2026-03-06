# Security

[English](../../../SECURITY.md) | [简体中文](../zh-CN/SECURITY.md) | Español | [हिंदी](../hi-IN/SECURITY.md) | [العربية](../ar-SA/SECURITY.md) | [Português (Brasil)](../pt-BR/SECURITY.md) | [Français](../fr-FR/SECURITY.md)

## Modelo de amenazas

OpenCode Studio se ejecuta localmente y expone capacidades potentes por HTTP API y UI:

- Lectura/escritura de archivos (limitada al workspace seleccionado)
- Operaciones de Git
- Sesiones de terminal (PTY)
- Acceso de proxy/bridge hacia un servidor OpenCode

OpenCode Studio **no** es un sandbox.

Si necesitas aislamiento, ejecutalo en una VM/contenedor y exponlo solo a clientes de confianza.

## Ejecucion segura

- Recomendado: bind en localhost.
- Si debes exponer Studio por red, habilita `OPENCODE_STUDIO_UI_PASSWORD` y coloca un reverse proxy confiable con TLS.

## Reporte de vulnerabilidades

No abras un issue publico con detalles de explotacion.

- Usa el flujo de GitHub Security Advisory de este repositorio (Security -> "Report a vulnerability"), si esta disponible.
