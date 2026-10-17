/**
 * Soloist (local Spotify Connect player) status in the renderer: the quick-settings switch row and the "this computer"
 * line of the media widget. Data arrives through the `soloist` ext namespace only; the API key never reaches this file.
 * Pure helpers are exported for tests; the DOM wiring runs only in the browser.
 */

/** Longest status text shown in Settings (unique name: classic scripts share one global scope). */
const SOLOIST_SUBTITLE_MAX = 84;
const DEFAULT_DEVICE_NAME = 'Home Media Launcher';

/** First sentence of a main-process message, capped so the row stays on two lines. */
function shortenMessage(text) {
  const first = String(text ?? '').trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '');
  return first.length > SOLOIST_SUBTITLE_MAX ? `${first.slice(0, SOLOIST_SUBTITLE_MAX - 1)}…` : first;
}

const sameName = (left, right) => String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase();

/**
 * Quick-settings row for a SoloistStatus. Every state explains itself; `checked` mirrors the enabled setting, except on
 * unsupported platforms where the switch is locked off.
 * @param {{ state?: string, enabled?: boolean, deviceName?: string, message?: string } | null | undefined} status
 * @returns {{ state: 'on' | 'busy' | 'off' | 'unavailable', checked: boolean, disabled: boolean, subtitle: string }}
 */
function soloistRowView(status) {
  const enabled = status?.enabled === true;
  const name = status?.deviceName || DEFAULT_DEVICE_NAME;
  switch (status?.state) {
    case 'unsupported': return { state: 'unavailable', checked: false, disabled: true, subtitle: 'Not available on this PC' };
    case 'connected': return { state: 'on', checked: true, disabled: false, subtitle: shortenMessage(`Connected as ${name}`) };
    case 'starting': return { state: 'busy', checked: true, disabled: false, subtitle: 'Starting…' };
    case 'stopped': return { state: 'off', checked: enabled, disabled: false, subtitle: 'Stopped' };
    case 'not-installed': return { state: 'unavailable', checked: enabled, disabled: false, subtitle: 'Soloist was not found' };
    case 'error': return { state: 'unavailable', checked: enabled, disabled: false, subtitle: shortenMessage(status.message) || 'Soloist failed to start' };
    default: return { state: 'off', checked: false, disabled: false, subtitle: 'Off' };
  }
}

/**
 * Media widget line. Shown only while the Soloist socket is live and the playback device is this computer
 * (or no device is reported, which is the case for socket-only snapshots).
 * @param {{ state?: string, deviceName?: string } | null | undefined} status
 * @param {{ name?: string } | null | undefined} device MediaState.device
 * @returns {string}
 */
function soloistMediaLine(status, device) {
  if (status?.state !== 'connected') return '';
  if (device?.name && !sameName(device.name, status.deviceName)) return '';
  return 'Soloist: this computer';
}

if (typeof module === 'object' && module.exports) {
  module.exports = { shortenMessage, soloistRowView, soloistMediaLine };
} else (function () {
  'use strict';

  const ext = () => window.launcher?.ext;
  const listeners = new Set();
  let status = null;

  /** Settings > General: status line under the Soloist options; the switch is locked off on unsupported platforms. */
  function paint() {
    const view = soloistRowView(status);
    const line = document.getElementById('soloist-status');
    if (line) {
      line.textContent = view.subtitle;
      line.dataset.state = view.state;
    }
    const toggle = document.getElementById('soloist-enabled');
    if (toggle) toggle.disabled = status?.state === 'unsupported';
  }

  function apply(next) {
    if (!next || typeof next.state !== 'string') return;
    status = next;
    paint();
    for (const listener of listeners) listener(status);
  }

  /** Re-reads settings.soloist in the main process (after Save) and reconciles the Soloist process. */
  async function reapply() {
    try { apply(await ext().invoke('soloist', 'apply')); } catch { /* status stays as it was */ }
  }

  function init() {
    const bridge = ext();
    if (!bridge) return;
    bridge.on('soloist', 'status', apply);
    // Settings are read by the main process at apply time: run once the model (and therefore the config) is ready.
    window.launcher.getModel().then(reapply).catch(() => {});
  }

  window.SoloistStatus = {
    init,
    reapply,
    paint,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mediaLine: (device) => soloistMediaLine(status, device)
  };
})();
