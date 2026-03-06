# Security

[English](../../../SECURITY.md) | [简体中文](../zh-CN/SECURITY.md) | [Español](../es/SECURITY.md) | [हिंदी](../hi-IN/SECURITY.md) | العربية | [Português (Brasil)](../pt-BR/SECURITY.md) | [Français](../fr-FR/SECURITY.md)

## نموذج التهديد

يعمل OpenCode Studio محليا ويعرض قدرات قوية عبر HTTP API وواجهة المستخدم:

- قراءة/كتابة نظام الملفات (ضمن نطاق مساحة العمل المختارة)
- عمليات Git
- جلسات طرفية (PTY)
- وصول proxy/bridge إلى خادم OpenCode

OpenCode Studio **ليس** sandbox.

إذا كنت تحتاج إلى العزل، شغله داخل VM/حاوية ولا تعرضه إلا لعملاء موثوقين.

## التشغيل الآمن

- يفضل الربط على localhost.
- إذا كان لابد من التعرض عبر الشبكة، فعّل `OPENCODE_STUDIO_UI_PASSWORD` وضعه خلف reverse proxy موثوق مع TLS.

## الإبلاغ عن الثغرات

يرجى عدم فتح issue عام يتضمن تفاصيل الاستغلال.

- استخدم GitHub Security Advisory في هذا المستودع (Security -> "Report a vulnerability") عند توفره.
