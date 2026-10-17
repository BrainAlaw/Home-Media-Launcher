'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { entryToTile, parseDesktopEntry, tokenizeExec } = require('../src/main/desktop-entry');

test('parses desktop entry section only', () => {
  const entry = parseDesktopEntry('[Desktop Entry]\nName=Steam\nExec=steam %U\nType=Application\n[Desktop Action Foo]\nName=Wrong');
  assert.deepEqual(entry, { Name: 'Steam', Exec: 'steam %U', Type: 'Application' });
});

test('tokenizes quoted Exec and removes field codes', () => {
  assert.deepEqual(tokenizeExec('program --title "Media App" %U --percent=%%'), ['program', '--title', 'Media App', '--percent=%']);
});

test('ignores hidden and non-application entries', () => {
  assert.equal(entryToTile({ Type: 'Application', Name: 'Hidden', Exec: 'app', NoDisplay: 'true' }, '/tmp/a.desktop'), null);
  assert.equal(entryToTile({ Type: 'Link', Name: 'Link', Exec: 'app' }, '/tmp/a.desktop'), null);
});
