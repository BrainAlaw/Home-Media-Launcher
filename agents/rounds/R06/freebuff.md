# R06 · freebuff · Tier S

- Worktree: `D:\Github Repos\hml-r06-freebuff` (branch `r06/freebuff`). Work only here.
- Read first (exactly these): `AGENTS.md`, `backend/ADMIN.md`.
- State file: `agents/state/CURRENT_STATE_freebuff.md`. Copy `agents/STATE_TEMPLATE.md`, set `Status: IN_PROGRESS`, commit before code.
- Owned files: `backend/confirmation.js` (new), `test/admin-confirmation.test.js` (new), your state file. Nothing else.

## Goal

Single-use confirmation tokens for destructive admin actions (`restart-launcher`). Pure logic: the clock and the random source are injected.
They expire after 60 seconds.

## Task items

1. Create `backend/confirmation.js` (`'use strict'`) exporting `createConfirmations`. Signature:
   `createConfirmations({ now = () => Date.now(), randomBytes = require('node:crypto').randomBytes, ttlMs = 60000, length = 6 } = {})`.
   It returns `{ issue(name), consume(name, token) }`.
   - `ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` (32 characters, no `0 O 1 I`; 32 divides 256, so `byte % 32` has no bias).
   - `issue(name)`: take `length` bytes from `randomBytes(length)`, map each to `ALPHABET[byte % 32]`, store `{ token, expiresAt: now() + ttlMs }`
     under `name`, replacing any earlier token for that name. Return `{ token, expiresAt }`. Also drop every expired entry.
   - `consume(name, token)`: return `false` when no entry, or the entry is expired (delete it), or the names differ. Compare tokens with
     `crypto.timingSafeEqual` on equal-length buffers (`false` on length mismatch). On a match: delete the entry and return `true`.
     On a mismatch: keep the entry and return `false`. Non-string `token` returns `false`.
   - Throw `TypeError` when `ttlMs` is not a positive integer or `length` is not an integer from 4 to 16.
2. Create `test/admin-confirmation.test.js`. Use an injected clock (a mutable `let now`) and a deterministic `randomBytes` (for example
   `(size) => Buffer.alloc(size, 0)` gives `A` repeated, and `(size) => Buffer.from([1,2,3,4,5,6])` gives `BCDEFG`). Cover: the token is
   `length` characters from `ALPHABET`; `consume` succeeds once and fails the second time; a wrong token keeps the entry (the right token still
   works); the wrong name fails; the token is refused at `ttlMs` and accepted at `ttlMs - 1`; a second `issue` for the same name invalidates the
   first token; a non-string token fails; the `TypeError` cases.
3. Run `node --test test/admin-confirmation.test.js` (must pass), then `npm test` (must pass).
   Commit after each item with an English message ending with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Tick the item and commit
   the state file.
4. Set `Status: DONE` in your state file, fill every section, commit. In "Requests for the coordinator" write the exported names and the
   route the coordinator should use (`GET /api/actions/confirm/<name>` issues, `POST /api/actions/<name>` consumes).

## Stop rules

- Stop (`Status: BLOCKED`) if the work grows past about 150 changed lines.
- Do not run Electron. Do not merge, do not push, do not touch `main`.
