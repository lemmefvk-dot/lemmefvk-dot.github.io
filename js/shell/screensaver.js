/* ============================================================
   screensaver.js — bubbles, a starfield, an aquarium, 3D pipes, a
   night sky or (in spooky season) ghosts, after you've been away for a while.

   prefs.screensaver       minutes without a key press, click,
                           pointer move, scroll or touch: 1, 2, 5,
                           10 (default), 15 or 30; 0 is Off
   prefs.screensaverStyle  'auto' (ghosts in spooky season, bubbles
                           the rest of the year), 'bubbles',
                           'starfield' (flying through stars),
                           'aquarium' (fish, weed and bubbles),
                           'pipes' (3D pipes growing in a cube),
                           'nightsky' (stars that sit still and turn
                           very slowly over a dark horizon) or
                           'ghosts' (outside the season: bubbles)
   Settings › Desktop › Screensaver sets both and has Preview
   (bus 'screensaver:preview').

   It never starts while
     · a video or song is playing (a <video>/<audio> on the page,
       Music or Radio — the wallpaper's silent loop doesn't count)
     · a game (the apps Game Mode treats as games) or anything full
       screen is in front
     · the boot screen, the lock screen or first-run setup is up
     · the tab is hidden, or an embedded page has the keyboard (its
       key presses never reach StaticOS, so there's no telling)
   A blocked check counts as activity: once the video ends, the
   whole idle time has to pass again.

   Waking: any key, a real pointer move, a click, a scroll or a
   touch. No password — it is not a lock. The key or click that wakes
   it is swallowed, so it never types into a field or clicks what is
   underneath, and focus goes back where it was.

   While it shows: one canvas drawn with requestAnimationFrame (none
   at all otherwise), a frame-rate claim on js/core/metrics.js so the
   System Monitor can show its cost, and the rest of the shell inert
   (js/core/cover.js). With reduced motion nothing moves: a still
   scene that slowly fades into another.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { cover, covered } from '../core/cover.js';
import * as wm from '../core/wm.js';
import * as L from '../core/layers.js';
import * as M from '../core/metrics.js';
import * as TAP from '../core/audiotap.js';
import { GAME_APPS } from '../core/gamemode.js';
import { spookyOn } from '../core/season.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-screensaver-css')) {
  const l = document.createElement('link');
  l.id = 'feat-screensaver-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-screensaver.css';
  document.head.appendChild(l);
}

/* ---------- preferences (also read by Settings) ------------------- */
export const DELAYS = [0, 1, 2, 5, 10, 15, 30];          /* minutes; 0 = Off */
export const DEFAULT_DELAY = 10;
export const STYLE_NAMES = { bubbles: 'Bubbles', starfield: 'Starfield', aquarium: 'Aquarium', pipes: '3D Pipes', nightsky: 'Night Sky', ghosts: 'Ghosts' };

/** Minutes until it starts, 0 when it is off. */
export function delayMinutes() {
  const v = store.get('prefs.screensaver', DEFAULT_DELAY);
  if (v === false || v === 'off') return 0;
  const n = Number(v);
  return DELAYS.includes(n) ? n : DEFAULT_DELAY;
}

/** The styles on offer right now: ghosts only while spooky season runs. */
export const styles = (d = new Date()) => (spookyOn(d) ? ['bubbles', 'starfield', 'aquarium', 'pipes', 'nightsky', 'ghosts'] : ['bubbles', 'starfield', 'aquarium', 'pipes', 'nightsky']);

/** The style it will show: the one picked, if it's on offer, else the season's. */
export function styleNow(d = new Date()) {
  const pick = store.get('prefs.screensaverStyle', 'auto');
  if (styles(d).includes(pick)) return pick;
  return spookyOn(d) ? 'ghosts' : 'bubbles';
}

const RECHECK = 30e3;           /* how often it looks again while armed */
const MOVE_PX = 8;              /* a pointer has to really move to wake it */
const FADE_MS = 360;

const reducedMotion = () => document.body.classList.contains('reduce-motion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Is something playing that someone may be watching or listening to? */
export function mediaPlaying() {
  try { if (navigator.mediaSession?.playbackState === 'playing') return true; } catch (e) { /* no media session */ }
  try { if (TAP.current()) return true; } catch (e) {}
  for (const el of document.querySelectorAll('video, audio')) {
    if (el.closest('.desktop, .ssaver')) continue;          /* the wallpaper's own loop */
    if (el.loop && el.defaultMuted) continue;              /* silent decorative loops (previews) */
    if (!el.paused && !el.ended && !el.error) return true;
  }
  return false;
}

/* An embedded page (a game, a site in Browser, a YouTube player) keeps its
   key presses, clicks, scrolls and pointer moves to itself: while it has the
   keyboard or the pointer rests over it, someone may be using it. */
let overFrame = false;      /* kept by mountScreensaver() */

/** Why it must not start now, or null. */
export function blocker() {
  if (typeof document === 'undefined') return 'no document';
  if (document.hidden) return 'hidden';
  if (covered()) return 'covered';
  if (!store.get('session.onboarded', false)) return 'setup';
  if (document.fullscreenElement) return 'fullscreen';
  const w = wm.getActive();
  if (w && !w.min && GAME_APPS.has(w.appId)) return 'game';
  if ((document.activeElement && document.activeElement.tagName === 'IFRAME') || overFrame) return 'embed';
  if (mediaPlaying()) return 'media';
  return null;
}

/* ---------- the scenes -------------------------------------------- */
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

function accentRGB() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
  const p = v.split(/[\s,/]+/).map(Number).filter(n => Number.isFinite(n));
  return p.length >= 3 ? p.slice(0, 3).join(',') : '255,69,109';
}

const SCENES = {
  bubbles: {
    init(W, H) {
      const acc = accentRGB();
      const tints = [acc, acc, '150,190,255', '200,160,255', '255,255,255'];
      const n = Math.max(14, Math.min(48, Math.round((W * H) / 36000)));
      const items = Array.from({ length: n }, () => this.spawn(W, H, tints, rnd(0, H)));
      return { items, tints };
    },
    spawn(W, H, tints, y) {
      const r = rnd(10, 64);
      return {
        x: rnd(0, W), y: y ?? H + r, r,
        vy: rnd(16, 46) * (1.2 - r / 110),          /* the small ones rise faster */
        wa: rnd(8, 26), wf: rnd(0.3, 0.9), ph: rnd(0, TAU),
        c: tints[Math.floor(Math.random() * tints.length)],
      };
    },
    draw(ctx, W, H, s, dt, t) {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#05040a');
      bg.addColorStop(1, '#12060f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < s.items.length; i++) {
        let b = s.items[i];
        b.y -= b.vy * dt;
        const x = b.x + Math.sin(t * b.wf + b.ph) * b.wa;
        if (b.y < -b.r - 4) { b = s.items[i] = this.spawn(W, H, s.tints); continue; }
        const g = ctx.createRadialGradient(x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.1, x, b.y, b.r);
        g.addColorStop(0, `rgba(${b.c},0.04)`);
        g.addColorStop(0.72, `rgba(${b.c},0.10)`);
        g.addColorStop(1, `rgba(${b.c},0.42)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, b.y, b.r, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.ellipse(x - b.r * 0.38, b.y - b.r * 0.42, b.r * 0.22, b.r * 0.11, -0.7, 0, TAU);
        ctx.fill();
      }
    },
  },

  starfield: {
    init() {
      const n = 420;
      return { items: Array.from({ length: n }, () => this.spawn(rnd(0.05, 1))), speed: 0.28 };
    },
    spawn(z = 1) { return { x: rnd(-1, 1), y: rnd(-1, 1), z, pz: z }; },
    draw(ctx, W, H, s, dt) {
      ctx.fillStyle = '#020207';
      ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, f = Math.max(W, H) * 0.5;
      ctx.lineCap = 'round';
      for (let i = 0; i < s.items.length; i++) {
        const st = s.items[i];
        st.pz = st.z;
        st.z -= s.speed * dt;
        if (st.z <= 0.03) { s.items[i] = this.spawn(1); continue; }
        const sx = cx + (st.x / st.z) * f, sy = cy + (st.y / st.z) * f;
        if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) { s.items[i] = this.spawn(1); continue; }
        const px = cx + (st.x / st.pz) * f, py = cy + (st.y / st.pz) * f;
        const near = 1 - st.z;
        ctx.strokeStyle = `rgba(225,232,255,${(0.15 + near * 0.85).toFixed(3)})`;
        ctx.lineWidth = 0.6 + near * 2.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx + 0.01, sy);
        ctx.stroke();
      }
    },
  },

  ghosts: {
    init(W, H) {
      const n = Math.max(5, Math.min(11, Math.round((W * H) / 150000)));
      const stars = Array.from({ length: 70 }, () => ({ x: rnd(0, W), y: rnd(0, H * 0.7), r: rnd(0.4, 1.4), a: rnd(0.25, 0.8) }));
      return { items: Array.from({ length: n }, () => this.spawn(W, H, true)), stars };
    },
    spawn(W, H, anywhere) {
      const size = rnd(46, 118);
      const dir = Math.random() < 0.5 ? -1 : 1;
      return {
        size, dir,
        x: anywhere ? rnd(0, W) : (dir > 0 ? -size : W + size),
        y: rnd(H * 0.12, H * 0.82),
        vx: dir * rnd(18, 46) * (1.25 - size / 160),
        bob: rnd(8, 22), bf: rnd(0.5, 1.1), ph: rnd(0, TAU), a: rnd(0.72, 0.95),
      };
    },
    draw(ctx, W, H, s, dt, t) {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a0614');
      bg.addColorStop(0.65, '#1b0b26');
      bg.addColorStop(1, '#2a0f1d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      for (const st of s.stars) {
        ctx.fillStyle = `rgba(255,240,220,${st.a})`;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, TAU);
        ctx.fill();
      }
      /* the moon */
      const mr = Math.min(W, H) * 0.075, mx = W * 0.8, my = H * 0.2;
      const glow = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.2);
      glow.addColorStop(0, 'rgba(255,210,150,0.30)');
      glow.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(mx - mr * 3.2, my - mr * 3.2, mr * 6.4, mr * 6.4);
      ctx.fillStyle = '#ffe6bf';
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, TAU);
      ctx.fill();

      for (let i = 0; i < s.items.length; i++) {
        let g = s.items[i];
        g.x += g.vx * dt;
        if ((g.dir > 0 && g.x - g.size > W) || (g.dir < 0 && g.x + g.size < 0)) { g = s.items[i] = this.spawn(W, H, false); }
        this.ghost(ctx, g.x, g.y + Math.sin(t * g.bf + g.ph) * g.bob, g.size, g.dir, g.a, t + g.ph);
      }
    },
    ghost(ctx, x, y, s, dir, a, t) {
      const w = s * 0.8, top = y - s * 0.5, bottom = y + s * 0.45;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = 'rgba(205,180,255,0.65)';
      ctx.shadowBlur = s * 0.28;
      ctx.fillStyle = '#f6f1ff';
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y);
      ctx.arc(x, y, w / 2, Math.PI, 0);              /* the head */
      ctx.lineTo(x + w / 2, bottom);
      const waves = 4, step = w / waves;
      for (let k = 0; k < waves; k++) {               /* the hem, rippling */
        const x0 = x + w / 2 - k * step;
        const dip = Math.sin(t * 3 + k) * s * 0.05;
        ctx.quadraticCurveTo(x0 - step / 2, bottom + s * 0.12 + dip, x0 - step, bottom);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1a1024';
      const ex = dir * s * 0.06;                      /* looks where it's going */
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + side * s * 0.13 + ex, top + s * 0.42, s * 0.06, s * 0.085, 0, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(x + ex, top + s * 0.62, s * 0.05, s * 0.065, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    },
  },
};

/* ---- three more, all drawn in code ---- */
SCENES.aquarium = {
  init(W, H) {
    const n = Math.max(7, Math.min(15, Math.round((W * H) / 85000)));
    const fish = Array.from({ length: n }, () => this.spawn(W, H, true));
    const bubbles = Array.from({ length: 26 }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(1.5, 6), vy: rnd(20, 60), ph: rnd(0, TAU) }));
    const nw = Math.max(6, Math.round(W / 130));
    const weeds = Array.from({ length: nw }, (_, i) => ({
      x: (i + rnd(0.1, 0.9)) * (W / nw), h: rnd(0.12, 0.34) * H, w: rnd(7, 15), ph: rnd(0, TAU), hue: rnd(95, 150),
    }));
    const rocks = Array.from({ length: 6 }, () => ({ x: rnd(0, W), rx: rnd(24, 80), ry: rnd(14, 38), l: rnd(18, 32) }));
    return { fish, bubbles, weeds, rocks };
  },
  spawn(W, H, anywhere) {
    const size = rnd(16, 42);
    const dir = Math.random() < 0.5 ? -1 : 1;
    return {
      size, dir, hue: rnd(0, 360), kind: Math.floor(rnd(0, 3)),
      x: anywhere ? rnd(0, W) : (dir > 0 ? -size * 2 : W + size * 2),
      y: rnd(H * 0.12, H * 0.72),
      vx: dir * rnd(24, 70) * (1.3 - size / 70),
      bob: rnd(6, 18), bf: rnd(0.4, 1), ph: rnd(0, TAU),
    };
  },
  draw(ctx, W, H, s, dt, t) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a5a78');
    bg.addColorStop(0.55, '#06344f');
    bg.addColorStop(1, '#021626');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    /* light from the surface, swaying */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x0 = (i + 0.5) * (W / 6) + Math.sin(t * 0.25 + i * 1.7) * 40, wd = 40 + (i % 3) * 26, lean = 120 + Math.sin(t * 0.18 + i) * 40;
      const g = ctx.createLinearGradient(x0, 0, x0 + lean, H * 0.85);
      g.addColorStop(0, 'rgba(150,220,255,0.14)');
      g.addColorStop(1, 'rgba(150,220,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0 - wd, 0); ctx.lineTo(x0 + wd, 0); ctx.lineTo(x0 + lean + wd * 2.4, H * 0.85); ctx.lineTo(x0 + lean - wd * 2.4, H * 0.85);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    /* the sand */
    const floor = H * 0.9;
    const sand = ctx.createLinearGradient(0, floor - 30, 0, H);
    sand.addColorStop(0, '#6d5b3a');
    sand.addColorStop(1, '#2d2416');
    ctx.fillStyle = sand;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 20; x += 20) ctx.lineTo(x, floor + Math.sin(x * 0.011) * 9 + Math.sin(x * 0.027 + 1) * 5);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    for (const r of s.rocks) {
      const y = floor + 10 + Math.sin(r.x * 0.011) * 9;
      ctx.fillStyle = `hsl(215 12% ${r.l}%)`;
      ctx.beginPath();
      ctx.ellipse(r.x, y, r.rx, r.ry, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }
    /* weed */
    ctx.lineCap = 'round';
    for (const w of s.weeds) {
      const y0 = floor + 14 + Math.sin(w.x * 0.011) * 9;
      ctx.strokeStyle = `hsl(${w.hue} 55% 32%)`;
      ctx.lineWidth = w.w;
      ctx.beginPath();
      ctx.moveTo(w.x, y0);
      for (let k = 1; k <= 8; k++) {
        const f = k / 8;
        ctx.lineTo(w.x + Math.sin(t * 0.9 + w.ph + f * 2.6) * 22 * f, y0 - w.h * f);
      }
      ctx.stroke();
    }
    /* fish */
    for (let i = 0; i < s.fish.length; i++) {
      let f = s.fish[i];
      f.x += f.vx * dt;
      if ((f.dir > 0 && f.x - f.size * 2 > W) || (f.dir < 0 && f.x + f.size * 2 < 0)) f = s.fish[i] = this.spawn(W, H, false);
      this.fish(ctx, f.x, f.y + Math.sin(t * f.bf + f.ph) * f.bob, f, t);
    }
    /* bubbles */
    ctx.lineWidth = 1;
    for (const b of s.bubbles) {
      b.y -= b.vy * dt;
      if (b.y < -10) { b.y = H * 0.9; b.x = rnd(0, W); }
      ctx.strokeStyle = 'rgba(210,240,255,0.55)';
      ctx.fillStyle = 'rgba(210,240,255,0.10)';
      ctx.beginPath();
      ctx.arc(b.x + Math.sin(t * 1.3 + b.ph) * 6, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  },
  fish(ctx, x, y, f, t) {
    const s = f.size, wag = Math.sin(t * 6 + f.ph) * 0.35;
    const ry = s * (f.kind === 1 ? 0.78 : f.kind === 2 ? 0.36 : 0.52);
    const body = `hsl(${f.hue} 78% 58%)`, dark = `hsl(${f.hue} 70% 38%)`;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(f.dir, 1);
    ctx.fillStyle = dark;
    ctx.beginPath();                                   /* tail */
    ctx.moveTo(-s * 0.8, 0);
    ctx.lineTo(-s * 1.55, -s * 0.5 + wag * s * 0.5);
    ctx.lineTo(-s * 1.4, wag * s * 0.4);
    ctx.lineTo(-s * 1.55, s * 0.5 + wag * s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();                                   /* fin on top */
    ctx.moveTo(-s * 0.3, -ry * 0.8);
    ctx.quadraticCurveTo(0, -ry * 1.7, s * 0.35, -ry * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, ry, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';          /* a stripe */
    ctx.beginPath();
    ctx.ellipse(-s * 0.1, 0, s * 0.12, ry * 0.92, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s * 0.55, -ry * 0.2, Math.max(2, s * 0.13), 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#10222c';
    ctx.beginPath();
    ctx.arc(s * 0.6, -ry * 0.2, Math.max(1, s * 0.06), 0, TAU);
    ctx.fill();
    ctx.restore();
  },
};

/* pipes grow one cell at a time through a cube, never crossing, while the
   cube turns; when it is full they wait, fade, and start again */
SCENES.pipes = {
  N: 11,
  DIRS: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  init() {
    const acc = accentRGB().split(',').map(Number);
    const pal = [acc, [90, 190, 255], [120, 240, 170], [255, 190, 90], [200, 140, 255], [255, 110, 130]];
    return { segs: [], pipes: [], taken: new Set(), pal, fade: 0, hold: 0, yaw: rnd(0, TAU), clock: 0 };
  },
  newPipe(s) {
    const N = this.N;
    for (let tries = 0; tries < 40; tries++) {
      const p = [Math.floor(rnd(0, N)), Math.floor(rnd(0, N)), Math.floor(rnd(0, N))];
      const k = p.join();
      if (s.taken.has(k)) continue;
      s.taken.add(k);
      const c = s.pal[s.pipes.length % s.pal.length];
      const rgb = (m, a = 0) => `rgb(${c.map(v => Math.min(255, Math.round(v * m + a))).join(',')})`;
      s.pipes.push({ p, dir: this.DIRS[Math.floor(rnd(0, 6))], alive: true, dark: rgb(0.45), base: rgb(0.95), light: rgb(1, 70) });
      return;
    }
  },
  step(s, pipe) {
    const N = this.N;
    const free = d => {
      const q = [pipe.p[0] + d[0], pipe.p[1] + d[1], pipe.p[2] + d[2]];
      return q.every(v => v >= 0 && v < N) && !s.taken.has(q.join()) ? q : null;
    };
    const back = d => d[0] === -pipe.dir[0] && d[1] === -pipe.dir[1] && d[2] === -pipe.dir[2];
    let dir = pipe.dir;
    const straight = free(dir);
    if (!straight || Math.random() < 0.3) {
      const turns = this.DIRS.filter(d => d !== dir && !back(d) && free(d));
      if (turns.length) dir = turns[Math.floor(rnd(0, turns.length))];
      else if (!straight) { pipe.alive = false; s.segs.push({ a: pipe.p, b: pipe.p, pipe, end: true }); return; }
    }
    const q = free(dir);
    if (!q) { pipe.alive = false; return; }
    s.segs.push({ a: pipe.p, b: q, pipe, joint: dir !== pipe.dir });
    s.taken.add(q.join());
    pipe.p = q;
    pipe.dir = dir;
  },
  grow(s, steps) {
    for (let i = 0; i < steps; i++) {
      if (s.segs.length >= 640) { s.hold = s.hold || 0.001; return; }
      if (s.pipes.filter(p => p.alive).length < 4) this.newPipe(s);
      for (const p of s.pipes) if (p.alive) this.step(s, p);
    }
  },
  draw(ctx, W, H, s, dt, t) {
    if (dt === 0 && !s.segs.length) this.grow(s, 120);                /* a still scene needs something to show */
    s.clock += dt;
    while (s.clock > 0.07 && !s.hold) { s.clock -= 0.07; this.grow(s, 1); }
    if (s.hold) {                                                    /* full: wait, fade out, start again */
      s.hold += dt;
      if (s.hold > 5) s.fade = Math.min(1, (s.hold - 5) / 1.6);
      if (s.hold > 6.8) Object.assign(s, this.init(), { yaw: s.yaw + t * 0.12 });
    }
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#04060d');
    bg.addColorStop(1, '#0b1020');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const yaw = s.yaw + t * 0.12, cy = Math.cos(yaw), sy = Math.sin(yaw), tilt = 0.5, ct = Math.cos(tilt), st = Math.sin(tilt);
    const half = (this.N - 1) / 2, f = Math.min(W, H) * 1.55, cam = this.N * 1.9;
    const pr = p => {
      const x = p[0] - half, y = p[1] - half, z = p[2] - half;
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
      const k = f / (cam + z2);
      return { x: W / 2 + x1 * k, y: H / 2 + y2 * k, z: z2, k };
    };
    const items = s.segs.map(g => { const a = pr(g.a), b = pr(g.b); return { g, a, b, z: (a.z + b.z) / 2 }; });
    items.sort((p, q) => q.z - p.z);
    ctx.lineCap = 'round';
    for (const { g, a, b } of items) {
      const p = g.pipe;
      const w = Math.max(3, (a.k + b.k) / 2 * 0.3);
      if (!g.end) {
        ctx.strokeStyle = p.dark; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = p.base; ctx.lineWidth = w * 0.76;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = p.light; ctx.lineWidth = w * 0.22;
        ctx.beginPath(); ctx.moveTo(a.x - w * 0.14, a.y - w * 0.18); ctx.lineTo(b.x - w * 0.14, b.y - w * 0.18); ctx.stroke();
      }
      if (g.joint || g.end) {                                        /* a ball where it turns or stops */
        const r = w * 0.62;
        const gr = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
        gr.addColorStop(0, p.light); gr.addColorStop(0.6, p.base); gr.addColorStop(1, p.dark);
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
      }
    }
    if (s.fade) { ctx.fillStyle = `rgba(4,6,13,${s.fade.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  },
};

/* a night sky that is not flying anywhere: the stars sit still, twinkle and
   turn very slowly about a point, over hills, pines and a lit window */
SCENES.nightsky = {
  init(W, H) {
    const R = Math.hypot(W, H);
    const px = W * 0.3, py = H * 0.2;
    const n = Math.max(320, Math.min(900, Math.round((W * H) / 2600)));
    const stars = Array.from({ length: n }, () => {
      const a = rnd(0, TAU), d = Math.sqrt(Math.random()) * R * 1.05;
      const m = Math.random();
      const warm = Math.random();
      return {
        x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.6 + m * m * 1.9, a: 0.5 + m * 0.5,
        c: warm < 0.2 ? '255,214,170' : warm < 0.45 ? '176,200,255' : '240,244,255', tf: rnd(0.5, 2.4), tp: rnd(0, TAU),
      };
    });
    /* a faint band of far-off stars: the Milky Way */
    const band = rnd(0.2, 0.5);
    const dust = Array.from({ length: 700 }, () => {
      const u = rnd(-1, 1) * R * 0.9, v = (Math.random() + Math.random() + Math.random() - 1.5) * R * 0.12;
      return { x: u * Math.cos(band) - v * Math.sin(band), y: u * Math.sin(band) + v * Math.cos(band), r: rnd(0.4, 1.1), a: rnd(0.2, 0.55) };
    });
    const hills = [0, 1].map(k => Array.from({ length: 10 }, (_, i) => ({ p: rnd(0, TAU), f: 0.6 + k * 0.5 + i * 0.18, a: rnd(0.2, 1) / (1 + i * 0.6) })));
    const pines = Array.from({ length: Math.max(5, Math.round(W / 150)) }, () => ({ x: rnd(0, W), h: rnd(0.05, 0.11) * H }));
    return { stars, dust, px, py, band, hills, pines, shoot: null, next: rnd(5, 12), win: rnd(0.2, 0.35) * W };
  },
  hill(k, x, W, H, s) {
    let y = 0;
    for (const o of s.hills[k]) y += Math.sin(x / W * TAU * 0.5 * o.f + o.p) * o.a;
    return H * (k ? 0.9 : 0.83) - y * H * 0.035;
  },
  draw(ctx, W, H, s, dt, t) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#01020a');
    bg.addColorStop(0.6, '#07122a');
    bg.addColorStop(1, '#16284a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const ang = t * 0.0035, ca = Math.cos(ang), sa = Math.sin(ang);
    const X = o => s.px + o.x * ca - o.y * sa, Y = o => s.py + o.x * sa + o.y * ca;
    /* the band's glow, then its dust */
    for (let k = -3; k <= 3; k++) {
      const o = { x: Math.cos(s.band) * k * W * 0.3, y: Math.sin(s.band) * k * W * 0.3 };
      const gx = X(o), gy = Y(o), gr = Math.max(W, H) * 0.3;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, 'rgba(150,170,230,0.12)');
      g.addColorStop(1, 'rgba(150,170,230,0)');
      ctx.fillStyle = g;
      ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    for (const d of s.dust) {
      const x = X(d), y = Y(d);
      if (x < 0 || x > W || y < 0 || y > H * 0.92) continue;
      ctx.fillStyle = `rgba(200,215,255,${d.a})`;
      ctx.fillRect(x, y, d.r + 0.4, d.r + 0.4);
    }
    for (const st of s.stars) {
      const x = X(st), y = Y(st);
      if (x < -4 || x > W + 4 || y < -4 || y > H * 0.93) continue;
      const tw = 0.62 + 0.38 * Math.sin(t * st.tf + st.tp);
      ctx.fillStyle = `rgba(${st.c},${(st.a * tw).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, st.r * (0.85 + 0.15 * tw), 0, TAU);
      ctx.fill();
    }
    /* a thin moon, fixed, with a glow */
    const mr = Math.min(W, H) * 0.045, mx = W * 0.78, my = H * 0.24;
    const glow = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 5);
    glow.addColorStop(0, 'rgba(255,240,200,0.20)');
    glow.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    ctx.fillStyle = '#fff1cf';
    ctx.beginPath();
    ctx.arc(mx, my, mr, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(mx, my, mr * 0.42, mr, 0, Math.PI / 2, -Math.PI / 2, true);
    ctx.fill();
    /* now and then a shooting star */
    if (dt > 0) {
      s.next -= dt;
      if (!s.shoot && s.next <= 0) {
        s.shoot = { x: rnd(W * 0.1, W * 0.7), y: rnd(0, H * 0.3), vx: rnd(500, 800), vy: rnd(160, 320), life: 0 };
        s.next = rnd(9, 20);
      }
    }
    if (s.shoot) {
      const m = s.shoot;
      m.life += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      const a = Math.max(0, 1 - m.life / 0.9);
      const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.18, m.y - m.vy * 0.18);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - m.vx * 0.18, m.y - m.vy * 0.18); ctx.stroke();
      if (m.life > 0.9) s.shoot = null;
    }
    /* the land: two hills, pines and one lit window */
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = k ? '#04070e' : '#0a1426';
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W + 12; x += 12) ctx.lineTo(x, this.hill(k, x, W, H, s));
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#03050b';
    for (const p of s.pines) {
      const y = this.hill(1, p.x, W, H, s) + 4, w = p.h * 0.38;
      for (let i = 0; i < 3; i++) {
        const top = y - p.h * (0.45 + i * 0.28), base = y - p.h * (i * 0.28), ww = w * (1 - i * 0.22);
        ctx.beginPath(); ctx.moveTo(p.x, top); ctx.lineTo(p.x + ww, base); ctx.lineTo(p.x - ww, base); ctx.closePath(); ctx.fill();
      }
    }
    const wx = s.win, wy = this.hill(1, wx, W, H, s);
    ctx.fillStyle = '#03050b';
    ctx.fillRect(wx - 14, wy - 16, 28, 18);
    ctx.fillStyle = `rgba(255,200,110,${0.8 + 0.12 * Math.sin(t * 2.1)})`;
    ctx.fillRect(wx - 4, wy - 11, 7, 6);
  },
};

/* ---------- the shell part ---------------------------------------- */
export function mountScreensaver(host) {
  const { h } = api;
  let last = Date.now();
  let timer = 0;
  let view = null;            /* { el, cv, ctx, style, scene, raf, release, prev, ... } while it shows */
  let dead = false;

  /* ---- idle time ---- */
  const poke = () => { last = Date.now(); };
  function arm(ms) {
    clearTimeout(timer);
    timer = 0;
    if (dead || view || !delayMinutes()) return;
    timer = setTimeout(check, Math.max(250, ms));
  }
  function check() {
    timer = 0;
    const d = delayMinutes() * 60e3;
    if (!d || view || dead) return;
    /* something is playing or in front: that counts as being here */
    if (blocker()) { poke(); arm(Math.min(d, RECHECK)); return; }
    const idle = Date.now() - last;
    if (idle >= d) { show(); return; }
    arm(Math.min(d - idle, RECHECK));
  }

  /* ---- showing it ---- */
  function show({ preview = false } = {}) {
    if (view || dead) return;
    const style = styleNow();
    const still = reducedMotion();
    const cv = h('canvas.ssaver__cv', { 'aria-hidden': 'true' });
    const el = h('div.ssaver' + (still ? '.is-still' : ''), {
      role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
      'aria-label': 'Screensaver. Press any key or move the pointer to come back.',
      dataset: { style },
    }, cv);
    const prev = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    view = {
      el, cv, ctx: cv.getContext('2d'), style, still, prev,
      scene: null, raf: 0, fadeT: 0, t0: performance.now(), lastT: 0,
      armedAt: performance.now() + (preview ? 900 : 250),
      moved: 0, at: null, leaving: false, buttons: 0,
    };
    host.appendChild(el);
    size();
    cover('screensaver', true);
    try { el.focus({ preventScroll: true }); } catch (e) {}
    view.release = L.push({ name: 'screensaver', el, trap: true, close: () => wake() });
    M.start('screensaver');
    bus.emit('screensaver:shown', { preview, style });         /* a real idle start counts for Achievements; Preview does not */
    if (still) stillLoop(); else view.raf = requestAnimationFrame(frame);
    clearTimeout(timer);
    timer = 0;
  }

  function size() {
    if (!view) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
    view.W = W; view.H = H;
    view.cv.width = Math.round(W * dpr);
    view.cv.height = Math.round(H * dpr);
    view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.scene = SCENES[view.style].init(W, H);
    if (view.still) paintStill();
  }

  function frame(now) {
    if (!view || view.leaving) return;
    const dt = view.lastT ? Math.min(0.05, (now - view.lastT) / 1000) : 0;
    view.lastT = now;
    const sc = SCENES[view.style];
    sc.draw(view.ctx, view.W, view.H, view.scene, dt, (now - view.t0) / 1000);
    view.raf = requestAnimationFrame(frame);
  }

  /* reduced motion: a still scene, and every so often a slow fade to another */
  function paintStill() {
    const sc = SCENES[view.style];
    view.scene = sc.init(view.W, view.H);
    sc.draw(view.ctx, view.W, view.H, view.scene, 0, rnd(0, 60));
  }
  function stillLoop() {
    const v = view;
    v.fadeT = setTimeout(() => {
      if (view !== v || v.leaving) return;
      v.cv.classList.add('is-dim');
      v.fadeT = setTimeout(() => {
        if (view !== v || v.leaving) return;
        paintStill();
        v.cv.classList.remove('is-dim');
        stillLoop();
      }, 2600);
    }, 12000);
  }

  /* ---- waking ---- */
  function wake() {
    const v = view;
    if (!v || v.leaving) return;
    v.leaving = true;
    cancelAnimationFrame(v.raf);
    clearTimeout(v.fadeT);
    M.stop('screensaver');
    cover('screensaver', false);
    v.release?.({ restoreFocus: false });
    if (v.prev && v.prev.isConnected) { try { v.prev.focus({ preventScroll: true }); } catch (e) {} }
    else bus.emit('a11y:refocus');
    v.el.classList.add('is-out');
    poke();
    /* the overlay stays a moment, still catching the pointer, so the
       click that woke it never lands on what is underneath */
    const started = performance.now();
    const done = () => {
      if (view !== v) return;
      if (v.buttons && performance.now() - started < 5000) { v.doneT = setTimeout(done, 80); return; }
      v.el.remove();
      view = null;
      arm(delayMinutes() * 60e3);
    };
    v.doneT = setTimeout(done, FADE_MS);
  }

  /* input while it shows: wake on it, and keep it from everything else */
  function swallow(e) {
    e.stopImmediatePropagation();
    if (e.cancelable && e.type !== 'wheel' && e.type !== 'touchstart' && e.type !== 'touchmove') e.preventDefault();
  }
  const ready = () => view && !view.leaving && performance.now() >= view.armedAt;

  function onKey(e) {
    poke();
    if (!view) return;
    /* after waking, typing goes where it was going: only the waking key's
       own release is kept back */
    if (view.leaving) { if (e.type === 'keyup' && e.code === view.wakeKey) swallow(e); return; }
    swallow(e);
    if (e.type === 'keydown' && !e.repeat && ready()) { view.wakeKey = e.code; wake(); }
  }
  function onPointer(e) {
    poke();
    if (!view) return;
    if (e.type === 'pointerdown') view.buttons = 1;
    if (e.type === 'pointerup' || e.type === 'pointercancel') view.buttons = 0;
    if (e.type === 'pointermove') {
      if (view.leaving) return;
      if (!view.at) { view.at = { x: e.clientX, y: e.clientY }; return; }
      view.moved += Math.hypot(e.clientX - view.at.x, e.clientY - view.at.y);
      view.at = { x: e.clientX, y: e.clientY };
      if (view.moved >= MOVE_PX && ready()) wake();
      else if (!ready()) view.moved = 0;
      return;
    }
    swallow(e);
    if ((e.type === 'pointerdown' || e.type === 'wheel' || e.type === 'touchstart') && ready()) wake();
  }

  const offs = [];
  const opt = { capture: true };
  const optP = { capture: true, passive: true };
  for (const t of ['keydown', 'keyup']) offs.push(api.on(window, t, onKey, opt));
  for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) offs.push(api.on(window, t, onPointer, opt));
  for (const t of ['pointermove', 'wheel', 'touchstart']) offs.push(api.on(window, t, onPointer, optP));
  offs.push(api.on(window, 'pointerover', e => { overFrame = e.target?.tagName === 'IFRAME'; }, true));
  offs.push(api.on(window, 'pointerout', e => { if (!e.relatedTarget) overFrame = false; }, true));
  offs.push(api.on(document, 'visibilitychange', () => { if (!document.hidden) { poke(); if (!view) arm(1000); } }));
  offs.push(api.on(window, 'resize', () => { if (view && !view.leaving) size(); }));
  offs.push(store.sub('prefs.screensaver', () => { poke(); arm(1000); }));
  offs.push(bus.on('screensaver:preview', () => show({ preview: true })));
  offs.push(bus.on('screensaver:wake', () => wake()));
  /* the lock screen goes over everything: put this away first */
  offs.push(bus.on('power:lock', () => wake()));

  arm(1000);
  /* for tests and the console */
  if (window.Static) window.Static.screensaver = { show: () => show({ preview: true }), wake, blocker, styleNow, showing: () => !!view && !view.leaving };

  return () => {
    dead = true;
    clearTimeout(timer);
    if (view) { const v = view; wake(); clearTimeout(v.doneT); v.el.remove(); view = null; }
    offs.forEach(off => { try { off?.(); } catch (e) {} });
  };
}

export default mountScreensaver;
