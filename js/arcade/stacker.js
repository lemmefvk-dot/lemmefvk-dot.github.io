/* ============================================================
   arcade/stacker.js — Stacker for Static Arcade.

   Falling blocks on a 10 × 20 well. Seven shapes come out of a
   7-bag (every shape once, shuffled, then again), so a long wait
   for a particular piece never happens. A faint ghost shows where
   the piece will land.

   · Rotation tries a few nudges (wall kicks) so a turn next to a
     wall or the stack still works when there is room.
   · Hold swaps the falling piece with the held one, once per piece.
   · Score: 100 / 300 / 500 / 800 × level for 1–4 lines, 1 per
     soft-dropped row, 2 per hard-dropped row. A level every 10
     lines; gravity speeds up with the level.
   · The round ends when a new piece has no room to appear, or a
     piece locks above the well.

   Keys: ← → / A D move, ↓ / S soft drop, ↑ / W / X turn clockwise,
   Z turn the other way, Space hard drop, C / Shift hold. Touch:
   drag sideways to move, drag down to soft drop, tap to turn, tap
   the hold box to hold, flick down to hard drop.
   ============================================================ */
import { clamp, hsl, FONT, coarse, rng, randomSeed, fitView, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';

const COLS = 10, ROWS = 20, CELL = 24;
const VW = 440, VH = 480, BX = 100, BY = 0;       /* the well sits between the hold box and the queue */
const DIE_SECS = 0.7, LOCK_SECS = 0.5, MAX_RESETS = 12;

const BASE = {
  I: { m: ['....', '####', '....', '....'], hue: 190 },
  O: { m: ['##', '##'], hue: 50 },
  T: { m: ['.#.', '###', '...'], hue: 285 },
  S: { m: ['.##', '##.', '...'], hue: 120 },
  Z: { m: ['##.', '.##', '...'], hue: 0 },
  J: { m: ['#..', '###', '...'], hue: 225 },
  L: { m: ['..#', '###', '...'], hue: 30 },
};
const TYPES = Object.keys(BASE);
/* SHAPES[type][rotation] = [[row, col], …] inside the piece's own box */
const SHAPES = {};
for (const t of TYPES) {
  let m = BASE[t].m.map(r => [...r].map(c => c === '#'));
  const n = m.length;
  SHAPES[t] = [];
  for (let r = 0; r < 4; r++) {
    const cells = [];
    m.forEach((row, i) => row.forEach((on, j) => { if (on) cells.push([i, j]); }));
    SHAPES[t].push(cells);
    const prev = m;
    m = prev.map((row, i) => row.map((_, j) => prev[n - 1 - j][i]));         /* clockwise */
  }
}
/* nudges tried when a turn does not fit where it is: sideways, then up */
const KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1]];
const LINE_POINTS = [0, 100, 300, 500, 800];

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',                    /* ready | play | dying | over */
      paused: false,
      board: [], cur: null, hold: null, canHold: false, queue: [],
      score: 0, lines: 0, level: 1, pieces: 0,
      acc: 0, lockT: 0, resets: 0, dieT: 0, time: 0,
      rand: rng(randomSeed()), parts: [], flash: [],
    };
    const sf = surface(el, 'Stacker well', () => draw());
    let V = fitView(sf, VW, VH);

    const clearBoard = () => { S.board = Array.from({ length: ROWS }, () => Array(COLS).fill('')); };
    clearBoard();

    /* ------------------------------ rules ------------------------------ */
    function refill() {
      while (S.queue.length < 7) {
        const bag = TYPES.slice();
        for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(S.rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
        S.queue.push(...bag);
      }
    }
    const fits = (t, rot, x, y) => SHAPES[t][rot].every(([r, c]) => {
      const cx = x + c, cy = y + r;
      return cx >= 0 && cx < COLS && cy < ROWS && (cy < 0 || !S.board[cy][cx]);
    });
    const cellsOf = p => SHAPES[p.t][p.rot].map(([r, c]) => [p.y + r, p.x + c]);
    const ghostY = () => { let y = S.cur.y; while (fits(S.cur.t, S.cur.rot, S.cur.x, y + 1)) y++; return y; };
    const interval = () => Math.max(0.07, 0.8 * Math.pow(0.82, S.level - 1));

    function spawn(t) {
      refill();
      t = t || S.queue.shift();
      S.cur = { t, rot: 0, x: Math.floor((COLS - BASE[t].m.length) / 2), y: t === 'I' ? -1 : 0 };
      S.canHold = true; S.acc = 0; S.lockT = 0; S.resets = 0;
      if (!fits(t, 0, S.cur.x, S.cur.y)) die();
    }
    function begin() {
      if (S.state !== 'ready') return;
      S.state = 'play';
      spawn();
    }
    function die() {
      S.state = 'dying'; S.dieT = 0;
      snd.blip(200, 0.35, 'sawtooth', 0.9, 50);
    }

    const touched = () => {                       /* a move or turn while resting buys a little more time */
      if (S.lockT > 0 && S.resets < MAX_RESETS) { S.lockT = 0; S.resets++; }
    };
    function move(dx) {
      if (!S.cur || S.state !== 'play' || S.paused) return false;
      if (!fits(S.cur.t, S.cur.rot, S.cur.x + dx, S.cur.y)) return false;
      S.cur.x += dx; touched();
      snd.blip(300, 0.025, 'square', 0.4);
      return true;
    }
    function rotate(dir) {
      if (!S.cur || S.state !== 'play' || S.paused || S.cur.t === 'O') return false;
      const nr = (S.cur.rot + dir + 4) % 4;
      for (const [dx, dy] of KICKS) {
        if (fits(S.cur.t, nr, S.cur.x + dx, S.cur.y + dy)) {
          S.cur.rot = nr; S.cur.x += dx; S.cur.y += dy; touched();
          snd.blip(420, 0.04, 'triangle', 0.6);
          return true;
        }
      }
      return false;
    }
    function soft() {
      if (!S.cur || S.state !== 'play' || S.paused) return;
      if (fits(S.cur.t, S.cur.rot, S.cur.x, S.cur.y + 1)) { S.cur.y++; S.score += 1; S.acc = 0; ctx.onScore(S.score); }
    }
    function hard() {
      if (!S.cur || S.state !== 'play' || S.paused) return;
      const gy = ghostY();
      S.score += 2 * (gy - S.cur.y);
      S.cur.y = gy;
      snd.blip(140, 0.08, 'square', 0.9, 70);
      lock();
    }
    function swap() {
      if (!S.cur || S.state !== 'play' || S.paused || !S.canHold) return;
      const was = S.hold;
      S.hold = S.cur.t;
      spawn(was || undefined);
      S.canHold = false;
      snd.blip(520, 0.05, 'triangle', 0.6);
    }
    function lock() {
      const cells = cellsOf(S.cur);
      const above = cells.some(([r]) => r < 0);
      for (const [r, c] of cells) if (r >= 0) S.board[r][c] = S.cur.t;
      S.pieces++;
      const full = [];
      S.board.forEach((row, i) => { if (row.every(Boolean)) full.push(i); });
      if (full.length) {
        for (const i of full) S.board[i].forEach((t, c) => burst(c, i, BASE[t].hue, 3));
        S.board = S.board.filter((_, i) => !full.includes(i));
        while (S.board.length < ROWS) S.board.unshift(Array(COLS).fill(''));
        S.lines += full.length;
        S.score += LINE_POINTS[full.length] * S.level;
        const lv = 1 + Math.floor(S.lines / 10);
        if (lv !== S.level) { S.level = lv; snd.blip(880, 0.15, 'square', 0.8, 1320); }
        snd.blip(660 + full.length * 120, 0.12, 'square', 0.9, 990);
        S.flash.push({ t: 0.5 });
      }
      ctx.onScore(S.score);
      S.cur = null;
      if (above) { die(); return; }
      spawn();
    }
    function burst(c, r, hue, n) {
      if (reduced) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5;
        S.parts.push({ x: c + 0.5, y: r + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 0.4 + Math.random() * 0.4, hue });
      }
    }

    /* ------------------------------ loop ------------------------------ */
    function update(dt) {
      S.time += dt;
      if (S.state === 'play' && S.cur) {
        if (fits(S.cur.t, S.cur.rot, S.cur.x, S.cur.y + 1)) {
          S.lockT = 0;
          S.acc += dt;
          const iv = interval();
          while (S.acc >= iv && fits(S.cur.t, S.cur.rot, S.cur.x, S.cur.y + 1)) { S.acc -= iv; S.cur.y++; }
        } else {
          S.lockT += dt;
          if (S.lockT >= LOCK_SECS) lock();
        }
      } else if (S.state === 'dying') {
        S.dieT += dt;
        if (S.dieT >= DIE_SECS) {
          S.state = 'over';
          ctx.onEnd({ score: S.score, won: false, detail: `${S.lines} ${S.lines === 1 ? 'line' : 'lines'} · level ${S.level}` });
        }
      }
      for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 12 * dt; p.life -= dt; }
      S.parts = S.parts.filter(p => p.life > 0);
      for (const f of S.flash) f.t -= dt;
      S.flash = S.flash.filter(f => f.t > 0);
    }
    const loop = looper(dt => {
      update(dt);
      draw();
      if (S.state === 'over' && !S.parts.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function block(g, x, y, s, hue, a = 1) {
      const grd = g.createLinearGradient(0, y, 0, y + s);
      grd.addColorStop(0, hsl(hue, 90, 66, a));
      grd.addColorStop(1, hsl(hue, 80, 40, a));
      g.fillStyle = grd;
      rr(g, x + 1, y + 1, s - 2, s - 2, s * 0.18); g.fill();
      g.fillStyle = `rgba(255,255,255,${0.28 * a})`;
      g.fillRect(x + s * 0.2, y + s * 0.14, s * 0.6, s * 0.12);
    }
    function mini(g, t, cx, cy, s) {
      const cells = SHAPES[t][0];
      const minR = Math.min(...cells.map(q => q[0])), minC = Math.min(...cells.map(q => q[1]));
      const cw = Math.max(...cells.map(q => q[1])) - minC + 1, ch = Math.max(...cells.map(q => q[0])) - minR + 1;
      for (const [r, c] of cells) block(g, cx - (cw * s) / 2 + (c - minC) * s, cy - (ch * s) / 2 + (r - minR) * s, s, BASE[t].hue);
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH);
      g.fillStyle = '#05060c';
      g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, V.oy);
      g.scale(V.s, V.s);

      /* the well */
      g.fillStyle = '#0a0d1c';
      rr(g, BX - 4, BY - 4, COLS * CELL + 8, ROWS * CELL + 8, 8); g.fill();
      g.strokeStyle = hsl(225, 70, 50, 0.7); g.lineWidth = 2;
      rr(g, BX - 4, BY - 4, COLS * CELL + 8, ROWS * CELL + 8, 8); g.stroke();
      g.fillStyle = 'rgba(160,180,255,.06)';
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if ((r + c) % 2) g.fillRect(BX + c * CELL, BY + r * CELL, CELL, CELL);

      const dead = S.state === 'dying' || S.state === 'over';
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const t = S.board[r][c];
        if (t) block(g, BX + c * CELL, BY + r * CELL, CELL, dead ? 220 : BASE[t].hue, dead ? 0.55 : 1);
      }
      if (S.cur && S.state === 'play') {
        const gy = ghostY();
        g.strokeStyle = hsl(BASE[S.cur.t].hue, 90, 70, 0.7); g.lineWidth = 1.6;
        for (const [r, c] of SHAPES[S.cur.t][S.cur.rot]) {
          rr(g, BX + (S.cur.x + c) * CELL + 2.5, BY + (gy + r) * CELL + 2.5, CELL - 5, CELL - 5, 4); g.stroke();
        }
        for (const [r, c] of cellsOf(S.cur)) if (r >= 0) block(g, BX + c * CELL, BY + r * CELL, CELL, BASE[S.cur.t].hue);
      }
      for (const p of S.parts) {
        g.fillStyle = hsl(p.hue, 100, 70, clamp(p.life * 2, 0, 1));
        g.fillRect(BX + p.x * CELL - 2, BY + p.y * CELL - 2, 4, 4);
      }
      if (!reduced) for (const f of S.flash) {
        g.fillStyle = `rgba(255,255,255,${clamp(f.t, 0, 0.5) * 0.4})`;
        g.fillRect(BX, BY, COLS * CELL, ROWS * CELL);
      }

      /* hold and queue */
      g.font = `700 12px ${FONT}`; g.textAlign = 'center'; g.fillStyle = hsl(225, 40, 75);
      g.fillText('HOLD', 50, 20);
      g.fillStyle = 'rgba(255,255,255,.05)'; rr(g, 8, 30, 84, 70, 10); g.fill();
      if (S.hold) mini(g, S.hold, 50, 65, 16);
      g.fillStyle = hsl(225, 40, 75);
      g.fillText('NEXT', 390, 20);
      g.fillStyle = 'rgba(255,255,255,.05)'; rr(g, 348, 30, 84, 210, 10); g.fill();
      S.queue.slice(0, 3).forEach((t, i) => mini(g, t, 390, 65 + i * 66, 14));
      g.textAlign = 'left';
      g.fillStyle = hsl(225, 30, 70); g.font = `600 12px ${FONT}`;
      g.fillText(`LEVEL ${S.level}`, 8, 340);
      g.fillText(`LINES ${S.lines}`, 8, 362);
      g.restore();

      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Tap or drag to start' : 'Press any move key to start', coarse() ? 'Drag to move, tap to turn, flick down to drop' : '← → move · ↑ turn · Space drop · C hold', 225, sf.h * 0.5);
    }

    /* ------------------------------ input ------------------------------ */
    const ACT = { ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r', ArrowDown: 'd', s: 'd', ArrowUp: 'cw', w: 'cw', x: 'cw', z: 'ccw', ' ': 'hard', c: 'hold', Shift: 'hold' };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const act = ACT[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!act) return;
      e.preventDefault();
      if (S.paused) return;
      snd.wake();
      if (S.state === 'ready') begin();
      if (act === 'l') move(-1); else if (act === 'r') move(1); else if (act === 'd') soft();
      else if (act === 'cw') rotate(1); else if (act === 'ccw') rotate(-1);
      else if (act === 'hard') { if (!e.repeat) hard(); } else if (act === 'hold') { if (!e.repeat) swap(); }
      if (!loop.on && S.state !== 'over') draw();
    };
    let tp = null;
    const toView = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - V.ox) / V.s, y: (e.clientY - r.top - V.oy) / V.s };
    };
    const onDown = e => {
      snd.wake();
      tp = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, v: toView(e) };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    };
    const onMove = e => {
      if (!tp || e.pointerId !== tp.id || S.paused) return;
      const px = CELL * V.s;
      const dx = e.clientX - tp.x, dy = e.clientY - tp.y;
      if (Math.abs(dx) >= px * 0.9 || dy >= px * 0.9) {
        if (S.state === 'ready') begin();
        if (Math.abs(dx) >= px * 0.9) { move(Math.sign(dx)); tp.x = e.clientX; }
        if (dy >= px * 0.9) { soft(); tp.y = e.clientY; }
        tp.moved = true;
      }
    };
    const onUp = e => {
      if (!tp || e.pointerId !== tp.id) return;
      const quick = performance.now() - tp.t < 260;
      const dy = e.clientY - tp.y;
      if (!S.paused) {
        if (!tp.moved) {
          if (S.state === 'ready') begin();
          else if (tp.v.x < BX - 8 && tp.v.y < 110) swap();
          else rotate(1);
        } else if (quick && dy > CELL * V.s * 2.5) hard();
      }
      tp = null;
      if (!loop.on && S.state !== 'over') draw();
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    refill();
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
        state: S.state, paused: S.paused, score: S.score, lines: S.lines, level: S.level, pieces: S.pieces,
        board: S.board.map(r => r.map(t => t || '.').join('')),
        piece: S.cur ? { t: S.cur.t, rot: S.cur.rot, x: S.cur.x, y: S.cur.y, cells: cellsOf(S.cur) } : null,
        ghost: S.cur ? SHAPES[S.cur.t][S.cur.rot].map(([r, c]) => [ghostY() + r, S.cur.x + c]) : null,
        hold: S.hold, canHold: S.canHold, next: S.queue.slice(0, 5), bag: S.queue.slice(), time: S.time,
      }),
      /* test hook — nothing in the game calls it:
         step(seconds) · seed(n) · board(rows bottom-aligned, '.' empty) · piece({t,rot,x,y}) · queue([types]) */
      hook(cmd, arg) {
        if (cmd === 'step') { for (let t = 0; t < arg; t += 1 / 60) update(1 / 60); }
        else if (cmd === 'seed') { S.rand = rng(arg); S.queue = []; refill(); }
        else if (cmd === 'board') {
          clearBoard();
          const rows = arg.slice(-ROWS);
          rows.forEach((row, i) => [...row].forEach((ch, c) => { if (ch !== '.') S.board[ROWS - rows.length + i][c] = TYPES.includes(ch) ? ch : 'T'; }));
        } else if (cmd === 'piece') { S.cur = { rot: 0, ...arg }; S.acc = 0; S.lockT = 0; }
        else if (cmd === 'queue') { S.queue.unshift(...arg); }
        draw();
        return true;
      },
    };
  },
};
