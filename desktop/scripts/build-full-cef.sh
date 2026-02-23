#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-}"

if ! command -v cargo-tauri >/dev/null 2>&1; then
  echo "ERROR: cargo-tauri is not installed." >&2
  echo "Install (CEF): cargo install tauri-cli --locked --git https://github.com/tauri-apps/tauri --branch feat/cef" >&2
  exit 1
fi

if [[ "$(uname -s)" == "Linux" ]]; then
  if ! command -v pkg-config >/dev/null 2>&1; then
    echo "ERROR: pkg-config is required to build on Linux." >&2
    echo "On Debian/Ubuntu: sudo apt install -y pkg-config" >&2
    exit 1
  fi

  if ! pkg-config --exists gtk+-3.0 2>/dev/null; then
    echo "ERROR: GTK3 development packages are missing (pkg-config: gtk+-3.0)." >&2
    echo "On Debian/Ubuntu: sudo apt install -y libgtk-3-dev" >&2
    exit 1
  fi

  if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null && ! pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
    echo "ERROR: WebKitGTK development packages are missing (pkg-config: webkit2gtk-4.1 or webkit2gtk-4.0)." >&2
    echo "On Debian/Ubuntu: sudo apt install -y libwebkit2gtk-4.1-dev" >&2
    exit 1
  fi
fi

"$ROOT_DIR/scripts/build-frontend-dist.sh"

if [[ -n "$TARGET" ]]; then
  "$ROOT_DIR/desktop/scripts/prepare-sidecar.sh" --cef "$TARGET"
else
  "$ROOT_DIR/desktop/scripts/prepare-sidecar.sh" --cef
fi

cd "$ROOT_DIR/desktop/src-tauri-cef"

BUNDLE_ARGS=()
if [[ -n "${TAURI_BUNDLES:-}" ]]; then
  if [[ "${TAURI_BUNDLES}" == "none" ]]; then
    BUNDLE_ARGS=(--no-bundle)
  else
    if [[ "$(uname -s)" == "Linux" ]] && [[ "${TAURI_BUNDLES}" == *appimage* ]] && ! command -v zsyncmake >/dev/null 2>&1; then
      echo "ERROR: AppImage bundling requires \`zsyncmake\` (package: zsync)." >&2
      echo "On Debian/Ubuntu: sudo apt install -y zsync" >&2
      exit 1
    fi
    BUNDLE_ARGS=(--bundles "${TAURI_BUNDLES}")
  fi
elif [[ "$(uname -s)" == "Linux" ]] && ! command -v zsyncmake >/dev/null 2>&1; then
  echo "WARN: zsyncmake not found; skipping AppImage bundle (install \`zsync\` to enable)." >&2
  BUNDLE_ARGS=(--bundles deb,rpm)
fi

if [[ -n "$TARGET" ]]; then
  cargo tauri build --config tauri.conf.full.json --target "$TARGET" --features cef "${BUNDLE_ARGS[@]}"
else
  cargo tauri build --config tauri.conf.full.json --features cef "${BUNDLE_ARGS[@]}"
fi
