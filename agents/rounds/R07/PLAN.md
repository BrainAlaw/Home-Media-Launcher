# Round R07: finish the admin panel (status, log, actions, object editors) and the focus frame

Goal: close what R06 left open. After this round the panel shows status, log and diagnostics, runs the actions (with confirmation),
edits the six structured settings from R06 scope 6, and the focused-tile frame has matching corners on the default theme.
Everything is reachable from the panel, per `AGENTS.md`.

Base: `main` (after R06 closure, merge `e5ab1e7`).

## Scope

1. **Confirmation tokens** (codex): `backend/confirmation.js`, single-use, 60 s, used by the destructive actions.
2. **Object field model** (copilot): `DEVICE_NAME_MAX` and `BINARY_PATH_MAX` exported from `backend/soloist/settings.js` and imported by
   `src/main/admin/object-fields.js` (no copies).
3. **Panel styles** (cursor): `src/main/admin/panel/panel.css` gets the classes listed in the cursor prompt. No other file.
4. **Routes, wiring and panel pages** (claude): `GET /api/status`, `GET /api/log`, `GET /api/diagnostics`, `GET /api/actions/confirm/<name>`,
   `POST /api/actions/<name>`; wiring in `src/main/index.js`; panel pages for Status, Log, Actions and the object editors; the
   editors save through `PUT /api/config`.
5. **Focus frame** (claude, same session): measure on the real display, then fix the corner mismatch with one radius token.
6. **Action coverage test** (opencode, starts after claude is merged): every action in `backend/actions.js` has a route and a panel button.

## Owners

| Agent | Tier | Worktree | Branch | Task | Starts |
|---|---|---|---|---|---|
| `claude` | L | `.worktrees/r07-claude` | `r07/claude` | scope 4 and 5 | now |
| `codex` | M | `.worktrees/r07-codex` | `r07/codex` | scope 1 | now |
| `copilot` | S | `.worktrees/r07-copilot` | `r07/copilot` | scope 2 | now |
| `cursor` | S | `.worktrees/r07-cursor` | `r07/cursor` | scope 3 | now |
| `opencode` | S | `.worktrees/r07-opencode` | `r07/opencode` | scope 6 | after `claude` is merged |

Codex's worktree is new. The draft of `confirmation.js` in the old `hml-r06-freebuff` folder (uncommitted, 8 tests pass) is a reference only;
the codex prompt says how to use it. The old R06 worktrees (`hml-r06-claude`, `hml-r06-freebuff`) stay untouched.

## Ownership map

| File | Owner | Others |
|---|---|---|
| `backend/confirmation.js`, `test/admin-confirmation.test.js` | `codex` | `claude` imports it |
| `backend/soloist/settings.js` (export only), `src/main/admin/object-fields.js`, `test/admin-object-fields.test.js` | `copilot` | `claude` imports `OBJECT_FIELDS` |
| `src/main/admin/panel/panel.css` | `cursor` | none |
| `src/main/admin/routes.js`, `src/main/index.js`, `src/main/admin/panel/panel.js`, `src/main/admin/panel/index.html`, `backend/actions.js`, `backend/ADMIN.md`, `test/admin-actions.test.js`, `test/admin-object-editors.test.js` | `claude` | none |
| `src/renderer/styles.css`, `home.css`, `hig.css` (tokens only) | `claude` | none |
| `test/admin-actions-coverage.test.js` | `opencode` | none |
| `agents/state/CURRENT_STATE_<agent>.md` | each agent | none |

Shared hot files (`index.js`, `preload.js`, `contracts.d.ts`) are touched by `claude` only.

## Rules

- Every panel class name used by `panel.js` must exist in `panel.css`. The class names are fixed in the cursor prompt; claude uses exactly those.
- Destructive actions (`restart-launcher`) need a confirmation token from `GET /api/actions/confirm/<name>`, valid 60 s, single-use.
- Status never blocks: each probe has a timeout (codex's `status.js`).
- Agents do not merge and do not push. The coordinator merges in the order below.

## Merge order

1. `copilot`, `codex`, `cursor` (small, independent; merge as they finish)
2. `claude` (after merging the three above into its branch)
3. `opencode` (after `claude`)
4. Coordinator: real-machine check of every action and every editor from the panel, a secret-leak search over the diagnostics file,
   and the focus-frame check on the real display. The TV and phone steps need the user at the TV.

## How each agent starts

The coordinator starts each CLI with the prompt file, in its worktree, with auto-approve as agreed by the user (see the round log).
If a start is refused by the environment, the coordinator says so and the user pastes the line instead:
`Read AGENTS.md and agents/rounds/R07/<agent>.md, then follow the prompt.`
