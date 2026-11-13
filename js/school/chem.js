/* ============================================================
   school/chem.js — the Formulas tab of the Periodic Table app.

   Two calculators over js/core/chem.js, using the same
   data/elements.json (PubChem atomic masses) the table shows:
     · Molar mass of a formula, with a row per element;
     · Balance an equation, with the atom count checked on both sides.
   It is arithmetic on whatever formula is typed. It says nothing
   about what a substance is for and gives no procedures. All typed
   text is shown as text.
   ============================================================ */
import { makeTable, molarMass, balance } from '../core/chem.js';
import { h } from '../core/dom.js';

const MASS_EXAMPLES = ['H2O', 'Ca(OH)2', 'CuSO4·5H2O', 'Al2(SO4)3', 'K4[Fe(CN)6]', 'C6H12O6'];
const EQ_EXAMPLES = ['H2 + O2 -> H2O', 'C3H8 + O2 -> CO2 + H2O', 'Fe + O2 -> Fe2O3', 'KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O', 'Cu + Ag^+ -> Cu^2+ + Ag', 'CH4 + O2 -> CO2 + H2O + H2'];

const CSS = `
.pf{flex:1;min-height:0;overflow:auto;padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-4);color:var(--ink-1);font-size:var(--fs-13)}
.pf *{box-sizing:border-box}
.pf__modes{display:flex;gap:var(--sp-2)}
.pf__modes button{height:28px;padding:0 var(--sp-4);border-radius:var(--r-pill);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit}
.pf__modes button[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.pf__form{display:flex;gap:var(--sp-3);flex-wrap:wrap}
.pf__in{flex:1 1 260px;min-width:160px;height:34px;padding:0 var(--sp-4);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit;font-size:var(--fs-15)}
.pf__in:focus{outline:2px solid var(--accent);outline-offset:1px}
.pf__go{height:34px;padding:0 var(--sp-5);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-2);color:var(--ink-0);font:inherit;font-weight:600;cursor:pointer}
.pf__go:hover{background:var(--fill-3)}
.pf__ex{display:flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center}
.pf__ex button{height:24px;padding:0 var(--sp-3);border-radius:var(--r-pill);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit;font-size:var(--fs-12);cursor:pointer}
.pf__ex button:hover{background:var(--fill-2)}
.pf__err{display:flex;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-radius:var(--r-md);border:1px solid rgba(255,80,100,.45);background:rgba(255,80,100,.08);color:var(--ink-0);line-height:1.5}
.pf__big{padding:var(--sp-4);border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font-size:var(--fs-18);font-weight:650;overflow-wrap:anywhere;line-height:1.6}
.pf__big small{display:block;font-size:var(--fs-11);color:var(--ink-3);font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.pf table{border-collapse:collapse;width:100%;max-width:640px;font-variant-numeric:tabular-nums}
.pf th,.pf td{text-align:right;padding:4px var(--sp-3);border-bottom:1px solid var(--line-1)}
.pf th:first-child,.pf td:first-child{text-align:left}
.pf th{color:var(--ink-3);font-weight:600;font-size:var(--fs-11);text-transform:uppercase;letter-spacing:.06em}
.pf tfoot td{font-weight:700;color:var(--ink-0)}
.pf__ok{color:#3fb97a}
.pf__bad{color:#ff5a6e}
.pf__note{margin:0;color:var(--ink-2);font-size:var(--fs-12);line-height:1.5;max-width:75ch}
.pf ul{margin:0;padding-left:var(--sp-6);display:flex;flex-direction:column;gap:var(--sp-2)}
.pf h3{margin:0;font-size:var(--fs-12);color:var(--ink-3);text-transform:uppercase;letter-spacing:.08em}
`;

/** Text with the digits after an element or bracket as subscripts and ^charges as superscripts, built as nodes, never HTML. */
export function formulaNodes(text) {
  const out = [];
  const s = String(text);
  let buf = '';
  const flush = () => { if (buf) { out.push(document.createTextNode(buf)); buf = ''; } };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= '0' && c <= '9' && i > 0 && /[A-Za-z)\]}]/.test(s[i - 1])) {
      let j = i; while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
      flush(); out.push(h('sub', { text: s.slice(i, j) })); i = j - 1;
    } else if (c === '^') {
      let j = i + 1; while (j < s.length && /[0-9+-]/.test(s[j])) j++;
      flush(); out.push(h('sup', { text: s.slice(i + 1, j) })); i = j - 1;
    } else buf += c;
  }
  flush();
  return out;
}

const sig = (n, d = 10) => String(Number(n.toPrecision(d)));

export function mountChem(host, { elements }) {
  const table = makeTable(elements);
  const S = { mode: 'mass', mass: '', balance: '' };
  const out = h('div', { 'aria-live': 'polite', dataset: { fk: 'chem-out' } });
  const modes = h('div.pf__modes', { role: 'group', 'aria-label': 'Formula tools' });
  const form = h('form.pf__form');
  const ex = h('div.pf__ex', { role: 'group', 'aria-label': 'Examples' });
  const input = h('input.pf__in', { type: 'text', maxlength: '400', autocomplete: 'off', spellcheck: 'false', dataset: { fk: 'chem-input' }, oninput: e => { S[S.mode] = e.target.value; if (S.mode === 'mass') run(); } });
  const go = h('button.pf__go', { type: 'submit', dataset: { fk: 'chem-go' } });
  form.append(input, go);
  form.onsubmit = e => { e.preventDefault(); run(); };
  const el = h('div.pf', h('style', { text: CSS }), modes, form, ex, out,
    h('p.pf__note', { text: 'This only does arithmetic on the formula you type, using the atomic masses in the periodic table data (PubChem). It is a homework helper, not a guide to making or handling anything.' }));
  host.appendChild(el);

  function paintChrome() {
    modes.replaceChildren(...[['mass', 'Molar mass'], ['balance', 'Balance an equation']].map(([k, t]) =>
      h('button', { type: 'button', 'aria-pressed': String(S.mode === k), dataset: { fk: `chem-mode-${k}` }, onclick: () => { S.mode = k; paintChrome(); run(); input.focus({ preventScroll: true }); } }, h('span', { text: t }))));
    const mass = S.mode === 'mass';
    input.value = S[S.mode];
    input.placeholder = mass ? 'A formula, e.g. Ca(OH)2 or CuSO4·5H2O' : 'An equation, e.g. H2 + O2 -> H2O';
    input.setAttribute('aria-label', mass ? 'Formula' : 'Equation to balance');
    go.textContent = mass ? 'Calculate' : 'Balance';
    ex.replaceChildren(h('small', { text: 'Try:' }), ...(mass ? MASS_EXAMPLES : EQ_EXAMPLES).map(t =>
      h('button', { type: 'button', dataset: { fk: 'chem-example' }, onclick: () => { input.value = t; S[S.mode] = t; run(); } }, formulaNodes(t))));
    ex.append(h('small', { text: mass ? 'Hydrates: use · or . before the water (the number in front multiplies it). Charges: Fe^3+.' : 'Separate substances with +, put an arrow (->) between the sides. Ions: Cu^2+, SO4^2-.' }));
  }

  const err = msg => h('div.pf__err', { role: 'alert', dataset: { fk: 'chem-error' } }, h('span', { text: msg }));

  function runMass() {
    const text = S.mass.trim();
    if (!text) return h('p.pf__note', { text: 'Type a formula to see its molar mass and what each element contributes.' });
    const m = molarMass(text, table);
    if (!m.ok) return err(m.error);
    return h('div', { dataset: { fk: 'chem-mass', total: m.total.toFixed(3) } },
      h('div.pf__big', h('small', { text: 'Molar mass' }), h('span', formulaNodes(m.text)), h('span', { text: ` = ${m.total.toFixed(3)} g/mol` })),
      h('table', { 'aria-label': 'Breakdown by element' },
        h('thead', h('tr', ['Element', 'Atoms', 'Atomic mass (u)', 'Subtotal (g/mol)', 'Share'].map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', m.rows.map(r => h('tr', { dataset: { fk: 'chem-row', sym: r.sym, count: r.count } },
          h('td', { text: `${r.name} (${r.sym})` }), h('td', { text: String(r.count) }), h('td', { text: sig(r.mass) }), h('td', { text: r.subtotal.toFixed(3) }), h('td', { text: `${r.percent.toFixed(2)}%` })))),
        h('tfoot', h('tr', h('td', { text: 'Total' }), h('td', { text: String(m.rows.reduce((t, r) => t + r.count, 0)) }), h('td'), h('td', { text: m.total.toFixed(3) }), h('td', { text: '100%' })))),
      m.charge ? h('p.pf__note', { text: `The ion’s charge (${m.charge > 0 ? '+' : ''}${m.charge}) is not counted: the mass of the electrons gained or lost is far below the precision shown.` }) : null);
  }

  const checkTable = checks => h('table', { 'aria-label': 'Atom count on each side' },
    h('thead', h('tr', ['Atom', 'Reactants', 'Products', 'Check'].map(t => h('th', { scope: 'col', text: t })))),
    h('tbody', checks.map(c => h('tr', { dataset: { fk: 'chem-check', sym: c.sym, left: c.left, right: c.right } },
      h('td', { text: c.sym }), h('td', { text: String(c.left) }), h('td', { text: String(c.right) }),
      h('td', { class: c.left === c.right ? 'pf__ok' : 'pf__bad', text: c.left === c.right ? 'equal' : 'differ' })))));

  function runBalance() {
    const text = S.balance.trim();
    if (!text) return h('p.pf__note', { text: 'Type an equation to balance it with whole-number coefficients.' });
    const b = balance(text, table);
    if (!b.ok) return err(b.error);
    const kids = [];
    if (b.ignored && b.ignored.length) kids.push(h('p.pf__note', { dataset: { fk: 'chem-ignored' }, text: `I ignored the numbers you typed in front (${b.ignored.join(', ')}) and worked them out from scratch.` }));
    if (b.kind === 'unique') {
      kids.push(h('div.pf__big', { dataset: { fk: 'chem-balanced', text: b.text, coefs: b.coefs.join(',') } }, h('small', { text: 'Balanced' }), h('span', formulaNodes(b.text))),
        h('h3', { text: 'Check: atoms on each side' }), checkTable(b.checks),
        h('p.pf__note', { text: 'These are the smallest whole numbers that work, found by exact row reduction (no rounding).' }));
    } else {
      kids.push(h('div.pf__err', { role: 'status', dataset: { fk: 'chem-many', count: b.count } },
        h('span', { text: `These substances can react in ${b.count} independent ways, so there is no single balanced equation: any mix of the reactions below balances. To get one answer, leave out the substances that aren’t part of the reaction you mean.` })),
        h('h3', { text: 'Independent balanced reactions' }),
        h('ul', { dataset: { fk: 'chem-reactions' } }, b.reactions.map(r => h('li', formulaNodes(r)))));
      if (b.example) kids.push(h('h3', { text: 'One of the many ways to balance everything you typed' }), h('div.pf__big', { dataset: { fk: 'chem-example-balance', text: b.example.text } }, h('span', formulaNodes(b.example.text))), checkTable(b.example.checks));
      else kids.push(h('p.pf__note', { text: 'Using every substance at once needs larger numbers than I search; pick the ones that react.' }));
    }
    return h('div', ...kids);
  }

  function run() { out.replaceChildren(S.mode === 'mass' ? runMass() : runBalance()); }
  paintChrome();
  run();
  return { focus: () => input.focus({ preventScroll: true }), teardown() {} };
}
