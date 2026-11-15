/* ============================================================
   arcade/pulserun-sim.js — the rules of Pulse Run, with no drawing.

   A runner (a small glowing bead) moves right at a steady speed. You
   hold a button to jump; everything else is the level. The world is a
   grid of tiles, 12 rows tall; one tile is one unit; the speed is in
   tiles a second, so a sixteenth note of the music is exactly one tile.

   FIXED STEP. The simulation advances in whole steps of 1/240 s. A
   frame of any length is just "run as many steps as the clock allows",
   so the same inputs give the same run at 30, 60 or 144 frames a
   second. Inputs are stamped with a step number (never "the frame they
   arrived in"), and a run is fully described by the level and the list
   of steps on which the button changed.

   Nothing in step() allocates: the run is one flat object of numbers.

   TILES (the glyphs the level strings and the editor use)
     .  empty        #  solid: land on its top, bump your head, crash
                        into its side (a clip of 0.2 tile or less on a
                        corner is forgiven and lifts you on top)
     ^  spike up     v  spike down   (the hurt part is smaller than
                        the drawing, so a graze is safe)
     J  jump pad: throws you high, away from the surface you stand on
     F  flip ring: turns gravity the other way, once per column
     W  wind: inside it the button is a lift and gravity is a drift
                        (hold to rise, let go to sink); a glide
   Falling out of the bottom or the top of the level ends the run.

   FAIRNESS. A press just before landing is remembered for 0.1 s
   (buffer) and you can still jump for 0.08 s after running off an edge
   (coyote time). Letting go early on the way up cuts a jump short, so
   a tap is a hop and a hold is the full jump. Holding on landing jumps
   again.
   ============================================================ */

export const HZ = 240;
export const STEP = 1 / HZ;
export const ROWS = 12;
export const GROUND = 9;                 /* the first row of the floor */
export const HALF = 0.34;                /* half the hitbox, in tiles: smaller than the drawn bead */
export const G = 100;                    /* gravity, tiles per second squared */
export const JUMP = 21;                  /* jump speed: a full jump is 2.2 tiles high and 0.42 s long */
export const CUT = 2.4;                  /* extra gravity while rising with the button up */
export const PAD_V = 27;                 /* a pad throws 3.6 tiles high */
export const VMAX = 26;
export const GL_V = 6;                   /* wind: the speed you rise or sink at */
export const GL_A = 80;
export const BUF_STEPS = 24;             /* 0.1 s */
export const COY_STEPS = 19;             /* 0.08 s */
export const STEP_UP = 0.2;              /* a corner clipped by this much or less is forgiven */
export const HEAD_NUDGE = 0.12;
export const EPS = 1e-6;
export const START_X = 2.5;
export const MIN_COLS = 48;
export const MAX_COLS = 300;
export const FINISH_RUN = 8;             /* the finish is this many tiles from the end of the level */

export const GLYPHS = '.#^vJFW';
const CODE = {};
for (let i = 0; i < GLYPHS.length; i++) CODE[GLYPHS[i]] = i;
export const T = { E: 0, B: 1, UP: 2, DN: 3, PAD: 4, RING: 5, WIND: 6 };

/** the tile codes of a level, from 12 strings of equal length */
export function makeLevel(rows, speed, name = '') {
  const cols = rows[0].length;
  const g = new Uint8Array(cols * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < cols; c++) g[r * cols + c] = CODE[rows[r][c]] || 0;
  return { name, rows, cols, g, speed, bpm: speed * 15, finish: cols - FINISH_RUN };
}
export const tileAt = (L, c, r) => {
  if (c < 0 || c >= L.cols) return r >= GROUND && r < ROWS ? T.B : T.E;
  if (r < 0 || r >= ROWS) return T.E;
  return L.g[r * L.cols + c];
};

export const RUN_KEYS = ['n', 'x', 'y', 'vy', 'dir', 'ground', 'air', 'jumped', 'buf', 'held', 'nocut', 'padCol', 'ringCol', 'dead', 'won', 'why', 'wind', 'jumps'];
const KEYS = RUN_KEYS;

export function newRun() {
  return { n: 0, x: START_X, y: GROUND - HALF, vy: 0, dir: 1, ground: 1, air: 0, jumped: 0, buf: 0, held: 0, nocut: 0, padCol: -1, ringCol: -1, dead: 0, won: 0, why: '', wind: 0, jumps: 0 };
}
export function copyInto(d, s) { for (let i = 0; i < KEYS.length; i++) d[KEYS[i]] = s[KEYS[i]]; return d; }
export const copyRun = s => copyInto({}, s);

/* does the box (x, y, half-size HALF) overlap a solid tile? */
function hitsSolid(L, x, y) {
  const c0 = Math.floor(x - HALF + EPS), c1 = Math.floor(x + HALF - EPS), r0 = Math.floor(y - HALF + EPS), r1 = Math.floor(y + HALF - EPS);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (tileAt(L, c, r) === T.B) return true;
  return false;
}
/* the first and last solid rows the box overlaps (for a step up or a head nudge); -1 when none */
function solidRows(L, x, y, out) {
  const c0 = Math.floor(x - HALF + EPS), c1 = Math.floor(x + HALF - EPS), r0 = Math.floor(y - HALF + EPS), r1 = Math.floor(y + HALF - EPS);
  out.lo = -1; out.hi = -1;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (tileAt(L, c, r) === T.B) { if (out.lo < 0 || r < out.lo) out.lo = r; if (r > out.hi) out.hi = r; }
}
const rows2 = { lo: -1, hi: -1 };

/* the rightmost column of a kind of tile the box touches (inset a little so a graze does not count), or -1 */
function touch(L, x, y, kind) {
  const c0 = Math.floor(x - HALF + 0.04), c1 = Math.floor(x + HALF - 0.04), r0 = Math.floor(y - HALF + 0.04), r1 = Math.floor(y + HALF - 0.04);
  let found = -1;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (tileAt(L, c, r) === kind) { if (found < 0 || c > found) found = c; }
  return found;
}
/* spikes: a narrow, short box inside the drawn triangle */
function hitsSpike(L, x, y) {
  const c0 = Math.floor(x - HALF), c1 = Math.floor(x + HALF), r0 = Math.floor(y - HALF), r1 = Math.floor(y + HALF);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const k = tileAt(L, c, r);
    if (k !== T.UP && k !== T.DN) continue;
    const sx0 = c + 0.3, sx1 = c + 0.7, sy0 = k === T.UP ? r + 0.42 : r, sy1 = k === T.UP ? r + 1 : r + 0.58;
    if (x + HALF > sx0 && x - HALF < sx1 && y + HALF > sy0 && y - HALF < sy1) return true;
  }
  return false;
}

/** advance one step of 1/240 s with the button `held` (true/false) */
export function step(r, L, held) {
  if (r.dead || r.won) return;
  const dir = r.dir;
  r.n++;
  if (held && !r.held) r.buf = BUF_STEPS;
  r.held = held ? 1 : 0;
  /* ---- vertical ---- */
  const inWind = touch(L, r.x, r.y, T.WIND) >= 0;
  r.wind = inWind ? 1 : 0;
  let vy = r.vy;
  if (inWind) {
    const target = held ? -GL_V : GL_V, d = GL_A * STEP;
    vy = vy < target ? Math.min(target, vy + d) : Math.max(target, vy - d);
    r.buf = 0; r.nocut = 0;
  } else {
    if ((r.ground || (r.air <= COY_STEPS && !r.jumped)) && (r.buf > 0 || (held && r.ground))) {
      vy = -dir * JUMP; r.jumped = 1; r.buf = 0; r.ground = 0; r.air = COY_STEPS + 1; r.nocut = 0; r.jumps++;
    }
    let g = G;
    if (!r.nocut && !held && dir * vy < 0) g *= CUT;
    vy += dir * g * STEP;
    if (vy > VMAX) vy = VMAX; else if (vy < -VMAX) vy = -VMAX;
    if (r.nocut && dir * vy >= 0) r.nocut = 0;
  }
  if (r.buf > 0) r.buf--;
  let ny = r.y + vy * STEP;
  let landed = 0;
  if (hitsSolid(L, r.x, ny)) {
    if (vy > 0) { ny = Math.floor(ny + HALF) - HALF; if (dir > 0) landed = 1; }
    else if (vy < 0) { ny = Math.floor(ny - HALF) + 1 + HALF; if (dir < 0) landed = 1; }
    else ny = r.y;
    vy = 0;
  }
  r.y = ny; r.vy = vy;
  if (landed) { r.ground = 1; r.air = 0; r.jumped = 0; } else { r.ground = 0; r.air++; }
  /* ---- forward ---- */
  const nx = r.x + L.speed * STEP;
  if (hitsSolid(L, nx, r.y)) {
    let ok = false;
    solidRows(L, nx, r.y, rows2);
    if (dir > 0) {
      const lift = r.y + HALF - rows2.lo;
      if (lift > 0 && lift <= STEP_UP) { const y2 = rows2.lo - HALF; if (!hitsSolid(L, nx, y2)) { r.y = y2; if (r.vy > 0) r.vy = 0; r.ground = 1; r.air = 0; r.jumped = 0; ok = true; } }
      if (!ok) { const dn = rows2.hi + 1 - (r.y - HALF); if (dn > 0 && dn <= HEAD_NUDGE) { const y2 = rows2.hi + 1 + HALF; if (!hitsSolid(L, nx, y2)) { r.y = y2; if (r.vy < 0) r.vy = 0; ok = true; } } }
    } else {
      const lift = rows2.hi + 1 - (r.y - HALF);
      if (lift > 0 && lift <= STEP_UP) { const y2 = rows2.hi + 1 + HALF; if (!hitsSolid(L, nx, y2)) { r.y = y2; if (r.vy < 0) r.vy = 0; r.ground = 1; r.air = 0; r.jumped = 0; ok = true; } }
      if (!ok) { const dn = r.y + HALF - rows2.lo; if (dn > 0 && dn <= HEAD_NUDGE) { const y2 = rows2.lo - HALF; if (!hitsSolid(L, nx, y2)) { r.y = y2; if (r.vy > 0) r.vy = 0; ok = true; } } }
    }
    if (!ok) { r.dead = 1; r.why = 'wall'; return; }
  }
  r.x = nx;
  /* ---- the things you touch ---- */
  if (hitsSpike(L, r.x, r.y)) { r.dead = 1; r.why = 'spike'; return; }
  const pc = touch(L, r.x, r.y, T.PAD);
  if (pc > r.padCol) { r.padCol = pc; r.vy = -r.dir * PAD_V; r.ground = 0; r.air = COY_STEPS + 1; r.nocut = 1; r.jumped = 1; r.buf = 0; }
  const rc = touch(L, r.x, r.y, T.RING);
  if (rc > r.ringCol) { r.ringCol = rc; r.dir = -r.dir; r.vy = 0; r.ground = 0; r.air = COY_STEPS + 1; r.jumped = 1; r.nocut = 0; }
  if (r.y - HALF > ROWS + 0.5 || r.y + HALF < -0.5) { r.dead = 1; r.why = 'void'; return; }
  if (r.x >= L.finish) r.won = 1;
}

/** how far through the level: 0..100 (100 only when finished) */
export const percent = (r, L) => (r.won ? 100 : Math.max(0, Math.min(99, Math.floor(((r.x - START_X) / (L.finish - START_X)) * 100))));

/* ------------------------------------------------------------
   Input and the clock. A Runner owns one run and the list of steps
   the button changed on (`toggles`, the whole replay). input(held, t)
   takes the sim time `t` (seconds) an event happened at, and
   advanceTo(t) runs every step up to that time.
   ------------------------------------------------------------ */
export class Runner {
  constructor(L) {
    this.L = L; this.r = newRun(); this.toggles = []; this.q = []; this.qi = 0; this.held = false; this.last = false; this.lastStep = -1;
  }
  /** the button changes to `held` at sim time t (never earlier than the next step) */
  input(held, t) {
    held = !!held;
    if (held === this.last) return;
    const s = Math.max(this.r.n, Math.ceil(t / STEP - 1e-9), this.lastStep + 1);
    this.q.push(s, held ? 1 : 0);
    this.last = held; this.lastStep = s;
  }
  advanceTo(t) {
    const target = Math.floor(t / STEP + 1e-9), r = this.r;
    let k = 0;
    while (r.n < target && !r.dead && !r.won) { this.one(); k++; }
    return k;
  }
  one() {
    const r = this.r;
    while (this.qi < this.q.length && this.q[this.qi] <= r.n) { this.held = this.q[this.qi + 1] === 1; this.toggles.push(this.q[this.qi]); this.qi += 2; }
    step(r, this.L, this.held);
  }
}

/** play a recorded run: the steps the button changed on, from a released button; stops at a crash, a win or maxSteps */
export function replay(L, toggles, maxSteps = 240 * 600) {
  const r = newRun();
  let held = false, i = 0;
  while (!r.dead && !r.won && r.n < maxSteps) {
    while (i < toggles.length && toggles[i] <= r.n) { held = !held; i++; }
    step(r, L, held);
  }
  return r;
}
/** a plain checksum of a run's state: equal runs give equal numbers */
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
const HASHED = ['n', 'x', 'y', 'vy', 'dir', 'ground', 'air', 'jumped', 'buf', 'held', 'nocut', 'padCol', 'ringCol', 'dead', 'won', 'jumps'];
export function hashRun(r) {
  let h = 0x811c9dc5;
  for (let i = 0; i < HASHED.length; i++) {
    f64[0] = r[HASHED[i]];
    h = Math.imul(h ^ u32[0], 0x01000193) >>> 0; h = Math.imul(h ^ u32[1], 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** the steps a straight run from start to finish takes */
export const stepsToFinish = L => Math.ceil(((L.finish - START_X) / L.speed) * HZ);
