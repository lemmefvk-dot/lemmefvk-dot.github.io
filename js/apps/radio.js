/* ============================================================
   radio.js — Static Radio: live internet radio from SomaFM,
   browsed by genre.

   What it is
   · A small directory of real SomaFM channels (SomaFM is an
     independent, listener-supported station in San Francisco with
     nothing to do with StaticOS). Names, genres and descriptions are
     SomaFM's own, copied from its channels.json so the list reads the
     same offline. Every stream here played from a Playwright page on
     the published origin before it was kept (ice1 and ice2, 128k MP3).
   · Genres map honestly onto real channels. Ambient, Electronic and
     Retro are SomaFM's own kinds of channel. Focus and Gaming are
     picks — SomaFM runs neither — and say "picked for focus" / "picked
     for playing games". Chill says plainly that SomaFM has no lo-fi
     station and names the closest ones.
   · What's on air, and how many people are listening, come from
     SomaFM's public JSON (channels.json for every station at once,
     songs/<id>.json for the one playing — both CORS-open). When they
     don't answer, the rows simply show less; nothing is filled in.
     Both feeds are a snapshot: past FRESH (3 minutes) they stop being
     what is on air, so the numbers and the song lines come off the rows
     and the footer says when they were last read and why they stopped.
     A read that fails is said out loud even while older figures are
     still up, so nothing on screen ever claims to be newer than it is.

   One player
   · StaticOS has one player: Music. A station Music knows (its
     openWith accepts only the ids in its own STATIONS list, mirrored
     in MUSIC_PLAYS below) is handed to it with openApp('music',
     { station }) and plays in Music's own player; Radio keeps its
     window in front and follows Music's media:track to show what's on.
   · A station Music doesn't list plays in Radio's single module-level
     <audio>. It first emits media:pause so Music stops, stops itself
     the moment Music reports sound again, obeys media:pause from the
     rest of the OS, and announces itself on media:track so the Now
     Playing widget stays truthful. While it has the sound it holds the
     Media Session (media keys); when it stops it puts back Music's
     card and hands the keys back through the bus — the same calls
     Music's own handlers make.
   · Like Music, that player lives at module level, so a station keeps
     playing after the window closes; the widget, the media keys or
     reopening Radio stop it. Only window things are torn down.

   Saved on this device under store 'portal.radio': favourites, the
   stations played here (newest first) and the last view. Favourites
   are listed first in every list of stations (All, and each genre),
   under their own heading — and Music's Radio tab reads and writes the
   same hearts, so a station hearted in either is a favourite in both.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as tap from '../core/audiotap.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-radio-css')) {
  const l = document.createElement('link');
  l.id = 'feat-radio-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-radio.css';
  document.head.appendChild(l);
}

const SOMA = 'https://somafm.com';
const SOMA_API = 'https://api.somafm.com';
const STORE_KEY = 'portal.radio';
/* where Radio's own player fetches a stream from, in order: SomaFM's two
   servers with CORS (so the wallpaper's music visualizer may read the
   sound — the same order Music uses), then plain, which still plays where
   something on the way strips the CORS headers */
const TRIES = [['ice1', true], ['ice2', true], ['ice1', false], ['ice2', false]];
const streamUrl = (st, host = 'ice1') => `https://${host}.somafm.com/${st.id}-128-mp3`;
const onLocalhost = () => typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/* ---------------- the stations (SomaFM's own words) ---------------- */
const STATIONS = [
  ['dronezone', 'Drone Zone', 'Ambient', 'Served best chilled, safe with most medications. Atmospheric textures with minimal beats.', 'png'],
  ['deepspaceone', 'Deep Space One', 'Ambient', 'Deep ambient electronic, experimental and space music. For inner and outer space exploration.', 'png'],
  ['groovesalad', 'Groove Salad', 'Ambient · electronic', 'A nicely chilled plate of ambient/downtempo beats and grooves.', 'png'],
  ['beatblender', 'Beat Blender', 'Electronic', 'A late night blend of deep-house and downtempo chill.', 'png'],
  ['spacestation', 'Space Station Soma', 'Electronic', 'Tune in, turn on, space out. Spaced-out ambient and mid-tempo electronica.', 'png'],
  ['poptron', 'PopTron', 'Alternative', 'Electropop and indie dance rock with sparkle and pop.', 'png'],
  ['vaporwaves', 'Vaporwaves', 'Electronic', 'All Vaporwave. All the time.', 'png'],
  ['u80s', 'Underground 80s', 'Alternative · electronic', 'Early 80s UK Synthpop and a bit of New Wave.', 'png'],
  ['seventies', 'Left Coast 70s', '70s · rock', 'Mellow album rock from the Seventies. Yacht not required.', 'jpg'],
  ['7soul', 'Seven Inch Soul', 'Oldies', 'Vintage soul tracks from the original 45 RPM vinyl.', 'png'],
  ['insound', 'The In-Sound', 'Oldies', '60s/70s Hipster Euro Pop where psychedelic melodies meets groovy vibes.', 'jpg'],
  ['fluid', 'Fluid', 'Electronic · hip-hop', 'Drown in the electronic sound of instrumental hiphop, future soul and liquid trap.', 'jpg'],
  ['illstreet', 'Illinois Street Lounge', 'Lounge', 'Classic bachelor pad, playful exotica and vintage music of tomorrow.', 'jpg'],
  ['defcon', 'DEF CON Radio', 'Electronic', 'Music for Hacking. The DEF CON Year-Round Channel.', 'png'],
  ['lush', 'Lush', 'Electronic', 'Sensuous and mellow female vocals, many with an electronic influence.', 'png'],
  ['secretagent', 'Secret Agent', 'Lounge', 'The soundtrack for your stylish, mysterious, dangerous life. For Spies and PIs too!', 'png'],
  ['indiepop', 'Indie Pop Rocks!', 'Alternative · rock', 'New and classic favorite indie pop tracks.', 'png'],
].map(([id, name, genre, blurb, ext]) => ({
  id, name, genre, blurb,
  page: `${SOMA}/${id}/`,
  logo: `${SOMA_API}/logos/256/${id}256.${ext}`,
  logoType: ext === 'jpg' ? 'image/jpeg' : 'image/png',
}));
const BY_ID = new Map(STATIONS.map(s => [s.id, s]));
const ALL_IDS = STATIONS.slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => s.id);

/* the ids Music's openWith({ station }) accepts — STATIONS in music.js */
const MUSIC_PLAYS = new Set(['groovesalad', 'dronezone', 'lush', 'secretagent', 'defcon', 'deepspaceone', 'spacestation', 'indiepop', 'u80s', 'vaporwaves']);

/* ---------------- views: the library, then the genres ---------------- */
const LIBRARY = [
  { id: 'all', name: 'All stations', short: 'All', icon: 'cast', g1: '#ffc38a', g2: '#7a2a8c',
    kicker: 'Every station in Radio',
    note: `${STATIONS.length} live channels from SomaFM. SomaFM runs more than these — they’re all on somafm.com.` },
  { id: 'favs', name: 'Favorites', icon: 'heart', g1: '#ff9ec4', g2: '#9d174d',
    kicker: 'Saved on this device',
    note: 'Stations you’ve hearted. They stay in this browser — there’s no account behind them.' },
  { id: 'recent', name: 'Recently played', short: 'Recent', icon: 'clock', g1: '#bfdbfe', g2: '#1e40af',
    kicker: 'On this device',
    note: 'Stations played on this computer, from Radio or Music, newest first.' },
];
const GENRES = [
  { id: 'ambient', name: 'Ambient', icon: 'cloud', g1: '#a5b4fc', g2: '#312e81',
    ids: ['dronezone', 'deepspaceone', 'groovesalad'],
    kicker: 'SomaFM’s ambient channels',
    note: 'Drone Zone and Deep Space One are SomaFM’s deep-ambient streams; Groove Salad adds slow downtempo beats.' },
  { id: 'electronic', name: 'Electronic', icon: 'zap', g1: '#67e8f9', g2: '#155e75',
    ids: ['beatblender', 'spacestation', 'poptron', 'vaporwaves'],
    kicker: 'SomaFM’s electronic channels',
    note: 'Deep house, spaced-out electronica, electropop and vaporwave.' },
  { id: 'retro', name: 'Retro', icon: 'rotate-ccw', g1: '#fcd34d', g2: '#9a3412',
    ids: ['u80s', 'seventies', '7soul', 'insound'],
    kicker: 'Older music, still on the air',
    note: 'Early-80s synthpop, 70s album rock, soul 45s and 60s–70s Euro pop.' },
  { id: 'focus', name: 'Focus', icon: 'scan', g1: '#86efac', g2: '#14532d',
    ids: ['dronezone', 'groovesalad', 'spacestation'],
    kicker: 'Picked for focus',
    note: 'SomaFM doesn’t have a focus channel. StaticOS picked three of its steady ambient and downtempo streams to work to.' },
  { id: 'chill', name: 'Chill', icon: 'moon', g1: '#c4b5fd', g2: '#4c1d95',
    ids: ['fluid', 'groovesalad', 'illstreet'],
    kicker: 'The closest SomaFM gets to lo-fi',
    note: 'SomaFM has no station called lo-fi. Fluid’s instrumental hip-hop comes nearest, with Groove Salad’s downtempo and Illinois Street Lounge’s vintage lounge.' },
  { id: 'gaming', name: 'Gaming', icon: 'gamepad', g1: '#f0abfc', g2: '#86198f',
    ids: ['defcon', 'beatblender', 'poptron'],
    kicker: 'Picked for playing games',
    note: 'Not gaming radio — SomaFM doesn’t run any. StaticOS picked three upbeat channels to play games to.' },
];
const VIEWS = [...LIBRARY, ...GENRES];
const VIEW_BY_ID = new Map(VIEWS.map(v => [v.id, v]));

/* ---------------- saved state ---------------- */
function data() {
  const raw = store.get(STORE_KEY);
  const o = raw && typeof raw === 'object' ? raw : {};
  const favs = [...new Set((Array.isArray(o.favs) ? o.favs : []).filter(id => BY_ID.has(id)))];
  const seen = new Set();
  const recent = (Array.isArray(o.recent) ? o.recent : [])
    .filter(r => r && BY_ID.has(r.id) && Number.isFinite(Number(r.at)) && !seen.has(r.id) && seen.add(r.id))
    .map(r => ({ id: r.id, at: Number(r.at) }))
    .slice(0, 12);
  return { v: 1, favs, recent, view: VIEW_BY_ID.has(o.view) ? o.view : 'all' };
}
const save = patch => store.set(STORE_KEY, { ...data(), ...patch });
const isFav = id => data().favs.includes(id);
function toggleFav(id) {
  const favs = data().favs;
  save({ favs: favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id] });
}
function addRecent(id) {
  if (!BY_ID.has(id)) return;
  const d = data();
  if (d.recent[0]?.id === id && Date.now() - d.recent[0].at < 60000) return;
  save({ recent: [{ id, at: Date.now() }, ...d.recent.filter(r => r.id !== id)].slice(0, 12) });
}
function idsFor(viewId) {
  if (viewId === 'favs') return data().favs;
  if (viewId === 'recent') return data().recent.map(r => r.id);
  const ids = viewId === 'all' ? ALL_IDS : GENRES.find(g => g.id === viewId)?.ids || [];
  /* favourites first, in the order they were hearted; the rest keep their order */
  const favs = data().favs.filter(id => ids.includes(id));
  return [...favs, ...ids.filter(id => !favs.includes(id))];
}
/** How many of a view's stations lead it as favourites (0 for Favorites/Recent themselves). */
function favLead(viewId) {
  if (viewId === 'favs' || viewId === 'recent') return 0;
  const favs = new Set(data().favs);
  return idsFor(viewId).filter(id => favs.has(id)).length;
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

/* ---------------- SomaFM's own data: on air, listeners ----------------
   Both feeds are a snapshot of a moment. Past FRESH they are no longer
   what is on air, so nothing on screen may still call them current: the
   numbers come off the rows and the footer says what happened instead. */
const FRESH = 180000;
const CH = { map: null, at: 0, busy: false, err: null, errAt: 0 };
const chFresh = () => !!CH.map && Date.now() - CH.at < FRESH;
const chInfo = id => (chFresh() ? CH.map.get(id) || null : null);
async function loadChannels(force = false) {
  if (CH.busy) return;
  const now = Date.now();
  if (!force && CH.map && now - CH.at < 55000) return;
  if (!force && CH.err && now - CH.errAt < 30000) return;       /* a failure waits before asking again */
  CH.busy = true;
  changed('ch');
  try {
    const j = await getJSON(`${SOMA_API}/channels.json`);
    const m = new Map();
    for (const c of j?.channels || []) {
      if (BY_ID.has(c.id)) m.set(c.id, { listeners: Math.max(0, Math.round(Number(c.listeners) || 0)), last: String(c.lastPlaying || '').trim() });
    }
    CH.map = m;
    CH.at = Date.now();
    CH.err = null;
  } catch (e) {
    CH.err = online() ? 'unreachable' : 'offline';
    CH.errAt = Date.now();
  }
  CH.busy = false;
  changed('ch');
}

/* songs/<id>.json: the song on air first, then the ones before it */
const AIR = new Map();            /* id -> { songs:[{title,artist,album,at}], at, err } */
async function loadAir(id) {
  try {
    const j = await getJSON(`${SOMA}/songs/${id}.json`);
    const songs = (Array.isArray(j?.songs) ? j.songs : []).slice(0, 12)
      .map(s => ({ title: String(s?.title || '').trim(), artist: String(s?.artist || '').trim(), album: String(s?.album || '').trim(), at: Number(s?.date) * 1000 || 0 }))
      .filter(s => s.title);
    AIR.set(id, { songs, at: Date.now(), err: null });
  } catch (e) {
    const prev = AIR.get(id);
    AIR.set(id, { songs: prev?.songs || [], at: prev?.at || 0, err: online() ? 'unreachable' : 'offline' });
  }
}
const airSong = id => AIR.get(id)?.songs?.[0] || null;
/* the same song, but only while SomaFM's own read of it is still recent */
const airNow = id => airFresh(id)?.songs?.[0] || null;
/** songs/<id>.json only while it is still a fair description of what's on. */
function airFresh(id) {
  const a = AIR.get(id);
  return a && a.songs.length && Date.now() - a.at < FRESH ? a : null;
}
/** What is on this station, from whichever feed was read more recently —
    never from one that has gone stale. Returns null rather than a guess. */
function onAir(id) {
  const a = airFresh(id);
  const ch = chInfo(id);
  if (a && (!ch?.last || a.at >= CH.at)) {
    const s = a.songs[0];
    return { title: s.title, artist: s.artist, album: s.album, at: s.at, row: s.artist ? `${s.artist} - ${s.title}` : s.title };
  }
  return ch?.last ? { title: ch.last, artist: '', album: '', at: 0, row: ch.last } : null;
}

/* ---------------- who has the sound ---------------- */
const OWN_ON = new Set(['loading', 'playing', 'buffering']);
const R = {
  own: { st: null, phase: 'idle', err: null, note: null, slow: false, tryIx: 0, cors: true, token: 0, started: false, drops: [] },
  music: { st: null, playing: false, song: null, file: null, last: null, seq: 0, sig: '' },
  lead: null,               /* 'own' | 'music' — which one Radio's now-playing is about */
  ctx: [],                  /* the list the last station was picked from (media keys step through it) */
};
const subs = new Set();
function changed(kind) { subs.forEach(fn => { try { fn(kind); } catch (e) { console.error('[radio]', e); } }); }
const ownOn = () => R.lead === 'own' && OWN_ON.has(R.own.phase);

function nowPlaying() {
  if (R.lead === 'own' && R.own.st) {
    const p = R.own.phase;
    return { via: 'own', st: R.own.st, phase: p, on: OWN_ON.has(p), busy: p === 'loading' || p === 'buffering', err: R.own.err, note: R.own.note, slow: R.own.slow };
  }
  if (R.lead === 'music' && R.music.st) {
    return { via: 'music', st: R.music.st, phase: R.music.playing ? 'music' : 'stopped', on: R.music.playing, busy: false };
  }
  return { via: null, st: null, on: false, file: R.music.playing ? R.music.file : null };
}

/* bus plumbing: Radio's own emits must not trigger Radio's own listeners */
let quietBus = 0;
let selfTrack = false;
function emitQuiet(evt, ...a) { quietBus++; try { bus.emit(evt, ...a); } finally { quietBus--; } }
function emitTrack(t) { selfTrack = true; try { bus.emit('media:track', t); } finally { selfTrack = false; } }
const NOTHING = { title: 'Nothing playing', artist: '', album: '', duration: 0, elapsed: 0, playing: false, live: false, source: null };

/* ---------------- Radio's own player (stations Music doesn't list) ---------------- */
let audio = null;
let cardMine = false;         /* our station is what the Now Playing widget shows */
let slowTimer = 0, stallTimer = 0;

function applyVolume() {
  if (!audio) return;
  const v = Number(store.get('prefs.volume', 62));
  audio.volume = Math.min(100, Math.max(0, Number.isFinite(v) ? v : 62)) / 100;
  audio.muted = store.get('prefs.muted', false) === true;
}
function ensureAudio() {
  if (audio) return audio;
  if (typeof Audio !== 'function') return null;
  audio = new Audio();
  audio.preload = 'none';
  applyVolume();
  store.sub('prefs', applyVolume);
  audio.addEventListener('playing', onPlaying);
  audio.addEventListener('waiting', onWaiting);
  audio.addEventListener('timeupdate', onTime);
  audio.addEventListener('pause', onPauseEvt);
  audio.addEventListener('error', onErr);
  audio.addEventListener('ended', onErr);        /* a live stream that "ends" dropped */
  /* the wallpaper's music visualizer reads this player when the stream allows it */
  tap.register('radio', audio, {
    label: 'Static Radio',
    blocked: () => (R.own.st && !R.own.cors
      ? `${R.own.st.name} is coming through SomaFM’s plain server (its CORS servers didn’t answer here), so the browser won’t let StaticOS read the sound. The music still plays.`
      : null),
  });
  return audio;
}
function unloadOwn() {
  if (!audio) return;
  audio.pause();
  if (audio.getAttribute('src')) {
    audio.removeAttribute('src');
    try { audio.load(); } catch (e) { /* nothing to release */ }
  }
}
function clearSlow() { if (slowTimer) { clearTimeout(slowTimer); slowTimer = 0; } }
function armSlow(tok) {
  clearSlow();
  slowTimer = setTimeout(() => {
    slowTimer = 0;
    if (tok === R.own.token && R.own.phase === 'loading') { R.own.slow = true; changed('np'); }
  }, 15000);
}

const ERR = {
  offline: st => ({ title: 'You’re offline', detail: `${st.name} streams from SomaFM over the internet. Reconnect, then press Play.` }),
  localhost: st => ({ title: `${st.name} didn’t play`, detail: 'SomaFM refuses streams to pages served from localhost. It plays on the published StaticOS.' }),
  blocked: st => ({ title: `${st.name} didn’t play`, detail: 'SomaFM may be down, or this network blocks streaming radio — school and work Wi-Fi often do.' }),
  noaudio: () => ({ title: 'This browser can’t play audio', detail: 'Radio needs the browser’s audio player, and it isn’t available here.' }),
};

function startOwn(st) {
  if (!st) return;
  addRecent(st.id);
  const a = ensureAudio();
  const tok = ++R.own.token;
  clearSlow();
  clearTimeout(stallTimer);
  R.lead = 'own';
  if (!a) {
    Object.assign(R.own, { st, phase: 'error', err: ERR.noaudio(st), note: null, slow: false });
    changed('np');
    return;
  }
  emitQuiet('media:pause');                /* one player: Music stops before this starts */
  unloadOwn();
  Object.assign(R.own, { st, phase: 'loading', err: null, note: null, slow: false, tryIx: 0, cors: true, started: false, drops: [] });
  claimSession();
  sendCard();
  changed('np');
  syncAir();
  connect(tok);
}

function connect(tok) {
  const st = R.own.st;
  if (!st || tok !== R.own.token || !audio) return;
  if (!online()) { failOwn(tok, 'offline'); return; }
  armSlow(tok);
  const [host, cors] = TRIES[R.own.tryIx % TRIES.length];
  R.own.cors = cors;
  if (cors) audio.crossOrigin = 'anonymous'; else audio.removeAttribute('crossorigin');
  audio.src = streamUrl(st, host);
  let pr;
  try { pr = audio.play(); } catch (e) { pr = Promise.reject(e); }
  pr?.catch?.(e => {
    if (tok !== R.own.token || !e || e.name === 'AbortError') return;
    if (e.name === 'NotAllowedError') {
      R.own.token++;
      unloadOwn();
      clearSlow();
      R.own.phase = 'stopped';
      R.own.note = 'The browser held the sound back until you click in the page. Press Play to start.';
      releaseCard();
      changed('np');
      syncAir();
    }
    /* NotSupportedError: the element's own 'error' event explains it */
  });
}

function failOwn(tok, kind) {
  if (tok !== R.own.token) return;
  R.own.token++;
  unloadOwn();
  clearSlow();
  clearTimeout(stallTimer);
  R.own.phase = 'error';
  R.own.err = ERR[kind](R.own.st);
  R.own.slow = false;
  releaseCard();
  changed('np');
  syncAir();
}

/** Stop Radio's own player. `release` puts Music's card and keys back —
    not wanted when Music is taking over, since Music announces itself. */
function stopOwn(release = true) {
  if (!R.own.st) return;
  R.own.token++;
  clearSlow();
  clearTimeout(stallTimer);
  if (R.own.phase !== 'error') R.own.phase = 'stopped';
  R.own.slow = false;
  unloadOwn();
  if (release) releaseCard();
  changed('np');
  syncAir();
}

function onPlaying() {
  if (!OWN_ON.has(R.own.phase)) return;
  clearTimeout(stallTimer);
  clearSlow();
  R.own.phase = 'playing';
  R.own.started = true;
  R.own.slow = false;
  R.own.err = null;
  R.own.note = null;
  sendCard();
  changed('np');
  syncAir();
}
/* live streams stall for a moment now and then; only one that lasts says so */
function onWaiting() {
  if (R.own.phase !== 'playing') return;
  clearTimeout(stallTimer);
  const tok = R.own.token;
  stallTimer = setTimeout(() => {
    if (tok === R.own.token && R.own.phase === 'playing' && audio.readyState < 3) { R.own.phase = 'buffering'; changed('np'); }
  }, 1200);
}
function onTime() {
  if (R.own.phase === 'buffering' && !audio.paused && audio.readyState >= 3) { R.own.phase = 'playing'; changed('np'); }
}
/* something outside Radio paused the element (the OS took audio focus) */
function onPauseEvt() {
  if (!audio.getAttribute('src')) return;
  if (R.own.phase === 'playing' || R.own.phase === 'buffering') stopOwn();
}
function onErr() {
  if (!audio || !audio.getAttribute('src')) return;
  const code = audio.error ? audio.error.code : 0;
  if (code === 1) return;                                  /* aborted: we changed the source */
  if (!OWN_ON.has(R.own.phase)) return;
  const tok = R.own.token;
  clearTimeout(stallTimer);
  if (R.own.started) {
    /* it was playing and dropped: reconnect by itself, but not forever */
    const now = Date.now();
    R.own.drops = R.own.drops.filter(t => now - t < 60000);
    R.own.drops.push(now);
    if (R.own.drops.length <= 3 && online()) {
      R.own.tryIx++;
      R.own.phase = 'loading';
      changed('np');
      connect(tok);
      return;
    }
  } else if (R.own.tryIx < TRIES.length - 1 && online()) {
    R.own.tryIx++;
    connect(tok);
    return;
  }
  failOwn(tok, !online() ? 'offline' : onLocalhost() ? 'localhost' : 'blocked');
}

/* ---------------- the Now Playing card + media keys ---------------- */
function sendCard() {
  const st = R.own.st;
  if (!st || R.lead !== 'own') return;
  const s = airNow(st.id);
  cardMine = true;
  emitTrack({
    title: s?.title || st.name, artist: s ? (s.artist || 'SomaFM') : 'SomaFM', album: `${st.name} · live radio`,
    duration: 0, elapsed: 0, playing: OWN_ON.has(R.own.phase), live: true, source: 'radio',
  });
  msMeta();
}
/* give the widget back to Music: its last word on its own state */
function releaseCard() {
  if (cardMine) {
    cardMine = false;
    const t = R.music.last;
    emitTrack(t && typeof t === 'object' ? { ...t, playing: false } : NOTHING);
  }
  releaseSession();
}

const MS = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;
let msOwned = false, msMine = null, msPrev = null;
function msSet(action, fn) { try { MS.setActionHandler(action, fn); } catch (e) { /* not supported here */ } }
function claimSession() {
  if (!MS) return;
  if (!msOwned) { msOwned = true; msPrev = MS.metadata || null; }
  msSet('play', () => { if (R.lead === 'own' && R.own.st && !ownOn()) startOwn(R.own.st); });
  msSet('pause', () => stopOwn());
  msSet('stop', () => stopOwn());
  msSet('nexttrack', () => stepOwn(1));
  msSet('previoustrack', () => stepOwn(-1));
  msSet('seekto', null);
  msSet('seekbackward', null);
  msSet('seekforward', null);
  msMeta();
}
function msMeta() {
  if (!MS || !msOwned || !R.own.st) return;
  const st = R.own.st;
  const s = airNow(st.id);
  try {
    if (typeof MediaMetadata === 'function') {
      msMine = new MediaMetadata({
        title: s?.title || st.name, artist: s ? (s.artist || 'SomaFM') : 'SomaFM', album: `${st.name} · live radio`,
        artwork: [{ src: st.logo, sizes: '256x256', type: st.logoType }],
      });
      MS.metadata = msMine;
    }
    MS.playbackState = OWN_ON.has(R.own.phase) ? 'playing' : 'paused';
    if (MS.setPositionState) MS.setPositionState();
  } catch (e) { /* a browser with a partial Media Session */ }
}
function releaseSession() {
  if (!MS || !msOwned) return;
  msOwned = false;
  try {
    if (MS.metadata === msMine) MS.metadata = msPrev;
    MS.playbackState = msPrev ? 'paused' : 'none';
  } catch (e) { /* partial Media Session */ }
  msMine = null;
  msPrev = null;
  /* exactly what Music's own handlers call, so Music keeps working until it claims them again */
  msSet('play', () => bus.emit('media:play'));
  msSet('pause', () => bus.emit('media:pause'));
  msSet('stop', () => bus.emit('media:pause'));
  msSet('nexttrack', () => bus.emit('media:next'));
  msSet('previoustrack', () => bus.emit('media:prev'));
}

/* Next / previous station within the list it was picked from */
function stepOwn(dir) {
  if (R.lead !== 'own' || !R.own.st) return;
  const ids = R.ctx.length ? R.ctx : ALL_IDS;
  let i = ids.indexOf(R.own.st.id);
  if (i < 0) i = dir > 0 ? -1 : 0;
  const next = BY_ID.get(ids[(i + dir + ids.length) % ids.length]);
  if (next && next !== R.own.st) playStation(next, { ctx: ids });
}

/* ---------------- playing a station: hand it to Music when Music can ---------------- */
function playStation(st, o = {}) {
  if (!st) return;
  if (Array.isArray(o.ctx) && o.ctx.length) R.ctx = o.ctx.slice();
  if (MUSIC_PLAYS.has(st.id) && api.getApp('music')) {
    if (ownOn()) stopOwn(false);                          /* Music is about to announce itself */
    const seq = R.music.seq;
    if (R.music.st === st && !R.music.playing) bus.emit('media:play');     /* Music is already on it: just resume */
    else api.openApp('music', { station: st.id });
    try { o.win?.focus(); } catch (e) { /* the window closed meanwhile */ }
    if (R.music.seq !== seq && R.music.st === st) {
      /* Music's own announcement replaced ours on the widget; the keys go back to it */
      cardMine = false;
      releaseSession();
      R.lead = 'music';
      changed('np');
      syncAir();
      return;
    }
    /* Music didn't take it — play it here rather than not at all */
  }
  startOwn(st);
}

/* ---------------- listening to the rest of the OS ---------------- */
function stationFromAlbum(album) {
  const m = /^(.*) · live radio$/.exec(String(album || ''));
  return m ? STATIONS.find(s => s.name === m[1]) || null : null;
}
function onTrack(t) {
  if (selfTrack) return;
  const M = R.music;
  M.seq++;
  M.last = t && typeof t === 'object' ? { ...t } : null;
  const st = t && t.source === 'radio' ? stationFromAlbum(t.album) : null;
  const playing = !!(t && t.playing);
  const wasPlaying = M.playing, wasSt = M.st;
  if (playing) {
    /* Music has the sound now: Radio's own player steps aside */
    if (ownOn()) stopOwn(false);
    cardMine = false;
    releaseSession();
    R.lead = 'music';
  } else if (!R.lead && st) R.lead = 'music';
  M.st = st;
  M.playing = playing;
  M.song = st && t.title && !(t.title === st.name && t.artist === 'SomaFM') ? { title: String(t.title), artist: String(t.artist || '') } : null;
  M.file = !st && t && t.source === 'file' ? { title: String(t.title || ''), artist: String(t.artist || '') } : null;
  if (playing && st && (!wasPlaying || wasSt !== st)) addRecent(st.id);
  const sig = `${st?.id || ''}|${playing}|${M.song?.title || ''}|${M.song?.artist || ''}|${M.file?.title || ''}|${R.lead}`;
  if (sig !== M.sig) {
    M.sig = sig;
    changed('np');
    syncAir();
  }
}
bus.on('media:track', onTrack);
bus.on('media:pause', () => { if (!quietBus && ownOn()) stopOwn(); });
/* Music moves its own (paused) queue on next/prev too, so ours goes after it */
bus.on('media:next', () => { if (!quietBus && ownOn()) setTimeout(() => { if (ownOn()) stepOwn(1); }, 0); });
bus.on('media:prev', () => { if (!quietBus && ownOn()) setTimeout(() => { if (ownOn()) stepOwn(-1); }, 0); });

/* ---------------- what's on air: poll only while it matters ---------------- */
let openWins = 0;
let airId = null, airGen = 0, airTimer = 0;
function airWanted() {
  const np = nowPlaying();
  if (!np.st) return null;
  if (np.via === 'own' && np.on) return np.st.id;                   /* the widget shows the song */
  if (np.via === 'music' && np.on && openWins > 0) return np.st.id; /* Radio's window shows it */
  return null;
}
function syncAir() {
  const id = airWanted();
  if (id === airId) return;
  airId = id;
  airGen++;
  clearTimeout(airTimer);
  airTimer = 0;
  if (id) tickAir(airGen);
}
async function tickAir(gen) {
  const id = airId;
  if (!id) return;
  const before = airSong(id)?.title || '';
  await loadAir(id);
  if (gen !== airGen) return;
  if ((airSong(id)?.title || '') !== before && R.lead === 'own' && R.own.st?.id === id) sendCard();
  changed('air');
  airTimer = setTimeout(() => tickAir(gen), 30000);
}

/* ======================================================================= */
defineApp({
  id: 'radio',
  name: 'Static Radio',
  icon: 'cast',
  g1: '#ec5fc6', g2: '#961a7f',
  category: 'Media',
  keywords: ['radio', 'somafm', 'stations', 'live', 'stream', 'internet radio', 'music', 'ambient', 'electronic', 'retro',
    'focus', 'study', 'lofi', 'lo-fi', 'chill', 'gaming', 'random', 'discover'],
  desc: 'Live internet radio from SomaFM, by genre',
  singleton: true,
  win: { w: 880, h: 600, minW: 400, minH: 420 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Space / K', 'Play or pause'],
    ['R', 'A random station'],
  ],

  mount(ctx) {
    const { root, win, opts, api: A } = ctx;
    const { h, icon, clear } = A;
    const ago = ms => A.fmt.fmtAgo(ms);
    let dead = false;
    openWins++;

    const S = { view: data().view, hist: false };
    const listLogos = new Map();
    const npLogos = new Map();
    const uid = `rd${win.id}`;

    /* ---------------- skeleton ---------------- */
    const side = h('nav.app__side.rd-side', { 'aria-label': 'Radio views' });
    const chips = h('div.rd-chips', { role: 'group', 'aria-label': 'Radio views' });
    const headGlyph = h('div.glyph.rd-head__glyph', { 'aria-hidden': 'true' });
    const headTitle = h('h2.rd-head__title');
    const headKicker = h('span.rd-head__kicker');
    const headCount = h('span.rd-head__count');
    const randomBtn = h('button.btn.btn--sm.rd-random', { type: 'button', 'aria-keyshortcuts': 'R', onclick: () => random() },
      icon('shuffle'), h('span.rd-random__lbl', { text: 'Random station' }));
    const head = h('div.app__bar.rd-head', headGlyph, h('div.rd-head__txt', headTitle, headKicker), h('div.grow'), headCount, randomBtn);
    const list = h('div.app__content.rd-list');
    const npBox = h('section.rd-np', { 'aria-label': 'Now playing' });
    const live = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    const main = h('div.app__main.rd-main', chips, head, list, npBox);
    const shell = h('div.app.rd', side, main, live);
    root.appendChild(shell);

    /* ---------------- small pieces ---------------- */
    const currentIds = () => idsFor(S.view);
    const extLink = (href, text, label) => h('a.rd-link', { href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label || `${text} (opens a new tab)` },
      h('span', { text }), icon('external-link'));
    const eq = () => h('span.rd-eq', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));

    function logo(st, cache) {
      let box = cache.get(st.id);
      if (!box) {
        const img = h('img', { src: st.logo, alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
        box = h('span.rd-logo', img);
        img.addEventListener('error', () => { box.classList.add('is-broken'); img.remove(); box.prepend(icon('cast')); }, { once: true });
        cache.set(st.id, box);
      }
      return box;
    }

    function stateWord(np) {
      if (np.via === 'own') {
        return { loading: 'Connecting…', buffering: 'Buffering…', playing: 'Live', stopped: 'Stopped', error: 'Didn’t play' }[np.phase] || '';
      }
      if (np.via === 'music') return np.on ? 'Via Music' : 'Stopped';
      return '';
    }
    function statusText(np) {
      if (np.via === 'own') {
        if (np.phase === 'loading') return np.slow ? 'Still connecting — SomaFM may be slow, or this network may be blocking streaming radio.' : 'Connecting to SomaFM…';
        if (np.phase === 'buffering') return 'Buffering — the stream picks up again by itself.';
        if (np.phase === 'playing') return 'Live · playing here, because Music doesn’t list this station.';
        if (np.phase === 'error') return `${np.err?.title || 'It didn’t play'}. ${np.err?.detail || ''}`.trim();
        return np.note || 'Stopped.';
      }
      if (np.via === 'music') return np.on ? 'Playing through Music, the player for all of StaticOS.' : 'Not playing. Press Play to tune in again — if something went wrong, Music says what.';
      return '';
    }
    /* the song line: whichever of SomaFM's two feeds was read more recently,
       else what Music heard. Nothing stale is passed off as what's on now. */
    function songOf(st, np) {
      const s = onAir(st.id);
      if (s) return { text: `${s.title}${s.artist ? ` — ${s.artist}` : ''}`, album: s.album, at: s.at };
      if (np?.via === 'music' && R.music.st === st && R.music.song) return { text: `${R.music.song.title}${R.music.song.artist ? ` — ${R.music.song.artist}` : ''}` };
      return null;
    }

    /* ---------------- sidebar + phone chips ---------------- */
    function countFor(v) { return idsFor(v.id).length; }
    function paintSide() {
      clear(side);
      const item = v => {
        const on = v.id === S.view;
        const n = countFor(v);
        return h('button.side__item.rd-side__item', {
          type: 'button', class: on ? 'is-on' : null, 'aria-current': on ? 'page' : null,
          'aria-label': `${v.name}, ${n || 'no'} station${n === 1 ? '' : 's'}`,
          dataset: { k: `view:${v.id}` }, onclick: () => go(v.id),
        }, icon(v.icon), h('span', { text: v.name }), n ? h('small', { text: String(n), 'aria-hidden': 'true' }) : null);
      };
      side.append(
        h('div.side__group', h('div.side__label', { text: 'Radio' }), LIBRARY.map(item)),
        h('div.side__group', h('div.side__label', { text: 'Genres' }), GENRES.map(item)),
        h('div.grow'),
        h('div.side__meter.rd-about',
          h('b', { text: 'SomaFM' }),
          h('small', { text: 'Live, listener-supported radio from San Francisco. Not affiliated with StaticOS.' }),
          extLink(`${SOMA}/support/`, 'Support SomaFM', 'Support SomaFM (opens somafm.com in a new tab)')));
    }
    function paintChips() {
      clear(chips);
      for (const v of VIEWS) {
        const on = v.id === S.view;
        chips.appendChild(h('button.rd-chip', {
          type: 'button', class: on ? 'is-on' : null, 'aria-pressed': on ? 'true' : 'false',
          dataset: { k: `chip:${v.id}` }, onclick: () => go(v.id),
        }, icon(v.icon), h('span', { text: v.short || v.name })));
      }
    }

    /* ---------------- header ---------------- */
    function paintHead() {
      const v = VIEW_BY_ID.get(S.view);
      headGlyph.style.setProperty('--g1', v.g1);
      headGlyph.style.setProperty('--g2', v.g2);
      clear(headGlyph).appendChild(icon(v.icon));
      headTitle.textContent = v.name;
      headKicker.textContent = v.kicker;
      const n = currentIds().length;
      headCount.textContent = n ? `${n} station${n === 1 ? '' : 's'}` : '';
      const scoped = n >= 2 && S.view !== 'all';
      const tip = scoped ? `Play a random station from ${v.name} (R)` : 'Play a random station (R)';
      randomBtn.title = tip;
      randomBtn.setAttribute('aria-label', tip.replace(' (R)', ''));
      win.setSubtitle(v.name);
    }

    /* ---------------- the station list ---------------- */
    function row(st) {
      const np = nowPlaying();
      const cur = np.st === st;
      const on = cur && np.on;
      const fav = isFav(st.id);
      const info = chInfo(st.id);
      /* rows use SomaFM's own "Artist - Title" form throughout, whichever feed it came from */
      const a = onAir(st.id);
      const song = a ? { text: a.row } : null;
      const played = S.view === 'recent' ? data().recent.find(r => r.id === st.id)?.at : 0;
      const meta = [st.genre];
      if (info) meta.push(`${info.listeners.toLocaleString()} listening`);
      if (played) meta.push(`played ${ago(played)}`);
      const descId = `${uid}-${st.id}-d`;

      const box = logo(st, listLogos);
      box.querySelector('.rd-logo__ov')?.remove();
      box.appendChild(h('span.rd-logo__ov', { 'aria-hidden': 'true' },
        on && !np.busy ? eq() : null, icon(on ? 'square' : 'play', { fill: true })));
      box.classList.toggle('is-on', on);
      box.classList.toggle('is-busy', on && np.busy);

      const mainBtn = h('button.rd-row__main', {
        type: 'button', dataset: { k: `main:${st.id}`, role: 'main' },
        'aria-label': on ? `Stop ${st.name}` : `Play ${st.name}`,
        'aria-pressed': on ? 'true' : 'false',
        'aria-describedby': descId,
        onclick: () => (on ? stopNP() : playStation(st, { win, ctx: currentIds() })),
        onkeydown: rowNav,
      },
        box,
        h('span.rd-row__txt',
          h('span.rd-row__name', h('b', { text: st.name }), cur ? h(`span.rd-tag.is-${np.phase}`, { text: stateWord(np) }) : null),
          h('span.rd-row__blurb', { text: st.blurb }),
          h('span.rd-row__meta', { id: descId },
            h('span', { text: meta.join(' · ') }),
            song ? h('span.rd-row__air', h('span.rd-onair', { text: 'On air' }), h('span.rd-row__song', { text: song.text })) : null)));

      const favBtn = h('button.ibtn.rd-fav', {
        type: 'button', class: fav ? 'is-on' : null, 'aria-pressed': fav ? 'true' : 'false',
        'aria-label': fav ? `Remove ${st.name} from favorites` : `Add ${st.name} to favorites`,
        title: fav ? 'Remove from favorites' : 'Add to favorites',
        dataset: { k: `fav:${st.id}` }, onclick: () => toggleFav(st.id),
      }, icon('heart', fav ? { fill: true } : undefined));
      const moreBtn = h('button.ibtn.rd-more', {
        type: 'button', 'aria-label': `More for ${st.name}`, 'aria-haspopup': 'menu', title: 'More',
        dataset: { k: `more:${st.id}` }, onclick: e => rowMenu(e, st),
      }, icon('more-horizontal'));

      return h('div.rd-row', {
        role: 'listitem', class: cur ? (on ? 'is-cur is-on' : 'is-cur') : null, dataset: { id: st.id },
        oncontextmenu: e => { e.preventDefault(); rowMenu(e, st); },
      }, mainBtn, h('div.rd-row__acts', favBtn, moreBtn));
    }

    function emptyFor(v) {
      if (v.id === 'favs') {
        return h('div.empty.rd-empty', icon('heart'), h('b', { text: 'No favorites yet' }),
          h('small', { text: 'Tap the heart on any station and it stays here.' }),
          h('button.btn.btn--sm', { type: 'button', dataset: { k: 'empty:all' }, onclick: () => go('all') }, icon('cast'), h('span', { text: 'Browse all stations' })));
      }
      return h('div.empty.rd-empty', icon('clock'), h('b', { text: 'Nothing played yet' }),
        h('small', { text: 'Stations you play from Radio or Music show up here.' }),
        h('button.btn.btn--sm', { type: 'button', dataset: { k: 'empty:random' }, onclick: () => random() }, icon('shuffle'), h('span', { text: 'Random station' })));
    }

    function foot() {
      /* a failed read is said out loud even when older numbers are still
         on screen, and a read that has gone stale says it has */
      let status = '';
      if (CH.busy) status = 'Asking SomaFM what’s on air…';
      else if (CH.err === 'offline') status = CH.map
        ? `Offline — what’s on air was last read ${ago(CH.at)} and isn’t being updated.`
        : 'Offline — what’s on air loads when you reconnect.';
      else if (CH.err) status = CH.map
        ? `Couldn’t reach SomaFM just now — what’s on air was last read ${ago(CH.at)}. The stations may still play.`
        : 'Couldn’t reach SomaFM for what’s on air. The stations may still play.';
      else if (chFresh()) status = `On air and listener numbers from SomaFM · updated ${ago(CH.at)}`;
      else if (CH.map) status = `What’s on air was last read ${ago(CH.at)} — too long ago to still be right, so the rows leave it out.`;
      return h('footer.rd-foot',
        h('p', { text: 'Live radio from SomaFM, an independent, listener-supported station in San Francisco — not affiliated with StaticOS. It streams over the internet, so it needs a connection, and a locked-down network (school or work Wi-Fi) may block it.' }),
        h('div.rd-foot__row',
          CH.busy ? h('span.spinner', { 'aria-hidden': 'true' }) : null,
          h('span.rd-foot__status', { text: status }),
          !CH.busy && (CH.err || !chFresh()) ? h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { k: 'ch:retry' }, onclick: () => loadChannels(true) }, icon('refresh'), h('span', { text: CH.err ? 'Try again' : 'Refresh' })) : null,
          h('div.grow'),
          extLink(`${SOMA}/support/`, 'Support SomaFM', 'Support SomaFM (opens somafm.com in a new tab)'),
          extLink(`${SOMA}/`, 'Every SomaFM channel', 'Every SomaFM channel (opens somafm.com in a new tab)')));
    }

    function paintList() {
      clear(list);
      const v = VIEW_BY_ID.get(S.view);
      if (!online()) {
        list.appendChild(h('div.rd-banner', icon('wifi-off'),
          h('span', { text: 'You’re offline. Radio needs the internet — the stations play again once you reconnect.' })));
      }
      list.appendChild(h('p.rd-note', icon('info'), h('span', { text: v.note })));
      const ids = currentIds();
      const lead = favLead(S.view);
      if (!ids.length) list.appendChild(emptyFor(v));
      else if (lead) {
        list.appendChild(h('div.rd-group', icon('heart', { fill: true }), h('span.label', { text: `Favorites · ${lead}` }),
          h('span.rd-group__note', { text: 'saved on this device · shown first' })));
        list.appendChild(h('div.rd-rows', { role: 'list', 'aria-label': `Favorite ${v.name} stations` }, ids.slice(0, lead).map(id => row(BY_ID.get(id)))));
        if (ids.length > lead) {
          list.appendChild(h('div.rd-group', h('span.label', { text: S.view === 'all' ? 'All stations' : `More ${v.name}` })));
          list.appendChild(h('div.rd-rows', { role: 'list', 'aria-label': `More ${v.name} stations` }, ids.slice(lead).map(id => row(BY_ID.get(id)))));
        }
      } else list.appendChild(h('div.rd-rows', { role: 'list', 'aria-label': `${v.name} stations` }, ids.map(id => row(BY_ID.get(id)))));
      list.appendChild(foot());
    }

    /* ---------------- now playing ---------------- */
    function paintNP() {
      clear(npBox);
      const np = nowPlaying();
      npBox.classList.toggle('is-idle', !np.st);
      if (!np.st) {
        npBox.appendChild(h('div.rd-np__bar',
          h('span.rd-np__art.is-idle', { 'aria-hidden': 'true' }, icon('cast')),
          h('div.rd-np__txt',
            h('div.rd-np__title', h('b', { text: 'Nothing on yet' })),
            h('div.rd-np__status', { text: np.file?.title
              ? `Music is playing “${np.file.title}”. Picking a station switches it to the radio.`
              : 'Pick a station, or let Radio pick one for you.' })),
          h('div.rd-np__ctl',
            h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { k: 'np:random' }, onclick: () => random() }, icon('shuffle'), h('span', { text: 'Random station' })))));
        return;
      }
      const st = np.st;
      const err = np.via === 'own' && np.phase === 'error';
      const song = songOf(st, np);
      const fav = isFav(st.id);
      const histId = `${uid}-hist`;

      if (S.hist) npBox.appendChild(history(st, histId));

      const toggle = h('button.rd-play', {
        type: 'button', dataset: { k: 'np:toggle' }, 'aria-keyshortcuts': 'K',
        class: np.busy ? 'is-busy' : null,
        'aria-label': err ? `Try ${st.name} again` : np.on ? `Stop ${st.name}` : `Play ${st.name}`,
        title: err ? 'Try again' : np.on ? 'Stop (K)' : 'Play (K)',
        onclick: () => (np.on ? stopNP() : playStation(st, { win, ctx: R.ctx.length ? R.ctx : currentIds() })),
      }, icon(err ? 'refresh' : np.on ? 'square' : 'play', { fill: !err }));

      npBox.appendChild(h('div.rd-np__bar',
        h('span.rd-np__art', logo(st, npLogos), np.on && !np.busy ? eq() : null),
        h('div.rd-np__txt',
          h('div.rd-np__title', h('b', { text: st.name }), h(`span.rd-tag.is-${np.phase}`, { text: stateWord(np) })),
          song
            ? h('div.rd-np__song', { title: song.album ? `${song.text} · ${song.album}` : song.text },
              h('span.rd-np__songt', { text: song.text }),
              song.at ? h('span.rd-np__ago', { text: `started ${ago(song.at)}` }) : null)
            : h('div.rd-np__song.dim', { text: st.genre }),
          h('div.rd-np__status', { class: err ? 'is-err' : null, text: statusText(np) })),
        h('div.rd-np__ctl',
          toggle,
          np.via === 'music' ? h('button.btn.btn--sm.rd-np__music', {
            type: 'button', dataset: { k: 'np:music' }, title: 'Show Music', 'aria-label': 'Show Music, which is playing this station',
            onclick: () => A.openApp('music'),
          }, icon('music'), h('span.rd-np__musiclbl', { text: 'Show in Music' })) : null,
          h('button.ibtn.rd-fav', {
            type: 'button', class: fav ? 'is-on' : null, 'aria-pressed': fav ? 'true' : 'false', dataset: { k: 'np:fav' },
            'aria-label': fav ? `Remove ${st.name} from favorites` : `Add ${st.name} to favorites`, title: fav ? 'Remove from favorites' : 'Add to favorites',
            onclick: () => toggleFav(st.id),
          }, icon('heart', fav ? { fill: true } : undefined)),
          h('button.ibtn.rd-np__histbtn', {
            type: 'button', class: S.hist ? 'is-on' : null, dataset: { k: 'np:hist' },
            'aria-expanded': S.hist ? 'true' : 'false', 'aria-controls': S.hist ? histId : null,
            'aria-label': `Songs played earlier on ${st.name}`, title: 'Played earlier',
            onclick: () => { S.hist = !S.hist; if (S.hist && !AIR.has(st.id)) loadAir(st.id).then(() => changed('air')); paint(); },
          }, icon('list-music')))));
    }

    function history(st, id) {
      const air = AIR.get(st.id);
      const earlier = (air?.songs || []).slice(1, 9);
      let body;
      if (earlier.length) {
        body = h('ol.rd-hist__list', earlier.map(s => h('li',
          h('span.rd-hist__t', h('b', { text: s.title }), s.artist ? h('span', { text: ` — ${s.artist}` }) : null),
          s.at ? h('small', { text: ago(s.at) }) : null)));
      } else {
        body = h('p.rd-hist__none', { text: !air ? 'Asking SomaFM…' : air.err ? 'SomaFM didn’t answer — try again in a moment.' : 'SomaFM hasn’t listed any earlier songs yet.' });
      }
      return h('div.rd-hist', { id },
        h('div.rd-hist__head', h('span.label', { text: `Earlier on ${st.name}` }), h('div.grow'),
          extLink(`${SOMA}/${st.id}/songhistory.html`, 'Full list on somafm.com', `Full song history for ${st.name} (opens somafm.com in a new tab)`)),
        body);
    }

    /* ---------------- actions ---------------- */
    function stopNP() {
      const np = nowPlaying();
      if (np.via === 'own') stopOwn();
      else if (np.via === 'music') bus.emit('media:pause');
    }
    function toggleNP() {
      const np = nowPlaying();
      if (!np.st) { random(); return; }
      if (np.on) stopNP();
      else playStation(np.st, { win, ctx: R.ctx.length ? R.ctx : currentIds() });
    }
    function random() {
      let pool = currentIds();
      if (pool.length < 2) pool = ALL_IDS;
      const cur = nowPlaying().st?.id;
      const choices = pool.filter(id => id !== cur);
      const pick = BY_ID.get(choices[Math.floor(Math.random() * choices.length)]);
      if (pick) playStation(pick, { win, ctx: pool });
    }
    function go(viewId) {
      if (!VIEW_BY_ID.has(viewId)) return;
      const changedView = viewId !== S.view;
      S.view = viewId;
      if (changedView) save({ view: viewId });
      paint();
      if (changedView) list.scrollTop = 0;
      showChip();
    }
    /* keep the chosen chip in sight in the phone strip (scrolls only the strip) */
    function showChip() {
      const c = chips.querySelector('.rd-chip.is-on');
      if (!c || !chips.clientWidth) return;
      const l = c.offsetLeft - chips.offsetLeft, r = l + c.offsetWidth;
      if (l < chips.scrollLeft) chips.scrollLeft = Math.max(0, l - 16);
      else if (r > chips.scrollLeft + chips.clientWidth) chips.scrollLeft = r - chips.clientWidth + 16;
    }
    function rowMenu(e, st) {
      const r = e.currentTarget?.getBoundingClientRect?.();
      const x = e.clientX || (r ? r.left : 0), y = e.clientY || (r ? r.bottom : 0);
      const np = nowPlaying();
      const on = np.st === st && np.on;
      const fav = isFav(st.id);
      A.menu([
        { label: on ? `Stop ${st.name}` : `Play ${st.name}`, icon: on ? 'square' : 'play', onClick: () => (on ? stopNP() : playStation(st, { win, ctx: currentIds() })) },
        { label: fav ? 'Remove from favorites' : 'Add to favorites', icon: 'heart', onClick: () => toggleFav(st.id) },
        '-',
        { label: 'Station page on somafm.com', icon: 'external-link', onClick: () => { try { window.open(st.page, '_blank', 'noopener,noreferrer'); } catch (err) { /* popup blocked */ } } },
        { label: 'Copy stream address', icon: 'copy', onClick: () => copyStream(st) },
      ], x, y);
    }
    async function copyStream(st) {
      const url = streamUrl(st);
      try {
        await navigator.clipboard.writeText(url);
        A.notify({ app: 'Static Radio', icon: 'copy', title: 'Stream address copied', message: `${st.name} — paste it into any audio player.`, timeout: 3500 });
      } catch (e) {
        A.notify({ app: 'Static Radio', icon: 'alert', title: 'Couldn’t copy', message: `The clipboard isn’t available here. The address is ${url}`, timeout: 9000 });
      }
    }

    /* ↑/↓ move between stations; Home/End jump; Enter/Space play (native button) */
    function rowNav(e) {
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
      if (!keys.includes(e.key)) return;
      const rows = [...list.querySelectorAll('[data-role="main"]')];
      const i = rows.indexOf(e.currentTarget);
      const to = e.key === 'Home' ? rows[0] : e.key === 'End' ? rows[rows.length - 1] : rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!to) return;
      e.preventDefault();
      e.stopPropagation();
      to.focus();
      to.scrollIntoView({ block: 'nearest' });
    }

    /* ---------------- paint ---------------- */
    let lastSpoken = '';
    function announce() {
      const np = nowPlaying();
      const text = np.st ? `${np.st.name}: ${stateWord(np)}. ${np.via === 'own' && np.phase === 'error' ? statusText(np) : ''}`.trim() : '';
      if (text && text !== lastSpoken) { lastSpoken = text; live.textContent = text; }
    }
    function paint() {
      if (dead) return;
      const a = document.activeElement;
      const key = a && shell.contains(a) ? a.dataset?.k : null;
      const top = list.scrollTop, left = chips.scrollLeft;
      paintSide();
      paintChips();
      paintHead();
      paintList();
      paintNP();
      list.scrollTop = top;
      chips.scrollLeft = left;
      if (key && document.activeElement !== a) {
        const el = shell.querySelector(`[data-k="${CSS.escape(key)}"]`);
        el?.focus({ preventScroll: true });
      }
      announce();
    }
    let raf = 0;
    const soon = () => { if (!raf && !dead) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };

    /* ---------------- wiring ---------------- */
    /* repaint the moment SomaFM's figures stop being current, rather than
       up to a minute later when the refresh timer next comes round */
    let staleTimer = 0;
    function armStale() {
      clearTimeout(staleTimer);
      staleTimer = 0;
      if (!CH.map) return;
      const left = CH.at + FRESH - Date.now();
      if (left > 0) staleTimer = setTimeout(() => { staleTimer = 0; soon(); }, left + 50);
    }
    const onChange = () => { armStale(); soon(); };
    subs.add(onChange);
    const offStore = store.sub(STORE_KEY, soon);
    const onNet = () => { if (online()) loadChannels(true); soon(); };
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    /* a window that was minimised or in a background tab stopped refreshing,
       so its numbers are stale the moment it is looked at again: ask then */
    const onLook = () => { if (!win.min && document.visibilityState === 'visible') loadChannels(); soon(); };
    document.addEventListener('visibilitychange', onLook);
    win.onFocus(onLook);
    /* listener numbers go stale: refresh while the window is on screen */
    const chTimer = setInterval(() => {
      if (!win.min && document.visibilityState === 'visible') loadChannels();
      soon();                                       /* "updated 3m ago" moves on */
    }, 60000);
    const onKey = e => {
      if (!win.el.classList.contains('is-active') || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = t?.tagName;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag || '') || t?.isContentEditable) return;
      const a = document.activeElement;
      if (a && a !== document.body && !win.el.contains(a)) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); random(); }
      else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); toggleNP(); }
      else if (e.key === ' ' && !(tag === 'BUTTON' || tag === 'A')) { e.preventDefault(); toggleNP(); }
    };
    window.addEventListener('keydown', onKey);

    function openWith(o) {
      if (!o) return;
      if (o.view && VIEW_BY_ID.has(o.view)) go(o.view);
      const st = o.station ? BY_ID.get(String(o.station)) : null;
      if (st) playStation(st, { win, ctx: currentIds().includes(st.id) ? currentIds() : ALL_IDS });
    }
    win.onReopen(o => openWith(o));

    paint();
    let chipRaf = requestAnimationFrame(() => { chipRaf = 0; if (!dead) showChip(); });
    armStale();
    loadChannels();
    syncAir();
    const np0 = nowPlaying();
    if (np0.st && !AIR.has(np0.st.id)) loadAir(np0.st.id).then(() => changed('air'));
    if (opts && (opts.view || opts.station)) openWith(opts);

    return () => {
      dead = true;
      openWins = Math.max(0, openWins - 1);
      subs.delete(onChange);
      offStore();
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onLook);
      clearInterval(chTimer);
      clearTimeout(staleTimer);
      staleTimer = 0;
      if (raf) cancelAnimationFrame(raf);
      if (chipRaf) cancelAnimationFrame(chipRaf);
      raf = chipRaf = 0;
      listLogos.clear();
      npLogos.clear();
      syncAir();
      /* a station playing here keeps playing, like Music — the widget or the media keys stop it */
    };
  },
});
