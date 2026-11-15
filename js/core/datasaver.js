/* ============================================================
   datasaver.js — Settings › Network › Data saver.

   What it does while it is on:
     · videos that start by themselves (the wallpaper clip, and any
       looping muted clip) do not: the wallpaper shows its still
       picture instead, and other clips wait for a press on play;
     · pictures load only as they come into view, and decode off the
       main thread;
     · the background copy of StaticOS for offline use (core/offline.js)
       is not downloaded all at once: it fills in as you use things.
   What it can't do: it can't ask other sites for smaller pictures, so
   a picture from another site is the size that site sends. Videos and
   games you start yourself play as they always do.

   prefs.dataSaver: 'auto' (follow the browser's own Data Saver setting
   where it reports one), 'on' or 'off'.

     on()        is it on right now?
     reason()    'on' | 'browser' | 'off' — why
     init()      start (main.js calls it with the shell)
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const MODES = ['auto', 'on', 'off'];
const mode = () => { const v = store.get('prefs.dataSaver', 'auto'); return v === true ? 'on' : v === false ? 'off' : MODES.includes(v) ? v : 'auto'; };
const browserSaves = () => { try { return !!(navigator.connection && navigator.connection.saveData); } catch (e) { return false; } };

export const on = () => mode() === 'on' || (mode() === 'auto' && browserSaves());
export const reason = () => (mode() === 'on' ? 'on' : mode() === 'auto' && browserSaves() ? 'browser' : 'off');

/* a clip that plays on its own: autoplay, or looping and muted with no controls (a wallpaper) */
const ambient = v => v.hasAttribute('autoplay') || (v.loop && v.muted && !v.controls);

function tame(v) {
  if (!on() || v.dataset.saverOff === '1' || !ambient(v)) return;
  v.dataset.saved = '1';
  v.dataset.wasAutoplay = v.hasAttribute('autoplay') ? '1' : '';
  v.removeAttribute('autoplay');
  v.preload = 'none';
  try { v.pause(); } catch (e) { /* not playing */ }
}
function lazy(img) {
  if (!on()) return;
  if (!img.hasAttribute('loading')) img.loading = 'lazy';
  if (!img.hasAttribute('decoding')) img.decoding = 'async';
}
function sweep(root) {
  if (root.nodeType !== 1) return;
  if (root.tagName === 'VIDEO') tame(root); else if (root.tagName === 'IMG') lazy(root);
  root.querySelectorAll?.('video').forEach(tame);
  root.querySelectorAll?.('img').forEach(lazy);
}
/* let go of what was held back when it is turned off (the wallpaper is repainted, so it plays again) */
function release() {
  document.querySelectorAll('video[data-saved="1"]').forEach(v => {
    v.dataset.saved = '';
    if (v.dataset.wasAutoplay === '1') { v.setAttribute('autoplay', ''); v.play?.().catch?.(() => {}); }
  });
}

let started = false;
export function init() {
  if (started || typeof document === 'undefined') return;
  started = true;
  let last = null;
  const apply = () => {
    const now = on();
    /* the first look needs no repaint unless it is on: the desktop has just drawn itself the normal way */
    const changed = last !== now && !(last === null && !now);
    last = now;
    document.documentElement.dataset.dataSaver = now ? '1' : '';
    if (!now) delete document.documentElement.dataset.dataSaver;
    if (now) sweep(document.body); else release();
    if (changed) {
      bus.emit('datasaver:change', now);
      bus.emit('wallpaper:changed');           /* the desktop repaints its wallpaper still or clip */
    }
  };
  new MutationObserver(list => { if (on()) for (const m of list) m.addedNodes.forEach(sweep); })
    .observe(document.documentElement, { childList: true, subtree: true });
  store.sub('prefs.dataSaver', apply);
  try { navigator.connection?.addEventListener?.('change', apply); } catch (e) { /* no connection API */ }
  apply();
}

export default { on, reason, init, MODES };
