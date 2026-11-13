/* ============================================================
   arcade/hopper.js — Road Hopper for Static Arcade.

   A frog has to get home. Five lanes of traffic, a grassy verge,
   then a river of logs and turtles, and five homes along the top.

   · One hop per key press, one cell at a time. Cars and trucks
     squash you; the river drowns you unless you are standing on a
     log or a turtle, which carries you along. Turtles dive now and
     then (they sink for a moment first). Being carried off the side
     of the screen is the same as drowning.
   · Reach an empty home to fill it. Fill all five for a new, faster
     round. Each frog has 30 seconds.
   · Three lives. Score: 10 for each new row forward, 50 for a home
     plus 5 per second left, 500 for clearing all five homes.

   Keys: arrows / WASD hop. Touch: swipe in a direction to hop, tap
   to hop forward.
   ============================================================ */
import { clamp, hsl, FONT, coarse, fitView, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';

const COLS = 13, ROWS = 13, CELL = 32;
const VW = COLS * CELL, VH = ROWS * CELL + 30;
const START_ROW = 12, VERGE = 6;
const HOMES = [1, 3, 6, 9, 11];
const TIME_LIMIT = 30, DIE_SECS = 0.9, HOP_SECS = 0.11;
/* row → what runs along it: kind, item width, gap, speed in cells per second (negative goes left) */
const LANES = [
  { row: 11, kind: 'car', w: 1, g: 3, v: 1.6, hue: 190 },
  { row: 10, kind: 'truck', w: 2, g: 4, v: -1.3, hue: 30 },
  { row: 9, kind: 'car', w: 1, g: 2.5, v: 2.4, hue: 330 },
  { row: 8, kind: 'car', w: 1, g: 3, v: -1.9, hue: 55 },
  { row: 7, kind: 'truck', w: 3, g: 4, v: 1.0, hue: 265 },
  { row: 5, kind: 'turtle', w: 2, g: 2, v: -1.0 },
  { row: 4, kind: 'log', w: 3, g: 3, v: 1.3 },
  { row: 3, kind: 'log', w: 5, g: 3, v: 0.9 },
  { row: 2, kind: 'turtle', w: 3, g: 2, v: -1.4 },
  { row: 1, kind: 'log', w: 4, g: 3, v: 1.1 },
];
const DIVE = 7;                         /* a turtle's cycle in seconds: afloat, sinking, under */

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',                    /* ready | play | dying | over */
      paused: false,
      score: 0, lives: 3, level: 1, time: 0,
      lanes: [], homes: HOMES.map(() => false),
      row: START_ROW, fx: (COLS - 1) / 2, face: 'up', best: START_ROW, left: TIME_LIMIT,
      hopT: 0, from: null, dieT: 0, cause: '', safe: false, lastDeath: null, parts: [],
    };
    const sf = surface(el, 'Road Hopper field', () => draw());
    let V = fitView(sf, VW, VH);

    function buildLanes() {
      const f = 1 + 0.14 * (S.level - 1);
      S.lanes = LANES.map(l => {
        const n = Math.ceil((COLS + 2 * l.w + 2) / (l.w + l.g));
        const P = n * (l.w + l.g);
        return {
          ...l, v: l.v * f, P,
          objs: Array.from({ length: n }, (_, i) => ({ x: ((i * (l.w + l.g) + l.row * 1.7) % P) - l.w, ph: (i * 2.3 + l.row) % DIVE })),
        };
      });
    }
    buildLanes();

    const laneOf = row => S.lanes.find(l => l.row === row) || null;
    const submerged = (l, o) => l.kind === 'turtle' && ((S.time + o.ph) % DIVE) > DIVE - 1.6;
    const sinking = (l, o) => l.kind === 'turtle' && ((S.time + o.ph) % DIVE) > DIVE - 2.6;

    function respawn() {
      S.row = START_ROW; S.fx = (COLS - 1) / 2; S.face = 'up'; S.best = START_ROW; S.left = TIME_LIMIT; S.from = null; S.hopT = 0;
    }
    function begin() { if (S.state === 'ready') S.state = 'play'; }

    /* ------------------------------ rules ------------------------------ */
    function hop(dx, dy) {
      if (S.state !== 'play' || S.paused) return;
      const nr = S.row + dy;
      if (nr < 0 || nr > START_ROW) return;
      let nx = S.fx + dx;
      if (!(nr >= 1 && nr <= 5)) nx = Math.round(nx);        /* on land you stay on the grid; on a log you go where it carries you */
      if (nx < -0.4 || nx > COLS - 0.6) return;
      S.from = { row: S.row, fx: S.fx }; S.hopT = HOP_SECS;
      S.row = nr; S.fx = nx;
      S.face = dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : 'right';
      snd.blip(380 + (START_ROW - S.row) * 20, 0.05, 'square', 0.6);
      if (dy < 0 && nr < S.best) { S.best = nr; S.score += 10; ctx.onScore(S.score); }
      if (nr === 0) arrive();
      else judge();
    }

    function arrive() {
      const fc = S.fx + 0.5;
      const h = HOMES.findIndex(c => Math.abs(fc - (c + 0.5)) < 0.75);
      if (h < 0 || S.homes[h]) { if (!S.safe) die(h < 0 ? 'wall' : 'taken'); else { S.row = 1; } return; }
      S.homes[h] = true;
      S.score += 50 + 5 * Math.ceil(S.left);
      snd.blip(660, 0.2, 'triangle', 0.9, 1100);
      burst(HOMES[h] + 0.5, 0.5, 120, 14);
      if (S.homes.every(Boolean)) {
        S.score += 500; S.level++; S.homes = HOMES.map(() => false); buildLanes();
        snd.blip(880, 0.4, 'square', 0.8, 1760);
      }
      ctx.onScore(S.score);
      respawn();
    }

    /* is the frog on something deadly or something safe, right now */
    function judge() {
      if (S.safe || S.state !== 'play') return;
      const l = laneOf(S.row);
      const a = S.fx + 0.18, b = S.fx + 0.82;
      if (S.row >= 7 && S.row <= 11) {
        if (l && l.objs.some(o => a < o.x + l.w && b > o.x)) die('car');
      } else if (S.row >= 1 && S.row <= 5) {
        const c = S.fx + 0.5;
        const on = l && l.objs.find(o => c > o.x + 0.05 && c < o.x + l.w - 0.05 && !submerged(l, o));
        if (!on) die('water');
      }
    }

    function die(cause) {
      if (S.state !== 'play') return;
      S.state = 'dying'; S.dieT = 0; S.cause = cause; S.lives--;
      S.lastDeath = { cause, row: S.row, fx: S.fx };
      burst(S.fx + 0.5, S.row + 0.5, cause === 'water' ? 205 : cause === 'time' ? 50 : 0, 16);
      snd.blip(cause === 'water' ? 260 : 180, 0.35, 'sawtooth', 0.9, 50);
    }
    function burst(x, y, hue, n) {
      if (reduced) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 3.5;
        S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.3, hue });
      }
    }

    function update(dt) {
      S.time += dt;
      for (const l of S.lanes) for (const o of l.objs) o.x = (((o.x + l.v * dt + l.w) % l.P) + l.P) % l.P - l.w;
      if (S.state === 'play') {
        if (S.hopT > 0) S.hopT -= dt;
        const l = laneOf(S.row);
        if (S.row >= 1 && S.row <= 5 && l) {
          /* standing on a log or turtle: it carries you */
          const c = S.fx + 0.5;
          const on = l.objs.find(o => c > o.x && c < o.x + l.w && !submerged(l, o));
          if (on) S.fx += l.v * dt;
          if (!S.safe && (S.fx < -0.45 || S.fx > COLS - 0.55)) die('water');
        }
        judge();
        S.left -= dt;
        if (S.left <= 0 && !S.safe && S.state === 'play') { S.left = 0; die('time'); }
        else if (S.left <= 0) S.left = TIME_LIMIT;
      } else if (S.state === 'dying') {
        S.dieT += dt;
        if (S.dieT >= DIE_SECS) {
          if (S.lives <= 0) {
            S.state = 'over';
            ctx.onEnd({ score: S.score, won: false, detail: `Round ${S.level} · ${S.homes.filter(Boolean).length} of ${HOMES.length} homes filled` });
          } else { respawn(); S.state = 'play'; }
        }
      }
      for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
      S.parts = S.parts.filter(p => p.life > 0);
    }
    const loop = looper(dt => {
      update(dt);
      draw();
      if (S.state === 'over' && !S.parts.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function frog(g, x, y, face, hopK, dead) {
      const cx = x + CELL / 2, cy = y + CELL / 2;
      const ang = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[face];
      g.save();
      g.translate(cx, cy); g.rotate(ang);
      const k = 1 + hopK * 0.2;
      g.scale(k, k);
      g.fillStyle = dead ? hsl(0, 70, 55) : hsl(110, 70, 50);
      g.beginPath(); g.ellipse(0, 1, 8, 10, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = g.fillStyle; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-6, 4); g.lineTo(-11, 9 - hopK * 4); g.moveTo(6, 4); g.lineTo(11, 9 - hopK * 4);
      g.moveTo(-6, -4); g.lineTo(-11, -6); g.moveTo(6, -4); g.lineTo(11, -6); g.stroke();
      g.fillStyle = '#eaffe0';
      g.beginPath(); g.arc(-4, -8, 3, 0, Math.PI * 2); g.arc(4, -8, 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#10200a';
      g.beginPath(); g.arc(-4, -9, 1.3, 0, Math.PI * 2); g.arc(4, -9, 1.3, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    function vehicle(g, l, o) {
      const x = o.x * CELL, y = l.row * CELL, w = l.w * CELL;
      g.fillStyle = hsl(l.hue, 80, 55);
      rr(g, x + 2, y + 6, w - 4, CELL - 12, 6); g.fill();
      g.fillStyle = 'rgba(10,14,30,.7)';
      const fwd = l.v > 0;
      if (l.kind === 'car') { rr(g, x + (fwd ? w * 0.5 : 5), y + 9, w * 0.4, CELL - 18, 3); g.fill(); }
      else { rr(g, x + (fwd ? w - 14 : 4), y + 9, 10, CELL - 18, 3); g.fill(); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + (fwd ? 6 : 18), y + 9, w - 28, CELL - 18); }
      g.fillStyle = '#fff6c8';
      g.fillRect(x + (fwd ? w - 5 : 2), y + 9, 3, 4); g.fillRect(x + (fwd ? w - 5 : 2), y + CELL - 13, 3, 4);
    }
    function platform(g, l, o) {
      const x = o.x * CELL, y = l.row * CELL, w = l.w * CELL;
      if (l.kind === 'log') {
        g.fillStyle = hsl(28, 55, 32);
        rr(g, x + 1, y + 6, w - 2, CELL - 12, 8); g.fill();
        g.fillStyle = hsl(28, 50, 44);
        rr(g, x + 4, y + 9, w - 8, 5, 2); g.fill();
        g.strokeStyle = hsl(28, 45, 22); g.lineWidth = 1.5;
        for (let i = 1; i < l.w; i++) { g.beginPath(); g.arc(x + i * CELL, y + CELL / 2, 4, 0, Math.PI * 2); g.stroke(); }
      } else {
        const sub = submerged(l, o), sk = sinking(l, o);
        for (let i = 0; i < l.w; i++) {
          const cx = x + i * CELL + CELL / 2, cy = y + CELL / 2;
          g.fillStyle = sub ? hsl(200, 60, 28, 0.55) : sk && Math.floor(S.time * 6) % 2 ? hsl(150, 40, 32) : hsl(150, 55, 40);
          g.beginPath(); g.ellipse(cx, cy, 12, 11, 0, 0, Math.PI * 2); g.fill();
          if (!sub) {
            g.strokeStyle = hsl(150, 50, 25); g.lineWidth = 1.2;
            g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.moveTo(cx - 12, cy); g.lineTo(cx + 12, cy); g.stroke();
            g.fillStyle = hsl(150, 45, 48);
            g.beginPath(); g.arc(cx + (l.v > 0 ? 12 : -12), cy, 3.4, 0, Math.PI * 2); g.fill();
          }
        }
      }
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 6);
      g.fillStyle = '#04060a';
      g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, V.oy);
      g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();

      /* terrain */
      g.fillStyle = hsl(205, 60, 22); g.fillRect(0, CELL, VW, CELL * 5);
      g.strokeStyle = hsl(205, 70, 36, 0.5); g.lineWidth = 1.2;
      for (let r = 1; r <= 5; r++) for (let i = 0; i < 9; i++) {
        const x = ((i * 53 + r * 17 + (reduced ? 0 : S.time * 12 * (r % 2 ? 1 : -1))) % (VW + 20) + VW + 20) % (VW + 20) - 10;
        g.beginPath(); g.moveTo(x, r * CELL + 10 + (i % 3) * 7); g.quadraticCurveTo(x + 6, r * CELL + 6 + (i % 3) * 7, x + 12, r * CELL + 10 + (i % 3) * 7); g.stroke();
      }
      g.fillStyle = '#16211a'; g.fillRect(0, 0, VW, CELL);
      g.fillStyle = hsl(120, 40, 24); g.fillRect(0, VERGE * CELL, VW, CELL); g.fillRect(0, START_ROW * CELL, VW, CELL);
      g.fillStyle = '#1b1f2a'; g.fillRect(0, 7 * CELL, VW, CELL * 5);
      g.fillStyle = 'rgba(255,255,255,.14)';
      for (let r = 8; r <= 11; r++) for (let x = 0; x < VW; x += 40) g.fillRect(x + 6, r * CELL - 1, 22, 2);
      /* homes */
      HOMES.forEach((c, i) => {
        g.fillStyle = hsl(205, 60, 18); rr(g, c * CELL - 6, 2, CELL + 12, CELL - 4, 8); g.fill();
        g.strokeStyle = hsl(120, 60, 45, 0.7); g.lineWidth = 1.5; rr(g, c * CELL - 6, 2, CELL + 12, CELL - 4, 8); g.stroke();
        if (S.homes[i]) frog(g, c * CELL, 0, 'down', 0, false);
      });

      for (const l of S.lanes) for (const o of l.objs) (l.kind === 'car' || l.kind === 'truck' ? vehicle : platform)(g, l, o);

      /* the frog */
      if (S.state !== 'over' && S.row > 0) {
        let fx = S.fx * CELL, fy = S.row * CELL, k = 0;
        if (S.hopT > 0 && S.from && !reduced) {
          const t = clamp(S.hopT / HOP_SECS, 0, 1);
          fx += (S.from.fx - S.fx) * CELL * t; fy += (S.from.row - S.row) * CELL * t; k = Math.sin((1 - t) * Math.PI);
        }
        const dead = S.state === 'dying';
        if (!dead || reduced || Math.floor(S.dieT * 10) % 2 === 0) frog(g, fx, fy, S.face, k, dead);
      }
      for (const p of S.parts) { g.fillStyle = hsl(p.hue, 100, 65, clamp(p.life * 2.5, 0, 1)); g.fillRect(p.x * CELL - 2, p.y * CELL - 2, 4, 4); }

      /* the bar below the field */
      const by = ROWS * CELL;
      g.fillStyle = '#0a0d12'; g.fillRect(0, by, VW, 30);
      const frac = clamp(S.left / TIME_LIMIT, 0, 1);
      g.fillStyle = 'rgba(255,255,255,.1)'; rr(g, 96, by + 10, 214, 10, 5); g.fill();
      g.fillStyle = frac < 0.25 ? hsl(0, 85, 58) : hsl(110, 70, 50); rr(g, 96, by + 10, Math.max(8, 214 * frac), 10, 5); g.fill();
      g.font = `600 12px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = hsl(205, 30, 78);
      g.fillText(`ROUND ${S.level}`, 10, by + 15);
      g.textAlign = 'right';
      for (let i = 0; i < Math.max(0, S.lives); i++) frog(g, VW - 12 - (i + 1) * 26 + 4, by - 1, 'up', 0, false);
      g.restore();

      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Swipe to start' : 'Press an arrow key to start', 'Cross the road and the river, fill all five homes', 110, sf.h * 0.52);
    }

    /* ------------------------------ input ------------------------------ */
    const DIRS = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const d = DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!d) return;
      e.preventDefault();
      if (S.paused || e.repeat) return;
      snd.wake(); begin();
      hop(d[0], d[1]);
      if (!loop.on && S.state !== 'over') draw();
    };
    let sw = null;
    const onDown = e => {
      sw = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      snd.wake();
    };
    const onMove = e => {
      if (!sw || e.pointerId !== sw.id || sw.moved) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (Math.hypot(dx, dy) < 22) return;
      sw.moved = true; begin();
      if (Math.abs(dx) > Math.abs(dy)) hop(Math.sign(dx), 0); else hop(0, Math.sign(dy));
    };
    const onUp = e => {
      if (sw && e.pointerId === sw.id && !sw.moved) { begin(); hop(0, -1); }
      sw = null;
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    ctx.onScore(0);
    draw();
    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        state: S.state, paused: S.paused, score: S.score, lives: S.lives, level: S.level, time: S.time,
        row: S.row, x: S.fx, left: S.left, homes: S.homes.slice(), homeCols: HOMES.slice(), lastDeath: S.lastDeath, safe: S.safe,
        lanes: S.lanes.map(l => ({ row: l.row, kind: l.kind, v: l.v, w: l.w, objs: l.objs.map(o => ({ x: o.x, under: submerged(l, o) })) })),
      }),
      /* test hook — nothing in the game calls it:
         step(seconds) · safe(bool: nothing hurts the frog) · place({ row, x }) */
      hook(cmd, arg) {
        if (cmd === 'step') { for (let t = 0; t < arg; t += 1 / 60) update(1 / 60); }
        else if (cmd === 'safe') S.safe = !!arg;
        else if (cmd === 'place') { S.row = arg.row; S.fx = arg.x; S.best = Math.min(S.best, arg.row); }
        draw();
        return true;
      },
    };
  },
};
