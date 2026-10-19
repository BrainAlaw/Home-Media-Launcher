'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactText } = require('../src/main/admin/redact');

test('redacts configured values, including repeated occurrences', () => {
  assert.equal(redactText('token=abc abc', ['abc']), 'token=<redacted> <redacted>');
});

test('redacts Spotify authentication errors and known key assignment lines', () => {
  const message = 'Spotify auth failed\nSPOTIFY_CLIENT_ID=spotify-client-secret\nWEATHER_API: weather-secret';
  assert.equal(redactText(message), 'Spotify auth failed\nSPOTIFY_CLIENT_ID=<redacted>\nWEATHER_API: <redacted>');
});

test('redacts a Vibepollo bearer token and admin cookie values', () => {
  const message = 'Vibepollo HTTP 401: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret\nCookie: hml_admin_session=abc; Path=/\nSet-Cookie: hml_admin_session=xyz; HttpOnly';
  assert.equal(redactText(message), 'Vibepollo HTTP 401: Authorization: Bearer <redacted>\nCookie: <redacted>\nSet-Cookie: <redacted>');
});

test('redacts arbitrary token and secret key names on assignment lines', () => {
  assert.equal(redactText('OAUTH_TOKEN = value-1\nREFRESH_SECRET: value-2'), 'OAUTH_TOKEN = <redacted>\nREFRESH_SECRET: <redacted>');
});
