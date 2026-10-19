# R05 · claude · Tier L

- Worktree: `D:\Github Repos\hml-r05-claude` (branch `r05/claude`).
- Read first: `PLAN.md` (rules), `src/main/admin/routes.js`, `src/main/admin/server.js`, `src/main/index.js` (`applyAdminServer`),
  `backend/ADMIN.md`.
- State file: `agents/state/CURRENT_STATE_claude.md` (copy the template, header `(round R05)`, commit first).
- Owned files: the list in `PLAN.md`. Codex owns `src/main/admin/panel/*`; use its contract and merge its branch when DONE.

## Tasks

1. **Static serving** `src/main/admin/static.js` (new, pure where possible):
   - `serveStatic(request, response, root)`: serves only files under the panel folder, a fixed allowlist of extensions
     (`.html .js .css .json .svg .png`), `Content-Type` set per extension, `Cache-Control: no-cache`, the security headers from
     `server.js`. Path traversal (`..`, encoded separators, absolute paths) is refused with 404. Test them all.
   - Route `GET /admin/` -> `index.html`, `GET /admin/<file>` -> the file. Not behind login (the page itself is public; the data is not).
2. **Routes** in `src/main/admin/routes.js` (panel-only additions, keep the existing ones):
   - `GET /api/settings-description` (no login needed; it contains no values): returns `{ GROUPS, SETTINGS, INTERNAL_PATHS }` from
     `backend/settings-descriptor.js`. Test that it contains no secret values (it has none, the test proves it stays that way).
   - Wire the static route in `server.js` before the 404.
3. **Object editors** for `remote`, `vpn`, `wallpaper`, `wallpaperSources`, `soloist`, `backgroundApps`, `header`, `homeHeader`,
   `categories`, `theme`, `background`: keep them read-only in this round, but add a "Edit on the TV for now" hint in the page
   (codex renders the read-only block). Plan the editors for R07; list the exact fields per object in
   `agents/state/CURRENT_STATE_claude.md` under "Resume notes" so R07 can start from the list.
4. **Real network check**: the launcher with `admin.enabled`, then open `http://192.168.0.196:8787/admin/` from the TV's own browser
   (Chromium on the Windows machine) and from a phone if one is available. Log in with the code shown on the TV, change one setting
   (a toggle), save, and confirm it on the TV (the setting changes on screen). Capture the TV screen (`desktopCapturer`) and the
   result in the state file.
5. **Security re-check** of everything served: CSP, no inline script (the page must work with `script-src 'self'`), no `eval`.
   The panel's JS and CSS are separate files.
6. `npm run check`, commit, state file `Status: DONE` or `PARTIAL` with the real-network results.

Do not merge, do not push, do not touch `main`.
