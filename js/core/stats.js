/* ============================================================
   stats.js (core) — the Statistics calculator's maths. No DOM, no eval.

   Reading numbers: parseNumbers() takes anything pasted (commas, spaces,
   tabs, new lines, semicolons, a column from a spreadsheet) and returns
   the numbers plus exactly what it ignored. parsePairs() reads one
   "x y" pair per line and ignores a line that is not exactly two numbers
   (a header such as "x,y" is the usual one) and says which.

   describe(values) -> count, sum, mean, median, mode(s), min, max, range,
   quartiles, IQR, and BOTH variances / standard deviations:
     sample      divides by n − 1 (for data that is a sample of more)
     population  divides by n     (for data that is everything)
   Quartiles are the textbook "median of each half" method: sort, split at
   the median (the median itself is left out of both halves when n is
   odd), Q1 is the median of the lower half and Q3 of the upper half.
   Other programs use other methods and can differ by a little on small
   data sets; the page says which one this is.
   Mean and spread use a two-pass sum (mean first, then squared
   differences from it), which stays accurate where "mean of squares
   minus square of mean" does not.

   fitLine(pairs) -> least-squares line y = slope·x + intercept, r and r²,
   or { ok: false, reason } when no line can be fitted (fewer than two
   points, or every x the same: a vertical line has no slope).
   ============================================================ */

export const MAX_VALUES = 5000;
export const MAX_SHOWN_IGNORED = 8;
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const clean = s => String(s == null ? '' : s).replace(/[−–]/g, '-');

const clip = t => (t.length > 20 ? t.slice(0, 19) + '…' : t);
/** -> { values, ignored: [text], note } — `note` says in words what was left out, or ''. */
export function parseNumbers(text) {
  const values = [];
  const ignored = [];
  let over = 0;
  for (const tok of clean(text).split(/[\s,;]+/)) {
    if (!tok) continue;
    if (NUM.test(tok) && Number.isFinite(Number(tok))) { if (values.length < MAX_VALUES) values.push(Number(tok)); else over++; }
    else ignored.push(tok);
  }
  return { values, ignored, over, note: noteFor(ignored, over, 'value') };
}
/** -> { pairs: [[x, y]], ignored: [text of each ignored line], note } */
export function parsePairs(text) {
  const pairs = [];
  const ignored = [];
  let over = 0;
  clean(text).split(/\r?\n/).forEach((line, i) => {
    const l = line.trim();
    if (!l) return;
    const toks = l.split(/[\s,;]+/).filter(Boolean);
    if (toks.length === 2 && toks.every(t => NUM.test(t) && Number.isFinite(Number(t)))) {
      if (pairs.length < MAX_VALUES) pairs.push([Number(toks[0]), Number(toks[1])]); else over++;
    } else ignored.push(`line ${i + 1} “${clip(l)}”`);
  });
  return { pairs, ignored, over, note: noteFor(ignored, over, 'pair', 'line') };
}
function noteFor(ignored, over, noun, what = 'item') {
  const parts = [];
  if (ignored.length) {
    const shown = ignored.slice(0, MAX_SHOWN_IGNORED).map(t => (what === 'line' ? t : `“${clip(t)}”`)).join(', ');
    parts.push(`Ignored ${ignored.length} ${what}${ignored.length === 1 ? '' : 's'} that ${what === 'line' ? 'did not hold exactly two numbers' : 'were not numbers'}: ${shown}${ignored.length > MAX_SHOWN_IGNORED ? ', …' : ''}.`);
  }
  if (over) parts.push(`Used the first ${MAX_VALUES} ${noun}s; ${over} more ${over === 1 ? 'was' : 'were'} left out.`);
  return parts.join(' ');
}

/* ---------- the numbers ---------- */
const medianOf = a => { const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
export const mean = a => { let s = 0; for (const v of a) s += v; return s / a.length; };

export function describe(values) {
  const n = values.length;
  if (!n) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  const m = sum / n;
  let ss = 0;
  for (const v of sorted) ss += (v - m) * (v - m);
  const counts = new Map();
  for (const v of sorted) counts.set(v, (counts.get(v) || 0) + 1);
  const top = Math.max(...counts.values());
  const modes = top > 1 ? [...counts].filter(([, c]) => c === top).map(([v]) => v) : [];
  const half = Math.floor(n / 2);
  const lower = sorted.slice(0, half), upper = sorted.slice(n % 2 ? half + 1 : half);
  const q1 = lower.length ? medianOf(lower) : null, q3 = upper.length ? medianOf(upper) : null;
  const out = {
    n, sum, mean: m, median: medianOf(sorted), modes, modeCount: modes.length ? top : 0,
    min: sorted[0], max: sorted[n - 1], range: sorted[n - 1] - sorted[0],
    q1, q3, iqr: q1 === null ? null : q3 - q1, sorted,
    varPop: ss / n, sdPop: Math.sqrt(ss / n),
    varSample: n > 1 ? ss / (n - 1) : null, sdSample: n > 1 ? Math.sqrt(ss / (n - 1)) : null,
  };
  return out;
}

/** Least-squares line through [x, y] pairs. */
export function fitLine(pairs) {
  const n = pairs.length;
  if (n < 2) return { ok: false, n, reason: n ? 'One point is not enough: a line needs at least two points.' : 'Add some x, y pairs to fit a line.' };
  const mx = mean(pairs.map(p => p[0])), my = mean(pairs.map(p => p[1]));
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pairs) { sxx += (x - mx) * (x - mx); syy += (y - my) * (y - my); sxy += (x - mx) * (y - my); }
  if (sxx === 0) return { ok: false, n, reason: 'Every x value is the same, so the points sit on a vertical line, which has no slope. A line of best fit needs at least two different x values.' };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r = syy === 0 ? null : Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  return { ok: true, n, slope, intercept, r, r2: r === null ? null : r * r, mx, my, sxx, syy, sxy,
    note: syy === 0 ? 'Every y value is the same, so the line is flat and r is not defined (there is no up-and-down to correlate).' : n === 2 ? 'With only two points any two points give a perfect line (r = ±1), so it says little.' : '' };
}

/** A number as text without floating-point dust: at most 10 significant digits, no trailing zeros. */
export function fmt(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e12 || a < 1e-6) return Number(v.toPrecision(7)).toExponential().replace('e+', 'e');
  return String(Number(v.toPrecision(10)));
}
/** The line as text: y = 2x + 1, y = −0.5x, y = 3. */
export function lineText(f) {
  const m = fmt(f.slope), b = f.intercept;
  const mp = m === '1' ? 'x' : m === '-1' ? '-x' : `${m}x`;
  if (Number(fmt(f.slope)) === 0) return `y = ${fmt(b)}`;
  const bt = Number(fmt(b)) === 0 ? '' : ` ${b < 0 ? '−' : '+'} ${fmt(Math.abs(b))}`;
  return `y = ${mp}${bt}`.replace('y = -', 'y = −');
}

export default { parseNumbers, parsePairs, describe, fitLine, fmt, lineText, mean };
