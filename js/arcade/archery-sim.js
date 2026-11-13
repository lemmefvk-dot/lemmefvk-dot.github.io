/* ============================================================
   arcade/archery-sim.js — the flight of an arrow, with no drawing,
   so it can be tested on its own.

   Axes, in metres: x to the archer's right, y up, z down the range
   (the target stands at z = distance). The bow is at height 0, the
   same as the target's centre.

   The arrow leaves at V0 m/s and is pulled by
     · gravity            ay = −G − KV·vy
     · air drag on its run ax_z = −KD·vz
     · the crosswind      ax = KW·(wind − vx)
   so a wind of w m/s steadily drags the arrow sideways, and the
   longer it is in the air — the farther the target — the more it
   drifts: roughly w · (t − (1 − e^(−KW·t)) / KW) after t seconds.
   The wind is a pure crosswind (no head or tail wind): a
   simplification.

   The sight is zeroed for every distance: solveAim() finds the
   launch angles that would put the arrow exactly on the aim point
   with no wind and no tremor, so the only things that move the
   arrow off your aim are the wind (read it off the display) and
   the tremor of the hand. Integrated in fixed 1/240 s steps.
   ============================================================ */
export const G = 9.81;
export const V0 = 75;
export const KW = 0.3, KV = 0.02, KD = 0.15;
export const DT = 1 / 240;
export const RING_W = 0.07;                      /* ten rings, 7 cm each: a 1.4 m face */
export const FACE_R = RING_W * 10;
export const THETA = 0.0018;                     /* radians of hand tremor */

/* the five ends: how far, how strong the crosswind can get, how the target slides (amp m, period s) */
export const ENDS = [
  { dist: 20, wind: 2, amp: 0, per: 1 },
  { dist: 30, wind: 4, amp: 0, per: 1 },
  { dist: 40, wind: 5, amp: 0.9, per: 7 },
  { dist: 50, wind: 6, amp: 1.2, per: 6 },
  { dist: 70, wind: 7, amp: 1.5, per: 5 },
];
export const ARROWS_PER_END = 3;

/* the crosswind in m/s at game time t: a slow mix of three waves, never beyond ±max */
export function windAt(t, max, seed = 0) {
  const a = seed * 1.7;
  return max * (0.55 * Math.sin(0.37 * t + a) + 0.3 * Math.sin(0.91 * t + 2 * a + 1) + 0.15 * Math.sin(2.3 * t + 3 * a + 2));
}

/* where the target is at time t (x metres, vx m/s) */
export function targetAt(t, end) {
  if (!end.amp) return { x: 0, vx: 0 };
  const w = (Math.PI * 2) / end.per;
  return { x: end.amp * Math.sin(w * t), vx: end.amp * w * Math.cos(w * t) };
}

export const ringPoints = r => (r < 0 ? 0 : Math.max(0, 10 - Math.floor(r / RING_W)));

export function stepArrow(a, wx, dt = DT) {
  const ax = KW * (wx - a.vx), ay = -G - KV * a.vy, az = -KD * a.vz;
  a.vx += ax * dt; a.vy += ay * dt; a.vz += az * dt;
  a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
  a.t += dt;
  return a;
}

/* a fresh arrow leaving the bow at azimuth psi and elevation theta (radians) */
export function launch(psi, theta) {
  const c = Math.cos(theta);
  return { x: 0, y: 0, z: 0, vx: V0 * Math.sin(psi) * c, vy: V0 * Math.sin(theta), vz: V0 * Math.cos(psi) * c, t: 0 };
}

/* where an arrow launched with (psi, theta) crosses the plane z = dist, in still air */
function still(psi, theta, dist) {
  const a = launch(psi, theta);
  let prev = { ...a };
  for (let i = 0; i < 4000 && a.z < dist; i++) { prev = { ...a }; stepArrow(a, 0); }
  const k = a.z === prev.z ? 0 : (dist - prev.z) / (a.z - prev.z);
  return { x: prev.x + (a.x - prev.x) * k, y: prev.y + (a.y - prev.y) * k };
}

/* the launch angles that hit (aimX, aimY) at `dist` in still air */
export function solveAim(dist, aimX, aimY) {
  let psi = Math.atan2(aimX, dist), theta = Math.atan2(aimY, dist) + 0.5 * G * (dist / V0) * (dist / V0) / dist;
  for (let i = 0; i < 8; i++) {
    const h = still(psi, theta, dist);
    psi += (aimX - h.x) / dist;
    theta += (aimY - h.y) / dist;
  }
  return { psi, theta };
}

/* One whole flight, for tests and previews: the crossing point, the flight time and a path.
   windFn(tau) is the wind tau seconds after release. */
export function fly(dist, aimX, aimY, windFn = () => 0) {
  const { psi, theta } = solveAim(dist, aimX, aimY);
  const a = launch(psi, theta);
  const path = [];
  let prev = { ...a };
  for (let i = 0; i < 4000 && a.z < dist; i++) {
    prev = { ...a };
    stepArrow(a, windFn(a.t));
    if (i % 8 === 0) path.push({ x: a.x, y: a.y, z: a.z });
  }
  const k = a.z === prev.z ? 0 : (dist - prev.z) / (a.z - prev.z);
  return { x: prev.x + (a.x - prev.x) * k, y: prev.y + (a.y - prev.y) * k, time: prev.t + (a.t - prev.t) * k, path };
}
