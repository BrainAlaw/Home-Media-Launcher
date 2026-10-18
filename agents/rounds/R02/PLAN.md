# Round R02: remote-friendly launched apps, stage A (websites and webapps)

Goal: an app started from the launcher (website or chromium webapp) can be driven with a gamepad or a Bluetooth TV remote, and a long press on Home (or the gamepad Guide button) returns to the launcher. Stage B (native apps, Linux `uinput`) comes in a later round, after A is merged and checked on screen.

Base: `main` (commit of this file). Linux HTPC is the target; the dev machine is Windows.

## Tasks

| Agent | Tier | Worktree | Branch | Task |
|---|---|---|---|---|
| `codex` | M | `D:\Github Repos\hml-r02-codex` | `r02/codex` | Pad and remote key mapping for web app windows, long-press Home to exit (see `codex.md`) |
| `claude` | L | `D:\Github Repos\hml-r02-claude` | `r02/claude` | Verification page and harness for web app windows (see `claude.md`); merge, real-display check |

## File ownership

| Agent | Owned files |
|---|---|
| `codex` | `src/main/web-preload.js`, `backend/remote-keymap.json` (new), `src/main/remote-keymap.js` (new, reads the JSON and builds the argument for the preload), `test/remote-keymap.test.js` (new), `backend/REMOTE-APPS.md` (new), `agents/state/CURRENT_STATE_codex.md` |
| `claude` | `scripts/e2e/web-app-check.cjs` (new), `scripts/e2e/fixtures/**` (new), `agents/state/CURRENT_STATE_claude.md` |

Shared (one-line change only, described in `codex.md`): `src/main/index.js`, where the website window is created (`openWebsite`).

## Merge order

1. `codex` (on `main`, after its state file says DONE and `npm run check` passes in its worktree)
2. `claude` (verification harness only, no app code)
3. Coordinator: run `web-app-check.cjs` on the real display, read the screenshots, then ask the user before stage B.

## What the user does

| Tool | Folder | Paste |
|---|---|---|
| Codex | `D:\Github Repos\hml-r02-codex` | `Read AGENTS.md and agents/rounds/R02/codex.md, then follow the prompt.` |
