/* ============================================================
   winshot.js — a live picture of a window: its own DOM, cloned and
   scaled down (the overview draws windows the same way). Used by
   the dock's hover card and by Snap Assist. Inert: nothing in it
   can be clicked, focused or heard, and animations are off.
   ============================================================ */
import { h } from './dom.js';

/** A box no bigger than maxW × maxH that shows window w, whatever state it is in. */
export function shotOf(w, maxW, maxH, cls = 'win-shot') {
  const k = Math.min(maxW / w.w, maxH / w.h, 1);
  const clone = w.el.cloneNode(true);
  clone.removeAttribute('id');
  /* it is a picture, not a window: nothing that looks for a window by app or id may find it */
  clone.removeAttribute('data-app');
  clone.removeAttribute('data-win');
  clone.removeAttribute('role');
  /* a copy must not load or play anything of its own: no second game in a frame, no sound twice */
  clone.querySelectorAll('iframe, embed, object').forEach(f => { f.removeAttribute('src'); f.removeAttribute('srcdoc'); f.removeAttribute('data'); });
  clone.querySelectorAll('video, audio').forEach(m => { m.removeAttribute('autoplay'); m.removeAttribute('src'); m.querySelectorAll('source').forEach(x => x.remove()); m.muted = true; });
  /* canvases are not copied by cloneNode: paint what the window shows onto the copy's */
  try {
    const from = w.el.querySelectorAll('canvas'), to = clone.querySelectorAll('canvas');
    from.forEach((c, i) => {
      const d = to[i];
      if (!d || !c.width || !c.height) return;
      d.width = c.width; d.height = c.height;
      try { d.getContext('2d')?.drawImage(c, 0, 0); } catch (e) { /* a canvas the browser won't let us read */ }
    });
  } catch (e) { /* nothing to draw */ }
  clone.classList.remove('is-active', 'is-dragging', 'is-snapping', 'is-closing', 'is-max', 'is-min', 'is-away', 'is-leaving', 'is-peek');
  Object.assign(clone.style, {
    position: 'relative', left: '0', top: '0', width: w.w + 'px', height: w.h + 'px', minWidth: '0', minHeight: '0',
    zIndex: '0', opacity: '1', visibility: 'visible', pointerEvents: 'none',
    transform: `scale(${k})`, transformOrigin: 'top left', animation: 'none', transition: 'none',
  });
  return h(`div.${cls}`, { inert: true, 'aria-hidden': 'true', dataset: { of: w.appId },
    style: { width: Math.round(w.w * k) + 'px', height: Math.round(w.h * k) + 'px', overflow: 'hidden', pointerEvents: 'none' } }, clone);
}
