/* ============================================================
   mathlab/fractal.js — the Fractal explorer tab: Mandelbrot and
   Julia sets, drawn by a Worker so the window stays responsive.

   Drag to pan, wheel or click to zoom in, Shift+click to zoom out,
   double-click the Mandelbrot set to open the Julia set of that
   point. Keyboard: arrows pan, + and - zoom, 0 goes home, J opens
   the Julia set of the centre. The maths is js/core/fractal.js.

   Doubles have about 15 digits, so past a width of roughly 1e-13
   the picture turns blocky. That is a limit of the numbers, and the
   window says so rather than pretending to zoom deeper.
   ============================================================ */
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import * as media from '../core/media.js';
import * as F from '../core/fractal.js';
import { slider, listeners } from '../core/labkit.js';

const MIN_WIDTH = 2e-13;
const g = n => (Math.abs(n) < 1e-4 && n !== 0 ? n.toExponential(4) : String(Math.round(n * 1e9) / 1e9));

export function mountFractal(host, { api }) {
  const L = listeners();
  let dead = false;
  const S = { mode: 'mandelbrot', cx: F.HOME.mandelbrot.cx, cy: 0, width: F.HOME.mandelbrot.width, max: 150, palette: 'fire', c: [-0.8, 0.156], id: 0, ms: null, drawing: false, bands: 0, ptr: null };

  const canvas = h('canvas', { tabindex: '0', role: 'img', 'aria-label': 'The fractal. Arrow keys pan, plus and minus zoom.', dataset: { fk: 'frac-canvas' } });
  const stage = h('div.lab__stage', canvas);
  const modeBtns = { mandelbrot: h('button.lab__btn', { type: 'button', dataset: { fk: 'frac-mandelbrot' }, onclick: () => setMode('mandelbrot') }, 'Mandelbrot'), julia: h('button.lab__btn', { type: 'button', dataset: { fk: 'frac-julia' }, onclick: () => setMode('julia') }, 'Julia') };
  const paletteSel = h('select', { 'aria-label': 'Colours', dataset: { fk: 'frac-palette' }, onchange: e => { S.palette = e.target.value; draw(); } }, F.PALETTES.map(p => h('option', { value: p, text: p[0].toUpperCase() + p.slice(1) })));
  const iters = slider('Iterations', { min: 30, max: 2000, step: 10, value: S.max, fk: 'frac-iters' }, v => { S.max = v; scheduleDraw(); });
  const cRe = h('input', { type: 'number', step: '0.001', value: String(S.c[0]), 'aria-label': 'Julia c, real part', dataset: { fk: 'frac-cre' }, oninput: () => setC() });
  const cIm = h('input', { type: 'number', step: '0.001', value: String(S.c[1]), 'aria-label': 'Julia c, imaginary part', dataset: { fk: 'frac-cim' }, oninput: () => setC() });
  const presetSel = h('select', { 'aria-label': 'Julia presets', dataset: { fk: 'frac-preset' }, onchange: e => { const p = F.JULIA_PRESETS[Number(e.target.value)]; if (p) { cRe.value = p[1]; cIm.value = p[2]; setC(); } e.target.value = ''; } },
    h('option', { value: '', text: 'Presets…' }), F.JULIA_PRESETS.map((p, i) => h('option', { value: i, text: p[0] })));
  const juliaBox = h('div', { hidden: true }, h('h3', { text: 'Julia constant c' }),
    h('div.lab__row', h('label', { text: 're ' }, cRe), h('label', { text: 'im ' }, cIm), presetSel),
    h('p.lab__note', { text: 'Julia sets keep c fixed and colour each starting point. Each c in the Mandelbrot set gives one connected piece.' }));
  const meas = h('dl.lab__meas', { dataset: { fk: 'frac-meas' } });
  const note = h('p.lab__note', { role: 'status', dataset: { fk: 'frac-note' } });
  const openJulia = h('button.lab__btn.lab__btn--sm', { type: 'button', dataset: { fk: 'frac-open-julia' }, onclick: () => juliaAt(S.cx, S.cy) }, 'Julia set of the centre');
  const home = h('button.lab__btn.lab__btn--sm', { type: 'button', dataset: { fk: 'frac-home' }, onclick: () => goHome() }, 'Home');
  const zin = h('button.lab__btn.lab__btn--sm', { type: 'button', 'aria-label': 'Zoom in', dataset: { fk: 'frac-zin' }, onclick: () => zoom(0.5) }, 'Zoom +');
  const zout = h('button.lab__btn.lab__btn--sm', { type: 'button', 'aria-label': 'Zoom out', dataset: { fk: 'frac-zout' }, onclick: () => zoom(2) }, 'Zoom −');
  const save = h('button.lab__btn.lab__btn--sm', { type: 'button', dataset: { fk: 'frac-save' }, onclick: () => savePicture() }, 'Save picture');

  host.append(
    h('div.lab__main', h('div.lab__row', modeBtns.mandelbrot, modeBtns.julia, h('span.lab__sp'), zin, zout, home, save), stage),
    h('div.lab__side', h('h3', { text: 'View' }), meas, h('div.lab__row', openJulia), juliaBox,
      h('h3', { text: 'Drawing' }), iters.el, h('div.lab__row', h('label', { text: 'Colours ' }, paletteSel)), note,
      h('p.lab__note', { text: 'Drag to pan. Scroll or click to zoom in, Shift+click to zoom out. Double-click the Mandelbrot set for the Julia set of that point. Keys: arrows, + and −, 0 for home, J for the centre\'s Julia set.' })));

  /* ---------- the worker ---------- */
  let worker = null, fallbackTimer = 0;
  try {
    worker = new Worker(new URL('../apps/mathlab-fractal-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onBand;
    worker.onerror = () => { worker = null; };            /* the next draw uses the page itself */
  } catch (e) { worker = null; }
  const ctx2 = canvas.getContext('2d');
  let img = null;

  function onBand(e) {
    const m = e.data;
    if (dead || !m || m.id !== S.id) return;
    if (m.done) { S.drawing = false; S.ms = m.ms; paintMeas(); return; }
    if (!img || img.width !== m.w) return;
    const rows = new ImageData(m.data, m.w, m.rows);
    ctx2.putImageData(rows, 0, m.y0);
    S.bands++;
  }

  function size() {
    const r = stage.getBoundingClientRect();
    const w = Math.max(120, Math.min(1000, Math.floor(r.width))), hh = Math.max(120, Math.min(800, Math.floor(r.height)));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; img = ctx2.createImageData(w, hh); return true; }
    if (!img) img = ctx2.createImageData(w, hh);
    return false;
  }

  function draw() {
    if (dead) return;
    size();
    const job = { id: ++S.id, mode: S.mode, cx: S.cx, cy: S.cy, scale: S.width / canvas.width, w: canvas.width, h: canvas.height, max: S.max, palette: S.palette, c: S.c.slice() };
    S.drawing = true; S.bands = 0;
    paintMeas();
    if (worker) { worker.postMessage(job); return; }
    /* no Worker here: draw in small slices so the window still breathes */
    const t0 = performance.now();
    let y = 0;
    const slice = () => {
      if (dead || job.id !== S.id) return;
      const y1 = Math.min(job.h, y + 8);
      ctx2.putImageData(new ImageData(F.renderRows(job, y, y1), job.w, y1 - y), 0, y);
      y = y1;
      if (y < job.h) fallbackTimer = setTimeout(slice, 0); else { S.drawing = false; S.ms = Math.round(performance.now() - t0); paintMeas(); }
    };
    slice();
  }
  let timer = 0;
  function scheduleDraw() { clearTimeout(timer); timer = setTimeout(draw, 60); paintMeas(); }

  function paintMeas() {
    const home = F.HOME[S.mode].width;
    const rows = [['Centre', `${g(S.cx)} ${S.cy < 0 ? '−' : '+'} ${g(Math.abs(S.cy))}i`], ['Width', g(S.width)], ['Zoom', `${g(Math.round(home / S.width * 100) / 100)}×`], ['Iterations', String(S.max)]];
    if (S.mode === 'julia') rows.push(['c', `${g(S.c[0])} ${S.c[1] < 0 ? '−' : '+'} ${g(Math.abs(S.c[1]))}i`]);
    if (S.ptr) rows.push(['Pointer', `${g(S.ptr[0])} ${S.ptr[1] < 0 ? '−' : '+'} ${g(Math.abs(S.ptr[1]))}i`]);
    rows.push(['Drawn in', S.drawing ? 'drawing…' : S.ms == null ? '—' : `${S.ms} ms`]);
    meas.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
    note.textContent = S.width < 1e-12 ? 'You are near the limit of double-precision numbers: the picture is starting to block up. Going deeper needs more digits than this app keeps.' : '';
    for (const [k, b] of Object.entries(modeBtns)) b.setAttribute('aria-pressed', String(k === S.mode));
    juliaBox.hidden = S.mode !== 'julia';
    openJulia.hidden = S.mode !== 'mandelbrot';
  }

  /* ---------- the view ---------- */
  const scale = () => S.width / canvas.width;
  const at = (px, py) => [S.cx + (px - canvas.width / 2) * scale(), S.cy + (py - canvas.height / 2) * scale()];
  function zoom(f, px = canvas.width / 2, py = canvas.height / 2) {
    const nw = Math.max(MIN_WIDTH, Math.min(8, S.width * f));
    const [x, y] = at(px, py);
    const k = nw / S.width;
    S.cx = x - (x - S.cx) * k; S.cy = y - (y - S.cy) * k; S.width = nw;
    scheduleDraw();
  }
  function goHome() { Object.assign(S, { cx: F.HOME[S.mode].cx, cy: F.HOME[S.mode].cy, width: F.HOME[S.mode].width }); scheduleDraw(); }
  function setMode(m) {
    if (m === S.mode) return;
    S.mode = m; goHome();
  }
  function setC() {
    const re = Number(cRe.value), im = Number(cIm.value);
    if (Number.isFinite(re) && Number.isFinite(im)) { S.c = [re, im]; scheduleDraw(); }
  }
  function juliaAt(x, y) {
    S.c = [x, y]; cRe.value = String(Math.round(x * 1e6) / 1e6); cIm.value = String(Math.round(y * 1e6) / 1e6);
    S.c = [Number(cRe.value), Number(cIm.value)];
    S.mode = 'julia'; Object.assign(S, F.HOME.julia); scheduleDraw();
  }
  const local = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
  let drag = null;
  L.on(canvas, 'pointerdown', e => { if (e.button) return; canvas.focus(); const [px, py] = local(e); drag = { px, py, cx: S.cx, cy: S.cy, moved: false }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } });
  L.on(canvas, 'pointermove', e => {
    const [px, py] = local(e);
    S.ptr = at(px, py);
    if (drag) {
      if (Math.hypot(px - drag.px, py - drag.py) > 4) drag.moved = true;
      if (drag.moved) { S.cx = drag.cx - (px - drag.px) * scale(); S.cy = drag.cy - (py - drag.py) * scale(); scheduleDraw(); return; }
    }
    paintMeas();
  });
  L.on(canvas, 'pointerup', e => {
    const d = drag; drag = null;
    if (d && !d.moved) { const [px, py] = local(e); zoom(e.shiftKey ? 2 : 0.5, px, py); }
  });
  L.on(canvas, 'dblclick', e => { if (S.mode === 'mandelbrot') { const [px, py] = local(e); const [x, y] = at(px, py); juliaAt(x, y); } });
  L.on(canvas, 'wheel', e => { e.preventDefault(); const [px, py] = local(e); zoom(e.deltaY < 0 ? 0.8 : 1.25, px, py); }, { passive: false });
  L.on(canvas, 'keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = S.width * 0.1;
    if (e.key === 'ArrowLeft') S.cx -= step; else if (e.key === 'ArrowRight') S.cx += step;
    else if (e.key === 'ArrowUp') S.cy -= step; else if (e.key === 'ArrowDown') S.cy += step;
    else if (e.key === '+' || e.key === '=') { zoom(0.5); e.preventDefault(); return; }
    else if (e.key === '-' || e.key === '_') { zoom(2); e.preventDefault(); return; }
    else if (e.key === '0') { goHome(); return; }
    else if (e.key === 'j' || e.key === 'J') { if (S.mode === 'mandelbrot') juliaAt(S.cx, S.cy); return; }
    else return;
    e.preventDefault(); scheduleDraw();
  });
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (!dead && size()) scheduleDraw(); }); ro.observe(stage); }

  async function savePicture() {
    try {
      const blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not make the picture.'))), 'image/png'));
      const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
      const { path } = await media.save(`${vfs.HOME}/Pictures`, `${S.mode === 'julia' ? 'Julia' : 'Mandelbrot'} ${stamp}.png`, blob);
      if (!dead) api.notify({ app: 'Maths Lab', icon: 'image', title: 'Saved to Pictures', message: path.replace(vfs.HOME, '~'), timeout: 5000, actions: [{ label: 'Open', onClick: () => api.openApp('photos', { path }) }] });
    } catch (err) { api.notify({ app: 'Maths Lab', icon: 'alert', title: 'Could not save the picture', message: String(err.message || err), timeout: 5000 }); }
  }

  host.__peek = () => ({ mode: S.mode, cx: S.cx, cy: S.cy, width: S.width, max: S.max, drawing: S.drawing, bands: S.bands, ms: S.ms, worker: !!worker, c: S.c.slice(), w: canvas.width, h: canvas.height });
  host.__pixel = (x, y) => Array.from(ctx2.getImageData(x, y, 1, 1).data);
  requestAnimationFrame(() => { if (!dead) draw(); });

  return () => {
    dead = true;
    clearTimeout(timer); clearTimeout(fallbackTimer);
    if (worker) { worker.onmessage = null; worker.terminate(); worker = null; }
    if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } }
    L.off();
  };
}
