#!/usr/bin/env bash
set -Eeuo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
dry_run=0
with_networkmanager=0
while (($#)); do
  case "$1" in
    --networkmanager) with_networkmanager=1 ;;
    --dry-run) dry_run=1 ;;
    -h|--help) printf 'Usage: %s [--networkmanager] [--dry-run]\n' "${0##*/}"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

run_privileged() {
  printf 'Requires administrator access: '
  printf '%q ' "$@"
  printf '\n'
  if [[ "$dry_run" -eq 1 ]]; then return; fi
  if [[ "$EUID" -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

if ! id -nG "$USER" | tr ' ' '\n' | grep -Fxq input; then
  printf 'Adding %s to the input group for /dev/input/event* access. A new login is required.\n' "$USER"
  if [[ "$dry_run" -eq 0 ]]; then
    if [[ "$EUID" -eq 0 ]]; then usermod -aG input "$USER"; else sudo usermod -aG input "$USER"; fi
  else
    printf 'Would run: usermod -aG input %q\n' "$USER"
  fi
else
  printf '%s is already in the input group.\n' "$USER"
fi

run_privileged install -D -m 0644 "$project_root/scripts/70-vibepollo-xone.rules" /etc/udev/rules.d/70-vibepollo-xone.rules
if [[ "$with_networkmanager" -eq 1 ]]; then
  if [[ "$dry_run" -eq 1 ]]; then
    printf 'Would install /etc/polkit-1/rules.d/49-home-media-launcher-networkmanager.rules for active local users managing own NetworkManager connections.\n'
  else
    temp_rule="$(mktemp)"
    trap 'rm -f -- "$temp_rule"' EXIT
    cat > "$temp_rule" <<'RULE'
polkit.addRule(function(action, subject) {
  if (action.id === "org.freedesktop.NetworkManager.settings.modify.own" && subject.local && subject.active) {
    return polkit.Result.YES;
  }
});
RULE
    run_privileged install -D -m 0644 "$temp_rule" /etc/polkit-1/rules.d/49-home-media-launcher-networkmanager.rules
  fi
fi
if [[ "$dry_run" -eq 0 ]]; then
  run_privileged udevadm control --reload-rules
  run_privileged udevadm trigger
else
  printf 'Would reload udev rules and trigger devices.\n'
fi
