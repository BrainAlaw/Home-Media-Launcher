(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AssetUrl = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Install-path independent preset icons: config stores `preset:<id>` (older configs stored an absolute
  // file URL of the bundled SVG, which is mapped to the same token). The map below is filled from the main
  // process (ns `icons`) with the tile art composed from the service's own icon; until then (or when the
  // service offers no usable icon) the bundled monogram tile next to this page is used.
  const BUNDLED_PRESET = /\/icons\/presets\/([a-z0-9-]+)\.svg(?:[?#].*)?$/i;
  let presetIcons = {};
  /** Generated host-app tile art by lower-cased app name (file URL, SteamGridDB composition or data-URL monogram). */
  const gameArt = new Map();
  const gamePending = new Map();

  /** Preset id for a `preset:<id>` token or a legacy absolute bundled-icon URL; null otherwise. */
  function presetIdOf(source) {
    if (typeof source !== 'string') return null;
    const token = /^preset:([a-z0-9-]+)$/.exec(source);
    if (token) return token[1];
    if (!/^file:/i.test(source)) return null;
    let decoded = source;
    try { decoded = decodeURIComponent(source); } catch { /* keep the raw value */ }
    const legacy = BUNDLED_PRESET.exec(decoded.split(String.fromCharCode(92)).join('/'));
    return legacy ? legacy[1] : null;
  }

  function presetUrl(id) { return presetIcons[id] || `icons/presets/${id}.svg`; }

  /** Installs the id -> file URL map and swaps the source of preset images that are already on screen. */
  function setPresetIcons(map) {
    if (!map || typeof map !== 'object') return;
    const previous = presetIcons;
    presetIcons = { ...presetIcons };
    for (const [id, url] of Object.entries(map)) if (/^[a-z0-9-]+$/.test(id) && typeof url === 'string' && /^file:/i.test(url)) presetIcons[id] = url;
    if (typeof document === 'undefined') return;
    for (const image of document.images) {
      const current = image.getAttribute('src') || '';
      const id = Object.keys(presetIcons).find((candidate) => current === previous[candidate] || current === `icons/presets/${candidate}.svg` || current.endsWith(`/icons/presets/${candidate}.svg`));
      if (id && current !== presetIcons[id]) image.src = presetIcons[id];
    }
  }

  /** Announces new art for a host application so rendered tiles can swap it in without a reload. */
  function announceGameArt(name, url) {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
    document.dispatchEvent(new CustomEvent('hml:tile-art', { detail: { name, url } }));
  }

  const gameKey = (name) => String(name || '').trim().toLowerCase();

  /** Tile art already known for a host application name; '' until `requestGameArt` resolved. */
  function gameArtFor(name) { return gameArt.get(gameKey(name)) || ''; }

  /**
   * Asks the main process for the 16:9 tile art of a host application that has no cover (`builtin` selects the glyph
   * tile for host built-ins such as Desktop). Resolves with the URL or '' when the bridge is unavailable; concurrent
   * requests for the same name share one call.
   */
  function requestGameArt(name, builtin) {
    const key = gameKey(name);
    if (!key) return Promise.resolve('');
    if (gameArt.has(key)) return Promise.resolve(gameArt.get(key));
    const bridge = typeof window !== 'undefined' && window.launcher && window.launcher.ext;
    if (!bridge || typeof bridge.invoke !== 'function') return Promise.resolve('');
    if (!gamePending.has(key)) {
      gamePending.set(key, bridge.invoke('icons', 'gameTile', { name, ...(typeof builtin === 'boolean' ? { builtin } : {}) })
        .then((result) => {
          const url = result && typeof result.url === 'string' && /^(file:|data:image\/)/i.test(result.url) ? result.url : '';
          if (url) gameArt.set(key, url);
          return url;
        }).catch(() => '').finally(() => gamePending.delete(key)));
    }
    return gamePending.get(key);
  }

  /** Applies an `art-updated` event from the icons extension. */
  function applyArtUpdate(event) {
    if (!event || typeof event.url !== 'string' || !/^file:/i.test(event.url)) return;
    if (event.kind === 'preset' && typeof event.id === 'string') setPresetIcons({ [event.id]: event.url });
    else if (event.kind === 'game' && typeof event.name === 'string') {
      gameArt.set(gameKey(event.name), event.url);
      announceGameArt(event.name, event.url);
    }
  }

  /**
   * Converts a user-supplied path or URL into a URL the renderer can load.
   * Absolute URLs and data URIs pass through; filesystem paths become file:// URLs.
   * Windows drive paths (C:\x) are normalised to file:///C:/x so the drive is not parsed as a host.
   * @param {string | undefined | null} source
   * @returns {string}
   */
  function assetUrl(source) {
    if (!source) return '';
    const presetId = presetIdOf(source);
    if (presetId) return presetUrl(presetId);
    if (/^(data:|file:|https?:|vibepollo-media:)/i.test(source)) return source;
    let path = String(source).replace(/\\/g, '/');
    if (!path.startsWith('/')) path = `/${path}`;
    return encodeURI(`file://${path}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  /**
   * True when the value looks like something an <img> can load (path, URL, data URI or image extension).
   * Bare icon-theme names such as "firefox" are not loadable from the renderer.
   * @param {string | undefined | null} icon
   * @returns {boolean}
   */
  function isLoadableImage(icon) {
    if (!icon) return false;
    if (presetIdOf(icon)) return true;
    return /^data:image\//i.test(icon) || /[\\/]/.test(icon) || /\.(png|jpe?g|webp|svg|ico|gif|avif)$/i.test(icon);
  }

  // In the app: fetch the tile art map once (instant, from cache) and again after missing art was downloaded.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      const bridge = window.launcher && window.launcher.ext;
      if (!bridge || typeof bridge.invoke !== 'function') return;
      // Live updates first so art finished while the maps below are in flight is not missed.
      if (typeof bridge.on === 'function') { try { bridge.on('icons', 'art-updated', applyArtUpdate); } catch { /* Bridge without events: the invokes below still run. */ } }
      bridge.invoke('icons', 'presetIcons').then(setPresetIcons)
        .then(() => bridge.invoke('icons', 'refreshPresetIcons')).then(setPresetIcons).catch(() => {});
    });
  }

  return { assetUrl, isLoadableImage, presetIdOf, setPresetIcons, requestGameArt, gameArtFor, applyArtUpdate };
});
