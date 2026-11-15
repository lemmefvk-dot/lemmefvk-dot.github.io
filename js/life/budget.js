/* ============================================================
   life/budget.js — the Budget tab: income and spending you type in,
   a month at a time, a budget for each spending category, a bar
   chart of the month and one of the last six months. All maths is in
   js/core/money.js (whole minor units, no floats).

   It is a record of what you enter and nothing more: no advice, no
   online lookups, no currency conversion. The page sends nothing
   anywhere; the only place the data goes is this browser's saved
   state and, when you press Export or Open in Sheets, a CSV file in
   Documents.

   · Repeating entries (weekly or monthly) are ordinary entries written
     on their day, while Budget is open, each date once. Nothing is
     added ahead of time, and an entry you delete stays deleted.
   · A savings goal counts the spending entries in the Savings
     category. The monthly figure beside it is plain division of what
     is left over the months up to the date you picked.
   · The six-month chart is Static Sheets' own chart code
     (js/sheets/chart.js), so it looks and reads like a Sheets chart;
     the cents behind it stay exact in the tiles and the table.
   · Import CSV reads a file with a Date and an Amount column (this
     tab's own export, or most bank exports), shows what it found and
     what it couldn't read, and adds nothing until you press Import.
     Rows that match an entry you already have are left out.

   Export: Date, Type, Category, Amount, Note. Amounts are unsigned
   decimals (Type says the direction), and any text cell that starts
   with = + - @ is prefixed with an apostrophe so a spreadsheet can't
   run it as a formula. Open in Sheets writes the same file and opens it.
   ============================================================ */
import * as M from '../core/money.js';
import { dayKey } from '../core/habits.js';
import { store } from '../core/store.js';
import * as CSV from '../sheets/csv.js';
import * as Chart from '../sheets/chart.js';
import { read, write, uid } from './data.js';

const monthLabel = m => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1, 12).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const shortMonth = m => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1, 12).toLocaleDateString(undefined, { month: 'short' });
const shiftMonth = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const dayLabel = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 12).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const daysBetween = (a, b) => Math.round((new Date(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10), 12) - new Date(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10), 12)) / 864e5);
const EVERY = { week: 'Every week', month: 'Every month' };
const MAX_RULES = 40;

export function mountBudget(el, ctx) {
  const api = ctx.api;
  const { h, icon, vfs, notify, confirm } = api;
  const S = { month: dayKey().slice(0, 7), type: 'out', error: '', dead: false, goalEdit: false, goalErr: '', imp: null };
  let today = dayKey();

  const data = () => {
    const m = read().money || {};
    return {
      entries: (Array.isArray(m.entries) ? m.entries : []).map(M.normEntry).filter(Boolean),
      budgets: Object.fromEntries(Object.entries(m.budgets && typeof m.budgets === 'object' ? m.budgets : {})
        .filter(([, v]) => Number.isSafeInteger(v) && v > 0 && v <= M.MAX_MINOR)),
      symbol: M.cleanSymbol(m.symbol),
      recurring: (Array.isArray(m.recurring) ? m.recurring : []).map(M.normRecurring).filter(Boolean),
      goal: M.normGoal(m.goal),
    };
  };
  const save = patch => write('money', { ...data(), ...patch });
  const fmt = n => M.formatMoney(n, data().symbol);

  /* repeating entries owed up to today are written now */
  function catchUp() {
    const d = data();
    if (!d.recurring.length) return 0;
    const r = M.dueEntries(d.recurring, today, () => uid('m'));
    if (!r.add.length) return 0;
    save({ entries: [...d.entries, ...r.add], recurring: r.rules });
    return r.add.length;
  }

  /* ---------------- the entry form (built once, so typing survives redraws) ---------------- */
  const amount = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Amount' });
  const cat = h('input', { type: 'text', list: 'life-cats', maxlength: '30', placeholder: 'Category', 'aria-label': 'Category', autocomplete: 'off' });
  const cats = h('datalist#life-cats');
  const date = h('input', { type: 'date', value: dayKey(), 'aria-label': 'Date' });
  const note = h('input', { type: 'text', maxlength: '120', placeholder: 'Note (optional)', 'aria-label': 'Note', autocomplete: 'off' });
  const repeat = h('select.life-select', { 'aria-label': 'Repeat' },
    h('option', { value: '', text: 'Doesn’t repeat' }), h('option', { value: 'week', text: 'Every week' }), h('option', { value: 'month', text: 'Every month' }));
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
    const d = data();
    if (repeat.value) {
      if (daysBetween(date.value, today) > 366) { S.error = 'A repeating entry can start at most a year ago.'; paintForm(); return; }
      if (d.recurring.length >= MAX_RULES) { S.error = `You can keep up to ${MAX_RULES} repeating entries.`; paintForm(); return; }
      const rule = M.normRecurring({ id: uid('rp'), type: S.type, cat: cat.value || 'Other', amount: a.minor, note: note.value, every: repeat.value, start: date.value, last: '' });
      save({ recurring: [...d.recurring, rule] });
      const n = catchUp();
      notify({ app: 'Static Life', icon: 'repeat', title: 'Repeating entry added',
        message: n ? `${n} ${n === 1 ? 'entry was' : 'entries were'} added, from ${dayLabel(rule.start)} to today. The next is on ${dayLabel(M.nextDate(rule, today))}.`
          : `The first is added on ${dayLabel(rule.start)}, while Budget is open on or after that day.` });
      repeat.value = '';
    } else {
      const entry = M.normEntry({ id: uid('m'), date: date.value, type: S.type, cat: cat.value || 'Other', amount: a.minor, note: note.value });
      save({ entries: [...d.entries, entry] });
    }
    S.month = M.monthOf(date.value);
    amount.value = ''; note.value = '';
    S.error = '';
    paintForm(); paint();
    amount.focus();
  }
  for (const i of [amount, cat, date, note]) i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  /* ---------------- export, and the month in Sheets ---------------- */
  function writeMonth() {
    const rows = data().entries.filter(e => M.monthOf(e.date) === S.month);
    if (!rows.length) { notify({ app: 'Static Life', icon: 'download', title: 'Nothing to export', message: `No entries in ${monthLabel(S.month)}.` }); return null; }
    const dir = `${vfs.HOME}/Documents`;
    if (!vfs.node(dir)) vfs.mkdir(dir);
    let name = `budget-${S.month}.csv`, k = 1;
    while (vfs.node(`${dir}/${name}`)) name = `budget-${S.month} (${++k}).csv`;
    vfs.write(`${dir}/${name}`, M.toCsv(rows));
    return { dir, name, path: `${dir}/${name}`, n: rows.length };
  }
  function exportCsv() {
    const f = writeMonth();
    if (!f) return;
    notify({ app: 'Static Life', icon: 'download', title: 'Exported', message: `${f.name} is in Documents (${f.n} ${f.n === 1 ? 'entry' : 'entries'}).`,
      actions: [{ label: 'Open in Files', onClick: () => api.openApp('files', { path: f.dir }) }, { label: 'Open in Sheets', onClick: () => api.openApp('sheets', { path: f.path }) }] });
  }
  function openInSheets() {
    const f = writeMonth();
    if (f) api.openApp('sheets', { path: f.path });
  }

  /* ---------------- import ---------------- */
  const fileIn = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', hidden: true, 'aria-label': 'Choose a CSV file to import' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { S.imp = { name: f.name, error: 'That file is over 5 MB, which is more than a budget export.' }; paint(); return; }
    let text = '';
    try { text = await f.text(); } catch (e) { S.imp = { name: f.name, error: 'The browser couldn’t read that file.' }; paint(); return; }
    if (S.dead) return;
    const r = M.fromRows(CSV.parse(text, CSV.sniff(text, f.name)));
    const have = data().entries;
    const fresh = [], dup = [];
    for (const e of r.entries) (have.some(x => M.sameEntry(x, e)) || fresh.some(x => M.sameEntry(x, e)) ? dup : fresh).push(e);
    S.imp = { name: f.name, error: r.error || '', fresh, dup: dup.length, skipped: r.skipped };
    paint();
  });
  function doImport() {
    const imp = S.imp;
    if (!imp || !imp.fresh.length) return;
    const d = data();
    const add = imp.fresh.map(e => ({ ...e, id: uid('m') }));
    save({ entries: [...d.entries, ...add] });
    const months = [...new Set(add.map(e => M.monthOf(e.date)))].sort();
    S.month = months[months.length - 1];
    S.imp = null;
    notify({ app: 'Static Life', icon: 'upload', title: 'Imported', message: `${add.length} ${add.length === 1 ? 'entry' : 'entries'} from ${imp.name}${months.length > 1 ? `, across ${months.length} months` : ''}.` });
    paintForm(); paint();
  }
  function importPanel() {
    const imp = S.imp;
    if (!imp) return null;
    const close = h('button.btn.btn--ghost', { type: 'button', onclick: () => { S.imp = null; paint(); } }, h('span', { text: imp.error ? 'Close' : 'Cancel' }));
    if (imp.error) return h('section.life-card.life-import', { 'aria-label': 'Import' }, h('b', { text: imp.name }), h('p.life-err', { role: 'alert', text: imp.error }), close);
    const sum = (list, t) => M.sumMoney(list.filter(e => e.type === t).map(e => e.amount));
    return h('section.life-card.life-import', { 'aria-label': 'Import' },
      h('b', { text: `From ${imp.name}` }),
      h('p.life-note', { 'data-k': 'import-sum', text: `${imp.fresh.length} ${imp.fresh.length === 1 ? 'entry' : 'entries'} to add: ${fmt(sum(imp.fresh, 'in'))} income and ${fmt(sum(imp.fresh, 'out'))} spending.`
        + (imp.dup ? ` ${imp.dup} ${imp.dup === 1 ? 'row matches an entry' : 'rows match entries'} you already have and ${imp.dup === 1 ? 'is' : 'are'} left out.` : '')
        + (imp.skipped.length ? ` ${imp.skipped.length} ${imp.skipped.length === 1 ? 'row' : 'rows'} couldn’t be read:` : '') }),
      imp.skipped.length ? h('ul.life-skipped', imp.skipped.slice(0, 8).map(s => h('li', { text: `Line ${s.line}: ${s.why}.` })),
        imp.skipped.length > 8 ? h('li', { text: `and ${imp.skipped.length - 8} more.` }) : null) : null,
      h('div.life-form__row',
        h('button.btn.btn--primary', { type: 'button', 'data-act': 'import', disabled: !imp.fresh.length, onclick: doImport }, icon('upload'), h('span', { text: `Import ${imp.fresh.length} ${imp.fresh.length === 1 ? 'entry' : 'entries'}` })),
        close));
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

  /* ---------------- savings goal ---------------- */
  function goalCard(d) {
    const g = d.goal;
    if (S.goalEdit || !g) {
      if (!S.goalEdit) return h('div.life-form__row', h('button.btn', { type: 'button', 'data-act': 'goal', onclick: () => { S.goalEdit = true; S.goalErr = ''; paint(); } }, icon('star'), h('span', { text: 'Set a savings goal' })),
        h('small.life-note', { text: 'It counts your spending entries in the Savings category.' }));
      const name = h('input', { type: 'text', maxlength: '40', value: g ? g.name : '', placeholder: 'What it’s for, e.g. New bike', 'aria-label': 'Goal name' });
      const target = h('input', { type: 'text', inputmode: 'decimal', value: g ? M.plainMoney(g.target) : '', placeholder: '0.00', 'aria-label': 'Goal amount' });
      const by = h('input', { type: 'month', value: g ? g.by : '', 'aria-label': 'Reach it by (optional)' });
      const ok = () => {
        const t = M.parseMoney(target.value);
        if (!t.ok || t.minor === 0) { S.goalErr = t.ok ? 'A goal of zero isn’t a goal.' : t.why; paint(); return; }
        if (by.value && by.value < today.slice(0, 7)) { S.goalErr = 'Pick this month or a later one, or leave the date empty.'; paint(); return; }
        save({ goal: M.normGoal({ name: name.value, target: t.minor, by: by.value }) });
        S.goalEdit = false; S.goalErr = ''; paint();
      };
      return h('section.life-card.life-goalform', { 'aria-label': 'Savings goal' },
        h('div.life-form__row', h('div.field.life-grow', name), h('div.field', target), h('label.life-symbol', h('span', { text: 'By' }), by)),
        h('p.life-err', { role: 'alert', text: S.goalErr }),
        h('div.life-form__row', h('button.btn.btn--primary', { type: 'button', 'data-act': 'goal-save', onclick: ok }, icon('check'), h('span', { text: 'Save goal' })),
          h('button.btn.btn--ghost', { type: 'button', onclick: () => { S.goalEdit = false; S.goalErr = ''; paint(); } }, h('span', { text: 'Cancel' }))));
    }
    const p = M.goalProgress(d.entries, g, today.slice(0, 7));
    const byText = g.by ? monthLabel(g.by) : '';
    const line = p.done ? `Reached: ${fmt(p.saved)} saved toward ${fmt(g.target)}.`
      : `${fmt(p.saved)} of ${fmt(g.target)} saved (${p.pct}%). ${fmt(p.left)} to go.`;
    const pace = p.done || !g.by ? '' : p.perMonth !== null ? `That is ${fmt(p.perMonth)} a month over the ${p.months} ${p.months === 1 ? 'month' : 'months'} to ${byText}, this one included.` : `${byText} has passed.`;
    return h('section.life-card.life-goal', { 'aria-label': 'Savings goal' },
      h('div.life-goal__top', h('b', { text: g.name }), h('span', { text: byText ? `by ${byText}` : '' }),
        h('div.life-head__act',
          h('button.ibtn', { type: 'button', 'aria-label': 'Edit the savings goal', onclick: () => { S.goalEdit = true; S.goalErr = ''; paint(); } }, icon('edit-3')),
          h('button.ibtn', { type: 'button', 'aria-label': 'Remove the savings goal', onclick: async () => {
            if (!(await confirm({ title: 'Remove the savings goal?', message: 'Your Savings entries stay; only the goal goes.', ok: 'Remove', danger: true })) || S.dead) return;
            save({ goal: null }); paint();
          } }, icon('trash')))),
      h('div.bar.life-goal__bar', { role: 'progressbar', 'aria-label': `${g.name}: saved so far`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.pct), 'aria-valuetext': line },
        h('i', { style: { width: p.pct + '%' } })),
      h('p.life-note', { 'data-k': 'goal', text: line }),
      pace ? h('p.life-note', { 'data-k': 'goal-pace', text: pace }) : null,
      h('small.life-note', { text: 'Counts every spending entry in the Savings category, in every month.' }));
  }

  /* ---------------- repeating entries ---------------- */
  function rulesList(d) {
    if (!d.recurring.length) return null;
    return h('section.life-rules', { 'aria-label': 'Repeating entries' },
      h('h3', { text: 'Repeating entries' }),
      h('ul.life-entries', d.recurring.map(r => h('li', { 'data-rule': r.id },
        h('span.life-entries__date', { text: r.every === 'week' ? 'Weekly' : 'Monthly' }),
        h('span.life-entries__cat', { text: r.cat }),
        h('span.life-entries__note', { text: `Next on ${dayLabel(M.nextDate(r, today))}${r.note ? ' · ' + r.note : ''}` }),
        h('b', { class: r.type === 'in' ? 'is-in' : '', text: `${r.type === 'in' ? '+' : '-'}${M.formatMoney(r.amount, d.symbol)}` }),
        h('button.ibtn', { type: 'button', 'aria-label': `Stop repeating ${r.cat} ${M.formatMoney(r.amount, d.symbol)} ${EVERY[r.every].toLowerCase()}`, title: 'Stop repeating (entries already added stay)',
          onclick: () => { save({ recurring: data().recurring.filter(x => x.id !== r.id) }); paint(); } }, icon('x'))))),
      h('small.life-note', { text: 'Each is added on its day while Budget is open, never ahead of time. Stopping one keeps the entries it already added.' }));
  }

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

  /* the last six months, income beside spending, drawn by Sheets' chart code */
  const trend = h('canvas.life-trend', { role: 'img', 'aria-label': 'Income and spending, last 6 months' });
  function drawTrend() {
    if (S.dead || !trend.isConnected) return;
    const d = data();
    const series = M.monthSeries(d.entries, S.month, 6);
    const spec = { type: 'bar', title: '', data: { labels: series.map(x => shortMonth(x.month)),
      series: [{ name: 'Income', values: series.map(x => x.income / 100) }, { name: 'Spent', values: series.map(x => x.spent / 100) }] } };
    const w = Math.max(80, trend.clientWidth || 400), hh = Math.max(80, trend.clientHeight || 180);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (trend.width !== Math.round(w * dpr) || trend.height !== Math.round(hh * dpr)) { trend.width = Math.round(w * dpr); trend.height = Math.round(hh * dpr); }
    const g = trend.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    Chart.drawChart(g, w, hh, spec, Chart.readTheme(el));
    trend.setAttribute('aria-label', 'Income and spending, last 6 months. ' + series.map(x => `${monthLabel(x.month)}: income ${fmt(x.income)}, spent ${fmt(x.spent)}`).join('; ') + '.');
    trend.dataset.months = series.map(x => `${x.month}:${x.income}:${x.spent}`).join(',');
  }
  const ro = new ResizeObserver(() => requestAnimationFrame(drawTrend));
  ro.observe(trend);
  const unTheme = store.sub('prefs.theme', () => requestAnimationFrame(drawTrend));

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
    impBox.replaceChildren(...[importPanel()].filter(Boolean));
    dyn.replaceChildren(
      h('div.life-tiles',
        h('div.life-tile', h('small', { text: 'Income' }), h('b', { 'data-k': 'income', text: fmt(sum.income) })),
        h('div.life-tile', h('small', { text: 'Spent' }), h('b', { 'data-k': 'spent', text: fmt(sum.spent) })),
        h('div.life-tile', { class: sum.net < 0 ? 'is-over' : '' }, h('small', { text: 'Income minus spent' }), h('b', { 'data-k': 'net', text: fmt(sum.net) }))),
      goalCard(d),
      h('h3', { text: 'Spending by category' }),
      chart(sum),
      budgetTable(sum, d),
      h('h3', { text: `Six months to ${monthLabel(S.month)}` }),
      h('div.life-trendbox', trend),
      rulesList(d),
      h('h3', { text: `Entries in ${monthLabel(S.month)}` }),
      list.length
        ? h('ul.life-entries', list.map(e => h('li', { 'data-id': e.id },
          h('span.life-entries__date', { text: e.date.slice(5) }),
          h('span.life-entries__cat', { text: e.cat }),
          h('span.life-entries__note', { text: e.rec ? `${e.note}${e.note ? ' · ' : ''}repeating` : e.note }),
          h('b', { class: e.type === 'in' ? 'is-in' : '', text: `${e.type === 'in' ? '+' : '-'}${M.formatMoney(e.amount, d.symbol)}` }),
          h('button.ibtn', { type: 'button', 'aria-label': `Delete ${e.type === 'in' ? 'income' : 'spending'} of ${fmt(e.amount)} in ${e.cat}`, onclick: () => del(e.id) }, icon('trash')))))
        : h('p.life-note', { text: 'No entries this month yet.' }));
    monthTitle.textContent = monthLabel(S.month);
    requestAnimationFrame(drawTrend);
  }

  const monthTitle = h('b.life-month', { 'aria-live': 'polite' });
  const nav = h('div.life-nav',
    h('button.ibtn', { type: 'button', 'aria-label': 'Previous month', onclick: () => { S.month = shiftMonth(S.month, -1); paint(); } }, icon('chevron-left')),
    monthTitle,
    h('button.ibtn', { type: 'button', 'aria-label': 'Next month', onclick: () => { S.month = shiftMonth(S.month, 1); paint(); } }, icon('chevron-right')));
  const impBox = h('div.life-impbox');

  el.replaceChildren(
    h('div.life-head', h('div', h('h2', { text: 'Budget' }), h('small', { text: 'Kept on this device. A record of what you enter, not advice.' })),
      h('label.life-symbol', h('span', { text: 'Currency symbol' }), symIn),
      h('div.life-head__act',
        h('button.btn', { type: 'button', onclick: () => fileIn.click() }, icon('upload'), h('span', { text: 'Import CSV' })), fileIn,
        h('button.btn', { type: 'button', onclick: exportCsv }, icon('download'), h('span', { text: 'Export CSV' })),
        h('button.btn', { type: 'button', 'data-act': 'sheets', title: 'Writes this month as a CSV in Documents and opens it in Static Sheets', onclick: openInSheets }, icon('grid'), h('span', { text: 'Open in Sheets' })))),
    h('div.life-card.life-form',
      h('div.life-form__row', h('div.tabs', { role: 'group', 'aria-label': 'Entry type' }, typeBtns), h('div.field', amount), h('div.field', cat), cats, h('div.field', date)),
      h('div.life-form__row', h('div.field.life-grow', note), repeat, h('button.btn.btn--primary', { type: 'button', onclick: add }, icon('plus'), h('span', { text: 'Add entry' }))),
      err),
    impBox, nav, dyn);
  catchUp();
  paintForm(); paint();

  /* the day changes under an open window: owed repeating entries are written */
  const iv = setInterval(() => { const k = dayKey(); if (k !== today) { today = k; if (catchUp()) paint(); } }, 30000);
  const vis = () => { if (document.visibilityState === 'visible') { const k = dayKey(); if (k !== today) { today = k; if (catchUp()) paint(); } } };
  document.addEventListener('visibilitychange', vis);
  return () => { S.dead = true; clearInterval(iv); document.removeEventListener('visibilitychange', vis); ro.disconnect(); unTheme(); };
}
