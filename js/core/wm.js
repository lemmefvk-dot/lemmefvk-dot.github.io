/* ============================================================
   wm.js — window manager
   · flat z-stack, focus is the only thing that reorders it
   · pointer-driven move + 8-way resize, snap on pointer-up
   · minimize flies to the dock icon, restore reverses
   · every window is a plain absolutely-positioned element so
     app content is never inside a transform (no blurry text)
     — except while it is animating: every movement here is a
     transform/opacity animation on the compositor (open, close,
     minimise, restore, snap, maximise, desktop slides), with
     the real geometry set once, up front, so the app inside
     lays out one time instead of on every frame
   · desktops: each window belongs to one (js/core/desktops.js);
     only the current desktop's windows are shown, and switching
     slides one set out and the other in
   ============================================================ */
import { h, clear, on } from './dom.js';
import { bus } from './bus.js';
import { store } from './store.js';
import { clamp } from './util.js';
import { getApp } from './registry.js';
import { icon } from './icons.js';
import * as DESK from './desktops.js';
import * as M from './metrics.js';
import * as KM from './keymap.js';

const wins = new Map();
let seq = 0;
let zTop = 100;
/* Window z-indexes only ever count up, one per focus. Left alone they would
   pass the dock (700), the top bar (800) and menus (1000) after a few hundred
   focus changes in one session, and windows would start covering the shell.
   Re-pack them into 101.. (keeping their order) well before that. */
const Z_CEILING = 600;
function nextZ() {
  if (zTop >= Z_CEILING) {
    zTop = 100;
    [...wins.values()].sort((a, b) => a.z - b.z).forEach(x => { x.z = ++zTop; paintZ(x); });
  }
  return ++zTop;
}
/* Keep on top: a pinned window (w.pinned) is drawn PIN_Z above its place in
   the stack, so it stays over every unpinned window, the focused one too.
   The window layer is a stacking context of its own (.layer-win, z-index
   var(--z-win) in css/window.css), so this never lifts it over the dock,
   menus, Spotlight, notifications or the lock screen. On a phone every app
   is full screen and the one you switch to must come first, so the pin is
   kept but not applied there. A pinned window stays on its own desktop. */
const PIN_Z = 1000;
const pinLift = w => (w.pinned && !document.body.classList.contains('is-mobile') ? PIN_Z : 0);
function paintZ(w) { w.el.style.zIndex = w.z + pinLift(w); }
let active = null;
let moving = null;     /* the window being dragged by its title bar, if any */
let layer = null;
let ghost = null;
let cascade = 0;

/* ---------- motion ---------------------------------------------------
   One place for the timings, so the whole shell moves the same way.
   Every one of these animates transform and opacity only. */
const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';      /* --ease-out: settles softly */
const EASE_IO  = 'cubic-bezier(.45,0,.2,1)';      /* leaves, then lands         */
const EASE_IN  = 'cubic-bezier(.4,0,1,1)';        /* gone                       */
const SLIDE    = 'cubic-bezier(.22,1,.36,1)';     /* desktop slide              */
const T = { open: 360, close: 220, min: 320, restore: 340, geo: 260, desk: 460, back: 280, lift: 200, ghost: 200, move: 260 };

const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const canAnimate = el => typeof el.animate === 'function' && !reduced();
/** Measure the frames of a transition (js/core/metrics.js); never throws. */
const track = (label, ms) => { try { M.track(label, ms); } catch (e) { /* metrics are optional */ } };

export function mountWM(parent) {
  layer = h('div.layer-win', { id: 'winlayer' });
  ghost = h('div.snap-ghost', { 'aria-hidden': 'true' });
  parent.append(ghost, layer);
  bindGlobalKeys();
  on(window, 'resize', () => wins.forEach(w => {
    if (w.max) applyRect(w, workArea());
    else if (w.snapped && snapRect(w.snapped)) applyRect(w, snapRect(w.snapped));
    else keepInView(w);
  }));
  beginRestore();
  return layer;
}

/* ---------- geometry ------------------------------------------------ */
function cssPx(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
export function workArea() {
  const top = cssPx('--topbar-h', 34);
  const dock = cssPx('--dock-h', 74);
  return { x: 0, y: top, w: window.innerWidth, h: Math.max(200, window.innerHeight - top - dock - 4) };
}

function applyRect(w, r) {
  w.x = Math.round(r.x); w.y = Math.round(r.y);
  w.w = Math.round(r.w); w.h = Math.round(r.h);
  w.el.style.left = w.x + 'px';
  w.el.style.top = w.y + 'px';
  w.el.style.width = w.w + 'px';
  w.el.style.height = w.h + 'px';
  w.hooks.resize.forEach(fn => { try { fn(w.w, w.h); } catch (e) { console.error(e); } });
}
function keepInView(w) {
  const a = workArea();
  applyRect(w, {
    x: clamp(w.x, -w.w + 90, a.w - 90),
    y: clamp(w.y, a.y, a.y + a.h - 40),
    w: Math.min(w.w, a.w), h: Math.min(w.h, a.h + 40),
  });
}

/* Where the desktop's free width ends: the left edge of the widget rail, when
   it is showing. A window that fits beside the rail opens there rather than
   over it, so it doesn't cut the clock in half. */
export function freeWidth() {
  const rail = document.querySelector('.widgets:not(.is-hidden)');
  return rail && rail.offsetWidth ? Math.round(rail.getBoundingClientRect().left) : window.innerWidth;
}

function placeNew(app) {
  const a = workArea();
  const w = Math.min(app.win.w, a.w - 40);
  const hh = Math.min(app.win.h, a.h - 20);
  const step = 26;
  const off = (cascade++ % 6) * step;
  const rail = freeWidth();
  const room = w + 24 <= rail ? rail : a.w;
  return {
    x: clamp(Math.round(room / 2 - w / 2) + off - 60, 12, Math.max(12, room - w - 12)),
    y: clamp(Math.round(a.y + (a.h - hh) / 2) + off - 40, a.y + 8, Math.max(a.y + 8, a.y + a.h - hh - 8)),
    w, h: hh,
  };
}

/* ---------- desktops ------------------------------------------------- */
const here = w => w.desk === DESK.current();
const syncAway = w => w.el.classList.toggle('is-away', !here(w));
/* Window tabs (js/core/wintabs.js): every tab is still a window of its own,
   its app mounted once. The ones behind the selected tab wait hidden at the
   same place (w.tabHidden) and stand in for nothing here: the front window,
   ⌘Tab and the window that takes over from a closed one skip them. Focusing
   one brings it to the front of its group first (tabs.raise), and a window
   dragged by its title bar can be dropped onto another's (tabs.over/drop). */
let tabs = null;
export function useTabs(t) { tabs = t; }
const shown = w => !w.min && !w.tabHidden;
/** The window that should be in front on a desktop: highest z, not minimised. */
const topOn = desk => [...wins.values()].filter(x => shown(x) && x.desk === desk).sort((a, b) => b.z - a.z)[0] || null;

/* Where the last session's windows were, so the ones StaticOS puts back at
   start-up — opened with { restore: true }: Files (main.js) and your
   startup apps (core/automations.js) — land on the desktop they were on.
   Anything else (a shared link, a click) opens where you are. The saved
   list is left alone until start-up is over (your first click or key, or
   a few seconds after boot), so the later restores still find it. */
let restoreRows = null;
function beginRestore() {
  restoreRows = DESK.savedWindows();
  let t = 0;
  const stop = () => {
    if (restoreRows === null) return;
    restoreRows = null;
    clearTimeout(t);
    window.removeEventListener('pointerdown', stop, true);
    window.removeEventListener('keydown', stop, true);
    remember();
  };
  window.addEventListener('pointerdown', stop, true);
  window.addEventListener('keydown', stop, true);
  bus.once('boot:ready', () => { t = setTimeout(stop, 4000); });
}
/** The saved row ({ app, desk, pin }) a window put back at start-up takes over. */
function claimRow(appId, opts) {
  if (!(opts && opts.restore === true && restoreRows && restoreRows.length)) return null;
  const i = restoreRows.findIndex(r => r.app === appId);
  return i >= 0 ? restoreRows.splice(i, 1)[0] : null;
}
function pickDesk(appId, opts, row) {
  if (opts && typeof opts.desk === 'string' && DESK.has(opts.desk)) return opts.desk;
  if (row && DESK.has(row.desk)) return row.desk;
  return DESK.current();
}
/** Save which desktop each window is on, and which are kept on top (only
    worth saving with more than one desktop or a pinned window). */
function remember() {
  if (restoreRows) return;     /* still putting the last session back — don't overwrite it yet */
  const all = list();
  const keep = DESK.count() > 1 || all.some(w => w.pinned);
  DESK._rememberWindows(keep ? all.map(w => (w.pinned ? { app: w.appId, desk: w.desk, pin: true } : { app: w.appId, desk: w.desk })) : []);
}

/* ---------- redirects -----------------------------------------------
   An app can be served by something other than a window — the Linux
   wallpaper terminal (shell/deskterm.js) serves 'terminal'. A redirect
   sees every open, whatever the caller (dock, Spotlight, restore, a
   command): return undefined to fall through to a normal window, or any
   other value (null included) to have open() return it instead. */
const redirects = new Map();
export function redirectApp(appId, fn) {
  redirects.set(appId, fn);
  return () => { if (redirects.get(appId) === fn) redirects.delete(appId); };
}

/* ---------- open / close -------------------------------------------- */
export function open(appId, opts = {}) {
  const app = getApp(appId);
  if (!app) { console.warn(`[wm] unknown app "${appId}"`); return null; }

  const redirect = redirects.get(appId);
  if (redirect) {
    let res;
    try { res = redirect(opts || {}); } catch (e) { console.error(e); res = null; }
    if (res !== undefined) return res;
  }

  if (app.singleton) {
    const existing = [...wins.values()].find(w => w.appId === appId);
    if (existing) {
      if (existing.min) restore(existing); else focus(existing, { lift: true });
      if (opts && existing.hooks.reopen.length) existing.hooks.reopen.forEach(fn => fn(opts));
      return existing;
    }
  }

  const id = ++seq;
  const own = { ...placeNew(app), ...pickRect(opts) };
  const row = claimRow(appId, opts || {});
  const desk = pickDesk(appId, opts || {}, row);
  /* opts.seat { max } or { snapped: side }: open in that layout straight
     away (a reopened window, js/core/reopen.js); `own` is then the size it
     goes back to when dragged out, as if it had been snapped by hand */
  const seat = opts && opts.seat && typeof opts.seat === 'object' ? opts.seat : null;
  const seatSide = seat && !seat.max && snapRect(seat.snapped) ? seat.snapped : null;
  const seatRect = seat && seat.max ? workArea() : seatSide ? snapRect(seatSide) : null;
  const rect = seatRect ? { x: Math.round(seatRect.x), y: Math.round(seatRect.y), w: Math.round(seatRect.w), h: Math.round(seatRect.h) } : own;

  const lights = h('div.win__lights',
    h('button.light.light--close', { title: 'Close', 'aria-label': 'Close' }, icon('x')),
    h('button.light.light--min', { title: 'Minimize', 'aria-label': 'Minimize' }, icon('minus')),
    /* no title tooltip: hovering this shows the snap layouts (shell/snaplayouts.js) */
    h('button.light.light--max', { 'aria-label': 'Maximize', 'aria-haspopup': 'true' }, icon('maximize')),
  );
  const leadEl  = h('div.win__lead');
  const titleTx = h('span', { text: app.name });
  const subEl   = h('span.win__sub');
  /* the app icon doubles as the window menu (move, size, snap, close from
     the keyboard — js/shell/a11y.js draws the menu), like a classic
     system menu. It is a real button, so it is reachable with Tab. */
  const menuBtn = h('button.win__menu', { type: 'button', title: 'Window menu', 'aria-label': `${app.name} window menu`, 'aria-haspopup': 'menu' }, icon(app.icon));
  /* shown only while the window is kept on top (.is-pinned); a click stops that */
  const pinBtn = h('button.win__pin', { type: 'button', title: 'Kept on top — click to stop', 'aria-label': 'Kept on top. Stop keeping it on top' }, icon('pin'));
  const titleEl = h('div.win__title', menuBtn, titleTx, subEl, pinBtn);
  const toolsEl = h('div.win__tools');
  const bar = h('header.win__bar', lights, leadEl, titleEl, toolsEl);
  const body = h('div.win__body');

  const z0 = nextZ();
  const el = h(`section.win${app.win.class ? '.' + app.win.class : ''}`, {
    dataset: { win: id, app: appId },
    style: { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px',
             minWidth: app.win.minW + 'px', minHeight: app.win.minH + 'px', zIndex: z0 },
    role: 'dialog', 'aria-label': app.name,
    /* focusable from script (never a Tab stop), so keyboard focus can move
       into a window when it comes to the front */
    tabindex: '-1',
  }, bar, body);

  if (app.win.resizable !== false) {
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      el.appendChild(h('div.win__grip', { dataset: { dir } }));
    }
  }

  const w = {
    id, appId, app, el, body, bar, ...rect,
    /* prev: the rect to go back to from maximised. free: the size it had
       before it was snapped or maximised, which dragging it away restores.
       snapped: the snap layout it sits in ('left', 'tr', 'l3' …) or null. */
    min: false, max: !!seatRect && !seatSide, prev: seatRect ? own : null, free: seatRect ? own : null, snapped: seatSide, desk, z: z0,
    /* pinned: kept on top. group / tabHidden: its tab group and whether it waits behind another tab (js/core/wintabs.js) */
    pinned: false, group: null, tabHidden: false,
    hooks: { close: [], resize: [], focus: [], blur: [], reopen: [] },
    /* what it was opened with; js/core/reopen.js brings it back from these
       (and from state.reopen, which an app keeps current as it moves on) */
    opts: opts || {},
    state: {},
    lastFocus: null,
    setTitle(t)    { titleTx.textContent = t; el.setAttribute('aria-label', t); bus.emit('win:title', w); },
    setSubtitle(s) { subEl.textContent = s || ''; },
    setLead(...n)  { clear(leadEl); leadEl.append(...n.flat().filter(Boolean)); },
    setTools(...n) { clear(toolsEl); toolsEl.append(...n.flat().filter(Boolean)); },
    setBarClass(c) { if (c) bar.classList.add(c); },
    onClose(fn)    { w.hooks.close.push(fn); },
    onResize(fn)   { w.hooks.resize.push(fn); },
    onFocus(fn)    { w.hooks.focus.push(fn); },
    onBlur(fn)     { w.hooks.blur.push(fn); },
    onReopen(fn)   { w.hooks.reopen.push(fn); },
    close: () => close(id),
    focus: () => focus(w),
    minimize: () => minimize(w),
    restore: () => restore(w),
    toggleMax: () => toggleMax(w),
    snap: side => snap(w, side),
    moveToDesktop: (desk, o) => moveToDesktop(w, desk, o),
    get rect() { return { x: w.x, y: w.y, w: w.w, h: w.h }; },
  };

  wins.set(id, w);
  if (w.max) el.classList.add('is-max');
  syncAway(w);
  layer.appendChild(el);
  /* kept on top last session (its saved row), or when it was closed (reopen.js) */
  if ((row && row.pin === true) || opts.pin === true) setPinned(w, true);
  pinBtn.onclick = e => { e.stopPropagation(); setPinned(w, false); };

  lights.querySelector('.light--close').onclick = e => { e.stopPropagation(); close(id); };
  lights.querySelector('.light--min').onclick   = e => { e.stopPropagation(); minimize(w); };
  lights.querySelector('.light--max').onclick   = e => { e.stopPropagation(); toggleMax(w); };

  /* a pointer brings the window forward; where keyboard focus lands is the
     browser's business (the field that was clicked), so don't move it */
  on(el, 'pointerdown', () => focus(w, { dom: false }), true);
  on(el, 'focusin', e => { w.lastFocus = e.target; if (active !== w) focus(w, { dom: false }); });
  menuBtn.onclick = e => { e.stopPropagation(); bus.emit('win:menu', { win: w, anchor: menuBtn }); };
  on(bar, 'pointerdown', e => startMove(e, w));
  on(bar, 'dblclick', e => { if (!e.target.closest('button,input,.seg')) toggleMax(w); });
  for (const g of el.querySelectorAll('.win__grip')) {
    on(g, 'pointerdown', e => startResize(e, w, g.dataset.dir));
  }

  /* mount the app */
  try {
    const teardown = w.app.mount({ root: body, win: w, opts, api: window.StaticAPI });
    if (typeof teardown === 'function') w.hooks.close.push(teardown);
  } catch (err) {
    console.error(`[wm] ${appId} failed to mount`, err);
    body.appendChild(h('div.empty', icon('alert'), h('b', { text: 'This app crashed on launch' }),
      h('small', { text: String(err && err.message || err) })));
  }

  /* opened onto another desktop (a restored session): it waits there,
     unfocused, until you go to that desktop */
  if (here(w)) {
    animateOpen(w);
    focus(w);
  } else {
    el.classList.add('is-launched');   /* no entrance to play behind your back */
  }
  bus.emit('win:open', w);
  bus.emit('win:list', list());
  remember();
  return w;
}

function pickRect(opts) {
  const r = {};
  if (Number.isFinite(opts.x)) r.x = opts.x;
  if (Number.isFinite(opts.y)) r.y = opts.y;
  if (Number.isFinite(opts.w)) r.w = opts.w;
  if (Number.isFinite(opts.h)) r.h = opts.h;
  return r;
}

export function close(id) {
  const w = typeof id === 'object' ? id : wins.get(id);
  if (!w) return;
  w.hooks.close.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  const away = !here(w);
  const shrink = away ? null : animateClose(w);
  if (shrink) w.el.style.animation = 'none'; else if (!away) w.el.classList.add('is-closing');
  wins.delete(w.id);
  setTimeout(() => w.el.remove(), away ? 0 : shrink ? 240 : 200);
  if (active === w) {
    active = null;
    const next = topOn(DESK.current());
    if (next) focus(next); else bus.emit('win:focus', null);
  }
  /* focusing the next window raises it — keep the closing one above it until
     its exit animation finishes, or the animation is hidden after one frame */
  w.el.style.zIndex = nextZ() + pinLift(w);
  bus.emit('win:close', w);
  bus.emit('win:list', list());
  remember();
}

export function closeApp(appId) { byApp(appId).forEach(w => close(w.id)); }

/** No window active — for when focus moves to something on the desktop
    itself (the Linux wallpaper terminal), so window shortcuts like ⌘W and
    an app's own key handlers stand down instead of acting on a window the
    person is not looking at. */
export function blur() {
  if (!active) return;
  active.el.classList.remove('is-active');
  active.hooks.blur.forEach(fn => { try { fn(); } catch (e) {} });
  active = null;
  bus.emit('win:focus', null);
  bus.emit('win:list', list());
}

/* ---------- focus / minimize / maximize ----------------------------- */
/** Put keyboard focus inside a window: where it last was in that window,
    else the window itself. Leaves it alone when it is already inside. */
export function focusInto(w) {
  if (!w || !w.el.isConnected || w.min) return;
  const a = document.activeElement;
  if (a && w.el.contains(a)) return;
  const back = w.lastFocus;
  const usable = back && back.isConnected && w.el.contains(back) && back.getClientRects().length
    && !back.closest('[inert],[hidden]');
  try { (usable ? back : w.el).focus({ preventScroll: true }); } catch (e) { /* detached */ }
}

/**
 * Bring a window to the front. A window on another desktop takes you to
 * that desktop first. opts.lift: the switch came from outside the window
 * (the dock, ⌘Tab, the overview), so it rises with a short settle rather
 * than just appearing on top. opts.dom === false keeps keyboard focus
 * where it is (a pointer press: the browser is already moving it).
 */
export function focus(id, opts = {}) {
  const w = typeof id === 'object' && id ? id : wins.get(id);
  if (w && !here(w) && wins.has(w.id)) { switchDesktop(w.desk, { focus: w }); return w; }
  if (w && w.tabHidden && tabs) tabs.raise(w);
  if (w && opts.dom !== false) queueMicrotask(() => { if (active === w) focusInto(w); });
  if (!w || w === active) { if (w) { w.z = nextZ(); paintZ(w); } return w; }
  const covered = opts && opts.lift && topOn(DESK.current()) !== w;
  if (active) {
    active.el.classList.remove('is-active');
    active.hooks.blur.forEach(fn => { try { fn(); } catch (e) {} });
  }
  active = w;
  w.z = nextZ();
  paintZ(w);
  w.el.classList.add('is-active');
  if (covered && !w.min) lift(w);
  w.hooks.focus.forEach(fn => { try { fn(); } catch (e) {} });
  bus.emit('win:focus', w);
  bus.emit('win:list', list());
  return w;
}

/** App switching: the window comes forward with a small settle. */
function lift(w) {
  if (!canAnimate(w.el)) return;
  if (w.el.getAnimations().some(a => a.playState === 'running')) return;   /* already moving */
  w.el.animate([
    { transform: 'scale(.975)', transformOrigin: '50% 40%' },
    { transform: 'none', transformOrigin: '50% 40%' },
  ], { duration: T.lift, easing: EASE_OUT });
  track('win:focus', T.lift);
}

/* Minimise and restore animate from wherever the window is right now, so
   pressing one while the other is still playing turns it around smoothly
   instead of jumping to the start. */
function lookNow(w) {
  const running = w.motion && w.motion.playState === 'running';
  const cs = running || w.el.style.transform ? getComputedStyle(w.el) : null;
  const out = cs ? { transform: cs.transform || 'none', opacity: cs.opacity } : { transform: 'none', opacity: '1' };
  if (w.motion) { try { w.motion.cancel(); } catch (e) {} w.motion = null; }
  return out;
}

export function minimize(w) {
  if (!w || w.min) return;
  const away = !here(w);
  const target = away ? null : dockTarget(w.appId);
  w.min = true;
  const to = target
    ? `translate(${target.x - w.x}px,${target.y - w.y}px) scale(${Math.max(0.08, 44 / w.w)},${Math.max(0.08, 44 / w.h)})`
    : 'translateY(60px) scale(.82)';
  const from = lookNow(w);
  /* the end state lives in the inline style; the animation only plays the way there */
  Object.assign(w.el.style, { transformOrigin: 'top left', transition: '', transform: to, opacity: '0', pointerEvents: 'none' });
  if (!away && canAnimate(w.el)) {
    w.motion = w.el.animate([
      { transformOrigin: 'top left', transform: from.transform, opacity: from.opacity },
      { opacity: 1, offset: 0.55 },
      { transformOrigin: 'top left', transform: to, opacity: 0 },
    ], { duration: T.min, easing: EASE_IO });
    track('win:minimize', T.min);
    setTimeout(() => { if (w.min) w.el.style.visibility = 'hidden'; }, T.min + 10);
  } else {
    w.el.style.visibility = 'hidden';
  }
  if (active === w) {
    active.el.classList.remove('is-active');
    active = null;
    const next = topOn(DESK.current());
    if (next) focus(next); else bus.emit('win:focus', null);
  }
  bus.emit('win:minimize', w);
  bus.emit('win:list', list());
}

export function restore(w) {
  if (!w) return;
  if (!here(w) && wins.has(w.id)) switchDesktop(w.desk, { focus: w });
  const wasMin = w.min;
  w.min = false;
  const from = wasMin ? lookNow(w) : null;
  w.el.style.visibility = '';
  w.el.style.pointerEvents = '';
  Object.assign(w.el.style, { transition: '', transform: 'none', opacity: '1' });
  if (wasMin && canAnimate(w.el)) {
    w.motion = w.el.animate([
      { transformOrigin: 'top left', transform: from.transform, opacity: from.opacity },
      { opacity: 1, offset: 0.4 },
      { transformOrigin: 'top left', transform: 'none', opacity: 1 },
    ], { duration: T.restore, easing: EASE_OUT });
    track('win:restore', T.restore);
  }
  focus(w);
  bus.emit('win:restore', w);
  bus.emit('win:list', list());
}

export function toggleMax(w) {
  if (!w) return;
  if (w.max) {
    w.max = false;
    w.el.classList.remove('is-max');
    animateTo(w, w.prev || placeNew(w.app), 'win:unmaximize');
  } else {
    w.prev = w.rect;
    if (!w.snapped) w.free = w.rect;
    w.max = true;
    w.el.classList.add('is-max');
    animateTo(w, workArea(), 'win:maximize');
  }
  bus.emit('win:max', w);
}

/** Keep a window above the others (on = true), or stop (false); no `on` toggles. */
export function setPinned(w, on = !(w && w.pinned)) {
  if (!w || !wins.has(w.id) || !!w.pinned === !!on) return false;
  w.pinned = !!on;
  w.el.classList.toggle('is-pinned', w.pinned);
  paintZ(w);
  bus.emit('win:pin', w);
  remember();
  return true;
}

/**
 * Move a window to a new rect, animated FLIP-style: the real geometry is
 * set once (one layout for the app inside, one resize hook), then the
 * window is drawn from where it was to where it now is with a transform
 * the compositor runs. Animating left/top/width/height instead re-laid
 * out the whole app on every frame of every snap.
 */
function animateTo(w, r, label = 'win:snap') {
  const from = w.rect;
  /* the same snap asked for twice (⌃⌥← is bound in main.js and here) lets
     the first one finish instead of cutting it off */
  const there = Math.round(r.x) === w.x && Math.round(r.y) === w.y && Math.round(r.w) === w.w && Math.round(r.h) === w.h;
  if (there && w.geo) return;
  if (w.geo) { try { w.geo.cancel(); } catch (e) {} w.geo = null; }
  applyRect(w, r);
  if (!here(w) || w.min || !canAnimate(w.el)) return;
  const sx = from.w / (w.w || 1), sy = from.h / (w.h || 1);
  const dx = from.x - w.x, dy = from.y - w.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return;
  w.el.classList.add('is-snapping');
  const anim = w.el.animate([
    { transformOrigin: '0 0', transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },
    { transformOrigin: '0 0', transform: 'none' },
  ], { duration: T.geo, easing: EASE_OUT });
  w.geo = anim;
  track(label, T.geo);
  anim.finished.catch(() => {}).then(() => {
    if (w.geo !== anim) return;
    w.geo = null;
    w.el.classList.remove('is-snapping');
  });
}

/* ---------- snap layouts --------------------------------------------- */
/** Every place a window can snap to, as a rect inside the work area. */
export const SNAP_SIDES = ['left', 'right', 'top', 'max', 'up', 'down', 'tl', 'tr', 'bl', 'br', 'l3', 'c3', 'r3', 'l23', 'r23'];
export function snapRect(side) {
  const a = workArea();
  const W = a.w, H = a.h, x0 = a.x, y0 = a.y, t = W / 3;
  switch (side) {
    case 'left':  return { x: x0, y: y0, w: W / 2, h: H };
    case 'right': return { x: x0 + W / 2, y: y0, w: W / 2, h: H };
    /* 'top' stays maximise because that is what dragging to the top edge
       means everywhere; the half-height snaps are 'up' and 'down', which
       are reachable from the keyboard, the window menu and the layout
       picker on the maximise button. */
    case 'top': case 'max': return { ...a };
    case 'up':    return { x: x0, y: y0, w: W, h: H / 2 };
    case 'down':  return { x: x0, y: y0 + H / 2, w: W, h: H / 2 };
    case 'tl':    return { x: x0, y: y0, w: W / 2, h: H / 2 };
    case 'tr':    return { x: x0 + W / 2, y: y0, w: W / 2, h: H / 2 };
    case 'bl':    return { x: x0, y: y0 + H / 2, w: W / 2, h: H / 2 };
    case 'br':    return { x: x0 + W / 2, y: y0 + H / 2, w: W / 2, h: H / 2 };
    case 'l3':    return { x: x0, y: y0, w: t, h: H };
    case 'c3':    return { x: x0 + t, y: y0, w: t, h: H };
    case 'r3':    return { x: x0 + 2 * t, y: y0, w: t, h: H };
    case 'l23':   return { x: x0, y: y0, w: 2 * t, h: H };
    case 'r23':   return { x: x0 + t, y: y0, w: 2 * t, h: H };
    default: return null;
  }
}

export function snap(w, side) {
  if (!w) return;
  const r = snapRect(side);
  if (!r) return;
  if (side === 'top' || side === 'max') {
    if (!w.max) {
      w.prev = w.rect;
      if (!w.snapped) w.free = w.rect;
      w.max = true;
      w.el.classList.add('is-max');
    }
  } else {
    /* the first snap remembers the window's own size; snapping again from
       one layout to another keeps that, so dragging away gets it back */
    if (!w.snapped && !w.max) w.free = w.rect;
    w.prev = w.max ? w.prev : w.rect;
    w.max = false;
    w.el.classList.remove('is-max');
    w.snapped = side;
  }
  animateTo(w, r);
  bus.emit('win:snap', w);
}

/* ---------- keyboard geometry ----------------------------------------
   Move and resize without a pointer (the window menu's Move / Size modes
   in js/shell/a11y.js). Same rules as a drag: a moved window un-maximises
   (and leaves its snap layout) and stays reachable; a resized one respects
   the app's minimum size. */
function unseat(w) {
  if (w.geo) { try { w.geo.finish(); } catch (e) {} }
  const was = w.max || !!w.snapped;
  if (w.max) { w.max = false; w.el.classList.remove('is-max'); }
  /* placed by hand: a free window again, at the size it has now */
  w.snapped = null; w.free = null;
  if (was) bus.emit('win:unsnap', w);
}
export function moveBy(w, dx, dy) {
  if (!w || w.min) return;
  unseat(w);
  const a = workArea();
  applyRect(w, {
    x: clamp(w.x + dx, -w.w + 90, a.w - 90),
    y: clamp(w.y + dy, a.y, a.y + a.h - 40),
    w: w.w, h: w.h,
  });
  bus.emit('win:move', w);
}
export function resizeBy(w, dw, dh) {
  if (!w || w.min || w.app.win.resizable === false) return;
  unseat(w);
  const a = workArea();
  applyRect(w, {
    x: w.x, y: w.y,
    w: clamp(w.w + dw, w.app.win.minW, Math.max(w.app.win.minW, a.w - w.x)),
    h: clamp(w.h + dh, w.app.win.minH, Math.max(w.app.win.minH, a.y + a.h + 40 - w.y)),
  });
  bus.emit('win:resize', w);
}
export function setRect(w, r) { if (w && r) applyRect(w, r); }

/** Show (or with side null, hide) where a window would land — the layout picker uses it. */
export function previewSnap(w, side) { showGhost(side || null, w ? w.rect : null); }

/* ---------- drag to move -------------------------------------------- */
function zoneFor(px, py) {
  const a = workArea();
  const E = 14, C = 150;
  const CV = Math.min(C, a.h * 0.2);
  const nearL = px <= a.x + E, nearR = px >= a.w - E;
  const nearT = py <= a.y + E, nearB = py >= a.y + a.h - E;
  /* corners: along the top or bottom edge near a side, or along a side
     near the top or bottom */
  if ((nearT && px < C) || (nearL && py < a.y + CV)) return 'tl';
  if ((nearT && px > a.w - C) || (nearR && py < a.y + CV)) return 'tr';
  if ((nearB && px < C) || (nearL && py > a.y + a.h - CV)) return 'bl';
  if ((nearB && px > a.w - C) || (nearR && py > a.y + a.h - CV)) return 'br';
  if (nearT) return 'top';
  if (nearL) return 'left';
  if (nearR) return 'right';
  return null;
}

/* The translucent preview of where a window will land. It is sized for
   its target once, then drawn growing out of where it was (the window,
   or the last zone) with a transform. */
let ghostSide = null;
let ghostRect = null;
let ghostAnim = null;
function flipFrom(from, to) {
  return `translate(${from.x - to.x}px,${from.y - to.y}px) scale(${from.w / (to.w || 1)},${from.h / (to.h || 1)})`;
}
function showGhost(side, from) {
  if (!ghost || side === ghostSide) return;
  if (!side) { ghostSide = null; ghost.classList.remove('is-on'); return; }
  const r = snapRect(side);
  if (!r) return;
  const start = ghost.classList.contains('is-on') && ghostRect ? ghostRect : from;
  Object.assign(ghost.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  ghost.dataset.side = side;
  ghostSide = side;
  ghostRect = r;
  ghost.classList.add('is-on');
  if (start && canAnimate(ghost)) {
    if (ghostAnim) { try { ghostAnim.cancel(); } catch (e) {} }
    ghostAnim = ghost.animate([
      { transformOrigin: '0 0', transform: flipFrom(start, r) },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: T.ghost, easing: EASE_OUT });
  }
}

function startMove(e, w) {
  if (e.button !== 0) return;
  if (e.target.closest('button,input,select,textarea,.seg,.tabs,a')) return;
  focus(w);
  const a = workArea();
  const sx = e.clientX, sy = e.clientY;
  let ox = e.clientX - w.x, oy = e.clientY - w.y;
  /* A snapped or maximised window stays put until the pointer really
     moves: a click on its title bar used to drop it back to its old size. */
  let seated = w.max || !!w.snapped;
  const startRect = w.rect;
  const startState = { max: w.max, snapped: w.snapped, prev: w.prev, free: w.free };
  if (w.geo) { try { w.geo.finish(); } catch (err) {} }
  let zone = null;
  let drop = null;     /* a window whose title bar it would join as a tab */
  moving = w;
  w.el.classList.add('is-dragging');
  /* Capture the pointer only once it really moves: capturing on press sent
     the click — and so the double-click — to the window instead of the
     title bar, and double-click to maximise never fired. */
  let captured = false;

  const move = ev => {
    if (!captured && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) >= 3) {
      captured = true;
      try { w.el.setPointerCapture?.(ev.pointerId); } catch (err) { /* pointer already gone */ }
    }
    if (seated) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
      seated = false;
      /* dragged away: back to the size it had before it was snapped, under
         the pointer at the same point along the title bar */
      const ratio = (sx - w.x) / (w.w || 1);
      const back = w.free || w.prev || placeNew(w.app);
      w.max = false; w.snapped = null; w.free = null;
      w.el.classList.remove('is-max');
      applyRect(w, { ...back, x: ev.clientX - back.w * ratio, y: Math.max(a.y, ev.clientY - 18) });
      ox = ev.clientX - w.x; oy = ev.clientY - w.y;
      bus.emit('win:unsnap', w);
    }
    applyRect(w, { x: ev.clientX - ox, y: Math.max(a.y - 0, ev.clientY - oy), w: w.w, h: w.h });
    zone = zoneFor(ev.clientX, ev.clientY);
    /* the screen's edges snap; anywhere else, another window's title bar takes it as a tab */
    drop = tabs ? tabs.over(zone ? null : w, ev.clientX, ev.clientY) : null;
    showGhost(drop ? null : zone, w.rect);
  };
  const up = () => {
    cleanup();
    if (!seated) { if (drop) tabs.drop(w, drop); else if (zone) snap(w, zone); else keepInView(w); }
    bus.emit('win:move', w);
  };
  const key = ev => {
    if (ev.key !== 'Escape') return;
    cleanup();
    Object.assign(w, startState);
    w.el.classList.toggle('is-max', !!w.max);
    applyRect(w, startRect);
  };
  function cleanup() {
    if (moving === w) moving = null;
    w.el.classList.remove('is-dragging');
    showGhost(null);
    if (tabs) tabs.over(null);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    window.removeEventListener('keydown', key, true);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  window.addEventListener('keydown', key, true);
  e.preventDefault();
}
/** Carry on a press that began elsewhere as a title-bar drag (a tab torn out of its group). */
export const beginMove = (w, ev) => startMove({ button: 0, target: w.bar, clientX: ev.clientX, clientY: ev.clientY, pointerId: ev.pointerId, preventDefault() {} }, w);

/* ---------- drag to resize ------------------------------------------ */
function startResize(e, w, dir) {
  if (e.button !== 0) return;
  focus(w);
  const a = workArea();
  if (w.geo) { try { w.geo.finish(); } catch (err) {} }
  const s = w.rect;
  const sx = e.clientX, sy = e.clientY;
  const minW = w.app.win.minW, minH = w.app.win.minH;
  w.el.classList.add('is-dragging');
  if (w.max) { w.max = false; w.el.classList.remove('is-max'); }
  /* sized by hand: it is a free window again, at the size you give it */
  w.snapped = null; w.free = null;

  const move = ev => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    let { x, y, w: ww, h: hh } = s;
    if (dir.includes('e')) ww = clamp(s.w + dx, minW, a.w - s.x);
    if (dir.includes('s')) hh = clamp(s.h + dy, minH, a.y + a.h + 40 - s.y);
    if (dir.includes('w')) { const nx = clamp(s.x + dx, -200, s.x + s.w - minW); ww = s.w + (s.x - nx); x = nx; }
    if (dir.includes('n')) { const ny = clamp(s.y + dy, a.y, s.y + s.h - minH); hh = s.h + (s.y - ny); y = ny; }
    applyRect(w, { x, y, w: ww, h: hh });
  };
  const up = () => {
    w.el.classList.remove('is-dragging');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    bus.emit('win:resize', w);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  e.preventDefault(); e.stopPropagation();
}

/* ---------- desktops: switch, move, remove, swipe --------------------- */
let slideAnims = [];
let slideToken = 0;
/** Finish any desktop slide still playing, so a new one starts from rest. */
function settleSlide() {
  slideToken++;
  slideAnims.splice(0).forEach(a => { try { a.cancel(); } catch (e) {} });
  for (const w of wins.values()) w.el.classList.remove('is-leaving', 'is-peek');
}
const slideWidth = () => window.innerWidth + 48;   /* a little past the edge, so shadows clear it too */

function slide(leaving, coming, dir, from = 0) {
  if (!leaving.length && !coming.length) return;
  if (reduced() || typeof Element.prototype.animate !== 'function') return;
  const W = slideWidth();
  const left = 1 - Math.min(0.85, Math.abs(from) / W);       /* a swipe already part-way there finishes sooner */
  const opts = { duration: Math.round(Math.max(200, T.desk * left)), easing: SLIDE };
  const token = slideToken;
  for (const w of leaving) {
    w.el.classList.add('is-leaving');
    const a = w.el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${-dir * W}px)` }], { ...opts, fill: 'forwards' });
    slideAnims.push(a);
    a.finished.then(() => { if (token !== slideToken) return; w.el.classList.remove('is-leaving'); a.cancel(); }, () => {});
  }
  for (const w of coming) {
    slideAnims.push(w.el.animate([{ transform: `translateX(${dir * W + from}px)` }, { transform: 'none' }], opts));
  }
  track('desktop:switch', opts.duration);
}

/**
 * Show another desktop. Its windows slide in from the side it sits on and
 * the current ones slide out the other way; the frontmost window there
 * (or opts.focus) becomes active.
 *   opts.focus  a window to focus once there
 *   opts.from   start the slide part-way (px), as a swipe hands it over
 *   opts.still  windows that stay where they are (one being carried along)
 */
export function switchDesktop(id, opts = {}) {
  if (!DESK.has(id)) return false;
  const prev = DESK.current();
  if (id === prev) { if (opts.focus) focus(opts.focus); return false; }
  const dir = DESK.indexOf(id) > DESK.indexOf(prev) ? 1 : -1;
  const from = Number(opts.from) || 0;
  const still = opts.still instanceof Set ? opts.still : new Set();
  /* a window you are dragging comes with you, as it does on a Mac */
  if (moving && wins.has(moving.id) && moving.desk === prev && !moving.min) {
    moving.desk = id;
    still.add(moving);
    bus.emit('win:desk', moving);
  }
  settleSlide();
  const leaving = list().filter(w => w.desk === prev && !w.min && !still.has(w));
  const coming = list().filter(w => w.desk === id && !w.min && !still.has(w));

  /* whatever you were typing in stays yours for when you come back */
  const ae = document.activeElement;
  if (active && ae && active.el.contains(ae)) { active.lastFocus = ae; }
  if (ae && leaving.some(w => w.el.contains(ae))) ae.blur?.();
  if (active) {
    active.el.classList.remove('is-active');
    active.hooks.blur.forEach(fn => { try { fn(); } catch (e) {} });
    active = null;
  }

  DESK._setCurrent(id);
  for (const w of wins.values()) syncAway(w);
  slide(leaving, coming, dir, from);

  const target = opts.focus && wins.has(opts.focus.id) && here(opts.focus) ? opts.focus : topOn(id);
  if (target) {
    focus(target);
    const back = target.lastFocus;
    if (back && back.isConnected && target.el.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
  } else bus.emit('win:focus', null);
  bus.emit('desktop:switch', { from: prev, to: id, dir });
  bus.emit('win:list', list());
  if (still.size) remember();
  return true;
}

/** Previous (-1) or next (+1) desktop; false at the ends. */
export function switchBy(dir) {
  const id = DESK.neighbour(DESK.current(), dir);
  return id ? switchDesktop(id) : false;
}

/**
 * Put a window on another desktop. From the one you are looking at it
 * slides off toward that desktop's side. opts.follow: go with it.
 */
export function moveToDesktop(w, deskId, opts = {}) {
  if (typeof w !== 'object') w = wins.get(w);
  if (!w || !wins.has(w.id) || !DESK.has(deskId) || w.desk === deskId) return false;
  const cur = DESK.current();
  const wasHere = w.desk === cur;
  const dir = DESK.indexOf(deskId) > DESK.indexOf(w.desk) ? 1 : -1;
  w.desk = deskId;
  if (opts.follow) {
    switchDesktop(deskId, { focus: w, still: new Set([w]) });
  } else if (wasHere) {
    if (active === w) {
      w.el.classList.remove('is-active');
      w.hooks.blur.forEach(fn => { try { fn(); } catch (e) {} });
      active = null;
      const next = topOn(cur);
      if (next) focus(next); else bus.emit('win:focus', null);
    }
    if (!w.min && canAnimate(w.el) && opts.animate !== false) {
      w.el.classList.add('is-leaving');
      const a = w.el.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translateX(${dir * 90}px) scale(.92)`, opacity: 0 },
      ], { duration: T.move, easing: EASE_IN, fill: 'forwards' });
      track('win:to-desktop', T.move);
      a.finished.then(() => { w.el.classList.remove('is-leaving'); a.cancel(); }, () => {});
    }
    syncAway(w);
  } else {
    syncAway(w);
    if (deskId === cur && !w.min && canAnimate(w.el) && opts.animate !== false) {
      w.el.animate([
        { transform: `translateX(${-dir * 90}px) scale(.92)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ], { duration: T.move, easing: EASE_OUT });
      track('win:to-desktop', T.move);
    }
  }
  bus.emit('win:desk', w);
  bus.emit('win:list', list());
  remember();
  return true;
}

/** Remove a desktop; its windows join the desktop before it (or after, for the first). */
export function removeDesktop(id) {
  if (DESK.count() <= 1 || !DESK.has(id)) return false;
  const into = DESK.neighbour(id, -1) || DESK.neighbour(id, 1);
  const orphans = list().filter(w => w.desk === id);
  orphans.forEach(w => { w.desk = into; });
  if (DESK.current() === id) switchDesktop(into, { still: new Set(orphans) });
  else orphans.forEach(syncAway);
  DESK._remove(id);
  orphans.forEach(w => bus.emit('win:desk', w));
  bus.emit('win:list', list());
  remember();
  return true;
}

/** Add a desktop (at the end); returns it, or null when there are already DESK.MAX. */
export function addDesktop(opts) { return DESK.add(opts || {}); }

/**
 * A swipe that follows the finger: the shell calls move(dx) as a trackpad
 * or touch drag goes on and end(velocity) when it lets go. The current
 * desktop's windows move with it and the neighbour's come in from the
 * side; past a fifth of the screen (or flicked) it goes there, otherwise
 * it springs back. At the first and last desktop it only gives a little.
 */
export function deskDrag() {
  settleSlide();
  const cur = DESK.current();
  const W = slideWidth();
  const mine = list().filter(w => w.desk === cur && !w.min);
  const sides = { '-1': DESK.neighbour(cur, -1), '1': DESK.neighbour(cur, 1) };
  const peers = {
    '-1': sides['-1'] ? list().filter(w => w.desk === sides['-1'] && !w.min) : [],
    '1': sides['1'] ? list().filter(w => w.desk === sides['1'] && !w.min) : [],
  };
  const put = (w, x) => { w.el.style.transform = x ? `translateX(${x}px)` : ''; };
  let dx = 0;
  let done = false;

  function move(raw) {
    if (done) return;
    const dir = raw < 0 ? 1 : -1;            /* pulling content left brings in the next desktop */
    const target = sides[dir];
    dx = clamp(target ? raw : raw * 0.2, -W, W);
    mine.forEach(w => put(w, dx));
    for (const d of [-1, 1]) {
      const show = d === dir && !!target;
      peers[d].forEach(w => { w.el.classList.toggle('is-peek', show); put(w, show ? dx + d * W : 0); });
    }
  }
  function end(velocity = 0) {
    if (done) return null;
    done = true;
    const dir = dx < 0 ? 1 : -1;
    const target = sides[dir];
    const flung = Math.abs(velocity) > 0.45 && Math.sign(velocity) === Math.sign(dx);
    const go = !!target && Math.abs(dx) > 8 && (Math.abs(dx) > W * 0.2 || flung);
    const all = [...mine, ...peers['-1'], ...peers['1']];
    all.forEach(w => put(w, 0));
    for (const w of all) w.el.classList.remove('is-peek');
    if (go) { switchDesktop(target, { from: dx }); return target; }
    if (Math.abs(dx) > 0.5 && !reduced() && typeof Element.prototype.animate === 'function') {
      const opts = { duration: T.back, easing: EASE_OUT };
      mine.forEach(w => slideAnims.push(w.el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], opts)));
      if (target) {
        const token = slideToken;
        peers[dir].forEach(w => {
          w.el.classList.add('is-peek');
          const a = w.el.animate([{ transform: `translateX(${dx + dir * W}px)` }, { transform: `translateX(${dir * W}px)` }], { ...opts, fill: 'forwards' });
          slideAnims.push(a);
          a.finished.then(() => { if (token !== slideToken) return; w.el.classList.remove('is-peek'); a.cancel(); }, () => {});
        });
      }
      track('desktop:spring-back', T.back);
    }
    return null;
  }
  return { move, end, width: W, prev: sides['-1'], next: sides['1'] };
}

/* ---------- entrance / exit ------------------------------------------ */
/**
 * Grow the window out of the dock icon it was launched from, and bounce that
 * icon, so a launch reads as one movement instead of a window appearing.
 * Falls back to the CSS keyframe when the app has no dock icon.
 */
function animateOpen(w) {
  if (reduced() || typeof w.el.animate !== 'function') return;
  const t = dockTarget(w.appId);
  /* The dock rebuilds its items on several events, so a class set here would
     be thrown away. Announce the launch instead and let the dock paint it. */
  bus.emit('app:launch', w.appId);
  track('win:open', T.open);
  if (!t) return;

  w.el.style.animation = 'none';                 // replace the CSS entrance
  const dx = (t.x + 22) - (w.x + w.w / 2);
  const dy = (t.y + 22) - (w.y + w.h / 2);
  /* transform and opacity only: the blur this used to fade through made
     the compositor re-filter a window-sized texture on every frame */
  const anim = w.el.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(.16)`, transformOrigin: '50% 50%', opacity: 0 },
    { opacity: 1, offset: 0.45 },
    { transform: 'translate(0,0) scale(1)', transformOrigin: '50% 50%', opacity: 1 },
  ], { duration: T.open, easing: EASE_OUT, fill: 'backwards' });
  /* Hand back to the stylesheet WITHOUT re-arming the CSS entrance: clearing
     the inline 'animation:none' alone re-applied `win-open`, so every window
     launched from the dock faded in a second time ~0.4 s after opening. */
  anim.finished.catch(() => {}).then(() => { w.el.classList.add('is-launched'); w.el.style.animation = ''; });
}

/** Shrink back into the dock on close, mirroring the entrance. */
function animateClose(w) {
  if (reduced() || typeof w.el.animate !== 'function') return null;
  track('win:close', T.close);
  const t = dockTarget(w.appId);
  if (!t) return null;
  const dx = (t.x + 22) - (w.x + w.w / 2);
  const dy = (t.y + 22) - (w.y + w.h / 2);
  return w.el.animate([
    { transform: 'none', transformOrigin: '50% 50%', opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(.16)`, transformOrigin: '50% 50%', opacity: 0 },
  ], { duration: T.close, easing: EASE_IN, fill: 'forwards' });
}

/* ---------- dock coordination --------------------------------------- */
function dockTarget(appId) {
  /* an app in a dock folder (js/shell/dockfolders.js) flies to the folder */
  const el = document.querySelector(`.dock__item[data-app="${appId}"]`) || document.querySelector(`.dock__item[data-apps~="${appId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - 22, y: r.top + r.height / 2 - 22 };
}

/* ---------- queries -------------------------------------------------- */
export const list   = () => [...wins.values()];
export const byApp  = id => [...wins.values()].filter(w => w.appId === id);
export const get    = id => wins.get(id) || null;
export const getActive = () => active;
export const stacked = () => [...wins.values()].sort((a, b) => b.z - a.z);
/** The windows on one desktop (the current one by default). */
export const onDesktop = (desk = DESK.current()) => [...wins.values()].filter(w => w.desk === desk);
export const desktops = DESK;

export function cycle(dir = 1) {
  const order = onDesktop().filter(shown).sort((a, b) => b.z - a.z);
  if (order.length < 2) { if (order[0]) focus(order[0]); return; }
  const i = active ? order.indexOf(active) : 0;
  const next = order[(i + dir + order.length) % order.length];
  focus(next, { lift: true });
}

/** Toggle: click a dock icon → open, focus, or minimize. */
export function toggleApp(appId, opts) {
  const mine = byApp(appId);
  if (!mine.length) return open(appId, opts);
  const hereOnes = mine.filter(here);
  if (!hereOnes.length) {
    /* all of its windows are on other desktops: go to the frontmost one */
    const w = mine.filter(x => !x.min).sort((a, b) => b.z - a.z)[0] || mine[0];
    if (w.min) restore(w); else focus(w);
    return w;
  }
  const hiddenOnes = hereOnes.filter(w => w.min);
  if (hiddenOnes.length === hereOnes.length) { restore(hiddenOnes[0]); return hiddenOnes[0]; }
  if (active && active.appId === appId) { minimize(active); return active; }
  const top = hereOnes.filter(w => !w.min).sort((a, b) => b.z - a.z)[0];
  focus(top, { lift: true });
  return top;
}

/* ---------- keyboard ------------------------------------------------- */
/* the keys are the person's own (Settings › Shortcuts): js/core/keymap.js */
function bindGlobalKeys() {
  window.addEventListener('keydown', e => {
    if (!active) return;
    const a = document.activeElement;
    const typing = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
    if (KM.matches(e, 'win.close')) { e.preventDefault(); close(active.id); }
    else if (KM.matches(e, 'win.min') && !typing) { e.preventDefault(); minimize(active); }
    else if (KM.matches(e, 'win.snapLeft')) { e.preventDefault(); snap(active, 'left'); }
    else if (KM.matches(e, 'win.snapRight')) { e.preventDefault(); snap(active, 'right'); }
    else if (KM.matches(e, 'win.maxSnap')) { e.preventDefault(); snap(active, 'max'); }
  });
}

export const wm = {
  mountWM, open, close, closeApp, focus, blur, minimize, restore, toggleMax, snap, snapRect, previewSnap,
  list, byApp, get, getActive, stacked, cycle, toggleApp, workArea, redirectApp,
  focusInto, moveBy, resizeBy, setRect, setPinned, beginMove, useTabs,
  switchDesktop, switchBy, moveToDesktop, removeDesktop, addDesktop, deskDrag, onDesktop, desktops: DESK,
};
export default wm;
