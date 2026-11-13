/* ============================================================
   spooky.js — the moving parts of spooky season.

   js/core/season.js decides WHEN (October 24 – November 1, and
   only while Settings → Spooky Season is on); css/feat-spooky.css
   paints the accent, the haunted house and the cursor; the
   countdown is a seasonal desktop widget (shell/deskwidgets.js).
   This module does the rest:

   · keeps the seasons current — a tab left open across midnight
     on October 23 or November 1 (or into and out of winter)
     changes over by itself;
   · leaves and bats drifting across the wallpaper: ONE canvas on
     the desktop layer (shell/seasonfx.js, shared with winter's
     snow), behind every window, ~20 sprites. It stops
     drawing while the tab is hidden, in Game Mode, when wallpaper
     motion is off (by hand or by the frame-rate check), and it is
     never created under reduced motion;
   · the sound pack (off by default): a creak when a window opens,
     a "boo" for a notification, a cackle when the Trash empties.
     The cues live in core/sfx.js with every other sound; while
     they are on, the plain open/notify cues step aside rather than
     playing on top.

   Outside the season every listener here returns at its first
   line and nothing is on the page.
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as SEASON from '../core/season.js';
import * as sfx from '../core/sfx.js';
import { seasonCanvas } from './seasonfx.js';
import * as SUMMARY from '../core/notisummary.js';

export function mountSpooky(host) {
  const offs = [];

  /* ================================================================
     leaves and bats — on the canvas shell/seasonfx.js keeps (when it
     exists, when it draws); this part only says what is on it
     ================================================================ */
  const fx = { w: 0, h: 0, leaves: [], bats: [], nextBat: 0, sprites: null };

  const LEAF_COLOURS = ['#ff8a1e', '#e8601c', '#c9431a', '#f2b134', '#b4531f', '#de7b2b', '#9c3a1c'];

  /* the two leaf outlines, in a 36-unit box centred on 0,0, tip up */
  const MAPLE = [[0, -16], [2.6, -9], [6.5, -11], [5.6, -4.6], [13, -7], [10.6, -1.2], [15, 1.6], [8, 4.6], [9, 9.4],
    [2.4, 6.6], [1, 12], [-1, 12], [-2.4, 6.6], [-9, 9.4], [-8, 4.6], [-15, 1.6], [-10.6, -1.2], [-13, -7], [-5.6, -4.6], [-6.5, -11], [-2.6, -9]];
  /* one small bitmap per (shape, colour), drawn once and stamped every frame */
  function makeSprites(dpr) {
    const S = Math.round(36 * dpr);
    const out = [];
    for (const colour of LEAF_COLOURS) {
      for (const shape of ['maple', 'almond']) {
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        g.translate(S / 2, S / 2);
        g.scale(S / 36, S / 36);
        g.fillStyle = colour;
        g.strokeStyle = 'rgba(40,12,4,.5)';
        g.lineWidth = 0.8;
        g.lineJoin = 'round';
        g.beginPath();
        if (shape === 'maple') MAPLE.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        else { g.moveTo(0, -15); g.bezierCurveTo(9, -8, 8, 6, 0, 12); g.bezierCurveTo(-8, 6, -9, -8, 0, -15); }
        g.closePath();
        g.fill();
        g.stroke();
        /* veins and the stem */
        g.beginPath();
        g.moveTo(0, -12); g.lineTo(0, 16);
        if (shape === 'maple') { g.moveTo(0, 2); g.lineTo(10, -4); g.moveTo(0, 2); g.lineTo(-10, -4); }
        g.stroke();
        out.push(c);
      }
    }
    return out;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  function leaf(anywhere) {
    return {
      x: rnd(-20, fx.w + 20),
      y: anywhere ? rnd(-40, fx.h) : rnd(-80, -24),
      size: rnd(16, 28),
      vy: rnd(22, 46),                     /* px per second */
      drift: rnd(-12, 12),
      sway: rnd(18, 54), swayHz: rnd(0.18, 0.42), phase: rnd(0, Math.PI * 2),
      rot: rnd(0, Math.PI * 2), spin: rnd(-1.4, 1.4),
      flip: rnd(0, Math.PI * 2), flipHz: rnd(0.3, 0.9),
      sprite: Math.floor(Math.random() * LEAF_COLOURS.length * 2),
      alpha: rnd(0.7, 0.95),
    };
  }

  function bat() {
    const ltr = Math.random() < 0.5;
    return {
      x: ltr ? -40 : fx.w + 40,
      y: rnd(fx.h * 0.08, fx.h * 0.5),
      vx: (ltr ? 1 : -1) * rnd(90, 170),
      bob: rnd(10, 26), bobHz: rnd(0.4, 0.9), phase: rnd(0, Math.PI * 2),
      flapHz: rnd(6.5, 9.5), size: rnd(12, 22), t: 0,
    };
  }

  function drawBat(g, b) {
    const flap = Math.sin(b.t * b.flapHz * Math.PI * 2);
    const s = b.size;
    const wy = flap * s * 0.55;            /* wing tips swing up and down */
    g.save();
    g.translate(b.x, b.y + Math.sin(b.t * b.bobHz * Math.PI * 2 + b.phase) * b.bob);
    if (b.vx < 0) g.scale(-1, 1);
    g.fillStyle = '#0b0510';
    g.beginPath();
    g.moveTo(0, -s * 0.12);
    /* right wing: shoulder → tip → scalloped trailing edge back to the body */
    g.quadraticCurveTo(s * 0.45, -s * 0.35 + wy * 0.5, s, wy - s * 0.1);
    g.quadraticCurveTo(s * 0.82, wy * 0.6 + s * 0.12, s * 0.66, wy * 0.45 + s * 0.08);
    g.quadraticCurveTo(s * 0.5, wy * 0.3 + s * 0.22, s * 0.34, wy * 0.2 + s * 0.1);
    g.quadraticCurveTo(s * 0.2, s * 0.22, 0, s * 0.18);
    /* left wing, mirrored */
    g.quadraticCurveTo(-s * 0.2, s * 0.22, -s * 0.34, wy * 0.2 + s * 0.1);
    g.quadraticCurveTo(-s * 0.5, wy * 0.3 + s * 0.22, -s * 0.66, wy * 0.45 + s * 0.08);
    g.quadraticCurveTo(-s * 0.82, wy * 0.6 + s * 0.12, -s, wy - s * 0.1);
    g.quadraticCurveTo(-s * 0.45, -s * 0.35 + wy * 0.5, 0, -s * 0.12);
    g.fill();
    /* head and ears */
    g.beginPath();
    g.ellipse(0, -s * 0.06, s * 0.12, s * 0.16, 0, 0, Math.PI * 2);
    g.moveTo(-s * 0.1, -s * 0.16); g.lineTo(-s * 0.07, -s * 0.34); g.lineTo(-s * 0.02, -s * 0.2);
    g.moveTo(s * 0.1, -s * 0.16); g.lineTo(s * 0.07, -s * 0.34); g.lineTo(s * 0.02, -s * 0.2);
    g.fill();
    g.restore();
  }

  /* Should the canvas be on the page at all? seasonfx adds reduced motion and the phone */
  const weather = seasonCanvas(host, {
    className: 'spooky-fx',
    wanted: () => SEASON.spooky('effects'),
    start(S) {
      fx.leaves = [];
      fx.bats = [];
      fx.nextBat = performance.now() + 1500;
    },
    resize(S) {
      fx.w = S.w; fx.h = S.h;
      fx.sprites = makeSprites(S.dpr);
      const want = Math.round(Math.max(8, Math.min(22, (fx.w * fx.h) / 70000)));
      while (fx.leaves.length < want) fx.leaves.push(leaf(true));
      fx.leaves.length = want;
    },
    draw(g, dt, now) {
      for (const p of fx.leaves) {
        p.phase += dt * p.swayHz * Math.PI * 2;
        p.flip += dt * p.flipHz * Math.PI * 2;
        p.rot += dt * p.spin;
        p.y += p.vy * dt;
        p.x += p.drift * dt;
        if (p.y > fx.h + 40 || p.x < -60 || p.x > fx.w + 60) Object.assign(p, leaf(false));
        const x = p.x + Math.sin(p.phase) * p.sway;
        g.save();
        g.globalAlpha = p.alpha;
        g.translate(x, p.y);
        g.rotate(p.rot + Math.sin(p.phase) * 0.6);
        /* the tumble: a leaf seen edge-on is thin */
        g.scale(Math.max(0.18, Math.abs(Math.cos(p.flip))), 1);
        g.drawImage(fx.sprites[p.sprite], -p.size / 2, -p.size / 2, p.size, p.size);
        g.restore();
      }

      if (now > fx.nextBat && fx.bats.length < 3) {
        fx.bats.push(bat());
        fx.nextBat = now + rnd(5000, 13000);
      }
      g.globalAlpha = 0.92;
      fx.bats = fx.bats.filter(b => {
        b.t += dt;
        b.x += b.vx * dt;
        drawBat(g, b);
        return b.x > -80 && b.x < fx.w + 80;
      });
    },
    stop() { fx.sprites = null; fx.leaves = []; fx.bats = []; },
  });
  const syncFx = () => weather.sync();

  /* ================================================================
     sounds
     ================================================================ */
  const soundsOn = () => SEASON.spooky('sounds');
  const CLAIMS = ['open', 'notify'];
  function syncClaims() {
    for (const c of CLAIMS) {
      if (soundsOn()) sfx.claimed.add(c);
      else sfx.claimed.delete(c);
    }
  }
  /* a burst (a restored session, a run of toasts) gets one cue, not a pile */
  const lastAt = {};
  function cue(name, gap) {
    const now = performance.now();
    if (now - (lastAt[name] || -1e9) < gap) return false;
    lastAt[name] = now;
    return sfx.spooky(name, SEASON.spookyLevel());
  }
  const seenKeys = new Set();
  const notiMuted = n => (store.get('prefs.notiApps', {}) || {})[n?.appId || n?.app] === false;

  offs.push(
    bus.on('win:open', () => { if (soundsOn()) cue('creak', 450); }),
    bus.on('noti:push', n => {
      if (!soundsOn() || store.get('prefs.dnd') || notiMuted(n) || SUMMARY.holds(n)) return;
      /* a progress notification re-sent under the same key is an update, not news */
      if (n?.key) { if (seenKeys.has(n.key)) return; seenKeys.add(n.key); }
      cue('boo', 1600);
    }),
    bus.on('trash:emptied', () => { if (soundsOn()) cue('cackle', 800); }),
  );

  /* ================================================================
     wiring
     ================================================================ */
  function syncAll() { syncFx(); syncClaims(); }
  syncAll();

  offs.push(
    bus.on('season:change', syncAll),
    store.sub('prefs', syncAll),
    /* the date is the one input nothing announces: look every few seconds,
       so midnight at the start or end of a season changes the desktop over
       (js/core/season.js does every season at once) */
    bus.on('tick:5s', () => SEASON.applyRoot()),
  );

  return () => {
    offs.forEach(f => { try { f(); } catch (e) {} });
    for (const c of CLAIMS) sfx.claimed.delete(c);
    weather.destroy();
  };
}

export default mountSpooky;
