/* ============================================================
   arcade/go-rules.js — Go on a 9 × 9 board: the rules and the
   computer player. Pure (no DOM), shared by the game (./go.js),
   the thinking worker (./think.js) and the tests.

   THE RULES CHOSEN (the game says the same):
   · 9 × 9, Black moves first. A stone with no empty neighbour
     (a "liberty") left, and every stone joined to it, is captured.
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
     White gets a komi of 7.5, so there are no draws.

   MOVES are integers: 0..80 a point (row * 9 + col, row 0 on top),
   PASS (-1, which is also "Done" while scoring), RESUME (-3, play
   on) and DEAD + point (100 + point, toggle the group there as
   dead or alive while scoring). Black is 1, White is -1.

   THE COMPUTER: Easy plays quick-and-careless (a random sensible
   move, capturing when it sees one about half the time). Medium and
   Hard run random playouts from each candidate move (a flat Monte
   Carlo with UCB1) — Hard plays many more, so it plays better.
   Neither ever fills its own eyes or makes an illegal move.
   ============================================================ */
export const N = 9, AREA = N * N, KOMI = 7.5;
export const PASS = -1, RESUME = -3, DEAD = 100;

export const LEVELS = {
  1: { name: 'Easy', playouts: 0, careful: 0.45 },
  2: { name: 'Medium', playouts: 500, timeMs: 1500 },
  3: { name: 'Hard', playouts: 2600, timeMs: 3200 },
};

const NB = (() => {
  const out = [];
  for (let i = 0; i < AREA; i++) {
    const r = (i / N) | 0, c = i % N, n = [];
    if (r > 0) n.push(i - N);
    if (r < N - 1) n.push(i + N);
    if (c > 0) n.push(i - 1);
    if (c < N - 1) n.push(i + 1);
    out.push(n);
  }
  return out;
})();
const DIAG = (() => {
  const out = [];
  for (let i = 0; i < AREA; i++) {
    const r = (i / N) | 0, c = i % N, d = [];
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) d.push(rr * N + cc);
    }
    out.push(d);
  }
  return out;
})();
export const neighbours = i => NB[i];
export const pointName = i => `${'ABCDEFGHJ'[i % N]}${N - ((i / N) | 0)}`;

export function newGame() {
  return {
    b: new Int8Array(AREA), turn: 1, ko: -1, passes: 0, dones: 0, phase: 'play',
    dead: new Uint8Array(AREA), moves: [], caps: [0, 0], snaps: [], last: -1, result: null,
  };
}
const snapOf = g => ({
  b: g.b.slice(), turn: g.turn, ko: g.ko, passes: g.passes, dones: g.dones, phase: g.phase,
  dead: g.dead.slice(), caps: g.caps.slice(), last: g.last, result: g.result,
});
export function copy(g) {
  return { ...g, b: g.b.slice(), dead: g.dead.slice(), moves: g.moves.slice(), caps: g.caps.slice(), snaps: [] };
}

/** the group holding the stone at i: { stones, libs } (libs = number of distinct empty neighbours) */
export function groupAt(b, i) {
  const col = b[i], stones = [i], seen = new Uint8Array(AREA), libSeen = new Uint8Array(AREA);
  seen[i] = 1;
  let libs = 0;
  for (let k = 0; k < stones.length; k++) {
    for (const n of NB[stones[k]]) {
      if (b[n] === 0) { if (!libSeen[n]) { libSeen[n] = 1; libs++; } }
      else if (b[n] === col && !seen[n]) { seen[n] = 1; stones.push(n); }
    }
  }
  return { stones, libs };
}

/** try a stone for `col` at i on board b (mutates b if it is legal): { ok, captured: [] } */
function place(b, i, col, ko) {
  if (b[i] !== 0 || i === ko) return null;
  b[i] = col;
  const captured = [];
  for (const n of NB[i]) {
    if (b[n] === -col) {
      const gr = groupAt(b, n);
      if (gr.libs === 0) for (const s of gr.stones) if (b[s] !== 0) { b[s] = 0; captured.push(s); }
    }
  }
  if (groupAt(b, i).libs === 0) {            /* suicide: put everything back */
    b[i] = 0;
    for (const s of captured) b[s] = -col;
    return null;
  }
  return captured;
}

/** is move m legal for the side to move right now? */
export function legal(g, m) {
  if (!Number.isInteger(m) || g.phase === 'over') return false;
  if (g.phase === 'play') {
    if (m === PASS) return true;
    if (m < 0 || m >= AREA) return false;
    if (g.b[m] !== 0 || m === g.ko) return false;
    const t = g.b.slice();
    return place(t, m, g.turn, g.ko) !== null;
  }
  /* scoring */
  if (m === PASS || m === RESUME) return true;
  return m >= DEAD && m < DEAD + AREA && g.b[m - DEAD] !== 0;
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
    const i = m - DEAD, mark = g.dead[i] ? 0 : 1;
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

/** Area score with the dead stones taken off: { black, white, komi, margin, winner, owner } (owner: 1 / -1 / 0 per point) */
export function score(g) {
  const b = g.b, dead = g.dead;
  const live = i => (b[i] !== 0 && !dead[i] ? b[i] : 0);
  const owner = new Int8Array(AREA), seen = new Uint8Array(AREA);
  let black = 0, white = 0;
  for (let i = 0; i < AREA; i++) {
    const v = live(i);
    if (v) { owner[i] = v; if (v === 1) black++; else white++; continue; }
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
  return { black, white, komi: KOMI, margin, winner: margin > 0 ? 1 : -1, owner };
}

/* ------------------------------ the computer ------------------------------ */
const ownEye = (b, i, col) => {
  for (const n of NB[i]) if (b[n] !== col) return false;
  let bad = 0;
  for (const d of DIAG[i]) if (b[d] !== col) bad++;
  return NB[i].length < 4 ? bad === 0 : bad < 2;
};

/** sensible candidate moves for `col`: legal, not filling its own eye */
export function candidates(g, col = g.turn) {
  const out = [];
  for (let i = 0; i < AREA; i++) {
    if (g.b[i] !== 0 || i === g.ko || ownEye(g.b, i, col)) continue;
    const t = g.b.slice();
    if (place(t, i, col, g.ko) !== null) out.push(i);
  }
  return out;
}

/* like place(), but a stone that would sit in atari (one liberty) without capturing anything is refused: random playouts
   then do not throw stones away inside the other side's area, so their final boards say who really owns what */
function placeSafe(b, i, col, ko) {
  const cap = place(b, i, col, ko);
  if (cap === null) return null;
  if (cap.length === 0 && groupAt(b, i).libs < 2) { b[i] = 0; return null; }
  return cap;
}

/* a quick random playout from b (colour `col` to move); returns the area-score margin for Black */
function playout(b0, col, ko0, rnd, lastPassed) {
  const b = b0.slice();
  let ko = ko0, passes = lastPassed ? 1 : 0;
  for (let step = 0; step < 150 && passes < 2; step++) {
    const empties = [];
    for (let i = 0; i < AREA; i++) if (b[i] === 0 && i !== ko && !ownEye(b, i, col)) empties.push(i);
    let moved = false;
    while (empties.length) {
      const k = (rnd() * empties.length) | 0, i = empties[k];
      empties[k] = empties[empties.length - 1];
      empties.pop();
      const cap = placeSafe(b, i, col, ko);
      if (cap !== null) {
        ko = -1;
        if (cap.length === 1) { const gr = groupAt(b, i); if (gr.stones.length === 1 && gr.libs === 1) ko = cap[0]; }
        moved = true;
        break;
      }
    }
    if (moved) passes = 0; else { passes++; ko = -1; }
    col = -col;
  }
  return tally(b);
}
/* area margin for Black on a finished board with nothing marked dead (stones + single-owner empties) */
function tally(b) {
  let black = 0, white = 0;
  const seen = new Uint8Array(AREA);
  for (let i = 0; i < AREA; i++) {
    if (b[i] === 1) { black++; continue; }
    if (b[i] === -1) { white++; continue; }
    if (seen[i]) continue;
    const region = [i];
    seen[i] = 1;
    let tb = false, tw = false;
    for (let k = 0; k < region.length; k++) for (const n of NB[region[k]]) {
      if (b[n] === 1) tb = true; else if (b[n] === -1) tw = true; else if (!seen[n]) { seen[n] = 1; region.push(n); }
    }
    if (tb && !tw) black += region.length; else if (tw && !tb) white += region.length;
  }
  return black - white - KOMI;
}
export function rngOf(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** captures available to `col` right now: { point: stones taken } */
function capturing(g, col) {
  const best = [];
  for (const i of candidates(g, col)) {
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
  const rnd = opts.rnd || Math.random;
  const me = g.turn;
  const cands = candidates(g, me);
  const lastPassed = g.moves.length > 0 && g.moves[g.moves.length - 1] === PASS;
  const t0 = Date.now();
  if (!cands.length) return { move: PASS, playouts: 0 };
  const total = opts.playouts ?? lv.playouts;
  if (!total) {
    /* Easy: now and then take a capture it can see, else any sensible move; passes only when the other side did and it is ahead */
    if (lastPassed && g.moves.length > 10) {
      const t = g.b.slice();
      if ((tally(t) > 0 ? 1 : -1) === me) return { move: PASS, playouts: 0 };
    }
    const caps = capturing(g, me);
    if (caps.length && rnd() < (lv.careful ?? 0.4)) { caps.sort((a, c) => c[1] - a[1]); return { move: caps[0][0], playouts: 0 }; }
    return { move: cands[(rnd() * cands.length) | 0], playouts: 0 };
  }
  /* flat Monte Carlo over the candidates (and pass, once the game is well along) */
  const arms = cands.map(i => ({ m: i, n: 0, w: 0 }));
  if (g.moves.length >= 24 || lastPassed) arms.push({ m: PASS, n: 0, w: 0 });
  const limit = opts.timeMs ?? lv.timeMs ?? 2000;
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
 */
export function judgeDead(g, opts = {}) {
  const rnd = opts.rnd || Math.random;
  const n = opts.playouts ?? 320;
  const tally2 = new Int16Array(AREA);
  for (let k = 0; k < n; k++) {
    const b = g.b.slice();
    let col = g.turn, ko = -1, passes = 0;
    for (let step = 0; step < 150 && passes < 2; step++) {
      const empties = [];
      for (let i = 0; i < AREA; i++) if (b[i] === 0 && i !== ko && !ownEye(b, i, col)) empties.push(i);
      let moved = false;
      while (empties.length) {
        const q = (rnd() * empties.length) | 0, i = empties[q];
        empties[q] = empties[empties.length - 1]; empties.pop();
        const cap = placeSafe(b, i, col, ko);
        if (cap !== null) { ko = -1; if (cap.length === 1) { const gr = groupAt(b, i); if (gr.stones.length === 1 && gr.libs === 1) ko = cap[0]; } moved = true; break; }
      }
      if (moved) passes = 0; else { passes++; ko = -1; }
      col = -col;
    }
    const own = ownersOf(b);
    for (let i = 0; i < AREA; i++) tally2[i] += own[i];
  }
  const dead = new Set();
  for (let i = 0; i < AREA; i++) {
    if (!g.b[i]) continue;
    /* tally2 is the sum of owners over the playouts: a stone is dead when most playouts end up with the other colour there */
    if (tally2[i] * g.b[i] < -0.3 * n) for (const s of groupAt(g.b, i).stones) dead.add(s);
  }
  return [...dead];
}
function ownersOf(b) {
  const out = new Int8Array(AREA), seen = new Uint8Array(AREA);
  for (let i = 0; i < AREA; i++) {
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
export function fromMoves(list) {
  const g = newGame();
  for (const m of list) if (!play(g, m)) break;
  return g;
}
/** a game that starts from a given position ({ b: [81], turn, ko, passes }) and then replays `list` */
export function fromBase(base, list = []) {
  const g = newGame();
  g.b = Int8Array.from(base.b); g.turn = base.turn === -1 ? -1 : 1; g.ko = Number.isInteger(base.ko) ? base.ko : -1; g.passes = base.passes | 0;
  for (const m of list) if (!play(g, m)) break;
  return g;
}
/** build a position from rows of '.', 'x' (Black), 'o' (White): 9 strings of 9 */
export function fromRows(rows, turn = 1) {
  const g = newGame();
  rows.forEach((row, r) => [...row].forEach((ch, c) => { g.b[r * N + c] = ch === 'x' ? 1 : ch === 'o' ? -1 : 0; }));
  g.turn = turn;
  return g;
}
