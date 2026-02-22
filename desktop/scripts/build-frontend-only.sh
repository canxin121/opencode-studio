#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-}"

"$ROOT_DIR/scripts/build-frontend-dist.sh"

cd "$ROOT_DIR/desktop/src-tauri"

if [[ -n "$TARGET" ]]; then
  cargo tauri build --config tauri.conf.frontend.json --target "$TARGET"
else
  cargo tauri build --config tauri.conf.frontend.json
fi
