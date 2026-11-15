/* ============================================================
   arcade/tactics-logic.js — the rules and the computer player of
   Tiny Tactics.

   A 6×6 field with four stones in it and four pieces a side:

     Knight  5 hp · moves 2 · hits 1 square away for 2
     Archer  3 hp · moves 2 · hits 2 to 3 squares away for 2
     Mage    3 hp · moves 1 · hits 1 to 2 squares away for 3
     Scout   3 hp · moves 4 · hits 1 square away for 1

   Distances count squares up, down and across (no diagonals). A turn:
   each of your pieces may act once — walk up to its move through
   empty squares (a piece or a stone blocks the way), then hit one
   enemy in range, or stay where it is and hit — and you may end the
   turn early. The side that moves first may move only one piece in
   its very first turn (self-play of the computer against itself found
   an even split of wins between the two sides with that rule, and a
   lopsided one without it).
   Defeat every enemy piece to win. After round 20 the
   side with more health left wins, and equal health is a draw.

   A PLY is one thing a player does: { u, to, at } — piece u goes to
   square `to` (its own square to stay) and hits piece `at` (-1: no
   hit) — or { e: 1 } to end the turn. A game is its list of plies, so
   the same list replayed gives the same game, and online each ply is
   checked with legal() before it touches the board.

   THE COMPUTER (aiTurn). Easy picks hits when it sees them and
   otherwise wanders toward you. Normal scores each action by damage,
   kills, how exposed the square is and how far it leaves the enemy,
   and plays the best, piece by piece. Hard tries each first action,
   plays out the rest of its turn and your best reply the Normal way,
   and keeps the action that leaves the better position.

   Pure functions, no DOM: the play-tests import this file directly.
   ============================================================ */
import { rng } from './kit.js';

export const N = 6;
export const MAX_ROUNDS = 20;
export const OPENING = 1;           /* the first side may move only one piece in its very first turn */
export const STONES = [[2, 2], [3, 3], [1, 3], [4, 2]];
export const TYPES = {
  K: { name: 'Knight', hp: 5, mv: 2, min: 1, max: 1, dmg: 2 },
  A: { name: 'Archer', hp: 3, mv: 2, min: 2, max: 3, dmg: 2 },
  M: { name: 'Mage', hp: 3, mv: 1, min: 1, max: 2, dmg: 3 },
  S: { name: 'Scout', hp: 3, mv: 4, min: 1, max: 1, dmg: 1 },
};
const START = [
  [['K', 2, 5], ['S', 3, 5], ['A', 1, 4], ['M', 4, 4]],     /* side 0, at the bottom: moves first */
  [['K', 3, 0], ['S', 2, 0], ['A', 4, 1], ['M', 1, 1]],     /* side 1, the same turned half way round */
];
export const cellOf = (x, y) => y * N + x;
export const xyOf = c => [c % N, Math.floor(c / N)];
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** a new game: side 0 to move */
export function newGame() {
  const units = [];
  START.forEach((list, side) => list.forEach(([type, x, y]) => units.push({ id: units.length, side, type, x, y, hp: TYPES[type].hp, acted: false })));
  return { units, turn: 0, round: 1, over: null };
}
export const clone = s => ({ ...s, units: s.units.map(u => ({ ...u })), over: s.over ? { ...s.over } : null });
export const alive = (s, side) => s.units.filter(u => u.side === side && u.hp > 0);
export const unitAt = (s, x, y) => s.units.find(u => u.hp > 0 && u.x === x && u.y === y) || null;
const stone = (x, y) => STONES.some(([a, b]) => a === x && b === y);

/** the squares a piece can walk to (its own included): Map of cell -> steps */
export function reach(s, u) {
  const out = new Map([[cellOf(u.x, u.y), 0]]), q = [[u.x, u.y]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i], d = out.get(cellOf(x, y));
    if (d >= TYPES[u.type].mv) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || stone(nx, ny) || out.has(cellOf(nx, ny))) continue;
      if (unitAt(s, nx, ny)) continue;
      out.set(cellOf(nx, ny), d + 1);
      q.push([nx, ny]);
    }
  }
  return out;
}
/** the enemy pieces a piece standing at (x, y) can hit */
export function targets(s, u, x = u.x, y = u.y) {
  const T = TYPES[u.type];
  return s.units.filter(e => e.hp > 0 && e.side !== u.side && (d => d >= T.min && d <= T.max)(Math.abs(e.x - x) + Math.abs(e.y - y)));
}

/** is this ply allowed now? (the only check an online ply needs) */
export function legal(s, ply) {
  if (!ply || typeof ply !== 'object' || s.over) return false;
  if (ply.e === 1) return true;
  const { u, to, at } = ply;
  if (!Number.isInteger(u) || !Number.isInteger(to) || !Number.isInteger(at) || to < 0 || to >= N * N || at < -1) return false;
  const unit = s.units[u];
  if (!unit || unit.hp <= 0 || unit.side !== s.turn || unit.acted) return false;
  if (!reach(s, unit).has(to)) return false;
  if (at === -1) return true;
  const [x, y] = xyOf(to);
  return targets(s, unit, x, y).some(e => e.id === at);
}
/** the game after a ply (a new object); the ply must be legal */
export function apply(s, ply) {
  const n = clone(s);
  if (ply.e !== 1) {
    const u = n.units[ply.u];
    [u.x, u.y] = xyOf(ply.to);
    u.acted = true;
    if (ply.at >= 0) {
      const t = n.units[ply.at];
      t.hp = Math.max(0, t.hp - TYPES[u.type].dmg);
    }
  }
  const mine = alive(n, n.turn), theirs = alive(n, 1 - n.turn);
  if (!theirs.length) n.over = { winner: n.turn, reason: 'wiped' };
  else if (!mine.length) n.over = { winner: 1 - n.turn, reason: 'wiped' };
  if (!n.over && (ply.e === 1 || mine.every(u => u.acted) || (n.round === 1 && n.turn === 0 && mine.filter(u => u.acted).length >= OPENING))) {
    n.units.forEach(u => { u.acted = false; });
    n.turn = 1 - n.turn;
    if (n.turn === 0) n.round++;
    if (n.round > MAX_ROUNDS) {
      const a = alive(n, 0).reduce((t, u) => t + u.hp, 0), b = alive(n, 1).reduce((t, u) => t + u.hp, 0);
      n.over = { winner: a === b ? -1 : a > b ? 0 : 1, reason: 'rounds' };
    }
  }
  return n;
}
/** every legal unit action for the side to move: [{ u, to, at }], hits and stays included */
export function actions(s) {
  const out = [];
  for (const u of alive(s, s.turn)) {
    if (u.acted) continue;
    for (const to of reach(s, u).keys()) {
      const [x, y] = xyOf(to), ts = targets(s, u, x, y);
      out.push({ u: u.id, to, at: -1 });
      for (const t of ts) out.push({ u: u.id, to, at: t.id });
    }
  }
  return out;
}
export const health = (s, side) => alive(s, side).reduce((t, u) => t + u.hp, 0);

/* ---------------- the computer ---------------- */
/* how much a piece at (x, y) could be hit for by the other side next turn (a rough reach, ignoring blockers) */
function exposure(s, u, x, y) {
  let d = 0;
  for (const e of alive(s, 1 - u.side)) {
    const T = TYPES[e.type], gap = Math.abs(e.x - x) + Math.abs(e.y - y);
    if (gap <= T.mv + T.max && gap >= 1) d += T.dmg;
  }
  return d;
}
function score(s, a) {
  const u = s.units[a.u], [x, y] = xyOf(a.to), T = TYPES[u.type];
  let v = 0;
  if (a.at >= 0) { const t = s.units[a.at]; v += Math.min(T.dmg, t.hp) * 3 + (t.hp <= T.dmg ? 7 : 0); }
  v -= exposure(s, u, x, y) * (u.hp <= 2 ? 1.1 : 0.55);
  const foes = alive(s, 1 - u.side);
  const near = Math.min(...foes.map(e => Math.abs(e.x - x) + Math.abs(e.y - y)));
  v -= (T.max > 1 ? Math.abs(near - T.max) * 0.35 : near * 0.45);
  if (a.to === cellOf(u.x, u.y) && a.at < 0) v -= 0.6;           /* standing about */
  return v;
}
/* a position's worth to `side`: health and pieces */
function worth(s, side) {
  const own = alive(s, side), opp = alive(s, 1 - side);
  return (own.reduce((t, u) => t + u.hp, 0) - opp.reduce((t, u) => t + u.hp, 0)) * 2 + (own.length - opp.length) * 4;
}
function bestGreedy(s, r, noise = 0) {
  const all = actions(s);
  if (!all.length) return null;
  let best = null, bv = -Infinity;
  for (const a of all) { const v = score(s, a) + (noise ? r() * noise : 0); if (v > bv) { bv = v; best = a; } }
  return best;
}
/** play the rest of the current side's turn the Normal way: -> the position when the turn passes */
function finishTurn(s, r) {
  let n = s;
  const side = s.turn;
  for (let i = 0; i < 12 && !n.over && n.turn === side; i++) {
    const a = bestGreedy(n, r);
    n = a ? apply(n, a) : apply(n, { e: 1 });
  }
  return n;
}

/**
 * The computer's whole turn: a list of plies (ends with the turn passing).
 * level 1 Easy · 2 Normal · 3 Hard; `seed` makes the same position answer the same way.
 */
export function aiTurn(s0, level = 2, seed = 1) {
  const r = rng(seed >>> 0), side = s0.turn, plies = [];
  let s = s0, guard = 0;
  while (!s.over && s.turn === side && guard++ < 12) {
    const all = actions(s);
    if (!all.length) { plies.push({ e: 1 }); s = apply(s, { e: 1 }); break; }
    let pick;
    if (level <= 1) {
      const hits = all.filter(a => a.at >= 0);
      pick = hits.length && r() < 0.65 ? hits[Math.floor(r() * hits.length)] : (a => a.length ? a[Math.floor(r() * a.length)] : all[0])(all.filter(a => score(s, a) > -4));
    } else if (level === 2) {
      pick = bestGreedy(s, r, 0.35);
    } else {
      let bv = -Infinity;
      for (const a of all) {
        const after = apply(s, a);
        let end = after;
        if (!end.over && end.turn === side) end = finishTurn(end, r);
        /* then the other side's best reply, the Normal way */
        let reply = end;
        if (!reply.over && reply.turn !== side) reply = finishTurn(reply, r);
        const v = (reply.over ? (reply.over.winner === side ? 999 : reply.over.winner < 0 ? 0 : -999) : worth(reply, side)) + score(s, a) * 0.15 + r() * 0.01;
        if (v > bv) { bv = v; pick = a; }
      }
    }
    plies.push(pick);
    s = apply(s, pick);
  }
  return plies;
}
