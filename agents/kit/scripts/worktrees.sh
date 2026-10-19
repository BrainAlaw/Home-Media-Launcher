#!/usr/bin/env bash
# Round worktrees for multi-agent work (see agents/kit/README.md).
#
#   worktrees.sh create <NN> <agent> [agent...]   one worktree per agent: .worktrees/r<NN>-<agent> on branch r<NN>/<agent>
#   worktrees.sh remove <NN> <agent> [agent...]   unlink LINK_DIRS, remove the worktree, delete the branch (if merged)
#   worktrees.sh list                             show all worktrees
#
# Environment:
#   BASE        base branch for new worktrees (default: main)
#   LINK_DIRS   space-separated folders from the main checkout to link into each worktree (for example: "node_modules")
#
# Linked folders are junctions on Windows and symlinks elsewhere. `remove` unlinks them first, so the main checkout's
# folders are never deleted.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WT_DIR="$ROOT/.worktrees"
BASE="${BASE:-main}"
LINK_DIRS="${LINK_DIRS:-}"

is_windows() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

to_native() {
  if is_windows; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

link_dir() {
  local source="$1" link="$2"
  if is_windows; then
    # PowerShell, not cmd: Git Bash rewrites the /J switch and quoting breaks for paths with spaces.
    powershell.exe -NoProfile -Command "New-Item -ItemType Junction -Path '$(to_native "$link")' -Target '$(to_native "$source")' | Out-Null"
  else
    ln -s "$source" "$link"
  fi
}

unlink_dir() {
  local link="$1"
  if is_windows; then
    # Directory.Delete without recursion removes a junction only; it refuses a real non-empty folder, which is the safe behaviour.
    powershell.exe -NoProfile -Command "[System.IO.Directory]::Delete('$(to_native "$link")')"
  elif [ -L "$link" ]; then
    rm "$link"
  fi
}

create() {
  local round="$1"; shift
  mkdir -p "$WT_DIR"
  for agent in "$@"; do
    local name="r$round-$agent" branch="r$round/$agent"
    local path="$WT_DIR/$name"
    git -C "$ROOT" worktree add "$path" -b "$branch" "$BASE"
    for dir in $LINK_DIRS; do
      if [ -d "$ROOT/$dir" ] && [ ! -e "$path/$dir" ]; then
        link_dir "$ROOT/$dir" "$path/$dir"
      fi
    done
    echo "created $path on $branch"
  done
}

remove() {
  local round="$1"; shift
  for agent in "$@"; do
    local name="r$round-$agent" branch="r$round/$agent"
    local path="$WT_DIR/$name"
    for dir in $LINK_DIRS; do
      if [ -e "$path/$dir" ] || [ -L "$path/$dir" ]; then
        unlink_dir "$path/$dir"
      fi
    done
    git -C "$ROOT" worktree remove "$path"
    git -C "$ROOT" branch -d "$branch"
    echo "removed $path and branch $branch"
  done
}

cmd="${1:-}"
shift || true
case "$cmd" in
  create)
    [ $# -ge 2 ] || { echo "usage: worktrees.sh create <NN> <agent> [agent...]" >&2; exit 2; }
    create "$@" ;;
  remove)
    [ $# -ge 2 ] || { echo "usage: worktrees.sh remove <NN> <agent> [agent...]" >&2; exit 2; }
    remove "$@" ;;
  list)
    git -C "$ROOT" worktree list ;;
  *)
    echo "usage: worktrees.sh {create|remove|list} ..." >&2
    exit 2 ;;
esac
