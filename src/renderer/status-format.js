(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StatusFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Maps a 0-100 Wi-Fi signal to 0-4 lit bars. */
  function signalLevel(signal) {
    if (!Number.isFinite(signal)) return 0;
    if (signal >= 75) return 4;
    if (signal >= 50) return 3;
    if (signal >= 25) return 2;
    return signal > 0 ? 1 : 0;
  }

  function networkLabel(status) {
    if (!status || status.type === 'unknown') return 'Network status unavailable';
    if (!status.connected || status.type === 'none') return 'Offline';
    if (status.type === 'ethernet') return 'Ethernet';
    return status.ssid ? `Wi-Fi: ${status.ssid}` : 'Wi-Fi';
  }

  function networkDetail(status) {
    if (!status?.connected) return 'Not connected';
    const parts = [];
    if (status.type === 'wifi' && Number.isFinite(status.signal)) parts.push(`${Math.round(status.signal)}% signal`);
    if (status.ip) parts.push(status.ip);
    return parts.join(' · ') || 'Connected';
  }

  /** Open-Meteo WMO code -> OpenWeatherMap icon code, so the fallback provider shares the bundled icon set. */
  function wmoToIcon(code, daytime = true) {
    const suffix = daytime ? 'd' : 'n';
    if (code === 0) return `01${suffix}`;
    if (code === 1) return `02${suffix}`;
    if (code === 2) return `03${suffix}`;
    if (code === 3) return `04${suffix}`;
    if (code === 45 || code === 48) return `50${suffix}`;
    if (code >= 51 && code <= 57) return `09${suffix}`;
    if (code >= 61 && code <= 67) return `10${suffix}`;
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return `13${suffix}`;
    if (code >= 80 && code <= 82) return `09${suffix}`;
    if (code >= 95) return `11${suffix}`;
    return `03${suffix}`;
  }

  const WMO_TEXT = [[0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Overcast'], [48, 'Fog'], [57, 'Drizzle'], [67, 'Rain'], [77, 'Snow'], [82, 'Showers'], [86, 'Snow showers'], [99, 'Thunderstorm']];
  function wmoCondition(code) {
    return (WMO_TEXT.find(([max]) => code <= max) || [0, 'Unknown'])[1];
  }

  /** Header chip state: connected count and whether any toggle is mid-flight. */
  function vpnSummary(list) {
    const usable = (Array.isArray(list) ? list : []).filter((entry) => entry.available);
    const active = usable.filter((entry) => entry.connected);
    return {
      state: usable.some((entry) => entry.busy) ? 'busy' : active.length ? 'on' : usable.length ? 'off' : 'unavailable',
      label: active.length ? `VPN connected: ${active.map((entry) => entry.label).join(', ')}` : usable.length ? 'VPN off' : 'VPN unavailable'
    };
  }

  return { signalLevel, networkLabel, networkDetail, wmoToIcon, wmoCondition, vpnSummary };
});
