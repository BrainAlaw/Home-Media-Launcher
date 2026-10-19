#!/usr/bin/env bash
# Read-only progress view of one round: one line per agent. No log files are read or needed.
#   status.sh <NN> <agent> [agent...]
# Columns: status (from the state file), ticked items, commits ahead of main, uncommitted files, idle time.
# A state file counts only when its header names this round (a file inherited from an earlier round shows STALE).

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WT="$ROOT/.worktrees"

[ $# -ge 2 ] || { echo "usage: status.sh <NN> <agent> [agent...]" >&2; exit 2; }
round="$1"; shift
round_id="R$round"
round_lower="r$round"

FINAL_STATUSES=" DONE PARTIAL BLOCKED OUT_OF_BUDGET "
limited=()

printf '%-9s %-12s %-8s %-7s %-7s %-6s %s\n' AGENT STATUS TICKED AHEAD DIRTY LIMIT IDLE

# Coarse age of the newest file in the worktree: now, 5m, 2h, 3d. Works for any agent that writes to its worktree,
# including a chat subagent. Skips dependencies and git internals.
idle_label() {
  local dir="$1" newest now age
  # Only the folders agents write to. The large asset folders (wallpapers, icons, fonts) never change during a round.
  newest="$(find "$dir/src" "$dir/backend" "$dir/test" "$dir/agents" "$dir/docs" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -n 1)"
  [ -n "$newest" ] || { echo "-"; return; }
  now="$(date +%s)"
  age=$(( now - ${newest%.*} ))
  if [ "$age" -lt 60 ]; then echo "now"
  elif [ "$age" -lt 3600 ]; then echo "$(( age / 60 ))m"
  elif [ "$age" -lt 86400 ]; then echo "$(( age / 3600 ))h"
  else echo "$(( age / 86400 ))d"; fi
}

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
  # A usage limit is read from the CLI's own output (the run log that the launcher wrote), not from the agent's files.
  # It matters only while the agent is not final. Reading this file costs no agent tokens.
  limit="-"
  runlog="$WT/logs/$round_lower-$agent.log"
  case "$FINAL_STATUSES" in *" $status "*) ;; *)
    if [ -f "$runlog" ] && tail -n 300 "$runlog" | grep -q -i -E "usage limit|rate limit|quota exceeded|ActionRequiredError"; then
      limit="LIMIT"
      limited+=("$agent")
    fi ;;
  esac
  printf '%-9s %-12s %-8s %-7s %-7s %-6s %s\n' "$agent" "$status" "$ticked" "$ahead" "$dirty" "$limit" "$(idle_label "$dir")"
done

# For every agent that hit a limit: the manual fallback, pasted by hand into a CLI window (last resort only).
# One line per agent, starting with MANUAL, so watch-round.sh can collect them below the table.
for agent in ${limited[@]+"${limited[@]}"}; do
  printf 'MANUAL %s %s/%s-%s :: Read AGENTS.md and agents/rounds/%s/%s.md, then follow the prompt.\n' \
    "$agent" "$WT" "$round_lower" "$agent" "$round_id" "$agent"
done
