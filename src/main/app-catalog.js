'use strict';

/**
 * Builds the visible tile list and the Settings > Applications catalogue.
 *
 * selectedAppIds / hiddenAppIds semantics:
 *  - local (desktop / Start menu) apps are opt-in: visible only when listed in `selectedAppIds`;
 *  - remote (Vibepollo / Moonlight) apps are opt-out: visible unless listed in `hiddenAppIds`;
 *  - an id present in `selectedAppIds` is always visible, even if a stale `hiddenAppIds` entry exists.
 * `availableApps[].selected` mirrors the effective visibility so checkbox UIs need no extra knowledge.
 *
 * @param {Array<{ id: string }>} customTiles always visible
 * @param {Array<{ id: string, name?: string, provider?: string }>} discoveredTiles
 * @param {string[]} [selectedAppIds]
 * @param {string[]} [hiddenAppIds]
 */
function buildAppCatalog(customTiles, discoveredTiles, selectedAppIds = [], hiddenAppIds = []) {
  const selectedIds = new Set(selectedAppIds);
  const hiddenIds = new Set(hiddenAppIds);
  const isShown = (tile) => selectedIds.has(tile.id) || (tile.provider === 'remote' && !hiddenIds.has(tile.id));
  const visible = new Map();
  for (const tile of customTiles) if (!visible.has(tile.id)) visible.set(tile.id, tile);
  for (const tile of discoveredTiles) if (isShown(tile) && !visible.has(tile.id)) visible.set(tile.id, tile);
  return {
    visibleTiles: [...visible.values()],
    availableApps: discoveredTiles.map((tile) => ({
      id: tile.id,
      name: tile.name,
      provider: tile.provider,
      selected: isShown(tile)
    }))
  };
}

/**
 * Recomputes `hiddenAppIds` when the settings page saves its checkbox state (which only carries checked ids).
 * Remote apps that are currently known but unchecked become hidden; earlier hidden ids that are not currently
 * known (host offline, no cache) are preserved; re-checked ids are released.
 * @param {string[]} previousHidden
 * @param {Array<{ id: string, provider?: string }>} availableApps
 * @param {string[]} selectedAppIds
 * @returns {string[]}
 */
function computeHiddenAppIds(previousHidden, availableApps, selectedAppIds) {
  const selected = new Set(selectedAppIds);
  const hidden = new Set((previousHidden || []).filter((id) => typeof id === 'string' && !selected.has(id)));
  for (const app of availableApps) if (app.provider === 'remote' && !selected.has(app.id)) hidden.add(app.id);
  return [...hidden];
}

module.exports = { buildAppCatalog, computeHiddenAppIds };
