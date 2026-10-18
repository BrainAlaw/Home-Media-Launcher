#!/usr/bin/env bash
set -Eeuo pipefail

dry_run=0
if (($#)); then
  case "$1" in
    --dry-run) dry_run=1 ;;
    -h|--help) printf 'Usage: %s [--dry-run]\n' "${0##*/}"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
fi
if (($#)); then printf 'Unexpected arguments.\n' >&2; exit 2; fi

architecture="$(uname -m)"
case "$architecture" in
  x86_64) build="x86_64" ;;
  aarch64) build="aarch64" ;;
  armv7l) build="armv7" ;;
  *) build="unsupported" ;;
esac
if command -v soloist >/dev/null 2>&1; then
  printf 'Soloist: installed (%s)\n' "$(command -v soloist)"
  if version="$(soloist --version 2>&1)"; then printf 'Version: %s\n' "$version"; else printf 'Version: unavailable (exit %s)\n' "$?"; fi
else
  printf 'Soloist: not found on PATH\n'
fi
printf 'CPU architecture: %s -> Soloist build: %s\n' "$architecture" "$build"
