'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { launchSpec } = require('../launch-spec');
const { resolveBinary } = require('../binary-resolver');
const { ProcessManager } = require('../../src/main/process-manager');
const { parseDesktopEntry, tokenizeExec } = require('../../src/main/desktop-entry');
const { splitWindowsArguments } = require('../../src/main/windows-apps');
const { quoteDesktopArgument } = require('../../src/main/autostart');
const { validateConfig } = require('../../src/main/config');

test('moonlight application names cannot be parsed as options', () => {
  assert.throws(() => launchSpec({ type: 'moonlight', command: 'moonlight', host: 'pc', appName: '--quit' }), /application name/);
});

test('shell mode is rejected for moonlight tiles', () => {
  const manager = new ProcessManager(() => { throw new Error('must not spawn'); });
  assert.throws(() => manager.launch({ id: 'm', type: 'moonlight', command: 'moonlight', host: 'pc', appName: 'x', shell: true }), /shell/i);
});

test('a second child error event does not crash the launcher', () => {
  const child = Object.assign(new EventEmitter(), { pid: undefined, unref() {} });
  const manager = new ProcessManager(() => child);
  manager.launch({ id: 'e', command: 'x' });
  child.emit('error', Object.assign(new Error('a'), { code: 'ENOENT' }));
  assert.doesNotThrow(() => child.emit('error', new Error('kill failed')));
});

test('desktop Exec field codes are stripped inside tokens and empty arguments survive', () => {
  assert.deepEqual(tokenizeExec('app --url=%u "%F" %%f %i'), ['app', '--url=', '%f']);
  assert.deepEqual(tokenizeExec('app "" x'), ['app', '', 'x']);
  assert.deepEqual(tokenizeExec('"/opt/My App/run" "a\\\\b"'), ['/opt/My App/run', 'a\\b']);
});

test('desktop entry keys tolerate whitespace around the separator', () => {
  assert.equal(parseDesktopEntry('[Desktop Entry]\nExec = foo --bar\n').Exec, 'foo --bar');
});

test('windows shortcut arguments keep backslashes', () => {
  assert.deepEqual(splitWindowsArguments('/a C:\\Foo\\bar "C:\\My Dir\\f.txt" "q\\"x" %USERPROFILE%'),
    ['/a', 'C:\\Foo\\bar', 'C:\\My Dir\\f.txt', 'q"x', '%USERPROFILE%']);
});

test('autostart escapes percent signs and backslashes for the Exec key', () => {
  assert.equal(quoteDesktopArgument('/opt/50%/a"b'), '"/opt/50%%/a\\"b"');
  assert.equal(quoteDesktopArgument('a\\b'), '"a\\\\\\\\b"');
});

test('windows resolution prefers PATHEXT candidates over extensionless shims', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hml-bin-'));
  try {
    fs.writeFileSync(path.join(directory, 'tool'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(directory, 'tool.exe'), '');
    const found = await resolveBinary('tool', { platform: 'win32', env: { PATH: directory, PATHEXT: '.EXE' } });
    assert.equal(path.basename(found).toLowerCase(), 'tool.exe');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('config rejects shell for non-native tiles and NUL in moonlightPath', () => {
  const row = (tile) => ({ rows: [{ title: 't', tiles: [tile] }] });
  assert.throws(() => validateConfig(row({ name: 'w', type: 'webapp', command: 'chromium', url: 'https://a.b', shell: true })), /shell/);
  assert.throws(() => validateConfig({ rows: [], settings: { remote: { moonlightPath: 'a\0b' } } }), /moonlightPath/);
});
