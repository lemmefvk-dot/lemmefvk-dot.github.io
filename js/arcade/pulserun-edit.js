/* ============================================================
   arcade/pulserun-edit.js — the level editor of Pulse Run.

   Paint tiles on the grid with the mouse (right button erases) or with
   the arrow keys and Space; undo and redo; make it longer or shorter;
   pick the speed. "Test play" runs your level in the game itself, and
   finishing it records the run as the level's proof. Only a level that
   has been finished can be shared: the code carries the proof, and the
   code reader replays it (./pulserun-code.js), so nobody is ever sent a
   level that cannot be completed. The first six columns and the last
   ten stay flat and clear.

   The level and its proof are kept on this device (portal.arcadePuzzles
   .pulserun, per profile). Text goes through t().
   ============================================================ */
import { h } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { FONT } from './kit.js';
import { ROWS, GROUND, MIN_COLS, MAX_COLS } from './pulserun-sim.js';
import { encode, decode, problem, SPEEDS, SAFE_START, SAFE_END } from './pulserun-code.js';

const TOOLS = [
  { id: '#', label: () => t('Block') }, { id: '^', label: () => t('Spike') }, { id: 'v', label: () => t('Hanging spike') }, { id: 'J', label: () => t('Pad') },
  { id: 'F', label: () => t('Gravity gate') }, { id: 'W', label: () => t('Wind') }, { id: 'pit', label: () => t('Pit') }, { id: 'floor', label: () => t('Floor') }, { id: '.', label: () => t('Erase') },
];
/* what a refused code says (the keys are decode()'s reasons) */
const WHY = {
  format: () => t('That is not a Pulse Run code.'), long: () => t('That code is too long.'), size: () => t('The level in that code is the wrong size.'), shape: () => t('The level in that code is the wrong shape.'),
  glyph: () => t('That code has a tile that does not exist.'), start: () => t('The start of that level is not clear.'), end: () => t('The end of that level is not clear.'),
  proof: () => t('That level cannot be finished: its proof run does not reach the end.'), speed: () => t('That code has a speed this game does not use.'),
};
const MSG = {
  start: () => t('Paint with the mouse, or the arrow keys and Space. Finish your level in a test play to share it.'),
  needs: () => t('Finish the level in a test play to share it.'),
  unplayable: () => t('That level cannot be played.'),
  copied: () => t('Code ready. It is copied if your browser allows it; otherwise it is selected for you to copy.'),
  loaded: () => t('Loaded. It was finished by whoever made it; test play it to try it yourself.'),
  finished: () => t('Finished! You can share the code now.'),
};
const STYLE_ID = 'pr-ed-style';
const css = `
.pr-ed{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;padding:8px;background:#0c1020;color:#eef2f6;font-family:${FONT};font-size:13px;z-index:5;overflow:hidden}
.pr-ed *{box-sizing:border-box}
.pr-ed__bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pr-ed button,.pr-ed select{font:inherit;color:inherit;padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);cursor:pointer}
.pr-ed button:hover:not(:disabled){background:rgba(255,255,255,.18)}
.pr-ed button:disabled{opacity:.4;cursor:not-allowed}
.pr-ed button:focus-visible,.pr-ed select:focus-visible,.pr-ed canvas:focus-visible,.pr-ed textarea:focus-visible{outline:2px solid #ffd166;outline-offset:2px}
.pr-ed button.is-on{background:#3b6cff;border-color:#9fb4ff}
.pr-ed__go{background:#1f9d8a!important;border-color:#4fe0c8!important;font-weight:700}
.pr-ed__wrap{flex:1;min-height:0;position:relative;border-radius:8px;overflow:hidden;background:#070a14}
.pr-ed canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair}
.pr-ed__msg{min-height:18px;font-size:12px;opacity:.9}
.pr-ed__msg.is-bad{color:#ff9aa8}
.pr-ed textarea{flex:1 1 200px;height:34px;resize:none;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.35);color:inherit;padding:5px 8px;font:11px ui-monospace,monospace}
.pr-ed h2{margin:0 8px 0 0;font-size:15px}
.pr-ed-back{position:absolute;right:10px;bottom:10px;z-index:6;padding:7px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.3);background:rgba(14,18,32,.9);color:#fff;font:600 13px ${FONT};cursor:pointer}
.pr-ed-back:focus-visible{outline:2px solid #ffd166;outline-offset:2px}
`;

const flat = cols => Array.from({ length: ROWS }, (_, r) => Array.from({ length: cols }, () => (r >= GROUND ? '#' : '.')));
const toStrings = rows => rows.map(r => r.join(''));

export function mountEditor(el, ctx, api) {
  if (!api.active) return { setTesting() {}, peek: () => null, destroy() {} };
  if (!document.getElementById(STYLE_ID)) { const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = css; document.head.append(st); }

  const saved = api.saved()?.mine;
  const okSaved = saved && Array.isArray(saved.rows) && !problem(saved.rows, saved.speed);
  const E = {
    rows: okSaved ? saved.rows.map(s => [...s]) : flat(96), speed: okSaved ? saved.speed : 9, tool: '#', cam: 0, proof: okSaved && Array.isArray(saved.proof) ? saved.proof : null,
    undo: [], redo: [], msg: MSG.start, bad: false, testing: false, cur: { c: SAFE_START, r: GROUND - 1 },
  };
  const cols = () => E.rows[0].length;
  const persist = () => api.save({ mine: { rows: toStrings(E.rows), speed: E.speed, proof: E.proof } });

  /* ---------------- DOM ---------------- */
  const cv = h('canvas.pr-ed__grid', { tabindex: '0', role: 'img', 'aria-label': t('Level grid: paint tiles with the mouse, or move with the arrow keys and press Space') });
  const g = cv.getContext('2d');
  const msgEl = h('div.pr-ed__msg', { role: 'status', 'aria-live': 'polite' });
  const code = h('textarea', { spellcheck: 'false', placeholder: t('Paste a level code here, then press Load code'), 'aria-label': t('Level code'), dataset: { field: 'code' } });
  const btn = (act, label, on) => h('button', { type: 'button', dataset: { act }, onclick: on }, label);
  const toolBtns = TOOLS.map(tl => h('button', { type: 'button', dataset: { tool: tl.id }, 'aria-pressed': 'false', onclick: () => { E.tool = tl.id; paintUi(); } }, tl.label()));
  const speedSel = h('select', { dataset: { act: 'speed' }, 'aria-label': t('Speed'), onchange: () => { E.speed = +speedSel.value; E.proof = null; E.msg = MSG.needs; E.bad = false; persist(); paintUi(); } },
    SPEEDS.map(s => h('option', { value: String(s), text: t('Speed {n}', { n: s }) })));
  const undoB = btn('undo', t('Undo'), () => undo()), redoB = btn('redo', t('Redo'), () => redo());
  const shareB = btn('share', t('Share code'), () => share()), testB = btn('test', t('Test play'), () => test());
  testB.classList.add('pr-ed__go');
  const root = h('div.pr-ed', { role: 'group', 'aria-label': t('Level editor') },
    h('div.pr-ed__bar', h('h2', { text: t('Level editor') }), ...toolBtns),
    h('div.pr-ed__wrap', cv),
    msgEl,
    h('div.pr-ed__bar',
      btn('left', '◀', () => scroll(-8)), btn('right', '▶', () => scroll(8)),
      btn('shorter', t('Shorter'), () => resize(-16)), btn('longer', t('Longer'), () => resize(16)), speedSel, undoB, redoB, btn('clear', t('Clear'), () => clearAll()), testB, shareB),
    h('div.pr-ed__bar', code, btn('load', t('Load code'), () => load())));
  root.querySelector('[data-act="left"]').setAttribute('aria-label', t('Scroll left'));
  root.querySelector('[data-act="right"]').setAttribute('aria-label', t('Scroll right'));
  const backB = h('button.pr-ed-back', { type: 'button', dataset: { act: 'back' }, text: t('Back to editor'), onclick: () => api.back() });
  backB.hidden = true;
  el.append(root, backB);

  /* ---------------- the grid ---------------- */
  const geo = { cs: 24, vis: 24, oy: 0, w: 0, h: 0, dpr: 1 };
  function fit() {
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), hh = Math.max(1, Math.round(r.height)), dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === geo.w && hh === geo.h && dpr === geo.dpr) return;
    geo.w = w; geo.h = hh; geo.dpr = dpr;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
    geo.cs = Math.max(10, Math.min(36, Math.floor(hh / ROWS), Math.floor(w / 20)));
    geo.vis = Math.max(1, Math.floor(w / geo.cs));
    geo.oy = Math.floor((hh - geo.cs * ROWS) / 2);
    clampCam();
    draw();
  }
  const clampCam = () => { E.cam = Math.max(0, Math.min(Math.max(0, cols() - geo.vis), E.cam)); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(cv);

  function draw() {
    if (!geo.w || E.testing) return;
    g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    g.fillStyle = '#070a14'; g.fillRect(0, 0, geo.w, geo.h);
    const { cs, oy } = geo, n = cols();
    for (let c = E.cam; c < Math.min(n, E.cam + geo.vis + 1); c++) {
      const x = (c - E.cam) * cs, locked = c < SAFE_START || c >= n - SAFE_END;
      if (c % 4 === 0) { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x, oy, 1, cs * ROWS); }
      if (c % 16 === 0) { g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x, oy, 1, cs * ROWS); }
      for (let r = 0; r < ROWS; r++) {
        const ch = E.rows[r][c], y = oy + r * cs;
        if (locked) { g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(x, y, cs, cs); }
        if (ch === '.') continue;
        if (ch === '#') { g.fillStyle = r >= GROUND ? '#2c3a60' : '#3d4f86'; g.fillRect(x, y, cs, cs); g.fillStyle = '#8fa6ff'; g.fillRect(x, y, cs, 2); }
        else if (ch === '^' || ch === 'v') { g.fillStyle = '#ff5577'; g.beginPath(); if (ch === '^') { g.moveTo(x + 2, y + cs); g.lineTo(x + cs / 2, y + 3); g.lineTo(x + cs - 2, y + cs); } else { g.moveTo(x + 2, y); g.lineTo(x + cs / 2, y + cs - 3); g.lineTo(x + cs - 2, y); } g.fill(); }
        else if (ch === 'J') { g.fillStyle = '#ffd23f'; g.fillRect(x + 2, y + cs * 0.65, cs - 4, cs * 0.3); }
        else if (ch === 'F') { g.strokeStyle = '#7be0ff'; g.lineWidth = 2; g.beginPath(); g.arc(x + cs / 2, y + cs / 2, cs * 0.34, 0, 6.283); g.stroke(); }
        else if (ch === 'W') { g.fillStyle = 'rgba(143,240,192,.35)'; g.fillRect(x, y, cs, cs); }
      }
    }
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let r = 1; r < ROWS; r++) g.fillRect(0, oy + r * cs, geo.w, 1);
    g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, oy + GROUND * cs, geo.w, 1);
    /* the keyboard cursor */
    if (document.activeElement === cv) { g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.strokeRect((E.cur.c - E.cam) * cs + 1, oy + E.cur.r * cs + 1, cs - 2, cs - 2); }
  }

  /* ---------------- editing ---------------- */
  const snap = () => ({ rows: toStrings(E.rows), speed: E.speed });
  const restore = s => { E.rows = s.rows.map(r => [...r]); E.speed = s.speed; clampCam(); };
  function pushUndo() { E.undo.push(snap()); if (E.undo.length > 60) E.undo.shift(); E.redo.length = 0; }
  function touched() { E.proof = null; E.msg = MSG.needs; E.bad = false; persist(); }
  function setCell(c, r, tool) {
    const n = cols();
    if (c < SAFE_START || c >= n - SAFE_END || r < 0 || r >= ROWS) return false;
    const was = E.rows.map(row => row[c]).join('');
    if (tool === 'pit') for (let rr = GROUND; rr < ROWS; rr++) E.rows[rr][c] = '.';
    else if (tool === 'floor') for (let rr = GROUND; rr < ROWS; rr++) E.rows[rr][c] = '#';
    else if (tool === 'F') { for (let rr = 3; rr < GROUND; rr++) if (E.rows[rr][c] === '.' || E.rows[rr][c] === 'F') E.rows[rr][c] = 'F'; }
    else if (r >= GROUND) { if (tool === '#' || tool === '.') E.rows[r][c] = tool; }
    else E.rows[r][c] = tool;
    return E.rows.map(row => row[c]).join('') !== was;
  }
  let stroke = null;
  function paintAt(e, erase) {
    const rect = cv.getBoundingClientRect();
    const c = E.cam + Math.floor((e.clientX - rect.left) / geo.cs), r = Math.floor((e.clientY - rect.top - geo.oy) / geo.cs);
    if (c < 0 || c >= cols() || r < 0 || r >= ROWS) return;
    if (stroke && stroke.c === c && stroke.r === r) return;
    if (stroke) { stroke.c = c; stroke.r = r; }
    const before = snap();
    if (setCell(c, r, erase ? '.' : E.tool)) {
      if (!stroke.pushed) { E.undo.push(before); if (E.undo.length > 60) E.undo.shift(); E.redo.length = 0; stroke.pushed = true; }
      touched(); E.cur = { c, r }; paintUi(); draw();
    }
  }
  cv.addEventListener('pointerdown', e => {
    if (e.button > 2) return;
    e.preventDefault(); cv.focus();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    stroke = { c: -1, r: -1, pushed: false, erase: e.button === 2 };
    paintAt(e, stroke.erase);
  });
  cv.addEventListener('pointermove', e => { if (stroke) paintAt(e, stroke.erase); });
  const endStroke = () => { stroke = null; };
  cv.addEventListener('pointerup', endStroke); cv.addEventListener('pointercancel', endStroke);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); scroll(e.deltaY > 0 || e.deltaX > 0 ? 3 : -3); }, { passive: false });
  cv.addEventListener('focus', draw); cv.addEventListener('blur', draw);
  cv.addEventListener('keydown', e => {
    const k = e.key;
    const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (mv) {
      e.preventDefault();
      E.cur = { c: Math.max(0, Math.min(cols() - 1, E.cur.c + mv[0])), r: Math.max(0, Math.min(ROWS - 1, E.cur.r + mv[1])) };
      if (E.cur.c < E.cam) E.cam = E.cur.c; else if (E.cur.c >= E.cam + geo.vis) E.cam = E.cur.c - geo.vis + 1;
      clampCam(); draw();
    } else if (k === ' ' || k === 'Enter' || k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      const before = snap();
      if (setCell(E.cur.c, E.cur.r, k === ' ' || k === 'Enter' ? E.tool : '.')) { E.undo.push(before); E.redo.length = 0; touched(); paintUi(); draw(); }
    }
    e.stopPropagation();                     /* the game's own keys are not for a grid being edited */
  });
  function scroll(d) { E.cam += d; clampCam(); draw(); }
  function undo() { const s = E.undo.pop(); if (!s) return; E.redo.push(snap()); restore(s); touched(); paintUi(); draw(); }
  function redo() { const s = E.redo.pop(); if (!s) return; E.undo.push(snap()); restore(s); touched(); paintUi(); draw(); }
  function clearAll() { pushUndo(); E.rows = flat(cols()); E.cam = 0; touched(); paintUi(); draw(); }
  function normalizeEnds() {
    const n = cols();
    for (let c = n - SAFE_END; c < n; c++) for (let r = 0; r < ROWS; r++) E.rows[r][c] = r >= GROUND ? '#' : '.';
  }
  function resize(d) {
    const n = cols(), to = Math.max(MIN_COLS, Math.min(MAX_COLS, n + d));
    if (to === n) return;
    pushUndo();
    for (let r = 0; r < ROWS; r++) { if (to > n) for (let c = n; c < to; c++) E.rows[r].push(r >= GROUND ? '#' : '.'); else E.rows[r].length = to; }
    normalizeEnds(); clampCam(); touched(); paintUi(); draw();
  }

  /* ---------------- test, share, load ---------------- */
  function test() {
    const rows = toStrings(E.rows), bad = problem(rows, E.speed);
    if (bad) { E.msg = WHY[bad] || MSG.unplayable; E.bad = true; paintUi(); return; }
    api.test(rows, E.speed);
  }
  function share() {
    if (!E.proof) return;
    const c = encode(toStrings(E.rows), E.speed, E.proof);
    code.value = c; code.focus(); code.select();
    try { navigator.clipboard?.writeText(c).catch(() => {}); } catch (err) { /* the text is selected for copying */ }
    E.msg = MSG.copied; E.bad = false; paintUi();
  }
  function load() {
    const r = decode(code.value);
    if (!r.ok) { E.msg = WHY[r.why] || WHY.format; E.bad = true; paintUi(); return; }
    pushUndo();
    E.rows = r.rows.map(s => [...s]); E.speed = r.speed; E.proof = r.proof; E.cam = 0;
    E.msg = MSG.loaded; E.bad = false;
    persist(); paintUi(); draw();
  }

  function paintUi() {
    toolBtns.forEach(b => { const on = b.dataset.tool === E.tool; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    speedSel.value = String(E.speed);
    undoB.disabled = !E.undo.length; redoB.disabled = !E.redo.length;
    shareB.disabled = !E.proof;
    shareB.title = E.proof ? '' : t('Finish the level in a test play to share it.');
    msgEl.textContent = E.msg(); msgEl.classList.toggle('is-bad', E.bad);
  }
  paintUi();
  requestAnimationFrame(fit);

  return {
    /** the game is test-playing the level (on) or has come back (off; proof = the winning run, or null) */
    setTesting(on, proof) {
      E.testing = on;
      root.hidden = on; backB.hidden = !on;
      if (!on) {
        if (proof) { E.proof = proof; E.msg = MSG.finished; E.bad = false; persist(); }
        paintUi(); requestAnimationFrame(() => { geo.w = 0; fit(); });
      }
    },
    peek: () => ({
      cols: cols(), speed: E.speed, tool: E.tool, cam: E.cam, geo: { cs: geo.cs, vis: geo.vis, oy: geo.oy }, proof: E.proof ? E.proof.length : null, canShare: !shareB.disabled,
      msg: msgEl.textContent, bad: E.bad, undo: E.undo.length, redo: E.redo.length, code: code.value, testing: E.testing, rows: toStrings(E.rows), proofSteps: E.proof ? E.proof.slice() : null,
    }),
    destroy() { ro?.disconnect(); root.remove(); backB.remove(); },
  };
}
