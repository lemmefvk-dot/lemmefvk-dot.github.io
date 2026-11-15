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
     incline     s'' = g (sin θ − μk cos θ) while it slides; it only
                 starts when tan θ > μs (static friction can't hold it)
     collision   two carts; while their bumpers touch (overlap δ > 0)
                 each feels ∓(k δ + c δ′), a stiff spring with damping
                 chosen for the restitution e you set (the bounce of a
                 linear spring and damper: e = exp(−ζπ/√(1−ζ²))); at e = 0
                 the damping is critical and they move off together
     orbit       r'' = −GM r/|r|³, in AU, years and Suns (GM = 4π² M);
                 each 1/240 s step (a year of sim time is a second on
                 screen) is split into as many RK4 sub-steps as keep the
                 planet turning less than 0.002 rad per sub-step, so a
                 close pass is stepped finely and a far one coarsely —
                 still the same answer at any frame rate.

   Measured values come from the stepped motion itself (heights,
   landings, zero crossings, contact and the bottom of a slope are
   interpolated inside a step), never from the textbook formula; the
   formulas appear next to them only as a comparison, and only when
   they apply. Every 1/60 s of sim time a row of the state goes into
   sim.log (columns in sim.cols) for the live graph and for CSV: the
   graph and the file come only from the stepped motion. A log keeps
   its last MAX_LOG rows.
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
  incline: {
    name: 'Slope',
    sliders: [
      { key: 'angle', label: 'Slope angle', unit: '°', min: 5, max: 60, step: 1, def: 30 },
      { key: 'muS', label: 'Static friction μs', unit: '', min: 0, max: 1, step: 0.01, def: 0.3 },
      { key: 'muK', label: 'Sliding friction μk', unit: '', min: 0, max: 1, step: 0.01, def: 0.2 },
      { key: 'mass', label: 'Mass', unit: 'kg', min: 0.1, max: 10, step: 0.1, def: 2 },
      { key: 'length', label: 'Slope length', unit: 'm', min: 1, max: 10, step: 0.5, def: 5 },
      { key: 'gravity', label: 'Gravity', unit: 'm/s²', min: 1, max: 25, step: 0.01, def: 9.81 },
    ],
  },
  collision: {
    name: 'Collision',
    sliders: [
      { key: 'm1', label: 'Mass of cart 1', unit: 'kg', min: 0.1, max: 10, step: 0.1, def: 1 },
      { key: 'u1', label: 'Speed of cart 1', unit: 'm/s', min: -6, max: 6, step: 0.1, def: 2 },
      { key: 'm2', label: 'Mass of cart 2', unit: 'kg', min: 0.1, max: 10, step: 0.1, def: 1 },
      { key: 'u2', label: 'Speed of cart 2', unit: 'm/s', min: -6, max: 6, step: 0.1, def: 0 },
      { key: 'e', label: 'Bounce (restitution e)', unit: '', min: 0, max: 1, step: 0.05, def: 1 },
    ],
  },
  orbit: {
    name: 'Orbit',
    sliders: [
      { key: 'mass', label: 'Star’s mass', unit: 'Suns', min: 0.5, max: 5, step: 0.1, def: 1 },
      { key: 'distance', label: 'Starting distance', unit: 'AU', min: 0.3, max: 6, step: 0.001, def: 1 },
      { key: 'speed', label: 'Starting speed (× circular)', unit: '', min: 0.7, max: 1.3, step: 0.01, def: 1 },
    ],
  },
};
/* real planets for the orbit scene: mean distance from the Sun in AU (NASA planetary fact sheet) */
export const PLANETS = [['Mercury', 0.387], ['Venus', 0.723], ['Earth', 1], ['Mars', 1.524], ['Jupiter', 5.203]];

/** What each scene leaves out, said plainly. */
export const NOTES = {
  projectile: 'Simplified: a point mass on a flat, level world; gravity is the same at every height; air drag is quadratic (a = −c·|v|·v) with one constant c, no wind and no spin. Energy is per kilogram.',
  pendulum: 'Simplified: a point mass on a massless, rigid rod, swinging in one plane; damping is a simple drag on the swing (−b·θ′). The swing is the full nonlinear one (sin θ), not the small-angle approximation.',
  spring: 'Simplified: an ideal spring that obeys Hooke’s law at any stretch, a mass sliding without friction on a level track, and damping proportional to speed (−d·v). Energy is real joules for the mass you set.',
  incline: 'Simplified: a block that slides without tipping or rolling, starting at rest at the top; friction follows the textbook model (it can hold up to μs times the push of the slope, and takes μk times it while sliding); no air drag. Heights are measured from the bottom of the slope.',
  collision: 'Simplified: two carts on a level track with no friction, moving along one line. Their bumpers act as a stiff spring with damping, set so the bounce gives the restitution e you chose; a collision lasts about 0.05 s. e = 1 bounces with no loss, e = 0 sticks them together.',
  orbit: 'Simplified: one planet around a star that stays still (the planet’s own pull on the star is left out), and no other planets. Distances are in AU (Earth to Sun), time in years and mass in Suns, so Kepler’s third law reads T² = a³ ÷ M. At 1× one second on screen is one year.',
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

/* Where a quantity q (rate dq) goes through zero inside a step of length h, as a fraction
   of the step: bisection on the cubic Hermite through its values and rates at both ends,
   exact for motion with constant acceleration and close for anything smooth. */
function hermiteZero(q0, d0, q1, d1, h) {
  const H = s => { const s2 = s * s, s3 = s2 * s; return (2 * s3 - 3 * s2 + 1) * q0 + (s3 - 2 * s2 + s) * h * d0 + (-2 * s3 + 3 * s2) * q1 + (s3 - s2) * h * d1; };
  let lo = 0, hi = 1, flo = q0;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2, fm = H(m); if ((fm > 0) === (flo > 0)) { lo = m; flo = fm; } else hi = m; }
  return (lo + hi) / 2;
}

/* ---------- the log: a row of the state every 1/60 s of sim time ---------- */
export const LOG_EVERY = 4;
export const MAX_LOG = 12000;
function logged(sim, cols, row) {
  sim.cols = cols;
  sim.log = [];
  sim.n = 0;
  sim.done = !!sim.done;
  sim.record = function () { this.log.push(row.call(this)); if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG); };
  sim.tick = function () { if (++this.n % LOG_EVERY === 0) this.record(); };
  sim.record();
  return sim;
}
/** The log as CSV text: a header with units, then one row per 1/60 s. */
export function toCsv(sim) {
  const head = sim.cols.map(([, label, unit]) => (unit ? `${label} (${unit})` : label));
  const cell = v => (Number.isFinite(v) ? String(Number(v.toPrecision(10))) : '');
  const q = s => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [head.map(q).join(','), ...sim.log.map(r => r.map(cell).join(','))].join('\n') + '\n';
}

/* ---------- projectile ---------- */
function projectile(p) {
  const th = p.angle * Math.PI / 180;
  const c = p.drag, g = p.gravity;
  const f = ([, , vx, vy]) => { const sp = Math.hypot(vx, vy); return [vx, vy, -c * sp * vx, -g - c * sp * vy]; };
  const E0 = 0.5 * p.speed * p.speed + g * p.height;
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
        this.done = true;
        this.trail.push([this.range, 0]);
        this.record();
        return;
      }
      this.y = next;
      this.t += DT;
      if (next[1] > this.maxHeight) this.maxHeight = next[1];
      if (this.trail.length < 6000 && Math.round(this.t / DT) % 4 === 0) this.trail.push([next[0], next[1]]);
      this.tick();
    },
    energy() { const [, y, vx, vy] = this.y; return 0.5 * (vx * vx + vy * vy) + g * y; },
    energies() {
      const [, y, vx, vy] = this.y, ke = 0.5 * (vx * vx + vy * vy), pe = g * y;
      return { unit: 'J/kg', start: E0, bars: [['ke', 'Kinetic', ke], ['pe', 'Height (potential)', pe], ['lost', 'Lost to air drag', E0 - ke - pe]] };
    },
    measured() {
      const [x, y, vx, vy] = this.y;
      const m = { t: this.t, x, y, speed: Math.hypot(vx, vy), maxHeight: this.maxHeight, range: this.range, flightTime: this.flightTime, energy: this.energy(), energyLost: E0 - this.energy() };
      /* the textbook range only holds for no drag, a launch from the ground */
      m.formulaRange = p.drag === 0 && p.height === 0 ? p.speed * p.speed * Math.sin(2 * th) / g : null;
      return m;
    },
  };
  return logged(sim, [['t', 'Time', 's'], ['x', 'Distance', 'm'], ['y', 'Height', 'm'], ['vx', 'Across speed', 'm/s'], ['vy', 'Up speed', 'm/s'], ['speed', 'Speed', 'm/s'], ['ke', 'Kinetic energy', 'J/kg'], ['pe', 'Potential energy', 'J/kg']],
    function () { const [x, y, vx, vy] = this.y; return [this.t, x, y, vx, vy, Math.hypot(vx, vy), 0.5 * (vx * vx + vy * vy), g * y]; });
}

/* ---------- pendulum ---------- */
const agm = (a, b) => { for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]; return a; };

function pendulum(p) {
  const g = p.gravity, L = p.length, b = p.damping;
  const th0 = p.angle * Math.PI / 180;
  const f = ([th, w]) => [w, -(g / L) * Math.sin(th) - b * w];
  const E0 = g * L * (1 - Math.cos(th0));
  const sim = {
    scene: 'pendulum', params: p, t: 0, acc: 0, status: 'swinging', y: [th0, 0], ups: [], maxAngle: th0, trail: [[L * Math.sin(th0), -L * Math.cos(th0)]],
    step() {
      const prev = this.y;
      const next = rk4(f, prev, DT);
      if (prev[0] < 0 && next[0] >= 0) this.ups.push(this.t + frac(prev[0], next[0]) * DT);
      this.y = next;
      this.t += DT;
      if (this.trail.length < 3000 && Math.round(this.t / DT) % 8 === 0) this.trail.push([L * Math.sin(next[0]), -L * Math.cos(next[0])]);
      this.tick();
    },
    energy() { const [th, w] = this.y; return 0.5 * L * L * w * w + g * L * (1 - Math.cos(th)); },
    energies() {
      const [th, w] = this.y, ke = 0.5 * L * L * w * w, pe = g * L * (1 - Math.cos(th));
      return { unit: 'J/kg', start: E0, bars: [['ke', 'Kinetic', ke], ['pe', 'Height (potential)', pe], ['lost', 'Lost to damping', E0 - ke - pe]] };
    },
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
  return logged(sim, [['t', 'Time', 's'], ['angle', 'Angle', '°'], ['omega', 'Turning speed', 'rad/s'], ['speed', 'Bob speed', 'm/s'], ['ke', 'Kinetic energy', 'J/kg'], ['pe', 'Potential energy', 'J/kg']],
    function () { const [th, w] = this.y; return [this.t, th * 180 / Math.PI, w, Math.abs(L * w), 0.5 * L * L * w * w, g * L * (1 - Math.cos(th))]; });
}

/* ---------- spring ---------- */
function spring(p) {
  const k = p.k, m = p.mass, d = p.damping;
  const f = ([x, v]) => [v, -(k / m) * x - (d / m) * v];
  const E0 = 0.5 * k * p.stretch * p.stretch;
  const sim = {
    scene: 'spring', params: p, t: 0, acc: 0, status: 'oscillating', y: [p.stretch, 0], ups: [],
    step() {
      const prev = this.y;
      const next = rk4(f, prev, DT);
      if (prev[0] < 0 && next[0] >= 0) this.ups.push(this.t + frac(prev[0], next[0]) * DT);
      this.y = next;
      this.t += DT;
      this.tick();
    },
    energy() { const [x, v] = this.y; return 0.5 * m * v * v + 0.5 * k * x * x; },
    energies() {
      const [x, v] = this.y, ke = 0.5 * m * v * v, pe = 0.5 * k * x * x;
      return { unit: 'J', start: E0, bars: [['ke', 'Kinetic', ke], ['pe', 'In the spring (potential)', pe], ['lost', 'Lost to damping', E0 - ke - pe]] };
    },
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
  return logged(sim, [['t', 'Time', 's'], ['x', 'Stretch', 'm'], ['v', 'Velocity', 'm/s'], ['a', 'Acceleration', 'm/s²'], ['ke', 'Kinetic energy', 'J'], ['pe', 'Spring energy', 'J']],
    function () { const [x, v] = this.y; return [this.t, x, v, -(k / m) * x - (d / m) * v, 0.5 * m * v * v, 0.5 * k * x * x]; });
}

/* ---------- a block on a slope ---------- */
function incline(p) {
  const th = p.angle * Math.PI / 180, g = p.gravity, m = p.mass, L = p.length;
  const pull = g * Math.sin(th), grip = p.muK * g * Math.cos(th);
  const a = pull - grip;
  /* it only starts when the slope's pull beats what static friction can give, and keeps going only if sliding friction is less */
  const slips = Math.tan(th) > p.muS;
  const slides = slips && a > 0;
  const f = ([, v]) => [v, a];
  const E0 = m * g * L * Math.sin(th);
  const sim = {
    scene: 'incline', params: p, t: 0, acc: 0, status: slides ? 'ready' : 'held', done: !slides, y: [0, 0], bottomTime: null, bottomSpeed: null, slips, slides,
    step() {
      if (this.done) return;
      const prev = this.y;
      const next = rk4(f, prev, DT);
      if (next[0] >= L) {
        /* the bottom, inside the step */
        const q = hermiteZero(prev[0] - L, prev[1], next[0] - L, next[1], DT);
        this.t += q * DT;
        this.y = [L, prev[1] + q * (next[1] - prev[1])];
        this.bottomTime = this.t; this.bottomSpeed = this.y[1];
        this.status = 'bottom';
        this.done = true;
        this.record();
        return;
      }
      this.status = 'sliding';
      this.y = next;
      this.t += DT;
      this.tick();
    },
    energies() {
      const [s, v] = this.y, ke = 0.5 * m * v * v, pe = m * g * (L - s) * Math.sin(th);
      return { unit: 'J', start: E0, bars: [['ke', 'Kinetic', ke], ['pe', 'Height (potential)', pe], ['lost', 'Heat from friction', E0 - ke - pe]] };
    },
    measured() {
      const [s, v] = this.y;
      return {
        t: this.t, s, v, slips, slides, tanTheta: Math.tan(th),
        /* measured: the speed gained over the time it took (it starts at rest) */
        accel: this.t > 0 ? v / this.t : null,
        bottomTime: this.bottomTime, bottomSpeed: this.bottomSpeed,
        heat: E0 - 0.5 * m * v * v - m * g * (L - s) * Math.sin(th),
        formulaAccel: slides ? a : 0,
        formulaSpeed: slides ? Math.sqrt(2 * a * L) : 0,
        formulaTime: slides ? Math.sqrt(2 * L / a) : null,
        formulaHeat: slides ? p.muK * m * g * Math.cos(th) * L : 0,
      };
    },
  };
  return logged(sim, [['t', 'Time', 's'], ['s', 'Distance down the slope', 'm'], ['v', 'Speed', 'm/s'], ['ke', 'Kinetic energy', 'J'], ['pe', 'Potential energy', 'J'], ['heat', 'Heat from friction', 'J']],
    function () { const [s, v] = this.y; const ke = 0.5 * m * v * v, pe = m * g * (L - s) * Math.sin(th); return [this.t, s, v, ke, pe, E0 - ke - pe]; });
}

/* ---------- two carts colliding on a level track ---------- */
export const CART = 0.6;              /* each cart's length, m */
const CONTACT_S = 0.05;               /* how long the bumpers touch, s */
const SUBC = 16;                      /* sub-steps per 1/240 s step: 1/3840 s, about 190 across a contact */
function collision(p) {
  const { m1, m2, u1, u2, e } = p;
  const mu = m1 * m2 / (m1 + m2);
  /* a spring and damper with this bounce: e = exp(−ζπ/√(1−ζ²)); e = 0 is critical damping */
  const ln = Math.log(Math.max(e, 1e-300));
  const zeta = e <= 0 ? 1 : -ln / Math.sqrt(Math.PI * Math.PI + ln * ln);
  const wn = e <= 0 ? Math.PI / CONTACT_S : Math.PI / CONTACT_S / Math.sqrt(1 - zeta * zeta);
  const kc = mu * wn * wn, cc = 2 * zeta * mu * wn;
  const free = ([, v1, , v2]) => [v1, 0, v2, 0];
  const touch = ([x1, v1, x2, v2]) => { const F = kc * (x1 - x2 + CART) + cc * (v1 - v2); return [v1, -F / m1, v2, F / m2]; };
  const gap = y => y[0] - y[2] + CART;         /* the bumpers' overlap: > 0 while they touch */
  const P0 = m1 * u1 + m2 * u2, K0 = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
  const meet = u1 > u2;
  const sim = {
    scene: 'collision', params: p, t: 0, acc: 0, status: meet ? 'ready' : 'apart', y: [3, u1, 7, u2], contact: false, start: null, end: null, after: null, k: kc,
    step() {
      if (this.done) return;
      const h = DT / SUBC;
      for (let i = 0; i < SUBC; i++) {
        const prev = this.y, fn = this.contact ? touch : free;
        let next = rk4once(fn, prev, h);
        const d0 = gap(prev), d1 = gap(next);
        if (!this.contact && d0 <= 0 && d1 > 0) {
          /* the bumpers meet inside this sub-step: go to that moment, then on with the spring */
          const q = hermiteZero(d0, prev[1] - prev[3], d1, next[1] - next[3], h);
          const mid = rk4once(free, prev, q * h);
          this.contact = true; this.start = this.t + i * h + q * h; this.status = 'touching';
          next = rk4once(touch, mid, (1 - q) * h);
        } else if (this.contact && e > 0 && d0 > 0 && d1 <= 0) {
          /* they part inside this sub-step */
          const q = hermiteZero(d0, prev[1] - prev[3], d1, next[1] - next[3], h);
          const mid = rk4once(touch, prev, q * h);
          this.contact = false; this.end = this.t + i * h + q * h; this.after = [mid[1], mid[3]]; this.status = 'parted';
          next = rk4once(free, mid, (1 - q) * h);
        }
        this.y = next;
      }
      this.t += DT;
      /* stuck together (e = 0): once they move as one, the collision is over */
      if (this.contact && e <= 0 && this.end === null && this.t - this.start > CONTACT_S && Math.abs(this.y[1] - this.y[3]) < 1e-9 * Math.max(1, Math.abs(u1), Math.abs(u2))) {
        this.end = this.t; this.after = [this.y[1], this.y[3]]; this.status = 'together';
      }
      if ((this.end !== null && this.t - this.end > 1.5) || this.t >= 12) this.done = true;
      this.tick();
    },
    momentum() { return m1 * this.y[1] + m2 * this.y[3]; },
    energies() {
      const ke1 = 0.5 * m1 * this.y[1] ** 2, ke2 = 0.5 * m2 * this.y[3] ** 2, d = gap(this.y), sp = this.contact && d > 0 ? 0.5 * kc * d * d : 0;
      return { unit: 'J', start: K0, bars: [['ke1', 'Cart 1 kinetic', ke1], ['ke2', 'Cart 2 kinetic', ke2], ['spring', 'In the bumpers', sp], ['lost', 'Lost (heat and sound)', K0 - ke1 - ke2 - sp]] };
    },
    measured() {
      const [x1, v1, x2, v2] = this.y;
      const A = this.after;
      const K = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;
      return {
        t: this.t, x1, v1, x2, v2, meet, touching: this.contact && this.end === null,
        p0: P0, p: this.momentum(), k0: K0, k: K,
        v1After: A ? A[0] : null, v2After: A ? A[1] : null,
        eMeasured: A && u1 !== u2 ? (A[1] - A[0]) / (u1 - u2) : null,
        lost: A ? K0 - (0.5 * m1 * A[0] * A[0] + 0.5 * m2 * A[1] * A[1]) : null,
        formulaV1: (m1 * u1 + m2 * u2 + m2 * e * (u2 - u1)) / (m1 + m2),
        formulaV2: (m1 * u1 + m2 * u2 + m1 * e * (u1 - u2)) / (m1 + m2),
        formulaLost: 0.5 * mu * (1 - e * e) * (u1 - u2) ** 2,
        duration: this.start !== null && this.end !== null && e > 0 ? this.end - this.start : null,
      };
    },
  };
  return logged(sim, [['t', 'Time', 's'], ['x1', 'Cart 1 position', 'm'], ['v1', 'Cart 1 velocity', 'm/s'], ['x2', 'Cart 2 position', 'm'], ['v2', 'Cart 2 velocity', 'm/s'], ['p', 'Total momentum', 'kg·m/s'], ['k', 'Total kinetic energy', 'J']],
    function () { const [x1, v1, x2, v2] = this.y; return [this.t, x1, v1, x2, v2, m1 * v1 + m2 * v2, 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2]; });
}

/* ---------- a planet round a star ---------- */
const TURN = 0.002;                   /* at most this much of a turn (rad) per sub-step */
function orbit(p) {
  const GM = 4 * Math.PI * Math.PI * p.mass, r0 = p.distance, v0 = p.speed * Math.sqrt(GM / r0);
  const f = ([x, y, vx, vy]) => { const r = Math.hypot(x, y), k = -GM / (r * r * r); return [vx, vy, k * x, k * y]; };
  const E0 = 0.5 * v0 * v0 - GM / r0;
  const sim = {
    scene: 'orbit', params: p, t: 0, acc: 0, status: 'orbiting', y: [r0, 0, 0, v0], ups: [0], rmin: r0, rmax: r0, trail: [[r0, 0]], subs: 0,
    /* the starting point is a crossing of the +x axis going up; so is every return to it */
    step() {
      let t = this.t;
      const r = Math.hypot(this.y[0], this.y[1]), v = Math.hypot(this.y[2], this.y[3]);
      const n = Math.min(4000, Math.max(4, Math.ceil(v * DT / (r * TURN))));
      const h = DT / n;
      for (let i = 0; i < n; i++) {
        const prev = this.y, next = rk4once(f, prev, h);
        if (prev[1] < 0 && next[1] >= 0 && next[0] > 0) this.ups.push(t + hermiteZero(prev[1], prev[3], next[1], next[3], h) * h);
        const rn = Math.hypot(next[0], next[1]);
        if (rn < this.rmin) this.rmin = rn;
        if (rn > this.rmax) this.rmax = rn;
        this.y = next; t += h;
      }
      this.subs += n;
      this.t += DT;
      if (this.trail.length < 8000 && Math.round(this.t / DT) % 2 === 0) this.trail.push([this.y[0], this.y[1]]);
      this.tick();
    },
    energy() { const [x, y, vx, vy] = this.y; return 0.5 * (vx * vx + vy * vy) - GM / Math.hypot(x, y); },
    energies() {
      const [x, y, vx, vy] = this.y, ke = 0.5 * (vx * vx + vy * vy), pe = -GM / Math.hypot(x, y);
      return { unit: 'AU²/yr² per unit mass', start: E0, signed: true, bars: [['ke', 'Kinetic', ke], ['pe', 'Potential (below zero: bound)', pe], ['total', 'Total', ke + pe]] };
    },
    measured() {
      const [x, y, vx, vy] = this.y;
      const orbits = this.ups.length - 1;
      const T = orbits >= 1 ? (this.ups[this.ups.length - 1] - this.ups[0]) / orbits : null;
      /* the semi-major axis and eccentricity from the nearest and farthest points of a whole orbit */
      const a = orbits >= 1 ? (this.rmin + this.rmax) / 2 : null;
      return {
        t: this.t, x, y, r: Math.hypot(x, y), speed: Math.hypot(vx, vy), orbits, period: T,
        rmin: orbits >= 1 ? this.rmin : null, rmax: orbits >= 1 ? this.rmax : null, a,
        e: orbits >= 1 ? (this.rmax - this.rmin) / (this.rmax + this.rmin) : null,
        kepler: a !== null ? Math.sqrt(a * a * a / p.mass) : null,
        ratio: T !== null ? T * T / (a * a * a) : null, ratioFormula: 1 / p.mass,
        energy: this.energy(), energy0: E0,
      };
    },
  };
  return logged(sim, [['t', 'Time', 'years'], ['x', 'x', 'AU'], ['y', 'y', 'AU'], ['r', 'Distance from the star', 'AU'], ['speed', 'Speed', 'AU/year']],
    function () { const [x, y, vx, vy] = this.y; return [this.t, x, y, Math.hypot(x, y), Math.hypot(vx, vy)]; });
}

const MAKERS = { projectile, pendulum, spring, incline, collision, orbit };
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
  while (sim.acc >= DT - 1e-12) { sim.acc -= DT; sim.step(); n++; if (sim.done) { sim.acc = 0; break; } }
  return n;
}

/** Run until `seconds` of simulated time have passed (or the run ends). For tests and checks. */
export function run(sim, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && !sim.done; i++) sim.step();
  return sim;
}

export default { DT, SCENES, NOTES, PLANETS, defaults, clampParams, create, advance, run, toCsv };
