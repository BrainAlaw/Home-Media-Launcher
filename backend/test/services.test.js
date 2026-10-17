'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const { fileURLToPath } = require('node:url');
const { spawnSync } = require('node:child_process');
const { LocalState } = require('../local-state');
const { requestBuffer, requestJson, authorization } = require('../network');
const { HostMonitor } = require('../host-monitor');
const { listRemoteApps, parseApiApps } = require('../../src/main/remote-apps');
const { ProcessManager } = require('../../src/main/process-manager');
const { saveConfig, loadConfig, validateConfig } = require('../../src/main/config');
const { saveCredential, loadCredential, saveToken } = require('../../src/main/secret-store');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRusAAAAASUVORK5CYII=', 'base64');

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepollo-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function server(t, handler) {
  const instance = http.createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(() => { instance.closeAllConnections(); return new Promise((resolve) => instance.close(resolve)); });
  return `http://127.0.0.1:${instance.address().port}`;
}

test('network bounds response size, total duration, status and redirect handling', async (t) => {
  const base = await server(t, (request, response) => {
    if (request.url === '/large') return response.end(Buffer.alloc(1024));
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/ok' }); return response.end(); }
    if (request.url === '/slow') { response.writeHead(200); response.flushHeaders(); return; }
    response.end('ok');
  });
  assert.equal((await requestBuffer(`${base}/ok`)).body.toString(), 'ok');
  await assert.rejects(requestBuffer(`${base}/large`, { maxBytes: 100 }), /size limit/);
  await assert.rejects(requestBuffer(`${base}/redirect`), /HTTP 302/);
  await assert.rejects(requestBuffer(`${base}/slow`, { timeoutMs: 30 }), /timed out|interrupted/);
  await assert.rejects(requestJson(base, 'token'), /HTTPS/);
});

test('icon overrides copy raster bytes locally, persist concurrently and survive source removal', async (t) => {
  const directory = await temporary(t);
  const source = path.join(directory, 'source.png');
  await fs.writeFile(source, png);
  const state = new LocalState(directory);
  await Promise.all(['native', 'website', 'remote:pc:1'].map((id) => state.setIcon(id, source)));
  await fs.unlink(source);
  const icons = await new LocalState(directory).icons();
  assert.deepEqual(Object.keys(icons).sort(), ['native', 'remote:pc:1', 'website']);
  assert.deepEqual(await fs.readFile(fileURLToPath(icons.native)), png);
  await state.setIcon('native', '');
  assert.equal((await state.icons()).native, undefined);
  await assert.rejects(state.setIcon('__proto__', ''), /Invalid/);
});

test('artwork is downloaded once into content-addressed storage and executable content is rejected', async (t) => {
  const directory = await temporary(t);
  const base = await server(t, (request, response) => response.end(request.url === '/icon' ? png : Buffer.from('<script>bad()</script>')));
  const state = new LocalState(directory);
  const icon = await state.setIcon('one', `${base}/icon`);
  assert.ok(icon.startsWith('file:'));
  assert.deepEqual(await fs.readFile(fileURLToPath(icon)), png);
  await assert.rejects(state.setIcon('two', `${base}/bad`), /Artwork must be/);
  assert.equal((await state.icons()).two, undefined);
});

test('remote sync caches icons for offline use, reuses them and rebuilds launch arguments', async (t) => {
  const directory = await temporary(t);
  const cache = path.join(directory, 'nested', 'remote.json');
  let downloads = 0;
  const remote = { enabled: true, host: ' gaming-pc ', apiUrl: 'https://host:47990', moonlightPath: 'moonlight-custom' };
  const options = {
    token: { type: 'basic', username: 'admin', password: 'secret' },
    requestJson: async () => ({ apps: [{ name: 'Game', id: 1, cover: 'https://host:47990/icon' }] }),
    requestBuffer: async (_url, settings) => { downloads++; assert.equal(settings.headers.Authorization, authorization(options.token)); return { body: png }; }
  };
  const online = await listRemoteApps(remote, cache, options);
  assert.equal(online.status, 'online');
  assert.deepEqual(await fs.readFile(fileURLToPath(online.tiles[0].icon)), png);
  await listRemoteApps(remote, cache, options);
  assert.equal(downloads, 1);
  const offline = await listRemoteApps({ ...remote, moonlightPath: 'new-moonlight', streamArgs: ['--display-mode', 'fullscreen'] }, cache, {
    token: options.token, requestJson: async () => { throw new Error('Host request timed out'); }
  });
  assert.equal(offline.status, 'cached');
  assert.equal(offline.host, 'gaming-pc');
  assert.equal(offline.tiles[0].command, 'new-moonlight');
  assert.deepEqual(offline.tiles[0].args, ['stream', 'gaming-pc', 'Game', '--display-mode', 'fullscreen']);
  assert.equal(offline.tiles[0].icon, online.tiles[0].icon);
  assert.ok(!(await fs.readFile(cache, 'utf8')).includes('secret'));
});

test('API sync never leaks credentials or TLS exceptions to third-party artwork', async (t) => {
  const cache = path.join(await temporary(t), 'remote.json');
  const result = await listRemoteApps({ enabled: true, host: 'pc', apiUrl: 'https://pc:47990', allowSelfSigned: true }, cache, {
    token: 'secret', requestJson: async () => [{ name: 'Game', icon: 'https://cdn.example/icon' }],
    requestBuffer: async (_url, options) => { assert.deepEqual(options.headers, {}); assert.equal(options.allowSelfSigned, false); return { body: png }; }
  });
  assert.equal(result.status, 'online');
  assert.ok(result.tiles[0].icon.startsWith('file:'));
});

test('Sunshine server-local covers are resolved through the paired Moonlight client', async (t) => {
  const directory = await temporary(t);
  const cover = path.join(directory, 'moonlight-cover.png');
  await fs.writeFile(cover, png);
  let calls = 0;
  const options = {
    token: 'token', requestJson: async () => ({ apps: [{ name: 'Game', uuid: 'stable', 'image-path': 'C:\\Host\\cover.png' }] }),
    run: async () => { calls++; return { stdout: `Name, ID, HDR Support, App Collection Game, Hidden, Direct Launch, Boxart URL\nGame,1,false,false,false,true,"${require('node:url').pathToFileURL(cover).href}"\n` }; }
  };
  const remote = { enabled: true, host: 'pc', apiUrl: 'https://pc' };
  const first = await listRemoteApps(remote, path.join(directory, 'cache.json'), options);
  assert.equal(first.status, 'online');
  assert.deepEqual(await fs.readFile(fileURLToPath(first.tiles[0].icon)), png);
  await listRemoteApps(remote, path.join(directory, 'cache.json'), options);
  assert.equal(calls, 1);
});

test('cached startup performs no network or process invocation; changed hosts never reuse a snapshot', async (t) => {
  const cache = path.join(await temporary(t), 'remote.json');
  await fs.writeFile(cache, JSON.stringify({ host: 'pc', tiles: [{ id: 'remote:pc:1', name: 'Game', icon: '', command: 'untrusted', args: ['bad'] }] }));
  const options = { cacheOnly: true, run: () => { assert.fail('must not spawn'); } };
  const cached = await listRemoteApps({ enabled: true, host: 'pc', moonlightPath: 'safe' }, cache, options);
  assert.equal(cached.tiles[0].command, 'safe');
  const other = await listRemoteApps({ enabled: true, host: 'other' }, cache, options);
  assert.equal(other.status, 'offline');
  assert.deepEqual(other.tiles, []);
});

test('both platforms use paired Moonlight CLI without API credentials', async (t) => {
  for (const platform of ['linux', 'win32']) {
    const cache = path.join(await temporary(t), 'cache.json');
    const result = await listRemoteApps({ enabled: true, host: 'pc', moonlightPath: 'custom', moonlightArgs: ['prefix'] }, cache, {
      platform, run: async (command, args, settings) => {
        assert.equal(command, 'custom');
        assert.deepEqual(args, ['prefix', 'list', 'pc', '--csv']);
        assert.ok(settings.timeout <= 10000);
        return { stdout: 'Name, ID, HDR Support, App Collection Game, Hidden, Direct Launch, Boxart URL\nGame,1,false,false,false,true,""\n' };
      }
    });
    assert.equal(result.status, 'online');
    assert.deepEqual(result.tiles[0].args, ['prefix', 'stream', 'pc', 'Game']);
  }
});

test('malformed API payload does not replace good cache and concurrent refreshes coalesce', async (t) => {
  const cache = path.join(await temporary(t), 'cache.json');
  const remote = { enabled: true, host: 'pc', apiUrl: 'https://pc' };
  let calls = 0;
  const options = { token: 'token', requestJson: async () => { calls++; return { apps: [{ name: 'Game', id: 1 }] }; }, run: async () => { throw new Error('Not paired'); } };
  await Promise.all([listRemoteApps(remote, cache, options), listRemoteApps(remote, cache, options)]);
  assert.equal(calls, 1);
  const before = await fs.readFile(cache, 'utf8');
  const failed = await listRemoteApps(remote, cache, { token: 'token', requestJson: async () => ({ unexpected: true }) });
  assert.equal(failed.status, 'cached');
  assert.equal(await fs.readFile(cache, 'utf8'), before);
  assert.throws(() => parseApiApps(null, remote), /unsupported/);
});

test('disk write failure preserves online status and returned applications', async (t) => {
  const directory = await temporary(t);
  const blocker = path.join(directory, 'not-a-directory');
  await fs.writeFile(blocker, 'block');
  const result = await listRemoteApps({ enabled: true, host: 'pc', apiUrl: 'https://pc' }, path.join(blocker, 'cache.json'), {
    token: 'token', requestJson: async () => [{ name: 'Game' }], run: async () => { throw new Error('Not paired'); }
  });
  assert.equal(result.status, 'online');
  assert.equal(result.tiles.length, 1);
  assert.match(result.warning, /could not be saved/);
});

test('config writes remain valid during concurrent saves and remote options are validated', async (t) => {
  const file = path.join(await temporary(t), 'config.json');
  await Promise.all(Array.from({ length: 10 }, (_, title) => saveConfig(file, { settings: { title }, rows: [] })));
  assert.equal((await loadConfig(file)).settings.title, 9);
  for (const remote of [{ host: '--bad' }, { apiUrl: 'http://pc' }, { streamArgs: [1] }, { moonlightPath: 42 }]) {
    assert.throws(() => validateConfig({ settings: { remote }, rows: [] }));
  }
});

test('Sunshine credentials use encrypted storage and insecure Linux fallback is rejected', async (t) => {
  const file = path.join(await temporary(t), 'token.json');
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value).reverse(), decryptString: (value) => Buffer.from(value).reverse().toString() };
  const credential = { type: 'basic', username: 'admin', password: 'test-password' };
  await saveCredential(file, credential, safeStorage);
  assert.deepEqual(await loadCredential(file, safeStorage), credential);
  assert.ok(!(await fs.readFile(file, 'utf8')).includes('test-password'));
  assert.equal(authorization(credential), 'Basic YWRtaW46dGVzdC1wYXNzd29yZA==');
  await assert.rejects(saveToken(file, 'secret', { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' }), /unavailable/);
  await saveCredential(file, null, safeStorage);
  assert.equal(await loadCredential(file, safeStorage), '');
});

test('browser launch preserves URL as one argument and restores state on spawn failure', async () => {
  const child = new EventEmitter();
  let invocation;
  const manager = new ProcessManager((...args) => { invocation = args; return child; });
  const finished = once(manager, 'finished');
  manager.launch({ id: 'browser', type: 'browser', browserEngine: 'chromium', command: 'browser', args: ['--profile', 'TV Room'], url: 'https://example.com/?q=a&x=b' });
  assert.deepEqual(invocation[1], ['--profile', 'TV Room', '--kiosk', 'https://example.com/?q=a&x=b']);
  assert.equal(invocation[2].shell, false);
  assert.equal(invocation[2].env.ELECTRON_RUN_AS_NODE, undefined);
  child.emit('error', new Error('ENOENT'));
  assert.equal((await finished)[0].error, 'ENOENT');
  assert.equal(manager.active, null);
  assert.throws(() => manager.launch({ command: 'browser', type: 'browser', browserEngine: 'chromium', url: 'file:///secret' }), /HTTP/);
});

test('native process execution passes literal argv and captures a real nonzero exit', async () => {
  const manager = new ProcessManager();
  const finished = once(manager, 'finished');
  manager.launch({ id: 'node', command: process.execPath, args: ['-e', 'process.exit(process.argv[1] === "literal & argument" ? 7 : 8)', 'literal & argument'] });
  assert.equal((await finished)[0].code, 7);
  assert.equal(manager.active, null);
});

test('host monitoring coalesces overlapping polls and emits recoverable failure', async () => {
  let resolve;
  let calls = 0;
  const monitor = new HostMonitor(() => { calls++; return new Promise((done) => { resolve = done; }); }, 10);
  const first = monitor.poll();
  const second = monitor.poll();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ status: 'online' });
  assert.deepEqual(await first, { status: 'online' });
  await second;
  monitor.refresh = async () => { throw new Error('temporary'); };
  const failure = once(monitor, 'failure');
  await monitor.poll();
  assert.equal((await failure)[0].message, 'temporary');
  monitor.start();
  monitor.stop();
  assert.equal(monitor.running, false);
});

test('Windows bootstrap parses without executing installation', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', "$tokens = $null; $parseErrors = $null; [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/bootstrap.ps1'), [ref]$tokens, [ref]$parseErrors) > $null; if ($parseErrors.Count) { $parseErrors | Out-String | Write-Error; exit 1 }"], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('Linux bootstrap installs missing Moonlight and is repeatable using mocked system commands', async (t) => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
  try { await fs.access(bash); } catch { t.skip('Bash is unavailable'); return; }
  const directory = await temporary(t);
  const bin = path.join(directory, 'bin');
  await fs.mkdir(bin);
  const commands = {
    uname: 'echo Linux',
    node: 'exit 0',
    npm: 'echo "npm $*" >> "$MOCK_LOG"',
    flatpak: 'echo "flatpak $*" >> "$MOCK_LOG"\nif [[ "$1" == info ]]; then [[ -f "$MOCK_INSTALLED" ]]; elif [[ "$1" == install ]]; then touch "$MOCK_INSTALLED"; fi'
  };
  for (const [name, body] of Object.entries(commands)) await fs.writeFile(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  const script = `
    set -e
    mock_root="$1"
    if command -v cygpath >/dev/null 2>&1; then mock_root="$(cygpath -u "$mock_root")"; fi
    export PATH="$mock_root/bin:$PATH"
    export MOCK_LOG="$mock_root/log" MOCK_INSTALLED="$mock_root/installed"
    bash scripts/bootstrap.sh
    bash scripts/bootstrap.sh
  `;
  const result = spawnSync(bash, ['-c', script, 'bootstrap-test', directory], { encoding: 'utf8' });
  if (process.getuid?.() === 0) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /desktop user/);
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  const log = await fs.readFile(path.join(directory, 'log'), 'utf8');
  assert.equal((log.match(/flatpak install/g) || []).length, 1);
  assert.equal((log.match(/npm ci/g) || []).length, 2);
});

test('Windows bootstrap installs missing dependencies through mocked winget and checks exit codes', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await temporary(t);
  const harness = path.join(directory, 'harness.ps1');
  await fs.writeFile(harness, `
$ErrorActionPreference = 'Stop'
$global:NodeReady = $false
$global:MoonlightReady = $false
$global:InstallLog = [System.Collections.Generic.List[string]]::new()
function global:Get-Command {
    [CmdletBinding()]
    param([string]$Name)
    if ($Name -in @('node.exe', 'npm.cmd')) { if ($global:NodeReady) { return [PSCustomObject]@{ Source = $Name } }; return }
    if ($Name -eq 'Moonlight.exe') { if ($global:MoonlightReady) { return [PSCustomObject]@{ Source = 'mock-moonlight.exe' } }; return }
    Microsoft.PowerShell.Core\\Get-Command @PSBoundParameters
}
function global:winget.exe {
    $global:InstallLog.Add(($args -join ' '))
    if ($args -contains 'OpenJS.NodeJS.LTS') { $global:NodeReady = $true }
    if ($args -contains 'MoonlightGameStreamingProject.Moonlight') { $global:MoonlightReady = $true }
    $global:LASTEXITCODE = 0
}
function global:node.exe { $global:LASTEXITCODE = 0 }
function global:npm.cmd { $global:InstallLog.Add(('npm ' + ($args -join ' '))); $global:LASTEXITCODE = 0 }
$env:ProgramFiles = $PSScriptRoot
[Environment]::SetEnvironmentVariable('ProgramFiles(x86)', $PSScriptRoot)
$env:LOCALAPPDATA = $PSScriptRoot
$scriptPath = Join-Path (Get-Location) 'scripts/bootstrap.ps1'
$first = & $scriptPath
$second = & $scriptPath
if (-not $first.Success -or -not $second.Success) { throw 'Bootstrap did not return success' }
if (@($global:InstallLog | Where-Object { $_ -like '*OpenJS.NodeJS.LTS*' }).Count -ne 1) { throw 'Node install was not idempotent' }
if (@($global:InstallLog | Where-Object { $_ -like '*MoonlightGameStreamingProject.Moonlight*' }).Count -ne 1) { throw 'Moonlight install was not idempotent' }
function global:npm.cmd { $global:LASTEXITCODE = 9 }
$failed = $false
try { & $scriptPath > $null } catch { $failed = $_.Exception.Message -like '*npm ci failed*' }
if (-not $failed) { throw 'npm failure was not propagated' }
`);
  const result = spawnSync('pwsh', ['-NoProfile', '-File', harness], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
