'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildAppCatalog, computeHiddenAppIds } = require('../src/main/app-catalog');
const { launchIdFrom } = require('../src/main/launch-request');
const { listRemoteApps } = require('../src/main/remote-apps');
const TileModel = require('../src/renderer/tile-model');
const { buildLaunchConfig, createLaunchSession, describeLaunchError } = require('../src/renderer/launch-session');

// The user's real situation: remote enabled, nothing ever selected.
const remoteSettings = { enabled: true, host: '192.168.0.196', apiUrl: 'https://192.168.0.196:47990', allowSelfSigned: true, moonlightPath: 'moonlight' };
const remoteTiles = ['Desktop', 'Steam Big Picture', 'Playnite', 'Cyberpunk', 'Hades'].map((name) => ({
  id: `remote:192.168.0.196:${name}`, name, icon: '', command: 'moonlight', args: ['stream', '192.168.0.196', name], remote: true, provider: 'remote'
}));

test('remote apps are visible by default with an empty selectedAppIds', () => {
  const catalog = buildAppCatalog([], remoteTiles, []);
  assert.equal(catalog.visibleTiles.length, 5);
  assert.ok(catalog.availableApps.every((app) => app.selected));
  const layout = TileModel.buildLayout(catalog.visibleTiles);
  assert.equal(layout.rows.find((row) => row.id === 'gaming').tiles.length, 5);
});

test('hiddenAppIds hides remote apps, selectedAppIds overrides, local stays opt-in', () => {
  const local = { id: 'win:a', name: 'A', provider: 'local' };
  const hiddenId = remoteTiles[0].id;
  let catalog = buildAppCatalog([], [...remoteTiles, local], [], [hiddenId]);
  assert.equal(catalog.visibleTiles.length, 4);
  assert.equal(catalog.availableApps.find((app) => app.id === hiddenId).selected, false);
  catalog = buildAppCatalog([], [...remoteTiles, local], [hiddenId, 'win:a'], [hiddenId]);
  assert.equal(catalog.visibleTiles.length, 6);
});

test('saving the checkbox state derives hiddenAppIds and preserves unknown ones', () => {
  const available = remoteTiles.map(({ id, provider }) => ({ id, provider }));
  const checked = available.slice(1).map((app) => app.id);
  assert.deepEqual(computeHiddenAppIds(['remote:gone'], available, checked).sort(), ['remote:gone', available[0].id].sort());
  assert.deepEqual(computeHiddenAppIds([available[0].id], available, available.map((a) => a.id)), []);
});

test('cached tiles are listed when the host is offline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hml-'));
  const cachePath = path.join(dir, 'remote-apps.json');
  fs.writeFileSync(cachePath, JSON.stringify({
    host: remoteSettings.host, apiUrl: remoteSettings.apiUrl, updatedAt: 'x',
    tiles: remoteTiles.map(({ id, name }) => ({ id, name, icon: '' }))
  }));
  const result = await listRemoteApps(remoteSettings, cachePath, { token: 'x', platform: 'win32', requestJson: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(result.status, 'cached');
  assert.equal(result.tiles.length, 5);
  const catalog = buildAppCatalog([], result.tiles.map((tile) => ({ ...tile, provider: 'remote' })), []);
  assert.equal(catalog.visibleTiles.length, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('empty Gaming row explains why', () => {
  const message = (status, settings = remoteSettings, hidden = 0) => TileModel.describeEmptyGaming(status, settings, hidden);
  assert.match(message({ status: 'offline', error: 'timeout' }), /Offline - no cached apps/);
  assert.match(message({ status: 'offline', error: 'Remote API credentials are not configured' }), /API token/);
  assert.match(message({ status: 'online' }, remoteSettings, 3), /hidden/);
  assert.match(message({ status: 'online' }), /No apps yet/);
  assert.equal(message({ status: 'online' }, { enabled: false }), '');
  const layout = TileModel.buildLayout([], [], { showEmptyGaming: true, gamingEmptyMessage: 'x' });
  assert.equal(layout.rows[0].emptyMessage, 'x');
});

/* ---- launch contract: real renderer launch-session -> real main id extraction -> model lookup ---- */

const model = {
  tiles: [
    { id: 'preset:netflix', type: 'website', name: 'Netflix', url: 'https://www.netflix.com' },
    { id: 'webapp:one', type: 'webapp', name: 'Web', url: 'https://example.com' },
    { id: 'windows:app', name: 'Native', command: 'C:\app.exe', provider: 'local' },
    { id: 'custom:cmd:0', name: 'Cmd', command: '/usr/bin/true', args: ['-x'] },
    remoteTiles[0]
  ]
};

/** Mirrors `handle('launcher:launch-app', ...)` + launchTile's argument checks in src/main/index.js. */
function fakeMain(launched) {
  return async (config) => {
    const id = launchIdFrom(config);
    if (typeof id !== 'string' || !id) throw new Error('Application ID is required');
    const tile = model.tiles.find((candidate) => candidate.id === id);
    if (!tile) throw new Error('Unknown tile');
    launched.push(tile.id);
    return { appId: id, pid: null };
  };
}

test('every tile type launches through launch-session with a valid main-side id', async () => {
  for (const tile of model.tiles) {
    const launched = [];
    const events = [];
    const session = createLaunchSession({
      api: { launchApp: fakeMain(launched), onAppLaunched: () => () => {}, onAppClosed: () => () => {} },
      onSuspend: (id) => events.push(['suspend', id]),
      onResume: () => {}
    });
    assert.equal(await session.launch(tile), true, tile.id);
    assert.deepEqual(launched, [tile.id]);
    assert.equal(session.phase, 'running');
  }
  assert.equal(buildLaunchConfig(model.tiles[0]).kind, 'website');
  assert.equal(buildLaunchConfig(remoteTiles[0]).kind, 'stream');
  assert.equal(launchIdFrom('x'), 'x');
  assert.equal(launchIdFrom({ tileId: 'y' }), 'y');
  assert.equal(launchIdFrom({}), undefined);
});

test('failed launch returns to idle and the toast text is readable', async () => {
  const session = createLaunchSession({
    api: { launchApp: async () => { throw new Error("Error invoking remote method 'launcher:launch-app': Error: Unknown tile"); }, onAppLaunched: () => () => {}, onAppClosed: () => () => {} },
    onSuspend: () => {}, onResume: () => {}
  });
  await assert.rejects(session.launch(model.tiles[0]), (error) => {
    assert.equal(describeLaunchError(error), 'Unknown tile');
    return true;
  });
  assert.equal(session.phase, 'idle');
  assert.equal(session.busy, false);
  assert.equal(describeLaunchError(new Error('Plain failure')), 'Plain failure');
});
