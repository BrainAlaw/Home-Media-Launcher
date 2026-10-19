#!/usr/bin/env bash
# Read-only progress view of one round: one line per agent.
#   status.sh <NN> <agent> [agent...]
# Columns: status, ticked items, commits ahead of main, uncommitted files, last log line.
# A state file counts only when its header names this round (a file inherited from an earlier round shows STALE).

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WT="$ROOT/.worktrees"
LOGS="$WT/logs"

[ $# -ge 2 ] || { echo "usage: status.sh <NN> <agent> [agent...]" >&2; exit 2; }
round="$1"; shift
round_id="R$round"
round_lower="r$round"

printf '%-9s %-12s %-8s %-7s %-7s %s\n' AGENT STATUS TICKED AHEAD DIRTY "LAST LOG LINE"

for agent in "$@"; do
  dir="$WT/$round_lower-$agent"
  state="$dir/agents/state/CURRENT_STATE_$agent.md"
  if [ ! -d "$dir" ]; then
    printf '%-9s %s\n' "$agent" "no worktree"
    continue
  fi

  status="MISSING"; ticked="-"
  if [ -f "$state" ]; then
    if grep -qE "^#.*\(round $round_id\)" "$state"; then
      status="$(grep -m1 -oE '^Status: [A-Z_]+' "$state" | sed 's/Status: //')"
      status="${status:-NO_STATUS}"
      done_n="$(grep -c '\[x\]' "$state" || true)"
      all_n="$(grep -cE '\[[ x]\]' "$state" || true)"
      ticked="$done_n/$all_n"
    else
      status="STALE"
    fi
  fi

  ahead="$(git -C "$dir" rev-list --count "main..HEAD" 2>/dev/null || echo '?')"
  dirty="$(git -C "$dir" status --short | wc -l | tr -d ' ')"
  last="$(tr -d '\r' < "$LOGS/$round_lower-$agent.log" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n 1 | cut -c1-70 || true)"

  printf '%-9s %-12s %-8s %-7s %-7s %s\n' "$agent" "$status" "$ticked" "$ahead" "$dirty" "$last"
done
