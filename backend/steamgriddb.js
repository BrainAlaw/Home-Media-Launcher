'use strict';

const { requestBuffer: defaultRequestBuffer } = require('./network');
const { ICON_SIZES } = require('./icon-sizes');

const API = 'https://www.steamgriddb.com/api/v2';
const ART_KINDS = Object.freeze(['poster', 'hero', 'icon', 'logo']);

const ENDPOINT = Object.freeze({ poster: 'grids', hero: 'heroes', icon: 'icons', logo: 'logos' });
const DIMENSIONS = Object.freeze({
  poster: `${ICON_SIZES.poster.width}x${ICON_SIZES.poster.height}`,
  hero: `${ICON_SIZES.hero.width}x${ICON_SIZES.hero.height}`
});

function isSteamGridDbImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'steamgriddb.com' || url.hostname.endsWith('.steamgriddb.com'));
  } catch { return false; }
}

/** SteamGridDB API v2 client. The key is only ever sent in the Authorization header of main-process requests. */
function createSteamGridDb({ apiKey, requestBuffer = defaultRequestBuffer }) {
  async function get(route) {
    const { body } = await requestBuffer(`${API}${route}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` }, timeoutMs: 8000, maxBytes: 2097152
    });
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch { throw new Error('SteamGridDB returned invalid JSON'); }
    if (payload && payload.success === false) throw new Error('SteamGridDB request failed');
    return Array.isArray(payload && payload.data) ? payload.data : [];
  }

  const search = (term) => get(`/search/autocomplete/${encodeURIComponent(term)}`);

  function artRoute(art, { gameId, steamAppId }, withDimensions) {
    const scope = steamAppId ? `steam/${Number(steamAppId)}` : `game/${Number(gameId)}`;
    const params = ['nsfw=false', 'types=static'];
    if (withDimensions && DIMENSIONS[art]) params.push(`dimensions=${DIMENSIONS[art]}`);
    return `/${ENDPOINT[art]}/${scope}?${params.join('&')}`;
  }

  /** Candidate images for one game; falls back to an unfiltered query when no exact-size art exists. */
  async function images(art, target, limit = 12) {
    if (!ART_KINDS.includes(art)) throw new Error('Unknown artwork kind');
    let list = await get(artRoute(art, target, true));
    if (!list.length && DIMENSIONS[art]) list = await get(artRoute(art, target, false));
    return list.filter((entry) => isSteamGridDbImage(entry && entry.url)).slice(0, limit).map((entry) => ({
      id: Number(entry.id), art, url: entry.url, thumb: isSteamGridDbImage(entry.thumb) ? entry.thumb : entry.url,
      width: Number(entry.width) || undefined, height: Number(entry.height) || undefined
    }));
  }

  return { search, images };
}

module.exports = { ART_KINDS, createSteamGridDb, isSteamGridDbImage };
