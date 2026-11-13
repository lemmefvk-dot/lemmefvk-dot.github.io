/* ============================================================
   arcade/pipelink.js — Pipe Link for Static Arcade.

   Join each pair of matching dots with a pipe. Pipes can't cross
   and can't run through another colour's dots, and together they
   must fill every square. Five board sizes (5×5 to 9×9), twenty
   levels each; every level has a full-board solution (see
   pipes-logic.js — the test suite solves all of them).

   Controls
     mouse / touch  press a dot (or a pipe) and drag; crossing
                    another pipe cuts it back; drag back to shorten
     keyboard       arrows move the cursor · Space / Enter picks a
                    pipe up (from a dot or the end of a pipe), the
                    arrows then draw it, Space / Enter puts it down
                    · R starts the level again · N / P next / previous
   Score = seconds to link the level, lower is better. The level you
   were on and the levels you have cleared (with best times) are kept
   on this device (portal.arcadePuzzles.pipelink).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, sounder } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag, clock, fmtTime } from './puzzlekit.js';
import { SIZES, LEVELS_PER_SIZE, makeLevel, createBoard, ownerMap, begin, walkTo, connectedCount, filled, isSolved, shift } from './pipes-logic.js';

const GAME = 'pipelink';
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#ff4d6d', '#3b9cff', '#2fd36b', '#ffd23f', '#ff8a2a', '#27d7e6', '#e06bff', '#e8ecf3', '#b9803b'];
const LETTERS = 'ABCDEFGHI';

const CSS = `${BASE}
.pz-pl__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-pl__board{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);border-radius:12px;background:#0d0f16;border:2px solid var(--line-2,rgba(255,255,255,.22));outline:none;touch-action:none;display:block}
.pz-pl__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-pl__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);border-radius:12px;text-align:center;padding:16px}
.pz-pl__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-pl__card span{font-size:13px;color:var(--ink-2,#bbb)}
.pz-pl__sizes .is-done::after{content:" ✓";font-size:10px}
`;

const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false;
    const sv = load(GAME);
    const cleared = {};                                  /* "size-index" -> best seconds */
    for (const [k, v] of Object.entries(sv.cleared || {})) if (Number.isFinite(v)) cleared[k] = v;
    const cur = {};                                      /* size -> level index last on */
    for (const s of SIZES) cur[s] = Math.max(0, Math.min(LEVELS_PER_SIZE - 1, Number(sv.cur?.[s]) || 0));
    let size = SIZES.includes(Number(sv.size)) ? Number(sv.size) : 5;
    let index = cur[size];
    let level = null, board = null, done = false, drawing = -1, last = -1, cursor = 0, kbd = false, msg = '', strokes = 0;

    const clk = clock(t => { timeV.textContent = fmtTime(t); });
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const pipesV = h('span', { text: '0/0' });
    const pipesRead = h('div.pz__read', { title: 'Pipes linked', 'aria-label': 'Pipes linked' }, icon('link'), pipesV);
    const fillV = h('small', { text: '' });
    const bestV = h('small', { text: '' });
    const sizeBtns = SIZES.map(s => h('button', { type: 'button', dataset: { size: s }, 'aria-pressed': 'false', title: `${s} by ${s} board`, text: `${s}×${s}` }));
    const seg = h('div.pz__seg.pz-pl__sizes', { role: 'group', 'aria-label': 'Board size' }, ...sizeBtns);
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous level' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next level' }, icon('chevron-right'));
    const levelV = h('span', { text: '' });
    const levelRead = h('div.pz__read', { title: 'Level', 'aria-label': 'Level' }, icon('layers'), levelV);
    const resetBtn = h('button.pz__btn', { type: 'button', title: 'Start this level again (R)' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', seg, prevBtn, levelRead, nextBtn, pipesRead, timeRead, fillV, bestV, resetBtn);
    const svg = svgEl('svg', { class: 'pz-pl__board', tabindex: '0', role: 'application', 'aria-label': 'Pipe Link board', preserveAspectRatio: 'xMidYMid meet' });
    const bw = h('div.pz-pl__bw', svg);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, bw, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'drag from a dot to its partner · fill every square · <kbd>←↑↓→</kbd> + <kbd>Space</kbd> to draw · <kbd>R</kbd> restarts' }));

    const cellCenter = c => [(c % size) + 0.5, Math.floor(c / size) + 0.5];
    const ownersOf = () => ownerMap(board);
    function paint() {
      svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
      svg.replaceChildren();
      const own = ownersOf();
      for (let c = 0; c < size * size; c++) {
        const x = c % size, y = Math.floor(c / size);
        svg.appendChild(svgEl('rect', { x: x + 0.03, y: y + 0.03, width: 0.94, height: 0.94, rx: 0.12, fill: own[c] >= 0 ? COLORS[own[c]] : '#181b27', 'fill-opacity': own[c] >= 0 ? 0.2 : 1 }));
      }
      board.paths.forEach((p, c) => {
        if (p.length < 2) return;
        const pts = p.map(cell => cellCenter(cell).join(',')).join(' ');
        svg.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: COLORS[c], 'stroke-width': 0.44, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-color': c }));
      });
      board.ends.forEach((e, c) => {
        for (const cell of [e.a, e.b]) {
          const [cx, cy] = cellCenter(cell);
          svg.appendChild(svgEl('circle', { cx, cy, r: 0.34, fill: COLORS[c], stroke: '#0d0f16', 'stroke-width': 0.05 }));
          const t = svgEl('text', { x: cx, y: cy + 0.01, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.34, 'font-weight': 800, fill: '#0d0f16', 'font-family': 'Inter,system-ui,sans-serif', 'pointer-events': 'none' });
          t.textContent = LETTERS[c];
          svg.appendChild(t);
        }
      });
      if (kbd && !done) {
        const [cx, cy] = cellCenter(cursor);
        svg.appendChild(svgEl('rect', { x: cx - 0.46, y: cy - 0.46, width: 0.92, height: 0.92, rx: 0.14, fill: 'none', stroke: drawing >= 0 ? COLORS[drawing] : '#ffffff', 'stroke-width': 0.07, 'stroke-dasharray': drawing >= 0 ? '' : '0.18 0.12' }));
      }
      const n = board.ends.length, k = connectedCount(board), f = filled(board);
      pipesV.textContent = `${k}/${n}`;
      fillV.textContent = `${Math.round(100 * f / (size * size))}% filled`;
      svg.setAttribute('aria-label', `Pipe Link board, ${size} by ${size}. ${k} of ${n} pipes linked, ${f} of ${size * size} squares filled.`);
      const key = `${size}-${index}`;
      bestV.textContent = cleared[key] != null ? `Best: ${fmtTime(cleared[key])}` : '';
      levelV.textContent = `${index + 1}/${LEVELS_PER_SIZE}`;
      sizeBtns.forEach(b => {
        const s = Number(b.dataset.size);
        b.setAttribute('aria-pressed', String(s === size));
        b.classList.toggle('is-done', Array.from({ length: LEVELS_PER_SIZE }, (_, i) => cleared[`${s}-${i}`] != null).every(Boolean));
      });
      prevBtn.disabled = index <= 0;
      nextBtn.disabled = index >= LEVELS_PER_SIZE - 1;
    }

    function persist() { save(GAME, { size, cur: { ...cur }, cleared: { ...cleared } }); }
    function start(s = size, i = index) {
      size = s; index = Math.max(0, Math.min(LEVELS_PER_SIZE - 1, i)); cur[size] = index;
      level = makeLevel(size, index);
      board = createBoard(level);
      done = false; drawing = -1; last = -1; cursor = 0; strokes = 0; paused = false; msg = '';
      clk.stop(); clk.secs = 0; timeV.textContent = '0:00';
      bw.querySelector('.pz__cover')?.remove(); bw.querySelector('.pz-pl__card')?.remove();
      persist(); paint();
      say(`${size} by ${size}, level ${index + 1}: link ${board.ends.length} pairs and fill every square.`);
      onScore(0);
    }
    const can = () => !dead && !paused && !done;

    function afterChange(prevLinked) {
      paint();
      const k = connectedCount(board);
      if (k > prevLinked) { snd.wake(); snd.blip(330 + 60 * k, 0.09, 'triangle', 0.7); }
      if (isSolved(board)) win();
    }
    function grab(cell) {
      if (!can()) return -1;
      const c = begin(board, cell);
      if (c < 0) return -1;
      if (!clk.running) clk.start();
      drawing = c; last = cell; strokes++;
      snd.wake(); snd.blip(520, 0.04, 'sine', 0.4);
      paint();
      return c;
    }
    function drag(cell) {
      if (!can() || drawing < 0 || cell === last) return;
      last = cell;
      const before = connectedCount(board), had = filled(board);
      if (walkTo(board, drawing, cell)) {
        if (filled(board) < had - 1) snd.blip(180, 0.08, 'sawtooth', 0.4);
        afterChange(before);
      }
    }
    function release() {
      if (drawing >= 0) { drawing = -1; last = -1; paint(); }
    }
    function win() {
      done = true; drawing = -1; clk.stop();
      const secs = Math.round(clk.secs * 10) / 10, key = `${size}-${index}`;
      const prev = cleared[key], fresh = prev == null || secs < prev;
      if (fresh) cleared[key] = secs;
      const next = Math.min(LEVELS_PER_SIZE - 1, index + 1);
      cur[size] = next;
      persist(); paint();
      const lastOne = index === LEVELS_PER_SIZE - 1;
      bw.appendChild(h('div.pz-pl__card', h('div', h('b', { text: 'Linked!' }),
        h('span', { text: `${size}×${size} level ${index + 1} in ${fmtTime(secs)}${fresh && prev != null ? ' — a new best' : ''}. ${lastOne ? `That was the last ${size}×${size} level: try another size.` : `Play again for level ${index + 2}.`}` }))));
      say(`Level ${index + 1} linked in ${fmtTime(secs)}.`);
      snd.blip(523, 0.1, 'triangle', 0.8); setTimeout(() => !dead && snd.blip(659, 0.1, 'triangle', 0.8), 110); setTimeout(() => !dead && snd.blip(784, 0.16, 'triangle', 0.8), 220);
      onScore(secs);
      onEnd({ score: secs, won: true, detail: `${size}×${size} · level ${index + 1}` });
    }

    /* ----- pointer ----- */
    const cellAt = e => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return -1;
      const x = Math.floor((e.clientX - r.left) / r.width * size), y = Math.floor((e.clientY - r.top) / r.height * size);
      return x < 0 || y < 0 || x >= size || y >= size ? -1 : y * size + x;
    };
    L.on(svg, 'pointerdown', e => {
      if (dead || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const cell = cellAt(e);
      if (cell < 0) return;
      e.preventDefault(); kbd = false; cursor = cell;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
      svg.focus({ preventScroll: true });
      grab(cell);
    });
    L.on(svg, 'pointermove', e => { if (drawing < 0) return; const cell = cellAt(e); if (cell >= 0) drag(cell); });
    const up = () => release();
    L.on(svg, 'pointerup', up);
    L.on(svg, 'pointercancel', up);

    /* ----- keyboard ----- */
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };
    L.on(window, 'keydown', e => {
      if (!can() || !ownsKey(root, e)) return;
      const k = e.key;
      if (k.startsWith('Arrow')) {
        e.preventDefault(); unfocus(); kbd = true;
        const nx = shift(size, cursor, k);
        if (nx < 0) return paint();
        cursor = nx;
        if (drawing >= 0) drag(nx); else paint();
      } else if (k === ' ' || k === 'Enter') {
        e.preventDefault(); unfocus();
        if (e.repeat) return;
        kbd = true;
        if (drawing >= 0) { release(); say('Pipe put down.'); }
        else {
          const c = grab(cursor);
          say(c >= 0 ? `Drawing pipe ${LETTERS[c]}. Arrow keys draw it, Space puts it down.` : 'Nothing to pick up here: move to a dot or the end of a pipe.');
        }
      } else if (k === 'r' || k === 'R') { e.preventDefault(); start(size, index); }
      else if (k === 'n' || k === 'N') { e.preventDefault(); if (index < LEVELS_PER_SIZE - 1) start(size, index + 1); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); if (index > 0) start(size, index - 1); }
    });
    sizeBtns.forEach(b => L.on(b, 'click', () => { if (!dead) start(Number(b.dataset.size), cur[Number(b.dataset.size)]); }));
    L.on(resetBtn, 'click', () => { if (!dead) start(size, index); });
    L.on(prevBtn, 'click', () => { if (!dead && index > 0) start(size, index - 1); });
    L.on(nextBtn, 'click', () => { if (!dead && index < LEVELS_PER_SIZE - 1) start(size, index + 1); });

    start(size, index);
    requestAnimationFrame(() => { if (!dead) svg.focus({ preventScroll: true }); });

    return {
      stop() { if (dead) return; dead = true; clk.dispose(); L.clear(); snd.close(); persist(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; drawing = -1; clk.stop(); if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); if (strokes && !done) clk.start(); },
      peek: () => {
        const r = svg.getBoundingClientRect();
        return {
          size, index, level: index + 1, levels: LEVELS_PER_SIZE, colors: board.ends.length, ends: board.ends.map(e => ({ ...e })),
          paths: board.paths.map(p => p.slice()), linked: connectedCount(board), filled: filled(board), cells: size * size,
          solved: isSolved(board), done, paused, drawing, cursor, seconds: clk.secs, running: clk.running, strokes,
          cleared: { ...cleared }, cur: { ...cur },
          geom: { x: r.left, y: r.top, w: r.width, h: r.height },
        };
      },
      /* test hook — nothing in the game calls it: level(size, index) */
      hook(cmd, a, b) {
        if (cmd === 'level') start(a, b);
        return true;
      },
    };
  },
};
