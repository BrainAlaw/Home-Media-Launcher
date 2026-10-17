# Menu, prefetch and indicator contract

The backend keeps rendering and spatial navigation local to the renderer. Navigation hints never wait for configuration writes, host discovery, system queries or media reads. No synchronous Electron IPC is used. The strict API types are in [contracts.d.ts](contracts.d.ts), alongside the existing theme contract.

## Menu configuration

The optional root `menu` object in `config.json` is independent of `rows[].tiles`. It is validated against [menu.schema.json](menu.schema.json). Existing configurations without `menu` receive a default (empty) menu in the returned model. The top navigation bar (Home / Library / Settings) was removed: `layout`, `groups` and their items are still validated so old configurations load, but the renderer ignores them. Settings opens from the quick-settings sheet. Old settings clients that omit `menu` on save preserve the existing stored menu. No game tile fields or launch contracts are changed.

```json
{
  "version": 1,
  "layout": "side-dock",
  "groups": [{
    "id": "main",
    "label": "Main",
    "items": [
      { "id": "home", "label": "Home", "action": "home" },
      { "id": "racing", "label": "Racing", "action": "category", "category": "Racing" },
      { "id": "settings", "label": "Settings", "action": "settings" }
    ]
  }],
  "slideshow": {
    "enabled": true,
    "lookAhead": 4,
    "intervalMs": 10000,
    "assets": [
      { "type": "image", "source": "/home/user/Media/room.webp" },
      { "type": "video", "source": "/home/user/Media/ambient.mp4" }
    ]
  }
}
```

The snippet is the `menu` value, not a replacement for the entire launcher configuration. `layout` accepts `top-bar` or `side-dock`. Group IDs and item IDs must be unique; categories require a nonblank category name. Actions are declarative navigation targets, not shell commands. Asset sources must be supported absolute local paths or file URLs. Rendering, category filtering, animation timing and advancing the slideshow remain frontend responsibilities. Persist menu changes using `saveSettings({ ...config, menu })`, then use the returned model or configuration event.

## IPC surface

| Method | Behavior |
| --- | --- |
| `getMenuConfiguration()` | Async initial configuration read from memory |
| `getMenuIndicators()` | Async initial/current indicator snapshot from memory |
| `getCachedMenuIndicators()` | Preload-local snapshot; no cross-process request; `null` until initialized |
| `getCachedAppBackground(appId)` | Preload-local artwork lookup; no cross-process request |
| `getSlideshowState()` | Registered slide URLs, resident-byte count and residency states |
| `prefetchSlideshow(index)` | Async acknowledgement of a new position; does not wait for disk reads |
| `hintNavigation({ appId?, slideshowIndex? })` | One-way, coalesced advisory update; returns immediately |
| `onMenuConfigurationChanged(callback)` | Menu definition after a configuration reload/save |
| `onMenuIndicators(callback)` | Revisioned system/host snapshot |
| `onSlideshowState(callback)` | Latest prefetch window has settled |

Subscriptions return unsubscribe callbacks. `getModel()` includes `menu` and `menuIndicators` and primes the preload's artwork and indicator snapshots. `getAppBackgrounds()` also primes local artwork. Indicator and artwork events update preload caches even when a consumer has no subscription. Revisions prevent a delayed initial snapshot from overwriting a newer event.

Frontend startup can fetch model/indicators/slideshow state once and subscribe to changes. On each focus change, synchronously read `getCachedAppBackground(id)`, start the local animation, then call `hintNavigation({ appId: id })`. The hint warms that image along with the slideshow lookahead; cold contextual artwork is warmed once its existing artwork worker publishes a URL. On slideshow advancement call `hintNavigation({ appId: null, slideshowIndex: nextIndex })`. The next media URL is already available in the slideshow state. Do not request `getModel()` or `getMenuConfiguration()` inside an animation loop.

The preload merges same-turn hint patches into one microtask dispatch. The main process processes only the latest merged patch per event-loop batch, validates its sender and payload, and starts no network, disk or persistence operation in the hint handler. Animation state does not make an IPC round trip and is never written on every focus change. Invalid/stale advisory hints are ignored. Explicit out-of-range `prefetchSlideshow` requests reject with an error.

## Bounded RAM prefetch

A dedicated worker proactively reads the current slide plus the next 3–5 slides, wrapping at the end. The default lookahead is four. The focused contextual image is prioritized alongside that window. File reads and buffer allocation happen in the worker; immutable encoded bytes are shared with the main process using `SharedArrayBuffer`, rather than copied as large IPC payloads. The renderer receives only opaque registered media URLs and small status objects, never shared buffers or paths supplied in a navigation hint. [Node worker memory semantics](https://nodejs.org/api/worker_threads.html).

The retained cache has a 256 MiB budget. Files up to 32 MiB are cached completely. Larger videos retain the first 16 MiB and last 4 MiB for startup and container metadata; middle ranges stream asynchronously from disk on demand. Images above the per-file limit and windows exceeding the budget fall back to the existing file stream. This bounds prefetch RAM rather than attempting to load several multi-gigabyte videos. Renderer decode/GPU allocations and buffers retained by already active responses are additional to the cache budget.

The protocol serves complete warm files and warm byte ranges without opening or statting their sources. Mixed video ranges stream cached segments first, then open the source only upon reaching an uncached region. Response chunks are at most 128 KiB on the cached path and respect backpressure and cancellation. Uncached responses retain the existing asynchronous stream. Missing sources can still serve resident data; cached content is an immutable snapshot. Source changes are checked on subsequent window requests, with identical-window revalidation limited to once per five seconds. Ongoing mixed disk/RAM streams reject if the source changes, avoiding silently combining incompatible file versions.

New navigation windows replace obsolete work. Unwanted cached entries are evicted and obsolete in-flight reads stop between 256 KiB reads. When there is insufficient budget, the worker keeps earlier/current assets and marks later affected slides unavailable instead of evicting the current image or allocating unbounded memory. `SlideshowState.slides[].memory` reports `full`, `partial`, `pending`, `cold` (outside the current window), or `unavailable`. A missing file also has a null URL. Retain the current background while a new one is cold or pending.

## Independent indicators

Network interface and battery sampling runs in a separate worker approximately every ten seconds, without overlapping samples. Windows battery queries run in a hidden PowerShell child with a 2.5 second timeout and bounded output. Linux battery data comes from sysfs. Unsupported/unavailable battery fields are null. Network `linkAvailable` means a non-loopback interface has an assigned address; it is not an internet connectivity test. Moonlight state comes from the existing background host monitor, and reading indicators never triggers a host probe. Indicator events are small, revisioned snapshots.

## Performance verification and limits

Run `npm run check` and `node scripts/verify-backend.cjs`. Tests cover lookahead, wraparound, cancellation, bounded allocation, disk-free cached reads after source removal, mixed video ranges, independent system collection and a 1,000-hint burst. The Electron check verifies actual preloads, protocol delivery from RAM, isolated sessions, and reports separate p95 measurements for artwork IPC, indicator IPC and preload-local reads. [Electron IPC guidance](https://www.electronjs.org/docs/latest/tutorial/ipc).

Sub-millisecond IPC is a measured target, not a hard real-time guarantee. Process scheduling, GPU compositing, physics/DOM work and media decoding remain outside the backend's control. For 120 fps, keep the frame loop free of awaited IPC, preload/decode adjacent images in the renderer and keep at most the required video elements active. These tests prove backend behavior; they do not certify animation frame rates or real 4K playback on target hardware.

## Rendering performance pass (iteration 4, agent G)

Findings (static analysis, no display available). The quick-settings sheet and nav pill already animate on the compositor through WAAPI (`CompositorScheduler`), so JS was not the bottleneck. The cost was GPU fill: a full-screen CSS `filter: blur(46px)` on `.backdrop-layer.art`, a 34px `backdrop-filter` on the sheet, a second one on the nav pill, system button and host badge, and a full-screen `dialog::backdrop` blur. Every frame drawn while the sheet animates re-evaluates all of them. Per-tile `filter: blur(26px)` shadows and `backdrop-filter` plus permanent `will-change` on device rows added more layers.

Changes:

- Backdrop: art layers are blurred on a quarter-size element (blur radius / 4) and scaled up 4.32x, which gives the same look with 16x fewer filtered pixels. The blur never animates (only opacity crossfades).
- One blurred surface at a time: `body.menu-open` (set by `NavigationMenu.setOpen`) removes the blur from the nav pill, system button and host badge while the sheet is open. `will-change` on the sheet exists only during its animation (`data-animating`).
- Removed nested or redundant blur: settings nav (inside the blurred dialog), `dialog::backdrop` (dim raised from 70% to 80%), controller device rows. Tile shadows use a radial gradient instead of `filter: blur`.
- Clock: `updateTime` writes a text node only when the minute or day text changes (no per-second DOM writes).
- Electron (`src/main/gpu-flags.js`, applied before ready): `enable-gpu-rasterization`, `ignore-gpu-blocklist`, `disable-renderer-backgrounding`, `enable-features=CanvasOopRasterization` and on Linux `enable-zero-copy` plus `VaapiVideoDecoder,VaapiIgnoreDriverChecks`. `disable-background-timer-throttling` is intentionally not set, so a hidden launcher still idles while a game runs. Set `HML_GPU_SAFE=1` to disable all of these on a broken driver.
- Status widgets already poll sparingly (weather every 30 minutes); wallpaper images were already decoded with `decoding=async` and `Image.decode()`.

### Performance setting

`settings.performance` is `auto` (default), `quality` or `lite`, validated in `config.js` and typed in `contracts.d.ts`; the control is in Settings > Appearance.

- `quality`: full glass visuals.
- `lite`: `body.perf-lite` removes all backdrop blur, blurred backdrop filter, big shadows, tile sheen and glow, scanlines; glass surfaces become opaque.
- `auto`: `Perf.createGovernor` accumulates frame time while the user is active (input, focus or animation). If the average over 5 s of active frames is below 45 fps, lite latches for the session. Idle gaps over 250 ms are ignored and no rAF loop runs while idle.

### How to measure

Start with `HML_PERF=1 npm start` (or `npm start -- --perf`) to show the meter at the bottom-left: fps, average and worst frame time, long frames (over 33 ms) out of total, and the active mode. Open and close quick settings, scrub the rows, then compare `quality` against `lite`. For GPU detail open `chrome://gpu` equivalents via `--enable-logging`, and use DevTools > Performance with "Layers" and "Paint flashing" enabled. Logic is in `src/renderer/perf.js` with tests in `test/perf.test.js`.

## Quick-settings sheet pass (agent Q1)

Measured, not guessed: `scripts/bench-ui.cjs` boots the real launcher (main, preload, renderer) in a visible 1280x800 window with a throwaway profile and prints JSON (avg/p50/p95/p99/max frame time, effective fps, dropped-frame %, long-animation-frame and longtask counts, per-process CPU, `app.getGPUFeatureStatus()`) for idle, panel open/close, row focus movement and tile focus movement.

```
unset ELECTRON_RUN_AS_NODE; npx electron scripts/bench-ui.cjs [--lite] [--stress] [--uncapped] [--css=file.css] [--shot=panel.png]
HML_BENCH_SWITCHES="--use-angle=gl" npx electron scripts/bench-ui.cjs   # A/B any Chromium switch
```

Root cause on the reference Windows host (RTX 3080 plus Sunshine, Parsec and SudoMaker virtual displays, 165 Hz primary): with the default out-of-process GPU service ANY animated content, even one `will-change: transform` square in an empty page, presented at a hard ~27-30 fps (36.4 ms, one frame per 6 vsyncs). The CSS was not the bottleneck: removing the backdrop, `#fx`, every animation and transition left tile focus at 30 fps. Software compositing and `--in-process-gpu` both reached 165 fps; ANGLE Vulkan silently fell back to software compositing, and every D3D11/DirectComposition/vsync switch tried (`use-angle=gl|d3d11on12`, `disable-direct-composition`, `DXGIWaitableSwapChain`, `DelegatedCompositing`, `disable-gpu-sandbox`, EcoQoS, occlusion) changed nothing. `gpu-flags.js` therefore adds `in-process-gpu` on win32 (`HML_GPU_PROCESS=separate` opts out, `HML_GPU_SAFE=1` still disables everything) plus `disable-features=CalculateNativeWinOcclusion`. GPU compositing and rasterisation stay enabled (`gpu_compositing: enabled`, `rasterization: enabled_force`). The main window is opaque (`backgroundColor`, no `transparent: true`), so there is no transparent-window software fallback.

The sheet itself (menu.css, status.css, perf.css):

- No `backdrop-filter` at all on the sheet; the wallpaper behind is already blurred once by `.backdrop-layer.art`, so the glass look is a 95% opaque surface, a static top sheen and a hairline. Nothing is re-blurred per frame.
- Permanently promoted layer (`will-change: transform, opacity`; the sheet is `display: none` while closed) with `contain: layout paint style`. Only transform and opacity animate (CompositorScheduler/WAAPI); box-shadow is static.
- One sliding highlight lens (transform only) replaces per-row backgrounds. It is an accent-tinted solid (`--panel-lens-mix`, 36%) with a 2 px inset ring and white text, red-tinted for the danger row via `:has()`.
- While `body.menu-open`: the `#fx` scanline multiply layer is hidden, tile animations are paused, other blurred chrome is solid (existing rule).
- status-widgets.js defers network/VPN/weather DOM writes until `#system-panel[data-animating]` clears (latest render per key wins), so polling results never land mid-animation.

Legibility: white primary text, 90% caption text on the dark surface, 18 px titles and 14 px captions, two-line subtitles instead of ellipsis (`vpnSubtitle` shortens long host names and errors), disabled providers at 78% opacity with the reason written out. `test/menu-legibility.test.js` checks WCAG AA (4.5:1) for every theme accent and danger token against the lens and the surface (worst case: over a white wallpaper pixel).

Known limits: the machine's 27 fps cap with a separate GPU process is a platform issue worked around, not fixed; `in-process-gpu` removes GPU-process isolation (a GPU driver crash takes the launcher down, `HML_GPU_PROCESS=separate` restores it). `navigation-menu.js` hard-codes the lens base height 64 px (`offsetHeight / 64`), so two-line rows stretch the lens vertically (corner radius distorts slightly); it should read `lens.offsetHeight`.
