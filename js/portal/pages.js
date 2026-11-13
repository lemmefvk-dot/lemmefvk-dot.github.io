/* ============================================================
   pages.js — the static:// router.

   js/apps/browser.js asks this module three things:
     match(url)          -> route | null      (is this one of ours?)
     titleOf(url)        -> tab title
     iconOf(url)         -> tab favicon name
     build(url, ctx)     -> HTMLElement       (render it)

   Every route's build() returns a node SYNCHRONOUSLY and fills
   itself in afterwards, so navigation never blocks on a
   provider call. ctx is:

     { url, params, query, api, navigate, win, providers }

     params   – path segment after the route, e.g. the game id
     query    – ?q= value, already decoded
     api      – the app API (h, icon, fmt, notify, menu, …)
     navigate – (url) => void, pushes browser history
   ============================================================ */
import { buildGames, buildGameDetail } from './games.js';
import { buildMovies, buildMovieDetail } from './movies.js';
import { buildAnime, buildAnimeDetail } from './anime.js';
import { buildSearch } from './search.js';
import { buildCloud } from './cloud.js?v=ps5-cloud-proxy-v11';
import { buildRoblox, buildRobloxDetail } from './roblox.js';
import { buildProxy, buildApply, buildArcadeHub } from './extras.js';
import { buildProxyApp } from './proxy.app.js?v=ps5-cloud-proxy-v12';
import { buildLibrary } from './library.js';
import { BRAND, canon, u } from './brand.js';

/* Every route matches on the canonical scheme, so static://, static:// and
   static:// are interchangeable everywhere (see brand.js).

   Both helpers derive the prefix from BRAND rather than hardcoding it. The
   previous version sliced by the literal length of u('games') and only
   kept working through luck — all three scheme names happen to be six
   letters. A four-letter rename would have broken every route silently. */
const PREFIX = `${BRAND.short}://`;

const seg = (url, name) => {
  const c = canon(url);
  const base = `${PREFIX}${name}`;
  if (!c.startsWith(base)) return '';
  const rest = c.slice(base.length).replace(/^\//, '').split(/[?#]/)[0];
  return rest ? decodeURIComponent(rest) : '';
};

const is = (url, name) => {
  const c = canon(url);
  const base = `${PREFIX}${name}`;
  return c === base || c.startsWith(`${base}/`) || c.startsWith(`${base}?`);
};

export const routes = [
  { id: 'games',   icon: 'gamepad',
    test: u => is(u, 'games'),
    title: () => `Games — ${BRAND.name}`,
    build: (u, ctx) => {
      const id = seg(u, 'games');
      return id ? buildGameDetail({ ...ctx, params: id }) : buildGames(ctx);
    } },

  { id: 'movies',  icon: 'film',
    test: u => is(u, 'movies'),
    title: () => `Movies — ${BRAND.name}`,
    build: (u, ctx) => {
      const id = seg(u, 'movies');
      return id ? buildMovieDetail({ ...ctx, params: id }) : buildMovies(ctx);
    } },

  { id: 'anime',   icon: 'star',
    test: u => is(u, 'anime'),
    title: () => `Anime — ${BRAND.name}`,
    build: (u, ctx) => {
      const id = seg(u, 'anime');
      return id ? buildAnimeDetail({ ...ctx, params: id, mediaKind: 'anime' })
                : buildAnime({ ...ctx, mediaKind: 'anime', query: qOf(u) });
    } },

  { id: 'manga',   icon: 'file-text',
    test: u => is(u, 'manga'),
    title: () => `Manga — ${BRAND.name}`,
    build: (u, ctx) => {
      const id = seg(u, 'manga');
      return id ? buildAnimeDetail({ ...ctx, params: id, mediaKind: 'manga' })
                : buildAnime({ ...ctx, mediaKind: 'manga', query: qOf(u) });
    } },

  { id: 'search',  icon: 'search',
    test: u => is(u, 'search'),
    title: u => { const q = qOf(u); return q ? `${q} — ${BRAND.name}` : `Search — ${BRAND.name}`; },
    build: (u, ctx) => buildSearch({ ...ctx, query: qOf(u) }) },

  { id: 'cloud',   icon: 'cast',
    test: u => is(u, 'cloud'),
    title: () => `Cloud — ${BRAND.name}`,
    build: (u, ctx) => buildCloud(ctx) },

  { id: 'roblox',  icon: 'box',
    test: u => is(u, 'roblox'),
    title: () => `Roblox — ${BRAND.name}`,
    build: (u, ctx) => {
      const id = seg(u, 'roblox');
      return id ? buildRobloxDetail({ ...ctx, params: id }) : buildRoblox(ctx);
    } },

  { id: 'arcade',  icon: 'sparkles',
    test: u => is(u, 'arcade'),
    title: () => `Arcade — ${BRAND.name}`,
    build: (u, ctx) => buildArcadeHub(ctx) },

  { id: 'proxy',   icon: 'shield',
    test: u => is(u, 'proxy'),
    title: () => `Proxy — ${BRAND.name}`,
    build: (u, ctx) => buildProxyApp(ctx) },

  { id: 'library', icon: 'heart',
    test: u => is(u, 'library'),
    title: () => `Library — ${BRAND.name}`,
    build: (u, ctx) => buildLibrary(ctx) },

  /* The previous single-engine proxy page, kept reachable so the
     engine-comparison view it had is not simply lost. */
  { id: 'proxy-classic', icon: 'shield',
    test: u => is(u, 'proxy-classic'),
    title: () => `Proxy (classic) — ${BRAND.name}`,
    build: (u, ctx) => buildProxy(ctx) },

  { id: 'apply',   icon: 'users',
    test: u => is(u, 'apply'),
    title: () => `Apply — ${BRAND.name}`,
    build: (u, ctx) => buildApply(ctx) },
];

function qOf(url) {
  const u = canon(url);
  const i = u.indexOf('?');
  if (i < 0) return '';
  try { return new URLSearchParams(u.slice(i + 1)).get('q') || ''; }
  catch (e) { return ''; }
}

export const match  = url => routes.find(r => r.test(url)) || null;
export const titleOf = url => { const r = match(url); return r ? r.title(url) : null; };
export const iconOf  = url => { const r = match(url); return r ? r.icon : null; };
export const build   = (url, ctx) => { const r = match(url); return r ? r.build(url, { ...ctx, url }) : null; };

/** Shorthands the start page and the OS both link to. */
export const shortcuts = {
  games: u('games'), movies: u('movies'), anime: u('anime'),
  manga: u('manga'), arcade: u('arcade'),
  cloud: u('cloud'), roblox: u('roblox'),
  proxy: u('proxy'), apply: u('apply'), library: u('library'),
  search: q => u(`search?q=${encodeURIComponent(q)}`),
  game: id => u(`games/${id}`), movie: id => u(`movies/${id}`),
  anime1: id => u(`anime/${id}`), manga1: id => u(`manga/${id}`),
  roblox1: id => u(`roblox/${id}`),
};

export default { routes, match, titleOf, iconOf, build, shortcuts };
