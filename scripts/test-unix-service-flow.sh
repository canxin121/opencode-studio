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
USAGE_CHECKS="0"
UI_CLICKS="0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
INSTALL_SCRIPT="$SCRIPT_DIR/install-service.sh"
UNINSTALL_SCRIPT="$SCRIPT_DIR/uninstall-service.sh"
API_SMOKE_SCRIPT="$SCRIPT_DIR/service-api-smoke.sh"
USAGE_SMOKE_SCRIPT="$SCRIPT_DIR/studio-usage-smoke.sh"
UI_CLICK_SCRIPT="$SCRIPT_DIR/studio-ui-click-e2e.mjs"

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
  --usage-checks                  Run UI/session readiness checks (requires OpenCode backend).
  --ui-clicks                      Run Playwright UI click flow (requires --with-frontend).
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
  3) Verify /health and run additional API smoke tests.
  4) Exercise service management operations (status/restart/stop/start) and re-run API tests.
  5) (Optional) Upgrade in-place to a target version, verify health + API tests.
  6) Uninstall while keeping files, verify API is unavailable.
  7) Reinstall, verify health + API tests.
  8) Uninstall with --remove-install-dir, verify files removed + API unavailable.

Notes:
  - Linux/macOS only.
  - Requires: opencode, curl, python3. UI clicks additionally require: node + Playwright.
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

can_bind_port() {
  local port="$1"
  [[ -n "$port" ]] || return 0
  python3 - "$port" <<'PY'
import socket
import sys

port = int(sys.argv[1])
s = socket.socket()
try:
    s.bind(("127.0.0.1", port))
except OSError:
    raise SystemExit(1)
finally:
    try:
        s.close()
    except Exception:
        pass
PY
}

dump_port_diagnostics() {
  local port="$1"
  [[ -n "$port" ]] || return 0
  log "Port diagnostics for :$port"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep -E ":${port}\\b" || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -E "\\.${port}\\s" || true
  fi
}

wait_for_port_free() {
  local port="$1"
  local timeout_secs="$2"
  local elapsed=0

  [[ -n "$port" ]] || return 0
  while ((elapsed < timeout_secs)); do
    if can_bind_port "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

assert_port_free() {
  local port="$1"
  local timeout_secs="$2"
  [[ -n "$port" ]] || return 0

  if ! wait_for_port_free "$port" "$timeout_secs"; then
    dump_port_diagnostics "$port"
    fail "Port $port is still not bindable after ${timeout_secs}s (likely leaked listener)"
  fi
  log "Port released: :$port"
}

read_opencode_port() {
  local url="$1"
  local health_json=""
  health_json="$(curl -fsS --max-time 6 "$url/health" 2>/dev/null || true)"
  [[ -n "$health_json" ]] || { printf '%s\n' ""; return 0; }
  python3 - "$health_json" <<'PY'
import json
import sys

p = json.loads(sys.argv[1])
port = p.get('openCodePort')
if isinstance(port, int):
    print(port)
elif isinstance(port, str) and port.strip().isdigit():
    print(port.strip())
else:
    print('')
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

normalize_release_tag() {
  local value="$1"

  if [[ "$value" == v* ]]; then
    printf '%s\n' "$value"
  else
    printf 'v%s\n' "$value"
  fi
}

urlencode_path_segment() {
  local value="$1"
  if [[ "$value" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf '%s' "$value"
    return 0
  fi

  need python3
  python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$value"
}

detect_backend_target_triple() {
  local machine=""

  machine="$(uname -m)"

  case "$OS" in
    Linux)
      case "$machine" in
        x86_64|amd64) printf '%s\n' "x86_64-unknown-linux-musl" ;;
        aarch64|arm64) printf '%s\n' "aarch64-unknown-linux-musl" ;;
        armv7l|armv7) printf '%s\n' "armv7-unknown-linux-musleabihf" ;;
        i686|i386) printf '%s\n' "i686-unknown-linux-musl" ;;
        *) return 1 ;;
      esac
      ;;
    Darwin)
      case "$machine" in
        x86_64|amd64) printf '%s\n' "x86_64-apple-darwin" ;;
        arm64|aarch64) printf '%s\n' "aarch64-apple-darwin" ;;
        *) return 1 ;;
      esac
      ;;
    *)
      return 1
      ;;
  esac
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
print(f"target={scalar(service.get('target'))}")
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
  local target=""
  local resolved_target=""
  local release_tag=""
  local canonical_asset_name=""
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
      target) target="$value" ;;
      available) available="$value" ;;
    esac
  done <<<"$parsed"

  [[ "$latest" == "$expected_semver" ]] || fail "Update-check latestVersion mismatch. Expected $expected_semver, got '${latest:-<empty>}'"
  [[ "$available" == "1" ]] || fail "Update-check reports service.available=false for target $expected_semver (current=${current:-unknown})"

  release_tag="$(normalize_release_tag "$expected_tag")"
  resolved_target="$target"
  if [[ -z "$resolved_target" ]]; then
    resolved_target="$(detect_backend_target_triple || true)"
  fi
  [[ -n "$resolved_target" ]] || fail "Unable to resolve backend target triple for service upgrade"

  canonical_asset_name="opencode-studio-backend-${resolved_target}-${release_tag}.tar.gz"
  asset_url="https://github.com/${REPO}/releases/download/$(urlencode_path_segment "$release_tag")/$(urlencode_path_segment "$canonical_asset_name")"
  printf '%s\n' "$asset_url"
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

terminal_create_session() {
  local url="$1"
  local cwd="$2"
  local payload=""
  local response=""
  local session_id=""

  payload="$(python3 - "$cwd" <<'PY'
import json
import sys

print(json.dumps({"cwd": sys.argv[1], "cols": 120, "rows": 40}))
PY
)"

  response="$(curl -fsS --max-time 20 -X POST -H "Content-Type: application/json" --data "$payload" "$url/api/terminal/create")" || fail "Failed to create backend terminal session"
  session_id="$(python3 - "$response" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
sid = payload.get("sessionId") or payload.get("session_id") or ""
print(sid)
PY
)"
  [[ -n "$session_id" ]] || fail "Backend terminal session id missing"
  printf '%s\n' "$session_id"
}

terminal_send_input() {
  local url="$1"
  local session_id="$2"
  local input_text="$3"
  local payload_file=""

  payload_file="$(mktemp)"
  printf '%s' "$input_text" >"$payload_file"
  if ! curl -fsS --max-time 20 -X POST -H "Content-Type: text/plain" --data-binary "@$payload_file" "$url/api/terminal/$session_id/input" >/dev/null; then
    rm -f "$payload_file"
    fail "Failed to send backend terminal input"
  fi
  rm -f "$payload_file"
}

terminal_close_session() {
  local url="$1"
  local session_id="$2"

  curl -sS --max-time 10 -X DELETE "$url/api/terminal/$session_id" >/dev/null 2>&1 || true
}

restart_service_once() {
  if [[ "$OS" == "Linux" ]]; then
    linux_service_cmd reset-failed opencode-studio >/dev/null 2>&1 || true
    linux_service_cmd restart opencode-studio
    return
  fi

  macos_restart_service
}

trigger_backend_upgrade() {
  local url="$1"
  local asset_url="$2"
  local target_tag="$3"
  local marker_file="$INSTALL_DIR/.backend-upgrade.marker"
  local log_file="$INSTALL_DIR/.backend-upgrade.log"
  local helper_script="$INSTALL_DIR/.backend-upgrade.sh"
  local staged_binary="$INSTALL_DIR/bin/opencode-studio.next"
  local archive_file="$INSTALL_DIR/bin/.backend-upgrade.tar.gz"
  local extract_dir="$INSTALL_DIR/bin/.backend-upgrade.extract"
  local session_id=""
  local elapsed=0
  local status=""

  cat >"$helper_script" <<EOF
#!/usr/bin/env bash
set -u
status=0
(
  set -euo pipefail
  rm -f "$archive_file" "$marker_file"
  rm -rf "$extract_dir"
  curl -fsSL "$asset_url" -o "$archive_file"
  mkdir -p "$extract_dir"
  tar -xzf "$archive_file" -C "$extract_dir"
  chmod +x "$extract_dir/opencode-studio"
  mv -f "$extract_dir/opencode-studio" "$staged_binary"
  rm -rf "$extract_dir" "$archive_file"
) >"$log_file" 2>&1
status=\$?
printf '%s' "\$status" >"$marker_file"
exit "\$status"
EOF
  chmod +x "$helper_script"
  rm -f "$marker_file"

  session_id="$(terminal_create_session "$url" "$INSTALL_DIR")"
  terminal_send_input "$url" "$session_id" "bash \"$helper_script\""$'\n'
  terminal_send_input "$url" "$session_id" "exit"$'\n'

  while ((elapsed < WAIT_TIMEOUT_SECS)); do
    if [[ -f "$marker_file" ]]; then
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  terminal_close_session "$url" "$session_id"

  [[ -f "$marker_file" ]] || fail "Backend terminal upgrade did not complete in ${WAIT_TIMEOUT_SECS}s"
  status="$(tr -d '[:space:]' <"$marker_file")"
  [[ "$status" == "0" ]] || fail "Backend terminal upgrade failed with status ${status:-unknown} (log: $log_file)"
  [[ -f "$staged_binary" ]] || fail "Backend terminal upgrade did not produce staged binary: $staged_binary"

  mv -f "$staged_binary" "$BIN_PATH"
  chmod +x "$BIN_PATH"
  rm -f "$helper_script" "$marker_file"
  log "Backend upgrade trigger completed for target $target_tag"
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
  linux_service_cmd reset-failed opencode-studio >/dev/null 2>&1 || true
  linux_service_cmd restart opencode-studio
  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service failed to become healthy after restart"

  if [[ "$USAGE_CHECKS" == "1" ]]; then
    EXTRA_ARGS=()
    if [[ "$WITH_FRONTEND" == "1" ]]; then
      EXTRA_ARGS+=(--require-ui)
    fi
    bash "$USAGE_SMOKE_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" "${EXTRA_ARGS[@]}"
    OPENCODE_PORT_LAST="$(read_opencode_port "$BASE_URL" || true)"
    if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
      log "Captured openCodePort=$OPENCODE_PORT_LAST"
    fi
  fi

  log "Linux: stopping service"
  linux_service_cmd stop opencode-studio
  wait_for_health_down "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service still reachable after stop"

  if [[ "$USAGE_CHECKS" == "1" ]]; then
    assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"
    if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
      assert_port_free "$OPENCODE_PORT_LAST" "$WAIT_TIMEOUT_SECS"
    fi
  fi

  log "Linux: starting service"
  linux_service_cmd reset-failed opencode-studio >/dev/null 2>&1 || true
  linux_service_cmd start opencode-studio
  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service failed to become healthy after start"

  if [[ "$USAGE_CHECKS" == "1" ]]; then
    EXTRA_ARGS=()
    if [[ "$WITH_FRONTEND" == "1" ]]; then
      EXTRA_ARGS+=(--require-ui)
    fi
    bash "$USAGE_SMOKE_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" "${EXTRA_ARGS[@]}"
    OPENCODE_PORT_LAST="$(read_opencode_port "$BASE_URL" || true)"
    if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
      log "Captured openCodePort=$OPENCODE_PORT_LAST"
    fi
  fi
}

MACOS_LABEL="cn.cxits.opencode-studio"
MACOS_PLIST="$HOME/Library/LaunchAgents/${MACOS_LABEL}.plist"
MACOS_ACTIVE_DOMAIN=""

dump_macos_launchd_diagnostics() {
  local header="${1:-macOS launchd diagnostics}"
  log "$header"
  launchctl print "gui/$(id -u)/$MACOS_LABEL" 2>/dev/null || true
  launchctl print "user/$(id -u)/$MACOS_LABEL" 2>/dev/null || true
  launchctl list 2>/dev/null | grep -F "$MACOS_LABEL" || true
}

macos_launchctl_domains() {
  local uid
  uid="$(id -u)"
  printf 'gui/%s\n' "$uid"
  printf 'user/%s\n' "$uid"
}

macos_detect_service_domain() {
  local domain=""

  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    if launchctl print "$domain/$MACOS_LABEL" >/dev/null 2>&1; then
      MACOS_ACTIVE_DOMAIN="$domain"
      return 0
    fi
  done < <(macos_launchctl_domains)

  MACOS_ACTIVE_DOMAIN=""
  return 1
}

macos_detect_service_legacy_list() {
  launchctl list 2>/dev/null | grep -q "$MACOS_LABEL"
}

macos_enable_service_known_domains() {
  local domain=""

  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    launchctl enable "$domain/$MACOS_LABEL" >/dev/null 2>&1 || true
  done < <(macos_launchctl_domains)
}

macos_bootout_service() {
  local domain=""

  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    launchctl bootout "$domain/$MACOS_LABEL" >/dev/null 2>&1 || true
    launchctl bootout "$domain" "$MACOS_PLIST" >/dev/null 2>&1 || true
  done < <(macos_launchctl_domains)

  launchctl unload "$MACOS_PLIST" >/dev/null 2>&1 || true
}

macos_bootstrap_service() {
  local domain=""

  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    if launchctl bootstrap "$domain" "$MACOS_PLIST" >/dev/null 2>&1; then
      MACOS_ACTIVE_DOMAIN="$domain"
      launchctl enable "$domain/$MACOS_LABEL" >/dev/null 2>&1 || true
      return 0
    fi
  done < <(macos_launchctl_domains)

  launchctl load "$MACOS_PLIST" >/dev/null 2>&1 || return 1
  macos_enable_service_known_domains
  macos_detect_service_domain || true
  return 0
}

macos_restart_service() {
  if ! macos_detect_service_domain; then
    log "macOS: service not currently registered, bootstrapping"
    macos_bootstrap_service || fail "macOS launchctl bootstrap/load failed"
  fi

  if [[ -n "$MACOS_ACTIVE_DOMAIN" ]]; then
    launchctl enable "$MACOS_ACTIVE_DOMAIN/$MACOS_LABEL" >/dev/null 2>&1 || true
    if launchctl kickstart -k "$MACOS_ACTIVE_DOMAIN/$MACOS_LABEL" >/dev/null 2>&1; then
      return 0
    fi
    launchctl kickstart "$MACOS_ACTIVE_DOMAIN/$MACOS_LABEL" >/dev/null 2>&1 || true
  fi

  launchctl start "$MACOS_LABEL" >/dev/null 2>&1 || true
}

verify_macos_service_present() {
  test -f "$MACOS_PLIST" || fail "Missing launchd plist: $MACOS_PLIST"
  grep -q '<key>EnvironmentVariables</key>' "$MACOS_PLIST" || fail "launchd plist missing EnvironmentVariables"
  grep -q '<key>PATH</key>' "$MACOS_PLIST" || fail "launchd plist missing PATH environment"
  grep -q '<key>Label</key>' "$MACOS_PLIST" || fail "launchd plist missing Label"
  grep -q "<string>$MACOS_LABEL</string>" "$MACOS_PLIST" || fail "launchd plist label mismatch"
  grep -q '<key>ProgramArguments</key>' "$MACOS_PLIST" || fail "launchd plist missing ProgramArguments"
  grep -q '<key>RunAtLoad</key>' "$MACOS_PLIST" || fail "launchd plist missing RunAtLoad"
  grep -q '<key>KeepAlive</key>' "$MACOS_PLIST" || fail "launchd plist missing KeepAlive"

  if macos_detect_service_domain; then
    launchctl print "$MACOS_ACTIVE_DOMAIN/$MACOS_LABEL" 2>/dev/null | grep -Eq 'state = (running|spawn scheduled|waiting)' || \
      log "macOS: launchctl state not active yet in $MACOS_ACTIVE_DOMAIN (continuing)"
  elif macos_detect_service_legacy_list; then
    log "macOS: service label detected via legacy launchctl list"
  else
    log "macOS: service label not yet visible in launchctl output; relying on health checks"
  fi
}

verify_macos_service_removed() {
  test ! -f "$MACOS_PLIST" || fail "launchd plist still exists: $MACOS_PLIST"
}

manage_service_macos() {
  log "macOS: checking launchd registration"
  if macos_detect_service_domain; then
    log "macOS: service registered in $MACOS_ACTIVE_DOMAIN"
  elif macos_detect_service_legacy_list; then
    log "macOS: service label visible via legacy launchctl list"
  else
    log "macOS: service label not visible yet; continuing with bootstrap/restart flow"
  fi

  log "macOS: restarting service"
  macos_restart_service
  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service failed to become healthy after restart"

  if [[ "$USAGE_CHECKS" == "1" ]]; then
    EXTRA_ARGS=()
    if [[ "$WITH_FRONTEND" == "1" ]]; then
      EXTRA_ARGS+=(--require-ui)
    fi
    bash "$USAGE_SMOKE_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" "${EXTRA_ARGS[@]}"
    OPENCODE_PORT_LAST="$(read_opencode_port "$BASE_URL" || true)"
    if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
      log "Captured openCodePort=$OPENCODE_PORT_LAST"
    fi
  fi

  log "macOS: stopping service"
  macos_bootout_service
  wait_for_health_down "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service still reachable after unload"

  if [[ "$USAGE_CHECKS" == "1" ]]; then
    assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"
    if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
      assert_port_free "$OPENCODE_PORT_LAST" "$WAIT_TIMEOUT_SECS"
    fi
  fi

  if macos_detect_service_domain; then
    log "macOS: service still listed after bootout in $MACOS_ACTIVE_DOMAIN (continuing with start checks)"
  fi

  log "macOS: starting service"
  macos_bootstrap_service || fail "Failed to bootstrap/load launchd service"
  if ! macos_detect_service_domain; then
    log "macOS: launchctl domain still not visible after bootstrap/load; verifying via health endpoint"
  fi
  macos_restart_service
  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service failed to become healthy after load"

  if [[ "$USAGE_CHECKS" == "1" ]]; then
    EXTRA_ARGS=()
    if [[ "$WITH_FRONTEND" == "1" ]]; then
      EXTRA_ARGS+=(--require-ui)
    fi
    bash "$USAGE_SMOKE_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" "${EXTRA_ARGS[@]}"
    OPENCODE_PORT_LAST="$(read_opencode_port "$BASE_URL" || true)"
    if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
      log "Captured openCodePort=$OPENCODE_PORT_LAST"
    fi
  fi
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
    --usage-checks) USAGE_CHECKS="1"; shift ;;
    --ui-clicks) UI_CLICKS="1"; USAGE_CHECKS="1"; shift ;;
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
test -f "$API_SMOKE_SCRIPT" || fail "API smoke script not found: $API_SMOKE_SCRIPT"
test -f "$USAGE_SMOKE_SCRIPT" || fail "Usage smoke script not found: $USAGE_SMOKE_SCRIPT"

if [[ "$UI_CLICKS" == "1" ]]; then
  need node
  test -f "$UI_CLICK_SCRIPT" || fail "UI click script not found: $UI_CLICK_SCRIPT"
  if [[ "$WITH_FRONTEND" != "1" ]]; then
    fail "--ui-clicks requires --with-frontend"
  fi
fi

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
log "Usage checks: $USAGE_CHECKS"
log "UI clicks: $UI_CLICKS"
if [[ -n "$VERSION" ]]; then
  log "Install version: $VERSION"
fi
if [[ -n "$UPGRADE_TO_VERSION" ]]; then
  log "Upgrade target version: $UPGRADE_TO_VERSION"
fi
log "Upgrade strategy: $( [[ "$UPGRADE_VIA_BACKEND_API" == "1" ]] && printf 'backend API' || printf 'reinstall script' )"

log "Step 1/8: install service"
bash "$INSTALL_SCRIPT" "${INSTALL_ARGS[@]}"
INSTALL_COMPLETED="1"

BIN_PATH="$INSTALL_DIR/bin/opencode-studio"
CONFIG_PATH="$INSTALL_DIR/opencode-studio.toml"
DIST_INDEX="$INSTALL_DIR/dist/index.html"

log "Step 2/8: validate installed files and config"
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

log "Step 3/8: wait for service health"
wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service health endpoint did not come up: $BASE_URL/health"
validate_health_payload "$BASE_URL"
bash "$API_SMOKE_SCRIPT" --base-url "$BASE_URL" --cwd "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS"

if [[ "$USAGE_CHECKS" == "1" ]]; then
  EXTRA_ARGS=()
  if [[ "$WITH_FRONTEND" == "1" ]]; then
    EXTRA_ARGS+=(--require-ui)
  fi
  bash "$USAGE_SMOKE_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" "${EXTRA_ARGS[@]}"
  if [[ "$UI_CLICKS" == "1" ]]; then
    node "$UI_CLICK_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" --label "service-install"
  fi
  OPENCODE_PORT_LAST="$(read_opencode_port "$BASE_URL" || true)"
  if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
    log "Captured openCodePort=$OPENCODE_PORT_LAST"
  fi
fi

log "Step 4/8: exercise service management commands"
if [[ "$OS" == "Linux" ]]; then
  manage_service_linux
else
  manage_service_macos
fi
validate_health_payload "$BASE_URL"
bash "$API_SMOKE_SCRIPT" --base-url "$BASE_URL" --cwd "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS"

if [[ "$USAGE_CHECKS" == "1" ]]; then
  EXTRA_ARGS=()
  if [[ "$WITH_FRONTEND" == "1" ]]; then
    EXTRA_ARGS+=(--require-ui)
  fi
  bash "$USAGE_SMOKE_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" "${EXTRA_ARGS[@]}"
  if [[ "$UI_CLICKS" == "1" ]]; then
    node "$UI_CLICK_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" --label "service-manage"
  fi
  OPENCODE_PORT_LAST="$(read_opencode_port "$BASE_URL" || true)"
  if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
    log "Captured openCodePort=$OPENCODE_PORT_LAST"
  fi
fi

if [[ -n "$UPGRADE_TO_VERSION" ]]; then
  log "Step 5/8: upgrade service in-place to $UPGRADE_TO_VERSION"
  if [[ "$UPGRADE_VIA_BACKEND_API" == "1" ]]; then
    UPGRADE_ASSET_URL="$(resolve_service_upgrade_asset_url "$BASE_URL" "$UPGRADE_TO_VERSION")"
    log "Resolved service upgrade package from backend update-check"
    trigger_backend_upgrade "$BASE_URL" "$UPGRADE_ASSET_URL" "$UPGRADE_TO_VERSION"
    restart_service_once
  else
    run_reinstall_upgrade "$UPGRADE_TO_VERSION"
  fi

  wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service health endpoint did not recover after upgrade"
  validate_health_payload "$BASE_URL"
  bash "$API_SMOKE_SCRIPT" --base-url "$BASE_URL" --cwd "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS"

  if [[ "$USAGE_CHECKS" == "1" ]]; then
    EXTRA_ARGS=()
    if [[ "$WITH_FRONTEND" == "1" ]]; then
      EXTRA_ARGS+=(--require-ui)
    fi
    bash "$USAGE_SMOKE_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" "${EXTRA_ARGS[@]}"
    if [[ "$UI_CLICKS" == "1" ]]; then
      node "$UI_CLICK_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" --label "service-upgrade"
    fi
    OPENCODE_PORT_LAST="$(read_opencode_port "$BASE_URL" || true)"
    if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
      log "Captured openCodePort=$OPENCODE_PORT_LAST"
    fi
  fi
  assert_running_service_version "$BASE_URL" "$UPGRADE_TO_VERSION" "$WAIT_TIMEOUT_SECS"
  assert_binary_version "$BIN_PATH" "$UPGRADE_TO_VERSION"

  if [[ "$OS" == "Linux" ]]; then
    manage_service_linux
  else
    manage_service_macos
  fi
  validate_health_payload "$BASE_URL"
  bash "$API_SMOKE_SCRIPT" --base-url "$BASE_URL" --cwd "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS"

  if [[ "$USAGE_CHECKS" == "1" ]]; then
    EXTRA_ARGS=()
    if [[ "$WITH_FRONTEND" == "1" ]]; then
      EXTRA_ARGS+=(--require-ui)
    fi
    bash "$USAGE_SMOKE_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" "${EXTRA_ARGS[@]}"
    if [[ "$UI_CLICKS" == "1" ]]; then
      node "$UI_CLICK_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" --label "service-upgrade-manage"
    fi
    OPENCODE_PORT_LAST="$(read_opencode_port "$BASE_URL" || true)"
    if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
      log "Captured openCodePort=$OPENCODE_PORT_LAST"
    fi
  fi
fi

log "Step 6/8: uninstall service but keep install files"
bash "$UNINSTALL_SCRIPT" --install-dir "$INSTALL_DIR"

wait_for_health_down "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service still reachable after uninstall"

if [[ "$USAGE_CHECKS" == "1" ]]; then
  assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"
  if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
    assert_port_free "$OPENCODE_PORT_LAST" "$WAIT_TIMEOUT_SECS"
  fi
fi

if [[ "$OS" == "Linux" ]]; then
  verify_linux_service_removed
else
  verify_macos_service_removed
fi

assert_path_exists "$INSTALL_DIR"
assert_path_exists "$BIN_PATH"
assert_path_exists "$CONFIG_PATH"

log "Step 7/8: reinstall service and re-run API tests"
REINSTALL_VERSION="$VERSION"
if [[ -n "$UPGRADE_TO_VERSION" ]]; then
  REINSTALL_VERSION="$UPGRADE_TO_VERSION"
fi

REINSTALL_ARGS=(
  --repo "$REPO"
  --install-dir "$INSTALL_DIR"
  --host 127.0.0.1
  --port "$PORT"
)
if [[ "$OS" == "Linux" ]]; then
  REINSTALL_ARGS+=(--mode "$MODE")
fi
if [[ -n "$REINSTALL_VERSION" ]]; then
  REINSTALL_ARGS+=(--version "$REINSTALL_VERSION")
fi
if [[ "$WITH_FRONTEND" == "1" ]]; then
  REINSTALL_ARGS+=(--with-frontend)
fi

bash "$INSTALL_SCRIPT" "${REINSTALL_ARGS[@]}"
if [[ "$OS" == "Darwin" ]]; then
  # Ensure service is explicitly started after reinstall.
  macos_restart_service
fi

if ! wait_for_health_up "$BASE_URL" "$WAIT_TIMEOUT_SECS"; then
  if [[ "$OS" == "Darwin" ]]; then
    dump_macos_launchd_diagnostics "Service failed to become healthy after reinstall"
    log "Recent unified logs (opencode-studio, last 2m)"
    log show --style syslog --predicate 'process == "opencode-studio"' --last 2m 2>/dev/null || true
  fi
  fail "Service health endpoint did not come up after reinstall"
fi
validate_health_payload "$BASE_URL"
bash "$API_SMOKE_SCRIPT" --base-url "$BASE_URL" --cwd "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS"

if [[ "$USAGE_CHECKS" == "1" ]]; then
  EXTRA_ARGS=()
  if [[ "$WITH_FRONTEND" == "1" ]]; then
    EXTRA_ARGS+=(--require-ui)
  fi
  bash "$USAGE_SMOKE_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" "${EXTRA_ARGS[@]}"
  if [[ "$UI_CLICKS" == "1" ]]; then
    node "$UI_CLICK_SCRIPT" --base-url "$BASE_URL" --directory "$INSTALL_DIR" --timeout "$WAIT_TIMEOUT_SECS" --label "service-reinstall"
  fi
  OPENCODE_PORT_LAST="$(read_opencode_port "$BASE_URL" || true)"
  if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
    log "Captured openCodePort=$OPENCODE_PORT_LAST"
  fi
fi

if [[ -n "$REINSTALL_VERSION" ]]; then
  assert_binary_version "$BIN_PATH" "$REINSTALL_VERSION"
fi

log "Step 8/8: uninstall service and remove install files"
bash "$UNINSTALL_SCRIPT" --install-dir "$INSTALL_DIR" --remove-install-dir
wait_for_health_down "$BASE_URL" "$WAIT_TIMEOUT_SECS" || fail "Service still reachable after uninstall --remove-install-dir"

if [[ "$USAGE_CHECKS" == "1" ]]; then
  assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"
  if [[ -n "${OPENCODE_PORT_LAST:-}" ]]; then
    assert_port_free "$OPENCODE_PORT_LAST" "$WAIT_TIMEOUT_SECS"
  fi
fi
assert_path_not_exists "$INSTALL_DIR"

duration_secs="$(( $(date +%s) - START_EPOCH ))"
log "PASS: detailed Unix service flow test completed in ${duration_secs}s (port=${PORT})"
