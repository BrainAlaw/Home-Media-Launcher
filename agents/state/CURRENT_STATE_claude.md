# CURRENT_STATE_claude (round R04)

Status: DONE            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code  ·  Branch: r04/claude  ·  Last update: 2026-10-19

## Tasks
- [x] 1. `backend/settings-descriptor.js` and `test/settings-descriptor.test.js` (coverage of every validated setting)
- [x] 2. Rules in `AGENTS.md` and `CLAUDE.md` (every setting and action reaches the admin panel)
- [x] 3. `settings.admin` validation (`enabled`, `port`, `bindAddress`) and `test/admin-config.test.js`
- [x] 4. Merge of `r04/codex`, glue in `index.js` (start on model build, pairing IPC, events, stop on quit)
- [x] 5. Pairing card (`admin-pairing.js`, `.css`), Settings button, preload lines, `onPaired` hook in codex's routes
- [x] 6. Real machine check (`scripts/e2e/admin-check.cjs`): 9 of 9 on 192.168.0.196:8787; `backend/ADMIN.md` written

## Done
- Descriptor with 19 user-facing settings and 6 internal paths (each with a reason). The coverage test fails on a new validated key without an entry.
- Admin block moved to `settings.admin` to match the server code.
- Default bind now prefers RFC 1918 addresses; Tailscale (100.64/10) is ignored. Found on the real machine: it had picked Tailscale.
- Pairing card on the real display (screenshot in `scripts/e2e/out/admin-2026-10-19T08-15-00-767Z/`).

## Verified
- `npm test`: 603 pass, 0 fail.
- Real machine, 192.168.0.196: health, security headers, pairing card, 6-digit code, wrong code 401, right code sets the cookie, config read with secrets masked, cross-site write 403.

## Unverified / not done
- A second device on the LAN (only `/api/health` can be called without a UI; the panel UI is R05).
- Windows Firewall: the first start raises a prompt for private networks; it must be allowed once (documented in `backend/ADMIN.md`).
- The config read is checked for secret values with a pattern; the list of secret-looking keys should be reviewed in R05.

## Files changed
- `backend/settings-descriptor.js`, `test/settings-descriptor.test.js` — new.
- `backend/ADMIN.md` — new.
- `src/main/config.js` — admin validation (`settings.admin`).
- `src/main/index.js` — admin glue.
- `src/main/admin/server.js` — default bind (private LAN only); `onPaired` passed to the routes (small change in codex's file, coordinator decision).
- `src/main/admin/routes.js` — `onPaired` hook.
- `src/renderer/admin-pairing.js`, `admin-pairing.css`, `test/admin-pairing.test.js` — new.
- `src/renderer/index.html`, `src/main/preload.js` — card and button wiring.
- `AGENTS.md`, `CLAUDE.md` — the rule for settings and the panel.
- `scripts/e2e/admin-check.cjs` — new real-machine check.

## Requests for the coordinator
- R05 (panel web UI) must build every page from `backend/settings-descriptor.js`, not by hand.
- R06: status and diagnostics endpoints are not written yet; they go in the same descriptor/actions rule.

## Resume notes
Merge done into `main` after this state is committed. Next: R05 (web panel generated from the descriptor), then R06 (status and actions).
