/* ============================================================
   anime.data.js — lazy loader + index for the big catalogues.

   data/anime.json  7,963 titles   (MyAnimeList metadata + art)
   data/manga.json  1,200 titles   (MangaDex ids)

   Both are fetched ONCE, on first use, and then served from
   memory. Nothing here touches the DOM, so pages can await it
   while showing skeletons.

   Every record keeps its external ids — tmdbId, imdbId,
   anilistId, id (MAL), tmdbSeason, mangadexId — so a playback
   source can be plugged into providers.resolve() later without
   re-importing any data.
   ============================================================ */

const URLS = { anime: 'data/anime.json', manga: 'data/manga.json' };

/**
 * Auto-sync. `remote` is checked FIRST, so anything added to the live site
 * shows up here with no rebuild; the bundled JSON is the offline fallback.
 * Set `remote.anime = null` to pin the catalogue to the local snapshot.
 */
export const sync = {
  remote: {
    anime: 'https://anicade.surge.sh/js/data/anime_data.json',
    manga: 'https://anicade.surge.sh/js/data/manga_data.json',
  },
  timeout: 9000,
  /** filled in after a load: 'remote' | 'local', plus the row count and time */
  status: { anime: null, manga: null },
  /**
   * The live read is cross-origin, so the host has to allow it. On surge.sh
   * that is one file in the SOURCE site's project root:
   *
   *     echo '*' > CORS && surge . anicade.surge.sh
   *
   * Until that header is present the browser blocks the read and we fall back
   * to the bundled snapshot (refresh it with `node tools/sync-anime.mjs`).
   * A blocked host is remembered for the session so we do not retry — and do
   * not log the same network error — on every navigation.
   */
  blocked: {},
};

const cache = { anime: null, manga: null };
const inflight = {};

/** Resolve the data path whether Static is served from / or a subfolder. */
function dataUrl(kind) {
  const base = new URL('.', new URL('../../', import.meta.url)).href;
  return new URL(URLS[kind], base).href;
}

async function fetchRows(url, { timeout = sync.timeout } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await fetch(url, { cache: 'no-cache', signal: ctrl?.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error('empty catalogue');
    return rows;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Can we actually read this cross-origin URL? A HEAD request is subject to
 * the same CORS rules as the GET but transfers no body, so a host missing
 * the header fails here for free instead of after a multi-megabyte download.
 */
async function corsOk(url, { timeout = 6000 } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-cache', mode: 'cors', signal: ctrl?.signal });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    /* a CORS refusal lands here as a TypeError, same as a network failure */
    return { ok: false, why: String(err && err.message || err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Load a catalogue. The live site wins when it answers; the bundled snapshot
 * is used when it does not, so the portal still works offline.
 * `load(kind, { force: true })` re-checks the live site.
 */
export async function load(kind = 'anime', { force = false } = {}) {
  if (cache[kind] && !force) return cache[kind];
  if (inflight[kind]) return inflight[kind];

  inflight[kind] = (async () => {
    const t0 = Date.now();
    let rows = null;
    let from = 'local';

    const remote = sync.remote[kind];
    if (remote && !sync.blocked[remote]) {
      /* Ask for the headers first. Without this a host that serves the file
         but no Access-Control-Allow-Origin makes the browser download every
         byte — all 7.9 MB of the anime catalogue — and only then refuse to
         let us read it, so the fallback pays for the snapshot a second time.
         A HEAD carries no body, so a blocked host now costs headers, not
         megabytes. */
      const reachable = await corsOk(remote);
      if (!reachable.ok) {
        sync.blocked[remote] = reachable.why;
      } else {
        try {
          rows = await fetchRows(remote);
          from = 'remote';
        } catch (err) {
          rows = null;
          sync.blocked[remote] = String(err.message || err);
        }
      }
    }
    if (!rows) rows = await fetchRows(dataUrl(kind), { timeout: 30000 });

    cache[kind] = rows.map(normalize);
    buildIndex(kind);
    sync.status[kind] = {
      source: from, rows: cache[kind].length, ms: Date.now() - t0,
      url: from === 'remote' ? remote : dataUrl(kind),
      remoteBlocked: remote ? sync.blocked[remote] || null : null,
    };
    return cache[kind];
  })();

  try { return await inflight[kind]; } finally { delete inflight[kind]; }
}

/** Re-check the live site and swap the catalogue in if it answers.
    Clears the session's blocked flag, so this retries even after a CORS miss. */
export const refresh = (kind = 'anime') => {
  const remote = sync.remote[kind];
  if (remote) delete sync.blocked[remote];
  return load(kind, { force: true });
};
export const syncStatus = (kind = 'anime') => sync.status[kind];

export const peek = (kind = 'anime') => cache[kind];
export const isLoaded = (kind = 'anime') => !!cache[kind];

function normalize(r) {
  return {
    id: String(r.id),
    kind: r.type === 'manga' ? 'manga' : 'anime',
    title: r.title,
    titleJa: r.titleJapanese || '',
    image: r.image || '',
    backdrop: r.backdrop || r.image || '',
    synopsis: (r.synopsis || '').replace(/\s*\[Written by MAL Rewrite\]\s*$/i, '').trim(),
    score: typeof r.score === 'number' ? r.score : null,
    episodes: r.episodes ?? null,
    chapters: r.chapters ?? null,
    status: r.status || '',
    rating: r.rating || r.contentRating || '',
    year: r.year || null,
    season: r.season || '',
    genres: r.genres || [],
    mediaType: r.mediaType || '',
    /* external ids — the hooks a playback source needs */
    /* A manga row's `id` IS its MangaDex uuid, so it must not masquerade as a
       MyAnimeList id — consumers print it as "MyAnimeList #<uuid>" otherwise. */
    malId: r.type === 'manga' ? null : r.id,
    tmdbId: r.tmdbId ?? null, imdbId: r.imdbId ?? null,
    anilistId: r.anilistId ?? null, tmdbSeason: r.tmdbSeason ?? null,
    mangadexId: r.mangadexId ?? null,
    playable: false,
  };
}

/* ------------------------------------------------------------------ *
 *  index — genres, years, seasons, and a cheap title search
 * ------------------------------------------------------------------ */
const index = { anime: null, manga: null };

function buildIndex(kind) {
  const rows = cache[kind];
  const genres = new Map();
  const years = new Map();
  for (const r of rows) {
    for (const g of r.genres) genres.set(g, (genres.get(g) || 0) + 1);
    if (r.year) years.set(r.year, (years.get(r.year) || 0) + 1);
  }
  index[kind] = {
    genres: [...genres.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: id, n })),
    years: [...years.keys()].sort((a, b) => b - a),
    search: rows.map(r => `${r.title}\u0000${r.titleJa}`.toLowerCase()),
  };
}

export const genresOf = (kind = 'anime') => index[kind]?.genres || [];
export const yearsOf  = (kind = 'anime') => index[kind]?.years || [];

const SORTS = {
  score:    (a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title),
  newest:   (a, b) => (b.year || 0) - (a.year || 0) || (b.score || 0) - (a.score || 0),
  oldest:   (a, b) => (a.year || 9999) - (b.year || 9999),
  az:       (a, b) => a.title.localeCompare(b.title),
  episodes: (a, b) => (b.episodes || b.chapters || 0) - (a.episodes || a.chapters || 0),
};
export const SORT_OPTIONS = [
  { id: 'score', name: 'Top rated' },
  { id: 'newest', name: 'Newest' },
  { id: 'az', name: 'A–Z' },
  { id: 'episodes', name: 'Most episodes' },
  { id: 'oldest', name: 'Oldest' },
];

/**
 * query({kind,q,genre,year,status,sort,page,perPage})
 *   -> {items, total, page, pages, genres, years}
 * Pure function over the loaded rows — safe to call on every keystroke.
 */
export function query({
  kind = 'anime', q = '', genre = '', year = '', status = '',
  sort = 'score', page = 1, perPage = 36,
} = {}) {
  const rows = cache[kind] || [];
  const low = String(q).trim().toLowerCase();
  const idx = index[kind];

  let items = rows;
  if (low) {
    const hay = idx?.search;
    items = rows.filter((r, i) => (hay ? hay[i] : `${r.title} ${r.titleJa}`.toLowerCase()).includes(low));
  }
  if (genre) items = items.filter(r => r.genres.includes(genre));
  if (year) items = items.filter(r => String(r.year) === String(year));
  if (status) items = items.filter(r => r.status === status);

  items = [...items].sort(SORTS[sort] || SORTS.score);

  /* an exact-ish title match should outrank a merely higher score */
  if (low) {
    items.sort((a, b) => rank(b, low) - rank(a, low)
      || (SORTS[sort] || SORTS.score)(a, b));
  }

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return {
    items: items.slice((p - 1) * perPage, p * perPage),
    total, page: p, pages,
    genres: genresOf(kind), years: yearsOf(kind),
  };
}

function rank(r, low) {
  const t = r.title.toLowerCase();
  if (t === low) return 3;
  if (t.startsWith(low)) return 2;
  if (t.includes(low)) return 1;
  return 0;
}

export const byId = (id, kind = 'anime') =>
  (cache[kind] || []).find(r => r.id === String(id)) || null;

/** The status that means "still coming out", per catalogue. */
export const LIVE_STATUS = { anime: 'Currently Airing', manga: 'Ongoing' };

/**
 * A few curated rails for the landing view. `live` overrides the status that
 * counts as currently-releasing; manga say "Ongoing", never "Currently Airing",
 * so hardcoding the anime wording silently dropped the rail for 696 titles.
 */
export function rails(kind = 'anime', live = LIVE_STATUS[kind]) {
  const rows = cache[kind] || [];
  const top = [...rows].sort(SORTS.score);
  const airing = rows.filter(r => r.status === live).sort(SORTS.score);
  const recent = [...rows].sort(SORTS.newest);
  const pick = g => rows.filter(r => r.genres.includes(g)).sort(SORTS.score).slice(0, 18);
  return [
    { id: 'airing', title: kind === 'manga' ? 'Ongoing' : 'Airing now',
      icon: 'activity', items: airing.slice(0, 18) },
    { id: 'top', title: 'Top rated', icon: 'star', items: top.slice(0, 18) },
    { id: 'recent', title: 'Newest', icon: 'sparkles', items: recent.slice(0, 18) },
    { id: 'action', title: 'Action', icon: 'flame', items: pick('Action') },
    { id: 'romance', title: 'Romance', icon: 'heart', items: pick('Romance') },
    { id: 'fantasy', title: 'Fantasy', icon: 'star', items: pick('Fantasy') },
    { id: 'comedy', title: 'Comedy', icon: 'message-circle', items: pick('Comedy') },
  ].filter(r => r.items.length);
}

/* ------------------------------------------------------------------ *
 *  seasons
 *
 *  MyAnimeList ships `season` lowercase ("fall"), and only for TV runs, so
 *  every helper here treats a missing season as "not listed" rather than
 *  guessing one from the year. Manga rows have no season at all.
 * ------------------------------------------------------------------ */
export const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const SEASON_AT = { winter: 1, spring: 2, summer: 3, fall: 4, autumn: 4 };
const seasonKey = r => (r.year || 0) * 10 + (SEASON_AT[String(r.season).toLowerCase()] || 0);
export const seasonLabel = (season, year) =>
  [season ? String(season).charAt(0).toUpperCase() + String(season).slice(1) : '', year || '']
    .filter(Boolean).join(' ');

/**
 * The newest season the catalogue actually contains — never "this season"
 * off the clock, because the snapshot can be months behind the calendar and
 * an empty rail labelled with today's season is a lie.
 */
export function latestSeason(kind = 'anime') {
  const rows = cache[kind] || [];
  let best = null, bestKey = 0;
  for (const r of rows) {
    if (!r.season || !r.year || !SEASON_AT[String(r.season).toLowerCase()]) continue;
    const k = seasonKey(r);
    if (k > bestKey) { bestKey = k; best = r; }
  }
  if (!best) return null;
  const season = String(best.season).toLowerCase();
  return { season, year: best.year, label: seasonLabel(season, best.year) };
}

/** Every title from one season, best score first. */
export function seasonal(kind = 'anime', { season = '', year = 0, limit = 0 } = {}) {
  const rows = cache[kind] || [];
  const want = String(season).toLowerCase();
  let items = rows.filter(r =>
    (!want || String(r.season).toLowerCase() === want) && (!year || r.year === year));
  items.sort(SORTS.score);
  return limit ? items.slice(0, limit) : items;
}

/* ------------------------------------------------------------------ *
 *  relations
 * ------------------------------------------------------------------ */
/**
 * Fold "… Season 2", "… Part II", "… the Movie" and friends down to the name
 * they share, so the sequels of one show group together. This is a *title*
 * relation, not a franchise id — the catalogue has no franchise field — so
 * the view labels the rail as related-by-title and never as canon.
 */
const TRAIL = /[\s:;,\-–—]+(?:the\s+)?(?:final\s+|second\s+|third\s+|new\s+)?(?:season|series|part|cour|chapter|arc|movie|film|ova|oad|ona|specials?|recap|remake|episodes?|\d+(?:st|nd|rd|th)?|[ivx]{1,4})\s*$/i;
function baseTitle(t) {
  let s = String(t || '').toLowerCase().replace(/\([^)]*\)\s*$/, ' ').trim();
  for (let i = 0; i < 6; i++) {
    const next = s.replace(TRAIL, '');
    if (next === s || next.replace(/[^a-z0-9]+/g, '').length < 5) break;
    s = next;
  }
  const key = s.replace(/[^a-z0-9]+/g, '');
  return key.length >= 5 ? key : '';
}

/** id -> [row], built once per catalogue and thrown away when it reloads. */
function franchiseMap(kind) {
  const idx = index[kind];
  if (!idx) return null;
  if (idx.fran) return idx.fran;
  const groups = new Map();
  for (const r of cache[kind] || []) {
    for (const t of [r.title, r.titleJa]) {
      const key = baseTitle(t);
      if (!key) continue;
      const g = groups.get(key) || groups.set(key, []).get(key);
      if (!g.includes(r)) g.push(r);
    }
  }
  const byRow = new Map();
  for (const g of groups.values()) {
    /* a 60-strong group is a stripped-to-nothing title, not a franchise */
    if (g.length < 2 || g.length > 60) continue;
    for (const r of g) {
      const seen = byRow.get(r.id) || byRow.set(r.id, []).get(r.id);
      for (const o of g) if (o !== r && !seen.includes(o)) seen.push(o);
    }
  }
  idx.fran = byRow;
  return byRow;
}

/** Other entries that share this title's name — sequels, movies, specials. */
export function related(rec, kind = 'anime', limit = 18) {
  if (!rec) return [];
  const map = franchiseMap(kind);
  const out = (map && map.get(rec.id)) || [];
  return [...out]
    .sort((a, b) => (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/**
 * Closest titles by shared genres, then score. One pass over the rows, so it
 * stays cheap enough to run on every detail view.
 */
export function similar(rec, kind = 'anime', limit = 18) {
  if (!rec) return [];
  const want = new Set(rec.genres || []);
  if (!want.size) return [];
  const rows = cache[kind] || [];
  const scored = [];
  for (const r of rows) {
    if (r.id === rec.id) continue;
    let hit = 0;
    for (const g of r.genres) if (want.has(g)) hit++;
    if (!hit) continue;
    /* overlap first, then the union size (a tight match beats a grab-bag) */
    const overlap = hit / (want.size + r.genres.length - hit);
    scored.push([overlap + (r.mediaType === rec.mediaType ? 0.04 : 0), r]);
  }
  scored.sort((a, b) => b[0] - a[0] || (b[1].score || 0) - (a[1].score || 0));
  return scored.slice(0, limit).map(x => x[1]);
}

/** The genres with the most titles, for the home page's per-genre rails. */
export function topGenres(kind = 'anime', n = 10) {
  return genresOf(kind).slice(0, n);
}

/** Resolve an ordered list of ids, dropping the ones no longer in the data. */
export function byIds(ids, kind = 'anime') {
  const rows = cache[kind] || [];
  if (!rows.length || !Array.isArray(ids) || !ids.length) return [];
  const want = new Map();
  for (const r of rows) want.set(r.id, r);
  const out = [];
  for (const id of ids) {
    const r = want.get(String(id));
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

/**
 * What the loaded catalogue really contains. Every number here is counted off
 * the rows, so the footer can state the size of the library without inventing
 * a single figure.
 */
export function facts(kind = 'anime') {
  const rows = cache[kind] || [];
  let scored = 0, counted = 0, yearFrom = 0, yearTo = 0;
  const countKey = kind === 'manga' ? 'chapters' : 'episodes';
  for (const r of rows) {
    if (r.score !== null && r.score !== undefined) scored++;
    if (r[countKey]) counted++;
    if (r.year) {
      if (!yearFrom || r.year < yearFrom) yearFrom = r.year;
      if (r.year > yearTo) yearTo = r.year;
    }
  }
  return {
    rows: rows.length, scored, counted, countKey,
    genres: genresOf(kind).length, yearFrom, yearTo,
    source: sync.status[kind] ? sync.status[kind].source : null,
    url: sync.status[kind] ? sync.status[kind].url : null,
  };
}

/**
 * A compact id per row, small enough that a whole catalogue's worth fits in
 * the persisted state. The view diffs two of these to find titles that are
 * genuinely new since the last visit — the only honest way to build a
 * "Recently added" rail out of data that carries no added-at date.
 */
export const shortId = rec =>
  (/^\d+$/.test(rec.id) ? Number(rec.id).toString(36) : String(rec.id).slice(0, 8));

export function shortIds(kind = 'anime') {
  return (cache[kind] || []).map(shortId);
}

export default { load, refresh, peek, isLoaded, query, byId, byIds, rails, genresOf, yearsOf,
                 topGenres, latestSeason, seasonal, seasonLabel, SEASONS, related, similar,
                 facts, shortId, shortIds,
                 SORT_OPTIONS, LIVE_STATUS, sync, syncStatus };
