'use strict';

const { migratePresetIcons } = require('../../backend/web-presets');

/**
 * One-time config clean-up: rewrites legacy absolute preset icon URLs to `preset:<id>` tokens.
 * Saves (via the injected atomic `save`) only when something changed; nothing else is touched.
 * @param {object} config loaded configuration
 * @param {(config: object) => Promise<unknown>} save
 * @returns {Promise<object>} the (possibly new) configuration object
 */
async function migrateConfigPresetIcons(config, save) {
  const websites = migratePresetIcons(config?.websites);
  if (websites === config?.websites) return config;
  const next = { ...config, websites };
  await save(next);
  return next;
}

module.exports = { migrateConfigPresetIcons };
