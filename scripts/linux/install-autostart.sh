#!/usr/bin/env bash
set -Eeuo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
mode="systemd"
action="install"

usage() {
  printf 'Usage: %s [--desktop-entry] [--uninstall] [--dry-run]\n' "${0##*/}"
}
while (($#)); do
  case "$1" in
    --desktop-entry) mode="desktop" ;;
    --uninstall) action="uninstall" ;;
    --dry-run) dry_run=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
: "${dry_run:=0}"
run() { printf '+'; printf ' %q' "$@"; printf '\n'; if [[ "$dry_run" -eq 0 ]]; then "$@"; fi; }

if [[ "$mode" == systemd ]]; then
  unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  unit_path="$unit_dir/home-media-launcher.service"
  if [[ "$action" == uninstall ]]; then
    run rm -f -- "$unit_path"
    run systemctl --user disable --now home-media-launcher.service
    run systemctl --user daemon-reload
  else
    if [[ "$dry_run" -eq 1 ]]; then
      printf 'Would write %s with project path %s\n' "$unit_path" "$project_root"
    else
      mkdir -p -- "$unit_dir"
      cat > "$unit_path" <<EOF
[Unit]
Description=Home Media Launcher
After=graphical-session.target
Wants=graphical-session.target

[Service]
Type=simple
WorkingDirectory=$project_root
ExecStart=/usr/bin/env -u ELECTRON_RUN_AS_NODE npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF
    fi
    run systemctl --user daemon-reload
    run systemctl --user enable home-media-launcher.service
  fi
else
  desktop_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
  desktop_path="$desktop_dir/home-media-launcher.desktop"
  if [[ "$action" == uninstall ]]; then
    run rm -f -- "$desktop_path"
  else
    if [[ "$dry_run" -eq 1 ]]; then
      printf 'Would write %s with project path %s\n' "$desktop_path" "$project_root"
    else
      mkdir -p -- "$desktop_dir"
      cat > "$desktop_path" <<EOF
[Desktop Entry]
Type=Application
Name=Home Media Launcher
Comment=Start Home Media Launcher at login
Exec=/usr/bin/env -u ELECTRON_RUN_AS_NODE npm --prefix "$project_root" start
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
    fi
  fi
fi
