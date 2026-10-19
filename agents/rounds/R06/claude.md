# R06 · claude · Tier L

- Worktree: `D:\Github Repos\hml-r06-claude` (branch `r06/claude`).
- Read first: `PLAN.md` (scope, ownership map, rules), `src/main/admin/routes.js`, `src/main/index.js` (`applyAdminServer`,
  `launcher:reload-config`, `restartSoloist`-style functions, `before-quit`), `backend/soloist/manager.js`,
  `backend/settings-descriptor.js`, `backend/ADMIN.md`.
- State file: `agents/state/CURRENT_STATE_claude.md` (copy the template, header `(round R06)`, commit first).
- Owned files: the list in `PLAN.md`. Codex owns the redaction, log, status and diagnostics modules. Copilot owns
  `src/main/admin/object-fields.js`, freebuff owns `backend/confirmation.js`, opencode owns the panel security test, cursor owns
  `panel.css`. Merge their branches first (see `PLAN.md`, merge order).
- Start from `main` after R05 (`ae4584c`). The R05 `PUT /api/config` merge fix is already in `main` (`routes.js` `mergeSettingsPatch`).

## Tasks

1. **Actions module** `backend/actions.js` (pure registry, testable): `ACTIONS = [{ name, label, group, destructive, help }]` for
   `reload-config`, `restart-soloist`, `clear-cache`, `pair-tv`, `restart-launcher`. Export `findAction(name)` and `ACTIONS`. Add the
   action list to `GET /api/settings-description` as `ACTIONS`, and extend `test/admin-static.test.js`'s description test. Every action must
   have a route and a panel button (the coverage test reads the route table and `panel.js`).
2. **Confirmation**: use freebuff's `createConfirmations()` from `backend/confirmation.js` (single-use, 60 s, 6 characters). Instantiate it
   once in `routes.js` creation. Route: `GET /api/actions/confirm/<name>` (login) returns `{ token, expiresAt }` for destructive actions only.
   Tests with an injected clock go in `test/admin-actions.test.js`.
3. **Routes** in `routes.js` (panel-only additions, existing routes unchanged):
   - `GET /api/status` (login) -> `buildStatus(sources)` from codex; `GET /api/log?tail=N` (login) -> `ring.tail(N)`;
     `GET /api/diagnostics` (login) -> `buildDiagnostics(...)` with `Content-Disposition: attachment`.
   - `POST /api/actions/<name>` (login, CSRF header). Destructive actions need `{ "confirm": "<token>" }` consumed with `consume`;
     otherwise 428. Unknown action 404.
   - Status, log and diagnostics only read; they never call a service that can block (every probe has a timeout from codex's `status.js`).
4. **Wiring in `src/main/index.js`**: create the log ring and wrap the console (`log.wrap(console)`) at start-up; build the status
   sources (host from `remoteStatus`, Spotify state from the media service, Soloist from the manager's `status()`, VPN from the VPN
   service, weather from the cached snapshot); implement the actions:
   - `reload-config`: `config = await loadConfig(...)`, then `buildModel()`.
   - `restart-soloist`: `soloistManager.restart()` (use the existing `soloist` ext `restart`).
   - `clear-cache`: clear `icon-cache`, the artwork caches and `weather-cache.json`; never the config, `.env` or token files.
   - `pair-tv`: `adminServer.pair()` (same as the TV button).
   - `restart-launcher`: `app.relaunch(); app.exit(0)`, after the confirmation.
5. **Panel pages** for Status, Log, Actions and Object editors in `panel.js` and `index.html`. Status is read every 5 seconds only while the
   page is visible; the log is read on demand; each action shows its result text; the diagnostics download is a link to
   `/api/diagnostics` (the session cookie is sent by the browser). No inline script; all new text through `textContent`.
6. **Object editors** (former R07): for `soloist`, `backgroundApps`, `homeHeader`, `remote`, `vpn` and `wallpaper`, build the forms from
   copilot's `OBJECT_FIELDS` and `validateFieldValue`. Save through `PUT /api/config` with `{ settings: { <object>: <full object> } }`
   (the server merges it). Show validation errors next to the field. `header`, `categories`, `theme`, `background` and `wallpaperSources`
   stay read-only with the "Edit on the TV for now" hint; list them under "Resume notes" as R08 scope. Test the form-to-patch logic in
   `test/admin-object-editors.test.js` with pure functions (move them out of `panel.js` if they are not DOM code).
7. **Real machine check**: every action from the panel, one at a time, and every editor: change one value, save, confirm on the TV.
   Then a secret-leak search: grep the downloaded diagnostics for the values of `VP_API`, `WEATHER_API`, `STEAMDB_API`,
   `SPOTIFY_CLIENT_ID` and `SPOTIFY_SOLOIST_API` (read them only inside the check process, never print them; report counts only).
   The result must be zero hits. The TV and phone steps need the user at the TV; say so in the state file if they are not done.
8. `npm run check`, commit, state file `Status: DONE` or `PARTIAL` with the real-machine results.

Do not merge into `main`, do not push, do not touch `main`. The coordinator merges after triage.
