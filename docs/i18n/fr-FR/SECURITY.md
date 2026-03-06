# Security

[English](../../../SECURITY.md) | [简体中文](../zh-CN/SECURITY.md) | [Español](../es/SECURITY.md) | [हिंदी](../hi-IN/SECURITY.md) | [العربية](../ar-SA/SECURITY.md) | [Português (Brasil)](../pt-BR/SECURITY.md) | Français

## Modele de menace

OpenCode Studio s'execute localement et expose des capacites puissantes via HTTP API et UI:

- Lecture/ecriture du systeme de fichiers (limite au workspace selectionne)
- Operations Git
- Sessions terminal (PTY)
- Acces proxy/bridge vers un serveur OpenCode

OpenCode Studio n'est **pas** un sandbox.

Si vous avez besoin d'isolation, executez-le dans une VM/conteneur et exposez-le uniquement a des clients de confiance.

## Execution securisee

- Preferer un bind sur localhost.
- Si l'exposition reseau est necessaire, activez `OPENCODE_STUDIO_UI_PASSWORD` et placez-le derriere un reverse proxy TLS de confiance.

## Signalement de vulnerabilites

N'ouvrez pas d'issue publique avec des details d'exploitation.

- Utilisez le flux GitHub Security Advisory de ce depot (Security -> "Report a vulnerability") si disponible.
