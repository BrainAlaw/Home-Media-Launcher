# R06 · claude · Tier L

- Worktree: `D:\Github Repos\hml-r06-claude` (branch `r06/claude`).
- Read first: `PLAN.md` (scope and rules), `src/main/admin/routes.js`, `src/main/index.js` (`applyAdminServer`, `launcher:reload-config`,
  `restartSoloist`-style functions, `before-quit`), `backend/soloist/manager.js`, `backend/settings-descriptor.js`, `backend/ADMIN.md`.
- State file: `agents/state/CURRENT_STATE_claude.md` (copy the template, header `(round R06)`, commit first).
- Owned files: the list in `PLAN.md`. Codex owns the redaction, log, status and diagnostics modules; merge its branch when DONE.

## Tasks

1. **Actions module** `backend/actions.js` (pure registry, testable): `ACTIONS = [{ name, label, group, destructive, help }]` for
   `reload-config`, `restart-soloist`, `clear-cache`, `pair-tv`, `restart-launcher`. Export `findAction(name)` and
   `confirmationFor(name)`. Add `ACTIONS` to the settings description as a separate export and extend the coverage test:
   every action must have a route and a panel button (the test reads the route table and the panel page source).
2. **Confirmation**: `issueConfirmation(name, now)` returns a 6-character token valid 60 seconds; `consumeConfirmation(name, token, now)`
   is single-use. Route: `GET /api/actions/confirm/<name>` (login) returns the token. Tests with an injected clock.
3. **Routes** in `routes.js` (panel-only additions):
   - `GET /api/status` (login) -> `buildStatus(sources)` from codex; `GET /api/log?tail=N` (login) -> `ring.tail(N)`;
     `GET /api/diagnostics` (login) -> `buildDiagnostics(...)` with `Content-Disposition: attachment`.
   - `POST /api/actions/<name>` (login, CSRF header). Destructive actions need `{ "confirm": "<token>" }` consumed from the confirmation
     route; otherwise 428. Unknown action 404.
4. **Wiring in `src/main/index.js`**: create the log ring and wrap the console (`log.wrap(console)`) at start-up; build the status
   sources (host from `remoteStatus`, Spotify state from the media service, Soloist from the manager's `status()`, VPN from the VPN
   service, weather from the cached snapshot); implement the actions:
   - `reload-config`: `config = await loadConfig(...)`, then `buildModel()`.
   - `restart-soloist`: `soloistManager.restart()` (use the existing `soloist` ext `restart`).
   - `clear-cache`: clear `icon-cache`, the artwork caches and `weather-cache.json`; never the config, `.env` or token files.
   - `pair-tv`: `adminServer.pair()` (same as the TV button).
   - `restart-launcher`: `app.relaunch(); app.exit(0)`, after the confirmation.
5. **Panel pages** for Status, Log and Actions (in the panel from R05): read the status every 5 seconds only while the page is visible;
   the log is read on demand (not polled); each action shows its result text; the diagnostics download is a link to
   `/api/diagnostics` with the session cookie. (Coordinate with R05's `panel.js` after codex R05 merges.)
6. **Real machine check**: every action from the panel, one at a time. Then a secret-leak search: grep the downloaded diagnostics for
   the values of `VP_API`, `WEATHER_API`, `STEAMDB_API`, `SPOTIFY_CLIENT_ID` and `SPOTIFY_SOLOIST_API` (read them only inside the check
   process, never print them; report counts only). The result must be zero hits.
7. `npm run check`, commit, state file `Status: DONE` or `PARTIAL` with the real-machine results.

Do not merge, do not push, do not touch `main`.
