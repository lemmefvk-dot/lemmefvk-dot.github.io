/* ============================================================
   graphmath.js (core) — Static Graph's maths. No DOM.

   · compile(src, vars, opts) — the safe expression parser (NO eval, NO
     Function): the text is tokenised and parsed by recursive descent into
     a tree of small closures, one per node. Only the names listed here can
     be reached (own properties of null-prototype tables, so "constructor"
     and "__proto__" are simply unknown names; the sliders' names come from
     the fixed list PARAMS, never from the text). Precedence: + − then
     × ÷ % and implicit multiply, then unary − +, then ^ (right to left).
     `vars` are the names that stand for the first variable: ['x'] for
     y = f(x), ['t', 'theta'] for polar r(t) and parametric x(t), y(t).
     opts: { second: ['y'] a second variable (equations in x and y),
             params: a null-prototype object holding the sliders a, b, c
                     (read when the curve is worked out, so moving a
                     slider needs no recompiling),
             deg: true when angles are in degrees }.
     A run of letters that is not a name is read as a product of names
     when it can be ("ax" is a·x, "2bx" is 2·b·x, "xsin(x)" is x·sin(x)).

   · makeCurve(spec, env) — one curve as a point function at(t):
       y         y = f(x) (or y < f(x) … for a shaded inequality)
       polar     r = f(t)          at(t) = [r cos t, r sin t]
       param     x = f(t), y = g(t)
       implicit  an equation or inequality in x and y (x^2 + y^2 = 25)
       points    typed x, y pairs, with a least-squares line if asked

   · intersections(curves, view) — where curves cross, found numerically:
     each curve is sampled densely (SAMPLES across the view for y = f(x);
     about 1200 per turn for the others), every crossing between the
     sampled polylines is found (a grid keeps it fast), and each is then
     polished with a two-variable Newton iteration until the two curves
     agree to better than TOL. A y = f(x) pair also looks for places the
     curves touch without crossing (y = x² and y = 0). An equation in x
     and y meets another curve where F(curve(t)) changes sign along it;
     that is narrowed by bisection until the point is within TOL of both.
     Everything is APPROXIMATE: points are given to 6 decimal places and
     are marked "rough" (3 places) when the polish did not converge. Only
     points inside the current view are found, and two crossings closer
     than one sample step can be missed; a self-crossing of one curve, and
     two equations in x and y with each other, are not looked for.

   · keyPoints(curve, view) — zeros, maxima and minima of y = f(x) inside
     the view. Zeros: a sign change between samples, narrowed by bisection
     to the last bit of x (and refused when |f| does not shrink there: a
     pole such as 1/x, or a jump). A zero where the curve only touches
     the axis (x²) is a turning point whose height is 0. Turning points:
     where the sampled curve changes direction, refined by golden-section
     search; x is good to about 7 decimal places (a flat top limits any
     method that only compares heights), y to about 12.

   · tangentAt(curve, x) — the slope by Ridders' method (central
     differences with Richardson extrapolation), with its error estimate.
     A corner or a jump is caught by comparing one-sided slopes.

   · integrate(f, a, b) — adaptive Simpson's rule to TOL_AREA, with the
     estimated error; refuses when the curve is undefined or infinite in
     the range, or when the estimate will not settle.

   · implicitGrid(F, rel, view, nx, ny) — marching squares: the sign of F
     at the corners of an nx × ny grid, each crossing of a grid edge
     narrowed by bisection (so drawn points lie on the curve), saddles
     resolved by the centre value, poles refused like zeros are.

   · tableOf(curve, from, step, rows) — a table of values.
   ============================================================ */
import { parsePairs, fitLine } from './stats.js';

/* ---- the maths the parser is allowed to reach ---------------------- */
const own = o => Object.assign(Object.create(null), o);
const D2R = Math.PI / 180;
/* [function, fewest arguments, most arguments, angle: 'in' takes one, 'out' gives one] */
const FUNCS = own({
  sin: [Math.sin, 1, 1, 'in'], cos: [Math.cos, 1, 1, 'in'], tan: [Math.tan, 1, 1, 'in'],
  sec: [v => 1 / Math.cos(v), 1, 1, 'in'], csc: [v => 1 / Math.sin(v), 1, 1, 'in'], cot: [v => Math.cos(v) / Math.sin(v), 1, 1, 'in'],
  asin: [Math.asin, 1, 1, 'out'], acos: [Math.acos, 1, 1, 'out'], atan: [Math.atan, 1, 1, 'out'],
  arcsin: [Math.asin, 1, 1, 'out'], arccos: [Math.acos, 1, 1, 'out'], arctan: [Math.atan, 1, 1, 'out'],
  sinh: [Math.sinh, 1, 1], cosh: [Math.cosh, 1, 1], tanh: [Math.tanh, 1, 1],
  asinh: [Math.asinh, 1, 1], acosh: [Math.acosh, 1, 1], atanh: [Math.atanh, 1, 1],
  sqrt: [Math.sqrt, 1, 1], abs: [Math.abs, 1, 1], exp: [Math.exp, 1, 1],
  log: [Math.log10, 1, 1], ln: [Math.log, 1, 1],
  floor: [Math.floor, 1, 1], ceil: [Math.ceil, 1, 1], round: [Math.round, 1, 1], sign: [Math.sign, 1, 1],
  /* mod takes the sign of the divisor, as in maths: mod(−1, 3) = 2 */
  mod: [(a, b) => a - b * Math.floor(a / b), 2, 2],
  min: [Math.min, 1, 20], max: [Math.max, 1, 20],
});
const CONSTS = own({ pi: Math.PI, e: Math.E });
/* the sliders: these names and no others, whatever the text says */
export const PARAMS = Object.freeze(['a', 'b', 'c']);
export const MAX_EXPR = 300;
export const FUNCTION_NAMES = 'sin cos tan sec csc cot asin acos atan sinh cosh tanh sqrt abs exp log ln floor ceil round sign mod(a, b) min(…) max(…)';
const RELS = ['=', '<', '>', '<=', '>='];
export const REL_TEXT = { '=': '=', '<': '<', '>': '>', '<=': '≤', '>=': '≥' };

/* ---- tokeniser ----------------------------------------------------- */
function tokenize(src, rels) {
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
    if ('+-*/^%(),'.includes(c)) { toks.push({ t: c }); i++; continue; }
    /* =, <, >, <=, >= only in an equation; anywhere else they are just unexpected */
    if (rels && (c === '<' || c === '>')) {
      if (s[i + 1] === '=') { toks.push({ t: 'rel', v: c + '=' }); i += 2; } else { toks.push({ t: 'rel', v: c }); i++; }
      continue;
    }
    if (rels && c === '=') { toks.push({ t: 'rel', v: '=' }); i++; continue; }
    if (rels && c === '≤') { toks.push({ t: 'rel', v: '<=' }); i++; continue; }
    if (rels && c === '≥') { toks.push({ t: 'rel', v: '>=' }); i++; continue; }
    if (c === 'π') { toks.push({ t: 'id', v: 'pi' }); i++; continue; }
    if (c === 'θ') { toks.push({ t: 'id', v: 'theta' }); i++; continue; }
    if (c === '−') { toks.push({ t: '-' }); i++; continue; }
    if (c === '×' || c === '·') { toks.push({ t: '*' }); i++; continue; }
    if (c === '÷') { toks.push({ t: '/' }); i++; continue; }
    if (c === '²') { toks.push({ t: '^' }, { t: 'num', v: 2 }); i++; continue; }
    if (c === '³') { toks.push({ t: '^' }, { t: 'num', v: 3 }); i++; continue; }
    throw new Error(`unexpected "${c}"`);
  }
  return toks;
}

const show = tk => (!tk ? 'end of input' : tk.t === 'num' ? String(tk.v) : tk.t === 'id' ? `"${tk.v}"` : tk.t === 'rel' ? `"${REL_TEXT[tk.v]}"` : `"${tk.t}"`);

/* ---- parser → a closure fn(x, y) ------------------------------------ */
function parseTokens(toks, vars, opts) {
  const second = opts.second || [];
  const P = opts.params || null;
  const deg = !!opts.deg;
  const used = new Set();
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];
  const expect = t => { const k = eat(); if (!k || k.t !== t) throw new Error(`expected "${t}", got ${show(k)}`); };
  const startsAtom = tk => tk && (tk.t === 'num' || tk.t === 'id' || tk.t === '(');

  function parseExpr() {
    let a = parseTerm();
    for (let p = peek(); p && (p.t === '+' || p.t === '-'); p = peek()) {
      const op = eat().t, b = parseTerm(), l = a;
      a = op === '+' ? (x, y) => l(x, y) + b(x, y) : (x, y) => l(x, y) - b(x, y);
    }
    return a;
  }
  function parseTerm() {
    let a = parseUnary();
    for (;;) {
      const p = peek();
      if (p && (p.t === '*' || p.t === '/' || p.t === '%')) {
        const op = eat().t, b = parseUnary(), l = a;
        a = op === '*' ? (x, y) => l(x, y) * b(x, y) : op === '/' ? (x, y) => l(x, y) / b(x, y) : (x, y) => l(x, y) % b(x, y);
      } else if (startsAtom(p)) {
        const b = parseUnary(), l = a;
        a = (x, y) => l(x, y) * b(x, y);
      } else break;
    }
    return a;
  }
  function parseUnary() {
    const p = peek();
    if (p && p.t === '-') { eat(); const a = parseUnary(); return (x, y) => -a(x, y); }
    if (p && p.t === '+') { eat(); return parseUnary(); }
    return parsePow();
  }
  /* in "ax^2" the power belongs to the x alone: parseAtom hands back the a as `head` */
  function parsePow() {
    const { head, base } = parseAtom();
    let b = base;
    if (peek() && peek().t === '^') { eat(); const ex = parseUnary(); b = (x, y) => Math.pow(base(x, y), ex(x, y)); }
    if (!head) return b;
    const pow = b;
    return (x, y) => head(x, y) * pow(x, y);
  }
  /* a plain name: a variable, a slider or a constant; else null */
  function simple(name) {
    if (vars.includes(name)) return x => x;
    if (second.includes(name)) return (x, y) => y;
    if (P && PARAMS.includes(name) && name in P) { used.add(name); return () => P[name]; }
    if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
    return null;
  }
  function call(name) {
    const [f, lo, hi, ang] = FUNCS[name];
    expect('(');
    const args = [parseExpr()];
    while (peek() && peek().t === ',') { eat(); args.push(parseExpr()); }
    expect(')');
    if (args.length < lo || args.length > hi) {
      throw new Error(lo === hi ? `${name} takes ${lo === 1 ? 'one number' : `${lo} numbers, like ${name}(7, 3)`}` : `${name} takes from ${lo} to ${hi} numbers`);
    }
    if (args.length === 1) {
      const a = args[0];
      if (deg && ang === 'in') return (x, y) => f(a(x, y) * D2R);
      if (deg && ang === 'out') return (x, y) => f(a(x, y)) / D2R;
      return (x, y) => f(a(x, y));
    }
    if (args.length === 2) { const [a, b] = args; return (x, y) => f(a(x, y), b(x, y)); }
    return (x, y) => f(...args.map(g => g(x, y)));
  }
  /* "ax", "2bx", "xsin(x)": a run of letters read as a product of known names,
     a function only at the very end and only when "(" follows */
  function split(name) {
    const atoms = [...vars, ...second, ...(P ? PARAMS.filter(k => k in P) : []), ...Object.keys(CONSTS)];
    const funcs = peek() && peek().t === '(' ? Object.keys(FUNCS) : [];
    const dead = new Set();
    const go = i => {
      if (i === name.length) return [];
      if (dead.has(i)) return null;
      const rest = name.slice(i);
      for (const f of funcs) if (rest === f) return [{ fn: f }];
      for (const a of atoms) {
        if (!rest.startsWith(a)) continue;
        const tail = go(i + a.length);
        if (tail) return [{ atom: a }, ...tail];
      }
      dead.add(i);
      return null;
    };
    return name.length > 1 ? go(0) : null;
  }
  /* -> { head, base }: base is the atom; head (or null) is what a run of letters put in front of it */
  function parseAtom() {
    const p = peek();
    if (!p) throw new Error('unexpected end of input');
    if (p.t === 'num') { eat(); const v = p.v; return { head: null, base: () => v }; }
    if (p.t === '(') { eat(); const e = parseExpr(); expect(')'); return { head: null, base: e }; }
    if (p.t === 'id') {
      eat();
      const name = p.v;
      const one = simple(name);
      if (one) return { head: null, base: one };
      if (name in FUNCS) return { head: null, base: call(name) };
      const parts = split(name);
      if (!parts) throw new Error(`unknown name "${name}"`);
      const fs = parts.map(q => (q.fn ? call(q.fn) : simple(q.atom)));
      const base = fs.pop();
      return { head: fs.reduce((l, r) => (x, y) => l(x, y) * r(x, y)), base };
    }
    throw new Error(`unexpected ${show(p)}`);
  }

  const fn = parseExpr();
  if (pos < toks.length) throw new Error(`unexpected ${show(toks[pos])}`);
  fn.params = [...used];
  return fn;
}

export function compile(src, vars = ['x'], opts = {}) {
  if (String(src).length > MAX_EXPR) throw new Error(`too long (more than ${MAX_EXPR} characters)`);
  const toks = tokenize(src);
  if (!toks.length) throw new Error('empty');
  return parseTokens(toks, vars, opts || {});
}

/** "x^2 + y^2 = 25" -> { F(x, y) = left − right, rel }, or throws. */
export function compileRelation(src, vars = ['x'], opts = {}) {
  if (String(src).length > MAX_EXPR) throw new Error(`too long (more than ${MAX_EXPR} characters)`);
  const toks = tokenize(src, true);
  if (!toks.length) throw new Error('empty');
  const at = toks.map((t, i) => (t.t === 'rel' ? i : -1)).filter(i => i >= 0);
  if (!at.length) throw new Error('an equation needs =, <, >, ≤ or ≥, like x^2 + y^2 = 25');
  if (at.length > 1) throw new Error('use one =, <, >, ≤ or ≥');
  const i = at[0];
  if (i === 0 || i === toks.length - 1) throw new Error(`there must be something on both sides of "${REL_TEXT[toks[i].v]}"`);
  const L = parseTokens(toks.slice(0, i), vars, opts), R = parseTokens(toks.slice(i + 1), vars, opts);
  const F = (x, y) => L(x, y) - R(x, y);
  F.params = [...new Set([...L.params, ...R.params])];
  return { F, rel: toks[i].v };
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
export const KINDS = [['y', 'y = f(x)'], ['polar', 'r = f(t)'], ['param', 'x(t), y(t)'], ['implicit', 'equation in x, y'], ['points', 'points (x, y)']];
const VARS = { y: ['x'], polar: ['t', 'theta'], param: ['t'], implicit: ['x'] };
export const TWO_PI = 2 * Math.PI;
export const MAX_POINTS_TYPED = 500;
/* the curves that are a point function at(t) */
export const TRACED = new Set(['y', 'polar', 'param']);

/**
 * spec: { kind, expr, expr2, tmin, tmax, rel, fit } (tmin/tmax are expressions for polar and param)
 * env:  { params, deg }
 * -> { ok: true, kind, at(t) -> [x, y], t0, t1, label, params } or { ok: false, error }
 */
export function makeCurve(spec, env = {}) {
  const kind = KINDS.some(k => k[0] === spec.kind) ? spec.kind : 'y';
  const e1 = String(spec.expr || '').trim();
  if (!e1) return { ok: false, error: '', empty: true };
  const opts = { params: env.params || null, deg: !!env.deg };
  try {
    if (kind === 'points') return pointsCurve(e1, !!spec.fit);
    if (kind === 'implicit') {
      const { F, rel } = compileRelation(e1, VARS.implicit, { ...opts, second: ['y'] });
      return { ok: true, kind, F, rel, label: e1, params: F.params };
    }
    if (kind === 'y' && /[=<>≤≥]/.test(e1) && isRelation(e1, opts)) {
      return { ok: false, error: 'for an equation in x and y (like x^2 + y^2 = 25) choose “equation in x, y” as the type' };
    }
    const f = compile(e1, VARS[kind], opts);
    if (kind === 'y') {
      const rel = RELS.includes(spec.rel) ? spec.rel : '=';
      return { ok: true, kind, fn: f, rel, at: x => [x, f(x)], t0: -Infinity, t1: Infinity, label: `y ${REL_TEXT[rel]} ${e1}`, params: f.params };
    }
    const turn = env.deg ? 360 : TWO_PI;
    const t0 = constant(spec.tmin, 0), t1 = constant(spec.tmax, turn);
    if (!(t1 > t0)) return { ok: false, error: 'the end of the t range must be bigger than the start' };
    const widest = env.deg ? 1000 / D2R : 1000;
    if (t1 - t0 > widest) return { ok: false, error: `the t range can be at most ${env.deg ? Math.round(widest) : 1000} wide` };
    if (kind === 'polar') {
      const k = env.deg ? D2R : 1;
      return { ok: true, kind, rOf: f, turn, at: t => { const r = f(t); return [r * Math.cos(t * k), r * Math.sin(t * k)]; }, t0, t1, label: `r = ${e1}`, params: f.params };
    }
    const e2 = String(spec.expr2 || '').trim();
    if (!e2) return { ok: false, error: 'y(t) is empty' };
    const g = compile(e2, VARS.param, opts);
    return { ok: true, kind, turn, at: t => [f(t), g(t)], t0, t1, label: `x = ${e1}, y = ${e2}`, params: [...new Set([...f.params, ...g.params])] };
  } catch (err) {
    return { ok: false, error: err.message || 'parse error' };
  }
}

const isRelation = (src, opts) => { try { compileRelation(src, ['x'], { ...opts, second: ['y'] }); return true; } catch (e) { return false; } };

/* typed points: one "x, y" pair per line (js/core/stats.js reads them, and fits the line) */
function pointsCurve(text, fit) {
  const r = parsePairs(text);
  const pts = r.pairs.slice(0, MAX_POINTS_TYPED);
  if (!pts.length) return { ok: false, error: 'type one x, y pair per line, like 2, 3' };
  const note = [r.note, r.pairs.length > MAX_POINTS_TYPED ? `Only the first ${MAX_POINTS_TYPED} points are plotted.` : ''].filter(Boolean).join(' ');
  return { ok: true, kind: 'points', pts, fit: fit ? fitLine(pts) : null, note, label: `${pts.length} point${pts.length === 1 ? '' : 's'}`, params: [] };
}

/* ---- sampling ------------------------------------------------------ */
export const SAMPLES = 3000;
const fin = v => typeof v === 'number' && Number.isFinite(v);
function samplePoints(c, view) {
  const pts = [];
  const safe = t => { try { return c.at(t); } catch (e) { return [NaN, NaN]; } };
  let a, b, n;
  if (c.kind === 'y') { a = view.xmin; b = view.xmax; n = SAMPLES; }
  else { a = c.t0; b = c.t1; n = Math.min(12000, Math.max(1200, Math.round((b - a) / (c.turn || TWO_PI) * 1200))); }
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
 * -> { points: [{ x, y, a, b, rough, touch }], capped, skipped }
 *    skipped: how many pairs of equations in x and y were not looked at
 */
export function intersections(curves, view) {
  const eps = 1e-6 * Math.max(1, view.xmax - view.xmin);
  const points = [];
  let capped = false, skipped = 0;
  const live = curves.filter(c => c.curve && c.curve.ok && (TRACED.has(c.curve.kind) || c.curve.kind === 'implicit'));
  const polys = live.map(c => (c.curve.kind === 'implicit' ? null : samplePoints(c.curve, view)));
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const ca = live[i].curve, cb = live[j].curve;
    const found = [];
    const add = (pt, touch) => {
      if (pt.x < view.xmin - eps || pt.x > view.xmax + eps || pt.y < view.ymin - eps || pt.y > view.ymax + eps) return;
      if (found.some(q => same(q, pt, eps))) return;
      found.push({ ...pt, a: live[i].name, b: live[j].name, touch: !!touch });
    };
    if (ca.kind === 'implicit' && cb.kind === 'implicit') { skipped++; continue; }
    if (ca.kind === 'implicit' || cb.kind === 'implicit') {
      const [imp, other] = ca.kind === 'implicit' ? [ca, cb] : [cb, ca];
      for (const pt of implicitCrossings(imp, other, view)) add(pt, false);
    } else {
      const yy = ca.kind === 'y' && cb.kind === 'y';
      for (const g of polylineCrossings(polys[i], polys[j], view)) {
        const r = polish(ca, cb, g);
        const pt = r && r.err < TOL && fin(r.x) && fin(r.y) ? { x: r.x, y: r.y, rough: false } : { x: g.x, y: g.y, rough: true };
        add(pt, yy && !pt.rough && touchesOnly(ca, cb, pt.x));
      }
      if (yy) for (const t of touching(ca, cb, polys[i], polys[j])) add(t, true);
    }
    found.sort((p, q) => p.x - q.x || p.y - q.y);
    for (const p of found) { if (points.length >= MAX_POINTS) { capped = true; break; } points.push(p); }
  }
  return { points, capped, skipped };
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

/* how far (x, y) is from F = 0, to first order: |F| / |∇F| */
function distTo(F, x, y) {
  const v = F(x, y);
  const hx = 1e-7 * Math.max(1, Math.abs(x)), hy = 1e-7 * Math.max(1, Math.abs(y));
  const gx = (F(x + hx, y) - F(x - hx, y)) / (2 * hx), gy = (F(x, y + hy) - F(x, y - hy)) / (2 * hy);
  const g = Math.hypot(gx, gy);
  return fin(v) && fin(g) && g > 0 ? Math.abs(v) / g : (v === 0 ? 0 : Infinity);
}
/* an equation F(x, y) = 0 meets the curve C(t) where F(C(t)) changes sign along it */
function implicitCrossings(imp, C, view) {
  const F = imp.F;
  const g = t => { try { const [x, y] = C.at(t); return F(x, y); } catch (e) { return NaN; } };
  let a, b, n;
  if (C.kind === 'y') { a = view.xmin; b = view.xmax; n = SAMPLES; }
  else { a = C.t0; b = C.t1; n = Math.min(12000, Math.max(1200, Math.round((b - a) / (C.turn || TWO_PI) * 1200))); }
  const out = [];
  let pt = a, pv = g(a);
  for (let i = 1; i <= n; i++) {
    const t = i === n ? b : a + (b - a) * i / n, v = g(t);
    if (fin(pv) && fin(v) && (v === 0 || pv * v < 0)) {
      let lo = pt, hi = t, flo = pv;
      if (v !== 0) {
        for (let k = 0; k < 200 && hi - lo > 1e-15 * Math.max(1, Math.abs(lo)); k++) {
          const m = (lo + hi) / 2, fm = g(m);
          if (!fin(fm)) break;
          if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m;
        }
      } else lo = hi = t;
      const tm = (lo + hi) / 2;
      const [x, y] = C.at(tm);
      if (fin(x) && fin(y)) {
        const d = distTo(F, x, y);
        if (d < TOL) out.push({ x, y, rough: false });
        else if (d < 1e-4) out.push({ x, y, rough: true });         /* a pole is far off: refused */
      }
    }
    pt = t; pv = v;
  }
  return out;
}

/* ---- zeros, maxima and minima of y = f(x) ---------------------------- */
export const MAX_KEY = 40;
const GOLD = (Math.sqrt(5) - 1) / 2;
/** golden-section search for the highest (sign 1) or lowest (sign −1) point in [lo, hi] */
function golden(f, lo, hi, sign) {
  let c = hi - GOLD * (hi - lo), d = lo + GOLD * (hi - lo);
  let fc = sign * f(c), fd = sign * f(d);
  for (let k = 0; k < 200 && hi - lo > 1e-15 * Math.max(1, Math.abs(lo) + Math.abs(hi)); k++) {
    if (fc > fd) { hi = d; d = c; fd = fc; c = hi - GOLD * (hi - lo); fc = sign * f(c); }
    else { lo = c; c = d; fc = fd; d = lo + GOLD * (hi - lo); fd = sign * f(d); }
  }
  return (lo + hi) / 2;
}
/* then sharper: bisection on the slope (a central difference) near the golden-section answer,
   when the slope really changes sign there; else the golden-section answer stands */
function slopeZero(f, xg, lo, hi, sign) {
  const s = Math.max(1, Math.abs(xg)), h = 1e-5 * s;
  const d = x => (f(x + h) - f(x - h)) / (2 * h);
  let a = Math.max(lo, xg - 1e-6 * s), b = Math.min(hi, xg + 1e-6 * s);
  let da = sign * d(a), db = sign * d(b);
  if (!(da > 0 && db < 0)) return xg;
  for (let k = 0; k < 100 && b - a > 4e-16 * s; k++) {
    const m = (a + b) / 2, dm = sign * d(m);
    if (!fin(dm)) return xg;
    if (dm > 0) { a = m; da = dm; } else { b = m; db = dm; }
  }
  const x = (a + b) / 2;
  return sign * f(x) >= sign * f(xg) - 1e-15 * Math.max(1, Math.abs(f(xg))) ? x : xg;
}
/**
 * curve: a y = f(x) curve; view: { xmin, xmax, ymin, ymax }
 * -> { zeros: [{ x, y, touch }], maxima: [{ x, y }], minima: [{ x, y }], capped }
 */
export function keyPoints(curve, view) {
  const out = { zeros: [], maxima: [], minima: [], capped: false };
  if (!curve || !curve.ok || curve.kind !== 'y') return out;
  const f = x => { try { const v = curve.fn(x); return fin(v) ? v : NaN; } catch (e) { return NaN; } };
  const n = SAMPLES, a = view.xmin, b = view.xmax, hgt = view.ymax - view.ymin;
  const xs = new Float64Array(n + 1), ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) { xs[i] = i === n ? b : a + (b - a) * i / n; ys[i] = f(xs[i]); }
  const push = (list, p) => { if (list.length >= MAX_KEY) out.capped = true; else list.push(p); };
  const near = (list, x) => list.some(p => Math.abs(p.x - x) <= 1e-7 * Math.max(1, Math.abs(x)));
  /* zeros: a sign change, narrowed by bisection; refused where |f| does not shrink (a pole or a jump) */
  for (let i = 1; i <= n; i++) {
    const y0 = ys[i - 1], y1 = ys[i];
    if (!fin(y0) || !fin(y1)) continue;
    if (y1 === 0) {
      /* landed exactly on a zero: count it once, and only an isolated one */
      if (y0 !== 0 && i < n && fin(ys[i + 1]) && ys[i + 1] !== 0 && !near(out.zeros, xs[i])) push(out.zeros, { x: xs[i], y: 0, touch: Math.sign(y0) === Math.sign(ys[i + 1]) });
      continue;
    }
    if (y0 === 0 || y0 * y1 > 0) continue;
    let lo = xs[i - 1], hi = xs[i], flo = y0;
    for (let k = 0; k < 200; k++) {
      const m = (lo + hi) / 2;
      if (m <= lo || m >= hi) break;
      const fm = f(m);
      if (!fin(fm)) { lo = NaN; break; }
      if (fm === 0) { lo = hi = m; break; }
      if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m;
    }
    if (!fin(lo)) continue;
    const x = Math.abs(f(lo)) <= Math.abs(f(hi)) ? lo : hi, fx = f(x);
    if (fin(fx) && Math.abs(fx) <= 1e-6 * Math.max(Math.abs(y0), Math.abs(y1)) && !near(out.zeros, x)) push(out.zeros, { x, y: 0, touch: false });
  }
  /* turning points: the sampled curve changes direction (a run of equal heights counts as one sample) */
  for (let i = 1; i < n; i++) {
    if (!fin(ys[i - 1]) || !fin(ys[i])) continue;
    let j = i;
    while (j < n && ys[j + 1] === ys[i]) j++;
    if (j >= n || !fin(ys[j + 1]) || j - i > 1) { i = j; continue; }
    const d1 = ys[i] - ys[i - 1], d2 = ys[j + 1] - ys[j];
    const jump = Math.max(Math.abs(d1), Math.abs(d2)) > hgt * 0.5;     /* a jump or an asymptote, not a turn */
    const kind = d1 > 0 && d2 < 0 ? 1 : d1 < 0 && d2 > 0 ? -1 : 0;
    if (kind && !jump) {
      const x = slopeZero(f, golden(f, xs[i - 1], xs[j + 1], kind), xs[i - 1], xs[j + 1], kind), y = f(x);
      const inside = x > xs[i - 1] && x < xs[j + 1];
      /* a true turn is at least as high (low) as the samples around it, and not off to infinity */
      if (fin(y) && inside && kind * (y - ys[i]) >= -1e-12 * Math.max(1, Math.abs(y)) && Math.abs(y - ys[i]) < hgt) {
        if (Math.abs(y) <= 1e-10 * Math.max(1, Math.abs(ys[i - 1]), Math.abs(ys[j + 1])) || y === 0) {
          if (!near(out.zeros, x)) push(out.zeros, { x, y: 0, touch: true });
        }
        push(kind > 0 ? out.maxima : out.minima, { x, y });
      }
    }
    i = j;
  }
  out.zeros.sort((p, q) => p.x - q.x);
  return out;
}

/* ---- the tangent at a point ------------------------------------------- */
/** Ridders' method: central differences at shrinking steps, extrapolated (Richardson). -> { d, err } */
function ridders(f, x, h0) {
  const CON = 1.4, CON2 = CON * CON, NTAB = 10, SAFE = 2;
  const a = Array.from({ length: NTAB }, () => new Array(NTAB).fill(0));
  let hh = h0, err = Infinity, ans = NaN;
  a[0][0] = (f(x + hh) - f(x - hh)) / (2 * hh);
  for (let i = 1; i < NTAB; i++) {
    hh /= CON;
    a[0][i] = (f(x + hh) - f(x - hh)) / (2 * hh);
    let fac = CON2;
    for (let j = 1; j <= i; j++) {
      a[j][i] = (a[j - 1][i] * fac - a[j - 1][i - 1]) / (fac - 1);
      fac *= CON2;
      const e = Math.max(Math.abs(a[j][i] - a[j - 1][i]), Math.abs(a[j][i] - a[j - 1][i - 1]));
      if (e <= err) { err = e; ans = a[j][i]; }
    }
    if (Math.abs(a[i][i] - a[i - 1][i - 1]) >= SAFE * err) break;
  }
  return { d: ans, err };
}
export const SLOPE_TOL = 1e-6;
/**
 * The tangent to y = f(x) at x0.
 * -> { ok, x, y, slope, intercept, err } or { ok: false, why }
 */
export function tangentAt(curve, x0) {
  if (!curve || !curve.ok || curve.kind !== 'y') return { ok: false, why: 'a tangent needs a curve y = f(x)' };
  if (!fin(x0)) return { ok: false, why: 'the x for the tangent must be a number' };
  const f = x => { try { const v = curve.fn(x); return fin(v) ? v : NaN; } catch (e) { return NaN; } };
  const y0 = f(x0);
  if (!fin(y0)) return { ok: false, why: `the curve is not defined at x = ${+x0.toPrecision(8)}` };
  const s = Math.max(1, Math.abs(x0));
  /* a step that stays where the curve is defined on both sides */
  let h = 0.05 * s;
  for (let k = 0; k < 40 && !(fin(f(x0 + h)) && fin(f(x0 - h))); k++) h /= 2;
  if (!(fin(f(x0 + h)) && fin(f(x0 - h)))) return { ok: false, why: 'the curve is not defined on both sides of that x, so it has no tangent there' };
  /* a corner or a jump: the slopes from the left and the right stay apart as the step shrinks */
  const gap = hh => Math.abs((f(x0 + hh) - y0) / hh - (y0 - f(x0 - hh)) / hh);
  const g1 = gap(Math.min(h, 1e-4 * s)), g2 = gap(Math.min(h, 1e-6 * s));
  const { d, err } = ridders(f, x0, h);
  if (!fin(d)) return { ok: false, why: 'the slope there is not a number (the tangent may be vertical)' };
  if (g2 > 0.5 * g1 && g2 > 1e-5 * Math.max(1, Math.abs(d))) return { ok: false, why: 'the curve has a corner or a jump there, so it has no single tangent' };
  if (!(err <= SLOPE_TOL * Math.max(1, Math.abs(d)))) return { ok: false, why: 'the slope there could not be found to 6 places (the tangent may be vertical, or the curve too wild)' };
  return { ok: true, x: x0, y: y0, slope: d, intercept: y0 - d * x0, err };
}

/* ---- the area under a curve ------------------------------------------- */
export const TOL_AREA = 1e-10;
/**
 * The integral of f from a to b by adaptive Simpson's rule.
 * -> { ok, value, err, evals } or { ok: false, why }
 */
export function integrate(f, a, b, tol = TOL_AREA) {
  if (!fin(a) || !fin(b)) return { ok: false, why: 'the ends must be numbers' };
  if (a === b) return { ok: true, value: 0, err: 0, evals: 0 };
  let sign = 1;
  if (a > b) { [a, b] = [b, a]; sign = -1; }
  let evals = 0, bad = null, deep = false, errSum = 0;
  const F = x => { evals++; let v; try { v = f(x); } catch (e) { v = NaN; } if (!fin(v) && bad === null) bad = x; return v; };
  const simpson = (l, fl, fm, r, fr) => (r - l) / 6 * (fl + 4 * fm + fr);
  function rec(l, fl, r, fr, m, fm, whole, eps, depth) {
    const lm = (l + m) / 2, rm = (m + r) / 2, flm = F(lm), frm = F(rm);
    if (bad !== null) return NaN;
    const left = simpson(l, fl, flm, m, fm), right = simpson(m, fm, frm, r, fr), delta = left + right - whole;
    eps = Math.max(eps, 4e-16 * (Math.abs(left) + Math.abs(right)));
    if (Math.abs(delta) <= 15 * eps || depth <= 0 || evals > 2e6) {
      if (Math.abs(delta) > 15 * eps) deep = true;
      errSum += Math.abs(delta) / 15;
      return left + right + delta / 15;
    }
    return rec(l, fl, m, fm, lm, flm, left, eps / 2, depth - 1) + rec(m, fm, r, fr, rm, frm, right, eps / 2, depth - 1);
  }
  /* sixteen pieces first, so a curve that happens to look flat at five points is not missed */
  const N = 16, w = (b - a) / N;
  let sum = 0;
  for (let k = 0; k < N && bad === null; k++) {
    const l = a + w * k, r = k === N - 1 ? b : a + w * (k + 1), m = (l + r) / 2;
    const fl = F(l), fr = F(r), fm = F(m);
    if (bad !== null) break;
    sum += rec(l, fl, r, fr, m, fm, simpson(l, fl, fm, r, fr), Math.max(tol / N, 1e-15 * w), 40);
  }
  if (bad !== null) return { ok: false, why: `the curve is undefined or infinite at x ≈ ${+bad.toPrecision(6)}, inside the range` };
  if (deep && errSum > 1e-6 * Math.max(1, Math.abs(sum))) return { ok: false, why: 'the estimate would not settle: the curve may go to infinity or jump too often in that range' };
  return { ok: true, value: sign * sum, err: errSum, evals };
}

/* ---- equations in x and y: marching squares ---------------------------- */
const holds = (rel, v) => (rel === '<' ? v < 0 : rel === '>' ? v > 0 : rel === '<=' ? v <= 0 : rel === '>=' ? v >= 0 : false);
/**
 * F(x, y) on an nx × ny grid over the view.
 * -> { segs: [x1, y1, x2, y2, …] (world units), mask: Uint8Array(nx*ny) | null (1 where the inequality holds) }
 */
export function implicitGrid(F, rel, view, nx, ny) {
  const dx = (view.xmax - view.xmin) / nx, dy = (view.ymax - view.ymin) / ny;
  const X = i => view.xmin + i * dx, Y = j => view.ymin + j * dy;
  const val = (x, y) => { try { const v = F(x, y); return fin(v) ? v : NaN; } catch (e) { return NaN; } };
  const W = nx + 1;
  const v = new Float64Array(W * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) v[j * W + i] = val(X(i), Y(j));
  /* where F crosses 0 on an edge from (x1,y1) to (x2,y2), narrowed by bisection; null for a pole */
  const cache = new Map();
  const cross = (key, x1, y1, f1, x2, y2, f2) => {
    if (cache.has(key)) return cache.get(key);
    let lo = 0, hi = 1, flo = f1;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2, fm = val(x1 + (x2 - x1) * m, y1 + (y2 - y1) * m);
      if (!fin(fm)) { lo = NaN; break; }
      if ((fm >= 0) === (flo >= 0)) { lo = m; flo = fm; } else hi = m;
    }
    let r = null;
    if (fin(lo)) {
      const m = (lo + hi) / 2, px = x1 + (x2 - x1) * m, py = y1 + (y2 - y1) * m, fm = val(px, py);
      if (fin(fm) && Math.abs(fm) <= 1e-3 * Math.max(Math.abs(f1), Math.abs(f2))) r = [px, py];
    }
    cache.set(key, r);
    return r;
  };
  const segs = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = v[j * W + i], b = v[j * W + i + 1], c = v[(j + 1) * W + i + 1], d = v[(j + 1) * W + i];
    if (!fin(a) || !fin(b) || !fin(c) || !fin(d)) continue;
    const sa = a >= 0, sb = b >= 0, sc = c >= 0, sd = d >= 0;
    if (sa === sb && sb === sc && sc === sd) continue;
    const x0 = X(i), x1 = X(i + 1), y0 = Y(j), y1 = Y(j + 1);
    /* edges: 0 bottom a-b, 1 right b-c, 2 top d-c, 3 left a-d */
    const E = [
      sa !== sb ? cross(`h${j}:${i}`, x0, y0, a, x1, y0, b) : null,
      sb !== sc ? cross(`v${j}:${i + 1}`, x1, y0, b, x1, y1, c) : null,
      sd !== sc ? cross(`h${j + 1}:${i}`, x0, y1, d, x1, y1, c) : null,
      sa !== sd ? cross(`v${j}:${i}`, x0, y0, a, x0, y1, d) : null,
    ];
    const seg = (p, q) => { if (E[p] && E[q]) segs.push(E[p][0], E[p][1], E[q][0], E[q][1]); };
    const n = (sa !== sb) + (sb !== sc) + (sd !== sc) + (sa !== sd);
    if (n === 4) {
      /* a saddle: the centre says which corners join */
      const mid = val((x0 + x1) / 2, (y0 + y1) / 2);
      if ((mid >= 0) === sa) { seg(0, 1); seg(2, 3); } else { seg(0, 3); seg(1, 2); }
    } else {
      const on = [0, 1, 2, 3].filter(k => (k === 0 ? sa !== sb : k === 1 ? sb !== sc : k === 2 ? sd !== sc : sa !== sd));
      if (on.length === 2) seg(on[0], on[1]);
    }
  }
  let mask = null;
  if (rel && rel !== '=') {
    mask = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const m = val(X(i + 0.5), Y(j + 0.5));
      if (fin(m) && holds(rel, m)) mask[j * nx + i] = 1;
    }
  }
  return { segs, mask };
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

/* ---- saved graphs, files and links ------------------------------------ */
export const MAX_FNS = 12;
const STYLES = ['solid', 'dashed', 'dotted'];
const WIDTHS = [1, 2, 3];
export const SLIDER = Object.freeze({ v: 1, min: -10, max: 10, step: 0.1 });
const str = (v, n = MAX_EXPR) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9 ? v : d);
/** One function row from whatever was saved, every field checked. */
export function cleanFn(f, i = 0) {
  const o = f && typeof f === 'object' ? f : {};
  return {
    kind: KINDS.some(k => k[0] === o.kind) ? o.kind : 'y',
    expr: o.kind === 'points' ? str(o.expr, 20000) : str(o.expr), expr2: str(o.expr2), tmin: str(o.tmin, 40), tmax: str(o.tmax, 40),
    rel: RELS.includes(o.rel) ? o.rel : '=',
    on: o.on !== false,
    ci: Number.isInteger(o.ci) && o.ci >= 0 && o.ci < 1000 ? o.ci : i,
    style: STYLES.includes(o.style) ? o.style : 'solid',
    width: WIDTHS.includes(o.width) ? o.width : 2,
    fit: !!o.fit,
  };
}
/** The sliders a, b, c from whatever was saved: each { v, min, max, step }, with min < max and v inside. */
export function cleanParams(p) {
  const out = {};
  for (const k of PARAMS) {
    const s = p && typeof p === 'object' && p[k] && typeof p[k] === 'object' ? p[k] : {};
    let min = num(s.min, SLIDER.min), max = num(s.max, SLIDER.max);
    if (!(max > min)) { min = SLIDER.min; max = SLIDER.max; }
    let step = num(s.step, SLIDER.step);
    if (!(step > 0) || step > max - min) step = Math.min(SLIDER.step, (max - min) / 10);
    out[k] = { v: Math.min(max, Math.max(min, num(s.v, SLIDER.v))), min, max, step };
  }
  return out;
}
/** A whole graph (saved state, a .graph file or a link) -> a clean one, or null when it isn't a graph. */
export function cleanGraph(j) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.fns)) return null;
  const v = j.view && typeof j.view === 'object' ? j.view : null;
  return {
    fns: j.fns.slice(0, MAX_FNS).map(cleanFn),
    params: cleanParams(j.params),
    angle: j.angle === 'deg' ? 'deg' : 'rad',
    view: v && num(v.spanX, 0) >= 1e-6 && num(v.spanX, 0) <= 1e9 ? { cx: num(v.cx, 0), cy: num(v.cy, 0), spanX: v.spanX } : null,
  };
}
export const FILE_KIND = 'static-graph';
export const stringify = g => JSON.stringify({ app: FILE_KIND, v: 2, fns: g.fns.map(cleanFn), params: cleanParams(g.params), angle: g.angle === 'deg' ? 'deg' : 'rad', view: g.view || undefined }, null, 1);
/** A .graph file's text -> { graph } or { error } */
export function parseFile(text) {
  let j;
  try { j = JSON.parse(String(text)); } catch (e) { return { error: 'That is not a graph file.' }; }
  const g = cleanGraph(j);
  return g ? { graph: g } : { error: 'That is not a graph file.' };
}
/** The functions as plain text, one per line. */
export function asText(g) {
  const deg = g.angle === 'deg';
  const lines = [];
  for (const f of g.fns.map(cleanFn)) {
    const e = f.expr.trim();
    if (!e) continue;
    const range = ` for t from ${f.tmin.trim() || '0'} to ${f.tmax.trim() || (deg ? '360' : '2pi')}`;
    if (f.kind === 'y') lines.push(`y ${REL_TEXT[f.rel]} ${e}`);
    else if (f.kind === 'polar') lines.push(`r = ${e}${range}`);
    else if (f.kind === 'param') lines.push(`x = ${e}, y = ${f.expr2.trim()}${range}`);
    else if (f.kind === 'implicit') lines.push(e);
    else lines.push(`points: ${e.split(/\r?\n/).map(s => s.trim()).filter(Boolean).join('; ')}`);
  }
  /* the sliders the functions really use, as the parser read them */
  const p = cleanParams(g.params);
  const env = { params: own(Object.fromEntries(PARAMS.map(k => [k, p[k].v]))), deg };
  const used = new Set(g.fns.map(cleanFn).flatMap(f => { const c = makeCurve(f, env); return c.ok ? c.params : []; }));
  for (const k of PARAMS) if (used.has(k)) lines.push(`${k} = ${+p[k].v.toPrecision(6)}`);
  if (deg) lines.push('(angles in degrees)');
  return lines.join('\n');
}

export default { compile, compileRelation, constant, makeCurve, intersections, keyPoints, tangentAt, integrate, implicitGrid, tableOf, KINDS };
