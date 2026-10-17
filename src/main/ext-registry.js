'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Namespaced IPC extension points. Every file in `src/main/ext/*.js` exports:
 *   { namespace: string, handlers: { [method]: (ctx, ...args) => unknown }, start?(ctx): void, stop?(): void }
 * Renderer access: `window.launcher.ext.invoke(namespace, method, ...args)` and
 * `window.launcher.ext.on(namespace, event, callback)`. Channels are `ext:<namespace>:<method|event>`.
 * `ctx` = { emit(event, payload), getWindow(), userData, secrets, config() }.
 * The preload allowlist (EXT_NAMESPACES in preload.js) must contain every namespace.
 */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]{1,23}$/;

function loadModules(directory = path.join(__dirname, 'ext')) {
  let files = [];
  try { files = fs.readdirSync(directory).filter((file) => file.endsWith('.js')).sort(); } catch { return []; }
  return files.map((file) => require(path.join(directory, file)));
}

function registerExtensions({ ipcMain, getWindow, userData, secrets, config, modules = loadModules() }) {
  const started = [];
  for (const mod of modules) {
    if (!NAMESPACE_PATTERN.test(mod.namespace || '')) throw new Error(`Invalid extension namespace: ${mod.namespace}`);
    const ctx = {
      userData, secrets, config,
      getWindow,
      emit: (event, payload) => {
        const window = getWindow();
        if (window && !window.isDestroyed()) window.webContents.send(`ext:${mod.namespace}:${event}`, payload);
      }
    };
    for (const [method, callback] of Object.entries(mod.handlers || {})) {
      ipcMain.handle(`ext:${mod.namespace}:${method}`, (event, ...args) => {
        const window = getWindow();
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender');
        return callback(ctx, ...args);
      });
    }
    mod.start?.(ctx);
    started.push(mod);
  }
  return () => { for (const mod of started) mod.stop?.(); };
}

module.exports = { registerExtensions, loadModules, NAMESPACE_PATTERN };
