/* ============================================================
   logiclab/gates.js — the Logic gates tab: wire switches, gates and
   lamps together and see every signal, with a truth table worked out
   from the network itself (js/core/logic.js).

   The diagram lays itself out by depth, so wiring is done in the list
   beside it: each gate has a pick-box per input that offers every
   part it could read without making a loop. Click a switch (or focus
   it and press Space or Enter) to flip it; the row of the truth table
   for the present switch positions is marked. Start from the half
   adder, full adder or four-NAND XOR, or build your own.
   ============================================================ */
import { h } from '../core/dom.js';
import * as G from '../core/logic.js';
import { listeners } from '../core/labkit.js';

const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, String(v));
  for (const k of kids) if (k != null) e.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return e;
};
const MAX_PARTS = 30;
const clone = parts => parts.map(p => ({ ...p }));

export function mountGates(host) {
  const L = listeners();
  let dead = false;
  const st = { parts: clone(G.EXAMPLES.full.parts), seq: 1, ref: 'and' };

  const stage = h('div.lab__stage', { style: { minHeight: '300px' } });
  const list = h('div', { dataset: { fk: 'gate-list' } });
  const tableBox = h('div', { style: { overflow: 'auto', maxHeight: '300px' }, dataset: { fk: 'gate-table' } });
  const exSel = h('select', { 'aria-label': 'Example circuits', dataset: { fk: 'gate-example' }, onchange: e => { if (!e.target.value) return; load(G.EXAMPLES[e.target.value].parts); e.target.value = ''; } },
    h('option', { value: '', text: 'Examples…' }), Object.entries(G.EXAMPLES).map(([k, v]) => h('option', { value: k, text: v.name })));
  const addSel = h('select', { 'aria-label': 'Part to add', dataset: { fk: 'gate-add-type' } },
    [['in', 'Switch'], ...Object.entries(G.GATES).map(([k, v]) => [k, v.name]), ['out', 'Lamp']].map(([k, t]) => h('option', { value: k, text: t })));
  const addBtn = h('button.lab__btn', { type: 'button', dataset: { fk: 'gate-add' }, onclick: () => add(addSel.value) }, 'Add');
  const clearBtn = h('button.lab__btn', { type: 'button', dataset: { fk: 'gate-clear' }, onclick: () => load([]) }, 'Clear');
  const refSel = h('select', { 'aria-label': 'Gate to look up', dataset: { fk: 'gate-ref-pick' }, onchange: e => { st.ref = e.target.value; paintRef(); } },
    Object.entries(G.GATES).map(([k, v]) => h('option', { value: k, text: v.name })));
  const refBox = h('div', { dataset: { fk: 'gate-ref' } });
  const status = h('p.lab__note', { role: 'status', dataset: { fk: 'gate-status' } });

  host.append(
    h('div.lab__main', h('div.lab__row', exSel, h('span.lab__sp'), addSel, addBtn, clearBtn), stage, status),
    h('div.lab__side', h('h3', { text: 'Parts' }), list, h('h3', { text: 'Truth table of this circuit' }), tableBox,
      h('h3', { text: 'One gate on its own' }), h('div.lab__row', refSel), refBox));

  function load(parts) { st.parts = clone(parts); st.seq = 1; paintAll(); }
  const nextId = prefix => { let id; do { id = prefix + st.seq++; } while (st.parts.some(p => p.id === id)); return id; };
  function add(type) {
    if (st.parts.length >= MAX_PARTS) { status.textContent = `That is as many parts as fit (${MAX_PARTS}).`; return; }
    const letters = 'ABCDEFGH';
    if (type === 'in') { const n = st.parts.filter(p => p.type === 'in').length; st.parts.push({ id: nextId('in'), type, name: letters[n] || `In${n + 1}`, value: 0 }); }
    else if (type === 'out') { const n = st.parts.filter(p => p.type === 'out').length; st.parts.push({ id: nextId('out'), type, name: `Lamp ${n + 1}`, a: '' }); }
    else st.parts.push({ id: nextId('g'), type, a: '', b: '' });
    paintAll();
  }
  function remove(id) {
    st.parts = st.parts.filter(p => p.id !== id);
    for (const p of st.parts) { if (p.a === id) p.a = ''; if (p.b === id) p.b = ''; }
    paintAll();
  }
  const labelOf = p => (p.type === 'in' || p.type === 'out' ? p.name : `${G.GATES[p.type].name} ${p.id}`);
  const sources = p => st.parts.filter(q => q.type !== 'out' && !G.wouldLoop(st.parts, q.id, p.id));

  /* ---------- the list ---------- */
  function paintList() {
    list.replaceChildren(...(st.parts.length ? st.parts.map(p => {
      const pick = key => h('select', { 'aria-label': `${labelOf(p)} input ${key === 'a' ? (p.type === 'not' || p.type === 'out' ? '' : 'A') : 'B'}`.trim(), dataset: { fk: `gate-src-${p.id}-${key}` },
        onchange: e => { p[key] = e.target.value; paintAll(); } },
      h('option', { value: '', text: 'not connected', selected: !p[key] }), sources(p).map(q => h('option', { value: q.id, text: labelOf(q), selected: p[key] === q.id })));
      const head = p.type === 'in' || p.type === 'out'
        ? h('input', { type: 'text', value: p.name, size: 8, maxlength: 10, 'aria-label': `${p.type === 'in' ? 'Switch' : 'Lamp'} name`, dataset: { fk: `gate-name-${p.id}` }, onchange: e => { p.name = e.target.value.trim().slice(0, 10) || p.name; paintAll(); } })
        : h('b', { text: labelOf(p) });
      return h('div.lab__row', { style: { marginBottom: '6px' }, dataset: { part: p.id } }, head,
        p.type === 'in' ? h('label', h('input', { type: 'checkbox', checked: !!p.value, 'aria-label': `${p.name} is on`, dataset: { fk: `gate-val-${p.id}` }, onchange: e => { p.value = e.target.checked ? 1 : 0; paintAll(); } }), h('span', { text: ' on' })) : null,
        p.type === 'in' ? null : pick('a'), p.type === 'in' || p.type === 'not' || p.type === 'out' ? null : pick('b'),
        h('button.lab__btn.lab__btn--sm', { type: 'button', 'aria-label': `Remove ${labelOf(p)}`, dataset: { fk: `gate-del-${p.id}` }, onclick: () => remove(p.id) }, 'Remove'));
    }) : [h('p.lab__note', { text: 'Nothing here yet. Add a switch, a gate and a lamp, or pick an example.' })]));
  }

  /* ---------- the diagram ---------- */
  function layout() {
    const byId = new Map(st.parts.map(p => [p.id, p]));
    const depth = new Map();
    const dep = (p, seen = new Set()) => {
      if (depth.has(p.id)) return depth.get(p.id);
      if (seen.has(p.id)) return 0;
      seen.add(p.id);
      const d = p.type === 'in' ? 0 : 1 + Math.max(0, ...G.inputsOf(p).map(i => (byId.get(i) ? dep(byId.get(i), seen) : 0)));
      depth.set(p.id, d); return d;
    };
    st.parts.forEach(p => dep(p));
    const cols = [];
    for (const p of st.parts) (cols[depth.get(p.id)] ||= []).push(p);
    return cols.map(c => c || []);
  }
  function paintDiagram(val) {
    const cols = layout();
    const colW = 130, rowH = 64, padX = 16, W = Math.max(300, padX * 2 + cols.length * colW), rows = Math.max(1, ...cols.map(c => c.length)), Hh = Math.max(220, 24 + rows * rowH);
    const pos = new Map();
    cols.forEach((c, ci) => c.forEach((p, ri) => pos.set(p.id, { x: padX + ci * colW, y: 12 + (Hh - 24) * (ri + 0.5) / c.length })));
    const svg = S('svg', { viewBox: `0 0 ${W} ${Hh}`, role: 'img', 'aria-label': 'Logic diagram', preserveAspectRatio: 'xMidYMid meet' });
    const on = 'var(--accent)', off = 'var(--ink-3)';
    for (const p of st.parts) {
      const to = pos.get(p.id), ins = G.inputsOf(p);
      const slots = p.type === 'not' || p.type === 'out' ? [p.a] : p.type === 'in' ? [] : [p.a, p.b];
      slots.forEach((src, k) => {
        if (!src || !pos.has(src)) return;
        const from = pos.get(src), x1 = from.x + 60, y1 = from.y, x2 = to.x, y2 = to.y + (slots.length === 2 ? (k ? 8 : -8) : 0);
        svg.append(S('path', { d: `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`, fill: 'none', stroke: val[src] ? on : off, 'stroke-width': val[src] ? 3 : 1.8, 'stroke-linecap': 'round', 'data-wire': `${src}>${p.id}` }));
      });
      void ins;
    }
    for (const p of st.parts) {
      const q = pos.get(p.id), v = val[p.id];
      const g = S('g', { transform: `translate(${q.x} ${q.y})`, 'data-part': p.id });
      if (p.type === 'in') {
        g.append(S('rect', { x: 0, y: -16, width: 60, height: 32, rx: 16, fill: v ? on : 'var(--fill-2)', stroke: 'var(--line-2)' }), S('circle', { cx: v ? 44 : 16, cy: 0, r: 11, fill: 'var(--ink-0)' }), S('text', { x: 30, y: -22, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-size': 11 }, p.name));
        g.setAttribute('tabindex', '0'); g.setAttribute('role', 'switch'); g.setAttribute('aria-checked', String(!!v)); g.setAttribute('aria-label', `Switch ${p.name}`); g.style.cursor = 'pointer';
        g.dataset.fk = `gate-switch-${p.id}`;
        const flip = () => { p.value = p.value ? 0 : 1; paintAll(); };
        g.addEventListener('click', flip);
        g.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
      } else if (p.type === 'out') {
        g.append(S('circle', { cx: 20, cy: 0, r: 15, fill: v ? '#ffd34d' : 'var(--fill-2)', stroke: 'var(--line-2)', 'stroke-width': 2 }), S('text', { x: 20, y: 4, 'text-anchor': 'middle', fill: v ? '#222' : 'var(--ink-2)', 'font-size': 12, 'font-weight': 700 }, String(v)), S('text', { x: 20, y: 30, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-size': 11 }, p.name));
        g.dataset.value = String(v);
      } else {
        g.append(S('rect', { x: 0, y: -22, width: 60, height: 44, rx: 8, fill: 'var(--fill-1)', stroke: v ? on : 'var(--line-2)', 'stroke-width': 2 }), S('text', { x: 30, y: -3, 'text-anchor': 'middle', fill: 'var(--ink-0)', 'font-size': 13, 'font-weight': 700 }, G.GATES[p.type].name), S('text', { x: 30, y: 14, 'text-anchor': 'middle', fill: v ? on : 'var(--ink-3)', 'font-size': 12 }, `= ${v}`));
      }
      svg.append(g);
    }
    stage.replaceChildren(svg);
  }

  /* ---------- the truth table ---------- */
  function paintTable(val) {
    const tt = G.truthTable(st.parts);
    if (!st.parts.some(p => p.type === 'out') || !st.parts.some(p => p.type === 'in')) { tableBox.replaceChildren(h('p.lab__note', { text: 'Add at least one switch and one lamp to get a truth table.' })); return; }
    if (!tt) { tableBox.replaceChildren(h('p.lab__note', { text: 'A truth table needs 8 switches or fewer.' })); return; }
    const now = st.parts.filter(p => p.type === 'in').map(p => val[p.id]).join('');
    tableBox.replaceChildren(h('table', h('thead', h('tr', ...tt.inputs.map(n => h('th', { text: n })), ...tt.outputs.map(n => h('th', { text: n, style: { color: 'var(--accent)' } })))),
      h('tbody', ...tt.rows.map(r => h('tr', { dataset: { now: String(r.inputs.join('') === now) }, style: r.inputs.join('') === now ? { background: 'var(--fill-2)', fontWeight: '700' } : null },
        ...r.inputs.map(v => h('td', { text: String(v) })), ...r.outputs.map(v => h('td', { text: String(v) })))))));
  }
  function paintRef() {
    const t = G.GATES[st.ref], rows = G.gateTable(st.ref);
    refBox.replaceChildren(h('table', h('thead', h('tr', ...(t.one ? ['A'] : ['A', 'B']).map(x => h('th', { text: x })), h('th', { text: t.name }))), h('tbody', ...rows.map(r => h('tr', ...r.map(v => h('td', { text: String(v) })))))));
  }

  function paintAll() {
    if (dead) return;
    const val = G.evaluate(st.parts);
    const fk = host.contains(document.activeElement) ? document.activeElement.dataset.fk : null;   /* a repaint must not drop the keyboard's place */
    paintList(); paintDiagram(val); paintTable(val); paintRef();
    status.textContent = '';
    if (fk) { const again = host.querySelector(`[data-fk="${fk}"]`); if (again) again.focus(); }
  }
  paintAll();
  host.__peek = () => ({ parts: clone(st.parts), values: G.evaluate(st.parts), table: G.truthTable(st.parts) });
  return () => { dead = true; L.off(); };
}
