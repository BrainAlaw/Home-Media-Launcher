# CURRENT_STATE_claude (round R05)

Status: PARTIAL            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code  ·  Branch: r05/claude  ·  Last update: 2026-10-19

## Tasks
- [x] 1. `src/main/admin/static.js` (serving, allowlist, traversal refusal) and `test/admin-static.test.js`
- [x] 2. `GET /api/settings-description` in `routes.js`; static route wired in `server.js` before the JSON API
- [ ] 3. Read-only object blocks with the "Edit on the TV for now" hint: the hint lives in codex's panel (not merged yet). Resume notes list the R07 fields.
- [ ] 4. Real network check: LAN part done (R04 check, 9 of 9). TV browser, phone, toggle, and TV confirmation not done (see below).
- [x] 5. Security re-check of what the launcher serves (headers, allowlist, no eval in the new code)
- [x] 6. `npm run check` passes (609 tests, 0 fail); committed

## Done
- Static serving: flat files, extensions `.html .js .css .json .svg .png`, `Cache-Control: no-cache`, security headers on every response (also 404/405/301) — commit `f964cd7`.
- `GET /api/settings-description` (no login): `{ GROUPS, SETTINGS, INTERNAL_PATHS }` — commit `f964cd7`.
- `server.js`: `/admin` and `/admin/*` go to `serveStatic` before body parsing and the JSON routes — commit `f964cd7`.
- `backend/ADMIN.md`: panel files, description endpoint, read-only object settings — commit `f964cd7`.

## Verified
- `node --test test/admin-static.test.js test/admin-routes.test.js test/admin-server.test.js`: 20 pass, 0 fail.
  - resolver: valid names; refused `..`, `%2e%2e%2f`, `%2E%2E%5C`, `%252e…`, `%2f`, `%5c`, `C:`, `%00`, dot files, sub-folders, `%` after decode, `.txt`/`.exe`, no extension.
  - raw-socket requests (no client-side `..` normalisation): traversal and blocked names return 404 and never leak the outside file's contents; HEAD has no body; PUT gives 405; `/admin` gives 301.
  - description: body equals the descriptor; no secret value in the body; POST gives 405.
- `npm run check`: `609 tests, 609 pass, 0 fail`.
- Real machine, R04 check (`scripts/e2e/admin-check.cjs`, run from this worktree, temp profile, real config not written):
  `ADMIN-CHECK PASSED: 9 checks, 0 failed`, LAN address `192.168.0.196:8787`, report
  `scripts/e2e/out/admin-2026-10-19T08-26-28-200Z/report.md`, pairing card screenshot `01-pairing-card.png` in the same folder
  (the folder is git-ignored; the screenshot is on disk only). Covers health, security headers, pairing card on the TV,
  wrong code 401, right code cookie, config read with secrets masked, cross-site write 403.
- Security headers: `Content-Security-Policy: default-src 'self'`, `nosniff`, `no-referrer` on static responses (checked in tests).

## Unverified / not done
- **Task 4, the panel in a browser**: not done. `src/main/admin/panel/` is codex's and is not on `main` or in this branch
  (`r05/codex` is `IN_PROGRESS`: 2 of 4 items, commit `71635c8`). So `GET /admin/` returns 404 here, and there is no page to
  log in with or to toggle a setting. I did not merge `r05/codex`, as the plan requires DONE first.
- **TV browser and phone**: they need a person at the TV and a phone on the LAN. I could not do them from here.
- **Toggle on the TV** (`launcher:model-updated` after saving from the panel): not done, depends on the panel.
- **`desktopCapturer` capture of the TV during the toggle**: not done. The pairing-card capture above is from the R04 check.
- **Security re-check of the panel's JS/CSS** (`script-src 'self'`, no inline script, no `eval` in the page): depends on codex's files.
  Only the server side is verified here.
- Real LAN check of `/admin/` and `/api/settings-description` over the network: not run. Both are covered by the in-process server test;
  the R04 script does not request them.

## Files changed
- `src/main/admin/static.js` — new: `resolvePanelFile` (pure), `serveStatic`.
- `src/main/admin/routes.js` — `GET /api/settings-description` added; existing routes unchanged.
- `src/main/admin/server.js` — `PANEL_ROOT`, `serveStatic` wired before body parsing. Not in the R05 ownership table; the prompt asked for this wiring and no other agent touches the file this round.
- `test/admin-static.test.js` — new, 6 tests.
- `backend/ADMIN.md` — panel files, description endpoint, object settings note.
- `package-lock.json` — unchanged; `npm install` in this worktree only restored `electron` (`dist/` download) for the real-machine check.

## Requests for the coordinator
- **Codex's panel must include the "Edit on the TV for now" hint** in the read-only block for `remote`, `vpn`, `wallpaper`, `wallpaperSources`,
  `soloist`, `backgroundApps`, `header`, `homeHeader`, `categories`, `theme`, `background`. The hint is not in `r05/codex` yet.
- **Codex's panel must not use inline script or `eval`**: `default-src 'self'` blocks them, so the page would not start.
- **`r05/codex` is not DONE** (2 of 4 items). Merge it, then run task 4 (TV browser, phone, toggle, capture). Until then R05 stays PARTIAL.
- `settings.admin` is in `INTERNAL_PATHS` (bootstrap). The panel cannot change it, so its own enable/disable needs `config.json` for now.
- The R04 check writes its report under `scripts/e2e/out/`, which is git-ignored. The report is kept on disk only.

## Resume notes
Next: after `r05/codex` is DONE, merge it into this branch (`git merge --no-ff r05/codex`), run `npm run check` again, then:
1. Start the launcher with `settings.admin` enabled. Open `http://192.168.0.196:8787/admin/` in the TV's Chromium, sign in with the code on the TV,
   switch one toggle (for example `showTileLabels`), save, and check the change on the TV.
2. Repeat from a phone on the LAN (single column, no horizontal scroll).
3. Capture the TV with `desktopCapturer` before and after the change, and record the paths here.
4. Re-check `script-src 'self'` and that no inline script or `eval` is in `src/main/admin/panel/`.

### R07 starting list: object settings (read-only in R05)
Verified against the validators in `src/main/config.js` and `backend/soloist/settings.js` and `src/main/background-apps.js`:
- `remote` (`validateConfig`): `host` (string, no leading `-`, no whitespace or control characters); `apiUrl` (HTTPS only, no credentials, query or fragment);
  `moonlightPath` (string); `moonlightArgs`, `streamArgs` (arrays of strings); `enabled`, `allowSelfSigned` (boolean).
- `vpn`: `surfsharkProfile`, `surfsharkWireguardProfile` (connection names, `isSafeProfileName`); `surfsharkMode` (`auto`, `wireguard-service`,
  `openvpn-gui`, `rasdial`, `nmcli`).
- `wallpaper`: `source` (`bundled`, `folder`, `online`, `mixed`); `shuffle`, `online` (boolean); `folders` (max 32, each `{ path (absolute), name? }`).
  Also in `contracts.d.ts`: `mode` (`custom`, `bundled`, `slideshow`), `id`, `intervalSec`, `folderPath`. The validator does not check `mode`, `id` or `intervalSec`; check before R07 editing.
- `wallpaperSources`: array, max `WallpaperSources.MAX_SOURCES`; each item `{ id, label, kind (folder|online), location, enabled }` (see `contracts.d.ts`).
  Folders by absolute path; online by built-in provider or HTTPS catalogue URL. Read `validateWallpaperSources` in full before editing.
- `soloist`: `enabled` (boolean), `deviceName` (non-empty, at most `DEVICE_NAME_MAX`, no control characters), `binaryPath` (absolute path or empty).
- `backgroundApps`: `max` (integer, `MIN_MAX`..`MAX_MAX`, default 3).
- `homeHeader`: `layout` (`split` or `centred`); `showSeconds`, `oledProtection`, `fadeIn` (boolean).
- `header`, `categories`, `theme`, `background`: **not verified in this round.** `categories` is validated by `src/renderer/categories.js` (`Categories.validate`).
  `theme` uses `backend/themes.schema.json` and `backend/theme-validation.js`; `background` (`{ type: 'image' | …, source }`) is in `config.js` defaults.
  R07 starts by reading these four in full.
