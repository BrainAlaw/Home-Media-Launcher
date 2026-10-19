# Round R06: status, diagnostics, actions and object editors in the admin panel

Goal: from the panel you can see what is running and what went wrong, run the actions the TV already has, and edit the
structured settings that were read-only in R05. Everything here is reachable from the panel, per the rule in `AGENTS.md`.

Base: `main` (after R05, merge `ae4584c`).

This round combines the former R06 and R07 so the free tools can join one round. The object editors that were planned for R07
are scope 6 below.

## Scope

1. **Status** (`GET /api/status`, login needed): launcher version, uptime, admin server state, Vibepollo host (online / offline /
   cached and last sync age, no token), Spotify (signed in / not configured, no tokens), Soloist (state from the supervisor), VPN
   (Tailscale and Surfshark state), network (link type and IP, no SSIDs of other networks), weather (last result, no key).
2. **Log** (`GET /api/log?tail=200`, login needed): the last N lines of the launcher's own log (ring buffer in memory, written by
   the main process). Every line passes a redaction filter that removes values of keys from `.env` and tokens; the filter has tests
   with real-looking fixtures.
3. **Diagnostics** (`GET /api/diagnostics`): one JSON file with status, the redacted log tail, the settings with secrets masked, and
   the list of which secret keys are set (names only). Downloadable from the panel. Never includes `.env` values or token files.
4. **Actions** (`POST /api/actions/<name>`, login, CSRF header, a short confirmation token in the body for destructive ones):
   - `reload-config`: re-reads `config.json` and rebuilds the model.
   - `restart-soloist`: restarts the Soloist supervisor.
   - `clear-cache`: clears the artwork and icon caches (not the config, not tokens).
   - `pair-tv`: the same as the TV button (shows the pairing card on the TV again).
   - `restart-launcher`: restarts the launcher process (confirmation token required).
   Each action is listed in the descriptor's action list (`backend/actions.js`), so the coverage test can check that every action is
   also a route and a panel button.
5. **Security guard** for the whole panel: a test that reads every file in `src/main/admin/panel/` and fails on inline script,
   `eval`, `new Function`, inline event handlers, `javascript:` URLs, `innerHTML` and external references.
6. **Object editors** (former R07): editable forms for `soloist`, `backgroundApps`, `homeHeader`, `remote`, `vpn`, `wallpaper`.
   Each field comes from the field model (`src/main/admin/object-fields.js`), validated with the same rules as the config validator.
   Not in this round: `header`, `categories`, `theme`, `background`, `wallpaperSources`. They stay read-only with the
   "Edit on the TV for now" hint, and are listed as scope for R08. Their validators need a full read first.
7. **Side task, visual bug (claude, task 8 of its prompt)**: on the default theme the focused tile's highlight frame has corners that do
   not match the tile's rounded corners. Measure the radii on the real display first, then fix them with one radius token shared by the
   frame, the art and the glow. Files: `src/renderer/styles.css`, `src/renderer/home.css`, `src/renderer/hig.css` (tokens only).

## Worktree location

The worktrees of this round are the sibling folders in the table below (`D:\Github Repos\hml-r06-<agent>`). They were created before
the `.worktrees/` rule (`AGENTS.md` section 3.2) and stay where they are until they are merged and removed. Moving a live worktree
in the middle of a round would break the agent working in it. Rounds from R07 use `.worktrees/r<NN>-<agent>`.

## Owners

| Agent | Tier | Worktree | Branch | Task |
|---|---|---|---|---|
| `codex` | M | `D:\Github Repos\hml-r06-codex` | `r06/codex` | Log ring buffer with redaction, status and diagnostics builders (pure, tested) |
| `claude` | L | `D:\Github Repos\hml-r06-claude` | `r06/claude` | Actions and confirmation wiring, routes, `index.js` wiring, panel pages for status, log, actions and object editors, real-machine check, side task: focus frame corners (scope 7). Runs in its own Claude Code session |
| `copilot` | S | `D:\Github Repos\hml-r06-copilot` | `r06/copilot` | Pure field model for the object editors (`object-fields.js`) with tests |
| `freebuff` | S | `D:\Github Repos\hml-r06-freebuff` | `r06/freebuff` | Pure single-use confirmation tokens (`backend/confirmation.js`) with tests |
| `opencode` | S | `D:\Github Repos\hml-r06-opencode` | `r06/opencode` | Static security test for the panel sources (`test/admin-panel-security.test.js`) |
| `cursor` | S | `D:\Github Repos\hml-r06-cursor` | `r06/cursor` | CSS polish of `panel.css`: phone layout, long object values, focus, reduced motion |

Free-tool tasks are fully specified in their prompt files. Each finishes on its own; nothing they write is needed by another free tool.

## Ownership map

| File | Owner | Others |
|---|---|---|
| `src/main/admin/log.js`, `redact.js`, `status.js`, `diagnostics.js` and their tests | `codex` | none |
| `backend/actions.js`, `test/admin-actions.test.js` | `claude` | none |
| `backend/confirmation.js`, `test/admin-confirmation.test.js` | `freebuff` | `claude` imports it |
| `src/main/admin/object-fields.js`, `test/admin-object-fields.test.js` | `copilot` | `claude` imports it |
| `test/admin-panel-security.test.js` | `opencode` | none |
| `src/main/admin/panel/panel.css` | `cursor` | none |
| `src/main/admin/panel/panel.js`, `index.html` | `claude` | none |
| `src/renderer/styles.css`, `home.css`, `hig.css` (focus frame side task, claude task 8) | `claude` | none this round |
| `src/main/admin/routes.js`, `src/main/index.js`, `backend/ADMIN.md` | `claude` | none |
| `agents/state/CURRENT_STATE_<agent>.md` | each agent | none |

Shared hot files (`index.js`, `preload.js`, `contracts.d.ts`) are touched by `claude` only.

## Rules

- The log filter is the single place that removes secrets from text. Actions and diagnostics use it too; nothing writes raw
  environment values anywhere.
- Destructive actions (`restart-launcher`) need a confirmation token that the server issues from `GET /api/actions/confirm/<name>`
  and that expires in 60 seconds, and that is single-use.
- Status never blocks: each probe has a timeout; a slow service shows as `unknown`, not as a stuck panel.
- Free tools do not run Electron and do not merge. They commit on their own branch and set their state file.

## Merge order

1. `copilot`, `freebuff`, `opencode`, `cursor` (small, independent; merge as they finish)
2. `codex` (log, redaction, status and diagnostics builders)
3. `claude` (actions, routes, index.js wiring, panel pages, object editors, focus frame side task), after merging the branches above into it
4. Coordinator: real machine check of every action and every editor from the panel, a secret-leak search over the diagnostics
   file, then the user decides.

## What the user does

| Tool | Folder | Paste |
|---|---|---|
| Codex | `D:\Github Repos\hml-r06-codex` | `Read AGENTS.md and agents/rounds/R06/codex.md, then follow the prompt.` |
| Copilot | `D:\Github Repos\hml-r06-copilot` | `Read AGENTS.md and agents/rounds/R06/copilot.md, then follow the prompt.` |
| Freebuff | `D:\Github Repos\hml-r06-freebuff` | `Read AGENTS.md and agents/rounds/R06/freebuff.md, then follow the prompt.` |
| OpenCode | `D:\Github Repos\hml-r06-opencode` | `Read AGENTS.md and agents/rounds/R06/opencode.md, then follow the prompt.` |
| Cursor | `D:\Github Repos\hml-r06-cursor` | `Read AGENTS.md and agents/rounds/R06/cursor.md, then follow the prompt.` |
| Claude | `D:\Github Repos\hml-r06-claude` | `Read CLAUDE.md and agents/rounds/R06/claude.md, then follow the prompt.` |
