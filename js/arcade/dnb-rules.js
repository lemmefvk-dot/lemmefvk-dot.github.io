/* ============================================================
   arcade/dnb-rules.js — Dots and Boxes: the rules and its computer player.

   Pure (no DOM), shared by the game (./dnb.js), the thinking worker
   (./think.js) and the play-tests.

   A board is n × n boxes (3 to 6) on (n+1) × (n+1) dots. An EDGE is a line
   between two neighbouring dots:
     horizontal H(r, c) = r * n + c            r 0..n, c 0..n-1
     vertical   V(r, c) = n(n+1) + r(n+1) + c  r 0..n-1, c 0..n
   (2n(n+1) edges: 24, 40, 60, 84). Box b = row * n + col has its top edge
   H(row, col), bottom H(row+1, col), left V(row, col), right V(row, col+1).
   A turn is drawing one undrawn edge. Drawing the fourth side of a box
   claims it for you AND gives you another turn (several boxes with one
   line is allowed — each counts). All edges drawn: most boxes wins, equal
   is a draw. `turn` is 1 or -1; score[0] is player 1's boxes, score[1]
   player -1's.

   The computer.
     Easy: takes a box it sees half the time, otherwise any line.
     Medium: takes every box it can; otherwise a line that doesn't hand
       over a third side; when forced to, the line that gives away the
       fewest boxes.
     Hard: chain-aware.
       · With 17 lines or fewer left it SOLVES the game exactly (every
         line, memoised), so the end is perfect.
       · Before that it takes every box offered, except that when only
         long chains are left it plays the DOUBLE-DEAL — leaves the last
         two boxes of a chain so the opponent must open the next chain —
         whenever the chain arithmetic (loonyValue below) says keeping
         control is worth the two boxes; when it has to open something it
         opens the chain that costs least in that same arithmetic; and
         otherwise it plays a safe line chosen by playing each one out at
         random to the point where someone must open a chain and asking
         the same arithmetic who that will be and what it is worth.
       It is a strong, not a perfect, player on 5 × 5 and 6 × 6: those
       playouts are samples, not a proof.
   ============================================================ */
export const SIZES = [3, 4, 5, 6];
export const LEVELS = { 1: { name: 'Easy' }, 2: { name: 'Medium' }, 3: { name: 'Hard' } };
export const EXACT_AT = 17;
export const edgeCount = n => 2 * n * (n + 1);
export const hEdge = (n, r, c) => r * n + c;
export const vEdge = (n, r, c) => n * (n + 1) + r * (n + 1) + c;

/* the boxes either side of an edge: [a, b] with -1 for the outside */
export function edgeBoxes(n, e) {
  const hs = n * (n + 1);
  if (e < hs) {
    const r = Math.floor(e / n), c = e % n;
    return [r > 0 ? (r - 1) * n + c : -1, r < n ? r * n + c : -1];
  }
  const k = e - hs, r = Math.floor(k / (n + 1)), c = k % (n + 1);
  return [c > 0 ? r * n + c - 1 : -1, c < n ? r * n + c : -1];
}
/* the four edges of a box: top, bottom, left, right */
export const boxEdges = (n, b) => { const r = Math.floor(b / n), c = b % n; return [hEdge(n, r, c), hEdge(n, r + 1, c), vEdge(n, r, c), vEdge(n, r, c + 1)]; };
/* an edge's two dots as [row, col] pairs */
export function edgeDots(n, e) {
  const hs = n * (n + 1);
  if (e < hs) { const r = Math.floor(e / n), c = e % n; return [[r, c], [r, c + 1]]; }
  const k = e - hs, r = Math.floor(k / (n + 1)), c = k % (n + 1);
  return [[r, c], [r + 1, c]];
}

export function newGame(n = 4, first = 1) {
  const size = SIZES.includes(n) ? n : 4;
  return { n: size, drawn: new Uint8Array(edgeCount(size)), owner: new Int8Array(size * size), sides: new Uint8Array(size * size), turn: first === -1 ? -1 : 1, score: [0, 0], moves: [], first: first === -1 ? -1 : 1 };
}
export function copy(g) {
  return { n: g.n, drawn: g.drawn.slice(), owner: g.owner.slice(), sides: g.sides.slice(), turn: g.turn, score: g.score.slice(), moves: g.moves.slice(), first: g.first };
}
export const canPlay = (g, e) => Number.isInteger(e) && e >= 0 && e < g.drawn.length && g.drawn[e] === 0;
/** draw edge e for the side to move. Returns the boxes it claimed (0, 1 or 2), or -1 when illegal.
    Claiming a box keeps the turn. */
export function play(g, e) {
  if (!canPlay(g, e)) return -1;
  g.drawn[e] = 1;
  g.moves.push(e);
  let got = 0;
  for (const b of edgeBoxes(g.n, e)) {
    if (b < 0) continue;
    if (++g.sides[b] === 4) { g.owner[b] = g.turn; g.score[g.turn === 1 ? 0 : 1]++; got++; }
  }
  if (!got) g.turn = -g.turn;
  return got;
}
/** take back the last line (replays the rest) */
export function undo(g) {
  if (!g.moves.length) return false;
  const rest = g.moves.slice(0, -1);
  const f = newGame(g.n, g.first);
  for (const m of rest) play(f, m);
  Object.assign(g, f);
  return true;
}
export const remaining = g => g.drawn.length - g.moves.length;
/** { over, winner: 1 | -1 | 0 } */
export function outcome(g) {
  if (remaining(g) > 0) return { over: false, winner: 0 };
  const d = g.score[0] - g.score[1];
  return { over: true, winner: d > 0 ? 1 : d < 0 ? -1 : 0 };
}
/** the box a line would complete (those with three sides drawn already), as a count */
const completes = (g, e) => { let k = 0; for (const b of edgeBoxes(g.n, e)) if (b >= 0 && g.sides[b] === 3) k++; return k; };
/** would this line give the opponent a box (make a third side)? */
const giftsBox = (g, e) => { for (const b of edgeBoxes(g.n, e)) if (b >= 0 && g.sides[b] === 2) return true; return false; };
export const undrawn = g => { const out = []; for (let e = 0; e < g.drawn.length; e++) if (!g.drawn[e]) out.push(e); return out; };

/* ---------------------------- exact endgame ---------------------------- */
/* Net boxes (side to move − other) from here to the end, for a position with ≤ EXACT_AT lines left. */
function solver(g) {
  const list = undrawn(g), m = list.length, local = new Map(list.map((e, i) => [e, i]));
  /* each box with undrawn sides: the mask of its undrawn lines */
  const boxMasks = [];
  for (let b = 0; b < g.n * g.n; b++) {
    if (g.sides[b] === 4) continue;
    let mask = 0;
    for (const e of boxEdges(g.n, b)) if (!g.drawn[e]) mask |= 1 << local.get(e);
    boxMasks.push(mask);
  }
  const touching = list.map((_e, i) => boxMasks.filter(mk => mk & (1 << i)));
  const memo = new Int8Array(1 << m).fill(-128);
  const full = (1 << m) - 1;
  const val = drawn => {                        /* drawn: mask of lines drawn so far */
    if (drawn === full) return 0;
    const hit = memo[drawn];
    if (hit !== -128) return hit;
    let best = -127;
    for (let i = 0; i < m; i++) {
      if (drawn & (1 << i)) continue;
      const nd = drawn | (1 << i);
      let got = 0;
      for (const mk of touching[i]) if ((nd & mk) === mk) got++;
      const s = got ? got + val(nd) : -val(nd);
      if (s > best) best = s;
    }
    memo[drawn] = best;
    return best;
  };
  return { list, m, val, touching };
}
/** exact value of every line: [{ edge, score }], score = net boxes for the side to move */
export function solveMoves(g) {
  if (remaining(g) > EXACT_AT) return null;
  const { list, val, touching } = solver(g);
  return list.map((e, i) => {
    const nd = 1 << i;
    let got = 0;
    for (const mk of touching[i]) if ((nd & mk) === mk) got++;
    return { edge: e, score: got ? got + val(nd) : -val(nd) };
  });
}

/* ---------------------------- chain arithmetic ---------------------------- */
/**
 * The "loony endgame": nothing but long chains and loops left, and the side to
 * move must open one. comps = [{ len, loop }]. Returns the net boxes (mover − other)
 * with best play on both sides, where the side that is given a chain may take it all
 * or take all but two (four, in a loop) and hand those back to keep control.
 */
export function loonyValue(comps) {
  const memo = new Map();
  const key = cs => cs.map(c => (c.loop ? 'o' : 'c') + c.len).sort().join(',');
  const V = cs => {
    if (!cs.length) return 0;
    const k = key(cs);
    if (memo.has(k)) return memo.get(k);
    let best = -Infinity;
    const seen = new Set();
    cs.forEach((c, i) => {
      const id = (c.loop ? 'o' : 'c') + c.len;
      if (seen.has(id)) return;
      seen.add(id);
      const rest = cs.filter((_x, j) => j !== i);
      const v = V(rest);
      const take = c.len + v;
      let opp = take;
      if (!c.loop && c.len >= 3) opp = Math.max(opp, c.len - 4 - v);
      if (c.loop) opp = Math.max(opp, c.len - 8 - v);
      best = Math.max(best, -opp);
    });
    memo.set(k, best);
    return best;
  };
  return V(comps);
}
/**
 * If every undrawn line sits between two-sided boxes (or the edge of the board), the
 * position is chains and loops only: returns [{ len, loop, edges }] — `edges` are that
 * component's undrawn lines. Otherwise null. Boxes with three sides drawn also return null.
 */
export function components(g) {
  const n = g.n, N = n * n;
  const undr = [];                              /* box -> its undrawn edges */
  for (let b = 0; b < N; b++) {
    if (g.sides[b] === 3) return null;
    const u = g.sides[b] === 4 ? [] : boxEdges(n, b).filter(e => !g.drawn[e]);
    if (g.sides[b] < 4 && u.length !== 2) return null;
    undr.push(u);
  }
  const seen = new Set(), out = [];
  for (let b = 0; b < N; b++) {
    if (g.sides[b] === 4 || seen.has(b)) continue;
    /* every box here has exactly two undrawn lines, so a component is a path or a cycle */
    const boxes = [], edges = new Set(), stack = [b];
    seen.add(b);
    while (stack.length) {
      const c = stack.pop();
      boxes.push(c);
      for (const e of undr[c]) {
        edges.add(e);
        for (const o of edgeBoxes(n, e)) if (o >= 0 && !seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
    out.push({ len: boxes.length, loop: edges.size === boxes.length, edges: [...edges] });
  }
  return out;
}

/* ---------------------------- the computer ---------------------------- */
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];
/** the lines taken, in order, if the side to move grabs every box on offer; `boxes` is how many that claims */
function captureRun(g) {
  const t = copy(g), run = [];
  let boxes = 0;
  for (;;) {
    let e = -1;
    for (let b = 0; b < t.n * t.n && e < 0; b++) if (t.sides[b] === 3) e = boxEdges(t.n, b).find(x => !t.drawn[x]);
    if (e < 0) break;
    boxes += play(t, e); run.push(e);
  }
  return { run, boxes, state: t };
}
/** how many boxes the opponent could grab after the side to move draws e (negative: e claims boxes itself) */
function givenAway(g, e) {
  const t = copy(g);
  const k = play(t, e);
  if (k > 0) return -k;
  return captureRun(t).boxes;
}
const safeLines = g => undrawn(g).filter(e => !giftsBox(g, e));
/* Which safe line leaves the right number of safe lines? Play each candidate out at random until nobody has a safe
   line, then ask the chain arithmetic who has to open a chain, and how much that is worth. Mean over a few playouts. */
function bestSafe(g, safe, rng) {
  const cands = safe.length > 20 ? safe.slice().sort(() => rng() - 0.5).slice(0, 20) : safe;
  const me = g.turn;
  let best = [], bs = -Infinity;
  for (const c of cands) {
    let sum = 0;
    const N = 8;
    for (let k = 0; k < N; k++) {
      const t = copy(g);
      play(t, c);
      for (;;) {
        const sl = safeLines(t);
        if (!sl.length) break;
        play(t, sl[Math.floor(rng() * sl.length) % sl.length]);
      }
      const comps = components(t);
      const v = comps ? loonyValue(comps) : -givenAwayMin(t);
      sum += t.turn === me ? v : -v;
    }
    const m = sum / N;
    if (m > bs + 1e-9) { bs = m; best = [c]; } else if (Math.abs(m - bs) <= 1e-9) best.push(c);
  }
  return best[Math.floor(rng() * best.length) % best.length];
}
function givenAwayMin(t) { let low = Infinity; for (const e of undrawn(t)) low = Math.min(low, givenAway(t, e)); return low === Infinity ? 0 : low; }

export function think(g, { level = 2, rng = Math.random } = {}) {
  const lines = undrawn(g);
  if (!lines.length) return { edge: null, score: 0 };
  const grabs = lines.filter(e => completes(g, e) > 0);
  if (level <= 1) {
    if (grabs.length && rng() < 0.6) return { edge: pick(grabs, rng), score: 0 };
    return { edge: pick(lines, rng), score: 0 };
  }
  if (level === 2) {
    if (grabs.length) return { edge: pick(grabs, rng), score: 0 };
    const safe = lines.filter(e => !giftsBox(g, e));
    if (safe.length) return { edge: pick(safe, rng), score: 0 };
    const costs = lines.map(e => givenAway(g, e)), low = Math.min(...costs);
    return { edge: pick(lines.filter((_e, i) => costs[i] === low), rng), score: -low };
  }
  /* Hard */
  if (lines.length <= EXACT_AT) {
    const all = solveMoves(g);
    const top = Math.max(...all.map(m => m.score));
    return { edge: pick(all.filter(m => m.score === top), rng).edge, score: top, exact: true };
  }
  if (grabs.length) {
    const { run, boxes, state } = captureRun(g);
    /* two boxes left to take and nothing but chains afterwards? then weigh keeping control */
    if (run.length === 2 && boxes === 2 && !safeLines(state).length) {
      const comps = components(state);
      if (comps) {
        const v = loonyValue(comps);
        if (v < -2) {
          /* decline: draw the far end of the last two boxes instead of taking them */
          const decline = run[1];
          if (decline !== run[0] && givenAway(g, decline) === 2) return { edge: decline, score: 0, doubleDeal: true };
        }
      }
    }
    return { edge: run[0], score: 0 };
  }
  const safe = safeLines(g);
  if (safe.length) return { edge: safe.length === 1 ? safe[0] : bestSafe(g, safe, rng), score: 0 };
  /* forced to open something */
  const comps = components(g);
  if (comps && comps.length) {
    let best = null, bv = -Infinity;
    comps.forEach(c => {
      const rest = comps.filter(x => x !== c);
      const v = loonyValue(rest);
      let opp = c.len + v;
      if (!c.loop && c.len >= 3) opp = Math.max(opp, c.len - 4 - v);
      if (c.loop) opp = Math.max(opp, c.len - 8 - v);
      if (-opp > bv) { bv = -opp; best = c; }
    });
    /* a short chain: open it in the middle so the opponent cannot decline; a long one: at an end */
    const ends = best.edges.filter(x => edgeBoxes(g.n, x).some(b => b < 0));
    let e = best.edges[0];
    if (!best.loop) e = best.len === 2 ? (best.edges.find(x => edgeBoxes(g.n, x).every(b => b >= 0)) ?? e) : (ends[0] ?? e);
    return { edge: e, score: bv };
  }
  const costs = lines.map(e => givenAway(g, e)), low = Math.min(...costs);
  return { edge: pick(lines.filter((_e, i) => costs[i] === low), rng), score: -low };
}

export default { SIZES, LEVELS, newGame, copy, canPlay, play, undo, outcome, think, undrawn, remaining, edgeBoxes, boxEdges, edgeDots, hEdge, vEdge, edgeCount, components, loonyValue, solveMoves };
