(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LaunchSession = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @typedef {import('../../backend/contracts').GameMetadata} GameMetadata
   * @typedef {import('../../backend/contracts').AppLaunchConfig} AppLaunchConfig
   * @typedef {import('../../backend/contracts').AppLifecycleEvent} AppLifecycleEvent
   * @typedef {import('../../backend/contracts').LauncherAppAPI} LauncherAppAPI
   * @typedef {readonly [row: number, col: number]} GridCoordinate
   * @typedef {{ id: string, items: GameMetadata[] }} GridRow
   */

  /* ---------------------------------------------------------------- grid → hero binding */

  /**
   * Resolves grid focus events to library entries and notifies the hero only when the focused game changes.
   * The grid coordinate is the primary key (row/column in the synced library layout); the item id is the
   * cross-check, so a stale coordinate after a library resync falls back to an id lookup instead of showing the wrong game.
   * @param {{ onHero: (game: GameMetadata) => void }} options
   */
  function createHeroBinding({ onHero }) {
    /** @type {GridRow[]} */
    let rows = [];
    /** @type {Map<string, GameMetadata>} */
    let byId = new Map();
    /** @type {string | null} */
    let currentId = null;

    return {
      /** Call with the same row array that is handed to the grid. @param {GridRow[]} nextRows */
      setRows(nextRows) {
        rows = nextRows;
        byId = new Map();
        for (const row of rows) for (const game of row.items) if (!byId.has(game.id)) byId.set(game.id, game);
      },
      /** Marks the game already shown by the hero so the first focus event does not re-emit it. @param {GameMetadata | null} game */
      reset(game) { currentId = game?.id ?? null; },
      /**
       * @param {GridCoordinate | null} coordinate
       * @param {GameMetadata | undefined} item
       * @returns {GameMetadata | null} the resolved game, or null when it cannot be mapped to the library
       */
      focus(coordinate, item) {
        const indexed = coordinate ? rows[coordinate[0]]?.items[coordinate[1]] : undefined;
        const game = indexed && (!item || indexed.id === item.id) ? indexed : (item && byId.get(item.id)) || null;
        if (!game) return null;
        if (game.id !== currentId) {
          currentId = game.id;
          onHero(game);
        }
        return game;
      },
      get currentId() { return currentId; },
      get size() { return byId.size; }
    };
  }

  /* ---------------------------------------------------------------- launch execution */

  /**
   * Maps a library entry to the IPC launch payload.
   * @param {GameMetadata} game
   * @returns {AppLaunchConfig}
   */
  function buildLaunchConfig(game) {
    const kind = game.type === 'website' ? 'website' : game.provider === 'remote' || game.remote ? 'stream' : 'native';
    return {
      appId: game.id,
      kind,
      fullscreen: true,
      ...(typeof game.command === 'string' && game.command ? { command: game.command } : {}),
      ...(Array.isArray(game.args) ? { args: game.args.filter((arg) => typeof arg === 'string') } : {}),
      ...(typeof game.url === 'string' && game.url ? { url: game.url } : {})
    };
  }

  const NO_HANDLER = /No handler registered/i;

  /**
   * Owns the idle → launching → running → idle lifecycle of the external application.
   * All transitions are idempotent, so the legacy `process-finished` event and the new `onAppClosed` event can both feed it.
   * @param {{
   *   api?: Pick<LauncherAppAPI, 'launchApp' | 'onAppLaunched' | 'onAppClosed'> | undefined,
   *   legacyLaunch?: (appId: string) => Promise<unknown>,
   *   onSuspend: (appId: string | null) => void,
   *   onResume: (event: AppLifecycleEvent) => void
   * }} options
   */
  function createLaunchSession({ api, legacyLaunch, onSuspend, onResume }) {
    /** @type {'idle' | 'launching' | 'running'} */
    let phase = 'idle';
    /** @type {string | null} */
    let activeAppId = null;

    /** @param {string | null} appId */
    function enterRunning(appId) {
      if (phase === 'running') return;
      phase = 'running';
      activeAppId = appId ?? activeAppId;
      onSuspend(activeAppId);
    }

    /** @param {AppLifecycleEvent} event */
    function close(event) {
      if (phase === 'idle') return;
      const appId = activeAppId;
      phase = 'idle';
      activeAppId = null;
      onResume({ ...event, appId: event.appId || appId || '' });
    }

    const unsubscribers = [
      api?.onAppLaunched((event) => { if (phase !== 'running') { activeAppId = event.appId; enterRunning(event.appId); } }),
      api?.onAppClosed(close)
    ].filter(Boolean);

    return {
      get phase() { return phase; },
      get busy() { return phase !== 'idle'; },
      get activeAppId() { return activeAppId; },
      /**
       * Launches a game through `window.api.launchApp`. Rejects (after resetting to idle) when the backend refuses.
       * @param {GameMetadata} game
       * @returns {Promise<boolean>} false when another launch is already in flight
       */
      async launch(game) {
        if (phase !== 'idle') return false;
        phase = 'launching';
        activeAppId = game.id;
        try {
          if (api) await api.launchApp(buildLaunchConfig(game));
          else await legacyLaunch?.(game.id);
        } catch (error) {
          // Transitional: backends that have not registered launchApp yet still serve the legacy tile launcher.
          if (api && legacyLaunch && NO_HANDLER.test(String(error?.message))) {
            try { await legacyLaunch(game.id); enterRunning(game.id); return true; }
            catch (legacyError) { phase = 'idle'; activeAppId = null; throw legacyError; }
          }
          phase = 'idle';
          activeAppId = null;
          throw error;
        }
        // A fast exit can deliver onAppClosed before launchApp resolves; do not resurrect the suspended state.
        if (phase === 'launching') enterRunning(game.id);
        return true;
      },
      /** Feeds an externally observed exit (legacy `process-finished`) into the same transition. @param {AppLifecycleEvent} event */
      notifyClosed: close,
      dispose() { for (const off of unsubscribers) off?.(); }
    };
  }

  return { createHeroBinding, buildLaunchConfig, createLaunchSession };
});
