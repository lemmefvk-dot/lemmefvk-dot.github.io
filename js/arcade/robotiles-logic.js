/* ============================================================
   arcade/robotiles-logic.js — the rules of Robo Tiles, no DOM.

   A level is a small grid, row-major, one character a tile:
     .  floor          #  wall           G  the goal
     O  a pit (the robot falls in and the run fails)
     ^ > v <  a conveyor: landing on it carries the robot one more
              tile that way (on again if that is a conveyor too)
     S  where the robot starts (floor); it starts facing level.dir
   A program is up to five commands, run once, in order:
     F  forward one tile (a wall or the edge: it stays put)
     L  turn left in place         R  turn right in place
     D  dash: forward tile after tile until a wall, the edge, the
        goal, a pit or a conveyor stops it
   Reaching the goal at any moment wins. Falling into a pit, or the
   program ending anywhere else, fails.

   The par of a level is the fewest commands any winning program
   needs, found by trying every program up to five commands long
   (solve()). Levels are made, not typed in: makeLevel(i) deals
   grids from a seeded generator and keeps one only when its par is
   in the range that level's difficulty wants — so every level is
   solvable, and the test suite runs the solver over all 24.
   ============================================================ */
import { rng } from './kit.js';

export const LEVELS = 24;
export const MAX_STEPS = 5;
export const CMDS = ['F', 'L', 'R', 'D'];
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];          /* N E S W */
const ARROW = { '^': 0, '>': 1, v: 2, '<': 3 };
export const isConveyor = c => c in ARROW;

const tileAt = (L, x, y) => (x < 0 || y < 0 || x >= L.w || y >= L.h ? '#' : L.cells[y * L.w + x]);

/** run a program: { win, reason: 'goal'|'pit'|'end', frames: [{ x, y, dir, i, ev }] } — frames[0] is the start; i = the command that made it */
export function run(L, program) {
  let x = L.start % L.w, y = (L.start / L.w) | 0, dir = L.dir;
  const frames = [{ x, y, dir, i: -1, ev: 'start' }];
  /* one tile forward; returns false if blocked */
  const step = i => {
    const nx = x + DIRS[dir][0], ny = y + DIRS[dir][1];
    if (tileAt(L, nx, ny) === '#') { frames.push({ x, y, dir, i, ev: 'bump' }); return false; }
    x = nx; y = ny;
    frames.push({ x, y, dir, i, ev: 'move' });
    return true;
  };
  /* what the tile under the robot does: 'goal', 'pit', or a conveyor push (returns true if it moved) */
  const land = i => {
    for (let guard = 0; guard < 12; guard++) {
      const c = tileAt(L, x, y);
      if (c === 'G') return 'goal';
      if (c === 'O') { frames.push({ x, y, dir, i, ev: 'fall' }); return 'pit'; }
      if (!isConveyor(c)) return null;
      const d = ARROW[c], nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (tileAt(L, nx, ny) === '#') { frames.push({ x, y, dir, i, ev: 'bump' }); return null; }
      x = nx; y = ny;
      frames.push({ x, y, dir, i, ev: 'carry' });
    }
    return null;
  };
  const pre = land(-1);
  for (let i = 0; i < program.length; i++) {
    const c = program[i];
    if (c === 'L') { dir = (dir + 3) % 4; frames.push({ x, y, dir, i, ev: 'turn' }); }
    else if (c === 'R') { dir = (dir + 1) % 4; frames.push({ x, y, dir, i, ev: 'turn' }); }
    else if (c === 'F') {
      if (step(i)) { const r = land(i); if (r) return { win: r === 'goal', reason: r, frames }; }
    } else if (c === 'D') {
      for (let n = 0; n < 64; n++) {
        if (!step(i)) break;
        const t = tileAt(L, x, y);
        const r = land(i);
        if (r) return { win: r === 'goal', reason: r, frames };
        if (isConveyor(t)) break;
      }
    }
  }
  return { win: pre === 'goal', reason: pre === 'goal' ? 'goal' : 'end', frames };
}

/** the shortest winning program: { par, program } or null (no program of up to five commands wins) */
export function solve(L, max = MAX_STEPS) {
  for (let len = 1; len <= max; len++) {
    const prog = Array(len).fill('F');
    const walk = k => {
      if (k === len) return run(L, prog).win;
      for (const c of CMDS) { prog[k] = c; if (walk(k + 1)) return true; }
      return false;
    };
    if (walk(0)) return { par: len, program: prog.slice() };
  }
  return null;
}

/* ---------- making levels ---------- */
const hash = (a, b) => (Math.imul(a + 1, 73856093) ^ Math.imul(b + 7, 19349663) ^ 0x7a3c19e5) >>> 0;
export const sizeOf = i => (i < 8 ? 5 : i < 16 ? 6 : 7);
const wantPar = i => (i < 8 ? [2, 3] : i < 16 ? [3, 4] : [4, 5]);

function attempt(i, n) {
  const r = rng(hash(i, n));
  const size = sizeOf(i), w = size, h = size;
  const cells = Array(w * h).fill('.');
  const put = (ch, count) => { for (let k = 0, t = 0; k < count && t < 200; t++) { const c = (r() * w * h) | 0; if (cells[c] === '.') { cells[c] = ch; k++; } } };
  put('#', Math.round(w * h * (0.16 + 0.1 * r())));
  put('O', i < 4 ? 0 : 1 + (i >> 3));
  for (let k = 0; k < (i < 6 ? 0 : 1 + (i >> 3)); k++) put('^>v<'[(r() * 4) | 0], 1);
  let start = -1, goal = -1;
  for (let t = 0; t < 200 && start < 0; t++) { const c = (r() * w * h) | 0; if (cells[c] === '.') start = c; }
  for (let t = 0; t < 200 && goal < 0; t++) { const c = (r() * w * h) | 0; if (cells[c] === '.' && c !== start) goal = c; }
  if (start < 0 || goal < 0) return null;
  cells[goal] = 'G';
  return { w, h, cells, start, dir: (r() * 4) | 0, goal };
}

const cache = new Map();
/** level i (0..23): { w, h, cells, start, dir, goal, par } — the same on every device */
export function makeLevel(i) {
  i = Math.max(0, Math.min(LEVELS - 1, i | 0));
  if (cache.has(i)) return cache.get(i);
  const [lo, hi] = wantPar(i);
  let pick = null;
  for (let n = 0; n < 4000 && !pick; n++) {
    const L = attempt(i, n);
    if (!L) continue;
    const s = solve(L);
    if (!s || s.par < lo || s.par > hi) continue;
    /* no level is won by one lucky Dash with nothing in the way: the goal is not straight ahead of the start */
    L.par = s.par;
    pick = L;
  }
  cache.set(i, pick);
  return pick;
}

export const CMD_NAME = { F: 'Forward', L: 'Turn left', R: 'Turn right', D: 'Dash' };

export default { LEVELS, MAX_STEPS, CMDS, run, solve, makeLevel, sizeOf };
