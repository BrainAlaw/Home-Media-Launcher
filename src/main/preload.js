'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** @type {import('../../backend/contracts').MenuIndicatorSnapshot | null} */
let cachedIndicators = null;
/** @type {Map<string, { value: import('../../backend/contracts').AppBackground, revision: number }>} */
const cachedArtwork = new Map();
let artworkRevision = 0;
/** @type {import('../../backend/contracts').NavigationHint | null} */
let pendingNavigation = null;

/** @param {import('../../backend/contracts').MenuIndicatorSnapshot} snapshot */
function acceptIndicators(snapshot) {
  if (!cachedIndicators || snapshot.revision >= cachedIndicators.revision) cachedIndicators = snapshot;
}

/** @param {Record<string, import('../../backend/contracts').AppBackground>} snapshot @param {number} started */
function acceptArtwork(snapshot, started) {
  for (const [id, entry] of cachedArtwork) if (entry.revision <= started && !Object.hasOwn(snapshot, id)) cachedArtwork.delete(id);
  for (const [id, value] of Object.entries(snapshot)) {
    if ((cachedArtwork.get(id)?.revision ?? -1) <= started) cachedArtwork.set(id, { value, revision: started });
  }
}

ipcRenderer.on('launcher:menu-indicators', (_event, snapshot) => acceptIndicators(snapshot));
ipcRenderer.on('launcher:app-background-changed', (_event, value) => cachedArtwork.set(value.appId, { value, revision: ++artworkRevision }));

/** @template T @param {string} channel @param {(value: T) => void} callback */
function subscribe(channel, callback) {
  /** @param {Electron.IpcRendererEvent} _event @param {T} value */
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

/** @type {import('../../backend/contracts').MenuLauncherAPI} */
const menuAPI = {
  getMenuConfiguration: () => ipcRenderer.invoke('launcher:get-menu-configuration'),
  getMenuIndicators: async () => { const snapshot = await ipcRenderer.invoke('launcher:get-menu-indicators'); acceptIndicators(snapshot); return snapshot; },
  getCachedMenuIndicators: () => cachedIndicators ? structuredClone(cachedIndicators) : null,
  getCachedAppBackground: (appId) => ({ ...(cachedArtwork.get(appId)?.value || { appId, state: 'missing', url: null, kind: null }) }),
  getSlideshowState: () => ipcRenderer.invoke('launcher:get-slideshow-state'),
  prefetchSlideshow: (index) => ipcRenderer.invoke('launcher:prefetch-slideshow', index),
  hintNavigation: (hint) => {
    if (!hint || typeof hint !== 'object') throw new Error('Invalid navigation hint');
    const scheduled = pendingNavigation !== null;
    pendingNavigation = { ...pendingNavigation,
      ...(hint.appId !== undefined ? { appId: hint.appId } : {}),
      ...(hint.slideshowIndex !== undefined ? { slideshowIndex: hint.slideshowIndex } : {}) };
    if (!scheduled) queueMicrotask(() => {
      const next = pendingNavigation;
      pendingNavigation = null;
      ipcRenderer.send('launcher:navigation-hint', next);
    });
  },
  onMenuConfigurationChanged: (callback) => subscribe('launcher:menu-configuration', callback),
  onMenuIndicators: (callback) => subscribe('launcher:menu-indicators', callback),
  onSlideshowState: (callback) => subscribe('launcher:slideshow-state', callback)
};

/** @type {import('../../backend/contracts').ThemeLauncherAPI} */
const themeAPI = {
  getAvailableThemes: () => ipcRenderer.invoke('launcher:get-available-themes'),
  getCurrentTheme: () => ipcRenderer.invoke('launcher:get-current-theme'),
  setTheme: (themeId) => ipcRenderer.invoke('launcher:set-theme', themeId),
  saveCustomTheme: (theme) => ipcRenderer.invoke('launcher:save-custom-theme', theme),
  getAppBackground: (appId) => ipcRenderer.invoke('launcher:get-app-background', appId),
  getAppBackgrounds: async () => {
    const started = artworkRevision;
    const snapshot = await ipcRenderer.invoke('launcher:get-app-backgrounds');
    acceptArtwork(snapshot, started);
    return snapshot;
  },
  onThemeChanged: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {import('../../backend/contracts').ThemeState} state */
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('launcher:theme-changed', listener);
    return () => ipcRenderer.removeListener('launcher:theme-changed', listener);
  },
  onAppBackgroundChanged: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {import('../../backend/contracts').AppBackground} artwork */
    const listener = (_event, artwork) => callback(artwork);
    ipcRenderer.on('launcher:app-background-changed', listener);
    return () => ipcRenderer.removeListener('launcher:app-background-changed', listener);
  },
};

/** @type {import('../../backend/contracts').ControllerLauncherAPI} */
const controllerAPI = {
  getControllerStatus: () => ipcRenderer.invoke('launcher:get-controller-status'),
  getConnectedGamepads: () => ipcRenderer.invoke('launcher:get-connected-gamepads'),
  getDongleStatus: () => ipcRenderer.invoke('launcher:get-dongle-status'),
  startDonglePairing: () => ipcRenderer.invoke('launcher:start-dongle-pairing'),
  unblockBluetooth: () => ipcRenderer.invoke('launcher:unblock-bluetooth'),
  startControllerPairing: (transport) => ipcRenderer.invoke('launcher:start-controller-pairing', transport),
  pairController: (id) => ipcRenderer.invoke('launcher:pair-controller', id),
  cancelControllerPairing: () => ipcRenderer.invoke('launcher:cancel-controller-pairing'),
  cancelPairing: () => ipcRenderer.invoke('launcher:cancel-pairing'),
  onControllerPairingUpdate: (callback) => subscribe('launcher:controller-pairing-update', callback),
  onDeviceFound: (callback) => subscribe('launcher:controller-device-found', callback),
  onPairingSuccess: (callback) => subscribe('launcher:controller-pairing-success', callback),
  onPairingError: (callback) => subscribe('launcher:controller-pairing-error', callback),
  onBatteryUpdate: (callback) => subscribe('launcher:controller-battery-update', callback),
  onControllersChanged: (callback) => subscribe('launcher:controller-controllers-changed', callback)
};

/** @type {import('../../backend/contracts').LauncherAppAPI} */
const appAPI = {
  launchApp: (config) => ipcRenderer.invoke('launcher:launch-app', config),
  onAppLaunched: (callback) => subscribe('launcher:app-launched', callback),
  onAppClosed: (callback) => subscribe('launcher:app-closed', callback),
  onSyncStatus: (callback) => subscribe('launcher:sync-status', callback)
};

contextBridge.exposeInMainWorld('api', appAPI);
contextBridge.exposeInMainWorld('launcher', {
  ...themeAPI,
  ...menuAPI,
  ...controllerAPI,
  getModel: async () => {
    const started = artworkRevision;
    const model = await ipcRenderer.invoke('launcher:get-model');
    acceptArtwork(model.appBackgrounds || {}, started);
    if (model.menuIndicators) acceptIndicators(model.menuIndicators);
    return model;
  },
  getSettings: () => ipcRenderer.invoke('launcher:get-settings'),
  getRemoteCredentialStatus: () => ipcRenderer.invoke('launcher:get-remote-credential-status'),
  /** @param {string} token */
  saveRemoteToken: (token) => ipcRenderer.invoke('launcher:save-remote-token', token),
  /** @param {{ type: 'basic', username: string, password: string } | null} credential */
  saveRemoteCredentials: (credential) => ipcRenderer.invoke('launcher:save-remote-credentials', credential),
  /** @param {string} tileId @param {string} source */
  setIconOverride: (tileId, source) => ipcRenderer.invoke('launcher:set-icon-override', tileId, source),
  /** @param {Record<string, unknown>} config */
  saveSettings: (config) => ipcRenderer.invoke('launcher:save-settings', config),
  /** @param {'icon' | 'sound' | 'wallpaper' | 'application'} kind */
  chooseFile: (kind) => ipcRenderer.invoke('launcher:choose-file', kind),
  pickWallpaperFolder: () => ipcRenderer.invoke('launcher:pick-wallpaper-folder'),
  /** @param {string} folder */
  inspectWallpaperFolder: (folder) => ipcRenderer.invoke('launcher:inspect-wallpaper-folder', folder),
  /** @param {{ folders: string[], online: boolean }} request */
  getWallpaperCount: (request) => ipcRenderer.invoke('launcher:get-wallpaper-count', request),
  /** @param {{ folders: string[], online: boolean }} request @param {number} index */
  getWallpaperSlide: (request, index) => ipcRenderer.invoke('launcher:get-wallpaper-slide', request, index),
  getOnlineWallpaperStatus: () => ipcRenderer.invoke('launcher:get-online-wallpaper-status'),
  clearOnlineWallpapers: () => ipcRenderer.invoke('launcher:clear-online-wallpapers'),
  getAutostart: () => ipcRenderer.invoke('launcher:get-autostart'),
  /** @param {boolean} enabled */
  setAutostart: (enabled) => ipcRenderer.invoke('launcher:set-autostart', enabled),
  /** @param {'quit' | 'poweroff'} action */
  systemAction: (action) => ipcRenderer.invoke('launcher:system-action', action),
  /** @param {string} location */
  getWeather: (location) => ipcRenderer.invoke('launcher:get-weather', location),
  /** @param {string} tileId */
  launch: (tileId) => ipcRenderer.invoke('launcher:launch', tileId),
  openConfig: () => ipcRenderer.invoke('launcher:open-config'),
  reloadConfig: () => ipcRenderer.invoke('launcher:reload-config'),
  refreshRemote: () => ipcRenderer.invoke('launcher:refresh-remote'),
  getGameLibrary: () => ipcRenderer.invoke('launcher:get-game-library'),
  forceSync: () => ipcRenderer.invoke('launcher:force-sync'),
  /** @param {{ id: string }} appConfig */
  launchApp: (appConfig) => ipcRenderer.invoke('launcher:launch-app', appConfig),
  onAppLaunched: (callback) => subscribe('launcher:app-launched', callback),
  onAppClosed: (callback) => subscribe('launcher:app-closed', callback),
  onSyncProgress: (callback) => subscribe('launcher:sync-progress', callback),
  /** @param {(status: Record<string, unknown>) => void} callback */
  onRemoteStatus: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {Record<string, unknown>} status */
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('launcher:remote-status', listener);
    return () => ipcRenderer.removeListener('launcher:remote-status', listener);
  },
  /** @param {(model: Record<string, unknown>) => void} callback */
  onModelUpdated: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {Record<string, unknown>} nextModel */
    const listener = (_event, nextModel) => callback(nextModel);
    ipcRenderer.on('launcher:model-updated', listener);
    return () => ipcRenderer.removeListener('launcher:model-updated', listener);
  },
  /** @param {(result: Record<string, unknown>) => void} callback */
  onProcessFinished: (callback) => {
    /** @param {Electron.IpcRendererEvent} _event @param {Record<string, unknown>} result */
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('launcher:process-finished', listener);
    return () => ipcRenderer.removeListener('launcher:process-finished', listener);
  }
});
