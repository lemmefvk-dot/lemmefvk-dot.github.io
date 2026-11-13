/* ============================================================
   arcade/snakebattle-logic.js — the rules of Snake Battle, with no
   screen: two snakes on one 30 × 20 board.

   Both snakes move one cell every tick. A snake that runs into a
   wall, its own body, the other snake's body, or the other snake's
   head is out; two heads meeting (or swapping places) knock both
   out, which is a draw. Eating the apple grows the eater by one
   (and the apple jumps to a free cell). The last snake moving wins
   the round; a round that has gone on for 900 ticks is a draw.

   A cell is y * COLS + x. Directions: 0 up, 1 right, 2 down, 3 left.
   Everything is deterministic from the seed, so the host's board and
   a test's board agree.

   newRound(seed, round)          a fresh board
   turn(R, who, dir)              ask a snake to turn (a reversal or a
                                  fourth queued turn is ignored)
   tick(R)                        advance one tick; R.over is set when the round ends
   chooseTurn(R, who, rnd, eps)   the computer's turn
   ============================================================ */
import { rng } from './kit.js';

export const COLS = 30, ROWS = 20, CELLS = COLS * ROWS;
export const MAXLEN = 120;
export const MAX_TICKS = 900;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const cellOf = (x, y) => y * COLS + x;
export const xOf = c => c % COLS;
export const yOf = c => Math.floor(c / COLS);
const inside = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;

function startSnake(who) {
  /* snake 0 on the left heading right, snake 1 on the right heading left; four long */
  const y = ROWS / 2;
  const dir = who === 0 ? 1 : 3;
  const hx = who === 0 ? 7 : COLS - 8;
  const body = [];
  for (let i = 0; i < 4; i++) body.push(cellOf(hx - DX[dir] * i, y));
  return { body, dir, queue: [], alive: true, apples: 0 };
}

export function newRound(seed = 1, round = 1) {
  const R = {
    seed: seed >>> 0, round,
    rnd: rng((seed >>> 0) ^ (round * 0x9E3779B1)),
    tick: 0,
    snakes: [startSnake(0), startSnake(1)],
    food: -1,
    over: null,                       /* null, or { winner: 0 | 1 | -1 (draw), why } */
    ev: [],                           /* [{ kind: 'eat' | 'die', who }] since the last drain */
  };
  placeFood(R);
  return R;
}

export function placeFood(R) {
  const taken = new Uint8Array(CELLS);
  for (const s of R.snakes) for (const c of s.body) taken[c] = 1;
  const free = [];
  for (let c = 0; c < CELLS; c++) if (!taken[c]) free.push(c);
  R.food = free.length ? free[Math.floor(R.rnd() * free.length)] : -1;
}

export function turn(R, who, dir) {
  const s = R.snakes[who];
  if (!s || !s.alive || R.over) return false;
  if (!Number.isInteger(dir) || dir < 0 || dir > 3) return false;
  const last = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
  if (dir === last || dir === (last + 2) % 4 || s.queue.length >= 3) return false;
  s.queue.push(dir);
  return true;
}

export function tick(R) {
  if (R.over) return R;
  R.tick++;
  const next = R.snakes.map(s => {
    if (!s.alive) return null;
    while (s.queue.length) {
      const d = s.queue.shift();
      if (d !== (s.dir + 2) % 4) { s.dir = d; break; }
    }
    const h = s.body[0];
    const x = xOf(h) + DX[s.dir], y = yOf(h) + DY[s.dir];
    return { x, y, cell: inside(x, y) ? cellOf(x, y) : -1, eat: false };
  });
  next.forEach((n, i) => { if (n && n.cell === R.food) n.eat = true; });
  /* the bodies as they will be once everyone has moved */
  const after = R.snakes.map((s, i) => {
    const n = next[i];
    if (!n) return s.body;
    const grow = n.eat && s.body.length < MAXLEN;
    return n.cell < 0 ? s.body : [n.cell, ...(grow ? s.body : s.body.slice(0, -1))];
  });
  const dead = [false, false];
  next.forEach((n, i) => {
    if (!n) return;
    if (n.cell < 0) { dead[i] = true; return; }
    for (let j = 0; j < 2; j++) {
      const body = after[j];
      for (let k = 0; k < body.length; k++) {
        if (j === i && k === 0) continue;          /* its own new head is not an obstacle to itself */
        if (body[k] === n.cell) { dead[i] = true; break; }
      }
      if (dead[i]) break;
    }
  });
  R.snakes.forEach((s, i) => {
    const n = next[i];
    if (!n) return;
    if (dead[i]) { s.alive = false; R.ev.push({ kind: 'die', who: i }); return; }
    s.body = after[i];
    if (n.eat) { s.apples++; R.ev.push({ kind: 'eat', who: i }); }
  });
  if (next.some(n => n && n.eat && !dead[next.indexOf(n)])) placeFood(R);
  const alive = R.snakes.filter(s => s.alive).length;
  if (alive < 2) R.over = { winner: alive === 1 ? R.snakes.findIndex(s => s.alive) : -1, why: alive === 1 ? 'crash' : 'both' };
  else if (R.tick >= MAX_TICKS) R.over = { winner: -1, why: 'time' };
  return R;
}

/* ------------------------------------------------------------
   The computer. It looks at the three cells it can move into,
   discards the deadly ones, and prefers the one that leaves it
   the most room (so it does not trap itself) while heading for
   the apple; it keeps a cell's distance from the other head's
   reach. `eps` of the time it takes a random safe move instead.
   ------------------------------------------------------------ */
export function chooseTurn(R, who, rnd, eps = 0.05) {
  const me = R.snakes[who], foe = R.snakes[1 - who];
  if (!me.alive) return me.dir;
  const blocked = new Uint8Array(CELLS);
  for (const s of R.snakes) for (let k = 0; k < s.body.length - 1; k++) blocked[s.body[k]] = 1;   /* the tail cell moves away */
  const reach = new Set();
  if (foe.alive) for (let d = 0; d < 4; d++) {
    const x = xOf(foe.body[0]) + DX[d], y = yOf(foe.body[0]) + DY[d];
    if (inside(x, y)) reach.add(cellOf(x, y));
  }
  const hx = xOf(me.body[0]), hy = yOf(me.body[0]);
  const fx = R.food >= 0 ? xOf(R.food) : hx, fy = R.food >= 0 ? yOf(R.food) : hy;
  const options = [];
  for (const d of [me.dir, (me.dir + 3) % 4, (me.dir + 1) % 4]) {
    const x = hx + DX[d], y = hy + DY[d];
    if (!inside(x, y)) continue;
    const c = cellOf(x, y);
    if (blocked[c]) continue;
    /* the room beyond this cell (flood fill, capped) */
    const seen = new Uint8Array(CELLS);
    const q = [c]; seen[c] = 1;
    let room = 0;
    while (q.length && room < 160) {
      const u = q.pop(); room++;
      for (let e = 0; e < 4; e++) {
        const nx = xOf(u) + DX[e], ny = yOf(u) + DY[e];
        if (!inside(nx, ny)) continue;
        const v = cellOf(nx, ny);
        if (seen[v] || blocked[v]) continue;
        seen[v] = 1; q.push(v);
      }
    }
    const tight = room < me.body.length + 6;
    let score = Math.min(room, 160) * (tight ? 6 : 0.5) - (Math.abs(x - fx) + Math.abs(y - fy)) * 1.2;
    if (reach.has(c)) score -= foe.body.length >= me.body.length ? 60 : 8;
    if (c === R.food) score += 25;
    options.push({ d, score });
  }
  if (!options.length) return me.dir;
  if (rnd() < eps) return options[Math.floor(rnd() * options.length)].d;
  options.sort((a, b) => b.score - a.score);
  return options[0].d;
}

/* ------------------------------------------------------------
   A snapshot of a round, as the host sends it, and the check the
   guest makes before believing one.
   ------------------------------------------------------------ */
export const WINS = 3;

/* is `body` a snake: 1..MAXLEN cells on the board, each next to the one before it, none twice? */
export function validBody(body, minLen = 1) {
  if (!Array.isArray(body) || body.length < minLen || body.length > MAXLEN) return false;
  const seen = new Set();
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (!Number.isInteger(c) || c < 0 || c >= CELLS || seen.has(c)) return false;
    seen.add(c);
    if (i && Math.abs(xOf(c) - xOf(body[i - 1])) + Math.abs(yOf(c) - yOf(body[i - 1])) !== 1) return false;
  }
  return true;
}
