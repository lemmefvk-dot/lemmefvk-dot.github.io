/* ============================================================
   arcade/beatblocks-logic.js — the rules and the music of Beat
   Blocks, with no screen and no audio in them (the game is
   ./beatblocks.js; the suite plays this module too).

   THE WELL. Seven squares wide, twelve tall. Pieces of two or three
   coloured squares fall into it: a straight bar of three, a corner of
   three, a pair — each square its own colour out of four. A piece
   lands on whatever is below it and stays; then every group of four or
   more squares of one colour that touch along a side clears, the
   squares above fall one by one (not in rows), and groups that form
   from the fall clear too, as a chain. Rows don't clear: only colours
   do. The round ends when a new piece has no room to appear.

   POINTS. 10 per cleared square, times the chain step (1, 2, 3…).

   ON THE BEAT. The music has a beat every `PERIOD` seconds. A piece
   dropped with Space (a hard drop) is judged at the moment of the
   press, against the music's own clock: within PERFECT of a beat the
   clears it makes score ×3, within GOOD ×2. A piece that is soft
   dropped or lands by itself is never on the beat.

   THE MUSIC is written below as data: an original four-bar loop, 16
   sixteenth-note steps to a bar, which the game plays on the Web Audio
   clock a little ahead of time.
   ============================================================ */

export const W = 7;
export const H = 12;
export const COLORS = 4;
export const MIN_GROUP = 4;
export const BPM = 104;
export const PERIOD = 60 / BPM;            /* seconds per beat */
export const PERFECT = 0.045;              /* seconds either side of a beat */
export const GOOD = 0.11;

const SHAPES = {
  bar: [[0, 0], [1, 0], [2, 0]],
  corner: [[0, 0], [1, 0], [0, 1]],
  pair: [[0, 0], [1, 0]],
};
const BAG = ['bar', 'bar', 'bar', 'bar', 'corner', 'corner', 'corner', 'corner', 'pair', 'pair'];

export const emptyBoard = () => Array.from({ length: H }, () => new Array(W).fill(-1));

/** a new piece: { k, cells: [{ dx, dy, c }], x, y } — squares as offsets from (x, y) */
export function spawn(rand = Math.random) {
  const k = BAG[Math.floor(rand() * BAG.length)];
  const cells = SHAPES[k].map(([dx, dy]) => ({ dx, dy, c: Math.floor(rand() * COLORS) }));
  const w = Math.max(...cells.map(c => c.dx)) + 1;
  return { k, cells, x: Math.floor((W - w) / 2), y: 0 };
}

/** a quarter turn clockwise (dir 1) or anticlockwise (-1); colours go with their squares */
export function rotated(piece, dir = 1) {
  const cs = piece.cells.map(c => (dir > 0 ? { dx: -c.dy, dy: c.dx, c: c.c } : { dx: c.dy, dy: -c.dx, c: c.c }));
  const mx = Math.min(...cs.map(c => c.dx)), my = Math.min(...cs.map(c => c.dy));
  return { ...piece, cells: cs.map(c => ({ dx: c.dx - mx, dy: c.dy - my, c: c.c })) };
}

/** does the piece fit at (x, y)? */
export function fits(board, piece, x = piece.x, y = piece.y) {
  return piece.cells.every(c => {
    const px = x + c.dx, py = y + c.dy;
    return px >= 0 && px < W && py >= 0 && py < H && board[py][px] < 0;
  });
}

/** how far down the piece would fall from where it is */
export function dropY(board, piece) {
  let y = piece.y;
  while (fits(board, piece, piece.x, y + 1)) y++;
  return y;
}

/** put the piece into the board */
export function place(board, piece) {
  for (const c of piece.cells) board[piece.y + c.dy][piece.x + c.dx] = c.c;
}

/** groups of MIN_GROUP or more squares of one colour touching along a side: arrays of [x, y] */
export function groups(board) {
  const seen = Array.from({ length: H }, () => new Array(W).fill(false));
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = board[y][x];
    if (c < 0 || seen[y][x]) continue;
    const g = [], st = [[x, y]];
    seen[y][x] = true;
    while (st.length) {
      const [px, py] = st.pop();
      g.push([px, py]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && !seen[ny][nx] && board[ny][nx] === c) { seen[ny][nx] = true; st.push([nx, ny]); }
      }
    }
    if (g.length >= MIN_GROUP) out.push(g);
  }
  return out;
}

/** every square falls as far as it can */
export function settle(board) {
  for (let x = 0; x < W; x++) {
    let to = H - 1;
    for (let y = H - 1; y >= 0; y--) if (board[y][x] >= 0) { const c = board[y][x]; board[y][x] = -1; board[to][x] = c; to--; }
  }
}

/** clear groups, let the rest fall, repeat. -> [{ n, cells }] one entry per chain step */
export function resolve(board) {
  const steps = [];
  for (let guard = 0; guard < 30; guard++) {
    const gs = groups(board);
    if (!gs.length) break;
    const cells = gs.flat();
    for (const [x, y] of cells) board[y][x] = -1;
    settle(board);
    steps.push({ n: cells.length, cells });
  }
  return steps;
}

/** points for a list of chain steps, times a beat multiplier */
export const pointsOf = (steps, mult = 1) => steps.reduce((s, st, i) => s + st.n * 10 * (i + 1), 0) * mult;

/**
 * Judge a moment against the beat. `t` is seconds since the music's first beat, on the music's own clock.
 * -> { dist (seconds to the nearest beat, signed: negative = early), grade: 'perfect' | 'good' | null, mult }
 */
export function judgeBeat(t, period = PERIOD) {
  if (!Number.isFinite(t) || !(period > 0)) return { dist: Infinity, grade: null, mult: 1 };
  const n = Math.round(t / period);
  const dist = t - n * period;
  const a = Math.abs(dist);
  if (n < 0) return { dist, grade: null, mult: 1 };       /* before the first beat there is no beat */
  const grade = a <= PERFECT ? 'perfect' : a <= GOOD ? 'good' : null;
  return { dist, grade, mult: grade === 'perfect' ? 3 : grade === 'good' ? 2 : 1 };
}

/** how long a piece takes per row, in seconds, at this level (1, 2, 3…) */
export const fallTime = level => Math.max(0.16, 0.62 - 0.045 * (level - 1));
export const levelOf = cleared => 1 + Math.floor(cleared / 16);

/* ---------------- the music ----------------
   Chords by bar (A minor – F – C – G), bass roots in MIDI, and a lead that
   walks the chord's notes. Step i (0–63) is a sixteenth note. */
const BASS = [45, 41, 48, 43];
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
const LEAD_PAT = [0, -1, 1, -1, 2, -1, 1, 0, -1, 1, 2, -1, 1, -1, 0, -1];
export const STEPS = 64;
export const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

/** what plays at step i of the loop: { kick, hat, snare, bass, lead } (bass and lead are MIDI numbers or null) */
export function songStep(i) {
  const s = ((i % STEPS) + STEPS) % STEPS, bar = Math.floor(s / 16), k = s % 16;
  const chord = CHORDS[bar];
  const lead = LEAD_PAT[k] >= 0 && (bar !== 3 || k < 12) ? chord[LEAD_PAT[k]] + 12 : null;
  return {
    kick: k % 4 === 0,
    snare: k === 4 || k === 12,
    hat: k % 2 === 1 || k === 8,
    bass: k === 0 || k === 6 || k === 10 || k === 14 ? BASS[bar] + (k === 10 ? 12 : 0) : null,
    lead,
  };
}

export default { W, H, COLORS, BPM, PERIOD, spawn, rotated, fits, dropY, place, groups, settle, resolve, pointsOf, judgeBeat, fallTime, levelOf, songStep, emptyBoard };
