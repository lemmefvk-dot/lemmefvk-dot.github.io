/* ============================================================
   viewer3d.js — 3D Viewer: look at an .stl or .obj model from your Files.

   Open a model from Files (double-click it) or pick one from the list the
   viewer shows. ASCII and binary STL and Wavefront OBJ are read by
   core/meshfile.js; the drawing is core/mini3d.js, a software drawer on a
   canvas (no WebGL, so a very large model is thinned while you drag and
   drawn whole when you let go).

   Mouse: drag to orbit, Shift+drag / right-drag / middle-drag to pan, wheel
   to zoom. Keyboard (click the picture first):
     Arrows  orbit            Shift+Arrows  pan
     + / −   zoom             0 or R        reset the view
     W       wireframe        U             which way is up (Y or Z)
   STL files are usually made with Z up, OBJ with Y up; U flips it.

   What is shown is only what is in the file: the triangle count, the size
   of its bounding box in the file's own units (a file does not say whether
   those are millimetres) and the format. A model with colours on its
   vertices (Voxel Studio's .obj export) is drawn in them.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import { parseSTL, parseOBJ, bounds } from '../core/meshfile.js';
import { readBytes } from '../core/diagramout.js';
import * as M3 from '../core/mini3d.js';

const fmt = n => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3));
const HEAVY = 40000;

/** rotate a mesh so Z is up: (x, y, z) → (x, z, −y) */
function zUpMesh(mesh) {
  const pos = new Float32Array(mesh.pos.length);
  for (let i = 0; i < pos.length; i += 3) { pos[i] = mesh.pos[i]; pos[i + 1] = mesh.pos[i + 2]; pos[i + 2] = -mesh.pos[i + 1]; }
  return { ...mesh, pos };
}

const CSS = `
.v3{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1)}
.v3 *{box-sizing:border-box}
.v3__bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-4);border-bottom:1px solid var(--line-1)}
.v3__b{height:28px;padding:0 10px;border-radius:var(--r-sm);background:var(--fill-1);color:var(--ink-1);font-size:var(--fs-12);border:1px solid var(--line-0);white-space:nowrap}
.v3__b:hover:not(:disabled){background:var(--fill-2);color:var(--ink-0)}
.v3__b:disabled{opacity:.4;cursor:default}
.v3__b[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.v3__sep{width:1px;height:18px;background:var(--line-1);margin:0 2px}
.v3__mid{flex:1;min-height:0;display:flex}
.v3__stage{position:relative;flex:1;min-width:0;min-height:0;background:var(--fill-0);overflow:hidden}
.v3__cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none}
.v3__cv:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.v3__cv.is-drag{cursor:grabbing}
.v3__pick{position:absolute;inset:0;overflow:auto;padding:var(--sp-5);display:flex;flex-direction:column;gap:var(--sp-3);font-size:var(--fs-13)}
.v3__pick[hidden]{display:none}
.v3__pick h3{margin:0;font-size:var(--fs-15);color:var(--ink-0)}
.v3__pick p{margin:0;color:var(--ink-2);line-height:1.5}
.v3__list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;max-width:520px}
.v3__list button{width:100%;text-align:left;padding:7px 10px;border-radius:var(--r-sm);color:var(--ink-1);font-size:var(--fs-13);display:flex;justify-content:space-between;gap:12px;background:var(--fill-1);border:1px solid var(--line-0)}
.v3__list button:hover,.v3__list button:focus-visible{background:var(--fill-2);color:var(--ink-0)}
.v3__list small{color:var(--ink-3);font-size:var(--fs-11)}
.v3__info{flex:0 0 220px;border-left:1px solid var(--line-1);padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-3);font-size:var(--fs-12);overflow:auto}
.v3__info[hidden]{display:none}
.v3__info h3{margin:0;font-size:var(--fs-13);color:var(--ink-0);word-break:break-word}
.v3__info dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px}
.v3__info dt{color:var(--ink-3)}
.v3__info dd{margin:0;color:var(--ink-0);text-align:right;font-variant-numeric:tabular-nums}
.v3__keys{padding:5px var(--sp-4);font-size:var(--fs-11);color:var(--ink-3);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-5);flex-wrap:wrap}
.v3__keys kbd{font:600 10px var(--mono);padding:1px 5px;border-radius:4px;border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-1)}
.v3__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

defineApp({
  id: 'viewer3d',
  name: '3D Viewer',
  icon: 'box',
  g1: '#8fd6f0', g2: '#2a5fd0',
  category: 'Create',
  keywords: ['3d', 'model', 'stl', 'obj', 'mesh', 'viewer', 'print', 'cad', 'orbit', 'voxel'],
  desc: 'Look at .stl and .obj models from your Files: orbit, zoom and pan',
  handles: ['model3d'],
  exts: ['stl', 'obj'],
  win: { w: 900, h: 620, minW: 480, minH: 360 },
  shortcuts: [
    ['Left / Right / Up / Down', 'Orbit the model'],
    ['Shift+Left / Shift+Right / Shift+Up / Shift+Down', 'Pan'],
    ['Plus / -', 'Zoom'],
    ['0 / R', 'Reset the view'],
    ['W', 'Wireframe'],
    ['U', 'Which way is up (Y or Z)'],
  ],
  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const say = (title, message, icon = 'box') => api.notify({ app: '3D Viewer', icon, title, message, timeout: 4200 });

  /* ---------------- state ---------------- */
  const st = { path: null, name: '', mesh: null, raw: null, count: 0, format: '', b: null, wire: false, zUp: false, skipped: 0 };
  const cam = M3.createCamera();
  let drawn = 0, dragging = false, settle = 0, queued = 0;

  /* ---------------- DOM ---------------- */
  const cv = h('canvas.v3__cv', { tabindex: '0', role: 'img', 'aria-label': 'No model open' });
  const pick = h('div.v3__pick');
  const live = h('div.v3__sr', { role: 'status', 'aria-live': 'polite' });
  const stage = h('div.v3__stage', cv, pick, live);
  const info = h('aside.v3__info', { hidden: true, 'aria-label': 'About the model' });
  const btn = (label, title, fn, extra) => h('button.v3__b', { type: 'button', text: label, title, 'aria-label': title, onclick: fn, ...(extra || {}) });
  const B = {
    open: btn('Open…', 'Choose a model from your Files', () => showPicker()),
    wire: btn('Wireframe', 'Wireframe (W)', () => toggleWire(), { 'aria-pressed': 'false' }),
    up: btn('Up: Y', 'Which way is up, Y or Z (U)', () => toggleUp()),
    zout: btn('−', 'Zoom out', () => zoomBy(1.25)),
    zin: btn('+', 'Zoom in', () => zoomBy(0.8)),
    reset: btn('Reset', 'Reset the view (0)', () => resetView()),
  };
  const bar = h('div.v3__bar', { role: 'toolbar', 'aria-label': '3D viewer tools' }, B.open, h('span.v3__sep'), B.wire, B.up, h('span.v3__sep'), B.zout, B.zin, B.reset);
  const keys = h('div.v3__keys', ...[['Drag', 'orbit'], ['Shift+drag', 'pan'], ['Wheel', 'zoom'], ['Arrows', 'orbit'], ['W', 'wireframe'], ['U', 'up axis'], ['R', 'reset']].map(([k, t]) => h('span', h('kbd', { text: k }), ' ' + t)));
  root.appendChild(h('div.v3', h('style', { text: CSS }), bar, h('div.v3__mid', stage, info), keys));
  const ctx = cv.getContext('2d');
  const announce = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); };

  /* ---------------- drawing ---------------- */
  const size = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width)), hh = Math.max(10, Math.round(r.height));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    return { w, h: hh, dpr };
  };
  function paint() {
    queued = 0;
    if (dead) return;
    const { w, h: hh, dpr } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(cv);
    ctx.fillStyle = cs.getPropertyValue('--fill-0').trim() || '#14141c';
    ctx.fillRect(0, 0, w, hh);
    if (!st.mesh) { drawn = 0; return; }
    drawGround(w, hh);
    drawn = M3.draw(ctx, w, hh, st.mesh, cam, { wire: st.wire, maxTris: dragging ? HEAVY : 0, color: [150, 175, 255] });
  }
  const redraw = () => { if (!queued) queued = requestAnimationFrame(paint); };
  /* a faint floor under the model, at its lowest point, so up is readable */
  function drawGround(w, hh) {
    const b = st.b;
    const y = b.min[1], r = Math.max(b.size[0], b.size[2]) * 0.75 || 1;
    const step = r / 4;
    ctx.strokeStyle = 'rgba(140,150,190,.28)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -4; i <= 4; i++) {
      const lines = [[[b.center[0] - r, y, b.center[2] + i * step], [b.center[0] + r, y, b.center[2] + i * step]], [[b.center[0] + i * step, y, b.center[2] - r], [b.center[0] + i * step, y, b.center[2] + r]]];
      for (const [p, q] of lines) { const a = M3.project(cam, p, w, hh), c = M3.project(cam, q, w, hh); if (a && c) { ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); } }
    }
    ctx.stroke();
  }

  /* ---------------- the model ---------------- */
  function applyMesh() {
    st.mesh = st.zUp ? zUpMesh(st.raw) : st.raw;
    st.b = bounds(st.mesh.pos);
    B.up.textContent = `Up: ${st.zUp ? 'Z' : 'Y'}`;
  }
  function resetView() {
    if (!st.b) return;
    cam.yaw = 0.7; cam.pitch = 0.45;
    M3.frame(cam, st.b);
    redraw();
  }
  async function openPath(path) {
    const node = vfs.node(path);
    if (!node || node.type !== 'file') return say('Could not open that', 'The file is no longer there.', 'alert');
    const ext = vfs.extOf(node.name);
    try {
      const bytes = await readBytes(path);
      if (!bytes) throw new Error('The file has no content.');
      const parsed = ext === 'stl' ? parseSTL(bytes) : ext === 'obj' ? parseOBJ(new TextDecoder().decode(bytes)) : null;
      if (!parsed) throw new Error('The viewer opens .stl and .obj files.');
      st.path = vfs.norm(path); st.name = node.name; st.raw = parsed; st.count = parsed.count; st.format = ext === 'stl' ? `STL, ${parsed.format}` : 'OBJ'; st.skipped = parsed.skipped || 0;
      st.zUp = ext === 'stl';
      applyMesh();
      win.state.reopen = { path: st.path };
      win.setSubtitle(st.name);
      pick.hidden = true; info.hidden = false;
      cv.setAttribute('aria-label', `3D model ${st.name}, ${st.count} triangles`);
      resetView();
      paintInfo();
      announce(`${st.name} opened: ${st.count} triangles.`);
      cv.focus({ preventScroll: true });
    } catch (err) {
      say('Could not open that', `${node.name}: ${String(err.message || err)}`, 'alert');
      if (!st.mesh) showPicker();
    }
  }
  function paintInfo() {
    const b = st.b;
    info.replaceChildren(
      h('h3', { text: st.name }),
      h('dl',
        h('dt', { text: 'Format' }), h('dd', { text: st.format }),
        h('dt', { text: 'Triangles' }), h('dd', { text: st.count.toLocaleString() }),
        h('dt', { text: 'Width (x)' }), h('dd', { text: fmt(b.size[0]) }),
        h('dt', { text: st.zUp ? 'Depth (y)' : 'Height (y)' }), h('dd', { text: fmt(st.zUp ? b.size[2] : b.size[1]) }),
        h('dt', { text: st.zUp ? 'Height (z)' : 'Depth (z)' }), h('dd', { text: fmt(st.zUp ? b.size[1] : b.size[2]) })),
      h('p', { text: 'Sizes are in the file’s own units; a model file does not say which.', style: { margin: 0, color: 'var(--ink-3)' } }),
      st.skipped ? h('p', { text: `${st.skipped} face${st.skipped === 1 ? '' : 's'} in the file could not be read and were left out.`, style: { margin: 0, color: 'var(--ink-2)' } }) : null,
      st.count > HEAVY ? h('p', { text: 'A large model is drawn thinner while you drag, then whole again.', style: { margin: 0, color: 'var(--ink-3)' } }) : null);
  }
  function showPicker() {
    const files = [];
    vfs.walk(vfs.HOME, (n, p) => { if (n.type === 'file' && n.kind === 'model3d') files.push([n, p]); });
    files.sort((a, b) => a[0].name.localeCompare(b[0].name));
    pick.hidden = false;
    pick.replaceChildren(
      h('h3', { text: files.length ? 'Choose a model' : 'No models in your Files yet' }),
      h('p', { text: files.length ? 'These are the .stl and .obj files in your Files.' : 'Put an .stl or .obj file in Files (Import brings one in from this computer), or build one in Voxel Studio and export it, then open it here.' }),
      files.length ? h('ul.v3__list', ...files.map(([n, p]) => h('li', h('button', { type: 'button', dataset: { path: p }, onclick: () => openPath(p) }, h('span', { text: n.name }), h('small', { text: p.replace(vfs.HOME, '~').replace(/\/[^/]*$/, '') || '~' }))))) : null);
    pick.querySelector('button')?.focus();
  }

  /* ---------------- view controls ---------------- */
  function toggleWire() { st.wire = !st.wire; B.wire.setAttribute('aria-pressed', String(st.wire)); announce(st.wire ? 'Wireframe on' : 'Wireframe off'); redraw(); }
  function toggleUp() { if (!st.raw) return; st.zUp = !st.zUp; applyMesh(); paintInfo(); resetView(); announce(`${st.zUp ? 'Z' : 'Y'} is up`); }
  function zoomBy(f) { M3.zoom(cam, f); redraw(); }
  const thin = () => { dragging = true; clearTimeout(settle); settle = setTimeout(() => { dragging = false; redraw(); }, 160); };

  let drag = null;
  on(cv, 'pointerdown', e => {
    if (!st.mesh) return;
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 || e.button === 2, id: e.pointerId };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
    cv.classList.add('is-drag');
    cv.focus({ preventScroll: true });
    e.preventDefault();
  });
  on(cv, 'pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) M3.pan(cam, dx, dy, cv.getBoundingClientRect().height); else M3.orbit(cam, dx, dy);
    thin(); redraw();
  });
  const endDrag = e => { if (drag && e.pointerId === drag.id) { drag = null; cv.classList.remove('is-drag'); } };
  on(cv, 'pointerup', endDrag);
  on(cv, 'pointercancel', endDrag);
  on(cv, 'contextmenu', e => e.preventDefault());
  on(cv, 'wheel', e => { if (!st.mesh) return; e.preventDefault(); M3.zoom(cam, Math.exp(e.deltaY * 0.0015)); thin(); redraw(); }, { passive: false });
  on(cv, 'keydown', e => {
    if (!st.mesh || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const arrow = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[k];
    if (arrow) { if (e.shiftKey) M3.pan(cam, arrow[0] * 2, arrow[1] * 2, cv.getBoundingClientRect().height); else M3.orbit(cam, arrow[0], arrow[1]); thin(); redraw(); }
    else if (k === '+' || k === '=') zoomBy(0.85);
    else if (k === '-' || k === '_') zoomBy(1 / 0.85);
    else if (k === '0' || k === 'r' || k === 'R') resetView();
    else if (k === 'w' || k === 'W') toggleWire();
    else if (k === 'u' || k === 'U') toggleUp();
    else return;
    e.preventDefault();
  });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => redraw()) : null;
  ro?.observe(stage);

  /* what a test (or a curious person) can ask for */
  root.viewerPeek = () => ({ path: st.path, name: st.name, count: st.count, format: st.format, bounds: st.b && { min: st.b.min.slice(), max: st.b.max.slice(), size: st.b.size.slice() }, wire: st.wire, zUp: st.zUp, drawn,
    cam: { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: cam.target.slice() }, picking: !pick.hidden, listed: [...pick.querySelectorAll('button')].map(b => b.dataset.path) });

  /* ---------------- open ---------------- */
  if (opts && opts.path) openPath(opts.path); else showPicker();
  win.onReopen?.(o => { if (o && o.path) openPath(o.path); });
  redraw();

  return () => {
    dead = true;
    clearTimeout(settle);
    if (queued) cancelAnimationFrame(queued);
    ro?.disconnect();
    offs.splice(0).forEach(f => f());
  };
}
