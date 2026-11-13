/* ============================================================
   visualizer.js — the music visualizer on the wallpaper.

   Off by default (Settings › Wallpaper › Music visualizer). While it
   is on and Music or Static Radio is making sound, ONE canvas on the
   desktop layer — above the wallpaper, under the spooky leaves, the
   clock, the icons and every window — draws what the music is doing,
   read from the sound itself (js/core/audiotap.js), in one of three
   styles: bars, a wave, or particles. In the accent colour, so it
   follows the theme (and turns orange for spooky season).

   It is honest about when it can't: a radio stream fetched without
   CORS plays, but the browser won't let a page read it — Settings says
   so by name instead of drawing a flat line. Nothing is ever drawn
   that didn't come from the audio.

   Never running for nothing:
   · no canvas at all while it is off, under reduced motion, on the
     phone layout, or in a browser that can't tap a page's audio;
   · no animation frame while nothing is playing (it fades out, then
     stops), while the tab is hidden, or in Game Mode.

   prefs.wallpaperVisualizer  false | true
   prefs.visualizerStyle      'bars' | 'wave' | 'particles'
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as tap from '../core/audiotap.js';

export const STYLES = ['bars', 'wave', 'particles'];

const reduced = () => document.body.classList.contains('reduce-motion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);

export function mountVisualizer(host) {
  const offs = [];
  const desk = () => host.querySelector('.desktop');
  const V = {
    cv: null, g: null, raf: 0, last: 0, w: 0, h: 0, dpr: 1,
    reader: null, pulled: '', freq: null, wave: null, src: null,
    bars: [], caps: [], parts: [], prev: null,
    level: 0, bass: 0, live: false, show: false, heard: false, rgb: '255 69 109', frames: 0, silentFor: 0,
  };

  const wanted = () => store.get('prefs.wallpaperVisualizer') === true;
  const styleOf = () => (STYLES.includes(store.get('prefs.visualizerStyle')) ? store.get('prefs.visualizerStyle') : 'bars');

  /* ---- why it can't draw right now (null: it can) ------------------- */
  function blocker() {
    if (!wanted()) return { state: 'off' };
    if (reduced()) return { state: 'reduced' };
    if (document.body.classList.contains('is-mobile')) return { state: 'phone' };
    if (!tap.canTap()) return { state: 'unsupported' };
    if (document.documentElement.dataset.gamemode === 'on') return { state: 'gamemode' };
    if (document.hidden) return { state: 'hidden' };
    const src = tap.current();
    if (!src) return { state: 'idle' };
    if (src.el.muted || src.el.volume === 0) return { state: 'muted', source: src.label };
    const why = src.blocked();
    if (why) return { state: 'blocked', source: src.label, detail: why };
    if (V.refused && V.refused === refusalKey(src)) return { state: 'blocked', source: src.label, detail: V.refusedWhy };
    return null;
  }
  /* a refusal belongs to one stream on one element, not to the element for good */
  const refusalKey = src => `${src.id}|${src.el.currentSrc || src.el.src}`;
  /* the canvas only exists while it could be useful soon */
  const hasCanvas = b => !b || !['off', 'reduced', 'phone', 'unsupported'].includes(b.state);

  /* ---- canvas -------------------------------------------------------- */
  function ensureCanvas() {
    if (V.cv) return true;
    const d = desk();
    if (!d) return false;
    V.cv = document.createElement('canvas');
    V.cv.className = 'wp-vis';
    V.cv.setAttribute('aria-hidden', 'true');
    /* on the wallpaper (and any drive skin), under the spooky leaves, the
       clock, the icons and the widgets — spooky.js skips past this too */
    const wp = d.querySelector('.wp');
    let at = wp ? wp.nextSibling : d.firstChild;
    while (at && at.classList?.contains('os-skin')) at = at.nextSibling;
    d.insertBefore(V.cv, at);
    V.g = V.cv.getContext('2d');
    size();
    readAccent();
    return true;
  }
  function dropCanvas() {
    stop();
    release();
    V.cv?.remove();
    V.cv = null; V.g = null;
    V.bars = []; V.caps = []; V.parts = []; V.prev = null;
  }
  function size() {
    if (!V.cv) return;
    V.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    V.w = Math.max(1, V.cv.clientWidth || innerWidth);
    V.h = Math.max(1, V.cv.clientHeight || innerHeight);
    V.cv.width = Math.round(V.w * V.dpr);
    V.cv.height = Math.round(V.h * V.dpr);
  }
  function readAccent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
    if (v) V.rgb = v.replace(/,/g, ' ');
  }
  const col = a => `rgb(${V.rgb} / ${clamp(a, 0, 1).toFixed(3)})`;

  /* ---- the analyser: the element's one shared reader (core/audiotap.js),
     the same one Music's own spectrum draws from ----------------------- */
  function attach(src) {
    if (V.src !== src) { release(); V.src = src; V.reader = tap.use(src, 'wallpaper'); }
    try {
      V.pulled = tap.pull(V.reader);
    } catch (e) {
      /* the browser refused to capture it (cross-origin data it wasn't told about) */
      V.refused = refusalKey(src);
      V.refusedWhy = 'The browser won’t let a page read this stream’s sound.';
      V.pulled = 'refused';
      return false;
    }
    if (V.pulled !== 'ok') return false;
    const an = V.reader.an;
    if (!V.freq || V.freq.length !== an.frequencyBinCount) V.freq = new Uint8Array(an.frequencyBinCount);
    if (!V.wave || V.wave.length !== an.fftSize) V.wave = new Uint8Array(an.fftSize);
    return true;
  }
  function release() {
    if (V.src) tap.drop(V.src.el, 'wallpaper');
    V.src = null; V.reader = null; V.pulled = '';
  }

  /* ---- reading ------------------------------------------------------- */
  function read() {
    const an = V.reader.an;
    an.getByteFrequencyData(V.freq);
    an.getByteTimeDomainData(V.wave);
    let sum = 0, bass = 0;
    const top = Math.floor(V.freq.length * 0.7);
    for (let i = 1; i < top; i++) sum += V.freq[i];
    for (let i = 1; i < 12; i++) bass += V.freq[i];
    V.level = sum / (top - 1) / 255;
    V.bass = bass / 11 / 255;
  }
  function quiet() {
    /* no live input: everything eases back to rest */
    V.level *= 0.9;
    V.bass *= 0.9;
    if (V.wave) V.wave.fill(128);
    if (V.freq) V.freq.fill(0);
  }

  /* ---- the three styles ---------------------------------------------- */
  function drawBars(g, dt) {
    const { w, h } = V;
    const n = clamp(Math.round(w / 18), 36, 110);
    const step = w / n;
    const bw = Math.max(2, step * 0.56);
    const maxH = h * 0.24;
    if (V.bars.length !== n) { V.bars = new Array(n).fill(0); V.caps = new Array(n).fill(0); }
    /* up to ~11 kHz — above that music carries little a bar could show —
       with more bars for the lows, where most of it lives */
    const nyq = (V.reader?.ctx?.sampleRate || 48000) / 2;
    const bins = V.freq ? V.freq.length * Math.min(0.85, 11000 / nyq) : 0;
    const grad = g.createLinearGradient(0, h - maxH, 0, h);
    grad.addColorStop(0, col(0.5));
    grad.addColorStop(1, col(0.03));
    /* a soft glow on the floor, as wide as the music is loud */
    const glow = g.createRadialGradient(w / 2, h + h * 0.05, 0, w / 2, h + h * 0.05, w * 0.6);
    glow.addColorStop(0, col(0.16 * V.level + 0.05 * V.bass));
    glow.addColorStop(1, col(0));
    g.fillStyle = glow;
    g.fillRect(0, h - maxH * 1.6, w, maxH * 1.6);
    g.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      let t = 0;
      if (V.show && bins) {
        const b0 = Math.floor(Math.pow(i / n, 1.9) * bins) + 1;
        const b1 = Math.max(b0 + 1, Math.floor(Math.pow((i + 1) / n, 1.9) * bins) + 1);
        let s = 0;
        for (let b = b0; b < b1; b++) s += V.freq[b];
        /* a gentle tilt up the highs, which are always quieter */
        t = Math.min(1, Math.pow(s / (b1 - b0) / 255, 1.35) * (0.85 + 0.55 * (i / n)));
      }
      V.bars[i] = Math.max(t, V.bars[i] * Math.pow(0.0009, dt));      /* fast up, eased down */
      V.caps[i] = Math.max(V.bars[i], V.caps[i] - dt * 0.32);
      const bh = V.bars[i] * maxH;
      const x = i * step + (step - bw) / 2;
      if (bh > 0.5) {
        g.beginPath();
        if (g.roundRect) g.roundRect(x, h - bh, bw, bh + 4, [Math.min(3, bw / 2), Math.min(3, bw / 2), 0, 0]);
        else g.rect(x, h - bh, bw, bh + 4);
        g.fill();
      }
    }
    /* the peaks hang on a moment, then fall */
    g.fillStyle = col(0.55);
    for (let i = 0; i < n; i++) {
      if (V.caps[i] < 0.02) continue;
      g.fillRect(i * step + (step - bw) / 2, h - V.caps[i] * maxH - 5, bw, 2);
    }
    return V.caps.some(c => c > 0.004);
  }

  function drawWave(g) {
    const { w, h } = V;
    const N = 160;
    const mid = h * 0.8;
    const amp = h * 0.11 * (0.55 + V.level);
    const pts = new Float32Array(N);
    let energy = 0;
    for (let k = 0; k < N; k++) {
      const s = V.wave ? (V.wave[Math.floor((k / (N - 1)) * (V.wave.length - 1))] - 128) / 128 : 0;
      /* taper the ends so the line meets the screen edges at rest */
      const taper = Math.sin(Math.PI * k / (N - 1)) ** 0.6;
      const y = s * amp * taper;
      pts[k] = V.prev ? V.prev[k] * 0.35 + y * 0.65 : y;   /* a touch of smoothing between frames */
      energy += Math.abs(pts[k]);
    }
    const trail = V.prev;
    V.prev = pts;
    if (!V.show && energy / N < 0.15) return false;     /* at rest with nothing heard: no line at all */
    const path = arr => {
      g.beginPath();
      for (let k = 0; k < N; k++) {
        const x = (k / (N - 1)) * w;
        k ? g.lineTo(x, mid + arr[k]) : g.moveTo(x, mid + arr[k]);
      }
    };
    /* the area under the line */
    path(pts);
    g.lineTo(w, h); g.lineTo(0, h); g.closePath();
    const fill = g.createLinearGradient(0, mid - amp, 0, h);
    fill.addColorStop(0, col(0.14));
    fill.addColorStop(1, col(0));
    g.fillStyle = fill;
    g.fill();
    /* last frame's line, faint, so it reads as motion rather than jitter */
    if (trail) { path(trail); g.strokeStyle = col(0.12); g.lineWidth = 1.2; g.stroke(); }
    path(pts);
    g.lineJoin = 'round';
    g.strokeStyle = col(0.13); g.lineWidth = 8; g.stroke();
    g.strokeStyle = col(0.62); g.lineWidth = 1.8; g.stroke();
    return energy / N > 0.15;
  }

  function drawParticles(g, dt) {
    const { w, h } = V;
    if (V.show) {
      const n = Math.min(8, Math.floor(V.bass * V.bass * 9 + V.level * 3 + Math.random()));
      for (let i = 0; i < n && V.parts.length < 180; i++) {
        V.parts.push({
          x: rnd(0, w), y: h + 6,
          vx: rnd(-14, 14), vy: -(36 + V.bass * 230 + rnd(0, 40)),
          r: rnd(1, 2.6) + V.bass * 2.2, life: 0, max: rnd(2, 4.2),
        });
      }
    }
    const glow = g.createRadialGradient(w / 2, h, 0, w / 2, h, w * 0.55);
    glow.addColorStop(0, col(0.12 * V.bass + 0.06 * V.level));
    glow.addColorStop(1, col(0));
    g.fillStyle = glow;
    g.fillRect(0, h * 0.5, w, h * 0.5);
    V.parts = V.parts.filter(p => {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy *= Math.pow(0.82, dt);
      const a = (1 - p.life / p.max) * 0.6;
      if (a <= 0 || p.y < -10) return false;
      if (p.r > 2.4) {
        g.fillStyle = col(a * 0.16);
        g.beginPath(); g.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = col(a);
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
      return true;
    });
    return V.parts.length > 0;
  }

  /* ---- the loop ------------------------------------------------------ */
  function frame(now) {
    V.raf = 0;
    if (!V.cv) return;
    const b = blocker();
    /* switched off, reduced motion, the phone layout: no canvas at all */
    if (!hasCanvas(b)) { publish(b); dropCanvas(); return; }
    V.live = !b && attach(tap.current());
    const dt = V.last ? Math.min(0.05, (now - V.last) / 1000) : 1 / 60;
    V.last = now;
    if (V.live) {
      read();
      /* perfect digital silence for seconds on end, while the element plays:
         a quiet passage — or a stream the browser is quietly not sharing */
      const silent = V.wave.every(x => x === 128);
      if (!silent) V.heard = true;
      V.silentFor = silent ? V.silentFor + dt : 0;
    } else { V.silentFor = 0; V.heard = false; }
    /* only what really came from the sound is drawn: nothing before the first
       sound arrives, and nothing (not even a flat line) through a long silence */
    V.show = V.live && V.heard && V.silentFor <= 3;
    if (!V.show) quiet();
    if (++V.frames % 90 === 1) readAccent();
    const g = V.g;
    g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    g.clearRect(0, 0, V.w, V.h);
    const style = styleOf();
    const moving = style === 'wave' ? drawWave(g) : style === 'particles' ? drawParticles(g, dt) : drawBars(g, dt);
    publish(b);
    const paused = b && ['hidden', 'gamemode'].includes(b.state);
    if (V.live || (moving && !paused)) { V.raf = requestAnimationFrame(frame); return; }
    /* paused (hidden, Game Mode) or faded out: stop asking for frames */
    g.clearRect(0, 0, V.w, V.h);
    V.last = 0; V.prev = null;
    /* playing but not readable yet (no click yet, or the track is starting):
       look again shortly, without spending a frame on it */
    if (!b) { clearTimeout(V.retry); V.retry = setTimeout(start, 300); }
    else release();
  }
  const start = () => { if (V.cv && !V.raf) V.raf = requestAnimationFrame(frame); };
  function stop() { if (V.raf) cancelAnimationFrame(V.raf); V.raf = 0; V.last = 0; clearTimeout(V.retry); }

  function publish(b) {
    if (b) tap.setStatus(b);
    /* nothing in the way, but no sound reached the analyser yet: the browser
       hasn't let audio start (no click yet), or the track is still starting */
    else if (!V.live) tap.setStatus({ state: V.pulled === 'suspended' ? 'suspended' : 'starting', source: tap.current()?.label || null });
    /* 'drawing' only once real sound has reached it */
    else if (V.silentFor > 3) tap.setStatus({ state: 'silent', source: V.src?.label || null });
    else tap.setStatus({ state: V.heard ? 'drawing' : 'starting', source: V.src?.label || null });
  }

  /* ---- keeping in step ----------------------------------------------- */
  function sync() {
    const b = blocker();
    publish(b);
    if (!hasCanvas(b)) { if (V.cv) dropCanvas(); return; }
    if (!ensureCanvas()) return;
    /* playing: draw. Anything else: let a running loop fade out by itself */
    if (!b) start();
    else if (V.raf && ['hidden', 'gamemode'].includes(b.state)) { stop(); V.g?.clearRect(0, 0, V.cv.width, V.cv.height); }
  }

  /* the first click anywhere lets the browser start audio; look again then */
  const onGesture = () => { if (wanted()) setTimeout(sync, 0); };
  window.addEventListener('pointerdown', onGesture, { passive: true, capture: true });
  const onVis = () => sync();
  document.addEventListener('visibilitychange', onVis);
  const onResize = () => { size(); sync(); };
  window.addEventListener('resize', onResize);
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  mq?.addEventListener?.('change', sync);

  offs.push(
    bus.on('audiotap:change', sync),
    bus.on('gamemode:change', sync),
    bus.on('season:change', () => requestAnimationFrame(readAccent)),
    bus.on('theme:change', () => requestAnimationFrame(readAccent)),
    store.sub('prefs', () => { readAccent(); sync(); }),
    /* a context that resumed some other way (Settings' preview, a cue) */
    bus.on('tick:5s', () => { if (wanted() && !V.raf && tap.current()) sync(); }),
    () => window.removeEventListener('pointerdown', onGesture, { capture: true }),
    () => document.removeEventListener('visibilitychange', onVis),
    () => window.removeEventListener('resize', onResize),
    () => mq?.removeEventListener?.('change', sync),
  );
  sync();

  return () => {
    offs.forEach(f => { try { f(); } catch (e) { /* keep going */ } });
    dropCanvas();
  };
}

export default mountVisualizer;
