# R07 · opencode · Tier S

- Worktree: `.worktrees/r07-opencode` (branch `r07/opencode`). Work only here. Start this only after the coordinator tells you `claude` is merged into `main`;
  then merge `main` into your branch first (`git merge main`).
- Read first (exactly these): `AGENTS.md`, `backend/actions.js`, `src/main/admin/routes.js` (search for `/api/actions`).
- State file: `agents/state/CURRENT_STATE_opencode.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R07)` in the header, set `Status: IN_PROGRESS`, commit before code.
- Owned files: `test/admin-actions-coverage.test.js` (new), your state file. Nothing else.

## Goal

Every action in the registry must be reachable from the panel: a route in `routes.js`, and a button in `panel.js` with `data-action="<name>"`.
This test enforces it, so a future action cannot be added without both.

## Task items

1. Create `test/admin-actions-coverage.test.js` (`node:test`, `node:assert/strict`). Load `ACTIONS` from `backend/actions.js`. Read
   `src/main/admin/routes.js` and `src/main/admin/panel/panel.js` as text. For each action name:
   - `routes.js` must contain the route for it, `/api/actions/<name>` (the exact text, or the dispatch branch that checks the name);
   - `panel.js` must contain `data-action="<name>"` or `dataset.action = '<name>'`.
   Fail with a message that names the action and the missing place.
2. The test also checks the reverse: every `data-action="<name>"` in `panel.js` names an action in `ACTIONS`. Fail on an unknown name.
3. Run `node --test test/admin-actions-coverage.test.js` and `npm test` (both must pass). Commit after each item with an English message ending with
   `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Tick the item and commit the state file.
4. Set `Status: DONE`, fill every section, commit. If a check fails on the current code, do not change the code: write the failing action and place under
   "Requests for the coordinator" and set `Status: PARTIAL`.

## Stop rules

- Do not run Electron. Do not merge, do not push, do not touch `main`.
