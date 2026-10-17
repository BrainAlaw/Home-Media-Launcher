'use strict';

/**
 * Shared icon editing for the Applications and Websites pages: a small thumbnail button with a pencil badge
 * (createThumb) and one centred modal popup (open) with previews, Auto, Browse, Search artwork, Reset, Save and Cancel.
 *
 * The popup is its own <dialog> layered above the settings dialog. Input routing: SettingsDialog asks controls() for
 * the buttons the D-pad may reach and dismiss() when Back / Escape is pressed, so gamepad, keyboard and remote behave alike.
 *
 * API (window.IconPopup):
 *   createThumb({ value, kind, describe, fallback?, onChange? }) -> { element, getValue(), setValue(value) }
 *   open({ value, kind, describe, fallback?, opener?, onSave(value) })
 *   controls() -> HTMLElement[] | null   (null while the popup is closed)
 *   dismiss() -> boolean                 (true when a popup was open and is now closing)
 *   isOpen() -> boolean
 *   isClosing() -> boolean               (exit animation running; Back presses are swallowed)
 */
window.IconPopup = (function () {
  const Model = window.IconPopupModel;
  const SIZE_HINT = 'Tile art 1280×720 (16:9) · icon 512×512 PNG or SVG · poster 600×900';
  const CLOSE_FALLBACK_MS = 600;
  const SWALLOW_MS = 350;
  const PENCIL = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M11.1 2.3a1.6 1.6 0 0 1 2.3 2.3l-7.6 7.6-3.1.8.8-3.1z" fill="currentColor"/></svg>';

  /** @type {{ dialog: HTMLDialogElement, parts: Record<string, any> } | null} */
  let built = null;
  /** State of the popup that is currently open. */
  let session = null;
  /** True while the exit animation runs: Back / Escape presses in that window must not fall through to Settings. */
  let closing = false;
  const pendingClose = Model.createPendingClose();

  function el(tag, props = {}) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    return node;
  }

  /** Points an <img> at a stored icon value; hides it (via missing src) when nothing loadable is given. */
  function paintImage(image, source) {
    if (source && window.AssetUrl.isLoadableImage(source)) image.src = window.AssetUrl.assetUrl(source);
    else image.removeAttribute('src');
  }

  /* ------------------------------------------------------------------ thumbnail with pencil badge */

  function createThumb({ value = '', kind, describe, fallback = '', onChange }) {
    let current = String(value || '').trim();
    const button = el('button', { type: 'button', className: 'icon-thumb' });
    button.setAttribute('aria-haspopup', 'dialog');
    const image = el('img', { alt: '', decoding: 'async' });
    image.addEventListener('error', () => image.removeAttribute('src'));
    const initial = el('span', { className: 'icon-thumb-initial' });
    initial.setAttribute('aria-hidden', 'true');
    const badge = el('span', { className: 'icon-badge', innerHTML: PENCIL });
    badge.setAttribute('aria-hidden', 'true');
    button.append(image, initial, badge);

    const paint = () => {
      const { name } = describe();
      paintImage(image, current || fallback);
      initial.textContent = Model.initialOf(name);
      button.classList.toggle('has-icon', Boolean(current));
      button.setAttribute('aria-label', `Edit icon for ${name || 'this item'}`);
    };
    const setValue = (next) => { current = String(next || '').trim(); paint(); };
    button.addEventListener('click', () => open({
      value: current, kind, describe, fallback, opener: button,
      onSave: (next) => { setValue(next); onChange?.(current); }
    }));
    paint();
    return { element: button, getValue: () => current, setValue, refresh: paint };
  }

  /* ------------------------------------------------------------------ popup */

  function build() {
    if (built) return built;
    const dialog = el('dialog', { id: 'icon-popup', className: 'icon-popup' });
    dialog.setAttribute('aria-labelledby', 'icon-popup-title');
    const header = el('div', { className: 'dialog-header' });
    const heading = el('div', { className: 'icon-popup-heading' });
    const title = el('h2', { id: 'icon-popup-title', textContent: 'Edit icon' });
    const subject = el('small', { className: 'icon-popup-subject' });
    heading.append(title, subject);
    header.append(heading);

    const body = el('div', { className: 'icon-popup-body' });
    const previews = el('div', { className: 'icon-popup-previews' });
    const tileFrame = el('figure', { className: 'icon-popup-frame tile-frame' });
    const tileImage = el('img', { alt: '' });
    const tileArt = el('div', { className: 'icon-popup-art' });
    tileArt.append(tileImage);
    tileFrame.append(tileArt, el('figcaption', { textContent: 'Tile · 16:9' }));
    const squareFrame = el('figure', { className: 'icon-popup-frame square-frame' });
    const squareImage = el('img', { alt: '' });
    const squareArt = el('div', { className: 'icon-popup-art' });
    squareArt.append(squareImage);
    squareFrame.append(squareArt, el('figcaption', { textContent: 'Icon · square' }));
    for (const image of [tileImage, squareImage]) image.addEventListener('error', () => image.removeAttribute('src'));
    previews.append(tileFrame, squareFrame);

    const controls = el('div', { className: 'icon-popup-controls' });
    const input = el('input', { type: 'text', className: 'icon-popup-path', placeholder: 'Image path or web address (optional)' });
    input.setAttribute('aria-label', 'Icon image path or web address');
    input.dataset.osk = '';
    const buttons = el('div', { className: 'button-group icon-popup-actions' });
    const auto = el('button', { type: 'button', textContent: 'Auto' });
    const browse = el('button', { type: 'button', textContent: 'Browse…' });
    const search = el('button', { type: 'button', textContent: 'Search artwork' });
    const reset = el('button', { type: 'button', textContent: 'Reset' });
    buttons.append(auto, browse, search, reset);
    const status = el('small', { className: 'icon-status' });
    status.setAttribute('role', 'status');
    const results = el('div', { className: 'artwork-results icon-popup-results', hidden: true });
    const hint = el('small', { className: 'icon-hint', textContent: SIZE_HINT });
    controls.append(input, buttons, status, results, hint);
    body.append(previews, controls);

    const footer = el('footer');
    const cancel = el('button', { type: 'button', textContent: 'Cancel' });
    const save = el('button', { type: 'button', className: 'primary', textContent: 'Save' });
    footer.append(cancel, save);
    dialog.append(header, body, footer);
    document.body.append(dialog);

    const parts = { subject, tileImage, squareImage, input, auto, browse, search, reset, status, results, cancel, save };
    wire(dialog, parts);
    built = { dialog, parts };
    return built;
  }

  function wire(dialog, parts) {
    const { input, auto, browse, search, reset, status, results, cancel, save } = parts;
    const actionButtons = [auto, browse, search, reset];
    const busy = (isBusy) => actionButtons.forEach((button) => { button.disabled = isBusy; });
    const say = (message) => { status.textContent = message; };
    const clearResults = () => { results.replaceChildren(); results.hidden = true; };

    input.addEventListener('input', () => setDraft(input.value.trim(), { fromInput: true }));
    reset.addEventListener('click', () => { clearResults(); setDraft(''); say('Reset - the automatic artwork is used'); });
    cancel.addEventListener('click', () => close());
    save.addEventListener('click', () => {
      const { onSave, draft } = session;
      close();
      onSave(draft);
    });
    browse.addEventListener('click', async () => {
      const selected = await window.launcher.chooseFile('icon');
      if (!selected || !session) return;
      if (/\.(mp4|webm)$/i.test(selected)) { say('Icons must be image files'); return; }
      clearResults();
      setDraft(selected);
      say('');
    });
    auto.addEventListener('click', async () => {
      const { name, url } = session.describe();
      if (!name && !url) { say('Enter a name first'); return; }
      busy(true);
      say('Looking for an icon…');
      try {
        const result = await callExt('icons', 'resolve', { kind: session.kind, name, ...(url ? { url } : {}) });
        if (!session) return;
        const found = result && typeof result.url === 'string' ? result.url : '';
        if (!found) say('No automatic icon found - try Search artwork or Browse');
        else { clearResults(); setDraft(found); say(`Automatic icon applied${result.source ? ` (${result.source})` : ''}`); }
      } catch { say('Automatic icons are not available - use Browse or Search artwork'); }
      finally { busy(false); }
    });
    search.addEventListener('click', async () => {
      const { name } = session.describe();
      if (!name) { say('Enter a name first'); return; }
      busy(true);
      say('Searching artwork…');
      clearResults();
      try {
        const candidates = Model.normaliseCandidates(await callExt('icons', 'searchArtwork', name, Model.artKindFor(session.kind)));
        if (!session) return;
        if (!candidates.length) { say('No artwork found'); return; }
        for (const candidate of candidates) results.append(candidateButton(candidate));
        results.hidden = false;
        say('Pick an artwork');
        results.querySelector('button')?.focus();
      } catch { say('Artwork search is not available'); }
      finally { busy(false); }
    });

    function candidateButton(candidate) {
      const button = el('button', { type: 'button', className: 'artwork-candidate', title: candidate.label });
      button.setAttribute('aria-label', `Use artwork ${candidate.label}`);
      const thumb = el('img', { alt: '', loading: 'lazy', decoding: 'async', src: window.AssetUrl.assetUrl(candidate.thumb) });
      thumb.addEventListener('error', () => { button.remove(); if (!results.children.length) results.hidden = true; });
      button.append(thumb);
      button.addEventListener('click', async () => {
        busy(true);
        say('Fetching artwork…');
        let chosen = candidate.url;
        try {
          const cached = await callExt('icons', 'cacheCandidate', candidate.url);
          if (cached && typeof cached.url === 'string' && cached.url) chosen = cached.url;
        } catch { /* the remote address still works as the icon source */ }
        finally { busy(false); }
        if (!session) return;
        clearResults();
        setDraft(chosen);
        say('Artwork selected');
        save.focus();
      });
      return button;
    }

    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    dialog.addEventListener('keydown', onKeydown);
  }

  /** Keyboard arrows move between controls with the same spatial rules as the gamepad; text fields keep their caret keys. */
  function onKeydown(event) {
    // Handled here so the browser's own Escape handling never also cancels the Settings dialog underneath.
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key];
    if (!direction) return;
    const inText = document.activeElement?.tagName === 'INPUT';
    if (inText && (direction === 'left' || direction === 'right')) return;
    event.preventDefault();
    event.stopPropagation();
    moveFocus(direction);
  }

  function moveFocus(direction) {
    const items = controls();
    const current = items.indexOf(document.activeElement);
    if (!items.length) return;
    if (current === -1) { items[0].focus(); return; }
    const rects = items.map((item, index) => window.SpatialNav.toRect(index, item));
    const next = window.SpatialNav.findNext(rects[current], rects, direction);
    if (next !== null) items[next].focus();
  }

  /** Updates the staged value and everything that mirrors it. */
  function setDraft(value, { fromInput = false } = {}) {
    if (!session) return;
    session.draft = value;
    const { input, tileImage, squareImage } = built.parts;
    if (!fromInput) input.value = value;
    const shown = value || session.fallback;
    paintImage(tileImage, shown);
    paintImage(squareImage, shown);
  }

  async function callExt(namespace, method, ...args) {
    const bridge = window.launcher?.ext;
    if (!bridge || typeof bridge.invoke !== 'function') throw new Error('Extension bridge unavailable');
    return bridge.invoke(namespace, method, ...args);
  }

  /** @param {{ value?: string, kind: 'app' | 'website' | 'game', describe: () => { name: string, url?: string }, fallback?: string, opener?: HTMLElement, onSave: (value: string) => void }} options */
  function open(options) {
    const { dialog, parts } = build();
    // A reopen during the exit animation completes the pending close first (dialog.close + focus return), then opens afresh.
    pendingClose.flush();
    if (dialog.open) return;
    dialog.classList.remove('closing');
    session = { kind: options.kind, describe: options.describe, fallback: options.fallback || '', opener: options.opener || null, onSave: options.onSave, draft: '' };
    const { name } = options.describe();
    parts.subject.textContent = name || '';
    parts.results.replaceChildren();
    parts.results.hidden = true;
    parts.status.textContent = '';
    parts.auto.disabled = parts.browse.disabled = parts.search.disabled = parts.reset.disabled = false;
    setDraft(String(options.value || '').trim());
    dialog.showModal();
    parts.save.focus();
  }

  /** Animates out (transform and opacity only), then closes and hands focus back to the originating badge. */
  function close() {
    if (!built || !session || !built.dialog.open) return closing;
    const { dialog } = built;
    const { opener } = session;
    session = null;
    closing = true;
    const run = pendingClose.arm(() => {
      // Chrome may deliver the same Escape to the dialog underneath right after this one closes; keep swallowing Back briefly.
      setTimeout(() => { closing = false; }, SWALLOW_MS);
      if (dialog.open) dialog.close();
      dialog.classList.remove('closing');
      if (opener?.isConnected) opener.focus();
    });
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { run(); return true; }
    // The CSS exit animation (transform and opacity) ends the close; the timer only covers a missing animationend.
    dialog.addEventListener('animationend', (event) => { if (event.target === dialog) run(); }, { once: true });
    dialog.classList.add('closing');
    setTimeout(run, CLOSE_FALLBACK_MS);
    return true;
  }

  function controls() {
    if (!built || !session) return [];
    return [...built.dialog.querySelectorAll('button, input')]
      .filter((control) => !control.disabled && control.getClientRects().length > 0);
  }

  return {
    createThumb,
    open,
    dismiss: close,
    controls: () => (session ? controls() : null),
    isOpen: () => Boolean(session),
    isClosing: () => closing
  };
})();
