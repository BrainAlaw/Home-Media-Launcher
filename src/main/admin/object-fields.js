'use strict';

const { MIN_MAX, MAX_MAX } = require('../background-apps');

// Mirror private limits in backend/soloist/settings.js.
const DEVICE_NAME_MAX = 64;
const BINARY_PATH_MAX = 512;
const field = (key, label, type, help, extra = {}) => ({ key, label, type, help, ...extra });

const OBJECT_FIELDS = {
  soloist: [
    field('enabled', 'Enabled', 'boolean', 'Enable the Spotify Connect device.'),
    field('deviceName', 'Device name', 'text', 'Name shown to Spotify Connect.', { maxLength: DEVICE_NAME_MAX }),
    field('binaryPath', 'Binary path', 'text', 'Path to the Soloist executable.', { maxLength: BINARY_PATH_MAX })
  ],
  backgroundApps: [
    field('max', 'Maximum apps', 'number', 'Maximum apps kept running in the background.', { min: MIN_MAX, max: MAX_MAX })
  ],
  homeHeader: [
    field('layout', 'Layout', 'enum', 'Choose the home header layout.', { options: ['split', 'centred'] }),
    field('showSeconds', 'Show seconds', 'boolean', 'Show seconds in the clock.'),
    field('oledProtection', 'OLED protection', 'boolean', 'Enable OLED panel protection.'),
    field('fadeIn', 'Fade in', 'boolean', 'Fade in the home header.')
  ],
  remote: [
    field('enabled', 'Enabled', 'boolean', 'Enable remote host integration.'),
    field('allowSelfSigned', 'Allow self-signed certificates', 'boolean', 'Allow self-signed host certificates.'),
    field('host', 'Host', 'text', 'Remote host name or address.'),
    field('apiUrl', 'API URL', 'text', 'HTTPS URL for the remote API.'),
    field('moonlightPath', 'Moonlight path', 'text', 'Path to the Moonlight executable.'),
    field('moonlightArgs', 'Moonlight arguments', 'list', 'Additional Moonlight arguments.'),
    field('streamArgs', 'Stream arguments', 'list', 'Arguments passed when starting a stream.')
  ],
  vpn: [
    field('surfsharkProfile', 'Surfshark profile', 'text', 'Network profile used for Surfshark.'),
    field('surfsharkWireguardProfile', 'WireGuard profile', 'text', 'Legacy Surfshark WireGuard profile.'),
    field('surfsharkMode', 'Surfshark mode', 'enum', 'Choose how to connect to Surfshark.', {
      options: ['auto', 'wireguard-service', 'openvpn-gui', 'rasdial', 'nmcli']
    })
  ],
  wallpaper: [
    field('shuffle', 'Shuffle', 'boolean', 'Shuffle wallpaper selection.'),
    field('online', 'Online sources', 'boolean', 'Allow online wallpaper sources.'),
    field('source', 'Source', 'enum', 'Choose where wallpapers come from.', {
      options: ['bundled', 'folder', 'online', 'mixed']
    })
  ]
};

function validateFieldValue(spec, value) {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : `${spec.key} must be a boolean.`;
    case 'text':
      if (typeof value !== 'string') return `${spec.key} must be text.`;
      if (spec.maxLength !== undefined && value.length > spec.maxLength) return `${spec.key} must be at most ${spec.maxLength} characters.`;
      if (/[\x00-\x1f]/.test(value)) return `${spec.key} must not contain control characters.`;
      return null;
    case 'enum':
      return spec.options.includes(value) ? null : `${spec.key} must be one of the listed options.`;
    case 'number':
      return Number.isInteger(value) && value >= spec.min && value <= spec.max
        ? null
        : `${spec.key} must be an integer from ${spec.min} to ${spec.max}.`;
    case 'list':
      return Array.isArray(value) && value.every((item) => typeof item === 'string' && !item.includes('\0'))
        ? null
        : `${spec.key} must be a list of strings without null characters.`;
    default:
      throw new TypeError(`Unknown field type: ${spec.type}`);
  }
}

module.exports = { OBJECT_FIELDS, validateFieldValue };
