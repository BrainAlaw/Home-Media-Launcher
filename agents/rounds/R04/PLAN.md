# Round R04: admin panel foundation and LAN server

Goal: the launcher can be configured from another device on the local network. This round builds the foundation:
a single settings description that every setting must appear in, and a secure HTTP API in the main process.
The web panel itself comes in R05, status and troubleshooting in R06.

Decisions (from the user): pairing code shown on the TV (5 minutes, then a session cookie); plain HTTP on the LAN with
the session token (no TLS, a known and accepted risk); port 8787; secrets are shown as set / not set only.

Base: `main`.

## Tasks

| Agent | Tier | Worktree | Branch | Task |
|---|---|---|---|---|
| `codex` | M | `D:\Github Repos\hml-r04-codex` | `r04/codex` | Admin server, pairing, sessions, origin and CSRF checks, API routes (see `codex.md`) |
| `claude` | L | `D:\Github Repos\hml-r04-claude` | `r04/claude` | Settings description, coverage test, rules in AGENTS/CLAUDE, glue in `index.js`, pairing card on the TV (see `claude.md`) |

## File ownership

| Agent | Owned files |
|---|---|
| `codex` | `src/main/admin/auth.js`, `src/main/admin/server.js`, `src/main/admin/routes.js` (all new), `test/admin-*.test.js` (new), `agents/state/CURRENT_STATE_codex.md` |
| `claude` | `backend/settings-descriptor.js` (new), `test/settings-descriptor.test.js` (new), `src/main/index.js` (admin glue only), `src/main/config.js` (one additive block for `admin`), `src/renderer/admin-pairing.js` and `.css` (new), `src/renderer/index.html` (one link and one script line), `src/main/preload.js` (one line), `AGENTS.md`, `CLAUDE.md`, `agents/state/CURRENT_STATE_claude.md` |

## Contract between the two (do not change without a note in both state files)

`src/main/admin/server.js` exports `createAdminServer({ getConfig, saveConfig, validate, onPairCode, log })` returning
`{ start(), stop(), status(), pair() }`:
- `start()` binds only to the configured address (default: the first non-internal IPv4 address; never `0.0.0.0`
  unless `admin.bindAddress` says so explicitly) on `admin.port` (default 8787). Returns the bound URL.
- `pair()` creates a 6-digit code valid for 5 minutes and calls `onPairCode({ code, expiresAt })` (the TV shows it).
  Only one live code at a time; a new `pair()` replaces the old one.
- Routes live in `routes.js` and call only the injected functions (`getConfig`, `saveConfig`, `validate`). No route reads
  `.env`, token files or any secret value.
- `admin.enabled` defaults to `false`. When disabled nothing listens.

## Merge order

1. `codex` (its state file says DONE, `npm test` passes in its worktree)
2. `claude` (merge `r04/codex` into it first, then the glue in `index.js` and the renderer card)
3. Coordinator: real-network check from a second device on the LAN (pairing, wrong code, expired code, wrong Origin,
   no session), then the user decides on R05.

## What the user does

| Tool | Folder | Paste |
|---|---|---|
| Codex | `D:\Github Repos\hml-r04-codex` | `Read AGENTS.md and agents/rounds/R04/codex.md, then follow the prompt.` |
