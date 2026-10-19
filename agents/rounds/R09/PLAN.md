# Round R09: Ethernet card as a grey info card with a Speed test button; download and upload; result fades back to the IP view

Goal: the Ethernet card in Quick settings looks like the MK-PC card (grey, no focus on the card). It holds one focusable
**Speed test** button that has its own highlight. The speed test measures download and upload, 10 s each. The result stays for 20 s,
then fades out and the card shows the IP and ping again.

Base: `main` (after `31e86ff`). This round follows R08; R08's contract changes as described below.

## Contract (fixed before work starts)

- `.qs-info`: the card. Grey, no `tabindex`, no focus or hover rule on the card itself. It contains the speed button.
- `.qs-speed-button`: the only focusable element on the card. Its highlight is its own rule (`.qs-speed-button:is(:focus, :focus-visible)`),
  not the `.qs-row` animation. The `.qs-row` rule must NOT match it.
- Speed test: download 10 s (`SPEED_DURATION_MS = 10_000`), then upload 10 s to `https://speed.cloudflare.com/__up`. The state object
  carries `phase: 'download' | 'upload' | 'done'`, `downMbps`, `upMbps`.
- Result view: shown for 20 s after `done`, then a 600 ms fade back to the IP/ping view. Pure logic in `speed-card-model.js`.

## Owners

| Agent | Runs as | Worktree | Branch | Task |
|---|---|---|---|---|
| `codex` | Codex CLI (Tier M) | `.worktrees/r09-codex` | `r09/codex` | upload measurement, 10 s durations |
| `copilot` | Copilot CLI (Tier S) | `.worktrees/r09-copilot` | `r09/copilot` | view model: IP or result, 20 s hold, fade timing |
| `claude` | subagent of the coordinator chat (Tier L) | `.worktrees/r09-claude` | `r09/claude` | card, button highlight, fade, wiring in `ext/system.js` |

## Ownership map

| File | Owner |
|---|---|
| `backend/net-probe.js`, `test/net-probe-upload.test.js` (new) | codex |
| `src/renderer/speed-card-model.js` (new), `test/speed-card-model.test.js` (new) | copilot |
| `src/main/ext/system.js`, `src/renderer/status-widgets.js`, `src/renderer/status.css`, `src/renderer/menu.css`, `src/renderer/styles.css`, `src/renderer/index.html` | claude |
| `agents/state/CURRENT_STATE_<agent>.md`, `.worktrees/logs/r09-<agent>.log` | each agent |

## Merge order

1. `codex` and `copilot` (independent).
2. `claude` (uses both).
3. Coordinator: `npm run check`. The user verifies on the PC screen: the card looks like MK-PC, the button highlight is only on the button,
   a speed test runs 10 + 10 s, the result stays 20 s and fades back to the IP view.
