'use strict';

function buildAppCatalog(customTiles, discoveredTiles, selectedAppIds = []) {
  const selectedIds = new Set(selectedAppIds);
  const visible = new Map();
  for (const tile of customTiles) if (!visible.has(tile.id)) visible.set(tile.id, tile);
  for (const tile of discoveredTiles) if (selectedIds.has(tile.id) && !visible.has(tile.id)) visible.set(tile.id, tile);
  return {
    visibleTiles: [...visible.values()],
    availableApps: discoveredTiles.map((tile) => ({
      id: tile.id,
      name: tile.name,
      provider: tile.provider,
      selected: selectedIds.has(tile.id)
    }))
  };
}

module.exports = { buildAppCatalog };
