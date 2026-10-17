(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TileAccent = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SAMPLE_SIZE = 16;

  /**
   * Dominant brand colour of an RGBA pixel buffer: a saturation-weighted circular mean of the hue, ignoring
   * transparent, near-black and near-white pixels (backgrounds, shadows, highlights).
   * @param {ArrayLike<number>} data RGBA bytes
   * @returns {{ hue: number, saturation: number } | null} hue 0-359, saturation 0-1; null when the image has no colour
   */
  function accentFromPixels(data) {
    let x = 0;
    let y = 0;
    let weight = 0;
    let saturationSum = 0;
    for (let index = 0; index + 3 < data.length; index += 4) {
      const alpha = data[index + 3] / 255;
      if (alpha < 0.4) continue;
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lightness = (max + min) / 2;
      const chroma = max - min;
      if (chroma < 0.12 || lightness < 0.1 || lightness > 0.93) continue;
      let hue;
      if (max === r) hue = ((g - b) / chroma + 6) % 6;
      else if (max === g) hue = (b - r) / chroma + 2;
      else hue = (r - g) / chroma + 4;
      const radians = (hue * Math.PI) / 3;
      const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
      const w = alpha * saturation * saturation;
      x += Math.cos(radians) * w;
      y += Math.sin(radians) * w;
      saturationSum += saturation * w;
      weight += w;
    }
    if (weight < 0.5) return null;
    return {
      hue: Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360),
      saturation: Math.min(1, saturationSum / weight)
    };
  }

  /** CSS colour for the tile glow: always bright enough to read on OLED, never harsh. */
  function accentCss(accent) {
    const saturation = Math.round(Math.min(85, Math.max(55, accent.saturation * 100)));
    return `hsl(${accent.hue} ${saturation}% 56%)`;
  }

  /**
   * Sample a loaded image on a tiny canvas. Returns null when the canvas is tainted (cross-origin art) or the image
   * is monochrome, in which case the CSS keeps its name-derived hue.
   * @param {HTMLImageElement} image
   * @param {Document} [doc]
   */
  function sampleImage(image, doc = document) {
    try {
      const canvas = doc.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      return accentFromPixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
    } catch {
      return null;
    }
  }

  return { accentFromPixels, accentCss, sampleImage };
});
