(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WallpaperCredit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Google-TV-style wallpaper attribution. Pure formatting helpers plus a tiny overlay controller that fades the
   * credit in when the wallpaper changes and out again after a hold time. The overlay never takes focus or input.
   *
   * @typedef {{ title: string, author: string, license: string, source: string, location: string, origin: string }} Credit
   */

  const HOLD_MS = 8000;
  const SOURCE_LABELS = Object.freeze({
    'commons.wikimedia.org': 'Wikimedia Commons',
    'upload.wikimedia.org': 'Wikimedia Commons',
    'thumb.wikimedia.org': 'Wikimedia Commons',
    'unsplash.com': 'Unsplash',
    'images.unsplash.com': 'Unsplash',
    'pexels.com': 'Pexels',
    'flickr.com': 'Flickr',
    'nasa.gov': 'NASA',
    'images.nasa.gov': 'NASA',
    'esahubble.org': 'ESA/Hubble'
  });

  /** @param {unknown} value @returns {string} */
  function text(value) { return typeof value === 'string' ? value.trim() : ''; }

  /**
   * "Wikimedia Commons" for known hosts, the bare host for other URLs, or the text itself when it is not a URL.
   * @param {unknown} source
   */
  function sourceLabel(source) {
    const value = text(source);
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) return value;
    try {
      const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
      return SOURCE_LABELS[host] || host;
    } catch { return ''; }
  }

  /**
   * Splits a credit into the lines the overlay shows. Returns null when there is nothing worth showing.
   * @param {Partial<Credit> | null | undefined} credit
   * @returns {{ title: string, byline: string, via: string, key: string } | null}
   */
  function creditLines(credit) {
    if (!credit || typeof credit !== 'object') return null;
    const title = text(credit.title);
    const author = text(credit.author);
    const license = text(credit.license);
    const location = text(credit.location);
    const via = sourceLabel(credit.source);
    if (!title && !author && !via) return null;
    const heading = title && location && !title.toLowerCase().includes(location.toLowerCase()) ? `${title} · ${location}` : (title || location);
    const byline = [author, license].filter(Boolean).join(' · ');
    return { title: heading, byline, via: via ? `via ${via}` : '', key: [heading, byline, via].join('|') };
  }

  /**
   * Credit for an entry of the bundled gallery (window.WALLPAPER_ENTRIES).
   * @param {{ name?: string, author?: string, license?: string, source?: string } | null | undefined} entry
   * @returns {Credit | null}
   */
  function fromBundled(entry) {
    if (!entry) return null;
    return { title: text(entry.name), author: text(entry.author), license: text(entry.license), source: text(entry.source), location: '', origin: 'bundled' };
  }

  /**
   * @param {{ root: HTMLElement, holdMs?: number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} options
   */
  function createOverlay({ root: element, holdMs = HOLD_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let enabled = true;
    let currentKey = '';
    let timer = null;
    const title = document.createElement('strong');
    const byline = document.createElement('span');
    const via = document.createElement('small');
    element.append(title, byline, via);
    element.setAttribute('aria-hidden', 'true');

    function hide() {
      clearTimer(timer);
      timer = null;
      element.classList.remove('visible');
    }

    /** Shows the credit for a newly displayed wallpaper; repeats of the same credit stay quiet. */
    function show(credit) {
      const lines = creditLines(credit);
      if (!enabled || !lines) { currentKey = lines ? lines.key : ''; hide(); return; }
      if (lines.key === currentKey) return;
      currentKey = lines.key;
      title.textContent = lines.title;
      byline.textContent = lines.byline;
      via.textContent = lines.via;
      title.hidden = !lines.title;
      byline.hidden = !lines.byline;
      via.hidden = !lines.via;
      element.classList.add('visible');
      clearTimer(timer);
      timer = setTimer(() => { timer = null; element.classList.remove('visible'); }, holdMs);
    }

    /** Settings toggle; disabling hides immediately and forgets the last credit so re-enabling shows it again. */
    function setEnabled(value) {
      enabled = value !== false;
      if (!enabled) { hide(); currentKey = ''; }
    }

    return { show, hide, setEnabled, get visible() { return element.classList.contains('visible'); } };
  }

  return { HOLD_MS, sourceLabel, creditLines, fromBundled, createOverlay };
});
