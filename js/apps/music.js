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

   An older Music listed real artists' songs that had no audio, with
   made-up playlists and a timer pretending to play them. All gone.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import vfs from '../core/vfs.js';
import * as media from '../core/media.js';
import * as tap from '../core/audiotap.js';
import * as AMB from '../core/ambient.js';
import { createTuner } from './music-tuner.js';
import { normalizeCode, isCode } from '../core/roomcode.js';
import { createShares, keyOf as fileKey } from '../core/sharedlist.js';
import { sharePanel, joinBox, inviteLink } from './musicshare.js';
import { open as openWin } from '../core/wm.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-music-css')) {
  const l = document.createElement('link');
  l.id = 'feat-music-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-music.css';
  document.head.appendChild(l);
}

const DIR = `${vfs.HOME}/Music`;
const TRASH = `${vfs.HOME}/Trash`;
const SOMA = 'https://somafm.com';
const SOMA_API = 'https://api.somafm.com';
const ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.weba';

/* SomaFM's own names, genres and descriptions (from its channels.json),
   so the list reads the same offline. Every stream here played from a
   Playwright test page before it was kept. */
const STATIONS = [
  ['groovesalad', 'Groove Salad', 'Ambient · electronic', 'A nicely chilled plate of ambient/downtempo beats and grooves.'],
  ['dronezone', 'Drone Zone', 'Ambient', 'Served best chilled, safe with most medications. Atmospheric textures with minimal beats.'],
  ['lush', 'Lush', 'Electronic', 'Sensuous and mellow female vocals, many with an electronic influence.'],
  ['secretagent', 'Secret Agent', 'Lounge', 'The soundtrack for your stylish, mysterious, dangerous life. For Spies and PIs too!'],
  ['defcon', 'DEF CON Radio', 'Electronic', 'Music for Hacking. The DEF CON Year-Round Channel.'],
  ['deepspaceone', 'Deep Space One', 'Ambient', 'Deep ambient electronic, experimental and space music. For inner and outer space exploration.'],
  ['spacestation', 'Space Station Soma', 'Electronic', 'Tune in, turn on, space out. Spaced-out ambient and mid-tempo electronica.'],
  ['indiepop', 'Indie Pop Rocks!', 'Alternative · rock', 'New and classic favorite indie pop tracks.'],
  ['u80s', 'Underground 80s', 'Alternative · electronic', 'Early 80s UK Synthpop and a bit of New Wave.'],
  ['vaporwaves', 'Vaporwaves', 'Electronic', 'All Vaporwave. All the time.'],
].map(([id, name, genre, blurb]) => ({
  id, name, genre, blurb,
  page: `${SOMA}/${id}/`,
  logo: `${SOMA_API}/logos/256/${id}256.png`,
}));
/* where a stream is fetched from, in order: two of SomaFM's servers with
   CORS (which the spectrum needs), then plain — a proxy that strips CORS
   headers still gets music, just without the spectrum */
const RADIO_TRIES = [['ice1', true], ['ice2', true], ['ice1', false]];
const streamUrl = (st, host) => `https://${host}.somafm.com/${st.id}-128-mp3`;
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

/* ---------------- the library (~/Music) ---------------- */
let libCache = null;
function library() {
  if (libCache) return libCache;
  const out = [];
  vfs.walk(DIR, (n, path) => {
    if (n.type === 'file' && media.kindOf(n.name) === 'audio') out.push({ node: n, path, ...parseName(n.name) });
  });
  libCache = out;
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
    const e = { node: n, path, ...parseName(n.name) };
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
};
let everPlayed = false;
const subs = new Set();                 /* open windows repaint through these */

/* The wallpaper's music visualizer (js/shell/visualizer.js) reads this
   player through core/audiotap.js. A song is always readable; a station
   only when it came through one of SomaFM's CORS servers — the plain
   fallback plays, but the browser won't let a page look at it. */
if (audio) tap.register('music', audio, {
  label: 'Music',
  blocked: () => (P.cur?.kind === 'radio' && !P.cors
    ? `${P.cur.st.name} is coming through SomaFM’s plain server (its CORS servers didn’t answer here), so the browser won’t let StaticOS read the sound. The music still plays.`
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
  const { title, artist } = parseName(c.node.name);
  const d = Number.isFinite(audio.duration) ? audio.duration : (typeof durOf(c.node) === 'number' ? durOf(c.node) : 0);
  return {
    title, artist: artist || 'Unknown artist', album: folderLabel(c.path),
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
    : { title: 'Nothing playing', artist: '', album: '', duration: 0, elapsed: 0, playing: false, live: false, source: null });
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
    const art = P.cur?.kind === 'radio' ? P.cur.st.logo : '';
    const key = t ? `${t.title}|${t.artist}|${t.album}|${art}` : '';
    if (key !== msKey) {
      msKey = key;
      MS.metadata = t && typeof MediaMetadata === 'function'
        ? new MediaMetadata({ title: t.title, artist: t.artist, album: t.album,
            artwork: art ? [{ src: art, sizes: '256x256', type: 'image/png' }] : [] })
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

/* ---------------- loudness: the OS's own prefs ---------------- */
function applyVolume() {
  if (!audio) return;
  const v = Number(store.get('prefs.volume', 62));
  audio.volume = clamp(Number.isFinite(v) ? v : 62, 0, 100) / 100;
  audio.muted = store.get('prefs.muted', false) === true;
}
applyVolume();
store.sub('prefs', applyVolume);

/* ---------------- errors, in plain words ---------------- */
const ERR = {
  nodata: n => ({ title: `“${n.name}” has no audio in it`, actions: ['trash'],
    detail: 'It is an empty file — most likely a placeholder from an older StaticOS, which listed songs it could not play. Move it to the Trash, or import the real song.' }),
  missing: n => ({ title: `The audio for “${n.name}” is missing`, actions: ['import'],
    detail: 'Its bytes are no longer in this browser’s storage (site data may have been cleared). Import the song again.' }),
  format: n => ({ title: `This browser can’t play “${n.name}”`, actions: ['next', 'trash'],
    detail: canPlayExt(n.name)
      ? `This browser does play ${fmtTag(n.name)} files, so this one is probably damaged, cut short, or not really audio.`
      : `This browser doesn’t play ${fmtTag(n.name)} files. Converting it to MP3 or M4A usually fixes this.` }),
  decode: n => ({ title: `“${n.name}” stopped: the file looks damaged`, actions: ['next'],
    detail: 'The browser could not decode the rest of it.' }),
  offline: st => ({ title: 'You’re offline', actions: ['retry'],
    detail: `${st.name} streams from SomaFM over the internet. Reconnect, then press Play.` }),
  radio: st => ({ title: `${st.name} didn’t play`, actions: ['retry', 'page'],
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
  P.cur = { kind: 'file', node, path: alive(node) };
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
  if (play) doPlay();
  else { try { audio.load(); } catch (e) {} }
}

function startStation(st, play = true) {
  if (!audio || !st) return;
  const tok = ++P.token;
  unload();
  clearSlow();
  everPlayed = true;
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

function connect(tok) {
  const st = P.cur?.st;
  if (!st || tok !== P.token) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fail(tok, ERR.offline(st));
  const [host, cors] = RADIO_TRIES[P.tryIx] || RADIO_TRIES[0];
  P.cors = cors;
  if (cors) audio.crossOrigin = 'anonymous'; else audio.removeAttribute('crossorigin');
  audio.src = streamUrl(st, host);
  armSlow(tok);
  doPlay();
}

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
  if (P.phase === 'error' || !audio.getAttribute('src')) { startFile(c.node, true); return; }
  doPlay();
}
const toggle = () => (P.want ? pause() : resume());

function seek(s) {
  const c = P.cur;
  if (!c || c.kind !== 'file' || !Number.isFinite(Number(s))) return;
  const d = Number.isFinite(audio.duration) ? audio.duration : (typeof durOf(c.node) === 'number' ? durOf(c.node) : 0);
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
  if (auto && P.repeat === 'one') { try { audio.currentTime = 0; } catch (e) {} doPlay(); return; }
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
  if ((audio.currentTime || 0) > 3 || P.queue.length < 2) { seek(0); return; }
  let i = P.qi - 1;
  if (i < 0) {
    if (P.repeat !== 'all') { seek(0); return; }
    i = P.queue.length - 1;
  }
  P.qi = i;
  startFile(P.queue[i], P.want);
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
  audio.addEventListener('loadedmetadata', noteDur);
  audio.addEventListener('durationchange', noteDur);
  audio.addEventListener('timeupdate', () => {
    /* time moving is proof of sound, even if a 'playing' after a stall is late */
    if (P.phase === 'loading' && P.want && !audio.paused && audio.readyState >= 3) { P.phase = 'playing'; changed('state'); }
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
    if (P.tryIx < RADIO_TRIES.length - 1 && navigator.onLine !== false) { P.tryIx++; connect(tok); return; }
    fail(tok, navigator.onLine === false ? ERR.offline(c.st) : ERR.radio(c.st));
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
export function wake(evt) {
  if (evt === 'media:play') resume();
  else if (evt === 'media:next') next();
  else if (evt === 'media:prev') prev();
}

/* ---------------- sorting ---------------- */
const SORTS = {
  title: { label: 'Title', cmp: (a, b) => coll.compare(a.title, b.title) || coll.compare(a.artist, b.artist) },
  artist: { label: 'Artist', cmp: (a, b) => coll.compare(a.artist || '￿', b.artist || '￿') || coll.compare(a.title, b.title) },
  added: { label: 'Recently added', cmp: (a, b) => new Date(b.node.mtime) - new Date(a.node.mtime) },
  length: { label: 'Length', cmp: (a, b) => {
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
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon } = api;
    const clearEl = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

    const S = {
      view: 'songs',
      filter: '', renaming: null, renameErr: '', scrub: null, drag: 0, busy: '', flash: null,
      plRenaming: null,        /* the playlist whose name is being edited */
      plDrag: null,            /* a track being dragged to a new place */
    };
    const disposers = [];
    const pendingUrls = new Set();
    let dead = false;

    /* ---------------- title bar ---------------- */
    const fileIn = h('input.mu-file', { type: 'file', accept: ACCEPT, multiple: true, tabindex: '-1', 'aria-hidden': 'true',
      onchange: e => { const f = e.target.files; importAudio(f).finally(() => { e.target.value = ''; }); } });
    const pickFiles = () => fileIn.click();
    win.setTools(
      h('button.ibtn.tip.tip--below', { 'data-tip': 'Import songs', 'aria-label': 'Import songs from your computer', onclick: pickFiles },
        icon('upload')),
      h('button.ibtn.tip.tip--below', { 'data-tip': 'More', 'aria-label': 'More options', 'aria-haspopup': 'menu', onclick: moreMenu },
        icon('more-horizontal')),
    );

    /* ---------------- layout ---------------- */
    const side = h('nav.app__side.mu-side', { 'aria-label': 'Music' });
    const tabs = h('nav.mu-tabs', { 'aria-label': 'Music sections' });
    const hero = h('section.mu-hero', { 'aria-label': 'Now playing' });
    const content = h('div.app__content.app__content--flush.mu-content');
    const listBox = h('div.mu-listbox');
    const searchIn = h('input', { type: 'search', placeholder: 'Search your music', 'aria-label': 'Search your music', spellcheck: 'false',
      oninput: ev => { S.filter = ev.target.value; paintList(); paintFoot(); } });
    const sortBtn = h('button.btn.btn--sm.mu-sort', { 'aria-haspopup': 'menu', onclick: e => sortMenu(e) });
    const shufBtn = h('button.btn.btn--sm', { onclick: () => shuffleAll(filtered()) }, icon('shuffle'), h('span', { text: 'Shuffle' }));
    const toolsBox = h('div.mu-tools', h('label.field.mu-search', icon('search'), searchIn), sortBtn, shufBtn);
    content.append(toolsBox, listBox);
    const foot = h('div.app__bar.app__bar--foot.mu-foot', { role: 'status', 'aria-live': 'polite' });
    const drop = h('div.mu-drop', { 'aria-hidden': 'true' },
      h('div.mu-drop__card', icon('upload'), h('b', { text: 'Drop to add to Your music' }),
        h('small', { text: 'Audio files are copied into ~/Music and stay in this browser.' })));
    const shell = h('div.app.mu', side, h('div.app__main.mu-main', tabs, hero, content, foot), drop, fileIn);
    root.appendChild(shell);

    /* ---------------- the hero: now playing ---------------- */
    const vis = h('canvas.mu-vis', { 'aria-hidden': 'true' });
    const art = h('div.mu-art');
    const eyebrow = h('div.mu-eyebrow');
    const tTitle = h('h2.mu-title');
    const tSub = h('div.mu-sub');
    const seekFill = h('i.mu-seek__fill');
    const seekKnob = h('b.mu-seek__knob');
    const seekEl = h('div.mu-seek', { role: 'slider', tabindex: '0', 'aria-label': 'Position in song',
      'aria-valuemin': '0', 'aria-valuemax': '0', 'aria-valuenow': '0' },
      h('div.mu-seek__rail', seekFill, seekKnob));
    const tCur = h('span.mu-time');
    const tTot = h('span.mu-time.mu-time--r');
    const seekRow = h('div.mu-seekrow', tCur, seekEl, tTot);
    const liveTime = h('span.mu-live__t');
    const liveLink = h('a.mu-live__link', { target: '_blank', rel: 'noopener noreferrer' });
    const liveRow = h('div.mu-liverow', h('span.mu-live', h('i'), 'LIVE'), liveTime, liveLink);

    const btnShuf = h('button.ibtn.mu-ctl.tip', { 'aria-label': 'Shuffle', onclick: () => setShuffle(!P.shuffle) }, icon('shuffle'));
    const btnPrev = h('button.ibtn.mu-ctl.tip', { 'data-tip': 'Previous (P)', 'aria-label': 'Previous', onclick: () => prev() }, icon('skip-back'));
    const btnPlay = h('button.mu-play.tip', { onclick: () => toggle() });
    const btnNext = h('button.ibtn.mu-ctl.tip', { 'data-tip': 'Next (N)', 'aria-label': 'Next', onclick: () => next() }, icon('skip-forward'));
    const btnRep = h('button.ibtn.mu-ctl.tip', { onclick: cycleRepeat }, icon('repeat'), h('span.mu-rep1', { text: '1' }));
    const btnMute = h('button.ibtn.tip', { onclick: () => store.set('prefs.muted', store.get('prefs.muted') !== true) });
    const volEl = h('input.slider.mu-vol', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Volume (all of StaticOS)',
      oninput: e => {
        store.set('prefs.volume', Number(e.target.value));
        if (Number(e.target.value) > 0 && store.get('prefs.muted') === true) store.set('prefs.muted', false);
        paintVol();
      } });
    const status = h('div.mu-status');
    const alertBox = h('div.mu-alert', { role: 'alert' });

    hero.append(
      vis,
      h('div.mu-hero__top', art,
        h('div.mu-hero__meta', eyebrow, tTitle, tSub, status)),
      h('div.mu-hero__bar', seekRow, liveRow),
      h('div.mu-hero__ctl',
        h('div.mu-ctls', btnShuf, btnPrev, btnPlay, btnNext, btnRep),
        h('div.mu-volrow', btnMute, volEl)),
      alertBox);

    /* seek: pointer drag + keys (arrows 5 s, PageUp/Down 30 s, Home/End) */
    const curDur = () => {
      const c = P.cur;
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
      const want = c?.kind === 'radio' ? `r:${c.st.id}` : c ? 'file' : 'none';
      if (art.dataset.k === want) return;
      art.dataset.k = want;
      clearEl(art);
      if (c?.kind === 'radio') {
        const img = h('img', { src: c.st.logo, alt: `${c.st.name} logo`, decoding: 'async',
          onerror: () => { clearEl(art); art.appendChild(icon('cast')); } });
        art.appendChild(img);
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
      } else if (P.phase === 'ended') st = 'Reached the end of the queue.';
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
      btnPrev.dataset.tip = radio ? 'Previous station (P)' : 'Previous (P)';
      btnNext.dataset.tip = radio ? 'Next station (N)' : 'Next (N)';
      btnPrev.setAttribute('aria-label', radio ? 'Previous station' : 'Previous song');
      btnNext.setAttribute('aria-label', radio ? 'Next station' : 'Next song');
      btnShuf.disabled = radio;
      btnRep.disabled = radio;
      btnShuf.classList.toggle('is-on', P.shuffle && !radio);
      btnShuf.setAttribute('aria-pressed', String(P.shuffle));
      btnShuf.dataset.tip = radio ? 'Shuffle (not for live radio)' : P.shuffle ? 'Shuffle: on' : 'Shuffle: off';
      btnRep.classList.toggle('is-on', P.repeat !== 'off' && !radio);
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
        if (e.actions.includes('retry')) acts.push(h('button.btn.btn--sm', { onclick: () => resume() }, icon('refresh'), 'Try again'));
        if (e.actions.includes('page') && radio) acts.push(h('a.btn.btn--sm', { href: c.st.page, target: '_blank', rel: 'noopener noreferrer' }, 'Station page', icon('external-link')));
        if (e.actions.includes('next') && P.queue.length > 1) acts.push(h('button.btn.btn--sm', { onclick: () => next(false, true) }, icon('skip-forward'), 'Play the next song'));
        if (e.actions.includes('trash') && c?.kind === 'file' && alive(c.node)) acts.push(h('button.btn.btn--sm', { onclick: () => trash(c.node) }, icon('trash'), 'Move to Trash'));
        if (e.actions.includes('import')) acts.push(h('button.btn.btn--sm', { onclick: pickFiles }, icon('upload'), 'Import songs'));
        alertBox.append(icon('alert'), h('div.grow', h('b', { text: e.title }), h('p', { text: e.detail })),
          acts.length ? h('div.mu-alert__acts', acts) : null);
      }

      win.setSubtitle(c && on ? `${t.title}${t.artist && !radio ? ` — ${t.artist}` : ''}` : c ? (radio ? 'Stopped' : 'Paused') : '');
      paintTime();
      if (on) kick(); else visClear();
    }

    function paintTime() {
      const c = P.cur;
      if (c?.kind === 'radio') {
        liveTime.textContent = soundOn() && P.phase === 'playing'
          ? `Listening ${dur(audio.currentTime || 0)} · 128 kbps MP3`
          : '128 kbps MP3 stream';
        return;
      }
      const d = curDur();
      const t = S.scrub !== null ? S.scrub * d : (c && audio.getAttribute('src') ? audio.currentTime || 0 : 0);
      const f = d ? clamp(t / d, 0, 1) : 0;
      const pct = `${(f * 100).toFixed(2)}%`;
      seekFill.style.width = pct;
      seekKnob.style.left = pct;
      tCur.textContent = c ? dur(t) : '0:00';
      tTot.textContent = c && d ? dur(d) : c && typeof durOf(c.node) !== 'number' && P.phase !== 'error' ? '…' : '—';
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
      ['queue', 'list-music', 'Up next'],
      ['radio', 'cast', 'Radio'],
      ['lists', 'list', 'Playlists'],
      ['ambient', 'cloud-rain', 'Ambient sounds', 'Ambient'],
      ['tuner', 'gauge', 'Tuner'],
    ];
    const TABS = ['songs', 'lists', 'queue', 'radio', 'ambient', 'tuner'];
    /* the tuner (music-tuner.js) keeps its microphone only while its page is on screen */
    let TU = null;
    const tunerView = () => { if (!TU) TU = createTuner({ h, icon, store }); return [TU.el]; };
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
      const counts = { songs: library().length, queue: upNextCount(), radio: STATIONS.length, ambient: AMB.state().playing ? 'On' : '', tuner: '' };
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
        h('div.side__group', h('div.side__label', { text: 'Library' }), item(VIEWS[0]), item(VIEWS[1])),
        h('div.side__group.mu-pls', { role: 'group', 'aria-label': 'Playlists' },
          h('button.side__label.mu-pls__label', { type: 'button', onclick: () => go('lists'), title: 'All playlists' }, h('span', { text: 'Playlists' })),
          lists.map(plItem),
          h('button.side__item.mu-pls__new', { type: 'button', onclick: () => newPlaylist() }, icon('plus'), h('span', { text: 'New playlist' }))),
        h('div.side__group', h('div.side__label', { text: 'Live' }), item(VIEWS[2]), item(VIEWS[4])),
        h('div.side__group', h('div.side__label', { text: 'Tools' }), item(VIEWS[5])),
        h('div.side__group', h('div.side__label', { text: 'Elsewhere' }),
          h('button.side__item', { onclick: () => api.openApp('files', { path: DIR }) }, icon('folder'), h('span', { text: 'Music folder' })),
          h('button.side__item', { onclick: () => api.openApp('spotify') }, icon('list-music'), h('span', { text: 'Spotify' }),
            h('small', icon('external-link')))),
        h('div.grow'),
        h('div.mu-side__imp',
          h('button.btn.btn--primary.btn--block', { onclick: pickFiles }, icon('upload'), 'Import songs'),
          h('small', { text: 'Or drop audio files on this window.' })));

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
    function songRow(e, idx, list) {
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
      const who = e.artist || 'Unknown artist';

      let main;
      if (S.renaming === n) {
        const input = h('input.mu-rename__in', { value: stemOf(n.name), 'aria-label': `New name for ${n.name}`, spellcheck: 'false',
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
        h('span.mu-row__size', { text: has ? bytes(n.size) : '0 B', title: 'File size' }),
        h('span.mu-row__len', { text: lenTxt, title: lenTip, class: !has || d === 'bad' ? 'is-bad' : null }),
        h('button.ibtn.mu-row__more', { dataset: { role: 'more' }, 'aria-label': `More for ${e.title}`, 'aria-haspopup': 'menu',
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
      return sortedLibrary(currentSort()).filter(e => !q || `${e.title} ${e.artist} ${e.node.name}`.toLowerCase().includes(q));
    }

    function songsView() {
      const all = library();
      const frag = [];
      if (!all.length) {
        const formats = playableFormats();
        frag.push(h('div.mu-empty',
          h('div.mu-empty__art', icon('music')),
          h('h3', { text: 'Import songs from your computer' }),
          h('p', { text: 'Pick audio files, or drop them on this window. They’re copied into ~/Music and kept in this browser on this device — nothing is uploaded anywhere.' }),
          formats.length ? h('p.mu-empty__fine', { text: `This browser says it can play ${formats.join(', ')}.` }) : null,
          h('div.mu-empty__acts',
            h('button.btn.btn--primary', { onclick: pickFiles }, icon('upload'), 'Import songs'),
            h('button.btn', { onclick: () => go('radio') }, icon('cast'), 'Listen to live radio')),
          h('button.mu-linkbtn', { onclick: () => api.openApp('spotify') },
            'Listening on Spotify? Open the Spotify app', icon('chevron-right'))));
        return frag;
      }
      const sort = currentSort();
      const list = filtered();
      clearEl(sortBtn).append(icon('filter'), h('span', { text: SORTS[sort].label }));
      sortBtn.setAttribute('aria-label', `Sort: ${SORTS[sort].label}`);
      shufBtn.disabled = !list.some(e => playable(e.node));
      if (!list.length) {
        frag.push(h('div.empty', icon('search'), h('b', { text: 'No matches' }),
          h('small', { text: `Nothing in Your music matches “${S.filter}”.` })));
        return frag;
      }
      const ul = h('div.mu-list', { role: 'list', 'aria-label': 'Your music' });
      list.forEach((e, i) => ul.appendChild(songRow(e, i + 1, list)));
      frag.push(ul);
      return frag;
    }

    function queueView() {
      const c = P.cur;
      const frag = [];
      if (c?.kind === 'radio') {
        frag.push(h('div.mu-empty.mu-empty--sm', h('div.mu-empty__art', icon('cast')),
          h('h3', { text: 'Radio is live, so there’s no queue' }),
          h('p', { text: `${c.st.name} plays whatever SomaFM is broadcasting. Next and Previous switch stations; pick a song in Your music to go back to your files.` }),
          h('div.mu-empty__acts', h('button.btn', { onclick: () => go('songs') }, icon('music'), 'Your music'))));
        return frag;
      }
      if (!c) {
        frag.push(h('div.mu-empty.mu-empty--sm', h('div.mu-empty__art', icon('list-music')),
          h('h3', { text: 'Nothing up next' }),
          h('p', { text: 'Play a song from Your music and the rest line up here. “Play next” and “Add to queue” on any song put it here too.' }),
          h('div.mu-empty__acts', h('button.btn', { onclick: () => go('songs') }, icon('music'), 'Your music'))));
        return frag;
      }
      const make = (n, i, label) => {
        const e = { node: n, ...parseName(n.name) };
        const d = durOf(n);
        const row = h('div.mu-row', { role: 'listitem', class: i === P.qi ? 'is-cur' : null, dataset: { key: `q${i}` } },
          h('button.mu-row__main', { dataset: { role: 'main' }, onkeydown: rowNav,
            'aria-label': i === P.qi ? `${soundOn() ? 'Pause' : 'Play'} ${e.title}` : `Play ${e.title} now`,
            onclick: () => { if (i === P.qi) toggle(); else { P.qi = i; startFile(n, true); } } },
            i === P.qi ? leadFor(n, 0) : h('span.mu-row__lead', { 'aria-hidden': 'true', text: String(label) }),
            h('span.mu-row__txt', h('b', { text: e.title }), h('small', { text: e.artist || 'Unknown artist' }))),
          h('span.mu-row__fmt', { text: fmtTag(n.name) }),
          h('span.mu-row__size', { text: bytes(n.size) }),
          h('span.mu-row__len', { text: typeof d === 'number' ? dur(d) : '—' }),
          i > P.qi
            ? h('button.ibtn.mu-row__more', { dataset: { role: 'drop' }, 'aria-label': `Remove ${e.title} from Up next`, onclick: () => dropAt(i) }, icon('x'))
            : h('span.mu-row__more'));
        return row;
      };
      frag.push(h('div.mu-qhead', h('span.label', { text: 'Now playing' })));
      frag.push(h('div.mu-list', { role: 'list', 'aria-label': 'Now playing' }, make(P.queue[P.qi] || c.node, P.qi, 0)));
      const rest = P.queue.slice(P.qi + 1);
      const notes = [P.shuffle ? 'Shuffle is on' : 'In order', { off: 'stops at the end', all: 'repeats the queue', one: 'repeats this song' }[P.repeat]];
      frag.push(h('div.mu-qhead',
        h('span.label', { text: `Up next · ${rest.length}` }),
        h('span.dim', { text: notes.join(' · ') }),
        h('div.grow'),
        rest.length ? h('button.btn.btn--sm.btn--ghost', { onclick: clearUpNext }, 'Clear') : null));
      if (!rest.length) {
        frag.push(h('p.mu-qnone', { text: P.repeat === 'all' && P.queue.length > 1
          ? 'That’s the last song — the queue starts over after it.'
          : 'That’s the last song. Add more with “Play next” or “Add to queue”.' }));
      } else {
        const ul = h('div.mu-list', { role: 'list', 'aria-label': 'Up next' });
        rest.forEach((n, k) => ul.appendChild(make(n, P.qi + 1 + k, k + 1)));
        frag.push(ul);
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
      if (nodes.length) flash(`Made a playlist with “${parseName(nodes[0].name).title}” in it — name it, then add more.`);
    }
    function addTo(id, n) {
      const p = plGet(id);
      const r = plAdd(id, n);
      const t = parseName(n.name).title;
      if (r === 'added') flash(`Added “${t}” to ${p.name}.`);
      else if (r === 'dup') flash(`“${t}” is already in ${p.name}.`, true);
      else if (r === 'nodata') flash(`“${t}” has no audio in it, so it can’t go in a playlist.`, true);
    }
    function playPl(id, shuffle) {
      if (!playPlaylist(id, shuffle)) flash('Nothing in this playlist can play — add songs from Your music.', true);
    }
    async function deletePl(id) {
      const p = plGet(id);
      if (!p) return;
      const yes = await api.confirm({ title: `Delete “${p.name}”?`, ok: 'Delete playlist', danger: true,
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
        { label: 'Play', icon: 'play', disabled: !p.tracks.length, onClick: () => playPl(id, false) },
        { label: 'Shuffle', icon: 'shuffle', disabled: !p.tracks.length, onClick: () => playPl(id, true) },
        '-',
        { label: 'Rename…', icon: 'edit-3', onClick: () => { if (S.view !== `pl:${id}`) go(`pl:${id}`); S.plRenaming = id; paintList(); } },
        { label: 'Delete playlist…', icon: 'trash', danger: true, onClick: () => deletePl(id) },
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
        { header: true, label: `Add to ${p.name}` },
        ...songs.map(e => {
          const inIt = media.isMedia(e.node) && have.has(e.node.content);
          return { label: `${e.title}${e.artist ? ` — ${e.artist}` : ''}`, icon: inIt ? 'check' : 'plus',
            disabled: inIt || !media.isMedia(e.node), onClick: () => addTo(id, e.node) };
        }),
      ] : [
        { label: 'Your music is empty', icon: 'music', disabled: true },
        { label: 'Import songs…', icon: 'upload', onClick: pickFiles },
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
      });
    }

    function listsView() {
      const lists = plAll();
      if (!lists.length) {
        return [join.el, h('div.mu-empty',
          h('div.mu-empty__art', icon('list')),
          h('h3', { text: 'No playlists yet' }),
          h('p', { text: 'Make one, then fill it from Your music with ⋯ › Add to playlist. Playlists are kept in this browser.' }),
          h('div.mu-empty__acts',
            h('button.btn.btn--primary', { onclick: () => newPlaylist() }, icon('plus'), 'New playlist'),
            library().length ? null : h('button.btn', { onclick: pickFiles }, icon('upload'), 'Import songs')))];
      }
      const grid = h('div.mu-plgrid', { role: 'list', 'aria-label': 'Playlists' });
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
          h('button.ibtn.mu-plcard__play', { dataset: { role: 'play' }, 'aria-label': `Play ${p.name}`, disabled: !tracks.some(t => t.e && playable(t.e.node)),
            onclick: () => playPl(p.id, false) }, icon('play', { fill: true }))));
      }
      grid.appendChild(h('button.mu-plcard.mu-plcard--new', { dataset: { key: 'pc:new', role: 'main' }, onclick: () => newPlaylist() },
        h('span.mu-plcard__art', { 'aria-hidden': 'true' }, icon('plus')), h('span.mu-plcard__txt', h('b', { text: 'New playlist' }))));
      return [h('div.mu-qhead', h('span.label', { text: `Playlists · ${lists.length}` }), h('span.dim', { text: 'kept in this browser' })), join.el, grid];
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
          'aria-label': 'Playlist name',
          onkeydown: ev => {
            ev.stopPropagation();
            if (ev.key === 'Enter') { ev.preventDefault(); commit(input.value, true); }
            else if (ev.key === 'Escape') { ev.preventDefault(); commit('', false); }
          },
          onblur: () => { if (document.hasFocus()) commit(input.value, true); } });
        name = h('div.mu-plhead__edit', input, h('small', { text: 'Enter to keep · Esc to cancel' }));
        queueMicrotask(() => { if (input.isConnected && document.activeElement !== input) { input.focus(); input.select(); } });
      } else {
        name = h('h3.mu-plhead__name', { text: p.name, title: 'Double-click to rename', ondblclick: () => { S.plRenaming = id; paintList(); } });
      }
      const meta = [songCount(p.tracks.length), total ? `${dur(total)}${known ? '' : '+'}` : null, gone ? `${gone} no longer in Your music` : null];
      return h('header.mu-plhead', { dataset: { key: `ph:${id}` } },
        h('div.mu-plhead__art', { 'aria-hidden': 'true' }, icon('list')),
        h('div.mu-plhead__meta',
          h('span.label', { text: 'Playlist' }),
          name,
          h('small.mu-plhead__sub', { text: meta.filter(Boolean).join(' · ') })),
        h('div.mu-plhead__acts',
          h('button.btn.btn--primary.btn--sm', { dataset: { role: 'pplay' }, disabled: !canPlay, onclick: () => playPl(id, false) }, icon('play', { fill: true }), 'Play'),
          h('button.btn.btn--sm', { dataset: { role: 'pshuffle' }, disabled: !canPlay, onclick: () => playPl(id, true) }, icon('shuffle'), 'Shuffle'),
          h('button.btn.btn--sm', { dataset: { role: 'padd' }, 'aria-haspopup': 'menu', onclick: e => addSongsMenu(e, id) }, icon('plus'), 'Add songs'),
          SH.byPlaylist(id) ? null : h('button.btn.btn--sm', { dataset: { role: 'pshare' }, title: 'Get a code or link and edit this playlist together', onclick: () => shareToEdit(id) }, icon('users'), 'Share to edit with a friend'),
          h('button.ibtn', { dataset: { role: 'rename' }, 'aria-label': `Rename ${p.name}`, title: 'Rename', onclick: () => { S.plRenaming = id; paintList(); } }, icon('edit-3')),
          h('button.ibtn', { dataset: { role: 'pmore' }, 'aria-label': `More for ${p.name}`, 'aria-haspopup': 'menu', onclick: e => plMenu(e, id) }, icon('more-horizontal'))));
    }

    function playlistView(p) {
      const id = p.id;
      const tracks = plTracks(p);
      const frag = [plHeader(p, tracks), sharePanelFor(id)];
      if (!tracks.length) {
        frag.push(h('div.mu-empty.mu-empty--sm',
          h('h3', { text: 'This playlist is empty' }),
          h('p', { text: library().length
            ? 'Add songs with “Add songs” above, or from Your music with ⋯ › Add to playlist.'
            : 'Import songs into Your music first, then add them here.' }),
          h('div.mu-empty__acts', library().length
            ? h('button.btn', { onclick: () => go('songs') }, icon('music'), 'Your music')
            : h('button.btn.btn--primary', { onclick: pickFiles }, icon('upload'), 'Import songs'))));
        return frag;
      }
      const nodes = tracks.filter(t => t.e && playable(t.e.node)).map(t => t.e.node);
      const ul = h('div.mu-list.mu-pllist', { role: 'list', 'aria-label': `Songs in ${p.name}` });
      tracks.forEach((t, i) => ul.appendChild(plRow(p, t, i, nodes)));
      frag.push(ul);
      frag.push(h('p.mu-plhint', { text: 'Drag the grip to reorder — or focus it and press ↑ ↓.' }));
      return frag;
    }

    function plRow(p, t, i, nodes) {
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
        onpointerdown: ev => startDrag(ev, id, i),
        onkeydown: ev => {
          if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
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
          onclick: () => { if (isCurNode(n)) toggle(); else playFrom(nodes.includes(n) ? nodes : [n], n, { pl: id }); },
          onkeydown: rowNav,
        }, leadFor(n, i + 1), h('span.mu-row__txt', h('b', { text: title }), h('small', { text: e.artist || 'Unknown artist' })))
        : h('div.mu-row__main.is-gone', { dataset: { role: 'main' } },
          h('span.mu-row__lead', { 'aria-hidden': 'true', text: String(i + 1) }),
          h('span.mu-row__txt', h('b', { text: title }),
            h('small.is-err', { text: 'Not in Your music any more — it was deleted or moved out of ~/Music.' })));
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
        h('button.ibtn.mu-row__more.mu-plrow__x', { dataset: { role: 'remove' }, 'aria-label': `Remove ${title} from ${p.name}`, title: 'Remove from playlist',
          onclick: () => removeTrack(id, i, title) }, icon('x')));
    }
    function removeTrack(id, i, title) {
      const p = plGet(id);
      if (!p || !p.tracks[i]) return;
      const t = p.tracks[i];
      plRemoveAt(id, i);
      api.notify({ app: 'Music', icon: 'list', title: `Removed from ${p.name}`, message: title, timeout: 6000,
        actions: [{ label: 'Undo', onClick: () => plEdit(id, q => (q.tracks.some(x => x.ref === t.ref) ? null
          : { ...q, tracks: [...q.tracks.slice(0, i), t, ...q.tracks.slice(i)] })) }] });
    }
    function plRowMenu(ev, p, t, i, nodes) {
      const n = t.e?.node || null;
      const last = p.tracks.length - 1;
      api.menu([
        n && { label: 'Play from here', icon: 'play', disabled: !media.isMedia(n), onClick: () => playFrom(nodes.includes(n) ? nodes : [n], n, { pl: p.id }) },
        n && '-',
        { label: 'Move to top', icon: 'arrow-up', disabled: i === 0, onClick: () => plMove(p.id, i, 0) },
        { label: 'Move to bottom', icon: 'arrow-down', disabled: i === last, onClick: () => plMove(p.id, i, last) },
        '-',
        n && { label: 'Show in Files', icon: 'folder-open', onClick: () => api.openApp('files', { path: alive(n) || DIR }) },
        { label: 'Remove from playlist', icon: 'x', danger: true, onClick: () => removeTrack(p.id, i, t.e ? t.e.title : t.name) },
      ].filter(Boolean), ev.clientX, ev.clientY);
    }

    /* drag a track by its grip: the row follows the pointer through the
       list, and letting go saves the new order */
    function startDrag(ev, id, from) {
      if (ev.button > 0 || S.plDrag) return;
      const grip = ev.currentTarget;
      const row = grip.closest('.mu-plrow');
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
        if (cancel || to === from || to < 0) paintList();
        else {
          plMove(id, from, to);
          const t = plGet(id);
          if (t) flash(`Moved to position ${to + 1} of ${t.tracks.length}.`);
        }
        /* moving the row took focus off its grip; put it back */
        listBox.querySelector(`[data-key="${CSS.escape(key)}"] [data-role="grip"]`)?.focus({ preventScroll: true });
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
        'aria-label': on ? `Stop ${st.name}` : `Play ${st.name}, ${st.genre}`,
        'aria-pressed': String(on),
        onclick: () => (on ? pause() : startStation(st, true)),
      }, logo, h('span.mu-st__txt', h('b', { text: st.name }), h('small', { text: st.genre })), go2);
      const bits = [];
      const fav = radioFavs().includes(st.id);
      bits.push(h('button.ibtn.mu-st__fav', {
        type: 'button', class: fav ? 'is-on' : null, dataset: { role: 'fav' }, 'aria-pressed': fav ? 'true' : 'false',
        'aria-label': fav ? `Remove ${st.name} from favorites` : `Add ${st.name} to favorites`,
        title: fav ? 'Remove from favorites (shared with Static Radio)' : 'Add to favorites (shared with Static Radio)',
        onclick: () => toggleRadioFav(st.id),
      }, icon('heart', fav ? { fill: true } : undefined)));
      if (info) bits.push(h('span.mu-st__n', { title: 'Listeners right now, as reported by SomaFM' }, h('i.mu-dot'), `${info.listeners.toLocaleString()} listening`));
      bits.push(h('a.mu-st__link', { href: st.page, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${st.name} on somafm.com (opens a new tab)` },
        'Station page', icon('external-link')));
      let airLine = null;
      if (air) airLine = h('div.mu-st__air', h('span.label', { text: 'On air' }), h('span.trunc', { text: `${air.title}${air.artist ? ` — ${air.artist}` : ''}` }));
      else if (info?.last) airLine = h('div.mu-st__air', h('span.label', { text: 'Recently' }), h('span.trunc', { text: info.last }));
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
          h('h3', { text: 'Live radio from SomaFM (listener-supported)' }),
          h('p', { text: 'An independent, commercial-free station in San Francisco, paid for by its listeners — not affiliated with StaticOS. The streams come straight from SomaFM and need the internet.' })),
        h('div.mu-intro__acts',
          h('a.btn.btn--sm', { href: `${SOMA}/support/`, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Support SomaFM (opens somafm.com in a new tab)' },
            icon('heart'), 'Support SomaFM', icon('external-link')),
          h('button.btn.btn--sm.btn--ghost', { onclick: () => api.openApp('spotify') }, icon('list-music'), 'Spotify instead'))));
      if (offline) {
        frag.push(h('div.mu-banner', icon('wifi-off'),
          h('span', { text: 'You’re offline. Radio needs the internet — the stations will play once you reconnect.' })));
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
        frag.push(h('div.mu-qhead.mu-rhead', icon('heart', { fill: true }), h('span.label', { text: `Favorites · ${favs.length}` }),
          h('span.dim', { text: 'saved on this device, shared with Static Radio' })));
        frag.push(gridOf(favs, 'Favorite stations'));
        if (rest.length) frag.push(h('div.mu-qhead.mu-rhead', h('span.label', { text: 'All stations' })));
      }
      if (rest.length) frag.push(gridOf(rest, favs.length ? 'More SomaFM stations' : 'SomaFM stations'));
      return frag;
    }

    /* ---------------- ambient sounds (js/core/ambient.js) ----------------
       Built once per paint; after that every change from the engine (here,
       Control Centre, the sleep timer) is written into the same elements,
       so a slider being dragged is never rebuilt under the pointer. */
    const AM = { els: null, focus: null };
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
          h('h3', { text: 'Ambient sounds, made live in this browser' }),
          h('p', { text: 'Rain, fire, wind, a café and brown noise are synthesised as they play — noise, filters and tiny grains of sound — so nothing is downloaded and they work offline. They mix with your music and keep playing when this window closes; stop them here or from Control Centre.' })),
        h('div.mu-intro__acts', els.play, els.status)));

      if (!st.supported) {
        frag.push(h('div.mu-banner', icon('alert'), h('span', { text: 'This browser has no Web Audio, so StaticOS can’t make these sounds here.' })));
      }

      /* presets */
      const pBox = h('div.mu-amb__presets', { role: 'group', 'aria-label': 'Presets' });
      for (const p of AMB.presets()) {
        const names = Object.keys(p.mix).map(id => AMB.SOUNDS.find(x => x.id === id)?.name).filter(Boolean);
        const b = h('button.mu-amb__preset', { type: 'button', dataset: { preset: p.id }, onclick: () => AMB.applyPreset(p.id) },
          h('span.mu-amb__pic', { 'aria-hidden': 'true' }, icon(p.icon)),
          h('span.mu-amb__ptxt', h('b', { text: p.name }), h('small', { text: p.note || names.join(', ') })));
        if (p.season) b.classList.add('is-season');
        els.presets.set(p.id, b);
        pBox.appendChild(b);
      }
      frag.push(h('div.mu-qhead', h('span.label', { text: 'Presets' })), pBox);

      /* the mixer */
      const mix = h('div.mu-amb__mix', { role: 'group', 'aria-label': 'Mixer' });
      for (const x of AMB.sounds()) {
        const out = h('span.mu-amb__pct', { 'aria-hidden': 'true' });
        const input = h('input.slider.mu-amb__range', {
          type: 'range', min: '0', max: '100', step: '1', 'aria-label': `${x.name} level`, dataset: { sound: x.id },
          oninput: e => { const v = Number(e.target.value); out.textContent = `${v}%`; e.target.setAttribute('aria-valuetext', `${v}%`); AMB.setLevel(x.id, v / 100); },
        });
        const r = h('div.mu-amb__row', { dataset: { sound: x.id } },
          h('span.mu-amb__ic', { 'aria-hidden': 'true' }, icon(x.icon)),
          h('span.mu-amb__name', h('b', { text: x.name }), h('small', { text: x.note })),
          input, out);
        els.rows.set(x.id, { r, input, out });
        mix.appendChild(r);
      }
      frag.push(h('div.mu-qhead', h('span.label', { text: 'Mixer' }), h('span.dim', { text: 'each sound has its own level' })), mix);

      /* the sleep timer */
      const chips = h('div.mu-amb__chips', { role: 'group', 'aria-label': 'Sleep timer' });
      for (const m of [0, ...AMB.SLEEP_CHOICES]) {
        const b = h('button.mu-amb__chip', { type: 'button', dataset: { sleep: String(m) }, onclick: () => AMB.setSleep(m) },
          m ? SLEEP_LABEL[m] || `${m} min` : 'Off');
        els.sleep.set(m, b);
        chips.appendChild(b);
      }
      els.sleepNote = h('small.mu-amb__sleepnote');
      frag.push(h('div.mu-qhead', icon('moon'), h('span.label', { text: 'Sleep timer' })),
        h('div.mu-amb__sleep', chips, els.sleepNote));

      /* focus sessions: only where Clock › Focus exists (js/core/focus.js) */
      els.focus = h('div.mu-amb__focus.hidden');
      frag.push(els.focus);
      AMB.focusReady().then(okFocus => { if (okFocus && AM.els === els && !dead) paintAmbFocus(els); });
      return frag;     /* paintList syncs it once it is on screen */
    }

    function paintAmbFocus(els) {
      const f = AMB.state().focus;
      const sw = h('button.switch', { role: 'switch', type: 'button', 'aria-label': 'Play during focus sessions',
        'aria-checked': String(f.on), class: f.on ? 'is-on' : null,
        onclick: () => AMB.setFocus({ on: !AMB.state().focus.on }) });
      const sel = h('select.select', { 'aria-label': 'Preset for focus sessions', onchange: e => AMB.setFocus({ preset: e.target.value }) },
        AMB.presets().map(p => h('option', { value: p.id, selected: p.id === f.preset, text: p.name })));
      api.render(els.focus,
        h('div.mu-qhead', icon('clock'), h('span.label', { text: 'Focus sessions' })),
        h('div.mu-amb__frow', sw,
          h('span.mu-amb__name', h('b', { text: 'Play during focus sessions' }),
            h('small', { text: 'When a focus session starts in Clock › Focus, this preset starts with it, and stops when the session pauses or ends.' })),
          sel));
      els.focus.classList.remove('hidden');
      els.focusSw = sw;
      els.focusSel = sel;
    }

    function syncAmbient(st = AMB.state()) {
      const els = AM.els;
      if (!els || !listBox.contains(els.play)) return;
      if (els.sig !== ambSig()) { paintList(); return; }   /* the season added or took away a layer */
      clearEl(els.play).append(icon(st.playing ? 'square' : 'play', { fill: !st.playing }), h('span', { text: st.playing ? 'Stop' : 'Play' }));
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
    const radioSig = () => `${P.cur?.kind === 'radio' ? P.cur.st.id : ''}|${soundOn()}|${P.onAir?.title || ''}|${CH.at}|${CH.err || ''}|${navigator.onLine}|${radioFavs().join(',')}`;
    function paintList() {
      if (S.plDrag) return;                         /* never rebuild the rows out from under a drag */
      keepFocus(() => {
        rowRefs.clear();
        radioKey = S.view === 'radio' ? radioSig() : '';
        clearEl(listBox);
        const v = S.view;
        content.dataset.view = v;
        toolsBox.classList.toggle('hidden', v !== 'songs' || !library().length);
        const pl = plOf(v);
        if (pl) content.dataset.view = 'playlist';
        if (v !== 'ambient') AM.els = null;
        if (v !== 'tuner' && TU) TU.stop('The microphone was turned off when you left the Tuner.');
        const nodes = pl ? playlistView(pl) : v === 'lists' ? listsView() : v === 'radio' ? radioView() : v === 'queue' ? queueView()
          : v === 'ambient' ? ambientView() : v === 'tuner' ? tunerView() : songsView();
        listBox.append(...nodes.filter(Boolean));
        if (v === 'ambient') syncAmbient();
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
        if (gone) bits.push(h('span.chip', icon('alert'), `${gone} no longer in Your music`));
        bits.push(h('div.grow'));
        if (P.from?.pl === p.id && P.cur?.kind === 'file') bits.push(h('span.chip.chip--accent', icon('play'), 'Playing'));
        if (P.shuffle) bits.push(h('span.chip.chip--accent', icon('shuffle'), 'Shuffle'));
      } else if (S.view === 'lists') {
        const n = plAll().length;
        bits.push(h('span.dim', { text: `${n} playlist${n === 1 ? '' : 's'} · kept in this browser` }));
      } else if (S.view === 'ambient') {
        const st = AMB.state();
        bits.push(h('span.dim', { text: 'Synthesised live · nothing downloaded' }));
        bits.push(h('div.grow'));
        if (st.playing) bits.push(h('span.chip.chip--accent', icon('volume-2'), st.label));
        if (st.sleep) bits.push(h('span.chip', icon('moon'), `Sleep ${st.sleep.minutes} min`));
      } else if (S.view === 'tuner') {
        bits.push(h('span.dim', { text: 'Listens through your microphone · nothing is recorded' }));
      } else if (S.view === 'radio') {
        bits.push(h('span.dim', { text: `${STATIONS.length} stations · 128 kbps MP3 from SomaFM` }));
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
          bits.push(h('span.dim', { text: '·' }), h('span.dim', { text: pending ? 'reading lengths…' : `${dur(total)} total` }));
          bits.push(h('span.dim', { text: '·' }), h('span.dim', { text: `${bytes(size)} in ~/Music` }));
        }
        if (empty) bits.push(h('span.chip', icon('alert'), `${empty} with no audio`));
        bits.push(h('div.grow'));
        if (P.shuffle) bits.push(h('span.chip.chip--accent', icon('shuffle'), 'Shuffle'));
        if (P.repeat !== 'off') bits.push(h('span.chip.chip--accent', icon('repeat'), P.repeat === 'one' ? 'Repeat one' : 'Repeat all'));
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
      const files = Array.from(fileList || []);
      if (!files.length) return;
      const isAudio = f => media.kindOf(f.type) === 'audio' || media.kindOf(f.name) === 'audio';
      const songs = files.filter(isAudio);
      const skipped = files.filter(f => !isAudio(f));
      const saved = [], failed = [], iffy = [];
      S.busy = `Importing ${songs.length} song${songs.length === 1 ? '' : 's'}…`;
      paintFoot();
      for (const f of songs) {
        /* keep the name, but give it an audio extension the library will know
           (an audio/webm recording named .webm would otherwise count as video) */
        let name = f.name;
        if (media.kindOf(name) !== 'audio') name = `${stemOf(name)}.${media.extFor(f.type) || 'mp3'}`;
        try {
          const r = await media.save(DIR, name, f);
          saved.push(r);
          if (f.type && audio && audio.canPlayType(f.type) === '') iffy.push(vfs.baseName(r.path));
        } catch (e) {
          failed.push(`${f.name} (${/quota/i.test(String(e?.name || e?.message)) ? 'browser storage is full' : e?.message || 'could not be saved'})`);
        }
      }
      S.busy = '';
      if (dead) return;
      const parts = [];
      if (saved.length) parts.push(`Added ${saved.length} song${saved.length === 1 ? '' : 's'} to Your music.`);
      if (skipped.length) parts.push(`Skipped ${skipped.length} that ${skipped.length === 1 ? 'isn’t' : 'aren’t'} audio: ${skipped.slice(0, 3).map(f => f.name).join(', ')}${skipped.length > 3 ? '…' : ''}.`);
      if (iffy.length) parts.push(`This browser may not play ${iffy.join(', ')}.`);
      if (failed.length) parts.push(`Couldn’t save ${failed.join(', ')}.`);
      if (!parts.length) parts.push('Nothing to import.');
      if (S.view !== 'songs' && saved.length) go('songs');
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
      api.notify({ app: 'Music', icon: 'trash', title: 'Moved to the Trash', message: name, timeout: 7000,
        actions: [{ label: 'Undo', onClick: () => {
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
        { label: cur && soundOn() ? 'Pause' : 'Play', icon: cur && soundOn() ? 'pause' : 'play', disabled: !has,
          onClick: () => (cur ? toggle() : playFrom(list.map(x2 => x2.node), n)) },
        fileQueue && !cur && { label: 'Play next', icon: 'chevrons-right', disabled: !has, onClick: () => { playNext(n); flash(`“${e.title}” plays next.`); } },
        fileQueue && !cur && { label: 'Add to queue', icon: 'list-music', disabled: !has, onClick: () => { addToQueue(n); flash(`Added “${e.title}” to Up next.`); } },
        { label: 'Add to playlist', icon: 'list-plus', disabled: !has, items: [
          ...plAll().map(p => {
            const inIt = has && p.tracks.some(t => t.ref === n.content);
            return { label: inIt ? `${p.name} (already in it)` : p.name, icon: inIt ? 'check' : 'list', disabled: inIt, onClick: () => addTo(p.id, n) };
          }),
          plAll().length ? '-' : null,
          { label: 'New playlist…', icon: 'plus', onClick: () => newPlaylist([n]) },
        ].filter(Boolean) },
        '-',
        { label: 'Download to this computer', icon: 'download', disabled: !has, onClick: () => download(e) },
        { label: 'Rename…', icon: 'edit-3', onClick: () => { S.renaming = n; S.renameErr = ''; paintList(); } },
        { label: 'Show in Files', icon: 'folder-open', onClick: () => api.openApp('files', { path: vfs.parentPath(alive(n) || DIR) }) },
        '-',
        { label: 'Move to Trash', icon: 'trash', danger: true, onClick: () => trash(n) },
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
        { label: 'Import songs…', icon: 'upload', onClick: pickFiles },
        { label: 'Shuffle all', icon: 'shuffle', disabled: !playableLibrary().length, onClick: () => shuffleAll() },
        '-',
        { label: 'Repeat off', icon: P.repeat === 'off' ? 'check' : 'dot', onClick: mode('off') },
        { label: 'Repeat all', icon: P.repeat === 'all' ? 'check' : 'repeat', onClick: mode('all') },
        { label: 'Repeat this song', icon: P.repeat === 'one' ? 'check' : 'repeat', onClick: mode('one') },
        '-',
        { label: 'Open Music folder', icon: 'folder', onClick: () => api.openApp('files', { path: DIR }) },
        { label: 'Open Spotify', icon: 'list-music', onClick: () => api.openApp('spotify') },
      ], ev.clientX || r.left, ev.clientY || r.bottom);
    }

    /* ---------------- drag and drop ---------------- */
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    const onDragEnter = e => { if (!hasFiles(e)) return; e.preventDefault(); S.drag++; shell.classList.add('is-drop'); };
    const onDragOver = e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const onDragLeave = e => { if (!hasFiles(e)) return; S.drag = Math.max(0, S.drag - 1); if (!S.drag) shell.classList.remove('is-drop'); };
    const onDrop = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      S.drag = 0;
      shell.classList.remove('is-drop');
      importAudio(e.dataTransfer.files);
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
      else if ((k === 'ArrowRight' || k === 'ArrowLeft') && P.cur?.kind === 'file' && e.target.getAttribute?.('role') !== 'slider') {
        e.preventDefault(); seek((audio.currentTime || 0) + (k === 'ArrowRight' ? 5 : -5));
      } else if (k === '/' && S.view === 'songs') {
        if (!toolsBox.classList.contains('hidden')) { e.preventDefault(); searchIn.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    disposers.push(() => window.removeEventListener('keydown', onKey));

    /* ---------------- wiring ---------------- */
    let listRaf = 0;
    const onPlayer = kind => {
      if (dead) return;
      if (kind === 'time') { if (S.scrub === null && !raf) paintTime(); return; }
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
      paintHero();
      paintSide();
      paintFoot();
      if (S.renaming || S.plRenaming) return;       /* don't yank a rename field away mid-typing */
      if (S.view === 'songs') markSongs();
      else if (S.view === 'queue') paintList();
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
    /* a minimised window can't be watched, so its microphone goes off */
    disposers.push(bus.on('win:minimize', w => { if (w === win && TU) TU.stop('The microphone was turned off because the window was minimised.'); }));
    disposers.push(() => { if (TU) { TU.destroy(); TU = null; } });
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
