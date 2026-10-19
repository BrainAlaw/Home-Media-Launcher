# Round R05: admin panel web UI (generated from the settings description)

Goal: a web page served by the launcher on the LAN where every user-facing setting can be read and changed.
The pages are generated from `backend/settings-descriptor.js`, so a setting that is in the descriptor appears in the panel
without extra UI code. Pairing and the API come from R04.

Base: `main` (after R04).

## Tasks

| Agent | Tier | Worktree | Branch | Task |
|---|---|---|---|---|
| `codex` | M | `D:\Github Repos\hml-r05-codex` | `r05/codex` | Static panel: pages generated from the descriptor, forms per type, save through `PUT /api/config` (see `codex.md`) |
| `claude` | L | `D:\Github Repos\hml-r05-claude` | `r05/claude` | Panel route and asset serving with the security headers, the object editors for complex blocks, real-network check (see `claude.md`) |

## File ownership

| Agent | Owned files |
|---|---|
| `codex` | `src/main/admin/panel/` (new folder: `index.html`, `panel.js`, `panel.css`, `form-model.js`), `test/admin-panel-model.test.js` (new), `agents/state/CURRENT_STATE_codex.md` |
| `claude` | `src/main/admin/routes.js` (panel routes only), `src/main/admin/static.js` (new), `test/admin-static.test.js` (new), `backend/settings-descriptor.js` (only if a description needs fixing), `backend/ADMIN.md`, `agents/state/CURRENT_STATE_claude.md` |

## Rules for the panel (both agents)

- No external scripts, fonts or images. Everything is served by the launcher (CSP `default-src 'self'`).
- Every form field is produced from the descriptor entry (`label`, `help`, `type`, `options`, `default`). No hand-written field list.
- `object` entries (for example `remote`, `vpn`, `wallpaper`) are shown as read-only JSON in this round; their editors come in a later
  round. Say so in the page, do not hide them.
- Saving sends the whole `settings` change through `PUT /api/config` with the `X-HML-Request` header. Validation errors from the server
  are shown next to the form, not as a generic failure.
- Works on a phone (single column, 16 px side margins, no horizontal scroll) and on a laptop.
- Keyboard accessible (labels, focus order, visible focus). Respects `prefers-reduced-motion`.

## Merge order

1. `codex` (its state says DONE, `npm test` passes in its worktree)
2. `claude` (merge `r05/codex` first, then the routes and the static serving)
3. Coordinator: check on the real network from the TV's own browser and from a phone (if the phone can be used), then change one
   setting from the panel and confirm it on the TV (`launcher:model-updated`).

## What the user does

| Tool | Folder | Paste |
|---|---|---|
| Codex | `D:\Github Repos\hml-r05-codex` | `Read AGENTS.md and agents/rounds/R05/codex.md, then follow the prompt.` |
