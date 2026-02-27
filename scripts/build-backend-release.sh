#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: build-backend-release.sh [--target TARGET_TRIPLE] [--tag RELEASE_TAG] [--out-dir OUT_DIR]

Options:
  --target TARGET_TRIPLE  Rust target triple (defaults to host)
  --tag RELEASE_TAG       Optional version/tag suffix for archive names
  --out-dir OUT_DIR       Output directory for packaged archives (default: release-assets)
EOF
}

TARGET_TRIPLE=""
RELEASE_TAG=""
OUT_DIR="$ROOT_DIR/release-assets"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_TRIPLE="${2:-}"
      shift 2
      ;;
    --tag)
      RELEASE_TAG="${2:-}"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$TARGET_TRIPLE" ]]; then
  if rustc --print host-tuple >/dev/null 2>&1; then
    TARGET_TRIPLE="$(rustc --print host-tuple)"
  else
    TARGET_TRIPLE="$(rustc -Vv | awk '/^host:/{print $2; exit}')"
  fi
fi

EXT=""
ARCHIVE_EXT="tar.gz"
case "$TARGET_TRIPLE" in
  *-pc-windows-*)
    EXT=".exe"
    ARCHIVE_EXT="zip"
    ;;
esac

echo "Building Rust backend (server) release for ${TARGET_TRIPLE}..."
cargo build --manifest-path "$ROOT_DIR/server/Cargo.toml" --release --locked --target "$TARGET_TRIPLE" --target-dir "$ROOT_DIR/server/target"

BIN_DIR="$ROOT_DIR/server/target/$TARGET_TRIPLE/release"
BIN_NAME="opencode-studio$EXT"
BIN_PATH="$BIN_DIR/$BIN_NAME"
if [[ ! -f "$BIN_PATH" ]]; then
  echo "ERROR: built binary not found: $BIN_PATH" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

ARCHIVE_BASE="opencode-studio-backend-$TARGET_TRIPLE"
if [[ -n "$RELEASE_TAG" ]]; then
  ARCHIVE_BASE="$ARCHIVE_BASE-$RELEASE_TAG"
fi

ARCHIVE_PATH="$OUT_DIR/$ARCHIVE_BASE.$ARCHIVE_EXT"
python3 - "$ARCHIVE_EXT" "$BIN_DIR" "$BIN_NAME" "$ARCHIVE_PATH" <<'PY'
import pathlib
import sys
import tarfile
import zipfile

archive_ext, bin_dir, bin_name, archive_path = sys.argv[1:5]
bin_path = pathlib.Path(bin_dir) / bin_name
archive = pathlib.Path(archive_path)
archive.parent.mkdir(parents=True, exist_ok=True)

if archive.exists():
    archive.unlink()

if archive_ext == "zip":
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
      zf.write(bin_path, arcname=bin_name)
else:
    with tarfile.open(archive, "w:gz") as tf:
      tf.add(bin_path, arcname=bin_name)
PY

METADATA_PATH="$OUT_DIR/$ARCHIVE_BASE.json"
python3 - "$TARGET_TRIPLE" "$ARCHIVE_EXT" "$ARCHIVE_PATH" "$METADATA_PATH" <<'PY'
import json
import pathlib
import sys

target, archive_ext, archive_path, metadata_path = sys.argv[1:5]
parts = target.split("-")
arch = parts[0] if parts else "unknown"
os_name = "windows" if "windows" in target else "macos" if "apple" in target else "linux" if "linux" in target else "unknown"

metadata = {
    "target": target,
    "arch": arch,
    "os": os_name,
    "archive_format": archive_ext,
    "archive_file": pathlib.Path(archive_path).name,
}

pathlib.Path(metadata_path).write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
PY

echo "Done: $ARCHIVE_PATH"
echo "Metadata: $METADATA_PATH"
