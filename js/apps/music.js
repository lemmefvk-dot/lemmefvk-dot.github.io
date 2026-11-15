/* ============================================================
   Music — real audio, and the player for the whole OS.

   Two sources, both real:

   · Your music — every audio file under ~/Music. The bytes live in
     this browser's IndexedDB (js/core/media.js); Import copies songs
     from the computer (file picker or drag-and-drop). A title comes
     from the file name ("Artist - Title" is split), a length is read
     from the audio itself, a size is the file's own, and the format
     is read from the file's first bytes, never guessed from its name.
     A file in a format this browser can't play (AIFF, WMA, ALAC…) is
     not imported, and the person is told which format and why; a
     file with no audio behind it says so instead of pretending.
   · Live radio — a short list of SomaFM stations, streamed straight
     from SomaFM over HTTPS (each one was checked to play from a test
     page). Listener counts and the song on air come from SomaFM's
     public API when it answers. SomaFM is independent and
     listener-supported and has nothing to do with StaticOS — the
     Radio page says so. A stream that drops reconnects by itself;
     one that won't play is asked directly what went wrong (a 403, a
     Wi-Fi sign-in page, no answer) so the message names the cause.

   The player is one HTMLAudioElement at module level, so music keeps
   playing after the window closes. The rest of the OS drives it over
   the bus — media:play / media:pause / media:next / media:prev /
   media:seek (seconds) — and hears back on media:track
   { title, artist, album, duration, elapsed, playing, live, source },
   which is what the widget rail's Now Playing card reads. `playing`
   is true only while sound is really coming out (not while a station
   is still connecting). The Media
   Session API gets the same metadata and the same actions, so
   keyboard media keys and the browser's media controls work too.
   Loudness is the OS's own prefs.volume / prefs.muted.

   Playlists are yours and real: made, named, filled, reordered (drag
   the grip, or ↑/↓ on it) and deleted here, and kept in the OS store
   under 'portal.music' — so they survive a reload and travel with
   Settings › Back up your data. A track is the song's media reference
   (the id of its bytes), so renaming or moving the file keeps it in
   its playlists; a song that has gone (Trash, deleted) stays listed by
   name, says so, and is skipped when the playlist plays.
   Radio favourites are Static Radio's own ('portal.radio' favs): a
   heart here and a heart there are the same heart, and favourites are
   listed first in both.

   Ambient sounds (the Ambient view) are js/core/ambient.js: rain,
   fire, wind, a café and brown noise synthesised live, with a mixer,
   presets and a sleep timer. They have their own player, so they mix
   with a song and keep going when this window closes; this view is
   only their controls.

   Reading the song itself: the title, artist, album and cover art are
   read from the file's own bytes (js/core/tags.js — ID3, MP4 atoms,
   FLAC/Vorbis comments); a file with no tags keeps the name-based title.
   Lyrics are a .lrc (synced) or .txt that sits beside the song; they are
   never looked up anywhere. Sound: an equalizer, speed and crossfade
   (js/core/playerfx.js), a sleep timer shared with Static Radio
   (js/core/mediasleep.js), A–B repeat, and Most / Recently played, counted
   only from songs that were really listened to.
   One station list for the OS: js/core/stations.js (Static Radio reads it too).

   Audiobooks — LibriVox's public-domain recordings, played from archive.org
   (core/librivox.js, the Audiobooks page in music-books.js). A book is a third
   kind of thing the one player can hold, beside a file and a station:
   { kind: 'book', book, ci }. It uses the same element, queue controls
   (Next / Previous step chapters), speed, sleep timer, media keys and widget
   rail; where you stopped is kept for each book through the store.

   An older Music listed real artists' songs that had no audio, with
   made-up playlists and a timer pretending to play them. All gone.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import vfs from '../core/vfs.js';
import * as media from '../core/media.js';
import * as tap from '../core/audiotap.js';
import { appLevel } from '../core/appearance.js';
import * as AMB from '../core/ambient.js';
import { createTuner } from './music-tuner.js';
import { normalizeCode, isCode } from '../core/roomcode.js';
import { createShares, keyOf as fileKey } from '../core/sharedlist.js';
import { sharePanel, joinBox, inviteLink } from './musicshare.js';
import { open as openWin, setRect, setPinned } from '../core/wm.js';
import { STATIONS, SOMA, SOMA_API, streamUrl as stationUrl, triesFor, quality as streamQuality, setQuality, QUALITIES, qualityInfo, trouble } from '../core/stations.js';
import { readTags } from '../core/tags.js';
import { parseLyrics, activeLine, siblingNames } from '../core/lrc.js';
import * as fx from '../core/playerfx.js';
import * as sleepT from '../core/mediasleep.js';
import * as finds from '../core/radiofinds.js';
import { paintMediaPanel } from '../portal/sendfriend.js';
import { createAudiobooks } from './music-books.js';
import * as LV from '../core/librivox.js';
import { t as tx } from '../core/i18n.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-music-css')) {
  const l = document.createElement('link');
  l.id = 'feat-music-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-music.css';
  document.head.appendChild(l);
}

const DIR = `${vfs.HOME}/Music`;
const TRASH = `${vfs.HOME}/Trash`;
const ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.weba,.lrc,.txt';

/* The stations are js/core/stations.js — one list for Music and Static Radio. Where a stream is
   fetched from, in order: two of SomaFM's servers with CORS (which the spectrum and the equalizer
   need), then plain — a proxy that strips CORS headers still gets music, just without those. */
const onLocalhost = () => typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);

/* ---------------- small helpers ---------------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

function dur(s) {
  if (!Number.isFinite(s) || s < 0) return '—';
  s = Math.floor(s);
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
function bytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
const stemOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i) : ''; };
const fmtTag = name => (extOf(name).slice(1) || 'file').toUpperCase();

/** "Artist - Title.mp3" -> { artist, title }; anything else is all title. */
function parseName(name) {
  const stem = stemOf(name).trim();
  const m = stem.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: stem || name };
}

function shuffled(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

async function getJSON(url, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------------- tags: what the file itself says ----------------
   Read lazily and one file at a time (js/core/tags.js), keyed by the media
   reference so a rename or a move keeps it. A song with no tags keeps the
   title and artist taken from its file name. */
const TAGS = new Map();                 /* ref -> { title, artist, album, cover… } | null (nothing in the file) */
const tagQ = [];
let tagging = false;
function describe(n) {
  const p = parseName(n.name);
  const t = media.isMedia(n) ? TAGS.get(n.content) : null;
  return { title: t?.title || p.title, artist: t?.artist || p.artist, album: t?.album || '' };
}
function wantTags(n) {
  if (!n || !media.isMedia(n) || TAGS.has(n.content) || tagQ.includes(n)) return;
  tagQ.push(n);
  runTags();
}
async function runTags() {
  if (tagging) return;
  tagging = true;
  let fresh = 0;
  while (tagQ.length) {
    const n = tagQ.shift();
    if (TAGS.has(n.content)) continue;
    let t = null;
    try { const b = await media.blobOf(n); t = b ? await readTags(b) : null; } catch (e) { t = null; }
    TAGS.set(n.content, t);
    if (t) {
      fresh++;
      for (const e of libCache || []) if (e.node.content === n.content) Object.assign(e, describe(n));
      if (P.cur?.kind === 'file' && P.cur.node.content === n.content) { msKey = null; changed('track'); }
      if (fresh % 8 === 0) changed('list');
    }
  }
  tagging = false;
  if (fresh) changed('list');
}
/* cover art: a blob URL made only when a song is shown, and kept for a while */
const COVERS = new Map();               /* ref -> { url, type } | null */
function coverOf(n) {
  if (!n || !media.isMedia(n)) return null;
  const hit = COVERS.get(n.content);
  if (hit !== undefined) return hit;
  const t = TAGS.get(n.content);
  if (t === undefined) { wantTags(n); return null; }
  if (!t || !t.cover) { COVERS.set(n.content, null); return null; }
  COVERS.set(n.content, null);          /* in flight: asking again must not start a second read */
  t.cover.blob().then(b => {
    if (!b || !b.size) return;
    COVERS.set(n.content, { url: URL.createObjectURL(b), type: b.type || t.cover.mime });
    while (COVERS.size > 40) {
      const k = COVERS.keys().next().value;
      const v = COVERS.get(k);
      COVERS.delete(k);
      if (v?.url) { try { URL.revokeObjectURL(v.url); } catch (e) { /* gone */ } }
    }
    if (P.cur?.kind === 'file' && P.cur.node.content === n.content) { msKey = null; changed('track'); }
  }).catch(() => {});
  return null;
}

/* ---------------- the library (~/Music) ---------------- */
let libCache = null;
function library() {
  if (libCache) return libCache;
  const out = [];
  vfs.walk(DIR, (n, path) => {
    if (n.type === 'file' && media.kindOf(n.name) === 'audio') out.push({ node: n, path, ...describe(n) });
  });
  libCache = out;
  for (const e of out) wantTags(e.node);
  return out;
}

/** node -> path for everything in the home folder that isn't in the Trash. */
function liveMap() {
  const m = new Map();
  vfs.walk(vfs.HOME, (n, p) => { if (p !== TRASH && !p.startsWith(`${TRASH}/`)) m.set(n, p); });
  return m;
}
const alive = node => (node ? liveMap().get(node) || null : null);

function folderLabel(path) {
  if (!path) return 'Your music';
  const dir = vfs.parentPath(path);
  if (dir === DIR || dir.startsWith(`${DIR}/`)) return 'Your music';
  return vfs.baseName(dir);
}

/* ---------------- playlists (store 'portal.music') ---------------- */
const PL_KEY = 'portal.music';
const PL_NAME_MAX = 80;
const isRef = r => typeof r === 'string' && (r.startsWith(media.MEDIA) || r.startsWith(media.ASSET));
const cleanPlName = s => String(s || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PL_NAME_MAX);

/** Every playlist, read defensively: a hand-edited or old store can't break the view. */
function plAll() {
  const raw = store.get(PL_KEY);
  const list = raw && Array.isArray(raw.playlists) ? raw.playlists : [];
  const ids = new Set();
  return list.filter(p => p && typeof p.id === 'string' && !ids.has(p.id) && ids.add(p.id)).map(p => {
    const refs = new Set();
    return {
      id: p.id,
      name: cleanPlName(p.name) || 'Playlist',
      at: Number(p.at) || 0,
      tracks: (Array.isArray(p.tracks) ? p.tracks : [])
        .filter(t => t && isRef(t.ref) && !refs.has(t.ref) && refs.add(t.ref))
        .map(t => ({ ref: t.ref, name: String(t.name || '') })),
    };
  });
}
function plWrite(list) {
  const raw = store.get(PL_KEY);
  store.set(PL_KEY, { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}), v: 1, playlists: list });
}
const plGet = id => plAll().find(p => p.id === id) || null;
function plEdit(id, fn, silent = false) {
  const list = plAll();
  const i = list.findIndex(p => p.id === id);
  if (i < 0) return null;
  const before = list[i];
  const next = fn({ ...list[i], tracks: list[i].tracks.slice() });
  if (!next) return null;
  list[i] = next;
  plWrite(list);
  if (!silent) SH.noteEdit(id, before, next);      /* a shared playlist turns a person's edit into operations */
  return next;
}
function plFreeName(base = 'New playlist') {
  const taken = new Set(plAll().map(p => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
}
const trackOf = n => ({ ref: n.content, name: n.name });
function plCreate(name, nodes = []) {
  const id = `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const tracks = [];
  for (const n of nodes) if (n && media.isMedia(n) && !tracks.some(t => t.ref === n.content)) tracks.push(trackOf(n));
  plWrite([...plAll(), { id, name: plFreeName(cleanPlName(name) || 'New playlist'), at: Date.now(), tracks }]);
  return id;
}
const plRename = (id, name) => { const c = cleanPlName(name); return !!c && !!plEdit(id, p => (p.name === c ? null : { ...p, name: c })); };
const plDelete = id => plWrite(plAll().filter(p => p.id !== id));
/** 'added' | 'dup' | 'nodata' | null (no such playlist) */
function plAdd(id, n) {
  if (!n || !media.isMedia(n)) return 'nodata';
  const p = plGet(id);
  if (!p) return null;
  if (p.tracks.some(t => t.ref === n.content)) return 'dup';
  plEdit(id, q => ({ ...q, tracks: [...q.tracks, trackOf(n)] }));
  return 'added';
}
const plRemoveAt = (id, i) => plEdit(id, p => (i >= 0 && i < p.tracks.length ? { ...p, tracks: p.tracks.filter((_, k) => k !== i) } : null));
function plMove(id, from, to) {
  return plEdit(id, p => {
    if (from === to || from < 0 || from >= p.tracks.length) return null;
    const tracks = p.tracks.slice();
    const [t] = tracks.splice(from, 1);
    tracks.splice(clamp(to, 0, tracks.length), 0, t);
    return { ...p, tracks };
  });
}
/** Every audio file in the home folder (Your music first, the Trash left out): a song a friend
    sent with Drop lands in Downloads, and a shared playlist should still find it. */
function homeAudio() {
  const byRef = new Map(), byKey = new Map();
  const take = (n, path) => {
    if (n.type !== 'file' || media.kindOf(n.name) !== 'audio' || !media.isMedia(n) || byRef.has(n.content)) return;
    const e = { node: n, path, ...describe(n) };
    byRef.set(n.content, e);
    if (!byKey.has(fileKey(n.name, n.size))) byKey.set(fileKey(n.name, n.size), e);
  };
  if (vfs.node(DIR)) vfs.walk(DIR, take);
  vfs.walk(vfs.HOME, (n, path) => { if (path !== TRASH && !path.startsWith(`${TRASH}/`)) take(n, path); });
  return { byRef, byKey };
}
/** A playlist's tracks, each with the song it is now in Your music — or e: null when it's gone. */
function plTracks(p) {
  const byRef = new Map();
  for (const e of library()) if (media.isMedia(e.node) && !byRef.has(e.node.content)) byRef.set(e.node.content, e);
  let home = null;
  return (p?.tracks || []).map(t => ({ ...t, e: byRef.get(t.ref) || (home ||= homeAudio()).byRef.get(t.ref) || null }));
}

/* ---------------- shared playlists (js/core/sharedlist.js) ---------------- */
const SH = createShares({
  info: ref => { const e = homeAudio().byRef.get(ref); return e ? { name: e.node.name, size: e.node.size || 0 } : null; },
  resolve: (name, size) => { const e = homeAudio().byKey.get(fileKey(name, size)); return e ? { ref: e.node.content } : null; },
  read: id => { const p = plGet(id); return p ? { name: p.name, tracks: p.tracks } : null; },
  write: (id, patch) => plEdit(id, p => ({ ...p, ...patch }), true),
  create: name => plCreate(name),
  pathOf: ref => homeAudio().byRef.get(ref)?.path || null,
  station: id => STATIONS.some(s => s.id === id),
  openDrop: path => openWin('drop', { send: [path], go: true }),
});

/* ---------------- radio favourites (Static Radio's store) ---------------- */
const RADIO_KEY = 'portal.radio';
function radioFavs() {
  const o = store.get(RADIO_KEY);
  return Array.isArray(o?.favs) ? [...new Set(o.favs.filter(x => typeof x === 'string'))] : [];
}
function toggleRadioFav(id) {
  const o = store.get(RADIO_KEY);
  const favs = radioFavs();
  store.set(RADIO_KEY, { ...(o && typeof o === 'object' && !Array.isArray(o) ? o : {}),
    favs: favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id] });
}

const nodeKeys = new WeakMap();
let keySeq = 0;
const keyOf = n => { if (!nodeKeys.has(n)) nodeKeys.set(n, `f${++keySeq}`); return nodeKeys.get(n); };

/* ---------------- measured lengths ----------------
   Read from the audio itself, one file at a time, in a muted element
   that is never played. Keyed by the media reference, so a rename or
   a move keeps it. 'bad' = the browser could not read the file. */
const DUR = new Map();
const durOf = n => (n && media.isMedia(n) ? DUR.get(n.content) : undefined);
const probeQ = [];
let probing = false;

function wantDur(n) {
  if (!n || !media.isMedia(n) || DUR.has(n.content) || probeQ.includes(n)) return;
  probeQ.push(n);
  runProbe();
}
async function runProbe() {
  if (probing) return;
  probing = true;
  while (probeQ.length) {
    const n = probeQ.shift();
    if (DUR.has(n.content)) continue;
    const v = await measure(n);
    if (!DUR.has(n.content) || DUR.get(n.content) === 'unknown') DUR.set(n.content, v);
    changed('list');
  }
  probing = false;
}
function measure(node) {
  return new Promise(resolve => {
    let done = false, timer = 0;
    const a = new Audio();
    const fin = v => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      a.removeAttribute('src');
      try { a.load(); } catch (e) {}
      resolve(v);
    };
    a.preload = 'metadata';
    a.muted = true;
    a.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(a.duration)) return fin(a.duration);
      /* recordings without a length in the header (MediaRecorder WebM)
         report Infinity until asked to seek to the end */
      a.addEventListener('durationchange', () => { if (Number.isFinite(a.duration)) fin(a.duration); });
      try { a.currentTime = 1e7; } catch (e) { fin('unknown'); }
    });
    a.addEventListener('error', () => fin('bad'));
    timer = setTimeout(() => fin('unknown'), 15000);
    media.urlOf(node).then(u => { if (!u) fin('bad'); else if (!done) a.src = u; }, () => fin('bad'));
  });
}

/* ---------------- the OS-wide player ---------------- */
const audio = typeof Audio === 'function' ? new Audio() : null;
if (audio) audio.preload = 'auto';

const REPEATS = ['off', 'all', 'one'];
const P = {
  cur: null,            // { kind: 'file', node, path } | { kind: 'radio', st }
  base: [],             // the queue in list order (file nodes)
  queue: [],            // the queue in play order (shuffled when shuffle is on)
  qi: -1,               // where cur sits in queue
  shuffle: store.get('prefs.musicShuffle') === true,
  repeat: REPEATS.includes(store.get('prefs.musicRepeat')) ? store.get('prefs.musicRepeat') : 'off',
  phase: 'idle',        // idle | loading | playing | paused | ended | error
  want: false,          // someone asked for sound (true while buffering too)
  error: null,          // { title, detail, actions[] }
  note: null,           // a softer message
  onAir: null,          // the song SomaFM says is on the current station
  token: 0, tryIx: 0, cors: true, slow: false,
  started: false,       // the current source has made sound at least once
  view: 'songs',
  from: null,           // { pl: id } while a playlist is what's playing
  ab: { a: null, b: null },   // A–B repeat points (seconds) in the current song
  heard: 0, lastT: 0, counted: false,   // listening toward a "real play" of the current song
};
let everPlayed = false;
const subs = new Set();                 /* open windows repaint through these */

/* The wallpaper's music visualizer (js/shell/visualizer.js) reads this
   player through core/audiotap.js. A song is always readable; a station
   only when it came through one of SomaFM's CORS servers — the plain
   fallback plays, but the browser won't let a page look at it. */
/* the equalizer wires this element into Web Audio only when the sound can be read (see core/playerfx.js) */
if (audio) fx.attach(audio, () => !(P.cur && P.cur.kind !== 'file' && !P.cors));

if (audio) tap.register('music', audio, {
  label: tx('Music'),
  blocked: () => (P.cur?.kind === 'radio' && !P.cors
    ? `${P.cur.st.name} is coming through SomaFM’s plain server (its CORS servers didn’t answer here), so the browser won’t let StaticOS read the sound. The music still plays.`
    : P.cur?.kind === 'book' && !P.cors
      ? 'This chapter is coming from archive.org without the permission the browser needs to let StaticOS read the sound. The book still plays.'
      : null),
});

function changed(kind = 'state') {
  if (kind !== 'list' && kind !== 'radio') emitTrack();
  subs.forEach(fn => { try { fn(kind); } catch (e) { console.error('[music]', e); } });
}

/* what the widget rail and the Media Session see */
function trackInfo() {
  const c = P.cur;
  if (!c) return null;
  if (c.kind === 'radio') {
    const a = P.onAir;
    return {
      title: a?.title || c.st.name,
      artist: a ? (a.artist || 'SomaFM') : 'SomaFM',
      album: `${c.st.name} · live radio`,
      duration: 0, elapsed: 0, live: true, source: 'radio',
    };
  }
  if (c.kind === 'book') {
    const d = Number.isFinite(audio.duration) ? audio.duration : (c.book.chapters[c.ci].len || 0);
    return {
      title: c.book.chapters[c.ci].title, artist: c.book.author || 'LibriVox', album: `${c.book.title} · LibriVox`,
      duration: d, elapsed: Math.floor(audio.currentTime || 0), live: false, source: 'book',
    };
  }
  const { title, artist, album } = describe(c.node);
  const d = Number.isFinite(audio.duration) ? audio.duration : (typeof durOf(c.node) === 'number' ? durOf(c.node) : 0);
  return {
    title, artist: artist || 'Unknown artist', album: album || folderLabel(c.path),
    duration: d, elapsed: Math.floor(audio.currentTime || 0), live: false, source: 'file',
  };
}
const soundOn = () => P.want && P.phase !== 'error';

function emitTrack() {
  if (!everPlayed) return;
  const t = trackInfo();
  bus.emit('media:track', t
    ? { title: t.title, artist: t.artist, album: t.album, duration: t.duration, elapsed: t.elapsed,
        playing: soundOn(), live: t.live, source: t.source }
    : { title: tx('Nothing playing'), artist: '', album: '', duration: 0, elapsed: 0, playing: false, live: false, source: null });
  msSync(t);
}

/* ---------------- Media Session ---------------- */
const MS = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;
let msKey = null, msSeekable = null;
function msHandler(action, fn) { try { MS.setActionHandler(action, fn); } catch (e) { /* not supported here */ } }
function claimSession() {
  if (!MS) return;
  msHandler('play', () => resume());
  msHandler('pause', () => pause());
  msHandler('stop', () => pause());
  msHandler('nexttrack', () => next());
  msHandler('previoustrack', () => prev());
  msSeekable = null;
  msSync(trackInfo());
}
function msSync(t) {
  if (!MS) return;
  try {
    const cv = P.cur?.kind === 'file' ? coverOf(P.cur.node) : null;
    const art = P.cur?.kind === 'radio' ? P.cur.st.logo : P.cur?.kind === 'book' ? P.cur.book.cover : cv ? cv.url : '';
    const key = t ? `${t.title}|${t.artist}|${t.album}|${art}` : '';
    if (key !== msKey) {
      msKey = key;
      MS.metadata = t && typeof MediaMetadata === 'function'
        ? new MediaMetadata({ title: t.title, artist: t.artist, album: t.album,
            artwork: art ? [{ src: art, sizes: cv ? '512x512' : '256x256', type: cv ? cv.type : P.cur?.st?.logoType || 'image/png' }] : [] })
        : null;
    }
    MS.playbackState = !t ? 'none' : soundOn() ? 'playing' : 'paused';
    const seekable = !!t && !t.live;
    if (seekable !== msSeekable) {
      msSeekable = seekable;
      msHandler('seekto', seekable ? d => seek(d.seekTime) : null);
      msHandler('seekbackward', seekable ? d => seek((audio.currentTime || 0) - (d.seekOffset || 10)) : null);
      msHandler('seekforward', seekable ? d => seek((audio.currentTime || 0) + (d.seekOffset || 10)) : null);
    }
    if (MS.setPositionState) {
      if (seekable && t.duration > 0) {
        MS.setPositionState({ duration: t.duration, playbackRate: audio.playbackRate || 1,
          position: clamp(audio.currentTime || 0, 0, t.duration) });
      } else MS.setPositionState();
    }
  } catch (e) { /* a browser with a partial Media Session */ }
}

/* ---------------- loudness: the OS's own prefs ----------------
   The element's volume is the OS volume × the mixer's level for Music (Settings > Sound) × the
   sleep timer's fade × the crossfade's fade-in. A crossfade's outgoing song plays on a second,
   short-lived element that follows the same volume and mute. */
const XF = { ghost: null, iv: 0, t0: 0, ms: 0, inMult: 1, pending: false };
function baseVolume() {
  const v = Number(store.get('prefs.volume', 62));
  return clamp(Number.isFinite(v) ? v : 62, 0, 100) / 100 * appLevel('music') * sleepT.fade();
}
function applyVolume() {
  if (!audio) return;
  audio.volume = clamp(baseVolume() * XF.inMult, 0, 1);
  audio.muted = store.get('prefs.muted', false) === true;
  if (XF.ghost) {
    XF.ghost.muted = audio.muted;
    XF.ghost.volume = clamp(baseVolume() * (1 - XF.inMult), 0, 1);
  }
}
applyVolume();
store.sub('prefs', applyVolume);
bus.on('mediasleep:fade', applyVolume);

/* ---------------- errors, in plain words ---------------- */
const ERR = {
  nodata: n => ({ title: tx('“{name}” has no audio in it', { name: n.name }), actions: ['trash'],
    detail: 'It is an empty file — most likely a placeholder from an older StaticOS, which listed songs it could not play. Move it to the Trash, or import the real song.' }),
  missing: n => ({ title: tx('The audio for “{name}” is missing', { name: n.name }), actions: ['import'],
    detail: 'Its bytes are no longer in this browser’s storage (site data may have been cleared). Import the song again.' }),
  format: n => ({ title: tx('This browser can’t play “{name}”', { name: n.name }), actions: ['next', 'trash'],
    detail: canPlayExt(n.name)
      ? `This browser does play ${fmtTag(n.name)} files, so this one is probably damaged, cut short, or not really audio.`
      : `This browser doesn’t play ${fmtTag(n.name)} files. Converting it to MP3 or M4A usually fixes this.` }),
  decode: n => ({ title: tx('“{name}” stopped: the file looks damaged', { name: n.name }), actions: ['next'],
    detail: 'The browser could not decode the rest of it.' }),
  offline: st => ({ title: tx('You’re offline'), actions: ['retry'],
    detail: `${st.name} streams from SomaFM over the internet. Reconnect, then press Play.` }),
  book: (b, c) => ({ title: tx('“{title}” didn’t play', { title: c.title }), actions: ['retry'],
    detail: typeof navigator !== 'undefined' && navigator.onLine === false
      ? `${b.title} plays from archive.org over the internet. Reconnect, then press Play.`
      : 'archive.org may be down, or this network blocks it (school and work Wi-Fi often do). Try again in a minute.' }),
  radio: st => ({ title: tx('{name} didn’t play', { name: st.name }), actions: ['retry', 'page'],
    detail: onLocalhost()
      ? 'SomaFM refuses streams to pages served from localhost. It plays on the published StaticOS.'
      : 'SomaFM may be down, or this network blocks streaming radio (school and work Wi-Fi often do).' }),
};

const EXT_MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg; codecs="opus"', flac: 'audio/flac', weba: 'audio/webm' };
function canPlayExt(name) {
  const m = EXT_MIME[extOf(name).slice(1).toLowerCase()];
  return !!(m && audio && audio.canPlayType(m) !== '');
}

/* ---------------- playback ---------------- */
function unload() {
  if (!audio) return;
  audio.pause();
  if (audio.getAttribute('src')) {
    audio.removeAttribute('src');
    try { audio.load(); } catch (e) {}
  }
}

function fail(tok, err) {
  if (tok !== P.token) return;
  unload();
  P.want = false;
  P.phase = 'error';
  P.error = err;
  P.slow = false;
  clearSlow();
  stopAir();
  killGhost();
  if (P.cur?.kind === 'radio') trouble.mark(P.cur.st.id, 'failed');
  changed('state');
}

function doPlay() {
  if (!audio) return;
  const tok = P.token;
  P.want = true;
  P.note = null;
  if (P.phase !== 'playing') P.phase = 'loading';
  changed('state');
  let pr;
  try { pr = audio.play(); } catch (e) { pr = Promise.reject(e); }
  pr?.catch?.(e => {
    if (tok !== P.token || !e || e.name === 'AbortError') return;
    if (e.name === 'NotAllowedError') {
      P.want = false;
      P.phase = 'paused';
      P.note = 'The browser held the sound back until you interact with the page. Press Play to start.';
      if (P.cur?.kind === 'radio') unload();
      changed('state');
    }
    /* NotSupportedError: the element's 'error' event explains it */
  });
}

async function startFile(node, play = true) {
  if (!audio || !node) return;
  const tok = ++P.token;
  unload();
  stopAir();
  clearSlow();
  everPlayed = true;
  /* a crossfade started this song: it fades in over the one on the second element; anything else cuts that short */
  if (XF.pending) { XF.pending = false; } else endCrossfade();
  P.cur = { kind: 'file', node, path: alive(node) };
  P.ab = { a: null, b: null }; P.heard = 0; P.lastT = 0; P.counted = false;
  armAB();
  P.onAir = null; P.error = null; P.note = null; P.slow = false; P.started = false;
  P.want = play;
  P.phase = play ? 'loading' : 'paused';
  changed('track');
  if (!media.isMedia(node)) return fail(tok, ERR.nodata(node));
  let url = null;
  try { url = await media.urlOf(node); } catch (e) { url = null; }
  if (tok !== P.token) return;
  if (!url) return fail(tok, ERR.missing(node));
  audio.removeAttribute('crossorigin');
  audio.src = url;
  applySpeed();
  wantTags(node);
  fx.tryRoute();
  if (play) doPlay();
  else { try { audio.load(); } catch (e) {} }
}

function startStation(st, play = true) {
  if (!audio || !st) return;
  const tok = ++P.token;
  unload();
  clearSlow();
  everPlayed = true;
  endCrossfade();
  P.ab = { a: null, b: null };
  armAB();
  P.cur = { kind: 'radio', st };
  P.onAir = AIR.get(st.id) || null;
  P.error = null; P.note = null; P.slow = false; P.started = false;
  P.tryIx = 0;
  P.want = play;
  P.phase = play ? 'loading' : 'paused';
  if (!play) { stopAir(); changed('track'); return; }
  changed('track');
  connect(tok);
  pollAir();
}

/* an audiobook chapter: archive.org's CORS answer lets the equalizer and the visualizer read it; if a browser refuses the
   request that way it is tried once more plainly (the book still plays, just without those) */
function startBook(book, ci, at = 0, play = true) {
  const ch = book && book.chapters[ci];
  if (!audio || !ch) return;
  const tok = ++P.token;
  unload();
  stopAir();
  clearSlow();
  everPlayed = true;
  endCrossfade();
  P.cur = { kind: 'book', book, ci };
  P.ab = { a: null, b: null }; P.heard = 0; P.lastT = 0; P.counted = false;
  armAB();
  P.onAir = null; P.error = null; P.note = null; P.slow = false; P.started = false;
  P.cors = true; P.tryIx = 0; P.startAt = at > 1 ? at : 0;
  P.want = play;
  P.phase = play ? 'loading' : 'paused';
  P.from = null;
  changed('track');
  LV.remember(book, ci, P.startAt);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fail(tok, ERR.book(book, ch));
  audio.crossOrigin = 'anonymous';
  audio.src = ch.url;
  applySpeed();
  fx.tryRoute();
  if (play) { armSlow(tok); doPlay(); } else { try { audio.load(); } catch (e) {} }
}
const bookNow = () => (P.cur?.kind === 'book' ? P.cur : null);
let bookSaved = 0;
function saveBook(force) {
  const c = bookNow();
  if (!c || !audio.getAttribute('src')) return;
  const now = Date.now();
  if (!force && now - bookSaved < 5000) return;
  bookSaved = now;
  LV.remember(c.book, c.ci, audio.currentTime || 0);
}

function connect(tok) {
  const st = P.cur?.st;
  if (!st || tok !== P.token) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fail(tok, ERR.offline(st));
  const tries = radioTries();
  const [host, cors, q] = tries[P.tryIx] || tries[0];
  P.cors = cors;
  P.quality = q;
  if (cors) audio.crossOrigin = 'anonymous'; else audio.removeAttribute('crossorigin');
  audio.src = stationUrl(st, host, q);
  applySpeed();
  armSlow(tok);
  doPlay();
}

/* where a station is fetched from, in order. The plain fallback is left out while the equalizer is wired
   in: the browser would hand it silence, so a clear "didn't play" is better than a mute button. */
const radioTries = () => triesFor(streamQuality(), { plain: !fx.routed() });

/* a stream that hasn't started after 15 s gets a word of explanation */
let slowTimer = 0;
function armSlow(tok) {
  clearSlow();
  slowTimer = setTimeout(() => {
    slowTimer = 0;
    if (tok === P.token && P.want && P.phase === 'loading') { P.slow = true; changed('state'); }
  }, 15000);
}
function clearSlow() { if (slowTimer) { clearTimeout(slowTimer); slowTimer = 0; } }

function pause() {
  if (!P.cur) return;
  P.want = false;
  endCrossfade();
  if (P.cur.kind === 'radio') {
    /* live radio can't be held: stop the download and reconnect on Play */
    unload();
    P.phase = P.phase === 'error' ? 'error' : 'paused';
    P.slow = false;
    clearSlow();
    stopAir();
    changed('state');
    return;
  }
  audio.pause();
  if (P.phase === 'loading') P.phase = 'paused';
  saveBook(true);
  changed('state');
}

function resume() {
  const c = P.cur;
  if (!c) {
    const q = playableLibrary();
    if (q.length) playFrom(q, P.shuffle ? q[Math.floor(Math.random() * q.length)] : q[0]);
    return;
  }
  if (c.kind === 'radio') {
    if (P.want) return;
    startStation(c.st, true);
    return;
  }
  if (c.kind === 'book') {
    if (P.phase === 'error' || !audio.getAttribute('src')) startBook(c.book, c.ci, P.phase === 'error' ? (audio.currentTime || P.startAt || 0) : (LV.placeOf(c.book.id)?.t || 0), true);
    else doPlay();
    return;
  }
  if (P.phase === 'error' || !audio.getAttribute('src')) { startFile(c.node, true); return; }
  doPlay();
}
const toggle = () => (P.want ? pause() : resume());

function seek(s) {
  const c = P.cur;
  if (!c || (c.kind !== 'file' && c.kind !== 'book') || !Number.isFinite(Number(s))) return;
  const d = Number.isFinite(audio.duration) ? audio.duration : c.kind === 'book' ? 0 : (typeof durOf(c.node) === 'number' ? durOf(c.node) : 0);
  if (!d || !audio.getAttribute('src')) return;
  try { audio.currentTime = clamp(Number(s), 0, Math.max(0, d - 0.05)); } catch (e) { return; }
  changed('time');
}

function stationStep(dir) {
  const i = STATIONS.indexOf(P.cur.st);
  return STATIONS[(i + dir + STATIONS.length) % STATIONS.length];
}

function next(auto = false, force = false) {
  const c = P.cur;
  if (!c) { resume(); return; }
  if (c.kind === 'radio') { if (!auto) startStation(stationStep(1), P.want || force); return; }
  if (c.kind === 'book') {
    if (auto && sleepT.takeAfterSong()) {       /* "stop after this chapter" */
      P.want = false; P.phase = 'ended'; P.note = 'Sleep timer: stopped after the chapter.';
      LV.remember(c.book, Math.min(c.ci + 1, c.book.chapters.length - 1), 0);
      changed('state');
      return;
    }
    if (c.ci + 1 >= c.book.chapters.length) {
      if (!auto) { seek(0); return; }
      P.want = false; P.phase = 'ended'; P.note = 'You have reached the end of the book.';
      LV.remember(c.book, c.ci, 0, true);
      changed('state');
      return;
    }
    startBook(c.book, c.ci + 1, 0, auto || force || P.want);
    return;
  }
  if (auto && sleepT.takeAfterSong()) {       /* "stop after this song" */
    endCrossfade();
    P.want = false;
    P.phase = 'ended';
    P.note = 'Sleep timer: stopped after the song.';
    changed('state');
    return;
  }
  if (auto && P.repeat === 'one') { P.heard = 0; P.lastT = 0; P.counted = false; try { audio.currentTime = 0; } catch (e) {} doPlay(); return; }
  const keepPlaying = auto || force || P.want;
  let i = P.qi + 1;
  if (i >= P.queue.length) {
    if (auto && P.repeat === 'off') {
      P.want = false;
      P.phase = 'ended';
      changed('state');
      return;
    }
    if (P.shuffle && P.queue.length > 2) {
      /* a fresh order for the next lap, without playing the same song twice in a row */
      const last = P.queue[P.queue.length - 1];
      let order = shuffled(P.base);
      if (order[0] === last) order = [...order.slice(1), last];
      P.queue = order;
    }
    i = 0;
  }
  if (!P.queue.length) return;
  P.qi = i;
  startFile(P.queue[i], keepPlaying);
}

function prev() {
  const c = P.cur;
  if (!c) { resume(); return; }
  if (c.kind === 'radio') { startStation(stationStep(-1), P.want); return; }
  if (c.kind === 'book') {
    if ((audio.currentTime || 0) > 3 || c.ci === 0) { seek(0); return; }
    startBook(c.book, c.ci - 1, 0, P.want);
    return;
  }
  if ((audio.currentTime || 0) > 3 || P.queue.length < 2) { seek(0); return; }
  let i = P.qi - 1;
  if (i < 0) {
    if (P.repeat !== 'all') { seek(0); return; }
    i = P.queue.length - 1;
  }
  P.qi = i;
  startFile(P.queue[i], P.want);
}

/* ---------------- speed ---------------- */
function applySpeed() {
  if (!audio) return;
  const r = P.cur?.kind === 'file' || P.cur?.kind === 'book' ? fx.speed() : 1;
  audio.defaultPlaybackRate = r;
  audio.playbackRate = r;
  audio.preservesPitch = true;
  if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
}
bus.on('playerfx:change', k => { if (k === 'speed') { applySpeed(); changed('state'); } });

/* ---------------- A–B repeat ---------------- */
let abTimer = 0;
/** Press once to mark A, again for B (the part between then loops), a third time to clear. */
function abStep() {
  if (P.cur?.kind !== 'file' || !audio.getAttribute('src')) return;
  const t = audio.currentTime || 0;
  if (P.ab.a === null) P.ab = { a: t, b: null };
  else if (P.ab.b === null) {
    if (t < P.ab.a + 0.5) P.ab = { a: t, b: null };       /* too close to A: start again from here */
    else { P.ab = { a: P.ab.a, b: t }; try { audio.currentTime = P.ab.a; } catch (e) { /* not seekable yet */ } }
  } else P.ab = { a: null, b: null };
  armAB();
  changed('state');
}
function abClear() { if (P.ab.a !== null) { P.ab = { a: null, b: null }; armAB(); changed('state'); } }
function armAB() {
  const on = P.ab.b !== null && P.cur?.kind === 'file';
  if (on && !abTimer) abTimer = setInterval(abCheck, 40);
  else if (!on && abTimer) { clearInterval(abTimer); abTimer = 0; }
}
function abCheck() {
  if (P.ab.b === null || P.cur?.kind !== 'file' || audio.paused) return;
  if (audio.currentTime >= P.ab.b) { try { audio.currentTime = P.ab.a; } catch (e) { /* not seekable */ } P.lastT = P.ab.a; }
}

/* ---------------- real plays ----------------
   A song counts once it has been LISTENED to for half its length or 30 seconds, whichever is
   sooner: time actually played, so a seek or a skip adds nothing and a song you tapped past does
   not count. Kept with the playlists, under 'portal.music' › plays. */
const PLAY_MAX = 600;
function playsAll() {
  const raw = store.get(PL_KEY);
  const o = raw && typeof raw === 'object' && raw.plays && typeof raw.plays === 'object' ? raw.plays : {};
  const out = {};
  for (const [ref, v] of Object.entries(o)) {
    if (isRef(ref) && v && Number(v.n) > 0) out[ref] = { n: Math.floor(Number(v.n)), last: Number(v.last) || 0, name: String(v.name || '') };
  }
  return out;
}
function playsWrite(plays) {
  const raw = store.get(PL_KEY);
  store.set(PL_KEY, { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}), v: 1, plays });
}
function addPlay(node) {
  if (!node || !media.isMedia(node)) return;
  const all = playsAll();
  const had = all[node.content];
  all[node.content] = { n: (had?.n || 0) + 1, last: Date.now(), name: node.name };
  const keys = Object.keys(all);
  if (keys.length > PLAY_MAX) for (const k of keys.sort((a, b) => all[a].last - all[b].last).slice(0, keys.length - PLAY_MAX)) delete all[k];
  playsWrite(all);
  changed('list');
}
function clearPlays() { playsWrite({}); changed('list'); }
/** the listening so far, from the element's clock: only small forward steps are time that was played */
function countListening() {
  const c = P.cur;
  if (c?.kind !== 'file' || audio.paused) return;
  const t = audio.currentTime || 0, d = t - P.lastT;
  P.lastT = t;
  if (d > 0 && d < 1.5 * Math.max(1, audio.playbackRate)) P.heard += d;
  if (P.counted) return;
  const len = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (len > 0 && P.heard >= Math.min(30, Math.max(1, len * 0.5))) { P.counted = true; addPlay(c.node); }
}

/* ---------------- crossfade ----------------
   Near the end of a song the player puts that song on a second, short-lived element, starts the
   next one on the main element, and swaps their volumes over the time that is left. Only for song
   to song (never when the queue is about to end, repeat-one is on, or "stop after this song" is
   waiting); the radio never crossfades. */
function hasNextTrack() { return P.qi + 1 < P.queue.length || (P.repeat === 'all' && P.queue.length > 1); }
function maybeCrossfade() {
  const s = fx.crossfade();
  if (!s || XF.ghost || P.cur?.kind !== 'file' || !P.want || P.phase !== 'playing' || P.repeat === 'one') return;
  const d = audio.duration;
  if (!Number.isFinite(d) || d < s * 2.5 || P.ab.b !== null || sleepT.state()?.afterSong || !hasNextTrack()) return;
  const left = d - audio.currentTime;
  if (left > s || left < 0.4) return;
  beginCrossfade(left);
}
function beginCrossfade(left) {
  let g;
  try {
    g = new Audio();
    g.src = audio.currentSrc || audio.src;
    const at = audio.currentTime;
    g.addEventListener('loadedmetadata', () => { try { g.currentTime = at; } catch (e) { /* ignore */ } }, { once: true });
    g.playbackRate = audio.playbackRate;
    g.volume = clamp(baseVolume(), 0, 1);
    g.muted = audio.muted;
    const pr = g.play();
    pr?.catch?.(() => endCrossfade());
  } catch (e) { return; }
  XF.ghost = g;
  XF.t0 = performance.now();
  XF.ms = Math.max(300, left * 1000 / (audio.playbackRate || 1));
  XF.inMult = 0;
  XF.pending = true;
  clearInterval(XF.iv);
  XF.iv = setInterval(() => {
    const f = Math.min(1, (performance.now() - XF.t0) / XF.ms);
    XF.inMult = f;
    applyVolume();
    if (f >= 1) endCrossfade();
  }, 50);
  next(true);
}
function killGhost() {
  if (XF.ghost) { try { XF.ghost.pause(); XF.ghost.removeAttribute('src'); XF.ghost.load(); } catch (e) { /* gone */ } XF.ghost = null; }
}
function endCrossfade() {
  clearInterval(XF.iv);
  XF.iv = 0;
  killGhost();
  XF.pending = false;
  if (XF.inMult !== 1) { XF.inMult = 1; applyVolume(); }
}

/* ---------------- the queue ---------------- */
const playable = n => media.isMedia(n) && durOf(n) !== 'bad';

function sortedLibrary(sortKey = currentSort()) {
  const list = library().slice();
  const by = SORTS[sortKey] || SORTS.title;
  return list.sort(by.cmp);
}
function playableLibrary() { return sortedLibrary().map(e => e.node).filter(playable); }

function setQueue(nodes, start) {
  const list = nodes.filter(n => n === start || playable(n));
  if (start && !list.includes(start)) list.unshift(start);
  P.base = list;
  P.queue = P.shuffle && start ? [start, ...shuffled(list.filter(n => n !== start))] : list.slice();
  P.qi = Math.max(0, P.queue.indexOf(start));
}
function playFrom(nodes, start, from = null) {
  if (!start) return;
  P.from = from;
  setQueue(nodes, start);
  startFile(start, true);
}

/** Play a playlist from the top, or shuffled. Songs that have gone are skipped. */
function playPlaylist(id, shuffle = false) {
  const p = plGet(id);
  const nodes = plTracks(p).filter(t => t.e && playable(t.e.node)).map(t => t.e.node);
  if (!nodes.length) return false;
  P.shuffle = !!shuffle;
  store.set('prefs.musicShuffle', P.shuffle);
  playFrom(nodes, shuffle ? nodes[Math.floor(Math.random() * nodes.length)] : nodes[0], { pl: id });
  return true;
}

function setShuffle(on) {
  P.shuffle = !!on;
  store.set('prefs.musicShuffle', P.shuffle);
  const c = P.cur;
  if (c?.kind === 'file' && P.base.length) {
    P.queue = P.shuffle ? [c.node, ...shuffled(P.base.filter(n => n !== c.node))] : P.base.slice();
    P.qi = Math.max(0, P.queue.indexOf(c.node));
  }
  changed('queue');
}
function setRepeat(mode) {
  P.repeat = REPEATS.includes(mode) ? mode : 'off';
  store.set('prefs.musicRepeat', P.repeat);
  changed('queue');
}
const cycleRepeat = () => setRepeat(REPEATS[(REPEATS.indexOf(P.repeat) + 1) % REPEATS.length]);

function dropLater(node) {
  for (let i = P.queue.length - 1; i > P.qi; i--) if (P.queue[i] === node) P.queue.splice(i, 1);
}
function playNext(node) {
  if (P.cur?.kind !== 'file') { playFrom([node], node); return; }
  if (node === P.cur.node) return;
  dropLater(node);
  P.queue.splice(P.qi + 1, 0, node);
  P.base = P.base.filter(n => n !== node);
  P.base.splice(P.base.indexOf(P.cur.node) + 1, 0, node);
  changed('queue');
}
function addToQueue(node) {
  if (P.cur?.kind !== 'file') { P.from = null; setQueue([node], node); startFile(node, false); return; }
  if (node === P.cur.node) return;
  dropLater(node);
  P.queue.push(node);
  if (!P.base.includes(node)) P.base.push(node);
  changed('queue');
}
function dropAt(i) {
  if (i <= P.qi || i >= P.queue.length) return;
  const [n] = P.queue.splice(i, 1);
  if (!P.queue.includes(n)) P.base = P.base.filter(x => x !== n);
  changed('queue');
}
/** Move a song in Up next (both places are queue positions after the one playing). */
function queueMove(from, to) {
  if (from <= P.qi || to <= P.qi || from >= P.queue.length || to >= P.queue.length || from === to) return;
  const [n] = P.queue.splice(from, 1);
  P.queue.splice(to, 0, n);
  if (!P.shuffle) P.base = P.queue.slice();           /* in order, the queue IS the list order; shuffled, only the play order moves */
  changed('queue');
}
function clearUpNext() {
  const cur = P.cur?.kind === 'file' ? P.cur.node : null;
  P.queue = cur ? [cur] : [];
  P.base = cur ? [cur] : [];
  P.qi = cur ? 0 : -1;
  changed('queue');
}

/* ---------------- files changing under us ---------------- */
let reconcileQueued = false;
let libSig = '';
function reconcile() {
  reconcileQueued = false;
  libCache = null;
  const sig = library().map(e => `${e.path}|${e.node.size}|${e.node.content}`).join('\n');
  const libChanged = sig !== libSig;
  libSig = sig;
  const live = liveMap();
  const c = P.cur;
  if (c?.kind === 'file') {
    const p = live.get(c.node);
    if (p) c.path = p;
    else {
      /* the song went to the Trash (or was deleted): move on to the next one */
      const keep = P.want;
      const at = P.queue.indexOf(c.node);
      P.queue = P.queue.filter(n => n !== c.node && live.has(n));
      P.base = P.base.filter(n => n !== c.node && live.has(n));
      if (P.queue.length) {
        P.qi = clamp(at, 0, P.queue.length - 1);
        startFile(P.queue[P.qi], keep);
      } else {
        P.token++;
        unload();
        P.cur = null; P.qi = -1; P.want = false; P.phase = 'idle'; P.error = null; P.from = null;
        changed('track');
      }
      changed('list');
      return;
    }
  }
  const cur = c?.kind === 'file' ? c.node : null;
  const before = P.queue.length;
  P.queue = P.queue.filter(n => n === cur || live.has(n));
  P.base = P.base.filter(n => n === cur || live.has(n));
  P.qi = cur ? P.queue.indexOf(cur) : -1;
  if (libChanged || before !== P.queue.length) changed('list');
  const name = c?.kind === 'file' ? `${c.path}|${c.node.name}` : '';
  if (name !== lastName) { lastName = name; emitTrack(); }
}
let lastName = '';
bus.on('fs:change', () => {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
});

/* ---------------- the element's own events ---------------- */
let lastSec = -1;
let stallTimer = 0;
if (audio) {
  audio.addEventListener('playing', () => {
    clearTimeout(stallTimer);
    P.phase = 'playing';
    P.want = true;
    P.started = true;
    P.slow = false;
    P.error = null;
    clearSlow();
    if (P.cur?.kind === 'radio') trouble.ok(P.cur.st.id);
    claimSession();
    changed('state');
  });
  audio.addEventListener('pause', () => {
    if (P.want && P.phase === 'loading') return;       /* the load algorithm's own pause while switching */
    if (audio.ended || P.phase === 'error' || P.phase === 'ended') return;
    P.want = false;
    if (P.phase !== 'idle') P.phase = 'paused';
    changed('state');
  });
  /* live streams stall for a moment now and then; only a stall that lasts
     says "Buffering" (a flicker of it would be noise, not information) */
  audio.addEventListener('waiting', () => {
    if (!(P.want && P.phase === 'playing')) return;
    clearTimeout(stallTimer);
    const tok = P.token;
    stallTimer = setTimeout(() => {
      if (tok === P.token && P.want && P.phase === 'playing' && audio.readyState < 3) { P.phase = 'loading'; changed('state'); }
    }, 1200);
  });
  audio.addEventListener('ended', () => {
    if (P.cur?.kind === 'radio') { onErr(); return; }   /* a live stream that "ends" dropped */
    next(true);
  });
  audio.addEventListener('error', onErr);
  const noteDur = () => {
    const c = P.cur;
    if (c?.kind === 'file' && Number.isFinite(audio.duration) && media.isMedia(c.node)) {
      const had = DUR.get(c.node.content);
      DUR.set(c.node.content, audio.duration);
      if (had !== audio.duration) changed('list');
      emitTrack();
    }
  };
  audio.addEventListener('loadedmetadata', () => {
    noteDur();
    if (P.cur?.kind === 'book' && P.startAt) {          /* a book comes back to where it was left */
      try { audio.currentTime = Math.min(P.startAt, Math.max(0, (audio.duration || P.startAt) - 1)); } catch (e) { /* not seekable yet */ }
      P.startAt = 0;
    }
  });
  audio.addEventListener('durationchange', noteDur);
  audio.addEventListener('timeupdate', () => {
    /* time moving is proof of sound, even if a 'playing' after a stall is late */
    if (P.phase === 'loading' && P.want && !audio.paused && audio.readyState >= 3) { P.phase = 'playing'; changed('state'); }
    countListening();
    maybeCrossfade();
    saveBook(false);
    const s = Math.floor(audio.currentTime || 0);
    if (s !== lastSec) { lastSec = s; emitTrack(); }
    subs.forEach(fn => { try { fn('time'); } catch (e) { console.error('[music]', e); } });
  });
}

function onErr() {
  const c = P.cur;
  if (!c || !audio.getAttribute('src')) return;
  const code = audio.error ? audio.error.code : 0;
  if (code === 1) return;                                 /* aborted: we changed the source */
  const tok = P.token;
  if (c.kind === 'radio') {
    if (P.tryIx < radioTries().length - 1 && navigator.onLine !== false) { P.tryIx++; connect(tok); return; }
    fail(tok, navigator.onLine === false ? ERR.offline(c.st) : ERR.radio(c.st));
    return;
  }
  if (c.kind === 'book') {
    if (P.cors && P.tryIx === 0 && navigator.onLine !== false) {       /* once more without asking for CORS */
      P.tryIx = 1; P.cors = false;
      const at = audio.currentTime || P.startAt || 0;
      audio.removeAttribute('crossorigin');
      audio.src = c.book.chapters[c.ci].url;
      P.startAt = at;
      applySpeed();
      if (P.want) doPlay();
      return;
    }
    fail(tok, ERR.book(c.book, c.book.chapters[c.ci]));
    return;
  }
  if (media.isMedia(c.node) && (code === 4 || code === 3)) { DUR.set(c.node.content, 'bad'); changed('list'); }
  fail(tok, code === 3 ? ERR.decode(c.node) : ERR.format(c.node));
}

/* ---------------- SomaFM: what's on air, who's listening ---------------- */
const AIR = new Map();            /* station id -> { title, artist, album, at } */
let airTimer = 0;
function stopAir() { if (airTimer) { clearTimeout(airTimer); airTimer = 0; } }
async function pollAir() {
  stopAir();
  const c = P.cur;
  if (!c || c.kind !== 'radio' || !P.want) return;
  try {
    const j = await getJSON(`${SOMA_API}/songs/${c.st.id}.json`);
    const s = j?.songs?.[0];
    if (s && s.title) {
      const air = { title: String(s.title), artist: String(s.artist || ''), album: String(s.album || ''), at: Number(s.date) * 1000 || 0 };
      AIR.set(c.st.id, air);
      if (P.cur === c) { P.onAir = air; changed('state'); }
    }
  } catch (e) { /* the song title is a nicety; the stream plays without it */ }
  if (P.cur === c && P.want) airTimer = setTimeout(pollAir, 30000);
}

const CH = { map: null, at: 0, busy: false, err: null, errAt: 0 };
async function loadChannels(force = false) {
  const now = Date.now();
  if (CH.busy) return;
  if (!force && CH.map && now - CH.at < 120000) return;
  if (!force && CH.err && now - CH.errAt < 60000) return;        /* a failure waits a minute before asking again */
  CH.busy = true;
  try {
    const j = await getJSON(`${SOMA_API}/channels.json`);
    const m = new Map();
    for (const c of j?.channels || []) m.set(c.id, { listeners: Number(c.listeners) || 0, last: String(c.lastPlaying || '') });
    CH.map = m;
    CH.at = Date.now();
    CH.err = null;
  } catch (e) {
    CH.err = navigator.onLine === false ? 'offline' : 'unreachable';
    CH.errAt = Date.now();
  }
  CH.busy = false;
  changed('radio');
}

/* ---------------- the rest of the OS drives it here ---------------- */
bus.on('media:play', () => resume());
bus.on('media:pause', () => pause());
bus.on('media:next', () => next());
bus.on('media:prev', () => prev());
bus.on('media:seek', s => seek(Number(s)));

/* This module only loads when something needs it (js/core/apploader.js).
   A play/next/prev sent before then — the desktop widget, Staticum, an
   automation — loads it and is handed over here, since the listeners
   above did not exist yet when it was sent. */
/** What the player is doing, for tests and for anything that wants to look (no side effects). */
export function debugState() {
  return {
    cur: P.cur ? (P.cur.kind === 'file' ? P.cur.node.name : P.cur.kind === 'book' ? `${P.cur.book.id}#${P.cur.ci}` : P.cur.st.id) : null, kind: P.cur?.kind || null, phase: P.phase, want: P.want,
    qi: P.qi, queue: P.queue.map(n => n.name), ghost: !!XF.ghost, fadeIn: XF.inMult, ab: { ...P.ab }, heard: P.heard, counted: P.counted,
    rate: audio ? audio.playbackRate : 1, volume: audio ? audio.volume : 1, quality: P.quality || null, src: audio ? audio.getAttribute('src') : null,
    time: audio ? audio.currentTime : 0, sleep: sleepT.state(),
  };
}
/** Start an audiobook chapter (the Audiobooks page calls this; so can a test). */
export function playBook(book, ci = 0, at = 0) { startBook(book, ci, at, true); }
export function wake(evt) {
  if (evt === 'media:play') resume();
  else if (evt === 'media:next') next();
  else if (evt === 'media:prev') prev();
}

/* ---------------- sorting ---------------- */
const SORTS = {
  title: { label: 'Title', cmp: (a, b) => coll.compare(a.title, b.title) || coll.compare(a.artist, b.artist) },
  artist: { label: tx('Artist'), cmp: (a, b) => coll.compare(a.artist || '￿', b.artist || '￿') || coll.compare(a.title, b.title) },
  added: { label: tx('Recently added'), cmp: (a, b) => new Date(b.node.mtime) - new Date(a.node.mtime) },
  length: { label: tx('Length'), cmp: (a, b) => {
    const x = durOf(a.node), y = durOf(b.node);
    return (typeof x === 'number' ? x : 1e9) - (typeof y === 'number' ? y : 1e9) || coll.compare(a.title, b.title);
  } },
};
const currentSort = () => (SORTS[store.get('prefs.musicSort')] ? store.get('prefs.musicSort') : 'title');

/* formats this browser says it can play — real, from canPlayType */
function playableFormats() {
  if (!audio) return [];
  const t = [['MP3', 'audio/mpeg'], ['M4A / AAC', 'audio/mp4; codecs="mp4a.40.2"'], ['WAV', 'audio/wav'],
    ['OGG', 'audio/ogg; codecs="vorbis"'], ['Opus', 'audio/ogg; codecs="opus"'], ['FLAC', 'audio/flac']];
  return t.filter(([, m]) => audio.canPlayType(m) !== '').map(([n]) => n);
}

/** The lyrics file that sits beside a song: Song.lrc (synced) first, then Song.txt. Only the person's own file. */
function findLyrics(node, path) {
  if (!node || !path) return null;
  const dir = vfs.parentPath(path);
  for (const name of siblingNames(node.name)) {
    const n = vfs.node(`${dir}/${name}`);
    if (n && n.type === 'file' && typeof n.content === 'string' && !media.isMedia(n)) {
      return { name, path: `${dir}/${name}`, text: n.content, lrc: /\.lrc$/i.test(name) };
    }
  }
  return null;
}

/** Anything the browser can't play, named by what it is (for the list of what an import skipped). */
const CANT_PLAY = new Set(['aif', 'aiff', 'aifc', 'wma', 'ape', 'wv', 'mid', 'midi', 'amr', 'm4p', 'ra', 'ac3', 'dts', 'mka', 'alac', 'dsf', 'dff']);
function whyNotSong(name, type) {
  const ext = extOf(name).slice(1).toLowerCase();
  if (/^(\.ds_store|thumbs\.db|desktop\.ini)$/i.test(name) || name.startsWith('._')) return 'a system file';
  if (CANT_PLAY.has(ext)) return `${ext.toUpperCase()} isn’t a format this browser can play`;
  const k = media.kindOf(type) || media.kindOf(name);
  if (k === 'image') return 'a picture, not a song';
  if (k === 'video') return 'a video, not a song';
  return 'not an audio file';
}
/** Path segments that are safe to make folders from. */
const cleanSeg = seg => String(seg).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();

defineApp({
  id: 'music',
  name: 'Music',
  icon: 'music',
  g1: '#ff8fa3', g2: '#bd1240',
  category: 'Media',
  keywords: ['player', 'audio', 'songs', 'radio', 'somafm', 'import', 'mp3', 'now playing', 'playlist', 'playlists', 'shuffle',
    'ambient', 'rain', 'fireplace', 'white noise', 'brown noise', 'sleep sounds', 'sleep timer'],
  desc: 'Play your songs and live radio',
  pinned: true, dock: true, singleton: true,
  handles: ['audio'],
  win: { w: 840, h: 610, minW: 460, minH: 400 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Space / K', 'Play or pause'],
    ['N / P', 'Next / previous song'],
    ['Left / Right', 'Back / forward 5 seconds (your own songs)'],
    ['M', 'Mute'],
    ['/', 'Search songs'],
    ['L', 'A–B loop: mark A, then B, then clear'],
    [', / .', 'Slower / faster'],
    ['C', 'Copy the song name'],
    ['H', 'Keep the song on the radio'],
    ['Z', 'Mini player'],
    ['I / ?', 'This list of keys'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon } = api;
    const clearEl = el => { el.replaceChildren(); return el; };      /* replaceChildren never throws when a blur handler repaints mid-removal */

    const S = {
      view: 'songs',
      filter: '', renaming: null, renameErr: '', scrub: null, drag: 0, busy: '', flash: null,
      mini: false, keep: null, keys: false,    /* mini player: the window as it was, and the shortcut sheet */
      report: null,            /* { title, lines:[{ name, why }] } what an import or an .m3u skipped, and why */
      plRenaming: null,        /* the playlist whose name is being edited */
      plDrag: null,            /* a track being dragged to a new place */
    };
    const disposers = [];
    const pendingUrls = new Set();
    let dead = false;
    const defKeys = [
      ['Space / K', 'Play or pause'], ['N / P', 'Next / previous song'], ['← / →', 'Back / forward 5 seconds'], ['M', 'Mute'],
      ['/', 'Search songs, albums and lyrics'], ['L', 'A–B loop: mark A, then B, then clear'], [', / .', 'Slower / faster'],
      ['C', 'Copy the song name'], ['H', 'Keep the song on the radio'], ['Z', 'Mini player'], ['I or ?', 'This list'],
    ];

    /* ---------------- title bar ---------------- */
    const fileIn = h('input.mu-file', { type: 'file', accept: ACCEPT, multiple: true, tabindex: '-1', 'aria-hidden': 'true',
      onchange: e => { const f = e.target.files; importAudio(f).finally(() => { e.target.value = ''; }); } });
    const pickFiles = () => fileIn.click();
    /* a whole folder: every file under it comes with its path, so its sub-folders are kept */
    const folderIn = h('input.mu-file', { type: 'file', multiple: true, tabindex: '-1', 'aria-hidden': 'true', dataset: { role: 'folder-in' },
      onchange: e => { const f = [...e.target.files].map(file => ({ file, rel: file.webkitRelativePath || file.name })); importItems(f).finally(() => { e.target.value = ''; }); } });
    folderIn.setAttribute('webkitdirectory', '');
    const pickFolder = () => folderIn.click();
    const lyricIn = h('input.mu-file', { type: 'file', accept: '.lrc,.txt', tabindex: '-1', 'aria-hidden': 'true', dataset: { role: 'lyric-in' },
      onchange: e => { const f = e.target.files[0]; addLyricsFile(f).finally(() => { e.target.value = ''; }); } });
    const m3uIn = h('input.mu-file', { type: 'file', accept: '.m3u,.m3u8,audio/x-mpegurl,audio/mpegurl', tabindex: '-1', 'aria-hidden': 'true', dataset: { role: 'm3u-in' },
      onchange: e => { const f = e.target.files[0]; importM3u(f).finally(() => { e.target.value = ''; }); } });
    win.setTools(
      h('button.ibtn.tip.tip--below', { 'data-tip': tx('Import songs'), 'aria-label': tx('Import songs from your computer'), onclick: pickFiles },
        icon('upload')),
      h('button.ibtn.tip.tip--below', { 'data-tip': tx('More'), 'aria-label': tx('More options'), 'aria-haspopup': 'menu', onclick: moreMenu },
        icon('more-horizontal')),
    );

    /* ---------------- layout ---------------- */
    const side = h('nav.app__side.mu-side', { 'aria-label': tx('Music') });
    const tabs = h('nav.mu-tabs', { 'aria-label': tx('Music sections') });
    const hero = h('section.mu-hero', { 'aria-label': tx('Now playing') });
    const content = h('div.app__content.app__content--flush.mu-content');
    const listBox = h('div.mu-listbox');
    const searchIn = h('input', { type: 'search', placeholder: tx('Search songs, albums, lyrics'), 'aria-label': tx('Search your music by title, artist, album or lyrics'), spellcheck: 'false',
      oninput: ev => { S.filter = ev.target.value; paintList(); paintFoot(); } });
    const sortBtn = h('button.btn.btn--sm.mu-sort', { 'aria-haspopup': 'menu', onclick: e => sortMenu(e) });
    const shufBtn = h('button.btn.btn--sm', { onclick: () => shuffleAll(filtered()) }, icon('shuffle'), h('span', { text: tx('Shuffle') }));
    const toolsBox = h('div.mu-tools', h('label.field.mu-search', icon('search'), searchIn), sortBtn, shufBtn);
    content.append(toolsBox, listBox);
    const foot = h('div.app__bar.app__bar--foot.mu-foot', { role: 'status', 'aria-live': 'polite' });
    const drop = h('div.mu-drop', { 'aria-hidden': 'true' },
      h('div.mu-drop__card', icon('upload'), h('b', { text: tx('Drop to add to Your music') }),
        h('small', { text: tx('Audio files are copied into ~/Music and stay in this browser.') })));
    const shell = h('div.app.mu', side, h('div.app__main.mu-main', tabs, hero, content, foot), drop, fileIn, folderIn, lyricIn, m3uIn);
    root.appendChild(shell);

    /* ---------------- the hero: now playing ---------------- */
    const vis = h('canvas.mu-vis', { 'aria-hidden': 'true' });
    const art = h('div.mu-art');
    const eyebrow = h('div.mu-eyebrow');
    const tTitle = h('h2.mu-title');
    const tSub = h('div.mu-sub');
    const seekFill = h('i.mu-seek__fill');
    const seekKnob = h('b.mu-seek__knob');
    const seekAB = h('i.mu-seek__ab', { 'aria-hidden': 'true' });
    const seekEl = h('div.mu-seek', { role: 'slider', tabindex: '0', 'aria-label': tx('Position in song'),
      'aria-valuemin': '0', 'aria-valuemax': '0', 'aria-valuenow': '0' },
      h('div.mu-seek__rail', seekAB, seekFill, seekKnob));
    const tCur = h('span.mu-time');
    const tTot = h('span.mu-time.mu-time--r');
    const seekRow = h('div.mu-seekrow', tCur, seekEl, tTot);
    const liveTime = h('span.mu-live__t');
    const liveLink = h('a.mu-live__link', { target: '_blank', rel: 'noopener noreferrer' });
    const liveRow = h('div.mu-liverow', h('span.mu-live', h('i'), 'LIVE'), liveTime, liveLink);

    const btnShuf = h('button.ibtn.mu-ctl.tip', { 'aria-label': tx('Shuffle'), onclick: () => setShuffle(!P.shuffle) }, icon('shuffle'));
    const btnPrev = h('button.ibtn.mu-ctl.tip', { 'data-tip': tx('Previous (P)'), 'aria-label': tx('Previous'), onclick: () => prev() }, icon('skip-back'));
    const btnPlay = h('button.mu-play.tip', { onclick: () => toggle() });
    const btnNext = h('button.ibtn.mu-ctl.tip', { 'data-tip': tx('Next (N)'), 'aria-label': tx('Next'), onclick: () => next() }, icon('skip-forward'));
    const btnRep = h('button.ibtn.mu-ctl.tip', { onclick: cycleRepeat }, icon('repeat'), h('span.mu-rep1', { text: '1' }));
    const btnMute = h('button.ibtn.tip', { onclick: () => store.set('prefs.muted', store.get('prefs.muted') !== true) });
    const volEl = h('input.slider.mu-vol', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': tx('Volume (all of StaticOS)'),
      oninput: e => {
        store.set('prefs.volume', Number(e.target.value));
        if (Number(e.target.value) > 0 && store.get('prefs.muted') === true) store.set('prefs.muted', false);
        paintVol();
      } });
    const status = h('div.mu-status');
    const alertBox = h('div.mu-alert', { role: 'alert' });
    /* what you can do to the sound of what is playing: loop a part, speed, sleep timer, copy the name, mini player */
    const abBtn = h('button.btn.btn--sm.mu-fx', { type: 'button', dataset: { role: 'ab' }, onclick: abStep }, icon('repeat'), h('span'));
    const speedBtn = h('button.btn.btn--sm.mu-fx', { type: 'button', dataset: { role: 'speed' }, 'aria-haspopup': 'menu', onclick: e => speedMenu(e) }, icon('gauge'), h('span'));
    const sleepBtn = h('button.btn.btn--sm.mu-fx', { type: 'button', dataset: { role: 'sleep' }, 'aria-haspopup': 'menu', onclick: e => sleepMenu(e) }, icon('moon'), h('span'));
    const copyBtn = h('button.btn.btn--sm.mu-fx', { type: 'button', dataset: { role: 'copysong' }, onclick: () => copySong() }, icon('copy'), h('span', { text: tx('Copy song name') }));
    const heartBtn = h('button.btn.btn--sm.mu-fx', { type: 'button', dataset: { role: 'heartsong' }, onclick: () => heartSong() }, icon('heart'), h('span'));
    const miniBtn = h('button.ibtn.tip', { type: 'button', dataset: { role: 'mini' }, onclick: () => setMini(!S.mini) }, icon('minimize-2'));
    const fxRow = h('div.mu-fxrow', abBtn, speedBtn, sleepBtn, copyBtn, heartBtn, h('div.grow'), miniBtn);

    hero.append(
      vis,
      h('div.mu-hero__top', art,
        h('div.mu-hero__meta', eyebrow, tTitle, tSub, status)),
      h('div.mu-hero__bar', seekRow, liveRow, fxRow),
      h('div.mu-hero__ctl',
        h('div.mu-ctls', btnShuf, btnPrev, btnPlay, btnNext, btnRep),
        h('div.mu-volrow', btnMute, volEl)),
      alertBox);

    /* seek: pointer drag + keys (arrows 5 s, PageUp/Down 30 s, Home/End) */
    const curDur = () => {
      const c = P.cur;
      if (c?.kind === 'book') return Number.isFinite(audio.duration) ? audio.duration : (c.book.chapters[c.ci].len || 0);
      if (c?.kind !== 'file') return 0;
      if (Number.isFinite(audio.duration)) return audio.duration;
      const d = durOf(c.node);
      return typeof d === 'number' ? d : 0;
    };
    const fracAt = e => { const r = seekEl.getBoundingClientRect(); return clamp((e.clientX - r.left) / (r.width || 1), 0, 1); };
    seekEl.addEventListener('pointerdown', e => {
      if (!curDur() || e.button > 0) return;
      e.preventDefault();
      seekEl.focus({ preventScroll: true });
      try { seekEl.setPointerCapture(e.pointerId); } catch (err) {}
      S.scrub = fracAt(e);
      seekEl.classList.add('is-drag');
      paintTime();
    });
    seekEl.addEventListener('pointermove', e => { if (S.scrub !== null) { S.scrub = fracAt(e); paintTime(); } });
    const endScrub = e => {
      if (S.scrub === null) return;
      const f = e.type === 'pointercancel' ? null : S.scrub;
      S.scrub = null;
      seekEl.classList.remove('is-drag');
      if (f !== null) seek(f * curDur());
      paintTime();
    };
    seekEl.addEventListener('pointerup', endScrub);
    seekEl.addEventListener('pointercancel', endScrub);
    seekEl.addEventListener('keydown', e => {
      const d = curDur();
      if (!d) return;
      const t = audio.currentTime || 0;
      const to = { ArrowRight: t + 5, ArrowUp: t + 5, ArrowLeft: t - 5, ArrowDown: t - 5,
        PageUp: t + 30, PageDown: t - 30, Home: 0, End: d - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      seek(to);
    });

    /* ---------------- the spectrum (real, from the audio) ----------------
       captureStream() taps the element without re-routing its sound, so
       the analyser can't silence or double the music. The capture, its
       AudioContext and the analyser are the player's one shared reader
       (core/audiotap.js) — the wallpaper's visualizer draws from the same
       one, because Chrome feeds only the newer of two captures of one
       element. This window holds it while open; the last user out closes
       the context. Browsers without captureStream (Safari, Firefox)
       simply don't draw one. */
    const V = { reader: null, data: null, rgb: '255 69 109', off: false, sized: '' };
    const visWanted = () => !V.off && !reduced() && !!audio && tap.canTap();
    function visAttach() {
      if (!visWanted()) return false;
      if (P.cur?.kind === 'radio' && !P.cors) return false;   /* no CORS: the browser won't let us look */
      const src = tap.source('music');
      if (!src) return false;
      try {
        if (!V.reader) V.reader = tap.use(src, 'music-window');
        if (tap.pull(V.reader) !== 'ok') return false;
        if (!V.data || V.data.length !== V.reader.an.frequencyBinCount) V.data = new Uint8Array(V.reader.an.frequencyBinCount);
        return true;
      } catch (e) {
        V.off = true;                                       /* don't keep trying on a browser that refuses */
        return false;
      }
    }
    function visClear() {
      const g = vis.getContext('2d');
      g && g.clearRect(0, 0, vis.width, vis.height);
      hero.classList.remove('has-vis');
    }
    function drawVis() {
      if (!soundOn() || P.phase !== 'playing' || win.min || !visAttach()) { visClear(); return; }
      const w = vis.clientWidth, hh = vis.clientHeight;
      if (!w || !hh) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = `${w}x${hh}x${dpr}`;
      if (size !== V.sized) { V.sized = size; vis.width = Math.round(w * dpr); vis.height = Math.round(hh * dpr); }
      const g = vis.getContext('2d');
      V.reader.an.getByteFrequencyData(V.data);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, hh);
      const bins = V.data.length * 0.72;
      const step = 7, bw = 4;
      const n = Math.floor(w / step);
      let peak = 0;
      for (let i = 0; i < n; i++) {
        const b = Math.min(V.data.length - 1, Math.floor(Math.pow(i / n, 1.7) * bins) + 1);
        const v = V.data[b] / 255;
        if (v > peak) peak = v;
        const bh = Math.max(1.5, v * hh);
        g.fillStyle = `rgb(${V.rgb} / ${(0.08 + v * 0.36).toFixed(3)})`;
        g.fillRect(i * step, hh - bh, bw, bh);
      }
      hero.classList.toggle('has-vis', peak > 0);
    }
    const readAccent = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
      if (v) V.rgb = v.replace(/,/g, ' ');
    };

    let raf = 0;
    function frame() {
      raf = 0;
      if (dead) return;
      if (S.scrub === null) paintTime();
      drawVis();
      if (soundOn() && P.phase === 'playing') raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };

    /* ---------------- paint: hero ---------------- */
    function setArt(c) {
      const cv = c?.kind === 'file' ? coverOf(c.node) : null;
      const want = c?.kind === 'radio' ? `r:${c.st.id}` : c?.kind === 'book' ? `b:${c.book.id}` : c ? `file:${cv ? cv.url : ''}` : 'none';
      if (art.dataset.k === want) return;
      art.dataset.k = want;
      clearEl(art);
      if (c?.kind === 'book') {
        art.appendChild(h('img', { src: c.book.cover, alt: tx('Cover of {title}', { title: c.book.title }), decoding: 'async', dataset: { role: 'cover' },
          onerror: () => { clearEl(art); art.appendChild(icon('mic')); } }));
      } else if (c?.kind === 'radio') {
        const img = h('img', { src: c.st.logo, alt: tx('{name} logo', { name: c.st.name }), decoding: 'async',
          onerror: () => { clearEl(art); art.appendChild(icon('cast')); } });
        art.appendChild(img);
      } else if (cv) {
        /* the cover is in the song's own file */
        art.appendChild(h('img', { src: cv.url, alt: `Cover art for ${describe(c.node).title}`, decoding: 'async', dataset: { role: 'cover' },
          onerror: () => { clearEl(art); art.appendChild(icon('music')); } }));
      } else art.appendChild(icon(c ? 'music' : 'list-music'));
    }

    function paintHero() {
      const c = P.cur;
      const t = trackInfo();
      readAccent();
      const radio = c?.kind === 'radio';
      hero.classList.toggle('is-empty', !c);
      hero.classList.toggle('is-radio', radio);
      hero.classList.toggle('is-playing', soundOn() && P.phase === 'playing');
      setArt(c);

      if (!c) {
        eyebrow.textContent = 'Nothing playing';
        tTitle.textContent = library().length ? 'Pick a song to play' : 'Your music is empty';
        tSub.textContent = library().length
          ? 'Or tune in to live radio from SomaFM.'
          : 'Import songs from your computer, or tune in to live radio.';
      } else if (radio) {
        eyebrow.textContent = `Live radio · ${c.st.name}`;
        tTitle.textContent = P.onAir?.title || c.st.name;
        tSub.textContent = P.onAir
          ? [P.onAir.artist, P.onAir.album].filter(Boolean).join(' · ') + ' · on air, per SomaFM'
          : c.st.blurb;
      } else if (c.kind === 'book') {
        eyebrow.textContent = `Audiobook · chapter ${c.ci + 1} of ${c.book.chapters.length}`;
        tTitle.textContent = t.title;
        tSub.textContent = [c.book.title, c.book.author, 'LibriVox'].filter(Boolean).join(' · ');
      } else {
        const pl = P.from?.pl ? plGet(P.from.pl) : null;
        eyebrow.textContent = pl ? `Playlist · ${pl.name}`
          : folderLabel(c.path) === 'Your music' ? 'Your music' : `From ${folderLabel(c.path)}`;
        tTitle.textContent = t.title;
        tSub.textContent = [t.artist, `${fmtTag(c.node.name)} · ${bytes(c.node.size)}`].join(' · ');
      }

      /* status line: what the player is doing right now */
      let st = '';
      if (c && P.phase === 'loading' && P.want) {
        st = P.started ? (radio ? 'Buffering — the connection to SomaFM is slow right now.' : 'Buffering…')
          : radio ? (P.slow ? 'Still connecting — SomaFM is slow to answer, or this network is blocking streams.' : 'Connecting to SomaFM…')
            : 'Loading…';
      } else if (P.phase === 'ended') st = c?.kind === 'book' ? 'The book is finished.' : 'Reached the end of the queue.';
      else if (P.note) st = P.note;
      status.textContent = st;
      status.classList.toggle('is-on', !!st);

      /* seek row vs. live row */
      seekRow.classList.toggle('hidden', radio);
      liveRow.classList.toggle('hidden', !radio);
      if (radio) {
        liveLink.textContent = '';
        liveLink.append(`somafm.com/${c.st.id}`, icon('external-link'));
        liveLink.href = c.st.page;
        liveLink.setAttribute('aria-label', `${c.st.name} on somafm.com (opens a new tab)`);
      }
      seekEl.setAttribute('aria-disabled', String(!curDur()));
      seekEl.tabIndex = curDur() ? 0 : -1;

      /* controls */
      const on = soundOn();
      clearEl(btnPlay).appendChild(icon(on ? (radio ? 'square' : 'pause') : 'play', { fill: true }));
      btnPlay.classList.toggle('is-stop', on && radio);
      const playLabel = on ? (radio ? 'Stop' : 'Pause') : 'Play';
      btnPlay.setAttribute('aria-label', playLabel);
      btnPlay.dataset.tip = `${playLabel} (Space)`;
      btnPlay.classList.toggle('is-busy', P.want && P.phase === 'loading');
      btnPlay.disabled = !c && !playableLibrary().length;
      btnPrev.disabled = !c && !library().length;
      btnNext.disabled = !c && !library().length;
      const book = c?.kind === 'book';
      btnPrev.dataset.tip = radio ? 'Previous station (P)' : book ? 'Previous chapter (P)' : 'Previous (P)';
      btnNext.dataset.tip = radio ? 'Next station (N)' : book ? 'Next chapter (N)' : 'Next (N)';
      btnPrev.setAttribute('aria-label', radio ? 'Previous station' : book ? 'Previous chapter' : 'Previous song');
      btnNext.setAttribute('aria-label', radio ? 'Next station' : book ? 'Next chapter' : 'Next song');
      btnShuf.disabled = radio || book;
      btnRep.disabled = radio || book;
      btnShuf.classList.toggle('is-on', P.shuffle && !radio && !book);
      btnShuf.setAttribute('aria-pressed', String(P.shuffle));
      btnShuf.dataset.tip = radio ? 'Shuffle (not for live radio)' : P.shuffle ? 'Shuffle: on' : 'Shuffle: off';
      btnRep.classList.toggle('is-on', P.repeat !== 'off' && !radio && !book);
      btnRep.classList.toggle('is-one', P.repeat === 'one');
      const repTxt = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this song' }[P.repeat];
      btnRep.dataset.tip = radio ? 'Repeat (not for live radio)' : repTxt;
      btnRep.setAttribute('aria-label', repTxt);

      /* errors */
      clearEl(alertBox);
      alertBox.classList.toggle('is-on', !!P.error);
      if (P.error) {
        const e = P.error;
        const acts = [];
        if (e.actions.includes('retry')) acts.push(h('button.btn.btn--sm', { onclick: () => resume() }, icon('refresh'), tx('Try again')));
        if (e.actions.includes('page') && radio) acts.push(h('a.btn.btn--sm', { href: c.st.page, target: '_blank', rel: 'noopener noreferrer' }, tx('Station page'), icon('external-link')));
        if (e.actions.includes('next') && P.queue.length > 1) acts.push(h('button.btn.btn--sm', { onclick: () => next(false, true) }, icon('skip-forward'), tx('Play the next song')));
        if (e.actions.includes('trash') && c?.kind === 'file' && alive(c.node)) acts.push(h('button.btn.btn--sm', { onclick: () => trash(c.node) }, icon('trash'), tx('Move to Trash')));
        if (e.actions.includes('import')) acts.push(h('button.btn.btn--sm', { onclick: pickFiles }, icon('upload'), tx('Import songs')));
        alertBox.append(icon('alert'), h('div.grow', h('b', { text: e.title }), h('p', { text: e.detail })),
          acts.length ? h('div.mu-alert__acts', acts) : null);
      }

      win.setSubtitle(c && on ? `${t.title}${t.artist && !radio ? ` — ${t.artist}` : ''}` : c ? (radio ? 'Stopped' : 'Paused') : '');
      paintFx();
      paintTime();
      if (on) kick(); else visClear();
    }

    function paintTime() {
      const c = P.cur;
      if (c?.kind === 'radio') {
        const Q = qualityInfo(P.quality || streamQuality());
        const fell = P.started && streamQuality() !== (P.quality || streamQuality());
        const q = fell ? `${Q.detail} (the ${qualityInfo(streamQuality()).detail} stream wouldn’t play here)` : Q.detail;
        liveTime.textContent = soundOn() && P.phase === 'playing'
          ? `Listening ${dur(audio.currentTime || 0)} · ${q}`
          : `${q} stream`;
        return;
      }
      const d = curDur();
      const t = S.scrub !== null ? S.scrub * d : (c && audio.getAttribute('src') ? audio.currentTime || 0 : 0);
      const f = d ? clamp(t / d, 0, 1) : 0;
      const pct = `${(f * 100).toFixed(2)}%`;
      seekFill.style.width = pct;
      seekKnob.style.left = pct;
      if (d && P.ab.a !== null) {
        const a = clamp(P.ab.a / d, 0, 1), b = P.ab.b === null ? a : clamp(P.ab.b / d, 0, 1);
        seekAB.style.left = `${(a * 100).toFixed(2)}%`;
        seekAB.style.width = P.ab.b === null ? '2px' : `${((b - a) * 100).toFixed(2)}%`;
        seekAB.classList.add('is-on');
      } else seekAB.classList.remove('is-on');
      tCur.textContent = c ? dur(t) : '0:00';
      tTot.textContent = c && d ? dur(d) : c && c.kind !== 'book' && typeof durOf(c.node) !== 'number' && P.phase !== 'error' ? '…' : c?.kind === 'book' && P.phase !== 'error' ? '…' : '—';
      seekEl.setAttribute('aria-valuemax', String(Math.round(d)));
      seekEl.setAttribute('aria-valuenow', String(Math.round(t)));
      seekEl.setAttribute('aria-valuetext', d ? `${dur(t)} of ${dur(d)}` : 'No song loaded');
    }

    function paintVol() {
      const v = clamp(Number(store.get('prefs.volume', 62)) || 0, 0, 100);
      const muted = store.get('prefs.muted', false) === true;
      if (document.activeElement !== volEl) volEl.value = String(v);
      volEl.style.setProperty('--v', `${muted ? 0 : v}%`);
      clearEl(btnMute).appendChild(icon(muted || v === 0 ? 'volume-x' : v < 50 ? 'volume-1' : 'volume-2'));
      btnMute.dataset.tip = muted ? 'Unmute (M)' : 'Mute all sound (M)';
      btnMute.setAttribute('aria-label', muted ? 'Unmute StaticOS' : 'Mute StaticOS');
      btnMute.setAttribute('aria-pressed', String(muted));
      btnMute.classList.toggle('is-on', muted);
    }

    /* ---------------- paint: sidebar + tabs ---------------- */
    const VIEWS = [
      ['songs', 'music', 'Your music'],
      ['sonora', 'play', 'Sonora'],
      ['queue', 'list-music', 'Up next'],
      ['radio', 'cast', 'Radio'],
      ['lists', 'list', 'Playlists'],
      ['ambient', 'cloud-rain', 'Ambient sounds', 'Ambient'],
      ['tuner', 'gauge', 'Tuner'],
      ['most', 'bar-chart', 'Most played', 'Top'],
      ['recent', 'clock', 'Recently played', 'Recent'],
      ['lyrics', 'align-left', 'Lyrics'],
      ['sound', 'sliders', 'Sound'],
      ['books', 'mic', 'Audiobooks', 'Books'],
    ];
    /* a page by its id, so the sidebar's groups don't depend on the order of VIEWS */
    const viewOf = id => VIEWS.find(v => v[0] === id);
    const TABS = ['songs', 'sonora', 'lists', 'queue', 'radio', 'books', 'lyrics', 'sound', 'ambient', 'tuner'];
    /* the Audiobooks page (music-books.js) keeps its own search and book page while the window lives */
    let AB = null;
    const booksView = () => {
      if (!AB) AB = createAudiobooks({ h, icon, host: {
        state: () => (P.cur?.kind === 'book' ? { id: P.cur.book.id, ch: P.cur.ci, playing: soundOn() && P.phase === 'playing' } : null),
        play: (book, ch, at) => startBook(book, ch, at, true),
        toggle: () => toggle(),
      } });
      return [AB.el];
    };
    /* the tuner (music-tuner.js) keeps its microphone only while its page is on screen */
    let TU = null;
    const tunerView = () => { if (!TU) TU = createTuner({ h, icon, store }); return [TU.el]; };
    /* Sonora (sonora-app.surge.sh), a music app made by StaticOS's own maker, in a frame of its own
       origin. It plays through YouTube's, Spotify's and Apple Music's own players, which must stay on
       screen while they play, so the frame lives only while this page is open: going to another page
       here stops what it was playing, and "Open in a new tab" keeps it going on its own. */
    const SONORA = 'https://sonora-app.surge.sh/#/home';
    let SO = null;
    const sonoraView = () => {
      if (!SO) SO = h('iframe.mu-sonora', {
        src: SONORA, title: 'Sonora',
        allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write',
        sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation',
        referrerpolicy: 'strict-origin-when-cross-origin',
      });
      return [h('div.mu-sonora__bar',
        icon('play'), h('b', { text: 'Sonora' }),
        h('span.dim', { text: tx('Songs and radio from Sonora, played through YouTube, Spotify or Apple Music') }),
        h('div.grow'),
        h('a.btn.btn--sm', { href: SONORA, target: '_blank', rel: 'noopener' }, icon('external-link'), tx('Open in a new tab'))), SO];
    };
    const plOf = view => (typeof view === 'string' && view.startsWith('pl:') ? plGet(view.slice(3)) : null);
    const okView = view => VIEWS.some(v => v[0] === view) || !!plOf(view);
    const viewTitle = view => plOf(view)?.name || VIEWS.find(v => v[0] === view)?.[2] || 'Music';
    S.view = okView(P.view) ? P.view : 'songs';
    const upNextCount = () => (P.cur?.kind === 'file' ? Math.max(0, P.queue.length - P.qi - 1) : 0);
    function go(view) {
      if (!okView(view)) return;
      if (view !== S.view) S.plRenaming = null;
      S.view = view;
      P.view = view;
      S.renaming = null;
      paintAll();
      content.scrollTop = 0;
    }

    function paintSide() {
      clearEl(side);
      const counts = { songs: library().length, sonora: '', queue: upNextCount(), radio: STATIONS.length, ambient: AMB.state().playing ? 'On' : '', tuner: '',
        most: Object.keys(playsAll()).length || '', recent: '', lyrics: '', sound: fx.EQ().on ? 'EQ' : '', books: LV.shelf().length || '' };
      const item = ([v, ic, label]) => h('button.side__item', {
        class: S.view === v ? 'is-on' : null, 'aria-current': S.view === v ? 'page' : null, onclick: () => go(v),
      }, icon(ic), h('span', { text: label }), h('small', { text: String(counts[v]) }));
      const lists = plAll();
      const plItem = p => {
        const v = `pl:${p.id}`;
        return h('button.side__item.mu-plside', {
          class: S.view === v ? 'is-on' : null, 'aria-current': S.view === v ? 'page' : null,
          dataset: { pl: p.id }, title: p.name,
          onclick: () => go(v),
          oncontextmenu: e => { e.preventDefault(); plMenu(e, p.id); },
        }, icon('list'), h('span.trunc', { text: p.name }), h('small', { text: String(p.tracks.length) }));
      };
      side.append(
        h('div.side__group', h('div.side__label', { text: tx('Library') }), item(viewOf('songs')), item(viewOf('sonora')), item(viewOf('queue')), item(viewOf('most')), item(viewOf('recent'))),
        h('div.side__group.mu-pls', { role: 'group', 'aria-label': tx('Playlists') },
          h('button.side__label.mu-pls__label', { type: 'button', onclick: () => go('lists'), title: tx('All playlists') }, h('span', { text: tx('Playlists') })),
          lists.map(plItem),
          h('button.side__item.mu-pls__new', { type: 'button', onclick: () => newPlaylist() }, icon('plus'), h('span', { text: tx('New playlist') }))),
        h('div.side__group', h('div.side__label', { text: tx('Live') }), item(viewOf('radio')), item(viewOf('ambient')), item(viewOf('books'))),
        h('div.side__group', h('div.side__label', { text: tx('Tools') }), item(viewOf('lyrics')), item(viewOf('sound')), item(viewOf('tuner'))),
        h('div.side__group', h('div.side__label', { text: tx('Elsewhere') }),
          h('button.side__item', { onclick: () => api.openApp('files', { path: DIR }) }, icon('folder'), h('span', { text: tx('Music folder') })),
          h('button.side__item', { onclick: () => api.openApp('spotify') }, icon('list-music'), h('span', { text: tx('Spotify') }),
            h('small', icon('external-link')))),
        h('div.grow'),
        h('div.mu-side__imp',
          h('button.btn.btn--primary.btn--block', { onclick: pickFiles }, icon('upload'), tx('Import songs')),
          h('button.btn.btn--block.btn--sm', { dataset: { role: 'import-folder' }, onclick: pickFolder }, icon('folder'), tx('Import a folder')),
          h('small', { text: tx('Or drop audio files, or a folder, on this window.') })));

      clearEl(tabs);
      for (const id of TABS) {
        const [v, ic, label, short] = VIEWS.find(x => x[0] === id);
        const on = S.view === v || (v === 'lists' && !!plOf(S.view));
        tabs.appendChild(h('button.mu-tab', { 'aria-current': on ? 'page' : null, class: on ? 'is-on' : null,
          onclick: () => go(v) }, icon(ic), h('span', { text: short || label })));
      }
    }

    /* ---------------- paint: lists ---------------- */
    function keepFocus(fn) {
      const a = document.activeElement;
      const row = a && listBox.contains(a) ? a.closest('[data-key]') : null;
      const key = row?.dataset.key, role = a?.dataset?.role;
      const top = content.scrollTop;
      fn();
      content.scrollTop = top;
      if (!key) return;
      const r = listBox.querySelector(`[data-key="${CSS.escape(key)}"]`);
      const tgt = r && ((role && r.querySelector(`[data-role="${role}"]`)) || r.querySelector('button,input,a'));
      tgt?.focus({ preventScroll: true });
    }

    /* ↑/↓ move between rows; Enter/Space play (native button) */
    function rowNav(e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const rows = [...listBox.querySelectorAll('[data-role="main"]')];
      const i = rows.indexOf(e.currentTarget);
      const to = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!to) return;
      e.preventDefault();
      e.stopPropagation();
      to.focus();
      to.scrollIntoView({ block: 'nearest' });
    }

    const isCurNode = n => P.cur?.kind === 'file' && P.cur.node === n;

    function leadFor(n, idx) {
      if (isCurNode(n)) {
        const on = soundOn();
        return h('span.mu-row__lead.is-cur', { 'aria-hidden': 'true' }, icon(on ? 'volume-2' : 'pause'));
      }
      return h('span.mu-row__lead', { 'aria-hidden': 'true', text: String(idx) });
    }

    const rowRefs = new Map();                      /* key -> { row, main, e, idx } for in-place updates */
    function songRow(e, idx, list, extra = null) {
      const n = e.node;
      const has = media.isMedia(n);
      const d = durOf(n);
      const cur = isCurNode(n);
      if (has && d === undefined) wantDur(n);
      const lenTxt = !has ? 'No audio' : d === 'bad' ? 'Can’t play' : d === 'unknown' ? '?' : typeof d === 'number' ? dur(d) : '…';
      const lenTip = !has ? 'This file is empty — there is no audio in it.'
        : d === 'bad' ? 'This browser could not read this file.'
          : d === 'unknown' ? 'The browser did not report a length for this file.'
            : typeof d === 'number' ? 'Length, read from the file' : 'Reading the length…';
      const q = S.filter.trim().toLowerCase();
      const via = q && !`${e.title} ${e.artist} ${e.album} ${e.node.name}`.toLowerCase().includes(q) ? 'in the lyrics' : '';
      const who = [e.artist || 'Unknown artist', e.album, via].filter(Boolean).join(' · ');

      let main;
      if (S.renaming === n) {
        const input = h('input.mu-rename__in', { value: stemOf(n.name), 'aria-label': tx('New name for {name}', { name: n.name }), spellcheck: 'false',
          onkeydown: ev => {
            ev.stopPropagation();
            if (ev.key === 'Escape') { ev.preventDefault(); S.renaming = null; S.renameErr = ''; paintList(); focusRow(n); }
          },
          /* clicking elsewhere keeps the new name; leaving the browser window doesn't */
          onblur: ev => { if (S.renaming === n && document.hasFocus()) commitRename(n, ev.target.value, false); } });
        main = h('form.mu-row__main.mu-rename', { onsubmit: ev => { ev.preventDefault(); commitRename(n, input.value, true); } },
          h('span.mu-row__lead', { 'aria-hidden': 'true' }, icon('edit-3')),
          h('span.mu-row__txt', input,
            h('small', { text: S.renameErr || `Enter to rename · Esc to cancel · keeps ${extOf(n.name) || 'no extension'}`, class: S.renameErr ? 'is-err' : null })));
        queueMicrotask(() => { if (input.isConnected && document.activeElement !== input) { input.focus(); input.select(); } });
      } else {
        main = h('button.mu-row__main', {
          dataset: { role: 'main' },
          'aria-label': rowLabel(e, cur),
          onclick: () => {
            if (isCurNode(n)) toggle();
            else playFrom(list.map(x => x.node), n);
          },
          onkeydown: rowNav,
        },
          leadFor(n, idx),
          h('span.mu-row__txt', h('b', { text: e.title }), h('small', { text: who })));
      }
      const row = h('div.mu-row', {
        role: 'listitem',
        class: [cur ? 'is-cur' : '', !has || d === 'bad' ? 'is-dead' : ''].filter(Boolean).join(' ') || null,
        dataset: { key: keyOf(n) },
        oncontextmenu: ev => { ev.preventDefault(); rowMenu(ev, e, list); },
      },
        main,
        h('span.mu-row__fmt', { text: fmtTag(n.name) }),
        extra?.badge ? h('span.mu-row__size.mu-row__plays', { text: extra.badge, title: tx('From what you have really listened to') })
          : h('span.mu-row__size', { text: has ? bytes(n.size) : '0 B', title: tx('File size') }),
        h('span.mu-row__len', { text: lenTxt, title: lenTip, class: !has || d === 'bad' ? 'is-bad' : null }),
        h('button.ibtn.mu-row__more', { dataset: { role: 'more' }, 'aria-label': tx('More for {title}', { title: e.title }), 'aria-haspopup': 'menu',
          onclick: ev => rowMenu(ev, e, list) }, icon('more-horizontal')));
      if (S.renaming !== n) rowRefs.set(keyOf(n), { row, main, e, idx });
      return row;
    }
    const rowLabel = (e, cur) => {
      const d = durOf(e.node);
      return `${cur && soundOn() ? 'Pause' : 'Play'} ${e.title}${e.artist ? ` by ${e.artist}` : ''}${typeof d === 'number' ? `, ${dur(d)}` : ''}`;
    };

    /* play/pause and track changes only move the highlight — no rebuild, so
       hover, focus and an open right-click menu stay where they are */
    function markSongs() {
      for (const { row, main, e, idx } of rowRefs.values()) {
        if (!row.isConnected) continue;
        const cur = isCurNode(e.node);
        row.classList.toggle('is-cur', cur);
        const lead = main.querySelector('.mu-row__lead');
        if (lead) lead.replaceWith(leadFor(e.node, idx));
        main.setAttribute('aria-label', rowLabel(e, cur));
      }
    }

    function focusRow(n) {
      queueMicrotask(() => listBox.querySelector(`[data-key="${keyOf(n)}"] [data-role="main"]`)?.focus({ preventScroll: true }));
    }

    function filtered() {
      const q = S.filter.trim().toLowerCase();
      return sortedLibrary(currentSort()).filter(e => !q || `${e.title} ${e.artist} ${e.album} ${e.node.name}`.toLowerCase().includes(q)
        || (findLyrics(e.node, e.path)?.text || '').toLowerCase().includes(q));
    }

    function songsView() {
      const all = library();
      const frag = [];
      if (!all.length) {
        const formats = playableFormats();
        frag.push(h('div.mu-empty',
          h('div.mu-empty__art', icon('music')),
          h('h3', { text: tx('Import songs from your computer') }),
          h('p', { text: tx('Pick audio files, or drop them on this window. They’re copied into ~/Music and kept in this browser on this device — nothing is uploaded anywhere.') }),
          formats.length ? h('p.mu-empty__fine', { text: `This browser says it can play ${formats.join(', ')}.` }) : null,
          h('div.mu-empty__acts',
            h('button.btn.btn--primary', { onclick: pickFiles }, icon('upload'), tx('Import songs')),
            h('button.btn', { onclick: () => go('radio') }, icon('cast'), tx('Listen to live radio'))),
          h('button.mu-linkbtn', { onclick: () => api.openApp('spotify') },
            tx('Listening on Spotify? Open the Spotify app'), icon('chevron-right'))));
        return frag;
      }
      const sort = currentSort();
      const list = filtered();
      clearEl(sortBtn).append(icon('filter'), h('span', { text: SORTS[sort].label }));
      sortBtn.setAttribute('aria-label', `Sort: ${SORTS[sort].label}`);
      shufBtn.disabled = !list.some(e => playable(e.node));
      if (!list.length) {
        frag.push(h('div.empty', icon('search'), h('b', { text: tx('No matches') }),
          h('small', { text: tx('Nothing in Your music matches “{filter}” — songs are matched on title, artist, album, file name and lyrics.', { filter: S.filter }) })));
        return frag;
      }
      const ul = h('div.mu-list', { role: 'list', 'aria-label': tx('Your music') });
      list.forEach((e, i) => ul.appendChild(songRow(e, i + 1, list)));
      frag.push(ul);
      return frag;
    }

    function queueView() {
      const c = P.cur;
      const frag = [];
      if (c?.kind === 'radio') {
        frag.push(h('div.mu-empty.mu-empty--sm', h('div.mu-empty__art', icon('cast')),
          h('h3', { text: tx('Radio is live, so there’s no queue') }),
          h('p', { text: tx('{name} plays whatever SomaFM is broadcasting. Next and Previous switch stations; pick a song in Your music to go back to your files.', { name: c.st.name }) }),
          h('div.mu-empty__acts', h('button.btn', { onclick: () => go('songs') }, icon('music'), tx('Your music')))));
        return frag;
      }
      if (c?.kind === 'book') {
        frag.push(h('div.mu-empty.mu-empty--sm', h('div.mu-empty__art', icon('mic')),
          h('h3', { text: tx('An audiobook is playing') }),
          h('p', { text: tx('{title} goes chapter by chapter: Next and Previous step through them, and the Audiobooks page lists them all.', { title: c.book.title }) }),
          h('div.mu-empty__acts', h('button.btn', { onclick: () => go('books') }, icon('mic'), tx('Audiobooks')))));
        return frag;
      }
      if (!c) {
        frag.push(h('div.mu-empty.mu-empty--sm', h('div.mu-empty__art', icon('list-music')),
          h('h3', { text: tx('Nothing up next') }),
          h('p', { text: tx('Play a song from Your music and the rest line up here. “Play next” and “Add to queue” on any song put it here too.') }),
          h('div.mu-empty__acts', h('button.btn', { onclick: () => go('songs') }, icon('music'), tx('Your music')))));
        return frag;
      }
      const make = (n, i, label) => {
        const e = { node: n, ...describe(n) };
        const d = durOf(n);
        const row = h('div.mu-row', { role: 'listitem', class: i === P.qi ? 'is-cur' : null, dataset: { key: `q${i}` } },
          h('button.mu-row__main', { dataset: { role: 'main' }, onkeydown: rowNav,
            'aria-label': i === P.qi ? `${soundOn() ? 'Pause' : 'Play'} ${e.title}` : tx('Play {title} now', { title: e.title }),
            onclick: () => { if (i === P.qi) toggle(); else { P.qi = i; startFile(n, true); } } },
            i === P.qi ? leadFor(n, 0) : h('span.mu-row__lead', { 'aria-hidden': 'true', text: String(label) }),
            h('span.mu-row__txt', h('b', { text: e.title }), h('small', { text: e.artist || tx('Unknown artist') }))),
          h('span.mu-row__fmt', { text: fmtTag(n.name) }),
          h('span.mu-row__size', { text: bytes(n.size) }),
          h('span.mu-row__len', { text: typeof d === 'number' ? dur(d) : '—' }),
          i > P.qi
            ? h('button.ibtn.mu-row__more', { dataset: { role: 'drop' }, 'aria-label': tx('Remove {title} from Up next', { title: e.title }), onclick: () => dropAt(i) }, icon('x'))
            : h('span.mu-row__more'));
        if (i > P.qi) {
          /* a grip to drag the song to a new place in the queue (or focus it and press up or down) */
          const k = i - P.qi - 1;
          const grip = h('button.mu-grip', {
            type: 'button', dataset: { role: 'grip' },
            'aria-label': `Move ${e.title} (position ${k + 1} of ${P.queue.length - P.qi - 1} in Up next) — drag, or press up or down`,
            onpointerdown: ev => startDrag(ev, '__queue', k),
            onkeydown: ev => {
              if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
              ev.preventDefault();
              ev.stopPropagation();
              const to = i + (ev.key === 'ArrowUp' ? -1 : 1);
              if (to <= P.qi || to >= P.queue.length) return;
              queueMove(i, to);
              queueMicrotask(() => listBox.querySelector(`[data-key="q${to}"] [data-role="grip"]`)?.focus({ preventScroll: true }));
            },
          }, icon('grip-vertical'));
          row.prepend(grip);
          row.classList.add('mu-qrow');
        }
        return row;
      };
      frag.push(h('div.mu-qhead', h('span.label', { text: tx('Now playing') })));
      frag.push(h('div.mu-list', { role: 'list', 'aria-label': tx('Now playing') }, make(P.queue[P.qi] || c.node, P.qi, 0)));
      const rest = P.queue.slice(P.qi + 1);
      const notes = [P.shuffle ? 'Shuffle is on' : 'In order', { off: 'stops at the end', all: 'repeats the queue', one: 'repeats this song' }[P.repeat]];
      frag.push(h('div.mu-qhead',
        h('span.label', { text: tx('Up next · {length}', { length: rest.length }) }),
        h('span.dim', { text: notes.join(' · ') }),
        h('div.grow'),
        P.queue.length > 1 ? h('button.btn.btn--sm', { dataset: { role: 'queue-save' }, onclick: saveQueue }, icon('list-plus'), tx('Save as playlist')) : null,
        rest.length ? h('button.btn.btn--sm.btn--ghost', { onclick: clearUpNext }, tx('Clear')) : null));
      if (!rest.length) {
        frag.push(h('p.mu-qnone', { text: P.repeat === 'all' && P.queue.length > 1
          ? 'That’s the last song — the queue starts over after it.'
          : 'That’s the last song. Add more with “Play next” or “Add to queue”.' }));
      } else {
        const ul = h('div.mu-list', { role: 'list', 'aria-label': tx('Up next') });
        rest.forEach((n, k) => ul.appendChild(make(n, P.qi + 1 + k, k + 1)));
        frag.push(ul);
        frag.push(h('p.mu-plhint', { text: tx('Drag the grip to reorder what plays next — or focus it and press ↑ ↓.') }));
      }
      return frag;
    }

    /* ---------------- playlists ---------------- */
    const songCount = n => `${n} song${n === 1 ? '' : 's'}`;
    function plLength(tracks) {
      let total = 0, known = true;
      for (const t of tracks) {
        if (!t.e) continue;
        const d = durOf(t.e.node);
        if (typeof d === 'number') total += d;
        else { known = false; if (d === undefined && media.isMedia(t.e.node)) wantDur(t.e.node); }
      }
      return { total, known };
    }

    /** Make a playlist (optionally with songs in it), open it and put its name up for editing. */
    function newPlaylist(nodes = []) {
      const id = plCreate(plFreeName(), nodes);
      go(`pl:${id}`);
      S.plRenaming = id;
      paintList();
      if (nodes.length) flash(`Made a playlist with “${describe(nodes[0]).title}” in it — name it, then add more.`);
    }
    function addTo(id, n) {
      const p = plGet(id);
      const r = plAdd(id, n);
      const t = describe(n).title;
      if (r === 'added') flash(`Added “${t}” to ${p.name}.`);
      else if (r === 'dup') flash(`“${t}” is already in ${p.name}.`, true);
      else if (r === 'nodata') flash(`“${t}” has no audio in it, so it can’t go in a playlist.`, true);
    }
    /** The whole queue (what is playing and what is next) as a new playlist. */
    function saveQueue() {
      const nodes = P.queue.filter(n => media.isMedia(n));
      if (!nodes.length) { flash('There is nothing in the queue to save.', true); return; }
      const id = plCreate(plFreeName('Queue'), nodes);
      go(`pl:${id}`);
      S.plRenaming = id;
      paintList();
      flash(`Saved ${songCount(nodes.length)} from the queue as a playlist — name it.`);
    }
    function m3uText(p) {
      const out = ['#EXTM3U'];
      for (const t of plTracks(p)) {
        const name = t.e ? t.e.node.name : t.name;
        const d = t.e ? durOf(t.e.node) : undefined;
        const label = t.e ? (t.e.artist ? `${t.e.artist} - ${t.e.title}` : t.e.title) : stemOf(t.name || 'Song');
        out.push(`#EXTINF:${typeof d === 'number' ? Math.round(d) : -1},${label.replace(/[\r\n]+/g, ' ')}`, name);
      }
      return `${out.join('\n')}\n`;
    }
    function exportM3u(id) {
      const p = plGet(id);
      if (!p) return;
      const blob = new Blob([m3uText(p)], { type: 'audio/x-mpegurl' });
      const url = URL.createObjectURL(blob);
      const fileName = `${p.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Playlist'}.m3u`;
      const a = h('a', { href: url, download: fileName, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      a.remove();
      const rec = { url, t: setTimeout(() => { URL.revokeObjectURL(url); pendingUrls.delete(rec); }, 20000) };
      pendingUrls.add(rec);
      flash(`Exported “${p.name}” as ${fileName} — it lists song file names, so it works with the same songs anywhere.`);
    }
    /** Read an .m3u/.m3u8 and make a playlist from the songs in it that are in Your music. */
    async function importM3u(file) {
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { flash(`“${file.name}” is too big to be a playlist.`, true); return; }
      const text = (await file.text()).replace(/^\uFEFF/, '');
      if (dead) return;
      const entries = [];
      let label = '';
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (/^#EXTINF:/i.test(line)) { label = line.slice(line.indexOf(',') + 1).trim(); continue; }
        if (line.startsWith('#')) continue;
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line) && !/^file:/i.test(line)) { entries.push({ name: line, label, web: true }); label = ''; continue; }
        let path = line.replace(/^file:\/\/(localhost)?/i, '');
        try { path = decodeURIComponent(path); } catch (e) { /* not encoded */ }
        entries.push({ name: path.split(/[\\/]/).pop(), label });
        label = '';
      }
      const lib = library();
      const byName = new Map(), byStem = new Map();
      for (const e of lib) {
        if (!media.isMedia(e.node)) continue;
        if (!byName.has(e.node.name.toLowerCase())) byName.set(e.node.name.toLowerCase(), e.node);
        if (!byStem.has(stemOf(e.node.name).toLowerCase())) byStem.set(stemOf(e.node.name).toLowerCase(), e.node);
      }
      const found = [], missing = [];
      for (const en of entries) {
        if (en.web) { missing.push({ name: en.label || en.name, why: 'an internet address — Music only plays your own files' }); continue; }
        const n = byName.get(en.name.toLowerCase()) || byStem.get(stemOf(en.name).toLowerCase());
        if (n) found.push(n); else missing.push({ name: en.name, why: 'not in Your music' });
      }
      if (!entries.length) { S.report = { title: tx('“{name}” has no songs in it', { name: file.name }), lines: [] }; paintList(); flash('That playlist file is empty.', true); return; }
      if (!found.length) {
        S.report = { title: tx('None of the {length} songs in “{name}” are in Your music', { length: entries.length, name: file.name }), lines: missing };
        paintList();
        return;
      }
      const id = plCreate(plFreeName(cleanPlName(stemOf(file.name)) || 'Imported playlist'), found);
      S.report = missing.length ? { title: `Imported “${plGet(id).name}”: ${found.length} of ${entries.length} songs found`, lines: missing } : null;
      go(`pl:${id}`);
      flash(`Imported “${plGet(id).name}” — ${songCount(plGet(id).tracks.length)}${missing.length ? `, ${missing.length} not found` : ''}.`);
    }
    function playPl(id, shuffle) {
      if (!playPlaylist(id, shuffle)) flash('Nothing in this playlist can play — add songs from Your music.', true);
      else markNow(id, P.cur?.node?.content);
    }
    async function deletePl(id) {
      const p = plGet(id);
      if (!p) return;
      const yes = await api.confirm({ title: tx('Delete “{name}”?', { name: p.name }), ok: 'Delete playlist', danger: true,
        message: `The ${songCount(p.tracks.length)} in it stay in Your music — only the playlist goes.` });
      if (!yes || dead) return;
      SH.byPlaylist(id)?.leave();
      plDelete(id);
      if (P.from?.pl === id) P.from = null;
      if (S.view === `pl:${id}`) go('lists');
      flash(`Deleted the playlist “${p.name}”.`);
      paintHero();
    }
    function plMenu(ev, id) {
      const p = plGet(id);
      if (!p) return;
      const r = ev.currentTarget?.getBoundingClientRect?.();
      api.menu([
        { label: tx('Play'), icon: 'play', disabled: !p.tracks.length, onClick: () => playPl(id, false) },
        { label: tx('Shuffle'), icon: 'shuffle', disabled: !p.tracks.length, onClick: () => playPl(id, true) },
        '-',
        { label: tx('Rename…'), icon: 'edit-3', onClick: () => { if (S.view !== `pl:${id}`) go(`pl:${id}`); S.plRenaming = id; paintList(); } },
        { label: tx('Export as .m3u'), icon: 'download', onClick: () => exportM3u(id) },
        { label: tx('Delete playlist…'), icon: 'trash', danger: true, onClick: () => deletePl(id) },
      ], ev.clientX || (r ? r.left : 0), ev.clientY || (r ? r.bottom : 0));
    }
    /** "Add songs": every song in Your music, the ones already in it ticked. */
    function addSongsMenu(ev, id) {
      const p = plGet(id);
      if (!p) return;
      const r = ev.currentTarget.getBoundingClientRect();
      const have = new Set(p.tracks.map(t => t.ref));
      const songs = sortedLibrary('title');
      api.menu(songs.length ? [
        { header: true, label: tx('Add to {name}', { name: p.name }) },
        ...songs.map(e => {
          const inIt = media.isMedia(e.node) && have.has(e.node.content);
          return { label: `${e.title}${e.artist ? ` — ${e.artist}` : ''}`, icon: inIt ? 'check' : 'plus',
            disabled: inIt || !media.isMedia(e.node), onClick: () => addTo(id, e.node) };
        }),
      ] : [
        { label: tx('Your music is empty'), icon: 'music', disabled: true },
        { label: tx('Import songs…'), icon: 'upload', onClick: pickFiles },
      ], r.left, r.bottom + 4);
    }

    /* ---------------- shared playlists: the Music side ---------------- */
    const join = joinBox({ h, icon }, code => joinShared(code));
    const shMenu = (e, items) => { const r = e.currentTarget.getBoundingClientRect(); api.menu(items, r.left, r.bottom + 4); };
    function shareToEdit(id) {
      if (!plGet(id) || SH.byPlaylist(id)) return;
      SH.host(id);
      paintAll();
    }
    function joinShared(raw) {
      const code = normalizeCode(raw);
      if (!isCode(code)) { join.status.textContent = 'That isn’t a code — it is 6 letters and numbers, like K7QM2X.'; return; }
      if (SH.all().some(s => s.code === code)) { join.status.textContent = 'You are already in that playlist.'; return; }
      join.status.textContent = 'Joining…';
      SH.join(code);
    }
    const SH_WHY = { invalid: 'That isn’t a valid code.', nobody: 'Nobody answered that code — check it, and that your friend still has the playlist shared.', full: 'That playlist already has two people.', insecure: 'Sharing needs a secure (https) page.' };
    const offShare = SH.on(ev => {
      if (dead) return;
      if (ev.type === 'ended') {
        const why = SH_WHY[ev.reason];
        join.status.textContent = why || '';
        flash(why || `Sharing ended (${ev.reason}) — your copy of the playlist stays.`, !!why);
      } else if (ev.session.role === 'guest' && ev.plId && !ev.session.opened) {
        ev.session.opened = true;
        join.status.textContent = '';
        go(`pl:${ev.plId}`);
      }
      paintAll();
    });
    disposers.push(offShare);
    /* shared playlists: how the songs are shown (display only), and the "playing now" marker */
    const SH_SORTS = ['order', 'name', 'who'];
    let shSort = 'order';
    const markNow = (id, ref) => { const sess = SH.byPlaylist(id); if (sess && ref) sess.setNow(ref); };
    function sharePanelFor(id) {
      const sess = SH.byPlaylist(id);
      if (!sess) return null;
      return sharePanel({ h, icon }, sess, {
        leave: () => { sess.leave(); },
        copy: async code => {
          const text = `Edit my playlist with me in Static Music — code ${code} · ${inviteLink(code)}`;
          try { await navigator.clipboard.writeText(text); flash('Invite copied.'); } catch (err) { flash(`Copying was blocked — read the code out: ${code}`, true); }
        },
        sendDrop: ref => { if (!sess.sendWithDrop(ref)) flash('Couldn’t find that file to send.', true); },
        openDrop: code => api.openApp('drop', { join: code }),
        addStation: (sid, on) => sess.addStation(sid, on),
        playStation: st => startStation(st, true),
        stationsList: STATIONS,
        menu: shMenu,
        sort: shSort,
        setSort: v => { shSort = SH_SORTS.includes(v) ? v : 'order'; paintAll(); },
        clearNow: () => sess.clearNow(),
      });
    }

    function listsView() {
      const lists = plAll();
      if (!lists.length) {
        return [join.el, h('div.mu-empty',
          h('div.mu-empty__art', icon('list')),
          h('h3', { text: tx('No playlists yet') }),
          h('p', { text: tx('Make one, then fill it from Your music with ⋯ › Add to playlist. Playlists are kept in this browser.') }),
          h('div.mu-empty__acts',
            h('button.btn.btn--primary', { onclick: () => newPlaylist() }, icon('plus'), tx('New playlist')),
            h('button.btn', { dataset: { role: 'import-m3u' }, onclick: () => m3uIn.click() }, icon('upload'), tx('Import .m3u')),
            library().length ? null : h('button.btn', { onclick: pickFiles }, icon('upload'), tx('Import songs'))))];
      }
      const grid = h('div.mu-plgrid', { role: 'list', 'aria-label': tx('Playlists') });
      for (const p of lists) {
        const tracks = plTracks(p);
        const { total, known } = plLength(tracks);
        const gone = tracks.filter(t => !t.e).length;
        grid.appendChild(h('article.mu-plcard', { role: 'listitem', dataset: { key: `pc:${p.id}` },
          oncontextmenu: e => { e.preventDefault(); plMenu(e, p.id); } },
          h('button.mu-plcard__open', { dataset: { role: 'main' }, 'aria-label': `Open ${p.name}, ${songCount(p.tracks.length)}`, onclick: () => go(`pl:${p.id}`) },
            h('span.mu-plcard__art', { 'aria-hidden': 'true' }, icon('list')),
            h('span.mu-plcard__txt', h('b', { text: p.name }),
              h('small', { text: [songCount(p.tracks.length), total && known ? dur(total) : null, gone ? `${gone} gone` : null].filter(Boolean).join(' · ') }))),
          h('button.ibtn.mu-plcard__play', { dataset: { role: 'play' }, 'aria-label': tx('Play {name}', { name: p.name }), disabled: !tracks.some(t => t.e && playable(t.e.node)),
            onclick: () => playPl(p.id, false) }, icon('play', { fill: true }))));
      }
      grid.appendChild(h('button.mu-plcard.mu-plcard--new', { dataset: { key: 'pc:new', role: 'main' }, onclick: () => newPlaylist() },
        h('span.mu-plcard__art', { 'aria-hidden': 'true' }, icon('plus')), h('span.mu-plcard__txt', h('b', { text: tx('New playlist') }))));
      return [h('div.mu-qhead', h('span.label', { text: tx('Playlists · {length}', { length: lists.length }) }), h('span.dim', { text: tx('kept in this browser') }), h('div.grow'),
        h('button.btn.btn--sm', { dataset: { role: 'import-m3u' }, onclick: () => m3uIn.click() }, icon('upload'), tx('Import .m3u'))), join.el, grid];
    }

    function plHeader(p, tracks) {
      const id = p.id;
      const { total, known } = plLength(tracks);
      const gone = tracks.filter(t => !t.e).length;
      const canPlay = tracks.some(t => t.e && playable(t.e.node));
      let name;
      if (S.plRenaming === id) {
        let done = false;
        const commit = (v, keep) => {
          if (done) return;
          done = true;
          S.plRenaming = null;
          if (keep && cleanPlName(v) && cleanPlName(v) !== p.name) plRename(id, v);
          else paintList();
          queueMicrotask(() => listBox.querySelector('[data-role="rename"]')?.focus({ preventScroll: true }));
        };
        const input = h('input.mu-rename__in.mu-plhead__in', { value: p.name, maxlength: String(PL_NAME_MAX), spellcheck: 'false',
          'aria-label': tx('Playlist name'),
          onkeydown: ev => {
            ev.stopPropagation();
            if (ev.key === 'Enter') { ev.preventDefault(); commit(input.value, true); }
            else if (ev.key === 'Escape') { ev.preventDefault(); commit('', false); }
          },
          onblur: () => { if (document.hasFocus()) commit(input.value, true); } });
        name = h('div.mu-plhead__edit', input, h('small', { text: tx('Enter to keep · Esc to cancel') }));
        queueMicrotask(() => { if (input.isConnected && document.activeElement !== input) { input.focus(); input.select(); } });
      } else {
        name = h('h3.mu-plhead__name', { text: p.name, title: tx('Double-click to rename'), ondblclick: () => { S.plRenaming = id; paintList(); } });
      }
      const meta = [songCount(p.tracks.length), total ? `${dur(total)}${known ? '' : '+'}` : null, gone ? `${gone} no longer in Your music` : null];
      return h('header.mu-plhead', { dataset: { key: `ph:${id}` } },
        h('div.mu-plhead__art', { 'aria-hidden': 'true' }, icon('list')),
        h('div.mu-plhead__meta',
          h('span.label', { text: tx('Playlist') }),
          name,
          h('small.mu-plhead__sub', { text: meta.filter(Boolean).join(' · ') })),
        h('div.mu-plhead__acts',
          h('button.btn.btn--primary.btn--sm', { dataset: { role: 'pplay' }, disabled: !canPlay, onclick: () => playPl(id, false) }, icon('play', { fill: true }), tx('Play')),
          h('button.btn.btn--sm', { dataset: { role: 'pshuffle' }, disabled: !canPlay, onclick: () => playPl(id, true) }, icon('shuffle'), tx('Shuffle')),
          h('button.btn.btn--sm', { dataset: { role: 'padd' }, 'aria-haspopup': 'menu', onclick: e => addSongsMenu(e, id) }, icon('plus'), tx('Add songs')),
          h('button.btn.btn--sm', { dataset: { role: 'pexport' }, title: tx('Save this playlist as an .m3u file'), onclick: () => exportM3u(id) }, icon('download'), tx('Export .m3u')),
          SH.byPlaylist(id) ? null : h('button.btn.btn--sm', { dataset: { role: 'pshare' }, title: tx('Get a code or link and edit this playlist together'), onclick: () => shareToEdit(id) }, icon('users'), tx('Share to edit with a friend')),
          h('button.ibtn', { dataset: { role: 'rename' }, 'aria-label': tx('Rename {name}', { name: p.name }), title: tx('Rename'), onclick: () => { S.plRenaming = id; paintList(); } }, icon('edit-3')),
          h('button.ibtn', { dataset: { role: 'pmore' }, 'aria-label': tx('More for {name}', { name: p.name }), 'aria-haspopup': 'menu', onclick: e => plMenu(e, id) }, icon('more-horizontal'))));
    }

    function playlistView(p) {
      const id = p.id;
      const tracks = plTracks(p);
      const frag = [plHeader(p, tracks), sharePanelFor(id)];
      if (!tracks.length) {
        frag.push(h('div.mu-empty.mu-empty--sm',
          h('h3', { text: tx('This playlist is empty') }),
          h('p', { text: library().length
            ? 'Add songs with “Add songs” above, or from Your music with ⋯ › Add to playlist.'
            : 'Import songs into Your music first, then add them here.' }),
          h('div.mu-empty__acts', library().length
            ? h('button.btn', { onclick: () => go('songs') }, icon('music'), tx('Your music'))
            : h('button.btn.btn--primary', { onclick: pickFiles }, icon('upload'), tx('Import songs')))));
        return frag;
      }
      const nodes = tracks.filter(t => t.e && playable(t.e.node)).map(t => t.e.node);
      const ul = h('div.mu-list.mu-pllist', { role: 'list', 'aria-label': tx('Songs in {name}', { name: p.name }) });
      /* a shared playlist can be shown by name or by who added a song; that is only how it is drawn */
      const sess = SH.byPlaylist(id);
      const how = sess ? shSort : 'order';
      const order = tracks.map((t, i) => ({ t, i }));
      if (how === 'name') order.sort((a, b) => (a.t.e ? a.t.e.title : parseName(a.t.name || 'Song').title).localeCompare(b.t.e ? b.t.e.title : parseName(b.t.name || 'Song').title) || a.i - b.i);
      else if (how === 'who') order.sort((a, b) => (sess.whoAdded(a.t.ref) === 'You' ? 0 : 1) - (sess.whoAdded(b.t.ref) === 'You' ? 0 : 1) || a.i - b.i);
      order.forEach(({ t, i }) => ul.appendChild(plRow(p, t, i, nodes, { sess, shown: how !== 'order' })));
      frag.push(ul);
      frag.push(h('p.mu-plhint', { text: tx('Drag the grip to reorder — or focus it and press ↑ ↓.') }));
      return frag;
    }

    function plRow(p, t, i, nodes, sh = {}) {
      const id = p.id;
      const e = t.e;
      const n = e?.node || null;
      const has = !!n && media.isMedia(n);
      const d = has ? durOf(n) : undefined;
      if (has && d === undefined) wantDur(n);
      const cur = !!n && isCurNode(n);
      const title = e ? e.title : parseName(t.name || 'Song').title;
      const grip = h('button.mu-grip', {
        type: 'button', dataset: { role: 'grip' },
        'aria-label': `Move ${title} (position ${i + 1} of ${p.tracks.length}) — drag, or press up or down`,
        disabled: sh.shown || null,
        title: sh.shown ? tx('Switch to List order to reorder') : null,
        onpointerdown: ev => { if (!sh.shown) startDrag(ev, id, i); },
        onkeydown: ev => {
          if (sh.shown || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
          ev.preventDefault();
          ev.stopPropagation();
          const to = i + (ev.key === 'ArrowUp' ? -1 : 1);
          if (to < 0 || to >= p.tracks.length) return;
          plMove(id, i, to);
        },
      }, icon('grip-vertical'));
      const main = n
        ? h('button.mu-row__main', {
          dataset: { role: 'main' },
          'aria-label': `${cur && soundOn() ? 'Pause' : 'Play'} ${title}${e.artist ? ` by ${e.artist}` : ''}`,
          onclick: () => { if (isCurNode(n)) toggle(); else { playFrom(nodes.includes(n) ? nodes : [n], n, { pl: id }); markNow(id, t.ref); } },
          onkeydown: rowNav,
        }, leadFor(n, i + 1), h('span.mu-row__txt', h('b', { text: title }), h('small', { text: e.artist || tx('Unknown artist') }), sh.sess ? shTag(sh.sess, t) : null))
        : h('div.mu-row__main.is-gone', { dataset: { role: 'main' } },
          h('span.mu-row__lead', { 'aria-hidden': 'true', text: String(i + 1) }),
          h('span.mu-row__txt', h('b', { text: title }),
            h('small.is-err', { text: tx('Not in Your music any more — it was deleted or moved out of ~/Music.') })));
      const lenTxt = !n ? '—' : !has ? 'No audio' : d === 'bad' ? 'Can’t play' : typeof d === 'number' ? dur(d) : '…';
      return h('div.mu-row.mu-plrow', {
        role: 'listitem', dataset: { key: `t:${t.ref}`, i: String(i) },
        class: [cur ? 'is-cur' : '', !n || d === 'bad' ? 'is-dead' : ''].filter(Boolean).join(' ') || null,
        oncontextmenu: ev => { ev.preventDefault(); plRowMenu(ev, p, t, i, nodes); },
      },
        grip,
        main,
        h('span.mu-row__fmt', { text: fmtTag(n ? n.name : t.name || '') }),
        h('span.mu-row__size', { text: n ? bytes(n.size) : '—' }),
        h('span.mu-row__len', { text: lenTxt, class: !n || d === 'bad' ? 'is-bad' : null }),
        h('button.ibtn.mu-row__more.mu-plrow__x', { dataset: { role: 'remove' }, 'aria-label': tx('Remove {title} from {name}', { title, name: p.name }), title: tx('Remove from playlist'),
          onclick: () => removeTrack(id, i, title) }, icon('x')));
    }
    /* "added by" and the playing-now marker on a row of a shared playlist */
    function shTag(sess, t) {
      const by = sess.whoAdded(t.ref);
      const v = sess.view();
      const row = v.items.find(x => x.ref === t.ref);
      return h('small.mu-row__by', { dataset: { role: 'row-by' } },
        row && row.playing ? h('em.mu-row__now', { dataset: { role: 'row-now' }, text: tx('Playing now · set by {who}', { who: v.now.who }) }) : null,
        row && row.playing && by ? ' · ' : null,
        by ? tx('added by {by}', { by }) : null);
    }
    function removeTrack(id, i, title) {
      const p = plGet(id);
      if (!p || !p.tracks[i]) return;
      const t = p.tracks[i];
      plRemoveAt(id, i);
      api.notify({ app: 'Music', icon: 'list', title: tx('Removed from {name}', { name: p.name }), message: title, timeout: 6000,
        actions: [{ label: tx('Undo'), onClick: () => plEdit(id, q => (q.tracks.some(x => x.ref === t.ref) ? null
          : { ...q, tracks: [...q.tracks.slice(0, i), t, ...q.tracks.slice(i)] })) }] });
    }
    function plRowMenu(ev, p, t, i, nodes) {
      const n = t.e?.node || null;
      const last = p.tracks.length - 1;
      api.menu([
        n && { label: tx('Play from here'), icon: 'play', disabled: !media.isMedia(n), onClick: () => playFrom(nodes.includes(n) ? nodes : [n], n, { pl: p.id }) },
        n && '-',
        { label: tx('Move to top'), icon: 'arrow-up', disabled: i === 0, onClick: () => plMove(p.id, i, 0) },
        { label: tx('Move to bottom'), icon: 'arrow-down', disabled: i === last, onClick: () => plMove(p.id, i, last) },
        '-',
        n && { label: tx('Show in Files'), icon: 'folder-open', onClick: () => api.openApp('files', { path: alive(n) || DIR }) },
        { label: tx('Remove from playlist'), icon: 'x', danger: true, onClick: () => removeTrack(p.id, i, t.e ? t.e.title : t.name) },
      ].filter(Boolean), ev.clientX, ev.clientY);
    }

    /* drag a track by its grip: the row follows the pointer through the
       list, and letting go saves the new order */
    function startDrag(ev, id, from) {
      if (ev.button > 0 || S.plDrag) return;
      const grip = ev.currentTarget;
      const row = grip.closest('.mu-row');
      const box = row?.parentElement;
      if (!row || !box) return;
      ev.preventDefault();
      grip.focus({ preventScroll: true });
      /* listen on the window, not the grip: moving the row through the list
         takes it out of the document for a moment, which drops pointer capture */
      const pid = ev.pointerId;
      S.plDrag = { id, from };
      row.classList.add('is-dragging');
      box.classList.add('is-sorting');
      let scrollT = 0;
      const place = y => {
        const others = [...box.children].filter(r => r !== row);
        let at = others.length;
        for (let k = 0; k < others.length; k++) {
          const rc = others[k].getBoundingClientRect();
          if (y < rc.top + rc.height / 2) { at = k; break; }
        }
        const ref = others[at] || null;
        if (row.nextElementSibling !== ref || (ref === null && box.lastElementChild !== row)) box.insertBefore(row, ref);
      };
      const edge = y => {
        const c = content.getBoundingClientRect();
        clearInterval(scrollT);
        const dir = y < c.top + 36 ? -1 : y > c.bottom - 36 ? 1 : 0;
        if (dir) scrollT = setInterval(() => { content.scrollTop += dir * 10; }, 16);
      };
      const move = e => { if (e.pointerId !== pid) return; e.preventDefault(); place(e.clientY); edge(e.clientY); };
      /* also the window closing mid-drag: no listener is left behind */
      const stop = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', cx, true);
        window.removeEventListener('keydown', esc, true);
        clearInterval(scrollT);
      };
      const finish = cancel => {
        stop();
        const k = disposers.indexOf(stop);
        if (k >= 0) disposers.splice(k, 1);
        const to = [...box.children].indexOf(row);
        const key = row.dataset.key;
        row.classList.remove('is-dragging');
        box.classList.remove('is-sorting');
        S.plDrag = null;
        let focusKey = key;
        if (cancel || to === from || to < 0) paintList();
        else if (id === '__queue') {
          queueMove(P.qi + 1 + from, P.qi + 1 + to);
          focusKey = `q${P.qi + 1 + to}`;
          flash(`Moved to position ${to + 1} in Up next.`);
        } else {
          plMove(id, from, to);
          const t = plGet(id);
          if (t) flash(`Moved to position ${to + 1} of ${t.tracks.length}.`);
        }
        /* moving the row took focus off its grip; put it back */
        listBox.querySelector(`[data-key="${CSS.escape(focusKey)}"] [data-role="grip"]`)?.focus({ preventScroll: true });
      };
      const up = e => { if (e.pointerId === pid) finish(false); };
      const cx = e => { if (e.pointerId === pid) finish(true); };
      const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); } };
      disposers.push(stop);
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', cx, true);
      window.addEventListener('keydown', esc, true);
    }

    const logos = new Map();
    function stationCard(st) {
      const cur = P.cur?.kind === 'radio' && P.cur.st === st;
      const on = cur && soundOn();
      const info = CH.map?.get(st.id);
      const air = cur ? P.onAir : null;
      if (!logos.has(st.id)) {
        logos.set(st.id, h('span.mu-st__logo', h('img', { src: st.logo, alt: '', decoding: 'async',
          onerror: ev => { const box = ev.target.parentNode; if (box) { clearEl(box); box.appendChild(icon('cast')); } } })));
      }
      const logo = logos.get(st.id);
      const go2 = h('span.mu-st__go', { 'aria-hidden': 'true' }, icon(on ? 'square' : 'play', { fill: true }));
      const btn = h('button.mu-st__play', {
        dataset: { role: 'main' },
        'aria-label': on ? tx('Stop {name}', { name: st.name }) : tx('Play {name}, {genre}', { name: st.name, genre: st.genre }),
        'aria-pressed': String(on),
        onclick: () => (on ? pause() : startStation(st, true)),
      }, logo, h('span.mu-st__txt', h('b', { text: st.name }), h('small', { text: st.genre })), go2);
      const bits = [];
      const fav = radioFavs().includes(st.id);
      const tr = trouble.get(st.id);
      if (tr) bits.push(h('span.mu-st__trouble', { dataset: { role: 'trouble' }, title: tr.why === 'reported' ? tx('Reported as not playing — this mark lasts for this visit') : tx('Failed to play earlier this visit') }, icon('alert'), tr.why === 'reported' ? tx('Reported') : tx('Had trouble')));
      bits.push(h('button.ibtn.mu-st__fav', {
        type: 'button', class: fav ? 'is-on' : null, dataset: { role: 'fav' }, 'aria-pressed': fav ? 'true' : 'false',
        'aria-label': fav ? tx('Remove {name} from favorites', { name: st.name }) : tx('Add {name} to favorites', { name: st.name }),
        title: fav ? tx('Remove from favorites (shared with Static Radio)') : tx('Add to favorites (shared with Static Radio)'),
        onclick: () => toggleRadioFav(st.id),
      }, icon('heart', fav ? { fill: true } : undefined)));
      if (info) bits.push(h('span.mu-st__n', { title: tx('Listeners right now, as reported by SomaFM') }, h('i.mu-dot'), `${info.listeners.toLocaleString()} listening`));
      bits.push(h('a.mu-st__link', { href: st.page, target: '_blank', rel: 'noopener noreferrer', 'aria-label': tx('{name} on somafm.com (opens a new tab)', { name: st.name }) },
        tx('Station page'), icon('external-link')));
      let airLine = null;
      if (air) airLine = h('div.mu-st__air', h('span.label', { text: tx('On air') }), h('span.trunc', { text: `${air.title}${air.artist ? ` — ${air.artist}` : ''}` }));
      else if (info?.last) airLine = h('div.mu-st__air', h('span.label', { text: tx('Recently') }), h('span.trunc', { text: info.last }));
      return h('article.mu-st', { class: cur ? 'is-cur' : null, dataset: { key: `r:${st.id}` } },
        btn,
        h('p.mu-st__blurb', { text: st.blurb }),
        airLine,
        h('div.mu-st__foot', bits));
    }

    function radioView() {
      loadChannels();
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const frag = [];
      frag.push(h('div.mu-intro',
        h('div.mu-intro__ic', icon('cast')),
        h('div.mu-intro__txt',
          h('h3', { text: tx('Live radio from SomaFM (listener-supported)') }),
          h('p', { text: tx('An independent, commercial-free station in San Francisco, paid for by its listeners — not affiliated with StaticOS. The streams come straight from SomaFM and need the internet.') })),
        h('div.mu-intro__acts',
          h('a.btn.btn--sm', { href: `${SOMA}/support/`, target: '_blank', rel: 'noopener noreferrer', 'aria-label': tx('Support SomaFM (opens somafm.com in a new tab)') },
            icon('heart'), tx('Support SomaFM'), icon('external-link')),
          h('button.btn.btn--sm.btn--ghost', { onclick: () => api.openApp('spotify') }, icon('list-music'), tx('Spotify instead')))));
      if (offline) {
        frag.push(h('div.mu-banner', icon('wifi-off'),
          h('span', { text: tx('You’re offline. Radio needs the internet — the stations will play once you reconnect.') })));
      }
      /* favourites (Static Radio's hearts) come first */
      const favIds = radioFavs();
      const favs = favIds.map(id => STATIONS.find(st => st.id === id)).filter(Boolean);
      const rest = STATIONS.filter(st => !favIds.includes(st.id));
      const gridOf = (list, label) => {
        const grid = h('div.mu-stations', { role: 'list', 'aria-label': label });
        for (const st of list) {
          const card = stationCard(st);
          card.setAttribute('role', 'listitem');
          grid.appendChild(card);
        }
        return grid;
      };
      if (favs.length) {
        frag.push(h('div.mu-qhead.mu-rhead', icon('heart', { fill: true }), h('span.label', { text: tx('Favorites · {length}', { length: favs.length }) }),
          h('span.dim', { text: tx('saved on this device, shared with Static Radio') })));
        frag.push(gridOf(favs, 'Favorite stations'));
        if (rest.length) frag.push(h('div.mu-qhead.mu-rhead', h('span.label', { text: tx('All stations') })));
      }
      if (rest.length) frag.push(gridOf(rest, favs.length ? 'More SomaFM stations' : 'SomaFM stations'));
      return frag;
    }

    /* ---------------- ambient sounds (js/core/ambient.js) ----------------
       Built once per paint; after that every change from the engine (here,
       Control Centre, the sleep timer) is written into the same elements,
       so a slider being dragged is never rebuilt under the pointer. */
    const AM = { els: null, focus: null };
    const SD = { els: null };
    const SLEEP_LABEL = { 15: '15 min', 30: '30 min', 60: '1 hour', 90: '1½ hours' };
    const clock12 = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); const m = Math.floor(s / 60); return m >= 1 ? `${m} min` : `${s} s`; };
    const ambSig = () => AMB.sounds().map(x => x.id).join() + '|' + AMB.presets().map(p => p.id).join();

    function ambientView() {
      const st = AMB.state();
      const els = { sig: ambSig(), presets: new Map(), rows: new Map(), sleep: new Map() };
      AM.els = els;
      const frag = [];

      els.play = h('button.btn.btn--primary.mu-amb__play', { type: 'button', onclick: () => AMB.toggle() });
      els.status = h('span.mu-amb__status', { role: 'status', 'aria-live': 'polite' });
      frag.push(h('div.mu-intro.mu-amb__intro',
        h('div.mu-intro__ic', icon('cloud-rain')),
        h('div.mu-intro__txt',
          h('h3', { text: tx('Ambient sounds, made live in this browser') }),
          h('p', { text: tx('Rain, fire, wind, a café and brown noise are synthesised as they play — noise, filters and tiny grains of sound — so nothing is downloaded and they work offline. They mix with your music and keep playing when this window closes; stop them here or from Control Centre.') })),
        h('div.mu-intro__acts', els.play, els.status)));

      if (!st.supported) {
        frag.push(h('div.mu-banner', icon('alert'), h('span', { text: tx('This browser has no Web Audio, so StaticOS can’t make these sounds here.') })));
      }

      /* presets */
      const pBox = h('div.mu-amb__presets', { role: 'group', 'aria-label': tx('Presets') });
      for (const p of AMB.presets()) {
        const names = Object.keys(p.mix).map(id => AMB.SOUNDS.find(x => x.id === id)?.name).filter(Boolean);
        const b = h('button.mu-amb__preset', { type: 'button', dataset: { preset: p.id }, onclick: () => AMB.applyPreset(p.id) },
          h('span.mu-amb__pic', { 'aria-hidden': 'true' }, icon(p.icon)),
          h('span.mu-amb__ptxt', h('b', { text: p.name }), h('small', { text: p.note || names.join(', ') })));
        if (p.season) b.classList.add('is-season');
        els.presets.set(p.id, b);
        pBox.appendChild(b);
      }
      frag.push(h('div.mu-qhead', h('span.label', { text: tx('Presets') })), pBox);

      /* the mixer */
      const mix = h('div.mu-amb__mix', { role: 'group', 'aria-label': tx('Mixer') });
      for (const x of AMB.sounds()) {
        const out = h('span.mu-amb__pct', { 'aria-hidden': 'true' });
        const input = h('input.slider.mu-amb__range', {
          type: 'range', min: '0', max: '100', step: '1', 'aria-label': tx('{name} level', { name: x.name }), dataset: { sound: x.id },
          oninput: e => { const v = Number(e.target.value); out.textContent = `${v}%`; e.target.setAttribute('aria-valuetext', `${v}%`); AMB.setLevel(x.id, v / 100); },
        });
        const r = h('div.mu-amb__row', { dataset: { sound: x.id } },
          h('span.mu-amb__ic', { 'aria-hidden': 'true' }, icon(x.icon)),
          h('span.mu-amb__name', h('b', { text: x.name }), h('small', { text: x.note })),
          input, out);
        els.rows.set(x.id, { r, input, out });
        mix.appendChild(r);
      }
      frag.push(h('div.mu-qhead', h('span.label', { text: tx('Mixer') }), h('span.dim', { text: tx('each sound has its own level') })), mix);

      /* the sleep timer */
      const chips = h('div.mu-amb__chips', { role: 'group', 'aria-label': tx('Sleep timer') });
      for (const m of [0, ...AMB.SLEEP_CHOICES]) {
        const b = h('button.mu-amb__chip', { type: 'button', dataset: { sleep: String(m) }, onclick: () => AMB.setSleep(m) },
          m ? SLEEP_LABEL[m] || tx('{m} min', { m }) : tx('Off'));
        els.sleep.set(m, b);
        chips.appendChild(b);
      }
      els.sleepNote = h('small.mu-amb__sleepnote');
      frag.push(h('div.mu-qhead', icon('moon'), h('span.label', { text: tx('Sleep timer') })),
        h('div.mu-amb__sleep', chips, els.sleepNote));

      /* focus sessions: only where Clock › Focus exists (js/core/focus.js) */
      els.focus = h('div.mu-amb__focus.hidden');
      frag.push(els.focus);
      AMB.focusReady().then(okFocus => { if (okFocus && AM.els === els && !dead) paintAmbFocus(els); });
      return frag;     /* paintList syncs it once it is on screen */
    }

    function paintAmbFocus(els) {
      const f = AMB.state().focus;
      const sw = h('button.switch', { role: 'switch', type: 'button', 'aria-label': tx('Play during focus sessions'),
        'aria-checked': String(f.on), class: f.on ? 'is-on' : null,
        onclick: () => AMB.setFocus({ on: !AMB.state().focus.on }) });
      const sel = h('select.select', { 'aria-label': tx('Preset for focus sessions'), onchange: e => AMB.setFocus({ preset: e.target.value }) },
        AMB.presets().map(p => h('option', { value: p.id, selected: p.id === f.preset, text: p.name })));
      api.render(els.focus,
        h('div.mu-qhead', icon('clock'), h('span.label', { text: tx('Focus sessions') })),
        h('div.mu-amb__frow', sw,
          h('span.mu-amb__name', h('b', { text: tx('Play during focus sessions') }),
            h('small', { text: tx('When a focus session starts in Clock › Focus, this preset starts with it, and stops when the session pauses or ends.') })),
          sel));
      els.focus.classList.remove('hidden');
      els.focusSw = sw;
      els.focusSel = sel;
    }

    function syncAmbient(st = AMB.state()) {
      const els = AM.els;
      if (!els || !listBox.contains(els.play)) return;
      if (els.sig !== ambSig()) { paintList(); return; }   /* the season added or took away a layer */
      clearEl(els.play).append(icon(st.playing ? 'square' : 'play', { fill: !st.playing }), h('span', { text: st.playing ? tx('Stop') : tx('Play') }));
      els.play.setAttribute('aria-label', st.playing ? 'Stop ambient sounds' : 'Play ambient sounds');
      els.play.setAttribute('aria-pressed', String(st.playing));
      els.status.textContent = st.error ? st.error
        : st.playing ? `Playing · ${st.label}${st.byFocus ? ' · with your focus session' : ''}`
        : `Stopped · ${st.label}`;
      for (const [id, b] of els.presets) {
        const on = st.preset === id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      for (const [id, { r, input, out }] of els.rows) {
        const v = Math.round((st.levels[id] || 0) * 100);
        if (document.activeElement !== input) input.value = String(v);
        out.textContent = `${v}%`;
        input.setAttribute('aria-valuetext', `${v}%`);
        r.classList.toggle('is-on', v > 0);
      }
      const cur = st.sleep ? st.sleep.minutes : 0;
      for (const [m, b] of els.sleep) {
        b.classList.toggle('is-on', m === cur);
        b.setAttribute('aria-pressed', String(m === cur));
      }
      paintSleepNote(st);
      if (els.focusSw) {
        els.focusSw.classList.toggle('is-on', st.focus.on);
        els.focusSw.setAttribute('aria-checked', String(st.focus.on));
        if (document.activeElement !== els.focusSel) els.focusSel.value = st.focus.preset;
      }
    }
    function paintSleepNote(st = AMB.state()) {
      const els = AM.els;
      if (!els) return;
      const sl = st.sleep;
      els.sleepNote.textContent = !sl ? 'Off — the sounds play until you stop them.'
        : sl.fading ? `Fading out — stops at ${clock12(sl.endsAt)}.`
        : `Stops at ${clock12(sl.endsAt)}, in ${mmss(sl.left)}. The last minute fades out gently.`;
    }

    let radioKey = '';
    const radioSig = () => `${P.cur?.kind === 'radio' ? P.cur.st.id : ''}|${soundOn()}|${P.onAir?.title || ''}|${CH.at}|${CH.err || ''}|${navigator.onLine}|${radioFavs().join(',')}|${trouble.ids().join(',')}`;
    function paintList() {
      if (S.plDrag) return;                         /* never rebuild the rows out from under a drag */
      keepFocus(() => {
        /* a frame taken out of the page and put back reloads, and would stop the song Sonora is playing */
        if (S.view === 'sonora' && SO && listBox.contains(SO)) return;
        rowRefs.clear();
        radioKey = S.view === 'radio' ? radioSig() : '';
        clearEl(listBox);
        const v = S.view;
        content.dataset.view = v;
        toolsBox.classList.toggle('hidden', v !== 'songs' || !library().length);
        const pl = plOf(v);
        if (pl) content.dataset.view = 'playlist';
        if (v !== 'ambient') AM.els = null;
        if (v !== 'sound') SD.els = null;
        if (v !== 'tuner' && TU) TU.stop('The microphone was turned off when you left the Tuner.');
        const nodes = pl ? playlistView(pl) : v === 'lists' ? listsView() : v === 'radio' ? radioView() : v === 'queue' ? queueView()
          : v === 'ambient' ? ambientView() : v === 'books' ? booksView() : v === 'tuner' ? tunerView() : v === 'sonora' ? sonoraView() : v === 'lyrics' ? lyricsView() : v === 'sound' ? soundView()
          : v === 'most' || v === 'recent' ? playsView(v) : songsView();
        listBox.append(reportBox(), ...nodes.filter(Boolean));
        if (v === 'ambient') syncAmbient();
        if (v === 'sound') syncSound();
        if (v === 'lyrics') syncLyrics(true);
      });
    }

    function paintFoot() {
      clearEl(foot);
      const bits = [];
      if (S.busy) bits.push(h('span.mu-foot__busy', h('i.mu-spin'), S.busy));
      else if (S.flash) bits.push(h('span', { class: S.flash.bad ? 'mu-foot__bad' : 'mu-foot__ok', text: S.flash.text }));
      else if (plOf(S.view)) {
        const p = plOf(S.view);
        const tracks = plTracks(p);
        const { total, known } = plLength(tracks);
        const gone = tracks.filter(t => !t.e).length;
        bits.push(h('span.dim', { text: `${songCount(tracks.length)} in this playlist` }));
        if (total) bits.push(h('span.dim', { text: '·' }), h('span.dim', { text: `${dur(total)}${known ? '' : '+'} total` }));
        if (gone) bits.push(h('span.chip', icon('alert'), tx('{gone} no longer in Your music', { gone })));
        bits.push(h('div.grow'));
        if (P.from?.pl === p.id && P.cur?.kind === 'file') bits.push(h('span.chip.chip--accent', icon('play'), tx('Playing')));
        if (P.shuffle) bits.push(h('span.chip.chip--accent', icon('shuffle'), tx('Shuffle')));
      } else if (S.view === 'lists') {
        const n = plAll().length;
        bits.push(h('span.dim', { text: `${n} playlist${n === 1 ? '' : 's'} · kept in this browser` }));
      } else if (S.view === 'ambient') {
        const st = AMB.state();
        bits.push(h('span.dim', { text: tx('Synthesised live · nothing downloaded') }));
        bits.push(h('div.grow'));
        if (st.playing) bits.push(h('span.chip.chip--accent', icon('volume-2'), st.label));
        if (st.sleep) bits.push(h('span.chip', icon('moon'), tx('Sleep {minutes} min', { minutes: st.sleep.minutes })));
      } else if (S.view === 'books') {
        bits.push(h('span.dim', { text: tx('LibriVox recordings, in the public domain · played from archive.org') }));
      } else if (S.view === 'tuner') {
        bits.push(h('span.dim', { text: tx('Listens through your microphone · nothing is recorded') }));
      } else if (S.view === 'sonora') {
        bits.push(h('span.dim', { text: tx('Sonora keeps playing while this page is open; another page here stops it') }));
      } else if (S.view === 'radio') {
        bits.push(h('span.dim', { text: tx('{length} stations · 128 kbps MP3 from SomaFM', { length: STATIONS.length }) }));
        bits.push(h('div.grow'));
        const ago = Math.round((Date.now() - CH.at) / 60000);
        bits.push(h('span.dim', { text: CH.map
          ? `Listeners per SomaFM · ${ago < 1 ? 'just now' : `${ago} min ago`}`
          : CH.busy ? 'Asking SomaFM for listener counts…' : CH.err ? 'Couldn’t reach SomaFM for listener counts' : '' }));
      } else {
        const all = library();
        const known = all.map(e => durOf(e.node)).filter(d => typeof d === 'number');
        const total = known.reduce((a, b) => a + b, 0);
        const size = all.reduce((a, e) => a + (media.isMedia(e.node) ? e.node.size || 0 : 0), 0);
        const empty = all.filter(e => !media.isMedia(e.node)).length;
        const pending = all.filter(e => media.isMedia(e.node) && durOf(e.node) === undefined).length;
        bits.push(h('span.dim', { text: `${all.length} song${all.length === 1 ? '' : 's'}` }));
        if (all.length) {
          bits.push(h('span.dim', { text: '·' }), h('span.dim', { text: pending ? tx('reading lengths…') : `${dur(total)} total` }));
          bits.push(h('span.dim', { text: '·' }), h('span.dim', { text: `${bytes(size)} in ~/Music` }));
        }
        if (empty) bits.push(h('span.chip', icon('alert'), tx('{empty} with no audio', { empty })));
        bits.push(h('div.grow'));
        if (P.shuffle) bits.push(h('span.chip.chip--accent', icon('shuffle'), tx('Shuffle')));
        if (P.repeat !== 'off') bits.push(h('span.chip.chip--accent', icon('repeat'), P.repeat === 'one' ? tx('Repeat one') : tx('Repeat all')));
      }
      foot.append(...bits);
    }

    function paintAll() {
      if (!okView(S.view)) S.view = P.view = 'lists';       /* the playlist on screen was deleted */
      win.setTitle(viewTitle(S.view));
      paintSide();
      paintHero();
      paintList();
      paintFoot();
    }

    /* ---------------- the sound row under the seek bar ---------------- */
    function paintFx() {
      const c = P.cur, radio = c?.kind === 'radio', file = c?.kind === 'file';
      const ab = P.ab;
      abBtn.disabled = !file;
      abBtn.classList.toggle('hidden', radio);
      abBtn.classList.toggle('is-on', ab.a !== null);
      abBtn.setAttribute('aria-pressed', String(ab.a !== null));
      abBtn.lastChild.textContent = ab.a === null ? 'A–B loop' : ab.b === null ? `A ${dur(ab.a)} · now B` : `Loop ${dur(ab.a)}–${dur(ab.b)}`;
      abBtn.title = ab.a === null ? 'Mark the start (A) of a part to practise (L)' : ab.b === null ? 'Mark the end (B): the part between loops (L)' : 'Looping this part. Press to clear it (L)';
      const sp = fx.speed();
      speedBtn.classList.toggle('hidden', radio);
      speedBtn.disabled = !(file || c?.kind === 'book');
      speedBtn.classList.toggle('is-on', sp !== 1);
      speedBtn.lastChild.textContent = `${sp}×`;
      speedBtn.title = 'Playback speed';
      const sl = sleepT.state();
      sleepBtn.classList.toggle('is-on', !!sl);
      sleepBtn.lastChild.textContent = !sl ? 'Sleep timer' : sl.afterSong ? 'After this song' : `Stops in ${mmss(sl.left)}`;
      copyBtn.classList.toggle('hidden', !c);
      copyBtn.disabled = radio && !P.onAir;
      const kept = radio && P.onAir ? finds.has(P.onAir) : false;
      heartBtn.classList.toggle('hidden', !radio);
      heartBtn.disabled = !P.onAir;
      heartBtn.classList.toggle('is-on', kept);
      heartBtn.setAttribute('aria-pressed', String(kept));
      heartBtn.lastChild.textContent = kept ? 'Kept in your finds' : 'Keep this song';
      heartBtn.title = P.onAir ? 'Keep the song on air in your finds (Static Radio)' : 'SomaFM hasn’t said what is on yet';
      miniBtn.dataset.tip = S.mini ? 'Back to the full player (Z)' : 'Mini player (Z)';
      miniBtn.setAttribute('aria-label', S.mini ? 'Back to the full player' : 'Mini player');
      miniBtn.setAttribute('aria-pressed', String(S.mini));
      clearEl(miniBtn).appendChild(icon(S.mini ? 'maximize-2' : 'minimize-2'));
      miniBtn.classList.toggle('hidden', document.body.classList.contains('is-mobile'));
    }
    function speedMenu(ev) {
      const r = ev.currentTarget.getBoundingClientRect();
      const cur = fx.speed();
      api.menu(fx.SPEEDS.map(v => ({ label: `${v}×${v === 1 ? ' (normal)' : ''}`, icon: v === cur ? 'check' : 'dot', onClick: () => fx.setSpeed(v) })), r.left, r.bottom + 4);
    }
    function sleepMenu(ev) {
      const r = ev.currentTarget.getBoundingClientRect();
      const sl = sleepT.state();
      api.menu([
        { label: tx('Off'), icon: !sl ? 'check' : 'dot', onClick: () => sleepT.clear() },
        (P.cur?.kind === 'file' || P.cur?.kind === 'book') && { label: P.cur.kind === 'book' ? tx('After this chapter') : tx('After this song'), icon: sl?.afterSong ? 'check' : 'moon', onClick: () => sleepT.setAfterSong() },
        ...sleepT.CHOICES.map(m => ({ label: tx('{m} minutes', { m }), icon: sl && sl.minutes === m ? 'check' : 'moon', onClick: () => sleepT.set(m) })),
      ].filter(Boolean), r.left, r.bottom + 4);
    }
    async function copySong() {
      const t = trackInfo();
      if (!t) return;
      const air = P.onAir;
      const text = t.live ? (air ? `${air.artist ? `${air.artist} - ` : ''}${air.title}` : '')
        : `${t.artist && t.artist !== 'Unknown artist' ? `${t.artist} - ` : ''}${t.title}`;
      if (!text) { flash('SomaFM hasn’t said what is on yet.', true); return; }
      try { await navigator.clipboard.writeText(text); flash(`Copied “${text}”.`); }
      catch (e) { flash(`Copying was blocked. The song is: ${text}`, true); }
    }
    function heartSong() {
      if (P.cur?.kind !== 'radio' || !P.onAir) return;
      const now = finds.toggle(P.onAir, P.cur.st.id);
      flash(now ? `Kept “${P.onAir.title}” in your finds — Static Radio › Song finds.` : `Removed “${P.onAir.title}” from your finds.`);
      paintFx();
    }

    /* mini player: the same player in a small window kept on top; Z or the button puts it back */
    function setMini(on) {
      on = !!on && !document.body.classList.contains('is-mobile');
      if (on === S.mini) return;
      S.mini = on;
      shell.classList.toggle('mu--mini', on);
      if (on) {
        S.keep = { x: win.x, y: win.y, w: win.w, h: win.h, minW: win.el.style.minWidth, minH: win.el.style.minHeight, pinned: !!win.pinned };
        win.el.style.minWidth = '300px';
        win.el.style.minHeight = '120px';
        setRect(win, { x: win.x + Math.max(0, win.w - 380), y: win.y, w: 380, h: 138 });
        if (!win.pinned) setPinned(win, true);
      } else if (S.keep) {
        const k = S.keep;
        S.keep = null;
        win.el.style.minWidth = k.minW;
        win.el.style.minHeight = k.minH;
        setRect(win, { x: Math.max(0, win.x + win.w - k.w), y: win.y, w: k.w, h: k.h });
        if (!k.pinned && win.pinned) setPinned(win, false);
      }
      paintFx();
    }

    /* ---------------- lyrics: a .lrc or .txt beside the song ---------------- */
    const LY = { sig: '', data: null, els: [], idx: -2, box: null };
    const lyricsSig = () => {
      const c = P.cur;
      if (c?.kind !== 'file') return c ? c.kind : 'none';
      const f = findLyrics(c.node, c.path);
      return `${c.node.content}|${f ? `${f.path}|${f.text.length}` : ''}`;
    };
    function lyricsView() {
      const c = P.cur;
      LY.sig = lyricsSig();
      LY.data = null; LY.els = []; LY.idx = -2; LY.box = null;
      if (!c) {
        return [h('div.mu-empty.mu-empty--sm', h('div.mu-empty__art', icon('align-left')), h('h3', { text: tx('Play a song to see its lyrics') }),
          h('p', { text: tx('Lyrics come from a file beside the song: Song.lrc (timed, so the line being sung lights up) or Song.txt (plain words). StaticOS never looks them up on the internet.') }))];
      }
      if (c.kind === 'book') {
        return [h('div.mu-empty.mu-empty--sm', h('div.mu-empty__art', icon('mic')), h('h3', { text: tx('Audiobooks have no lyrics') }),
          h('p', { text: tx('The words of a LibriVox recording are the book itself; the LibriVox page for it links the text.') }))];
      }
      if (c.kind === 'radio') {
        return [h('div.mu-empty.mu-empty--sm', h('div.mu-empty__art', icon('cast')), h('h3', { text: tx('Radio has no lyrics file') }),
          h('p', { text: tx('Lyrics are read from a file beside one of your own songs. A live station plays whatever SomaFM is broadcasting, and StaticOS doesn’t fetch lyrics for it.') }))];
      }
      const t = describe(c.node);
      const f = findLyrics(c.node, c.path);
      if (!f) {
        return [h('div.mu-empty.mu-empty--sm', { dataset: { role: 'lyrics-none' } }, h('div.mu-empty__art', icon('align-left')),
          h('h3', { text: tx('No lyrics beside “{title}”', { title: t.title }) }),
          h('p', { text: `Put a file named “${siblingNames(c.node.name)[0]}” (timed) or “${siblingNames(c.node.name)[1]}” (plain) in the same folder, or add one now. It stays on this device.` }),
          h('div.mu-empty__acts', h('button.btn.btn--primary', { dataset: { role: 'add-lyrics' }, onclick: () => lyricIn.click() }, icon('upload'), tx('Add a .lrc or .txt file'))))];
      }
      const data = parseLyrics(f.text, { lrc: f.lrc });
      LY.data = data;
      const box = h('div.mu-ly', { dataset: { synced: String(data.synced) } });
      LY.box = box;
      data.lines.forEach((ln, i) => {
        const el = data.synced
          ? h('button.mu-ly__line', { type: 'button', dataset: { i: String(i), t: String(ln.t) }, title: `Go to ${dur(ln.t)}`, onclick: () => seek(ln.t) }, ln.text || '♪')
          : h('p.mu-ly__line', { dataset: { i: String(i) }, text: ln.text || ' ' });
        LY.els.push(el);
        box.appendChild(el);
      });
      return [
        h('div.mu-qhead', icon('align-left'), h('span.label', { text: t.title }),
          h('span.dim', { text: `${data.synced ? 'Synced' : 'Plain'} · from ${f.name}` }), h('div.grow'),
          h('button.btn.btn--sm.btn--ghost', { dataset: { role: 'add-lyrics' }, onclick: () => lyricIn.click() }, icon('upload'), tx('Replace'))),
        data.lines.length ? box : h('p.mu-qnone', { text: tx('That file has no lyrics in it.') }),
      ];
    }
    /** light the line being sung and keep it in view */
    function syncLyrics(force) {
      if (S.view !== 'lyrics' || !LY.data?.synced || !LY.els.length) return;
      const i = activeLine(LY.data.lines, (audio.currentTime || 0) + 0.05);
      if (i === LY.idx && !force) return;
      LY.idx = i;
      LY.els.forEach((el, k) => {
        const on = k === i;
        if (el.classList.contains('is-on') !== on) el.classList.toggle('is-on', on);
        el.classList.toggle('is-past', k < i);
      });
      const el = LY.els[i];
      if (el && content.clientHeight) {
        const top = el.offsetTop - content.clientHeight / 2 + el.offsetHeight / 2;
        try { content.scrollTo({ top: Math.max(0, top), behavior: reduced() || force ? 'auto' : 'smooth' }); } catch (e) { content.scrollTop = Math.max(0, top); }
      }
    }
    async function addLyricsFile(f) {
      const c = P.cur;
      if (!f) return;
      if (c?.kind !== 'file' || !c.path) { flash('Play one of your songs first, then add its lyrics.', true); return; }
      if (f.size > 512 * 1024) { flash(`“${f.name}” is too big to be lyrics.`, true); return; }
      const ext = /\.lrc$/i.test(f.name) ? '.lrc' : '.txt';
      const text = await f.text();
      if (dead) return;
      const target = `${vfs.parentPath(c.path)}/${stemOf(c.node.name)}${ext}`;
      vfs.write(target, text);
      flash(`Saved the lyrics as ${vfs.baseName(target)}, beside the song.`);
      if (S.view === 'lyrics') paintList();
    }

    /* ---------------- Sound: equalizer, speed, crossfade, sleep timer, radio quality ---------------- */
    function soundView() {
      const els = { presets: new Map(), speed: new Map(), sleep: new Map(), quality: new Map(), bands: [] };
      SD.els = els;
      const frag = [];
      frag.push(h('div.mu-intro', h('div.mu-intro__ic', icon('sliders')),
        h('div.mu-intro__txt', h('h3', { text: tx('Shape the sound') }),
          h('p', { text: tx('An equalizer, playback speed, a crossfade between songs and a sleep timer for songs and stations. They change how StaticOS plays; nothing is sent anywhere.') }))));

      /* equalizer */
      els.eqSw = h('button.switch', { role: 'switch', type: 'button', 'aria-label': tx('Equalizer'), dataset: { role: 'eq-switch' }, onclick: () => fx.setEqOn(!fx.EQ().on) });
      els.eqNote = h('small.mu-eq__note', { role: 'status', dataset: { role: 'eq-note' } });
      frag.push(h('div.mu-qhead', icon('sliders'), h('span.label', { text: tx('Equalizer') }), els.eqSw, h('div.grow'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { role: 'eq-reset' }, onclick: () => fx.resetEq() }, icon('rotate-ccw'), tx('Reset'))));
      const pre = h('div.mu-amb__presets.mu-eq__presets', { role: 'group', 'aria-label': tx('Equalizer presets') });
      for (const pr of fx.PRESETS) {
        const b = h('button.mu-amb__chip', { type: 'button', dataset: { preset: pr.id }, onclick: () => fx.setPreset(pr.id) }, pr.name);
        els.presets.set(pr.id, b);
        pre.appendChild(b);
      }
      frag.push(pre);
      const bands = h('div.mu-eq__bands', { role: 'group', 'aria-label': tx('Equalizer bands, 12 decibels either way') });
      fx.BANDS.forEach((f, i) => {
        const out = h('span.mu-eq__db', { 'aria-hidden': 'true' });
        const input = h('input.mu-eq__band', { type: 'range', min: String(-fx.RANGE), max: String(fx.RANGE), step: '0.5', value: '0',
          'aria-label': `${fx.BAND_LABELS[i]} hertz`, 'aria-orientation': 'vertical', dataset: { band: String(i) },
          oninput: e => fx.setGain(i, Number(e.target.value)) });
        els.bands.push({ input, out });
        bands.appendChild(h('div.mu-eq__col', out, input, h('span.mu-eq__hz', { 'aria-hidden': 'true', text: fx.BAND_LABELS[i] })));
      });
      frag.push(bands, els.eqNote);

      /* speed */
      const sp = h('div.mu-amb__chips', { role: 'group', 'aria-label': tx('Playback speed') });
      for (const v of fx.SPEEDS) {
        const b = h('button.mu-amb__chip', { type: 'button', dataset: { speed: String(v) }, onclick: () => fx.setSpeed(v) }, `${v}×`);
        els.speed.set(v, b);
        sp.appendChild(b);
      }
      frag.push(h('div.mu-qhead', icon('gauge'), h('span.label', { text: tx('Speed') }), h('span.dim', { text: tx('your own songs · pitch stays the same') })), sp);

      /* crossfade */
      els.xfOut = h('span.mu-amb__pct', { 'aria-hidden': 'true' });
      els.xf = h('input.slider.mu-amb__range', { type: 'range', min: '0', max: String(fx.XFADE_MAX), step: '1', 'aria-label': tx('Crossfade between songs, in seconds'), dataset: { role: 'xfade' },
        oninput: e => fx.setCrossfade(Number(e.target.value)) });
      frag.push(h('div.mu-qhead', icon('shuffle'), h('span.label', { text: tx('Crossfade') }), h('span.dim', { text: tx('the end of one song fades into the next') })),
        h('div.mu-amb__row', h('span.mu-amb__name', h('b', { text: tx('Overlap') }), h('small', { text: tx('Not used on the last song, on Repeat this song, or on radio.') })), els.xf, els.xfOut));

      /* sleep timer */
      const chips = h('div.mu-amb__chips', { role: 'group', 'aria-label': tx('Sleep timer') });
      const choice = (key, label, fn) => {
        const b = h('button.mu-amb__chip', { type: 'button', dataset: { sleep: key }, onclick: fn }, label);
        els.sleep.set(key, b);
        chips.appendChild(b);
      };
      choice('off', 'Off', () => sleepT.clear());
      choice('song', 'After this song', () => sleepT.setAfterSong());
      for (const m of sleepT.CHOICES) choice(String(m), m === 60 ? '1 hour' : m === 90 ? '1½ hours' : `${m} min`, () => sleepT.set(m));
      els.sleepNote = h('small.mu-amb__sleepnote', { role: 'status', dataset: { role: 'sleep-note' } });
      frag.push(h('div.mu-qhead', icon('moon'), h('span.label', { text: tx('Sleep timer') }), h('span.dim', { text: tx('songs and stations · Ambient sounds have their own') })),
        h('div.mu-amb__sleep', chips, els.sleepNote));

      /* radio stream quality */
      const qs = h('div.mu-amb__chips', { role: 'group', 'aria-label': tx('Radio stream quality') });
      for (const q of QUALITIES) {
        const b = h('button.mu-amb__chip', { type: 'button', dataset: { quality: q.id }, title: q.detail, onclick: () => { setQuality(q.id); syncSound(); } }, `${q.label} · ${q.detail}`);
        els.quality.set(q.id, b);
        qs.appendChild(b);
      }
      frag.push(h('div.mu-qhead', icon('cast'), h('span.label', { text: tx('Radio stream') }), h('span.dim', { text: tx('applies the next time a station starts · Static Radio uses it too') })), qs,
        h('small.mu-amb__sleepnote', { text: tx('The 64 and 32 kbps streams are SomaFM’s own low-bandwidth AAC streams for slow connections. If this browser can’t play one, the 128 kbps MP3 plays instead.') }));
      return frag;
    }
    function syncSound() {
      const els = SD.els;
      if (!els || !listBox.contains(els.eqSw)) return;
      const e = fx.EQ(), st = fx.status();
      els.eqSw.classList.toggle('is-on', e.on);
      els.eqSw.setAttribute('aria-checked', String(e.on));
      for (const [id, b] of els.presets) {
        const on = e.on ? e.preset === id : id === 'flat';
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      e.gains.forEach((g, i) => {
        const { input, out } = els.bands[i];
        if (document.activeElement !== input) input.value = String(g);
        out.textContent = `${g > 0 ? '+' : ''}${g}`;
        input.setAttribute('aria-valuetext', `${g > 0 ? '+' : ''}${g} decibels`);
        input.disabled = false;
      });
      els.eqNote.textContent = !e.on ? 'Off — the sound is played as it is. Pick a preset or drag a band to turn it on.'
        : st.active ? 'On. Songs and stations on SomaFM’s CORS servers are shaped; the wallpaper visualizer keeps working.'
        : st.why;
      for (const [v, b] of els.speed) { const on = fx.speed() === v; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
      const x = fx.crossfade();
      if (document.activeElement !== els.xf) els.xf.value = String(x);
      els.xfOut.textContent = x ? `${x} s` : 'Off';
      els.xf.setAttribute('aria-valuetext', x ? `${x} seconds` : 'Off');
      const sl = sleepT.state();
      const cur = !sl ? 'off' : sl.afterSong ? 'song' : String(sl.minutes);
      for (const [k, b] of els.sleep) { b.classList.toggle('is-on', k === cur); b.setAttribute('aria-pressed', String(k === cur)); }
      els.sleepNote.textContent = !sl ? 'Off — sound plays until you stop it.'
        : sl.afterSong ? 'Stops when the song that is playing ends.'
        : sl.fading ? `Fading out — stops at ${clock12(sl.endsAt)}.`
        : `Stops at ${clock12(sl.endsAt)}, in ${mmss(sl.left)}. The last seconds fade out gently. This only runs while StaticOS is open.`;
      const q = streamQuality();
      for (const [k, b] of els.quality) { b.classList.toggle('is-on', k === q); b.setAttribute('aria-pressed', String(k === q)); }
    }

    /* ---------------- Most played / Recently played ---------------- */
    function playsView(kind) {
      const all = playsAll();
      const home = homeAudio();
      const rows = Object.entries(all).map(([ref, v]) => ({ ...v, ref, e: home.byRef.get(ref) || null }));
      const live = rows.filter(r => r.e);
      const gone = rows.length - live.length;
      live.sort(kind === 'most' ? (a, b) => b.n - a.n || b.last - a.last : (a, b) => b.last - a.last);
      const list = live.slice(0, 50);
      const frag = [h('div.mu-qhead',
        h('span.label', { text: `${kind === 'most' ? 'Most played' : 'Recently played'} · ${list.length}` }),
        h('span.dim', { text: tx('a song counts once you have listened to half of it (or 30 seconds)') }),
        h('div.grow'),
        rows.length ? h('button.btn.btn--sm.btn--ghost', { dataset: { role: 'clear-plays' }, onclick: async () => {
          const yes = await api.confirm({ title: tx('Clear your listening history?'), ok: 'Clear it', danger: true, message: tx('Most played and Recently played start again from nothing. Your songs and playlists are not touched.') });
          if (yes && !dead) { clearPlays(); flash('Cleared your listening history.'); }
        } }, tx('Clear history')) : null)];
      if (!list.length) {
        frag.push(h('div.mu-empty.mu-empty--sm', h('div.mu-empty__art', icon(kind === 'most' ? 'bar-chart' : 'clock')),
          h('h3', { text: tx('Nothing here yet') }),
          h('p', { text: tx('Songs show up after you have really listened to them — half the song, or 30 seconds, whichever comes first. Skipping past one doesn’t count.') }),
          h('div.mu-empty__acts', h('button.btn', { onclick: () => go('songs') }, icon('music'), tx('Your music')))));
        return frag;
      }
      const ul = h('div.mu-list', { role: 'list', 'aria-label': kind === 'most' ? tx('Most played') : tx('Recently played') });
      list.forEach((r, i) => ul.appendChild(songRow(r.e, i + 1, list.map(x => x.e),
        { badge: kind === 'most' ? `${r.n} play${r.n === 1 ? '' : 's'}` : api.fmt.fmtAgo(r.last) })));
      frag.push(ul);
      if (gone) frag.push(h('p.mu-plhint', { text: `${gone} played song${gone === 1 ? ' is' : 's are'} no longer in Your music, so ${gone === 1 ? 'it isn’t' : 'they aren’t'} listed.` }));
      return frag;
    }

    /* ---------------- what an import or an .m3u skipped, and why ---------------- */
    function reportBox() {
      const r = S.report;
      if (!r) return null;
      return h('section.mu-report', { dataset: { role: 'report' }, 'aria-label': r.title },
        h('div.mu-report__head', icon(r.lines.length ? 'alert' : 'check'), h('b', { text: r.title }), h('div.grow'),
          h('button.ibtn', { 'aria-label': tx('Dismiss'), dataset: { role: 'report-x' }, onclick: () => { S.report = null; paintList(); } }, icon('x'))),
        r.lines.length ? h('ul.mu-report__list', r.lines.slice(0, 200).map(l => h('li', h('span.trunc', { text: l.name, title: l.name }), h('small', { text: l.why })))) : null,
        r.lines.length > 200 ? h('small.dim', { text: `…and ${r.lines.length - 200} more.` }) : null);
    }

    /* ---------------- actions ---------------- */
    function flash(text, bad = false) {
      S.flash = { text, bad };
      paintFoot();
      clearTimeout(flash.t);
      flash.t = setTimeout(() => { S.flash = null; if (!dead) paintFoot(); }, 6000);
    }

    function shuffleAll(list) {
      const nodes = (list || sortedLibrary()).map(e => e.node).filter(playable);
      if (!nodes.length) return;
      P.shuffle = true;
      store.set('prefs.musicShuffle', true);
      playFrom(nodes, nodes[Math.floor(Math.random() * nodes.length)]);
    }

    async function importAudio(fileList) {
      return importItems(Array.from(fileList || []).map(file => ({ file, rel: file.name })));
    }
    /* items: [{ file, rel }] — rel is the path inside what was picked or dropped ("Album/01 Song.mp3"),
       so a folder keeps its sub-folders under ~/Music. A .lrc or .txt joins the song with the same name
       beside it. Anything left out is listed with the reason, never silently. */
    async function importItems(items) {
      items = (items || []).filter(it => it && it.file);
      if (!items.length) return;
      const isAudio = f => media.kindOf(f.type) === 'audio' || media.kindOf(f.name) === 'audio';
      const isLyric = f => /\.(lrc|txt)$/i.test(f.name);
      const songs = items.filter(it => isAudio(it.file));
      const lyrics = items.filter(it => !isAudio(it.file) && isLyric(it.file));
      const skipped = items.filter(it => !isAudio(it.file) && !isLyric(it.file))
        .map(it => ({ name: it.rel || it.file.name, why: whyNotSong(it.file.name, it.file.type) }));
      const dirOf = rel => {
        const segs = String(rel || '').split('/').slice(0, -1).map(cleanSeg).filter(x => x && x !== '.' && x !== '..').slice(0, 6);
        return segs.length ? `${DIR}/${segs.join('/')}` : DIR;
      };
      const saved = [], failed = [], iffy = [], dup = [];
      const where = new Map();                  /* "dir/stem" of the original -> { dir, stem } of the file now in Your music */
      const keyFor = (dir, stem) => `${dir}/${stem.toLowerCase()}`;
      let n = 0;
      for (const it of songs) {
        n++;
        S.busy = `Importing ${n} of ${songs.length}…`;
        paintFoot();
        const f = it.file;
        const dir = dirOf(it.rel);
        /* keep the name, but give it an audio extension the library will know
           (an audio/webm recording named .webm would otherwise count as video) */
        let name = f.name;
        if (media.kindOf(name) !== 'audio') name = `${stemOf(name)}.${media.extFor(f.type) || 'mp3'}`;
        const there = vfs.node(`${dir}/${name}`);
        if (there && there.type === 'file' && Number(there.size) === f.size) {
          dup.push(it.rel || f.name);
          skipped.push({ name: it.rel || f.name, why: 'already in Your music' });
          where.set(keyFor(dir, stemOf(f.name)), { dir, stem: stemOf(name) });
          continue;
        }
        try {
          const r = await media.save(dir, name, f);
          saved.push(r);
          where.set(keyFor(dir, stemOf(f.name)), { dir, stem: stemOf(vfs.baseName(r.path)) });
          if (f.type && audio && audio.canPlayType(f.type) === '') iffy.push(vfs.baseName(r.path));
        } catch (e) {
          failed.push(`${f.name} (${/quota/i.test(String(e?.name || e?.message)) ? 'browser storage is full' : e?.message || 'could not be saved'})`);
          skipped.push({ name: it.rel || f.name, why: /quota/i.test(String(e?.name || e?.message)) ? 'browser storage is full' : (e?.message || 'could not be saved') });
        }
      }
      /* lyrics join their songs */
      let lyricsSaved = 0;
      for (const it of lyrics) {
        const f = it.file;
        const dir = dirOf(it.rel);
        const w = where.get(keyFor(dir, stemOf(f.name)));
        if (!w) { skipped.push({ name: it.rel || f.name, why: 'no song with the same name beside it' }); continue; }
        if (f.size > 512 * 1024) { skipped.push({ name: it.rel || f.name, why: 'too big to be lyrics' }); continue; }
        const target = `${w.dir}/${w.stem}${/\.lrc$/i.test(f.name) ? '.lrc' : '.txt'}`;
        if (vfs.node(target)) { skipped.push({ name: it.rel || f.name, why: 'those lyrics are already there' }); continue; }
        try { vfs.write(target, await f.text()); lyricsSaved++; } catch (e) { skipped.push({ name: it.rel || f.name, why: 'could not be read' }); }
      }
      S.busy = '';
      if (dead) return;
      const parts = [];
      if (saved.length) parts.push(`Added ${saved.length} song${saved.length === 1 ? '' : 's'} to Your music.`);
      if (lyricsSaved) parts.push(`${lyricsSaved} lyrics file${lyricsSaved === 1 ? '' : 's'} went in beside ${lyricsSaved === 1 ? 'its song' : 'their songs'}.`);
      if (dup.length) parts.push(`${dup.length} ${dup.length === 1 ? 'was' : 'were'} already there.`);
      if (skipped.length - dup.length > 0) parts.push(`Skipped ${skipped.length - dup.length} — see the list below.`);
      if (iffy.length) parts.push(`This browser may not play ${iffy.slice(0, 3).join(', ')}${iffy.length > 3 ? '…' : ''}.`);
      if (!parts.length) parts.push('Nothing to import.');
      S.report = skipped.length || iffy.length
        ? { title: `${saved.length} song${saved.length === 1 ? '' : 's'} added, ${skipped.length} skipped`,
            lines: [...skipped, ...iffy.map(x => ({ name: x, why: 'imported, but this browser may not be able to play it' }))] }
        : null;
      if (S.view !== 'songs' && saved.length) go('songs');
      else paintList();
      flash(parts.join(' '), !saved.length || failed.length > 0);
      if (saved.length) {
        api.notify({ app: 'Music', icon: 'music', title: parts[0], message: saved.map(r => vfs.baseName(r.path)).slice(0, 3).join(', ') + (saved.length > 3 ? '…' : ''), timeout: 4000 });
      }
    }

    async function download(e) {
      const blob = await media.blobOf(e.node).catch(() => null);
      if (dead) return;
      if (!blob) { flash(`There’s nothing to download: “${e.node.name}” has no audio in it.`, true); return; }
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: e.node.name, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      a.remove();
      const t = setTimeout(() => { URL.revokeObjectURL(url); pendingUrls.delete(rec); }, 20000);
      const rec = { url, t };
      pendingUrls.add(rec);
      flash(`Downloading “${e.node.name}” (${bytes(blob.size)}).`);
    }

    function commitRename(node, value, refocus) {
      const path = alive(node);
      if (!path) { S.renaming = null; paintList(); return; }
      const ext = extOf(node.name);
      const clean = String(value || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      const nextName = `${clean}${ext}`;
      if (!clean || nextName === node.name) {
        S.renaming = null; S.renameErr = '';
        paintList();
        if (refocus) focusRow(node);
        return;
      }
      if (vfs.node(`${vfs.parentPath(path)}/${nextName}`)) {
        S.renameErr = `There’s already a file called “${nextName}”.`;
        if (refocus) { paintList(); return; }
        S.renaming = null; S.renameErr = '';
        flash(`Not renamed: there’s already a file called “${nextName}”.`, true);
        paintList();
        return;
      }
      S.renaming = null; S.renameErr = '';
      vfs.rename(path, nextName);
      if (refocus) focusRow(node);
    }

    function trash(node) {
      const path = alive(node);
      if (!path) return;
      const name = node.name, dir = vfs.parentPath(path);
      if (!vfs.rm(path)) { flash(`Couldn’t move “${name}” to the Trash.`, true); return; }
      api.notify({ app: 'Music', icon: 'trash', title: tx('Moved to the Trash'), message: name, timeout: 7000,
        actions: [{ label: tx('Undo'), onClick: () => {
          if (!vfs.node(`${TRASH}/${node.name}`) || vfs.node(`${TRASH}/${node.name}`) !== node) return;
          if (vfs.mv(`${TRASH}/${node.name}`, dir) && node.name !== name && !vfs.node(`${dir}/${name}`)) vfs.rename(`${dir}/${node.name}`, name);
        } }] });
    }

    function rowMenu(ev, e, list) {
      ev.preventDefault?.();
      const n = e.node;
      const has = media.isMedia(n);
      const cur = isCurNode(n);
      const fileQueue = P.cur?.kind === 'file';
      const r = ev.currentTarget?.getBoundingClientRect?.();
      const x = ev.clientX || (r ? r.left : 0), y = ev.clientY || (r ? r.bottom : 0);
      api.menu([
        { label: cur && soundOn() ? tx('Pause') : tx('Play'), icon: cur && soundOn() ? 'pause' : 'play', disabled: !has,
          onClick: () => (cur ? toggle() : playFrom(list.map(x2 => x2.node), n)) },
        fileQueue && !cur && { label: tx('Play next'), icon: 'chevrons-right', disabled: !has, onClick: () => { playNext(n); flash(`“${e.title}” plays next.`); } },
        fileQueue && !cur && { label: tx('Add to queue'), icon: 'list-music', disabled: !has, onClick: () => { addToQueue(n); flash(`Added “${e.title}” to Up next.`); } },
        { label: tx('Add to playlist'), icon: 'list-plus', disabled: !has, items: [
          ...plAll().map(p => {
            const inIt = has && p.tracks.some(t => t.ref === n.content);
            return { label: inIt ? tx('{name} (already in it)', { name: p.name }) : p.name, icon: inIt ? 'check' : 'list', disabled: inIt, onClick: () => addTo(p.id, n) };
          }),
          plAll().length ? '-' : null,
          { label: tx('New playlist…'), icon: 'plus', onClick: () => newPlaylist([n]) },
        ].filter(Boolean) },
        '-',
        { label: tx('Download to this computer'), icon: 'download', disabled: !has, onClick: () => download(e) },
        { label: tx('Rename…'), icon: 'edit-3', onClick: () => { S.renaming = n; S.renameErr = ''; paintList(); } },
        { label: tx('Show in Files'), icon: 'folder-open', onClick: () => api.openApp('files', { path: vfs.parentPath(alive(n) || DIR) }) },
        '-',
        { label: tx('Move to Trash'), icon: 'trash', danger: true, onClick: () => trash(n) },
      ].filter(Boolean), x, y);
    }

    function sortMenu(ev) {
      const r = ev.currentTarget.getBoundingClientRect();
      const s = currentSort();
      api.menu(Object.entries(SORTS).map(([k, v]) => ({
        label: v.label, icon: s === k ? 'check' : 'dot', onClick: () => { store.set('prefs.musicSort', k); paintList(); },
      })), ev.clientX || r.left, ev.clientY || r.bottom);
    }

    function moreMenu(ev) {
      const r = ev.currentTarget.getBoundingClientRect();
      const mode = m => () => setRepeat(m);
      api.menu([
        { label: tx('Import songs…'), icon: 'upload', onClick: pickFiles },
        { label: tx('Import a folder…'), icon: 'folder', onClick: pickFolder },
        { label: tx('Shuffle all'), icon: 'shuffle', disabled: !playableLibrary().length, onClick: () => shuffleAll() },
        '-',
        { label: tx('Repeat off'), icon: P.repeat === 'off' ? 'check' : 'dot', onClick: mode('off') },
        { label: tx('Repeat all'), icon: P.repeat === 'all' ? 'check' : 'repeat', onClick: mode('all') },
        { label: tx('Repeat this song'), icon: P.repeat === 'one' ? 'check' : 'repeat', onClick: mode('one') },
        '-',
        { label: tx('Open Music folder'), icon: 'folder', onClick: () => api.openApp('files', { path: DIR }) },
        { label: tx('Open Spotify'), icon: 'list-music', onClick: () => api.openApp('spotify') },
        '-',
        { label: S.mini ? tx('Back to the full player') : tx('Mini player'), icon: 'minimize-2', onClick: () => setMini(!S.mini) },
        { label: tx('Keyboard shortcuts'), icon: 'keyboard', onClick: () => showKeys(true) },
      ], ev.clientX || r.left, ev.clientY || r.bottom);
    }

    /* ---------------- drag and drop ---------------- */
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    const onDragEnter = e => { if (!hasFiles(e)) return; e.preventDefault(); S.drag++; shell.classList.add('is-drop'); };
    const onDragOver = e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const onDragLeave = e => { if (!hasFiles(e)) return; S.drag = Math.max(0, S.drag - 1); if (!S.drag) shell.classList.remove('is-drop'); };
    /* a dropped folder arrives as an entry to walk, not as files */
    async function walkEntry(entry, prefix, out) {
      if (entry.isFile) {
        await new Promise(res => entry.file(file => { out.push({ file, rel: `${prefix}${file.name}` }); res(); }, () => res()));
      } else if (entry.isDirectory && prefix.split('/').length < 8) {
        const r = entry.createReader();
        for (;;) {
          const batch = await new Promise(res => r.readEntries(res, () => res([])));
          if (!batch.length) break;
          for (const ch of batch) await walkEntry(ch, `${prefix}${entry.name}/`, out);
        }
      }
    }
    const onDrop = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      S.drag = 0;
      shell.classList.remove('is-drop');
      const dt = e.dataTransfer;
      const entries = [...(dt.items || [])].map(it => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null));
      if (entries.some(en => en && en.isDirectory)) {
        const out = [];
        Promise.all(entries.filter(Boolean).map(en => walkEntry(en, '', out))).then(() => importItems(out));
        return;
      }
      importAudio(dt.files);
    };
    shell.addEventListener('dragenter', onDragEnter);
    shell.addEventListener('dragover', onDragOver);
    shell.addEventListener('dragleave', onDragLeave);
    shell.addEventListener('drop', onDrop);
    disposers.push(() => {
      shell.removeEventListener('dragenter', onDragEnter);
      shell.removeEventListener('dragover', onDragOver);
      shell.removeEventListener('dragleave', onDragLeave);
      shell.removeEventListener('drop', onDrop);
    });

    /* ---------------- keyboard ---------------- */
    const onKey = e => {
      if (!win.el.classList.contains('is-active') || e.defaultPrevented) return;
      const a = document.activeElement;
      if (a && a !== document.body && !win.el.contains(a)) return;
      const tag = e.target.tagName;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === ' ' || k === 'k' || k === 'K') {
        if (k === ' ' && (tag === 'BUTTON' || tag === 'A' || e.target.getAttribute?.('role') === 'slider')) return;
        e.preventDefault(); toggle();
      } else if (k === 'n' || k === 'N') { e.preventDefault(); next(); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); prev(); }
      else if (k === 'm' || k === 'M') { e.preventDefault(); store.set('prefs.muted', store.get('prefs.muted') !== true); }
      else if ((k === 'ArrowRight' || k === 'ArrowLeft') && (P.cur?.kind === 'file' || P.cur?.kind === 'book') && e.target.getAttribute?.('role') !== 'slider') {
        e.preventDefault(); seek((audio.currentTime || 0) + (k === 'ArrowRight' ? 5 : -5));
      } else if (k === '/' && S.view === 'songs') {
        if (!toolsBox.classList.contains('hidden')) { e.preventDefault(); searchIn.focus(); }
      } else if (k === 'l' || k === 'L') { e.preventDefault(); abStep(); }
      else if (k === ',' || k === '.') {
        if (P.cur?.kind !== 'file' && P.cur?.kind !== 'book') return;
        e.preventDefault();
        const i = fx.SPEEDS.indexOf(fx.speed());
        const at = i < 0 ? fx.SPEEDS.indexOf(1) : i;
        fx.setSpeed(fx.SPEEDS[clamp(at + (k === '.' ? 1 : -1), 0, fx.SPEEDS.length - 1)]);
      } else if (k === 'c' || k === 'C') { if (P.cur) { e.preventDefault(); copySong(); } }
      else if (k === 'h' || k === 'H') { if (P.cur?.kind === 'radio') { e.preventDefault(); heartSong(); } }
      else if (k === 'z' || k === 'Z') { e.preventDefault(); setMini(!S.mini); }
      else if (k === '?' || k === 'i' || k === 'I') { e.preventDefault(); showKeys(!S.keys); }
      else if (k === 'Escape' && S.keys) { e.preventDefault(); showKeys(false); }
    };
    /* the list of keys, in this window (the OS's own sheet — hold ⌘ or Ctrl — shows the same list) */
    const keysBox = h('div.mu-keys.hidden', { role: 'dialog', 'aria-label': tx('Music keyboard shortcuts'), dataset: { role: 'keys' } });
    shell.appendChild(keysBox);
    function showKeys(on) {
      S.keys = !!on;
      keysBox.classList.toggle('hidden', !on);
      if (!on) { clearEl(keysBox); return; }
      const rows = [...defKeys, ['Esc', 'Close this list']];
      clearEl(keysBox).append(
        h('div.mu-keys__head', icon('keyboard'), h('b', { text: tx('Music keys') }), h('div.grow'),
          h('button.ibtn', { 'aria-label': tx('Close'), onclick: () => showKeys(false) }, icon('x'))),
        h('dl.mu-keys__list', rows.map(([k, d]) => h('div', h('dt', h('kbd', { text: k })), h('dd', { text: d })))));
    }
    window.addEventListener('keydown', onKey);
    disposers.push(() => window.removeEventListener('keydown', onKey));

    /* ---------------- wiring ---------------- */
    let listRaf = 0;
    const onPlayer = kind => {
      if (dead) return;
      if (kind === 'time') { if (S.scrub === null && !raf) paintTime(); syncLyrics(); return; }
      if (kind === 'list' || kind === 'radio') {
        if (!listRaf) listRaf = requestAnimationFrame(() => {
          listRaf = 0;
          if (dead) return;
          paintSide();
          if (!S.renaming && !S.plRenaming) paintList();   /* never yank a name field away mid-typing */
          paintFoot();
          paintHero();
        });
        return;
      }
      /* track / state / queue */
      if (AB && S.view === 'books') AB.sync();
      paintHero();
      paintSide();
      paintFoot();
      if (S.renaming || S.plRenaming) return;       /* don't yank a rename field away mid-typing */
      if (S.view === 'songs' || S.view === 'most' || S.view === 'recent') markSongs();
      else if (S.view === 'queue') paintList();
      else if (S.view === 'lyrics') { if (lyricsSig() !== LY.sig) paintList(); }
      else if (radioSig() !== radioKey) paintList();
    };
    subs.add(onPlayer);
    disposers.push(() => subs.delete(onPlayer));

    const offVol = store.sub('prefs', () => paintVol());
    disposers.push(offVol);
    /* playlists changed (here, in another Music window, or by a restore) */
    disposers.push(store.sub(PL_KEY, () => {
      if (dead) return;
      paintSide();
      if (S.view === 'lists' || plOf(S.view) || (S.view.startsWith('pl:') && !okView(S.view))) {
        if (!okView(S.view)) { go('lists'); return; }
        win.setTitle(viewTitle(S.view));
        paintList();
      }
      paintFoot();
      if (P.from) paintHero();
    }));
    disposers.push(trouble.on(() => { if (!dead && S.view === 'radio') paintList(); }));
    /* radio favourites are shared with Static Radio */
    disposers.push(store.sub(RADIO_KEY, () => { if (!dead && S.view === 'radio') paintList(); }));
    /* ambient sounds: changed here, in Control Centre, by the sleep timer or a focus session */
    let ambWasOn = AMB.state().playing;
    disposers.push(bus.on('ambient:change', st => {
      if (dead) return;
      if (S.view === 'ambient') { syncAmbient(st); paintFoot(); }
      if (st.playing !== ambWasOn) { ambWasOn = st.playing; paintSide(); }
    }));
    disposers.push(bus.on('tick:1s', () => { if (!dead && S.view === 'ambient' && AM.els && AMB.state().sleep) paintSleepNote(); }));
    /* the equalizer, speed, crossfade and sleep timer: changed here, from the hero row, or by Static Radio */
    disposers.push(bus.on('playerfx:change', () => { if (dead) return; paintFx(); if (S.view === 'sound') syncSound(); }));
    disposers.push(bus.on('mediasleep:change', () => { if (dead) return; paintFx(); if (S.view === 'sound') syncSound(); }));
    disposers.push(bus.on('radiofinds:change', () => { if (!dead) paintFx(); }));
    disposers.push(bus.on('tick:1s', () => { if (!dead && sleepT.state()) { paintFx(); if (S.view === 'sound') syncSound(); } }));
    /* a minimised window can't be watched, so its microphone goes off */
    disposers.push(bus.on('win:minimize', w => { if (w === win && TU) TU.stop('The microphone was turned off because the window was minimised.'); }));
    disposers.push(() => { if (TU) { TU.destroy(); TU = null; } });
    disposers.push(() => { if (AB) { AB.dispose(); AB = null; } });
    disposers.push(() => { if (SO) { SO.remove(); SO = null; } });
    const offMotion = store.sub('prefs.reduceMotion', () => { visClear(); paintHero(); });
    disposers.push(offMotion);
    const offAccent = bus.on('theme:change', readAccent);
    disposers.push(offAccent);
    const onNet = () => { if (S.view === 'radio') paintList(); paintHero(); };
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    disposers.push(() => { window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); });
    /* the analyser needs a running AudioContext; a click in the window lets it start */
    const onPoke = () => { const c = V.reader?.ctx; if (c && c.state === 'suspended') c.resume().catch(() => {}); };
    shell.addEventListener('pointerdown', onPoke);
    disposers.push(() => shell.removeEventListener('pointerdown', onPoke));
    /* listener counts go stale; refresh while Radio is on screen */
    const chTimer = setInterval(() => { if (S.view === 'radio' && !win.min) loadChannels(); else paintFoot(); }, 60000);
    disposers.push(() => clearInterval(chTimer));

    function openWith(o) {
      if (!o) return;
      if (o.view) go(o.view);
      if (o.joinList) { go('lists'); join.input.value = String(o.joinList); join.status.textContent = 'Press Join to open this shared playlist.'; return; }
      if (o.playlist && plGet(o.playlist)) { go(`pl:${o.playlist}`); if (o.play) playPl(o.playlist, o.play === 'shuffle'); return; }
      if (o.station) {
        const st = STATIONS.find(s => s.id === o.station);
        if (st) { go('radio'); startStation(st, true); }
        return;
      }
      const path = o.path || null;
      if (!path) return;
      const n = vfs.node(path);
      if (!n || n.type !== 'file') { flash(`Couldn’t find ${path}.`, true); return; }
      if (media.kindOf(n.name) !== 'audio') { flash(`“${n.name}” isn’t an audio file.`, true); return; }
      const inLib = library().find(e => e.node === n);
      if (inLib) { go('songs'); playFrom(sortedLibrary().map(e => e.node), n); }
      else playFrom([n], n);
    }
    win.onReopen(o => openWith(o));

    readAccent();
    paintVol();
    paintAll();
    if (opts && (opts.path || opts.station || opts.view || opts.playlist || opts.joinList)) openWith(opts);

    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      if (listRaf) cancelAnimationFrame(listRaf);
      clearTimeout(flash.t);
      disposers.splice(0).forEach(fn => { try { fn(); } catch (e) {} });
      for (const rec of pendingUrls) { clearTimeout(rec.t); URL.revokeObjectURL(rec.url); }
      pendingUrls.clear();
      /* the shared reader closes its AudioContext when its last user leaves */
      if (V.reader) tap.drop(audio, 'music-window');
      V.reader = null;
      /* the music itself keeps playing — that's the point of a module-level player */
    };
  },
});
