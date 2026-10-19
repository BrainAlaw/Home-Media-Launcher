(function (root) {
  'use strict';

  function rowKind(entry) {
    if (entry?.type === 'ethernet') return 'info';
    if (['vpn', 'toggle', 'action'].includes(entry?.kind)) return 'focusable';
    throw new TypeError(`Unknown quick settings entry kind: ${String(entry?.kind)}`);
  }

  function rowClass(entry) {
    return rowKind(entry) === 'info' ? 'qs-info' : 'qs-row';
  }

  const model = { rowKind, rowClass };
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.QuickSettingsModel = model;
})(typeof window !== 'undefined' ? window : null);
