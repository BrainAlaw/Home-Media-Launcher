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

  /** Pure view model for the game host chip and quick-settings host card. */
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

  return { formatAge, describeHost, STATUS_LABELS };
});
