/**
 * Home header runtime (agent H1): date, clock, layout switch, staggered reveal and OLED protection.
 * Pure helpers are exported for tests; `create()` wires them to the DOM. Only transform and opacity ever animate.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeHeader = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LAYOUTS = Object.freeze(['split', 'centred']);
  /** Location used when settings.header.weatherLocation is empty (OpenWeatherMap "name,country" form). */
  const DEFAULT_WEATHER_LOCATION = 'High Wycombe,GB';
  const SHIFT_AMPLITUDE_PX = 4;
  const SHIFT_STEP_MS = 30 * 1000;
  const DIM_AFTER_MS = 2 * 60 * 1000;
  const REVEAL_FALLBACK_MS = 2500;

  /**
   * Normalises settings.homeHeader; unknown or invalid values fall back to the defaults.
   * @param {{ layout?: string, showSeconds?: boolean, oledProtection?: boolean, fadeIn?: boolean } | undefined} raw
   * @returns {{ layout: 'split' | 'centred', showSeconds: boolean, oledProtection: boolean, fadeIn: boolean }}
   */
  function normaliseHeaderSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      layout: LAYOUTS.includes(value.layout) ? value.layout : 'split',
      showSeconds: value.showSeconds === true,
      oledProtection: value.oledProtection !== false,
      fadeIn: value.fadeIn !== false
    };
  }

  /** Header settings with the weather location defaulted for the UK user. */
  function headerWithDefaults(header) {
    const value = header && typeof header === 'object' ? header : {};
    return { ...value, weatherLocation: (typeof value.weatherLocation === 'string' && value.weatherLocation.trim()) || DEFAULT_WEATHER_LOCATION };
  }

  const pad = (number) => String(number).padStart(2, '0');

  /** 24-hour clock text, "HH:MM" or "HH:MM:SS". */
  function formatClock(date, showSeconds) {
    const base = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return showSeconds ? `${base}:${pad(date.getSeconds())}` : base;
  }

  const WEEKDAYS = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
  const FULL_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  /** Large weekday plus a smaller full date, e.g. { weekday: 'Saturday', date: '17 October 2026' }. */
  function formatDateParts(date) {
    return { weekday: WEEKDAYS.format(date), date: FULL_DATE.format(date) };
  }

  /**
   * OLED pixel shift: a very slow Lissajous drift (periods of about 13 and 19 minutes) quantised to whole pixels
   * within +/-4 px, so static header elements never sit on the same pixels for long.
   * @param {number} elapsedMs milliseconds since the shift started
   * @returns {{ x: number, y: number }}
   */
  function pixelShift(elapsedMs) {
    const x = Math.round(SHIFT_AMPLITUDE_PX * Math.sin((2 * Math.PI * elapsedMs) / (13 * 60 * 1000)));
    const y = Math.round(SHIFT_AMPLITUDE_PX * Math.sin((2 * Math.PI * elapsedMs) / (19 * 60 * 1000) + 1));
    return { x, y };
  }

  /** Milliseconds until the clock text can next change (the next second, or the next minute without seconds). */
  function msUntilTick(now, showSeconds) {
    const wait = showSeconds ? 1000 - now.getMilliseconds() : 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    return Math.max(50, wait + 20);
  }

  /**
   * @param {{ document?: Document, now?: () => Date }} [options]
   */
  function create({ document: doc = document, now = () => new Date() } = {}) {
    const body = doc.body;
    const header = doc.querySelector('main > header');
    const clockNode = doc.querySelector('#clock');
    const weekdayNode = doc.querySelector('#date .date-weekday');
    const dateNode = doc.querySelector('#date .date-full');
    let settings = normaliseHeaderSettings(undefined);
    let clockText = '';
    let weekdayText = '';
    let dateText = '';
    let tickTimer = null;
    let shiftTimer = null;
    let dimTimer = null;
    let revealTimer = null;
    let startedAt = Date.now();
    let revealed = false;
    let dimmed = false;
    let lastWake = 0;

    /** Only touches the DOM when a visible string changes, so idle seconds cause no style or layout work. */
    function paint() {
      const current = now();
      const time = formatClock(current, settings.showSeconds);
      if (time !== clockText) { clockText = time; clockNode.textContent = time; }
      const parts = formatDateParts(current);
      if (parts.weekday !== weekdayText) { weekdayText = parts.weekday; weekdayNode.textContent = parts.weekday; }
      if (parts.date !== dateText) { dateText = parts.date; dateNode.textContent = parts.date; }
    }

    function scheduleTick() {
      clearTimeout(tickTimer);
      tickTimer = setTimeout(() => { paint(); scheduleTick(); }, msUntilTick(now(), settings.showSeconds));
    }

    function applyShift() {
      const { x, y } = settings.oledProtection ? pixelShift(Date.now() - startedAt) : { x: 0, y: 0 };
      header.style.setProperty('--oled-x', `${x}px`);
      header.style.setProperty('--oled-y', `${y}px`);
    }

    function setDimmed(next) {
      if (dimmed === next) return;
      dimmed = next;
      body.classList.toggle('header-dimmed', next);
    }

    /** Any input wakes the header and restarts the idle countdown. */
    function wake() {
      const stamp = Date.now();
      if (!dimmed && stamp - lastWake < 1000 && dimTimer) return;
      lastWake = stamp;
      setDimmed(false);
      clearTimeout(dimTimer);
      if (settings.oledProtection) dimTimer = setTimeout(() => setDimmed(true), DIM_AFTER_MS);
    }

    for (const type of ['keydown', 'pointerdown', 'pointermove', 'focusin']) doc.addEventListener(type, wake, { passive: true });

    function startReveal() {
      if (revealed) return;
      revealed = true;
      clearTimeout(revealTimer);
      // Two frames: let the hidden state paint first so the transition has a start value.
      requestAnimationFrame(() => requestAnimationFrame(() => body.classList.add('home-ready')));
    }

    return {
      /** Applies settings.homeHeader and (re)starts the timers. Safe to call on every model refresh. */
      configure(raw) {
        settings = normaliseHeaderSettings(raw);
        header.dataset.layout = settings.layout;
        body.classList.toggle('home-fade', settings.fadeIn);
        body.classList.toggle('header-seconds', settings.showSeconds);
        if (!settings.fadeIn) body.classList.add('home-ready');
        if (settings.fadeIn && !revealed && !revealTimer) revealTimer = setTimeout(startReveal, REVEAL_FALLBACK_MS);
        clockText = '';
        paint();
        scheduleTick();
        clearInterval(shiftTimer);
        applyShift();
        if (settings.oledProtection) shiftTimer = setInterval(applyShift, SHIFT_STEP_MS);
        startedAt = startedAt || Date.now();
        wake();
      },
      /** Fades the header and rows in; call once the first wallpaper is on screen. Idempotent. */
      reveal: startReveal,
      /** Counts as user activity (for example gamepad input, which raises no DOM event). */
      wake,
      dispose() {
        clearTimeout(tickTimer); clearInterval(shiftTimer); clearTimeout(dimTimer); clearTimeout(revealTimer);
        for (const type of ['keydown', 'pointerdown', 'pointermove', 'focusin']) doc.removeEventListener(type, wake);
      }
    };
  }

  return {
    LAYOUTS, DEFAULT_WEATHER_LOCATION, SHIFT_AMPLITUDE_PX, DIM_AFTER_MS,
    normaliseHeaderSettings, headerWithDefaults, formatClock, formatDateParts, pixelShift, msUntilTick, create
  };
});
