# Theme and contextual media API

The source of truth for the new API is `<userData>/themes.json`. The JSON Schema is [themes.schema.json](themes.schema.json); strict frontend TypeScript contracts are in [contracts.d.ts](contracts.d.ts). Validation uses that schema directly, rejects unknown properties and unsafe keys, and never coerces values. Theme IDs are unique and the selected ID must exist. The store supports up to 100 themes. `extensions` provides bounded, primitive-valued settings for future frontend options without weakening the core contract.

```json
{
  "version": 1,
  "currentThemeId": "living-room",
  "themes": [{
    "id": "living-room",
    "name": "Living Room",
    "palette": {
      "background": "#07090d",
      "surface": "#151922",
      "accent": "#8b5cf6",
      "text": "#ffffff",
      "mutedText": "#a7adbb"
    },
    "layout": { "showHeroCard": true, "showClock": true, "reduceMotion": false },
    "background": { "type": "video", "source": "/home/user/Media/ambient.mp4" },
    "sounds": { "enabled": true, "volume": 0.3, "focus": "/home/user/Media/focus.wav" },
    "extensions": { "uiPreset": "console", "dynamicArt": true }
  }]
}
```

Paths must be absolute local paths or `file:` URLs. On Windows, JSON paths use escaped backslashes, for example `C:\\Media\\ambient.mp4`. A `none` background requires an empty source. Colors use six or eight hexadecimal digits. Backgrounds support PNG, JPEG, WebP, GIF, AVIF, MP4 and WebM. Sounds support MP3, WAV and OGG. Referenced files remain in their original locations: selecting a 4K video does not copy, hash or buffer it in the main process. Custom saves reject missing or incompatible media; startup preserves valid theme configuration when removable media is missing and reports `unavailableAssets` instead of failing the launcher.

Writes use the existing serialized, fsynced temporary-file/rename storage. Concurrent requests in one launcher process do not overwrite unrelated custom theme edits. Malformed startup documents are preserved under `themes.json.corrupt-<uuid>` before the default theme is restored. A directory watcher observes atomic replacements and local edits; invalid external edits retain the last usable in-memory state and log a warning. Watchers, streams and workers close when the application exits.

## Renderer contract

The following methods are exposed on `window.launcher`:

| Method | Returns |
| --- | --- |
| `getAvailableThemes()` | `Promise<ResolvedTheme[]>` |
| `getCurrentTheme()` | `Promise<ResolvedTheme>` |
| `setTheme(themeId)` | `Promise<ResolvedTheme>`; persists selection |
| `saveCustomTheme(theme)` | `Promise<ResolvedTheme>`; creates or updates without selecting |
| `getAppBackground(appId)` | `Promise<AppBackground>`; memory lookup only |
| `getAppBackgrounds()` | `Promise<Record<string, AppBackground>>`; initial prefetch |
| `onThemeChanged(callback)` | Unsubscribe function; callback receives `ThemeState` |
| `onAppBackgroundChanged(callback)` | Unsubscribe function; callback receives `AppBackground` |

`getModel()` also includes `theme: ResolvedTheme` and `appBackgrounds`. A resolved theme contains the saved fields plus `assets.background`, `assets.sounds` and `unavailableAssets`. Use the resolved URLs in `<img>`, `<video>`, `<audio>` or CSS backgrounds. Before resaving a resolved theme, remove the output-only fields:

```javascript
const { assets, unavailableAssets, ...theme } = await window.launcher.getCurrentTheme();
await window.launcher.saveCustomTheme({ ...theme, id: 'custom-room', name: 'Custom Room' });
await window.launcher.setTheme('custom-room');
const unsubscribe = window.launcher.onThemeChanged(({ currentTheme }) => {
  // Apply currentTheme.palette and currentTheme.layout to the frontend's CSS tokens.
  // Use currentTheme.assets.background for the background media element.
});
```

The built-in theme cannot be overwritten through the custom-save API; copy it under a new ID. Changes to saved themes, selection, or valid external edits emit an authoritative `ThemeState` with a monotonically increasing process-local revision. A no-op selection does not emit duplicate state. Subscribe before the initial fetch, and retain the newest revision when combining asynchronous reads with events.

Frontend ownership: the existing `config.settings.theme` preset/accent options are preserved for compatibility. They are not silently migrated or overwritten by this backend. The frontend owner should adapt its Theme Engine to the new API, map palette/layout fields to CSS custom properties, subscribe to state changes, and stop treating legacy settings as the source of truth once that integration is enabled. Layout toggles and sound playback remain frontend responsibilities.

## Media delivery

Only explicitly registered media is accessible through opaque `vibepollo-media://asset/<random-token>` capability URLs. The protocol runs only in the launcher's default Electron session; web-app windows use separate sessions without its handler. File paths never appear in capability URLs, and URL input cannot select a filesystem path. HTML, JavaScript and SVG are excluded. Responses use fixed media MIME types and `nosniff`.

The scheme is registered as secure, standard, fetch-capable and streaming-capable using Electron's `protocol.handle`. Its narrowly scoped CSP privilege allows existing launcher pages to use registered media without disabling `webSecurity` or changing the renderer's CSP. CORS fetch access is limited to the file renderer's `null` origin. The handler supports GET, HEAD, single byte ranges, suffix ranges, 206/416 responses, ETags and request cancellation. File streams use 256 KiB chunks, with backpressure; full files are never converted to base64 or sent over IPC. [Electron protocol documentation](https://www.electronjs.org/docs/latest/api/protocol/).

## Contextual artwork and the 16 ms target

Custom and discovered tiles may expose `hero_image`, `fanart` or an image `background` path. Host API responses preserve `hero_image` and `fanart`, including in the offline metadata snapshot. The service chooses the first available field in that order. These are optional host fields; no artwork is fabricated if the host exposes none.

Cold downloads, file copies, image validation, hashing and cache-manifest writes run in a dedicated worker with two concurrent jobs and at most 1,024 queued/deduplicated sources. Remote requests have size limits and absolute deadlines. Credentials and self-signed TLS exceptions are forwarded only for HTTPS artwork at the configured API origin; credentials never enter the artwork manifest. Cached images remain available offline and are refreshed after one day. Unsupported/cold/missing sources return `loading` or `missing` immediately. Registered warm URLs are held in memory, and stale worker results cannot overwrite a newer tile source. The persistent manifest is `context-artwork.json`; content-addressed files live in `context-artwork/`. Old content files are retained, so disk usage grows with distinct images.

For the lowest focus latency, initialize a renderer Map from `getAppBackgrounds()` or `getModel().appBackgrounds`, subscribe to `onAppBackgroundChanged`, and read the Map synchronously on focus. `getAppBackground` also performs no disk or network operations, but IPC scheduling still takes time. The backend target covers warm URL lookup and IPC; it cannot guarantee network download, 4K image decoding or video startup within 16 ms. Preload/decode likely adjacent backgrounds in the renderer and keep the previous image during cold loads.

## Verification

`npm run check` includes schema, persistence, external-edit, sparse-video range, cancellation, worker cache, offline recovery and metadata regression tests. `node scripts/verify-backend.cjs` additionally runs the real Electron preload: theme save/select/events, PNG loading through the protocol under page CSP, range delivery from a 32 MiB sparse video fixture, isolation checks and a 200-request warm artwork IPC latency measurement. The sparse video fixture verifies delivery rather than codec playback. Actual 4K playback and Linux desktop performance require representative media and hardware.

## Built-in themes

`builtin-themes.js` derives 44 built-in themes (`builtin-<preset>`, `extensions.uiPreset` = renderer preset) from the palette table in `src/renderer/theme.js`. They are seeded into new stores, and missing ones are added to existing stores on startup without overwriting user edits (the legacy `builtin-dark` stays the default). Token blocks in `src/renderer/theme.css` between the GENERATED markers come from `renderThemeCss()`; after editing the table, regenerate them (a test fails when they drift). Tests enforce unique IDs, schema validity and WCAG contrast (text 7:1 on background, muted text 4.5:1 on surface, accent 3:1).

## Fonts

`src/renderer/fonts.css` declares 18 bundled OFL families (woff2 in `src/renderer/fonts/`, licences in `fonts/LICENSES.md`), so fonts work fully offline. `ThemeEngine.FONTS` lists `{ id, name, stack, category }` (plus a `system` entry). Every preset carries a `fontId` (`ThemeEngine.PALETTES`, backend `Theme.fontId`), emitted as `--font-ui` in the generated token blocks. `ThemeEngine.applyFont(element, fontId | 'theme')` overrides `--font-ui`/`--font-display` inline, or removes the override when following the theme. Custom themes may set an optional top-level `fontId`; unknown ids are rejected by `validateTheme`.
