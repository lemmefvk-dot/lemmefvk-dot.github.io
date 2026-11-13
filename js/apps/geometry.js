/* ============================================================
   geometry.js — Geometry Sketchpad: points, segments, lines,
   circles, polygons and measured angles on a grid.

   Constructions depend on their parents: a midpoint, an
   intersection, a perpendicular or a circle is worked out from the
   points and curves it was built on, so dragging a free point moves
   everything built from it (js/core/geometry.js holds the model and
   the maths). Lengths, angles and areas are computed from that real
   geometry, in grid units (one square of the grid is one unit).

   Tools (letters in brackets): Move (V), Point (P), Segment (S),
   Line (L), Circle (C), Polygon (G), Midpoint (M), Intersection (X),
   Angle (A), Perpendicular (N), Parallel (R), Erase (E).
   Clicking a point picks it; clicking empty space makes a new one
   (snapped to the grid while Snap is on). The same picks work from
   the object list on the right, and points can be typed in by
   coordinates, so everything has a keyboard route: arrow keys move
   the selected free point (Shift: a tenth of a unit), [ and ] step
   through objects, Delete removes the selection and what is built
   on it, Ctrl+Z / Ctrl+Shift+Z undo and redo, Ctrl+S saves.

   A sketch is a file: ~/Documents/<name>.geo (JSON). Once it has a
   file, edits save themselves.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import * as G from '../core/geometry.js';

const DOCS = `${vfs.HOME}/Documents`;
const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, String(v));
  for (const k of kids) if (k != null) e.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return e;
};

const TOOLS = [
  ['select', 'Move', 'v'], ['point', 'Point', 'p'], ['seg', 'Segment', 's'], ['line', 'Line', 'l'], ['circle', 'Circle', 'c'], ['poly', 'Polygon', 'g'],
  ['mid', 'Midpoint', 'm'], ['inter', 'Intersection', 'x'], ['angle', 'Angle', 'a'], ['perp', 'Perpendicular', 'n'], ['par', 'Parallel', 'r'], ['erase', 'Erase', 'e'],
];
const POINTISH = new Set(['point', 'mid', 'inter']);
const CURVE = new Set(['seg', 'line', 'circle', 'perp', 'par']);
const LINEISH = new Set(['seg', 'line', 'perp', 'par']);
const NEED = { seg: 2, line: 2, circle: 2, mid: 2, angle: 3 };
const STEPS = {
  point: ['Click to place a point.'],
  seg: ['Segment: choose the first point.', 'Segment: choose the second point.'],
  line: ['Line: choose the first point.', 'Line: choose the second point.'],
  circle: ['Circle: choose the centre.', 'Circle: choose a point on the circle.'],
  poly: ['Polygon: choose the first corner.', 'Polygon: choose the next corner.', 'Polygon: next corner, or press Enter to finish.'],
  mid: ['Midpoint: choose the first point.', 'Midpoint: choose the second point.'],
  inter: ['Intersection: choose a line, segment or circle.', 'Intersection: choose a second one.'],
  angle: ['Angle: choose a point on the first arm.', 'Angle: choose the vertex.', 'Angle: choose a point on the second arm.'],
  perp: ['Perpendicular: choose a point and a line (either first).'],
  par: ['Parallel: choose a point and a line (either first).'],
  erase: ['Erase: choose what to remove (what is built on it goes too).'],
  select: ['Move: drag a free point, or choose an object. Drag empty space to pan.'],
};

const CSS = `
.gm{flex:1;display:flex;flex-direction:column;min-height:0;height:100%;color:var(--ink-1);font-size:var(--fs-13)}
.gm *{box-sizing:border-box}
.gm__bar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.gm__b{height:28px;padding:0 var(--sp-3);border-radius:var(--r-sm);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit;cursor:pointer}
.gm__b:hover:not(:disabled){background:var(--fill-2)}
.gm__b[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.gm__b:disabled{opacity:.45;cursor:default}
.gm__sep{width:1px;height:20px;background:var(--line-1);margin:0 var(--sp-2)}
.gm__main{flex:1;min-height:0;display:flex;gap:var(--sp-3);padding:var(--sp-3);overflow:auto}
.gm__stage{flex:1 1 380px;min-width:260px;min-height:300px;position:relative;border-radius:var(--r-lg);border:1px solid var(--line-1);background:var(--fill-0);overflow:hidden;display:flex;flex-direction:column}
.gm__svg{flex:1;min-height:0;width:100%;touch-action:none;display:block;outline:none;cursor:crosshair}
.gm__svg:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.gm__hint{padding:var(--sp-2) var(--sp-4);border-top:1px solid var(--line-1);color:var(--ink-2);font-size:var(--fs-12);min-height:28px}
.gm__side{flex:0 0 290px;display:flex;flex-direction:column;gap:var(--sp-3);min-width:0;overflow:auto}
@media (max-width:760px){.gm__side{flex-basis:100%}}
.gm h3{margin:0;font-size:var(--fs-11);color:var(--ink-3);text-transform:uppercase;letter-spacing:.08em}
.gm__form{display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap}
.gm__in{width:64px;height:28px;padding:0 var(--sp-3);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit}
.gm__sel{height:28px;max-width:160px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit}
.gm__list{display:flex;flex-direction:column;gap:2px}
.gm__row{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;padding:var(--sp-2) var(--sp-3);border-radius:var(--r-sm);border:1px solid transparent;background:transparent;color:var(--ink-1);font:inherit;cursor:pointer;width:100%}
.gm__row:hover{background:var(--fill-1)}
.gm__row[aria-pressed=true]{background:var(--fill-2);border-color:var(--line-2)}
.gm__row b{color:var(--ink-0)}
.gm__row span{font-variant-numeric:tabular-nums;color:var(--ink-2)}
.gm__row.is-bad span{color:#ff7a8a}
.gm__empty{margin:0;color:var(--ink-3);line-height:1.5}
.g-grid{stroke:var(--line-1);stroke-width:1}
.g-axis{stroke:var(--ink-3);stroke-width:1.5}
.g-tick{fill:var(--ink-3);font-size:var(--fs-10)}
.g-ln{stroke:var(--ink-1);stroke-width:2;fill:none}
.g-ln.is-sel,.g-circ.is-sel,.g-poly.is-sel{stroke:var(--accent);stroke-width:3.5}
.g-circ{stroke:var(--ink-1);stroke-width:2;fill:none}
.g-poly{stroke:var(--ink-1);stroke-width:2;fill:color-mix(in srgb,var(--accent) 14%,transparent)}
.g-ang{stroke:#e0a030;stroke-width:2;fill:color-mix(in srgb,#e0a030 20%,transparent)}
.g-pt{fill:var(--accent);stroke:var(--ink-0);stroke-width:1.5}
.g-pt.is-derived{fill:var(--fill-0);stroke:var(--accent);stroke-width:2.5}
.g-pt.is-sel{stroke:#fff;stroke-width:3}
.g-pend{fill:none;stroke:var(--accent);stroke-width:2;stroke-dasharray:3 3}
.g-lab{fill:var(--ink-0);font-size:var(--fs-12);font-weight:600;paint-order:stroke;stroke:var(--fill-0);stroke-width:3;stroke-linejoin:round}
.g-meas{fill:var(--ink-2);font-size:var(--fs-11);paint-order:stroke;stroke:var(--fill-0);stroke-width:3;stroke-linejoin:round}
`;

defineApp({
  id: 'geometry',
  name: 'Geometry Sketchpad',
  icon: 'compass',
  g1: '#ec5fc6', g2: '#961a7f',
  category: 'Utilities',
  keywords: ['geometry', 'sketchpad', 'triangle', 'circle', 'angle', 'compass', 'construct', 'perpendicular', 'parallel', 'midpoint', 'polygon', 'area', 'math', 'school', 'protractor', 'geogebra'],
  desc: 'Construct points, lines, circles and polygons, drag them, and measure lengths, angles and areas',
  handles: ['geometry'],
  win: { w: 980, h: 660, minW: 560, minH: 460 },
  shortcuts: [
    ['V / P / S / L / C / G', 'Move, Point, Segment, Line, Circle, Polygon'],
    ['M / X / A / N / R / E', 'Midpoint, Intersection, Angle, Perpendicular, Parallel, Erase'],
    ['Left / Right / Up / Down', 'Move the selected point one unit (Shift: a tenth) or pan'],
    ['[ / ]', 'Select the previous or next object'],
    ['Enter', 'Finish a polygon'],
    ['Delete', 'Remove the selection and what is built on it'],
    ['Mod+Z', 'Undo'], ['Mod+Shift+Z', 'Redo'], ['Mod+S', 'Save'],
    ['Plus / - / 0', 'Zoom in, out, reset'],
  ],
  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const say = (title, message, icon = 'compass') => api.notify({ app: 'Geometry Sketchpad', icon, title, message, timeout: 4200 });

  let M = G.emptyModel();
  let R = G.solve(M);
  const st = { tool: 'select', sel: null, picks: [], snap: true, view: { cx: 0, cy: 0, k: 40 }, path: null, dirty: false, saved: '', drag: null, hint: '' };
  const undoStack = [], redoStack = [];
  let saveTimer = 0;
  let W = 600, H = 400;

  /* ---------- model changes ---------- */
  const snap = () => G.stringify(M);
  function checkpoint(pre) { undoStack.push(pre || snap()); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; }
  function changed() {
    R = G.solve(M);
    st.dirty = true;
    if (st.sel && !G.byId(M, st.sel)) st.sel = null;
    clearTimeout(saveTimer);
    if (st.path) saveTimer = setTimeout(() => { if (!dead) saveFile(true); }, 700);
    render();
  }
  function restore(text) {
    const p = G.parse(text);
    if (p.error) return;
    M = p.model;
    st.picks = [];
    changed();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); announce('Undone'); }
  function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); announce('Redone'); }
  /** one undo step around a change */
  function commit(fn) { const pre = snap(); const r = fn(); if (r === false) return false; checkpoint(pre); changed(); return true; }

  const round = v => Math.round(v * 1000) / 1000;
  const place = w => (st.snap ? { x: Math.round(w.x), y: Math.round(w.y) } : { x: round(w.x), y: round(w.y) });

  /* ---------- picks and constructions ---------- */
  const isPoint = id => { const o = G.byId(M, id); return !!o && POINTISH.has(o.type); };
  const kindOf = id => (G.byId(M, id) || {}).type;
  function resolve(p) { return p.id ? p.id : G.addPoint(M, p.x, p.y); }

  function pick(t) {
    if (dead) return;
    const tool = st.tool;
    if (tool === 'select') {
      st.sel = t && t.id ? t.id : null;
      render();
      return;
    }
    if (tool === 'point') {
      const w = t.id ? null : t;
      if (!w) { st.sel = t.id; announce(`${G.label(M, G.byId(M, t.id))} is already a point.`); render(); return; }
      commit(() => { st.sel = G.addPoint(M, w.x, w.y); });
      return;
    }
    if (tool === 'erase') {
      if (!t.id) return;
      const o = G.byId(M, t.id);
      const name = G.label(M, o);
      let gone = 0;
      commit(() => { gone = G.remove(M, t.id).length; });
      announce(gone > 1 ? `Removed ${name} and ${gone - 1} thing${gone === 2 ? '' : 's'} built on it.` : `Removed ${name}.`);
      return;
    }
    const wantsCurve = tool === 'inter';
    if (tool === 'perp' || tool === 'par') {
      if (t.id && !isPoint(t.id) && !LINEISH.has(kindOf(t.id))) { announce('Choose a point or a line.'); return; }
      const have = { pt: st.picks.find(p => !p.id || isPoint(p.id)), ln: st.picks.find(p => p.id && LINEISH.has(kindOf(p.id))) };
      const isLn = t.id && LINEISH.has(kindOf(t.id));
      if (isLn ? have.ln : have.pt) { announce(isLn ? 'You already chose a line: now a point.' : 'You already chose a point: now a line.'); return; }
      st.picks.push(t);
      const pt = st.picks.find(p => !p.id || isPoint(p.id)), ln = st.picks.find(p => p.id && LINEISH.has(kindOf(p.id)));
      if (pt && ln) {
        const pre = snap();
        const id = G.add(M, { type: tool, p: resolve(pt), l: ln.id });
        st.picks = [];
        if (id) { checkpoint(pre); st.sel = id; changed(); } else restoreModel(pre);
      } else render();
      return;
    }
    if (wantsCurve) {
      if (!t.id || !CURVE.has(kindOf(t.id))) { announce('Choose a line, a segment or a circle.'); return; }
      if (st.picks.some(p => p.id === t.id)) return;
      st.picks.push(t);
      if (st.picks.length < 2) { render(); return; }
      const [a, b] = st.picks.map(p => p.id);
      st.picks = [];
      const pre = snap();
      const first = G.add(M, { type: 'inter', a, b, k: 0 });
      const R2 = G.solve(M);
      if (!R2.get(first).ok && R2.get(first).why === 'they do not meet') { restoreModel(pre); announce('Those two do not meet.'); return; }
      const second = G.add(M, { type: 'inter', a, b, k: 1 });
      if (!G.solve(M).get(second).ok) G.remove(M, second);
      checkpoint(pre); st.sel = first; changed();
      return;
    }
    /* the rest take points */
    if (t.id && !isPoint(t.id)) { announce('Choose a point (or click empty space to make one).'); return; }
    if (t.id && st.picks.some(p => p.id === t.id)) {
      if (tool === 'poly' && st.picks.length >= 3 && st.picks[0].id === t.id) { finishPolygon(); return; }
      return;
    }
    st.picks.push(t);
    const need = NEED[tool];
    if (need && st.picks.length === need) {
      const picks = st.picks; st.picks = [];
      const pre = snap();
      const ids = picks.map(resolve);
      let id = null;
      if (tool === 'seg' || tool === 'line') id = G.add(M, { type: tool, a: ids[0], b: ids[1] });
      else if (tool === 'mid') id = G.add(M, { type: 'mid', a: ids[0], b: ids[1] });
      else if (tool === 'circle') id = G.add(M, { type: 'circle', c: ids[0], p: ids[1] });
      else if (tool === 'angle') id = G.add(M, { type: 'angle', a: ids[0], v: ids[1], b: ids[2] });
      if (id) { checkpoint(pre); st.sel = id; changed(); } else restoreModel(pre);
      return;
    }
    render();
  }
  function restoreModel(text) { const p = G.parse(text); if (!p.error) M = p.model; R = G.solve(M); render(); }
  function finishPolygon() {
    if (st.tool !== 'poly' || st.picks.length < 3) { announce('A polygon needs at least three corners.'); return; }
    const picks = st.picks; st.picks = [];
    const pre = snap();
    const id = G.add(M, { type: 'poly', pts: picks.map(resolve) });
    if (id) { checkpoint(pre); st.sel = id; changed(); } else restoreModel(pre);
  }
  function setTool(t) { st.tool = t; st.picks = []; paintBar(); render(); }

  /* ---------- the view ---------- */
  const sx = x => W / 2 + (x - st.view.cx) * st.view.k;
  const sy = y => H / 2 - (y - st.view.cy) * st.view.k;
  function world(ev) {
    const r = svg.getBoundingClientRect();
    return { x: st.view.cx + (ev.clientX - r.left - W / 2) / st.view.k, y: st.view.cy - (ev.clientY - r.top - H / 2) / st.view.k };
  }
  function zoom(f, about) {
    const k0 = st.view.k, k1 = Math.max(6, Math.min(400, k0 * f));
    if (about) { st.view.cx = about.x - (about.x - st.view.cx) * k0 / k1; st.view.cy = about.y - (about.y - st.view.cy) * k0 / k1; }
    st.view.k = k1;
    render();
  }

  /* ---------- hit testing, in screen pixels ---------- */
  function segDist(px, py, x1, y1, x2, y2, clamp) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    if (clamp) t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function hit(ev) {
    const r = svg.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const tol = ev.pointerType === 'touch' ? 20 : 10;
    let best = null, bd = tol;
    for (const o of M.objs) {
      const s = R.get(o.id);
      if (!s || !s.ok || !POINTISH.has(o.type)) continue;
      const d = Math.hypot(sx(s.x) - px, sy(s.y) - py);
      if (d <= bd) { bd = d; best = { id: o.id }; }
    }
    if (best) return best;
    bd = tol * 0.8;
    for (const o of M.objs) {
      const s = R.get(o.id);
      if (!s || !s.ok) continue;
      let d = Infinity;
      if (o.type === 'seg') d = segDist(px, py, sx(s.x1), sy(s.y1), sx(s.x2), sy(s.y2), true);
      else if (o.type === 'line' || o.type === 'perp' || o.type === 'par') d = segDist(px, py, sx(s.x1), sy(s.y1), sx(s.x2), sy(s.y2), false);
      else if (o.type === 'circle') d = Math.abs(Math.hypot(px - sx(s.cx), py - sy(s.cy)) - s.r * st.view.k);
      else if (o.type === 'poly' && (st.tool === 'select' || st.tool === 'erase')) { for (let i = 0; i < s.pts.length; i++) { const a = s.pts[i], b = s.pts[(i + 1) % s.pts.length]; d = Math.min(d, segDist(px, py, sx(a.x), sy(a.y), sx(b.x), sy(b.y), true)); } }
      if (d <= bd) { bd = d; best = { id: o.id }; }
    }
    return best;
  }

  /* ---------- the figure ---------- */
  const svg = S('svg', { class: 'gm__svg', role: 'application', tabindex: '0', 'aria-label': 'Sketch', 'data-fk': 'geo-canvas' });
  const hint = h('div.gm__hint', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'geo-hint' } });
  const announce = msg => { st.hint = msg; hint.textContent = msg; };

  function niceStep() { for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) if (s * st.view.k >= 26) return s; return 1000; }
  function drawGrid(g) {
    const step = niceStep(), k = st.view.k;
    const x0 = st.view.cx - W / 2 / k, x1 = st.view.cx + W / 2 / k, y0 = st.view.cy - H / 2 / k, y1 = st.view.cy + H / 2 / k;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) g.append(S('line', { class: x === 0 ? 'g-axis' : 'g-grid', x1: sx(x), y1: 0, x2: sx(x), y2: H }));
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) g.append(S('line', { class: y === 0 ? 'g-axis' : 'g-grid', x1: 0, y1: sy(y), x2: W, y2: sy(y) }));
    const ax = Math.max(12, Math.min(H - 4, sy(0) + 12)), ay = Math.max(4, Math.min(W - 24, sx(0) + 4));
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) if (x !== 0) g.append(S('text', { class: 'g-tick', x: sx(x) + 2, y: ax }, String(x)));
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) if (y !== 0) g.append(S('text', { class: 'g-tick', x: ay, y: sy(y) - 3 }, String(y)));
  }
  function far(s) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l = Math.hypot(dx, dy), m = (W + H) / st.view.k * 2;
    return [sx(s.x1 - dx / l * m), sy(s.y1 - dy / l * m), sx(s.x1 + dx / l * m), sy(s.y1 + dy / l * m)];
  }
  function drawAngle(g, s, o) {
    const rad = 26, ang = p => Math.atan2(p.y - s.v.y, p.x - s.v.x);
    const a1 = ang(s.a), a2 = ang(s.b);
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const P = a => [sx(s.v.x) + rad * Math.cos(a), sy(s.v.y) - rad * Math.sin(a)];
    const [x1, y1] = P(a1), [x2, y2] = P(a1 + d);
    g.append(S('path', { class: 'g-ang', d: `M${sx(s.v.x)} ${sy(s.v.y)} L${x1} ${y1} A${rad} ${rad} 0 0 ${d > 0 ? 0 : 1} ${x2} ${y2} Z`, 'data-id': o.id }));
    const [lx, ly] = [sx(s.v.x) + (rad + 16) * Math.cos(a1 + d / 2), sy(s.v.y) - (rad + 16) * Math.sin(a1 + d / 2)];
    g.append(S('text', { class: 'g-meas', x: lx - 12, y: ly + 4 }, `${G.fmtDeg(s.deg)}°`));
  }
  function render() {
    if (dead) return;
    const r = svg.getBoundingClientRect();
    if (r.width > 20 && r.height > 20) { W = Math.round(r.width); H = Math.round(r.height); }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const g = S('g');
    drawGrid(g);
    const sel = st.sel;
    for (const o of M.objs) {
      const s = R.get(o.id);
      if (!s || !s.ok) continue;
      const cls = o.id === sel ? ' is-sel' : '';
      if (o.type === 'poly') {
        g.append(S('polygon', { class: 'g-poly' + cls, points: s.pts.map(p => `${sx(p.x)},${sy(p.y)}`).join(' '), 'data-id': o.id }));
        const cx = s.pts.reduce((t, p) => t + p.x, 0) / s.pts.length, cy = s.pts.reduce((t, p) => t + p.y, 0) / s.pts.length;
        g.append(S('text', { class: 'g-meas', x: sx(cx) - 20, y: sy(cy) + 4 }, `${G.fmt(s.area)} sq`));
      } else if (o.type === 'circle') g.append(S('circle', { class: 'g-circ' + cls, cx: sx(s.cx), cy: sy(s.cy), r: s.r * st.view.k, 'data-id': o.id }));
      else if (o.type === 'seg') {
        g.append(S('line', { class: 'g-ln' + cls, x1: sx(s.x1), y1: sy(s.y1), x2: sx(s.x2), y2: sy(s.y2), 'data-id': o.id }));
        g.append(S('text', { class: 'g-meas', x: sx((s.x1 + s.x2) / 2) + 6, y: sy((s.y1 + s.y2) / 2) - 6 }, G.fmt(s.len)));
      } else if (o.type === 'line' || o.type === 'perp' || o.type === 'par') { const [a, b, c, d] = far(s); g.append(S('line', { class: 'g-ln' + cls, x1: a, y1: b, x2: c, y2: d, 'data-id': o.id })); }
      else if (o.type === 'angle') drawAngle(g, s, o);
    }
    for (const o of M.objs) {
      const s = R.get(o.id);
      if (!s || !s.ok || !POINTISH.has(o.type)) continue;
      g.append(S('circle', { class: `g-pt${o.type === 'point' ? '' : ' is-derived'}${o.id === sel ? ' is-sel' : ''}`, cx: sx(s.x), cy: sy(s.y), r: 5.5, 'data-id': o.id }));
      g.append(S('text', { class: 'g-lab', x: sx(s.x) + 8, y: sy(s.y) - 8 }, o.name));
    }
    for (const p of st.picks) {
      if (p.id) { const s = R.get(p.id); if (s && s.ok && s.x !== undefined) g.append(S('circle', { class: 'g-pend', cx: sx(s.x), cy: sy(s.y), r: 10 })); }
      else g.append(S('circle', { class: 'g-pend', cx: sx(p.x), cy: sy(p.y), r: 6 }));
    }
    svg.replaceChildren(g);
    paintPanel();
    paintBar();
    if (!st.hint || st.hintTool !== st.tool + st.picks.length) { st.hintTool = st.tool + st.picks.length; const steps = STEPS[st.tool]; announce(steps[Math.min(st.picks.length, steps.length - 1)]); }
    svg.setAttribute('aria-label', `Sketch: ${M.objs.length} objects`);
    paintStatus();
  }

  /* ---------- the panel ---------- */
  const list = h('div.gm__list', { role: 'list', dataset: { fk: 'geo-list' } });
  const files = h('select.gm__sel', { 'aria-label': 'Open a sketch', dataset: { fk: 'geo-files' } });
  const px = h('input.gm__in', { type: 'number', step: 'any', value: '0', 'aria-label': 'x', dataset: { fk: 'geo-px' } });
  const py = h('input.gm__in', { type: 'number', step: 'any', value: '0', 'aria-label': 'y', dataset: { fk: 'geo-py' } });
  function addByCoords(e) {
    e.preventDefault();
    const x = Number(px.value), y = Number(py.value);
    if (px.value === '' || py.value === '' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) { announce('Type an x and a y (numbers) for the point.'); return; }
    commit(() => { st.sel = G.addPoint(M, x, y); });
    announce(`Added point ${G.byId(M, st.sel).name} at (${G.fmt(x)}, ${G.fmt(y)}).`);
  }
  function paintPanel() {
    const rows = G.measure(M, R);
    list.replaceChildren(...(rows.length ? rows.map(r => h('button.gm__row', { type: 'button', role: 'listitem', class: r.ok ? '' : 'is-bad', 'aria-pressed': String(st.sel === r.id), dataset: { fk: 'geo-row', id: r.id, type: r.type },
      onclick: () => { if (st.tool === 'select') { st.sel = st.sel === r.id ? null : r.id; render(); } else pick({ id: r.id }); } },
      h('b', { text: r.label }),
      r.ok ? r.items.map(i => h('span', { dataset: { fk: 'geo-m', k: i.k, n: i.n === undefined ? '' : String(i.n) }, text: `${i.k}: ${i.v}${i.unit ? (i.unit === '°' ? '°' : ` ${i.unit}`) : ''}` })) : h('span', { text: `undefined: ${r.why}` }),
      r.note ? h('span', { text: r.note }) : null)) : [h('p.gm__empty', { text: 'Nothing here yet. Pick a tool and click on the grid, or type a point’s coordinates above.' })]));
  }

  /* ---------- toolbar ---------- */
  const btn = (label, title, fn, extra) => h('button.gm__b', { type: 'button', title, 'aria-label': title, onclick: fn, ...(extra || {}) }, h('span', { text: label }));
  const B = {
    undo: btn('Undo', 'Undo (Ctrl+Z)', undo, { dataset: { fk: 'geo-undo' } }),
    redo: btn('Redo', 'Redo (Ctrl+Shift+Z)', redo, { dataset: { fk: 'geo-redo' } }),
    del: btn('Delete', 'Delete the selected object and what is built on it', () => deleteSel(), { dataset: { fk: 'geo-delete' } }),
    snap: btn('Snap', 'Snap new points to the grid', () => { st.snap = !st.snap; paintBar(); }, { dataset: { fk: 'geo-snap' } }),
    save: btn('Save', 'Save to Documents (Ctrl+S)', () => saveFile(false), { dataset: { fk: 'geo-save' } }),
    open: btn('Open', 'Open the chosen sketch', () => openChosen(), { dataset: { fk: 'geo-open' } }),
    zin: btn('+', 'Zoom in', () => zoom(1.25)), zout: btn('−', 'Zoom out', () => zoom(1 / 1.25)), home: btn('Reset view', 'Reset the view', () => { st.view = { cx: 0, cy: 0, k: 40 }; render(); }),
    newer: btn('New', 'Start a new empty sketch', () => newSketch(), { dataset: { fk: 'geo-new' } }),
  };
  const toolBtns = TOOLS.map(([id, label, key]) => h('button.gm__b', { type: 'button', title: `${label} (${key.toUpperCase()})`, 'aria-pressed': 'false', dataset: { fk: 'geo-tool', tool: id }, onclick: () => setTool(id) }, h('span', { text: label })));
  const sep = () => h('span.gm__sep', { 'aria-hidden': 'true' });
  const bar = h('div.gm__bar', { role: 'toolbar', 'aria-label': 'Sketch tools' }, ...toolBtns, sep(), B.snap, sep(), B.undo, B.redo, B.del, sep(), B.zout, B.zin, B.home);
  const aside = h('div.gm__side',
    h('h3', { text: 'Add a point' }),
    h('form.gm__form', { onsubmit: addByCoords }, h('label', { text: 'x ' }, px), h('label', { text: 'y ' }, py), h('button.gm__b', { type: 'submit', dataset: { fk: 'geo-addpoint' } }, h('span', { text: 'Add' }))),
    h('h3', { text: 'Sketch file' }),
    h('div.gm__form', B.save, B.newer, files, B.open),
    h('h3', { text: 'Measurements (grid units)' }), list);
  const el = h('div.gm', h('style', { text: CSS }), bar, h('div.gm__main', h('div.gm__stage', svg, hint), aside));
  root.appendChild(el);

  function paintBar() {
    for (const b of toolBtns) b.setAttribute('aria-pressed', String(b.dataset.tool === st.tool));
    B.snap.setAttribute('aria-pressed', String(st.snap));
    B.undo.disabled = !undoStack.length; B.redo.disabled = !redoStack.length; B.del.disabled = !st.sel;
  }
  function deleteSel() {
    if (!st.sel) return;
    const o = G.byId(M, st.sel);
    const name = G.label(M, o);
    let gone = 0;
    commit(() => { gone = G.remove(M, st.sel).length; st.sel = null; });
    announce(gone > 1 ? `Removed ${name} and ${gone - 1} thing${gone === 2 ? '' : 's'} built on it.` : `Removed ${name}.`);
  }

  /* ---------- pointer ---------- */
  on(svg, 'pointerdown', e => {
    if (e.button > 0) return;
    svg.focus({ preventScroll: true });
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    const t = hit(e);
    const w = world(e);
    if (st.tool === 'select') {
      if (t) {
        st.sel = t.id;
        const o = G.byId(M, t.id);
        render();
        if (o.type === 'point') st.drag = { type: 'point', id: t.id, pre: snap(), moved: false, dx: R.get(t.id).x - w.x, dy: R.get(t.id).y - w.y };
        else if (POINTISH.has(o.type)) announce(`${o.name} is built from other points, so it moves when they do. Drag one of those instead.`);
      } else st.drag = { type: 'pan', x: e.clientX, y: e.clientY, cx: st.view.cx, cy: st.view.cy, moved: false };
      return;
    }
    if (['point', 'seg', 'line', 'circle', 'poly', 'mid', 'angle'].includes(st.tool)) pick(t && isPoint(t.id) ? t : place(w));   /* a click near a curve, not on a point, still makes a point */
    else if (st.tool === 'perp' || st.tool === 'par') pick(t || place(w));
    else if (t) pick(t);
  });
  on(svg, 'pointermove', e => {
    const d = st.drag;
    if (!d) return;
    if (d.type === 'pan') {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      st.view.cx = d.cx - dx / st.view.k; st.view.cy = d.cy + dy / st.view.k;
      render();
      return;
    }
    const w = world(e);
    const p = place({ x: w.x + d.dx, y: w.y + d.dy });
    const o = G.byId(M, d.id);
    if (!o || (o.x === p.x && o.y === p.y)) return;
    if (!d.moved) { d.moved = true; checkpoint(d.pre); }
    o.x = p.x; o.y = p.y;
    changed();
  });
  const endDrag = e => {
    const d = st.drag;
    st.drag = null;
    if (d && d.type === 'pan' && !d.moved) { st.sel = null; render(); }
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
  };
  on(svg, 'pointerup', endDrag);
  on(svg, 'pointercancel', endDrag);
  on(svg, 'dblclick', () => { if (st.tool === 'poly') finishPolygon(); });
  on(svg, 'wheel', e => { e.preventDefault(); zoom(Math.exp(-e.deltaY / 400), world(e)); }, { passive: false });

  /* ---------- keyboard ---------- */
  on(el, 'keydown', e => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      if (k === 's' || k === 'S') { e.preventDefault(); saveFile(false); }
      else if (k === 'z' || k === 'Z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === 'y' || k === 'Y') { e.preventDefault(); redo(); }
      return;
    }
    if (e.altKey) return;
    if (tag === 'BUTTON' && (k === 'Enter' || k === ' ')) return;
    const tool = TOOLS.find(t => t[2] === k.toLowerCase());
    if (tool && k.length === 1) { e.preventDefault(); setTool(tool[0]); return; }
    if (k === 'Enter') { if (st.tool === 'poly') { e.preventDefault(); finishPolygon(); } }
    else if (k === 'Escape') { if (st.picks.length) { st.picks = []; render(); } else if (st.tool !== 'select') setTool('select'); else if (st.sel) { st.sel = null; render(); } }
    else if (k === 'Delete' || k === 'Backspace') { if (st.sel) { e.preventDefault(); deleteSel(); } }
    else if (k === '[' || k === ']') {
      e.preventDefault();
      if (!M.objs.length) return;
      const i = M.objs.findIndex(o => o.id === st.sel);
      st.sel = M.objs[(i + (k === ']' ? 1 : -1) + M.objs.length * 2) % M.objs.length].id;
      const o = G.byId(M, st.sel);
      render();
      announce(`Selected ${G.label(M, o)}.`);
    } else if (/^Arrow/.test(k)) {
      e.preventDefault();
      const o = st.sel && G.byId(M, st.sel);
      const dx = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0, dy = k === 'ArrowUp' ? 1 : k === 'ArrowDown' ? -1 : 0;
      if (o && o.type === 'point') {
        const stp = e.shiftKey ? 0.1 : 1;
        commit(() => { o.x = round(o.x + dx * stp); o.y = round(o.y + dy * stp); });
      } else if (o && POINTISH.has(o.type)) announce(`${o.name} is built from other points; select one of those to move it.`);
      else { st.view.cx += dx * 50 / st.view.k; st.view.cy += dy * 50 / st.view.k; render(); }
    } else if (k === '+' || k === '=') zoom(1.25);
    else if (k === '-' || k === '_') zoom(1 / 1.25);
    else if (k === '0') { st.view = { cx: 0, cy: 0, k: 40 }; render(); }
  });

  /* ---------- files ---------- */
  function refreshFiles(selected) {
    const names = vfs.ls(DOCS).filter(n => n.type === 'file' && n.kind === 'geometry').map(n => n.name);
    files.replaceChildren(h('option', { value: '', text: names.length ? 'Open a sketch…' : 'No saved sketches' }), names.map(n => h('option', { value: n, text: n.replace(/\.geo$/, ''), selected: selected === n })));
  }
  function paintStatus() {
    const name = st.path ? vfs.baseName(st.path) : 'Unsaved sketch';
    win.setSubtitle(`— ${name}${st.dirty ? (st.path ? ' · saving…' : ' · not saved') : ''}`);
  }
  function saveFile(auto) {
    clearTimeout(saveTimer);
    const text = G.stringify(M);
    try {
      if (!st.path) {
        if (!vfs.node(DOCS)) vfs.mkdir(DOCS);
        let name = 'Sketch.geo', i = 2;
        while (vfs.node(`${DOCS}/${name}`)) name = `Sketch ${i++}.geo`;
        if (!vfs.write(`${DOCS}/${name}`, text)) throw new Error('Documents is not available.');
        st.path = `${DOCS}/${name}`;
        win.state.reopen = { path: st.path };
      } else vfs.write(st.path, text);
      st.dirty = false;
      st.saved = text;
      refreshFiles(st.path ? vfs.baseName(st.path) : '');
      paintStatus();
      if (!auto) say('Saved', st.path.replace(vfs.HOME, '~'), 'save');
    } catch (err) { say('Could not save', String(err.message || err), 'alert'); }
  }
  function loadFile(path) {
    const node = vfs.node(path);
    const p = node && node.type === 'file' ? G.parse(vfs.read(path) || '') : { error: 'That file is not there.' };
    if (p.error) { say('Could not open that file', p.error, 'alert'); return false; }
    M = p.model;
    st.path = vfs.norm(path); st.saved = G.stringify(M); st.dirty = false; st.sel = null; st.picks = [];
    undoStack.length = 0; redoStack.length = 0;
    win.state.reopen = { path: st.path };
    R = G.solve(M);
    render();
    refreshFiles(vfs.baseName(st.path));
    return true;
  }
  function openChosen() {
    const name = files.value;
    if (!name) return;
    if (st.dirty) saveFile(!!st.path);     /* never lose the sketch being left (an unsaved one gets a file, and says so) */
    loadFile(`${DOCS}/${name}`);
  }
  function newSketch() {
    if (st.dirty) saveFile(!!st.path);
    M = G.emptyModel(); R = G.solve(M); st.path = null; st.dirty = false; st.sel = null; st.picks = [];
    undoStack.length = 0; redoStack.length = 0;
    win.state.reopen = null;
    render();
  }

  /* ---------- start ---------- */
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (!dead) render(); }); ro.observe(svg); }
  refreshFiles('');
  if (opts && opts.path) loadFile(opts.path);
  render();
  root.geoPeek = () => ({
    path: st.path, dirty: st.dirty, sel: st.sel, tool: st.tool, picks: st.picks.length, snap: st.snap, view: { ...st.view }, undo: undoStack.length, redo: redoStack.length,
    objs: M.objs.map(o => ({ ...o })), solved: Object.fromEntries([...R].map(([id, r]) => [id, r])),
    screen: Object.fromEntries(M.objs.filter(o => POINTISH.has(o.type) && R.get(o.id).ok).map(o => { const r = svg.getBoundingClientRect(); return [o.id, { x: r.left + sx(R.get(o.id).x), y: r.top + sy(R.get(o.id).y) }]; })),
  });

  return () => {
    dead = true;
    clearTimeout(saveTimer);
    if (st.path && st.dirty) { try { vfs.write(st.path, G.stringify(M)); } catch (e) { /* fine */ } }
    if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } }
    offs.splice(0).forEach(f => f());
  };
}
