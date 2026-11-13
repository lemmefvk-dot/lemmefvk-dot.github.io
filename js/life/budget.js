/* ============================================================
   life/budget.js — the Budget tab: income and spending you type in,
   a month at a time, a budget for each spending category, and a bar
   chart of the month. All maths is in js/core/money.js (whole minor
   units, no floats).

   It is a record of what you enter and nothing more: no advice, no
   targets, no online lookups, no currency conversion. The page sends
   nothing anywhere; the only place the data goes is this browser's
   saved state and, when you press Export, a CSV file in Documents.

   Export: Date, Type, Category, Amount, Note. Amounts are unsigned
   decimals (Type says the direction), and any text cell that starts
   with = + - @ is prefixed with an apostrophe so a spreadsheet can't
   run it as a formula.
   ============================================================ */
import * as M from '../core/money.js';
import { dayKey } from '../core/habits.js';
import { read, write, uid } from './data.js';

const monthLabel = m => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1, 12).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const shiftMonth = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export function mountBudget(el, ctx) {
  const api = ctx.api;
  const { h, icon, vfs, notify } = api;
  const S = { month: dayKey().slice(0, 7), type: 'out', error: '', dead: false };

  const data = () => {
    const m = read().money || {};
    return {
      entries: (Array.isArray(m.entries) ? m.entries : []).map(M.normEntry).filter(Boolean),
      budgets: Object.fromEntries(Object.entries(m.budgets && typeof m.budgets === 'object' ? m.budgets : {})
        .filter(([, v]) => Number.isSafeInteger(v) && v > 0 && v <= M.MAX_MINOR)),
      symbol: M.cleanSymbol(m.symbol),
    };
  };
  const save = patch => write('money', { ...data(), ...patch });
  const fmt = n => M.formatMoney(n, data().symbol);

  /* ---------------- the entry form (built once, so typing survives redraws) ---------------- */
  const amount = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Amount' });
  const cat = h('input', { type: 'text', list: 'life-cats', maxlength: '30', placeholder: 'Category', 'aria-label': 'Category', autocomplete: 'off' });
  const cats = h('datalist#life-cats');
  const date = h('input', { type: 'date', value: dayKey(), 'aria-label': 'Date' });
  const note = h('input', { type: 'text', maxlength: '120', placeholder: 'Note (optional)', 'aria-label': 'Note', autocomplete: 'off' });
  const err = h('p.life-err', { role: 'alert' });
  const typeBtns = [['out', 'Spending'], ['in', 'Income']].map(([t, label]) =>
    h('button', { type: 'button', 'data-type': t, onclick: () => { S.type = t; cat.value = ''; paintForm(); } }, h('span', { text: label })));
  const symIn = h('input', { type: 'text', maxlength: '3', 'aria-label': 'Currency symbol', class: 'life-sym', value: data().symbol,
    onchange: () => { save({ symbol: M.cleanSymbol(symIn.value) }); symIn.value = data().symbol; paint(); } });

  function paintForm() {
    typeBtns.forEach(b => { const on = b.dataset.type === S.type; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    const names = new Set(S.type === 'in' ? M.IN_CATS : M.OUT_CATS);
    for (const e of data().entries) if (e.type === S.type) names.add(e.cat);
    cats.replaceChildren(...[...names].map(n => h('option', { value: n })));
    cat.placeholder = S.type === 'in' ? 'Allowance, Gift…' : 'Food, Fun…';
    err.textContent = S.error;
  }

  function add() {
    const a = M.parseMoney(amount.value);
    if (!a.ok) { S.error = a.why; paintForm(); return; }
    if (a.minor === 0) { S.error = 'An amount of zero isn’t an entry.'; paintForm(); return; }
    if (!M.validDay(date.value)) { S.error = 'Pick a date.'; paintForm(); return; }
    const entry = M.normEntry({ id: uid('m'), date: date.value, type: S.type, cat: cat.value || 'Other', amount: a.minor, note: note.value });
    const d = data();
    save({ entries: [...d.entries, entry] });
    amount.value = ''; note.value = '';
    S.error = '';
    S.month = M.monthOf(entry.date);
    paintForm(); paint();
    amount.focus();
  }
  for (const i of [amount, cat, date, note]) i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  /* ---------------- export ---------------- */
  function exportCsv() {
    const d = data();
    const inMonth = d.entries.filter(e => M.monthOf(e.date) === S.month);
    const rows = inMonth.length ? inMonth : [];
    if (!rows.length) { notify({ app: 'Static Life', icon: 'download', title: 'Nothing to export', message: `No entries in ${monthLabel(S.month)}.` }); return; }
    const dir = `${vfs.HOME}/Documents`;
    if (!vfs.node(dir)) vfs.mkdir(dir);
    let name = `budget-${S.month}.csv`, k = 1;
    while (vfs.node(`${dir}/${name}`)) name = `budget-${S.month} (${++k}).csv`;
    vfs.write(`${dir}/${name}`, M.toCsv(rows));
    notify({ app: 'Static Life', icon: 'download', title: 'Exported', message: `${name} is in Documents (${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}).`,
      actions: [{ label: 'Open in Files', onClick: () => api.openApp('files', { path: dir }) }] });
  }

  /* ---------------- budgets ---------------- */
  function setBudget(name, text) {
    const d = data();
    const budgets = { ...d.budgets };
    if (!String(text).trim()) delete budgets[name];
    else {
      const p = M.parseMoney(text);
      if (!p.ok || p.minor === 0) { S.error = p.ok ? 'A budget of zero isn’t a budget; clear the box to remove it.' : p.why; paintForm(); paint(); return; }
      budgets[name] = p.minor;
    }
    S.error = '';
    save({ budgets }); paintForm(); paint();
  }

  const del = id => { save({ entries: data().entries.filter(e => e.id !== id) }); paintForm(); paint(); };

  /* ---------------- drawing ---------------- */
  const dyn = h('div.life-dyn');

  function chart(sum) {
    const rows = sum.cats.filter(c => c.spent > 0 || c.budget);
    if (!rows.length) return h('p.life-note', { text: 'The chart appears once the month has spending or a budget.' });
    const top = Math.max(...rows.map(c => Math.max(c.spent, c.budget || 0)), 1);
    const pct = n => Math.round((n * 100) / top);
    return h('div.life-chart', { role: 'list', 'aria-label': 'Spending by category' }, rows.map(c => {
      const over = c.budget !== null && c.spent > c.budget;
      const label = `${c.cat}: spent ${fmt(c.spent)}${c.budget !== null ? ` of ${fmt(c.budget)} budget${over ? `, over by ${fmt(c.spent - c.budget)}` : `, ${fmt(c.left)} left`}` : ''}`;
      return h('div.life-chart__row', { role: 'listitem', 'data-cat': c.cat },
        h('span.life-chart__name', { text: c.cat }),
        h('div.life-chart__track', { role: 'img', 'aria-label': label },
          h('i', { class: over ? 'is-over' : '', style: { width: pct(c.spent) + '%' } }),
          c.budget !== null ? h('u', { style: { left: `min(${pct(c.budget)}%, calc(100% - 2px))` }, title: `Budget ${fmt(c.budget)}` }) : null),
        h('span.life-chart__val', { text: fmt(c.spent) }));
    }));
  }

  function budgetTable(sum, d) {
    const names = new Set(M.OUT_CATS);
    for (const c of sum.cats) names.add(c.cat);
    for (const e of d.entries) if (e.type === 'out') names.add(e.cat);
    for (const c of Object.keys(d.budgets)) names.add(c);
    const by = new Map(sum.cats.map(c => [c.cat, c]));
    return h('table.life-table',
      h('caption', { text: 'Monthly budget by category' }),
      h('thead', h('tr', ['Category', 'Spent', 'Budget', 'Left'].map(t => h('th', { scope: 'col', text: t })))),
      h('tbody', [...names].map(n => {
        const c = by.get(n) || { spent: 0, budget: d.budgets[n] || null, left: d.budgets[n] ? d.budgets[n] : null };
        const input = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': `Monthly budget for ${n}`, placeholder: 'none', autocomplete: 'off',
          value: d.budgets[n] ? M.plainMoney(d.budgets[n]) : '',
          onkeydown: e => { if (e.key === 'Enter') input.blur(); },
          onchange: () => setBudget(n, input.value) });
        return h('tr', { 'data-cat': n },
          h('th', { scope: 'row', text: n }),
          h('td', { text: fmt(c.spent) }),
          h('td', h('span.life-budget', h('span', { text: d.symbol }), input)),
          h('td', { class: c.left !== null && c.left < 0 ? 'is-over' : '', text: c.left === null ? '' : fmt(c.left) }));
      })));
  }

  function paint() {
    if (S.dead) return;
    const d = data();
    const sum = M.summarize(d.entries, d.budgets, S.month);
    const list = d.entries.filter(e => M.monthOf(e.date) === S.month).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300);
    dyn.replaceChildren(
      h('div.life-tiles',
        h('div.life-tile', h('small', { text: 'Income' }), h('b', { 'data-k': 'income', text: fmt(sum.income) })),
        h('div.life-tile', h('small', { text: 'Spent' }), h('b', { 'data-k': 'spent', text: fmt(sum.spent) })),
        h('div.life-tile', { class: sum.net < 0 ? 'is-over' : '' }, h('small', { text: 'Income minus spent' }), h('b', { 'data-k': 'net', text: fmt(sum.net) }))),
      h('h3', { text: 'Spending by category' }),
      chart(sum),
      budgetTable(sum, d),
      h('h3', { text: `Entries in ${monthLabel(S.month)}` }),
      list.length
        ? h('ul.life-entries', list.map(e => h('li', { 'data-id': e.id },
          h('span.life-entries__date', { text: e.date.slice(5) }),
          h('span.life-entries__cat', { text: e.cat }),
          h('span.life-entries__note', { text: e.note }),
          h('b', { class: e.type === 'in' ? 'is-in' : '', text: `${e.type === 'in' ? '+' : '-'}${M.formatMoney(e.amount, d.symbol)}` }),
          h('button.ibtn', { type: 'button', 'aria-label': `Delete ${e.type === 'in' ? 'income' : 'spending'} of ${fmt(e.amount)} in ${e.cat}`, onclick: () => del(e.id) }, icon('trash')))))
        : h('p.life-note', { text: 'No entries this month yet.' }));
    monthTitle.textContent = monthLabel(S.month);
  }

  const monthTitle = h('b.life-month', { 'aria-live': 'polite' });
  const nav = h('div.life-nav',
    h('button.ibtn', { type: 'button', 'aria-label': 'Previous month', onclick: () => { S.month = shiftMonth(S.month, -1); paint(); } }, icon('chevron-left')),
    monthTitle,
    h('button.ibtn', { type: 'button', 'aria-label': 'Next month', onclick: () => { S.month = shiftMonth(S.month, 1); paint(); } }, icon('chevron-right')));

  el.replaceChildren(
    h('div.life-head', h('div', h('h2', { text: 'Budget' }), h('small', { text: 'Kept on this device. A record of what you enter, not advice.' })),
      h('label.life-symbol', h('span', { text: 'Currency symbol' }), symIn),
      h('button.btn', { type: 'button', onclick: exportCsv }, icon('download'), h('span', { text: 'Export CSV' }))),
    h('div.life-card.life-form',
      h('div.life-form__row', h('div.tabs', { role: 'group', 'aria-label': 'Entry type' }, typeBtns), h('div.field', amount), h('div.field', cat), cats, h('div.field', date)),
      h('div.life-form__row', h('div.field.life-grow', note), h('button.btn.btn--primary', { type: 'button', onclick: add }, icon('plus'), h('span', { text: 'Add entry' }))),
      err),
    nav, dyn);
  paintForm(); paint();
  return () => { S.dead = true; };
}
