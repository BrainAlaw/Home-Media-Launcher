'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');

/** Cached prefixes/tails are sent first; uncached video regions open the file only on demand. */
function memoryMediaStream(record, file, start, end, signal) {
  let position = start;
  let handle = null;
  let closed = false;
  let controller;
  const close = async () => {
    closed = true;
    signal?.removeEventListener('abort', abort);
    const opened = handle;
    handle = null;
    await opened?.close();
  };
  const abort = () => { void close(); try { controller?.error(new Error('Media request aborted')); } catch { /* Already closed. */ } };
  return new ReadableStream({
    start(value) { controller = value; signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); },
    async pull(output) {
      if (closed) return;
      if (position > end) { await close(); output.close(); return; }
      try {
        const segment = record.segments.find((entry) => position >= entry.start && position < entry.start + entry.buffer.byteLength);
        if (segment) {
          const length = Math.min(128 * 1024, end - position + 1, segment.start + segment.buffer.byteLength - position);
          // A bounded copy creates an ordinary ArrayBuffer accepted by Chromium's response bridge.
          const chunk = new Uint8Array(new Uint8Array(segment.buffer, position - segment.start, length));
          position += length;
          output.enqueue(chunk);
          return;
        }
        if (!handle) {
          const opened = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
          if (closed) { await opened.close(); return; }
          handle = opened;
          const stat = await handle.stat();
          if (stat.size !== record.size || stat.mtimeMs !== record.mtimeMs) throw new Error('Media changed during streaming');
        }
        const next = record.segments.find((entry) => entry.start > position)?.start ?? end + 1;
        const chunk = new Uint8Array(Math.min(128 * 1024, end - position + 1, next - position));
        const result = await handle.read(chunk, 0, chunk.length, position);
        if (closed) return;
        if (!result.bytesRead) throw new Error('Unexpected end of media');
        position += result.bytesRead;
        output.enqueue(chunk.subarray(0, result.bytesRead));
      } catch (error) { await close(); if (!signal?.aborted) output.error(error); }
    },
    cancel: close
  });
}

module.exports = { memoryMediaStream };
