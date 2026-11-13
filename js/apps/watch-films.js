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

   Positions are kept under portal.watchfilms { pos, saved } and read by
   watch.js for Continue Watching.
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

/* ================================================================
   the view
   ================================================================ */
export function createFilms({ api, win, note, remember, alive }) {
  const { h, icon, clear, store, vfs, fmt } = api;
  const HOME = vfs.HOME;
  const tilde = p => (p === HOME ? '~' : p.startsWith(HOME + '/') ? `~${p.slice(HOME.length)}` : p);

  const S = {
    f: { q: '', collection: 'all', genre: '', decade: '', sort: 'downloads' },
    state: 'idle',            /* idle | loading | ready | error */
    err: null, wait: '',
    items: [], total: 0, page: 0, hidden: { adult: 0, poster: 0 }, noPoster: new Set(),
    open: null,               /* the film shown in the detail view */
    dead: false,
  };
  let searchAbort = null;
  let detail = null;          /* the live detail view: { rec, el, video, abort, ... } */
  const timers = new Set();

  /* ---- saved places & saved copies, through the store ---- */
  const data = () => {
    const d = store.get(FILMS_KEY, {});
    return { pos: d && typeof d.pos === 'object' && d.pos ? d.pos : {}, saved: d && typeof d.saved === 'object' && d.saved ? d.saved : {} };
  };
  const put = next => store.set(FILMS_KEY, next);
  const inProgress = p => !!p && p.d >= MIN_LEN && p.t >= 2 && p.t < p.d - Math.max(3, p.d * 0.04);
  function savePos(rec, t, d) {
    if (!(d > 0) || !Number.isFinite(t)) return;
    const cur = data();
    const pos = { ...cur.pos };
    if (!inProgress({ t, d }) && t >= d - Math.max(3, d * 0.04)) delete pos[rec.id];
    else if (d >= MIN_LEN && t >= 2) pos[rec.id] = { t: Math.round(t * 10) / 10, d: Math.round(d * 10) / 10, at: Date.now(), title: rec.title, year: rec.year || 0 };
    else return;
    const keys = Object.keys(pos);
    if (keys.length > 40) keys.sort((a, b) => pos[b].at - pos[a].at).slice(40).forEach(k => delete pos[k]);
    put({ ...cur, pos });
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

  /* ---------------- search ---------------- */
  async function search(more = false) {
    searchAbort?.abort();
    const ac = new AbortController();
    searchAbort = ac;
    if (!more) { S.items = []; S.page = 0; S.total = 0; S.hidden = { adult: 0, poster: 0 }; S.noPoster = new Set(); }
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
      for (const d of docs) {
        if (looksAdult(d)) { S.hidden.adult++; continue; }
        const rec = toRec(d);
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

  /* ---------------- list view ---------------- */
  const el = h('div.wt-pad.wf');
  const bar = h('div.wf-bar');
  const status = h('div.wf-status', { role: 'status', 'aria-live': 'polite' });
  const grid = h('div.wf-grid', { role: 'list', 'aria-label': 'Films' });
  const listEl = h('div.wf-list');
  const detailEl = h('div.wf-detailhost', { hidden: true });
  el.append(listEl, detailEl);

  const select = (label, value, options, onchange) => h('label.wf-sel', h('span.sr', { text: label }),
    h('select', { 'aria-label': label, onchange: e => onchange(e.target.value) },
      options.map(([v, t]) => h('option', { value: v, text: t, selected: String(v) === String(value) ? true : null }))));

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
      select('Sort', S.f.sort, SORTS.map(s => [s.id, s.label]), v => { S.f.sort = v; search(); }));
  }

  function renderStatus() {
    clear(status);
    if (S.state === 'loading') {
      status.append(h('div.spinner'), h('span', { text: S.wait || (S.items.length ? 'Loading more…' : 'Asking archive.org…') }));
      return;
    }
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
      const n = S.items.length;
      const bits = [];
      bits.push(n ? `${n.toLocaleString()} shown of ${S.total.toLocaleString()} that archive.org lists with a playable MP4` : 'Nothing matches those filters.');
      if (S.hidden.adult) bits.push(`${S.hidden.adult.toLocaleString()} hidden by the content filter`);
      if (S.hidden.poster) bits.push(`${S.hidden.poster.toLocaleString()} hidden for having no poster`);
      status.append(h('span', { text: bits.join(' · ') }));
    }
  }

  function card(rec) {
    const art = h('div.wt-art.wt-art--poster.wf-art', { style: { '--art': 'linear-gradient(135deg,#2a2438,#15121f)' } },
      h('span.wt-art__mono', { 'aria-hidden': 'true', text: rec.title }));
    const img = h('img.wt-art__img', { alt: '', decoding: 'async', draggable: 'false' });   /* eager: the card stays hidden until it has a real poster */
    const c = h('div.wf-card', { role: 'listitem', hidden: true });
    const drop = () => { if (S.dead) return; S.noPoster.add(rec.id); S.hidden.poster = S.noPoster.size; c.remove(); S.items = S.items.filter(x => x !== rec); renderStatus(); };
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
      h('button.wf-card__main.wt-card__main', { type: 'button', 'aria-label': `${rec.title}${meta ? `, ${meta}` : ''}. ${rec.rights.line}.`, dataset: { fk: `film:${rec.id}` }, onclick: () => openDetail(rec) },
        art,
        h('span.wt-card__text', h('span.wt-card__t', { text: rec.title }), meta ? h('span.wt-card__m', { text: meta }) : null,
          h('span.wf-rights' + (rec.rights.stated ? '' : '.is-none'), { text: rec.rights.line }))));
    return c;
  }

  function renderList() {
    if (S.dead) return;
    renderStatus();
    clear(grid);
    for (const rec of S.items) grid.append(card(rec));
    clear(listEl);
    listEl.append(
      h('p.wt-lede', { text: 'Films from the Internet Archive’s public film collections: public-domain and Creative-Commons classics, silent films, sci-fi, noir, comedy and cartoons. You can stream them here or save a copy to your Videos. Everything shown comes from archive.org and its uploaders; this is not a catalogue StaticOS curated.' }),
      bar, status);
    if (S.items.length) listEl.append(grid);
    if (S.state === 'ready' && S.items.length < S.total && S.page > 0) {
      listEl.append(h('div.wf-more', h('button.btn', { type: 'button', dataset: { fk: 'films:more' }, onclick: () => search(true) }, icon('download'), h('span', { text: 'Show more' }))));
    }
    const saved = Object.keys(data().saved).map(id => ({ id, s: savedCopy(id) })).filter(x => x.s);
    if (saved.length && (S.state === 'error' || !S.items.length)) {
      listEl.append(h('h3.wf-h', { text: 'Saved on this device' }),
        h('div.wf-saved', saved.map(({ id, s }) => h('div.wf-saved__row',
          h('span.grow', { text: s.name || s.node.name }),
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: `films:saved:${id}` }, onclick: () => playSaved(s) }, icon('play', { fill: true }), h('span', { text: 'Play from Videos' }))))));
    }
    listEl.append(h('p.wt-foot', { text: 'The content filter hides items whose uploader-chosen collections, subjects or title carry adult labels. It works on those labels, so it is a filter, not a guarantee. Film data and pictures are from archive.org and belong to their uploaders and rights holders.' }));
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

  function openDetail(rec, { resume = false } = {}) {
    closeDetail();
    S.open = rec.id;
    S.lastOpened = rec.id;
    remember?.({ k: 'film', id: rec.id, title: rec.title });
    const ac = new AbortController();
    const D = {
      rec, ac, meta: null, file: null, subs: null, video: null, frame: null,
      dl: null,             /* { ac, got, total, state: 'ask'|'run'|'done'|'fail', ... } */
      timers: [], vurls: [],
      stop() {
        ac.abort();
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
          dlBox,
          subNote,
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
    };
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
      if (resume && D.file) { const p = data().pos[rec.id]; play(inProgress(p) ? p.t : 0); }
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
      v.addEventListener('ended', save);
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
    async function loadSubs(v) {
      subNote.textContent = '';
      if (!D.subs) { subNote.textContent = 'This item has no subtitle file.'; return; }
      subNote.textContent = 'Loading subtitles…';
      try {
        const res = await fetch(fileUrl(rec.id, D.subs.name, 'cors'), { signal: ac.signal });
        if (!res.ok) throw new Error(`http ${res.status}`);
        let text = await res.text();
        if (!/^﻿?WEBVTT/.test(text)) text = srtToVtt(text);
        if (S.dead || D.video !== v) return;
        const u = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
        D.vurls.push(u);
        const track = h('track', { kind: 'subtitles', label: /\.asr\./i.test(D.subs.name) ? 'Auto-generated' : 'Subtitles', srclang: 'en', src: u, default: true });
        v.append(track);
        track.track.mode = 'showing';
        subNote.textContent = `Subtitles on (${/\.asr\./i.test(D.subs.name) ? 'auto-generated by archive.org' : 'uploaded with the film'}: ${D.subs.name}). Use the player’s CC menu to turn them off.`;
      } catch (e) {
        if (e?.name === 'AbortError') return;
        subNote.textContent = 'This item has subtitles, but they didn’t load.';
      }
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
      const chunks = [];
      let nextPaint = 0;
      try {
        let res;
        const waits = delays();
        for (let a = 0; ; a++) {
          try { res = await fetch(fileUrl(rec.id, D.file.name, 'cors'), { signal: dl.ac.signal }); }
          catch (e) { if (e?.name === 'AbortError') throw e; const err = new Error('blocked'); err.kind = navigator.onLine === false ? 'offline' : 'blocked'; throw err; }
          if ((res.status === 503 || res.status === 429) && a < waits.length) { await sleep(waits[a], dl.ac.signal); continue; }
          break;
        }
        if (!res.ok) { const err = new Error(`http ${res.status}`); err.kind = res.status === 503 || res.status === 429 ? 'busy' : 'http'; err.status = res.status; throw err; }
        dl.total = Number(res.headers.get('content-length')) || D.size || 0;
        const reader = res.body?.getReader?.();
        if (!reader) { chunks.push(new Uint8Array(await res.arrayBuffer())); dl.got = chunks[0].length; }
        else for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          dl.got += value.length;
          const n = performance.now();
          if (n >= nextPaint && detail === D) { nextPaint = n + 120; paintDl(); }
        }
        if (dl.got === 0) throw Object.assign(new Error('empty'), { kind: 'http', status: 0 });
        const blob = new Blob(chunks, { type: 'video/mp4' });
        chunks.length = 0;
        const stem = `${rec.title}${rec.year ? ` (${rec.year})` : ''}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
        const out = await media.save(`${HOME}/Videos`, `${stem}.mp4`, blob);
        const cur = data();
        put({ ...cur, saved: { ...cur.saved, [rec.id]: { path: out.path, name: out.node.name, at: Date.now(), size: blob.size } } });
        Object.assign(dl, { state: 'done', path: out.path, bytes: blob.size });
        note({ icon: 'film', title: 'Saved to Videos', message: rec.title });
      } catch (e) {
        chunks.length = 0;
        if (e?.name === 'AbortError') dl.state = detail === D || !S.dead ? 'cancel' : 'cancel';
        else if (e.kind === 'blocked') dl.state = 'blocked';
        else {
          dl.state = 'fail';
          dl.msg = e.kind === 'offline' ? 'You went offline, so the download stopped and nothing was saved.'
            : e.kind === 'busy' ? 'archive.org is overloaded (503) and kept refusing the download. Nothing was saved; try again in a minute.'
              : e.kind === 'http' ? `archive.org answered with an error (HTTP ${e.status}). Nothing was saved.`
                : `The file couldn’t be saved: ${String(e?.message || e)}`;
        }
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
