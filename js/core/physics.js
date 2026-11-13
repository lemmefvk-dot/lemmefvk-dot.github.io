/* ============================================================
   physics.js (core) — the Physics Sandbox's three scenes. No DOM.

   Every scene is a small system of equations stepped with the
   classical fourth-order Runge–Kutta method at a FIXED step of
   1/240 s. advance(sim, seconds) turns the time the screen reports
   into a whole number of those steps (leftover time is carried to the
   next frame), so the result of a run does not depend on the frame
   rate: a 30 fps screen and a 144 fps screen draw the same motion.
   Each of those steps is itself four RK4 sub-steps of 1/960 s: at the
   slider limits the stiffest spring (ω = √(k/m) ≈ 45 rad/s) then has
   ω·h ≈ 0.05, well inside RK4's stable range (ω·h < 2.8), and loses
   under 0.01% of its energy in two minutes.

   Scenes (what is simplified is listed in NOTES):
     projectile  x'' = -c|v|vx,  y'' = -g - c|v|vy       (c = drag, 1/m)
     pendulum    θ'' = -(g/L) sin θ - b θ'               (b = damping, 1/s)
     spring      x'' = -(k/m) x - (d/m) x'               (d = damping, N·s/m)

   Measured values come from the stepped motion itself (heights,
   landings and zero crossings are interpolated inside a step), never
   from the textbook formula; the formulas appear next to them only as
   a comparison, and only when they apply.
   ============================================================ */

export const DT = 1 / 240;
export const MAX_CATCHUP = 0.25;        /* seconds of screen time folded into one frame, at most */

/** The sliders of each scene: key, label, unit, range, default. */
export const SCENES = {
  projectile: {
    name: 'Projectile',
    sliders: [
      { key: 'speed', label: 'Launch speed', unit: 'm/s', min: 1, max: 60, step: 0.5, def: 20 },
      { key: 'angle', label: 'Launch angle', unit: '°', min: 1, max: 89, step: 1, def: 45 },
      { key: 'gravity', label: 'Gravity', unit: 'm/s²', min: 1, max: 25, step: 0.01, def: 9.81 },
      { key: 'drag', label: 'Air drag', unit: '1/m', min: 0, max: 0.05, step: 0.001, def: 0 },
      { key: 'height', label: 'Launch height', unit: 'm', min: 0, max: 50, step: 0.5, def: 0 },
    ],
  },
  pendulum: {
    name: 'Pendulum',
    sliders: [
      { key: 'length', label: 'Length', unit: 'm', min: 0.1, max: 5, step: 0.05, def: 1 },
      { key: 'gravity', label: 'Gravity', unit: 'm/s²', min: 1, max: 25, step: 0.01, def: 9.81 },
      { key: 'angle', label: 'Starting angle', unit: '°', min: 1, max: 170, step: 1, def: 10 },
      { key: 'damping', label: 'Damping', unit: '1/s', min: 0, max: 2, step: 0.01, def: 0 },
    ],
  },
  spring: {
    name: 'Spring',
    sliders: [
      { key: 'k', label: 'Spring constant', unit: 'N/m', min: 1, max: 200, step: 1, def: 20 },
      { key: 'mass', label: 'Mass', unit: 'kg', min: 0.1, max: 10, step: 0.1, def: 1 },
      { key: 'stretch', label: 'Starting stretch', unit: 'm', min: 0.05, max: 2, step: 0.05, def: 0.5 },
      { key: 'damping', label: 'Damping', unit: 'N·s/m', min: 0, max: 10, step: 0.05, def: 0 },
    ],
  },
};

/** What each scene leaves out, said plainly. */
export const NOTES = {
  projectile: 'Simplified: a point mass on a flat, level world; gravity is the same at every height; air drag is quadratic (a = −c·|v|·v) with one constant c, no wind and no spin. Energy is per kilogram.',
  pendulum: 'Simplified: a point mass on a massless, rigid rod, swinging in one plane; damping is a simple drag on the swing (−b·θ′). The swing is the full nonlinear one (sin θ), not the small-angle approximation.',
  spring: 'Simplified: an ideal spring that obeys Hooke’s law at any stretch, a mass sliding without friction on a level track, and damping proportional to speed (−d·v). Energy is real joules for the mass you set.',
};

export const defaults = scene => Object.fromEntries(SCENES[scene].sliders.map(s => [s.key, s.def]));
const clampTo = (v, s) => { const n = Number(v); return Number.isFinite(n) ? Math.max(s.min, Math.min(s.max, n)) : s.def; };
/** Parameters forced into the slider ranges (anything missing takes its default). */
export function clampParams(scene, p) {
  const out = {};
  for (const s of SCENES[scene].sliders) out[s.key] = clampTo(p && p[s.key], s);
  return out;
}

/* ---------- the integrator ---------- */
const SUB = 4;
function rk4(f, y, dt) {
  const h = dt / SUB;
  for (let i = 0; i < SUB; i++) y = rk4once(f, y, h);
  return y;
}
function rk4once(f, y, dt) {
  const n = y.length;
  const k1 = f(y);
  const y2 = new Array(n), y3 = new Array(n), y4 = new Array(n), out = new Array(n);
  for (let i = 0; i < n; i++) y2[i] = y[i] + 0.5 * dt * k1[i];
  const k2 = f(y2);
  for (let i = 0; i < n; i++) y3[i] = y[i] + 0.5 * dt * k2[i];
  const k3 = f(y3);
  for (let i = 0; i < n; i++) y4[i] = y[i] + dt * k3[i];
  const k4 = f(y4);
  for (let i = 0; i < n; i++) out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return out;
}

/** Linear interpolation of where a quantity that went from a to b crosses zero. */
const frac = (a, b) => (a === b ? 0 : a / (a - b));

/** Mean time between successive upward zero crossings, from the recorded times. */
function periodFrom(ups) {
  if (ups.length < 2) return null;
  const last = ups.slice(-6);
  return (last[last.length - 1] - last[0]) / (last.length - 1);
}

/* ---------- projectile ---------- */
function projectile(p) {
  const th = p.angle * Math.PI / 180;
  const c = p.drag, g = p.gravity;
  const f = ([, , vx, vy]) => { const sp = Math.hypot(vx, vy); return [vx, vy, -c * sp * vx, -g - c * sp * vy]; };
  const sim = {
    scene: 'projectile', params: p, t: 0, acc: 0, status: 'flying', y: [0, p.height, p.speed * Math.cos(th), p.speed * Math.sin(th)],
    maxHeight: p.height, range: null, flightTime: null, trail: [[0, p.height]],
    step() {
      if (this.status !== 'flying') return;
      const prev = this.y;
      const next = rk4(f, prev, DT);
      if (next[1] < 0 && prev[1] >= 0 && (next[3] < 0 || prev[1] > 0)) {
        const q = frac(prev[1], next[1]);          /* inside the step where y reaches 0 */
        this.range = prev[0] + q * (next[0] - prev[0]);
        this.flightTime = this.t + q * DT;
        this.y = [this.range, 0, prev[2] + q * (next[2] - prev[2]), prev[3] + q * (next[3] - prev[3])];
        this.t = this.flightTime;
        this.status = 'landed';
        this.trail.push([this.range, 0]);
        return;
      }
      this.y = next;
      this.t += DT;
      if (next[1] > this.maxHeight) this.maxHeight = next[1];
      if (this.trail.length < 6000 && Math.round(this.t / DT) % 4 === 0) this.trail.push([next[0], next[1]]);
    },
    energy() { const [, y, vx, vy] = this.y; return 0.5 * (vx * vx + vy * vy) + g * y; },
    measured() {
      const [x, y, vx, vy] = this.y;
      const E0 = 0.5 * p.speed * p.speed + g * p.height;
      const m = { t: this.t, x, y, speed: Math.hypot(vx, vy), maxHeight: this.maxHeight, range: this.range, flightTime: this.flightTime, energy: this.energy(), energyLost: E0 - this.energy() };
      /* the textbook range only holds for no drag, a launch from the ground */
      m.formulaRange = p.drag === 0 && p.height === 0 ? p.speed * p.speed * Math.sin(2 * th) / g : null;
      return m;
    },
  };
  return sim;
}

/* ---------- pendulum ---------- */
const agm = (a, b) => { for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]; return a; };

function pendulum(p) {
  const g = p.gravity, L = p.length, b = p.damping;
  const th0 = p.angle * Math.PI / 180;
  const f = ([th, w]) => [w, -(g / L) * Math.sin(th) - b * w];
  const sim = {
    scene: 'pendulum', params: p, t: 0, acc: 0, status: 'swinging', y: [th0, 0], ups: [], maxAngle: th0,
    step() {
      const prev = this.y;
      const next = rk4(f, prev, DT);
      if (prev[0] < 0 && next[0] >= 0) this.ups.push(this.t + frac(prev[0], next[0]) * DT);
      this.y = next;
      this.t += DT;
    },
    energy() { const [th, w] = this.y; return 0.5 * L * L * w * w + g * L * (1 - Math.cos(th)); },
    measured() {
      const [th, w] = this.y;
      const small = 2 * Math.PI * Math.sqrt(L / g);
      return {
        t: this.t, angle: th * 180 / Math.PI, omega: w, speed: Math.abs(L * w),
        energy: this.energy(), period: periodFrom(this.ups), swings: this.ups.length,
        smallAnglePeriod: small,
        /* the exact period for this amplitude, for no damping: T0 / AGM(1, cos(θ0/2)) */
        exactPeriod: b === 0 ? small / agm(1, Math.cos(th0 / 2)) : null,
      };
    },
  };
  return sim;
}

/* ---------- spring ---------- */
function spring(p) {
  const k = p.k, m = p.mass, d = p.damping;
  const f = ([x, v]) => [v, -(k / m) * x - (d / m) * v];
  const sim = {
    scene: 'spring', params: p, t: 0, acc: 0, status: 'oscillating', y: [p.stretch, 0], ups: [],
    step() {
      const prev = this.y;
      const next = rk4(f, prev, DT);
      if (prev[0] < 0 && next[0] >= 0) this.ups.push(this.t + frac(prev[0], next[0]) * DT);
      this.y = next;
      this.t += DT;
    },
    energy() { const [x, v] = this.y; return 0.5 * m * v * v + 0.5 * k * x * x; },
    measured() {
      const [x, v] = this.y;
      const w0 = Math.sqrt(k / m);
      const zeta = d / (2 * Math.sqrt(k * m));
      return {
        t: this.t, x, v, energy: this.energy(), period: periodFrom(this.ups), swings: this.ups.length,
        idealPeriod: 2 * Math.PI / w0,
        dampedPeriod: zeta < 1 ? 2 * Math.PI / (w0 * Math.sqrt(1 - zeta * zeta)) : null,
        overdamped: zeta >= 1,
      };
    },
  };
  return sim;
}

const MAKERS = { projectile, pendulum, spring };
/** A fresh simulation of `scene` with the sliders' values (forced into range). */
export function create(scene, params) {
  if (!MAKERS[scene]) throw new Error(`unknown scene: ${scene}`);
  return MAKERS[scene](clampParams(scene, params));
}

/**
 * Move the simulation on by `seconds` of real time: a whole number of
 * fixed steps. -> the steps taken. Time that doesn't fill a step is kept.
 */
export function advance(sim, seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  sim.acc += Math.min(s, MAX_CATCHUP);
  let n = 0;
  /* the small epsilon stops 1/240 s × 240 from losing a step to rounding */
  while (sim.acc >= DT - 1e-12) { sim.acc -= DT; sim.step(); n++; if (sim.status === 'landed') { sim.acc = 0; break; } }
  return n;
}

/** Run until `seconds` of simulated time have passed (or the projectile lands). For tests and checks. */
export function run(sim, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && sim.status !== 'landed'; i++) sim.step();
  return sim;
}

export default { DT, SCENES, NOTES, defaults, clampParams, create, advance, run };
