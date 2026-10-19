# Home Media Launcher: rules for every AI agent

Repository: https://github.com/BrainAlaw/Home-Media-Launcher

This file is read by every coding agent working on this repository (Claude Code, Codex, GitHub Copilot, OpenCode, Cursor). Read it completely before you touch anything, then read the prompt file you were given.

## 1. The project

Home Media Launcher is a custom, local-first, ad-free HTPC and living-room console dashboard. Linux is the primary target, Windows is supported. The look follows Apple's tvOS (Apple HIG, glassmorphism, spring-physics motion) with the game-centric utility of handhelds like the Steam Deck: zero bloat, instant cold starts, deep customisation.

- **Input:** gamepad first (HTML5 Gamepad API) and keyboard/TV remote. Mouse is secondary and never required.
- **Performance:** 60-120 fps on low-power HTPC hardware. Animate only `transform` and `opacity`.
- **Integration:** the remote Vibepollo host (Sunshine/Moonlight APIs, Playnite) for game streaming, native binaries, fullscreen web apps, Spotify (Web API + Soloist).
- **Offline resilience:** aggressive local caching; a subtle offline indicator when the host is unreachable.
- **Stack:** Electron, vanilla JavaScript (CommonJS in main, classic `<script>` files in the renderer), CSS custom properties, `node:test`. No build step.

Orientation documents: `CURRENT_STATE.md` (overall state, owned by the coordinator), `backend/DESIGN.md` (design tokens), `backend/*.md` (one per subsystem: SPOTIFY, SOLOIST, VPN, ICONS, REMOTES, SESSION, THEMING, MENU-PERFORMANCE).

## 2. Universal coding rules

- **Zero telemetry, local first.** No tracking, no analytics, no new cloud services.
- **Non-blocking.** Polling, file I/O and process spawning never block the renderer; use the async IPC bridge (`window.launcher.ext.invoke(namespace, method, ...)`, modules in `src/main/ext/`).
- **English only** in code, identifiers, comments and commit messages. **UK spelling** in user-facing documentation.
- **No stubs, no placeholders, no `// TODO: implement`.** Deliver working code with `node:test` tests for pure logic.
- **No new npm dependencies** unless your prompt file explicitly allows it.
- **Classic renderer scripts share one global scope.** Never declare a top-level `const`/`let`/`function`/`class` name that another renderer script already declares (wrap new files in an IIFE or UMD block). `test/renderer-globals.test.js` enforces this.
- **Secrets (worker agents).** Worker agents never read, print, copy or commit `.env`, `remote-token.json`, `spotify-tokens.json` or any token, and never copy secrets into a worktree or branch. The coordinator (Claude Code) has access to `.env` and may read it. Keys are read only by `backend/env.js` in the main process and must never reach the renderer, logs or error messages.
- **Every user-facing setting is in the admin panel.** A new setting is registered in `backend/settings-descriptor.js` in the same commit that adds it, or listed in `INTERNAL_PATHS` with a reason. `test/settings-descriptor.test.js` enforces it. A feature is not done until its setting or action is reachable from the admin panel.
- **Ignored paths.** Respect `.claudecodeignore`: never scan or paste `node_modules/`, `dist/`, `build/`, `.git/`, media assets, images or videos into your context.
- **Before you commit:** `npm run check` must pass (syntax checks plus every test). On Windows run Electron with `ELECTRON_RUN_AS_NODE` unset.
- **Visual changes** must be verified on the real display (fullscreen window plus a real screen capture), never with `webContents.capturePage` alone. If you cannot run the app, say so in your state file; do not claim it works.

## 3. How multi-agent work is organised

Several agents work **at the same time**, each in its **own git worktree and branch**, on a **disjoint set of files**. Claude Code is the coordinator. The project-independent version of this process (templates, worktree script) is in `agents/kit/`.

### 3.1 Roster

| Agent id | Tool | Budget | Typical work |
|---|---|---|---|
| `claude` | Claude Code | large | coordinator; as a worker it runs as a subagent of the coordinator chat, never `claude -p`; takes the hardest cross-cutting task and real-display verification |
| `codex` | OpenAI Codex (paid, limited plan) | medium, larger | the main worker for medium and larger tasks (backend modules, integration, editors, tests); several independent medium tasks per round, one per branch |
| `copilot` | GitHub Copilot (free) | small | small, fully specified tasks: tests, small modules |
| `opencode` | OpenCode (free models) | small | small, fully specified tasks: refactors, dead-code removal |
| `cursor` | Cursor (free) | small | small, fully specified tasks: documentation, CSS polish |
| `freebuff` | Freebuff (free, last resort) | small | only when no other tool can take the task. It has no prompt argument: the coordinator gives the one-line prompt and the user pastes it by hand into the Freebuff window opened on the agent's worktree. `scripts/status.sh` prints the exact line when an agent hits a usage limit. |

Free tools run weaker models with small context windows and strict usage limits. Tasks are therefore sized in three tiers, and the coordinator never gives an agent a task above its tier:

| Tier | Agents | Size limits | What the prompt must contain |
|---|---|---|---|
| **S** (small) | `copilot`, `opencode`, `cursor` | at most 2-3 files, about 150 changed lines, one module, 2-4 checklist items; no running Electron; no edits to shared hot files except an exact line the prompt quotes | every fact needed inline (function names, data shapes, example code), the exact files to read (at most 3), step-by-step items, the exact test command and the expected result |
| **M** (medium) | `codex` (several per round, each independent) | one subsystem per task, up to about 6 files and 500 lines, 3-6 items | goal, interfaces to keep, files to read, acceptance criteria |
| **L** (large) | `claude` | cross-cutting work, integration, merging, real-display verification, anything ambiguous | as needed |

If a Tier S agent finds the task bigger than described, it must not improvise: it stops, sets `Status: BLOCKED` and explains under "Requests for the coordinator".

### 3.2 Files and folders

```
agents/
  rounds/R<NN>/PLAN.md          round overview: goals, task per agent, file ownership map, merge order
  rounds/R<NN>/<agent>.md       the prompt for one agent (self-contained)
  state/CURRENT_STATE_<agent>.md  the agent's own report, rewritten by that agent during the round
  STATE_TEMPLATE.md             template for the state file
```

Worktrees live inside the repository, in `.worktrees/hml-<agent>`, on branch `r<NN>/<agent>` (for example `.worktrees/hml-codex` on `r07/codex`). The folder `.worktrees/` is git-ignored, so the worktrees never reach GitHub. The coordinator creates them when a round starts; the path is stated at the top of every prompt file.
- Why inside: one place for all round files, nothing next to the repo. `npm test` (`node --test`) does not pick up tests from `.worktrees/` (checked: 621 tests with and without a worktree there).
- Rounds R01 to R06 use the older sibling folders `../hml-<agent>` and keep them until they are merged and removed. Do not move a live worktree in the middle of a round.

### 3.3 What every agent must do

1. Open **your own worktree** (path in your prompt). Never edit the main checkout or another agent's worktree.
2. Read this file, your prompt file `agents/rounds/R<NN>/<agent>.md` and anything it tells you to read. Nothing else is required context.
3. **Create your state file first**, before writing code: copy `agents/STATE_TEMPLATE.md` to `agents/state/CURRENT_STATE_<agent>.md`, set `Status: IN_PROGRESS`, list your tasks as unchecked items, commit it.
4. Edit **only the files your prompt marks as owned**. Files listed as shared may only be changed in the way the prompt describes. If you need a change elsewhere, do not make it: write it under "Requests for the coordinator" in your state file.
5. Work in small steps. **After every finished task item:** run `npm run check`, commit (message in English, ending with your tool's attribution line if it has one), tick the item in your state file and commit that too. Your branch must always be in a working state.
6. Finish by setting `Status:` to `DONE`, `PARTIAL`, `BLOCKED` or `OUT_OF_BUDGET`, filling in every section of the state file, and committing it. The coordinator waits for this final status before it starts reviewing the round, so set it only when the work is truly finished or cleanly stopped. Do not merge into `main`, do not push `main`, do not rebase other branches.

### 3.4 Running out of tokens or quota

Agents cannot always see their limits, so the protocol assumes you may be cut off at any moment:

- Because you commit after every item, finished work is never lost and the coordinator can read exactly where you stopped (`git log r<NN>/<agent>`).
- If your tool warns that the quota, context or usage limit is close, **stop at the next clean point**: commit, set `Status: OUT_OF_BUDGET`, and write under "Resume notes" exactly what the next agent must do to continue (file, function, remaining steps).
- If you were cut off without writing that, the coordinator treats a state file still saying `IN_PROGRESS` as "stopped at the last ticked item".
- The user can also tell the coordinator in plain words that a tool ran out; that has the same meaning.

### 3.5 State file format

Use `agents/STATE_TEMPLATE.md`. Keep it short and factual: what is done (with commit hashes), what is not, what was verified and how, what is unverified, files changed, requests for the coordinator, resume notes. Never paste secrets, long logs or whole files into it.

## 4. Coordinator duties (Claude Code)

Claude Code follows the extra rules in `CLAUDE.md`. In short, when the user asks for the next actions the coordinator:

1. reads `CURRENT_STATE.md`, every `agents/state/CURRENT_STATE_*.md` and the agents' branch logs;
2. merges finished branches into `main` in the order given by the round plan, runs `npm run check`, verifies on the real display, updates `CURRENT_STATE.md`, removes merged worktrees;
3. plans the next round, creates the worktrees and writes `agents/rounds/R<NN>/PLAN.md` plus one prompt file per agent, including one for itself.
