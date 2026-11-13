/* ============================================================
   extras.js — the three smaller Static pages, ported from the
   old Google Sites build.

     static://arcade  buildArcadeHub  the hub that ties the portal together
     static://proxy   buildProxy      the old proxy bookmark list, told honestly
     static://apply   buildApply      the "apply for positions" page, as a real form

   Same contract as every other page module: build(ctx) returns a
   node SYNCHRONOUSLY and fills itself in when the async data
   lands. No data is read from anywhere except ctx.providers.
   ============================================================ */

import { BRAND } from './brand.js';
import * as PX from './proxies.js';
import * as RD from './proxy.reader.js';

/**
 * Open a real background tab. Passing a features string (even just 'noopener')
 * makes the browser treat this as a popup-window request, so the link opens in
 * a chrome-less window instead of a tab; clearing `opener` by hand gives the
 * same protection without that side effect.
 */
/* Row count of data/anime.json — 7,963 titles. The file is a 7.9 MB
   fetch, so the hub can state the number without pulling it. */
const ANIME_ROWS = 7963;

/* The old site's footer, kept verbatim. */
const FOOTER_LINE = 'v3.2.2 · Page: 606 ms · 14 Socket-24';

const NAV = [
  { id: 'home',   label: 'Home',   icon: 'home',    url: 'static://home' },
  { id: 'games',  label: 'Games',  icon: 'gamepad', url: 'static://games' },
  { id: 'movies', label: 'Movies', icon: 'film',    url: 'static://movies' },
  { id: 'anime',  label: 'Anime',  icon: 'star',    url: 'static://anime' },
  { id: 'search', label: 'Search', icon: 'search',  url: 'static://search' },
];

/* ------------------------------------------------------------------ *
 *  shared chrome — every Static page opens with the same strip
 * ------------------------------------------------------------------ */
function topStrip(ctx, current) {
  const { api, navigate } = ctx;
  const { h, icon } = api;

  const input = h('input', {
    type: 'search', placeholder: `Search ${BRAND.name}…`, spellcheck: 'false',
    'aria-label': `Search ${BRAND.name}`,
  });
  const form = h('form.field.cx__find', {
    onsubmit: e => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) navigate(`static://search?q=${encodeURIComponent(q)}`);
      else input.focus();
    },
  }, icon('search'), input);

  const nav = h('div.cx__nav', NAV.map(n => {
    const b = h('button', { type: 'button', onclick: () => navigate(n.url) },
      icon(n.icon), h('span', { text: n.label }));
    if (n.id === current) { b.classList.add('is-on'); b.setAttribute('aria-current', 'page'); }
    return b;
  }));

  return h('div.cx__top',
    h('div.cx__mark', icon(BRAND.icon), h('span', { text: BRAND.wordmark })),
    form, nav);
}

/** A .cx__sec with its head already built. Returns the shell + its body. */
function section(api, iconName, title, note, action) {
  const { h, icon } = api;
  const noteEl = h('div.cx__sec-n', { text: note || '' });
  const body = h('div');
  const head = h('div.cx__sec-h', icon(iconName), h('div.cx__sec-t', { text: title }), noteEl);
  if (action) { head.appendChild(h('div.grow')); head.appendChild(action); }
  return { el: h('div.cx__sec', head, body), body, noteEl };
}

/** Body copy inside a .card — small, readable, token-coloured. */
function prose(api, ...kids) {
  return api.h('small.muted', {
    style: { display: 'block', fontSize: 'var(--fs-11)', lineHeight: '1.65' },
  }, kids);
}

const isProviderError = (providers, err) =>
  !!err && (err.name === 'ProviderError'
    || (providers && providers.ProviderError && err instanceof providers.ProviderError));

/** The honest failure block: what broke, why, and a way to try again. */
function downBlock(api, providers, err, retry) {
  const { h, icon } = api;
  const known = isProviderError(providers, err);
  const why = known
    ? (err.message || 'The provider refused the request.')
    : (err && err.message ? err.message : 'Something failed before the data arrived.');
  return h('div.cx-down', icon('alert'),
    h('div.grow',
      h('b', { text: known ? 'Static could not reach its data' : 'That did not load' }),
      h('small', { text: `${why} Nothing is cached for this view, so there is nothing to show yet.` }),
      retry && h('div.row', { style: { marginTop: 'var(--sp-4)' } },
        h('button.btn.btn--sm', { type: 'button', onclick: retry },
          icon('refresh'), h('span', { text: 'Retry' })))));
}

/** Rail-shaped loading placeholders. */
function skeletons(api, n, poster) {
  const { h } = api;
  return Array.from({ length: n }, () => h('div.cx-card',
    h(`div.cx-skel.cx-skel--${poster ? 'poster' : 'art'}`),
    h('div.cx-card__b',
      h('div.cx-skel.cx-skel--line'),
      h('div.cx-skel.cx-skel--line', { style: { width: '58%' } }))));
}

/* ------------------------------------------------------------------ *
 *  cards
 * ------------------------------------------------------------------ */
function gameCard(ctx, g) {
  const { api, navigate, providers } = ctx;
  const { h, icon } = api;
  /* In proxy mode these rows come straight off the wire, so nothing but
     title/id is guaranteed — a missing field must not take the rail down. */
  const hot = !!(g.cats && g.cats.includes('featured'));
  const rating = typeof g.rating === 'number' ? g.rating.toFixed(1) : '—';
  return h('button.cx-card', {
    type: 'button', 'aria-label': `${g.title} — open`,
    onclick: () => navigate(`static://games/${g.id}`),
  },
    h('div.cx-card__art', { style: { '--art': providers.artFor(g.title, 'game') } },
      h(`div.cx-card__tag${hot ? '.cx-card__tag--hot' : ''}`,
        icon(hot ? 'flame' : 'star', { fill: !hot }),
        h('span', { text: hot ? 'Featured' : rating })),
      h('div.cx-card__mono', { text: g.title }),
      h('div.cx-card__play', h('i', icon('play', { fill: true })))),
    h('div.cx-card__b',
      h('div.cx-card__t', { text: g.title }),
      h('div.cx-card__m', icon('play'),
        h('span', { text: `${providers.fmtPlays(g.plays || 0)} plays` }))));
}

function animeCard(ctx, row) {
  const { api, navigate, providers } = ctx;
  const { h, icon } = api;
  const art = h('div.cx-card__art', { style: { '--art': providers.artFor(row.title, 'anime') } });
  if (row.image) {
    art.appendChild(h('img', {
      src: row.image, alt: '', loading: 'lazy', decoding: 'async',
      style: {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        objectFit: 'cover', maxWidth: 'none',
      },
      onerror: e => { e.target.style.display = 'none'; },
    }));
  }
  if (row.score) {
    art.appendChild(h('div.cx-card__tag', icon('star', { fill: true }),
      h('span', { text: String(row.score) })));
  }
  art.appendChild(h('div.cx-card__play', h('i', icon('play', { fill: true }))));

  const bits = [row.year ? String(row.year) : null,
    row.episodes ? `${row.episodes} eps` : null,
    row.genres && row.genres.length ? row.genres[0] : null].filter(Boolean);

  return h('button.cx-card.cx-card--poster', {
    type: 'button', 'aria-label': `${row.title} — open`,
    onclick: () => navigate(`static://anime/${row.id}`),
  }, art,
    h('div.cx-card__b',
      h('div.cx-card__t', { text: row.title }),
      h('div.cx-card__m', icon('star'), h('span', { text: bits.join(' · ') || 'Anime' }))));
}

/* ------------------------------------------------------------------ *
 *  small utilities
 * ------------------------------------------------------------------ */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (err) { return String(url).replace(/^https?:\/\//, '').split('/')[0]; }
}

async function copyUrl(api, url) {
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      ok = true;
    }
  } catch (err) { ok = false; }
  api.notify({
    app: BRAND.name, icon: ok ? 'copy' : 'alert',
    title: ok ? 'Link copied' : 'Could not copy',
    message: ok ? url : `The clipboard is blocked here. The address is ${url}`,
  });
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entry';

/* ============================================================
   static://arcade — the hub
   ============================================================ */
export function buildArcadeHub(ctx) {
  const { api, providers, navigate } = ctx;
  const { h, icon, render } = api;

  const root = h('div.cx');
  root.appendChild(topStrip(ctx, 'arcade'));

  const games = providers.GAMES.length;
  const films = providers.MOVIES.length;

  /* ---- hero ------------------------------------------------ */
  const heroBtn = (label, ic, url, primary) =>
    h(`button.btn${primary ? '.btn--primary' : ''}`, { type: 'button', onclick: () => navigate(url) },
      icon(ic), h('span', { text: label }));

  root.appendChild(h('div.cx__hero',
    h('div.cx__hero-art', { style: { '--art': providers.artFor('aether arcade', 'game') } }),
    h('div.cx__hero-in',
      h('div.cx__hero-kick', { text: `${BRAND.name.toUpperCase()} ARCADE` }),
      h('div.cx__hero-t', { text: 'Everything, one tab' }),
      h('div.cx__hero-s', {
        text: `${games} games playable right now, ${ANIME_ROWS.toLocaleString()} anime in the `
            + `catalogue, ${films} films and series. Nothing to install and nothing to sign up for.`,
      }),
      h('div.cx__hero-acts',
        heroBtn('Games', 'gamepad', 'static://games', true),
        heroBtn('Anime', 'star', 'static://anime'),
        heroBtn('Movies', 'film', 'static://movies'),
        heroBtn('Search', 'search', 'static://search')))));

  /* ---- four ways in ---------------------------------------- */
  const searchV = h('div.stat__v');
  const searchD = h('div.stat__d');

  function paintSearchStat() {
    const loaded = providers.bigCatalogue.isLoaded('anime')
      ? (providers.bigCatalogue.peek('anime') || []).length : 0;
    searchV.textContent = (games + films + loaded).toLocaleString();
    searchD.textContent = loaded
      ? 'Games, films and the whole anime catalogue are in the index.'
      : `+${ANIME_ROWS.toLocaleString()} anime join the index once the catalogue is loaded.`;
  }
  paintSearchStat();

  const tile = (t) => {
    const stat = h('div.stat', { style: { margin: 'var(--sp-4) 0' } },
      t.valueEl || h('div.stat__v', { text: t.value }),
      h('div.stat__k', { text: t.kicker }),
      t.descEl || h('div.stat__d', { text: t.desc }));
    return h('div.card.card--hover',
      h('div.card__head', icon(t.icon), h('div.card__t', { text: t.title })),
      prose(api, t.blurb), stat,
      h('button.btn.btn--block', { type: 'button', onclick: () => navigate(t.url) },
        h('span', { text: t.cta }), icon('chevron-right')));
  };

  const ways = section(api, 'grid-9', 'Four ways in', 'Everything the portal holds');
  ways.body.appendChild(h('div.grid3',
    tile({ icon: 'gamepad', title: 'Games', url: 'static://games', cta: 'Open Games',
      blurb: 'Every game keeps the real embed URL the old site used, so it frames straight into the page.',
      value: String(games), kicker: 'Playable now', desc: 'All of them have a working source on file.' }),
    tile({ icon: 'star', title: 'Anime', url: 'static://anime', cta: 'Open Anime',
      blurb: 'MyAnimeList metadata, cover art and external ids for every title in the catalogue.',
      value: ANIME_ROWS.toLocaleString(), kicker: 'Titles', desc: 'Fetched on demand — a 7.9 MB file.' }),
    tile({ icon: 'film', title: 'Movies', url: 'static://movies', cta: 'Open Movies',
      blurb: 'Films and series with synopses and ratings. Static holds the metadata, never the video.',
      value: String(films), kicker: 'Films & series', desc: 'Playback waits on the Static proxy.' }),
    tile({ icon: 'search', title: 'Search', url: 'static://search', cta: 'Search Static',
      blurb: 'One box over the games, the films, the anime catalogue and the OS itself.',
      valueEl: searchV, kicker: 'Catalogue rows', descEl: searchD })));
  root.appendChild(ways.el);

  /* ---- jump back in ---------------------------------------- */
  const jump = section(api, 'play', 'Jump back in', 'Loading…');
  const jumpRail = h('div.cx__grid.cx__grid--rail');
  jump.body.appendChild(jumpRail);
  root.appendChild(jump.el);

  async function loadGames() {
    render(jumpRail, skeletons(api, 8, false));
    jump.noteEl.textContent = 'Loading…';
    try {
      const res = await providers.listGames({ sort: 'popular' }) || {};
      const items = res.items || [];
      const total = res.total ?? items.length;
      const picks = items.slice(0, 8);
      jump.noteEl.textContent = `${picks.length} of ${total} · most played`;
      if (!picks.length) {
        render(jump.body, h('div.empty', icon('gamepad'),
          h('b', { text: 'No games in the catalogue' }),
          h('small', { text: 'catalog.js has no entries, so there is nothing to rail up here.' })));
        return;
      }
      render(jumpRail, picks.map(g => gameCard(ctx, g)));
    } catch (err) {
      jump.noteEl.textContent = 'unavailable';
      render(jump.body, downBlock(api, providers, err, () => { render(jump.body, jumpRail); loadGames(); }));
    }
  }

  /* ---- top rated anime ------------------------------------- */
  const top = section(api, 'star', 'Top rated anime',
    `${ANIME_ROWS.toLocaleString()} titles in the catalogue`);
  root.appendChild(top.el);

  function paintAnimeRail() {
    const { items, total } = providers.bigCatalogue.query({ kind: 'anime', sort: 'score', perPage: 12 });
    top.noteEl.textContent = `${total.toLocaleString()} titles loaded · top 12 by score`;
    const rail = h('div.cx__grid.cx__grid--rail');
    render(rail, items.map(row => animeCard(ctx, row)));
    render(top.body, rail,
      h('div.row', { style: { marginTop: 'var(--sp-3)' } },
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => navigate('static://anime') },
          h('span', { text: 'Browse all anime' }), icon('chevron-right'))));
    paintSearchStat();
  }

  function paintAnimeGate() {
    const err = h('div', { style: { display: 'none', marginTop: 'var(--sp-4)' } });
    const btn = h('button.btn.btn--primary', { type: 'button' },
      icon('download'), h('span', { text: 'Load the anime catalogue' }));

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.style.opacity = '.75';
      render(btn, h('div.spinner'), h('span', { text: 'Fetching 7.9 MB…' }));
      err.style.display = 'none';
      try {
        await providers.bigCatalogue.load('anime');
        paintAnimeRail();
      } catch (e) {
        btn.disabled = false;
        btn.style.opacity = '';
        render(btn, icon('refresh'), h('span', { text: 'Try the download again' }));
        render(err, downBlock(api, providers, e, null));
        err.style.display = '';
      }
    });

    top.noteEl.textContent = 'not loaded yet';
    render(top.body, h('div.card',
      h('div.card__head', icon('star'), h('div.card__t', { text: 'The catalogue is not loaded' })),
      prose(api, `data/anime.json holds ${ANIME_ROWS.toLocaleString()} titles and weighs 7.9 MB, so `
        + 'Static only fetches it when you ask. Load it once and every anime rail, filter and '
        + 'search on the portal works for the rest of the session.'),
      h('div.row', { style: { marginTop: 'var(--sp-5)' } }, btn,
        h('button.btn.btn--ghost', { type: 'button', onclick: () => navigate('static://anime') },
          h('span', { text: 'Go to the Anime page' }), icon('chevron-right'))),
      err));
  }

  /* ---- footer ---------------------------------------------- */
  const footLink = (ic, title, note, url) => h('button.list__item', {
    type: 'button', onclick: () => navigate(url),
  }, icon(ic), h('div.grow', h('b', { text: title }), h('small', { text: note })),
    icon('chevron-right'));

  root.appendChild(h('div.cx__sec',
    h('div.cx__sec-h', icon('link'), h('div.cx__sec-t', { text: 'The rest of the old site' })),
    h('div.list',
      footLink('shield', 'Proxy',
        `${providers.PROXY_LINKS.length} bookmarks carried over from the old proxy page`,
        'static://proxy'),
      footLink('users', 'Apply',
        `${providers.POSITIONS.reduce((n, p) => n + p.open, 0)} open positions on the Static crew`,
        'static://apply'))));
  root.appendChild(h('div.dim.cx__pad', {
    text: FOOTER_LINE, style: { fontSize: 'var(--fs-10)' },
  }));

  /* async fills — the node above is already on its way back */
  loadGames();
  if (providers.bigCatalogue.isLoaded('anime')) paintAnimeRail(); else paintAnimeGate();

  return root;
}

/* ============================================================
   static://proxy — the old bookmark list, told straight
   ============================================================ */
/**
 * Minimal page lifecycle: collects cleanups, exposes `dead` so async paints can
 * bail, and hangs `cherriTeardown` on the root for the hosts (browser.js /
 * apps/portal.js) to call when the page or window goes away.
 */
/* one glyph per open position (see POSITIONS in catalog.js) */
const ROLE_ICONS = {
  'Game Finder': 'search',
  'Page Builder': 'code',
  'Tester': 'bug',
  'Moderator': 'shield',
};

function lifecycle(root) {
  const fns = [];
  const life = {
    dead: false,
    add(fn) { if (typeof fn === 'function') fns.push(fn); return fn; },
    kill() {
      if (life.dead) return;
      life.dead = true;
      for (const fn of fns.splice(0)) {
        try { fn(); } catch (err) { console.warn('[Static] teardown', err); }
      }
    },
  };
  root.cherriTeardown = life.kill;
  return life;
}

export function buildProxy(ctx) {
  const { api, navigate } = ctx;
  const { h, icon } = api;
  const root = h('div.cx');
  const life = lifecycle(root);
  root.appendChild(topStrip(ctx, 'proxy'));

  /* The worker base is the one thing worth remembering between visits. */
  RD.worker.base = api.store.get('portal.proxyWorker', '') || '';

  const S = {
    engine: PX.engineById(api.store.get('portal.proxyEngine', 'reader')),
    location: PX.byId('4everproxy').defaultLocation,
    target: '',
    history: [],
    abort: null,
  };
  /* "My proxy" with nothing behind it stays selected on purpose: the idle
     screen then leads with the setup card, which is the only way to finish
     setting it up. go() refuses to navigate until a base is saved. */

  const surface = h('div.px');
  root.appendChild(surface);
  paintIdle();
  life.add(() => S.abort?.abort());
  return root;

  /* ---------------- idle: our own search ------------------------- */
  function paintIdle() {
    S.abort?.abort();
    const input = h('input', {
      type: 'text', spellcheck: 'false', autocapitalize: 'none', autocomplete: 'off',
      placeholder: 'Enter a site, or search',
      'aria-label': 'Site or search terms',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(input.value); } },
    });

    const form = h('form.px__form', {
      onsubmit: e => { e.preventDefault(); go(input.value); },
    },
      h('div.field.px__field', icon('search'), input),
      h('button.btn.btn--primary', { type: 'submit' }, icon('arrow-right', { size: 14 }), 'Go'));

    const quick = h('div.px__quick',
      ...['wikipedia.org', 'reddit.com', 'news.ycombinator.com', 'github.com', 'bbc.com']
        .map(host => h('button.chip', {
          type: 'button', onclick: () => go(host),
        }, icon('globe'), h('span', { text: host }))));

    api.render(surface, h('div.px__hero',
      h('div.px__mark', icon(BRAND.icon), h('span', { text: BRAND.wordmark })),
      h('div.px__tag', {
        text: 'One box, four engines. Two of them are Static’s own, so the page opens here — not in a tab.',
      }),
      form,
      quick,
      enginePicker(),
      S.engine.kind === 'worker' ? workerSetup() : null,
      h('div.px__tag', { style: { fontSize: 'var(--fs-10)', marginTop: 'var(--sp-2)' },
        text: engineFootnote() })));

    requestAnimationFrame(() => input.focus());
  }

  function engineFootnote() {
    switch (S.engine.kind) {
      case 'reader':
        return 'Static Reader fetches through a public CORS relay, strips everything executable and '
             + 'repaints the page here. Scripts will not run, so apps and logins need "My proxy".';
      case 'worker':
        return RD.worker.base
          ? `Requests go through your own worker at ${RD.worker.base}. Nothing else sees them.`
          : 'Copy the code, deploy it as a Cloudflare Worker, paste the URL it gives you. '
            + 'After that every request goes through your own proxy — and Roblox player counts go live.';
      case 'text':
        return 'Text mode returns a clean markdown rendering. Lightest option, and it usually works '
             + 'when the relays are rate-limited.';
      case 'frame':
        return 'Static keeps the chrome — 4everproxy only fetches the page.';
      default:
        return 'This service blocks embedding, so Static can only hand it to a real tab.';
    }
  }

  function enginePicker() {
    const wrap = h('div.px__servers');
    for (const en of PX.ENGINES) {
      const on = en.id === S.engine.id;
      const unset = en.kind === 'worker' && !RD.worker.base;
      wrap.appendChild(h('button.px-server', {
        type: 'button',
        'aria-pressed': String(on),
        class: on ? 'is-on' : null,
        onclick: () => {
          S.engine = en;
          api.store.set('portal.proxyEngine', en.id);
          paintIdle();
        },
      },
        h('div.px-server__h',
          icon(en.kind === 'tab' ? 'external-link' : en.kind === 'text' ? 'file-text' : 'monitor'),
          h('b', { text: en.name }),
          h('span.badge', {
            class: unset ? 'badge' : en.tone === 'ok' ? 'badge badge--ok' : 'badge',
            text: unset ? 'needs setup' : en.badge,
          })),
        h('div.px-server__b', { text: en.blurb })));
    }
    return wrap;
  }

  function workerSetup() {
    const field = h('input', {
      type: 'text', spellcheck: 'false', autocapitalize: 'none', autocomplete: 'off',
      placeholder: 'https://aether-proxy.you.workers.dev',
      'aria-label': 'Your proxy worker URL',
      value: RD.worker.base,
    });
    const status = h('small.dim', {
      text: RD.worker.base ? `Saved: ${RD.worker.base}` : 'Not set yet.',
    });
    const save = async () => {
      const base = field.value.trim().replace(/\/+$/, '');
      if (base && !/^https?:\/\//i.test(base)) {
        status.textContent = 'That needs to start with https://';
        return;
      }
      RD.worker.base = base;
      api.store.set('portal.proxyWorker', base);
      if (!base) { status.textContent = 'Cleared.'; return; }
      status.textContent = 'Checking…';
      try {
        const res = await fetch(base, { cache: 'no-store' });
        const body = await res.text();
        status.textContent = body.includes('Static proxy is running')
          ? 'Connected. Your own proxy is live.'
          : `Reachable (HTTP ${res.status}), but that did not look like the Static worker.`;
      } catch (err) {
        status.textContent = `Could not reach it: ${err.message}`;
      }
    };
    /* Static serves its own worker source at worker/aether-proxy.js (mirrored
       from tools/ by bump.mjs), so setting this up is three clicks and a paste
       rather than a hunt through the repo. */
    const copyBtn = h('button.btn', { type: 'button' }, icon('copy', { size: 13 }), 'Copy worker code');
    copyBtn.onclick = async () => {
      const label = copyBtn.querySelector('span') || copyBtn.lastChild;
      try {
        const src = new URL('worker/aether-proxy.js', document.baseURI).href;
        const res = await fetch(src, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await navigator.clipboard.writeText(await res.text());
        status.textContent = 'Worker code copied. Paste it into the Cloudflare editor and hit Deploy.';
      } catch (err) {
        status.textContent = `Could not copy it: ${err.message}. The file is worker/aether-proxy.js.`;
      }
      void label;
    };

    return h('div.card.px__setup',
      h('div.card__head', icon('shield'), h('div.card__t', { text: 'Point Static at your worker' })),
      h('small.dim', {
        text: 'Copy the code below, then: Cloudflare dashboard → Workers & Pages → Create → '
            + 'Worker → paste over the default → Deploy. Copy the URL it gives you and paste it '
            + 'here. The free tier covers 100,000 requests a day, which is far more than one '
            + 'person browsing uses.',
      }),
      h('div.px__setup-row', copyBtn),
      h('div.px__setup-row',
        h('div.field', icon('link'), field),
        h('button.btn.btn--primary', { type: 'button', onclick: save }, 'Save')),
      status);
  }

  /* ---------------- go ------------------------------------------- */
  function go(raw) {
    const url = PX.normaliseTarget(raw);
    if (!url) return;
    S.target = url;
    remember(url);

    switch (S.engine.kind) {
      case 'reader': return paintReader('html');
      case 'text':   return paintReader('text');
      case 'worker':
        if (!RD.worker.base) { paintIdle(); return; }
        return paintBrowse();
      case 'frame':  return paintBrowse();
      default: {
        const sv = PX.byId(S.engine.server);
        PX.submit(sv, url, { target: '_self', location: S.location });
        api.notify({
          app: BRAND.name, icon: 'external-link',
          title: `Opened in a tab via ${sv.name}`,
          message: `${sv.name} blocks embedding, so ${PX.hostOf(url)} could not load inside Static.`,
        });
      }
    }
  }

  function remember(url) {
    S.history = [url, ...S.history.filter(u => u !== url)].slice(0, 12);
  }

  /* ---------------- shared toolbar -------------------------------- */
  function toolbar({ onReload, extra }) {
    const urlIn = h('input', {
      type: 'text', spellcheck: 'false', value: S.target, 'aria-label': 'Address',
      onkeydown: e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        S.target = PX.normaliseTarget(urlIn.value);
        remember(S.target);
        onReload();
      },
    });

    const engSel = h('select.select', {
      'aria-label': 'Proxy engine',
      onchange: e => {
        const next = PX.engineById(e.target.value);
        if (next.kind === 'worker' && !RD.worker.base) { S.engine = next; paintIdle(); return; }
        S.engine = next;
        api.store.set('portal.proxyEngine', next.id);
        go(S.target);
      },
    }, PX.ENGINES.map(en => h('option', {
      value: en.id,
      text: en.kind === 'tab' ? `${en.name} (tab)` : en.name,
      selected: en.id === S.engine.id,
    })));

    return {
      urlIn,
      bar: h('div.px__bar',
        h('button.ibtn.tip', { 'data-tip': 'Back to search', 'aria-label': 'Back to search',
          type: 'button', onclick: paintIdle }, icon('chevron-left')),
        h('button.ibtn.tip', { 'data-tip': 'Reload', 'aria-label': 'Reload',
          type: 'button', onclick: onReload }, icon('refresh')),
        h('div.field', icon('shield'), urlIn),
        engSel,
        extra || null,
        h('button.ibtn.tip', { 'data-tip': 'Close', 'aria-label': 'Close', type: 'button',
          onclick: paintIdle }, icon('x'))),
    };
  }

  /* ---------------- reader: Static's own proxy -------------------- */
  function paintReader(mode) {
    S.abort?.abort();
    const ac = new AbortController();
    S.abort = ac;

    const dot = h('span.px__dot.is-busy');
    const state = h('span', { text: 'fetching…' });
    const relayName = h('span', { text: mode === 'text' ? 'r.jina.ai' : 'choosing a relay…' });
    const page = h('article.px-read');
    const veil = h('div.px__veil',
      h('div.spinner'),
      h('small', { text: `Fetching ${PX.hostOf(S.target)}…` }));

    const { bar, urlIn } = toolbar({ onReload: () => paintReader(mode) });
    const view = h('div.px__view.px__view--read', h('div.px-read__wrap', page), veil);

    api.render(surface, bar, view,
      h('div.px__status', dot, state,
        h('span', { text: '·' }), relayName,
        h('div.grow'),
        h('span', { text: PX.hostOf(S.target) })));

    run();

    async function run() {
      try {
        if (mode === 'text') {
          const text = await RD.fetchText(S.target, { signal: ac.signal });
          if (life.dead || ac.signal.aborted) return;
          api.clear(page);
          page.appendChild(h('pre.px-read__pre', { text }));
          done(`${text.split(/\s+/).length.toLocaleString()} words`);
          return;
        }

        const { html, relay } = await RD.fetchPage(S.target, {
          signal: ac.signal,
          onTry: r => {
            relayName.textContent = r.racing ? `asking ${r.name}…` : `via ${r.name}`;
          },
        });
        if (life.dead || ac.signal.aborted) return;

        const { frag, title } = RD.sanitise(html, S.target, {
          onLink: href => { S.target = href; remember(href); urlIn.value = href; paintReader('html'); },
        });
        api.clear(page);
        page.appendChild(frag);
        relayName.textContent = `via ${relay.name}`;

        const { words, minutes } = RD.readingTime(page);
        if (title) document.title = title;
        done(`${words.toLocaleString()} words · ${minutes} min read`);
        view.scrollTop = 0;
      } catch (err) {
        if (ac.signal.aborted || life.dead) return;

        /* The public relays are best-effort — they rate-limit, and they are
           flaky per-target. r.jina.ai answers far more reliably than any of
           them, so rather than dead-ending on a button the reader falls back
           to it by itself and says that it did. */
        if (mode !== 'text') {
          relayName.textContent = 'relays busy — trying text mode…';
          try {
            const text = await RD.fetchText(S.target, { signal: ac.signal });
            if (life.dead || ac.signal.aborted) return;
            api.clear(page);
            page.appendChild(h('div.px-read__fell',
              icon('info', { size: 13 }),
              h('span', { text: 'The relays were busy, so this is text mode.' })));
            page.appendChild(h('pre.px-read__pre', { text }));
            relayName.textContent = 'via r.jina.ai';
            done(`${text.split(/\s+/).length.toLocaleString()} words`);
            return;
          } catch (err2) {
            if (ac.signal.aborted || life.dead) return;
            err = new Error(`${err.message}\nr.jina.ai: ${err2.message}`);
          }
        }

        veil.remove();
        dot.className = 'px__dot';
        state.textContent = 'could not fetch';
        api.clear(page);
        page.appendChild(h('div.empty',
          icon('alert'),
          h('b', { text: `Could not read ${PX.hostOf(S.target)}` }),
          h('small', { text: String(err.message || err) }),
          h('div', { style: { display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' } },
            h('button.btn', { type: 'button', onclick: () => paintReader(mode === 'text' ? 'html' : 'text') },
              icon('refresh', { size: 13 }), mode === 'text' ? 'Try the reader' : 'Try text mode'),
            h('button.btn.btn--ghost', {
              type: 'button',
              onclick: () => { S.engine = PX.engineById('4everproxy'); paintBrowse(); },
            }, icon('monitor', { size: 13 }), 'Try 4everproxy'))));
      }
    }

    function done(note) {
      veil.remove();
      dot.className = 'px__dot is-live';
      state.textContent = note;
    }
  }

  /* ---------------- framed surface -------------------------------- */
  function paintBrowse() {
    S.abort?.abort();
    const worker = S.engine.kind === 'worker';
    const sv = worker ? null : PX.byId(S.engine.server || '4everproxy');
    const FRAME = 'aether-proxy-view';

    const frame = h('iframe.px__frame', {
      name: FRAME, title: `Proxied view of ${PX.hostOf(S.target)}`,
      referrerpolicy: 'no-referrer',
      allow: 'autoplay; fullscreen; clipboard-write; encrypted-media',
    });

    const locSel = (!worker && sv.locations.length)
      ? h('select.select', {
          'aria-label': 'Exit location',
          onchange: e => { S.location = e.target.value; load(); },
        }, sv.locations.map(l => h('option', {
          value: l.id, text: l.name, selected: l.id === S.location })))
      : null;

    const dot = h('span.px__dot.is-busy');
    const state = h('span', { text: 'connecting…' });
    const label = worker ? 'your proxy' : sv.name;
    const veil = h('div.px__veil',
      h('div.spinner'),
      h('small', { text: `Asking ${label} for ${PX.hostOf(S.target)}…` }));

    frame.addEventListener('load', () => {
      if (life.dead) return;
      veil.remove();
      dot.className = 'px__dot is-live';
      state.textContent = 'connected';
    });

    const { bar, urlIn } = toolbar({ onReload: load, extra: locSel });
    const view = h('div.px__view', frame, veil);

    api.render(surface, bar, view,
      h('div.px__status',
        dot, state,
        h('span', { text: '·' }),
        h('span', { text: `via ${label}` }),
        (!worker && S.location) ? h('span', { text: '·' }) : null,
        (!worker && S.location)
          ? h('span', { text: (sv.locations.find(l => l.id === S.location) || {}).name || S.location })
          : null,
        h('div.grow'),
        h('span', { text: PX.hostOf(S.target) })));

    load();

    function load() {
      if (life.dead) return;
      urlIn.value = S.target;
      dot.className = 'px__dot is-busy';
      state.textContent = 'connecting…';
      if (!veil.isConnected) view.appendChild(veil);
      if (worker) frame.src = `${RD.worker.base.replace(/\/$/, '')}/p/${S.target}`;
      else PX.submit(sv, S.target, { target: FRAME, location: S.location });
    }
  }
}

export function buildApply(ctx) {
  const { api, providers, navigate } = ctx;
  const { h, icon, render, vfs } = api;

  const root = h('div.cx');
  root.appendChild(topStrip(ctx, 'apply'));

  const positions = providers.POSITIONS;
  const openTotal = positions.reduce((n, p) => n + p.open, 0);
  const dir = `${vfs.HOME}/Documents/aether-applications`;

  /* ---- hero ------------------------------------------------ */
  root.appendChild(h('div.cx__hero',
    h('div.cx__hero-art', { style: { '--art': providers.artFor('help run Static', 'game') } }),
    h('div.cx__hero-in',
      h('div.cx__hero-kick', { text: 'JOIN THE TEAM' }),
      h('div.cx__hero-t', { text: 'Help run Static' }),
      h('div.cx__hero-s', {
        text: 'The crew is a handful of people who find sources, build pages, test them on locked-down '
            + 'school hardware and keep the Discord civil. No experience wanted, only follow-through.',
      }),
      h('div.cx__hero-meta',
        h('span.chip.chip--accent', { text: `${openTotal} spots open` }),
        h('span.chip', { text: `${positions.length} roles` }),
        h('span.chip', { text: 'Unpaid, for now' })))));

  /* ---- the form card (declared first — the role cards aim at it) ---- */
  const formCard = h('div.card');
  let roleSel = null;
  let clearRoleHint = () => {};

  /* ---- positions ------------------------------------------- */
  const roles = section(api, 'users', 'Open positions',
    `${openTotal} spots across ${positions.length} roles`);
  roles.body.appendChild(h('div.grid2', positions.map(p => h('div.card.card--hover',
    h('div.card__head', icon(ROLE_ICONS[p.role] || 'users'),
      h('div.card__t', { text: p.role }), h('div.grow'),
      h('span.badge.badge--accent', { text: `${p.open} open` })),
    prose(api, p.need),
    h('div.row', { style: { marginTop: 'var(--sp-5)' } },
      h('button.btn.btn--sm', {
        type: 'button', 'aria-label': `Apply for ${p.role}`, onclick: () => pick(p.role),
      }, icon('edit-3'), h('span', { text: 'Apply' })))))));
  root.appendChild(roles.el);

  const formSec = section(api, 'edit-3', 'Apply', 'Saved to this machine, not sent');
  formSec.body.appendChild(formCard);
  root.appendChild(formSec.el);
  root.appendChild(h('div.cx__pad'));

  /* ---- form ------------------------------------------------ */
  function pick(role) {
    if (!roleSel) paintForm();
    roleSel.value = role;
    clearRoleHint();
    formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    roleSel.focus({ preventScroll: true });
  }

  function labelRow(text, hint) {
    return h('div.row', { style: { marginBottom: 'var(--sp-2)' } },
      h('div.label', { text }), h('div.grow'), hint);
  }

  const optional = () => h('span.dim', { text: 'optional', style: { fontSize: 'var(--fs-10)' } });

  function paintForm(keep) {
    const hintName = h('span.badge.badge--bad', {
      text: 'Tell us who you are', 'aria-live': 'polite', style: { display: 'none' },
    });
    const hintRole = h('span.badge.badge--bad', {
      text: 'Pick a role', 'aria-live': 'polite', style: { display: 'none' },
    });

    const nameIn = h('input', {
      type: 'text', placeholder: 'What people call you', spellcheck: 'false',
      autocomplete: 'off', 'aria-label': 'Your name',
    });
    const nameField = h('div.field', icon('user'), nameIn);

    const discIn = h('input', {
      type: 'text', placeholder: 'handle#0000 or @handle', spellcheck: 'false',
      autocomplete: 'off', 'aria-label': 'Discord handle',
    });
    const discField = h('div.field', icon('message-circle'), discIn);

    roleSel = h('select.select', { 'aria-label': 'Which role', style: { width: '100%', height: '30px' } },
      h('option', { value: '', text: 'Pick a role…' }),
      positions.map(p => h('option', { value: p.role, text: `${p.role} — ${p.open} open` })));
    clearRoleHint = () => {
      roleSel.style.borderColor = '';
      roleSel.removeAttribute('aria-invalid');
      hintRole.style.display = 'none';
    };
    roleSel.addEventListener('change', clearRoleHint);
    nameIn.addEventListener('input', () => {
      nameField.style.borderColor = '';
      nameIn.removeAttribute('aria-invalid');
      hintName.style.display = 'none';
    });

    const why = h('textarea', {
      placeholder: 'What have you built, found or broken? Which device are you on at school?',
      'aria-label': 'Why you',
      style: {
        width: '100%', height: '90px', background: 'var(--bg-2)',
        border: '1px solid var(--line-1)', borderRadius: 'var(--r-sm)',
        padding: 'var(--sp-4)', font: 'inherit', fontSize: 'var(--fs-11)',
        color: 'var(--ink-0)', lineHeight: '1.6', resize: 'vertical',
      },
    });
    why.addEventListener('focus', () => { why.style.borderColor = 'var(--line-accent)'; });
    why.addEventListener('blur', () => { why.style.borderColor = 'var(--line-1)'; });

    if (keep) {
      nameIn.value = keep.name || '';
      discIn.value = keep.discord || '';
      roleSel.value = keep.role || '';
    }

    const submit = h('button.btn.btn--primary', { type: 'submit' },
      icon('check'), h('span', { text: 'Submit application' }));

    const form = h('form', {
      onsubmit: e => {
        e.preventDefault();
        const name = nameIn.value.trim();
        const role = roleSel.value;

        nameField.style.borderColor = name ? '' : 'var(--aether-500)';
        hintName.style.display = name ? 'none' : '';
        roleSel.style.borderColor = role ? '' : 'var(--aether-500)';
        hintRole.style.display = role ? 'none' : '';
        if (name) nameIn.removeAttribute('aria-invalid'); else nameIn.setAttribute('aria-invalid', 'true');
        if (role) roleSel.removeAttribute('aria-invalid'); else roleSel.setAttribute('aria-invalid', 'true');

        if (!name || !role) {
          api.notify({
            app: BRAND.name, icon: 'alert', title: 'Two boxes are required',
            message: 'A name and a role — the rest is optional.',
          });
          (name ? roleSel : nameIn).focus({ preventScroll: true });
          return;
        }

        const discord = discIn.value.trim();
        const now = new Date();
        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`
                    + `${String(now.getDate()).padStart(2, '0')}-`
                    + `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const base = `${stamp}-${slug(role)}-${slug(name)}`;
        const body = [
          'Static — crew application',
          '',
          `Role:     ${role}`,
          `Name:     ${name}`,
          `Discord:  ${discord || '(not given)'}`,
          `Written:  ${now.toLocaleString()}`,
          '',
          'Why me',
          '------',
          why.value.trim() || '(left blank)',
          '',
          'Saved locally by static://apply. Static has no backend, so this file is the',
          'whole application — nothing left this machine.',
          '',
        ].join('\n');

        vfs.mkdir(`${vfs.HOME}/Documents`);
        vfs.mkdir(dir);
        /* vfs.touch() hands back the existing file rather than overwriting it, so
           two applications sent inside the same minute need distinct names. */
        let path = `${dir}/${base}.txt`;
        for (let i = 2; vfs.node(path); i++) path = `${dir}/${base}-${i}.txt`;
        const node = vfs.touch(path, body);
        if (!node) {
          api.notify({
            app: BRAND.name, icon: 'alert', title: 'Could not write the file',
            message: `${dir} is not writable in this session.`,
          });
          return;
        }
        api.notify({
          app: BRAND.name, icon: 'check-circle', title: 'Application saved locally',
          message: path,
          actions: [{ label: 'Open in Files', onClick: () => api.openApp('files', { path: dir }) }],
        });
        paintDone(path, { name, discord, role });
      },
    },
      h('div.grid2',
        h('div', labelRow('Your name', hintName), nameField),
        h('div', labelRow('Discord handle', optional()), discField)),
      h('div', { style: { marginTop: 'var(--sp-5)' } }, labelRow('Which role', hintRole), roleSel),
      h('div', { style: { marginTop: 'var(--sp-5)' } }, labelRow('Why you', optional()), why),
      h('div.row', { style: { marginTop: 'var(--sp-5)' } }, submit,
        h('span.dim', { text: `Writes to ${dir}`, style: { fontSize: 'var(--fs-10)' } })),
      h('div', { style: { marginTop: 'var(--sp-3)' } },
        prose(api, 'Nothing is sent anywhere. There is no backend behind Static yet, so submitting '
          + 'writes a text file into your Documents folder and stops there — send it on yourself '
          + 'if you want it read.')));

    render(formCard,
      h('div.card__head', icon('edit-3'), h('div.card__t', { text: 'Send in an application' }),
        h('div.grow'), h('span.badge', { text: 'Local only' })),
      form);
  }

  function paintDone(path, filled) {
    roleSel = null;
    clearRoleHint = () => {};
    render(formCard, h('div.empty',
      icon('check-circle'),
      h('b', { text: 'Application saved' }),
      h('small.mono', { text: path, style: { color: 'var(--ink-2)', wordBreak: 'break-all' } }),
      h('small', { text: `${filled.role} — stored on this machine only. Nothing was uploaded.` }),
      h('div.row', { style: { flexWrap: 'wrap', justifyContent: 'center' } },
        h('button.btn.btn--primary', {
          type: 'button', onclick: () => api.openApp('files', { path: dir }),
        }, icon('folder-open'), h('span', { text: 'Open in Files' })),
        h('button.btn', { type: 'button', onclick: () => paintForm({ name: filled.name, discord: filled.discord }) },
          icon('plus'), h('span', { text: 'Apply for another' })),
        h('button.btn.btn--ghost', { type: 'button', onclick: () => navigate('static://arcade') },
          h('span', { text: 'Back to the arcade' }), icon('chevron-right')))));
  }

  paintForm();
  return root;
}

export default { buildArcadeHub, buildProxy, buildApply };
