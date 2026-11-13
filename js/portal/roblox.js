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
import * as ST from './roblox.stream.js';

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
  const { notify } = api;
  noteplayed(api, row.id);
  handOff(RB.launchLink(row.placeId));
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
  notify?.({
    title: row.name,
    message: 'Sent to the installed Roblox player. A web fallback is not opened from Static.',
    icon: 'box',
  });
}


/* ---------- streamed play ----------------------------------- *
 * Roblox has no web player, so "play here" means streaming the real
 * client off a cloud Android device. Every such service refuses to be
 * framed; Static's tunnel gets past that by serving the page from our
 * own origin. See roblox.stream.js for why the video survives that.
 * ---------------------------------------------------------- */

function streamStage(api, { onBack, title = 'Roblox' } = {}) {
  const { h, icon } = api;
  const app = ST.byId('roblox');

  const frame = h('iframe.rbx-stream__frame', {
    title: `${app.name} — streamed`,
    allow: 'autoplay; fullscreen; gamepad; clipboard-write; encrypted-media; microphone; camera',
    allowfullscreen: '',
  });

  const stageLine = h('div.rbx-stream__stage', { text: 'Opening the tunnel…' });
  const clock = h('span.rbx-stream__clock', { text: '0s' });
  const spinner = h('div.spinner');
  const veil = h('div.rbx-stream__veil',
    spinner,
    h('b', { text: `Starting ${app.name}` }),
    stageLine,
    h('div.rbx-stream__meta', clock,
      h('span', { text: '·' }),
      h('span', { text: 'streamed from a cloud device' })),
    h('ul.rbx-stream__caveats', ST.CAVEATS.map(c => h('li', { text: c }))));

  const wrap = h('div.rbx-stream__wrap', frame, veil);

  const badge = h('span.rbx-stream__badge', h('i.rbx-dot'), h('span', { text: 'starting' }));

  const root = h('div.rbx-stream',
    h('div.rbx-stream__bar',
      h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => onBack?.() },
        icon('arrow-left', { size: 13 }), 'Back'),
      h('b.rbx-stream__title', { text: title }),
      badge,
      h('div.grow'),
      h('button.ibtn.tip', { type: 'button', 'data-tip': 'Reload the stream', 'aria-label': 'Reload the stream',
        onclick: () => start() }, icon('refresh')),
      h('button.ibtn.tip', { type: 'button', 'data-tip': 'Fill the window', 'aria-label': 'Fill the window',
        onclick: e => e.currentTarget.closest('.rbx-stream').classList.toggle('is-full') }, icon('maximize-2'))),
    wrap);

  let watching = null;
  start();
  return root;

  function fail(why, retry = true) {
    api.clear(veil);
    veil.append(
      icon('alert', { size: 22 }),
      h('b', { text: `${app.name} would not start` }),
      h('div.rbx-stream__stage', { text: why }),
      h('div.rbx-stream__acts',
        retry ? h('button.btn', { type: 'button', onclick: () => start() },
          icon('refresh', { size: 13 }), 'Try again') : null,
        h('button.btn.btn--ghost', { type: 'button', onclick: () => onBack?.() },
          icon('arrow-left', { size: 13 }), 'Back')),
      h('ul.rbx-stream__caveats', ST.CAVEATS.map(c => h('li', { text: c }))));
    badge.className = 'rbx-stream__badge is-bad';
    api.clear(badge);
    badge.append(icon('alert', { size: 11 }), h('span', { text: 'not running' }));
  }

  async function start() {
    /* rebuild the waiting state on a retry */
    api.clear(veil);
    veil.append(spinner, h('b', { text: `Starting ${app.name}` }), stageLine,
      h('div.rbx-stream__meta', clock, h('span', { text: '·' }),
        h('span', { text: 'streamed from a cloud device' })),
      h('ul.rbx-stream__caveats', ST.CAVEATS.map(c => h('li', { text: c }))));
    if (!veil.isConnected) wrap.appendChild(veil);
    stageLine.textContent = 'Opening the tunnel…';

    const prep = await ST.prepare();
    if (!prep.ok) {
      fail(`${prep.why} The stream needs the tunnel, because that is what gets it past the player's frame rules.`, false);
      return;
    }

    try {
      frame.src = ST.streamUrl(app);
    } catch (err) {
      fail(err.message);
      return;
    }

    watching = ST.watch(frame, {
      onState: ({ seconds, detail }) => {
        clock.textContent = `${seconds}s`;
        stageLine.textContent = detail;
      },
    });

    const out = await watching;
    if (!root.isConnected) return;
    if (out.phase === 'live') {
      veil.remove();
      badge.className = 'rbx-stream__badge is-live';
      api.clear(badge);
      badge.append(h('i.rbx-dot'), h('span', { text: 'live' }));
    } else {
      fail('The cloud device never started. Their queue may be full — this is their capacity, not a bug here.');
    }
  }
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

  const S = {
    cat: 'all', q: '', sort: 'playing', page: 1,
    liveRows: null,      // results from the live mirror for the current query
    liveBusy: false,
    seq: 0,              // guards against a slow search landing after a newer one
  };
  const E = {};

  /* The stage replaces the library wholesale — a streamed client wants the
     whole window, and leaving the grid mounted behind it would keep its
     live-count refreshes running under a video. */
  function showStream(title) {
    api.clear(body);
    body.appendChild(streamStage(api, {
      title,
      onBack: () => { buildShell(); start(); },
    }));
  }

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
      h('option', { value: 'az', text: 'A–Z' }));
    E.sort.value = S.sort;

    E.bar = h('div.cx__bar', E.cats, E.filter, E.sort);
    E.secT = h('div.cx__sec-t', { text: 'Experiences' });
    E.secN = h('div.cx__sec-n', { text: 'loading…' });
    E.live = h('div.rbx-livechip', { style: { marginLeft: 'auto' } });
    E.grid = h('div.cx__grid');
    E.pager = h('div.cx__pager');

    body.append(
      E.hero,
      E.bar,
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
        h('small', { text: 'Run node tools/sync-roblox.mjs to rebuild data/roblox.json.' })));
      E.secN.textContent = 'unavailable';
      return;
    }
    paintCats();
    paintHero();
    paintGrid();
    refreshVisible();
  }

  /* Top the numbers up for whatever is actually on screen. Never invents a
     figure: if the mirror is unreachable the baked ones stay, and the
     status line says when they were taken. */
  async function refreshVisible() {
    const shown = RB.query({ category: S.cat, q: S.q, sort: S.sort, page: S.page, perPage: 48 }).items;
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
      E.live.appendChild(h('span', { text: 'catalogue numbers' }));
      E.live.title = 'The live mirror did not answer, so these are the numbers from the last sync.';
    }
  }

  function paintCats() {
    api.clear(E.cats);
    const c = RB.counts();
    const favN = readList(api, FAV_KEY).length;
    const recN = readList(api, RECENT_KEY).length;
    const rows = [
      ...(favN ? [['favourites', 'Favourites', favN]] : []),
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
    if (top.wide || top.art) {
      art.appendChild(h('img', {
        src: top.wide || top.art, alt: '', loading: 'eager', decoding: 'async',
        referrerpolicy: 'no-referrer',
      }));
    }

    E.hero.appendChild(h('div.rbx-hero', art,
      h('div.rbx-hero__b',
        h('div.rbx-hero__k', icon('box'), h('span', { text: 'Most played right now' })),
        h('h2.rbx-hero__t', { text: top.name }),
        h('div.rbx-hero__m',
          h('b', { text: compact(top.playing) }), ' playing · ',
          h('b', { text: compact(top.visits) }), ' visits · ',
          h('b', { text: `${top.rating}%` }), ' rated'),
        h('div.rbx-hero__a',
          launchButton(api, top, { big: true }),
          h('button.btn.btn--go', {
            type: 'button',
            'aria-label': 'Play Roblox in this window, streamed',
            onclick: () => showStream('Roblox'),
          }, icon('cast', { size: 14 }), h('span', { text: 'Play in this window' })),
          h('button.btn.btn--ghost', {
            type: 'button', onclick: () => navigate(urlFor(top.id)),
          }, icon('info'), 'Details')),
        h('div.rbx-hero__n', { text: `${compact(RB.playersOnline())} players across ${RB.all().length} experiences` }))));
  }

  /* The two store-backed views are ordered by the stored list, not by
     player count — "recently played" that reorders itself is not a
     history, and a favourites list that reshuffles is disorienting. */
  function localRows() {
    if (S.cat === 'favourites' || S.cat === 'recent') {
      const ids = readList(api, S.cat === 'favourites' ? FAV_KEY : RECENT_KEY);
      const low = S.q.trim().toLowerCase();
      const rows = ids.map(id => RB.byId(id)).filter(Boolean)
        .filter(r => !low || r.name.toLowerCase().includes(low));
      return { items: rows, total: rows.length, page: 1, pages: 1 };
    }
    return RB.query({ category: S.cat, q: S.q, sort: S.sort, page: S.page, perPage: 48 });
  }

  function labelFor() {
    if (S.cat === 'favourites') return 'Favourites';
    if (S.cat === 'recent') return 'Recently played';
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

  function emptyState() {
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
    if (row.art) {
      art.appendChild(h('img', {
        src: row.art, alt: '', loading: 'lazy', decoding: 'async',
        referrerpolicy: 'no-referrer',
        onerror: e => { e.target.remove(); },
      }));
    }
    art.appendChild(h('div.rbx-card__live', h('i.rbx-dot'), h('span', { text: compact(row.playing) })));

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
      h('span', { text: `${row.rating}%` }));

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
              + 'between. The art and the numbers are baked by tools/sync-roblox.mjs, because Roblox’s '
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

  /* Swapping the whole body rather than overlaying: a streamed client wants
     every pixel, and leaving the detail page mounted underneath would keep
     its live-refresh timers running behind a video. */
  function showStream(title) {
    api.clear(body);
    body.appendChild(streamStage(api, { title, onBack: () => paintDetail() }));
  }

  let paintDetail = () => {};

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
    if (row.wide || row.art) {
      art.appendChild(h('img', {
        src: row.wide || row.art, alt: '', decoding: 'async', referrerpolicy: 'no-referrer',
      }));
    }

    const stats = h('div.rbx-det__stats',
      stat('Playing now', compact(row.playing), 'users'),
      stat('Visits', compact(row.visits), 'trending-up'),
      stat('Favourites', compact(row.favorites), 'heart'),
      stat('Rating', `${row.rating}%`, 'star'),
      stat('Max players', row.maxPlayers ? String(row.maxPlayers) : '—', 'user'),
      stat('Maturity', row.maturity || '—', 'shield'));

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

    const streamBtn = h('button.btn.btn--go', {
      type: 'button',
      'aria-label': `Play Roblox in this window, streamed`,
      onclick: () => showStream(`${row.name} — via Roblox`),
    }, icon('cast', { size: 14 }), h('span', { text: 'Play in this window' }));

    const actions = h('div.rbx-det__a',
      launchButton(api, row, { big: true }),
      streamBtn,
      favBtn,
      h('button.btn.btn--ghost', {
        type: 'button', onclick: () => launch(api, row),
      }, icon('play'), 'Try Roblox again'),
      h('button.btn.btn--ghost', {
        type: 'button',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(RB.webLink(row.placeId));
            api.notify?.({ title: 'Link copied', message: RB.webLink(row.placeId), icon: 'link' });
          } catch (err) {
            api.notify?.({ title: 'Could not copy', message: RB.webLink(row.placeId), icon: 'link' });
          }
        },
      }, icon('link'), 'Copy link'));

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
          h('small.dim.rbx-det__routes', {
            text: 'Two ways in. “Play in Roblox” hands the place id to the Roblox app on this '
                + 'machine, which is instant if it is installed. “Play in this window” streams the '
                + 'real client off a cloud Android device through Static’s tunnel — no install, but '
                + 'it queues, and you land in Roblox rather than straight into this experience.',
          }),
          h('div.rbx-det__ids',
            h('span', { text: `Place ${row.placeId}` }),
            h('span', { text: `Universe ${row.id}` }),
            row.updated ? h('span', { text: `Updated ${String(row.updated).slice(0, 10)}` }) : null))),
      stats,
      serverPanel(row));
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
