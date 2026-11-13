/* ============================================================
   arcade/runner.js — Endless Runner for Static Arcade.

   A little sprinter runs on its own and the world scrolls faster
   the longer you last. Jump the spikes and pillars, duck under the
   hovering drones.

   · Jump: Space / ↑ / W, or press the upper part of the screen. Hold
     it for a high jump, tap it for a short hop.
   · Duck: ↓ / S, or press the lower part of the screen. In the air a
     duck drops you faster.
   · Score is the distance in metres. The speed ramps up with it, the
     gaps stay fair, and the sky slowly turns from day to night (and
     back) every 160 m. The three backdrop layers scroll at different
     speeds.
   · Reduced motion: the backdrop stops drifting and nothing flashes;
     the game is the same.
   Test hook (el.arcadeHook): inert unless called; see the end of mount().
   ============================================================ */
import { clamp, hsl, FONT, coarse, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';

const VH = 300, GROUND = 240;
const PX = 96;                                  /* the runner's x on screen */
const PW = 30, PH = 56, DH = 30, DW = 40;       /* standing and ducking boxes */
const G_UP = 1500, G_DOWN = 3000, G_FAST = 7000, JUMP_V = 620;
const PX_PER_M = 40, CYCLE_M = 160;
const KINDS = {
  spike:  { w: 28, h: 36, y: 0 },
  pillar: { w: 26, h: 68, y: 0 },
  twin:   { w: 64, h: 36, y: 0 },
  drone:  { w: 46, h: 40, y: 44 },              /* hovers: its underside is 44 above the ground, so only a duck fits */
};

const seeded = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const rnd = seeded(11);
const STARS = Array.from({ length: 60 }, () => ({ x: rnd() * 1400, y: rnd() * 150, r: rnd() * 1.2 + 0.4 }));
const RIDGE = Array.from({ length: 24 }, (_, i) => ({ x: i * 90, w: 110 + rnd() * 70, h: 50 + rnd() * 70 }));
const HILLS = Array.from({ length: 30 }, (_, i) => ({ x: i * 60, w: 90 + rnd() * 50, h: 22 + rnd() * 34 }));
const TREES = Array.from({ length: 40 }, (_, i) => ({ x: i * 48 + rnd() * 24, h: 24 + rnd() * 26 }));

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',                    /* ready | play | dying | over */
      paused: false, manual: false, auto: true,
      dist: 0, score: 0, time: 0, passed: 0,
      h: 0, vy: 0, jumpHeld: false, duckHeld: false, buffer: 0, run: 0,
      obs: [], next: 260, dieT: 0, shake: 0, lastKind: '',
      jumps: 0,
    };
    const sf = surface(el, 'Endless Runner', () => draw());
    /* world units: x = 0 at the left edge, VH tall, as wide as the window's shape allows */
    const view = () => {
      const k = Math.min(sf.h / VH, sf.w / 420);
      return { vw: sf.w / k, k, ox: 0, oy: (sf.h - VH * k) / 2 };
    };
    ctx.onScore(0);

    /* ------------------------------ rules ------------------------------ */
    const speed = () => Math.min(720, 280 + 1.6 * S.score);
    const grounded = () => S.h <= 0.001 && S.vy <= 0;
    const boxOf = () => {
      const duck = S.duckHeld && grounded();
      const w = duck ? DW : PW, h = duck ? DH : PH;
      return { x0: PX - w / 2 + 4, x1: PX + w / 2 - 4, y0: S.h + 3, y1: S.h + h - 3, duck };    /* heights above the ground */
    };

    function spawn(kind, x) {
      const k = KINDS[kind];
      S.obs.push({ kind, x, w: k.w, h: k.h, y: k.y, passed: false, ph: Math.random() * 6 });
      S.lastKind = kind;
    }
    function pickKind() {
      const pool = ['spike', 'spike', 'pillar', 'twin'];
      if (S.score >= 12) pool.push('drone', 'drone');
      return pool[Math.floor(Math.random() * pool.length)];
    }

    function jump() {
      if (S.paused || S.state === 'over' || S.state === 'dying') return;
      if (S.state === 'ready') { S.state = 'play'; }
      S.jumpHeld = true;
      if (grounded()) {
        S.vy = JUMP_V; S.h = 0.01; S.jumps++;
        snd.blip(420, 0.12, 'triangle', 0.8, 760);
      } else S.buffer = 0.12;
    }
    const release = () => { S.jumpHeld = false; };

    function die() {
      if (S.state !== 'play') return;
      S.state = 'dying'; S.dieT = 0; S.shake = reduced ? 0 : 0.3;
      snd.blip(200, 0.4, 'sawtooth', 0.9, 50);
    }

    function sub(dt) {
      S.time += dt;
      if (S.state === 'ready') return;
      if (S.state === 'play') {
        const v = speed();
        S.dist += v * dt;
        const m = Math.floor(S.dist / PX_PER_M);
        if (m !== S.score) { S.score = m; ctx.onScore(m); }
        S.run += dt * (6 + v / 80);
        if (S.buffer > 0) S.buffer -= dt;
        /* body */
        if (!grounded() || S.vy > 0) {
          const g = S.duckHeld ? G_FAST : S.vy > 0 ? (S.jumpHeld ? G_UP : G_DOWN) : G_DOWN;
          S.vy -= g * dt;
          S.h += S.vy * dt;
          if (S.h <= 0) {
            S.h = 0; S.vy = 0;
            if (S.buffer > 0 && S.jumpHeld) { S.vy = JUMP_V; S.h = 0.01; S.jumps++; S.buffer = 0; }
          }
        }
        /* world */
        for (const o of S.obs) {
          o.x -= v * dt;
          if (!o.passed && o.x + o.w < PX - PW / 2) { o.passed = true; S.passed++; }
        }
        S.obs = S.obs.filter(o => o.x + o.w > -60);
        S.next -= v * dt;
        const vw = view().vw;
        if (S.auto && S.next <= 0) {
          const kind = pickKind();
          spawn(kind, vw + 60);
          S.next = v * 0.72 + 170 + Math.random() * 230;
        }
        /* contact */
        const b = boxOf();
        for (const o of S.obs) {
          if (b.x1 <= o.x + 3 || b.x0 >= o.x + o.w - 3) continue;
          const oy0 = o.y, oy1 = o.y + o.h;
          if (b.y1 > oy0 + 2 && b.y0 < oy1 - 2) { die(); break; }
        }
      } else if (S.state === 'dying') {
        S.dieT += dt;
        S.vy -= G_DOWN * dt; S.h = Math.max(0, S.h + S.vy * dt); if (S.h === 0) S.vy = 0;
        if (S.dieT > 0.7) {
          S.state = 'over';
          ctx.onEnd({ score: S.score, won: false, detail: `${S.score} m · ${S.passed} obstacle${S.passed === 1 ? '' : 's'} cleared` });
        }
      }
    }
    function update(dt) {
      const n = Math.max(1, Math.ceil(dt * 60));
      for (let i = 0; i < n; i++) sub(dt / n);
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt);
    }
    const loop = looper(dt => {
      if (!S.manual) update(dt);
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    /* 0 = full day, 1 = deep night, easing through dusk */
    const nightness = () => {
      const t = (S.dist / PX_PER_M / CYCLE_M) % 1;
      const k = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      return clamp((k - 0.25) / 0.5, 0, 1);
    };
    const mix = (a, b, t) => Math.round(a + (b - a) * t);
    function layer(g, items, factor, y, vw, wrap, paint) {
      const off = (reduced ? 0 : S.dist * factor) % wrap;
      for (let rep = -1; rep * wrap < vw + wrap; rep++) for (const it of items) {
        const x = it.x + rep * wrap - off;
        if (x > vw + 200 || x < -260) continue;
        paint(g, it, x, y);
      }
    }
    function drawRunner(g, x, footY) {
      const b = boxOf(), air = !grounded();
      const dead = S.state === 'dying' || S.state === 'over';
      g.save();
      g.translate(x, footY);
      if (dead) g.rotate(reduced ? 0 : Math.min(1.2, S.dieT * 3));
      const ph = S.run, leg = air ? 0.9 : Math.sin(ph) * 0.9;
      g.lineCap = 'round';
      /* scarf */
      g.strokeStyle = hsl(345, 85, 58); g.lineWidth = 4;
      const hy = b.duck ? -DH + 6 : -PH + 10;
      g.beginPath(); g.moveTo(-6, hy + 4); g.quadraticCurveTo(-22, hy + (air ? -4 : 6 + Math.sin(ph * 1.3) * 3), -34, hy + (air ? 6 : 0 + Math.sin(ph) * 4)); g.stroke();
      /* legs */
      g.strokeStyle = hsl(215, 40, 28); g.lineWidth = 6;
      const lh = b.duck ? 10 : 20;
      for (const s of [1, -1]) {
        g.beginPath(); g.moveTo(0, -lh);
        g.lineTo(s * leg * 11, -(b.duck ? 0 : 3) - (air && s < 0 ? 8 : 0));
        g.stroke();
      }
      /* body and head */
      g.fillStyle = hsl(195, 80, 55);
      if (b.duck) { rr(g, -18, -DH + 2, 36, 22, 9); g.fill(); g.fillStyle = hsl(40, 90, 70); g.beginPath(); g.arc(12, -DH + 8, 8, 0, 7); g.fill(); }
      else { rr(g, -11, -PH + 18, 22, 28, 9); g.fill(); g.fillStyle = hsl(40, 90, 70); g.beginPath(); g.arc(2, -PH + 10, 10, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(8,10,24,.85)';
      const vy2 = b.duck ? -DH + 6 : -PH + 8;
      rr(g, b.duck ? 8 : 4, vy2, 12, 6, 3); g.fill();
      g.fillStyle = '#fff'; g.fillRect(b.duck ? 15 : 11, vy2 + 2, 3, 2);
      g.restore();
    }
    function drawObstacle(g, o, ox) {
      const x = ox, top = GROUND - o.y - o.h, bottom = GROUND - o.y;
      if (o.kind === 'drone') {
        const bob = reduced ? 0 : Math.sin(S.time * 4 + o.ph) * 2;
        g.fillStyle = hsl(355, 75, 52); rr(g, x, top + 12 + bob, o.w, 20, 9); g.fill();
        g.fillStyle = hsl(355, 90, 78); g.beginPath(); g.arc(x + o.w / 2, top + 22 + bob, 5, 0, 7); g.fill();
        g.strokeStyle = hsl(215, 20, 70); g.lineWidth = 3;
        const sp = reduced ? 8 : Math.sin(S.time * 40) * 9;
        g.beginPath(); g.moveTo(x + o.w / 2 - 4, top + 10 + bob); g.lineTo(x + o.w / 2 - 4, top + 3 + bob); g.moveTo(x + o.w / 2 - 20 - sp * 0.2, top + 3 + bob); g.lineTo(x + o.w / 2 + 12 + sp * 0.2, top + 3 + bob); g.stroke();
        g.fillStyle = hsl(355, 60, 40); g.fillRect(x + o.w / 2 - 3, top + 32 + bob, 6, 8);
      } else if (o.kind === 'pillar') {
        g.fillStyle = hsl(265, 35, 28); rr(g, x, top, o.w, o.h, 5); g.fill();
        g.fillStyle = hsl(265, 60, 60); g.fillRect(x + 4, top + 6, 3, o.h - 12);
        g.fillStyle = hsl(265, 45, 40); g.fillRect(x - 3, top, o.w + 6, 7);
      } else {
        const n = o.kind === 'twin' ? 2 : 1, w = o.w / n;
        for (let i = 0; i < n; i++) {
          g.fillStyle = hsl(18, 80, 52);
          g.beginPath(); g.moveTo(x + i * w, bottom); g.lineTo(x + i * w + w / 2, top); g.lineTo(x + i * w + w, bottom); g.closePath(); g.fill();
          g.fillStyle = hsl(30, 95, 72); g.beginPath(); g.moveTo(x + i * w + w / 2, top); g.lineTo(x + i * w + w * 0.62, top + 14); g.lineTo(x + i * w + w * 0.38, top + 14); g.closePath(); g.fill();
        }
      }
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      const { vw, k, ox, oy } = view();
      const night = nightness();
      g.fillStyle = '#04060a'; g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      if (S.shake > 0) g.translate((Math.random() - 0.5) * 8 * S.shake / 0.3, (Math.random() - 0.5) * 8 * S.shake / 0.3);
      g.translate(ox, oy); g.scale(k, k);
      const X0 = -ox / k, X1 = (sf.w - ox) / k;            /* the visible span in world units */
      g.save();
      g.beginPath(); g.rect(X0, -oy / k, X1 - X0, (sf.h) / k); g.clip();
      /* sky */
      const sky = g.createLinearGradient(0, 0, 0, GROUND);
      sky.addColorStop(0, `rgb(${mix(70, 8, night)},${mix(150, 10, night)},${mix(230, 38, night)})`);
      sky.addColorStop(1, `rgb(${mix(190, 30, night)},${mix(225, 28, night)},${mix(250, 70, night)})`);
      g.fillStyle = sky; g.fillRect(X0, -oy / k, X1 - X0, GROUND + oy / k + 1);
      /* stars (night) */
      if (night > 0.05) {
        g.fillStyle = `rgba(255,255,255,${0.9 * night})`;
        for (const s of STARS) { const sx = ((s.x - (reduced ? 0 : S.dist * 0.02)) % 1400 + 1400) % 1400; if (sx > X0 && sx < X1) g.fillRect(sx, s.y, s.r, s.r); }
      }
      /* sun or moon, riding across the sky with the distance */
      const ang = (S.dist / PX_PER_M / CYCLE_M) % 1;
      const bodyX = vw * (0.15 + 0.7 * ((ang * 2) % 1)), bodyY = 120 - 70 * Math.sin(((ang * 2) % 1) * Math.PI);
      g.fillStyle = night < 0.5 ? hsl(48, 100, 75, 1 - night * 1.4) : hsl(210, 30, 90, night);
      g.beginPath(); g.arc(X0 + bodyX, bodyY, 18, 0, Math.PI * 2); g.fill();
      /* parallax: ridge, hills, trees */
      layer(g, RIDGE, 0.06, GROUND, 1400 + X0 + 400, 24 * 90, (gg, it, x) => {
        gg.fillStyle = `rgb(${mix(120, 20, night)},${mix(150, 24, night)},${mix(190, 52, night)})`;
        gg.beginPath(); gg.moveTo(x + X0, GROUND - 20); gg.lineTo(x + X0 + it.w / 2, GROUND - 20 - it.h); gg.lineTo(x + X0 + it.w, GROUND - 20); gg.closePath(); gg.fill();
      });
      layer(g, HILLS, 0.18, GROUND, 1800 + X0, 30 * 60, (gg, it, x) => {
        gg.fillStyle = `rgb(${mix(84, 14, night)},${mix(150, 34, night)},${mix(120, 40, night)})`;
        gg.beginPath(); gg.ellipse(x + X0 + it.w / 2, GROUND - 6, it.w / 2, it.h, 0, Math.PI, 0); gg.fill();
      });
      layer(g, TREES, 0.42, GROUND, 2000 + X0, 40 * 48, (gg, it, x) => {
        gg.fillStyle = `rgb(${mix(40, 6, night)},${mix(100, 22, night)},${mix(70, 28, night)})`;
        gg.beginPath(); gg.moveTo(x + X0 - 9, GROUND); gg.lineTo(x + X0, GROUND - it.h); gg.lineTo(x + X0 + 9, GROUND); gg.closePath(); gg.fill();
      });
      /* ground */
      g.fillStyle = `rgb(${mix(96, 20, night)},${mix(78, 24, night)},${mix(64, 34, night)})`;
      g.fillRect(X0, GROUND, X1 - X0, VH - GROUND + oy / k + 2);
      g.fillStyle = `rgb(${mix(120, 28, night)},${mix(190, 70, night)},${mix(90, 50, night)})`;
      g.fillRect(X0, GROUND, X1 - X0, 5);
      g.fillStyle = `rgba(0,0,0,${0.18 + night * 0.1})`;
      const doff = reduced ? 0 : S.dist % 60;
      for (let x = X0 - 60 - doff; x < X1 + 60; x += 60) g.fillRect(Math.round(x) + 0, GROUND + 18, 26, 3);
      for (let x = X0 - 90 - doff * 1.5; x < X1 + 60; x += 90) g.fillRect(Math.round(x) + 30, GROUND + 38, 18, 3);
      /* things */
      for (const o of S.obs) drawObstacle(g, o, X0 + o.x - (X0 < 0 ? 0 : 0));
      drawRunner(g, X0 + PX, GROUND - S.h);
      /* distance, on the glass */
      g.fillStyle = night > 0.5 ? 'rgba(255,255,255,.85)' : 'rgba(10,20,40,.8)';
      g.font = `800 20px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'top';
      g.fillText(`${S.score} m`, X1 - 14, 10);
      g.restore();
      g.restore();
      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Tap the top to jump' : 'Press Space to run', coarse() ? 'Press the bottom to duck. Hold for a higher jump.' : 'Hold to jump higher. Duck under drones with ↓.', 195, sf.h * 0.38);
    }

    /* ------------------------------ input ------------------------------ */
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === ' ' || k === 'ArrowUp' || k === 'w') {
        e.preventDefault();
        if (S.paused || e.repeat) return;
        snd.wake(); jump();
      } else if (k === 'ArrowDown' || k === 's') {
        e.preventDefault();
        if (S.paused) return;
        snd.wake();
        if (S.state === 'ready') S.state = 'play';
        S.duckHeld = true;
      } else return;
      if (!loop.on && S.state !== 'over') draw();
    };
    const onKeyUp = e => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === ' ' || k === 'ArrowUp' || k === 'w') release();
      else if (k === 'ArrowDown' || k === 's') S.duckHeld = false;
    };
    const held = new Map();                         /* pointerId -> 'jump' | 'duck' */
    const onDown = e => {
      if (S.paused) return;
      const r = sf.cv.getBoundingClientRect();
      const low = (e.clientY - r.top) / r.height > 0.62;
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      snd.wake();
      if (low && S.state !== 'ready') { held.set(e.pointerId, 'duck'); S.duckHeld = true; }
      else { held.set(e.pointerId, 'jump'); jump(); }
    };
    const onUp = e => {
      const w = held.get(e.pointerId);
      held.delete(e.pointerId);
      if (w === 'duck') S.duckHeld = [...held.values()].includes('duck');
      else if (w === 'jump') release();
    };
    const onBlur = () => { S.jumpHeld = false; S.duckHeld = false; held.clear(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    draw();
    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.jumpHeld = false; S.duckHeld = false; held.clear(); loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        state: S.state, paused: S.paused, score: S.score, dist: S.dist, speed: speed(), time: S.time, passed: S.passed,
        height: S.h, vy: S.vy, grounded: grounded(), ducking: S.duckHeld && grounded(), jumps: S.jumps, night: nightness(),
        runnerX: PX, obstacles: S.obs.map(o => ({ kind: o.kind, x: o.x, w: o.w, h: o.h, y: o.y })),
      }),
      /* test hook — nothing in the game calls it:
         manual(bool: stop the clock, step it by hand) · step(seconds) · auto(bool: spawn obstacles on its own)
         spawn({ kind, x }) · clear() · set({ dist }) */
      hook(cmd, arg) {
        if (cmd === 'step') { for (let t = 0; t < arg; t += 1 / 60) update(1 / 60); }
        else if (cmd === 'manual') S.manual = !!arg;
        else if (cmd === 'auto') S.auto = !!arg;
        else if (cmd === 'spawn') spawn(arg.kind, arg.x);
        else if (cmd === 'clear') S.obs = [];
        else if (cmd === 'set') { if ('dist' in arg) S.dist = arg.dist; }
        draw();
        return true;
      },
    };
  },
};
