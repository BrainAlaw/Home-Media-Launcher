'use strict';

/** Pure helpers for the embedded Spotify web player (src/main/ext/spotify-web.js). */

const START_URL = 'https://open.spotify.com/';
const PARTITION = 'persist:spotify-web';
/** Hosts the embedded page may navigate to: Spotify itself plus the social sign-in providers its login offers. */
const ALLOWED_HOSTS = Object.freeze(['spotify.com', 'scdn.co', 'spotifycdn.com', 'accounts.google.com', 'appleid.apple.com', 'facebook.com']);
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.5;
/** Page height (CSS px) the web player lays out comfortably at zoom 1; the zoom keeps that proportion in any stage. */
const REFERENCE_HEIGHT = 800;

/** True for https URLs on an allowed host or one of its subdomains. */
function isAllowedUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/** Validates renderer-supplied bounds (CSS px of the stage) into whole, positive numbers; null when unusable. */
function normaliseBounds(bounds, limit = { width: 8192, height: 8192 }) {
  if (!bounds || typeof bounds !== 'object') return null;
  const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((key) => Math.round(Number(bounds[key])));
  if (![x, y, width, height].every(Number.isFinite) || width < 200 || height < 160) return null;
  if (width > limit.width || height > limit.height || x < -limit.width || y < -limit.height) return null;
  return { x, y, width, height };
}

/** Zoom that makes the page lay out as if it had `REFERENCE_HEIGHT` px of height, clamped for TVs and small stages. */
function zoomFor(bounds) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((bounds.height / REFERENCE_HEIGHT) * 100) / 100));
}

/** User agent without the Electron and app tokens, so the web player does not reject the browser as unsupported. */
function cleanUserAgent(userAgent) {
  return String(userAgent).replace(/\s(?:Electron|home-media-launcher|vibepollo)\/\S+/gi, '').trim();
}

module.exports = { START_URL, PARTITION, ALLOWED_HOSTS, isAllowedUrl, normaliseBounds, zoomFor, cleanUserAgent };
