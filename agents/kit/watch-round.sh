#!/usr/bin/env bash
# Live, read-only view of a round in your terminal. Refreshes status.sh every few seconds. Ctrl+C to stop.
#   watch-round.sh <NN> <agent> [agent...]         default refresh 10 s
#   INTERVAL=5 watch-round.sh 07 claude codex      custom refresh

set -euo pipefail

[ $# -ge 2 ] || { echo "usage: watch-round.sh <NN> <agent> [agent...]" >&2; exit 2; }
INTERVAL="${INTERVAL:-10}"
DIR="$(cd "$(dirname "$0")" && pwd)"

trap 'printf "\nstopped\n"; exit 0' INT TERM

while true; do
  printf '\033c'
  printf 'round R%s  ·  refresh every %ss  ·  %s  ·  Ctrl+C to stop\n\n' "$1" "$INTERVAL" "$(date '+%H:%M:%S')"
  bash "$DIR/status.sh" "$@" || true
  sleep "$INTERVAL"
done
