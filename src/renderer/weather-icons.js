/** Bundled weather glyphs keyed by OpenWeatherMap icon code. Static markup only: nothing is fetched at runtime. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeatherIcons = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>';
  const MOON = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>';
  const CLOUD = '<path d="M7 19h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.5 10.2 4.4 4.4 0 0 0 7 19Z"/>';
  const HIGH_CLOUD = '<path d="M7 15h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.5 6.2 4.4 4.4 0 0 0 7 15Z"/>';
  const SMALL_CLOUD = '<path d="M8 20h9a3.5 3.5 0 0 0 .5-6.96A5.2 5.2 0 0 0 7.7 13 3.5 3.5 0 0 0 8 20Z"/>';
  const GLYPHS = {
    '01d': SUN,
    '01n': MOON,
    '02d': '<circle cx="9" cy="8" r="3"/><path d="M9 2.5v1.4M3.5 8h1.4M4.9 4l1 1M13.1 4l-1 1"/>' + SMALL_CLOUD,
    '02n': '<path d="M12 5.5A4.5 4.5 0 0 1 6.5 3.6 4.5 4.5 0 1 0 12 9.4"/>' + SMALL_CLOUD,
    '03': CLOUD,
    '04': CLOUD + '<path d="M4 8.5a4 4 0 0 1 4-3.5" opacity=".55"/>',
    '09': HIGH_CLOUD + '<path d="M8 17.5l-.8 2M12 17.5l-.8 2M16 17.5l-.8 2M10 21l-.4 1.2M14 21l-.4 1.2"/>',
    '10': HIGH_CLOUD + '<path d="M8 18l-.8 2.5M12 18l-.8 2.5M16 18l-.8 2.5"/>',
    '11': HIGH_CLOUD + '<path d="m12.5 14.5-2.2 3.2h3.2l-2.2 3.3"/>',
    '13': '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.8 4.7 12 6.5l2.2-1.8M9.8 19.3 12 17.5l2.2 1.8"/>',
    '50': '<path d="M4 8h16M3 12h18M5 16h14M8 20h8"/>'
  };

  const FALLBACK = '03';
  const FORMAT = /^(\d{2})([dn])$/;

  function markupFor(code) {
    const match = FORMAT.exec(String(code));
    if (!match) return GLYPHS[FALLBACK];
    return GLYPHS[match[1] + match[2]] || GLYPHS[match[1]] || GLYPHS[FALLBACK];
  }

  /** Returns a detached <svg> element for an OpenWeatherMap icon code such as "10d". */
  function create(code) {
    const template = document.createElement('template');
    template.innerHTML = `<svg class="weather-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${markupFor(code)}</svg>`;
    return template.content.firstElementChild;
  }

  return { create, markupFor };
});
