#!/usr/bin/env bash
set -euo pipefail

# One-click-ish installer for the OpenCode Studio server as a background service.
#
# Examples:
#   curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/master/scripts/install-service.sh | bash -s -- --with-frontend
#   curl -fsSL https://raw.githubusercontent.com/canxin121/opencode-studio/v0.1.0/scripts/install-service.sh | bash -s -- --version v0.1.0 --with-frontend

REPO="canxin121/opencode-studio"
VERSION=""
WITH_FRONTEND="0"
MODE="user" # linux systemd: user|system
INSTALL_DIR=""
HOST="127.0.0.1"
PORT="3210"
UI_PASSWORD=""

usage() {
  cat <<'EOF'
Usage:
  install-service.sh [--repo owner/repo] [--version vX.Y.Z] [--with-frontend] [--mode user|system] [--install-dir PATH] [--host HOST] [--port PORT] [--ui-password PASSWORD]

Notes:
  - This installs the Rust server binary (opencode-studio) from GitHub Releases.
  - OpenCode itself (the `opencode` CLI) must already be installed and on PATH.
  - jq must already be installed (used to parse GitHub Releases metadata).
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
    --host) HOST="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --ui-password) UI_PASSWORD="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }

need curl
need tar
if ! command -v jq >/dev/null 2>&1; then
  echo "Missing dependency: jq" >&2
  echo "Install jq first, then re-run this installer." >&2
  echo "Examples:" >&2
  echo "  - macOS (Homebrew): brew install jq" >&2
  echo "  - Debian/Ubuntu:    sudo apt-get update && sudo apt-get install -y jq" >&2
  echo "  - Alpine:           apk add --no-cache jq" >&2
  exit 1
fi
if ! command -v opencode >/dev/null 2>&1; then
  echo "Missing dependency: opencode" >&2
  echo "Install OpenCode first, for example: curl -fsSL https://opencode.ai/install | bash" >&2
  exit 1
fi
OPENCODE_BIN="$(command -v opencode)"
OPENCODE_BIN_DIR="$(dirname "$OPENCODE_BIN")"
SERVICE_USER="$(id -un)"
SERVICE_GROUP="$(id -gn)"

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
  echo "Invalid --port '$PORT'. Expected 1-65535." >&2
  exit 2
fi

if [[ -z "${HOST// }" ]]; then
  echo "Invalid --host '$HOST'. Expected a non-empty hostname or IP." >&2
  exit 2
fi

toml_escape_basic_string() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

toml_quote_basic_string() {
  local value="$1"
  printf '"%s"' "$(toml_escape_basic_string "$value")"
}

normalize_connect_host() {
  local host="$1"
  case "$host" in
    0.0.0.0) printf '127.0.0.1' ;;
    ::|"[::]") printf '::1' ;;
    *) printf '%s' "$host" ;;
  esac
}

format_http_url() {
  local host="$1"
  local port="$2"
  if [[ "$host" == *:* ]]; then
    if [[ "$host" == \[*\] ]]; then
      printf 'http://%s:%s' "$host" "$port"
    else
      printf 'http://[%s]:%s' "$host" "$port"
    fi
  else
    printf 'http://%s:%s' "$host" "$port"
  fi
}

plist_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf '%s' "$value"
}

build_launchd_path() {
  local opencode_bin_dir="$1"
  local env_path="$2"

  local entries=(
    "$opencode_bin_dir"
    "$HOME/.bun/bin"
    "$HOME/.local/bin"
    "/opt/homebrew/bin"
    "/usr/local/bin"
    "/usr/bin"
    "/bin"
    "/usr/sbin"
    "/sbin"
  )

  if [[ -n "$env_path" ]]; then
    local part
    IFS=':' read -r -a path_parts <<<"$env_path"
    for part in "${path_parts[@]}"; do
      entries+=("$part")
    done
  fi

  local out=""
  local seen=":"
  local item=""
  for item in "${entries[@]}"; do
    [[ -n "$item" ]] || continue
    if [[ "$seen" != *":$item:"* ]]; then
      seen+="$item:"
      if [[ -z "$out" ]]; then
        out="$item"
      else
        out+=":$item"
      fi
    fi
  done
  printf '%s' "$out"
}

build_systemd_path() {
  local home_dir="$1"
  local opencode_bin_dir="$2"
  local env_path="$3"

  local entries=(
    "$opencode_bin_dir"
    "$home_dir/.bun/bin"
    "$home_dir/.local/bin"
    "/usr/local/sbin"
    "/usr/local/bin"
    "/usr/sbin"
    "/usr/bin"
    "/sbin"
    "/bin"
  )

  if [[ -n "$env_path" ]]; then
    local part
    IFS=':' read -r -a path_parts <<<"$env_path"
    for part in "${path_parts[@]}"; do
      entries+=("$part")
    done
  fi

  local out=""
  local seen=":"
  local item=""
  for item in "${entries[@]}"; do
    [[ -n "$item" ]] || continue
    if [[ "$seen" != *":$item:"* ]]; then
      seen+="$item:"
      if [[ -z "$out" ]]; then
        out="$item"
      else
        out+=":$item"
      fi
    fi
  done
  printf '%s' "$out"
}

macos_launchctl_domains() {
  local uid
  uid="$(id -u)"
  printf 'gui/%s\n' "$uid"
  printf 'user/%s\n' "$uid"
}

macos_launchctl_detect_loaded_domain() {
  local label="$1"
  local domain=""

  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    if launchctl print "$domain/$label" >/dev/null 2>&1; then
      printf '%s\n' "$domain"
      return 0
    fi
  done < <(macos_launchctl_domains)

  return 1
}

macos_launchctl_bootout_existing() {
  local label="$1"
  local plist="$2"
  local domain=""

  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    launchctl disable "$domain/$label" >/dev/null 2>&1 || true
    launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
    launchctl bootout "$domain" "$plist" >/dev/null 2>&1 || true
  done < <(macos_launchctl_domains)
}

macos_launchctl_enable_known_domains() {
  local label="$1"
  local domain=""

  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    launchctl enable "$domain/$label" >/dev/null 2>&1 || true
  done < <(macos_launchctl_domains)
}

macos_launchctl_bootstrap() {
  local plist="$1"
  local domain=""
  local last_err=""

  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    if out="$(launchctl bootstrap "$domain" "$plist" 2>&1)"; then
      printf '%s\n' "$domain"
      return 0
    fi
    last_err="$out"
  done < <(macos_launchctl_domains)

  if [[ -n "$last_err" ]]; then
    echo "launchctl bootstrap failed: $last_err" >&2
  fi
  return 1
}

macos_launchctl_wait_absent() {
  local label="$1"
  local timeout_secs="${2:-20}"
  local elapsed=0
  local domain=""

  while ((elapsed < timeout_secs)); do
    local present="0"
    while IFS= read -r domain; do
      [[ -n "$domain" ]] || continue
      if launchctl print "$domain/$label" >/dev/null 2>&1; then
        present="1"
        break
      fi
    done < <(macos_launchctl_domains)

    if [[ "$present" == "0" ]] && ! launchctl list 2>/dev/null | grep -q "$label"; then
      return 0
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

macos_launchctl_kickstart_label() {
  local label="$1"
  local domain=""

  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    launchctl enable "$domain/$label" >/dev/null 2>&1 || true
    if launchctl kickstart -k "$domain/$label" >/dev/null 2>&1; then
      printf '%s\n' "$domain"
      return 0
    fi
  done < <(macos_launchctl_domains)

  if launchctl start "$label" >/dev/null 2>&1; then
    printf '%s\n' "legacy"
    return 0
  fi
  return 1
}

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
normalize_arch() {
  local arch="$1"
  case "$arch" in
    amd64) printf 'x86_64' ;;
    armv8*|arm64v8) printf 'aarch64' ;;
    *) printf '%s' "$arch" ;;
  esac
}
ARCH="$(normalize_arch "$(uname -m)")"

backend_target_candidates() {
  case "${OS}/${ARCH}" in
    linux/x86_64|linux/amd64)
      printf '%s\n' "x86_64-unknown-linux-musl" "x86_64-unknown-linux-gnu"
      ;;
    linux/aarch64|linux/arm64)
      printf '%s\n' "aarch64-unknown-linux-musl" "aarch64-unknown-linux-gnu"
      ;;
    linux/armv7l|linux/armv7)
      printf '%s\n' "armv7-unknown-linux-musleabihf" "armv7-unknown-linux-gnueabihf"
      ;;
    linux/i686|linux/i386)
      printf '%s\n' "i686-unknown-linux-musl" "i686-unknown-linux-gnu"
      ;;
    darwin/x86_64|darwin/amd64)
      printf '%s\n' "x86_64-apple-darwin"
      ;;
    darwin/arm64|darwin/aarch64)
      printf '%s\n' "aarch64-apple-darwin"
      ;;
    *)
      echo "Unsupported platform: ${OS}/${ARCH}" >&2
      echo "Supported platforms/arches:" >&2
      echo "  - linux: x86_64, aarch64/arm64, armv7l/armv7, i686/i386" >&2
      echo "  - macos: x86_64, arm64" >&2
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
  local curl_args=(
    -sS
    -H "User-Agent: opencode-studio-installer"
    -H "Accept: application/vnd.github+json"
  )

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=( -H "Authorization: Bearer ${GITHUB_TOKEN}" )
  elif [[ -n "${GH_TOKEN:-}" ]]; then
    curl_args+=( -H "Authorization: Bearer ${GH_TOKEN}" )
  fi

  if [[ -n "$VERSION" ]]; then
    local tag="$VERSION"
    if ! [[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]]; then
      need python3
      tag="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$tag")"
    fi
    url="https://api.github.com/repos/${REPO}/releases/tags/${tag}"
  else
    url="https://api.github.com/repos/${REPO}/releases/latest"
  fi

  local body
  body="$(mktemp)"
  local code=""
  code="$(curl "${curl_args[@]}" -o "$body" -w '%{http_code}' "$url" || true)"
  if [[ "$code" != "200" ]]; then
    local msg=""
    msg="$(jq -r '.message? // empty' <"$body" 2>/dev/null || true)"

    echo "GitHub API request failed ($code): $url" >&2
    if [[ -n "$msg" ]]; then
      echo "GitHub API message: $msg" >&2
    fi
    if [[ "$code" == "403" || "$code" == "429" ]]; then
      echo "Tip: set GITHUB_TOKEN (or GH_TOKEN) to avoid rate limits." >&2
    fi
    if [[ "$code" == "404" && -n "$VERSION" ]]; then
      echo "Tip: verify the release tag exists and is published: ${VERSION}" >&2
    fi
    rm -f "$body"
    exit 1
  fi

  cat "$body"
  rm -f "$body"
}

list_release_assets() {
  local json="$1"
  jq -r '.assets[]?.name' <<<"$json" 2>/dev/null || true
}

asset_url_by_name() {
  local json="$1"
  local name="$2"
  jq -r --arg NAME "$name" '.assets[] | select(.name==$NAME) | .browser_download_url' <<<"$json" | head -n 1
}

linux_backend_libc_family() {
  local name="$1"
  case "$name" in
    *unknown-linux-musl*|*unknown-linux-musleabihf*) printf '%s\n' "musl" ;;
    *unknown-linux-gnu*|*unknown-linux-gnueabihf*) printf '%s\n' "gnu" ;;
    *) printf '%s\n' "" ;;
  esac
}

warn_if_linux_backend_fallback() {
  local chosen="$1"
  local preferred="$2"
  local chosen_family=""
  local preferred_family=""

  chosen_family="$(linux_backend_libc_family "$chosen")"
  preferred_family="$(linux_backend_libc_family "$preferred")"
  if [[ "$preferred_family" == "musl" && "$chosen_family" == "gnu" ]]; then
    echo "Warning: Linux musl backend asset not found for ${OS}/${ARCH}; falling back to glibc build: $chosen" >&2
  fi
}

download_asset_by_name() {
  local json="$1"
  local name="$2"
  local out="$3"
  local url=""

  url="$(asset_url_by_name "$json" "$name")"
  if [[ -z "$url" || "$url" == "null" ]]; then
    echo "Asset not found in release: $name" >&2
    echo "Available assets:" >&2
    while IFS= read -r a; do
      [[ -n "$a" ]] || continue
      echo "  - $a" >&2
    done < <(list_release_assets "$json")
    exit 1
  fi

  echo "Downloading: $name"
  curl -fL --retry 3 --retry-delay 1 -o "$out" "$url"
}

download_first_asset_by_name() {
  local json="$1"
  local out="$2"
  shift 2

  local preferred_name="${1:-}"
  local name=""
  local url=""
  for name in "$@"; do
    url="$(asset_url_by_name "$json" "$name")"
    if [[ -n "$url" && "$url" != "null" ]]; then
      if [[ -n "$preferred_name" ]]; then
        warn_if_linux_backend_fallback "$name" "$preferred_name"
      fi
      echo "Downloading: $name"
      curl -fL --retry 3 --retry-delay 1 -o "$out" "$url"
      return 0
    fi
  done

  echo "Asset not found in release. Tried:" >&2
  for name in "$@"; do
    echo "  - $name" >&2
  done
  echo "Available assets:" >&2
  while IFS= read -r a; do
    [[ -n "$a" ]] || continue
    echo "  - $a" >&2
  done < <(list_release_assets "$json")
  exit 1
}

RELEASE_JSON="$(fetch_release_json)"
TAG_NAME="$(jq -r '.tag_name // ""' <<<"$RELEASE_JSON")"
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
  BACKEND_ASSET_CANDIDATES+=("opencode-studio-backend-${target}.tar.gz")
done
for target in "${BACKEND_TARGETS[@]}"; do
  BACKEND_ASSET_CANDIDATES+=("opencode-studio-${target}-${TAG_NAME}.tar.gz")
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
host = $(toml_quote_basic_string "$HOST")
port = $PORT
# Optional UI session password. Keep empty to disable password login.
ui_password = $(toml_quote_basic_string "$UI_PASSWORD")
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
    SYSTEMD_PATH="$(build_systemd_path "$HOME" "$OPENCODE_BIN_DIR" "${PATH:-}")"
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
User=$SERVICE_USER
Group=$SERVICE_GROUP
Environment="PATH=$SYSTEMD_PATH"
Environment="HOME=$HOME"
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
Environment="PATH=$SYSTEMD_PATH"
Environment="HOME=$HOME"
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
  LABEL="cn.cxits.opencode-studio"
  PLIST="$HOME/Library/LaunchAgents/cn.cxits.opencode-studio.plist"
  mkdir -p "$(dirname "$PLIST")"
  LAUNCHD_PATH="$(build_launchd_path "$OPENCODE_BIN_DIR" "${PATH:-}")"
  LAUNCHD_PATH_XML="$(plist_escape "$LAUNCHD_PATH")"
  HOME_XML="$(plist_escape "$HOME")"

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
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$LAUNCHD_PATH_XML</string>
    <key>HOME</key>
    <string>$HOME_XML</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
EOF

  macos_launchctl_bootout_existing "$LABEL" "$PLIST"
  macos_launchctl_wait_absent "$LABEL" 20 || true

  macos_launchctl_enable_known_domains "$LABEL"
  LAUNCH_DOMAIN="$(macos_launchctl_bootstrap "$PLIST" || true)"
  if [[ -z "$LAUNCH_DOMAIN" ]]; then
    echo "launchctl bootstrap failed; trying legacy load fallback"
    launchctl load -w "$PLIST" >/dev/null 2>&1 || launchctl load "$PLIST"
    macos_launchctl_enable_known_domains "$LABEL"
    LAUNCH_DOMAIN="$(macos_launchctl_detect_loaded_domain "$LABEL" || true)"
  fi

  STARTED_DOMAIN="$(macos_launchctl_kickstart_label "$LABEL" || true)"
  if [[ -n "$STARTED_DOMAIN" ]]; then
    echo "Service kickstarted in domain: $STARTED_DOMAIN"
  else
    echo "Warning: launchctl kickstart/start failed for $LABEL" >&2
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl print "user/$(id -u)/$LABEL" 2>/dev/null || true
  fi

  if [[ -n "$LAUNCH_DOMAIN" ]]; then
    echo "Service loaded in domain: $LAUNCH_DOMAIN"
  else
    echo "Service loaded via legacy launchctl flow"
  fi

  echo "Use: launchctl print gui/$(id -u)/$LABEL"
  echo "Resolved OpenCode binary: $OPENCODE_BIN"
fi

echo "Install complete. Binary: $BIN_PATH"
echo "Runtime config: $CONFIG_FILE"
CONNECT_HOST="$(normalize_connect_host "$HOST")"
echo "Open: $(format_http_url "$CONNECT_HOST" "$PORT")"
