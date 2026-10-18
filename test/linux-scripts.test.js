#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const scripts = [
  'scripts/bootstrap.sh',
  'scripts/linux/install-autostart.sh',
  'scripts/linux/setup-permissions.sh',
  'scripts/linux/check-soloist.sh',
];
const bashAvailable = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;

test('Linux scripts pass bash syntax and dry-run checks', (t) => {
  if (!bashAvailable) {
    t.skip('bash is not installed');
    return;
  }
  for (const script of scripts) {
    const syntax = spawnSync('bash', ['-n', path.join(root, script)], { encoding: 'utf8' });
    if (syntax.status !== 0) {
      t.fail(`${script} failed bash -n: ${syntax.stderr || syntax.error}`);
      continue;
    }
    if (script === 'scripts/bootstrap.sh') continue;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hml-linux-script-'));
    try {
      const args = script.endsWith('install-autostart.sh')
        ? ['--dry-run']
        : script.endsWith('setup-permissions.sh')
          ? ['--dry-run', '--networkmanager']
          : ['--dry-run'];
      const result = spawnSync('bash', [path.join(root, script), ...args], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
      });
      if (result.status !== 0) t.fail(`${script} --dry-run failed: ${result.stderr || result.error}`);
      else t.pass(`${script} --dry-run succeeded`);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});
