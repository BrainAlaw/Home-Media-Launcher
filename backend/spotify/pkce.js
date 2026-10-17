'use strict';

const { createHash, randomBytes } = require('node:crypto');

const SCOPES = Object.freeze([
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read'
]);

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

const base64Url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** RFC 7636 verifier: 43-128 characters from the unreserved set. 64 random bytes give 86 characters. */
function createVerifier(bytes = randomBytes(64)) {
  return base64Url(bytes);
}

/** S256 challenge: base64url(SHA-256(verifier)). */
function createChallenge(verifier) {
  return base64Url(createHash('sha256').update(verifier, 'ascii').digest());
}

function createState() {
  return base64Url(randomBytes(24));
}

function buildAuthorizeUrl({ clientId, redirectUri, challenge, state, scopes = SCOPES }) {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: scopes.join(' ')
  }).toString();
  return url.toString();
}

module.exports = { SCOPES, AUTHORIZE_URL, TOKEN_URL, base64Url, createVerifier, createChallenge, createState, buildAuthorizeUrl };
