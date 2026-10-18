'use strict';

const path = require('node:path');
const { START_URL, PARTITION, isAllowedUrl, normaliseBounds, zoomFor, cleanUserAgent } = require('../../../backend/spotify-web');

/**
 * ns `spotifyweb`: the Spotify web player embedded in the launcher window as a native view that the renderer
 * positions over its own stage element. Input is handled by spotify-web-preload.js inside the page.
 * Methods: open(bounds), setBounds(bounds), focus(), back() (history back, or close at the first page), close().
 * Events:  `closed` (the page asked to leave, or the view was destroyed).
 * The view is destroyed on close, so nothing keeps running while the home screen is in front.
 */

let view = null;
let ctxRef = null;
let ipcBound = false;
let current = null;

function destroy() {
  if (!view) return;
  const doomed = view;
  view = null;
  current = null;
  try { ctxRef?.getWindow()?.contentView.removeChildView(doomed); } catch { /* window already gone */ }
  try { doomed.webContents.close(); } catch { /* already closed */ }
}

function apply(bounds) {
  const clean = normaliseBounds(bounds);
  if (!clean || !view) return false;
  current = clean;
  view.setBounds(clean);
  view.webContents.setZoomFactor(zoomFor(clean));
  return true;
}

function requestClose() {
  destroy();
  ctxRef?.emit('closed', {});
}

function goBack() {
  const history = view?.webContents.navigationHistory;
  if (history?.canGoBack()) history.goBack();
  else requestClose();
}

function create(ctx) {
  const { WebContentsView } = require('electron');
  const created = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, '..', 'spotify-web-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const contents = created.webContents;
  contents.setUserAgent(cleanUserAgent(contents.getUserAgent()));
  const suppressConnectBanner = () => {
    const script = `(() => {
      const hideCandidates = (sources) => {
        const candidates = new Set();
        for (const source of sources) {
          let node = source.nodeType === Node.TEXT_NODE ? source.parentElement : source;
          for (let depth = 0; node && node !== document.body && depth < 6; depth += 1, node = node.parentElement) candidates.add(node);
        }
        for (const node of candidates) {
          if (node.children.length > 3) continue;
          const label = String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
          if (!/^(?:Playing|Listening) on .+/i.test(label)) continue;
          for (let target = node; target && target !== document.body; target = target.parentElement) {
            const rect = target.getBoundingClientRect();
            if (rect.width >= innerWidth * .72 && rect.height <= 100 && rect.bottom >= innerHeight - 130) {
              target.style.setProperty('display', 'none', 'important');
              break;
            }
          }
        }
      };
      let queued = false;
      const pending = new Set();
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          pending.add(record.target);
          for (const node of record.addedNodes) pending.add(node);
        }
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; hideCandidates(pending); pending.clear(); });
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      hideCandidates(document.querySelectorAll('body *'));
    })();`;
    void contents.executeJavaScript(script, true).catch(() => {});
  };
  contents.on('did-finish-load', suppressConnectBanner);
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) void contents.loadURL(url);
    return { action: 'deny' };
  });
  const guard = (event, url) => { if (!isAllowedUrl(url)) event.preventDefault(); };
  contents.on('will-navigate', (event) => guard(event, event.url));
  contents.on('will-redirect', (event) => guard(event, event.url));
  contents.on('destroyed', () => { if (view === created) { view = null; ctx.emit('closed', {}); } });
  try { created.setBackgroundColor('#121212'); created.setBorderRadius?.(28); } catch { /* cosmetic */ }
  return created;
}

module.exports = {
  namespace: 'spotifyweb',
  handlers: {
    open: (ctx, bounds) => {
      const window = ctx.getWindow();
      if (!window || window.isDestroyed()) return { ok: false, error: 'No window' };
      if (!normaliseBounds(bounds)) return { ok: false, error: 'Invalid bounds' };
      if (!view) {
        view = create(ctx);
        window.contentView.addChildView(view);
        void view.webContents.loadURL(START_URL);
      }
      apply(bounds);
      view.webContents.focus();
      return { ok: true };
    },
    setBounds: (_ctx, bounds) => ({ ok: apply(bounds) }),
    focus: () => { view?.webContents.focus(); return { ok: Boolean(view) }; },
    back: () => { goBack(); return { ok: true }; },
    close: () => { destroy(); return { ok: true }; }
  },
  start(ctx) {
    ctxRef = ctx;
    if (ipcBound) return;
    ipcBound = true;
    const { ipcMain } = require('electron');
    const fromView = (event) => Boolean(view) && event.sender === view.webContents;
    ipcMain.on('spotify-web:close', (event) => { if (fromView(event)) requestClose(); });
    ipcMain.on('spotify-web:back', (event) => { if (fromView(event)) goBack(); });
  },
  stop() { destroy(); }
};
