/* ============================================================
   proxy.app.js — static://proxy

   A browser, not a text box. Tabs, history, bookmarks, an
   address bar, an engine picker, and a viewport that changes
   shape depending on what the chosen engine can actually do.

   Proxy pages render inside their current window. The toolbar also
   provides an explicit localhost new-tab link. Where an engine genuinely cannot
   render a given site, the page says so and offers the next one
   down, rather than handing the person off somewhere.

   FOUR SHAPES OF VIEWPORT
     frame   an iframe. Used by the Static engine, by direct-link
             services, by archives, and by form-POST proxies.
     reader  Static fetches the HTML through a CORS relay, strips
             everything executable and repaints it in our own
             type. Always renders; never runs scripts.
     shot    a still image of the page. Not interactive, but it
             renders when every other route is refused.
     none    the engine is frame-blocked. Shown as a dead end
             with an explanation, never silently retried.

   The engine list and the transport are separate from this file
   (proxy.catalog.js, proxy.status.js, uv.js, proxy.reader.js) so
   the backend can be swapped without touching the interface.
   ============================================================ */

import { BRAND, LOCAL_PROXY_URL } from './brand.js?v=ps5-cloud-proxy-v11';
import * as CAT from './proxy.catalog.js?v=ps5-cloud-proxy-v11';
import * as ST from './proxy.status.js';
import * as RD from './proxy.reader.js';
import * as UV from './uv.js';

const HOME = 'static://proxy';

/* ---------- small helpers --------------------------------- */

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

const hostOf = url => {
  try { return new URL(url).host.replace(/^www\./, ''); }
  catch (err) { return String(url || '').replace(/^\w+:\/\//, '').split('/')[0] || 'new tab'; }
};

const faviconOf = url => {
  const h = hostOf(url);
  return h ? `https://icons.duckduckgo.com/ip3/${h}.ico` : '';
};

let seq = 0;
const nextId = () => `t${++seq}`;

/* ---------- the app --------------------------------------- */

export function buildProxyApp(ctx) {
  const { api } = ctx;
  const { h, icon } = api;

  const root = h('div.px2');
  const life = lifecycle(root);

  ST.attach(api.store);
  RD.worker.base = api.store.get('portal.proxyWorker', '') || '';

  const S = {
    tabs: [],
    active: '',
    engine: api.store.get('proxy.engine', 'aether'),
    panel: api.store.get('proxy.panel', ''),   // '' | 'directory' | 'marks' | 'history'
    marks: readList('proxy.marks'),
    hist: readList('proxy.hist'),
    dirQ: '',
    dirKind: 'all',
    probing: false,
  };

  function readList(key) {
    const raw = api.store.get(key, []);
    return Array.isArray(raw) ? raw.filter(x => x && typeof x === 'object') : [];
  }
  const saveMarks = () => api.store.set('proxy.marks', S.marks.slice(0, 200));
  const saveHist = () => api.store.set('proxy.hist', S.hist.slice(0, 300));

  const E = {};
  const cur = () => S.tabs.find(t => t.id === S.active) || null;

  buildShell();

  /* Staticum and the terminal can ask the proxy to open at a particular
     site by leaving it here — they cannot navigate this app directly, and
     neither of them is allowed to open a tab. One-shot: read it, clear it,
     so a stale hand-off does not hijack the next launch. */
  const pending = api.store.get('proxy.pending', '');
  if (pending) api.store.set('proxy.pending', '');

  /* Spotlight and the start page route here as static://proxy?q=…, so the
     query on the URL is the other way in. The store hand-off wins when both
     are present, because it is always the more recent action. */
  const fromUrl = (() => {
    const raw = String(ctx.url || '');
    const i = raw.indexOf('?');
    if (i < 0) return '';
    try { return new URLSearchParams(raw.slice(i + 1)).get('q') || ''; }
    catch (err) { return ''; }
  })();

  const first = pending || fromUrl;
  newTab(first ? UV.normalise(first) : '', { paint: true });
  bootEngine();

  life.add(() => { clearTimeout(E.dirTimer); E.probeAbort?.abort(); });
  return root;

  /* ---------- engine bring-up ----------------------------- */

  async function bootEngine() {
    const support = UV.isSupported();
    if (!support.ok) {
      paintEngineChip();
      return;
    }
    UV.onChange(() => { if (!life.dead) paintEngineChip(); });
    paintEngineChip();
    await UV.boot();
    if (life.dead) return;
    paintEngineChip();
    /* If a tab was waiting on the engine, run it now. */
    const t = cur();
    if (t && t.url && t.pending) load(t);
  }

  function engineFor(id) {
    return CAT.byId(id) || CAT.byId('aether');
  }

  /* Which viewport shape an engine needs. */
  function shapeOf(entry) {
    if (!entry) return 'none';
    if (entry.kind === 'engine') return UV.isReady() ? 'frame' : 'pending';
    if (entry.kind === 'get' || entry.kind === 'archive') return 'frame';
    if (entry.kind === 'post') return 'frame';
    if (entry.kind === 'shot') return 'shot';
    if (entry.kind === 'cors') return 'reader';
    return 'none';
  }

  /* ---------- chrome -------------------------------------- */

  function buildShell() {
    E.tabstrip = h('div.px2__tabs', { role: 'tablist', 'aria-label': 'Proxy tabs' });
    E.newTabBtn = h('button.px2__newtab.tip', {
      type: 'button', 'data-tip': 'New tab', 'aria-label': 'New tab',
      onclick: () => newTab('', { paint: true }),
    }, icon('plus', { size: 13 }));

    E.back = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Back', 'aria-label': 'Back',
      onclick: () => step(-1) }, icon('chevron-left'));
    E.fwd = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Forward', 'aria-label': 'Forward',
      onclick: () => step(1) }, icon('chevron-right'));
    E.reload = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Reload', 'aria-label': 'Reload',
      onclick: () => { const t = cur(); if (t) load(t); } }, icon('refresh'));
    E.home = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Start page', 'aria-label': 'Start page',
      onclick: () => { const t = cur(); if (t) { t.url = ''; t.view = 'start'; paintAll(); } } }, icon('home'));

    E.addr = h('input', {
      type: 'text', spellcheck: 'false', autocapitalize: 'none', autocomplete: 'off',
      placeholder: 'Search, or enter a site', 'aria-label': 'Address',
      onkeydown: e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        go(E.addr.value);
      },
      onfocus: () => E.addr.select(),
    });
    E.lock = h('span.px2__lock');
    E.star = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Bookmark', 'aria-label': 'Bookmark',
      onclick: toggleMark }, icon('star'));

    E.engineSel = h('select.select.px2__engine', {
      'aria-label': 'Proxy engine',
      onchange: e => {
        S.engine = e.target.value;
        api.store.set('proxy.engine', S.engine);
        const t = cur();
        if (t) { t.engine = S.engine; if (t.url) load(t); else paintAll(); }
        else paintAll();
      },
    });

    E.dirBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Proxy directory', 'aria-label': 'Proxy directory',
      onclick: () => togglePanel('directory') }, icon('layers'));
    E.marksBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Bookmarks', 'aria-label': 'Bookmarks',
      onclick: () => togglePanel('marks') }, icon('bookmark'));
    E.histBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'History', 'aria-label': 'History',
      onclick: () => togglePanel('history') }, icon('clock'));
    E.fsBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Fill the window', 'aria-label': 'Fill the window',
      onclick: toggleFull }, icon('maximize-2'));
    E.newWindow = h('a.ibtn.tip', {
      href: LOCAL_PROXY_URL,
      target: '_blank',
      rel: 'noopener noreferrer',
      'data-tip': 'Open Proxy in a new localhost tab (port 8000)',
      'aria-label': 'Open Proxy in a new localhost tab (port 8000)',
    }, icon('external-link'));

    E.bar = h('div.px2__bar',
      E.back, E.fwd, E.reload, E.home,
      h('div.field.px2__addr', E.lock, E.addr, E.star),
      E.engineSel,
      h('div.px2__tools', E.dirBtn, E.marksBtn, E.histBtn, E.newWindow, E.fsBtn));

    E.progress = h('div.px2__progress');
    E.view = h('div.px2__view');
    E.panel = h('aside.px2__panel', { hidden: true });

    E.chip = h('div.px2__chip');
    E.statusHost = h('span');
    E.statusNote = h('span.px2__note');
    E.status = h('div.px2__status', E.chip, E.statusNote, h('div.grow'), E.statusHost);

    api.render(root,
      h('div.px2__top', E.tabstrip, E.newTabBtn),
      E.bar,
      E.progress,
      h('div.px2__body', E.view, E.panel),
      E.status);

    paintEngines();
  }

  function paintEngines() {
    api.clear(E.engineSel);
    /* Only engines that can actually render go in the picker; the rest of
       the directory is browsable from the panel, where their limitations
       can be explained properly. */
    const usable = CAT.all().filter(p => shapeOf(p) !== 'none');
    const groups = [
      ['Static', usable.filter(p => p.kind === 'engine')],
      ['Direct', usable.filter(p => p.kind === 'get')],
      ['Archive', usable.filter(p => p.kind === 'archive' && p.tpl)],
      ['Readable', usable.filter(p => p.kind === 'cors' && p.status === 'verified')],
      ['Screenshot', usable.filter(p => p.kind === 'shot' && p.status === 'verified')],
      ['Form proxies', usable.filter(p => p.kind === 'post' && ST.statusOf(p) === 'verified')],
    ];
    for (const [label, rows] of groups) {
      if (!rows.length) continue;
      const g = h('optgroup', { label });
      for (const p of rows) {
        g.appendChild(h('option', { value: p.id, text: p.name, selected: p.id === S.engine }));
      }
      E.engineSel.appendChild(g);
    }
    E.engineSel.value = S.engine;
  }

  function paintEngineChip() {
    const entry = engineFor(S.engine);
    const st = UV.status();
    api.clear(E.chip);
    let tone = '';
    let text = '';
    if (entry.kind === 'engine') {
      if (st.phase === 'ready') { tone = 'ok'; text = `Static tunnel · ${st.wisp?.name || 'connected'}`; }
      else if (st.phase === 'booting') { tone = 'warn'; text = 'Starting the tunnel…'; }
      else if (st.phase === 'unsupported') { tone = 'bad'; text = 'Tunnel unavailable here'; }
      else if (st.phase === 'failed') { tone = 'bad'; text = 'Tunnel failed'; }
      else { tone = ''; text = 'Tunnel idle'; }
    } else if (RD.worker.base && entry.kind === 'cors') {
      tone = 'ok'; text = 'Your own relay';
    } else {
      const s = ST.statusOf(entry);
      tone = ST.TONE[s] || '';
      text = `${entry.name} · ${ST.LABEL[s] || s}`;
    }
    E.chip.className = `px2__chip${tone ? ` is-${tone}` : ''}`;
    E.chip.append(h('i.px2__dot'), h('span', { text }));
  }

  /* ---------- tabs ---------------------------------------- */

  function newTab(url = '', { paint = false } = {}) {
    const t = {
      id: nextId(), url, title: url ? hostOf(url) : 'New tab',
      engine: S.engine, history: url ? [url] : [], idx: url ? 0 : -1,
      view: url ? 'loading' : 'start', error: null, startedAt: 0, pending: false,
    };
    S.tabs.push(t);
    S.active = t.id;
    if (paint) paintAll();
    if (url) load(t);
    return t;
  }

  function closeTab(id) {
    const i = S.tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    S.tabs.splice(i, 1);
    if (!S.tabs.length) { newTab('', { paint: true }); return; }
    if (S.active === id) S.active = S.tabs[Math.max(0, i - 1)].id;
    paintAll();
  }

  function selectTab(id) {
    if (S.active === id) return;
    S.active = id;
    paintAll();
  }

  function paintTabs() {
    api.clear(E.tabstrip);
    for (const t of S.tabs) {
      const on = t.id === S.active;
      const fav = t.url ? h('img.px2__fav', {
        src: faviconOf(t.url), alt: '', loading: 'lazy',
        onerror: e => e.target.remove(),
      }) : icon('globe', { size: 12 });
      E.tabstrip.appendChild(h(on ? 'div.px2__tab.is-on' : 'div.px2__tab', {
        role: 'tab', tabindex: '0', 'aria-selected': String(on),
        onclick: () => selectTab(t.id),
        onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTab(t.id); } },
        onauxclick: e => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } },
      },
        fav,
        h('span.px2__tabt', { text: t.title || 'New tab' }),
        h('button.px2__tabx', {
          type: 'button', 'aria-label': `Close ${t.title || 'tab'}`,
          onclick: e => { e.stopPropagation(); closeTab(t.id); },
        }, icon('x', { size: 10 }))));
    }
  }

  /* ---------- navigation ---------------------------------- */

  function go(raw) {
    const url = UV.normalise(raw);
    if (!url) return;
    let t = cur();
    if (!t) t = newTab(url, { paint: true });
    else {
      t.history = t.history.slice(0, t.idx + 1);
      t.history.push(url);
      t.idx = t.history.length - 1;
      t.url = url;
      load(t);
    }
  }

  function step(d) {
    const t = cur();
    if (!t) return;
    const next = t.idx + d;
    if (next < 0 || next >= t.history.length) return;
    t.idx = next;
    t.url = t.history[next];
    load(t);
  }

  function remember(url, title) {
    if (!url) return;
    S.hist = [{ url, title: title || hostOf(url), at: Date.now() },
      ...S.hist.filter(x => x.url !== url)].slice(0, 300);
    saveHist();
  }

  function toggleMark() {
    const t = cur();
    if (!t || !t.url) return;
    const i = S.marks.findIndex(m => m.url === t.url);
    if (i >= 0) S.marks.splice(i, 1);
    else S.marks.unshift({ url: t.url, title: t.title || hostOf(t.url), at: Date.now() });
    saveMarks();
    paintAddr();
    if (S.panel === 'marks') paintPanel();
  }

  function toggleFull() {
    root.classList.toggle('is-full');
    const on = root.classList.contains('is-full');
    E.fsBtn.setAttribute('data-tip', on ? 'Show the toolbar' : 'Fill the window');
  }

  /* ---------- loading ------------------------------------- */

  function load(t) {
    if (!t || !t.url) return;
    t.engine = S.engine;
    const entry = engineFor(t.engine);
    const shape = shapeOf(entry);
    t.error = null;
    t.startedAt = Date.now();
    t.title = hostOf(t.url);

    if (shape === 'pending') {
      t.pending = true;
      t.view = 'loading';
      paintAll();
      return;
    }
    t.pending = false;
    t.view = shape === 'none' ? 'blocked' : shape;
    remember(t.url, t.title);
    paintAll();
  }

  function paintAll() {
    paintTabs();
    paintAddr();
    paintEngines();
    paintEngineChip();
    paintView();
    paintPanel();
  }

  function paintAddr() {
    const t = cur();
    E.addr.value = t?.url || '';
    E.back.disabled = !t || t.idx <= 0;
    E.fwd.disabled = !t || t.idx >= t.history.length - 1;
    E.reload.disabled = !t?.url;
    E.star.disabled = !t?.url;
    const marked = !!t?.url && S.marks.some(m => m.url === t.url);
    E.star.classList.toggle('is-on', marked);
    api.clear(E.lock);
    E.lock.appendChild(icon(t?.url?.startsWith('https') ? 'shield' : 'globe', { size: 12 }));
    E.statusHost.textContent = t?.url ? hostOf(t.url) : '';
  }

  /* ---------- the viewport -------------------------------- */

  function paintView() {
    const t = cur();
    api.clear(E.view);
    E.progress.classList.remove('is-busy');
    if (!t) return;

    if (t.view === 'start') { E.view.appendChild(startPage()); E.statusNote.textContent = ''; return; }
    if (t.view === 'loading') { E.view.appendChild(waiting()); return; }
    if (t.view === 'blocked') { E.view.appendChild(blockedPage(t)); return; }
    if (t.view === 'reader') { E.view.appendChild(readerView(t)); return; }
    if (t.view === 'shot') { E.view.appendChild(shotView(t)); return; }
    E.view.appendChild(frameView(t));
  }

  function waiting() {
    return h('div.px2__wait',
      h('div.spinner'),
      h('small', { text: 'Bringing the tunnel up…' }),
      h('small.dim', { text: 'This happens once per session.' }));
  }

  function frameView(t) {
    const entry = engineFor(t.engine);
    const frame = h('iframe.px2__frame', {
      title: `Proxied view of ${hostOf(t.url)}`,
      referrerpolicy: 'no-referrer',
      allow: 'autoplay; fullscreen; gamepad; clipboard-write; encrypted-media; picture-in-picture',
      allowfullscreen: '',
    });
    const veil = h('div.px2__veil', h('div.spinner'),
      h('small', { text: `Fetching ${hostOf(t.url)} through ${entry.name}…` }));
    const wrap = h('div.px2__frames', frame, veil);

    E.progress.classList.add('is-busy');
    let settled = false;
    const done = ok => {
      if (settled) return;
      settled = true;
      E.progress.classList.remove('is-busy');
      veil.remove();
      const ms = Date.now() - t.startedAt;
      E.statusNote.textContent = ok ? `loaded in ${(ms / 1000).toFixed(1)}s` : 'no response';
    };

    /* A page served through our own engine is same-origin, so unlike every
       other proxy here we can actually look at what came back. Ultraviolet
       renders its own error page on a transport hiccup, and those are
       often transient — a redirect chain, a cookie the target wanted on
       the first hit. So an error page is retried once, quietly, instead of
       being shown to the person as a dead end. */
    let retried = false;
    const looksBroken = () => {
      if (entry.kind !== 'engine') return false;
      try {
        const doc = frame.contentDocument;
        if (!doc) return false;
        if (doc.title !== 'Error') return false;
        return /error processing your request|failed to load/i.test(doc.body?.textContent || '');
      } catch (err) {
        return false;      // cross-origin: not our engine, nothing to read
      }
    };

    frame.addEventListener('load', () => {
      if (looksBroken() && !retried) {
        retried = true;
        E.statusNote.textContent = 'first attempt failed — retrying…';
        setTimeout(() => { if (!life.dead) frame.src = UV.encode(t.url); }, 500);
        return;
      }
      if (looksBroken()) {
        done(false);
        const why = (() => {
          try { return (frame.contentDocument.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220); }
          catch (err) { return ''; }
        })();
        wrap.appendChild(engineErrorCard(t, why));
        return;
      }
      done(true);
    });

    /* A frame that never fires load is the common failure here, so it gets
       a deadline and an honest message rather than an endless spinner. */
    const timer = setTimeout(() => {
      if (settled) return;
      done(false);
      wrap.appendChild(timeoutCard(t, entry));
    }, 22000);
    life.add(() => clearTimeout(timer));

    if (entry.kind === 'engine') {
      try { frame.src = UV.encode(t.url); }
      catch (err) { t.error = err.message; queueMicrotask(() => { api.clear(E.view); E.view.appendChild(blockedPage(t)); }); }
    } else if (entry.tpl) {
      frame.src = CAT.urlFor(entry, t.url);
    } else if (entry.action && entry.field) {
      submitForm(entry, t.url, frame);
    }
    return wrap;
  }

  /* A real form POST, targeted at our own iframe. fetch() could never be
     used here: the response is cross-origin and unreadable, but a form
     submission renders it directly. */
  function submitForm(entry, url, frame) {
    const name = `aether-px-${Math.random().toString(36).slice(2, 9)}`;
    frame.setAttribute('name', name);
    const form = document.createElement('form');
    form.method = 'post';
    form.action = entry.action;
    form.target = name;
    form.style.display = 'none';
    const fields = { [entry.field]: url, ...(entry.hidden || {}) };
    for (const [k, v] of Object.entries(fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = v == null ? '' : String(v);
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    setTimeout(() => form.remove(), 1500);
  }

  function shotView(t) {
    const entry = engineFor(t.engine);
    const src = CAT.urlFor(entry, t.url);
    const img = h('img.px2__shot', {
      src, alt: `Screenshot of ${hostOf(t.url)}`, referrerpolicy: 'no-referrer',
      onload: () => { E.progress.classList.remove('is-busy'); E.statusNote.textContent = 'still image'; },
      onerror: () => { E.progress.classList.remove('is-busy'); E.statusNote.textContent = 'no image'; },
    });
    E.progress.classList.add('is-busy');
    return h('div.px2__shotwrap',
      h('div.px2__shotbar', icon('camera', { size: 12 }),
        h('small', { text: 'A picture of the page — it will not respond to clicks.' }),
        h('button.btn.btn--sm', { type: 'button', onclick: () => { img.src = `${src}${src.includes('?') ? '&' : '?'}r=${Date.now()}`; } },
          icon('refresh', { size: 12 }), 'Render again')),
      img);
  }

  function readerView(t) {
    const page = h('article.px-read');
    const veil = h('div.px2__veil', h('div.spinner'),
      h('small', { text: `Reading ${hostOf(t.url)}…` }));
    const wrap = h('div.px2__reader', h('div.px-read__wrap', page), veil);
    E.progress.classList.add('is-busy');

    RD.fetchPage(t.url, { onTry: r => { E.statusNote.textContent = r.racing ? `asking ${r.name}…` : `via ${r.name}`; } })
      .then(({ html, relay }) => {
        if (life.dead) return;
        const { frag, title } = RD.sanitise(html, t.url, {
          onLink: href => { go(href); },
        });
        api.clear(page);
        page.appendChild(frag);
        if (title) { t.title = title; paintTabs(); }
        const { words, minutes } = RD.readingTime(page);
        E.statusNote.textContent = `${words.toLocaleString()} words · ${minutes} min · via ${relay.name}`;
      })
      .catch(err => {
        if (life.dead) return;
        api.clear(page);
        page.appendChild(errorCard(t, err));
      })
      .finally(() => { veil.remove(); E.progress.classList.remove('is-busy'); });

    return wrap;
  }

  /* ---------- failure surfaces ---------------------------- */

  function nextEngines(exclude) {
    return CAT.all()
      .filter(p => p.id !== exclude && shapeOf(p) !== 'none' && shapeOf(p) !== 'pending')
      .filter(p => ST.statusOf(p) === 'verified' || p.status === 'verified')
      .slice(0, 4);
  }

  function tryOthers(t) {
    const rows = nextEngines(t.engine);
    if (!rows.length) return null;
    return h('div.px2__alts',
      h('small.dim', { text: 'Try another route:' }),
      h('div.px2__altrow', rows.map(p => h('button.btn.btn--sm', {
        type: 'button',
        onclick: () => { S.engine = p.id; api.store.set('proxy.engine', p.id); load(t); },
      }, icon(p.kind === 'shot' ? 'camera' : p.kind === 'archive' ? 'clock' : 'shield', { size: 12 }), p.name))));
  }

  function engineErrorCard(t, why) {
    return h('div.px2__overlay',
      h('div.empty', icon('alert'),
        h('b', { text: `The tunnel could not fetch ${hostOf(t.url)}` }),
        h('small', { text: why || 'The request failed on its way out.' }),
        h('small.dim', { text: 'Some hosts refuse the tunnel’s TLS handshake outright, and the free '
          + 'relay is rate-limited. Switching relay often fixes it.' }),
        h('div.px2__altrow',
          h('button.btn', { type: 'button', onclick: () => load(t) }, icon('refresh', { size: 13 }), 'Try again'),
          ...UV.WISP_SERVERS.map(w => h('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            disabled: UV.status().wisp?.id === w.id ? '' : null,
            onclick: async () => {
              E.statusNote.textContent = `switching to ${w.name}…`;
              await UV.useWisp(w);
              paintEngineChip();
              load(t);
            },
          }, icon('activity', { size: 12 }), w.name))),
        tryOthers(t)));
  }

  function timeoutCard(t, entry) {
    return h('div.px2__overlay',
      h('div.empty', icon('alert'),
        h('b', { text: `${entry.name} did not answer` }),
        h('small', { text: `${hostOf(t.url)} took longer than 22 seconds to come back. The service may be `
          + 'overloaded, or it may be refusing this particular site.' }),
        h('div.px2__altrow',
          h('button.btn', { type: 'button', onclick: () => load(t) }, icon('refresh', { size: 13 }), 'Try again')),
        tryOthers(t)));
  }

  function blockedPage(t) {
    const entry = engineFor(t.engine);
    return h('div.empty.px2__empty', icon('shield'),
      h('b', { text: `${entry.name} cannot render pages here` }),
      h('small', { text: entry.blurb || 'This service sends a header that forbids being placed inside '
        + 'another page, so Static cannot show it without opening a tab — which is exactly what this '
        + 'page exists to avoid.' }),
      tryOthers(t));
  }

  function errorCard(t, err) {
    return h('div.empty', icon('alert'),
      h('b', { text: `Could not read ${hostOf(t.url)}` }),
      h('small', { text: String(err?.message || err).slice(0, 300) }),
      h('div.px2__altrow',
        h('button.btn', { type: 'button', onclick: () => load(t) }, icon('refresh', { size: 13 }), 'Try again')),
      tryOthers(t));
  }

  /* ---------- start page ---------------------------------- */

  function startPage() {
    const input = h('input', {
      type: 'text', spellcheck: 'false', autocapitalize: 'none', autocomplete: 'off',
      placeholder: 'Search, or enter a site', 'aria-label': 'Search or enter a site',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(input.value); } },
    });
    const form = h('form.px2__form', { onsubmit: e => { e.preventDefault(); go(input.value); } },
      h('div.field.px2__bigfield', icon('search'), input),
      h('button.btn.btn--primary', { type: 'submit' }, icon('arrow-right', { size: 14 }), 'Go'));

    const quick = ['youtube.com', 'reddit.com', 'wikipedia.org', 'discord.com',
      'github.com', 'news.ycombinator.com', 'spotify.com', 'twitch.tv'];

    const recent = S.hist.slice(0, 8);

    requestAnimationFrame(() => input.focus());

    return h('div.px2__start',
      h('div.px2__mark', icon(BRAND.icon), h('span', { text: BRAND.wordmark })),
      h('div.px2__tag', { text: `${CAT.all().length} routes to the open web. None of them opens a tab.` }),
      form,
      h('div.px2__quick', quick.map(q => h('button.chip', {
        type: 'button', onclick: () => go(q),
      }, h('img.px2__fav', { src: faviconOf(`https://${q}`), alt: '', onerror: e => e.target.remove() }),
        h('span', { text: q })))),
      recent.length ? h('div.px2__recent',
        h('div.px2__recent-h', icon('clock', { size: 12 }), h('span', { text: 'Recent' })),
        h('div.px2__quick', recent.map(r => h('button.chip', {
          type: 'button', onclick: () => go(r.url),
        }, h('span', { text: r.title || hostOf(r.url) }))))) : null);
  }

  /* ---------- the side panel ------------------------------ */

  function togglePanel(name) {
    S.panel = S.panel === name ? '' : name;
    api.store.set('proxy.panel', S.panel);
    paintPanel();
  }

  function paintPanel() {
    const on = !!S.panel;
    E.panel.hidden = !on;
    root.classList.toggle('has-panel', on);
    E.dirBtn.classList.toggle('is-on', S.panel === 'directory');
    E.marksBtn.classList.toggle('is-on', S.panel === 'marks');
    E.histBtn.classList.toggle('is-on', S.panel === 'history');
    if (!on) return;
    api.clear(E.panel);
    if (S.panel === 'directory') E.panel.appendChild(directoryPanel());
    else if (S.panel === 'marks') E.panel.appendChild(listPanel('Bookmarks', S.marks, 'star', i => {
      S.marks.splice(i, 1); saveMarks(); paintPanel(); paintAddr();
    }));
    else E.panel.appendChild(listPanel('History', S.hist, 'clock', i => {
      S.hist.splice(i, 1); saveHist(); paintPanel();
    }));
  }

  function listPanel(title, rows, ic, remove) {
    const body = h('div.px2__plist');
    if (!rows.length) {
      body.appendChild(h('div.empty', icon(ic),
        h('b', { text: `No ${title.toLowerCase()} yet` }),
        h('small', { text: title === 'Bookmarks'
          ? 'Star a page and it will wait for you here.'
          : 'Sites you visit through the proxy show up here.' })));
    }
    rows.forEach((r, i) => {
      body.appendChild(h('div.px2__prow', {
        role: 'button', tabindex: '0',
        onclick: () => go(r.url),
        onkeydown: e => { if (e.key === 'Enter') go(r.url); },
      },
        h('img.px2__fav', { src: faviconOf(r.url), alt: '', onerror: e => e.target.remove() }),
        h('div.px2__pmeta',
          h('div.px2__ptitle', { text: r.title || hostOf(r.url) }),
          h('div.px2__purl', { text: r.url })),
        h('button.ibtn', {
          type: 'button', 'aria-label': 'Remove',
          onclick: e => { e.stopPropagation(); remove(i); },
        }, icon('x', { size: 11 }))));
    });
    return h('div.px2__panelin',
      h('div.px2__panelh', icon(ic, { size: 13 }), h('b', { text: title }),
        h('div.grow'),
        rows.length ? h('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: () => {
            if (title === 'Bookmarks') { S.marks = []; saveMarks(); } else { S.hist = []; saveHist(); }
            paintPanel();
          },
        }, 'Clear') : null,
        h('button.ibtn', { type: 'button', 'aria-label': 'Close panel', onclick: () => togglePanel(S.panel) },
          icon('x', { size: 12 }))),
      body);
  }

  function directoryPanel() {
    const search = h('input', {
      type: 'search', placeholder: 'Search routes…', spellcheck: 'false',
      'aria-label': 'Search the proxy directory', value: S.dirQ,
      oninput: e => {
        S.dirQ = e.target.value;
        clearTimeout(E.dirTimer);
        E.dirTimer = setTimeout(paintRows, 140);
      },
    });

    const kinds = h('div.px2__kinds');
    const counts = CAT.counts();
    for (const k of ['all', ...CAT.KIND_ORDER]) {
      const n = k === 'all' ? counts.get('all') : (counts.get(k) || 0);
      if (!n) continue;
      kinds.appendChild(h(k === S.dirKind ? 'button.chip.is-on' : 'button.chip', {
        type: 'button',
        onclick: () => { S.dirKind = k; paintRows(); paintKinds(); },
      }, h('span', { text: k === 'all' ? 'All' : CAT.KIND_LABEL[k] }), h('i.cx-cat__n', { text: String(n) })));
    }
    function paintKinds() {
      [...kinds.children].forEach(el => el.classList.remove('is-on'));
      const labels = ['All', ...CAT.KIND_ORDER.map(k => CAT.KIND_LABEL[k])];
      const want = S.dirKind === 'all' ? 'All' : CAT.KIND_LABEL[S.dirKind];
      const idx = labels.indexOf(want);
      if (idx >= 0 && kinds.children[idx]) kinds.children[idx].classList.add('is-on');
    }

    const rows = h('div.px2__plist');
    const note = h('div.px2__dirnote');

    const probeBtn = h('button.btn.btn--ghost.btn--sm', {
      type: 'button',
      onclick: async () => {
        if (S.probing) { E.probeAbort?.abort(); S.probing = false; paintRows(); return; }
        const list = CAT.search({ q: S.dirQ, kind: S.dirKind })
          .filter(p => p.kind !== 'engine' && ST.statusOf(p) === 'untested')
          .slice(0, 40);
        if (!list.length) { note.textContent = 'Nothing here needs checking.'; return; }
        S.probing = true;
        E.probeAbort = new AbortController();
        paintRows();
        await ST.probeAll(list, {
          signal: E.probeAbort.signal,
          onEach: (entry, rec, done, total) => {
            if (life.dead) return;
            note.textContent = `Checking ${done} of ${total}… ${entry.host}`;
            if (done % 4 === 0 || done === total) paintRows();
          },
        });
        S.probing = false;
        if (!life.dead) { note.textContent = 'Check finished.'; paintRows(); paintEngines(); }
      },
    }, icon('activity', { size: 12 }), S.probing ? 'Stop' : 'Check these');

    function paintRows() {
      api.clear(rows);
      probeBtn.lastChild.textContent = S.probing ? 'Stop' : 'Check these';
      const list = CAT.search({ q: S.dirQ, kind: S.dirKind });
      note.textContent = note.textContent && S.probing ? note.textContent
        : `${list.length} route${list.length === 1 ? '' : 's'}`;
      if (!list.length) {
        rows.appendChild(h('div.empty', icon('search'),
          h('b', { text: 'No route matches that' }),
          h('small', { text: 'Try a service name, a domain, or an engine like “glype”.' })));
        return;
      }
      for (const p of list.slice(0, 120)) rows.appendChild(dirRow(p));
      if (list.length > 120) {
        rows.appendChild(h('div.px2__more', { text: `+${list.length - 120} more — narrow the search to see them.` }));
      }
    }

    paintRows();

    return h('div.px2__panelin',
      h('div.px2__panelh', icon('layers', { size: 13 }), h('b', { text: 'Proxy directory' }),
        h('div.grow'),
        h('button.ibtn', { type: 'button', 'aria-label': 'Close panel', onclick: () => togglePanel('directory') },
          icon('x', { size: 12 }))),
      h('div.field.px2__dirsearch', icon('search'), search),
      kinds,
      h('div.px2__dirbar', note, h('div.grow'), probeBtn),
      rows);
  }

  function dirRow(p) {
    const st = ST.statusOf(p);
    const rec = ST.observed(p.id);
    const usable = shapeOf(p) !== 'none';
    const row = h('div.px2__prow.px2__dirrow', {
      role: 'button', tabindex: '0',
      onclick: () => use(p),
      onkeydown: e => { if (e.key === 'Enter') use(p); },
    },
      h('i.px2__st', { class: `px2__st is-${ST.TONE[st] || 'none'}` }),
      h('div.px2__pmeta',
        h('div.px2__ptitle', { text: p.name }),
        h('div.px2__purl', { text: `${p.host}${p.family ? ` · ${p.family}` : ''}` })),
      h('span.badge', { text: CAT.KIND_LABEL[p.kind] || p.kind }),
      h('button.ibtn.tip', {
        type: 'button', 'data-tip': 'Check this one', 'aria-label': `Check ${p.name}`,
        onclick: async e => {
          e.stopPropagation();
          const dot = row.querySelector('.px2__st');
          dot.className = 'px2__st is-busy';
          await ST.probe(p);
          if (!life.dead) paintPanel();
        },
      }, icon('activity', { size: 11 })));

    row.title = `${ST.LABEL[st] || st}${rec?.gated ? ' · behind a bot check' : ''}\n${p.blurb || ''}`;
    if (!usable) row.classList.add('is-gate');
    return row;

    function use(entry) {
      if (shapeOf(entry) === 'none') {
        api.notify({
          app: 'Proxy', icon: 'shield',
          title: `${entry.name} cannot render here`,
          message: entry.blurb || 'It refuses to be placed inside another page.',
        });
        return;
      }
      S.engine = entry.id;
      api.store.set('proxy.engine', entry.id);
      paintEngines();
      paintEngineChip();
      const t = cur();
      if (t?.url) load(t);
      else api.notify({ app: 'Proxy', icon: 'shield', title: `Using ${entry.name}`,
        message: 'Enter a site and it will go through this route.' });
    }
  }
}

export default { buildProxyApp };
