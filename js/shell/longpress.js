/* ============================================================
   longpress.js — a long press is a right-click on a touchscreen.

   Hold a finger still on the desktop, an icon, a dock tile, a
   window's title bar, a tab, or a window's own content and the
   menu a right-click would open comes up, at your finger. It is
   the same event a mouse sends, so every menu in StaticOS (and
   any an app draws itself) answers it.

   Left alone: text fields and anything you select text in, links,
   video, audio, canvas and frames (they have their own long-press),
   games (a hold means something there), menus and notices. A move of
   more than a few pixels cancels, and so does lifting the finger.
   Where the browser sends its own contextmenu for a long press
   (Chrome on Android and ChromeOS does), that one is used and this
   stays out of the way. The phone layout has its own gestures.
   ============================================================ */
import { GAME_APPS } from '../core/gamemode.js';

const HOLD = 600;      /* ms the finger must stay */
const SLOP = 10;       /* px it may wander */
const SKIP = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], a[href], video, audio, canvas, iframe, '
  + '.menu, .toast, .toasts, .lock, .spot-wrap, [data-no-longpress]';

export function mountLongPress() {
  let st = null;
  let native = 0;          /* when the browser last sent a contextmenu of its own */
  let swallow = 0;

  const cancel = () => { if (st) { clearTimeout(st.t); st = null; } };

  function eligible(t) {
    if (!(t instanceof Element) || document.body.classList.contains('is-mobile')) return false;
    if (t.closest(SKIP)) return false;
    const win = t.closest('.win');
    if (win && GAME_APPS.has(win.dataset.app)) return false;
    /* selected text keeps the browser's own copy menu */
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return false;
    return true;
  }

  function fire() {
    const s = st;
    st = null;
    if (!s || native > s.at || !s.target.isConnected) return;
    swallow = Date.now() + 900;
    s.target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: s.x, clientY: s.y, screenX: s.sx, screenY: s.sy, button: 2, buttons: 0,
    }));
  }

  const down = e => {
    cancel();
    if (e.pointerType !== 'touch' || !e.isPrimary || !eligible(e.target)) return;
    st = { x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, target: e.target, at: Date.now(), t: setTimeout(fire, HOLD) };
  };
  const move = e => {
    if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > SLOP) cancel();
  };
  const ctx = e => { if (e.isTrusted) native = Date.now(); };
  /* the tap that ends a long press is not a click on whatever is under the menu */
  const click = e => {
    if (Date.now() < swallow) { e.preventDefault(); e.stopPropagation(); swallow = 0; }
  };

  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, { capture: true, passive: true });
  window.addEventListener('pointerup', cancel, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('contextmenu', ctx, true);
  window.addEventListener('click', click, true);
  return () => {
    cancel();
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, { capture: true });
    window.removeEventListener('pointerup', cancel, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('contextmenu', ctx, true);
    window.removeEventListener('click', click, true);
  };
}

export default mountLongPress;
