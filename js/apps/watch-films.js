/* ============================================================
   watch-films.js — "Free films" inside Static Watch.

   A library of real films from the Internet Archive's public film
   collections (archive.org). Nothing here is a third-party stream
   embed and nothing is keyed by TMDB or IMDb ids.

     Browse / search   https://archive.org/advancedsearch.php (JSON, CORS: *)
     Details           https://archive.org/metadata/<id>      (JSON, CORS: *)
     Posters           https://archive.org/services/img/<id>  (an <img>, no CORS needed)
     Stream            <video src="https://archive.org/download/<id>/<file>.mp4">.
                       A plain media element needs no CORS and the server answers
                       Range requests (302 to a data node, then 206), so seeking works.
     Subtitles/Save    archive.org/download sends NO CORS header, so a script cannot
                       read those bytes. https://archive.org/cors/<id>/<file> is the
                       same file with CORS (it ignores Range, which is fine for a
                       whole-file read). That is what Save to Videos and subtitle
                       loading use. If it is ever blocked, the UI says so and offers
                       the browser's own download.

   What is shown is only what archive.org returned: year, runtime, the
   uploader's description and licence, download counts and the average
   rating (with its review count). Where the uploader gave no licence
   the card says "Rights not stated by the uploader" — it never claims
   public domain on its own.

   Content filter: items whose collection, subject or title carry adult
   labels are dropped, both in the search query and again on what comes
   back. It is a filter on uploader labels, not a guarantee.

   Positions are kept under portal.watchfilms and read by watch.js for
   Continue Watching and the Finished shelf and stats:
     pos     { id: {t,d,at,title,year} }      where you stopped
     done    { id: {d,at,title,year} }        films you watched to the end
     saved   { id: {path,name,at,size} }      copies in ~/Videos
     later   { id: {title,year,at} }          the "Saved for later" heart
     hidden  { id: {title,year,at} }          "Hide this film"
     queue   [ {id,title,year} ]              the double feature
     usersubs{ id: {name,text,at} }           a subtitle file you added
   Nothing in it is made up: each entry is something you did.
   ============================================================ */

import * as media from '../core/media.js';

/* not under portal.watch: watch.js rewrites that whole object and would drop it */
export const FILMS_KEY = 'portal.watchfilms';
const IA = 'https://archive.org';
const PAGE = 36;
const SAVE_EVERY = 8000;
const MIN_LEN = 20;

export const COLLECTIONS = [
  { id: 'all', label: 'All film collections', q: ['feature_films', 'silent_films', 'SciFi_Horror', 'Film_Noir', 'Comedy_Films', 'animationandcartoons'] },
  { id: 'feature_films', label: 'Feature films', q: ['feature_films'] },
  { id: 'silent_films', label: 'Silent films', q: ['silent_films'] },
  { id: 'SciFi_Horror', label: 'Sci-fi and horror', q: ['SciFi_Horror'] },
  { id: 'Film_Noir', label: 'Film noir', q: ['Film_Noir'] },
  { id: 'Comedy_Films', label: 'Comedy', q: ['Comedy_Films'] },
  { id: 'animationandcartoons', label: 'Cartoons and animation', q: ['animationandcartoons'] },
];
export const GENRES = ['Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Romance', 'Western', 'Crime', 'Mystery', 'Adventure', 'War', 'Musical', 'Fantasy', 'Documentary', 'Animation'];
const GENRE_Q = { 'Sci-Fi': '("sci-fi" OR "science fiction" OR scifi)' };
export const DECADES = [1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
export const LANGS = [['english', 'English'], ['french', 'French'], ['german', 'German'], ['spanish', 'Spanish'], ['italian', 'Italian'], ['russian', 'Russian'], ['japanese', 'Japanese']];
const LANG_Q = { english: '(english OR eng OR en)', french: '(french OR fra OR fre OR fr)', german: '(german OR deu OR ger OR de)', spanish: '(spanish OR spa OR es)', italian: '(italian OR ita OR it)', russian: '(russian OR rus OR ru)', japanese: '(japanese OR jpn OR ja)' };
/* archive.org writes runtimes as free text, so this filter is applied to what came back, not in the query */
export const RUNTIMES = [['short', 'Under 40 min', s => s < 2400], ['feature', '40 min to 2 h', s => s >= 2400 && s <= 7200], ['long', 'Over 2 h', s => s > 7200]];
/* shelves: a collection, optionally narrowed to a genre, one press away */
export const SHELVES = [
  { id: 'silent', label: 'Silent films', collection: 'silent_films', genre: '' },
  { id: 'noir', label: 'Film noir', collection: 'Film_Noir', genre: '' },
  { id: 'scifi', label: 'Sci-fi and horror', collection: 'SciFi_Horror', genre: '' },
  { id: 'comedy', label: 'Comedy', collection: 'Comedy_Films', genre: '' },
  { id: 'cartoons', label: 'Cartoons', collection: 'animationandcartoons', genre: '' },
  { id: 'westerns', label: 'Westerns', collection: 'all', genre: 'Western' },
  { id: 'docs', label: 'Documentaries', collection: 'all', genre: 'Documentary' },
];
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const SORTS = [
  { id: 'downloads', label: 'Most downloaded', q: 'downloads desc' },
  { id: 'rating', label: 'Top rated', q: 'avg_rating desc' },
  { id: 'oldest', label: 'Oldest first', q: 'year asc' },
];
const FIELDS = ['identifier', 'title', 'year', 'downloads', 'avg_rating', 'num_reviews', 'subject', 'licenseurl', 'rights', 'collection', 'runtime', 'description', 'creator'];

/* ---------------- the content filter ---------------- */
const ADULT_WORDS = 'adult|adults only|erotica|erotic|xxx|porn|porno|pornography|nude|nudes|nudity|nudist|nudists|naturism|naturist|sexploitation|sex|sexy|striptease|fetish|hentai|nsfw|molester|molest';
const ADULT_RE = new RegExp(`(^|[^a-z])(${ADULT_WORDS})([^a-z]|$)`, 'i');
const ADULT_COLL_RE = /adult|erotic|xxx|porn|sexploit|nudist|naturis|hentai|nsfw/i;
const ADULT_TITLE_RE = /(^|[^a-z])(sex|sexy|nude|naked|nudist|porn|xxx|erotic|molest\w*|striptease|fetish|hentai)([^a-z]|$)/i;
const ADULT_Q = ['adult', 'erotica', 'erotic', 'xxx', 'porn', 'nudist', 'nudity', 'sexploitation', 'naturism'];

const list = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const strs = v => list(v).map(x => String(x));

/** true if the uploader's own labels say this is for adults */
export function looksAdult(rec) {
  if (strs(rec.collection).some(c => ADULT_COLL_RE.test(c))) return true;
  if (strs(rec.subject).some(s => ADULT_RE.test(s))) return true;
  return ADULT_TITLE_RE.test(String(strs(rec.title)[0] || ''));
}

/* ---------------- text from archive.org is only ever text ---------------- */
export function plain(v, max = 600) {
  const raw = strs(v).join(' ');
  if (!raw) return '';
  let t = raw;
  try {
    const doc = new DOMParser().parseFromString(raw.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, ' '), 'text/html');
    doc.querySelectorAll('script,style,template,noscript').forEach(n => n.remove());
    t = doc.body.textContent || '';
  } catch (e) { t = raw.replace(/<[^>]*>/g, ' '); }
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** archive.org writes runtimes as "106 min", "6:10", "1:31:44" or "5400" */
export function runtimeSecs(v) {
  const s = strs(v)[0];
  if (!s) return 0;
  let m = /^(\d+(?:\.\d+)?)\s*(?:min|minutes?|m)\b/i.exec(s.trim());
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?$/.exec(s.trim());
  if (m) return m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
  m = /^(\d+(?:\.\d+)?)$/.exec(s.trim());
  return m ? Math.round(Number(m[1])) : 0;
}
export function fmtRun(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  if (m < 1) return `${secs} s`;
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}
export function fmtClock(t) {
  const s = Math.max(0, Math.floor(Number(t) || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

/** The uploader-stated licence as a line, or the honest "not stated". */
export function rightsOf(rec) {
  const url = strs(rec.licenseurl)[0] || '';
  const text = plain(rec.rights, 200);
  const safeUrl = /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
  let label = '';
  if (safeUrl) {
    const u = safeUrl.toLowerCase();
    if (/publicdomain\/zero|cc0/.test(u)) label = 'CC0 (public domain dedication)';
    else if (/licenses\/publicdomain|publicdomain\/mark/.test(u)) label = 'Public domain';
    else {
      const m = /creativecommons\.org\/licenses\/([a-z-]+)\/?([0-9.]*)/.exec(u);
      label = m ? `Creative Commons ${m[1].toUpperCase()}${m[2] ? ` ${m[2]}` : ''}` : safeUrl.replace(/^https?:\/\//i, '');
    }
  }
  if (!label && !text) return { stated: false, line: 'Rights not stated by the uploader', url: '' };
  return { stated: true, line: label ? (text ? `${label} · ${text}` : label) : text, url: safeUrl, source: label ? 'licenseurl' : 'rights' };
}

/* ---------------- SRT -> WebVTT, in the browser ---------------- */
export function srtToVtt(srt) {
  const body = String(srt || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, (_, a, b) => `${a}.${b.padEnd(3, '0')}`);
  return `WEBVTT\n\n${body}\n`;
}

/* ---------------- query building ---------------- */
const lucene = s => String(s || '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
export function buildQuery(f) {
  const col = COLLECTIONS.find(c => c.id === f.collection) || COLLECTIONS[0];
  const parts = [
    `collection:(${col.q.join(' OR ')})`,
    'mediatype:movies',
    '(format:MPEG4 OR format:"h.264")',
    `NOT subject:(${ADULT_Q.join(' OR ')})`,
  ];
  const q = lucene(f.q);
  if (q) parts.push(`(title:(${q}) OR creator:(${q}) OR subject:(${q}))`);
  if (f.genre) parts.push(`subject:${GENRE_Q[f.genre] || `"${lucene(f.genre).toLowerCase()}"`}`);
  const d = Number(f.decade);
  if (d) parts.push(`year:[${d} TO ${d + 9}]`);
  if (f.lang && LANG_Q[f.lang]) parts.push(`language:${LANG_Q[f.lang]}`);
  if (f.subs) parts.push('(format:SubRip OR format:"Web Video Text Tracks")');
  if (f.sort === 'rating') parts.push('num_reviews:[3 TO 999999]');
  return parts.join(' AND ');
}
export function searchUrl(f, page = 1) {
  const sp = new URLSearchParams();
  sp.set('q', buildQuery(f));
  for (const fl of FIELDS) sp.append('fl[]', fl);
  sp.append('sort[]', (SORTS.find(s => s.id === f.sort) || SORTS[0]).q);
  sp.set('rows', String(PAGE));
  sp.set('page', String(page));
  sp.set('output', 'json');
  return `${IA}/advancedsearch.php?${sp}`;
}
export const posterUrl = id => `${IA}/services/img/${encodeURIComponent(id)}`;
export const pageUrl = id => `${IA}/details/${encodeURIComponent(id)}`;
const fileUrl = (id, name, base = 'download') => `${IA}/${base}/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;

/** the MP4 to stream and save: the smallest real one (not a sample or trailer) */
export function pickVideo(files) {
  const mp4s = list(files).filter(f => f && /\.(mp4|m4v)$/i.test(f.name || '') && !/sample|trailer|preview/i.test(f.name)
    && /h\.?264|mpeg4|mp4/i.test(f.format || '') && !/thumb/i.test(f.format || ''));
  mp4s.sort((a, b) => (Number(a.size) || Infinity) - (Number(b.size) || Infinity));
  return mp4s[0] || null;
}
export function pickSubs(files) {
  const subs = list(files).filter(f => f && /\.(vtt|srt)$/i.test(f.name || ''));
  const score = f => (/\.vtt$/i.test(f.name) ? 0 : 1) + (/\.asr\./i.test(f.name) ? 4 : 0) + (/(^|[._-])(en|eng|english)([._-]|$)/i.test(f.name) ? -2 : 0);
  subs.sort((a, b) => score(a) - score(b));
  return subs[0] || null;
}

/* ---------------- network with a polite back-off ---------------- */
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); }, { once: true });
});
const delays = () => (Array.isArray(globalThis.__filmsBackoff) ? globalThis.__filmsBackoff : [2000, 5000, 12000]);

async function getJson(url, { signal, onWait } = {}) {
  const waits = delays();
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fetch(url, { signal }); } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw Object.assign(new Error(navigator.onLine === false ? 'offline' : 'net'), { kind: navigator.onLine === false ? 'offline' : 'net' });
    }
    if (res.status === 503 || res.status === 429) {
      if (attempt < waits.length) { onWait?.(Math.round(waits[attempt] / 100) / 10, attempt + 1, waits.length); await sleep(waits[attempt], signal); continue; }
      throw Object.assign(new Error('busy'), { kind: 'busy' });
    }
    if (!res.ok) throw Object.assign(new Error(`http ${res.status}`), { kind: 'http', status: res.status });
    try { return await res.json(); } catch (e) { throw Object.assign(new Error('bad'), { kind: 'bad' }); }
  }
}
const arrOf = v => (Array.isArray(v) ? v : []);

/** Films you stopped partway through, for Continue Watching (no view needed). */
export function filmContinue(store) {
  const d = store.get(FILMS_KEY, {});
  const pos = d && typeof d.pos === 'object' && d.pos ? d.pos : {};
  const going = p => !!p && p.d >= MIN_LEN && p.t >= 2 && p.t < p.d - Math.max(3, p.d * 0.04);
  return Object.entries(pos).filter(([, p]) => going(p)).map(([id, p]) => ({ kind: 'film', id, p, at: Number(p.at) || 0, title: String(p.title || id) }));
}
export function forgetFilmPos(store, id) {
  const d = store.get(FILMS_KEY, {});
  if (!d?.pos?.[id]) return;
  const pos = { ...d.pos };
  delete pos[id];
  store.set(FILMS_KEY, { ...d, pos });
}

/** Films you watched to the end (for the Finished shelf and the stats). */
export function filmsFinished(store) {
  const d = store.get(FILMS_KEY, {});
  const done = d && typeof d.done === 'object' && d.done ? d.done : {};
  return Object.entries(done).filter(([, x]) => x && x.at).map(([id, x]) => ({ id, title: String(x.title || id), year: Number(x.year) || 0, d: Number(x.d) || 0, at: Number(x.at) || 0 }));
}

/* ================================================================
   the view
   ================================================================ */
export function createFilms({ api, win, note, remember, alive }) {
  const { h, icon, clear, store, vfs, fmt } = api;
  const HOME = vfs.HOME;
  const tilde = p => (p === HOME ? '~' : p.startsWith(HOME + '/') ? `~${p.slice(HOME.length)}` : p);

  const S = {
    f: { q: '', collection: 'all', genre: '', decade: '', sort: 'downloads', lang: '', subs: false },
    runtime: '',              /* a RUNTIMES id, applied to what has loaded */
    view: 'browse',           /* browse | later | hidden */
    select: false, picked: new Set(),
    note: '',                 /* a line from "Random film" and the like */
    state: 'idle',            /* idle | loading | ready | error */
    err: null, wait: '',
    items: [], total: 0, page: 0, hidden: { adult: 0, poster: 0, mine: 0 }, noPoster: new Set(),
    open: null,               /* the film shown in the detail view */
    dead: false,
  };
  let searchAbort = null;
  let detail = null;          /* the live detail view: { rec, el, video, abort, ... } */
  const timers = new Set();

  /* ---- saved places & saved copies, through the store ---- */
  const data = () => {
    const d = store.get(FILMS_KEY, {});
    const o = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    return { ...o(d), pos: o(d?.pos), saved: o(d?.saved), later: o(d?.later), hidden: o(d?.hidden), done: o(d?.done), usersubs: o(d?.usersubs),
      queue: (Array.isArray(d?.queue) ? d.queue : []).filter(q => q && typeof q.id === 'string') };
  };
  const put = next => store.set(FILMS_KEY, next);
  const inProgress = p => !!p && p.d >= MIN_LEN && p.t >= 2 && p.t < p.d - Math.max(3, p.d * 0.04);
  function savePos(rec, t, d) {
    if (!(d > 0) || !Number.isFinite(t)) return;
    const cur = data();
    const pos = { ...cur.pos };
    let done = cur.done;
    if (!inProgress({ t, d }) && t >= d - Math.max(3, d * 0.04)) {
      delete pos[rec.id];
      /* a clip too short to resume is not a film you finished */
      if (d >= MIN_LEN) {
        done = { ...cur.done, [rec.id]: { d: Math.round(d), at: Date.now(), title: rec.title, year: rec.year || 0 } };
        const ks = Object.keys(done);
        if (ks.length > 200) ks.sort((a, b) => done[b].at - done[a].at).slice(200).forEach(k => delete done[k]);
      }
    } else if (d >= MIN_LEN && t >= 2) pos[rec.id] = { t: Math.round(t * 10) / 10, d: Math.round(d * 10) / 10, at: Date.now(), title: rec.title, year: rec.year || 0 };
    else return;
    const keys = Object.keys(pos);
    if (keys.length > 40) keys.sort((a, b) => pos[b].at - pos[a].at).slice(40).forEach(k => delete pos[k]);
    put({ ...cur, pos, done });
  }
  const savedCopy = id => {
    const s = data().saved[id];
    const n = s && vfs.node(s.path);
    return n && n.type === 'file' ? { ...s, node: n } : null;
  };

  /* ---------------- records ---------------- */
  function toRec(d) {
    const id = strs(d.identifier)[0];
    if (!id) return null;
    const rights = rightsOf(d);
    return {
      id, title: plain(d.title, 160) || id,
      year: Number(strs(d.year)[0]) || 0,
      secs: runtimeSecs(d.runtime),
      creator: plain(d.creator, 80),
      desc: plain(d.description, 700),
      rights,
      downloads: Number(d.downloads) || 0,
      rating: Number(d.avg_rating) || 0,
      reviews: Number(d.num_reviews) || 0,
      subjects: strs(d.subject).map(s => plain(s, 40)).filter(Boolean).slice(0, 6),
    };
  }

  /* ---------------- the small lists: saved for later, hidden, double feature ---------------- */
  const stubRec = (id, title = id, year = 0) => ({ id, title, year, secs: 0, creator: '', desc: '', rights: { stated: false, line: 'Rights not stated by the uploader', url: '' }, downloads: 0, rating: 0, reviews: 0, subjects: [] });
  const isLater = id => !!data().later[id];
  const inQueue = id => data().queue.some(q => q.id === id);
  function toggleLater(rec) {
    const cur = data();
    const later = { ...cur.later };
    const had = !!later[rec.id];
    if (had) delete later[rec.id]; else later[rec.id] = { title: rec.title, year: rec.year || 0, at: Date.now() };
    put({ ...cur, later });
    note({ icon: had ? 'x' : 'heart', title: had ? 'Removed from Saved for later' : 'Saved for later', message: rec.title });
    refreshChrome();
  }
  function toggleQueue(rec) {
    const cur = data();
    const had = cur.queue.some(q => q.id === rec.id);
    put({ ...cur, queue: had ? cur.queue.filter(q => q.id !== rec.id) : [...cur.queue, { id: rec.id, title: rec.title, year: rec.year || 0 }].slice(0, 12) });
    note({ icon: 'film', title: had ? 'Taken out of the double feature' : 'Added to the double feature', message: rec.title });
    refreshChrome();
  }
  function moveQueue(id, dir) {
    const cur = data();
    const q = cur.queue.slice();
    const i = q.findIndex(x => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j], q[i]];
    put({ ...cur, queue: q });
    renderList();
  }
  function hideFilm(rec) {
    const cur = data();
    const later = { ...cur.later };
    delete later[rec.id];
    put({ ...cur, hidden: { ...cur.hidden, [rec.id]: { title: rec.title, year: rec.year || 0, at: Date.now() } }, later, queue: cur.queue.filter(q => q.id !== rec.id) });
    S.items = S.items.filter(x => x.id !== rec.id);
    S.total = Math.max(0, S.total - 1);
    note({ icon: 'eye-off', title: 'Film hidden', message: `${rec.title} won’t show up in Free films. You can bring it back under Hidden.` });
    if (detail) closeDetail();
    renderList();
  }
  function unhideFilm(id) {
    const cur = data();
    const hidden = { ...cur.hidden };
    delete hidden[id];
    put({ ...cur, hidden });
    renderList();
  }
  const recOfStored = (id, x) => stubRec(id, String(x?.title || id), Number(x?.year) || 0);

  /* ---------------- search ---------------- */
  async function search(more = false) {
    searchAbort?.abort();
    const ac = new AbortController();
    searchAbort = ac;
    if (!more) { S.items = []; S.page = 0; S.total = 0; S.hidden = { adult: 0, poster: 0, mine: 0 }; S.noPoster = new Set(); S.note = ''; }
    S.state = 'loading';
    S.err = null; S.wait = '';
    renderList();
    try {
      const page = S.page + 1;
      const json = await getJson(searchUrl(S.f, page), {
        signal: ac.signal,
        onWait: (secs, n, of) => { S.wait = `archive.org is busy (it answered 503). Trying again in ${secs} s — attempt ${n} of ${of}.`; if (!S.dead) renderStatus(); },
      });
      if (S.dead || ac !== searchAbort) return;
      const docs = arrOf(json?.response?.docs);
      const mine = data().hidden;
      for (const d of docs) {
        if (looksAdult(d)) { S.hidden.adult++; continue; }
        const rec = toRec(d);
        if (rec && mine[rec.id]) { S.hidden.mine++; continue; }
        if (rec && !S.items.some(x => x.id === rec.id)) S.items.push(rec);
      }
      S.total = Number(json?.response?.numFound) || 0;
      S.page = page;
      S.state = 'ready';
      S.wait = '';
    } catch (e) {
      if (e?.name === 'AbortError' || S.dead || ac !== searchAbort) return;
      S.state = 'error';
      S.err = e;
    }
    renderList();
  }
  /** what the grid shows: the loaded films that fit the runtime filter */
  const shownItems = () => {
    const rt = RUNTIMES.find(r => r[0] === S.runtime);
    return rt ? S.items.filter(r => r.secs > 0 && rt[2](r.secs)) : S.items;
  };

  /** A random film from the collection (and filters) that is open now, not only the page on screen. */
  async function randomFilm() {
    S.note = 'Picking a film…';
    renderStatus();
    let pool = shownItems();
    if (S.state === 'ready' && S.total > S.items.length) {
      try {
        const pages = Math.max(1, Math.min(Math.ceil(S.total / PAGE), Math.floor(10000 / PAGE)));
        const json = await getJson(searchUrl(S.f, 1 + Math.floor(Math.random() * pages)), { signal: searchAbort?.signal });
        const mine = data().hidden;
        const fresh = arrOf(json?.response?.docs).filter(d => !looksAdult(d)).map(toRec).filter(r => r && !mine[r.id]);
        if (fresh.length) pool = fresh;
      } catch (e) { if (e?.name === 'AbortError') return; /* the page on screen is still a fair pool */ }
    }
    if (S.dead) return;
    if (!pool.length) { S.note = 'No film to pick from — nothing matches these filters.'; renderStatus(); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    S.note = '';
    openDetail(pick);
  }

  /* ---------------- list view ---------------- */
  const el = h('div.wt-pad.wf');
  const bar = h('div.wf-bar');
  const shelvesEl = h('div.wf-shelves', { role: 'group', 'aria-label': 'Shelves' });
  const viewsEl = h('div.wf-views', { role: 'group', 'aria-label': 'Show' });
  const queueEl = h('div.wf-queue');
  const dlEl = h('div.wf-dlq', { 'aria-live': 'polite' });
  const status = h('div.wf-status', { role: 'status', 'aria-live': 'polite' });
  const grid = h('div.wf-grid', { role: 'list', 'aria-label': 'Films' });
  const listEl = h('div.wf-list');
  const detailEl = h('div.wf-detailhost', { hidden: true });
  el.append(listEl, detailEl);

  const select = (label, value, options, onchange) => h('label.wf-sel', h('span.sr', { text: label }),
    h('select', { 'aria-label': label, onchange: e => onchange(e.target.value) },
      options.map(([v, t]) => h('option', { value: v, text: t, selected: String(v) === String(value) ? true : null }))));
  const pill = (label, on, onclick, fk) => h('button.wt-chip', { type: 'button', 'aria-pressed': String(!!on), class: on ? 'is-on' : null, dataset: { fk }, onclick }, h('span', { text: label }));

  let qTimer = 0;
  const qIn = h('input', {
    type: 'search', placeholder: 'Search films…', spellcheck: 'false', maxlength: '80', 'aria-label': 'Search free films on archive.org',
    oninput: () => { clearTimeout(qTimer); qTimer = setTimeout(() => { if (S.dead) return; const v = qIn.value.trim(); if (v !== S.f.q) { S.f.q = v; search(); } }, 350); timers.add(qTimer); },
    onkeydown: e => { if (e.key === 'Enter') { clearTimeout(qTimer); S.f.q = qIn.value.trim(); search(); } },
  });
  function renderBar() {
    clear(bar);
    bar.append(
      h('div.field.wf-q', icon('search'), qIn),
      select('Collection', S.f.collection, COLLECTIONS.map(c => [c.id, c.label]), v => { S.f.collection = v; search(); }),
      select('Genre', S.f.genre, [['', 'Any genre'], ...GENRES.map(g => [g, g])], v => { S.f.genre = v; search(); }),
      select('Decade', S.f.decade, [['', 'Any decade'], ...DECADES.map(d => [String(d), `${d}s`])], v => { S.f.decade = v; search(); }),
      select('Language', S.f.lang, [['', 'Any language'], ...LANGS], v => { S.f.lang = v; search(); }),
      select('Runtime', S.runtime, [['', 'Any runtime'], ...RUNTIMES.map(r => [r[0], r[1]])], v => { S.runtime = v; renderList(); }),
      select('Sort', S.f.sort, SORTS.map(s => [s.id, s.label]), v => { S.f.sort = v; search(); }),
      h('label.wf-chk', h('input', { type: 'checkbox', checked: S.f.subs ? true : null, dataset: { fk: 'films:subs' }, onchange: e => { S.f.subs = e.target.checked; search(); } }), h('span', { text: 'Has subtitles' })),
      h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'films:random' }, onclick: randomFilm }, icon('shuffle'), h('span', { text: 'Random film' })),
      h('button.btn.btn--sm', { type: 'button', 'aria-pressed': String(S.select), class: S.select ? 'is-on' : null, dataset: { fk: 'films:select' }, onclick: () => { S.select = !S.select; if (!S.select) S.picked.clear(); renderBar(); renderList(); } }, icon('check'), h('span', { text: S.select ? 'Done selecting' : 'Select films' })));
  }
  function renderShelves() {
    clear(shelvesEl);
    shelvesEl.append(h('span.wf-shelves__k', { text: 'Shelves' }),
      ...SHELVES.map(sh => pill(sh.label, S.f.collection === sh.collection && S.f.genre === sh.genre, () => {
        const on = S.f.collection === sh.collection && S.f.genre === sh.genre;
        S.f.collection = on ? 'all' : sh.collection; S.f.genre = on ? '' : sh.genre;
        renderBar(); search();
      }, `films:shelf:${sh.id}`)));
  }
  function renderViews() {
    clear(viewsEl);
    const d = data();
    const nl = Object.keys(d.later).length, nh = Object.keys(d.hidden).length;
    viewsEl.hidden = !nl && !nh && S.view === 'browse';
    viewsEl.append(pill('Browse', S.view === 'browse', () => { S.view = 'browse'; renderList(); }, 'films:view:browse'),
      nl || S.view === 'later' ? pill(`Saved for later (${nl})`, S.view === 'later', () => { S.view = 'later'; renderList(); }, 'films:view:later') : null,
      nh || S.view === 'hidden' ? pill(`Hidden (${nh})`, S.view === 'hidden', () => { S.view = 'hidden'; renderList(); }, 'films:view:hidden') : null);
  }
  /** the double feature panel */
  function renderQueue() {
    clear(queueEl);
    const q = data().queue;
    queueEl.hidden = !q.length;
    if (!q.length) return;
    queueEl.append(h('div.wf-queue__head', h('b', { text: `Double feature · ${q.length} ${q.length === 1 ? 'film' : 'films'}` }),
      h('span.grow'),
      h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'films:queue:play' }, onclick: () => openDetail(recOfStored(q[0].id, q[0]), { fresh: true }) }, icon('play', { fill: true }), h('span', { text: 'Play the queue' })),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'films:queue:clear' }, onclick: () => { put({ ...data(), queue: [] }); refreshChrome(); } }, h('span', { text: 'Clear' }))),
      h('ol.wf-queue__list', q.map((x, i) => h('li', h('span.grow', { text: `${x.title}${x.year ? ` (${x.year})` : ''}` }),
        h('button.ibtn', { type: 'button', 'aria-label': `Move ${x.title} up`, disabled: i === 0 ? true : null, dataset: { fk: `films:q:up:${x.id}` }, onclick: () => moveQueue(x.id, -1) }, icon('chevron-up')),
        h('button.ibtn', { type: 'button', 'aria-label': `Move ${x.title} down`, disabled: i === q.length - 1 ? true : null, dataset: { fk: `films:q:down:${x.id}` }, onclick: () => moveQueue(x.id, 1) }, icon('chevron-down')),
        h('button.ibtn', { type: 'button', 'aria-label': `Take ${x.title} out of the double feature`, dataset: { fk: `films:q:rm:${x.id}` }, onclick: () => toggleQueue(x) }, icon('x'))))),
      h('p.wf-fine', { text: 'When a film ends, the next one starts after a few seconds. You can stop it there.' }));
  }
  function refreshChrome() {
    if (S.dead) return;
    if (detail) { renderQueue(); renderViews(); return; }
    renderList();
  }

  function renderStatus() {
    clear(status);
    if (S.view !== 'browse') return;
    if (S.state === 'loading') {
      status.append(h('div.spinner'), h('span', { text: S.wait || (S.items.length ? 'Loading more…' : 'Asking archive.org…') }));
      return;
    }
    if (S.note) { status.append(icon('info'), h('span', { text: S.note })); return; }
    if (S.state === 'error') {
      const e = S.err || {};
      const msg = e.kind === 'offline' ? 'You are offline, so archive.org can’t be reached. Films you saved to Videos still play.'
        : e.kind === 'busy' ? 'archive.org is overloaded right now (it keeps answering 503) and gave up after several tries. Give it a minute, then try again.'
          : e.kind === 'http' ? `archive.org answered with an error (HTTP ${e.status}).`
            : e.kind === 'bad' ? 'archive.org sent something that isn’t a film list.'
              : 'archive.org didn’t answer. Check your connection or try again in a moment.';
      status.append(icon(e.kind === 'offline' ? 'wifi-off' : 'alert'), h('span.grow', { text: msg }),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'films:retry' }, onclick: () => search(S.page > 0 && S.items.length > 0) }, icon('refresh'), h('span', { text: 'Try again' })));
      return;
    }
    if (S.state === 'ready') {
      const shown = shownItems().length;
      const bits = [];
      if (S.runtime) bits.push(shown ? `${shown.toLocaleString()} of the ${S.items.length.toLocaleString()} loaded fit that runtime (films with no runtime listed are left out)` : `None of the ${S.items.length.toLocaleString()} loaded films fit that runtime${S.items.length < S.total ? ' — Show more loads more' : ''}`);
      else bits.push(S.items.length ? `${S.items.length.toLocaleString()} shown of ${S.total.toLocaleString()} that archive.org lists with a playable MP4` : 'Nothing matches those filters.');
      if (S.hidden.adult) bits.push(`${S.hidden.adult.toLocaleString()} hidden by the content filter`);
      if (S.hidden.mine) bits.push(`${S.hidden.mine.toLocaleString()} hidden by you`);
      if (S.hidden.poster) bits.push(`${S.hidden.poster.toLocaleString()} hidden for having no poster`);
      status.append(h('span', { text: bits.join(' · ') }));
    }
  }

  function filmMenu(rec) {
    return [
      { label: 'Open', icon: 'play', onClick: () => openDetail(rec) },
      { label: isLater(rec.id) ? 'Remove from Saved for later' : 'Save for later', icon: 'heart', onClick: () => toggleLater(rec) },
      { label: inQueue(rec.id) ? 'Take out of the double feature' : 'Add to the double feature', icon: 'film', onClick: () => toggleQueue(rec) },
      { label: 'Add to the download queue', icon: 'download', onClick: () => enqueueDownloads([rec]) },
      { label: 'On archive.org', icon: 'external-link', onClick: () => window.open(pageUrl(rec.id), '_blank', 'noopener,noreferrer') },
      '-',
      { label: 'Hide this film', icon: 'eye-off', danger: true, onClick: () => hideFilm(rec) },
    ];
  }
  function card(rec, { keep = false } = {}) {
    const art = h('div.wt-art.wt-art--poster.wf-art', { style: { '--art': 'linear-gradient(135deg,#2a2438,#15121f)' } },
      h('span.wt-art__mono', { 'aria-hidden': 'true', text: rec.title }));
    const img = h('img.wt-art__img', { alt: '', decoding: 'async', draggable: 'false' });   /* eager: the card stays hidden until it has a real poster */
    const c = h('div.wf-card', { role: 'listitem', hidden: !keep, dataset: { id: rec.id } });
    const drop = () => { if (S.dead) return; if (keep) { img.remove(); return; } S.noPoster.add(rec.id); S.hidden.poster = S.noPoster.size; c.remove(); S.items = S.items.filter(x => x !== rec); renderStatus(); };
    img.onerror = drop;
    img.onload = () => {
      /* archive.org answers a missing thumbnail with its own 160x110 "not found" picture */
      if (img.naturalWidth === 160 && img.naturalHeight === 110) { drop(); return; }
      c.hidden = false;
    };
    img.src = posterUrl(rec.id);
    art.append(img);
    const pos = data().pos[rec.id];
    if (inProgress(pos)) art.append(h('span.wt-art__prog', { 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(3, Math.round(pos.t / pos.d * 100))}%` } })));
    const meta = [rec.year || null, fmtRun(rec.secs) || null].filter(Boolean).join(' · ');
    c.append(
      h('button.wf-card__main.wt-card__main', { type: 'button', 'aria-label': `${rec.title}${meta ? `, ${meta}` : ''}. ${rec.rights.line}.`, dataset: { fk: `film:${rec.id}` }, onclick: () => openDetail(rec),
        oncontextmenu: e => { e.preventDefault(); api.menu(filmMenu(rec), e.clientX, e.clientY); } },
        art,
        h('span.wt-card__text', h('span.wt-card__t', { text: rec.title }), meta ? h('span.wt-card__m', { text: meta }) : null,
          h('span.wf-rights' + (rec.rights.stated ? '' : '.is-none'), { text: rec.rights.line }))),
      h('button.wf-card__heart', { type: 'button', 'aria-label': `Saved for later: ${rec.title}`, 'aria-pressed': String(isLater(rec.id)), class: isLater(rec.id) ? 'is-on' : null, dataset: { fk: `films:heart:${rec.id}` },
        onclick: e => { e.stopPropagation(); toggleLater(rec); } }, icon('heart')),
      h('button.wf-card__more', { type: 'button', 'aria-label': `More for ${rec.title}`, 'aria-haspopup': 'menu', dataset: { fk: `films:more:${rec.id}` },
        onclick: e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); api.menu(filmMenu(rec), r.left, r.bottom + 4); } }, icon('more-horizontal')));
    if (S.select && S.view === 'browse') {
      c.classList.add('is-select');
      c.append(h('label.wf-card__pick', h('input', { type: 'checkbox', checked: S.picked.has(rec.id) ? true : null, 'aria-label': `Select ${rec.title}`, dataset: { fk: `films:pick:${rec.id}` },
        onchange: e => { if (e.target.checked) S.picked.add(rec.id); else S.picked.delete(rec.id); renderPickBar(); } })));
    }
    return c;
  }
  const pickBar = h('div.wf-pickbar', { hidden: true });
  function renderPickBar() {
    clear(pickBar);
    pickBar.hidden = !S.select;
    if (!S.select) return;
    const n = S.picked.size;
    pickBar.append(h('span', { text: n ? `${n} selected` : 'Tick the films you want, then save them to Videos one after another.' }),
      h('button.btn.btn--sm.btn--primary', { type: 'button', disabled: n ? null : true, dataset: { fk: 'films:pick:save' }, onclick: () => {
        enqueueDownloads(S.items.filter(r => S.picked.has(r.id)));
        S.picked.clear(); S.select = false; renderBar(); renderList();
      } }, icon('download'), h('span', { text: n ? `Save ${n} to Videos` : 'Save to Videos' })));
  }

  function renderList() {
    if (S.dead) return;
    renderStatus();
    renderViews();
    renderQueue();
    renderPickBar();
    clear(grid);
    clear(listEl);
    listEl.append(
      h('p.wt-lede', { text: 'Films from the Internet Archive’s public film collections: public-domain and Creative-Commons classics, silent films, sci-fi, noir, comedy and cartoons. You can stream them here or save a copy to your Videos. Everything shown comes from archive.org and its uploaders; this is not a catalogue StaticOS curated.' }),
      queueEl, dlEl, viewsEl);
    renderDl();
    if (S.view === 'later') {
      const later = Object.entries(data().later).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      if (later.length) { later.forEach(([id, x]) => grid.append(card(recOfStored(id, x), { keep: true }))); listEl.append(grid); }
      else listEl.append(h('div.empty.wt-empty', h('b', { text: 'Nothing saved for later' }), h('small', { text: 'Press the heart on a film to keep it here.' })));
    } else if (S.view === 'hidden') {
      const hid = Object.entries(data().hidden).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      listEl.append(h('p.wf-fine', { text: 'Films you hid are left out of every search. Bring one back here.' }),
        hid.length ? h('div.wf-saved', hid.map(([id, x]) => h('div.wf-saved__row', h('span.grow', { text: `${x.title || id}${x.year ? ` (${x.year})` : ''}` }),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: `films:unhide:${id}` }, onclick: () => unhideFilm(id) }, icon('eye'), h('span', { text: 'Show again' })))))
          : h('div.empty.wt-empty', h('b', { text: 'You haven’t hidden any films' })));
    } else {
      renderShelves();
      listEl.append(shelvesEl, bar, pickBar, status);
      for (const rec of shownItems()) grid.append(card(rec));
      if (S.items.length) listEl.append(grid);
      if (S.state === 'ready' && S.items.length < S.total && S.page > 0) {
        listEl.append(h('div.wf-more', h('button.btn', { type: 'button', dataset: { fk: 'films:more' }, onclick: () => search(true) }, icon('download'), h('span', { text: 'Show more' }))));
      }
    }
    const saved = Object.keys(data().saved).map(id => ({ id, s: savedCopy(id) })).filter(x => x.s);
    if (saved.length && S.view === 'browse' && (S.state === 'error' || !S.items.length)) {
      listEl.append(h('h3.wf-h', { text: 'Saved on this device' }),
        h('div.wf-saved', saved.map(({ id, s }) => h('div.wf-saved__row',
          h('span.grow', { text: s.name || s.node.name }),
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: `films:saved:${id}` }, onclick: () => playSaved(s) }, icon('play', { fill: true }), h('span', { text: 'Play from Videos' }))))));
    }
    listEl.append(h('p.wt-foot', { text: 'The content filter hides items whose uploader-chosen collections, subjects or title carry adult labels. It works on those labels, so it is a filter, not a guarantee. If one slips through, use “Hide this film” on its card. Film data and pictures are from archive.org and belong to their uploaders and rights holders.' }));
  }

  /* ---------------- getting a film's bytes and keeping them in ~/Videos ----------------
     One place for both "Save to Videos" on a film and the download queue. */
  async function fetchFilm(rec, file, size, signal, onProgress) {
    const chunks = [];
    let got = 0, res;
    const waits = delays();
    for (let a = 0; ; a++) {
      try { res = await fetch(fileUrl(rec.id, file.name, 'cors'), { signal }); }
      catch (e) { if (e?.name === 'AbortError') throw e; const err = new Error('blocked'); err.kind = navigator.onLine === false ? 'offline' : 'blocked'; throw err; }
      if ((res.status === 503 || res.status === 429) && a < waits.length) { await sleep(waits[a], signal); continue; }
      break;
    }
    if (!res.ok) { const err = new Error(`http ${res.status}`); err.kind = res.status === 503 || res.status === 429 ? 'busy' : 'http'; err.status = res.status; throw err; }
    const total = Number(res.headers.get('content-length')) || size || 0;
    onProgress(0, total);
    const reader = res.body?.getReader?.();
    if (!reader) { chunks.push(new Uint8Array(await res.arrayBuffer())); got = chunks[0].length; onProgress(got, total); }
    else for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(got, total);
    }
    if (got === 0) throw Object.assign(new Error('empty'), { kind: 'http', status: 0 });
    return new Blob(chunks, { type: 'video/mp4' });
  }
  async function storeFilm(rec, blob) {
    const stem = `${rec.title}${rec.year ? ` (${rec.year})` : ''}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    const out = await media.save(`${HOME}/Videos`, `${stem}.mp4`, blob);
    const cur = data();
    put({ ...cur, saved: { ...cur.saved, [rec.id]: { path: out.path, name: out.node.name, at: Date.now(), size: blob.size } } });
    return out;
  }
  const dlFail = e => (e.kind === 'offline' ? 'You went offline, so the download stopped and nothing was saved.'
    : e.kind === 'busy' ? 'archive.org is overloaded (503) and kept refusing the download. Nothing was saved; try again in a minute.'
      : e.kind === 'http' ? `archive.org answered with an error (HTTP ${e.status}). Nothing was saved.`
        : e.kind === 'blocked' ? 'archive.org blocked the direct download from this page, so StaticOS can’t put the file in Videos by itself.'
          : `The file couldn’t be saved: ${String(e?.message || e)}`);

  /* ---------------- the download queue: several films, one after another ---------------- */
  const DL = { items: [], busy: false, cur: null };
  function enqueueDownloads(recs) {
    let added = 0;
    for (const rec of recs) {
      const live = DL.items.find(x => x.rec.id === rec.id && (x.state === 'wait' || x.state === 'run'));
      if (live) continue;
      DL.items = DL.items.filter(x => x.rec.id !== rec.id);
      if (savedCopy(rec.id)) { DL.items.push({ rec, state: 'skip', msg: 'Already in Videos' }); continue; }
      DL.items.push({ rec, state: 'wait', got: 0, total: 0 });
      added++;
    }
    DL.items = DL.items.slice(-40);
    if (added) note({ icon: 'download', title: added === 1 ? 'Added to the download queue' : `${added} films added to the download queue`, message: 'They save to Videos one after another.' });
    renderDl();
    pumpDl();
  }
  async function pumpDl() {
    if (DL.busy || S.dead) return;
    DL.busy = true;
    try {
      for (let it; !S.dead && (it = DL.items.find(x => x.state === 'wait'));) {
        it.ac = new AbortController();
        DL.cur = it;
        it.state = 'meta';
        renderDl();
        try {
          const json = await getJson(`${IA}/metadata/${encodeURIComponent(it.rec.id)}`, { signal: it.ac.signal });
          const file = pickVideo(json?.files);
          if (!file) throw Object.assign(new Error('nofile'), { kind: 'nofile' });
          it.state = 'run';
          let paint = 0;
          const blob = await fetchFilm(it.rec, file, Number(file.size) || 0, it.ac.signal, (got, total) => {
            it.got = got; it.total = total;
            const n = performance.now();
            if (n >= paint) { paint = n + 150; renderDl(); }
          });
          const out = await storeFilm(it.rec, blob);
          Object.assign(it, { state: 'done', path: out.path, bytes: blob.size });
          note({ icon: 'film', title: 'Saved to Videos', message: it.rec.title });
        } catch (e) {
          if (e?.name === 'AbortError') it.state = 'cancel';
          else { it.state = 'fail'; it.msg = e.kind === 'nofile' ? 'archive.org lists no playable MP4 for this film.' : dlFail(e); }
        }
        DL.cur = null;
        renderDl();
      }
    } finally { DL.busy = false; }
    renderDl();
  }
  function cancelDl(it) {
    if (it.state === 'wait') it.state = 'cancel';
    else if (it.state === 'meta' || it.state === 'run') it.ac?.abort();
    renderDl();
  }
  const DL_WORD = { wait: 'Waiting', meta: 'Getting details', run: 'Saving', done: 'Saved', skip: 'Skipped', fail: 'Failed', cancel: 'Cancelled' };
  function renderDl() {
    if (S.dead) return;
    clear(dlEl);
    dlEl.hidden = !DL.items.length;
    if (!DL.items.length) return;
    const left = DL.items.filter(x => x.state === 'wait' || x.state === 'meta' || x.state === 'run').length;
    dlEl.append(h('div.wf-queue__head', h('b', { text: left ? `Saving to Videos · ${left} to go` : 'Downloads to Videos' }), h('span.grow'),
      left ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'films:dl:cancelall' }, onclick: () => DL.items.forEach(cancelDl) }, icon('x'), h('span', { text: 'Cancel all' })) : null,
      !left ? h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'films:dl:clear' }, onclick: () => { DL.items = []; renderDl(); } }, h('span', { text: 'Clear' })) : null),
      h('ul.wf-dlq__list', DL.items.map(it => {
        const total = it.total || 0;
        const pct = total ? Math.min(100, Math.floor(it.got / total * 100)) : 0;
        const line = it.state === 'run' ? (total ? `${fmt.fmtBytes(it.got)} of ${fmt.fmtBytes(total)} · ${pct}%` : `${fmt.fmtBytes(it.got)} so far`)
          : it.state === 'done' ? `Saved as ${tilde(it.path)} (${fmt.fmtBytes(it.bytes)})`
            : it.msg || DL_WORD[it.state];
        return h('li.wf-dlq__row', { dataset: { state: it.state, id: it.rec.id } },
          h('span.wf-dlq__t', { text: it.rec.title }),
          h('span.wf-dlq__s', { text: line }),
          it.state === 'run' ? h('div.wf-meter', { role: 'progressbar', 'aria-label': `Saving ${it.rec.title}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('i', { style: { width: `${pct}%` } })) : null,
          it.state === 'wait' || it.state === 'meta' || it.state === 'run'
            ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: `films:dl:cancel:${it.rec.id}` }, onclick: () => cancelDl(it) }, icon('x'), h('span', { text: 'Cancel' })) : null);
      })));
  }

  /* ---------------- playing a saved copy through Videos ---------------- */
  function playSaved(s) {
    const w = api.openFile(s.path, api.getApp('videos') ? 'videos' : undefined);
    if (!w) note({ icon: 'alert', title: 'Nothing here plays videos', message: 'The Videos app is not part of this build.' });
  }

  /* ---------------- detail ---------------- */
  function closeDetail() {
    if (!detail) return;
    const d = detail;
    detail = null;
    d.stop();
    S.open = null;
    detailEl.hidden = true;
    clear(detailEl);
    listEl.hidden = false;
  }
  function backToList() {
    closeDetail();
    renderList();
    const b = grid.querySelector(`[data-fk="film:${S.lastOpened}"]`);
    try { (b || el).focus?.({ preventScroll: true }); } catch (e) {}
  }

  function openDetail(rec, { resume = false, fresh = false } = {}) {
    closeDetail();
    S.open = rec.id;
    S.lastOpened = rec.id;
    remember?.({ k: 'film', id: rec.id, title: rec.title });
    const ac = new AbortController();
    const D = {
      rec, ac, meta: null, file: null, subs: null, video: null, frame: null,
      dl: null,             /* { ac, got, total, state: 'ask'|'run'|'done'|'fail', ... } */
      timers: [], vurls: [], rate: 1,
      stop() {
        ac.abort();
        window.removeEventListener('keydown', onKey);
        D.dl?.ac?.abort();
        D.stopVideo();
        D.timers.forEach(t => clearTimeout(t));
        D.vurls.forEach(u => URL.revokeObjectURL(u));
      },
      stopVideo() {
        const v = D.video;
        if (v) {
          try { savePos(rec, v.currentTime, v.duration); v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
          D.video = null;
        }
        if (D.frame) { D.frame.remove(); D.frame = null; }
      },
    };
    detail = D;
    listEl.hidden = true;
    detailEl.hidden = false;

    const stage = h('div.wf-stage', { hidden: true });
    const playRow = h('div.wf-acts');
    const dlBox = h('div.wf-dl', { 'aria-live': 'polite' });
    const subNote = h('div.wf-note', { role: 'status' });
    const metaState = h('div.wf-note', { role: 'status' });
    const moreRow = h('div.wf-acts.wf-acts--more');
    const keyNote = h('div.wf-keys', { role: 'status', 'aria-live': 'polite' });
    const subFile = h('input', { type: 'file', accept: '.srt,.vtt,text/vtt,application/x-subrip', hidden: true, 'aria-hidden': 'true', tabindex: '-1', dataset: { fk: 'films:subfile' } });

    const rightsEl = h('span.wf-rightsval');
    const paintRights = () => {
      const rr = rec.rights;
      clear(rightsEl);
      rightsEl.append(rr.url
        ? h('a.wf-licence', { href: rr.url, target: '_blank', rel: 'noopener noreferrer', text: rr.line })
        : h('span.wf-licence' + (rr.stated ? '' : '.is-none'), { text: rr.line }));
    };
    paintRights();
    const stats = [
      rec.downloads ? `${rec.downloads.toLocaleString()} downloads on archive.org` : null,
      rec.rating ? `average rating ${rec.rating.toFixed(1)} of 5 from ${rec.reviews.toLocaleString()} review${rec.reviews === 1 ? '' : 's'}` : null,
    ].filter(Boolean);

    const poster = h('div.wt-art.wt-art--poster.wf-dposter', { style: { '--art': 'linear-gradient(135deg,#2a2438,#15121f)' } },
      h('span.wt-art__mono', { 'aria-hidden': 'true', text: rec.title }),
      h('img.wt-art__img', { src: posterUrl(rec.id), alt: `Poster for ${rec.title}`, draggable: 'false', onerror: e => e.target.remove() }));

    const titleEl = h('h2.wf-title', { text: rec.title });
    const descEl = h('p.wf-desc', { text: rec.desc || 'The uploader gave no description.' });
    const runEl = h('span', { text: [rec.year || null, fmtRun(rec.secs) || null, rec.creator || null].filter(Boolean).join(' · ') });

    D.el = h('div.wf-detail',
      h('button.btn.btn--sm.btn--ghost.wf-back', { type: 'button', dataset: { fk: 'films:back' }, onclick: backToList }, icon('arrow-left'), h('span', { text: 'All films' })),
      stage,
      h('div.wf-info',
        poster,
        h('div.wf-text',
          titleEl,
          h('div.wf-meta', runEl),
          rec.subjects.length ? h('div.wf-tags', rec.subjects.map(s => h('span.wf-tag', { text: s }))) : null,
          descEl,
          h('div.wf-rightsrow', h('b', { text: 'Rights (as stated by the uploader): ' }), rightsEl),
          stats.length ? h('div.wf-stats', { text: stats.join(' · ') }) : null,
          metaState,
          playRow,
          moreRow,
          dlBox,
          subNote,
          keyNote,
          subFile,
          h('p.wf-fine', { text: 'The licence line is whatever the uploader typed on archive.org. StaticOS has not checked it. ' },
            h('a', { href: pageUrl(rec.id), target: '_blank', rel: 'noopener noreferrer', text: 'On archive.org' })))));
    detailEl.append(D.el);

    /* ---- details from /metadata ---- */
    const paintActs = () => {
      clear(playRow);
      const pos = data().pos[rec.id];
      const copy = savedCopy(rec.id);
      const here = !!D.video || !!D.frame;
      if (!D.meta) {
        playRow.append(h('button.btn.btn--primary', { type: 'button', disabled: true }, h('div.spinner'), h('span', { text: 'Loading details…' })));
      } else if (!D.file) {
        playRow.append(h('span.wf-warn', { text: 'archive.org lists no playable MP4 for this item.' }));
      } else {
        const go = from => play(from);
        if (inProgress(pos)) {
          playRow.append(
            h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'films:play' }, onclick: () => go(pos.t) }, icon('play', { fill: true }), h('span', { text: `Resume at ${fmtClock(pos.t)}` })),
            h('button.btn', { type: 'button', dataset: { fk: 'films:start' }, onclick: () => go(0) }, icon('rotate-ccw'), h('span', { text: 'From the start' })));
        } else {
          playRow.append(h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'films:play' }, onclick: () => go(0) }, icon('play', { fill: true }), h('span', { text: here ? 'Play again' : 'Play' })));
        }
        playRow.append(h('button.btn', { type: 'button', dataset: { fk: 'films:save' }, disabled: D.dl && (D.dl.state === 'run' || D.dl.state === 'ask') ? true : null, onclick: askSave },
          icon('download'), h('span', { text: 'Save to Videos' })));
      }
      if (copy) playRow.append(h('button.btn', { type: 'button', dataset: { fk: 'films:saved' }, onclick: () => playSaved(copy) }, icon('folder-open'), h('span', { text: 'Play saved copy' })));
      playRow.append(h('a.btn', { href: pageUrl(rec.id), target: '_blank', rel: 'noopener noreferrer', dataset: { fk: 'films:ia' } }, icon('external-link'), h('span', { text: 'On archive.org' })));
      playRow.append(h('span.wf-licnext', { text: rec.rights.stated ? `Licence: ${rec.rights.line}` : rec.rights.line }));
      paintMore();
    };
    /* the rest of what you can do with a film: heart, double feature, subtitles, friend, hide */
    function paintMore() {
      clear(moreRow);
      const copy = savedCopy(rec.id);
      const mySubs = data().usersubs[rec.id];
      moreRow.append(
        h('button.btn.btn--sm', { type: 'button', 'aria-pressed': String(isLater(rec.id)), class: isLater(rec.id) ? 'is-on' : null, dataset: { fk: 'films:later' }, onclick: () => { toggleLater(rec); paintMore(); } },
          icon('heart', isLater(rec.id) ? { fill: true } : undefined), h('span', { text: isLater(rec.id) ? 'Saved for later' : 'Save for later' })),
        h('button.btn.btn--sm', { type: 'button', 'aria-pressed': String(inQueue(rec.id)), class: inQueue(rec.id) ? 'is-on' : null, dataset: { fk: 'films:queueadd' }, onclick: () => { toggleQueue(rec); paintMore(); } },
          icon('film'), h('span', { text: inQueue(rec.id) ? 'In the double feature' : 'Add to double feature' })),
        D.file ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'films:dlqueue' }, disabled: copy ? true : null, onclick: () => enqueueDownloads([rec]) },
          icon('download'), h('span', { text: copy ? 'Already in Videos' : 'Add to download queue' })) : null,
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'films:addsubs' }, onclick: () => subFile.click() }, icon('file-text'), h('span', { text: mySubs ? 'Replace my subtitles…' : 'Add subtitles…' })),
        mySubs ? h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'films:rmsubs' }, onclick: removeMySubs }, h('span', { text: 'Remove my subtitles' })) : null,
        copy ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'films:friend' }, onclick: () => api.openApp('watch-together', { path: copy.path }) }, icon('users'), h('span', { text: 'Watch with a friend' }))
          : h('button.btn.btn--sm.is-off', { type: 'button', dataset: { fk: 'films:friend' }, title: 'Watch Together shares a file from this device', onclick: () => { subNote.textContent = 'To watch with a friend, save this film to Videos first: Watch Together shares a file from your device, and you each need the film.'; } },
            icon('users'), h('span', { text: 'Watch with a friend' })),
        h('button.btn.btn--sm.btn--ghost.wf-hide', { type: 'button', dataset: { fk: 'films:hide' }, onclick: () => hideFilm(rec) }, icon('eye-off'), h('span', { text: 'Hide this film' })));
    }
    paintActs();

    getJson(`${IA}/metadata/${encodeURIComponent(rec.id)}`, {
      signal: ac.signal,
      onWait: (secs, n, of) => { metaState.textContent = `archive.org is busy (503). Trying again in ${secs} s — attempt ${n} of ${of}.`; },
    }).then(json => {
      if (S.dead || detail !== D) return;
      metaState.textContent = '';
      const m = json?.metadata || {};
      if (!json || !m.identifier) throw Object.assign(new Error('gone'), { kind: 'gone' });
      D.meta = m;
      /* richer, uploader-stated details win over the search row */
      const full = plain(m.description, 1600);
      if (full) descEl.textContent = full;
      const secs = runtimeSecs(m.runtime) || rec.secs;
      if (secs) { rec.secs = secs; runEl.textContent = [rec.year || null, fmtRun(secs), rec.creator || null].filter(Boolean).join(' · '); }
      const r2 = rightsOf(m);
      if (r2.stated) rec.rights = r2;
      paintRights();
      if (rec.title === rec.id && m.title) { rec.title = plain(m.title, 160); titleEl.textContent = rec.title; }
      if (!rec.year) { rec.year = Number(strs(m.year)[0]) || 0; runEl.textContent = [rec.year || null, fmtRun(rec.secs) || null, rec.creator || null].filter(Boolean).join(' · '); }
      D.file = pickVideo(json.files);
      D.subs = pickSubs(json.files);
      D.size = D.file ? Number(D.file.size) || 0 : 0;
      paintActs();
      if ((resume || fresh) && D.file) { const p = data().pos[rec.id]; play(!fresh && inProgress(p) ? p.t : 0); }
    }).catch(e => {
      if (e?.name === 'AbortError' || S.dead || detail !== D) return;
      D.meta = {};
      metaState.textContent = e.kind === 'offline' ? 'You are offline, so the details and the stream can’t load. A saved copy still plays.'
        : e.kind === 'busy' ? 'archive.org is overloaded (503) and didn’t give this film’s details after several tries. Close and reopen it in a minute.'
          : e.kind === 'gone' ? 'archive.org has no details for this item any more.' : 'The details for this film didn’t load.';
      metaState.classList.add('is-bad');
      paintActs();
    });

    /* ---- play: a <video> on the archive.org download URL, resuming where we stopped ---- */
    function play(from) {
      D.stopVideo();
      stage.hidden = false;
      clear(stage);
      const url = fileUrl(rec.id, D.file.name);
      const v = h('video.wf-video', { controls: true, preload: 'metadata', playsinline: true, 'aria-label': `${rec.title}, streaming from archive.org`, src: url });
      D.video = v;
      let lastSave = 0, seeked = false;
      v.addEventListener('loadedmetadata', () => {
        if (!seeked && from > 1 && from < v.duration - 2) { try { v.currentTime = from; } catch (e) {} }
        seeked = true;
      });
      const save = () => { if (D.video === v) savePos(rec, v.currentTime, v.duration); };
      v.addEventListener('timeupdate', () => { const n = Date.now(); if (n - lastSave > SAVE_EVERY) { lastSave = n; save(); } });
      v.addEventListener('pause', save);
      v.addEventListener('ended', () => { save(); onFilmEnded(); });
      v.addEventListener('loadedmetadata', () => { v.playbackRate = D.rate; });
      v.addEventListener('error', () => { if (D.video === v && !D.frame) embed(v.error); });
      stage.append(v);
      v.play().catch(() => { /* autoplay refused: the controls are there */ });
      loadSubs(v);
      paintActs();
      try { stage.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
    function embed(err) {
      /* the file would not stream: archive.org's own embedded player, sandboxed */
      if (D.video) { try { D.video.pause(); D.video.removeAttribute('src'); } catch (e) {} D.video = null; }
      clear(stage);
      D.frame = h('iframe.wf-frame', {
        src: `${IA}/embed/${encodeURIComponent(rec.id)}`, title: `${rec.title} on archive.org`,
        sandbox: 'allow-scripts allow-same-origin allow-presentation', allow: 'fullscreen', referrerpolicy: 'no-referrer', loading: 'lazy',
      });
      stage.append(
        h('div.wf-banner', { role: 'status' }, icon('info'), h('span', { text: `The video file wouldn’t stream directly${err?.code ? ` (media error ${err.code})` : ''}, so this is archive.org’s own player in a sandboxed frame. Your place isn’t remembered in it.` })),
        D.frame);
    }
    /** put a WebVTT text on the video as a track, shown */
    function attachTrack(v, text, label, srclang, mine) {
      v.querySelectorAll('track[data-mine]').forEach(t => t.remove());
      const u = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
      D.vurls.push(u);
      const track = h('track', { kind: 'subtitles', label, srclang, src: u, default: true, dataset: mine ? { mine: '1' } : {} });
      v.append(track);
      for (const t of v.textTracks) t.mode = 'hidden';
      track.track.mode = 'showing';
    }
    async function loadSubs(v) {
      subNote.textContent = '';
      const mine = data().usersubs[rec.id];
      if (mine) {
        attachTrack(v, mine.text, 'My subtitles', 'en', true);
        subNote.textContent = `Subtitles on (your file: ${mine.name}). Press C to turn them off.`;
        return;
      }
      if (!D.subs) { subNote.textContent = 'This item has no subtitle file. You can add your own below.'; return; }
      subNote.textContent = 'Loading subtitles…';
      try {
        const res = await fetch(fileUrl(rec.id, D.subs.name, 'cors'), { signal: ac.signal });
        if (!res.ok) throw new Error(`http ${res.status}`);
        let text = await res.text();
        if (!/^﻿?WEBVTT/.test(text)) text = srtToVtt(text);
        if (S.dead || D.video !== v) return;
        if (data().usersubs[rec.id]) return;
        attachTrack(v, text, /\.asr\./i.test(D.subs.name) ? 'Auto-generated' : 'Subtitles', 'en', false);
        subNote.textContent = `Subtitles on (${/\.asr\./i.test(D.subs.name) ? 'auto-generated by archive.org' : 'uploaded with the film'}: ${D.subs.name}). Press C or use the player’s CC menu to turn them off.`;
      } catch (e) {
        if (e?.name === 'AbortError') return;
        subNote.textContent = 'This item has subtitles, but they didn’t load.';
      }
    }
    /* ---- your own subtitle file ---- */
    subFile.addEventListener('change', async () => {
      const f = subFile.files?.[0];
      subFile.value = '';
      if (!f) return;
      if (f.size > 1.5e6) { subNote.textContent = 'That file is too big to be a subtitle file (over 1.5 MB).'; return; }
      let text = '';
      try { text = await f.text(); } catch (e) { subNote.textContent = 'That file couldn’t be read.'; return; }
      if (!/-->/.test(text)) { subNote.textContent = `“${f.name}” doesn’t look like a subtitle file. Use an .srt or .vtt file.`; return; }
      if (!/^﻿?WEBVTT/.test(text)) text = srtToVtt(text);
      const cur = data();
      const usersubs = { ...cur.usersubs, [rec.id]: { name: f.name.slice(0, 120), text, at: Date.now() } };
      const ks = Object.keys(usersubs);
      if (ks.length > 12) ks.sort((a, b) => usersubs[b].at - usersubs[a].at).slice(12).forEach(k => delete usersubs[k]);
      put({ ...cur, usersubs });
      if (S.dead || detail !== D) return;
      if (D.video) attachTrack(D.video, text, 'My subtitles', 'en', true);
      subNote.textContent = D.video ? `Subtitles on (your file: ${f.name}). Press C to turn them off.` : `Your subtitles (${f.name}) are saved for this film and will show when it plays.`;
      paintMore();
    });
    function removeMySubs() {
      const cur = data();
      const usersubs = { ...cur.usersubs };
      delete usersubs[rec.id];
      put({ ...cur, usersubs });
      D.video?.querySelectorAll('track[data-mine]').forEach(t => t.remove());
      subNote.textContent = 'Your subtitle file was removed from this film.';
      paintMore();
      if (D.video) loadSubs(D.video);
    }

    /* ---- speed and subtitle keys: [ slower, ] faster, \ normal speed, C subtitles ---- */
    let keyTimer = 0;
    const say = t => { keyNote.textContent = t; clearTimeout(keyTimer); keyTimer = setTimeout(() => { keyNote.textContent = ''; }, 2500); D.timers.push(keyTimer); };
    function onKey(e) {
      if (S.dead || detail !== D || !D.video || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (win?.el && !win.el.classList.contains('is-active')) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const v = D.video;
      if (e.key === '[' || e.key === ']' || e.key === '\\') {
        e.preventDefault();
        let i = SPEEDS.indexOf(D.rate);
        if (i < 0) i = SPEEDS.indexOf(1);
        i = e.key === '\\' ? SPEEDS.indexOf(1) : Math.max(0, Math.min(SPEEDS.length - 1, i + (e.key === ']' ? 1 : -1)));
        D.rate = SPEEDS[i];
        v.playbackRate = D.rate;
        say(`Speed ${D.rate}×`);
      } else if (e.key === 'c' || e.key === 'C') {
        const tracks = [...v.textTracks];
        e.preventDefault();
        if (!tracks.length) { say('This film has no subtitles loaded. Add a file with “Add subtitles…”.'); return; }
        const on = tracks.some(x => x.mode === 'showing');
        if (on) tracks.forEach(x => { x.mode = 'hidden'; });
        else (tracks.find(x => x.default) || tracks[0]).mode = 'showing';
        say(on ? 'Subtitles off' : 'Subtitles on');
      }
    }
    window.addEventListener('keydown', onKey);
    keyNote.append(h('span', { text: 'Keys while a film plays: [ slower · ] faster · \\ normal speed · C subtitles on or off' }));
    function onFilmEnded() {
      const cur = data();
      const q = cur.queue.filter(x => x.id !== rec.id);
      if (q.length !== cur.queue.length) put({ ...cur, queue: q });
      if (S.dead || detail !== D) return;
      refreshChrome();
      const nxt = q[0];
      if (!nxt) return;
      let left = 5;
      let iv = 0;
      const msg = h('span.grow', { text: '' });
      const cancelBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'films:next:stop' }, onclick: () => { clearInterval(iv); banner.remove(); } }, h('span', { text: 'Stay here' }));
      const nowBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'films:next:now' }, onclick: () => go() }, icon('play', { fill: true }), h('span', { text: 'Play now' }));
      const banner = h('div.wf-banner.wf-next', { role: 'status', dataset: { next: nxt.id } }, icon('film'), msg, nowBtn, cancelBtn);
      const tick = () => { msg.textContent = `Up next in your double feature: ${nxt.title}. Starting in ${left} s.`; };
      const go = () => { clearInterval(iv); if (!S.dead && detail === D) openDetail(recOfStored(nxt.id, nxt), { fresh: true }); };
      tick();
      stage.append(banner);
      iv = setInterval(() => { left--; if (S.dead || detail !== D) { clearInterval(iv); return; } if (left <= 0) go(); else tick(); }, 1000);
      D.timers.push(iv);
    }

    /* ---- Save to Videos ---- */
    function askSave() {
      if (!D.file) return;
      const size = D.size;
      D.dl = { state: 'ask' };
      paintActs();
      paintDl();
      const first = dlBox.querySelector('[data-fk="films:confirm"]');
      first?.focus?.({ preventScroll: true });
    }
    function paintDl() {
      clear(dlBox);
      const d = D.dl;
      if (!d) return;
      const size = D.size;
      const sz = size ? fmt.fmtBytes(size) : 'an unknown size';
      if (d.state === 'ask') {
        dlBox.append(h('div.wf-ask',
          h('b', { text: `This file is ${sz}.` }),
          h('span', { text: ` It will be kept in ${tilde(`${HOME}/Videos`)} on this device and counts against this browser’s storage. It downloads while this window stays open${size > 1.5e9 ? '; a file this big may not fit in memory' : ''}.` }),
          h('div.wf-acts',
            h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'films:confirm' }, onclick: startSave }, icon('download'), h('span', { text: `Save ${size ? fmt.fmtBytes(size) : 'it'}` })),
            h('button.btn', { type: 'button', dataset: { fk: 'films:nosave' }, onclick: () => { D.dl = null; paintActs(); paintDl(); } }, h('span', { text: 'Not now' })))));
      } else if (d.state === 'run') {
        const total = d.total || size;
        const pct = total ? Math.min(100, Math.floor(d.got / total * 100)) : 0;
        dlBox.append(h('div.wf-prog',
          h('div.wf-prog__top', h('b', { text: 'Saving to Videos' }), h('span', { text: total ? `${fmt.fmtBytes(d.got)} of ${fmt.fmtBytes(total)} · ${pct}%` : `${fmt.fmtBytes(d.got)} so far` })),
          h('div.wf-meter', { role: 'progressbar', 'aria-label': `Saving ${rec.title}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('i', { style: { width: `${pct}%` } })),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'films:cancel' }, onclick: () => d.ac.abort() }, icon('x'), h('span', { text: 'Cancel' }))));
      } else if (d.state === 'done') {
        dlBox.append(h('div.wf-done', icon('check-circle'), h('span', { text: `Saved as ${tilde(d.path)} (${fmt.fmtBytes(d.bytes)}). It plays offline from Videos and can be shared in Watch Together.` })));
      } else if (d.state === 'cancel') {
        dlBox.append(h('div.wf-note', { text: 'Download cancelled. Nothing was saved.' }));
      } else if (d.state === 'blocked') {
        dlBox.append(h('div.wf-warn', { role: 'alert' }, icon('alert'),
          h('span', { text: 'archive.org blocked the direct download from this page (the request failed with no CORS permission), so StaticOS can’t put the file in Videos by itself.' }),
          h('a.btn.btn--sm', { href: `${fileUrl(rec.id, D.file.name)}?download=1`, target: '_blank', rel: 'noopener noreferrer', dataset: { fk: 'films:browser' } }, icon('download'), h('span', { text: 'Download with the browser' }))));
      } else if (d.state === 'fail') {
        dlBox.append(h('div.wf-warn', { role: 'alert' }, icon('alert'), h('span', { text: d.msg }),
          h('button.btn.btn--sm', { type: 'button', onclick: askSave }, h('span', { text: 'Try again' }))));
      }
    }
    async function startSave() {
      const dl = { state: 'run', got: 0, total: 0, ac: new AbortController() };
      D.dl = dl;
      paintActs();
      paintDl();
      let nextPaint = 0;
      try {
        const blob = await fetchFilm(rec, D.file, D.size, dl.ac.signal, (got, total) => {
          dl.got = got; dl.total = total;
          const n = performance.now();
          if (n >= nextPaint && detail === D) { nextPaint = n + 120; paintDl(); }
        });
        const out = await storeFilm(rec, blob);
        Object.assign(dl, { state: 'done', path: out.path, bytes: blob.size });
        note({ icon: 'film', title: 'Saved to Videos', message: rec.title });
      } catch (e) {
        if (e?.name === 'AbortError') dl.state = 'cancel';
        else if (e.kind === 'blocked') dl.state = 'blocked';
        else { dl.state = 'fail'; dl.msg = dlFail(e); }
      }
      if (S.dead || detail !== D) return;
      paintActs();
      paintDl();
    }
  }

  /* ---------------- what watch.js needs ---------------- */
  renderBar();
  renderList();
  return {
    el,
    /** called by watch.js each time it puts the view back on screen */
    attach() {
      if (S.dead) return;
      if (S.state === 'idle') search();
      else if (!detail) renderList();
      else { const v = detail.video; if (v && v.paused && !v.ended && v.dataset.wasPlaying) { v.play().catch(() => {}); } }
    },
    /** watch.js is about to rebuild its pane: a detached <video> would stop, so note it was playing */
    detach() { const v = detail?.video; if (v) v.dataset.wasPlaying = v.paused ? '' : '1'; },
    busy: () => !!detail && (!!detail.video || !!detail.frame || detail.dl?.state === 'run'),
    posterUrl, pageUrl,
    openById(id, title, opts) { openDetail({ id, title: title || id, year: 0, secs: 0, creator: '', desc: '', rights: { stated: false, line: 'Rights not stated by the uploader', url: '' }, downloads: 0, rating: 0, reviews: 0, subjects: [] }, opts); },
    destroy() {
      S.dead = true;
      searchAbort?.abort();
      closeDetail();
      clearTimeout(qTimer);
      timers.forEach(t => clearTimeout(t));
    },
  };
}
