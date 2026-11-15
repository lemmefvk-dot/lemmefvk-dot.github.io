/* ============================================================
   voxel.js — Voxel Studio: build small block scenes in 3D.

   A 16 × 16 × 16 grid of cubes, a palette of twelve soft colours, and a
   camera you turn around the scene. Drawn with core/mini3d.js (a software
   drawer, no WebGL); the grid itself is core/voxels.js.

   Mouse: click a face to put a block on it (or on the floor); right-click or
   Shift+click takes one away; drag to turn the scene; Shift+drag or
   middle-drag to pan; wheel to zoom.
   Keyboard (click the picture first, or Tab to it): arrows move the marker
   along the floor as you see it, PageUp / PageDown move it up and down,
   Enter or Space uses the tool at the marker, Delete takes the block away.
     B build   X erase   C colour a block      1 – 9, 0   pick a palette colour
     [ and ]   turn the scene                  − and =    zoom
     Ctrl+Z / Ctrl+Shift+Z   undo, redo        Ctrl+S     save

   A scene is a file: ~/Documents/<name>.blocks. Export .obj writes the
   faces you can see (coloured vertices, one unit per block, Y up) next to
   it in Documents, and the 3D Viewer opens it.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import * as V from '../core/voxels.js';
import * as M3 from '../core/mini3d.js';
import { quadsToOBJ } from '../core/meshfile.js';
import { saveDoc, readText } from '../core/diagramout.js';

const CSS = `
.vx{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1)}
.vx *{box-sizing:border-box}
.vx__bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-4);border-bottom:1px solid var(--line-1)}
.vx__b{height:28px;padding:0 10px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-1);font-size:var(--fs-12);border:1px solid var(--line-0);white-space:nowrap}
.vx__b:hover:not(:disabled){background:var(--fill-2);color:var(--ink-0)}
.vx__b:disabled{opacity:.4;cursor:default}
.vx__b[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.vx__sep{width:1px;height:18px;background:var(--line-1);margin:0 2px}
.vx__mid{flex:1;min-height:0;display:flex}
.vx__stage{position:relative;flex:1;min-width:0;min-height:0;background:var(--fill-0);overflow:hidden}
.vx__cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:crosshair;outline:none}
.vx__cv:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.vx__pal{flex:0 0 128px;border-left:1px solid var(--line-1);padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);font-size:var(--fs-12);overflow:auto}
.vx__pal h3{margin:0;font-size:var(--fs-12);color:var(--ink-0)}
.vx__sw{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.vx__sw button{aspect-ratio:1;border-radius:7px;border:2px solid transparent;box-shadow:0 0 0 1px var(--line-2);padding:0}
.vx__sw button:hover{transform:scale(1.08)}
.vx__sw button[aria-pressed=true]{border-color:var(--ink-0);box-shadow:0 0 0 2px var(--accent)}
.vx__col{display:flex;align-items:center;gap:6px;color:var(--ink-2)}
.vx__col input{width:34px;height:26px;padding:0;border:1px solid var(--line-2);border-radius:6px;background:var(--fill-1)}
.vx__count{color:var(--ink-3);font-size:var(--fs-11);line-height:1.5}
.vx__keys{padding:5px var(--sp-4);font-size:var(--fs-11);color:var(--ink-3);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-5);flex-wrap:wrap}
.vx__keys kbd{font:600 10px var(--mono);padding:1px 5px;border-radius:4px;border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-1)}
.vx__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

defineApp({
  id: 'voxel',
  name: 'Voxel Studio',
  icon: 'grid',
  g1: '#ffd37a', g2: '#e0602a',
  category: 'Create',
  keywords: ['voxel', 'blocks', '3d', 'build', 'cubes', 'model', 'obj', 'sculpt', 'pixel art', 'scene'],
  desc: 'Build small block scenes in 3D, save them, and export .obj for the 3D Viewer',
  handles: ['blocks'],
  exts: ['blocks'],
  win: { w: 940, h: 640, minW: 520, minH: 380 },
  shortcuts: [
    ['Left / Right / Up / Down', 'Move the marker on the floor'],
    ['PageUp / PageDown', 'Marker up / down'],
    ['Enter / Space', 'Use the tool at the marker'],
    ['Delete', 'Take away the block at the marker'],
    ['B / X / C', 'Build, erase, colour'],
    ['1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 0', 'Pick a palette colour'],
    ['[ / ]', 'Turn the scene'],
    ['Mod+Z', 'Undo'],
    ['Mod+Shift+Z', 'Redo'],
    ['Mod+S', 'Save'],
  ],
  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

const TOOLS = [['build', 'Build', 'B'], ['erase', 'Erase', 'X'], ['paint', 'Colour', 'C']];

function build(root, win, opts, api) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const say = (title, message, icon = 'grid', actions) => api.notify({ app: 'Voxel Studio', icon, title, message, timeout: actions ? 9000 : 4200, actions });

  /* ---------------- state ---------------- */
  let grid = V.createGrid();
  let palette = V.PALETTE.map(p => p[0]);
  const st = { tool: 'build', color: 1, cur: [7, 0, 7], path: null, dirty: false, lastObj: null, showCur: true };
  const undoStack = [], redoStack = [];
  let saveTimer = 0, meshCache = null, quadCache = null;
  const cam = M3.createCamera({ yaw: 0.8, pitch: 0.55, dist: 34, target: [8, 3, 8] });
  let queued = 0;

  const snapshot = () => ({ g: grid.slice(), p: palette.slice() });
  function checkpoint() { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; changed(); }
  function restore(s) { grid = s.g.slice(); palette = s.p.slice(); changed(); paintPalette(); }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); announce('Undone'); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); announce('Redone'); }
  function changed() {
    meshCache = quadCache = null;
    st.dirty = true;
    paintStatus();
    if (st.path) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!dead) saveFile(true); }, 700); }
    redraw();
  }

  /* ---------------- DOM ---------------- */
  const cv = h('canvas.vx__cv', { tabindex: '0', role: 'application', 'aria-label': 'Block scene. Arrow keys move the marker, Enter uses the tool.' });
  const live = h('div.vx__sr', { role: 'status', 'aria-live': 'polite' });
  const stage = h('div.vx__stage', cv, live);
  const btn = (label, title, fn, extra) => h('button.vx__b', { type: 'button', text: label, title, 'aria-label': title, onclick: fn, ...(extra || {}) });
  const toolBtns = Object.fromEntries(TOOLS.map(([id, name, key]) => [id, btn(name, `${name} (${key})`, () => setTool(id), { 'aria-pressed': String(id === st.tool), dataset: { tool: id } })]));
  const B = {
    undo: btn('Undo', 'Undo (Ctrl+Z)', () => undo()),
    redo: btn('Redo', 'Redo (Ctrl+Shift+Z)', () => redo()),
    clear: btn('Clear', 'Take every block away (Undo brings them back)', () => clearAll()),
    zout: btn('−', 'Zoom out', () => { M3.zoom(cam, 1.2); redraw(); }),
    zin: btn('+', 'Zoom in', () => { M3.zoom(cam, 1 / 1.2); redraw(); }),
    left: btn('⟲', 'Turn the scene left ([)', () => turn(-1)),
    right: btn('⟳', 'Turn the scene right (])', () => turn(1)),
    save: btn('Save', 'Save to Documents (Ctrl+S)', () => saveFile(false)),
    obj: btn('Export .obj', 'Write the scene as an .obj model next to it in Documents', () => exportObj()),
    view: btn('Open in 3D Viewer', 'Export the .obj and open it in the 3D Viewer', () => exportObj(true)),
  };
  const bar = h('div.vx__bar', { role: 'toolbar', 'aria-label': 'Voxel Studio tools' }, ...Object.values(toolBtns), h('span.vx__sep'), B.undo, B.redo, B.clear, h('span.vx__sep'), B.left, B.right, B.zout, B.zin, h('span.vx__sep'), B.save, B.obj, B.view);
  const swBox = h('div.vx__sw', { role: 'group', 'aria-label': 'Palette' });
  const picker = h('input', { type: 'color', 'aria-label': 'Change the selected colour', title: 'Change the selected colour (blocks in it change too)' });
  const countEl = h('div.vx__count', { role: 'status' });
  const pal = h('aside.vx__pal', { 'aria-label': 'Palette' }, h('h3', { text: 'Colours' }), swBox, h('label.vx__col', picker, h('span', { text: 'Change' })), countEl);
  const keys = h('div.vx__keys', ...[['Click', 'build'], ['Right-click', 'erase'], ['Drag', 'turn'], ['Arrows', 'marker'], ['PgUp/PgDn', 'up/down'], ['Enter', 'use tool'], ['1–0', 'colour']].map(([k, t]) => h('span', h('kbd', { text: k }), ' ' + t)));
  root.appendChild(h('div.vx', h('style', { text: CSS }), bar, h('div.vx__mid', stage, pal), keys));
  const ctx = cv.getContext('2d');
  const announce = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); };

  function paintPalette() {
    swBox.replaceChildren(...palette.map((hex, i) => h('button', { type: 'button', style: { background: hex }, title: `${V.PALETTE[i][1]}${i < 10 ? ` (${(i + 1) % 10})` : ''}`, 'aria-label': `Colour ${V.PALETTE[i][1]}`, 'aria-pressed': String(st.color === i + 1), dataset: { c: String(i + 1) }, onclick: () => pickColor(i + 1) })));
    picker.value = palette[st.color - 1];
  }
  function paintStatus() {
    const n = V.count(grid);
    countEl.textContent = `${n} block${n === 1 ? '' : 's'}`;
    win.setSubtitle(`${st.path ? vfs.baseName(st.path) : 'Unsaved scene'}${st.dirty ? (st.path ? ' · saving…' : ' · not saved') : ''}`);
    B.undo.disabled = !undoStack.length; B.redo.disabled = !redoStack.length;
  }
  function setTool(id) { st.tool = id; for (const [k, b] of Object.entries(toolBtns)) b.setAttribute('aria-pressed', String(k === id)); announce(`${TOOLS.find(t => t[0] === id)[1]} tool`); redraw(); }
  function pickColor(c) { st.color = c; for (const b of swBox.children) b.setAttribute('aria-pressed', String(+b.dataset.c === c)); picker.value = palette[c - 1]; announce(`Colour ${V.PALETTE[c - 1][1]}`); }
  on(picker, 'input', () => { checkpoint(); palette[st.color - 1] = picker.value; swBox.children[st.color - 1].style.background = picker.value; changed(); });

  /* ---------------- editing ---------------- */
  function act(cell, tool = st.tool) {
    const [x, y, z] = cell, i = V.idx(x, y, z);
    if (i < 0) return false;
    if (tool === 'build') { if (grid[i] === st.color) return false; checkpoint(); grid[i] = st.color; changed(); announce(`Block placed at ${x}, ${y}, ${z}`); return true; }
    if (!grid[i]) return false;
    if (tool === 'erase') { checkpoint(); grid[i] = 0; changed(); announce('Block taken away'); return true; }
    if (tool === 'paint') { if (grid[i] === st.color) return false; checkpoint(); grid[i] = st.color; changed(); announce('Block coloured'); return true; }
    return false;
  }
  function clearAll() { if (!V.count(grid)) return; checkpoint(); grid.fill(0); changed(); announce('Scene cleared'); }

  /* ---------------- drawing ---------------- */
  const size = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width)), hh = Math.max(10, Math.round(r.height));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    return { w, h: hh, dpr };
  };
  const lines = (w, hh, segs, style, lw) => {
    ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath();
    for (const [p, q] of segs) { const a = M3.project(cam, p, w, hh), b = M3.project(cam, q, w, hh); if (a && b) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } }
    ctx.stroke();
  };
  function paint() {
    queued = 0;
    if (dead) return;
    const { w, h: hh, dpr } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(cv).getPropertyValue('--fill-0').trim() || '#14141c';
    ctx.fillRect(0, 0, w, hh);
    const N = V.SIZE;
    const grids = [];
    for (let i = 0; i <= N; i++) { grids.push([[i, 0, 0], [i, 0, N]], [[0, 0, i], [N, 0, i]]); }
    lines(w, hh, grids, 'rgba(140,150,190,.3)', 1);
    if (!meshCache) { quadCache = V.quads(grid, palette); meshCache = V.meshOf(quadCache); }
    M3.draw(ctx, w, hh, meshCache, cam, {});
    /* the marker: where the tool will act */
    const [x, y, z] = st.cur;
    const cube = [], P = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]];
    for (let i = 0; i < 4; i++) {
      const a = P[i], b = P[(i + 1) % 4];
      cube.push([[x + a[0], y, z + a[2]], [x + b[0], y, z + b[2]]], [[x + a[0], y + 1, z + a[2]], [x + b[0], y + 1, z + b[2]]], [[x + a[0], y, z + a[2]], [x + a[0], y + 1, z + a[2]]]);
    }
    lines(w, hh, cube, st.tool === 'erase' ? '#ff5c6c' : getComputedStyle(cv).getPropertyValue('--accent').trim() || '#7c8cff', 2);
  }
  const redraw = () => { if (!queued) queued = requestAnimationFrame(paint); };
  const turn = d => { cam.yaw += d * (Math.PI / 12); redraw(); };

  /* ---------------- pointer ---------------- */
  const hoverAt = e => {
    const r = cv.getBoundingClientRect();
    return V.pick(grid, M3.ray(cam, e.clientX - r.left, e.clientY - r.top, r.width, r.height));
  };
  /* the cell a click would act on, for the tool in hand */
  const targetOf = (hit, tool = st.tool) => {
    if (!hit) return null;
    if (tool === 'build') {
      if (hit.floor) return hit.cell;
      const c = [hit.cell[0] + hit.face[0], hit.cell[1] + hit.face[1], hit.cell[2] + hit.face[2]];
      return V.inside(...c) ? c : null;
    }
    return hit.floor ? null : hit.cell;
  };
  let drag = null;
  on(cv, 'pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, pan: e.shiftKey && e.button === 0 ? 'maybe' : e.button === 1, id: e.pointerId, moved: false, shift: e.shiftKey };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
    cv.focus({ preventScroll: true });
    e.preventDefault();
  });
  on(cv, 'pointermove', e => {
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      drag.moved = true; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) M3.pan(cam, dx, dy, cv.getBoundingClientRect().height); else M3.orbit(cam, dx, dy);
      redraw();
      return;
    }
    const t = targetOf(hoverAt(e));
    if (t && (t[0] !== st.cur[0] || t[1] !== st.cur[1] || t[2] !== st.cur[2])) { st.cur = t; redraw(); }
  });
  const up = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (d.moved || e.type === 'pointercancel') return;
    const hit = hoverAt(e);
    if (d.button === 2 || d.shift) { const t = targetOf(hit, 'erase'); if (t) { st.cur = t; act(t, 'erase'); } }
    else if (d.button === 0) { const t = targetOf(hit); if (t) { st.cur = t; act(t); } }
  };
  on(cv, 'pointerup', up);
  on(cv, 'pointercancel', up);
  on(cv, 'contextmenu', e => e.preventDefault());
  on(cv, 'wheel', e => { e.preventDefault(); M3.zoom(cam, Math.exp(e.deltaY * 0.0015)); redraw(); }, { passive: false });

  /* ---------------- keyboard ---------------- */
  /* an arrow key moves the marker along the floor axis that points that way on screen */
  function moveCur(dir) {
    const { right, fwd } = M3.basis(cam);
    const axisOf = v => (Math.abs(v[0]) >= Math.abs(v[2]) ? [Math.sign(v[0]) || 1, 0] : [0, Math.sign(v[2]) || 1]);
    const [rx, rz] = axisOf(right), [fx, fz] = axisOf(fwd);
    const d = { ArrowRight: [rx, rz], ArrowLeft: [-rx, -rz], ArrowUp: [fx, fz], ArrowDown: [-fx, -fz] }[dir];
    st.cur = [Math.min(V.SIZE - 1, Math.max(0, st.cur[0] + d[0])), st.cur[1], Math.min(V.SIZE - 1, Math.max(0, st.cur[2] + d[1]))];
    announce(`Marker at ${st.cur.join(', ')}`);
    redraw();
  }
  on(root, 'keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.target instanceof HTMLInputElement) return;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); } else if (k === 'y') { redo(); e.preventDefault(); } else if (k === 's') { saveFile(false); e.preventDefault(); }
      return;
    }
    if (e.altKey || e.target !== cv) return;
    const k = e.key;
    if (k.startsWith('Arrow')) moveCur(k);
    else if (k === 'PageUp') { st.cur = [st.cur[0], Math.min(V.SIZE - 1, st.cur[1] + 1), st.cur[2]]; announce(`Marker at ${st.cur.join(', ')}`); redraw(); }
    else if (k === 'PageDown') { st.cur = [st.cur[0], Math.max(0, st.cur[1] - 1), st.cur[2]]; announce(`Marker at ${st.cur.join(', ')}`); redraw(); }
    else if (k === 'Enter' || k === ' ') act(st.cur);
    else if (k === 'Delete' || k === 'Backspace') act(st.cur, 'erase');
    else if (/^[bB]$/.test(k)) setTool('build');
    else if (/^[xX]$/.test(k)) setTool('erase');
    else if (/^[cC]$/.test(k)) setTool('paint');
    else if (/^[0-9]$/.test(k)) pickColor(k === '0' ? 10 : +k);
    else if (k === '[') turn(-1);
    else if (k === ']') turn(1);
    else if (k === '=' || k === '+') { M3.zoom(cam, 0.85); redraw(); }
    else if (k === '-' || k === '_') { M3.zoom(cam, 1 / 0.85); redraw(); }
    else return;
    e.preventDefault();
  });

  /* ---------------- files ---------------- */
  const stem = () => (st.path ? vfs.baseName(st.path).replace(/\.[^.]+$/, '') : 'Block scene');
  async function saveFile(auto) {
    clearTimeout(saveTimer);
    try {
      const p = await saveDoc(st.path, 'Block scene', 'blocks', V.serialize(grid, palette));
      if (!st.path) { st.path = p; win.state.reopen = { path: p }; }
      st.dirty = false;
      paintStatus();
      if (!auto) say('Saved', p.replace(vfs.HOME, '~'), 'save');
    } catch (err) { say('Could not save', String(err.message || err), 'alert'); }
  }
  async function exportObj(openAfter) {
    const qs = quadCache || V.quads(grid, palette);
    if (!qs.length) return say('Nothing to export', 'Place a block first.', 'alert');
    try {
      const p = await saveDoc(null, stem(), 'obj', quadsToOBJ(qs, stem()));
      st.lastObj = { path: p, quads: qs.length };
      root.dataset.lastExport = JSON.stringify(st.lastObj);
      if (openAfter) api.openFile(p);
      else say('Exported .obj', `${p.replace(vfs.HOME, '~')} · ${qs.length * 2} triangles`, 'box', [{ label: 'Open in 3D Viewer', onClick: () => api.openFile(p) }]);
    } catch (err) { say('Could not export', String(err.message || err), 'alert'); }
  }

  /* what a test (or a curious person) can ask for */
  root.voxelPeek = () => ({ path: st.path, dirty: st.dirty, tool: st.tool, color: st.color, cur: st.cur.slice(), count: V.count(grid), palette: palette.slice(), quads: (quadCache || V.quads(grid, palette)).length, undo: undoStack.length, redo: redoStack.length, lastObj: st.lastObj,
    cells: (() => { const out = []; for (let y = 0; y < V.SIZE; y++) for (let z = 0; z < V.SIZE; z++) for (let x = 0; x < V.SIZE; x++) { const c = grid[V.idx(x, y, z)]; if (c) out.push([x, y, z, c]); } return out; })(),
    /* where a block's centre is drawn, so a person (or test) can click it */
    screenOf: (x, y, z) => { const r = cv.getBoundingClientRect(); const p = M3.project(cam, [x, y, z], r.width, r.height); return p && { x: r.left + p[0], y: r.top + p[1] }; } });

  /* ---------------- open ---------------- */
  paintPalette();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => redraw()) : null;
  ro?.observe(stage);
  (async () => {
    if (opts && opts.path) {
      try {
        const text = await readText(opts.path);
        const r = V.parse(text || '');
        grid = r.grid; palette = r.palette; st.path = vfs.norm(opts.path); win.state.reopen = { path: st.path };
        meshCache = quadCache = null;
        paintPalette();
      } catch (err) { say('Could not open that file', `${vfs.baseName(opts.path)}: ${String(err.message || err)}`, 'alert'); }
    }
    if (dead) return;
    st.dirty = false;
    paintStatus();
    redraw();
  })();
  paintStatus();
  redraw();

  return () => {
    dead = true;
    clearTimeout(saveTimer);
    if (queued) cancelAnimationFrame(queued);
    if (st.path && st.dirty) { try { vfs.write(st.path, V.serialize(grid, palette)); } catch (e) { /* closing anyway */ } }
    ro?.disconnect();
    offs.splice(0).forEach(f => f());
  };
}
