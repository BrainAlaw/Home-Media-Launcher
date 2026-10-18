export type ThemeId = string;
export type AssetKind = 'image' | 'video' | 'audio';
export interface ThemePalette {
  background: string; surface: string; accent: string; text: string; mutedText: string;
}
export interface ThemeLayout {
  showHeroCard: boolean;
  showClock?: boolean; showDate?: boolean; compactCards?: boolean; reduceMotion?: boolean;
}
export type ThemeBackground = { type: 'none'; source: '' } | { type: 'image' | 'video'; source: string };
export interface ThemeSounds {
  enabled: boolean; volume: number; focus?: string; confirm?: string; back?: string;
}
export interface Theme {
  /** Optional bundled font id (see ThemeEngine.FONTS). */ fontId?: string;
  id: ThemeId; name: string; palette: ThemePalette; layout: ThemeLayout;
  background: ThemeBackground; sounds?: ThemeSounds;
  extensions?: Record<string, string | number | boolean | null>;
}
export interface ThemeStoreDocument { version: 1; currentThemeId: ThemeId; themes: Theme[] }
export interface ResolvedTheme extends Theme {
  assets: { background: string | null; sounds: Partial<Record<'focus' | 'confirm' | 'back', string>> };
  unavailableAssets: string[];
}
export interface ThemeState { revision: number; currentTheme: ResolvedTheme; themes: ResolvedTheme[] }
export interface AppBackground {
  appId: string;
  state: 'ready' | 'loading' | 'missing';
  url: string | null;
  kind: 'hero_image' | 'fanart' | 'background' | null;
}
export interface ThemeLauncherAPI {
  getAvailableThemes(): Promise<ResolvedTheme[]>;
  getCurrentTheme(): Promise<ResolvedTheme>;
  setTheme(themeId: ThemeId): Promise<ResolvedTheme>;
  saveCustomTheme(theme: Theme): Promise<ResolvedTheme>;
  getAppBackground(appId: string): Promise<AppBackground>;
  getAppBackgrounds(): Promise<Record<string, AppBackground>>;
  onThemeChanged(callback: (state: ThemeState) => void): () => void;
  onAppBackgroundChanged(callback: (artwork: AppBackground) => void): () => void;
}
export interface MenuItem {
  id: string; label: string; action: 'home' | 'library' | 'settings' | 'category'; category?: string; visible?: boolean;
}
export interface MenuDefinition {
  version: 1; layout: 'top-bar' | 'side-dock';
  groups: { id: string; label: string; items: MenuItem[] }[];
  slideshow?: { enabled: boolean; lookAhead?: 3 | 4 | 5; intervalMs?: number; assets: { type: 'image' | 'video'; source: string }[] };
}
export interface MenuIndicatorSnapshot {
  revision: number;
  system: {
    network: { linkAvailable: boolean | null; interfaceCount: number };
    battery: { present: boolean | null; percent: number | null; onBattery: boolean | null };
    sampledAt: string | null; error: string;
  };
  moonlight: { status: 'disabled' | 'online' | 'cached' | 'offline'; host: string; error: string; message: string; warning: string; updatedAt: string };
}
export interface SlideshowState {
  currentIndex: number; lookAhead: number; enabled: boolean; cachedBytes: number;
  slides: { type: 'image' | 'video'; url: string | null; memory: 'full' | 'partial' | 'pending' | 'cold' | 'unavailable' }[];
}
export interface NavigationHint { appId?: string | null; slideshowIndex?: number }
export interface MenuLauncherAPI {
  getMenuConfiguration(): Promise<MenuDefinition>;
  getMenuIndicators(): Promise<MenuIndicatorSnapshot>;
  getCachedMenuIndicators(): MenuIndicatorSnapshot | null;
  getCachedAppBackground(appId: string): AppBackground;
  getSlideshowState(): Promise<SlideshowState>;
  prefetchSlideshow(index: number): Promise<SlideshowState>;
  hintNavigation(hint: NavigationHint): void;
  onMenuConfigurationChanged(callback: (definition: MenuDefinition) => void): () => void;
  onMenuIndicators(callback: (indicators: MenuIndicatorSnapshot) => void): () => void;
  onSlideshowState(callback: (state: SlideshowState) => void): () => void;
}

export type ControllerTransport = 'bluetooth' | 'dongle' | 'usb';
export type ControllerErrorCode = 'BLUETOOTH_UNAVAILABLE' | 'BLUETOOTH_SOFT_BLOCKED' | 'BLUETOOTH_HARD_BLOCKED'
  | 'ADAPTER_NOT_FOUND' | 'ADAPTER_POWERED_OFF' | 'PERMISSION_DENIED' | 'DONGLE_NOT_FOUND' | 'DRIVER_MISSING'
  | 'DONGLE_PAIRING_UNSUPPORTED' | 'SCAN_TIMEOUT' | 'PAIR_FAILED' | 'TRUST_FAILED' | 'CONNECT_FAILED'
  | 'CANCELLED' | 'UNSUPPORTED_PLATFORM' | 'UNKNOWN';
export interface Controller {
  id: string; name: string; transport: ControllerTransport; battery: number | null; charging: boolean;
  /** Compatibility field; false for discovered devices and true for verified connected devices. */
  connected?: boolean;
}
export interface ControllerError { code: ControllerErrorCode; message: string }
export interface ControllerStatus {
  platform: string; supported: boolean; message: string; controllers: Controller[]; code?: ControllerErrorCode;
}
export interface ControllerPairingUpdate {
  state: 'scanning' | 'complete' | 'error' | 'cancelled'; transport: ControllerTransport;
  devices: Controller[]; message: string; code?: ControllerErrorCode;
}
export type ControllerPairResult = { success: true; message: string; controller: Controller }
  | { success: false; message: string; code: ControllerErrorCode };
export interface DongleStatus { present: boolean; driver: 'xone' | 'xpadneo' | null; pairingSupported: boolean }
export interface ControllerLauncherAPI {
  getControllerStatus(): Promise<ControllerStatus>;
  getConnectedGamepads(): Promise<ControllerStatus>;
  getDongleStatus(): Promise<DongleStatus>;
  startControllerPairing(transport: ControllerTransport): Promise<ControllerPairingUpdate>;
  startDonglePairing(): Promise<ControllerPairingUpdate>;
  pairController(id: string): Promise<ControllerPairResult>;
  cancelControllerPairing(): Promise<{ cancelled: boolean }>;
  cancelPairing(): Promise<{ cancelled: boolean }>;
  unblockBluetooth(): Promise<{ success: boolean; message: string; code?: ControllerErrorCode }>;
  onControllerPairingUpdate(callback: (update: ControllerPairingUpdate) => void): () => void;
  onDeviceFound(callback: (device: Controller) => void): () => void;
  onPairingSuccess(callback: (controller: Controller) => void): () => void;
  onPairingError(callback: (error: ControllerError) => void): () => void;
  onBatteryUpdate(callback: (update: Pick<Controller, 'id' | 'battery' | 'charging'>) => void): () => void;
  onControllersChanged(callback: (controllers: Controller[]) => void): () => void;
}

/* ---------------------------------------------------------------- library sync & app execution */

export type AppKind = 'native' | 'website' | 'stream';
/** One library entry as rendered by the grid and hero. Structurally compatible with the renderer Tile model. */
export interface GameMetadata {
  id: string; name: string;
  provider?: 'local' | 'remote'; remote?: boolean;
  type?: string;
  icon?: string; background?: string; hero_image?: string;
  command?: string; args?: string[]; url?: string;
}
export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  /** Monotonic; consumers ignore snapshots older than the one they already hold. */
  revision: number;
  lastSyncedAt: string | null;
  itemCount: number;
  error: string | null;
}
export interface AppLaunchConfig {
  appId: string;
  kind: AppKind;
  fullscreen: boolean;
  command?: string; args?: string[]; url?: string;
}
export interface AppLaunchResult { appId: string; pid: number | null }
export interface AppLifecycleEvent {
  appId: string;
  exitCode?: number | null;
  error?: string;
}
export type Unsubscribe = () => void;
/** Exposed by the preload script as `window.api`. */
export interface LauncherAppAPI {
  launchApp(config: AppLaunchConfig): Promise<AppLaunchResult>;
  onAppLaunched(callback: (event: AppLifecycleEvent) => void): Unsubscribe;
  onAppClosed(callback: (event: AppLifecycleEvent) => void): Unsubscribe;
  onSyncStatus(callback: (status: SyncStatus) => void): Unsubscribe;
}
declare global {
  interface Window { api?: LauncherAppAPI }
}

export interface SyncProgress { phase: 'metadata' | 'artwork' | 'complete' | 'offline'; completed: number; total: number }
export interface GameLibrary {
  tiles: Array<Record<string, unknown>>;
  status: 'disabled' | 'online' | 'cached' | 'offline';
  /** True when the host is unreachable; `tiles` then come from the local cache. */
  isVibepolloOffline: boolean;
  host: string; updatedAt: string; error: string; warning: string;
}
export interface AppLaunchedEvent { pid?: number; tileId: string; type: string }
export interface AppClosedEvent { tileId: string; code?: number | null; signal?: string | null; error?: string; website?: boolean }
export interface LibraryLauncherAPI {
  getGameLibrary(): Promise<GameLibrary>;
  forceSync(): Promise<GameLibrary>;
  /** Rejects when the binary is missing or the process cannot start. Only `{ id }` is honoured. */
  launchApp(appConfig: { id: string }): Promise<{ pid?: number } | boolean>;
  onAppLaunched(callback: (event: AppLaunchedEvent) => void): () => void;
  onAppClosed(callback: (event: AppClosedEvent) => void): () => void;
  onSyncProgress(callback: (progress: SyncProgress) => void): () => void;
}

export interface WallpaperFolder { path: string; name: string }
export interface WallpaperFolderInfo { path: string; name: string; images: number; videos: number; total: number; available: boolean }
/** Persisted in settings.wallpaper. */
export interface WallpaperSettings {
  mode: 'custom' | 'bundled' | 'slideshow'; id: string; intervalSec: number;
  source: 'bundled' | 'folder' | 'online' | 'mixed'; folderPath: string; folders: WallpaperFolder[];
  shuffle: boolean; /** Opt-in: stream images from the internet. */ online: boolean;
}
export interface WallpaperRequest { folders: string[]; online: boolean }
export interface WallpaperLauncherAPI {
  /** Native directory dialog; resolves null when cancelled. */
  pickWallpaperFolder(): Promise<WallpaperFolderInfo | null>;
  inspectWallpaperFolder(folder: string): Promise<WallpaperFolderInfo>;
  getWallpaperCount(request: WallpaperRequest): Promise<{ count: number }>;
  /** Registers exactly one slide; null when the file vanished or could not be fetched. */
  getWallpaperSlide(request: WallpaperRequest, index: number): Promise<{ url: string; kind: 'image' | 'video'; name: string; credit: WallpaperCredit | null } | null>;
  getOnlineWallpaperStatus(): Promise<{ available: boolean; count: number }>;
  clearOnlineWallpapers(): Promise<boolean>;
  /** Wallpaper source editor (iteration 4, agent D). */
  wallpaperSources(action: 'inspect', payload: { sources: WallpaperSource[] }): Promise<WallpaperSourcesReport>;
  wallpaperSources(action: 'probe', payload: { location: string }): Promise<WallpaperSourceProbe>;
  wallpaperSources(action: 'clearCache'): Promise<{ removed: number }>;
}
/** Attribution for the wallpaper on screen. Empty strings mean "unknown" and are skipped by the overlay. */
export interface WallpaperCredit { title: string; author: string; license: string; source: string; location: string; origin: 'bundled' | 'online' | 'local' }
/**
 * An entry of settings.wallpaperSources. Folder: `location` is an absolute path. Online: `location` is a known provider
 * (`builtin:wikimedia-commons`) or an https URL of a JSON catalogue (`[{ title, url, thumbUrl?, author?, license?, source?, location? }]`
 * or `{ name?, wallpapers: [...] }`; at most 1 MB / 500 items; only https image URLs on public hosts are fetched, 12 MB per image).
 */
export interface WallpaperSource { id: string; label: string; kind: 'folder' | 'online'; location: string; enabled: boolean }
export interface WallpaperSourceInfo { id: string; kind: 'folder' | 'online'; count: number; available: boolean; cacheBytes: number; error: string; host?: string; images?: number; videos?: number }
export interface WallpaperSourcesReport { sources: WallpaperSourceInfo[]; cacheBytes: number; onlineAvailable: boolean }
export interface WallpaperSourceProbe { ok: boolean; error: string; count: number; name: string; location: string }

/* ------------------------------------------------------------------ Iteration 4 extension contracts
 * Reached through `window.launcher.ext.invoke(namespace, method, ...args)` / `.on(namespace, event, cb)`.
 * Each namespace is implemented by exactly one file in src/main/ext/. */

export interface ExtBridge {
  invoke<T = unknown>(namespace: ExtNamespace, method: string, ...args: unknown[]): Promise<T>;
  on<T = unknown>(namespace: ExtNamespace, event: string, callback: (value: T) => void): () => void;
}
export type ExtNamespace = 'system' | 'vpn' | 'icons' | 'session' | 'remote' | 'weather' | 'input' | 'media' | 'soloist' | 'spotifyweb';

/** ns `system` (agent B). Events: `network` (NetworkStatus). Methods: `getNetwork()`. */
export interface NetworkStatus {
  type: 'ethernet' | 'wifi' | 'none' | 'unknown';
  connected: boolean;
  ssid?: string;
  /** 0-100, wifi only */
  signal?: number;
  ip?: string;
}

/** ns `vpn` (agent B). Events: `status` (VpnStatus[]). Methods: `list()`, `toggle(id, enabled)`. */
export interface VpnStatus {
  id: 'tailscale' | 'surfshark';
  label: string;
  available: boolean;
  connected: boolean;
  busy: boolean;
  detail?: string;
  error?: string;
  /** Surfshark only: the strategy in use (`rasdial`, `wireguard-service`, `openvpn-gui` or `nmcli`). Additive. */
  mode?: string;
}

/** ns `weather` (agent B). Methods: `get(location)`. Provider: OpenWeatherMap, key from WEATHER_API. */
export interface WeatherSnapshot {
  location: string;
  temperature: number;
  feelsLike: number;
  condition: string;
  /** OpenWeatherMap icon code, e.g. "10d" */
  icon: string;
  forecast: Array<{ day: string; min: number; max: number; icon: string }>;
  fetchedAt: number;
}

/** ns `remote` (agent A). Methods: `getHostInfo()`. Events: `host` (VibepolloHostInfo). Values come from VP_HOST / VP_IP / VP_API. */
export interface VibepolloHostInfo {
  hostname: string;
  ip: string;
  status: 'online' | 'offline' | 'cached' | 'disabled';
  lastSyncAt?: number;
}

/** ns `icons` (agent C). Methods: `resolve(request)`, `listPresets()`, `searchArtwork(query)`. */
export interface IconRequest { kind: 'website' | 'game' | 'app'; name: string; url?: string; steamAppId?: number; /** Defaults: game -> 'poster', otherwise 'icon'. */ art?: ArtKind }
export interface IconResult { source: 'preset' | 'site' | 'steamgriddb' | 'playnite' | 'letter'; url: string; width?: number; height?: number }
export type ArtKind = 'poster' | 'hero' | 'icon' | 'logo';
/** ns `icons` searchArtwork(query, art?) item. */
export interface ArtworkCandidate { id: number; art: ArtKind; url: string; thumb: string; width?: number; height?: number; gameId: number; gameName: string }
export interface IconSizeSpec { width: number; height: number; formats: string[]; transparent?: boolean }
/** ns `icons` sizes(). */
export interface IconSizes { tile: IconSizeSpec; appIcon: IconSizeSpec; poster: IconSizeSpec; hero: IconSizeSpec; logo: IconSizeSpec }
/** ns `icons` also: cacheCandidate(url): IconResult, addPresetWebsites(websites, ids), firstRunWebsites(), sizes(), hasSteamGridDb(). */
export interface WebPreset { id: string; name: string; url: string; icon: string; color: string; category: 'video' | 'music' | 'other' }

/** ns `session` (agent E). Events: `phase` (SessionPhase), `notice` (SessionNotice). Methods: `closeActive()`, `getPhase()`, `getStatus()`. */
export interface SessionNotice { message: string }
export interface SessionStatus { phase: SessionPhase["phase"]; guideAvailable: boolean; guideReason: string; overlayMode: "overlay" | "direct" }
export type SessionPhase =
  | { phase: 'idle' }
  | { phase: 'launching'; tileId: string; name: string }
  | { phase: 'running'; tileId: string; name: string }
  | { phase: 'closing'; tileId: string; name: string };

/** ns `input` (agent F). Events: `key` ({ action }). Remote buttons mapped to launcher actions. */
export type RemoteAction = 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'home' | 'menu' | 'playpause' | 'context';

/** Config additions (Settings.* in config.json), owned as noted. */
export interface Iteration4Settings {
  /** agent D. When absent it is migrated from settings.wallpaper.folders / .online; on save the legacy fields are kept in sync. */
  wallpaperSources?: WallpaperSource[];
  /** agent D. Show the Google-TV-style credit when the wallpaper changes (default true). */
  wallpaperCredit?: boolean;
  /** agent G. Visual cost level: `lite` drops blur/shadows/sheen; `auto` switches to lite after 5 s below 45 fps (default auto). */
  performance?: 'auto' | 'quality' | 'lite';
  /** agent B */
  vpn?: {
    /** Strategy; `auto` tries Windows VPN (rasdial), WireGuard service, OpenVPN GUI on Windows and nmcli on Linux. */
    surfsharkMode?: 'auto' | 'wireguard-service' | 'openvpn-gui' | 'rasdial' | 'nmcli';
    /** Profile / tunnel / config name for the chosen strategy. */
    surfsharkProfile?: string;
    /** Legacy alias of `surfsharkProfile`, still honoured. */
    surfsharkWireguardProfile?: string;
  };
}

/* ------------------------------------------------------------------ Iteration 5: ns `media` (Spotify Web API, PKCE)
 * Backend: M1 (src/main/ext/media.js + backend/spotify/). Widget: M2. Music view: M3. Tokens never reach the renderer.
 * Methods: status(), login(), logout(), nowPlaying(), control(command), setVolume(percent), devices(), transfer(deviceId), connectDesktop(),
 *          search(query, types?), playlists(offset?), playlistTracks(id, offset?), play(request), openSpotifyApp(),
 *          setActive(active: boolean) -> { ok, active }  (iteration 6, additive: the renderer reports whether any media UI is
 *          visible; the backend polls GET /me/player only while active, default inactive, immediate fetch on activation).
 * Events:  `state` (MediaState, pushed on change and polled adaptively), `auth` (MediaAuthState). */
export type MediaAuthState =
  | { status: 'unconfigured' }                       // SPOTIFY_CLIENT_ID missing
  | { status: 'signed-out' }
  | { status: 'signing-in'; url: string }            // browser opened; url shown for fallback
  | { status: 'signed-in'; displayName: string; product?: string }
  | { status: 'error'; message: string };

export interface MediaTrack { id: string; uri: string; title: string; artists: string[]; album: string; artUrl?: string; durationMs: number }
export interface MediaDevice { id: string; name: string; type: string; active: boolean; volume?: number }
export interface MediaState {
  auth: MediaAuthState;
  playing: boolean;
  track?: MediaTrack;
  progressMs?: number;
  shuffle?: boolean;
  repeat?: 'off' | 'track' | 'context';
  volume?: number;
  device?: MediaDevice;
  /** true when nothing is playing and no device is active (widget offers to open Spotify) */
  idle: boolean;
  updatedAt: number;
}
export type MediaCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'shuffle' | 'repeat' | 'volume-up' | 'volume-down';
export interface MediaPlaylist { id: string; uri: string; name: string; trackCount: number; artUrl?: string; owner?: string }
export interface MediaSearchResult { tracks: MediaTrack[]; albums: Array<{ id: string; uri: string; name: string; artist: string; artUrl?: string }>; playlists: MediaPlaylist[]; artists: Array<{ id: string; uri: string; name: string; artUrl?: string }> }
export interface MediaPlayRequest { contextUri?: string; uris?: string[]; offsetUri?: string; deviceId?: string }

/** Iteration 5 settings (owned as noted). */
export interface Iteration5Settings {
  /** AP/H1: categories drive the home rows. Defaults: theatre + gaming. */
  categories?: Array<{ id: string; label: string; builtin?: 'theatre' | 'gaming' }>;
  /** AP: show labels on tiles */
  showTileLabels?: boolean;
  /** AP: show category headings above home screen tile rows */
  showCategoryHeadings?: boolean;
  /** H1/AP: header layout */
  homeHeader?: { layout: 'split' | 'centred'; showSeconds?: boolean; oledProtection?: boolean; fadeIn?: boolean };
  /** M2: show the media widget on the home screen */
  mediaWidget?: boolean;
  /** I7 (Soloist): local Spotify Connect player, Linux only. See SoloistSettings. */
  soloist?: SoloistSettings;
}

/* ------------------------------------------------------------------ Iteration 7: ns `soloist` (local Soloist player, Linux only)
 * Backend: src/main/ext/soloist.js + backend/soloist/ (manager, settings). The API key (SPOTIFY_SOLOIST_API, .env) is read only in
 * the main process and never appears in any payload, log or error.
 * Methods: status(), detect(), start(), stop(), restart(), apply() (re-reads settings.soloist and reconciles the process).
 * Events:  `status` (SoloistStatus, pushed on change). */
export interface SoloistSettings {
  /** Default false. */
  enabled?: boolean;
  /** Spotify Connect device name, matched case-insensitively in GET /me/player/devices. Default 'Home Media Launcher'. */
  deviceName?: string;
  /** Optional absolute path to the Soloist binary; empty or absent means auto-detect. */
  binaryPath?: string;
}

/** `unsupported`: win32/darwin. `disabled`: settings.soloist.enabled is false. `not-installed`: binary not found.
 *  `stopped`: enabled but not running. `starting`: process up, socket or login pending. `connected`: socket live, Spotify
 *  playback is handled by Soloist. `error`: see `message`. */
export type SoloistState = 'unsupported' | 'disabled' | 'not-installed' | 'stopped' | 'starting' | 'connected' | 'error';
export interface SoloistStatus {
  state: SoloistState;
  platform: string;
  enabled: boolean;
  deviceName: string;
  connected: boolean;
  /** Sanitised (API key removed, bounded length). */
  message?: string;
}
