/* ============================================================
   automata.js — cellular automata: Life-like rules and the 256
   elementary one-dimensional rules. No DOM; unit-tested.

   A Life-like rule is written "B3/S23": a dead cell with that many
   live neighbours is born, a live cell with that many survives.
   ============================================================ */

export const RULES = {
  life: { name: 'Conway\'s Life', rule: 'B3/S23' },
  highlife: { name: 'HighLife', rule: 'B36/S23' },
  seeds: { name: 'Seeds', rule: 'B2/S' },
  daynight: { name: 'Day & Night', rule: 'B3678/S34678' },
  maze: { name: 'Maze', rule: 'B3/S12345' },
  replicator: { name: 'Replicator', rule: 'B1357/S1357' },
};

/** "B36/S23" -> { born: [3,6], live: [2,3] }, or null if it is not a rule. */
export function parseRule(text) {
  const m = /^\s*B([0-8]*)\s*\/\s*S([0-8]*)\s*$/i.exec(String(text));
  if (!m) return null;
  const set = s => [...new Set(s.split('').map(Number))].sort((a, b) => a - b);
  return { born: set(m[1]), live: set(m[2]) };
}

/** One generation of a w×h grid (Uint8Array of 0/1). `wrap` joins the
    edges into a torus; without it the outside is dead. Returns a new array. */
export function step(cells, w, h, rule, wrap) {
  const born = new Uint8Array(9), live = new Uint8Array(9);
  for (const n of rule.born) born[n] = 1;
  for (const n of rule.live) live[n] = 1;
  const next = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          let xx = x + dx, yy = y + dy;
          if (wrap) { xx = (xx + w) % w; yy = (yy + h) % h; }
          else if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          n += cells[yy * w + xx];
        }
      }
      next[y * w + x] = cells[y * w + x] ? live[n] : born[n];
    }
  }
  return next;
}

export const population = cells => { let n = 0; for (let i = 0; i < cells.length; i++) n += cells[i]; return n; };

/** One row of an elementary automaton (Wolfram's numbering, 0 to 255):
    each cell's next value is bit (left*4 + me*2 + right) of the rule number.
    The row wraps at the ends. */
export function elementary(rule, row) {
  const w = row.length, out = new Uint8Array(w);
  for (let i = 0; i < w; i++) {
    const idx = row[(i + w - 1) % w] * 4 + row[i] * 2 + row[(i + 1) % w];
    out[i] = (rule >> idx) & 1;
  }
  return out;
}

/* named patterns, '.' dead and 'O' alive */
export const PATTERNS = {
  glider: ['.O.', '..O', 'OOO'],
  blinker: ['OOO'],
  block: ['OO', 'OO'],
  toad: ['.OOO', 'OOO.'],
  lwss: ['.O..O', 'O....', 'O...O', 'OOOO.'],
  rpentomino: ['.OO', 'OO.', '.O.'],
  acorn: ['.O.....', '...O...', 'OO..OOO'],
  gosper: [
    '........................O...........',
    '......................O.O...........',
    '............OO......OO............OO',
    '...........O...O....OO............OO',
    'OO........O.....O...OO..............',
    'OO........O...O.OO....O.O...........',
    '..........O.....O.......O...........',
    '...........O...O....................',
    '............OO......................',
  ],
};
export const PATTERN_NAMES = { glider: 'Glider', blinker: 'Blinker', block: 'Block', toad: 'Toad', lwss: 'Spaceship', rpentomino: 'R-pentomino', acorn: 'Acorn', gosper: 'Glider gun' };

/** Stamp a pattern with its top-left at (x0, y0); cells off the grid are dropped. */
export function stamp(cells, w, h, pattern, x0, y0) {
  pattern.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (row[dx] === 'O' && x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = 1;
    }
  });
  return cells;
}
