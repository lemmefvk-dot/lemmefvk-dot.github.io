/* ============================================================
   portal.js — portal pages as first-class StaticOS apps.

   The same modules the Browser renders (js/portal/*) are mounted
   directly into their own windows, so Games / Anime / Search can
   be launched from the launcher, the dock and Spotlight without
   going through a browser tab. One page layer, two hosts.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { BRAND, LOCAL_PROXY_URL } from '../portal/brand.js?v=ps5-cloud-proxy-v11';

let PAGES = null, PROVIDERS = null, loadErr = null;
let loading = null;

function ensurePortal() {
  if (PAGES || loadErr) return Promise.resolve();
  if (!loading) {
    loading = Promise.all([
      import('../portal/pages.js?v=ps5-cloud-proxy-v12'),
      import('../portal/providers.js'),
    ]).then(([pages, prov]) => {
      PAGES = pages;
      PROVIDERS = prov.providers || prov.default || prov;
    }).catch(err => {
      loadErr = err;
      console.error('[portal] failed to load:', err);
    });
  }
  return loading;
}

/**
 * Mount a portal page into an app window, with its own little history so
 * drilling into a game or an anime still has a back button.
 */
function mountPortal(ctx, startUrl) {
  const { root, win, opts, api } = ctx;
  const { h, icon } = api;

  const stack = [opts?.url || startUrl];
  let idx = 0;

  const host = h('div.app.app--col', { style: { overflow: 'auto' } });
  root.appendChild(host);

  const back = h('button.ibtn.tip', { 'data-tip': 'Back', 'aria-label': 'Back',
    onclick: () => go(-1) }, icon('chevron-left'));
  const fwd = h('button.ibtn.tip', { 'data-tip': 'Forward', 'aria-label': 'Forward',
    onclick: () => go(1) }, icon('chevron-right'));
  win.setLead(back, fwd);
  win.setTools(
    h('button.ibtn.tip', { 'data-tip': 'Home', 'aria-label': 'Home',
      onclick: () => navigate(startUrl) }, icon('home')),
    h('button.ibtn.tip', { 'data-tip': 'Reload', 'aria-label': 'Reload',
      onclick: () => paint() }, icon('refresh')),
    startUrl === 'static://proxy'
      ? h('a.ibtn.tip', {
          href: LOCAL_PROXY_URL,
          target: '_blank',
          rel: 'noopener noreferrer',
          'data-tip': 'Open Proxy in a new localhost tab (port 8000)',
          'aria-label': 'Open Proxy in a new localhost tab (port 8000)',
        }, icon('external-link'))
      : h('button.ibtn.tip', { 'data-tip': 'Open in Browser', 'aria-label': 'Open in Browser',
          onclick: () => api.openApp('browser', { url: stack[idx] }) }, icon('external-link')),
  );

  function navigate(url) {
    if (!url) return;
    /* an in-portal link to the start page or All Apps belongs to the Browser */
    if (/^(aether|cherri):\/\/(home|apps)$/.test(url) || url === 'static://about'
        || /^https?:/.test(url)) {
      api.openApp('browser', { url });
      return;
    }
    if (url !== stack[idx]) {
      stack.length = idx + 1;
      stack.push(url);
      idx = stack.length - 1;
    }
    paint();
  }

  function go(d) {
    const next = idx + d;
    if (next < 0 || next >= stack.length) return;
    idx = next;
    paint();
  }

  /* Page modules hang a cleanup function on their root node. The window is
     removed from the window layer rather than from `host`, so their own
     removal detector never fires — the host has to call it. */
  function releasePage() {
    for (const node of [...host.children]) {
      try { node.cherriTeardown?.(); } catch (e) { console.warn('[portal] teardown', e); }
    }
    /* whatever was playing went with the page (Screen Time reads this) */
    if (win.state && win.state.playing) { win.state.playing = null; api.bus.emit('win:playing', win); }
  }

  function paint() {
    const url = stack[idx];
    back.disabled = idx <= 0;
    fwd.disabled = idx >= stack.length - 1;
    releasePage();
    api.clear(host);
    host.scrollTop = 0;

    if (loadErr) {
      host.appendChild(h('div.cx-down', icon('alert'), h('div',
        h('b', { text: `The ${BRAND.name} portal could not load` }),
        h('small', { text: String(loadErr.message || loadErr) }))));
      return;
    }
    if (!PAGES) {
      host.appendChild(h('div.center', { style: { height: '100%' } }, h('div.spinner')));
      return;
    }
    const route = PAGES.match(url);
    if (!route) {
      host.appendChild(h('div.empty', icon('compass'),
        h('b', { text: 'Nothing here' }), h('small', { text: url })));
      return;
    }
    /* route titles are page titles ("Games — Static"); a window title bar wants
       just the leading name, so drop the brand suffix whatever the brand is. */
    const full = route.title(url) || route.id;
    const suffix = new RegExp(`\\s*[—-]\\s*(${BRAND.name}|cherri)$`, 'i');
    win.setTitle(full.replace(suffix, '').trim() || route.id);
    try {
      const node = PAGES.build(url, { api, navigate, win, providers: PROVIDERS });
      if (node) host.appendChild(node);
    } catch (err) {
      console.error('[portal] page crashed', url, err);
      host.appendChild(h('div.cx-down', icon('alert'), h('div',
        h('b', { text: 'That page failed to render' }),
        h('small', { text: `${url} — ${err.message || err}` }),
        h('div.row', { style: { marginTop: 'var(--sp-4)' } },
          h('button.btn.btn--sm', { onclick: paint }, icon('refresh'), 'Retry')))));
    }
  }

  /* When the portal modules are already imported, ensurePortal() resolves in a
     microtask, so painting both now and in .then() would build the page twice
     in one task — and the first build's self-teardown never arms, leaking its
     listeners and letting a zombie page overwrite the window subtitle. */
  paint();
  if (!PAGES && !loadErr) ensurePortal().then(() => { if (host.isConnected) paint(); });
  win.onReopen(o => { if (o?.url) navigate(o.url); });

  const onKey = e => {
    if (!win.el.classList.contains('is-active')) return;
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  };
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    releasePage();
    api.clear(host);
  };
}

defineApp({
  id: 'aether-games', name: `${BRAND.name} Games`, icon: 'gamepad',
  g1: '#ffa2b6', g2: '#b01038',
  category: 'Internet', pinned: true, dock: false,
  keywords: ['games', 'play', 'arcade', 'unblocked', 'aether', 'slope', 'subway'],
  desc: '20 games that play right here',
  win: { w: 920, h: 620, minW: 520, minH: 380 },
  mount: ctx => mountPortal(ctx, 'static://games'),
});

defineApp({
  id: 'aether-anime', name: `${BRAND.name} Anime`, icon: 'star',
  g1: '#cbb0ff', g2: '#5a1fbd',
  category: 'Internet', pinned: true, dock: false,
  keywords: ['anime', 'manga', 'watch', 'aether', 'myanimelist'],
  desc: '7,963 anime and 1,200 manga',
  win: { w: 980, h: 660, minW: 540, minH: 400 },
  mount: ctx => mountPortal(ctx, 'static://anime'),
});

defineApp({
  id: 'aether-cloud', name: `${BRAND.name} Cloud`, icon: 'cast',
  g1: '#8ad8ff', g2: '#1462c4',
  category: 'Internet', pinned: true, dock: false,
  keywords: ['cloud', 'gaming', 'stream', 'geforce', 'xbox', 'luna', 'roblox', 'fortnite',
    'game pass', 'boosteroid', 'antstream', 'blacknut', 'where to play'],
  desc: 'Find where to play a game in the cloud',
  win: { w: 980, h: 660, minW: 540, minH: 400 },
  singleton: true,
  mount: ctx => mountPortal(ctx, 'static://cloud'),
});

defineApp({
  id: 'aether-proxy', name: `${BRAND.name} Proxy`, icon: 'shield',
  g1: '#ffcbdb', g2: '#a01238',
  category: 'Internet', pinned: true, dock: false,
  keywords: ['proxy', 'unblock', 'browse', 'vpn', 'tunnel', 'web', 'bypass', 'aether'],
  desc: 'Browse anything, in this window',
  win: { w: 1060, h: 720, minW: 560, minH: 420 },
  mount: ctx => mountPortal(ctx, 'static://proxy'),
});

defineApp({
  id: 'aether-roblox', name: `${BRAND.name} Roblox`, icon: 'brand-roblox',
  g1: '#a6efa8', g2: '#17803c',
  category: 'Internet', pinned: true, dock: false,
  keywords: ['roblox', 'games', 'experiences', 'brookhaven', 'blox fruits', 'adopt me', 'obby'],
  desc: '1,300 experiences, launched in the Roblox player',
  win: { w: 1000, h: 680, minW: 540, minH: 400 },
  mount: ctx => mountPortal(ctx, 'static://roblox'),
});

defineApp({
  id: 'aether-library', name: `${BRAND.name} Library`, icon: 'heart',
  g1: '#ff9ec4', g2: '#c01858',
  category: 'Internet', pinned: true, dock: false,
  keywords: ['library', 'my stuff', 'favourites', 'favorites', 'saved', 'recent', 'watchlist', 'bookmarks'],
  desc: 'Everything you have saved, in one place',
  win: { w: 1000, h: 680, minW: 540, minH: 400 },
  mount: ctx => mountPortal(ctx, 'static://library'),
});

defineApp({
  id: 'aether-search', name: `${BRAND.name} Search`, icon: 'search',
  g1: '#4a7eec', g2: '#0d2775',
  category: 'Internet', pinned: true, dock: false,
  keywords: ['search', 'find', 'aether', 'web', 'engine'],
  desc: 'Search games, anime and the web',
  win: { w: 900, h: 640, minW: 520, minH: 380 },
  mount: ctx => mountPortal(ctx, 'static://search'),
});
