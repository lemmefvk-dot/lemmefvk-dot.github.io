/* ============================================================
   school/pttrends.js — the Trends tab of the Periodic Table app.

   One property (the ones the data has numbers for, js/school/ptprops.js)
   charted against atomic number: across every element, along a period,
   or down a group. A point is drawn only for an element the data gives
   a value; one without breaks the line, and the chart says how many
   were left out and which. Nothing is joined across a gap, so no line
   implies a value that isn't there.
   ============================================================ */
import { h } from '../core/dom.js';
import { PROPS, propOf, valueOf, valueText, periodOf, groupOf } from './ptprops.js';

const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); n.append(...kids); return n; };
const sig = (n, d = 4) => String(Number(Number(n).toPrecision(d)));

const CSS = `
.ptt{flex:1;min-height:0;overflow:auto;padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-4);color:var(--ink-1);font-size:var(--fs-13)}
.ptt__bar{display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:center}
.ptt__bar select{height:30px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit;font-size:var(--fs-12);padding:0 8px}
.ptt__chart{width:100%;max-width:900px;height:auto;border-radius:var(--r-md);background:var(--fill-0);border:1px solid var(--line-1)}
.ptt__chart text{font:10px var(--font);fill:var(--ink-3)}
.ptt__chart .ptt__lbl{fill:var(--ink-1);font-weight:600}
.ptt__note{margin:0;color:var(--ink-2);font-size:var(--fs-12);line-height:1.5;max-width:80ch}
`;

export function mountTrends(host, { elements, place, onPick }) {
  const st = { prop: 'ie', scope: 'all', period: 3, group: 1 };
  const out = h('div', { dataset: { fk: 'ptt-out' } });
  const propSel = h('select', { 'aria-label': 'Property', dataset: { fk: 'ptt-prop' }, onchange: e => { st.prop = e.target.value; draw(); } },
    ...PROPS.map(p => h('option', { value: p.id, text: p.label, selected: p.id === st.prop })));
  const scopeSel = h('select', { 'aria-label': 'Which elements', dataset: { fk: 'ptt-scope' }, onchange: e => { st.scope = e.target.value; paintWhich(); draw(); } },
    h('option', { value: 'all', text: 'Every element' }), h('option', { value: 'period', text: 'Along a period' }), h('option', { value: 'group', text: 'Down a group' }));
  const whichSel = h('select', { 'aria-label': 'Which period or group', dataset: { fk: 'ptt-which' }, onchange: e => { st[st.scope] = Number(e.target.value); draw(); } });
  const el = h('div.ptt', h('style', { text: CSS }), h('div.ptt__bar', h('span', { text: 'Chart' }), propSel, scopeSel, whichSel), out);
  host.appendChild(el);

  function paintWhich() {
    whichSel.hidden = st.scope === 'all';
    const n = st.scope === 'period' ? 7 : 18;
    whichSel.replaceChildren(...Array.from({ length: n }, (_, i) => h('option', { value: String(i + 1), text: `${st.scope === 'period' ? 'Period' : 'Group'} ${i + 1}`, selected: st[st.scope] === i + 1 })));
  }

  function chosen() {
    if (st.scope === 'period') return elements.filter(e => periodOf(e.n) === st.period);
    if (st.scope === 'group') return elements.filter(e => groupOf(e.n, place) === st.group);
    return elements;
  }

  function draw() {
    const p = propOf(st.prop);
    const els = chosen();
    const have = els.filter(e => valueOf(e, p.id) !== undefined);
    const missing = els.filter(e => valueOf(e, p.id) === undefined);
    const where = st.scope === 'all' ? 'the whole table' : st.scope === 'period' ? `period ${st.period}` : `group ${st.group}`;
    if (have.length < 2) {
      out.replaceChildren(h('p.ptt__note', { dataset: { fk: 'ptt-empty' }, text: `The data has ${p.label.toLowerCase()} for ${have.length === 1 ? 'only one' : 'none'} of the ${els.length} elements in ${where}, so there is no trend to draw.` }));
      return;
    }
    const W = 760, H = 320, L = 56, R = 18, T = 18, B = 40;
    const iw = W - L - R, ih = H - T - B;
    const xs = els.map(e => e.n);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const vs = have.map(e => valueOf(e, p.id));
    let v0 = Math.min(...vs), v1 = Math.max(...vs);
    if (p.log) { v0 = Math.log10(v0); v1 = Math.log10(v1); }
    if (v0 === v1) { v0 -= 1; v1 += 1; }
    const pad = (v1 - v0) * 0.06;
    v0 -= pad; v1 += pad;
    const fx = n => L + (x1 === x0 ? iw / 2 : ((n - x0) / (x1 - x0)) * iw);
    const fy = v => T + ih - (((p.log ? Math.log10(v) : v) - v0) / (v1 - v0)) * ih;
    const svg = S('svg', { class: 'ptt__chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'data-points': String(have.length), 'data-missing': String(missing.length), 'data-prop': p.id,
      'aria-label': `${p.label} ${p.unit ? `(${p.unit}) ` : ''}by atomic number, ${where}: ` + have.map(e => `${e.s} ${sig(valueOf(e, p.id))}`).join(', ') + (missing.length ? `. Not in the data: ${missing.map(e => e.s).join(', ')}` : '') });
    for (let g = 0; g <= 4; g++) {
      const y = T + (ih * g) / 4;
      const v = v1 - ((v1 - v0) * g) / 4;
      svg.append(S('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: 'currentColor', 'stroke-opacity': '.1' }),
        S('text', { x: L - 6, y: y + 3, 'text-anchor': 'end' }, sig(p.log ? 10 ** v : v, 3)));
    }
    /* the line breaks wherever an element in between has no value */
    let seg = [];
    const segs = [];
    for (const e of els) {
      const v = valueOf(e, p.id);
      if (v === undefined || (p.log && v <= 0)) { if (seg.length) segs.push(seg); seg = []; continue; }
      seg.push([fx(e.n), fy(v)]);
    }
    if (seg.length) segs.push(seg);
    for (const s of segs) if (s.length > 1) svg.append(S('polyline', { points: s.map(q => q.join(',')).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'data-seg': String(s.length) }));
    const labelEvery = els.length > 40 ? 8 : 1;
    els.forEach((e, i) => {
      const v = valueOf(e, p.id);
      if (i % labelEvery === 0 || i === els.length - 1) svg.append(S('text', { x: fx(e.n), y: H - 22, 'text-anchor': 'middle' }, String(e.n)));
      if (els.length <= 40) svg.append(S('text', { x: fx(e.n), y: H - 10, 'text-anchor': 'middle', class: 'ptt__lbl' }, e.s));
      if (v === undefined) return;
      const c = S('circle', { cx: fx(e.n), cy: fy(v), r: els.length > 40 ? 2.6 : 4, fill: 'var(--accent)', 'data-n': String(e.n), 'data-v': String(v), style: 'cursor:pointer' },
        S('title', {}, `${e.name} (${e.s}, ${e.n}): ${valueText(e, p.id)}`));
      c.addEventListener('click', () => onPick && onPick(e.n));
      svg.append(c);
    });
    out.replaceChildren(svg,
      h('p.ptt__note', { dataset: { fk: 'ptt-note' }, text: `${p.label}${p.unit ? ` (${p.unit})` : ''} of ${have.length} of the ${els.length} elements in ${where}, from PubChem’s data${p.log ? ', on a log scale' : ''}. `
        + (missing.length ? `Not in the data, so not drawn (the line breaks there): ${missing.map(e => e.s).join(', ')}.` : 'Every one of them has a value.')
        + (st.scope === 'group' && st.group === 3 ? ' Group 3 here is Sc, Y, Lu and Lr, as this table lays it out.' : '') }));
  }

  paintWhich();
  draw();
  return { teardown() {}, focus: () => propSel.focus({ preventScroll: true }), peek: () => ({ ...st }) };
}
