/* ============================================================
   cloud.catalog.js — "where can I play this game?"

   The licensed cloud-gaming services Static Cloud knows, and a
   search over the game lists they publish themselves, merged by
   title in data/cloud-games.json (built and dated by
   tools/sync-cloud-games.mjs — nothing in it is typed by hand).

   HOW A SERVICE IS OPENED
   Every one of these refuses to be framed (x-frame-options /
   frame-ancestors — see cloud.data.js), and none of them is put
   through Static's tunnel: they are opened in a NEW BROWSER TAB at
   the service's own address, the way the service is meant to be
   used, signed in with your own account. Static only finds the
   game and hands off.

   WHAT A RESULT SAYS
   Only what the service's own list says (see the sync script's
   header for each field). Anything a list does not state — which
   Blacknut Pass a game is in, for instance — is left to the
   service's own page rather than guessed.
   ============================================================ */
import { createIndex, norm } from '../core/fuzzy.js';

const slug = t => String(t || '').toLowerCase()
  .replace(/[®™©]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'game';
const list = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}`);

/* need(o): what this service's entry for a game asks of you, as
   [{ text, tone }] — tone 'ok' (nothing to pay), 'sub' (a membership),
   'own' (you need the game itself), 'info' (a plain fact). */
export const SERVICES = [
  {
    id: 'xcloud', name: 'Xbox Cloud Gaming', short: 'Xbox Cloud', vendor: 'Microsoft',
    icon: 'brand-xbox', g1: '#7fe08a', g2: '#107c10',
    home: 'https://www.xbox.com/play',
    /* the slug is cosmetic; the product id is what xbox.com resolves */
    play: (o, g) => `https://www.xbox.com/play/games/${slug(g.t)}/${encodeURIComponent(o.id)}`,
    note: 'Plays at xbox.com/play in Chrome, Edge or Safari, signed in with a Microsoft account.',
    account: 'Free-to-play games need only a Microsoft account. The Game Pass library needs a Game Pass plan '
      + 'with cloud play (Essential, Premium or Ultimate). Some games you buy can be streamed too.',
    need(o) {
      const out = [];
      if (o.f) out.push({ tone: 'ok', text: 'Free to play: a Microsoft account is all it needs' });
      if (o.gp) out.push({ tone: 'sub', text: 'Included with Game Pass (Ultimate has the whole library)' });
      /* "Stream your own game": a copy you bought, or claimed if it is free on Xbox */
      if (o.own) out.push({ tone: 'own', text: out.length ? 'Or get it on Xbox and stream your own copy' : 'Get it on Xbox, then stream your own copy' });
      if (!out.length) out.push({ tone: 'info', text: 'Listed for the cloud; its Xbox page says what it needs' });
      return out;
    },
  },
  {
    id: 'gfn', name: 'GeForce NOW', short: 'GeForce NOW', vendor: 'NVIDIA',
    icon: 'zap', g1: '#c4f06b', g2: '#4a8a0c',
    home: 'https://play.geforcenow.com/',
    /* NVIDIA's own deep link: its web app opens #/deeplink?game-id=… on the game's page */
    play: o => `https://play.geforcenow.com/mall/#/deeplink?game-id=${encodeURIComponent(o.id)}`,
    note: 'Plays at play.geforcenow.com. It streams games you own on other stores.',
    account: 'A GeForce NOW membership (there is a free one) plus the game on a store it supports.',
    need(o) {
      const out = [];
      out.push({ tone: 'own', text: o.s && o.s.length ? `Own it on ${list(o.s)}` : 'Own it (GeForce NOW names the store)' });
      out.push(o.i
        ? { tone: 'sub', text: 'Install-to-play: needs a paid membership (Performance or Ultimate)' }
        : { tone: 'ok', text: 'Any membership, the free one included' });
      return out;
    },
  },
  {
    id: 'boosteroid', name: 'Boosteroid', short: 'Boosteroid', vendor: 'Boosteroid',
    icon: 'cloud', g1: '#ff9bb0', g2: '#b8123c',
    home: 'https://cloud.boosteroid.com/',
    play: o => `https://cloud.boosteroid.com/application/${encodeURIComponent(o.id)}`,
    note: 'Plays at cloud.boosteroid.com in the browser.',
    account: 'A Boosteroid subscription, plus the game on a store it supports.',
    need(o) {
      return [
        { tone: 'sub', text: 'Boosteroid subscription' },
        { tone: 'own', text: o.s && o.s.length ? `Own it on ${list(o.s)}` : 'Own it (Boosteroid names the launcher)' },
      ];
    },
  },
  {
    id: 'antstream', name: 'Antstream Arcade', short: 'Antstream', vendor: 'Antstream',
    icon: 'gamepad', g1: '#f39bff', g2: '#8a14b8',
    home: 'https://live.antstream.com/',
    /* the deep link Antstream's own catalogue gives each game */
    play: o => `https://live.antstream.com/game-details/${encodeURIComponent(o.id)}/info?id=${encodeURIComponent(o.id)}&focusElement=playButton`,
    note: 'Officially licensed retro games, streamed. Plays at live.antstream.com in the browser.',
    account: 'Antstream Premium to play; a free account lets you look around first.',
    need(o) {
      const out = [{ tone: 'sub', text: 'Antstream Premium (a free account lets you look around)' }];
      if (o.pf && o.pf.length) out.push({ tone: 'info', text: `The ${list(o.pf)} original` });
      return out;
    },
  },
  {
    id: 'blacknut', name: 'Blacknut', short: 'Blacknut', vendor: 'Blacknut',
    icon: 'monitor', g1: '#ffd27a', g2: '#b3600a',
    home: 'https://app.blacknut.com/',
    play: o => `https://www.blacknut.com/en/game/${encodeURIComponent(o.id)}`,
    note: 'Plays in the browser at app.blacknut.com.',
    account: 'A Blacknut subscription; some games also need one of its Pass add-ons.',
    need() {
      return [{ tone: 'sub', text: 'Blacknut subscription; some games need a Pass add-on (its page says which)' }];
    },
  },
  /* Licensed and browser-playable, but they publish no game list Static
     can read (now.gg's terms also forbid scraping it), so they are offered
     as places to look, never as "has it" or "doesn't". */
  {
    id: 'luna', name: 'Amazon Luna', short: 'Luna', vendor: 'Amazon', unlisted: true,
    icon: 'cast', g1: '#a99bff', g2: '#4b32c3',
    home: 'https://luna.amazon.com/',
    note: 'Amazon’s cloud gaming, at luna.amazon.com. Some games come with Prime.',
    account: 'An Amazon account; Prime or Luna Premium for most games.',
  },
  {
    id: 'nowgg', name: 'now.gg', short: 'now.gg', vendor: 'now.gg, Inc.', unlisted: true,
    icon: 'globe', g1: '#7fd1ff', g2: '#1b6fb3',
    home: 'https://now.gg/',
    note: 'Mobile games their publishers put on now.gg, played in the browser.',
    account: 'Free; some games ask you to sign in.',
  },
];

export const serviceById = id => SERVICES.find(s => s.id === id) || null;
export const LISTED = SERVICES.filter(s => !s.unlisted);

/* ---------- the merged list ---------------------------------- */
const DATA = 'data/cloud-games.json';
let cache = null;
let inflight = null;
let failed = null;
let index = null;

const dataUrl = () => new URL(DATA, new URL('../../', import.meta.url)).href;

/** Load data/cloud-games.json once. Resolves to the file, or null (see loadError()). */
export async function load() {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(dataUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (!d || !Array.isArray(d.games) || !d.games.length) throw new Error('the list is empty');
      cache = d;
      failed = null;
      index = createIndex(d.games, { title: g => g.t });
      return cache;
    } catch (err) {
      failed = err;
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
export const loadError = () => failed;
export const isLoaded = () => !!cache;
export const data = () => cache;

/** A game's key: what favourites remember (its title, normalised). */
export const keyOf = g => norm(g && g.t);
export function byKey(k) {
  if (!cache || !k) return null;
  return cache.games.find(g => keyOf(g) === k) || null;
}

export function artUrl(g) {
  const a = g && g.a;
  if (!a || !cache) return null;
  const i = a.indexOf(':');
  const base = cache.art && cache.art[a.slice(0, i)];
  return base ? base + a.slice(i + 1) : null;
}

/** The services a game is on, in SERVICES order: [{ service, o, url, need }]. */
export function where(g) {
  const out = [];
  for (const s of LISTED) {
    const o = g && g.on && g.on[s.id];
    if (!o) continue;
    out.push({ service: s, o, url: s.play(o, g), need: s.need(o) });
  }
  return out;
}

/**
 * search(q, { service, only }) -> { items, total, suggestion }
 * q empty: every game, most played first (the order the sync wrote).
 * service: only games that service lists. only: a Set of keys to keep.
 */
export function search(q = '', { service = '', only = null } = {}) {
  if (!cache) return { items: [], total: 0, suggestion: null };
  const keep = g => (!service || (g.on && g.on[service])) && (!only || only.has(keyOf(g)));
  if (!String(q).trim()) {
    const items = cache.games.filter(keep);
    return { items, total: items.length, suggestion: null };
  }
  const r = index.search(q);
  const items = r.hits.map(x => x.row).filter(keep);
  return { items, total: items.length, suggestion: r.suggestion };
}

/** Rows per service, as the sync counted them after merging. */
export const counts = () => Object.fromEntries(Object.entries(cache?.sources || {}).map(([k, v]) => [k, v.titles || 0]));

export default { SERVICES, LISTED, serviceById, load, loadError, isLoaded, data, keyOf, byKey, artUrl, where, search, counts };
