#!/usr/bin/env bash
set -euo pipefail

REPO="canxin121/opencode-studio"
VERSION=""
UPGRADE_TO_VERSION=""
WITH_FRONTEND="0"
MODE="user"
INSTALL_DIR=""
ALLOW_EXISTING_INSTALL_DIR="0"
WAIT_TIMEOUT_SECS="90"
UPGRADE_VIA_BACKEND_API="0"
BACKEND_UPGRADE_RETRIES="4"

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
  --upgrade-to-version vX.Y.Z     Upgrade in-place to this version after install checks.
  --install-dir PATH              Install dir for test run (default: random temp dir).
  --allow-existing-install-dir    Allow using an existing install dir.
  --wait-timeout SECONDS          Health wait timeout (default: 90).
  --upgrade-via-backend-api       Trigger upgrade via backend API instead of reinstall script.
  -h, --help                      Show this help message.

What it validates:
  1) Install service with a random localhost port.
  2) Verify installed files and generated config values.
  3) Verify /health endpoint and response shape.
  4) Exercise service management operations (status/restart/stop/start).
  5) (Optional) Upgrade in-place to a target version and verify service health.
  6) Uninstall while keeping files, then verify files remain.
  7) Uninstall with --remove-install-dir, then verify files are removed.

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

normalize_semver() {
  local value="$1"
  value="${value#v}"
  printf '%s\n' "$value"
}

fetch_update_check_json() {
  local url="$1"
  curl -fsS --max-time 8 "$url/api/opencode-studio/update-check"
}

parse_update_check_snapshot() {
  local update_json="$1"

  python3 - "$update_json" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
service = payload.get("service") or {}

def scalar(value):
    if value is None:
        return ""
    return str(value).strip()

print(f"current={scalar(service.get('currentVersion'))}")
print(f"latest={scalar(service.get('latestVersion'))}")
print(f"asset_url={scalar(service.get('assetUrl'))}")
print(f"available={'1' if service.get('available') is True else '0'}")
PY
}

resolve_service_upgrade_asset_url() {
  local url="$1"
  local expected_tag="$2"
  local expected_semver=""
  local update_json=""
  local parsed=""
  local current=""
  local latest=""
  local asset_url=""
  local available=""
  local line=""
  local key=""
  local value=""

  expected_semver="$(normalize_semver "$expected_tag")"
  update_json="$(fetch_update_check_json "$url")"
  parsed="$(parse_update_check_snapshot "$update_json")"

  while IFS= read -r line; do
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      current) current="$value" ;;
      latest) latest="$value" ;;
      asset_url) asset_url="$value" ;;
      available) available="$value" ;;
    esac
  done <<<"$parsed"

  [[ "$latest" == "$expected_semver" ]] || fail "Update-check latestVersion mismatch. Expected $expected_semver, got '${latest:-<empty>}'"
  [[ "$available" == "1" ]] || fail "Update-check reports service.available=false for target $expected_semver (current=${current:-unknown})"
  [[ -n "$asset_url" ]] || fail "Update-check missing service.assetUrl for target $expected_semver"
  printf '%s\n' "$asset_url"
}

build_upgrade_payload() {
  local asset_url="$1"
  local target_tag="$2"

  python3 - "$asset_url" "$target_tag" <<'PY'
import json
import sys

asset_url = sys.argv[1]
target_tag = sys.argv[2]
target_version = target_tag.lstrip("vV")

print(json.dumps({
    "assetUrl": asset_url,
    "asset_url": asset_url,
    "targetVersion": target_version,
    "target_version": target_version,
}))
PY
}

post_json() {
  local endpoint="$1"
  local body="$2"
  local body_file=""
  local response_file=""
  local http_code=""
  local response_content_type=""
  local response_body=""

  body_file="$(mktemp)"
  response_file="$(mktemp)"
  printf '%s' "$body" >"$body_file"
  IFS=$'\t' read -r http_code response_content_type <<<"$(curl -sS --max-time 20 -X POST -H "Content-Type: application/json" --data-binary "@$body_file" -o "$response_file" -w '%{http_code}\t%{content_type}' "$endpoint" || true)"
  response_body="$(<"$response_file")"
  response_body="${response_body//$'\n'/ }"
  rm -f "$body_file" "$response_file"

  printf '%s\t%s\t%s\n' "$http_code" "$response_content_type" "$response_body"
}

response_looks_like_html() {
  local content_type="$1"
  local body="$2"
  local content_type_lc=""
  local trimmed=""
  local prefix=""

  content_type_lc="$(printf '%s' "$content_type" | tr '[:upper:]' '[:lower:]')"

  if [[ "$content_type_lc" == *"text/html"* ]]; then
    return 0
  fi

  trimmed="${body#"${body%%[![:space:]]*}"}"
  prefix="${trimmed:0:16}"
  prefix="$(printf '%s' "$prefix" | tr '[:upper:]' '[:lower:]')"
  [[ "$prefix" == "<html"* || "$prefix" == "<!doctype"* ]]
}

response_indicates_restarting() {
  local body="$1"
  local body_lc=""
  body_lc="$(printf '%s' "$body" | tr '[:upper:]' '[:lower:]')"
  [[ "$body_lc" == *"restarting"* ]]
}

run_reinstall_upgrade() {
  local target_version="$1"

  UPGRADE_ARGS=(
    --repo "$REPO"
    --version "$target_version"
    --install-dir "$INSTALL_DIR"
    --host 127.0.0.1
    --port "$PORT"
  )

  if [[ "$OS" == "Linux" ]]; then
    UPGRADE_ARGS+=(--mode "$MODE")
  fi

  if [[ "$WITH_FRONTEND" == "1" ]]; then
    UPGRADE_ARGS+=(--with-frontend)
  fi

  bash "$INSTALL_SCRIPT" "${UPGRADE_ARGS[@]}"
}

restart_service_after_reinstall_upgrade() {
  if [[ "$OS" == "Linux" ]]; then
    log "Restarting Linux service after installer fallback upgrade"
    linux_service_cmd restart opencode-studio
    return
  fi

  log "Restarting macOS service after installer fallback upgrade"
  if ! launchctl kickstart -k "gui/$(id -u)/$MACOS_LABEL" >/dev/null 2>&1; then
    log "macOS: kickstart failed, using unload/load fallback"
    launchctl unload "$MACOS_PLIST" >/dev/null 2>&1 || true
    launchctl load "$MACOS_PLIST"
  fi
}

trigger_backend_upgrade() {
  local url="$1"
  local asset_url="$2"
  local target_tag="$3"
  local payload=""
  local endpoint=""
  local result=""
  local http_code=""
  local response_content_type=""
  local response_body=""
  local rest=""
  local attempt_errors=()
  local attempt=""
  local retriable="0"
  local retry_wait_secs="2"
  local candidate_endpoints=(
    "/api/update"
    "/api/update/apply"
    "/api/service/update"
    "/api/opencode-studio/update-service"
    "/api/opencode-studio/update"
  )

  payload="$(build_upgrade_payload "$asset_url" "$target_tag")"

  for endpoint in "${candidate_endpoints[@]}"; do
    for attempt in $(seq 1 "$BACKEND_UPGRADE_RETRIES"); do
      result="$(post_json "$url$endpoint" "$payload")"
      http_code="${result%%$'\t'*}"
      rest="${result#*$'\t'}"
      response_content_type="${rest%%$'\t'*}"
      response_body="${rest#*$'\t'}"
      retriable="0"

      if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
        if response_looks_like_html "$response_content_type" "$response_body"; then
          attempt_errors+=("$endpoint -> HTTP $http_code (unexpected HTML response)")
          break
        fi
        log "Backend upgrade trigger accepted at $endpoint (HTTP $http_code)"
        return 0
      fi

      if [[ "$http_code" == "503" ]] && response_indicates_restarting "$response_body"; then
        retriable="1"
      fi

      if [[ "$http_code" == "503" || "$http_code" == "429" || "$http_code" == "502" || "$http_code" == "504" ]]; then
        retriable="1"
      fi

      if [[ "$http_code" == "404" || "$http_code" == "405" ]]; then
        attempt_errors+=("$endpoint -> HTTP $http_code")
        break
      fi

      if [[ "$retriable" == "1" && "$attempt" -lt "$BACKEND_UPGRADE_RETRIES" ]]; then
        log "Backend upgrade trigger not ready at $endpoint (HTTP $http_code), retrying (${attempt}/${BACKEND_UPGRADE_RETRIES})"
        sleep "$retry_wait_secs"
        continue
      fi

      attempt_errors+=("$endpoint -> HTTP $http_code (${response_body:-<empty>})")
      break
    done
  done

  log "Backend API trigger unavailable. Attempts: ${attempt_errors[*]:-none}"
  return 1
}

assert_running_service_version() {
  local url="$1"
  local expected_tag="$2"
  local timeout_secs="$3"
  local expected_semver=""
  local elapsed=0
  local update_json=""
  local current_version=""
  local latest_version=""
  local line=""
  local key=""
  local value=""

  expected_semver="$(normalize_semver "$expected_tag")"

  while ((elapsed < timeout_secs)); do
    update_json="$(fetch_update_check_json "$url" 2>/dev/null || true)"
    if [[ -n "$update_json" ]]; then
      current_version=""
      latest_version=""
      while IFS= read -r line; do
        key="${line%%=*}"
        value="${line#*=}"
        case "$key" in
          current) current_version="$value" ;;
          latest) latest_version="$value" ;;
        esac
      done < <(parse_update_check_snapshot "$update_json" 2>/dev/null || true)

      if [[ "$current_version" == "$expected_semver" ]]; then
        return 0
      fi
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  fail "Running service version mismatch after upgrade. Expected $expected_semver, got current=${current_version:-unknown}, latest=${latest_version:-unknown}"
}

extract_binary_version() {
  local bin_path="$1"
  local output=""

  output="$($bin_path --version 2>/dev/null || true)"
  if [[ "$output" =~ ([0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  fail "Failed to parse binary version from: $output"
}

assert_binary_version() {
  local bin_path="$1"
  local expected_tag="$2"
  local expected_semver=""
  local actual_semver=""

  expected_semver="$(normalize_semver "$expected_tag")"
  actual_semver="$(extract_binary_version "$bin_path")"

  [[ "$actual_semver" == "$expected_semver" ]] || fail "Binary version mismatch. Expected $expected_semver, got $actual_semver"
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
  grep -q '<key>EnvironmentVariables</key>' "$MACOS_PLIST" || fail "launchd plist missing EnvironmentVariables"
  grep -q '<key>PATH</key>' "$MACOS_PLIST" || fail "launchd plist missing PATH environment"
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
    --upgrade-to-version) UPGRADE_TO_VERSION="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --allow-existing-install-dir) ALLOW_EXISTING_INSTALL_DIR="1"; shift ;;
    --wait-timeout) WAIT_TIMEOUT_SECS="$2"; shift 2 ;;
    --upgrade-via-backend-api) UPGRADE_VIA_BACKEND_API="1"; shift ;;
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

if [[ -n "$UPGRADE_TO_VERSION" && -z "$VERSION" ]]; then
  fail "--upgrade-to-version requires --version so the test can validate upgrade behavior"
fi

if [[ -n "$UPGRADE_TO_VERSION" && "$UPGRADE_TO_VERSION" == "$VERSION" ]]; then
  fail "--upgrade-to-version must differ from --version"
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
if [[ -n "$VERSION" ]]; then
  log "Install version: $VERSION"
fi
if [[ -n "$UPGRADE_TO_VERSION" ]]; then
  log "Upgrade target version: $UPGRADE_TO_VERSION"
fi
log "Upgrade strategy: $( [[ "$UPGRADE_VIA_BACKEND_API" == "1" ]] && printf 'backend API' || printf 'reinstall script' )"

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

if [[ -n "$VERSION" ]]; then
  assert_binary_version "$BIN_PATH" "$VERSION"
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

if [[ -n "$UPGRADE_TO_VERSION" ]]; then
  log "Step 5/7: upgrade service in-place to $UPGRADE_TO_VERSION"
  USED_INSTALLER_FALLBACK="0"
  if [[ "$UPGRADE_VIA_BACKEND_API" == "1" ]]; then
    FALLBACK_REASON=""
    UPGRADE_ASSET_URL=""
    if UPGRADE_ASSET_URL="$(resolve_service_upgrade_asset_url "$BASE_URL" "$UPGRADE_TO_VERSION" 2>/dev/null)"; then
      log "Resolved service upgrade package from backend update-check"
      if ! trigger_backend_upgrade "$BASE_URL" "$UPGRADE_ASSET_URL" "$UPGRADE_TO_VERSION"; then
        FALLBACK_REASON="backend API trigger unavailable"
      fi
    else
      FALLBACK_REASON="update-check precondition failed"
    fi

    if [[ -n "$FALLBACK_REASON" ]]; then
      log "Falling back to installer-based in-place upgrade: $FALLBACK_REASON"
      run_reinstall_upgrade "$UPGRADE_TO_VERSION"
      USED_INSTALLER_FALLBACK="1"
    fi
  else
    run_reinstall_upgrade "$UPGRADE_TO_VERSION"
    USED_INSTALLER_FALLBACK="1"
  fi

  if [[ "$USED_INSTALLER_FALLBACK" == "1" ]]; then
    restart_service_after_reinstall_upgrade
  fi

  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service health endpoint did not recover after upgrade"
  validate_health_payload "$BASE_URL"
  assert_running_service_version "$BASE_URL" "$UPGRADE_TO_VERSION" "$WAIT_TIMEOUT_SECS"
  assert_binary_version "$BIN_PATH" "$UPGRADE_TO_VERSION"

  if [[ "$OS" == "Linux" ]]; then
    manage_service_linux
  else
    manage_service_macos
  fi
  validate_health_payload "$BASE_URL"
fi

log "Step 6/7: uninstall service but keep install files"
bash "$UNINSTALL_SCRIPT" --install-dir "$INSTALL_DIR"

if [[ "$OS" == "Linux" ]]; then
  verify_linux_service_removed
else
  verify_macos_service_removed
fi

assert_path_exists "$INSTALL_DIR"
assert_path_exists "$BIN_PATH"
assert_path_exists "$CONFIG_PATH"

log "Step 7/7: uninstall service and remove install files"
bash "$UNINSTALL_SCRIPT" --install-dir "$INSTALL_DIR" --remove-install-dir
assert_path_not_exists "$INSTALL_DIR"

duration_secs="$(( $(date +%s) - START_EPOCH ))"
log "PASS: detailed Unix service flow test completed in ${duration_secs}s (port=${PORT})"
