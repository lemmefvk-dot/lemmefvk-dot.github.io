/* ============================================================
   arcade/lap-track.js — the circuits, the car and the ghost of
   Lap Rush, with no drawing and no clock, so they can be tested
   on their own.

   A circuit is a closed smooth curve through a few control
   points, sampled every ~6 px into a centreline. `locate()` finds
   where along it a car is, and a lap is counted when the car has
   made progress all the way round (going backwards takes progress
   away), so a corner cannot be cut through the infield.

   The car is a point with a heading: throttle, brake and steering
   in; a forward speed that drag and the grass hold back, and a
   sideways slide that grip kills. Everything advances in fixed
   steps (the caller's DT).

   The ghost is a lap's path sampled at a fixed GHOST_HZ: x and y
   in half pixels and the heading in hundredths of a radian,
   as three integer arrays, so it is small and survives JSON.
   ============================================================ */
export const WORLD = { w: 1000, h: 640 };
export const HALF = 44;                          /* half the road's width, px */
export const GHOST_HZ = 20;
export const MAX_SAMPLES = 1600;                 /* 80 s: a longer lap is not kept */
export const MAX_LAP_MS = (MAX_SAMPLES / GHOST_HZ) * 1000;

export const TRACKS = [
  { id: 'harbour', name: 'Harbour Loop', hue: 200, pts: [[500, 100], [820, 110], [920, 260], [800, 380], [900, 520], [620, 570], [420, 470], [250, 560], [90, 440], [140, 260], [300, 180]] },
  { id: 'ridge', name: 'Ridge Run', hue: 28, pts: [[110, 110], [400, 80], [540, 190], [420, 290], [700, 330], [880, 200], [930, 480], [640, 570], [330, 470], [140, 570], [60, 340]] },
  { id: 'sprint', name: 'Switchback Sprint', hue: 330, pts: [[120, 100], [480, 70], [640, 170], [470, 250], [330, 330], [500, 400], [700, 330], [880, 250], [930, 500], [700, 580], [420, 560], [180, 520], [70, 320]] },
  /* the second cup */
  { id: 'dock', name: 'Dockside Hairpin', hue: 175, pts: [[150, 90], [520, 80], [870, 110], [920, 280], [760, 330], [600, 290], [470, 360], [640, 450], [880, 470], [860, 580], [520, 575], [200, 570], [80, 420], [110, 250]] },
  { id: 'mesa', name: 'Mesa Esses', hue: 45, pts: [[100, 320], [160, 110], [360, 90], [440, 240], [560, 110], [760, 80], [920, 200], [850, 330], [930, 480], [760, 566], [560, 470], [400, 566], [200, 550]] },
  { id: 'ring', name: 'Night Ring', hue: 265, pts: [[500, 70], [800, 100], [930, 320], [800, 550], [500, 572], [330, 515], [260, 400], [130, 560], [70, 320], [180, 120]] },
];
/* a cup: three circuits, one lap each (the Arcade's modes) */
export const CUPS = { cup: ['harbour', 'ridge', 'sprint'], cup2: ['dock', 'mesa', 'ring'] };

function spline(pts, step = 6) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(4, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  /* resample to an even spacing */
  let total = 0;
  for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; total += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const m = Math.round(total / step), even = [];
  let acc = 0, idx = 0, segLen = Math.hypot(out[1][0] - out[0][0], out[1][1] - out[0][1]);
  for (let s = 0; s < m; s++) {
    const want = (s * total) / m;
    while (acc + segLen < want && idx < out.length - 1) { acc += segLen; idx++; const a = out[idx], b = out[(idx + 1) % out.length]; segLen = Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const a = out[idx], b = out[(idx + 1) % out.length], f = segLen ? (want - acc) / segLen : 0;
    even.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return even;
}

const built = new Map();
/* the circuit with its centreline `c` (N points, one every `gap` px) and its length */
export function circuit(id) {
  if (built.has(id)) return built.get(id);
  const def = TRACKS.find(t => t.id === id) || TRACKS[0];
  const c = spline(def.pts);
  const N = c.length;
  let len = 0;
  for (let i = 0; i < N; i++) len += Math.hypot(c[(i + 1) % N][0] - c[i][0], c[(i + 1) % N][1] - c[i][1]);
  const a = c[0], b = c[1];
  const tr = { id: def.id, name: def.name, hue: def.hue, c, N, length: len, gap: len / N, start: { x: a[0], y: a[1], h: Math.atan2(b[1] - a[1], b[0] - a[0]) } };
  built.set(id, tr);
  return tr;
}

/* the nearest centreline point to (x, y), looking only a few points either side of `near` */
export function locate(tr, near, x, y, win = 14) {
  const { c, N } = tr;
  let best = near, bd = Infinity;
  for (let k = -win; k <= win; k++) {
    const i = (((near + k) % N) + N) % N;
    const d = (c[i][0] - x) ** 2 + (c[i][1] - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  /* refine on the two neighbouring segments */
  let off = Math.sqrt(bd), frac = 0;
  for (const j of [(best + N - 1) % N, best]) {
    const a = c[j], b = c[(j + 1) % N], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y);
    if (d <= off + 1e-9) { off = d; best = j; frac = t; }
  }
  return { idx: best, frac, off };
}
const wrapDiff = (d, N) => { d %= N; if (d > N / 2) d -= N; else if (d < -N / 2) d += N; return d; };

/* ------------------------------ the car ------------------------------ */
export const CAR = { acc: 230, vmax: 300, brake: 520, drag: 0.25, grip: 7, steer: 2.5, grassMax: 0.5, grassDrag: 1.6, grassGrip: 3.5 };

export function newCar(tr) {
  return { x: tr.start.x, y: tr.start.y, h: tr.start.h, vx: 0, vy: 0, idx: 0, prog: 0, off: 0, onRoad: true };
}

/* advance the car by dt seconds; in = { thr 0..1, brake 0..1, steer -1..1 } */
export function stepCar(car, tr, inp, dt) {
  const C = CAR;
  const fx = Math.cos(car.h), fy = Math.sin(car.h);
  let vf = car.vx * fx + car.vy * fy, vl = -car.vx * fy + car.vy * fx;
  const vmax = car.onRoad ? C.vmax : C.vmax * C.grassMax;
  const thr = Math.max(0, Math.min(1, inp.thr || 0)), brk = Math.max(0, Math.min(1, inp.brake || 0));
  if (thr) vf += C.acc * thr * (1 - Math.max(0, Math.min(1, vf / vmax))) * dt;
  if (brk) { if (vf > 0) vf = Math.max(0, vf - C.brake * brk * dt); else vf = Math.max(-70, vf - C.acc * 0.35 * brk * dt); }
  const over = vf > vmax ? 1.5 : 0;
  vf -= vf * ((car.onRoad ? C.drag : C.grassDrag) + over) * dt;
  vl *= Math.exp(-(car.onRoad ? C.grip : C.grassGrip) * dt);
  const sp = Math.abs(vf);
  const turn = (inp.steer || 0) * C.steer * Math.min(1, sp / 70) * (1 - 0.3 * Math.min(1, sp / C.vmax)) * (vf < 0 ? -1 : 1);
  car.h += turn * dt;
  const nfx = Math.cos(car.h), nfy = Math.sin(car.h);
  car.vx = nfx * vf - nfy * vl; car.vy = nfy * vf + nfx * vl;
  car.x += car.vx * dt; car.y += car.vy * dt;
  /* the edge of the world is a soft wall */
  if (car.x < 8) { car.x = 8; car.vx = Math.abs(car.vx) * 0.3; }
  if (car.x > WORLD.w - 8) { car.x = WORLD.w - 8; car.vx = -Math.abs(car.vx) * 0.3; }
  if (car.y < 8) { car.y = 8; car.vy = Math.abs(car.vy) * 0.3; }
  if (car.y > WORLD.h - 8) { car.y = WORLD.h - 8; car.vy = -Math.abs(car.vy) * 0.3; }
  const was = car.idx + 0;
  const loc = locate(tr, car.idx, car.x, car.y);
  car.prog += wrapDiff(loc.idx + loc.frac - (was + (car.frac || 0)), tr.N);
  car.idx = loc.idx; car.frac = loc.frac; car.off = loc.off;
  car.onRoad = loc.off <= HALF;
  return car;
}
export const speedOf = car => Math.hypot(car.vx, car.vy);

/* A steady computer driver, for the self-test and the test hook: follow the centreline a little
   ahead and keep the throttle at `cap` (0..1), easing off into tight corners. */
export function autoDrive(car, tr, cap = 1) {
  const sp = speedOf(car);
  const look = Math.round(7 + sp / 22);
  const tgt = tr.c[(car.idx + look) % tr.N];
  const want = Math.atan2(tgt[1] - car.y, tgt[0] - car.x);
  let e = want - car.h;
  while (e > Math.PI) e -= 2 * Math.PI;
  while (e < -Math.PI) e += 2 * Math.PI;
  const steer = Math.max(-1, Math.min(1, e * 2.6));
  const far = tr.c[(car.idx + look * 2 + 6) % tr.N];
  let e2 = Math.atan2(far[1] - car.y, far[0] - car.x) - car.h;
  while (e2 > Math.PI) e2 -= 2 * Math.PI;
  while (e2 < -Math.PI) e2 += 2 * Math.PI;
  const corner = Math.min(1, Math.abs(e2) / 1.1);
  const safe = 300 * (1 - 0.62 * corner);
  const brake = sp > safe + 25 ? 1 : 0;
  const thr = brake ? 0 : sp > safe ? 0.3 * cap : cap;
  return { thr, brake, steer };
}

/* ------------------------------ the ghost ------------------------------ */
/* the lap's samples: arrays of ints, one per 1/GHOST_HZ seconds, the last one at the line */
export function packGhost(samples, ms) {
  return { t: Math.round(ms), n: samples.length, x: samples.map(s => Math.round(s.x * 2)), y: samples.map(s => Math.round(s.y * 2)), h: samples.map(s => Math.round((((s.h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 100)) };
}
/* check a saved ghost; returns it (cleaned) or null. Nothing from storage is trusted. */
export function readGhost(g) {
  if (!g || typeof g !== 'object') return null;
  const { t, n, x, y, h } = g;
  if (!Number.isInteger(t) || t < 2000 || t > MAX_LAP_MS) return null;
  if (!Number.isInteger(n) || n < 3 || n > MAX_SAMPLES) return null;
  for (const a of [x, y, h]) if (!Array.isArray(a) || a.length !== n) return null;
  for (let i = 0; i < n; i++) {
    if (!Number.isInteger(x[i]) || !Number.isInteger(y[i]) || !Number.isInteger(h[i])) return null;
    if (x[i] < -50 || x[i] > WORLD.w * 2 + 50 || y[i] < -50 || y[i] > WORLD.h * 2 + 50 || h[i] < 0 || h[i] > 629) return null;
  }
  /* the samples must span about the lap time */
  if (Math.abs((n - 1) / GHOST_HZ - t / 1000) > 1.2) return null;
  return { t, n, x: x.slice(), y: y.slice(), h: h.slice() };
}
export const ghostBytes = g => JSON.stringify(g).length;

/* where the ghost is `sec` seconds into its lap: { x, y, h } or null once it has crossed the line */
export function ghostAt(g, sec) {
  if (!g) return null;
  const T = g.t / 1000;
  if (sec < 0) sec = 0;
  if (sec > T) return null;
  const last = g.n - 1;
  const pos = sec <= (last - 1) / GHOST_HZ ? sec * GHOST_HZ : (last - 1) + (sec - (last - 1) / GHOST_HZ) / (T - (last - 1) / GHOST_HZ || 1);
  const i = Math.min(last - 1, Math.floor(pos)), f = Math.min(1, pos - i);
  let dh = (g.h[i + 1] - g.h[i]) / 100;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  return { x: (g.x[i] + (g.x[i + 1] - g.x[i]) * f) / 2, y: (g.y[i] + (g.y[i + 1] - g.y[i]) * f) / 2, h: g.h[i] / 100 + dh * f };
}
/* the ghost's progress (in centreline points) at each of its samples, so a gap can be read off */
export function ghostProgress(tr, g) {
  const out = new Array(g.n);
  let idx = 0, frac = 0, prog = 0;
  for (let i = 0; i < g.n; i++) {
    const x = g.x[i] / 2, y = g.y[i] / 2;
    if (i === 0) { idx = 0; frac = 0; }
    const loc = locate(tr, idx, x, y, 20);
    prog += wrapDiff(loc.idx + loc.frac - (idx + frac), tr.N);
    idx = loc.idx; frac = loc.frac;
    out[i] = Math.max(i ? out[i - 1] : 0, prog);
  }
  return out;
}
/* ------------------------------ a ghost as a code ------------------------------
   A friend's ghost travels as text they paste in: "LR1.<circuit>.<data>".
   The data is base64url of: the lap time and the sample count, the first
   sample, then each sample's change from the last (zigzag varints: a car
   moves a few px each 1/20 s, so most changes are one byte), and a
   32-bit FNV-1a checksum of all of that, so a code cut short or mistyped
   is caught. A code that decodes is still checked like a saved ghost
   (readGhost) and then against the circuit itself (checkLap): it must
   start on the line, stay near the road, never go faster than the car
   can, and make it all the way round. What replays is exactly the lap
   the friend drove, sample for sample. */
const fnv = bytes => { let hh = 0x811c9dc5; for (const b of bytes) { hh ^= b; hh = Math.imul(hh, 0x01000193) >>> 0; } return hh >>> 0; };
const zig = n => (n >= 0 ? n * 2 : -n * 2 - 1), unzig = n => (n & 1 ? -(n + 1) / 2 : n / 2);
function putVar(out, n) { while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); }
function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); } catch (err) { return null; }
}
export function ghostCode(trackId, g) {
  const out = [];
  putVar(out, g.t); putVar(out, g.n);
  putVar(out, zig(g.x[0])); putVar(out, zig(g.y[0])); putVar(out, g.h[0]);
  for (let i = 1; i < g.n; i++) {
    let dh = g.h[i] - g.h[i - 1];
    if (dh > 314) dh -= 629; else if (dh < -314) dh += 629;
    putVar(out, zig(g.x[i] - g.x[i - 1])); putVar(out, zig(g.y[i] - g.y[i - 1])); putVar(out, zig(dh));
  }
  const c = fnv(out);
  out.push(c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255);
  return `LR1.${trackId}.${b64(out)}`;
}
/* text → { track, g } or { error } (a sentence to show) */
export function readGhostCode(text) {
  const m = /^LR1\.([a-z0-9]{2,12})\.([A-Za-z0-9_-]{8,})$/.exec(String(text || '').replace(/\s+/g, ''));
  if (!m) return { error: 'That isn’t a Lap Rush ghost code: it starts with LR1.' };
  const tr = TRACKS.find(t => t.id === m[1]);
  if (!tr) return { error: 'That code is for a circuit this Lap Rush doesn’t have.' };
  const bytes = unb64(m[2]);
  if (!bytes || bytes.length < 12) return { error: 'That code is cut short or has a mistake in it.' };
  const body = bytes.subarray(0, bytes.length - 4), sum = bytes.subarray(bytes.length - 4);
  const want = ((sum[0] << 24) | (sum[1] << 16) | (sum[2] << 8) | sum[3]) >>> 0;
  if (fnv(body) !== want) return { error: 'That code is cut short or has a mistake in it.' };
  let i = 0;
  const get = () => { let n = 0, k = 1; for (;;) { if (i >= body.length) throw new Error('short'); const b = body[i++]; n += (b & 0x7f) * k; if (b < 0x80) return n; k *= 128; if (k > 2 ** 35) throw new Error('long'); } };
  let g;
  try {
    const t = get(), n = get();
    if (n < 3 || n > MAX_SAMPLES) return { error: 'That code’s lap is too short or too long to be one lap.' };
    const x = [unzig(get())], y = [unzig(get())], h = [get()];
    for (let k = 1; k < n; k++) {
      x.push(x[k - 1] + unzig(get())); y.push(y[k - 1] + unzig(get()));
      h.push((((h[k - 1] + unzig(get())) % 629) + 629) % 629);
    }
    if (i !== body.length) return { error: 'That code is cut short or has a mistake in it.' };
    g = readGhost({ t, n, x, y, h });
  } catch (err) { return { error: 'That code is cut short or has a mistake in it.' }; }
  if (!g) return { error: 'That code doesn’t hold a lap Lap Rush can replay.' };
  const why = checkLap(circuit(tr.id), g);
  if (why) return { error: why };
  return { track: tr.id, g };
}
/* Is this ghost one real lap of this circuit? null if so, else why not */
export function checkLap(tr, g) {
  const s = tr.start;
  if (Math.hypot(g.x[0] / 2 - s.x, g.y[0] / 2 - s.y) > 30) return 'That lap doesn’t start on this circuit’s line.';
  /* the fastest the car can go, with a little room for the sampling */
  const step = (CAR.vmax * 1.15) / GHOST_HZ * 2;
  let near = 0;
  for (let i = 0; i < g.n; i++) {
    if (i && Math.hypot(g.x[i] - g.x[i - 1], g.y[i] - g.y[i - 1]) > step + 1) return 'That lap goes faster than a Lap Rush car can.';
    near = locate(tr, near, g.x[i] / 2, g.y[i] / 2, i ? 14 : tr.N).idx;
    if (locate(tr, near, g.x[i] / 2, g.y[i] / 2).off > HALF * 3) return 'That lap leaves the circuit.';
  }
  const gp = ghostProgress(tr, g);
  if (gp[gp.length - 1] < tr.N - 3) return 'That isn’t a whole lap of this circuit.';
  return null;
}

/* seconds into its lap at which the ghost had made `prog` progress; null if it never did */
export function ghostTimeAt(g, gp, prog) {
  if (prog <= 0) return 0;
  if (prog > gp[gp.length - 1]) return null;
  let lo = 0, hi = gp.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (gp[m] < prog) lo = m; else hi = m; }
  const span = gp[hi] - gp[lo], f = span > 1e-9 ? (prog - gp[lo]) / span : 0;
  const t0 = lo / GHOST_HZ, t1 = hi === g.n - 1 ? g.t / 1000 : hi / GHOST_HZ;
  return t0 + (t1 - t0) * f;
}
