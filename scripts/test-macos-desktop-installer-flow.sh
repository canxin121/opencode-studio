#!/usr/bin/env bash
set -euo pipefail

REPO="canxin121/opencode-studio"
VERSION=""
UPGRADE_TO_VERSION=""
PORT="3210"
WAIT_TIMEOUT_SECS="180"
INSTALL_ROOT="${HOME}/Applications"
APP_BUNDLE_NAME="OpenCode Studio.app"
APP_PATH="${INSTALL_ROOT}/${APP_BUNDLE_NAME}"
KEEP_FILES="0"
UI_CLICKS="0"
USE_CEF="0"
APP_MAIN_PID=""
APP_LAUNCH_LOG_PATH=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
USAGE_SMOKE_SCRIPT="$SCRIPT_DIR/studio-usage-smoke.sh"
UI_CLICK_SCRIPT="$SCRIPT_DIR/studio-ui-click-e2e.mjs"

usage() {
  cat <<'EOF'
Usage:
  test-macos-desktop-installer-flow.sh --version vX.Y.Z --upgrade-to-version vX.Y.Z [options]

Options:
  --repo owner/repo                 Release source repo (default: canxin121/opencode-studio).
  --version vX.Y.Z                  Install this desktop release first (required).
  --upgrade-to-version vX.Y.Z       Upgrade by replacing the .app with this version (required).
  --port PORT                       Desktop backend port to expect (default: 3210).
  --wait-timeout SECONDS            Readiness/teardown timeout (default: 180).
  --keep-files                      Keep downloaded installers and app support dirs.
  --ui-clicks                        Run Playwright UI click flow (requires CEF desktop DMGs with CDP; fails if unavailable).

What it validates:
  1) Download + "install" desktop app from DMG (copy .app).
  2) Launch app and validate backend + UI + session API via studio-usage-smoke.sh.
  3) Quit app and assert ports released (Studio + OpenCode).
  4) Upgrade by replacing .app with newer DMG and repeat checks.
  5) Uninstall by removing .app, then reinstall latest and repeat checks.

Notes:
  - macOS only.
  - Requires: curl, hdiutil, python3. UI clicks additionally require: node + Playwright.
  - OpenCode CLI (`opencode`) must be installed on PATH (desktop backend spawns it).
EOF
}

log() {
  printf '[desktop-e2e %s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"
}

normalize_release_tag() {
  local value="$1"
  if [[ "$value" == v* ]]; then
    printf '%s\n' "$value"
  else
    printf 'v%s\n' "$value"
  fi
}

detect_target_triple() {
  local machine
  machine="$(uname -m)"
  case "$machine" in
    arm64|aarch64) printf '%s\n' "aarch64-apple-darwin" ;;
    x86_64|amd64) printf '%s\n' "x86_64-apple-darwin" ;;
    *) return 1 ;;
  esac
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

pick_free_port() {
  python3 - <<'PY'
import socket

s = socket.socket()
s.bind(("127.0.0.1", 0))
port = s.getsockname()[1]
s.close()
print(port)
PY
}

try_wait_cdp_ready() {
  local port="$1"
  local timeout_secs="$2"
  local end=$((SECONDS + timeout_secs))
  local last_err=""
  local host=""
  local url=""
  local base=""

  CDP_BASE_URL=""
  CDP_LAST_ERROR=""

  while ((SECONDS < end)); do
    if [[ -n "${APP_MAIN_PID:-}" ]] && ! kill -0 "$APP_MAIN_PID" >/dev/null 2>&1; then
      last_err="app exited (pid ${APP_MAIN_PID})"
      break
    fi
    for host in 127.0.0.1 localhost "[::1]"; do
      url="http://${host}:${port}/json/version"
      base="http://${host}:${port}"

      local out=""
      out="$(curl -sS --connect-timeout 1 --max-time 2 "$url" -w $'\n__HTTP_CODE__%{http_code}' 2>/dev/null || true)"
      [[ -n "$out" ]] || { last_err="no response (${host})"; continue; }

      local code=""
      local body=""
      if [[ "$out" == *"__HTTP_CODE__"* ]]; then
        code="${out##*__HTTP_CODE__}"
        body="${out%$'\n'__HTTP_CODE__*}"
      else
        code=""
        body="$out"
      fi

      if [[ "$code" == "200" && -n "$body" ]]; then
        if python3 - "$body" <<'PY' >/dev/null 2>&1
import json,sys
p=json.loads(sys.argv[1])
ws=p.get('webSocketDebuggerUrl')
raise SystemExit(0 if isinstance(ws,str) and ws.strip() else 1)
PY
        then
          CDP_BASE_URL="$base"
          log "CDP ready: $url"
          return 0
        fi
        last_err="missing webSocketDebuggerUrl (http ${code}, ${host})"
      else
        if [[ -z "$code" || "$code" == "000" ]]; then
          last_err="no response (${host})"
        else
          last_err="http ${code} (${host})"
        fi
      fi
    done
    sleep 0.25
  done

  CDP_LAST_ERROR="$last_err"
  return 1
}

wait_cdp_ready() {
  local port="$1"
  local timeout_secs="$2"
  if try_wait_cdp_ready "$port" "$timeout_secs"; then
    return 0
  fi
  fail "CDP endpoint not ready within ${timeout_secs}s: http://127.0.0.1:${port}/json/version (or localhost) (last error: ${CDP_LAST_ERROR:-unknown})"
}

dump_cdp_diag() {
  local port="$1"
  [[ -n "$port" ]] || return 0

  log "CDP diagnostics for :$port"
  dump_port_diag "$port"

  local url="http://127.0.0.1:${port}/json/version"
  local out=""
  out="$(curl -sS --connect-timeout 1 --max-time 2 "$url" -w $'\n__HTTP_CODE__%{http_code}' 2>/dev/null || true)"
  if [[ -z "$out" ]]; then
    log "CDP /json/version: no response"
    return 0
  fi

  local code="${out##*__HTTP_CODE__}"
  local body="${out%$'\n'__HTTP_CODE__*}"
  log "CDP /json/version HTTP ${code:-<unknown>}"
  if [[ -n "$body" ]]; then
    local one_line="${body//$'\n'/ }"
    log "CDP /json/version body (first 800 chars): ${one_line:0:800}"
  fi
}

detect_base_url_from_cdp() {
  local cdp_base_url="$1"
  local list_url="${cdp_base_url}/json/list"
  local payload=""
  payload="$(curl -fsS --max-time 2 "$list_url" 2>/dev/null || true)"
  [[ -n "$payload" ]] || return 1

  python3 - "$payload" <<'PY'
import json
import sys
import urllib.parse

targets = json.loads(sys.argv[1])
urls = []
iterable = targets if isinstance(targets, list) else []
for t in iterable:
    u = str(t.get('url') or '').strip()
    if not u:
        continue
    if not (u.startswith('http://') or u.startswith('https://')):
        continue
    urls.append(u)

def prefer(candidates):
    # Prefer local Studio URLs.
    local = [u for u in candidates if u.startswith('http://127.0.0.1') or u.startswith('http://localhost') or u.startswith('https://127.0.0.1') or u.startswith('https://localhost')]
    if local:
        candidates = local

    for u in candidates:
        if '/chat' in u:
            return u
    return candidates[0] if candidates else ''

picked = prefer(urls)
if not picked:
    raise SystemExit(1)

p = urllib.parse.urlparse(picked)
if not p.scheme or not p.netloc:
    raise SystemExit(1)

print(f"{p.scheme}://{p.netloc}")
PY
}

wait_base_url_from_cdp() {
  local cdp_base_url="$1"
  local timeout_secs="$2"
  local end=$((SECONDS + timeout_secs))
  local detected=""

  while ((SECONDS < end)); do
    detected="$(detect_base_url_from_cdp "$cdp_base_url" 2>/dev/null || true)"
    if [[ -n "${detected:-}" ]]; then
      printf '%s\n' "$detected"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

port_from_base_url() {
  local base_url="$1"
  python3 - "$base_url" <<'PY'
import sys
import urllib.parse

u = urllib.parse.urlparse(sys.argv[1])
port = u.port
if port is None:
    port = 443 if u.scheme == 'https' else 80
print(port)
PY
}

dump_port_diag() {
  local port="$1"
  [[ -n "$port" ]] || return 0
  log "Port diagnostics for :$port"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  fi
}

wait_port_free() {
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
  if ! wait_port_free "$port" "$timeout_secs"; then
    dump_port_diag "$port"
    fail "Port $port is still not bindable after ${timeout_secs}s"
  fi
  log "Port released: :$port"
}

read_health_field() {
  local base_url="$1"
  local field="$2"
  local health_json=""
  health_json="$(curl -fsS --max-time 6 "$base_url/health" 2>/dev/null || true)"
  [[ -n "$health_json" ]] || { printf '%s\n' ""; return 0; }
  python3 - "$health_json" "$field" <<'PY'
import json
import sys

p = json.loads(sys.argv[1])
key = sys.argv[2]
value = p.get(key)
if value is None:
    print('')
elif isinstance(value, bool):
    print('1' if value else '0')
else:
    print(str(value))
PY
}

wait_for_health_up() {
  local base_url="$1"
  local timeout_secs="$2"
  local elapsed=0

  while ((elapsed < timeout_secs)); do
    if curl -fsS --max-time 2 "$base_url/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

clear_cef_cache() {
  local dirs=(
    "$HOME/Library/Caches/cn.cxits.opencode-studio/cef"
    "$HOME/Library/Caches/OpenCode Studio/cef"
  )

  local d=""
  for d in "${dirs[@]}"; do
    if [[ -d "$d" ]]; then
      log "Clearing CEF cache: $d"
      rm -rf "$d" >/dev/null 2>&1 || true
    fi
  done
}

cleanup_chromium_singletons() {
  # Chromium/CEF sometimes leaves Singleton* lock files behind after crashy exits.
  # Those can prevent subsequent launches from starting the embedded browser.
  local roots=(
    "$HOME/Library/Application Support/cn.cxits.opencode-studio"
    "$HOME/Library/Application Support/OpenCode Studio"
    "$HOME/Library/Caches/cn.cxits.opencode-studio"
    "$HOME/Library/Caches/OpenCode Studio"
  )

  local root=""
  for root in "${roots[@]}"; do
    [[ -d "$root" ]] || continue
    find "$root" -maxdepth 6 -type f -name 'Singleton*' -exec rm -f {} + 2>/dev/null || true
  done
}

dump_process_diag() {
  log "Process diagnostics"

  local patterns=(
    "$APP_PATH"
    "OpenCode Studio"
    "opencode-studio"
    "opencode serve"
    "Chromium Helper"
    "CEF"
  )

  local p=""
  for p in "${patterns[@]}"; do
    if pgrep -f "$p" >/dev/null 2>&1; then
      log "pgrep -fl $p"
      pgrep -fl "$p" || true
    fi
  done

  if [[ -n "${APP_MAIN_PID:-}" ]] && kill -0 "$APP_MAIN_PID" >/dev/null 2>&1; then
    log "Main pid: $APP_MAIN_PID"
    ps -p "$APP_MAIN_PID" -o pid,ppid,stat,etime,command 2>/dev/null || true
  fi
}

capture_sample() {
  local pid="$1"
  local label="$2"
  local attempt="$3"
  [[ -n "${pid:-}" ]] || return 0
  kill -0 "$pid" >/dev/null 2>&1 || return 0

  if command -v sample >/dev/null 2>&1; then
    local out="$HOME/Library/Logs/cn.cxits.opencode-studio/sample-${label}-attempt${attempt}-pid${pid}-$(date '+%Y%m%d-%H%M%S').txt"
    mkdir -p "$(dirname "$out")" >/dev/null 2>&1 || true
    log "Capturing stack sample (pid=$pid) to: $out"
    sample "$pid" 5 -file "$out" >/dev/null 2>&1 || true
  fi
}

capture_unified_log() {
  local label="$1"
  local attempt="$2"
  # Note: this script defines a log() function; call /usr/bin/log explicitly.
  if [[ -x /usr/bin/log ]]; then
    local out="$HOME/Library/Logs/cn.cxits.opencode-studio/unified-log-${label}-attempt${attempt}-$(date '+%Y%m%d-%H%M%S').txt"
    mkdir -p "$(dirname "$out")" >/dev/null 2>&1 || true
    /usr/bin/log show --style syslog --last 10m \
      --predicate 'process == "opencode-studio-desktop" OR process == "opencode-studio" OR process == "OpenCode Studio"' \
      >"$out" 2>&1 || true
    log "Captured unified log to: $out"
  fi
}

collect_diagnostic_reports() {
  local src="$HOME/Library/Logs/DiagnosticReports"
  local dst="$HOME/Library/Logs/cn.cxits.opencode-studio/diagnostic-reports"
  [[ -d "$src" ]] || return 0
  mkdir -p "$dst" >/dev/null 2>&1 || true

  local list=""
  list="$(ls -1t "$src"/*opencode* "$src"/*OpenCode* 2>/dev/null | head -n 20 || true)"
  [[ -n "$list" ]] || return 0

  local f=""
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    cp "$f" "$dst/" >/dev/null 2>&1 || true
  done <<<"$list"

  log "Collected diagnostic reports to: $dst"
}

activate_app() {
  # Best-effort: bring the app to the foreground so the webview is created.
  # Guarded: do not re-launch the app via LaunchServices (that would drop the
  # CDP flags we passed on the command line).
  osascript \
    -e 'with timeout of 5 seconds' \
    -e 'if application "OpenCode Studio" is running then tell application "OpenCode Studio" to activate' \
    -e 'end timeout' >/dev/null 2>&1 || true
}

launch_with_cdp_and_usage_smoke() {
  local label="$1"
  local attempt=1
  local max_attempts=3
  local cdp_timeout="$WAIT_TIMEOUT_SECS"
  local health_timeout="$WAIT_TIMEOUT_SECS"

  while ((attempt <= max_attempts)); do
    DEBUG_PORT="$(pick_free_port)"
    CDP_BASE_URL=""
    RUN_BASE_URL="$BASE_URL"
    STUDIO_PORT_LAST="$PORT"
    CDP_LAUNCHED="1"

    local chromium_user_data_dir="$WORK_DIR/chromium-user-data-${label}-attempt${attempt}"

    APP_LAUNCH_LOG_PATH="$HOME/Library/Logs/cn.cxits.opencode-studio/desktop-e2e-${label}-attempt${attempt}-cdp${DEBUG_PORT}-$(date '+%Y%m%d-%H%M%S').log"
    clear_cef_cache
    cleanup_chromium_singletons

    log "[$label] Launch attempt ${attempt}/${max_attempts} (CDP port: $DEBUG_PORT)"
    start_app \
      "$APP_PATH" \
      "--remote-debugging-port=${DEBUG_PORT}" \
      "--remote-debugging-address=127.0.0.1" \
      --remote-allow-origins=* \
      --password-store=basic \
      "--user-data-dir=${chromium_user_data_dir}"

    # Fail fast if the launched process exits immediately (otherwise we can end up
    # waiting for CDP while a separate LaunchServices-started instance runs without flags).
    if [[ -n "${APP_MAIN_PID:-}" ]]; then
      sleep 1
      if ! kill -0 "$APP_MAIN_PID" >/dev/null 2>&1; then
        log "[$label] App process exited early (pid: $APP_MAIN_PID)"
        if [[ -n "${APP_LAUNCH_LOG_PATH:-}" && -f "$APP_LAUNCH_LOG_PATH" ]]; then
          log "App launch log (last 120 lines): $APP_LAUNCH_LOG_PATH"
          tail -n 120 "$APP_LAUNCH_LOG_PATH" || true
        fi
        stop_app || true
        attempt=$((attempt + 1))
        continue
      fi
    fi

    activate_app

    if ! wait_for_health_up "$RUN_BASE_URL" "$health_timeout"; then
      log "[$label] Backend not reachable: $RUN_BASE_URL/health (waited ${health_timeout}s)"
      dump_port_diag "$STUDIO_PORT_LAST"
      dump_cdp_diag "$DEBUG_PORT"

      dump_process_diag
      capture_sample "${APP_MAIN_PID:-}" "$label" "$attempt"
      capture_unified_log "$label" "$attempt"
      collect_diagnostic_reports
      if [[ -n "${APP_LAUNCH_LOG_PATH:-}" && -f "$APP_LAUNCH_LOG_PATH" ]]; then
        if test -s "$APP_LAUNCH_LOG_PATH"; then
          log "App launch log (last 120 lines): $APP_LAUNCH_LOG_PATH"
          tail -n 120 "$APP_LAUNCH_LOG_PATH" || true
        else
          log "App launch log is empty: $APP_LAUNCH_LOG_PATH"
        fi
      fi

      stop_app || true
      assert_port_free "$STUDIO_PORT_LAST" "$WAIT_TIMEOUT_SECS" || true
      assert_port_free "$DEBUG_PORT" "$WAIT_TIMEOUT_SECS" || true
      attempt=$((attempt + 1))
      continue
    fi

    if ! try_wait_cdp_ready "$DEBUG_PORT" "$cdp_timeout"; then
      log "[$label] Backend is reachable but CDP not ready within ${cdp_timeout}s (last error: ${CDP_LAST_ERROR:-unknown})"
      dump_cdp_diag "$DEBUG_PORT"
      dump_desktop_support_dirs "CDP not ready ($label)"
      dump_process_diag
      capture_sample "${APP_MAIN_PID:-}" "$label" "$attempt"
      capture_unified_log "$label" "$attempt"
      collect_diagnostic_reports
      stop_app || true
      assert_port_free "$DEBUG_PORT" "$WAIT_TIMEOUT_SECS" || true
      attempt=$((attempt + 1))
      continue
    fi

    local detected=""
    detected="$(wait_base_url_from_cdp "$CDP_BASE_URL" 10 2>/dev/null || true)"
    if [[ -n "${detected:-}" ]]; then
      RUN_BASE_URL="$detected"
      log "[$label] Detected base URL via CDP: $RUN_BASE_URL"
    else
      log "[$label] CDP base URL detection unavailable; using configured base URL: $RUN_BASE_URL"
    fi
    STUDIO_PORT_LAST="$(port_from_base_url "$RUN_BASE_URL")"

    log "[$label] Running usage smoke"
    if bash "$USAGE_SMOKE_SCRIPT" --base-url "$RUN_BASE_URL" --directory "$WORK_DIR" --timeout "$WAIT_TIMEOUT_SECS" --require-ui; then
      return 0
    fi

    log "[$label] Usage smoke failed; retrying launch"
    dump_desktop_support_dirs "Usage smoke failed ($label)"
    stop_app || true
    assert_port_free "$STUDIO_PORT_LAST" "$WAIT_TIMEOUT_SECS" || true
    assert_port_free "$DEBUG_PORT" "$WAIT_TIMEOUT_SECS" || true
    attempt=$((attempt + 1))
  done

  return 1
}

download_release_asset() {
  local tag="$1"
  local asset_name="$2"
  local out_path="$3"
  local url="https://github.com/${REPO}/releases/download/${tag}/${asset_name}"
  log "Downloading $asset_name"

  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/opencode-studio-download.XXXXXX")"
  local code=""
  code="$(curl -sS -L --retry 3 --retry-delay 2 -o "$tmp" -w '%{http_code}' "$url" || true)"
  if [[ "$code" != "200" ]]; then
    rm -f "$tmp" >/dev/null 2>&1 || true
    log "Download failed (HTTP $code): $url"
    return 1
  fi

  mkdir -p "$(dirname "$out_path")"
  mv "$tmp" "$out_path"
  if ! test -s "$out_path"; then
    log "Downloaded file is empty: $out_path"
    return 1
  fi
}

mount_dmg() {
  local dmg="$1"
  local mount_dir="$2"
  hdiutil attach -nobrowse -readonly -mountpoint "$mount_dir" "$dmg" >/dev/null
}

unmount_dmg() {
  local mount_dir="$1"
  hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
}

install_app_from_dmg() {
  local dmg="$1"
  local dest_app="$2"
  local mount_dir
  mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/opencode-studio-dmg.XXXXXX")"

  log "Mounting DMG: $dmg"
  mount_dmg "$dmg" "$mount_dir" || fail "Failed to mount DMG"
  local src_app=""
  if [[ -d "$mount_dir/$APP_BUNDLE_NAME" ]]; then
    src_app="$mount_dir/$APP_BUNDLE_NAME"
  else
    src_app="$(ls -1 "$mount_dir"/*.app 2>/dev/null | head -n 1 || true)"
  fi
  if [[ -z "$src_app" ]]; then
    unmount_dmg "$mount_dir"
    rmdir "$mount_dir" >/dev/null 2>&1 || true
    fail "No .app found in DMG"
  fi
  if ! test -d "$src_app"; then
    unmount_dmg "$mount_dir"
    rmdir "$mount_dir" >/dev/null 2>&1 || true
    fail "DMG .app is not a directory: $src_app"
  fi

  log "Source app: $src_app"

  log "Installing app to: $dest_app"
  mkdir -p "$(dirname "$dest_app")"
  rm -rf "$dest_app"
  # Use ditto instead of cp for app bundles (more reliable on macOS, preserves bundle structure).
  ditto "$src_app" "$dest_app" || fail "Failed to copy .app bundle"

  unmount_dmg "$mount_dir"
  rmdir "$mount_dir" >/dev/null 2>&1 || true

  # Avoid Gatekeeper prompts on CI.
  xattr -dr com.apple.quarantine "$dest_app" >/dev/null 2>&1 || true
  test -d "$dest_app" || fail "Installed app missing: $dest_app"
}

start_app() {
  local app_path="$1"
  shift || true
  log "Launching app: $app_path"

  if [[ $# -gt 0 ]]; then
    # Prefer launching the app binary directly so Chromium flags (e.g. --remote-debugging-port)
    # reliably reach the CEF runtime.
    local plist="$app_path/Contents/Info.plist"
    local exec_name=""
    local bin=""

    if [[ -f "$plist" ]] && command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
      exec_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist" 2>/dev/null | tr -d '\r' | xargs || true)"
      if [[ -n "${exec_name:-}" ]]; then
        bin="$app_path/Contents/MacOS/$exec_name"
      fi
    fi

    if [[ -n "${bin:-}" && -f "$bin" && -x "$bin" ]]; then
      log "Launching app binary: $bin"
      if [[ -n "${APP_LAUNCH_LOG_PATH:-}" ]]; then
        mkdir -p "$(dirname "$APP_LAUNCH_LOG_PATH")" >/dev/null 2>&1 || true
        log "App launch log: $APP_LAUNCH_LOG_PATH"
        "$bin" "$@" >"$APP_LAUNCH_LOG_PATH" 2>&1 &
      else
        "$bin" "$@" >/dev/null 2>&1 &
      fi
      APP_MAIN_PID="$!"
      return 0
    fi

    log "Launching via open (fallback): $app_path"
    open -n "$app_path" --args "$@" || fail "Failed to launch app"
    return 0
  fi

  open -n "$app_path" || fail "Failed to launch app"
}

stop_app() {
  log "Stopping app (best-effort graceful quit)"
  # AppleScript can hang if the app is unresponsive; bound it with a short timeout.
  osascript \
    -e 'with timeout of 5 seconds' \
    -e 'tell application "OpenCode Studio" to quit' \
    -e 'end timeout' >/dev/null 2>&1 || true

  local pid="${APP_MAIN_PID:-}"
  APP_MAIN_PID=""

  if [[ -n "${pid:-}" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    log "Waiting for app to exit (pid: $pid)"
    local waited=0
    while kill -0 "$pid" >/dev/null 2>&1 && ((waited < 20)); do
      sleep 1
      waited=$((waited + 1))
    done

    if kill -0 "$pid" >/dev/null 2>&1; then
      log "App still running; sending SIGTERM (pid: $pid)"
      kill "$pid" >/dev/null 2>&1 || true

      waited=0
      while kill -0 "$pid" >/dev/null 2>&1 && ((waited < 5)); do
        sleep 1
        waited=$((waited + 1))
      done
    fi

    if kill -0 "$pid" >/dev/null 2>&1; then
      log "App still running; force-killing (pid: $pid)"
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi

  # Give it a moment to shut down.
  sleep 2

  # Force-kill any lingering processes.
  local patterns=(
    "${APP_PATH}"
    "OpenCode Studio"
    "OpenCode Studio Helper"
    "opencode-studio-desktop"
    "opencode-studio"
    "Chromium Helper"
    "opencode serve"
  )
  local pat=""
  for pat in "${patterns[@]}"; do
    if pgrep -f "$pat" >/dev/null 2>&1; then
      log "Force-killing lingering processes matching: $pat"
      pkill -f "$pat" >/dev/null 2>&1 || true
    fi
  done

  # Cleanup CEF/Chromium singleton locks between runs.
  cleanup_chromium_singletons
}

dump_desktop_support_dirs() {
  local header="$1"
  log "$header"
  local cfg_dir="$HOME/Library/Application Support/cn.cxits.opencode-studio"
  local log_dir="$HOME/Library/Logs/cn.cxits.opencode-studio"
  local cache_dir="$HOME/Library/Caches/cn.cxits.opencode-studio"

  collect_diagnostic_reports

  if [[ -d "$cfg_dir" ]]; then
    log "Config dir: $cfg_dir"
    ls -la "$cfg_dir" || true
    if [[ -f "$cfg_dir/opencode-studio.toml" ]]; then
      log "Runtime config (first 200 lines): $cfg_dir/opencode-studio.toml"
      python3 - "$cfg_dir/opencode-studio.toml" <<'PY' || true
import sys
path=sys.argv[1]
with open(path,'r',encoding='utf-8',errors='ignore') as f:
    for i,line in enumerate(f):
        if i>=200:
            break
        sys.stdout.write(line)
PY
    fi
  fi
  if [[ -d "$log_dir" ]]; then
    log "Log dir: $log_dir"
    ls -la "$log_dir" || true
    if [[ -f "$log_dir/backend.log" ]]; then
      log "backend.log (last 200 lines): $log_dir/backend.log"
      tail -n 200 "$log_dir/backend.log" || true
    fi
  fi

  if [[ -d "$cache_dir" ]]; then
    log "Cache dir: $cache_dir"
    ls -la "$cache_dir" || true
  fi
}

cleanup() {
  local code="$?"
  if [[ "$code" -ne 0 ]]; then
    dump_desktop_support_dirs "Failure diagnostics"
    stop_app || true
  fi

  if [[ "$KEEP_FILES" != "1" && -n "${WORK_DIR:-}" ]]; then
    rm -rf "$WORK_DIR" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --upgrade-to-version) UPGRADE_TO_VERSION="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --wait-timeout) WAIT_TIMEOUT_SECS="$2"; shift 2 ;;
    --keep-files) KEEP_FILES="1"; shift ;;
    --ui-clicks) UI_CLICKS="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "Unknown arg: $1" ;;
  esac
done

[[ -n "$VERSION" ]] || { usage; fail "--version is required"; }
[[ -n "$UPGRADE_TO_VERSION" ]] || { usage; fail "--upgrade-to-version is required"; }
if ! [[ "$WAIT_TIMEOUT_SECS" =~ ^[0-9]+$ ]] || ((WAIT_TIMEOUT_SECS < 10)); then
  fail "Invalid --wait-timeout '$WAIT_TIMEOUT_SECS'. Expected integer >= 10."
fi
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
  fail "Invalid --port '$PORT'. Expected 1-65535."
fi

need curl
need hdiutil
need python3
need opencode
test -f "$USAGE_SMOKE_SCRIPT" || fail "Usage smoke script not found: $USAGE_SMOKE_SCRIPT"

if [[ "$UI_CLICKS" == "1" ]]; then
  need node
  test -f "$UI_CLICK_SCRIPT" || fail "UI click script not found: $UI_CLICK_SCRIPT"
fi

OS="$(uname -s)"
[[ "$OS" == "Darwin" ]] || fail "Unsupported OS: $OS (macOS only)"

TARGET="$(detect_target_triple || true)"
[[ -n "$TARGET" ]] || fail "Unable to detect macOS target triple"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencode-studio-desktop-e2e.XXXXXX")"
DOWNLOAD_DIR="$WORK_DIR/downloads"
mkdir -p "$DOWNLOAD_DIR"

VERSION="$(normalize_release_tag "$VERSION")"
UPGRADE_TO_VERSION="$(normalize_release_tag "$UPGRADE_TO_VERSION")"

BASE_URL="http://127.0.0.1:${PORT}"

log "Starting macOS desktop installer flow"
log "Repo: $REPO"
log "Target: $TARGET"
log "Install version: $VERSION"
log "Upgrade to: $UPGRADE_TO_VERSION"
log "App path: $APP_PATH"
log "Base URL: $BASE_URL"

ASSET_OLD_STD="opencode-studio-desktop-${TARGET}-${VERSION}.dmg"
ASSET_NEW_STD="opencode-studio-desktop-${TARGET}-${UPGRADE_TO_VERSION}.dmg"
DMG_OLD_STD="$DOWNLOAD_DIR/opencode-studio-${TARGET}-${VERSION}.dmg"
DMG_NEW_STD="$DOWNLOAD_DIR/opencode-studio-${TARGET}-${UPGRADE_TO_VERSION}.dmg"

ASSET_OLD_CEF="opencode-studio-desktop-${TARGET}-cef-${VERSION}.dmg"
ASSET_NEW_CEF="opencode-studio-desktop-${TARGET}-cef-${UPGRADE_TO_VERSION}.dmg"
DMG_OLD_CEF="$DOWNLOAD_DIR/opencode-studio-${TARGET}-cef-${VERSION}.dmg"
DMG_NEW_CEF="$DOWNLOAD_DIR/opencode-studio-${TARGET}-cef-${UPGRADE_TO_VERSION}.dmg"

USE_CEF="0"
DMG_OLD="$DMG_OLD_STD"
DMG_NEW="$DMG_NEW_STD"

if [[ "$UI_CLICKS" == "1" ]]; then
  # UI clicks on desktop require CDP attach, which is only exposed by the CEF desktop builds.
  log "UI clicks enabled: requiring CEF desktop installers (CDP)"
  USE_CEF="1"
  DMG_OLD="$DMG_OLD_CEF"
  DMG_NEW="$DMG_NEW_CEF"

  if ! download_release_asset "$VERSION" "$ASSET_OLD_CEF" "$DMG_OLD_CEF"; then
    fail "CEF desktop DMG not found for $VERSION ($ASSET_OLD_CEF). Publish -cef desktop assets or run without --ui-clicks."
  fi
  if ! download_release_asset "$UPGRADE_TO_VERSION" "$ASSET_NEW_CEF" "$DMG_NEW_CEF"; then
    fail "CEF desktop DMG not found for $UPGRADE_TO_VERSION ($ASSET_NEW_CEF). Publish -cef desktop assets or run without --ui-clicks."
  fi
else
  download_release_asset "$VERSION" "$ASSET_OLD_STD" "$DMG_OLD_STD" || fail "Failed to download desktop DMG: $ASSET_OLD_STD"
  download_release_asset "$UPGRADE_TO_VERSION" "$ASSET_NEW_STD" "$DMG_NEW_STD" || fail "Failed to download desktop DMG: $ASSET_NEW_STD"
fi

log "Step 1/6: install desktop app ($VERSION)"
assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"
install_app_from_dmg "$DMG_OLD" "$APP_PATH"

log "Step 2/6: launch + usage smoke ($VERSION)"
DEBUG_PORT=""
CDP_BASE_URL=""
RUN_BASE_URL="$BASE_URL"
STUDIO_PORT_LAST="$PORT"
CDP_LAUNCHED="0"

if [[ "$UI_CLICKS" == "1" ]]; then
  launch_with_cdp_and_usage_smoke "desktop-install" || fail "Usage smoke failed"
  log "UI clicks: CDP mode"
  node "$UI_CLICK_SCRIPT" --cdp-url "$CDP_BASE_URL" --base-url "$RUN_BASE_URL" --directory "$WORK_DIR" --timeout "$WAIT_TIMEOUT_SECS" --label "desktop-install"
else
  start_app "$APP_PATH"
  log "Base URL: $RUN_BASE_URL"
  STUDIO_PORT_LAST="$(port_from_base_url "$RUN_BASE_URL")"
  bash "$USAGE_SMOKE_SCRIPT" --base-url "$RUN_BASE_URL" --directory "$WORK_DIR" --timeout "$WAIT_TIMEOUT_SECS" --require-ui || fail "Usage smoke failed"
fi
OPENCODE_PORT_LAST="$(read_health_field "$RUN_BASE_URL" "openCodePort" || true)"
if [[ -n "$OPENCODE_PORT_LAST" ]]; then
  log "Captured openCodePort=$OPENCODE_PORT_LAST"
fi

log "Step 3/6: quit app + verify port release"
if [[ "$UI_CLICKS" == "1" ]]; then
  log "Cooldown before quit (UI clicks)"
  sleep 3
fi
stop_app
assert_port_free "$STUDIO_PORT_LAST" "$WAIT_TIMEOUT_SECS"
if [[ "$STUDIO_PORT_LAST" != "$PORT" ]]; then
  assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"
fi
if [[ -n "$OPENCODE_PORT_LAST" ]]; then
  assert_port_free "$OPENCODE_PORT_LAST" "$WAIT_TIMEOUT_SECS"
fi
if [[ "$UI_CLICKS" == "1" && -n "${DEBUG_PORT:-}" ]]; then
  assert_port_free "$DEBUG_PORT" "$WAIT_TIMEOUT_SECS"
fi

log "Step 4/6: upgrade by replacing .app ($UPGRADE_TO_VERSION)"
install_app_from_dmg "$DMG_NEW" "$APP_PATH"
assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"
DEBUG_PORT=""
CDP_BASE_URL=""
RUN_BASE_URL="$BASE_URL"
STUDIO_PORT_LAST="$PORT"
CDP_LAUNCHED="0"

if [[ "$UI_CLICKS" == "1" ]]; then
  launch_with_cdp_and_usage_smoke "desktop-upgrade" || fail "Usage smoke failed"
  log "UI clicks: CDP mode"
  node "$UI_CLICK_SCRIPT" --cdp-url "$CDP_BASE_URL" --base-url "$RUN_BASE_URL" --directory "$WORK_DIR" --timeout "$WAIT_TIMEOUT_SECS" --label "desktop-upgrade"
else
  start_app "$APP_PATH"
  log "Base URL: $RUN_BASE_URL"
  STUDIO_PORT_LAST="$(port_from_base_url "$RUN_BASE_URL")"
  bash "$USAGE_SMOKE_SCRIPT" --base-url "$RUN_BASE_URL" --directory "$WORK_DIR" --timeout "$WAIT_TIMEOUT_SECS" --require-ui || fail "Usage smoke failed"
fi
OPENCODE_PORT_LAST="$(read_health_field "$RUN_BASE_URL" "openCodePort" || true)"
if [[ "$UI_CLICKS" == "1" ]]; then
  log "Cooldown before quit (UI clicks)"
  sleep 3
fi
stop_app
assert_port_free "$STUDIO_PORT_LAST" "$WAIT_TIMEOUT_SECS"
if [[ "$STUDIO_PORT_LAST" != "$PORT" ]]; then
  assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"
fi
if [[ -n "$OPENCODE_PORT_LAST" ]]; then
  assert_port_free "$OPENCODE_PORT_LAST" "$WAIT_TIMEOUT_SECS"
fi
if [[ "$UI_CLICKS" == "1" && -n "${DEBUG_PORT:-}" ]]; then
  assert_port_free "$DEBUG_PORT" "$WAIT_TIMEOUT_SECS"
fi

log "Step 5/6: uninstall desktop app (remove .app)"
rm -rf "$APP_PATH"
test ! -d "$APP_PATH" || fail "App still exists after uninstall: $APP_PATH"
assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"

log "Step 6/6: reinstall latest + usage smoke"
install_app_from_dmg "$DMG_NEW" "$APP_PATH"
DEBUG_PORT=""
CDP_BASE_URL=""
RUN_BASE_URL="$BASE_URL"
STUDIO_PORT_LAST="$PORT"
CDP_LAUNCHED="0"

if [[ "$UI_CLICKS" == "1" ]]; then
  launch_with_cdp_and_usage_smoke "desktop-reinstall" || fail "Usage smoke failed"
  log "UI clicks: CDP mode"
  node "$UI_CLICK_SCRIPT" --cdp-url "$CDP_BASE_URL" --base-url "$RUN_BASE_URL" --directory "$WORK_DIR" --timeout "$WAIT_TIMEOUT_SECS" --label "desktop-reinstall"
else
  start_app "$APP_PATH"
  log "Base URL: $RUN_BASE_URL"
  STUDIO_PORT_LAST="$(port_from_base_url "$RUN_BASE_URL")"
  bash "$USAGE_SMOKE_SCRIPT" --base-url "$RUN_BASE_URL" --directory "$WORK_DIR" --timeout "$WAIT_TIMEOUT_SECS" --require-ui || fail "Usage smoke failed"
fi
OPENCODE_PORT_LAST="$(read_health_field "$RUN_BASE_URL" "openCodePort" || true)"
if [[ "$UI_CLICKS" == "1" ]]; then
  log "Cooldown before quit (UI clicks)"
  sleep 3
fi
stop_app
assert_port_free "$STUDIO_PORT_LAST" "$WAIT_TIMEOUT_SECS"
if [[ "$STUDIO_PORT_LAST" != "$PORT" ]]; then
  assert_port_free "$PORT" "$WAIT_TIMEOUT_SECS"
fi
if [[ -n "$OPENCODE_PORT_LAST" ]]; then
  assert_port_free "$OPENCODE_PORT_LAST" "$WAIT_TIMEOUT_SECS"
fi
if [[ "$UI_CLICKS" == "1" && -n "${DEBUG_PORT:-}" ]]; then
  assert_port_free "$DEBUG_PORT" "$WAIT_TIMEOUT_SECS"
fi

if [[ "$KEEP_FILES" != "1" ]]; then
  rm -rf "$APP_PATH" >/dev/null 2>&1 || true
fi

log "PASS: macOS desktop installer flow completed"
