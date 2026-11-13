/* ============================================================
   arcade/mancala-rules.js — Mancala's rules and its computer player.

   Pure (no DOM), shared by the game (./mancala.js), the thinking
   worker (./think.js) and the play-tests.

   THE RULE SET is Kalah, the common home version:
     · 6 pits a side, 4 stones in each, and one store (a big pit) at
       each player's right hand;
     · on your turn pick one of your own pits that has stones, lift
       them all and sow them one per pit, counter-clockwise, starting
       with the next pit. Your own store gets a stone each time you
       pass it; your opponent's store is skipped;
     · EXTRA TURN: if your last stone lands in your own store, you
       move again;
     · CAPTURE: if your last stone lands in an empty pit on YOUR side
       and the pit straight across holds stones, you take those stones
       and your last one into your store (no stones across: no
       capture);
     · the game ends the moment either side has no stones in its
       pits: the other player keeps the stones left on their side;
     · the bigger store wins, equal stores are a draw.

   Board: b[0..5] the first player's pits (left to right as they see
   them), b[6] their store, b[7..12] the second player's pits, b[13]
   their store. Sowing runs 0→13 then round to 0. The pit across from
   pit i is 12 − i. A move is a LOCAL pit number 0..5 (0 = leftmost
   from the mover's own seat).

   The computer: alpha-beta search (an extra turn keeps the same side
   to move), store-lead evaluation with a small credit for stones kept
   on your own side, iterative deepening under a time limit. Easy
   plays a random legal pit about half the time and otherwise grabs
   the best immediate result; Medium searches 4 plies; Hard searches
   deep. `rnd` (a () => [0,1) function) makes every choice testable.
   ============================================================ */
export const PITS = 6, STONES = 4;
export const storeOf = s => s * 7 + 6;
export const pitOf = (s, k) => s * 7 + k;
export const across = i => 12 - i;
export const WIN_SCORE = 1_000_000;

export function newGame(first = 0) {
  const b = new Int8Array(14);
  for (const s of [0, 1]) for (let k = 0; k < PITS; k++) b[pitOf(s, k)] = STONES;
  return { b, turn: first === 1 ? 1 : 0, moves: [], over: false };
}
export function copy(g) { return { b: g.b.slice(), turn: g.turn, moves: g.moves.slice(), over: g.over }; }
export const side = (g, s) => Array.from({ length: PITS }, (_, k) => g.b[pitOf(s, k)]);
export const sideTotal = (b, s) => { let n = 0; for (let k = 0; k < PITS; k++) n += b[pitOf(s, k)]; return n; };
export const canPlay = (g, k) => !g.over && Number.isInteger(k) && k >= 0 && k < PITS && g.b[pitOf(g.turn, k)] > 0;
export const legal = g => (g.over ? [] : [0, 1, 2, 3, 4, 5].filter(k => g.b[pitOf(g.turn, k)] > 0));

/**
 * Sow local pit k for the side to move. Mutates g and returns what happened:
 *   { by, from, steps: [board index each stone lands in, in order],
 *     extra, capture: { pit, across, n } | null, over, swept: [s0, s1] stones swept home }
 * or null when the move is not legal.
 */
export function play(g, k) {
  if (!canPlay(g, k)) return null;
  const by = g.turn, b = g.b, mine = storeOf(by), theirs = storeOf(1 - by);
  const from = pitOf(by, k);
  let n = b[from];
  b[from] = 0;
  const steps = [];
  let i = from;
  while (n > 0) {
    i = (i + 1) % 14;
    if (i === theirs) continue;
    b[i]++;
    steps.push(i);
    n--;
  }
  const last = i;
  let capture = null;
  let extra = last === mine;
  if (!extra && last >= by * 7 && last < by * 7 + PITS && b[last] === 1 && b[across(last)] > 0) {
    const n2 = b[across(last)] + 1;
    capture = { pit: last, across: across(last), n: n2 };
    b[mine] += n2;
    b[last] = 0;
    b[across(last)] = 0;
  }
  g.moves.push(k);
  const swept = [0, 0];
  if (sideTotal(b, 0) === 0 || sideTotal(b, 1) === 0) {
    for (const s of [0, 1]) {
      for (let q = 0; q < PITS; q++) { swept[s] += b[pitOf(s, q)]; b[storeOf(s)] += b[pitOf(s, q)]; b[pitOf(s, q)] = 0; }
    }
    g.over = true;
    extra = false;
  }
  if (!extra) g.turn = 1 - by;
  return { by, from, steps, extra, capture, over: g.over, swept };
}

/** { over, winner: 0 | 1 | -1 (draw) | null, score: [s0, s1] } */
export function outcome(g) {
  const s0 = g.b[6], s1 = g.b[13];
  if (!g.over) return { over: false, winner: null, score: [s0, s1] };
  return { over: true, winner: s0 === s1 ? -1 : s0 > s1 ? 0 : 1, score: [s0, s1] };
}

/* the board after a move, with no bookkeeping: search works on bare arrays */
function step(b, turn, k) {
  const nb = b.slice();
  const mine = storeOf(turn), theirs = storeOf(1 - turn), from = pitOf(turn, k);
  let n = nb[from], i = from;
  nb[from] = 0;
  while (n > 0) { i = (i + 1) % 14; if (i === theirs) continue; nb[i]++; n--; }
  let next = turn;
  if (i !== mine) {
    next = 1 - turn;
    if (i >= turn * 7 && i < turn * 7 + PITS && nb[i] === 1 && nb[12 - i] > 0) { nb[mine] += nb[12 - i] + 1; nb[i] = 0; nb[12 - i] = 0; }
  }
  let over = false;
  const a = sideTotal(nb, 0), c = sideTotal(nb, 1);
  if (a === 0 || c === 0) {
    nb[6] += a; nb[13] += c;
    for (let q = 0; q < PITS; q++) { nb[q] = 0; nb[7 + q] = 0; }
    over = true;
  }
  return { nb, next, over };
}

/** How good the board is for `me` (positive: ahead). */
export function evaluate(b, me) {
  const lead = b[storeOf(me)] - b[storeOf(1 - me)];
  return lead * 10 + (sideTotal(b, me) - sideTotal(b, 1 - me)) * 2;
}

/* move order: extra turns first, then captures, then the pit nearest the store */
function ordered(b, turn) {
  const out = [];
  for (let k = 0; k < PITS; k++) {
    const n = b[pitOf(turn, k)];
    if (!n) continue;
    const reach = (k + n) % 13;
    out.push({ k, pri: reach === PITS ? 100 : n > 0 ? k : 0 });
  }
  return out.sort((x, y) => y.pri - x.pri).map(o => o.k);
}

function search(b, turn, me, depth, alpha, beta, ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) ctx.out = true;
  if (ctx.out) return 0;
  if (depth === 0) return evaluate(b, me);
  const ks = ordered(b, turn);
  if (!ks.length) return evaluate(b, me);
  const max = turn === me;
  let best = max ? -Infinity : Infinity;
  for (const k of ks) {
    const r = step(b, turn, k);
    let v;
    if (r.over) {
      const lead = r.nb[storeOf(me)] - r.nb[storeOf(1 - me)];
      v = lead === 0 ? 0 : lead > 0 ? WIN_SCORE - (ctx.maxDepth - depth) : -WIN_SCORE + (ctx.maxDepth - depth);
    } else v = search(r.nb, r.next, me, depth - 1, alpha, beta, ctx);
    if (ctx.out) return 0;
    if (max) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

export const LEVELS = {
  1: { name: 'Easy', maxDepth: 1, timeMs: 100, randomShare: 0.5 },
  2: { name: 'Medium', maxDepth: 4, timeMs: 500, randomShare: 0 },
  3: { name: 'Hard', maxDepth: 14, timeMs: 1200, randomShare: 0 },
};

/**
 * The computer's move for the side to move: { k, score, depth, nodes, ms }.
 * opts: { maxDepth, timeMs, randomShare, rnd }
 */
export function think(g, opts = {}) {
  const lv = { ...LEVELS[2], ...opts };
  const rnd = typeof lv.rnd === 'function' ? lv.rnd : Math.random;
  const t0 = performance.now();
  const ks = legal(g);
  if (!ks.length) return { k: -1, score: 0, depth: 0, nodes: 0, ms: 0 };
  if (ks.length === 1) return { k: ks[0], score: 0, depth: 0, nodes: 1, ms: 0 };
  if (lv.randomShare && rnd() < lv.randomShare) return { k: ks[Math.floor(rnd() * ks.length)], score: 0, depth: 0, nodes: 1, ms: 0 };
  const me = g.turn;
  let best = { k: ks[0], score: -Infinity, depth: 0, nodes: 0 };
  let nodes = 0;
  const order = ordered(g.b, me);
  for (let depth = 1; depth <= lv.maxDepth; depth++) {
    const ctx = { nodes: 0, out: false, deadline: t0 + lv.timeMs, maxDepth: depth };
    let cur = null, alpha = -Infinity;
    /* the best move so far is searched first at the next depth */
    const list = best.depth ? [best.k, ...order.filter(k => k !== best.k)] : order;
    for (const k of list) {
      const r = step(g.b, me, k);
      let v;
      if (r.over) {
        const lead = r.nb[storeOf(me)] - r.nb[storeOf(1 - me)];
        v = lead === 0 ? 0 : lead > 0 ? WIN_SCORE : -WIN_SCORE;
      } else v = search(r.nb, r.next, me, depth - 1, alpha, Infinity, ctx);
      if (ctx.out) break;
      /* ties go to the earlier (better ordered) move, so a seed never changes the strongest levels */
      if (!cur || v > cur.score) cur = { k, score: v };
      if (v > alpha) alpha = v;
    }
    nodes += ctx.nodes;
    if (ctx.out) break;
    best = { k: cur.k, score: cur.score, depth, nodes };
    if (Math.abs(cur.score) >= WIN_SCORE - 100) break;
  }
  return { ...best, nodes, ms: Math.round(performance.now() - t0) };
}

export default { PITS, STONES, newGame, copy, play, canPlay, legal, outcome, think, evaluate, LEVELS, storeOf, pitOf, across };
