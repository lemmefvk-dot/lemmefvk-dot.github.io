/* ============================================================
   logiclab/circuit.js — the Circuits tab: batteries, resistors,
   bulbs and switches joined at numbered nodes, solved for real by
   js/core/circuit.js (nodal analysis). Every voltage, current and
   power on screen is that solution.

   Each part is listed with the two nodes it sits between (node 0 is
   ground, 0 V) and its value, so a circuit is built and changed in
   the list, with every field a normal keyboard-reachable control. The
   drawing places the nodes on a ring and the parts on the lines
   between them, with a bulb glowing by the share of its rated power
   it receives. Bulbs are fixed resistors here (a real filament's
   resistance rises as it heats; that is not modelled). A circuit with
   no complete loop, or a battery shorted across another, says so
   instead of showing numbers.
   ============================================================ */
import { h } from '../core/dom.js';
import * as C from '../core/circuit.js';
import { listeners } from '../core/labkit.js';

const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, String(v));
  for (const k of kids) if (k != null) e.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return e;
};
const MAX_PARTS = 16, MAX_NODE = 9;
const clone = parts => parts.map(p => ({ ...p }));

/** 0.03 A -> "30 mA", 4.5 V -> "4.5 V": the unit steps down when the number would be tiny. */
export function si(v, unit) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0 || a < 1e-12) return `0 ${unit}`;
  if (a >= 1000) return `${+(v / 1000).toPrecision(4)} k${unit}`;
  if (a >= 1) return `${+v.toPrecision(4)} ${unit}`;
  if (a >= 1e-3) return `${+(v * 1e3).toPrecision(4)} m${unit}`;
  return `${+(v * 1e6).toPrecision(4)} µ${unit}`;
}

export function mountCircuit(host) {
  const L = listeners();
  let dead = false;
  const st = { parts: clone(C.EXAMPLES.bulbs.parts), res: null };

  const stage = h('div.lab__stage', { style: { minHeight: '300px' } });
  const list = h('div', { dataset: { fk: 'circ-list' } });
  const tableBox = h('div', { style: { overflow: 'auto', maxHeight: '260px' }, dataset: { fk: 'circ-table' } });
  const exSel = h('select', { 'aria-label': 'Example circuits', dataset: { fk: 'circ-example' }, onchange: e => { if (!e.target.value) return; st.parts = clone(C.EXAMPLES[e.target.value].parts); e.target.value = ''; paintAll(); } },
    h('option', { value: '', text: 'Examples…' }), Object.entries(C.EXAMPLES).map(([k, v]) => h('option', { value: k, text: v.name })));
  const addSel = h('select', { 'aria-label': 'Part to add', dataset: { fk: 'circ-add-type' } }, Object.entries(C.TYPES).map(([k, t]) => h('option', { value: k, text: t })));
  const addBtn = h('button.lab__btn', { type: 'button', dataset: { fk: 'circ-add' }, onclick: () => add(addSel.value) }, 'Add');
  const clearBtn = h('button.lab__btn', { type: 'button', dataset: { fk: 'circ-clear' }, onclick: () => { st.parts = []; paintAll(); } }, 'Clear');
  const status = h('p.lab__note', { role: 'status', dataset: { fk: 'circ-status' } });
  const totals = h('p.lab__note', { dataset: { fk: 'circ-totals' } });

  host.append(
    h('div.lab__main', h('div.lab__row', exSel, h('span.lab__sp'), addSel, addBtn, clearBtn), stage, status),
    h('div.lab__side', h('h3', { text: 'Parts' }), list, h('h3', { text: 'Solved' }), tableBox, totals,
      h('p.lab__note', { text: 'Battery + is its first node, − its second. Current is shown flowing from the first node to the second. Node 0 is ground. Put two parts on the same pair of nodes to wire them in parallel; chain them through a shared node for series.' })));

  const nextId = type => { const pre = { battery: 'B', resistor: 'R', bulb: 'L', switch: 'S' }[type]; let n = 1; while (st.parts.some(p => p.id === pre + n)) n++; return pre + n; };
  function add(type) {
    if (st.parts.length >= MAX_PARTS) { status.textContent = `That is as many parts as fit (${MAX_PARTS}).`; return; }
    const top = Math.max(0, ...st.parts.flatMap(p => [p.a, p.b]));
    const base = { id: nextId(type), type, a: Math.min(MAX_NODE, top || 1), b: 0 };
    if (type === 'battery') base.value = 9; else if (type === 'resistor') base.value = 100; else if (type === 'bulb') { base.value = 12; base.rated = 3; } else base.closed = true;
    st.parts.push(base);
    paintAll();
  }

  function paintList() {
    const node = (p, key) => h('select', { 'aria-label': `${p.id} ${key === 'a' ? (p.type === 'battery' ? 'plus node' : 'first node') : (p.type === 'battery' ? 'minus node' : 'second node')}`, dataset: { fk: `circ-${p.id}-${key}` }, onchange: e => { p[key] = Number(e.target.value); paintAll(); } },
      Array.from({ length: MAX_NODE + 1 }, (_, n) => h('option', { value: n, text: n === 0 ? '0 (ground)' : `node ${n}`, selected: p[key] === n })));
    const num = (p, key, label, step) => h('input', { type: 'number', min: key === 'value' && p.type !== 'battery' ? 0.001 : 0, step, value: String(p[key]), 'aria-label': `${p.id} ${label}`, dataset: { fk: `circ-${p.id}-${key}` },
      oninput: e => { const v = Number(e.target.value); p[key] = e.target.value === '' ? NaN : v; paintSolve(); } });
    list.replaceChildren(...(st.parts.length ? st.parts.map(p => h('div.lab__row', { style: { marginBottom: '6px' }, dataset: { part: p.id } },
      h('b', { text: `${p.id}` }), node(p, 'a'), h('span', { text: '→' }), node(p, 'b'),
      p.type === 'switch' ? h('label', h('input', { type: 'checkbox', checked: !!p.closed, 'aria-label': `${p.id} closed`, dataset: { fk: `circ-${p.id}-closed` }, onchange: e => { p.closed = e.target.checked; paintAll(); } }), h('span', { text: ' closed' })) : null,
      p.type === 'battery' ? h('span', num(p, 'value', 'volts', 'any'), h('span', { text: ' V' })) : null,
      p.type === 'resistor' ? h('span', num(p, 'value', 'ohms', 'any'), h('span', { text: ' Ω' })) : null,
      p.type === 'bulb' ? h('span', num(p, 'value', 'ohms', 'any'), h('span', { text: ' Ω  ' }), num(p, 'rated', 'rated watts', 'any'), h('span', { text: ' W' })) : null,
      h('button.lab__btn.lab__btn--sm', { type: 'button', 'aria-label': `Remove ${p.id}`, dataset: { fk: `circ-del-${p.id}` }, onclick: () => { st.parts = st.parts.filter(q => q !== p); paintAll(); } }, 'Remove')))
      : [h('p.lab__note', { text: 'Nothing here yet. Add a battery and something for it to light, or pick an example.' })]));
  }

  /* ---------- the drawing ---------- */
  function paintDrawing() {
    const res = st.res, W = 560, Hh = 400, cx = W / 2, cy = Hh / 2 - 6, R = 150;
    const svg = S('svg', { viewBox: `0 0 ${W} ${Hh}`, role: 'img', 'aria-label': 'Circuit diagram', preserveAspectRatio: 'xMidYMid meet' });
    const nodes = [...new Set([0, ...st.parts.flatMap(p => [p.a, p.b])])].sort((a, b) => a - b);
    const pos = new Map(nodes.map((n, i) => { const t = Math.PI / 2 + (i * 2 * Math.PI) / nodes.length; return [n, { x: cx + R * 1.3 * Math.cos(t), y: cy + R * Math.sin(t) }]; }));
    const seen = new Map();
    for (const p of st.parts) {
      const A = pos.get(p.a), B = pos.get(p.b);
      if (!A || !B) continue;
      const key = [Math.min(p.a, p.b), Math.max(p.a, p.b)].join('-'), k = seen.get(key) || 0; seen.set(key, k + 1);
      const sign = p.a < p.b ? 1 : -1;
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      const off = p.a === p.b ? 0 : (k - (st.parts.filter(q => [Math.min(q.a, q.b), Math.max(q.a, q.b)].join('-') === key).length - 1) / 2) * 46 * sign;
      const mx = (A.x + B.x) / 2 + nx * off, my = (A.y + B.y) / 2 + ny * off;
      const r = res && res.ok ? res.parts[p.id] : null;
      const live = r && !r.floating;
      const g = S('g', { 'data-part': p.id });
      g.append(S('path', { d: `M${A.x} ${A.y} Q${(A.x + B.x) / 2 + nx * off * 2} ${(A.y + B.y) / 2 + ny * off * 2} ${B.x} ${B.y}`, fill: 'none', stroke: live ? 'var(--ink-2)' : 'var(--ink-3)', 'stroke-width': 2, 'stroke-dasharray': live ? null : '4 4' }));
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const sym = S('g', { transform: `translate(${mx} ${my}) rotate(${ang > 90 || ang < -90 ? ang + 180 : ang})` });
      const fill = 'var(--fill-0)', stroke = 'var(--ink-0)';
      if (p.type === 'battery') sym.append(S('rect', { x: -14, y: -14, width: 28, height: 28, fill, stroke: 'none' }), S('path', { d: 'M-4 -13v26', stroke, 'stroke-width': 3 }), S('path', { d: 'M5 -7v14', stroke, 'stroke-width': 3 }), S('text', { x: -11, y: -15, fill: stroke, 'font-size': 11 }, '+'));
      else if (p.type === 'resistor') sym.append(S('rect', { x: -18, y: -8, width: 36, height: 16, rx: 3, fill, stroke, 'stroke-width': 2 }));
      else if (p.type === 'bulb') sym.append(S('circle', { r: 15, fill: r && r.glow ? '#ffd34d' : fill, 'fill-opacity': r && r.glow ? 0.25 + 0.75 * r.glow : 1, stroke, 'stroke-width': 2 }), S('path', { d: 'M-10 -10L10 10M10 -10L-10 10', stroke, 'stroke-width': 1.6 }));
      else sym.append(S('rect', { x: -16, y: -8, width: 32, height: 16, fill, stroke: 'none' }), S('circle', { cx: -12, r: 3, fill: stroke }), S('circle', { cx: 12, r: 3, fill: stroke }), S('path', { d: p.closed ? 'M-12 0H12' : 'M-12 0L9 -11', stroke, 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
      g.append(sym);
      const label = [p.id, p.type === 'battery' ? `${p.value} V` : p.type === 'switch' ? (p.closed ? 'closed' : 'open') : si(p.value, 'Ω'), r && r.i !== null && r.i !== undefined && p.type !== 'switch' ? si(r.i, 'A') : ''].filter(Boolean);
      label.forEach((t, i) => g.append(S('text', { x: mx, y: my - 24 - (label.length - 1 - i) * 13 + (off > 0 ? 0 : 0), 'text-anchor': 'middle', fill: i === 0 ? 'var(--ink-0)' : 'var(--ink-2)', 'font-size': 11, 'font-weight': i === 0 ? 700 : 400 }, t)));
      svg.append(g);
    }
    for (const n of nodes) {
      const q = pos.get(n), v = res && res.ok ? res.volts[n] : null;
      svg.append(S('circle', { cx: q.x, cy: q.y, r: 6, fill: n === 0 ? 'var(--ink-0)' : 'var(--accent)', 'data-node': n }),
        S('text', { x: q.x, y: q.y + 20, 'text-anchor': 'middle', fill: 'var(--ink-1)', 'font-size': 11 }, n === 0 ? `0 · ${v === null ? '' : '0 V'}` : `${n}${v === null || v === undefined ? '' : ` · ${si(v, 'V')}`}`));
    }
    stage.replaceChildren(svg);
  }

  function paintSolve() {
    const res = C.solve(st.parts);
    st.res = res;
    if (!res.ok) { status.textContent = res.error; status.className = 'lab__err'; tableBox.replaceChildren(); totals.textContent = ''; paintDrawing(); return; }
    status.className = 'lab__note';
    const open = res.floating.length;
    status.textContent = !st.parts.length ? '' : open ? `Node${open > 1 ? 's' : ''} ${res.floating.join(', ')} ${open > 1 ? 'are' : 'is'} not connected to ground through any part, so nothing flows there.` : '';
    const rows = st.parts.map(p => ({ p, r: res.parts[p.id] }));
    tableBox.replaceChildren(rows.length ? h('table', h('thead', h('tr', ...['Part', 'Volts', 'Current', 'Power'].map(t => h('th', { text: t })))),
      h('tbody', ...rows.map(({ p, r }) => h('tr', { dataset: { part: p.id } }, h('th', { scope: 'row', text: p.id }),
        h('td', { text: r.v === null ? '—' : si(r.v, 'V'), dataset: { role: 'v' } }), h('td', { text: r.i === null ? '—' : si(r.i, 'A'), dataset: { role: 'i' } }),
        h('td', { text: r.p === null ? '—' : si(r.p, 'W'), dataset: { role: 'p' } }))))) : h('span'));
    const supplied = rows.filter(x => x.p.type === 'battery').reduce((t, x) => t + x.r.p, 0), used = rows.filter(x => x.p.type === 'resistor' || x.p.type === 'bulb').reduce((t, x) => t + x.r.p, 0);
    totals.textContent = rows.some(x => x.p.type === 'battery') ? `Supplied by batteries ${si(supplied, 'W')}. Used by resistors and bulbs ${si(used, 'W')}. They match because energy is conserved.` : '';
    paintDrawing();
  }
  function paintAll() {
    if (dead) return;
    const fk = host.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
    paintList(); paintSolve();
    if (fk) { const again = host.querySelector(`[data-fk="${fk}"]`); if (again) again.focus(); }
  }
  paintAll();
  host.__peek = () => ({ parts: clone(st.parts), res: st.res });
  return () => { dead = true; L.off(); };
}
