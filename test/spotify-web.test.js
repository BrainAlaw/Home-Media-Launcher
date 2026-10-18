'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedUrl, normaliseBounds, zoomFor, cleanUserAgent } = require('../backend/spotify-web');

test('only https Spotify and sign-in hosts may load in the embedded player', () => {
  assert.equal(isAllowedUrl('https://open.spotify.com/genre/home'), true);
  assert.equal(isAllowedUrl('https://accounts.spotify.com/login'), true);
  assert.equal(isAllowedUrl('https://accounts.google.com/o/oauth2'), true);
  assert.equal(isAllowedUrl('http://open.spotify.com/'), false);
  assert.equal(isAllowedUrl('https://evilspotify.com/'), false);
  assert.equal(isAllowedUrl('https://spotify.com.evil.example/'), false);
  assert.equal(isAllowedUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedUrl('not a url'), false);
});

test('bounds are rounded and rejected when unusable', () => {
  assert.deepEqual(normaliseBounds({ x: 96.4, y: 300.6, width: 1700.2, height: 640.5 }), { x: 96, y: 301, width: 1700, height: 641 });
  assert.equal(normaliseBounds({ x: 0, y: 0, width: 10, height: 10 }), null);
  assert.equal(normaliseBounds({ x: 'a', y: 0, width: 800, height: 600 }), null);
  assert.equal(normaliseBounds(null), null);
});

test('zoom follows the stage height within limits', () => {
  assert.equal(zoomFor({ height: 800 }), 1);
  assert.equal(zoomFor({ height: 400 }), 0.8);
  assert.equal(zoomFor({ height: 3000 }), 1.5);
});

test('user agent loses the Electron token', () => {
  assert.equal(cleanUserAgent('Mozilla/5.0 Chrome/120 home-media-launcher/1.0.0 Electron/44.0.0 Safari/537'), 'Mozilla/5.0 Chrome/120 Safari/537');
});
