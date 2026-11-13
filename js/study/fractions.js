/* ============================================================
   study/fractions.js — the Fractions tab of Static Study.

   Two numbers and an operation (or one number to simplify): the answer
   in lowest terms, as a mixed number and as an exact decimal, with the
   working one real step at a time (common denominator, combining,
   simplifying). The arithmetic is exact BigInt in js/core/fractions.js;
   what you type is read by a small parser and never evaluated.

   Here it is only the form and the display. A fraction can be typed as
   3/4, a mixed number as 2 3/4, a decimal as 0.75.
   ============================================================ */
import * as FR from '../core/fractions.js';

const OPS = [['+', 'Add  +'], ['-', 'Subtract  −'], ['*', 'Multiply  ×'], ['/', 'Divide  ÷']];
const EXAMPLES = [['3/4', '+', '5/6'], ['2 1/2', '*', '1 1/3'], ['7/8', '-', '1/6'], ['3/5', '/', '9/10'], ['0.1', '+', '0.2'], ['18/24', '', ''], ['1/2', '/', '0']];
const draft = { a: '', op: '+', b: '' };

export function mountFractions(host, ctx) {
  const { api } = ctx;
  const { h, icon } = api;
  const S = { res: null };
  const field = (key, label, ph) => {
    const el = h('input.st-in.st-fr__in', { type: 'text', maxlength: String(FR.MAX_INPUT), spellcheck: 'false', autocomplete: 'off', placeholder: ph, 'aria-label': label, dataset: { fk: `fr-${key}` }, oninput: e => { draft[key] = e.target.value; } });
    el.value = draft[key];
    return el;
  };
  const a = field('a', 'First number', 'e.g. 3/4 or 2 1/2');
  const b = field('b', 'Second number', 'e.g. 5/6');
  const op = h('select.select.st-sel.st-fr__op', { 'aria-label': 'Operation', dataset: { fk: 'fr-op' }, onchange: e => { draft.op = e.target.value; } },
    OPS.map(([v, l]) => h('option', { value: v, text: l, selected: v === draft.op })), h('option', { value: '', text: 'Just simplify the first', selected: draft.op === '' }));
  const out = h('div.st-eq__out', { dataset: { fk: 'fr-out' }, 'aria-live': 'polite' });
  const lines = t => String(t || '').split('\n').filter(Boolean).map(x => h('div.st-eq__math', { text: x }));

  function run() {
    draft.op = op.value;
    S.res = FR.calc(a.value, op.value, op.value ? b.value : '');
    paint();
  }
  function paint() {
    out.replaceChildren();
    const r = S.res;
    if (!r) { out.append(h('p.st-note', { text: 'Type a fraction like 3/4, a mixed number like 2 1/2, a whole number or a decimal. The answer is exact, with no rounding, and each step of the working is shown. Numbers can have up to ' + FR.MAX_DIGITS + ' digits.' })); return; }
    if (!r.ok) { out.append(h('div.st-issue', { role: 'alert', dataset: { fk: 'fr-error' } }, icon('alert'), h('span', { text: r.error }))); return; }
    const an = r.answer;
    out.append(
      h('div.st-eq__answer', { dataset: { fk: 'fr-answer' } },
        h('small', { text: 'Answer, in lowest terms' }),
        h('b', { dataset: { fk: 'fr-answer-text' }, text: an.text }),
        an.mixed !== an.text ? h('span', { dataset: { fk: 'fr-mixed' }, text: `As a mixed number: ${an.mixed}` }) : null,
        h('span', { dataset: { fk: 'fr-decimal' }, text: an.decimal.includes('(') ? `As a decimal: ${an.decimal} (the digits in brackets repeat forever)` : `As a decimal: ${an.decimal}` })),
      h('div.side__label', { text: 'Working' }),
      h('ol.st-eq__steps', { dataset: { fk: 'fr-steps' } }, r.steps.map((s, i) => h('li', { dataset: { fk: 'fr-step', i } }, h('p', { text: s.say }), ...lines(s.math)))));
  }
  const form = h('form.st-row.st-eq__form', { onsubmit: e => { e.preventDefault(); run(); } }, a, op, b,
    h('button.btn.btn--primary', { type: 'submit', dataset: { fk: 'fr-go' } }, icon('check'), h('span', { text: 'Work it out' })));
  const ex = h('div.st-eq__ex', { role: 'group', 'aria-label': 'Examples' }, h('small.dim', { text: 'Try:' }),
    EXAMPLES.map(([x, o, y]) => h('button.st-chip', { type: 'button', dataset: { fk: 'fr-example' }, onclick: () => {
      a.value = draft.a = x; b.value = draft.b = y; op.value = draft.op = o; run(); a.focus({ preventScroll: true });
    } }, h('span', { text: o ? `${x} ${o === '*' ? '×' : o === '/' ? '÷' : o === '-' ? '−' : o} ${y}` : `simplify ${x}` }))));
  host.appendChild(h('div.st-eq', h('div.app__content.st-scroll.st-quiz__pane', h('div.app__title', { text: 'Fraction calculator' }), form, ex, out)));
  paint();
  if (draft.a.trim()) run();
  return { open() {}, teardown() {} };
}
