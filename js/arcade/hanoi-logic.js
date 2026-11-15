/* ============================================================
   arcade/hanoi-logic.js — the rules of Disc Towers, with a solver
   (the game is ./hanoi.js; the suite solves every level here and
   checks each par against it: the pars written here are what it finds).

   Discs of every size start in one stack on the first peg, smallest
   on top. Move the top disc of one peg onto another, never onto a
   smaller disc. Rebuild the whole stack on the last peg. The score is
   the number of moves, and each level's par is the fewest moves
   possible, found by a breadth-first search over every position (3
   pegs: 2ⁿ − 1; with a fourth peg it is less, and the search says how
   much).

   A position is an array: pos[i] is the peg disc i (0 is the smallest)
   is on.
   ============================================================ */
export const LEVELS = [
  { pegs: 3, n: 3, par: 7 }, { pegs: 3, n: 4, par: 15 }, { pegs: 3, n: 5, par: 31 }, { pegs: 3, n: 6, par: 63 }, { pegs: 3, n: 7, par: 127 }, { pegs: 3, n: 8, par: 255 },
  { pegs: 4, n: 4, par: 9 }, { pegs: 4, n: 5, par: 13 }, { pegs: 4, n: 6, par: 17 }, { pegs: 4, n: 7, par: 25 },
];

export const start = lv => new Array(lv.n).fill(0);
export const isSolved = (lv, pos) => pos.every(p => p === lv.pegs - 1);
export const top = (pos, peg) => pos.indexOf(peg);              /* smallest disc on that peg, or -1 */
export const stack = (pos, peg) => { const out = []; for (let i = 0; i < pos.length; i++) if (pos[i] === peg) out.push(i); return out; };

/** the position after moving the top disc from peg a to peg b, or null if that is not allowed */
export function move(pos, a, b) {
  if (a === b) return null;
  const d = top(pos, a);
  if (d < 0) return null;
  const t = top(pos, b);
  if (t >= 0 && t < d) return null;
  const next = pos.slice(); next[d] = b;
  return next;
}

const code = (pos, pegs) => { let c = 0; for (let i = 0; i < pos.length; i++) c = c * pegs + pos[i]; return c; };

/** the fewest moves from pos to a finished tower, and a way: { moves, path: [[from, to], …] } */
export function solve(lv, pos = start(lv)) {
  if (isSolved(lv, pos)) return { moves: 0, path: [] };
  const seen = new Map([[code(pos, lv.pegs), null]]);
  let frontier = [pos], depth = 0;
  while (frontier.length) {
    depth++;
    const next = [];
    for (const p of frontier) {
      for (let a = 0; a < lv.pegs; a++) for (let b = 0; b < lv.pegs; b++) {
        const m = move(p, a, b);
        if (!m) continue;
        const k = code(m, lv.pegs);
        if (seen.has(k)) continue;
        seen.set(k, { from: code(p, lv.pegs), a, b });
        if (isSolved(lv, m)) {
          const path = [];
          let at = k, info;
          while ((info = seen.get(at))) { path.unshift([info.a, info.b]); at = info.from; }
          return { moves: depth, path };
        }
        next.push(m);
      }
    }
    frontier = next;
  }
  return null;
}

export default { LEVELS, start, isSolved, move, solve, stack, top };
