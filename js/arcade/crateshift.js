/* ============================================================
   arcade/crateshift.js — Crate Shift for Static Arcade.

   A warehouse floor: walk with the arrows (or WASD, or tap beside
   the walker) and push crates onto the goals. One crate at a time, and
   never a pull, so a crate pushed into a corner is stuck: think before
   you shove. Twelve warehouses, each with a par that a search over
   every position proved is the fewest moves possible (./crate-logic.js
   solves them all again in the suite). U takes a move back, R starts
   over, H shows the next move of a shortest way (and that level then
   sets no best).

   The page chrome and saved progress are ./levelkit.js. All art is
   drawn in code and nothing moves on its own, so reduced motion changes
   nothing.
   ============================================================ */
import { rr } from './kit.js';
import { levelGame } from './levelkit.js';
import { LEVELS } from './crate-levels.js';
import { parse, move, solved, solve, DIRS } from './crate-logic.js';

const HUE = 28;
const ARROW = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' };
const levels = LEVELS.map(l => ({ par: l.par, rows: l.rows, grid: parse(l.rows) }));

const geom = (L, w, h) => { const s = Math.max(8, Math.min((w - 16) / L.w, (h - 16) / L.h)); return { s, ox: (w - s * L.w) / 2, oy: (h - s * L.h) / 2 }; };

function draw(g, w, h, level, st, X) {
  const L = level.grid, G = geom(L, w, h), s = G.s;
  g.fillStyle = '#0e1420'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < L.w * L.h; i++) {
    const x = G.ox + (i % L.w) * s, y = G.oy + ((i / L.w) | 0) * s;
    if (L.walls[i]) {
      g.fillStyle = '#4a4f66'; g.fillRect(x, y, s, s);
      g.fillStyle = '#5b617b'; g.fillRect(x + 2, y + 2, s - 4, s / 2 - 3); g.fillRect(x + 2, y + s / 2 + 1, s / 2 - 3, s / 2 - 3); g.fillRect(x + s / 2 + 1, y + s / 2 + 1, s / 2 - 3, s / 2 - 3);
      continue;
    }
    g.fillStyle = (((i % L.w) + ((i / L.w) | 0)) & 1) ? '#202a3c' : '#1b2434'; g.fillRect(x, y, s, s);
    if (L.goal[i]) {
      g.strokeStyle = '#5ee08a'; g.lineWidth = Math.max(2, s * 0.07);
      g.beginPath(); g.moveTo(x + s / 2, y + s * 0.28); g.lineTo(x + s * 0.72, y + s / 2); g.lineTo(x + s / 2, y + s * 0.72); g.lineTo(x + s * 0.28, y + s / 2); g.closePath(); g.stroke();
    }
  }
  for (const c of st.c) {
    const x = G.ox + (c % L.w) * s, y = G.oy + ((c / L.w) | 0) * s, on = L.goal[c];
    g.fillStyle = on ? '#7be58f' : '#c98a4b'; rr(g, x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8, s * 0.1); g.fill();
    g.strokeStyle = on ? '#2c7a43' : '#7a4a1e'; g.lineWidth = Math.max(2, s * 0.06);
    g.strokeRect(x + s * 0.18, y + s * 0.18, s * 0.64, s * 0.64);
    g.beginPath(); g.moveTo(x + s * 0.18, y + s * 0.18); g.lineTo(x + s * 0.82, y + s * 0.82); g.moveTo(x + s * 0.82, y + s * 0.18); g.lineTo(x + s * 0.18, y + s * 0.82); g.stroke();
  }
  const px = G.ox + (st.p % L.w) * s + s / 2, py = G.oy + ((st.p / L.w) | 0) * s + s / 2;
  g.fillStyle = '#4aa8ff'; g.beginPath(); g.arc(px, py, s * 0.32, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(px - s * 0.1, py - s * 0.05, s * 0.07, 0, 7); g.arc(px + s * 0.1, py - s * 0.05, s * 0.07, 0, 7); g.fill();
  g.fillStyle = '#10223a'; g.beginPath(); g.arc(px - s * 0.1, py - s * 0.04, s * 0.03, 0, 7); g.arc(px + s * 0.1, py - s * 0.04, s * 0.03, 0, 7); g.fill();
  g.fillStyle = '#ffd23f'; g.fillRect(px - s * 0.3, py - s * 0.36, s * 0.6, s * 0.1);
  if (X.hint) {
    const [dx, dy] = DIRS[X.hint];
    g.strokeStyle = '#ffd23f'; g.fillStyle = '#ffd23f'; g.lineWidth = Math.max(3, s * 0.1); g.lineCap = 'round';
    const ex = px + dx * s * 0.8, ey = py + dy * s * 0.8;
    g.beginPath(); g.moveTo(px + dx * s * 0.35, py + dy * s * 0.35); g.lineTo(ex, ey); g.stroke();
    g.beginPath(); g.moveTo(ex + dx * s * 0.18, ey + dy * s * 0.18); g.lineTo(ex - dy * s * 0.16 - dx * s * 0.05, ey + dx * s * 0.16 - dy * s * 0.05); g.lineTo(ex + dy * s * 0.16 - dx * s * 0.05, ey - dx * s * 0.16 - dy * s * 0.05); g.closePath(); g.fill();
  }
  if (X.solved) { g.fillStyle = 'rgba(94,224,138,.14)'; g.fillRect(0, 0, w, h); }
}

export default levelGame({
  game: 'crateshift', title: 'Crate Shift', hue: HUE, levels,
  help: 'Arrows or WASD walk and push · U undo · R restart · H hint · PageUp / PageDown change level',
  init: lv => ({ p: lv.grid.start.p, c: lv.grid.start.c.slice() }),
  apply: (lv, st, d) => { const m = move(lv.grid, st, d); return m ? { p: m.p, c: m.c } : null; },
  solved: (lv, st) => solved(lv.grid, st),
  hint: (lv, st) => { const r = solve(lv.grid, st); return r && r.path ? r.path[0] : null; },
  hintText: a => `Hint: ${{ u: 'up', d: 'down', l: 'left', r: 'right' }[a]}.`,
  keyAction: code => ARROW[code],
  pointerAction(x, y, w, h, lv, st) {
    const L = lv.grid, G = geom(L, w, h);
    const cx = Math.floor((x - G.ox) / G.s), cy = Math.floor((y - G.oy) / G.s);
    const dx = cx - (st.p % L.w), dy = cy - ((st.p / L.w) | 0);
    if (!dx && !dy) return null;
    return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u');
  },
  draw,
  peek: (lv, st) => ({ walker: st.p, crates: st.c.slice(), cols: lv.grid.w, rows: lv.grid.h, onGoal: st.c.filter(i => lv.grid.goal[i]).length, crateCount: st.c.length }),
});
