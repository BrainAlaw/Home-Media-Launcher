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
  getWallpaperSlide(request: WallpaperRequest, index: number): Promise<{ url: string; kind: 'image' | 'video'; name: string } | null>;
  getOnlineWallpaperStatus(): Promise<{ available: boolean; count: number }>;
  clearOnlineWallpapers(): Promise<boolean>;
}
