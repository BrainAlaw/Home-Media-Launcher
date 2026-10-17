'use strict';

const { findNext, toRect } = window.SpatialNav;
const { buildLayout, describeEmptyGaming, pushRecent, hueFor } = window.TileModel;
const { assetUrl, isLoadableImage, presetIdOf, requestGameArt, gameArtFor } = window.AssetUrl;
const ThemeEngine = window.ThemeEngine;
const gallery = window.Wallpapers.createGallery(window.WALLPAPER_ENTRIES || []);

const RECENTS_KEY = 'launcher.recents.v1';
const THEME_KEY = 'launcher.theme.v1';
const FONT_KEY = 'launcher.font.v1';
const BACKGROUND_DEBOUNCE_MS = 150;
const SCROLL_MARGIN_PX = 16;

/**
 * Renderer state.
 * view: 'home' (carousels) | 'system' (side panel) | 'settings' (modal dialog) | 'pairing' (controller wizard on top of settings)
 */
const state = {
  model: null,
  config: null,
  view: 'home',
  tilesById: new Map(),
  focusEl: null,
  locked: false,
  menuIndex: 0,
  recents: loadRecents(),
  theme: ThemeEngine.resolve({}),
  backdropKey: '',
  wallpaper: gallery.resolve({}),
  wallpaperKey: '',
  slides: [],
  slideIndex: 0,
  slideRequest: null,
  slideCache: new Map(),
  currentSlide: null,
  fontId: 'theme'
};

const homeElement = document.querySelector('#rows');
const gridElement = document.querySelector('#grid-content');
const backdropLayers = [...document.querySelectorAll('.backdrop-layer')];
const videoBackground = document.querySelector('#background-video');
const toast = document.querySelector('#toast');
/** Performance governor: mode comes from settings.performance; `?perf` shows the FPS overlay. */
let performanceMode = 'auto';
const perfRuntime = window.Perf.createRuntime({ document, getMode: () => performanceMode, showOverlay: new URLSearchParams(location.search).has('perf') });
function setPerformanceMode(mode) {
  const next = window.Perf.normalizeMode(mode);
  if (next !== performanceMode) performanceMode = next;
  perfRuntime.refresh();
}
const creditOverlay = window.WallpaperCredit.createOverlay({ root: document.querySelector('#wallpaper-credit-overlay') });
/** Credit shown with a bundled gallery wallpaper (author, licence and source from wallpapers-data.js). */
const bundledCredit = (entry) => window.WallpaperCredit.fromBundled(entry);
const systemPanel = document.querySelector('#system-panel');
const systemButton = document.querySelector('#system-button');
const settingsDialog = document.querySelector('#settings-dialog');
const headerStatus = document.querySelector('#header-status');
const autostartSwitch = document.querySelector('#autostart');
let toastTimer;
let cursorTimer;
let backgroundTimer;
let backdropToken = 0;
let slideTimer;
let slideToken = 0;
let activeLayer = 0;
let systemRequest = 0;
const mediaPreloadCache = new Map();

const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const motionScheduler = new window.MenuMotion.CompositorScheduler({ reducedMotion: reducedMotionQuery.matches });
reducedMotionQuery.addEventListener('change', (event) => motionScheduler.setReducedMotion(event.matches));

const launchTransition = window.LaunchTransition.createLaunchTransition({ isReducedMotion: () => reducedMotionQuery.matches });
let suspendToken = 0;

const launchSession = window.LaunchSession.createLaunchSession({
  api: window.api,
  legacyLaunch: (tileId) => window.launcher.launch(tileId),
  // Rendering is only suspended once the screen is fully black, so the expand/fade transition is not frozen half-way.
  onSuspend: () => {
    const token = ++suspendToken;
    void launchTransition.whenCovered().then(() => { if (token === suspendToken && launchSession.busy) suspendUi(); });
  },
  onResume: (event) => {
    suspendToken += 1;
    resumeUi(event);
    void launchTransition.reveal(event.appId);
  }
});

const spatialGrid = new window.SpatialGrid.SpatialGrid({
  viewport: homeElement,
  container: gridElement,
  createItem: () => document.createElement('button'),
  updateItem: updateTile,
  onFocus: (element) => setFocus(element, { scroll: false, rememberGrid: false }),
  onItemApproachingViewport: (tile) => {
    preloadMedia(tile.fanart || tile.background || tile.icon);
    preloadMedia(tile.logo || tile.clearLogo || tile.clear_logo);
    Promise.resolve()
      .then(() => window.launcher.getAppBackground(tile.id))
      .then((artwork) => preloadMedia(artwork?.url))
      .catch((error) => console.warn('Unable to prefetch tile artwork:', error.message));
  }
});

/* ------------------------------------------------------------------ media widget (now playing, ns `media`) */

const mediaWidget = window.MediaWidget.init({
  ext: window.launcher.ext,
  showToast,
  canControl: () => state.view === 'home' && !state.locked,
  requestFocus: (element) => { if (state.view === 'home' && !state.locked) setFocus(element); },
  onLeave: leaveMediaWidget,
  // The widget is on screen behind the quick-settings panel too, but not under the settings dialog or a launched app.
  isSurfaceVisible: () => (state.view === 'home' || state.view === 'system') && !state.locked
});

// Report view changes to the widget so the backend stops polling Spotify while no media UI can be seen.
for (const key of ['view', 'locked']) {
  let value = state[key];
  Object.defineProperty(state, key, { enumerable: true, get: () => value, set: (next) => { value = next; mediaWidget.syncActivity(); } });
}

/** Up goes to the header, Back to the quick-settings button (like tiles), anything else returns to the remembered tile (same column memory as the grid). */
function leaveMediaWidget(direction) {
  if (direction === 'system') { setFocus(systemButton, { scroll: false }); return; }
  if (direction === 'up') { setFocus(headerButtons().at(-1) || systemButton, { scroll: false }); return; }
  const coordinate = spatialGrid.coordinate;
  if (coordinate && spatialGrid.focusAt(coordinate[0], coordinate[1], { rememberColumn: false })) return;
  setFocus(homeElement.querySelector('.focusable') || systemButton);
}

const navigationMenu = new window.NavigationMenu.MenuController({ panel: systemPanel, systemButton });

/* ------------------------------------------------------------------ persistence */

function loadRecents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch { return []; }
}

/** Last saved theme, applied synchronously at boot so the first paint is already themed. */
function loadCachedTheme() {
  try { return JSON.parse(localStorage.getItem(THEME_KEY) || '{}'); } catch { return {}; }
}

function cacheTheme(theme) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(theme || {})); } catch { /* storage unavailable: first paint may flash the default preset */ }
}

function cacheFont(fontId) {
  try { localStorage.setItem(FONT_KEY, fontId || 'theme'); } catch { /* storage unavailable: first paint uses the theme font */ }
}

function saveRecents() {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recents)); } catch { /* storage unavailable: recents are best-effort */ }
}

/* ------------------------------------------------------------------ feedback & theming */

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

/** Applies a preset + overrides to <html> and refreshes the backdrop, since art/video rules depend on the theme. */
function applyTheme(theme) {
  state.theme = ThemeEngine.apply(document.documentElement, theme);
  ThemeEngine.applyFont?.(document.documentElement, state.fontId); // after apply(): the font override layers on the preset
  refreshBackdrop();
}

/** Live font preview from settings (also used to revert on cancel). */
function applyFont(fontId) {
  state.fontId = fontId || 'theme';
  ThemeEngine.applyFont?.(document.documentElement, state.fontId);
}

function refreshBackdrop() {
  showBackdrop(pickBackdrop(state.focusEl && state.tilesById.get(state.focusEl.dataset.tileId)));
}

/** Applies bundled gallery / slideshow settings. Idempotent so re-renders do not restart the slideshow. */
function applyWallpaper(settings, background = state.model?.settings?.background) {
  // Slideshow is on by default, unless the user already configured a custom background file.
  const resolved = gallery.resolve(settings, background?.source ? 'custom' : 'slideshow');
  const key = JSON.stringify(resolved);
  if (key === state.wallpaperKey) return;
  state.wallpaperKey = key;
  state.wallpaper = resolved;
  clearInterval(slideTimer);
  const token = ++slideToken;
  state.slides = [];
  state.slideIndex = 0;
  state.currentSlide = null;
  state.slideCache = new Map();
  if (resolved.mode === 'slideshow') void buildPlaylist(resolved, token);
  refreshBackdrop();
}

/** Mixes bundled entries with a count of main-process slides (user folders / online); only indexes are held here. */
async function buildPlaylist(resolved, token) {
  const plan = window.Wallpapers.slidePlan(resolved);
  const items = [];
  if (plan.bundled) gallery.entries.forEach((entry) => items.push({ kind: 'bundled', entry }));
  let request = null;
  if (plan.folders.length || plan.online) {
    request = { folders: plan.folders, online: plan.online };
    try {
      const { count } = await window.launcher.getWallpaperCount(request);
      for (let index = 0; index < count; index += 1) items.push({ kind: 'remote', index });
    } catch (error) { console.warn('Unable to list wallpapers:', error.message); }
  }
  if (token !== slideToken) return;
  // Nothing usable (empty folder, offline, feature missing): fall back to the bundled gallery.
  if (!items.length) gallery.entries.forEach((entry) => items.push({ kind: 'bundled', entry }));
  state.slideRequest = request;
  state.slides = window.Wallpapers.playbackOrder(items.length, resolved.shuffle).map((position) => items[position]);
  await showSlide(0, token);
  if (token === slideToken) startSlideshowTimer();
}

/** Resolves one slide to a loadable source. Remote slides are decoded first so broken files resolve to null (skipped). */
function loadSlide(item) {
  if (item.kind === 'bundled') return Promise.resolve({ source: gallery.urlFor(item.entry, document.baseURI), type: 'image', credit: bundledCredit(item.entry) });
  let pending = state.slideCache.get(item.index);
  if (!pending) {
    const request = state.slideRequest;
    pending = window.launcher.getWallpaperSlide(request, item.index).then(async (slide) => {
      if (!slide?.url) return null;
      if (slide.kind === 'image') {
        const probe = new Image();
        probe.decoding = 'async';
        probe.src = slide.url;
        await probe.decode();
      }
      return { source: slide.url, type: slide.kind, credit: slide.credit || null };
    }).catch(() => null);
    state.slideCache.set(item.index, pending);
    if (state.slideCache.size > 4) state.slideCache.delete(state.slideCache.keys().next().value);
  }
  return pending;
}

/** Shows slide `index`, skipping missing/undecodable files (and videos while live video is off), then warms only the next slide. */
async function showSlide(index, token) {
  const count = state.slides.length;
  for (let attempt = 0; attempt < Math.min(count, 8); attempt += 1) {
    const position = (index + attempt) % count;
    const slide = await loadSlide(state.slides[position]);
    if (token !== slideToken) return;
    if (!slide || (slide.type === 'video' && !state.theme.liveVideo)) continue;
    state.slideIndex = position;
    state.currentSlide = slide;
    refreshBackdrop();
    if (count > 1) void loadSlide(state.slides[(position + 1) % count]);
    return;
  }
  if (token !== slideToken) return;
  const fallback = gallery.entries[0];
  state.currentSlide = fallback ? { source: gallery.urlFor(fallback, document.baseURI), type: 'image', credit: bundledCredit(fallback) } : null;
  refreshBackdrop();
}

function startSlideshowTimer() {
  clearInterval(slideTimer);
  if (state.wallpaper.mode !== 'slideshow' || state.slides.length < 2) return;
  const token = slideToken;
  slideTimer = setInterval(() => { void showSlide(state.slideIndex + 1, token); }, state.wallpaper.intervalSec * 1000);
}

/** The wallpaper behind everything when a tile brings no art of its own. */
function globalBackground() {
  const { mode, id } = state.wallpaper;
  if (mode === 'slideshow' && state.currentSlide) return state.currentSlide;
  const entry = mode === 'bundled' ? gallery.get(id) : null;
  if (entry) return { source: gallery.urlFor(entry, document.baseURI), type: 'image', credit: bundledCredit(entry) };
  return mode === 'slideshow' ? null : state.model?.settings.background;
}

const scrollBehavior = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/** Dims streamed tiles while the remote game host cannot be reached. */
function updateHostState(remoteStatus = {}, remote = {}) {
  const offline = remote.enabled && ['offline', 'cached'].includes(remoteStatus.status);
  document.body.classList.toggle('host-offline', Boolean(offline));
}

/* ------------------------------------------------------------------ backdrop */

const videoType = (source) => (/\.(mp4|webm)$/i.test(source || '') ? 'video' : 'image');

/**
 * Chooses what sits behind the UI for the focused tile, in priority order:
 *  1. the tile's own background, 2. its icon/cover art (when dynamic art is on), 3. the global wallpaper.
 * Video sources are skipped when live video is disabled.
 * @returns {{ type: 'image' | 'video', source: string, art: boolean } | null}
 */
function pickBackdrop(tile) {
  const { liveVideo, dynamicArt } = state.theme;
  const global = globalBackground();
  const candidates = [];
  // Backend fanart outranks a user-configured tile background; both fall back to cover art, then the wallpaper.
  if (tile?.fanart) candidates.push({ source: tile.fanart, art: false });
  if (tile?.background) candidates.push({ source: tile.background, art: false });
  // Only game cover art (remote tiles) makes a good blurred backdrop; app logos fall through to the wallpaper.
  if (dynamicArt && (tile?.provider === 'remote' || tile?.remote) && isLoadableImage(tile?.icon)) candidates.push({ source: tile.icon, art: true });
  if (global?.source) candidates.push({ source: global.source, type: global.type, art: false, credit: global.credit || null });
  for (const candidate of candidates) {
    const type = candidate.type || videoType(candidate.source);
    if (type === 'video' && !liveVideo) continue;
    return { type, source: candidate.source, art: candidate.art, credit: candidate.credit || null };
  }
  return null;
}

function hideVideo() {
  videoBackground.style.opacity = '0';
  videoBackground.pause();
}

/** Crossfades between two image layers (decoded off-screen first to avoid flashes); video uses its own element. */
async function showBackdrop(choice) {
  const key = choice ? `${choice.type}|${choice.art}|${choice.source}` : '';
  if (key === state.backdropKey) return;
  state.backdropKey = key;
  const token = ++backdropToken;
  if (!choice) {
    backdropLayers.forEach((layer) => layer.classList.remove('on'));
    hideVideo();
    creditOverlay.show(null);
    return;
  }
  if (choice.type === 'video') {
    backdropLayers.forEach((layer) => layer.classList.remove('on'));
    if (videoBackground.dataset.source !== choice.source) {
      videoBackground.src = assetUrl(choice.source);
      videoBackground.dataset.source = choice.source;
    }
    videoBackground.style.opacity = '1';
    videoBackground.play().catch(() => showToast('Unable to play the video background'));
    creditOverlay.show(choice.credit);
    return;
  }
  const url = assetUrl(choice.source);
  const probe = new Image();
  probe.src = url;
  try { await probe.decode(); } catch { if (token === backdropToken) state.backdropKey = ''; return; }
  if (token !== backdropToken) return;
  hideVideo();
  const next = backdropLayers[1 - activeLayer];
  next.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
  next.classList.toggle('art', choice.art);
  next.classList.add('on');
  backdropLayers[activeLayer].classList.remove('on');
  activeLayer = 1 - activeLayer;
  creditOverlay.show(choice.credit);
}

/** Debounced so rapid D-pad scrubbing does not decode a new backdrop on every step. */
function scheduleBackground(tile) {
  clearTimeout(backgroundTimer);
  backgroundTimer = setTimeout(() => showBackdrop(pickBackdrop(tile)), BACKGROUND_DEBOUNCE_MS);
}

/* ------------------------------------------------------------------ rendering */

/** Tile artwork: generated gradient + initial, replaced by the icon once it loads. */
function buildArt(tile) {
  const art = document.createElement('div');
  art.className = 'art';
  art.style.setProperty('--hue', String(hueFor(tile.name)));
  const fallback = document.createElement('div');
  fallback.className = 'fallback';
  fallback.textContent = tile.name.slice(0, 1).toUpperCase();
  art.append(fallback);
  if (isLoadableImage(tile.icon)) {
    setArtImage(art, assetUrl(tile.icon), presetIdOf(tile.icon) !== null);
  } else if (tile.provider === 'remote' || tile.remote) {
    // Host apps without a downloaded cover: generated 16:9 art (SteamGridDB composition, glyph or monogram tile).
    art.dataset.artName = tile.name;
    const known = gameArtFor(tile.name);
    if (known) setArtImage(art, known, true);
    else requestGameArt(tile.name, tile.artHint === 'builtin' ? true : tile.artHint === 'game' ? false : undefined).then((url) => { if (url && !art.querySelector(':scope > img')) setArtImage(art, url, true); });
  }
  return art;
}

/**
 * Shows an image in a tile's art slot (creating or re-pointing the single <img>). `wide` marks 16:9 tile compositions
 * that fill the tile instead of the small centred app-icon box (see tile-art.css).
 */
function setArtImage(art, url, wide) {
  let image = art.querySelector(':scope > img');
  if (!image) {
    image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('load', () => {
      art.classList.add('has-image');
      // Brand colour for the focus glow; cross-origin art taints the canvas and keeps the name-derived hue.
      const accent = window.TileAccent.sampleImage(image);
      if (accent) art.parentElement?.style.setProperty('--tile-accent', window.TileAccent.accentCss(accent));
    });
    image.addEventListener('error', () => { image.remove(); art.classList.remove('has-image', 'wide'); });
    art.append(image);
  }
  art.classList.toggle('wide', wide === true);
  if (image.getAttribute('src') !== url) image.src = url;
}

// Generated art finished in the main process (SteamGridDB download): swap it into rendered host tiles live.
document.addEventListener('hml:tile-art', (event) => {
  const { name, url } = event.detail || {};
  for (const art of document.querySelectorAll('.tile .art[data-art-name]')) if (art.dataset.artName === name) setArtImage(art, url, true);
});

function tagFocusable(button, tile, rowId) {
  button.classList.add('focusable');
  button.dataset.tileId = tile.id;
  button.dataset.row = rowId;
  button.setAttribute('aria-label', tile.name);
  button.classList.toggle('remote', tile.provider === 'remote' || Boolean(tile.remote));
}

function updateTile(button, tile, rowId) {
  button.type = 'button';
  button.className = 'tile';
  button.style.removeProperty('--virtual-x');
  button.style.removeProperty('--tile-accent');
  button.style.setProperty('--hue', String(hueFor(tile.name))); // tints the focus glow (--tile-accent)
  tagFocusable(button, tile, rowId);
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = tile.name;
  button.replaceChildren(buildArt(tile), label);
}

/** Warm one nearby cover or backend-provided hero asset without retaining an unbounded image cache. */
function preloadMedia(source) {
  if (typeof source !== 'string' || !source) return;
  const url = assetUrl(source);
  if (!url) return;
  let media = mediaPreloadCache.get(url);
  if (media) {
    mediaPreloadCache.delete(url);
    mediaPreloadCache.set(url, media);
    return;
  }
  if (/\.(mp4|webm)(?:[?#]|$)/i.test(source)) {
    media = document.createElement('video');
    media.preload = 'metadata';
    media.src = url;
  } else if (isLoadableImage(source)) {
    media = new Image();
    media.decoding = 'async';
    media.src = url;
  } else return;
  mediaPreloadCache.set(url, media);
  if (mediaPreloadCache.size > 8) mediaPreloadCache.delete(mediaPreloadCache.keys().next().value);
}

/** Focusable header controls in visual order (left to right). */
function headerButtons() {
  return [...headerStatus.querySelectorAll('button.status-chip:not([hidden])'), systemButton];
}

function focusables() {
  return [...headerButtons(), ...document.querySelectorAll('#rows .focusable')];
}

/** Tile name labels are hidden by CSS; the tile button keeps its aria-label. */
function applyTileLabels(settings) {
  document.body.classList.toggle('tile-labels-off', settings?.showTileLabels === false);
}

function render(model) {
  applyTileLabels(model.settings);
  state.model = model;
  const overrides = model.settings?.iconOverrides || {};
  // Custom icon overrides take priority over any provider-supplied icon.
  const hostOffline = model.settings?.remote?.enabled && ['offline', 'cached'].includes(model.remoteStatus?.status);
  const tiles = model.rows.flatMap((row) => row.tiles).map((tile) => ({
    ...tile,
    icon: overrides[tile.id] || tile.icon || '',
    // The backend may flag a game itself; otherwise streamed titles inherit the host state.
    ...(tile.isVibepolloOffline === undefined && hostOffline && (tile.provider === 'remote' || tile.remote) ? { isVibepolloOffline: true } : {})
  }));
  state.tilesById = new Map(tiles.map((tile) => [tile.id, tile]));
  const hiddenRemote = (model.availableApps || []).filter((entry) => entry.provider === 'remote' && !entry.selected).length;
  const layout = buildLayout(tiles, state.recents, {
    categories: model.settings?.categories,
    showEmptyGaming: Boolean(model.settings?.remote?.enabled),
    gamingEmptyMessage: describeEmptyGaming(model.remoteStatus, model.settings?.remote, hiddenRemote)
  });

  const widgetWasFocused = state.focusEl === mediaWidget.element;
  mediaWidget.setEnabled(model.settings?.mediaWidget !== false);
  if (widgetWasFocused && !mediaWidget.canFocus()) { state.focusEl.classList.remove('focused'); state.focusEl = null; }

  const previous = state.focusEl && { element: state.focusEl, id: state.focusEl.dataset.tileId, row: state.focusEl.dataset.row };
  const gridRows = layout.rows.map((row) => ({ id: row.id, title: row.title, items: row.tiles, ...(row.emptyMessage ? { emptyMessage: row.emptyMessage } : {}) }));
  spatialGrid.setRows(gridRows);
  const empty = document.querySelector('#empty');
  empty.hidden = tiles.length > 0;
  empty.textContent = tiles.length ? 'No applications in this section.' : 'No tiles selected. Open Settings to add some.';

  state.fontId = model.settings?.fontId || 'theme';
  applyTheme(model.settings?.theme);
  cacheTheme(model.settings?.theme);
  cacheFont(state.fontId);
  creditOverlay.setEnabled(model.settings?.wallpaperCredit !== false);
  setPerformanceMode(model.settings?.performance);
  applyWallpaper(model.settings?.wallpaper, model.settings?.background);
  updateHostState(model.remoteStatus, model.settings?.remote);
  updateHeader();

  const restoredTile = state.view === 'home' && previous?.id
    ? spatialGrid.focusTile(previous.id, previous.row, { scroll: true, focus: false }) : null;
  const all = focusables();
  const restored = restoredTile || (previous && (previous.element.isConnected ? previous.element
    : previous.id ? (all.find((el) => el.dataset.tileId === previous.id && el.dataset.row === previous.row)
      || all.find((el) => el.dataset.tileId === previous.id))
      : (headerButtons().includes(previous.element) ? previous.element : null)));
  state.focusEl = null;
  if (state.view === 'home') setFocus(restored || all.find((el) => el.classList.contains('focusable')) || systemButton, { scroll: false });
  else state.focusEl = restored || null;
}

/* ------------------------------------------------------------------ focus & scrolling */

function setFocus(element, { scroll = true, rememberGrid = true } = {}) {
  if (!element) return;
  state.focusEl?.classList.remove('focused');
  state.focusEl = element;
  if (rememberGrid && !spatialGrid.isFocusing) spatialGrid.rememberElement(element);
  element.classList.add('focused');
  element.focus({ preventScroll: true });
  if (scroll) ensureVisible(element);
  scheduleBackground(state.tilesById.get(element.dataset.tileId));
}

/** Minimal scrolling: horizontally within the carousel, then vertically within the page. */
function ensureVisible(element) {
  const behavior = scrollBehavior();
  const track = element.closest('.track');
  if (track) {
    const padding = parseFloat(getComputedStyle(track).paddingLeft) || 0;
    const left = element.offsetLeft;
    const right = left + element.offsetWidth;
    if (left - track.scrollLeft < padding) track.scrollTo({ left: Math.max(0, left - padding), behavior });
    else if (right - track.scrollLeft > track.clientWidth - padding) track.scrollTo({ left: right - track.clientWidth + padding, behavior });
  }
  const section = element.closest('.row');
  if (!section) { homeElement.scrollTo({ top: 0, behavior }); return; }
  const top = section.offsetTop;
  const bottom = top + section.offsetHeight;
  const view = homeElement.scrollTop;
  if (top < view + SCROLL_MARGIN_PX) homeElement.scrollTo({ top: Math.max(0, top - SCROLL_MARGIN_PX), behavior });
  else if (bottom > view + homeElement.clientHeight - SCROLL_MARGIN_PX) homeElement.scrollTo({ top: bottom - homeElement.clientHeight + SCROLL_MARGIN_PX, behavior });
}

/** Moves focus to the best spatial neighbour within `elements` (document-wide or dialog-scoped). */
function moveFocusAmong(elements, current, direction) {
  const rects = elements.map((element, index) => toRect(index, element));
  const currentIndex = elements.indexOf(current);
  if (currentIndex === -1) return elements[0] || null;
  const next = findNext(rects[currentIndex], rects, direction);
  return next === null ? null : elements[next];
}

function moveHome(direction) {
  const header = headerButtons();
  const headerIndex = header.indexOf(state.focusEl);
  if (headerIndex !== -1) {
    if (direction === 'left' || direction === 'right') {
      setFocus(header[Math.max(0, Math.min(headerIndex + (direction === 'left' ? -1 : 1), header.length - 1))], { scroll: false });
    } else if (direction === 'down') setFocus(mediaWidget.canFocus() ? mediaWidget.element : homeElement.querySelector('.focusable') || state.focusEl);
    return;
  }
  if (state.focusEl?.dataset.tileId && spatialGrid.move(direction)) return;
  // Above the top tile row: the media widget (when it has something to focus), then the header controls.
  if (direction === 'up') {
    if (mediaWidget.canFocus()) setFocus(mediaWidget.element);
    else setFocus(header.at(-1) || state.focusEl, { scroll: false });
    return;
  }
  const target = moveFocusAmong([...homeElement.querySelectorAll('.focusable')], state.focusEl, direction);
  if (target) setFocus(target);
}

/* ------------------------------------------------------------------ launching */

async function activate(element) {
  if (!element) return;
  if (!element.dataset.tileId) { element.click(); return; }
  if (state.locked) return;
  const tile = state.tilesById.get(element.dataset.tileId);
  if (!tile) return;
  state.locked = true;
  element.classList.add('launching');
  void launchTransition.cover(element);
  try {
    if (!(await launchSession.launch(tile))) { state.locked = false; void launchTransition.reveal(tile.id); return; }
    state.recents = pushRecent(state.recents, tile.id);
    saveRecents();
  } catch (error) {
    state.locked = false;
    element.classList.remove('launching');
    // Animate back to the launcher and tell the user why nothing started.
    void launchTransition.reveal(tile.id);
    showToast(`Launch failed: ${window.LaunchSession.describeLaunchError(error)}`);
  }
}

/** Stops every timer, video and animation the launcher owns while an external app has the screen. */
function suspendUi() {
  state.locked = true;
  clearTimeout(backgroundTimer);
  clearInterval(slideTimer);
  hideVideo();
  document.body.classList.add('app-running');
}

/** Restores rendering, timers and focus once the launched app has exited. */
function resumeUi({ error }) {
  state.locked = false;
  document.body.classList.remove('app-running');
  document.querySelectorAll('.launching').forEach((element) => element.classList.remove('launching'));
  if (error) showToast(`Process failed: ${error}`);
  state.backdropKey = '';
  startSlideshowTimer();
  // Re-render so recents ordering reflects the session that just ended; render() restores the focused tile.
  if (state.model) render(state.model);
  else refreshBackdrop();
}

/* ------------------------------------------------------------------ header */

const homeHeader = window.HomeHeader.create();

async function updateHeader() {
  const header = state.model?.settings.header || {};
  document.querySelector('#title').textContent = header.showText ? (header.text || 'Home') : '';
  document.querySelector('#date').hidden = header.showDate === false;
  document.querySelector('#clock').hidden = header.showTime === false;
  homeHeader.configure(state.model?.settings.homeHeader);
  await window.StatusWidgets.updateWeather(window.HomeHeader.headerWithDefaults(header));
}

/* ------------------------------------------------------------------ system panel & settings */

function menuItems() { return [...systemPanel.querySelectorAll('button, input')]; }

function focusMenu(index) {
  const items = menuItems();
  state.menuIndex = Math.max(0, Math.min(index, items.length - 1));
  const item = items[state.menuIndex];
  item?.focus({ preventScroll: true });
  item?.scrollIntoView({ block: 'nearest' });
}

async function toggleSystemPanel(force) {
  const open = force ?? state.view !== 'system';
  const request = ++systemRequest;
  navigationMenu.setOpen(open);
  systemButton.setAttribute('aria-expanded', String(open));
  state.view = open ? 'system' : 'home';
  if (open) {
    focusMenu(0);
    try {
      const enabled = await window.launcher.getAutostart();
      if (request === systemRequest && state.view === 'system') window.MenuSwitch.setSwitch(autostartSwitch, enabled);
    } catch (error) { if (request === systemRequest && state.view === 'system') showToast(`Unable to read startup setting: ${error.message}`); }
  } else setFocus(state.focusEl || systemButton, { scroll: false });
}

function openSettings() {
  state.view = 'settings';
  systemRequest++;
  navigationMenu.setOpen(false);
  systemButton.setAttribute('aria-expanded', 'false');
  window.SettingsDialog.open();
  settingsControls()[0]?.focus();
}

/** Idempotent: invoked by buttons, the dialog 'close' event and the cancel event. */
function closeSettings() {
  if (state.view !== 'settings') return;
  window.SettingsDialog.close();
  state.view = 'home';
  state.fontId = state.model?.settings.fontId || 'theme';
  applyTheme(state.model?.settings.theme); // discard any unsaved live preview
  applyWallpaper(state.model?.settings.wallpaper);
  setFocus(state.focusEl || systemButton, { scroll: false });
}

function settingsControls() {
  const popup = window.SettingsDialog.popupControls();
  if (popup) return popup;
  return [...settingsDialog.querySelectorAll('button, input, select, textarea')]
    .filter((control) => !control.disabled && control.type !== 'hidden' && control.getClientRects().length > 0);
}

window.SettingsDialog.init({
  getConfig: () => state.config,
  setConfig: (config) => { state.config = config; },
  getModel: () => state.model,
  getTiles: () => [...state.tilesById.values()],
  onModel: render,
  previewTheme: applyTheme,
  previewWallpaper: applyWallpaper,
  previewFont: applyFont,
  gallery,
  showToast,
  onClose: closeSettings
});

// The pairing wizard is a second modal on top of settings; it claims input routing while open.
window.ControllersPage.init({ setView: (view) => { state.view = view; } });

/* ------------------------------------------------------------------ input routing */

/**
 * Single entry point for every input device. Actions: up/down/left/right/confirm/back/menu.
 * @param {'up'|'down'|'left'|'right'|'confirm'|'back'|'menu'} action
 */
function handleAction(action) {
  homeHeader.wake();
  if (state.locked) return;
  // Overlays with their own input: the on-screen keyboard (above everything) and the music view.
  if (window.OnScreenKeyboard.handleAction(action) || window.MediaView.handleAction(action)) return;
  const isDirection = ['up', 'down', 'left', 'right'].includes(action);
  if (state.view === 'home') {
    // The widget is one focus stop; it consumes everything except `menu` (quick settings) while focused.
    if (action !== 'menu' && mediaWidget.owns(state.focusEl)) { mediaWidget.handleAction(action); return; }
    if (isDirection) moveHome(action);
    else if (action === 'confirm') activate(state.focusEl);
    else if (action === 'back' && !headerButtons().includes(state.focusEl)) setFocus(systemButton, { scroll: false });
    else toggleSystemPanel(true);
  } else if (state.view === 'system') {
    if (action === 'up' || action === 'down') focusMenu(state.menuIndex + (action === 'up' ? -1 : 1));
    else if (action === 'confirm') menuItems()[state.menuIndex]?.click();
    else if (action === 'back' || action === 'menu') toggleSystemPanel(false);
  } else if (state.view === 'pairing') {
    window.ControllersPage.handleAction(action);
  } else if (state.view === 'settings') {
    const controls = settingsControls();
    if (isDirection) moveFocusAmong(controls, document.activeElement, action)?.focus();
    else if (action === 'confirm') document.activeElement?.click();
    else if (action === 'back' && !window.SettingsDialog.dismissPopup()) closeSettings();
  }
}

/** Music view (opened by the home media widget): owns input while `state.view === 'media'`; focus returns to the opener. */
document.addEventListener('launcher:open-media-view', () => {
  if (state.view !== 'home' || state.locked) return;
  const opener = state.focusEl;
  state.view = 'media';
  window.MediaView.open({
    onClose: () => {
      state.view = 'home';
      if (opener?.isConnected) setFocus(opener, { scroll: false });
      else setFocus(state.focusEl || systemButton, { scroll: false });
    }
  }).catch((error) => { state.view = 'home'; showToast(`Music unavailable: ${error.message}`); });
});

const KEY_ACTIONS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'confirm', ' ': 'confirm', Escape: 'back', Backspace: 'back', ContextMenu: 'menu'
};

document.addEventListener('keydown', (event) => {
  // Native form editing and dialog handling own the keyboard while settings are open.
  if (state.view === 'settings') return;
  if (event.key === 'Tab' && state.view === 'system') {
    event.preventDefault();
    const items = menuItems();
    focusMenu((items.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1) + items.length) % items.length);
    return;
  }
  const action = KEY_ACTIONS[event.key];
  if (!action) return;
  event.preventDefault();
  handleAction(action);
});

new window.GamepadInput.GamepadInput({ onAction: handleAction }).start();

/* ------------------------------------------------------------------ pointer (secondary) */

homeElement.addEventListener('click', (event) => {
  const element = event.target.closest('.focusable');
  if (element) { setFocus(element); activate(element); }
});

// Only real pointer movement moves focus: scrolling content under a parked cursor must not steal it.
document.addEventListener('pointermove', (event) => {
  if (state.view !== 'home' || event.pointerType !== 'mouse' || !(event.movementX || event.movementY)) return;
  const element = event.target.closest?.('.focusable');
  if (element && element !== state.focusEl) setFocus(element);
}, { passive: true });

function resetCursorTimer() {
  document.body.classList.remove('cursor-hidden');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), state.model?.settings.cursorHideDelayMs || 2200);
}
window.addEventListener('mousemove', resetCursorTimer, { passive: true });

systemButton.addEventListener('click', () => toggleSystemPanel());
systemButton.addEventListener('focus', () => { if (state.view === 'home') setFocus(systemButton, { scroll: false }); });
homeElement.addEventListener('focusin', (event) => {
  if (state.view === 'home' && event.target.matches('.focusable') && event.target !== state.focusEl) setFocus(event.target, { scroll: false });
});
systemPanel.addEventListener('focusin', (event) => { const index = menuItems().indexOf(event.target); if (index >= 0) state.menuIndex = index; });
document.querySelector('#settings-button').addEventListener('click', openSettings);
window.StatusWidgets.init({ showToast });
// Header status chips (host, Tailscale, Surfshark) open quick settings with focus on their own row.
headerStatus.addEventListener('click', async (event) => {
  const chip = event.target.closest('button.status-chip');
  if (!chip || state.view !== 'home') return;
  await toggleSystemPanel(true);
  const index = menuItems().indexOf(window.StatusWidgets.controlFor(chip.dataset.target));
  if (index >= 0) focusMenu(index);
});
document.querySelector('#quit-button').addEventListener('click', () => window.launcher.systemAction('quit'));
document.querySelector('#poweroff-button').addEventListener('click', () => {
  if (confirm('Shut down this PC? All open applications will be closed.')) window.launcher.systemAction('poweroff');
});
autostartSwitch.addEventListener('click', async () => {
  const wanted = !window.MenuSwitch.isOn(autostartSwitch);
  window.MenuSwitch.setSwitch(autostartSwitch, wanted, { busy: true });
  try { window.MenuSwitch.setSwitch(autostartSwitch, await window.launcher.setAutostart(wanted)); }
  catch (error) { window.MenuSwitch.setSwitch(autostartSwitch, !wanted); showToast(`Unable to change startup setting: ${error.message}`); }
});

// Session phase (ns `session`) keeps the black cover consistent when a session was started or ended outside this renderer.
window.launcher.ext?.on('session', 'phase', (phase) => launchTransition.onPhase(phase));
window.launcher.ext?.on('session', 'notice', (notice) => { if (notice?.message) showToast(notice.message); });

// Both the new `onAppClosed` event and the legacy `process-finished` event end the session; the transition is idempotent.
window.launcher.onProcessFinished((result) => launchSession.notifyClosed({ appId: result.tileId || '', ...(result.error ? { error: String(result.error) } : {}) }));

/* ------------------------------------------------------------------ boot */

ThemeEngine.apply(document.documentElement, loadCachedTheme());
try { applyFont(localStorage.getItem(FONT_KEY) || 'theme'); } catch { /* storage unavailable */ }

Promise.all([window.launcher.getModel(), window.launcher.getSettings()]).then(([model, config]) => {
  state.config = config;
  render(model);
  // Let the first wallpaper start fading in, then stagger the header and rows over it.
  setTimeout(() => homeHeader.reveal(), 400);
}).catch((error) => showToast(`Configuration error: ${error.message}`));
homeHeader.configure(undefined);
resetCursorTimer();
window.addEventListener('pagehide', () => { homeHeader.dispose(); navigationMenu.dispose(); launchSession.dispose(); }, { once: true });
