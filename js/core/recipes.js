/* ============================================================
   recipes.js — the maths and shapes behind the Recipes tab of Static Life.

   An ingredient is one line of plain text, the way you would write it:
   "1/2 cup flour", "1 1/2 tsp salt", "2 eggs", "½ cup milk", "1.5 kg
   potatoes", "2-3 cloves garlic", "salt to taste". The amount at the
   start is read as an exact fraction (whole numbers, fractions, mixed
   numbers, decimals and the ½ ¼ ¾ ⅓ ⅔ ⅛ glyphs), so scaling is exact
   rational arithmetic on whole numbers: 1/2 × 3 is 3/2, written
   "1 1/2", not 1.5000000000000002.

   Showing an amount:
   · cups, spoons, counts and the like show a mixed number when the
     fraction is one cooks measure: halves, thirds, quarters, sixths and
     eighths ("1 1/2 cups", "2/3 cup");
   · anything else (say 5/7) is rounded to the nearest eighth and shown
     with a "~" in front, so it is never passed off as exact;
   · grams, kilos, millilitres and litres show decimals ("1.5 kg");
   · a unit that has a plural follows the amount: more than 1 is "cups",
     1 or less is "cup".
   A line with no amount at the start is left alone.

     parseAmount(line)        -> { lo:{n,d}, hi:{n,d}|null, rest } | null
     scaleLine(line, from, to) -> the line for `to` servings
     fraction(n, d)           reduced { n, d }
     formatAmount({n,d}, unit)
     matches(recipe, query)   every word of the query is somewhere in the recipe
     shoppingList([{ recipe, servings }]) -> [{ text, from }]  same item, same unit: added up
     stepTimes(step)          -> [{ ms, text }]  the durations a step mentions
     toText(recipe) / fromText(text)  plain text out and in
   ============================================================ */

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
export const fraction = (n, d = 1) => {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) throw new RangeError('bad fraction');
  const g = gcd(n, d);
  return d < 0 ? { n: -n / g, d: -d / g } : { n: n / g, d: d / g };
};
const times = (a, b) => fraction(a.n * b.n, a.d * b.d);

const GLYPH = { '½': [1, 2], '⅓': [1, 3], '⅔': [2, 3], '¼': [1, 4], '¾': [3, 4], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8] };
const G = '½⅓⅔¼¾⅛⅜⅝⅞';
/* one amount: "1 1/2", "1½", "3/4", "1.25", "½", "2" */
const AMOUNT = new RegExp(`(\\d+\\s+\\d+/\\d+|\\d+\\s*[${G}]|\\d+/\\d+|\\d*\\.\\d+|\\d+|[${G}])`);
const START = new RegExp(`^\\s*${AMOUNT.source}(?:\\s*[-–]\\s*${AMOUNT.source})?(?![\\d/.])`);

function readOne(t) {
  t = t.trim();
  let m;
  if ((m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t))) return +m[3] ? fraction(+m[1] * +m[3] + +m[2], +m[3]) : null;
  if ((m = new RegExp(`^(\\d+)\\s*([${G}])$`).exec(t))) { const [a, b] = GLYPH[m[2]]; return fraction(+m[1] * b + a, b); }
  if ((m = /^(\d+)\/(\d+)$/.exec(t))) return +m[2] ? fraction(+m[1], +m[2]) : null;
  if (GLYPH[t]) return fraction(...GLYPH[t]);
  if ((m = /^(\d*)\.(\d+)$/.exec(t))) { if (m[2].length > 6) return null; return fraction(Number(m[1] + m[2]), 10 ** m[2].length); }
  if (/^\d+$/.test(t)) return fraction(Number(t), 1);
  return null;
}

export function parseAmount(line) {
  const m = START.exec(String(line));
  if (!m) return null;
  const lo = readOne(m[1]);
  const hi = m[2] ? readOne(m[2]) : null;
  if (!lo || (m[2] && !hi)) return null;
  return { lo, hi, rest: String(line).slice(m[0].length).trim() };
}

/* units: [singular, plural, how amounts are written] */
const UNITS = (() => {
  const u = {};
  const add = (kind, ...forms) => { for (const f of forms) { const [s, p] = f.split('/'); u[s] = { s, p: p || s, kind }; if (p) u[p] = { s, p, kind }; } };
  add('cook', 'cup/cups', 'tbsp', 'tsp', 'tablespoon/tablespoons', 'teaspoon/teaspoons', 'oz', 'ounce/ounces', 'lb/lbs', 'pound/pounds',
    'clove/cloves', 'pinch/pinches', 'dash/dashes', 'can/cans', 'slice/slices', 'piece/pieces', 'stick/sticks', 'bunch/bunches', 'handful/handfuls',
    'pint/pints', 'quart/quarts', 'gallon/gallons', 'package/packages', 'sprig/sprigs', 'stalk/stalks', 'head/heads');
  add('metric', 'g', 'gram/grams', 'kg', 'kilo/kilos', 'ml', 'l', 'liter/liters', 'litre/litres');
  return u;
})();

const EIGHTHS = new Set([1, 2, 3, 4, 6, 8]);
const frac = (n, d) => `${n}/${d}`;
/** An exact amount as text; `approx` says it had to be rounded. */
function show(q, kind) {
  if (kind === 'metric') {
    const v = q.n / q.d;
    const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    return { text: String(r), approx: Math.abs(r - v) > 1e-9 };
  }
  let { n, d } = q;
  let approx = false;
  if (!EIGHTHS.has(d)) {
    const e = fraction(Math.round(n * 8 / d), 8);
    approx = true; n = e.n; d = e.d;
  }
  if (n === 0) return { text: '1/8', approx: true, tiny: true };
  const whole = Math.floor(n / d);
  const rem = n - whole * d;
  const text = rem === 0 ? String(whole) : whole === 0 ? frac(rem, d) : `${whole} ${frac(rem, d)}`;
  return { text, approx };
}

export function formatAmount(q, unitWord = '') {
  const u = UNITS[String(unitWord).toLowerCase()];
  const s = show(q, u ? u.kind : 'cook');
  return (s.approx ? '~' : '') + s.text;
}

/** Scale one ingredient line from `from` servings to `to` servings. */
export function scaleLine(line, from, to) {
  const a = parseAmount(line);
  if (!a || !(from > 0) || !(to > 0)) return String(line);
  const k = fraction(Math.round(to), Math.round(from));
  const first = String(a.rest.split(/\s+/)[0] || '').replace(/[.,;:]+$/, '');
  const unit = UNITS[first.toLowerCase()] || null;
  const lo = times(a.lo, k);
  const hi = a.hi ? times(a.hi, k) : null;
  const top = hi || lo;
  const plural = top.n > top.d;
  let rest = a.rest;
  if (unit) {
    const word = plural ? unit.p : unit.s;
    /* keep the person's own abbreviation or capital letters when the unit has no plural form */
    rest = word === first.toLowerCase() ? rest : word + rest.slice(first.length);
  }
  const text = hi ? `${formatAmount(lo, first)}-${formatAmount(hi, first)}` : formatAmount(lo, first);
  return rest ? `${text} ${rest}` : text;
}

/* ---------------- shapes ---------------------------------------- */
export const MAX_RECIPES = 200;
const lines = v => (Array.isArray(v) ? v : String(v || '').split('\n')).map(s => String(s).trim()).filter(Boolean);

export function normRecipe(r, i = 0) {
  if (!r || typeof r !== 'object') return null;
  const title = String(r.title || '').trim().slice(0, 80);
  if (!title) return null;
  const servings = Math.max(1, Math.min(99, Math.round(Number(r.servings)) || 4));
  const tags = [...new Set(lines(String(Array.isArray(r.tags) ? r.tags.join(',') : r.tags || '').replace(/,/g, '\n')).map(t => t.toLowerCase().slice(0, 24)))].slice(0, 12);
  return {
    id: String(r.id || `r${i}`).slice(0, 40), title, servings, tags,
    ingredients: lines(r.ingredients).map(s => s.slice(0, 140)).slice(0, 80),
    steps: lines(r.steps).map(s => s.slice(0, 600)).slice(0, 80),
    pic: typeof r.pic === 'string' && r.pic.startsWith('/') ? r.pic.slice(0, 300) : '',
  };
}

const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function matches(r, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([r.title, r.tags.join(' '), r.ingredients.join(' '), r.steps.join(' ')].join(' \n '));
  return words.every(w => hay.includes(w));
}

/* ---------------- a shopping list from several recipes -------------
   Each recipe's lines are scaled to the servings asked for, then lines
   for the same thing in the same unit are added up exactly ("1/2 cup
   milk" and "1 cup milk" are "1 1/2 cups milk"). Different units, a
   range ("2-3 cloves") or a line with no amount are kept as they are;
   the same unmeasured line twice ("salt to taste") is listed once.
   -> [{ text, from:[recipe titles] }] in first-seen order */
export function shoppingList(picks) {
  const out = [];
  const byKey = new Map();
  for (const { recipe: r, servings } of picks) {
    const to = servings > 0 ? Math.round(servings) : r.servings;
    const k = fraction(to, r.servings);
    for (const raw of r.ingredients) {
      const line = to !== r.servings ? scaleLine(raw, r.servings, to) : raw;
      const a = parseAmount(raw);
      const first = a ? String(a.rest.split(/\s+/)[0] || '').replace(/[.,;:]+$/, '') : '';
      const unit = a ? UNITS[first.toLowerCase()] || null : null;
      const name = a ? (unit ? a.rest.slice(first.length) : a.rest).trim() : raw.trim();
      const exact = !!a && !a.hi;
      const q = exact ? times(a.lo, k) : null;          /* exact: the amount is never re-read from rounded text */
      const key = exact ? `${unit ? unit.s : ''}|${fold(name)}` : `=${fold(line)}`;
      const hit = byKey.get(key);
      if (hit) {
        if (!hit.from.includes(r.title)) hit.from.push(r.title);
        if (exact) { hit.q = fraction(hit.q.n * q.d + q.n * hit.q.d, hit.q.d * q.d); hit.n++; }
        continue;
      }
      const item = { key, q, unit, name, text: line.trim(), from: [r.title], n: 1 };
      byKey.set(key, item);
      out.push(item);
    }
  }
  return out.map(it => {
    if (!it.q || it.n === 1) return { text: it.text, from: it.from };
    const plural = it.q.n > it.q.d;
    const word = it.unit ? (plural ? it.unit.p : it.unit.s) : '';
    const amt = formatAmount(it.q, word);
    return { text: [amt, word, it.name].filter(Boolean).join(' '), from: it.from };
  });
}

/* ---------------- timers in a step ---------------------------------
   "Simmer for 10 minutes", "bake 1 1/2 hours", "rest 30 sec", "1 hour
   30 minutes", "10-12 min" (the shorter end, so you check early), "half
   an hour", "a minute". -> [{ ms, text }] in the order they appear,
   1 second to 24 hours each. */
const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90 };
const UNIT_MS = { s: 1000, m: 60000, h: 3600000 };
const NUMW = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d*\\.\\d+|\\d+\\s*[${G}]|\\d+|[${G}]|${Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|')})`;
const DUR = new RegExp(`(?<![\\w/.])(?:(half\\s+an?\\s+hour)\\b|(${NUMW})(?:\\s*(?:-|–|to)\\s*(${NUMW}))?\\s*(?:-\\s*)?(seconds?|secs?|minutes?|mins?|hours?|hrs?|hr)\\b)`, 'gi');
function wordNum(t) {
  t = t.trim().toLowerCase();
  if (WORDS[t] !== undefined) return fraction(WORDS[t], 1);
  return readOne(t);
}
export function stepTimes(step) {
  const out = [];
  const s = String(step || '');
  DUR.lastIndex = 0;
  let m;
  while ((m = DUR.exec(s))) {
    let ms;
    const unit = m[1] ? 'hour' : m[4].toLowerCase();
    if (m[1]) ms = 1800000;
    else {
      const q = wordNum(m[2]);
      if (!q) continue;
      ms = Math.round((q.n * UNIT_MS[unit[0] === 's' ? 's' : unit[0] === 'h' ? 'h' : 'm']) / q.d);
    }
    /* "1 hour 30 minutes": the minutes join the hour before them */
    const prev = out[out.length - 1];
    if (prev && prev.unit === 'h' && /^(\s*(and|,)?\s*)$/i.test(s.slice(prev.end, m.index)) && unit[0] === 'm' && !prev.joined) {
      prev.ms += ms; prev.text = s.slice(prev.start, m.index + m[0].length); prev.end = m.index + m[0].length; prev.joined = true;
      continue;
    }
    if (ms >= 1000 && ms <= 86400000) out.push({ ms, text: m[0], start: m.index, end: m.index + m[0].length, unit: unit[0] === 'h' ? 'h' : 'x', range: !!m[3] });
  }
  return out.map(({ ms, text, range }) => ({ ms, text, range }));
}

/* ---------------- recipes as plain text ----------------------------
   Out: the title, "Serves N", "Tags: …", then Ingredients (one per
   line, "- " in front) and Steps (numbered). In: the same shape, or
   most recipes pasted from a page or a note — headings like
   Ingredients / Method / Directions / Instructions, bullets, "1." or
   "Step 1:" numbering, "Serves 4", "Makes 12", "Yield: 6". */
export function toText(r) {
  return [r.title, `Serves ${r.servings}`, r.tags.length ? `Tags: ${r.tags.join(', ')}` : null, '',
    'Ingredients', ...r.ingredients.map(l => `- ${l}`), '',
    'Steps', ...r.steps.map((s, i) => `${i + 1}. ${s}`), ''].filter(x => x !== null).join('\n');
}
const ING_H = /^#*\s*(ingredients?|you(?:'|’)?ll need|shopping)\s*:?$/i;
const STEP_H = /^#*\s*(steps?|method|directions?|instructions?|preparation|how to make it)\s*:?$/i;
const OTHER_H = /^#*\s*(notes?|tips?|equipment)\s*:?$/i;
const BULLET = /^\s*(?:[-*•·▪◦]|\[\s?\]|\(\s?\))\s+/;
const NUMBERED = /^\s*(?:step\s*)?\d{1,2}\s*[.):]\s*/i;
export function fromText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(s => s.replace(/\s+$/, ''));
  const d = { title: '', servings: 4, tags: [], ingredients: [], steps: [] };
  let sect = null, sawHead = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if (!d.title && !ING_H.test(line) && !STEP_H.test(line)) { d.title = line.replace(/^#+\s*/, '').slice(0, 80); continue; }
    if ((m = /^(?:serves|servings?|makes|yield|portions?)\s*:?\s*(\d{1,2})\b/i.exec(line))) { d.servings = Math.max(1, Math.min(99, +m[1])); continue; }
    if ((m = /^tags?\s*:\s*(.+)$/i.exec(line))) { d.tags = m[1].split(',').map(t => t.trim()).filter(Boolean); continue; }
    if (ING_H.test(line)) { sect = 'ing'; sawHead = true; continue; }
    if (STEP_H.test(line)) { sect = 'steps'; sawHead = true; continue; }
    if (OTHER_H.test(line)) { sect = 'steps'; continue; }
    const bullet = BULLET.test(line), numbered = NUMBERED.test(line);
    const body = line.replace(BULLET, '').replace(NUMBERED, '').trim();
    if (!body) continue;
    const to = sect || (numbered ? 'steps' : bullet || parseAmount(body) ? 'ing' : 'steps');
    (to === 'ing' ? d.ingredients : d.steps).push(body);
  }
  if (!d.title) return { ok: false, why: 'There’s no text to read a recipe from.' };
  if (!d.ingredients.length && !d.steps.length) return { ok: false, why: 'Only a title was found: put the ingredients and the steps on the lines after it.' };
  return { ok: true, recipe: d, guessed: !sawHead };
}

/** Two small starters, written for StaticOS. */
export const STARTERS = [
  {
    title: 'Cinnamon oatmeal', servings: 2, tags: ['breakfast', 'quick'],
    ingredients: ['1 cup rolled oats', '2 cups water', '1/2 tsp cinnamon', '1 pinch salt', '1 tbsp honey', '1/2 cup milk'],
    steps: ['Put the oats, water and salt in a small pot.', 'Bring to a gentle boil, then turn the heat down and stir for 5 minutes.', 'Stir in the cinnamon and honey.', 'Spoon into bowls and pour the milk over the top.'],
  },
  {
    title: 'Garlic tomato pasta', servings: 4, tags: ['dinner', 'vegetarian'],
    ingredients: ['8 oz spaghetti', '3 cloves garlic', '2 tbsp olive oil', '1 can diced tomatoes', '1/2 tsp salt', '1/4 tsp black pepper', 'basil leaves, to serve'],
    steps: ['Boil the spaghetti in salted water until tender, then drain.', 'Slice the garlic thinly. Warm the oil in a wide pan and cook the garlic for 1 minute without browning it.', 'Add the tomatoes, salt and pepper. Simmer for 10 minutes.', 'Toss the pasta in the sauce and top with basil.'],
  },
];

export default { parseAmount, scaleLine, formatAmount, fraction, normRecipe, matches, shoppingList, stepTimes, toText, fromText, STARTERS, MAX_RECIPES };
