/* ============================================================
   school/ptprops.js — the element properties the Periodic Table can
   colour by, chart and compare, and what can be worked out from the
   data and nothing else. Pure: no DOM.

   Every value is read from data/elements.json (PubChem). A property an
   element has no value for is "not in the data": never filled in,
   never guessed, never drawn as zero.

   The shell diagram is the electron configuration in the data, with
   the noble-gas core ([Ar] and so on) opened out from that gas's own
   configuration in the same file, counted shell by shell. It is drawn
   only when those counts add up to the atomic number; PubChem marks
   some heavy elements' configurations as predicted or calculated, and
   the diagram says so.
   ============================================================ */

export const PROPS = [
  { id: 'mass', label: 'Atomic mass', unit: 'u' },
  { id: 'en', label: 'Electronegativity', unit: '(Pauling)' },
  { id: 'den', label: 'Density', unit: 'g/cm³', log: true },
  { id: 'mp', label: 'Melting point', unit: 'K' },
  { id: 'bp', label: 'Boiling point', unit: 'K' },
  { id: 'rad', label: 'Atomic radius', unit: 'pm' },
  { id: 'ie', label: 'Ionisation energy', unit: 'eV' },
  { id: 'ea', label: 'Electron affinity', unit: 'eV' },
  { id: 'yr', label: 'Year discovered', unit: '' },
];
/* the one property that is words, not a number */
export const STATES = ['Solid', 'Liquid', 'Gas', 'Expected to be a Solid', 'Expected to be a Gas'];
export const STATE_COLOURS = { Solid: 'hsl(28 70% 52%)', Liquid: 'hsl(205 80% 52%)', Gas: 'hsl(150 55% 45%)', 'Expected to be a Solid': 'hsl(28 35% 62%)', 'Expected to be a Gas': 'hsl(150 25% 62%)' };

export const propOf = id => PROPS.find(p => p.id === id) || null;

/** The number the data has for a property, or undefined. Discovery "Ancient" is not a year. */
export function valueOf(e, id) {
  if (!e) return undefined;
  if (id === 'yr') return /^\d{3,4}$/.test(String(e.yr || '')) ? Number(e.yr) : undefined;
  const v = e[id];
  return Number.isFinite(v) ? v : undefined;
}
const sig = (n, d = 6) => String(Number(n.toPrecision(d)));
/** A value as words, with its unit; "not in the data" when there is none. */
export function valueText(e, id) {
  if (id === 'yr') return e && e.yr === 'Ancient' ? 'known since antiquity' : e && e.yr ? String(e.yr) : 'not in the data';
  if (id === 'std') return e && e.std ? e.std : 'not in the data';
  const v = valueOf(e, id);
  if (v === undefined) return 'not in the data';
  const p = propOf(id);
  return `${sig(v)}${p && p.unit && !p.unit.startsWith('(') ? ` ${p.unit}` : ''}`;
}

/** The range of a property over the elements that have it: { min, max, n, missing } */
export function rangeOf(elements, id) {
  const vs = elements.map(e => valueOf(e, id)).filter(v => v !== undefined);
  const p = propOf(id);
  const pos = p && p.log ? vs.filter(v => v > 0) : vs;
  return { min: Math.min(...pos), max: Math.max(...pos), n: pos.length, missing: elements.length - pos.length };
}
/** Where a value sits in the range, 0 to 1 (on a log scale for density), or undefined. */
export function position(v, r, id) {
  if (v === undefined || !Number.isFinite(r.min) || !Number.isFinite(r.max)) return undefined;
  const p = propOf(id);
  if (p && p.log) { if (v <= 0) return undefined; return r.max === r.min ? 0.5 : (Math.log(v) - Math.log(r.min)) / (Math.log(r.max) - Math.log(r.min)); }
  return r.max === r.min ? 0.5 : (v - r.min) / (r.max - r.min);
}
/* a sequential ramp, pale yellow (low) through teal to deep violet (high) */
const STOPS = [[55, 90, 60], [140, 55, 48], [195, 70, 42], [265, 55, 45]];
export function rampColour(t) {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  const m = k => a[k] + (b[k] - a[k]) * f;
  return `hsl(${m(0).toFixed(0)} ${m(1).toFixed(0)}% ${m(2).toFixed(0)}%)`;
}
export const RAMP_CSS = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(rampColour).join(', ')})`;

/* ---- layout facts: from the element's number, the way the table places it ---- */
/** Period 1–7 (the lanthanides are period 6, the actinides 7). */
export function periodOf(n) {
  if (n <= 2) return 1; if (n <= 10) return 2; if (n <= 18) return 3; if (n <= 36) return 4; if (n <= 54) return 5; if (n <= 86) return 6; return 7;
}
/** Group 1–18, or null for the lanthanides and actinides other than La/Ac's column (they have no group number). */
export function groupOf(n, place) {
  const [r, c] = place(n);
  return r <= 7 ? c : null;
}

/* ---- electron shells ---- */
const ORBITAL = /^(\d)([spdf])(\d{1,2})$/;
/** Electrons per shell from the configuration in the data: { shells: [2, 8, …], predicted, cfg } or null. */
export function shellsOf(e, bySymbol, depth = 0) {
  if (!e || typeof e.cfg !== 'string') return null;
  const orb = orbitals(e.cfg, bySymbol, 0);
  if (!orb) return null;
  const shells = [];
  for (const [n, , c] of orb) shells[n - 1] = (shells[n - 1] || 0) + c;
  for (let i = 0; i < shells.length; i++) shells[i] = shells[i] || 0;
  const total = shells.reduce((a, b) => a + b, 0);
  if (total !== e.n) return null;
  return { shells, predicted: /\((predicted|calculated)\)/i.test(e.cfg), cfg: e.cfg };
}
function orbitals(cfg, bySymbol, depth) {
  let out = [], rest = cfg;
  const m = /^\[(\w+)\]/.exec(cfg);
  if (m) {
    const core = bySymbol[m[1]];
    if (!core || depth > 6) return null;
    const inner = orbitals(core.cfg, bySymbol, depth + 1);
    if (!inner) return null;
    out = inner;
    rest = cfg.slice(m[0].length);
  }
  rest = rest.replace(/\([^)]*\)/g, '').trim();
  for (const t of rest.split(/\s+/).filter(Boolean)) {
    const x = ORBITAL.exec(t);
    if (!x) return null;
    out.push([Number(x[1]), x[2], Number(x[3])]);
  }
  return out;
}
