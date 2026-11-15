/* ============================================================
   arcade/bridgebuilder-logic.js — the rules and the strength check
   of Bridge Builder, no DOM.

   A level is a gap between two cliffs, with a budget and a truck:
     { id, name, span (x of the right cliff's edge; the left is 0),
       anchors: [[x, y]…] fixed joints (the cliff edges first: the
       left deck end, then the right; then any wall or pier joints),
       truck (its weight), budget }
   y counts DOWN: the road starts at y = 0, the cliff tops. You may
   put joints on any whole-number point between the cliffs (x from
   1 to span-1, y from -4 to +3) and join two joints with a beam of
   one of three kinds (MATERIALS):
     road   the deck; the truck drives on road beams
     wood   cheap, weak
     steel  dear, strong
   A beam costs its length times its price. The truck must be able
   to drive from the left deck end to the right one over road beams
   (every road beam no steeper than 45°).

   THE CHECK (evaluate). Beams are pin-jointed rods that carry a
   push or a pull along their length; only the truck has weight (the
   beams are taken as weightless — a simplification, and the one to
   know). The truck is put at every quarter of every road beam, its
   weight shared by the two joints at that beam's ends. At each place
   the forces in all beams are found from joint equilibrium: if the
   frame is rigid the answer exists (frames with more beams than
   needed share the load the simplest way: the smallest total of
   squares, A^T (A A^T)^-1 P); if some joint can move without
   stretching a beam the frame wobbles (the matrix is singular) and
   the check says so. A beam fails when the push or pull in it passes
   its strength at any place; buckling isn't modelled.

   autoDesign(level) is the solver the test suite runs: a frame of
   triangles built to fit the span, with the cheapest material that
   holds in every place. Its cost is the level's par.
   ============================================================ */

export const MATERIALS = {
  road: { name: 'Road', rate: 12, strength: 26 },
  wood: { name: 'Wood', rate: 7, strength: 11 },
  steel: { name: 'Steel', rate: 17, strength: 52 },
};
export const MAX_BEAM = 4.3;                     /* the longest beam: a 3-by-3 diagonal fits */
export const Y_MIN = -4, Y_MAX = 3;
export const LIMITS = { joints: 60, beams: 160 };

export const LEVELS = [
  { id: 1, name: 'Creek', span: 4, anchors: [[0, 0], [4, 0]], truck: 6, budget: 170 },
  { id: 2, name: 'Ditch', span: 6, anchors: [[0, 0], [6, 0]], truck: 8, budget: 360 },
  { id: 3, name: 'Old pier', span: 8, anchors: [[0, 0], [8, 0], [4, 3]], truck: 8, budget: 520 },
  { id: 4, name: 'Canyon', span: 8, anchors: [[0, 0], [8, 0], [0, 3], [8, 3]], truck: 10, budget: 550 },
  { id: 5, name: 'Heavy load', span: 6, anchors: [[0, 0], [6, 0]], truck: 16, budget: 560 },
  { id: 6, name: 'Long haul', span: 12, anchors: [[0, 0], [12, 0], [6, 3]], truck: 8, budget: 640 },
  { id: 7, name: 'Tight purse', span: 8, anchors: [[0, 0], [8, 0]], truck: 12, budget: 600 },
  { id: 8, name: 'Grand span', span: 14, anchors: [[0, 0], [14, 0], [5, 3], [9, 3]], truck: 10, budget: 790 },
];

/* a design: { joints: [[x, y]…] (the free ones), beams: [[a, b, kind]…] } where a and b count the level's
   anchors first, then the free joints: index i < anchors.length is anchor i */
export const emptyDesign = () => ({ joints: [], beams: [] });
const pts = (L, D) => [...L.anchors, ...D.joints];
const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
export const beamCost = (L, D, b) => { const P = pts(L, D); return Math.round(len(P[b[0]], P[b[1]]) * MATERIALS[b[2]].rate); };
export const costOf = (L, D) => D.beams.reduce((s, b) => s + beamCost(L, D, b), 0);

/* segments cross in their insides (not just touching at a shared end) */
function cross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const s = (a, b) => (a === b ? 0 : a > b ? 1 : -1);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}
const onSegment = (a, b, c) => { /* c strictly inside segment a-b */
  const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cr !== 0) return false;
  const dot = (c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1]);
  return dot > 0 && dot < (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
};

/** is this joint place allowed? */
export function jointOk(L, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 1 || x > L.span - 1 || y < Y_MIN || y > Y_MAX) return false;
  return !L.anchors.some(a => a[0] === x && a[1] === y);
}

/** why a design is not a legal drawing (not about strength), or null */
export function problem(L, D) {
  const P = pts(L, D), A = L.anchors.length;
  if (D.joints.length > LIMITS.joints) return 'Too many joints.';
  if (D.beams.length > LIMITS.beams) return 'Too many beams.';
  const seen = new Set();
  for (let i = 0; i < D.joints.length; i++) {
    const [x, y] = D.joints[i];
    if (!jointOk(L, x, y)) return `Joint ${i + 1} is not on a place you can build on.`;
    const k = `${x},${y}`;
    if (seen.has(k)) return 'Two joints are in the same place.';
    seen.add(k);
  }
  const have = new Set();
  for (const b of D.beams) {
    if (!Array.isArray(b) || b.length !== 3 || !Number.isInteger(b[0]) || !Number.isInteger(b[1]) || !(b[2] in MATERIALS)) return 'A beam is not written right.';
    if (b[0] < 0 || b[1] < 0 || b[0] >= P.length || b[1] >= P.length) return 'A beam joins a joint that is not there.';
    if (b[0] === b[1]) return 'A beam joins a joint to itself.';
    const k = b[0] < b[1] ? `${b[0]}-${b[1]}` : `${b[1]}-${b[0]}`;
    if (have.has(k)) return 'Two beams join the same pair of joints.';
    have.add(k);
    if (len(P[b[0]], P[b[1]]) > MAX_BEAM + 1e-9) return `A beam is longer than ${MAX_BEAM}.`;
    if (b[0] < A && b[1] < A && !(b[2] === 'road')) { /* anchor to anchor is fine for any kind */ }
    for (let j = 0; j < P.length; j++) if (j !== b[0] && j !== b[1] && onSegment(P[b[0]], P[b[1]], P[j])) return 'A beam runs through a joint: split it there.';
  }
  for (let i = 0; i < D.beams.length; i++) for (let j = i + 1; j < D.beams.length; j++) {
    const a = D.beams[i], b = D.beams[j];
    if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;
    if (cross(P[a[0]], P[a[1]], P[b[0]], P[b[1]])) return 'Two beams cross where there is no joint.';
  }
  return null;
}

/** the road the truck drives: the joints from the left deck end to the right one over road beams, or null */
export function roadPath(L, D) {
  const adj = new Map();
  for (const b of D.beams) if (b[2] === 'road') { (adj.get(b[0]) || adj.set(b[0], []).get(b[0])).push(b[1]); (adj.get(b[1]) || adj.set(b[1], []).get(b[1])).push(b[0]); }
  const prev = new Map([[0, -1]]);
  const q = [0];
  for (let h = 0; h < q.length; h++) {
    const a = q[h];
    if (a === 1) break;
    for (const b of adj.get(a) || []) if (!prev.has(b)) { prev.set(b, a); q.push(b); }
  }
  if (!prev.has(1)) return null;
  const path = [];
  for (let x = 1; x !== -1; x = prev.get(x)) path.push(x);
  path.reverse();
  return path;
}

/* solve the (square, symmetric) system M y = R for several right-hand sides; null if singular */
function gauss(M, R) {
  const n = M.length, m = R[0]?.length || 0;
  const a = M.map((row, i) => [...row, ...R[i]]);
  let scale = 0;
  for (const row of M) for (const v of row) scale = Math.max(scale, Math.abs(v));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-9 * Math.max(1, scale)) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      if (!f) continue;
      for (let k = c; k < n + m; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((row, i) => row.slice(n).map(v => v / a[i][i]));
}

/**
 * the check: { ok, reason, cost, worst: [load/strength per beam], samples: [{ at: [x, y], f: [force per beam] }], failAt, path }
 * reason: '' | 'noroad' | 'steep' | 'wobble' | 'snap' | 'budget' | 'illegal'
 */
export function evaluate(L, D) {
  const out = { ok: false, reason: '', cost: costOf(L, D), worst: D.beams.map(() => 0), samples: [], failAt: -1, path: null, text: '' };
  const bad = problem(L, D);
  if (bad) { out.reason = 'illegal'; out.text = bad; return out; }
  const P = pts(L, D), A = L.anchors.length;
  const path = roadPath(L, D);
  if (!path) { out.reason = 'noroad'; out.text = 'There is no road from one cliff to the other. Join the two deck ends with road beams.'; return out; }
  out.path = path;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = P[path[i]], b = P[path[i + 1]];
    if (Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) + 1e-9) { out.reason = 'steep'; out.text = 'A piece of the road is steeper than 45°: the truck can\'t climb it.'; return out; }
  }
  /* equilibrium matrix: a row pair per free joint, a column per beam */
  const free = [];
  for (let i = A; i < P.length; i++) if (D.beams.some(b => b[0] === i || b[1] === i)) free.push(i);
  /* a free joint with no beam is just not part of the frame */
  const row = new Map(free.map((j, k) => [j, k]));
  const n = free.length * 2, m = D.beams.length;
  const AM = Array.from({ length: n }, () => new Array(m).fill(0));
  D.beams.forEach((b, c) => {
    const d = len(P[b[0]], P[b[1]]);
    const ux = (P[b[1]][0] - P[b[0]][0]) / d, uy = (P[b[1]][1] - P[b[0]][1]) / d;
    /* tension pulls each end towards the other end */
    if (row.has(b[0])) { AM[row.get(b[0]) * 2][c] += ux; AM[row.get(b[0]) * 2 + 1][c] += uy; }
    if (row.has(b[1])) { AM[row.get(b[1]) * 2][c] -= ux; AM[row.get(b[1]) * 2 + 1][c] -= uy; }
  });
  /* the truck at every quarter of every road beam */
  const loads = [];
  for (let i = 0; i + 1 < path.length; i++) {
    for (const f of [0, 0.25, 0.5, 0.75]) {
      const a = P[path[i]], b = P[path[i + 1]];
      loads.push({ at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], seg: i, f });
    }
  }
  const last = P[path[path.length - 1]];
  loads.push({ at: [last[0], last[1]], seg: path.length - 2, f: 1 });
  if (n === 0) { out.reason = 'wobble'; out.text = 'The frame has no free joints to hold the road up.'; return out; }
  /* A A^T once, then every position as a column */
  const AAT = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => { let s = 0; for (let c = 0; c < m; c++) s += AM[i][c] * AM[j][c]; return s; }));
  const R = Array.from({ length: n }, () => new Array(loads.length).fill(0));
  loads.forEach((ld, k) => {
    const a = path[ld.seg], b = path[ld.seg + 1], f = ld.f;
    if (row.has(a)) R[row.get(a) * 2 + 1][k] += L.truck * (1 - f);
    if (row.has(b)) R[row.get(b) * 2 + 1][k] += L.truck * f;
  });
  const Y = gauss(AAT, R);
  if (!Y) { out.reason = 'wobble'; out.text = 'The frame wobbles: some joint can move without stretching a beam. Brace it with a triangle of beams.'; return out; }
  /* beam forces f = A^T y: positive = pulled (tension), negative = pushed */
  const worst = new Array(m).fill(0);
  loads.forEach((ld, k) => {
    const fvec = new Array(m).fill(0);
    for (let c = 0; c < m; c++) { let s = 0; for (let i = 0; i < n; i++) s += AM[i][c] * Y[i][k]; fvec[c] = s; }
    /* only the size of a force is used below: a push and a pull are held to the same strength */
    out.samples.push({ at: ld.at, f: fvec });
    for (let c = 0; c < m; c++) worst[c] = Math.max(worst[c], Math.abs(fvec[c]) / MATERIALS[D.beams[c][2]].strength);
  });
  out.worst = worst;
  for (let k = 0; k < out.samples.length && out.failAt < 0; k++) {
    if (out.samples[k].f.some((v, c) => Math.abs(v) / MATERIALS[D.beams[c][2]].strength > 1 + 1e-9)) out.failAt = k;
  }
  if (out.failAt >= 0) {
    const c = worst.indexOf(Math.max(...worst));
    out.reason = 'snap'; out.text = `Beam ${c + 1} (${MATERIALS[D.beams[c][2]].name.toLowerCase()}) snaps under the truck: it is asked for ${(Math.max(...worst) * 100).toFixed(0)}% of its strength.`;
    return out;
  }
  if (out.cost > L.budget) { out.reason = 'budget'; out.text = `It holds, but it costs ${out.cost} and the budget is ${L.budget}.`; return out; }
  out.ok = true;
  out.text = `It holds. Cost ${out.cost} of ${L.budget}.`;
  return out;
}

/* ---------- the solver: a frame of triangles that fits the span ---------- */
export function autoDesign(L) {
  const span = L.span, pw = span >= 10 ? 2 : 1;
  const hh = Math.max(1, Math.min(3, Math.round(span / 4)));
  const D = emptyDesign();
  const index = new Map();
  L.anchors.forEach((a, i) => index.set(`${a[0]},${a[1]}`, i));
  const joint = (x, y) => {
    const k = `${x},${y}`;
    if (!index.has(k)) { D.joints.push([x, y]); index.set(k, L.anchors.length + D.joints.length - 1); }
    return index.get(k);
  };
  const xs = []; for (let x = 0; x <= span; x += pw) xs.push(x);
  if (xs[xs.length - 1] !== span) xs.push(span);
  const kinds = {};
  const beam = (a, b, kind) => { D.beams.push([a, b, kind]); };
  for (let i = 0; i + 1 < xs.length; i++) beam(joint(xs[i], 0), joint(xs[i + 1], 0), 'road');
  const tops = xs.slice(1, -1);
  for (let i = 0; i + 1 < tops.length; i++) beam(joint(tops[i], -hh), joint(tops[i + 1], -hh), 'wood');
  for (const x of tops) beam(joint(x, 0), joint(x, -hh), 'wood');
  /* diagonals: the end ones, then zig-zag between the verticals */
  beam(joint(0, 0), joint(tops[0], -hh), 'wood');
  beam(joint(tops[tops.length - 1], -hh), joint(span, 0), 'wood');
  for (let i = 0; i + 1 < tops.length; i++) {
    if (i % 2 === 0) beam(joint(tops[i], -hh), joint(tops[i + 1], 0), 'wood');
    else beam(joint(tops[i], 0), joint(tops[i + 1], -hh), 'wood');
  }
  /* piers: from the deck joint above each extra anchor straight down to it (or the nearest deck joint) */
  for (let a = 2; a < L.anchors.length; a++) {
    const [ax, ay] = L.anchors[a];
    if (ax === 0 || ax === span) { /* a wall anchor: a brace up to the nearest top joint */
      const top = ax === 0 ? tops[0] : tops[tops.length - 1];
      const j = joint(top, 0);
      beam(a, j, 'wood');
    } else {
      /* the nearest deck joint */
      const near = xs.reduce((p, x) => (Math.abs(x - ax) < Math.abs(p - ax) ? x : p), xs[1]);
      const j = joint(near, 0);
      if (len(L.anchors[a], D.joints[j - L.anchors.length] || L.anchors[j]) <= MAX_BEAM) beam(a, j, 'wood');
    }
  }
  void kinds;
  /* the cheapest material that holds: raise any beam that fails, repeat; the road stays road */
  const order = ['wood', 'steel'];
  for (let pass = 0; pass < 6; pass++) {
    const e = evaluate(L, D);
    if (e.reason === 'wobble' || e.reason === 'illegal' || e.reason === 'noroad' || e.reason === 'steep') return null;
    if (!e.worst.some((v, c) => v > 1 + 1e-9)) break;
    D.beams.forEach((b, c) => {
      if (e.worst[c] > 1 + 1e-9 && b[2] !== 'road') b[2] = order[Math.min(1, order.indexOf(b[2]) + 1)];
    });
  }
  /* then the cheapest that still holds, beam by beam (a gentler beam can be wood again) */
  for (let c = 0; c < D.beams.length; c++) {
    if (D.beams[c][2] !== 'steel') continue;
    D.beams[c][2] = 'wood';
    const e = evaluate(L, D);
    if (e.reason === 'snap') D.beams[c][2] = 'steel';
  }
  return D;
}

/* ---------- codes ---------- */
const K1 = { road: 'r', wood: 'w', steel: 's' }, K2 = { r: 'road', w: 'wood', s: 'steel' };
export const toCode = (L, D) => `BB1:${L.id}:${D.joints.map(j => `${j[0]}.${j[1]}`).join(',')}:${D.beams.map(b => `${b[0]}.${b[1]}${K1[b[2]]}`).join(',')}`;
/** a code -> { ok: true, level, design } or { ok: false, why } — checked as a drawing (problem()) before it is ever shown */
export function parseCode(text) {
  const m = /^BB1:(\d{1,2}):([-\d.,]*):([\d.,rws]*)$/.exec(String(text || '').trim());
  if (!m) return { ok: false, why: 'That is not a Bridge Builder code (it starts BB1:).' };
  const L = LEVELS.find(l => l.id === +m[1]);
  if (!L) return { ok: false, why: `This Arcade has no gap ${m[1]}.` };
  const joints = [], beams = [];
  if (m[2]) for (const t of m[2].split(',')) { const q = /^(-?\d+)\.(-?\d+)$/.exec(t); if (!q) return { ok: false, why: 'The joints in the code are not written right.' }; joints.push([+q[1], +q[2]]); }
  if (m[3]) for (const t of m[3].split(',')) { const q = /^(\d+)\.(\d+)([rws])$/.exec(t); if (!q) return { ok: false, why: 'The beams in the code are not written right.' }; beams.push([+q[1], +q[2], K2[q[3]]]); }
  if (joints.length > LIMITS.joints || beams.length > LIMITS.beams) return { ok: false, why: 'The code holds more joints or beams than the game allows.' };
  const D = { joints, beams };
  const why = problem(L, D);
  if (why) return { ok: false, why };
  return { ok: true, level: L, design: D };
}

export default { LEVELS, MATERIALS, evaluate, autoDesign, problem, toCode, parseCode, costOf, jointOk, roadPath };
