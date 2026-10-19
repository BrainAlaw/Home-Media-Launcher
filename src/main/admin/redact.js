'use strict';

const SECRET_LINE_NAME = '(?:VP_API|WEATHER_API|STEAMDB_API|SPOTIFY_CLIENT_ID|SPOTIFY_SOLOIST_API|[A-Z0-9_]*_TOKEN|[A-Z0-9_]*_SECRET)';
const SECRET_LINE = new RegExp(`(^[ \\t]*${SECRET_LINE_NAME}[ \\t]*[=:][ \\t]*).*$`, 'gim');
const BEARER = /\bBearer\s+[^\s,;"']+/gi;
const COOKIE_LINE = /(^[ \t]*(?:Cookie|Set-Cookie)[ \t]*:[ \t]*).*$/gim;

function redactText(text, secrets = []) {
  let result = String(text ?? '');
  const values = Array.isArray(secrets) ? secrets : Object.values(secrets || {});
  for (const secret of values.filter((value) => typeof value === 'string' && value.length > 0).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('<redacted>');
  }
  result = result.replace(BEARER, 'Bearer <redacted>');
  result = result.replace(COOKIE_LINE, '$1<redacted>');
  result = result.replace(SECRET_LINE, '$1<redacted>');
  return result;
}

module.exports = { redactText };
