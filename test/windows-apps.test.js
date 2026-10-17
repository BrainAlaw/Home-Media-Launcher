'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanWindowsApplications } = require('../src/main/windows-apps');

test('maps Windows Start Menu shortcut to launchable tile', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-shortcuts-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'Media App.lnk'), 'placeholder');
  const tiles = await scanWindowsApplications(() => ({ target: 'C:\\Apps\\Media.exe', args: '--fullscreen', cwd: 'C:\\Apps' }), [directory]);
  assert.equal(tiles[0].name, 'Media App');
  assert.equal(tiles[0].command, 'C:\\Apps\\Media.exe');
  assert.deepEqual(tiles[0].args, ['--fullscreen']);
});
