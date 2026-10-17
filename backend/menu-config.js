'use strict';

const schema = require('./menu.schema.json');
const { validateJsonSchema } = require('./theme-validation');

const DEFAULT_MENU = {
  version: 1, layout: 'top-bar',
  groups: [{ id: 'main', label: 'Main', items: [
    { id: 'home', label: 'Home', action: 'home' },
    { id: 'library', label: 'Library', action: 'library' },
    { id: 'settings', label: 'Settings', action: 'settings' }
  ] }],
  slideshow: { enabled: false, lookAhead: 4, intervalMs: 10000, assets: [] }
};

function validateMenu(menu) {
  validateJsonSchema(menu, schema);
  const groups = new Set();
  const items = new Set();
  for (const group of menu.groups) {
    if (groups.has(group.id) || !group.label.trim()) throw new Error('Menu groups require unique IDs and nonblank labels');
    groups.add(group.id);
    for (const item of group.items) {
      if (items.has(item.id) || !item.label.trim()) throw new Error('Menu items require globally unique IDs and nonblank labels');
      items.add(item.id);
      if (item.action === 'category' && !item.category?.trim()) throw new Error('Category menu items require a category');
    }
  }
  return menu;
}

function resolveMenu(menu) { return structuredClone(menu === undefined ? DEFAULT_MENU : validateMenu(menu)); }

module.exports = { validateMenu, resolveMenu };
