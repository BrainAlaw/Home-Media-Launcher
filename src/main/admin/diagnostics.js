'use strict';

const { redactConfig } = require('./routes');
const { redactText } = require('./redact');

function secretEntries(secretNames) {
  const entries = [];
  if (Array.isArray(secretNames)) {
    for (const entry of secretNames) {
      if (typeof entry === 'string') entries.push({ name: entry, set: false, value: '' });
      else if (entry && typeof entry.name === 'string') {
        const value = typeof entry.value === 'string' ? entry.value : '';
        entries.push({ name: entry.name, set: typeof entry.set === 'boolean' ? entry.set : Boolean(value), value });
      }
    }
  } else if (secretNames && typeof secretNames === 'object') {
    for (const [name, value] of Object.entries(secretNames)) {
      entries.push({ name, set: typeof value === 'boolean' ? value : Boolean(value), value: typeof value === 'string' ? value : '' });
    }
  }
  return entries;
}

function sanitise(value, secretValues) {
  if (typeof value === 'string') return redactText(value, secretValues);
  if (Array.isArray(value)) return value.map((entry) => sanitise(entry, secretValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitise(entry, secretValues)]));
  }
  return value;
}

function buildDiagnostics({ status = {}, logTail = [], settings = {}, secretNames = {} } = {}) {
  const secrets = secretEntries(secretNames);
  const secretValues = secrets.map((entry) => entry.value).filter(Boolean);
  const maskedSettings = redactConfig(settings);
  return {
    status: sanitise(status, secretValues),
    logTail: sanitise(Array.isArray(logTail) ? logTail : [], secretValues),
    settings: sanitise(maskedSettings, secretValues),
    secretNames: secrets.map(({ name, set }) => ({ name, set }))
  };
}

module.exports = { buildDiagnostics };
