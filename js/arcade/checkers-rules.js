/* ============================================================
   arcade/checkers-rules.js — American checkers (English draughts):
   the rules and the computer player.

   Pure (no DOM), shared by the game (./checkers.js), the thinking
   worker (./think.js) and the play-tests. 8 × 8, b[row * 8 + col],
   row 0 at the bottom of the first player's view; only squares with
   (row + col) even are used. 1 = Red's man, 2 = Red's king (Red moves
   first and up), -1 / -2 = Cream's man and king (down).

   · A man steps one square diagonally forward; a king one square in
     any diagonal direction.
   · Capturing is forced: if any jump exists, you must jump. A jump
     goes over an adjacent enemy piece to the empty square behind it.
     After a jump the same piece must keep jumping while it can, and a
     piece cannot be jumped twice in one turn. You may choose which
     chain to take (the longest is not forced).
   · A man that reaches the far row becomes a king, and its turn ends
     there, even if a jump would otherwise go on.
   · No legal move (no pieces, or all blocked) loses.
   · Draw: 40 moves by each side (80 plies in a row) without a capture.

   A move is { path: [from, to, ...], caps: [squares] }: one entry in
   path per landing square. g.moves holds the paths.
   ============================================================ */
export const QUIET_LIMIT = 80;
export const LEVELS = {
  1: { name: 'Easy', depth: 2, timeMs: 200, noise: 1 },
  2: { name: 'Medium', depth: 6, timeMs: 600, noise: 0 },
  3: { name: 'Hard', depth: 12, timeMs: 1200, noise: 0 },
};
export const dark = (r, c) => ((r + c) & 1) === 0;
export const sq = (r, c) => r * 8 + c;
export const name = i => 'abcdefgh'[i & 7] + ((i >> 3) + 1);

export function newGame() {
  const b = new Int8Array(64);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (!dark(r, c)) continue;
    if (r < 3) b[sq(r, c)] = 1; else if (r > 4) b[sq(r, c)] = -1;
  }
  return { b, turn: 1, moves: [], quiet: 0, hist: [] };
}
/** rows from the top (row 7) down: 'r' red man, 'R' red king, 'c' cream man, 'C' cream king, '.' empty */
export function fromRows(rows, turn = 1, quiet = 0) {
  const b = new Int8Array(64);
  const map = { r: 1, R: 2, c: -1, C: -2 };
  rows.forEach((line, i) => [...line.replace(/\s/g, '')].forEach((ch, c) => { b[sq(7 - i, c)] = map[ch] || 0; }));
  return { b, turn, moves: [], quiet, hist: [] };
}
export const toRows = b => Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, c) => ({ 1: 'r', 2: 'R', '-1': 'c', '-2': 'C' })[b[sq(7 - i, c)]] || '.').join(''));

const sideOf = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const isKing = v => v === 2 || v === -2;
const fwd = (v, dr) => isKing(v) || (v > 0 ? dr > 0 : dr < 0);
const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const crowns = (v, r) => (v === 1 && r === 7) || (v === -1 && r === 0);

function chains(b, from, v, caps, out, path) {
  let any = false;
  const r0 = from >> 3, c0 = from & 7;
  for (const [dr, dc] of DIAG) {
    if (!fwd(v, dr)) continue;
    const mr = r0 + dr, mc = c0 + dc, lr = r0 + 2 * dr, lc = c0 + 2 * dc;
    if (!inb(lr, lc)) continue;
    const mid = sq(mr, mc), land = sq(lr, lc);
    if (sideOf(b[mid]) !== -sideOf(v) || caps.includes(mid) || b[land] !== 0) continue;
    any = true;
    const np = [...path, land], nc = [...caps, mid];
    if (!isKing(v) && crowns(v, lr)) out.push({ path: np, caps: nc });
    else chains(b, land, v, nc, out, np);
  }
  if (!any && path.length > 1) out.push({ path, caps });
}
/** every legal move for `turn`, as whole turns (a multi-jump is one move) */
export function legalMoves(b, turn) {
  const jumps = [], steps = [];
  for (let i = 0; i < 64; i++) {
    const v = b[i];
    if (!v || sideOf(v) !== turn) continue;
    /* lift the piece so its own square counts as empty while it jumps */
    b[i] = 0;
    chains(b, i, v, [], jumps, [i]);
    b[i] = v;
    if (jumps.length) continue;
    const r = i >> 3, c = i & 7;
    for (const [dr, dc] of DIAG) {
      if (!fwd(v, dr) || !inb(r + dr, c + dc)) continue;
      const to = sq(r + dr, c + dc);
      if (b[to] === 0) steps.push({ path: [i, to], caps: [] });
    }
  }
  return jumps.length ? jumps : steps;
}
/* chains() ran with the lifted piece, but a jump list built before an earlier piece's jumps were found
   must not mix with steps: legalMoves returns jumps only once any exist (checked per piece above). */
export function legal(g) { return legalMoves(g.b, g.turn); }
export const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export const findMove = (g, path) => (Array.isArray(path) ? legalMoves(g.b, g.turn).find(m => samePath(m.path, path)) || null : null);

export function apply(g, m) {
  const from = m.path[0], to = m.path[m.path.length - 1];
  const v = g.b[from];
  const caught = m.caps.map(s => g.b[s]);
  g.b[from] = 0;
  for (const s of m.caps) g.b[s] = 0;
  const crowned = !isKing(v) && crowns(v, to >> 3);
  g.b[to] = crowned ? v * 2 : v;
  g.hist.push({ m, v, caught, crowned, quiet: g.quiet });
  g.moves.push(m.path.slice());
  g.quiet = m.caps.length ? 0 : g.quiet + 1;
  g.turn = -g.turn;
}
export function undo(g) {
  const h = g.hist.pop();
  if (!h) return false;
  const m = h.m;
  g.b[m.path[m.path.length - 1]] = 0;
  g.b[m.path[0]] = h.v;
  m.caps.forEach((s, i) => { g.b[s] = h.caught[i]; });
  g.moves.pop();
  g.quiet = h.quiet;
  g.turn = -g.turn;
  return true;
}
export function counts(b) {
  const o = { red: 0, redKings: 0, cream: 0, creamKings: 0 };
  for (let i = 0; i < 64; i++) {
    const v = b[i];
    if (v > 0) { o.red++; if (v === 2) o.redKings++; } else if (v < 0) { o.cream++; if (v === -2) o.creamKings++; }
  }
  return o;
}
export function outcome(g) {
  if (!legalMoves(g.b, g.turn).length) return { over: true, winner: -g.turn, reason: 'blocked' };
  if (g.quiet >= QUIET_LIMIT) return { over: true, winner: 0, reason: 'draw40' };
  return { over: false };
}

/* ------------------------- the computer ------------------------- */
function evaluate(b, me) {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const v = b[i];
    if (!v) continue;
    const r = i >> 3, c = i & 7, side = sideOf(v);
    let x = isKing(v) ? 175 : 100;
    if (!isKing(v)) {
      const adv = side > 0 ? r : 7 - r;
      x += adv * 4;
      if (adv === 0) x += 6;                      /* the back row guards against kings */
    } else if (c > 1 && c < 6 && r > 1 && r < 6) x += 4;
    if (c === 0 || c === 7) x -= 2;
    s += side * x;
  }
  return s * me;
}
export function think(g, opts = {}) {
  const t0 = Date.now();
  const lv = { ...LEVELS[2], ...opts };
  const me = g.turn;
  const b = g.b.slice();
  const root = legalMoves(b, me);
  if (!root.length) return { move: null, score: 0, depth: 0, nodes: 0, ms: 0 };
  if (root.length === 1) return { move: root[0], score: 0, depth: 0, nodes: 0, ms: 0 };
  let nodes = 0, stop = false;
  const deadline = t0 + lv.timeMs;
  const make = (m, v) => {
    const to = m.path[m.path.length - 1];
    const saved = m.caps.map(s => b[s]);
    b[m.path[0]] = 0; for (const s of m.caps) b[s] = 0;
    b[to] = !isKing(v) && crowns(v, to >> 3) ? v * 2 : v;
    return saved;
  };
  const unmake = (m, v, saved) => {
    b[m.path[m.path.length - 1]] = 0; b[m.path[0]] = v;
    m.caps.forEach((s, i) => { b[s] = saved[i]; });
  };
  function search(turn, depth, alpha, beta, ply) {
    if ((++nodes & 511) === 0 && Date.now() > deadline) stop = true;
    if (stop) return 0;
    const mv = legalMoves(b, turn);
    if (!mv.length) return -100000 + ply;
    /* a forced capture does not use up depth (keeps the search from stopping mid-exchange) */
    if (depth <= 0 && !mv[0].caps.length) return evaluate(b, turn);
    if (ply > 40) return evaluate(b, turn);
    mv.sort((x, y) => y.caps.length - x.caps.length);
    let best = -Infinity;
    for (const m of mv) {
      const v = b[m.path[0]];
      const sv = make(m, v);
      const val = -search(-turn, depth - 1, -beta, -alpha, ply + 1);
      unmake(m, v, sv);
      if (stop) return 0;
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = { move: root[0], score: -Infinity }, done = 0, scored = [];
  for (let d = 1; d <= lv.depth; d++) {
    stop = false;
    const cur = [];
    let alpha = -Infinity;
    const order = [best.move, ...root.filter(m => m !== best.move)];
    for (const m of order) {
      const v = b[m.path[0]];
      const sv = make(m, v);
      const val = -search(-me, d - 1, -Infinity, -alpha, 1);
      unmake(m, v, sv);
      if (stop) break;
      cur.push([m, val]);
      if (val > alpha) alpha = val;
    }
    if (stop || cur.length < order.length) break;
    cur.sort((x, y) => y[1] - x[1]);
    best = { move: cur[0][0], score: cur[0][1] };
    scored = cur;
    done = d;
    if (Math.abs(best.score) > 90000 || Date.now() > deadline) break;
  }
  if (lv.noise && scored.length > 1) {
    const top = scored[0][1];
    const pool = scored.filter(([, v]) => v >= top - 25);
    best = { ...best, move: pool[Math.floor(Math.random() * pool.length)][0] };
  }
  return { move: best.move, score: best.score === -Infinity ? 0 : best.score, depth: done, nodes, ms: Date.now() - t0 };
}
