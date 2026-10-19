# R07 · codex · Tier M

- Worktree: `.worktrees/r07-codex` (branch `r07/codex`). Create it from `main` if it does not exist yet (the coordinator does this). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R07/PLAN.md`, `backend/ADMIN.md`, `src/main/admin/routes.js` (only the `dispatch` shape).
- Reference draft (read only, do not edit or commit there): `D:\Github Repos\hml-r06-freebuff\backend\confirmation.js` and
  `D:\Github Repos\hml-r06-freebuff\test\admin-confirmation.test.js`. It was written by an earlier agent and is not committed. Reuse it if it meets the spec below.
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R07)` in the header, set `Status: IN_PROGRESS`, commit before code.
- Owned files: `backend/confirmation.js` (new), `test/admin-confirmation.test.js` (new), your state file. Nothing else.

## Goal

Single-use confirmation tokens for destructive admin actions. Pure logic: the clock and the random source are injected.

## Interface (other agents depend on it, keep it exactly)

`createConfirmations({ now = () => Date.now(), randomBytes = require('node:crypto').randomBytes, ttlMs = 60000, length = 6 } = {})`
returns `{ issue(name), consume(name, token) }`.

- `issue(name)` returns `{ token, expiresAt }`. The token is `length` characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 characters, so `byte % 32` has no bias).
  A new `issue` for the same name replaces the earlier token.
- `consume(name, token)` returns `true` once for a valid, unexpired token with that name, then removes it. Wrong name, wrong token, expired token or
  non-string token return `false`. A wrong token does not remove the entry. Compare with `crypto.timingSafeEqual` on equal-length buffers.
- Throw `TypeError` when `ttlMs` is not a positive integer or `length` is not an integer from 4 to 16.

## Task items

1. Create `backend/confirmation.js` with the interface above. Keep it under 120 lines, `'use strict'`, no dependencies.
2. Create `test/admin-confirmation.test.js` with `node:test`. Use an injected clock and a deterministic `randomBytes`. Cover: the token alphabet and length;
   one successful consume, then failure; a wrong token keeps the entry; wrong name fails; refused at `ttlMs`, accepted at `ttlMs - 1`; re-issue invalidates the old token;
   non-string token fails; the `TypeError` cases.
3. Run `node --test test/admin-confirmation.test.js` and `npm test` (both must pass). Commit after each item with an English message ending with
   `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Tick the item in your state file and commit it.
4. Set `Status: DONE`, fill every section, commit. In "Requests for the coordinator" write the exact export name.

## Stop rules

- Stop (`Status: BLOCKED`) if the work grows past about 500 lines or needs a file you do not own.
- Do not run Electron. Do not merge, do not push, do not touch `main`.
