# R04 · claude · Tier L

- Worktree: `D:\Github Repos\hml-r04-claude` (branch `r04/claude`).
- Read first: `PLAN.md` (contract), `src/main/config.js` (every key `validateConfig` checks), `src/main/index.js`
  (`launcher:save-settings`, `buildModel`, `reloadConfig`), `src/renderer/settings.js` (what the Settings dialog reads and writes),
  `AGENTS.md` and `CLAUDE.md`.
- State file: `agents/state/CURRENT_STATE_claude.md` (copy the template, header `(round R04)`, commit first).
- Owned files: listed in `PLAN.md`. Codex owns `src/main/admin/*`. Build against the contract and mock it until codex merges.

## Goal

1. **Settings description** `backend/settings-descriptor.js`: one array with one entry per user-facing setting. Each entry:
   `{ path, group, label, type ('boolean'|'text'|'number'|'enum'|'list'|'object'), default, options?, help }`. `path` is a dotted
   path into the config (for example `settings.header.showWeather`). Groups are the Settings pages (general, appearance,
   wallpapers, applications, websites, remote, music, vpn, controllers, performance, background, admin). Also export
   `INTERNAL_PATHS`: config paths deliberately left out of the panel, each with a reason (for example `menu`, `rows`,
   `settings.iconOverrides`, `settings.selectedAppIds`, `settings.hiddenAppIds`).
2. **Coverage test** `test/settings-descriptor.test.js`: every key that `validateConfig` checks must be either in the
   descriptor or in `INTERNAL_PATHS`. A new validated key without an entry fails. Also: the descriptor defaults must pass
   `validateConfig` when placed in a minimal config.
3. **Rules** in `AGENTS.md` (section 2) and `CLAUDE.md`: "every user-facing setting is registered in
   `backend/settings-descriptor.js` in the same commit that adds it, or listed in `INTERNAL_PATHS` with a reason. The coverage
   test enforces it. A feature is not done until its setting or action is reachable from the admin panel."
4. **Glue** in `src/main/index.js`: create the admin server when `admin.enabled` is true, with `getConfig: () => config`,
   `saveConfig: (next) => saveConfig(configPath, next)` followed by `config = next` and `buildModel()` exactly like
   `launcher:save-settings`, `validate: validateConfig`, `onPairCode` sends `launcher:admin-pair-code` to the window, `log`
   goes to `console.warn`. Stop it on `before-quit`. In `config.js` add one additive block: `admin.enabled` (boolean, default
   false), `admin.port` (integer 1024-65535, default 8787), `admin.bindAddress` (optional string). Add an IPC handler
   `launcher:admin-pair` that calls `pair()` and returns the expiry. Add a button "Show admin pairing code" to the Remote
   Settings page that calls it.
5. **TV pairing card** `src/renderer/admin-pairing.js` and `admin-pairing.css`: listens to `launcher:admin-pair-code`, shows a
   full-width card with the 6 digits large, the URL `http://<address>:<port>` and a countdown. Hides on expiry, on
   `launcher:admin-paired`, or on B or Esc. Not focusable by the d-pad (information only). HIG tokens. Expose the preload
   lines for both events in `src/main/preload.js`.
6. **Check**: `npm run check`. Run the app in a temp profile with `admin.enabled: true`, press the button, read the code on the
   real display. Once codex is merged, run the LAN pairing check from a second device (see `PLAN.md`).

## Tasks (commit after each, tick it in your state file)

1. `backend/settings-descriptor.js` and `test/settings-descriptor.test.js`.
2. Rules in `AGENTS.md` and `CLAUDE.md`.
3. `config.js` admin block and `test/admin-config.test.js`.
4. Merge `r04/codex` into this branch when it is DONE. Then the glue in `index.js` and the IPC handler.
5. Pairing card, its CSS, the Settings button and the preload lines.
6. Real display check, then the LAN check from a second device.
7. State file: `Status: DONE` or `PARTIAL`, real-network results, open questions.

Do not merge, do not push, do not touch `main`.
