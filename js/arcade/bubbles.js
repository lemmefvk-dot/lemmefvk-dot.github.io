/* ============================================================
   arcade/bubbles.js — Bubble Pop for Static Arcade.

   A packed ceiling of coloured bubbles hangs over your launcher.
   Aim, fire, and the bubble sticks where it lands (bouncing once
   or twice off the side walls on the way, if you like).

   · Three or more of one colour touching each other pop.
   · Anything left hanging with nothing holding it to the ceiling
     falls, and is worth more than a plain pop.
   · The whole ceiling drops one row every few shots, whether or
     not you popped anything; the pips beside the launcher count
     down to it.
   · Clear everything for a fresh, fuller board with more colours.
     The round ends when a bubble reaches the red line.
   · Every colour also has its own mark inside, so they can be
     told apart without relying on colour.

   Keys: ← → aim, Space / ↑ fire, C / X / ↓ swap with the next
   bubble. Mouse: move to aim, click to fire. Touch: drag to aim,
   lift your finger to fire.
   ============================================================ */
import { clamp, hsl, FONT, coarse, rng, randomSeed, fitView, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';

const R = 16, COLS = 11, ROWS_MAX = 16, LIMIT = 12;
const S3 = R * Math.sqrt(3);
const W = COLS * 2 * R, CY = R + LIMIT * S3 + 46, H = CY + 40;
const CX = W / 2;
const HUES = [352, 38, 130, 195, 265, 312];
const MIN_A = 12, MAX_A = 168;
const SPEED = 640;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',                      /* ready | play | dying | over */
      paused: false,
      rand: rng(randomSeed()),
      grid: [], par: 0,
      cur: 0, next: 1, angle: 90, turn: 0, shot: null,
      score: 0, level: 1, shots: 0, since: 0, drops: 0, popped: 0, fell: 0,
      falling: [], parts: [], pops: [], dropAnim: 0, dieT: 0, time: 0, pointer: null,
    };
    const sf = surface(el, 'Bubble Pop field', () => draw());
    let V = fitView(sf, W, H);

    const dropEvery = () => Math.max(4, 7 - Math.floor((S.level - 1) / 2));
    const off = r => (r + S.par) % 2 === 1;
    const colsIn = r => (off(r) ? COLS - 1 : COLS);
    const px = (r, c) => R * (2 * c + 1) + (off(r) ? R : 0);
    const py = r => R + r * S3;
    const nbrs = (r, c) => {
      const o = off(r) ? 1 : 0;
      return [[r, c - 1], [r, c + 1], [r - 1, c - 1 + o], [r - 1, c + o], [r + 1, c - 1 + o], [r + 1, c + o]]
        .filter(([a, b]) => a >= 0 && a < ROWS_MAX && b >= 0 && b < colsIn(a));
    };
    const nColors = () => Math.min(HUES.length, 3 + S.level);

    function fill(rows) {
      S.grid = Array.from({ length: ROWS_MAX }, () => Array(COLS).fill(-1));
      const n = nColors();
      for (let r = 0; r < rows; r++) for (let c = 0; c < colsIn(r); c++) S.grid[r][c] = Math.floor(S.rand() * n);
    }
    const present = () => {
      const s = new Set();
      for (const row of S.grid) for (const v of row) if (v >= 0) s.add(v);
      return [...s];
    };
    function pick() {
      const p = present();
      return p.length ? p[Math.floor(S.rand() * p.length)] : Math.floor(S.rand() * nColors());
    }
    function deal() { S.cur = S.next; S.next = pick(); }
    fill(5 + Math.min(2, S.level - 1));
    S.cur = pick(); S.next = pick();
    ctx.onScore(0);

    function begin() { if (S.state === 'ready') S.state = 'play'; }

    /* ------------------------------ rules ------------------------------ */
    /* where a shot fired at `angle` ends up: the path it takes, and its resting point */
    function fly(shot, dt, onPath) {
      let left = SPEED * dt;
      while (left > 0 && shot) {
        const st = Math.min(3, left); left -= st;
        shot.x += shot.vx * st / SPEED; shot.y += shot.vy * st / SPEED;
        if (shot.x < R) { shot.x = R; shot.vx = -shot.vx; onPath?.(shot, true); }
        else if (shot.x > W - R) { shot.x = W - R; shot.vx = -shot.vx; onPath?.(shot, true); }
        onPath?.(shot, false);
        if (shot.y <= R || touching(shot.x, shot.y)) return true;
      }
      return false;
    }
    function touching(x, y) {
      for (let r = 0; r < ROWS_MAX; r++) {
        if (Math.abs(py(r) - y) > 2 * R) continue;
        for (let c = 0; c < colsIn(r); c++) if (S.grid[r][c] >= 0 && Math.hypot(px(r, c) - x, py(r) - y) < 1.8 * R) return true;
      }
      return false;
    }
    function snapTo(x, y) {
      let best = null, bd = 1e9;
      for (let r = 0; r < ROWS_MAX; r++) for (let c = 0; c < colsIn(r); c++) {
        if (S.grid[r][c] >= 0) continue;
        if (r > 0 && !nbrs(r, c).some(([a, b]) => S.grid[a][b] >= 0)) continue;
        const d = Math.hypot(px(r, c) - x, py(r) - y);
        if (d < bd) { bd = d; best = [r, c]; }
      }
      return best;
    }

    function shoot() {
      if (S.state !== 'play' || S.paused || S.shot) return;
      const a = S.angle * Math.PI / 180;
      S.shot = { x: CX, y: CY, vx: Math.cos(a) * SPEED, vy: -Math.sin(a) * SPEED, color: S.cur };
      deal();
      snd.blip(520, 0.06, 'triangle', 0.7, 880);
    }

    function land() {
      const sh = S.shot; S.shot = null;
      const cell = snapTo(sh.x, sh.y);
      if (!cell) return;
      const [r, c] = cell;
      S.grid[r][c] = sh.color;
      S.shots++; S.since++;
      /* the group */
      const seen = new Set([r + ',' + c]), stack = [[r, c]];
      while (stack.length) {
        const [a, b] = stack.pop();
        for (const [q, w] of nbrs(a, b)) if (S.grid[q][w] === sh.color && !seen.has(q + ',' + w)) { seen.add(q + ',' + w); stack.push([q, w]); }
      }
      if (seen.size >= 3) {
        for (const k of seen) { const [a, b] = k.split(',').map(Number); pop(a, b, sh.color); S.grid[a][b] = -1; }
        S.popped += seen.size;
        addScore(seen.size * 10 + (seen.size - 3) * 5, px(r, c), py(r), HUES[sh.color]);
        snd.blip(660 + seen.size * 40, 0.12, 'square', 0.8, 1100);
        dropLoose();
      } else snd.blip(200, 0.05, 'square', 0.6);
      if (S.since >= dropEvery()) ceiling();
      checkEnd();
    }
    function pop(r, c, color) {
      if (reduced) return;
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 90;
        S.parts.push({ x: px(r, c), y: py(r), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.3, hue: HUES[color] });
      }
    }
    function dropLoose() {
      const hold = new Set(), stack = [];
      for (let c = 0; c < colsIn(0); c++) if (S.grid[0][c] >= 0) { hold.add('0,' + c); stack.push([0, c]); }
      while (stack.length) {
        const [a, b] = stack.pop();
        for (const [q, w] of nbrs(a, b)) if (S.grid[q][w] >= 0 && !hold.has(q + ',' + w)) { hold.add(q + ',' + w); stack.push([q, w]); }
      }
      let n = 0, x = 0, y = 0;
      for (let r = 0; r < ROWS_MAX; r++) for (let c = 0; c < colsIn(r); c++) {
        if (S.grid[r][c] >= 0 && !hold.has(r + ',' + c)) {
          S.falling.push({ x: px(r, c), y: py(r), vy: -40 - Math.random() * 60, vx: (Math.random() - 0.5) * 60, color: S.grid[r][c] });
          S.grid[r][c] = -1; n++; x += px(r, c); y += py(r);
        }
      }
      if (n) {
        S.fell += n;
        addScore(n * 20, x / n, y / n, 50);
        snd.blip(300, 0.3, 'triangle', 0.8, 120);
      }
    }
    function ceiling() {
      S.since = 0; S.drops++;
      S.par ^= 1;
      S.grid.unshift(Array(COLS).fill(-1));
      S.grid.pop();
      const n = nColors();
      const pool = present();
      for (let c = 0; c < colsIn(0); c++) S.grid[0][c] = pool.length && S.rand() < 0.85 ? pool[Math.floor(S.rand() * pool.length)] : Math.floor(S.rand() * n);
      S.dropAnim = S3;
      snd.blip(110, 0.2, 'sawtooth', 0.8, 70);
    }
    function addScore(n, x, y, hue) { S.score += n; ctx.onScore(S.score); S.pops.push({ x, y, n, t: 0.8, hue }); }

    function checkEnd() {
      for (let r = LIMIT; r < ROWS_MAX; r++) if (S.grid[r].some(v => v >= 0)) { S.state = 'dying'; S.dieT = 0; snd.blip(200, 0.4, 'sawtooth', 1, 50); return; }
      if (!present().length) {                                   /* a clean sweep */
        addScore(500, CX, CY - 120, 50);
        S.level++; S.par = 0; S.since = 0;
        fill(5 + Math.min(3, S.level - 1));
        S.cur = pick(); S.next = pick();
        snd.blip(880, 0.4, 'square', 0.8, 1760);
      }
    }

    function update(dt) {
      S.time += dt;
      if (S.state === 'play' && !S.paused) {
        if (S.turn) S.angle = clamp(S.angle - S.turn * 95 * dt, MIN_A, MAX_A);
        if (S.shot && fly(S.shot, dt)) land();
      } else if (S.state === 'dying') {
        S.dieT += dt;
        if (S.dieT >= 1) {
          S.state = 'over';
          ctx.onEnd({ score: S.score, won: false, detail: `${S.popped} popped · ${S.fell} dropped` });
        }
      }
      if (S.dropAnim > 0) S.dropAnim = Math.max(0, S.dropAnim - 150 * dt);
      for (const f of S.falling) { f.vy += 700 * dt; f.y += f.vy * dt; f.x += f.vx * dt; }
      S.falling = S.falling.filter(f => f.y < H + R);
      for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      S.parts = S.parts.filter(p => p.life > 0);
      for (const q of S.pops) q.t -= dt;
      S.pops = S.pops.filter(q => q.t > 0);
    }
    const loop = looper(dt => {
      update(dt);
      draw();
      if (S.state === 'over' && !S.parts.length && !S.falling.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function bubble(g, x, y, color, r = R, a = 1) {
      const h = HUES[color];
      const grd = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      grd.addColorStop(0, hsl(h, 95, 78, a));
      grd.addColorStop(1, hsl(h, 80, 42, a));
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r - 0.8, 0, Math.PI * 2); g.fill();
      /* the colour's own mark */
      g.strokeStyle = `rgba(255,255,255,${0.8 * a})`; g.fillStyle = g.strokeStyle; g.lineWidth = r * 0.12;
      const m = r * 0.36;
      g.beginPath();
      if (color === 0) g.arc(x, y, m * 0.55, 0, Math.PI * 2);                       /* dot */
      else if (color === 1) { g.arc(x, y, m, 0, Math.PI * 2); }                      /* ring */
      else if (color === 2) { g.moveTo(x - m, y); g.lineTo(x + m, y); g.moveTo(x, y - m); g.lineTo(x, y + m); }   /* plus */
      else if (color === 3) { g.moveTo(x - m, y - m); g.lineTo(x + m, y + m); g.moveTo(x + m, y - m); g.lineTo(x - m, y + m); }  /* cross */
      else if (color === 4) { g.moveTo(x, y - m); g.lineTo(x + m, y + m * 0.8); g.lineTo(x - m, y + m * 0.8); g.closePath(); }   /* triangle */
      else g.rect(x - m * 0.8, y - m * 0.8, m * 1.6, m * 1.6);                      /* square */
      if (color === 0) g.fill(); else g.stroke();
      g.fillStyle = `rgba(255,255,255,${0.5 * a})`;
      g.beginPath(); g.arc(x - r * 0.38, y - r * 0.4, r * 0.16, 0, Math.PI * 2); g.fill();
    }
    function guide(g) {
      const a = S.angle * Math.PI / 180;
      const sh = { x: CX, y: CY, vx: Math.cos(a) * SPEED, vy: -Math.sin(a) * SPEED };
      const pts = [];
      let n = 0;
      fly(sh, 2, (s, bounced) => { if (bounced) pts.push([s.x, s.y, 1]); else if (n++ % 4 === 0) pts.push([s.x, s.y, 0]); });
      g.fillStyle = hsl(HUES[S.cur], 90, 75, 0.55);
      pts.slice(2).forEach(([x, y, b]) => { if (!b) { g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); } });
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      V = fitView(sf, W, H, 6);
      g.fillStyle = '#05060d';
      g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, V.oy);
      g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, W, H); g.clip();
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0d0a24'); bg.addColorStop(1, '#0a1224');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);

      /* the ceiling, with pips counting down to the next drop */
      g.fillStyle = hsl(265, 40, 30); g.fillRect(0, 0, W, 4);
      const left = dropEvery() - S.since;
      for (let i = 0; i < dropEvery(); i++) {
        g.fillStyle = i < left ? hsl(265, 80, 70) : 'rgba(255,255,255,.12)';
        g.beginPath(); g.arc(W - 16 - i * 12, CY + 24, 3.4, 0, Math.PI * 2); g.fill();
      }
      /* the red line */
      g.strokeStyle = hsl(0, 85, 55, 0.55); g.lineWidth = 1.5; g.setLineDash([6, 5]);
      g.beginPath(); g.moveTo(0, py(LIMIT) - R); g.lineTo(W, py(LIMIT) - R); g.stroke(); g.setLineDash([]);

      const dy = -S.dropAnim;
      for (let r = 0; r < ROWS_MAX; r++) for (let c = 0; c < colsIn(r); c++) if (S.grid[r][c] >= 0) bubble(g, px(r, c), py(r) + dy, S.grid[r][c]);
      for (const f of S.falling) bubble(g, f.x, f.y, f.color);
      if (S.state === 'play' && !S.shot) guide(g);
      if (S.shot) bubble(g, S.shot.x, S.shot.y, S.shot.color);

      /* the launcher */
      const a = S.angle * Math.PI / 180;
      g.save();
      g.translate(CX, CY); g.rotate(Math.PI / 2 - a);
      g.fillStyle = hsl(265, 30, 38); rr(g, -7, -34, 14, 34, 5); g.fill();
      g.fillStyle = hsl(265, 40, 60); rr(g, -4, -34, 8, 6, 3); g.fill();
      g.restore();
      g.fillStyle = hsl(265, 30, 26); g.beginPath(); g.arc(CX, CY + 6, 20, Math.PI, 0); g.fill();
      if (!S.shot) bubble(g, CX, CY, S.cur);
      bubble(g, CX - 64, CY + 14, S.next, 11);
      g.font = `600 10px ${FONT}`; g.textAlign = 'center'; g.fillStyle = hsl(265, 30, 70);
      g.fillText('NEXT', CX - 64, CY + 36);

      for (const p of S.parts) { g.fillStyle = hsl(p.hue, 100, 70, clamp(p.life * 2.5, 0, 1)); g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
      g.font = `700 12px ${FONT}`;
      for (const q of S.pops) { g.fillStyle = hsl(q.hue, 100, 82, clamp(q.t * 2, 0, 1)); g.fillText(`+${q.n}`, q.x, q.y - (0.8 - q.t) * 30); }
      g.textAlign = 'left'; g.fillStyle = hsl(265, 30, 72); g.font = `600 11px ${FONT}`;
      g.fillText(`LEVEL ${S.level}`, 8, CY + 24);
      g.restore();

      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Drag to aim, lift to fire' : 'Aim with ← → or the mouse, fire with Space', 'Match three or more · the ceiling drops every few shots', 265, sf.h * 0.42);
    }

    /* ------------------------------ input ------------------------------ */
    const held = new Set();
    const setTurn = () => { S.turn = (held.has('l') ? -1 : 0) + (held.has('r') ? 1 : 0); };
    const KEY = { ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r', ' ': 'f', ArrowUp: 'f', w: 'f', c: 's', x: 's', ArrowDown: 's', Shift: 's' };
    const keyOf = e => KEY[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    const swap = () => { if (S.state === 'play' && !S.paused) { [S.cur, S.next] = [S.next, S.cur]; snd.blip(500, 0.04, 'triangle', 0.5); } };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const k = keyOf(e);
      if (!k) return;
      e.preventDefault();
      if (S.paused) return;
      snd.wake(); begin();
      if (k === 'f') { if (!e.repeat) shoot(); }
      else if (k === 's') { if (!e.repeat) swap(); }
      else { held.add(k); setTurn(); }
    };
    const onKeyUp = e => { const k = keyOf(e); if (k === 'l' || k === 'r') { held.delete(k); setTurn(); } };
    const releaseAll = () => { held.clear(); setTurn(); };
    const aimAt = e => {
      const r = sf.cv.getBoundingClientRect();
      const x = (e.clientX - r.left - V.ox) / V.s, y = (e.clientY - r.top - V.oy) / V.s;
      S.angle = clamp(Math.atan2(CY - y, x - CX) * 180 / Math.PI, MIN_A, MAX_A);
      return { x, y };
    };
    let down = null;
    const onDown = e => {
      if (S.paused) return;
      snd.wake(); begin();
      down = e.pointerId; aimAt(e);
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    };
    const onMove = e => { if (!S.paused && (down === e.pointerId || e.pointerType === 'mouse')) aimAt(e); };
    const onUp = e => {
      if (down !== e.pointerId) return;
      down = null;
      if (e.type === 'pointerup' && !S.paused) { aimAt(e); shoot(); }
      if (!loop.on && S.state !== 'over') draw();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    draw();
    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', releaseAll);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; releaseAll(); loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        state: S.state, paused: S.paused, score: S.score, level: S.level, time: S.time,
        grid: S.grid.slice(0, LIMIT + 1).map((row, r) => row.slice(0, colsIn(r)).map(v => (v < 0 ? '.' : String(v))).join('')),
        cur: S.cur, next: S.next, angle: S.angle, flying: !!S.shot, shots: S.shots, since: S.since, dropEvery: dropEvery(),
        drops: S.drops, popped: S.popped, fell: S.fell, falling: S.falling.length,
      }),
      /* test hook — nothing in the game calls it:
         step(seconds) · grid(rows of '.'/digits, top first) · queue([cur, next]) · angle(deg) · since(n shots since a drop) */
      hook(cmd, arg) {
        if (cmd === 'step') { for (let t = 0; t < arg; t += 1 / 60) update(1 / 60); }
        else if (cmd === 'grid') {
          S.par = 0; S.grid = Array.from({ length: ROWS_MAX }, () => Array(COLS).fill(-1));
          arg.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.' && c < colsIn(r)) S.grid[r][c] = Number(ch); }));
        } else if (cmd === 'queue') { S.cur = arg[0]; S.next = arg[1] ?? arg[0]; }
        else if (cmd === 'angle') S.angle = clamp(arg, MIN_A, MAX_A);
        else if (cmd === 'since') S.since = arg;
        draw();
        return true;
      },
    };
  },
};
