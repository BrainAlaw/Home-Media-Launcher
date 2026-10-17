/**
 * Header and quick-settings status widgets: network, VPN and weather.
 * All data arrives through the namespaced ext bridge (`system`, `vpn`, `weather`); no secrets or network
 * access live in the renderer. Every widget degrades silently when its provider is unavailable.
 */
/** Longest subtitle we show on one quick-settings line before it is shortened (the row may still wrap to two lines). */
const SUBTITLE_MAX = 44;

/** Shortens `text` to `max` characters, keeping both ends so host names and addresses stay recognisable. */
function shortenMiddle(text, max = SUBTITLE_MAX) {
  const value = String(text ?? '').trim();
  if (value.length <= max) return value;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${value.slice(0, head)}…${value.slice(value.length - (keep - head))}`;
}

/** First sentence of a provider error, capped at two lines of the row, so the cause stays readable. */
function shortenError(text) {
  const first = String(text ?? '').trim().split(/(?<=[.!?])\s/)[0];
  const clean = first.replace(/[.!?]$/, '');
  return clean.length > 84 ? `${clean.slice(0, 83)}…` : clean;
}

/**
 * Subtitle for a VPN row. Always explains the state: connected (with a shortened host/address), working, off, or why a
 * provider is unavailable. Never returns an empty string.
 * @param {{ available?: boolean, connected?: boolean, busy?: boolean, detail?: string, error?: string }} entry
 */
function vpnSubtitle(entry) {
  if (entry?.error) return shortenError(entry.error);
  if (entry?.busy) return 'Working…';
  if (entry?.connected) {
    const detail = String(entry.detail ?? '').split(/\s*·\s*/).filter(Boolean);
    // Tailscale reports "host · address"; the address is the useful part on a TV, the host name is shortened.
    const text = detail.length > 1 ? `${shortenMiddle(detail[0], 22)} · ${detail[detail.length - 1]}` : shortenMiddle(detail[0] || '', SUBTITLE_MAX);
    return text ? `Connected · ${text}` : 'Connected';
  }
  return entry?.available ? 'Off' : 'Not available on this PC';
}

/** Provider errors that mean "this VPN is simply not set up here"; such providers get no header chip. */
const NOT_CONFIGURED = /not (installed|found|configured|set up|available|supported)|no (surfshark|tailscale|vpn|profile|connection)|couldn.?t find|missing|cannot find|unknown (command|service)/i;

/**
 * Header chip for one VPN provider. Hidden only when the provider is unavailable AND not configured; an unavailable
 * but configured provider stays visible in neutral grey so the user can open quick settings and read the reason.
 * @param {{ label?: string, available?: boolean, connected?: boolean, busy?: boolean, error?: string } | undefined} entry
 * @returns {{ hidden: boolean, tone: 'on' | 'off' | 'busy' | 'idle', label: string }}
 */
function vpnChipView(entry) {
  const name = entry?.label || 'VPN';
  if (!entry) return { hidden: true, tone: 'idle', label: `${name} unavailable` };
  if (entry.busy) return { hidden: false, tone: 'busy', label: `${name}: working` };
  if (entry.available) {
    return entry.connected
      ? { hidden: false, tone: 'on', label: `${name} connected` }
      : { hidden: false, tone: 'off', label: `${name} disconnected` };
  }
  const configured = Boolean(entry.error) && !NOT_CONFIGURED.test(entry.error);
  return { hidden: !configured, tone: 'idle', label: `${name} unavailable` };
}

/**
 * Header chip for the Vibepollo game host.
 * @param {import('../../backend/contracts').VibepolloHostInfo | null | undefined} info
 * @param {{ describeHost: Function }} sections `HomeSections` (injected so this stays pure and testable)
 * @returns {{ hidden: boolean, tone: 'on' | 'off' | 'warn' | 'idle', label: string }}
 */
function hostChipView(info, sections, now = Date.now()) {
  const view = sections.describeHost(info, now);
  if (view.hidden) return { hidden: true, tone: 'idle', label: 'Game host unavailable' };
  const tone = view.state === 'online' ? 'on' : view.state === 'cached' ? 'warn' : 'off';
  return { hidden: false, tone, label: `Game host ${view.name}: ${view.statusLabel}` };
}

if (typeof module === 'object' && module.exports) {
  module.exports = { shortenMiddle, shortenError, vpnSubtitle, vpnChipView, hostChipView };
} else (function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WEATHER_REFRESH_MS = 30 * 60 * 1000;
  const { signalLevel, networkLabel, networkDetail, wmoToIcon, wmoCondition, vpnSummary } = window.StatusFormat;

  const $ = (selector) => document.querySelector(selector);
  const ext = () => window.launcher?.ext;

  let showToast = () => {};
  let vpnList = [];
  const vpnRows = new Map();
  let weatherTimer = null;
  let weatherToken = 0;
  let lastWeatherKey = '';
  const deferred = new Map();

  /** Runs `render` now, or once the quick-settings sheet has finished animating (latest call per key wins). */
  function whenPanelIdle(key, render) {
    const panel = $('#system-panel');
    if (panel?.dataset.animating !== 'true') { deferred.delete(key); render(); return; }
    const pending = deferred.has(key);
    deferred.set(key, render);
    if (pending) return;
    const retry = () => {
      if (panel.dataset.animating === 'true') { setTimeout(retry, 120); return; }
      const next = deferred.get(key); deferred.delete(key); next?.();
    };
    setTimeout(retry, 120);
  }

  function svg(markup, className) {
    const template = document.createElement('template');
    template.innerHTML = `<svg viewBox="0 0 24 24" class="${className}" aria-hidden="true" focusable="false">${markup}</svg>`;
    return template.content.firstElementChild;
  }

  /* ------------------------------------------------------------------ network */

  function networkGlyph(status) {
    if (status?.type === 'ethernet' && status.connected) {
      return svg('<rect x="4" y="5" width="16" height="10" rx="2"/><path d="M8 15v3M12 15v3M16 15v3M7 9v2M10 9v2M13 9v2M16 9v2"/>', 'status-glyph');
    }
    const level = status?.connected ? (status.type === 'wifi' ? signalLevel(status.signal ?? 100) || 1 : 0) : 0;
    const bars = [[4, 17, 3, 3], [9, 13, 3, 7], [14, 9, 3, 11], [19, 5, 3, 15]]
      .map(([x, y, width, height], index) => `<rect x="${x - 1}" y="${y}" width="${width}" height="${height}" rx="1" class="bar" data-lit="${index < level}"/>`).join('');
    const slash = status?.connected ? '' : '<path d="M3 3l18 18" class="slash"/>';
    return svg(bars + slash, 'status-glyph');
  }

  function renderNetwork(status) { whenPanelIdle('network', () => paintNetwork(status)); }

  function paintNetwork(status) {
    const indicator = $('#network-indicator');
    if (indicator) {
      indicator.hidden = false;
      indicator.dataset.state = status?.connected ? status.type : 'offline';
      indicator.setAttribute('aria-label', networkLabel(status));
      indicator.title = `${networkLabel(status)}${status?.connected ? ` — ${networkDetail(status)}` : ''}`;
      indicator.replaceChildren(networkGlyph(status));
    }
    const card = $('#network-card');
    if (card) {
      card.querySelector('.status-card-icon').replaceChildren(networkGlyph(status));
      card.querySelector('strong').textContent = networkLabel(status);
      card.querySelector('small').textContent = networkDetail(status);
    }
  }

  /* ------------------------------------------------------------------ glyphs */

  const SHIELD = '<path d="M12 3 5 6v5c0 4.6 2.9 8.2 7 10 4.1-1.8 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2.2 2.2L15.2 10" class="check"/>';
  /** 3x3 dot matrix (an original mesh-network mark): lit and dimmed dots. */
  const TAILSCALE_PATTERN = [[0, 1, 1], [1, 1, 1], [0, 1, 0]];
  const TAILSCALE = TAILSCALE_PATTERN.map((row, r) => row.map((lit, c) =>
    `<circle cx="${5.5 + c * 6.5}" cy="${5.5 + r * 6.5}" r="2.1" class="dot" data-lit="${Boolean(lit)}"/>`).join('')).join('');
  /** Shark fin over a wave line. */
  const SURFSHARK = '<path d="M7 15.5c.3-5.2 2.8-9 6.3-11.5.1 3.7 1.5 8.4 4.7 11.5H7Z" class="fin"/><path d="M3.5 19.5c1.6-1.2 3-1.2 4.6 0s3 1.2 4.6 0 3-1.2 4.6 0 3 1.2 4.6 0" class="wave"/>';
  const COMPUTER = '<rect x="3" y="4.5" width="18" height="11.5" rx="2.2"/><path d="M9 20h6M12 16v4"/>';
  const VPN_GLYPHS = { tailscale: TAILSCALE, surfshark: SURFSHARK };
  const vpnGlyph = (id, className = 'status-glyph') => svg(VPN_GLYPHS[id] || SHIELD, `${className} glyph-${id}`);

  /* ------------------------------------------------------------------ chips */

  /** Paints a header chip: glyph, bottom-right status dot, accessible name and visibility. */
  function paintChip(chip, view, glyph) {
    if (!chip) return;
    chip.hidden = view.hidden;
    chip.dataset.tone = view.tone;
    chip.setAttribute('aria-label', `${view.label}. Open quick settings`);
    chip.title = view.label;
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.setAttribute('aria-hidden', 'true');
    chip.replaceChildren(glyph, dot);
  }

  function renderVpnIndicators() {
    for (const id of ['tailscale', 'surfshark']) {
      const entry = vpnList.find((candidate) => candidate.id === id);
      paintChip($(`#${id}-indicator`), vpnChipView(entry), vpnGlyph(id));
    }
  }

  /* ------------------------------------------------------------------ host */

  const HOST_REFRESH_MS = 60_000;
  let hostInfo = null;
  let hostTimer = null;

  function paintHost() {
    const sections = window.HomeSections;
    const view = sections.describeHost(hostInfo);
    paintChip($('#host-indicator'), hostChipView(hostInfo, sections), svg(COMPUTER, 'status-glyph'));
    const card = $('#host-card');
    if (!card) return;
    card.hidden = view.hidden;
    card.dataset.state = view.state;
    card.dataset.tone = hostChipView(hostInfo, sections).tone;
    if (view.hidden) return;
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    card.querySelector('.status-card-icon').replaceChildren(svg(COMPUTER, 'status-glyph'), dot);
    card.querySelector('strong').textContent = view.name;
    const [detail, sync] = card.querySelectorAll('small');
    detail.textContent = [view.ip, view.statusLabel].filter(Boolean).join(' \u00b7 ');
    sync.textContent = view.syncLabel;
  }

  function applyHost(info) { hostInfo = info || null; whenPanelIdle('host', paintHost); }

  /* ------------------------------------------------------------------ VPN */

  function createVpnRow(entry) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'menu-action menu-toggle vpn-row';
    row.dataset.vpnId = entry.id;
    row.setAttribute('role', 'switch');
    row.setAttribute('aria-checked', 'false');
    const symbol = document.createElement('span'); symbol.className = 'menu-symbol'; symbol.setAttribute('aria-hidden', 'true');
    symbol.append(vpnGlyph(entry.id));
    const copy = document.createElement('span'); copy.className = 'menu-copy';
    copy.append(document.createElement('strong'), document.createElement('small'));
    row.append(symbol, copy, window.MenuSwitch.createTrack());
    row.addEventListener('click', () => onVpnToggle(entry.id, row));
    return row;
  }

  async function onVpnToggle(id, row) {
    const entry = vpnList.find((candidate) => candidate.id === id);
    const wanted = !window.MenuSwitch.isOn(row);
    if (!entry?.available || entry.busy) {
      if (entry && !entry.available) showToast(entry.error || `${entry.label} is unavailable`);
      return;
    }
    window.MenuSwitch.setSwitch(row, wanted, { busy: true });
    try { applyVpnList(await ext().invoke('vpn', 'toggle', id, wanted)); }
    catch (error) { window.MenuSwitch.setSwitch(row, !wanted); showToast(`VPN: ${error.message}`); }
  }

  function applyVpnList(list) { whenPanelIdle('vpn', () => paintVpnList(list)); }

  function paintVpnList(list) {
    vpnList = Array.isArray(list) ? list : [];
    const host = $('#vpn-rows');
    if (host) {
      for (const entry of vpnList) {
        let row = vpnRows.get(entry.id);
        if (!row) { row = createVpnRow(entry); vpnRows.set(entry.id, row); host.append(row); }
        row.querySelector('strong').textContent = entry.label;
        row.querySelector('small').textContent = vpnSubtitle(entry);
        row.title = entry.error || entry.detail || '';
        row.dataset.state = entry.busy ? 'busy' : entry.connected ? 'on' : entry.available ? 'off' : 'unavailable';
        row.setAttribute('aria-disabled', String(!entry.available));
        window.MenuSwitch.setSwitch(row, entry.connected, { busy: entry.busy });
        row.setAttribute('aria-label', `${entry.label} VPN`);
      }
    }
    renderVpnIndicators();
  }

  /** Quick-settings control a header chip should land on: a VPN switch row, or the first action for the host chip. */
  function controlFor(target) {
    return vpnRows.get(target) || $('#settings-button');
  }

  /* ------------------------------------------------------------------ weather */

  async function fetchSnapshot(location) {
    const bridge = ext();
    if (bridge) {
      try {
        if (await bridge.invoke('weather', 'available')) return await bridge.invoke('weather', 'get', location);
      } catch { /* provider failure: use the keyless fallback below */ }
    }
    const fallback = await window.launcher.getWeather(location);
    if (!fallback || !Number.isFinite(fallback.temperature)) return null;
    const hour = new Date().getHours();
    return {
      location: fallback.location, temperature: Math.round(fallback.temperature), feelsLike: Math.round(fallback.temperature),
      condition: wmoCondition(fallback.code), icon: wmoToIcon(fallback.code, hour >= 6 && hour < 20), forecast: [], fetchedAt: Date.now()
    };
  }

  function renderWeather(snapshot) { whenPanelIdle('weather', () => paintWeather(snapshot)); }

  function paintWeather(snapshot) {
    const header = $('#weather');
    const card = $('#weather-card');
    if (!snapshot) {
      header.textContent = 'Weather unavailable';
      card.hidden = true;
      return;
    }
    const text = document.createElement('span');
    text.className = 'weather-text';
    text.textContent = `${snapshot.temperature}°C ${snapshot.condition}`;
    header.replaceChildren(window.WeatherIcons.create(snapshot.icon), text);
    header.title = `${snapshot.location} · feels like ${snapshot.feelsLike}°C`;
    header.setAttribute('aria-label', `Weather in ${snapshot.location}: ${snapshot.temperature} degrees, ${snapshot.condition}`);
    card.hidden = false;
    card.querySelector('.status-card-icon').replaceChildren(window.WeatherIcons.create(snapshot.icon));
    card.querySelector('strong').textContent = `${snapshot.location} · ${snapshot.temperature}°C`;
    card.querySelector('small').textContent = `${snapshot.condition} · feels like ${snapshot.feelsLike}°C`;
    const strip = card.querySelector('.forecast-strip');
    strip.replaceChildren(...snapshot.forecast.slice(0, 5).map((day) => {
      const item = document.createElement('li');
      const label = document.createElement('span'); label.textContent = day.day;
      const range = document.createElement('small'); range.textContent = `${day.max}° / ${day.min}°`;
      item.append(label, window.WeatherIcons.create(day.icon), range);
      return item;
    }));
    strip.hidden = snapshot.forecast.length === 0;
  }

  /** Called by the header refresh; shows or hides the weather widgets and keeps them current. */
  async function updateWeather(header) {
    const weatherKey = `${Boolean(header.showWeather)}|${header.weatherLocation || ''}`;
    // Model refreshes (saves, remote sync) must not flicker the header or refetch when nothing changed.
    if (weatherTimer && weatherKey === lastWeatherKey) return;
    lastWeatherKey = weatherKey;
    clearInterval(weatherTimer);
    weatherTimer = null;
    const token = ++weatherToken;
    const element = $('#weather');
    element.hidden = !header.showWeather;
    if (!header.showWeather) { $('#weather-card').hidden = true; return; }
    const location = header.weatherLocation || 'London';
    const load = async () => {
      let snapshot = null;
      try { snapshot = await fetchSnapshot(location); } catch { /* shown as unavailable */ }
      if (token === weatherToken) renderWeather(snapshot);
    };
    element.textContent = 'Weather…';
    weatherTimer = setInterval(load, WEATHER_REFRESH_MS);
    await load();
  }

  /* ------------------------------------------------------------------ wiring */

  function init(options = {}) {
    showToast = options.showToast || showToast;
    renderNetwork(null);
    const bridge = ext();
    if (!bridge) return;
    bridge.on('system', 'network', renderNetwork);
    bridge.invoke('system', 'getNetwork').then(renderNetwork).catch(() => {});
    bridge.on('vpn', 'status', applyVpnList);
    bridge.invoke('vpn', 'list').then(applyVpnList).catch(() => {});
    bridge.on('remote', 'host', applyHost);
    bridge.invoke('remote', 'getHostInfo').then(applyHost).catch(() => {});
    // The "synced N min ago" label ages on its own.
    hostTimer = setInterval(() => whenPanelIdle('host', paintHost), HOST_REFRESH_MS);
  }

  window.addEventListener('pagehide', () => clearInterval(hostTimer), { once: true });

  window.StatusWidgets = { init, updateWeather, controlFor };
})();
