'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OBJECT_FIELDS, validateFieldValue } = require('../src/main/admin/object-fields');
const { DEVICE_NAME_MAX } = require('../backend/soloist/settings');

function validValue(spec) {
  switch (spec.type) {
    case 'boolean': return true;
    case 'text': return 'value';
    case 'enum': return spec.options[0];
    case 'number': return spec.min;
    case 'list': return ['value'];
    default: throw new TypeError(`Unknown field type: ${spec.type}`);
  }
}

function assertInvalid(spec, value) {
  const message = validateFieldValue(spec, value);
  assert.equal(typeof message, 'string');
  assert.match(message, new RegExp(spec.key));
}

test('every object field list is non-empty and has unique keys', () => {
  for (const fields of Object.values(OBJECT_FIELDS)) {
    assert.ok(fields.length > 0);
    assert.equal(new Set(fields.map((spec) => spec.key)).size, fields.length);
  }
});

test('Soloist device name field uses the validator limit', () => {
  const deviceName = OBJECT_FIELDS.soloist.find((spec) => spec.key === 'deviceName');
  assert.equal(deviceName.maxLength, DEVICE_NAME_MAX);
});

test('every declared field accepts a valid value', () => {
  for (const fields of Object.values(OBJECT_FIELDS)) {
    for (const spec of fields) assert.equal(validateFieldValue(spec, validValue(spec)), null, spec.key);
  }
});

test('validates boolean, text, enum, number and list values', () => {
  const fields = Object.values(OBJECT_FIELDS).flat();
  const boolean = fields.find((spec) => spec.type === 'boolean');
  assertInvalid(boolean, 'true');

  const text = fields.find((spec) => spec.type === 'text' && spec.maxLength !== undefined);
  assertInvalid(text, 'x'.repeat(text.maxLength + 1));
  assertInvalid(text, 'line\nbreak');

  const enumeration = fields.find((spec) => spec.type === 'enum');
  assertInvalid(enumeration, '__unknown__');

  const number = fields.find((spec) => spec.type === 'number');
  assertInvalid(number, number.min - 1);
  assertInvalid(number, number.max + 1);

  const list = fields.find((spec) => spec.type === 'list');
  assertInvalid(list, ['value', 1]);
  assertInvalid(list, ['value\0']);
});

test('unknown field types throw TypeError', () => {
  assert.throws(() => validateFieldValue({ key: 'custom', type: 'unknown' }, null), TypeError);
});
