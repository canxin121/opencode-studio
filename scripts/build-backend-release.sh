#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building Rust backend (server) release..."
cargo build --manifest-path "$ROOT_DIR/server/Cargo.toml" --release --locked --target-dir "$ROOT_DIR/server/target"

echo "Done: $ROOT_DIR/server/target/release/opencode-studio"
