/* ============================================================
   study/equations.js — the Equations tab of Static Study.

   Type a linear or quadratic equation the way you'd write it
   ("3x + 5 = 2x - 7", "x^2 - 5x + 6 = 0") and get the working, one
   step at a time, then the answer, then the answer put back into the
   original equation to prove it. The maths and the parser are in
   js/core/equation.js (a real parser; the text is never evaluated).
   Here it is only the form and the display.
   ============================================================ */
import { solveEquation } from '../core/equation.js';

const EXAMPLES = ['3x + 5 = 2x - 7', '2(x + 1) = x/2 + 4', 'x^2 - 5x + 6 = 0', 'x^2 - 3x + 1 = 0', 'x^2 + 2x + 5 = 0', '2x + 3 = 2x - 1'];
const TYPE_LABEL = { linear: 'A linear equation', quadratic: 'A quadratic equation', none: 'No solution', all: 'Infinitely many solutions' };
let draft = '';

export function mountEquations(host, ctx) {
  const { api } = ctx;
  const { h, icon } = api;
  const S = { res: null, ran: '' };
  const input = h('input.st-in.st-eq__in', { type: 'text', maxlength: '200', spellcheck: 'false', autocomplete: 'off', placeholder: 'Type an equation, e.g. 3x + 5 = 2x − 7', 'aria-label': 'Equation to solve', dataset: { fk: 'eq-input' }, oninput: e => { draft = e.target.value; } });
  input.value = draft;
  const out = h('div.st-eq__out', { dataset: { fk: 'eq-out' }, 'aria-live': 'polite' });
  const lines = x => [].concat(x || []).map(t => h('div.st-eq__math', { text: t }));

  function solve(text) {
    S.ran = text;
    S.res = solveEquation(text);
    paint();
  }
  function paint() {
    out.replaceChildren();
    const r = S.res;
    if (!r) { out.append(h('p.st-note', { text: 'Linear (like 3x + 5 = 2x − 7) and quadratic (like x² − 5x + 6 = 0) equations in one letter. Use ^ for powers, / for fractions and brackets freely: 2(x + 1) means 2 times (x + 1).' })); return; }
    if (!r.ok) {
      out.append(h('div.st-issue', { role: 'alert', dataset: { fk: 'eq-error' } }, icon('alert'), h('span', { text: r.error })));
      return;
    }
    out.append(
      h('div.st-eq__answer', { dataset: { fk: 'eq-answer', type: r.type } },
        h('small', { text: TYPE_LABEL[r.type] }), r.answer.lines.map(t => h('b', { text: t }))),
      h('div.side__label', { text: 'Working' }),
      h('ol.st-eq__steps', { dataset: { fk: 'eq-steps' } }, r.steps.map((s, i) => h('li', { dataset: { fk: 'eq-step', i } }, h('p', { text: s.say }), ...lines(s.eq)))),
      h('div.side__label', { text: 'Check by substituting back' }),
      h('div.st-eq__check', { dataset: { fk: 'eq-check' } },
        r.check.map(s => h('div', h('p', { text: s.say }), ...lines(s.eq))),
        h('p.st-eq__verdict', { class: r.verified ? 'is-ok' : 'is-bad', dataset: { fk: 'eq-verdict' } }, icon(r.verified ? 'check' : 'alert'), h('span', { text: r.verified ? 'Verified: every solution makes both sides equal.' : 'The check failed.' }))));
  }
  const form = h('form.st-row.st-eq__form', { onsubmit: e => { e.preventDefault(); solve(input.value); } }, input,
    h('button.btn.btn--primary', { type: 'submit', dataset: { fk: 'eq-solve' } }, icon('check'), h('span', { text: 'Solve' })));
  const ex = h('div.st-eq__ex', { role: 'group', 'aria-label': 'Examples' }, h('small.dim', { text: 'Try:' }),
    EXAMPLES.map(t => h('button.st-chip', { type: 'button', dataset: { fk: 'eq-example' }, onclick: () => { input.value = t; draft = t; solve(t); input.focus({ preventScroll: true }); } }, h('span', { text: t }))));
  host.appendChild(h('div.st-eq', h('div.app__content.st-scroll.st-quiz__pane', h('div.app__title', { text: 'Equation solver' }), form, ex, out)));
  paint();
  if (draft.trim()) solve(draft);
  return { open() {}, teardown() {} };
}
