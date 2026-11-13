/* ============================================================
   hotcorners.js — push the pointer into a corner of the screen.

   Settings › Desktop › Hot corners gives each of the four corners
   one of: nothing, the window overview, the launcher, show the
   desktop, Static Search, lock, or the notification centre. Every
   corner starts as nothing: a corner that acts on its own would
   surprise anyone reaching past the page for the browser's tabs.

   The pointer has to stay in the very corner (within EDGE px) for a
   quarter of a second; then the action runs once, and the corner
   does nothing more until the pointer has gone AWAY px from it.

   Never while a button is held (dragging a window, an icon, a
   selection), never in full screen or with the pointer locked (a
   game), never with a game maximised in front, never on a phone,
   and never under the lock screen. If the pointer goes on past the
   corner and leaves the page, the wait is called off.

   In an ordinary browser window the page's corner is not the
   screen's, so the pointer only stops there if you stop it; in full
   screen (Ctrl+Alt+F) it stops there on its own.
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { h } from '../core/dom.js';
import { covered } from '../core/cover.js';
import * as wm from '../core/wm.js';
import { GAME_APPS } from '../core/gamemode.js';

export const DWELL = 250;     /* ms in the corner before it acts */
export const EDGE = 4;        /* px from the very corner */
export const AWAY = 48;       /* px the pointer must leave by before the corner can act again */

/* prefs.hotCornerTL … BR (Settings › Desktop) */
export const CORNERS = [
  ['tl', 'hotCornerTL', 'Top-left'], ['tr', 'hotCornerTR', 'Top-right'],
  ['bl', 'hotCornerBL', 'Bottom-left'], ['br', 'hotCornerBR', 'Bottom-right'],
];
export const ACTIONS = [
  ['none', 'Nothing'],
  ['overview', 'Window overview'],
  ['launcher', 'Launcher'],
  ['desktop', 'Show the desktop'],
  ['spotlight', 'Static Search'],
  ['lock', 'Lock the screen'],
  ['notifications', 'Notification centre'],
];
const KNOWN = new Set(ACTIONS.map(a => a[0]));

/** What a corner does ('tl' …), or null for nothing. */
export function actionFor(corner) {
  const row = CORNERS.find(c => c[0] === corner);
  const v = row ? store.get('prefs.' + row[1]) : null;
  return v && v !== 'none' && KNOWN.has(v) ? v : null;
}

/** The corner a point is in, or null. */
export function cornerAt(x, y, W = window.innerWidth, H = window.innerHeight) {
  const l = x <= EDGE, r = x >= W - 1 - EDGE, t = y <= EDGE, b = y >= H - 1 - EDGE;
  return t && l ? 'tl' : t && r ? 'tr' : b && l ? 'bl' : b && r ? 'br' : null;
}
const cornerXY = c => ({ x: c[1] === 'l' ? 0 : window.innerWidth, y: c[0] === 't' ? 0 : window.innerHeight });

/** Why a corner must not act now, or null. */
export function blocked(buttons = 0) {
  if (covered()) return 'covered';
  if (document.body.classList.contains('is-mobile')) return 'phone';
  if (buttons) return 'dragging';
  if (document.querySelector('.win.is-dragging, .dock.is-reordering, .overview.is-dragging')) return 'dragging';
  if (document.fullscreenElement || document.pointerLockElement) return 'fullscreen';
  const w = wm.getActive();
  if (w && !w.min && w.max && GAME_APPS.has(w.appId)) return 'game';
  return null;
}

/* "Show the desktop": everything here out of the way; again, and it comes back. */
let cleared = [];
function showDesktop() {
  const here = wm.onDesktop().filter(w => !w.min && !w.tabHidden);
  if (here.length) {
    cleared = here.map(w => w.id);
    here.forEach(w => wm.minimize(w));
    bus.emit('a11y:say', 'Desktop shown');
    return;
  }
  const back = cleared.map(id => wm.get(id)).filter(w => w && w.min);
  cleared = [];
  back.forEach(w => wm.restore(w));
}

const RUN = {
  overview: () => bus.emit('overview:toggle'),
  launcher: () => bus.emit('launcher:toggle'),
  desktop: showDesktop,
  spotlight: () => bus.emit('spotlight:open', ''),
  lock: () => bus.emit('power:lock'),
  notifications: () => bus.emit('noti:toggle'),
};

export function mountHotCorners(host) {
  const S = { armed: null, timer: 0, spent: null, buttons: 0 };
  /* a small glow in the corner as it acts, so you can tell what happened */
  const glow = h('div.hot-corner', { 'aria-hidden': 'true' });

  function cancel() {
    clearTimeout(S.timer);
    S.timer = 0;
    S.armed = null;
  }

  function fire(c) {
    S.timer = 0;
    S.armed = null;
    const what = actionFor(c);
    if (!what || blocked(S.buttons)) return;
    S.spent = c;
    glow.dataset.corner = c;
    host.appendChild(glow);
    glow.classList.remove('is-on');
    void glow.offsetWidth;                   /* restart the glow */
    glow.classList.add('is-on');
    bus.emit('hotcorner', { corner: c, action: what });
    RUN[what]();
  }

  function onMove(e) {
    if (e.pointerType === 'touch') return;
    S.buttons = e.buttons || 0;
    const x = e.clientX, y = e.clientY;
    if (S.spent) {
      const p = cornerXY(S.spent);
      if (Math.hypot(x - p.x, y - p.y) > AWAY) S.spent = null;
    }
    const c = cornerAt(x, y);
    if (c !== S.armed) cancel();
    if (!c || c === S.spent || S.armed) return;
    if (!actionFor(c) || blocked(S.buttons)) return;
    S.armed = c;
    S.timer = setTimeout(() => fire(c), DWELL);
  }

  /* the pointer went on past the corner, out of the page */
  const onLeave = e => { if (!e.relatedTarget) cancel(); };
  /* a press while waiting: a drag is starting */
  const onDown = () => cancel();

  window.addEventListener('pointermove', onMove, { passive: true, capture: true });
  document.addEventListener('pointerout', onLeave, true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('blur', cancel);

  return () => {
    cancel();
    window.removeEventListener('pointermove', onMove, { capture: true });
    document.removeEventListener('pointerout', onLeave, true);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('blur', cancel);
    glow.remove();
  };
}

export default mountHotCorners;
