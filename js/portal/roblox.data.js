/* ============================================================
   roblox.data.js — lazy loader + index for data/roblox.json,
   the catalogue tools/sync-roblox.mjs builds from Roblox's own
   public endpoints.

   Why the data is baked rather than fetched live: Roblox's APIs
   answer any request but send no Access-Control-Allow-Origin,
   so a browser fetch() is refused. The sync tool runs in Node,
   where that rule does not apply, and writes this file.

   The art is the exception that makes the page worth having.
   tr.rbxcdn.com sends no CORS header either — but <img> never
   required one. Once the URL is known, the browser renders the
   genuine Roblox artwork with no proxy in the middle.

   If a bridge is configured (see bridge() below) the page tops
   the baked numbers up with live ones.
   ============================================================ */

const URL_PATH = 'data/roblox.json';
let cache = null;
let inflight = null;
let failed = null;

function dataUrl() {
  const base = new URL('../../', import.meta.url).href;
  return new URL(URL_PATH, base).href;
}

export async function load() {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch(dataUrl(), { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Roblox catalogue: HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error('Roblox catalogue is empty');
    cache = rows.map(normalise);
    return cache;
  })();
  try {
    return await inflight;
  } catch (err) {
    failed = err;
    cache = [];
    return cache;
  } finally {
    inflight = null;
  }
}

function normalise(r) {
  return {
    id: String(r.id),
    placeId: String(r.placeId),
    name: r.name || 'Untitled experience',
    desc: r.desc || '',
    creator: r.creator || '',
    verified: !!r.verified,
    playing: r.playing || 0,
    visits: r.visits || 0,
    maxPlayers: r.maxPlayers || 0,
    favorites: r.favorites || 0,
    rating: r.rating || 0,
    up: r.up || 0, down: r.down || 0,
    created: r.created || '', updated: r.updated || '',
    maturity: r.maturity || '',
    art: r.art || null,
    wide: r.wide || null,
    cats: Array.isArray(r.cats) && r.cats.length ? r.cats : ['popular'],
    featured: !!r.featured,
  };
}

export const peek = () => cache;
export const isLoaded = () => !!cache;
export const loadError = () => failed;
export const all = () => cache || [];

/* ---------- launching ------------------------------------- *
 * Roblox sends X-Frame-Options: SAMEORIGIN on every page it
 * serves, so no part of roblox.com can render inside Static.
 * The deep link is strictly better than a tab anyway: it hands
 * the place id to the installed Roblox player, which opens
 * straight into the experience with no web page in between.
 *
 * Strings confirmed against roblox.com/games/start's own markup.
 * ---------------------------------------------------------- */
export const deepLink   = placeId => `roblox://experiences/start?placeId=${placeId}`;
export const mobileLink = placeId => `robloxmobile://placeID=${placeId}`;
export const webLink    = placeId => `https://www.roblox.com/games/${placeId}`;
export const startLink  = placeId => `https://www.roblox.com/games/start?placeId=${placeId}`;

export const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

/** The link to hand the OS for this device. */
export const launchLink = placeId => (isMobile() ? mobileLink(placeId) : deepLink(placeId));

/* ---------- sorting / query ------------------------------- */

const SORTS = {
  playing: (a, b) => b.playing - a.playing,
  rating:  (a, b) => b.rating - a.rating || b.playing - a.playing,
  visits:  (a, b) => b.visits - a.visits,
  az:      (a, b) => a.name.localeCompare(b.name),
};

export const CATEGORIES = [
  ['all', 'All'], ['featured', 'Featured'], ['simulator', 'Simulator'],
  ['roleplay', 'Roleplay'], ['obby', 'Obby'], ['horror', 'Horror'],
  ['fighting', 'Fighting'], ['shooter', 'Shooter'], ['survival', 'Survival'],
  ['adventure', 'Adventure'], ['tycoon', 'Tycoon'], ['strategy', 'Strategy'],
  ['building', 'Building'], ['racing', 'Racing'], ['sports', 'Sports'],
  ['rpg', 'RPG'], ['social', 'Social'],
];

/** query({category,q,sort,page,perPage}) -> {items,total,page,pages} */
export function query({ category = 'all', q = '', sort = 'playing', page = 1, perPage = 48 } = {}) {
  const rows = all();
  const low = String(q).trim().toLowerCase();
  let items = rows.filter(r =>
    (category === 'all'
      || (category === 'featured' ? r.featured : r.cats.includes(category)))
    && (!low || r.name.toLowerCase().includes(low)
        || r.creator.toLowerCase().includes(low)
        || r.desc.toLowerCase().includes(low)));
  const base = SORTS[sort] || SORTS.playing;
  items = [...items].sort(base);
  if (low) items.sort((a, b) => rank(b.name, low) - rank(a.name, low) || base(a, b));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * perPage, p * perPage), total, page: p, pages };
}

function rank(name, low) {
  const t = name.toLowerCase();
  return t === low ? 3 : t.startsWith(low) ? 2 : t.includes(low) ? 1 : 0;
}

export const byId = id => all().find(r => r.id === String(id) || r.placeId === String(id)) || null;

export function counts() {
  const m = new Map();
  for (const r of all()) for (const c of r.cats) m.set(c, (m.get(c) || 0) + 1);
  m.set('featured', all().filter(r => r.featured).length);
  m.set('all', all().length);
  return m;
}

export const playersOnline = () => all().reduce((n, r) => n + r.playing, 0);

/* ---------- live data ------------------------------------- *
 * Roblox's own APIs answer any request but send no CORS header, so a
 * browser fetch() of them is refused. roproxy.com is a public mirror of
 * those same endpoints that DOES send access-control-allow-origin: *,
 * which means live player counts, live search and live thumbnails work
 * from a static page with nothing to deploy and no key.
 *
 * Verified against the live hosts: games.roproxy.com,
 * thumbnails.roproxy.com and apis.roproxy.com all answer 200 with
 * access-control-allow-origin: *.
 *
 * The baked catalogue stays the source of truth for what EXISTS; this
 * only tops up the numbers that go stale. If the mirror is down the
 * page still renders, just with the numbers from the last sync and an
 * honest "as of" label — it never invents a figure.
 * ---------------------------------------------------------- */

export const MIRRORS = {
  games: 'https://games.roproxy.com',
  thumbs: 'https://thumbnails.roproxy.com',
  apis: 'https://apis.roproxy.com',
  users: 'https://users.roproxy.com',
};

/* A self-hosted worker, if the person has one, takes priority: it is
   their own infrastructure rather than someone else's courtesy mirror. */
export const bridge = { base: '' };

const live = {
  ok: null,          // null = not tried, true/false = last outcome
  at: 0,
  inflight: new Map(),
};

export const liveStatus = () => ({ ...live });

function endpoint(host, path) {
  if (bridge.base) {
    return `${bridge.base.replace(/\/$/, '')}/raw?url=${encodeURIComponent(host + path)}`;
  }
  return host + path;
}

async function getJSON(host, path, { timeout = 9000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(endpoint(host, path), { signal: ac.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    live.ok = true;
    live.at = Date.now();
    return data;
  } catch (err) {
    live.ok = false;
    live.at = Date.now();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Top up `playing` / `visits` on the given rows from the live mirror.
 * Resolves to the number of rows actually refreshed — 0 means nothing
 * changed and the caller should keep showing the baked numbers.
 */
export async function refreshPlaying(rows) {
  if (!rows || !rows.length) return 0;
  const batch = rows.slice(0, 100);
  const ids = batch.map(r => r.id).join(',');
  const key = `games:${ids}`;
  if (live.inflight.has(key)) return live.inflight.get(key);

  const job = (async () => {
    const data = await getJSON(MIRRORS.games, `/v1/games?universeIds=${ids}`);
    if (!data || !Array.isArray(data.data)) return 0;
    const byId = new Map(data.data.map(g => [String(g.id), g]));
    let hit = 0;
    for (const r of batch) {
      const g = byId.get(r.id);
      if (!g) continue;
      if (typeof g.playing === 'number') r.playing = g.playing;
      if (typeof g.visits === 'number') r.visits = g.visits;
      if (typeof g.favoritedCount === 'number') r.favorites = g.favoritedCount;
      if (g.maxPlayers) r.maxPlayers = g.maxPlayers;
      r.live = true;
      hit++;
    }
    return hit;
  })();

  live.inflight.set(key, job);
  try { return await job; } finally { live.inflight.delete(key); }
}

/** Up/down votes, which the games endpoint does not carry. */
export async function refreshVotes(rows) {
  if (!rows || !rows.length) return 0;
  const batch = rows.slice(0, 100);
  const data = await getJSON(MIRRORS.games, `/v1/games/votes?universeIds=${batch.map(r => r.id).join(',')}`);
  if (!data || !Array.isArray(data.data)) return 0;
  const byId = new Map(data.data.map(v => [String(v.id), v]));
  let hit = 0;
  for (const r of batch) {
    const v = byId.get(r.id);
    if (!v) continue;
    const up = v.upVotes || 0;
    const down = v.downVotes || 0;
    if (up + down > 0) { r.up = up; r.down = down; r.rating = Math.round((up / (up + down)) * 100); hit++; }
  }
  return hit;
}

/** Live search across all of Roblox, not just the baked catalogue. */
export async function searchLive(term, { limit = 40 } = {}) {
  const q = String(term || '').trim();
  if (!q) return [];
  const data = await getJSON(MIRRORS.apis,
    `/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&pageToken=&sessionId=aether&pageType=all`);
  if (!data || !Array.isArray(data.searchResults)) return [];
  const out = [];
  for (const group of data.searchResults) {
    if (group.contentGroupType && group.contentGroupType !== 'Game') continue;
    for (const c of group.contents || []) {
      if (!c.universeId || !c.rootPlaceId) continue;
      out.push({
        id: String(c.universeId),
        placeId: String(c.rootPlaceId),
        name: c.name || '',
        playing: c.playerCount || 0,
        up: c.totalUpVotes || 0,
        down: c.totalDownVotes || 0,
        rating: (c.totalUpVotes + c.totalDownVotes) > 0
          ? Math.round((c.totalUpVotes / (c.totalUpVotes + c.totalDownVotes)) * 100) : 0,
        creator: c.creatorName || '',
        desc: c.description || '',
        maturity: c.contentMaturity || '',
        art: null, wide: null, cats: ['search'], featured: false,
        visits: 0, favorites: 0, maxPlayers: 0, verified: !!c.creatorHasVerifiedBadge,
        live: true,
      });
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Fill in art for rows that arrived without any (live search results). */
export async function fetchArt(rows) {
  const need = (rows || []).filter(r => !r.art).slice(0, 100);
  if (!need.length) return 0;
  const ids = need.map(r => r.id).join(',');
  const [icons, wides] = await Promise.all([
    getJSON(MIRRORS.thumbs, `/v1/games/icons?universeIds=${ids}&size=512x512&format=Png`),
    getJSON(MIRRORS.thumbs, `/v1/games/multiget/thumbnails?universeIds=${ids}&countPerUniverse=1&defaults=true&size=768x432&format=Png`),
  ]);
  const icon = new Map(((icons && icons.data) || [])
    .filter(t => t.state === 'Completed' && t.imageUrl)
    .map(t => [String(t.targetId ?? t.universeId), t.imageUrl]));
  const wide = new Map(((wides && wides.data) || []).map(row => {
    const t = (row.thumbnails || []).find(x => x.state === 'Completed' && x.imageUrl);
    return t ? [String(row.universeId), t.imageUrl] : null;
  }).filter(Boolean));
  let hit = 0;
  for (const r of need) {
    if (icon.has(r.id)) { r.art = icon.get(r.id); hit++; }
    if (wide.has(r.id)) r.wide = wide.get(r.id);
  }
  return hit;
}

/** A Roblox user's avatar headshot — used by the profile card. */
export async function avatarHeadshot(userIds, size = '420x420') {
  const ids = [].concat(userIds).slice(0, 100).join(',');
  const data = await getJSON(MIRRORS.thumbs, `/v1/users/avatar-headshot?userIds=${ids}&size=${size}&format=Png`);
  if (!data || !Array.isArray(data.data)) return new Map();
  return new Map(data.data
    .filter(t => t.state === 'Completed' && t.imageUrl)
    .map(t => [String(t.targetId), t.imageUrl]));
}

/** Servers for an experience, so the detail page can show real ones. */
export async function servers(placeId, { limit = 10 } = {}) {
  const data = await getJSON(MIRRORS.games,
    `/v1/games/${placeId}/servers/Public?sortOrder=Desc&excludeFullGames=false&limit=${limit}`);
  if (!data || !Array.isArray(data.data)) return [];
  return data.data.map(s => ({
    id: s.id, playing: s.playing || 0, max: s.maxPlayers || 0,
    ping: s.ping || 0, fps: Math.round(s.fps || 0),
  }));
}

export default {
  load, peek, isLoaded, loadError, all, query, byId, counts,
  deepLink, mobileLink, webLink, startLink, launchLink, isMobile,
  CATEGORIES, playersOnline, bridge, refreshPlaying, refreshVotes,
  searchLive, fetchArt, avatarHeadshot, servers, liveStatus, MIRRORS,
};
