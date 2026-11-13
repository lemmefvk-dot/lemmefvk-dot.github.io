/* ============================================================
   answers.js — Spotlight's instant answers.

   Whatever is typed into ⌘K is tried against these, in order,
   and the first that fits becomes the answer row at the top of
   the list (Enter copies it):

   1. math     calc() — a recursive-descent parser. Never eval()
               and never Function(): a line that does not parse
               completely gives no answer rather than a wrong one.
               "15% of 80", "2^10", "sqrt(2)*pi", "what is 7*6".
   2. units    convert() — length, weight, temperature, volume,
               speed, data size and time, with the exact factors
               from the definitions of each unit (an inch is
               25.4 mm, a pound 0.45359237 kg, a US gallon
               231 cubic inches …). "5 km to mi", "72 °F in C",
               "how many feet in a mile", "100 Mb to MB", or a
               bare "5 km" (converted to its usual counterpart).
               Time units only convert when asked to — "100 days"
               is just as likely to be a game.
   3. look-ups only from real sources, and only when the line
               asks for one:
                 define <word>        → the Free Dictionary API
                   (api.dictionaryapi.dev, data from Wiktionary)
                 who / what is <x>    → Wikipedia's own API
                 time in <city>       → this browser's time-zone
                   database, plus a short list of everyday names
                   it does not know ("India", "California") —
                   anything else is "not found", never a guess.
               The network ones are fetched once per term and
               cached; a failure says so. Nothing is made up.

   Pure apart from fetch(): no DOM, no store, so the unit tables
   and the parser can be checked straight from Node.
   ============================================================ */

/* ---------- numbers ------------------------------------------------- */
const roundTo = (v, p = 0) => { const f = 10 ** p; return Math.round(v * f) / f; };

/** 12 significant digits: enough for every factor here, and it hides float noise (0.1+0.2). */
const tidy = v => (v === 0 ? 0 : Number(v.toPrecision(12)));

/** For the screen: the reader's own digit grouping, at most 6 decimals. */
export function fmtNum(v) {
  if (!Number.isFinite(v)) return String(v);
  const t = tidy(v);
  const a = Math.abs(t);
  if (a !== 0 && (a >= 1e15 || a < 1e-6)) return t.toExponential(6).replace(/\.?0+e/, 'e');
  return t.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
/** For the clipboard: no grouping, a dot for the decimal point — it pastes anywhere. */
export function plainNum(v) {
  if (!Number.isFinite(v)) return String(v);
  const t = tidy(v);
  const a = Math.abs(t);
  if (a !== 0 && (a >= 1e15 || a < 1e-6)) return t.toExponential(6).replace(/\.?0+e/, 'e');
  return t.toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: false });
}

/* ---------- 1. math ------------------------------------------------- */
const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round,
  floor: Math.floor, ceil: Math.ceil, log: Math.log10, ln: Math.log,
  exp: Math.exp, sign: Math.sign, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS = { pi: Math.PI, tau: Math.PI * 2, e: Math.E };
const FN_RE = new RegExp(`\\b(${Object.keys(FUNCS).join('|')})\\s*\\(`, 'i');

/** "what is 7*6?", "= 7*6", "7*6 =" → "7*6"; the typographic operators become ASCII. */
function mathText(src) {
  return String(src)
    .replace(/^\s*(?:what(?:'s|’s|\s+is)|calculate|calc|compute|solve)\s+/i, '')
    .replace(/^\s*=\s*/, '')
    .replace(/\s*=\s*$/, '')
    .replace(/\s*\?\s*$/, '')
    .replace(/[×✕✖∗]/g, '*')
    .replace(/[÷∕]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\*\*/g, '^')
    .replace(/π/g, 'pi');
}

export function looksMath(s) {
  const t = mathText(s).trim();
  if (t.length < 2) return false;
  if (FN_RE.test(t)) return true;
  if (!/\d/.test(t)) return false;
  return /[+\-*/^%]/.test(t);
}

/**
 * "15% of 80" is the one phrase that is rewritten before parsing —
 * everything else is grammar. Returns null for anything that does not
 * parse completely, so a half-expression never shows a bogus answer.
 */
export function calc(src) {
  const s = mathText(src)
    .replace(/(\d[\d.]*)\s*%\s*of\s+/gi, '($1/100)*')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (!s) return null;
  let i = 0;
  const eat = c => (s[i] === c ? (++i, true) : false);
  const bail = () => { throw new Error('parse'); };

  const primary = () => {
    if (eat('(')) { const v = expr(); if (!eat(')')) bail(); return v; }
    if (/[a-z]/.test(s[i] || '')) {
      const from = i;
      while (i < s.length && /[a-z]/.test(s[i])) i++;
      const name = s.slice(from, i);
      if (eat('(')) {
        if (!Object.prototype.hasOwnProperty.call(FUNCS, name)) bail();
        const args = [expr()];
        while (eat(',')) args.push(expr());
        if (!eat(')')) bail();
        return FUNCS[name](...args);
      }
      if (Object.prototype.hasOwnProperty.call(CONSTS, name)) return CONSTS[name];
      return bail();
    }
    const from = i;
    while (i < s.length && /[\d.]/.test(s[i])) i++;
    if (i === from) bail();
    const n = Number(s.slice(from, i));
    if (!Number.isFinite(n)) bail();
    return n;
  };
  const postfix = () => { let v = primary(); while (eat('%')) v /= 100; return v; };
  /* right-associative, so 2^3^2 is 512 and -2^2 is -4, as everywhere else */
  const power = () => { const b = postfix(); return eat('^') ? b ** unary() : b; };
  const unary = () => (eat('-') ? -unary() : eat('+') ? unary() : power());
  const term = () => {
    let v = unary();
    for (;;) {
      if (eat('*')) v *= unary();
      else if (eat('/')) { const d = unary(); v = d === 0 ? NaN : v / d; }
      else return v;
    }
  };
  const expr = () => {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  };

  try {
    const v = expr();
    if (i !== s.length || !Number.isFinite(v)) return null;
    const r = roundTo(v, 10);
    return Number.isFinite(r) ? r : null;
  } catch (e) { return null; }
}

/* ---------- 2. units ------------------------------------------------ */
export const CATEGORIES = {
  length: 'Length', mass: 'Weight', temperature: 'Temperature', volume: 'Volume',
  speed: 'Speed', data: 'Data size', time: 'Time',
};

/* [category, id, symbol, singular, plural, size in the category's base unit, other names]
   bases: metre · kilogram · kelvin (temperature has its own maths) · litre · m/s · byte · second */
const DEF = [
  /* length — exact by definition: 1 in = 2.54 cm, 1 ft = 12 in, 1 yd = 3 ft, 1 mi = 1760 yd, 1 nmi = 1852 m */
  ['length', 'nm', 'nm', 'nanometre', 'nanometres', 1e-9, ['nanometer', 'nanometers']],
  ['length', 'um', 'µm', 'micrometre', 'micrometres', 1e-6, ['um', 'μm', 'micrometer', 'micrometers', 'micron', 'microns']],
  ['length', 'mm', 'mm', 'millimetre', 'millimetres', 1e-3, ['millimeter', 'millimeters']],
  ['length', 'cm', 'cm', 'centimetre', 'centimetres', 1e-2, ['centimeter', 'centimeters', 'cms']],
  ['length', 'm', 'm', 'metre', 'metres', 1, ['meter', 'meters', 'mtr', 'mtrs']],
  ['length', 'km', 'km', 'kilometre', 'kilometres', 1e3, ['kilometer', 'kilometers', 'kms', 'klick', 'klicks']],
  ['length', 'in', 'in', 'inch', 'inches', 0.0254, ['inchs', '″', '"']],
  ['length', 'ft', 'ft', 'foot', 'feet', 0.3048, ['foots', '′', "'"]],
  ['length', 'yd', 'yd', 'yard', 'yards', 0.9144, ['yds']],
  ['length', 'mi', 'mi', 'mile', 'miles', 1609.344, []],
  ['length', 'nmi', 'nmi', 'nautical mile', 'nautical miles', 1852, []],
  ['length', 'au', 'au', 'astronomical unit', 'astronomical units', 149597870700, []],
  ['length', 'ly', 'ly', 'light-year', 'light-years', 9460730472580800, ['light year', 'light years', 'lightyear', 'lightyears']],

  /* mass — 1 lb = 0.45359237 kg exactly; 1 oz = 1/16 lb; 1 st = 14 lb; US ton = 2000 lb; long ton = 2240 lb */
  ['mass', 'ug', 'µg', 'microgram', 'micrograms', 1e-9, ['ug', 'μg', 'mcg']],
  ['mass', 'mg', 'mg', 'milligram', 'milligrams', 1e-6, ['milligramme', 'milligrammes']],
  ['mass', 'g', 'g', 'gram', 'grams', 1e-3, ['gramme', 'grammes', 'gm', 'gms', 'grm']],
  ['mass', 'kg', 'kg', 'kilogram', 'kilograms', 1, ['kilogramme', 'kilogrammes', 'kgs', 'kilo', 'kilos']],
  ['mass', 't', 't', 'tonne', 'tonnes', 1e3, ['metric ton', 'metric tons', 'metric tonne', 'metric tonnes']],
  ['mass', 'oz', 'oz', 'ounce', 'ounces', 0.028349523125, ['ozs']],
  ['mass', 'lb', 'lb', 'pound', 'pounds', 0.45359237, ['lbs', 'lbm']],
  ['mass', 'st', 'st', 'stone', 'stone', 6.35029318, ['stones']],
  ['mass', 'ton', 'US ton', 'US ton', 'US tons', 907.18474, ['ton', 'tons', 'short ton', 'short tons', 'us ton', 'us tons']],
  ['mass', 'longton', 'long ton', 'long ton', 'long tons', 1016.0469088, ['long ton', 'long tons', 'imperial ton', 'imperial tons', 'uk ton', 'uk tons']],

  /* temperature — offsets, see TEMP below */
  ['temperature', 'C', '°C', 'degree Celsius', 'degrees Celsius', null, ['c', 'celsius', 'centigrade', 'degc']],
  ['temperature', 'F', '°F', 'degree Fahrenheit', 'degrees Fahrenheit', null, ['f', 'fahrenheit', 'farenheit', 'fahrenheight', 'degf']],
  ['temperature', 'K', 'K', 'kelvin', 'kelvin', null, ['k', 'kelvin', 'kelvins']],

  /* volume — US customary by definition: gallon = 231 in³; cup = ½ pint; imperial gallon = 4.54609 L */
  ['volume', 'ml', 'mL', 'millilitre', 'millilitres', 1e-3, ['ml', 'milliliter', 'milliliters', 'cc', 'cm3', 'cm³', 'cubic centimetre', 'cubic centimetres', 'cubic centimeter', 'cubic centimeters']],
  ['volume', 'cl', 'cL', 'centilitre', 'centilitres', 1e-2, ['cl', 'centiliter', 'centiliters']],
  ['volume', 'dl', 'dL', 'decilitre', 'decilitres', 1e-1, ['dl', 'deciliter', 'deciliters']],
  ['volume', 'l', 'L', 'litre', 'litres', 1, ['l', 'liter', 'liters', 'ltr', 'ltrs']],
  ['volume', 'm3', 'm³', 'cubic metre', 'cubic metres', 1e3, ['m3', 'cubic meter', 'cubic meters']],
  ['volume', 'tsp', 'tsp', 'US teaspoon', 'US teaspoons', 0.00492892159375, ['teaspoon', 'teaspoons', 'tsps']],
  ['volume', 'tbsp', 'tbsp', 'US tablespoon', 'US tablespoons', 0.01478676478125, ['tablespoon', 'tablespoons', 'tbsps', 'tbs']],
  ['volume', 'floz', 'fl oz', 'US fluid ounce', 'US fluid ounces', 0.0295735295625, ['floz', 'fl oz', 'fl. oz', 'fl.oz', 'fluid ounce', 'fluid ounces']],
  ['volume', 'cup', 'cup', 'US cup', 'US cups', 0.2365882365, ['cups', 'us cup', 'us cups']],
  ['volume', 'pt', 'pt', 'US pint', 'US pints', 0.473176473, ['pint', 'pints', 'pts', 'us pint', 'us pints']],
  ['volume', 'qt', 'qt', 'US quart', 'US quarts', 0.946352946, ['quart', 'quarts', 'qts', 'us quart', 'us quarts']],
  ['volume', 'gal', 'gal', 'US gallon', 'US gallons', 3.785411784, ['gallon', 'gallons', 'gals', 'us gal', 'us gallon', 'us gallons']],
  ['volume', 'imppt', 'imp pt', 'imperial pint', 'imperial pints', 0.56826125, ['imperial pint', 'imperial pints', 'uk pint', 'uk pints', 'imp pt']],
  ['volume', 'impgal', 'imp gal', 'imperial gallon', 'imperial gallons', 4.54609, ['imperial gallon', 'imperial gallons', 'uk gallon', 'uk gallons', 'imp gal']],

  /* speed */
  ['speed', 'mps', 'm/s', 'metre per second', 'metres per second', 1, ['mps', 'meter per second', 'meters per second', 'metres per second', 'm/sec']],
  ['speed', 'kmh', 'km/h', 'kilometre per hour', 'kilometres per hour', 1 / 3.6, ['kmh', 'kph', 'kmph', 'km/hr', 'kilometer per hour', 'kilometers per hour', 'kilometres per hour', 'km per hour']],
  ['speed', 'mph', 'mph', 'mile per hour', 'miles per hour', 0.44704, ['mi/h', 'mi/hr', 'miles per hour', 'mile per hour']],
  ['speed', 'kn', 'kn', 'knot', 'knots', 1852 / 3600, ['kt', 'kts', 'knot', 'knots']],
  ['speed', 'fps', 'ft/s', 'foot per second', 'feet per second', 0.3048, ['fps', 'ft/sec', 'feet per second', 'foot per second']],

  /* data — SI prefixes are powers of 1000, the -bi- ones powers of 1024 */
  ['data', 'bit', 'bit', 'bit', 'bits', 1 / 8, ['bits']],
  ['data', 'B', 'B', 'byte', 'bytes', 1, ['byte', 'bytes']],
  ['data', 'kB', 'kB', 'kilobyte', 'kilobytes', 1e3, ['kb', 'kilobyte', 'kilobytes', 'kbyte', 'kbytes']],
  ['data', 'MB', 'MB', 'megabyte', 'megabytes', 1e6, ['mb', 'megabyte', 'megabytes', 'mbyte', 'mbytes', 'megs']],
  ['data', 'GB', 'GB', 'gigabyte', 'gigabytes', 1e9, ['gb', 'gigabyte', 'gigabytes', 'gbyte', 'gbytes', 'gigs']],
  ['data', 'TB', 'TB', 'terabyte', 'terabytes', 1e12, ['tb', 'terabyte', 'terabytes']],
  ['data', 'PB', 'PB', 'petabyte', 'petabytes', 1e15, ['pb', 'petabyte', 'petabytes']],
  ['data', 'KiB', 'KiB', 'kibibyte', 'kibibytes', 1024, ['kib', 'kibibyte', 'kibibytes']],
  ['data', 'MiB', 'MiB', 'mebibyte', 'mebibytes', 1024 ** 2, ['mib', 'mebibyte', 'mebibytes']],
  ['data', 'GiB', 'GiB', 'gibibyte', 'gibibytes', 1024 ** 3, ['gib', 'gibibyte', 'gibibytes']],
  ['data', 'TiB', 'TiB', 'tebibyte', 'tebibytes', 1024 ** 4, ['tib', 'tebibyte', 'tebibytes']],
  ['data', 'kbit', 'kbit', 'kilobit', 'kilobits', 1e3 / 8, ['kbit', 'kbits', 'kilobit', 'kilobits']],
  ['data', 'Mbit', 'Mbit', 'megabit', 'megabits', 1e6 / 8, ['mbit', 'mbits', 'megabit', 'megabits']],
  ['data', 'Gbit', 'Gbit', 'gigabit', 'gigabits', 1e9 / 8, ['gbit', 'gbits', 'gigabit', 'gigabits']],
  ['data', 'Tbit', 'Tbit', 'terabit', 'terabits', 1e12 / 8, ['tbit', 'tbits', 'terabit', 'terabits']],

  /* time — a year is a Julian year of 365.25 days (as Static Convert counts it), a month a twelfth of that */
  ['time', 'ms', 'ms', 'millisecond', 'milliseconds', 1e-3, ['msec', 'msecs', 'millisec', 'millisecs']],
  ['time', 's', 's', 'second', 'seconds', 1, ['sec', 'secs']],
  ['time', 'min', 'min', 'minute', 'minutes', 60, ['mins']],
  ['time', 'h', 'h', 'hour', 'hours', 3600, ['hr', 'hrs']],
  ['time', 'd', 'd', 'day', 'days', 86400, []],
  ['time', 'wk', 'wk', 'week', 'weeks', 604800, ['wks']],
  ['time', 'mo', 'mo', 'month', 'months', 86400 * 365.25 / 12, ['mos', 'mth', 'mths']],
  ['time', 'yr', 'yr', 'year', 'years', 86400 * 365.25, ['yrs', 'y']],
];

const NOTES = {
  mo: 'A month here is a twelfth of a 365.25-day year.',
  yr: 'A year here is 365.25 days (a Julian year).',
  ton: 'A US (short) ton is 2,000 lb.',
  longton: 'A long (imperial) ton is 2,240 lb.',
};

/* The same unit's symbol in Static Convert (js/apps/convert.js), where it differs —
   null where that app doesn't have the unit, so "Open in Static Convert" isn't offered. */
const IN_CONVERT = {
  ton: 'ton', imppt: 'pt-uk', impgal: 'gal-uk',
  au: null, ly: null, longton: null, cl: null, dl: null, mo: null,
  kbit: null, Mbit: null, Gbit: null, Tbit: null,
};

export const UNITS = DEF.map(([cat, id, sym, one, many, f, names]) => ({
  cat, id, sym, one, many, f, names, note: NOTES[id] || null,
  cv: Object.prototype.hasOwnProperty.call(IN_CONVERT, id) ? IN_CONVERT[id] : sym,
}));
const BY_ID = new Map(UNITS.map(u => [u.id, u]));

/* Case matters for exactly these: b is a bit and B a byte, Mb a megabit and MB a megabyte. */
const EXACT = new Map([
  ['b', 'bit'], ['B', 'B'], ['Kb', 'kbit'], ['kb', 'kB'], ['Mb', 'Mbit'], ['Gb', 'Gbit'], ['Tb', 'Tbit'],
  ['KB', 'kB'], ['MB', 'MB'], ['GB', 'GB'], ['TB', 'TB'], ['PB', 'PB'],
]);
const ALIAS = new Map();
for (const u of UNITS) {
  for (const n of [u.id, u.sym, u.one, u.many, ...u.names]) {
    const k = String(n).toLowerCase();
    if (!ALIAS.has(k)) ALIAS.set(k, u);
  }
}

/** The usual counterpart for "5 km" typed on its own. Time has none on purpose. */
const DEFAULT_TO = {
  mm: 'in', cm: 'in', m: 'ft', km: 'mi', in: 'cm', ft: 'm', yd: 'm', mi: 'km', nmi: 'km',
  g: 'oz', kg: 'lb', oz: 'g', lb: 'kg', st: 'kg', t: 'ton', ton: 't', longton: 't', mg: 'g',
  C: 'F', F: 'C', K: 'C',
  ml: 'floz', l: 'gal', gal: 'l', impgal: 'l', floz: 'ml', cup: 'ml', pt: 'ml', imppt: 'ml', qt: 'l', tsp: 'ml', tbsp: 'ml',
  kmh: 'mph', mph: 'kmh', mps: 'kmh', kn: 'kmh', fps: 'mps',
  kB: 'KiB', MB: 'MiB', GB: 'GiB', TB: 'TiB', KiB: 'kB', MiB: 'MB', GiB: 'GB', TiB: 'TB',
  kbit: 'kB', Mbit: 'MB', Gbit: 'GB', Tbit: 'TB',
};

/** "km", "Kilometres", "°F", "degrees c", "fl oz" → the unit, or null. */
export function unitOf(raw) {
  const t = String(raw ?? '').trim().replace(/\.$/, '');
  if (!t) return null;
  if (EXACT.has(t)) return BY_ID.get(EXACT.get(t)) || null;
  let l = t.toLowerCase().replace(/\s+/g, ' ');
  l = l.replace(/^(?:degrees?|deg)\s*/, '').replace(/^[°º]\s*/, '').trim();
  if (!l) return null;
  return ALIAS.get(l) || null;
}

const TEMP = {
  C: { toK: v => v + 273.15, fromK: k => k - 273.15 },
  F: { toK: v => (v - 32) * 5 / 9 + 273.15, fromK: k => (k - 273.15) * 9 / 5 + 32 },
  K: { toK: v => v, fromK: k => k },
};

/** Pure conversion: amount in unit `from` → unit `to` (same category), or NaN. */
export function convertValue(amount, from, to) {
  const a = typeof from === 'string' ? BY_ID.get(from) : from;
  const b = typeof to === 'string' ? BY_ID.get(to) : to;
  if (!a || !b || a.cat !== b.cat || !Number.isFinite(amount)) return NaN;
  if (a.cat === 'temperature') return TEMP[b.id].fromK(TEMP[a.id].toK(amount));
  return amount * a.f / b.f;
}

/** "1,000" and "2.5" and "1e3"; a lone comma is a decimal comma ("1,5"). */
function parseAmount(s) {
  const t = String(s).trim();
  if (/^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^[-+]?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  if (/,/.test(t)) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const AMOUNT = '([-+]?(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)(?:e[-+]?\\d+)?)';
const ASK = '(?:convert\\s+|what(?:\'s|’s|\\s+is|\\s+are)\\s+)?';
const SEP = '(?:\\s+(?:to|in|into|as)\\s+|\\s*(?:->|→|=>|⇒|=)\\s*)';
const CONVERT_RE = new RegExp(`^${ASK}${AMOUNT}\\s*(.+?)${SEP}(.+?)\\s*\\??$`, 'i');
const BARE_RE = new RegExp(`^${AMOUNT}\\s*([^\\d\\s].*?)\\s*$`, 'i');
const HOWMANY_RE = new RegExp(`^how\\s+many\\s+(.+?)\\s+(?:are\\s+|is\\s+)?(?:there\\s+)?in\\s+(?:(a|an|one|${AMOUNT.slice(1, -1)})\\s*)?(.+?)\\s*\\??$`, 'i');

const unitName = (u, v) => (Math.abs(v) === 1 ? u.one : u.many);

function result(amount, from, to) {
  const value = convertValue(amount, from, to);
  if (!Number.isFinite(value)) return null;
  const belowZero = from.cat === 'temperature' && TEMP[from.id].toK(amount) < 0;
  const note = belowZero ? 'That is below absolute zero, which no temperature can be.' : (to.note || from.note || null);
  return {
    kind: 'convert',
    cat: from.cat, category: CATEGORIES[from.cat],
    amount, value, from, to,
    title: `${fmtNum(value)} ${to.sym}`,
    detail: `${fmtNum(amount)} ${unitName(from, amount)} = ${fmtNum(value)} ${unitName(to, value)}`,
    copy: `${plainNum(value)} ${to.sym}`,
    number: plainNum(value),
    swap: `${plainNum(amount)} ${to.sym} to ${from.sym}`,
    note,
    /* what Static Convert needs to open at this conversion, when it has both units */
    app: from.cv && to.cv ? { cat: from.cat, from: from.cv, to: to.cv, value: plainNum(amount) } : null,
  };
}

/**
 * convert("5 km to mi") → { kind:'convert', title:'3.106856 mi', detail, copy, number, swap, note, … }
 * or null when the line is not a conversion this knows.
 */
export function convert(src) {
  const q = String(src ?? '').trim();
  if (!q || q.length > 80 || !/\d|^how\s+many\s/i.test(q)) return null;

  let m = q.match(HOWMANY_RE);
  if (m) {
    const to = unitOf(m[1]);
    const from = unitOf(m[3]);
    const amount = !m[2] || /^(a|an|one)$/i.test(m[2]) ? 1 : parseAmount(m[2]);
    if (!to || !from || to.cat !== from.cat || !Number.isFinite(amount)) return null;
    return result(amount, from, to);
  }

  m = q.match(CONVERT_RE);
  if (m) {
    const amount = parseAmount(m[1]);
    const from = unitOf(m[2]);
    const to = unitOf(m[3]);
    if (!from || !to || from.cat !== to.cat || !Number.isFinite(amount)) return null;
    return result(amount, from, to);
  }

  m = q.match(BARE_RE);
  if (m) {
    const amount = parseAmount(m[1]);
    const raw = m[2].trim();
    const from = unitOf(raw);
    if (!from || !Number.isFinite(amount)) return null;
    /* "5 m", "3 d", "9 s" are too easily something else; a degree sign or a real word is not */
    const bare = raw.replace(/^(?:degrees?|deg)\s*/i, '').replace(/^[°º]/, '');
    if (bare.length < 2 && !/^[°º]|^deg/i.test(raw)) return null;
    const to = BY_ID.get(DEFAULT_TO[from.id]);
    if (!to) return null;
    return result(amount, from, to);
  }
  return null;
}

/* ---------- 3. look-ups --------------------------------------------- */
const DEFINE_RES = [
  /^(?:define|definition\s+of|meaning\s+of|dictionary|dict)\s*:?\s+(.+?)\s*\??$/i,
  /^what\s+(?:is|'s|’s)\s+the\s+(?:meaning|definition)\s+of\s+(.+?)\s*\??$/i,
  /^what\s+does\s+(.+?)\s+mean\s*\??$/i,
  /^(.+?)\s+(?:meaning|definition)\s*\??$/i,
];
const TIME_RES = [
  /^(?:what\s+)?time\s+(?:is\s+it\s+)?in\s+(.+?)\s*\??$/i,
  /^what(?:\s+is|'s|’s)\s+the\s+time\s+in\s+(.+?)\s*\??$/i,
  /^(?:what\s+(?:is|'s|’s)\s+the\s+)?(?:current|local)\s+time\s+in\s+(.+?)\s*\??$/i,
  /^what\s+time\s+is\s+it\s+in\s+(.+?)\s*\??$/i,
];
const WIKI_RES = [
  /^(?:wiki|wikipedia)\s*:?\s+(.+?)\s*\??$/i,
  /^(?:who|what)\s+(?:is|was|are|were)\s+(.+?)\s*\??$/i,
  /^(?:who|what)(?:'s|’s)\s+(.+?)\s*\??$/i,
  /^tell\s+me\s+about\s+(.+?)\s*\??$/i,
];

const WORD_RE = /^[a-z][a-z'’-]*(?:\s[a-z][a-z'’-]*){0,2}$/i;

/** -> { kind:'define'|'wiki'|'time', term, key } or null */
export function lookupFor(src) {
  const q = String(src ?? '').trim().replace(/\s+/g, ' ');
  if (q.length < 4 || q.length > 120) return null;
  for (const re of DEFINE_RES) {
    const m = q.match(re);
    if (m) {
      const term = m[1].trim().replace(/^["“'‘]|["”'’]$/g, '').toLowerCase();
      if (term.length < 2 || term.length > 40 || !WORD_RE.test(term)) return null;
      return { kind: 'define', term, key: `define:${term}` };
    }
  }
  for (const re of TIME_RES) {
    const m = q.match(re);
    if (m) {
      const term = m[1].trim();
      return term.length >= 2 ? { kind: 'time', term, key: `time:${term.toLowerCase()}` } : null;
    }
  }
  for (const re of WIKI_RES) {
    const m = q.match(re);
    if (m) {
      const term = m[1].trim().replace(/^(?:a|an)\s+/i, '').replace(/^["“]|["”]$/g, '');
      if (term.length < 2 || term.length > 80 || !/[a-z]/i.test(term)) return null;
      return { kind: 'wiki', term, key: `wiki:${term.toLowerCase()}` };
    }
  }
  return null;
}

/* ---- time in a place: the browser's own zone database ------------- */
/* Everyday names that are not IANA city names. A country with more than
   one zone is not here (it would be a guess); its cities are. */
const PLACES = {
  'utc': 'UTC', 'gmt': 'UTC', 'zulu': 'UTC',
  'nyc': 'America/New_York', 'new york city': 'America/New_York', 'washington': 'America/New_York',
  'washington dc': 'America/New_York', 'dc': 'America/New_York', 'boston': 'America/New_York',
  'miami': 'America/New_York', 'atlanta': 'America/New_York', 'philadelphia': 'America/New_York',
  'orlando': 'America/New_York', 'florida': 'America/New_York',
  'la': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', 'sf': 'America/Los_Angeles',
  'seattle': 'America/Los_Angeles', 'san diego': 'America/Los_Angeles', 'california': 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles', 'portland': 'America/Los_Angeles',
  'dallas': 'America/Chicago', 'houston': 'America/Chicago', 'austin': 'America/Chicago', 'texas': 'America/Chicago',
  'new orleans': 'America/Chicago', 'minneapolis': 'America/Chicago',
  'salt lake city': 'America/Denver', 'colorado': 'America/Denver', 'arizona': 'America/Phoenix',
  'hawaii': 'Pacific/Honolulu', 'alaska': 'America/Anchorage',
  'montreal': 'America/Toronto', 'ottawa': 'America/Toronto', 'calgary': 'America/Edmonton',
  'uk': 'Europe/London', 'england': 'Europe/London', 'britain': 'Europe/London', 'great britain': 'Europe/London',
  'scotland': 'Europe/London', 'wales': 'Europe/London', 'manchester': 'Europe/London', 'edinburgh': 'Europe/London',
  'ireland': 'Europe/Dublin', 'france': 'Europe/Paris', 'germany': 'Europe/Berlin', 'munich': 'Europe/Berlin',
  'italy': 'Europe/Rome', 'milan': 'Europe/Rome', 'spain': 'Europe/Madrid', 'barcelona': 'Europe/Madrid',
  'netherlands': 'Europe/Amsterdam', 'holland': 'Europe/Amsterdam', 'belgium': 'Europe/Brussels',
  'switzerland': 'Europe/Zurich', 'geneva': 'Europe/Zurich', 'austria': 'Europe/Vienna', 'poland': 'Europe/Warsaw',
  'sweden': 'Europe/Stockholm', 'norway': 'Europe/Oslo', 'denmark': 'Europe/Copenhagen', 'finland': 'Europe/Helsinki',
  'greece': 'Europe/Athens', 'turkey': 'Europe/Istanbul', 'ukraine': 'Europe/Kyiv', 'kiev': 'Europe/Kyiv',
  'portugal': 'Europe/Lisbon', 'egypt': 'Africa/Cairo', 'nigeria': 'Africa/Lagos', 'kenya': 'Africa/Nairobi',
  'south africa': 'Africa/Johannesburg', 'cape town': 'Africa/Johannesburg',
  'israel': 'Asia/Jerusalem', 'tel aviv': 'Asia/Jerusalem', 'uae': 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai',
  'saudi arabia': 'Asia/Riyadh', 'mecca': 'Asia/Riyadh', 'iran': 'Asia/Tehran', 'pakistan': 'Asia/Karachi',
  'india': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', 'mumbai': 'Asia/Kolkata',
  'bangalore': 'Asia/Kolkata', 'bengaluru': 'Asia/Kolkata', 'chennai': 'Asia/Kolkata', 'hyderabad': 'Asia/Kolkata',
  'nepal': 'Asia/Kathmandu', 'bangladesh': 'Asia/Dhaka', 'thailand': 'Asia/Bangkok', 'vietnam': 'Asia/Ho_Chi_Minh',
  'hanoi': 'Asia/Bangkok', 'philippines': 'Asia/Manila', 'malaysia': 'Asia/Kuala_Lumpur',
  'china': 'Asia/Shanghai', 'beijing': 'Asia/Shanghai', 'shenzhen': 'Asia/Shanghai', 'guangzhou': 'Asia/Shanghai',
  'hong kong': 'Asia/Hong_Kong', 'taiwan': 'Asia/Taipei', 'japan': 'Asia/Tokyo', 'osaka': 'Asia/Tokyo', 'kyoto': 'Asia/Tokyo',
  'korea': 'Asia/Seoul', 'south korea': 'Asia/Seoul', 'north korea': 'Asia/Pyongyang',
  'new zealand': 'Pacific/Auckland', 'wellington': 'Pacific/Auckland', 'canberra': 'Australia/Sydney',
  'iceland': 'Atlantic/Reykjavik', 'peru': 'America/Lima', 'colombia': 'America/Bogota', 'argentina': 'America/Argentina/Buenos_Aires',
  'buenos aires': 'America/Argentina/Buenos_Aires', 'chile': 'America/Santiago', 'rio': 'America/Sao_Paulo',
  'rio de janeiro': 'America/Sao_Paulo', 'são paulo': 'America/Sao_Paulo', 'cuba': 'America/Havana',
};

let zoneList = null;
function zones() {
  if (zoneList) return zoneList;
  try { zoneList = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []; }
  catch (e) { zoneList = []; }
  return zoneList;
}

/** "tokyo" → 'Asia/Tokyo' (an IANA name this browser really knows), or null. */
export function zoneFor(place) {
  const p = String(place || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/^the\s+/, '');
  if (!p) return null;
  const valid = z => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (e) { return false; } };
  if (PLACES[p] && valid(PLACES[p])) return PLACES[p];
  const city = z => z.split('/').pop().replace(/_/g, ' ').toLowerCase();
  const hit = zones().find(z => city(z) === p) || zones().find(z => z.toLowerCase() === p.replace(/ /g, '_'));
  return hit || null;
}

/** Minutes east of UTC for `zone` at `date`, read from the browser's own formatter. */
function zoneOffset(zone, date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(date);
    const name = (parts.find(p => p.type === 'timeZoneName') || {}).value || 'GMT';
    const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  } catch (e) { return 0; }
}

function gapText(mins) {
  if (mins === 0) return 'the same time as here';
  const a = Math.abs(mins);
  const h = Math.floor(a / 60), m = a % 60;
  const bits = [];
  if (h) bits.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) bits.push(`${m} minute${m === 1 ? '' : 's'}`);
  return `${bits.join(' ')} ${mins > 0 ? 'ahead of' : 'behind'} you`;
}

/** time in a place, computed now. -> answer or { kind:'time', ok:false, message } */
export function timeIn(place, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const zone = zoneFor(place);
  const label = String(place).trim().replace(/\b\w/g, c => c.toUpperCase());
  if (!zone) {
    return { kind: 'time', ok: false, term: label,
      message: `“${label}” isn’t a place this browser’s time-zone list knows. Try a big city near it.` };
  }
  const h12 = !opts.h24;
  const time = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: h12 }).format(now);
  const day = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  const here = -now.getTimezoneOffset();
  const gap = zoneOffset(zone, now) - here;
  const city = zone === 'UTC' ? 'UTC' : zone.split('/').pop().replace(/_/g, ' ');
  return {
    kind: 'time', ok: true, zone, term: label,
    title: time,
    detail: `${day} in ${label === city || zone === 'UTC' ? label : `${label} (${city})`} · ${gapText(gap)}`,
    copy: time,
    source: `Time-zone data from this browser (${zone})`,
  };
}

/* ---- network look-ups: cached, deduplicated, honest about failure -- */
export const ENDPOINTS = {
  dictionary: 'https://api.dictionaryapi.dev/api/v2/entries/en/',
  wikipedia: 'https://en.wikipedia.org/w/api.php',
};
const TIMEOUT_MS = 8000;
const RETRY_AFTER_MS = 15000;          /* a failed look-up is tried again after this */
const MAX_CACHE = 60;
const cache = new Map();               /* key → { state:'loading'|'done', result, promise, at } */

function remember(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
}

async function getJson(url, signal) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  const timer = setTimeout(stop, TIMEOUT_MS);
  if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } });
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', stop);
  }
}

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t; };

async function define(term, signal) {
  const r = await getJson(ENDPOINTS.dictionary + encodeURIComponent(term), signal);
  if (r.status === 404) return { ok: false, reason: 'none', message: `The Free Dictionary has no entry for “${term}”.` };
  if (!r.ok || !Array.isArray(r.body) || !r.body.length) {
    return { ok: false, reason: 'error', message: `The dictionary didn’t answer (HTTP ${r.status}). Try again in a moment.` };
  }
  const entry = r.body[0] || {};
  const meanings = [];
  for (const e of r.body) {
    for (const m of (e && e.meanings) || []) {
      const d = (m.definitions || []).find(x => x && x.definition);
      if (d && !meanings.some(x => x.pos === m.partOfSpeech)) {
        meanings.push({ pos: String(m.partOfSpeech || '').trim(), def: clip(d.definition, 220), example: d.example ? clip(d.example, 120) : '' });
      }
    }
  }
  if (!meanings.length) return { ok: false, reason: 'none', message: `The Free Dictionary has no definition for “${term}”.` };
  const phon = entry.phonetic || ((entry.phonetics || []).find(p => p && p.text) || {}).text || '';
  const src = Array.isArray(entry.sourceUrls) && entry.sourceUrls[0] ? String(entry.sourceUrls[0]) : `https://en.wiktionary.org/wiki/${encodeURIComponent(term)}`;
  const first = meanings[0];
  return {
    ok: true, kind: 'define', word: String(entry.word || term), phonetic: String(phon || ''),
    meanings: meanings.slice(0, 3),
    copy: `${entry.word || term}${first.pos ? ` (${first.pos})` : ''}: ${first.def}`,
    url: /^https:\/\//.test(src) ? src : `https://en.wiktionary.org/wiki/${encodeURIComponent(term)}`,
    source: `Wiktionary, via the Free Dictionary API${entry.license && entry.license.name ? ` · ${entry.license.name}` : ''}`,
  };
}

async function wiki(term, signal) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    prop: 'extracts|info|description|pageprops', ppprop: 'disambiguation',
    exintro: '1', explaintext: '1', exsentences: '2', exlimit: '4', inprop: 'url', redirects: '1',
    generator: 'search', gsrsearch: term, gsrlimit: '4', gsrnamespace: '0',
  });
  const r = await getJson(`${ENDPOINTS.wikipedia}?${params}`, signal);
  if (!r.ok || !r.body || typeof r.body !== 'object') {
    return { ok: false, reason: 'error', message: `Wikipedia didn’t answer (HTTP ${r.status}). Try again in a moment.` };
  }
  const pages = ((r.body.query && r.body.query.pages) || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  if (!pages.length) return { ok: false, reason: 'none', message: `Wikipedia has no article matching “${term}”.` };
  const ambiguous = p => !!(p && p.pageprops && 'disambiguation' in p.pageprops);
  const top = pages[0];
  const page = ambiguous(top) ? pages.find(p => !ambiguous(p) && p.extract) : top;
  if (!page || !page.extract) {
    return { ok: false, reason: 'none', message: `Wikipedia has several articles called “${top.title}” — open it to pick one.`,
      url: top.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(top.title)}` };
  }
  return {
    ok: true, kind: 'wiki', title: String(page.title), description: page.description ? clip(page.description, 90) : '',
    extract: clip(page.extract, 360),
    note: page !== top ? `“${top.title}” has several meanings on Wikipedia — this is the top other match.` : '',
    copy: clip(page.extract, 360),
    url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    source: 'Wikipedia · CC BY-SA',
  };
}

/** What is known about a look-up right now, without starting one. */
export function peek(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (e.state === 'done' && e.result && e.result.reason === 'error' && Date.now() - e.at > RETRY_AFTER_MS) return null;
  return { state: e.state, result: e.result || null };
}

/**
 * Start (or join) a look-up. Resolves to its result — never rejects:
 * { ok:true, … } | { ok:false, reason:'none'|'error'|'offline', message }
 */
export function lookup(req, opts = {}) {
  if (!req || (req.kind !== 'define' && req.kind !== 'wiki')) return Promise.resolve({ ok: false, reason: 'none', message: 'Nothing to look up.' });
  const known = peek(req.key);
  if (known) {
    const e = cache.get(req.key);
    return e.state === 'done' ? Promise.resolve(e.result) : e.promise;
  }
  const entry = { state: 'loading', result: null, promise: null, at: Date.now() };
  entry.promise = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, reason: 'offline', message: 'You’re offline, so this can’t be looked up right now.' };
    }
    try {
      return req.kind === 'define' ? await define(req.term, opts.signal) : await wiki(req.term, opts.signal);
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      return { ok: false, reason: 'error',
        message: aborted ? 'The look-up took too long and was stopped.' : `Couldn’t reach ${req.kind === 'define' ? 'the dictionary' : 'Wikipedia'} — this network may block it.` };
    }
  })().then(res => {
    entry.state = 'done';
    entry.result = res;
    entry.at = Date.now();
    return res;
  });
  remember(req.key, entry);
  return entry.promise;
}

/** Forget every cached look-up (tests), or just one (a manual retry). */
export function clearLookups() { cache.clear(); }
export function forget(key) { cache.delete(key); }

/**
 * The synchronous part: math, conversions and time zones answer at once.
 * -> { kind:'math'|'convert'|'time', … } | { kind:'lookup', req } | null
 */
export function answer(src, opts = {}) {
  const q = String(src ?? '').trim();
  if (!q) return null;
  if (looksMath(q)) {
    const v = calc(q);
    if (v !== null) {
      const expr = mathText(q).trim();
      return { kind: 'math', value: v, expr, title: v.toLocaleString(undefined, { maximumFractionDigits: 10 }), copy: String(v), detail: `${expr} =` };
    }
  }
  const c = convert(q);
  if (c) return c;
  const req = lookupFor(q);
  if (req && req.kind === 'time') return timeIn(req.term, opts);
  if (req) return { kind: 'lookup', req };
  return null;
}

export default { answer, calc, looksMath, convert, convertValue, unitOf, lookupFor, lookup, peek, forget, timeIn, zoneFor, fmtNum, plainNum, clearLookups, UNITS, CATEGORIES, ENDPOINTS };
