# Round R01: first six-agent round

Goal: prove the multi-agent protocol (`AGENTS.md` section 3) on six tasks that do not touch the same files, while closing small gaps from `CURRENT_STATE.md`.

Base: `main` at the commit that adds this file. Every agent works in its own worktree on its own branch.

## Tasks

| Agent | Tier | Worktree | Branch | Task |
|---|---|---|---|---|
| `claude` | L | `D:\Github Repos\hml-claude` | `r01/claude` | Clean up `CURRENT_STATE.md`; build a gamepad end-to-end harness (`scripts/e2e/`) that drives the real app and captures the real display; write the bug list for R02 |
| `codex` | M | `D:\Github Repos\hml-codex` | `r01/codex` | Linux HTPC set-up kit: extend `scripts/bootstrap.sh`, add `scripts/linux/*` (systemd user service, input group, udev and polkit rules, Soloist check), write `backend/LINUX.md` |
| `copilot` | S | `D:\Github Repos\hml-copilot` | `r01/copilot` | New test file `test/config-roundtrip.test.js` for the settings keys added in iterations 5-7 |
| `freebuff` | S | `D:\Github Repos\hml-freebuff` | `r01/freebuff` | `npm run doctor`: report which `.env` keys are set (names only) and which tools are on PATH |
| `opencode` | S | `D:\Github Repos\hml-opencode` | `r01/opencode` | Remove dead code: `createHeroBinding` and the unused `motionScheduler` |
| `cursor` | S | `D:\Github Repos\hml-cursor` | `r01/cursor` | New `docs/GETTING_STARTED.md` and `docs/TROUBLESHOOTING.md`, one link line in `README.md` |

## File ownership map

No file is owned by two agents. Everything not listed is read-only for everyone in this round.

| Agent | Owned files |
|---|---|
| `claude` | `CURRENT_STATE.md`, `scripts/e2e/**`, `.gitignore`, `agents/state/CURRENT_STATE_claude.md` |
| `codex` | `scripts/bootstrap.sh`, `scripts/linux/**`, `backend/LINUX.md`, `test/linux-scripts.test.js`, `agents/state/CURRENT_STATE_codex.md` |
| `copilot` | `test/config-roundtrip.test.js`, `agents/state/CURRENT_STATE_copilot.md` |
| `freebuff` | `scripts/doctor.cjs`, `test/doctor.test.js`, `package.json` (only the one `"doctor"` line), `agents/state/CURRENT_STATE_freebuff.md` |
| `opencode` | `src/renderer/launch-session.js`, `test/launch-session.test.js`, `src/renderer/app.js` (only the two lines named in the prompt), `agents/state/CURRENT_STATE_opencode.md` |
| `cursor` | `docs/GETTING_STARTED.md`, `docs/TROUBLESHOOTING.md`, `README.md` (only one added line), `agents/state/CURRENT_STATE_cursor.md` |

## Merge order (coordinator)

`opencode` → `copilot` → `freebuff` → `codex` → `cursor` → `claude`. After each merge: `npm run check`. After the last merge: run the app and verify on the real display.

## What the user does

Open each tool in its worktree folder and paste the line below.

| Tool | Folder to open | Paste |
|---|---|---|
| Claude Code | `D:\Github Repos\hml-claude` | `Read AGENTS.md and agents/rounds/R01/claude.md, then follow the prompt.` |
| Codex | `D:\Github Repos\hml-codex` | `Read AGENTS.md and agents/rounds/R01/codex.md, then follow the prompt.` |
| GitHub Copilot (agent mode) | `D:\Github Repos\hml-copilot` | `Read AGENTS.md and agents/rounds/R01/copilot.md, then follow the prompt.` |
| Freebuff | `D:\Github Repos\hml-freebuff` | `Read AGENTS.md and agents/rounds/R01/freebuff.md, then follow the prompt.` |
| OpenCode | `D:\Github Repos\hml-opencode` | `Read AGENTS.md and agents/rounds/R01/opencode.md, then follow the prompt.` |
| Cursor | `D:\Github Repos\hml-cursor` | `Read AGENTS.md and agents/rounds/R01/cursor.md, then follow the prompt.` |

When they are done (or out of budget), ask Claude Code in the main checkout for the next actions.
