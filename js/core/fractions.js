/* ============================================================
   fractions.js (core) — exact fraction arithmetic that shows its working.

   Every value is a pair of BigInts (numerator over a positive
   denominator), so there is no floating point anywhere: 1/3 + 1/6 is
   exactly 1/2 and 0.1 + 0.2 is exactly 3/10. No DOM, no eval.

   Input a student can type: 3/4   -2/5   5   2 3/4 (a mixed number)
   -1 1/2   0.75 (a decimal, read exactly as 75/100).

     calc('3/4', '+', '5/6')
       -> { ok: true, answer: { n: 19n, d: 12n, text: '19/12', mixed: '1 7/12', decimal: '1.58(3)' },
            steps: [{ say, math }, …] }
     calc('1/2', '/', '0')  -> { ok: false, error: 'Cannot divide by zero: …' }

   Sizes are capped (MAX_DIGITS in a number, MAX_DECIMALS places after
   the point, MAX_INPUT characters) so a pasted wall of digits gives a
   plain message instead of a frozen page; the decimal expansion stops
   after MAX_EXPANSION digits and says so.
   ============================================================ */

export const MAX_DIGITS = 60;
export const MAX_DECIMALS = 30;
export const MAX_INPUT = 200;
export const MAX_EXPANSION = 40;

export class FractionError extends Error {}
const fail = m => { throw new FractionError(m); };

const abs = x => (x < 0n ? -x : x);
export function gcd(a, b) {
  a = abs(a); b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export const lcm = (a, b) => (a === 0n || b === 0n ? 0n : abs(a * b) / gcd(a, b));

/** { n, d } with d > 0 (not reduced). */
export function make(n, d) {
  if (d === 0n) fail('A fraction cannot have 0 as its denominator.');
  return d < 0n ? { n: -n, d: -d } : { n, d };
}
export function reduce(f) {
  const g = gcd(f.n, f.d);
  return g > 1n ? { n: f.n / g, d: f.d / g } : f;
}

/* ---------- reading what was typed ---------- */
/** -> { n, d, kind: 'integer' | 'fraction' | 'mixed' | 'decimal', whole? } or throws FractionError. */
export function parse(input) {
  const raw = String(input == null ? '' : input);
  if (raw.length > MAX_INPUT) fail(`That is too long (more than ${MAX_INPUT} characters).`);
  const s = raw.replace(/[−–]/g, '-').trim();
  if (!s) fail('Type a number, like 3/4, 2 1/2, 5 or 0.75.');
  const longDigits = /\d{61,}/.test(s);
  if (longDigits) fail(`That number has more than ${MAX_DIGITS} digits. Shorten it.`);
  let m;
  if ((m = /^([+-]?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s))) {
    const sign = m[1] === '-' ? -1n : 1n;
    const d = BigInt(m[4]);
    const f = make(sign * (BigInt(m[2]) * d + BigInt(m[3])), d);
    return { ...f, kind: 'mixed', whole: sign * BigInt(m[2]), partN: BigInt(m[3]), partD: d };
  }
  if ((m = /^([+-]?)(\d+)\s*\/\s*(\d+)$/.exec(s))) {
    const f = make((m[1] === '-' ? -1n : 1n) * BigInt(m[2]), BigInt(m[3]));
    return { ...f, kind: 'fraction' };
  }
  if ((m = /^([+-]?)(\d+)$/.exec(s))) return { n: (m[1] === '-' ? -1n : 1n) * BigInt(m[2]), d: 1n, kind: 'integer' };
  if ((m = /^([+-]?)(\d*)\.(\d*)$/.exec(s)) && (m[2] || m[3])) {
    if (m[3].length > MAX_DECIMALS) fail(`Use at most ${MAX_DECIMALS} decimal places.`);
    return { n: (m[1] === '-' ? -1n : 1n) * BigInt((m[2] || '0') + m[3]), d: 10n ** BigInt(m[3].length), kind: 'decimal', places: m[3].length };
  }
  return fail(`“${s.slice(0, 40)}” is not something I can read as a number. Use forms like 3/4, 2 1/2, 5 or 0.75.`);
}

/* ---------- showing it ---------- */
export const frac = f => (f.d === 1n ? String(f.n) : `${f.n}/${f.d}`);
/** 7/3 -> '2 1/3'; -7/3 -> '-2 1/3'; a whole number or a proper fraction is itself. Needs f reduced to be a true mixed number. */
export function mixed(f) {
  const r = reduce(f);
  if (r.d === 1n || abs(r.n) < r.d) return frac(r);
  const w = r.n / r.d;
  const rest = abs(r.n) % r.d;
  return rest === 0n ? String(w) : `${w} ${rest}/${r.d}`;
}
/** The exact decimal: 1/4 -> '0.25', 1/3 -> '0.(3)', 7/12 -> '0.58(3)'. Stops (with …) past MAX_EXPANSION digits. */
export function decimal(f) {
  const r = reduce(f);
  const neg = r.n < 0n;
  let rem = abs(r.n) % r.d;
  const whole = abs(r.n) / r.d;
  const sign = neg ? '-' : '';
  if (rem === 0n) return sign + String(whole);
  const seen = new Map();
  let digits = '';
  while (rem !== 0n && !seen.has(rem) && digits.length < MAX_EXPANSION) {
    seen.set(rem, digits.length);
    rem *= 10n;
    digits += String(rem / r.d);
    rem %= r.d;
  }
  if (rem === 0n) return `${sign}${whole}.${digits}`;
  if (seen.has(rem)) { const at = seen.get(rem); return `${sign}${whole}.${digits.slice(0, at)}(${digits.slice(at)})`; }
  return `${sign}${whole}.${digits}…`;
}
const paren = f => (f.n < 0n ? `(${frac(f)})` : frac(f));

/* ---------- the working ---------- */
const OPS = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide' };
export const OP_SIGN = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/**
 * a op b, exactly, with each step. `a` and `b` are what was typed; op is + - * /.
 * With an empty `b` and op '', the single fraction is simplified.
 */
export function calc(aText, op, bText) {
  try {
    const A = parse(aText);
    const typed = x => String(x).trim();
    const steps = [];
    const say = (s, m) => steps.push({ say: s, math: m || '' });
    /* mixed numbers, decimals and whole numbers each become a plain fraction first */
    const lead = (x, text, label) => {
      if (x.kind === 'mixed') say(`Write ${label} as an improper fraction: ${abs(x.whole)} × ${x.partD} + ${x.partN} = ${abs(x.n)} parts of size 1/${x.partD}.`, `${typed(text)} = ${frac(x)}`);
      else if (x.kind === 'decimal') say(`Write ${label} as a fraction: ${x.places} decimal place${x.places === 1 ? '' : 's'} means over 1${'0'.repeat(x.places)}.`, `${typed(text)} = ${frac(x)}`);
      else if (x.kind === 'integer') say(`A whole number is a fraction over 1, so ${label} is ${x.n}/1.`, `${x.n} = ${x.n}/1`);
    };
    if (!op) {
      if (typed(bText || '')) fail('Choose +, −, × or ÷ to use both numbers.');
      say(`Simplify ${typed(aText)}.`);
      lead(A, aText, 'it');
      finish(A, steps, say);
      return result(A, steps);
    }
    if (!OPS[op]) fail('Choose +, −, × or ÷.');
    const B = parse(bText);
    say(`${OPS[op][0].toUpperCase()}${OPS[op].slice(1)} the two numbers.`, `${typed(aText)} ${OP_SIGN[op]} ${typed(bText)}`);
    lead(A, aText, 'the first number');
    lead(B, bText, 'the second number');
    let raw;
    if (op === '+' || op === '-') {
      const L = lcm(A.d, B.d);
      const na = A.n * (L / A.d), nb = B.n * (L / B.d);
      if (A.d === B.d) say(`The denominators are already the same (${A.d}), so the numerators can be combined directly.`);
      else say(`Find a common denominator: the lowest common multiple of ${A.d} and ${B.d} is ${L}. Multiply the top and bottom of ${frac(A)} by ${L / A.d}, and of ${frac(B)} by ${L / B.d}.`, `lcm(${A.d}, ${B.d}) = ${L}\n${frac(A)} = ${na}/${L}   and   ${frac(B)} = ${nb}/${L}`);
      const total = op === '+' ? na + nb : na - nb;
      say(`${op === '+' ? 'Add' : 'Subtract'} the numerators and keep the denominator ${L}.`, `(${na} ${OP_SIGN[op]} ${nb < 0n ? `(${nb})` : nb}) / ${L} = ${total}/${L}`);
      raw = { n: total, d: L };
    } else if (op === '*') {
      raw = { n: A.n * B.n, d: A.d * B.d };
      say('Multiply the numerators together and the denominators together.', `(${A.n} × ${B.n}) / (${A.d} × ${B.d}) = ${raw.n}/${raw.d}`);
    } else {
      if (B.n === 0n) fail('Cannot divide by zero: the second number is 0, and dividing by 0 has no answer.');
      const flip = make(B.d, B.n);
      say(`Dividing by a fraction is multiplying by its reciprocal: flip ${frac(B)} to ${frac(flip)}.`, `${paren(A)} ÷ ${paren(B)} = ${paren(A)} × ${paren(flip)}`);
      raw = { n: A.n * flip.n, d: A.d * flip.d };
      say('Multiply the numerators together and the denominators together.', `(${A.n} × ${flip.n}) / (${A.d} × ${flip.d}) = ${raw.n}/${raw.d}`);
    }
    finish(raw, steps, say);
    return result(raw, steps);
  } catch (err) {
    if (err instanceof FractionError) return { ok: false, error: err.message };
    throw err;
  }
}

function finish(raw, steps, say) {
  const g = gcd(raw.n, raw.d);
  const r = reduce(raw);
  if (raw.n === 0n) say(`The numerator is 0, so the answer is 0.`, `${frac(raw)} = 0`);
  else if (g > 1n) say(`Simplify: the greatest common divisor of ${abs(raw.n)} and ${raw.d} is ${g}, so divide the top and bottom by ${g}.`, `${raw.n}/${raw.d} = ${r.n}/${r.d}${r.d === 1n ? ` = ${r.n}` : ''}`);
  else say(`Simplify: the greatest common divisor of ${abs(raw.n)} and ${raw.d} is 1, so it is already in lowest terms.`, frac(raw));
  const z = reduce(raw);
  if (z.d !== 1n && abs(z.n) > z.d) say(`The top is bigger than the bottom, so as a mixed number: ${abs(z.n) / z.d} whole${abs(z.n) / z.d === 1n ? '' : 's'} and ${abs(z.n) % z.d}/${z.d} left over.`, `${frac(z)} = ${mixed(z)}`);
}
function result(raw, steps) {
  const r = reduce(raw);
  return { ok: true, answer: { n: r.n, d: r.d, text: frac(r), mixed: mixed(r), decimal: decimal(r) }, steps };
}

export default { parse, calc, gcd, lcm, reduce, frac, mixed, decimal, MAX_DIGITS };
