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
     toCsv(entries)              CSV text; every text cell guarded against spreadsheet formulas
     csvCell(value)
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
  return {
    id: String(e.id || `m${i}`).slice(0, 40),
    date: e.date,
    type: e.type === 'in' ? 'in' : 'out',
    cat: String(e.cat || 'Other').trim().slice(0, 30) || 'Other',
    amount,
    note: String(e.note || '').slice(0, 120),
  };
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

export default { parseMoney, formatMoney, plainMoney, addMoney, sumMoney, summarize, toCsv, csvCell, normEntry, cleanSymbol, monthOf, validDay, MAX_MINOR, OUT_CATS, IN_CATS };
