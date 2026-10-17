# Icons and artwork (ns `icons`)

Backend for web presets and the icon/artwork resolver. Constants live in `backend/icon-sizes.js` and are available to the renderer via `ext.invoke('icons', 'sizes')`.

## Preferred sizes

| Use | Size | Format |
| --- | --- | --- |
| Tile art (16:9) | 1280x720 | PNG / JPG / WebP |
| App icon | 512x512 | PNG or SVG |
| Game poster (2:3) | 600x900 | PNG / JPG / WebP |
| Hero | 1920x620 | PNG / JPG / WebP |
| Logo | transparent, about 1000x400 | PNG |

Site icons smaller than 64 px are only used when nothing better exists.

## Resolution order (`resolve(IconRequest)`)

1. Bundled preset matched by hostname (`src/renderer/icons/presets/*.svg`).
2. The site itself (website/app with `url`): `<link rel="apple-touch-icon|icon">` and `manifest.json` icons, largest first, plus `/apple-touch-icon.png` and `/favicon.ico`. Direct fetch only, no third-party favicon services.
3. SteamGridDB API v2 (kind `game`, needs `STEAMDB_API`): autocomplete search (or `steamAppId`), then grids at 600x900, heroes at 1920x620, icons, logos. `IconRequest.art` selects `poster` (default for games), `hero`, `icon` or `logo`.
4. Playnite/Vibepollo art already cached in `remote-apps.json` (matched by name).
5. Generated letter tile (SVG data URL, never written to disk).

Results of steps 2 and 3 are cached in `<userData>/icon-cache` (14 day TTL, 400 entries, pruned at start-up). Failed lookups are not retried for 6 hours.

## Network safety

HTTPS only, at most 3 redirects (each HTTPS and re-checked), 6 s timeout, 2 MB image / 512 KB HTML cap. Private, loopback and link-local addresses are blocked (literal and DNS answers) unless the host is already in config (`remote.host`, `remote.apiUrl`, `websites[].url`). SVGs from sites are rejected when they contain scripts, `foreignObject` or external references. The SteamGridDB key never leaves the main process.

## Methods

| Method | Result |
| --- | --- |
| `resolve(IconRequest)` | `IconResult` |
| `listPresets()` | `WebPreset[]` (icon is a `file:` URL) |
| `searchArtwork(query, art?)` | `ArtworkCandidate[]` (empty without a key) |
| `cacheCandidate(url)` | `IconResult` for a picked candidate (steamgriddb.com HTTPS only) |
| `addPresetWebsites(websites, presetIds)` | new `websites` array, duplicates skipped |
| `firstRunWebsites()` | default preset websites for an empty config |
| `sizes()` | `IconSizes` |
| `hasSteamGridDb()` | boolean |
