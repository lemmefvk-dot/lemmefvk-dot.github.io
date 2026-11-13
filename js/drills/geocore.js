/* ============================================================
   drills/geocore.js — building geography questions and explaining wrong
   answers. Pure: no DOM, no storage, no fetching.

   The countries come from data/geo.json (see tools/geo/build-geo.mjs
   and the meta block inside it for the list, its sources and licences).
   A country is { iso, name, region, capitals: [{ name, role? }], note? }.
   A country with no capitals (Israel, whose capital is disputed) is
   still asked about by flag and name, never by capital. Where there is
   more than one capital, every one is a right answer.
   ============================================================ */
import { factWeight, pickWeighted } from './sched.js';

export const MODES = [['flag', 'Flag to country', 'Which country has this flag?'], ['cap', 'Country to capital', 'What is the capital of'], ['rev', 'Capital to country', 'Which country has the capital']];
export const REGIONS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania'];
export const ROUND_QUESTIONS = 10;
const OPTIONS = 4;

/** The countries a mode can ask about, in the chosen regions. */
export function eligible(countries, regions, mode) {
  return countries.filter(c => regions.includes(c.region) && (mode === 'flag' || c.capitals.length > 0));
}
export const capitalLabel = c => c.capitals[0].name;
export const labelFor = (mode, c) => (mode === 'cap' ? capitalLabel(c) : c.name);

/** Is `label` a right answer for this country in this mode? */
export function isRight(mode, country, label) {
  return mode === 'cap' ? country.capitals.some(x => x.name === label) : label === country.name;
}

function shuffle(a, rng) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** One question. `stats` is { 'flag:TD': { n, ok } }: countries missed before are likelier targets. */
export function makeQuestion({ countries, similar = [], regions, mode, stats = {}, rng = Math.random, avoidIso }) {
  const pool = eligible(countries, regions, mode);
  if (pool.length < 1) return null;
  const target = pickWeighted(pool, c => factWeight(stats[`${mode}:${c.iso}`]), rng, avoidIso ? pool.find(c => c.iso === avoidIso) : undefined);
  const usable = c => c.iso !== target.iso && (mode === 'flag' || (c.capitals.length > 0 && !c.capitals.some(x => target.capitals.some(t => t.name === x.name))));
  const everyone = countries.filter(usable);
  const taken = new Set([target.iso]);
  const picks = [];
  const take = list => { for (const c of shuffle(list, rng)) { if (picks.length >= OPTIONS - 1) return; if (!taken.has(c.iso) && usable(c)) { taken.add(c.iso); picks.push(c); } } };
  if (mode === 'flag') {
    const look = new Set(similar.filter(g => g.includes(target.iso)).flat());
    take(countries.filter(c => look.has(c.iso)).slice(0, 12));
    picks.splice(2);                        /* at most two look-alikes: the rest must be a fair guess */
    for (const c of picks) taken.add(c.iso);
  }
  take(everyone.filter(c => c.region === target.region));
  take(everyone);
  const options = shuffle([target, ...picks], rng).map(c => ({ iso: c.iso, label: labelFor(mode, c) }));
  return { mode, iso: target.iso, options, answer: labelFor(mode, target) };
}

const rolesLine = c => (c.capitals.length > 1 ? `${c.name} has more than one capital: ${c.capitals.map(x => (x.role ? `${x.name} (${x.role})` : x.name)).join('; ')}. Any of them is a right answer.` : '');
const capRole = c => (c.capitals[0].role && c.capitals.length === 1 ? ` (${c.capitals[0].role})` : '');

/** Words for the answer: what was right, and, if the answer was wrong, what the wrong one actually is. */
export function explain(q, chosenIso, countries, similar = []) {
  const by = Object.fromEntries(countries.map(c => [c.iso, c]));
  const c = by[q.iso], x = by[chosenIso];
  const right = chosenIso === q.iso || (q.mode === 'cap' && x && x.capitals.some(k => c.capitals.some(t => t.name === k.name)));
  const lines = [];
  if (q.mode === 'flag') {
    lines.push(right ? `Yes, this is the flag of ${c.name}.` : `This is the flag of ${c.name}, not ${x.name}. The flag of ${x.name} is shown beside it.`);
    if (!right && similar.some(g => g.includes(c.iso) && g.includes(x.iso))) lines.push(`${c.name} and ${x.name} have flags that are easy to mix up: compare the colours and their order.`);
  } else if (q.mode === 'cap') {
    lines.push(right ? `Yes, ${capitalLabel(c)} is the capital of ${c.name}${capRole(c)}.` : `The capital of ${c.name} is ${capitalLabel(c)}${capRole(c)}.`);
    if (!right && x && x.capitals.length) lines.push(`${capitalLabel(x)} is the capital of ${x.name}.`);
  } else {
    lines.push(right ? `Yes, ${capitalLabel(c)} is the capital of ${c.name}${capRole(c)}.` : `${capitalLabel(c)} is the capital of ${c.name}${capRole(c)}, not ${x.name}.`);
    if (!right && x && x.capitals.length) lines.push(`The capital of ${x.name} is ${capitalLabel(x)}.`);
  }
  if (c.capitals.length > 1 && q.mode !== 'flag') lines.push(rolesLine(c));
  if (c.note && q.mode !== 'flag') lines.push(c.note);
  return { right, lines: lines.filter(Boolean) };
}

/** The record summed by mode and by region, from stats only. */
export function summarize(stats, countries) {
  const by = Object.fromEntries(countries.map(c => [c.iso, c]));
  const modes = {}, regions = {}, weak = [];
  for (const [k, st] of Object.entries(stats)) {
    const [mode, iso] = k.split(':');
    const c = by[iso];
    if (!c || !st.n) continue;
    (modes[mode] ||= { n: 0, ok: 0 }); modes[mode].n += st.n; modes[mode].ok += st.ok;
    (regions[c.region] ||= { n: 0, ok: 0 }); regions[c.region].n += st.n; regions[c.region].ok += st.ok;
    if (st.ok < st.n) weak.push({ mode, iso, name: c.name, n: st.n, miss: st.n - st.ok });
  }
  weak.sort((a, b) => b.miss / b.n - a.miss / a.n || b.n - a.n);
  return { modes, regions, weak: weak.slice(0, 6) };
}
