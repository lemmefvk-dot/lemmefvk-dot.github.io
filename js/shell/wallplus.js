/* ============================================================
   wallplus.js — the wallpaper's moving parts that run without a
   window: rotation (core/wprotate.js), the Day and Night scene's
   light (core/daycycle.js), the auto accent (core/wpaccent.js)
   and the weather overlay, drawn here.

   The weather overlay is ONE canvas, the last thing inside the
   wallpaper layer (.wp): over the picture or the scene, under the
   music visualizer, the spooky leaves, the clock, the icons and
   every window. It follows the same rules as the spooky leaves
   (shell/spooky.js), so the two can share a canvas later:
     · not on the page at all without a reading to draw, or in the
       phone layout;
     · Game Mode clears it and stops drawing;
     · a hidden tab stops drawing (the last frame stays);
     · Reduce motion — Settings or the computer's own setting — or
       wallpaper motion turned off (by hand or by the frame-rate
       check) draws ONE still frame and nothing moves.
   canvas.dataset: effect (rain|snow|sleet|clouds|sun|fog|storm),
   moving ('1' while frames are being drawn, '0' when still).
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as DAY from '../core/daycycle.js';
import * as ROTATE from '../core/wprotate.js';
import * as WXW from '../core/wpweather.js';
import * as ACCENT from '../core/wpaccent.js';

function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('feat-wallplus-css')) return;
  const l = document.createElement('link');
  l.id = 'feat-wallplus-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-wallplus.css';
  document.head.appendChild(l);
}

const reduced = () => document.body.classList.contains('reduce-motion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const rnd = (a, b) => a + Math.random() * (b - a);

export function mountWallplus(host) {
  ensureCss();
  const offs = [];
  const desk = () => host.querySelector('.desktop');
  const wpEl = () => desk()?.querySelector('.wp');

  ROTATE.init();
  WXW.init();
  ACCENT.init();

  /* ---------------- Day and Night: the light follows the clock ---------------- */
  let dayMin = -1;
  const dayTick = force => {
    const el = wpEl()?.querySelector(':scope > .wp__day');
    if (!el) return;
    const m = Math.floor(Date.now() / 60000);
    if (!force && m === dayMin) return;
    dayMin = m;
    DAY.paint(el);
  };
  /* a new place in Weather can move sunrise and sunset */
  offs.push(store.sub('prefs.wxPlace', () => dayTick(true)));

  /* ---------------- the weather overlay ---------------- */
  const fx = { cv: null, ctx: null, raf: 0, last: 0, w: 1, h: 1, dpr: 1, effect: 'none', amount: 0, parts: [], clouds: [], t: 0, mo: null, sprite: null };

  const fxWanted = () => WXW.status().effect !== 'none' && !document.body.classList.contains('is-mobile');
  const gameMode = () => document.documentElement.dataset.gamemode === 'on';
  const still = () => reduced() || !!wpEl()?.classList.contains('wp--still');
  const running = () => fx.cv && !document.hidden && !gameMode() && !still();

  function cloudSprite(dpr, rgb) {
    /* one soft cloud in one colour, drawn once and stamped */
    const S = Math.round(260 * dpr);
    const c = document.createElement('canvas');
    c.width = S * 2; c.height = S;
    const g = c.getContext('2d');
    for (const [x, y, r] of [[0.32, 0.6, 0.3], [0.5, 0.45, 0.36], [0.7, 0.6, 0.28], [0.56, 0.7, 0.3], [0.4, 0.7, 0.26]]) {
      const gr = g.createRadialGradient(x * S * 2, y * S, 0, x * S * 2, y * S, r * S);
      gr.addColorStop(0, `rgba(${rgb},.9)`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, S * 2, S);
    }
    return c;
  }

  function seed() {
    const { w, h, effect, amount } = fx;
    const area = w * h;
    fx.stillDrawn = false;
    fx.parts = [];
    fx.clouds = [];
    const drops = n => { for (let i = 0; i < n; i++) fx.parts.push({ k: 'drop', x: rnd(-60, w + 20), y: rnd(-h, h), len: rnd(14, 26), v: rnd(620, 900), a: rnd(0.25, 0.5) }); };
    const flakes = n => { for (let i = 0; i < n; i++) fx.parts.push({ k: 'flake', x: rnd(0, w), y: rnd(-20, h), r: rnd(1.1, 3.4), v: rnd(28, 70), sway: rnd(8, 26), hz: rnd(0.15, 0.4), ph: rnd(0, 6.3), a: rnd(0.55, 0.95) }); };
    if (effect === 'rain') drops(Math.round(Math.min(260, area / 7000) * amount));
    if (effect === 'storm') drops(Math.round(Math.min(340, area / 5200)));
    if (effect === 'snow') flakes(Math.round(Math.min(220, area / 9000) * amount));
    if (effect === 'sleet') { drops(Math.round(Math.min(130, area / 14000) * amount)); flakes(Math.round(Math.min(90, area / 18000) * amount)); }
    if (effect === 'clouds' || effect === 'storm' || effect === 'fog') {
      const n = effect === 'fog' ? 5 : Math.round(3 + 4 * amount);
      for (let i = 0; i < n; i++) {
        fx.clouds.push(effect === 'fog'
          ? { x: rnd(-w * 0.4, w), y: rnd(h * 0.35, h * 0.95), s: rnd(1.6, 2.6), v: rnd(5, 12), a: rnd(0.16, 0.28) }
          : { x: rnd(-w * 0.3, w), y: rnd(-h * 0.08, h * 0.38), s: rnd(0.9, 1.7), v: rnd(6, 16), a: rnd(0.35, 0.6) * (0.5 + amount * 0.5) });
      }
    }
  }

  function size() {
    if (!fx.cv) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, fx.cv.clientWidth || innerWidth);
    const h = Math.max(1, fx.cv.clientHeight || innerHeight);
    /* a resize event that changed nothing must not deal the drops again
       (a still frame would jump) or clear the canvas */
    if (fx.cv.width && dpr === fx.dpr && w === fx.w && h === fx.h && (fx.parts.length || fx.clouds.length)) return;
    fx.dpr = dpr; fx.w = w; fx.h = h;
    fx.cv.width = Math.round(fx.w * fx.dpr);
    fx.cv.height = Math.round(fx.h * fx.dpr);
    fx.sprite = null;
    seed();
  }

  function draw(dt) {
    const g = fx.ctx;
    const { w, h, effect, amount } = fx;
    g.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    fx.t += dt;

    /* the light first: a dimmer sky for rain, snow and cloud, haze for fog */
    const tint = { rain: [18, 28, 48, 0.16], storm: [10, 14, 26, 0.3], sleet: [24, 32, 50, 0.16], snow: [200, 214, 235, 0.08], clouds: [28, 32, 42, 0.1 + 0.12 * amount], fog: [200, 206, 216, 0.12 + 0.1 * amount] }[effect];
    if (tint) { g.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${tint[3]})`; g.fillRect(0, 0, w, h); }

    if (effect === 'sun') {
      const pulse = 0.88 + 0.12 * Math.sin(fx.t * 2 * Math.PI / 7);
      const sx = w * 0.86, sy = h * 0.06;
      const gr = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.75);
      gr.addColorStop(0, `rgba(255,236,190,${(0.55 * pulse * amount).toFixed(3)})`);
      gr.addColorStop(0.25, `rgba(255,214,150,${(0.22 * pulse * amount).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(255,214,150,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      /* a few lens flares along the line from the sun through the middle */
      for (const [t, r, a] of [[0.35, 30, 0.2], [0.55, 16, 0.26], [0.78, 52, 0.14], [1.05, 24, 0.18]]) {
        const x = sx + (w * 0.5 - sx) * t * 1.6, y = sy + (h * 0.5 - sy) * t * 1.6;
        const fg = g.createRadialGradient(x, y, 0, x, y, r);
        fg.addColorStop(0, `rgba(255,240,210,${(a * pulse * amount).toFixed(3)})`);
        fg.addColorStop(1, 'rgba(255,240,210,0)');
        g.fillStyle = fg;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }

    if (fx.clouds.length) {
      /* fog is white and low and stretched; cloud grey (storm cloud darker) and high */
      if (!fx.sprite) fx.sprite = cloudSprite(fx.dpr, effect === 'fog' ? '236,240,246' : effect === 'storm' ? '46,50,64' : '132,140,154');
      const sw = fx.sprite.width / fx.dpr, sh = fx.sprite.height / fx.dpr;
      for (const c of fx.clouds) {
        c.x += c.v * dt;
        if (c.x > w + sw * c.s * 0.2) c.x = -sw * c.s * (effect === 'fog' ? 1.6 : 1);
        g.globalAlpha = c.a;
        if (effect === 'fog') g.drawImage(fx.sprite, c.x, c.y - sh * c.s * 0.25, sw * c.s * 1.6, sh * c.s * 0.5);
        else g.drawImage(fx.sprite, c.x, c.y, sw * c.s, sh * c.s);
      }
      g.globalAlpha = 1;
    }

    let streaks = false;
    for (const p of fx.parts) {
      if (p.k === 'drop') {
        p.y += p.v * dt; p.x += p.v * 0.16 * dt;
        if (p.y > h + 30) { p.y = rnd(-120, -20); p.x = rnd(-60, w); }
        if (!streaks) { g.strokeStyle = 'rgba(205,222,255,1)'; g.lineWidth = 1.15; g.lineCap = 'round'; streaks = true; }
        g.globalAlpha = p.a;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.len * 0.16, p.y - p.len); g.stroke();
      } else {
        p.y += p.v * dt; p.ph += dt * p.hz * Math.PI * 2;
        if (p.y > h + 10) { p.y = rnd(-30, -6); p.x = rnd(0, w); }
        g.globalAlpha = p.a;
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(p.x + Math.sin(p.ph) * p.sway, p.y, p.r, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  function frame(now) {
    fx.raf = 0;
    if (!fx.cv) return;
    if (!running()) { paintStill(); return; }
    const dt = fx.last ? Math.min(0.05, (now - fx.last) / 1000) : 0;
    fx.last = now;
    fx.cv.dataset.moving = '1';
    fx.stillDrawn = false;
    draw(dt);
    fx.raf = requestAnimationFrame(frame);
  }

  /* not moving: Game Mode clears it; otherwise one still frame stays up */
  function paintStill() {
    if (!fx.cv) return;
    fx.last = 0;
    fx.cv.dataset.moving = '0';
    if (gameMode()) { fx.ctx.setTransform(1, 0, 0, 1, 0, 0); fx.ctx.clearRect(0, 0, fx.cv.width, fx.cv.height); fx.stillDrawn = false; return; }
    /* drawn once, then left alone until something changes */
    if (document.hidden || fx.stillDrawn) return;
    draw(0);
    fx.stillDrawn = true;
  }

  const kick = () => {
    if (!fx.cv) return;
    if (running()) { if (!fx.raf) fx.raf = requestAnimationFrame(frame); } else { cancelAnimationFrame(fx.raf); fx.raf = 0; paintStill(); }
  };

  function syncFx() {
    const want = fxWanted();
    const st = WXW.status();
    if (want && !fx.cv) {
      const d = desk();
      const wp = wpEl();
      if (!d || !wp) return;
      fx.cv = document.createElement('canvas');
      fx.cv.className = 'wx-fx';
      fx.cv.setAttribute('aria-hidden', 'true');
      /* inside the wallpaper layer, over the picture and the scene: so it is
         always under the visualizer, the spooky leaves and everything else,
         whichever of them came first */
      wp.appendChild(fx.cv);
      fx.ctx = fx.cv.getContext('2d');
      fx.w = fx.h = 0;
      fx.effect = st.effect; fx.amount = st.amount;
      fx.cv.dataset.effect = fx.effect;
      size();
      if (typeof MutationObserver === 'function') {
        fx.mo = new MutationObserver(kick);
        fx.mo.observe(wp, { attributes: true, attributeFilter: ['class'] });
      }
      kick();
    } else if (!want && fx.cv) {
      cancelAnimationFrame(fx.raf);
      fx.raf = 0;
      fx.mo?.disconnect();
      fx.mo = null;
      fx.cv.remove();
      fx.cv = null; fx.ctx = null; fx.parts = []; fx.clouds = []; fx.sprite = null;
    } else if (fx.cv) {
      if (st.effect !== fx.effect || st.amount !== fx.amount) {
        fx.effect = st.effect; fx.amount = st.amount;
        fx.cv.dataset.effect = fx.effect;
        fx.sprite = null;
        seed();
      }
      kick();
    }
  }

  /* ---------------- wiring ---------------- */
  syncFx();
  dayTick(true);
  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);
  const onResize = () => { syncFx(); if (fx.cv) { size(); kick(); } };
  window.addEventListener('resize', onResize);
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  mq?.addEventListener?.('change', kick);
  offs.push(
    bus.on('wpweather:change', syncFx),
    bus.on('gamemode:change', kick),
    store.sub('prefs', () => { syncFx(); kick(); }),
    /* a new wallpaper layer (rotation, a pick) — the Day and Night one needs its light now */
    bus.on('wallpaper:shown', () => requestAnimationFrame(() => dayTick(true))),
    /* every 5 s: the light, a reading going stale after an hour, and — for
       engines that never send the reduced-motion change — whether the overlay
       is doing what it should now (syncFx ends in kick(), which compares what
       is happening with what should, not with the previous tick) */
    bus.on('tick:5s', () => {
      dayTick(false);
      syncFx();
    }),
    () => document.removeEventListener('visibilitychange', onVis),
    () => window.removeEventListener('resize', onResize),
    () => mq?.removeEventListener?.('change', kick),
  );

  return () => {
    offs.forEach(f => { try { f(); } catch (e) { /* already gone */ } });
    cancelAnimationFrame(fx.raf);
    fx.mo?.disconnect();
    fx.cv?.remove();
  };
}

export default mountWallplus;
