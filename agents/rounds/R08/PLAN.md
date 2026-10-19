# Round R08: Quick settings: passive Ethernet card and one focus style for every focusable row

Goal: in the Quick settings sheet, the Ethernet card is information only (no focus, like the `MK-PC` header info). Every focusable row
(Tailscale, Surfshark, switches such as Start at login, actions) uses the same focus animation.

Base: `main` (after the docs commit `321b934`).

## Scope

1. **Row model** (codex): a pure function decides whether a Quick settings entry is focusable or informational.
2. **Focus contract test** (copilot): one static test checks the CSS and markup against the contract below.
3. **Rendering and styles** (claude, as a chat subagent): the Ethernet card becomes `.qs-info`; Tailscale, Surfshark and switches become
   `.qs-row`; one focus rule covers `.qs-row`; the separate VPN focus rules are removed.

## Contract (fixed before work starts)

- `.qs-row`: focusable. Has the single focus rule `.qs-row:is(:focus, :focus-visible)` (and `:focus-within` for rows with a nested switch).
- `.qs-info`: informational. No `tabindex`, no `role="button"`, no focus or hover rule.
- Nothing else in the Quick settings sheet may have a focus rule that differs from `.qs-row`.

## Owners

| Agent | Runs as | Worktree | Branch | Task |
|---|---|---|---|---|
| `codex` | Codex CLI (Tier M) | `.worktrees/r08-codex` | `r08/codex` | scope 1 |
| `copilot` | Copilot CLI (Tier S) | `.worktrees/r08-copilot` | `r08/copilot` | scope 2 |
| `claude` | subagent of the coordinator chat (Tier L) | `.worktrees/r08-claude` | `r08/claude` | scope 3 |

## Ownership map

| File | Owner |
|---|---|
| `src/renderer/quick-settings-model.js` (new), `test/quick-settings-model.test.js` (new) | codex |
| `test/quick-settings-focus.test.js` (new) | copilot |
| `src/renderer/status-widgets.js`, `src/renderer/status.css`, `src/renderer/menu.css`, `src/renderer/styles.css`, `src/renderer/index.html` | claude |
| `agents/state/CURRENT_STATE_<agent>.md`, `.worktrees/logs/r08-<agent>.log` | each agent |

## Merge order

1. `codex` and `copilot` (independent). `copilot`'s test passes only after `claude` is merged, so it is merged last.
2. `claude`.
3. Coordinator: `npm run check`, then the user verifies on the PC screen: focus on Tailscale, Surfshark, Start at login and the Ethernet card.
   Screen capture with `desktopCapturer` before and after.

## Verification that needs the user

Visual focus animations and the Ethernet card are checked on the real screen by the user. The state files say so, and nothing is claimed as verified before that.
