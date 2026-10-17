'use strict';

/**
 * Extracts the catalogue id from a `launcher:launch-app` payload. The renderer sends an AppLaunchConfig
 * (`{ appId, kind, ... }`); older callers sent `{ id }` / `{ tileId }` or the bare id string.
 * Only the id is trusted; commands and arguments always come from the main-process model.
 * @param {unknown} payload
 * @returns {string | undefined}
 */
function launchIdFrom(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return undefined;
  for (const key of ['appId', 'id', 'tileId']) if (typeof payload[key] === 'string' && payload[key]) return payload[key];
  return undefined;
}

module.exports = { launchIdFrom };
