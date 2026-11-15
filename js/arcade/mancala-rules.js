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

   OWARE (newGame(first, { rules: 'oware' })), the Abapa rules — the
   ones played in Ghana and in tournaments:
     · 6 houses a side, 4 seeds in each, and no stores on the board:
       what you capture goes to your own tally beside it;
     · pick one of your houses with seeds and sow them one per house,
       counter-clockwise from the next one; a house with 12 or more
       seeds goes all the way round, and its own house is skipped;
     · CAPTURE: if your last seed makes a house on your opponent's
       side hold 2 or 3, you take them, and so the house before it,
       and the one before that, … while they are on your opponent's
       side and hold 2 or 3;
     · a move that would capture every seed your opponent has captures
       nothing (the move is still played: the "grand slam" rule);
     · if your opponent has no seeds you must give them some, if any
       move can; if none can, the game ends and you take the seeds
       left on your side;
     · 25 seeds wins; 24 each is a draw;
     · a game that goes round and round ends (our rule, since Abapa
       leaves this to the players): the same position with the same
       side to move for the third time, or 100 moves in a row (50
       each) with no capture, and each side takes the seeds on its own
       side.
   b[6] and b[13] are the tallies (never sown into); g.quiet counts
   moves since the last capture and g.seen positions; g.end says how
   an Oware game ended ('score' | 'feed' | 'repeat' | 'quiet').

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
   Oware uses the same search on its own rules (captures searched
   first); it does not look for repetitions or the 100-move end.
   ============================================================ */
export const PITS = 6, STONES = 4;
export const RULES = ['kalah', 'oware'];
export const QUIET_MAX = 100;
export const storeOf = s => s * 7 + 6;
export const pitOf = (s, k) => s * 7 + k;
export const across = i => 12 - i;
export const WIN_SCORE = 1_000_000;
const isOware = g => g.rules === 'oware';
const posKey = g => `${g.turn}:${Array.from(g.b).join(',')}`;

export function newGame(first = 0, opts = {}) {
  const b = new Int8Array(14);
  for (const s of [0, 1]) for (let k = 0; k < PITS; k++) b[pitOf(s, k)] = STONES;
  const g = { b, turn: first === 1 ? 1 : 0, moves: [], over: false };
  if (opts.rules === 'oware') { g.rules = 'oware'; g.quiet = 0; g.end = null; g.seen = new Map([[posKey(g), 1]]); }
  return g;
}
export function copy(g) {
  const out = { b: g.b.slice(), turn: g.turn, moves: g.moves.slice(), over: g.over };
  if (isOware(g)) Object.assign(out, { rules: 'oware', quiet: g.quiet | 0, end: g.end || null, seen: new Map(g.seen || []) });
  return out;
}
export const side = (g, s) => Array.from({ length: PITS }, (_, k) => g.b[pitOf(s, k)]);
export const sideTotal = (b, s) => { let n = 0; for (let k = 0; k < PITS; k++) n += b[pitOf(s, k)]; return n; };
/* Oware: does sowing local house k of `turn` put a seed on the other side? */
const feeds = (b, turn, k) => b[pitOf(turn, k)] > PITS - 1 - k;
export const canPlay = (g, k) => !g.over && Number.isInteger(k) && k >= 0 && k < PITS && g.b[pitOf(g.turn, k)] > 0
  && (!isOware(g) || sideTotal(g.b, 1 - g.turn) > 0 || feeds(g.b, g.turn, k));
export const legal = g => (g.over ? [] : [0, 1, 2, 3, 4, 5].filter(k => canPlay(g, k)));

/**
 * Sow local pit k for the side to move. Mutates g and returns what happened:
 *   { by, from, steps: [board index each stone lands in, in order],
 *     extra, capture: { pit, across, n } | null, over, swept: [s0, s1] stones swept home }
 * or null when the move is not legal. Oware: capture is { pit (the last
 * house), pits: [every house taken], n }, plus grandSlam (a capture of
 * everything, so nothing was taken) and end.
 */
export function play(g, k) {
  if (!canPlay(g, k)) return null;
  if (isOware(g)) return playOware(g, k);
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

/* Oware: every seed left on the board goes to the side it is on */
function sweep(b) {
  const swept = [0, 0];
  for (const s of [0, 1]) for (let q = 0; q < PITS; q++) { swept[s] += b[pitOf(s, q)]; b[storeOf(s)] += b[pitOf(s, q)]; b[pitOf(s, q)] = 0; }
  return swept;
}
/* Oware's sowing and capture on a bare board: { last, steps, capture, grandSlam } */
function sowOware(b, by, k, steps = null) {
  const from = pitOf(by, k), opp = 1 - by;
  let n = b[from], i = from;
  b[from] = 0;
  while (n > 0) {
    i = (i + 1) % 14;
    if (i === 6 || i === 13 || i === from) continue;     /* no stores; a lap of 12+ skips its own house */
    b[i]++;
    if (steps) steps.push(i);
    n--;
  }
  let capture = null, grandSlam = false;
  if (i >= opp * 7 && i < opp * 7 + PITS && (b[i] === 2 || b[i] === 3)) {
    const pits = [];
    for (let j = i; j >= opp * 7 && (b[j] === 2 || b[j] === 3); j--) pits.push(j);
    let taken = 0;
    for (const j of pits) taken += b[j];
    if (taken === sideTotal(b, opp)) grandSlam = true;
    else { for (const j of pits) b[j] = 0; b[storeOf(by)] += taken; capture = { pit: i, pits, n: taken }; }
  }
  return { last: i, capture, grandSlam };
}
function playOware(g, k) {
  const by = g.turn, b = g.b, from = pitOf(by, k), steps = [];
  const { capture, grandSlam } = sowOware(b, by, k, steps);
  g.moves.push(k);
  g.turn = 1 - by;
  g.quiet = capture ? 0 : (g.quiet | 0) + 1;
  const key = posKey(g);
  if (!g.seen) g.seen = new Map();
  g.seen.set(key, (g.seen.get(key) || 0) + 1);
  let swept = [0, 0], end = null;
  if (b[6] >= 25 || b[13] >= 25 || (b[6] === 24 && b[13] === 24)) end = 'score';
  else if (g.seen.get(key) >= 3) end = 'repeat';
  else if (g.quiet >= QUIET_MAX) end = 'quiet';
  else if (!legal(g).length) end = 'feed';     /* nothing to give an empty side (or nothing to sow) */
  if (end) { if (end !== 'score') swept = sweep(b); g.over = true; g.end = end; }
  return { by, from, steps, extra: false, capture, grandSlam, over: g.over, swept, end };
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

/* ---------------------------- Oware's search ---------------------------- */
/* the moves for `turn` on a bare board, each with the board after it: captures first, then the house nearest the other side */
function owareKids(b, turn) {
  const oppEmpty = sideTotal(b, 1 - turn) === 0, out = [];
  for (let k = PITS - 1; k >= 0; k--) {
    if (!b[pitOf(turn, k)] || (oppEmpty && !feeds(b, turn, k))) continue;
    const nb = b.slice();
    const r = sowOware(nb, turn, k);
    out.push({ k, nb, gain: r.capture ? r.capture.n : 0 });
  }
  return out.sort((x, y) => y.gain - x.gain);
}
/* over after a move? (25+, 24 each, or the next side has no move: then the seeds go to their sides) */
function owareOver(nb, next) {
  if (nb[6] >= 25 || nb[13] >= 25 || (nb[6] === 24 && nb[13] === 24)) return true;
  const oppEmpty = sideTotal(nb, 1 - next) === 0;
  for (let k = 0; k < PITS; k++) if (nb[pitOf(next, k)] && (!oppEmpty || feeds(nb, next, k))) return false;
  sweep(nb);
  return true;
}
const owareEval = (b, me) => (b[storeOf(me)] - b[storeOf(1 - me)]) * 10 + (sideTotal(b, me) - sideTotal(b, 1 - me));
function searchO(b, turn, me, depth, alpha, beta, ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) ctx.out = true;
  if (ctx.out) return 0;
  if (depth === 0) return owareEval(b, me);
  const kids = owareKids(b, turn);
  if (!kids.length) return owareEval(b, me);
  const max = turn === me;
  let best = max ? -Infinity : Infinity;
  for (const kid of kids) {
    let v;
    if (owareOver(kid.nb, 1 - turn)) {
      const lead = kid.nb[storeOf(me)] - kid.nb[storeOf(1 - me)];
      v = lead === 0 ? 0 : lead > 0 ? WIN_SCORE - (ctx.maxDepth - depth) : -WIN_SCORE + (ctx.maxDepth - depth);
    } else v = searchO(kid.nb, 1 - turn, me, depth - 1, alpha, beta, ctx);
    if (ctx.out) return 0;
    if (max) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}
function thinkOware(g, lv, rnd) {
  const t0 = performance.now();
  const ks = legal(g);
  if (!ks.length) return { k: -1, score: 0, depth: 0, nodes: 0, ms: 0 };
  if (ks.length === 1) return { k: ks[0], score: 0, depth: 0, nodes: 1, ms: 0 };
  if (lv.randomShare && rnd() < lv.randomShare) return { k: ks[Math.floor(rnd() * ks.length)], score: 0, depth: 0, nodes: 1, ms: 0 };
  const me = g.turn, kids = owareKids(g.b, me);
  let best = { k: kids[0].k, score: -Infinity, depth: 0 }, nodes = 0;
  for (let depth = 1; depth <= lv.maxDepth; depth++) {
    const ctx = { nodes: 0, out: false, deadline: t0 + lv.timeMs, maxDepth: depth };
    let cur = null, alpha = -Infinity;
    const list = best.depth ? [kids.find(x => x.k === best.k), ...kids.filter(x => x.k !== best.k)] : kids;
    for (const kid of list) {
      const nb = kid.nb.slice();
      let v;
      if (owareOver(nb, 1 - me)) {
        const lead = nb[storeOf(me)] - nb[storeOf(1 - me)];
        v = lead === 0 ? 0 : lead > 0 ? WIN_SCORE : -WIN_SCORE;
      } else v = searchO(nb, 1 - me, me, depth - 1, alpha, Infinity, ctx);
      if (ctx.out) break;
      if (!cur || v > cur.score) cur = { k: kid.k, score: v };
      if (v > alpha) alpha = v;
    }
    nodes += ctx.nodes;
    if (ctx.out) break;
    best = { k: cur.k, score: cur.score, depth };
    if (Math.abs(cur.score) >= WIN_SCORE - 100) break;
  }
  return { ...best, nodes, ms: Math.round(performance.now() - t0) };
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
  if (isOware(g)) return thinkOware(g, lv, rnd);
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

export default { PITS, STONES, RULES, QUIET_MAX, newGame, copy, play, canPlay, legal, outcome, think, evaluate, LEVELS, storeOf, pitOf, across, sideTotal };
