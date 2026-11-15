/* ============================================================
   arcade/go-rules.js — Go on a 9 × 9, 13 × 13 or 19 × 19 board: the
   rules and the computer player. Pure (no DOM), shared by the game
   (./go.js), the thinking worker (./think.js) and the tests.

   THE RULES CHOSEN (the game says the same):
   · 9 × 9 (online always), 13 × 13 or 19 × 19; Black moves first. A
     stone with no empty neighbour (a "liberty") left, and every stone
     joined to it, is captured.
   · Suicide is forbidden: a move that leaves its own group with no
     liberty is illegal unless it captures something first.
   · Simple ko: you may not at once retake a single stone if that
     would bring the board back to what it was before your
     opponent's move (the ko point is empty-but-banned for one turn).
   · Pass is always allowed. Two passes in a row end the play.
   · Then comes SCORING: dead stones are marked (both players
     toggle groups and each press "Done"; two Dones in a row with
     no change in between agree the result, or either may press
     "Play on" to go back to playing). Area scoring: a side scores
     its living stones plus the empty points only it surrounds.
     White gets a komi of 7.5 on every size, so there are no draws.

   MOVES are integers: 0..n²−1 a point (row * n + col, row 0 on top),
   PASS (-1, which is also "Done" while scoring), RESUME (-3, play
   on) and DEAD + point (toggle the group there as dead or alive while
   scoring). DEAD is 100 on 9 × 9, as it always was (so an online move
   reads the same on every version), and 1000 on the bigger boards,
   whose points run past 100: deadBase(n). Black is 1, White is -1.
   A game knows its size (g.n); a board's size is read from its length.

   THE COMPUTER: Easy plays quick-and-careless (a random sensible
   move, capturing when it sees one about half the time). Medium and
   Hard run random playouts from each candidate move (a flat Monte
   Carlo with UCB1) — Hard plays many more, so it plays better.
   Neither ever fills its own eyes or makes an illegal move. On 13 × 13
   and 19 × 19 the candidates are the points near the stones already
   down (and the 3rd and 4th lines early on), and the search stops at a
   time limit per size (SEARCH below), so a reply takes a few seconds
   at most. estimate() is the board's "who owns what" guess for the
   territory overlay, and says how it is made.
   ============================================================ */
export const N = 9, AREA = N * N, KOMI = 7.5;
export const SIZES = [9, 13, 19];
export const PASS = -1, RESUME = -3, DEAD = 100;
export const deadBase = n => (n === 9 ? DEAD : 1000);
export const sizeOk = n => SIZES.includes(n);
const LETTERS = 'ABCDEFGHJKLMNOPQRST';      /* Go's letters: no I */

export const LEVELS = {
  1: { name: 'Easy', playouts: 0, careful: 0.45 },
  2: { name: 'Medium', playouts: 500, timeMs: 1500 },
  3: { name: 'Hard', playouts: 2600, timeMs: 3200 },
};
/* the bigger boards: a playout there is several times longer, so the
   time limit is what stops the search (see the think-time note in ./go.js) */
export const SEARCH = {
  13: { 2: { playouts: 1200, timeMs: 1500 }, 3: { playouts: 6000, timeMs: 3000 } },
  19: { 2: { playouts: 1200, timeMs: 1500 }, 3: { playouts: 6000, timeMs: 3000 } },
};

function geometry(n) {
  const area = n * n, nb = [], diag = [];
  for (let i = 0; i < area; i++) {
    const r = (i / n) | 0, c = i % n, a = [], d = [];
    if (r > 0) a.push(i - n);
    if (r < n - 1) a.push(i + n);
    if (c > 0) a.push(i - 1);
    if (c < n - 1) a.push(i + 1);
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) d.push(rr * n + cc);
    }
    nb.push(a); diag.push(d);
  }
  return { n, area, nb, diag };
}
const GEO = {};
for (const n of SIZES) GEO[n * n] = geometry(n);
const geo = b => GEO[b.length] || GEO[AREA];
/** the board size of a game or a board */
export const sizeOf = x => geo(x && x.b ? x.b : x).n;
export const neighbours = (i, n = N) => GEO[n * n].nb[i];
export const colName = c => LETTERS[c];
export const pointName = (i, n = N) => `${LETTERS[i % n]}${n - ((i / n) | 0)}`;
/** the star points (hoshi) drawn on the board */
export function hoshi(n = N) {
  const k = n === 9 ? [2, 6] : n === 13 ? [3, 9] : [3, 9, 15];
  const out = [];
  for (const r of k) for (const c of k) out.push(r * n + c);
  if (n !== 19) out.push((n * n - 1) / 2);
  return out;
}

export function newGame(n = N) {
  const sz = sizeOk(n) ? n : N, area = sz * sz;
  return {
    n: sz, b: new Int8Array(area), turn: 1, ko: -1, passes: 0, dones: 0, phase: 'play',
    dead: new Uint8Array(area), moves: [], caps: [0, 0], snaps: [], last: -1, result: null,
  };
}
const snapOf = g => ({
  b: g.b.slice(), turn: g.turn, ko: g.ko, passes: g.passes, dones: g.dones, phase: g.phase,
  dead: g.dead.slice(), caps: g.caps.slice(), last: g.last, result: g.result,
});
export function copy(g) {
  return { ...g, b: g.b.slice(), dead: g.dead.slice(), moves: g.moves.slice(), caps: g.caps.slice(), snaps: [] };
}

/* scratch marks for groupAt (one board at a time, never re-entered): a fresh stamp per call instead of two new arrays */
const MARK = new Int32Array(361), LMARK = new Int32Array(361);
let STAMP = 0;
/** the group holding the stone at i: { stones, libs } (libs = number of distinct empty neighbours) */
export function groupAt(b, i) {
  const NB = geo(b).nb;
  if (STAMP > 2e9) { MARK.fill(0); LMARK.fill(0); STAMP = 0; }
  const s = ++STAMP, col = b[i], stones = [i];
  MARK[i] = s;
  let libs = 0;
  for (let k = 0; k < stones.length; k++) {
    for (const n of NB[stones[k]]) {
      if (b[n] === 0) { if (LMARK[n] !== s) { LMARK[n] = s; libs++; } }
      else if (b[n] === col && MARK[n] !== s) { MARK[n] = s; stones.push(n); }
    }
  }
  return { stones, libs };
}
const emptyNext = (b, NB, i) => { let e = 0; for (const n of NB[i]) if (b[n] === 0) e++; return e; };

/** try a stone for `col` at i on board b (mutates b if it is legal): { ok, captured: [] } */
function place(b, i, col, ko) {
  if (b[i] !== 0 || i === ko) return null;
  const NB = geo(b).nb;
  b[i] = col;
  const captured = [];
  for (const n of NB[i]) {
    if (b[n] === -col) {
      const gr = groupAt(b, n);
      if (gr.libs === 0) for (const s of gr.stones) if (b[s] !== 0) { b[s] = 0; captured.push(s); }
    }
  }
  if (!emptyNext(b, NB, i) && groupAt(b, i).libs === 0) {   /* suicide: put everything back */
    b[i] = 0;
    for (const s of captured) b[s] = -col;
    return null;
  }
  return captured;
}

/** is move m legal for the side to move right now? */
export function legal(g, m) {
  if (!Number.isInteger(m) || g.phase === 'over') return false;
  const area = g.b.length;
  if (g.phase === 'play') {
    if (m === PASS) return true;
    if (m < 0 || m >= area) return false;
    if (g.b[m] !== 0 || m === g.ko) return false;
    const t = g.b.slice();
    return place(t, m, g.turn, g.ko) !== null;
  }
  /* scoring */
  if (m === PASS || m === RESUME) return true;
  const D = deadBase(sizeOf(g));
  return m >= D && m < D + area && g.b[m - D] !== 0;
}

/** play move m (legal or not): returns false and changes nothing when it is not legal */
export function play(g, m) {
  if (!legal(g, m)) return false;
  g.snaps.push(snapOf(g));
  g.moves.push(m);
  const me = g.turn;
  if (g.phase === 'play') {
    if (m === PASS) {
      g.passes++;
      g.ko = -1;
      g.last = -1;
      g.turn = -me;
      if (g.passes >= 2) { g.phase = 'score'; g.dones = 0; g.dead.fill(0); }
      return true;
    }
    const cap = place(g.b, m, me, g.ko);
    g.passes = 0;
    g.caps[me === 1 ? 0 : 1] += cap.length;
    /* simple ko: one stone took one stone and now sits alone with one liberty */
    g.ko = -1;
    if (cap.length === 1) { const gr = groupAt(g.b, m); if (gr.stones.length === 1 && gr.libs === 1) g.ko = cap[0]; }
    g.last = m;
    g.turn = -me;
    return true;
  }
  /* scoring */
  if (m === PASS) {
    g.dones++;
    g.turn = -me;
    if (g.dones >= 2) { g.phase = 'over'; g.result = score(g); }
  } else if (m === RESUME) {
    g.phase = 'play'; g.passes = 0; g.dones = 0; g.dead.fill(0); g.ko = -1; g.turn = -me;
  } else {
    const i = m - deadBase(sizeOf(g)), mark = g.dead[i] ? 0 : 1;
    for (const s of groupAt(g.b, i).stones) g.dead[s] = mark;
    g.dones = 0;
  }
  return true;
}
export function undo(g) {
  const s = g.snaps.pop();
  if (!s) return false;
  g.moves.pop();
  g.b = s.b; g.turn = s.turn; g.ko = s.ko; g.passes = s.passes; g.dones = s.dones; g.phase = s.phase;
  g.dead = s.dead; g.caps = s.caps; g.last = s.last; g.result = s.result;
  return true;
}

/** mark the groups at `cells` (a stone on each) dead, replacing the marks (used for the computer's judgement) */
export function setDead(g, cells) {
  g.dead.fill(0);
  for (const i of cells) if (g.b[i]) for (const s of groupAt(g.b, i).stones) g.dead[s] = 1;
}

/**
 * Area score with the dead stones taken off:
 *   { black, white, komi, margin, winner, owner, stones: { black, white }, territory: { black, white } }
 * black / white are living stones + the empty points only that side surrounds
 * (the dead stones' points count as empty); owner: 1 / -1 / 0 per point.
 */
export function score(g) {
  const b = g.b, dead = g.dead, area = b.length, NB = geo(b).nb;
  const live = i => (b[i] !== 0 && !dead[i] ? b[i] : 0);
  const owner = new Int8Array(area), seen = new Uint8Array(area);
  let black = 0, white = 0, bs = 0, ws = 0;
  for (let i = 0; i < area; i++) {
    const v = live(i);
    if (v) { owner[i] = v; if (v === 1) { black++; bs++; } else { white++; ws++; } continue; }
    if (seen[i]) continue;
    const region = [i];
    seen[i] = 1;
    let touchB = false, touchW = false;
    for (let k = 0; k < region.length; k++) {
      for (const n of NB[region[k]]) {
        const lv = live(n);
        if (lv === 1) touchB = true;
        else if (lv === -1) touchW = true;
        else if (!seen[n]) { seen[n] = 1; region.push(n); }
      }
    }
    const who = touchB && !touchW ? 1 : touchW && !touchB ? -1 : 0;
    for (const s of region) owner[s] = who;
    if (who === 1) black += region.length; else if (who === -1) white += region.length;
  }
  const margin = black - (white + KOMI);
  return {
    black, white, komi: KOMI, margin, winner: margin > 0 ? 1 : -1, owner,
    stones: { black: bs, white: ws }, territory: { black: black - bs, white: white - ws },
  };
}

/**
 * The territory overlay's guess, during play: each empty point goes to the
 * side whose stones are nearer, counting steps along the lines through empty
 * points (stones block the way), up to `reach` steps; a tie, or nothing that
 * near, leaves it unmarked. Every stone counts as alive. A rough guide, not
 * the score: -> { owner: Int8Array (1 / -1 / 0 for empty points), black, white }
 */
export function estimate(g, reach = 4) {
  const b = g.b, area = b.length, NB = geo(b).nb;
  const far = reach + 1;
  const dist = col => {
    const d = new Uint8Array(area).fill(far), q = [];
    for (let i = 0; i < area; i++) if (b[i] === col) { d[i] = 0; q.push(i); }
    for (let k = 0; k < q.length; k++) {
      const i = q[k], nd = d[i] + 1;
      if (nd > reach) continue;
      for (const n of NB[i]) if (b[n] === 0 && d[n] > nd) { d[n] = nd; q.push(n); }
    }
    return d;
  };
  const db = dist(1), dw = dist(-1), owner = new Int8Array(area);
  let black = 0, white = 0;
  for (let i = 0; i < area; i++) {
    if (b[i] !== 0) continue;
    if (db[i] < dw[i] && db[i] <= reach) { owner[i] = 1; black++; }
    else if (dw[i] < db[i] && dw[i] <= reach) { owner[i] = -1; white++; }
  }
  return { owner, black, white, reach };
}

/* ------------------------------ the computer ------------------------------ */
const ownEye = (b, i, col) => {
  const { nb, diag } = geo(b);
  for (const n of nb[i]) if (b[n] !== col) return false;
  let bad = 0;
  for (const d of diag[i]) if (b[d] !== col) bad++;
  return nb[i].length < 4 ? bad === 0 : bad < 2;
};

/** sensible candidate moves for `col`: legal, not filling its own eye */
export function candidates(g, col = g.turn) {
  const out = [], area = g.b.length;
  for (let i = 0; i < area; i++) {
    if (g.b[i] !== 0 || i === g.ko || ownEye(g.b, i, col)) continue;
    const t = g.b.slice();
    if (place(t, i, col, g.ko) !== null) out.push(i);
  }
  return out;
}
/* on the bigger boards, the points worth searching: within two of a stone,
   or on the 3rd and 4th lines while the board is still open */
function nearStones(g, cands) {
  const n = sizeOf(g), b = g.b, stones = [];
  for (let i = 0; i < b.length; i++) if (b[i]) stones.push(i);
  const early = stones.length < n;
  const line = v => Math.min(v, n - 1 - v);
  const out = cands.filter(i => {
    const r = (i / n) | 0, c = i % n;
    if (early && (line(r) === 2 || line(r) === 3) && (line(c) === 2 || line(c) === 3)) return true;
    for (const s of stones) if (Math.abs(((s / n) | 0) - r) <= 2 && Math.abs((s % n) - c) <= 2) return true;
    return false;
  });
  return out.length >= 6 ? out : cands;
}

/* like place(), but a stone that would sit in atari (one liberty) without capturing anything is refused: random playouts
   then do not throw stones away inside the other side's area, so their final boards say who really owns what */
function placeSafe(b, i, col, ko) {
  const cap = place(b, i, col, ko);
  if (cap === null) return null;
  if (cap.length === 0 && emptyNext(b, geo(b).nb, i) < 2 && groupAt(b, i).libs < 2) { b[i] = 0; return null; }
  return cap;
}

/* play board b out at random from colour `col` (mutates b): each turn a random empty point that is not
   the ko point, not the mover's own eye and not a stone thrown into atari; no such point is a pass. The
   empty points are kept in a list as stones come and go, so a turn does not scan the whole board. */
function runOut(b, col, ko, rnd, passes) {
  const area = b.length, E = new Int16Array(area), at = new Int16Array(area).fill(-1);
  let ne = 0;
  for (let i = 0; i < area; i++) if (b[i] === 0) { at[i] = ne; E[ne++] = i; }
  const steps = Math.round(area * 1.85);
  for (let step = 0; step < steps && passes < 2; step++) {
    let moved = false;
    for (let k = 0; k < ne; k++) {
      const j = k + ((rnd() * (ne - k)) | 0), i = E[j];
      E[j] = E[k]; at[E[j]] = j; E[k] = i; at[i] = k;
      if (i === ko || ownEye(b, i, col)) continue;
      const cap = placeSafe(b, i, col, ko);
      if (cap === null) continue;
      const last = E[--ne]; E[k] = last; at[last] = k; at[i] = -1;
      for (const s of cap) { at[s] = ne; E[ne++] = s; }
      ko = -1;
      if (cap.length === 1) { const gr = groupAt(b, i); if (gr.stones.length === 1 && gr.libs === 1) ko = cap[0]; }
      moved = true;
      break;
    }
    if (moved) passes = 0; else { passes++; ko = -1; }
    col = -col;
  }
  return b;
}
/* a quick random playout from b (colour `col` to move); returns the area-score margin for Black */
function playout(b0, col, ko0, rnd, lastPassed) {
  return tally(runOut(b0.slice(), col, ko0, rnd, lastPassed ? 1 : 0));
}
/* area margin for Black on a finished board with nothing marked dead (stones + single-owner empties) */
function tally(b) {
  const own = ownersOf(b);
  let s = 0;
  for (let i = 0; i < own.length; i++) s += own[i];
  return s - KOMI;
}
export function rngOf(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* the plain tactics a few random playouts per point can miss: for each candidate, the stones it would
   capture plus the stones of its own groups in atari it would give a second liberty. -> Map point -> stones */
function tactics(g, col, cands) {
  const b = g.b, NB = geo(b).nb, out = new Map(), rescue = new Map(), seen = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== col || seen[i]) continue;
    const gr = groupAt(b, i);
    for (const s of gr.stones) seen[s] = 1;
    if (gr.libs !== 1) continue;
    let lib = -1;
    for (const s of gr.stones) for (const n of NB[s]) if (b[n] === 0) lib = n;
    rescue.set(lib, (rescue.get(lib) || 0) + gr.stones.length);
  }
  for (const i of cands) {
    const t = b.slice();
    const cap = place(t, i, col, g.ko);
    if (cap === null) continue;
    let k = cap.length;
    if (rescue.has(i) && groupAt(t, i).libs >= 2) k += rescue.get(i);
    if (k) out.set(i, k);
  }
  return out;
}

/** captures available to `col` right now: { point: stones taken } */
function capturing(g, col, cands) {
  const best = [];
  for (const i of cands) {
    const t = g.b.slice();
    const cap = place(t, i, col, g.ko);
    if (cap && cap.length) best.push([i, cap.length]);
  }
  return best;
}

/**
 * Choose a move for the side to move: { move, ... }. `move` is a point or PASS.
 * opts: level, playouts (override), timeMs, rnd (a () => [0,1) for tests).
 */
export function think(g, opts = {}) {
  const lv = LEVELS[opts.level] || LEVELS[2];
  const n = sizeOf(g), area = g.b.length;
  const big = SEARCH[n]?.[opts.level] || SEARCH[n]?.[2] || null;
  const rnd = opts.rnd || Math.random;
  const me = g.turn;
  const all = candidates(g, me);
  const lastPassed = g.moves.length > 0 && g.moves[g.moves.length - 1] === PASS;
  const t0 = Date.now();
  if (!all.length) return { move: PASS, playouts: 0 };
  const cands = n > N ? nearStones(g, all) : all;
  const total = opts.playouts ?? (lv.playouts && big ? big.playouts : lv.playouts);
  if (!total) {
    /* Easy: now and then take a capture it can see, else any sensible move; passes only when the other side did and it is ahead */
    if (lastPassed && g.moves.length > Math.floor(area / 8)) {
      if ((tally(g.b) > 0 ? 1 : -1) === me) return { move: PASS, playouts: 0 };
    }
    const caps = capturing(g, me, all);
    if (caps.length && rnd() < (lv.careful ?? 0.4)) { caps.sort((a, c) => c[1] - a[1]); return { move: caps[0][0], playouts: 0 }; }
    return { move: cands[(rnd() * cands.length) | 0], playouts: 0 };
  }
  /* flat Monte Carlo over the candidates (and pass, once the game is well along). A move that captures
     or rescues stones starts with a few virtual wins (4 per stone, up to 8 stones), which real playouts
     can still overrule: a nudge toward the obvious, not a rule. */
  const nudge = tactics(g, me, cands);
  const arms = cands.map(i => { const k = 4 * Math.min(8, nudge.get(i) || 0); return { m: i, n: k, w: k }; });
  if (g.moves.length >= Math.round(area * 0.3) || lastPassed) arms.push({ m: PASS, n: 0, w: 0 });
  const limit = opts.timeMs ?? (big ? big.timeMs : lv.timeMs) ?? 2000;
  let done = 0;
  while (done < total) {
    let arm, bestU = -Infinity;
    for (const a of arms) {
      const u = a.n === 0 ? Infinity : a.w / a.n + 0.55 * Math.sqrt(Math.log(done + 1) / a.n);
      if (u > bestU) { bestU = u; arm = a; }
    }
    let margin;
    if (arm.m === PASS) {
      margin = lastPassed ? tally(g.b) : playout(g.b, -me, -1, rnd, true);
    } else {
      const t = g.b.slice();
      const cap = place(t, arm.m, me, g.ko);
      let ko = -1;
      if (cap.length === 1) { const gr = groupAt(t, arm.m); if (gr.stones.length === 1 && gr.libs === 1) ko = cap[0]; }
      margin = playout(t, -me, ko, rnd, false);
    }
    arm.n++;
    if ((margin > 0 ? 1 : -1) === me) arm.w++;
    done++;
    if ((done & 31) === 0 && Date.now() - t0 > limit) break;
  }
  const rate = a => (a.n ? a.w / a.n : 0);
  let best = null;
  for (const a of arms) if (a.m !== PASS && (!best || a.n > best.n || (a.n === best.n && rate(a) > rate(best)))) best = a;
  const pass = arms.find(a => a.m === PASS);
  if (pass && pass.n >= 8 && rate(pass) >= rate(best) - 0.02 && (rate(pass) > 0.6)) best = pass;
  return { move: best.m, playouts: done, rate: rate(best), ms: Date.now() - t0 };
}

/**
 * The computer's judgement of which stones are dead on a finished board:
 * random playouts, and a stone whose point ends up in the other side's
 * hands in most of them is dead. Returns an array of points holding dead stones.
 * opts: playouts (320 on 9 × 9, fewer on the bigger boards), timeMs, rnd.
 */
export function judgeDead(g, opts = {}) {
  const rnd = opts.rnd || Math.random;
  const area = g.b.length;
  const n = opts.playouts ?? (area === AREA ? 320 : 200);
  const limit = opts.timeMs ?? 2500;
  const t0 = Date.now();
  const sum = new Int16Array(area);
  let done = 0;
  for (let k = 0; k < n; k++) {
    const own = ownersOf(runOut(g.b.slice(), g.turn, -1, rnd, 0));
    for (let i = 0; i < area; i++) sum[i] += own[i];
    done++;
    if ((done & 15) === 0 && Date.now() - t0 > limit) break;
  }
  const dead = new Set();
  for (let i = 0; i < area; i++) {
    if (!g.b[i]) continue;
    /* sum is the owners added up over the playouts: a stone is dead when most playouts end up with the other colour there */
    if (sum[i] * g.b[i] < -0.3 * done) for (const s of groupAt(g.b, i).stones) dead.add(s);
  }
  return [...dead];
}
function ownersOf(b) {
  const area = b.length, NB = geo(b).nb;
  const out = new Int8Array(area), seen = new Uint8Array(area);
  for (let i = 0; i < area; i++) {
    if (b[i]) { out[i] = b[i]; continue; }
    if (seen[i]) continue;
    const region = [i];
    seen[i] = 1;
    let tb = false, tw = false;
    for (let k = 0; k < region.length; k++) for (const n of NB[region[k]]) {
      if (b[n] === 1) tb = true; else if (b[n] === -1) tw = true; else if (!seen[n]) { seen[n] = 1; region.push(n); }
    }
    const who = tb && !tw ? 1 : tw && !tb ? -1 : 0;
    for (const s of region) out[s] = who;
  }
  return out;
}

/** build a game from a move list (for the worker, and for tests) */
export function fromMoves(list, n = N) {
  const g = newGame(n);
  for (const m of list) if (!play(g, m)) break;
  return g;
}
/** a game that starts from a given position ({ b: [n²], turn, ko, passes }) and then replays `list` */
export function fromBase(base, list = []) {
  const len = base?.b?.length;
  const g = newGame(SIZES.find(s => s * s === len) || N);
  if (len === g.b.length) g.b = Int8Array.from(base.b);
  g.turn = base.turn === -1 ? -1 : 1; g.ko = Number.isInteger(base.ko) ? base.ko : -1; g.passes = base.passes | 0;
  for (const m of list) if (!play(g, m)) break;
  return g;
}
/** build a position from rows of '.', 'x' (Black), 'o' (White): n strings of n (9, 13 or 19) */
export function fromRows(rows, turn = 1) {
  const g = newGame(sizeOk(rows.length) ? rows.length : N);
  const n = g.n;
  rows.slice(0, n).forEach((row, r) => [...row].slice(0, n).forEach((ch, c) => { g.b[r * n + c] = ch === 'x' ? 1 : ch === 'o' ? -1 : 0; }));
  g.turn = turn;
  return g;
}
