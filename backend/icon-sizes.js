'use strict';

/**
 * Preferred artwork sizes, shared by the resolver and the UI picker (see backend/ICONS.md).
 * Also reachable from the renderer through ns `icons` method `sizes()`.
 */
const ICON_SIZES = Object.freeze({
  /** Website / media tile art, 16:9. */
  tile: Object.freeze({ width: 1280, height: 720, formats: Object.freeze(['png', 'jpg', 'webp']) }),
  /** App icon, square. PNG or SVG. */
  appIcon: Object.freeze({ width: 512, height: 512, formats: Object.freeze(['png', 'svg']) }),
  /** Game poster, 2:3. */
  poster: Object.freeze({ width: 600, height: 900, formats: Object.freeze(['png', 'jpg', 'webp']) }),
  /** Hero banner. */
  hero: Object.freeze({ width: 1920, height: 620, formats: Object.freeze(['png', 'jpg', 'webp']) }),
  /** Logo with transparent background. */
  logo: Object.freeze({ width: 1000, height: 400, formats: Object.freeze(['png']), transparent: true })
});

/** Smallest edge accepted for a site-provided icon before it is considered low quality. */
const MIN_SITE_ICON_EDGE = 64;

module.exports = { ICON_SIZES, MIN_SITE_ICON_EDGE };
