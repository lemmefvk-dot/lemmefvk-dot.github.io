/* ============================================================
   arcade/checkers-rules.js — checkers: American (English draughts)
   or flying kings (Russian), the rules and the computer player.

   Pure (no DOM), shared by the game (./checkers.js), the thinking
   worker (./think.js) and the play-tests. 8 × 8, b[row * 8 + col],
   row 0 at the bottom of the first player's view; only squares with
   (row + col) even are used. 1 = Red's man, 2 = Red's king (Red moves
   first and up), -1 / -2 = Cream's man and king (down). A game knows
   its rule set (g.rules: 'am' or 'fly'); American is the default and
   the only one played online.

   AMERICAN ('am'):
   · A man steps one square diagonally forward; a king one square in
     any diagonal direction.
   · Capturing is forced: if any jump exists, you must jump. A jump
     goes over an adjacent enemy piece to the empty square behind it.
     A man jumps forward only. After a jump the same piece must keep
     jumping while it can, and a piece cannot be jumped twice in one
     turn. You may choose which chain to take (the longest is not
     forced).
   · A man that reaches the far row becomes a king, and its turn ends
     there, even if a jump would otherwise go on.

   FLYING KINGS ('fly', Russian draughts):
   · A man steps one square diagonally forward, as above, but captures
     backwards as well as forwards.
   · A king moves any distance along a diagonal over empty squares, and
     captures from a distance: along a diagonal, over one enemy piece,
     landing on any empty square beyond it.
   · Capturing is forced and you keep jumping: any capture sequence may
     be chosen (not necessarily the longest), but where one landing
     square lets the capture go on and another would end it, you must
     land where it goes on.
   · A captured piece stays on the board until the whole sequence is
     done: it cannot be jumped twice, and nothing passes through it.
   · A man that reaches the far row during a capture is crowned there
     and carries on jumping as a king; one that ends its move on the
     far row is crowned too.

   BOTH: no legal move (no pieces, or all blocked) loses. Draw: 40
   moves by each side (80 plies in a row) without a capture.

   A move is { path: [from, to, ...], caps: [squares] }: one entry in
   path per landing square, caps in the order taken. g.moves holds the
   paths. A path names one move: between two landing squares there is
   exactly one captured piece.
   ============================================================ */
export const QUIET_LIMIT = 80;
export const LEVELS = {
  1: { name: 'Easy', depth: 2, timeMs: 200, noise: 1 },
  2: { name: 'Medium', depth: 6, timeMs: 600, noise: 0 },
  3: { name: 'Hard', depth: 12, timeMs: 1200, noise: 0 },
};
/* what the game says about each: `short` in its panel, `text` in its Board card */
export const RULES = {
  am: { id: 'am', name: 'American', short: 'American rules: men move and jump forward only; kings move one square any way.',
    text: 'American rules: men move and jump forward only; kings move one square any way. Capturing is forced and you keep jumping; a man crowned mid-jump stops there. 40 moves each without a capture is a draw.' },
  fly: { id: 'fly', name: 'Flying kings', short: 'Flying kings: kings move and capture any distance along a diagonal; men capture backwards too.',
    text: 'Flying kings (Russian rules): kings move and capture any distance along a diagonal, landing on any empty square beyond the piece; men capture backwards too. Capturing is forced and you keep jumping; a captured piece comes off at the end and can’t be jumped twice; a man crowned mid-capture carries on as a king. 40 moves each without a capture is a draw.' },
};
export const rulesId = v => (v === 'fly' ? 'fly' : 'am');
export const dark = (r, c) => ((r + c) & 1) === 0;
export const sq = (r, c) => r * 8 + c;
export const name = i => 'abcdefgh'[i & 7] + ((i >> 3) + 1);

export function newGame(rules = 'am') {
  const b = new Int8Array(64);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (!dark(r, c)) continue;
    if (r < 3) b[sq(r, c)] = 1; else if (r > 4) b[sq(r, c)] = -1;
  }
  return { b, turn: 1, moves: [], quiet: 0, hist: [], rules: rulesId(rules) };
}
/** rows from the top (row 7) down: 'r' red man, 'R' red king, 'c' cream man, 'C' cream king, '.' empty */
export function fromRows(rows, turn = 1, quiet = 0, rules = 'am') {
  const b = new Int8Array(64);
  const map = { r: 1, R: 2, c: -1, C: -2 };
  rows.forEach((line, i) => [...line.replace(/\s/g, '')].forEach((ch, c) => { b[sq(7 - i, c)] = map[ch] || 0; }));
  return { b, turn, moves: [], quiet, hist: [], rules: rulesId(rules) };
}
export const toRows = b => Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, c) => ({ 1: 'r', 2: 'R', '-1': 'c', '-2': 'C' })[b[sq(7 - i, c)]] || '.').join(''));

const sideOf = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const isKing = v => v === 2 || v === -2;
const fwd = (v, dr) => isKing(v) || (v > 0 ? dr > 0 : dr < 0);
const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const crowns = (v, r) => (v === 1 && r === 7) || (v === -1 && r === 0);
/** does the man making move m end it a king? (American: only on its last square; flying: on any square it lands on) */
const crownedBy = (m, v) => !isKing(v) && m.path.some((s, i) => i > 0 && crowns(v, s >> 3));

/* American: short jumps, forward for a man; a man crowned mid-jump stops */
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

/* Flying kings: every capture sequence that goes on from `from` (piece v, `caps` taken so far, still on the
   board) is pushed to `out`; returns false when no capture goes on from here. A man captures both ways over an
   adjacent piece; a king over the first piece along a diagonal, landing on any empty square beyond it. */
function flyChains(b, from, v, caps, out, path) {
  const king = isKing(v), r0 = from >> 3, c0 = from & 7;
  let found = false;
  for (const [dr, dc] of DIAG) {
    let r = r0 + dr, c = c0 + dc;
    if (king) while (inb(r, c) && b[sq(r, c)] === 0) { r += dr; c += dc; }
    if (!inb(r, c)) continue;
    const mid = sq(r, c);
    /* an enemy piece not yet taken (a taken one blocks the way) */
    if (sideOf(b[mid]) !== -sideOf(v) || caps.includes(mid)) continue;
    const lands = [];
    for (let lr = r + dr, lc = c + dc; inb(lr, lc) && b[sq(lr, lc)] === 0; lr += dr, lc += dc) { lands.push(sq(lr, lc)); if (!king) break; }
    if (!lands.length) continue;
    found = true;
    const nc = [...caps, mid];
    const ends = [];
    let goesOn = false;
    for (const land of lands) {
      /* a man that lands on the far row carries on as a king */
      const nv = !king && crowns(v, land >> 3) ? v * 2 : v;
      if (flyChains(b, land, nv, nc, out, [...path, land])) goesOn = true;
      else ends.push(land);
    }
    /* you keep jumping: a landing square that ends the capture counts only when none beyond this piece lets it go on */
    if (!goesOn) for (const land of ends) out.push({ path: [...path, land], caps: nc });
  }
  return found;
}

/** every legal move for `turn` under `rules` ('am' or 'fly'), as whole turns (a multi-jump is one move) */
export function legalMoves(b, turn, rules = 'am') {
  const fly = rules === 'fly';
  const jumps = [], steps = [];
  for (let i = 0; i < 64; i++) {
    const v = b[i];
    if (!v || sideOf(v) !== turn) continue;
    /* lift the piece so its own square counts as empty while it jumps */
    b[i] = 0;
    if (fly) flyChains(b, i, v, [], jumps, [i]);
    else chains(b, i, v, [], jumps, [i]);
    b[i] = v;
    if (jumps.length) continue;
    const r = i >> 3, c = i & 7;
    for (const [dr, dc] of DIAG) {
      if (!fwd(v, dr)) continue;
      for (let k = 1; inb(r + dr * k, c + dc * k); k++) {
        const to = sq(r + dr * k, c + dc * k);
        if (b[to] !== 0) break;
        steps.push({ path: [i, to], caps: [] });
        if (!fly || !isKing(v)) break;
      }
    }
  }
  return jumps.length ? jumps : steps;
}
/* the jumps of a piece found after an earlier piece's steps are kept: legalMoves returns jumps only once any exist */
export function legal(g) { return legalMoves(g.b, g.turn, g.rules); }
export const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export const findMove = (g, path) => (Array.isArray(path) ? legalMoves(g.b, g.turn, g.rules).find(m => samePath(m.path, path)) || null : null);

export function apply(g, m) {
  const from = m.path[0], to = m.path[m.path.length - 1];
  const v = g.b[from];
  const caught = m.caps.map(s => g.b[s]);
  g.b[from] = 0;
  for (const s of m.caps) g.b[s] = 0;
  const crowned = crownedBy(m, v);
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
  if (!legalMoves(g.b, g.turn, g.rules).length) return { over: true, winner: -g.turn, reason: 'blocked' };
  if (g.quiet >= QUIET_LIMIT) return { over: true, winner: 0, reason: 'draw40' };
  return { over: false };
}

/* ------------------------- the computer ------------------------- */
/* a flying king sweeps the board, so it is worth more than an American one */
function evaluate(b, me, kingValue) {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const v = b[i];
    if (!v) continue;
    const r = i >> 3, c = i & 7, side = sideOf(v);
    let x = isKing(v) ? kingValue : 100;
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
  const rules = rulesId(g.rules);
  const kingValue = rules === 'fly' ? 260 : 175;
  const me = g.turn;
  const b = g.b.slice();
  const root = legalMoves(b, me, rules);
  if (!root.length) return { move: null, score: 0, depth: 0, nodes: 0, ms: 0 };
  if (root.length === 1) return { move: root[0], score: 0, depth: 0, nodes: 0, ms: 0 };
  let nodes = 0, stop = false;
  const deadline = t0 + lv.timeMs;
  const make = (m, v) => {
    const to = m.path[m.path.length - 1];
    const saved = m.caps.map(s => b[s]);
    b[m.path[0]] = 0; for (const s of m.caps) b[s] = 0;
    b[to] = crownedBy(m, v) ? v * 2 : v;
    return saved;
  };
  const unmake = (m, v, saved) => {
    b[m.path[m.path.length - 1]] = 0; b[m.path[0]] = v;
    m.caps.forEach((s, i) => { b[s] = saved[i]; });
  };
  function search(turn, depth, alpha, beta, ply) {
    if ((++nodes & 511) === 0 && Date.now() > deadline) stop = true;
    if (stop) return 0;
    const mv = legalMoves(b, turn, rules);
    if (!mv.length) return -100000 + ply;
    /* a forced capture does not use up depth (keeps the search from stopping mid-exchange) */
    if (depth <= 0 && !mv[0].caps.length) return evaluate(b, turn, kingValue);
    if (ply > 40) return evaluate(b, turn, kingValue);
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
