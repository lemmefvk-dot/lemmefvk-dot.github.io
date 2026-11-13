/* ============================================================
   arcade/think-tabletop.js — the thinking worker's answers for the
   tabletop games (Go, Gomoku, Five Dice, Dominoes). ./think.js calls
   tabletop(q) first and uses its answer when the query is one of ours.

   in:  { game: 'go', moves: [m], base?, turn?, level, playouts? }  ->  { move }      (base: a start position, for set-ups)
        { game: 'go', moves: [m], dead: true }              ->  { dead: [point] }   (the computer's judgement)
        { game: 'gomoku', moves: [point], level }           ->  { move }
        { game: 'dice', card, dice, left }                  ->  { hold } | { cat }
        { game: 'domino', view, level }                     ->  { mv }
   Anything else: null.
   ============================================================ */
import * as GO from './go-rules.js';
import * as GM from './gomoku-rules.js';
import * as DICE from './dice-rules.js';
import * as DOM from './domino-rules.js';

export function tabletop(q) {
  if (q.game === 'go') {
    const list = Array.isArray(q.moves) ? q.moves : [];
    const g = q.base ? GO.fromBase(q.base, list) : GO.fromMoves(list);
    if (q.turn === 1 || q.turn === -1) g.turn = q.turn;           /* the side to move, when the page knows better than a replay */
    if (q.dead) return { dead: GO.judgeDead(g, q.playouts ? { playouts: q.playouts } : {}) };
    const r = GO.think(g, { level: q.level, ...(q.playouts ? { playouts: q.playouts } : {}), ...(q.timeMs ? { timeMs: q.timeMs } : {}) });
    return { move: r.move, playouts: r.playouts, rate: r.rate };
  }
  if (q.game === 'gomoku') {
    const list = Array.isArray(q.moves) ? q.moves : [];
    const g = q.base ? GM.fromBase(q.base, list) : GM.fromMoves(list);
    const r = GM.think(g, { level: q.level });
    return { move: r.move, score: r.score };
  }
  if (q.game === 'dice') {
    const card = { s: { ...q.card.s }, extra: q.card.extra | 0 };
    const dice = q.dice.map(Number);
    const r = DICE.think(card, dice, q.left | 0);
    return r.cat ? { cat: r.cat } : { hold: r.hold };
  }
  if (q.game === 'domino') {
    const r = DOM.think(q.view, { level: q.level, ...(q.samples ? { samples: q.samples } : {}) });
    return { mv: r };
  }
  return null;
}
