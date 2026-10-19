'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runUploadTest, SPEED_DURATION_MS, UPLOAD_DURATION_MS } = require('../backend/net-probe');

test('upload test reports a positive average for bytes sent before its deadline', async () => {
  let bytesReceived = 0;
  let clock = 0;
  const result = await runUploadTest({
    durationMs: 30,
    fetch: async (_url, options) => {
      bytesReceived += options.body.byteLength;
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { ok: true, status: 200, body: null };
    },
    now: () => { clock += 250; return clock; }
  });

  assert.equal(result.state, 'done');
  assert.ok(bytesReceived > 0);
  assert.ok(result.averageMbps > 0);
});

test('upload test resolves as cancelled when its signal aborts', async () => {
  const controller = new AbortController();
  let bytesReceived = 0;
  const resultPromise = runUploadTest({
    durationMs: 10_000,
    signal: controller.signal,
    fetch: async (_url, options) => {
      bytesReceived += options.body.byteLength;
      controller.abort();
      return { ok: true, status: 200, body: null };
    }
  });

  const result = await resultPromise;
  assert.equal(result.state, 'cancelled');
  assert.ok(bytesReceived > 0);
});

test('upload test reports an error when fetch fails before sending bytes', async () => {
  const result = await runUploadTest({ fetch: async () => { throw new Error('network unavailable'); } });
  assert.equal(result.state, 'error');
  assert.match(result.error, /network unavailable/);
  assert.equal(result.averageMbps, 0);
});

test('download and upload durations are ten seconds', () => {
  assert.equal(SPEED_DURATION_MS, 10_000);
  assert.equal(UPLOAD_DURATION_MS, 10_000);
});
