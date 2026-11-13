/* ============================================================
   arcade/crosswordlogic.js — the rules of Mini Crosswords. Pure: no DOM.

   A puzzle is { id, grid: ['SHARE', 'H#E#R', …], clues: { A: {1: '…'}, D: {1: '…'} } }:
   one string per row, letters for white cells, '#' for black ones.

   What counts as a word: a run of two or more white cells in a row
   (across) or in a column (down). A white cell that is alone in its
   row is only part of its down word, and the other way round, but no
   white cell may be alone in both directions. Entries are numbered
   the usual way, left to right and top to bottom, at each cell that
   starts an across or a down word.

   The state of a puzzle in play is a string of the player's letters,
   one per cell, '.' for empty and '#' for black.
   ============================================================ */

/** the cells and entries of a grid: { w, h, cells: ['S', …, '#'], entries: [{ key:'1A', n, dir:'A'|'D', r, c, len, cells:[idx], answer }], numberAt: {idx: n}, problems: [] } */
export function parseGrid(rows) {
  const h = rows.length, w = h ? rows[0].length : 0;
  const problems = [];
  if (!h || !w) problems.push('the grid is empty');
  if (rows.some(r => r.length !== w)) problems.push('the rows are not all the same length');
  const cells = rows.join('').split('');
  const white = i => cells[i] !== '#';
  const entries = [], numberAt = {};
  let n = 0;
  const covered = new Array(cells.length).fill(0);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = r * w + c;
    if (!white(i)) continue;
    const startsA = (c === 0 || !white(i - 1)) && c + 1 < w && white(i + 1);
    const startsD = (r === 0 || !white(i - w)) && r + 1 < h && white(i + w);
    if (!startsA && !startsD) continue;
    n++; numberAt[i] = n;
    for (const [dir, starts] of [['A', startsA], ['D', startsD]]) {
      if (!starts) continue;
      const idx = [];
      let rr = r, cc = c;
      while (rr < h && cc < w && white(rr * w + cc)) { idx.push(rr * w + cc); if (dir === 'A') cc++; else rr++; }
      idx.forEach(j => { covered[j]++; });
      entries.push({ key: `${n}${dir}`, n, dir, r, c, len: idx.length, cells: idx, answer: idx.map(j => cells[j]).join('') });
    }
  }
  /* every white cell must sit in at least one word, and a word's cells in one line can't be a lone cell in both directions */
  cells.forEach((ch, i) => { if (ch !== '#' && !covered[i]) problems.push(`cell ${i} (row ${Math.floor(i / w) + 1}, column ${i % w + 1}) is in no word`); });
  /* one connected piece */
  const first = cells.findIndex(ch => ch !== '#');
  if (first >= 0) {
    const seen = new Set([first]), q = [first];
    while (q.length) {
      const i = q.pop(), r = Math.floor(i / w), c = i % w;
      for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
        const j = rr * w + cc;
        if (cells[j] !== '#' && !seen.has(j)) { seen.add(j); q.push(j); }
      }
    }
    if (seen.size !== cells.filter(ch => ch !== '#').length) problems.push('the white cells are not all connected');
  }
  return { w, h, cells, entries, numberAt, problems };
}

/** the clue text of an entry in a puzzle ('' when missing) */
export const clueOf = (puz, e) => (puz.clues && puz.clues[e.dir] && puz.clues[e.dir][e.n]) || '';

/** all the problems a puzzle has, as readable lines: grid shape, letters, a clue for every entry and no extra ones,
    and clues that contain their answer. An empty list means the puzzle is well formed. */
export function validatePuzzle(puz) {
  const out = [];
  const g = parseGrid(puz.grid || []);
  out.push(...g.problems);
  if (puz.grid.some(r => !/^[A-Z#]+$/.test(r))) out.push('the grid holds something other than A–Z and #');
  const keys = new Set(g.entries.map(e => `${e.dir}${e.n}`));
  for (const e of g.entries) {
    const clue = clueOf(puz, e);
    if (!clue.trim()) { out.push(`${e.key} has no clue`); continue; }
    if (norm(clue).includes(e.answer.toLowerCase())) out.push(`${e.key}'s clue contains its answer`);
    if (/[<>]/.test(clue)) out.push(`${e.key}'s clue has markup`);
  }
  for (const dir of ['A', 'D']) for (const n of Object.keys(puz.clues?.[dir] || {})) if (!keys.has(`${dir}${n}`)) out.push(`a clue for ${n}${dir}, which is not an entry`);
  return out;
}
const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '');

/* ---- play ---- */

/** a blank state, or the one in `saved` when it fits this grid */
export function blank(puz, saved) {
  const g = parseGrid(puz.grid), want = g.cells.map(ch => (ch === '#' ? '#' : '.')).join('');
  if (typeof saved === 'string' && saved.length === want.length && [...saved].every((ch, i) => (want[i] === '#' ? ch === '#' : /^[A-Z.]$/.test(ch)))) return saved;
  return want;
}
export const solutionOf = puz => puz.grid.join('');
export const isFilled = state => !state.includes('.');
export const isSolved = (puz, state) => state === solutionOf(puz);
export const filledCount = state => [...state].filter(ch => ch !== '.' && ch !== '#').length;
export const put = (state, i, ch) => state.slice(0, i) + ch + state.slice(i + 1);

/** cells whose letter differs from the answer (only cells that have a letter) */
export function wrongCells(puz, state) {
  const sol = solutionOf(puz), out = [];
  for (let i = 0; i < state.length; i++) if (state[i] !== '.' && state[i] !== '#' && state[i] !== sol[i]) out.push(i);
  return out;
}

/** the entries through a cell: { A: entry|null, D: entry|null } */
export function entriesAt(g, i) {
  const out = { A: null, D: null };
  for (const e of g.entries) if (e.cells.includes(i)) out[e.dir] = e;
  return out;
}

/** the direction to use at a cell: `dir` if a word runs that way, else the other one, else null */
export function dirAt(g, i, dir) {
  const at = entriesAt(g, i);
  if (at[dir]) return dir;
  const other = dir === 'A' ? 'D' : 'A';
  return at[other] ? other : null;
}

/** the first white cell of the grid (where a puzzle starts) */
export const firstCell = g => g.cells.findIndex(ch => ch !== '#');

/** arrow keys, the way crosswords work: along the other axis from the current word first turns to it,
    otherwise the cursor goes to the next white cell that way (not past the edge). { i, dir } */
export function arrow(g, i, dir, key) {
  const axis = key === 'ArrowLeft' || key === 'ArrowRight' ? 'A' : 'D';
  const at = entriesAt(g, i);
  if (axis !== dir && at[axis]) return { i, dir: axis };
  const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[key];
  let r = Math.floor(i / g.w) + step[0], c = i % g.w + step[1];
  while (r >= 0 && c >= 0 && r < g.h && c < g.w) {
    const j = r * g.w + c;
    if (g.cells[j] !== '#') return { i: j, dir: dirAt(g, j, axis) || dir };
    r += step[0]; c += step[1];
  }
  return { i, dir };
}

/** after a letter is typed at i: on to the next empty cell of the word, else the next cell, else stay */
export function advance(g, state, i, dir) {
  const e = entriesAt(g, i)[dir];
  if (!e) return i;
  const k = e.cells.indexOf(i);
  for (let j = k + 1; j < e.cells.length; j++) if (state[e.cells[j]] === '.') return e.cells[j];
  return k + 1 < e.cells.length ? e.cells[k + 1] : i;
}

/** Backspace: an empty cell steps back and clears the cell before it; a filled one is cleared and stays.
    { state, i } */
export function backspace(g, state, i, dir) {
  if (state[i] !== '.') return { state: put(state, i, '.'), i };
  const e = entriesAt(g, i)[dir];
  if (!e) return { state, i };
  const k = e.cells.indexOf(i);
  if (k <= 0) return { state, i };
  const j = e.cells[k - 1];
  return { state: put(state, j, '.'), i: j };
}

/** Tab / Shift+Tab: the next (or previous) entry after the one at the cursor, in clue order (all across, then all down).
    { i, dir } at that entry's first empty cell, or its first cell if it is full */
export function stepEntry(g, state, i, dir, back = false) {
  const order = [...g.entries.filter(e => e.dir === 'A'), ...g.entries.filter(e => e.dir === 'D')];
  if (!order.length) return { i, dir };
  const cur = entriesAt(g, i)[dir] || order[0];
  const k = order.indexOf(cur);
  const e = order[(k + (back ? order.length - 1 : 1)) % order.length];
  return { i: e.cells.find(j => state[j] === '.') ?? e.cells[0], dir: e.dir };
}

/** reveal: one cell, one word or the whole grid — returns the new state */
export function reveal(puz, state, what, i, dir) {
  const sol = solutionOf(puz), g = parseGrid(puz.grid);
  if (what === 'all') return sol;
  if (what === 'cell') return put(state, i, sol[i]);
  const e = entriesAt(g, i)[dir];
  if (!e) return state;
  return e.cells.reduce((s, j) => put(s, j, sol[j]), state);
}
