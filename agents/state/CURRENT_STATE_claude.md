# CURRENT_STATE_claude (round R07)

Status: PARTIAL            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code  ·  Branch: r07/claude  ·  Last update: 2026-10-19

## Tasks
- [x] 1. Status and log routes (`routes.js`, `index.js`): committed in the first pass; the server wiring is Request 1 (not run in the real app)
- [x] 2. Diagnostics route with fixture-secret test (`test/admin-actions.test.js`): committed in the first pass; test passes
- [x] 3. Panel pages Status, Log, Diagnostics link (`panel.js`, `index.html`): committed in the first pass; not opened on the real display
- [x] 4. Confirmed destructive actions: commit `b4fb116` (routes, panel Actions page, tests, `backend/ADMIN.md`).
  Handlers are NOT wired (Request 5), so every action answers 503 until `server.js` passes `actions`.
- [x] 5. Object editors: commit `0a5fc89` (`panel.js`, `panel/object-editor-model.js`, `index.html`, `test/admin-object-editors.test.js`).
  Browser model is an IIFE exposing `window.AdminObjectEditorModel`; tested in a vm context.
- [ ] 6. Focus frame: PARTIAL, not measured (no real display in this session)
- [x] 7. `npm run check` passes on this branch after tasks 4 and 5 (668 tests, 0 failures). Final commit of this file follows.

## Done
- Task 4 commit `b4fb116`: `GET /api/actions/confirm/<name>` (destructive only, else 404), `POST /api/actions/<name>` (unknown 404,
  destructive without `confirm` 428, consumed with `consume` else 403, no handler 503, handler error 500 `Action failed`, success `{ ok, message }`).
  `createConfirmations()` from `backend/confirmation.js` (on `main`, merged into this branch) is used as is; no own token code.
  Panel: Actions page, one `button.action-button[data-action]` per `ACTIONS` entry, two presses for `restart-launcher`, result in `p.action-result`
  (`action-result-ok` / `action-result-error`). Text via `textContent` only.
- Task 5 commit `0a5fc89`: six structured settings get forms from `OBJECT_FIELDS` (served by `/api/settings-description`): boolean checkbox,
  text input, enum select, number input with min/max, list textarea (one value per line). Save: `PUT /api/config` with
  `{ settings: { <object>: <full object> } }`. A 422 shows in `.object-editor-field-error` on the matching field, otherwise on the form.
  `header`, `categories`, `theme`, `background`, `wallpaperSources` stay read-only with `.object-editor-readonly-hint` "Edit on the TV for now".
  The browser cannot load `object-fields.js`, so the model mirrors `validateFieldValue`; the test asserts both agree on every field and 24 values.
- Not touched: `server.js`, `index.js` (see Requests), `main`, `panel.css`, `backend/actions.js`, `backend/confirmation.js`, `object-fields.js`.

## Verified
- `npm run check` (in `.worktrees/r07-claude`) after commit `b4fb116` and after commit `0a5fc89`: exit 0, 668 tests, 668 pass, 0 fail
  (the second run is the final one for this round's code).
- `node --check` on `panel.js` and `object-editor-model.js`.
- Tests added: `test/admin-actions.test.js` (confirm route 404/401/405, 428, 403, single use, 503, unknown 404, handler 500 generic);
  `test/admin-object-editors.test.js` (object list, draft/build round trip, kept keys, list and number rules, client/server rule agreement,
  `patchFor`, server message matching, class names defined in `panel.css`, no top-level globals from the model file).

## Unverified / not done
- Real display and TV: the Actions page, the Status/Log pages and the object editors were NOT opened in a browser or on the TV.
- Task 6 (focus frame): not measured. Needed on the real display: `border-radius`, `inset`, `padding`, `box-shadow` of `.tile`,
  `.tile::before`, `.tile::after` (glow in `home.css`) and `.tile .art`, then one radius token. Default theme and one other theme, before and after.
- Status routes: `index.js` `statusSources()` `vpn` and `spotify` entries need `statusSummary` from `src/main/ext/vpn.js` and `media.js` (Request 2).
  Until then those two report `error`.
- The 422 path of the object editor and the 403 path of the action (second press after 60 s) were covered by server tests only, not by a browser run.

## Files changed (this round, claude)
- `src/main/admin/routes.js`: status, log, diagnostics routes; action routes; `actions` option (default `{}`).
- `src/main/index.js`: log ring, `statusSources()`, `adminSecretNames()`, three options passed to `createAdminServer`. No action handlers.
- `src/main/admin/panel/panel.js`: Status, Log, Actions pages; object editors.
- `src/main/admin/panel/index.html`: page nav, `object-editor-model.js` script tag, `<main class="panel">`.
- `src/main/admin/panel/object-editor-model.js` (new): pure form-to-object logic.
- `test/admin-actions.test.js`, `test/admin-object-editors.test.js` (new).
- `backend/ADMIN.md`: status, log, diagnostics and action routes.

## Requests for the coordinator
1. **`src/main/admin/server.js` (not on any ownership list).** `createAdminServer` must accept `getStatus`, `getLogTail`, `getSecretNames` and
   `actions` and pass them to `createAdminRoutes`; `handleRequest` must pass `query: new URL(request.url, boundUrl).searchParams` to `routes.dispatch`.
   Until this lands the status, log and diagnostics routes answer 503 and every action answers 503.
2. **`src/main/ext/vpn.js` and `src/main/ext/media.js` (not mine).** Export a read-only `statusSummary` (already referenced by `statusSources()`),
   so the status page can show `vpn` and `spotify`.
3. **Action handlers (blocks real use of task 4).** In `index.js`, pass `actions: { 'reload-config', 'restart-soloist', 'clear-cache', 'pair-tv',
   'restart-launcher' }` once `server.js` forwards them: `buildModel`, soloist `restart`, icon and artwork caches plus `weather-cache.json`
   (never config, `.env` or tokens), `adminServer.pair()`, `app.relaunch()` then `app.exit(0)`. Left out of this round: needs Request 1 first.
4. **Task 6 needs the TV or a real display session.** Coordinator or user to measure and fix the focus frame (see Unverified).
5. **`.page-nav` styling.** The page nav uses `button button-quiet` and no extra class, since `.page-nav` is not in the cursor contract.

## Resume notes
1. Request 1 and Request 3 land in `server.js` and `index.js`; then re-run `npm run check`.
2. Task 6: on the real display, read the computed values listed above for `.tile`, `.tile::before`, `.tile::after` and `.tile .art`,
   record them here, then fix with one radius token shared by frame, art and glow. Keep motion, scale and colour unchanged.
3. Open the Actions, Status, Log and object-editor pages in the real panel and check each once before the round is closed.
