'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SoloistClient, reconnectDelayMs, assertLoopbackUrl } = require('../backend/soloist/ws-client');

const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'soloist', 'wire-session.json'), 'utf8'));
const URL_LOOPBACK = 'ws://127.0.0.1:8765';
const T0 = 1_760_000_000_000;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function hydrate(value) {
  const entities = { TRACK_A: FIXTURES.trackA, TRACK_B: FIXTURES.trackB, TRACK_C: FIXTURES.trackC, CONTEXT: FIXTURES.context };
  if (typeof value === 'string' && Object.hasOwn(entities, value)) return entities[value];
  if (Array.isArray(value)) return value.map(hydrate);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrate(item)]));
  return value;
}
const frame = (index) => hydrate(FIXTURES.frames[index]);

/** Manually driven clock: timers fire only when advance() moves time past their due instant. */
function createClock(start = T0) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (due === null || timer.at < due.timer.at || (timer.at === due.timer.at && id < due.id))) due = { id, timer };
        }
        if (due === null) break;
        now = due.timer.at;
        timers.delete(due.id);
        due.timer.fn();
      }
      now = target;
    },
    get pending() {
      return timers.size;
    }
  };
}

/** Fake WebSocket: records sockets, lets the test open, deliver frames and drop the connection. */
function createFakeSocketClass(options = {}) {
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      if (options.failConstruction) throw new Error('boom');
      this.url = url;
      this.sent = [];
      this.closed = false;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      sockets.push(this);
    }

    send(data) {
      if (options.failSend) throw new Error('send failed');
      this.sent.push(JSON.parse(data));
    }

    close() {
      this.closed = true;
    }

    open() {
      this.onopen?.({});
    }

    receive(message) {
      this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
    }

    drop() {
      this.onclose?.({});
    }
  }
  return { FakeWebSocket, sockets };
}

function setup(options = {}) {
  const clock = createClock();
  const { FakeWebSocket, sockets } = createFakeSocketClass(options);
  const logs = [];
  const client = new SoloistClient({ WebSocketImpl: FakeWebSocket, clock, logger: (line) => logs.push(line), ...options.client });
  return { clock, client, sockets, logs };
}

function openConnected(options) {
  const env = setup(options);
  env.client.connect(URL_LOOPBACK);
  env.sockets[0].open();
  return env;
}

/* ------------------------------------------------------------------ URL and backoff */

test('refuses non-loopback and malformed URLs without opening a socket', () => {
  const refused = [
    'ws://localhost:8765',
    'ws://example.com:8765',
    'ws://127.0.0.1.nip.io:8765',
    'ws://0.0.0.0:8765',
    'ws://[::1]:8765',
    'wss://127.0.0.1:8765',
    'http://127.0.0.1:8765',
    'ws://user:pass@127.0.0.1:8765',
    'not a url',
    ''
  ];
  for (const url of refused) {
    const { client, sockets } = setup();
    assert.throws(() => client.connect(url), TypeError, url);
    assert.equal(sockets.length, 0, url);
  }
  assert.equal(assertLoopbackUrl(URL_LOOPBACK), URL_LOOPBACK);
});

test('construction requires a WebSocket constructor', () => {
  assert.throws(() => new SoloistClient({ WebSocketImpl: null }), TypeError);
});

test('reconnect delay doubles from 1 s and is capped at 30 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(reconnectDelayMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('reconnect schedule follows 1, 2, 4, 8, 16, 30, 30 s after repeated failed connections', () => {
  const { clock, client, sockets } = setup();
  client.connect(URL_LOOPBACK);
  sockets[0].drop();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const before = sockets.length;
    clock.advance(delay - 1);
    assert.equal(sockets.length, before, `no reconnect before ${delay} ms`);
    clock.advance(1);
    assert.equal(sockets.length, before + 1, `reconnect at ${delay} ms`);
    sockets[sockets.length - 1].drop();
  }
  client.dispose();
});

test('a successful open resets the backoff to 1 s', () => {
  const { clock, client, sockets } = setup();
  client.connect(URL_LOOPBACK);
  sockets[0].drop();
  clock.advance(1000);
  sockets[1].drop();
  clock.advance(2000);
  sockets[2].open();
  sockets[2].drop();
  const before = sockets.length;
  clock.advance(999);
  assert.equal(sockets.length, before);
  clock.advance(1);
  assert.equal(sockets.length, before + 1);
  client.dispose();
});

test('a socket that cannot be constructed schedules a reconnect', () => {
  const { clock, client, sockets } = setup({ failConstruction: true });
  client.connect(URL_LOOPBACK);
  assert.equal(sockets.length, 0);
  assert.equal(clock.pending, 1);
  client.dispose();
  assert.equal(clock.pending, 0);
});

/* ------------------------------------------------------------------ connection state and DISCONNECTED */

test('commands reject with DISCONNECTED until the socket opens, and again after it drops', async () => {
  const { client, sockets } = setup();
  assert.deepEqual(await client.send('pause'), { ok: false, code: 'DISCONNECTED', command: 'pause' });
  client.connect(URL_LOOPBACK);
  assert.deepEqual(await client.send('pause'), { ok: false, code: 'DISCONNECTED', command: 'pause' }, 'connecting is not connected');
  sockets[0].open();
  assert.equal(client.getSnapshot().connected, true);
  assert.equal(sockets[0].sent.length, 0, 'nothing is sent on connect; the client waits for auth_state and playback_state');
  const pending = client.send('pause');
  sockets[0].drop();
  assert.deepEqual(await pending, { ok: false, code: 'DISCONNECTED', command: 'pause' });
  assert.deepEqual(await client.send('pause'), { ok: false, code: 'DISCONNECTED', command: 'pause' });
  assert.equal(client.getSnapshot().connected, false);
  client.dispose();
});

test('invalid commands resolve INVALID without sending anything', async () => {
  const { client, sockets } = openConnected();
  const result = await client.send('set_volume', { volume: 101 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID');
  assert.match(result.error, /volume/);
  assert.equal((await client.send('nonsense')).code, 'INVALID');
  assert.equal(sockets[0].sent.length, 0);
  client.dispose();
});

test('a failing socket.send resolves SEND_FAILED', async () => {
  const { client } = openConnected({ failSend: true });
  assert.deepEqual(await client.send('pause'), { ok: false, code: 'SEND_FAILED', command: 'pause' });
  assert.equal(client.pending.length, 0);
  client.dispose();
});

/* ------------------------------------------------------------------ correlation */

test('control commands resolve on command_result matched by name, FIFO within a name', async () => {
  const { client, sockets } = openConnected();
  const first = client.send('pause');
  const second = client.send('pause');
  const third = client.send('skip_next');
  assert.deepEqual(sockets[0].sent, [
    { type: 'command', command: 'pause' },
    { type: 'command', command: 'pause' },
    { type: 'command', command: 'skip_next' }
  ]);

  let secondDone = false;
  second.then(() => {
    secondDone = true;
  });
  sockets[0].receive({ type: 'command_result', command: 'skip_next' });
  assert.deepEqual(await third, { ok: true, command: 'skip_next' });
  sockets[0].receive({ type: 'command_result', command: 'pause' });
  assert.deepEqual(await first, { ok: true, command: 'pause' });
  await flush();
  assert.equal(secondDone, false, 'second pause waits for its own command_result');
  sockets[0].receive({ type: 'command_result', command: 'pause' });
  assert.deepEqual(await second, { ok: true, command: 'pause' });
  client.dispose();
});

test('an error event rejects the oldest pending command and leaves the others pending', async () => {
  const { client, sockets } = openConnected();
  const first = client.send('pause');
  const second = client.send('skip_next');
  sockets[0].receive({ type: 'error', message: 'Command rejected' });
  assert.deepEqual(await first, { ok: false, code: 'SERVER_ERROR', error: 'Command rejected', command: 'pause' });
  sockets[0].receive({ type: 'command_result', command: 'skip_next' });
  assert.deepEqual(await second, { ok: true, command: 'skip_next' });
  client.dispose();
});

test('a malformed frame neither resolves nor rejects pending commands', async () => {
  const { client, sockets } = openConnected();
  const pending = client.send('pause');
  const events = [];
  client.on('event', (event) => events.push(event));
  sockets[0].receive('{broken');
  assert.equal(events.length, 1);
  assert.equal(events[0].malformed, true);
  sockets[0].receive({ type: 'command_result', command: 'pause' });
  assert.deepEqual(await pending, { ok: true, command: 'pause' });
  client.dispose();
});

test('a command without a result times out after 5 s and a late result is ignored', async () => {
  const { clock, client, sockets } = openConnected();
  const timed = client.send('pause');
  clock.advance(4999);
  let settled = false;
  timed.then(() => {
    settled = true;
  });
  const next = client.send('pause');
  await flush();
  assert.equal(settled, false);
  clock.advance(1);
  assert.deepEqual(await timed, { ok: false, code: 'TIMEOUT', command: 'pause' });
  assert.equal(client.pending.length, 1);
  sockets[0].receive({ type: 'command_result', command: 'pause' });
  assert.deepEqual(await next, { ok: true, command: 'pause' }, 'the late result belongs to the next pending command');
  client.dispose();
});

test('timeouts honour the configured commandTimeoutMs', async () => {
  const { clock, client } = openConnected({ client: { commandTimeoutMs: 250 } });
  const timed = client.send('pause');
  clock.advance(250);
  assert.equal((await timed).code, 'TIMEOUT');
  client.dispose();
});

test('query commands resolve on their reply event and carry it', async () => {
  const { client, sockets } = openConnected();
  const state = client.send('get_state');
  const auth = client.send('get_auth_state');
  const queue = client.send('get_queue', { limit: 3 });
  assert.deepEqual(sockets[0].sent.slice(0, 2), [{ type: 'command', command: 'get_state' }, { type: 'command', command: 'get_auth_state' }]);
  assert.deepEqual(sockets[0].sent[2], { type: 'command', command: 'get_queue', limit: 3 });

  sockets[0].receive(frame(1));
  const stateResult = await state;
  assert.equal(stateResult.ok, true);
  assert.equal(stateResult.command, 'get_state');
  assert.equal(stateResult.event.type, 'playback_state');

  sockets[0].receive(frame(0));
  assert.equal((await auth).event.type, 'auth_state');

  sockets[0].receive({ type: 'queue_changed', previous: [], upcoming: [] });
  assert.equal((await queue).event.type, 'queue_changed');
  client.dispose();
});

test('get_state times out when no playback_state arrives', async () => {
  const { clock, client } = openConnected();
  const pending = client.send('get_state');
  clock.advance(5000);
  assert.deepEqual(await pending, { ok: false, code: 'TIMEOUT', command: 'get_state' });
  client.dispose();
});

/* ------------------------------------------------------------------ repeat */

test('repeat sends the two-command sequence in order and resolves once both are accepted', async () => {
  const { client, sockets } = openConnected();
  const pending = client.repeat('context');
  await flush();
  assert.deepEqual(sockets[0].sent, [{ type: 'command', command: 'set_repeat_track', enabled: false }]);
  sockets[0].receive({ type: 'command_result', command: 'set_repeat_track' });
  await flush();
  assert.deepEqual(sockets[0].sent[1], { type: 'command', command: 'set_repeat_context', enabled: true });
  sockets[0].receive({ type: 'command_result', command: 'set_repeat_context' });
  assert.deepEqual(await pending, { ok: true, command: 'repeat' });
  client.dispose();
});

test('repeat track and off use the documented commands', async () => {
  const { client, sockets } = openConnected();
  const track = client.repeat('track');
  await flush();
  assert.deepEqual(sockets[0].sent[0], { type: 'command', command: 'set_repeat_context', enabled: false });
  sockets[0].receive({ type: 'command_result', command: 'set_repeat_context' });
  await flush();
  assert.deepEqual(sockets[0].sent[1], { type: 'command', command: 'set_repeat_track', enabled: true });
  sockets[0].receive({ type: 'command_result', command: 'set_repeat_track' });
  assert.equal((await track).ok, true);

  const off = client.repeat('off');
  await flush();
  assert.deepEqual(sockets[0].sent[2], { type: 'command', command: 'set_repeat_track', enabled: false });
  sockets[0].receive({ type: 'command_result', command: 'set_repeat_track' });
  await flush();
  assert.deepEqual(sockets[0].sent[3], { type: 'command', command: 'set_repeat_context', enabled: false });
  sockets[0].receive({ type: 'command_result', command: 'set_repeat_context' });
  assert.equal((await off).ok, true);
  client.dispose();
});

test('repeat stops at the first failing step and does not send the second', async () => {
  const { client, sockets } = openConnected();
  const pending = client.repeat('track');
  await flush();
  sockets[0].receive({ type: 'error', message: 'Premium required' });
  assert.deepEqual(await pending, { ok: false, code: 'SERVER_ERROR', error: 'Premium required', command: 'set_repeat_context' });
  await flush();
  assert.equal(sockets[0].sent.length, 1);
  client.dispose();
});

test('repeat rejects unknown modes', async () => {
  const { client, sockets } = openConnected();
  assert.equal((await client.repeat('overall')).code, 'INVALID');
  assert.equal(sockets[0].sent.length, 0);
  client.dispose();
});

/* ------------------------------------------------------------------ state and events */

test('emits state on change only, with a MediaState-compatible payload', () => {
  const { client, sockets } = openConnected();
  const states = [];
  const events = [];
  client.on('state', (media) => states.push(media));
  client.on('event', (event) => events.push(event.type));

  sockets[0].receive(frame(0));
  assert.equal(states.length, 1);
  assert.deepEqual(states[0].auth, { status: 'signed-in', displayName: 'Soloist' });
  assert.equal(states[0].device.name, 'Living Room PC');

  sockets[0].receive(frame(0));
  assert.equal(states.length, 1, 'an identical auth_state does not re-emit');

  sockets[0].receive(frame(1));
  assert.equal(states.at(-1).playing, true);
  assert.equal(states.at(-1).track.title, 'Song A');

  sockets[0].receive({ type: 'command_result', command: 'pause' });
  assert.equal(states.length, 2, 'command_result does not change MediaState');
  assert.deepEqual(events, ['auth_state', 'auth_state', 'playback_state', 'command_result'], 'both recorded auth_state frames are forwarded');
  client.dispose();
});

test('getMediaState interpolates progress at the injected clock time', () => {
  const { clock, client, sockets } = openConnected();
  sockets[0].receive(frame(0));
  sockets[0].receive(frame(1));
  clock.advance(2000);
  assert.equal(client.getMediaState().progressMs, 32000);
  assert.equal(client.getMediaState().updatedAt, T0 + 2000);
  client.dispose();
});

test('a drop emits a disconnected state and reconnect restores playback from the server', () => {
  const { clock, client, sockets } = openConnected();
  const states = [];
  client.on('state', (media) => states.push(media));
  sockets[0].receive(frame(0));
  sockets[0].receive(frame(1));
  sockets[0].drop();
  assert.equal(states.at(-1).playing, false);
  assert.equal(states.at(-1).stale, true);
  clock.advance(1000);
  sockets[1].open();
  sockets[1].receive(frame(0));
  sockets[1].receive(frame(1));
  assert.equal(states.at(-1).playing, true);
  assert.equal('stale' in states.at(-1), false);
  client.dispose();
});

test('logs lifecycle transitions only and never message bodies', () => {
  const { client, sockets, logs } = openConnected();
  sockets[0].receive({ type: 'error', message: 'SECRET-MARKER-123' });
  sockets[0].receive('{"type":"auth_state","logged_in":true,"is_active":true,"device_name":"SECRET-MARKER-456"}');
  sockets[0].drop();
  client.dispose();
  assert.ok(logs.length > 0);
  assert.ok(logs.every((line) => typeof line === 'string' && line.startsWith('soloist: ')));
  assert.equal(logs.some((line) => line.includes('SECRET-MARKER')), false);
});

test('frames from a replaced socket are ignored', () => {
  const { client, sockets } = openConnected();
  client.connect('ws://127.0.0.1:9000');
  assert.equal(sockets[0].closed, true);
  sockets[0].receive(frame(0));
  sockets[0].drop();
  assert.equal(client.getSnapshot().loggedIn, false);
  assert.equal(client.getSnapshot().connected, false, 'the new socket has not opened yet');
  sockets[1].open();
  assert.equal(client.getSnapshot().connected, true);
  client.dispose();
});

/* ------------------------------------------------------------------ dispose */

test('dispose closes the socket, fails pending commands and stops reconnecting', async () => {
  const { clock, client, sockets } = openConnected();
  const pending = client.send('pause');
  client.dispose();
  assert.equal(sockets[0].closed, true);
  assert.deepEqual(await pending, { ok: false, code: 'DISCONNECTED', command: 'pause' });
  assert.equal(clock.pending, 0);
  clock.advance(120_000);
  assert.equal(sockets.length, 1, 'no reconnect after dispose');
  assert.deepEqual(await client.send('pause'), { ok: false, code: 'DISCONNECTED', command: 'pause' });
  assert.throws(() => client.connect(URL_LOOPBACK), /disposed/);
  assert.doesNotThrow(() => client.dispose());
});

test('dispose while waiting to reconnect cancels the timer', () => {
  const { clock, client, sockets } = setup();
  client.connect(URL_LOOPBACK);
  sockets[0].drop();
  assert.equal(clock.pending, 1);
  client.dispose();
  assert.equal(clock.pending, 0);
  clock.advance(60_000);
  assert.equal(sockets.length, 1);
});
