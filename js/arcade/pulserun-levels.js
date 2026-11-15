/* ============================================================
   arcade/pulserun-levels.js — the twelve levels of Pulse Run, and the
   course the "Mixtape" mode builds from a seed.

   A level is a list of bars; a bar is 16 columns, a column is a
   sixteenth note of the music (so a beat is 4 columns and the shapes
   sit on the beat). A bar is written as the few things in it:
       '4:^ 12-13:_'   a spike at column 4, a pit at columns 12 and 13
   or [floorTrack, skyTrack] when it has something above the floor too.

   THE FLOOR TRACK (rows 9–11 are the floor)
     ^  a spike            _  a pit (no floor)
     1–6  a block that many tiles tall      P  a jump pad
     F  a gate: gravity turns the other way
   THE SKY TRACK (above the floor)
     #  a ceiling (rows 0–2)          v  a ceiling with a spike hanging from it
     n  a ceiling with a block hung from it
     W  wind under a ceiling
     a–e  a pillar down from the ceiling with wind beneath it
          (a leaves rows 4–8 free, b rows 5–8, c 6–8, d 7–8, e only row 8)
   Every level is proven completable by a bot in tests/suites/pulserun.mjs,
   and again at a coarser pace (50 ms between its decisions), so a person
   has room.
   ============================================================ */
import { makeLevel, ROWS, GROUND } from './pulserun-sim.js';
import { rng } from './kit.js';

export const BAR = 16;

/** '4:^ 12-13:_' → a 16-character track */
function lay(spec) {
  const out = new Array(BAR).fill('.');
  for (const tok of String(spec || '').trim().split(/\s+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?:(.)$/.exec(tok);
    if (!m) throw new Error(`pulserun bar: bad token "${tok}"`);
    const a = +m[1], b = m[2] === undefined ? a : +m[2];
    if (a > b || b >= BAR) throw new Error(`pulserun bar: bad range "${tok}"`);
    for (let c = a; c <= b; c++) out[c] = m[3];
  }
  return out.join('');
}
const barOf = b => (Array.isArray(b) ? [lay(b[0]), lay(b[1])] : [lay(b), lay('')]);

/** the 12 row strings of a level from its floor and sky tracks */
export function fromTracks(track, sky = '') {
  const cols = track.length;
  const rows = Array.from({ length: ROWS }, () => new Array(cols).fill('.'));
  const set = (r, c, ch) => { if (rows[r][c] === '.') rows[r][c] = ch; };
  for (let c = 0; c < cols; c++) {
    const k = track[c], a = sky[c] || '.';
    if (k !== '_') for (let r = GROUND; r < ROWS; r++) rows[r][c] = '#';
    if (k === '^') rows[GROUND - 1][c] = '^';
    else if (k >= '1' && k <= '6') for (let r = GROUND - Number(k); r < GROUND; r++) rows[r][c] = '#';
    else if (k === 'P') rows[GROUND - 1][c] = 'J';
    else if (k === 'F') for (let r = 3; r < GROUND; r++) rows[r][c] = 'F';
    if (a === '#' || a === 'v' || a === 'n' || a === 'W') for (let r = 0; r < 3; r++) rows[r][c] = '#';
    if (a === 'v') set(3, c, 'v');
    if (a === 'n') set(3, c, '#');
    if (a === 'W') for (let r = 3; r < GROUND; r++) set(r, c, 'W');
    if (a >= 'a' && a <= 'e') {
      const k2 = a.charCodeAt(0) - 96;
      for (let r = 0; r <= 2 + k2; r++) rows[r][c] = '#';
      for (let r = 3 + k2; r < GROUND; r++) set(r, c, 'W');
    }
  }
  return rows.map(r => r.join(''));
}

/** bars → the level's row strings */
export function fromBars(bars) {
  const bs = bars.map(barOf);
  return fromTracks(bs.map(b => b[0]).join(''), bs.map(b => b[1]).join(''));
}

/* song: { root (midi note), mode, prog (scale degrees, one per bar), lead (0 sparse … 2 busy), arp } — see pulserun-music.js */
const D = (id, name, bpm, hue, song, bars) => ({ id, name, bpm, hue, song, bars });

export const DEFS = [
  D('l01', 'First Light', 105, 195, { root: 57, mode: 'minor', prog: [0, 5, 3, 4], lead: 1, arp: 0 },
    ['', '', '8:^', '12:^', '4:^ 12:^', '8-9:_', '4:^ 12-13:_', '8-9:^', '4:^ 12-13:^', '8-9:_ 12:^', '4-5:^ 12-13:_', '8:^', '']),
  D('l02', 'Soft Static', 120, 160, { root: 55, mode: 'dorian', prog: [0, 3, 0, 4], lead: 1, arp: 1 },
    ['', '8:1', '4-5:1 12:^', '8:1 13:1', '4:^ 12:1', '8-9:^', '4:1 8:1 12:^', '6-7:1 8-9:2', '4:^ 12:1', '8-9:_ 13:1', '4:^ 10-11:^', '8:1 12:1', '']),
  D('l03', 'Tin Whistle', 120, 45, { root: 62, mode: 'major', prog: [0, 4, 5, 3], lead: 2, arp: 1 },
    ['', '8-9:^', '4:^ 12-13:^', '8-10:_', '4:^ 11:1', '8-9:^ 14:1', '4-6:_ 12-13:^', '6:1 8:1 10:1 14:^', '4:^ 8:^ 12:^', '8-10:_ 14:^', '4-5:^ 11-12:_', '8:1 9:1 12-13:^', '']),
  D('l04', 'Springboard', 120, 330, { root: 52, mode: 'phrygian', prog: [0, 1, 0, 6], lead: 2, arp: 2 },
    ['', '8:P', '4:1 8:P 12:^', '6:P 9-11:_', '4:^ 12:P', '8:P 10-11:^', '0:P 4:3 12:P', '8:2 11:P', '4:P 6-7:^', '8:P 10-13:_', '4:^ 12:P', '8:P', '']),
  D('l05', 'Updraft', 120, 205, { root: 50, mode: 'lydian', prog: [0, 4, 1, 5], lead: 1, arp: 3 },
    ['', '', ['', '8-15:W'], ['', '0-15:W 4:b 12:b'], ['8:3', '0-15:W 4:a'], ['4:3 12:3', '0-15:W 8:c'], ['6-7:^', '0-15:W 12:b'],
      ['8-9:4', '0-15:W 3:a 15:d'], ['', '0-15:W 4:b 8:b 12:b'], ['5:4 11:4', '0-15:W 3:a 9:a'], ['', '0-7:W'], '', '']),
  D('l06', 'Tilt', 135, 275, { root: 57, mode: 'minor', prog: [0, 2, 5, 4], lead: 2, arp: 1 },
    ['', '', ['8:F', '8-15:#'], ['', '0-15:# 6:v 12:v'], ['', '0-15:# 4-5:v 11:n'], ['', '0-15:# 8:n 12-13:v'], ['8:F', '0-9:#'], '', '4-6:_ 8-9:_ 11:^',
      ['8:F', '8-15:#'], ['', '0-15:# 5:n 10-11:v'], ['', '0-15:# 4:v 8:v 12:v'], ['8:F', '0-9:#'], '']),
  D('l07', 'Switchback', 135, 18, { root: 55, mode: 'dorian', prog: [0, 3, 4, 0], lead: 2, arp: 1 },
    ['', '', '8:^ 12-13:^', '4-6:_ 8-9:_ 11:^', ['8:F', '8-15:#'], ['', '0-15:# 6-8:. 13:v'], ['', '0-15:# 4:n 9:n 13-14:v'], ['', '0-15:# 5-6:. 11:v'], ['8:F', '0-9:#'],
      '4-5:^ 11-12:_', '2:^ 6:^ 10:^ 14:^', ['8:F', '8-15:#'], ['', '0-15:# 5:v 9-10:. 14:n'], ['', '0-15:# 3:n 5:n 8-9:v 12:n'], ['8:F', '0-9:#'], '4:1 5:1 8-9:^', '']),
  D('l08', 'Copper Wire', 150, 30, { root: 53, mode: 'minor', prog: [0, 0, 5, 6], lead: 2, arp: 2 },
    ['', '8-10:^', '5-7:_ 9-11:_', '4:1 8:1 12:1', '4-5:^ 10-11:^', '8:1 9:2 10:2 12-14:^', '4-6:^ 9-11:^', '6-9:_ 14:^', '4:^ 8:^ 12:^',
      '4:1 5:1 7-8:^ 11-12:^', '4-7:_ 9-11:^', '4:1 6:1 8:1 12-14:^', '']),
  D('l09', 'Slipstream', 150, 150, { root: 59, mode: 'lydian', prog: [0, 1, 4, 5], lead: 2, arp: 3 },
    ['', '', '8:P 12:^', ['', '8-15:W'], ['', '0-15:W 4:c 9:c 14:c'], ['6:3 12:3', '0-15:W 3:a 9:a 15:b'], ['', '0-5:W'], '2:P 6-8:_ 12:^', '4:^ 11:P', ['8:F', '8-15:#'],
      ['', '0-15:# 5:v 10:n'], ['', '0-15:# 4:n 8-9:v 13:n'], ['8:F', '0-9:#'], '4:^ 8-9:^ 14:1', '5-7:_ 9-11:_', '']),
  D('l10', 'Kiln', 165, 8, { root: 52, mode: 'phrygian', prog: [0, 1, 6, 0], lead: 2, arp: 2 },
    ['', '8-10:^', '3:1 7:1 11:1 14:^', '4-8:_ 13:^', '4:P 8:2 9:2 12-13:^', '6-8:^ 13-14:_', '4:^ 8:^ 12:1', '2:1 3:2 4:2 5:1 10-12:^', '4-5:^ 9-10:^ 14:1',
      '5-7:_ 9-11:_ 13:^', '4:1 7:1 10:1 13:1', '4-6:^ 10-12:^', '3-5:_ 7:^ 9-11:_', '']),
  D('l11', 'Afterglow', 165, 345, { root: 57, mode: 'minor', prog: [0, 3, 6, 4], lead: 2, arp: 1 },
    ['', '', '8-10:^', ['8:F', '8-15:#'], ['', '0-15:# 5-6:. 11-12:v'], ['', '0-15:# 4:n 8-9:. 13:v'], ['8:F', '0-9:#'], ['', '10-15:W'], ['', '0-15:W 4:b 9:c 14:a'],
      ['4:3 11:3', '0-15:W 2:a 7:a 13:a'], ['', '0-5:W'], '4:^ 8-9:^ 14:^', '5-7:_ 9-11:_ 13:^', ['8:F', '8-15:#'], ['', '0-15:# 6:v 10:n'], ['', '0-15:# 3:n 5:n 8-10:v'], ['8:F', '0-9:#'], '']),
  D('l12', 'Pulse Crown', 180, 55, { root: 59, mode: 'dorian', prog: [0, 4, 5, 3], lead: 2, arp: 3 },
    ['', '8-10:^', '4:1 8:1 12:1', '4-8:_ 13-14:^', '2:P 6:2 7:2 11-12:^', ['8:F', '8-15:#'], ['', '0-15:# 5:v 9:n 13-14:v'], ['', '0-15:# 5-7:. 12:v'], ['8:F', '0-9:#'],
      '4-6:^ 11:1 13:1', '5-7:_ 9-11:_ 13:^', ['', '8-15:W'], ['', '0-15:W 3:b 9:d 14:a'], ['3:3 9:3', '0-15:W 2:a 6:a 12:a'], ['', '0-3:W'], '4:P 6-9:_', '4-6:^ 9-11:^', '3-5:_ 7:^ 9-11:_', '4:^ 8:^ 12:^ 14:^', '']),
];

export function levelOf(def) { return makeLevel(fromBars(def.bars), def.bpm / 15, def.name); }

/* ------------------------------------------------------------
   MIXTAPE: a course made from a seed (the same seed is the same course
   on any device, so Beat-this links and ghosts work). It strings bars
   together from small sets that each leave six flat columns either
   side, so no bar needs the one before it to have been played a
   particular way; a seed is a fresh order, never an unfair one. Every
   seed's course is also played through by the bot in the tests.
   ------------------------------------------------------------ */
const EASY = ['8:^', '6:^ 12:^', '8-9:^', '8-9:_', '8:1', '6:1 11:1', '5:^ 6:^ 10:^', '7:1 8:1 9:2 10:2'];
const HARD = ['6-7:^ 12-13:^', '7-9:_ 13:^', '5:1 7:1 9:1 12:^', '6:P 8-10:_', '5-6:^ 10-11:^', '6:1 7:2 8:2 9:1 12-13:^', '5:^ 8:^ 11:^', '7-9:_ 12:1'];
const FLIP = [['8:F', '8-15:#'], ['', '0-15:# 6:v 12:v'], ['', '0-15:# 4-5:v 11:n'], ['8:F', '0-9:#']];
const WIND = [['', '8-15:W'], ['', '0-15:W 4:b 12:b'], ['8:3', '0-15:W 4:a'], ['', '0-15:W 4:b 8:b 12:b'], ['', '0-7:W']];
export const MIX_BPM = 135;
export function mixDef(seed) {
  const r = rng(seed >>> 0);
  const pick = a => a[Math.floor(r() * a.length)];
  const bars = ['', ''];
  const total = 11 + Math.floor(r() * 3);
  let set = 0;
  for (let i = 0; i < total; i++) {
    const late = i >= total / 2;
    if (!set && i >= 3 && i < total - 4 && r() < 0.28) { bars.push(...pick([FLIP, WIND])); bars.push(''); set = 1; continue; }
    bars.push(pick(late ? HARD : EASY));
  }
  bars.push('', '');
  const modes = ['minor', 'dorian', 'lydian', 'major', 'phrygian'];
  return {
    id: 'mix', name: 'Mixtape', bpm: MIX_BPM, hue: Math.floor(r() * 360),
    song: { root: 48 + Math.floor(r() * 12), mode: pick(modes), prog: [0, pick([2, 3, 4, 5]), pick([3, 4, 5, 6]), pick([0, 4, 5])], lead: 1 + Math.floor(r() * 2), arp: Math.floor(r() * 4) },
    bars,
  };
}
