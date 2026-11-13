/* ============================================================
   chem.js (core) — formula arithmetic for the Periodic Table's
   Formulas tab. No DOM, no network. It only does sums:

     parseFormula(text, table)   a formula -> atom counts (+ charge)
     molarMass(text, table)      the mass of one mole, per element
     balance(text, table)        an equation -> whole-number coefficients

   `table` is makeTable(elements), built from data/elements.json (the
   PubChem atomic masses the Periodic Table already shows). A symbol or
   a mass that file lacks is an error, never a guess.

   Formula syntax: element symbols (Ca, Cl), counts (H2), groups in
   ( ) [ ] { } with counts, hydrates after a dot (CuSO4·5H2O, also
   CuSO4.5H2O or CuSO4*5H2O; the number in front multiplies the part),
   subscript digits (H₂O), and a charge after ^ (Fe^3+, SO4^2-, Ag^+).

   Balancing is exact integer linear algebra: the element-count matrix
   (plus a charge row when ions are used) is reduced with BigInt
   fractions, so there is no rounding anywhere. Its null space is every
   way the species can combine:
     · nothing but zero  -> the species cannot balance
     · one direction     -> the balanced equation, smallest whole numbers
     · several           -> more than one independent reaction; there is
                            no single answer, and it says so
   ============================================================ */

const MAX_COUNT = 9999;
const MAX_ATOMS = 100000;
const MAX_SPECIES = 12;
const SUB = { '₀': 0, '₁': 1, '₂': 2, '₃': 3, '₄': 4, '₅': 5, '₆': 6, '₇': 7, '₈': 8, '₉': 9 };
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };
const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set(Object.values(OPEN));

/** Symbol -> { n, name, mass } from data/elements.json's `elements`. */
export function makeTable(elements) {
  const t = new Map();
  for (const e of Array.isArray(elements) ? elements : []) if (e && e.s) t.set(e.s, { n: e.n, name: e.name, mass: Number.isFinite(e.mass) ? e.mass : null });
  return t;
}

/** Subscripts and superscripts to plain characters; hydrate dots to ·. */
export function normalize(text) {
  let s = String(text == null ? '' : text).normalize('NFC').replace(/\s+/g, '');
  s = s.replace(/[₀-₉]/g, c => String(SUB[c]));
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, run => '^' + [...run].map(c => SUP[c]).join(''));
  s = s.replace(/[•∙⋅*.]/g, '·');
  return s;
}

function splitCharge(s) {
  const i = s.indexOf('^');
  if (i < 0) return { body: s, charge: 0, error: null };
  const tail = s.slice(i + 1);
  let m = /^(\d*)([+-])$/.exec(tail);
  let charge;
  if (m) charge = (m[1] === '' ? 1 : Number(m[1])) * (m[2] === '+' ? 1 : -1);
  else if ((m = /^([+-])(\d+)$/.exec(tail))) charge = Number(m[2]) * (m[1] === '+' ? 1 : -1);
  else return { body: s.slice(0, i), charge: 0, error: `I can’t read the charge “^${tail}”. Write it like ^2+, ^3- or ^+.` };
  if (!charge || Math.abs(charge) > 20) return { body: s.slice(0, i), charge: 0, error: `A charge of ${charge} isn’t something I can use.` };
  return { body: s.slice(0, i), charge, error: null };
}

/**
 * -> { ok, atoms: { Symbol: count }, order: [Symbol…], charge, text }
 *  or { ok: false, error }
 */
export function parseFormula(text, table) {
  const raw = String(text == null ? '' : text);
  const s0 = normalize(raw);
  if (!s0) return { ok: false, error: 'Type a formula, like H2O or Ca(OH)2.' };
  if (s0.length > 200) return { ok: false, error: 'That formula is too long.' };
  const { body, charge, error } = splitCharge(s0);
  if (error) return { ok: false, error };
  if (!body) return { ok: false, error: 'There is a charge but no formula in front of it.' };

  const fail = msg => { throw Object.assign(new Error(msg), { chem: true }); };
  const atoms = Object.create(null);
  const order = [];
  let total = 0;

  const number = (str, i) => {
    let j = i;
    while (j < str.length && str[j] >= '0' && str[j] <= '9') j++;
    if (j === i) return [1, i, false];
    const n = Number(str.slice(i, j));
    if (j - i > 5 || n > MAX_COUNT) fail(`The number ${str.slice(i, j)} is too large.`);
    if (n === 0) fail('A count of 0 isn’t allowed: leave the element out instead.');
    return [n, j, true];
  };
  /* one group sequence: `str` from i until `closer` (or the end); returns [counts, next] */
  const seq = (str, i, closer) => {
    const out = Object.create(null);
    const add = (sym, n) => { if (!(sym in out)) out[sym] = 0; out[sym] += n; };
    while (i < str.length) {
      const c = str[i];
      if (c === closer) return [out, i];
      if (CLOSE.has(c)) fail(`Unexpected “${c}” in “${str}”${closer ? ` (a “${closer}” was expected)` : ''}.`);
      if (OPEN[c]) {
        const [inner, at] = seq(str, i + 1, OPEN[c]);
        if (str[at] !== OPEN[c]) fail(`The “${c}” in “${str}” is never closed.`);
        const [n, next] = number(str, at + 1);
        for (const k in inner) add(k, inner[k] * n);
        i = next;
      } else if (c >= 'A' && c <= 'Z') {
        let sym = c;
        if (str[i + 1] >= 'a' && str[i + 1] <= 'z') sym += str[i + 1];
        if (!table.has(sym)) fail(`“${sym}” isn’t an element symbol (a symbol is a capital letter and at most one small letter, like Ca or Cl).`);
        const [n, next] = number(str, i + sym.length);
        add(sym, n);
        i = next;
      } else if (c >= 'a' && c <= 'z') fail(`“${c}” can’t start an element: symbols begin with a capital letter (Ca, not ca).`);
      else if (c >= '0' && c <= '9') fail(`A number needs an element or a bracket in front of it (“${str.slice(Math.max(0, i - 3), i + 2)}”).`);
      else fail(`I don’t understand “${c}” in “${str}”.`);
    }
    if (closer) return [out, i];
    return [out, i];
  };

  try {
    const parts = body.split('·');
    for (const part of parts) {
      if (!part) fail('There is an empty part around a “·”.');
      const [coef, at] = number(part, 0);
      const [counts, end] = seq(part, at, null);
      if (end < part.length) fail(`I don’t understand “${part.slice(end)}”.`);
      if (!Object.keys(counts).length) fail(`“${part}” has no elements in it.`);
      for (const k in counts) {
        if (!(k in atoms)) { atoms[k] = 0; order.push(k); }
        atoms[k] += counts[k] * coef;
        total += counts[k] * coef;
        if (total > MAX_ATOMS) fail('That formula has too many atoms.');
      }
    }
  } catch (e) {
    if (e && e.chem) return { ok: false, error: e.message };
    throw e;
  }
  return { ok: true, atoms: { ...atoms }, order, charge, text: s0 };
}

/**
 * Molar mass in g/mol, with a row per element.
 * -> { ok, total, rows: [{ sym, name, count, mass, subtotal, percent }], charge, text }
 */
export function molarMass(text, table) {
  const f = parseFormula(text, table);
  if (!f.ok) return f;
  const rows = [];
  let total = 0;
  for (const sym of f.order) {
    const el = table.get(sym);
    if (!el || el.mass === null) return { ok: false, error: `The element data has no atomic mass for ${sym}, so I can’t work this out.` };
    const subtotal = el.mass * f.atoms[sym];
    total += subtotal;
    rows.push({ sym, name: el.name, count: f.atoms[sym], mass: el.mass, subtotal, percent: 0 });
  }
  for (const r of rows) r.percent = (r.subtotal / total) * 100;
  return { ok: true, total, rows, charge: f.charge, text: f.text, atoms: f.atoms };
}

/* ---------- exact rational arithmetic ---------- */
const babs = a => (a < 0n ? -a : a);
const gcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
const fr = (n, d = 1n) => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; };
const fsub = (a, b) => fr(a.n * b.d - b.n * a.d, a.d * b.d);
const fmul = (a, b) => fr(a.n * b.n, a.d * b.d);
const fdiv = (a, b) => fr(a.n * b.d, a.d * b.n);
const fzero = a => a.n === 0n;

/**
 * The null space of an integer matrix (rows x cols) as integer vectors in
 * lowest terms, one per free column. Exact (BigInt fractions).
 */
export function nullSpace(rows, cols) {
  const M = rows.map(r => r.map(v => fr(BigInt(v))));
  const pivots = [];
  let r = 0;
  for (let c = 0; c < cols && r < M.length; c++) {
    let p = -1;
    for (let i = r; i < M.length; i++) if (!fzero(M[i][c])) { p = i; break; }
    if (p < 0) continue;
    [M[r], M[p]] = [M[p], M[r]];
    const inv = M[r][c];
    M[r] = M[r].map(v => fdiv(v, inv));
    for (let i = 0; i < M.length; i++) {
      if (i === r || fzero(M[i][c])) continue;
      const f = M[i][c];
      M[i] = M[i].map((v, j) => fsub(v, fmul(f, M[r][j])));
    }
    pivots.push(c);
    r++;
  }
  const free = [];
  for (let c = 0; c < cols; c++) if (!pivots.includes(c)) free.push(c);
  const basis = free.map(f => {
    const v = Array.from({ length: cols }, () => fr(0n));
    v[f] = fr(1n);
    pivots.forEach((pc, i) => { v[pc] = fr(-M[i][f].n, M[i][f].d); });
    let L = 1n;
    for (const x of v) L = (L * x.d) / gcd(L, x.d);
    const ints = v.map(x => (x.n * L) / x.d);
    let g = 0n;
    for (const x of ints) g = gcd(g, x);
    return ints.map(x => x / (g || 1n));
  });
  return { basis, rank: pivots.length };
}

/* ---------- equations ---------- */
const ARROWS = ['<->', '<=>', '-->', '->', '=>', '→', '⟶', '⇒', '⇌', '↔', '='];

function splitSpecies(side) {
  const out = [];
  let cur = '';
  for (let i = 0; i < side.length; i++) {
    const c = side[i];
    /* a + right after ^ or ^<digits> is a charge, not a separator */
    if (c === '+' && !/\^\d*$/.test(cur.replace(/\s+/g, ''))) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** "H2 + O2 -> H2O" -> { ok, left: [string], right: [string], ignored: [..] } */
export function parseEquation(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return { ok: false, error: 'Type an equation, like H2 + O2 -> H2O.' };
  if (t.length > 400) return { ok: false, error: 'That equation is too long.' };
  let at = -1, arrow = '';
  for (const a of ARROWS) {
    const i = t.indexOf(a);
    if (i >= 0 && (at < 0 || i < at || (i === at && a.length > arrow.length))) { at = i; arrow = a; }
  }
  if (at < 0) return { ok: false, error: 'Put an arrow between the reactants and the products, like H2 + O2 -> H2O.' };
  const sides = [t.slice(0, at), t.slice(at + arrow.length)];
  if (ARROWS.some(a => sides[1].includes(a))) return { ok: false, error: 'There is more than one arrow. Balance one reaction at a time.' };
  const ignored = [];
  const lists = sides.map((s, si) => {
    if (!s.trim()) return null;
    return splitSpecies(s).map(x => {
      let sp = x.trim();
      const m = /^(\d+)\s*(?=[A-Z(\[{])/.exec(sp);
      if (m) { ignored.push(`${m[1]} ${sp.slice(m[0].length)}`); sp = sp.slice(m[0].length); }
      return sp;
    });
  });
  if (!lists[0]) return { ok: false, error: 'There is nothing before the arrow. Put the reactants there.' };
  if (!lists[1]) return { ok: false, error: 'There is nothing after the arrow. Put the products there.' };
  for (const l of lists) if (l.some(x => !x)) return { ok: false, error: 'There is a “+” with no formula next to it.' };
  if (lists[0].length + lists[1].length > MAX_SPECIES) return { ok: false, error: `That’s more than ${MAX_SPECIES} species; split it up.` };
  return { ok: true, left: lists[0], right: lists[1], ignored, arrow };
}

const termText = (coef, f) => (coef === 1 ? '' : String(coef)) + f;
const joinSide = (items, coefs, offset) => items.map((f, i) => termText(coefs[offset + i], f)).join(' + ');

/** Whole numbers a = [..] -> equation text: "2H2 + O2 → 2H2O". */
export function equationText(left, right, coefs) {
  return `${joinSide(left, coefs, 0)} → ${joinSide(right, coefs, left.length)}`;
}

const gcdAll = v => v.reduce((g, x) => gcd(g, x), 0n);

/**
 * Balance an equation.
 *  { ok: false, error }
 *  { ok: true, kind: 'unique', left, right, coefs: [Number], text, checks, ignored }
 *  { ok: true, kind: 'many', left, right, basis: [[Number]], reactions: [text], example: {coefs,text}|null, ... }
 * `checks` is one row per element (and the charge): the count on each side.
 */
export function balance(text, table) {
  const eq = parseEquation(text);
  if (!eq.ok) return eq;
  const species = [...eq.left, ...eq.right];
  const parsed = [];
  for (const sp of species) {
    const f = parseFormula(sp, table);
    if (!f.ok) return { ok: false, error: `“${sp}”: ${f.error}` };
    parsed.push(f);
  }
  const seen = new Map();
  for (let i = 0; i < species.length; i++) {
    const key = parsed[i].text;
    if (seen.has(key)) return { ok: false, error: `${species[i]} appears more than once. List each substance once and I’ll find its coefficient.` };
    seen.set(key, i);
  }
  const syms = [];
  for (const f of parsed) for (const s of f.order) if (!syms.includes(s)) syms.push(s);
  const nl = eq.left.length;
  const sign = i => (i < nl ? 1 : -1);
  const rows = syms.map(s => parsed.map((f, i) => sign(i) * (f.atoms[s] || 0)));
  const hasCharge = parsed.some(f => f.charge !== 0);
  if (hasCharge) rows.push(parsed.map((f, i) => sign(i) * f.charge));

  const onlyLeft = syms.filter(s => !parsed.slice(nl).some(f => f.atoms[s]));
  const onlyRight = syms.filter(s => !parsed.slice(0, nl).some(f => f.atoms[s]));
  if (onlyLeft.length || onlyRight.length) {
    const s = onlyLeft[0] || onlyRight[0];
    const side = onlyLeft.length ? 'reactants' : 'products';
    return { ok: false, error: `${s} is only on the ${side} side, so atoms of it would appear or vanish. An element has to be on both sides to balance.` };
  }

  const { basis } = nullSpace(rows, species.length);
  if (!basis.length) return { ok: false, error: 'This can’t be balanced: no set of whole-number coefficients keeps every element' + (hasCharge ? ' and the charge' : '') + ' the same on both sides. Check the formulas.' };

  const toNum = v => v.map(x => { if (babs(x) > 1000000000n) throw new Error('big'); return Number(x); });
  const base = { left: eq.left, right: eq.right, ignored: eq.ignored };
  const checksFor = coefs => {
    const out = syms.map(s => ({ sym: s, left: sum(parsed.slice(0, nl), coefs, 0, f => f.atoms[s] || 0), right: sum(parsed.slice(nl), coefs, nl, f => f.atoms[s] || 0) }));
    if (hasCharge) out.push({ sym: 'charge', left: sum(parsed.slice(0, nl), coefs, 0, f => f.charge), right: sum(parsed.slice(nl), coefs, nl, f => f.charge) });
    return out;
  };
  function sum(list, coefs, off, pick) { return list.reduce((t, f, i) => t + coefs[off + i] * pick(f), 0); }

  try {
    if (basis.length === 1) {
      let v = basis[0];
      if (v.every(x => x <= 0n)) v = v.map(x => -x);
      if (v.some(x => x === 0n)) {
        const z = species.filter((_, i) => v[i] === 0n);
        return { ok: false, error: `${z.join(', ')} can’t take part: the others balance without ${z.length === 1 ? 'it' : 'them'}. Check that ${z.length === 1 ? 'it belongs' : 'they belong'} in this reaction.` };
      }
      if (v.some(x => x < 0n)) {
        const wrong = species.filter((_, i) => (v[i] < 0n) !== (v[0] < 0n));
        return { ok: false, error: `This can’t be balanced as written. It would work with ${wrong.join(', ')} on the other side of the arrow.` };
      }
      const coefs = toNum(v);
      return { ok: true, kind: 'unique', ...base, coefs, text: equationText(eq.left, eq.right, coefs), checks: checksFor(coefs) };
    }
    /* several independent reactions */
    const nb = basis.map(b => toNum(b));
    const reactions = nb.map(b => {
      const flip = b.find(x => x !== 0) < 0 ? -1 : 1;
      const v = b.map(x => x * flip);
      const L = [], R = [], lc = [], rc = [];
      species.forEach((sp, i) => { if (v[i] === 0) return; const onLeft = (i < nl) === (v[i] > 0); (onLeft ? L : R).push(sp); (onLeft ? lc : rc).push(Math.abs(v[i])); });
      return `${L.map((f, i) => termText(lc[i], f)).join(' + ')} → ${R.map((f, i) => termText(rc[i], f)).join(' + ')}`;
    });
    const example = positiveCombination(basis, species.length);
    let ex = null;
    if (example) { const coefs = toNum(example); ex = { coefs, text: equationText(eq.left, eq.right, coefs), checks: checksFor(coefs) }; }
    return { ok: true, kind: 'many', ...base, count: basis.length, basis: nb, reactions, example: ex };
  } catch (e) {
    if (e && e.message === 'big') return { ok: false, error: 'The coefficients came out too large to be a sensible equation. Check the formulas.' };
    throw e;
  }
}

/** The smallest all-positive combination of the basis found by a bounded search (one of infinitely many), or null. */
function positiveCombination(basis, n) {
  const d = basis.length;
  const R = d <= 3 ? 5 : d === 4 ? 3 : 1;
  const span = 2 * R + 1;
  let best = null, bestSum = Infinity;
  const total = Math.pow(span, d);
  if (total > 30000) return null;
  for (let k = 0; k < total; k++) {
    let q = k;
    const c = [];
    for (let i = 0; i < d; i++) { c.push((q % span) - R); q = Math.floor(q / span); }
    if (c.every(x => x === 0)) continue;
    const v = Array.from({ length: n }, (_, j) => c.reduce((t, ci, i) => t + BigInt(ci) * basis[i][j], 0n));
    if (!v.every(x => x > 0n)) continue;
    const g = gcdAll(v);
    const w = v.map(x => x / g);
    const s = w.reduce((t, x) => t + x, 0n);
    if (s < bestSum) { best = w; bestSum = s; }
  }
  return best;
}

export default { makeTable, normalize, parseFormula, molarMass, nullSpace, parseEquation, equationText, balance };
