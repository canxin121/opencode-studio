#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR=""
REMOVE_INSTALL_DIR="0"

usage() {
  cat <<'EOF'
Usage:
  uninstall-service.sh [--install-dir PATH] [--remove-install-dir]

Notes:
  - Removes opencode-studio service units/agents.
  - By default install files are kept.
  - Use --remove-install-dir to also delete install files.
  - Default install dir: ~/opencode-studio
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --remove-install-dir) REMOVE_INSTALL_DIR="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$INSTALL_DIR" ]]; then
  INSTALL_DIR="$HOME/opencode-studio"
fi

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

assert_safe_install_dir() {
  local path="$1"

  if [[ -z "${path// }" ]]; then
    echo "Invalid install directory: '$path'" >&2
    exit 2
  fi

  case "$path" in
    "/"|"/bin"|"/sbin"|"/lib"|"/lib64"|"/usr"|"/etc"|"/var"|"/tmp"|"/opt"|"/home"|"/Users"|"/System"|"/Applications")
      echo "Refusing to delete protected directory: $path" >&2
      exit 2
      ;;
  esac

  if [[ "$path" == "$HOME" ]]; then
    echo "Refusing to delete HOME directory: $path" >&2
    exit 2
  fi
}

remove_install_dir_with_retry() {
  local path="$1"
  local max_attempts="8"
  local attempt=""

  for attempt in $(seq 1 "$max_attempts"); do
    if [[ ! -e "$path" ]]; then
      return 0
    fi

    rm -rf "$path" >/dev/null 2>&1 || true
    if [[ -e "$path" ]]; then
      sudo rm -rf "$path" >/dev/null 2>&1 || true
    fi

    if [[ ! -e "$path" ]]; then
      return 0
    fi

    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep 1
    fi
  done

  return 1
}

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

if [[ "$OS" == "linux" ]]; then
  if command -v systemctl >/dev/null 2>&1; then
    echo "Attempting to remove systemd user service (if installed)..."
    systemctl --user disable --now opencode-studio.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/opencode-studio.service" || true
    systemctl --user daemon-reload >/dev/null 2>&1 || true

    echo "Attempting to remove systemd system service (if installed)..."
    sudo systemctl disable --now opencode-studio.service >/dev/null 2>&1 || true
    sudo rm -f "/etc/systemd/system/opencode-studio.service" || true
    sudo systemctl daemon-reload >/dev/null 2>&1 || true
  fi
elif [[ "$OS" == "darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/cn.cxits.opencode-studio.plist"
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST" || true
fi

echo "Uninstall finished (service units removed)."

INSTALL_DIR="$(normalize_path "$INSTALL_DIR")"

if [[ "$REMOVE_INSTALL_DIR" == "1" ]]; then
  assert_safe_install_dir "$INSTALL_DIR"
  if [[ -e "$INSTALL_DIR" ]]; then
    if remove_install_dir_with_retry "$INSTALL_DIR"; then
      echo "Removed install directory: $INSTALL_DIR"
    else
      echo "Failed to remove install directory (in use or insufficient permissions): $INSTALL_DIR" >&2
      exit 1
    fi
  else
    echo "Install directory not found (already removed): $INSTALL_DIR"
  fi
else
  echo "Install files kept at: $INSTALL_DIR"
  echo "To remove files too, rerun with --remove-install-dir."
fi
