/* ============================================================
   flowchart.js — Flowcharts: boxes joined by arrows, for a process, a
   decision, a plan. (Mind Maps is for trees of ideas; this is for any
   shape of diagram, with arrows going wherever you point them.)

   Boxes: Process, Decision (a diamond), Start / End (a pill) and Input /
   Output (a slanted box). Add one with its button or key; with a box
   selected the new one goes below it and an arrow joins them. Drag a box
   and its arrows follow: an arrow is only "from this box to that box" and
   is drawn fresh from the two boxes' edges every time, so it cannot come
   loose. Drag from one of the dots around a selected box onto another box
   to join them, or press L and choose the target.

   Arrows can carry a label ("Yes", "No", "retry") and are straight or
   elbowed. Everything is keyboard-reachable: Tab walks the boxes then the
   arrows, arrow keys move a box.
     N process   D decision   T start / end   I input / output
     Enter or F2  edit the words   L  join to another box   E  elbow / straight
     R reverse an arrow   1 – 7 colour   Arrows  move (Shift: 1 px)   Delete
     + − F  zoom, fit    Ctrl+Z / Ctrl+Shift+Z    Ctrl+S  save

   A chart is a file: ~/Documents/<name>.flow (JSON). PNG and SVG draw the
   same chart into ~/Pictures through core/diagramout.js.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import { saveDoc, exportSvg, exportPng, readText } from '../core/diagramout.js';

export const COLORS = ['#e3e7f2', '#8fd6f0', '#ffe27a', '#9be3b0', '#ffc58a', '#d2aaff', '#ff9db0'];
const COLOR_NAMES = ['Grey', 'Blue', 'Yellow', 'Green', 'Orange', 'Violet', 'Rose'];
export const KINDS = [['process', 'Process', 'N', 1], ['decision', 'Decision', 'D', 2], ['terminal', 'Start / End', 'T', 3], ['data', 'Input / Output', 'I', 5]];
const DEFAULT_COLOR = { process: 1, decision: 2, terminal: 3, data: 5 };
const FONT = '600 14px Inter, system-ui, sans-serif';
const MAX_LEN = 80, GRID = 10;
const INK = '#1d1a26', EDGE = '#4a4a5a';

let mctx = null;
const textW = t => { mctx = mctx || document.createElement('canvas').getContext('2d'); mctx.font = FONT; return mctx.measureText(t).width; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r1 = n => Math.round(n * 10) / 10;

/* the size a box needs for its words */
export function sizeOf(kind, text) {
  const tw = Math.ceil(textW(text || 'Step'));
  if (kind === 'decision') return { w: Math.max(150, tw + 84), h: 84 };
  if (kind === 'terminal') return { w: Math.max(120, tw + 48), h: 46 };
  if (kind === 'data') return { w: Math.max(140, tw + 64), h: 50 };
  return { w: Math.max(120, tw + 40), h: 50 };
}

/* where a ray from p (inside the box), heading (dx, dy), leaves the box's outline.
   A box is a convex shape: the diamond is four half-planes, the others a rectangle. */
export function exitPoint(n, p, dx, dy) {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2, hw = n.w / 2, hh = n.h / 2;
  const ux = p[0] - cx, uy = p[1] - cy;
  let t = Infinity;
  const planes = n.kind === 'decision'
    ? [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [sx / hw, sy / hh])
    : [[1 / hw, 0], [-1 / hw, 0], [0, 1 / hh], [0, -1 / hh]];
  for (const [ax, ay] of planes) {
    const den = ax * dx + ay * dy;
    if (den > 1e-12) t = Math.min(t, (1 - ax * ux - ay * uy) / den);
  }
  if (!Number.isFinite(t)) return [cx, cy];
  return [p[0] + dx * t, p[1] + dy * t];
}
/* where a line from the box's centre, heading (dx, dy), leaves its outline */
export const edgePoint = (n, dx, dy) => exitPoint(n, [n.x + n.w / 2, n.y + n.h / 2], dx, dy);

/** the polyline an arrow follows, from the two boxes as they are now */
export function route(a, b, style = 'straight', shift = 0) {
  const ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
  const dx = cb[0] - ca[0], dy = cb[1] - ca[1];
  if (style === 'elbow' && Math.abs(dx) > 8 && Math.abs(dy) > 8) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      const sx = dx > 0 ? a.x + a.w : a.x, ex = dx > 0 ? b.x : b.x + b.w, mx = (sx + ex) / 2;
      return [[sx, ca[1]], [mx, ca[1]], [mx, cb[1]], [ex, cb[1]]];
    }
    const sy = dy > 0 ? a.y + a.h : a.y, ey = dy > 0 ? b.y : b.y + b.h, my = (sy + ey) / 2;
    return [[ca[0], sy], [ca[0], my], [cb[0], my], [cb[0], ey]];
  }
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * shift, ny = dx / len * shift;
  /* two arrows between the same boxes run side by side: the line is shifted, then cut where it meets each outline */
  const p = exitPoint(a, [ca[0] + nx, ca[1] + ny], dx, dy), q = exitPoint(b, [cb[0] + nx, cb[1] + ny], -dx, -dy);
  return [p, q];
}

/* ---------- drawing: the same markup on screen and in an exported file ---------- */
function nodeMarkup(n, { sel = false, hot = false, text = true } = {}) {
  const fill = COLORS[n.color] || COLORS[0];
  const x = n.x, y = n.y, w = n.w, hh = n.h, cx = x + w / 2, cy = y + hh / 2;
  let shape;
  if (n.kind === 'decision') shape = `<polygon class="fc__shape" points="${cx},${y} ${x + w},${cy} ${cx},${y + hh} ${x},${cy}" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width="1.6" stroke-linejoin="round"/>`;
  else if (n.kind === 'terminal') shape = `<rect class="fc__shape" x="${x}" y="${y}" width="${w}" height="${hh}" rx="${hh / 2}" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>`;
  else if (n.kind === 'data') { const k = 16; shape = `<polygon class="fc__shape" points="${x + k},${y} ${x + w},${y} ${x + w - k},${y + hh} ${x},${y + hh}" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width="1.6" stroke-linejoin="round"/>`; }
  else shape = `<rect class="fc__shape" x="${x}" y="${y}" width="${w}" height="${hh}" rx="8" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>`;
  const label = text ? `<text x="${r1(cx)}" y="${r1(cy + 5)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600" fill="${INK}">${esc(n.text)}</text>` : '';
  void sel; void hot;
  return shape + label;
}
function arrowMarkup(pts, label, { sel = false } = {}) {
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${r1(p[0])} ${r1(p[1])}`).join(' ');
  const [px, py] = pts[pts.length - 2], [ex, ey] = pts[pts.length - 1];
  const len = Math.hypot(ex - px, ey - py) || 1, ux = (ex - px) / len, uy = (ey - py) / len;
  const hd = [[ex, ey], [ex - 11 * ux + 5 * -uy, ey - 11 * uy + 5 * ux], [ex - 11 * ux - 5 * -uy, ey - 11 * uy - 5 * ux]];
  let s = `<path class="fc-e" d="${d}" fill="none" stroke="${EDGE}" stroke-width="${sel ? 3 : 2}" stroke-linejoin="round"/><polygon class="fc-eh" points="${hd.map(p => `${r1(p[0])},${r1(p[1])}`).join(' ')}" fill="${EDGE}" stroke="${EDGE}" stroke-width="1" stroke-linejoin="round"/>`;
  if (label) {
    const m = midOf(pts), tw = Math.ceil(textW(label)) + 12;
    s += `<rect class="fc-lb" x="${r1(m[0] - tw / 2)}" y="${r1(m[1] - 11)}" width="${tw}" height="22" rx="11" fill="#ffffff" stroke="${EDGE}" stroke-width="1"/><text x="${r1(m[0])}" y="${r1(m[1] + 4.5)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" fill="${INK}">${esc(label)}</text>`;
  }
  return s;
}
/* the middle of a polyline, by length */
function midOf(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let at = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (at <= seg || i === pts.length - 1) { const t = seg ? at / seg : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
    at -= seg;
  }
  return pts[0];
}

const CSS = `
.fc{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1)}
.fc *{box-sizing:border-box}
.fc__bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-4);border-bottom:1px solid var(--line-1)}
.fc__b{height:28px;padding:0 10px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-1);font-size:var(--fs-12);border:1px solid var(--line-0);white-space:nowrap}
.fc__b:hover:not(:disabled){background:var(--fill-2);color:var(--ink-0)}
.fc__b:disabled{opacity:.4;cursor:default}
.fc__b[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.fc__sep{width:1px;height:18px;background:var(--line-1);margin:0 2px}
.fc__sw{width:18px;height:18px;border-radius:50%;border:2px solid transparent;box-shadow:0 0 0 1px var(--line-2);padding:0}
.fc__sw:hover{transform:scale(1.15)}
.fc__sw[aria-pressed=true]{border-color:var(--ink-0)}
.fc__board{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--fill-0);outline:none}
.fc__svg{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;background-image:radial-gradient(var(--line-2) 1px,transparent 1px);background-size:24px 24px}
.fc__svg.is-pan{cursor:grabbing}
.fc__n{cursor:pointer;outline:none}
.fc__n.is-sel .fc__shape{stroke:var(--accent);stroke-width:3.5}
.fc__n:focus-visible .fc__shape{stroke:var(--ink-0);stroke-width:3.5}
.fc__n.is-target .fc__shape{stroke:#ffb020;stroke-width:4}
.fc__n.is-from .fc__shape{stroke-dasharray:6 4}
.fc__e{cursor:pointer;outline:none}
.fc__e .fc-e{stroke:var(--ink-2)}
.fc__e .fc-eh{fill:var(--ink-2);stroke:var(--ink-2)}
.fc__e .fc-lb{fill:var(--fill-0);stroke:var(--ink-3)}
.fc__e text{fill:var(--ink-0)}
.fc__e.is-sel .fc-e{stroke:var(--accent)}
.fc__e.is-sel .fc-eh{fill:var(--accent);stroke:var(--accent)}
.fc__e:focus-visible .fc-e{stroke:var(--ink-0);stroke-width:3.5}
.fc__e .fc__hit{stroke:transparent;stroke-width:16;fill:none}
.fc__h{fill:var(--accent);stroke:var(--accent-ink,#fff);stroke-width:2;cursor:crosshair}
.fc__pre{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-dasharray:6 5;pointer-events:none}
.fc__in{position:absolute;z-index:3;display:none;border:2px solid var(--accent);border-radius:9px;background:#fff;color:#1d1a26;font:600 14px Inter,system-ui,sans-serif;text-align:center;padding:0 6px;height:30px}
.fc__hint{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:var(--ink-3);font-size:var(--fs-13);pointer-events:none;gap:6px}
.fc__hint[hidden]{display:none}
.fc__status{padding:5px var(--sp-4);font-size:var(--fs-11);color:var(--ink-3);border-top:1px solid var(--line-1);min-height:26px}
.fc__keys{padding:5px var(--sp-4);font-size:var(--fs-11);color:var(--ink-3);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-5);flex-wrap:wrap}
.fc__keys kbd{font:600 10px var(--mono);padding:1px 5px;border-radius:4px;border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-1)}
.fc__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

defineApp({
  id: 'flowchart',
  name: 'Flowcharts',
  icon: 'git-branch',
  g1: '#9ff0d0', g2: '#1a8f78',
  category: 'Create',
  keywords: ['flowchart', 'flow chart', 'diagram', 'boxes', 'arrows', 'process', 'decision', 'algorithm', 'plan', 'workflow', 'school', 'png', 'svg'],
  desc: 'Boxes and arrows that stay joined when you move them; export a picture',
  handles: ['flowchart'],
  exts: ['flow'],
  win: { w: 1000, h: 660, minW: 560, minH: 400 },
  shortcuts: [
    ['N / D / T / I', 'New process, decision, start / end, input / output box'],
    ['Enter / F2', 'Edit the words'],
    ['L', 'Join the box to another'],
    ['E', 'Elbow or straight arrow'],
    ['R', 'Reverse the arrow'],
    ['Left / Right / Up / Down', 'Move the box (Shift: 1 px)'],
    ['Delete', 'Remove'],
    ['Mod+Z', 'Undo'],
    ['Mod+Shift+Z', 'Redo'],
    ['Mod+S', 'Save'],
  ],
  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const say = (title, message, icon = 'git-branch') => api.notify({ app: 'Flowcharts', icon, title, message, timeout: 4200 });

  /* ---------------- the model ---------------- */
  let C = { nodes: [], edges: [], view: { x: 0, y: 0, k: 1 } };
  let seq = 0;
  const node = id => C.nodes.find(n => n.id === id);
  const edge = id => C.edges.find(e => e.id === id);
  const mk = (kind, text, x, y, color) => { const n = { id: `n${++seq}`, kind, text, x, y, color: color ?? DEFAULT_COLOR[kind], ...sizeOf(kind, text) }; return n; };
  const resize = n => Object.assign(n, sizeOf(n.kind, n.text));
  function load(data) {
    const kinds = KINDS.map(k => k[0]);
    const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter(n => n && typeof n.id === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y))
      .map(n => resize({ id: n.id, kind: kinds.includes(n.kind) ? n.kind : 'process', text: String(n.text ?? '').slice(0, MAX_LEN), x: n.x, y: n.y, color: Number.isInteger(n.color) && n.color >= 0 && n.color < COLORS.length ? n.color : 1 }));
    const ids = new Set(nodes.map(n => n.id));
    const edges = (Array.isArray(data.edges) ? data.edges : []).filter(e => e && typeof e.id === 'string' && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
      .map(e => ({ id: e.id, from: e.from, to: e.to, label: String(e.label ?? '').slice(0, 40), style: e.style === 'elbow' ? 'elbow' : 'straight' }));
    C = { nodes, edges, view: data.view && Number.isFinite(data.view.k) ? { x: data.view.x || 0, y: data.view.y || 0, k: Math.min(3, Math.max(0.25, data.view.k)) } : { x: 0, y: 0, k: 1 } };
    seq = Math.max(seq, ...nodes.map(n => +/^n(\d+)$/.exec(n.id)?.[1] || 0), ...edges.map(e => +/^e(\d+)$/.exec(e.id)?.[1] || 0));
  }
  const plain = () => ({ format: 'staticos-flowchart', v: 1,
    nodes: C.nodes.map(({ id, kind, text, x, y, color }) => ({ id, kind, text, x: Math.round(x), y: Math.round(y), color })),
    edges: C.edges.map(({ id, from, to, label, style }) => ({ id, from, to, label, ...(style === 'elbow' ? { style } : {}) })),
    view: { x: Math.round(C.view.x), y: Math.round(C.view.y), k: Number(C.view.k.toFixed(3)) } });
  const snap = () => JSON.stringify(plain());

  /* ---------------- state ---------------- */
  const st = { sel: null, selKind: null, edit: null, from: null, path: null, dirty: false };
  const undoStack = [], redoStack = [];
  let saveTimer = 0;
  function checkpoint(pre) { undoStack.push(pre || snap()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; changed(); }
  function restore(json) {
    const keep = C.view;
    load(JSON.parse(json));
    C.view = keep;
    if (st.sel && !(st.selKind === 'node' ? node(st.sel) : edge(st.sel))) st.sel = null;
    st.from = null;
    changed(); render();
  }
  function undo() { if (st.edit || !undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); announce('Undone'); }
  function redo() { if (st.edit || !redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); announce('Redone'); }
  function changed() {
    st.dirty = true;
    paintStatus();
    if (st.path) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!dead) saveFile(true); }, 700); }
  }

  /* ---------------- DOM ---------------- */
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'fc__svg');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Flowchart');
  const vp = document.createElementNS(NS, 'g');
  const gEdges = document.createElementNS(NS, 'g'), gNodes = document.createElementNS(NS, 'g'), gTop = document.createElementNS(NS, 'g');
  vp.append(gEdges, gNodes, gTop);
  svg.append(vp);
  const input = h('input.fc__in', { type: 'text', maxlength: String(MAX_LEN), 'aria-label': 'Words', autocomplete: 'off', spellcheck: 'false' });
  const hint = h('div.fc__hint', h('b', { text: 'An empty chart' }), h('span', { text: 'Press N for a box, or double-click anywhere. With a box selected, the next one goes below it with an arrow.' }));
  const live = h('div.fc__sr', { role: 'status', 'aria-live': 'polite' });
  const board = h('div.fc__board', { tabindex: '-1' }, svg, input, hint, live);
  const statusEl = h('div.fc__status', { role: 'status', dataset: { fk: 'fc-status' } });
  const btn = (label, title, fn, extra) => h('button.fc__b', { type: 'button', text: label, title, 'aria-label': title, onclick: fn, ...(extra || {}) });
  const kindBtns = KINDS.map(([id, name, key]) => btn(name, `New ${name.toLowerCase()} box (${key})`, () => addNode(id), { dataset: { kind: id } }));
  const B = {
    conn: btn('Join', 'Join the box to another (L)', () => toggleConnect(), { 'aria-pressed': 'false', dataset: { fk: 'fc-join' } }),
    elbow: btn('Elbow', 'Elbow or straight arrow (E)', () => toggleElbow(), { dataset: { fk: 'fc-elbow' } }),
    rev: btn('Reverse', 'Reverse the arrow (R)', () => reverse()),
    label: btn('Label', 'Edit the words or the arrow’s label (Enter)', () => startEdit()),
    del: btn('Delete', 'Remove (Delete)', () => removeSel()),
    undo: btn('Undo', 'Undo (Ctrl+Z)', () => undo()),
    redo: btn('Redo', 'Redo (Ctrl+Shift+Z)', () => redo()),
    zout: btn('−', 'Zoom out', () => zoomBy(1 / 1.25)),
    zin: btn('+', 'Zoom in', () => zoomBy(1.25)),
    fit: btn('Fit', 'Fit the whole chart (F)', () => fit()),
    save: btn('Save', 'Save to Documents (Ctrl+S)', () => saveFile(false)),
    png: btn('PNG', 'Export a picture (PNG) to Pictures', () => exportPic('png')),
    svgx: btn('SVG', 'Export a vector picture (SVG) to Pictures', () => exportPic('svg')),
  };
  const sep = () => h('span.fc__sep');
  const swatches = COLORS.map((c, i) => h('button.fc__sw', { type: 'button', style: { background: c }, title: `${COLOR_NAMES[i]} (${i + 1})`, 'aria-label': `Colour: ${COLOR_NAMES[i]}`, 'aria-pressed': 'false', onclick: () => recolour(i) }));
  const bar = h('div.fc__bar', { role: 'toolbar', 'aria-label': 'Flowchart tools' }, ...kindBtns, sep(), B.conn, B.elbow, B.rev, B.label, B.del, sep(), ...swatches, sep(), B.undo, B.redo, sep(), B.zout, B.zin, B.fit, sep(), B.save, B.png, B.svgx);
  const keys = h('div.fc__keys', ...[['N', 'process'], ['D', 'decision'], ['T', 'start/end'], ['I', 'input/output'], ['Enter', 'words'], ['L', 'join'], ['E', 'elbow'], ['Del', 'remove'], ['Arrows', 'move']].map(([k, t]) => h('span', h('kbd', { text: k }), ' ' + t)));
  root.appendChild(h('div.fc', h('style', { text: CSS }), bar, board, statusEl, keys));
  const announce = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); };
  const note = msg => { statusEl.textContent = msg; announce(msg); };

  /* ---------------- view ---------------- */
  const applyView = () => { vp.setAttribute('transform', `translate(${C.view.x} ${C.view.y}) scale(${C.view.k})`); placeInput(); };
  const boardRect = () => { const r = board.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 500, l: r.left, t: r.top }; };
  const toWorld = (cx, cy) => { const b = boardRect(); return { x: (cx - b.l - C.view.x) / C.view.k, y: (cy - b.t - C.view.y) / C.view.k }; };
  function zoomAt(k, cx, cy) { const old = C.view.k; k = Math.min(3, Math.max(0.25, k)); C.view.x = cx - (cx - C.view.x) * (k / old); C.view.y = cy - (cy - C.view.y) * (k / old); C.view.k = k; applyView(); }
  const zoomBy = f => { const b = boardRect(); zoomAt(C.view.k * f, b.w / 2, b.h / 2); };
  function bbox() {
    if (!C.nodes.length) return null;
    return { x0: Math.min(...C.nodes.map(n => n.x)), y0: Math.min(...C.nodes.map(n => n.y)), x1: Math.max(...C.nodes.map(n => n.x + n.w)), y1: Math.max(...C.nodes.map(n => n.y + n.h)) };
  }
  function fit() {
    const b = bbox(), r = boardRect();
    if (!b) { C.view = { x: r.w / 2, y: r.h / 2, k: 1 }; applyView(); return; }
    const k = Math.min(1.25, Math.max(0.25, Math.min((r.w - 80) / (b.x1 - b.x0), (r.h - 80) / (b.y1 - b.y0))));
    C.view = { k, x: r.w / 2 - ((b.x0 + b.x1) / 2) * k, y: r.h / 2 - ((b.y0 + b.y1) / 2) * k };
    applyView();
  }
  const viewCentre = () => { const r = boardRect(); return { x: (r.w / 2 - C.view.x) / C.view.k, y: (r.h / 2 - C.view.y) / C.view.k }; };

  /* ---------------- drawing ---------------- */
  const shiftOf = e => (C.edges.some(o => o.from === e.to && o.to === e.from) ? 8 : 0);
  const routeOf = e => route(node(e.from), node(e.to), e.style, shiftOf(e));
  const nodeLabel = n => `${(KINDS.find(k => k[0] === n.kind) || KINDS[0])[1]}: ${n.text || 'empty'}`;
  const edgeLabel = e => `Arrow from ${node(e.from).text || 'empty'} to ${node(e.to).text || 'empty'}${e.label ? `, labelled ${e.label}` : ''}`;
  function render() {
    const focusWas = board.contains(document.activeElement) && document.activeElement !== input ? document.activeElement?.dataset?.id : null;
    gEdges.replaceChildren(); gNodes.replaceChildren(); gTop.replaceChildren();
    for (const e of C.edges) {
      const pts = routeOf(e);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', `fc__e${st.selKind === 'edge' && st.sel === e.id ? ' is-sel' : ''}`);
      g.dataset.id = e.id; g.dataset.type = 'edge';
      g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', edgeLabel(e));
      if (st.selKind === 'edge' && st.sel === e.id) g.setAttribute('aria-pressed', 'true');
      g.innerHTML = `<path class="fc__hit" d="${pts.map((p, i) => `${i ? 'L' : 'M'} ${r1(p[0])} ${r1(p[1])}`).join(' ')}"/>` + arrowMarkup(pts, st.edit === e.id ? '' : e.label, { sel: st.selKind === 'edge' && st.sel === e.id });
      gEdges.append(g);
    }
    for (const n of C.nodes) {
      const g = document.createElementNS(NS, 'g');
      const sel = st.selKind === 'node' && st.sel === n.id;
      g.setAttribute('class', `fc__n${sel ? ' is-sel' : ''}${st.from === n.id ? ' is-from' : ''}${hover === n.id ? ' is-target' : ''}`);
      g.dataset.id = n.id; g.dataset.type = 'node';
      g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', nodeLabel(n));
      if (sel) g.setAttribute('aria-pressed', 'true');
      g.innerHTML = nodeMarkup(n, { text: st.edit !== n.id });
      gNodes.append(g);
    }
    /* the dots to drag an arrow from */
    const s = st.selKind === 'node' && !st.edit ? node(st.sel) : null;
    if (s) for (const [side, x, y] of [['top', s.x + s.w / 2, s.y], ['right', s.x + s.w, s.y + s.h / 2], ['bottom', s.x + s.w / 2, s.y + s.h], ['left', s.x, s.y + s.h / 2]]) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', 'fc__h'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 6); c.dataset.handle = side;
      gTop.append(c);
    }
    if (preview) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('class', 'fc__pre'); p.setAttribute('d', `M ${preview[0]} ${preview[1]} L ${preview[2]} ${preview[3]}`);
      gTop.append(p);
    }
    hint.hidden = C.nodes.length > 0;
    swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(st.selKind === 'node' && node(st.sel)?.color === i)));
    B.conn.setAttribute('aria-pressed', String(!!st.from));
    B.undo.disabled = !undoStack.length; B.redo.disabled = !redoStack.length;
    const haveSel = !!st.sel;
    B.del.disabled = B.label.disabled = !haveSel;
    B.elbow.disabled = B.rev.disabled = st.selKind !== 'edge';
    B.conn.disabled = st.selKind !== 'node';
    applyView();
    if (focusWas) focusEl(focusWas);
  }
  /* putting focus back on a redrawn box must not count as the person choosing it */
  let quiet = false;
  const focusEl = id => { const el = svg.querySelector(`[data-id="${id}"]`); if (el) { quiet = true; try { el.focus({ preventScroll: true }); } finally { quiet = false; } } };
  function paintStatus() {
    win.setSubtitle(`${st.path ? vfs.baseName(st.path) : 'Unsaved chart'}${st.dirty ? (st.path ? ' · saving…' : ' · not saved') : ''}`);
  }

  /* ---------------- editing the chart ---------------- */
  function select(id, kind) { st.sel = id; st.selKind = kind; }
  function addNode(kind, at) {
    if (st.edit) endEdit(true);
    const pre = snap();
    const from = st.selKind === 'node' ? node(st.sel) : null;
    const c = viewCentre();
    const n = mk(kind, '', 0, 0);
    if (at) { n.x = at.x - n.w / 2; n.y = at.y - n.h / 2; }
    else if (from) { n.x = from.x + from.w / 2 - n.w / 2; n.y = from.y + from.h + 54; }
    else if (C.nodes.length) { const b = bbox(); n.x = (b.x0 + b.x1) / 2 - n.w / 2; n.y = b.y1 + 54; }
    else { n.x = c.x - n.w / 2; n.y = c.y - n.h / 2; }
    n.x = Math.round(n.x / GRID) * GRID; n.y = Math.round(n.y / GRID) * GRID;
    C.nodes.push(n);
    if (from && !at) C.edges.push({ id: `e${++seq}`, from: from.id, to: n.id, label: '', style: 'straight' });
    select(n.id, 'node');
    checkpoint(pre);
    render();
    startEdit();
    return n;
  }
  function addEdge(fromId, toId) {
    if (fromId === toId || !node(fromId) || !node(toId)) return null;
    if (C.edges.some(e => e.from === fromId && e.to === toId)) { note('Those two boxes are already joined that way.'); return null; }
    const pre = snap();
    const e = { id: `e${++seq}`, from: fromId, to: toId, label: '', style: 'straight' };
    C.edges.push(e);
    select(e.id, 'edge');
    checkpoint(pre);
    render();
    note(`Arrow from ${node(fromId).text || 'a box'} to ${node(toId).text || 'a box'}. Press Enter to label it.`);
    return e;
  }
  function removeSel() {
    if (!st.sel) return;
    const pre = snap();
    if (st.selKind === 'node') { const id = st.sel; C.nodes = C.nodes.filter(n => n.id !== id); C.edges = C.edges.filter(e => e.from !== id && e.to !== id); }
    else C.edges = C.edges.filter(e => e.id !== st.sel);
    st.sel = null; st.selKind = null;
    checkpoint(pre); render();
    announce('Removed');
    board.focus({ preventScroll: true });
  }
  function recolour(i) { const n = st.selKind === 'node' ? node(st.sel) : null; if (!n || n.color === i) return; checkpoint(); n.color = i; render(); }
  function toggleElbow() { const e = st.selKind === 'edge' ? edge(st.sel) : null; if (!e) return; checkpoint(); e.style = e.style === 'elbow' ? 'straight' : 'elbow'; render(); note(`${e.style === 'elbow' ? 'Elbow' : 'Straight'} arrow`); }
  function reverse() { const e = st.selKind === 'edge' ? edge(st.sel) : null; if (!e) return; checkpoint(); [e.from, e.to] = [e.to, e.from]; render(); note('Arrow reversed'); }
  function toggleConnect() {
    if (st.from) { st.from = null; note('Join cancelled'); render(); return; }
    if (st.selKind !== 'node') return;
    st.from = st.sel; render();
    note('Choose where the arrow goes: click a box, or Tab to one and press Enter. Esc cancels.');
  }
  function nudge(dx, dy) {
    const n = st.selKind === 'node' ? node(st.sel) : null;
    if (!n) return;
    checkpoint(); n.x += dx; n.y += dy; render();
  }

  /* ---------------- editing words in place ---------------- */
  function startEdit() {
    const item = st.selKind === 'node' ? node(st.sel) : st.selKind === 'edge' ? edge(st.sel) : null;
    if (!item) return;
    st.edit = item.id;
    input.value = st.selKind === 'node' ? item.text : item.label;
    input.maxLength = st.selKind === 'node' ? MAX_LEN : 40;
    input.setAttribute('aria-label', st.selKind === 'node' ? 'Words in the box' : 'Arrow label');
    render();
    input.style.display = 'block';
    placeInput();
    input.focus(); input.select();
  }
  function placeInput() {
    if (!st.edit) return;
    const isNode = !!node(st.edit);
    let cx, cy, w;
    if (isNode) { const n = node(st.edit); cx = n.x + n.w / 2; cy = n.y + n.h / 2; w = Math.max(110, n.w - 20); }
    else { const e = edge(st.edit); if (!e) return; const m = midOf(routeOf(e)); cx = m[0]; cy = m[1]; w = 110; }
    const k = C.view.k;
    input.style.width = `${w * k}px`; input.style.height = `${30}px`;
    input.style.left = `${cx * k + C.view.x - (w * k) / 2}px`; input.style.top = `${cy * k + C.view.y - 15}px`;
  }
  function endEdit(commit) {
    if (!st.edit) return;
    const id = st.edit;
    st.edit = null;
    input.style.display = 'none';
    const n = node(id), e = n ? null : edge(id);
    const val = input.value.trim().slice(0, n ? MAX_LEN : 40);
    if (commit && n && val !== n.text) { checkpoint(); n.text = val; resize(n); }
    else if (commit && e && val !== e.label) { checkpoint(); e.label = val; }
    render();
    focusEl(id);
    if (!board.contains(document.activeElement)) board.focus({ preventScroll: true });
  }
  on(input, 'keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); endEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
    else if (e.key === 'Tab') { e.preventDefault(); endEdit(true); }
  });
  on(input, 'blur', () => { if (st.edit) endEdit(true); });
  on(input, 'input', () => {
    const n = node(st.edit);
    if (n) { n.text = input.value.slice(0, MAX_LEN); resize(n); const g = svg.querySelector(`[data-id="${n.id}"]`); if (g) g.innerHTML = nodeMarkup(n, { text: false }); for (const e of C.edges) if (e.from === n.id || e.to === n.id) { const eg = svg.querySelector(`[data-id="${e.id}"]`); if (eg) { const pts = routeOf(e); eg.innerHTML = `<path class="fc__hit" d="${pts.map((p, i) => `${i ? 'L' : 'M'} ${r1(p[0])} ${r1(p[1])}`).join(' ')}"/>` + arrowMarkup(pts, e.label); } } placeInput(); }
  });

  /* ---------------- pointer ---------------- */
  let drag = null, preview = null, hover = null, lastHit = null;
  const nodeAt = (wx, wy, skip) => [...C.nodes].reverse().find(n => n.id !== skip && wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h);
  on(svg, 'pointerdown', e => {
    if (st.edit) endEdit(true);
    const t = e.target.closest?.('[data-handle], [data-id]');
    const w = toWorld(e.clientX, e.clientY);
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
    lastHit = t && t.dataset.id ? { id: t.dataset.id, type: t.dataset.type } : null;
    if (t && t.dataset.handle) { drag = { type: 'link', from: st.sel, pid: e.pointerId }; e.preventDefault(); return; }
    if (t && t.dataset.type === 'node') {
      const n = node(t.dataset.id);
      if (st.from) { const f = st.from; st.from = null; addEdge(f, n.id); e.preventDefault(); return; }
      /* a press on what is already selected redraws nothing, so a double-click lands on one element */
      const was = st.selKind === 'node' && st.sel === n.id;
      select(n.id, 'node');
      drag = { type: 'move', id: n.id, ox: w.x - n.x, oy: w.y - n.y, pre: snap(), moved: false, pid: e.pointerId };
      if (!was) render();
      focusEl(n.id);
      e.preventDefault(); return;
    }
    if (t && t.dataset.type === 'edge') { const was = st.selKind === 'edge' && st.sel === t.dataset.id; select(t.dataset.id, 'edge'); if (!was) render(); focusEl(t.dataset.id); e.preventDefault(); return; }
    /* the background: deselect, and drag to pan */
    st.from = null; select(null, null);
    drag = { type: 'pan', x: e.clientX, y: e.clientY, vx: C.view.x, vy: C.view.y, pid: e.pointerId };
    svg.classList.add('is-pan');
    render();
    board.focus({ preventScroll: true });
  });
  on(svg, 'pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const w = toWorld(e.clientX, e.clientY);
    if (drag.type === 'pan') { C.view.x = drag.vx + e.clientX - drag.x; C.view.y = drag.vy + e.clientY - drag.y; applyView(); return; }
    if (drag.type === 'move') {
      const n = node(drag.id);
      if (!drag.moved) { if (Math.hypot(w.x - drag.ox - n.x, w.y - drag.oy - n.y) * C.view.k < 3) return; drag.moved = true; }
      n.x = w.x - drag.ox; n.y = w.y - drag.oy;
      render();
      return;
    }
    if (drag.type === 'link') {
      const a = node(drag.from);
      if (!a) return;
      const dx = w.x - (a.x + a.w / 2), dy = w.y - (a.y + a.h / 2);
      const p = edgePoint(a, dx, dy);
      preview = [p[0], p[1], w.x, w.y];
      const over = nodeAt(w.x, w.y, drag.from);
      hover = over ? over.id : null;
      render();
    }
  });
  const release = e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    svg.classList.remove('is-pan');
    if (d.type === 'move' && d.moved) {
      const n = node(d.id);
      n.x = Math.round(n.x / GRID) * GRID; n.y = Math.round(n.y / GRID) * GRID;
      undoStack.push(d.pre); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; changed();
      render();
    } else if (d.type === 'link') {
      const w = toWorld(e.clientX, e.clientY);
      const over = nodeAt(w.x, w.y, d.from);
      preview = null; hover = null;
      if (over && e.type === 'pointerup') addEdge(d.from, over.id); else render();
    }
  };
  on(svg, 'pointerup', release);
  on(svg, 'pointercancel', release);
  on(svg, 'dblclick', e => {
    /* the first click may have redrawn what was under the pointer, so the box or arrow is remembered from the press */
    const t = e.target.closest?.('[data-id]');
    /* no time limit: the double-click's second press has just set lastHit (or cleared it on the background),
       and the browser stamps dblclick when it hands it out, so a busy page would stretch any gap measured here */
    const hit = t ? { id: t.dataset.id, type: t.dataset.type } : lastHit;
    if (hit && (hit.type === 'node' ? node(hit.id) : edge(hit.id))) { select(hit.id, hit.type); render(); startEdit(); return; }
    const w = toWorld(e.clientX, e.clientY);
    addNode('process', w);
  });
  on(svg, 'wheel', e => { e.preventDefault(); const b = boardRect(); zoomAt(C.view.k * Math.exp(-e.deltaY * 0.0015), e.clientX - b.l, e.clientY - b.t); }, { passive: false });
  on(svg, 'focusin', e => {
    const t = e.target.closest?.('[data-id]');
    if (!t || quiet) return;
    if (st.from && t.dataset.type === 'node') return;                 /* choosing a target: selection stays put */
    if (st.sel !== t.dataset.id) { select(t.dataset.id, t.dataset.type); const keep = t.dataset.id; render(); focusEl(keep); }
  });

  /* ---------------- keyboard ---------------- */
  on(board, 'keydown', e => {
    if (e.target === input) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); }
      else if (lk === 'y') { redo(); e.preventDefault(); }
      else if (lk === 's') { saveFile(false); e.preventDefault(); }
      return;
    }
    if (e.altKey) return;
    const onItem = e.target.closest?.('[data-id]');
    /* the keys act on the box or arrow that has focus */
    if (onItem && !st.from && (st.sel !== onItem.dataset.id)) { select(onItem.dataset.id, onItem.dataset.type); render(); focusEl(onItem.dataset.id); }
    if (k === 'Enter' && st.from && onItem && onItem.dataset.type === 'node') { const f = st.from; st.from = null; addEdge(f, onItem.dataset.id); e.preventDefault(); return; }
    if (k === 'Escape') { if (st.from) { st.from = null; note('Join cancelled'); render(); } e.preventDefault(); return; }
    const kind = { n: 'process', d: 'decision', t: 'terminal', i: 'data' }[k.toLowerCase()];
    if (kind) { addNode(kind); e.preventDefault(); return; }
    if (k === 'Enter' || k === 'F2') { startEdit(); e.preventDefault(); }
    else if (k === 'Delete' || k === 'Backspace') { removeSel(); e.preventDefault(); }
    else if (k.toLowerCase() === 'l') { toggleConnect(); e.preventDefault(); }
    else if (k.toLowerCase() === 'e') { toggleElbow(); e.preventDefault(); }
    else if (k.toLowerCase() === 'r') { reverse(); e.preventDefault(); }
    else if (/^[1-7]$/.test(k)) recolour(+k - 1);
    else if (k.startsWith('Arrow')) { const d = e.shiftKey ? 1 : GRID; nudge(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0); e.preventDefault(); }
    else if (k === '+' || k === '=') zoomBy(1.25);
    else if (k === '-' || k === '_') zoomBy(1 / 1.25);
    else if (k.toLowerCase() === 'f') fit();
  });

  /* ---------------- files and pictures ---------------- */
  /* a chart is named for its topmost box with words: where the flow starts */
  const title = () => [...C.nodes].filter(n => n.text).sort((a, b) => a.y - b.y || a.x - b.x)[0]?.text || 'Flowchart';
  async function saveFile(auto) {
    clearTimeout(saveTimer);
    if (st.edit && !auto) endEdit(true);
    try {
      const p = await saveDoc(st.path, title(), 'flow', JSON.stringify(plain(), null, 1));
      if (!st.path) { st.path = p; win.state.reopen = { path: p }; }
      st.dirty = false; paintStatus();
      if (!auto) say('Saved', p.replace(vfs.HOME, '~'), 'save');
    } catch (err) { say('Could not save', String(err.message || err), 'alert'); }
  }
  /* the chart as a standalone drawing */
  function drawing() {
    if (!C.nodes.length) return null;
    const pad = 32;
    const b = bbox();
    let { x0, y0, x1, y1 } = b;
    const edges = C.edges.map(e => ({ e, pts: routeOf(e) }));
    for (const { e, pts } of edges) for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    for (const { e, pts } of edges) if (e.label) { const m = midOf(pts), tw = textW(e.label) / 2 + 8; x0 = Math.min(x0, m[0] - tw); x1 = Math.max(x1, m[0] + tw); }
    const W = Math.ceil(x1 - x0 + pad * 2), H = Math.ceil(y1 - y0 + pad * 2);
    const body = edges.map(({ e, pts }) => `<g>${arrowMarkup(pts, e.label)}</g>`).join('') + C.nodes.map(n => `<g>${nodeMarkup(n)}</g>`).join('');
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fbfbfd"/><g transform="translate(${r1(pad - x0)} ${r1(pad - y0)})">${body}</g></svg>`;
    return { svgText, W, H };
  }
  async function exportPic(kind) {
    const d = drawing();
    if (!d) return say('Nothing to export', 'Add a box first.', 'alert');
    try {
      const r = kind === 'svg' ? await exportSvg(d.svgText, title()) : await exportPng(d.svgText, d.W, d.H, title(), 2);
      root.dataset.lastExport = JSON.stringify({ kind, path: r.path, w: r.w || d.W, h: r.h || d.H, svgW: d.W, svgH: d.H });
      say(`Exported ${kind.toUpperCase()}`, r.path.replace(vfs.HOME, '~') + (r.w ? ` · ${r.w}×${r.h}` : ''), 'image');
    } catch (err) { say('Could not export', String(err.message || err), 'alert'); }
  }

  /* what a test (or a curious person) can ask for */
  root.flowPeek = () => ({ path: st.path, dirty: st.dirty, sel: st.sel, selKind: st.selKind, editing: st.edit, joining: st.from, view: { ...C.view },
    nodes: C.nodes.map(n => ({ id: n.id, kind: n.kind, text: n.text, x: n.x, y: n.y, w: n.w, h: n.h, color: n.color })),
    edges: C.edges.map(e => ({ id: e.id, from: e.from, to: e.to, label: e.label, style: e.style, pts: routeOf(e) })),
    screenOf: id => { const n = node(id); if (!n) return null; const r = board.getBoundingClientRect(); return { x: r.left + C.view.x + (n.x + n.w / 2) * C.view.k, y: r.top + C.view.y + (n.y + n.h / 2) * C.view.k }; } });

  /* ---------------- open ---------------- */
  (async () => {
    if (opts && opts.path) {
      try {
        const j = JSON.parse((await readText(opts.path)) || '{}');
        if (!j || !Array.isArray(j.nodes)) throw new Error('not a flowchart');
        load(j); st.path = vfs.norm(opts.path); win.state.reopen = { path: st.path };
      } catch (err) { say('Could not open that file', `${vfs.baseName(opts.path)} is not a flowchart.`, 'alert'); }
    }
    if (dead) return;
    st.dirty = false; paintStatus();
    render();
    const opened = C.nodes.length > 0;               /* a chart from a file is fitted; a new one is centred, unless the first box got there first */
    requestAnimationFrame(() => { if (dead) return; if (opened) fit(); else if (!C.nodes.length) { const r = boardRect(); C.view = { x: r.w / 2, y: r.h / 2, k: 1 }; applyView(); } });
  })();
  paintStatus(); render();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placeInput()) : null;
  ro?.observe(board);

  return () => {
    dead = true;
    clearTimeout(saveTimer);
    if (st.path && st.dirty) { try { vfs.write(st.path, JSON.stringify(plain(), null, 1)); } catch (e) { /* closing anyway */ } }
    ro?.disconnect();
    offs.splice(0).forEach(f => f());
  };
}
