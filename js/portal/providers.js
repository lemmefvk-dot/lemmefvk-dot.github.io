/* ============================================================
   providers.js — the Static data seam.

   Every Static page (search, games, movies) asks for its data
   HERE and nowhere else. Today the answers come from the local
   catalogues below. When the proxy backend exists, set

       import { config } from './providers.js';
       config.mode     = 'proxy';
       config.endpoint = 'https://your-host/api';

   …and the same pages start showing live data. Nothing in the
   UI layer knows the difference: every function returns the
   same shape whichever mode is active.

   Contract
     searchWeb(q, {page})  -> {query,page,total,took,answer,results[],related[]}
     listGames({...})      -> {items[], total, categories[]}
     listMovies({...})     -> {items[], total, categories[]}
     getGame(id)/getMovie(id) -> item | null
     resolve(target, {episode, start})
                           -> {kind:'embed'|'unavailable'|'blocked', url?, reason?}
     trending()            -> {games[], movies[], queries[]}
   ============================================================ */

import { GAMES, MOVIES, GAME_CATEGORIES, MOVIE_CATEGORIES, PROXY_LINKS, POSITIONS } from './catalog.js';
import * as bigCatalog from './anime.data.js';
import * as gameCatalog from './games.data.js';

export { GAMES, MOVIES, GAME_CATEGORIES, MOVIE_CATEGORIES, PROXY_LINKS, POSITIONS };

export const config = {
  /** 'local' = the catalogues in this file. 'proxy' = fetch from `endpoint`. */
  mode: 'local',
  /** Base URL of the Static proxy API, e.g. 'https://Static.example/api'. */
  endpoint: null,
  /** Sent as ?key= when the proxy wants one. */
  key: null,
  /** Network timeout for proxy calls, ms. */
  timeout: 8000,
  /** Flip to true and the local mode pretends the proxy is down — handy for
      building the error states without a backend. */
  simulateOutage: false,

  /**
   * AUTO-EMBED. One template, every title — nothing is wired per-anime, so
   * anything the live catalogue gains plays the moment it appears.
   *
   * Placeholders, filled from the record itself:
   *   {tmdb} {imdb} {anilist} {mal} {mangadex}
   *   {season} {episode} {type}    ({type} is 'tv' or 'movie')
   *   {dub}                        ('sub' or 'dub')
   *   {start}                      (whole seconds to start at — 0 unless
   *                                 Static Anime is resuming an episode)
   *
   *   config.animeSource = 'https://your-host/embed/{type}/{tmdb}/{season}/{episode}';
   *
   * Leave it null and anime resolve() stays 'unavailable' with its reason.
   * `animeSources` lets you keep several and switch with `animeSourceId`.
   */
  animeSource: null,
  animeSources: {},        // { name: templateString, … }
  animeSourceId: null,     // pick one of animeSources by name
  movieSource: null,       // same placeholders, for the film catalogue
  dub: 'sub',
};

/* ------------------------------------------------------------------ *
 *  proxy transport — one place, so auth/retries live in one spot
 * ------------------------------------------------------------------ */
async function callProxy(path, params = {}) {
  if (!config.endpoint) throw new ProviderError('no-endpoint', 'No proxy endpoint configured.');
  const url = new URL(config.endpoint.replace(/\/$/, '') + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  if (config.key) url.searchParams.set('key', config.key);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new ProviderError('http-' + res.status, `Proxy returned ${res.status}.`);
    return await res.json();
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(err.name === 'AbortError' ? 'timeout' : 'network',
      err.name === 'AbortError' ? 'The proxy did not answer in time.' : 'Could not reach the proxy.');
  } finally {
    clearTimeout(timer);
  }
}

export class ProviderError extends Error {
  constructor(code, message) { super(message); this.name = 'ProviderError'; this.code = code; }
}

const local = () => config.mode !== 'proxy';

/* ------------------------------------------------------------------ *
 *  deterministic cover art — no image assets anywhere in Static
 * ------------------------------------------------------------------ */
export function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A CSS background for a poster/thumb, stable for a given title. */
export function artFor(title, kind = 'game') {
  const h = hashOf(title + kind);
  const a = h % 360;
  const b = (a + 40 + (h >> 8) % 90) % 360;
  const tilt = 120 + (h >> 4) % 90;
  const s = kind === 'movie' ? 46 : 62;
  return [
    `radial-gradient(70% 60% at ${20 + (h >> 6) % 50}% ${15 + (h >> 10) % 40}%,hsl(${b} ${s}% 58% / .85),transparent 62%)`,
    `radial-gradient(60% 70% at ${55 + (h >> 12) % 35}% ${70 + (h >> 14) % 25}%,hsl(${(b + 190) % 360} ${s}% 46% / .7),transparent 66%)`,
    `linear-gradient(${tilt}deg,hsl(${a} ${s}% 30%),hsl(${(a + 320) % 360} ${s - 14}% 12%))`,
  ].join(',');
}

/* ------------------------------------------------------------------ *
 *  local catalogues — the real data lives in catalog.js
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 *  search: local index over the catalogues + the OS filesystem
 * ------------------------------------------------------------------ */
const WEB_SEED = [
  ['Static', 'static://home', 'The Static start page — games, movies and search in one place.'],
  ['StaticOS', 'static://about', 'StaticOS, the desktop shell Static runs inside.'],
];

const PER_PAGE = 8;


/* Roblox rows, but only if something has already loaded them. Kept as a
   function so searchWeb never reaches into module state that may not exist
   yet, and never triggers a fetch of its own. */
let robloxMod = null;
import('./roblox.data.js').then(m => { robloxMod = m; }).catch(() => { robloxMod = null; });
const robloxRows = () => (robloxMod && robloxMod.isLoaded() ? robloxMod.all() : []);

export async function searchWeb(q, { page = 1 } = {}) {
  const query = String(q || '').trim();
  const t0 = performance.now();
  if (!query) return { query, page, total: 0, took: 0, answer: null, results: [], related: [] };

  if (!local()) {
    const data = await callProxy('/search', { q: query, page });
    return { query, page, took: data.took ?? 0, total: data.total ?? (data.results || []).length,
             answer: data.answer ?? null, results: data.results || [], related: data.related || [] };
  }
  if (config.simulateOutage) throw new ProviderError('network', 'Could not reach the proxy.');

  const low = query.toLowerCase();
  const hits = [];

  const gameRows = gameCatalog.isLoaded() ? gameCatalog.all() : GAMES;
  for (const g of gameRows) {
    if (!matches(low, [g.title, g.studio, ...g.tags, ...g.cats])) continue;
    hits.push({ title: `${g.title} — play free on Static`, url: `static://games/${g.id}`,
      /* plays and rating only where a feed measured them: everything else carries 0 */
      snippet: `${g.studio}${g.plays > 0 ? ` · ${fmtPlays(g.plays)} plays · ★ ${Number(g.rating || 0).toFixed(1)}` : ''}. ${gameCatalog.opensOnTheirSite(g)
        ? 'Opens on their own site, in a new tab.'
        : 'Plays right here in Static — no download.'}`,
      kind: 'game', icon: 'gamepad', score: 3 + rel(low, g.title) });
  }
  for (const m of MOVIES) {
    if (!matches(low, [m.title, String(m.year), ...m.genres, ...m.cats])) continue;
    hits.push({ title: `${m.title} (${m.year})`, url: `static://movies/${m.id}`,
      snippet: `${m.genres.join(' · ')} · ★ ${m.rating.toFixed(1)} · ${m.runtime} min. ${m.synopsis}`,
      kind: 'movie', icon: 'film', score: 3 + rel(low, m.title) });
  }
  /* Roblox is folded in the same way the games catalogue is: 1,311
     experiences with real player counts, already in memory once the Roblox
     page or a previous search has loaded them. Unlike the anime catalogue
     this one is small enough (1.3 MB) that loading it here is cheap, but it
     is still only read when present — a search should never block on a
     fetch it did not ask for. */
  const rbx = robloxRows();
  for (const r of rbx) {
    if (!matches(low, [r.name, r.creator, ...(r.cats || [])])) continue;
    const playing = r.playing ? `${fmtPlays(r.playing)} playing now · ` : '';
    const rated = r.rating ? `${r.rating}% rated · ` : '';
    hits.push({
      title: `${r.name} — Roblox`,
      url: `static://roblox/${r.id}`,
      snippet: `${playing}${rated}by ${r.creator || 'Roblox'}. ${
        (r.desc || '').slice(0, 140) || 'Opens in the Roblox player.'}`,
      kind: 'roblox', icon: 'box', score: 3 + rel(low, r.name),
    });
  }

  /* The 7,963-title anime catalogue is a 7.9 MB fetch, so unified search only
     folds it in once something else has already loaded it (the Anime page, or
     a previous anime search). The Anime tab loads it deliberately. */
  if (bigCatalog.isLoaded('anime')) {
    for (const a of bigCatalog.query({ q: query, perPage: 6 }).items) {
      hits.push({
        title: `${a.title}${a.year ? ` (${a.year})` : ''}`,
        url: `static://anime/${a.id}`,
        snippet: `${a.genres.slice(0, 3).join(' \u00b7 ')}${a.score ? ` \u00b7 \u2605 ${a.score}` : ''}`
               + `${a.episodes ? ` \u00b7 ${a.episodes} eps` : ''}. ${a.synopsis.slice(0, 150)}`,
        kind: 'anime', icon: 'star', image: a.image, score: 3 + rel(low, a.title),
      });
    }
  }
  if (bigCatalog.isLoaded('manga')) {
    for (const m of bigCatalog.query({ kind: 'manga', q: query, perPage: 3 }).items) {
      hits.push({
        title: `${m.title} (manga)`, url: `static://manga/${m.id}`,
        snippet: `${m.genres.slice(0, 3).join(' \u00b7 ')}${m.score ? ` \u00b7 \u2605 ${m.score}` : ''}. ${m.synopsis.slice(0, 140)}`,
        kind: 'manga', icon: 'file-text', image: m.image, score: 2.5 + rel(low, m.title),
      });
    }
  }

  for (const [title, url, snippet] of WEB_SEED) {
    if (!matches(low, [title, snippet])) continue;
    hits.push({ title, url, snippet, kind: 'page', icon: 'diamond', score: 2 + rel(low, title) });
  }

  /* results that look like the open web, so the page reads correctly
     before the proxy is wired up */
  for (const host of ['wikipedia.org', 'reddit.com', 'github.com', 'youtube.com', 'stackoverflow.com']) {
    hits.push({
      title: `${titleCase(query)} — ${host.split('.')[0]}`,
      url: `https://${host}/search?q=${encodeURIComponent(query)}`,
      snippet: `Results for “${query}” on ${host}. Opening this needs the Static proxy; it is not connected yet.`,
      kind: 'web', icon: 'globe', score: 1, external: true,
    });
  }

  hits.sort((a, b) => b.score - a.score);
  const start = (page - 1) * PER_PAGE;
  return {
    query, page, total: hits.length,
    took: Math.round(performance.now() - t0) + 4,
    answer: instantAnswer(query),
    results: hits.slice(start, start + PER_PAGE),
    related: related(query),
  };
}

const matches = (low, fields) => fields.some(f => String(f).toLowerCase().includes(low));
const rel = (low, title) => { const i = title.toLowerCase().indexOf(low); return i < 0 ? 0 : (i === 0 ? 2 : 1); };
const titleCase = s => s.charAt(0).toUpperCase() + s.slice(1);
/* ------------------------------------------------------------------ *
 *  auto-embed — build a player URL from a record's own ids
 * ------------------------------------------------------------------ */

/** Does the template in force for a kind have this {placeholder}? Static Anime
    uses it to say honestly whether a source can be told the episode or the
    second to start at. */
export const templateTakes = (kind, key) => new RegExp(`\\{${key}\\}`).test(templateFor(kind) || '');

/** The template currently in force for a kind. */
export function templateFor(kind = 'anime') {
  if (kind === 'movie') return config.movieSource || null;
  if (config.animeSourceId && config.animeSources[config.animeSourceId]) {
    return config.animeSources[config.animeSourceId];
  }
  return config.animeSource || null;
}

/**
 * embedFor(record, {season, episode, dub, template}) -> url | null
 * Returns null when no template is configured, or when the template needs an
 * id this record does not carry (so a half-filled URL is never produced).
 */
export function embedFor(rec, opts = {}) {
  if (!rec) return null;
  const tpl = opts.template || templateFor(rec.kind === 'movie' ? 'movie' : 'anime');
  if (!tpl) return null;

  const isMovie = rec.kind === 'movie'
    || /movie/i.test(rec.mediaType || '')
    || (rec.episodes === 1 && !rec.chapters);
  const vals = {
    tmdb: rec.tmdbId ?? '', imdb: rec.imdbId ?? '', anilist: rec.anilistId ?? '',
    mal: rec.malId ?? rec.id ?? '', mangadex: rec.mangadexId ?? '',
    season: opts.season ?? rec.tmdbSeason ?? 1,
    episode: opts.episode ?? 1,
    start: Math.max(0, Math.floor(Number(opts.start) || 0)),
    type: isMovie ? 'movie' : 'tv',
    dub: opts.dub || config.dub || 'sub',
  };

  let missing = null;
  const url = tpl.replace(/\{(\w+)\}/g, (m, key) => {
    const v = vals[key];
    if (v === '' || v === null || v === undefined) { missing = missing || key; return m; }
    return encodeURIComponent(String(v));
  });
  return missing ? null : url;
}

export const fmtPlays = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

/** Calculator / unit answers — the "instant answer" card above results. */
function instantAnswer(q) {
  const expr = q.replace(/\s+/g, '');
  if (/^[-+*/().\d%^]+$/.test(expr) && /[-+*/^%]/.test(expr)) {
    const v = evalArithmetic(expr);
    if (v !== null) return { kind: 'calc', label: q, value: formatNumber(v) };
  }
  const t = q.toLowerCase().match(/^(-?[\d.]+)\s*(c|f)\s*(to|in)\s*(c|f)$/);
  if (t) {
    const n = parseFloat(t[1]);
    const out = t[2] === t[4] ? n : t[2] === 'c' ? n * 9 / 5 + 32 : (n - 32) * 5 / 9;
    return { kind: 'convert', label: `${n}°${t[2].toUpperCase()}`, value: `${formatNumber(out)}°${t[4].toUpperCase()}` };
  }
  if (/^(time|what time is it)$/i.test(q)) {
    return { kind: 'time', label: 'Current time', value: new Date().toLocaleTimeString() };
  }
  return null;
}

/**
 * Recursive-descent arithmetic — no eval(), no Function().
 * Grammar (tightest binding last):
 *   expr  := term  (('+' | '-') term)*
 *   term  := unary (('*' | '/' | '%') unary)*
 *   unary := ('-' | '+') unary | power
 *   power := atom ('^' unary)?          // right-associative
 *   atom  := number | '(' expr ')'
 * Returns null for anything malformed or non-finite.
 */
export function evalArithmetic(src) {
  const s = String(src).replace(/\s+/g, '');
  if (!s) return null;
  let i = 0;
  const at = () => s[i];

  function expr() {
    let v = term();
    while (at() === '+' || at() === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    while (at() === '*' || at() === '/' || at() === '%') {
      const op = s[i++];
      const r = unary();
      if ((op === '/' || op === '%') && r === 0) throw new Error('divide by zero');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function unary() {
    if (at() === '-') { i++; return -unary(); }
    if (at() === '+') { i++; return unary(); }
    return power();
  }
  function power() {
    const base = atom();
    if (at() === '^') { i++; return base ** unary(); }
    return base;
  }
  function atom() {
    if (at() === '(') {
      i++;
      const v = expr();
      if (s[i] !== ')') throw new Error('unbalanced');
      i++;
      return v;
    }
    const m = /^\d+\.?\d*|^\.\d+/.exec(s.slice(i));
    if (!m) throw new Error('expected a number');
    i += m[0].length;
    return parseFloat(m[0]);
  }

  try {
    const v = expr();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return v;
  } catch (err) {
    return null;
  }
}

export function formatNumber(v) {
  if (!Number.isFinite(v)) return '—';
  const r = Math.round(v * 1e10) / 1e10;
  return Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-6 && r !== 0)
    ? r.toExponential(6) : r.toLocaleString(undefined, { maximumFractionDigits: 10 });
}

function related(q) {
  const base = q.trim().toLowerCase();
  return ['unblocked', 'free online', 'no download', '2 player', 'full movie', 'hd']
    .map(s => `${base} ${s}`).slice(0, 6);
}

/* ------------------------------------------------------------------ *
 *  catalogue queries
 * ------------------------------------------------------------------ */
function filterList(list, { category = 'all', q = '', sort = 'popular' } = {}) {
  const low = String(q || '').trim().toLowerCase();
  let items = list.filter(it =>
    (category === 'all' || it.cats.includes(category)) &&
    (!low || matches(low, [it.title, it.studio || '', ...(it.genres || []), ...(it.tags || [])])));
  const by = {
    popular: (a, b) => (b.plays || b.rating * 1e5) - (a.plays || a.rating * 1e5),
    rating: (a, b) => b.rating - a.rating,
    az: (a, b) => a.title.localeCompare(b.title),
    newest: (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title),
  };
  items = [...items].sort(by[sort] || by.popular);
  return items;
}

export async function listGames(opts = {}) {
  if (!local()) {
    const d = await callProxy('/games', opts);
    const items = remember((d.items || []).map(g => ({ kind: 'game', ...g })));
    return { items, total: d.total ?? items.length, categories: d.categories || GAME_CATEGORIES };
  }
  if (config.simulateOutage) throw new ProviderError('network', 'Could not reach the proxy.');

  /* data/games.json is generated by tools/sync-games.mjs from the live feeds;
     if it is missing, the loader falls back to the curated shelf on its own. */
  await gameCatalog.load();
  const { items, total, page, pages } = gameCatalog.query(opts);
  remember(items);
  return { items, total, page, pages, categories: GAME_CATEGORIES, counts: gameCatalog.counts() };
}

export async function listMovies(opts = {}) {
  if (!local()) {
    const d = await callProxy('/movies', opts);
    const items = remember((d.items || []).map(m => ({ kind: 'movie', ...m })));
    return { items, total: d.total ?? items.length, categories: d.categories || MOVIE_CATEGORIES };
  }
  if (config.simulateOutage) throw new ProviderError('network', 'Could not reach the proxy.');
  const items = filterList(MOVIES, { sort: 'popular', ...opts });
  return { items, total: items.length, categories: MOVIE_CATEGORIES };
}

/* Anything a list/trending call has handed out is remembered here, so a detail
   page can still find an item the PROXY supplied — `GAMES`/`MOVIES` only hold
   the local catalogue, and without this every proxy-only title would list fine
   and then 404 on its own detail page. Sync, because the pages call it sync. */
const seen = new Map();
const remember = items => {
  for (const it of items || []) if (it && it.id) seen.set(`${it.kind || 'item'}:${it.id}`, it);
  return items;
};

const idsOf = row => (row ? {
  mal: row.malId, tmdb: row.tmdbId, imdb: row.imdbId,
  anilist: row.anilistId, season: row.tmdbSeason, mangadex: row.mangadexId,
} : null);

export const getGame = id =>
  GAMES.find(g => g.id === id) || gameCatalog.byId(id) || seen.get(`game:${id}`) || null;
export const getMovie = id =>
  MOVIES.find(m => m.id === id) || seen.get(`movie:${id}`) || null;

export async function trending() {
  if (!local()) {
    const d = await callProxy('/trending');
    remember((d.games || []).map(g => ({ kind: 'game', ...g })));
    remember((d.movies || []).map(m => ({ kind: 'movie', ...m })));
    return d;
  }
  return {
    games: filterList(GAMES, { category: 'featured' }).slice(0, 6),
    movies: filterList(MOVIES, { category: 'trending' }).slice(0, 6),
    queries: ['slope unblocked', 'retro bowl', 'dune part two', 'arcane season 2', '2 player games', 'eaglercraft'],
  };
}

/* ------------------------------------------------------------------ *
 *  resolve — the one call the proxy will really own
 * ------------------------------------------------------------------ */
export async function resolve(target, opts = {}) {
  const [k0, id0] = String(target || '').split(':');

  if (!local()) {
    let d = null;
    try { d = await callProxy('/resolve', { target }); } catch (err) { d = null; }
    if (d && d.kind === 'embed' && d.url) return { kind: 'embed', url: d.url, reason: d.reason };
    /* The proxy did not answer for this one. A game that carries its own
       frameable embed can still play, so fall back rather than going dark. */
    if (k0 === 'game') {
      const g = getGame(id0);
      if (g && g.embed) return { kind: 'embed', url: g.embed, open: g.open, direct: true };
    }
    return { kind: d?.kind || 'unavailable', url: d?.url, reason: d?.reason
      || 'The proxy did not return a source for this.' };
  }
  if (config.simulateOutage) throw new ProviderError('network', 'Could not reach the proxy.');

  /* Games carry their own embed URL and their hosts allow framing, so they
     resolve locally — no proxy required. */
  const [kind, id] = String(target || '').split(':');
  if (kind === 'game') {
    const g = getGame(id);   /* local catalogue, or one the proxy handed out */
    if (g && g.embed) return { kind: 'embed', url: g.embed, open: g.open, direct: true };
    return { kind: 'unavailable', reason: 'No source is on file for that game yet.' };
  }

  if (kind === 'anime' || kind === 'manga') {
    const row = bigCatalog.byId(id, kind);
    /* auto-embed: one template in config, filled from this record's own ids */
    const ep = Math.max(1, Math.floor(Number(opts.episode) || 1));
    const auto = kind === 'anime' ? embedFor(row, { episode: ep, start: opts.start }) : null;
    if (auto) {
      return {
        kind: 'embed', url: auto, auto: true, ids: idsOf(row), episode: ep,
        /* what the source can be told: an episode, a second to start at */
        takesEpisode: templateTakes('anime', 'episode'),
        takesStart: templateTakes('anime', 'start'),
      };
    }
    return {
      kind: 'unavailable',
      ids: idsOf(row),
      reason: 'Static holds the catalogue, not the video. Wire a source into '
            + 'providers.resolve() \u2014 every record already carries its MAL, TMDB, '
            + 'IMDb and AniList ids, which is all a player needs.',
    };
  }

  if (kind === 'movie') {
    const m = getMovie(id);
    const auto = embedFor({ ...(m || {}), kind: 'movie' });
    if (auto) return { kind: 'embed', url: auto, auto: true };
  }

  /* Everything else (arbitrary web pages) needs the proxy. */
  return {
    kind: 'unavailable',
    reason: 'Static does not host this. Streaming it needs the Static proxy, which is not '
          + 'connected yet \u2014 set providers.config.endpoint and config.mode = "proxy".',
  };
}

export const bigCatalogue = bigCatalog;
export const gameCatalogue = gameCatalog;

export const providers = {
  config, searchWeb, bigCatalogue: bigCatalog, gameCatalogue: gameCatalog,
  embedFor, templateFor, templateTakes, listGames, listMovies, getGame, getMovie, trending, resolve,
  artFor, hashOf, fmtPlays, evalArithmetic, formatNumber,
  GAMES, MOVIES, GAME_CATEGORIES, MOVIE_CATEGORIES, PROXY_LINKS, POSITIONS, ProviderError,
};
export default providers;
