# Current state (18 October 2026, round R01 of the multi-agent workflow)

Resume point for the next session. Everything below is verified against the repository unless marked **unverified**.

## Working rules (since 18 October 2026)

- Multi-tool team: Claude Code (coordinator), Codex, GitHub Copilot, Freebuff, OpenCode, Cursor. Protocol in `AGENTS.md` section 3, coordinator duties in `CLAUDE.md`. Rounds live in `agents/rounds/R<NN>/`, agent reports in `agents/state/CURRENT_STATE_<agent>.md`.
- Agents work in parallel only in separate worktrees (`../hml-<agent>`, branch `r<NN>/<agent>`) with disjoint file ownership; the coordinator merges when the user asks for the next actions and asks before starting a round. Claude Code's own subagents are not used for parallel waves (token cost, merge conflicts).

## Iteration 7 (Spotify Soloist)

- Soloist = headless Spotify Connect client (Linux only; x86_64/aarch64/armv7), local WebSocket API, API key from the Spotify for Developers dashboard (`SPOTIFY_SOLOIST_API` in `.env`), builds expire after 90 days (exit code 10), binary is not redistributable (user installs it; see `backend/SOLOIST.md`).
- Code: `backend/soloist/process.js` (supervisor), `ws-client.js` + `protocol.js` + `state.js` (socket client, MediaState mapping), `manager.js` (glue, adapted to the real X1/X2 APIs), `src/main/ext/soloist.js` (ns `soloist`), preference of the Soloist device in `backend/spotify/service.js` (state from the socket instead of polling `/me/player` when connected), `settings.soloist = { enabled (default false), deviceName, binaryPath }`.
- **UI:** Soloist options live in **Settings > General > Spotify Soloist** (switch, device name, binary path, status line). It was removed from Quick settings on request. The media widget shows a "Soloist: this computer" line when connected. On Windows the feature reports "Not available on this PC".
- **Regression fixed:** the merge of the Soloist UI made the home screen render black (only the header chips). Cause: `soloist-status.js` re-declared the global `SUBTITLE_MAX` that `status-widgets.js` already declares (classic scripts share one global scope), so the file failed to load and `app.js` threw on `window.SoloistStatus.init`. Fixed by renaming; guarded by `test/renderer-globals.test.js` (no duplicate top-level names across the scripts in `index.html`, every referenced file exists).
- Verified on the real display after the fix: Home Theatre and Gaming rows, header, clock, Spotify "Connect Spotify" widget (client id is set in `.env`).
- **Unverified:** the whole Soloist path on Linux (flags, `soloist --version` output, `ws.port`/`ws.addr` files, `timestamp_ms` clock base, device handoff via `PUT /me/player`), the new Settings > General Soloist controls visually, Spotify login with the real account.
- Follow-up work is planned in rounds under `agents/rounds/` (see Working rules above); the R01 gamepad end-to-end harness produces the bug list for R02.

## Iteration 8 (UI pass, committed)

- **Quick settings:** heading removed; header host/Tailscale/Surfshark/network indicators are display-only `div`s (no focus, no click); VPN rows now get the same spring/lens motion as static rows (`MenuController.register`); switch knob uses a plain ease (no overshoot) and a busy state breathes by opacity only.
- **Network row** (first row of the sheet, `#network-card`): link detail + ping every 10 s (TCP connect to 8.8.8.8:443, `backend/net-probe.js`, ns `system` events `ping` / `speedtest`), dot colour by latency (green < 60 ms, amber < 150 ms, red otherwise/offline), same dot on the header network glyph. Press = 20 s download speed test (4 streams from `speed.cloudflare.com`, user-triggered only, nothing stored); press again cancels. Download only, no upload.
- **Spotify:** new default tab "For you" in the music view (`media.forYou`): Spotify-owned playlists from the library (Daily Mix etc., played directly because their track lists are not readable), recently played, top songs, saved albums, top artists, new releases. Spotify no longer exposes recommendations/featured playlists to new apps, so real Daily Mixes appear only if saved to the library. New scopes `user-top-read`, `user-read-recently-played`: an existing login must sign out/in once (the tab shows a note on 403). The widget's "Open Spotify" is now a small Spotify icon in the card corner (hover/focus), last stop of the controls.
- **Gaming row tiles are 2:3 portrait** (`data-shape="poster"`, `tile-art.css`); generated host art is portrait 600x900 (`composeTile({ portrait: true })`, cache dir `games-poster`, old landscape cache ignored).
- **Spotify Web panel:** widget button `Spotify Web` (controls pill) slides the tile rows down and opens `open.spotify.com` in a native `WebContentsView` over `#spotify-web-panel .sw-stage` (ns `spotifyweb`, `src/main/ext/spotify-web.js`, helpers `backend/spotify-web.js`, page input `src/main/spotify-web-preload.js`: D-pad/stick/arrows = spatial focus, A/Enter click, B/Esc history back then close, LB/RB scroll, Guide close). Persistent login partition `persist:spotify-web`; navigation limited to Spotify and social sign-in hosts. No Widevine in Electron, so the page cannot play audio itself: pick a Connect device (Soloist, phone) in the web UI. Verified: panel layout and page load on screen. **Unverified:** gamepad navigation inside the page, login, Connect transfer, text input (no on-screen keyboard inside the page).
- Fixed: `status-widgets.js` subscribed to the session phase inside `armTimers` with an undefined `bridge` (now in `init`).
- Verified via CDP screenshots on the real window: panel, header dots, portrait row geometry (135x203), For-you tab with the mock. **Unverified:** speed test against the real endpoint, For-you with a real login, real portrait art after regeneration.

## Git

- Single branch `main` (HEAD `7417a9e`), created from `iter5` on 18 October 2026. Every iteration branch (`iter4/*`, `fix/*`, `i5/*`, `i6/*`, `i7/*`, `i8/home`, `feat/iteration-4`, `iter5`) was merged and deleted; helper worktrees in `D:\Github Repos\Home-Media-Launcher-wt\` were removed. Pushed to GitHub (`origin` = `https://github.com/BrainAlaw/Home-Media-Launcher.git`, tracking set). The remote's previous unrelated 4-commit history was force-replaced; it is preserved locally as tag `backup/remote-main-2026-10-18` (delete with `git tag -d` once nothing is needed).
- `.env` is git-ignored (`.env.example` is committed). Keys: `VP_API`, `VP_HOST`, `VP_IP`, `WEATHER_API`, `STEAMDB_API`, `SPOTIFY_CLIENT_ID`. Read by `backend/env.js`, scrubbed from `process.env` after `readSecrets()`, never sent to the renderer.
- Checks: `npm run check` → 552 tests, 0 failures (18 October 2026). Run Electron with `unset ELECTRON_RUN_AS_NODE`.
- Review of `c5e4e27..HEAD` (iteration 5): every finding is fixed (the four low/medium leftovers were fixed in iteration 6).

## What exists

Iterations 1–4 (see git history): home layout, presets, VPN/network status, weather, launch/close transitions, remote input, wallpaper sources, HIG token layer (`src/renderer/hig.css`, `backend/DESIGN.md`), software compositing default on Windows (`src/main/gpu-flags.js`), Surfshark via rasdial/WireGuard service/OpenVPN GUI (`backend/VPN.md`).

Iteration 5 (14 requested items):

- **Home screen:** tile rows anchored to the bottom; large date (left) + large thin clock (right), weather under the date (default location `High Wycombe,GB`); alternative `centred` header; OLED options (pixel shift, idle dim, fade-in) in `settings.homeHeader`; rows generated from `settings.categories` (default Home Theatre + Gaming; custom ones can be added). Code: `home-header.js`, `home-layout.css`, `tile-model.js`, `categories.js`.
- **Tile motion:** new spring lift, colour-sampled glow (`tile-accent.js`), masked edge, parallax, neighbour recession; hover uses the same language; lite/reduced-motion variants; focus pad prevents clipping (`--tile-focus-pad`).
- **Quick settings:** iOS-style switches (fixed slot, no jumping), MK-PC host card above Ethernet, header chips for host/Tailscale/Surfshark/network with status dots, coherent settings-button state model, opaque sheet. The Gaming-row host banner was removed.
- **Settings:** dialog typography scaled down (`--hig-dialog-unit` in `hig.css`); Appearance has tile-label switch, categories editor, header layout/OLED/fade-in/seconds, media-widget switch; Applications/Websites cards have a pencil badge and a centred icon popup (`icon-popup.js`); websites have a category selector (`website.category`).
- **Spotify (Web API, PKCE):** backend `backend/spotify/*` + `src/main/ext/media.js` (ns `media`), home widget `media-widget.js` (one focus stop, global media keys, toasts), music view `media-view.js` (search, playlists, devices) and an on-screen keyboard `on-screen-keyboard.js` (`data-osk` inputs; enabled on the settings text inputs). Docs: `backend/SPOTIFY.md`. Mocks for offline UI work: `?media-mock` (`media-mock.js` for the widget, `media-view-mock.js` for the view; main only appends the query for `--perf`, so use a scratch script or one-line change in `main`).

## Spotify setup (user action, not done yet)

1. Create an app at developer.spotify.com/dashboard with a **Premium** account (Development mode requires an active Premium owner; 5 allowlisted users).
2. Register redirect URIs `http://127.0.0.1:8888/callback` … `:8891/callback` (loopback IP literal; `localhost` is not allowed).
3. Add the user's own account under User management.
4. Put the Client ID in `.env` as `SPOTIFY_CLIENT_ID=...`, restart, press "Connect Spotify" in the widget (one-time browser login).
- Limits from the verified API rules: player endpoints are Premium-only; playlist tracks only for playlists the user owns/collaborates on (`/playlists/{id}/items`); search limit 10; `/me` no longer returns `product`. `NO_ACTIVE_DEVICE` handling is matched by message and **unverified**.

## Windows display / GPU notes (important)

- `in-process-gpu` presents a **grey fullscreen window** on the reference host; do not enable it (`HML_GPU_PROCESS=inprocess` is an explicit opt-in). Default on Windows is `disable-gpu-compositing` (~7 ms avg frame, correct output). Opt-ins: `HML_GPU_COMPOSITING=gpu`, `HML_GPU_SAFE=1`.
- Always verify visuals against the real display (`desktopCapturer.getSources({types:['screen']})` or Win32 `CopyFromScreen`), never `capturePage` alone. Display layout on the dev machine: two 2560x1440 displays at x=-2560 and x=0; the launcher opens on the x=0 display. Other agents' windows can cover captures; set the window always-on-top before capturing.
- `scripts/bench-ui.cjs` measures windowed only; do not quote its numbers for fullscreen.

## Iteration 6 (follow-up fixes, merged into `iter5`)

- Done: Spotify polls only while the media UI is visible (`media.setActive`), widget Back goes to the quick-settings button, icon popup reopens reliably, personal weather default removed from shared code (set `showWeather: true` and `weatherLocation: "High Wycombe,GB"` in your config), dead CSS removed, background VPN/network/input polling paused during launched apps (`src/main/activity.js`), preset icon migration to `preset:<id>`, Gaming tile art (SteamGridDB poster for Tekken 6, glyph tiles for built-ins; host cover needs the Vibepollo token to allow `GET /api/apps/*/cover`), 12 of 16 preset icons real.
- Verified on the real display: Home Theatre and Gaming rows, real preset icons and Tekken 6 poster, weather line shows the empty-location hint.
- Not verified: Spotify with real credentials, gamepad flow of the widget and icon popup, Moonlight/game activity gate on a real launch.

## Known open issues

1. (Fixed in i6/g1) Gaming tiles: host payload has no downloadable cover; now SteamGridDB poster / glyph / monogram tiles, see backend/ICONS.md. Cover route needs a token scope (403 today).
2. (Fixed in i6/g1) Preset icons: swap bug in asset-url.js (relative src never matched), wide tile CSS, larger monogram, live art-updated; 12 of 16 presets have real icons.
3. The user's real config has `header.showWeather: false`; weather only appears after enabling Settings → General → Weather (or editing the config). Defaults changed only in `config.example.json`.
4. (Fixed) `homeHeader.oledProtection` now defaults to `true` everywhere (OLED TV).
5. (Fixed in iteration 6) dead CSS removed.
6. Surfshark chip is grey on this machine ("cannot be scripted"); needs the Windows IKEv2 profile named "Surfshark" (see `backend/VPN.md`).
7. (Fixed in iteration 6) background polling pauses during launched apps (`src/main/activity.js`); legacy preset icons are migrated to `preset:<id>` at config load.

## Unverified (never run for real)

- Spotify against a real account (consent page, token exchange, live responses, device handoff, launching the desktop app via `spotify:`).
- Gamepad/remote operation of: widget, music view, OSK, icon popup, categories editor, switches. Only mock/keyboard paths were driven.
- 3840x2160 settings dialog, General settings page visuals, tile-label hiding, OLED pixel shift/dim and fade-in on screen.
- Surfshark connect/disconnect, Tailscale toggle on Linux, WireGuard service ACLs, Guide-button exit overlay, Moonlight quit chord, Wayland behaviour, Linux HTPC in general (nothing measured on Linux).

## Next steps

1. R01 (in progress): Linux HTPC kit, config round-trip tests, `npm run doctor`, dead-code removal, user guides in `docs/`, gamepad end-to-end harness. See `agents/rounds/R01/PLAN.md`.
2. Fix the bugs from the R01 harness report in R02.
3. User actions: enable weather in Settings (location `High Wycombe,GB`), sign in to Spotify once (new scopes), optionally widen the Vibepollo token to `GET /api/apps/*/cover`, create the Windows `Surfshark` VPN profile.
4. Test on the Linux HTPC target (Wayland/X11, evdev access, NetworkManager polkit rule, Soloist).
5. Optionally delete the `backup/remote-main-2026-10-18` tag.

## Useful commands

```
npm start                                  # real profile, fullscreen
npm run check                              # syntax checks + all tests
unset ELECTRON_RUN_AS_NODE; npx electron . --test-profile --windowed   # throwaway profile
```

User data: `%APPDATA%\home-media-launcher` (real), `%APPDATA%\Vibepollo-Test` (`--test-profile`). Never print `remote-token.json`, `spotify-tokens.json` or `.env` values.
