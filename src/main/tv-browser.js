'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { findBrowser, resolveBinary } = require('../../backend/binary-resolver');
const { TV_CONTROL_SCRIPT } = require('../../backend/tv-controls');

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const START_TIMEOUT_MS = 12000;
const CDP_TIMEOUT_MS = 5000;

function isLoopbackDevToolsUrl(value, port) {
  try {
    const url = new URL(value);
    return url.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && Number(url.port) === port;
  } catch { return false; }
}

class DevToolsConnection {
  constructor(socket, onEvent) {
    this.socket = socket;
    this.onEvent = onEvent;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => this.receive(event.data));
    socket.addEventListener('close', () => this.rejectPending(new Error('Browser DevTools connection closed')));
    socket.addEventListener('error', () => this.rejectPending(new Error('Browser DevTools connection failed')));
  }

  receive(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.id && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || 'Browser command failed'));
      else entry.resolve(message.result || {});
      return;
    }
    try { this.onEvent?.(message); } catch { /* Browser events cannot break the control channel. */ }
  }

  send(method, params = {}, sessionId) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Browser DevTools connection is not open'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, CDP_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  rejectPending(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }

  close() { this.socket.close(); this.rejectPending(new Error('Browser session closed')); }
}

class TvBrowserSession extends EventEmitter {
  constructor({ userData, platform = process.platform, env = process.env, spawnProcess = spawn, killTree = null, binary = null } = {}) {
    super();
    this.userData = userData;
    this.platform = platform;
    this.env = env;
    this.spawnProcess = spawnProcess;
    this.killTree = killTree;
    this.binary = binary;
    this.child = null;
    this.connection = null;
    this.profile = path.join(userData, 'tv-browser');
    this.sessions = new Set();
    this.attachingTargets = new Set();
    this.closing = false;
    this.finished = false;
  }

  async start({ url, name }) {
    if (!this.userData) throw new Error('The TV browser needs the application data directory');
    const target = new URL(url);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('TV apps require an HTTP(S) URL without credentials');
    const binary = this.binary || await this.findTvBrowser();
    if (!binary) throw new Error('Install Microsoft Edge, Google Chrome or Chromium to use TV controls for Home Theatre apps');
    await fs.mkdir(this.profile, { recursive: true });
    await fs.rm(path.join(this.profile, 'DevToolsActivePort'), { force: true });
    const args = [
      '--no-first-run', '--no-default-browser-check', '--disable-background-mode',
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      `--user-data-dir=${this.profile}`
    ];
    args.push('--kiosk');
    if (this.platform === 'win32' && path.basename(binary).toLowerCase() === 'msedge.exe') args.push('--edge-kiosk-type=fullscreen');
    args.push('about:blank');
    this.child = this.spawnProcess(binary, args, { detached: this.platform !== 'win32', stdio: 'ignore', windowsHide: false, env: this.env });
    this.child.once('error', (error) => this.finish({ error: error.message }));
    this.child.once('exit', (code, signal) => this.finish({ code, signal }));
    try {
      const endpoint = await this.waitForEndpoint();
      const socket = new WebSocket(endpoint.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out connecting to the TV browser')), CDP_TIMEOUT_MS);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to the TV browser')); }, { once: true });
      });
      this.connection = new DevToolsConnection(socket, (message) => this.onDevToolsEvent(message));
      await this.connection.send('Target.setDiscoverTargets', { discover: true });
      const page = await this.waitForPageTarget();
      const attached = await this.connection.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
      await this.installControls(attached.sessionId, false);
      this.attachingTargets.add(page.targetId);
      await this.connection.send('Page.navigate', { url: target.toString() }, attached.sessionId);
      this.sessions.add(attached.sessionId);
      return { pid: this.child.pid, browser: path.basename(binary) };
    } catch (error) {
      await this.terminate();
      throw error;
    }
  }

  async findTvBrowser() {
    if (this.platform !== 'win32') return findBrowser('chromium', { platform: this.platform, env: this.env });
    const roots = [this.env.ProgramFiles, this.env['ProgramFiles(x86)'], this.env.LOCALAPPDATA].filter(Boolean);
    const candidates = [
      ['Microsoft/Edge/Application', 'msedge.exe'],
      ['Google/Chrome/Application', 'chrome.exe'],
      ['BraveSoftware/Brave-Browser/Application', 'brave.exe']
    ];
    for (const [directory, name] of candidates) {
      const onPath = await resolveBinary(name, { platform: this.platform, env: this.env });
      if (onPath) return onPath;
      for (const root of roots) {
        const found = await resolveBinary(path.join(root, directory, name), { platform: this.platform, env: this.env });
        if (found) return found;
      }
    }
    return null;
  }

  async waitForEndpoint() {
    const file = path.join(this.profile, 'DevToolsActivePort');
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) throw new Error('The TV browser exited during startup');
      try {
        const [portText] = (await fs.readFile(file, 'utf8')).split(/\r?\n/);
        const port = Number(portText);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid browser debugging port');
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
        if (!response.ok) throw new Error('Browser debugging endpoint is unavailable');
        const endpoint = await response.json();
        if (!isLoopbackDevToolsUrl(endpoint.webSocketDebuggerUrl, port)) throw new Error('Browser debugging endpoint is outside loopback');
        return endpoint;
      } catch (error) {
        if (error.message.includes('Invalid browser debugging port') || error.message.includes('outside loopback')) throw error;
        await sleep(100);
      }
    }
    throw new Error('The TV browser did not expose its local control endpoint');
  }

  async waitForPageTarget() {
    const deadline = Date.now() + CDP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await this.connection.send('Target.getTargets');
      const page = result.targetInfos?.find((target) => target.type === 'page' && target.url === 'about:blank');
      if (page) return page;
      await sleep(80);
    }
    throw new Error('The TV browser did not create a page');
  }

  async installControls(sessionId, evaluateCurrentDocument = true) {
    await this.connection.send('Runtime.enable', {}, sessionId);
    await this.connection.send('Page.enable', {}, sessionId);
    await this.connection.send('Runtime.addBinding', { name: 'hmlHome' }, sessionId);
    await this.connection.send('Runtime.addBinding', { name: 'hmlClose' }, sessionId);
    await this.connection.send('Runtime.addBinding', { name: 'hmlTvKey' }, sessionId);
    await this.connection.send('Page.addScriptToEvaluateOnNewDocument', { source: TV_CONTROL_SCRIPT }, sessionId);
    if (evaluateCurrentDocument) await this.connection.send('Runtime.evaluate', { expression: TV_CONTROL_SCRIPT }, sessionId);
    this.sessions.add(sessionId);
  }

  onDevToolsEvent(message) {
    if (message.method === 'Runtime.bindingCalled' && message.params?.name === 'hmlHome') {
      this.emit('home');
      return;
    }
    if (message.method === 'Runtime.bindingCalled' && message.params?.name === 'hmlClose') {
      this.emit('close', message.params?.payload);
      return;
    }
    if (message.method === 'Runtime.bindingCalled' && message.params?.name === 'hmlTvKey' && message.params?.payload === 'Enter') {
      void this.sendTrustedEnter(message.sessionId);
      return;
    }
    if (message.method === 'Target.targetCreated' || message.method === 'Target.targetInfoChanged') {
      const target = message.params?.targetInfo;
      if (target?.type === 'page' && target.url.startsWith('http') && !this.attachingTargets.has(target.targetId)) void this.attachPopup(target.targetId);
    }
  }

  async sendTrustedEnter(sessionId) {
    if (!this.connection || !this.sessions.has(sessionId) || this.closing) return;
    try {
      await this.connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, sessionId);
      await this.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
    } catch { /* The browser may close while a controller selection is being delivered. */ }
  }

  async attachPopup(targetId) {
    if (!this.connection || this.closing || this.attachingTargets.has(targetId)) return;
    this.attachingTargets.add(targetId);
    try {
      const attached = await this.connection.send('Target.attachToTarget', { targetId, flatten: true });
      await this.installControls(attached.sessionId);
    } catch { this.attachingTargets.delete(targetId); /* The target may close while its popup is being attached. */ }
  }

  async setWindowState(windowState) {
    if (!this.connection || this.closing || this.finished) throw new Error('TV browser is not running');
    try {
      const result = await this.connection.send('Target.getTargets');
      const target = result.targetInfos?.find((entry) => entry.type === 'page');
      if (!target) throw new Error('TV browser window is unavailable');
      const { windowId } = await this.connection.send('Browser.getWindowForTarget', { targetId: target.targetId });
      if (!Number.isInteger(windowId)) throw new Error('TV browser window is unavailable');
      await this.connection.send('Browser.setWindowBounds', { windowId, bounds: { windowState } });
    } catch (error) {
      if (error.message.includes('TV browser window is unavailable')) throw error;
      throw new Error(`TV browser is no longer available: ${error.message}`);
    }
  }

  hide() { return this.setWindowState('minimized'); }

  show() { return this.setWindowState('fullscreen'); }

  async terminate() {
    if (this.closing || !this.child?.pid) return;
    this.closing = true;
    this.connection?.close();
    const pid = this.child.pid;
    if (this.platform === 'win32') {
      const killer = this.killTree || ((id) => execFileAsync('taskkill', ['/pid', String(id), '/t', '/f'], { windowsHide: true }));
      try { await killer(pid); } catch { try { this.child.kill(); } catch { /* Process already ended. */ } }
      return;
    }
    try { process.kill(-pid, 'SIGTERM'); } catch { try { this.child.kill('SIGTERM'); } catch { /* Process already ended. */ } }
    const child = this.child;
    const timer = setTimeout(() => { if (this.child === child && child.exitCode === null) { try { process.kill(-pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* Process already ended. */ } } } }, 1800);
    timer.unref?.();
  }

  finish(result) {
    if (this.finished) return;
    this.finished = true;
    this.connection?.close();
    this.connection = null;
    this.emit('closed', result);
  }
}

module.exports = { TvBrowserSession, isLoopbackDevToolsUrl };
