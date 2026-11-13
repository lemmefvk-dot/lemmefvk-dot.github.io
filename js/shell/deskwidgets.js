/* ============================================================
   deskwidgets.js — widgets that live on the desktop itself.

   The right-hand rail (widgets.js) is a column; these sit anywhere
   on the wallpaper, behind windows and in front of the desktop,
   and each can be dragged (by its title bar) and resized (by the
   corner grip). Arrow keys on the title bar move a widget,
   Shift+arrows resize it. Positions persist in prefs.deskWidgets.

   Add one from the desktop's right-click menu (Add Widget…) or the
   Store's Widgets section. Like the rail they are for signed-in
   people, they step aside in Game Mode, and they don't exist on a
   phone-sized screen.

   Every widget shows real things only: this device's plays, the
   catalogue, what people online are playing (only while presence
   is on), your own notes, to-dos and calendar, the actual track,
   the browser's own performance numbers, and weather only from
   Open-Meteo for a place you chose.

   A widget with settings (clock, weather, to-dos) has a ⚙ in its
   title bar that turns it over to show them; they are saved with
   the widget, in its entry's `cfg`. Those widgets and the other
   richer ones live in deskwidgets.more.js.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import * as L from '../core/layers.js';
import { store } from '../core/store.js';
import * as SEASON from '../core/season.js';
import * as MORE from './deskwidgets.more.js';
import { appTile } from '../core/appart.js';

const KEY = 'prefs.deskWidgets';
const SEASON_KEY = 'prefs.seasonWidgets';
const GRID = 8;

/* the catalogue of desktop widgets: size in px, min/max */
export const DESK_WIDGETS = [
  { type: 'gotd',    name: 'Game of the Day', icon: 'star',          w: 240, h: 230, min: [200, 190], max: [420, 420], desc: 'One game from the catalogue, a new one every day.' },
  { type: 'recent',  name: 'Recently Played', icon: 'clock',         w: 240, h: 220, min: [200, 150], max: [420, 520], desc: 'Jump back into what you played last.' },
  { type: 'friends', name: 'Friends Playing', icon: 'users',         w: 240, h: 200, min: [200, 140], max: [420, 520], desc: 'What people online are playing (needs Social on).' },
  { type: 'launch',  name: 'Quick Launch',    icon: 'grid-9',        w: 232, h: 150, min: [168, 110], max: [480, 360], desc: 'Your favourite apps, one click away.' },
  { type: 'note',    name: 'Sticky Note',     icon: 'sticky-note',   w: 220, h: 190, min: [160, 120], max: [480, 520], desc: 'A note that stays on the desktop.' },
  { type: 'tasks',   name: 'To-dos',          icon: 'check-circle',  w: 250, h: 260, min: [200, 160], max: [440, 600], cfg: true, desc: 'Check off, add and reorder a Static Tasks list, right on the desktop.' },
  { type: 'music',   name: 'Now Playing',     icon: 'music',         w: 270, h: 150, min: [220, 120], max: [460, 240], desc: 'What Music or Radio is playing, with play/pause and next.' },
  { type: 'anime',   name: 'Keep Watching',   icon: 'film',          w: 240, h: 170, min: [200, 130], max: [420, 360], desc: 'Your anime watchlist.' },
  { type: 'status',  name: 'System Status',   icon: 'activity',      w: 230, h: 170, min: [190, 140], max: [420, 300], desc: 'Frame rate, memory and storage the browser reports.' },
  { type: 'random',  name: 'Random Game',     icon: 'shuffle',       w: 240, h: 230, min: [200, 190], max: [420, 420], desc: 'Can’t decide? One random game from the catalogue.' },
  { type: 'clock',   name: 'Clock',           icon: 'clock',         w: 220, h: 170, min: [150, 100], max: [440, 440], cfg: true, desc: 'Analog or digital, here or in any time zone.' },
  { type: 'weather', name: 'Weather',         icon: 'cloud-sun',     w: 270, h: 210, min: [210, 150], max: [480, 400], cfg: true, desc: 'The forecast from Open-Meteo for a city you pick, or where you are.' },
  { type: 'countdown', name: 'Countdown',    icon: 'calendar',      w: 220, h: 224, min: [170, 220], max: [420, 360], cfg: true, desc: 'Days left to any date you pick, then days since. Add as many as you like.' },
  { type: 'upnext',  name: 'Up Next',         icon: 'calendar',      w: 250, h: 230, min: [200, 140], max: [440, 560], desc: 'Your next events from Calendar.' },
  { type: 'classes', name: 'Now and Next',   icon: 'calendar',      w: 250, h: 210, min: [200, 150], max: [440, 420], desc: 'Which class is on now and which is next, from your Static Study timetable.' },
];

/* Seasonal widgets are never in the picker and never saved in
   prefs.deskWidgets: each one appears by itself while its season runs
   (js/core/season.js) and is gone the day after. It moves and resizes like
   any other — its spot is kept in prefs.seasonWidgets — and removing it
   switches its season setting off (Settings → Spooky Season / Winter). */
export const SEASONAL_WIDGETS = [
  { type: 'halloween', name: 'Halloween', icon: 'pumpkin', w: 264, h: 150, min: [220, 132], max: [420, 260],
    season: 'spooky', pref: 'spookyCountdown', label: 'Halloween countdown', live: () => SEASON.spooky('countdown') },
  { type: 'christmas', name: 'Christmas', icon: 'gift', w: 264, h: 150, min: [220, 132], max: [420, 260],
    season: 'winter', pref: 'winterCountdown', label: 'Christmas countdown', live: () => SEASON.winter('countdown') },
];
const byType = t => DESK_WIDGETS.find(d => d.type === t) || SEASONAL_WIDGETS.find(d => d.type === t) || null;
const isDesk = t => DESK_WIDGETS.some(d => d.type === t);

const snap = v => Math.round(v / GRID) * GRID;

/* the first place on the desktop where a w×h widget doesn't overlap one
   that's already there — scanning left to right, top to bottom, clear of
   the desktop icons column, the menu bar and the dock */
function freeSpot(arr, w, h) {
  const vw = typeof innerWidth === 'number' ? innerWidth : 1280;
  const vh = typeof innerHeight === 'number' ? innerHeight : 800;
  const hits = (x, y) => arr.some(o => x < o.x + o.w + GRID && x + w + GRID > o.x && y < o.y + o.h + GRID && y + h + GRID > o.y);
  for (let y = 56; y + h < vh - 100; y += 24) {
    for (let x = 128; x + w < vw - 24; x += 24) {
      if (!hits(x, y)) return { x: snap(x), y: snap(y) };
    }
  }
  const n = arr.length;                            /* the desktop is full: cascade */
  return { x: snap(140 + (n % 8) * 28), y: snap(80 + (n % 8) * 28) };
}
const list = () => { const v = store.get(KEY, []); return Array.isArray(v) ? v.filter(w => w && isDesk(w.type) && typeof w.uid === 'string') : []; };
const save = arr => store.set(KEY, arr.map(w => ({ ...w })));

/** The seasonal widgets showing right now, each where it was last left —
    or, the first time it appears, in the first free spot, which is then
    kept so a widget added later can't shuffle it somewhere else. */
function seasonal() {
  const saved = store.get(SEASON_KEY, {}) || {};
  return SEASONAL_WIDGETS.filter(d => d.live()).map(d => {
    const at = saved[d.type];
    const ok = at && [at.x, at.y, at.w, at.h].every(Number.isFinite);
    const spot = ok ? at : { ...freeSpot(list(), d.w, d.h), w: d.w, h: d.h };
    if (!ok) store.set(SEASON_KEY, { ...saved, [d.type]: { x: spot.x, y: spot.y, w: spot.w, h: spot.h } });
    return { uid: `season-${d.type}`, type: d.type, seasonal: true, x: spot.x, y: spot.y,
      w: Math.max(d.min[0], Math.min(d.max[0], spot.w)), h: Math.max(d.min[1], Math.min(d.max[1], spot.h)) };
  });
}

/** Add a widget of `type` to the desktop (from the Store, the menu, …). */
export function addDeskWidget(type) {
  if (!isDesk(type)) return null;
  const def = byType(type);
  const arr = list();
  const uid = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  /* a seasonal widget holds its ground too */
  const spot = freeSpot([...arr, ...seasonal()], def.w, def.h);
  arr.push({ uid, type, x: spot.x, y: spot.y, w: def.w, h: def.h });
  save(arr);
  bus.emit('deskwidgets:added', { type });
  return uid;
}
export const deskWidgetCount = type => list().filter(w => w.type === type).length;

export function mountDeskWidgets(host) {
  const { h, icon, clear } = api;
  const desk = document.querySelector('.desktop') || host;
  const layer = h('div.dw-layer', { role: 'group', 'aria-label': 'Desktop widgets' });
  desk.appendChild(layer);
  const live = new Map();           /* uid -> { el, body, stop } */
  let offs = [];

  const signedIn = () => !!store.get('session.user', null);

  /* ---------------- the widget bodies ---------------- */
  const tile = (title, sub, art, onClick, ic) => h('button.dw-tile', { type: 'button', onclick: onClick, title },
    art ? h('span.dw-tile__art', { style: { backgroundImage: `url("${String(art).replace(/"/g, '%22')}")` } }) : h('span.dw-tile__art.dw-tile__art--ic', icon(ic || 'gamepad')),
    h('span.dw-tile__t', h('b', { text: title }), sub ? h('small', { text: sub }) : null));
  const empty = text => h('div.dw-empty', { text });

  async function catalogue() {
    const G = await import('../portal/games.data.js');
    await G.load().catch(() => {});
    return G;
  }
  const launchWeb = g => api.openApp('aether-games', { url: `static://games/${g.id}` });

  const BUILD = {
    async gotd(body) {
      const G = await catalogue();
      const pool = G.all().filter(g => g.art && (g.rating >= 4 || (g.cats || []).includes('featured')));
      if (!pool.length) { body.replaceChildren(empty('The game catalogue didn’t load.')); return; }
      const d = new Date();
      const seed = d.getFullYear() * 1000 + Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
      const g = pool[(seed * 2654435761 >>> 0) % pool.length];
      body.replaceChildren(
        h('div.dw-hero', { style: { backgroundImage: `url("${String(g.art).replace(/"/g, '%22')}")` } }),
        h('div.dw-hero__t', h('b', { text: g.title }), h('small', { text: 'Game of the day · a new one at midnight' })),
        h('button.btn.btn--sm.btn--primary.dw-cta', { type: 'button', onclick: () => launchWeb(g) }, icon('play'), 'Play'));
    },
    async recent(body) {
      const P = await import('../core/plays.js');
      const paint = () => {
        const r = P.recent(6);
        if (!r.length) { body.replaceChildren(empty('Nothing played yet — whatever you play shows up here.')); return; }
        body.replaceChildren(h('div.dw-list', r.map(x => tile(x.title, api.fmt.fmtAgo(new Date(x.at).toISOString()), x.art || null,
          async () => (await import('../core/launch.js')).launchItem({ kind: x.kind, id: x.id, url: x.url }), x.kind === 'arcade' ? 'gamepad' : 'play'))));
      };
      paint();
      return bus.on('game:launch', () => setTimeout(paint, 50));
    },
    async friends(body) {
      const PR = await import('../portal/presence.js');
      const paint = () => {
        if (!PR.running()) {
          body.replaceChildren(empty('Social is off, so no one online is shown.'),
            h('button.btn.btn--sm.dw-cta', { type: 'button', onclick: () => api.openApp('social') }, icon('users'), 'Open Social'));
          return;
        }
        const on = PR.online().filter(p => p.playing);
        if (!on.length) { body.replaceChildren(empty(PR.online().length ? 'People are online, but nobody is playing anything right now.' : 'No one else is online right now.')); return; }
        body.replaceChildren(h('div.dw-list', on.slice(0, 6).map(p => h('div.dw-person',
          h('span.dw-av', { style: { background: `hsl(${p.color} 70% 45%)` }, text: (p.name[0] || '?').toUpperCase() }),
          h('span.dw-person__t', h('b', { text: p.name }), h('small', { text: `playing ${p.playing}` }))))));
      };
      paint();
      const off1 = PR.onChange(paint);
      const t = setInterval(paint, 5000);          /* presence may start while this widget is up */
      return () => { off1(); clearInterval(t); };
    },
    launch(body, w) {
      const ids = (w.apps && w.apps.length ? w.apps : ['play', 'arcade', 'forge', 'store', 'music', 'settings'])
        .map(id => api.getApp(id)).filter(a => a && !a.hidden);
      body.replaceChildren(h('div.dw-apps', ids.map(a => h('button.dw-app', { type: 'button', title: a.name, 'aria-label': `Open ${a.name}`, onclick: () => api.openApp(a.id) },
        appTile(a, { gs: '38px' }),
        h('small', { text: a.name.replace(/^Static\s+/, '') })))));
    },
    note(body, w) {
      const notes = store.get('portal.deskNotes', {}) || {};
      const ta = h('textarea.dw-note', { placeholder: 'Write something…', 'aria-label': 'Sticky note', maxlength: '4000' });
      ta.value = notes[w.uid] || '';
      let t = 0;
      ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => store.set('portal.deskNotes', { ...(store.get('portal.deskNotes', {}) || {}), [w.uid]: ta.value }), 300); });
      ta.addEventListener('pointerdown', e => e.stopPropagation());
      body.replaceChildren(ta);
      return () => clearTimeout(t);
    },
    /* the richer ones: deskwidgets.more.js */
    tasks: MORE.tasks,
    music: MORE.music,
    weather: MORE.weather,
    upnext: MORE.upnext,
    classes: MORE.classes,
    countdown: MORE.countdown,
    anime(body) {
      const saved = (store.get('portal.watchlist', []) || []).filter(t => String(t).startsWith('anime:'));
      if (!saved.length) { body.replaceChildren(empty('Your anime watchlist is empty.'), h('button.btn.btn--sm.dw-cta', { type: 'button', onclick: () => api.openApp('aether-anime') }, icon('film'), 'Browse anime')); return; }
      import('../portal/anime.data.js').then(A => {
        const rows = A.isLoaded('anime') ? saved.map(t => A.byId?.(t.slice(6), 'anime')).filter(Boolean) : [];
        if (!rows.length) {
          body.replaceChildren(h('div.dw-big', h('b', { text: String(saved.length) }), h('small', { text: `on your watchlist` })),
            h('button.btn.btn--sm.dw-cta', { type: 'button', onclick: () => api.openApp('aether-anime') }, icon('play'), 'Keep watching'));
          return;
        }
        body.replaceChildren(h('div.dw-list', rows.slice(0, 5).map(a => tile(a.title || a.name, 'on your watchlist', a.poster || a.image || a.art || null, () => api.openApp('aether-anime'), 'film'))));
      }).catch(() => body.replaceChildren(empty('The anime catalogue isn’t available.')));
    },
    async status(body) {
      const M = await import('../core/metrics.js');
      M.start?.();
      let est = null;
      M.storage?.().then(s => { est = s; paint(); }).catch(() => {});
      const paint = () => {
        const fps = M.currentFps?.();
        const heap = M.heap?.();
        const row = (k, v) => h('div.dw-kv', h('span', { text: k }), h('b', { text: v }));
        body.replaceChildren(
          row('Frame rate', fps ? `${fps} fps` : 'measuring…'),
          row('JS memory', heap && heap.used ? M.formatBytes(heap.used) : 'not reported'),
          row('Storage', est && est.usage != null ? `${M.formatBytes(est.usage)} used` : 'not reported'),
          row('Online', navigator.onLine === false ? 'no' : 'yes'));
      };
      paint();
      const t = setInterval(paint, 2000);
      return () => clearInterval(t);
    },
    async random(body) {
      const G = await catalogue();
      const pool = G.all().filter(g => g.art);
      const roll = () => {
        if (!pool.length) { body.replaceChildren(empty('The game catalogue didn’t load.')); return; }
        const g = pool[Math.floor(Math.random() * pool.length)];
        body.replaceChildren(
          h('div.dw-hero', { style: { backgroundImage: `url("${String(g.art).replace(/"/g, '%22')}")` } }),
          h('div.dw-hero__t', h('b', { text: g.title }), h('small', { text: `picked at random from ${pool.length.toLocaleString()} games` })),
          h('div.row.dw-cta', { style: { gap: '6px' } },
            h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => launchWeb(g) }, icon('play'), 'Play'),
            h('button.btn.btn--sm', { type: 'button', onclick: roll }, icon('shuffle'), 'Another')));
      };
      roll();
    },
    clock: MORE.clock,
    /* seasonal: the days, hours, minutes and seconds to midnight at the start
       of October 31 on this computer's clock — then Happy Halloween */
    halloween: body => countdown(body, {
      word: 'Halloween', left: SEASON.halloween, doneIcon: 'pumpkin', doneTitle: () => 'Happy Halloween!',
      doneSub: now => (now.getMonth() === 9 ? 'It’s tonight. Mind the bats.' : 'The last night of spooky season.'),
    }),
    /* ...and to midnight at the start of December 25 — then Merry Christmas */
    christmas: body => countdown(body, {
      word: 'Christmas', left: SEASON.christmas, doneIcon: 'gift',
      doneTitle: now => (now.getMonth() === 11 && now.getDate() === 25 ? 'Merry Christmas!' : 'Happy holidays!'),
      doneSub: now => (now.getMonth() === 11 && now.getDate() === 25 ? 'It’s today. Enjoy it.' : 'Winter stays until January 1.'),
    }),
  };

  /* days · hours · minutes · seconds to a moment, then a greeting */
  function countdown(body, { word, left: leftOf, doneIcon, doneTitle, doneSub }) {
    const day = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const UNITS = [['days', 'days'], ['hours', 'hrs'], ['minutes', 'min'], ['seconds', 'sec']];
    let mode = '';
    let nums = [];
    let row = null;
    let sub = null;
    let hey = null;
    let said = '';
    const paint = () => {
      const now = new Date();
      const left = leftOf(now);
      const want = left.passed ? 'done' : 'count';
      if (want !== mode) {
        mode = want;
        sub = h('small.dw-hw__sub');
        if (left.passed) {
          hey = h('b.dw-hw__hey');
          body.replaceChildren(h('div.dw-hw.dw-hw--done',
            h('span.dw-hw__jack', { 'aria-hidden': 'true' }, icon(doneIcon)), hey, sub));
        } else {
          nums = UNITS.map(() => h('b.dw-hw__n'));
          row = h('div.dw-hw__row', { role: 'timer' },
            UNITS.map(([, short], i) => h('div.dw-hw__u', { 'aria-hidden': 'true' }, nums[i], h('small', { text: short }))));
          body.replaceChildren(h('div.dw-hw', row, sub));
        }
        said = '';
      }
      if (left.passed) {
        hey.textContent = doneTitle(now);
        sub.textContent = doneSub(now);
        return;
      }
      const vals = [left.days, left.hours, left.minutes, left.seconds];
      nums.forEach((n, i) => { n.textContent = String(vals[i]).padStart(2, '0'); });
      sub.textContent = `until ${day.format(left.target)}`;
      /* screen readers get a sentence, refreshed once a minute rather than every tick */
      const sentence = `${left.days} days, ${left.hours} hours and ${left.minutes} minutes until ${word}`;
      if (sentence !== said) { said = sentence; row.setAttribute('aria-label', sentence); }
    };
    paint();
    return bus.on('tick:1s', paint);
  }

  /* ---------------- frame: move, resize, remove ---------------- */
  function frame(w) {
    const def = byType(w.type);
    const body = h('div.dw-body');
    const grip = h('div.dw-grip', { 'aria-hidden': 'true' });
    /* a seasonal widget isn't removed, it's switched off (and can come back) */
    const drop = () => (w.seasonal ? hideSeasonal(def) : remove(w.uid));
    const dropLabel = w.seasonal ? `Hide the ${def.label}` : `Remove ${def.name}`;
    /* a widget with settings turns over to show them (⚙), and back (Done / ⚙) */
    let editing = false;
    const cfgBtn = def.cfg ? h('button.dw-x.dw-cfg', { type: 'button', 'aria-label': `${def.name} settings`, 'aria-pressed': 'false', dataset: { fk: 'dw-cfg' },
      onclick: e => { e.stopPropagation(); ctx.edit(!editing); } }, icon('settings')) : null;
    /* the title is the keyboard handle; the settings and remove buttons sit
       beside it, not inside it (a control inside a control is unreachable to
       a screen reader). Keys bubble to the head's handler below. */
    const head = h('div.dw-head',
      icon(def.icon), h('span.dw-head__t', { text: def.name, tabindex: '0', role: 'button', 'aria-label': `${def.name} widget — arrow keys move it, Shift+arrows resize, Delete removes` }),
      cfgBtn,
      h('button.dw-x', { type: 'button', 'aria-label': dropLabel, onclick: e => { e.stopPropagation(); drop(); } }, icon('x')));
    const el = h('section.dw', { dataset: { type: w.type, uid: w.uid }, class: w.seasonal ? 'dw--season' : null }, head, body, grip);
    place(el, w);

    /* drag by the title bar */
    head.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.dw-x')) return;
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
      el.classList.add('is-drag');
      head.setPointerCapture(e.pointerId);
      const mv = ev => { w.x = ox + ev.clientX - sx; w.y = oy + ev.clientY - sy; clampAndPlace(el, w, true); };
      const up = () => { el.classList.remove('is-drag'); head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); commit(w); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
    /* resize by the corner */
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, ow = w.w, oh = w.h;
      el.classList.add('is-drag');
      grip.setPointerCapture(e.pointerId);
      const mv = ev => {
        w.w = Math.max(def.min[0], Math.min(def.max[0], ow + ev.clientX - sx));
        w.h = Math.max(def.min[1], Math.min(def.max[1], oh + ev.clientY - sy));
        clampAndPlace(el, w, true);
      };
      const up = () => { el.classList.remove('is-drag'); grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); commit(w); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    /* keyboard: arrows move, Shift+arrows resize */
    head.addEventListener('keydown', e => {
      const d = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key];
      if (!d) { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); drop(); } return; }
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) { w.w = Math.max(def.min[0], Math.min(def.max[0], w.w + d[0])); w.h = Math.max(def.min[1], Math.min(def.max[1], w.h + d[1])); }
      else { w.x += d[0]; w.y += d[1]; }
      clampAndPlace(el, w); commit(w);
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      api.menu(w.seasonal ? [
        { label: dropLabel, icon: 'eye', onClick: drop },
        { label: `${SEASON.SEASONS[def.season].name} settings…`, icon: 'settings', onClick: () => api.openApp('settings', { section: def.season }) },
      ] : [
        def.cfg ? { label: editing ? 'Close settings' : `${def.name} settings…`, icon: 'settings', onClick: () => ctx.edit(!editing) } : null,
        { label: `Remove ${def.name}`, icon: 'trash', danger: true, onClick: () => remove(w.uid) },
        { label: 'Add another widget…', icon: 'plus', onClick: () => bus.emit('deskwidgets:picker') },
      ].filter(Boolean), e.clientX, e.clientY);
    });
    /* on the way down: bring this widget in front of the others */
    el.addEventListener('pointerdown', () => { if (el.nextSibling) layer.appendChild(el); }, true);
    /* on the way back up: keep the press from reaching the desktop */
    el.addEventListener('pointerdown', e => e.stopPropagation());

    let stop = null;
    let gen = 0;
    const halt = () => { try { stop?.(); } catch (e) {} stop = null; };
    /* (re)draw the body; a build that finishes after a newer one started is stopped at once */
    function build() {
      halt();
      const my = ++gen;
      el.classList.toggle('is-editing', editing);
      cfgBtn?.setAttribute('aria-pressed', String(editing));
      body.replaceChildren();
      Promise.resolve().then(() => BUILD[w.type](body, w, ctx)).then(s => {
        const fn = typeof s === 'function' ? s : null;
        if (my !== gen) { try { fn?.(); } catch (e) {} return; }
        stop = fn;
      }).catch(err => { if (my === gen) body.replaceChildren(h('div.dw-empty', { text: 'This widget couldn’t load.' })); });
    }
    const ctx = {
      get editing() { return editing; },
      /** keep a setting with this widget (prefs.deskWidgets[…].cfg) */
      save(patch) { w.cfg = { ...(w.cfg || {}), ...(patch || {}) }; saveCfg(w); },
      edit(on) {
        const inside = el.contains(document.activeElement);
        editing = !!on;
        build();
        /* closing the settings removed whatever had focus: keep a keyboard user on the ⚙ */
        if (!editing && inside && cfgBtn) cfgBtn.focus({ preventScroll: true });
      },
      rebuild: build,
    };
    build();
    return { el, stop: () => { gen++; halt(); } };
  }

  function place(el, w) {
    el.style.transform = `translate(${w.x}px, ${w.y}px)`;
    el.style.width = `${w.w}px`;
    el.style.height = `${w.h}px`;
  }
  function clampAndPlace(el, w, loose) {
    const maxX = Math.max(0, innerWidth - w.w - 8);
    const maxY = Math.max(0, innerHeight - w.h - 90);          /* keep clear of the dock */
    w.x = Math.max(8, Math.min(maxX, loose ? w.x : snap(w.x)));
    w.y = Math.max(40, Math.min(maxY, loose ? w.y : snap(w.y)));
    place(el, w);
  }
  function commit(w) {
    w.x = snap(w.x); w.y = snap(w.y);
    if (w.seasonal) {
      store.set(SEASON_KEY, { ...(store.get(SEASON_KEY, {}) || {}), [w.type]: { x: w.x, y: w.y, w: w.w, h: w.h } });
      return;
    }
    const arr = list().map(x => (x.uid === w.uid ? { ...x, x: w.x, y: w.y, w: w.w, h: w.h } : x));
    save(arr);
  }
  function saveCfg(w) {
    save(list().map(x => (x.uid === w.uid ? { ...x, cfg: { ...(w.cfg || {}) } } : x)));
  }
  function remove(uid) {
    save(list().filter(w => w.uid !== uid));
    MORE.dropWeather(uid);
    const notes = { ...(store.get('portal.deskNotes', {}) || {}) };
    if (uid in notes) { delete notes[uid]; store.set('portal.deskNotes', notes); }
  }
  function hideSeasonal(def) {
    store.set(`prefs.${def.pref}`, false);
    api.notify({ app: 'Widgets', icon: def.icon, title: `${def.label[0].toUpperCase()}${def.label.slice(1)} hidden`,
      message: `Bring it back in Settings → ${SEASON.SEASONS[def.season].name}.`,
      actions: [{ label: 'Undo', onClick: () => store.set(`prefs.${def.pref}`, true) }] });
  }

  function sync() {
    const want = signedIn() ? [...list(), ...seasonal()] : [];
    const wantIds = new Set(want.map(w => w.uid));
    for (const [uid, inst] of live) if (!wantIds.has(uid)) { inst.stop(); inst.el.remove(); live.delete(uid); }
    for (const w of want) {
      const inst = live.get(w.uid);
      if (!inst) { const copy = { ...w }; const made = frame(copy); made.w = copy; live.set(w.uid, made); layer.appendChild(made.el); clampAndPlace(made.el, copy); }
    }
  }

  /* ---------------- the picker ---------------- */
  let picker = null;
  function openPicker() {
    closePicker();
    if (!signedIn()) {
      api.notify({ app: 'Widgets', icon: 'user', title: 'Sign in to use widgets', message: 'Widgets are for signed-in accounts — use the corner at the bottom right.' });
      return;
    }
    picker = h('div.dw-picker', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add a widget', onclick: e => { if (e.target === picker) closePicker(); } },
      h('div.dw-picker__card',
        h('div.dw-picker__head', h('b', { text: 'Add a widget to the desktop' }), h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: closePicker }, icon('x'))),
        h('div.dw-picker__grid', DESK_WIDGETS.map(d => h('button.dw-pick', { type: 'button', onclick: () => { addDeskWidget(d.type); closePicker(); } },
          h('span.dw-pick__ic', icon(d.icon)),
          h('span.dw-pick__t', h('b', { text: d.name }), h('small', { text: d.desc })),
          deskWidgetCount(d.type) ? h('span.dw-pick__n', { text: `${deskWidgetCount(d.type)} on desktop` }) : null))),
        h('p.dw-picker__hint', { text: 'Drag a widget by its title bar, resize it from the corner, right-click to remove.' })));
    host.appendChild(picker);
    pickRelease = L.push({ name: 'widget-picker', el: picker, trap: true, close: closePicker });
    requestAnimationFrame(() => picker?.querySelector('.dw-pick')?.focus());
  }
  let pickRelease = null;
  function closePicker() { picker?.remove(); picker = null; pickRelease?.(); pickRelease = null; }

  sync();
  offs = [
    store.sub(KEY, sync),
    store.sub('session.user', sync),
    /* seasonal widgets come and go with their season and their switch */
    bus.on('season:change', sync),
    ...SEASONAL_WIDGETS.map(d => store.sub(`prefs.${d.pref}`, sync)),
    bus.on('deskwidgets:picker', openPicker),
    bus.on('deskwidgets:add', t => { if (signedIn()) addDeskWidget(t); else openPicker(); }),
    api.on(window, 'keydown', e => { if (e.key === 'Escape' && picker) { e.stopPropagation(); closePicker(); } }, true),
    api.on(window, 'resize', () => { for (const inst of live.values()) if (inst.w) clampAndPlace(inst.el, inst.w); }),
  ];
  return () => { offs.forEach(f => f?.()); for (const inst of live.values()) inst.stop(); layer.remove(); closePicker(); };
}

export default { mountDeskWidgets, addDeskWidget, DESK_WIDGETS, SEASONAL_WIDGETS, deskWidgetCount };
