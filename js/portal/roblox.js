/* ============================================================
   roblox.js — static://roblox

   What is actually possible, established by probing the live
   hosts rather than guessing:

     roblox.com/games/<id>       x-frame-options: SAMEORIGIN
     roblox.com/embed/<id>       x-frame-options: SAMEORIGIN
     www.roblox.com/Thumbs/...   404 (the old image endpoints are gone)
     games.roblox.com/v1/...     200, but no CORS header
     tr.rbxcdn.com/...           200 image/png, no CORS header

   So: nothing Roblox serves can be put in an iframe, and no
   Roblox API can be read by fetch() from a browser. Two things
   still work, and this page is built on both.

   1. <img> has never required CORS. tools/sync-roblox.mjs runs
      in Node, reads the real APIs and bakes the catalogue --
      names, creators, player counts, ratings and the rbxcdn art
      URLs -- into data/roblox.json. The browser then renders the
      genuine Roblox artwork straight from Roblox's CDN.

   2. roblox://experiences/start?placeId=<id> is Roblox's own
      deep link, lifted from the markup of their /games/start
      page. It hands the place id to the installed Roblox player,
      which opens straight into the experience. That skips the
      web page entirely, so it beats the "open a tab" fallback
      every Roblox front-end (ours included, until now) settled
      for.

   The page degrades honestly: if the client does not pick the
   deep link up within a moment, the web launcher is offered.
   ============================================================ */

import { BRAND } from './brand.js';
import * as RB from './roblox.data.js';
import { paintFriendPanel } from './sendfriend.js';

if (typeof document !== 'undefined' && !document.getElementById('gamesportal-css')) {
  const link = document.createElement('link');
  link.id = 'gamesportal-css';
  link.rel = 'stylesheet';
  link.href = 'css/gamesportal.css';
  document.head.appendChild(link);
}

/* "Play in browser (Roblox Web Play)" button. OFF until Roblox makes Web Play public.
   Today (checked 2026-11-09) it is a Chrome-only creator beta started from Creator
   Hub, with no public link that starts a given experience. Turn this on when Roblox
   announces public Web Play, and re-check then which browsers and Chromebooks it
   accepts. The button only opens the experience's roblox.com page in a new tab:
   roblox.com refuses to be framed (X-Frame-Options: SAMEORIGIN) and is never framed here. */
const WEB_PLAY = false;
let webPlayOn = WEB_PLAY;
/** Test hook: flip the switch for this page load without editing the constant. */
export const setWebPlayForTest = on => { webPlayOn = !!on; };

/* How long to wait for any sign that the browser handed the link to another app. */
const HANDOFF_WAIT_MS = 1500;
let lastHandOff = '';
/** Test hook: the last custom-scheme link handed to the OS. */
export const lastHandOffUrl = () => lastHandOff;

const LIB = 'static://roblox';
const urlFor = id => `${LIB}/${id}`;

/* Favourites and play history persist, because a discovery client that
   forgets what you liked the moment you close it is not a client. */
const FAV_KEY = 'portal.roblox.favs';
const RECENT_KEY = 'portal.roblox.recent';

const readList = (api, key) => {
  const raw = api.store.get(key, []);
  return Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : [];
};
const isFav = (api, id) => readList(api, FAV_KEY).includes(String(id));
const toggleFav = (api, id) => {
  const v = String(id);
  const list = readList(api, FAV_KEY);
  const next = list.includes(v) ? list.filter(x => x !== v) : [v, ...list];
  api.store.set(FAV_KEY, next.slice(0, 300));
  return next.includes(v);
};
/* "Want to play": [{ id, rem }]. `rem` is the id of an ordinary reminder this
   person asked for, which lives in Automations like any other and can be
   changed or removed there. */
const WANT_KEY = 'portal.roblox.want';
const MAX_WANT = 100;
const wantRows = api => {
  const raw = api.store.get(WANT_KEY, []);
  return Array.isArray(raw) ? raw.filter(r => r && typeof r.id === 'string') : [];
};
const isWant = (api, id) => wantRows(api).some(r => r.id === String(id));
const wantAM = () => import('../core/automations.js');
async function dropReminder(id) {
  if (!id) return;
  try { (await wantAM()).removeReminder(id); } catch (e) { /* already gone */ }
}
async function toggleWant(api, id) {
  const v = String(id);
  const rows = wantRows(api);
  const cur = rows.find(r => r.id === v);
  if (cur) {
    api.store.set(WANT_KEY, rows.filter(r => r.id !== v));
    await dropReminder(cur.rem);
    return false;
  }
  api.store.set(WANT_KEY, [{ id: v, rem: '' }, ...rows].slice(0, MAX_WANT));
  return true;
}
/** Remind me to play it: 'hour' | '3h' | 'tomorrow'. -> { ok, text? } */
async function setWantReminder(api, row, choice) {
  const AM = await wantAM();
  const d = new Date(Date.now() + ({ hour: 3600e3, '3h': 3 * 3600e3, tomorrow: 24 * 3600e3 }[choice] || 3600e3));
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const res = AM.addReminder({
    text: `Play ${row.name} on Roblox`, repeat: 'once', enabled: true,
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, date: AM.ymd(d),
  });
  if (!res.ok || !res.reminder) return { ok: false, text: (res.issues && res.issues[0] && res.issues[0].text) || 'Could not set the reminder.' };
  const rows = wantRows(api);
  const cur = rows.find(r => r.id === row.id);
  if (cur && cur.rem && cur.rem !== res.reminder.id) await dropReminder(cur.rem);
  const next = { id: row.id, rem: res.reminder.id };
  api.store.set(WANT_KEY, [next, ...rows.filter(r => r.id !== row.id)].slice(0, MAX_WANT));
  return { ok: true, text: `${res.reminder.date} at ${res.reminder.time}` };
}
async function reminderText(rem) {
  if (!rem) return '';
  try {
    const r = (await wantAM()).reminders().find(x => x.id === rem);
    return r ? `Reminder: ${r.date || 'daily'} at ${r.time}${r.enabled === false ? ' (off)' : ''}` : '';
  } catch (e) { return ''; }
}

const noteplayed = (api, id) => {
  const v = String(id);
  const next = [v, ...readList(api, RECENT_KEY).filter(x => x !== v)].slice(0, 40);
  api.store.set(RECENT_KEY, next);
};

const NAV = [
  ['home',   'Home',   'static://home',   'home'],
  ['games',  'Games',  'static://games',  'gamepad'],
  ['roblox', 'Roblox', 'static://roblox', 'box'],
  ['cloud',  'Cloud',  'static://cloud',  'cast'],
  ['anime',  'Anime',  'static://anime',  'star'],
  ['search', 'Search', 'static://search', 'search'],
];

/* ---------- small helpers --------------------------------- */

function lifecycle(root) {
  const fns = [];
  let done = false;
  let attached = false;
  const run = () => {
    if (done) return;
    done = true;
    for (const fn of fns.splice(0)) {
      try { fn(); } catch (e) { console.warn('[Static] teardown', e); }
    }
  };
  const dead = () => {
    if (done) return true;
    if (root.isConnected) { attached = true; return false; }
    return attached;
  };
  let tries = 0;
  const watch = () => {
    if (done) return;
    if (root.isConnected) attached = true;
    else if (attached) return run();
    if (++tries < 4000) requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
  return { add: fn => fns.push(fn), dead, run };
}

const num = n => Number(n || 0).toLocaleString();

const compact = n => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
};

/**
 * Hand a custom-scheme URL to the OS.
 *
 * A hidden iframe is used rather than location.href: if no handler is
 * registered, assigning location in the top window can surface a browser
 * error page over Static, while an iframe fails silently in its own frame.
 * Nothing reports back whether the app actually opened -- no browser exposes
 * that -- so the caller shows the web fallback after a beat and lets the
 * person decide.
 */
function handOff(url) {
  lastHandOff = url;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0';
  f.setAttribute('aria-hidden', 'true');
  document.body.appendChild(f);
  try { f.contentWindow.location.href = url; }
  catch (err) { try { window.location.href = url; } catch (e2) { /* blocked */ } }
  setTimeout(() => f.remove(), 2000);
}

function topStrip(ctx, current) {
  const { api, navigate } = ctx;
  const { h, icon } = api;
  const input = h('input', {
    type: 'search', placeholder: 'Search Static', spellcheck: 'false',
    'aria-label': `Search ${BRAND.name}`,
  });
  const find = h('form.field.cx__find', {
    onsubmit: e => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) navigate(`static://search?q=${encodeURIComponent(q)}`);
    },
  }, icon('search'), input);
  const nav = h('div.cx__nav', { role: 'navigation', 'aria-label': 'Static' },
    NAV.map(([id, label, url, ic]) => h(id === current ? 'button.is-on' : 'button', {
      type: 'button',
      'aria-current': id === current ? 'page' : null,
      onclick: () => navigate(url),
    }, icon(ic), h('span', { text: label }))));
  return h('div.cx__top',
    h('div.cx__mark', icon(BRAND.icon), h('span', { text: BRAND.wordmark })),
    find, nav);
}

/* ---------- the launch control ---------------------------- *
 * Shared by the grid cards and the detail page.               */

function launchButton(api, row, { big = false } = {}) {
  const { h, icon } = api;
  const label = RB.isMobile() ? 'Open in Roblox' : 'Play in Roblox';
  const btn = h(big ? 'button.btn.btn--primary.rbx__play' : 'button.btn.btn--sm.rbx__play', {
    type: 'button',
    'aria-label': `${label}: ${row.name}`,
    onclick: e => { e.stopPropagation(); launch(api, row, btn); },
  }, icon('play', { size: big ? 16 : 13 }), h('span', { text: label }));
  return btn;
}

function launch(api, row, btn) {
  noteplayed(api, row.id);
  const root = btn && btn.closest('.cx');
  handOff(RB.launchLink(row.placeId));
  if (root) watchHandOff(api, root, row);
  if (btn) {
    const span = btn.querySelector('span');
    const was = span ? span.textContent : '';
    btn.classList.add('is-launching');
    if (span) span.textContent = 'Handing to Roblox…';
    setTimeout(() => {
      btn.classList.remove('is-launching');
      if (span) span.textContent = was;
    }, 2600);
  }
}

/* No browser says whether a custom-scheme link opened an app. The only signs are
   that this tab lost focus or was hidden soon after (a prompt, or the app taking
   the screen). Either is reported as "handed off", never as "installed"; with
   neither, Roblox's documented web link is offered. */
function watchHandOff(api, root, row) {
  const { h } = api;
  let seen = false;
  const onBlur = () => { seen = true; };
  const onVis = () => { if (document.visibilityState === 'hidden') seen = true; };
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  let note = root.querySelector(':scope > .rbx-note');
  if (!note) {
    note = h('div.rbx-note', { role: 'status' });
    root.insertBefore(note, root.children[1] || null);
  }
  const say = (kind, ...kids) => { note.dataset.kind = kind; note.replaceChildren(...kids); };
  const link = label => h('a', {
    href: RB.startLink(row.placeId), target: '_blank', rel: 'noopener',
    dataset: { rbx: 'fallback' }, text: label,
  });
  say('wait', `Asking Roblox to open ${row.name}…`);
  const mine = note.dataset.n = String(Number(note.dataset.n || 0) + 1);
  setTimeout(() => {
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVis);
    if (note.dataset.n !== mine) return;        // a newer attempt owns the note now
    if (seen) {
      say('handed', `Handed to another app. Static cannot tell whether Roblox opened ${row.name}. If it did not, `,
        link('open it on roblox.com'), '.');
    } else {
      say('fallback', 'Roblox did not respond, so it may not be installed here. ',
        link('Open it on roblox.com instead'), ' (a new tab).');
    }
  }, HANDOFF_WAIT_MS);
}

/** The official route on this device (from the user agent), in a few plain words. */
function deviceNote(api) {
  const g = RB.deviceGuide();
  return api.h('div.rbx-device', { dataset: { device: g.id } },
    api.h('b', { text: `${g.title}: ` }), api.h('span', { text: g.text }));
}

/* Roblox's Name and Logo Guidelines, as the research (docs/roblox-research.md) summarises
   them: no Roblox logo, plain text only; Roblox-owned content stays off unless Roblox
   allows it; game art belongs to its creators. Nothing here is the Roblox logo. */
function affiliation(api) {
  return api.h('small.dim.rbx-legal', {
    text: 'Static is not affiliated with Roblox Corporation and is not endorsed by it. '
        + 'Roblox is a trademark of Roblox Corporation. Experience names, icons and descriptions '
        + 'belong to their creators and come from Roblox’s public pages; the icons load from Roblox’s own image servers.',
  });
}

/* ================================================================== *
 *  static://roblox — the library
 * ================================================================== */
export function buildRoblox(ctx) {
  const { api, navigate } = ctx;
  const { h, icon } = api;

  const root = h('div.cx');
  const life = lifecycle(root);
  root.appendChild(topStrip(ctx, 'roblox'));

  const body = h('div');
  root.appendChild(body);
  root.appendChild(h('div.cx__sec', deviceNote(api), affiliation(api)));

  const S = {
    cat: 'all', q: '', sort: 'playing', page: 1,
    year: 0, mat: '',    // made in / Roblox's maturity rating
    cmp: [],             // up to three catalogue ids being compared
    liveRows: null,      // results from the live mirror for the current query
    liveBusy: false,
    seq: 0,              // guards against a slow search landing after a newer one
    wseq: 0,             // the same, for the Want to play list
    showCmp: false,
  };
  const E = {};

  buildShell();
  start();

  function buildShell() {
    api.clear(body);

    E.hero = h('div');

    E.cats = h('div.cx__cats', { role: 'group', 'aria-label': 'Roblox categories' });
    E.filterIn = h('input', {
      type: 'search', placeholder: 'Filter experiences…', spellcheck: 'false',
      'aria-label': 'Filter experiences', value: S.q,
      oninput: e => {
        S.q = e.target.value;
        S.page = 1;
        S.liveRows = null;
        paintGrid();
        clearTimeout(E.searchTimer);
        E.searchTimer = setTimeout(searchLive, 320);
      },
    });
    E.filter = h('div.field', { style: { flex: '0 0 190px', height: '26px' } },
      icon('filter'), E.filterIn);

    E.sort = h('select.select', {
      'aria-label': 'Sort experiences',
      onchange: e => { S.sort = e.target.value; S.page = 1; paintGrid(); },
    },
      h('option', { value: 'playing', text: 'Playing now' }),
      h('option', { value: 'rating', text: 'Top rated' }),
      h('option', { value: 'visits', text: 'Most visits' }),
      h('option', { value: 'updated', text: 'Recently updated' }),
      h('option', { value: 'az', text: 'A–Z' }));
    E.sort.value = S.sort;

    E.bar = h('div.cx__bar', E.cats, E.filter, E.sort);
    /* made in … and Roblox's own maturity rating, from the catalogue's rows */
    E.year = h('select.select', {
      'aria-label': 'Filter by the year it was made',
      onchange: e => { S.year = Number(e.target.value) || 0; S.page = 1; paintGrid(); },
    }, h('option', { value: '0', text: 'Any year made' }),
      RB.years().map(y => h('option', { value: String(y.year), text: `Made in ${y.year} (${y.n})` })));
    E.mat = h('select.select', {
      'aria-label': 'Filter by maturity',
      onchange: e => { S.mat = e.target.value; S.page = 1; paintGrid(); },
    }, h('option', { value: '', text: 'Any maturity' }),
      RB.maturities().map(m => h('option', { value: m.id, text: `${m.name} (${m.n})` })));
    E.bar2 = h('div.rbx-bar2', E.year, E.mat);
    E.because = h('div');
    E.wantBox = h('div');
    E.cmpBox = h('div');
    E.cmpBar = h('div.rbx-cmpbar.hidden', { role: 'status' });
    E.secT = h('div.cx__sec-t', { text: 'Experiences' });
    E.secN = h('div.cx__sec-n', { text: 'loading…' });
    E.live = h('div.rbx-livechip', { style: { marginLeft: 'auto' } });
    E.grid = h('div.cx__grid');
    E.pager = h('div.cx__pager');

    body.append(
      E.hero,
      E.bar,
      E.bar2,
      E.because,
      E.wantBox,
      E.cmpBox,
      E.cmpBar,
      h('div.cx__sec',
        h('div.cx__sec-h', icon('box'), E.secT, E.secN, E.live),
        E.grid, E.pager),
      footNote());
  }

  async function start() {
    /* A self-hosted worker, if there is one, takes priority over the public
       mirror — it is the person's own infrastructure rather than someone
       else's courtesy. Without one, roblox.data.js falls back to roproxy,
       which needs no setup at all. */
    RB.bridge.base = api.store.get('portal.proxyWorker', '') || '';
    await RB.load();
    if (life.dead()) return;
    if (RB.loadError()) {
      api.clear(E.grid);
      E.grid.appendChild(h('div.empty', icon('alert'),
        h('b', { text: 'The Roblox catalogue did not load' }),
        h('small', { text: String(RB.loadError().message || RB.loadError()) }),
        h('small', { text: 'Check your connection and open Static Roblox again in a moment.' })));
      E.secN.textContent = 'unavailable';
      return;
    }
    paintCats();
    paintHero();
    paintGrid();
    refreshVisible();
  }

  const qopts = () => ({ category: S.cat, q: S.q, sort: S.sort, page: S.page, perPage: 48, year: S.year, maturity: S.mat });

  /* Top the numbers up for whatever is actually on screen. Never invents a
     figure: if the mirror is unreachable the baked ones stay, and the
     status line says when they were taken. */
  async function refreshVisible() {
    const shown = RB.query(qopts()).items;
    const n = await RB.refreshPlaying(shown);
    if (life.dead()) return;
    if (n) { paintHero(); paintGrid(); }
    paintLiveBadge();
    RB.refreshVotes(shown).then(v => { if (v && !life.dead()) paintGrid(); });
  }

  function paintLiveBadge() {
    if (!E.live) return;
    const st = RB.liveStatus();
    api.clear(E.live);
    if (st.ok) {
      E.live.appendChild(h('i.rbx-dot'));
      E.live.appendChild(h('span', { text: 'live' }));
      E.live.title = 'Player counts are being read from the live Roblox mirror.';
    } else {
      E.live.appendChild(icon('alert', { size: 11 }));
      E.live.appendChild(h('span', { text: RB.asOf() ? `snapshot of ${RB.fmtDay(RB.asOf())}` : 'last sync' }));
      E.live.title = 'The live mirror did not answer, so these are the counts from the last sync'
        + (RB.asOf() ? `, read on ${RB.fmtDay(RB.asOf())}.` : '.');
    }
  }

  function paintCats() {
    api.clear(E.cats);
    const c = RB.counts();
    const favN = readList(api, FAV_KEY).length;
    const recN = readList(api, RECENT_KEY).length;
    const wantN = wantRows(api).length;
    const rows = [
      ...(favN ? [['favourites', 'Favourites', favN]] : []),
      ...(wantN ? [['want', 'Want to play', wantN]] : []),
      ...(recN ? [['recent', 'Recently played', recN]] : []),
      ...RB.CATEGORIES.map(([id, label]) => [id, label, c.get(id) || 0]),
    ];
    for (const [id, label, n] of rows) {
      if (!n && id !== 'all') continue;
      E.cats.appendChild(h(id === S.cat ? 'button.cx-cat.is-on' : 'button.cx-cat', {
        type: 'button', 'aria-pressed': String(id === S.cat),
        onclick: () => { S.cat = id; S.page = 1; S.liveRows = null; paintCats(); paintGrid(); },
      }, h('span', { text: label }), h('i.cx-cat__n', { text: String(n) })));
    }
  }

  function paintHero() {
    api.clear(E.hero);
    const top = RB.query({ sort: 'playing', perPage: 1 }).items[0];
    if (!top) return;

    const art = h('div.rbx-hero__art');
    if (RB.iconUrl(top, 'wide') || RB.iconUrl(top)) {
      art.appendChild(h('img', {
        src: RB.iconUrl(top, 'wide') || RB.iconUrl(top), alt: '', loading: 'eager', decoding: 'async',
        referrerpolicy: 'no-referrer',
      }));
    }

    E.hero.appendChild(h('div.rbx-hero', art,
      h('div.rbx-hero__b',
        h('div.rbx-hero__k', icon('box'), h('span', { text: top.live ? 'Most played right now' : 'Most played at the last sync' })),
        h('h2.rbx-hero__t', { text: top.name }),
        h('div.rbx-hero__m',
          h('b', { text: compact(top.playing) }), ` playing (${RB.countWhen(top, true)}) · `,
          h('b', { text: compact(top.visits) }), ' visits · ',
          h('b', { text: `${top.rating}%` }), ' rated'),
        h('div.rbx-hero__a',
          launchButton(api, top, { big: true }),
          h('button.btn.btn--ghost', {
            type: 'button', onclick: () => navigate(urlFor(top.id)),
          }, icon('info'), 'Details')),
        h('div.rbx-hero__n', { text: `${compact(RB.playersOnline())} players across ${RB.all().length} experiences, counted ${RB.asOf() ? `on ${RB.fmtDay(RB.asOf())}` : 'at the last sync'}; ones refreshed live say so` }))));
  }

  /* The two store-backed views are ordered by the stored list, not by
     player count — "recently played" that reorders itself is not a
     history, and a favourites list that reshuffles is disorienting. */
  function localRows() {
    if (S.cat === 'favourites' || S.cat === 'recent' || S.cat === 'want') {
      const ids = S.cat === 'want' ? wantRows(api).map(r => r.id) : readList(api, S.cat === 'favourites' ? FAV_KEY : RECENT_KEY);
      const low = S.q.trim().toLowerCase();
      const rows = ids.map(id => RB.byId(id)).filter(Boolean)
        .filter(r => (!low || r.name.toLowerCase().includes(low))
          && (!S.year || r.year === S.year) && (!S.mat || r.maturity === S.mat));
      return { items: rows, total: rows.length, page: 1, pages: 1 };
    }
    return RB.query(qopts());
  }

  function labelFor() {
    if (S.cat === 'favourites') return 'Favourites';
    if (S.cat === 'recent') return 'Recently played';
    if (S.cat === 'want') return 'Want to play';
    return RB.CATEGORIES.find(c => c[0] === S.cat)?.[1] || 'Experiences';
  }

  function paintGrid() {
    const res = localRows();
    const live = S.liveRows || [];
    E.secT.textContent = S.q ? `“${S.q}”` : labelFor();
    const n = res.total + live.length;
    E.secN.textContent = S.liveBusy
      ? `${n.toLocaleString()} found · searching Roblox…`
      : `${n.toLocaleString()} experience${n === 1 ? '' : 's'}`;

    api.clear(E.grid);
    paintBecause();
    paintWant();
    paintCompare();
    if (!res.items.length && !live.length) {
      E.grid.appendChild(emptyState());
      api.clear(E.pager);
      return;
    }
    for (const row of res.items) E.grid.appendChild(card(row));

    /* Anything the live mirror found that the baked catalogue does not
       have gets its own clearly-labelled section rather than being mixed
       in, so it is obvious which results came from where. */
    if (live.length) {
      E.grid.appendChild(h('div.rbx-grid__split',
        icon('search', { size: 12 }),
        h('span', { text: `${live.length} more from Roblox right now` })));
      for (const row of live) E.grid.appendChild(card(row));
    }
    paintPager(res);
  }

  /* "Because you played …": experiences like the one you launched last, from the
     catalogue (same creator, then shared categories). Nothing here is a guess
     about other people, and it is only there once you have played something. */
  function paintBecause() {
    api.clear(E.because);
    if (S.cat !== 'all' || S.q.trim() || S.year || S.mat) return;
    const recent = readList(api, RECENT_KEY);
    const seed = recent.map(id => RB.byId(id)).find(Boolean);
    if (!seed) return;
    const skip = new Set(recent);
    const picks = RB.related(seed, 24).filter(r => !skip.has(r.id)).slice(0, 12);
    if (picks.length < 3) return;
    const rail = h('div.cx__grid--rail');
    for (const r of picks) rail.appendChild(card(r));
    E.because.appendChild(h('div.cx__sec', { dataset: { shelf: 'because' } },
      h('div.cx__sec-h', icon('compass'), h('div.cx__sec-t', { text: `Because you played ${seed.name}` }),
        h('div.cx__sec-n', { text: 'same maker or similar experiences, from the catalogue' })),
      rail));
  }

  /* Want to play: the list, with a reminder each if you asked for one. */
  async function paintWant() {
    api.clear(E.wantBox);
    if (S.cat !== 'want') return;
    const rows = wantRows(api);
    if (!rows.length) return;
    const seq = ++S.wseq;
    const items = [];
    for (const w of rows) {
      const r = RB.byId(w.id);
      if (!r) continue;
      items.push([w, r, await reminderText(w.rem)]);
    }
    if (seq !== S.wseq || life.dead() || S.cat !== 'want') return;
    api.clear(E.wantBox);
    E.wantBox.appendChild(h('div.rbx-want', { 'aria-label': 'Want to play, with reminders' },
      ...items.map(([w, r, rem]) => h('div.rbx-want__row', { dataset: { id: r.id } },
        h('b', { text: r.name }),
        h('small.dim', { text: rem || 'No reminder' }),
        reminderSelect(r, () => paintGrid()),
        w.rem ? h('button.btn.btn--ghost.btn--sm', {
          type: 'button', onclick: async () => { await dropReminder(w.rem); api.store.set(WANT_KEY, wantRows(api).map(x => (x.id === r.id ? { id: r.id, rem: '' } : x))); paintWant(); },
        }, 'Clear reminder') : null,
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button', 'aria-label': `Take ${r.name} off the list`,
          onclick: async () => { await toggleWant(api, r.id); paintCats(); paintGrid(); },
        }, icon('x', { size: 12 }), 'Remove')))));
  }

  /** The "Remind me…" picker: makes an ordinary reminder, listed in Automations. */
  function reminderSelect(row, done) {
    const sel = h('select.select', {
      'aria-label': `Remind me to play ${row.name}`,
      onchange: async e => {
        const v = e.target.value;
        e.target.value = '';
        if (!v) return;
        const r = await setWantReminder(api, row, v);
        api.notify?.({ title: r.ok ? 'Reminder set' : 'Could not set it', message: r.ok ? `${row.name}: ${r.text}. It is in Automations too.` : r.text, icon: r.ok ? 'bell' : 'alert' });
        if (typeof done === 'function') done();
      },
    }, h('option', { value: '', text: 'Remind me…' }),
      h('option', { value: 'hour', text: 'in 1 hour' }),
      h('option', { value: '3h', text: 'in 3 hours' }),
      h('option', { value: 'tomorrow', text: 'tomorrow, same time' }));
    return sel;
  }

  /* Compare up to three experiences side by side. Only catalogue rows can be
     compared, and the table shows the catalogue's own fields — no scores. */
  function toggleCmp(id) {
    if (S.cmp.includes(id)) S.cmp = S.cmp.filter(x => x !== id);
    else if (S.cmp.length < 3) S.cmp = [...S.cmp, id];
    else api.notify?.({ title: 'Three at most', message: 'Take one off the comparison to add another.', icon: 'info' });
    S.showCmp = S.showCmp && S.cmp.length > 1;
    paintGrid();
  }

  function paintCompare() {
    api.clear(E.cmpBox);
    api.clear(E.cmpBar);
    const rows = S.cmp.map(id => RB.byId(id)).filter(Boolean);
    E.cmpBar.classList.toggle('hidden', !rows.length);
    if (!rows.length) return;
    E.cmpBar.append(
      h('span', { text: `Comparing ${rows.map(r => r.name).join(' · ')}` }),
      h('button.btn.btn--primary.btn--sm', {
        type: 'button', disabled: rows.length < 2 ? '' : null, dataset: { act: 'compare' },
        onclick: () => { S.showCmp = !S.showCmp; paintCompare(); },
      }, rows.length < 2 ? 'Pick one more' : S.showCmp ? 'Hide the table' : `Compare ${rows.length}`),
      h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => { S.cmp = []; S.showCmp = false; paintGrid(); } }, 'Clear'));
    if (!S.showCmp || rows.length < 2) return;

    /* [label, value text, the number to rank by (or null)] */
    const line = [
      ['Made by', r => r.creator || 'Roblox', null],
      [`Playing (${RB.asOf() ? RB.fmtDay(RB.asOf(), false) : 'last sync'})`, r => `${num(r.playing)}${r.live ? ' · live' : ''}`, r => r.playing],
      ['Visits', r => num(r.visits), r => r.visits],
      ['Favourites', r => num(r.favorites), r => r.favorites],
      ['Rated up', r => (r.rating ? `${r.rating}%` : '—'), r => r.rating],
      ['Max players', r => (r.maxPlayers ? String(r.maxPlayers) : '—'), r => r.maxPlayers],
      ['Maturity', r => RB.maturityName(r.maturity) || '—', null],
      ['Made', r => (r.created ? RB.fmtDay(r.created) : '—'), null],
      ['Last updated', r => (r.updated ? RB.fmtDay(r.updated) : '—'), null],
    ];
    const best = f => {
      if (!f) return -1;
      const v = rows.map(f);
      const top = Math.max(...v);
      return top > 0 && v.filter(x => x === top).length === 1 ? v.indexOf(top) : -1;
    };
    E.cmpBox.appendChild(h('div.rbx-cmp', { 'aria-label': 'Comparison' },
      h('table',
        h('thead', h('tr', h('th'), ...rows.map(r => h('th', { text: r.name })))),
        h('tbody', line.map(([label, text, f]) => {
          const b = best(f);
          return h('tr', h('th', { scope: 'row', text: label }),
            ...rows.map((r, i) => h(i === b ? 'td.is-best' : 'td', { text: text(r) })));
        }))),
      h('small.dim', { text: 'Highlighted is the larger number where one is clearly larger. These come from the catalogue, not from a score.' })));
  }

  function emptyState() {
    if (S.cat === 'want') {
      return h('div.empty', icon('bookmark'),
        h('b', { text: 'Nothing on your list' }),
        h('small', { text: 'The + on a card, or Want to play on its page, adds an experience here. You can ask for a reminder too.' }),
        h('button.btn', { type: 'button', onclick: () => { S.cat = 'all'; paintCats(); paintGrid(); } },
          icon('box', { size: 14 }), 'Browse experiences'));
    }
    if (S.cat === 'favourites') {
      return h('div.empty', icon('heart'),
        h('b', { text: 'No favourites yet' }),
        h('small', { text: 'Tap the heart on any experience and it will wait for you here.' }),
        h('button.btn', { type: 'button', onclick: () => { S.cat = 'all'; paintCats(); paintGrid(); } },
          icon('box', { size: 14 }), 'Browse experiences'));
    }
    if (S.cat === 'recent') {
      return h('div.empty', icon('clock'),
        h('b', { text: 'Nothing played yet' }),
        h('small', { text: 'Experiences you launch show up here.' }));
    }
    return h('div.empty', icon('search'),
      h('b', { text: S.q ? `Nothing here matches “${S.q}”` : 'Nothing matches that' }),
      h('small', { text: S.q ? 'Searching the live Roblox catalogue…' : 'Try another category or search term.' }),
      h('button.btn', {
        type: 'button',
        onclick: () => { S.q = ''; S.cat = 'all'; S.liveRows = null; E.filterIn.value = ''; paintCats(); paintGrid(); },
      }, icon('x', { size: 14 }), 'Clear filters'));
  }

  /* When a query finds little or nothing locally, ask the live mirror —
     the baked catalogue is 1,300 experiences and Roblox has millions. */
  async function searchLive() {
    const q = S.q.trim();
    const seq = ++S.seq;
    if (q.length < 2) { S.liveRows = null; S.liveBusy = false; return; }
    const known = new Set(RB.all().map(r => r.id));
    S.liveBusy = true;
    paintGrid();
    const rows = await RB.searchLive(q, { limit: 36 });
    if (seq !== S.seq || life.dead()) return;        // a newer query won
    const fresh = rows.filter(r => !known.has(r.id));
    await RB.fetchArt(fresh);
    if (seq !== S.seq || life.dead()) return;
    S.liveRows = fresh.filter(r => r.art);
    S.liveBusy = false;
    paintGrid();
  }

  function card(row) {
    const art = h('div.rbx-card__art');
    if (RB.iconUrl(row)) {
      art.appendChild(h('img', {
        src: RB.iconUrl(row), alt: '', loading: 'lazy', decoding: 'async',
        referrerpolicy: 'no-referrer',
        onerror: e => { e.target.remove(); },
      }));
    }
    /* every count says which day it is from: "live" only if the mirror just refreshed it */
    art.appendChild(h('div.rbx-card__live', { title: row.live ? 'Read live just now' : `Counted at the last sync${RB.asOf() ? `, ${RB.fmtDay(RB.asOf())}` : ''}` },
      h('i.rbx-dot'), h('span', { text: compact(row.playing) }), h('small.rbx-asof', { text: RB.countWhen(row) })));

    /* Want to play and Compare sit on the art beside the heart (catalogue rows only —
       a live search result has no catalogue entry to list or compare). */
    const inCatalogue = !!RB.byId(row.id);
    if (inCatalogue) {
      const want = h('button.rbx-card__add', {
        type: 'button', dataset: { act: 'want' },
        'aria-label': `${isWant(api, row.id) ? 'Take off' : 'Add to'} Want to play: ${row.name}`,
        'aria-pressed': String(isWant(api, row.id)),
        onclick: async e => {
          e.stopPropagation();
          const on = await toggleWant(api, row.id);
          want.classList.toggle('is-on', on);
          want.setAttribute('aria-pressed', String(on));
          want.setAttribute('aria-label', `${on ? 'Take off' : 'Add to'} Want to play: ${row.name}`);
          paintCats();
          if (S.cat === 'want') paintGrid();
        },
      }, icon(isWant(api, row.id) ? 'bookmark' : 'plus', { size: 13 }));
      if (isWant(api, row.id)) want.classList.add('is-on');
      art.appendChild(want);
      const cmpOn = S.cmp.includes(row.id);
      art.appendChild(h(cmpOn ? 'button.rbx-card__cmpb.is-on' : 'button.rbx-card__cmpb', {
        type: 'button', dataset: { act: 'compare' }, 'aria-pressed': String(cmpOn),
        'aria-label': `${cmpOn ? 'Take out of' : 'Add to'} the comparison: ${row.name}`,
        onclick: e => { e.stopPropagation(); toggleCmp(row.id); },
      }, icon('layers', { size: 12 }), h('span', { text: cmpOn ? 'Comparing' : 'Compare' })));
    }

    /* The heart lives on the art so hovering never reflows the card. */
    const fav = h('button.rbx-card__fav', {
      type: 'button',
      'aria-label': `${isFav(api, row.id) ? 'Remove from' : 'Add to'} favourites: ${row.name}`,
      'aria-pressed': String(isFav(api, row.id)),
      onclick: e => {
        e.stopPropagation();
        const on = toggleFav(api, row.id);
        fav.classList.toggle('is-on', on);
        fav.setAttribute('aria-pressed', String(on));
        fav.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} favourites: ${row.name}`);
        paintCats();
      },
    }, icon('heart', { size: 13 }));
    if (isFav(api, row.id)) fav.classList.add('is-on');
    art.appendChild(fav);

    /* The play button overlays the art rather than expanding the card:
       a control that appears on hover must not move the thing under the
       cursor, or a click meant for the card lands on the button. */
    art.appendChild(h('div.rbx-card__go', launchButton(api, row)));

    const meta = h('div.rbx-card__m',
      h('span.rbx-card__by', { text: row.creator || 'Roblox' }),
      row.verified ? icon('check-circle', { size: 11 }) : null,
      h('span.rbx-card__sp'),
      h('span', { text: S.sort === 'updated' && row.updated ? `Updated ${RB.fmtDay(row.updated, false)}` : `${row.rating}%` }));

    return h('div.rbx-card', {
      role: 'button', tabindex: '0',
      'aria-label': `${row.name} — details`,
      onclick: () => navigate(urlFor(row.id)),
      onkeydown: e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(urlFor(row.id)); }
      },
    }, art, h('div.rbx-card__b', h('div.rbx-card__t', { text: row.name }), meta));
  }

  function paintPager(res) {
    api.clear(E.pager);
    if (res.pages <= 1) return;
    const go = p => { S.page = p; paintGrid(); E.grid.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    E.pager.append(
      h('button.btn.btn--sm', { type: 'button', disabled: res.page <= 1 ? '' : null, onclick: () => go(res.page - 1) },
        icon('chevron-left', { size: 13 }), 'Back'),
      h('span.cx__pager-n', { text: `Page ${res.page} of ${res.pages}` }),
      h('button.btn.btn--sm', { type: 'button', disabled: res.page >= res.pages ? '' : null, onclick: () => go(res.page + 1) },
        'Next', icon('chevron-right', { size: 13 })));
  }

  function footNote() {
    return h('div.cx__sec',
      h('div.card',
        h('div.card__head', icon('info'), h('div.card__t', { text: 'How this page reaches Roblox' })),
        h('small.dim', {
          text: 'Roblox sends X-Frame-Options: SAMEORIGIN on every page, so no part of it can render '
              + 'inside a window here. Play hands the place id straight to the installed Roblox player '
              + 'with Roblox’s own roblox:// deep link, which opens the experience without a web page in '
              + 'between. The art and the numbers are saved into the catalogue ahead of time, because Roblox’s '
              + 'APIs send no CORS header — images never needed one, so the artwork is the real thing. '
              + 'Set up your own proxy on the Proxy page and the player counts go live through it too.',
        })));
  }

  return root;
}

/* ================================================================== *
 *  static://roblox/<id> — the detail page
 * ================================================================== */
export function buildRobloxDetail(ctx) {
  const { api, navigate, params } = ctx;
  const { h, icon } = api;

  const root = h('div.cx');
  const life = lifecycle(root);
  root.appendChild(topStrip(ctx, 'roblox'));
  const body = h('div');
  root.appendChild(body);

  body.appendChild(h('div.cx__sec', h('div.empty', icon('box'), h('b', { text: 'Loading…' }))));

  let paintDetail = () => {};
  let sendOpen = false;

  (async () => {
    RB.bridge.base = api.store.get('portal.proxyWorker', '') || '';
    await RB.load();
    if (life.dead()) return;
    const row = RB.byId(params);
    api.clear(body);
    if (!row) {
      body.appendChild(h('div.cx__sec', h('div.empty', icon('alert'),
        h('b', { text: 'No such experience' }),
        h('small', { text: `Nothing in the catalogue has the id ${params}.` }),
        h('button.btn', { type: 'button', onclick: () => navigate(LIB) }, icon('arrow-left'), 'Back to Roblox'))));
      return;
    }
    paintDetail = () => { api.clear(body); body.appendChild(detail(row)); };
    paintDetail();
    Promise.all([RB.refreshPlaying([row]), RB.refreshVotes([row])]).then(([a, b]) => {
      if ((a || b) && !life.dead()) paintDetail();
    });
  })();

  function detail(row) {
    const art = h('div.rbx-det__art');
    if (RB.iconUrl(row, 'wide') || RB.iconUrl(row)) {
      art.appendChild(h('img', {
        src: RB.iconUrl(row, 'wide') || RB.iconUrl(row), alt: '', decoding: 'async', referrerpolicy: 'no-referrer',
      }));
    }

    const stats = h('div.rbx-det__stats',
      stat(row.live ? 'Playing now · live' : `Playing · ${RB.asOf() ? RB.fmtDay(RB.asOf(), false) : 'last sync'}`, compact(row.playing), 'users'),
      stat('Visits', compact(row.visits), 'trending-up'),
      stat('Favourites', compact(row.favorites), 'heart'),
      stat('Rating', `${row.rating}%`, 'star'),
      stat('Max players', row.maxPlayers ? String(row.maxPlayers) : '—', 'user'),
      stat('Maturity', RB.maturityName(row.maturity) || '—', 'shield'));

    const favBtn = h('button.btn.btn--ghost', {
      type: 'button',
      'aria-pressed': String(isFav(api, row.id)),
      onclick: () => {
        const on = toggleFav(api, row.id);
        favBtn.classList.toggle('is-on', on);
        favBtn.setAttribute('aria-pressed', String(on));
        const label = favBtn.querySelector('span');
        if (label) label.textContent = on ? 'Favourited' : 'Favourite';
      },
    }, icon('heart', { size: 14 }), h('span', { text: isFav(api, row.id) ? 'Favourited' : 'Favourite' }));
    if (isFav(api, row.id)) favBtn.classList.add('is-on');

    /* two copy buttons, so it is clear which link you are taking */
    const copyButton = (label, which, link, tip) => h('button.btn.btn--ghost', {
      type: 'button', dataset: { copy: which }, title: tip,
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(link);
          api.notify?.({ title: `${which === 'app' ? 'App' : 'Web'} link copied`, message: link, icon: 'link' });
        } catch (err) {
          api.notify?.({ title: 'Could not copy', message: link, icon: 'link' });
        }
      },
    }, icon('link'), label);

    const wantBtn = h('button.btn.btn--ghost', { type: 'button', dataset: { act: 'want' } });
    const sendBtn = h('button.btn.btn--ghost', { type: 'button', 'aria-expanded': 'false' }, icon('users'), 'Send to a friend');

    /* the Want to play button, and (once it is on the list) a reminder picker */
    async function paintWantHold(hold, r, btn) {
      const on = isWant(api, r.id);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
      api.render(btn, icon(on ? 'bookmark' : 'plus'), h('span', { text: on ? 'On my want-to-play list' : 'Want to play' }));
      btn.onclick = async () => { await toggleWant(api, r.id); paintWantHold(hold, r, btn); };
      api.clear(hold);
      if (!on) return;
      const cur = wantRows(api).find(x => x.id === r.id);
      const txt = await reminderText(cur && cur.rem);
      if (life.dead()) return;
      api.clear(hold);
      hold.append(h('small.dim', { text: txt || 'No reminder set' }), reminderSelectFor(r, () => paintWantHold(hold, r, btn)));
    }
    function reminderSelectFor(r, done) {
      return h('select.select', {
        'aria-label': `Remind me to play ${r.name}`,
        onchange: async e => {
          const v = e.target.value;
          e.target.value = '';
          if (!v) return;
          const res = await setWantReminder(api, r, v);
          api.notify?.({ title: res.ok ? 'Reminder set' : 'Could not set it', message: res.ok ? `${r.name}: ${res.text}. It is in Automations too.` : res.text, icon: res.ok ? 'bell' : 'alert' });
          done();
        },
      }, h('option', { value: '', text: 'Remind me…' }),
        h('option', { value: 'hour', text: 'in 1 hour' }),
        h('option', { value: '3h', text: 'in 3 hours' }),
        h('option', { value: 'tomorrow', text: 'tomorrow, same time' }));
    }

    const actions = h('div.rbx-det__a',
      launchButton(api, row, { big: true }),
      favBtn,
      h('button.btn.btn--ghost', {
        type: 'button', onclick: e => launch(api, row, e.currentTarget),
      }, icon('play'), 'Try Roblox again'),
      webPlayOn ? h('a.btn.btn--ghost', {
        href: RB.webLink(row.placeId), target: '_blank', rel: 'noopener',
        dataset: { rbx: 'webplay' },
        title: 'Opens this experience on roblox.com in a new tab',
      }, icon('globe'), 'Play in browser (Roblox Web Play)') : null,
      copyButton('Copy app link', 'app', RB.launchLink(row.placeId), 'The link the Roblox app opens'),
      copyButton('Copy web link', 'web', RB.webLink(row.placeId), 'The roblox.com page'),
      wantBtn,
      sendBtn);

    const sendHold = h('div.rbx-det__send.hidden', { role: 'group', 'aria-label': 'Send to a friend' });
    /* the page repaints when live numbers arrive: an open panel must stay open */
    const showSend = open => {
      sendHold.classList.toggle('hidden', !open);
      sendBtn.setAttribute('aria-expanded', String(open));
      sendOpen = open;
      if (open) paintFriendPanel(ctx, sendHold, { kind: 'roblox', id: row.id, title: row.name }, () => !life.dead());
    };
    sendBtn.onclick = () => showSend(!sendOpen);
    if (sendOpen) showSend(true);
    const wantHold = h('div.rbx-want__row', { dataset: { want: row.id } });
    paintWantHold(wantHold, row, wantBtn);

    return h('div.cx__sec',
      h('button.btn.btn--ghost.btn--sm', {
        type: 'button', style: { marginBottom: '10px' }, onclick: () => navigate(LIB),
      }, icon('arrow-left', { size: 13 }), 'All experiences'),
      h('div.rbx-det', art,
        h('div.rbx-det__b',
          h('h2.rbx-det__t', { text: row.name }),
          h('div.rbx-det__by',
            h('span', { text: `by ${row.creator || 'Roblox'}` }),
            row.verified ? icon('check-circle', { size: 12 }) : null),
          row.desc ? h('p.rbx-det__d', { text: row.desc }) : null,
          actions,
          wantHold,
          sendHold,
          deviceNote(api),
          h('small.dim.rbx-det__routes', {
            text: 'Play hands the place id to the Roblox app on this device. Roblox cannot be played '
                + 'inside this window, and Static never shows roblox.com in a frame.',
          }),
          h('div.rbx-det__ids',
            h('span', { text: `Place ${row.placeId}` }),
            h('span', { text: `Universe ${row.id}` }),
            row.updated ? h('span', { text: `Updated ${String(row.updated).slice(0, 10)}` }) : null))),
      stats,
      h('small.dim.rbx-det__asof', {
        text: `Counts are a snapshot${RB.asOf() ? ` from ${RB.fmtDay(RB.asOf())}` : ' from the last catalogue sync'}${row.live ? '; this one was just refreshed live' : ''}. Maturity is Roblox’s own rating.`,
      }),
      serverPanel(row),
      affiliation(api));
  }

  /* Real public servers, read live. Shows nothing at all rather than a
     placeholder when the mirror does not answer. */
  function serverPanel(row) {
    const list = h('div.rbx-srv__list',
      h('div.rbx-srv__wait', h('div.spinner'), h('small', { text: 'Reading live servers…' })));
    const sec = h('div.cx__sec',
      h('div.cx__sec-h', icon('activity'), h('div.cx__sec-t', { text: 'Live servers' }),
        h('div.cx__sec-n', { text: 'public, right now' })),
      list);

    RB.servers(row.placeId, { limit: 9 }).then(rows => {
      if (life.dead()) return;
      api.clear(list);
      if (!rows.length) {
        sec.remove();
        return;
      }
      for (const sv of rows) {
        const pct = sv.max ? Math.round((sv.playing / sv.max) * 100) : 0;
        list.appendChild(h('div.rbx-srv',
          h('div.rbx-srv__top',
            h('b', { text: `${sv.playing}/${sv.max}` }),
            h('span.rbx-srv__ping', { text: sv.ping ? `${sv.ping} ms` : '—' })),
          h('div.rbx-srv__bar', h('i', { style: { width: `${Math.min(100, pct)}%` } })),
          h('div.rbx-srv__id', { text: String(sv.id).slice(0, 8) })));
      }
    }).catch(() => { sec.remove(); });

    return sec;
  }

  function stat(label, value, ic) {
    return h('div.rbx-stat', icon(ic, { size: 14 }),
      h('div', h('div.rbx-stat__v', { text: value }), h('div.rbx-stat__l', { text: label })));
  }

  return root;
}

export default { buildRoblox, buildRobloxDetail };
