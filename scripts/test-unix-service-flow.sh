#!/usr/bin/env bash
set -euo pipefail

REPO="canxin121/opencode-studio"
VERSION=""
WITH_FRONTEND="0"
MODE="user"
INSTALL_DIR=""
ALLOW_EXISTING_INSTALL_DIR="0"
WAIT_TIMEOUT_SECS="90"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
INSTALL_SCRIPT="$SCRIPT_DIR/install-service.sh"
UNINSTALL_SCRIPT="$SCRIPT_DIR/uninstall-service.sh"

OS="$(uname -s)"
PORT=""
BASE_URL=""
INSTALL_COMPLETED="0"
START_EPOCH="$(date +%s)"

usage() {
  cat <<'EOF'
Usage:
  test-unix-service-flow.sh [options]

Options:
  --with-frontend                 Install bundled frontend for validation.
  --mode user|system              Linux service mode to test (default: user).
  --repo owner/repo               Release source repo (default: canxin121/opencode-studio).
  --version vX.Y.Z                Pin release version (default: latest).
  --install-dir PATH              Install dir for test run (default: random temp dir).
  --allow-existing-install-dir    Allow using an existing install dir.
  --wait-timeout SECONDS          Health wait timeout (default: 90).
  -h, --help                      Show this help message.

What it validates:
  1) Install service with a random localhost port.
  2) Verify installed files and generated config values.
  3) Verify /health endpoint and response shape.
  4) Exercise service management operations (status/restart/stop/start).
  5) Uninstall while keeping files, then verify files remain.
  6) Uninstall with --remove-install-dir, then verify files are removed.

Notes:
  - Linux/macOS only.
  - Requires: opencode, curl, python3.
  - On Linux, sudo calls are forced non-interactive to avoid hanging.
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"
}

normalize_path() {
  local path="$1"

  case "$path" in
    "~") path="$HOME" ;;
    ~/*) path="$HOME/${path#~/}" ;;
  esac

  if [[ "$path" == /* ]]; then
    printf '%s\n' "$path"
  else
    printf '%s/%s\n' "$(pwd -P)" "$path"
  fi
}

pick_random_port() {
  python3 - <<'PY'
import socket

s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

wait_for_health_up() {
  local url="$1"
  local timeout_secs="$2"
  local elapsed=0

  while ((elapsed < timeout_secs)); do
    if curl -fsS --max-time 2 "$url/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

wait_for_health_down() {
  local url="$1"
  local timeout_secs="$2"
  local elapsed=0

  while ((elapsed < timeout_secs)); do
    if ! curl -fsS --max-time 2 "$url/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

assert_path_exists() {
  local path="$1"
  [[ -e "$path" ]] || fail "Expected path missing: $path"
}

assert_path_not_exists() {
  local path="$1"
  [[ ! -e "$path" ]] || fail "Expected path removed: $path"
}

validate_health_payload() {
  local url="$1"
  local health_json=""

  health_json="$(curl -fsS "$url/health")"

  python3 - "$health_json" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])

assert payload.get("status") == "ok", payload
assert isinstance(payload.get("timestamp"), str), payload

if "openCodeRunning" in payload:
    assert isinstance(payload["openCodeRunning"], bool), payload
if "isOpenCodeReady" in payload:
    assert isinstance(payload["isOpenCodeReady"], bool), payload

print("health payload validated")
PY
}

linux_service_cmd() {
  if [[ "$MODE" == "system" ]]; then
    sudo systemctl "$@"
  else
    systemctl --user "$@"
  fi
}

verify_linux_service_present() {
  if [[ "$MODE" == "system" ]]; then
    sudo test -f /etc/systemd/system/opencode-studio.service || fail "Missing system unit file"
  else
    test -f "$HOME/.config/systemd/user/opencode-studio.service" || fail "Missing user unit file"
  fi
}

verify_linux_service_removed() {
  if [[ "$MODE" == "system" ]]; then
    sudo test ! -f /etc/systemd/system/opencode-studio.service || fail "System unit file still exists"
  else
    test ! -f "$HOME/.config/systemd/user/opencode-studio.service" || fail "User unit file still exists"
  fi
}

manage_service_linux() {
  log "Linux: checking service status"
  linux_service_cmd status opencode-studio --no-pager >/dev/null

  log "Linux: checking autostart state"
  linux_service_cmd is-enabled opencode-studio >/dev/null

  log "Linux: restarting service"
  linux_service_cmd restart opencode-studio
  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service failed to become healthy after restart"

  log "Linux: stopping service"
  linux_service_cmd stop opencode-studio
  wait_for_health_down "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service still reachable after stop"

  log "Linux: starting service"
  linux_service_cmd start opencode-studio
  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service failed to become healthy after start"
}

MACOS_LABEL="cn.cxits.opencode-studio"
MACOS_PLIST="$HOME/Library/LaunchAgents/${MACOS_LABEL}.plist"

verify_macos_service_present() {
  test -f "$MACOS_PLIST" || fail "Missing launchd plist: $MACOS_PLIST"
}

verify_macos_service_removed() {
  test ! -f "$MACOS_PLIST" || fail "launchd plist still exists: $MACOS_PLIST"
}

manage_service_macos() {
  log "macOS: checking launchd registration"
  launchctl list | grep -q "$MACOS_LABEL" || fail "Service label not found in launchctl list"

  log "macOS: restarting service"
  if ! launchctl kickstart -k "gui/$(id -u)/$MACOS_LABEL" >/dev/null 2>&1; then
    log "macOS: kickstart failed, using unload/load fallback"
    launchctl unload "$MACOS_PLIST" >/dev/null 2>&1 || true
    launchctl load "$MACOS_PLIST"
  fi
  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service failed to become healthy after restart"

  log "macOS: stopping service"
  launchctl unload "$MACOS_PLIST"
  wait_for_health_down "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service still reachable after unload"

  log "macOS: starting service"
  launchctl load "$MACOS_PLIST"
  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service failed to become healthy after load"
}

cleanup_on_failure() {
  local exit_code="$?"

  if [[ "$exit_code" -ne 0 && "$INSTALL_COMPLETED" == "1" ]]; then
    log "Test failed. Running best-effort cleanup..."
    bash "$UNINSTALL_SCRIPT" --install-dir "$INSTALL_DIR" --remove-install-dir >/dev/null 2>&1 || true
  fi
}

trap cleanup_on_failure EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-frontend) WITH_FRONTEND="1"; shift ;;
    --mode) MODE="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --allow-existing-install-dir) ALLOW_EXISTING_INSTALL_DIR="1"; shift ;;
    --wait-timeout) WAIT_TIMEOUT_SECS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown arg: $1" ;;
  esac
done

if [[ "$MODE" != "user" && "$MODE" != "system" ]]; then
  fail "Invalid --mode '$MODE'. Expected user or system."
fi

if ! [[ "$WAIT_TIMEOUT_SECS" =~ ^[0-9]+$ ]] || ((WAIT_TIMEOUT_SECS < 5)); then
  fail "Invalid --wait-timeout '$WAIT_TIMEOUT_SECS'. Expected integer >= 5."
fi

if [[ "$OS" != "Linux" && "$OS" != "Darwin" ]]; then
  fail "Unsupported OS: $OS (Linux/macOS only)"
fi

if [[ "$OS" == "Darwin" && "$MODE" == "system" ]]; then
  fail "--mode system is Linux-only"
fi

need opencode
need curl
need python3
need bash

test -f "$INSTALL_SCRIPT" || fail "Installer script not found: $INSTALL_SCRIPT"
test -f "$UNINSTALL_SCRIPT" || fail "Uninstaller script not found: $UNINSTALL_SCRIPT"

if [[ "$OS" == "Linux" && -n "$(command -v sudo || true)" ]]; then
  sudo() {
    command sudo -n "$@"
  }
  export -f sudo
fi

if [[ -n "$INSTALL_DIR" ]]; then
  INSTALL_DIR="$(normalize_path "$INSTALL_DIR")"
  if [[ -e "$INSTALL_DIR" && "$ALLOW_EXISTING_INSTALL_DIR" != "1" ]]; then
    fail "Install dir already exists: $INSTALL_DIR (use --allow-existing-install-dir if intentional)"
  fi
  mkdir -p "$INSTALL_DIR"
else
  INSTALL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencode-studio-e2e.XXXXXX")"
fi

PORT="$(pick_random_port)"
BASE_URL="http://127.0.0.1:${PORT}"

INSTALL_ARGS=(
  --repo "$REPO"
  --install-dir "$INSTALL_DIR"
  --host 127.0.0.1
  --port "$PORT"
)

if [[ "$OS" == "Linux" ]]; then
  INSTALL_ARGS+=(--mode "$MODE")
fi

if [[ -n "$VERSION" ]]; then
  INSTALL_ARGS+=(--version "$VERSION")
fi

if [[ "$WITH_FRONTEND" == "1" ]]; then
  INSTALL_ARGS+=(--with-frontend)
fi

log "Starting detailed Unix service flow test"
log "OS: $OS"
log "Install dir: $INSTALL_DIR"
log "Random port: $PORT"
log "Install mode: $MODE"
log "With frontend: $WITH_FRONTEND"

log "Step 1/6: install service"
bash "$INSTALL_SCRIPT" "${INSTALL_ARGS[@]}"
INSTALL_COMPLETED="1"

BIN_PATH="$INSTALL_DIR/bin/opencode-studio"
CONFIG_PATH="$INSTALL_DIR/opencode-studio.toml"
DIST_INDEX="$INSTALL_DIR/dist/index.html"

log "Step 2/6: validate installed files and config"
assert_path_exists "$BIN_PATH"
[[ -x "$BIN_PATH" ]] || fail "Binary is not executable: $BIN_PATH"
assert_path_exists "$CONFIG_PATH"
grep -Eq '^host[[:space:]]*=[[:space:]]*"127\.0\.0\.1"$' "$CONFIG_PATH" || fail "Config host check failed"
grep -Eq "^port[[:space:]]*=[[:space:]]*${PORT}$" "$CONFIG_PATH" || fail "Config port check failed"

if [[ "$WITH_FRONTEND" == "1" ]]; then
  assert_path_exists "$DIST_INDEX"
  grep -Eq '^ui_dir[[:space:]]*=' "$CONFIG_PATH" || fail "Expected ui_dir in config for --with-frontend"
else
  if grep -Eq '^ui_dir[[:space:]]*=' "$CONFIG_PATH"; then
    fail "ui_dir should not be present without --with-frontend"
  fi
fi

if [[ "$OS" == "Linux" ]]; then
  verify_linux_service_present
else
  verify_macos_service_present
fi

log "Step 3/6: wait for service health"
wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service health endpoint did not come up: $BASE_URL/health"
validate_health_payload "$BASE_URL"

log "Step 4/6: exercise service management commands"
if [[ "$OS" == "Linux" ]]; then
  manage_service_linux
else
  manage_service_macos
fi
validate_health_payload "$BASE_URL"

log "Step 5/6: uninstall service but keep install files"
bash "$UNINSTALL_SCRIPT" --install-dir "$INSTALL_DIR"

if [[ "$OS" == "Linux" ]]; then
  verify_linux_service_removed
else
  verify_macos_service_removed
fi

assert_path_exists "$INSTALL_DIR"
assert_path_exists "$BIN_PATH"
assert_path_exists "$CONFIG_PATH"

log "Step 6/6: uninstall service and remove install files"
bash "$UNINSTALL_SCRIPT" --install-dir "$INSTALL_DIR" --remove-install-dir
assert_path_not_exists "$INSTALL_DIR"

duration_secs="$(( $(date +%s) - START_EPOCH ))"
log "PASS: detailed Unix service flow test completed in ${duration_secs}s (port=${PORT})"
