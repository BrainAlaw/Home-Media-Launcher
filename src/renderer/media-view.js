/**
 * Music view: full-screen overlay for Spotify search, playlists and device selection (ext namespace `media`).
 *
 * Entry points: DOM event `launcher:open-media-view` (dispatched by the home widget) or MediaView.open().
 * Input: app.js routes actions to MediaView.handleAction() while it is open. Focus is a cursor over stacked blocks
 * (header controls, tabs, search field, result lists/rails, playlist grid); see MediaViewModel.moveCursor.
 * Rendering: long lists use fixed-height virtualisation and scroll with transform only; rails translate on X.
 * Dev: `?media-mock[=ready|signed-out|unconfigured|premium|rate-limit]` swaps the backend for src/renderer/media-mock.js.
 */
(function () {
  'use strict';

  const VM = window.MediaViewModel;

  const SEARCH_DEBOUNCE_MS = 380;
  const CLOSE_MS = 260;
  const TABS = [{ id: 'search', label: 'Search' }, { id: 'playlists', label: 'Playlists' }];
  const CONTROLS = ['previous', 'toggle', 'next', 'devices'];

  const ICONS = {
    previous: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9.5 12z" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg>',
    devices: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v11H3zM8 19h8v2H8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  const el = (tag, className, attrs) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  };
  const text = (tag, className, value) => { const node = el(tag, className); node.textContent = value; return node; };
  const svgButton = (className, icon, label) => { const b = el('button', className, { type: 'button', tabindex: '-1', 'aria-label': label }); b.innerHTML = icon; return b; };

  /* ------------------------------------------------------------------ bridge (real ext or dev mock) */

  /** Unwraps the `{ ok, ... }` envelopes of ns `media` into plain values; failures become Errors carrying `.code`. */
  function unwrap(method, response) {
    if (!response || typeof response !== 'object' || Array.isArray(response) || !('ok' in response)) return response;
    if (!response.ok) {
      const error = new Error(response.error || response.code || 'Request failed');
      error.code = response.code;
      throw error;
    }
    if (method === 'search') return response.results;
    if (method === 'devices') return response.devices;
    return response;
  }

  function wrapBridge(raw) {
    return { invoke: async (method, ...args) => unwrap(method, await raw.invoke(method, ...args)), on: raw.on };
  }

  async function createBridge() {
    const params = new URLSearchParams(location.search);
    if (params.has('media-mock')) {
      if (!window.MediaMock) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'media-mock.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('media-mock.js missing'));
          document.head.append(script);
        });
      }
      return wrapBridge(window.MediaMock.createMockBridge({ scenario: params.get('media-mock') || 'ready' }));
    }
    const ext = window.launcher?.ext;
    return wrapBridge({
      invoke: (method, ...args) => ext.invoke('media', method, ...args),
      on: (event, callback) => ext.on('media', event, callback)
    });
  }

  /* ------------------------------------------------------------------ virtual grid */

  /**
   * Fixed-height virtualised grid. Cells are absolutely positioned and move with transform; the content layer scrolls
   * with a transformed offset, so scrolling never triggers layout.
   */
  function createVirtualGrid({ viewport, create, update }) {
    const content = el('div', 'vg-content');
    viewport.replaceChildren(content);
    const live = new Map();
    const free = [];
    const metrics = { columns: 1, rowHeight: 72, cellWidth: 0, gap: 0, padX: 0, padY: 0 };
    let items = [];
    let scroll = 0;

    const viewportHeight = () => viewport.clientHeight;
    const totalRows = () => VM.rowCount(items.length, metrics.columns);

    function place(cell, index) {
      const row = Math.floor(index / metrics.columns);
      const col = index % metrics.columns;
      const x = metrics.padX + col * (metrics.cellWidth + metrics.gap);
      cell.style.transform = `translate3d(${x}px, ${metrics.padY + row * metrics.rowHeight}px, 0)`;
    }

    function render() {
      const { startRow, endRow } = VM.visibleRows({ scrollTop: scroll, viewportHeight: viewportHeight(), rowHeight: metrics.rowHeight, count: items.length, columns: metrics.columns, overscan: 2 });
      const range = VM.itemRange({ startRow, endRow }, metrics.columns, items.length);
      for (const [index, cell] of live) {
        if (index < range.start || index >= range.end) { live.delete(index); cell.hidden = true; free.push(cell); }
      }
      for (let index = range.start; index < range.end; index++) {
        let cell = live.get(index);
        if (!cell) {
          cell = free.pop() || (() => { const c = el('div', 'vg-cell'); c.append(create()); content.append(c); return c; })();
          cell.hidden = false;
          live.set(index, cell);
        }
        cell.style.width = `${metrics.cellWidth}px`;
        cell.style.height = `${metrics.rowHeight}px`;
        place(cell, index);
        update(cell.firstElementChild, items[index], index);
        cell.dataset.index = String(index);
      }
      content.style.height = `${totalRows() * metrics.rowHeight + metrics.padY * 2}px`;
      content.style.transform = `translate3d(0, ${-scroll}px, 0)`;
    }

    return {
      metrics,
      setItems(next, { keepScroll = false } = {}) { items = next; if (!keepScroll) scroll = 0; render(); },
      get length() { return items.length; },
      refresh: render,
      scrollTo(row) {
        const next = VM.scrollToRow({ row, rowHeight: metrics.rowHeight, viewportHeight: viewportHeight(), current: scroll, totalRows: totalRows(), margin: 0.4 });
        // padY shifts content; a first/last row must still show its padding.
        scroll = row === 0 ? 0 : next;
        render();
      },
      elementAt(index) {
        const row = Math.floor(index / metrics.columns);
        this.scrollTo(row);
        return live.get(index)?.firstElementChild || null;
      }
    };
  }

  /* ------------------------------------------------------------------ module state */

  const S = {
    open: false,
    onClose: null,
    bridge: null,
    unsubscribe: null,
    auth: { status: 'signed-out' },
    playback: null,
    tab: 'search',
    detail: null, // { playlist, items, hasMore, nextOffset, loading, error }
    query: '',
    search: { status: 'idle', sections: [], error: null, token: 0 },
    playlists: { items: [], hasMore: true, nextOffset: 0, loading: false, loaded: false, error: null },
    popup: null, // { devices, loading, error }
    banner: null,
    pendingPlay: null,
    blocks: [],
    cursor: null, // { id, row, col }
    preferredCol: 0,
    focusedEl: null,
    metrics: { unit: 1 },
    pageY: 0,
    grid: null,
    searchTimer: 0,
    bannerTimer: 0,
    closeTimer: 0,
    osk: null
  };

  const dom = {};

  /* ------------------------------------------------------------------ DOM skeleton */

  function ensureDom() {
    if (dom.root) return;
    const root = el('section', 'mv', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Music', hidden: '' });
    const head = el('header', 'mv-head');
    const mini = el('div', 'mv-mini');
    dom.art = el('img', 'mv-mini-art', { alt: '', decoding: 'async', width: '64', height: '64' });
    const miniText = el('div', 'mv-mini-text');
    dom.title = text('strong', 'mv-mini-title', '');
    dom.subtitle = text('span', 'mv-mini-sub', '');
    miniText.append(dom.title, dom.subtitle);
    mini.append(dom.art, miniText);
    const controls = el('div', 'mv-controls', { role: 'toolbar', 'aria-label': 'Playback' });
    dom.controls = {
      previous: svgButton('mv-btn', ICONS.previous, 'Previous track'),
      toggle: svgButton('mv-btn mv-btn-main', ICONS.play, 'Play'),
      next: svgButton('mv-btn', ICONS.next, 'Next track'),
      devices: svgButton('mv-btn mv-btn-devices', ICONS.devices, 'Choose device')
    };
    dom.deviceLabel = text('span', 'mv-device-label', 'Devices');
    dom.controls.devices.append(dom.deviceLabel);
    for (const name of CONTROLS) { dom.controls[name].dataset.block = 'ctl'; dom.controls[name].dataset.col = String(CONTROLS.indexOf(name)); dom.controls[name].dataset.row = '0'; }
    controls.append(...CONTROLS.map((name) => dom.controls[name]));
    head.append(mini, controls);

    dom.tabs = el('nav', 'mv-tabs', { role: 'tablist', 'aria-label': 'Music sections' });
    dom.tabButtons = TABS.map((tab, col) => {
      const button = text('button', 'mv-tab', tab.label);
      button.type = 'button'; button.tabIndex = -1; button.setAttribute('role', 'tab');
      button.dataset.block = 'tabs'; button.dataset.row = '0'; button.dataset.col = String(col);
      return button;
    });
    dom.tabs.append(...dom.tabButtons);

    dom.field = el('button', 'mv-field', { type: 'button', tabindex: '-1', 'aria-label': 'Search Spotify' });
    dom.field.dataset.block = 'field'; dom.field.dataset.row = '0'; dom.field.dataset.col = '0';
    dom.field.innerHTML = `${ICONS.search}<span class="mv-field-text"></span>`;
    dom.fieldText = dom.field.querySelector('.mv-field-text');

    dom.body = el('main', 'mv-body');
    dom.status = el('div', 'mv-status', { role: 'status' });
    dom.banner = el('div', 'mv-banner', { role: 'alert' });
    dom.popup = el('div', 'mv-popup', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Playback devices' });
    dom.hints = el('footer', 'mv-hints');
    dom.hints.innerHTML = '<span class="pad"><b>A</b> Select</span><span class="pad"><b>B</b> Back</span><span class="pad"><b>Menu</b> Devices</span><span class="kbd"><b>Enter</b> Select</span><span class="kbd"><b>Esc</b> Back</span><span class="kbd"><b>F1</b> Devices</span>';
    dom.probe = el('div', 'mv-probe', { 'aria-hidden': 'true' });
    dom.probe.innerHTML = '<i class="p-row"></i><i class="p-tile"></i><i class="p-gap"></i><i class="p-gutter"></i><i class="p-pad"></i>';

    root.append(head, dom.tabs, dom.field, dom.body, dom.banner, dom.popup, dom.hints, dom.probe);
    document.body.append(root);
    dom.root = root;
    dom.head = head;

    root.addEventListener('click', onClick);
    window.addEventListener('resize', () => { if (S.open) { measure(); render({ keepFocus: true }); } });
  }

  function measure() {
    const get = (selector, prop) => dom.probe.querySelector(selector)[prop];
    S.metrics = {
      rowH: get('.p-row', 'offsetHeight'),
      tileW: get('.p-tile', 'offsetWidth'),
      tileH: get('.p-tile', 'offsetHeight'),
      gap: get('.p-gap', 'offsetWidth'),
      gutter: get('.p-gutter', 'offsetWidth'),
      pad: get('.p-pad', 'offsetWidth')
    };
  }

  /* ------------------------------------------------------------------ images */

  function setImage(img, url) {
    if (url) {
      if (img.getAttribute('src') !== url) img.src = url;
      img.classList.remove('no-art');
    } else {
      img.removeAttribute('src');
      img.classList.add('no-art');
    }
  }

  const artImage = (size) => el('img', 'mv-art', { alt: '', decoding: 'async', width: String(size), height: String(size), draggable: 'false' });

  /* ------------------------------------------------------------------ header */

  function updateHead() {
    const { title, subtitle } = VM.nowPlayingText(S.playback);
    dom.title.textContent = title;
    dom.subtitle.textContent = subtitle;
    setImage(dom.art, S.playback?.track?.artUrl);
    const playing = Boolean(S.playback?.playing);
    dom.controls.toggle.innerHTML = playing ? ICONS.pause : ICONS.play;
    dom.controls.toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    dom.deviceLabel.textContent = S.playback?.device?.name || 'Devices';
  }

  /* ------------------------------------------------------------------ blocks */

  const staticBlock = (id, elements, extra = {}) => ({
    id, nav: VM.rowBlock(elements.length), elementAt: (row, col) => elements[col] || null, ...extra
  });

  /** Builds the focus blocks for the current screen. Popups replace the whole set. */
  function currentBlocks() {
    if (S.popup) return S.popup.blocks || [];
    return S.blocks;
  }

  function numericBlocks() { return currentBlocks().map((block) => block.nav); }

  function cursorIndex(cursor) { return cursor ? currentBlocks().findIndex((block) => block.id === cursor.id) : -1; }

  function resolveElement(cursor) {
    const index = cursorIndex(cursor);
    if (index < 0) return null;
    const block = currentBlocks()[index];
    return block.elementAt(cursor.row, cursor.col);
  }

  function setCursor(next, { reveal = true } = {}) {
    const blocks = currentBlocks();
    const index = next ? blocks.findIndex((block) => block.id === next.id) : -1;
    if (index < 0) return;
    const block = blocks[index];
    const element = block.elementAt(next.row, next.col);
    if (S.focusedEl && S.focusedEl !== element) S.focusedEl.classList.remove('focused');
    S.cursor = { id: next.id, row: next.row, col: next.col };
    S.focusedEl = element;
    if (!element) return;
    element.classList.add('focused');
    if (reveal) block.reveal?.(next.row, next.col, element);
    element.focus({ preventScroll: true });
    maybeLoadMore(block, next);
  }

  /** Re-applies the cursor after content changed; falls back to the nearest valid block. */
  function restoreCursor(fallbackId) {
    const blocks = currentBlocks();
    let cursor = S.cursor;
    let index = cursorIndex(cursor);
    if (index < 0 || !(blocks[index].nav.rows > 0)) {
      index = fallbackId ? blocks.findIndex((block) => block.id === fallbackId && block.nav.rows > 0) : -1;
      if (index < 0) index = VM.firstCursor(blocks.map((b) => b.nav))?.block ?? -1;
      cursor = index < 0 ? null : { id: blocks[index].id, row: 0, col: 0 };
    } else {
      const block = blocks[index].nav;
      const row = Math.min(cursor.row, block.rows - 1);
      cursor = { id: cursor.id, row, col: Math.min(cursor.col, block.cols(row) - 1) };
    }
    S.focusedEl = null;
    if (cursor) setCursor(cursor);
  }

  function moveFocus(direction) {
    const blocks = currentBlocks();
    const index = cursorIndex(S.cursor);
    if (index < 0) { restoreCursor(); return; }
    const nav = blocks.map((block) => block.nav);
    const horizontal = direction === 'left' || direction === 'right';
    const next = VM.moveCursor(nav, { block: index, row: S.cursor.row, col: S.cursor.col }, direction, S.preferredCol);
    if (!next) return;
    if (horizontal) S.preferredCol = next.col;
    setCursor({ id: blocks[next.block].id, row: next.row, col: next.col });
  }

  /** Requests the next page when the cursor nears the end of a pageable block. */
  function maybeLoadMore(block, cursor) {
    if (!block.pager) return;
    const index = cursor.row * (block.columns || 1) + cursor.col;
    const pager = block.pager();
    if (VM.shouldLoadMore({ index, loaded: pager.loaded, hasMore: pager.hasMore, loading: pager.loading })) pager.load();
  }

  /* ------------------------------------------------------------------ rendering */

  function render({ keepFocus = false } = {}) {
    if (!dom.root) return;
    const screen = VM.screenFor(S.auth);
    dom.root.dataset.screen = screen;
    dom.root.dataset.tab = S.detail ? 'detail' : S.tab;
    updateHead();
    S.grid = null;
    dom.body.replaceChildren();
    dom.status.remove();
    S.blocks = [];

    if (screen !== 'ready') {
      renderAuthScreen(screen);
    } else {
      const header = staticBlock('ctl', CONTROLS.map((name) => dom.controls[name]));
      const tabs = staticBlock('tabs', dom.tabButtons);
      dom.tabButtons.forEach((button, col) => {
        const active = !S.detail ? TABS[col].id === S.tab : TABS[col].id === 'playlists';
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      S.blocks.push(header, tabs);
      if (S.detail) renderDetail();
      else if (S.tab === 'playlists') renderPlaylists();
      else renderSearch();
    }
    renderPopup();
    const previous = S.cursor;
    if (!keepFocus) S.cursor = null;
    S.focusedEl = null;
    restoreCursor(previous?.id);
  }

  function emptyState(title, detail, actions = []) {
    const box = el('div', 'mv-empty');
    box.append(text('h2', '', title));
    if (detail) box.append(text('p', '', detail));
    const buttons = actions.map((action, col) => {
      const button = text('button', 'mv-cta', action.label);
      button.type = 'button'; button.tabIndex = -1;
      button.dataset.block = 'cta'; button.dataset.row = '0'; button.dataset.col = String(col);
      return button;
    });
    buttons.forEach((b) => box.append(b));
    return { box, buttons };
  }

  function renderAuthScreen(screen) {
    const copy = {
      unconfigured: ['Spotify is not set up', 'Add SPOTIFY_CLIENT_ID to the launcher environment to enable music playback.', []],
      'signed-out': ['Sign in to Spotify', 'Search, browse your playlists and control playback from the couch.', [{ label: 'Sign in with Spotify', run: signIn }]],
      'signing-in': ['Waiting for Spotify', S.auth.url ? `Finish signing in in the browser, or open ${S.auth.url}` : 'Finish signing in in the browser window.', [{ label: 'Cancel', run: () => refreshAuth() }]],
      error: ['Spotify sign-in failed', S.auth.message || 'Something went wrong.', [{ label: 'Try again', run: signIn }]]
    }[screen];
    const { box, buttons } = emptyState(copy[0], copy[1], copy[2]);
    dom.body.append(box);
    S.blocks.push({ id: 'cta', nav: VM.rowBlock(buttons.length), elementAt: (row, col) => buttons[col] || null, activate: (row, col) => copy[2][col]?.run() });
  }

  /* ---- search tab ---- */

  function renderSearch() {
    dom.field.hidden = false;
    S.blocks.push(staticBlock('field', [dom.field]));
    dom.fieldText.textContent = S.query || 'Search songs, albums, playlists, artists';
    dom.field.classList.toggle('empty', !S.query);
    const { status, sections, error } = S.search;
    const viewport = el('div', 'mv-viewport');
    dom.body.append(viewport);
    if (status === 'loading' && !sections.length) { viewport.append(emptyState('Searching…', '').box); return; }
    if (status === 'error') { viewport.append(emptyState(error.message, error.kind === 'premium' ? '' : 'Press A on the search field to try again.').box); return; }
    if (status === 'idle') { viewport.append(emptyState('Search Spotify', 'Select the field above and type with the on-screen keyboard.').box); return; }
    if (!sections.length) { viewport.append(emptyState('No results', `Nothing found for “${S.query}”.`).box); return; }

    const page = el('div', 'mv-page');
    viewport.append(page);
    S.pageY = 0;
    for (const section of sections) {
      const wrapper = el('section', 'mv-section', { 'aria-label': section.title });
      wrapper.append(text('h3', 'mv-section-title', section.title));
      page.append(wrapper);
      if (section.layout === 'list') S.blocks.push(buildListSection(section, wrapper, page, viewport));
      else S.blocks.push(buildRailSection(section, wrapper, page, viewport));
    }
    page.style.transform = 'translate3d(0, 0, 0)';
  }

  const offsetWithin = (node, ancestor) => { let y = 0; for (let n = node; n && n !== ancestor; n = n.offsetParent) y += n.offsetTop; return y; };

  function revealInPage(page, viewport, top, bottom) {
    const margin = Math.round(S.metrics.pad * 1.2);
    const viewH = viewport.clientHeight;
    const maxY = Math.max(0, page.offsetHeight - viewH);
    let y = S.pageY;
    if (top - margin < y) y = top - margin;
    else if (bottom + margin > y + viewH) y = bottom + margin - viewH;
    S.pageY = Math.min(maxY, Math.max(0, y));
    page.style.transform = `translate3d(0, ${-S.pageY}px, 0)`;
  }

  function buildListSection(section, wrapper, page, viewport) {
    const list = el('div', 'mv-list');
    const rows = section.items.map((item, row) => {
      const button = trackRow(item);
      button.dataset.block = `sec:${section.id}`; button.dataset.row = String(row); button.dataset.col = '0';
      list.append(button);
      return button;
    });
    wrapper.append(list);
    return {
      id: `sec:${section.id}`, nav: VM.gridBlock(rows.length, 1), items: section.items,
      elementAt: (row) => rows[row] || null,
      reveal: (row, col, element) => {
        const top = row === 0 ? offsetWithin(wrapper, page) : offsetWithin(element, page);
        revealInPage(page, viewport, top, offsetWithin(element, page) + element.offsetHeight);
      },
      activate: (row) => playSearchTrack(row)
    };
  }

  function buildRailSection(section, wrapper, page, viewport) {
    const rail = el('div', 'mv-rail');
    const track = el('div', 'mv-rail-track');
    const tiles = section.items.map((item, col) => {
      const tile = tileElement(item);
      tile.dataset.block = `sec:${section.id}`; tile.dataset.row = '0'; tile.dataset.col = String(col);
      track.append(tile);
      return tile;
    });
    rail.append(track);
    wrapper.append(rail);
    let railX = 0;
    return {
      id: `sec:${section.id}`, nav: VM.rowBlock(tiles.length), items: section.items,
      elementAt: (row, col) => tiles[col] || null,
      reveal: (row, col, element) => {
        const m = S.metrics;
        railX = VM.scrollToColumn({ index: col, itemWidth: m.tileW, gap: m.gap, viewportWidth: rail.clientWidth, current: railX, count: tiles.length, padding: m.gutter });
        track.style.transform = `translate3d(${-railX}px, 0, 0)`;
        revealInPage(page, viewport, offsetWithin(wrapper, page), offsetWithin(element, page) + element.offsetHeight);
      },
      activate: (row, col) => activateTile(section.items[col])
    };
  }

  /* ---- shared item elements ---- */

  function trackRow(item) {
    const button = el('button', 'mv-track', { type: 'button', tabindex: '-1' });
    button.append(artImage(56), el('span', 'mv-track-text'), text('span', 'mv-track-time', ''));
    updateTrackRow(button, item);
    return button;
  }

  function updateTrackRow(button, item) {
    const textBox = button.querySelector('.mv-track-text');
    textBox.replaceChildren(text('strong', '', item.title), text('span', '', item.subtitle));
    setImage(button.querySelector('.mv-art'), item.artUrl);
    button.querySelector('.mv-track-time').textContent = item.durationLabel || '';
    const playing = S.playback?.track?.uri && S.playback.track.uri === item.trackUri;
    button.classList.toggle('now-playing', Boolean(playing));
    button.setAttribute('aria-label', `${item.title}, ${item.subtitle}`);
  }

  function tileElement(item) {
    const tile = el('button', `mv-tile mv-tile-${item.kind}`, { type: 'button', tabindex: '-1' });
    const frame = el('span', 'mv-tile-art');
    frame.append(artImage(220));
    tile.append(frame, el('span', 'mv-tile-label'));
    updateTile(tile, item);
    return tile;
  }

  function updateTile(tile, item) {
    setImage(tile.querySelector('.mv-art'), item.artUrl);
    const label = tile.querySelector('.mv-tile-label');
    label.replaceChildren(text('strong', '', item.title), text('span', '', item.subtitle));
    tile.setAttribute('aria-label', `${item.title}, ${item.subtitle}`);
  }

  /* ---- playlists tab ---- */

  function renderPlaylists() {
    const state = S.playlists;
    if (!state.loaded && !state.loading) loadPlaylists();
    if (!state.items.length) {
      const message = state.error ? emptyState(state.error.message, 'Press A to retry.', [{ label: 'Retry' }]) : emptyState(state.loading || !state.loaded ? 'Loading playlists…' : 'No playlists', '');
      dom.body.append(message.box);
      if (state.error) S.blocks.push({ id: 'cta', nav: VM.rowBlock(1), elementAt: () => message.buttons[0], activate: () => { state.error = null; state.loaded = false; render({ keepFocus: true }); } });
      return;
    }
    const viewport = el('div', 'mv-viewport mv-grid');
    dom.body.append(viewport);
    const m = S.metrics;
    const grid = createVirtualGrid({
      viewport,
      create: () => { const tile = tileElement({ kind: 'playlist', title: '', subtitle: '' }); return tile; },
      update: (tile, item, index) => {
        updateTile(tile, item);
        tile.dataset.block = 'grid';
        tile.dataset.row = String(Math.floor(index / grid.metrics.columns));
        tile.dataset.col = String(index % grid.metrics.columns);
        tile.classList.toggle('focused', S.cursor?.id === 'grid' && S.cursor.row === Number(tile.dataset.row) && S.cursor.col === Number(tile.dataset.col));
      }
    });
    const width = viewport.clientWidth;
    const columns = VM.gridColumns(width - m.gutter * 2, m.tileW, m.gap);
    Object.assign(grid.metrics, { columns, rowHeight: m.tileH + m.gap, cellWidth: m.tileW, gap: m.gap, padX: Math.max(m.gutter, Math.floor((width - columns * m.tileW - (columns - 1) * m.gap) / 2)), padY: Math.round(m.pad * 0.8) });
    grid.setItems(state.items);
    S.grid = grid;
    S.blocks.push({
      id: 'grid', nav: VM.gridBlock(state.items.length, columns), columns, items: state.items,
      elementAt: (row, col) => grid.elementAt(row * columns + col),
      pager: () => ({ loaded: state.items.length, hasMore: state.hasMore, loading: state.loading, load: loadPlaylists }),
      activate: (row, col) => openDetail(state.items[row * columns + col])
    });
  }

  async function loadPlaylists() {
    const state = S.playlists;
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    state.error = null;
    try {
      const page = VM.normalizePage(await S.bridge.invoke('playlists', state.nextOffset), state.nextOffset);
      state.items = VM.mergePage(state.items, page.items.map(VM.playlistItem));
      state.hasMore = page.hasMore;
      state.nextOffset = page.nextOffset;
      state.loaded = true;
    } catch (error) {
      state.error = VM.describeError(error);
      state.loaded = true;
    } finally {
      state.loading = false;
    }
    if (S.open && !S.detail && S.tab === 'playlists') refreshGrid();
  }

  /** Updates the grid in place so focus and scroll survive a page load. */
  function refreshGrid() {
    if (S.grid && S.playlists.items.length) {
      S.grid.setItems(S.playlists.items, { keepScroll: true });
      const block = S.blocks.find((b) => b.id === 'grid');
      if (block) { block.nav = VM.gridBlock(S.playlists.items.length, block.columns); block.items = S.playlists.items; }
    } else render({ keepFocus: true });
  }

  /* ---- playlist detail ---- */

  function renderDetail() {
    const d = S.detail;
    const head = el('div', 'mv-detail-head');
    const art = artImage(120);
    setImage(art, d.playlist.artUrl);
    const info = el('div', 'mv-detail-info');
    info.append(text('h2', '', d.playlist.title), text('p', '', d.playlist.subtitle));
    const play = text('button', 'mv-cta mv-play', 'Play');
    play.type = 'button'; play.tabIndex = -1;
    play.dataset.block = 'detail-head'; play.dataset.row = '0'; play.dataset.col = '0';
    info.append(play);
    head.append(art, info);
    dom.body.append(head);
    S.blocks.push({ id: 'detail-head', nav: VM.rowBlock(1), elementAt: () => play, activate: () => playContext(d.playlist.uri) });

    if (!d.items.length) {
      dom.body.append(emptyState(d.error ? d.error.message : d.loading ? 'Loading songs…' : 'This playlist is empty', '').box);
      return;
    }
    const viewport = el('div', 'mv-viewport mv-tracks');
    dom.body.append(viewport);
    const m = S.metrics;
    const grid = createVirtualGrid({
      viewport,
      create: () => trackRow({ title: '', subtitle: '' }),
      update: (row, item, index) => {
        updateTrackRow(row, item);
        row.dataset.block = 'detail-list'; row.dataset.row = String(index); row.dataset.col = '0';
        row.classList.toggle('focused', S.cursor?.id === 'detail-list' && S.cursor.row === index);
      }
    });
    Object.assign(grid.metrics, { columns: 1, rowHeight: m.rowH, cellWidth: viewport.clientWidth - m.gutter * 2, gap: 0, padX: m.gutter, padY: Math.round(m.pad * 0.5) });
    grid.setItems(d.items);
    S.grid = grid;
    S.blocks.push({
      id: 'detail-list', nav: VM.gridBlock(d.items.length, 1), items: d.items,
      elementAt: (row) => grid.elementAt(row),
      pager: () => ({ loaded: d.items.length, hasMore: d.hasMore, loading: d.loading, load: loadDetailTracks }),
      activate: (row) => playContext(d.playlist.uri, d.items[row].trackUri)
    });
  }

  async function openDetail(item) {
    if (!item) return;
    S.detail = { playlist: item, items: [], hasMore: true, nextOffset: 0, loading: false, error: null, loaded: false };
    S.cursor = null;
    render();
    await loadDetailTracks();
  }

  async function loadDetailTracks() {
    const d = S.detail;
    if (!d || d.loading || !d.hasMore) return;
    d.loading = true;
    try {
      const page = VM.normalizePage(await S.bridge.invoke('playlistTracks', d.playlist.id, d.nextOffset), d.nextOffset);
      if (S.detail !== d) return;
      d.items = VM.mergePage(d.items, page.items.map(VM.trackItem));
      d.hasMore = page.hasMore;
      d.nextOffset = page.nextOffset;
    } catch (error) {
      d.error = VM.isTracksUnavailable(error)
        ? { kind: 'generic', action: 'none', message: 'Spotify does not share the songs of this playlist. Playing it still works.' }
        : VM.describeError(error);
      d.hasMore = false;
    } finally {
      d.loading = false;
    }
    if (!S.open || S.detail !== d) return;
    if (S.grid && d.items.length) {
      S.grid.setItems(d.items, { keepScroll: true });
      const block = S.blocks.find((b) => b.id === 'detail-list');
      if (block) { block.nav = VM.gridBlock(d.items.length, 1); block.items = d.items; }
    } else {
      render({ keepFocus: true });
    }
  }

  /* ---- device popup ---- */

  function renderPopup() {
    dom.popup.replaceChildren();
    dom.root.classList.toggle('popup-open', Boolean(S.popup));
    if (!S.popup) return;
    const p = S.popup;
    dom.popup.append(text('h2', '', 'Play on'));
    if (p.loading) dom.popup.append(text('p', 'mv-popup-note', 'Looking for devices…'));
    else if (p.error) dom.popup.append(text('p', 'mv-popup-note', p.error.message));
    else if (!p.devices.length) dom.popup.append(text('p', 'mv-popup-note', 'No devices found. Open Spotify on a device and try again.'));
    const rows = p.devices.map((device, row) => {
      const button = el('button', 'mv-device', { type: 'button', tabindex: '-1', 'aria-label': `${device.name}${device.active ? ', playing' : ''}` });
      button.append(text('strong', '', device.name), text('span', '', device.type));
      if (device.active) { const mark = el('span', 'mv-check'); mark.innerHTML = ICONS.check; button.append(mark); }
      button.dataset.block = 'popup'; button.dataset.row = String(row); button.dataset.col = '0';
      dom.popup.append(button);
      return button;
    });
    p.blocks = [{ id: 'popup', nav: VM.gridBlock(rows.length, 1), elementAt: (row) => rows[row] || null, activate: (row) => transferTo(p.devices[row]) }];
  }

  async function openDevices() {
    if (S.popup) return;
    S.popup = { devices: [], loading: true, error: null, blocks: [], returnCursor: S.cursor };
    renderPopup();
    S.cursor = null;
    restoreCursor();
    const popup = S.popup;
    try { popup.devices = await S.bridge.invoke('devices'); } catch (error) { popup.error = VM.describeError(error); }
    popup.loading = false;
    if (S.popup !== popup) return;
    renderPopup();
    const active = Math.max(0, popup.devices.findIndex((device) => device.active));
    S.cursor = { id: 'popup', row: active, col: 0 };
    S.focusedEl = null;
    if (popup.blocks[0]?.nav.rows) setCursor(S.cursor);
  }

  function closePopup() {
    if (!S.popup) return;
    const back = S.popup.returnCursor;
    S.popup = null;
    renderPopup();
    S.cursor = back;
    S.focusedEl = null;
    restoreCursor('ctl');
  }

  async function transferTo(device) {
    if (!device) return;
    const pending = S.pendingPlay;
    S.pendingPlay = null;
    closePopup();
    try {
      await S.bridge.invoke('transfer', device.id);
      if (pending) await S.bridge.invoke('play', { ...pending, deviceId: device.id });
    } catch (error) { showBanner(VM.describeError(error)); }
  }

  /* ------------------------------------------------------------------ banner */

  function showBanner(info) {
    S.banner = info;
    dom.banner.textContent = info.message;
    dom.banner.dataset.kind = info.kind;
    dom.root.classList.add('banner-open');
    clearTimeout(S.bannerTimer);
    S.bannerTimer = setTimeout(() => dom.root.classList.remove('banner-open'), 5200);
  }

  /* ------------------------------------------------------------------ actions */

  async function runControl(command) {
    try { await S.bridge.invoke('control', command); } catch (error) { handlePlaybackError(error); }
  }

  function handlePlaybackError(error, request) {
    const info = VM.describeError(error);
    showBanner(info);
    if (info.kind === 'no-device') { S.pendingPlay = request || null; openDevices(); }
  }

  async function play(request) {
    try { await S.bridge.invoke('play', request); } catch (error) { handlePlaybackError(error, request); }
  }

  const playContext = (contextUri, offsetUri) => play(offsetUri ? { contextUri, offsetUri } : { contextUri });

  function playSearchTrack(row) {
    const tracks = S.search.sections.find((section) => section.id === 'tracks')?.items || [];
    const item = tracks[row];
    if (item) play({ uris: tracks.map((track) => track.trackUri), offsetUri: item.trackUri });
  }

  function activateTile(item) {
    if (!item) return;
    if (item.kind === 'playlist') openDetail(item);
    else play({ contextUri: item.uri });
  }

  async function signIn() {
    try { await S.bridge.invoke('login'); } catch (error) { showBanner(VM.describeError(error)); }
    refreshAuth();
  }

  async function refreshAuth() {
    try { const snapshot = await S.bridge.invoke('status'); if (snapshot?.auth) S.auth = snapshot.auth; if (snapshot) S.playback = snapshot; } catch { /* keep previous state */ }
    render();
  }

  /* ---- search ---- */

  function scheduleSearch(query) {
    clearTimeout(S.searchTimer);
    S.searchTimer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
  }

  async function runSearch(query) {
    clearTimeout(S.searchTimer);
    const trimmed = query.trim();
    S.query = query;
    const token = ++S.search.token;
    if (!trimmed) { S.search = { ...S.search, status: 'idle', sections: [], error: null }; if (S.open && !S.detail && S.tab === 'search') render({ keepFocus: true }); return; }
    S.search.status = 'loading';
    try {
      const result = await S.bridge.invoke('search', trimmed);
      if (token !== S.search.token) return;
      S.search = { token, status: 'ready', sections: VM.mapSearchResult(result), error: null };
    } catch (error) {
      if (token !== S.search.token) return;
      S.search = { token, status: 'error', sections: [], error: VM.describeError(error) };
    }
    if (S.open && !S.detail && S.tab === 'search' && !S.popup) {
      // Keep the cursor on the field while typing; results replace the body underneath it.
      const keep = S.cursor?.id === 'field' ? S.cursor : null;
      render({ keepFocus: Boolean(keep) });
    }
  }

  function openKeyboard() {
    if (!window.OnScreenKeyboard) return;
    S.osk = window.OnScreenKeyboard.open({
      initial: S.query,
      placeholder: 'Search songs, albums, playlists, artists',
      type: 'search',
      onChange: (value) => { S.query = value; dom.fieldText.textContent = value || 'Search songs, albums, playlists, artists'; dom.field.classList.toggle('empty', !value); scheduleSearch(value); },
      onSubmit: (value) => { runSearch(value); },
      onClosed: restoreFocusSoon
    });
  }

  function restoreFocusSoon() {
    S.osk = null;
    if (S.open) dom.field.focus({ preventScroll: true });
  }

  /* ---- tabs ---- */

  function switchTab(id) {
    if (!S.detail && S.tab === id) return;
    S.detail = null;
    S.tab = id;
    render({ keepFocus: true });
    S.cursor = { id: 'tabs', row: 0, col: TABS.findIndex((tab) => tab.id === id) };
    setCursor(S.cursor);
  }

  function leaveDetail() {
    S.detail = null;
    const col = 1;
    render();
    setCursor({ id: 'grid', row: 0, col: 0 });
    if (!S.focusedEl) setCursor({ id: 'tabs', row: 0, col });
  }

  /* ------------------------------------------------------------------ input */

  function activateCursor() {
    const blocks = currentBlocks();
    const cursor = S.cursor;
    const block = cursor && blocks.find((b) => b.id === cursor.id);
    if (!block) return;
    switch (block.id) {
      case 'ctl': {
        const name = CONTROLS[cursor.col];
        if (name === 'devices') openDevices();
        else runControl(name);
        break;
      }
      case 'tabs': switchTab(TABS[cursor.col].id); break;
      case 'field': openKeyboard(); break;
      default: block.activate?.(cursor.row, cursor.col);
    }
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-block]') : null;
    if (!target) return;
    if (S.popup && target.dataset.block !== 'popup') return;
    setCursor({ id: target.dataset.block, row: Number(target.dataset.row), col: Number(target.dataset.col) }, { reveal: false });
    activateCursor();
  }

  /** Router hook (app.js). Returns true while the view owns input. */
  function handleAction(action) {
    if (!S.open) return false;
    if (window.OnScreenKeyboard?.isOpen()) return false;
    switch (action) {
      case 'up': case 'down': case 'left': case 'right': moveFocus(action); break;
      case 'confirm': activateCursor(); break;
      case 'menu': S.popup ? closePopup() : openDevices(); break;
      case 'back':
        if (S.popup) closePopup();
        else if (S.detail) leaveDetail();
        else close();
        break;
      default: break;
    }
    return true;
  }

  /* ------------------------------------------------------------------ lifecycle */

  async function open({ onClose } = {}) {
    if (S.open) return;
    ensureDom();
    S.open = true;
    S.onClose = onClose || null;
    clearTimeout(S.closeTimer);
    try { S.bridge = S.bridge || await createBridge(); } catch (error) { S.open = false; throw error; }
    dom.root.hidden = false;
    measure();
    S.cursor = null;
    S.detail = null;
    S.popup = null;
    S.playlists = { items: [], hasMore: true, nextOffset: 0, loading: false, loaded: false, error: null };
    const offState = S.bridge.on('state', onState);
    const offAuth = S.bridge.on('auth', onAuth);
    S.unsubscribe = () => { if (typeof offState === 'function') offState(); if (typeof offAuth === 'function') offAuth(); };
    render();
    requestAnimationFrame(() => requestAnimationFrame(() => dom.root.classList.add('open')));
    // Initial snapshot: auth first (decides the screen), then what is playing.
    try {
      const [status, playback] = await Promise.all([S.bridge.invoke('status').catch(() => null), S.bridge.invoke('nowPlaying').catch(() => null)]);
      if (!S.open) return;
      const snapshot = playback || status;
      if (snapshot?.auth) S.auth = snapshot.auth;
      if (snapshot) S.playback = snapshot;
      render();
      if (VM.screenFor(S.auth) === 'ready' && S.tab === 'search') setCursor({ id: 'field', row: 0, col: 0 });
    } catch { /* events will follow */ }
  }

  function onState(state) {
    if (!S.open || !state) return;
    const before = VM.screenFor(S.auth);
    S.playback = state;
    if (state.auth) S.auth = state.auth;
    updateHead();
    if (VM.screenFor(S.auth) !== before) { render(); return; }
    // Refresh now-playing marks on visible track rows without rebuilding anything.
    for (const row of dom.body.querySelectorAll('.mv-track')) {
      const item = findItemFor(row);
      if (item) row.classList.toggle('now-playing', Boolean(state.track?.uri && item.trackUri === state.track.uri));
    }
  }

  function onAuth(auth) {
    if (!S.open || !auth) return;
    S.auth = auth;
    render();
  }

  function findItemFor(row) {
    const block = currentBlocks().find((b) => b.id === row.dataset.block);
    return block?.items?.[Number(row.dataset.row)] || null;
  }

  function close() {
    if (!S.open) return;
    S.open = false;
    S.osk?.close();
    clearTimeout(S.searchTimer);
    clearTimeout(S.bannerTimer);
    S.unsubscribe?.();
    S.unsubscribe = null;
    dom.root.classList.remove('open', 'banner-open', 'popup-open');
    S.closeTimer = setTimeout(() => { dom.root.hidden = true; }, CLOSE_MS);
    const callback = S.onClose;
    S.onClose = null;
    callback?.();
  }

  window.MediaView = { open, close, handleAction, isOpen: () => S.open };
})();
