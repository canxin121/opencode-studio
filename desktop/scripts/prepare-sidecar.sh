#!/usr/bin/env bash
set -euo pipefail

# Build the Rust backend and place it where Tauri expects sidecars:
#   desktop/src-tauri/binaries/opencode-studio-$TARGET_TRIPLE[.exe]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_MANIFEST="$ROOT_DIR/server/Cargo.toml"
TAURI_BIN_DIR="$ROOT_DIR/desktop/src-tauri/binaries"

TARGET_TRIPLE="${1:-}"
if [[ -z "$TARGET_TRIPLE" ]]; then
  if rustc --print host-tuple >/dev/null 2>&1; then
    TARGET_TRIPLE="$(rustc --print host-tuple)"
  else
    TARGET_TRIPLE="$(rustc -Vv | awk '/^host:/{print $2; exit}')"
  fi
fi

EXT=""
case "${TARGET_TRIPLE}" in
  *-pc-windows-*) EXT=".exe";;
esac

echo "Building server sidecar for ${TARGET_TRIPLE}..."
cargo build --manifest-path "$SERVER_MANIFEST" --release --target "$TARGET_TRIPLE" --locked

SRC_BIN="$ROOT_DIR/server/target/$TARGET_TRIPLE/release/opencode-studio$EXT"
if [[ ! -f "$SRC_BIN" ]]; then
  echo "ERROR: built binary not found at: $SRC_BIN" >&2
  exit 1
fi

mkdir -p "$TAURI_BIN_DIR"
DEST_BIN="$TAURI_BIN_DIR/opencode-studio-$TARGET_TRIPLE$EXT"
cp "$SRC_BIN" "$DEST_BIN"

echo "Sidecar ready: $DEST_BIN"
