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
   Angle (A), Perpendicular (N), Parallel (R), Erase (E). Construct:
   angle bisector (B), circumcircle (U), tangent (K), regular polygon
   (Y), ellipse and parabola from foci, a point on an object, a locus.
   Transform: reflect (F), rotate (O), translate (T), dilate (D); an
   image moves with what it was made from. Measure: a live distance
   label and the ratio of two lengths.
   Clicking a point picks it; clicking empty space makes a new one
   (snapped to the grid while Snap is on). The same picks work from
   the object list on the right, and points can be typed in by
   coordinates, so everything has a keyboard route: arrow keys move
   the selected free point (Shift: a tenth of a unit) or slide a point
   along its object, [ and ] step through objects, Delete removes the
   selection and what is built on it, Ctrl+Z / Ctrl+Shift+Z undo and
   redo, Ctrl+S saves. A selected object can be renamed, coloured and
   hidden; Grid, Axes and Coordinates choose what the figure shows.

   A sketch is a file: ~/Documents/<name>.geo (JSON). Once it has a
   file, edits save themselves. The figure exports as PNG or SVG into
   ~/Pictures, and prints with its measurements.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import * as media from '../core/media.js';
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
/* the tools behind the three menus: [id, label, key] */
const MORE = {
  construct: ['Construct', [['bisector', 'Angle bisector', 'b'], ['circum', 'Circumcircle', 'u'], ['tangent', 'Tangent to a circle', 'k'], ['regpoly', 'Regular polygon', 'y'], ['ellipse', 'Ellipse from foci', ''], ['parabola', 'Parabola from focus', ''], ['on', 'Point on object', ''], ['locus', 'Locus', '']]],
  transform: ['Transform', [['reflect', 'Reflect', 'f'], ['rotate', 'Rotate', 'o'], ['translate', 'Translate', 't'], ['dilate', 'Dilate', 'd']]],
  measure: ['Measure', [['dist', 'Distance label', ''], ['ratio', 'Ratio of lengths', '']]],
};
const ALL_TOOLS = [...TOOLS, ...Object.values(MORE).flatMap(m => m[1])];
const NEED = { seg: 2, line: 2, circle: 2, mid: 2, angle: 3 };
/* what each step of the newer tools takes: point (or a click on empty space), line, circle, any, onpt, length */
const RECIPE = {
  bisector: [['point', 'point', 'point'], ([a, v, b]) => [{ type: 'bisector', a, v, b }]],
  circum: [['point', 'point', 'point'], ([a, b, c]) => [{ type: 'circum', a, b, c }]],
  tangent: [['point', 'circle'], ([p, c]) => [{ type: 'tangent', p, c, k: 0 }, { type: 'tangent', p, c, k: 1 }]],
  regpoly: [['point', 'point'], ([a, b], st) => [{ type: 'regpoly', a, b, n: st.sides }]],
  ellipse: [['point', 'point', 'point'], ([f1, f2, p]) => [{ type: 'ellipse', f1, f2, p }]],
  parabola: [['point', 'line'], ([f, l]) => [{ type: 'parabola', f, l }]],
  locus: [['onpt', 'point'], ([d, p]) => [{ type: 'locus', p, d }]],
  reflect: [['any', 'line'], ([src, l]) => [{ type: 'reflect', src, l }]],
  rotate: [['any', 'point'], ([src, c], st) => [{ type: 'rotate', src, c, deg: st.deg }]],
  translate: [['any', 'point', 'point'], ([src, a, b]) => [{ type: 'translate', src, a, b }]],
  dilate: [['any', 'point'], ([src, c], st) => [{ type: 'dilate', src, c, s: st.scale }]],
  dist: [['point', 'point'], ([a, b]) => [{ type: 'dist', a, b }]],
  ratio: [['length', 'length'], ([a, b]) => [{ type: 'ratio', a, b }]],
};
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
  select: ['Move: drag a free point or a point on an object, or choose an object. Drag empty space to pan.'],
  bisector: ['Angle bisector: choose a point on the first arm.', 'Angle bisector: choose the vertex.', 'Angle bisector: choose a point on the second arm.'],
  circum: ['Circumcircle: choose the first point.', 'Circumcircle: choose the second point.', 'Circumcircle: choose the third point.'],
  tangent: ['Tangent: choose the point the tangents go through.', 'Tangent: choose the circle.'],
  regpoly: ['Regular polygon: choose the first corner of one side.', 'Regular polygon: choose the second corner (it is built to the left of this side).'],
  ellipse: ['Ellipse: choose the first focus.', 'Ellipse: choose the second focus.', 'Ellipse: choose a point the ellipse passes through.'],
  parabola: ['Parabola: choose the focus.', 'Parabola: choose the directrix (a line or segment).'],
  on: ['Point on object: click a segment, line or circle; the point stays on it when dragged.'],
  locus: ['Locus: choose a point on an object (the one that slides).', 'Locus: choose the point whose path to draw (it must move when the first one does).'],
  reflect: ['Reflect: choose what to reflect.', 'Reflect: choose the mirror line.'],
  rotate: ['Rotate: choose what to turn.', 'Rotate: choose the centre of the turn (the angle is set above the figure).'],
  translate: ['Translate: choose what to move.', 'Translate: choose where the move starts.', 'Translate: choose where it ends.'],
  dilate: ['Dilate: choose what to scale.', 'Dilate: choose the centre (the scale factor is set above the figure).'],
  dist: ['Distance: choose the first point.', 'Distance: choose the second point.'],
  ratio: ['Ratio: choose the first length (a segment or a distance).', 'Ratio: choose the second length.'],
};
const COLORS = [['', 'Standard'], ['#e5484d', 'Red'], ['#f2994a', 'Orange'], ['#2bb673', 'Green'], ['#3e8ef7', 'Blue'], ['#9b6cf6', 'Purple'], ['#e254a6', 'Pink']];

const CSS = `
.gm{flex:1;display:flex;flex-direction:column;min-height:0;height:100%;color:var(--ink-1);font-size:var(--fs-13)}
.gm *{box-sizing:border-box}
.gm__bar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.gm__b{height:28px;padding:0 var(--sp-3);border-radius:var(--r-sm);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit;cursor:pointer}
.gm__b:hover:not(:disabled){background:var(--fill-2)}
.gm__b[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.gm__b:disabled{opacity:.45;cursor:default}
.gm__sep{width:1px;height:20px;background:var(--line-1);margin:0 var(--sp-2)}
.gm__more{height:28px;max-width:170px;border-radius:var(--r-sm);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit}
.gm__more.is-on{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.gm__opt{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-4);border-bottom:1px solid var(--line-1);color:var(--ink-2)}
.gm__opt[hidden]{display:none}
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
.gm__in--wide{width:140px}
.gm__sel{height:28px;max-width:160px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit}
.gm__selbox{display:flex;flex-direction:column;gap:var(--sp-2);padding:var(--sp-3);border-radius:var(--r-md);border:1px solid var(--line-1);background:var(--fill-0)}
.gm__selbox[hidden]{display:none}
.gm__sw{width:22px;height:22px;border-radius:50%;border:2px solid var(--line-2);background:var(--sw,var(--ink-1));cursor:pointer;padding:0}
.gm__sw[aria-pressed=true]{outline:2px solid var(--ink-0);outline-offset:1px}
.gm__err{color:#ff7a8a;font-size:var(--fs-12);min-height:0}
.gm__list{display:flex;flex-direction:column;gap:2px}
.gm__row{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;padding:var(--sp-2) var(--sp-3);border-radius:var(--r-sm);border:1px solid transparent;background:transparent;color:var(--ink-1);font:inherit;cursor:pointer;width:100%}
.gm__row:hover{background:var(--fill-1)}
.gm__row[aria-pressed=true]{background:var(--fill-2);border-color:var(--line-2)}
.gm__row b{color:var(--ink-0)}
.gm__row span{font-variant-numeric:tabular-nums;color:var(--ink-2)}
.gm__row.is-bad span{color:#ff7a8a}
.gm__row.is-hidden b{opacity:.55}
.gm__row i{font-style:normal;color:var(--ink-3);font-size:var(--fs-11)}
.gm__empty{margin:0;color:var(--ink-3);line-height:1.5}
.g-grid{stroke:var(--line-1);stroke-width:1}
.g-axis{stroke:var(--ink-3);stroke-width:1.5}
.g-tick{fill:var(--ink-3);font-size:var(--fs-10)}
.g-ln{stroke:var(--ink-1);stroke-width:2;fill:none}
.g-ln.is-sel,.g-circ.is-sel,.g-poly.is-sel,.g-curve.is-sel{stroke:var(--accent);stroke-width:3.5}
.g-circ,.g-curve{stroke:var(--ink-1);stroke-width:2;fill:none}
.g-locus{stroke:var(--accent);stroke-width:2;fill:none;stroke-dasharray:1 0}
.g-dim{stroke:var(--ink-3);stroke-width:1;stroke-dasharray:4 3;fill:none}
.g-poly{stroke:var(--ink-1);stroke-width:2;fill:color-mix(in srgb,var(--accent) 14%,transparent)}
.g-ang{stroke:#e0a030;stroke-width:2;fill:color-mix(in srgb,#e0a030 20%,transparent)}
.g-pt{fill:var(--accent);stroke:var(--ink-0);stroke-width:1.5}
.g-pt.is-derived{fill:var(--fill-0);stroke:var(--accent);stroke-width:2.5}
.g-pt.is-on{fill:var(--ink-0);stroke:var(--accent);stroke-width:2.5}
.g-pt.is-sel{stroke:#fff;stroke-width:3}
.g-pend{fill:none;stroke:var(--accent);stroke-width:2;stroke-dasharray:3 3}
.g-lab{fill:var(--ink-0);font-size:var(--fs-12);font-weight:600;paint-order:stroke;stroke:var(--fill-0);stroke-width:3;stroke-linejoin:round}
.g-meas{fill:var(--ink-2);font-size:var(--fs-11);paint-order:stroke;stroke:var(--fill-0);stroke-width:3;stroke-linejoin:round}
.g-axlab{fill:var(--ink-2);font-size:var(--fs-12);font-style:italic}
.geo-print{display:none}
@media print{
  html.geo-printing,html.geo-printing body{background:#fff!important;height:auto!important;min-height:0!important;overflow:visible!important;position:static!important}
  html.geo-printing body>:not(.geo-print){display:none!important}
  html.geo-printing .geo-print{display:block!important;color:#000;font:11pt/1.5 system-ui,sans-serif}
  .geo-print h1{font-size:16pt;margin:0 0 8pt}
  .geo-print svg{width:100%;height:auto;max-height:60vh;border:1px solid #999;margin-bottom:10pt}
  .geo-print table{border-collapse:collapse;width:100%}
  .geo-print td,.geo-print th{border-bottom:1px solid #ccc;padding:3pt 6pt;text-align:left;vertical-align:top}
}
`;

defineApp({
  id: 'geometry',
  name: 'Geometry Sketchpad',
  icon: 'compass',
  g1: '#ec5fc6', g2: '#961a7f',
  category: 'Utilities',
  keywords: ['geometry', 'sketchpad', 'triangle', 'circle', 'angle', 'compass', 'construct', 'perpendicular', 'parallel', 'midpoint', 'polygon', 'area', 'math', 'school', 'protractor', 'geogebra',
    'reflect', 'rotate', 'translate', 'dilate', 'transformation', 'bisector', 'circumcircle', 'tangent', 'regular polygon', 'ellipse', 'parabola', 'locus', 'ratio'],
  desc: 'Construct, transform and measure points, lines, circles, polygons, ellipses and parabolas, drag them, and export or print the figure',
  handles: ['geometry'],
  win: { w: 1020, h: 680, minW: 560, minH: 460 },
  shortcuts: [
    ['V / P / S / L / C / G', 'Move, Point, Segment, Line, Circle, Polygon'],
    ['M / X / A / N / R / E', 'Midpoint, Intersection, Angle, Perpendicular, Parallel, Erase'],
    ['B / U / K / Y', 'Angle bisector, Circumcircle, Tangent, Regular polygon'],
    ['F / O / T / D', 'Reflect, Rotate, Translate, Dilate'],
    ['Left / Right / Up / Down', 'Move the selected point one unit (Shift: a tenth), slide a point on an object, or pan'],
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
  const st = { tool: 'select', sel: null, picks: [], snap: true, view: { cx: 0, cy: 0, k: 40 }, path: null, dirty: false, saved: '', drag: null, hint: '', deg: 90, scale: 2, sides: 6 };
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
  const shape = id => G.shapeOf(M, G.byId(M, id));
  const isPoint = id => shape(id) === 'point';
  const kindOf = id => (G.byId(M, id) || {}).type;
  const isLine = id => ['seg', 'line'].includes(shape(id));
  const isCurve = id => ['seg', 'line', 'circle'].includes(shape(id));
  function resolve(p) { return p.id ? p.id : G.addPoint(M, p.x, p.y); }
  /* what the current step of a newer tool takes, or '' */
  const wants = () => { const r = RECIPE[st.tool]; return r ? r[0][Math.min(st.picks.length, r[0].length - 1)] : ''; };
  const fits = (want, id) => {
    if (want === 'point') return isPoint(id);
    if (want === 'line') return isLine(id);
    if (want === 'circle') return shape(id) === 'circle';
    if (want === 'onpt') return kindOf(id) === 'on';
    if (want === 'length') return shape(id) === 'seg' || kindOf(id) === 'dist';
    if (want === 'any') return shape(id) !== 'measure';
    return false;
  };
  const WANT_TEXT = { point: 'Choose a point (or click empty space to make one).', line: 'Choose a line or a segment.', circle: 'Choose a circle.', onpt: 'Choose a point made with “Point on object”.', length: 'Choose a segment or a distance label.', any: 'Choose an object to transform (a label of a measurement cannot be).' };

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
    if (tool === 'on') {
      if (!t.id || !isCurve(t.id) || t.w === undefined) { announce('Click a segment, a line or a circle.'); return; }
      const L = R.get(t.id);
      commit(() => { st.sel = G.add(M, { type: 'on', l: t.id, t: Math.round(G.onParam(L, t.w) * 1e6) / 1e6 }); });
      if (st.sel) announce(`Added ${G.byId(M, st.sel).name} on ${G.label(M, G.byId(M, t.id))}: drag it and it stays on it.`);
      return;
    }
    if (RECIPE[tool]) { pickRecipe(t); return; }
    const wantsCurve = tool === 'inter';
    if (tool === 'perp' || tool === 'par') {
      if (t.id && !isPoint(t.id) && !isLine(t.id)) { announce('Choose a point or a line.'); return; }
      const have = { pt: st.picks.find(p => !p.id || isPoint(p.id)), ln: st.picks.find(p => p.id && isLine(p.id)) };
      const isLn = t.id && isLine(t.id);
      if (isLn ? have.ln : have.pt) { announce(isLn ? 'You already chose a line: now a point.' : 'You already chose a point: now a line.'); return; }
      st.picks.push(t);
      const pt = st.picks.find(p => !p.id || isPoint(p.id)), ln = st.picks.find(p => p.id && isLine(p.id));
      if (pt && ln) {
        const pre = snap();
        const id = G.add(M, { type: tool, p: resolve(pt), l: ln.id });
        st.picks = [];
        if (id) { checkpoint(pre); st.sel = id; changed(); } else restoreModel(pre);
      } else render();
      return;
    }
    if (wantsCurve) {
      if (!t.id || !isCurve(t.id)) { announce('Choose a line, a segment or a circle.'); return; }
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
  /* the newer tools: each step takes one kind of thing, then the objects are made in one undo step */
  function pickRecipe(t) {
    const [want, make] = RECIPE[st.tool];
    const w = want[st.picks.length];
    if (t.id ? !fits(w, t.id) : w !== 'point') { announce(WANT_TEXT[w]); return; }
    if (t.id && w === 'point' && st.picks.some(p => p.id === t.id) && !['rotate', 'dilate', 'translate'].includes(st.tool)) { announce('Choose a different point.'); return; }
    st.picks.push(t);
    if (st.picks.length < want.length) { render(); return; }
    const picks = st.picks; st.picks = [];
    const pre = snap();
    const ids = picks.map(resolve);
    const specs = make(ids, st);
    const made = specs.map(s => G.add(M, s));
    if (!made[0]) { restoreModel(pre); announce('That could not be made from those.'); return; }
    let R2 = G.solve(M);
    /* a tangent from a point on the circle is one line, not two */
    for (let i = made.length - 1; i > 0; i--) if (made[i] && !R2.get(made[i]).ok) { G.remove(M, made[i]); made.splice(i, 1); }
    R2 = G.solve(M);
    if (!R2.get(made[0]).ok && (st.tool === 'tangent' || st.tool === 'circum' || st.tool === 'locus' || st.tool === 'ellipse' || st.tool === 'parabola')) {
      const why = R2.get(made[0]).why;
      restoreModel(pre);
      announce(`Not made: ${why}.`);
      return;
    }
    checkpoint(pre); st.sel = made[0]; changed();
    announce(`Made ${made.map(id => G.label(M, G.byId(M, id))).join(' and ')}.`);
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
  const polyDist = (px, py, pts, closed) => { let d = Infinity; for (let i = 0; i + 1 < pts.length + (closed ? 1 : 0); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if (a && b) d = Math.min(d, segDist(px, py, sx(a.x), sy(a.y), sx(b.x), sy(b.y), true)); } return d; };
  /* accept(o): which objects count; points come first */
  function hit(ev, accept = () => true) {
    const r = svg.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const tol = ev.pointerType === 'touch' ? 20 : 10;
    let best = null, bd = tol;
    const visible = o => !o.hidden && accept(o);
    for (const o of M.objs) {
      const s = R.get(o.id);
      if (!s || !s.ok || !isPoint(o.id) || !visible(o)) continue;
      const d = Math.hypot(sx(s.x) - px, sy(s.y) - py);
      if (d <= bd) { bd = d; best = { id: o.id }; }
    }
    if (best) return best;
    bd = tol * 0.8;
    const wideTools = st.tool === 'select' || st.tool === 'erase' || G.TRANSFORMS.includes(st.tool);
    for (const o of M.objs) {
      const s = R.get(o.id);
      if (!s || !s.ok || !visible(o)) continue;
      const sh = shape(o.id);
      let d = Infinity;
      if (sh === 'seg') d = segDist(px, py, sx(s.x1), sy(s.y1), sx(s.x2), sy(s.y2), true);
      else if (sh === 'line') d = segDist(px, py, sx(s.x1), sy(s.y1), sx(s.x2), sy(s.y2), false);
      else if (sh === 'circle') d = Math.abs(Math.hypot(px - sx(s.cx), py - sy(s.cy)) - s.r * st.view.k);
      else if (sh === 'poly' && wideTools) d = polyDist(px, py, s.pts, true);
      else if (sh === 'ellipse' && wideTools) d = polyDist(px, py, Array.from({ length: 72 }, (_, i) => G.ellipseAt(s, i * Math.PI / 36)), true);
      else if (sh === 'parabola' && wideTools) d = polyDist(px, py, parabolaPts(s), false);
      else if (sh === 'locus' && wideTools) d = polyDist(px, py, s.pts, s.closed);
      else if (o.type === 'dist' && wideTools) d = segDist(px, py, sx(s.x1), sy(s.y1), sx(s.x2), sy(s.y2), true);
      if (d <= bd) { bd = d; best = { id: o.id }; }
    }
    if (best) best.w = world(ev);
    return best;
  }

  /* ---------- the figure ---------- */
  const svg = S('svg', { class: 'gm__svg', role: 'application', tabindex: '0', 'aria-label': 'Sketch', 'data-fk': 'geo-canvas' });
  const hint = h('div.gm__hint', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'geo-hint' } });
  const announce = msg => { st.hint = msg; hint.textContent = msg; };

  function niceStep() { for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) if (s * st.view.k >= 26) return s; return 1000; }
  function drawGrid(g) {
    const v = G.viewOf(M);
    const step = niceStep(), k = st.view.k;
    const x0 = st.view.cx - W / 2 / k, x1 = st.view.cx + W / 2 / k, y0 = st.view.cy - H / 2 / k, y1 = st.view.cy + H / 2 / k;
    if (v.grid) {
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) if (x !== 0 || !v.axes) g.append(S('line', { class: 'g-grid', x1: sx(x), y1: 0, x2: sx(x), y2: H }));
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) if (y !== 0 || !v.axes) g.append(S('line', { class: 'g-grid', x1: 0, y1: sy(y), x2: W, y2: sy(y) }));
    }
    if (!v.axes) return;
    g.append(S('line', { class: 'g-axis', 'data-fk': 'geo-axis', x1: sx(0), y1: 0, x2: sx(0), y2: H }), S('line', { class: 'g-axis', 'data-fk': 'geo-axis', x1: 0, y1: sy(0), x2: W, y2: sy(0) }));
    const ax = Math.max(12, Math.min(H - 4, sy(0) + 12)), ay = Math.max(4, Math.min(W - 24, sx(0) + 4));
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) if (x !== 0) g.append(S('text', { class: 'g-tick', x: sx(x) + 2, y: ax }, String(x)));
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) if (y !== 0) g.append(S('text', { class: 'g-tick', x: ay, y: sy(y) - 3 }, String(y)));
    g.append(S('text', { class: 'g-axlab', x: W - 14, y: Math.max(14, Math.min(H - 6, sy(0) - 6)) }, 'x'), S('text', { class: 'g-axlab', x: Math.max(4, Math.min(W - 14, sx(0) + 8)), y: 14 }, 'y'));
  }
  function far(s) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l = Math.hypot(dx, dy), m = (W + H) / st.view.k * 2;
    return [sx(s.x1 - dx / l * m), sy(s.y1 - dy / l * m), sx(s.x1 + dx / l * m), sy(s.y1 + dy / l * m)];
  }
  function parabolaPts(s) {
    const span = (W + H) / st.view.k * 1.5 + Math.hypot(s.vx - st.view.cx, s.vy - st.view.cy);
    return Array.from({ length: 241 }, (_, i) => { const u = -1 + i / 120; return G.parabolaAt(s, span * u * Math.abs(u)); });
  }
  const pathOf = (pts, closed) => { let d = '', pen = false; for (const p of pts) { if (!p) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`; pen = true; } return d + (closed ? 'Z' : ''); };
  function drawAngle(g, s, o, style) {
    const rad = 26, ang = p => Math.atan2(p.y - s.v.y, p.x - s.v.x);
    const a1 = ang(s.a), a2 = ang(s.b);
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const P = a => [sx(s.v.x) + rad * Math.cos(a), sy(s.v.y) - rad * Math.sin(a)];
    const [x1, y1] = P(a1), [x2, y2] = P(a1 + d);
    g.append(S('path', { class: 'g-ang', style, d: `M${sx(s.v.x)} ${sy(s.v.y)} L${x1} ${y1} A${rad} ${rad} 0 0 ${d > 0 ? 0 : 1} ${x2} ${y2} Z`, 'data-id': o.id }));
    const [lx, ly] = [sx(s.v.x) + (rad + 16) * Math.cos(a1 + d / 2), sy(s.v.y) - (rad + 16) * Math.sin(a1 + d / 2)];
    g.append(S('text', { class: 'g-meas', x: lx - 12, y: ly + 4 }, `${G.fmtDeg(s.deg)}°`));
  }
  function render() {
    if (dead) return;
    const r = svg.getBoundingClientRect();
    if (r.width > 20 && r.height > 20) { W = Math.round(r.width); H = Math.round(r.height); }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren(figure(st.sel));
    paintPanel();
    paintBar();
    paintSelBox();
    if (!st.hint || st.hintTool !== st.tool + st.picks.length) { st.hintTool = st.tool + st.picks.length; const steps = STEPS[st.tool]; announce(steps[Math.min(st.picks.length, steps.length - 1)]); }
    svg.setAttribute('aria-label', `Sketch: ${M.objs.length} objects`);
    paintStatus();
  }
  /* the whole figure as one <g>: on screen, and for export and print */
  function figure(sel) {
    const g = S('g');
    drawGrid(g);
    const view = G.viewOf(M);
    const ratios = [];
    for (const o of M.objs) {
      const s = R.get(o.id);
      if (!s || !s.ok || o.hidden) continue;
      const cls = o.id === sel ? ' is-sel' : '';
      const c = o.color;
      const stroke = c ? `stroke:${c}` : null;
      const sh = shape(o.id);
      if (sh === 'poly') {
        g.append(S('polygon', { class: 'g-poly' + cls, style: c ? `stroke:${c};fill:${c};fill-opacity:.14` : null, points: s.pts.map(p => `${sx(p.x)},${sy(p.y)}`).join(' '), 'data-id': o.id }));
        const cx = s.pts.reduce((t, p) => t + p.x, 0) / s.pts.length, cy = s.pts.reduce((t, p) => t + p.y, 0) / s.pts.length;
        g.append(S('text', { class: 'g-meas', x: sx(cx) - 20, y: sy(cy) + 4 }, `${G.fmt(s.area)} sq`));
      } else if (sh === 'circle') g.append(S('circle', { class: 'g-circ' + cls, style: stroke, cx: sx(s.cx), cy: sy(s.cy), r: s.r * st.view.k, 'data-id': o.id }));
      else if (sh === 'seg') {
        g.append(S('line', { class: 'g-ln' + cls, style: stroke, x1: sx(s.x1), y1: sy(s.y1), x2: sx(s.x2), y2: sy(s.y2), 'data-id': o.id }));
        g.append(S('text', { class: 'g-meas', x: sx((s.x1 + s.x2) / 2) + 6, y: sy((s.y1 + s.y2) / 2) - 6 }, G.fmt(s.len)));
      } else if (sh === 'line') { const [a, b, cc, d] = far(s); g.append(S('line', { class: 'g-ln' + cls, style: stroke, x1: a, y1: b, x2: cc, y2: d, 'data-id': o.id })); }
      else if (sh === 'angle') drawAngle(g, s, o, c ? `stroke:${c};fill:${c};fill-opacity:.2` : null);
      else if (sh === 'ellipse') g.append(S('ellipse', { class: 'g-curve' + cls, style: stroke, cx: sx(s.cx), cy: sy(s.cy), rx: s.a * st.view.k, ry: s.b * st.view.k, transform: `rotate(${(-s.rot * 180 / Math.PI).toFixed(4)} ${sx(s.cx)} ${sy(s.cy)})`, 'data-id': o.id }));
      else if (sh === 'parabola') g.append(S('path', { class: 'g-curve' + cls, style: stroke, d: pathOf(parabolaPts(s), false), 'data-id': o.id }));
      else if (sh === 'locus') g.append(S('path', { class: 'g-locus' + cls, style: stroke, d: pathOf(s.pts, s.closed), 'data-id': o.id }));
      else if (o.type === 'dist') {
        g.append(S('line', { class: 'g-dim' + cls, style: stroke, x1: sx(s.x1), y1: sy(s.y1), x2: sx(s.x2), y2: sy(s.y2), 'data-id': o.id }));
        g.append(S('text', { class: 'g-meas', 'data-fk': 'geo-dist', 'data-id': o.id, x: sx((s.x1 + s.x2) / 2) + 6, y: sy((s.y1 + s.y2) / 2) + 14 }, `${G.label(M, o)} = ${G.fmt(s.value)}`));
      } else if (o.type === 'ratio') ratios.push(`${G.label(M, o)} = ${G.fmt(s.value)}`);
    }
    ratios.forEach((t, i) => g.append(S('text', { class: 'g-meas', 'data-fk': 'geo-ratio', x: 10, y: 20 + i * 16 }, t)));
    for (const o of M.objs) {
      const s = R.get(o.id);
      if (!s || !s.ok || !isPoint(o.id) || o.hidden) continue;
      const kind = o.type === 'point' ? '' : o.type === 'on' ? ' is-on' : ' is-derived';
      g.append(S('circle', { class: `g-pt${kind}${o.id === sel ? ' is-sel' : ''}`, style: o.color ? (o.type === 'point' ? `fill:${o.color}` : `stroke:${o.color}`) : null, cx: sx(s.x), cy: sy(s.y), r: 5.5, 'data-id': o.id }));
      g.append(S('text', { class: 'g-lab', 'data-fk': 'geo-label', 'data-id': o.id, x: sx(s.x) + 8, y: sy(s.y) - 8 }, view.coords ? `${o.name} (${G.fmt(s.x)}, ${G.fmt(s.y)})` : o.name));
    }
    for (const p of st.picks) {
      if (p.id) { const s = R.get(p.id); if (s && s.ok && s.x !== undefined) g.append(S('circle', { class: 'g-pend', cx: sx(s.x), cy: sy(s.y), r: 10 })); }
      else g.append(S('circle', { class: 'g-pend', cx: sx(p.x), cy: sy(p.y), r: 6 }));
    }
    return g;
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
    list.replaceChildren(...(rows.length ? rows.map(r => h('button.gm__row', { type: 'button', role: 'listitem', class: [r.ok ? '' : 'is-bad', r.hidden ? 'is-hidden' : ''].filter(Boolean).join(' '), 'aria-pressed': String(st.sel === r.id), dataset: { fk: 'geo-row', id: r.id, type: r.type },
      onclick: () => { if (st.tool === 'select') { st.sel = st.sel === r.id ? null : r.id; render(); } else pick({ id: r.id }); } },
      h('b', { text: r.label, style: r.color ? { color: r.color } : null }),
      r.hidden ? h('i', { text: 'hidden' }) : null,
      r.ok ? r.items.map(i => h('span', { dataset: { fk: 'geo-m', k: i.k, n: i.n === undefined ? '' : String(i.n) }, text: `${i.k}: ${i.v}${i.unit ? (i.unit === '°' ? '°' : ` ${i.unit}`) : ''}` })) : h('span', { text: `undefined: ${r.why}` }),
      r.note ? h('span', { text: r.note }) : null)) : [h('p.gm__empty', { text: 'Nothing here yet. Pick a tool and click on the grid, or type a point’s coordinates above.' })]));
  }

  /* ---------- the selected object: name, colour, hidden ---------- */
  const selName = h('input.gm__in.gm__in--wide', { type: 'text', maxlength: '24', 'aria-label': 'Name', dataset: { fk: 'geo-name' },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); applyName(); } }, onchange: () => applyName() });
  const selErr = h('div.gm__err', { role: 'alert', dataset: { fk: 'geo-name-err' } });
  const swatches = COLORS.map(([c, nm]) => h('button.gm__sw', { type: 'button', title: nm, 'aria-label': `Colour: ${nm}`, 'aria-pressed': 'false', dataset: { fk: 'geo-color', color: c }, style: c ? { '--sw': c } : null, onclick: () => setColor(c) }));
  const hideBtn = h('button.gm__b', { type: 'button', dataset: { fk: 'geo-hide' }, onclick: () => toggleHidden() });
  const selBox = h('div.gm__selbox', { hidden: true, dataset: { fk: 'geo-selbox' } },
    h('h3', { text: 'Selected' }),
    h('div.gm__form', h('label', { text: 'Name ' }, selName), hideBtn),
    selErr,
    h('div.gm__form', { role: 'group', 'aria-label': 'Colour' }, ...swatches));
  let selShown = null;
  function paintSelBox() {
    const o = st.sel && G.byId(M, st.sel);
    selBox.hidden = !o;
    if (!o) { selShown = null; return; }
    if (selShown !== o.id || document.activeElement !== selName) selName.value = isPoint(o.id) ? o.name : (o.name || '');
    if (selShown !== o.id) selErr.textContent = '';
    selName.placeholder = isPoint(o.id) ? '' : G.label(M, { ...o, name: undefined });
    selShown = o.id;
    hideBtn.textContent = o.hidden ? 'Show' : 'Hide';
    hideBtn.setAttribute('aria-pressed', String(!!o.hidden));
    for (const b of swatches) b.setAttribute('aria-pressed', String((o.color || '') === b.dataset.color));
  }
  function applyName() {
    const o = st.sel && G.byId(M, st.sel);
    if (!o) return;
    const before = isPoint(o.id) ? o.name : (o.name || '');
    if (selName.value.trim() === before) return;
    const pre = snap();
    const why = G.rename(M, o.id, selName.value);
    if (why) { selErr.textContent = why; return; }
    selErr.textContent = '';
    checkpoint(pre); changed();
    announce(`Renamed to ${G.label(M, o)}.`);
  }
  function setColor(c) {
    const o = st.sel && G.byId(M, st.sel);
    if (!o) return;
    commit(() => { if (c) o.color = c; else delete o.color; });
  }
  function toggleHidden() {
    const o = st.sel && G.byId(M, st.sel);
    if (!o) return;
    commit(() => { if (o.hidden) delete o.hidden; else o.hidden = true; });
    announce(o.hidden ? `${G.label(M, o)} is hidden; it still counts for what is built on it.` : `${G.label(M, o)} is shown.`);
  }

  /* ---------- toolbar ---------- */
  const btn = (label, title, fn, extra) => h('button.gm__b', { type: 'button', title, 'aria-label': title, onclick: fn, ...(extra || {}) }, h('span', { text: label }));
  const toggleView = key => { M.view = { ...G.viewOf(M), [key]: !G.viewOf(M)[key] }; st.dirty = true; clearTimeout(saveTimer); if (st.path) saveTimer = setTimeout(() => { if (!dead) saveFile(true); }, 700); render(); };
  const B = {
    undo: btn('Undo', 'Undo (Ctrl+Z)', undo, { dataset: { fk: 'geo-undo' } }),
    redo: btn('Redo', 'Redo (Ctrl+Shift+Z)', redo, { dataset: { fk: 'geo-redo' } }),
    del: btn('Delete', 'Delete the selected object and what is built on it', () => deleteSel(), { dataset: { fk: 'geo-delete' } }),
    snap: btn('Snap', 'Snap new points to the grid', () => { st.snap = !st.snap; paintBar(); }, { dataset: { fk: 'geo-snap' } }),
    grid: btn('Grid', 'Show the grid', () => toggleView('grid'), { dataset: { fk: 'geo-grid' } }),
    axes: btn('Axes', 'Show the axes and their numbers', () => toggleView('axes'), { dataset: { fk: 'geo-axes' } }),
    coords: btn('Coordinates', 'Show each point’s coordinates', () => toggleView('coords'), { dataset: { fk: 'geo-coords' } }),
    save: btn('Save', 'Save to Documents (Ctrl+S)', () => saveFile(false), { dataset: { fk: 'geo-save' } }),
    open: btn('Open', 'Open the chosen sketch', () => openChosen(), { dataset: { fk: 'geo-open' } }),
    png: btn('PNG', 'Export the figure as a PNG picture into Pictures', () => exportImage('png'), { dataset: { fk: 'geo-png' } }),
    svgOut: btn('SVG', 'Export the figure as an SVG drawing into Pictures', () => exportImage('svg'), { dataset: { fk: 'geo-svg' } }),
    print: btn('Print', 'Print the figure and its measurements', () => printSketch(), { dataset: { fk: 'geo-print' } }),
    zin: btn('+', 'Zoom in', () => zoom(1.25)), zout: btn('−', 'Zoom out', () => zoom(1 / 1.25)), home: btn('Reset view', 'Reset the view', () => { st.view = { cx: 0, cy: 0, k: 40 }; render(); }),
    newer: btn('New', 'Start a new empty sketch', () => newSketch(), { dataset: { fk: 'geo-new' } }),
  };
  const toolBtns = TOOLS.map(([id, label, key]) => h('button.gm__b', { type: 'button', title: `${label} (${key.toUpperCase()})`, 'aria-pressed': 'false', dataset: { fk: 'geo-tool', tool: id }, onclick: () => setTool(id) }, h('span', { text: label })));
  const moreSels = Object.entries(MORE).map(([group, [label, items]]) => h('select.gm__more', {
    'aria-label': `${label} tools`, dataset: { fk: `geo-more-${group}` },
    onchange: e => { if (e.target.value) setTool(e.target.value); },
  }, h('option', { value: '', text: `${label}…` }), items.map(([id, l, key]) => h('option', { value: id, text: key ? `${l} (${key.toUpperCase()})` : l }))));
  const sep = () => h('span.gm__sep', { 'aria-hidden': 'true' });
  const bar = h('div.gm__bar', { role: 'toolbar', 'aria-label': 'Sketch tools' }, ...toolBtns, sep(), ...moreSels, sep(), B.snap, B.grid, B.axes, B.coords, sep(), B.undo, B.redo, B.del, sep(), B.zout, B.zin, B.home);
  /* the number some tools need: the angle of a turn, a scale factor, the sides of a regular polygon */
  const optIn = h('input.gm__in', { type: 'number', step: 'any', 'aria-label': 'Tool setting', dataset: { fk: 'geo-opt' }, oninput: e => setOpt(e.target.value) });
  const optLabel = h('span');
  const optRow = h('div.gm__opt', { hidden: true, dataset: { fk: 'geo-optrow' } }, h('label', optLabel, optIn), h('span', { dataset: { fk: 'geo-opt-why' } }));
  const OPT = { rotate: ['Turn by (degrees, anticlockwise)', 'deg'], dilate: ['Scale factor', 'scale'], regpoly: ['Number of sides (3 to 24)', 'sides'] };
  function setOpt(v) {
    const o = OPT[st.tool];
    if (!o) return;
    const n = Number(v), why = optRow.querySelector('[data-fk="geo-opt-why"]');
    const okv = o[1] === 'sides' ? Number.isInteger(n) && n >= 3 && n <= 24 : o[1] === 'scale' ? Number.isFinite(n) && n !== 0 && Math.abs(n) <= 1000 : Number.isFinite(n) && Math.abs(n) <= 3600;
    why.textContent = okv || v === '' ? '' : o[1] === 'sides' ? 'Use a whole number from 3 to 24.' : o[1] === 'scale' ? 'Use a number that is not 0.' : 'Use a number of degrees.';
    if (okv) st[o[1]] = n;
  }
  const aside = h('div.gm__side',
    h('h3', { text: 'Add a point' }),
    h('form.gm__form', { onsubmit: addByCoords }, h('label', { text: 'x ' }, px), h('label', { text: 'y ' }, py), h('button.gm__b', { type: 'submit', dataset: { fk: 'geo-addpoint' } }, h('span', { text: 'Add' }))),
    selBox,
    h('h3', { text: 'Sketch file' }),
    h('div.gm__form', B.save, B.newer, files, B.open),
    h('div.gm__form', B.png, B.svgOut, B.print),
    h('h3', { text: 'Measurements (grid units)' }), list);
  const el = h('div.gm', h('style', { text: CSS }), bar, optRow, h('div.gm__main', h('div.gm__stage', svg, hint), aside));
  root.appendChild(el);

  function paintBar() {
    for (const b of toolBtns) b.setAttribute('aria-pressed', String(b.dataset.tool === st.tool));
    for (const s of moreSels) { const has = [...s.options].some(o => o.value && o.value === st.tool); s.value = has ? st.tool : ''; s.classList.toggle('is-on', has); }
    B.snap.setAttribute('aria-pressed', String(st.snap));
    const v = G.viewOf(M);
    B.grid.setAttribute('aria-pressed', String(v.grid)); B.axes.setAttribute('aria-pressed', String(v.axes)); B.coords.setAttribute('aria-pressed', String(v.coords));
    B.undo.disabled = !undoStack.length; B.redo.disabled = !redoStack.length; B.del.disabled = !st.sel;
    const o = OPT[st.tool];
    optRow.hidden = !o;
    if (o) { optLabel.textContent = `${o[0]} `; if (document.activeElement !== optIn) optIn.value = String(st[o[1]]); }
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
    const w = world(e);
    if (st.tool === 'select') {
      const t = hit(e);
      if (t) {
        st.sel = t.id;
        const o = G.byId(M, t.id);
        render();
        if (o.type === 'point') st.drag = { type: 'point', id: t.id, pre: snap(), moved: false, dx: R.get(t.id).x - w.x, dy: R.get(t.id).y - w.y };
        else if (o.type === 'on') st.drag = { type: 'on', id: t.id, pre: snap(), moved: false };
        else if (isPoint(o.id)) announce(`${o.name} is built from other points, so it moves when they do. Drag one of those instead.`);
      } else st.drag = { type: 'pan', x: e.clientX, y: e.clientY, cx: st.view.cx, cy: st.view.cy, moved: false };
      return;
    }
    const want = wants();
    if (st.tool === 'on') { const t = hit(e, o => isCurve(o.id)); if (t) pick(t); else announce(STEPS.on[0]); return; }
    if (want) {
      if (want === 'point') { const t = hit(e, o => isPoint(o.id)); pick(t || place(w)); }
      else { const t = hit(e, o => fits(want, o.id)); if (t) pick(t); else announce(WANT_TEXT[want]); }
      return;
    }
    const t = hit(e);
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
    const o = G.byId(M, d.id);
    if (!o) return;
    if (d.type === 'on') {
      const L = R.get(o.l);
      if (!L || !L.ok) return;
      const t = Math.round(G.onParam(L, w) * 1e6) / 1e6;
      if (t === o.t) return;
      if (!d.moved) { d.moved = true; checkpoint(d.pre); }
      o.t = t;
      changed();
      return;
    }
    const p = place({ x: w.x + d.dx, y: w.y + d.dy });
    if (o.x === p.x && o.y === p.y) return;
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
    const tool = ALL_TOOLS.find(t => t[2] && t[2] === k.toLowerCase());
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
      } else if (o && o.type === 'on') {
        /* along its path: a twentieth of a segment, 5° of a circle, a unit along a line (Shift: a tenth of that) */
        const L = R.get(o.l);
        if (!L || !L.ok) return;
        const dir = dx || dy, f = e.shiftKey ? 0.1 : 1;
        const stp = L.kind === 'seg' ? 0.05 : L.kind === 'circle' ? Math.PI / 36 : 1 / Math.max(1e-9, Math.hypot(L.x2 - L.x1, L.y2 - L.y1));
        commit(() => { o.t = Math.round((L.kind === 'seg' ? Math.max(0, Math.min(1, o.t + dir * stp * f)) : o.t + dir * stp * f) * 1e6) / 1e6; });
      } else if (o && isPoint(o.id)) announce(`${o.name} is built from other points; select one of those to move it.`);
      else { st.view.cx += dx * 50 / st.view.k; st.view.cy += dy * 50 / st.view.k; render(); }
    } else if (k === '+' || k === '=') zoom(1.25);
    else if (k === '-' || k === '_') zoom(1 / 1.25);
    else if (k === '0') { st.view = { cx: 0, cy: 0, k: 40 }; render(); }
  });

  /* ---------- export and print ---------- */
  const sketchName = () => (st.path ? vfs.baseName(st.path).replace(/\.geo$/i, '') : 'Sketch');
  /* the figure as a drawing that stands alone: every colour written out, no classes */
  function standalone() {
    const live = figure(null);
    const host = S('svg', { xmlns: NS, width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'gm__svg', style: 'position:absolute;left:-99999px;top:0' }, live);
    el.querySelector('.gm__stage').append(host);
    const out = S('svg', { xmlns: NS, width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const bg = getComputedStyle(el.querySelector('.gm__stage')).getPropertyValue('--bg-2').trim() || '#16181d';
    out.append(S('rect', { x: 0, y: 0, width: W, height: H, fill: bg }));
    const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin', 'paint-order', 'font-size', 'font-weight', 'font-style', 'font-family'];
    const copyTree = (src, dst) => {
      for (const n of src.childNodes) {
        if (n.nodeType === 3) { dst.append(document.createTextNode(n.textContent)); continue; }
        if (n.nodeType !== 1) continue;
        const c = document.createElementNS(NS, n.tagName);
        for (const a of n.attributes) if (!['class', 'style', 'data-id', 'data-fk'].includes(a.name)) c.setAttribute(a.name, a.value);
        const cs = getComputedStyle(n);
        c.setAttribute('style', PROPS.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';'));
        dst.append(c);
        copyTree(n, c);
      }
    };
    const g = S('g');
    copyTree(live, g);
    out.append(g);
    host.remove();
    return new XMLSerializer().serializeToString(out);
  }
  async function exportImage(kind) {
    try {
      const text = standalone();
      let blob = new Blob([text], { type: 'image/svg+xml' });
      if (kind === 'png') {
        const url = URL.createObjectURL(blob);
        try {
          const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('The figure could not be drawn.')); i.src = url; });
          const c = document.createElement('canvas');
          c.width = W * 2; c.height = H * 2;
          const x = c.getContext('2d');
          x.scale(2, 2);
          x.drawImage(img, 0, 0, W, H);
          blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not make the picture.'))), 'image/png'));
        } finally { URL.revokeObjectURL(url); }
      }
      const { path } = await media.save(`${vfs.HOME}/Pictures`, `${sketchName()}.${kind}`, blob);
      if (dead) return path;
      say(`Exported as ${kind.toUpperCase()}`, path.replace(vfs.HOME, '~'), 'image');
      return path;
    } catch (err) {
      say('Could not export', String(err.message || err), 'alert');
      return null;
    }
  }
  let printEl = null;
  function printSketch() {
    if (printEl) printEl.remove();
    const tmp = document.createElement('div');
    tmp.innerHTML = standalone();
    const fig = tmp.firstElementChild;
    const rows = G.measure(M, R).filter(r => !r.hidden);
    printEl = h('div.geo-print', { 'aria-hidden': 'true' },
      h('h1', { text: sketchName() }),
      fig,
      h('table', h('thead', h('tr', h('th', { text: 'Object' }), h('th', { text: 'Measurements (grid units)' }))),
        h('tbody', rows.map(r => h('tr', h('td', { text: r.label }), h('td', { text: r.ok ? r.items.map(i => `${i.k}: ${i.v}${i.unit ? (i.unit === '°' ? '°' : ` ${i.unit}`) : ''}`).join('; ') : `undefined: ${r.why}` }))))));
    document.body.appendChild(printEl);
    document.documentElement.classList.add('geo-printing');
    const done = () => { document.documentElement.classList.remove('geo-printing'); printEl?.remove(); printEl = null; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(done, 120000);
    try { window.print(); } catch (e) { done(); }
  }

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
    show: G.viewOf(M), opt: { deg: st.deg, scale: st.scale, sides: st.sides },
    objs: M.objs.map(o => ({ ...o })), solved: Object.fromEntries([...R].map(([id, r]) => [id, r])),
    screen: Object.fromEntries(M.objs.filter(o => isPoint(o.id) && R.get(o.id).ok).map(o => { const r = svg.getBoundingClientRect(); return [o.id, { x: r.left + sx(R.get(o.id).x), y: r.top + sy(R.get(o.id).y) }]; })),
  });
  root.geoSvg = () => standalone();

  return () => {
    dead = true;
    clearTimeout(saveTimer);
    if (st.path && st.dirty) { try { vfs.write(st.path, G.stringify(M)); } catch (e) { /* fine */ } }
    if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } }
    if (printEl) { printEl.remove(); document.documentElement.classList.remove('geo-printing'); }
    offs.splice(0).forEach(f => f());
  };
}
