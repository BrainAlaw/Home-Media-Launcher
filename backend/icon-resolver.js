'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { atomicWrite, readJson, serialize } = require('./storage');
const { cacheArtwork, imageExtension, pruneArtwork } = require('./artwork');
const { matchPresetByHostname, getPresetSources, PRESET_DIRECTORY } = require('./web-presets');
const { composeTile, decodePng, analyseImage, glyphForName, toHex } = require('./tile-art');
const { requestBuffer: defaultRequestBuffer } = require('./network');
const { createSiteFetcher } = require('./site-fetch');
const { createSteamGridDb, isSteamGridDbImage, MIN_ICON_EDGE: MIN_GAME_ICON_EDGE } = require('./steamgriddb');
const { ICON_SIZES, MIN_SITE_ICON_EDGE } = require('./icon-sizes');

const CACHE_TTL_MS = 14 * 24 * 3600 * 1000;
const NEGATIVE_TTL_MS = 6 * 3600 * 1000;
const MAX_INDEX_ENTRIES = 400;
const MAX_SVG_BYTES = 256 * 1024;
const MAX_SITE_ATTEMPTS = 4;
const MAX_PRESET_ATTEMPTS = 8;
const MAX_LOGO_EMBED_BYTES = 180 * 1024;
/** A fetched icon smaller than this looks blurry at 40% of a 720p tile, so the monogram tile is used instead. */
const MIN_PRESET_ICON_EDGE = 128;
const MAX_PRESET_ICON_BYTES = 900 * 1024;
/** Posters and heroes are embedded into the composed tile as base64, so larger downloads are skipped. */
const MAX_GAME_ART_BYTES = 600 * 1024;
const GAME_FILE = /^[0-9a-f]{64}\.svg$/;
const PRESET_FILE = /^[a-z0-9-]+\.svg$/;
const MIME_BY_EXTENSION = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' });
const SVG_FILE = /^[0-9a-f]{64}\.svg$/;
const KINDS = new Set(['website', 'game', 'app']);
const ART_BY_KIND = Object.freeze({ website: 'icon', app: 'icon', game: 'poster' });

/* ------------------------------------------------------------------ pure helpers */

function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) attributes[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '').replace(/&amp;/g, '&');
  return attributes;
}

/** Largest edge from a `sizes` attribute ("48x48 192x192", "any"); 0 when unknown. */
function largestDeclaredSize(sizes) {
  let best = 0;
  for (const token of String(sizes || '').toLowerCase().split(/\s+/)) {
    const match = /^(\d+)x(\d+)$/.exec(token);
    if (match) best = Math.max(best, Math.min(Number(match[1]), Number(match[2])));
    else if (token === 'any') best = Math.max(best, 512);
  }
  return best;
}

function resolveHref(href, base) {
  try {
    const url = new URL(href, base);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function candidateScore(candidate) {
  const declared = candidate.size || (candidate.svg ? 512 : candidate.apple ? 180 : candidate.ico ? 16 : 32);
  return Math.min(declared, 1024) + (candidate.svg ? 1 : 0) + (candidate.apple ? 0.5 : 0);
}

/** Collects icon candidates from `<link>` tags (apple-touch-icon, icon, manifest href). */
function parseHtmlIcons(html, baseUrl) {
  const candidates = [];
  let manifest = null;
  for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag);
    const rel = (attributes.rel || '').toLowerCase().split(/\s+/);
    if (!attributes.href) continue;
    const url = resolveHref(attributes.href, baseUrl);
    if (!url) continue;
    if (rel.includes('manifest')) { manifest = url; continue; }
    const apple = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!apple && !rel.includes('icon')) continue;
    const svg = /image\/svg/i.test(attributes.type || '') || /\.svg(\?|$)/i.test(url);
    candidates.push({ url, size: largestDeclaredSize(attributes.sizes), svg, apple, ico: /\.ico(\?|$)/i.test(url) });
  }
  return { candidates, manifest };
}

function parseManifestIcons(manifest, baseUrl) {
  const icons = Array.isArray(manifest?.icons) ? manifest.icons : [];
  const candidates = [];
  for (const icon of icons) {
    if (!icon || typeof icon.src !== 'string' || /maskable/.test(icon.purpose || '') && !/any/.test(icon.purpose || '')) continue;
    const url = resolveHref(icon.src, baseUrl);
    if (!url) continue;
    const svg = /image\/svg/i.test(icon.type || '') || /\.svg(\?|$)/i.test(url);
    candidates.push({ url, size: largestDeclaredSize(icon.sizes), svg, apple: false, ico: /\.ico(\?|$)/i.test(url) });
  }
  return candidates;
}

function rankCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => !seen.has(candidate.url) && seen.add(candidate.url))
    .sort((left, right) => candidateScore(right) - candidateScore(left));
}

/** Reads width/height from PNG, JPEG and GIF headers; undefined when unknown. */
function imageSize(body) {
  try {
    if (body.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
    if (body.toString('ascii', 0, 3) === 'GIF') return { width: body.readUInt16LE(6), height: body.readUInt16LE(8) };
    if (body[0] === 0xff && body[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < body.length) {
        if (body[offset] !== 0xff) { offset += 1; continue; }
        const marker = body[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: body.readUInt16BE(offset + 5), width: body.readUInt16BE(offset + 7) };
        offset += 2 + body.readUInt16BE(offset + 2);
      }
    }
  } catch { /* Truncated header: size stays unknown. */ }
  return {};
}

/** Returns the SVG text when it is a self-contained, script-free SVG document; otherwise null. */
function sanitizeSvg(body) {
  if (body.length > MAX_SVG_BYTES) return null;
  const text = body.toString('utf8').replace(/^﻿/, '').trim();
  if (!/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) return null;
  if (/<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|javascript:|\son[a-z]+\s*=/i.test(text)) return null;
  for (const match of text.matchAll(/(?:xlink:)?href\s*=\s*(["'])\s*([^"']*)\1/gi)) {
    const target = match[2];
    if (!target.startsWith('#') && !/^data:image\/(png|jpeg|webp|gif);/i.test(target)) return null;
  }
  return text;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

/** Deterministic coloured tile with the first letter of the name; returned as a data URL (never written to disk). */
function letterTile(name, kind = 'app') {
  const label = String(name || '?').trim();
  const letter = (label.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();
  const hash = createHash('sha256').update(label.toLowerCase()).digest();
  const hue = (hash[0] * 256 + hash[1]) % 360;
  const poster = kind === 'game';
  const width = poster ? ICON_SIZES.poster.width : ICON_SIZES.appIcon.width;
  const height = poster ? ICON_SIZES.poster.height : ICON_SIZES.appIcon.height;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},62%,46%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},58%,30%)"/></linearGradient></defs>`
    + `<rect width="${width}" height="${height}" rx="${poster ? 24 : 96}" fill="url(#g)"/>`
    + `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${Math.round(Math.min(width, height) * 0.5)}" fill="#fff">${escapeXml(letter)}</text></svg>`;
  return { source: 'letter', url: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, width, height };
}

/** Deterministic dark-ish brand colour for names without a sampled colour. */
function nameColor(name) {
  const hash = createHash('sha256').update(String(name).toLowerCase()).digest();
  const hue = ((hash[0] * 256 + hash[1]) % 360) / 360;
  const saturation = 0.55;
  const lightness = 0.36;
  const amount = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset) => { const k = (offset + hue * 12) % 12; return lightness - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return toHex([channel(0) * 255, channel(8) * 255, channel(4) * 255]);
}

function normaliseRequest(request) {
  if (!request || typeof request !== 'object') throw new Error('Icon request must be an object');
  const kind = request.kind;
  if (!KINDS.has(kind)) throw new Error('Icon request kind must be website, game or app');
  const name = typeof request.name === 'string' ? request.name.trim().slice(0, 200) : '';
  if (!name && !request.url) throw new Error('Icon request needs a name or a URL');
  let url = null;
  if (typeof request.url === 'string' && request.url.trim()) {
    try { url = new URL(request.url.trim()); } catch { throw new Error('Icon request URL is invalid'); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Icon request URL must use HTTP or HTTPS');
  }
  const steamAppId = Number.isSafeInteger(request.steamAppId) && request.steamAppId > 0 ? request.steamAppId : undefined;
  const art = ['poster', 'hero', 'icon', 'logo'].includes(request.art) ? request.art : ART_BY_KIND[kind];
  return { kind, name: name || url.hostname, url, steamAppId, art };
}

/* ------------------------------------------------------------------ resolver */

/**
 * Icon resolver. Order: bundled preset (hostname) -> the site's own manifest/link icons ->
 * SteamGridDB (games) -> Playnite/Vibepollo cache -> generated letter tile.
 *
 * Options (all injectable for tests): `userData`, `secrets` (steamGridDbKey stays in this process),
 * `trustedHosts()` (hosts exempt from the private-address guard), `fetchSite`, `requestBuffer`, `now`.
 */
function createIconResolver({ userData, secrets = {}, trustedHosts = () => [], fetchSite, requestBuffer, now = Date.now, onArt = () => {} } = {}) {
  const notify = (event) => { try { onArt(event); } catch { /* Listeners must never break artwork resolution. */ } };
  if (!userData) throw new Error('userData directory is required');
  const directory = path.join(userData, 'icon-cache');
  const indexFile = path.join(directory, 'index.json');
  const playniteFile = path.join(userData, 'remote-apps.json');
  const fetcher = fetchSite || createSiteFetcher({ trustedHosts });
  const negative = new Map();
  const grid = secrets.steamGridDbKey ? createSteamGridDb({ apiKey: secrets.steamGridDbKey, requestBuffer }) : null;

  async function readIndex() {
    const index = await readJson(indexFile, { entries: {} });
    return index && typeof index.entries === 'object' && index.entries ? index : { entries: {} };
  }

  async function remember(key, result) {
    await serialize(indexFile, async () => {
      const index = await readIndex();
      index.entries[key] = { result, at: now() };
      await atomicWrite(indexFile, JSON.stringify({ version: 1, entries: index.entries }));
    });
  }

  async function cachedResult(key) {
    const entry = (await readIndex()).entries[key];
    if (!entry || now() - entry.at > CACHE_TTL_MS) return null;
    try {
      await fs.access(fileURLToPath(entry.result.url));
      return entry.result;
    } catch { return null; }
  }

  async function storeBuffer(body) {
    const svg = sanitizeSvg(body);
    if (svg) {
      const file = path.join(directory, `${createHash('sha256').update(svg).digest('hex')}.svg`);
      await serialize(file, async () => { try { await fs.access(file); } catch { await atomicWrite(file, svg); } });
      return { url: pathToFileURL(file).href, width: undefined, height: undefined };
    }
    imageExtension(body); // Throws for anything that is not a supported raster image.
    const url = await cacheArtwork(`data:image/png;base64,${body.toString('base64')}`, directory);
    return { url, ...imageSize(body) };
  }

  async function siteCandidates(url) {
    const origin = new URL(url.origin);
    const page = await fetcher(new URL('/', origin).href, { maxBytes: 524288, truncate: true, accept: 'text/html,*/*;q=0.5' }).catch(() => null);
    let candidates = [];
    if (page) {
      const parsed = parseHtmlIcons(page.body.toString('utf8'), page.url);
      candidates = parsed.candidates;
      if (parsed.manifest) {
        const manifest = await fetcher(parsed.manifest, { maxBytes: 262144, accept: 'application/manifest+json,application/json,*/*;q=0.5' }).catch(() => null);
        if (manifest) {
          try { candidates = candidates.concat(parseManifestIcons(JSON.parse(manifest.body.toString('utf8')), manifest.url)); } catch { /* Invalid manifest: ignore. */ }
        }
      }
    }
    candidates.push({ url: new URL('/apple-touch-icon.png', origin).href, size: 180, svg: false, apple: true, ico: false });
    candidates.push({ url: new URL('/favicon.ico', origin).href, size: 0, svg: false, apple: false, ico: true });
    return rankCandidates(candidates);
  }

  async function fromSite(url) {
    if (url.protocol !== 'https:') return null;
    const candidates = await siteCandidates(url);
    let fallback = null;
    for (const candidate of candidates.slice(0, MAX_SITE_ATTEMPTS)) {
      try {
        const { body } = await fetcher(candidate.url, { maxBytes: 2097152, accept: 'image/*,*/*;q=0.5' });
        const stored = await storeBuffer(body);
        const result = { source: 'site', url: stored.url, width: stored.width || candidate.size || undefined, height: stored.height || candidate.size || undefined };
        const edge = Math.min(result.width || MIN_SITE_ICON_EDGE, result.height || MIN_SITE_ICON_EDGE);
        if (edge >= MIN_SITE_ICON_EDGE) return result;
        fallback = fallback || result;
      } catch { /* Try the next candidate. */ }
    }
    return fallback;
  }

  /* ---------------------------------------------------------------- preset tile art */

  const presetDirectory = path.join(directory, 'presets');
  const presetPending = new Map();

  const bundledPresetUrl = (id) => pathToFileURL(path.join(PRESET_DIRECTORY, `${id}.svg`)).href;

  /** Best icon of the service itself as { dataUrl, body } (raster >= 128 px or a sanitised SVG), or null. */
  async function fetchPresetIcon(sources) {
    let candidates = [];
    for (const page of sources.pages) candidates = candidates.concat(await siteCandidates(new URL(page)).catch(() => []));
    for (const asset of sources.assets) candidates.push({ url: asset, size: 180, svg: false, apple: true, ico: false });
    for (const candidate of rankCandidates(candidates).filter((entry) => !entry.ico).slice(0, MAX_PRESET_ATTEMPTS)) {
      try {
        const { body } = await fetcher(candidate.url, { maxBytes: 2097152, accept: 'image/*,*/*;q=0.5' });
        if (body.length > MAX_PRESET_ICON_BYTES) continue;
        const svg = sanitizeSvg(body);
        if (svg) return { dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, body: null };
        const mime = MIME_BY_EXTENSION[imageExtension(body)];
        if (!mime) continue;
        const size = imageSize(body);
        const edge = Math.min(size.width || candidate.size || 0, size.height || candidate.size || 0);
        if (edge >= MIN_PRESET_ICON_EDGE) return { dataUrl: `data:${mime};base64,${body.toString('base64')}`, body };
      } catch { /* Blocked, missing or not an image: try the next candidate. */ }
    }
    return null;
  }

  async function buildPresetTile(id) {
    const sources = getPresetSources(id);
    const icon = await fetchPresetIcon(sources);
    if (!icon) return null;
    const analysis = analyseImage(icon.body ? decodePng(icon.body) : null);
    const svg = composeTile({
      name: sources.name, mono: sources.mono, color: analysis.color || sources.color,
      iconDataUrl: icon.dataUrl, iconLuminance: analysis.luminance, iconTransparent: analysis.transparent
    });
    const file = path.join(presetDirectory, `${id}.svg`);
    await serialize(file, () => atomicWrite(file, svg));
    const url = pathToFileURL(file).href;
    notify({ kind: 'preset', id, url });
    return url;
  }

  async function freshPresetTile(id) {
    const file = path.join(presetDirectory, `${id}.svg`);
    try {
      const stats = await fs.stat(file);
      return Date.now() - stats.mtimeMs <= CACHE_TTL_MS ? pathToFileURL(file).href : null;
    } catch { return null; }
  }

  /**
   * File URL of the 16:9 tile art for a preset: the composed tile built from the service's own icon
   * (cached 14 days) or the bundled monogram tile when the service offers no usable icon.
   * Never throws for a known id; failures are not retried for 6 hours.
   */
  async function resolvePresetIcon(id) {
    if (typeof id !== 'string' || !getPresetSources(id)) throw new Error('Unknown preset');
    const cached = await freshPresetTile(id);
    if (cached) return cached;
    const key = `preset|${id}`;
    const failedAt = negative.get(key);
    if (failedAt !== undefined && now() - failedAt <= NEGATIVE_TTL_MS) return bundledPresetUrl(id);
    if (!presetPending.has(key)) {
      presetPending.set(key, buildPresetTile(id).catch(() => null).then((url) => {
        if (!url) negative.set(key, now());
        return url;
      }).finally(() => presetPending.delete(key)));
    }
    return (await presetPending.get(key)) || bundledPresetUrl(id);
  }

  /** Cached or bundled tile art for every id without any network access (instant). */
  async function presetIconMap(ids) {
    const entries = await Promise.all(ids.filter((id) => getPresetSources(id)).map(async (id) => [id, (await freshPresetTile(id)) || bundledPresetUrl(id)]));
    return Object.fromEntries(entries);
  }

  /** Resolves (downloading where needed) the tile art of the given ids, three at a time. */
  async function refreshPresetIcons(ids) {
    const queue = ids.filter((id) => getPresetSources(id));
    const result = {};
    const worker = async () => { for (let id = queue.shift(); id; id = queue.shift()) result[id] = await resolvePresetIcon(id); };
    await Promise.all([worker(), worker(), worker()]);
    return result;
  }

  /* ---------------------------------------------------------------- game tile art (host apps) */

  const gameDirectory = path.join(directory, 'games-poster');
  const gamePending = new Map();
  const gameKey = (name) => createHash('sha256').update(String(name).trim().toLowerCase()).digest('hex');

  async function freshGameTile(name) {
    const file = path.join(gameDirectory, `${gameKey(name)}.svg`);
    try {
      const stats = await fs.stat(file);
      return now() - stats.mtimeMs <= CACHE_TTL_MS ? pathToFileURL(file).href : null;
    } catch { return null; }
  }

  /** First SteamGridDB image of a kind that fits the embed budget, as { dataUrl, body, size }. */
  async function downloadGridImage(art, target) {
    const download = requestBuffer || defaultRequestBuffer;
    for (const image of await grid.images(art, target, 4)) {
     for (const source of [...new Set([image.url, image.thumb])]) {
      try {
        const { body } = await download(source, { maxBytes: MAX_GAME_ART_BYTES, timeoutMs: 8000 });
        const mime = MIME_BY_EXTENSION[imageExtension(body)];
        if (mime) return { dataUrl: `data:${mime};base64,${body.toString('base64')}`, body, size: imageSize(body) };
      } catch { /* Too large, blocked or not an image: try the next candidate. */ }
     }
    }
    return null;
  }

  /** Composes SteamGridDB art (poster edge to edge, else hero crop) into a 2:3 portrait tile; null without art. */
  async function buildGameTile(name) {
    if (!grid) return null;
    const target = await findGame({ name });
    if (!target) return null;
    const poster = await downloadGridImage('poster', target).catch(() => null);
    let svg = null;
    if (poster) {
      const analysis = analyseImage(decodePng(poster.body));
      const aspect = poster.size.width && poster.size.height ? poster.size.width / poster.size.height : 2 / 3;
      svg = composeTile({ name, color: analysis.color || nameColor(name), posterDataUrl: poster.dataUrl, posterAspect: aspect, portrait: true });
    } else {
      const hero = await downloadGridImage('hero', target).catch(() => null);
      if (hero) svg = composeTile({ name, heroDataUrl: hero.dataUrl, portrait: true });
    }
    if (!svg) return null;
    const file = path.join(gameDirectory, `${gameKey(name)}.svg`);
    await serialize(file, () => atomicWrite(file, svg));
    return pathToFileURL(file).href;
  }

  /** Refined monogram / glyph tile as an SVG data URL (no network, nothing written to disk). */
  function monogramGameTile(name) {
    const svg = composeTile({ name, glyph: glyphForName(name), color: nameColor(name), portrait: true });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  /**
   * 2:3 portrait tile art for a host application without cover art. Host built-ins (`builtin: true`, e.g. Desktop, TV)
   * get a glyph tile; other names are looked up on SteamGridDB (cached 14 days, failures retried after 6 hours)
   * and fall back to a monogram tile. Resolves with { url, source: 'steamgriddb' | 'monogram' }, never rejects.
   */
  async function resolveGameTile({ name, builtin } = {}) {
    const label = typeof name === 'string' ? name.trim().slice(0, 200) : '';
    if (!label) return { url: monogramGameTile('?'), source: 'monogram' };
    // Without an explicit host hint, names of well-known Sunshine built-ins (Desktop, TV, ...) never go to SteamGridDB.
    if (builtin === true || (builtin === undefined && glyphForName(label))) return { url: monogramGameTile(label), source: 'monogram' };
    const cached = await freshGameTile(label);
    if (cached) return { url: cached, source: 'steamgriddb' };
    const key = `game|${label.toLowerCase()}`;
    const failedAt = negative.get(key);
    if (failedAt !== undefined && now() - failedAt <= NEGATIVE_TTL_MS) return { url: monogramGameTile(label), source: 'monogram' };
    if (!gamePending.has(key)) {
      gamePending.set(key, buildGameTile(label).catch(() => null).then((url) => {
        if (url) notify({ kind: 'game', name: label, url }); else negative.set(key, now());
        return url;
      }).finally(() => gamePending.delete(key)));
    }
    const url = await gamePending.get(key);
    return url ? { url, source: 'steamgriddb' } : { url: monogramGameTile(label), source: 'monogram' };
  }

  async function findGame(request) {
    if (request.steamAppId) return { steamAppId: request.steamAppId };
    const games = await grid.search(request.name);
    const wanted = request.name.toLowerCase();
    const best = games.find((game) => String(game?.name).toLowerCase() === wanted) || games[0];
    return best?.id ? { gameId: best.id } : null;
  }

  /** A logo composed onto a brand-coloured gradient, stored as SVG; null when the logo is not embeddable. */
  async function composeLogoTile(request, logo) {
    const url = await cacheArtwork(logo.url, directory, { requestBuffer });
    const body = await fs.readFile(fileURLToPath(url));
    const mime = MIME_BY_EXTENSION[imageExtension(body)];
    if (!mime || body.length > MAX_LOGO_EMBED_BYTES) return { url, ...imageSize(body) };
    const analysis = analyseImage(decodePng(body));
    const square = request.art === 'icon';
    const size = square ? ICON_SIZES.appIcon : ICON_SIZES.tile;
    const light = analysis.color === null && analysis.luminance < 0.3;
    const svg = composeTile({
      name: request.name, color: light ? '#c9ced8' : analysis.color || nameColor(request.name),
      logoDataUrl: `data:${mime};base64,${body.toString('base64')}`, width: size.width, height: size.height
    });
    const stored = await storeBuffer(Buffer.from(svg));
    return { url: stored.url, width: size.width, height: size.height };
  }

  async function fromSteamGridDb(request) {
    if (!grid) return null;
    const target = await findGame(request);
    if (!target) return null;
    const [image] = await grid.images(request.art, target, 1);
    if (request.art === 'icon') {
      // Icons are ranked square >= 256 px first; anything smaller loses to a logo on a gradient.
      const sharp = image && Math.min(image.width || 0, image.height || 0) >= MIN_GAME_ICON_EDGE;
      if (!sharp) {
        const [logo] = await grid.images('logo', target, 1).catch(() => []);
        const tile = logo ? await composeLogoTile(request, logo).catch(() => null) : null;
        if (tile) return { source: 'steamgriddb', ...tile };
      }
    } else if (request.art === 'logo' && image) {
      const tile = await composeLogoTile(request, image).catch(() => null);
      if (tile) return { source: 'steamgriddb', ...tile };
    }
    if (!image) return null;
    const url = await cacheArtwork(image.url, directory, { requestBuffer });
    return { source: 'steamgriddb', url, width: image.width, height: image.height };
  }

  async function fromPlaynite(request) {
    const cache = await readJson(playniteFile, null);
    const tiles = Array.isArray(cache?.tiles) ? cache.tiles : [];
    const wanted = request.name.toLowerCase();
    const tile = tiles.find((candidate) => typeof candidate?.name === 'string' && candidate.name.trim().toLowerCase() === wanted);
    if (!tile) return null;
    const field = request.art === 'hero' ? (tile.hero_image || tile.background) : request.art === 'poster' || request.art === 'icon' ? tile.icon : '';
    return typeof field === 'string' && /^(file:|data:image\/)/.test(field) ? { source: 'playnite', url: field } : null;
  }

  async function resolve(rawRequest) {
    const request = normaliseRequest(rawRequest);
    const key = [request.kind, request.art, request.name.toLowerCase(), request.url?.hostname || '', request.steamAppId || ''].join('|');
    if (request.url) {
      const preset = matchPresetByHostname(request.url.hostname);
      if (preset) return { source: 'preset', url: await resolvePresetIcon(preset.id) };
    }
    const cached = await cachedResult(key);
    if (cached) return cached;
    const failedAt = negative.get(key);
    const attempt = failedAt === undefined || now() - failedAt > NEGATIVE_TTL_MS;
    let result = null;
    if (attempt) {
      if (request.kind !== 'game' && request.url) result = await fromSite(request.url).catch(() => null);
      if (!result && request.kind === 'game') result = await fromSteamGridDb(request).catch(() => null);
      if (!result) result = await fromPlaynite(request).catch(() => null);
      if (!result) negative.set(key, now());
    }
    if (result?.source === 'site' || result?.source === 'steamgriddb') {
      await remember(key, result).catch(() => {});
      return result;
    }
    return result || letterTile(request.name, request.kind);
  }

  /** Lists SteamGridDB candidates (top matching games) so the UI can offer a choice. */
  async function searchArtwork(query, art = 'poster') {
    if (!grid) return [];
    const term = typeof query === 'string' ? query.trim().slice(0, 200) : '';
    if (!term) return [];
    if (!['poster', 'hero', 'icon', 'logo'].includes(art)) throw new Error('Unknown artwork kind');
    const games = (await grid.search(term)).filter((game) => game?.id).slice(0, 3);
    const lists = await Promise.all(games.map(async (game) => {
      try { return (await grid.images(art, { gameId: game.id }, 6)).map((image) => ({ ...image, gameId: game.id, gameName: String(game.name || '') })); }
      catch { return []; }
    }));
    return lists.flat().slice(0, 18);
  }

  /** Downloads and caches a candidate the user picked. Only steamgriddb.com HTTPS images are accepted. */
  async function cacheCandidate(imageUrl) {
    if (!isSteamGridDbImage(imageUrl)) throw new Error('Only SteamGridDB images can be cached');
    const url = await cacheArtwork(imageUrl, directory, { requestBuffer });
    return { source: 'steamgriddb', url };
  }

  /** Drops expired index entries and unreferenced cache files older than one hour. */
  async function prune() {
    await serialize(indexFile, async () => {
      const index = await readIndex();
      const entries = Object.entries(index.entries).filter(([, entry]) => now() - entry.at <= CACHE_TTL_MS)
        .sort((left, right) => right[1].at - left[1].at).slice(0, MAX_INDEX_ENTRIES);
      await atomicWrite(indexFile, JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }));
      const urls = entries.map(([, entry]) => entry.result.url);
      await pruneArtwork(directory, urls);
      const keep = new Set(urls.map((url) => { try { return path.basename(fileURLToPath(url)); } catch { return ''; } }));
      let names = [];
      try { names = await fs.readdir(directory); } catch { /* Nothing cached yet. */ }
      for (const name of names) {
        if (!SVG_FILE.test(name) || keep.has(name)) continue;
        const file = path.join(directory, name);
        try { if (Date.now() - (await fs.stat(file)).mtimeMs > 3600000) await fs.rm(file, { force: true }); } catch { /* Retry next time. */ }
      }
      let games = [];
      try { games = await fs.readdir(gameDirectory); } catch { /* No game tiles cached yet. */ }
      for (const name of games) {
        if (!GAME_FILE.test(name)) continue;
        const file = path.join(gameDirectory, name);
        try { if (now() - (await fs.stat(file)).mtimeMs > CACHE_TTL_MS) await fs.rm(file, { force: true }); } catch { /* Retry next time. */ }
      }
      let tiles = [];
      try { tiles = await fs.readdir(presetDirectory); } catch { /* No preset tiles cached yet. */ }
      for (const name of tiles) {
        if (!PRESET_FILE.test(name)) continue;
        const file = path.join(presetDirectory, name);
        try { if (Date.now() - (await fs.stat(file)).mtimeMs > CACHE_TTL_MS) await fs.rm(file, { force: true }); } catch { /* Retry next time. */ }
      }
    });
  }

  return { resolve, resolvePresetIcon, resolveGameTile, presetIconMap, refreshPresetIcons, searchArtwork, cacheCandidate, prune, directory };
}

module.exports = {
  createIconResolver, parseHtmlIcons, parseManifestIcons, rankCandidates, largestDeclaredSize, imageSize, sanitizeSvg, letterTile, normaliseRequest
};
