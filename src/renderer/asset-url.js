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
      const id = Object.keys(presetIcons).find((candidate) => current === previous[candidate] || current.endsWith(`/icons/presets/${candidate}.svg`));
      if (id && current !== presetIcons[id]) image.src = presetIcons[id];
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
      bridge.invoke('icons', 'presetIcons').then(setPresetIcons)
        .then(() => bridge.invoke('icons', 'refreshPresetIcons')).then(setPresetIcons).catch(() => {});
    });
  }

  return { assetUrl, isLoadableImage, presetIdOf, setPresetIcons };
});
