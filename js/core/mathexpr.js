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
   Errors are MathError with a plain-English message.

     evaluate('sin(30)', { angle: 'deg' })  -> 0.5
     formatResult(0.1 + 0.2)                -> '0.3'
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
      out.push({ t: 'num', v: Number(text) });
      i = j;
      continue;
    }
    if (c === 'π') { out.push({ t: 'const', v: Math.PI, name: 'π' }); i++; continue; }
    if (c === 'e') { out.push({ t: 'const', v: Math.E, name: 'e' }); i++; continue; }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const name = s.slice(i, j);
      if (name === 'pi') { out.push({ t: 'const', v: Math.PI, name: 'π' }); i = j; continue; }
      if (name === 'Ans') { out.push({ t: 'ans' }); i = j; continue; }
      if (FUNCS.has(name)) { out.push({ t: 'fn', v: name }); i = j; continue; }
      /* "2e" / "2sin" run together: split a leading e */
      fail(`I don't know "${name}"`);
    }
    if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
    if (c === '+') { out.push({ t: 'op', v: '+' }); i++; continue; }
    if (c === '-' || c === '−') { out.push({ t: 'op', v: '-' }); i++; continue; }
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
