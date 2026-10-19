'use strict';

const ACTIONS = Object.freeze([
  Object.freeze({
    name: 'reload-config',
    label: 'Reload config',
    group: 'Configuration',
    destructive: false,
    help: 'Re-reads config.json and rebuilds the launcher model.'
  }),
  Object.freeze({
    name: 'restart-soloist',
    label: 'Restart Soloist',
    group: 'Services',
    destructive: false,
    help: 'Restarts the Soloist supervisor.'
  }),
  Object.freeze({
    name: 'clear-cache',
    label: 'Clear caches',
    group: 'Maintenance',
    destructive: false,
    help: 'Clears the icon and artwork caches and the weather cache. Config, .env and token files are kept.'
  }),
  Object.freeze({
    name: 'pair-tv',
    label: 'Show pairing card on TV',
    group: 'Devices',
    destructive: false,
    help: 'Shows the admin pairing card on the TV again, the same as the TV button.'
  }),
  Object.freeze({
    name: 'restart-launcher',
    label: 'Restart launcher',
    group: 'Maintenance',
    destructive: true,
    help: 'Restarts the whole launcher process. Requires a confirmation token.'
  })
]);

const ACTION_BY_NAME = new Map(ACTIONS.map((action) => [action.name, action]));

/**
 * Looks up an admin action by its route name.
 * @param {string} name
 * @returns {{ name: string, label: string, group: string, destructive: boolean, help: string } | null}
 */
function findAction(name) {
  if (typeof name !== 'string') return null;
  return ACTION_BY_NAME.get(name) ?? null;
}

module.exports = { ACTIONS, findAction };
