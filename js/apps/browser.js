/* ============================================================
   Browser — tabbed browser whose start page IS the Static portal.

   Rendered locally by this file:
     static://home   static://apps   static://about
   Rendered by the portal in js/portal/ (loaded lazily):
     static://games   static://games/<id>
     static://movies  static://movies/<id>
     static://anime   static://anime/<id>
     static://manga   static://manga/<id>
     static://search?q=…   static://arcade   static://proxy   static://apply
   static:// is accepted as an alias for all of them (see js/portal/brand.js).
   Anything else resolves to an offline page.

   Game pages DO frame their real source (their hosts allow it);
   everything else stays local until a proxy is configured.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { BRAND, canon } from '../portal/brand.js';
import { appTile } from '../core/appart.js';

/**
 * Open a real background tab. Passing a features string (even just 'noopener')
 * makes the browser treat this as a popup-window request, so the link opens in
 * a chrome-less window instead of a tab; clearing `opener` by hand gives the
 * same protection without that side effect.
 */
/* The portal is imported lazily so a fault in one page module degrades to
   "that page does not render" instead of taking the whole Browser app —
   and so the 7.9 MB anime catalogue is never touched until asked for. */
let PAGES = null, PROVIDERS = null, pagesErr = null;
const repaints = new Set();
const portalReady = Promise.all([
  import('../portal/pages.js?v=ps5-cloud-proxy-v12'),
  import('../portal/providers.js'),
]).then(([pages, prov]) => {
  PAGES = pages;
  PROVIDERS = prov.providers || prov.default || prov;
}).catch(err => {
  pagesErr = err;
  console.error('[portal] failed to load:', err);
}).finally(() => {
  for (const fn of repaints) { try { fn(); } catch (e) { console.error(e); } }
});

const HOME = 'static://home';
const APPS = 'static://apps';
const ABOUT = 'static://about';

/* the testimonial wall, same voices as the desktop widget */
const QUOTES = [
  ['ZXS', 'Owner of Luna', 'aether is clean imo'],
  ['Divine', 'Owner of Starlight', 'cute lil site'],
  ['TestUser', 'Co-Owner of Hydra Network', 'i like aether because it is ugly'],
  ['JOSH', 'User', 'i like the name'],
  ['4xmq', 'Owner of Fern', 'aether, like the fifth element? nerdy'],
  ['apbz', 'Owner of Lucide', 'aether has upgraded my unblocking experience'],
];

/* the seven circles under the search box */
const TILES = [
  { n: 'Games', ic: 'gamepad', url: 'static://games' },
  { n: 'Anime', ic: 'star', url: 'static://anime' },
  { n: 'Movies', ic: 'film', url: 'static://movies' },
  { n: 'Music', ic: 'music', app: 'music' },
  { n: 'Cloud', ic: 'cast', url: 'static://cloud' },
  { n: 'Proxy', ic: 'shield', url: 'static://proxy' },
  { n: 'Chat', ic: 'message-circle', app: 'chat' },
  { n: 'All Apps', ic: 'grid-9', url: APPS },
];

/* bare words typed in the address bar that mean a portal page */
const KEYWORDS = {
  games: 'static://games', movies: 'static://movies', anime: 'static://anime',
  manga: 'static://manga', arcade: 'static://arcade', proxy: 'static://proxy',
  cloud: 'static://cloud',
  apply: 'static://apply', search: 'static://search',
};

/* {Q} title-case query · {q} raw query · {s} slug */
const RESULTS = [
  ['{Q} — Wikipedia', 'https://en.wikipedia.org › wiki › {s}',
    'An overview of {q}: origins, notable variants, and the people still arguing about it on the talk page.'],
  ['{Q} · GitHub Topics', 'https://github.com › topics › {s}',
    '1,204 public repositories tagged {s}. Sorted by stars, most recently pushed four hours ago.'],
  ['The complete guide to {q}', 'https://cherri.dev › guides › {s}',
    'Everything we learned shipping {q} in production, including the three things we would never do again.'],
  ['r/{s} — “{q}” megathread', 'https://reddit.com › r › {s}',
    '312 comments · top comment: “honestly {q} is fine once you stop reading the docs”.'],
  ['{Q} reference — Static Docs', 'https://docs.aether.dev › search?q={s}',
    'API reference, worked examples and migration notes for {q}. Updated for StaticOS.'],
];

defineApp({
  id: 'browser',
  name: 'Browser',
  icon: 'globe',
  g1: '#86c8ff', g2: '#1a5bd0',
  category: 'Internet',
  keywords: ['web', 'cherri', 'internet', 'search', 'tabs', 'url'],
  desc: 'Browse cherri and the local web',
  pinned: true, dock: true,
  win: { w: 860, h: 560, minW: 520, minH: 340 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, fmt, store } = api;

    /* ---------------- state ---------------- */
    let seq = 0, usersEl = null;
    /* Bookmarks outlive the window: they are read back out of the store on
       mount and written on every change. Before this they lived only in the
       Set, so closing the Browser silently threw them away. */
    const MARKS_KEY = 'portal.browser.marks';
    const loadMarks = () => {
      const raw = api.store.get(MARKS_KEY, []);
      return new Set(Array.isArray(raw) ? raw.filter(u => typeof u === 'string') : []);
    };
    const saveMarks = () => api.store.set(MARKS_KEY, [...S.marks]);

    const S = {
      tabs: [],            // {id,title,url,history,idx}
      active: '',
      marks: loadMarks(),
      users: 45,
      loading: false,
    };
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
      return t;
    };

    /* `.brw__tab span` in apps.css also matches icon spans, so pin their box. */
    const tabIcon = n => { const e = icon(n); e.style.flex = '0 0 auto'; return e; };

    /* ---------------- urls ----------------- */
    const slug = s => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || 'cherri';
    const hostOf = u => u.replace(/^[a-z][\w+.-]*:\/\//i, '').split(/[/?#]/)[0] || u;
    const isLocal = u => /^(cherri|aether):\/\//.test(u);
    const queryOf = u => { const i = u.indexOf('?q='); return i < 0 ? '' : decodeURIComponent(u.slice(i + 3)); };
    const search = q => `static://search?q=${encodeURIComponent(q)}`;

    function normalize(raw) {
      const s = String(raw || '').trim();
      const low = s.toLowerCase();
      if (!s || low === 'home' || low === 'aether:' || low === 'cherri:'
          || canon(low) === HOME) return HOME;
      if (low === 'apps' || canon(low) === APPS) return APPS;
      if (low === 'about' || low === ABOUT) return ABOUT;
      if (KEYWORDS[low]) return KEYWORDS[low];
      if (/^(aether|cherri):\/\/search/.test(low)) return canon(s);
      if (/^cherri:\/\//.test(low)) return canon(s);
      if (/^[a-z][\w+.-]*:\/\//i.test(s)) return s;
      if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(s)) return `https://${s}`;
      return search(s);
    }

    function titleOf(u) {
      if (u === HOME) return BRAND.name;
      if (u === APPS) return 'All Apps';
      if (u === ABOUT) return 'About StaticOS';
      const portalTitle = PAGES && PAGES.titleOf(u);
      if (portalTitle) return portalTitle;
      if (u.startsWith('static://search')) return `${queryOf(u) || 'Search'} — ${BRAND.name}`;
      return hostOf(u);
    }

    function faviconOf(u) {
      if (u === HOME) return BRAND.icon;
      if (u === APPS) return 'grid-9';
      if (u === ABOUT) return 'info';
      const portalIcon = PAGES && PAGES.iconOf(u);
      if (portalIcon) return portalIcon;
      if (u.startsWith('static://search')) return 'search';
      return 'globe';
    }

    /* ---------------- tabs ----------------- */
    const cur = () => S.tabs.find(t => t.id === S.active) || null;
    const curUrl = () => { const t = cur(); return t ? t.url : HOME; };

    function newTab(url = HOME) {
      const u = normalize(url);
      const t = { id: `t${++seq}`, title: titleOf(u), url: u, history: [u], idx: 0 };
      S.tabs.push(t);
      S.active = t.id;
      paintAll();
      return t;
    }

    function selectTab(id) { if (id !== S.active) { S.active = id; paintAll(); } }

    function closeTab(id) {
      const i = S.tabs.findIndex(t => t.id === id);
      if (i < 0) return;
      S.tabs.splice(i, 1);
      if (!S.tabs.length) return win.close();        // last tab closes the window
      const wasActive = S.active === id;
      if (wasActive) S.active = S.tabs[Math.min(i, S.tabs.length - 1)].id;
      /* Only the tab strip changed when a background tab closed: a full
         paintAll() would tear down and remount the active tab's page, losing
         its scroll position and any running game frame. */
      if (wasActive) paintAll();
      else { paintTabs(); paintNav(); }
    }

    /* ---------------- navigation ----------- */
    function navigate(raw) {
      const t = cur();
      if (!t) return newTab(raw);
      const u = normalize(raw);
      if (u !== t.url) {
        t.history.length = t.idx + 1;
        t.history.push(u);
        t.idx = t.history.length - 1;
      }
      t.url = u;
      t.title = titleOf(u);
      load();
    }

    function step(d) {
      const t = cur();
      if (!t) return;
      const next = t.idx + d;
      if (next < 0 || next >= t.history.length) return;
      t.idx = next;
      t.url = t.history[next];
      t.title = titleOf(t.url);
      load();
    }
    const back = () => step(-1);
    const fwd = () => step(1);

    /** paint everything, then drop the spinner a beat later */
    function load() {
      S.loading = true;
      paintAll();
      later(() => { S.loading = false; paintNav(); }, 220);
    }

    const nope = name => api.notify({
      app: BRAND.name, icon: 'globe', title: 'Not available',
      message: `${name} is not available in this build.`,
    });
    const launch = (id, label) => (api.getApp(id) ? api.openApp(id) : nope(label));

    /* ---------------- chrome --------------- */
    /* The tab row scrolls sideways, but "+" must not scroll out of reach,
       so the scroller is an inner box and the button is pinned beside it. */
    const tabStrip = h('div.scroll-none', {
      style: {
        display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
        flex: '1 1 auto', minWidth: '0', overflowX: 'auto',
      },
    });
    /* Native title, not .tip: the button sits hard against the right edge,
       and a .tip bubble is centred on it, so 8px of it would be cut off by
       .win__body's overflow:hidden (and would pad the app's scrollWidth). */
    const btnNew = h('button.ibtn', {
      title: 'New tab', 'aria-label': 'New tab',
      style: { flex: '0 0 auto' },
      onclick: () => newTab(),
    }, icon('plus'));
    const tabsEl = h('div.brw__tabs', tabStrip, btnNew);

    const btnBack = h('button.ibtn.tip', { 'data-tip': 'Back', 'aria-label': 'Back', onclick: back }, icon('chevron-left'));
    const btnFwd = h('button.ibtn.tip', { 'data-tip': 'Forward', 'aria-label': 'Forward', onclick: fwd }, icon('chevron-right'));
    const btnReload = h('button.ibtn.tip', { 'data-tip': 'Reload', 'aria-label': 'Reload', onclick: () => load() }, icon('refresh'));

    const urlIn = h('input', {
      type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Address and search bar',
      onkeydown: e => { if (e.key === 'Escape') { urlIn.value = curUrl(); urlIn.blur(); } },
    });
    const urlBox = h('form.field.brw__url', {
      onsubmit: e => { e.preventDefault(); navigate(urlIn.value); urlIn.blur(); },
    }, icon('lock'), urlIn);

    const btnStar = h('button.ibtn.tip', { 'data-tip': 'Bookmark', 'aria-label': 'Bookmark this page', onclick: star }, icon('star'));
    const btnMore = h('button.ibtn.tip', { 'data-tip': 'More', 'aria-label': 'More', onclick: e => moreMenu(e) }, icon('more-horizontal'));

    const view = h('div.brw__view');
    root.appendChild(h('div.app', h('div.brw',
      tabsEl,
      h('div.brw__nav', btnBack, btnFwd, btnReload, urlBox, btnStar, btnMore),
      view)));

    win.setTools(
      h('button.ibtn.tip', {
        'data-tip': 'Search', 'aria-label': 'Search',
        onclick: () => { urlIn.focus(); urlIn.select(); },
      }, icon('search')),
      h('button.ibtn.tip', { 'data-tip': 'Start page', 'aria-label': 'Start page', onclick: () => navigate(HOME) }, icon('home')),
    );

    function star() {
      const u = curUrl();
      if (S.marks.has(u)) S.marks.delete(u);
      else {
        S.marks.add(u);
        api.notify({ app: 'Browser', icon: 'star', title: 'Bookmarked', message: titleOf(u) });
      }
      saveMarks();
      paintNav();
    }

    function moreMenu(e) {
      const marks = [...S.marks];
      api.menu([
        { label: 'New tab', icon: 'plus', hint: HOME, onClick: () => newTab() },
        { label: 'Duplicate tab', icon: 'copy', onClick: () => newTab(curUrl()) },
        { label: 'Reload', icon: 'refresh', onClick: () => load() },
        '-',
        ...(marks.length
          ? marks.slice(0, 12).map(u => ({
              label: titleOf(u), icon: faviconOf(u), hint: hostOf(u), onClick: () => navigate(u),
            }))
          : [{ label: 'No bookmarks yet', icon: 'star', disabled: true }]),
        ...(marks.length ? ['-', {
          label: 'Clear bookmarks', icon: 'trash',
          onClick: () => { S.marks.clear(); saveMarks(); paintNav(); },
        }] : []),
      ], e.clientX, e.clientY);
    }

    function tabMenu(e, t) {
      e.preventDefault(); e.stopPropagation();
      api.menu([
        { label: 'Reload', icon: 'refresh', onClick: () => { selectTab(t.id); load(); } },
        { label: 'Duplicate', icon: 'copy', onClick: () => newTab(t.url) },
        '-',
        { label: 'Close tab', icon: 'x', onClick: () => closeTab(t.id) },
        { label: 'Close other tabs', icon: 'layers', disabled: S.tabs.length < 2,
          onClick: () => { S.tabs = S.tabs.filter(x => x.id === t.id); S.active = t.id; paintAll(); } },
      ], e.clientX, e.clientY);
    }

    /* ---------------- cherri start page ---- */
    const tile = t => h('button.start__app', {
      onclick: () => (t.url ? navigate(t.url) : t.app ? launch(t.app, t.n) : nope(t.n)),
    }, h('div.start__circle', icon(t.ic)), h('span', { text: t.n }));

    const card = ([who, role, quote]) => h('div.start__card',
      h('div.quote__u',
        h('div.avatar', { text: who[0].toUpperCase() }),
        h('div', h('b', { text: who }), h('small', { text: role }))),
      quote);

    function pageHome() {
      const input = h('input', {
        type: 'search', placeholder: 'Search for anything!', spellcheck: 'false', 'aria-label': `Search ${BRAND.name}`,
      });
      usersEl = h('span', { text: `${S.users} users online` });

      return h('div.start',
        h('div.start__logo', { text: BRAND.wordmark }),
        h('div.start__tag', { text: BRAND.tagline }),
        h('form.field.start__search', {
          onsubmit: e => { e.preventDefault(); const q = input.value.trim(); if (q) navigate(search(q)); },
        }, icon('search'), input),
        h('div.start__apps', TILES.map(tile)),
        h('div.start__meta', icon('users', { size: 11 }), usersEl),
        h('button.start__discord', { onclick: () => launch('chat', 'Discord') },
          h('i', icon('message-circle')),
          h('b', { text: 'Open Discord' }),
          h('span.dim', { text: 'inside Static Chat' })),
        h('div.start__cards', QUOTES.map(card)),
        h('div.start__foot', { text: BRAND.footer }));
    }

    /* ---------------- search results ------- */
    function pageResults(q) {
      if (!q) {
        return h('div.empty', icon('search'), h('b', { text: 'Nothing to search for' }),
          h('small', { text: 'Type a query in the address bar, or go back to the start page.' }),
          h('button.btn', { onclick: () => navigate(HOME) }, icon(BRAND.icon, { size: 14 }), 'Start page'));
      }
      const s = slug(q), Q = q.charAt(0).toUpperCase() + q.slice(1);
      const fill = str => str.replace(/\{Q\}/g, Q).replace(/\{q\}/g, q).replace(/\{s\}/g, s);
      const rnd = fmt.seeded([...s].reduce((a, c) => a + c.charCodeAt(0), 7));
      const total = Math.floor(9000 + rnd() * 940000);
      const took = 120 + Math.floor(rnd() * 700);

      const input = h('input', { type: 'search', value: q, spellcheck: 'false', 'aria-label': 'Search cherri' });
      const wrap = h('div.app__content');
      wrap.append(
        h('form.field', {
          style: { maxWidth: '320px' },
          onsubmit: e => { e.preventDefault(); const v = input.value.trim(); if (v && v !== q) navigate(search(v)); },
        }, icon('search'), input),
        h('div.label', { text: `About ${total.toLocaleString()} results · ${took} ms`, style: { margin: 'var(--sp-5) 0 var(--sp-3)' } }),
        h('div.list', RESULTS.map(r => {
          const url = fill(r[1]);
          return h('button.list__item', { onclick: () => navigate(url.replace(/ › /g, '/')) },
            h('div.grow',
              h('b', { text: fill(r[0]) }),
              /* .term__ok is the kit's only "safe green" — reused for the url line */
              h('div.term__ok', { text: url, style: { fontSize: 'calc(9.5px * var(--fs-k,1))', margin: '2px 0 3px' } }),
              h('small', { text: fill(r[2]) })));
        })),
        h('div.dim', {
          text: 'Results are generated locally — cherri has no network access in this build.',
          style: { marginTop: 'var(--sp-6)', fontSize: 'calc(9.5px * var(--fs-k,1))' },
        }));
      return wrap;
    }

    /* ---------------- static://apps -------- */
    function pageApps() {
      const list = api.listApps();
      const wrap = h('div.app__content');
      wrap.append(
        h('div.label', { text: `Installed apps · ${list.length}` }),
        list.length
          ? h('div.grid3', { style: { marginTop: 'var(--sp-4)' } }, list.map(a =>
            h('button.store__item', {
              onclick: () => api.openApp(a.id),
              title: a.desc || a.category,
            },
              appTile(a),
              h('div.grow', h('b', { text: a.name }), h('small', { text: a.desc || a.category })))))
          : h('div.empty', icon('grid-9'), h('b', { text: 'No apps registered' })));
      return wrap;
    }

    /* ---------------- static://about ------- */
    function pageAbout() {
      const sys = store.get('system') || {};
      const rows = [
        ['Version', '3.0 “cherri”'],
        ['Build', 'aether-3.0.1 · 2026.09'],
        ['Kernel', sys.kernel],
        ['Shell', sys.shell],
        ['Compositor', sys.wm],
        ['Processor', sys.cpu],
        ['Graphics', sys.gpu],
        ['Memory', sys.ramTotal ? `${sys.ramTotal} GB` : null],
        ['Display', sys.resolution],
      ];
      return h('div.about',
        h('div.about__logo', icon(BRAND.icon)),
        h('div',
          h('div.h-sec', { text: sys.os || 'StaticOS' }),
          h('small.dim', { text: 'Rendered locally by the Browser. No network required.' })),
        h('div.card', { style: { width: '100%', maxWidth: '360px', textAlign: 'left' } },
          h('table.table', h('tbody', rows.map(([k, v]) =>
            h('tr', h('th', { text: k }), h('td', { text: v || '—' })))))),
        h('button.btn', { onclick: () => launch('about', 'About') }, icon('external-link', { size: 14 }), 'Open the About app'));
    }

    /* ---------------- offline -------------- */
    function pageOffline(u) {
      const host = hostOf(u);
      const retry = h('button.btn.btn--primary', { onclick: tryAgain }, icon('refresh', { size: 14 }), 'Retry');

      function tryAgain() {
        retry.disabled = true;
        api.render(retry, h('div.spinner'), 'Reconnecting…');
        later(() => {
          paintView();
          api.notify({ app: 'Browser', icon: 'wifi-off', title: 'Still offline', message: `Could not reach ${host}.` });
        }, 900);
      }

      return h('div.empty',
        icon('wifi-off'),
        h('b', { text: 'You’re offline' }),
        h('small', { text: host }),
        h('div.row',
          retry,
          h('button.btn.btn--ghost', { onclick: () => navigate(HOME) }, icon('home', { size: 14 }), 'Start page')));
    }

    /* ---------------- paint ---------------- */
    function paintTabs() {
      api.clear(tabStrip);
      for (const t of S.tabs) {
        const label = h('button', {
          title: t.url,
          style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flex: '1', minWidth: '0', height: '100%', color: 'inherit' },
          onclick: () => selectTab(t.id),
        }, tabIcon(faviconOf(t.url)), h('span.trunc', { text: t.title }));

        const shut = h('button.ibtn', {
          'aria-label': `Close ${t.title}`,
          style: { height: '18px', minWidth: '18px', padding: '0', borderRadius: 'var(--r-xs)' },
          onclick: () => closeTab(t.id),
        }, tabIcon('x'));

        const tab = h('div.brw__tab', { oncontextmenu: e => tabMenu(e, t) }, label, shut);
        if (t.id === S.active) tab.classList.add('is-on');
        tabStrip.appendChild(tab);
        if (t.id === S.active) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    function paintNav() {
      win.state.reopen = { url: curUrl() };   /* reopened later: this page (js/core/reopen.js) */
      const t = cur(), u = curUrl(), marked = S.marks.has(u);
      urlIn.value = u;
      btnBack.disabled = !t || t.idx <= 0;
      btnFwd.disabled = !t || t.idx >= t.history.length - 1;
      btnStar.classList.toggle('is-on', marked);
      btnStar.setAttribute('data-tip', marked ? 'Remove bookmark' : 'Bookmark');
      api.render(btnReload, S.loading ? h('div.spinner') : icon('refresh'));
      btnReload.setAttribute('data-tip', S.loading ? 'Loading…' : 'Reload');
      win.setTitle(t ? t.title : 'Browser');
      win.setSubtitle(isLocal(u) ? '' : hostOf(u));
    }

    const PORTAL_RE = /^aether:\/\/(games|movies|anime|manga|arcade|proxy|apply|search)/;

    function pageCrash(u, err) {
      return h('div.cx-down', icon('alert'),
        h('div',
          h('b', { text: 'That page failed to render' }),
          h('small', { text: `${u} — ${err && err.message ? err.message : String(err)}` }),
          h('div.row', { style: { marginTop: 'var(--sp-4)' } },
            h('button.btn.btn--sm', { onclick: () => load() }, icon('refresh'), 'Retry'),
            h('button.btn.btn--sm.btn--ghost', { onclick: () => navigate(HOME) }, 'Start page'))));
    }

    /* Portal pages hang a cleanup function on their root node; the window is
       removed from the window layer, not from `view`, so their own removal
       detector never fires and the Browser has to call it. */
    function releasePage() {
      for (const node of [...view.children]) {
        try { node.cherriTeardown?.(); } catch (err) { console.warn('[portal] teardown', err); }
      }
    }

    function paintView() {
      const u = curUrl();
      usersEl = null;
      releasePage();
      api.clear(view);
      view.scrollTop = 0;

      if (u === HOME) return void view.appendChild(pageHome());
      if (u === APPS) return void view.appendChild(pageApps());
      if (u === ABOUT) return void view.appendChild(pageAbout());

      /* the portal (js/portal/) owns games, movies, anime, manga,
         search, arcade, proxy and apply */
      if (PAGES && PAGES.match(u)) {
        try {
          const node = PAGES.build(u, { api, navigate, win, providers: PROVIDERS });
          if (node) return void view.appendChild(node);
        } catch (err) {
          console.error('[portal] page crashed', u, err);
          return void view.appendChild(pageCrash(u, err));
        }
      }
      /* still importing: show a spinner rather than a wrong answer */
      if (!PAGES && !pagesErr && PORTAL_RE.test(u)) {
        return void view.appendChild(
          h('div.center', { style: { height: '100%' } }, h('div.spinner')));
      }
      if (u.startsWith('static://search')) return void view.appendChild(pageResults(queryOf(u)));
      view.appendChild(pageOffline(u));
    }

    function paintAll() { paintTabs(); paintNav(); paintView(); }

    /* ---------------- life ----------------- */
    newTab(opts?.url || HOME);

    /* the "45 users online" counter breathes a little */
    const offTick = api.bus.on('tick:5s', () => {
      if (!usersEl || !usersEl.isConnected) return;
      S.users = Math.round(fmt.drift(S.users, 28, 72, 3));
      usersEl.textContent = `${S.users} users online`;
    });

    win.onReopen(o => { if (o?.url) newTab(o.url); });

    /* when the lazily-imported portal arrives, repaint anything waiting on it */
    repaints.add(paintAll);
    if (!PAGES && !pagesErr) portalReady.then(() => {});

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      /* mod+alt+arrow is the OS snap chord (wm.js) — let the shell have it
         instead of snapping the window AND navigating the tab. */
      const mod = e.metaKey || e.ctrlKey;
      if (e.altKey && !mod && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.altKey && !mod && e.key === 'ArrowRight') { e.preventDefault(); fwd(); }
      else if (e.key === 'F5') { e.preventDefault(); load(); }
      else if (e[fmt.modKey] && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); urlIn.focus(); urlIn.select(); }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      offTick();
      repaints.delete(paintAll);
      window.removeEventListener('keydown', onKey);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      releasePage();
      api.clear(view);
    };
  },
});
