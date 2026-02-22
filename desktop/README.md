## Desktop packaging (Tauri)

This folder contains the Tauri-based desktop packaging for OpenCode Studio.

We intentionally keep it separate from the Rust workspace at the repo root so
CI tasks that only lint/test the server do not need to compile Tauri.

Build modes:

- `frontend-only`: packages only the web UI (no bundled backend sidecar).
- `full`: packages the desktop app plus the `opencode-studio` server as a
  bundled sidecar and starts it automatically.

Local quickstart (requires Rust, Bun, and platform-specific Tauri deps):

```bash
bun install --cwd web
bun run --cwd web build

# Frontend-only app (no backend sidecar)
cargo tauri build --config src-tauri/tauri.conf.frontend.json

# Full app (includes backend sidecar; requires building + placing the sidecar first)
# See docs/packaging.md for the full local build steps.
```
