/* ============================================================
   seasonfx.js — one canvas of seasonal weather over the wallpaper.

   Spooky season's leaves and bats (shell/spooky.js) and winter's
   snow (shell/winter.js) are the same machine with different
   sprites, so the machine lives here once:

   · the canvas exists only while `wanted()` says so — its season
     and switch are on, reduced motion is off (this OS's switch or
     the computer's own), and the screen isn't phone-sized. Under
     reduced motion it is never created at all;
   · it sits on the desktop layer, just above the wallpaper (and any
     drive skin or music visualizer), under the clock, icons,
     widgets and every window, and never takes a click;
   · requestAnimationFrame runs only while the canvas is drawing:
     never while the tab is hidden, in Game Mode, or while wallpaper
     motion is off (Settings, or the frame-rate check);
   · the computer's reduced-motion setting is followed live, and
     looked at again every 5 seconds for engines that never send
     the change (older Safari; headless Linux Chrome switching back).

     const fx = seasonCanvas(host, {
       className,            'spooky-fx', 'winter-fx'
       wanted,               () => boolean
       start(S),             a fresh canvas (S.w, S.h, S.dpr are set)
       resize(S),            the size changed (and right after start)
       draw(g, dt, now, S),  one frame; g is already scaled to CSS px
       stop(S),              the canvas went away
     });
     fx.sync()    create or remove the canvas to match wanted()
     fx.kick()    start drawing again if it should be
     fx.destroy()
   ============================================================ */
import { bus } from '../core/bus.js';

export const reducedMotion = () => document.body.classList.contains('reduce-motion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

export function seasonCanvas(host, { className, wanted, start, resize, draw, stop }) {
  const desk = () => host.querySelector('.desktop');
  const S = { cv: null, ctx: null, raf: 0, last: 0, w: 0, h: 0, dpr: 1, mo: null };

  const want = () => !!wanted() && !reducedMotion() && !document.body.classList.contains('is-mobile');
  /* ...and, if it is there, should it be drawing right now? */
  const running = () => S.cv && !document.hidden
    && document.documentElement.dataset.gamemode !== 'on'
    && !desk()?.querySelector('.wp')?.classList.contains('wp--still');

  function size() {
    if (!S.cv) return;
    S.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    S.w = Math.max(1, S.cv.clientWidth || innerWidth);
    S.h = Math.max(1, S.cv.clientHeight || innerHeight);
    S.cv.width = Math.round(S.w * S.dpr);
    S.cv.height = Math.round(S.h * S.dpr);
    resize?.(S);
  }

  function frame(now) {
    S.raf = 0;
    if (!running()) { S.ctx?.clearRect(0, 0, S.cv.width, S.cv.height); S.last = 0; return; }
    const dt = S.last ? Math.min(0.05, (now - S.last) / 1000) : 0;
    S.last = now;
    const g = S.ctx;
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    g.clearRect(0, 0, S.w, S.h);
    draw(g, dt, now, S);
    g.globalAlpha = 1;
    S.raf = requestAnimationFrame(frame);
  }

  const kick = () => { if (S.cv && !S.raf && running()) S.raf = requestAnimationFrame(frame); };

  function remove() {
    cancelAnimationFrame(S.raf);
    S.raf = 0;
    S.mo?.disconnect();
    S.mo = null;
    S.cv?.remove();
    S.cv = null; S.ctx = null;
    stop?.(S);
  }

  function sync() {
    const yes = want();
    if (yes && !S.cv) {
      const d = desk();
      if (!d) return;
      S.cv = document.createElement('canvas');
      S.cv.className = className;
      S.cv.setAttribute('aria-hidden', 'true');
      /* on the wallpaper (and any drive skin, and the music visualizer —
         the weather falls in front of it), under the clock, icons and widgets */
      const wp = d.querySelector('.wp');
      let at = wp ? wp.nextSibling : d.firstChild;
      while (at && (at.classList?.contains('os-skin') || at.classList?.contains('wp-vis'))) at = at.nextSibling;
      d.insertBefore(S.cv, at);
      S.ctx = S.cv.getContext('2d');
      S.last = 0;
      start?.(S);
      size();
      /* the wallpaper's own motion switch (Settings, or the frame-rate check) */
      if (wp && typeof MutationObserver === 'function') {
        S.mo = new MutationObserver(kick);
        S.mo.observe(wp, { attributes: true, attributeFilter: ['class'] });
      }
      kick();
    } else if (!yes && S.cv) remove();
    else kick();
  }

  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);
  /* the phone layout (shell/mobile.js) comes and goes with the width */
  const onResize = () => { sync(); if (S.cv) size(); };
  window.addEventListener('resize', onResize);
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  mq?.addEventListener?.('change', sync);
  const offs = [
    /* Game Mode (by hand or because a game is in front) pauses the drawing */
    bus.on('gamemode:change', kick),
    /* the 5-second look compares what the page has (a canvas or none) with
       what it should have. Comparing reduced motion with its value at the
       previous tick missed a switch that came and went between two ticks
       while a change event or a prefs change had already acted on the first
       half: the tick saw "off" both times and the weather never came back. */
    bus.on('tick:5s', () => { if (want() !== !!S.cv) sync(); }),
  ];

  return {
    sync,
    kick,
    get canvas() { return S.cv; },
    destroy() {
      offs.forEach(f => { try { f(); } catch (e) {} });
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      mq?.removeEventListener?.('change', sync);
      remove();
    },
  };
}

export default { seasonCanvas, reducedMotion };
