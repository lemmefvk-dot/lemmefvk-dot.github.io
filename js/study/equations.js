/* ============================================================
   study/equations.js — the Equations tab of Static Study.

   Type a linear or quadratic equation the way you'd write it
   ("3x + 5 = 2x - 7", "x^2 - 5x + 6 = 0"), a linear inequality
   ("2x − 1 < 5", "−3x + 4 ≥ 10") or, in Two equations, a pair of linear
   equations in two letters ("2x + 3y = 12" and "x − y = 1"), and get the
   working, one step at a time, then the answer, then the answer put
   back into what you typed to prove it. An inequality's answer is also
   drawn on a number line (an open circle when the boundary is left
   out, a filled one when it is included). The maths and the parser are
   in js/core/equation.js (a real parser; the text is never evaluated).
   Here it is only the form and the display.

   Plot in Static Graph hands the curves to Static Graph: each side of
   an equation or inequality as y = …, or each line of a pair (solved
   for y). Graph keeps its curves in store('portal.graph') and reads
   them when it opens, so the new ones are put first there and the
   curves you had are switched off, not deleted; then Graph opens.
   ============================================================ */
import { solveEquation, solveSystem, graphExprs } from '../core/equation.js';

const EXAMPLES = ['3x + 5 = 2x - 7', '2(x + 1) = x/2 + 4', 'x^2 - 5x + 6 = 0', 'x^2 - 3x + 1 = 0', 'x^2 + 2x + 5 = 0', '2x + 3 = 2x - 1', '2x - 1 < 5', '-3x + 4 >= 10'];
const PAIRS = [['x + y = 10', 'x - y = 2'], ['2x + 3y = 12', 'x - y = 1'], ['y = 2x + 1', 'y = -x + 4'], ['x + y = 2', 'x + y = 5']];
const TYPE_LABEL = { linear: 'A linear equation', quadratic: 'A quadratic equation', none: 'No solution', all: 'Infinitely many solutions', inequality: 'A linear inequality', system: 'Two equations' };
const MODES = [['one', 'One equation or inequality'], ['two', 'Two equations']];
const GRAPH_KEY = 'portal.graph';
const GRAPH_MAX = 12;
const SVG = 'http://www.w3.org/2000/svg';
const draft = { mode: 'one', one: '', two: ['', ''] };
const nice = s => String(s).replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/-/g, '−');

/* the number line for an inequality's answer, drawn from the answer itself */
function numberLine(res) {
  const L = res.line;
  const W = 560, H = 74, pad = 26, y = 40;
  const el = (tag, attrs, text) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (text != null) n.textContent = text; return n; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'st-eq__line', role: 'img', 'data-fk': 'eq-line' });
  const c = L.all || L.none ? 0 : Math.round(L.at);
  const lo = c - 5, hi = c + 5;
  const X = v => pad + (v - lo) / (hi - lo) * (W - 2 * pad);
  svg.append(el('line', { x1: 6, y1: y, x2: W - 6, y2: y, class: 'ax' }),
    el('path', { d: `M6 ${y} l8 -5 v10 z M${W - 6} ${y} l-8 -5 v10 z`, class: 'ax', fill: 'currentColor' }));
  for (let v = lo; v <= hi; v++) {
    svg.append(el('line', { x1: X(v), y1: y - 5, x2: X(v), y2: y + 5, class: 'tk' }), el('text', { x: X(v), y: y + 20, 'text-anchor': 'middle' }, String(v).replace('-', '−')));
  }
  if (L.all) {
    svg.append(el('line', { x1: 10, y1: y, x2: W - 10, y2: y, class: 'ray', 'data-dir': 'both' }));
    svg.setAttribute('aria-label', `Number line: every number is shaded, because every ${res.v} works.`);
    return svg;
  }
  if (L.none) {
    svg.setAttribute('aria-label', 'Number line: nothing is shaded, because no number works.');
    return svg;
  }
  const at = X(L.at);
  svg.append(el('line', { x1: at, y1: y, x2: L.dir === 'left' ? 10 : W - 10, y2: y, class: 'ray', 'data-dir': L.dir }),
    el('circle', { cx: at, cy: y, r: 6, class: `dot ${L.open ? 'is-open' : 'is-shut'}`, 'data-open': L.open ? '1' : '0' }),
    el('text', { x: at, y: y - 13, 'text-anchor': 'middle', 'data-fk': 'eq-line-at' }, L.label));
  svg.setAttribute('aria-label', `Number line: ${L.open ? 'an open circle' : 'a filled circle'} at ${L.label} and everything to its ${L.dir} shaded (${res.answer.lines[0]}).`);
  return svg;
}

export function mountEquations(host, ctx) {
  const { api } = ctx;
  const { h, icon } = api;
  const S = { res: null, note: '' };
  const field = (value, label, ph, fk, set) => {
    const el = h('input.st-in.st-eq__in', { type: 'text', maxlength: '200', spellcheck: 'false', autocomplete: 'off', placeholder: ph, 'aria-label': label, dataset: { fk }, oninput: e => set(e.target.value) });
    el.value = value;
    return el;
  };
  const input = field(draft.one, 'Equation or inequality to solve', 'Type an equation or inequality, e.g. 3x + 5 = 2x − 7 or 2x − 1 < 5', 'eq-input', v => { draft.one = v; });
  const in1 = field(draft.two[0], 'First equation', 'First equation, e.g. 2x + 3y = 12', 'eq-sys-1', v => { draft.two[0] = v; });
  const in2 = field(draft.two[1], 'Second equation', 'Second equation, e.g. x − y = 1', 'eq-sys-2', v => { draft.two[1] = v; });
  const out = h('div.st-eq__out', { dataset: { fk: 'eq-out' }, 'aria-live': 'polite' });
  const lines = x => [].concat(x || []).map(t => h('div.st-eq__math', { text: t }));

  function solve() {
    S.note = '';
    S.res = draft.mode === 'two' ? solveSystem(in1.value, in2.value) : solveEquation(input.value);
    paint();
  }

  /* ---- into Static Graph ---- */
  function plot() {
    const list = graphExprs(S.res);
    if (!list.length) return;
    const saved = api.store.get(GRAPH_KEY);
    const had = saved && typeof saved === 'object' && Array.isArray(saved.fns) ? saved.fns.filter(f => f && typeof f === 'object') : [];
    const fresh = list.map((g, i) => ({ kind: g.kind, expr: g.expr, expr2: g.expr2 || '', tmin: g.tmin || '', tmax: g.tmax || '', on: true, ci: i }));
    const same = (a, b) => (a.kind || 'y') === b.kind && String(a.expr || '') === b.expr && String(a.expr2 || '') === b.expr2;
    const rest = had.filter(f => !fresh.some(n => same(f, n))).map(f => ({ ...f, on: false }));
    const all = [...fresh, ...rest];
    const lost = Math.max(0, all.length - GRAPH_MAX);
    try { api.store.set(GRAPH_KEY, { ...(saved && typeof saved === 'object' ? saved : {}), fns: all.slice(0, GRAPH_MAX) }); } catch (e) { S.note = 'Static Graph’s curves could not be saved.'; paint(); return; }
    api.openApp('graph');
    S.note = `Opened in Static Graph: ${list.map(g => (g.kind === 'param' ? `x = ${g.expr}` : `y = ${g.expr}`)).join(' and ')}. ${draft.mode === 'two' ? 'The answer is where the lines cross.' : S.res.type === 'inequality' ? 'The answer is where the left side’s curve is on the right side of the sign.' : 'The answer is where the curves meet.'}${rest.length ? ` The curves you had are switched off, not deleted${lost ? ` (Graph holds ${GRAPH_MAX}, so the last ${lost} had to go)` : ''}.` : ''}`;
    paint();
  }

  function paint() {
    out.replaceChildren();
    const r = S.res;
    if (!r) {
      out.append(h('p.st-note', { text: draft.mode === 'two'
        ? 'Two linear equations in two letters, like 2x + 3y = 12 and x − y = 1. They are solved by elimination, and the answer is put back into both.'
        : 'Linear (like 3x + 5 = 2x − 7) and quadratic (like x² − 5x + 6 = 0) equations in one letter, and linear inequalities with <, >, ≤ or ≥ (type <= and >= if you like). Use ^ for powers, / for fractions and brackets freely: 2(x + 1) means 2 times (x + 1).' }));
      return;
    }
    if (!r.ok) {
      out.append(h('div.st-issue', { role: 'alert', dataset: { fk: 'eq-error' } }, icon('alert'), h('span', { text: r.error })));
      return;
    }
    const plotBtn = graphExprs(r).length ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'eq-plot' }, onclick: plot }, icon('trending-up'), h('span', { text: 'Plot in Static Graph' })) : null;
    out.append(
      h('div.st-eq__answer', { dataset: { fk: 'eq-answer', type: r.type } },
        h('small', { text: r.vars && r.type !== 'system' ? `Two equations: ${TYPE_LABEL[r.type].toLowerCase()}` : TYPE_LABEL[r.type] }), r.answer.lines.map(t => h('b', { text: t }))),
      r.line ? numberLine(r) : null,
      h('div.st-row', plotBtn, S.note ? h('small.dim', { role: 'status', dataset: { fk: 'eq-plot-note' }, text: S.note }) : null),
      h('div.side__label', { text: 'Working' }),
      h('ol.st-eq__steps', { dataset: { fk: 'eq-steps' } }, r.steps.map((s, i) => h('li', { dataset: { fk: 'eq-step', i } }, h('p', { text: s.say }), ...lines(s.eq)))),
      r.check.length ? h('div.side__label', { text: r.type === 'inequality' ? 'Check by trying numbers' : 'Check by substituting back' }) : null,
      r.check.length ? h('div.st-eq__check', { dataset: { fk: 'eq-check' } },
        r.check.map(s => h('div', h('p', { text: s.say }), ...lines(s.eq))),
        h('p.st-eq__verdict', { class: r.verified ? 'is-ok' : 'is-bad', dataset: { fk: 'eq-verdict' } }, icon(r.verified ? 'check' : 'alert'),
          h('span', { text: r.verified ? (r.type === 'inequality' ? 'Verified: the numbers tried fall where the answer says.' : r.vars ? 'Verified: the answer makes both equations true.' : 'Verified: every solution makes both sides equal.') : 'The check failed.' }))) : null);
  }

  const solveBtn = () => h('button.btn.btn--primary', { type: 'submit', dataset: { fk: 'eq-solve' } }, icon('check'), h('span', { text: 'Solve' }));
  const formOne = h('form.st-row.st-eq__form', { onsubmit: e => { e.preventDefault(); solve(); } }, input, solveBtn());
  const formTwo = h('form.st-eq__form.st-eq__two', { onsubmit: e => { e.preventDefault(); solve(); } },
    h('div.st-row', h('small.dim', { text: '(1)' }), in1), h('div.st-row', h('small.dim', { text: '(2)' }), in2, solveBtn()));
  const ex = h('div.st-eq__ex', { role: 'group', 'aria-label': 'Examples' }, h('small.dim', { text: 'Try:' }),
    EXAMPLES.map(t => h('button.st-chip', { type: 'button', dataset: { fk: 'eq-example' }, onclick: () => { input.value = t; draft.one = t; solve(); input.focus({ preventScroll: true }); } }, h('span', { text: nice(t) }))));
  const exTwo = h('div.st-eq__ex', { role: 'group', 'aria-label': 'Examples' }, h('small.dim', { text: 'Try:' }),
    PAIRS.map(([a, b]) => h('button.st-chip', { type: 'button', dataset: { fk: 'eq-sys-example' }, onclick: () => { in1.value = draft.two[0] = a; in2.value = draft.two[1] = b; solve(); in1.focus({ preventScroll: true }); } }, h('span', { text: `${nice(a)}  and  ${nice(b)}` }))));
  const modes = h('div.tabs.st-tabs.st-eq__modes', { role: 'tablist', 'aria-label': 'What to solve' });
  function paintModes() {
    modes.replaceChildren(...MODES.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': draft.mode === id ? 'true' : 'false', class: draft.mode === id ? 'is-on' : '', dataset: { mode: id, fk: `eq-mode-${id}` },
      onclick: () => { if (draft.mode === id) return; draft.mode = id; S.res = null; S.note = ''; paintModes(); paint(); if (hasDraft()) solve(); } }, h('span', { text: label }))));
    formOne.hidden = ex.hidden = draft.mode !== 'one';
    formTwo.hidden = exTwo.hidden = draft.mode !== 'two';
  }
  const hasDraft = () => (draft.mode === 'two' ? draft.two.every(t => t.trim()) : !!draft.one.trim());
  host.appendChild(h('div.st-eq', h('div.app__content.st-scroll.st-quiz__pane', h('div.app__title', { text: 'Equation solver' }), modes, formOne, formTwo, ex, exTwo, out)));
  paintModes();
  paint();
  if (hasDraft()) solve();
  return { open() {}, teardown() {} };
}
