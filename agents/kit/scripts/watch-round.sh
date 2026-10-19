#!/usr/bin/env bash
# Live, read-only view of the active rounds in your terminal. Runs until Ctrl+C.
#
# Drawing: the cursor goes back to the top and each line is overwritten in place. The screen is never cleared, so
# nothing flashes. When the content has not changed, nothing is written at all.
#
# What is shown: only rounds with at least one agent that is not final yet (DONE, PARTIAL, BLOCKED, OUT_OF_BUDGET).
# A round whose agents are all final disappears from the view. Rounds are discovered on every refresh from the
# worktrees in .worktrees/r<NN>-<agent>, so a new round appears on its own. No restart needed.
#
#   watch-round.sh                  all active rounds, refresh every 10 s
#   INTERVAL=5 watch-round.sh       custom refresh
#   watch-round.sh 08               only round 08

set -euo pipefail

INTERVAL="${INTERVAL:-10}"
ONLY_ROUND="${1:-}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel)"
WT="$ROOT/.worktrees"
FINAL_STATUSES=" DONE PARTIAL BLOCKED OUT_OF_BUDGET "

# Restore the cursor and leave the last frame on screen when the script stops.
cleanup() { printf '\033[?25h\n'; exit 0; }
trap cleanup INT TERM

# Prints one line per round: "<NN> <agent> <agent> ..." sorted by round.
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

# Builds the whole frame as text. Pure output, so the caller can compare two frames.
frame() {
  local rounds round agents status_out first_status shown=0 line
  rounds="$(discover_rounds)"
  while read -r round agents; do
    [ -n "$round" ] || continue
    # shellcheck disable=SC2086
    status_out="$(bash "$DIR/status.sh" "$round" $agents 2>/dev/null || true)"
    # Keep the round only if some agent is not final yet (the STATUS column is the second field).
    local active=0
    while read -r line; do
      first_status="$(echo "$line" | awk '{print $2}')"
      case "$FINAL_STATUSES" in *" $first_status "*) ;; *) active=1 ;; esac
    done < <(tail -n +2 <<< "$status_out" | grep -v '^$' | grep -v 'no worktree' || true)
    [ "$active" -eq 1 ] || continue
    shown=$((shown + 1))
    printf '== round R%s\n%s\n\n' "$round" "$status_out"
  done <<< "$rounds"
  if [ "$shown" -eq 0 ]; then
    printf 'no active round. Finished rounds are hidden; new worktrees appear here on their own.\n'
  fi
}

printf '\033[?25l\033[2J\033[H'
printf 'active rounds · refresh every %ss · Ctrl+C to stop\n\n' "$INTERVAL"
prev=""
while true; do
  cur="$(frame)"
  if [ "$cur" != "$prev" ]; then
    # Home the cursor, rewrite every line, clear each line's tail and everything below the frame.
    printf '\033[3;1H'
    while IFS= read -r line; do printf '%s\033[K\n' "$line"; done <<< "$cur"
    printf '\033[J'
    prev="$cur"
  fi
  sleep "$INTERVAL"
done
