/* ============================================================
   money.js — exact money for the Budget tab of Static Life.

   Every amount is a whole number of minor units (cents): $12.34 is
   1234. Nothing here ever holds a fraction of a unit in a number, so
   0.1 + 0.2 is 10 + 20 = 30, never 0.30000000000000004. Typed text
   is read digit by digit (never parseFloat), sums are integer sums,
   and a result that would leave JavaScript's safe-integer range is
   refused instead of quietly rounded.

   No exchange rates, no lookups: the currency symbol is only a label
   in front of the number.

   Entries: { id, date:'YYYY-MM-DD', type:'in'|'out', cat, amount, note }
   (amount is positive; `type` says which way it goes).

     parseMoney(text)            -> { ok:true, minor } | { ok:false, why }
     formatMoney(minor, symbol)  -> '$1,234.56' / '-$0.05'
     addMoney(a, b)              exact sum or throws
     summarize(entries, budgets, month) -> { income, spent, net, cats[] }
     monthSeries(entries, month, n) -> [{ month, income, spent }]  for the chart
     toCsv(entries)              CSV text; every text cell guarded against spreadsheet formulas
     csvCell(value)
     fromRows(rows)              CSV rows in -> { entries, skipped:[{ line, why }] }
     dueEntries(rules, today)    what repeating entries owe up to today
     goalProgress(entries, goal, month)
   ============================================================ */

export const MAX_MINOR = 99_999_999_999;          /* 999,999,999.99 */
export const DEFAULT_SYMBOL = '$';
export const OUT_CATS = ['Food', 'Transport', 'Fun', 'School', 'Shopping', 'Savings', 'Other'];
export const IN_CATS = ['Allowance', 'Gift', 'Job', 'Other'];

const NUM = /^(\d{1,3}(,\d{3})+|\d+)?(\.(\d*))?$/;

/** Text to minor units, exactly. Accepts "12", "12.5", "12.50", ".5", "1,234.56" and a leading symbol. */
export function parseMoney(text) {
  const s = String(text ?? '').trim().replace(/^[^\d.,\s-]{1,3}\s*/u, '');
  if (!s) return { ok: false, why: 'Type an amount.' };
  if (s.startsWith('-')) return { ok: false, why: 'Type the amount without a minus sign; pick Income or Spending instead.' };
  const m = NUM.exec(s);
  if (!m || (!m[1] && !(m[4] && m[4].length))) return { ok: false, why: 'That is not an amount. Try 12.50.' };
  const whole = (m[1] || '0').replace(/,/g, '');
  const frac = m[4] || '';
  if (frac.length > 2) return { ok: false, why: 'Amounts have at most two decimal places.' };
  if (whole.length > 11) return { ok: false, why: 'That amount is too large.' };
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) return { ok: false, why: 'That amount is too large.' };
  return { ok: true, minor };
}

/** Exact sum of two whole-minor-unit amounts. */
export function addMoney(a, b) {
  const s = a + b;
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isSafeInteger(s)) throw new RangeError('money out of range');
  return s;
}
export const sumMoney = list => list.reduce((t, n) => addMoney(t, n), 0);

const group = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** 1234 -> "$12.34", -5 -> "-$0.05". The symbol is whatever the person set. */
export function formatMoney(minor, symbol = DEFAULT_SYMBOL) {
  const n = Math.trunc(Number(minor)) || 0;
  const abs = Math.abs(n);
  const whole = String(Math.floor(abs / 100));
  const cents = String(abs % 100).padStart(2, '0');
  return `${n < 0 ? '-' : ''}${symbol}${group(whole)}.${cents}`;
}
/** Plain "12.34" (no symbol, no grouping): what a spreadsheet reads. */
export const plainMoney = minor => { const a = Math.abs(minor); return `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`; };

/** A currency symbol: up to 3 characters, no markup characters. */
export const cleanSymbol = v => {
  const s = [...String(v ?? '').replace(/[<>&"'\s]/g, '')].slice(0, 3).join('');
  return s || DEFAULT_SYMBOL;
};

export const monthOf = date => String(date).slice(0, 7);
export const validDay = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
};

/** A clean entry, or null. */
export function normEntry(e, i = 0) {
  if (!e || typeof e !== 'object') return null;
  const amount = e.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_MINOR) return null;
  if (!validDay(e.date)) return null;
  const out = {
    id: String(e.id || `m${i}`).slice(0, 40),
    date: e.date,
    type: e.type === 'in' ? 'in' : 'out',
    cat: String(e.cat || 'Other').trim().slice(0, 30) || 'Other',
    amount,
    note: String(e.note || '').slice(0, 120),
  };
  if (typeof e.rec === 'string' && e.rec) out.rec = e.rec.slice(0, 40);     /* added by a repeating entry */
  return out;
}

/** One month: income, spending, what is left over, and each spending category against its budget. */
export function summarize(entries, budgets, month) {
  const inMonth = entries.filter(e => monthOf(e.date) === month);
  let income = 0, spent = 0;
  const by = new Map();
  for (const e of inMonth) {
    if (e.type === 'in') income = addMoney(income, e.amount);
    else { spent = addMoney(spent, e.amount); by.set(e.cat, addMoney(by.get(e.cat) || 0, e.amount)); }
  }
  for (const c of Object.keys(budgets || {})) if (!by.has(c) && budgets[c] > 0) by.set(c, 0);
  const cats = [...by.entries()].map(([cat, s]) => {
    const budget = budgets && Number.isSafeInteger(budgets[cat]) && budgets[cat] > 0 ? budgets[cat] : null;
    return { cat, spent: s, budget, left: budget === null ? null : budget - s };
  }).sort((a, b) => b.spent - a.spent || a.cat.localeCompare(b.cat));
  return { month, income, spent, net: income - spent, cats, count: inMonth.length };
}

/** Income and spending for `n` months ending with `month`, oldest first. */
export function monthSeries(entries, month, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1 - i, 1, 12);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let income = 0, spent = 0;
    for (const e of entries) if (monthOf(e.date) === m) { if (e.type === 'in') income = addMoney(income, e.amount); else spent = addMoney(spent, e.amount); }
    out.push({ month: m, income, spent });
  }
  return out;
}

/* ---------------- repeating entries -------------------------------
   { id, type, cat, amount, note, every:'week'|'month', start:'YYYY-MM-DD', last }
   Weekly: every 7 days from `start`. Monthly: on start's day of the month,
   or the month's last day when it is shorter (the 31st is the 30th in
   April). `last` is the latest date already written as an entry, so
   each date is added once, on or after its day, while Budget is open;
   an entry you delete doesn't come back. Nothing is added ahead of time. */
export const MAX_BACKFILL = 400;
const dayNoon = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12);
const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function normRecurring(r, i = 0) {
  const e = normEntry({ ...r, date: r && r.start });
  if (!e || !r || (r.every !== 'week' && r.every !== 'month')) return null;
  return { id: e.id || `r${i}`, type: e.type, cat: e.cat, amount: e.amount, note: e.note, every: r.every, start: e.date, last: validDay(r.last) ? r.last : '' };
}
/** The dates rule `r` falls on after `after` (exclusive, '' = from its start) up to `until` (inclusive). */
export function datesOf(r, after, until, max = MAX_BACKFILL) {
  const out = [];
  const start = dayNoon(r.start);
  const dom = start.getDate();
  for (let k = 0; out.length < max && k < 5000; k++) {
    let d;
    if (r.every === 'week') { d = new Date(start); d.setDate(start.getDate() + 7 * k); }
    else {
      const y = start.getFullYear(), m = start.getMonth() + k;
      const last = new Date(y, m + 1, 0, 12).getDate();
      d = new Date(y, m, Math.min(dom, last), 12);
    }
    const key = keyOf(d);
    if (key > until) break;
    if (!after || key > after) out.push(key);
  }
  return out;
}
/** The next date rule `r` falls on after `today`. */
export const nextDate = (r, today) => datesOf(r, today, '9999-12-31', 1)[0] || null;
/** Entries every rule owes up to `today`, and the rules with `last` moved on. */
export function dueEntries(rules, today, makeId) {
  const add = [];
  const next = rules.map(r => {
    const dates = datesOf(r, r.last, today);
    if (!dates.length) return r;
    for (const date of dates) add.push(normEntry({ id: makeId(), date, type: r.type, cat: r.cat, amount: r.amount, note: r.note, rec: r.id }));
    return { ...r, last: dates[dates.length - 1] };
  });
  return { add, rules: next };
}

/* ---------------- a savings goal ----------------------------------
   { name, target, by:'YYYY-MM' | '' }. Saved so far is the sum of every
   spending entry in the Savings category, which is the category you
   pick when you put money aside. The monthly figure is plain division
   of what is left over the months up to `by` (this one included),
   rounded up to the cent. */
export const SAVINGS = 'Savings';
export function normGoal(g) {
  if (!g || typeof g !== 'object' || !Number.isSafeInteger(g.target) || g.target <= 0 || g.target > MAX_MINOR) return null;
  return { name: String(g.name || '').trim().slice(0, 40) || 'Savings goal', target: g.target, by: /^\d{4}-(0[1-9]|1[0-2])$/.test(g.by || '') ? g.by : '' };
}
export function goalProgress(entries, goal, month) {
  const saved = sumMoney(entries.filter(e => e.type === 'out' && e.cat.toLowerCase() === SAVINGS.toLowerCase()).map(e => e.amount));
  const left = Math.max(0, goal.target - saved);
  const pct = Math.min(100, Math.floor((saved * 100) / goal.target));
  let months = null, perMonth = null;
  if (goal.by && left > 0) {
    months = (+goal.by.slice(0, 4) - +month.slice(0, 4)) * 12 + (+goal.by.slice(5, 7) - +month.slice(5, 7)) + 1;
    if (months >= 1) perMonth = Math.ceil(left / months);
    else months = 0;
  }
  return { saved, left, pct, months, perMonth, done: saved >= goal.target };
}

/* ---------------- CSV in ------------------------------------------
   Rows (already split into fields) from a bank or another app, or a file
   this tab exported. A header row names the columns: a date, an amount,
   and any of type, category, note. Without a type column, a minus sign on
   the amount means spending and none means income. Dates may be
   YYYY-MM-DD, YYYY/MM/DD or with the month spelt out; a date like 03/04/2026
   could be either order, so it is refused rather than guessed. Every row
   that can't be read is listed with the reason. */
const HEAD = { date: /^(date|day|when|posted|transaction date)$/i, type: /^(type|kind|direction)$/i, cat: /^(category|cat|group)$/i, amount: /^(amount|value|sum|total)$/i, note: /^(note|notes|description|memo|details|payee)$/i };
const unguard = s => String(s ?? '').trim().replace(/^'(?=[=+\-@\t\r])/, '');
function readDate(s) {
  s = String(s || '').trim();
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) {
    const k = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return validDay(k) ? k : null;
  }
  if (/[a-z]/i.test(s)) {                                  /* "Nov 3, 2026", "3 November 2026" */
    const t = new Date(s.replace(/(\d)(st|nd|rd|th)\b/gi, '$1') + (/\d{4}/.test(s) ? '' : ' ' + new Date().getFullYear()));
    if (!Number.isNaN(t.getTime()) && t.getFullYear() > 1900) return keyOf(t);
  }
  return null;
}
export function fromRows(rows) {
  const out = { entries: [], skipped: [], header: null };
  const at = rows.findIndex(r => r.some(c => HEAD.date.test(String(c).trim())) && r.some(c => HEAD.amount.test(String(c).trim())));
  if (at < 0) { out.error = 'No header row with a Date and an Amount column was found.'; return out; }
  const head = rows[at].map(c => String(c).trim());
  const col = k => head.findIndex(c => HEAD[k].test(c));
  const C = { date: col('date'), type: col('type'), cat: col('cat'), amount: col('amount'), note: col('note') };
  out.header = C;
  rows.slice(at + 1).forEach((r, i) => {
    const line = at + i + 2;
    if (!r.some(c => String(c).trim())) return;
    const date = readDate(r[C.date]);
    if (!date) { out.skipped.push({ line, why: `“${String(r[C.date] || '').slice(0, 20)}” isn’t a date this can read safely (use YYYY-MM-DD)` }); return; }
    let raw = unguard(r[C.amount]).replace(/^\((.*)\)$/, '-$1');
    let neg = false;
    if (/^[-−]/.test(raw)) { neg = true; raw = raw.slice(1).trim(); }
    else if (/^[^\d.,\s-]{1,3}\s*[-−]/u.test(raw)) { neg = true; raw = raw.replace(/[-−]/, ''); }
    const a = parseMoney(raw);
    if (!a.ok || a.minor === 0) { out.skipped.push({ line, why: a.ok ? 'the amount is zero' : `the amount: ${a.why}` }); return; }
    let type;
    if (C.type >= 0) {
      const t = unguard(r[C.type]).toLowerCase();
      type = /^(in|income|credit|deposit|received)$/.test(t) ? 'in' : /^(out|spending|spent|expense|debit|withdrawal|payment)$/.test(t) ? 'out' : null;
      if (!type) { out.skipped.push({ line, why: `the type “${t.slice(0, 20)}” isn’t Income or Spending` }); return; }
    } else type = neg ? 'out' : 'in';
    const e = normEntry({ id: `csv${i}`, date, type, cat: C.cat >= 0 ? unguard(r[C.cat]) || 'Other' : 'Other', amount: a.minor, note: C.note >= 0 ? unguard(r[C.note]) : '' });
    if (e) out.entries.push(e);
  });
  return out;
}
/** Same date, direction, category, amount and note: the same entry. */
export const sameEntry = (a, b) => a.date === b.date && a.type === b.type && a.cat === b.cat && a.amount === b.amount && a.note === b.note;

/* ---------------- CSV ------------------------------------------- */
/** A spreadsheet runs a cell that starts with = + - @ (or a tab / carriage return) as a formula.
    Text like that gets a leading apostrophe, which spreadsheets show as plain text. */
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Date, Type, Category, Amount, Note. Amounts are unsigned decimals and Type says the direction,
    so no number cell ever begins with a minus sign. */
export function toCsv(entries) {
  const rows = [['Date', 'Type', 'Category', 'Amount', 'Note']];
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([e.date, e.type === 'in' ? 'Income' : 'Spending', e.cat, plainMoney(e.amount), e.note]);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export default { parseMoney, formatMoney, plainMoney, addMoney, sumMoney, summarize, monthSeries, toCsv, csvCell, normEntry, cleanSymbol, monthOf, validDay, normRecurring, datesOf, nextDate, dueEntries, normGoal, goalProgress, fromRows, sameEntry, MAX_MINOR, OUT_CATS, IN_CATS };
