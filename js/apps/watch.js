/* ============================================================
   watch.js — Static Watch: one place for everything you watch.

   A hub, not a catalogue of its own. Every row is read from
   something StaticOS already keeps, through the module that owns it:

     Continue Watching  portal.anime.progress  {"anime:<id>":{ep,of,at}}
                        (episodes marked watched) and portal.anime.resume
                        (the episode last opened in Static Anime's player,
                        with the second it reached only when that player
                        reports one), merged by anime.js's whereLeftOff()
                        so both apps agree — plus the positions of your own
                        videos (portal.watch.videos, see "the engine" below).
                        Every row says which it knows: a minute, or only
                        the episode.
     Watchlist          portal.watchlist, the shared "kind:id" tokens
                        Static Anime and Movies write. Manga is read,
                        not watched, so it is counted and linked, not shown.
     History            portal.watch.history — what you opened HERE
     Movies / Shows     providers.listMovies(), the same metadata-only
                        catalogue the Movies page reads. Shows are its
                        entries tagged 'series'; there is no other TV data.
     Anime              portal/anime.data.js. It is ~8 MB, so it is only
                        fetched when the Anime section opens or a
                        "Load anime" button is pressed.
     Saved Videos       every video under ~/Videos and ~/Downloads, with a
                        real frame and length read from the file itself.

   Opening goes to the app that owns the thing: anime to Static Anime
   (static://anime/<id> — its page has the episode list), a film or show
   to its page in the Browser (static://movies/<id>, exactly the URL the
   Movies page navigates to), your video to Videos via api.openFile().

   The engine. Videos keeps no resume position, so Watch follows its
   player: it attaches to each Videos window, reads which file is showing
   off that window's own title (the file name) and subtitle (its folder),
   and while it plays records {t, d} under portal.watch.videos, keyed by
   the file's bytes reference so a rename keeps it. "Resume" asks the
   engine to seek once playback starts. It runs while this window is
   open; init() — call it once at boot — keeps it running all session.
   A clip shorter than 20 s has nothing to resume, so it never shows as
   in progress (the bundled wallpaper clips are 2–3 s long).

   Titles and posters of the anime you touched are copied into a small
   cache (portal.watch.meta) whenever the catalogue is loaded, so the
   next visit can show them without the 8 MB download. Until then an
   uncached title says plainly that it is waiting on the catalogue.
   Nothing on screen is invented: no counts, no dates, no "trending".
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import { whereLeftOff } from '../portal/anime.js';

/* self-injected stylesheet, guarded so re-opening never double-adds it */
if (typeof document !== 'undefined' && !document.getElementById('feat-watch-css')) {
  const l = document.createElement('link');
  l.id = 'feat-watch-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-watch.css';
  document.head.appendChild(l);
}

const KEY = 'portal.watch';
const FILMS_KEY = 'portal.watchfilms';     /* Free films (watch-films.js, loaded when its section opens) */
const WL_KEY = 'portal.watchlist';
const PROG_KEY = 'portal.anime.progress';
const RESUME_KEY = 'portal.anime.resume';
const HIST_MAX = 80;
const VID_MAX = 60;
const META_MAX = 160;
const MIN_LEN = 20;             /* seconds — anything shorter has nothing to resume */
const SAVE_EVERY = 8000;        /* ms between position writes while a video plays  */
const RESUME_TTL = 60000;       /* a Resume request that never starts playing expires */
const RAIL_LEN = 18;
const GRID_STEP = 48;
const NARROW = 620;             /* painted width below which the sidebar folds into tabs */
const FRAME_MAX = 480;
const FRAME_TIMEOUT = 15000;
const FRAME_CAP = 120;
const VIDEO_DIRS = ['Videos', 'Downloads'];
const ANIME_WEIGHT = 'about 8 MB';

const SECTIONS = [
  { id: 'home', label: 'Home', icon: 'home', group: 'Watch' },
  { id: 'continue', label: 'Continue Watching', icon: 'play', group: 'Watch' },
  { id: 'watchlist', label: 'Watchlist', icon: 'bookmark', group: 'Watch' },
  { id: 'history', label: 'History', icon: 'clock', group: 'Watch' },
  { id: 'movies', label: 'Movies', icon: 'film', group: 'Browse' },
  { id: 'shows', label: 'Shows', icon: 'monitor', group: 'Browse' },
  { id: 'films', label: 'Free films', icon: 'film', group: 'Browse' },
  { id: 'anime', label: 'Anime', icon: 'star', group: 'Browse' },
  { id: 'videos', label: 'Saved Videos', icon: 'folder', group: 'Browse' },
];
const ALIAS = { 'continue-watching': 'continue', continuewatching: 'continue', saved: 'videos', 'saved-videos': 'videos', tv: 'shows', series: 'shows', films: 'movies', 'free-films': 'films', archive: 'films', library: 'films' };
const canonSec = s => {
  const k = String(s || '').toLowerCase();
  return SECTIONS.some(x => x.id === k) ? k : (ALIAS[k] || null);
};
const secOf = id => SECTIONS.find(s => s.id === id) || SECTIONS[0];

/* ---------------- Free films: only what Continue Watching needs lives here ---------------- */
const filmPoster = id => `https://archive.org/services/img/${encodeURIComponent(id)}`;
function filmContinue(store) {
  const d = store.get(FILMS_KEY, {});
  const pos = d && typeof d.pos === 'object' && d.pos ? d.pos : {};
  return Object.entries(pos).filter(([, p]) => vidInProgress(p)).map(([id, p]) => ({ kind: 'film', id, p, at: Number(p.at) || 0, title: String(p.title || id) }));
}
function forgetFilmPos(store, id) {
  const d = store.get(FILMS_KEY, {});
  if (!d?.pos?.[id]) return;
  const pos = { ...d.pos };
  delete pos[id];
  store.set(FILMS_KEY, { ...d, pos });
}
let filmsMod = null, filmsP = null;
const loadFilms = () => filmsP || (filmsP = import('./watch-films.js').then(m => (filmsMod = m)));

/* ---------------- small helpers ---------------- */
const arr = v => (Array.isArray(v) ? v : []);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const nf = n => Number(n || 0).toLocaleString();
const plural = (n, one, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;
const stemOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
const httpsUrl = u => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : '');
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
const isVideoNode = n => !!n && n.type === 'file' && (n.kind === 'video' || media.kindOf(n.name) === 'video');
const isAssetNode = n => String(n?.content || '').startsWith(media.ASSET);
const seekableOk = v => v.seekable.length > 0 && v.seekable.end(v.seekable.length - 1) > 0;
const vidInProgress = p => !!p && p.d >= MIN_LEN && p.t >= 2 && p.t < p.d - Math.max(3, p.d * 0.04);

/* An anime's place, from whereLeftOff(): how 'player' (a second the player
   reported), 'opened' (only the episode) or 'next' (the one after the last
   finished or marked). These turn it into words that say which. */
const epOf = w => `Episode ${nf(w.ep)}${w.of ? ` of ${nf(w.of)}` : ''}`;
const canNext = w => !!w && w.how !== 'next' && (!w.of || w.ep < w.of);
function placeLine(w) {
  if (w.how === 'player') return `${epOf(w)} · ${fmtTime(w.t)}${w.d ? ` of ${fmtTime(w.d)}` : ''}`;
  if (w.how === 'opened') return `${epOf(w)} · opened`;
  return `Up next: ${epOf(w).toLowerCase()}`;
}
function placeNote(w) {
  if (w.how === 'player') return 'Your place in the episode comes from the player itself.';
  if (w.how === 'opened') return 'StaticOS knows which episode you opened, not how far into it you got — the player didn’t report that.';
  return `Episode ${nf(w.ep - 1)} is ${w.marked >= w.ep - 1 ? 'marked watched' : 'finished'}.`;
}
function placeAction(w) {
  if (w.how === 'player') return `Resume ep ${nf(w.ep)} at ${fmtTime(w.t)}`;
  if (w.how === 'opened') return `Continue ep ${nf(w.ep)}`;
  return `Play ep ${nf(w.ep)}`;
}
/** how far along, for the little bars: inside the episode when the player said, else through the series */
const placeFrac = w => (w.how === 'player' && w.d ? w.t / w.d : w.of ? (w.ep - 1) / w.of : 0);

/** 83.4 -> "1:23", 3723 -> "1:02:03" (cut, not rounded, like a player clock) */
function fmtTime(t) {
  const s = Math.max(0, Math.floor(Number(t) || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p2 = n => String(n).padStart(2, '0');
  return hh ? `${hh}:${p2(mm)}:${p2(ss)}` : `${mm}:${p2(ss)}`;
}
/** a card badge: "2.5 s" for a short clip, "1:23" otherwise */
const fmtLen = d => (!Number.isFinite(d) || d <= 0 ? '' : d < 60 ? `${(Math.floor(d * 10) / 10).toFixed(1)} s` : fmtTime(d));
/** 166 -> "2h 46m" */
function fmtRuntime(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  if (!m) return '';
  const hrs = Math.floor(m / 60), rest = m % 60;
  return !hrs ? `${rest}m` : rest ? `${hrs}h ${rest}m` : `${hrs}h`;
}
function excerpt(s, n = 240) {
  const t = String(s || '').replace(/\s*\[Written by MAL Rewrite\]\s*$/i, '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return `${cut.slice(0, sp > n * 0.6 ? sp : n).replace(/[\s,.;:!?—–-]+$/, '')}…`;
}
function hueOf(s) { let x = 7; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x % 360; }
/** Plain procedural art for things with no picture — obviously a gradient, never a fake poster. */
function artFallback(seed) {
  const a = hueOf(seed), b = (a + 48) % 360;
  return `radial-gradient(80% 70% at 28% 18%,hsl(${b} 62% 56% / .7),transparent 64%),linear-gradient(155deg,hsl(${a} 48% 30%),hsl(${(a + 320) % 360} 44% 11%))`;
}
const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
function dayLabel(ms) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = new Date(ms);
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const clockOf = ms => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const isShow = m => {
  const c = arr(m && m.cats);
  if (c.includes('series')) return true;
  if (c.includes('movies')) return false;
  const r = Number(m && m.runtime);
  return r > 0 && r < 70;           /* movies.js: the catalogue stores episode length for series */
};

/* ---------------- persisted state (treated as untrusted) ---------------- */
function readData(raw) {
  const d = obj(raw);
  const history = arr(d.history)
    .filter(r => r && typeof r === 'object' && ['anime', 'movie', 'video', 'film'].includes(r.k) && typeof r.id === 'string' && r.id)
    .map(r => ({
      k: r.k, id: r.id.slice(0, 600), title: String(r.title || '').slice(0, 200), at: Number(r.at) || 0,
      ...(typeof r.path === 'string' ? { path: r.path } : {}),
    }))
    .slice(0, HIST_MAX);
  const videos = {};
  for (const [ref, v] of Object.entries(obj(d.videos))) {
    if (!v || typeof v !== 'object') continue;
    const t = Number(v.t), dd = Number(v.d);
    if (!Number.isFinite(t) || !Number.isFinite(dd) || dd <= 0) continue;
    videos[ref] = { t: Math.max(0, Math.min(t, dd)), d: dd, at: Number(v.at) || 0, path: String(v.path || ''), name: String(v.name || '') };
  }
  const meta = {};
  for (const [k, m] of Object.entries(obj(d.meta))) {
    if (!/^anime:[^\s]+$/.test(k) || !m || typeof m !== 'object' || !m.title) continue;
    meta[k] = {
      title: String(m.title).slice(0, 200), image: httpsUrl(m.image),
      episodes: Number(m.episodes) || null, year: Number(m.year) || null,
      type: String(m.type || '').slice(0, 24), score: typeof m.score === 'number' ? m.score : null,
      genres: arr(m.genres).filter(g => typeof g === 'string').slice(0, 3),
      syn: typeof m.syn === 'string' ? m.syn.slice(0, 300) : '',
    };
  }
  return { v: 1, history, videos, meta };
}

/** Why a catalogue did not load, in words a person can act on. The browser's
    own message is kept on the end rather than shown on its own. */
function whyFailed(e) {
  const raw = String((e && e.message) || e || '').trim();
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline) return `You’re offline, so neither the live catalogue nor the copy that ships with StaticOS could be read. (${raw || 'no connection'})`;
  if (/abort|timeout|timed out/i.test(raw)) return `It took too long to answer — the connection may be slow, or this network may be holding it up. (${raw})`;
  if (/failed to fetch|networkerror|load failed|err_/i.test(raw)) return `StaticOS couldn’t reach it. A locked-down network (school or work Wi-Fi) often blocks downloads this size. (${raw})`;
  if (/^HTTP \d/i.test(raw)) return `The file StaticOS asked for came back as an error. (${raw})`;
  return raw || 'No reason was given.';
}

/* ================================================================
   catalogues — imported once, shared with every other window
   ================================================================ */
let animeMod = null;
let animeModP = null;
const animeModule = () => animeModP || (animeModP = import('../portal/anime.data.js')
  .then(m => (animeMod = m))
  .catch(err => { animeModP = null; throw err; }));
const animeReady = () => !!(animeMod && animeMod.isLoaded('anime'));

let provP = null;
const providers = () => provP || (provP = import('../portal/providers.js')
  .then(m => m.providers || m.default || m)
  .catch(err => { provP = null; throw err; }));
let movies = null;              /* { items, P } once listMovies() has answered this session */

/* ================================================================
   frames — a real picture per video file, two decoders at a time.
   Kept for the session as small JPEG data URLs (nothing to revoke),
   keyed by the file's bytes so a rename keeps its picture.
   ================================================================ */
const frames = new Map();       /* key -> { src, w, h, dur } | { error } */
const FJ = { running: 0, queue: [], inflight: new Map(), live: new Set() };
const frameKey = n => `${n.content}#${n.size}`;

function frameFor(n) {
  const key = frameKey(n);
  if (frames.has(key)) return Promise.resolve(frames.get(key));
  if (FJ.inflight.has(key)) return FJ.inflight.get(key);
  const p = new Promise(resolve => {
    FJ.queue.push({ n, key, resolve, aborted: false, cleanups: new Set(), ctl: typeof AbortController === 'function' ? new AbortController() : null });
    pumpFrames();
  });
  FJ.inflight.set(key, p);
  return p;
}

function pumpFrames() {
  while (FJ.running < 2 && FJ.queue.length) {
    const job = FJ.queue.shift();
    FJ.running++;
    FJ.live.add(job);
    grabFrame(job)
      .then(info => info, e => (e && e.code === 'abort' ? null : { error: String(e?.code ?? 4) }))
      .then(info => {
        FJ.running--;
        FJ.live.delete(job);
        FJ.inflight.delete(job.key);
        /* a slow read is not a verdict on the file: leave it uncached so the
           next paint tries again, while a real decode error sticks */
        if (info && info.error !== 'timeout') {
          frames.set(job.key, info);
          while (frames.size > FRAME_CAP) frames.delete(frames.keys().next().value);
        }
        job.resolve(info);
        pumpFrames();
      });
  }
}

/** Stop every frame job (the window closed). Queued ones resolve null. */
function abortFrames() {
  for (const job of FJ.queue.splice(0)) { FJ.inflight.delete(job.key); job.resolve(null); }
  for (const job of [...FJ.live]) {
    job.aborted = true;
    try { job.ctl?.abort(); } catch (e) {}
    for (const c of [...job.cleanups]) c();
  }
}

async function grabFrame(job) {
  const n = job.n;
  /* wait for one media event, cancellable by abortFrames() */
  const wait = (el, evt, ms = FRAME_TIMEOUT) => new Promise((resolve, reject) => {
    if (job.aborted) { reject({ code: 'abort' }); return; }
    let t = 0;
    const off = () => { clearTimeout(t); el.removeEventListener(evt, ok); el.removeEventListener('error', bad); job.cleanups.delete(cancel); };
    const ok = () => { off(); resolve(); };
    const bad = () => { off(); reject({ code: el.error?.code || 4 }); };
    const cancel = () => { off(); reject({ code: 'abort' }); };
    t = setTimeout(() => { off(); reject({ code: 'timeout' }); }, ms);
    el.addEventListener(evt, ok);
    el.addEventListener('error', bad);
    job.cleanups.add(cancel);
  });

  if (!media.isMedia(n)) throw { code: 'nodata' };
  const url = await media.urlOf(n);
  if (!url) throw { code: 'missing' };
  if (job.aborted) throw { code: 'abort' };
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.preload = 'metadata';
  v.setAttribute('aria-hidden', 'true');
  v.tabIndex = -1;
  /* parked off-screen while it works: a detached element's seeks are
     noticeably slower in Chromium, and one that never paints can stall */
  v.style.cssText = 'position:fixed;left:-10000px;top:0;width:160px;height:90px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  let own = null;
  try {
    v.src = url;
    await wait(v, 'loadedmetadata');
    /* python's http.server (and some hosts) ignore Range, so nothing is
       seekable; a shipped clip is small, so read it whole and decode that */
    if (!seekableOk(v) && isAssetNode(n)) {
      const res = await fetch(url, job.ctl ? { signal: job.ctl.signal } : undefined);
      if (!res.ok) throw { code: 'missing' };
      const blob = await res.blob();
      if (job.aborted) throw { code: 'abort' };
      own = URL.createObjectURL(blob);
      v.src = own;
      await wait(v, 'loadedmetadata');
    }
    let dur = v.duration;
    if (!Number.isFinite(dur)) {
      /* a MediaRecorder file has no length in its header until it is read to the end */
      for (let i = 0; i < 3 && !Number.isFinite(v.duration); i++) {
        const got = wait(v, 'durationchange', 6000);
        if (i === 0) v.currentTime = 1e101;
        await got.catch(e => { if (e && e.code === 'abort') throw e; });
      }
      dur = Number.isFinite(v.duration) ? v.duration : 0;
    }
    if (!v.videoWidth || !v.videoHeight) throw { code: 'novideo' };
    const at = dur > 0 ? Math.min(dur * 0.1, Math.max(0, dur - 0.05)) : 0;
    const seeked = wait(v, 'seeked', FRAME_TIMEOUT * 2);    /* a slow software decoder can take a while */
    v.currentTime = at;
    await seeked;
    if (v.readyState < 2) await wait(v, 'loadeddata', 4000).catch(e => { if (e && e.code === 'abort') throw e; });
    const s = Math.min(1, FRAME_MAX / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.videoWidth * s));
    c.height = Math.max(1, Math.round(v.videoHeight * s));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return { src: c.toDataURL('image/jpeg', 0.82), w: v.videoWidth, h: v.videoHeight, dur };
  } finally {
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* already gone */ }
    v.remove();
    if (own) URL.revokeObjectURL(own);
  }
}

const FRAME_ERR = {
  nodata: 'No video data in this file',
  missing: 'The file’s bytes are missing',
  timeout: 'Took too long to read',
  novideo: 'Sound only — no picture',
};
const frameErrText = code => FRAME_ERR[code] || 'This browser can’t preview it';

/* ================================================================
   the engine — follows the Videos player and remembers positions
   ================================================================ */
const ENGINE = { refs: 0, api: null, offs: [], wins: new Map(), resume: null };
let bootRelease = null;

/**
 * Keep video positions for the whole session. Call once at boot, after the
 * apps have registered; calling it again is harmless.
 */
export function init(api = (typeof window !== 'undefined' ? window.StaticAPI : null)) {
  if (bootRelease || !api) return bootRelease;
  bootRelease = startEngine(api);
  return bootRelease;
}

function startEngine(api) {
  ENGINE.refs++;
  if (ENGINE.refs === 1) {
    ENGINE.api = api;
    ENGINE.offs.push(api.bus.on('win:open', w => { if (w && w.appId === 'videos') attachPlayer(w.el); }));
    ENGINE.offs.push(api.bus.on('win:close', w => { if (w && w.el) detachPlayer(w.el); }));
    try { for (const w of api.wm.byApp('videos')) attachPlayer(w.el); } catch (e) { /* no windows yet */ }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ENGINE.refs = Math.max(0, ENGINE.refs - 1);
    if (ENGINE.refs) return;
    ENGINE.offs.splice(0).forEach(off => { try { off(); } catch (e) {} });
    for (const el of [...ENGINE.wins.keys()]) detachPlayer(el);
    ENGINE.resume = null;
    ENGINE.api = null;
  };
}

function attachPlayer(el) {
  if (!el || ENGINE.wins.has(el)) return;
  const video = el.querySelector('.vid-player video') || el.querySelector('video');
  if (!video) return;
  const st = { el, video, ident: null, last: 0, offs: [] };
  for (const evt of ['playing', 'timeupdate', 'pause', 'ended']) {
    const fn = () => onPlayer(st, evt);
    video.addEventListener(evt, fn);
    st.offs.push(() => video.removeEventListener(evt, fn));
  }
  ENGINE.wins.set(el, st);
}

function detachPlayer(el) {
  const st = ENGINE.wins.get(el);
  if (!st) return;
  st.offs.splice(0).forEach(off => off());
  ENGINE.wins.delete(el);
}

/** Which file a Videos window shows, read off its own title bar:
    the title is the file name, the subtitle its folder (~/Videos). */
function shownFile(el) {
  const api = ENGINE.api;
  if (!api) return null;
  const name = el.getAttribute('aria-label') || '';
  const sub = (el.querySelector('.win__sub')?.textContent || '').trim();
  if (!name || !sub) return null;
  const HOME = api.vfs.HOME;
  const dir = sub === '~' ? HOME : sub.startsWith('~/') ? HOME + sub.slice(1) : sub;
  const path = api.vfs.norm(`${dir}/${name}`);
  const n = api.vfs.node(path);
  if (!isVideoNode(n) || !media.isMedia(n)) return null;
  return { path, name: n.name, ref: n.content };
}

function onPlayer(st, evt) {
  const api = ENGINE.api;
  if (!api) return;
  const v = st.video;
  const src = v.getAttribute('src');
  if (!src) return;                           /* released, or switching files */
  let file = st.ident && st.ident.src === src ? st.ident.file : null;
  if (!file) {
    file = shownFile(st.el);
    if (!file) return;
    st.ident = { src, file };
  }
  const d = v.duration;
  if (evt === 'playing' && ENGINE.resume && ENGINE.resume.ref === file.ref) {
    const { t: want, until } = ENGINE.resume;
    ENGINE.resume = null;
    if (Date.now() < until && Number.isFinite(d) && want > 0 && want < d - 1) {
      try { v.currentTime = want; } catch (e) { /* not seekable: it plays from the start */ }
      st.last = Date.now();
      return;
    }
  }
  if (!Number.isFinite(d) || d < MIN_LEN) return;
  const now = Date.now();
  if (evt === 'timeupdate' && now - st.last < SAVE_EVERY) return;
  const t = evt === 'ended' ? d : v.currentTime;
  if (t < 2 && evt !== 'ended') return;       /* the very start never clobbers a saved place */
  st.last = now;
  writeVideoPos(api.store, file, t, d);
}

function writeVideoPos(store, file, t, d) {
  const cur = readData(store.get(KEY));
  const videos = { ...cur.videos, [file.ref]: { t: Math.round(t * 10) / 10, d: Math.round(d * 10) / 10, at: Date.now(), path: file.path, name: file.name } };
  const keys = Object.keys(videos);
  if (keys.length > VID_MAX) keys.sort((a, b) => videos[b].at - videos[a].at).slice(VID_MAX).forEach(k => { delete videos[k]; });
  store.set(KEY, { ...cur, videos });
}

/* ================================================================
   the app
   ================================================================ */
defineApp({
  id: 'watch',
  name: 'Static Watch',
  icon: 'play',
  g1: '#ff8566', g2: '#df3e33',
  category: 'Media',
  keywords: ['watch', 'continue watching', 'up next', 'watchlist', 'history', 'tv', 'shows', 'series', 'movies', 'films', 'anime', 'videos', 'resume', 'queue', 'streaming'],
  desc: 'Continue watching, your watchlist, shows, movies, anime and your videos',
  singleton: true,
  win: { w: 1040, h: 680, minW: 380, minH: 420 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus, vfs, fmt } = api;
    const HOME = vfs.HOME;
    const TRASH = `${HOME}/Trash`;
    const tilde = p => (p === HOME ? '~' : p.startsWith(HOME + '/') ? `~${p.slice(HOME.length)}` : p);
    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    const S = {
      sec: canonSec(opts?.section) || 'home',
      q: typeof opts?.q === 'string' ? opts.q.trim().slice(0, 80) : '',
      narrow: false,
      dead: false,
      stale: false,
      self: 0,
      wlFilter: 'all',
      mv: { sort: 'rating', genre: '' },
      sh: { sort: 'rating', genre: '' },
      an: { genre: '', sort: 'score', shown: GRID_STEP },
    };
    const A = { state: 'idle', err: '' };                    /* the anime catalogue */
    const M = { state: movies ? 'ready' : 'idle', err: '' }; /* the film catalogue  */

    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); if (!S.dead) fn(); }, ms);
      timers.add(t);
      return t;
    };
    const cancel = t => { clearTimeout(t); timers.delete(t); };
    let rafId = 0;
    let tabRaf = 0;
    const offs = [];
    const releaseEngine = startEngine(api);

    const note = n => api.notify({ app: 'Static Watch', icon: 'play', timeout: 4000, ...n });
    /* the Internet Archive film library: built the first time its section opens */
    let FM = null;
    const films = () => FM || (filmsMod ? (FM = filmsMod.createFilms({ api, win, note, remember })) : null);

    /* ---------------- store access ---------------- */
    const progAll = () => obj(store.get(PROG_KEY, {}));
    const wlAll = () => arr(store.get(WL_KEY, []));
    /** my own writes: the subscriptions below skip them (the view repaints itself) */
    function selfSet(path, value) {
      S.self++;
      try { store.set(path, value); } finally { S.self--; }
    }
    const commit = next => selfSet(KEY, next);

    /* ---------------- watchlist (the shared "kind:id" contract) ----------------
       Plain strings only; every row this app does not recognise is carried
       through untouched. A movie may still sit there as a bare id or an
       object row from an older build (movies.js reads both), so those
       count as saved too, and are dropped with it on removal. */
    const wlMatch = (kind, id) => {
      const token = `${kind}:${id}`;
      return row => row === token || (kind === 'movie' && (row === id
        || (!!row && typeof row === 'object' && ((row.kind === 'movie' && String(row.id) === id) || row.url === `static://movies/${id}`))));
    };
    const wlHas = (kind, id) => wlAll().some(wlMatch(kind, id));
    function toggleWatchlist(kind, id, title) {
      const list = wlAll();
      const hit = wlMatch(kind, id);
      const kept = list.filter(r => !hit(r));
      const removing = kept.length !== list.length;
      selfSet(WL_KEY, removing ? kept : [...kept, `${kind}:${id}`]);
      note({ icon: removing ? 'trash' : 'bookmark', title: removing ? 'Removed from Watchlist' : 'Added to Watchlist', message: title });
      paint();
    }

    /* ---------------- anime progress (Static Anime's own shape) ---------------- */
    function setAnimeProgress(id, ep, of) {
      const all = progAll();
      const key = `anime:${id}`;
      if (!ep) {
        if (!(key in all)) return;
        const next = { ...all };
        delete next[key];
        selfSet(PROG_KEY, next);
        return;
      }
      selfSet(PROG_KEY, { ...all, [key]: { ep, of: of || 0, at: Date.now() } });
    }
    const placeOf = id => whereLeftOff(store, 'anime', String(id));
    /** "Next episode": the one you are on counts as watched, and the next opens in Static Anime's player */
    function nextEpisode(id, title) {
      const w = placeOf(id);
      if (!canNext(w)) return;
      if (!(w.marked >= w.ep)) setAnimeProgress(id, w.ep, w.of);
      openAnime(id, title, w.ep + 1);
    }
    function markEpisode(id, title) {
      const w = placeOf(id);
      if (!w || w.how === 'next') return;
      setAnimeProgress(id, w.ep, w.of);
      const done = w.of && w.ep >= w.of;
      note({ icon: done ? 'check-circle' : 'check', title: done ? `Finished ${title}` : `Episode ${nf(w.ep)} marked watched`,
        message: done ? 'It has left Continue Watching.' : `${title} — marked here and in Static Anime.` });
      paint();
    }
    async function forgetAnime(id, title) {
      const w = placeOf(id);
      const what = !w ? 'your place' : w.how === 'next' ? `that you finished episode ${nf(w.ep - 1)}` : `that you were on episode ${nf(w.ep)}`;
      const ok = await api.confirm({ title: 'Forget your place?', message: `Static Anime will no longer remember ${what} of “${title}”, or which episodes you marked watched. This can’t be undone.`, ok: 'Forget', danger: true });
      if (!ok || S.dead) return;
      setAnimeProgress(id, 0);
      const res = obj(store.get(RESUME_KEY, {}));
      if (`anime:${id}` in res) {
        const next = { ...res };
        delete next[`anime:${id}`];
        selfSet(RESUME_KEY, next);
      }
      paint();
    }
    function forgetVideo(ref, name) {
      const D = readData(store.get(KEY));
      if (!D.videos[ref]) return;
      const videos = { ...D.videos };
      delete videos[ref];
      commit({ ...D, videos });
      note({ icon: 'rotate-ccw', title: 'Position forgotten', message: name });
      paint();
    }

    /* ---------------- history (only what was opened here) ---------------- */
    function remember(entry) {
      const D = readData(store.get(KEY));
      const rest = D.history.filter(r => !(r.k === entry.k && r.id === entry.id));
      commit({ ...D, history: [{ ...entry, at: Date.now() }, ...rest].slice(0, HIST_MAX) });
    }
    function forgetHistory(r) {
      const D = readData(store.get(KEY));
      commit({ ...D, history: D.history.filter(x => !(x.k === r.k && x.id === r.id)) });
      paint();
    }
    async function clearHistory() {
      const D = readData(store.get(KEY));
      if (!D.history.length) return;
      const ok = await api.confirm({ title: 'Clear your Watch history?', message: `The ${plural(D.history.length, 'thing')} you opened from Static Watch will be forgotten. Your watchlist and your place in anything you’re watching stay.`, ok: 'Clear', danger: true });
      if (!ok || S.dead) return;
      commit({ ...readData(store.get(KEY)), history: [] });
      paint();
    }

    /* ---------------- opening things in the app that owns them ---------------- */
    /** Open a title in Static Anime; with an episode, straight into its player at that episode. */
    function openAnime(id, title, ep = 0) {
      if (!api.getApp('aether-anime')) {
        note({ icon: 'info', title: 'Static Anime is not in this build', message: `“${title || 'That title'}” needs it to open.` });
        return;
      }
      remember({ k: 'anime', id: String(id), title: title || '' });
      const n = Math.floor(Number(ep) || 0);
      api.openApp('aether-anime', { url: `static://anime/${encodeURIComponent(id)}${n >= 1 ? `?ep=${n}` : ''}` });
      softPaint();
    }
    function openMovie(m) {
      const host = api.getApp('browser') ? 'browser' : api.getApp('aether-anime') ? 'aether-anime' : null;
      if (!host) {
        note({ icon: 'info', title: 'Nothing here opens title pages', message: `“${m.title}” needs the Browser.` });
        return;
      }
      remember({ k: 'movie', id: String(m.id), title: m.title || '' });
      api.openApp(host, { url: `static://movies/${m.id}` });
      softPaint();
    }
    function openVideo(path, { resume = false } = {}) {
      const n = vfs.node(path);
      if (!n || n.type !== 'file') {
        note({ icon: 'alert', title: 'Video not found', message: `${tilde(path)} isn’t there any more.` });
        paint();
        return;
      }
      const ref = n.content;
      const p = readData(store.get(KEY)).videos[ref];
      ENGINE.resume = resume && vidInProgress(p) ? { ref, t: p.t, until: Date.now() + RESUME_TTL } : null;
      remember({ k: 'video', id: ref, title: n.name, path });
      const w = api.openFile(path, api.getApp('videos') ? 'videos' : undefined);
      if (!w) {
        ENGINE.resume = null;
        note({ icon: 'alert', title: 'Nothing here plays videos', message: 'The Videos app is not part of this build.' });
      }
      softPaint();
    }
    const showInFiles = path => api.openApp('files', { path });

    /* ---------------- the anime catalogue ---------------- */
    function startAnimeLoad() {
      if (animeReady()) { A.state = 'ready'; return; }
      if (A.state === 'loading') return;
      A.state = 'loading';
      A.err = '';
      (async () => {
        try {
          const m = await animeModule();
          await m.load('anime');
          if (S.dead) return;
          A.state = 'ready';
        } catch (e) {
          if (S.dead) return;
          A.state = 'error';
          A.err = whyFailed(e);
        }
        paint();
      })();
    }
    const loadAnimeNow = () => { startAnimeLoad(); paint(); };

    /** Copy title + poster of every anime you touched into portal.watch.meta. */
    function refreshMeta() {
      if (!animeReady()) return;
      const D = readData(store.get(KEY));
      const prog = progAll();
      const want = new Set();
      for (const [k, v] of Object.entries(prog)) if (k.startsWith('anime:') && Number(v?.ep) > 0) want.add(k.slice(6));
      for (const k of Object.keys(obj(store.get(RESUME_KEY, {})))) if (k.startsWith('anime:')) want.add(k.slice(6));
      for (const r of wlAll()) if (typeof r === 'string' && r.startsWith('anime:')) want.add(r.slice(6));
      for (const r of D.history) if (r.k === 'anime') want.add(r.id);
      const ids = [...want].sort().slice(0, META_MAX);
      const meta = {};
      for (const rec of animeMod.byIds(ids, 'anime')) {
        meta[`anime:${rec.id}`] = {
          title: String(rec.title || '').slice(0, 200), image: httpsUrl(rec.image),
          episodes: Number(rec.episodes) || null, year: Number(rec.year) || null,
          type: String(rec.mediaType || '').slice(0, 24), score: typeof rec.score === 'number' ? rec.score : null,
          genres: arr(rec.genres).slice(0, 3),
          syn: placeOf(rec.id) ? excerpt(rec.synopsis, 240) : '',
        };
      }
      const sorted = Object.fromEntries(Object.keys(meta).sort().map(k => [k, meta[k]]));
      const before = Object.fromEntries(Object.keys(D.meta).sort().map(k => [k, D.meta[k]]));
      if (JSON.stringify(sorted) === JSON.stringify(before)) return;
      commit({ ...D, meta: sorted });
    }

    /** One view of an anime title: the loaded catalogue first, then the cache. */
    function animeInfo(id, V) {
      if (animeReady()) {
        const r = animeMod.byId(id, 'anime');
        if (r) return { title: r.title, image: httpsUrl(r.image), episodes: r.episodes, year: r.year, type: r.mediaType, score: r.score, genres: arr(r.genres).slice(0, 3), syn: r.synopsis || '' };
        return null;
      }
      return V.D.meta[`anime:${id}`] || null;
    }
    const infoOfRec = r => ({ title: r.title, image: httpsUrl(r.image), episodes: r.episodes, year: r.year, type: r.mediaType, score: r.score, genres: arr(r.genres).slice(0, 3), syn: r.synopsis || '' });

    /* ---------------- the film catalogue (providers.js, like the Movies page) ---------------- */
    function startMoviesLoad() {
      if (movies) { M.state = 'ready'; return; }
      if (M.state === 'loading') return;
      M.state = 'loading';
      M.err = '';
      (async () => {
        try {
          const P = await providers();
          const res = await P.listMovies({ category: 'all', sort: 'rating' });
          movies = { items: arr(res && res.items).filter(m => m && m.id && m.title), P };
          if (S.dead) return;
          M.state = 'ready';
        } catch (e) {
          if (S.dead) return;
          M.state = 'error';
          M.err = whyFailed(e);
        }
        paint();
      })();
    }
    const movieById = id => (movies ? (movies.items.find(m => String(m.id) === String(id)) || movies.P.getMovie?.(id) || null) : null);
    const movieArt = m => (movies && typeof movies.P.artFor === 'function' ? movies.P.artFor(m.title, 'movie') : artFallback(`movie:${m.id}`));
    const moviesSourceNote = () => {
      const P = movies && movies.P;
      const live = P && ((P.config && P.config.mode === 'proxy') || (typeof P.templateFor === 'function' && P.templateFor('movie')));
      return live
        ? 'Each title opens its page in the Browser, where it plays from the source StaticOS is connected to.'
        : 'Static keeps the details for these titles, not the video — nothing plays until a source is connected. Each title opens its page in the Browser.';
    };

    /* ---------------- your video files ---------------- */
    function videoFiles() {
      const out = [];
      VIDEO_DIRS.forEach((dir, rank) => {
        const base = `${HOME}/${dir}`;
        if (!vfs.node(base)) return;
        vfs.walk(base, (n, p) => { if (isVideoNode(n)) out.push({ path: p, node: n, dir: vfs.parentPath(p), rank }); });
      });
      /* ~/Videos first, then ~/Downloads; inside each, folder then name */
      return out.sort((a, b) => a.rank - b.rank || a.dir.localeCompare(b.dir) || a.node.name.localeCompare(b.node.name, undefined, { numeric: true }));
    }
    function refIndex() {
      const m = new Map();
      vfs.walk(HOME, (n, p) => {
        if (n.type !== 'file' || p === TRASH || p.startsWith(TRASH + '/')) return;
        if (isVideoNode(n) && media.isMedia(n) && !m.has(n.content)) m.set(n.content, { path: p, node: n });
      });
      return m;
    }

    /* ---------------- one snapshot per paint ---------------- */
    function snapshot() {
      const D = readData(store.get(KEY));
      const V = { D, films: Object.fromEntries(filmContinue(store).map(i => [i.id, i.p])), prog: progAll(), res: obj(store.get(RESUME_KEY, {})), files: videoFiles(), refs: refIndex() };
      V.cont = continueItems(V);
      V.wl = watchItems(V);
      return V;
    }

    function continueItems(V) {
      const out = [];
      const ids = new Set();
      for (const k of [...Object.keys(V.prog), ...Object.keys(V.res)]) if (k.startsWith('anime:')) ids.add(k.slice(6));
      for (const id of ids) {
        const w = placeOf(id);
        if (w) out.push({ kind: 'anime', id, ...w, info: animeInfo(id, V) });
      }
      for (const [ref, p] of Object.entries(V.D.videos)) {
        if (!vidInProgress(p)) continue;
        const hit = V.refs.get(ref);
        if (!hit) continue;                         /* the file is gone: nothing to resume */
        out.push({ kind: 'video', ref, path: hit.path, node: hit.node, p, at: p.at });
      }
      out.push(...filmContinue(store));
      return out.sort((a, b) => b.at - a.at);
    }

    function watchItems(V) {
      const items = [];
      let manga = 0, missing = 0, pending = 0;
      const seen = new Set();
      for (const row of [...wlAll()].reverse()) {
        let kind = null, id = null;
        if (typeof row === 'string') {
          const i = row.indexOf(':');
          if (i > 0) { kind = row.slice(0, i); id = row.slice(i + 1); } else { kind = 'movie'; id = row; }
        } else if (row && typeof row === 'object' && row.kind === 'movie' && row.id) { kind = 'movie'; id = String(row.id); }
        if (!kind || !id) { missing++; continue; }
        const k = `${kind}:${id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (kind === 'manga') { manga++; continue; }
        if (kind === 'anime') {
          const info = animeInfo(id, V);
          if (!info && animeReady()) { missing++; continue; }
          items.push({ kind: 'anime', id, info });
        } else if (kind === 'movie') {
          if (!movies) { pending++; continue; }
          const m = movieById(id);
          if (!m) { missing++; continue; }
          items.push({ kind: isShow(m) ? 'show' : 'movie', id, m });
        } else missing++;
      }
      return { items, manga, missing, pending };
    }

    /* ================================================================
       view
       ================================================================ */
    const sideEl = h('nav.app__side.wt-side', { 'aria-label': 'Static Watch sections' });
    const tabsEl = h('nav.wt-tabs', { 'aria-label': 'Static Watch sections', hidden: true });
    const barEl = h('div.app__bar.wt-bar');
    const content = h('div.app__content.app__content--flush.wt-content', { tabindex: '-1' });
    const mainEl = h('div.app__main.wt-main', tabsEl, barEl, content);
    const fileIn = h('input', { type: 'file', accept: 'video/*,.mp4,.webm,.mov,.m4v,.ogv,.mkv', multiple: true, hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
    const appEl = h('div.app.wt', sideEl, mainEl, fileIn);
    root.appendChild(appEl);

    /* search lives in the window toolbar, like the Store's */
    let qTimer = 0;
    const findIn = h('input', {
      type: 'search', placeholder: 'Search Watch…', spellcheck: 'false', maxlength: '80',
      'aria-label': 'Search movies, shows, anime and your videos', value: S.q,
      oninput: () => { cancel(qTimer); qTimer = later(() => { const v = findIn.value.trim(); if (v !== S.q) { S.q = v; paint({ top: true }); } }, 160); },
      onkeydown: e => {
        if (e.key === 'Escape' && findIn.value) { e.preventDefault(); e.stopPropagation(); findIn.value = ''; S.q = ''; paint({ top: true }); }
        else if (e.key === 'Enter') { cancel(qTimer); S.q = findIn.value.trim(); paint({ top: true }); }
      },
    });
    win.setTools(h('div.field.wt-find', icon('search'), findIn));

    /* ---------------- shared pieces ---------------- */
    /** Element.append() would print a null as the text "null" — skip them */
    const put = (parent, ...nodes) => { parent.append(...nodes.filter(Boolean)); return parent; };
    const empty =(ic, title, text, ...actions) => h('div.empty.wt-empty', icon(ic), h('b', { text: title }), h('small', { text }),
      actions.filter(Boolean).length ? h('div.wt-empty__acts', actions.filter(Boolean)) : null);
    const btn = (label, ic, onclick, cls = '', extra = {}) => h(`button.btn.btn--sm${cls}`, { type: 'button', onclick, ...extra }, ic ? icon(ic, ic === 'play' ? { fill: true } : undefined) : null, h('span', { text: label }));
    const banner = (ic, text, ...extra) => h('div.wt-banner', icon(ic), h('span.grow', { text }), ...extra);
    const loadingState = (title, text) => h('div.wt-state', { role: 'status' }, h('div.spinner'), h('b', { text: title }), text ? h('small', { text }) : null);
    const errorState = (title, text, retry) => h('div.wt-state.is-error', { role: 'alert' }, icon('alert'), h('b', { text: title }), h('small', { text }),
      retry ? btn('Try again', 'refresh', retry, '', { dataset: { fk: 'retry' } }) : null);

    function menuAt(el, items) {
      const r = el.getBoundingClientRect();
      api.menu(items.filter(Boolean), r.left, r.bottom + 4);
    }
    function menuFromEvent(e, items) {
      e.preventDefault();
      /* the keyboard's menu key fires contextmenu at 0,0 — anchor to the element */
      if (!e.clientX && !e.clientY) { menuAt(e.currentTarget, items); return; }
      api.menu(items.filter(Boolean), e.clientX, e.clientY);
    }

    function artBox(cls, { bg, img, mono, pos }) {
      const box = h(`div.wt-art.${cls}`, { style: { '--art': bg } });
      if (mono) box.append(h('span.wt-art__mono', { 'aria-hidden': 'true', text: mono }));
      if (img) {
        box.append(h('img.wt-art__img', {
          src: img, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false',
          style: pos ? { objectPosition: pos } : null,
          onerror: e => { e.target.remove(); },
        }));
      }
      return box;
    }
    const badge = text => h('span.wt-art__badge', icon('star', { fill: true }), h('span', { text }));
    const savedMark = () => h('span.wt-art__saved', { title: 'On your watchlist' }, icon('bookmark', { fill: true }), h('span.sr', { text: 'On your watchlist' }));
    /** the little pills in a picture's top-left corner (rating, saved) */
    const tagsOf = box => box.querySelector(':scope > .wt-art__tags') || box.appendChild(h('span.wt-art__tags'));
    const progBar = frac => h('span.wt-art__prog', { 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(3, Math.round(clamp01(frac) * 100))}%` } }));
    const hoverMark = ic => h('span.wt-art__play', { 'aria-hidden': 'true' }, icon(ic, ic === 'play' ? { fill: true } : undefined));

    /** Put a real frame (or an honest note) into a 16:9 art box. */
    function fillFrame(box, n, durEl) {
      const done = info => {
        box.classList.remove('is-loading');
        if (!info) return;
        if (info.error) {
          box.classList.add('is-bad');
          box.append(h('span.wt-art__ph', icon('alert'), h('span', { text: frameErrText(info.error) })));
          return;
        }
        box.prepend(h('img.wt-art__img', { src: info.src, alt: '', draggable: 'false' }));
        if (durEl && info.dur) durEl.textContent = fmtLen(info.dur);
      };
      if (!media.isMedia(n)) { done({ error: 'nodata' }); return; }
      const have = frames.get(frameKey(n));
      if (have) { done(have); return; }
      box.classList.add('is-loading');
      frameFor(n).then(info => { if (!S.dead) done(info); });
    }
    function frameBg(box, n) {
      /* the hero's blurred backdrop: same frame, once it exists */
      const show = info => { if (info && info.src) box.prepend(h('img.wt-hero__bgimg', { src: info.src, alt: '' })); };
      if (!media.isMedia(n)) return;
      const have = frames.get(frameKey(n));
      if (have) show(have); else frameFor(n).then(info => { if (!S.dead) show(info); });
    }

    /* ---------------- descriptions: one per kind, used by every card ---------------- */
    /** `w` is the title's place from whereLeftOff(), or null */
    function dAnime(id, info, w, { shape = 'poster' } = {}) {
      const title = info ? info.title : `MyAnimeList #${id}`;
      const epLine = w ? placeLine(w) : '';
      const facts = info ? [info.year, info.episodes ? (info.episodes === 1 ? (info.type || '1 episode') : `${nf(info.episodes)} eps`) : info.type].filter(Boolean).join(' · ') : '';
      const sub = epLine || facts || (info ? 'Anime' : 'Waiting on the anime catalogue');
      const box = artBox(`wt-art--${shape}`, { bg: artFallback(`anime:${id}`), img: info?.image, mono: title, pos: shape === 'land' ? '50% 22%' : null });
      if (shape === 'poster' && typeof info?.score === 'number') tagsOf(box).append(badge(info.score.toFixed(2)));
      const saved = wlHas('anime', id);
      if (saved) tagsOf(box).append(savedMark());
      if (w && placeFrac(w) > 0) box.append(progBar(placeFrac(w)));
      box.append(hoverMark('play'));
      return {
        key: `anime:${id}`, title, sub, art: box,
        aria: [title, 'anime', epLine || facts, saved ? 'on your watchlist' : ''].filter(Boolean).join(', ') + '. Opens in Static Anime.',
        open: () => openAnime(id, info?.title, w ? w.ep : 0),
        menu: () => animeMenu(id, info, w),
      };
    }
    function animeMenu(id, info, w) {
      const title = info?.title || `MyAnimeList #${id}`;
      const saved = wlHas('anime', id);
      return [
        w ? { label: placeAction(w).replace(/\bep\b/, 'episode'), icon: 'play', onClick: () => openAnime(id, info?.title, w.ep) } : null,
        { label: w ? 'Open its page in Static Anime' : 'Open in Static Anime', icon: 'external-link', onClick: () => openAnime(id, info?.title) },
        canNext(w) ? { label: `Next episode (${nf(w.ep + 1)})`, icon: 'skip-forward', onClick: () => nextEpisode(id, title) } : null,
        w && w.how !== 'next' && !(w.marked >= w.ep) ? { label: `Mark episode ${nf(w.ep)} watched`, icon: 'check', onClick: () => markEpisode(id, title) } : null,
        w ? { label: 'Forget my place…', icon: 'rotate-ccw', onClick: () => forgetAnime(id, title) } : null,
        '-',
        { label: saved ? 'Remove from Watchlist' : 'Add to Watchlist', icon: saved ? 'x' : 'bookmark', onClick: () => toggleWatchlist('anime', id, title) },
      ];
    }

    function dMovie(m, { shape = 'poster' } = {}) {
      const show = isShow(m);
      const g = arr(m.genres);
      const rating = Number(m.rating) || 0;
      const sub = show ? ['Series', m.year].filter(Boolean).join(' · ') : [m.year, g[0]].filter(Boolean).join(' · ');
      const box = artBox(`wt-art--${shape}`, { bg: movieArt(m), mono: m.title });
      box.classList.add('wt-art--made');
      if (rating && shape === 'poster') tagsOf(box).append(badge(rating.toFixed(1)));
      const saved = wlHas('movie', String(m.id));
      if (saved) tagsOf(box).append(savedMark());
      box.append(hoverMark('external-link'));
      return {
        key: `movie:${m.id}`, title: m.title, sub, art: box,
        aria: `${m.title}, ${show ? 'series' : 'film'}${m.year ? `, ${m.year}` : ''}${g.length ? `, ${g.join(' and ')}` : ''}${rating ? `, rated ${rating.toFixed(1)} out of 10` : ''}${saved ? ', on your watchlist' : ''}. Opens its page in the Browser.`,
        open: () => openMovie(m),
        menu: () => movieMenu(m),
      };
    }
    function movieMenu(m) {
      const saved = wlHas('movie', String(m.id));
      return [
        { label: 'Open its page', icon: 'external-link', onClick: () => openMovie(m) },
        '-',
        { label: saved ? 'Remove from Watchlist' : 'Add to Watchlist', icon: saved ? 'x' : 'bookmark', onClick: () => toggleWatchlist('movie', String(m.id), m.title) },
      ];
    }

    function dVideo(path, n, p, { shape = 'video' } = {}) {
      const title = stemOf(n.name);
      const box = h(`div.wt-art.wt-art--${shape}`);
      const dur = h('span.wt-art__dur');
      box.append(dur);
      fillFrame(box, n, dur);
      const going = vidInProgress(p);
      if (going) box.append(progBar(p.t / p.d));
      box.append(hoverMark('play'));
      const where = tilde(vfs.parentPath(path));
      const sub = going ? `${fmtTime(p.t)} of ${fmtTime(p.d)}` : [where, n.size ? fmt.fmtBytes(n.size) : null].filter(Boolean).join(' · ');
      return {
        key: `video:${n.content}`, title, sub, art: box,
        aria: `${n.name}, your video in ${where}${going ? `, stopped at ${fmtTime(p.t)} of ${fmtTime(p.d)}` : ''}. ${going ? 'Resumes' : 'Plays'} in Videos.`,
        open: () => openVideo(path, { resume: going }),
        menu: () => videoMenu(path, n, p),
      };
    }
    function dFilm(it, { shape = 'video' } = {}) {
      const box = h(`div.wt-art.wt-art--${shape === 'land' ? 'video' : shape}`, { style: { '--art': artFallback(`film:${it.id}`) } },
        h('span.wt-art__mono', { 'aria-hidden': 'true', text: it.title }),
        h('img.wt-art__img', { src: filmPoster(it.id), alt: '', loading: 'lazy', draggable: 'false', onerror: e => e.target.remove() }));
      const going = it.p && vidInProgress(it.p);
      if (going) box.append(progBar(it.p.t / it.p.d));
      box.append(hoverMark('play'));
      return {
        key: `film:${it.id}`, title: it.title,
        sub: going ? `${fmtTime(it.p.t)} of ${fmtTime(it.p.d)}` : 'Free film · archive.org',
        art: box,
        aria: `${it.title}, a free film from archive.org${going ? `, stopped at ${fmtTime(it.p.t)} of ${fmtTime(it.p.d)}` : ''}.`,
        open: () => openFilm(it.id, it.title),
        menu: () => [
          { label: going ? `Resume at ${fmtTime(it.p.t)}` : 'Open', icon: 'play', onClick: () => openFilm(it.id, it.title) },
          { label: 'On archive.org', icon: 'external-link', onClick: () => window.open(`https://archive.org/details/${encodeURIComponent(it.id)}`, '_blank', 'noopener,noreferrer') },
          going ? '-' : null,
          going ? { label: 'Forget position', icon: 'x', onClick: () => { forgetFilmPos(store, it.id); paint(); } } : null,
        ],
      };
    }
    function openFilm(id, title) {
      remember({ k: 'film', id, title: title || '' });
      loadFilms().then(() => { if (S.dead) return; go('films'); films().openById(id, title, { resume: true }); });
    }
    function videoMenu(path, n, p) {
      const going = vidInProgress(p);
      return [
        { label: going ? `Resume at ${fmtTime(p.t)}` : 'Play in Videos', icon: 'play', onClick: () => openVideo(path, { resume: going }) },
        going ? { label: 'Play from the start', icon: 'rotate-ccw', onClick: () => openVideo(path) } : null,
        { label: 'Show in Files', icon: 'folder-open', onClick: () => showInFiles(path) },
        p ? '-' : null,
        p ? { label: 'Forget position', icon: 'x', onClick: () => forgetVideo(n.content, n.name) } : null,
      ];
    }

    /** a card: one big button (the picture + words) and a small menu button */
    function card(shape, d, rowKey) {
      const main = h('button.wt-card__main', {
        type: 'button', 'aria-label': d.aria, 'aria-keyshortcuts': 'Shift+F10', dataset: { fk: `${rowKey}:${d.key}` },
        onclick: d.open,
        oncontextmenu: e => menuFromEvent(e, d.menu()),
        /* not every browser turns the menu key into a contextmenu event */
        onkeydown: e => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); menuAt(e.currentTarget, d.menu()); }
        },
      }, d.art, h('span.wt-card__text', h('span.wt-card__t', { text: d.title }), d.sub ? h('span.wt-card__m', { text: d.sub }) : null));
      const more = h('button.wt-card__more', {
        type: 'button', 'aria-label': `More for ${d.title}`, 'aria-haspopup': 'menu', dataset: { fk: `${rowKey}:more:${d.key}` },
        onclick: e => { e.stopPropagation(); menuAt(e.currentTarget, d.menu()); },
      }, icon('more-horizontal'));
      return h(`div.wt-card.wt-card--${shape}`, { role: 'listitem' }, main, more);
    }

    /** a titled horizontal row with See all and scroll buttons (shown only when it overflows) */
    function row({ key, title, ic, count, note: rowNote, cards, more, shape = 'poster' }) {
      if (!cards.length) return null;
      const rail = h(`div.wt-rail.wt-rail--${shape}`, { role: 'list', 'aria-label': title, dataset: { rail: key }, onkeydown: railKeys }, cards);
      const nudge = dir => {
        const step = Math.max(240, rail.clientWidth * 0.8) * dir;
        rail.scrollBy({ left: step, behavior: reduced() ? 'auto' : 'smooth' });
      };
      return h('section.wt-row', { 'aria-label': title },
        h('div.wt-row__head',
          h('h3.wt-row__t', icon(ic), h('span', { text: title })),
          count ? h('span.wt-row__n', { text: count }) : null,
          rowNote ? h('span.wt-row__note', { text: rowNote }) : null,
          h('div.grow'),
          h('div.wt-row__nav',
            h('button.ibtn', { type: 'button', 'aria-label': `Scroll ${title} back`, dataset: { fk: `nav:${key}:l` }, onclick: () => nudge(-1) }, icon('chevron-left')),
            h('button.ibtn', { type: 'button', 'aria-label': `Scroll ${title} forward`, dataset: { fk: `nav:${key}:r` }, onclick: () => nudge(1) }, icon('chevron-right'))),
          more ? h('button.wt-row__more', { type: 'button', dataset: { fk: `more:${key}` }, onclick: () => go(more) }, h('span', { text: 'See all' }), icon('chevron-right')) : null),
        rail);
    }
    function railKeys(e) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const items = [...e.currentTarget.querySelectorAll('.wt-card__main')];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
        : Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      items[j].focus({ preventScroll: true });
      items[j].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    }
    const grid = (shape, cards, label) => h(`div.wt-grid.wt-grid--${shape}`, { role: 'list', 'aria-label': label }, cards);

    /* ================================================================
       the hero — the top of Continue Watching, big
       ================================================================ */
    function hero(it) {
      if (it.kind === 'anime') {
        const info = it.info;
        const title = info ? info.title : `MyAnimeList #${it.id}`;
        const img = info?.image;
        const meta = info
          ? [info.type, info.year, info.episodes ? plural(info.episodes, 'episode') : null, typeof info.score === 'number' ? `★ ${info.score.toFixed(2)}` : null, ...(info.genres || []).slice(0, 2)].filter(Boolean)
          : ['Anime'];
        const epLine = placeLine(it);
        const frac = placeFrac(it);
        const bg = h('div.wt-hero__bg', { style: { '--art': artFallback(`anime:${it.id}`) } },
          img ? h('img.wt-hero__bgimg', { src: img, alt: '', decoding: 'async', onerror: e => e.target.remove() }) : null);
        const poster = artBox('wt-art--poster.wt-hero__poster', { bg: artFallback(`anime:${it.id}`), img, mono: title });
        return h('section.wt-hero', { 'aria-label': `Continue watching: ${title}` },
          bg, h('div.wt-hero__scrim'),
          h('div.wt-hero__in',
            poster,
            h('div.wt-hero__text',
              h('div.wt-kicker', icon('play', { fill: true }), h('span', { text: 'Continue watching · Anime' })),
              h('h2.wt-hero__t', { text: title }),
              h('div.wt-hero__meta', { text: meta.join(' · ') }),
              info?.syn ? h('p.wt-hero__syn', { text: excerpt(info.syn, 240) })
                : !info ? h('p.wt-hero__syn', { text: 'Its title and poster come from the anime catalogue, which isn’t loaded yet.' }) : null,
              h('div.wt-hero__prog',
                frac > 0 ? h('span.wt-meter', { role: 'progressbar', 'aria-label': epLine, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(clamp01(frac) * 100)) },
                  h('i', { style: { width: `${Math.max(3, Math.round(clamp01(frac) * 100))}%` } })) : null,
                h('span', { text: `${epLine} · ${fmt.fmtAgo(it.at)}` })),
              h('p.wt-hero__note', { text: placeNote(it) }),
              h('div.wt-hero__acts',
                h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'hero:go' }, onclick: () => openAnime(it.id, info?.title, it.ep) },
                  icon('play', { fill: true }), h('span', { text: placeAction(it) })),
                canNext(it) ? h('button.btn', { type: 'button', dataset: { fk: 'hero:next' }, onclick: () => nextEpisode(it.id, title) },
                  icon('skip-forward'), h('span', { text: 'Next episode' })) : null,
                !info && !animeReady()
                  ? h('button.btn', { type: 'button', dataset: { fk: 'hero:load' }, disabled: A.state === 'loading', onclick: loadAnimeNow },
                    A.state === 'loading' ? h('span.spinner') : icon('download'), h('span', { text: A.state === 'loading' ? 'Loading…' : 'Load details' }))
                  : null,
                h('button.btn.wt-hero__more', { type: 'button', 'aria-label': `More for ${title}`, 'aria-haspopup': 'menu', dataset: { fk: 'hero:more' },
                  onclick: e => menuAt(e.currentTarget, animeMenu(it.id, info, it)) }, icon('more-horizontal'))))));
      }
      if (it.kind === 'film') {
        const d = dFilm(it), p = it.p, posLine = `${fmtTime(p.t)} of ${fmtTime(p.d)}`;
        return h('section.wt-hero.wt-hero--video', { 'aria-label': `Continue watching: ${it.title}` },
          h('div.wt-hero__bg', { style: { '--art': artFallback(`film:${it.id}`) } }), h('div.wt-hero__scrim'),
          h('div.wt-hero__in',
            (d.art.classList.add('wt-hero__shot'), d.art),
            h('div.wt-hero__text',
              h('div.wt-kicker', icon('play', { fill: true }), h('span', { text: 'Continue watching · Free film' })),
              h('h2.wt-hero__t', { text: it.title }),
              h('div.wt-hero__meta', { text: `From archive.org · ${fmtLen(p.d)}` }),
              h('div.wt-hero__prog',
                h('span.wt-meter', { role: 'progressbar', 'aria-label': `Stopped at ${posLine}`, 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(p.d)), 'aria-valuenow': String(Math.round(p.t)) },
                  h('i', { style: { width: `${Math.max(3, Math.round(clamp01(p.t / p.d) * 100))}%` } })),
                h('span', { text: `${posLine} · ${fmt.fmtAgo(p.at)}` })),
              h('div.wt-hero__acts',
                h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'hero:go' }, onclick: () => openFilm(it.id, it.title) },
                  icon('play', { fill: true }), h('span', { text: `Resume at ${fmtTime(p.t)}` }))))));
      }
      /* one of your videos */
      const n = it.node, p = it.p;
      const title = stemOf(n.name);
      const where = tilde(vfs.parentPath(it.path));
      const bg = h('div.wt-hero__bg', { style: { '--art': artFallback(`video:${it.ref}`) } });
      frameBg(bg, n);
      const shot = h('div.wt-art.wt-art--video.wt-hero__shot');
      fillFrame(shot, n, null);
      const posLine = `${fmtTime(p.t)} of ${fmtTime(p.d)}`;
      return h('section.wt-hero.wt-hero--video', { 'aria-label': `Continue watching: ${title}` },
        bg, h('div.wt-hero__scrim'),
        h('div.wt-hero__in',
          shot,
          h('div.wt-hero__text',
            h('div.wt-kicker', icon('play', { fill: true }), h('span', { text: 'Continue watching · Your video' })),
            h('h2.wt-hero__t', { text: title }),
            h('div.wt-hero__meta', { text: [where, fmtLen(p.d), n.size ? fmt.fmtBytes(n.size) : null].filter(Boolean).join(' · ') }),
            h('div.wt-hero__prog',
              h('span.wt-meter', { role: 'progressbar', 'aria-label': `Stopped at ${posLine}`, 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(p.d)), 'aria-valuenow': String(Math.round(p.t)) },
                h('i', { style: { width: `${Math.max(3, Math.round(clamp01(p.t / p.d) * 100))}%` } })),
              h('span', { text: `${posLine} · ${fmt.fmtAgo(p.at)}` })),
            h('div.wt-hero__acts',
              h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'hero:go' }, onclick: () => openVideo(it.path, { resume: true }) },
                icon('play', { fill: true }), h('span', { text: `Resume at ${fmtTime(p.t)}` })),
              h('button.btn', { type: 'button', dataset: { fk: 'hero:start' }, onclick: () => openVideo(it.path) }, icon('rotate-ccw'), h('span', { text: 'From the start' })),
              h('button.btn.wt-hero__more', { type: 'button', 'aria-label': `More for ${title}`, 'aria-haspopup': 'menu', dataset: { fk: 'hero:more' },
                onclick: e => menuAt(e.currentTarget, videoMenu(it.path, n, p)) }, icon('more-horizontal'))))));
    }

    function welcomeHero(V) {
      const bits = [];
      if (V.files.length) bits.push(`${plural(V.files.length, 'video')} of yours`);
      if (movies) {
        const shows = movies.items.filter(isShow).length;
        if (shows) bits.push(plural(shows, 'show'));
        if (movies.items.length - shows) bits.push(plural(movies.items.length - shows, 'film'));
      }
      if (animeReady()) bits.push(`${nf(animeMod.peek('anime').length)} anime`);
      return h('section.wt-hero.wt-hero--welcome', { 'aria-label': 'Static Watch' },
        h('div.wt-hero__bg.wt-hero__bg--glow'),
        h('div.wt-hero__in',
          h('div.wt-hero__glyph', { 'aria-hidden': 'true' }, icon('play', { fill: true })),
          h('div.wt-hero__text',
            h('div.wt-kicker', h('span', { text: 'Static Watch' })),
            h('h2.wt-hero__t', { text: 'Nothing in progress yet' }),
            h('p.wt-hero__syn', { text: 'Open an episode in Static Anime, or stop one of your videos partway through, and it waits for you right here.' }),
            bits.length ? h('div.wt-hero__meta', { text: `On this computer: ${bits.join(' · ')}` }) : null,
            h('div.wt-hero__acts',
              movies && movies.items.some(isShow) ? h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'hero:shows' }, onclick: () => go('shows') }, icon('monitor'), h('span', { text: 'Browse shows' })) : null,
              V.files.length ? h('button.btn', { type: 'button', dataset: { fk: 'hero:videos' }, onclick: () => go('videos') }, icon('folder'), h('span', { text: 'Your videos' })) : null,
              h('button.btn', { type: 'button', dataset: { fk: 'hero:anime' }, onclick: () => go('anime') }, icon('star'), h('span', { text: animeReady() ? 'Browse anime' : 'Load anime' }))))));
    }

    /* ================================================================
       sections
       ================================================================ */
    function paintHome(V) {
      const cont = V.cont;
      content.append(cont.length ? hero(cont[0]) : welcomeHero(V));
      const body = h('div.wt-pad.wt-stack');
      content.append(body);

      if (cont.length > 1) {
        put(body, row({ key: 'cont', title: 'Continue watching', ic: 'play', count: plural(cont.length, 'title'), more: 'continue', shape: 'land',
          cards: cont.slice(1, RAIL_LEN + 1).map(it => card('land', it.kind === 'anime' ? dAnime(it.id, it.info, it, { shape: 'land' }) : it.kind === 'film' ? dFilm(it, { shape: 'land' }) : dVideo(it.path, it.node, it.p, { shape: 'land' }), 'cont')) }));
      }
      const wl = V.wl;
      if (wl.items.length) {
        put(body, row({ key: 'wl', title: 'Your watchlist', ic: 'bookmark', count: plural(wl.items.length, 'title'), more: 'watchlist',
          cards: wl.items.slice(0, RAIL_LEN).map(it => card('poster', it.kind === 'anime' ? dAnime(it.id, it.info, null) : dMovie(it.m), 'wl')) }));
      }
      const recent = historyCards(V, 12);
      if (recent.length) put(body, row({ key: 'hist', title: 'Opened here recently', ic: 'clock', more: 'history', shape: 'land', cards: recent }));

      if (V.files.length) {
        put(body, row({ key: 'vid', title: 'Your videos', ic: 'folder', count: plural(V.files.length, 'video'), more: 'videos', shape: 'video',
          cards: V.files.slice(0, RAIL_LEN).map(f => card('video', dVideo(f.path, f.node, V.D.videos[f.node.content]), 'vid')) }));
      }

      if (movies) {
        const shows = movies.items.filter(isShow);
        const films = movies.items.filter(m => !isShow(m));
        if (shows.length) put(body, row({ key: 'shows', title: 'Shows', ic: 'monitor', count: plural(shows.length, 'series', 'series'), note: 'by rating', more: 'shows', cards: shows.slice(0, RAIL_LEN).map(m => card('poster', dMovie(m), 'shows')) }));
        if (films.length) put(body, row({ key: 'films', title: 'Movies', ic: 'film', count: plural(films.length, 'film'), note: 'by rating', more: 'movies', cards: films.slice(0, RAIL_LEN).map(m => card('poster', dMovie(m), 'films')) }));
      } else if (M.state === 'error') {
        body.append(errorState('The film catalogue didn’t answer', M.err, () => { M.state = 'idle'; startMoviesLoad(); paint(); }));
      } else {
        body.append(loadingState('Reading the film catalogue…'));
      }

      if (animeReady()) {
        const rails = animeMod.rails('anime');
        const top = rails.find(r => r.id === 'top') || rails[0];
        if (top) put(body, row({ key: 'anime', title: 'Top rated anime', ic: 'star', note: 'by MyAnimeList score', more: 'anime', cards: top.items.slice(0, RAIL_LEN).map(r => card('poster', dAnime(r.id, infoOfRec(r), null), 'anime')) }));
      } else {
        body.append(animeLoadCard('home'));
      }
      body.append(h('p.wt-foot', { text: 'Your watchlist, history and video positions are kept on this device only. Nothing here is fetched from an account.' }));
    }

    function animeLoadCard(where) {
      const loading = A.state === 'loading';
      return h('section.wt-loadcard', { 'aria-label': 'Anime catalogue' },
        h('div.wt-loadcard__ic', { 'aria-hidden': 'true' }, icon('star')),
        h('div.grow',
          h('b', { text: A.state === 'error' ? 'The anime catalogue didn’t load' : 'Anime' }),
          h('small', { text: A.state === 'error' ? A.err : `The anime catalogue is a big download (${ANIME_WEIGHT}), so it loads only when you ask.` })),
        h('button.btn.btn--sm.btn--primary', { type: 'button', disabled: loading, dataset: { fk: `load:${where}` }, onclick: loadAnimeNow },
          loading ? h('span.spinner') : icon(A.state === 'error' ? 'refresh' : 'download'),
          h('span', { text: loading ? 'Loading…' : A.state === 'error' ? 'Try again' : 'Load anime' })));
    }

    function historyCards(V, limit) {
      const out = [];
      for (const r of V.D.history) {
        if (out.length >= limit) break;
        if (r.k === 'anime') out.push(card('land', dAnime(r.id, animeInfo(r.id, V) || (r.title ? { title: r.title } : null), null, { shape: 'land' }), 'hist'));
        else if (r.k === 'movie') {
          const m = movieById(r.id) || (r.title ? { id: r.id, title: r.title } : null);
          if (m) out.push(card('land', dMovie(m, { shape: 'land' }), 'hist'));
        } else if (r.k === 'film') {
          out.push(card('land', dFilm({ id: r.id, title: r.title || r.id, p: V.films[r.id] }, { shape: 'land' }), 'hist'));
        } else if (r.k === 'video') {
          const hit = V.refs.get(r.id);
          if (hit) out.push(card('land', dVideo(hit.path, hit.node, V.D.videos[r.id], { shape: 'land' }), 'hist'));
        }
      }
      return out;
    }

    /* ---------- Continue Watching ---------- */
    function paintContinue(V) {
      const pad = h('div.wt-pad');
      content.append(pad);
      pad.append(h('p.wt-lede', { text: 'Anime you opened or marked an episode of in Static Anime, and your own videos (20 seconds or longer) that you stopped partway through. Most recent first. Each says whether StaticOS knows the minute you stopped at, or only the episode.' }));
      if (!V.cont.length) {
        pad.append(empty('play', 'Nothing in progress',
          'Open an episode on a title’s page in Static Anime, or stop one of your videos partway through, and it shows up here.',
          btn('Your videos', 'folder', () => go('videos'), '', { dataset: { fk: 'e:videos' } }),
          btn(animeReady() ? 'Browse anime' : 'Load anime', 'star', () => go('anime'), '', { dataset: { fk: 'e:anime' } })));
        return;
      }
      if (V.cont.some(it => it.kind === 'anime' && !it.info) && !animeReady()) pad.append(animeLoadCard('cont'));
      pad.append(h('div.wt-list', { role: 'list', 'aria-label': 'Continue watching' }, V.cont.map(it => contRow(it))));
    }

    function contRow(it) {
      let d, kindLabel, kindIc, line, frac, primary, secondary = null, honest = '';
      if (it.kind === 'anime') {
        d = dAnime(it.id, it.info, it, { shape: 'land' });
        kindLabel = 'Anime'; kindIc = 'star';
        line = `${placeLine(it)} · ${fmt.fmtAgo(it.at)}`;
        honest = placeNote(it);
        frac = placeFrac(it);
        primary = btn(placeAction(it), 'play', () => openAnime(it.id, it.info?.title, it.ep), '.btn--primary', { dataset: { fk: `cr:go:${d.key}` } });
        if (canNext(it)) secondary = btn('Next episode', 'skip-forward', () => nextEpisode(it.id, d.title), '.btn--ghost', { dataset: { fk: `cr:next:${d.key}` } });
      } else if (it.kind === 'film') {
        d = dFilm(it, { shape: 'land' });
        kindLabel = 'Free film · archive.org'; kindIc = 'film';
        line = `Stopped at ${fmtTime(it.p.t)} of ${fmtTime(it.p.d)} · ${fmt.fmtAgo(it.p.at)}`;
        frac = it.p.t / it.p.d;
        primary = btn(`Resume at ${fmtTime(it.p.t)}`, 'play', () => openFilm(it.id, it.title), '.btn--primary', { dataset: { fk: `cr:go:${d.key}` } });
      } else {
        d = dVideo(it.path, it.node, it.p, { shape: 'land' });
        kindLabel = `Your video · ${tilde(vfs.parentPath(it.path))}`; kindIc = 'folder';
        line = `Stopped at ${fmtTime(it.p.t)} of ${fmtTime(it.p.d)} · ${fmt.fmtAgo(it.p.at)}`;
        frac = it.p.t / it.p.d;
        primary = btn(`Resume at ${fmtTime(it.p.t)}`, 'play', () => openVideo(it.path, { resume: true }), '.btn--primary', { dataset: { fk: `cr:go:${d.key}` } });
        secondary = btn('From the start', 'rotate-ccw', () => openVideo(it.path), '.btn--ghost', { dataset: { fk: `cr:start:${d.key}` } });
      }
      return h('article.wt-crow', { role: 'listitem', 'aria-label': d.title, oncontextmenu: e => menuFromEvent(e, d.menu()) },
        h('button.wt-crow__art', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', onclick: d.open }, d.art),
        h('div.wt-crow__body',
          h('div.wt-crow__k', icon(kindIc), h('span', { text: kindLabel })),
          h('h3.wt-crow__t', { text: d.title }),
          h('div.wt-crow__m', { text: line }),
          honest ? h('div.wt-crow__note', { text: honest }) : null,
          frac ? h('span.wt-meter.wt-meter--sm', { 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(3, Math.round(clamp01(frac) * 100))}%` } })) : null,
          h('div.wt-crow__acts', primary, secondary,
            h('button.ibtn', { type: 'button', 'aria-label': `More for ${d.title}`, 'aria-haspopup': 'menu', dataset: { fk: `cr:more:${d.key}` },
              onclick: e => menuAt(e.currentTarget, d.menu()) }, icon('more-horizontal')))));
    }

    /* ---------- Watchlist ---------- */
    function paintWatchlist(V) {
      const pad = h('div.wt-pad');
      content.append(pad);
      const wl = V.wl;
      const counts = { all: wl.items.length, anime: 0, movie: 0, show: 0 };
      for (const it of wl.items) counts[it.kind]++;
      if (!wl.items.length && !wl.manga && !wl.pending) {
        pad.append(empty('bookmark', 'Your watchlist is empty',
          'Save a film, a show or an anime from its menu here — or from its page in the Browser or Static Anime — and it waits here.',
          movies && movies.items.some(isShow) ? btn('Browse shows', 'monitor', () => go('shows'), '.btn--primary', { dataset: { fk: 'e:shows' } }) : null,
          btn(animeReady() ? 'Browse anime' : 'Load anime', 'star', () => go('anime'), '', { dataset: { fk: 'e:anime' } })));
        return;
      }
      if (S.wlFilter !== 'all' && !counts[S.wlFilter]) S.wlFilter = 'all';
      const chip = (id, label) => h('button.wt-chip', {
        type: 'button', 'aria-pressed': String(S.wlFilter === id), class: S.wlFilter === id ? 'is-on' : null, dataset: { fk: `wlf:${id}` },
        onclick: () => { S.wlFilter = id; paint(); },
      }, h('span', { text: label }), h('small', { text: nf(counts[id]) }));
      pad.append(h('div.wt-chips', { role: 'group', 'aria-label': 'Show' },
        chip('all', 'All'), counts.anime ? chip('anime', 'Anime') : null, counts.movie ? chip('movie', 'Movies') : null, counts.show ? chip('show', 'Shows') : null));
      if (wl.items.some(it => it.kind === 'anime' && !it.info) && !animeReady()) pad.append(animeLoadCard('wl'));
      if (wl.pending) pad.append(loadingState('Reading the film catalogue…'));
      const shown = wl.items.filter(it => S.wlFilter === 'all' || it.kind === S.wlFilter);
      if (shown.length) pad.append(grid('poster', shown.map(it => card('poster', it.kind === 'anime' ? dAnime(it.id, it.info, null) : dMovie(it.m), 'wlg')), 'Your watchlist'));
      const notes = [];
      if (wl.manga) notes.push(h('div.wt-banner', icon('info'),
        h('span.grow', { text: `${plural(wl.manga, 'manga title')} on your watchlist ${wl.manga === 1 ? 'is' : 'are'} for reading, so ${wl.manga === 1 ? 'it lives' : 'they live'} in Static Anime.` }),
        api.getApp('aether-anime') ? btn('Open manga watchlist', 'external-link', () => api.openApp('aether-anime', { url: 'static://manga?view=watchlist' }), '', { dataset: { fk: 'wl:manga' } }) : null));
      if (wl.missing) notes.push(banner('alert', `${plural(wl.missing, 'saved title')} ${wl.missing === 1 ? 'isn’t' : 'aren’t'} in any catalogue this build has, so ${wl.missing === 1 ? 'it can’t' : 'they can’t'} be shown.`));
      if (notes.length) pad.append(h('div.wt-notes', notes));
    }

    /* ---------- History ---------- */
    function paintHistory(V) {
      const pad = h('div.wt-pad');
      content.append(pad);
      const rows = V.D.history;
      if (!rows.length) {
        pad.append(empty('clock', 'Nothing opened here yet', 'Titles and videos you open from Static Watch are listed here, newest first. The list stays on this device.'));
        return;
      }
      let cur = null, list = null;
      for (const r of rows) {
        const label = dayLabel(r.at || 0);
        if (label !== cur) {
          cur = label;
          list = h('div.wt-hlist', { role: 'list', 'aria-label': label });
          pad.append(h('section.wt-day', h('h3.wt-day__h', { text: label }), list));
        }
        list.append(histRow(r, V));
      }
    }

    function histRow(r, V) {
      let title = r.title, sub = '', art, open = null;
      if (r.k === 'anime') {
        const info = animeInfo(r.id, V);
        title = info?.title || r.title || `MyAnimeList #${r.id}`;
        sub = 'Anime';
        art = artBox('wt-art--thumb', { bg: artFallback(`anime:${r.id}`), img: info?.image, mono: title, pos: '50% 22%' });
        open = () => openAnime(r.id, title);
      } else if (r.k === 'movie') {
        const m = movieById(r.id) || { id: r.id, title: r.title || r.id };
        title = m.title;
        sub = movies && movieById(r.id) ? (isShow(m) ? 'Show' : 'Film') : 'Film or show';
        art = artBox('wt-art--thumb.wt-art--made', { bg: movieArt(m), mono: title });
        open = () => openMovie(m);
      } else if (r.k === 'film') {
        title = r.title || r.id;
        sub = 'Free film · archive.org';
        art = artBox('wt-art--thumb', { bg: artFallback(`film:${r.id}`), img: filmPoster(r.id), mono: title });
        open = () => openFilm(r.id, title);
      } else {
        const hit = V.refs.get(r.id);
        title = hit ? hit.node.name : (r.title || 'A video');
        sub = hit ? `Your video · ${tilde(vfs.parentPath(hit.path))}` : 'No longer in your files';
        art = h('div.wt-art.wt-art--thumb');
        if (hit) fillFrame(art, hit.node, null); else art.append(h('span.wt-art__ph', icon('film')));
        open = hit ? () => openVideo(hit.path) : null;
      }
      return h('div.wt-hrow', { role: 'listitem' },
        h('button.wt-hrow__main', {
          type: 'button', disabled: !open, onclick: open,
          'aria-label': `${title}, ${sub}, opened ${clockOf(r.at)}`, dataset: { fk: `h:${r.k}:${r.id}` },
        }, art, h('span.wt-hrow__text', h('b', { text: title }), h('small', { text: sub })), h('span.wt-hrow__time', { text: clockOf(r.at) })),
        h('button.ibtn', { type: 'button', 'aria-label': `Remove ${title} from history`, dataset: { fk: `hx:${r.k}:${r.id}` }, onclick: () => forgetHistory(r) }, icon('x')));
    }

    /* ---------- Movies / Shows ---------- */
    function paintCatalog(which) {
      const pad = h('div.wt-pad');
      content.append(pad);
      if (!movies) {
        pad.append(M.state === 'error'
          ? errorState('The film catalogue didn’t answer', M.err, () => { M.state = 'idle'; startMoviesLoad(); paint(); })
          : loadingState('Reading the film catalogue…'));
        return;
      }
      const shows = which === 'shows';
      const st = shows ? S.sh : S.mv;
      const all = movies.items.filter(m => isShow(m) === shows);
      if (!all.length) {
        pad.append(empty(shows ? 'monitor' : 'film', shows ? 'No shows in this catalogue' : 'No films in this catalogue',
          shows ? 'The catalogue StaticOS carries has no series or TV entries right now. Anime series are under Anime.' : 'The catalogue StaticOS carries has no films right now.'));
        return;
      }
      pad.append(banner('info', moviesSourceNote()));
      const genres = [...new Set(all.flatMap(m => arr(m.genres)))].sort();
      if (st.genre && !genres.includes(st.genre)) st.genre = '';
      const chip = (g, label) => h('button.wt-chip', {
        type: 'button', 'aria-pressed': String(st.genre === g), class: st.genre === g ? 'is-on' : null, dataset: { fk: `g:${which}:${g || 'all'}` },
        onclick: () => { st.genre = g; paint(); },
      }, h('span', { text: label }));
      if (genres.length > 1) pad.append(h('div.wt-chips', { role: 'group', 'aria-label': 'Genre' }, chip('', 'All'), genres.map(g => chip(g, g))));
      const by = {
        rating: (a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) || a.title.localeCompare(b.title),
        newest: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || a.title.localeCompare(b.title),
        az: (a, b) => a.title.localeCompare(b.title),
      };
      const list = all.filter(m => !st.genre || arr(m.genres).includes(st.genre)).sort(by[st.sort] || by.rating);
      pad.append(grid('poster', list.map(m => card('poster', dMovie(m), which)), shows ? 'Shows' : 'Movies'));
      if (shows) pad.append(h('p.wt-foot', { text: 'Anime series live under Anime, with the rest of the anime catalogue.' }));
    }

    /* ---------- Anime ---------- */
    function paintAnime(V) {
      const pad = h('div.wt-pad');
      content.append(pad);
      if (!animeReady()) {
        if (A.state === 'idle') startAnimeLoad();       /* opening this section is what loads it */
        if (A.state === 'error') {
          pad.append(errorState('The anime catalogue didn’t load', A.err, () => { A.state = 'idle'; loadAnimeNow(); }));
        } else {
          pad.append(loadingState('Loading the anime catalogue…', `It’s ${ANIME_WEIGHT}, so this can take a moment the first time. StaticOS tries the live catalogue first, then the copy that ships with it.`));
        }
        return;
      }
      const f = animeMod.facts('anime');
      pad.append(h('div.wt-facts', { role: 'note' },
        icon('info'),
        h('span', { text: `${nf(f.rows)} titles from ${f.source === 'remote' ? 'the live catalogue' : 'the copy that ships with StaticOS'} · MyAnimeList metadata. Episodes open in each title’s player in Static Anime, which remembers where you left off.` }),
        h('div.grow'),
        api.getApp('aether-anime') ? btn('Open Static Anime', 'external-link', () => api.openApp('aether-anime', {}), '.btn--ghost', { dataset: { fk: 'an:open' } }) : null));

      const genres = animeMod.topGenres('anime', 12);
      if (S.an.genre && !animeMod.genresOf('anime').some(g => g.id === S.an.genre)) S.an.genre = '';
      const chip = (g, label, n) => h('button.wt-chip', {
        type: 'button', 'aria-pressed': String(S.an.genre === g), class: S.an.genre === g ? 'is-on' : null, dataset: { fk: `ag:${g || 'all'}` },
        onclick: () => { S.an.genre = g; S.an.shown = GRID_STEP; paint({ top: true }); },
      }, h('span', { text: label }), n ? h('small', { text: nf(n) }) : null);
      pad.append(h('div.wt-chips', { role: 'group', 'aria-label': 'Genre' }, chip('', 'Featured'), genres.map(g => chip(g.id, g.name, g.n))));

      if (S.an.genre) {
        const res = animeMod.query({ kind: 'anime', genre: S.an.genre, sort: S.an.sort, perPage: S.an.shown, page: 1 });
        pad.append(grid('poster', res.items.map(r => card('poster', dAnime(r.id, infoOfRec(r), animeProgOf(V, r.id)), 'ang')), `${S.an.genre} anime`));
        pad.append(h('div.wt-more',
          h('span.dim', { text: `Showing ${nf(res.items.length)} of ${nf(res.total)}` }),
          res.total > res.items.length ? btn('Show more', 'chevron-down', () => { S.an.shown += GRID_STEP; paint(); }, '', { dataset: { fk: 'an:more' } }) : null));
        return;
      }
      const mine = [];
      const seen = new Set();
      for (const it of V.cont) if (it.kind === 'anime' && it.info && !seen.has(it.id)) { seen.add(it.id); mine.push(card('poster', dAnime(it.id, it.info, it), 'anmine')); }
      for (const it of V.wl.items) if (it.kind === 'anime' && it.info && !seen.has(it.id)) { seen.add(it.id); mine.push(card('poster', dAnime(it.id, it.info, null), 'anmine')); }
      const stack = h('div.wt-stack');
      pad.append(stack);
      if (mine.length) put(stack, row({ key: 'anmine', title: 'Yours', ic: 'bookmark', note: 'in progress and saved', cards: mine }));
      const NOTES = { airing: 'still airing, per the catalogue', top: 'by MyAnimeList score', recent: 'by year' };
      for (const r of animeMod.rails('anime')) {
        put(stack, row({ key: `an:${r.id}`, title: r.title, ic: r.icon || 'star', note: NOTES[r.id] || 'by score',
          cards: r.items.slice(0, RAIL_LEN).map(rec => card('poster', dAnime(rec.id, infoOfRec(rec), animeProgOf(V, rec.id)), `an:${r.id}`)) }));
      }
    }
    const animeProgOf = (V, id) => ((`anime:${id}` in V.prog || `anime:${id}` in V.res) ? placeOf(id) : null);

    /* ---------- Saved Videos ---------- */
    function paintVideos(V) {
      const pad = h('div.wt-pad');
      content.append(pad);
      if (!V.files.length) {
        pad.append(empty('film', 'No videos in ~/Videos or ~/Downloads',
          'Import a video and it lands in ~/Videos, where Videos plays it.',
          btn('Import videos…', 'upload', () => fileIn.click(), '.btn--primary', { dataset: { fk: 'e:import' } }),
          api.getApp('files') ? btn('Open Files', 'folder-open', () => api.openApp('files', { path: `${HOME}/Videos` }), '', { dataset: { fk: 'e:files' } }) : null));
        return;
      }
      const groups = new Map();
      for (const f of V.files) (groups.get(f.dir) || groups.set(f.dir, []).get(f.dir)).push(f);
      for (const [dir, list] of groups) {
        pad.append(h('section.wt-group', { 'aria-label': vfs.baseName(dir) },
          h('div.wt-group__head',
            h('span.wt-group__ic', icon('folder')),
            h('h3.wt-group__t', { text: vfs.baseName(dir) }),
            h('span.wt-group__path', { text: tilde(dir) }),
            h('span.wt-group__n', { text: nf(list.length) })),
          grid('video', list.map(f => card('video', dVideo(f.path, f.node, V.D.videos[f.node.content]), 'vg')), vfs.baseName(dir))));
      }
      pad.append(h('p.wt-foot', { text: 'These play in Videos. Watch remembers where you stopped in anything 20 seconds or longer; shorter clips just start again.' }));
    }

    /* ---------- Search ---------- */
    function paintSearch(V) {
      const pad = h('div.wt-pad');
      content.append(pad);
      const q = S.q.toLowerCase();
      const hay = m => [m.title, m.year, ...arr(m.genres)].join(' ').toLowerCase();
      const found = [];
      let total = 0;
      if (movies) {
        const shows = movies.items.filter(m => isShow(m) && hay(m).includes(q));
        const films = movies.items.filter(m => !isShow(m) && hay(m).includes(q));
        if (shows.length) found.push(['Shows', 'monitor', 'poster', shows.map(m => card('poster', dMovie(m), 'sq'))]);
        if (films.length) found.push(['Movies', 'film', 'poster', films.map(m => card('poster', dMovie(m), 'sq'))]);
        total += shows.length + films.length;
      }
      const vids = V.files.filter(f => f.node.name.toLowerCase().includes(q));
      if (vids.length) found.push(['Your videos', 'folder', 'video', vids.map(f => card('video', dVideo(f.path, f.node, V.D.videos[f.node.content]), 'sq'))]);
      total += vids.length;
      let animeTotal = 0;
      if (animeReady()) {
        const res = animeMod.query({ kind: 'anime', q: S.q, perPage: 24 });
        animeTotal = res.total;
        if (res.items.length) found.push([`Anime${res.total > res.items.length ? ` · top ${res.items.length} of ${nf(res.total)}` : ''}`, 'star', 'poster', res.items.map(r => card('poster', dAnime(r.id, infoOfRec(r), animeProgOf(V, r.id)), 'sq'))]);
        total += res.total;
      }
      if (!total) {
        pad.append(empty('search', 'No matches', `Nothing in Watch matches “${S.q}”.`,
          !animeReady() ? btn(A.state === 'loading' ? 'Loading anime…' : 'Search anime too', 'star', loadAnimeNow, '', { dataset: { fk: 'sq:load' }, disabled: A.state === 'loading' }) : null));
        return;
      }
      for (const [label, ic, shape, cards] of found) {
        pad.append(h('section.wt-sres', { 'aria-label': label },
          h('h3.wt-sres__h', icon(ic), h('span', { text: label })),
          grid(shape, cards, label)));
      }
      if (!animeReady()) pad.append(animeLoadCard('search'));
      else if (!animeTotal) pad.append(h('p.wt-foot', { text: 'No anime titles match.' }));
    }

    /* ================================================================
       chrome: sidebar, tabs, bar
       ================================================================ */
    function sideCount(id, V) {
      switch (id) {
        case 'continue': return V.cont.length || '';
        case 'watchlist': return V.wl.items.length || '';
        case 'history': return V.D.history.length || '';
        case 'movies': return movies ? movies.items.filter(m => !isShow(m)).length || '' : '';
        case 'shows': return movies ? movies.items.filter(isShow).length || '' : '';
        case 'anime': return animeReady() ? animeMod.peek('anime').length : '';
        case 'videos': return V.files.length || '';
        default: return '';
      }
    }

    function paintSide(V) {
      clear(sideEl);
      let group = null, last = '';
      for (const s of SECTIONS) {
        if (s.group !== last) {
          last = s.group;
          group = h('div.side__group', h('div.side__label', { text: s.group }));
          sideEl.append(group);
        }
        const on = !S.q && s.id === S.sec;
        const n = sideCount(s.id, V);
        group.append(h('button.side__item', {
          type: 'button', class: on ? 'is-on' : null, 'aria-current': on ? 'page' : null, dataset: { fk: `side:${s.id}` },
          onclick: () => go(s.id),
        }, icon(s.icon), h('span', { text: s.label }), n !== '' ? h('small', { text: nf(n) }) : null));
      }
      sideEl.append(h('div.wt-side__foot',
        h('div.side__meter',
          h('b', { text: 'On this device' }),
          h('small', { text: 'Watchlist, history and places are saved in this browser only.' }))));
    }
    sideEl.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...sideEl.querySelectorAll('.side__item')];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    });

    function paintTabs() {
      clear(tabsEl);
      tabsEl.hidden = !S.narrow;
      if (!S.narrow) return;
      for (const s of SECTIONS) {
        const on = !S.q && s.id === S.sec;
        tabsEl.append(h('button.wt-tab', {
          type: 'button', class: on ? 'is-on' : null, 'aria-current': on ? 'page' : null, dataset: { fk: `tab:${s.id}` },
          onclick: () => go(s.id),
        }, icon(s.icon), h('span', { text: s.label })));
      }
      cancelAnimationFrame(tabRaf);
      tabRaf = requestAnimationFrame(() => {
        tabRaf = 0;
        const on = tabsEl.querySelector('.is-on');
        if (on) tabsEl.scrollLeft = Math.max(0, on.offsetLeft - (tabsEl.clientWidth - on.offsetWidth) / 2);
      });
    }

    function sortSelect(value, options, onchange, label) {
      return h('select.select.wt-sort', { 'aria-label': label, dataset: { fk: `sort:${label}` }, onchange: e => onchange(e.target.value) },
        options.map(([v, text]) => h('option', { value: v, selected: v === value ? true : null, text })));
    }

    function paintBar(V) {
      clear(barEl);
      const sec = S.q ? { label: 'Search', icon: 'search' } : secOf(S.sec);
      let count = '';
      const tools = [];
      if (S.q) count = `for “${S.q}”`;
      else switch (S.sec) {
        case 'continue': count = V.cont.length ? `${nf(V.cont.length)} in progress` : ''; break;
        case 'watchlist': count = V.wl.items.length ? `${plural(V.wl.items.length, 'title')} saved` : ''; break;
        case 'history': {
          count = V.D.history.length ? `${nf(V.D.history.length)} opened here` : '';
          tools.push(btn('Clear history', 'trash', clearHistory, '.btn--ghost', { disabled: !V.D.history.length, dataset: { fk: 'bar:clear' } }));
          break;
        }
        case 'movies': case 'shows': {
          const shows = S.sec === 'shows';
          if (movies) {
            const n = movies.items.filter(m => isShow(m) === shows).length;
            count = n ? `${plural(n, shows ? 'series' : 'film', shows ? 'series' : 'films')} · details only` : '';
            if (n) {
              const st = shows ? S.sh : S.mv;
              tools.push(sortSelect(st.sort, [['rating', 'Top rated'], ['newest', 'Newest'], ['az', 'A–Z']], v => { st.sort = v; paint(); }, `Sort ${shows ? 'shows' : 'movies'}`));
            }
          }
          break;
        }
        case 'anime': {
          if (animeReady()) {
            count = `${nf(animeMod.peek('anime').length)} titles`;
            if (S.an.genre) tools.push(sortSelect(S.an.sort, arr(animeMod.SORT_OPTIONS).map(o => [o.id, o.name]), v => { S.an.sort = v; S.an.shown = GRID_STEP; paint(); }, 'Sort anime'));
          } else count = A.state === 'loading' ? 'loading…' : 'not loaded';
          break;
        }
        case 'videos': {
          const bytes = V.files.reduce((s, f) => s + (Number(f.node.size) || 0), 0);
          count = V.files.length ? `${plural(V.files.length, 'video')}${bytes ? ` · ${fmt.fmtBytes(bytes)}` : ''}` : '';
          tools.push(btn('Import…', 'upload', () => fileIn.click(), '.btn--ghost', { dataset: { fk: 'bar:import' } }));
          if (api.getApp('videos')) tools.push(btn('Open Videos', 'external-link', () => api.openApp('videos'), '.btn--ghost', { dataset: { fk: 'bar:videos' } }));
          break;
        }
        default: break;
      }
      put(barEl,
        h('h2.app__title.wt-bar__t', icon(sec.icon), h('span', { text: sec.label })),
        count ? h('span.wt-bar__n', { text: count }) : null,
        h('div.grow'),
        ...tools);
    }

    /* ================================================================
       paint — rebuilds the view, keeping focus and scroll where they were
       ================================================================ */
    function paint({ top = false } = {}) {
      if (S.dead) return;
      S.stale = false;
      if (animeReady()) refreshMeta();
      const active = document.activeElement;
      const hadFocus = !!active && active !== appEl && appEl.contains(active);
      const fk = hadFocus ? active.dataset?.fk || null : null;
      const scrollTop = top ? 0 : content.scrollTop;
      const rails = new Map();
      if (!top) for (const r of content.querySelectorAll('.wt-rail[data-rail]')) rails.set(r.dataset.rail, r.scrollLeft);

      const V = snapshot();
      appEl.classList.toggle('is-narrow', S.narrow);
      paintSide(V);
      paintTabs();
      paintBar(V);
      FM?.detach();
      clear(content);
      if (S.q) paintSearch(V);
      else switch (S.sec) {
        case 'continue': paintContinue(V); break;
        case 'watchlist': paintWatchlist(V); break;
        case 'history': paintHistory(V); break;
        case 'movies': paintCatalog('movies'); break;
        case 'shows': paintCatalog('shows'); break;
        case 'films': {
          const f = films();
          if (f) { content.append(f.el); f.attach(); break; }
          content.append(loadingState('Opening the film library…'));
          loadFilms().then(() => { if (!S.dead && S.sec === 'films') paint(); }).catch(() => { /* the section says nothing more; reopening retries */ });
          break;
        }
        case 'anime': paintAnime(V); break;
        case 'videos': paintVideos(V); break;
        default: paintHome(V);
      }
      content.scrollTop = scrollTop;
      for (const r of content.querySelectorAll('.wt-rail[data-rail]')) if (rails.has(r.dataset.rail)) r.scrollLeft = rails.get(r.dataset.rail);
      /* keyboard focus survives the rebuild: same control if it still exists,
         otherwise the content pane, never the page body */
      if (hadFocus && !appEl.contains(document.activeElement)) {
        const el = fk ? [...appEl.querySelectorAll('[data-fk]')].find(x => x.dataset.fk === fk) : null;
        try { (el && !el.disabled ? el : content).focus({ preventScroll: true }); } catch (e) { /* detached */ }
      }
      win.setSubtitle(S.q ? 'Search' : secOf(S.sec).label);
      measureRails();
    }
    /** a repaint that waits for the next frame (after an app has been opened) */
    function softPaint() {
      if (S.dead) return;
      if (win.el.classList.contains('is-active')) { paint(); return; }
      scheduleRepaint();
    }

    function measureRails() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (S.dead) return;
        for (const sec of content.querySelectorAll('.wt-row')) {
          const rail = sec.querySelector('.wt-rail');
          if (rail) sec.classList.toggle('is-over', rail.scrollWidth > rail.clientWidth + 8);
        }
      });
    }

    function go(sec) {
      const c = canonSec(sec);
      if (!c) return;
      const same = c === S.sec && !S.q;
      S.sec = c;
      if (S.q) { S.q = ''; findIn.value = ''; }
      paint({ top: !same });
    }

    /* ---------------- changes made elsewhere ----------------
       Another app (Static Anime marking an episode, Videos playing, a
       file import) changed something this view shows. Repainting while
       someone is using this window could swallow a click, so while it is
       the active window the change only marks the view stale, and the
       repaint happens as soon as focus moves elsewhere. */
    let extTimer = 0;
    function scheduleRepaint() {
      cancel(extTimer);
      extTimer = later(() => {
        /* focus may have come back in the meantime: then wait for the next blur */
        if (win.el.classList.contains('is-active')) { S.stale = true; return; }
        paint();
      }, 60);
    }
    function onExternal() {
      if (S.dead || S.self) return;
      if (S.sec === 'films' && !S.q && FM && FM.busy()) return;   /* a repaint would stop the film */
      if (win.el.classList.contains('is-active')) { S.stale = true; return; }
      scheduleRepaint();
    }
    offs.push(store.sub(KEY, onExternal));
    offs.push(store.sub(WL_KEY, onExternal));
    offs.push(store.sub(PROG_KEY, onExternal));
    offs.push(store.sub(RESUME_KEY, onExternal));
    offs.push(bus.on('fs:change', onExternal));
    offs.push(bus.on('media:change', onExternal));
    win.onBlur(() => { if (!S.dead && S.stale) scheduleRepaint(); });
    win.onReopen(o => {
      const c = canonSec(o?.section);
      if (typeof o?.q === 'string') { S.q = o.q.trim().slice(0, 80); findIn.value = S.q; }
      if (c) { S.sec = c; if (typeof o?.q !== 'string') { S.q = ''; findIn.value = ''; } }
      paint({ top: true });
    });

    /* '/' focuses the search, like the rest of the portal */
    const onKey = e => {
      if (!win.el.classList.contains('is-active') || e.defaultPrevented) return;
      const t = e.target;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) {
        e.preventDefault();
        findIn.focus();
        findIn.select();
      }
    };
    window.addEventListener('keydown', onKey);

    /* ---------------- importing videos ---------------- */
    fileIn.addEventListener('change', async () => {
      const picked = [...(fileIn.files || [])].filter(f => media.kindOf(f.type) === 'video' || media.kindOf(f.name) === 'video');
      fileIn.value = '';
      if (!picked.length) { note({ icon: 'info', title: 'No videos in that selection', message: 'Pick MP4, WebM or MOV files.' }); return; }
      try {
        const out = await media.importFiles(`${HOME}/Videos`, picked);
        note({ icon: 'film', title: `${plural(out.length, 'video')} added`, message: 'Saved to ~/Videos.' });
      } catch (err) {
        note({ icon: 'alert', title: 'Couldn’t import that', message: String(err?.message || err) });
      }
      if (!S.dead) paint();
    });

    /* ---------------- responsive: react to the real painted width ---------------- */
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect?.width || appEl.clientWidth;
        const n = w > 0 && w < NARROW;
        if (n !== S.narrow) { S.narrow = n; if (!S.dead) paint(); } else measureRails();
      });
      ro.observe(appEl);
    } else {
      S.narrow = (win.w || 1040) < NARROW;
    }

    /* ---------------- first paint ---------------- */
    startMoviesLoad();
    animeModule().then(() => {
      if (S.dead) return;
      if (animeReady()) { A.state = 'ready'; paint(); }
    }).catch(() => { /* the portal isn't available; the Anime section says so when opened */ });
    paint({ top: true });

    /* ---------------- teardown ---------------- */
    return () => {
      S.dead = true;
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(tabRaf);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      offs.splice(0).forEach(off => { try { off(); } catch (e) {} });
      window.removeEventListener('keydown', onKey);
      abortFrames();
      FM?.destroy();
      releaseEngine();
    };
  },
});
