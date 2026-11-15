/* ============================================================
   arcade/signalrelay-logic.js — the rules of Signal Relay, no DOM.

   A board is w × h cells, row-major, one character each:
     .   empty                      #   a wall (stops light)
     m   mirror /  you can turn     n   mirror \  you can turn
     M   mirror /  fixed            N   mirror \  fixed
     s   splitter / you can turn    t   splitter \ you can turn
         (a splitter lets the beam through AND bends a copy of it)
     1 2 3 4   red source facing east, west, north, south
     5 6 7 8   blue source facing east, west, north, south
     R   red receiver               B   blue receiver
   A beam leaves a source, bends at mirrors, stops at walls, other
   sources and receivers. A receiver lights only for its own colour.
   Beams of different colours don't touch each other. The board is
   solved when every receiver is lit. A turn (click) swaps a turnable
   cell between its two angles (m <-> n, s <-> t), so every turnable
   cell is one of two states and the fewest turns to a solved board
   is found by looking at all 2^k of them (solve()).

   Levels are made, not typed in: makeLevel(i) lays a beam path with
   turns and puts a mirror at each turn, adds walls and decoy mirrors
   from a seeded generator, then turns some of the path mirrors the
   wrong way. A solved board exists by construction, solve() finds
   its own, and the test suite runs it over all thirty levels.

   A shared board is a code: SR1:<w>x<h>:<w*h characters> (parseCode).
   ============================================================ */
import { rng } from './kit.js';

export const LEVELS = 30;
export const MAX_TURNABLE = 14;
const N = 0, E = 1, S = 2, W = 3;
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const SLASH = [E, N, W, S];      /* a beam going dir d leaves a / mirror going SLASH[d] */
const BACK = [W, S, E, N];       /* ... and a \ mirror going BACK[d] */
export const CHARS = '.#mnMNst12345678RB';
const SRC_DIR = { 1: E, 2: W, 3: N, 4: S, 5: E, 6: W, 7: N, 8: S };

export const isSource = c => c >= '1' && c <= '8';
export const sourceColor = c => (c <= '4' ? 0 : 1);          /* 0 red, 1 blue */
export const isReceiver = c => c === 'R' || c === 'B';
export const receiverColor = c => (c === 'R' ? 0 : 1);
export const turnable = c => c === 'm' || c === 'n' || c === 's' || c === 't';
export const turned = c => ({ m: 'n', n: 'm', s: 't', t: 's' }[c] || c);
const slashy = c => c === 'm' || c === 'M' || c === 's';
const mirrorLike = c => 'mnMNst'.includes(c);
const splitter = c => c === 's' || c === 't';

/** trace every beam: { segs: [[x1,y1,x2,y2,color]], lit: Set of receiver cell indexes } */
export function trace(w, h, cells) {
  const segs = [], lit = new Set(), seen = new Set();
  const stack = [];
  for (let i = 0; i < w * h; i++) if (isSource(cells[i])) stack.push([i % w, (i / w) | 0, SRC_DIR[cells[i]], sourceColor(cells[i])]);
  while (stack.length) {
    let [x, y, d, col] = stack.pop();
    for (;;) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) { segs.push([x, y, nx, ny, col]); break; }
      segs.push([x, y, nx, ny, col]);
      const i = ny * w + nx, c = cells[i];
      if (c === '#' || isSource(c)) break;
      if (isReceiver(c)) { if (receiverColor(c) === col) lit.add(i); break; }
      if (mirrorLike(c)) {
        const key = (i * 4 + d) * 2 + col;
        if (seen.has(key)) break;
        seen.add(key);
        const nd = slashy(c) ? SLASH[d] : BACK[d];
        if (splitter(c)) stack.push([nx, ny, d, col]);      /* the copy that goes straight on is walked later */
        x = nx; y = ny; d = nd;
        continue;
      }
      const key = (i * 4 + d) * 2 + col;
      if (seen.has(key)) break;
      seen.add(key);
      x = nx; y = ny;
    }
  }
  return { segs, lit };
}

export const receivers = (w, h, cells) => { const r = []; for (let i = 0; i < w * h; i++) if (isReceiver(cells[i])) r.push(i); return r; };
export function isSolved(w, h, cells) {
  const rc = receivers(w, h, cells);
  if (!rc.length) return false;
  const { lit } = trace(w, h, cells);
  return rc.every(i => lit.has(i));
}

/** the cheapest way to solve: { par, cells, solutions } or null (no solution, or too many turnable cells) */
export function solve(w, h, cells) {
  const idx = [];
  for (let i = 0; i < w * h; i++) if (turnable(cells[i])) idx.push(i);
  if (idx.length > MAX_TURNABLE) return null;
  const work = Array.from(cells);
  let best = null, solutions = 0;
  for (let mask = 0; mask < 1 << idx.length; mask++) {
    let cost = 0;
    for (let k = 0; k < idx.length; k++) {
      const flip = (mask >> k) & 1;
      work[idx[k]] = flip ? turned(cells[idx[k]]) : cells[idx[k]];
      cost += flip;
    }
    if (best && cost > best.par) { continue; }
    if (isSolved(w, h, work)) {
      solutions++;
      if (!best || cost < best.par) best = { par: cost, cells: work.slice() };
    }
  }
  return best ? { ...best, solutions, turnable: idx.length } : null;
}

/* ---------- making levels ---------- */
const hash = (a, b) => (Math.imul(a + 1, 73856093) ^ Math.imul(b + 7, 19349663) ^ 0x2f1b3c5d) >>> 0;
export const sizeOf = i => Math.min(9, 5 + Math.floor(i / 7));
const pathsOf = i => (i < 9 ? 1 : i < 21 ? 2 : 3);
const turnsOf = i => (i < 9 ? 2 + (i >> 2) : i < 21 ? 2 + ((i - 9) >> 2) : 2 + ((i - 21) >> 2));

export function attempt(i, n, drop = 0) {
  const r = rng(hash(i, n));
  const size = sizeOf(i);
  const w = size, h = size;
  const cells = Array(w * h).fill('.');
  const used = new Array(w * h).fill(false);
  const pathMirrors = [];
  const ok = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !used[y * w + x];
  const paths = Math.max(1, pathsOf(i) - drop);
  /* one path: tried again (on a clean copy) until it fits beside the others */
  const carve = color => {
    for (let tries = 0; tries < 60; tries++) {
      const u = used.slice(), c = cells.slice(), pm = [];
      const free = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !u[y * w + x];
      const side = (r() * 4) | 0;
      const t = 1 + ((r() * (size - 2)) | 0);
      let x = side === 0 ? t : side === 1 ? w - 1 : side === 2 ? t : 0;
      let y = side === 0 ? 0 : side === 1 ? t : side === 2 ? h - 1 : t;
      let d = [S, W, N, E][side];
      if (!free(x, y)) continue;
      u[y * w + x] = true;
      c[y * w + x] = String((color ? 5 : 1) + ({ [E]: 0, [W]: 1, [N]: 2, [S]: 3 })[d]);
      const turns = turnsOf(i) + (r() < 0.3 ? 1 : 0);
      let failed = false;
      for (let k = 0; k <= turns && !failed; k++) {
        const steps = 1 + ((r() * 3) | 0);
        for (let s2 = 0; s2 < steps; s2++) {
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (!free(nx, ny)) { failed = true; break; }
          x = nx; y = ny; u[y * w + x] = true;
        }
        if (failed || k === turns) break;
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (!free(nx, ny)) { failed = true; break; }
        /* the turn: a mirror at (nx, ny), then the beam goes left or right of where it was going */
        const nd = r() < 0.5 ? (d + 3) % 4 : (d + 1) % 4;
        x = nx; y = ny; u[y * w + x] = true;
        const slash = SLASH[d] === nd;
        pm.push({ i: y * w + x, slash });
        c[y * w + x] = slash ? 'm' : 'n';
        d = nd;
      }
      if (failed) continue;
      /* the receiver: one more cell on */
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (!free(nx, ny)) continue;
      u[ny * w + nx] = true;
      c[ny * w + nx] = color ? 'B' : 'R';
      for (let k = 0; k < w * h; k++) { used[k] = u[k]; cells[k] = c[k]; }
      pathMirrors.push(...pm);
      return true;
    }
    return false;
  };
  for (let p = 0; p < paths; p++) if (!carve(p % 2)) return null;
  /* some path mirrors are bolted in place (the right way round), and a few are splitters later on */
  for (const m of pathMirrors) {
    const q = r();
    if (q < 0.2) cells[m.i] = m.slash ? 'M' : 'N';
    else if (i >= 20 && q > 0.82) cells[m.i] = m.slash ? 's' : 't';
  }
  const loose = () => cells.reduce((a, c, k) => a + (turnable(c) ? 1 : 0), 0);
  /* walls and decoys on free cells */
  const free = [];
  for (let k = 0; k < w * h; k++) if (!used[k]) free.push(k);
  for (let k = free.length - 1; k > 0; k--) { const j = (r() * (k + 1)) | 0; [free[k], free[j]] = [free[j], free[k]]; }
  const walls = Math.min(free.length, Math.floor(i / 3));
  for (let k = 0; k < walls; k++) cells[free[k]] = '#';
  const decoys = Math.min(free.length - walls, 1 + (i >> 3), MAX_TURNABLE - loose());
  for (let k = 0; k < decoys; k++) cells[free[walls + k]] = r() < 0.5 ? 'm' : 'n';
  if (loose() > MAX_TURNABLE) return null;
  /* the beams must still reach their receivers as laid (decoys and walls sit off the paths, so they do) */
  if (!isSolved(w, h, cells)) return null;
  /* turn the path mirrors the wrong way */
  const loosePath = pathMirrors.filter(m => turnable(cells[m.i]));
  if (!loosePath.length) return null;
  let any = false;
  for (const m of loosePath) if (r() < 0.65) { cells[m.i] = turned(cells[m.i]); any = true; }
  if (!any) { const m = loosePath[(r() * loosePath.length) | 0]; cells[m.i] = turned(cells[m.i]); }
  return { w, h, cells };
}

const cache = new Map();
/** level i (0-based, 0..29): { w, h, cells (as dealt), par, turnable } — the same on every device */
export function makeLevel(i) {
  i = Math.max(0, Math.min(LEVELS - 1, i | 0));
  if (cache.has(i)) return cache.get(i);
  const want = 1 + Math.min(5, Math.floor(i / 5));
  let pick = null;
  for (let n = 0; n < 800 && !(pick && pick.par >= want); n++) {
    const L = attempt(i, n, n >= 400 ? 1 : 0);   /* a crowded board that never fits makes do with one path fewer */
    if (!L || isSolved(L.w, L.h, L.cells)) continue;
    const s = solve(L.w, L.h, L.cells);
    if (!s) continue;
    L.par = s.par; L.turnable = s.turnable;
    if (!pick || (s.par > pick.par && pick.par < want)) pick = L;
    if (s.par >= want) { pick = L; break; }
  }
  cache.set(i, pick);
  return pick;
}

/* ---------- codes ---------- */
export const toCode = (w, h, cells) => `SR1:${w}x${h}:${Array.from(cells).join('')}`;
/** a code -> { ok: true, w, h, cells, par } or { ok: false, why } */
export function parseCode(text) {
  const m = /^SR1:(\d{1,2})x(\d{1,2}):(.+)$/.exec(String(text || '').trim());
  if (!m) return { ok: false, why: 'That is not a Signal Relay code (it starts SR1:).' };
  const w = +m[1], h = +m[2], body = m[3];
  if (w < 4 || h < 4 || w > 9 || h > 9) return { ok: false, why: 'A board is from 4×4 to 9×9.' };
  if (body.length !== w * h) return { ok: false, why: 'The code is the wrong length for its size.' };
  for (const c of body) if (!CHARS.includes(c)) return { ok: false, why: `The code has a character that is not part of the game (${c}).` };
  const cells = Array.from(body);
  if (!cells.some(isSource)) return { ok: false, why: 'The board has no source.' };
  if (!cells.some(isReceiver)) return { ok: false, why: 'The board has no receiver.' };
  if (cells.filter(turnable).length > MAX_TURNABLE) return { ok: false, why: `Too many turnable cells (the most is ${MAX_TURNABLE}).` };
  if (isSolved(w, h, cells)) return { ok: false, why: 'That board is already solved: there is nothing to turn.' };
  const s = solve(w, h, cells);
  if (!s) return { ok: false, why: 'That board has no solution.' };
  return { ok: true, w, h, cells, par: s.par };
}

export default { LEVELS, makeLevel, trace, isSolved, solve, parseCode, toCode, turnable, turned, sizeOf };
