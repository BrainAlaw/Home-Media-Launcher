# Current state (17 October 2026)

Resume point for the next session. Everything below is verified against the repository unless marked **unverified**.

## Git

- Working branch: `feat/iteration-4` (HEAD `363e9ca`). `master` holds only the baseline commit `7abda50`; nothing has been merged to `main` or pushed to GitHub.
- All feature branches (`iter4/a`–`g`, `fix/p`, `q1`, `q2`, `r`, `s`, `t`) are merged into `feat/iteration-4`.
- Helper worktrees live in `D:\Github Repos\Home-Media-Launcher-wt\` (14 entries incl. main). Safe to delete once nothing else is pending:
  `git worktree remove --force ../Home-Media-Launcher-wt/<name>` for each, then `git branch -D` the iter4/fix branches if wanted.
- `.env` is git-ignored (`.env.example` is committed). Keys: `VP_API`, `VP_HOST`, `VP_IP`, `WEATHER_API`, `STEAMDB_API`. They are read by `backend/env.js`, scrubbed from `process.env` after `readSecrets()` and never reach the renderer.
- Checks: `npm run check` → 297 tests, 0 failures. Run Electron with `unset ELECTRON_RUN_AS_NODE` (the VS Code terminal can set it, which breaks `require('electron')`).

## What exists (all 26 requested items implemented)

Round 1 (17 items): new home layout (Home Theatre + Gaming with Vibepollo host badge), tile focus/hover motion, concentric header radii, 16 web presets with icons, network/VPN status chips, weather via OpenWeatherMap, launch/close transitions with Guide-hold exit overlay, Fire TV / Google TV remote input (no CEC), wallpaper credits and sources editor, Appearance page, namespaced IPC (`window.launcher.ext.invoke/on`, modules in `src/main/ext/`).

Round 2 (9 items): top navigation bar and Library removed (Settings is reached via the Quick settings sheet); Appearance uses dropdowns with a fixed preview pane; Applications page redesigned (cards, inline icon picker); icons resolved from the services' own sites (10 of 16 real icons, 6 monogram fallbacks); Vibepollo apps now shown by default (`settings.hiddenAppIds`); launch bug fixed (`launchIdFrom` accepts `appId`); Surfshark on Windows via `rasdial` / WireGuard service / OpenVPN GUI (`backend/VPN.md`); Quick settings legibility; HIG token layer (`src/renderer/hig.css`, `backend/DESIGN.md`).

Key docs: `backend/MENU-PERFORMANCE.md`, `backend/DESIGN.md`, `backend/ICONS.md`, `backend/VPN.md`, `backend/REMOTES.md`, `backend/SESSION.md`.

## Latest fix: grey screen on `npm start`

- Cause: `in-process-gpu` (added for the 30 fps cap) presents a flat grey fullscreen window on the reference host, although `capturePage` shows a correct page.
- Fullscreen measurements (600 rAF frames, 5120x1440 desktop with two 2560x1440 displays, RTX 3080 + Sunshine/Parsec/SudoMaker virtual displays):
  - separate GPU process: 30.5 ms avg (~33 fps), correct output;
  - `in-process-gpu`: 6.1 ms but grey;
  - `disable-gpu-compositing` (now the Windows default): 7.1 ms avg, p95 12.2 ms, correct output.
- Opt-ins: `HML_GPU_PROCESS=inprocess`, `HML_GPU_COMPOSITING=gpu`, `HML_GPU_SAFE=1` (all off). Code in `src/main/gpu-flags.js`.
- The user has **not yet confirmed** that `npm start` now shows the UI after this fix.
- Lesson: verify rendering against the real display (`desktopCapturer`), not `capturePage`. `scripts/bench-ui.cjs` measures windowed only and its "163 fps" numbers are not representative of fullscreen.

## Known open issues (from the last real-profile screenshot)

1. Preset tiles show small coloured squares with a letter: the bundled monogram tiles are composed too small, and the real icons are fetched in the background so they may not be cached yet on first run. Netflix, Spotify, Jellyfin, Canal+, Crunchyroll and Tidal have no real icon (sites return a tiny icon or 403). SkyShowtime's wordmark looks cropped.
2. Gaming tiles (Desktop, Gaming, Remote Input, Remote Monitor, TV) show only large letters: no cover art. Vibepollo artwork / SteamGridDB is not being applied to them.
3. The focused Netflix tile appears to extend above its row (clipping/scale overlap with the section title) — check against the HIG focus spec.
4. Quick settings sheet is ~95% opaque without blur; tile names showed through faintly in one screenshot. Increase the surface opacity or add a scrim.
5. Fullscreen frame pacing relies on software compositing (higher CPU). Re-benchmark in fullscreen on the target Linux HTPC; nothing was measured on Linux.
6. Dead selectors for the removed nav bar remain in `src/renderer/perf.css`; unused `.preset-card/.preset-grid/.font-list` rules remain in `styles.css`/`theme.css`.
7. Review items deliberately left: VPN/network/input polling continues while an app is running; `migratePresetIcons` is not called (legacy `file://` icon values still work through `asset-url.js`).

## Unverified (never run for real)

- Surfshark connect/disconnect on Windows (create an IKEv2 profile named "Surfshark", see `backend/VPN.md`), Tailscale toggle on Linux, WireGuard service ACLs.
- Guide-button hold exit overlay, Moonlight quit chord, Wayland behaviour, evdev reading on Linux.
- Fire TV / Google TV remote key mapping on a physical remote.
- Gamepad navigation through the new Settings page (custom dropdowns, icon picker).
- Weather via OpenWeatherMap with the real key; SteamGridDB lookups with the real key.

## Suggested next steps

1. Ask the user to run `npm start` and confirm the grey screen is gone.
2. Fix open issues 1–4 (icons composition and cached art, Gaming artwork, focus overlap, sheet opacity).
3. Decide whether to merge `feat/iteration-4` into `main`, push, and clean up the worktrees.
4. Test on the Linux HTPC target (Wayland/X11, evdev access, NetworkManager polkit rule from `backend/VPN.md`).

## Useful commands

```
npm start                                  # real profile, fullscreen
npm run check                              # syntax checks + all tests
unset ELECTRON_RUN_AS_NODE; npx electron . --test-profile --windowed   # throwaway profile
npx electron scripts/bench-ui.cjs          # windowed frame-pacing benchmark
```

User data: `%APPDATA%\home-media-launcher` (real), `%APPDATA%\Vibepollo-Test` (`--test-profile`). Never print `remote-token.json` or `.env` values.
