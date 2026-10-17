'use strict';

const http = require('node:http');
const { saveToken, loadToken } = require('../../src/main/secret-store');
const { TOKEN_URL, createVerifier, createChallenge, createState, buildAuthorizeUrl } = require('./pkce');

/** Fixed loopback ports tried in order. Every `http://127.0.0.1:<port>/callback` must be registered in the Spotify dashboard. */
const CALLBACK_PORTS = Object.freeze([8888, 8889, 8890, 8891]);
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const PAGE = (title, message) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>${title}</h1><p>${message}</p></div></body></html>`;

/** Removes any known secret value from a message so errors and logs can never leak it. */
function redactSecrets(text, secrets) {
  let result = String(text ?? '');
  for (const secret of secrets) if (secret && secret.length > 6) result = result.split(secret).join('[redacted]');
  return result;
}

/**
 * Spotify Authorization Code + PKCE for a desktop app. Tokens live encrypted in `tokenPath` (safeStorage) and never leave this object:
 * callers can only obtain an access token through `getAccessToken()` inside the main process.
 */
class SpotifyAuth {
  constructor({ clientId, fetch: fetchImpl = globalThis.fetch, safeStorage, tokenPath, openExternal, createServer = () => http.createServer(),
    ports = CALLBACK_PORTS, now = Date.now, loginTimeoutMs = LOGIN_TIMEOUT_MS } = {}) {
    this.clientId = clientId || '';
    this.fetch = fetchImpl;
    this.safeStorage = safeStorage;
    this.tokenPath = tokenPath;
    this.openExternal = openExternal || (async () => {});
    this.createServer = createServer;
    this.ports = ports;
    this.now = now;
    this.loginTimeoutMs = loginTimeoutMs;
    this.tokens = null;
    this.listeners = new Set();
    this.refreshing = null;
    this.flow = null;
  }

  get configured() { return Boolean(this.clientId); }
  get signedIn() { return Boolean(this.tokens?.refreshToken); }

  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  #emit(event) { for (const listener of this.listeners) { try { listener(event); } catch { /* listener errors must not break auth */ } } }

  #secrets() { return [this.tokens?.accessToken, this.tokens?.refreshToken, this.clientId, this.flow?.verifier]; }

  /** Loads the persisted session. Resolves true when a refresh token is available. */
  async init() {
    if (!this.configured || !this.safeStorage || !this.tokenPath) return false;
    const raw = await loadToken(this.tokenPath, this.safeStorage);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.refreshToken === 'string' && parsed.refreshToken) {
        this.tokens = { accessToken: String(parsed.accessToken || ''), refreshToken: parsed.refreshToken, expiresAt: Number(parsed.expiresAt) || 0 };
        return true;
      }
    } catch { /* corrupt file: treated as signed out */ }
    return false;
  }

  async #persist() {
    if (!this.safeStorage || !this.tokenPath) return;
    try { await saveToken(this.tokenPath, this.tokens ? JSON.stringify(this.tokens) : '', this.safeStorage); }
    catch { /* secure storage unavailable: the session stays in memory only */ }
  }

  async #tokenRequest(params) {
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: this.clientId, ...params }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    let body = {};
    try { body = JSON.parse(await response.text()); } catch { /* non-JSON error page */ }
    return { status: response.status, ok: response.ok, body };
  }

  #applyTokens(body, previousRefresh = '') {
    this.tokens = {
      accessToken: String(body.access_token || ''),
      // Spotify may omit the refresh token on refresh; keep the existing one in that case.
      refreshToken: String(body.refresh_token || previousRefresh || ''),
      expiresAt: this.now() + (Number(body.expires_in) || 3600) * 1000
    };
  }

  /** Returns a valid access token, refreshing it when it expires within a minute. Resolves null when signed out. */
  async getAccessToken() {
    if (!this.tokens) return null;
    if (this.tokens.accessToken && this.tokens.expiresAt - this.now() > REFRESH_MARGIN_MS) return this.tokens.accessToken;
    const result = await this.refresh();
    if (result.ok) return this.tokens?.accessToken || null;
    // Offline with a still-valid token: keep using it.
    if (result.offline && this.tokens?.accessToken && this.tokens.expiresAt > this.now()) return this.tokens.accessToken;
    return null;
  }

  /** Single-flight refresh. `{ ok }`, `{ offline }` for network failures, `{ revoked }` when Spotify rejects the refresh token. */
  refresh() {
    if (!this.tokens?.refreshToken) return Promise.resolve({ ok: false, revoked: true });
    if (this.refreshing) return this.refreshing;
    const previous = this.tokens.refreshToken;
    this.refreshing = (async () => {
      let response;
      try { response = await this.#tokenRequest({ grant_type: 'refresh_token', refresh_token: previous }); }
      catch { return { ok: false, offline: true }; }
      if (response.ok && response.body.access_token) {
        this.#applyTokens(response.body, previous);
        await this.#persist();
        return { ok: true };
      }
      if (response.status === 400 || response.status === 401) {
        // invalid_grant: expired or revoked. Do not retry; the user must sign in again.
        this.tokens = null;
        await this.#persist();
        this.#emit({ status: 'signed-out', reason: 'Spotify session expired. Please sign in again.' });
        return { ok: false, revoked: true };
      }
      return { ok: false, offline: true };
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async logout() {
    this.#cancelFlow();
    this.tokens = null;
    await this.#persist();
    this.#emit({ status: 'signed-out' });
  }

  #cancelFlow() {
    const flow = this.flow;
    if (!flow) return;
    this.flow = null;
    clearTimeout(flow.timer);
    try { flow.server.close(); flow.server.closeAllConnections?.(); } catch { /* already closed */ }
  }

  #finishFlow(event) {
    this.#cancelFlow();
    this.#emit(event);
  }

  async #listen(server) {
    for (const port of this.ports) {
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
        });
        return server.address().port;
      } catch (error) {
        if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error;
      }
    }
    throw new Error(`No free loopback port (${this.ports.join(', ')})`);
  }

  /** Starts the browser sign-in. Resolves once the browser was opened; completion arrives through `onChange`. */
  async login() {
    if (!this.configured) return { ok: false, error: 'SPOTIFY_CLIENT_ID is not set' };
    this.#cancelFlow();
    const verifier = createVerifier();
    const state = createState();
    const server = this.createServer();
    let port;
    try { port = await this.#listen(server); }
    catch (error) {
      try { server.close(); } catch { /* not listening */ }
      const message = `Could not start the sign-in listener: ${redactSecrets(error.message, this.#secrets())}`;
      this.#emit({ status: 'error', message });
      return { ok: false, error: message };
    }
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const url = buildAuthorizeUrl({ clientId: this.clientId, redirectUri, challenge: createChallenge(verifier), state });
    const flow = { server, verifier, state, redirectUri, timer: null };
    flow.timer = setTimeout(() => { if (this.flow === flow) this.#finishFlow({ status: 'error', message: 'Spotify sign-in timed out' }); }, this.loginTimeoutMs);
    flow.timer.unref?.();
    this.flow = flow;
    server.on('request', (request, response) => { void this.#handleCallback(flow, request, response); });
    this.#emit({ status: 'signing-in', url });
    try { await this.openExternal(url); } catch { /* the url is also shown in the UI as a fallback */ }
    return { ok: true, url, redirectUri };
  }

  async #handleCallback(flow, request, response) {
    const reply = (status, title, message) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' }); response.end(PAGE(title, message)); };
    let parsed;
    try { parsed = new URL(request.url || '/', 'http://127.0.0.1'); } catch { reply(400, 'Bad request', 'Invalid URL.'); return; }
    if (parsed.pathname !== '/callback') { reply(404, 'Not found', 'Nothing here.'); return; }
    if (request.method !== 'GET') { reply(405, 'Not allowed', 'Use GET.'); return; }
    if (this.flow !== flow) { reply(410, 'Expired', 'This sign-in attempt is no longer active.'); return; }
    if (parsed.searchParams.get('state') !== flow.state) { reply(400, 'Sign-in rejected', 'State mismatch. Please try again from the launcher.'); return; }
    const denied = parsed.searchParams.get('error');
    if (denied) {
      reply(200, 'Sign-in cancelled', 'You can close this tab and return to the launcher.');
      this.#finishFlow({ status: 'error', message: denied === 'access_denied' ? 'Spotify sign-in was cancelled' : 'Spotify sign-in failed' });
      return;
    }
    const code = parsed.searchParams.get('code');
    if (!code) { reply(400, 'Sign-in rejected', 'No authorisation code received.'); return; }
    // A browser retry or double request must not start a second exchange with the same single-use code.
    if (flow.consumed) { reply(409, 'Already handled', 'This sign-in is already being completed.'); return; }
    flow.consumed = true;
    try {
      const result = await this.#tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, code_verifier: flow.verifier });
      if (!result.ok || !result.body.access_token) throw new Error(result.body.error_description || result.body.error || `HTTP ${result.status}`);
      this.#applyTokens(result.body);
      await this.#persist();
      reply(200, 'Signed in', 'You can close this tab and return to the launcher.');
      this.#finishFlow({ status: 'signed-in' });
    } catch (error) {
      reply(500, 'Sign-in failed', 'Spotify rejected the sign-in. Return to the launcher and try again.');
      this.#finishFlow({ status: 'error', message: `Spotify sign-in failed: ${redactSecrets(error.message, [...this.#secrets(), code])}` });
    }
  }

  dispose() { this.#cancelFlow(); }
}

module.exports = { SpotifyAuth, CALLBACK_PORTS, LOGIN_TIMEOUT_MS, redactSecrets };
