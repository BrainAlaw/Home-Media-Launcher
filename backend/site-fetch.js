'use strict';

const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');

function isPrivateIPv4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0)
    || (a === 198 && (b === 18 || b === 19));
}

/** True for loopback, link-local, private, multicast and otherwise non-public addresses. */
function isPrivateAddress(address) {
  const ip = String(address).replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('ff');
}

function hostMatches(hostname, trusted) {
  const host = hostname.toLowerCase();
  return trusted.some((entry) => String(entry).toLowerCase() === host);
}

/** Synchronous pre-check for literal hosts. DNS answers are re-checked at connect time. */
function assertAllowedUrl(url, trustedHosts = []) {
  const parsed = url instanceof URL ? url : new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed');
  if (parsed.username || parsed.password) throw new Error('Credentials in URLs are not allowed');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (hostMatches(host, trustedHosts)) return parsed;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private host blocked');
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error('Private address blocked');
  return parsed;
}

function guardedLookup(trustedHosts) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!hostMatches(hostname, trustedHosts) && addresses.some((entry) => isPrivateAddress(entry.address))) return callback(new Error('Private address blocked'));
      if (options && options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function singleRequest(parsed, { headers, timeoutMs, maxBytes, truncate, lookup }) {
  return new Promise((resolve, reject) => {
    const request = https.request(parsed, { headers, agent: false, lookup }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        resolve({ redirect: response.headers.location });
        return;
      }
      if (status < 200 || status >= 300) { response.resume(); reject(new Error(`Site returned HTTP ${status}`)); return; }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          if (!truncate) { reject(new Error('Response exceeds size limit')); request.destroy(); return; }
          chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - maxBytes))));
          resolve({ body: Buffer.concat(chunks), headers: response.headers });
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ body: Buffer.concat(chunks), headers: response.headers }));
    });
    const timer = setTimeout(() => { reject(new Error('Site request timed out')); request.destroy(); }, timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    request.end();
  });
}

/**
 * Direct, guarded fetch from the site itself: HTTPS only, at most `maxRedirects` HTTPS redirects,
 * every hop and every DNS answer is checked against the private-range guard, bounded size and time.
 * Returns { body, headers, url } where `url` is the final URL.
 */
function createSiteFetcher({ trustedHosts = () => [] } = {}) {
  return async function fetchSite(url, { maxBytes = 2097152, timeoutMs = 6000, truncate = false, maxRedirects = 3, accept = '*/*' } = {}) {
    const trusted = trustedHosts();
    const lookup = guardedLookup(trusted);
    let current = assertAllowedUrl(url, trusted);
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const result = await singleRequest(current, { headers: { Accept: accept, 'User-Agent': 'HomeMediaLauncher/1.0' }, timeoutMs, maxBytes, truncate, lookup });
      if (!result.redirect) return { body: result.body, headers: result.headers, url: current.href };
      current = assertAllowedUrl(new URL(result.redirect, current), trusted);
    }
    throw new Error('Too many redirects');
  };
}

module.exports = { assertAllowedUrl, createSiteFetcher, isPrivateAddress, guardedLookup };
