/* ============================================================
   meeting.js — the time-zone arithmetic behind Clock's Meet tab.

   Everything comes from the browser's own time zone data (Intl): there
   is no table of offsets in this file, so daylight saving is whatever
   the zone's rules say for the date asked about, and it follows the
   rules as the browser's tz database has them.

   The grid is laid out around a REFERENCE zone's calendar day: one
   column per hour of that day, taken as real instants one hour apart
   from the day's first midnight to its next. On a day the reference
   zone's clocks change that is 23 or 25 columns, not 24. Every other
   zone's cell is the same instant read on its own clock, so across a
   changeover its row steps by an hour (or repeats one) at the right
   column, and a zone on a half- or quarter-hour offset shows :30 / :45.

     offsetMin(ms, tz)            minutes the zone is ahead of UTC at that instant
     partsOf(ms, tz)              { y, m, d, h, mi, dow, ymd } on the zone's clock
     instantOf(ymd, h, mi, tz)    the instant a wall-clock time happens there
     dayColumns(ymd, tz)          the instants of that zone's hours that day
     dstChangesOn(ymd, tz)        do the zone's clocks change during that day?
     classify(h, mi, work)        'work' | 'sleep' | 'free' for a wall-clock time
     buildGrid(opts)              the whole grid
     chosen(ms, places, work)     one chosen instant, in every place
   ============================================================ */

const FORMATTERS = new Map();
function fmt(tz) {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
    FORMATTERS.set(tz, f);
  }
  return f;
}
const pad = n => String(n).padStart(2, '0');
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { fmt(tz); return true; } catch (e) { return false; }
}
export const cityOf = tz => String(tz).split('/').pop().replace(/_/g, ' ');
export const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } };
export function zoneList() {
  try { if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone'); } catch (e) { /* fall through */ }
  return [];
}

export function partsOf(ms, tz) {
  const o = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = p.value;
  const r = { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, dow: DOW[o.weekday] };
  r.ymd = `${r.y}-${pad(r.m)}-${pad(r.d)}`;
  return r;
}
export function offsetMin(ms, tz) {
  const p = partsOf(ms, tz);
  const whole = ms - (((ms % 1000) + 1000) % 1000);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - whole) / 60000);
}
export function offsetLabel(min) {
  const a = Math.abs(min);
  return `UTC${min < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
}

const ymdParts = ymd => ymd.split('-').map(Number);
export const addDays = (ymd, n) => {
  const [y, m, d] = ymdParts(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
export const validYmd = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = ymdParts(s);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** The instant the wall clock in `tz` reads ymd h:mi. A time that doesn't exist there
    (clocks sprang over it) gives the first instant after the gap; one that happens
    twice (clocks fell back) gives the earlier. */
export function instantOf(ymd, h, mi, tz) {
  const [y, m, d] = ymdParts(ymd);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const want = `${ymd} ${pad(h)}:${pad(mi)}`;
  const at = t => { const p = partsOf(t, tz); return `${p.ymd} ${pad(p.h)}:${pad(p.mi)}`; };
  const t1 = guess - offsetMin(guess, tz) * 60000;
  const t2 = guess - offsetMin(t1, tz) * 60000;
  const hits = [t1, t2, guess - offsetMin(t2, tz) * 60000].filter(t => at(t) === want);
  if (hits.length) return Math.min(...hits);
  return Math.max(t1, t2);
}

/** The instants of the zone's whole hours on a day, one hour apart, midnight first.
    23 on the day clocks spring forward, 25 on the day they fall back. */
export function dayColumns(ymd, tz) {
  const start = instantOf(ymd, 0, 0, tz);
  const end = instantOf(addDays(ymd, 1), 0, 0, tz);
  const out = [];
  for (let t = start; t < end; t += 3600000) out.push(t);
  return out;
}
/** Do this zone's clocks change at some point during the day? (Its offset at the
    start of the day differs from its offset at the start of the next.) */
export function dstChangesOn(ymd, tz) {
  const a = instantOf(ymd, 0, 0, tz), b = instantOf(addDays(ymd, 1), 0, 0, tz);
  return offsetMin(a, tz) !== offsetMin(b, tz);
}

export const DEFAULT_WORK = { start: 9, end: 17 };
export const SLEEP = { from: 22, to: 7 };
/** What a wall-clock time is for someone: in working hours, asleep (22:00–07:00), or free. */
export function classify(h, mi = 0, work = DEFAULT_WORK) {
  const t = h + mi / 60;
  if (t >= work.start && t < work.end) return 'work';
  if (t >= SLEEP.from || t < SLEEP.to) return 'sleep';
  return 'free';
}

/** opts { ymd, places:[tz…] (the first is the reference), work }.
    -> { ymd, ref, cols:[ms…], rows:[{ tz, offsets:[min…], cells:[{ ms, h, mi, ymd, dow, cls, day }] }] }
    `day` is -1, 0 or 1: that cell's calendar day against the reference day. */
export function buildGrid({ ymd, places, work = DEFAULT_WORK }) {
  const ref = places[0];
  const cols = dayColumns(ymd, ref);
  const rows = places.map(tz => ({
    tz,
    cells: cols.map(ms => {
      const p = partsOf(ms, tz);
      const day = p.ymd === ymd ? 0 : p.ymd < ymd ? -1 : 1;
      return { ms, h: p.h, mi: p.mi, ymd: p.ymd, dow: p.dow, cls: classify(p.h, p.mi, work), day };
    }),
  }));
  return { ymd, ref, cols, rows };
}

/** One instant in every place: [{ tz, ymd, dow, h, mi, cls, offset, dst }] — `dst` is true when
    that place's clocks change at some point on its own calendar day. */
export function chosen(ms, places, work = DEFAULT_WORK) {
  return places.map(tz => {
    const p = partsOf(ms, tz);
    return { tz, ymd: p.ymd, dow: p.dow, h: p.h, mi: p.mi, cls: classify(p.h, p.mi, work), offset: offsetMin(ms, tz), dst: dstChangesOn(p.ymd, tz) };
  });
}

export default { isZone, cityOf, localZone, zoneList, partsOf, offsetMin, offsetLabel, addDays, validYmd, instantOf, dayColumns, dstChangesOn, DEFAULT_WORK, SLEEP, classify, buildGrid, chosen };
