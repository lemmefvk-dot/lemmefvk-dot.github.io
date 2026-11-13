/* ============================================================
   geometry.js (core) — the Geometry Sketchpad's model and its maths.
   No DOM. A sketch is a list of objects in creation order; each one
   refers to earlier ones (its parents), so:

     point     x, y                       free: the only thing you drag
     mid       a, b                       midpoint of points a and b
     inter     a, b, k                    k-th intersection of two curves
     seg       a, b                       segment between points
     line      a, b                       the line through points
     perp      p, l                       the line through point p at right angles to line l
     par       p, l                       the line through point p parallel to line l
     circle    c, p                       centre c, passing through point p
     poly      pts: [ids]                 polygon through points
     angle     a, v, b                    the angle a-v-b (v is the vertex)

   solve(model) works every object out from the free points, in order,
   so moving a point moves everything built on it. All numbers are in
   grid units (one square of the grid = 1 unit; areas in square units).
   An object whose parents can't make it (two parallel lines have no
   intersection) is `ok: false` with a reason, never a made-up value.
   ============================================================ */

export const TYPES = ['point', 'mid', 'inter', 'seg', 'line', 'perp', 'par', 'circle', 'poly', 'angle'];
const LIMIT = 1e6;
export const MAX_OBJECTS = 400;
const EPS = 1e-9;

const fin = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LIMIT;

export function emptyModel() { return { v: 1, objs: [] }; }
export const copy = m => JSON.parse(JSON.stringify(m));

/** The next free point name: A, B, … Z, A1, B1, … */
export function nextName(model) {
  const used = new Set(model.objs.filter(o => o.type === 'point' || o.type === 'mid' || o.type === 'inter').map(o => o.name));
  for (let i = 0; i < 26 * 40; i++) {
    const n = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
    if (!used.has(n)) return n;
  }
  return 'P' + model.objs.length;
}
const nextId = (model, type) => {
  let n = model.objs.length + 1;
  const ids = new Set(model.objs.map(o => o.id));
  while (ids.has(`${type[0]}${n}`)) n++;
  return `${type[0]}${n}`;
};

export const byId = (model, id) => model.objs.find(o => o.id === id) || null;
const REFS = { point: [], mid: ['a', 'b'], inter: ['a', 'b'], seg: ['a', 'b'], line: ['a', 'b'], perp: ['p', 'l'], par: ['p', 'l'], circle: ['c', 'p'], angle: ['a', 'v', 'b'], poly: [] };
export const parents = o => (o.type === 'poly' ? o.pts.slice() : REFS[o.type].map(k => o[k]));

/** Objects that need `id` (directly or not), in order. */
export function dependents(model, id) {
  const dead = new Set([id]);
  for (const o of model.objs) if (!dead.has(o.id) && parents(o).some(p => dead.has(p))) dead.add(o.id);
  dead.delete(id);
  return model.objs.filter(o => dead.has(o.id)).map(o => o.id);
}

/** Remove an object and everything built on it. -> the ids removed. */
export function remove(model, id) {
  const gone = new Set([id, ...dependents(model, id)]);
  model.objs = model.objs.filter(o => !gone.has(o.id));
  return [...gone];
}

/** Add an object. Parents must exist already. -> its id, or null with `why` on the model's last-error. */
export function add(model, spec) {
  if (model.objs.length >= MAX_OBJECTS) return null;
  const o = { ...spec };
  if (!TYPES.includes(o.type)) return null;
  o.id = o.id || nextId(model, o.type);
  if (o.type === 'point' && !(fin(o.x) && fin(o.y))) return null;
  if (o.type === 'poly' && !(Array.isArray(o.pts) && o.pts.length >= 3)) return null;
  if (o.type === 'inter') o.k = o.k === 1 ? 1 : 0;
  const ids = new Set(model.objs.map(x => x.id));
  if (ids.has(o.id) || !parents(o).every(p => ids.has(p))) return null;
  if (o.type === 'point' || o.type === 'mid' || o.type === 'inter') o.name = o.name || nextName(model);
  model.objs.push(o);
  return o.id;
}
export const addPoint = (model, x, y) => add(model, { type: 'point', x, y });

/* ---------- the maths ---------- */
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/** Intersections of two curves: { kind:'line'|'seg', x1,y1,x2,y2 } or { kind:'circle', cx,cy,r }. -> [{x,y}] */
export function intersect(A, B) {
  if (A.kind === 'circle' && B.kind === 'circle') {
    const d = Math.hypot(B.cx - A.cx, B.cy - A.cy);
    if (d < EPS) return [];
    if (d > A.r + B.r + EPS || d < Math.abs(A.r - B.r) - EPS) return [];
    const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d);
    const h2 = A.r * A.r - a * a;
    const h = h2 > 0 ? Math.sqrt(h2) : 0;
    const ux = (B.cx - A.cx) / d, uy = (B.cy - A.cy) / d;
    const mx = A.cx + a * ux, my = A.cy + a * uy;
    const pts = [{ x: mx - h * uy, y: my + h * ux }, { x: mx + h * uy, y: my - h * ux }];
    return h < EPS ? [pts[0]] : pts;
  }
  if (A.kind === 'circle' || B.kind === 'circle') {
    const C = A.kind === 'circle' ? A : B, L = A.kind === 'circle' ? B : A;
    const dx = L.x2 - L.x1, dy = L.y2 - L.y1;
    const fx = L.x1 - C.cx, fy = L.y1 - C.cy;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - C.r * C.r;
    const disc = b * b - 4 * a * c;
    if (a < EPS) return [];
    const tol = 1e-9 * Math.max(1, b * b);
    if (disc < -tol) return [];
    const s = Math.sqrt(Math.max(0, disc));
    const ts = s < 1e-9 ? [-b / (2 * a)] : [(-b - s) / (2 * a), (-b + s) / (2 * a)];
    return ts.map(t => ({ x: L.x1 + t * dx, y: L.y1 + t * dy, t }));
  }
  const d1x = A.x2 - A.x1, d1y = A.y2 - A.y1, d2x = B.x2 - B.x1, d2y = B.y2 - B.y1;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < EPS * Math.max(1, Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y))) return [];
  const t = ((B.x1 - A.x1) * d2y - (B.y1 - A.y1) * d2x) / den;
  const u = ((B.x1 - A.x1) * d1y - (B.y1 - A.y1) * d1x) / den;
  return [{ x: A.x1 + t * d1x, y: A.y1 + t * d1y, t, u }];
}

/** The angle at v between rays v->a and v->b, in degrees (0–180), or NaN. */
export function angleDeg(a, v, b) {
  const ux = a.x - v.x, uy = a.y - v.y, wx = b.x - v.x, wy = b.y - v.y;
  const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
  if (lu < EPS || lw < EPS) return NaN;
  /* atan2 of cross and dot stays accurate near 0° and 180° where acos does not */
  return Math.atan2(Math.abs(ux * wy - uy * wx), ux * wx + uy * wy) * 180 / Math.PI;
}

/** Shoelace area (always positive) and perimeter of a polygon [{x,y}]. */
export function polygon(pts) {
  let s = 0, per = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
    per += dist(p, q);
  }
  return { area: Math.abs(s) / 2, perimeter: per, simple: isSimple(pts) };
}
function isSimple(pts) {
  const n = pts.length;
  const ccw = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) === 1 || (i === 0 && j === n - 1)) continue;
      const a = pts[i], b = pts[(i + 1) % n], c = pts[j], d = pts[(j + 1) % n];
      if (ccw(a, b, c) * ccw(a, b, d) < 0 && ccw(c, d, a) * ccw(c, d, b) < 0) return false;
    }
  }
  return true;
}

/**
 * Work every object out. -> Map id -> a result:
 *   point  { ok, x, y }                  seg    { ok, kind:'seg', x1,y1,x2,y2, len }
 *   line   { ok, kind:'line', x1..y2 }   circle { ok, kind:'circle', cx, cy, r }
 *   poly   { ok, pts, area, perimeter, simple }   angle { ok, deg }
 * or { ok: false, why }.
 */
export function solve(model) {
  const R = new Map();
  const bad = why => ({ ok: false, why });
  const P = id => { const r = R.get(id); return r && r.ok && r.x !== undefined && r.kind === undefined ? r : null; };
  const lineLike = id => { const r = R.get(id); return r && r.ok && (r.kind === 'line' || r.kind === 'seg') ? r : null; };
  const curve = id => { const r = R.get(id); return r && r.ok && (r.kind === 'line' || r.kind === 'seg' || r.kind === 'circle') ? r : null; };
  for (const o of model.objs) {
    let r;
    switch (o.type) {
      case 'point': r = fin(o.x) && fin(o.y) ? { ok: true, x: o.x, y: o.y } : bad('outside the sketch'); break;
      case 'mid': { const a = P(o.a), b = P(o.b); r = a && b ? { ok: true, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : bad('a point it depends on is undefined'); break; }
      case 'seg': case 'line': {
        const a = P(o.a), b = P(o.b);
        if (!a || !b) r = bad('a point it depends on is undefined');
        else if (dist(a, b) < EPS) r = bad('its two points are the same');
        else r = { ok: true, kind: o.type, x1: a.x, y1: a.y, x2: b.x, y2: b.y, len: dist(a, b) };
        break;
      }
      case 'perp': case 'par': {
        const p = P(o.p), l = lineLike(o.l);
        if (!p || !l) { r = bad('what it is built on is undefined'); break; }
        const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
        r = o.type === 'par' ? { ok: true, kind: 'line', x1: p.x, y1: p.y, x2: p.x + dx, y2: p.y + dy } : { ok: true, kind: 'line', x1: p.x, y1: p.y, x2: p.x - dy, y2: p.y + dx };
        r.len = Math.hypot(dx, dy);
        break;
      }
      case 'circle': {
        const c = P(o.c), p = P(o.p);
        if (!c || !p) r = bad('a point it depends on is undefined');
        else if (dist(c, p) < EPS) r = bad('its radius is zero');
        else { const rad = dist(c, p); r = { ok: true, kind: 'circle', cx: c.x, cy: c.y, r: rad, circumference: 2 * Math.PI * rad, area: Math.PI * rad * rad }; }
        break;
      }
      case 'inter': {
        const A = curve(o.a), B = curve(o.b);
        if (!A || !B) { r = bad('a curve it depends on is undefined'); break; }
        let pts = intersect(A, B);
        /* a segment only counts where it really is */
        const inSeg = t => t >= -1e-9 && t <= 1 + 1e-9;
        if (A.kind !== 'circle' && B.kind !== 'circle') pts = pts.filter(q => (A.kind !== 'seg' || inSeg(q.t)) && (B.kind !== 'seg' || inSeg(q.u)));
        else if (A.kind !== 'circle' || B.kind !== 'circle') { const L = A.kind === 'circle' ? B : A; if (L.kind === 'seg') pts = pts.filter(q => inSeg(q.t)); }
        const q = pts[o.k];
        r = q ? { ok: true, x: q.x, y: q.y } : bad(pts.length ? 'there is no second intersection' : 'they do not meet');
        break;
      }
      case 'poly': {
        const pts = o.pts.map(P);
        if (pts.some(x => !x)) { r = bad('a point it depends on is undefined'); break; }
        r = { ok: true, pts: pts.map(p => ({ x: p.x, y: p.y })), ...polygon(pts) };
        break;
      }
      case 'angle': {
        const a = P(o.a), v = P(o.v), b = P(o.b);
        const deg = a && v && b ? angleDeg(a, v, b) : NaN;
        r = Number.isFinite(deg) ? { ok: true, deg, a, v, b } : bad('it needs three different points');
        break;
      }
      default: r = bad('unknown');
    }
    R.set(o.id, r);
  }
  return R;
}

/** The label of an object: A, AB, ∠ABC, circle AB, ABC… */
export function label(model, o) {
  const nm = id => (byId(model, id) || {}).name || id;
  switch (o.type) {
    case 'point': case 'mid': case 'inter': return o.name;
    case 'seg': return `${nm(o.a)}${nm(o.b)}`;
    case 'line': return `line ${nm(o.a)}${nm(o.b)}`;
    case 'perp': return `perpendicular through ${nm(o.p)}`;
    case 'par': return `parallel through ${nm(o.p)}`;
    case 'circle': return `circle ${nm(o.c)}${nm(o.p)}`;
    case 'poly': return `polygon ${o.pts.map(nm).join('')}`;
    case 'angle': return `∠${nm(o.a)}${nm(o.v)}${nm(o.b)}`;
    default: return o.id;
  }
}

/** A number for people: at most 3 decimals, no trailing zeros. */
export const fmt = n => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '–');
export const fmtDeg = n => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '–');

/**
 * What the sketch measures, from the solved geometry only.
 * -> [{ id, label, items: [{ k, v, unit }], ok, why }]
 */
export function measure(model, R = solve(model)) {
  const out = [];
  for (const o of model.objs) {
    const r = R.get(o.id);
    const row = { id: o.id, type: o.type, label: label(model, o), ok: r.ok, why: r.why || '', items: [] };
    if (r.ok) {
      if (o.type === 'point' || o.type === 'mid' || o.type === 'inter') row.items.push({ k: 'at', v: `(${fmt(r.x)}, ${fmt(r.y)})`, unit: '' });
      else if (o.type === 'seg') row.items.push({ k: 'length', v: fmt(r.len), unit: 'units', n: r.len });
      else if (o.type === 'line' || o.type === 'perp' || o.type === 'par') {
        const dx = r.x2 - r.x1, dy = r.y2 - r.y1;
        row.items.push({ k: 'slope', v: Math.abs(dx) < 1e-9 ? 'vertical' : fmt(dy / dx), unit: '' });
      } else if (o.type === 'circle') {
        row.items.push({ k: 'radius', v: fmt(r.r), unit: 'units', n: r.r }, { k: 'circumference', v: fmt(r.circumference), unit: 'units', n: r.circumference }, { k: 'area', v: fmt(r.area), unit: 'square units', n: r.area });
      } else if (o.type === 'poly') {
        row.items.push({ k: 'area', v: fmt(r.area), unit: 'square units', n: r.area }, { k: 'perimeter', v: fmt(r.perimeter), unit: 'units', n: r.perimeter });
        if (!r.simple) row.note = 'The sides cross, so this area is the shoelace value, not the area you can see.';
      } else if (o.type === 'angle') row.items.push({ k: 'measure', v: fmtDeg(r.deg), unit: '°', n: r.deg });
    }
    out.push(row);
  }
  return out;
}

/* ---------- files ---------- */
export const stringify = model => JSON.stringify({ v: 1, objs: model.objs }, null, 1);

/** Text -> a model, or { error }. Every reference must point to an earlier object. */
export function parse(text) {
  let j;
  try { j = JSON.parse(String(text)); } catch (e) { return { error: 'That is not a sketch file.' }; }
  if (!j || !Array.isArray(j.objs)) return { error: 'That is not a sketch file.' };
  if (j.objs.length > MAX_OBJECTS) return { error: 'That sketch is too big.' };
  const m = emptyModel();
  for (const raw of j.objs) {
    if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) return { error: 'The sketch has something I don’t know.' };
    const spec = { type: raw.type, id: String(raw.id || '').slice(0, 20) || undefined };
    for (const k of REFS[raw.type]) spec[k] = String(raw[k] || '');
    if (raw.type === 'point') { spec.x = raw.x; spec.y = raw.y; }
    if (raw.type === 'poly') spec.pts = Array.isArray(raw.pts) ? raw.pts.map(String) : [];
    if (raw.type === 'inter') spec.k = raw.k;
    if (raw.name != null && (raw.type === 'point' || raw.type === 'mid' || raw.type === 'inter')) spec.name = String(raw.name).slice(0, 8);
    if (add(m, spec) === null) return { error: 'The sketch is damaged: something refers to an object that is not there.' };
  }
  return { model: m };
}

export default { TYPES, emptyModel, copy, add, addPoint, remove, dependents, solve, measure, label, intersect, angleDeg, polygon, stringify, parse, fmt, fmtDeg };
