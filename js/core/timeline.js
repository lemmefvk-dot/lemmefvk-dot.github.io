/* ============================================================
   timeline.js — the dates and the layout behind the Timeline app.

   Dates are calendar dates with no year 0, as history is written: 1 BCE is
   followed by 1 CE. A date is { y, m, d, approx } where y is negative for BCE
   (−44 is 44 BCE), m is 1–12 or 0 for "no month", d is 1–31 or 0.

     parseDate(text)   "44 BCE", "1066", "AD 1066", "14 Oct 1066", "October 1066",
                       "1066-10-14", "c. 1500", "3000 BC", "-44"  →  date | null
     parseSpan(text)   a date, or two joined by "–", "-" or "to": "1914–1918",
                       "431–404 BCE", "500 BCE to 400 CE"  →  { start, end } | null
                       (an era written once, at the end, applies to both ends)
     formatDate(date)  "44 BCE", "14 Oct 1066", "c. 1500"
     pos(date)         where it falls on the line, in years (1 BCE is 0, 1 CE is 1,
                       so the line is continuous across the era)
     layout(events, { ppy, … })  every card's place, the axis ticks and the size
   ============================================================ */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const YEAR_MAX = 100000;

const bceWord = s => /^(bce|bc|b\.c\.e?\.?)$/i.test(s);

/* the era marked on a piece of text: 'bce', 'ce' or null, with the era words taken off */
function takeEra(text) {
  let s = text.trim(), era = null;
  const tail = /\s*\b(bce|bc|b\.c\.e?\.?|ce|ad|c\.e\.|a\.d\.)\s*$/i.exec(s);
  if (tail) { era = bceWord(tail[1]) ? 'bce' : 'ce'; s = s.slice(0, tail.index); }
  const head = /^\s*(ad|a\.d\.)\s+/i.exec(s);
  if (head) { era = 'ce'; s = s.slice(head[0].length); }
  return { s: s.trim(), era };
}

export function parseDate(text, defaultEra = null) {
  let t = String(text ?? '').trim();
  if (!t) return null;
  let approx = false;
  const ap = /^(c\.?|ca\.?|circa|about|around|~)\s*/i.exec(t);
  if (ap) { approx = true; t = t.slice(ap[0].length); }
  let neg = false;
  if (/^[-−]\s*\d/.test(t)) { neg = true; t = t.replace(/^[-−]\s*/, ''); }
  const { s, era } = takeEra(t);
  const bce = neg || (era ? era === 'bce' : defaultEra === 'bce');
  let m, y, mo = 0, d = 0;
  if ((m = /^(\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{1,6})$/i.exec(s))) { d = +m[1]; mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; y = +m[3]; if (!mo) return null; }
  else if ((m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{1,6})$/i.exec(s))) { mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; d = +m[2]; y = +m[3]; if (!mo) return null; }
  else if ((m = /^([a-z]{3,9})\.?,?\s+(\d{1,6})$/i.exec(s))) { mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; y = +m[2]; if (!mo) return null; }
  else if ((m = /^(\d{1,6})$/.exec(s))) { y = +m[1]; }
  else return null;
  if (!Number.isInteger(y) || y < 1 || y > YEAR_MAX) return null;           /* there is no year 0 */
  if (mo < 0 || mo > 12 || d < 0 || d > 31) return null;
  if (d && !mo) return null;
  if (d) { const dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]; if (d > dim) return null; }
  return { y: bce ? -y : y, m: mo, d, approx };
}

export function parseSpan(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (/^(\d{1,6})-(\d{1,2})-(\d{1,2})(\s|$)/.test(t) && !/\s(to|–|—)\s/.test(t)) { const one = parseDate(t); return one ? { start: one, end: null } : null; }
  const parts = t.split(/\s*(?:–|—|\sto\s|\s-\s|(?<=\d)-(?=\d))\s*/i).filter(Boolean);
  if (parts.length === 1) { const one = parseDate(parts[0]); return one ? { start: one, end: null } : null; }
  if (parts.length !== 2) return null;
  /* an era written only at the end belongs to both ends */
  const endEra = takeEra(parts[1]).era;
  const startEra = takeEra(parts[0]).era;
  const a = parseDate(parts[0], startEra ? null : endEra), b = parseDate(parts[1]);
  if (!a || !b) return null;
  if (pos(b) < pos(a)) return null;
  return { start: a, end: b };
}

/* era: null = as history writes it ("44 BCE", "80 CE", "1066"); '' = none; ' CE' = say CE */
export function formatDate(dt, era = null) {
  if (!dt) return '';
  const yr = Math.abs(dt.y);
  const e = era !== null ? era : dt.y < 0 ? ' BCE' : yr < 1000 ? ' CE' : '';
  let s;
  if (dt.d) s = `${dt.d} ${MONTH_NAMES[dt.m - 1]} ${yr}${e}`;
  else if (dt.m) s = `${MONTH_NAMES[dt.m - 1]} ${yr}${e}`;
  else s = `${yr}${e}`;
  return dt.approx ? `c. ${s}` : s;
}
export function formatSpan(start, end) {
  if (!end) return formatDate(start);
  /* a shared era is said once, at the end: 431–404 BCE, 80–120 CE */
  if (start.y < 0 && end.y < 0) return `${formatDate(start, '')}–${formatDate(end)}`;
  if (start.y > 0 && end.y > 0 && end.y < 1000) return `${formatDate(start, '')}–${formatDate(end)}`;
  /* across the eras the CE end says so: 500 BCE–400 CE */
  if (start.y < 0 && end.y > 0) return `${formatDate(start)}–${formatDate(end, ' CE')}`;
  return `${formatDate(start)}–${formatDate(end)}`;
}

/** where a date falls on the line, in years: 1 BCE = 0, 1 CE = 1 */
export function pos(dt) {
  const base = dt.y < 0 ? dt.y + 1 : dt.y;
  return base + (dt.m ? (dt.m - 1) / 12 : 0) + (dt.d ? (dt.d - 1) / 365 : 0);
}

/** the label for a year on the axis: "500 BCE", "1066" (or "1066 CE" when the line crosses the eras) */
export function yearLabel(ay, crossesEra) {
  if (ay <= 0) return `${1 - ay} BCE`;
  return crossesEra ? `${ay} CE` : String(ay);
}

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];
export const niceStep = (ppy, gap = 90) => NICE.find(s => s * ppy >= gap) || NICE[NICE.length - 1];

/**
 * layout(events, { ppy, width, measure, cardMax }) → { items, ticks, minor, width, height, axisY, min, max, crossesEra }
 * events: [{ id, title, start, end|null }] (dates as above). measure(text) gives a text's width in px.
 * items: [{ id, x, x2|null, cx, cy, w, side: -1 above | 1 below, lane }]. Cards never overlap in a lane.
 */
export function layout(events, { ppy = 4, measure = t => t.length * 7, cardMax = 170, pad = 90, minSpan = 20 } = {}) {
  const evs = events.map(e => ({ ...e, p: pos(e.start), p2: e.end ? pos(e.end) : null })).sort((a, b) => a.p - b.p);
  let min = evs.length ? Math.min(...evs.map(e => e.p)) : 0, max = evs.length ? Math.max(...evs.map(e => e.p2 ?? e.p)) : 1;
  if (max - min < minSpan) { const mid = (min + max) / 2; min = mid - minSpan / 2; max = mid + minSpan / 2; }
  const margin = Math.max(1, (max - min) * 0.03);
  min -= margin; max += margin;
  const X = p => pad + (p - min) * ppy;
  const width = Math.ceil(X(max) + pad);
  const lanesBy = { '-1': [], '1': [] };
  const items = [];
  for (const e of evs) {
    const x = X(e.p), x2 = e.p2 !== null ? Math.max(X(e.p2), x + 6) : null;
    const w = Math.min(cardMax, Math.max(86, Math.ceil(measure(e.title)) + 18));
    const cx = x2 !== null ? (x + x2) / 2 : x;
    let placed = null;
    for (let lane = 0; lane < 40 && !placed; lane++) for (const side of [-1, 1]) {
      const row = lanesBy[side][lane] || (lanesBy[side][lane] = []);
      if (row.every(r => cx - w / 2 - 8 >= r[1] || cx + w / 2 + 8 <= r[0])) { row.push([cx - w / 2, cx + w / 2]); placed = { side, lane }; break; }
    }
    if (!placed) placed = { side: 1, lane: 39 };
    items.push({ id: e.id, x, x2, cx, w, side: placed.side, lane: placed.lane, p: e.p, p2: e.p2 });
  }
  const above = Math.max(1, lanesBy['-1'].length), below = Math.max(1, lanesBy['1'].length);
  const LANE = 58;
  const top = 64;                                  /* room for the title */
  const axisY = top + above * LANE + 22;
  const height = Math.ceil(axisY + below * LANE + 56);
  for (const it of items) { it.cy = axisY + it.side * (34 + it.lane * LANE); }
  /* axis ticks: round years, on a step that keeps them ~90 px apart */
  const step = niceStep(ppy);
  const crossesEra = min < 1;
  const ticks = [];
  /* BCE side: n BCE sits at 1 − n. CE side: year n sits at n. */
  if (min < 0.5) for (let n = Math.ceil((1 - max) / step) * step; 1 - n >= min - 1e-9; n += step) { if (n <= 0 || 1 - n > max) continue; ticks.push({ x: X(1 - n), label: yearLabel(1 - n, crossesEra), major: true }); }
  if (max > 1) for (let n = Math.max(step, Math.ceil(min / step) * step); n <= max; n += step) { if (n < min) continue; ticks.push({ x: X(n), label: yearLabel(n, crossesEra), major: true }); }
  /* month marks when zoomed well in */
  const minor = [];
  if (ppy >= 120) for (let y = Math.floor(min); y <= Math.ceil(max); y++) for (let m = 0; m < 12; m++) { const p = y + m / 12; if (p >= min && p <= max) minor.push({ x: X(p), label: ppy >= 420 ? MONTH_NAMES[m] : '' }); }
  return { items, ticks, minor, width, height, axisY, min, max, crossesEra, X };
}

export default { parseDate, parseSpan, formatDate, formatSpan, pos, yearLabel, niceStep, layout };
