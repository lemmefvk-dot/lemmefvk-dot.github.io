/* ============================================================
   geometry.js (core) — the Geometry Sketchpad's model and its maths.
   No DOM. A sketch is a list of objects in creation order; each one
   refers to earlier ones (its parents), so:

     point     x, y                       free: the only thing you drag
     mid       a, b                       midpoint of points a and b
     inter     a, b, k                    k-th intersection of two curves
     on        l, t                       a point glued to a segment, line or circle
                                          (t: 0–1 along a segment, along a line in
                                          steps of its two points, an angle on a circle)
     seg       a, b                       segment between points
     line      a, b                       the line through points
     perp      p, l                       the line through point p at right angles to line l
     par       p, l                       the line through point p parallel to line l
     bisector  a, v, b                    the line halving the angle a-v-b
     tangent   p, c, k                    k-th tangent from point p to circle c
     circle    c, p                       centre c, passing through point p
     circum    a, b, c                    the circle through three points
     poly      pts: [ids]                 polygon through points
     regpoly   a, b, n                    regular n-gon on the side a→b (turning left)
     ellipse   f1, f2, p                  foci f1, f2, passing through p
     parabola  f, l                       focus f, directrix l
     angle     a, v, b                    the angle a-v-b (v is the vertex)
     dist      a, b                       a live distance label |ab|
     ratio     a, b                       the ratio of two lengths (segments or distances)
     locus     p, d                       the path of point p as point d (an `on`) slides
     reflect   src, l                     src mirrored in line l
     rotate    src, c, deg                src turned deg° anticlockwise about point c
     translate src, a, b                  src moved by the vector a→b
     dilate    src, c, s                  src scaled by s about point c

   An image (reflect, rotate, translate, dilate) has the shape of what it
   was made from (shapeOf): the image of a point is a point and can be
   built on like one. Any object may also carry name (a point's name, or
   another object's label), color (#rrggbb) and hidden. A sketch may carry
   view: { grid, axes, coords }.

   solve(model) works every object out from the free points, in order,
   so moving a point moves everything built on it. All numbers are in
   grid units (one square of the grid = 1 unit; areas in square units).
   An object whose parents can't make it (two parallel lines have no
   intersection) is `ok: false` with a reason, never a made-up value.
   A locus is worked out by sliding its driving point along its path
   (241 places on a segment, 361 round a circle, 401 along a line) and
   solving what the traced point depends on at each one.
   ============================================================ */

export const TYPES = ['point', 'mid', 'inter', 'seg', 'line', 'perp', 'par', 'circle', 'poly', 'angle',
  'on', 'bisector', 'tangent', 'circum', 'regpoly', 'ellipse', 'parabola', 'dist', 'ratio', 'locus',
  'reflect', 'rotate', 'translate', 'dilate'];
export const TRANSFORMS = ['reflect', 'rotate', 'translate', 'dilate'];
const LIMIT = 1e6;
export const MAX_OBJECTS = 400;
const EPS = 1e-9;

const fin = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LIMIT;

export function emptyModel() { return { v: 1, objs: [] }; }
export const copy = m => JSON.parse(JSON.stringify(m));
export const VIEW = Object.freeze({ grid: true, axes: true, coords: false });
export const viewOf = m => ({ ...VIEW, ...(m && m.view ? m.view : {}) });

/* the shape each type solves to; an image takes its source's */
const SHAPE = {
  point: 'point', mid: 'point', inter: 'point', on: 'point',
  seg: 'seg', line: 'line', perp: 'line', par: 'line', bisector: 'line', tangent: 'line',
  circle: 'circle', circum: 'circle', poly: 'poly', regpoly: 'poly', angle: 'angle',
  ellipse: 'ellipse', parabola: 'parabola', dist: 'measure', ratio: 'measure', locus: 'locus',
};
export const byId = (model, id) => model.objs.find(o => o.id === id) || null;
/** 'point' | 'seg' | 'line' | 'circle' | 'poly' | 'angle' | 'ellipse' | 'parabola' | 'measure' | 'locus' */
export function shapeOf(model, o) {
  for (let i = 0; o && i < MAX_OBJECTS; i++) {
    if (!TRANSFORMS.includes(o.type)) return SHAPE[o.type] || 'measure';
    o = byId(model, o.src);
  }
  return 'measure';
}
export const isPointish = (model, o) => !!o && shapeOf(model, o) === 'point';

/** The next free point name: A, B, … Z, A1, B1, … */
export function nextName(model) {
  const used = new Set(model.objs.filter(o => isPointish(model, o)).map(o => o.name));
  for (let i = 0; i < 26 * 40; i++) {
    const n = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
    if (!used.has(n)) return n;
  }
  return 'P' + model.objs.length;
}
/* the image of point A is A′ (or A″, A‴ … when that is taken) */
function primeName(model, base) {
  const used = new Set(model.objs.filter(o => isPointish(model, o)).map(o => o.name));
  for (let n = `${base}′`; n.length < 12; n += '′') if (!used.has(n)) return n;
  return nextName(model);
}
const nextId = (model, type) => {
  let n = model.objs.length + 1;
  const ids = new Set(model.objs.map(o => o.id));
  const p = type === 'circum' ? 'k' : type === 'regpoly' ? 'g' : type === 'reflect' ? 'f' : type === 'rotate' ? 'o' : type === 'translate' ? 'w' : type === 'dilate' ? 'z' : type === 'ellipse' ? 'e' : type === 'parabola' ? 'q' : type === 'dist' ? 'h' : type === 'ratio' ? 'j' : type === 'locus' ? 'u' : type === 'on' ? 'n' : type === 'bisector' ? 'b' : type === 'tangent' ? 'y' : type[0];
  while (ids.has(`${p}${n}`)) n++;
  return `${p}${n}`;
};

const REFS = {
  point: [], mid: ['a', 'b'], inter: ['a', 'b'], seg: ['a', 'b'], line: ['a', 'b'], perp: ['p', 'l'], par: ['p', 'l'], circle: ['c', 'p'], angle: ['a', 'v', 'b'], poly: [],
  on: ['l'], bisector: ['a', 'v', 'b'], tangent: ['p', 'c'], circum: ['a', 'b', 'c'], regpoly: ['a', 'b'], ellipse: ['f1', 'f2', 'p'], parabola: ['f', 'l'],
  dist: ['a', 'b'], ratio: ['a', 'b'], locus: ['p', 'd'],
  reflect: ['src', 'l'], rotate: ['src', 'c'], translate: ['src', 'a', 'b'], dilate: ['src', 'c'],
};
export const parents = o => (o.type === 'poly' ? o.pts.slice() : REFS[o.type].map(k => o[k]));

/** Objects that need `id` (directly or not), in order. */
export function dependents(model, id) {
  const dead = new Set([id]);
  for (const o of model.objs) if (!dead.has(o.id) && parents(o).some(p => dead.has(p))) dead.add(o.id);
  dead.delete(id);
  return model.objs.filter(o => dead.has(o.id)).map(o => o.id);
}
/** The ids `id` is built from (directly or not), and itself. */
export function ancestors(model, id) {
  const out = new Set();
  const walk = i => { if (out.has(i)) return; const o = byId(model, i); if (!o) return; out.add(i); parents(o).forEach(walk); };
  walk(id);
  return out;
}

/** Remove an object and everything built on it. -> the ids removed. */
export function remove(model, id) {
  const gone = new Set([id, ...dependents(model, id)]);
  model.objs = model.objs.filter(o => !gone.has(o.id));
  return [...gone];
}

/** Add an object. Parents must exist already. -> its id, or null. */
export function add(model, spec) {
  if (model.objs.length >= MAX_OBJECTS) return null;
  const o = { ...spec };
  if (!TYPES.includes(o.type)) return null;
  o.id = o.id || nextId(model, o.type);
  if (o.type === 'point' && !(fin(o.x) && fin(o.y))) return null;
  if (o.type === 'poly' && !(Array.isArray(o.pts) && o.pts.length >= 3)) return null;
  if (o.type === 'inter' || o.type === 'tangent') o.k = o.k === 1 ? 1 : 0;
  if (o.type === 'on' && !fin(o.t)) return null;
  if (o.type === 'rotate' && !(fin(o.deg) && Math.abs(o.deg) <= 3600)) return null;
  if (o.type === 'dilate' && !(fin(o.s) && o.s !== 0 && Math.abs(o.s) <= 1000)) return null;
  if (o.type === 'regpoly' && !(Number.isInteger(o.n) && o.n >= 3 && o.n <= 24)) return null;
  const ids = new Set(model.objs.map(x => x.id));
  if (ids.has(o.id) || !parents(o).every(p => ids.has(p))) return null;
  if (TRANSFORMS.includes(o.type) && shapeOf(model, byId(model, o.src)) === 'measure') return null;
  if (isPointish(model, o) && !o.name) {
    const src = TRANSFORMS.includes(o.type) ? byId(model, o.src) : null;
    o.name = src && src.name ? primeName(model, src.name) : nextName(model);
  }
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

/** The circle through three points: { cx, cy, r }, or null when they are on one line. */
export function circumcircle(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const scale = Math.max(dist(a, b), dist(b, c), dist(a, c));
  if (!(Math.abs(d) > 1e-9 * scale * scale)) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}
/** Where the tangents from point p touch circle { cx, cy, r }: [] inside, one point on it, two outside. */
export function tangentPoints(p, C) {
  const dx = p.x - C.cx, dy = p.y - C.cy, d = Math.hypot(dx, dy);
  if (d < C.r - 1e-9 * Math.max(1, C.r)) return [];
  if (Math.abs(d - C.r) <= 1e-9 * Math.max(1, C.r)) return [{ x: p.x, y: p.y, on: true }];
  const phi = Math.atan2(dy, dx), alpha = Math.acos(C.r / d);
  return [phi + alpha, phi - alpha].map(t => ({ x: C.cx + C.r * Math.cos(t), y: C.cy + C.r * Math.sin(t) }));
}
/** The corners of a regular n-gon on the side a→b, turning left. */
export function regularPolygon(a, b, n) {
  const pts = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  let dx = b.x - a.x, dy = b.y - a.y;
  const t = 2 * Math.PI / n, c = Math.cos(t), s = Math.sin(t);
  for (let i = 2; i < n; i++) {
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    const q = pts[i - 1];
    pts.push({ x: q.x + dx, y: q.y + dy });
  }
  return pts;
}

/* ---------- maps for the four transformations ---------- */
function mapFor(o, R, P, lineLike) {
  if (o.type === 'reflect') {
    const l = lineLike(o.l);
    if (!l) return null;
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1, L2 = dx * dx + dy * dy;
    return { f: p => { const t = ((p.x - l.x1) * dx + (p.y - l.y1) * dy) / L2, fx = l.x1 + t * dx, fy = l.y1 + t * dy; return { x: 2 * fx - p.x, y: 2 * fy - p.y }; }, scale: 1, flip: true };
  }
  if (o.type === 'rotate') {
    const c = P(o.c);
    if (!c) return null;
    const t = o.deg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
    return { f: p => ({ x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs }), scale: 1 };
  }
  if (o.type === 'translate') {
    const a = P(o.a), b = P(o.b);
    if (!a || !b) return null;
    return { f: p => ({ x: p.x + b.x - a.x, y: p.y + b.y - a.y }), scale: 1 };
  }
  const c = P(o.c);
  if (!c) return null;
  return { f: p => ({ x: c.x + o.s * (p.x - c.x), y: c.y + o.s * (p.y - c.y) }), scale: Math.abs(o.s) };
}
/* a solved result moved by a map */
function mapResult(r, m) {
  const f = m.f;
  if (r.x !== undefined && r.kind === undefined) { const q = f(r); return { ok: true, x: q.x, y: q.y }; }
  if (r.kind === 'seg' || r.kind === 'line') {
    const p = f({ x: r.x1, y: r.y1 }), q = f({ x: r.x2, y: r.y2 });
    return { ok: true, kind: r.kind, x1: p.x, y1: p.y, x2: q.x, y2: q.y, len: Math.hypot(q.x - p.x, q.y - p.y) };
  }
  if (r.kind === 'circle') { const c = f({ x: r.cx, y: r.cy }), rad = r.r * m.scale; return { ok: true, kind: 'circle', cx: c.x, cy: c.y, r: rad, circumference: 2 * Math.PI * rad, area: Math.PI * rad * rad }; }
  if (r.kind === 'ellipse') return ellipseFrom(f(r.f1), f(r.f2), r.a * m.scale);
  if (r.kind === 'parabola') return parabolaFrom(f(r.f), { x1: f({ x: r.dx1, y: r.dy1 }).x, y1: f({ x: r.dx1, y: r.dy1 }).y, x2: f({ x: r.dx2, y: r.dy2 }).x, y2: f({ x: r.dx2, y: r.dy2 }).y });
  if (r.kind === 'locus') return { ok: true, kind: 'locus', pts: r.pts.map(p => (p ? f(p) : null)), closed: r.closed };
  if (r.pts) { const pts = r.pts.map(f); return { ok: true, pts, ...polygon(pts) }; }
  if (r.deg !== undefined) { const a = f(r.a), v = f(r.v), b = f(r.b); return { ok: true, deg: angleDeg(a, v, b), a, v, b }; }
  return { ok: false, why: 'that cannot be moved' };
}
function ellipseFrom(f1, f2, a) {
  const c = dist(f1, f2) / 2;
  if (!(a > c + 1e-9 * Math.max(1, a))) return { ok: false, why: 'it is flat: the point is on the segment between the foci' };
  const b = Math.sqrt(a * a - c * c);
  return { ok: true, kind: 'ellipse', f1: { x: f1.x, y: f1.y }, f2: { x: f2.x, y: f2.y }, cx: (f1.x + f2.x) / 2, cy: (f1.y + f2.y) / 2, a, b, rot: Math.atan2(f2.y - f1.y, f2.x - f1.x), e: c / a, area: Math.PI * a * b };
}
function parabolaFrom(F, l) {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1, len = Math.hypot(dx, dy);
  if (len < EPS) return { ok: false, why: 'its directrix is undefined' };
  const ux = dx / len, uy = dy / len;
  const t = (F.x - l.x1) * ux + (F.y - l.y1) * uy;
  const ox = l.x1 + t * ux, oy = l.y1 + t * uy;           /* the foot of the focus on the directrix */
  const d = Math.hypot(F.x - ox, F.y - oy);
  if (d < 1e-9) return { ok: false, why: 'the focus is on the directrix' };
  const nx = (F.x - ox) / d, ny = (F.y - oy) / d;
  return { ok: true, kind: 'parabola', f: { x: F.x, y: F.y }, ox, oy, ux, uy, nx, ny, d, p: d / 2, vx: ox + nx * d / 2, vy: oy + ny * d / 2, dx1: l.x1, dy1: l.y1, dx2: l.x2, dy2: l.y2 };
}
/** A point of a parabola at position s along its directrix (s = 0 is the vertex). */
export const parabolaAt = (r, s) => { const h = (s * s + r.d * r.d) / (2 * r.d); return { x: r.ox + s * r.ux + h * r.nx, y: r.oy + s * r.uy + h * r.ny }; };
/** A point of an ellipse at parameter t (0–2π). */
export const ellipseAt = (r, t) => { const x = r.a * Math.cos(t), y = r.b * Math.sin(t), c = Math.cos(r.rot), s = Math.sin(r.rot); return { x: r.cx + x * c - y * s, y: r.cy + x * s + y * c }; };
/** Where an `on` point sits on its path for parameter t. */
export function onAt(L, t) {
  if (L.kind === 'circle') return { x: L.cx + L.r * Math.cos(t), y: L.cy + L.r * Math.sin(t) };
  const u = L.kind === 'seg' ? Math.max(0, Math.min(1, t)) : t;
  return { x: L.x1 + u * (L.x2 - L.x1), y: L.y1 + u * (L.y2 - L.y1) };
}
/** The t of the place on a path nearest to point w. */
export function onParam(L, w) {
  if (L.kind === 'circle') return Math.atan2(w.y - L.cy, w.x - L.cx);
  const dx = L.x2 - L.x1, dy = L.y2 - L.y1, t = ((w.x - L.x1) * dx + (w.y - L.y1) * dy) / (dx * dx + dy * dy || 1);
  return L.kind === 'seg' ? Math.max(0, Math.min(1, t)) : t;
}

/**
 * Work every object out. -> Map id -> a result:
 *   point  { ok, x, y }                  seg    { ok, kind:'seg', x1,y1,x2,y2, len }
 *   line   { ok, kind:'line', x1..y2 }   circle { ok, kind:'circle', cx, cy, r }
 *   poly   { ok, pts, area, perimeter, simple }   angle { ok, deg }
 *   ellipse { ok, kind:'ellipse', f1, f2, cx, cy, a, b, rot, e, area }
 *   parabola { ok, kind:'parabola', f, vx, vy, p, … }   locus { ok, kind:'locus', pts, closed }
 *   dist / ratio { ok, kind:'measure', value }
 * or { ok: false, why }.
 * opts: { only: Set of ids to work out, t: { id: t } to put `on` points elsewhere } (for loci)
 */
export function solve(model, opts = {}) {
  const R = new Map();
  const bad = why => ({ ok: false, why });
  const P = id => { const r = R.get(id); return r && r.ok && r.x !== undefined && r.kind === undefined ? r : null; };
  const lineLike = id => { const r = R.get(id); return r && r.ok && (r.kind === 'line' || r.kind === 'seg') ? r : null; };
  const curve = id => { const r = R.get(id); return r && r.ok && (r.kind === 'line' || r.kind === 'seg' || r.kind === 'circle') ? r : null; };
  const circ = id => { const r = R.get(id); return r && r.ok && r.kind === 'circle' ? r : null; };
  const lengthOf = id => { const r = R.get(id); return r && r.ok ? (r.kind === 'seg' ? r.len : r.kind === 'measure' && r.len !== undefined ? r.len : null) : null; };
  const only = opts.only || null, tAt = opts.t || null;
  for (const o of model.objs) {
    if (only && !only.has(o.id)) continue;
    let r;
    switch (o.type) {
      case 'point': r = fin(o.x) && fin(o.y) ? { ok: true, x: o.x, y: o.y } : bad('outside the sketch'); break;
      case 'mid': { const a = P(o.a), b = P(o.b); r = a && b ? { ok: true, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : bad('a point it depends on is undefined'); break; }
      case 'on': {
        const L = curve(o.l);
        const t = tAt && tAt[o.id] !== undefined ? tAt[o.id] : o.t;
        if (!L) { r = bad('what it sits on is undefined'); break; }
        const q = onAt(L, t);
        r = { ok: true, x: q.x, y: q.y };
        break;
      }
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
      case 'bisector': {
        const a = P(o.a), v = P(o.v), b = P(o.b);
        if (!a || !v || !b || dist(a, v) < EPS || dist(b, v) < EPS) { r = bad('it needs three different points'); break; }
        let dx = (a.x - v.x) / dist(a, v) + (b.x - v.x) / dist(b, v), dy = (a.y - v.y) / dist(a, v) + (b.y - v.y) / dist(b, v);
        /* a straight angle: its bisector is at right angles to the arms */
        if (Math.hypot(dx, dy) < 1e-9) { dx = -(a.y - v.y); dy = a.x - v.x; }
        const l = Math.hypot(dx, dy);
        r = { ok: true, kind: 'line', x1: v.x, y1: v.y, x2: v.x + dx / l, y2: v.y + dy / l, len: 1 };
        break;
      }
      case 'tangent': {
        const p = P(o.p), C = circ(o.c);
        if (!p || !C) { r = bad('what it is built on is undefined'); break; }
        const ts = tangentPoints(p, C);
        const q = ts[o.k];
        if (!q) { r = bad(ts.length ? 'from a point on the circle there is only one tangent' : 'the point is inside the circle, so no tangent reaches it'); break; }
        if (q.on) { const dx = p.x - C.cx, dy = p.y - C.cy; r = { ok: true, kind: 'line', x1: p.x, y1: p.y, x2: p.x - dy, y2: p.y + dx, len: 0, touch: { x: p.x, y: p.y } }; }
        else r = { ok: true, kind: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y, len: dist(p, q), touch: { x: q.x, y: q.y } };
        break;
      }
      case 'circle': {
        const c = P(o.c), p = P(o.p);
        if (!c || !p) r = bad('a point it depends on is undefined');
        else if (dist(c, p) < EPS) r = bad('its radius is zero');
        else { const rad = dist(c, p); r = { ok: true, kind: 'circle', cx: c.x, cy: c.y, r: rad, circumference: 2 * Math.PI * rad, area: Math.PI * rad * rad }; }
        break;
      }
      case 'circum': {
        const a = P(o.a), b = P(o.b), c = P(o.c);
        const k = a && b && c ? circumcircle(a, b, c) : null;
        r = k ? { ok: true, kind: 'circle', ...k, circumference: 2 * Math.PI * k.r, area: Math.PI * k.r * k.r } : bad(a && b && c ? 'its three points are on one line' : 'a point it depends on is undefined');
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
      case 'regpoly': {
        const a = P(o.a), b = P(o.b);
        if (!a || !b || dist(a, b) < EPS) { r = bad('its side needs two different points'); break; }
        const pts = regularPolygon(a, b, o.n);
        r = { ok: true, pts, ...polygon(pts), n: o.n, side: dist(a, b) };
        break;
      }
      case 'ellipse': {
        const f1 = P(o.f1), f2 = P(o.f2), p = P(o.p);
        r = f1 && f2 && p ? ellipseFrom(f1, f2, (dist(p, f1) + dist(p, f2)) / 2) : bad('a point it depends on is undefined');
        break;
      }
      case 'parabola': {
        const f = P(o.f), l = lineLike(o.l);
        r = f && l ? parabolaFrom(f, l) : bad('what it is built on is undefined');
        break;
      }
      case 'angle': {
        const a = P(o.a), v = P(o.v), b = P(o.b);
        const deg = a && v && b ? angleDeg(a, v, b) : NaN;
        r = Number.isFinite(deg) ? { ok: true, deg, a, v, b } : bad('it needs three different points');
        break;
      }
      case 'dist': {
        const a = P(o.a), b = P(o.b);
        r = a && b ? { ok: true, kind: 'measure', len: dist(a, b), value: dist(a, b), x1: a.x, y1: a.y, x2: b.x, y2: b.y } : bad('a point it depends on is undefined');
        break;
      }
      case 'ratio': {
        const a = lengthOf(o.a), b = lengthOf(o.b);
        r = a === null || b === null ? bad('a length it depends on is undefined') : b < EPS ? bad('the second length is zero') : { ok: true, kind: 'measure', value: a / b, la: a, lb: b };
        break;
      }
      case 'locus': r = locus(model, o, R); break;
      default: {
        const src = R.get(o.src);
        if (!src || !src.ok) { r = bad('what it is an image of is undefined'); break; }
        const m = mapFor(o, R, P, lineLike);
        r = m ? mapResult(src, m) : bad(o.type === 'reflect' ? 'its mirror line is undefined' : 'what it is built on is undefined');
      }
    }
    R.set(o.id, r);
  }
  return R;
}

/* the path of o.p as o.d slides along its own path */
function locus(model, o, R) {
  const d = byId(model, o.d), L = R.get(d && d.l);
  if (!d || d.type !== 'on') return { ok: false, why: 'the moving point must be a point on an object' };
  if (!L || !L.ok) return { ok: false, why: 'the path of the moving point is undefined' };
  const anc = ancestors(model, o.p);
  if (!anc.has(o.d)) return { ok: false, why: 'that point does not move when the other one does' };
  let ts, closed = false;
  if (L.kind === 'circle') { ts = Array.from({ length: 361 }, (_, i) => i * 2 * Math.PI / 360); closed = true; }
  else if (L.kind === 'seg') ts = Array.from({ length: 241 }, (_, i) => i / 240);
  else { const k = 50 / Math.max(EPS, Math.hypot(L.x2 - L.x1, L.y2 - L.y1)); ts = Array.from({ length: 401 }, (_, i) => -k + 2 * k * i / 400); }
  const pts = ts.map(t => { const r = solve(model, { only: anc, t: { [o.d]: t } }).get(o.p); return r && r.ok && fin(r.x) && fin(r.y) ? { x: r.x, y: r.y } : null; });
  return pts.some(Boolean) ? { ok: true, kind: 'locus', pts, closed } : { ok: false, why: 'the traced point is undefined all along the path' };
}

/** The label of an object: A, AB, ∠ABC, circle AB, ABC… (or the name given to it) */
export function label(model, o) {
  const nm = id => (byId(model, id) || {}).name || id;
  if (o.name && !isPointish(model, o)) return o.name;
  const src = () => label(model, byId(model, o.src) || { type: 'point', name: '?' });
  switch (o.type) {
    case 'point': case 'mid': case 'inter': case 'on': return o.name;
    case 'seg': return `${nm(o.a)}${nm(o.b)}`;
    case 'line': return `line ${nm(o.a)}${nm(o.b)}`;
    case 'perp': return `perpendicular through ${nm(o.p)}`;
    case 'par': return `parallel through ${nm(o.p)}`;
    case 'bisector': return `bisector of ∠${nm(o.a)}${nm(o.v)}${nm(o.b)}`;
    case 'tangent': return `tangent from ${nm(o.p)}${o.k ? ' (2)' : ''}`;
    case 'circle': return `circle ${nm(o.c)}${nm(o.p)}`;
    case 'circum': return `circle through ${nm(o.a)}, ${nm(o.b)}, ${nm(o.c)}`;
    case 'poly': return `polygon ${o.pts.map(nm).join('')}`;
    case 'regpoly': return `regular ${o.n}-gon on ${nm(o.a)}${nm(o.b)}`;
    case 'ellipse': return `ellipse, foci ${nm(o.f1)} and ${nm(o.f2)}`;
    case 'parabola': return `parabola, focus ${nm(o.f)}`;
    case 'angle': return `∠${nm(o.a)}${nm(o.v)}${nm(o.b)}`;
    case 'dist': return `|${nm(o.a)}${nm(o.b)}|`;
    case 'ratio': return `${label(model, byId(model, o.a) || {})} : ${label(model, byId(model, o.b) || {})}`;
    case 'locus': return `locus of ${nm(o.p)} as ${nm(o.d)} moves`;
    case 'reflect': return isPointish(model, o) ? o.name : `${src()} reflected in ${label(model, byId(model, o.l) || {})}`;
    case 'rotate': return isPointish(model, o) ? o.name : `${src()} turned ${fmt(o.deg)}° about ${nm(o.c)}`;
    case 'translate': return isPointish(model, o) ? o.name : `${src()} moved by ${nm(o.a)}${nm(o.b)}`;
    case 'dilate': return isPointish(model, o) ? o.name : `${src()} scaled ×${fmt(o.s)} about ${nm(o.c)}`;
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
    const shape = shapeOf(model, o);
    const row = { id: o.id, type: o.type, shape, label: label(model, o), ok: r.ok, why: r.why || '', items: [], hidden: !!o.hidden, color: o.color || '' };
    const add = (k, n, unit) => row.items.push({ k, v: unit === '°' ? fmtDeg(n) : fmt(n), unit, n });
    if (r.ok) {
      if (shape === 'point') row.items.push({ k: 'at', v: `(${fmt(r.x)}, ${fmt(r.y)})`, unit: '' });
      else if (shape === 'seg') add('length', r.len, 'units');
      else if (shape === 'line') {
        const dx = r.x2 - r.x1, dy = r.y2 - r.y1;
        row.items.push({ k: 'slope', v: Math.abs(dx) < 1e-9 ? 'vertical' : fmt(dy / dx), unit: '' });
        if (o.type === 'tangent' && r.touch) { row.items.push({ k: 'touches at', v: `(${fmt(r.touch.x)}, ${fmt(r.touch.y)})`, unit: '' }); add('tangent length', r.len, 'units'); }
      } else if (shape === 'circle') {
        if (o.type === 'circum') row.items.push({ k: 'centre', v: `(${fmt(r.cx)}, ${fmt(r.cy)})`, unit: '' });
        add('radius', r.r, 'units'); add('circumference', r.circumference, 'units'); add('area', r.area, 'square units');
      } else if (shape === 'poly') {
        add('area', r.area, 'square units'); add('perimeter', r.perimeter, 'units');
        if (o.type === 'regpoly') add('each inside angle', 180 - 360 / o.n, '°');
        if (!r.simple) row.note = 'The sides cross, so this area is the shoelace value, not the area you can see.';
      } else if (shape === 'angle') add('measure', r.deg, '°');
      else if (shape === 'ellipse') { add('semi-major axis', r.a, 'units'); add('semi-minor axis', r.b, 'units'); add('eccentricity', r.e, ''); add('area', r.area, 'square units'); }
      else if (shape === 'parabola') { row.items.push({ k: 'vertex', v: `(${fmt(r.vx)}, ${fmt(r.vy)})`, unit: '' }); add('focus to vertex', r.p, 'units'); }
      else if (o.type === 'dist') add('distance', r.value, 'units');
      else if (o.type === 'ratio') add('ratio', r.value, '');
      else if (shape === 'locus') row.items.push({ k: 'points', v: String(r.pts.filter(Boolean).length), unit: '' });
    }
    out.push(row);
  }
  return out;
}

/* ---------- files ---------- */
export const stringify = model => JSON.stringify({ v: 1, objs: model.objs, ...(model.view ? { view: viewOf(model) } : {}) }, null, 1);

const NAME_OK = /^[A-Za-z0-9′'_ ]{1,24}$/;
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
    if (raw.type === 'inter' || raw.type === 'tangent') spec.k = raw.k;
    if (raw.type === 'on') spec.t = raw.t;
    if (raw.type === 'rotate') spec.deg = raw.deg;
    if (raw.type === 'dilate') spec.s = raw.s;
    if (raw.type === 'regpoly') spec.n = raw.n;
    if (raw.name != null && NAME_OK.test(String(raw.name))) spec.name = String(raw.name).slice(0, 24);
    else if (raw.name != null && ['point', 'mid', 'inter'].includes(raw.type)) spec.name = String(raw.name).slice(0, 8);
    if (typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)) spec.color = raw.color;
    if (raw.hidden === true) spec.hidden = true;
    if (add(m, spec) === null) return { error: 'The sketch is damaged: something refers to an object that is not there.' };
  }
  if (j.view && typeof j.view === 'object') m.view = { grid: j.view.grid !== false, axes: j.view.axes !== false, coords: j.view.coords === true };
  return { model: m };
}

/** Rename an object: a point's name (unique among points, at most 8), another's label (at most 24). -> '' or why not */
export function rename(model, id, name) {
  const o = byId(model, id);
  if (!o) return 'That object is not there.';
  const n = String(name || '').trim();
  const pt = isPointish(model, o);
  if (!n) { if (pt) return 'A point needs a name.'; delete o.name; return ''; }
  if (!NAME_OK.test(n) || (pt && n.length > 8)) return pt ? 'Use up to 8 letters or digits.' : 'Use up to 24 letters, digits or spaces.';
  if (pt && model.objs.some(x => x !== o && isPointish(model, x) && x.name === n)) return `There is already a point called ${n}.`;
  o.name = n;
  return '';
}

export default { TYPES, TRANSFORMS, emptyModel, copy, add, addPoint, remove, dependents, ancestors, solve, measure, label, intersect, angleDeg, polygon, circumcircle, tangentPoints, regularPolygon, stringify, parse, rename, fmt, fmtDeg, shapeOf, isPointish, viewOf };
