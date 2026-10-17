'use strict';

const path = require('node:path');
const { atomicWrite, readJson, serialize } = require('./storage');
const { cacheArtwork } = require('./artwork');

class LocalState {
  constructor(directory) {
    this.file = path.join(directory, 'icon-overrides.json');
    this.artworkDirectory = path.join(directory, 'artwork');
  }

  async icons() {
    const state = await readJson(this.file, { icons: {} });
    return state && state.icons && typeof state.icons === 'object' && !Array.isArray(state.icons) ? state.icons : {};
  }

  async setIcon(id, source) {
    if (typeof id !== 'string' || !id || id.length > 1024 || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid application ID');
    if (typeof source !== 'string') throw new Error('Icon source must be a string');
    const icon = source ? await cacheArtwork(source, this.artworkDirectory) : '';
    return serialize(this.file, async () => {
      const icons = await this.icons();
      if (icon) icons[id] = icon;
      else delete icons[id];
      await atomicWrite(this.file, JSON.stringify({ version: 1, icons }));
      return icon;
    });
  }
}

module.exports = { LocalState };
