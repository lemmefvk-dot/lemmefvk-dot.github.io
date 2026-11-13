/* ============================================================
   arcade/think.js — the Arcade's thinking worker (a module Web
   Worker), so a computer opponent never freezes the page.

   in:  { id, game: 'chess', fen, history: [keys], level }
        { id, game: 'c4', cells: [42], h: [7], turn, moves: [], level }
        { id, game: 'reversi', b: [64], turn, level }  ->  { sq }
        { id, game: 'checkers', b: [64], turn, quiet, level }  ->  { path }
        { id, game: 'ttt', ult, moves: [cell], level }  ->  { move }
        { id, game: 'dnb', n, first, moves: [edge], level }  ->  { edge }
        { id, game: 'mancala', b: [14], turn, level, seed }  ->  { k }
   out: { id, ok: true, move|col, score, depth, nodes, ms }
        { id, ok: false, error }

   It is started by ./thinker.js and killed (terminate) to stop a
   search early; nothing here outlives the game that asked.
   ============================================================ */
import { Position, think as chessThink, LEVELS as CHESS } from './chess-rules.js';
import { think as c4Think, LEVELS as C4 } from './c4-rules.js';
import { think as revThink, LEVELS as REV } from './reversi-rules.js';
import { think as chkThink, LEVELS as CHK } from './checkers-rules.js';
import { think as manThink, LEVELS as MAN } from './mancala-rules.js';
import { rng32 } from './cardrules.js';
import * as TTT from './ttt-rules.js';
import * as DNB from './dnb-rules.js';

import { tabletop } from './think-tabletop.js';   /* Go, Gomoku, Five Dice, Dominoes */

export function answer(q) {
  const tt = tabletop(q);
  if (tt) return tt;
  if (q.game === 'chess') {
    const pos = new Position(q.fen);
    const lv = CHESS[q.level] || CHESS[2];
    const hist = Array.isArray(q.history) ? q.history.filter(Number.isFinite) : [];
    if (hist.length && hist[hist.length - 1] === pos.key()) hist.pop();
    const r = chessThink(pos, { ...lv, ...(q.timeMs ? { timeMs: q.timeMs } : {}), history: hist });
    return { move: r.uci, score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms };
  }
  if (q.game === 'c4') {
    const g = { cells: Int8Array.from(q.cells), h: Int8Array.from(q.h), turn: q.turn === -1 ? -1 : 1, moves: Array.from(q.moves || []) };
    const lv = C4[q.level] || C4[2];
    const r = c4Think(g, { ...lv, ...(q.timeMs ? { timeMs: q.timeMs } : {}) });
    return { col: r.col, score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms };
  }
  if (q.game === 'reversi') {
    const g = { b: Int8Array.from(q.b), turn: q.turn === -1 ? -1 : 1, moves: [], hist: [] };
    const r = revThink(g, { ...(REV[q.level] || REV[2]), ...(q.timeMs ? { timeMs: q.timeMs } : {}) });
    return { sq: r.move, score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms };
  }
  if (q.game === 'checkers') {
    const g = { b: Int8Array.from(q.b), turn: q.turn === -1 ? -1 : 1, moves: [], quiet: q.quiet | 0, hist: [] };
    const r = chkThink(g, { ...(CHK[q.level] || CHK[2]), ...(q.timeMs ? { timeMs: q.timeMs } : {}) });
    return { path: r.move ? r.move.path : null, score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms };
  }
  if (q.game === 'ttt') {
    const g = TTT.newGame(!!q.ult);
    for (const m of Array.isArray(q.moves) ? q.moves : []) TTT.play(g, m);
    const r = TTT.think(g, { level: q.level, ...(q.timeMs ? { timeMs: q.timeMs } : {}) });
    return { move: r.move, score: r.score, depth: r.depth };
  }
  if (q.game === 'dnb') {
    const g = DNB.newGame(q.n, q.first === -1 ? -1 : 1);
    for (const m of Array.isArray(q.moves) ? q.moves : []) DNB.play(g, m);
    const r = DNB.think(g, { level: q.level });
    return { edge: r.edge, score: r.score };
  }
  if (q.game === 'mancala') {
    const g = { b: Int8Array.from(q.b), turn: q.turn === 1 ? 1 : 0, moves: [], over: false };
    const r = manThink(g, { ...(MAN[q.level] || MAN[2]), ...(q.timeMs ? { timeMs: q.timeMs } : {}), rnd: rng32(q.seed >>> 0) });
    return { k: r.k, score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms };
  }
  throw new Error(`Unknown game ${q.game}`);
}

/* only when running as a worker (./thinker.js imports answer() for its fallback) */
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = e => {
    const q = e.data || {};
    try {
      self.postMessage({ id: q.id, ok: true, ...answer(q) });
    } catch (err) {
      self.postMessage({ id: q.id, ok: false, error: String(err?.message || err) });
    }
  };
}
