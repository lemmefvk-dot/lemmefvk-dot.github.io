/* ============================================================
   mathlab/automata.js — the Cellular automata tab: Conway's Life and
   other Life-like rules (any B/S rule can be typed), and Wolfram's
   256 one-dimensional rules drawn row by row. Rules and stepping are
   in js/core/automata.js.

   Life: click or drag to draw cells (Shift removes), pick a pattern
   and click to stamp it, Space plays and pauses, S steps once,
   R fills at random, C clears. The generation number and the number
   of live cells are counted from the grid on screen.
   Keyboard: arrow keys move a cursor, Enter or X toggles that cell.
   ============================================================ */
import { h } from '../core/dom.js';
import * as A from '../core/automata.js';
import { slider, listeners, cssVar } from '../core/labkit.js';

const W = 96, H = 64;
const ELEM_W = 129;

export function mountAutomata(host) {
  const L = listeners();
  let dead = false;
  const S = { kind: 'life', ruleKey: 'life', ruleText: A.RULES.life.rule, wrap: true, cells: new Uint8Array(W * H), gen: 0, running: false, fps: 10, last: 0, raf: 0, pattern: '', cur: [W >> 1, H >> 1], elem: 30, row: null, rows: [], egen: 0, paintVal: 1 };

  const canvas = h('canvas', { tabindex: '0', role: 'application', 'aria-label': 'The grid. Arrow keys move the cursor, Enter toggles a cell.', dataset: { fk: 'ca-canvas' } });
  const stage = h('div.lab__stage', canvas);
  const kindBtns = { life: h('button.lab__btn', { type: 'button', dataset: { fk: 'ca-kind-life' }, onclick: () => setKind('life') }, 'Life-like rules'), elem: h('button.lab__btn', { type: 'button', dataset: { fk: 'ca-kind-elem' }, onclick: () => setKind('elem') }, 'One-dimensional rules') };
  const play = h('button.lab__btn.lab__btn--go', { type: 'button', dataset: { fk: 'ca-play' }, onclick: () => toggle() }, 'Play');
  const stepB = h('button.lab__btn', { type: 'button', dataset: { fk: 'ca-step' }, onclick: () => { S.running = false; tick(); paintPlay(); } }, 'Step');
  const rand = h('button.lab__btn', { type: 'button', dataset: { fk: 'ca-random' }, onclick: () => randomise() }, 'Random');
  const clear = h('button.lab__btn', { type: 'button', dataset: { fk: 'ca-clear' }, onclick: () => clearAll() }, 'Clear');
  const speed = slider('Speed', { min: 1, max: 60, value: S.fps, fmt: v => `${v} gen/s`, fk: 'ca-speed' }, v => { S.fps = v; });
  const ruleSel = h('select', { 'aria-label': 'Rule', dataset: { fk: 'ca-rule' }, onchange: e => { S.ruleKey = e.target.value; if (e.target.value !== 'custom') ruleText.value = A.RULES[e.target.value].rule; applyRule(); } },
    Object.entries(A.RULES).map(([k, v]) => h('option', { value: k, text: `${v.name} (${v.rule})` })), h('option', { value: 'custom', text: 'Your own rule' }));
  const ruleText = h('input', { type: 'text', value: S.ruleText, size: 14, 'aria-label': 'Rule as B/S, for example B3/S23', dataset: { fk: 'ca-rule-text' }, oninput: () => { ruleSel.value = 'custom'; S.ruleKey = 'custom'; applyRule(); } });
  const ruleErr = h('p.lab__err', { role: 'alert', hidden: true });
  const wrapBox = h('input', { type: 'checkbox', checked: true, dataset: { fk: 'ca-wrap' }, onchange: e => { S.wrap = e.target.checked; } });
  const patSel = h('select', { 'aria-label': 'Pattern to stamp', dataset: { fk: 'ca-pattern' }, onchange: e => { S.pattern = e.target.value; } },
    h('option', { value: '', text: 'Draw cells' }), Object.entries(A.PATTERN_NAMES).map(([k, v]) => h('option', { value: k, text: `Stamp: ${v}` })));
  const lifeBox = h('div.lab__side', { style: { padding: 0 } },
    h('h3', { text: 'Rule' }), h('div.lab__row', ruleSel), h('div.lab__row', h('label', { text: 'B/S ' }, ruleText)), ruleErr,
    h('label.lab__row', wrapBox, h('span', { text: 'Edges wrap round' })),
    h('h3', { text: 'Drawing' }), h('div.lab__row', patSel),
    h('p.lab__note', { text: 'B is how many live neighbours bring a dead cell to life; S is how many keep a live cell alive. Click or drag to draw, Shift to erase.' }));
  const eRule = h('input', { type: 'number', min: 0, max: 255, value: S.elem, 'aria-label': 'Rule number, 0 to 255', dataset: { fk: 'ca-elem-rule' }, oninput: () => { const v = Number(eRule.value); if (Number.isInteger(v) && v >= 0 && v <= 255) { S.elem = v; restartElem(); } } });
  const eSel = h('select', { 'aria-label': 'Famous rules', dataset: { fk: 'ca-elem-pick' }, onchange: e => { if (e.target.value === '') return; eRule.value = e.target.value; S.elem = Number(e.target.value); restartElem(); e.target.value = ''; } },
    h('option', { value: '', text: 'Famous rules…' }), [[30, 'Rule 30: chaos'], [90, 'Rule 90: Sierpinski triangle'], [110, 'Rule 110: can compute anything'], [184, 'Rule 184: traffic'], [54, 'Rule 54'], [250, 'Rule 250']].map(([v, t]) => h('option', { value: v, text: t })));
  const eBits = h('div.lab__row', { 'aria-label': 'What the rule does to each three-cell neighbourhood', dataset: { fk: 'ca-elem-bits' } });
  const elemBox = h('div.lab__side', { style: { padding: 0 }, hidden: true },
    h('h3', { text: 'Rule number' }), h('div.lab__row', eRule, eSel), eBits,
    h('p.lab__note', { text: 'Each new row is worked out from the one above: every cell looks at itself and its two neighbours (8 possible patterns), and the rule number, written in binary, says what each pattern turns into. The row wraps at the ends and starts as one live cell in the middle.' }));
  const meas = h('dl.lab__meas', { dataset: { fk: 'ca-meas' } });
  host.append(h('div.lab__main', h('div.lab__row', kindBtns.life, kindBtns.elem, h('span.lab__sp'), play, stepB, rand, clear), stage), h('div.lab__side', lifeBox, elemBox, speed.el, h('h3', { text: 'Now' }), meas));

  const ctx = canvas.getContext('2d');
  function size() {
    const r = stage.getBoundingClientRect();
    const w = Math.max(160, Math.floor(r.width)), hh = Math.max(160, Math.floor(r.height));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  }
  const geom = () => {
    if (S.kind === 'life') { const c = Math.max(3, Math.floor(Math.min(canvas.width / W, canvas.height / H))); return { c, ox: Math.floor((canvas.width - c * W) / 2), oy: Math.floor((canvas.height - c * H) / 2), cols: W, rows: H }; }
    const c = Math.max(2, Math.floor(canvas.width / ELEM_W)), rows = Math.max(1, Math.floor(canvas.height / c));
    return { c, ox: Math.floor((canvas.width - c * ELEM_W) / 2), oy: 0, cols: ELEM_W, rows };
  };
  function paint() {
    if (dead) return;
    size();
    const { c, ox, oy, cols, rows } = geom();
    const ink = cssVar(host, '--accent', '#4a9cff'), bg = cssVar(host, '--fill-0', '#111'), line = cssVar(host, '--line-1', '#333');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = ink;
    if (S.kind === 'life') {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (S.cells[y * W + x]) ctx.fillRect(ox + x * c, oy + y * c, c > 3 ? c - 1 : c, c > 3 ? c - 1 : c);
      ctx.strokeStyle = line; ctx.strokeRect(ox - 0.5, oy - 0.5, W * c + 1, H * c + 1);
      if (document.activeElement === canvas) { ctx.strokeStyle = cssVar(host, '--ink-0', '#fff'); ctx.lineWidth = 2; ctx.strokeRect(ox + S.cur[0] * c, oy + S.cur[1] * c, c, c); ctx.lineWidth = 1; }
    } else {
      const shown = S.rows.slice(-rows);
      shown.forEach((row, y) => { for (let x = 0; x < cols; x++) if (row[x]) ctx.fillRect(ox + x * c, oy + y * c, c, c); });
    }
    paintMeas();
  }
  function paintMeas() {
    const rows = S.kind === 'life' ? [['Generation', String(S.gen)], ['Live cells', String(A.population(S.cells))], ['Rule', S.ruleText]] : [['Row', String(S.egen)], ['Rule', String(S.elem)], ['Live cells in this row', String(S.row ? A.population(S.row) : 0)]];
    meas.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
  }

  function applyRule() {
    const r = A.parseRule(ruleText.value);
    ruleErr.hidden = !!r;
    ruleErr.textContent = r ? '' : 'Write the rule like B3/S23.';
    if (r) { S.rule = r; S.ruleText = ruleText.value.trim().toUpperCase().replace(/\s+/g, ''); paintMeas(); }
  }
  S.rule = A.parseRule(S.ruleText);

  function tick() {
    if (S.kind === 'life') { S.cells = A.step(S.cells, W, H, S.rule, S.wrap); S.gen++; }
    else { S.row = A.elementary(S.elem, S.row); S.rows.push(S.row); if (S.rows.length > 400) S.rows.shift(); S.egen++; }
    paint();
  }
  function restartElem() {
    S.row = new Uint8Array(ELEM_W); S.row[ELEM_W >> 1] = 1; S.rows = [S.row]; S.egen = 0;
    if (S.kind === 'elem') fillElem();
    eBits.replaceChildren(...[7, 6, 5, 4, 3, 2, 1, 0].map(i => h('span', { style: { display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '2px', fontVariantNumeric: 'tabular-nums' } },
      h('span', { text: [(i >> 2) & 1, (i >> 1) & 1, i & 1].join(''), style: { color: 'var(--ink-3)', fontSize: 'var(--fs-11)' } }), h('b', { text: String((S.elem >> i) & 1) }))));
    paint();
  }
  /* a fresh one-dimensional run shows a page of rows straight away */
  function fillElem() { const { rows } = geom(); for (let i = 1; i < rows; i++) { S.row = A.elementary(S.elem, S.row); S.rows.push(S.row); S.egen++; } }
  function setKind(k) {
    if (k === S.kind) return;
    S.kind = k; S.running = false; paintPlay();
    lifeBox.hidden = k !== 'life'; elemBox.hidden = k !== 'elem';
    rand.hidden = k !== 'life';
    stepB.title = k === 'life' ? 'Next generation' : 'Next row';
    for (const [id, b] of Object.entries(kindBtns)) b.setAttribute('aria-pressed', String(id === k));
    if (k === 'elem') restartElem();
    paint();
  }

  function toggle() { S.running = !S.running; S.last = 0; paintPlay(); }
  function paintPlay() { play.textContent = S.running ? 'Pause' : 'Play'; play.dataset.state = S.running ? 'running' : 'paused'; }
  function randomise() { for (let i = 0; i < S.cells.length; i++) S.cells[i] = Math.random() < 0.28 ? 1 : 0; S.gen = 0; paint(); }
  function clearAll() { S.cells = new Uint8Array(W * H); S.gen = 0; S.running = false; paintPlay(); paint(); }

  /* ---------- drawing ---------- */
  const cellAt = e => {
    const r = canvas.getBoundingClientRect(), { c, ox, oy } = geom();
    const px = (e.clientX - r.left) * canvas.width / r.width, py = (e.clientY - r.top) * canvas.height / r.height;
    const x = Math.floor((px - ox) / c), y = Math.floor((py - oy) / c);
    return x >= 0 && y >= 0 && x < W && y < H ? [x, y] : null;
  };
  let down = false;
  L.on(canvas, 'pointerdown', e => {
    canvas.focus();
    if (S.kind !== 'life' || e.button) return;
    const p = cellAt(e); if (!p) return;
    S.cur = p;
    if (S.pattern) { A.stamp(S.cells, W, H, A.PATTERNS[S.pattern], p[0], p[1]); paint(); return; }
    down = true; S.paintVal = e.shiftKey ? 0 : S.cells[p[1] * W + p[0]] ? 0 : 1;
    S.cells[p[1] * W + p[0]] = S.paintVal; paint();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
  });
  L.on(canvas, 'pointermove', e => { if (!down) return; const p = cellAt(e); if (p) { S.cells[p[1] * W + p[0]] = S.paintVal; paint(); } });
  L.on(canvas, 'pointerup', () => { down = false; });
  L.on(canvas, 'focus', () => paint());
  L.on(canvas, 'blur', () => paint());
  L.on(canvas, 'keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (S.kind === 'life') {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) { S.cur = [(S.cur[0] + d[0] + W) % W, (S.cur[1] + d[1] + H) % H]; e.preventDefault(); paint(); return; }
      if (e.key === 'Enter' || e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        if (S.pattern) A.stamp(S.cells, W, H, A.PATTERNS[S.pattern], S.cur[0], S.cur[1]); else S.cells[S.cur[1] * W + S.cur[0]] ^= 1;
        paint(); return;
      }
      if (e.key === 'r' || e.key === 'R') { randomise(); return; }
      if (e.key === 'c' || e.key === 'C') { clearAll(); return; }
    }
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 's' || e.key === 'S') { S.running = false; tick(); paintPlay(); }
  });

  /* ---------- the loop ---------- */
  function frame(now) {
    S.raf = 0;
    if (dead) return;
    if (S.running) {
      if (!S.last) S.last = now;
      let n = 0;
      while (now - S.last >= 1000 / S.fps && n < 6) { S.last += 1000 / S.fps; n++; tick(); }
      if (now - S.last > 500) S.last = now;
    }
    S.raf = requestAnimationFrame(frame);
  }
  S.raf = requestAnimationFrame(frame);
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (!dead) paint(); }); ro.observe(stage); }

  A.stamp(S.cells, W, H, A.PATTERNS.gosper, 4, 4);
  A.stamp(S.cells, W, H, A.PATTERNS.rpentomino, 60, 36);
  setKind('life');
  for (const [id, b] of Object.entries(kindBtns)) b.setAttribute('aria-pressed', String(id === 'life'));
  elemBox.hidden = true; paintPlay(); paint();

  host.__peek = () => ({ kind: S.kind, gen: S.gen, pop: A.population(S.cells), running: S.running, rule: S.ruleText, wrap: S.wrap, cells: Array.from(S.cells), w: W, h: H, cur: S.cur.slice(), elem: S.elem, egen: S.egen, rowsShown: S.rows.length, lastRow: S.row ? Array.from(S.row) : null, grid: canvas.getBoundingClientRect().toJSON(), geom: geom() });

  return () => { dead = true; if (S.raf) cancelAnimationFrame(S.raf); if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } } L.off(); };
}
