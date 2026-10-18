#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "Bootstrap failed at line %s\n" "$LINENO" >&2' ERR

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
with_autostart=0
with_permissions=0
for argument in "$@"; do
  case "$argument" in
    --with-autostart) with_autostart=1 ;;
    --with-permissions) with_permissions=1 ;;
    -h|--help)
      printf 'Usage: %s [--with-autostart] [--with-permissions]\n' "${0##*/}"
      exit 0
      ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

as_root() {
  if [[ "$EUID" -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update
    as_root apt-get install -y "$@"
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y "$@"
  elif command -v pacman >/dev/null 2>&1; then
    as_root pacman -S --needed --noconfirm "$@"
  elif command -v zypper >/dev/null 2>&1; then
    as_root zypper --non-interactive install "$@"
  else
    printf 'Unsupported package manager. Install Node.js >= 22, npm and Flatpak, then rerun.\n' >&2
    return 1
  fi
}

if [[ "$(uname -s)" != Linux ]]; then
  printf 'Use bootstrap.ps1 on Windows. This script requires Linux.\n' >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  install_packages nodejs npm
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js >= 22 is required; upgrade using your distribution package manager."); process.exit(1); }'

if ! command -v moonlight >/dev/null 2>&1; then
  if ! command -v flatpak >/dev/null 2>&1; then install_packages flatpak; fi
  if ! flatpak info com.moonlight_stream.Moonlight >/dev/null 2>&1; then
    if [[ "$EUID" -eq 0 ]]; then
      printf 'Run bootstrap as your desktop user so Moonlight uses the correct user profile.\n' >&2
      exit 1
    fi
    flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
    flatpak install --user --noninteractive -y flathub com.moonlight_stream.Moonlight
    flatpak info com.moonlight_stream.Moonlight >/dev/null
  fi
fi

cd -- "$project_root"
npm ci --no-audit --no-fund
if [[ "$with_permissions" -eq 1 ]]; then
  "$project_root/scripts/linux/setup-permissions.sh"
fi
if [[ "$with_autostart" -eq 1 ]]; then
  "$project_root/scripts/linux/install-autostart.sh"
fi
printf 'Bootstrap complete. Run npm start. Pair Moonlight with your host before streaming.\n'

