#!/usr/bin/env bash
set -euo pipefail

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
echo "If you also want to remove binaries/data:"
echo "  rm -f $HOME/.local/bin/opencode-studio"
echo "  rm -rf $HOME/.local/share/opencode-studio"
