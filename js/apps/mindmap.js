/* ============================================================
   mindmap.js — Mind Maps: bubbles you drag, ideas you connect.

   An SVG board. Keyboard first:
     Enter        a sibling idea            Tab         a child idea
     F2 / double-click   edit in place      Esc         stop editing
     Arrows       move between ideas        Alt+Arrows  nudge the idea
     Space        collapse / expand         Delete      remove the idea
     1 – 8        recolour                  L           connect to another idea
     + − F        zoom, fit                 Ctrl+Z / Ctrl+Shift+Z   undo, redo
     Ctrl+S       save

   Drag an idea to move it (its branch comes along); drag the
   background to pan; the wheel zooms. Double-click empty space for a
   free-standing idea.

   A map is a file: ~/Documents/<name>.mindmap (JSON — ideas, links, view).
   Export draws the same map as a standalone SVG or a PNG into ~/Pictures
   through core/media.js.

   Accessibility: the board is role="tree"; every idea is a treeitem with
   its level, position and expanded state; one idea is in the tab order
   and arrows move between them. Changes are announced in a status line.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import media from '../core/media.js';

export const COLORS = ['#e3e7f2', '#ff9db0', '#ffc58a', '#ffe27a', '#9be3b0', '#8fd6f0', '#9fb6ff', '#d2aaff'];
const COLOR_NAMES = ['Grey', 'Rose', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Violet'];
const NODE_H = 38, PAD_X = 16, MIN_W = 96, GAP_X = 64, GAP_Y = 14, MAX_LEN = 60;
const FONT = '600 14px Inter, system-ui, sans-serif';
const DOCS = `${vfs.HOME}/Documents`, PICS = `${vfs.HOME}/Pictures`;
const NS = 'http://www.w3.org/2000/svg';

let measureCtx = null;
const textWidth = t => {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = FONT;
  return measureCtx.measureText(t).width;
};
const widthOf = text => Math.max(MIN_W, Math.ceil(textWidth(text || 'Idea')) + PAD_X * 2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = (tag, attrs, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
};

const CSS = `
.mm{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1)}
.mm *{box-sizing:border-box}
.mm__bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-4);border-bottom:1px solid var(--line-1)}
.mm__b{height:28px;padding:0 10px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-1);font-size:var(--fs-12);border:1px solid var(--line-0);white-space:nowrap}
.mm__b:hover:not(:disabled){background:var(--fill-2);color:var(--ink-0)}
.mm__b:disabled{opacity:.4;cursor:default}
.mm__b[aria-pressed=true]{background:var(--fill-accent-hi);border-color:var(--line-accent);color:var(--ink-0)}
.mm__sep{width:1px;height:18px;background:var(--line-1);margin:0 2px}
.mm__sw{width:18px;height:18px;border-radius:50%;border:2px solid transparent;box-shadow:0 0 0 1px var(--line-2);padding:0}
.mm__sw:hover{transform:scale(1.15)}
.mm__sw[aria-pressed=true]{border-color:var(--ink-0)}
.mm__board{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--fill-0);outline:none}
.mm__svg{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;
  background-image:radial-gradient(var(--line-2) 1px,transparent 1px);background-size:24px 24px}
.mm__svg.is-pan{cursor:grabbing}
.mm__link{fill:none;stroke:var(--ink-3);stroke-width:2;opacity:.75}
.mm__cross{fill:none;stroke:var(--accent-soft);stroke-width:2;stroke-dasharray:6 5}
.mm__n{cursor:pointer;outline:none}
.mm__n rect{stroke:rgba(0,0,0,.28);stroke-width:1.5}
.mm__n text{font:600 14px Inter,system-ui,sans-serif;fill:#1d1a26;pointer-events:none;user-select:none}
.mm__n.is-sel rect{stroke:var(--accent);stroke-width:3.5}
.mm__n.is-from rect{stroke-dasharray:5 4}
.mm__n:focus-visible rect{stroke:var(--ink-0);stroke-width:3.5}
.mm__n .mm__badge{fill:#1d1a26;stroke:none}
.mm__n .mm__badget{fill:#fff;font-size:11px}
.mm__in{position:absolute;z-index:3;display:none;border:2px solid var(--accent);border-radius:9px;background:#fff;color:#1d1a26;font:600 14px Inter,system-ui,sans-serif;text-align:center;padding:0 6px;outline:none;transform-origin:center}
.mm__hint{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:var(--ink-3);font-size:var(--fs-13);pointer-events:none;gap:6px}
.mm__keys{padding:5px var(--sp-4);font-size:var(--fs-11);color:var(--ink-3);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-5);flex-wrap:wrap}
.mm__keys kbd{font:600 10px var(--mono);padding:1px 5px;border-radius:4px;border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-1)}
.mm__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

defineApp({
  id: 'mindmap',
  name: 'Mind Maps',
  icon: 'network',
  g1: '#a7c6ff', g2: '#4a55d6',
  category: 'Productivity',
  keywords: ['mind map', 'mindmap', 'brainstorm', 'ideas', 'diagram', 'concept map', 'bubbles', 'planning', 'notes', 'school', 'study'],
  desc: 'Drag bubbles, connect ideas and export the map as a picture',
  handles: ['mindmap'],
  win: { w: 980, h: 660, minW: 560, minH: 400 },
  shortcuts: [
    ['Enter', 'New sibling idea'],
    ['Tab', 'New child idea'],
    ['F2', 'Edit the idea'],
    ['Left / Right / Up / Down', 'Move between ideas'],
    ['Alt+Left / Alt+Right / Alt+Up / Alt+Down', 'Nudge the idea'],
    ['Space', 'Collapse or expand the branch'],
    ['Delete', 'Remove the idea'],
    ['L', 'Connect to another idea'],
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
  const say = (title, message, icon = 'network') => api.notify({ app: 'Mind Maps', icon, title, message, timeout: 4200 });

  /* ---------------- the model ---------------- */
  let M = { nodes: [], links: [], view: { x: 0, y: 0, k: 1 } };
  let seq = 0;
  const byId = new Map();
  const reindex = () => { byId.clear(); for (const n of M.nodes) byId.set(n.id, n); };
  const newId = () => `n${++seq}`;
  const kids = id => M.nodes.filter(n => n.parent === id);
  const descendants = id => { const out = []; const walk = p => { for (const k of kids(p)) { out.push(k); walk(k.id); } }; walk(id); return out; };
  const roots = () => M.nodes.filter(n => !n.parent || !byId.has(n.parent));
  const sizeNode = n => { n.w = widthOf(n.text); n.h = NODE_H; };
  const mk = (text, x, y, parent, color) => { const n = { id: newId(), text, x, y, parent: parent || null, color: color || 0, collapsed: false }; sizeNode(n); return n; };
  const bottomOf = n => Math.max(n.y + n.h, ...descendants(n.id).map(d => d.y + d.h));

  function load(data) {
    const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter(n => n && typeof n.id === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y))
      .map(n => ({ id: n.id, text: String(n.text ?? '').slice(0, MAX_LEN), x: n.x, y: n.y, parent: typeof n.parent === 'string' ? n.parent : null,
        color: Number.isInteger(n.color) && n.color >= 0 && n.color < COLORS.length ? n.color : 0, collapsed: !!n.collapsed }));
    nodes.forEach(sizeNode);
    const ids = new Set(nodes.map(n => n.id));
    M = { nodes, links: (Array.isArray(data.links) ? data.links : []).filter(l => Array.isArray(l) && ids.has(l[0]) && ids.has(l[1]) && l[0] !== l[1]).map(l => [l[0], l[1]]),
      view: data.view && Number.isFinite(data.view.k) ? { x: data.view.x || 0, y: data.view.y || 0, k: Math.min(3, Math.max(0.25, data.view.k)) } : { x: 0, y: 0, k: 1 } };
    seq = Math.max(0, ...nodes.map(n => Number(/^n(\d+)$/.exec(n.id)?.[1] || 0)));
    reindex();
  }
  const plain = () => ({ format: 'staticos-mindmap', v: 1,
    nodes: M.nodes.map(({ id, text, x, y, parent, color, collapsed }) => ({ id, text, x: Math.round(x), y: Math.round(y), parent, color, collapsed })),
    links: M.links, view: { x: Math.round(M.view.x), y: Math.round(M.view.y), k: Number(M.view.k.toFixed(3)) } });
  const snap = () => JSON.stringify(plain());

  /* ---------------- state ---------------- */
  const st = { sel: null, edit: null, from: null, path: null, dirty: false, saved: '' };
  const undoStack = [], redoStack = [];
  let saveTimer = 0;

  function checkpoint(pre) {
    undoStack.push(pre || snap());
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    changed();
  }
  function restore(json) {
    const keep = M.view;
    load(JSON.parse(json));
    M.view = keep;
    if (!byId.has(st.sel)) st.sel = M.nodes[0]?.id || null;
    st.from = null;
    changed();
    render();
  }
  function undo() { if (st.edit) return; if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); say2('Undone'); }
  function redo() { if (st.edit) return; if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); say2('Redone'); }
  function changed() {
    st.dirty = true;
    paintStatus();
    if (st.path) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!dead) saveFile(true); }, 700); }
  }

  /* ---------------- DOM ---------------- */
  const svg = S('svg', { class: 'mm__svg', role: 'tree', 'aria-label': 'Mind map', 'aria-orientation': 'horizontal' });
  const vp = S('g');
  const linksG = S('g'), nodesG = S('g');
  vp.append(linksG, nodesG);
  svg.append(vp);
  const input = h('input.mm__in', { type: 'text', maxlength: String(MAX_LEN), 'aria-label': 'Idea text', autocomplete: 'off', spellcheck: 'false' });
  const hint = h('div.mm__hint', h('b', { text: 'An empty board' }), h('span', { text: 'Press Enter, or double-click, to add your first idea.' }));
  const live = h('div.mm__sr', { role: 'status', 'aria-live': 'polite' });
  const board = h('div.mm__board', { tabindex: '-1' }, svg, input, hint, live);

  const btn = (label, title, fn, extra) => h('button.mm__b', { type: 'button', text: label, title, 'aria-label': title, onclick: fn, ...(extra || {}) });
  const B = {
    child: btn('Child', 'New child idea (Tab)', () => addChild()),
    sib: btn('Sibling', 'New sibling idea (Enter)', () => addSibling()),
    del: btn('Delete', 'Remove the idea (Delete)', () => removeSel()),
    conn: btn('Connect', 'Connect the idea to another (L)', () => toggleConnect(), { 'aria-pressed': 'false' }),
    fold: btn('Collapse', 'Collapse or expand the branch (Space)', () => toggleFold()),
    undo: btn('Undo', 'Undo (Ctrl+Z)', () => undo()),
    redo: btn('Redo', 'Redo (Ctrl+Shift+Z)', () => redo()),
    zout: btn('−', 'Zoom out', () => zoomBy(1 / 1.25)),
    zin: btn('+', 'Zoom in', () => zoomBy(1.25)),
    fit: btn('Fit', 'Fit the whole map (F)', () => fit()),
    tidy: btn('Tidy', 'Lay the branches out neatly', () => tidy()),
    save: btn('Save', 'Save to Documents (Ctrl+S)', () => saveFile(false)),
    png: btn('PNG', 'Export a picture (PNG) to Pictures', () => exportPng()),
    svgx: btn('SVG', 'Export a vector picture (SVG) to Pictures', () => exportSvg()),
  };
  const swatches = COLORS.map((c, i) => h('button.mm__sw', { type: 'button', style: { background: c }, title: `${COLOR_NAMES[i]} (${i + 1})`, 'aria-label': `Colour: ${COLOR_NAMES[i]}`, 'aria-pressed': 'false',
    onclick: () => recolour(i) }));
  const sep = () => h('span.mm__sep');
  const bar = h('div.mm__bar', { role: 'toolbar', 'aria-label': 'Mind map tools' }, B.child, B.sib, B.del, sep(), B.conn, B.fold, sep(), ...swatches, sep(), B.undo, B.redo, sep(), B.zout, B.zin, B.fit, B.tidy, sep(), B.save, B.png, B.svgx);
  const keys = h('div.mm__keys', ...[['Enter', 'sibling'], ['Tab', 'child'], ['F2', 'edit'], ['Space', 'collapse'], ['L', 'connect'], ['Del', 'remove'], ['1–8', 'colour']].map(([k, t]) => h('span', h('kbd', { text: k }), ' ' + t)));
  root.appendChild(h('div.mm', h('style', { text: CSS }), bar, board, keys));

  const say2 = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); };
  function paintStatus() {
    const name = st.path ? vfs.baseName(st.path) : 'Unsaved map';
    win.setSubtitle(`${name}${st.dirty ? (st.path ? ' · saving…' : ' · not saved') : ''}`);
  }

  /* ---------------- view ---------------- */
  const applyView = () => { vp.setAttribute('transform', `translate(${M.view.x} ${M.view.y}) scale(${M.view.k})`); placeInput(); };
  const boardSize = () => { const r = board.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 500, l: r.left, t: r.top }; };
  const toWorld = (cx, cy) => { const b = boardSize(); return { x: (cx - b.l - M.view.x) / M.view.k, y: (cy - b.t - M.view.y) / M.view.k }; };
  function zoomAt(k, cx, cy) {
    const old = M.view.k;
    k = Math.min(3, Math.max(0.25, k));
    M.view.x = cx - (cx - M.view.x) * (k / old);
    M.view.y = cy - (cy - M.view.y) * (k / old);
    M.view.k = k;
    applyView();
  }
  function zoomBy(f) { const b = boardSize(); zoomAt(M.view.k * f, b.w / 2, b.h / 2); }
  function visibleNodes() {
    const out = [];
    const walk = (n, level, pos, size) => {
      out.push({ n, level, pos, size });
      if (n.collapsed) return;
      const ks = kids(n.id);
      ks.forEach((k, i) => walk(k, level + 1, i + 1, ks.length));
    };
    const rs = roots();
    rs.forEach((r, i) => walk(r, 1, i + 1, rs.length));
    return out;
  }
  function fit() {
    const vis = visibleNodes().map(v => v.n);
    const b = boardSize();
    if (!vis.length) { M.view = { x: b.w / 2, y: b.h / 2, k: 1 }; applyView(); return; }
    const x0 = Math.min(...vis.map(n => n.x)), x1 = Math.max(...vis.map(n => n.x + n.w));
    const y0 = Math.min(...vis.map(n => n.y)), y1 = Math.max(...vis.map(n => n.y + n.h));
    const k = Math.min(1.25, Math.max(0.25, Math.min((b.w - 80) / (x1 - x0), (b.h - 80) / (y1 - y0))));
    M.view = { k, x: b.w / 2 - ((x0 + x1) / 2) * k, y: b.h / 2 - ((y0 + y1) / 2) * k };
    applyView();
  }
  /* the first look: centred on the map at a readable size */
  function centre() {
    const vis = visibleNodes().map(v => v.n);
    if (!vis.length) return fit();
    const b = boardSize();
    const k = M.view.k;
    const x0 = Math.min(...vis.map(n => n.x)), x1 = Math.max(...vis.map(n => n.x + n.w));
    const y0 = Math.min(...vis.map(n => n.y)), y1 = Math.max(...vis.map(n => n.y + n.h));
    M.view.x = b.w / 2 - ((x0 + x1) / 2) * k; M.view.y = b.h / 2 - ((y0 + y1) / 2) * k;
    applyView();
  }

  /* ---------------- drawing ---------------- */
  const sideOf = (a, b) => {
    const ac = a.x + a.w / 2, bc = b.x + b.w / 2;
    return bc >= ac ? [{ x: a.x + a.w, y: a.y + a.h / 2 }, { x: b.x, y: b.y + b.h / 2 }, 1] : [{ x: a.x, y: a.y + a.h / 2 }, { x: b.x + b.w, y: b.y + b.h / 2 }, -1];
  };
  const curve = (p, q, dir) => { const dx = Math.max(30, Math.abs(q.x - p.x) / 2) * dir; return `M${p.x},${p.y} C${p.x + dx},${p.y} ${q.x - dx},${q.y} ${q.x},${q.y}`; };
  const hiddenCount = n => (n.collapsed ? descendants(n.id).length : 0);

  function render() {
    const hadFocus = !st.edit && svg.contains(document.activeElement);
    reindex();
    const vis = visibleNodes();
    const shown = new Set(vis.map(v => v.n.id));
    const links = [];
    for (const { n } of vis) if (n.parent && shown.has(n.parent)) { const p = byId.get(n.parent); const [a, b, d] = sideOf(p, n); links.push(S('path', { class: 'mm__link', d: curve(a, b, d) })); }
    for (const [a, b] of M.links) if (shown.has(a) && shown.has(b)) { const [p, q, d] = sideOf(byId.get(a), byId.get(b)); links.push(S('path', { class: 'mm__cross', d: curve(p, q, d), 'data-link': `${a}:${b}` })); }
    linksG.replaceChildren(...links);
    const selOk = shown.has(st.sel);
    if (!selOk) st.sel = vis[0]?.n.id || null;
    const tabbable = st.sel;
    nodesG.replaceChildren(...vis.map(({ n, level, pos, size }) => {
      const hasKids = kids(n.id).length > 0;
      const g = S('g', { class: 'mm__n' + (n.id === st.sel ? ' is-sel' : '') + (n.id === st.from ? ' is-from' : ''), transform: `translate(${n.x} ${n.y})`,
        role: 'treeitem', tabindex: n.id === tabbable ? '0' : '-1', 'data-id': n.id, 'data-text': n.text, 'data-color': n.color,
        'aria-level': level, 'aria-posinset': pos, 'aria-setsize': size, 'aria-selected': String(n.id === st.sel),
        'aria-expanded': hasKids ? String(!n.collapsed) : null,
        'aria-label': `${n.text || 'Empty idea'}${hasKids ? (n.collapsed ? `, collapsed, ${hiddenCount(n)} hidden` : `, ${kids(n.id).length} child ideas`) : ''}` });
      g.append(S('rect', { width: n.w, height: n.h, rx: 12, fill: COLORS[n.color] }),
        S('text', { x: n.w / 2, y: n.h / 2 + 5, 'text-anchor': 'middle' }, n.text || '…'));
      if (n.collapsed && hasKids) g.append(S('circle', { class: 'mm__badge', cx: n.w, cy: 0, r: 11 }), S('text', { class: 'mm__badget', x: n.w, y: 4, 'text-anchor': 'middle' }, String(hiddenCount(n))));
      return g;
    }));
    hint.style.display = vis.length ? 'none' : 'grid';
    const sel = byId.get(st.sel);
    B.del.disabled = !sel;
    B.child.disabled = !sel && M.nodes.length > 0;
    B.fold.disabled = !sel || !kids(sel.id).length;
    B.fold.textContent = sel && sel.collapsed ? 'Expand' : 'Collapse';
    B.conn.setAttribute('aria-pressed', String(!!st.from));
    B.undo.disabled = !undoStack.length; B.redo.disabled = !redoStack.length;
    swatches.forEach((s, i) => s.setAttribute('aria-pressed', String(!!sel && sel.color === i)));
    svg.setAttribute('aria-label', `Mind map: ${roots()[0]?.text || 'untitled'}, ${M.nodes.length} ideas`);
    applyView();
    if (hadFocus) focusSel();
  }
  const focusSel = () => { const g = st.sel && nodesG.querySelector(`[data-id="${st.sel}"]`); if (g) g.focus({ preventScroll: true }); else board.focus({ preventScroll: true }); };

  function select(id, announce = true) {
    st.sel = id;
    render();
    focusSel();
    const n = byId.get(id);
    if (n && announce) say2(`${n.text || 'Empty idea'}`);
  }

  /* ---------------- editing the map ---------------- */
  function startEdit(id, isNew, cp = isNew) {
    const n = byId.get(id);
    if (!n) return;
    /* cp: the idea was made by an action that took an undo point of its own */
    st.edit = { id, isNew: !!isNew, cp: !!cp, snap: isNew ? null : snap(), orig: n.text };
    input.value = n.text;
    input.style.display = 'block';
    placeInput();
    input.focus();
    input.select();
  }
  function placeInput() {
    if (!st.edit) return;
    const n = byId.get(st.edit.id);
    if (!n) return;
    const k = M.view.k;
    const w = Math.max(n.w, widthOf(input.value)) * k;
    Object.assign(input.style, { left: `${M.view.x + (n.x + n.w / 2) * k - w / 2}px`, top: `${M.view.y + n.y * k}px`, width: `${w}px`, height: `${n.h * k}px`, fontSize: `${14 * k}px` });
  }
  function endEdit(commit) {
    const e = st.edit;
    if (!e) return;
    st.edit = null;
    input.style.display = 'none';
    const n = byId.get(e.id);
    if (n) {
      const text = input.value.trim();
      if (commit && text) {
        const was = n.text;
        n.text = text; sizeNode(n);
        if (!e.isNew && text !== was) checkpoint(e.snap);
        else changed();
      } else if (e.isNew) {
        /* an idea that never got a word is not kept, and its creation is not an undo step */
        if (e.cp) undoStack.pop();
        M.nodes = M.nodes.filter(x => x.id !== n.id);
        st.sel = n.parent && byId.has(n.parent) ? n.parent : M.nodes[0]?.id || null;
      } else { n.text = e.orig; sizeNode(n); }
    }
    render();
    focusSel();
  }
  on(input, 'input', () => {
    const n = st.edit && byId.get(st.edit.id);
    if (!n) return;
    n.text = input.value; sizeNode(n);
    render();
  });
  on(input, 'keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); const id = st.edit?.id; endEdit(true); if (id && e.shiftKey) addSibling(); }
    else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
    else if (e.key === 'Tab') { e.preventDefault(); const id = st.edit?.id; endEdit(true); if (id && byId.has(id)) { st.sel = id; addChild(); } }
  });
  on(input, 'blur', () => { if (st.edit) endEdit(true); });

  function addChild() {
    if (st.edit) return;
    const p = byId.get(st.sel);
    if (!p) return addFloating(0, 0);
    checkpoint();
    p.collapsed = false;
    const ks = kids(p.id);
    const y = ks.length ? bottomOf(ks[ks.length - 1]) + GAP_Y : p.y + (p.h - NODE_H) / 2;
    const n = mk('', p.x + p.w + GAP_X, y, p.id, p.color);
    M.nodes.push(n);
    st.sel = n.id;
    render();
    startEdit(n.id, true);
    say2('New child idea');
  }
  function addSibling() {
    if (st.edit) return;
    const s = byId.get(st.sel);
    if (!s) return addFloating(0, 0);
    if (!s.parent) return addChild();
    checkpoint();
    const n = mk('', s.x, bottomOf(s) + GAP_Y, s.parent, s.color);
    M.nodes.splice(M.nodes.indexOf(s) + 1 + descendants(s.id).length, 0, n);
    st.sel = n.id;
    render();
    startEdit(n.id, true);
    say2('New sibling idea');
  }
  function addFloating(x, y) {
    if (st.edit) return;
    checkpoint();
    const n = mk('', x - MIN_W / 2, y - NODE_H / 2, null, 0);
    M.nodes.push(n);
    st.sel = n.id;
    render();
    startEdit(n.id, true);
  }
  function removeSel() {
    const n = byId.get(st.sel);
    if (!n || st.edit) return;
    checkpoint();
    const gone = new Set([n.id, ...descendants(n.id).map(d => d.id)]);
    const sibs = kids(n.parent);
    const at = sibs.indexOf(n);
    M.nodes = M.nodes.filter(x => !gone.has(x.id));
    M.links = M.links.filter(([a, b]) => !gone.has(a) && !gone.has(b));
    st.sel = (sibs[at + 1] || sibs[at - 1] || (n.parent && byId.get(n.parent)))?.id || M.nodes[0]?.id || null;
    if (st.sel && gone.has(st.sel)) st.sel = M.nodes[0]?.id || null;
    st.from = null;
    render();
    focusSel();
    say2(`Removed ${gone.size > 1 ? gone.size + ' ideas' : 'the idea'}`);
  }
  function toggleFold() {
    const n = byId.get(st.sel);
    if (!n || !kids(n.id).length || st.edit) return;
    checkpoint();
    n.collapsed = !n.collapsed;
    render();
    say2(n.collapsed ? 'Collapsed' : 'Expanded');
  }
  function recolour(i) {
    const n = byId.get(st.sel);
    if (!n || st.edit || n.color === i) return;
    checkpoint();
    n.color = i;
    render();
    say2(COLOR_NAMES[i]);
  }
  function toggleConnect() {
    if (st.from) { st.from = null; render(); say2('Connect cancelled'); return; }
    if (!st.sel) return;
    st.from = st.sel;
    render();
    focusSel();
    say2('Connecting. Choose another idea, then press Enter, or click it. Escape cancels.');
  }
  function finishConnect(toId) {
    const a = st.from;
    st.from = null;
    if (!a || a === toId || !byId.has(toId)) { render(); return; }
    checkpoint();
    const i = M.links.findIndex(([x, y]) => (x === a && y === toId) || (x === toId && y === a));
    if (i >= 0) { M.links.splice(i, 1); say2('Link removed'); } else { M.links.push([a, toId]); say2('Connected'); }
    st.sel = toId;
    render();
    focusSel();
  }
  /* tree layout: branches left to right, tidy rows */
  function tidy() {
    if (!M.nodes.length || st.edit) return;
    checkpoint();
    let y = 0;
    const place = (n, x) => {
      const ks = kids(n.id).filter(() => !n.collapsed);
      n.x = x;
      if (!ks.length) { n.y = y; y += NODE_H + GAP_Y; return; }
      ks.forEach(k => place(k, x + n.w + GAP_X));
      n.y = (ks[0].y + ks[ks.length - 1].y) / 2;
    };
    const rs = roots();
    rs.forEach(r => { place(r, rs.length > 1 ? r.x : 0); y += GAP_Y * 2; });
    render();
    fit();
    say2('Tidied');
  }

  /* ---------------- pointer ---------------- */
  let drag = null;
  on(svg, 'pointerdown', e => {
    if (e.button !== 0) return;
    const g = e.target.closest('.mm__n');
    if (st.edit) endEdit(true);
    if (g) {
      const id = g.dataset.id;
      if (st.from) { finishConnect(id); e.preventDefault(); return; }
      st.sel = id;
      const n = byId.get(id);
      const w = toWorld(e.clientX, e.clientY);
      drag = { kind: 'node', id, start: { x: w.x, y: w.y }, orig: new Map([n, ...descendants(id)].map(d => [d.id, { x: d.x, y: d.y }])), moved: false, pre: snap(), pid: e.pointerId };
      svg.setPointerCapture(e.pointerId);
      render();
      focusSel();
      e.preventDefault();
    } else {
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, vx: M.view.x, vy: M.view.y, pid: e.pointerId };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('is-pan');
      board.focus({ preventScroll: true });
    }
  });
  on(svg, 'pointermove', e => {
    if (!drag) return;
    if (drag.kind === 'pan') { M.view.x = drag.vx + e.clientX - drag.x; M.view.y = drag.vy + e.clientY - drag.y; applyView(); return; }
    const w = toWorld(e.clientX, e.clientY);
    const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * M.view.k < 4) return;
    if (!drag.moved) { drag.moved = true; undoStack.push(drag.pre); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
    for (const [id, o] of drag.orig) { const n = byId.get(id); if (n) { n.x = o.x + dx; n.y = o.y + dy; } }
    render();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.kind === 'pan') svg.classList.remove('is-pan');
    if (drag.kind === 'node' && drag.moved) { changed(); say2('Moved'); }
    drag = null;
  };
  on(svg, 'pointerup', endDrag);
  on(svg, 'pointercancel', endDrag);
  on(svg, 'dblclick', e => {
    /* hit-test instead of trusting e.target: the pointer was captured, and the ideas are redrawn on every press */
    const g = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.mm__n');
    if (g) { select(g.dataset.id, false); startEdit(g.dataset.id, false); return; }
    const w = toWorld(e.clientX, e.clientY);
    addFloating(w.x, w.y);
  });
  on(svg, 'wheel', e => {
    e.preventDefault();
    const b = boardSize();
    zoomAt(M.view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - b.l, e.clientY - b.t);
  }, { passive: false });

  /* ---------------- keyboard ---------------- */
  function neighbour(dir) {
    const vis = visibleNodes();
    const cur = vis.find(v => v.n.id === st.sel);
    if (!cur) return vis[0]?.n.id;
    const n = cur.n;
    if (dir === 'left') return n.parent && shownHas(vis, n.parent) ? n.parent : null;
    if (dir === 'right') { if (n.collapsed && kids(n.id).length) { n.collapsed = false; render(); } return kids(n.id)[0]?.id || null; }
    const sibs = n.parent && byId.has(n.parent) ? kids(n.parent) : roots();
    const i = sibs.indexOf(n);
    return (dir === 'up' ? sibs[i - 1] : sibs[i + 1])?.id || null;
  }
  const shownHas = (vis, id) => vis.some(v => v.n.id === id);

  on(board, 'keydown', e => {
    if (st.edit || e.target === input) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod) {
      if (k === 's' || k === 'S') { e.preventDefault(); saveFile(false); }
      else if (k === 'z' || k === 'Z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === 'y' || k === 'Y') { e.preventDefault(); redo(); }
      return;
    }
    if (e.altKey && /^Arrow/.test(k) && st.sel) {
      e.preventDefault();
      const n = byId.get(st.sel);
      const step = e.shiftKey ? 40 : 10;
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
      checkpoint();
      for (const d of [n, ...descendants(n.id)]) { d.x += dx; d.y += dy; }
      render();
      return;
    }
    if (e.altKey) return;
    if (k === 'Enter') {
      e.preventDefault();
      if (st.from && st.sel) finishConnect(st.sel);
      else addSibling();
    } else if (k === 'Tab') { e.preventDefault(); if (!e.shiftKey) addChild(); else if (st.sel) { const p = byId.get(st.sel)?.parent; if (p) select(p); } }
    else if (k === 'F2') { e.preventDefault(); if (st.sel) startEdit(st.sel, false); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSel(); }
    else if (k === ' ') { e.preventDefault(); toggleFold(); }
    else if (k === 'Escape') {
      e.preventDefault();
      if (st.from) toggleConnect();
      else B.child.focus();                 /* the way out of the board for the keyboard */
    } else if (/^Arrow/.test(k)) {
      e.preventDefault();
      const id = neighbour({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[k]);
      if (id) select(id);
    } else if (/^[1-8]$/.test(k)) recolour(Number(k) - 1);
    else if (k === 'l' || k === 'L') toggleConnect();
    else if (k === '+' || k === '=') zoomBy(1.25);
    else if (k === '-' || k === '_') zoomBy(1 / 1.25);
    else if (k === 'f' || k === 'F') fit();
  });
  /* the board itself is only a landing spot: focus goes straight to the selected idea */
  on(board, 'focus', () => { if (!st.edit) { const g = st.sel && nodesG.querySelector(`[data-id="${st.sel}"]`); if (g) g.focus({ preventScroll: true }); } });

  /* ---------------- files ---------------- */
  const safeName = t => (String(t || '').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 40) || 'Mind map');
  function title() { return roots()[0]?.text || ''; }
  function saveFile(auto) {
    clearTimeout(saveTimer);
    if (st.edit && !auto) endEdit(true);
    const json = JSON.stringify(plain(), null, 1);
    try {
      if (!st.path) {
        if (!vfs.node(DOCS)) vfs.mkdir(DOCS);
        const stem = safeName(title());
        let name = `${stem}.mindmap`, i = 2;
        while (vfs.node(`${DOCS}/${name}`)) name = `${stem} ${i++}.mindmap`;
        const node = vfs.write(`${DOCS}/${name}`, json);
        if (!node) throw new Error('Documents is not available.');
        st.path = `${DOCS}/${name}`;
        win.state.reopen = { path: st.path };
      } else vfs.write(st.path, json);
      st.dirty = false;
      st.saved = json;
      paintStatus();
      if (!auto) say('Saved', st.path.replace(vfs.HOME, '~'), 'save');
    } catch (err) {
      say('Could not save', String(err.message || err), 'alert');
    }
  }

  /* ---------------- export ---------------- */
  const INK = '#1d1a26';
  function drawing(pad = 32) {
    const vis = visibleNodes().map(v => v.n);
    if (!vis.length) return null;
    const x0 = Math.min(...vis.map(n => n.x)), y0 = Math.min(...vis.map(n => n.y));
    const x1 = Math.max(...vis.map(n => n.x + n.w)), y1 = Math.max(...vis.map(n => n.y + n.h));
    const W = Math.ceil(x1 - x0 + pad * 2), H = Math.ceil(y1 - y0 + pad * 2);
    const ox = pad - x0, oy = pad - y0;
    const shown = new Set(vis.map(n => n.id));
    const parts = [];
    for (const n of vis) if (n.parent && shown.has(n.parent)) { const [a, b, d] = sideOf(byId.get(n.parent), n); parts.push(`<path d="${curve(a, b, d)}" fill="none" stroke="#7a7f93" stroke-width="2"/>`); }
    for (const [a, b] of M.links) if (shown.has(a) && shown.has(b)) { const [p, q, d] = sideOf(byId.get(a), byId.get(b)); parts.push(`<path d="${curve(p, q, d)}" fill="none" stroke="#d6336c" stroke-width="2" stroke-dasharray="6 5"/>`); }
    for (const n of vis) {
      parts.push(`<g transform="translate(${n.x} ${n.y})"><rect width="${n.w}" height="${n.h}" rx="12" fill="${COLORS[n.color]}" stroke="rgba(0,0,0,.28)" stroke-width="1.5"/>`
        + `<text x="${n.w / 2}" y="${n.h / 2 + 5}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="600" font-size="14" fill="${INK}">${esc(n.text || '…')}</text>`
        + (n.collapsed && kids(n.id).length ? `<circle cx="${n.w}" cy="0" r="11" fill="${INK}"/><text x="${n.w}" y="4" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" fill="#fff">${hiddenCount(n)}</text>` : '')
        + '</g>');
    }
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fbfbfd"/>`
      + `<g transform="translate(${ox} ${oy})">${parts.join('')}</g></svg>`;
    return { svgText, W, H };
  }
  async function exportSvg() {
    const d = drawing();
    if (!d) return say('Nothing to export', 'Add an idea first.', 'alert');
    try {
      const out = await media.save(PICS, `${safeName(title())}.svg`, new Blob([d.svgText], { type: 'image/svg+xml' }));
      say('Exported SVG', out.path.replace(vfs.HOME, '~'), 'image');
    } catch (err) { say('Could not export', String(err.message || err), 'alert'); }
  }
  const SCALE = 2;
  async function exportPng() {
    const d = drawing();
    if (!d) return say('Nothing to export', 'Add an idea first.', 'alert');
    try {
      const url = URL.createObjectURL(new Blob([d.svgText], { type: 'image/svg+xml' }));
      const img = new Image();
      img.src = url;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = d.W * SCALE; cv.height = d.H * SCALE;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!blob) throw new Error('The picture could not be made.');
      const out = await media.save(PICS, `${safeName(title())}.png`, blob);
      say('Exported PNG', `${out.path.replace(vfs.HOME, '~')} · ${cv.width}×${cv.height}`, 'image');
      root.dataset.lastExport = JSON.stringify({ path: out.path, w: cv.width, h: cv.height });
    } catch (err) { say('Could not export', String(err.message || err), 'alert'); }
  }

  /* what a test (or a curious person) can ask for */
  root.mindmapPeek = () => ({ path: st.path, dirty: st.dirty, sel: st.sel, editing: !!st.edit, nodes: M.nodes.map(n => ({ id: n.id, text: n.text, x: n.x, y: n.y, w: n.w, h: n.h, parent: n.parent, color: n.color, collapsed: n.collapsed })), links: M.links.slice(), view: { ...M.view }, scale: SCALE, pad: 32 });

  /* ---------------- open ---------------- */
  let fresh = true;
  const fileNode = opts && opts.path ? vfs.node(opts.path) : null;
  if (fileNode && fileNode.type === 'file') {
    try {
      const j = JSON.parse(vfs.read(opts.path) || '{}');
      if (j && Array.isArray(j.nodes)) { load(j); st.path = vfs.norm(opts.path); st.saved = snap(); fresh = false; win.state.reopen = { path: st.path }; }
      else throw new Error('not a mind map');
    } catch (err) {
      say('Could not open that file', `${vfs.baseName(opts.path)} is not a mind map.`, 'alert');
    }
  }
  if (fresh) { const r = mk('', 0, 0, null, 5); M.nodes.push(r); }
  reindex();
  st.sel = roots()[0]?.id || null;
  st.dirty = false;
  paintStatus();
  render();
  requestAnimationFrame(() => {
    if (dead) return;
    if (fresh) { M.view = { x: 0, y: 0, k: 1 }; centre(); }
    else applyView();
    if (fresh) startEdit(st.sel, true, false); else focusSel();
  });
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
