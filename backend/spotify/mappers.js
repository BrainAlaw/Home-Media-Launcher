'use strict';

/** Pure mappers from Spotify Web API payloads to the `media` contract types (backend/contracts.d.ts). */

const TARGET_ART_WIDTH = 300;

/** Smallest image that is at least 300 px wide, otherwise the largest available. */
function pickImage(images) {
  if (!Array.isArray(images) || !images.length) return undefined;
  const usable = images.filter((image) => image && typeof image.url === 'string');
  if (!usable.length) return undefined;
  const sorted = [...usable].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((image) => (image.width || 0) >= TARGET_ART_WIDTH) || sorted[sorted.length - 1]).url;
}

function mapTrack(item) {
  if (!item || typeof item !== 'object' || !item.uri || !item.id) return undefined;
  if (item.type === 'episode') {
    const show = item.show || {};
    const artUrl = pickImage(item.images) || pickImage(show.images);
    return { id: item.id, uri: item.uri, title: String(item.name || ''), artists: show.name ? [show.name] : [], album: String(show.name || ''), ...(artUrl ? { artUrl } : {}), durationMs: Number(item.duration_ms) || 0 };
  }
  const artUrl = pickImage(item.album?.images);
  return {
    id: item.id,
    uri: item.uri,
    title: String(item.name || ''),
    artists: (item.artists || []).map((artist) => artist?.name).filter(Boolean),
    album: String(item.album?.name || ''),
    ...(artUrl ? { artUrl } : {}),
    durationMs: Number(item.duration_ms) || 0
  };
}

function mapDevice(device) {
  if (!device || typeof device !== 'object' || !device.id) return undefined;
  return {
    id: device.id,
    name: String(device.name || 'Spotify device'),
    type: String(device.type || 'Unknown').toLowerCase(),
    active: Boolean(device.is_active),
    ...(Number.isFinite(device.volume_percent) ? { volume: device.volume_percent } : {})
  };
}

/**
 * GET /me/player payload (null for HTTP 204) to the playback part of MediaState.
 * `idle` is true when nothing is playing and no device is active.
 */
function mapPlayback(raw) {
  if (!raw || typeof raw !== 'object') return { playing: false, idle: true };
  const device = mapDevice(raw.device);
  const track = mapTrack(raw.item);
  const playing = Boolean(raw.is_playing);
  const repeat = ['off', 'track', 'context'].includes(raw.repeat_state) ? raw.repeat_state : undefined;
  return {
    playing,
    ...(track ? { track } : {}),
    ...(Number.isFinite(raw.progress_ms) ? { progressMs: raw.progress_ms } : {}),
    ...(typeof raw.shuffle_state === 'boolean' ? { shuffle: raw.shuffle_state } : {}),
    ...(repeat ? { repeat } : {}),
    ...(device && Number.isFinite(device.volume) ? { volume: device.volume } : {}),
    ...(device ? { device } : {}),
    idle: !playing && !device?.active
  };
}

function mapPlaylist(playlist) {
  if (!playlist?.id || !playlist.uri) return undefined;
  const artUrl = pickImage(playlist.images);
  // `items.total` replaced the deprecated `tracks.total` in the 2026 API; accept both.
  const trackCount = Number(playlist.items?.total ?? playlist.tracks?.total) || 0;
  return { id: playlist.id, uri: playlist.uri, name: String(playlist.name || ''), trackCount, ...(artUrl ? { artUrl } : {}), ...(playlist.owner?.display_name ? { owner: playlist.owner.display_name } : {}) };
}

function mapAlbum(album) {
  if (!album?.id || !album.uri) return undefined;
  const artUrl = pickImage(album.images);
  return { id: album.id, uri: album.uri, name: String(album.name || ''), artist: (album.artists || []).map((a) => a?.name).filter(Boolean).join(', '), ...(artUrl ? { artUrl } : {}) };
}

function mapArtist(artist) {
  if (!artist?.id || !artist.uri) return undefined;
  const artUrl = pickImage(artist.images);
  return { id: artist.id, uri: artist.uri, name: String(artist.name || ''), ...(artUrl ? { artUrl } : {}) };
}

const compact = (list, mapper) => (Array.isArray(list?.items) ? list.items.map(mapper).filter(Boolean) : []);

function mapSearch(raw) {
  return { tracks: compact(raw?.tracks, mapTrack), albums: compact(raw?.albums, mapAlbum), playlists: compact(raw?.playlists, mapPlaylist), artists: compact(raw?.artists, mapArtist) };
}

/** Playlist entries expose the track as `item` (current) or `track` (deprecated). Entries without a usable track (removed or local items) are skipped. */
function mapPlaylistTracks(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return items.map((entry) => mapTrack(entry?.item ?? entry?.track)).filter(Boolean);
}

/**
 * Home shelves ("For you"). Spotify no longer exposes recommendations, featured playlists or the contents of its own
 * algorithmic playlists to new apps, so the shelves come from the account itself: Spotify-owned playlists in the library
 * (Daily Mix, Discover Weekly, ...), recently played, top tracks/artists, saved albums and new releases.
 * Each argument is the raw payload of its endpoint, or null when that call failed.
 */
function mapForYou({ playlists, recent, topTracks, topArtists, savedAlbums, newReleases } = {}) {
  const spotifyOwned = (Array.isArray(playlists?.items) ? playlists.items : []).filter((item) => item?.owner?.id === 'spotify');
  const seen = new Set();
  const recentTracks = (Array.isArray(recent?.items) ? recent.items : []).map((entry) => mapTrack(entry?.track)).filter((track) => {
    if (!track || seen.has(track.uri)) return false;
    seen.add(track.uri);
    return true;
  });
  return {
    madeForYou: spotifyOwned.map(mapPlaylist).filter(Boolean),
    recent: recentTracks,
    topTracks: compact(topTracks, mapTrack),
    topArtists: compact(topArtists, mapArtist),
    albums: (Array.isArray(savedAlbums?.items) ? savedAlbums.items : []).map((entry) => mapAlbum(entry?.album)).filter(Boolean),
    newReleases: compact(newReleases?.albums, mapAlbum)
  };
}

module.exports = { mapForYou, pickImage, mapTrack, mapDevice, mapPlayback, mapPlaylist, mapAlbum, mapArtist, mapSearch, mapPlaylistTracks };
