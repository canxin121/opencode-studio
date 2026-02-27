#!/usr/bin/env bash
set -euo pipefail

# One-click-ish installer for the OpenCode Studio server as a background service.
#
# Examples:
#   curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/main/scripts/install-service.sh | bash -s -- --with-frontend
#   curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/v0.1.0/scripts/install-service.sh | bash -s -- --version v0.1.0 --with-frontend

REPO="canxin121/opencode-studio"
VERSION=""
WITH_FRONTEND="0"
MODE="user" # linux systemd: user|system
INSTALL_DIR=""

usage() {
  cat <<'EOF'
Usage:
  install-service.sh [--repo owner/repo] [--version vX.Y.Z] [--with-frontend] [--mode user|system] [--install-dir PATH]

Notes:
  - This installs the Rust server binary (opencode-studio) from GitHub Releases.
  - OpenCode itself (the `opencode` CLI) must already be installed and on PATH.
  - Default install dir: ~/opencode-studio (bin/, dist/, opencode-studio.toml).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --version) VERSION="$2"; shift 2;;
    --with-frontend) WITH_FRONTEND="1"; shift;;
    --mode) MODE="$2"; shift 2;;
    --install-dir) INSTALL_DIR="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl
need tar
if ! command -v opencode >/dev/null 2>&1; then
  echo "Missing dependency: opencode" >&2
  echo "Install OpenCode first, for example: curl -fsSL https://opencode.ai/install | bash" >&2
  exit 1
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

linux_libc_family() {
  if ! command -v ldd >/dev/null 2>&1; then
    echo "gnu"
    return
  fi

  local info
  info="$(ldd --version 2>&1 || true)"
  if [[ "$info" == *musl* ]]; then
    echo "musl"
  else
    echo "gnu"
  fi
}

backend_target_candidates() {
  case "${OS}/${ARCH}" in
    linux/x86_64)
      if [[ "$(linux_libc_family)" == "musl" ]]; then
        printf '%s\n' "x86_64-unknown-linux-musl" "x86_64-unknown-linux-gnu"
      else
        printf '%s\n' "x86_64-unknown-linux-gnu" "x86_64-unknown-linux-musl"
      fi
      ;;
    linux/aarch64|linux/arm64)
      if [[ "$(linux_libc_family)" == "musl" ]]; then
        printf '%s\n' "aarch64-unknown-linux-musl" "aarch64-unknown-linux-gnu"
      else
        printf '%s\n' "aarch64-unknown-linux-gnu" "aarch64-unknown-linux-musl"
      fi
      ;;
    linux/armv7l|linux/armv7)
      if [[ "$(linux_libc_family)" == "musl" ]]; then
        printf '%s\n' "armv7-unknown-linux-musleabihf" "armv7-unknown-linux-gnueabihf"
      else
        printf '%s\n' "armv7-unknown-linux-gnueabihf" "armv7-unknown-linux-musleabihf"
      fi
      ;;
    linux/i686|linux/i386)
      if [[ "$(linux_libc_family)" == "musl" ]]; then
        printf '%s\n' "i686-unknown-linux-musl" "i686-unknown-linux-gnu"
      else
        printf '%s\n' "i686-unknown-linux-gnu" "i686-unknown-linux-musl"
      fi
      ;;
    darwin/x86_64)
      printf '%s\n' "x86_64-apple-darwin"
      ;;
    darwin/arm64|darwin/aarch64)
      printf '%s\n' "aarch64-apple-darwin"
      ;;
    *)
      echo "Unsupported platform: ${OS}/${ARCH}" >&2
      echo "Set up a manual install from GitHub Releases for your target." >&2
      exit 1
      ;;
  esac
}

BACKEND_TARGETS=()
while IFS= read -r target; do
  BACKEND_TARGETS+=("$target")
done < <(backend_target_candidates)
if [[ "${#BACKEND_TARGETS[@]}" -eq 0 ]]; then
  echo "Failed to resolve backend target candidates for ${OS}/${ARCH}" >&2
  exit 1
fi

if [[ -z "$INSTALL_DIR" ]]; then
  INSTALL_DIR="$HOME/opencode-studio"
fi

BIN_DIR="$INSTALL_DIR/bin"
BIN_PATH="$BIN_DIR/opencode-studio"
UI_DIR="$INSTALL_DIR/dist"
CONFIG_FILE="$INSTALL_DIR/opencode-studio.toml"

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

asset_url_by_name() {
  local json="$1"
  local name="$2"

  if command -v jq >/dev/null 2>&1; then
    jq -r --arg NAME "$name" '.assets[] | select(.name==$NAME) | .browser_download_url' <<<"$json" | head -n 1
    return
  fi

  need python3
  python3 -c 'import json,sys
j=json.loads(sys.stdin.read())
name=sys.argv[1]
for a in j.get("assets", []):
  if a.get("name") == name:
    print(a.get("browser_download_url", ""))
    sys.exit(0)
print("")' "$name" <<<"$json"
}

download_asset_by_name() {
  local json="$1"
  local name="$2"
  local out="$3"
  local url=""

  url="$(asset_url_by_name "$json" "$name")"
  if [[ -z "$url" || "$url" == "null" ]]; then
    echo "Asset not found in release: $name" >&2
    exit 1
  fi

  echo "Downloading: $name"
  curl -fL --retry 3 --retry-delay 1 -o "$out" "$url"
}

download_first_asset_by_name() {
  local json="$1"
  local out="$2"
  shift 2

  local name=""
  local url=""
  for name in "$@"; do
    url="$(asset_url_by_name "$json" "$name")"
    if [[ -n "$url" && "$url" != "null" ]]; then
      echo "Downloading: $name"
      curl -fL --retry 3 --retry-delay 1 -o "$out" "$url"
      return 0
    fi
  done

  echo "Asset not found in release. Tried:" >&2
  for name in "$@"; do
    echo "  - $name" >&2
  done
  exit 1
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

BACKEND_TAR="$TMP_DIR/opencode-studio-backend.tar.gz"
BACKEND_ASSET_CANDIDATES=()
for target in "${BACKEND_TARGETS[@]}"; do
  BACKEND_ASSET_CANDIDATES+=("opencode-studio-backend-${target}-${TAG_NAME}.tar.gz")
done
for target in "${BACKEND_TARGETS[@]}"; do
  BACKEND_ASSET_CANDIDATES+=("opencode-studio-${target}.tar.gz")
done
download_first_asset_by_name "$RELEASE_JSON" "$BACKEND_TAR" "${BACKEND_ASSET_CANDIDATES[@]}"

echo "Installing backend binary to $BIN_PATH"
tar -xzf "$BACKEND_TAR" -C "$TMP_DIR"
if [[ ! -f "$TMP_DIR/opencode-studio" ]]; then
  echo "Unexpected archive layout; expected opencode-studio at tar root" >&2
  exit 1
fi
install -m 0755 "$TMP_DIR/opencode-studio" "$BIN_PATH"

if [[ "$WITH_FRONTEND" == "1" ]]; then
  WEB_ASSET="opencode-studio-web-dist-${TAG_NAME}.tar.gz"
  WEB_TAR="$TMP_DIR/$WEB_ASSET"
  download_asset_by_name "$RELEASE_JSON" "$WEB_ASSET" "$WEB_TAR"
  rm -rf "$UI_DIR" "$INSTALL_DIR/ui"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$WEB_TAR" -C "$INSTALL_DIR"
  if [[ ! -f "$UI_DIR/index.html" ]]; then
    echo "Unexpected web archive layout; expected dist/index.html" >&2
    exit 1
  fi
fi

cat >"$CONFIG_FILE" <<EOF
# Runtime configuration for opencode-studio.

[backend]
host = "127.0.0.1"
port = 3000
skip_opencode_start = false
opencode_host = "127.0.0.1"

# To connect to an already running OpenCode, set:
# opencode_port = 16000
EOF

if [[ "$WITH_FRONTEND" == "1" ]]; then
  printf '%s\n' "ui_dir = \"$UI_DIR\"" >>"$CONFIG_FILE"
fi

echo "Wrote runtime config: $CONFIG_FILE"

if [[ "$OS" == "linux" ]]; then
  if command -v systemctl >/dev/null 2>&1; then
    if [[ "$MODE" == "system" ]]; then
      SERVICE_PATH="/etc/systemd/system/opencode-studio.service"
      echo "Installing systemd (system) service: $SERVICE_PATH"
      sudo mkdir -p "$(dirname "$SERVICE_PATH")"
      sudo tee "$SERVICE_PATH" >/dev/null <<EOF
[Unit]
Description=OpenCode Studio server
After=network.target

[Service]
Type=simple
ExecStart="$BIN_PATH" --config "$CONFIG_FILE"
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
      sudo systemctl daemon-reload
      sudo systemctl enable --now opencode-studio.service
      echo "Service started: systemctl status opencode-studio"
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
ExecStart="$BIN_PATH" --config "$CONFIG_FILE"
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF
      systemctl --user daemon-reload
      systemctl --user enable --now opencode-studio.service
      echo "Service started: systemctl --user status opencode-studio"
    fi
  else
    echo "systemctl not found; installed binary but did not create a service." >&2
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
    <string>--config</string>
    <string>$CONFIG_FILE</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
EOF

  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load "$PLIST"
  echo "Service loaded. Use: launchctl list | grep opencode"
fi

echo "Install complete. Binary: $BIN_PATH"
echo "Runtime config: $CONFIG_FILE"
echo "Open: http://127.0.0.1:3000"
