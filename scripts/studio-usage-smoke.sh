#!/usr/bin/env bash
set -euo pipefail

BASE_URL=""
DIRECTORY=""
TIMEOUT_SECS="90"
REQUIRE_UI="0"
MAX_ASSETS="3"

usage() {
  cat <<'EOF'
Usage:
  studio-usage-smoke.sh --base-url URL [--directory PATH] [--timeout SECONDS] [--require-ui] [--max-assets N]

What it checks:
  - (Optional) UI is served at / and hashed assets under /assets load.
  - /health eventually reports isOpenCodeReady=true (OpenCode backend ready).
  - Can create + delete a chat session via POST/DELETE /api/session (basic "enter session" readiness).

Notes:
  - Requires: curl, python3.
  - Intended to be called while the Studio backend is running.
EOF
}

log() {
  printf '[usage-smoke %s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"
}

urlencode() {
  python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

curl_text() {
  local url="$1"
  curl -fsS --max-time 12 "$url"
}

curl_json_with_code() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local tmp
  tmp="$(mktemp)"

  local code=""
  if [[ "$method" == "GET" ]]; then
    code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 20 "$url" || true)"
  else
    code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 20 -X "$method" -H 'Content-Type: application/json' --data "$body" "$url" || true)"
  fi
  printf '%s\n' "$code"
  cat "$tmp"
  rm -f "$tmp"
}

parse_health_snapshot() {
  local payload="$1"
  python3 - "$payload" <<'PY'
import json
import sys

p = json.loads(sys.argv[1])

def scalar(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    return str(v)

print(f"status={scalar(p.get('status'))}")
print(f"isOpenCodeReady={scalar(p.get('isOpenCodeReady'))}")
print(f"openCodeRunning={scalar(p.get('openCodeRunning'))}")
print(f"openCodePort={scalar(p.get('openCodePort'))}")
print(f"lastOpenCodeError={scalar(p.get('lastOpenCodeError'))}")
PY
}

wait_for_health_up() {
  local base="$1"
  local timeout_secs="$2"
  local elapsed=0

  while ((elapsed < timeout_secs)); do
    if curl -fsS --max-time 2 "$base/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

wait_for_opencode_ready() {
  local base="$1"
  local timeout_secs="$2"
  local elapsed=0
  local health_json=""
  local parsed=""
  local is_ready=""
  local oc_port=""
  local last_err=""
  local status=""
  local line key value

  while ((elapsed < timeout_secs)); do
    health_json="$(curl -sS --max-time 6 "$base/health" 2>/dev/null || true)"
    if [[ -n "$health_json" ]]; then
      parsed="$(parse_health_snapshot "$health_json" 2>/dev/null || true)"
      is_ready=""
      oc_port=""
      last_err=""
      status=""
      while IFS= read -r line; do
        key="${line%%=*}"
        value="${line#*=}"
        case "$key" in
          status) status="$value" ;;
          isOpenCodeReady) is_ready="$value" ;;
          openCodePort) oc_port="$value" ;;
          lastOpenCodeError) last_err="$value" ;;
        esac
      done <<<"$parsed"

      if [[ "$status" == "ok" && "$is_ready" == "1" ]]; then
        log "OpenCode ready (openCodePort=${oc_port:-<unknown>})"
        return 0
      fi
      if [[ -n "$last_err" ]]; then
        log "Waiting for OpenCode ready... (lastOpenCodeError=${last_err})"
      fi
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  fail "OpenCode backend did not become ready within ${timeout_secs}s"
}

ui_smoke() {
  local base="$1"
  local max_assets="$2"
  local html
  local tmp
  local assets
  local asset
  local count=0

  log "UI: fetching /"
  tmp="$(mktemp)"
  if ! curl -fsS --max-time 20 "$base/" -o "$tmp"; then
    rm -f "$tmp"
    fail "Failed to fetch UI root: $base/"
  fi
  html="$(cat "$tmp")"
  if ! grep -q "OpenCode Studio" "$tmp"; then
    rm -f "$tmp"
    fail "UI root does not look like OpenCode Studio (missing title text)"
  fi
  if ! grep -q 'id="app"' "$tmp"; then
    rm -f "$tmp"
    fail "UI root missing #app mount"
  fi

  assets="$(python3 - "$tmp" <<'PY'
import re
import sys

path = sys.argv[1]
html = open(path, 'r', encoding='utf-8', errors='ignore').read()

matches = re.findall(r"['\"](/assets/[^'\"]+)['\"]", html)
out = []
seen = set()
for m in matches:
    if m in seen:
        continue
    seen.add(m)
    out.append(m)

for item in out:
    print(item)
PY
  )"
  rm -f "$tmp"

  if [[ -z "$assets" ]]; then
    fail "UI root did not reference /assets/* (Vite bundle missing?)"
  fi

  log "UI: validating first ${max_assets} hashed assets"
  while IFS= read -r asset; do
    [[ -n "$asset" ]] || continue
    count=$((count + 1))
    if ((count > max_assets)); then
      break
    fi

    local code content_type
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$base$asset" || true)"
    [[ "$code" == "200" ]] || fail "Asset fetch failed ($code): $asset"
    content_type="$(curl -sS -I --max-time 20 "$base$asset" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print tolower($2); exit}')"
    if [[ -n "$content_type" && "$content_type" == text/html* ]]; then
      fail "Asset returned HTML content-type (unexpected SPA fallback?): $asset"
    fi
    log "UI: OK $asset ($content_type)"
  done <<<"$assets"
}

session_smoke() {
  local base="$1"
  local directory="$2"
  local enc_dir
  local create_payload
  local create_code
  local create_body
  local session_id
  local enc_sid
  local delete_code

  enc_dir="$(urlencode "$directory")"

  log "Session: creating (directory=$directory)"
  create_payload="$(curl_json_with_code POST "$base/api/session?directory=$enc_dir" '{}' || true)"
  create_code="${create_payload%%$'\n'*}"
  create_body="${create_payload#*$'\n'}"
  if ! [[ "$create_code" =~ ^2[0-9][0-9]$ ]]; then
    log "Session create response body: ${create_body:0:2000}"
    fail "Failed to create session (HTTP $create_code)"
  fi

  session_id="$(python3 - "$create_body" <<'PY'
import json
import sys

p = json.loads(sys.argv[1])
sid = p.get('id') or p.get('sessionId') or p.get('session_id') or ''
print(str(sid).strip())
PY
  )"
  [[ -n "$session_id" ]] || fail "Session create response missing id"
  log "Session: created id=$session_id"

  enc_sid="$(urlencode "$session_id")"
  delete_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X DELETE "$base/api/session/$enc_sid?directory=$enc_dir" || true)"
  if ! [[ "$delete_code" =~ ^2[0-9][0-9]$ ]]; then
    fail "Failed to delete session id=$session_id (HTTP $delete_code)"
  fi
  log "Session: deleted id=$session_id"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --directory) DIRECTORY="$2"; shift 2 ;;
    --timeout) TIMEOUT_SECS="$2"; shift 2 ;;
    --require-ui) REQUIRE_UI="1"; shift ;;
    --max-assets) MAX_ASSETS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "Unknown arg: $1" ;;
  esac
done

[[ -n "${BASE_URL:-}" ]] || { usage; fail "--base-url is required"; }
if ! [[ "$TIMEOUT_SECS" =~ ^[0-9]+$ ]] || ((TIMEOUT_SECS < 5)); then
  fail "Invalid --timeout '$TIMEOUT_SECS'. Expected integer >= 5."
fi
if ! [[ "$MAX_ASSETS" =~ ^[0-9]+$ ]] || ((MAX_ASSETS < 1 || MAX_ASSETS > 20)); then
  fail "Invalid --max-assets '$MAX_ASSETS'. Expected integer 1-20."
fi
if [[ -z "${DIRECTORY:-}" ]]; then
  DIRECTORY="$PWD"
fi

need curl
need python3

log "Base URL: $BASE_URL"

wait_for_health_up "$BASE_URL" "$TIMEOUT_SECS" || fail "Backend is not reachable: $BASE_URL/health"

if [[ "$REQUIRE_UI" == "1" ]]; then
  ui_smoke "$BASE_URL" "$MAX_ASSETS"
fi

wait_for_opencode_ready "$BASE_URL" "$TIMEOUT_SECS"
session_smoke "$BASE_URL" "$DIRECTORY"

log "PASS"
