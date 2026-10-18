# Getting started

Short guide to install, configure and run Home Media Launcher. For deeper topics, follow the links below.

## Requirements

- Node.js 22 or newer
- npm

**Linux** is the main target. `scripts/bootstrap.sh` installs Node, npm and Moonlight via Flatpak.

**Windows** works too. Use `scripts/bootstrap.ps1`.

## Install and run

1. Open a terminal in the project folder.
2. Run `npm install`.
3. Run `npm start` to launch in fullscreen.
4. Optionally run `npm run check` to run syntax checks and all tests.

## Configuration

On first start the app creates a config file in the user data folder:

- Windows: `%APPDATA%\home-media-launcher\config.json`
- Linux: `~/.config/home-media-launcher/config.json`

Most options are in the in-app Settings.

## Secrets (`.env`)

Secrets live in a `.env` file in the project folder. Copy `.env.example` and fill in the keys you need. Never share this file.

| Key | Purpose |
| --- | --- |
| `VP_HOST` / `VP_IP` / `VP_API` | Vibepollo game host and its API token |
| `WEATHER_API` | OpenWeatherMap key |
| `STEAMDB_API` | SteamGridDB key for game artwork |
| `SPOTIFY_CLIENT_ID` | Spotify app id |
| `SPOTIFY_SOLOIST_API` | Spotify Soloist key (Linux only) |

## Weather

1. Open **Settings > General > Weather**.
2. Enable weather.
3. Type a location such as `London,GB`.

## Spotify

Spotify needs a Spotify Premium account and an app in the Spotify developer dashboard. Full steps: [backend/SPOTIFY.md](../backend/SPOTIFY.md).

Optional local player on Linux: [backend/SOLOIST.md](../backend/SOLOIST.md).

## VPN and remotes

- Tailscale and Surfshark: [backend/VPN.md](../backend/VPN.md)
- TV remotes and controllers: [backend/REMOTES.md](../backend/REMOTES.md)

## Controls

| Input | Action |
| --- | --- |
| D-pad or arrow keys | Move |
| A or Enter | Select |
| B or Esc | Go back |
| Menu or Start | Open quick settings |
