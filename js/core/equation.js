/* ============================================================
   equation.js — solves linear and quadratic equations and shows the
   working, for the Equations tab of Static Study.

   Nothing here evaluates text as code. The input goes through a
   tokenizer and a recursive-descent parser into a small syntax tree
   (numbers, one letter, + − × ÷ ^, brackets, implicit multiplication
   such as 3x or 2(x+1)), and the tree is turned into a polynomial with
   EXACT rational coefficients (BigInt fractions). Square roots stay
   exact too: a root such as (3 + √5)/2 is the number 3/2 + (1/2)√5, and
   substituting it back is done in that number system (or, for complex
   roots, with √ of a negative number), so the check "left side =
   right side" is exact, not a rounded float comparison. Decimals are
   shown only as a convenience beside the exact answer.

     solveEquation(text) -> { ok:false, error, pos } or
       { ok:true, type:'linear'|'quadratic'|'none'|'all', v, input,
         steps:[{ say, eq? }], answer:{ lines:[...] }, check:[{ say, eq? }],
         verified, roots:[{ exact, decimal }] }
   ============================================================ */

export class EqError extends Error {
  constructor(msg, pos = null) { super(msg); this.pos = pos; }
}

/* ---------- exact fractions ---------- */
const big = BigInt;
const gcdB = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const LIMIT = 10n ** 40n;
export const F = (n, d = 1n) => {
  n = big(n); d = big(d);
  if (d === 0n) throw new EqError('That divides by zero.');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdB(n, d) || 1n;
  n /= g; d /= g;
  if (n > LIMIT || n < -LIMIT || d > LIMIT) throw new EqError('Those numbers are too large for me to work with exactly.');
  return { n, d };
};
const ZERO = F(0), ONE = F(1);
const fadd = (a, b) => F(a.n * b.d + b.n * a.d, a.d * b.d);
const fsub = (a, b) => F(a.n * b.d - b.n * a.d, a.d * b.d);
const fmul = (a, b) => F(a.n * b.n, a.d * b.d);
const fdiv = (a, b) => F(a.n * b.d, a.d * b.n);
const fneg = a => F(-a.n, a.d);
const fz = a => a.n === 0n;
const feq = (a, b) => a.n === b.n && a.d === b.d;
const fsign = a => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0);
const fabs = a => (a.n < 0n ? fneg(a) : a);
const fnum = a => Number(a.n) / Number(a.d);
const MIN = s => String(s).replace(/-/g, '−');
export const fstr = a => MIN(a.d === 1n ? String(a.n) : `${a.n}/${a.d}`);
const isInt = a => a.d === 1n;

/* ---------- tokens ---------- */
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      if (src[j] === '.') { j++; while (j < src.length && /[0-9]/.test(src[j])) j++; }
      const raw = src.slice(i, j);
      if (raw === '.' || (raw.match(/\./g) || []).length > 1) throw new EqError(`“${raw}” isn’t a number I can read (character ${i + 1}).`, i);
      if (raw.replace('.', '').length > 18) throw new EqError(`“${raw.slice(0, 12)}…” has too many digits for me to handle exactly.`, i);
      const [ip, fp = ''] = raw.split('.');
      out.push({ k: 'num', v: F(big((ip || '0') + fp), 10n ** big(fp.length)), pos: i, raw });
      i = j; continue;
    }
    if (/[A-Za-z]/.test(ch)) { out.push({ k: 'var', v: ch.toLowerCase(), pos: i, raw: ch }); i++; continue; }
    if (ch === '²' || ch === '³') { out.push({ k: 'op', v: '^', pos: i, raw: ch }, { k: 'num', v: F(ch === '²' ? 2 : 3), pos: i, raw: ch }); i++; continue; }
    if (ch === '*' && src[i + 1] === '*') { out.push({ k: 'op', v: '^', pos: i, raw: '**' }); i += 2; continue; }
    const map = { '−': '-', '–': '-', '—': '-', '×': '*', '·': '*', '∙': '*', '÷': '/', '＝': '=' };
    const c = map[ch] || ch;
    if ('+-*/^'.includes(c)) { out.push({ k: 'op', v: c, pos: i, raw: ch }); i++; continue; }
    if (c === '(' || c === ')' || c === '=') { out.push({ k: c, pos: i, raw: ch }); i++; continue; }
    if (ch === '[' || ch === '{') { out.push({ k: '(', pos: i, raw: ch }); i++; continue; }
    if (ch === ']' || ch === '}') { out.push({ k: ')', pos: i, raw: ch }); i++; continue; }
    throw new EqError(`I don’t understand “${ch}” (character ${i + 1}). Use numbers, one letter such as x, + − × ÷ ^ and brackets.`, i);
  }
  return out;
}

/* ---------- parser: tokens of one side -> syntax tree ---------- */
function parseSide(tokens, side, srcLen) {
  if (!tokens.length) throw new EqError(`There’s nothing ${side === 'left' ? 'before' : 'after'} the equals sign. Write something on both sides, like 2x + 1 = 7.`, srcLen);
  let i = 0;
  const peek = () => tokens[i];
  const startsFactor = t => t && (t.k === 'num' || t.k === 'var' || t.k === '(');
  const endsEarly = () => {
    const prev = tokens[i - 1];
    throw new EqError(prev ? `The equation ends too soon: something is missing after “${prev.raw}”.` : 'Something is missing here.', prev ? prev.pos + 1 : srcLen);
  };
  function expr() {
    let n = term();
    while (peek() && peek().k === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = tokens[i++].v;
      n = { t: op === '+' ? 'add' : 'sub', a: n, b: term() };
    }
    return n;
  }
  function term() {
    let n = unary();
    for (;;) {
      const t = peek();
      if (t && t.k === 'op' && (t.v === '*' || t.v === '/')) { i++; n = { t: t.v === '*' ? 'mul' : 'div', a: n, b: unary() }; continue; }
      /* implicit multiplication: 3x, 2(x+1), x(x+2), (x+1)(x−1), (x+1)2 */
      const prev = tokens[i - 1];
      if (t && (t.k === 'var' || t.k === '(' || (t.k === 'num' && prev && prev.k === ')'))) { n = { t: 'mul', a: n, b: unary(), imp: true }; continue; }
      return n;
    }
  }
  function unary() {
    const t = peek();
    if (t && t.k === 'op' && (t.v === '-' || t.v === '+')) { i++; const a = unary(); return t.v === '-' ? { t: 'neg', a } : a; }
    return power();
  }
  function power() {
    const a = atom();
    const t = peek();
    if (t && t.k === 'op' && t.v === '^') { i++; return { t: 'pow', a, b: unary() }; }
    return a;
  }
  function atom() {
    const t = peek();
    if (!t) endsEarly();
    if (t.k === 'num') { i++; return { t: 'num', v: t.v }; }
    if (t.k === 'var') { i++; return { t: 'var', name: t.v }; }
    if (t.k === '(') {
      i++;
      if (peek() && peek().k === ')') throw new EqError('There’s an empty pair of brackets “()”. Put something inside them.', t.pos);
      const n = expr();
      if (!peek()) throw new EqError(`The bracket opened at character ${t.pos + 1} is never closed. Add a “)”.`, t.pos);
      if (peek().k !== ')') unexpected(peek());
      i++;
      return { t: 'grp', a: n };
    }
    unexpected(t);
  }
  function unexpected(t) {
    if (t.k === ')') throw new EqError(`There’s a closing bracket “${t.raw}” at character ${t.pos + 1} with no matching “(”.`, t.pos);
    if (t.k === 'op' && i === 0) throw new EqError(`An equation can’t start with “${t.raw}” (character ${t.pos + 1}).`, t.pos);
    throw new EqError(`I didn’t expect “${t.raw}” at character ${t.pos + 1}${t.k === 'op' ? ': two operators in a row, or an operator with nothing after it' : ''}.`, t.pos);
  }
  const tree = expr();
  if (peek()) unexpected(peek());
  return tree;
}

export function parseEquation(text) {
  const src = String(text ?? '');
  if (src.length > 200) throw new EqError('That’s too long for me. Keep the equation under 200 characters.');
  if (!src.trim()) throw new EqError('Type an equation, like 3x + 5 = 2x − 7 or x^2 − 5x + 6 = 0.');
  const toks = tokenize(src);
  const eqs = toks.filter(t => t.k === '=');
  if (!eqs.length) throw new EqError('An equation needs an equals sign (=), like 2x + 1 = 7. I can’t solve an expression on its own.');
  if (eqs.length > 1) throw new EqError(`Only one equals sign (=) is allowed; I found ${eqs.length} (the second is at character ${eqs[1].pos + 1}).`, eqs[1].pos);
  const at = toks.findIndex(t => t.k === '=');
  const left = parseSide(toks.slice(0, at), 'left', eqs[0].pos);
  const right = parseSide(toks.slice(at + 1), 'right', src.length);
  const names = [...new Set(toks.filter(t => t.k === 'var').map(t => t.v))];
  if (names.length > 1) throw new EqError(`I found more than one unknown letter (${names.join(', ')}). I can only solve for one letter at a time.`);
  return { left, right, v: names[0] || 'x' };
}

/* ---------- polynomials with exact coefficients ---------- */
const trim = p => { const q = p.slice(); while (q.length > 1 && fz(q[q.length - 1])) q.pop(); return q; };
const deg = p => trim(p).length - 1;
const padd = (p, q) => trim(Array.from({ length: Math.max(p.length, q.length) }, (_, i) => fadd(p[i] || ZERO, q[i] || ZERO)));
const pneg = p => p.map(fneg);
const psub = (p, q) => padd(p, pneg(q));
const pmul = (p, q) => {
  const out = Array.from({ length: p.length + q.length - 1 }, () => ZERO);
  p.forEach((a, i) => q.forEach((b, j) => { out[i + j] = fadd(out[i + j], fmul(a, b)); }));
  return trim(out);
};
const TOO_HIGH = d => new EqError(`That’s degree ${d} (a power of x above 2). I can only solve linear equations (x) and quadratic ones (x²).`);

function toPoly(n) {
  switch (n.t) {
    case 'num': return [n.v];
    case 'var': return [ZERO, ONE];
    case 'grp': return toPoly(n.a);
    case 'neg': return pneg(toPoly(n.a));
    case 'add': return padd(toPoly(n.a), toPoly(n.b));
    case 'sub': return psub(toPoly(n.a), toPoly(n.b));
    case 'mul': return pmul(toPoly(n.a), toPoly(n.b));
    case 'div': {
      const d = toPoly(n.b);
      if (deg(d) > 0) throw new EqError('There’s an x in a denominator. I can only solve equations where you divide by plain numbers, like x/2.');
      if (fz(d[0])) throw new EqError('That divides by zero.');
      const inv = fdiv(ONE, d[0]);
      return trim(toPoly(n.a).map(c => fmul(c, inv)));
    }
    case 'pow': {
      const e = toPoly(n.b);
      if (deg(e) > 0 || !isInt(e[0])) throw new EqError('Powers must be whole numbers, like x^2. I can’t handle an x or a fraction in an exponent.');
      const k = Number(e[0].n);
      const base = toPoly(n.a);
      if (deg(base) === 0) {
        if (Math.abs(k) > 12) throw new EqError('That power is too large for me to work out exactly.');
        let r = ONE;
        for (let i = 0; i < Math.abs(k); i++) r = fmul(r, base[0]);
        if (k < 0) { if (fz(r)) throw new EqError('That divides by zero.'); r = fdiv(ONE, r); }
        return [r];
      }
      if (k < 0) throw new EqError('There’s an x in a denominator (a negative power of x). I can’t solve that yet.');
      if (k * deg(base) > 2) throw TOO_HIGH(k * deg(base));
      let r = [ONE];
      for (let i = 0; i < k; i++) r = pmul(r, base);
      return r;
    }
    default: throw new EqError('I couldn’t read that.');
  }
}

/* ---------- exact numbers with a square root: a + b·√s (s may be negative: complex) ---------- */
const S = (a, b, s) => ({ a, b, s });
const sadd = (x, y) => S(fadd(x.a, y.a), fadd(x.b, y.b), x.s);
const ssub = (x, y) => S(fsub(x.a, y.a), fsub(x.b, y.b), x.s);
const smul = (x, y) => S(fadd(fmul(x.a, y.a), fmul(fmul(x.b, y.b), F(x.s))), fadd(fmul(x.a, y.b), fmul(x.b, y.a)), x.s);
const sneg = x => S(fneg(x.a), fneg(x.b), x.s);
const siz = x => fz(x.a) && fz(x.b);
const seq = (x, y) => feq(x.a, y.a) && feq(x.b, y.b);
const lift = (f, s) => S(f, ZERO, s);

function evalAst(n, X) {
  const s = X.s;
  switch (n.t) {
    case 'num': return lift(n.v, s);
    case 'var': return X;
    case 'grp': return evalAst(n.a, X);
    case 'neg': return sneg(evalAst(n.a, X));
    case 'add': return sadd(evalAst(n.a, X), evalAst(n.b, X));
    case 'sub': return ssub(evalAst(n.a, X), evalAst(n.b, X));
    case 'mul': return smul(evalAst(n.a, X), evalAst(n.b, X));
    case 'div': {
      const d = evalAst(n.b, X);
      return smul(evalAst(n.a, X), lift(fdiv(ONE, d.a), s));
    }
    case 'pow': {
      const k = Number(evalAst(n.b, X).a.n);
      const base = evalAst(n.a, X);
      let r = lift(ONE, s);
      for (let i = 0; i < Math.abs(k); i++) r = smul(r, base);
      return k < 0 ? lift(fdiv(ONE, r.a), s) : r;
    }
    default: throw new EqError('I couldn’t read that.');
  }
}

/* ---------- printing ---------- */
const sup = { 2: '²', 3: '³' };
function polyStr(p, v = 'x') {
  const q = trim(p);
  const parts = [];
  for (let k = q.length - 1; k >= 0; k--) {
    const c = q[k];
    if (fz(c)) continue;
    const mag = fabs(c);
    let body;
    if (k === 0) body = fstr(mag);
    else {
      const x = v + (k > 1 ? (sup[k] || `^${k}`) : '');
      if (isInt(mag)) body = (feq(mag, ONE) ? '' : String(mag.n)) + x;
      else body = (mag.n === 1n ? '' : String(mag.n)) + x + '/' + mag.d;
    }
    parts.push({ neg: c.n < 0n, body });
  }
  if (!parts.length) return '0';
  return parts.map((t, i) => (i === 0 ? (t.neg ? '−' : '') : (t.neg ? ' − ' : ' + ')) + t.body).join('');
}

const PREC = { add: 1, sub: 1, mul: 2, div: 2, neg: 3, pow: 4, num: 5, var: 5, grp: 5 };
/* the tree as typed, tidied; with `sub` the unknown is replaced by that text */
function show(n, sub, v) {
  const num = x => (x.d === 1n ? MIN(x.n) : MIN(`${x.n}/${x.d}`));
  const wrap = (m, min) => { const s = go(m); const p = m.t === 'num' && m.v.d !== 1n ? 2 : PREC[m.t]; return p < min ? `(${s})` : s; };
  function go(m) {
    switch (m.t) {
      case 'num': return num(m.v);
      case 'var': return sub != null ? sub : v;
      case 'grp': return `(${go(m.a)})`;
      case 'neg': return '−' + wrap(m.a, 4);
      case 'add': return `${wrap(m.a, 1)} + ${wrap(m.b, 2)}`;
      case 'sub': return `${wrap(m.a, 1)} − ${wrap(m.b, 2)}`;
      case 'mul': {
        const a = m.a.t === 'num' && m.a.v.d !== 1n ? `(${go(m.a)})` : wrap(m.a, 2), b = m.b.t === 'neg' ? `(${go(m.b)})` : wrap(m.b, 3);
        if (m.imp && (b.startsWith('(') || /^[a-z]/i.test(b))) return a + b;
        return `${a} · ${b}`;
      }
      case 'div': return `${wrap(m.a, 2)}/${wrap(m.b, 3)}`;
      case 'pow': {
        const e = m.b.t === 'num' && isInt(m.b.v) && sup[m.b.v.n] ? sup[m.b.v.n] : `^${wrap(m.b, 5)}`;
        return wrap(m.a, 5) + e;
      }
      default: return '?';
    }
  }
  /* "2((−3) + 1)" reads better as "2(−3 + 1)" */
  return go(n).replace(/\(\(−([\d/]+)\)(?= [+−·])/g, '(−$1');
}

function surdStr(x) {
  const rad = (c, s) => {
    const r = s === -1 ? 'i' : s < 0 ? `i√${-s}` : `√${s}`;
    return feq(c, ONE) ? r : (s < 0 ? `${c.n}${r}` : `${c.n}${r}`);
  };
  if (fz(x.b)) return fstr(x.a);
  const den = (x.a.d * x.b.d) / gcdB(x.a.d, x.b.d);
  const na = fmul(x.a, F(den)), nb = fmul(x.b, F(den));
  const bodyB = rad(fabs(nb), x.s);
  let top = fz(na) ? (nb.n < 0n ? '−' : '') + bodyB : `${MIN(na.n)} ${nb.n < 0n ? '−' : '+'} ${bodyB}`;
  if (den === 1n) return top;
  if (!fz(na)) top = `(${top})`;
  return `${top}/${den}`;
}
const approx = v => { const r = Number(v.toFixed(4)); return Object.is(r, -0) ? '0' : String(r).replace('-', '−'); };
const surdNum = x => fnum(x.a) + fnum(x.b) * Math.sqrt(Math.abs(x.s)) * 1;

/* D = k²·m with m squarefree; D < 1e15 */
function sqfree(n) {
  let k = 1, m = n;
  for (let p = 2; p <= 100000 && p * p <= m; p++) {
    while (m % (p * p) === 0) { m /= p * p; k *= p; }
  }
  const r = Math.round(Math.sqrt(m));
  if (r > 1 && r * r === m) { k *= r; m = 1; }
  return { k, m };
}
const isqrtNum = n => { let r = Math.round(Math.sqrt(n)); while (r * r > n) r--; while ((r + 1) * (r + 1) <= n) r++; return r; };
const gcdN = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };

const mono = (c, v = 'x', k = 1) => polyStr([...Array(k).fill(ZERO), c], v);

/* ---------- the solver ---------- */
export function solveEquation(text) {
  let P;
  try { P = parseEquation(text); } catch (e) {
    if (e instanceof EqError) return { ok: false, error: e.message, pos: e.pos };
    throw e;
  }
  try { return solveParsed(P); } catch (e) {
    if (e instanceof EqError) return { ok: false, error: e.message, pos: e.pos };
    throw e;
  }
}

function solveParsed({ left, right, v }) {
  const L = toPoly(left), R = toPoly(right);
  const steps = [], check = [];
  const say = (s, eq) => steps.push(eq === undefined ? { say: s } : { say: s, eq });
  const input = `${show(left, null, v)} = ${show(right, null, v)}`;
  const simplified = `${polyStr(L, v)} = ${polyStr(R, v)}`;
  const same = input.replace(/[\s()·]/g, '') === simplified.replace(/[\s()·]/g, '');
  let Pp = psub(L, R);
  const d = Math.max(deg(L), deg(R));
  if (d > 2 && deg(Pp) > 2) throw TOO_HIGH(deg(Pp));

  const base = { ok: true, v, input };
  const finish = (type, answerLines, extra = {}) => ({ ...base, type, steps, answer: { lines: answerLines }, check, ...extra });
  const eqLine = (l, r) => `${l} = ${r}`;
  say('Start with the equation.', input);

  const sub = (X, parenIfNeeded = true) => {
    const t = surdStr(X);
    return parenIfNeeded && /[−\s/]/.test(t) ? `(${t})` : t;
  };
  /* substitute each root back into the ORIGINAL equation, exactly */
  function verify(rootXs) {
    let all = true;
    for (const X of rootXs) {
      const lv = evalAst(left, X), rv = evalAst(right, X);
      const good = seq(lv, rv);
      all = all && good;
      const s = sub(X);
      check.push({ say: `Put ${v} = ${surdStr(X)} into both sides of the original equation.`,
        eq: [`Left: ${show(left, s, v)} = ${surdStr(lv)}`, `Right: ${show(right, s, v)} = ${surdStr(rv)}`] });
      check.push({ say: good ? `Both sides are ${surdStr(lv)}, so ${v} = ${surdStr(X)} works.` : `The sides differ (${surdStr(lv)} and ${surdStr(rv)}), so ${v} = ${surdStr(X)} does NOT work.` });
    }
    return all;
  }

  /* ----- quadratic ----- */
  if (deg(Pp) === 2) {
    const pp = Pp.slice();
    const needMove = !(R.length === 1 && fz(R[0]) && polyStr(L, v) === polyStr(Pp, v) && same);
    if (!same && !needMove) say('Expand the brackets and combine like terms.', simplified);
    if (needMove) say('Move everything to the left side (subtract the right side from both sides) and combine like terms, so the equation equals 0.', eqLine(polyStr(Pp, v), '0'));
    let a = pp[2], b = pp[1] || ZERO, c = pp[0] || ZERO;
    const coefs = () => [a, b, c];
    const show0 = () => eqLine(polyStr([c, b, a], v), '0');
    /* tidy: whole numbers, no common factor, positive x² */
    let m = 1n;
    for (const q of coefs()) m = (m * q.d) / gcdB(m, q.d);
    if (m > 1n) {
      [a, b, c] = coefs().map(q => fmul(q, F(m)));
      say(`Multiply both sides by ${m} to clear the fractions.`, show0());
    }
    let g = gcdB(gcdB(a.n, b.n), c.n);
    if (g > 1n) {
      [a, b, c] = coefs().map(q => fdiv(q, F(g)));
      say(`Every term is divisible by ${g}, so divide both sides by ${g}.`, show0());
    }
    if (a.n < 0n) {
      [a, b, c] = coefs().map(fneg);
      say('Multiply both sides by −1 so the x² term is positive.', show0());
    }
    const A = a.n, B = b.n, C = c.n;
    const disc = B * B - 4n * A * C;
    say(`Read off the coefficients: a = ${MIN(A)}, b = ${MIN(B)}, c = ${MIN(C)}.`);
    const paren = x => (x < 0n ? `(${MIN(x)})` : String(x));
    const lim = 10n ** 15n;
    if (disc > lim || disc < -lim) throw new EqError('The numbers in that equation are too large for me to show exact steps. Try smaller coefficients.');
    say('The discriminant D = b² − 4ac tells which kind of roots there are.',
      `D = ${paren(B)}² − 4 · ${paren(A)} · ${paren(C)} = ${MIN(disc)}`);
    const D = Number(disc);
    const roots = [];
    const sField = D < 0 ? -sqfree(-D).m : (D === 0 ? 1 : sqfree(D).m);
    const X = (aa, bb) => S(aa, bb, sField === 1 || sField === 0 ? 1 : sField);

    if (D === 0) {
      const r = F(-B, 2n * A);
      say('D = 0, so there is exactly one root (a repeated root): x = −b/(2a).', `${v} = −(${MIN(B)})/(2 · ${MIN(A)}) = ${fstr(r)}`);
      roots.push({ X: X(r, ZERO), exact: fstr(r), dec: null });
    } else if (D > 0 && sqfree(D).m === 1) {
      const rt = isqrtNum(D);
      const r1 = F(-B - big(rt), 2n * A), r2 = F(-B + big(rt), 2n * A);
      if (isInt(r1) && isInt(r2)) {
        say(`D = ${D} is a perfect square (${rt}²), so the roots are whole numbers and the quadratic factors. Find two numbers that multiply to c = ${MIN(C)} and add to b = ${MIN(B)}: ${MIN(-r2.n)} and ${MIN(-r1.n)}.`);
        const fac = r => (fz(r) ? v : `(${v} ${r.n < 0n ? '+' : '−'} ${fabs(r).n})`);
        const lo = fsign(fsub(r1, r2)) <= 0 ? r1 : r2, hi = lo === r1 ? r2 : r1;
        say('Write it in factored form.', `${fac(lo)}${fac(hi)} = 0`);
        say('A product is zero only when one of its factors is zero, so set each factor to 0.', `${fz(lo) ? v : `${v} ${lo.n < 0n ? '+' : '−'} ${fabs(lo).n}`} = 0   or   ${fz(hi) ? v : `${v} ${hi.n < 0n ? '+' : '−'} ${fabs(hi).n}`} = 0`);
        roots.push({ X: X(lo, ZERO), exact: fstr(lo) }, { X: X(hi, ZERO), exact: fstr(hi) });
      } else {
        say(`D = ${D} is a perfect square (${rt}²), so the roots are fractions. Use the quadratic formula x = (−b ± √D)/(2a).`,
          `${v} = (${MIN(-B)} ± ${rt})/${2n * A}`);
        const lo = fsign(fsub(r1, r2)) <= 0 ? r1 : r2, hi = lo === r1 ? r2 : r1;
        say('Work out both roots.', [`${v} = (${MIN(-B)} − ${rt})/${2n * A} = ${fstr(r1)}`, `${v} = (${MIN(-B)} + ${rt})/${2n * A} = ${fstr(r2)}`]);
        roots.push({ X: X(lo, ZERO), exact: fstr(lo), dec: isInt(lo) ? null : approx(fnum(lo)) }, { X: X(hi, ZERO), exact: fstr(hi), dec: isInt(hi) ? null : approx(fnum(hi)) });
      }
    } else {
      /* irrational or complex: x = (−b ± √D)/(2a) with √D simplified */
      const neg = D < 0;
      const { k, m: mm } = sqfree(Math.abs(D));
      say(`D = ${MIN(D)} ${neg ? 'is negative, so there are no real roots; the roots are complex numbers (they involve i, where i² = −1)' : 'is not a perfect square, so the roots are irrational'}. Use the quadratic formula.`,
        `${v} = (−b ± √D)/(2a) = (${MIN(-B)} ± √${neg ? `(${MIN(D)})` : D})/${2n * A}`);
      const unit = neg ? (mm === 1 ? 'i' : `i√${mm}`) : `√${mm}`;
      if (k > 1 || neg) {
        say(`Simplify the root: √${neg ? `(${MIN(D)})` : D} = ${k > 1 ? k : ''}${unit}${neg ? ' (because √(−1) = i)' : ''}.`);
      }
      let gg = gcdN(gcdN(Number(-B), k), Number(2n * A));
      const den = Number(2n * A) / gg, u = Number(-B) / gg, kk = k / gg;
      const radical = (kk === 1 ? '' : String(kk)) + unit;
      const formula = u === 0 ? (den === 1 ? `±${radical}` : `±${radical}/${den}`) : (den === 1 ? `${MIN(u)} ± ${radical}` : `(${MIN(u)} ± ${radical})/${den}`);
      say(gg > 1 ? `Divide the top and bottom by ${gg}.` : 'Put it together.', `${v} = ${formula}`);
      const ra = F(big(u), big(den)), rb = F(big(kk), big(den));
      const sv = neg ? -mm : mm;
      const plus = S(ra, rb, sv), minus = S(ra, fneg(rb), sv);
      const cx = sg => {
        const im = approx(fnum(rb) * Math.sqrt(mm)), re = approx(fnum(ra));
        const part = im === '1' ? 'i' : `${im}i`;
        return re === '0' ? `${sg < 0 ? '−' : ''}${part}` : `${re} ${sg < 0 ? '−' : '+'} ${part}`;
      };
      const dp = neg ? cx(1) : approx(surdNum(plus));
      const dm = neg ? cx(-1) : approx(surdNum(minus));
      const hiX = plus, loX = minus;
      roots.push({ X: hiX, exact: surdStr(hiX), dec: dp }, { X: loX, exact: surdStr(loX), dec: dm });
      roots.formula = formula;
    }
    const all = verify(roots.map(r => r.X));
    const lines = roots.length === 1
      ? [`${v} = ${roots[0].exact} (a repeated root)`]
      : roots.formula ? [`${v} = ${roots.formula}`, `${v} ≈ ${roots[0].dec}  or  ${v} ≈ ${roots[1].dec}`]
        : roots.map(r => `${v} = ${r.exact}` + (r.dec ? ` ≈ ${r.dec}` : ''));
    return finish('quadratic', lines, {
      verified: all, discriminant: MIN(disc),
      roots: roots.map(r => ({ exact: r.exact, decimal: r.dec || null })),
    });
  }

  /* ----- linear (or no x at all) ----- */
  const L2 = L[2] || ZERO, R2 = R[2] || ZERO;
  let l1 = L[1] || ZERO, l0 = L[0] || ZERO, r1 = R[1] || ZERO, r0 = R[0] || ZERO;
  if (!fz(L2) || !fz(R2)) {
    say(`The x² terms are the same on both sides, so they cancel (subtract ${mono(L2, v, 2)} from both sides). What is left is a linear equation.`);
  }
  const sideStr = (c1, c0) => polyStr([c0, c1], v);
  if (!same || !fz(L2) || !fz(R2)) say('Expand the brackets and combine like terms on each side.', eqLine(sideStr(l1, l0), sideStr(r1, r0)));
  const hasX = !fz(l1) || !fz(r1);
  if (!hasX) {
    /* no unknown at all: a plain statement about numbers */
    const eqn = feq(l0, r0);
    check.push({ say: `There is no ${v} left, so this is just a statement about numbers: ${fstr(l0)} = ${fstr(r0)} is ${eqn ? 'true' : 'false'}.` });
    return eqn ? finish('all', [`True for every ${v}: infinitely many solutions.`], { verified: true }) : finish('none', ['No solution.'], { verified: true });
  }
  let A = l1, B2 = r0;
  if (!fz(r1)) {
    A = fsub(l1, r1);
    say(`Subtract ${mono(r1, v)} from both sides to collect the ${v} terms on the left (${polyStr([ZERO, l1], v)} − ${polyStr([ZERO, r1], v).replace(/^−/, '(−') + (r1.n < 0n ? ')' : '')} = ${polyStr([ZERO, A], v)}).`,
      eqLine(sideStr(A, l0), fstr(r0)));
  }
  if (fz(A)) {
    const eqn = feq(l0, r0);
    say(`The ${v} terms cancel completely, leaving a statement about numbers only.`, eqLine(fstr(l0), fstr(r0)));
    if (eqn) {
      say(`${fstr(l0)} = ${fstr(r0)} is always true, whatever ${v} is, so every number is a solution.`);
      const xs = [F(0), F(1), F(-3)];
      for (const x of xs) {
        const X = lift(x, 1);
        check.push({ say: `Try ${v} = ${fstr(x)} in the original equation.`, eq: [`Left: ${show(left, /[−\s/]/.test(fstr(x)) ? `(${fstr(x)})` : fstr(x), v)} = ${surdStr(evalAst(left, X))}`, `Right: ${show(right, /[−\s/]/.test(fstr(x)) ? `(${fstr(x)})` : fstr(x), v)} = ${surdStr(evalAst(right, X))}`] });
      }
      check.push({ say: 'The sides agree for every value tried, as they must.' });
      return finish('all', [`Infinitely many solutions: every ${v} works.`], { verified: true });
    }
    say(`${fstr(l0)} = ${fstr(r0)} is never true, whatever ${v} is, so no value of ${v} works.`);
    check.push({ say: `Left minus right is ${fstr(fsub(l0, r0))} for every ${v}; it is never 0, so there is nothing to substitute: the equation has no solution.` });
    return finish('none', ['No solution.'], { verified: true });
  }
  if (!fz(l0)) {
    const rhs = fsub(r0, l0);
    say(`${l0.n > 0n ? 'Subtract' : 'Add'} ${fstr(fabs(l0))} ${l0.n > 0n ? 'from' : 'to'} both sides to collect the numbers on the right (${fstr(r0)} ${l0.n > 0n ? '−' : '+'} ${fstr(fabs(l0))} = ${fstr(rhs)}).`,
      eqLine(polyStr([ZERO, A], v), fstr(rhs)));
    B2 = rhs;
  } else B2 = r0;
  const root = fdiv(B2, A);
  if (!feq(A, ONE)) {
    say(`Divide both sides by ${fstr(A)} to get ${v} on its own.`, eqLine(v, fstr(root)));
  }
  verify([lift(root, 1)]);
  const dec = isInt(root) ? null : approx(fnum(root));
  return finish('linear', [`${v} = ${fstr(root)}${dec ? ` (= ${dec})` : ''}`], { verified: check.every(c => !/does NOT/.test(c.say)), roots: [{ exact: fstr(root), decimal: dec }] });
}

export default { solveEquation, parseEquation, EqError };
