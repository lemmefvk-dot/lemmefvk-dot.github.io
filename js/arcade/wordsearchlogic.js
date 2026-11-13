/* ============================================================
   arcade/wordsearchlogic.js — builds a Word Search grid. Pure
   functions, no DOM: the game and the tests both import this.

   makeGrid(theme, n, count, seed) is deterministic: the same seed
   always gives the same words, placements and filler letters, so a
   test can pin a grid; the game picks a fresh random seed for every
   round. Words run in all 8 directions. Each listed word appears
   exactly once in the finished grid (checked by scanning every
   start and direction, backwards reading included), so there is
   never a second, unmarked copy hiding in the filler.
   ============================================================ */
import { rng } from './kit.js';

export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const rev = s => [...s].reverse().join('');

/* how many times does `word` occur in the grid, over all 8 directions */
export function occurrences(grid, word) {
  const n = grid.length;
  let k = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    for (const [dx, dy] of DIRS) {
      let i = 0;
      for (; i < word.length; i++) {
        const xx = x + dx * i, yy = y + dy * i;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n || grid[yy][xx] !== word[i]) break;
      }
      if (i === word.length) k++;
    }
  }
  return k;
}

function shuffled(a, rand) {
  const out = a.slice();
  for (let k = out.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [out[k], out[j]] = [out[j], out[k]]; }
  return out;
}

/* { n, rows: ['ABC…', …], words: [{ word, x, y, dx, dy }], seed } */
export function makeGrid(theme, n, count, seed) {
  const rand = rng(seed);
  for (let attempt = 0; attempt < 60; attempt++) {
    /* a random handful that fit and don't hide inside one another */
    const pool = shuffled(theme.words.filter(w => w.length <= n && w !== rev(w)), rand);
    const chosen = [];
    for (const w of pool) {
      if (chosen.length >= count) break;
      if (chosen.some(c => c.includes(w) || w.includes(c) || c.includes(rev(w)) || w.includes(rev(c)))) continue;
      chosen.push(w);
    }
    if (chosen.length < count) continue;
    const g = Array.from({ length: n }, () => new Array(n).fill(''));
    const placed = [];
    let ok = true;
    for (const w of [...chosen].sort((a, b) => b.length - a.length)) {
      let done = false;
      for (let t = 0; t < 400 && !done; t++) {
        const [dx, dy] = DIRS[Math.floor(rand() * 8)];
        const x = Math.floor(rand() * n), y = Math.floor(rand() * n);
        const ex = x + dx * (w.length - 1), ey = y + dy * (w.length - 1);
        if (ex < 0 || ey < 0 || ex >= n || ey >= n) continue;
        let fits = true, overlap = 0;
        for (let i = 0; i < w.length; i++) {
          const c = g[y + dy * i][x + dx * i];
          if (c && c !== w[i]) { fits = false; break; }
          if (c) overlap++;
        }
        if (!fits || overlap === w.length) continue;
        for (let i = 0; i < w.length; i++) g[y + dy * i][x + dx * i] = w[i];
        placed.push({ word: w, x, y, dx, dy });
        done = true;
      }
      if (!done) { ok = false; break; }
    }
    if (!ok) continue;
    /* fill the blanks; redo the filler if it made a second copy of a word */
    for (let fill = 0; fill < 30; fill++) {
      const rows = g.map(r => r.map(c => c || String.fromCharCode(65 + Math.floor(rand() * 26))).join(''));
      if (placed.every(p => occurrences(rows, p.word) === 1)) return { n, rows, words: placed, seed, theme: theme.id };
    }
  }
  throw new Error('could not build a word search');
}

/* the cells of the straight line from (x0,y0) to (x1,y1), or null if it isn't one of the 8 directions */
export function lineCells(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  if (dx && dy && Math.abs(dx) !== Math.abs(dy)) return null;
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = Math.sign(dx), sy = Math.sign(dy);
  return Array.from({ length: len + 1 }, (_, i) => [x0 + sx * i, y0 + sy * i]);
}
