/* ============================================================
   wintabs.js — windows grouped as tabs.

   Drag a window by its title bar onto another window's title bar:
   the one underneath lights up, and letting go makes the two one
   frame with a strip of tabs under the title bar.
     click a tab                   show it
     drag a tab off the strip      a window of its own again (it
                                   carries on as an ordinary drag, so
                                   it can be snapped or dropped onto
                                   another window straight away)
     × on a tab, middle-click,     close that tab — only its app
     ⌘W / Ctrl+W on the shown one
     Ctrl+Tab / Ctrl+Shift+Tab     next / previous tab (a browser keeps
                                   Ctrl+Tab for its own tabs; the window
                                   menu, Ctrl+Alt+Space, has Next Tab)
     arrows on the strip           move between tabs; Enter shows one;
                                   Delete closes one
   The group moves, snaps, maximises, minimises, is kept on top and
   changes desktop as one.

   Every tab is still a window of its own (js/core/wm.js) with its app
   mounted once, in its own body: nothing is moved or mounted again,
   and closing a tab tears down only that app. The selected tab is
   shown and the others wait hidden at the same place (w.tabHidden),
   the way a Mac draws window tabs — so wm.getActive() is always the
   selected tab, and whatever reads "the front window" (Screen Time,
   the reopen stack, the shortcut sheet) gets that tab's app. What the
   shown tab does to its place the others follow, and a tab coming to
   the front takes the frame's place first.

   Not kept: groups are not saved across a reload, and a closed tab
   comes back (⇧⌘T) as a window of its own. Phones have no groups.
   ============================================================ */
import { bus } from './bus.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { covered } from './cover.js';
import * as wm from './wm.js';
import * as DESK from './desktops.js';

const TEAR = 22;          /* px off the strip before a dragged tab comes out */
const phone = () => document.body.classList.contains('is-mobile');
const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const say = t => bus.emit('a11y:say', t);
const nameOf = w => w.el.getAttribute('aria-label') || w.app.name;
const winOf = node => {
  const b = node && node.closest && node.closest('.win-tab');
  return b ? wm.get(Number(b.dataset.win)) : null;
};

let gseq = 0;
/* our own changes to a tab set off the same events as yours; while busy,
   follow() leaves them alone */
let busy = 0;

/* ---------- the strip ------------------------------------------------ */
function stripOf(w) {
  if (w.tabStrip) return w.tabStrip;
  const el = h('div.win-tabs', { role: 'tablist', 'aria-label': 'Tabs' });
  el.addEventListener('pointerdown', press);
  el.addEventListener('click', click);
  el.addEventListener('auxclick', e => {
    const t = e.button === 1 ? winOf(e.target) : null;
    if (t) { e.preventDefault(); wm.close(t.id); }
  });
  el.addEventListener('keydown', key);
  w.el.insertBefore(el, w.body);
  w.tabStrip = el;
  return el;
}

function paint(g) {
  for (const m of g.tabs) {
    stripOf(m).replaceChildren(...g.tabs.map(t => {
      const on = t === g.active;
      return h('button.win-tab' + (on ? '.is-on' : ''), {
        type: 'button', role: 'tab', 'aria-selected': String(on), tabindex: on ? '0' : '-1',
        dataset: { win: String(t.id) }, title: nameOf(t),
      },
        icon(t.app.icon),
        h('span.win-tab__name', { text: nameOf(t) }),
        /* the pointer's close button; from the keyboard, Delete on the tab */
        h('span.win-tab__x', { 'aria-hidden': 'true', title: 'Close tab' }, icon('x')));
    }));
  }
}

function click(e) {
  const t = winOf(e.target);
  if (!t) return;
  if (e.target.closest('.win-tab__x')) { wm.close(t.id); return; }
  const fromKeys = e.detail === 0;          /* Enter or Space */
  wm.focus(t);
  /* after wm.focus's own move into the window: stay on the strip */
  if (fromKeys) queueMicrotask(() => t.tabStrip?.querySelector('.win-tab.is-on')?.focus({ preventScroll: true }));
}

function key(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const all = [...e.currentTarget.querySelectorAll('.win-tab')];
  const i = all.indexOf(document.activeElement);
  if (i < 0) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    const t = winOf(all[i]);
    if (t) wm.close(t.id);
    return;
  }
  const n = all.length;
  const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  e.stopPropagation();
  all.forEach((b, k) => { b.tabIndex = k === j ? 0 : -1; });
  all[j].focus();
}

/* A tab pressed and pulled off the strip comes out as a window of its own. */
function press(e) {
  const b = e.target.closest && e.target.closest('.win-tab');
  if (!b || e.button !== 0 || e.target.closest('.win-tab__x')) return;
  const t = wm.get(Number(b.dataset.win));
  if (!t || !t.group) return;
  const strip = b.parentElement;
  e.preventDefault();                       /* no text selection while it is pulled */
  const move = ev => {
    const r = strip.getBoundingClientRect();
    if (ev.clientY > r.top - TEAR && ev.clientY < r.bottom + TEAR) return;
    done();
    tearOut(t, ev);
  };
  const done = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', done);
    window.removeEventListener('pointercancel', done);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', done);
  window.addEventListener('pointercancel', done);
}

/* ---------- membership ------------------------------------------------ */
function adopt(m, g) {
  m.group = g;
  m.el.classList.add('is-tabbed');
  stripOf(m);
  /* runs inside wm.close, before the window manager picks what to focus
     next — so the next tab is already the one in front */
  if (!m.tabsHooked) { m.tabsHooked = true; m.onClose(() => leave(m, true)); }
}

/** Back to a plain window: no strip, nothing hidden. */
function release(m) {
  m.group = null;
  m.tabHidden = false;
  m.el.classList.remove('is-tabbed', 'is-tab-behind', 'is-tab-target', 'is-tab-drag');
  if (m.tabStrip) { m.tabStrip.remove(); m.tabStrip = null; }
  wm.setRect(m, m.rect);                    /* the strip's room goes back to the app */
}

function show(g, w) {
  g.active = w;
  for (const m of g.tabs) {
    const behind = m !== w;
    m.tabHidden = behind;
    m.el.classList.toggle('is-tab-behind', behind);
  }
}

/** Give `to` the frame's place and state: where it is, snapped or
    maximised, the size to go back to, kept on top, its desktop. */
function copy(from, to) {
  if (from === to) return;
  busy++;
  try {
    if (to.desk !== from.desk) wm.moveToDesktop(to, from.desk, { animate: false });
    to.max = from.max; to.snapped = from.snapped; to.free = from.free; to.prev = from.prev;
    to.el.classList.toggle('is-max', !!to.max);
    const a = from.rect, b = to.rect;
    if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) wm.setRect(to, a);
    if (!!to.pinned !== !!from.pinned) wm.setPinned(to, !!from.pinned);
  } finally { busy--; }
}

/** A window that jumped into place is drawn from where it was (transform only). */
function flip(w, from) {
  if (reduced() || typeof w.el.animate !== 'function') return;
  const sx = from.w / (w.w || 1), sy = from.h / (w.h || 1), dx = from.x - w.x, dy = from.y - w.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return;
  w.el.animate([
    { transformOrigin: '0 0', transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },
    { transformOrigin: '0 0', transform: 'none' },
  ], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
}

/** Make `w` (and any tabs it already had) tabs of `target`'s frame, `w` in front. */
export function join(target, w) {
  if (!target || !w || target === w || (w.group && w.group === target.group) || phone()) return false;
  const from = w.rect;
  let g = target.group;
  if (!g) { g = { id: ++gseq, tabs: [target], active: target }; adopt(target, g); }
  const incoming = w.group ? [...w.group.tabs] : [w];
  if (w.group) w.group.tabs = [];
  let at = g.tabs.indexOf(target) + 1;
  for (const m of incoming) { g.tabs.splice(at++, 0, m); adopt(m, g); copy(target, m); }
  show(g, w);
  paint(g);
  /* every tab now has a strip over its app: tell each app its new size */
  for (const m of g.tabs) wm.setRect(m, m.rect);
  flip(w, from);
  wm.focus(w);
  bus.emit('win:list', wm.list());
  say(`${nameOf(w)} added as a tab beside ${nameOf(target)}`);
  return true;
}

/** Take `m` out of its group. closing: it is going away, leave it as it is. */
function leave(m, closing) {
  const g = m.group;
  if (!g) return;
  const i = g.tabs.indexOf(m);
  if (i >= 0) g.tabs.splice(i, 1);
  const wasFront = g.active === m;
  if (closing) m.group = null; else release(m);
  if (wasFront && g.tabs.length) {
    const next = g.tabs[Math.min(Math.max(0, i), g.tabs.length - 1)];
    copy(m, next);
    /* it takes the leaving tab's place in the stack, so it is what the
       window manager brings forward next */
    next.z = m.z;
    next.el.style.zIndex = m.el.style.zIndex;
    show(g, next);
  }
  if (g.tabs.length === 1) { const last = g.tabs[0]; g.tabs = []; release(last); }
  else if (g.tabs.length) paint(g);
  if (!closing) bus.emit('win:list', wm.list());
}

function tearOut(t, ev) {
  const g = t.group;
  if (!g) return;
  const frame = g.active.rect;
  /* its own size from before the group was snapped or maximised, else the frame's */
  const own = t.free || (t.max ? t.prev : null) || frame;
  leave(t, false);
  t.max = false; t.snapped = null; t.free = null;
  t.el.classList.remove('is-max');
  wm.setRect(t, { x: ev.clientX - Math.min(own.w / 2, 160), y: Math.max(wm.workArea().y, ev.clientY - 16), w: own.w, h: own.h });
  wm.beginMove(t, ev);
  say(`${nameOf(t)} is a window of its own again`);
}

/** The window menu's "Move Tab to New Window": out, a little down and right. */
export function detach(w) {
  const g = w && w.group;
  if (!g) return false;
  const own = w.free || (w.max ? w.prev : null) || g.active.rect;
  leave(w, false);
  w.max = false; w.snapped = null; w.free = null;
  w.el.classList.remove('is-max');
  const a = wm.workArea();
  wm.setRect(w, {
    x: Math.min(Math.max(0, own.x + 32), Math.max(0, a.w - own.w)),
    y: Math.min(Math.max(a.y, own.y + 32), Math.max(a.y, a.y + a.h - own.h)),
    w: own.w, h: own.h,
  });
  wm.focus(w);
  say(`${nameOf(w)} is a window of its own again`);
  return true;
}

/** Show the next (d = 1) or previous (-1) tab of w's group. */
export function step(w, d = 1) {
  const g = w && w.group;
  if (!g || g.tabs.length < 2) return null;
  const i = g.tabs.indexOf(g.active);
  const next = g.tabs[(i + d + g.tabs.length) % g.tabs.length];
  wm.focus(next);
  say(`${nameOf(next)}, tab ${g.tabs.indexOf(next) + 1} of ${g.tabs.length}`);
  return next;
}

/** The tabs of w's group, in strip order (empty when it has none). */
export const tabsOf = w => (w && w.group ? [...w.group.tabs] : []);

/* ---------- the window manager's side (wm.useTabs) ------------------- */
/** A hidden tab is being focused: bring it to the front of its group. */
function raise(w) {
  const g = w.group;
  if (!g) { w.tabHidden = false; return; }
  if (g.active === w) return;
  copy(g.active, w);
  show(g, w);
  paint(g);
}

/* While a window is dragged by its title bar: the window whose title bar
   (or tab strip) is under the pointer, highest first. A window body on top
   of a title bar hides it, as it does from the eye. */
let hint = null;
function targetAt(w, x, y) {
  const desk = DESK.current();
  const zOf = o => parseFloat(o.el.style.zIndex) || 0;
  const under = wm.list()
    .filter(o => o !== w && !(w.group && o.group === w.group) && o.desk === desk && !o.min && !o.tabHidden
      && o.el.isConnected && !o.el.classList.contains('is-closing'))
    .sort((a, b) => zOf(b) - zOf(a));
  for (const o of under) {
    if (x < o.x || x > o.x + o.w || y < o.y || y > o.y + o.h) continue;
    const head = o.bar.offsetHeight + (o.tabStrip ? o.tabStrip.offsetHeight : 0);
    return y <= o.y + head ? o : null;
  }
  return null;
}
function setHint(t, w) {
  if (hint && t && hint.t === t && hint.w === w) return;
  if (hint) { hint.t.el.classList.remove('is-tab-target'); hint.w.el.classList.remove('is-tab-drag'); }
  hint = t && w ? { t, w } : null;
  if (hint) { t.el.classList.add('is-tab-target'); w.el.classList.add('is-tab-drag'); }
}
function over(w, x, y) {
  const t = w && !phone() ? targetAt(w, x, y) : null;
  setHint(t, w);
  return t;
}
function drop(w, t) {
  setHint(null);
  return join(t, w);
}

/* ---------- the rest of the group follows the shown tab --------------- */
function follow(w) {
  const g = w && w.group;
  if (busy || !g || g.active !== w) return;
  for (const m of g.tabs) if (m !== w) copy(w, m);
}

function onMinimize(w) {
  const g = w && w.group;
  if (busy || !g) return;
  /* a hidden tab minimised on its own: the whole group goes */
  if (g.active !== w) { if (!g.active.min) wm.minimize(g.active); return; }
  /* the others wait minimised too, drawn where the shown one went, so
     restoring any of them (its dock icon) flies the group back from there */
  for (const m of g.tabs) {
    if (m === w || m.min) continue;
    m.min = true;
    Object.assign(m.el.style, { transformOrigin: w.el.style.transformOrigin, transform: w.el.style.transform, opacity: '0', pointerEvents: 'none', visibility: 'hidden' });
  }
}

function onRestore(w) {
  const g = w && w.group;
  if (!g) return;
  for (const m of g.tabs) {
    if (m === w || !m.min) continue;
    m.min = false;
    if (m.motion) { try { m.motion.cancel(); } catch (e) { /* done already */ } m.motion = null; }
    Object.assign(m.el.style, { visibility: '', pointerEvents: '', transform: 'none', opacity: '1' });
  }
}

function onKey(e) {
  if (e.key !== 'Tab' || !e.ctrlKey || e.metaKey || e.altKey || covered()) return;
  const w = wm.getActive();
  if (!w || !w.group) return;
  e.preventDefault();
  e.stopImmediatePropagation();             /* main.js's Ctrl+Tab = next window */
  step(w, e.shiftKey ? -1 : 1);
}

let started = false;
/** Start grouping windows as tabs. Safe to call twice. */
export function init() {
  if (started || typeof window === 'undefined') return;
  started = true;
  wm.useTabs({ raise, over, drop });
  for (const ev of ['win:move', 'win:resize', 'win:snap', 'win:unsnap', 'win:max', 'win:desk', 'win:pin']) bus.on(ev, follow);
  bus.on('win:minimize', onMinimize);
  bus.on('win:restore', onRestore);
  bus.on('win:title', w => { if (w && w.group) paint(w.group); });
  window.addEventListener('keydown', onKey, true);
}

export default { init, join, detach, step, tabsOf };
