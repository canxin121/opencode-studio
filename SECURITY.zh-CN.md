# Security

[English](SECURITY.md) | 简体中文

## 威胁模型

OpenCode Studio 在本地运行，并通过 HTTP API 和 UI 暴露较强能力：

- 文件系统读写（限定在所选工作区目录内）
- Git 操作
- 终端会话（PTY）
- 代理/桥接到 OpenCode 服务

OpenCode Studio **不是** 沙箱。

如果你需要隔离，请在 VM/容器中运行，并仅向可信客户端开放访问。

## 安全运行建议

- 优先绑定到 localhost。
- 若必须通过网络暴露 Studio，请启用 `OPENCODE_STUDIO_UI_PASSWORD`，并放在可信的 TLS 反向代理后面。

## 安全问题上报

请不要在公开 issue 中披露可利用细节。

- 优先使用本仓库的 GitHub Security Advisory 流程（Security -> "Report a vulnerability"，如可用）。
