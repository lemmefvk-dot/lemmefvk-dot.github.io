/* ============================================================
   graphmath.js (core) — Static Graph's maths. No DOM.

   · compile(src, vars) — the safe expression parser (NO eval, NO Function):
     the text is tokenised and parsed by recursive descent into a tree of
     small closures, one per node. Only the names listed here can be
     reached (own properties of null-prototype tables, so "constructor"
     and "__proto__" are simply unknown names). Precedence: + − then
     × ÷ % and implicit multiply, then unary − +, then ^ (right to left).
     `vars` are the names that stand for the one variable: ['x'] for
     y = f(x), ['t', 'theta'] for polar r(t) and parametric x(t), y(t).

   · makeCurve(spec) — one curve of three kinds as a point function at(t):
       y      y = f(x)          at(x) = [x, f(x)]
       polar  r = f(t)          at(t) = [r cos t, r sin t]
       param  x = f(t), y = g(t)

   · intersections(curves, view) — where curves cross, found numerically:
     each curve is sampled densely (SAMPLES across the view for y = f(x);
     about 1200 per turn for the others), every crossing between the
     sampled polylines is found (a grid keeps it fast), and each is then
     polished with a two-variable Newton iteration until the two curves
     agree to better than TOL. A y = f(x) pair also looks for places the
     curves touch without crossing (y = x² and y = 0). Everything is
     APPROXIMATE: points are given to 6 decimal places and are marked
     "rough" (3 places) when the polish did not converge. Only points
     inside the current view are found, and two crossings closer than
     one sample step can be missed; a self-crossing of one curve is not looked for.

   · tableOf(curve, from, step, rows) — a table of values.
   ============================================================ */

/* ---- the maths the parser is allowed to reach ---------------------- */
const own = o => Object.assign(Object.create(null), o);
const FUNCS = own({
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  log: Math.log10, ln: Math.log,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
});
const CONSTS = own({ pi: Math.PI, e: Math.E });
export const MAX_EXPR = 300;
export const FUNCTION_NAMES = Object.keys(FUNCS).join(' ');

/* ---- tokeniser ----------------------------------------------------- */
function tokenize(src) {
  const toks = [];
  const s = String(src);
  let i = 0;
  const isDigit = c => c >= '0' && c <= '9';
  const isAlpha = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (isDigit(c) || c === '.') {
      let j = i + 1;
      while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++;
      const num = s.slice(i, j);
      if ((num.match(/\./g) || []).length > 1 || num === '.') throw new Error(`bad number "${num}"`);
      toks.push({ t: 'num', v: parseFloat(num) });
      i = j; continue;
    }
    if (isAlpha(c)) {
      let j = i + 1;
      while (j < s.length && isAlpha(s[j])) j++;
      toks.push({ t: 'id', v: s.slice(i, j).toLowerCase() });
      i = j; continue;
    }
    if ('+-*/^%()'.includes(c)) { toks.push({ t: c }); i++; continue; }
    if (c === 'π') { toks.push({ t: 'id', v: 'pi' }); i++; continue; }
    if (c === 'θ') { toks.push({ t: 'id', v: 'theta' }); i++; continue; }
    if (c === '−') { toks.push({ t: '-' }); i++; continue; }
    if (c === '×' || c === '·') { toks.push({ t: '*' }); i++; continue; }
    if (c === '÷') { toks.push({ t: '/' }); i++; continue; }
    throw new Error(`unexpected "${c}"`);
  }
  return toks;
}

/* ---- parser → a closure fn(v) -------------------------------------- */
export function compile(src, vars = ['x']) {
  if (String(src).length > MAX_EXPR) throw new Error(`too long (more than ${MAX_EXPR} characters)`);
  const toks = tokenize(src);
  if (!toks.length) throw new Error('empty');
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];
  const show = tk => (!tk ? 'end of input' : tk.t === 'num' ? String(tk.v) : tk.t === 'id' ? `"${tk.v}"` : `"${tk.t}"`);
  const expect = t => { const k = eat(); if (!k || k.t !== t) throw new Error(`expected "${t}", got ${show(k)}`); };
  const startsAtom = tk => tk && (tk.t === 'num' || tk.t === 'id' || tk.t === '(');

  function parseExpr() {
    let a = parseTerm();
    for (let p = peek(); p && (p.t === '+' || p.t === '-'); p = peek()) {
      const op = eat().t, b = parseTerm(), l = a;
      a = op === '+' ? x => l(x) + b(x) : x => l(x) - b(x);
    }
    return a;
  }
  function parseTerm() {
    let a = parseUnary();
    for (;;) {
      const p = peek();
      if (p && (p.t === '*' || p.t === '/' || p.t === '%')) {
        const op = eat().t, b = parseUnary(), l = a;
        a = op === '*' ? x => l(x) * b(x) : op === '/' ? x => l(x) / b(x) : x => l(x) % b(x);
      } else if (startsAtom(p)) {
        const b = parseUnary(), l = a;
        a = x => l(x) * b(x);
      } else break;
    }
    return a;
  }
  function parseUnary() {
    const p = peek();
    if (p && p.t === '-') { eat(); const a = parseUnary(); return x => -a(x); }
    if (p && p.t === '+') { eat(); return parseUnary(); }
    return parsePow();
  }
  function parsePow() {
    const base = parseAtom();
    if (peek() && peek().t === '^') { eat(); const ex = parseUnary(); return x => Math.pow(base(x), ex(x)); }
    return base;
  }
  function parseAtom() {
    const p = peek();
    if (!p) throw new Error('unexpected end of input');
    if (p.t === 'num') { eat(); const v = p.v; return () => v; }
    if (p.t === '(') { eat(); const e = parseExpr(); expect(')'); return e; }
    if (p.t === 'id') {
      eat();
      const name = p.v;
      if (vars.includes(name)) return x => x;
      if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
      if (name in FUNCS) { expect('('); const arg = parseExpr(); expect(')'); const f = FUNCS[name]; return x => f(arg(x)); }
      throw new Error(`unknown name "${name}"`);
    }
    throw new Error(`unexpected ${show(p)}`);
  }

  const fn = parseExpr();
  if (pos < toks.length) throw new Error(`unexpected ${show(toks[pos])}`);
  return fn;
}

/** A number written as an expression with no variable ("2pi", "pi/2"), or throws. */
export function constant(src, fallback) {
  const s = String(src == null ? '' : src).trim();
  if (!s) return fallback;
  const v = compile(s, [])(0);
  if (!Number.isFinite(v)) throw new Error('not a number');
  return v;
}

/* ---- curves -------------------------------------------------------- */
export const KINDS = [['y', 'y = f(x)'], ['polar', 'r = f(t)'], ['param', 'x(t), y(t)']];
const VARS = { y: ['x'], polar: ['t', 'theta'], param: ['t'] };
export const TWO_PI = 2 * Math.PI;

/**
 * spec: { kind, expr, expr2, tmin, tmax } (tmin/tmax are expressions for polar and param)
 * -> { ok: true, kind, at(t) -> [x, y], t0, t1, label } or { ok: false, error }
 */
export function makeCurve(spec) {
  const kind = KINDS.some(k => k[0] === spec.kind) ? spec.kind : 'y';
  const e1 = String(spec.expr || '').trim();
  if (!e1) return { ok: false, error: '', empty: true };
  try {
    const f = compile(e1, VARS[kind]);
    if (kind === 'y') return { ok: true, kind, fn: f, at: x => [x, f(x)], t0: -Infinity, t1: Infinity, label: `y = ${e1}` };
    const t0 = constant(spec.tmin, 0), t1 = constant(spec.tmax, TWO_PI);
    if (!(t1 > t0)) return { ok: false, error: 'the end of the t range must be bigger than the start' };
    if (t1 - t0 > 1000) return { ok: false, error: 'the t range can be at most 1000 wide' };
    if (kind === 'polar') return { ok: true, kind, rOf: f, at: t => { const r = f(t); return [r * Math.cos(t), r * Math.sin(t)]; }, t0, t1, label: `r = ${e1}` };
    const e2 = String(spec.expr2 || '').trim();
    if (!e2) return { ok: false, error: 'y(t) is empty' };
    const g = compile(e2, VARS.param);
    return { ok: true, kind, at: t => [f(t), g(t)], t0, t1, label: `x = ${e1}, y = ${e2}` };
  } catch (err) {
    return { ok: false, error: err.message || 'parse error' };
  }
}

/* ---- sampling ------------------------------------------------------ */
export const SAMPLES = 3000;
const fin = v => typeof v === 'number' && Number.isFinite(v);
function samplePoints(c, view) {
  const pts = [];
  const safe = t => { try { return c.at(t); } catch (e) { return [NaN, NaN]; } };
  let a, b, n;
  if (c.kind === 'y') { a = view.xmin; b = view.xmax; n = SAMPLES; }
  else { a = c.t0; b = c.t1; n = Math.min(12000, Math.max(1200, Math.round((b - a) / TWO_PI * 1200))); }
  const bigY = (view.ymax - view.ymin) * 4;
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = i === n ? b : a + (b - a) * i / n;
    const [x, y] = safe(t);
    if (!fin(x) || !fin(y)) { prev = null; continue; }
    const p = { t, x, y, gap: !prev };
    /* an asymptote (tan, 1/x): a huge jump that flips sign is not a line */
    if (prev && c.kind === 'y' && Math.sign(y) !== Math.sign(prev.y) && Math.abs(y - prev.y) > bigY) p.gap = true;
    pts.push(p);
    prev = p;
  }
  return pts;
}

/* ---- intersections ------------------------------------------------- */
export const TOL = 1e-9;
export const MAX_POINTS = 60;
const GRID = 48;

function polylineCrossings(A, B, view) {
  const w = view.xmax - view.xmin, hgt = view.ymax - view.ymin;
  const cell = (x, y) => [Math.min(GRID - 1, Math.max(0, Math.floor((x - view.xmin) / w * GRID))), Math.min(GRID - 1, Math.max(0, Math.floor((y - view.ymin) / hgt * GRID)))];
  const touches = (p, q) => !(Math.max(p.x, q.x) < view.xmin || Math.min(p.x, q.x) > view.xmax || Math.max(p.y, q.y) < view.ymin || Math.min(p.y, q.y) > view.ymax);
  const grid = new Map();
  for (let j = 0; j + 1 < B.length; j++) {
    const p = B[j], q = B[j + 1];
    if (q.gap || !touches(p, q)) continue;
    const [c0, r0] = cell(Math.min(p.x, q.x), Math.min(p.y, q.y)), [c1, r1] = cell(Math.max(p.x, q.x), Math.max(p.y, q.y));
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) { const k = r * GRID + c; (grid.get(k) || grid.set(k, []).get(k)).push(j); }
  }
  const out = [];
  const E = 1e-12;
  for (let i = 0; i + 1 < A.length; i++) {
    const p = A[i], q = A[i + 1];
    if (q.gap || !touches(p, q)) continue;
    const [c0, r0] = cell(Math.min(p.x, q.x), Math.min(p.y, q.y)), [c1, r1] = cell(Math.max(p.x, q.x), Math.max(p.y, q.y));
    const seen = new Set();
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
      for (const j of grid.get(r * GRID + c) || []) {
        if (seen.has(j)) continue;
        seen.add(j);
        const u = B[j], v = B[j + 1];
        const rx = q.x - p.x, ry = q.y - p.y, sx = v.x - u.x, sy = v.y - u.y;
        const den = rx * sy - ry * sx;
        if (den === 0) continue;
        const s = ((u.x - p.x) * sy - (u.y - p.y) * sx) / den;
        const k = ((u.x - p.x) * ry - (u.y - p.y) * rx) / den;
        if (s < -E || s > 1 + E || k < -E || k > 1 + E) continue;
        out.push({ ta: p.t + s * (q.t - p.t), tb: u.t + k * (v.t - u.t), x: p.x + s * rx, y: p.y + s * ry });
      }
    }
  }
  return out;
}

/** Two-variable Newton on A(ta) = B(tb), from a good start. -> { ta, tb, x, y, err } or null */
function polish(ca, cb, g) {
  const f = (ta, tb) => { const a = ca.at(ta), b = cb.at(tb); return [a[0] - b[0], a[1] - b[1], a]; };
  let { ta, tb } = g;
  let [fx, fy, a] = f(ta, tb);
  let err = Math.hypot(fx, fy);
  for (let it = 0; it < 60 && err > TOL * 1e-3; it++) {
    const ha = 1e-6 * Math.max(1, Math.abs(ta)), hb = 1e-6 * Math.max(1, Math.abs(tb));
    const A1 = ca.at(ta + ha), A0 = ca.at(ta - ha), B1 = cb.at(tb + hb), B0 = cb.at(tb - hb);
    const j11 = (A1[0] - A0[0]) / (2 * ha), j21 = (A1[1] - A0[1]) / (2 * ha);
    const j12 = -(B1[0] - B0[0]) / (2 * hb), j22 = -(B1[1] - B0[1]) / (2 * hb);
    const det = j11 * j22 - j12 * j21;
    if (!fin(det) || Math.abs(det) < 1e-14) break;
    let da = -(fx * j22 - fy * j12) / det, db = -(j11 * fy - j21 * fx) / det;
    let ok = false;
    for (let k = 0; k < 12; k++) {
      const r = f(ta + da, tb + db);
      const e2 = Math.hypot(r[0], r[1]);
      if (fin(e2) && e2 < err) { ta += da; tb += db; fx = r[0]; fy = r[1]; a = r[2]; err = e2; ok = true; break; }
      da /= 2; db /= 2;
    }
    if (!ok) break;
  }
  return fin(err) ? { ta, tb, x: a[0], y: a[1], err } : null;
}

const same = (p, q, eps) => Math.abs(p.x - q.x) <= eps && Math.abs(p.y - q.y) <= eps;
/**
 * curves: [{ curve (from makeCurve), name }]; view: { xmin, xmax, ymin, ymax }
 * -> { points: [{ x, y, a, b, rough, touch }], capped, pairs }
 */
export function intersections(curves, view) {
  const eps = 1e-6 * Math.max(1, view.xmax - view.xmin);
  const points = [];
  let capped = false;
  const live = curves.filter(c => c.curve && c.curve.ok);
  const polys = live.map(c => samplePoints(c.curve, view));
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const ca = live[i].curve, cb = live[j].curve;
    const found = [];
    const add = (pt, touch) => {
      if (pt.x < view.xmin - eps || pt.x > view.xmax + eps || pt.y < view.ymin - eps || pt.y > view.ymax + eps) return;
      if (found.some(q => same(q, pt, eps))) return;
      found.push({ ...pt, a: live[i].name, b: live[j].name, touch: !!touch });
    };
    const yy = ca.kind === 'y' && cb.kind === 'y';
    for (const g of polylineCrossings(polys[i], polys[j], view)) {
      const r = polish(ca, cb, g);
      const pt = r && r.err < TOL && fin(r.x) && fin(r.y) ? { x: r.x, y: r.y, rough: false } : { x: g.x, y: g.y, rough: true };
      add(pt, yy && !pt.rough && touchesOnly(ca, cb, pt.x));
    }
    if (yy) for (const t of touching(ca, cb, polys[i], polys[j])) add(t, true);
    found.sort((p, q) => p.x - q.x || p.y - q.y);
    for (const p of found) { if (points.length >= MAX_POINTS) { capped = true; break; } points.push(p); }
  }
  return { points, capped };
}

/* does f − g keep its sign on both sides of x (a touch), rather than change it (a crossing)? */
function touchesOnly(ca, cb, x) {
  const d = Math.max(1e-5, Math.abs(x) * 1e-5);
  try {
    const l = ca.fn(x - d) - cb.fn(x - d), r = ca.fn(x + d) - cb.fn(x + d);
    return fin(l) && fin(r) && l * r > 0;
  } catch (e) { return false; }
}

/* two y = f(x) curves that touch without crossing: a minimum of |f − g| that reaches 0 */
function touching(ca, cb, PA, PB) {
  const out = [];
  const dOf = x => { try { return ca.fn(x) - cb.fn(x); } catch (e) { return NaN; } };
  const n = Math.min(PA.length, PB.length);
  const d = [];
  for (let i = 0; i < n; i++) d.push(PA[i].t === PB[i].t ? PA[i].y - PB[i].y : NaN);
  for (let i = 1; i + 1 < n; i++) {
    if (!fin(d[i - 1]) || !fin(d[i]) || !fin(d[i + 1])) continue;
    if (Math.abs(d[i]) > Math.abs(d[i - 1]) || Math.abs(d[i]) > Math.abs(d[i + 1])) continue;
    if (Math.sign(d[i - 1]) * Math.sign(d[i + 1]) < 0) continue;       /* a real crossing: the sign change found it */
    let lo = PA[i - 1].t, hi = PA[i + 1].t;
    for (let k = 0; k < 100; k++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (Math.abs(dOf(m1)) < Math.abs(dOf(m2))) hi = m2; else lo = m1;
    }
    const x = (lo + hi) / 2, y = ca.fn(x);
    if (fin(y) && Math.abs(dOf(x)) < TOL * Math.max(1, Math.abs(y))) out.push({ x, y, rough: false });
  }
  return out;
}

/* ---- tables -------------------------------------------------------- */
export const MAX_ROWS = 200;
/** -> { head: [..], rows: [[number|null, …]] }. null = undefined at that value. */
export function tableOf(curve, from, step, rows) {
  const n = Math.max(1, Math.min(MAX_ROWS, Math.floor(rows) || 1));
  const head = curve.kind === 'y' ? ['x', 'y'] : curve.kind === 'polar' ? ['t', 'r', 'x', 'y'] : ['t', 'x', 'y'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = from + step * i;
    let row;
    try {
      if (curve.kind === 'polar') { const p = curve.at(t); row = [t, curve.rOf(t), p[0], p[1]]; }
      else { const p = curve.at(t); row = curve.kind === 'y' ? [t, p[1]] : [t, p[0], p[1]]; }
    } catch (e) { row = [t]; }
    out.push(row.map(v => (fin(v) ? v : null)).concat(Array(head.length - row.length).fill(null)));
  }
  return { head, rows: out };
}

export default { compile, constant, makeCurve, intersections, tableOf, KINDS };
