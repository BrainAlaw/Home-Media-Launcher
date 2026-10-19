# R07 · claude · Tier L

- Worktree: `.worktrees/r07-claude` (branch `r07/claude`). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R07/PLAN.md`, `backend/ADMIN.md`, `src/main/admin/routes.js`, `src/main/index.js` (`applyAdminServer`,
  `launcher:reload-config`, the soloist and VPN handlers), `backend/actions.js` (already on `main`), `src/main/admin/log.js`, `redact.js`, `status.js`,
  `diagnostics.js` (on `main` from R06, codex), `src/main/admin/object-fields.js` (copilot), `src/main/admin/panel/panel.js` and `index.html`.
- State file: `agents/state/CURRENT_STATE_claude.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R07)` in the header, set `Status: IN_PROGRESS`, commit before code.
- Owned files: `src/main/admin/routes.js`, `src/main/index.js`, `src/main/admin/panel/panel.js`, `src/main/admin/panel/index.html`, `backend/actions.js`,
  `backend/ADMIN.md`, `test/admin-actions.test.js`, `test/admin-object-editors.test.js` (new), `src/renderer/styles.css`, `src/renderer/home.css`,
  `src/renderer/hig.css` (tokens only, for task 6), your state file.
- Not yours: `src/main/admin/panel/panel.css` (cursor writes the classes; you use only the names in the cursor contract in `PLAN.md`),
  `backend/confirmation.js` (codex), `src/main/admin/object-fields.js` (copilot), `backend/soloist/settings.js` (copilot).

## Dependencies and order

- Start now with tasks 1, 2, 3 and 5 (status, log, diagnostics and the panel pages that need no confirmation).
- Task 4 (confirmation and destructive actions) needs `backend/confirmation.js` from codex. The coordinator merges codex into `main` when it is DONE and
  tells you; then merge `main` into your branch and continue with task 4. Do not write your own token code.
- Task 6 (object editors) needs `object-fields.js` from copilot, the same way.
- Task 7 (focus frame) is independent.

## Interfaces (keep exactly)

- `createConfirmations({ now, randomBytes, ttlMs, length })` returns `{ issue(name) -> { token, expiresAt }, consume(name, token) -> boolean }` (codex).
- `OBJECT_FIELDS` and `validateFieldValue(spec, value)` from `object-fields.js` (copilot).
- Panel class names exactly as listed in the cursor contract in `PLAN.md`. Action buttons carry `data-action="<name>"` (opencode's coverage test reads this).

## Task items

1. **Status and log routes** in `routes.js` (login needed): `GET /api/status` calls `buildStatus(sources)` from `status.js`; `GET /api/log?tail=N` returns
   `ring.tail(N)` from `log.js` (clamped as `log.js` clamps). In `index.js`: create the log ring once, wrap the console with `log.wrap(console)` at start-up,
   and build the status sources (launcher version, uptime, admin server state, Vibepollo host from `remoteStatus`, Spotify, Soloist from the manager's `status()`,
   VPN, network, weather from the cached snapshot). Every source has a timeout (`status.js` does this). No source returns a token or a key.
2. **Diagnostics route** `GET /api/diagnostics` (login): `buildDiagnostics({ status, logTail, settings, secretNames })` with `Content-Disposition: attachment; filename="hml-diagnostics.json"`.
   `settings` goes through `redactConfig` from `routes.js`. The output must contain no secret value. Test this in `test/admin-actions.test.js`
   with a fixture secret that must not appear in the response body.
3. **Panel pages** in `panel.js` and `index.html`: Status (reads every 5 seconds only while the page is visible), Log (on demand, with a refresh button),
   Diagnostics (a link with class `diagnostics-link` to `/api/diagnostics`). Build all text with `textContent`. No inline script, no `innerHTML`.
   The panel's page list comes from the same place as the existing pages.
4. **Actions** (after codex is merged): `backend/actions.js` already has the registry (`ACTIONS`, `findAction`). Add the routes:
   - `GET /api/actions/confirm/<name>` (login) returns `{ token, expiresAt }` for destructive actions only; other names get 404.
   - `POST /api/actions/<name>` (login, `X-HML-Request` header as for `PUT /api/config`). A destructive action needs `{ "confirm": "<token>" }`
     consumed with `consume`; a missing token gives 428, a wrong or used one gives 403. Unknown name gives 404.
   - The actions: `reload-config` (`loadConfig` then `buildModel`), `restart-soloist` (soloist `restart`), `clear-cache` (icon and artwork caches and
     `weather-cache.json`, never the config, `.env` or tokens), `pair-tv` (the same as the TV button, `adminServer.pair()`),
     `restart-launcher` (`app.relaunch()` then `app.exit(0)`, after the confirmation).
   - Each action button in the panel has `data-action="<name>"` and shows its result in `.action-result`.
5. **Object editors** (after copilot is merged): for `soloist`, `backgroundApps`, `homeHeader`, `remote`, `vpn` and `wallpaper`, build the forms from
   `OBJECT_FIELDS`, validate each field with `validateFieldValue`, show errors in `.object-editor-field-error`, and save with
   `PUT /api/config` as `{ settings: { <object>: <full object> } }`. The server merges it (see `mergeSettingsPatch`). `header`, `categories`, `theme`,
   `background` and `wallpaperSources` stay read-only with the text "Edit on the TV for now" in `.object-editor-readonly-hint`.
   Put the form-to-patch logic in pure functions and test them in `test/admin-object-editors.test.js`.
6. **Focus frame** (the frame of the focused tile does not match the tile's rounded corners, default theme). Measure first on the real display, not by guessing.
   Read the computed `border-radius`, `inset`, `padding` and `box-shadow` of `.tile`, `.tile::before` (`styles.css`), `.tile::after` (glow, `home.css`,
   radius `--hig-radius-xl`) and `.tile .art`. Record the numbers in your state file. Fix with one radius token shared by frame, art and glow.
   Keep motion, scale and colour unchanged. Check the default theme and one other built-in theme with `desktopCapturer`, before and after.
   If the measurement cannot be done in this session, set this item to `Status: PARTIAL` and write what was measured.
7. `npm run check` (must pass), commit, state file `Status: DONE` or `PARTIAL`. Real-machine checks of the panel are done by the coordinator with the user at the TV.

## Rules

- Destructive actions run only after the confirmation token is consumed. No action changes `main`.
- Each commit passes `npm run check`. Commit after every item.
- Do not merge, do not push, do not touch `main`.
