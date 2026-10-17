'use strict';

// Regenerates the bundled fallback tiles (gradient + typographic monogram) in src/renderer/icons/presets.
// Run after changing backend/tile-art.js or the preset list: node scripts/build-preset-tiles.js
const fs = require('node:fs');
const path = require('node:path');
const { PRESET_DIRECTORY, listPresets, getPresetSources } = require('../backend/web-presets');
const { composeTile } = require('../backend/tile-art');

function bundledTile(id) {
  const sources = getPresetSources(id);
  return composeTile({ name: sources.name, mono: sources.mono, color: sources.color });
}

if (require.main === module) {
  for (const preset of listPresets()) fs.writeFileSync(path.join(PRESET_DIRECTORY, `${preset.id}.svg`), `${bundledTile(preset.id)}\n`);
  console.log(`Wrote ${listPresets().length} tiles to ${PRESET_DIRECTORY}`);
}

module.exports = { bundledTile };
