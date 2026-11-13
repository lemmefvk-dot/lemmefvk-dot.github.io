/* ============================================================
   search.js — the Static search engine.

   One route, two layouts:
     ?q= empty   → the landing block (big mark, one box, trending)
     ?q= set     → instant answer · results · knowledge panel

   Every result url is kept EXACTLY as providers.searchWeb() handed
   it over — only the display is prettified — and every open goes
   through navigate(), so the day providers.config.mode flips to
   'proxy' this page fronts it without a line changing here.
   ============================================================ */

import { BRAND, SCHEMES } from './brand.js';

/** Must match providers.searchWeb()'s page size. */
const PER_PAGE = 8;

const NAV = [
  ['Home',   'static://home',   'home'],
  ['Games',  'static://games',  'gamepad'],
  ['Movies', 'static://movies', 'film'],
  ['Anime',  'static://anime',  'star'],
  ['Search', 'static://search', 'search'],
  ['Proxy',   'static://proxy',  'shield'],
];

/** The result kinds providers.searchWeb() can return. */
const KIND = {
  game:  { label: 'Game',   icon: 'gamepad',   badge: 'badge--accent' },
  movie: { label: 'Movie',  icon: 'film',      badge: 'badge--ok' },
  anime: { label: 'Anime',  icon: 'star',      badge: 'badge--warn' },
  manga: { label: 'Manga',  icon: 'file-text', badge: 'badge--warn' },
  page:  { label: BRAND.name, icon: BRAND.icon, badge: 'badge--accent' },
  web:   { label: 'Web',    icon: 'globe',     badge: '' },
};
const kindOf = k => KIND[k] || KIND.web;

/** The kinds the portal holds itself; everything else is "the web". */
const MEDIA_KINDS = ['game', 'movie', 'anime', 'manga', 'roblox'];

/* `match` is null on the All tab and a predicate on the others, so an
   unexpected kind still lands somewhere instead of vanishing. `noun` is what
   a row of this tab is called when it is counted; every one of them takes a
   plain -s, so one rule covers the lot. */
const TABS = [
  { id: 'all',   name: 'All',    icon: 'grid-9',  noun: 'result',     match: null },
  { id: 'game',  name: 'Games',  icon: 'gamepad', noun: 'game',       match: r => r.kind === 'game' },
  { id: 'movie', name: 'Movies', icon: 'film',    noun: 'movie',      match: r => r.kind === 'movie' },
  { id: 'anime', name: 'Anime',  icon: 'star',    noun: 'anime title', match: r => r.kind === 'anime' || r.kind === 'manga' },
  { id: 'roblox', name: 'Roblox', icon: 'box',    noun: 'experience', match: r => r.kind === 'roblox' },
  { id: 'web',   name: 'Web',    icon: 'globe',   noun: 'web result', match: r => !MEDIA_KINDS.includes(r.kind) },
];

/** "1 game" / "3 games" — never "1 games". */
const counted = (tab, n) => `${n} ${tab.noun}${n === 1 ? '' : 's'}`;

const TAB_KEY = 'Static.searchTab';
const searchUrl = q => `static://search?q=${encodeURIComponent(q)}`;
const decodeSafe = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };

/** The last path segment of a static:// url — a game/anime/movie id. */
function idOf(url) {
  const parts = String(url || '').split(/[?#]/)[0].split('/');
  return decodeSafe(parts[parts.length - 1] || '');
}

/**
 * A url a human can read. The portal schemes become a breadcrumb —
 * `aether › games › slope` — and the open web loses its scheme, its
 * `www.` and its query, like every other search engine. The url itself
 * is never touched; this is display only.
 */
function prettyUrl(url) {
  const s = String(url || '');
  const m = s.match(/^([a-z][\w+.-]*):\/\/(.*)$/i);
  if (!m) return s;
  const scheme = m[1].toLowerCase();
  const parts = m[2].split(/[?#]/)[0].split('/').filter(Boolean).map(decodeSafe);
  if (scheme === 'http' || scheme === 'https') {
    const host = (parts.shift() || '').replace(/^www\./, '');
    return [host, ...parts].join(' › ');
  }
  /* static:// and static:// are the same portal — show it under one name. */
  const head = SCHEMES.includes(scheme) ? BRAND.short : scheme;
  return [head, ...parts].join(' › ');
}

/* ============================================================ */

export function buildSearch(ctx) {
  const { api, providers, navigate } = ctx;
  const { h, icon, notify, store } = api;
  const listen = api.on || ((t, e, fn) => {
    t.addEventListener(e, fn);
    return () => t.removeEventListener(e, fn);
  });

  const S = {
    q: String(ctx.query || '').trim(),
    tab: 'all',
    page: 1,
    data: null,
    loading: false,
    error: null,
    /** '' | 'loading' | 'failed' — the 7,963-title anime fetch. */
    catalogue: '',
    catalogueErr: null,
  };
  try { S.tab = store.get(TAB_KEY, 'all'); } catch (e) { /* defaults are fine */ }
  if (!TABS.some(t => t.id === S.tab)) S.tab = 'all';
  /* Restoring the Anime tab without its catalogue would show an empty tab on
     arrival, so that one only sticks once the 7,963 titles are in memory. */
  if (S.tab === 'anime' && !providers.bigCatalogue.isLoaded('anime')) S.tab = 'all';

  let seq = 0;   // guards late provider answers against a newer search

  const root = h('div.cx');
  const srch = h('div.cx-srch', { style: { flex: '1 1 auto' } });
  const head = h('div.cx-srch__head');
  const body = h('div', {
    style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: '0' },
  });
  srch.append(head, body);
  root.appendChild(srch);

  /* ---------------------------------------------------------- *
   *  the one search box — shared by both layouts
   * ---------------------------------------------------------- */
  const input = h('input', {
    type: 'text', value: S.q, placeholder: 'Search for anything!',
    spellcheck: 'false', autocomplete: 'off', enterkeyhint: 'search',
    autofocus: true, 'aria-label': `Search ${BRAND.name}`,
    oninput: () => paintClear(),
  });
  const clearBtn = h('button.ibtn', {
    type: 'button', 'aria-label': 'Clear the search box',
    onclick: () => { input.value = ''; paintClear(); input.focus(); },
  }, icon('x'));
  const form = h('form.field.cx-srch__form', {
    role: 'search',
    onsubmit: e => { e.preventDefault(); submit(); },
  }, icon('search'), input, clearBtn);

  const luckyBtn = h('button.btn.btn--ghost.btn--sm', {
    type: 'button', title: 'Open the top result straight away',
    onclick: () => lucky(),
  }, icon('sparkles'), 'Feeling lucky');

  function paintClear() {
    clearBtn.classList.toggle('hidden', !input.value);
  }
  paintClear();

  function submit() {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    if (v === S.q) { S.page = 1; run(); return; }   // same query — just re-run
    navigate(searchUrl(v));                          // lands in history + address bar
  }

  async function lucky() {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    /* S.data only ever holds the page we fetched, so a cached first row is
       only the top result when we are actually on page 1. */
    const cached = S.data && S.data.query === v && (S.data.page || 1) === 1
      ? S.data.results[0] : null;
    if (cached) { navigate(cached.url); return; }
    luckyBtn.disabled = true;
    try {
      const d = await providers.searchWeb(v, { page: 1 });
      if (d.results.length) navigate(d.results[0].url);
      else notify({ app: BRAND.name, title: 'No luck', icon: 'search',
        message: `Nothing matches “${v}” yet.` });
    } catch (err) {
      notify({ app: BRAND.name, title: 'Search is offline', icon: 'alert',
        message: err && err.message ? err.message : 'The provider did not answer.' });
    } finally {
      luckyBtn.disabled = false;
    }
  }

  async function copy(text) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(String(text));
      notify({ app: BRAND.name, title: 'Copied', message: String(text), icon: 'copy' });
    } catch (e) {
      notify({ app: BRAND.name, title: 'Could not copy', icon: 'alert',
        message: 'This browser refused clipboard access.' });
    }
  }

  /* ---------------------------------------------------------- *
   *  shared chrome
   * ---------------------------------------------------------- */
  function navStrip(current) {
    return h('div.cx__nav', { role: 'navigation', 'aria-label': BRAND.name },
      NAV.map(([label, url, ic]) => {
        const isOn = url === current;
        return h('button', {
          type: 'button', class: isOn ? 'is-on' : null,
          'aria-current': isOn ? 'page' : null,
          onclick: () => navigate(url),
        }, icon(ic), h('span', { text: label }));
      }));
  }

  function mark(big) {
    return h('button.cx__mark', {
      type: 'button', title: `${BRAND.name} start page`,
      'aria-label': `${BRAND.name} start page`,
      style: big ? { fontSize: 'var(--fs-48)', gap: 'var(--sp-4)' } : null,
      onclick: () => navigate('static://home'),
    }, icon(BRAND.icon, big ? { size: 40 } : null), h('span', { text: BRAND.wordmark }));
  }

  function section(title, ic, count, ...kids) {
    return h('div.cx__sec',
      h('div.cx__sec-h', icon(ic), h('div.cx__sec-t', { text: title }),
        count ? h('div.cx__sec-n', { text: count }) : null),
      ...kids);
  }

  function downBlock(err, retry, title, flush) {
    const provider = err && err.name === 'ProviderError';
    return h('div.cx-down', { style: flush ? { margin: '0' } : null },
      icon('alert'),
      h('div',
        h('b', { text: title || `${BRAND.name} search could not answer` }),
        h('small', { text: (err && err.message) || 'The provider did not answer.' }),
        h('small', { text: provider
          ? `${BRAND.name} is running against providers.js in local mode; set `
            + 'config.endpoint and config.mode = "proxy" to point it at a real backend.'
          : 'Nothing was lost — the query is still in the box.' }),
        h('button.btn.btn--sm', { type: 'button', style: { marginTop: 'var(--sp-4)' },
          onclick: retry }, icon('refresh'), 'Retry')));
  }

  function skelLine(width, height) {
    return h('div.cx-skel.cx-skel--line', { style: { width, height: height || null } });
  }

  /* ---------------------------------------------------------- *
   *  fetch
   * ---------------------------------------------------------- */
  async function run() {
    if (!S.q) return;
    const token = ++seq;
    S.loading = true;
    S.error = null;
    paintBody();
    try {
      const data = await providers.searchWeb(S.q, { page: S.page });
      if (token !== seq || !root.isConnected) return;
      S.data = data;
      S.page = data.page || S.page;
      S.loading = false;
      paintBody();
    } catch (err) {
      if (token !== seq || !root.isConnected) return;
      S.loading = false;
      S.error = err;
      paintBody();
    }
  }

  const totalPages = () =>
    Math.max(1, Math.ceil(((S.data && S.data.total) || 0) / PER_PAGE));

  const allResults = () => (S.data && S.data.results) || [];

  function shown() {
    const tab = TABS.find(t => t.id === S.tab) || TABS[0];
    return tab.match ? allResults().filter(tab.match) : allResults();
  }

  function countFor(tab) {
    const rows = allResults();
    return tab.match ? rows.filter(tab.match).length : rows.length;
  }

  async function pickTab(id) {
    const needsCatalogue = id === 'anime' && !providers.bigCatalogue.isLoaded('anime');
    if (id === S.tab && !needsCatalogue) return;
    S.tab = id;
    /* A tab's matches are spread over every page, so a tab switch always
       returns to page 1 — otherwise the rows it is filtering for may all sit
       on a page the user is no longer on, and there would be nothing to click. */
    try { store.set(TAB_KEY, id); } catch (e) { /* not fatal */ }
    /* a failed anime load must not keep its banner on the other tabs */
    if (!needsCatalogue && S.catalogue) { S.catalogue = ''; S.catalogueErr = null; }
    if (!needsCatalogue) {
      /* A tab's matches are spread over every page, and S.data only holds the
         page we fetched. So a tab switch off page 1 must go back and REFETCH,
         not merely re-filter what is in hand — otherwise the rows this tab
         wants stay on a page we are no longer showing. */
      if (S.page !== 1) { S.page = 1; run(); scrollToTop(); }
      else paintBody();
      return;
    }
    S.page = 1;

    /* The Anime tab is the one deliberate 7.9 MB fetch: load it, then
       re-run the search so all 7,963 titles are in the index. */
    S.catalogue = 'loading';
    S.catalogueErr = null;
    paintBody();
    try {
      await providers.bigCatalogue.load('anime');
      if (!root.isConnected) return;
      S.catalogue = '';
      S.page = 1;          /* folding 7,963 titles in re-ranks everything */
      await run();
    } catch (err) {
      if (!root.isConnected) return;
      S.catalogue = 'failed';
      S.catalogueErr = err;
      paintBody();
    }
  }

  function goPage(n) {
    const pages = totalPages();
    const next = Math.min(Math.max(1, n), pages);
    if (next === S.page) return;
    S.page = next;
    run();
    scrollToTop();
  }

  function scrollToTop() {
    let el = root.parentElement;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
        el.scrollTop = 0;
        return;
      }
      el = el.parentElement;
    }
  }

  /* ---------------------------------------------------------- *
   *  results layout
   * ---------------------------------------------------------- */
  function paintBody() {
    /* keep keyboard focus on the tab strip across a repaint */
    const held = body.contains(document.activeElement) && document.activeElement.dataset
      ? document.activeElement.dataset.tab : null;

    api.clear(body);
    if (S.error) {
      body.appendChild(downBlock(S.error, () => run(), `${BRAND.name} search is offline`));
      return;
    }
    /* .cx-srch__wrap does not wrap in CSS, and .cx-srch__side is a rigid
       268px — so at the 520px window minimum the results column was squeezed
       to 190px and the side panel ended up WIDER than the results. Let the
       side drop below once the results cannot hold 260px (see resultsCol).
       Above ~580px nothing moves: at 620 the columns still come out 290+268. */
    body.append(tabsRow(), statRow(),
      h('div.cx-srch__wrap', { style: { flexWrap: 'wrap' } }, resultsCol(), sideCol()));

    if (held) {
      const back = body.querySelector(`[data-tab="${held}"]`);
      if (back) back.focus();
    }
  }

  function tabsRow() {
    const el = h('div.cx-srch__tabs', { role: 'group', 'aria-label': 'Filter results' });
    for (const t of TABS) {
      const ready = !!S.data && !S.loading;
      const n = ready ? countFor(t) : null;
      const isOn = t.id === S.tab;
      const b = h('button', {
        type: 'button', dataset: { tab: t.id },
        class: isOn ? 'is-on' : null,
        'aria-pressed': isOn ? 'true' : 'false',
        title: t.id === 'anime' && !providers.bigCatalogue.isLoaded('anime')
          ? 'Loads the full anime catalogue, then searches all of it'
          : n === null ? `Show ${t.noun}s`
            : `${counted(t, n)} on this page`,
        onclick: () => pickTab(t.id),
      }, icon(t.icon), h('span', { text: t.name }),
        n === null ? null : h('span.badge', { class: isOn ? 'badge--accent' : null, text: String(n) }));
      el.appendChild(b);
    }
    return el;
  }

  function statRow() {
    const el = h('div.cx-srch__stat', { role: 'status' });
    if (S.catalogue === 'loading') {
      el.textContent = 'Fetching the full anime catalogue — 7,963 titles.';
      return el;
    }
    if (S.loading || !S.data) {
      el.textContent = `Searching for “${S.q}”…`;
      return el;
    }
    const d = S.data;
    const secs = ((d.took || 0) / 1000).toFixed(2);
    const bits = [`About ${(d.total || 0).toLocaleString()} result${d.total === 1 ? '' : 's'} (${secs} seconds)`];
    const pages = totalPages();
    if (pages > 1) bits.push(`page ${d.page || S.page} of ${pages}`);
    const tab = TABS.find(t => t.id === S.tab);
    if (tab && tab.match) bits.push(`${counted(tab, shown().length)} on this page`);
    el.textContent = bits.join(' · ');
    return el;
  }

  function resultsCol() {
    /* The CSS flex-basis is `auto`, i.e. the max-content width of a results
       list — with wrapping on, that would push the side panel onto its own
       line at any width under ~950px. Pinning the basis to the narrowest
       results column worth showing makes the wrap depend on that number
       instead, and the column still grows to its 620px max-width. */
    const col = h('div.cx-srch__col', { style: { flexBasis: '260px' } });

    if (S.catalogue === 'loading') {
      col.appendChild(h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', padding: 'var(--sp-6) 0' },
      }, h('div.spinner'), h('div',
        h('div', { text: 'Loading the anime catalogue…',
          style: { fontSize: 'var(--fs-12)', color: 'var(--ink-1)' } }),
        h('small.dim', { text: '7,963 titles, fetched once and then kept in memory.',
          style: { fontSize: 'var(--fs-10)' } }))));
      col.appendChild(skelResults(3));
      return col;
    }
    if (S.catalogue === 'failed') {
      col.appendChild(downBlock(S.catalogueErr, () => pickTab('anime'),
        'The anime catalogue would not load', true));
    }
    if (S.loading || !S.data) {
      col.appendChild(skelResults(5));
      return col;
    }

    if (S.data.answer && (S.data.page || 1) === 1) col.appendChild(answerCard(S.data.answer));

    const rows = shown();
    if (!rows.length) {
      col.appendChild(noResults());
      /* Still offer the pager: the rows this tab wants may simply be on
         another page, and without it there is no way back to them. */
      const escape = pagerRow();
      if (escape) col.appendChild(escape);
      return col;
    }

    col.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column' } },
      rows.map(resultRow)));
    const pager = pagerRow();
    if (pager) col.appendChild(pager);
    return col;
  }

  /** Result-shaped placeholders, stacked on the same rhythm as real rows. */
  function skelResults(n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(h('div', { style: { padding: 'var(--sp-3) 0' } },
        skelLine('150px', '8px'),
        skelLine('68%', '15px'),
        skelLine('100%'),
        skelLine('84%')));
    }
    return h('div', { style: { display: 'flex', flexDirection: 'column' } }, rows);
  }

  function answerCard(ans) {
    return h('div.cx-ans',
      h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-4)' } },
        h('div', { style: { minWidth: '0', flex: '1 1 auto' } },
          h('div.cx-ans__k', { text: String(ans.kind || 'answer').toUpperCase() }),
          h('div.cx-ans__l', { text: String(ans.label || '') }),
          h('div.cx-ans__v.trunc', { text: String(ans.value) })),
        h('button.ibtn', { type: 'button', 'aria-label': 'Copy the answer',
          title: 'Copy', onclick: () => copy(ans.value) }, icon('copy'))));
  }

  function resultRow(r) {
    const k = kindOf(r.kind);
    const urlLine = h('div.cx-res__u',
      icon(r.icon && KIND[r.kind] ? r.icon : k.icon),
      h('span', { text: prettyUrl(r.url) }),
      r.external ? icon('external-link', { size: 10 }) : null,
      h('span.badge.cx-res__k', { class: k.badge || null, text: k.label }));
    const titleLine = h('div.cx-res__t', { text: r.title });
    const snipLine = r.snippet ? h('div.cx-res__s', { text: r.snippet }) : null;

    const btn = h('button.cx-res', {
      type: 'button', title: r.url,
      onclick: () => navigate(r.url),
    });

    if (r.image && (r.kind === 'anime' || r.kind === 'manga')) {
      btn.style.flexDirection = 'row';
      btn.style.alignItems = 'flex-start';
      btn.style.gap = 'var(--sp-4)';
      btn.append(
        thumb(r.image, r.title, r.kind),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px',
          minWidth: '0', flex: '1 1 auto' } }, urlLine, titleLine, snipLine));
    } else {
      btn.append(urlLine, titleLine, snipLine);
    }
    return btn;
  }

  /** 44×62 poster thumb: the real MAL image over the procedural art. */
  function thumb(src, alt, kind) {
    return h('div', {
      style: {
        '--art': providers.artFor(alt || '', kind), background: 'var(--art)',
        backgroundSize: 'cover', position: 'relative', flex: '0 0 44px',
        width: '44px', height: '62px', borderRadius: 'var(--r-xs)',
        overflow: 'hidden', border: '1px solid var(--line-1)',
      },
    }, h('img', {
      src, alt: '', loading: 'lazy', decoding: 'async',
      style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' },
      onerror: e => { e.currentTarget.style.display = 'none'; },
    }));
  }

  function noResults() {
    const q = (S.data && S.data.query) || S.q;
    const tab = TABS.find(t => t.id === S.tab) || TABS[0];
    const total = (S.data && S.data.total) || 0;
    const filtered = !!tab.match && total > 0;

    const noCatalogue = !providers.bigCatalogue.isLoaded('anime');
    let hint;
    if (S.tab === 'anime' && noCatalogue) {
      hint = 'The 7,963-title anime catalogue is not in memory — press the Anime tab '
           + 'again to fetch it and search all of it.';
    } else if (filtered) {
      hint = `Nothing of that kind on this page — the All tab has `
           + `${total.toLocaleString()} result${total === 1 ? '' : 's'}.`;
    } else if (noCatalogue) {
      hint = 'The 7,963-title anime catalogue has not been loaded yet — open the '
           + 'Anime tab to fold it into this search.';
    } else {
      hint = 'Check the spelling, use fewer words, or browse a category instead.';
    }

    return h('div.empty',
      icon('search'),
      h('b', { text: filtered ? `No ${tab.name.toLowerCase()} for “${q}”` : `No results for “${q}”` }),
      h('small', { text: hint }),
      h('div.row', { style: { flexWrap: 'wrap', justifyContent: 'center' } },
        h('button.btn.btn--sm', { type: 'button',
          title: 'Open the games library, which has its own filter',
          onclick: () => navigate('static://games') }, icon('gamepad'), 'Search games'),
        h('button.btn.btn--sm', { type: 'button',
          title: `Runs “${q}” against the whole anime catalogue`,
          onclick: () => navigate(`static://anime?q=${encodeURIComponent(q)}`) },
          icon('star'), 'Search anime'),
        h('button.btn.btn--ghost.btn--sm', { type: 'button',
          title: 'Empty the box and go back to the start page',
          onclick: () => { input.value = ''; paintClear(); navigate('static://search'); } },
          icon('x'), 'Clear')));
  }

  function pagerRow() {
    const pages = totalPages();
    if (pages <= 1) return null;
    const cur = (S.data && S.data.page) || S.page;
    const el = h('div.cx-pages', { role: 'navigation', 'aria-label': 'Result pages' });

    el.appendChild(h('button', { type: 'button', 'aria-label': 'Previous page',
      disabled: cur <= 1, onclick: () => goPage(cur - 1) }, icon('chevron-left')));
    for (const n of pageWindow(cur, pages)) {
      if (typeof n === 'string') {
        el.appendChild(h('span.dim', { text: n, style: { padding: '0 var(--sp-2)' } }));
        continue;
      }
      const b = h('button', {
        type: 'button', 'aria-label': `Page ${n}`,
        class: n === cur ? 'is-on' : null,
        'aria-current': n === cur ? 'page' : null,
        onclick: () => goPage(n),
      }, String(n));
      el.appendChild(b);
    }
    el.appendChild(h('button', { type: 'button', 'aria-label': 'Next page',
      disabled: cur >= pages, onclick: () => goPage(cur + 1) }, icon('chevron-right')));
    return el;
  }

  function pageWindow(cur, pages) {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    const out = [1];
    if (cur > 3) out.push('…');
    for (let i = Math.max(2, cur - 1); i <= Math.min(pages - 1, cur + 1); i++) out.push(i);
    if (cur < pages - 2) out.push('…');
    out.push(pages);
    return out;
  }

  /* ---------------------------------------------------------- *
   *  right column — knowledge panel, related, shortcuts
   * ---------------------------------------------------------- */
  const PANEL_KINDS = ['game', 'anime', 'movie', 'manga'];

  function sideCol() {
    const side = h('div.cx-srch__side');
    if (S.catalogue === 'loading' || S.loading || !S.data) {
      side.appendChild(panelSkel());
      return side;
    }
    /* A surprise in one catalogue record must never cost the results list. */
    let panel = null;
    try { panel = knowledgePanel(); } catch (e) { panel = null; }
    if (panel) side.appendChild(panel);
    const rel = relatedCard();
    if (rel) side.appendChild(rel);
    side.appendChild(shortcutsCard());
    return side;
  }

  function panelSkel() {
    return h('div.cx-panel',
      h('div.cx-skel', { style: { height: '112px', borderRadius: '0' } }),
      h('div.cx-panel__in', skelLine('60%', '13px'), skelLine('100%'), skelLine('100%'), skelLine('78%')));
  }

  function knowledgePanel() {
    /* Prefer something from the tab the reader is actually looking at. */
    const pick = rows => rows.find(r => PANEL_KINDS.includes(r.kind));
    const hit = pick(shown()) || pick(allResults());
    if (!hit) return null;
    const rec = recordFor(hit);
    const title = rec ? rec.title : hit.title;
    const art = providers.artFor(title, hit.kind === 'movie' ? 'movie' : hit.kind);

    const artEl = h('div.cx-panel__art', { style: { '--art': art } });
    if (rec && rec.image) {
      artEl.style.position = 'relative';
      artEl.appendChild(h('img', {
        src: rec.image, alt: '', loading: 'lazy', decoding: 'async',
        style: { position: 'absolute', inset: '0', width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: 'center 22%' },
        onerror: e => { e.currentTarget.style.display = 'none'; },
      }));
    }

    const rows = factsFor(hit, rec);
    const open = openLabelFor(hit.kind);
    return h('div.cx-panel',
      artEl,
      h('div.cx-panel__in',
        h('div.cx-panel__t', { text: title }),
        h('div.cx-panel__row',
          h('span', { text: 'Kind' }),
          h('b', { text: kindOf(hit.kind).label })),
        rows.map(([k, v]) => h('div.cx-panel__row', h('span', { text: k }), h('b', { text: v }))),
        h('button.btn.btn--primary.btn--block', { type: 'button', style: { marginTop: 'var(--sp-2)' },
          onclick: () => navigate(hit.url) },
          icon(open[1], open[1] === 'play' ? { fill: true } : null), open[0])));
  }

  function recordFor(r) {
    const id = idOf(r.url);
    try {
      if (r.kind === 'game') return providers.getGame(id);
      if (r.kind === 'movie') return providers.getMovie(id);
      if (r.kind === 'anime' || r.kind === 'manga') return providers.bigCatalogue.byId(id, r.kind);
    } catch (e) { /* fall through to the result itself */ }
    return null;
  }

  function factsFor(r, rec) {
    const out = [];
    if (!rec) { out.push(['Source', prettyUrl(r.url)]); return out; }
    if (r.kind === 'game') {
      out.push(['Studio', rec.studio]);
      out.push(['Plays', `${providers.fmtPlays(rec.plays)} plays`]);
      out.push(['Rating', `★ ${rec.rating.toFixed(1)}`]);
      if (rec.cats && rec.cats.length) out.push(['Categories', rec.cats.join(', ')]);
      out.push([`Plays in ${BRAND.name}`, rec.embed ? 'Yes' : 'No']);
      return out;
    }
    if (r.kind === 'movie') {
      out.push(['Year', String(rec.year)]);
      out.push(['Runtime', `${rec.runtime} min`]);
      if (rec.genres && rec.genres.length) out.push(['Genres', rec.genres.join(', ')]);
      out.push(['Rating', `★ ${rec.rating.toFixed(1)}`]);
      return out;
    }
    if (rec.score) out.push(['Score', `★ ${rec.score}`]);
    if (rec.mediaType) out.push(['Type', rec.mediaType]);
    if (rec.episodes) out.push(['Episodes', String(rec.episodes)]);
    if (rec.chapters) out.push(['Chapters', String(rec.chapters)]);
    if (rec.status) out.push(['Status', rec.status]);
    if (rec.year) {
      out.push(rec.season ? ['Aired', `${rec.season} ${rec.year}`] : ['Year', String(rec.year)]);
    }
    if (rec.genres && rec.genres.length) out.push(['Genres', rec.genres.slice(0, 3).join(', ')]);
    if (rec.malId) out.push(['MyAnimeList', `#${rec.malId}`]);
    return out;
  }

  function openLabelFor(kind) {
    if (kind === 'game') return ['Play now', 'play'];
    if (kind === 'movie') return [`Open in ${BRAND.name}`, 'film'];
    if (kind === 'manga') return [`Open in ${BRAND.name}`, 'file-text'];
    return [`Open in ${BRAND.name}`, 'star'];
  }

  function relatedCard() {
    const rels = (S.data && S.data.related) || [];
    if (!rels.length) return null;
    return h('div.card',
      h('div.card__head', icon('search'), h('div.card__t', { text: 'Related searches' })),
      h('div.cx-rel', rels.map(q => h('button', {
        type: 'button', onclick: () => navigate(searchUrl(q)),
      }, icon('search'), h('span', { text: q })))));
  }

  /** The real row count once a catalogue is in memory, its documented size before. */
  function catalogueSize(kind, documented) {
    const rows = providers.bigCatalogue.peek(kind);
    return rows ? rows.length.toLocaleString() : documented;
  }

  function shortcutsCard() {
    const item = (label, sub, ic, url) => h('button.list__item', {
      type: 'button', onclick: () => navigate(url),
    }, icon(ic), h('div', { style: { minWidth: '0' } },
      h('b', { text: label }), h('small', { text: sub })));

    return h('div.card',
      h('div.card__head', icon('chevrons-right'), h('div.card__t', { text: 'Jump to' })),
      h('div.list',
        item('Games', `${providers.GAMES.length} titles, playable in the page`, 'gamepad', 'static://games'),
        item('Anime', `${catalogueSize('anime', '7,963')} titles · ${catalogueSize('manga', '1,200')} manga`,
          'star', 'static://anime'),
        item('Proxy', `How ${BRAND.name} will reach the open web`, 'shield', 'static://proxy')));
  }

  /* ---------------------------------------------------------- *
   *  landing layout — empty query
   * ---------------------------------------------------------- */
  function paintLanding() {
    head.appendChild(navStrip('static://search'));

    const hero = h('div', {
      style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        gap: 'var(--sp-5)', padding: 'var(--sp-8) var(--sp-6) var(--sp-6)' },
    },
      mark(true),
      h('div.dim', {
        text: `Games, movies, ${catalogueSize('anime', '7,963')} anime and the open web — one box.`,
        style: { fontSize: 'var(--fs-11)' },
      }),
      h('div', { style: { display: 'flex', width: '100%', maxWidth: '520px' } }, form),
      h('div.row', { style: { justifyContent: 'center' } }, luckyBtn));

    const trend = h('div');
    body.append(hero, trend);
    loadTrending(trend);
  }

  async function loadTrending(mount) {
    api.render(mount,
      section('Trending searches', 'trending-up', null,
        h('div.cx-rel', Array.from({ length: 6 }, () =>
          h('div.cx-skel', { style: { width: '110px', height: '26px', borderRadius: 'var(--r-pill)' } })))),
      section('Popular games', 'gamepad', null, skelRail(6, false)),
      section('Trending now', 'film', null, skelRail(6, true)));

    try {
      const t = await providers.trending();
      if (!root.isConnected) return;
      const queries = t.queries || [];
      const games = t.games || [];
      const movies = t.movies || [];
      api.render(mount,
        queries.length ? section('Trending searches', 'trending-up', `${queries.length} right now`,
          h('div.cx-rel', queries.map(q => h('button', {
            type: 'button', onclick: () => navigate(searchUrl(q)),
          }, icon('search'), h('span', { text: q }))))) : null,
        games.length ? section('Popular games', 'gamepad', `${games.length} of ${providers.GAMES.length}`,
          h('div.cx__grid.cx__grid--rail', games.map(g => mediaCard(g, 'game')))) : null,
        movies.length ? section('Trending now', 'film', `${movies.length} of ${providers.MOVIES.length}`,
          h('div.cx__grid.cx__grid--rail', movies.map(m => mediaCard(m, 'movie')))) : null,
        h('div.cx__sec', h('small.dim', {
          text: `Nothing here leaves the machine yet — ${BRAND.name} answers from `
              + 'providers.js until the proxy is wired up.',
          style: { fontSize: 'var(--fs-10)' },
        })));
    } catch (err) {
      if (!root.isConnected) return;
      api.render(mount, downBlock(err, () => loadTrending(mount), 'Trending is unavailable'));
    }
  }

  function skelRail(n, poster) {
    return h('div.cx__grid.cx__grid--rail', Array.from({ length: n }, () =>
      h('div', h('div.cx-skel', { class: poster ? 'cx-skel--poster' : 'cx-skel--art' }),
        skelLine('80%'), skelLine('55%'))));
  }

  function mediaCard(item, kind) {
    const url = kind === 'game' ? `static://games/${item.id}` : `static://movies/${item.id}`;
    const hot = kind === 'game' && item.plays >= 1e6;
    const meta = kind === 'game'
      ? `${providers.fmtPlays(item.plays)} plays`
      : `${item.year} · ${item.runtime} min`;
    const card = h('button.cx-card', {
      type: 'button', title: item.title, onclick: () => navigate(url),
      'aria-label': kind === 'game'
        ? `Play ${item.title} — ${meta}, rated ${item.rating.toFixed(1)} out of 5`
        : `Open ${item.title} — ${meta}, rated ${item.rating.toFixed(1)} out of 10`,
    },
      h('div.cx-card__art', { style: { '--art': providers.artFor(item.title, kind) } },
        h('div.cx-card__tag', { class: hot ? 'cx-card__tag--hot' : null },
          icon(hot ? 'flame' : 'star'), hot ? 'Hot' : item.rating.toFixed(1)),
        h('div.cx-card__mono', { text: item.title }),
        h('div.cx-card__play', h('i', icon('play', { fill: true })))),
      h('div.cx-card__b',
        h('div.cx-card__t', { text: item.title }),
        h('div.cx-card__m', icon(kind === 'game' ? 'gamepad' : 'film'), h('span', { text: meta }))));
    if (kind === 'movie') card.classList.add('cx-card--poster');
    return card;
  }

  /* ---------------------------------------------------------- *
   *  keyboard: "/" focuses the box, Escape clears it
   * ---------------------------------------------------------- */
  const isActive = () => {
    const w = root.closest('.win');
    return !w || w.classList.contains('is-active');
  };

  const off = listen(document, 'keydown', e => {
    if (!root.isConnected) { off(); return; }
    if (!isActive()) return;
    const t = e.target;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      focusInput();
      return;
    }
    if (e.key === 'Escape' && t === input) {
      if (input.value) { e.preventDefault(); input.value = ''; paintClear(); }
      else if (S.q) { e.preventDefault(); navigate('static://search'); }
    }
  });

  /* Both hosts (js/apps/browser.js, js/apps/portal.js) drop this node without
     it ever leaving a watched parent, so they call cherriTeardown() by hand —
     the same contract games/movies/anime honour. Without it the keydown
     listener above outlives the page until the reader next presses a key. */
  root.cherriTeardown = off;

  function focusInput() {
    if (!root.isConnected) return;
    try {
      input.focus({ preventScroll: true });
      const n = input.value.length;
      input.setSelectionRange(n, n);
    } catch (e) { /* focus is a nicety, never a failure */ }
  }

  /* ---------------------------------------------------------- *
   *  go
   * ---------------------------------------------------------- */
  if (S.q) {
    head.append(mark(false), form, luckyBtn, navStrip('static://search'));
    paintBody();
    run();
  } else {
    paintLanding();
  }
  requestAnimationFrame(() => { if (isActive()) focusInput(); });

  return root;
}

export default buildSearch;
