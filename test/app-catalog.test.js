'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAppCatalog } = require('../src/main/app-catalog');

test('discovered applications remain hidden until selected', () => {
  const custom = [{ id: 'custom:one', name: 'Custom' }];
  const discovered = [{ id: 'windows:one', name: 'Local', provider: 'local' }];
  const catalog = buildAppCatalog(custom, discovered, []);
  assert.deepEqual(catalog.visibleTiles, custom);
  assert.equal(catalog.availableApps[0].selected, false);
});

test('selected discovered application becomes visible', () => {
  const discovered = [{ id: 'remote:one', name: 'Remote', provider: 'remote' }];
  const catalog = buildAppCatalog([], discovered, ['remote:one']);
  assert.equal(catalog.visibleTiles[0].id, 'remote:one');
  assert.equal(catalog.availableApps[0].selected, true);
});
