## Desktop packaging (Tauri)

English | [简体中文](README.zh-CN.md)

This folder contains the Tauri-based desktop packaging for OpenCode Studio.

We intentionally keep it separate from the Rust workspace at the repo root so
CI tasks that only lint/test the server do not need to compile Tauri.

Build mode:

- `full`: packages the desktop app plus the `opencode-studio` server as a
  bundled sidecar and starts it automatically.
- In `full`, Tauri opens the backend URL directly; frontend assets are served
  by the bundled backend sidecar.

Local quickstart (requires Rust, Bun, and platform-specific Tauri deps):

```bash
bun install --cwd web
bun run --cwd web build

# Full app (includes backend sidecar; requires building + placing the sidecar first)
# See docs/packaging.md for the full local build steps.
```
