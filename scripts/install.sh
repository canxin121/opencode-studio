#!/usr/bin/env bash
set -euo pipefail

# One-line installer for OpenCode Studio server.
#
# Modes:
#   --desktop  : install backend + bundled web UI (default)
#   --headless : install backend only (API/service only)

REPO="canxin121/opencode-studio"
VERSION=""
INSTALL_VARIANT="desktop"
SYSTEMD_MODE="user" # linux systemd: user|system
INSTALL_DIR=""
HOST="127.0.0.1"
PORT="3000"

usage() {
  cat <<'EOF'
Usage:
  install.sh [--desktop|--headless] [--repo owner/repo] [--version vX.Y.Z] \
             [--mode user|system] [--install-dir PATH] [--host HOST] [--port PORT]

Examples:
  install.sh --desktop
  install.sh --headless --version v0.1.0

Notes:
  - This installs the Rust server binary (opencode-studio) from GitHub Releases.
  - OpenCode itself (the `opencode` CLI) should be available on PATH, or configure
    OPENCODE_HOST/OPENCODE_PORT in the generated env file.
  - Linux/macOS only. Windows should use scripts/install.ps1.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --desktop) INSTALL_VARIANT="desktop"; shift ;;
    --headless) INSTALL_VARIANT="headless"; shift ;;
    --mode) SYSTEMD_MODE="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "$SYSTEMD_MODE" != "user" && "$SYSTEMD_MODE" != "system" ]]; then
  echo "Invalid --mode '$SYSTEMD_MODE'. Expected user or system." >&2
  exit 2
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
  echo "Invalid --port '$PORT'. Expected 1-65535." >&2
  exit 2
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl
need tar

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

target_triple() {
  case "${OS}/${ARCH}" in
    linux/x86_64) echo "x86_64-unknown-linux-gnu" ;;
    darwin/x86_64) echo "x86_64-apple-darwin" ;;
    darwin/arm64) echo "aarch64-apple-darwin" ;;
    *)
      echo "Unsupported platform: ${OS}/${ARCH}" >&2
      echo "Set up a manual install from GitHub Releases for your target." >&2
      exit 1
      ;;
  esac
}

TARGET="$(target_triple)"

if [[ -z "$INSTALL_DIR" ]]; then
  INSTALL_DIR="$HOME/.local/share/opencode-studio"
fi

BIN_DIR="$HOME/.local/bin"
BIN_PATH="$BIN_DIR/opencode-studio"
UI_DIR="$INSTALL_DIR/ui/dist"
ENV_FILE="$INSTALL_DIR/service.env"

mkdir -p "$INSTALL_DIR" "$BIN_DIR"

fetch_release_json() {
  local url
  if [[ -n "$VERSION" ]]; then
    url="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
  else
    url="https://api.github.com/repos/${REPO}/releases/latest"
  fi
  curl -fsSL "$url"
}

download_asset_by_name() {
  local json="$1"
  local name="$2"
  local out="$3"
  local url=""

  if command -v jq >/dev/null 2>&1; then
    url="$(jq -r --arg NAME "$name" '.assets[] | select(.name==$NAME) | .browser_download_url' <<<"$json" | head -n 1)"
  else
    need python3
    url="$(python3 - <<PY
import json,sys
j=json.loads(sys.stdin.read())
name=sys.argv[1]
for a in j.get('assets', []):
  if a.get('name')==name:
    print(a.get('browser_download_url',''))
    sys.exit(0)
print("")
sys.exit(0)
PY
"$name" <<<"$json")"
  fi

  if [[ -z "$url" || "$url" == "null" ]]; then
    echo "Asset not found in release: $name" >&2
    exit 1
  fi

  echo "Downloading: $name"
  curl -fL --retry 3 --retry-delay 1 -o "$out" "$url"
}

RELEASE_JSON="$(fetch_release_json)"
if command -v jq >/dev/null 2>&1; then
  TAG_NAME="$(jq -r '.tag_name // ""' <<<"$RELEASE_JSON")"
else
  need python3
  TAG_NAME="$(python3 - <<'PY' <<<"$RELEASE_JSON"
import json,sys
print(json.loads(sys.stdin.read()).get('tag_name',''))
PY
  )"
fi
if [[ -z "$TAG_NAME" ]]; then
  echo "Failed to determine release tag_name" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

BACKEND_ASSET="opencode-studio-${TARGET}.tar.gz"
BACKEND_TAR="$TMP_DIR/$BACKEND_ASSET"
download_asset_by_name "$RELEASE_JSON" "$BACKEND_ASSET" "$BACKEND_TAR"

echo "Installing backend binary to $BIN_PATH"
tar -xzf "$BACKEND_TAR" -C "$TMP_DIR"
if [[ ! -f "$TMP_DIR/opencode-studio" ]]; then
  echo "Unexpected archive layout; expected opencode-studio at tar root" >&2
  exit 1
fi
install -m 0755 "$TMP_DIR/opencode-studio" "$BIN_PATH"

if [[ "$INSTALL_VARIANT" == "desktop" ]]; then
  WEB_ASSET="opencode-studio-web-dist-${TAG_NAME}.tar.gz"
  WEB_TAR="$TMP_DIR/$WEB_ASSET"
  download_asset_by_name "$RELEASE_JSON" "$WEB_ASSET" "$WEB_TAR"
  rm -rf "$UI_DIR"
  mkdir -p "$INSTALL_DIR/ui"
  tar -xzf "$WEB_TAR" -C "$INSTALL_DIR/ui"
  if [[ ! -f "$UI_DIR/index.html" ]]; then
    echo "Unexpected web archive layout; expected dist/index.html" >&2
    exit 1
  fi
fi

cat >"$ENV_FILE" <<EOF
# Environment file for the opencode-studio service.
# Edit this file to change host/port/OpenCode connectivity.

OPENCODE_STUDIO_HOST=$HOST
OPENCODE_STUDIO_PORT=$PORT
# If you run OpenCode separately, set these:
# OPENCODE_HOST=127.0.0.1
# OPENCODE_PORT=16000
EOF

if [[ "$INSTALL_VARIANT" == "desktop" ]]; then
  printf '%s\n' "OPENCODE_STUDIO_UI_DIR=$UI_DIR" >>"$ENV_FILE"
fi

echo "Wrote env file: $ENV_FILE"

if [[ "$OS" == "linux" ]]; then
  if command -v systemctl >/dev/null 2>&1; then
    if [[ "$SYSTEMD_MODE" == "system" ]]; then
      SERVICE_PATH="/etc/systemd/system/opencode-studio.service"
      echo "Installing systemd (system) service: $SERVICE_PATH"
      sudo mkdir -p "$(dirname "$SERVICE_PATH")"
      sudo tee "$SERVICE_PATH" >/dev/null <<EOF
[Unit]
Description=OpenCode Studio server
After=network.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_PATH
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
      sudo systemctl daemon-reload
      sudo systemctl enable --now opencode-studio.service
      echo "Enabled autostart + started: systemctl status opencode-studio"
    else
      SERVICE_PATH="$HOME/.config/systemd/user/opencode-studio.service"
      echo "Installing systemd (user) service: $SERVICE_PATH"
      mkdir -p "$(dirname "$SERVICE_PATH")"
      cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=OpenCode Studio server
After=network.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_PATH
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF
      systemctl --user daemon-reload
      systemctl --user enable --now opencode-studio.service
      echo "Enabled autostart + started: systemctl --user status opencode-studio"
    fi
  else
    echo "systemctl not found; installed binary/env only (no service configured)." >&2
  fi
elif [[ "$OS" == "darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/cn.cxits.opencode-studio.plist"
  mkdir -p "$(dirname "$PLIST")"

  echo "Installing launchd user agent: $PLIST"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>cn.cxits.opencode-studio</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN_PATH</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENCODE_STUDIO_HOST</key><string>$HOST</string>
    <key>OPENCODE_STUDIO_PORT</key><string>$PORT</string>
EOF
  if [[ "$INSTALL_VARIANT" == "desktop" ]]; then
    cat >>"$PLIST" <<EOF
    <key>OPENCODE_STUDIO_UI_DIR</key><string>$UI_DIR</string>
EOF
  fi
  cat >>"$PLIST" <<'EOF'
  </dict>
</dict>
</plist>
EOF

  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load "$PLIST"
  echo "Enabled autostart + loaded: launchctl list | grep opencode"
else
  echo "Unsupported OS for service setup: $OS" >&2
  exit 1
fi

echo "Install complete ($INSTALL_VARIANT). Binary: $BIN_PATH"
echo "Open: http://${HOST}:${PORT}"
if [[ "$INSTALL_VARIANT" == "headless" ]]; then
  echo "Headless mode: no bundled UI installed (API/service only)."
fi
