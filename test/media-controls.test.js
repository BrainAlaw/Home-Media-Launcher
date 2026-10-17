'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MC = require('../src/renderer/media-controls');

const track = { id: 't1', uri: 'spotify:track:t1', title: 'Song', artists: ['A', 'B'], album: 'Alb', artUrl: 'https://x/y.jpg', durationMs: 200000 };
const signedIn = { status: 'signed-in', displayName: 'Me' };
const playing = (extra = {}) => MC.normaliseState({ auth: signedIn, playing: true, track, progressMs: 10000, idle: false, volume: 40, shuffle: true, repeat: 'context', updatedAt: 1, ...extra }, 1000);

test('normaliseState accepts bare auth states and garbage', () => {
  assert.equal(MC.normaliseState({ status: 'unconfigured' }).auth.status, 'unconfigured');
  assert.equal(MC.normaliseState(undefined).auth.status, 'signed-out');
  assert.equal(MC.normaliseState({ auth: signedIn, playing: true }).playing, false, 'playing needs a track');
  assert.equal(MC.normaliseState({ auth: signedIn, volume: 140 }).volume, 100);
});

test('progress interpolates while playing, freezes while paused and clamps to the duration', () => {
  const state = playing();
  assert.equal(MC.interpolateProgress(state, 1000), 10000);
  assert.equal(MC.interpolateProgress(state, 4500), 13500);
  assert.equal(MC.interpolateProgress(state, 999), 10000, 'a clock step backwards never rewinds');
  assert.equal(MC.interpolateProgress({ ...state, playing: false }, 99999), 10000);
  assert.equal(MC.interpolateProgress(state, 1000 + 999999), 200000);
  assert.equal(MC.progressFraction(state, 1000 + 95000), 0.525);
  assert.equal(MC.reachedTrackEnd(state, 1000 + 190000), true);
  assert.equal(MC.reachedTrackEnd(state, 1000 + 1000), false);
  assert.equal(MC.reachedTrackEnd({ ...state, playing: false }, 1e9), false);
  assert.equal(MC.progressFraction(MC.normaliseState({ auth: signedIn }), 0), 0);
});

test('formatClock', () => {
  assert.equal(MC.formatClock(187000), '3:07');
  assert.equal(MC.formatClock(3723000), '1:02:03');
  assert.equal(MC.formatClock(NaN), '0:00');
});

test('view model per state', () => {
  const vm = (raw) => MC.buildViewModel(MC.normaliseState(raw));
  const unconfigured = vm({ auth: { status: 'unconfigured' } });
  assert.deepEqual([unconfigured.kind, unconfigured.interactive], ['unconfigured', false]);
  assert.match(unconfigured.subtitle, /SPOTIFY_CLIENT_ID/);
  const out = vm({ auth: { status: 'signed-out' } });
  assert.deepEqual([out.kind, out.title, out.cardActions], ['signed-out', 'Connect Spotify', ['login']]);
  const signing = vm({ auth: { status: 'signing-in', url: 'https://accounts.spotify.com/x' } });
  assert.equal(signing.title, 'Finish signing in in your browser');
  assert.equal(signing.detail, 'https://accounts.spotify.com/x');
  assert.equal(signing.subtitle, 'https://accounts.spotify.com/x', 'the url fallback is visible');
  const error = vm({ auth: { status: 'error', message: 'fetch failed ECONNREFUSED' } });
  assert.deepEqual([error.kind, error.cardActions], ['error', ['retry', 'login']]);
  assert.match(error.subtitle, /No connection/);
  const idle = vm({ auth: signedIn, idle: true, playing: false });
  assert.deepEqual([idle.kind, idle.cardActions, idle.controls], ['idle', ['open-spotify'], ['library']]);
  const live = MC.buildViewModel(playing());
  assert.deepEqual([live.kind, live.title, live.subtitle, live.volume, live.shuffle, live.repeat], ['playing', 'Song', 'A, B', 40, true, 'context']);
  assert.deepEqual(live.controls, ['prev', 'toggle', 'next', 'shuffle', 'repeat', 'volume-down', 'volume-up', 'library']);
  assert.equal(MC.buildViewModel(playing({ playing: false })).kind, 'paused');
});

test('labels and commands follow the state', () => {
  const live = MC.buildViewModel(playing());
  const paused = MC.buildViewModel(playing({ playing: false }));
  assert.equal(MC.actionLabel('toggle', live), 'Pause');
  assert.equal(MC.actionLabel('toggle', paused), 'Play');
  assert.equal(MC.actionLabel('repeat', live), 'Repeat all');
  assert.equal(MC.commandFor('toggle', live), 'pause');
  assert.equal(MC.commandFor('toggle', paused), 'play');
  assert.equal(MC.commandFor('prev', live), 'previous');
  assert.equal(MC.commandFor('library', live), null);
});

test('optimistic effects', () => {
  const state = playing();
  assert.equal(MC.applyOptimistic(state, 'pause').playing, false);
  assert.equal(MC.applyOptimistic(state, 'pause').progressMs >= 10000, true);
  assert.equal(MC.applyOptimistic(state, 'shuffle').shuffle, false);
  assert.equal(MC.applyOptimistic(state, 'repeat').repeat, 'track');
  assert.equal(MC.applyOptimistic(MC.applyOptimistic(state, 'repeat'), 'repeat').repeat, 'off');
  assert.equal(MC.applyOptimistic(state, 'volume-up').volume, 50);
  assert.equal(MC.applyOptimistic({ ...state, volume: 95 }, 'volume-up').volume, 100);
  assert.equal(MC.applyOptimistic({ ...state, volume: 3 }, 'volume-down').volume, 0);
});

test('global media keys map to commands and toasts', () => {
  const state = playing();
  assert.equal(MC.commandForRemoteAction('playpause', state), 'pause');
  assert.equal(MC.commandForRemoteAction('playpause', { ...state, playing: false }), 'play');
  assert.equal(MC.commandForRemoteAction('stop', state), 'pause');
  assert.equal(MC.commandForRemoteAction('next', state), 'next');
  assert.equal(MC.commandForRemoteAction('previous', state), 'previous');
  assert.equal(MC.commandForRemoteAction('select', state), null);
  assert.equal(MC.toastFor('playpause', { ...state, playing: false }), 'Paused');
  assert.equal(MC.toastFor('playpause', state), 'Playing: Song - A, B');
  assert.equal(MC.toastFor('next', state), 'Next track');
});

test('focus model: left/right inside, up/down/back leave, confirm activates', () => {
  const model = new MC.WidgetFocusModel(['prev', 'toggle', 'next', 'library']);
  model.resetToDefault();
  assert.equal(model.current, 'toggle');
  assert.deepEqual(model.handle('right'), { type: 'focus', index: 2 });
  assert.deepEqual(model.handle('right'), { type: 'focus', index: 3 });
  assert.deepEqual(model.handle('right'), { type: 'none' }, 'stops at the edge');
  assert.deepEqual(model.handle('confirm'), { type: 'activate', id: 'library' });
  model.handle('left'); model.handle('left'); model.handle('left');
  assert.deepEqual(model.handle('left'), { type: 'none' });
  assert.equal(model.current, 'prev');
  assert.deepEqual(model.handle('down'), { type: 'leave', direction: 'down' });
  assert.deepEqual(model.handle('back'), { type: 'leave', direction: 'system' }, 'Back targets the quick-settings button like tiles');
  assert.deepEqual(model.handle('up'), { type: 'leave', direction: 'up' });
});

test('focus model keeps the focused action across a state change and falls back to the primary stop', () => {
  const model = new MC.WidgetFocusModel(['prev', 'toggle', 'next', 'library']);
  model.index = 2;
  model.setOrder(['prev', 'toggle', 'next', 'shuffle', 'library']);
  assert.equal(model.current, 'next');
  model.setOrder(['open-spotify', 'library']);
  assert.equal(model.current, 'open-spotify');
  assert.equal(new MC.WidgetFocusModel([]).handle('left').type, 'none');
  assert.deepEqual(new MC.WidgetFocusModel([]).handle('down'), { type: 'leave', direction: 'down' });
  assert.deepEqual(new MC.WidgetFocusModel([]).handle('back'), { type: 'leave', direction: 'system' });
});

test('dominantColour prefers saturated pixels and handles empty input', () => {
  const px = (r, g, b, a = 255) => [r, g, b, a];
  const data = [...px(30, 30, 30), ...px(240, 240, 240), ...px(200, 30, 40), ...px(210, 40, 50), ...px(0, 0, 0, 0)];
  const colour = MC.dominantColour(data);
  assert.ok(colour.r > 150 && colour.g < 100, JSON.stringify(colour));
  assert.equal(MC.dominantColour([]), null);
  assert.equal(MC.dominantColour(px(255, 0, 0, 10)), null);
  assert.equal(MC.glowCss(null), 'var(--accent)');
  assert.equal(MC.glowCss({ r: 255, g: 0, b: 0 }), 'rgb(178 0 0)');
});

test('backend error codes map to friendly messages', () => {
  assert.match(MC.friendlyCode('PREMIUM_REQUIRED', 'x'), /Premium required/);
  assert.match(MC.friendlyCode('NO_ACTIVE_DEVICE'), /Open Spotify/);
  assert.equal(MC.friendlyCode('HTTP_500', 'Server exploded'), 'Server exploded');
  assert.match(MC.friendlyCode('HTTP_500', ''), /try again/);
});
