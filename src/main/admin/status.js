'use strict';

const { redactText } = require('./redact');

const STATUS_SOURCES = Object.freeze(['version', 'uptime', 'admin', 'host', 'spotify', 'soloist', 'vpn', 'network', 'weather']);
const SECRET_FIELD = /(token|secret|api.?key|password|cookie|authorization|ssid|credential)/i;
const VALID_STATES = new Set(['ok', 'unknown', 'error']);

function shortMessage(error, secrets) {
  const raw = typeof error === 'string' ? error : error?.message;
  const safe = redactText(String(raw || 'Status probe failed'), secrets).replace(/[\r\n\t]+/g, ' ').trim();
  return (safe || 'Status probe failed').slice(0, 180);
}

function sanitiseDetail(value, secrets, depth = 0) {
  if (typeof value === 'string') return redactText(value, secrets).slice(0, 500);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (depth >= 4) return '[detail omitted]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitiseDetail(item, secrets, depth + 1));
  if (!value || typeof value !== 'object') return String(value).slice(0, 500);
  const safe = {};
  for (const [key, nested] of Object.entries(value).slice(0, 30)) {
    if (SECRET_FIELD.test(key)) continue;
    safe[key] = sanitiseDetail(nested, secrets, depth + 1);
  }
  return safe;
}

async function probe(name, fn, timeoutMs = 1500, secrets = []) {
  if (typeof fn !== 'function') return { state: 'unknown', detail: 'Not available' };
  const boundedTimeout = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(30000, Math.floor(timeoutMs))) : 1500;
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), boundedTimeout);
    });
    const result = await Promise.race([Promise.resolve().then(fn), timeout]);
    if (result?.timedOut) return { state: 'unknown', detail: 'Probe timed out' };
    if (result && VALID_STATES.has(result.state)) {
      return { state: result.state, detail: sanitiseDetail(result.detail ?? '', secrets) };
    }
    return { state: 'ok', detail: sanitiseDetail(result ?? '', secrets) };
  } catch (error) {
    return { state: 'error', detail: shortMessage(error, secrets) };
  } finally {
    clearTimeout(timer);
  }
}

async function buildStatus(sources = {}) {
  const secretValues = Array.isArray(sources.secretValues) ? sources.secretValues : [];
  const runProbe = typeof sources.probe === 'function' ? sources.probe : probe;
  const results = await Promise.all(STATUS_SOURCES.map(async (name) => {
    const timeoutMs = sources.timeouts?.[name] ?? sources.timeoutMs ?? 1500;
    try {
      const result = await runProbe(name, sources[name], timeoutMs, secretValues);
      const state = VALID_STATES.has(result?.state) ? result.state : 'unknown';
      return [name, { state, detail: sanitiseDetail(result?.detail ?? '', secretValues) }];
    } catch (error) {
      return [name, { state: 'error', detail: shortMessage(error, secretValues) }];
    }
  }));
  return Object.fromEntries(results);
}

module.exports = { STATUS_SOURCES, probe, buildStatus };
