'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { launchSpec } = require('../../backend/launch-spec');
const { resolveBinary } = require('../../backend/binary-resolver');

/**
 * Spawns launcher applications as detached children. Events:
 * `started` { pid, tileId, type } and `finished` { code, signal, tileId, error? }.
 */
class ProcessManager extends EventEmitter {
  constructor(spawnProcess = spawn) {
    super();
    this.spawnProcess = spawnProcess;
    this.active = null;
    this.activeTileId = null;
  }

  launch(tile) {
    if (this.active) throw new Error('Another application is already running');
    const specification = launchSpec(tile);
    const shell = tile.shell === true;
    if (['browser', 'webapp', 'moonlight'].includes(tile.type) && shell) throw new Error('Browser and Moonlight applications cannot use a shell');
    const env = { ...process.env, ...(tile.env || {}) };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = this.spawnProcess(specification.command, specification.args, {
      cwd: tile.cwd || undefined,
      // Detached children get their own process group, so they never share the launcher's console or signals.
      detached: true,
      shell,
      stdio: 'ignore',
      env
    });
    child.unref?.();
    this.active = child;
    this.activeTileId = tile.id;
    const finished = (result) => {
      if (this.active !== child) return;
      this.active = null;
      this.activeTileId = null;
      this.emit('finished', result);
    };
    child.on('error', (error) => finished({ error: describeSpawnError(error, specification.command), tileId: tile.id }));
    child.once('exit', (code, signal) => finished({ code, signal, tileId: tile.id }));
    this.emit('started', { pid: child.pid, tileId: tile.id, type: tile.type || 'native' });
    return { pid: child.pid };
  }

  /**
   * Preflights the binary and resolves only once the OS confirmed the spawn,
   * so a missing executable surfaces as a rejected promise instead of a hidden launcher.
   */
  async launchChecked(tile) {
    const specification = launchSpec(tile);
    if (tile.shell !== true && !(await resolveBinary(specification.command, { env: { ...process.env, ...(tile.env || {}) } }))) {
      throw new Error(`Executable not found: ${specification.command}`);
    }
    const result = this.launch(tile);
    if (result.pid !== undefined) return result;
    return new Promise((resolve, reject) => {
      const settle = (outcome) => {
        if (outcome.tileId !== tile.id) return;
        this.off('finished', settle);
        reject(new Error(outcome.error || 'Application failed to start'));
      };
      this.on('finished', settle);
      setImmediate(() => { if (this.active && this.active.pid !== undefined) { this.off('finished', settle); resolve({ pid: this.active.pid }); } });
    });
  }

  /** Politely stops the running application, including children in its process group. */
  terminate() {
    const child = this.active;
    if (!child?.pid) return false;
    try {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        killer.on('error', () => { child.kill?.(); });
        killer.unref();
      }
      else process.kill(-child.pid, 'SIGTERM');
      return true;
    } catch { return child.kill?.() === true; }
  }
}

function describeSpawnError(error, command) {
  if (error.code === 'ENOENT') return `Executable or working directory not found: ${command}`;
  if (error.code === 'EACCES') return `Permission denied: ${command}`;
  return error.message;
}

module.exports = { ProcessManager };
