'use strict';

/**
 * SVG and gauge builders for the controller UI. Everything is created with DOM APIs (no innerHTML) and styled
 * through classes in controllers.css, so colours and motion follow the active theme tokens.
 */
window.ControllerIcons = (function () {
  const NS = 'http://www.w3.org/2000/svg';

  /** @param {string} tag @param {Record<string, string | number>} [attrs] @param {Element[]} [children] */
  function svg(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    node.append(...children);
    return node;
  }

  const path = (d, attrs = {}) => svg('path', { d, ...attrs });

  const TRANSPORT_LABELS = Object.freeze({ bluetooth: 'Bluetooth', dongle: 'Wireless Adapter', usb: 'USB', unknown: 'Controller' });
  const TRANSPORT_GLYPHS = Object.freeze({
    bluetooth: ['M7 7.5l10 9-5 4.5v-17l5 4.5-10 9'],
    dongle: ['M9 3h6v5H9z', 'M7.5 8h9v11a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2z', 'M11 12h2'],
    usb: ['M8 3v5', 'M16 3v5', 'M6 8h12v4a6 6 0 0 1-12 0z', 'M12 18v3'],
    unknown: ['M7 8h10a4 4 0 0 1 4 4l.5 4a2.5 2.5 0 0 1-4.3 1.8L15 16H9l-2.2 1.8A2.5 2.5 0 0 1 2.5 16L3 12a4 4 0 0 1 4-4z', 'M8 11v3', 'M6.5 12.5h3', 'M16 12h.01', 'M18 13.5h.01']
  });

  /** 24px stroke icon for a connection type. @param {string} transport */
  function transportIcon(transport) {
    const glyph = TRANSPORT_GLYPHS[transport] || TRANSPORT_GLYPHS.unknown;
    return svg('svg', { viewBox: '0 0 24 24', class: 'glyph', 'aria-hidden': 'true', focusable: 'false' }, glyph.map((d) => path(d)));
  }

  /**
   * Battery gauge with a level-dependent colour state; `--level` drives the fill width.
   * @param {number | null} level 0-100 or null when unknown @param {boolean} [charging]
   */
  function batteryGauge(level, charging = false) {
    const known = Number.isFinite(level);
    const wrap = document.createElement('span');
    wrap.className = 'battery';
    wrap.dataset.level = !known ? 'unknown' : level <= 15 ? 'critical' : level <= 35 ? 'low' : 'good';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', known ? `Battery ${level} percent${charging ? ', charging' : ''}` : 'Battery level unavailable');
    const body = document.createElement('span');
    body.className = 'battery-body';
    const fill = document.createElement('span');
    fill.className = 'battery-fill';
    fill.style.setProperty('--level', known ? String(level) : '0');
    body.append(fill);
    const cap = document.createElement('span');
    cap.className = 'battery-cap';
    const text = document.createElement('span');
    text.className = 'battery-text';
    text.textContent = known ? `${level}%` : '—';
    wrap.append(body, cap);
    if (charging) wrap.append(svg('svg', { viewBox: '0 0 12 16', class: 'battery-bolt', 'aria-hidden': 'true' }, [path('M7 0 0 9h5l-1 7 8-10H6z')]));
    wrap.append(text);
    return wrap;
  }

  /**
   * Top-down controller illustration with the Pair button highlighted. The ring pulses to show where to press;
   * the Xbox button LED flashes to show what a controller in pairing mode looks like.
   * @param {'bluetooth' | 'dongle' | 'usb'} transport
   */
  function controllerGraphic(transport) {
    const root = svg('svg', { viewBox: '0 -20 260 200', class: 'cg', role: 'img', 'aria-label': 'Xbox controller with the Pair button highlighted' });
    const extras = svg('g', { class: 'cg-extras' });
    if (transport === 'bluetooth') {
      extras.append(
        path('M104 24 Q130 6 156 24', { class: 'cg-arc cg-arc-1' }),
        path('M90 12 Q130 -16 170 12', { class: 'cg-arc cg-arc-2' })
      );
    } else if (transport === 'dongle') {
      extras.append(
        path('M162 38 H214', { class: 'cg-link' }),
        svg('g', { transform: 'translate(214 8)', class: 'cg-dongle' }, [
          svg('rect', { x: 0, y: 0, width: 26, height: 44, rx: 5 }),
          svg('rect', { x: 6, y: -10, width: 14, height: 10, rx: 2 }),
          svg('circle', { cx: 13, cy: 30, r: 4, class: 'cg-led' })
        ])
      );
    } else {
      extras.append(
        path('M130 46 V4', { class: 'cg-cable' }),
        svg('rect', { x: 120, y: -18, width: 20, height: 22, rx: 4, class: 'cg-plug' })
      );
    }
    root.append(
      extras,
      path('M82 52 C58 52 36 96 28 140 C23 166 46 174 62 160 L92 128 H168 L198 160 C214 174 237 166 232 140 C224 96 202 52 178 52 Z', { class: 'cg-body' }),
      path('M84 52 Q104 38 124 46', { class: 'cg-detail cg-bumper' }),
      path('M176 52 Q156 38 136 46', { class: 'cg-detail cg-bumper' }),
      svg('circle', { cx: 96, cy: 88, r: 13, class: 'cg-detail' }),
      svg('circle', { cx: 164, cy: 116, r: 13, class: 'cg-detail' }),
      path('M104 108 h12 v-9 h8 v9 h12 v8 h-12 v9 h-8 v-9 h-12z', { class: 'cg-detail' }),
      ...[[178, 76], [178, 96], [168, 86], [188, 86]].map(([cx, cy]) => svg('circle', { cx, cy, r: 4.5, class: 'cg-detail' })),
      svg('circle', { cx: 130, cy: 76, r: 9, class: 'cg-detail cg-led' }),
      svg('circle', { cx: 130, cy: 43, r: 10, class: 'cg-ring' }),
      svg('rect', { x: 121, y: 40, width: 18, height: 7, rx: 3.5, class: 'cg-sync' })
    );
    return root;
  }

  /** Scanning indicator: expanding ripples, a rotating arc and a glass core holding the transport glyph. */
  function scanner(transport) {
    const wrap = document.createElement('div');
    wrap.className = 'scanner';
    wrap.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index += 1) {
      const ripple = document.createElement('span');
      ripple.className = 'scanner-ripple';
      wrap.append(ripple);
    }
    wrap.append(svg('svg', { viewBox: '0 0 100 100', class: 'scanner-arc' }, [
      svg('circle', { cx: 50, cy: 50, r: 44, pathLength: 100, class: 'scanner-arc-track' }),
      svg('circle', { cx: 50, cy: 50, r: 44, pathLength: 100, class: 'scanner-arc-head' })
    ]));
    const core = document.createElement('div');
    core.className = 'scanner-core';
    core.append(transportIcon(transport));
    wrap.append(core);
    return wrap;
  }

  /** Animated result mark; add `.drawn` to play the stroke animation. @param {'success' | 'error'} kind */
  function resultMark(kind) {
    const shape = kind === 'success' ? 'M30 52 L44 66 L70 36' : 'M36 36 L64 64 M64 36 L36 64';
    return svg('svg', { viewBox: '0 0 100 100', class: `mark mark-${kind}`, role: 'img', 'aria-label': kind === 'success' ? 'Success' : 'Error' }, [
      svg('circle', { cx: 50, cy: 50, r: 44, pathLength: 1, class: 'mark-circle' }),
      path(shape, { pathLength: 1, class: 'mark-stroke' })
    ]);
  }

  return { TRANSPORT_LABELS, transportIcon, batteryGauge, controllerGraphic, scanner, resultMark };
})();
