/* ============================================================
   mathexpr.js — the Calculator's scientific engine.

   A real tokenizer and recursive-descent parser; no eval, no Function.
   Precedence, loosest to tightest:

     + −                       left to right
     × ÷  and implicit ×       2π, 3(4), 2sin(30)
     unary − +                 −2^2 = −4
     ^   ʸ√                    right to left: 2^3^2 = 2^9;  3ʸ√27 = 3
     ! % ²                     postfix:  5!  50%  4²
     numbers, π e Ans, ( … ), name( … ), √x

   A missing ")" at the end is closed for you, as on a handheld.
   Errors are MathError with a plain-English message. Typed on one
   line, x and * multiply (3x4) and ** is a power.

     evaluate('sin(30)', { angle: 'deg' })  -> 0.5
     formatResult(0.1 + 0.2)                -> '0.3'

   exact() works the same grammar in fractions (BigInt over BigInt) for
   the Calculator's fraction answers: exact('1/3 + 1/6') -> { n: 1n, d: 2n }.
   Only a sum that stays rational has one — + − × ÷, %, ², whole-number
   powers, n!, abs, and roots that come out whole (√(4/9) = 2/3). π, e,
   trig, logs and other roots give null: never a fraction that only
   looks right, the way 355/113 looks like π.
   ============================================================ */

export class MathError extends Error {}
const fail = msg => { throw new MathError(msg); };

const FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'ln', 'log', 'sqrt', 'cbrt', 'abs', 'exp']);

/* ---- tokenizer ---- */
function tokenize(src) {
  const out = [];
  const s = String(src).replace(/\s+/g, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      if (s[j] === '.') { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      if (s.slice(i, j) === '.') fail('Misplaced decimal point');
      /* EE: 5E3, 2.5E-4 (capital E only; a lowercase e is Euler's number) */
      if (s[j] === 'E') {
        const m = /^E[+\-−]?[0-9]+/.exec(s.slice(j));
        if (m) j += m[0].length;
        else fail('EE needs an exponent, as in 5E3');
      }
      const text = s.slice(i, j).replace('−', '-');
      if ((text.match(/\./g) || []).length > 1) fail('Too many decimal points');
      out.push({ t: 'num', v: Number(text), text });
      i = j;
      continue;
    }
    if (c === 'π') { out.push({ t: 'const', v: Math.PI, name: 'π' }); i++; continue; }
    /* e is Euler's number, unless it starts a name such as exp */
    if (c === 'e' && !FUNCS.has(/^[a-zA-Z]+/.exec(s.slice(i))[0])) { out.push({ t: 'const', v: Math.E, name: 'e' }); i++; continue; }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const name = s.slice(i, j);
      if (name === 'pi') { out.push({ t: 'const', v: Math.PI, name: 'π' }); i = j; continue; }
      if (name === 'Ans') { out.push({ t: 'ans' }); i = j; continue; }
      if (FUNCS.has(name)) { out.push({ t: 'fn', v: name }); i = j; continue; }
      if (name === 'x') { out.push({ t: 'op', v: '*' }); i = j; continue; }   /* 3x4, as typed on one line */
      /* "2e" / "2sin" run together: split a leading e */
      fail(`I don't know "${name}"`);
    }
    if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
    if (c === '+') { out.push({ t: 'op', v: '+' }); i++; continue; }
    if (c === '-' || c === '−') { out.push({ t: 'op', v: '-' }); i++; continue; }
    if (c === '*' && s[i + 1] === '*') { out.push({ t: 'op', v: '^' }); i += 2; continue; }
    if (c === '×' || c === '*' || c === '·') { out.push({ t: 'op', v: '*' }); i++; continue; }
    if (c === '÷' || c === '/') { out.push({ t: 'op', v: '/' }); i++; continue; }
    if (c === '^') { out.push({ t: 'op', v: '^' }); i++; continue; }
    if (c === '²') { out.push({ t: 'post', v: 'sq' }); i++; continue; }
    if (c === '!') { out.push({ t: 'post', v: '!' }); i++; continue; }
    if (c === '%') { out.push({ t: 'post', v: '%' }); i++; continue; }
    if (c === '√') { out.push({ t: 'sqrt' }); i++; continue; }
    if (c === 'ʸ' && s[i + 1] === '√') { out.push({ t: 'root' }); i += 2; continue; }
    fail(`Unexpected "${c}"`);
  }
  return out;
}

/* ---- the maths ---- */
const D2R = Math.PI / 180;

/** Exact answers where a degree angle lands on a multiple of 90. */
function trigDeg(fn, x) {
  const r = ((x % 360) + 360) % 360;           /* 0 <= r < 360 */
  if (r % 90 === 0) {
    const q = r / 90;                          /* quarter turns: 0 1 2 3 */
    if (fn === 'sin') return [0, 1, 0, -1][q];
    if (fn === 'cos') return [1, 0, -1, 0][q];
    if (q % 2 === 1) fail('tan is undefined at that angle');
    return 0;
  }
  return Math[fn](x * D2R);
}

export function factorial(n) {
  if (!Number.isInteger(n) || n < 0) fail('n! needs a whole number, 0 or more');
  if (n > 170) fail('Overflow: n! is too large above 170');
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

function power(a, b) {
  if (a === 0 && b < 0) fail('Cannot divide by zero');
  if (a === 0 && b === 0) return 1;
  const r = Math.pow(a, b);
  if (Number.isNaN(r)) fail('Domain error: a negative number to a fractional power');
  return r;
}

function callFn(name, x, angle) {
  const deg = angle !== 'rad';
  switch (name) {
    case 'sin': case 'cos': case 'tan':
      if (deg) return trigDeg(name, x);
      if (name === 'tan' && Math.abs(Math.cos(x)) < 1e-15) fail('tan is undefined at that angle');
      return Math[name](x);
    case 'asin': case 'acos':
      if (x < -1 || x > 1) fail(`Domain error: ${name} needs a value from −1 to 1`);
      return Math[name](x) / (deg ? D2R : 1);
    case 'atan': return Math.atan(x) / (deg ? D2R : 1);
    case 'sinh': case 'cosh': case 'tanh': return Math[name](x);
    case 'asinh': return Math.asinh(x);
    case 'acosh': if (x < 1) fail('Domain error: acosh needs 1 or more'); return Math.acosh(x);
    case 'atanh': if (x <= -1 || x >= 1) fail('Domain error: atanh needs a value between −1 and 1'); return Math.atanh(x);
    case 'ln': if (x <= 0) fail('Domain error: ln needs a positive number'); return Math.log(x);
    case 'log': if (x <= 0) fail('Domain error: log needs a positive number'); return Math.log10(x);
    case 'sqrt': if (x < 0) fail('Domain error: √ of a negative number'); return Math.sqrt(x);
    case 'cbrt': return Math.cbrt(x);
    case 'abs': return Math.abs(x);
    case 'exp': return Math.exp(x);
  }
  return fail(`I don't know "${name}"`);
}

/* ---- parser / evaluator in one pass ---- */
export function evaluate(src, { angle = 'deg', ans = 0 } = {}) {
  const toks = tokenize(src);
  if (!toks.length) fail('Nothing to calculate');
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const check = v => { if (!Number.isFinite(v)) fail('Overflow: the result is too large'); return v; };

  const startsOperand = t => t && (t.t === 'num' || t.t === 'const' || t.t === 'ans' || t.t === '(' || t.t === 'fn' || t.t === 'sqrt');

  function expr() {
    let v = term();
    for (let t = peek(); t && t.t === 'op' && (t.v === '+' || t.v === '-'); t = peek()) {
      next();
      const r = term();
      v = check(t.v === '+' ? v + r : v - r);
    }
    return v;
  }
  function term() {
    let v = unary();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) {
        next();
        const r = unary();
        if (t.v === '/' && r === 0) fail('Cannot divide by zero');
        v = check(t.v === '*' ? v * r : v / r);
      } else if (startsOperand(t)) {
        v = check(v * unary());              /* implicit multiplication */
      } else return v;
    }
  }
  function unary() {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) { next(); const v = unary(); return t.v === '-' ? -v : v; }
    return pow();
  }
  function pow() {
    let v = postfix();
    for (let t = peek(); t && (t.t === 'root' || (t.t === 'op' && t.v === '^')); t = peek()) {
      next();
      if (t.t === 'root') {
        const x = postfix();
        if (v === 0) fail('Cannot divide by zero');
        if (x < 0 && Math.abs(v % 2) !== 1) fail('Domain error: even root of a negative number');
        v = check(x < 0 ? -Math.pow(-x, 1 / v) : Math.pow(x, 1 / v));
      } else {
        v = check(power(v, unary()));        /* right side may carry its own sign and ^ */
      }
    }
    return v;
  }
  function postfix() {
    let v = primary();
    for (let t = peek(); t && t.t === 'post'; t = peek()) {
      next();
      v = t.v === '!' ? factorial(v) : t.v === '%' ? v / 100 : check(v * v);
    }
    return v;
  }
  function primary() {
    const t = next();
    if (!t) fail('The expression ends too soon');
    if (t.t === 'num' || t.t === 'const') return t.v;
    if (t.t === 'ans') return ans;
    if (t.t === '(') {
      const v = expr();
      if (peek() && peek().t === ')') next();
      else if (peek()) fail('Mismatched brackets');
      return v;                               /* a missing ")" at the end closes itself */
    }
    if (t.t === 'sqrt') return callFn('sqrt', postfix(), angle);
    if (t.t === 'fn') {
      let arg;
      if (peek() && peek().t === '(') arg = primary();
      else arg = postfix();
      return check(callFn(t.v, arg, angle));
    }
    if (t.t === ')') fail('Mismatched brackets');
    return fail('A number is missing');
  }

  const v = expr();
  if (p < toks.length) fail(toks[p].t === ')' ? 'Mismatched brackets' : 'Something is out of place');
  return check(v);
}

/** 15 significant digits clears float dust (0.1 + 0.2 → 0.3) and keeps real precision. */
export function formatResult(n) {
  if (!Number.isFinite(n)) return 'Error';
  if (n === 0) return '0';
  const a = Math.abs(n);
  const p = Number(n.toPrecision(15));
  if (a >= 1e15 || a < 1e-6) {
    const [m, e] = p.toExponential().split('e');
    return `${m}E${Number(e)}`;
  }
  return String(p);
}

/* ---- exact answers: the same grammar in fractions ----
   A value is { n, d }: BigInts, d > 0, in lowest terms. Anything that
   would leave the rationals (or grow past MAX_EXACT digits) stops the
   walk, and the answer is null. Errors are the float evaluator's to
   report, so here they are null too. */
class NotExact extends Error {}
const inexact = () => { throw new NotExact(); };
const MAX_EXACT = 400;
const bAbs = x => (x < 0n ? -x : x);
const bGcd = (a, b) => { a = bAbs(a); b = bAbs(b); while (b) [a, b] = [b, a % b]; return a; };

function rat(n, d = 1n) {
  if (d === 0n) inexact();
  if (d < 0n) { n = -n; d = -d; }
  const g = bGcd(n, d) || 1n;
  n /= g; d /= g;
  if (String(bAbs(n)).length > MAX_EXACT || String(d).length > MAX_EXACT) inexact();
  return { n, d };
}
const ONE = { n: 1n, d: 1n };
function textRat(text) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+\-−]?)(\d+))?$/.exec(String(text).trim());
  if (!m || !(m[2] || m[3])) inexact();
  const frac = m[3] || '';
  let n = BigInt((m[2] || '0') + frac) * (m[1] === '-' ? -1n : 1n);
  let d = 10n ** BigInt(frac.length);
  const ex = m[5] ? Number(m[5]) * (m[4] && m[4] !== '+' ? -1 : 1) : 0;
  if (Math.abs(ex) > MAX_EXACT) inexact();
  if (ex > 0) n *= 10n ** BigInt(ex); else if (ex < 0) d *= 10n ** BigInt(-ex);
  return rat(n, d);
}
function opRat(a, op, b) {
  if (op === '+') return rat(a.n * b.d + b.n * a.d, a.d * b.d);
  if (op === '-') return rat(a.n * b.d - b.n * a.d, a.d * b.d);
  if (op === '*') return rat(a.n * b.n, a.d * b.d);
  if (op === '/') { if (b.n === 0n) inexact(); return rat(a.n * b.d, a.d * b.n); }
  return inexact();
}
function powRat(a, b) {
  if (b.d !== 1n) inexact();                           /* 2^0.5 is not a fraction */
  const k = b.n;
  if (k === 0n) return ONE;
  if (a.n === 0n) { if (k < 0n) inexact(); return { n: 0n, d: 1n }; }
  const size = Math.max(String(bAbs(a.n)).length, String(a.d).length);
  if (bAbs(k) > 2000n || size * Number(bAbs(k)) > MAX_EXACT + 2) inexact();
  const p = { n: a.n ** bAbs(k), d: a.d ** bAbs(k) };
  return k < 0n ? rat(p.d, p.n) : rat(p.n, p.d);
}
/* the whole k-th root of a whole number, when it has one */
function rootInt(x, k) {
  const neg = x < 0n;
  if (neg && k % 2 === 0) inexact();
  const v = bAbs(x);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) inexact();
  const guess = Math.round(Math.pow(Number(v), 1 / k));
  for (const c of [guess - 1, guess, guess + 1]) {
    if (c < 0) continue;
    const C = BigInt(c);
    if (C ** BigInt(k) === v) return neg ? -C : C;
  }
  return inexact();
}
function rootRat(a, deg) {
  if (deg.d !== 1n || deg.n < 1n || deg.n > 64n) inexact();
  const k = Number(deg.n);
  return rat(rootInt(a.n, k), rootInt(a.d, k));
}

/** The answer as an exact fraction { n, d }, or null when it isn't one (see above). */
export function exact(src, { ans = null } = {}) {
  try {
    const toks = tokenize(src);
    if (!toks.length) return null;
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const startsOperand = t => t && (t.t === 'num' || t.t === 'const' || t.t === 'ans' || t.t === '(' || t.t === 'fn' || t.t === 'sqrt');
    const expr = () => {
      let v = term();
      for (let t = peek(); t && t.t === 'op' && (t.v === '+' || t.v === '-'); t = peek()) { next(); v = opRat(v, t.v, term()); }
      return v;
    };
    const term = () => {
      let v = unary();
      for (;;) {
        const t = peek();
        if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) { next(); v = opRat(v, t.v, unary()); }
        else if (startsOperand(t)) v = opRat(v, '*', unary());
        else return v;
      }
    };
    const unary = () => {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) { next(); const v = unary(); return t.v === '-' ? rat(-v.n, v.d) : v; }
      return pow();
    };
    const pow = () => {
      let v = postfix();
      for (let t = peek(); t && (t.t === 'root' || (t.t === 'op' && t.v === '^')); t = peek()) {
        next();
        v = t.t === 'root' ? rootRat(postfix(), v) : powRat(v, unary());
      }
      return v;
    };
    const postfix = () => {
      let v = primary();
      for (let t = peek(); t && t.t === 'post'; t = peek()) {
        next();
        if (t.v === '%') v = opRat(v, '/', { n: 100n, d: 1n });
        else if (t.v === 'sq') v = opRat(v, '*', v);
        else {
          if (v.d !== 1n || v.n < 0n || v.n > 170n) inexact();
          let f = 1n;
          for (let k = 2n; k <= v.n; k++) f *= k;
          v = rat(f);
        }
      }
      return v;
    };
    const primary = () => {
      const t = next();
      if (!t) inexact();
      if (t.t === 'num') return textRat(t.text);
      if (t.t === 'ans') return ans && typeof ans.n === 'bigint' ? rat(ans.n, ans.d) : inexact();
      if (t.t === '(') {
        const v = expr();
        if (peek() && peek().t === ')') next(); else if (peek()) inexact();
        return v;
      }
      if (t.t === 'sqrt') return rootRat(postfix(), { n: 2n, d: 1n });
      if (t.t === 'fn') {
        const arg = peek() && peek().t === '(' ? primary() : postfix();
        if (t.v === 'abs') return rat(bAbs(arg.n), arg.d);
        if (t.v === 'sqrt') return rootRat(arg, { n: 2n, d: 1n });
        if (t.v === 'cbrt') return rootRat(arg, { n: 3n, d: 1n });
      }
      return inexact();                           /* π, e, trig, logs, exp */
    };
    const v = expr();
    return p < toks.length ? null : v;
  } catch (e) {
    if (e instanceof NotExact || e instanceof MathError) return null;
    throw e;
  }
}

/** An entry as typed ('0.75', '-2', '6.02e+23') as an exact fraction, or null. */
export function exactOf(text) {
  try { return textRat(String(text).replace(/,/g, '')); } catch (e) { if (e instanceof NotExact) return null; throw e; }
}
/** a op b in fractions (op is + - * /); null when either side is null or it would leave the rationals. */
export function exactOp(a, op, b) {
  if (!a || !b) return null;
  try { return opRat(a, op, b); } catch (e) { if (e instanceof NotExact) return null; throw e; }
}
