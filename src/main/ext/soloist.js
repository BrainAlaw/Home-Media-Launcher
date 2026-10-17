'use strict';

const path = require('node:path');
const { SoloistManager } = require('../../../backend/soloist/manager');

/**
 * ns `soloist`: local Soloist player (Linux only; `unsupported` on win32/darwin). See backend/soloist/manager.js.
 * Methods: status(), detect(), start(), stop(), restart(), apply() (re-reads settings.soloist and reconciles the process;
 *          the renderer calls it after the quick-settings toggle saves the config and once at start-up).
 * Events:  `status` (SoloistStatus, pushed on change).
 * The API key comes from `ctx.secrets.soloistApiKey` (SPOTIFY_SOLOIST_API) and never leaves the main process.
 */

let manager = null;
/** `ctx.emit` of this namespace. Set by start(), so events go out under `ext:soloist:*` even when the manager was created by another namespace. */
let emitEvent = () => {};

/**
 * Creates the process-wide manager once. The Soloist modules are required lazily inside the factories, so nothing is loaded
 * or spawned until Soloist is actually enabled on a supported platform.
 * @param {{ userData: string }} ctx
 */
function ensureManager(ctx) {
  if (manager) return manager;
  const root = path.join(ctx.userData, 'soloist');
  manager = new SoloistManager({
    dataDir: path.join(root, 'data'),
    cacheDir: path.join(root, 'cache'),
    createProcess: () => new (require('../../../backend/soloist/process').SoloistProcess)(),
    createClient: () => new (require('../../../backend/soloist/ws-client').SoloistClient)()
  });
  manager.on('status', (status) => emitEvent('status', status));
  return manager;
}

/** Loads the current `settings.soloist` and the key into the manager, then returns it. */
function configured(ctx) {
  const current = ensureManager(ctx);
  current.configure({ settings: ctx.config?.()?.soloist, apiKey: ctx.secrets?.soloistApiKey || '' });
  return current;
}

module.exports = {
  namespace: 'soloist',
  ensureManager,
  handlers: {
    status: (ctx) => configured(ctx).status(),
    detect: (ctx) => configured(ctx).detect(),
    start: (ctx) => configured(ctx).start(),
    stop: (ctx) => ensureManager(ctx).stop(),
    restart: (ctx) => configured(ctx).restart(),
    apply: (ctx) => ensureManager(ctx).reconcile({ settings: ctx.config?.()?.soloist, apiKey: ctx.secrets?.soloistApiKey || '' })
  },
  start(ctx) {
    emitEvent = ctx.emit;
    ensureManager(ctx);
  },
  stop() {
    const current = manager;
    manager = null;
    current?.dispose().catch((error) => console.warn('Soloist shutdown failed:', error.message));
  }
};
