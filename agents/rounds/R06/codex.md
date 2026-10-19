# R06 · codex · Tier M

- Worktree: `D:\Github Repos\hml-r06-codex` (branch `r06/codex`). Work only here.
- Read first: `AGENTS.md`, `PLAN.md` in this folder (scope and rules), `src/main/admin/routes.js`, `backend/ADMIN.md`, the existing
  `src/main/*.js` modules that expose status (`remote-apps.js` for the host, `backend/soloist/manager.js` for Soloist,
  `backend/vpn.js` for VPN, `backend/weather.js` for weather).
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy the template, `Status: IN_PROGRESS`, commit before code.
- Owned files: `src/main/admin/log.js`, `src/main/admin/redact.js`, `src/main/admin/status.js`, `src/main/admin/diagnostics.js` (new),
  their tests `test/admin-log.test.js`, `test/admin-redact.test.js`, `test/admin-status.test.js`, `test/admin-diagnostics.test.js` (new),
  your state file. Do not edit `index.js` or `routes.js`.

## Tasks

1. `src/main/admin/redact.js` (pure): `redactText(text, secrets)` replaces every value of the given secrets (and any `KEY=value` line
   for the known key names: `VP_API`, `WEATHER_API`, `STEAMDB_API`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_SOLOIST_API`, `*_TOKEN`, `*_SECRET`)
   with `<redacted>`. Also masks Bearer tokens and cookies (`Cookie:`/`Set-Cookie:` values). Tests with realistic fixtures
   (a Spotify auth error, a Vibepollo 401, an admin cookie line).
2. `src/main/admin/log.js`: `createLogRing({ capacity = 500, redact })` with `write(level, message)`, `tail(n)`, and
   `wrap(consoleLike)` that captures `console.log/warn/error` without changing what the console prints. Every stored line is
   redacted at write time. Tests: capacity, order, redaction at write time, `tail` clamps `n` to 1..500.
3. `src/main/admin/status.js`: `buildStatus(sources)` where `sources` are injected functions with timeouts (`probe(name, fn, timeoutMs)`
   returns `{ state: 'ok'|'unknown'|'error', detail }`). Sources: `version`, `uptime`, `admin`, `host`, `spotify`, `soloist`, `vpn`,
   `network`, `weather`. Return no tokens, no SSIDs, no keys. Tests: a probe that never resolves yields `unknown` after the timeout;
   a probe that throws yields `error` with a short message; the result contains no field named like a secret.
4. `src/main/admin/diagnostics.js`: `buildDiagnostics({ status, logTail, settings, secretNames })` returns one JSON object: status, the
   redacted log tail, the settings with secrets masked (use `redactConfig` from routes), and `secretNames` as `{ name, set: boolean }`
   (names and booleans only). Test: the output contains no value of any secret passed in.
5. `npm test` passes, commit, `Status: DONE` in your state file. In the state file list the exact function signatures the coordinator
   must wire in `index.js` (sources for `buildStatus`, the ring for logs).

Do not merge, do not push, do not touch `main`.
