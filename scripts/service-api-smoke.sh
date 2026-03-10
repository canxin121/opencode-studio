#!/usr/bin/env bash
set -euo pipefail

BASE_URL=""
CWD=""
TIMEOUT_SECS="30"

usage() {
  cat <<'EOF'
Usage:
  service-api-smoke.sh --base-url URL [--cwd PATH] [--timeout SECONDS]

Runs a deterministic set of local OpenCode Studio API checks:
  - GET /auth/session (expects auth disabled by default installs)
  - GET /api/opencode-studio/diagnostics (version-ish endpoint)
  - GET /api/opencode-studio/update-check (service version status)
  - POST/GET/DELETE /api/terminal/* (functional endpoint)
EOF
}

log() {
  printf '[api-smoke %s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --timeout) TIMEOUT_SECS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown arg: $1" ;;
  esac
done

[[ -n "${BASE_URL:-}" ]] || { usage; fail "--base-url is required"; }
if ! [[ "$TIMEOUT_SECS" =~ ^[0-9]+$ ]] || ((TIMEOUT_SECS < 5)); then
  fail "Invalid --timeout '$TIMEOUT_SECS'. Expected integer >= 5."
fi

need curl
need python3

retry_curl_json() {
  local url="$1"
  local elapsed=0
  local delay=1
  local out=""

  while ((elapsed < TIMEOUT_SECS)); do
    out="$(curl -fsS --max-time 8 "$url" 2>/dev/null || true)"
    if [[ -n "$out" ]]; then
      printf '%s\n' "$out"
      return 0
    fi
    sleep "$delay"
    elapsed=$((elapsed + delay))
    if ((delay < 4)); then
      delay=$((delay + 1))
    fi
  done

  return 1
}

retry_curl_status() {
  local method="$1"
  local url="$2"
  local data="$3"
  local elapsed=0
  local delay=1
  local code=""

  while ((elapsed < TIMEOUT_SECS)); do
    if [[ "$method" == "POST" ]]; then
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 -X POST -H 'Content-Type: application/json' --data "$data" "$url" 2>/dev/null || true)"
    elif [[ "$method" == "DELETE" ]]; then
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 -X DELETE "$url" 2>/dev/null || true)"
    else
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 "$url" 2>/dev/null || true)"
    fi

    if [[ "$code" =~ ^[0-9]{3}$ ]] && [[ "$code" != "000" ]]; then
      printf '%s\n' "$code"
      return 0
    fi

    sleep "$delay"
    elapsed=$((elapsed + delay))
    if ((delay < 4)); then
      delay=$((delay + 1))
    fi
  done

  return 1
}

assert_json() {
  local payload="$1"
  python3 - "$payload" <<'PY'
import json
import sys

json.loads(sys.argv[1])
print('json ok')
PY
}

assert_auth_session_disabled() {
  local payload="$1"
  python3 - "$payload" <<'PY'
import json
import sys

p = json.loads(sys.argv[1])
assert p.get('authenticated') is True, p
assert p.get('disabled') is True, p
print('auth/session ok')
PY
}

assert_diagnostics_payload() {
  local payload="$1"
  python3 - "$payload" <<'PY'
import json
import sys

p = json.loads(sys.argv[1])
ts = p.get('timestamp')
assert isinstance(ts, str) and ts.strip(), p

oc = p.get('opencode')
assert isinstance(oc, dict), p
ver = (oc.get('version') or {}).get('cli', None)
assert ver is None or (isinstance(ver, str) and ver.strip()), p

print('diagnostics ok')
PY
}

assert_update_check_payload() {
  local payload="$1"
  python3 - "$payload" <<'PY'
import json
import sys

p = json.loads(sys.argv[1])
s = p.get('service')
assert isinstance(s, dict), p

def opt_str(v):
    return v is None or (isinstance(v, str) and v.strip() != '')

assert opt_str(s.get('currentVersion')), p
assert opt_str(s.get('latestVersion')), p
assert opt_str(s.get('assetUrl')), p
assert opt_str(s.get('target')), p
avail = s.get('available')
assert avail is None or isinstance(avail, bool), p

print('update-check ok')
PY
}

terminal_smoke() {
  local base="$1"
  local cwd="$2"
  local payload=""
  local response=""
  local sid=""

  payload="$(python3 - "$cwd" <<'PY'
import json
import sys

cwd = sys.argv[1]
if not cwd:
    cwd = '.'
print(json.dumps({'cwd': cwd, 'cols': 120, 'rows': 40}))
PY
  )"

  response="$(curl -fsS --max-time 20 -X POST -H 'Content-Type: application/json' --data "$payload" "$base/api/terminal/create")" || return 1
  sid="$(python3 - "$response" <<'PY'
import json
import sys

p = json.loads(sys.argv[1])
sid = p.get('sessionId') or p.get('session_id') or ''
print(sid)
PY
  )"
  [[ -n "$sid" ]] || fail "terminal/create missing sessionId"

  retry_curl_status GET "$base/api/terminal/$sid" "" >/dev/null || fail "terminal get did not return status"
  retry_curl_status DELETE "$base/api/terminal/$sid" "" >/dev/null || fail "terminal delete did not return status"
  log "terminal ok (sessionId=$sid)"
}

log "Checking /auth/session"
AUTH_JSON="$(retry_curl_json "$BASE_URL/auth/session" || true)"
[[ -n "$AUTH_JSON" ]] || fail "Failed to fetch $BASE_URL/auth/session within ${TIMEOUT_SECS}s"
assert_json "$AUTH_JSON" >/dev/null
assert_auth_session_disabled "$AUTH_JSON" >/dev/null

log "Checking /api/opencode-studio/diagnostics"
DIAG_JSON="$(retry_curl_json "$BASE_URL/api/opencode-studio/diagnostics" || true)"
[[ -n "$DIAG_JSON" ]] || fail "Failed to fetch diagnostics within ${TIMEOUT_SECS}s"
assert_json "$DIAG_JSON" >/dev/null
assert_diagnostics_payload "$DIAG_JSON" >/dev/null

log "Checking /api/opencode-studio/update-check"
UPDATE_JSON="$(retry_curl_json "$BASE_URL/api/opencode-studio/update-check" || true)"
[[ -n "$UPDATE_JSON" ]] || fail "Failed to fetch update-check within ${TIMEOUT_SECS}s"
assert_json "$UPDATE_JSON" >/dev/null
assert_update_check_payload "$UPDATE_JSON" >/dev/null

log "Checking terminal API"
terminal_smoke "$BASE_URL" "${CWD:-$PWD}"

log "PASS"
