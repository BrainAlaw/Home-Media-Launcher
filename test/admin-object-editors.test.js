'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { OBJECT_FIELDS, validateFieldValue } = require('../src/main/admin/object-fields');

const PANEL_DIR = path.join(__dirname, '..', 'src', 'main', 'admin', 'panel');

// The model is a browser script that assigns window.AdminObjectEditorModel; load it in an isolated context.
// Its results are built with the context's own intrinsics, so they are copied into this realm (JSON round trip)
// before node:test compares them with deepStrictEqual.
function loadBrowserModel() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(PANEL_DIR, 'object-editor-model.js'), 'utf8'), sandbox, { filename: 'object-editor-model.js' });
  const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  return Object.fromEntries(Object.entries(sandbox.window.AdminObjectEditorModel)
    .map(([name, fn]) => [name, (...args) => plain(fn(...args))]));
}

const model = loadBrowserModel();

const SAMPLES = {
  soloist: { enabled: true, deviceName: 'Living room', binaryPath: '/opt/soloist' },
  backgroundApps: { max: 3 },
  homeHeader: { layout: 'split', showSeconds: false, oledProtection: true, fadeIn: true },
  remote: {
    enabled: true, allowSelfSigned: false, host: 'pc', apiUrl: 'https://pc/api',
    moonlightPath: '/usr/bin/moonlight', moonlightArgs: ['--a', '--b c'], streamArgs: []
  },
  vpn: { surfsharkProfile: 'de', surfsharkWireguardProfile: '', surfsharkMode: 'auto' },
  wallpaper: { shuffle: true, online: false, source: 'bundled' }
};

const CANDIDATES = [
  true, false, '', 'x', 'a\u0007', 'x'.repeat(5000), 0, 1, 2.5, 3, 8, 9, -1, NaN,
  [], ['a'], ['a\0b'], 'split', 'centred', 'nope', 'auto', 'bundled', null, undefined
];

test('editable objects are exactly the six structured settings; the rest stay read-only', () => {
  assert.deepEqual(Object.keys(OBJECT_FIELDS).sort(), ['backgroundApps', 'homeHeader', 'remote', 'soloist', 'vpn', 'wallpaper']);
  assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(OBJECT_FIELDS).sort());
  for (const name of ['header', 'categories', 'theme', 'background', 'wallpaperSources']) {
    assert.equal(OBJECT_FIELDS[name], undefined, name);
  }
});

test('a stored object survives draft and build without change', () => {
  for (const [name, object] of Object.entries(SAMPLES)) {
    const fields = OBJECT_FIELDS[name];
    const draft = model.draftFromObject(fields, object);
    const built = model.buildObject(fields, object, draft);
    assert.deepEqual(built.errors, {}, name);
    assert.deepEqual(built.object, object, name);
  }
});

test('keys the editor does not show are kept from the stored object', () => {
  const base = { ...SAMPLES.soloist, internalFlag: 7 };
  const built = model.buildObject(OBJECT_FIELDS.soloist, base, model.draftFromObject(OBJECT_FIELDS.soloist, base));
  assert.equal(built.object.internalFlag, 7);
});

test('list drafts split on lines and drop blank entries', () => {
  assert.deepEqual(model.valueFromRaw({ type: 'list' }, ' --a \n\n --b c \n'), ['--a', '--b c']);
  assert.deepEqual(model.valueFromRaw({ type: 'list' }, ''), []);
});

test('number drafts must be whole numbers inside the range', () => {
  const fields = OBJECT_FIELDS.backgroundApps;
  assert.notEqual(model.buildObject(fields, {}, { max: '' }).errors.max, undefined);
  assert.notEqual(model.buildObject(fields, {}, { max: '2.5' }).errors.max, undefined);
  assert.notEqual(model.buildObject(fields, {}, { max: '99' }).errors.max, undefined);
  assert.deepEqual(model.buildObject(fields, {}, { max: '4' }).errors, {});
  assert.equal(model.buildObject(fields, {}, { max: '4' }).object.max, 4);
});

test('client rules agree with the server validator for every field', () => {
  for (const [name, fields] of Object.entries(OBJECT_FIELDS)) {
    for (const spec of fields) {
      for (const candidate of CANDIDATES) {
        const clientOk = model.validateValue(spec, candidate) === '';
        const serverOk = validateFieldValue(spec, candidate) === null;
        assert.equal(clientOk, serverOk, `${name}.${spec.key} with ${String(candidate).slice(0, 20)}`);
      }
    }
  }
});

test('patchFor sends the whole object under its settings key', () => {
  assert.deepEqual(model.patchFor('soloist', { enabled: false }), { settings: { soloist: { enabled: false } } });
});

test('server errors are shown next to the field they name', () => {
  assert.equal(model.fieldForServerError('deviceName must be at most 64 characters.', OBJECT_FIELDS.soloist), 'deviceName');
  assert.equal(model.fieldForServerError('settings.soloist.binaryPath is invalid', OBJECT_FIELDS.soloist), 'binaryPath');
  assert.equal(model.fieldForServerError('Configuration is invalid', OBJECT_FIELDS.soloist), null);
  assert.equal(model.fieldForServerError(undefined, OBJECT_FIELDS.soloist), null);
});

test('panel uses the object editor class names that panel.css defines', () => {
  const script = fs.readFileSync(path.join(PANEL_DIR, 'panel.js'), 'utf8');
  const styles = fs.readFileSync(path.join(PANEL_DIR, 'panel.css'), 'utf8');
  const html = fs.readFileSync(path.join(PANEL_DIR, 'index.html'), 'utf8');
  for (const name of ['object-editor', 'object-editor-field', 'object-editor-field-error', 'object-editor-actions', 'object-editor-readonly-hint']) {
    assert.ok(script.includes(name), `panel.js uses ${name}`);
    assert.ok(styles.includes(`.${name}`), `panel.css defines ${name}`);
  }
  assert.ok(script.includes('Edit on the TV for now'));
  assert.ok(html.includes('src="/object-editor-model.js"'));
  assert.ok(fs.existsSync(path.join(PANEL_DIR, 'object-editor-model.js')));
});

test('the browser model declares no global names besides window.AdminObjectEditorModel', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(PANEL_DIR, 'object-editor-model.js'), 'utf8'), sandbox);
  assert.deepEqual(Object.keys(sandbox).sort(), ['window']);
  assert.deepEqual(Object.keys(sandbox.window), ['AdminObjectEditorModel']);
});
