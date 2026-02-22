#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building web dist..."
bun install --cwd "$ROOT_DIR/web" --frozen-lockfile
bun run --cwd "$ROOT_DIR/web" build

echo "Done: $ROOT_DIR/web/dist"
