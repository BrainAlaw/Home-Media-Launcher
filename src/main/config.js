'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, serialize } = require('../../backend/storage');
const { launchSpec } = require('../../backend/launch-spec');
const { validateMenu } = require('../../backend/menu-config');
const { isSafeProfileName } = require('../../backend/vpn');
const WallpaperSources = require('../renderer/wallpaper-sources');

const DEFAULT_CONFIG = Object.freeze({
  settings: {
    title: 'Home',
    scanDesktopEntries: true,
    showHiddenDesktopEntries: false,
    cursorHideDelayMs: 2200,
    background: { type: 'image', source: '' }
  },
  rows: []
});

function validateTile(tile, location) {
  if (!tile || typeof tile !== 'object') throw new Error(`${location} must be an object`);
  if (typeof tile.name !== 'string' || !tile.name.trim()) throw new Error(`${location}.name is required`);
  if (typeof tile.command !== 'string' || !tile.command.trim()) throw new Error(`${location}.command is required`);
  if (tile.args !== undefined && (!Array.isArray(tile.args) || tile.args.some((arg) => typeof arg !== 'string'))) {
    throw new Error(`${location}.args must be an array of strings`);
  }
  if (tile.shell !== undefined && typeof tile.shell !== 'boolean') throw new Error(`${location}.shell must be boolean`);
  if (tile.shell === true && ['browser', 'webapp', 'moonlight'].includes(tile.type)) throw new Error(`${location}.shell is not allowed for ${tile.type} tiles`);
  launchSpec(tile);
  if (tile.cwd !== undefined && (typeof tile.cwd !== 'string' || !path.isAbsolute(tile.cwd))) throw new Error(`${location}.cwd must be an absolute path`);
  if (tile.env !== undefined && (!tile.env || typeof tile.env !== 'object' || Array.isArray(tile.env) || Object.entries(tile.env).some(([key, value]) => /[=\0]/.test(key) || typeof value !== 'string' || value.includes('\0')))) throw new Error(`${location}.env must contain string environment values`);
}

function validateWallpaper(wallpaper) {
  if (wallpaper === undefined) return;
  if (!wallpaper || typeof wallpaper !== 'object' || Array.isArray(wallpaper)) throw new Error('wallpaper must be an object');
  if (wallpaper.source !== undefined && !['bundled', 'folder', 'online', 'mixed'].includes(wallpaper.source)) throw new Error('wallpaper.source is invalid');
  for (const key of ['shuffle', 'online']) {
    if (wallpaper[key] !== undefined && typeof wallpaper[key] !== 'boolean') throw new Error(`wallpaper.${key} must be boolean`);
  }
  if (wallpaper.folders !== undefined) {
    if (!Array.isArray(wallpaper.folders) || wallpaper.folders.length > 32) throw new Error('wallpaper.folders must be an array of at most 32 folders');
    wallpaper.folders.forEach((folder, index) => {
      if (!folder || typeof folder.path !== 'string' || !path.isAbsolute(folder.path) ||/[\x00-\x1f]/.test(folder.path)) throw new Error(`wallpaper.folders[${index}].path must be an absolute path`);
      if (folder.name !== undefined && typeof folder.name !== 'string') throw new Error(`wallpaper.folders[${index}].name must be a string`);
    });
  }
}

/** settings.wallpaperSources: folders by absolute path, online sources by built-in provider or https catalogue URL. */
function validateWallpaperSources(sources) {
  if (sources === undefined) return;
  if (!Array.isArray(sources) || sources.length > WallpaperSources.MAX_SOURCES) throw new Error(`wallpaperSources must be an array of at most ${WallpaperSources.MAX_SOURCES} sources`);
  sources.forEach((source, index) => {
    const location = `wallpaperSources[${index}]`;
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`${location} must be an object`);
    if (typeof source.id !== 'string' || !/^[a-z0-9][a-z0-9:_.-]{0,63}$/i.test(source.id)) throw new Error(`${location}.id is invalid`);
    if (source.label !== undefined && (typeof source.label !== 'string' || source.label.length > 80)) throw new Error(`${location}.label must be a string of at most 80 characters`);
    if (typeof source.enabled !== 'boolean') throw new Error(`${location}.enabled must be boolean`);
    if (source.kind === 'folder') {
      if (typeof source.location !== 'string' || !path.isAbsolute(source.location) || /[\x00-\x1f]/.test(source.location) || source.location.length > 4096) throw new Error(`${location}.location must be an absolute path`);
    } else if (source.kind === 'online') {
      const parsed = WallpaperSources.parseOnlineLocation(source.location);
      if (!parsed.ok) throw new Error(`${location}.location: ${parsed.error}`);
    } else throw new Error(`${location}.kind must be "folder" or "online"`);
  });
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Configuration root must be an object');
  if (config.menu !== undefined) validateMenu(config.menu);
  if (config.settings !== undefined && (!config.settings || typeof config.settings !== 'object' || Array.isArray(config.settings))) throw new Error('settings must be an object');
  if (config.settings?.selectedAppIds !== undefined && (!Array.isArray(config.settings.selectedAppIds) || config.settings.selectedAppIds.some((id) => typeof id !== 'string'))) throw new Error('selectedAppIds must be an array of strings');
  if (config.settings?.hiddenAppIds !== undefined && (!Array.isArray(config.settings.hiddenAppIds) || config.settings.hiddenAppIds.some((id) => typeof id !== 'string'))) throw new Error('hiddenAppIds must be an array of strings');
  validateWallpaper(config.settings?.wallpaper);
  validateWallpaperSources(config.settings?.wallpaperSources);
  if (config.settings?.wallpaperCredit !== undefined && typeof config.settings.wallpaperCredit !== 'boolean') throw new Error('wallpaperCredit must be boolean');
  if (config.settings?.performance !== undefined && !['auto', 'quality', 'lite'].includes(config.settings.performance)) throw new Error('performance must be "auto", "quality" or "lite"');
  if (config.settings?.fontId !== undefined && (typeof config.settings.fontId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(config.settings.fontId))) throw new Error('fontId must be a font identifier');
  const vpnProfile = config.settings?.vpn?.surfsharkWireguardProfile;
  if (config.settings?.vpn !== undefined && (!config.settings.vpn || typeof config.settings.vpn !== 'object' || Array.isArray(config.settings.vpn))) throw new Error('vpn must be an object');
  if (vpnProfile !== undefined && vpnProfile !== '' && !isSafeProfileName(vpnProfile)) throw new Error('vpn.surfsharkWireguardProfile is not a valid connection name');
  const remote = config.settings?.remote;
  if (remote !== undefined) {
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) throw new Error('remote must be an object');
    if (remote.host !== undefined && (typeof remote.host !== 'string' || remote.host.trim().startsWith('-') || /[\s\x00-\x1f]/.test(remote.host.trim()))) throw new Error('remote.host is invalid');
    for (const key of ['enabled', 'allowSelfSigned']) {
      if (remote[key] !== undefined && typeof remote[key] !== 'boolean') throw new Error(`remote.${key} must be boolean`);
    }
    for (const key of ['moonlightArgs', 'streamArgs']) {
      if (remote[key] !== undefined && (!Array.isArray(remote[key]) || remote[key].some((value) => typeof value !== 'string' || value.includes('\0')))) throw new Error(`remote.${key} must be an array of strings`);
    }
    if (remote.moonlightPath !== undefined && (typeof remote.moonlightPath !== 'string' || remote.moonlightPath.includes('\0'))) throw new Error('remote.moonlightPath must be a string');
    if (remote.apiUrl !== undefined && typeof remote.apiUrl !== 'string') throw new Error('remote.apiUrl must be a string');
    if (remote.apiUrl?.trim()) {
      const api = new URL(remote.apiUrl.trim());
      if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash) throw new Error('remote.apiUrl must use HTTPS without credentials, query or fragment');
    }
  }
  if (!Array.isArray(config.rows)) throw new Error('rows must be an array');
  config.rows.forEach((row, rowIndex) => {
    if (!row || typeof row !== 'object' || typeof row.title !== 'string') throw new Error(`rows[${rowIndex}].title is required`);
    if (!Array.isArray(row.tiles)) throw new Error(`rows[${rowIndex}].tiles must be an array`);
    row.tiles.forEach((tile, tileIndex) => validateTile(tile, `rows[${rowIndex}].tiles[${tileIndex}]`));
  });
  if (config.websites !== undefined && !Array.isArray(config.websites)) throw new Error('websites must be an array');
  (config.websites || []).forEach((website, index) => {
    if (!website || typeof website.name !== 'string' || !website.name.trim()) throw new Error(`websites[${index}].name is required`);
    if (typeof website.url !== 'string' || !website.url.trim()) throw new Error(`websites[${index}].url is required`);
    let parsed;
    try { parsed = new URL(website.url); } catch { throw new Error(`websites[${index}].url is invalid`); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(`websites[${index}].url must use HTTP or HTTPS`);
  });
  return config;
}

async function loadConfig(configPath, examplePath) {
  try {
    return validateConfig(JSON.parse(await fs.readFile(configPath, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.copyFile(examplePath, configPath);
    return validateConfig(JSON.parse(await fs.readFile(configPath, 'utf8')));
  }
}

async function saveConfig(configPath, config) {
  validateConfig(config);
  const contents = `${JSON.stringify(config, null, 2)}\n`;
  await serialize(configPath, () => atomicWrite(configPath, contents));
  return config;
}

module.exports = { DEFAULT_CONFIG, loadConfig, saveConfig, validateConfig, validateWallpaper, validateWallpaperSources };
