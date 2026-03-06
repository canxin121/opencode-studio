# Security

[English](../../../SECURITY.md) | [简体中文](../zh-CN/SECURITY.md) | [Español](../es/SECURITY.md) | हिंदी | [العربية](../ar-SA/SECURITY.md) | [Português (Brasil)](../pt-BR/SECURITY.md) | [Français](../fr-FR/SECURITY.md)

## Threat model

OpenCode Studio local run hota hai aur HTTP API/UI ke zariye powerful capabilities deta hai:

- Filesystem read/write (selected workspace ke scope me)
- Git operations
- Terminal sessions (PTY)
- OpenCode server ke liye proxy/bridge access

OpenCode Studio **sandbox nahi hai**.

Agar isolation chahiye to VM/container me run karein aur sirf trusted clients ko expose karein.

## Safe run guidelines

- Prefer localhost bind.
- Agar network par expose karna zaruri ho, to `OPENCODE_STUDIO_UI_PASSWORD` enable karein aur trusted TLS reverse proxy ke piche rakhein.

## Vulnerability reporting

Exploit details ke saath public issue na kholen.

- Repository ke GitHub Security Advisory flow ka use karein (Security -> "Report a vulnerability"), agar available ho.
