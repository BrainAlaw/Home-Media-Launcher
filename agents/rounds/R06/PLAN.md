# Round R06: status, diagnostics and actions in the admin panel

Goal: from the panel you can see what is running and what went wrong, and you can run the actions the TV already has,
without the TV remote. Everything here is reachable from the panel, per the rule in `AGENTS.md`.

Base: `main` (after R05).

## Scope

1. **Status** (`GET /api/status`, login needed): launcher version, uptime, admin server state, Vibepollo host (online / offline /
   cached and last sync age, no token), Spotify (signed in / not configured, no tokens), Soloist (state from the supervisor), VPN
   (Tailscale and Surfshark state), network (link type and IP, no SSIDs of other networks), weather (last result, no key).
2. **Log** (`GET /api/log?tail=200`, login needed): the last N lines of the launcher's own log (ring buffer in memory, written by
   the main process). Every line passes a redaction filter that removes values of keys from `.env` and tokens; the filter has tests
   with real-looking fixtures.
3. **Diagnostics** (`GET /api/diagnostics`): one JSON file with status, the redacted log tail, the settings with secrets masked, and
   the list of which secret keys are set (names only). Downloadable from the panel. Never includes `.env` values or token files.
4. **Actions** (`POST /api/actions/<name>`, login, CSRF header, a short confirmation token in the body for destructive ones):
   - `reload-config`: re-reads `config.json` and rebuilds the model.
   - `restart-soloist`: restarts the Soloist supervisor.
   - `clear-cache`: clears the artwork and icon caches (not the config, not tokens).
   - `pair-tv`: the same as the TV button (shows the pairing card on the TV again).
   - `restart-launcher`: restarts the launcher process (confirmation token required).
   Each action is listed in the descriptor's action list (add `backend/actions.js` or extend the descriptor with `ACTIONS`), so the
   coverage test can check that every action is also a route and a panel button.

## Owners

| Agent | Tier | Worktree | Branch | Task |
|---|---|---|---|---|
| `codex` | M | `D:\Github Repos\hml-r06-codex` | `r06/codex` | Log ring buffer with redaction, status and diagnostics builders (pure, tested) |
| `claude` | L | `D:\Github Repos\hml-r06-claude` | `r06/claude` | Actions with confirmation and their routes, status wiring in `index.js`, panel pages for status, log and actions, real-machine check |

## Rules

- The log filter is the single place that removes secrets from text. Actions and diagnostics use it too; nothing writes raw
  environment values anywhere.
- Destructive actions (`restart-launcher`) need a confirmation token that the server issues from `GET /api/actions/confirm/<name>`
  and that expires in 60 seconds.
- Status never blocks: each probe has a timeout; a slow service shows as `unknown`, not as a stuck panel.

## Merge order

1. `codex` (log, redaction, status and diagnostics builders)
2. `claude` (actions, routes, index.js wiring, panel pages)
3. Coordinator: real machine check of every action from the panel, a secret-leak search over the diagnostics file, then the user decides.
