'use strict';

const { version } = require('../../../package.json');

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

function json(status, body, headers = {}) {
  return { status, body, headers };
}

function createAdminRoutes({ getConfig, saveConfig, validate, auth, appVersion = version }) {
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
      return json(200, { ok: true }, {
        'Set-Cookie': `${SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
      });
    }

    if (pathname === '/api/session') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return json(200, auth.sessionStatus(sessionToken));
    }

    if (pathname === '/api/logout') {
      if (method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
      auth.revokeSession(sessionToken);
      return json(200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }

    if (pathname === '/api/config') {
      if (method === 'GET') {
        if (!auth.verifySession(sessionToken)) return json(401, { error: 'Authentication required' });
        try { return json(200, redactConfig(await getConfig())); }
        catch { return json(500, { error: 'Could not read configuration' }); }
      }
      if (method === 'PUT') {
        if (!auth.verifySession(sessionToken)) return json(401, { error: 'Authentication required' });
        try { await validate(body); }
        catch (error) { return json(422, { error: error.message || 'Configuration is invalid' }); }
        try {
          await saveConfig(body);
          return json(200, { ok: true });
        } catch {
          return json(500, { error: 'Could not save configuration' });
        }
      }
      return json(405, { error: 'Method not allowed' }, { Allow: 'GET, PUT' });
    }

    return json(404, { error: 'Not found' });
  }

  return { dispatch };
}

module.exports = { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, redactConfig, createAdminRoutes };
