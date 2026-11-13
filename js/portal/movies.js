/* ============================================================
   movies.js — the Movies tab of Static.

   Two pages:
     buildMovies(ctx)       the catalogue (hero + rails / grid)
     buildMovieDetail(ctx)  one title (detail + watch stage)

   Movies are METADATA ONLY. Static hosts nothing: every title
   ends at providers.resolve('movie:<id>'), which answers
   {kind:'unavailable', reason} until a proxy is wired up. The
   pages say so plainly — once resolve() starts answering
   {kind:'embed', url} the same stage plays it with no change
   here.

   Both builders return their root node synchronously and paint
   into it when the provider settles, so navigation never waits.
   ============================================================ */

import { BRAND } from './brand.js';

/**
 * Open a real background tab. Passing a features string (even just 'noopener')
 * makes the browser treat this as a popup-window request, so the link opens in
 * a chrome-less window instead of a tab; clearing `opener` by hand gives the
 * same protection without that side effect.
 */
/* ------------------------------------------------------------------ *
 *  shared chrome — every Static page wears the same top strip
 * ------------------------------------------------------------------ */
const NAV = [
  ['Home',   'static://home',   'home'],
  ['Games',  'static://games',  'gamepad'],
  ['Movies', 'static://movies', 'film'],
  ['Anime',  'static://anime',  'star'],
  ['Search', 'static://search', 'search'],
];

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
      if (!q) { input.focus(); return; }
      navigate(`static://search?q=${encodeURIComponent(q)}`);
    },
  }, icon('search'), input);

  const nav = h('div.cx__nav', NAV.map(([label, url, ic]) => {
    const b = h('button', { type: 'button', onclick: () => navigate(url) },
      icon(ic), h('span', { text: label }));
    if (label.toLowerCase() === current) {
      b.classList.add('is-on');
      b.setAttribute('aria-current', 'page');
    }
    return b;
  }));

  return h('div.cx__top',
    h('div.cx__mark', icon(BRAND.icon), h('span', { text: BRAND.wordmark })),
    form, nav);
}

/* ------------------------------------------------------------------ *
 *  formatters
 * ------------------------------------------------------------------ */
/** 166 -> "2h 46m", 44 -> "44m", 120 -> "2h". */
function fmtRuntime(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  if (!m) return '—';
  const hrs = Math.floor(m / 60);
  const rest = m % 60;
  if (!hrs) return `${rest}m`;
  return rest ? `${hrs}h ${rest}m` : `${hrs}h`;
}

/** The catalogue stores episode length for series, so short == series. */
const isSeries = m => Number(m.runtime) > 0 && Number(m.runtime) < 70;
const rateText = r => (Number(r) || 0).toFixed(1);
const genresOf = m => (m && m.genres) || [];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Trending" is rating order with trending titles lifted to the front —
    the provider has no play counts for movies, so the view does the lift. */
function ordered(items, sort) {
  if (sort !== 'popular') return items;
  const hot = [], rest = [];
  for (const it of items) ((it.cats || []).includes('trending') ? hot : rest).push(it);
  return hot.concat(rest);
}

/* ------------------------------------------------------------------ *
 *  watchlist — one list in api.store, shared with the Anime tab
 *
 *  THE SHAPE IS A CONTRACT. anime.js writes plain "kind:id" strings
 *  under this same key and its reader drops everything that is not a
 *  string, so an object row written here is deleted by the next anime
 *  toggle. Movies therefore write the same kind of token, "movie:<id>" —
 *  which is also what providers.resolve() takes. Reading stays tolerant:
 *  a token, a bare legacy id, or an object row written by an older build
 *  all still count as saved, and a movie row found in the old shape is
 *  folded back to a token on the next toggle so it survives too.
 * ------------------------------------------------------------------ */
/* `portal` is in store.js's PERSIST list; `Static` was not, so a saved
   title was silently lost on the next reload. */
const WATCHLIST = 'portal.watchlist';
const movieUrl = id => `static://movies/${id}`;
const movieToken = id => `movie:${id}`;

function wlRead(store) {
  const v = store.get(WATCHLIST, []);
  return Array.isArray(v) ? v : [];
}
const isRow = (row, id) => !!row && (
  row === movieToken(id) || row === id
  || (typeof row === 'object'
    && (row.url === movieUrl(id) || (row.id === id && row.kind === 'movie'))));
const wlHas = (store, id) => wlRead(store).some(row => isRow(row, id));

/** An old-shape movie row becomes the token anime.js will not throw away. */
const wlNorm = row => (row && typeof row === 'object' && row.kind === 'movie' && row.id)
  ? movieToken(row.id) : row;

/** Returns true when the title was added, false when it was removed. */
function wlToggle(store, m) {
  const list = wlRead(store).map(wlNorm);
  const kept = list.filter(row => !isRow(row, m.id));
  if (kept.length !== list.length) { store.set(WATCHLIST, kept); return false; }
  store.set(WATCHLIST, [...kept, movieToken(m.id)]);
  return true;
}

function wlNotify(api, m, added) {
  api.notify({
    app: BRAND.name, icon: 'bookmark',
    title: added ? 'Added to Watchlist' : 'Removed from Watchlist',
    message: `${m.title} · ${plural(wlRead(api.store).length, 'title')} saved`,
  });
}

/* ------------------------------------------------------------------ *
 *  page lifecycle — the router just clears its view node, so a page
 *  watches for its own removal and runs its cleanups then. Same shape
 *  as the Games page, so every portal page behaves alike.
 * ------------------------------------------------------------------ */
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
  /* Not-yet-attached is not dead: build() hands the node back before the
     router appends it, so async work must still be allowed to land. */
  const dead = () => {
    if (done) return true;
    if (root.isConnected) { attached = true; return false; }
    return attached;
  };
  let tries = 0;
  const watch = () => {
    if (done) return;
    const parent = root.parentNode;
    if (!parent) { if (++tries < 240) requestAnimationFrame(watch); return; }
    const obs = new MutationObserver(() => { if (!root.isConnected) { obs.disconnect(); run(); } });
    obs.observe(parent, { childList: true });
    fns.push(() => obs.disconnect());
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(watch);
  root.cherriTeardown = run;
  return { add: fn => { if (done) fn(); else fns.push(fn); }, run, get dead() { return dead(); } };
}

/**
 * Own the window subtitle. The Browser repaints its chrome a beat after
 * every navigation and blanks the subtitle for in-OS urls, so claim the
 * line back whenever wm says the title changed.
 */
function claimSubtitle(ctx, life, text) {
  const { api, win } = ctx;
  if (!win || typeof win.setSubtitle !== 'function') return;
  const set = () => { if (!life.dead) win.setSubtitle(text); };
  set();
  if (!api.bus || typeof api.bus.on !== 'function') return;
  life.add(api.bus.on('win:title', w => {
    if (life.dead || (w && w !== win && w.el !== win.el)) return;
    requestAnimationFrame(set);
  }));
}

/** The nearest ancestor that scrolls — the page lives in the Browser's view. */
function scrollParent(el) {
  if (typeof getComputedStyle !== 'function') return null;
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
    p = p.parentElement;
  }
  return null;
}

/**
 * Give the filter bar a backdrop once it sticks under the top strip.
 * Same helper as the Games page: the observer MUST use the scrolling
 * ancestor as its root, because the page sits inside a window and the
 * viewport's top edge is nowhere near the bar's. Deferred until the bar is
 * attached, since neither the scroll parent nor the strip height is
 * measurable while build() still holds the node.
 */
function watchStuck(bar, sentinel, strip) {
  let io = null, stopped = false, tries = 0;
  const start = () => {
    if (stopped || io) return;
    if (!bar.isConnected) { if (++tries < 240) requestAnimationFrame(start); return; }
    /* the strip and the bar are both sticky at top:0 — park the bar under it,
       or it slides behind the strip and the backdrop is never seen */
    const strut = (strip && strip.offsetHeight) || 0;
    if (strut > 0) bar.style.top = `${strut}px`;
    if (typeof IntersectionObserver !== 'function') return;
    const root = scrollParent(bar);
    if (!root) return;
    try {
      io = new IntersectionObserver(entries => {
        for (const e of entries) {
          const rb = e.rootBounds;
          bar.classList.toggle('cx__bar--stuck',
            !e.isIntersecting && (!rb || e.boundingClientRect.top < rb.top + 1));
        }
      }, { root, threshold: 0 });
      io.observe(sentinel);
    } catch (err) { io = null; }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(start);
  return () => { stopped = true; if (io) io.disconnect(); };
}

/* ------------------------------------------------------------------ *
 *  small shared paint helpers
 * ------------------------------------------------------------------ */
/* `.cx-stage__note .icon`, `.cx-down .icon` and `.empty .icon` are big by
   design, and they out-specify `.btn .icon`. Button glyphs therefore carry
   their own size so they stay 14px wherever they land. */
const bIcon = (api, name, fill) => api.icon(name, { size: 14, fill: !!fill });

async function copyLink(api, link) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('unsupported');
    await navigator.clipboard.writeText(link);
    api.notify({ app: BRAND.name, icon: 'copy', title: 'Link copied', message: link });
  } catch (e) {
    api.notify({ app: BRAND.name, icon: 'alert', title: 'Could not copy that', message: link });
  }
}

function isProviderError(providers, err) {
  return !!err && (err.name === 'ProviderError'
    || (providers.ProviderError && err instanceof providers.ProviderError));
}

/** The .cx-down block: what broke, why, and one way out. */
function downBlock(ctx, err, retry) {
  const { api, providers } = ctx;
  const { h } = api;
  const known = isProviderError(providers, err);
  if (!known) console.error('[Static/movies]', err);
  return h('div.cx-down', api.icon('alert'),
    h('div.grow',
      h('b', { text: known ? 'The movie catalogue did not answer' : 'Something went wrong loading movies' }),
      h('small', { text: known
        ? `${err.message} Static is in "${providers.config.mode}" mode${err.code ? ` (${err.code})` : ''}.`
        : 'An unexpected error stopped this page. The console has the details.' }),
      h('div', { style: { marginTop: 'var(--sp-4)' } },
        h('button.btn.btn--sm', { type: 'button', onclick: retry },
          bIcon(api, 'refresh'), 'Retry'))));
}

function posterSkel(api, n) {
  const { h } = api;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(h('div', { 'aria-hidden': 'true' },
      h('div.cx-skel.cx-skel--poster'),
      h('div.cx-skel.cx-skel--line'),
      h('div.cx-skel.cx-skel--line', { style: { width: '58%' } })));
  }
  return out;
}

function heroSkel(api) {
  const { h } = api;
  return h('div.cx__hero', { 'aria-hidden': 'true' },
    h('div.cx__hero-art'),
    h('div.cx__hero-in',
      h('div.cx-skel.cx-skel--line', { style: { width: '92px', height: '8px', marginTop: '0' } }),
      h('div.cx-skel.cx-skel--line', { style: { width: '280px', height: '24px' } }),
      h('div.cx-skel.cx-skel--line', { style: { width: '400px' } }),
      h('div.cx-skel.cx-skel--line', { style: { width: '220px' } })));
}

function sectionHead(api, title, ic, count, extra) {
  const { h } = api;
  return h('div.cx__sec-h', api.icon(ic),
    h('div.cx__sec-t', { text: title }),
    count ? h('div.cx__sec-n', { text: count }) : null,
    extra ? h('div.grow') : null, extra || null);
}

/** A titled horizontal rail. The stylesheet hides rail scrollbars, so the
    section head carries its own nudge buttons — revealed only once the rail
    actually overflows, so they are never dead. */
function railSection(ctx, { title, ic, count, cards, extra }) {
  const { api } = ctx;
  const { h, icon } = api;
  const rail = h('div.cx__grid.cx__grid--rail', cards);

  const nudge = dir => {
    const step = Math.max(240, (rail.clientWidth || 640) * 0.8) * dir;
    if (typeof rail.scrollBy === 'function') rail.scrollBy({ left: step, behavior: 'smooth' });
    else rail.scrollLeft = (rail.scrollLeft || 0) + step;
  };
  const arrows = h('div.row.hidden',
    h('button.ibtn.tip', { type: 'button', 'data-tip': 'Back',
      'aria-label': `Scroll ${title} back`, onclick: () => nudge(-1) },
      icon('chevron-left', { size: 15 })),
    h('button.ibtn.tip', { type: 'button', 'data-tip': 'Forward',
      'aria-label': `Scroll ${title} forward`, onclick: () => nudge(1) },
      icon('chevron-right', { size: 15 })));
  try {
    requestAnimationFrame(() => {
      if ((rail.scrollWidth || 0) > (rail.clientWidth || 0) + 8) arrows.classList.remove('hidden');
    });
  } catch (e) { /* no rAF: the rail still scrolls by touch and wheel */ }

  return h('div.cx__sec',
    sectionHead(api, title, ic, count, extra ? h('div.row', arrows, extra) : arrows),
    rail);
}

/* ------------------------------------------------------------------ *
 *  the poster card — the only card shape the Movies tab uses
 * ------------------------------------------------------------------ */
function posterCard(ctx, m) {
  const { api, providers, navigate } = ctx;
  const { h, icon } = api;

  const tag = h('div.cx-card__tag', icon('star', { fill: true }),
    h('span', { text: rateText(m.rating) }));
  if ((m.cats || []).includes('trending')) tag.classList.add('cx-card__tag--hot');

  const art = h('div.cx-card__art', { style: { '--art': providers.artFor(m.title, 'movie') } },
    tag,
    h('div.cx-card__mono', { text: m.title }),
    h('div.cx-card__play', { 'aria-hidden': 'true' }, h('i', icon('play', { fill: true }))));

  const g = genresOf(m);
  return h('button.cx-card.cx-card--poster', {
    type: 'button',
    'aria-label': `${m.title}, ${m.year}, ${g.join(' and ') || 'film'}, rated ${rateText(m.rating)} out of 10`,
    onclick: () => navigate(`static://movies/${m.id}`),
    oncontextmenu: e => { e.preventDefault(); cardMenu(ctx, m, e); },
  }, art,
    h('div.cx-card__b',
      h('div.cx-card__t', { text: m.title }),
      h('div.cx-card__m', icon(isSeries(m) ? 'layers' : 'film'),
        h('span', { text: `${m.year} · ${g[0] || 'Film'}` }))));
}

function cardMenu(ctx, m, e) {
  const { api, navigate } = ctx;
  const saved = wlHas(api.store, m.id);
  api.menu([
    { label: 'Open', icon: 'film', onClick: () => navigate(`static://movies/${m.id}`) },
    { label: 'Watch', icon: 'play', onClick: () => navigate(`static://movies/${m.id}#watch`) },
    '-',
    { label: saved ? 'Remove from Watchlist' : 'Add to Watchlist', icon: saved ? 'check' : 'plus',
      onClick: () => wlNotify(api, m, wlToggle(api.store, m)) },
    { label: 'Copy link', icon: 'copy', onClick: () => copyLink(api, `static://movies/${m.id}`) },
    '-',
    { label: `Search for “${m.title}”`, icon: 'search',
      onClick: () => navigate(`static://search?q=${encodeURIComponent(m.title)}`) },
  ], e.clientX, e.clientY);
}

/* ================================================================== *
 *  buildMovies — the catalogue
 * ================================================================== */
const RAILS = [
  { id: 'trending',  name: 'Trending',  icon: 'trending-up' },
  { id: 'movies',    name: 'Movies',    icon: 'film' },
  { id: 'series',    name: 'Series',    icon: 'layers' },
  { id: 'scifi',     name: 'Sci-Fi',    icon: 'sparkles' },
  { id: 'animation', name: 'Animation', icon: 'palette' },
];

const REL_TITLE = 'You might also like';

const SORTS = [
  ['popular', 'Trending'],
  ['rating',  'Top rated'],
  ['newest',  'Newest'],
  ['az',      'A–Z'],
];

export function buildMovies(ctx) {
  const { api, providers, navigate } = ctx;
  const { h, icon, fmt } = api;

  const S = { cat: 'all', q: '', sort: 'popular' };
  let tick = 0;

  const root = h('div.cx');
  const life = lifecycle(root);
  const strip = topStrip(ctx, 'movies');
  root.appendChild(strip);
  claimSubtitle(ctx, life, `${plural(providers.MOVIES.length, 'title')} · catalogue only`);

  /* ---- hero: its own provider call, so a slow list never holds it ---- */
  const heroSlot = h('div', heroSkel(api));
  root.appendChild(heroSlot);

  /* ---- filter bar ---------------------------------------------------- */
  const catBtns = new Map();
  const cats = h('div.cx__cats', { role: 'group', 'aria-label': 'Movie categories' });
  for (const c of providers.MOVIE_CATEGORIES) {
    const b = h('button.cx-cat', {
      type: 'button', 'aria-pressed': c.id === S.cat ? 'true' : 'false',
      onclick: () => setCat(c.id),
    }, icon(c.icon), h('span', { text: c.name }));
    if (c.id === S.cat) b.classList.add('is-on');
    catBtns.set(c.id, b);
    cats.appendChild(b);
  }
  cats.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const list = [...cats.querySelectorAll('button')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus();
  });

  const commit = fmt.debounce(() => {
    const v = filterIn.value.trim();
    if (v === S.q) return;
    S.q = v;
    refresh();
  }, 160);
  const filterIn = h('input', {
    type: 'search', placeholder: 'Filter titles…', spellcheck: 'false',
    'aria-label': 'Filter the movie catalogue',
    oninput: commit,
    onkeydown: e => {
      if (e.key !== 'Escape' || !filterIn.value) return;
      e.stopPropagation();
      filterIn.value = '';
      S.q = '';
      refresh();
    },
  });
  const filterBox = h('form.field', {
    style: { flex: '0 0 auto', width: '168px', height: '26px' },
    onsubmit: e => { e.preventDefault(); S.q = filterIn.value.trim(); refresh(); },
  }, icon('filter'), filterIn);

  const sortSel = h('select.select', {
    'aria-label': 'Sort the movie catalogue',
    onchange: () => { S.sort = sortSel.value; refresh(); },
  }, SORTS.map(([v, label]) => h('option', { value: v }, label)));
  sortSel.value = S.sort;

  const bar = h('div.cx__bar', cats, filterBox, sortSel);
  const sentinel = h('div', { 'aria-hidden': 'true', style: { height: '1px' } });
  root.appendChild(sentinel);
  root.appendChild(bar);
  life.add(watchStuck(bar, sentinel, strip));

  const body = h('div');
  root.appendChild(body);

  loadHero();
  refresh();
  return root;

  /* ---- behaviour ----------------------------------------------------- */
  function setCat(id) {
    if (S.cat === id) return;
    S.cat = id;
    for (const [key, b] of catBtns) {
      b.classList.toggle('is-on', key === id);
      b.setAttribute('aria-pressed', key === id ? 'true' : 'false');
    }
    refresh();
  }

  function clearFilters() {
    filterIn.value = '';
    S.q = '';
    if (S.cat !== 'all') { setCat('all'); return; }   /* setCat refreshes */
    refresh();
  }

  /* declared as functions, not consts: everything below the `return root`
     above is hoisted, and refresh() runs before we get here. */
  function railMode() { return S.cat === 'all' && !S.q; }
  function catOf(id) { return providers.MOVIE_CATEGORIES.find(c => c.id === id) || {}; }
  function catName(id) { return catOf(id).name || 'Movies'; }
  function catIcon(id) { return catOf(id).icon || 'film'; }

  async function loadHero() {
    try {
      const { items } = await providers.listMovies({ category: 'trending', sort: 'popular' });
      if (life.dead) return;
      const top = ordered(items, 'popular')[0];
      if (!top) { api.clear(heroSlot); return; }
      paintHero(top);
    } catch (err) {
      if (life.dead) return;
      /* the grid below carries the error state — don't shout twice */
      api.clear(heroSlot);
    }
  }

  function paintHero(m) {
    api.render(heroSlot,
      h('div.cx__hero', { style: { '--art': providers.artFor(m.title, 'movie') } },
        h('div.cx__hero-art', { 'aria-hidden': 'true' }),
        h('div.cx__hero-in',
          h('div.cx__hero-kick', { text: 'TRENDING NOW' }),
          h('h2.cx__hero-t', { text: m.title }),
          h('p.cx__hero-s', { text: m.synopsis }),
          h('div.cx__hero-meta',
            h('span.chip', icon('calendar'), h('span', { text: String(m.year) })),
            h('span.chip', icon('clock'), h('span', {
              text: fmtRuntime(m.runtime) + (isSeries(m) ? ' / ep' : '') })),
            h('span.chip.chip--accent', icon('star', { fill: true }),
              h('span', { text: `${rateText(m.rating)} / 10` })),
            genresOf(m).map(g => h('span.chip', { text: g }))),
          h('div.cx__hero-acts',
            h('button.btn.btn--primary', { type: 'button',
              onclick: () => navigate(`static://movies/${m.id}#watch`) },
              bIcon(api, 'play', true), 'Watch'),
            h('button.btn', { type: 'button',
              onclick: () => navigate(`static://movies/${m.id}`) },
              bIcon(api, 'info'), 'More info')))));
  }

  async function refresh() {
    /* fmt.debounce hands back no cancel handle, so the filter's 160ms timer
       can still land after the page is gone. Nothing below it is useful then. */
    if (life.dead) return;
    const token = ++tick;
    api.render(body, railMode() ? railsSkeleton() : gridSkeleton());
    try {
      if (railMode()) {
        const sets = await Promise.all(RAILS.map(r =>
          providers.listMovies({ category: r.id, sort: S.sort })));
        if (token !== tick || life.dead) return;
        paintRails(sets);
      } else {
        const res = await providers.listMovies({ category: S.cat, q: S.q, sort: S.sort });
        if (token !== tick || life.dead) return;
        paintGrid(res);
      }
    } catch (err) {
      if (token !== tick || life.dead) return;
      api.render(body, downBlock(ctx, err, refresh));
    }
  }

  function railsSkeleton() {
    return RAILS.slice(0, 3).map(r => h('div.cx__sec',
      sectionHead(api, r.name, r.icon, 'loading…'),
      h('div.cx__grid.cx__grid--rail', posterSkel(api, 7))));
  }

  function gridSkeleton() {
    return h('div.cx__sec',
      sectionHead(api, S.q ? `Searching “${S.q}”` : catName(S.cat), catIcon(S.cat), 'loading…'),
      h('div.cx__grid.cx__grid--poster', posterSkel(api, 12)));
  }

  function paintRails(sets) {
    const nodes = [];
    sets.forEach((res, i) => {
      const rail = RAILS[i];
      const items = ordered(res.items || [], S.sort);
      if (!items.length) return;
      const shown = items.slice(0, 12);
      const total = res.total || items.length;
      const seeAll = h('button.btn.btn--sm.btn--ghost', {
        type: 'button', onclick: () => setCat(rail.id),
      }, total > shown.length ? `All ${total}` : 'See all', bIcon(api, 'chevron-right'));
      nodes.push(railSection(ctx, {
        title: rail.name, ic: rail.icon, count: plural(total, 'title'),
        cards: shown.map(m => posterCard(ctx, m)), extra: seeAll,
      }));
    });
    if (!nodes.length) {
      api.render(body, emptyBlock('The catalogue came back empty',
        'The provider answered, but it has no titles on file right now.'));
      return;
    }
    nodes.push(footNote());
    api.render(body, nodes);
  }

  function paintGrid(res) {
    const items = ordered(res.items || [], S.sort);
    const label = S.q ? `“${S.q}”` : catName(S.cat);
    const clear = (S.q || S.cat !== 'all')
      ? h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: clearFilters },
        bIcon(api, 'x'), 'Clear')
      : null;

    if (!items.length) {
      api.render(body, h('div.cx__sec',
        sectionHead(api, label, S.q ? 'search' : catIcon(S.cat), 'no matches', clear)),
        emptyBlock(`Nothing here matches ${label}`,
          S.q ? `No title in the catalogue has “${S.q}” in its name or genre. Try a shorter word, or search the web for it.`
              : 'This category has no titles yet.',
          S.q ? h('button.btn.btn--primary', { type: 'button',
            onclick: () => navigate(`static://search?q=${encodeURIComponent(S.q)}`) },
            bIcon(api, 'search'), 'Search the web') : null));
      return;
    }

    api.render(body, h('div.cx__sec',
      sectionHead(api, label, S.q ? 'search' : catIcon(S.cat), plural(items.length, 'title'), clear),
      h('div.cx__grid.cx__grid--poster', items.map(m => posterCard(ctx, m)))),
      footNote());
  }

  function emptyBlock(title, note, action) {
    return h('div.empty', icon('film'),
      h('b', { text: title }),
      h('small', { text: note }),
      action || h('button.btn', { type: 'button', onclick: clearFilters },
        bIcon(api, 'grid-9'), 'Show everything'));
  }

  /* One honest line at the bottom of the page, every time. */
  function footNote() {
    return h('div.cx__sec', { style: { paddingBottom: 'var(--sp-7)' } },
      h('div.row',
        icon('info', { size: 13 }),
        h('span.dim', { style: { fontSize: 'var(--fs-10)' },
          text: `Static lists ${plural(providers.MOVIES.length, 'title')} and hosts none of them — playback waits on a source.` }),
        h('div.grow'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button',
          onclick: () => navigate('static://proxy') },
          bIcon(api, 'shield'), 'Proxy links')));
  }
}

/* ================================================================== *
 *  buildMovieDetail — one title
 * ================================================================== */
export function buildMovieDetail(ctx) {
  const { api, providers, navigate, params, url, win } = ctx;
  const { h, icon, store } = api;

  const wantWatch = /#watch$/.test(String(url || ''));
  const root = h('div.cx');
  const life = lifecycle(root);
  root.appendChild(topStrip(ctx, 'movies'));
  const body = h('div');
  root.appendChild(body);

  load();                 /* paints its skeleton synchronously, then fills in */
  return root;

  /* ---- load ---------------------------------------------------------- */
  async function load() {
    api.render(body, detailSkeleton());
    let m = null;
    try {
      m = await providers.getMovie(params);
    } catch (err) {
      if (life.dead) return;
      api.render(body, downBlock(ctx, err, load));
      return;
    }
    if (life.dead) return;
    if (!m) { api.render(body, notFound()); return; }
    paint(m);
  }

  function detailSkeleton() {
    return h('div.cx-detail', { 'aria-hidden': 'true' },
      h('div.cx-skel.cx-skel--poster', { style: { flex: '0 0 168px' } }),
      h('div.cx-detail__in',
        h('div.cx-skel.cx-skel--line', { style: { width: '320px', height: '26px', marginTop: '0' } }),
        h('div.cx-skel.cx-skel--line', { style: { width: '240px', height: '14px' } }),
        h('div.cx-skel.cx-skel--line'),
        h('div.cx-skel.cx-skel--line'),
        h('div.cx-skel.cx-skel--line', { style: { width: '72%' } })));
  }

  function notFound() {
    const guess = String(params || '').replace(/-/g, ' ').trim();
    return h('div.empty', icon('film'),
      h('b', { text: 'That title is not in this catalogue' }),
      h('small', { text: `Static has no record with the id “${params}”. It may live in a different catalogue, or the link is older than this build.` }),
      h('div.row',
        h('button.btn.btn--primary', { type: 'button', onclick: () => navigate('static://movies') },
          bIcon(api, 'film'), 'Browse movies'),
        guess ? h('button.btn', { type: 'button',
          onclick: () => navigate(`static://search?q=${encodeURIComponent(guess)}`) },
          bIcon(api, 'search'), `Search for “${guess}”`) : null));
  }

  /* ---- paint --------------------------------------------------------- */
  function paint(m) {
    const art = providers.artFor(m.title, 'movie');
    const link = `static://movies/${m.id}`;
    const series = isSeries(m);
    const g = genresOf(m);

    /* --- stars: 5 marks for a /10 score --- */
    const filled = Math.round((Number(m.rating) || 0) / 2);
    const stars = h('span.stars', { 'aria-hidden': 'true' });
    for (let i = 0; i < 5; i++) stars.appendChild(icon('star', { fill: i < filled }));

    /* --- watchlist button, reflects + toggles --- */
    const wlBtn = h('button.btn.tip', {
      type: 'button',
      onclick: () => { wlNotify(api, m, wlToggle(store, m)); paintWl(); },
    });
    paintWl();
    function paintWl() {
      const on = wlHas(store, m.id);
      api.render(wlBtn, bIcon(api, on ? 'check' : 'plus'), on ? 'In Watchlist' : 'Add to Watchlist');
      wlBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      wlBtn.dataset.tip = on
        ? 'Remove this from your watchlist'
        : `Keep ${m.title} on your list`;
    }

    /* --- the Status fact updates when resolve() answers --- */
    const statusV = h('div.stat__v', { text: '…' });
    const statusD = h('div.stat__d', { text: 'asking the provider' });
    const setStatus = (v, d) => { statusV.textContent = v; statusD.textContent = d; };

    const stat = (value, key, note) => h('div.stat',
      h('div.stat__v', { text: value }),
      h('div.stat__k', { text: key }),
      h('div.stat__d', { text: note }));

    const facts = h('div.cx-detail__facts',
      h('div.stat',
        h('div.stat__v', { text: rateText(m.rating) }),
        h('div.stat__k', { text: 'Rating' }),
        h('div.stat__d', stars)),
      stat(String(m.year), 'Year', series ? 'first aired' : 'released'),
      stat(fmtRuntime(m.runtime), 'Runtime', series ? 'per episode' : `${m.runtime} minutes`),
      stat(String(g.length), 'Genres', g.join(' · ') || 'unclassified'),
      h('div.stat', statusV, h('div.stat__k', { text: 'Status' }), statusD));

    const detail = h('div.cx-detail',
      h('div.cx-detail__art', { 'aria-hidden': 'true', style: { '--art': art } }),
      h('div.cx-detail__in',
        h('h1.cx-detail__t', { text: m.title }),
        h('div.cx-detail__meta',
          h('span.chip', icon('calendar'), h('span', { text: String(m.year) })),
          h('span.chip', icon('clock'), h('span', { text: fmtRuntime(m.runtime) })),
          h('span.badge.badge--accent',
            icon('star', { fill: true, size: 10 }),
            h('span', { text: `${rateText(m.rating)} / 10` })),
          g.map(x => h('span.chip', { text: x })),
          series ? h('span.badge', icon('layers', { size: 10 }), h('span', { text: 'Series' })) : null),
        h('p.cx-detail__syn', { text: m.synopsis }),
        h('div.cx-detail__acts',
          h('button.btn.btn--primary', { type: 'button', onclick: () => toStage(true) },
            bIcon(api, 'play', true), 'Watch'),
          h('button.btn.tip', {
            type: 'button',
            'data-tip': 'Static has no trailer on file — look for one',
            onclick: () => navigate(`static://search?q=${encodeURIComponent(`${m.title} ${m.year} trailer`)}`),
          }, bIcon(api, 'video'), 'Trailer'),
          wlBtn,
          h('button.btn.tip', { type: 'button', 'data-tip': link,
            onclick: () => copyLink(api, link) }, bIcon(api, 'copy'), 'Copy link')),
        facts));

    claimSubtitle(ctx, life, [m.year, g[0], fmtRuntime(m.runtime)].filter(Boolean).join(' · '));

    /* --- the watch stage --- */
    const stageStatus = h('span.badge.badge--warn', { text: 'Checking source' });
    const stageBox = h('div.cx-stage__box', { style: { '--art': art } });
    const stageBar = h('div.cx-stage__bar');
    const stageTop = h('div.cx-stage__top',
      h('button.ibtn.tip', {
        type: 'button', 'data-tip': 'Back to movies', 'aria-label': 'Back to movies',
        onclick: () => navigate('static://movies'),
      }, icon('chevron-left')),
      h('div.cx-stage__t', { text: `Watch · ${m.title}` }),
      h('div.grow'),
      stageStatus,
      (win && typeof win.toggleMax === 'function')
        ? h('button.ibtn.tip', { type: 'button', 'data-tip': 'Fill the window',
          'aria-label': 'Fill the window', onclick: () => win.toggleMax() },
          icon('maximize-2'))
        : null);
    /* .cx-stage is flex:1 by default; inside a page it should only be as
       tall as its own content so the rail below stays put. */
    const stage = h('div.cx-stage', { style: { flex: '0 0 auto', minHeight: '0' } },
      stageTop, stageBox, stageBar);

    /* --- "You might also like": one .cx__sec, rebuilt as it loads --- */
    const relSlot = h('div', { style: { paddingBottom: 'var(--sp-7)' } });

    api.render(body, detail, stage, relSlot);
    loadStage();
    loadRelated();

    function toStage(focus) {
      try { stage.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      catch (e) { stage.scrollIntoView(); }
      if (!focus) return;
      const frame = stageBox.querySelector('iframe');
      if (frame) frame.focus();
    }

    /* ---- resolve: the one call a proxy will really own ---- */
    async function loadStage() {
      api.render(stageBox, h('div.cx-stage__note',
        h('div.spinner'),
        h('small', { text: 'Asking the provider for a source…' })));
      api.clear(stageBar);

      let res;
      try {
        res = await providers.resolve(`movie:${m.id}`);
      } catch (err) {
        if (life.dead) return;
        stageStatus.className = 'badge badge--bad';
        stageStatus.textContent = 'Provider down';
        setStatus('Offline', 'provider unreachable');
        api.render(stageBox, h('div.cx-stage__note',
          icon('alert'),
          h('b', { text: 'Could not reach the provider' }),
          h('small', { text: isProviderError(providers, err) ? err.message : 'The source lookup failed.' }),
          h('button.btn.btn--sm', { type: 'button', onclick: loadStage },
            bIcon(api, 'refresh'), 'Retry')));
        return;
      }

      if (life.dead) return;
      if (res && res.kind === 'embed' && res.url) return paintEmbed(res);
      if (res && res.kind === 'blocked') return paintBlocked(res);
      return paintUnavailable(res || {});
    }

    /* The frame is built exactly as the Games stage builds its own: the
       host gets the same attribute set, and because frame refusal cannot
       be observed from a page, six seconds without a load event means we
       say so and offer the direct link. */
    function paintEmbed(res) {
      stageStatus.className = 'badge badge--ok';
      stageStatus.textContent = 'Source connected';
      setStatus('Ready', 'a source answered');

      let timer = 0;
      const disarm = () => { clearTimeout(timer); timer = 0; };
      life.add(disarm);

      const note = h('span.dim', { style: { fontSize: 'var(--fs-10)' },
        text: 'Playing from an external source. Static only passed the link along.' });
      const hint = h('span.dim.hidden', { style: { fontSize: 'var(--fs-10)' },
        text: 'No answer yet — some hosts refuse to run inside a frame.' });

      const frame = h('iframe.cx-stage__frame', {
        src: res.url,
        allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
        allowfullscreen: true,
        referrerpolicy: 'no-referrer',
        title: m.title,
        onload: () => {
          disarm();
          stageStatus.className = 'badge badge--ok';
          stageStatus.textContent = 'Playing';
          hint.classList.add('hidden');
          note.classList.remove('hidden');
        },
      });

      const arm = () => {
        disarm();
        timer = setTimeout(() => {
          timer = 0;
          if (life.dead || !frame.isConnected) return;
          stageStatus.className = 'badge badge--warn';
          stageStatus.textContent = 'No answer';
          setStatus('Stalled', 'the host has not answered');
          note.classList.add('hidden');
          hint.classList.remove('hidden');
        }, 6000);
      };

      api.render(stageBox, frame);
      api.render(stageBar, note, hint, h('div.grow'),
        h('button.btn.btn--sm', {
          type: 'button', onclick: () => { frame.src = res.url; arm(); },
        }, bIcon(api, 'reload'), 'Reload'),
        h('button.btn.btn--sm', {
          type: 'button', onclick: () => navigate(LIB),
        }, bIcon(api, 'chevron-left'), 'Back to movies'));
      arm();
      if (wantWatch) toStage(true);
    }

    function paintBlocked(res) {
      stageStatus.className = 'badge badge--bad';
      stageStatus.textContent = 'Framing refused';
      setStatus('Blocked', 'the host refuses framing');
      api.render(stageBox, h('div.cx-stage__note',
        icon('shield'),
        h('b', { text: 'That host will not load in a frame' }),
        h('small', { text: res.reason || 'The source sends headers that forbid embedding, so it has to open on its own.' }),
        res.url
          ? h('button.btn.btn--sm', { type: 'button',
            onclick: () => navigate(LIB) },
            bIcon(api, 'chevron-left'), 'Back to movies')
          : null));
      if (wantWatch) toStage(false);
    }

    function paintUnavailable(res) {
      stageStatus.className = 'badge badge--warn';
      stageStatus.textContent = 'Metadata only';
      setStatus('Listed', 'no source connected');
      api.render(stageBox, h('div.cx-stage__note',
        icon('cast'),
        h('b', { text: 'No source connected' }),
        h('small', { text: res.reason || 'Static holds the catalogue, not the video.' }),
        h('span.mono', {
          style: {
            fontSize: 'var(--fs-10)', color: 'var(--accent-soft)',
            background: 'var(--fill-1)', padding: '2px 6px', borderRadius: 'var(--r-xs)',
          },
          text: 'providers.config.mode = "proxy"',
        }),
        h('div.row',
          h('button.btn.btn--sm', { type: 'button',
            onclick: () => navigate(`static://search?q=${encodeURIComponent(`${m.title} ${m.year}`)}`) },
            bIcon(api, 'search'), 'Search the web for it'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => navigate('static://anime') },
            bIcon(api, 'star'), 'Browse anime instead'))));
      api.render(stageBar,
        h('span.dim', { style: { fontSize: 'var(--fs-10)' },
          text: `Static is in "${providers.config.mode}" mode. Every title here is catalogue data only.` }),
        h('div.grow'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: loadStage },
          bIcon(api, 'refresh'), 'Check again'));
      if (wantWatch) toStage(false);
    }

    /* ---- eight neighbours that share a genre ---- */
    async function loadRelated() {
      api.render(relSlot, h('div.cx__sec',
        sectionHead(api, REL_TITLE, 'sparkles', 'loading…'),
        h('div.cx__grid.cx__grid--rail', posterSkel(api, 6))));
      let items;
      try {
        ({ items } = await providers.listMovies({ sort: 'rating' }));
      } catch (err) {
        if (life.dead) return;
        api.render(relSlot, h('div.cx__sec',
          sectionHead(api, REL_TITLE, 'sparkles', 'unavailable'),
          h('div.row',
            icon('alert', { size: 14 }),
            h('span.dim', { style: { fontSize: 'var(--fs-11)' },
              text: 'Recommendations did not load.' }),
            h('button.btn.btn--sm', { type: 'button', onclick: loadRelated },
              bIcon(api, 'refresh'), 'Retry'))));
        return;
      }
      if (life.dead) return;
      const mine = new Set(g);
      const rest = (items || []).filter(x => x.id !== m.id);
      const shared = rest.filter(x => genresOf(x).some(x2 => mine.has(x2)));
      const picks = shared.slice(0, 8);
      if (picks.length < 8) {
        const taken = new Set(picks.map(x => x.id));
        for (const x of rest) {
          if (picks.length >= 8) break;
          if (!taken.has(x.id)) { picks.push(x); taken.add(x.id); }
        }
      }
      if (!picks.length) {
        api.render(relSlot, h('div.cx__sec',
          sectionHead(api, REL_TITLE, 'sparkles', 'nothing yet'),
          h('div.empty', icon('film'),
            h('b', { text: 'Nothing to compare it to' }),
            h('small', { text: 'This is the only title in the catalogue right now.' }))));
        return;
      }
      /* Say exactly how many really share a genre — the rest are top-rated
         padding, and the count should not pretend otherwise. */
      const alike = Math.min(shared.length, picks.length);
      const by = [...mine].slice(0, 2).join(' or ') || 'a genre';
      api.render(relSlot, railSection(ctx, {
        title: REL_TITLE, ic: 'sparkles',
        count: !alike ? plural(picks.length, 'title')
          : alike === picks.length ? `${plural(picks.length, 'title')} sharing ${by}`
            : `${alike} sharing ${by} · ${picks.length - alike} more`,
        cards: picks.map(x => posterCard(ctx, x)),
      }));
    }
  }
}

export default { buildMovies, buildMovieDetail };
