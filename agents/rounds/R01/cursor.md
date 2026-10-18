# R01 · cursor · Tier S

- Worktree: `D:\Github Repos\hml-cursor` (branch `r01/cursor`). Work only here.
- State file: `agents/state/CURRENT_STATE_cursor.md` (copy `agents/STATE_TEMPLATE.md`, create it **before** writing, commit it).
- Owned files: `docs/GETTING_STARTED.md` (new), `docs/TROUBLESHOOTING.md` (new), `README.md` (add one line only), your state file.

## Goal

Two short user guides in English with **UK spelling** (colour, centre, licence, behaviour). Plain, friendly, numbered steps. Use only the facts below; do not invent features. Link to the detailed docs instead of copying them. Do not run the app.

## Facts for GETTING_STARTED.md

- Requirements: Node.js 22 or newer and npm. Linux is the main target (`scripts/bootstrap.sh` installs Node, npm and Moonlight via Flatpak); Windows works too (`scripts/bootstrap.ps1`).
- Install and run: `npm install`, then `npm start` (fullscreen). `npm run check` runs syntax checks and all tests.
- Configuration file: created on first start in the user data folder (`%APPDATA%\home-media-launcher\config.json` on Windows, `~/.config/home-media-launcher/config.json` on Linux). Most options are in the in-app Settings.
- Secrets go in a `.env` file in the project folder (copy `.env.example`). Keys: `VP_HOST` / `VP_IP` / `VP_API` (Vibepollo game host and its API token), `WEATHER_API` (OpenWeatherMap key), `STEAMDB_API` (SteamGridDB key for game artwork), `SPOTIFY_CLIENT_ID` (Spotify app id), `SPOTIFY_SOLOIST_API` (Spotify Soloist key, Linux only). Never share this file.
- Weather: enable it in Settings > General > Weather and type a location such as `London,GB`.
- Spotify: needs a Spotify Premium account and an app in the Spotify developer dashboard; full steps in `backend/SPOTIFY.md`. Optional local player on Linux: `backend/SOLOIST.md`.
- VPN (Tailscale, Surfshark): `backend/VPN.md`. TV remotes and controllers: `backend/REMOTES.md`.
- Controls: D-pad or arrow keys move, A or Enter selects, B or Esc goes back, Menu or Start opens quick settings.

## Facts for TROUBLESHOOTING.md (one short section each)

- **Grey or black window on Windows:** the launcher uses software compositing by default. Do not set `HML_GPU_PROCESS=inprocess`. `HML_GPU_SAFE=1` turns all GPU switches off.
- **`npm start` fails with `TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`:** the variable `ELECTRON_RUN_AS_NODE` is set in the terminal (VS Code does this); unset it and start again.
- **Home screen empty after an update:** run `npm run check`; a failing `renderer-globals` test means two renderer scripts declare the same global name.
- **Spotify says 403 or "Premium required":** the Spotify account must be Premium and listed under User management in the developer dashboard.
- **Soloist stops with "build expired":** Soloist builds expire after 90 days; download a newer build (see `backend/SOLOIST.md`).
- **Weather line says "Set your location in Settings":** no location is set.
- **Surfshark is grey on Windows:** create a Windows VPN profile named `Surfshark` (see `backend/VPN.md`).
- **Game tiles have no cover art:** add `STEAMDB_API` to `.env`.

## Tasks (commit after each, tick it in your state file)

1. Write `docs/GETTING_STARTED.md`.
2. Write `docs/TROUBLESHOOTING.md`.
3. In `README.md`, directly under the first heading line, add exactly this one line: `Dokumentacja (EN): [Getting started](docs/GETTING_STARTED.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)`. Finish with `Status: DONE`.
