/* ============================================================
   arcade/jumper-core.js — the rules of Pixel Jumper, with no
   canvas, no DOM and no clock. The game (jumper.js), the level
   checker in the tests and the strict reader for shared levels
   (jumper-share.js) all run this one file, so "this level can be
   finished" is proven with the very physics people play on.

   A level is 14 rows of text, 16 to 96 columns wide:

     .  air                     #  solid ground
     =  one-way platform        ^  spikes on the floor
     v  spikes on the ceiling   ~  lava
     B  spring (bounces you up) o  spark (optional collectible)
     C  checkpoint              S  start (exactly one)
     G  goal beacon (exactly one)

   The simulation is a fixed step of 1/60 s. step(sim, mask) takes
   the buttons held for that step (L, R, JUMP bits) and nothing
   else, so the same inputs always give the same run whatever the
   frame rate; the game turns real frames into whole steps.
   A replay is those masks run-length encoded: [[mask, count], …].
   ============================================================ */

export const TILE = 16;
export const ROWS = 14;
export const MIN_COLS = 16, MAX_COLS = 96;
export const MAX_SPARKS = 99, MAX_CHECKPOINTS = 6;
export const DT = 1 / 60;
export const L = 1, R = 2, JUMP = 4;
export const GLYPHS = '.#=^v~BoCSG';
export const MAX_REPLAY_FRAMES = 60 * 300;      /* a five-minute run is the longest a link may carry */
export const MAX_REPLAY_RUNS = 1500;

/* the player: a 10 x 14 box (narrower than a tile, so a one-tile gap is walkable) */
export const PW = 10, PH = 14;
const MAXV = 104, ACC = 1000, FRIC = 1500, ACC_AIR = 720, FRIC_AIR = 260, TURN = 1.8;
const GRAV_UP = 1100, GRAV_DOWN = 1400, MAXFALL = 380;
const JUMP_V = 370, JCUT = 120, SPRING_V = 480;
const COYOTE = 6, BUFFER = 6, DEATH_FRAMES = 36;
export const PHYS = { MAXV, ACC, FRIC, ACC_AIR, FRIC_AIR, GRAV_UP, GRAV_DOWN, MAXFALL, JUMP_V, JCUT, SPRING_V, COYOTE, BUFFER, DEATH_FRAMES };

const C = ch => ch.charCodeAt(0);
const T = { AIR: C('.'), SOLID: C('#'), ONEWAY: C('='), SPIKE: C('^'), SPIKE_DOWN: C('v'), LAVA: C('~'), SPRING: C('B'), SPARK: C('o'), CHECK: C('C'), START: C('S'), GOAL: C('G') };
export const TILES = T;

/* ---------------------------- levels ---------------------------- */

/** Read a level from rows of text. Strict: anything unexpected is refused with a reason. */
export function buildLevel(rows) {
  if (!Array.isArray(rows) || rows.length !== ROWS) return { ok: false, error: `A level is exactly ${ROWS} rows tall.` };
  const w = typeof rows[0] === 'string' ? rows[0].length : 0;
  if (w < MIN_COLS || w > MAX_COLS) return { ok: false, error: `A level is ${MIN_COLS} to ${MAX_COLS} columns wide.` };
  const tiles = new Uint8Array(w * ROWS);
  const level = { w, h: ROWS, tiles, rows: [], start: null, goal: null, cps: [], sparks: [] };
  let starts = 0, goals = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = rows[r];
    if (typeof row !== 'string' || row.length !== w) return { ok: false, error: 'Every row of a level must be the same length.' };
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (GLYPHS.indexOf(ch) < 0) return { ok: false, error: 'This level uses a tile StaticOS does not know.' };
      tiles[r * w + c] = ch.charCodeAt(0);
      if (ch === 'S') { starts++; level.start = { c, r }; }
      else if (ch === 'G') { goals++; level.goal = { c, r }; }
      else if (ch === 'C') level.cps.push({ c, r });
      else if (ch === 'o') level.sparks.push({ c, r });
    }
    level.rows.push(row);
  }
  if (starts !== 1) return { ok: false, error: starts ? 'A level has exactly one start.' : 'This level has no start.' };
  if (goals !== 1) return { ok: false, error: goals ? 'A level has exactly one goal.' : 'This level has no goal.' };
  if (level.cps.length > MAX_CHECKPOINTS) return { ok: false, error: `A level has at most ${MAX_CHECKPOINTS} checkpoints.` };
  if (level.sparks.length > MAX_SPARKS) return { ok: false, error: `A level has at most ${MAX_SPARKS} sparks.` };
  level.cps.sort((a, b) => a.c - b.c || a.r - b.r);
  return { ok: true, level };
}

/** An empty level to start editing: a floor, a start and a goal. */
export function blankRows(w = 40) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) rows.push((r >= 12 ? '#' : '.').repeat(w));
  const put = (r, c, ch) => { rows[r] = rows[r].slice(0, c) + ch + rows[r].slice(c + 1); };
  put(11, 2, 'S'); put(11, w - 3, 'G');
  return rows;
}

const tileAt = (lv, c, r) => (c < 0 || c >= lv.w ? T.SOLID : r < 0 || r >= lv.h ? T.AIR : lv.tiles[r * lv.w + c]);

/* ---------------------------- simulation ---------------------------- */

const spawnOf = (cell) => ({ x: cell.c * TILE + (TILE - PW) / 2, y: (cell.r + 1) * TILE - PH });

export function newSim(level) {
  const sp = spawnOf(level.start);
  return {
    level, x: sp.x, y: sp.y, vx: 0, vy: 0, face: 1,
    ground: false, coyote: 0, buffer: 0, jprev: false, jumping: false,
    frame: 0, dead: 0, deaths: 0, won: false, winFrame: 0,
    cp: -1, spawnX: sp.x, spawnY: sp.y,
    sparks: 0, taken: new Uint8Array(level.sparks.length),
    ev: null,                                   /* the game sets an array here to hear what happens; replays leave it null */
  };
}

const emit = (s, name) => { if (s.ev) s.ev.push(name); };

function die(s) {
  s.dead = DEATH_FRAMES; s.deaths++; s.vx = 0; s.vy = 0;
  emit(s, 'die');
}

/* hazards and pick-ups inside the player's box, in tile-local rectangles */
function touch(s) {
  const lv = s.level;
  const bx0 = s.x + 1, bx1 = s.x + PW - 1, by0 = s.y + 1, by1 = s.y + PH - 1;
  const c0 = Math.floor(bx0 / TILE), c1 = Math.floor(bx1 / TILE), r0 = Math.floor(by0 / TILE), r1 = Math.floor(by1 / TILE);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (c < 0 || c >= lv.w || r < 0 || r >= lv.h) continue;
    const t = lv.tiles[r * lv.w + c];
    if (t === T.AIR || t === T.SOLID || t === T.ONEWAY || t === T.START) continue;
    const tx = c * TILE, ty = r * TILE;
    const hit = (x0, y0, x1, y1) => bx0 < tx + x1 && bx1 > tx + x0 && by0 < ty + y1 && by1 > ty + y0;
    if (t === T.SPIKE) { if (hit(2, 9, 14, 16)) { die(s); return; } }
    else if (t === T.SPIKE_DOWN) { if (hit(2, 0, 14, 7)) { die(s); return; } }
    else if (t === T.LAVA) { if (hit(0, 5, 16, 16)) { die(s); return; } }
    else if (t === T.SPRING) {
      if (hit(1, 8, 15, 16) && s.vy >= 0) { s.vy = -SPRING_V; s.jumping = false; s.ground = false; emit(s, 'spring'); }
    } else if (t === T.SPARK) {
      if (hit(3, 3, 13, 13)) {
        const i = lv.sparks.findIndex(p => p.c === c && p.r === r);
        if (i >= 0 && !s.taken[i]) { s.taken[i] = 1; s.sparks++; emit(s, 'spark'); }
      }
    } else if (t === T.CHECK) {
      if (hit(2, 0, 14, 16)) {
        const i = lv.cps.findIndex(p => p.c === c && p.r === r);
        if (i >= 0 && i !== s.cp) { s.cp = i; const sp = spawnOf(lv.cps[i]); s.spawnX = sp.x; s.spawnY = sp.y; emit(s, 'checkpoint'); }
      }
    } else if (t === T.GOAL) {
      if (hit(2, 0, 14, 16)) { s.won = true; s.winFrame = s.frame; emit(s, 'goal'); return; }
    }
  }
}

/** Advance one fixed step with the buttons in `mask`. */
export function step(s, mask) {
  const lv = s.level;
  const j = (mask & JUMP) !== 0;
  const pressed = j && !s.jprev;
  s.jprev = j;
  if (s.won) return;
  s.frame++;
  if (s.dead > 0) {
    s.dead--;
    if (s.dead === 0) { s.x = s.spawnX; s.y = s.spawnY; s.vx = 0; s.vy = 0; s.buffer = 0; s.coyote = 0; s.ground = false; s.jumping = false; emit(s, 'respawn'); }
    return;
  }

  /* run */
  const dir = ((mask & R) ? 1 : 0) - ((mask & L) ? 1 : 0);
  if (dir) {
    s.face = dir;
    let a = s.ground ? ACC : ACC_AIR;
    if (s.vx !== 0 && (s.vx > 0) !== (dir > 0)) a *= TURN;
    s.vx += dir * a * DT;
    if (s.vx > MAXV) s.vx = MAXV; else if (s.vx < -MAXV) s.vx = -MAXV;
  } else {
    const f = (s.ground ? FRIC : FRIC_AIR) * DT;
    if (s.vx > f) s.vx -= f; else if (s.vx < -f) s.vx += f; else s.vx = 0;
  }

  /* jump: a press is remembered for a few steps, and ground is still "there" for a few steps after a ledge */
  if (pressed) s.buffer = BUFFER; else if (s.buffer > 0) s.buffer--;
  if (s.ground) s.coyote = COYOTE; else if (s.coyote > 0) s.coyote--;
  if (s.buffer > 0 && s.coyote > 0) {
    s.vy = -JUMP_V; s.buffer = 0; s.coyote = 0; s.ground = false; s.jumping = true;
    emit(s, 'jump');
  }
  /* let go early for a short hop */
  if (s.jumping) { if (s.vy >= 0) s.jumping = false; else if (!j && s.vy < -JCUT) s.vy = -JCUT; }

  s.vy += (s.vy < 0 ? GRAV_UP : GRAV_DOWN) * DT;
  if (s.vy > MAXFALL) s.vy = MAXFALL;

  /* x, then y, each against the tiles */
  s.x += s.vx * DT;
  {
    const r0 = Math.floor(s.y / TILE), r1 = Math.floor((s.y + PH - 1e-6) / TILE);
    if (s.vx > 0) {
      const c = Math.floor((s.x + PW - 1e-6) / TILE);
      for (let r = r0; r <= r1; r++) if (tileAt(lv, c, r) === T.SOLID) { s.x = c * TILE - PW; s.vx = 0; break; }
    } else if (s.vx < 0) {
      const c = Math.floor(s.x / TILE);
      for (let r = r0; r <= r1; r++) if (tileAt(lv, c, r) === T.SOLID) { s.x = (c + 1) * TILE; s.vx = 0; break; }
    }
  }
  const prevBottom = s.y + PH;
  s.y += s.vy * DT;
  const wasGround = s.ground;
  s.ground = false;
  {
    const c0 = Math.floor(s.x / TILE), c1 = Math.floor((s.x + PW - 1e-6) / TILE);
    if (s.vy > 0) {
      const r = Math.floor((s.y + PH - 1e-6) / TILE);
      for (let c = c0; c <= c1; c++) {
        const t = tileAt(lv, c, r);
        if (t === T.SOLID || (t === T.ONEWAY && prevBottom <= r * TILE + 1e-6)) { s.y = r * TILE - PH; s.vy = 0; s.ground = true; break; }
      }
    } else if (s.vy < 0) {
      const r = Math.floor(s.y / TILE);
      for (let c = c0; c <= c1; c++) if (tileAt(lv, c, r) === T.SOLID) { s.y = (r + 1) * TILE; s.vy = 0; s.jumping = false; break; }
    }
  }
  if (s.ground && !wasGround) emit(s, 'land');

  touch(s);
  if (!s.dead && !s.won && s.y > lv.h * TILE + 48) die(s);
}

/* ---------------------------- replays ---------------------------- */

export function encodeMasks(masks) {
  const out = [];
  for (const m of masks) {
    const last = out[out.length - 1];
    if (last && last[0] === m && last[1] < 65535) last[1]++; else out.push([m, 1]);
  }
  return out;
}
export const expandRuns = runs => { const out = []; for (const [m, n] of runs) for (let i = 0; i < n; i++) out.push(m); return out; };

/** Strict shape check for a replay that came from outside: [[mask 0-7, count 1-65535], …] within the limits. */
export function cleanReplay(runs) {
  if (!Array.isArray(runs) || runs.length < 1 || runs.length > MAX_REPLAY_RUNS) return null;
  const out = [];
  let frames = 0;
  for (const p of runs) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [m, n] = p;
    if (!Number.isInteger(m) || m < 0 || m > 7 || !Number.isInteger(n) || n < 1 || n > 65535) return null;
    frames += n;
    if (frames > MAX_REPLAY_FRAMES) return null;
    out.push([m, n]);
  }
  return out;
}

/** Run a replay on a level with the real physics. { won, frames, deaths, sparks } */
export function runReplay(level, runs) {
  const s = newSim(level);
  for (const [m, n] of runs) {
    for (let i = 0; i < n; i++) {
      step(s, m);
      if (s.won) return { won: true, frames: s.winFrame, deaths: s.deaths, sparks: s.sparks };
    }
  }
  return { won: false, frames: s.frame, deaths: s.deaths, sparks: s.sparks };
}

/** frames -> "12.34" seconds, for display */
export const fmtFrames = f => (f / 60).toFixed(2);
