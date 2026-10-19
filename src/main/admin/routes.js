'use strict';

const { version } = require('../../../package.json');
const { GROUPS, SETTINGS, INTERNAL_PATHS } = require('../../../backend/settings-descriptor');
const { ACTIONS } = require('../../../backend/actions');

const SESSION_COOKIE = 'hml_admin_session';
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function hasSecret(value) {
  return value !== undefined && value !== null && value !== '';
}

function redactConfig(config) {
  if (Array.isArray(config)) return config.map(redactConfig);
  if (!config || typeof config !== 'object') return config;
  return Object.fromEntries(Object.entries(config).map(([key, value]) => {
    if (/(token|key|secret|password)/i.test(key)) return [key, hasSecret(value) ? '<set>' : '<unset>'];
    return [key, redactConfig(value)];
  }));
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REDACTED_MARKERS = new Set(['<set>', '<unset>']);
const SECRET_KEY = /(token|key|secret|password)/i;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Applies a settings patch on top of the stored settings. Keys absent from the patch keep their stored value.
 * A redacted marker ('<set>' or '<unset>') on a secret-looking key keeps the stored value, so a panel that echoes a
 * GET response never overwrites a secret with the marker. Arrays are replaced, except that items carrying markers
 * are merged positionally with the stored item at the same index (GET keeps the order).
 */
function mergeSettingsPatch(stored, patch) {
  const base = isPlainObject(stored) ? stored : {};
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (SECRET_KEY.test(key) && typeof value === 'string' && REDACTED_MARKERS.has(value)) continue;
    if (isPlainObject(value) && isPlainObject(base[key])) merged[key] = mergeSettingsPatch(base[key], value);
    else if (Array.isArray(value) && Array.isArray(base[key])) {
      merged[key] = value.map((item, index) => (isPlainObject(item) && isPlainObject(base[key][index])
        ? mergeSettingsPatch(base[key][index], item)
        : item));
    } else merged[key] = value;
  }
  return merged;
}

function json(status, body, headers = {}) {
  return { status, body, headers };
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE_SECONDS) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function createAdminRoutes({ getConfig, saveConfig, validate, auth, appVersion = version, onPaired = () => {} }) {
  if (typeof getConfig !== 'function' || typeof saveConfig !== 'function' || typeof validate !== 'function' || !auth) {
    throw new TypeError('Admin routes require config functions, validation, and authentication');
  }

  async function dispatch({ method, pathname, body, address, sessionToken }) {
    if (pathname === '/api/health') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return json(200, { ok: true, version: appVersion });
    }

    if (pathname === '/api/pair') {
      if (method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
      const retryAfter = auth.takePairRateLimit(address);
      if (retryAfter > 0) return json(429, { error: 'Too many pairing requests' }, { 'Retry-After': String(retryAfter) });
      const result = auth.verifyPairCode(address, body?.code);
      if (!result.ok) {
        return json(result.locked ? 429 : 401, { error: result.locked ? 'Pairing locked' : 'Invalid or expired pairing code' },
          result.retryAfter > 0 ? { 'Retry-After': String(result.retryAfter) } : {});
      }
      const session = auth.createSession();
      try { onPaired(); } catch { /* The TV card is informational; pairing must succeed regardless. */ }
      return json(200, { ok: true }, {
        'Set-Cookie': sessionCookie(session.token)
      });
    }

    if (pathname === '/api/settings-description') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return json(200, { GROUPS, SETTINGS, INTERNAL_PATHS, ACTIONS });
    }

    if (pathname === '/api/session') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' }, { Allow: 'GET' });
      const session = auth.verifySession(sessionToken);
      return session
        ? json(200, { authenticated: true, expiresAt: session.expiresAt }, { 'Set-Cookie': sessionCookie(sessionToken) })
        : json(200, { authenticated: false, expiresAt: null });
    }

    if (pathname === '/api/logout') {
      if (method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
      auth.revokeSession(sessionToken);
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }

    if (pathname === '/api/config') {
      if (method === 'GET') {
        const session = auth.verifySession(sessionToken);
        if (!session) return json(401, { error: 'Authentication required' });
        try { return json(200, redactConfig(await getConfig()), { 'Set-Cookie': sessionCookie(sessionToken) }); }
        catch { return json(500, { error: 'Could not read configuration' }); }
      }
      if (method === 'PUT') {
        const session = auth.verifySession(sessionToken);
        if (!session) return json(401, { error: 'Authentication required' });
        const refreshedCookie = { 'Set-Cookie': sessionCookie(sessionToken) };
        const patch = isPlainObject(body) ? body : {};
        if (patch.settings !== undefined && !isPlainObject(patch.settings)) {
          return json(422, { error: 'settings must be an object' }, refreshedCookie);
        }
        let next;
        try {
          const stored = await getConfig();
          const { settings: settingsPatch = {}, ...rest } = patch;
          next = { ...stored, ...rest, settings: mergeSettingsPatch(stored?.settings, settingsPatch) };
        } catch {
          return json(500, { error: 'Could not read configuration' }, refreshedCookie);
        }
        try { await validate(next); }
        catch (error) { return json(422, { error: error.message || 'Configuration is invalid' }, refreshedCookie); }
        try {
          await saveConfig(next);
          return json(200, { ok: true }, refreshedCookie);
        } catch {
          return json(500, { error: 'Could not save configuration' }, refreshedCookie);
        }
      }
      return json(405, { error: 'Method not allowed' }, { Allow: 'GET, PUT' });
    }

    return json(404, { error: 'Not found' });
  }

  return { dispatch };
}

module.exports = { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, redactConfig, createAdminRoutes };
