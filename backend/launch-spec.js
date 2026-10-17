'use strict';

const LAUNCH_TYPES = ['moonlight', 'native', 'webapp', 'browser'];

function assertHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('A valid URL is required'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Browser URL must use HTTP(S) without embedded credentials');
  return url;
}

/**
 * Converts a tile into an argv-style spawn specification.
 * Types: `native` (default), `moonlight`, `webapp` (kiosk browser) and the legacy `browser` alias.
 */
function launchSpec(tile) {
  if (!tile || typeof tile.command !== 'string' || !tile.command.trim() || tile.command.includes('\0')) throw new Error('Application command is required');
  const args = tile.args || [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Application arguments must be strings without NUL characters');
  if (tile.type !== undefined && !LAUNCH_TYPES.includes(tile.type) && tile.type !== 'website') throw new Error(`Unsupported launch type: ${tile.type}`);
  if (tile.type === 'moonlight' && tile.host !== undefined) {
    // Structured form: host and application name are separate argv entries and can never be parsed as flags.
    if (typeof tile.host !== 'string' || !tile.host.trim() || tile.host.startsWith('-') || /[\s\x00-\x1f]/.test(tile.host)) throw new Error('Invalid Moonlight host');
    if (typeof tile.appName !== 'string' || !tile.appName.trim() || tile.appName.includes('\0') || tile.appName.startsWith('-')) throw new Error('Moonlight application name is required and must not start with a dash');
    const streamArgs = tile.streamArgs || [];
    if (!Array.isArray(streamArgs) || streamArgs.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('streamArgs must be strings');
    return { command: tile.command, args: [...args, 'stream', tile.host.trim(), tile.appName, ...streamArgs] };
  }
  if (tile.type !== 'browser' && tile.type !== 'webapp') return { command: tile.command, args };
  const url = assertHttpUrl(tile.url);
  const engine = tile.browserEngine || (tile.type === 'webapp' ? 'chromium' : undefined);
  if (!['chromium', 'firefox'].includes(engine)) throw new Error('browserEngine must be chromium or firefox');
  if (tile.type === 'webapp' && engine === 'chromium') return { command: tile.command, args: [...args, '--kiosk', '--no-first-run', `--app=${url.href}`] };
  return { command: tile.command, args: [...args, '--kiosk', url.href] };
}

module.exports = { LAUNCH_TYPES, launchSpec };
