/* ============================================================
   cloud.js — static://cloud

   Static Cloud used to be a launcher: a grid of tiles that each
   opened somebody else's site in a new tab. The verified services
   now run in this window; the Proxy link is an explicit same-site
   new-tab action.

   This version only offers things that actually render here.
   Every surface was probed against its live endpoint, and the
   commercial services that refuse framing are listed as refusing
   rather than quietly dressed up as working — see the header of
   cloud.data.js for what each one answered.

   The substance is in two places: real streamed surfaces that
   allow framing (Roblox and Android on a cloud device, a Windows
   desktop), and archive.org's emulator, which frames cleanly and
   whose search API is CORS-open — so thousands of DOS, arcade
   and console titles are searched live rather than baked.

   And it answers "where can I play this game?" — one search over
   the game lists the licensed cloud services publish (GeForce NOW,
   Xbox Cloud Gaming, Boosteroid, Antstream, Blacknut; see
   cloud.catalog.js). Those refuse to be framed, so their Play
   buttons are links that open the service's own site in a new tab.
   ============================================================ */

import { BRAND, LOCAL_PROXY_URL } from './brand.js?v=ps5-cloud-proxy-v11';
import * as CD from './cloud.data.js?v=ps5-cloud-proxy-v11';
import * as RB from './roblox.data.js';
import * as UV from './uv.js';
import * as CC from './cloud.catalog.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-cloud-ps5-css')) {
  const link = document.createElement('link');
  link.id = 'feat-cloud-ps5-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-cloud-ps5.css?v=ps5-cloud-proxy-v11';
  document.head.appendChild(link);
}

const NAV = [
  ['home',   'Home',   'static://home',   'home'],
  ['games',  'Games',  'static://games',  'gamepad'],
  ['roblox', 'Roblox', 'static://roblox', 'box'],
  ['cloud',  'Cloud',  'static://cloud',  'cast'],
  ['anime',  'Anime',  'static://anime',  'star'],
  ['proxy',  'Proxy',  'static://proxy',  'shield'],
];

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

const compact = n => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
};

function topStrip(ctx, current) {
  const { api, navigate } = ctx;
  const { h, icon } = api;
  const proxyTabUrl = LOCAL_PROXY_URL;
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
    NAV.map(([id, label, url, ic]) => id === 'proxy'
      ? h('a.cx__nav-link', {
          href: proxyTabUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': 'Proxy (opens in localhost on port 8000)',
          title: 'Opens in localhost on port 8000',
        }, icon(ic), h('span', { text: label }))
      : h(id === current ? 'button.is-on' : 'button', {
          type: 'button',
          'aria-current': id === current ? 'page' : null,
          onclick: () => navigate(url),
        }, icon(ic), h('span', { text: label }))));
  return h('div.cx__top',
    h('div.cx__mark', icon(BRAND.icon), h('span', { text: BRAND.wordmark })),
    find, nav);
}


/* Favourites and play history for the emulated library. The titles come
   from archive.org live, so only the identifier is stored — the metadata
   is re-fetched rather than cached, which keeps a stale copy from ever
   contradicting the archive.
   Every Static Cloud key lives under `portal`, which is in store.js's
   PERSIST list; the old `cloud.*` keys were not, so favourites, history
   and settings here were silently lost on the next reload. */
const FAV_KEY = 'portal.cloud.favs';
const PLAYED_KEY = 'portal.cloud.played';

const readRows = (api, key) => {
  const raw = api.store.get(key, []);
  return Array.isArray(raw) ? raw.filter(r => r && typeof r.id === 'string') : [];
};
const writeRows = (api, key, rows) => api.store.set(key, rows.slice(0, 60));

const isFav = (api, id) => readRows(api, FAV_KEY).some(r => r.id === id);
const toggleFav = (api, item) => {
  const rows = readRows(api, FAV_KEY);
  const has = rows.some(r => r.id === item.id);
  const next = has ? rows.filter(r => r.id !== item.id)
    : [{ id: item.id, title: item.title, art: item.art, year: item.year || null }, ...rows];
  writeRows(api, FAV_KEY, next);
  return !has;
};
const notePlayed = (api, item) => {
  const rows = readRows(api, PLAYED_KEY).filter(r => r.id !== item.id);
  writeRows(api, PLAYED_KEY, [
    { id: item.id, title: item.title, art: item.art, year: item.year || null, at: Date.now() },
    ...rows,
  ]);
};

/* Favourites for "Where can I play it?": a game's key (its normalised
   title) and its name, so the list still reads right if a later sync
   renames or drops it. */
const WHERE_FAVS = 'portal.cloud.whereFavs';
const PER = 24;
const whereFavs = api => {
  const raw = api.store.get(WHERE_FAVS, []);
  return Array.isArray(raw) ? raw.filter(r => r && typeof r.k === 'string') : [];
};
const isWhereFav = (api, k) => whereFavs(api).some(r => r.k === k);
const toggleWhereFav = (api, g) => {
  const k = CC.keyOf(g);
  const rows = whereFavs(api);
  const on = !rows.some(r => r.k === k);
  api.store.set(WHERE_FAVS, on ? [{ k, t: g.t }, ...rows].slice(0, 200) : rows.filter(r => r.k !== k));
  return on;
};
const dateOf = iso => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
};

export function buildCloud(ctx) {
  const { api, navigate } = ctx;
  const { h, icon } = api;
  const launchParams = (() => {
    try { return new URLSearchParams(String(ctx.url || '').split('?')[1] || ''); }
    catch (err) { return new URLSearchParams(); }
  })();

  const root = h('div.cx');
  const life = lifecycle(root);
  root.appendChild(topStrip(ctx, 'cloud'));

  const body = h('div');
  root.appendChild(body);

  const S = {
    view: 'home',                 // home | play
    playing: null,                // {title, url, note, kind}
    collection: api.store.get('portal.cloud.collection', CD.COLLECTIONS[0].id),
    q: '',
    page: 1,
    busy: false,
    res: null,
    err: null,
    seq: 0,
    wq: launchParams.get('q') || '',
    wsvc: (CC.LISTED.find(s => s.id === api.store.get('portal.cloud.whereSvc')) || { id: '' }).id,
    wfav: false,
    wlimit: PER,
    noLogin: api.store.get('portal.cloud.noLogin', false),
  };
  const E = {};

  paint();
  life.add(() => { clearTimeout(E.timer); clearTimeout(E.wtimer); E.abort?.abort(); });
  const streamId = launchParams.get('stream');
  const startStream = CD.STREAMS.find(stream => stream.id === streamId);
  if (startStream) queueMicrotask(() => {
    if (!life.dead) play({
      title: startStream.name, url: startStream.url, note: startStream.note,
      kind: startStream.kind, via: startStream.via, route: startStream.route,
    });
  });
  return root;

  /* ---------- views ---------- */

  function paint() {
    api.clear(body);
    if (S.view === 'play') return body.appendChild(stage());
    body.appendChild(home());
    loadLibrary();
  }

  function home() {
    const wrap = h('div');

    wrap.appendChild(h('div.cx__hero.cl__hero',
      h('div.cx__hero-in',
        h('div.cx__hero-kick', { text: 'AETHER CLOUD' }),
        h('div.cx__hero-t', { text: 'Things that actually run here' }),
        h('div.cx__hero-s', { text: CD.VERDICT }),
        h('div.cx__hero-s.cl__nologin', { text: CD.NO_ACCOUNT_NOTE }),
        h('div.cx__hero-meta',
          h('span.chip.chip--accent', { text: `${CD.COLLECTIONS.length} emulated libraries` }),
          h('span.chip', { text: 'runs in this window' }),
          h('span.chip', { text: `${CD.BLOCKED.length} services probed and refused` })))));

    /* --- the question most people arrive with: where can I play X? --- */
    wrap.appendChild(whereSection());

    /* --- streamed surfaces --- */
    const rail = h('div.cx__grid--rail');
    const surfaces = CD.STREAMS.filter(x => !S.noLogin || (x.account || 'none') === 'none');
    for (const s of surfaces) rail.appendChild(streamCard(s));
    if (!surfaces.length) {
      rail.appendChild(h('div.empty', icon('check'),
        h('b', { text: 'Those both ask for an account' }),
        h('small', { text: 'The emulated library below does not — that is 8,900 titles you can just start.' })));
    }
    if (CD.STREAMS.length) {
      const toggle = h(S.noLogin ? 'button.chip.is-on' : 'button.chip', {
        type: 'button', 'aria-pressed': String(S.noLogin), style: { marginLeft: 'auto' },
        onclick: () => {
          S.noLogin = !S.noLogin;
          api.store.set('portal.cloud.noLogin', S.noLogin);
          paint();
        },
      }, icon('check', { size: 12 }), h('span', { text: 'No sign-in only' }));

      wrap.appendChild(h('div.cx__sec',
        h('div.cx__sec-h', icon('cast'), h('div.cx__sec-t', { text: 'Verified to render here' }),
          h('div.cx__sec-n', { text: 'loaded in a real frame, not just header-checked' }),
          toggle),
        rail));
    }

    /* --- Roblox cross-link, because it is the thing most asked for --- */
    wrap.appendChild(robloxRow());

    /* --- the two personal shelves, only when there is something in them --- */
    for (const [key, label, icon_, note] of [
      [PLAYED_KEY, 'Jump back in', 'clock', 'on this device'],
      [FAV_KEY, 'Favourites', 'heart', 'saved here'],
    ]) {
      const rows = readRows(api, key);
      if (!rows.length) continue;
      const rail2 = h('div.cx__grid--rail');
      for (const r of rows.slice(0, 14)) rail2.appendChild(savedCard(r));
      wrap.appendChild(h('div.cx__sec',
        h('div.cx__sec-h', icon(icon_), h('div.cx__sec-t', { text: label }),
          h('div.cx__sec-n', { text: note }),
          h('button.btn.btn--ghost.btn--sm', {
            type: 'button', style: { marginLeft: 'auto' },
            onclick: () => { api.store.set(key, []); paint(); },
          }, icon('x', { size: 12 }), 'Clear')),
        rail2));
    }

    /* --- emulated library --- */
    E.collections = h('div.cx__cats', { role: 'group', 'aria-label': 'Emulated libraries' });
    for (const c of CD.COLLECTIONS) {
      E.collections.appendChild(h(c.id === S.collection ? 'button.cx-cat.is-on' : 'button.cx-cat', {
        type: 'button', 'aria-pressed': String(c.id === S.collection), title: c.note,
        onclick: () => {
          S.collection = c.id; S.page = 1;
          api.store.set('portal.cloud.collection', c.id);
          repaintCats(); loadLibrary();
        },
      }, icon(c.icon, { size: 12 }), h('span', { text: c.name })));
    }

    E.search = h('input', {
      type: 'search', placeholder: 'Search the library…', spellcheck: 'false',
      'aria-label': 'Search the emulated library', value: S.q,
      oninput: e => {
        S.q = e.target.value; S.page = 1;
        clearTimeout(E.timer);
        E.timer = setTimeout(loadLibrary, 340);
      },
    });

    E.libT = h('div.cx__sec-t', { text: 'Emulated' });
    E.libN = h('div.cx__sec-n', { text: 'loading…' });
    E.grid = h('div.cx__grid');
    E.pager = h('div.cx__pager');

    wrap.appendChild(h('div.cx__sec',
      h('div.cx__sec-h', icon('gamepad'), E.libT, E.libN),
      E.collections,
      h('div.cx__bar', h('div.field', { style: { flex: '0 0 220px', height: '26px' } },
        icon('search'), E.search)),
      E.grid, E.pager));

    wrap.appendChild(blockedPanel());
    return wrap;
  }

  function repaintCats() {
    if (!E.collections) return;
    [...E.collections.children].forEach((el, i) => {
      const on = CD.COLLECTIONS[i].id === S.collection;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-pressed', String(on));
    });
  }

  function streamCard(s) {
    return h('button.cl-card', {
      type: 'button', 'aria-label': `${s.name} — ${s.blurb}`,
      onclick: () => play({ title: s.name, url: s.url, note: s.note, kind: s.kind, via: s.via, route: s.route }),
    },
      h('div.cl-card__ic', icon(s.icon, { size: 20 })),
      h('div.cl-card__b',
        h('div.cl-card__t', { text: s.name }),
        h('div.cl-card__d', { text: s.blurb }),
        h('div.cl-card__acct',
          icon((s.account || 'none') === 'none' ? 'check' : 'user', { size: 11 }),
          h('span', { text: CD.accountOf(s).label }))),
      h('span.badge', {
        class: (s.account || 'none') === 'none' ? 'badge badge--ok' : 'badge',
        title: CD.accountOf(s).note,
        text: s.via === 'tunnel' ? 'via tunnel' : 'in window',
      }));
  }

  function robloxRow() {
    const rail = h('div.cx__grid--rail');
    const sec = h('div.cx__sec',
      h('div.cx__sec-h', icon('box'), h('div.cx__sec-t', { text: 'Roblox experiences' }),
        h('div.cx__sec-n', { text: 'live player counts' }),
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button', style: { marginLeft: 'auto' },
          onclick: () => navigate('static://roblox'),
        }, 'Browse all', icon('chevron-right', { size: 13 }))),
      rail);

    RB.load().then(() => {
      if (life.dead || RB.loadError()) { sec.remove(); return; }
      const top = RB.query({ sort: 'playing', perPage: 10 }).items;
      RB.refreshPlaying(top).finally(() => {
        if (life.dead) return;
        api.clear(rail);
        for (const row of top) {
          const art = h('div.rbx-card__art');
          if (row.art) {
            art.appendChild(h('img', {
              src: row.art, alt: '', loading: 'lazy', decoding: 'async',
              referrerpolicy: 'no-referrer', onerror: e => e.target.remove(),
            }));
          }
          art.appendChild(h('div.rbx-card__live', h('i.rbx-dot'), h('span', { text: compact(row.playing) })));
          rail.appendChild(h('div.rbx-card', {
            role: 'button', tabindex: '0',
            'aria-label': `${row.name} — details`,
            onclick: () => navigate(`static://roblox/${row.id}`),
            onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`static://roblox/${row.id}`); } },
          }, art, h('div.cl-rbxb', h('div.rbx-card__t', { text: row.name }))));
        }
      });
    });
    return sec;
  }


  /* ---------- where can I play it? ----------
     One search across the game lists the licensed services publish
     themselves (cloud.catalog.js, data/cloud-games.json). Each result
     says what that service asks of you. Play is a plain link to the
     service's own page, opened in a new tab: these services refuse to
     be framed, and they are never put through the tunnel. */
  function whereSection() {
    const count = h('div.cx__sec-n', { text: 'loading…' });
    const input = h('input', {
      type: 'search', placeholder: 'Search a game — skate, call of duty…', spellcheck: 'false',
      autocomplete: 'off', 'aria-label': 'Where can I play it? Search cloud games', value: S.wq,
      oninput: e => {
        S.wq = e.target.value; S.wlimit = PER;
        clearTimeout(E.wtimer);
        E.wtimer = setTimeout(paintWhere, 160);
      },
    });
    const chips = h('div.cx__cats', { role: 'group', 'aria-label': 'Services' });
    const favBtn = h('button.chip', {
      type: 'button', 'aria-pressed': String(S.wfav),
      onclick: () => { S.wfav = !S.wfav; S.wlimit = PER; paintWhere(); },
    }, icon('heart', { size: 12 }), h('span', { text: 'Favourites' }));
    const hint = h('div.cl-where__hint', { 'aria-live': 'polite' });
    const listEl = h('div.cl-where__list', { role: 'list', 'aria-label': 'Where to play' });
    const more = h('div.cx__pager');
    const foot = h('div.cl-where__foot');

    const sec = h('div.cx__sec.cl-where',
      h('div.cx__sec-h', icon('search'), h('div.cx__sec-t', { text: 'Where can I play it?' }), count),
      h('div.cx__bar',
        h('div.field', { style: { flex: '1 1 260px', height: '26px' } }, icon('search'), input),
        favBtn),
      chips, hint, listEl, more, foot);
    Object.assign(E, { winput: input, wcount: count, wchips: chips, wfavBtn: favBtn, whint: hint, wlist: listEl, wmore: more, wfoot: foot });

    for (let i = 0; i < 6; i++) listEl.appendChild(h('div.cl-skel.cl-where__skel'));
    CC.load().then(d => {
      if (life.dead) return;
      if (!d) {
        count.textContent = 'unavailable';
        api.clear(listEl);
        listEl.appendChild(h('div.empty', icon('alert'),
          h('b', { text: 'The cloud game list did not load' }),
          h('small', { text: String(CC.loadError()?.message || 'Try again in a moment.') }),
          h('button.btn', { type: 'button', onclick: () => paint() }, icon('refresh', { size: 13 }), 'Try again')));
        return;
      }
      paintWhereChips();
      paintWhereFoot();
      paintWhere();
    });
    return sec;
  }

  function paintWhereChips() {
    const counts = CC.counts();
    api.clear(E.wchips);
    for (const s of [{ id: '', short: 'All services' }, ...CC.LISTED]) {
      const on = S.wsvc === s.id;
      E.wchips.appendChild(h(on ? 'button.cx-cat.is-on' : 'button.cx-cat', {
        type: 'button', 'aria-pressed': String(on), 'data-service': s.id || 'all',
        title: s.id ? `${counts[s.id] || 0} games on ${s.name}` : 'Every service',
        onclick: () => {
          S.wsvc = s.id; S.wlimit = PER;
          api.store.set('portal.cloud.whereSvc', s.id);
          paintWhereChips(); paintWhere();
        },
      }, s.icon ? icon(s.icon, { size: 12 }) : null, h('span', { text: s.short })));
    }
  }

  function paintWhere() {
    if (!E.wlist || !CC.isLoaded()) return;
    const favs = whereFavs(api);
    const only = S.wfav ? new Set(favs.map(r => r.k)) : null;
    const res = CC.search(S.wq, { service: S.wsvc, only });
    let items = res.items;
    /* nothing typed: your favourites lead, then the most played */
    if (!S.wq.trim() && !S.wfav && favs.length) {
      const fk = new Set(favs.map(r => r.k));
      items = [...items.filter(g => fk.has(CC.keyOf(g))), ...items.filter(g => !fk.has(CC.keyOf(g)))];
    }
    const d = CC.data();
    const total = d.games.length;
    const svcN = Object.keys(d.sources || {}).length;
    const asOf = dateOf(d.built);
    E.wcount.textContent = S.wq.trim() || S.wsvc || S.wfav
      ? `${res.total.toLocaleString()} of ${total.toLocaleString()} games`
      : `${total.toLocaleString()} games on ${svcN} services${asOf ? ` · data as of ${asOf}` : ''}`;
    E.wfavBtn.classList.toggle('is-on', S.wfav);
    E.wfavBtn.setAttribute('aria-pressed', String(S.wfav));

    api.clear(E.whint);
    if (res.suggestion && S.wq.trim()) {
      E.whint.append(h('span', { text: 'Showing close spellings of ' }), h('b', { text: `“${S.wq.trim()}”` }),
        h('span', { text: ' — did you mean ' }),
        h('button.cl-where__sugg', {
          type: 'button',
          onclick: () => { S.wq = res.suggestion; E.winput.value = res.suggestion; paintWhere(); },
        }, res.suggestion), h('span', { text: '?' }));
    }

    api.clear(E.wlist);
    if (!items.length) {
      E.wlist.appendChild(h('div.empty', icon(S.wfav ? 'heart' : 'search'),
        h('b', { text: S.wfav && !favs.length ? 'No favourites yet'
          : S.wq.trim() ? `No listed service has “${S.wq.trim()}”` : 'Nothing matches those filters' }),
        h('small', { text: S.wfav && !favs.length
          ? 'Tap the heart on a game to keep it here.'
          : 'These are the lists the services publish, as of the date above. Luna and now.gg publish none — they are linked below to look there.' }),
        (S.wq || S.wsvc || S.wfav) ? h('button.btn', {
          type: 'button',
          onclick: () => {
            S.wq = ''; S.wsvc = ''; S.wfav = false; S.wlimit = PER;
            api.store.set('portal.cloud.whereSvc', '');
            E.winput.value = '';
            paintWhereChips(); paintWhere();
          },
        }, icon('x', { size: 13 }), 'Clear filters') : null));
      api.clear(E.wmore);
      return;
    }
    for (const g of items.slice(0, S.wlimit)) E.wlist.appendChild(whereCard(g));
    api.clear(E.wmore);
    if (items.length > S.wlimit) {
      E.wmore.appendChild(h('button.btn.btn--sm', {
        type: 'button',
        onclick: () => { S.wlimit += PER; paintWhere(); },
      }, icon('chevron-down', { size: 13 }), `Show more (${(items.length - S.wlimit).toLocaleString()} left)`));
    }
  }

  function whereCard(g) {
    const k = CC.keyOf(g);
    const src = CC.artUrl(g);
    const art = h('div.cl-wg__art', icon('gamepad', { size: 22 }));
    if (src) {
      art.appendChild(h('img', { src, alt: '', loading: 'lazy', decoding: 'async',
        referrerpolicy: 'no-referrer', onerror: e => e.target.remove() }));
    }
    const favOn = isWhereFav(api, k);
    const fav = h(favOn ? 'button.cl-wg__fav.is-on' : 'button.cl-wg__fav', {
      type: 'button', 'aria-pressed': String(favOn),
      'aria-label': `${favOn ? 'Remove from' : 'Add to'} favourites: ${g.t}`,
      onclick: () => {
        const on = toggleWhereFav(api, g);
        fav.classList.toggle('is-on', on);
        fav.setAttribute('aria-pressed', String(on));
        fav.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} favourites: ${g.t}`);
        if (S.wfav && !on) paintWhere();
      },
    }, icon('heart', { size: 14 }));
    const rows = CC.where(g);
    return h('article.cl-wg', { role: 'listitem', 'data-key': k, 'aria-label': g.t },
      art,
      h('div.cl-wg__b',
        h('div.cl-wg__h',
          h('h3.cl-wg__t', { text: g.t, title: g.t }),
          fav),
        h('div.cl-wg__n', { text: `On ${rows.length} service${rows.length === 1 ? '' : 's'}` }),
        h('ul.cl-wg__svcs', rows.map(w => h('li.cl-wg__svc', { 'data-service': w.service.id },
          h('span.cl-wg__ic', { style: { background: `linear-gradient(145deg,${w.service.g1},${w.service.g2})` } },
            icon(w.service.icon, { size: 13 })),
          h('div.cl-wg__sb',
            h('b', { text: w.service.name }),
            ...w.need.map(n => h(`small.cl-need.is-${n.tone}`, { text: n.text }))),
          h('a.btn.btn--sm.cl-wg__play', {
            href: w.url, target: '_blank', rel: 'noopener noreferrer',
            'data-service': w.service.id,
            title: `Opens ${new URL(w.url).host} in a new tab`,
            'aria-label': `Play ${g.t} on ${w.service.name} (opens in a new tab)`,
          }, icon('play', { size: 12, fill: true }), h('span', { text: 'Play' }), icon('external-link', { size: 11 })))))));
  }

  function paintWhereFoot() {
    const d = CC.data();
    api.clear(E.wfoot);
    const unlisted = CC.SERVICES.filter(s => s.unlisted);
    E.wfoot.append(
      h('div.cl-where__more',
        h('small', { text: 'No public list, so not searched — look there yourself:' }),
        ...unlisted.map(s => h('a.chip', {
          href: s.home, target: '_blank', rel: 'noopener noreferrer', title: `${s.note} ${s.account}`,
          'data-service': s.id,
        }, icon(s.icon, { size: 12 }), h('span', { text: s.name }), icon('external-link', { size: 11 })))),
      h('details.cl-where__src',
        h('summary', { text: 'Where this comes from' }),
        h('small', { text: 'Each service’s own published game list, fetched by tools/sync-cloud-games.mjs and merged by title. '
          + 'They refuse to run inside another page, so Play opens the service’s own site in a new tab, where you sign in with your own account.' }),
        h('ul', CC.LISTED.map(s => {
          const src = d.sources?.[s.id];
          return h('li',
            h('b', { text: s.name }), ' ',
            h('small', { text: src
              ? `${(src.titles || 0).toLocaleString()} games · as of ${dateOf(src.asOf) || 'unknown'}${src.stale ? ' (the last update failed, so this is older)' : ''} · ${s.account}`
              : 'not in this build of the list' }));
        }))));
  }

  /* ---------- the emulated library ---------- */

  async function loadLibrary() {
    if (!E.grid) return;
    const seq = ++S.seq;
    E.abort?.abort();
    E.abort = new AbortController();
    S.busy = true;
    E.libN.textContent = 'searching…';
    api.clear(E.grid);
    for (let i = 0; i < 12; i++) E.grid.appendChild(h('div.cl-skel'));

    try {
      const res = await CD.search({
        collection: S.collection, q: S.q, page: S.page, rows: 48, signal: E.abort.signal,
      });
      if (seq !== S.seq || life.dead) return;
      S.res = res; S.err = null;
      const col = CD.COLLECTIONS.find(c => c.id === S.collection);
      E.libT.textContent = col ? col.name : 'Emulated';
      E.libN.textContent = `${res.total.toLocaleString()} title${res.total === 1 ? '' : 's'}`;
      api.clear(E.grid);
      if (!res.items.length) {
        E.grid.appendChild(h('div.empty', icon('search'),
          h('b', { text: S.q ? `Nothing in this library matches “${S.q}”` : 'This library came back empty' }),
          h('small', { text: 'Try another library, or a shorter search term.' }),
          S.q ? h('button.btn', { type: 'button', onclick: () => { S.q = ''; E.search.value = ''; loadLibrary(); } },
            icon('x', { size: 13 }), 'Clear search') : null));
        api.clear(E.pager);
        return;
      }
      for (const item of res.items) E.grid.appendChild(libCard(item));
      paintPager(res);
    } catch (err) {
      if (err?.name === 'AbortError' || life.dead || seq !== S.seq) return;
      S.err = err;
      api.clear(E.grid);
      E.libN.textContent = 'unavailable';
      E.grid.appendChild(h('div.empty', icon('alert'),
        h('b', { text: 'The archive did not answer' }),
        h('small', { text: String(err.message || err) }),
        h('button.btn', { type: 'button', onclick: loadLibrary }, icon('refresh', { size: 13 }), 'Try again')));
      api.clear(E.pager);
    } finally {
      S.busy = false;
    }
  }

  /* A stored row carries only id/title/art, so it renders from that and
     launches straight in — there is nothing to look up. */
  function savedCard(r) {
    const art = h('div.rbx-card__art',
      h('img', { src: r.art || CD.thumbUrl(r.id), alt: '', loading: 'lazy', decoding: 'async',
        referrerpolicy: 'no-referrer', onerror: e => e.target.remove() }));
    return h('div.rbx-card', {
      role: 'button', tabindex: '0',
      'aria-label': `Play ${r.title}`,
      onclick: () => play({ title: r.title, url: CD.embedUrl(r.id), kind: 'emulator',
        id: r.id, art: r.art, year: r.year }),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } },
    }, art,
      h('div.rbx-card__b',
        h('div.rbx-card__t', { text: r.title }),
        h('div.rbx-card__m', h('span.rbx-card__by', { text: r.year ? String(r.year) : 'archive.org' }))));
  }

  function libCard(item) {
    const art = h('div.rbx-card__art',
      h('img', {
        src: item.art, alt: '', loading: 'lazy', decoding: 'async',
        referrerpolicy: 'no-referrer', onerror: e => e.target.remove(),
      }));
    /* Only render a download count when the archive actually reports one —
       an invented number is worse than a missing one. */
    if (item.downloads) {
      art.appendChild(h('div.rbx-card__live', icon('download', { size: 10 }),
        h('span', { text: compact(item.downloads) })));
    }
    const fav = h('button.rbx-card__fav', {
      type: 'button',
      'aria-label': `${isFav(api, item.id) ? 'Remove from' : 'Add to'} favourites: ${item.title}`,
      'aria-pressed': String(isFav(api, item.id)),
      onclick: e => {
        e.stopPropagation();
        const on = toggleFav(api, item);
        fav.classList.toggle('is-on', on);
        fav.setAttribute('aria-pressed', String(on));
      },
    }, icon('heart', { size: 13 }));
    if (isFav(api, item.id)) fav.classList.add('is-on');
    art.appendChild(fav);

    return h('div.rbx-card', {
      role: 'button', tabindex: '0',
      'aria-label': `Play ${item.title}`,
      onclick: () => play({ title: item.title, url: item.embed, kind: 'emulator',
        id: item.id, art: item.art, year: item.year,
        note: item.year ? `Published ${item.year}. Emulated in the browser by the Internet Archive.` : '' }),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } },
    }, art,
      h('div.rbx-card__b',
        h('div.rbx-card__t', { text: item.title }),
        h('div.rbx-card__m', h('span.rbx-card__by', { text: item.year ? String(item.year) : 'archive.org' }))));
  }

  function paintPager(res) {
    api.clear(E.pager);
    const pages = Math.max(1, Math.ceil(res.total / 48));
    if (pages <= 1) return;
    const go = p => { S.page = p; loadLibrary(); E.grid.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    E.pager.append(
      h('button.btn.btn--sm', { type: 'button', disabled: S.page <= 1 ? '' : null, onclick: () => go(S.page - 1) },
        icon('chevron-left', { size: 13 }), 'Back'),
      h('span.cx__pager-n', { text: `Page ${S.page} of ${pages.toLocaleString()}` }),
      h('button.btn.btn--sm', { type: 'button', disabled: S.page >= pages ? '' : null, onclick: () => go(S.page + 1) },
        'Next', icon('chevron-right', { size: 13 })));
  }

  /* ---------- the play stage ---------- */

  function play(what) {
    if (what.kind === 'emulator' && what.id) notePlayed(api, what);
    S.playing = what;
    S.view = 'play';
    paint();
  }

  function stage() {
    const what = S.playing;
    const frame = h('iframe.cl__frame', {
      title: what.title,
      referrerpolicy: 'no-referrer',
      allow: 'autoplay; fullscreen; gamepad; clipboard-write; encrypted-media; microphone; camera; picture-in-picture',
      allowfullscreen: '',
    });
    const veil = h('div.px2__veil', h('div.spinner'),
      h('small', { text: `Starting ${what.title}…` }));
    let settled = false;
    const done = () => { if (settled) return; settled = true; veil.remove(); };
    frame.addEventListener('load', done, { once: true });

    /* These are third-party mirrors; when one has gone away the frame just
       never loads, so say so rather than spinning forever. */
    const timer = setTimeout(() => {
      if (settled) return;
      done();
      wrap.appendChild(h('div.px2__overlay',
        h('div.empty', icon('alert'),
          h('b', { text: `${what.title} did not start` }),
          h('small', { text: 'This is a third-party service and it may be down, busy, or gone. '
            + 'Nothing here is run by Static.' }),
          h('button.btn', {
            type: 'button',
            onclick: () => {
              frame.src = what.via === 'tunnel' && UV.isReady() ? UV.encode(what.url) : what.url;
            },
          }, icon('refresh', { size: 13 }), 'Try again'))));
    }, 30000);
    life.add(() => clearTimeout(timer));

    const wrap = h('div.cl__stagewrap', frame, veil);

    /* A 'tunnel' surface refuses to be framed directly — the only reason it
       renders at all is that the service worker serves it from our origin.
       Setting .src to the raw URL would give a silently blank frame, which
       is exactly the failure other sites ship. */
    if (what.via === 'tunnel') {
      (async () => {
        const support = UV.isSupported();
        if (!support.ok) { done(); wrap.appendChild(tunnelDown(support.why, false)); return; }
        const up = await UV.boot();
        if (life.dead) return;
        if (!up) {
          done();
          const st = UV.status();
          wrap.appendChild(tunnelDown(st.error ? String(st.error.message || st.error) : `Tunnel ${st.phase}.`));
          return;
        }
        frame.src = UV.encode(what.url);
      })();
    } else {
      frame.src = what.url;
    }

    return h('div.cl__stage',
      h('div.cl__bar',
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: () => { S.view = 'home'; S.playing = null; paint(); },
        }, icon('arrow-left', { size: 13 }), 'Back'),
        h('b.cl__title', { text: what.title }),
        what.note ? h('small.dim.cl__note', { text: what.note }) : null,
        h('div.grow'),
        h('button.ibtn.tip', {
          type: 'button', 'data-tip': 'Reload', 'aria-label': 'Reload',
          onclick: () => {
            frame.src = what.via === 'tunnel' && UV.isReady() ? UV.encode(what.url) : what.url;
          },
        }, icon('refresh')),
        h('button.ibtn.tip', {
          type: 'button', 'data-tip': 'Fill the window', 'aria-label': 'Fill the window',
          onclick: e => e.currentTarget.closest('.cl__stage').classList.toggle('is-full'),
        }, icon('maximize-2'))),
      wrap);
  }

  function tunnelDown(why, retry = true) {
    return h('div.px2__overlay',
      h('div.empty', icon('shield'),
        h('b', { text: 'This one needs the Static tunnel' }),
        h('small', { text: why }),
        h('small.dim', { text: 'The player refuses to be placed in another page. The tunnel gets '
          + 'past that by serving it from Static’s own origin — without it there is nothing to show.' }),
        h('div.px2__altrow',
          retry ? h('button.btn', { type: 'button', onclick: () => paint() },
            icon('refresh', { size: 13 }), 'Try again') : null,
          h('a.btn.btn--ghost', {
            href: LOCAL_PROXY_URL,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, icon('shield', { size: 13 }), 'Open Proxy on localhost'))));
  }

  /* ---------- the honest footer ---------- */

  function blockedPanel() {
    return h('div.cx__sec',
      h('div.card',
        h('div.card__head', icon('shield'), h('div.card__t', { text: 'Probed, and genuinely refused' })),
        h('small.dim', {
          text: 'Each of these was loaded in a real browser frame, which is the only test that counts. '
              + 'Several pass a header check and still fail, because the landing page hands off to a '
              + 'player on another host that does send the header — that is exactly how the now.gg '
              + 'mirror fools you, and why the Roblox tile on other sites that copy it is a dead frame.',
        }),
        h('div.cl__blocked', CD.BLOCKED.map(([name, host, why]) =>
          h('div.cl__blockedrow',
            h('b', { text: name }),
            h('code', { text: host }),
            h('small', { text: why }))))));
  }
}

export default { buildCloud };
