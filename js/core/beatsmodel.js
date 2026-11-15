/* ============================================================
   beatsmodel.js — the plain data side of Static Beats: no DOM, no audio.

   A grid is { len 8-32, trip, bpm, swing, steps:{row:[level]}, vols, mutes,
   pitch:{row: -12..12 semitones}, decay:{row: 0.3..3 times}, mel:{ notes:[{s,n,l}] } }.
   A level is 0 (rest), 1 soft, 2 medium, 3 loud. Older saves hold true/false
   per step: true reads as medium, and 16 steps, straight, as before.

   trip: the grid is in triplets, three steps to a beat instead of four.
   A step is then a third of a beat, so 12 steps is one bar of 4/4.

   The genre presets below are patterns written for this app from the plain
   shape of each style. Rhythms of a genre are common property; none is
   copied from a particular recording.
   ============================================================ */
export const IDS = ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'rim', 'cowbell'];
export const LEN_MIN = 8, LEN_MAX = 32;
export const LEVEL_GAIN = [0, 0.5, 1, 1.3];
export const LEVEL_NAMES = ['Rest', 'Soft', 'Medium', 'Loud'];
/* General MIDI drum map (channel 10) */
export const DRUM_NOTE = { kick: 36, snare: 38, clap: 39, hat: 42, ohat: 46, tom: 45, rim: 37, cowbell: 56 };
export const MEL_LO = 36, MEL_HI = 84;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const stepDurOf = (bpm, trip) => 60 / bpm / (trip ? 3 : 4);
export const groupOf = trip => (trip ? 3 : 4);
export const emptyRow = len => Array.from({ length: len }, () => 0);
export const lvl = v => (v === true ? 2 : v === false || v == null ? 0 : clamp(Math.round(Number(v)) || 0, 0, 3));

export function normMel(m) {
  const notes = (Array.isArray(m?.notes) ? m.notes : []).slice(0, 256).map(n => ({
    s: clamp(Math.round(Number(n?.s)), 0, LEN_MAX - 1), n: clamp(Math.round(Number(n?.n)), MEL_LO, MEL_HI), l: clamp(Math.round(Number(n?.l)) || 1, 1, LEN_MAX),
  })).filter(n => Number.isFinite(n.s) && Number.isFinite(n.n));
  return { patch: typeof m?.patch === 'string' ? m.patch.slice(0, 20) : 'pluck', vol: clamp(Number.isFinite(m?.vol) ? m.vol : 0.7, 0, 1), notes };
}

/** Anything saved or received in, a complete grid out. */
export function normPattern(p) {
  const len = clamp(Math.round(Number(p?.len)) || 16, LEN_MIN, LEN_MAX);
  const out = { bpm: clamp(Number(p?.bpm) || 120, 40, 240), swing: clamp(Number(p?.swing) || 0, 0, 0.5), len, trip: p?.trip === true || p?.trip === 1,
    steps: {}, vols: {}, mutes: {}, pitch: {}, decay: {}, mel: normMel(p?.mel) };
  for (const id of IDS) {
    const src = Array.isArray(p?.steps?.[id]) ? p.steps[id] : [];
    out.steps[id] = Array.from({ length: len }, (_, i) => lvl(src[i]));
    out.vols[id] = typeof p?.vols?.[id] === 'number' ? clamp(p.vols[id], 0, 1) : 0.8;
    out.mutes[id] = p?.mutes?.[id] === true;
    out.pitch[id] = clamp(Math.round(Number(p?.pitch?.[id]) || 0), -12, 12);
    out.decay[id] = clamp(Number(p?.decay?.[id]) || 1, 0.3, 3);
  }
  out.mel.notes = out.mel.notes.filter(n => n.s < len);
  return out;
}

/** Change the length: steps are cut off or padded with rests. */
export function resize(row, len) { return Array.from({ length: len }, (_, i) => lvl(row[i])); }

/** Rotate a row by k steps (positive moves hits later, wrapping round). */
export function rotate(row, k) {
  const n = row.length;
  if (!n) return row.slice();
  const s = ((k % n) + n) % n;
  return row.map((_, i) => row[(i - s + n) % n]);
}

/** A random row with this share of steps filled; strong beats get a nudge. */
export function randomRow(len, density, id, rnd = Math.random, trip = false) {
  const g = groupOf(trip);
  const row = emptyRow(len);
  for (let s = 0; s < len; s++) {
    let p = density;
    if (id === 'kick') p = s % g === 0 ? Math.min(0.95, density + 0.5) : density * 0.55;
    else if (id === 'snare' || id === 'clap') p = s % (g * 2) === g ? Math.min(0.95, density + 0.55) : density * 0.3;
    else if (id === 'hat') p = Math.min(0.95, density + 0.25);
    else p = density * 0.4;
    if (rnd() < p) row[s] = rnd() < 0.2 ? 3 : rnd() < 0.25 ? 1 : 2;
  }
  return row;
}

/* ---- genre presets. '.' rest, 'o' soft, 'x' medium, 'X' loud. ---- */
const rowOf = (str, len) => Array.from({ length: len }, (_, i) => ({ o: 1, x: 2, X: 3 }[str[i]] || 0));
export const PRESETS = [
  { name: 'Four on the Floor', bpm: 124, swing: 0, rows: { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.' } },
  { name: 'Boom Bap', bpm: 90, swing: 0.16, rows: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } },
  { name: 'Trap', bpm: 140, swing: 0, rows: { kick: 'x.......x..x....', snare: '....x.......x...', hat: 'x.x.xxx.x.x.xxxx' } },
  { name: 'Rock', bpm: 120, swing: 0, rows: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } },
  { name: 'Breakbeat', bpm: 166, swing: 0, rows: { kick: 'x......x..x.....', snare: '....x..x....x..x', hat: 'x.x.x.x.x.x.x.x.' } },
  { name: 'Techno', bpm: 130, swing: 0, rows: { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.', rim: '..x.x...x...x.x.' } },
  { name: 'Half-Time', bpm: 84, swing: 0.2, rows: { kick: 'x.......x..x....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.', tom: '..............x.' } },
  /* the genre set: each pattern is written fresh here */
  { name: 'House', genre: true, bpm: 122, swing: 0.06, rows: { kick: 'X...X...X...X...', clap: '....x.......x..o', hat: 'o.x.o.x.o.x.o.xo', ohat: '..X...X...X...X.', rim: '.......o.......o' } },
  { name: 'Reggaeton (dembow)', genre: true, bpm: 94, swing: 0, rows: { kick: 'X...X...X...X...', snare: '...x..x....x..x.', hat: 'x.x.x.x.x.x.x.x.', rim: '.o..o...o..o....' } },
  { name: 'Dub', genre: true, bpm: 72, swing: 0.1, rows: { kick: '........X.......', rim: '........x.......', snare: '................', hat: 'o...o...o...o...', ohat: '....x.......x...', tom: '..............o.', cowbell: '...........o....' } },
  { name: 'Drum and Bass', genre: true, bpm: 172, swing: 0, rows: { kick: 'X.........x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', ohat: '......x.......x.', rim: '.......o..o.....' } },
  { name: 'Bossa', genre: true, bpm: 128, swing: 0, rows: { kick: 'x..x..x.x..x..x.', rim: 'x..x..x...x..x..', hat: 'o.o.o.o.o.o.o.o.', ohat: '..............x.', cowbell: '................' } },
];
export function presetGrid(p) {
  const steps = {};
  for (const id of IDS) steps[id] = p.rows[id] ? rowOf(p.rows[id].padEnd(16, '.'), 16) : emptyRow(16);
  return normPattern({ bpm: p.bpm, swing: p.swing, len: 16, steps });
}

/** When step s of a bar sounds, in seconds from the bar's start (swing only on straight grids). */
export function stepTime(snap, s) {
  const sd = stepDurOf(snap.bpm, snap.trip);
  return s * sd + (!snap.trip && s % 2 === 1 ? sd * snap.swing : 0);
}

/** MIDI tracks for a grid played `loops` times: one drum track (channel 10) and, if it has any, a melody track. */
export function midiTracks(snap, loops = 1, ppq = 480) {
  const sd = ppq / (snap.trip ? 3 : 4);                 /* ticks per step */
  const drums = [];
  for (let k = 0; k < loops; k++) {
    for (let s = 0; s < snap.len; s++) {
      const tick = (k * snap.len + s) * sd + (!snap.trip && s % 2 === 1 ? sd * snap.swing : 0);
      for (const id of IDS) {
        const l = snap.steps[id][s];
        if (!l || snap.mutes[id]) continue;
        drums.push({ tick, dur: Math.max(1, sd / 2), note: DRUM_NOTE[id], vel: clamp([0, 0.4, 0.75, 1][l] * (0.4 + 0.6 * snap.vols[id]), 0.05, 1) });
      }
    }
  }
  const tracks = [{ name: 'Drums', ch: 9, notes: drums }];
  if (snap.mel.notes.length) {
    const mel = [];
    for (let k = 0; k < loops; k++) for (const n of snap.mel.notes) mel.push({ tick: (k * snap.len + n.s) * sd, dur: n.l * sd * 0.95, note: n.n, vel: 0.8 * (0.4 + 0.6 * snap.mel.vol) });
    tracks.push({ name: 'Melody', ch: 0, notes: mel });
  }
  return tracks;
}

export default { IDS, PRESETS, presetGrid, normPattern, rotate, randomRow, resize, midiTracks, stepTime, stepDurOf };
