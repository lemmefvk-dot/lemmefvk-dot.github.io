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

   One list, one player
   · The stations are js/core/stations.js — the same list Music uses, so
     a station added there is in both. StaticOS has one player: Music. A
     station on the list is handed to it with openApp('music', { station })
     and plays in Music's own player; Radio keeps its window in front and
     follows Music's media:track to show what's on.
   · A stream link you add yourself (Your streams) is not SomaFM's and not
     on the list, so Music can't take it: it plays in Radio's single
     module-level <audio>. It first emits media:pause so Music stops, stops itself
     the moment Music reports sound again, obeys media:pause from the
     rest of the OS, and announces itself on media:track so the Now
     Playing widget stays truthful. While it has the sound it holds the
     Media Session (media keys); when it stops it puts back Music's
     card and hands the keys back through the bus — the same calls
     Music's own handlers make.
   · Like Music, that player lives at module level, so a station keeps
     playing after the window closes; the widget, the media keys or
     reopening Radio stop it. Only window things are torn down.

   More Radio does: a sleep timer (shared with Music), station search,
   sort by listeners (only while SomaFM's numbers are fresh), keys for
   everything, hearts for the song on air (a list of finds), sending a
   station to a friend, a wake-up alarm that rides on Clock's alarms
   (it only rings while StaticOS is open), SomaFM's own lower-bitrate
   streams for slow connections, your own stream links, and "Report not
   playing", which marks a station that had trouble this session.

   Saved on this device under store 'portal.radio': favourites, the
   stations played here (newest first), the last view, the sort, your
   own streams and the songs you kept. Favourites
   are listed first in every list of stations (All, and each genre),
   under their own heading — and Music's Radio tab reads and writes the
   same hearts, so a station hearted in either is a favourite in both.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as tap from '../core/audiotap.js';
import { appLevel } from '../core/appearance.js';
import { STATIONS, BY_ID, SOMA, SOMA_API, QUALITIES, streamUrl as stationUrl, triesFor, quality as streamQuality, setQuality, qualityInfo, trouble } from '../core/stations.js';
import * as sleepT from '../core/mediasleep.js';
import * as finds from '../core/radiofinds.js';
import * as alarmsCore from '../core/alarms.js';
import { paintMediaPanel } from '../portal/sendfriend.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-radio-css')) {
  const l = document.createElement('link');
  l.id = 'feat-radio-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-radio.css';
  document.head.appendChild(l);
}

const STORE_KEY = 'portal.radio';
const onLocalhost = () => typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/* ---------------- the stations (SomaFM's own words: js/core/stations.js) ----------------
   Your own stream links join them here, and only here (see "Your streams"). */
const ALL_IDS = STATIONS.slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => s.id);
const CUSTOM = new Map();               /* id -> station, rebuilt from the saved list on every read */
const MAX_CUSTOM = 12;
const stationOf = id => BY_ID.get(id) || CUSTOM.get(id) || null;
function cleanCustom(list) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || typeof c.id !== 'string' || !/^u-[a-z0-9]{3,16}$/.test(c.id) || seen.has(c.id)) continue;
    const url = httpsUrl(c.url);
    const name = String(c.name || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!url || !name) continue;
    seen.add(c.id);
    out.push({ id: c.id, name, url });
  }
  return out.slice(0, MAX_CUSTOM);
}
/** Only https links to a web address (an http link would be blocked from this page). */
function httpsUrl(v) {
  try {
    const u = new URL(String(v || '').trim());
    return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password ? u.href : '';
  } catch (e) { return ''; }
}
function syncCustom(list) {
  CUSTOM.clear();
  for (const c of list) {
    let host = '';
    try { host = new URL(c.url).hostname; } catch (e) { /* cleaned already */ }
    CUSTOM.set(c.id, { id: c.id, name: c.name, genre: 'Your stream', blurb: `A stream you added — ${host}`, page: c.url, logo: '', logoType: '', custom: true, url: c.url });
  }
}

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
  { id: 'finds', name: 'Song finds', short: 'Finds', icon: 'star', g1: '#fde68a', g2: '#b45309',
    kicker: 'Songs you hearted on air',
    note: 'Tap the heart on a song while it is on the radio and it is kept here, with its station, so you can look it up later. Only the title, artist and album SomaFM printed are kept.' },
  { id: 'mine', name: 'Your streams', short: 'Yours', icon: 'link', g1: '#a7f3d0', g2: '#065f46',
    kicker: 'Links you added',
    note: 'Add a link to an internet radio stream you are allowed to listen to. It plays in your browser straight from its own server, and it is not part of SomaFM.' },
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
const SORTS = ['az', 'listeners'];
function data() {
  const raw = store.get(STORE_KEY);
  const o = raw && typeof raw === 'object' ? raw : {};
  const custom = cleanCustom(o.custom);
  syncCustom(custom);
  const favs = [...new Set((Array.isArray(o.favs) ? o.favs : []).filter(id => stationOf(id)))];
  const seen = new Set();
  const recent = (Array.isArray(o.recent) ? o.recent : [])
    .filter(r => r && stationOf(r.id) && Number.isFinite(Number(r.at)) && !seen.has(r.id) && seen.add(r.id))
    .map(r => ({ id: r.id, at: Number(r.at) }))
    .slice(0, 12);
  /* finds are kept by js/core/radiofinds.js; they pass through here untouched so a save never drops them */
  return { v: 1, favs, recent, view: VIEW_BY_ID.has(o.view) ? o.view : 'all', sort: SORTS.includes(o.sort) ? o.sort : 'az', custom, finds: Array.isArray(o.finds) ? o.finds : [] };
}
const save = patch => store.set(STORE_KEY, { ...data(), ...patch });
const isFav = id => data().favs.includes(id);
function toggleFav(id) {
  const favs = data().favs;
  save({ favs: favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id] });
}
function addRecent(id) {
  if (!stationOf(id)) return;
  const d = data();
  if (d.recent[0]?.id === id && Date.now() - d.recent[0].at < 60000) return;
  save({ recent: [{ id, at: Date.now() }, ...d.recent.filter(r => r.id !== id)].slice(0, 12) });
}
function idsFor(viewId) {
  if (viewId === 'finds') return [];
  if (viewId === 'favs') return data().favs;
  if (viewId === 'recent') return data().recent.map(r => r.id);
  if (viewId === 'mine') return data().custom.map(c => c.id);
  const ids = viewId === 'all' ? ALL_IDS : GENRES.find(g => g.id === viewId)?.ids || [];
  /* favourites first, in the order they were hearted; the rest keep their order */
  const favs = data().favs.filter(id => ids.includes(id));
  return [...favs, ...ids.filter(id => !favs.includes(id))];
}
/** The ids of a view in the order it is shown: favourites lead (A–Z), or by listeners while SomaFM's numbers are fresh. */
function shownIds(viewId) {
  const ids = idsFor(viewId);
  if (data().sort !== 'listeners' || !chFresh() || viewId === 'favs' || viewId === 'recent' || viewId === 'mine') return ids;
  const n = id => chInfo(id)?.listeners ?? -1;
  return ids.slice().sort((a, b) => n(b) - n(a) || (stationOf(a)?.name || '').localeCompare(stationOf(b)?.name || ''));
}
/** How many of a view's stations lead it as favourites (0 for Favorites/Recent themselves). */
function favLead(viewId) {
  if (viewId === 'favs' || viewId === 'recent' || viewId === 'finds' || viewId === 'mine' || data().sort === 'listeners') return 0;
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
  audio.volume = Math.min(100, Math.max(0, Number.isFinite(v) ? v : 62)) / 100 * appLevel('radio') * sleepT.fade();   /* the mixer's level for Radio (Settings > Sound), and the sleep timer's fade */
  audio.muted = store.get('prefs.muted', false) === true;
}
function ensureAudio() {
  if (audio) return audio;
  if (typeof Audio !== 'function') return null;
  audio = new Audio();
  audio.preload = 'none';
  applyVolume();
  store.sub('prefs', applyVolume);
  bus.on('mediasleep:fade', applyVolume);
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
      ? (R.own.st.custom
        ? `${R.own.st.name} is a stream you added, and its server doesn’t let other websites read its sound, so the browser won’t let StaticOS draw it. The music still plays.`
        : `${R.own.st.name} is coming through SomaFM’s plain server (its CORS servers didn’t answer here), so the browser won’t let StaticOS read the sound. The music still plays.`)
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
  custom: st => ({ title: `${st.name} didn’t play`, detail: 'The link may be wrong, the stream may be off the air, or its server may not let other websites play it. Check the link, or remove it and add it again.' }),
};
/* where Radio's own player fetches from, in order: SomaFM's servers (the same order Music uses), or the one link the person added */
const ownTries = st => (st.custom ? [[null, false, '']] : triesFor(streamQuality()));

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
  Object.assign(R.own, { st, phase: 'loading', err: null, note: null, slow: false, tryIx: 0, cors: !st.custom, started: false, drops: [] });
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
  const tries = ownTries(st);
  const [host, cors, q] = tries[R.own.tryIx % tries.length];
  R.own.cors = cors;
  R.own.quality = q;
  if (cors) audio.crossOrigin = 'anonymous'; else audio.removeAttribute('crossorigin');
  audio.src = st.custom ? st.url : stationUrl(st, host, q);
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
  trouble.mark(R.own.st.id, 'failed');
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
  trouble.ok(R.own.st?.id);
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
  } else if (R.own.tryIx < ownTries(R.own.st).length - 1 && online()) {
    R.own.tryIx++;
    connect(tok);
    return;
  }
  failOwn(tok, !online() ? 'offline' : R.own.st.custom ? 'custom' : onLocalhost() ? 'localhost' : 'blocked');
}

/* ---------------- the Now Playing card + media keys ---------------- */
function sendCard() {
  const st = R.own.st;
  if (!st || R.lead !== 'own') return;
  const s = airNow(st.id);
  cardMine = true;
  emitTrack({
    title: s?.title || st.name, artist: st.custom ? 'Internet radio' : s ? (s.artist || 'SomaFM') : 'SomaFM', album: `${st.name} · live radio`,
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
        title: s?.title || st.name, artist: st.custom ? 'Internet radio' : s ? (s.artist || 'SomaFM') : 'SomaFM', album: `${st.name} · live radio`,
        artwork: st.logo ? [{ src: st.logo, sizes: '256x256', type: st.logoType }] : [],
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
  const next = stationOf(ids[(i + dir + ids.length) % ids.length]);
  if (next && next !== R.own.st) playStation(next, { ctx: ids });
}

/* ---------------- playing a station: hand it to Music when Music can ---------------- */
function playStation(st, o = {}) {
  if (!st) return;
  if (Array.isArray(o.ctx) && o.ctx.length) R.ctx = o.ctx.slice();
  if (!st.custom && api.getApp('music')) {
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
  return m ? STATIONS.find(s => s.name === m[1]) || [...CUSTOM.values()].find(s => s.name === m[1]) || null : null;
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
  if (playing && st && (!wasPlaying || wasSt !== st)) { addRecent(st.id); trouble.ok(st.id); }
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
  if (np.st.custom) return null;                                   /* a link you added has no SomaFM feed */
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
    'focus', 'study', 'lofi', 'lo-fi', 'chill', 'gaming', 'random', 'discover', 'sleep timer', 'wake up alarm', 'song finds',
    'send a station', 'low data'],
  desc: 'Live internet radio from SomaFM, by genre',
  singleton: true,
  win: { w: 880, h: 600, minW: 400, minH: 420 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Space / K', 'Play or stop'],
    ['R', 'A random station'],
    ['N / P', 'Next / previous station'],
    ['F', 'Favorite the station'],
    ['H', 'Keep the song on air'],
    ['S', 'Sleep timer'],
    ['/', 'Search stations'],
    ['I / ?', 'This list of keys'],
  ],

  mount(ctx) {
    const { root, win, opts, api: A } = ctx;
    const { h, icon, clear } = A;
    const ago = ms => A.fmt.fmtAgo(ms);
    let dead = false;
    openWins++;

    const S = { view: data().view, hist: false, q: '', sheet: null, sheetStation: null, keyHelp: false };
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
    /* search, sort and the wake-up alarm; these live outside the list, so a repaint never takes them away mid-typing */
    const searchIn = h('input', { type: 'search', placeholder: 'Search stations', 'aria-label': 'Search stations by name, genre or song', spellcheck: 'false', dataset: { k: 'search' },
      oninput: ev => { S.q = ev.target.value; paintHead(); paintList(); },
      onkeydown: ev => { if (ev.key === 'Escape' && S.q) { ev.preventDefault(); ev.stopPropagation(); S.q = ''; searchIn.value = ''; paintHead(); paintList(); } else if (ev.key === 'Enter') { const first = list.querySelector('[data-role="main"]'); if (first) { ev.preventDefault(); first.click(); } } } });
    const sortSel = h('select.select.rd-sort', { 'aria-label': 'Sort stations', dataset: { k: 'sort' }, onchange: ev => save({ sort: ev.target.value }) },
      h('option', { value: 'az', text: 'A–Z' }), h('option', { value: 'listeners', text: 'Most listeners' }));
    const alarmBtn = h('button.btn.btn--sm.rd-alarmbtn', { type: 'button', dataset: { k: 'alarm' }, 'aria-haspopup': 'dialog', onclick: () => toggleSheet('alarm') },
      icon('bell'), h('span', { text: 'Wake-up alarm' }));
    const toolsBar = h('div.rd-tools', h('label.field.rd-search', icon('search'), searchIn), sortSel, alarmBtn);
    const sheetBox = h('section.rd-sheet.hidden', { 'aria-label': 'Radio panel' });
    const main = h('div.app__main.rd-main', chips, head, toolsBar, sheetBox, list, npBox);
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
        if (!st.logo) { box = h('span.rd-logo.is-broken', icon('link')); cache.set(st.id, box); return box; }   /* a stream you added has no picture */
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
        if (np.phase === 'loading') return np.slow ? 'Still connecting — the server may be slow, or this network may be blocking streaming radio.' : np.st.custom ? 'Connecting to your stream…' : 'Connecting to SomaFM…';
        if (np.phase === 'buffering') return 'Buffering — the stream picks up again by itself.';
        if (np.phase === 'playing') return 'Live · playing here: it is a link you added, so it is not part of SomaFM or Music’s list.';
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
    function countFor(v) { return v.id === 'finds' ? finds.list().length : idsFor(v.id).length; }
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
        sleepT.state() ? h('div.rd-sleepnote', icon('moon'), h('span', { text: sleepText() })) : null,
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
      const n = S.view === 'finds' ? finds.list().length : visibleIds().length;
      const total = S.view === 'finds' ? n : currentIds().length;
      headCount.textContent = S.view === 'finds' ? (n ? `${n} song${n === 1 ? '' : 's'}` : '')
        : S.q.trim() ? `${n} of ${total}` : n ? `${n} station${n === 1 ? '' : 's'}` : '';
      const fresh = chFresh();
      sortSel.value = data().sort === 'listeners' && fresh ? 'listeners' : 'az';
      sortSel.querySelector('option[value="listeners"]').disabled = !fresh;
      sortSel.title = fresh ? 'Sort the stations A–Z, or by how many people are listening' : 'Listener numbers are only used while SomaFM’s figures are fresh (under 3 minutes old) — they aren’t right now';
      sortSel.classList.toggle('hidden', S.view === 'finds' || S.view === 'favs' || S.view === 'recent' || S.view === 'mine');
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
      const tr = trouble.get(st.id);
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
          h('span.rd-row__name', h('b', { text: st.name }), cur ? h(`span.rd-tag.is-${np.phase}`, { text: stateWord(np) }) : null,
            tr ? h('span.rd-tag.is-trouble', { dataset: { role: 'trouble' }, title: tr.why === 'reported' ? 'You reported this station as not playing — this mark only lasts for this visit' : 'This station failed to play earlier this visit',
              text: tr.why === 'reported' ? 'Reported' : 'Had trouble' }) : null),
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

    function matches(id) {
      const q = S.q.trim().toLowerCase();
      if (!q) return true;
      const st = stationOf(id);
      if (!st) return false;
      const a = onAir(id);
      return `${st.name} ${st.genre} ${st.blurb} ${a ? a.row : ''}`.toLowerCase().includes(q);
    }
    const visibleIds = () => shownIds(S.view).filter(matches);

    function emptyFor(v) {
      if (S.q.trim()) {
        return h('div.empty.rd-empty', icon('search'), h('b', { text: 'No stations match' }),
          h('small', { text: `Nothing in ${v.name} matches “${S.q.trim()}” — stations are matched on name, genre, description and the song on air.` }),
          h('button.btn.btn--sm', { type: 'button', dataset: { k: 'empty:clear' }, onclick: () => { S.q = ''; searchIn.value = ''; paintHead(); paintList(); } }, icon('x'), h('span', { text: 'Clear search' })));
      }
      if (v.id === 'mine') {
        return h('div.empty.rd-empty', icon('link'), h('b', { text: 'No streams yet' }),
          h('small', { text: 'Add the link of an internet radio stream above — it must start with https://.' }));
      }
      if (v.id === 'favs') {
        return h('div.empty.rd-empty', icon('heart'), h('b', { text: 'No favorites yet' }),
          h('small', { text: 'Tap the heart on any station and it stays here.' }),
          h('button.btn.btn--sm', { type: 'button', dataset: { k: 'empty:all' }, onclick: () => go('all') }, icon('cast'), h('span', { text: 'Browse all stations' })));
      }
      return h('div.empty.rd-empty', icon('clock'), h('b', { text: 'Nothing played yet' }),
        h('small', { text: 'Stations you play from Radio or Music show up here.' }),
        h('button.btn.btn--sm', { type: 'button', dataset: { k: 'empty:random' }, onclick: () => random() }, icon('shuffle'), h('span', { text: 'Random station' })));
    }

    /* ---------- Song finds ---------- */
    function findsList() {
      const all = finds.list();
      if (!all.length) {
        return h('div.empty.rd-empty', icon('star'), h('b', { text: 'No finds yet' }),
          h('small', { text: 'While a station is playing, press the heart beside the song on air (or H) to keep it here.' }));
      }
      return h('div.rd-finds', { role: 'list', 'aria-label': 'Songs you kept' }, all.map(f => {
        const st = stationOf(f.station);
        const label = f.artist ? `${f.artist} — ${f.title}` : f.title;
        return h('div.rd-find', { role: 'listitem', dataset: { id: f.id } },
          icon('music'),
          h('div.rd-find__txt', h('b', { text: f.title }),
            h('small', { text: [f.artist, f.album, st ? `heard on ${st.name}` : '', ago(f.at)].filter(Boolean).join(' · ') })),
          h('button.ibtn', { type: 'button', title: 'Copy the song name', 'aria-label': `Copy ${label}`, dataset: { role: 'find-copy' }, onclick: () => copyText(f.artist ? `${f.artist} - ${f.title}` : f.title, 'Song name') }, icon('copy')),
          h('button.ibtn', { type: 'button', title: 'Remove from your finds', 'aria-label': `Remove ${label} from your finds`, dataset: { role: 'find-x' }, onclick: () => finds.remove(f.id) }, icon('x')));
      }));
    }

    /* ---------- Your streams: the add form is built once and reused, so typing survives a repaint ---------- */
    const mineName = h('input', { type: 'text', maxlength: '40', placeholder: 'Name, e.g. My station', 'aria-label': 'Name for the stream', spellcheck: 'false', dataset: { k: 'mine-name' } });
    const mineUrl = h('input', { type: 'url', placeholder: 'https://example.com/stream.mp3', 'aria-label': 'Stream address', spellcheck: 'false', dataset: { k: 'mine-url' } });
    const mineErr = h('small.rd-mine__err', { role: 'alert' });
    const mineAdd = () => {
      const url = httpsUrl(mineUrl.value);
      const name = mineName.value.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) { mineErr.textContent = 'Give the stream a name.'; mineName.focus(); return; }
      if (!url) { mineErr.textContent = 'That isn’t a web address StaticOS can play — it must start with https:// (browsers block plain http links on a secure page).'; mineUrl.focus(); return; }
      const cur = data().custom;
      if (cur.length >= MAX_CUSTOM) { mineErr.textContent = `You can keep ${MAX_CUSTOM} streams. Remove one first.`; return; }
      if (cur.some(c => c.url === url)) { mineErr.textContent = 'That stream is already in the list.'; return; }
      const id = `u-${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 16);
      save({ custom: [...cur, { id, name, url }] });
      mineErr.textContent = '';
      mineName.value = ''; mineUrl.value = '';
      A.notify({ app: 'Static Radio', icon: 'link', title: 'Stream added', message: `${name} is in Your streams. Press play to listen.`, timeout: 3500 });
    };
    const mineForm = h('form.rd-mine', { onsubmit: ev => { ev.preventDefault(); mineAdd(); } },
      h('div.rd-mine__row', h('label.field', mineName), h('label.field.grow', mineUrl),
        h('button.btn.btn--sm.btn--primary', { type: 'submit', dataset: { k: 'mine-add' } }, icon('plus'), h('span', { text: 'Add stream' }))),
      mineErr,
      h('small.dim', { text: 'Only add streams you’re allowed to listen to. The link plays in your browser straight from its own server; StaticOS doesn’t relay it, and it can’t be sent to friends or used for the wake-up alarm.' }));
    function removeStream(st) {
      save({ custom: data().custom.filter(c => c.id !== st.id), favs: data().favs.filter(x => x !== st.id) });
      if (R.own.st?.id === st.id) stopOwn();
      A.notify({ app: 'Static Radio', icon: 'trash', title: 'Stream removed', message: st.name, timeout: 3000 });
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
      const q = streamQuality();
      const qSel = h('select.select', { 'aria-label': 'Stream quality', dataset: { k: 'quality' }, onchange: ev => { setQuality(ev.target.value); soon(); } },
        QUALITIES.map(o => h('option', { value: o.id, selected: o.id === q, text: `${o.label} — ${o.detail}` })));
      return h('footer.rd-foot',
        h('p', { text: 'Live radio from SomaFM, an independent, listener-supported station in San Francisco — not affiliated with StaticOS. It streams over the internet, so it needs a connection, and a locked-down network (school or work Wi-Fi) may block it.' }),
        h('div.rd-foot__row.rd-foot__q', h('label.rd-foot__lbl', { text: 'Stream quality' }), qSel,
          h('small.dim', { text: 'The 64 and 32 kbps choices are SomaFM’s own AAC streams for slow connections. It applies the next time a station starts, in Music and here.' })),
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
      if (data().sort === 'listeners' && !chFresh() && v.id !== 'finds') {
        list.appendChild(h('p.rd-note', icon('clock'), h('span', { text: 'Sorted A–Z: SomaFM’s listener numbers are too old to sort by.' })));
      }
      if (v.id === 'finds') {
        list.appendChild(findsList());
        if (finds.list().length) list.appendChild(h('div.rd-finds__foot', h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { role: 'finds-clear' },
          onclick: async () => { if (await A.confirm({ title: 'Clear your song finds?', ok: 'Clear them', danger: true, message: 'The songs you kept are removed from this device.' })) finds.clear(); } }, icon('trash'), h('span', { text: 'Clear all finds' }))));
        list.appendChild(foot());
        return;
      }
      if (v.id === 'mine') list.appendChild(mineForm);
      const ids = visibleIds();
      const lead = S.q.trim() ? 0 : favLead(S.view);
      if (!ids.length) list.appendChild(emptyFor(v));
      else if (lead) {
        list.appendChild(h('div.rd-group', icon('heart', { fill: true }), h('span.label', { text: `Favorites · ${lead}` }),
          h('span.rd-group__note', { text: 'saved on this device · shown first' })));
        list.appendChild(h('div.rd-rows', { role: 'list', 'aria-label': `Favorite ${v.name} stations` }, ids.slice(0, lead).map(id => row(stationOf(id)))));
        if (ids.length > lead) {
          list.appendChild(h('div.rd-group', h('span.label', { text: S.view === 'all' ? 'All stations' : `More ${v.name}` })));
          list.appendChild(h('div.rd-rows', { role: 'list', 'aria-label': `More ${v.name} stations` }, ids.slice(lead).map(id => row(stationOf(id)))));
        }
      } else list.appendChild(h('div.rd-rows', { role: 'list', 'aria-label': `${v.name} stations` }, ids.map(id => row(stationOf(id)))));
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

      if (S.hist && !st.custom) npBox.appendChild(history(st, histId));

      const toggle = h('button.rd-play', {
        type: 'button', dataset: { k: 'np:toggle' }, 'aria-keyshortcuts': 'K',
        class: np.busy ? 'is-busy' : null,
        'aria-label': err ? `Try ${st.name} again` : np.on ? `Stop ${st.name}` : `Play ${st.name}`,
        title: err ? 'Try again' : np.on ? 'Stop (K)' : 'Play (K)',
        onclick: () => (np.on ? stopNP() : playStation(st, { win, ctx: R.ctx.length ? R.ctx : currentIds() })),
      }, icon(err ? 'refresh' : np.on ? 'square' : 'play', { fill: !err }));

      const air = st.custom ? null : onAir(st.id);
      const kept = air ? finds.has(air) : false;
      const sl = sleepT.state();
      const extras = [
        air ? h('button.btn.btn--sm.rd-keep', {
          type: 'button', class: kept ? 'is-on' : null, 'aria-pressed': kept ? 'true' : 'false', dataset: { k: 'np:heartsong' }, 'aria-keyshortcuts': 'H',
          'aria-label': kept ? `Remove ${air.title} from your song finds` : `Keep ${air.title} in your song finds`,
          title: kept ? 'In your song finds — press to remove (H)' : 'Keep the song on air in your song finds (H)',
          onclick: () => heartSong(),
        }, icon('heart', kept ? { fill: true } : undefined), h('span', { text: kept ? 'Kept' : 'Keep song' })) : null,
        air ? h('button.ibtn', { type: 'button', dataset: { k: 'np:copy' }, title: 'Copy the song name', 'aria-label': `Copy the name of ${air.title}`,
          onclick: () => copyText(air.artist ? `${air.artist} - ${air.title}` : air.title, 'Song name') }, icon('copy')) : null,
        st.custom ? null : h('button.ibtn', { type: 'button', dataset: { k: 'np:send' }, title: 'Send this station to a friend', 'aria-label': `Send ${st.name} to a friend`,
          onclick: () => toggleSheet('send', st) }, icon('send')),
        h('button.ibtn.rd-sleepbtn', { type: 'button', class: sl ? 'is-on' : null, dataset: { k: 'np:sleep' }, 'aria-haspopup': 'menu', 'aria-keyshortcuts': 'S',
          title: sl ? `Sleep timer — ${sleepText()}` : 'Sleep timer (S)', 'aria-label': sl ? `Sleep timer: ${sleepText()}` : 'Sleep timer', onclick: e => sleepMenu(e) }, icon('moon')),
      ];

      npBox.appendChild(h('div.rd-np__bar',
        h('span.rd-np__art', logo(st, npLogos), np.on && !np.busy ? eq() : null),
        h('div.rd-np__txt',
          h('div.rd-np__title', h('b', { text: st.name }), h(`span.rd-tag.is-${np.phase}`, { text: stateWord(np) })),
          sl ? h('div.rd-np__sleep', icon('moon'), h('span', { text: `${sleepText()} · only while StaticOS is open` })) : null,
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
          extras,
          st.custom ? null : h('button.ibtn.rd-np__histbtn', {
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
    function sleepText() {
      const sl = sleepT.state();
      if (!sl) return '';
      if (sl.afterSong) return 'Stops after the song';
      const sec = Math.ceil(sl.left / 1000), m = Math.floor(sec / 60);
      return m >= 1 ? `Stops in ${m} min` : `Stops in ${sec} s`;
    }
    function sleepMenu(e) {
      const r = e.currentTarget?.getBoundingClientRect?.();
      const sl = sleepT.state();
      A.menu([
        { header: true, label: 'Sleep timer' },
        { label: 'Off', icon: !sl ? 'check' : 'dot', onClick: () => sleepT.clear() },
        ...sleepT.CHOICES.map(m => ({ label: `${m} minutes`, icon: sl && sl.minutes === m ? 'check' : 'moon', onClick: () => sleepT.set(m) })),
      ], (r ? r.left : 0), (r ? r.top - 4 : 0));
    }
    async function copyText(text, what) {
      try {
        await navigator.clipboard.writeText(text);
        A.notify({ app: 'Static Radio', icon: 'copy', title: `${what} copied`, message: text, timeout: 3000 });
      } catch (e) {
        A.notify({ app: 'Static Radio', icon: 'alert', title: 'Couldn’t copy', message: `The clipboard isn’t available here. It reads: ${text}`, timeout: 9000 });
      }
    }
    /** Keep (or let go of) the song on air. */
    function heartSong() {
      const np = nowPlaying();
      if (!np.st || np.st.custom) return;
      const air = onAir(np.st.id);
      if (!air) { A.notify({ app: 'Static Radio', icon: 'info', title: 'No song to keep yet', message: 'SomaFM hasn’t said what is on air right now.', timeout: 3500 }); return; }
      const now = finds.toggle(air, np.st.id);
      A.notify({ app: 'Static Radio', icon: now ? 'heart' : 'x', title: now ? 'Kept in your song finds' : 'Removed from your song finds',
        message: `${air.title}${air.artist ? ` — ${air.artist}` : ''}`, timeout: 3000 });
    }
    /** "Report not playing": marks a station that had trouble this visit. It is a note on this screen only — nothing is sent to SomaFM. */
    function reportStation(st) {
      if (trouble.get(st.id)?.why === 'reported') {
        trouble.clear(st.id);
        A.notify({ app: 'Static Radio', icon: 'check', title: 'Mark cleared', message: st.name, timeout: 3000 });
        return;
      }
      trouble.mark(st.id, 'reported');
      A.notify({ app: 'Static Radio', icon: 'alert', title: `Marked ${st.name} as not playing`, timeout: 6000,
        message: 'It stays marked until you close StaticOS, so you remember to try another. Nothing was sent to SomaFM.' });
    }

    /* ---------- panels above the list: wake-up alarm, send to a friend, keys ---------- */
    function closeSheet() {
      S.sheet = null; S.sheetStation = null;
      sheetBox.classList.add('hidden');
      clear(sheetBox);
      alarmBtn.setAttribute('aria-expanded', 'false');
    }
    function toggleSheet(kind, st) {
      if (S.sheet === kind && (!st || S.sheetStation === st.id)) { closeSheet(); return; }
      S.sheet = kind; S.sheetStation = st ? st.id : null;
      clear(sheetBox);
      sheetBox.classList.remove('hidden');
      alarmBtn.setAttribute('aria-expanded', String(kind === 'alarm'));
      if (kind === 'alarm') buildAlarm();
      else if (kind === 'send') buildSend(st);
      else buildKeys();
    }
    const sheetHead = (title, ic) => h('div.rd-sheet__head', icon(ic), h('b', { text: title }), h('div.grow'),
      h('button.ibtn', { type: 'button', 'aria-label': 'Close', dataset: { role: 'sheet-x' }, onclick: closeSheet }, icon('x')));

    const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
    function buildAlarm() {
      alarmsCore.init();
      const favs = data().favs.filter(id => BY_ID.has(id));
      const cur = nowPlaying().st;
      const pick = cur && !cur.custom ? cur.id : favs[0] || 'groovesalad';
      const timeIn = h('input', { type: 'time', value: S.alarmTime || '07:00', 'aria-label': 'Wake-up time', dataset: { k: 'alarm-time' } });
      const stSel = h('select.select', { 'aria-label': 'Station to wake up to', dataset: { k: 'alarm-station' } },
        ALL_IDS.map(id => h('option', { value: id, selected: id === pick, text: BY_ID.get(id).name })));
      const days = new Set(S.alarmDays || []);
      const dayBtns = DAYS.map(([d, label]) => h('button.rd-day', { type: 'button', class: days.has(d) ? 'is-on' : null, 'aria-pressed': String(days.has(d)), dataset: { day: String(d) },
        onclick: e => { days.has(d) ? days.delete(d) : days.add(d); S.alarmDays = [...days]; e.currentTarget.classList.toggle('is-on', days.has(d)); e.currentTarget.setAttribute('aria-pressed', String(days.has(d))); } }, label));
      const err = h('small.rd-mine__err', { role: 'alert' });
      const set = () => {
        if (!timeIn.value) { err.textContent = 'Pick a time.'; return; }
        S.alarmTime = timeIn.value;
        const st = BY_ID.get(stSel.value);
        const a = alarmsCore.addAlarm({ time: timeIn.value, label: `Wake up to ${st.name}`, days: [...days], radio: st.id });
        if (!a) { err.textContent = 'You already have as many alarms as Clock keeps. Remove one in Clock first.'; return; }
        err.textContent = '';
        alarmsCore.init();
        A.notify({ app: 'Static Radio', icon: 'bell', title: 'Wake-up alarm set', message: `${st.name} at ${timeIn.value}${days.size ? '' : ', once'}. It only works while StaticOS is open.`, timeout: 5000 });
        buildAlarm();
      };
      const mine = alarmsCore.alarms().filter(a => a.radio && BY_ID.has(a.radio));
      clear(sheetBox);
      sheetBox.append(
        sheetHead('Wake-up alarm', 'bell'),
        h('p.rd-sheet__warn', { dataset: { role: 'alarm-warn' } }, icon('info'),
          h('span', { text: 'This only rings while StaticOS is open in a browser tab. A closed tab, a sleeping computer or a phone with the screen off can’t wake itself, so don’t rely on it to get you up. It plays at your current volume — if StaticOS is muted, you won’t hear it. Clock lists it with your other alarms.' })),
        h('div.rd-sheet__row', h('label.field', timeIn), h('label.field', stSel), h('div.rd-days', { role: 'group', 'aria-label': 'Repeat on' }, dayBtns),
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { role: 'alarm-set' }, onclick: set }, icon('bell'), h('span', { text: 'Set alarm' }))),
        h('small.dim', { text: days.size ? 'Repeats on the days chosen.' : 'No days chosen: it rings once, then switches itself off.' }),
        err,
        mine.length ? h('ul.rd-alarms', { 'aria-label': 'Your wake-up alarms', dataset: { role: 'alarm-list' } }, mine.map(a => h('li', { dataset: { id: a.id } },
          h('b', { text: a.time }),
          h('span', { text: `${BY_ID.get(a.radio).name} · ${alarmsCore.repeatText(a.days)}${a.enabled ? '' : ' · off'}` }),
          h('div.grow'),
          h('button.btn.btn--sm', { type: 'button', dataset: { role: 'alarm-toggle' }, 'aria-pressed': String(a.enabled), onclick: () => alarmsCore.updateAlarm(a.id, { enabled: !a.enabled }) }, a.enabled ? 'Turn off' : 'Turn on'),
          h('button.ibtn', { type: 'button', dataset: { role: 'alarm-x' }, 'aria-label': `Delete the ${a.time} alarm`, onclick: () => alarmsCore.removeAlarm(a.id) }, icon('trash'))))) : null);
    }
    function buildSend(st) {
      const hold = h('div.rd-sheet__list', { dataset: { role: 'friend-hold' } });
      clear(sheetBox);
      sheetBox.append(sheetHead(`Send ${st.name} to a friend`, 'send'), hold);
      const key = S.sheetStation;
      paintMediaPanel({ api: A }, hold, {
        label: st.name,
        note: `This sends the name of the station to your friend, nothing more. They choose whether to listen; it never plays by itself.`,
        noun: 'it',
        send: fp => import('../core/friends.js').then(F => F.sendMedia(fp, { kind: 'radio', id: st.id, title: st.name })),
      }, () => !dead && S.sheet === 'send' && S.sheetStation === key);
    }
    function buildKeys() {
      const rows = [['Space / K', 'Play or stop'], ['↑ / ↓', 'Move between stations'], ['Enter', 'Play the station'], ['R', 'A random station'], ['N / P', 'Next / previous station'],
        ['F', 'Favorite the station that is playing'], ['H', 'Keep the song on air'], ['S', 'Sleep timer'], ['/', 'Search stations'], ['I or ?', 'This list'], ['Esc', 'Close a panel']];
      clear(sheetBox);
      sheetBox.append(sheetHead('Radio keys', 'keyboard'),
        h('dl.rd-keys', rows.map(([k, d]) => h('div', h('dt', h('kbd', { text: k })), h('dd', { text: d })))));
    }

    /** Next or previous station within the list the playing one was picked from. */
    function stepNP(dir) {
      const np = nowPlaying();
      if (!np.st) { random(); return; }
      const ids = R.ctx.length ? R.ctx : currentIds().length ? currentIds() : ALL_IDS;
      let i = ids.indexOf(np.st.id);
      if (i < 0) i = dir > 0 ? -1 : 0;
      const next = stationOf(ids[(i + dir + ids.length) % ids.length]);
      if (next && next !== np.st) playStation(next, { win, ctx: ids });
    }

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
      const pick = stationOf(choices[Math.floor(Math.random() * choices.length)]);
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
        st.custom ? null : { label: 'Send to a friend…', icon: 'send', onClick: () => toggleSheet('send', st) },
        { label: trouble.get(st.id)?.why === 'reported' ? 'Clear the “not playing” mark' : 'Report not playing', icon: 'alert', onClick: () => reportStation(st) },
        '-',
        st.custom ? { label: 'Open the stream address', icon: 'external-link', onClick: () => { try { window.open(st.url, '_blank', 'noopener,noreferrer'); } catch (err) { /* popup blocked */ } } }
          : { label: 'Station page on somafm.com', icon: 'external-link', onClick: () => { try { window.open(st.page, '_blank', 'noopener,noreferrer'); } catch (err) { /* popup blocked */ } } },
        { label: 'Copy stream address', icon: 'copy', onClick: () => copyStream(st) },
        st.custom ? '-' : null,
        st.custom ? { label: 'Remove this stream', icon: 'trash', danger: true, onClick: () => removeStream(st) } : null,
      ].filter(Boolean), x, y);
    }
    async function copyStream(st) {
      const url = st.custom ? st.url : stationUrl(st, 'ice1', streamQuality());
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
    /* the sleep timer, the song finds, a station that had trouble and Clock's alarms can all change from outside this window */
    const offs = [
      bus.on('mediasleep:change', () => soon()),
      bus.on('radiofinds:change', () => soon()),
      bus.on('clock:change', () => { if (S.sheet === 'alarm') buildAlarm(); }),
      bus.on('tick:1s', () => { if (!dead && sleepT.state()) soon(); }),
      trouble.on(() => soon()),
    ];
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
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); stepNP(1); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); stepNP(-1); }
      else if (e.key === 'f' || e.key === 'F') { const st = nowPlaying().st; if (st) { e.preventDefault(); toggleFav(st.id); } }
      else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); heartSong(); }
      else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        const b = npBox.querySelector('.rd-sleepbtn');
        if (b) sleepMenu({ currentTarget: b });
        else A.menu([{ label: 'Play a station first', icon: 'moon', disabled: true }], 40, 120);
      }
      else if (e.key === '/') { e.preventDefault(); searchIn.focus(); searchIn.select(); }
      else if (e.key === '?' || e.key === 'i' || e.key === 'I') { e.preventDefault(); toggleSheet('keys'); }
      else if (e.key === 'Escape' && S.sheet) { e.preventDefault(); closeSheet(); }
    };
    window.addEventListener('keydown', onKey);

    function openWith(o) {
      if (!o) return;
      if (o.view && VIEW_BY_ID.has(o.view)) go(o.view);
      const st = o.station ? stationOf(String(o.station)) : null;
      if (st) playStation(st, { win, ctx: currentIds().includes(st.id) ? currentIds() : ALL_IDS });
    }
    win.onReopen(o => openWith(o));

    searchIn.value = '';
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
      offs.forEach(fn => { try { fn(); } catch (e) { /* already off */ } });
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
