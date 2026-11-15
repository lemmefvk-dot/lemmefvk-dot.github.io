/* ============================================================
   drills/mathcore.js — the facts a math drill can ask, and how the
   record of them is summed up. Pure: no DOM, no storage.

   A fact has a key that never changes ("x:7x8", "+:12,5", "-:30,12",
   "/:56,7"), so the same fact is the same row in the record whenever it
   is asked. For times tables the "table" is the first number: 7 × 8 is
   on the 7 table, and 8 × 7 on the 8 table.

   The newer kinds keep the same rule:
     sq:7      7²                 sq:r49     √49
     neg:-3,+,5   −3 + 5          (the sign between them is + − x /)
     pct:25,80    25% of 80
     frac:o1,2,18   1/2 of 18     frac:s6,8   simplify 6/8
     frac:a1,3,1,4  1/3 + 1/4     frac:d3,4,1,6   3/4 − 1/6
   A fraction answer is typed as 3/4 (or a whole number), and only the
   fraction in lowest terms counts as right: 6/8 for 3/4 is explained,
   not counted. Every answer is exact; nothing is rounded.
   ============================================================ */
import { factWeight, accuracy, avgMs, pickWeighted } from './sched.js';

export const OPS = [['x', '×', 'Times tables'], ['+', '+', 'Add'], ['-', '−', 'Subtract'], ['/', '÷', 'Divide'], ['mix', '±', 'Mixed'],
  ['sq', 'x²', 'Squares'], ['neg', '−n', 'Negative numbers'], ['pct', '%', 'Percentages'], ['frac', '½', 'Fractions']];
export const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
export const SYMBOL = { x: '×', '+': '+', '-': '−', '/': '÷' };
export const ROUND_SECONDS = 60;
export const ROUND_QUESTIONS = 10;
/* what each level asks, in words, for the setup card */
export const LEVEL_NOTES = {
  x: 'Easy asks up to × 10, Medium and Hard up to × 12.',
  mix: 'Mixed uses the same level for + − × ÷.',
  sq: 'Easy: squares to 10². Medium: to 15², and square roots. Hard: to 25², and roots to √400.',
  neg: 'Easy: + and − from −10 to 10. Medium: from −20 to 20, and ×. Hard: from −50 to 50, × and ÷.',
  pct: 'Easy: 10%, 25%, 50% and 100%. Medium: every 5%. Hard: any whole percent. Answers are whole numbers.',
  frac: 'Easy: a fraction of a number. Medium: simplify. Hard: add and subtract. Type fractions as 3/4, in lowest terms.',
};

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const MINUS = '−';
const num = n => (n < 0 ? `${MINUS}${-n}` : String(n));
const paren = n => (n < 0 ? `(${num(n)})` : String(n));

/** A fraction in lowest terms, the sign on top: [n, d]. */
export function reduce(n, d) {
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1;
  return [n / g, d / g];
}
export const fracText = (n, d) => (d === 1 ? num(n) : `${num(n)}/${d}`);

/** Every fact of one operation at one level, as [a, b] pairs. For × `tables`
    are the first numbers wanted (1–12). */
export function pairs(op, level, tables) {
  const out = [];
  if (op === 'x') {
    const ts = (tables && tables.length ? tables : range(2, 12)).filter(t => t >= 1 && t <= 12);
    const top = level === 'easy' ? 10 : 12;
    for (const a of ts) for (const b of range(1, top)) out.push([a, b]);
  } else if (op === '+') {
    const [lo, hi] = level === 'easy' ? [1, 10] : level === 'medium' ? [1, 50] : [10, 99];
    for (const a of range(lo, hi)) for (const b of range(lo, hi)) out.push([a, b]);
  } else if (op === '-') {
    const [lo, hi] = level === 'easy' ? [1, 20] : level === 'medium' ? [1, 100] : [20, 200];
    for (const a of range(lo, hi)) for (const b of range(Math.min(lo, 1), a)) if (level !== 'hard' || b >= 10) out.push([a, b]);
  } else if (op === '/') {
    const [dl, dh, ql, qh] = level === 'easy' ? [2, 5, 1, 10] : level === 'medium' ? [2, 10, 1, 12] : [2, 12, 6, 20];
    for (const d of range(dl, dh)) for (const q of range(ql, qh)) out.push([d * q, d]);
  }
  return out;
}

export const keyOf = (op, a, b) => `${op}:${op === 'x' ? `${a}x${b}` : `${a},${b}`}`;
export const answerOf = (op, a, b) => (op === 'x' ? a * b : op === '+' ? a + b : op === '-' ? a - b : a / b);
export const textOf = (op, a, b) => `${a} ${SYMBOL[op]} ${b}`;

/* ---- the newer kinds: every fact as a key, and back ---- */
function moreKeys(op, level) {
  const out = [];
  if (op === 'sq') {
    const top = level === 'easy' ? 10 : level === 'medium' ? 15 : 25;
    for (const n of range(1, top)) out.push(`sq:${n}`);
    if (level !== 'easy') for (const n of range(1, level === 'medium' ? 12 : 20)) out.push(`sq:r${n * n}`);
  } else if (op === 'neg') {
    const lim = level === 'easy' ? 10 : level === 'medium' ? 20 : 50;
    const signs = level === 'easy' ? ['+', '-'] : level === 'medium' ? ['+', '-', 'x'] : ['+', '-', 'x', '/'];
    for (const o of signs) {
      if (o === '/') {
        for (const b of range(-12, 12)) for (const q of range(-12, 12)) if (b && (b < 0 || q < 0) && Math.abs(b * q) <= lim * 3) out.push(`neg:${b * q},/,${b}`);
      } else if (o === 'x') {
        for (const a of range(-12, 12)) for (const b of range(-12, 12)) if (a < 0 || b < 0) out.push(`neg:${a},x,${b}`);
      } else {
        /* at least one negative number in every question, or the answer below zero */
        for (const a of range(-lim, lim)) for (const b of range(-lim, lim)) {
          const v = o === '+' ? a + b : a - b;
          if (a < 0 || b < 0 || v < 0) out.push(`neg:${a},${o},${b}`);
        }
      }
    }
  } else if (op === 'pct') {
    const ps = level === 'easy' ? [10, 25, 50, 100] : level === 'medium' ? range(1, 20).map(i => i * 5) : range(1, 99);
    const ys = level === 'easy' ? range(1, 20).map(i => i * 4) : level === 'medium' ? range(1, 40).map(i => i * 5) : range(2, 400);
    for (const p of ps) for (const y of ys) if ((p * y) % 100 === 0) out.push(`pct:${p},${y}`);
  } else if (op === 'frac') {
    if (level === 'easy') {
      for (const d of range(2, 10)) for (const n of range(1, d - 1)) if (gcd(n, d) === 1) for (const k of range(1, 10)) out.push(`frac:o${n},${d},${d * k}`);
    } else if (level === 'medium') {
      for (const d of range(2, 12)) for (const n of range(1, d - 1)) if (gcd(n, d) === 1) for (const k of range(2, 6)) out.push(`frac:s${n * k},${d * k}`);
    } else {
      for (const b of range(2, 10)) for (const a of range(1, b - 1)) for (const d of range(2, 10)) for (const c of range(1, d - 1)) {
        if (gcd(a, b) !== 1 || gcd(c, d) !== 1) continue;
        out.push(`frac:a${a},${b},${c},${d}`);
        if (a * d > c * b) out.push(`frac:d${a},${b},${c},${d}`);
      }
    }
  }
  return out;
}

/** The question a key stands for: { op, key, text, answer, answerText, kind } or null.
    kind 'int' wants a whole number; 'frac' a fraction in lowest terms (or a whole number). */
export function factOf(key) {
  const k = String(key || '');
  const at = k.indexOf(':');
  if (at < 1) return null;
  const op = k.slice(0, at), rest = k.slice(at + 1);
  const int = (text, answer) => ({ op, key: k, text, answer, answerText: num(answer), kind: 'int' });
  if (op === 'x' || op === '+' || op === '-' || op === '/') {
    const [a, b] = (op === 'x' ? rest.split('x') : rest.split(',')).map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { op, a, b, ...int(textOf(op, a, b), answerOf(op, a, b)) };
  }
  if (op === 'sq') {
    if (rest[0] === 'r') { const n = Number(rest.slice(1)); return Number.isInteger(Math.sqrt(n)) ? int(`√${n}`, Math.sqrt(n)) : null; }
    const n = Number(rest);
    return Number.isInteger(n) ? int(`${n}²`, n * n) : null;
  }
  if (op === 'neg') {
    const [a, o, b] = rest.split(',');
    const x = Number(a), y = Number(b);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !'+-x/'.includes(o) || !o) return null;
    const v = o === '+' ? x + y : o === '-' ? x - y : o === 'x' ? x * y : x / y;
    if (!Number.isInteger(v)) return null;
    return int(`${num(x)} ${o === 'x' ? '×' : o === '/' ? '÷' : o === '-' ? MINUS : '+'} ${paren(y)}`, v);
  }
  if (op === 'pct') {
    const [p, y] = rest.split(',').map(Number);
    return (p * y) % 100 === 0 ? int(`${p}% of ${y}`, (p * y) / 100) : null;
  }
  if (op === 'frac') {
    const t = rest[0], v = rest.slice(1).split(',').map(Number);
    if (v.some(x => !Number.isInteger(x)) || v.slice(1).some(x => x === 0)) return null;
    if (t === 'o') { const [n, d, of] = v; return (n * of) % d === 0 ? int(`${n}/${d} of ${of}`, (n * of) / d) : null; }
    const out = (text, [n, d]) => ({ op, key: k, text, answer: [n, d], answerText: fracText(n, d), kind: 'frac' });
    if (t === 's') { const [n, d] = v; return out(`Simplify ${n}/${d}`, reduce(n, d)); }
    if (t === 'a' || t === 'd') {
      const [a, b, c, d] = v;
      return out(`${a}/${b} ${t === 'a' ? '+' : MINUS} ${c}/${d}`, reduce(t === 'a' ? a * d + c * b : a * d - c * b, b * d));
    }
  }
  return null;
}

/** The pool of questions for a choice: { op, key, a, b }[] ('mix' joins + − × ÷ at the same level). */
export function pool(op, level, tables) {
  if (op === 'sq' || op === 'neg' || op === 'pct' || op === 'frac') return moreKeys(op, level).map(key => ({ op, key }));
  const ops = op === 'mix' ? ['+', '-', 'x', '/'] : [op];
  const out = [];
  for (const o of ops) {
    const useTables = o === 'x' && op === 'mix' ? range(2, level === 'easy' ? 5 : 12) : tables;
    for (const [a, b] of pairs(o, level, useTables)) out.push({ op: o, a, b, key: keyOf(o, a, b) });
  }
  return out;
}

/** The next question: facts that were missed or slow are the likeliest, mastered ones the least. */
export function nextQuestion(items, facts, rng, avoidKey) {
  const avoid = avoidKey ? items.find(q => q.key === avoidKey) : undefined;
  const q = pickWeighted(items, x => factWeight(facts[x.key]), rng, avoid);
  return q ? factOf(q.key) : null;
}

/** What the record says about one times table (every fact on it that was ever asked). */
export function tableSummary(facts, t) {
  let n = 0, ok = 0, ms = 0, nm = 0, tried = 0;
  for (let b = 1; b <= 12; b++) {
    const st = facts[keyOf('x', t, b)];
    if (!st) continue;
    tried++; n += st.n; ok += st.ok; ms += st.ms; nm += st.nm;
  }
  return { table: t, n, ok, tried, accuracy: accuracy({ n, ok }), avgMs: avgMs({ ms, nm }) };
}

/** The same sum for all the facts of one operation. */
export function opSummary(facts, op) {
  let n = 0, ok = 0, ms = 0, nm = 0;
  for (const [k, st] of Object.entries(facts)) {
    if (!k.startsWith(`${op}:`)) continue;
    n += st.n; ok += st.ok; ms += st.ms; nm += st.nm;
  }
  return { op, n, ok, accuracy: accuracy({ n, ok }), avgMs: avgMs({ ms, nm }) };
}

/** The facts that most need work: missed at least once, or slow, worst first. */
export function weakFacts(facts, limit = 6) {
  return Object.entries(facts)
    .filter(([key, st]) => st.n > 0 && (st.ok < st.n || (avgMs(st) || 0) > 6000) && factOf(key))
    .map(([key, st]) => ({ key, st, w: factWeight(st) }))
    .sort((a, b) => b.w - a.w || b.st.n - a.st.n)
    .slice(0, limit)
    .map(x => {
      const f = factOf(x.key);
      return { key: x.key, op: f.op, text: `${f.text} = ${f.answerText}`, n: x.st.n, ok: x.st.ok, avgMs: avgMs(x.st) };
    });
}

/** Read a typed answer as a whole number, or null. */
export function parseAnswer(s) {
  const t = String(s).trim().replace(/^\+/, '').replace(/^[−–]/, '-');
  return /^-?\d{1,6}$/.test(t) ? Number(t) : null;
}
/** Read a typed fraction ("3/4", "-3/4", "2") as [n, d], or null. */
export function parseFraction(s) {
  const t = String(s).trim().replace(/\s+/g, '').replace(/^[−–]/, '-');
  const m = /^(-?\d{1,6})(?:\/(\d{1,6}))?$/.exec(t);
  if (!m) return null;
  const d = m[2] === undefined ? 1 : Number(m[2]);
  return d === 0 ? null : [Number(m[1]), d];
}

/** Check a typed answer against a fact.
    -> { ok, read: false } when it can't be read as an answer at all;
       { ok: true|false, read: true, note? } otherwise. */
export function check(fact, typed) {
  if (fact.kind === 'frac') {
    const f = parseFraction(typed);
    if (!f) return { ok: false, read: false };
    const [n, d] = fact.answer;
    const [rn, rd] = reduce(f[0], f[1]);
    if (rn === n && rd === d) {
      if (f[0] === n && f[1] === d) return { ok: true, read: true };
      return { ok: false, read: true, note: `${fracText(f[0], f[1])} is the same amount, but in lowest terms it is ${fracText(n, d)}.` };
    }
    return { ok: false, read: true };
  }
  const v = parseAnswer(typed);
  if (v == null) return { ok: false, read: false };
  return { ok: v === fact.answer, read: true };
}
