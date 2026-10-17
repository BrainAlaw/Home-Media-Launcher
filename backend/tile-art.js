'use strict';

const zlib = require('node:zlib');
const { ICON_SIZES } = require('./icon-sizes');

const FONT_STACK = "Inter,'SF Pro Display','Segoe UI Variable Display','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MAX_DECODE_PIXELS = 4 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

/* ------------------------------------------------------------------ colour helpers */

function parseHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const value = match ? parseInt(match[1], 16) : 0x333333;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([red, green, blue]) {
  return `#${[red, green, blue].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear mix of two RGB triples; `amount` 0 keeps `from`, 1 gives `to`. */
function mix(from, to, amount) {
  return from.map((channel, index) => channel + (to[index] - channel) * amount);
}

function luminance([red, green, blue]) { return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255; }

/* ------------------------------------------------------------------ PNG decoding (colour sampling only) */

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const dLeft = Math.abs(estimate - left);
  const dUp = Math.abs(estimate - up);
  const dUpLeft = Math.abs(estimate - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  return dUp <= dUpLeft ? up : upLeft;
}

/**
 * Decodes a non-interlaced PNG (any colour type, 1-16 bit) to RGBA. Returns null for anything
 * unsupported or malformed; callers then fall back to a configured brand colour.
 * @returns {{ width: number, height: number, data: Uint8Array } | null}
 */
function decodePng(body) {
  try {
    if (!Buffer.isBuffer(body) || !body.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    let width = 0; let height = 0; let depth = 0; let type = 0; let interlace = 0;
    let palette = null; let transparency = null;
    const chunks = [];
    for (let offset = 8; offset + 8 <= body.length;) {
      const length = body.readUInt32BE(offset);
      const name = body.toString('ascii', offset + 4, offset + 8);
      const data = body.subarray(offset + 8, offset + 8 + length);
      if (name === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
      else if (name === 'PLTE') palette = data;
      else if (name === 'tRNS') transparency = data;
      else if (name === 'IDAT') chunks.push(data);
      else if (name === 'IEND') break;
      offset += 12 + length;
    }
    if (!width || !height || interlace || width * height > MAX_DECODE_PIXELS || !chunks.length) return null;
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    if (!channels || (type === 3 && !palette)) return null;
    const bitsPerPixel = channels * depth;
    const stride = Math.ceil((width * bitsPerPixel) / 8);
    const step = Math.max(1, bitsPerPixel >> 3);
    const raw = zlib.inflateSync(Buffer.concat(chunks));
    if (raw.length < (stride + 1) * height) return null;
    const rows = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y += 1) {
      const filter = raw[y * (stride + 1)];
      const source = y * (stride + 1) + 1;
      const target = y * stride;
      for (let x = 0; x < stride; x += 1) {
        const left = x >= step ? rows[target + x - step] : 0;
        const up = y > 0 ? rows[target - stride + x] : 0;
        const upLeft = y > 0 && x >= step ? rows[target - stride + x - step] : 0;
        const value = raw[source + x];
        let result;
        if (filter === 0) result = value;
        else if (filter === 1) result = value + left;
        else if (filter === 2) result = value + up;
        else if (filter === 3) result = value + ((left + up) >> 1);
        else if (filter === 4) result = value + paeth(left, up, upLeft);
        else return null;
        rows[target + x] = result & 255;
      }
    }
    const data = new Uint8Array(width * height * 4);
    const sample = (y, index) => {
      if (depth === 8) return rows[y * stride + index];
      if (depth === 16) return rows[y * stride + index * 2];
      const bit = index * depth;
      const byte = rows[y * stride + (bit >> 3)];
      return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    };
    const scale = depth < 8 && type !== 3 ? 255 / ((1 << depth) - 1) : 1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const out = (y * width + x) * 4;
        if (type === 3) {
          const entry = sample(y, x);
          data[out] = palette[entry * 3]; data[out + 1] = palette[entry * 3 + 1]; data[out + 2] = palette[entry * 3 + 2];
          data[out + 3] = transparency && entry < transparency.length ? transparency[entry] : 255;
        } else if (type === 0 || type === 4) {
          const grey = sample(y, x * channels) * scale;
          data[out] = grey; data[out + 1] = grey; data[out + 2] = grey;
          data[out + 3] = type === 4 ? sample(y, x * channels + 1) : 255;
        } else {
          data[out] = sample(y, x * channels); data[out + 1] = sample(y, x * channels + 1); data[out + 2] = sample(y, x * channels + 2);
          data[out + 3] = type === 6 ? sample(y, x * channels + 3) : 255;
        }
      }
    }
    return { width, height, data };
  } catch { return null; }
}

/**
 * Analyses decoded pixels: the dominant saturated colour (null for monochrome icons), the mean
 * luminance of the visible pixels and whether the corners are transparent (glyph on nothing).
 */
function analyseImage(image) {
  if (!image) return { color: null, luminance: 0.5, transparent: false };
  const { width, height, data } = image;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 6000)));
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, red: 0, green: 0, blue: 0 }));
  let visible = 0; let luminanceSum = 0; let counted = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = (y * width + x) * 4;
      counted += 1;
      if (data[index + 3] < 200) continue;
      const red = data[index]; const green = data[index + 1]; const blue = data[index + 2];
      visible += 1;
      luminanceSum += luminance([red, green, blue]);
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const value = max / 255;
      if (saturation < 0.3 || value < 0.25) continue;
      let hue;
      if (max === min) hue = 0;
      else if (max === red) hue = ((green - blue) / (max - min) + 6) % 6;
      else if (max === green) hue = (blue - red) / (max - min) + 2;
      else hue = (red - green) / (max - min) + 4;
      const bin = bins[Math.floor((hue / 6) * 24) % 24];
      const weight = saturation * value;
      bin.weight += weight; bin.red += red * weight; bin.green += green * weight; bin.blue += blue * weight;
    }
  }
  const best = bins.reduce((top, bin) => (bin.weight > top.weight ? bin : top), bins[0]);
  const corner = (px, py) => data[(py * width + px) * 4 + 3] < 128;
  const transparent = corner(0, 0) && corner(width - 1, 0) && corner(0, height - 1) && corner(width - 1, height - 1);
  return {
    color: best.weight > counted * 0.04 ? toHex([best.red / best.weight, best.green / best.weight, best.blue / best.weight]) : null,
    luminance: visible ? luminanceSum / visible : 0.5,
    transparent
  };
}

/* ------------------------------------------------------------------ SVG composition */

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

/** Closed superellipse ("squircle", exponent 5) approximating Apple's continuous corners. */
function squirclePath(x, y, size, exponent = 5, segments = 96) {
  const half = size / 2;
  const points = [];
  for (let step = 0; step < segments; step += 1) {
    const angle = (step / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const px = x + half + half * Math.sign(cos) * Math.abs(cos) ** (2 / exponent);
    const py = y + half + half * Math.sign(sin) * Math.abs(sin) ** (2 / exponent);
    points.push(`${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

/** One to three characters shown when no real icon is available. */
function monogramText(name, override) {
  if (typeof override === 'string' && override.trim()) return override.trim().slice(0, 3);
  const words = String(name || '?').trim().split(/[\s\-_.]+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] || '').join('');
  return (initials || '?').toUpperCase();
}

/**
 * Premium 16:9 tile: soft brand gradient, a centred continuous-corner icon (about 40% of the height)
 * with a subtle shadow. Without `iconDataUrl` the icon slot holds a frosted typographic monogram.
 * Pure SVG (no native image dependencies), safe to load through an <img>.
 *
 * With `logoDataUrl` (a wide, usually transparent logo) the logo is shown contained and centred on the gradient instead of an icon squircle.
 *
 * @param {{ name: string, mono?: string, color?: string, iconDataUrl?: string | null, logoDataUrl?: string | null, iconLuminance?: number, iconTransparent?: boolean, width?: number, height?: number }} options
 * @returns {string}
 */
function composeTile({ name, mono, color = '#3a3f4b', iconDataUrl = null, logoDataUrl = null, iconLuminance = 0.5, iconTransparent = false, width = ICON_SIZES.tile.width, height = ICON_SIZES.tile.height }) {
  const base = parseHex(color);
  const top = toHex(mix(base, [255, 255, 255], 0.22));
  const bottom = toHex(mix(base, [0, 0, 0], 0.5));
  const size = Math.round(height * 0.4);
  const x = Math.round((width - size) / 2);
  const y = Math.round((height - size) / 2);
  const path = squirclePath(x, y, size);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    '<defs>',
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.55" stop-color="${toHex(base)}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`,
    '<radialGradient id="glow" cx="0.2" cy="0.1" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
    '<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>',
    '<filter id="shadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.42"/></filter>',
    `<clipPath id="clip"><path d="${path}"/></clipPath>`,
    '</defs>',
    `<rect width="${width}" height="${height}" fill="url(#bg)"/>`,
    `<rect width="${width}" height="${height}" fill="url(#glow)"/>`
  ];
  if (logoDataUrl) {
    const boxWidth = Math.round(width * 0.62);
    const boxHeight = Math.round(height * (width === height ? 0.5 : 0.4));
    const logoX = Math.round((width - boxWidth) / 2);
    const logoY = Math.round((height - boxHeight) / 2);
    parts.push(`<image href="${logoDataUrl}" xlink:href="${logoDataUrl}" x="${logoX}" y="${logoY}" width="${boxWidth}" height="${boxHeight}" preserveAspectRatio="xMidYMid meet" filter="url(#shadow)"/>`);
  } else if (iconDataUrl) {
    const backing = iconTransparent ? (iconLuminance > 0.6 ? '#1c1c21' : '#ffffff') : '#ffffff';
    parts.push(
      `<path d="${path}" fill="${backing}" filter="url(#shadow)"/>`,
      `<image href="${iconDataUrl}" xlink:href="${iconDataUrl}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip)"/>`,
      `<path d="${path}" fill="url(#sheen)"/>`,
      `<path d="${path}" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="2"/>`
    );
  } else {
    const text = monogramText(name, mono);
    const fontSize = Math.round(size * ({ 1: 0.56, 2: 0.44, 3: 0.34 }[text.length] || 0.34));
    parts.push(
      `<path d="${path}" fill="#fff" fill-opacity="0.16" filter="url(#shadow)"/>`,
      `<path d="${path}" fill="url(#sheen)"/>`,
      `<path d="${path}" fill="none" stroke="#fff" stroke-opacity="0.34" stroke-width="2"/>`,
      `<text x="${width / 2}" y="${height / 2}" dy="0.35em" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="${fontSize}" letter-spacing="${-Math.round(fontSize * 0.02)}" fill="#fff">${escapeXml(text)}</text>`
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

module.exports = { composeTile, squirclePath, monogramText, decodePng, analyseImage, parseHex, toHex, mix, FONT_STACK };
