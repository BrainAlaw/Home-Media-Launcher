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

1. Preset matched by hostname: the composed tile art from `resolvePresetIcon(id)` (see Preset tile art), else the bundled monogram tile `src/renderer/icons/presets/<id>.svg`.
2. The site itself (website/app with `url`): `<link rel="apple-touch-icon|icon">` and `manifest.json` icons, largest first, plus `/apple-touch-icon.png` and `/favicon.ico`. Direct fetch only, no third-party favicon services.
3. SteamGridDB API v2 (kind `game`, needs `STEAMDB_API`): autocomplete search (or `steamAppId`), then grids at 600x900, heroes at 1920x620, icons, logos. `IconRequest.art` selects `poster` (default for games), `hero`, `icon` or `logo`.
4. Playnite/Vibepollo art already cached in `remote-apps.json` (matched by name).
5. Generated letter tile (SVG data URL, never written to disk).

For games, `art: 'icon'` ranks SteamGridDB icons square and at least 256 px first; when only smaller icons exist the best logo is composed onto a brand gradient (512x512 SVG, colour sampled from the logo). `art: 'logo'` composes the logo onto a 16:9 gradient tile the same way. Logos above 180 KB are used as plain images.

Results of steps 2 and 3 are cached in `<userData>/icon-cache` (14 day TTL, 400 entries, pruned at start-up). Failed lookups are not retried for 6 hours.

## Network safety

HTTPS only, at most 3 redirects (each HTTPS and re-checked), 6 s timeout, 2 MB image / 512 KB HTML cap. Private, loopback and link-local addresses are blocked (literal and DNS answers) unless the host is already in config (`remote.host`, `remote.apiUrl`, `websites[].url`). SVGs from sites are rejected when they contain scripts, `foreignObject` or external references. The SteamGridDB key never leaves the main process.

## Methods

| Method | Result |
| --- | --- |
| `resolve(IconRequest)` | `IconResult` |
| `listPresets()` | `WebPreset[]` (icon is the `file:` URL of the bundled monogram tile) |
| `resolvePresetIcon(id)` | file URL of the tile art for one preset (downloads on first use) |
| `presetIcons()` | instant `{ id: fileUrl }` map for all presets (cached art or bundled tile, no network) |
| `refreshPresetIcons()` | downloads missing art for the presets used by `config.websites`, resolves with the map |
| `searchArtwork(query, art?)` | `ArtworkCandidate[]` (empty without a key) |
| `cacheCandidate(url)` | `IconResult` for a picked candidate (steamgriddb.com HTTPS only) |
| `addPresetWebsites(websites, presetIds)` | new `websites` array, duplicates skipped |
| `firstRunWebsites()` | default preset websites for an empty config |
| `sizes()` | `IconSizes` |
| `hasSteamGridDb()` | boolean |

## Preset tile art

Presets are stored in `config.websites` with `icon: "preset:<id>"` (no install-path dependent URL). Older configs that hold an absolute `file:///.../icons/presets/<id>.svg` keep working: `asset-url.js` maps both forms to the same preset, and `migratePresetIcons(websites)` in `backend/web-presets.js` can rewrite them in the config.

`src/renderer/asset-url.js` turns a token into the bundled tile next to the page, then (on `DOMContentLoaded`) asks ns `icons` for `presetIcons` and `refreshPresetIcons` and swaps already rendered images to the downloaded tile art.

`resolvePresetIcon(id)` fetches the service's own icon (apple-touch-icon, manifest, link icons, plus the direct asset URLs listed in `ICON_SOURCES` in `web-presets.js`; ICO is skipped, minimum 128 px edge or a clean SVG, soft-404 HTML is rejected). `backend/tile-art.js` composes a 1280x720 SVG: gradient from the icon's dominant colour (preset colour when the icon is monochrome or SVG), centred continuous-corner (superellipse) icon at 40% of the height with a soft shadow, embedded as a data URL, no native image dependencies. The file is cached at `<userData>/icon-cache/presets/<id>.svg` (14 day TTL, pruned at start-up, failures retried after 6 hours). When no usable icon exists the bundled fallback is a frosted monogram on the brand gradient. Regenerate the bundled files with `node scripts/build-preset-tiles.js` (a test fails when they are stale).

### Verified sources (HTTPS GET from a Windows 11 machine, 2026-10-17)

| Preset | Icon source | Result |
| --- | --- | --- |
| Netflix | page links: apple-touch-icon is 64 px, ico is BMP only | below 128 px: monogram |
| YouTube | page `favicon_144x144.png` | real icon (144 px) |
| YouTube Music | page `favicon_144.png` | real icon (144 px) |
| Spotify | `www.spotify.com/apple-touch-icon.png`, favicons 32 px | too small: monogram |
| Disney+ | page `msftpwa-512x512` | real icon (512 px) |
| Prime Video | page `favicon-196x196.png` | real icon (196 px) |
| Max | `apple-touch-icon.png` on hbomax.com | real icon (180 px) |
| Twitch | `/apple-touch-icon.png` | real icon (180 px) |
| Plex | page `icon-ipad@2x.png` | real icon (144 px) |
| Jellyfin | jellyfin.org offers only BMP ICO | monogram |
| Apple TV+ | `/apple-touch-icon.png`, `favicon-180.png` | real icon (180 px) |
| Player | page `android-web-app-icon-512x512.png` | real icon (512 px) |
| Canal+ | HTTP 403 for bots | monogram |
| SkyShowtime | page apple-touch-icon 180 px | real icon (180 px) |
| Crunchyroll | page has no icon links (client rendered), 404 on defaults | monogram |
| Tidal | HTTP 403 for bots | monogram |

No browser User-Agent is spoofed, so sites that block the launcher keep the monogram.
