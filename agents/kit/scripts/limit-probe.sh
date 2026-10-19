#!/usr/bin/env bash
# Checks whether agents that hit a usage limit can run again. Only agents that currently show LIMIT are checked: those
# have a prompt file in .worktrees/manual. Nothing is sent when no agent is limited.
#
# Each check sends one tiny prompt with that agent's own CLI, from a temporary folder, with no tools and no write access.
# The result goes to .worktrees/manual/probe-r<NN>-<agent>.txt as one line:
#   ok <time>       the CLI answered PONG: the limit is gone (status.sh stops showing LIMIT)
#   limit <time>    the CLI reported the limit again
#   error <time>    anything else (network, login, missing CLI): the next run tries again
# An agent checked successfully in the last 25 minutes is skipped, so a 30-minute schedule never sends two checks in a row.

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MANUAL="$ROOT/.worktrees/manual"
PROMPT="Reply with exactly the word PONG and nothing else."
PROBE_DIR="${TMPDIR:-/tmp}/hml-limit-probe"
LIMIT_RE="hit your usage limit|hit its usage limit|ActionRequiredError|rate limit exceeded|quota exceeded"

shopt -s nullglob
files=("$MANUAL"/r[0-9]*-*.md)
[ "${#files[@]}" -gt 0 ] || exit 0

mkdir -p "$PROBE_DIR"
cd "$PROBE_DIR" || exit 1

for file in "${files[@]}"; do
  base="$(basename "$file" .md)"           # r11-cursor
  agent="${base#*-}"                       # cursor
  out="$MANUAL/probe-$base.txt"
  now="$(date '+%Y-%m-%d %H:%M')"

  # Skip an agent that was checked successfully in the last 25 minutes.
  if [ -f "$out" ] && grep -q '^ok' "$out" && [ $(( $(date +%s) - $(stat -c %Y "$out") )) -lt 1500 ]; then
    echo "$base: checked ok recently, skipped"
    continue
  fi

  case "$agent" in
    codex)    text="$(codex exec --skip-git-repo-check "$PROMPT" 2>&1)"; rc=$? ;;
    copilot)  text="$(copilot -p "$PROMPT" -s 2>&1)"; rc=$? ;;
    opencode) text="$(opencode run -m opencode/big-pickle "$PROMPT" 2>&1)"; rc=$? ;;
    cursor)   text="$(powershell.exe -NoProfile -Command '& "$env:LOCALAPPDATA\cursor-agent\agent.ps1" -p "Reply with exactly the word PONG and nothing else." --trust --output-format text' 2>&1)"; rc=$? ;;
    *)        echo "$base: no probe for this CLI"; continue ;;
  esac

  if echo "$text" | grep -q -i -E "$LIMIT_RE"; then
    result="limit"
  elif [ "$rc" -eq 0 ] && echo "$text" | tr -d '\r' | grep -q -E '^PONG[[:space:]]*$'; then
    result="ok"
  else
    result="error"
  fi
  printf '%s %s\n' "$result" "$now" > "$out"
  echo "$base: $result"
done
