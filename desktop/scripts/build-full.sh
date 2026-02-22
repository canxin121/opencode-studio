#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-}"

"$ROOT_DIR/scripts/build-frontend-dist.sh"

if [[ -n "$TARGET" ]]; then
  "$ROOT_DIR/desktop/scripts/prepare-sidecar.sh" "$TARGET"
else
  "$ROOT_DIR/desktop/scripts/prepare-sidecar.sh"
fi

cd "$ROOT_DIR/desktop/src-tauri"

if [[ -n "$TARGET" ]]; then
  cargo tauri build --config tauri.conf.full.json --target "$TARGET"
else
  cargo tauri build --config tauri.conf.full.json
fi
