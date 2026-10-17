'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseApiApps, parseCsvLine, parseMoonlightCsv } = require('../src/main/remote-apps');

test('parses quoted Moonlight CSV fields', () => {
  assert.deepEqual(parseCsvLine('"Game, One",42,true,false,false,true,"file:///cover.png"'), ['Game, One', '42', 'true', 'false', 'false', 'true', 'file:///cover.png']);
});

test('maps VibePollo API response to Moonlight launch tile', () => {
  const [tile] = parseApiApps({ apps: [{ name: 'Steam', id: 'steam', hidden: false }] }, { host: '192.168.1.10', moonlightPath: 'Moonlight.exe' });
  assert.equal(tile.id, 'remote:192.168.1.10:steam');
  assert.deepEqual(tile.args, ['stream', '192.168.1.10', 'Steam']);
});

test('maps Moonlight application to launchable tile', () => {
  const output = 'Name, ID, HDR Support, App Collection Game, Hidden, Direct Launch, Boxart URL\n"Desktop",1,false,false,false,true,"file:///cover.png"\n';
  const [tile] = parseMoonlightCsv(output, { host: 'gaming-pc', moonlightPath: 'moonlight' });
  assert.equal(tile.name, 'Desktop');
  assert.deepEqual(tile.args, ['stream', 'gaming-pc', 'Desktop']);
  assert.equal(tile.icon, 'file:///cover.png');
});
