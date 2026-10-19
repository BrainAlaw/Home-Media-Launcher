#!/usr/bin/env bash
# Live, read-only view of every active round in your terminal. Runs until Ctrl+C.
#
# Rounds are discovered on every refresh from the worktrees in .worktrees/r<NN>-<agent>, so a new round appears
# on its own and a finished round disappears once its worktrees are removed. No restart needed.
#
#   watch-round.sh                  all active rounds, refresh every 10 s
#   INTERVAL=5 watch-round.sh       custom refresh
#   watch-round.sh 07               only round 07

set -euo pipefail

INTERVAL="${INTERVAL:-10}"
ONLY_ROUND="${1:-}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel)"
WT="$ROOT/.worktrees"

trap 'printf "\nstopped\n"; exit 0' INT TERM

# Prints one line per active round: "<NN> <agent> <agent> ..." sorted by round.
discover_rounds() {
  [ -d "$WT" ] || return 0
  local dir name round agent
  declare -A agents_by_round=()
  for dir in "$WT"/r[0-9]*-*; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    round="${name%%-*}"          # r07
    agent="${name#*-}"           # codex
    round="${round#r}"           # 07
    if [ -n "$ONLY_ROUND" ] && [ "$round" != "$ONLY_ROUND" ]; then continue; fi
    agents_by_round["$round"]+="$agent "
  done
  for round in $(printf '%s\n' "${!agents_by_round[@]}" | sort); do
    echo "$round ${agents_by_round[$round]}"
  done
}

while true; do
  printf '\033c'
  printf 'active rounds, refresh every %ss  ·  %s  ·  Ctrl+C to stop\n' "$INTERVAL" "$(date '+%H:%M:%S')"
  rounds="$(discover_rounds)"
  if [ -z "$rounds" ]; then
    printf '\nno active round (no worktrees in .worktrees/). Waiting...\n'
  else
    while read -r round agents; do
      printf '\n== round R%s\n' "$round"
      # shellcheck disable=SC2086
      bash "$DIR/status.sh" "$round" $agents || true
    done <<< "$rounds"
  fi
  sleep "$INTERVAL"
done
