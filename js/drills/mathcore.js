/* ============================================================
   drills/mathcore.js — the facts a math drill can ask, and how the
   record of them is summed up. Pure: no DOM, no storage.

   A fact has a key that never changes ("x:7x8", "+:12,5", "-:30,12",
   "/:56,7"), so the same fact is the same row in the record whenever it
   is asked. For times tables the "table" is the first number: 7 × 8 is
   on the 7 table, and 8 × 7 on the 8 table.
   ============================================================ */
import { factWeight, accuracy, avgMs, pickWeighted } from './sched.js';

export const OPS = [['x', '×', 'Times tables'], ['+', '+', 'Add'], ['-', '−', 'Subtract'], ['/', '÷', 'Divide'], ['mix', '±', 'Mixed']];
export const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
export const SYMBOL = { x: '×', '+': '+', '-': '−', '/': '÷' };
export const ROUND_SECONDS = 60;
export const ROUND_QUESTIONS = 10;

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

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

/** The pool of questions for a choice: { op, key, a, b }[] ('mix' joins + − × ÷ at the same level). */
export function pool(op, level, tables) {
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
  return q ? { ...q, text: textOf(q.op, q.a, q.b), answer: answerOf(q.op, q.a, q.b) } : null;
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
    if (k[0] !== op || k[1] !== ':') continue;
    n += st.n; ok += st.ok; ms += st.ms; nm += st.nm;
  }
  return { op, n, ok, accuracy: accuracy({ n, ok }), avgMs: avgMs({ ms, nm }) };
}

/** The facts that most need work: missed at least once, or slow, worst first. */
export function weakFacts(facts, limit = 6) {
  return Object.entries(facts)
    .filter(([, st]) => st.n > 0 && (st.ok < st.n || (avgMs(st) || 0) > 6000))
    .map(([key, st]) => ({ key, st, w: factWeight(st) }))
    .sort((a, b) => b.w - a.w || b.st.n - a.st.n)
    .slice(0, limit)
    .map(x => {
      const [op, rest] = [x.key[0], x.key.slice(2)];
      const [a, b] = op === 'x' ? rest.split('x').map(Number) : rest.split(',').map(Number);
      return { key: x.key, text: `${a} ${SYMBOL[op]} ${b} = ${answerOf(op, a, b)}`, n: x.st.n, ok: x.st.ok, avgMs: avgMs(x.st) };
    });
}

/** Read a typed answer as a whole number, or null. */
export function parseAnswer(s) {
  const t = String(s).trim().replace(/^\+/, '');
  return /^-?\d{1,6}$/.test(t) ? Number(t) : null;
}
