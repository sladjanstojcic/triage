#!/bin/sh
# Keep Triage running in the background (production build) and start it at login.
#   pnpm service:install    build + install/restart the LaunchAgent
#   pnpm service:uninstall  stop it and remove the LaunchAgent
set -eu

LABEL="dev.triage.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/triage.log"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

case "${1:-}" in
  install)
    PNPM="$(xml "$(command -v pnpm)")"
    XDIR="$(xml "$DIR")"
    XPATH="$(xml "$PATH")"
    cd "$DIR"
    pnpm build
    mkdir -p "$(dirname "$PLIST")"
    # PATH is captured now so launchd can find node, docker, git, tailscale, ssh.
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$XDIR</string>
  <key>ProgramArguments</key>
  <array><string>$PNPM</string><string>start</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$XPATH</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Triage running at http://127.0.0.1:4777 (logs: $LOG)"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Triage LaunchAgent removed"
    ;;
  *)
    echo "usage: $0 install|uninstall" >&2
    exit 1
    ;;
esac
