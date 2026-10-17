(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AssetUrl = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Converts a user-supplied path or URL into a URL the renderer can load.
   * Absolute URLs and data URIs pass through; filesystem paths become file:// URLs.
   * Windows drive paths (C:\x) are normalised to file:///C:/x so the drive is not parsed as a host.
   * @param {string | undefined | null} source
   * @returns {string}
   */
  function assetUrl(source) {
    if (!source) return '';
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
    return /^data:image\//i.test(icon) || /[\\/]/.test(icon) || /\.(png|jpe?g|webp|svg|ico|gif|avif)$/i.test(icon);
  }

  return { assetUrl, isLoadableImage };
});
