'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, protocol, screen } = require('electron');
const { loadConfig, saveConfig, validateConfig } = require('./config');
const { createAdminServer } = require('./admin/server');
const activity = require('./activity');
const { migrateConfigPresetIcons } = require('./preset-migration');
const { scanDesktopEntries } = require('./desktop-entry');
const { ProcessManager } = require('./process-manager');
const { TvBrowserSession } = require('./tv-browser');
const { getAutostart, setAutostart } = require('./autostart');
const { listRemoteApps } = require('./remote-apps');
const { scanWindowsApplications } = require('./windows-apps');
const { buildAppCatalog, computeHiddenAppIds } = require('./app-catalog');
const { launchIdFrom } = require('./launch-request');
const { BackgroundApps, backgroundLimit, DEFAULT_MAX } = require('./background-apps');
const { loadRemoteKeymap } = require('./remote-keymap');
const { hasToken, loadCredential, saveToken, saveCredential } = require('./secret-store');
const { LibraryService } = require('../../backend/library-service');
const { LocalState } = require('../../backend/local-state');
const { HostMonitor } = require('../../backend/host-monitor');
const { MediaAssets } = require('../../backend/media-assets');
const { ThemeService } = require('../../backend/theme-service');
const { ContextArtwork } = require('../../backend/context-artwork');
const { SlideshowCache } = require('../../backend/slideshow-cache');
const { MenuIndicators } = require('../../backend/menu-indicators');
const { NavigationHints } = require('../../backend/navigation-hints');
const { resolveMenu } = require('../../backend/menu-config');
const { ControllerPairing } = require('./controller-pairing');
const { WallpaperPlaylist } = require('../../backend/wallpaper-playlist');
const { WallpaperSourceService } = require('../../backend/wallpaper-source-service');
const { loadEnv, readSecrets, scrubSecrets } = require('../../backend/env');
const { parseLocationQuery, pickPlace } = require('../../backend/weather');
const { registerExtensions } = require('./ext-registry');
const remoteExt = require('./ext/remote');
const sessionExt = require('./ext/session');
const { createLogRing } = require('./admin/log');
const { buildStatus } = require('./admin/status');
const { readNetwork } = require('../../backend/network-status');
const { ensureManager: ensureSoloistManager } = require('./ext/soloist');
const vpnExt = require('./ext/vpn');
const mediaExt = require('./ext/media');

loadEnv();

/** Optional module: streamed wallpapers are an opt-in feature and the launcher must start without it. */
function loadOnlineWallpapers() {
  try { return require('../../backend/online-wallpapers').OnlineWallpapers; }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') console.warn('Online wallpapers unavailable:', error.message); return null; }
}

// Only opaque URLs for registered raster images, audio and video may bypass page CSP.
// Remote web apps use isolated sessions where this protocol is not registered.
protocol.registerSchemesAsPrivileged([{ scheme: 'vibepollo-media', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true
} }]);

const windowed = process.argv.includes('--windowed');
const testProfile = process.argv.includes('--test-profile');
if (testProfile) app.setPath('userData', path.join(app.getPath('appData'), 'Vibepollo-Test'));

let window;
let webWindow;
let tvBrowser = null;
// Apps that are alive but not on screen: id -> adapter ({ hide, show, close, win }). The registry keeps the order and limit.
const backgroundEntries = new Map();
const backgroundApps = new BackgroundApps({ max: DEFAULT_MAX });
// The app currently on screen (null when the launcher is showing): { id, adapter }.
let currentApp = null;
let config;
let model;
let configPath;
let tokenPath;
let localState;
let building;
let hostMonitor;
let themeService;
let contextArtwork;
let slideshow;
let menuDefinition;
let navigationHints;
let wallpaperPlaylist;
let wallpaperSources;
let onlineWallpapers = null;
let focusedAppId = null;
let hostPausedBySession = false;
const menuIndicators = new MenuIndicators();
const mediaAssets = new MediaAssets();
const processManager = new ProcessManager();
const library = new LibraryService();

function sendToWindow(channel, value) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
const controllerPairing = new ControllerPairing({
  platform: process.platform,
  openSettings: (url) => shell.openExternal(url),
  refocus: () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } },
  emitEvent: (name, value) => {
    if (window && !window.isDestroyed()) window.webContents.send(`launcher:controller-${name}`, value);
  },
  emit: (update) => {
    if (window && !window.isDestroyed()) window.webContents.send('launcher:controller-pairing-update', update);
  }
});

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// GPU raster/zero-copy/VAAPI, set before ready. HML_GPU_SAFE=1 opts out. Timer throttling is deliberately left on so a hidden launcher idles.
require('./gpu-flags').applyGpuSwitches(app);

// Recent console output for the admin panel's Log page and diagnostics. Wrapped once at start-up; records are redacted on write.
const logRing = createLogRing();
logRing.wrap(console);

// Admin panel (LAN, settings.admin). Started or restarted whenever its settings change; never listens when disabled.
let adminServer = null;
let adminKey = '';

function adminSettings() {
  const admin = config?.settings?.admin;
  return admin && typeof admin === 'object' ? admin : {};
}

function adminUrl() {
  const status = adminServer?.status();
  return status?.running ? `http://${status.bindAddress}:${status.port}` : '';
}

/** Probe sources for /api/status. Each one is optional; buildStatus reports a missing source as unknown. */
function statusSources() {
  return {
    secretValues: [secrets.vibepolloApiKey, secrets.weatherApiKey, secrets.steamGridDbKey, secrets.soloistApiKey].filter(Boolean),
    timeouts: { network: 4000 },
    version: () => ({ state: 'ok', detail: app.getVersion() }),
    uptime: () => ({ state: 'ok', detail: `${Math.round(process.uptime())} s` }),
    admin: () => {
      const running = adminServer?.status().running === true;
      return { state: running ? 'ok' : 'unknown', detail: running ? adminUrl() : 'Admin panel is off' };
    },
    host: () => {
      const host = model?.remoteStatus;
      if (!host) return { state: 'unknown', detail: 'Not checked yet' };
      if (host.isVibepolloOffline) return { state: 'error', detail: host.message || `${host.host} offline` };
      return { state: 'ok', detail: host.host || 'Online' };
    },
    soloist: () => {
      const status = ensureSoloistManager({ userData: app.getPath('userData') }).status();
      const state = status.state === 'error' ? 'error' : status.state === 'connected' ? 'ok' : 'unknown';
      return { state, detail: { state: status.state, deviceName: status.deviceName || '', connected: status.connected === true, message: status.message || '' } };
    },
    vpn: async () => {
      const entries = await vpnExt.statusSummary();
      const connected = entries.filter((entry) => entry.connected).map((entry) => entry.label);
      return { state: connected.length ? 'ok' : 'unknown', detail: connected.length ? `Connected: ${connected.join(', ')}` : 'Not connected' };
    },
    spotify: async () => {
      const status = await mediaExt.statusSummary();
      return status ? { state: 'ok', detail: status } : { state: 'unknown', detail: 'Not running' };
    },
    network: async () => ({ state: 'ok', detail: await readNetwork() }),
    weather: async () => {
      const { readFile } = require('node:fs/promises');
      const cache = await readFile(path.join(app.getPath('userData'), 'weather-cache.json'), 'utf8')
        .then((text) => JSON.parse(text)).catch(() => ({}));
      const count = Object.keys(cache && typeof cache === 'object' ? cache : {}).length;
      return { state: count ? 'ok' : 'unknown', detail: count ? `${count} cached location(s)` : 'No cached weather yet' };
    }
  };
}

function adminSecretNames() {
  return {
    VP_API: secrets.vibepolloApiKey,
    WEATHER_API: secrets.weatherApiKey,
    STEAMDB_API: secrets.steamGridDbKey,
    SPOTIFY_CLIENT_ID: secrets.spotifyClientId,
    SPOTIFY_SOLOIST_API: secrets.soloistApiKey
  };
}

/**
 * Handlers for the admin panel actions (backend/actions.js). Each returns a short result text for the panel.
 * Destructive actions are called only after the server consumed a confirmation token.
 */
const adminActions = {
  'reload-config': async () => {
    await buildModel();
    return 'Configuration reloaded.';
  },
  'restart-soloist': async () => {
    await ensureSoloistManager({ userData: app.getPath('userData') }).restart();
    return 'Soloist restarted.';
  },
  'clear-cache': async () => {
    const fsp = require('node:fs/promises');
    const userData = app.getPath('userData');
    // Icon and weather caches only. The config, .env and token files are never touched here.
    await fsp.rm(path.join(userData, 'icon-cache'), { recursive: true, force: true });
    await fsp.rm(path.join(userData, 'weather-cache.json'), { force: true });
    return 'Icon and weather caches cleared. The next start refills them.';
  },
  'pair-tv': async () => {
    if (!adminServer?.status().running) throw new Error('The admin panel is not running.');
    await adminServer.pair();
    return 'Pairing code shown on the TV.';
  },
  'restart-launcher': async () => {
    // Give the response time to leave before the process exits.
    setTimeout(() => { app.relaunch(); app.exit(0); }, 500);
    return 'Restarting the launcher.';
  }
};

async function applyAdminServer() {
  const admin = adminSettings();
  const key = JSON.stringify([admin.enabled === true, admin.port ?? null, admin.bindAddress ?? null]);
  if (key === adminKey) return;
  adminKey = key;
  if (adminServer) { await adminServer.stop(); adminServer = null; }
  if (admin.enabled !== true) return;
  adminServer = createAdminServer({
    getConfig: () => config,
    saveConfig: async (next) => { validateConfig(next); await saveConfig(configPath, next); config = next; await buildModel(); return config; },
    validate: validateConfig,
    onPairCode: (info) => sendToWindow('launcher:admin-pair-code', { ...info, url: adminUrl() }),
    onPaired: () => sendToWindow('launcher:admin-paired', {}),
    log: (entry) => console.warn('Admin panel:', entry?.event || 'event', entry?.code || ''),
    getStatus: () => buildStatus(statusSources()),
    getLogTail: (count) => logRing.tail(count),
    getSecretNames: adminSecretNames,
    actions: adminActions
  });
  try {
    await adminServer.start();
  } catch (error) {
    console.warn('Admin panel did not start:', error.code || error.message);
  }
}

async function buildModel() {
  if (building) return building;
  building = assembleModel().finally(() => { building = null; });
  return building;
}

/** One-time: adds the bundled streaming presets (Netflix, YouTube, ...) without touching existing websites. */
async function seedPresetWebsitesOnce() {
  const marker = path.join(path.dirname(configPath), 'presets-seeded');
  const fsp = require('node:fs/promises');
  try { await fsp.access(marker); return; } catch { /* not seeded yet */ }
  const { addPresetWebsites, FIRST_RUN_PRESET_IDS } = require('../../backend/web-presets');
  const existing = new Set((config.websites || []).map((site) => { try { return new URL(site.url).hostname.replace(/^www\./, ''); } catch { return ''; } }));
  const wanted = FIRST_RUN_PRESET_IDS.filter((id) => !existing.has(new URL(require('../../backend/web-presets').getPreset(id).url).hostname.replace(/^www\./, '')));
  if (wanted.length) {
    config = { ...config, websites: addPresetWebsites(config.websites || [], wanted) };
    await saveConfig(configPath, config);
  }
  await fsp.writeFile(marker, new Date().toISOString());
}

async function assembleModel() {
  config = await loadConfig(configPath, path.join(app.getAppPath(), 'config.example.json'));
  await seedPresetWebsitesOnce();
  config = await migrateConfigPresetIcons(config, (next) => saveConfig(configPath, next));
  menuDefinition = resolveMenu(config.menu);
  for (const evictedId of backgroundApps.setMax(backgroundLimit(config.settings))) closeBackground(evictedId);
  wallpaperSources?.apply(config.settings);
  await slideshow.configure(menuDefinition.slideshow);
  const customTiles = config.rows.flatMap((row) => row.tiles.map((tile, index) => ({ ...tile, id: tile.id || `custom:${row.id || 'row'}:${index}` })));
  const discoveredTiles = [];
  if (config.settings?.scanDesktopEntries) {
    if (process.platform === 'win32') {
      const windowsTiles = await scanWindowsApplications((shortcutPath) => shell.readShortcutLink(shortcutPath));
      discoveredTiles.push(...windowsTiles.map((tile) => ({ ...tile, provider: 'local' })));
    } else discoveredTiles.push(...(await scanDesktopEntries({ includeHidden: config.settings.showHiddenDesktopEntries })).map((tile) => ({ ...tile, provider: 'local' })));
  }
  const remoteCredential = remoteExt.defaultCredential(await loadCredential(tokenPath, safeStorage), secrets);
  contextArtwork.setRemoteAccess(remoteExt.withHostDefaults(config.settings?.remote, secrets), remoteCredential);
  const remoteResult = await library.sync((onProgress) => listRemoteApps(remoteExt.withHostDefaults(config.settings?.remote, secrets), path.join(app.getPath('userData'), 'remote-apps.json'), {
    platform: process.platform,
    token: remoteCredential,
    cacheOnly: !window,
    onProgress
  }));
  discoveredTiles.push(...remoteResult.tiles.map((tile) => ({ ...tile, provider: 'remote' })));
  const catalog = buildAppCatalog(customTiles, discoveredTiles, config.settings?.selectedAppIds, config.settings?.hiddenAppIds);
  const selectedTiles = catalog.visibleTiles.filter((tile) => tile.provider);
  if (process.platform === 'win32') {
    await Promise.all(selectedTiles.filter((tile) => tile.provider === 'local').map(async (tile) => {
      try { tile.icon = (await app.getFileIcon(tile.command, { size: 'large' })).toDataURL(); }
      catch { tile.icon = ''; }
    }));
  }
  const websites = (config.websites || []).map((website, index) => ({
    ...website,
    id: website.id || `website:${index}`,
    type: 'website'
  }));
  const icons = await localState.icons();
  for (const tile of [...catalog.visibleTiles, ...catalog.availableApps, ...websites]) {
    if (Object.hasOwn(icons, tile.id)) tile.icon = icons[tile.id];
  }
  await contextArtwork.updateTiles([...customTiles, ...discoveredTiles, ...websites]);
  model = {
    settings: config.settings || {},
    remoteStatus: remoteStatus(remoteResult),
    availableApps: catalog.availableApps,
    theme: themeService.getCurrentTheme(),
    appBackgrounds: contextArtwork.snapshot(),
    menu: menuDefinition,
    menuIndicators: menuIndicators.get(),
    rows: [{ id: 'applications', title: 'Applications', tiles: [...catalog.visibleTiles, ...websites] }]
  };
  menuIndicators.updateMoonlight(model.remoteStatus);
  if (window && !window.isDestroyed()) window.webContents.send('launcher:menu-configuration', menuDefinition);
  await applyAdminServer();
  return model;
}

function remoteStatus(result) {
  const status = {
    status: result.status, host: result.host || '', error: result.error || '', warning: result.warning || '',
    message: ['offline', 'cached'].includes(result.status) ? `${result.host} offline` : '', updatedAt: result.updatedAt || '',
    isVibepolloOffline: ['offline', 'cached'].includes(result.status)
  };
  // Deferred so ctx.config() sees the model that is being assembled around this status.
  setImmediate(() => remoteExt.publish(status));
  return status;
}

async function refreshHost() {
  if (building) await building;
  const snapshot = config;
  const remoteCredential = remoteExt.defaultCredential(await loadCredential(tokenPath, safeStorage), secrets);
  contextArtwork.setRemoteAccess(remoteExt.withHostDefaults(snapshot.settings?.remote, secrets), remoteCredential);
  const result = await library.sync((onProgress) => listRemoteApps(remoteExt.withHostDefaults(snapshot.settings?.remote, secrets), path.join(app.getPath('userData'), 'remote-apps.json'), {
    token: remoteCredential,
    onProgress
  }));
  if (config !== snapshot) return null;
  const icons = await localState.icons();
  if (config !== snapshot) return null;
  await contextArtwork.updateTiles([...model.rows.flatMap((row) => row.tiles).filter((tile) => tile.provider !== 'remote'), ...result.tiles]);
  if (config !== snapshot) return null;
  const previous = model.availableApps.filter((tile) => tile.provider !== 'remote');
  const tiles = result.tiles.map((tile) => ({ ...tile, provider: 'remote', ...(Object.hasOwn(icons, tile.id) ? { icon: icons[tile.id] } : {}) }));
  const catalog = buildAppCatalog([], [...previous, ...tiles], config.settings?.selectedAppIds, config.settings?.hiddenAppIds);
  model.availableApps = catalog.availableApps;
  model.rows[0].tiles = [...model.rows[0].tiles.filter((tile) => tile.provider !== 'remote'), ...catalog.visibleTiles.filter((tile) => tile.provider === 'remote')];
  model.remoteStatus = remoteStatus(result);
  menuIndicators.updateMoonlight(model.remoteStatus);
  model.appBackgrounds = contextArtwork.snapshot();
  if (window && !window.isDestroyed()) {
    window.webContents.send('launcher:remote-status', model.remoteStatus);
    window.webContents.send('launcher:model-updated', model);
  }
  return model.remoteStatus;
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender');
    return callback(event, ...args);
  });
}

/** Longest wait before a website window is shown even if the page has not finished loading. */
const WEBSITE_REVEAL_FALLBACK_MS = 12000;

/** Long-press length for Back (from the shared remote keymap, so the page and the main process agree). */
let backDownAt = 0;
function longBackMs() {
  try { return loadRemoteKeymap().longPressMs; } catch { return 700; }
}

/** Adapter for an Electron website window: what the background registry needs. */
function webAdapter(win) {
  return {
    win,
    hide: () => { if (!win.isDestroyed()) win.hide(); },
    show: () => { if (!win.isDestroyed()) { win.show(); win.focus(); } },
    close: () => { if (!win.isDestroyed()) win.close(); }
  };
}

/** Adapter for a Home Theatre browser session (external browser, controlled through DevTools). */
function tvAdapter(session) {
  return {
    session,
    win: null,
    hide: () => { session.hide().catch(() => {}); },
    show: () => { session.show().catch(() => {}); },
    close: () => { void session.terminate(); }
  };
}

/** Home from an app on screen: the app keeps running in the background and the launcher comes back. */
function sendAppHome(id) {
  sessionExt.controller.closing();
  backgroundCurrent();
  showLauncher();
  if (window && !window.isDestroyed()) window.webContents.send('launcher:app-closed', { tileId: id, website: true, background: true });
  sessionExt.controller.finish();
}

/** Moves the app on screen to the background (hidden, still running). Evicted apps are closed. */
function backgroundCurrent() {
  if (!currentApp) return;
  const { id, adapter } = currentApp;
  currentApp = null;
  webWindow = null;
  if (adapter.session && tvBrowser === adapter.session) tvBrowser = null;
  adapter.hide();
  backgroundEntries.set(id, adapter);
  for (const evictedId of backgroundApps.put(id)) closeBackground(evictedId);
}

/** Closes a background app and forgets it. */
function closeBackground(id) {
  const adapter = backgroundEntries.get(id);
  backgroundEntries.delete(id);
  backgroundApps.take(id);
  adapter?.close();
}

function openWebsite(tile) {
  let parsed;
  let loadError = '';
  try { parsed = new URL(tile.url); } catch { throw new Error('Invalid website URL'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Website URL must use HTTP or HTTPS');
  const partitionId = tile.id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80);
  const win = new BrowserWindow({
    fullscreen: !windowed,
    frame: windowed,
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'web-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `persist:web-${partitionId}`,
      // Read by web-preload.js for the "Close <name>?" overlay.
      additionalArguments: [`--hml-app-name=${encodeURIComponent(String(tile.name || tile.title || 'this app').slice(0, 80))}`, require('./remote-keymap').remoteKeymapArgument()]
    }
  });
  webWindow = win;
  const adapter = webAdapter(win);
  currentApp = { id: tile.id, adapter };
  webWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const allowHttp = (event, url) => { if (!/^https?:\/\//i.test(url)) event.preventDefault(); };
  webWindow.webContents.on('will-navigate', allowHttp);
  webWindow.webContents.on('will-redirect', allowHttp);
  webWindow.webContents.on('before-input-event', (event, input) => {
    // Escape is hold-to-close and handled by web-preload.js (the page keeps ordinary Escape taps).
    // Back is handled here, not in the page, because the main process sees it first: a short press steps back through
    // the page's history (never closes), a press held for longPressMs closes the app. Alt+F4 closes at once.
    if (input.key === 'BrowserBack' || input.key === 'GoBack') {
      event.preventDefault();
      if (input.type === 'keyDown' && !input.isAutoRepeat && backDownAt === 0) backDownAt = Date.now();
      if (input.type === 'keyUp') {
        const heldFor = backDownAt ? Date.now() - backDownAt : 0;
        backDownAt = 0;
        if (heldFor >= longBackMs()) webWindow?.close();
        else if (webWindow && !webWindow.isDestroyed() && webWindow.webContents.canGoBack()) webWindow.webContents.goBack();
      }
    } else if (input.type === 'keyDown' && input.alt && input.key === 'F4') {
      event.preventDefault();
      webWindow?.close();
    }
  });
  webWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  webWindow.webContents.session.setPermissionCheckHandler(() => false);
  // The launcher keeps covering the screen (black) until the web window is visibly up; only then is it hidden.
  // The page is revealed once it has loaded, so the loading card on the launcher stays on screen until then.
  // A fallback reveals slow pages anyway.
  let revealed = false;
  const reveal = () => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    win.show();
    sendToWindow('launcher:app-ready', { tileId: tile.id });
    void sessionExt.controller.handoff({ hide: () => { if (window && !window.isDestroyed()) window.hide(); } });
  };
  win.webContents.once('did-finish-load', reveal);
  setTimeout(reveal, WEBSITE_REVEAL_FALLBACK_MS).unref?.();
  // Raise the (already black) launcher before the web window disappears so the desktop never flashes through.
  win.on('close', () => {
    // Only the app on screen brings the launcher back; a background window closing (eviction) must not.
    if (currentApp?.adapter !== adapter) return;
    sessionExt.controller.closing();
    showLauncher();
  });
  win.once('closed', () => {
    if (currentApp?.adapter !== adapter) {
      // A background window closed (evicted, crashed or closed by the user): only forget it.
      if (backgroundEntries.get(tile.id) === adapter) { backgroundEntries.delete(tile.id); backgroundApps.take(tile.id); }
      return;
    }
    currentApp = null;
    webWindow = null;
    returnToLauncher({ tileId: tile.id, website: true, ...(loadError ? { error: loadError } : {}) });
  });
  webWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    if (errorCode !== -3) {
      loadError = `Website failed to load: ${errorDescription}`;
      webWindow?.close();
    }
  });
  webWindow.loadURL(parsed.toString());
  return true;
}

function isHomeTheatreWebsite(tile) {
  if (!tile.category) return true;
  const categories = Array.isArray(model?.settings?.categories) ? model.settings.categories : [];
  const category = categories.find((entry) => entry.id === tile.category);
  return !category || category.builtin === 'theatre' || category.id === 'theatre';
}

async function openTvWebsite(tile) {
  let parsed;
  try { parsed = new URL(tile.url); } catch { throw new Error('Invalid website URL'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('TV apps require HTTP(S) without embedded credentials');
  const session = new TvBrowserSession({ userData: app.getPath('userData') });
  const adapter = tvAdapter(session);
  let ready = false;
  tvBrowser = session;
  session.once('closed', (result) => {
    if (currentApp?.adapter !== adapter) {
      // A background session ended (evicted, crashed or closed): only forget it.
      if (backgroundEntries.get(tile.id) === adapter) { backgroundEntries.delete(tile.id); backgroundApps.take(tile.id); }
      if (tvBrowser === session) tvBrowser = null;
      return;
    }
    if (tvBrowser === session) tvBrowser = null;
    currentApp = null;
    if (ready) returnToLauncher({ tileId: tile.id, website: true, tvControls: true, ...(result?.error ? { error: result.error } : {}) });
  });
  session.on('home', () => { if (currentApp?.adapter === adapter) sendAppHome(tile.id); });
  session.on('close', () => { if (currentApp?.adapter === adapter) void session.terminate(); });
  try {
    await session.start({ url: parsed.toString(), name: tile.name || tile.title || 'Home Theatre' });
    ready = true;
    currentApp = { id: tile.id, adapter };
    sendToWindow('launcher:app-launched', { tileId: tile.id, type: 'website', tvControls: true });
    sendToWindow('launcher:app-ready', { tileId: tile.id, tvControls: true });
    void sessionExt.controller.handoff({ hide: () => { if (window && !window.isDestroyed()) window.hide(); } });
    return true;
  } catch (error) {
    if (tvBrowser === session) tvBrowser = null;
    throw error;
  }
}

function showLauncher() {
  if (!window || window.isDestroyed()) return;
  window.show();
  window.setFullScreen(!windowed);
  window.focus();
}

/** Single exit path for web windows and native processes: raise the launcher, report the result, end the session. */
function returnToLauncher(result) {
  sessionExt.controller.closing();
  if (window && !window.isDestroyed()) {
    showLauncher();
    window.webContents.send('launcher:app-closed', result);
    window.webContents.send('launcher:process-finished', result);
  }
  sessionExt.controller.finish();
}

function createWindow() {
  window = new BrowserWindow({
    fullscreen: !windowed,
    frame: windowed,
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#07090d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, '../renderer/index.html'), process.env.HML_PERF === '1' || process.argv.includes('--perf') ? { query: { perf: '1' } } : undefined);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  const updateControllerVisibility = () => controllerPairing.setVisible(!window.isDestroyed() && window.isVisible() && !window.isMinimized());
  for (const event of ['show', 'hide', 'minimize', 'restore']) window.on(event, updateControllerVisibility);
  window.on('focus', () => { updateControllerVisibility(); if (controllerPairing.scan && process.platform === 'win32') void controllerPairing.pollWindowsScan(controllerPairing.scan); });
  window.webContents.on('did-start-loading', () => { controllerPairing.setVisible(false); void controllerPairing.cancel(false); });
  window.webContents.on('did-finish-load', updateControllerVisibility);
  window.once('closed', () => { controllerPairing.setVisible(false); void controllerPairing.cancel(false); });
  window.once('ready-to-show', () => window.show());
}

const secrets = readSecrets();
scrubSecrets();
let stopExtensions = null;

app.whenReady().then(async () => {
  configPath = testProfile ? path.join(app.getPath('userData'), 'config.json') : process.env.HOME_MEDIA_LAUNCHER_CONFIG || path.join(app.getPath('userData'), 'config.json');
  tokenPath = path.join(app.getPath('userData'), 'remote-token.json');
  localState = new LocalState(app.getPath('userData'));
  // EXT-HOOK: feature modules in src/main/ext/*.js register their namespaced IPC here.
  sessionExt.controller.attach({
    getLauncherWindow: () => window,
    processManager,
    closeWebWindow: () => {
      if (tvBrowser) { void tvBrowser.terminate(); return; }
      if (webWindow && !webWindow.isDestroyed()) webWindow.close();
    },
    showLauncher,
    electron: { BrowserWindow, screen },
    ozonePlatform: app.commandLine.getSwitchValue('ozone-platform') || app.commandLine.getSwitchValue('ozone-platform-hint'),
    // Background polling is paused while an application owns the screen and resumed (with an immediate refresh) afterwards.
    onPhase: (phase) => {
      activity.gate.setPhase(phase);
      if (phase.phase === 'running') { hostMonitor?.stop(); hostPausedBySession = true; }
      else if (phase.phase === 'idle' && hostPausedBySession) { hostPausedBySession = false; hostMonitor?.start(); void hostMonitor?.poll(); }
    }
  });
  stopExtensions = registerExtensions({ ipcMain, getWindow: () => window, userData: app.getPath('userData'), secrets, config: () => ({ ...(model?.settings || {}), websites: config?.websites || [] }) });
  themeService = new ThemeService(app.getPath('userData'), mediaAssets);
  contextArtwork = new ContextArtwork(app.getPath('userData'), mediaAssets);
  slideshow = new SlideshowCache(mediaAssets);
  const OnlineWallpapers = loadOnlineWallpapers();
  if (OnlineWallpapers) {
    try {
      onlineWallpapers = new OnlineWallpapers(app.getPath('userData'), mediaAssets);
      onlineWallpapers.on?.('warning', (error) => console.warn('Online wallpapers:', error.message));
    } catch (error) { console.warn('Online wallpapers unavailable:', error.message); onlineWallpapers = null; }
  }
  wallpaperPlaylist = new WallpaperPlaylist({ mediaAssets, online: onlineWallpapers });
  wallpaperSources = new WallpaperSourceService({ playlist: wallpaperPlaylist, online: onlineWallpapers });
  mediaAssets.setMemoryCache(slideshow);
  slideshow.on('warning', (error) => console.warn('Slideshow cache:', error.message));
  slideshow.on('changed', (state) => { if (window && !window.isDestroyed()) window.webContents.send('launcher:slideshow-state', state); });
  navigationHints = new NavigationHints((hint) => {
    if (hint.appId !== undefined) focusedAppId = hint.appId;
    const index = hint.slideshowIndex ?? slideshow.currentIndex;
    const url = focusedAppId ? contextArtwork.getAppBackground(focusedAppId).url : null;
    slideshow.setPosition(index, url);
  });
  menuIndicators.on('changed', (state) => {
    if (model) model.menuIndicators = state;
    if (window && !window.isDestroyed()) window.webContents.send('launcher:menu-indicators', state);
  });
  menuIndicators.start();
  themeService.on('warning', (error) => console.warn('Theme storage:', error.message));
  contextArtwork.on('warning', (error) => console.warn('Context artwork:', error.message));
  themeService.on('changed', (state) => {
    if (model) model.theme = state.currentTheme;
    if (window && !window.isDestroyed()) window.webContents.send('launcher:theme-changed', state);
  });
  contextArtwork.on('changed', (entry) => {
    if (model) model.appBackgrounds[entry.appId] = entry;
    if (entry.appId === focusedAppId) slideshow.setPosition(slideshow.currentIndex, entry.url);
    if (window && !window.isDestroyed()) window.webContents.send('launcher:app-background-changed', entry);
  });
  protocol.handle('vibepollo-media', (request) => mediaAssets.respond(request));
  await Promise.all([themeService.initialize(), contextArtwork.initialize()]);
  await buildModel();
  createWindow();
  hostMonitor = new HostMonitor(refreshHost);
  hostMonitor.start();
  void hostMonitor.poll();
}).catch((error) => { dialog.showErrorBox('Launcher startup failed', error.message); app.quit(); });

let controllerCleanupFinished = false;
let controllerCleanupStarted = false;
app.on('before-quit', (event) => {
  void adminServer?.stop();
  if (!controllerCleanupFinished) {
    event.preventDefault();
    if (!controllerCleanupStarted) {
      controllerCleanupStarted = true;
      void controllerPairing.dispose().finally(() => { controllerCleanupFinished = true; app.quit(); });
    }
  }
  hostMonitor?.stop();
  stopExtensions?.();
  sessionExt.controller.dispose();
  void tvBrowser?.terminate();
  if (webWindow && !webWindow.isDestroyed()) webWindow.destroy();
  if (processManager.active) processManager.terminate({ graceMs: 0, force: true });
  themeService?.close();
  void contextArtwork?.close();
  navigationHints?.close();
  void slideshow?.close();
  void menuIndicators.close();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

handle('launcher:get-model', () => model);
handle('launcher:get-controller-status', () => controllerPairing.getStatus());
handle('launcher:get-connected-gamepads', () => controllerPairing.getStatus());
handle('launcher:get-dongle-status', () => controllerPairing.getDongleStatus());
handle('launcher:start-dongle-pairing', () => controllerPairing.startDonglePairing());
handle('launcher:unblock-bluetooth', () => controllerPairing.unblockBluetooth());
handle('launcher:start-controller-pairing', (_event, transport) => controllerPairing.start(transport));
handle('launcher:pair-controller', (_event, id) => controllerPairing.pair(id));
handle('launcher:cancel-controller-pairing', () => controllerPairing.cancel());
handle('launcher:cancel-pairing', () => controllerPairing.cancel());
handle('launcher:get-menu-configuration', () => structuredClone(menuDefinition));
handle('launcher:get-menu-indicators', () => menuIndicators.get());
handle('launcher:get-slideshow-state', () => slideshow.state());
handle('launcher:prefetch-slideshow', (_event, index) => {
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid slideshow index');
  slideshow.setPosition(index); return slideshow.state(); });
ipcMain.on('launcher:navigation-hint', (event, hint) => {
  if (window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) navigationHints?.push(hint);
});
handle('launcher:get-available-themes', () => themeService.getAvailableThemes());
handle('launcher:get-current-theme', () => themeService.getCurrentTheme());
handle('launcher:set-theme', (_event, id) => themeService.setTheme(id));
handle('launcher:save-custom-theme', (_event, theme) => themeService.saveCustomTheme(theme));
handle('launcher:get-app-background', (_event, id) => contextArtwork.getAppBackground(id));
handle('launcher:get-app-backgrounds', () => contextArtwork.snapshot());
handle('launcher:get-settings', () => config);
handle('launcher:get-remote-credential-status', () => hasToken(tokenPath));
handle('launcher:save-remote-token', (_event, token) => {
  if (typeof token !== 'string') throw new Error('Token must be a string');
  return saveToken(tokenPath, token.trim(), safeStorage);
});
handle('launcher:save-remote-credentials', (_event, credential) => saveCredential(tokenPath, credential, safeStorage));
handle('launcher:set-icon-override', async (_event, tileId, source) => {
  const tile = [...model.availableApps, ...model.rows.flatMap((row) => row.tiles)].find((candidate) => candidate.id === tileId);
  if (!tile) throw new Error('Unknown application ID');
  await localState.setIcon(tileId, source);
  return buildModel();
});
handle('launcher:reload-config', async () => buildModel());
handle('launcher:refresh-remote', async () => buildModel());
handle('launcher:admin-pair', async () => {
  if (!adminServer?.status().running) throw new Error('The admin panel is not running. Enable it in settings.admin.');
  const pairing = await adminServer.pair();
  return { expiresAt: pairing.expiresAt };
});
handle('launcher:open-config', () => shell.openPath(configPath));
/** The settings page only submits checked apps; derive which remote apps the user switched off. */
function withHiddenApps(next) {
  if (!next?.settings || !Array.isArray(next.settings.selectedAppIds)) return next;
  const hiddenAppIds = computeHiddenAppIds(config.settings?.hiddenAppIds, model?.availableApps || [], next.settings.selectedAppIds);
  return { ...next, settings: { ...next.settings, hiddenAppIds } };
}
handle('launcher:save-settings', async (_event, nextConfig) => {
  if (building) await building;
  const preserved = nextConfig && typeof nextConfig === 'object' && nextConfig.menu === undefined && config.menu !== undefined
    ? { ...nextConfig, menu: config.menu } : nextConfig;
  const toSave = withHiddenApps(preserved);
  await saveConfig(configPath, toSave);
  return buildModel();
});
handle('launcher:choose-file', async (_event, kind) => {
  const filters = kind === 'sound'
    ? [{ name: 'UI sounds', extensions: ['mp3', 'wav', 'ogg'] }]
    : kind === 'icon'
    ? [{ name: 'Icons', extensions: ['png', 'svg', 'jpg', 'jpeg', 'webp', 'gif', 'ico'] }]
    : kind === 'wallpaper'
    ? [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm'] }]
    : [{ name: 'Applications and scripts', extensions: process.platform === 'win32' ? ['exe', 'cmd', 'bat', 'ps1', 'lnk'] : ['AppImage', 'sh', 'bin'] }];
  const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters });
  return result.canceled ? '' : result.filePaths[0];
});
handle('launcher:pick-wallpaper-folder', async () => {
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  wallpaperPlaylist.allowOne(result.filePaths[0]);
  return wallpaperPlaylist.inspect(result.filePaths[0]);
});
handle('launcher:inspect-wallpaper-folder', (_event, folder) => {
  return wallpaperPlaylist.inspect(folder);
});
handle('launcher:get-wallpaper-count', (_event, request) => wallpaperPlaylist.count(request));
handle('launcher:get-wallpaper-slide', (_event, request, index) => wallpaperPlaylist.slide(request, index));
handle('launcher:get-online-wallpaper-status', () => ({ available: Boolean(onlineWallpapers), count: onlineWallpapers ? onlineWallpapers.catalog().length : 0 }));
handle('launcher:wallpaper-sources', (_event, action, payload) => wallpaperSources.handle(action, payload));
handle('launcher:clear-online-wallpapers', async () => { await onlineWallpapers?.clear(); return Boolean(onlineWallpapers); });
handle('launcher:get-autostart', () => getAutostart(app));
handle('launcher:set-autostart', (_event, enabled) => setAutostart(app, enabled === true));
handle('launcher:system-action', (_event, action) => {
  if (action === 'quit') { app.quit(); return true; }
  if (action !== 'poweroff') throw new Error('Unsupported system action');
  const command = process.platform === 'win32'
    ? { file: 'shutdown.exe', args: ['/s', '/t', '0'] }
    : { file: 'systemctl', args: ['poweroff'] };
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore', shell: false });
  child.unref();
  return true;
});
handle('launcher:get-weather', async (_event, location) => {
  if (typeof location !== 'string' || !location.trim()) return null;
  const wanted = parseLocationQuery(location);
  const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&name=${encodeURIComponent(wanted.name)}${wanted.country ? `&countryCode=${wanted.country}` : ''}`;
  const geocode = await fetch(geocodeUrl, { signal: AbortSignal.timeout(5000) }).then((response) => response.json());
  const place = pickPlace(geocode.results, wanted);
  if (!place) return null;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&timezone=auto`;
  const weather = await fetch(weatherUrl, { signal: AbortSignal.timeout(5000) }).then((response) => response.json());
  return { location: place.name, temperature: weather.current?.temperature_2m, code: weather.current?.weather_code };
});
async function launchTile(tileId) {
  if (typeof tileId !== 'string' || !tileId) throw new Error('Application ID is required');
  if (processManager.active) throw new Error('Another application is already running');
  const tile = model.rows.flatMap((row) => row.tiles).find((candidate) => candidate.id === tileId);
  if (!tile) throw new Error('Unknown tile');
  if (backgroundEntries.has(tile.id)) {
    // Resume: the app is already running in the background; no new process.
    const adapter = backgroundEntries.get(tile.id);
    backgroundEntries.delete(tile.id);
    backgroundApps.take(tile.id);
    if (!sessionExt.controller.begin(tile)) throw new Error('Another application is already running');
    currentApp = { id: tile.id, adapter };
    webWindow = adapter.win || null;
    if (adapter.session) tvBrowser = adapter.session;
    adapter.show();
    void sessionExt.controller.handoff({ hide: () => { if (window && !window.isDestroyed()) window.hide(); } });
    sendToWindow('launcher:app-launched', { tileId: tile.id, type: tile.type, resumed: true });
    sendToWindow('launcher:app-ready', { tileId: tile.id, resumed: true });
    return true;
  }
  if (currentApp || tvBrowser) backgroundCurrent();
  if (tvBrowser) throw new Error('Another application is already running');
  if (!sessionExt.controller.begin(tile)) throw new Error('Another application is already running');
  try {
    if (tile.type === 'website') {
      const tvControls = isHomeTheatreWebsite(tile);
      const opened = tvControls ? await openTvWebsite(tile) : openWebsite(tile);
      if (!tvControls) sendToWindow('launcher:app-launched', { tileId: tile.id, type: 'website' });
      return opened;
    }
    const result = await processManager.launchChecked(tile);
    sendToWindow('launcher:app-ready', { tileId: tile.id });
    // Not awaited: the launcher stays up (black) until the application took the focus, then hides itself.
    void sessionExt.controller.handoff({ hide: () => { if (window && !window.isDestroyed()) window.hide(); }, window, waitForBlur: true });
    return result;
  } catch (error) {
    sessionExt.controller.fail();
    throw error;
  }
}

handle('launcher:launch', (_event, tileId) => launchTile(tileId));
// The renderer only names a catalogue entry; commands and arguments always come from trusted configuration.
handle('launcher:launch-app', (_event, appConfig) => launchTile(launchIdFrom(appConfig)));
handle('launcher:get-game-library', () => library.getGameLibrary());
handle('launcher:force-sync', async () => {
  await hostMonitor?.poll();
  return library.getGameLibrary();
});

ipcMain.on('web-app:home', (event) => {
  if (!webWindow || event.sender !== webWindow.webContents || event.senderFrame !== webWindow.webContents.mainFrame) return;
  const id = currentApp?.id;
  if (!id) return;
  sendAppHome(id);
});

ipcMain.on('web-app:close', (event) => { if (webWindow && event.sender === webWindow.webContents && event.senderFrame === webWindow.webContents.mainFrame) webWindow.close(); });

let syncRevision = 0;
let lastSyncedAt = null;
library.on('sync-progress', (progress) => {
  sendToWindow('launcher:sync-progress', progress);
  if (progress.phase === 'complete') lastSyncedAt = new Date().toISOString();
  sendToWindow('launcher:sync-status', {
    state: progress.phase === 'complete' ? 'idle' : progress.phase === 'offline' ? 'offline' : 'syncing',
    revision: ++syncRevision, lastSyncedAt, itemCount: progress.total, error: null
  });
});
processManager.on('started', (event) => sendToWindow('launcher:app-launched', event));
processManager.on('finished', (result) => returnToLauncher(result));
