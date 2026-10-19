# R04 · codex · Tier M

- Worktree: `D:\Github Repos\hml-r04-codex` (branch `r04/codex`). Work only here.
- Read first: `AGENTS.md`, `PLAN.md` in this folder (contract section), `src/main/config.js` (`loadConfig`, `saveConfig`,
  `validateConfig`), `backend/storage.js` (atomic write), `src/main/secret-store.js` (the rule: never return secrets).
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md` first, set `Status: IN_PROGRESS`,
  commit before writing code.
- Owned files: listed in `PLAN.md`. Do not edit `src/main/index.js`, `config.js` or any renderer file.
- Do not read or print `.env` or token files. Do not run `npm install`. Use only `node:http`, `node:crypto`, `node:net`.

## Security requirements (each one has a test)

1. Pairing code: 6 digits from `crypto.randomInt`, valid 5 minutes, one live code at a time, compared with
   `crypto.timingSafeEqual`. After 5 wrong attempts the pairing locks for 60 seconds. Attempts are counted per client address.
2. Session: after a correct code, `POST /api/pair` returns a random 32-byte token (base64url) in an `HttpOnly; SameSite=Strict;
   Path=/` cookie, valid 12 hours, sliding. Only the SHA-256 of the token is kept in memory. Sessions are lost on restart.
3. CSRF and origin: every POST, PUT or DELETE must carry header `X-HML-Request: 1` and an `Origin` header equal to the server's
   own origin (`http://<bound-address>:<port>`), or no `Origin` together with `Sec-Fetch-Site: same-origin`. Otherwise 403.
4. Body limit 64 KiB. Bodies need `Content-Type: application/json`, else 415. Malformed JSON: 400.
5. Headers on every response: `Content-Security-Policy: default-src 'self'`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. No CORS headers at all.
6. Routes (JSON):
   - `GET /api/health` -> `{ ok: true, version }` (no auth).
   - `POST /api/pair` with `{ code }` -> sets the session cookie, or 401. A successful pairing consumes the code.
   - `POST /api/logout` -> clears the session.
   - `GET /api/session` -> `{ authenticated, expiresAt }` (no auth needed).
   - `GET /api/config` (auth) -> the config from `getConfig()` with secret-looking values removed. Any key whose name contains
     `token`, `key`, `secret` or `password` (case-insensitive, at any depth) is replaced by `"<set>"` or `"<unset>"`. Test with a
     fixture that has such keys nested.
   - `PUT /api/config` (auth, CSRF header) -> `validate(next)` first, then `saveConfig(next)`. On a validation error: 422 with the
     message. A config that fails validation is never written.
   - Unknown routes: 404. Wrong method: 405. No stack traces in any response.
7. Rate limit on `/api/pair`: 10 requests per minute per client address, then 429 with `Retry-After`.
8. Logging only through the injected `log`. Never log the code, the token, the cookie or a request body.

## Tasks (commit after each, tick it in your state file)

1. `src/main/admin/auth.js`: pairing codes (create, verify, lock, expire) and sessions (create, verify, revoke, slide).
   `test/admin-auth.test.js` covers requirements 1, 2 and 7 with an injected clock.
2. `src/main/admin/routes.js`: the route table and `redactConfig(config)` (pure). `test/admin-routes.test.js`: redaction
   (nested secret-looking keys), a PUT that fails validation does not call `saveConfig`, method and 404 handling.
3. `src/main/admin/server.js`: `createAdminServer` per the contract in `PLAN.md`. It binds only the configured address and
   applies requirements 3, 4, 5 and 8. `test/admin-server.test.js` starts it on a random loopback port with an injected config and
   checks: nothing listens before `start()`, origin rejection, missing header rejection, body limit, response headers, and the
   pairing flow end to end (code, cookie, GET config, PUT config, saved once).
4. `npm run check`, commit, set `Status: DONE` in your state file, list changed files and open questions for the coordinator.

Do not merge, do not push, do not touch `main`.
