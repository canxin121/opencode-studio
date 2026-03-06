# OpenCode Studio

[English](../../../README.md) | [简体中文](../zh-CN/README.md) | Español | [हिंदी](../hi-IN/README.md) | [العربية](../ar-SA/README.md) | [Português (Brasil)](../pt-BR/README.md) | [Français](../fr-FR/README.md)

<p align="center">
  <img src="../../../web/public/apple-touch-icon-180x180.png" width="128" alt="Icono de OpenCode Studio" />
</p>

<p align="center">
  <strong>Espacio de trabajo todo en uno para OpenCode, con enfoque en productividad.</strong><br />
  Chat, archivos, terminal, Git y ajustes en una sola interfaz.<br />
  Listo para uso local rapido y despliegue como servicio.
</p>

<p align="center">
  <a href="https://github.com/canxin121/opencode-studio/releases/latest">Descargar</a>
  ·
  <a href="../../technical-reference.md">Documentacion tecnica</a>
  ·
  <a href="../../service.md">Instalacion de servicio</a>
  ·
  <a href="../README.md">Indice de idiomas</a>
  ·
  <a href="https://github.com/canxin121/opencode-studio/issues">Reportar problema</a>
</p>

> Nota: Este es un proyecto de la comunidad. No esta creado por el equipo de OpenCode ni afiliado oficialmente. Proyecto upstream: [anomalyco/opencode](https://github.com/anomalyco/opencode)

## Soporte de idiomas

El frontend i18n y la documentacion principal de OpenCode Studio soportan:

- `zh-CN`: Chino simplificado
- `en-US`: Ingles
- `es-ES`: Espanol (Espana)
- `hi-IN`: Hindi (India)
- `ar-SA`: Arabe (Arabia Saudita)
- `pt-BR`: Portugues (Brasil)
- `fr-FR`: Frances (Francia)

Consulta la matriz y enlaces cruzados en [`docs/i18n/README.md`](../README.md).

## Contenido

- [Soporte de idiomas](#soporte-de-idiomas)
- [Resumen](#resumen)
- [Vista de interfaz](#vista-de-interfaz)
- [Inicio rapido (2 minutos)](#inicio-rapido-2-minutos)
- [Instalacion](#instalacion)
- [Despues de instalar](#despues-de-instalar)
- [Documentacion adicional](#documentacion-adicional)
- [Licencia](#licencia)

## Resumen

- Flujo unificado: chat, archivos, terminal y Git dentro del mismo workspace.
- Puente de eventos de OpenCode con actualizaciones en tiempo real y reanudacion de sesion.
- Ruta de alto rendimiento con poda de payloads para sesiones largas.
- Acceso con paginacion (`offset`/`limit`) para reducir la carga inicial.
- Sistema de UI para plugins: descubre `opencode.json`, carga `studio.manifest.json` y expone acciones en la interfaz.
- Dos modos de uso: instalacion de escritorio o instalacion como servicio gestionado.

## Vista de interfaz

<p align="center">
  <a href="../../../assets/studio-chat.png"><img src="../../../assets/studio-chat.png" width="300" alt="Vista de chat" /></a>
  <a href="../../../assets/studio-files.png"><img src="../../../assets/studio-files.png" width="300" alt="Explorador y editor de archivos" /></a>
  <a href="../../../assets/studio-terminal.png"><img src="../../../assets/studio-terminal.png" width="300" alt="Terminal integrada" /></a>
</p>
<p align="center">
  <a href="../../../assets/studio-git.png"><img src="../../../assets/studio-git.png" width="300" alt="Estado y diff de Git" /></a>
  <a href="../../../assets/studio-settings.png"><img src="../../../assets/studio-settings.png" width="300" alt="Configuracion" /></a>
</p>

## Inicio rapido (2 minutos)

1. Instala OpenCode CLI (elige un metodo):

```bash
# macOS / Linux (script oficial)
curl -fsSL https://opencode.ai/install | bash

# macOS / Linux (Homebrew)
brew install anomalyco/tap/opencode
```

```powershell
# Windows (Scoop)
scoop install opencode

# Windows (Chocolatey)
choco install opencode

# Cualquier plataforma con Bun
bun add -g opencode-ai@latest
```

2. Verifica instalacion:

```bash
opencode --version
```

3. Elige ruta de instalacion:

| Escenario | Ruta recomendada | Resultado |
| --- | --- | --- |
| Uso local en escritorio | Instalacion por paquete | App nativa con backend integrado |
| Host siempre encendido | Instalacion como servicio | Servicio gestionado por `systemd`, `launchd` o SCM de Windows |

## Instalacion

### Opcion 1: instalacion por paquete (Desktop App)

1. Abre [GitHub Releases](https://github.com/canxin121/opencode-studio/releases/latest)
2. Descarga el paquete de tu plataforma:
   - Windows: `.msi` / `.exe`
   - macOS: `.dmg`
   - Linux: `.AppImage` / `.deb` / `.rpm`
3. Instala y abre la app; el backend integrado inicia automaticamente.

### Opcion 2: instalacion como servicio

Consulta la guia completa en [`docs/service.md`](../../service.md).

Instalacion rapida en Unix:

```bash
# Con UI integrada
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend

# Solo API
curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash
```

## Despues de instalar

- Direccion por defecto: `http://127.0.0.1:3210`
- Si instalas con frontend, abre `http://127.0.0.1:3210`
- Si instalas solo API, verifica `http://127.0.0.1:3210/health`
- Para acceso remoto, cambia `host` a `0.0.0.0` y reinicia el servicio

## Documentacion adicional

- [`docs/technical-reference.md`](../../technical-reference.md)
- [`docs/service.md`](../../service.md)
- [`docs/packaging.md`](../../packaging.md)
- [`desktop/README.md`](../../../desktop/README.md)
- [`docs/backend-accel-parity-review.md`](../../backend-accel-parity-review.md)
- [`SECURITY.md`](../../../SECURITY.md)
- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
- [`docs/i18n/README.md`](../README.md)

## Licencia

MIT. Ver [`LICENSE`](../../../LICENSE).
