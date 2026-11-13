/* ============================================================
   arcade/nonogramlogic.js — Nonogram clues and a line solver.
   Pure functions, no DOM: the game and the tests both import this.

   A picture is an array of strings, '#' filled and '.' empty.
   A line is an array of cells: 1 filled, 0 empty, -1 unknown.

   Uniqueness. `solveLine` works out, for one row or column, every
   way its clue can still fit the cells known so far, and keeps what
   every way agrees on. `solveGrid` repeats that over all rows and
   columns until nothing changes. A puzzle that ends fully known
   this way has exactly one solution (each cell was forced), and
   needs no guessing, which is what every bundled puzzle does.
   `countSolutions` is the stronger, slower check: it adds
   backtracking, so it also counts puzzles line logic alone can't
   finish.
   ============================================================ */

/* run lengths of the filled cells in a line; [0] when there are none */
export function runsOf(line) {
  const out = [];
  let n = 0;
  for (const c of line) {
    if (c === 1) n++;
    else if (n) { out.push(n); n = 0; }
  }
  if (n) out.push(n);
  return out.length ? out : [0];
}
export const sameRuns = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* { rows: [[..]], cols: [[..]] } for a picture */
export function cluesOf(pic) {
  const h = pic.length, w = pic[0].length;
  const g = pic.map(r => [...r].map(ch => (ch === '#' ? 1 : 0)));
  return {
    rows: g.map(runsOf),
    cols: Array.from({ length: w }, (_, x) => runsOf(g.map(r => r[x]))),
    w, h,
  };
}

/* What does every arrangement of `clue` that fits `line` agree on?
   Returns the tightened line, or null when nothing fits. */
export function solveLine(clue, line) {
  const n = line.length;
  const blocks = clue.length === 1 && clue[0] === 0 ? [] : clue;
  const can0 = new Array(n).fill(false), can1 = new Array(n).fill(false);
  const cur = new Array(n).fill(0);
  /* least room the blocks from b on need, with one gap between them */
  const need = new Array(blocks.length + 1).fill(0);
  for (let b = blocks.length - 1; b >= 0; b--) need[b] = blocks[b] + (b < blocks.length - 1 ? 1 + need[b + 1] : 0);
  let any = false;
  const rec = (b, pos) => {
    if (b === blocks.length) {
      for (let i = pos; i < n; i++) if (line[i] === 1) return;
      for (let i = pos; i < n; i++) cur[i] = 0;
      any = true;
      for (let i = 0; i < n; i++) (cur[i] ? can1 : can0)[i] = true;
      return;
    }
    const len = blocks[b];
    for (let start = pos; start + need[b] <= n; start++) {
      /* cells skipped over before the block are empty: none may be known filled */
      if (start > pos && line[start - 1] === 1) break;
      let ok = true;
      for (let i = start; i < start + len; i++) if (line[i] === 0) { ok = false; break; }
      if (!ok) continue;
      const after = start + len;
      if (after < n && line[after] === 1) continue;
      for (let i = pos; i < start; i++) cur[i] = 0;
      for (let i = start; i < after; i++) cur[i] = 1;
      if (after < n) cur[after] = 0;
      rec(b + 1, Math.min(n, after + 1));
    }
  };
  rec(0, 0);
  if (!any) return null;
  return line.map((c, i) => (can1[i] && !can0[i] ? 1 : can0[i] && !can1[i] ? 0 : -1));
}

/* Solve by line logic alone. `grid` is rows of -1/0/1 (default: all unknown).
   Returns { grid, solved, contradiction, passes }. */
export function solveGrid(rows, cols, grid) {
  const h = rows.length, w = cols.length;
  const g = grid ? grid.map(r => r.slice()) : Array.from({ length: h }, () => new Array(w).fill(-1));
  let changed = true, passes = 0;
  while (changed) {
    changed = false; passes++;
    for (let y = 0; y < h; y++) {
      const r = solveLine(rows[y], g[y]);
      if (!r) return { grid: g, solved: false, contradiction: true, passes };
      for (let x = 0; x < w; x++) if (r[x] !== g[y][x]) { g[y][x] = r[x]; changed = true; }
    }
    for (let x = 0; x < w; x++) {
      const c = solveLine(cols[x], g.map(r => r[x]));
      if (!c) return { grid: g, solved: false, contradiction: true, passes };
      for (let y = 0; y < h; y++) if (c[y] !== g[y][x]) { g[y][x] = c[y]; changed = true; }
    }
  }
  return { grid: g, solved: g.every(r => r.every(c => c !== -1)), contradiction: false, passes };
}

/* Count solutions (up to `limit`) with line logic plus backtracking. */
export function countSolutions(rows, cols, limit = 2) {
  let n = 0;
  const go = grid => {
    const r = solveGrid(rows, cols, grid);
    if (r.contradiction) return false;
    let at = null;
    outer: for (let y = 0; y < r.grid.length; y++) for (let x = 0; x < r.grid[y].length; x++) if (r.grid[y][x] === -1) { at = [y, x]; break outer; }
    if (!at) { n++; return n >= limit; }
    for (const v of [1, 0]) {
      const g = r.grid.map(row => row.slice());
      g[at[0]][at[1]] = v;
      if (go(g)) return true;
    }
    return false;
  };
  go(null);
  return n;
}

/* the picture as a grid of 0/1 */
export const gridOf = pic => pic.map(r => [...r].map(ch => (ch === '#' ? 1 : 0)));
