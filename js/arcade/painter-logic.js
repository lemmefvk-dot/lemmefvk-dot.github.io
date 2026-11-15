/* ============================================================
   arcade/painter-logic.js — the rules of Pixel Painter Duel, with no
   screen in them (the game is ./painter.js; the suite plays this too).

   A 12 × 12 board of pixels in six colours. Two painters start in
   opposite corners: player 1 bottom left, player 2 top right. On your
   turn you pick a colour; your whole territory turns that colour and
   swallows every untouched pixel of that colour that touches it (and
   any that touch those, and so on). You can't pick your own colour or
   the colour your rival is wearing, and a pick must swallow at least
   one pixel. A painter with no such colour passes by itself. The round
   ends when someone owns more than half of the board, or neither
   painter can move; more pixels wins.

   Everything comes from the round's seed (the same seed, the same
   board), and a game is just its list of picks, which is what two
   screens exchange: who is to move is worked out from the board.
   ============================================================ */
import { rng } from './kit.js';

export const W = 12;
export const H = 12;
export const COLORS = 6;
export const HALF = (W * H) / 2;
export const LEVELS = ['easy', 'medium', 'hard'];

export function newGame(seed = 1) {
  const next = rng(seed >>> 0);
  const col = new Array(W * H);
  for (let i = 0; i < W * H; i++) col[i] = Math.floor(next() * COLORS);
  const a = (H - 1) * W, b = W - 1;
  /* the two start pixels wear different colours, and neither touches the other's colour */
  while (col[a] === col[b]) col[b] = (col[b] + 1) % COLORS;
  const g = { seed: seed >>> 0, col, own: new Array(W * H).fill(0), colour: [0, col[a], col[b]], moves: [], turn: 1, over: null };
  g.own[a] = 1; g.own[b] = 2;
  absorb(g, 1, col[a]); absorb(g, 2, col[b]);
  g.turn = 1;
  settle(g);
  return g;
}

const around = i => {
  const x = i % W, y = Math.floor(i / W), out = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (y > 0) out.push(i - W);
  if (y < H - 1) out.push(i + W);
  return out;
};

/** swallow the untouched pixels of colour c that touch p's territory, and what touches those. returns how many */
function absorb(g, p, c) {
  const stack = [];
  for (let i = 0; i < W * H; i++) if (g.own[i] === p) stack.push(i);
  let n = 0;
  while (stack.length) {
    const i = stack.pop();
    for (const j of around(i)) if (g.own[j] === 0 && g.col[j] === c) { g.own[j] = p; n++; stack.push(j); }
  }
  return n;
}

export const owned = (g, p) => g.own.reduce((n, o) => n + (o === p ? 1 : 0), 0);

/** how many pixels would colour c swallow for p right now (0: not a legal pick) */
export function gainOf(g, p, c) {
  if (!Number.isInteger(c) || c < 0 || c >= COLORS || c === g.colour[p] || c === g.colour[3 - p]) return 0;
  let n = 0;
  const seen = new Set();
  const stack = [];
  for (let i = 0; i < W * H; i++) if (g.own[i] === p) stack.push(i);
  while (stack.length) {
    const i = stack.pop();
    for (const j of around(i)) if (g.own[j] === 0 && g.col[j] === c && !seen.has(j)) { seen.add(j); n++; stack.push(j); }
  }
  return n;
}

/** the colours p may pick, with what each swallows */
export function options(g, p) {
  const out = [];
  for (let c = 0; c < COLORS; c++) { const n = gainOf(g, p, c); if (n > 0) out.push({ c, n }); }
  return out;
}

/* after a pick: who moves next (a painter with nothing to pick is skipped), and is it over */
function settle(g) {
  const a = owned(g, 1), b = owned(g, 2);
  if (a > HALF || b > HALF) { g.over = { winner: a > b ? 1 : 2, reason: 'half', a, b }; return; }
  if (!options(g, g.turn).length) g.turn = 3 - g.turn;
  if (!options(g, g.turn).length) g.over = { winner: a === b ? 0 : a > b ? 1 : 2, reason: 'stuck', a, b };
}

/** player p picks colour c. { ok, gained } — { ok: false } when it is not p's turn or not a legal colour */
export function play(g, p, c) {
  if (g.over || g.turn !== p || !gainOf(g, p, c)) return { ok: false };
  for (let i = 0; i < W * H; i++) if (g.own[i] === p) g.col[i] = c;
  g.colour[p] = c;
  const gained = absorb(g, p, c);
  g.moves.push(c);
  g.turn = 3 - p;
  settle(g);
  return { ok: true, gained };
}

export function clone(g) {
  return { ...g, col: g.col.slice(), own: g.own.slice(), colour: g.colour.slice(), moves: g.moves.slice() };
}

/** the computer's pick. easy: any legal colour; medium: the biggest swallow; hard: the biggest swallow minus the best answer it allows */
export function think(g, p, level = 'medium', rand = Math.random) {
  const opts = options(g, p);
  if (!opts.length) return -1;
  if (level === 'easy') return opts[Math.floor(rand() * opts.length)].c;
  let best = null;
  for (const o of opts) {
    let score = o.n;
    if (level === 'hard') {
      const h = clone(g);
      play(h, p, o.c);
      if (h.over) score += h.over.winner === p ? 1000 : -1000;
      else if (h.turn !== p) score -= Math.max(0, ...options(h, h.turn).map(r => r.n)) * 0.8;
      else score += 4;                          /* the rival has to pass: another turn */
    }
    if (!best || score > best.score) best = { c: o.c, score };
  }
  return best.c;
}

export default { W, H, COLORS, HALF, LEVELS, newGame, play, options, gainOf, owned, think, clone };
