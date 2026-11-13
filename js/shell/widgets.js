/* ============================================================
   widgets.js — the right-hand widget rail.

   A rail the user arranges rather than a fixed column: every card
   can be moved (pointer drag from its grip, or ⌥↑/⌥↓ from the
   keyboard), hidden, re-ordered and — where it has a scrolling
   body — resized. The arrangement lives in prefs.widgetLayout and
   survives a reload.

   Everything on this rail is a real reading. Frame rate, JS heap,
   storage, connection class, transferred bytes and battery come
   from js/core/metrics.js; files come from the vfs; the track
   comes from the media bus; the forecast is fetched from
   Open-Meteo for a place the user picked. Where the browser
   refuses to tell us something — host CPU, GPU, disk — the card
   says so instead of animating a number.
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as M from '../core/metrics.js';
import { GAMES } from '../portal/catalog.js';
import * as CAL from '../core/calendar.js';

const LAYOUT_KEY = 'prefs.widgetLayout';
const WX_PLACE = 'prefs.wxPlace';
const WX_CACHE = 'prefs.wxCache';
const WX_MAX_AGE = 20 * 60 * 1000;       /* re-fetch the forecast at most every 20 min */

const CIRC = 2 * Math.PI * 22;           /* ring circumference for r=22, as in shell.css */
const SW = 248, SH = 42;                 /* sparkline user units (widget content box)    */

const QUOTES = [
  ['ZXS',      'Owner of Luna',              'aether is clean imo'],
  ['Divine',   'Owner of Starlight',         'cute lil site'],
  ['TestUser', 'Co-Owner of Hydra Network',  'i like aether because it is ugly'],
  ['JOSH',     'User',                       'i like the name'],
  ['4xmq',     'Owner of Fern',              'aether, like the fifth element? nerdy'],
  ['apbz',     'Owner of Lucide',            'aether has upgraded my unblocking experience'],
];


/* WMO weather codes, as Open-Meteo returns them. */
const WMO = {
  0: ['Clear', 'sun'], 1: ['Mainly clear', 'cloud-sun'], 2: ['Partly cloudy', 'cloud-sun'],
  3: ['Overcast', 'cloud'], 45: ['Fog', 'cloud'], 48: ['Freezing fog', 'cloud'],
  51: ['Light drizzle', 'cloud-rain'], 53: ['Drizzle', 'cloud-rain'], 55: ['Heavy drizzle', 'cloud-rain'],
  56: ['Freezing drizzle', 'cloud-rain'], 57: ['Freezing drizzle', 'cloud-rain'],
  61: ['Light rain', 'cloud-rain'], 63: ['Rain', 'cloud-rain'], 65: ['Heavy rain', 'cloud-rain'],
  66: ['Freezing rain', 'cloud-rain'], 67: ['Freezing rain', 'cloud-rain'],
  71: ['Light snow', 'cloud-snow'], 73: ['Snow', 'cloud-snow'], 75: ['Heavy snow', 'cloud-snow'],
  77: ['Snow grains', 'cloud-snow'], 80: ['Showers', 'cloud-rain'], 81: ['Showers', 'cloud-rain'],
  82: ['Violent showers', 'cloud-rain'], 85: ['Snow showers', 'cloud-snow'], 86: ['Snow showers', 'cloud-snow'],
  95: ['Thunderstorm', 'cloud-rain'], 96: ['Thunderstorm', 'cloud-rain'], 99: ['Thunderstorm', 'cloud-rain'],
};
const wmo = c => WMO[c] || ['—', 'weather'];

/** fetch with a deadline: a blocked school network must fail, not hang. */
async function getJSON(url, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

/* What the rail can hold, for places outside it (the Store) that add or
   remove a card. Kept beside DEFS below: an id here with no DEF is simply
   ignored by layout(), and `off` must agree with the DEF's own `off`. */
export const WIDGET_CATALOG = [
  { id: 'clock', name: 'Clock', icon: 'clock', desc: 'The time and date, 12 or 24 hour.' },
  { id: 'weather', name: 'Weather', icon: 'cloud-sun', desc: 'The forecast for a place you choose (Open-Meteo).' },
  { id: 'calendar', name: 'Calendar', icon: 'calendar', desc: 'This month, with today marked.' },
  { id: 'monitor', name: 'System Monitor', icon: 'activity', desc: 'Frame rate, memory and storage, as the browser reports them.' },
  { id: 'media', name: 'Now Playing', icon: 'music', desc: 'Whatever Static Music is playing.' },
  { id: 'battery', name: 'Battery', icon: 'battery', desc: 'Charge level, where the browser shares it.' },
  { id: 'network', name: 'Network', icon: 'network', desc: 'Online or offline, and what this session has downloaded.' },
  { id: 'recent', name: 'Recent Files', icon: 'clock', desc: 'The files you opened last.' },
  { id: 'notes', name: 'Notes', icon: 'notes', desc: 'A scratchpad that saves as you type.' },
  { id: 'games', name: 'Games', icon: 'gamepad', desc: 'Continue where you left off, then featured games.' },
  { id: 'anime', name: 'Anime', icon: 'star', desc: 'Pick up the episode you were on.' },
  { id: 'aetherium', name: 'Staticum', icon: 'sparkles', desc: 'Ask the assistant from the rail.', off: true },
  { id: 'gamemode', name: 'Game Mode', icon: 'gamepad', desc: 'One switch for Game Mode, and what it changes.', off: true },
  { id: 'community', name: 'Static', icon: 'diamond', desc: 'What other site owners have said about StaticOS.', off: true },
];
const catalogHidden = raw => (Array.isArray(raw?.hidden) ? raw.hidden : WIDGET_CATALOG.filter(w => w.off).map(w => w.id));
/** Is this widget out of the rail? (Same first-run rule as layout().) */
export const widgetHidden = (store, id) => catalogHidden(store.get(LAYOUT_KEY)).includes(id);
/** Put a widget in the rail or take it out, keeping order and heights. */
export function setWidgetHidden(store, id, hide) {
  const raw = store.get(LAYOUT_KEY) || {};
  const hidden = catalogHidden(raw).filter(x => x !== id);
  if (hide) hidden.push(id);
  store.set(LAYOUT_KEY, { order: Array.isArray(raw.order) ? [...raw.order] : [], hidden, h: { ...(raw.h || {}) } });
}

export function mountWidgets(host) {
  const { h, icon, fmt, render, clear, on } = api;

  const rail = h('aside.widgets', { 'aria-label': 'Widgets' });
  const cards = new Map();            /* id → built card instance */
  const offs = [];                    /* teardown for every subscription made here */
  let dead = false;

  /* ------------------------------------------------------------------
     layout — { order:[id], hidden:[id], h:{id:px} }, persisted in prefs
     ------------------------------------------------------------------ */
  function layout() {
    const raw = store.get(LAYOUT_KEY) || {};
    const known = DEFS.map(d => d.id);
    const order = (Array.isArray(raw.order) ? raw.order : []).filter(id => known.includes(id));
    for (const d of DEFS) if (!order.includes(d.id)) order.push(d.id);
    /* An absent `hidden` is a first run, not "everything visible". */
    const hidden = Array.isArray(raw.hidden)
      ? raw.hidden.filter(id => known.includes(id))
      : DEFS.filter(d => d.off).map(d => d.id);
    return { order, hidden, h: { ...(raw.h || {}) } };
  }

  /* store.set short-circuits on reference equality, so every write is a
     brand-new object or nothing reaches localStorage. */
  const saveLayout = L => store.set(LAYOUT_KEY, {
    order: [...L.order], hidden: [...L.hidden], h: { ...L.h },
  });

  const isHidden = id => layout().hidden.includes(id);

  function setHidden(id, off) {
    const L = layout();
    L.hidden = off ? [...new Set([...L.hidden, id])] : L.hidden.filter(x => x !== id);
    saveLayout(L);
    applyLayout();
  }

  function move(id, dir) {
    const L = layout();
    const vis = L.order.filter(x => !L.hidden.includes(x));
    const at = vis.indexOf(id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= vis.length) return;
    vis.splice(to, 0, vis.splice(at, 1)[0]);
    /* hidden cards keep their slots at the end so un-hiding is predictable */
    L.order = [...vis, ...L.order.filter(x => L.hidden.includes(x))];
    saveLayout(L);
    applyLayout();
    cards.get(id)?.grip.focus({ preventScroll: true });
  }

  function setHeight(id, px) {
    const d = DEFS.find(x => x.id === id);
    if (!d || !d.resize) return;
    const L = layout();
    L.h = { ...L.h, [id]: Math.round(fmt.clamp(px, d.min || 70, d.max || 460)) };
    saveLayout(L);
    const inst = cards.get(id);
    if (inst) inst.setH(L.h[id]);
  }

  /* ------------------------------------------------------------------
     the cards
     ------------------------------------------------------------------ */
  function buildCard(d) {
    const built = d.build() || {};
    const nodes = built.nodes || [];

    const grip = h('button.wg__grip', {
      type: 'button',
      'aria-label': `${d.name} widget options`,
      'aria-haspopup': 'menu',
      title: `${d.name} — options, or drag to reorder`,
    }, icon('more-horizontal'));

    const inner = d.resize
      ? h('div.wg__scroll', { tabindex: '0', role: 'group', 'aria-label': `${d.name} contents` }, nodes)
      : nodes;

    const handle = d.resize
      ? h('div.wg__grab', {
          role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0',
          'aria-label': `Resize ${d.name}`,
          'aria-valuenow': String(layout().h[d.id] || d.h || 150),
          'aria-valuemin': String(d.min || 70), 'aria-valuemax': String(d.max || 460),
        })
      : null;

    const el = h('section.wg', {
      dataset: { wg: d.id }, role: 'group', 'aria-label': d.name,
      class: d.cls || null,
    },
      grip,
      d.head === false ? null
        : h('div.wg__head', icon(d.icon), h('div.wg__title', { text: d.name })),
      inner,
      handle);

    const inst = {
      def: d, el, grip, paint: built.paint, tick: built.tick, show: built.show,
      dispose: built.dispose, offs: built.offs || [],
      setH(px) {
        if (!d.resize) return;
        el.style.setProperty('--wg-h', `${px}px`);
        handle?.setAttribute('aria-valuenow', String(px));
      },
      shown: false,
    };

    inst.setH(layout().h[d.id] || d.h || 150);

    /* grip: click opens the menu, a real drag reorders, ⌥↑/⌥↓ moves */
    bindGrip(inst, grip);
    if (handle) bindResize(inst, handle);
    return inst;
  }

  function cardFor(id) {
    if (cards.has(id)) return cards.get(id);
    const d = DEFS.find(x => x.id === id);
    if (!d) return null;
    const inst = buildCard(d);
    cards.set(id, inst);
    try { inst.paint?.(); } catch (e) { console.error('[widgets]', id, e); }
    return inst;
  }

  /* ------------------------------------------------------------------
     grip: menu, drag-to-reorder, keyboard move
     ------------------------------------------------------------------ */
  function gripMenu(inst, x, y) {
    const d = inst.def;
    const L = layout();
    const vis = L.order.filter(id => !L.hidden.includes(id));
    const at = vis.indexOf(d.id);
    const items = [
      { header: true, label: d.name },
      { label: 'Move up', icon: 'arrow-up', hint: '⌥↑', disabled: at <= 0, onClick: () => move(d.id, -1) },
      { label: 'Move down', icon: 'arrow-down', hint: '⌥↓', disabled: at < 0 || at >= vis.length - 1,
        onClick: () => move(d.id, 1) },
    ];
    if (d.resize) {
      const cur = L.h[d.id] || d.h || 150;
      items.push('-',
        { label: 'Taller', icon: 'maximize-2', onClick: () => setHeight(d.id, cur + 40) },
        { label: 'Shorter', icon: 'minimize-2', onClick: () => setHeight(d.id, cur - 40) });
    }
    if (d.open) items.push('-', { label: d.open.label, icon: d.icon, onClick: d.open.run });
    items.push('-',
      { label: 'Hide widget', icon: 'minus', onClick: () => setHidden(d.id, true) },
      { label: 'Manage widgets…', icon: 'sliders', onClick: () => manageMenu(x, y) });
    api.menu(items, x, y);
  }

  function bindGrip(inst, grip) {
    let drag = null;

    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, y0: e.clientY, startY: e.clientY, live: false };
      grip.setPointerCapture(e.pointerId);
      /* Focusing the grip by mouse scrolls the rail a pixel to bring it into
         view, and that scroll — dispatched a frame later — closes the menu we
         are about to open. Keyboard focus is unaffected. */
      e.preventDefault();
    });

    grip.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.live) {
        if (Math.abs(e.clientY - drag.y0) < 5) return;
        drag.live = true;
        inst.el.classList.add('is-drag');
        rail.classList.add('is-sorting');
      }
      const dy = e.clientY - drag.startY;
      inst.el.style.transform = `translateY(${dy}px)`;

      /* swap with whichever visible sibling the card's centre now sits over;
         after the DOM move the card jumps, so the drag origin is shifted by
         the same amount to keep it glued to the pointer. */
      const r = inst.el.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const sibs = [...rail.querySelectorAll('.wg')].filter(el => el !== inst.el);
      for (const sib of sibs) {
        const sr = sib.getBoundingClientRect();
        if (mid < sr.top || mid > sr.bottom) continue;
        const before = inst.el.getBoundingClientRect().top;
        const after = mid < sr.top + sr.height / 2;
        rail.insertBefore(inst.el, after ? sib : sib.nextSibling);
        drag.startY += inst.el.getBoundingClientRect().top - before;
        inst.el.style.transform = `translateY(${e.clientY - drag.startY}px)`;
        break;
      }
    });

    const end = e => {
      if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
      const wasDrag = drag.live;
      drag = null;
      inst.el.style.transform = '';
      inst.el.classList.remove('is-drag');
      rail.classList.remove('is-sorting');
      if (!wasDrag) return;
      const L = layout();
      const seen = [...rail.querySelectorAll('.wg')].map(el => el.dataset.wg);
      L.order = [...seen, ...L.order.filter(id => !seen.includes(id))];
      saveLayout(L);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);

    grip.addEventListener('click', e => {
      e.stopPropagation();
      /* One frame of daylight: a click that also scrolled the rail (bringing
         the card into view) dispatches its scroll event in the rendering step
         just before this callback, and the menu closes on any scroll. */
      requestAnimationFrame(() => {
        const r = grip.getBoundingClientRect();
        gripMenu(inst, r.right - 6, r.bottom + 4);
      });
    });

    grip.addEventListener('keydown', e => {
      if (!e.altKey) return;
      if (e.key === 'ArrowUp') { e.preventDefault(); move(inst.def.id, -1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move(inst.def.id, 1); }
    });
  }

  function bindResize(inst, handle) {
    const id = inst.def.id;
    const cur = () => layout().h[id] || inst.def.h || 150;
    let drag = null;

    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, y: e.clientY, h: cur() };
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('is-on');
      e.preventDefault();
    });
    handle.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      setHeight(id, drag.h + (e.clientY - drag.y));
    });
    const end = () => { drag = null; handle.classList.remove('is-on'); };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);

    handle.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHeight(id, cur() + 20); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHeight(id, cur() - 20); }
    });
  }

  /* ------------------------------------------------------------------
     rail chrome
     ------------------------------------------------------------------ */
  function manageMenu(x, y) {
    const L = layout();
    const items = [{ header: true, label: 'Widgets' }];
    for (const id of L.order) {
      const d = DEFS.find(w => w.id === id);
      if (!d) continue;
      const shown = !L.hidden.includes(id);
      items.push({
        label: d.name, icon: d.icon, checked: shown,
        onClick: () => setHidden(id, shown),
      });
    }
    items.push('-',
      { label: 'Reset arrangement', icon: 'rotate-ccw', onClick: () => { store.set(LAYOUT_KEY, {}); applyLayout(); } },
      { label: 'Hide the rail', icon: 'sidebar', onClick: () => bus.emit('widgets:toggle') });
    api.menu(items, x, y);
  }

  const manage = h('button.ibtn.wgr__manage.tip', {
    'data-tip': 'Manage widgets', 'aria-label': 'Manage widgets', 'aria-haspopup': 'menu',
    onclick: e => {
      const el = e.currentTarget;
      requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        manageMenu(r.right, r.bottom + 4);
      });
    },
  }, icon('sliders'));

  const bar = h('div.wgr__bar', h('div.grow'), manage);

  /* ------------------------------------------------------------------
     order the DOM to match the layout
     ------------------------------------------------------------------ */
  /* A diff rather than a rebuild: a card that has not moved is never taken
     out of the document, so a pointer capture held by its resize handle
     survives the height writes that happen on every drag frame. */
  function applyLayout() {
    const L = layout();
    const want = L.order.filter(id => !L.hidden.includes(id));
    for (const [id, inst] of cards) {
      if (!want.includes(id) && inst.el.parentNode === rail) rail.removeChild(inst.el);
    }
    let prev = bar;
    want.forEach((id, i) => {
      const inst = cardFor(id);
      if (!inst) return;
      if (!inst.shown) inst.el.style.animationDelay = `${Math.min(i, 8) * 40}ms`;
      inst.setH(L.h[id] || inst.def.h || 150);
      if (prev.nextSibling !== inst.el) rail.insertBefore(inst.el, prev.nextSibling);
      prev = inst.el;
      if (!inst.shown) { inst.shown = true; try { inst.show?.(); } catch (e) { console.error('[widgets]', id, e); } }
    });
    /* a hidden card stays built but out of the tree, so adding it back is
       instant and its subscriptions keep it painted */
  }

  /* ==================================================================
     WIDGET DEFINITIONS
     ================================================================== */

  /* ---------------- 1 · clock ---------------- */
  const clock = () => {
    const t = h('div.wg-clock__t');
    const d = h('div.wg-clock__d');
    const paint = (now = new Date()) => {
      const h24 = !!store.get('prefs.h24');
      const c = fmt.fmtClock(now, h24);
      render(t, c.time, h24 ? null : h('sup', { text: c.ap }));
      d.textContent = fmt.fmtDateLong(now);
    };
    return {
      nodes: [h('button.wg-clock__btn', {
        'aria-label': 'Open Calendar', onclick: () => api.openApp('calendar'),
      }, t, d)],
      paint, tick: paint,
      offs: [store.sub('prefs.h24', () => paint())],
    };
  };

  /* ---------------- 2 · weather ---------------- */
  const weather = () => {
    const body = h('div');
    let busy = false, err = null;

    const unit = () => (store.get('prefs.weatherUnit', 'F') === 'C' ? 'C' : 'F');
    const place = () => store.get(WX_PLACE) || null;
    const cache = () => store.get(WX_CACHE) || null;

    async function fetchWx(force) {
      const p = place();
      if (!p || busy) return;
      const c = cache();
      if (!force && c && c.unit === unit() && Date.now() - c.at < WX_MAX_AGE) return;
      busy = true; err = null; paint();
      try {
        const u = 'https://api.open-meteo.com/v1/forecast'
          + `?latitude=${encodeURIComponent(p.lat)}&longitude=${encodeURIComponent(p.lon)}`
          + '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max'
          + `&forecast_days=5&timezone=auto&temperature_unit=${unit() === 'C' ? 'celsius' : 'fahrenheit'}`;
        const j = await getJSON(u);
        const days = (j.daily?.time || []).map((iso, i) => ({
          d: fmt.dayName(new Date(`${iso}T12:00:00`), true),
          code: j.daily.weather_code?.[i],
          hi: Math.round(j.daily.temperature_2m_max?.[i]),
        })).filter(x => Number.isFinite(x.hi));
        store.set(WX_CACHE, {
          at: Date.now(), unit: unit(), name: p.name,
          temp: Math.round(j.current?.temperature_2m),
          code: j.current?.weather_code, days,
        });
      } catch (e) {
        err = 'Weather unavailable';
      } finally { busy = false; paint(); }
    }

    async function setPlace(q) {
      const term = String(q || '').trim();
      if (!term || busy) return;
      busy = true; err = null; paint();
      try {
        const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(term)}`);
        const hit = j.results?.[0];
        if (!hit) { err = `No place called “${term}”`; return; }
        store.set(WX_PLACE, {
          name: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', '),
          lat: hit.latitude, lon: hit.longitude,
        });
        store.set(WX_CACHE, null);
      } catch (e) {
        err = 'Could not look that up';
      } finally {
        busy = false; paint();
        fetchWx(true);
      }
    }

    function askForm() {
      const input = h('input', {
        type: 'text', placeholder: 'City or town', 'aria-label': 'Weather location',
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); setPlace(input.value); } },
      });
      return h('div.wg-wx__ask',
        h('div.wg__head', icon('cloud-sun'), h('div.wg__title', { text: 'Weather' })),
        h('div.wg__empty', { text: 'No location set yet.' }),
        h('div.field', icon('search'), input),
        h('button.btn.btn--sm.btn--block', { style: { marginTop: 'var(--sp-3)' },
          onclick: () => setPlace(input.value) }, 'Set location'));
    }

    function paint() {
      const p = place(), c = cache();
      clear(body);
      if (busy && !c) {
        body.appendChild(h('div.wg__head', icon('cloud-sun'), h('div.wg__title', { text: 'Weather' })));
        return void body.appendChild(h('div.wg__empty', { text: 'Checking…' }));
      }
      if (!p) {
        if (err) body.appendChild(h('div.wg__warn', { text: err }));
        return void body.appendChild(askForm());
      }
      if (!c) {
        body.appendChild(h('div.wg__head', icon('cloud-sun'), h('div.wg__title', { text: 'Weather' })));
        body.appendChild(h('div.wg__empty', { text: err || 'No reading yet.' }));
        return void body.appendChild(h('button.btn.btn--sm.btn--block', {
          style: { marginTop: 'var(--sp-3)' }, onclick: () => fetchWx(true) }, 'Try again'));
      }
      const [label, ic] = wmo(c.code);
      body.appendChild(h('button.wg-wx__open', {
        'aria-label': 'Open Weather', onclick: () => api.openApp('weather') },
        h('div.wg-weather',
          h('div.wg-weather__ico', icon(ic)),
          h('div.grow',
            h('div.wg-weather__temp', { text: Number.isFinite(c.temp) ? `${c.temp}°${c.unit}` : '—' }),
            h('div.wg-weather__c', { text: label }),
            h('div.wg-weather__loc.trunc', { text: c.name || p.name }))),
        c.days?.length
          ? h('div.wg-weather__days', c.days.map(f => h('div.wg-weather__day',
              h('span', { text: f.d }), icon(wmo(f.code)[1]), h('b', { text: `${f.hi}°` }))))
          : null));
      if (err) body.appendChild(h('div.wg__warn', { text: err }));
    }

    return {
      nodes: [body], paint,
      show: () => fetchWx(false),
      offs: [
        store.sub(WX_PLACE, () => paint()),
        store.sub(WX_CACHE, () => paint()),
        store.sub('prefs.weatherUnit', () => fetchWx(true)),
        bus.on('tick:5s', () => { if (rail.contains(body)) fetchWx(false); }),
      ],
    };
  };

  /* ---------------- 3 · calendar ---------------- */
  const calendar = () => {
    const grid = h('div.wg-cal__grid');
    const title = h('div.wg-cal__m');
    const sub = h('div.wg-cal__sub');

    function paint(now = new Date()) {
      title.textContent = `${fmt.monthName(now)} ${now.getFullYear()}`;
      sub.textContent = `${fmt.dayName(now)} ${now.getDate()}`;
      clear(grid);
      for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
        grid.appendChild(h('span.wg-cal__dow', { text: d, 'aria-hidden': 'true' }));
      }
      const y = now.getFullYear(), m = now.getMonth();
      const lead = new Date(y, m, 1).getDay();
      const days = new Date(y, m + 1, 0).getDate();
      for (let i = 0; i < lead; i++) grid.appendChild(h('span.wg-cal__pad'));
      /* a dot under the days Calendar has something on (js/core/calendar.js) */
      const list = CAL.events();
      for (let d = 1; d <= days; d++) {
        const today = d === now.getDate();
        const key = CAL.ymd(new Date(y, m, d));
        const n = list.length ? CAL.onDay(key, list).length : 0;
        grid.appendChild(h(today ? 'button.wg-cal__d.is-today' : 'button.wg-cal__d', {
          text: String(d),
          class: n ? 'has-ev' : null,
          'aria-label': `${fmt.monthName(now)} ${d}${n ? `, ${n} event${n === 1 ? '' : 's'}` : ''}`,
          'aria-current': today ? 'date' : null,
          onclick: () => api.openApp('calendar', { date: key }),
        }));
      }
    }

    return {
      nodes: [h('div.wg-cal__head', title, h('div.grow'), sub), grid],
      paint,
      tick: d => { if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) paint(d); },
      offs: [CAL.onChange(() => paint())],
    };
  };

  /* ---------------- 4 · system monitor (real readings only) ---------------- */
  const monitor = () => {
    const ringGrad = h('svg', {
      width: 0, height: 0, 'aria-hidden': 'true', style: { position: 'absolute', width: '0', height: '0' },
      html: '<defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">'
          + '<stop offset="0%" style="stop-color:var(--accent-soft)"/>'
          + '<stop offset="100%" style="stop-color:var(--accent)"/></linearGradient></defs>',
    });

    function makeRing(key) {
      const dial = h('div.ring__dial',
        h('svg', { viewBox: '0 0 52 52', 'aria-hidden': 'true',
          html: '<circle class="ring__bg" cx="26" cy="26" r="22"/>'
              + '<circle class="ring__fg" cx="26" cy="26" r="22"/>' }));
      const fg = dial.querySelector('.ring__fg');
      fg.setAttribute('stroke-dasharray', CIRC.toFixed(2));
      fg.setAttribute('stroke-dashoffset', CIRC.toFixed(2));
      const v = h('div.ring__v', { text: '—' });
      const s = h('div.ring__sub');
      dial.appendChild(h('div.ring__lbl', h('div.ring__k', { text: key }), v));
      return { el: h('div.ring', dial, s), fg, v, sub: s };
    }

    const R = { fps: makeRing('FPS'), mem: makeRing('MEM'), disk: makeRing('DISK') };

    function set(r, pct, text, sub) {
      const p = pct === null ? 0 : fmt.clamp(pct, 0, 100);
      r.fg.setAttribute('stroke-dashoffset', (CIRC * (1 - p / 100)).toFixed(2));
      r.v.textContent = text;
      r.sub.textContent = sub;
    }

    const sparkFill = h('path', { style: { fill: 'var(--accent)', stroke: 'none', opacity: '.14' } });
    const sparkLine = h('path', { 'vector-effect': 'non-scaling-stroke',
      style: { fill: 'none', stroke: 'var(--accent)', strokeWidth: '1.5' } });
    const spark = h('svg.spark', { viewBox: `0 0 ${SW} ${SH}`, preserveAspectRatio: 'none',
      'aria-hidden': 'true' }, sparkFill, sparkLine);

    const foot = h('div.wg__note', { text: 'Host CPU, GPU and disk load are not exposed to a web page.' });
    let storagePct = null;
    let storageTxt = 'reading…';

    function paint() {
      const fps = M.currentFps();
      set(R.fps, fps ? Math.min(100, (fps / 60) * 100) : null, fps ? String(fps) : '—',
        fps ? `${fps >= 55 ? 'smooth' : fps >= 30 ? 'fair' : 'slow'}` : 'measuring');

      /* the heap limit is gigabytes wide, so a whole-number percentage of it
         rounds to zero all day — show the bytes and keep the arc for shape */
      const heap = M.heap();
      if (heap) set(R.mem, heap.pct, heap.pct >= 1 ? `${heap.pct}%` : '<1%', M.formatBytes(heap.used));
      else set(R.mem, null, 'n/a', 'not exposed');

      set(R.disk, storagePct, storagePct === null ? 'n/a' : `${storagePct}%`, storageTxt);

      const hist = M.history().fps;
      const vals = hist.length ? hist.map(v => fmt.clamp(v / 60, 0, 1)) : [0, 0];
      const dPath = fmt.smoothPath(vals, SW, SH);
      sparkLine.setAttribute('d', dPath);
      sparkFill.setAttribute('d', `${dPath} L${SW - 2} ${SH} L2 ${SH} Z`);
    }

    async function readStorage() {
      const s = await M.storage();
      if (!s) { storagePct = null; storageTxt = 'not exposed'; return; }
      storagePct = s.pct;
      storageTxt = `${M.formatBytes(s.used)} used`;
    }

    return {
      nodes: [ringGrad, h('div.rings', R.fps.el, R.mem.el, R.disk.el), spark, foot],
      paint,
      show: () => { M.start('rail'); readStorage().then(paint); },
      offs: [
        /* the rail's claim on the frame sampler goes back when the card does */
        () => M.stop('rail'),
        bus.on('metrics:tick', () => { if (rail.contains(foot)) paint(); }),
        /* the Monitor app stops the sampler when its window closes; the rail
           outlives every window, so it restarts it when the feed goes quiet */
        bus.on('tick:5s', () => {
          /* nothing to sample for while the card is hidden — the frame
             counter is only started for a monitor that is on screen */
          /* off the rail: give the sampler back rather than holding a
             60 fps loop open for a card nobody can see */
          if (!rail.contains(foot)) { M.stop('rail'); return; }
          const snap = M.snapshot();
          if (!snap || Date.now() - snap.at > 2600) M.start('rail');
          readStorage().then(paint);
        }),
      ],
    };
  };

  /* ---------------- 5 · now playing ---------------- */
  const nowPlaying = () => {
    const art = h('div.wg-np__art', icon('music'));
    const t = h('div.wg-np__t');
    const a = h('div.wg-np__a');
    const al = h('div.wg-np__b');
    const fill = h('i');
    const curT = h('span');
    const totT = h('span');
    const trackEl = h('button.track', { 'aria-label': 'Seek', onclick: seek }, fill);
    const play = h('button.ibtn.ibtn--play.tip', { 'data-tip': 'Play', 'aria-label': 'Play', onclick: toggle });
    const body = h('div');
    let track = null;

    function seek(e) {
      if (!track) return;
      const r = trackEl.getBoundingClientRect();
      bus.emit('media:seek', Math.round(fmt.clamp((e.clientX - r.left) / (r.width || 1), 0, 1) * track.duration));
    }
    function toggle() { bus.emit(track && track.playing ? 'media:pause' : 'media:play'); }

    function paint() {
      clear(body);
      if (!track) {
        body.appendChild(h('div.wg__empty', { text: 'Nothing is playing.' }));
        body.appendChild(h('button.btn.btn--sm.btn--block', { style: { marginTop: 'var(--sp-3)' },
          onclick: () => api.openApp('music') }, 'Open Music'));
        return;
      }
      t.textContent = track.title || '';
      a.textContent = track.artist || '';
      al.textContent = track.album || '';
      art.classList.toggle('is-playing', !!track.playing);
      fill.style.width = `${(track.duration ? fmt.clamp(track.elapsed / track.duration, 0, 1) * 100 : 0).toFixed(1)}%`;
      curT.textContent = fmt.fmtDur(track.elapsed || 0);
      totT.textContent = fmt.fmtDur(track.duration || 0);
      render(play, icon(track.playing ? 'pause' : 'play', { fill: true }));
      play.dataset.tip = track.playing ? 'Pause' : 'Play';
      play.setAttribute('aria-label', track.playing ? 'Pause' : 'Play');
      body.append(
        h('div.wg-np', art, h('div.grow', t, a, al)),
        h('div.wg-np__bar', curT, trackEl, totT),
        h('div.wg-np__ctl',
          h('button.ibtn.tip', { 'data-tip': 'Previous', 'aria-label': 'Previous track',
            onclick: () => bus.emit('media:prev') }, icon('skip-back')),
          play,
          h('button.ibtn.tip', { 'data-tip': 'Next', 'aria-label': 'Next track',
            onclick: () => bus.emit('media:next') }, icon('skip-forward'))));
    }

    return {
      nodes: [body], paint,
      offs: [bus.on('media:track', tr => { if (tr) { track = { ...track, ...tr }; paint(); } })],
    };
  };

  /* ---------------- 6 · battery ---------------- */
  const battery = () => {
    const body = h('div');
    let b = null, checked = false;

    const mins = s => {
      const m = Math.round(s / 60);
      return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`;
    };

    function paint() {
      clear(body);
      if (!checked) return void body.appendChild(h('div.wg__empty', { text: 'Reading…' }));
      if (!b) return void body.appendChild(h('div.wg__empty',
        { text: 'This browser does not report battery level.' }));
      body.append(
        h('div.wg-bat',
          h('div.wg-bat__n', { text: `${b.level}%` }),
          h('div.grow',
            h('div.wg-bat__s', { text: b.charging ? 'Charging' : 'On battery' }),
            h('div.wg-bat__sub', {
              text: b.charging
                ? (b.timeToFull ? `${mins(b.timeToFull)} to full` : 'Plugged in')
                : (b.timeToEmpty ? `${mins(b.timeToEmpty)} remaining` : 'Time remaining not reported'),
            }))),
        h('div.wg-bat__bar', h('i', { style: { width: `${b.level}%` } })));
    }

    async function read() {
      b = await M.battery();
      checked = true;
      paint();
    }

    return {
      nodes: [body], paint, show: read,
      offs: [bus.on('tick:5s', () => { if (rail.contains(body)) read(); })],
    };
  };

  /* ---------------- 7 · network ---------------- */
  const network = () => {
    const body = h('div');

    const line = (k, v) => h('div.wg-kv', h('span', { text: k }), h('b', { text: v }));

    function paint() {
      clear(body);
      const conn = M.connection();
      const net = M.network();
      const online = navigator.onLine;
      body.appendChild(h('div.wg-net__top',
        icon(online ? 'wifi' : 'wifi-off'),
        h('div.grow',
          h('div.wg-net__s', { text: online ? 'Online' : 'Offline' }),
          h('div.wg-net__sub', {
            text: !conn ? 'Connection class not exposed'
              : conn.rtt ? `${conn.type || 'unknown'} · ${conn.rtt} ms round trip`
              : (conn.type || 'class unknown'),
          }))));
      if (conn && conn.downlink) body.appendChild(line('Downlink', `${conn.downlink} Mb/s`));
      if (net) {
        body.appendChild(line('Requests', String(net.requests)));
        body.appendChild(line('Transferred', M.formatBytes(net.transferred)));
        body.appendChild(line('Saved by cache', M.formatBytes(net.saved)));
      }
      if (conn?.saveData) body.appendChild(h('div.wg__note', { text: 'Data Saver is on for this browser.' }));
    }

    return {
      nodes: [body], paint,
      offs: [
        bus.on('tick:5s', () => { if (rail.contains(body)) paint(); }),
        on(window, 'online', paint), on(window, 'offline', paint),
      ],
    };
  };

  /* ---------------- 8 · recent files ---------------- */
  const recent = () => {
    const list = h('div.wg-list');

    function paint() {
      clear(list);
      let rows = [];
      try { rows = api.vfs.recent(12); } catch (e) { rows = []; }
      if (!rows.length) return void list.appendChild(h('div.wg__empty', { text: 'No files yet.' }));
      for (const r of rows) {
        list.appendChild(h('button.wg-row', {
          'aria-label': `Open ${r.node.name}`,
          onclick: () => api.openFile(r.path),
        },
          icon(api.vfs.iconFor(r.node), { size: 13 }),
          h('span.grow.trunc', { text: r.node.name }),
          h('small', { text: fmt.fmtAgo(r.node.mtime) })));
      }
    }

    return {
      nodes: [list], paint,
      offs: [bus.on('fs:change', () => { if (rail.contains(list)) paint(); })],
    };
  };

  /* ---------------- 9 · notes ---------------- */
  const notes = () => {
    const list = h('div.wg-list');
    const input = h('input', {
      type: 'text', placeholder: 'Quick note', 'aria-label': 'New note',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); add(); } },
    });

    function add() {
      const text = input.value.trim();
      if (!text) return;
      const cur = Array.isArray(store.get('notes')) ? store.get('notes') : [];
      const [title, ...rest] = text.split('\n');
      /* a fresh array, or store.set's identity check drops the write */
      store.set('notes', [{
        id: `note-${Date.now().toString(36)}`,
        mtime: new Date().toISOString(),
        title: title.slice(0, 60), body: rest.join('\n'),
      }, ...cur]);
      input.value = '';
    }

    function paint() {
      clear(list);
      const rows = Array.isArray(store.get('notes')) ? store.get('notes') : [];
      if (!rows.length) return void list.appendChild(h('div.wg__empty', { text: 'No notes yet.' }));
      for (const n of rows.slice(0, 12)) {
        list.appendChild(h('button.wg-row', {
          'aria-label': `Open ${n.title || 'note'}`,
          onclick: () => api.openApp('notes'),
        },
          icon('note', { size: 13 }),
          h('span.grow.trunc', { text: n.title || 'Untitled' }),
          h('small', { text: n.mtime ? fmt.fmtAgo(n.mtime) : '' })));
      }
    }

    return {
      nodes: [h('div.field.wg-add', icon('plus'), input), list],
      paint,
      offs: [store.sub('notes', () => paint())],
    };
  };

  /* ---------------- 10 · games shelf ---------------- */
  const games = () => {
    const grid = h('div.wg-shelf');
    const cap = h('div.wg-shelf__cap');

    /* Continue Playing first — your real recent plays of any kind (web
       games, Arcade, your own creations; js/core/plays.js) — then the
       curated shelf with real cover art to fill the rest. */
    const openItem = r => {
      if (r.kind === 'arcade') api.openApp('arcade', { game: r.id });
      else if (r.kind === 'creation') api.openApp('forge', { project: r.id });
      else api.openApp('aether-games', { url: `static://games/${r.id}` });
    };
    const tile = (label, art, glyph, onclick, hue) => h('button.wg-shelf__i', { 'aria-label': `Play ${label}`, title: label, onclick },
      art
        ? h('div.wg-shelf__art', { style: { backgroundImage: `url("${String(art).replace(/"/g, '\\"')}")` } })
        : h('div.wg-shelf__art.wg-shelf__art--glyph', { style: hue != null ? { '--h': hue } : null }, icon(glyph)),
      h('span.trunc', { text: label }));

    async function paint() {
      let recent = [];
      try { recent = (await import('../core/plays.js')).recent(6); } catch (e) { recent = []; }
      const thumbs = store.get('portal.forge.thumbs', {}) || {};
      let hueOf = () => null;
      try { const A = await import('../arcade/index.js'); hueOf = id => A.arcadeById(id)?.hue ?? null; } catch (e) {}
      clear(grid);
      cap.textContent = recent.length ? 'Continue playing' : 'Featured';
      for (const r of recent) {
        const art = r.kind === 'creation' ? thumbs[r.id] : r.art;
        grid.appendChild(tile(r.title, art, r.kind === 'arcade' ? 'zap' : r.kind === 'creation' ? 'sparkles' : 'gamepad', () => openItem(r), r.kind === 'arcade' ? hueOf(r.id) : null));
      }
      const withArt = GAMES.filter(g => g.art && !recent.some(r => r.kind === 'web' && r.id === g.id));
      const featured = withArt.filter(g => (g.cats || []).includes('featured'));
      const shelf = [...featured, ...withArt.filter(g => !featured.includes(g))].slice(0, Math.max(0, 12 - recent.length));
      for (const g of shelf) grid.appendChild(tile(g.title, g.art, 'gamepad', () => api.openApp('aether-games', { url: `static://games/${g.id}` })));
      if (!grid.children.length) grid.appendChild(h('div.wg__empty', { text: 'No games in the catalogue.' }));
    }

    return { nodes: [cap, grid], paint, offs: [bus.on('game:launch', () => paint())] };
  };

  /* ---------------- 11 · anime shelf ---------------- */
  const anime = () => {
    const body = h('div');
    let data = null, state = 'idle', err = '';

    async function loadShelf() {
      if (state === 'loading') return;
      state = 'loading'; paint();
      try {
        const mod = await import('../portal/anime.data.js');
        await mod.load('anime');
        data = mod;
        state = 'ready';
      } catch (e) {
        state = 'error';
        err = 'Catalogue unavailable';
      }
      paint();
    }

    /* If the Anime app has already pulled the catalogue this session it is
       free to read; otherwise the rail does not drag several megabytes down
       on boot — the user asks for it. */
    async function peek() {
      try {
        const mod = await import('../portal/anime.data.js');
        if (mod.isLoaded('anime')) { data = mod; state = 'ready'; paint(); }
      } catch (e) { /* the portal is not available; the prompt stays */ }
    }

    function paint() {
      clear(body);
      const saved = Array.isArray(store.get('portal.watchlist')) ? store.get('portal.watchlist') : [];
      const watched = saved.filter(t => String(t).startsWith('anime:'));

      if (state !== 'ready') {
        body.appendChild(h('div.wg__empty', {
          text: state === 'loading' ? 'Loading the catalogue…'
            : state === 'error' ? err
            : 'The anime catalogue loads on demand.',
        }));
        if (watched.length) {
          body.appendChild(h('div.wg__note', { text: `${watched.length} saved in your watchlist.` }));
        }
        body.appendChild(h('div.row', { style: { marginTop: 'var(--sp-3)', gap: 'var(--sp-3)' } },
          h('button.btn.btn--sm.grow', { disabled: state === 'loading', onclick: loadShelf }, 'Load shelf'),
          h('button.btn.btn--sm.grow', { onclick: () => api.openApp('aether-anime') }, 'Open')));
        return;
      }

      let rows = [];
      if (watched.length) rows = watched.map(t => data.byId(t.slice(6), 'anime')).filter(Boolean);
      const fromWatchlist = rows.length > 0;
      if (!rows.length) {
        try { rows = data.query({ kind: 'anime', sort: 'score', perPage: 12 }).items || []; }
        catch (e) { rows = []; }
      }
      rows = rows.slice(0, 12);
      if (!rows.length) return void body.appendChild(h('div.wg__empty', { text: 'Nothing to show yet.' }));

      if (fromWatchlist) body.appendChild(h('div.wg__note', { text: 'From your watchlist' }));
      const grid = h('div.wg-shelf');
      for (const r of rows) {
        const art = h('div.wg-shelf__art', r.image
          ? { style: { backgroundImage: `url("${String(r.image).replace(/"/g, '\\"')}")` } }
          : null);
        grid.appendChild(h('button.wg-shelf__i', {
          'aria-label': `Open ${r.title}`, title: r.title,
          onclick: () => api.openApp('aether-anime', { url: `static://anime/${r.id}` }),
        }, art, h('span.trunc', { text: r.title })));
      }
      body.appendChild(grid);
    }

    return {
      nodes: [body], paint, show: peek,
      offs: [store.sub('portal.watchlist', () => paint())],
    };
  };

  /* ---------------- 12 · aetherium ---------------- */
  const aetherium = () => {
    const input = h('input', {
      type: 'text', placeholder: 'Ask Staticum', 'aria-label': 'Ask Staticum',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); ask(); } },
    });
    function ask() {
      const q = input.value.trim();
      input.value = '';
      api.openApp('aetherium', q ? { ask: q } : {});
    }
    return {
      nodes: [
        h('div.field.wg-add', icon('sparkles'), input),
        h('button.btn.btn--sm.btn--block', { style: { marginTop: 'var(--sp-3)' }, onclick: ask }, 'Ask'),
      ],
    };
  };

  /* ---------------- 13 · game mode ---------------- */
  /* Real, not theatre: see js/core/gamemode.js for exactly what it turns off.
     A web page cannot change clocks or fans, so this widget doesn't pretend to. */
  const gameMode = () => {
    const state = h('b');
    const auto = h('b');
    const btn = h('button.btn.btn--primary.btn--block.wg-gm__btn');

    function paint() {
      const on = document.documentElement.dataset.gamemode === 'on';
      const manual = !!store.get('prefs.gameMode');
      state.textContent = on ? (manual ? 'On' : 'On (a game is in front)') : 'Off';
      auto.textContent = store.get('prefs.gameModeAuto') ? 'On' : 'Off';
      btn.textContent = manual ? 'Turn Game Mode off' : 'Turn Game Mode on';
    }

    btn.addEventListener('click', () => {
      const wasOn = !!store.get('prefs.gameMode');
      store.set('prefs.gameMode', !wasOn);
      api.notify({
        app: 'Game Mode', icon: 'gamepad',
        title: wasOn ? 'Game Mode off' : 'Game Mode on',
        message: wasOn ? 'Effects are back on.' : 'Blur, shadows, animations, the wallpaper video and widget updates are off.',
      });
      paint();
    });

    return {
      nodes: [
        h('div.wg-gm__row', h('span', { text: 'Status' }), state),
        h('button.wg-gm__row', { style: { width: '100%' },
          onclick: () => { store.set('prefs.gameModeAuto', !store.get('prefs.gameModeAuto')); paint(); } },
          h('span', { text: 'Auto while a game is in front' }), auto),
        h('small.dim', { text: 'Turns off blur, shadows, animations, the wallpaper video and widget updates so games get the frames.' }),
        btn,
      ],
      paint,
      tick: paint,
      offs: [
        store.sub('prefs.gameMode', paint),
        store.sub('prefs.gameModeAuto', paint),
        bus.on('gamemode:change', paint),
      ],
    };
  };

  /* ---------------- 14 · community ---------------- */
  const community = () => {
    const initials = n => n.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
    const quote = ([u, role, text]) => h('article.quote',
      h('div.quote__u',
        h('div.avatar', { text: initials(u) }),
        h('div', h('b', { text: u }), h('small', { text: role }))),
      text);
    return {
      nodes: [
        h('div.marquee', h('div.marquee__rail', QUOTES.map(quote), QUOTES.map(quote))),
        h('div.row', { style: { marginTop: 'var(--sp-4)' } },
          h('div.grow'),
          h('button.chip.chip--accent', { 'aria-label': 'Open the Static arcade',
            onclick: () => api.openApp('browser', { url: 'static://arcade' }) },
            icon('message-circle'), 'Community')),
      ],
    };
  };

  /* ------------------------------------------------------------------
     the registry. `off: true` means hidden until the user adds it.
     ------------------------------------------------------------------ */
  const DEFS = [
    { id: 'clock', name: 'Clock', icon: 'clock', head: false, build: clock,
      open: { label: 'Open Calendar', run: () => api.openApp('calendar') } },
    { id: 'weather', name: 'Weather', icon: 'cloud-sun', head: false, build: weather,
      open: { label: 'Open Weather', run: () => api.openApp('weather') } },
    { id: 'calendar', name: 'Calendar', icon: 'calendar', build: calendar,
      open: { label: 'Open Calendar', run: () => api.openApp('calendar') } },
    { id: 'monitor', name: 'System Monitor', icon: 'activity', build: monitor,
      open: { label: 'Open System Monitor', run: () => api.openApp('monitor') } },
    { id: 'media', name: 'Now Playing', icon: 'music', build: nowPlaying,
      open: { label: 'Open Music', run: () => api.openApp('music') } },
    { id: 'battery', name: 'Battery', icon: 'battery', build: battery },
    { id: 'network', name: 'Network', icon: 'network', build: network },
    { id: 'recent', name: 'Recent Files', icon: 'clock', build: recent, resize: true, h: 150, min: 70, max: 420,
      open: { label: 'Open Files', run: () => api.openApp('files') } },
    { id: 'notes', name: 'Notes', icon: 'notes', build: notes, resize: true, h: 140, min: 70, max: 420,
      open: { label: 'Open Notes', run: () => api.openApp('notes') } },
    { id: 'games', name: 'Games', icon: 'gamepad', build: games, resize: true, h: 168, min: 90, max: 460,
      open: { label: 'Open Static Games', run: () => api.openApp('aether-games') } },
    { id: 'anime', name: 'Anime', icon: 'star', build: anime, resize: true, h: 168, min: 90, max: 460,
      open: { label: 'Open Static Anime', run: () => api.openApp('aether-anime') } },
    { id: 'aetherium', name: 'Staticum', icon: 'sparkles', build: aetherium, off: true,
      open: { label: 'Open Staticum', run: () => api.openApp('aetherium') } },
    { id: 'gamemode', name: 'Game Mode', icon: 'gamepad', build: gameMode, off: true },
    { id: 'community', name: 'Static', icon: 'diamond', build: community, off: true, cls: 'wg-community' },
  ];

  /* ------------------------------------------------------------------
     mount
     ------------------------------------------------------------------ */
  host.appendChild(rail);
  rail.appendChild(bar);
  applyLayout();

  /* the entry animation belongs to the first paint only — re-ordering a card
     moves the node, which would otherwise replay it every time */
  const settle = setTimeout(() => rail.classList.add('is-settled'), 900);

  /* widgets are for signed-in users (shell/account.js shows a card in their
     place while signed out) */
  const paintVisible = () => rail.classList.toggle('is-hidden',
    !store.get('prefs.widgetsVisible') || !store.get('session.user'));
  paintVisible();

  offs.push(
    store.sub('prefs.widgetsVisible', paintVisible),
    store.sub('session.user', paintVisible),
    store.sub(LAYOUT_KEY, () => { if (!dead) applyLayout(); }),
    bus.on('widgets:toggle', () => store.set('prefs.widgetsVisible', !store.get('prefs.widgetsVisible'))),
    bus.on('tick:1s', d => {
      /* Game Mode: widgets stop updating every second (the clock still
         ticks once a minute so it never looks frozen) */
      const quiet = document.documentElement.dataset.gamemode === 'on' && d.getSeconds() !== 0;
      for (const inst of cards.values()) {
        if (!inst.tick || !inst.el.isConnected) continue;
        if (quiet && inst.def.id !== 'gamemode') continue;
        try { inst.tick(d); } catch (e) { console.error('[widgets]', inst.def.id, e); }
      }
    }),
    on(rail, 'contextmenu', e => {
      /* a text field keeps the browser's own menu — cut/paste is genuinely
         useful in the quick-note and location boxes */
      if (e.target.closest?.('input,textarea,[contenteditable="true"]')) return;
      const card = e.target.closest?.('.wg');
      const inst = card && cards.get(card.dataset.wg);
      e.preventDefault();
      /* same one-frame wait as the grip: a menu opened in the same tick as a
         scroll of this rail is closed again by contextmenu.js's scroll guard */
      const { clientX: x, clientY: y } = e;
      requestAnimationFrame(() => (inst ? gripMenu(inst, x, y) : manageMenu(x, y)));
    }),
  );

  return () => {
    dead = true;
    clearTimeout(settle);
    offs.splice(0).forEach(off => { try { off(); } catch (e) {} });
    for (const inst of cards.values()) {
      inst.offs.forEach(off => { try { off(); } catch (e) {} });
      try { inst.dispose?.(); } catch (e) {}
    }
    cards.clear();
    rail.remove();
  };
}

export default mountWidgets;
