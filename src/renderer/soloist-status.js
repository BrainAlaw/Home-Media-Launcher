/**
 * Soloist (local Spotify Connect player) status in the renderer: the quick-settings switch row and the "this computer"
 * line of the media widget. Data arrives through the `soloist` ext namespace only; the API key never reaches this file.
 * Pure helpers are exported for tests; the DOM wiring runs only in the browser.
 */

/** Longest subtitle shown on the quick-settings row. */
const SUBTITLE_MAX = 84;
const DEFAULT_DEVICE_NAME = 'Home Media Launcher';

/** First sentence of a main-process message, capped so the row stays on two lines. */
function shortenMessage(text) {
  const first = String(text ?? '').trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '');
  return first.length > SUBTITLE_MAX ? `${first.slice(0, SUBTITLE_MAX - 1)}…` : first;
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
  let busy = false;
  let showToast = () => {};

  const row = () => document.getElementById('soloist-row');

  function paint() {
    const element = row();
    if (!element) return;
    const view = soloistRowView(status);
    window.MenuSwitch.setSwitch(element, view.checked, { busy });
    element.dataset.state = view.state;
    element.setAttribute('aria-disabled', String(view.disabled));
    element.setAttribute('aria-label', `Soloist local player: ${view.subtitle}`);
    element.title = view.subtitle;
    const label = element.querySelector('small');
    if (label) label.textContent = view.subtitle;
  }

  function apply(next) {
    if (!next || typeof next.state !== 'string') return;
    status = next;
    paint();
    for (const listener of listeners) listener(status);
  }

  /** Persists `settings.soloist.enabled` through the normal settings save, then reconciles the process. */
  async function toggle() {
    const element = row();
    if (!element || busy || !status) return;
    const view = soloistRowView(status);
    if (view.disabled) { showToast(view.subtitle); return; }
    const wanted = !view.checked;
    busy = true;
    window.MenuSwitch.setSwitch(element, wanted, { busy: true });
    try {
      const config = await window.launcher.getSettings();
      const settings = config?.settings || {};
      await window.launcher.saveSettings({ ...config, settings: { ...settings, soloist: { ...(settings.soloist || {}), enabled: wanted } } });
      apply(await ext().invoke('soloist', 'apply'));
    } catch (error) {
      showToast(`Soloist: ${shortenMessage(error?.message) || 'could not change the setting'}`);
    } finally {
      busy = false;
      paint();
    }
  }

  function init(options = {}) {
    showToast = options.showToast || showToast;
    const element = row();
    if (element) element.addEventListener('click', () => { void toggle(); });
    const bridge = ext();
    if (!bridge) return;
    bridge.on('soloist', 'status', apply);
    // Settings are read by the main process at apply time: run once the model (and therefore the config) is ready.
    window.launcher.getModel()
      .then(() => bridge.invoke('soloist', 'apply'))
      .then(apply)
      .catch(() => {});
  }

  window.SoloistStatus = {
    init,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mediaLine: (device) => soloistMediaLine(status, device)
  };
})();
