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

/**
 * Tone of the network dot from the latest ping. Unknown (no probe yet) is grey, a failed probe red, then green/amber/red by latency.
 * @param {{ ms: number | null } | null | undefined} ping
 * @returns {'idle' | 'on' | 'warn' | 'off'}
 */
function pingTone(ping) {
  if (!ping) return 'idle';
  if (!Number.isFinite(ping.ms)) return 'off';
  return ping.ms < 60 ? 'on' : ping.ms < 150 ? 'warn' : 'off';
}

/** Mbps with sensible precision: whole numbers from 100 up, one decimal below. */
function formatMbps(value) {
  const mbps = Number.isFinite(value) ? Math.max(0, value) : 0;
  return mbps >= 100 ? String(Math.round(mbps)) : mbps.toFixed(1);
}

/**
 * Subtitle of the network row: link detail plus live ping, or the speed test progress/result while one is relevant.
 * @param {{ detail: string, ping?: { ms: number | null } | null, speed?: { state: string, mbps?: number, averageMbps?: number, elapsedMs?: number, durationMs?: number, pingMs?: number } | null }} input
 */
function networkLine({ detail, ping, speed }) {
  if (speed?.state === 'running') {
    const left = Math.max(0, Math.ceil(((speed.durationMs || 0) - (speed.elapsedMs || 0)) / 1000));
    return `Testing… ${formatMbps(speed.mbps)} Mbps · ${left}s left`;
  }
  if (speed?.state === 'done') {
    const pingMs = Number.isFinite(speed.pingMs) ? speed.pingMs : ping?.ms;
    return `↓ ${formatMbps(speed.averageMbps)} Mbps${Number.isFinite(pingMs) ? ` · ping ${pingMs} ms` : ''}`;
  }
  if (speed?.state === 'error') return 'Speed test failed. Check the connection.';
  const pingText = !ping ? '' : Number.isFinite(ping.ms) ? `ping ${ping.ms} ms` : 'no internet';
  return [detail, pingText].filter(Boolean).join(' · ');
}

/**
 * Result line of a finished speed test: "↓ x Mbps · ↑ y Mbps" (download and upload averages).
 * @param {{ downMbps?: number, upMbps?: number }} speed
 */
function resultLine(speed) {
  return `↓ ${formatMbps(speed?.downMbps)} Mbps · ↑ ${formatMbps(speed?.upMbps)} Mbps`;
}

if (typeof module === 'object' && module.exports) {
  module.exports = { shortenMiddle, shortenError, vpnSubtitle, vpnChipView, hostChipView, pingTone, formatMbps, networkLine, resultLine };
} else (function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WEATHER_REFRESH_MS = 30 * 60 * 1000;
  /** Repaint cadence while the result line fades out (the fade itself is only opacity). */
  const FADE_TICK_MS = 50;
  const { signalLevel, networkLabel, networkDetail, wmoToIcon, wmoCondition, vpnSummary } = window.StatusFormat;

  const $ = (selector) => document.querySelector(selector);
  const ext = () => window.launcher?.ext;

  let showToast = () => {};
  let lastNetwork = null;
  let lastPing = null;
  let speed = null;
  let cardTimer = null;
  let vpnList = [];
  const vpnRows = new Map();
  let weatherTimer = null;
  let weatherLoad = null;
  /** True while an external application owns the screen: renderer timers are paused until the session is idle again. */
  let sessionSuspended = false;
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

  function renderNetwork(status) { lastNetwork = status; whenPanelIdle('network', paintNetwork); }
  function applyPing(ping) { lastPing = ping || null; whenPanelIdle('network', paintNetwork); }

  /** Progress events arrive a few times a second while a test runs; the finished result stays on the row until the next test. */
  function applySpeed(snapshot) {
    speed = snapshot && snapshot.state !== 'idle' ? snapshot : null;
    whenPanelIdle('network', paintNetwork);
  }

  function statusDot() {
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.setAttribute('aria-hidden', 'true');
    return dot;
  }

  /**
   * Text and opacity of the network card for the current time. `SpeedCardModel` (speed-card-model.js) decides the view:
   * 'ip' (IP and ping), 'result' (result line, held) or 'fading' (result line at `fadeOpacity`, then back to 'ip').
   */
  function networkCardContent(status, now) {
    const detail = networkDetail(status);
    if (speed?.state === 'running' || speed?.state === 'error') {
      return { text: networkLine({ detail, ping: lastPing, speed }), opacity: 1 };
    }
    const model = window.SpeedCardModel;
    // The model takes one object; the finish time is the main process `doneAt` stamp.
    const view = model.cardView({ speed, finishedAt: speed?.doneAt, now });
    if (view === 'ip') return { text: networkLine({ detail, ping: lastPing }), opacity: 1 };
    // fadeOpacity takes the elapsed time since the fade started, not since the test finished.
    const fadeElapsed = Number.isFinite(speed?.doneAt) ? now - speed.doneAt - model.RESULT_HOLD_MS : 0;
    return { text: resultLine(speed), opacity: view === 'fading' ? model.fadeOpacity(view, fadeElapsed) : 1 };
  }

  /** Schedules the next repaint at the hold and fade boundaries of a finished test; no timer otherwise. */
  function scheduleCardTick(now) {
    clearTimeout(cardTimer);
    cardTimer = null;
    if (speed?.state !== 'done' || !Number.isFinite(speed.doneAt)) return;
    const { RESULT_HOLD_MS, FADE_MS } = window.SpeedCardModel;
    const age = now - speed.doneAt;
    if (age >= RESULT_HOLD_MS + FADE_MS) return;
    const wait = age < RESULT_HOLD_MS ? RESULT_HOLD_MS - age : FADE_TICK_MS;
    cardTimer = setTimeout(() => whenPanelIdle('network', paintNetwork), wait);
  }

  function paintNetwork() {
    const status = lastNetwork;
    const tone = status?.connected ? pingTone(lastPing) : 'off';
    const indicator = $('#network-indicator');
    if (indicator) {
      indicator.hidden = false;
      indicator.dataset.state = status?.connected ? status.type : 'offline';
      indicator.dataset.tone = tone;
      const ping = Number.isFinite(lastPing?.ms) ? ` — ping ${lastPing.ms} ms` : '';
      indicator.setAttribute('aria-label', networkLabel(status));
      indicator.title = `${networkLabel(status)}${status?.connected ? ` — ${networkDetail(status)}` : ''}${ping}`;
      indicator.replaceChildren(networkGlyph(status), statusDot());
    }
    const card = $('#network-card');
    if (!card) return;
    const now = Date.now();
    const content = networkCardContent(status, now);
    card.dataset.tone = tone;
    card.dataset.speed = speed?.state || 'idle';
    card.querySelector('.menu-symbol').replaceChildren(networkGlyph(status), statusDot());
    card.querySelector('strong').textContent = networkLabel(status);
    const line = card.querySelector('small');
    line.textContent = content.text;
    line.style.opacity = String(content.opacity);
    card.querySelector('.qs-speed-button').textContent = speed?.state === 'running' ? 'Cancel' : 'Speed test';
    const fill = card.querySelector('.net-progress i');
    const fraction = speed?.state === 'running' ? Math.min(1, (speed.elapsedMs || 0) / (speed.durationMs || 1)) : 0;
    fill.style.transform = `scaleX(${fraction})`;
    scheduleCardTick(now);
  }

  async function onSpeedToggle() {
    const bridge = ext();
    if (!bridge) return;
    try {
      applySpeed(await bridge.invoke('system', speed?.state === 'running' ? 'cancelSpeedTest' : 'startSpeedTest'));
    } catch (error) { showToast(`Speed test: ${error.message}`); }
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

  /** Paints a header status indicator: glyph, bottom-right status dot, accessible name and visibility. */
  function paintChip(chip, view, glyph) {
    if (!chip) return;
    chip.hidden = view.hidden;
    chip.dataset.tone = view.tone;
    chip.setAttribute('aria-label', view.label);
    chip.title = view.label;
    chip.replaceChildren(glyph, statusDot());
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
    row.className = 'menu-action menu-toggle qs-row vpn-row';
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
    if (weatherLoad && weatherKey === lastWeatherKey) return;
    lastWeatherKey = weatherKey;
    clearInterval(weatherTimer);
    weatherTimer = null;
    weatherLoad = null;
    const token = ++weatherToken;
    const element = $('#weather');
    element.hidden = !header.showWeather;
    if (!header.showWeather) { $('#weather-card').hidden = true; return; }
    const location = (header.weatherLocation || '').trim();
    if (!location) {
      // No location configured: never guess one (no IP lookup); point the user at Settings instead.
      element.textContent = 'Set your location in Settings';
      $('#weather-card').hidden = true;
      return;
    }
    const load = async () => {
      let snapshot = null;
      try { snapshot = await fetchSnapshot(location); } catch { /* shown as unavailable */ }
      if (token === weatherToken) renderWeather(snapshot);
    };
    element.textContent = 'Weather…';
    weatherLoad = load;
    if (sessionSuspended) return;
    weatherTimer = setInterval(load, WEATHER_REFRESH_MS);
    await load();
  }

  /* ------------------------------------------------------------------ session gate */

  function armTimers() {
    clearInterval(weatherTimer);
    clearInterval(hostTimer);
    weatherTimer = null;
    hostTimer = null;
    if (sessionSuspended) return;
    if (weatherLoad) weatherTimer = setInterval(weatherLoad, WEATHER_REFRESH_MS);
    hostTimer = setInterval(() => whenPanelIdle('host', paintHost), HOST_REFRESH_MS);
  }

  /** Pauses the polling timers while a session is launching/running/closing; resumes with ONE immediate refresh. */
  function applySessionPhase(snapshot) {
    const next = Boolean(snapshot?.phase) && snapshot.phase !== 'idle';
    if (next === sessionSuspended) return;
    sessionSuspended = next;
    armTimers();
    if (next) return;
    if (weatherLoad) void weatherLoad();
    whenPanelIdle('host', paintHost);
  }

  /* ------------------------------------------------------------------ wiring */

  function init(options = {}) {
    showToast = options.showToast || showToast;
    renderNetwork(null);
    const bridge = ext();
    if (!bridge) return;
    bridge.on('system', 'network', renderNetwork);
    bridge.invoke('system', 'getNetwork').then(renderNetwork).catch(() => {});
    bridge.on('system', 'ping', applyPing);
    bridge.invoke('system', 'getPing').then((ping) => { if (ping?.at) applyPing(ping); }).catch(() => {});
    bridge.on('system', 'speedtest', applySpeed);
    bridge.invoke('system', 'getSpeedTest').then(applySpeed).catch(() => {});
    $('#speed-button')?.addEventListener('click', onSpeedToggle);
    bridge.on('vpn', 'status', applyVpnList);
    bridge.invoke('vpn', 'list').then(applyVpnList).catch(() => {});
    bridge.on('session', 'phase', applySessionPhase);
    bridge.invoke('session', 'getPhase').then(applySessionPhase).catch(() => {});
    bridge.on('remote', 'host', applyHost);
    bridge.invoke('remote', 'getHostInfo').then(applyHost).catch(() => {});
    // The "synced N min ago" label ages on its own.
    hostTimer = setInterval(() => whenPanelIdle('host', paintHost), HOST_REFRESH_MS);
  }

  window.addEventListener('pagehide', () => clearInterval(hostTimer), { once: true });

  window.StatusWidgets = { init, updateWeather };
})();
