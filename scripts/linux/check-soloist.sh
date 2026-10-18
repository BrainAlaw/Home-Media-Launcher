#!/usr/bin/env bash
set -Eeuo pipefail

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
