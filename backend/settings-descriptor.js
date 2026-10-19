'use strict';

/**
 * Single description of every user-facing setting. The admin panel (R05) is generated from this list, and
 * `test/settings-descriptor.test.js` fails when a validated setting is missing here or in INTERNAL_PATHS.
 *
 * Rule (AGENTS.md section 2): a new user-facing setting is added here in the same commit that adds it.
 *
 * Entry shape: { path, group, label, type, default?, options?, help }
 *   path    dotted path under config.settings (or under config for the root-level `websites`, not used here)
 *   type    'boolean' | 'text' | 'number' | 'enum' | 'object'
 *           'object' = a structured block; the panel shows it read-only in R05 and edits it on its own page
 *   group   the panel page the setting belongs to
 */

const GROUPS = Object.freeze({
  general: 'General',
  appearance: 'Appearance',
  wallpapers: 'Wallpapers',
  applications: 'Applications',
  remote: 'Remote host',
  music: 'Music',
  vpn: 'VPN',
  background: 'Background apps',
  performance: 'Performance',
  admin: 'Admin panel'
});

const SETTINGS = Object.freeze([
  { path: 'title', group: 'general', label: 'Title', type: 'text', default: '', help: 'Window title of the launcher.' },
  { path: 'cursorHideDelayMs', group: 'general', label: 'Hide cursor after (ms)', type: 'number', default: 2200, help: 'Mouse cursor hides after this idle time.' },
  { path: 'header', group: 'general', label: 'Header', type: 'object', help: 'Header text, date, time and weather location.' },
  { path: 'homeHeader', group: 'appearance', label: 'Home header layout', type: 'object', help: 'Layout, seconds, OLED protection and fade-in of the home header.' },
  { path: 'categories', group: 'appearance', label: 'Categories', type: 'object', help: 'Home rows (Home Theatre, Gaming and custom categories).' },
  { path: 'showTileLabels', group: 'appearance', label: 'Show labels on tiles', type: 'boolean', default: true, help: 'Name labels under tiles.' },
  { path: 'showCategoryHeadings', group: 'appearance', label: 'Show category headings', type: 'boolean', default: true, help: 'Heading above each home row.' },
  { path: 'theme', group: 'appearance', label: 'Theme', type: 'object', help: 'Preset, accent colour and theme overrides.' },
  { path: 'fontId', group: 'appearance', label: 'Font', type: 'text', default: 'inter', help: 'Font identifier from the bundled list.' },
  { path: 'performance', group: 'performance', label: 'Performance mode', type: 'enum', options: ['auto', 'quality', 'lite'], default: 'auto', help: 'lite removes blur and shadows.' },
  { path: 'wallpaper', group: 'wallpapers', label: 'Wallpaper', type: 'object', help: 'Wallpaper source, slideshow interval and folders.' },
  { path: 'wallpaperSources', group: 'wallpapers', label: 'Wallpaper sources', type: 'object', help: 'Folders and online catalogues used for wallpapers.' },
  { path: 'wallpaperCredit', group: 'wallpapers', label: 'Show wallpaper credit', type: 'boolean', default: true, help: 'Author and source of the current wallpaper.' },
  { path: 'background', group: 'wallpapers', label: 'Background', type: 'object', help: 'Background type and source.' },
  { path: 'scanDesktopEntries', group: 'applications', label: 'Discover installed applications', type: 'boolean', default: true, help: 'Scan the system for installed applications.' },
  { path: 'showHiddenDesktopEntries', group: 'applications', label: 'Show hidden desktop entries', type: 'boolean', default: false, help: 'Include desktop entries marked hidden.' },
  { path: 'remote', group: 'remote', label: 'Remote host (Vibepollo / Moonlight)', type: 'object', help: 'Host, API URL, Moonlight path and self-signed certificate.' },
  { path: 'mediaWidget', group: 'music', label: 'Show media widget', type: 'boolean', default: true, help: 'Now-playing widget on the home screen.' },
  { path: 'soloist', group: 'music', label: 'Spotify Soloist', type: 'object', help: 'Local Spotify player on Linux: enabled, device name, binary path.' },
  { path: 'vpn', group: 'vpn', label: 'VPN', type: 'object', help: 'Tailscale and Surfshark profile and mode.' },
  { path: 'backgroundApps', group: 'background', label: 'Background apps', type: 'object', help: 'How many apps may run in the background (1 to 8, default 3).' }
]);

/** Config paths that are deliberately not shown in the panel. Each needs a reason. */
const INTERNAL_PATHS = Object.freeze([
  { path: 'selectedAppIds', reason: 'Managed by the Applications page checkboxes; not a free-form setting.' },
  { path: 'hiddenAppIds', reason: 'Written by the Applications page when a remote app is switched off.' },
  { path: 'iconOverrides', reason: 'Icon choices made in the icon popup; edited per item, not as a block.' },
  { path: 'menu', reason: 'Root-level menu definition, not a setting.' },
  { path: 'rows', reason: 'Root-level custom tiles, edited on the Applications page.' },
  { path: 'websites', reason: 'Root-level website list, edited on the Websites page.' },
  { path: 'admin', reason: 'Bootstrap block (enabled, port, bind address): needed before the panel exists, so it is set in config.json.' }
]);

module.exports = { GROUPS, SETTINGS, INTERNAL_PATHS };
