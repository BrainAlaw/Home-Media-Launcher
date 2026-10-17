'use strict';

const http = require('node:http');
const https = require('node:https');

/** Bound the entire response, including slow or stalled bodies. Redirects are rejected. */
function requestBuffer(url, { headers = {}, allowSelfSigned = false, timeoutMs = 8000, maxBytes = 2097152, lookup } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      reject(new Error('Expected an HTTP(S) URL without embedded credentials'));
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request(parsed, { headers, rejectUnauthorized: !allowSelfSigned, agent: false, ...(lookup ? { lookup } : {}) }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        const error = new Error(`Host returned HTTP ${response.statusCode}`);
        reject(error);
        request.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(new Error('Response exceeds size limit'));
          request.destroy();
        }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Host interrupted response')));
      response.on('end', () => resolve({ body: Buffer.concat(chunks), headers: response.headers }));
    });
    const timer = setTimeout(() => {
      reject(new Error('Host request timed out'));
      request.destroy();
    }, timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    request.end();
  });
}

function authorization(credential) {
  if (typeof credential === 'string' && credential) return `Bearer ${credential}`;
  if (credential?.type === 'basic' && typeof credential.username === 'string' && typeof credential.password === 'string') {
    if (credential.username.includes(':')) throw new Error('Basic authentication username cannot contain a colon');
    return `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`;
  }
  throw new Error('Remote credentials are not configured');
}

async function requestJson(url, credential, allowSelfSigned = false) {
  if (new URL(url).protocol !== 'https:') throw new Error('Remote API URL must use HTTPS');
  const { body } = await requestBuffer(url, {
    headers: { Accept: 'application/json', Authorization: authorization(credential) }, allowSelfSigned
  });
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new Error('Host returned invalid JSON'); }
}

module.exports = { authorization, requestBuffer, requestJson };
