/* ============================================================
   drills/sciencecore.js — the questions the Science tab asks. Pure: no
   DOM, no storage, no fetching.

   "Groups" here are PubChem's element categories (alkali metals,
   halogens, noble gases…), the ones the Periodic Table colours by, not
   the numbered columns: the tab says so.

   Element facts come only from data/elements.json (PubChem, the same
   file the Periodic Table shows): an element's symbol, name and
   category ("cat"). An element the data gives no category is never
   asked about by category.

   The unit prefixes are the SI ones from the BIPM's SI Brochure
   (9th edition, 2019, table 7: "SI prefixes"), the twelve from tera
   to pico that school science uses. Written here by hand and checked
   against that table: name, symbol, and the power of ten.

   A question is { mode, key, prompt, options: [{ id, label }], answer }
   and a fact's key never changes ("sym:Fe", "cat:Na", "pre:kilo"), so
   the record of it (js/drills/sched.js record) builds up over rounds.
   ============================================================ */
import { factWeight, pickWeighted } from './sched.js';

export const MODES = [
  ['sym', 'Symbol to name', 'Which element has the symbol'],
  ['name', 'Name to symbol', 'What is the symbol for'],
  ['cat', 'Element groups', 'Which group of elements is'],
  ['pre', 'Unit prefixes', ''],
];
export const RANGES = [[20, 'Elements 1 to 20'], [36, '1 to 36'], [54, '1 to 54'], [118, 'All 118']];
export const ROUND_QUESTIONS = 10;
const OPTIONS = 4;

/* SI prefixes, BIPM SI Brochure 9th ed. (2019), table 7 */
export const PREFIXES = [
  { name: 'tera', sym: 'T', pow: 12 }, { name: 'giga', sym: 'G', pow: 9 }, { name: 'mega', sym: 'M', pow: 6 },
  { name: 'kilo', sym: 'k', pow: 3 }, { name: 'hecto', sym: 'h', pow: 2 }, { name: 'deca', sym: 'da', pow: 1 },
  { name: 'deci', sym: 'd', pow: -1 }, { name: 'centi', sym: 'c', pow: -2 }, { name: 'milli', sym: 'm', pow: -3 },
  { name: 'micro', sym: 'µ', pow: -6 }, { name: 'nano', sym: 'n', pow: -9 }, { name: 'pico', sym: 'p', pow: -12 },
];
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const powText = p => `10${String(p).split('').map(c => SUP[c]).join('')}`;
/** what one of the prefix means, written out: "1 000" for kilo, "0.001" for milli */
export function powValue(p) {
  if (p >= 0) return `1${'0'.repeat(p)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `0.${'0'.repeat(-p - 1)}1`;
}

function shuffle(a, rng) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** The elements a mode can ask about, among the first `upTo`. */
export function eligible(elements, mode, upTo) {
  return (elements || []).filter(e => e && e.n <= upTo && e.s && e.name && (mode !== 'cat' || e.cat));
}
/** The groups (categories) the data uses, in the order they first appear. */
export const categories = elements => [...new Set((elements || []).map(e => e.cat).filter(Boolean))];

/** One question. `stats` are this tab's record: facts missed before are likelier. */
export function makeQuestion({ elements, mode, upTo = 20, stats = {}, rng = Math.random, avoidKey }) {
  if (mode === 'pre') {
    const target = pickWeighted(PREFIXES, p => factWeight(stats[`pre:${p.name}`]), rng, avoidKey ? PREFIXES.find(p => `pre:${p.name}` === avoidKey) : undefined);
    const others = shuffle(PREFIXES.filter(p => p !== target), rng).slice(0, OPTIONS - 1);
    const all = shuffle([target, ...others], rng);
    /* three ways round, taken in turn by chance: the prefix's power, the prefix for a power, the prefix for a symbol */
    const way = Math.floor(rng() * 3);
    const key = `pre:${target.name}`;
    if (way === 0) return { mode, key, prompt: `What does the prefix ${target.name}- (${target.sym}) mean?`, options: all.map(p => ({ id: p.name, label: `× ${powText(p.pow)} (${powValue(p.pow)})` })), answer: target.name };
    if (way === 1) return { mode, key, prompt: `Which prefix means × ${powText(target.pow)}?`, options: all.map(p => ({ id: p.name, label: `${p.name}- (${p.sym})` })), answer: target.name };
    return { mode, key, prompt: `Which prefix has the symbol ${target.sym}?`, options: all.map(p => ({ id: p.name, label: `${p.name}-` })), answer: target.name };
  }
  const pool = eligible(elements, mode, upTo);
  if (pool.length < OPTIONS) return null;
  const target = pickWeighted(pool, e => factWeight(stats[`${mode}:${e.s}`]), rng, avoidKey ? pool.find(e => `${mode}:${e.s}` === avoidKey) : undefined);
  const key = `${mode}:${target.s}`;
  if (mode === 'cat') {
    /* the groups the chosen elements belong to, so a round on 1 to 20 never offers the lanthanides */
    const inRange = categories(pool);
    const cats = (inRange.length >= OPTIONS ? inRange : categories(elements)).filter(c => c !== target.cat);
    const opts = shuffle([target.cat, ...shuffle(cats, rng).slice(0, OPTIONS - 1)], rng);
    return { mode, key, sym: target.s, prompt: `Which group of elements does ${target.name} (${target.s}) belong to?`, options: opts.map(c => ({ id: c, label: c })), answer: target.cat };
  }
  /* distractors: neighbours by number first (they look alike), then anything in range */
  const near = shuffle(pool.filter(e => e !== target && Math.abs(e.n - target.n) <= 6), rng).slice(0, 2);
  const rest = shuffle(pool.filter(e => e !== target && !near.includes(e)), rng).slice(0, OPTIONS - 1 - near.length);
  const opts = shuffle([target, ...near, ...rest], rng);
  if (mode === 'sym') return { mode, key, sym: target.s, prompt: `Which element has the symbol ${target.s}?`, options: opts.map(e => ({ id: e.s, label: e.name })), answer: target.s };
  return { mode, key, sym: target.s, prompt: `What is the symbol for ${target.name}?`, options: opts.map(e => ({ id: e.s, label: e.s })), answer: target.s };
}

/** Words for an answer: what was right, and what the wrong pick really is. */
export function explain(q, chosenId, elements) {
  const right = chosenId === q.answer;
  const lines = [];
  if (q.mode === 'pre') {
    const t = PREFIXES.find(p => p.name === q.answer), x = PREFIXES.find(p => p.name === chosenId);
    lines.push(`${right ? 'Yes: ' : ''}${t.name}- (${t.sym}) means × ${powText(t.pow)}, that is ${powValue(t.pow)}.`);
    if (!right && x) lines.push(`${x.name}- (${x.sym}) is × ${powText(x.pow)}.`);
    return { right, lines };
  }
  const by = s => (elements || []).find(e => e.s === s);
  const t = by(q.sym);
  if (q.mode === 'cat') {
    lines.push(right ? `Yes, ${t.name} is in the ${t.cat.toLowerCase()} group.` : `${t.name} is in the ${t.cat.toLowerCase()} group, not ${String(chosenId).toLowerCase()}.`);
    return { right, lines };
  }
  const x = by(chosenId);
  lines.push(right ? `Yes, ${t.s} is ${t.name}, number ${t.n}.` : `${t.s} is ${t.name}, number ${t.n}.`);
  if (!right && x) lines.push(`${x.name} is ${x.s}, number ${x.n}.`);
  return { right, lines };
}

/** The record summed by mode, and the facts missed most, from stats only. */
export function summarize(stats, elements) {
  const modes = {}, weak = [];
  for (const [k, st] of Object.entries(stats || {})) {
    if (!st || !st.n) continue;
    const [mode, id] = k.split(':');
    if (!MODES.some(m => m[0] === mode)) continue;
    (modes[mode] ||= { n: 0, ok: 0 }); modes[mode].n += st.n; modes[mode].ok += st.ok;
    if (st.ok < st.n) {
      const e = mode === 'pre' ? null : (elements || []).find(x => x.s === id);
      const name = mode === 'pre' ? `${id}-` : e ? `${e.name} (${e.s})` : id;
      weak.push({ key: k, mode, name, n: st.n, miss: st.n - st.ok });
    }
  }
  weak.sort((a, b) => b.miss / b.n - a.miss / a.n || b.n - a.n);
  return { modes, weak: weak.slice(0, 8) };
}
