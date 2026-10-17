(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeSections = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @typedef {{ hostname: string, ip: string, status: 'online' | 'offline' | 'cached' | 'disabled', lastSyncAt?: number }} HostInfo
   * @typedef {{ hidden: boolean, state: string, name: string, ip: string, statusLabel: string, syncLabel: string }} HostView
   */

  const STATUS_LABELS = Object.freeze({ online: 'Online', offline: 'Offline', cached: 'Cached' });

  /** Compact relative time such as "just now", "5 min ago" or "2 h ago". */
  function formatAge(timestamp, now = Date.now()) {
    if (!Number.isFinite(timestamp)) return '';
    const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  /** Pure view model for the Gaming header badge. */
  function describeHost(info, now = Date.now()) {
    const status = info?.status;
    if (!info || !(status in STATUS_LABELS) || !(info.hostname || info.ip)) {
      return { hidden: true, state: 'disabled', name: '', ip: '', statusLabel: '', syncLabel: '' };
    }
    const age = formatAge(info.lastSyncAt, now);
    return {
      hidden: false,
      state: status,
      name: info.hostname || info.ip,
      ip: info.hostname && info.ip && info.ip !== info.hostname ? info.ip : '',
      statusLabel: STATUS_LABELS[status],
      syncLabel: age ? `Synced ${age}` : 'Not synced yet'
    };
  }

  /** Builds the host badge element; `update(info)` re-renders it without recreating nodes. */
  function createHostBadge(doc = document) {
    const element = doc.createElement('div');
    element.className = 'host-badge';
    element.setAttribute('role', 'status');
    element.hidden = true;
    const dot = doc.createElement('span');
    dot.className = 'host-dot';
    dot.setAttribute('aria-hidden', 'true');
    const name = doc.createElement('strong');
    name.className = 'host-name';
    const ip = doc.createElement('span');
    ip.className = 'host-ip';
    const state = doc.createElement('span');
    state.className = 'host-state';
    const sync = doc.createElement('span');
    sync.className = 'host-sync';
    element.append(dot, name, ip, state, sync);
    let current = null;

    function render(now = Date.now()) {
      const view = describeHost(current, now);
      element.hidden = view.hidden;
      element.dataset.state = view.state;
      name.textContent = view.name;
      ip.textContent = view.ip;
      ip.hidden = !view.ip;
      state.textContent = view.statusLabel;
      sync.textContent = view.syncLabel;
    }
    return {
      element,
      update(info) { current = info || null; render(); },
      refresh() { render(); }
    };
  }

  return { formatAge, describeHost, createHostBadge, STATUS_LABELS };
});
