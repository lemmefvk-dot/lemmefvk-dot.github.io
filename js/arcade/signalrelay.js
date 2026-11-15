/* ============================================================
   arcade/signalrelay.js — Signal Relay for Static Arcade.

   Light beams leave the sources, bend at mirrors and must land on
   every receiver of their colour. Click (or tap) a turnable mirror
   to swap its angle. Thirty levels, five sizes of board; every one
   is solvable and its par — the fewest turns that solve it — is
   worked out by trying every combination (signalrelay-logic.js; the
   test suite does it for all thirty). Walls stop light, bolted
   mirrors don't turn, splitters let the beam through and bend a
   copy of it, and blue beams don't touch red ones.

   BUILD makes a board of your own: pick a part, click cells to
   place it, Check says whether it can be solved (and its par), Play
   it tries it, Copy code gives a code a friend can open with Open
   code. A code is checked when it is opened: a wrong size, a
   character that isn't a part, no source or receiver, an already
   solved board or one with no solution is refused and says why.
   A board of your own doesn't change your best.

   Controls: click / tap a mirror · arrows move the cursor, Space or
   Enter turns the mirror under it · R starts the level again ·
   N / P next / previous level. Score = seconds, lower is better;
   the level you were on, cleared levels (best time and fewest
   turns) are kept on this device (portal.arcadePuzzles.signalrelay).
   The colour-blind colours change the beams and add a dash pattern
   to the blue ones; red parts are round and blue ones diamonds in
   every palette.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, sounder } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag, clock, fmtTime } from './puzzlekit.js';
import { NG_CSS, levelGrid, resultCard, cardButton, copyText, codeBar, secs1 } from './ng1kit.js';
import { PALETTE_CB } from './index.js';
import { LEVELS, makeLevel, trace, isSolved, solve, parseCode, toCode, turnable, turned, isSource, isReceiver, sourceColor, receiverColor, receivers, DIRS } from './signalrelay-logic.js';

const GAME = 'signalrelay';
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#ff4d6d', '#3b9cff'];
const CB = [PALETTE_CB[0], PALETTE_CB[1]];
const CSS = `${BASE}${NG_CSS}
.ng__board{width:min(100cqw,100cqh);height:min(100cqw,100cqh)}
.ng__tools button[aria-pressed="true"]{background:color-mix(in srgb,var(--ga) 28%,transparent);border-color:var(--ga)}
`;
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
/* the parts the builder offers: [char, label] */
const TOOLS = [['.', 'Erase'], ['#', 'Wall'], ['m', 'Turnable mirror /'], ['n', 'Turnable mirror \\'], ['M', 'Bolted mirror /'], ['N', 'Bolted mirror \\'], ['s', 'Splitter /'], ['t', 'Splitter \\'],
  ['1', 'Red source →'], ['2', 'Red source ←'], ['3', 'Red source ↑'], ['4', 'Red source ↓'], ['5', 'Blue source →'], ['6', 'Blue source ←'], ['7', 'Blue source ↑'], ['8', 'Blue source ↓'], ['R', 'Red receiver'], ['B', 'Blue receiver']];
const SHORT = { '.': '✕', '#': '▇', m: '╱', n: '╲', M: '⟋', N: '⟍', s: '⫽', t: '⧵', 1: '→', 2: '←', 3: '↑', 4: '↓', 5: '→', 6: '←', 7: '↑', 8: '↓', R: '◎', B: '◇' };

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false;
    const sv = load(GAME);
    const cleared = {}, fewest = {};
    for (const [k, v] of Object.entries(sv.cleared || {})) if (Number.isFinite(v)) cleared[k] = v;
    for (const [k, v] of Object.entries(sv.turns || {})) if (Number.isInteger(v) && v > 0) fewest[k] = v;
    let index = Math.max(0, Math.min(LEVELS - 1, Number(sv.cur) || 0));
    let level = null, cells = [], done = false, cursor = 0, kbd = false, msg = '', moves = 0, started = false;
    let building = false, tool = 'm', custom = false;
    let draft = null;      /* the builder's board: { w, h, cells } */

    const clk = clock(t => { timeV.textContent = fmtTime(t); });
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const movesV = h('span', { text: '0' });
    const movesRead = h('div.pz__read', { title: 'Turns (par: the fewest possible)', 'aria-label': 'Turns' }, icon('refresh'), movesV, h('small', { text: '' }));
    const litV = h('span', { text: '0/0' });
    const litRead = h('div.pz__read', { title: 'Receivers lit', 'aria-label': 'Receivers lit' }, icon('zap'), litV);
    const levelV = h('span', { text: '' });
    const levelRead = h('div.pz__read', { title: 'Level', 'aria-label': 'Level' }, icon('layers'), levelV);
    const bestV = h('small', { text: '' });
    const levelsBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'levels' }, title: 'All thirty levels' }, icon('grid-9'), h('span.pz__long', { text: 'Levels' }));
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous level (P)', 'aria-label': 'Previous level' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next level (N)', 'aria-label': 'Next level' }, icon('chevron-right'));
    const resetBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'restart' }, title: 'Start this board again (R)' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const buildBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'build' }, 'aria-pressed': 'false', title: 'Make a board of your own' }, icon('edit-3'), h('span.pz__long', { text: 'Build' }));
    const top = h('div.pz__top', levelsBtn, prevBtn, levelRead, nextBtn, litRead, movesRead, timeRead, bestV, resetBtn, buildBtn);
    const svg = svgEl('svg', { class: 'ng__board', tabindex: '0', role: 'application', 'aria-label': 'Signal Relay board', preserveAspectRatio: 'xMidYMid meet' });
    const bw = h('div.ng__bw', svg);
    const toolBtns = TOOLS.map(([c, label]) => h('button.pz__btn', { type: 'button', dataset: { tool: c }, title: label, 'aria-label': label, 'aria-pressed': String(c === tool), onclick: () => { tool = c; paintTools(); } }, h('span', { text: SHORT[c] })));
    const sizeBtns = [5, 6, 7, 8, 9].map(n => h('button.pz__btn', { type: 'button', dataset: { size: n }, title: `A ${n} by ${n} board`, onclick: () => resizeDraft(n) }, h('span', { text: `${n}×${n}` })));
    const checkBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'check' }, onclick: () => checkDraft(false) }, icon('check'), h('span', { text: 'Check' }));
    const playBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'play-draft' }, onclick: () => checkDraft(true) }, icon('play'), h('span', { text: 'Play it' }));
    const tools = h('div.ng__tools', { hidden: true, role: 'group', 'aria-label': 'Board builder parts' }, ...toolBtns);
    const tools2 = h('div.ng__tools', { hidden: true }, ...sizeBtns, checkBtn, playBtn);
    const codeBar1 = codeBar({
      placeholder: 'Paste a board code (SR1:…)', onOpen: openCode,
      onCopy: () => copyCode(),
    });
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, bw, tools, tools2, codeBar1.el, foot, live);
    el.appendChild(root);

    const cb = () => ctx.palette === 'cb';
    const colorOf = c => (cb() ? CB : COLORS)[c];
    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: building ? 'pick a part, then click cells to place it · <b>Check</b> says whether it can be solved' : 'click a mirror to turn it · <kbd>←↑↓→</kbd> + <kbd>Space</kbd> · <kbd>R</kbd> restarts' }));
    const cur = () => (building ? draft : { w: level.w, h: level.h });
    function paintTools() { toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool))); sizeBtns.forEach(b => b.setAttribute('aria-pressed', String(draft && Number(b.dataset.size) === draft.w))); }

    /* ------------------------------ drawing ------------------------------ */
    function paint() {
      const { w, h: hh } = cur();
      const grid = building ? draft.cells : cells;
      svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
      svg.style.aspectRatio = `${w} / ${hh}`;
      svg.replaceChildren();
      for (let i = 0; i < w * hh; i++) {
        const x = i % w, y = (i / w) | 0;
        svg.appendChild(svgEl('rect', { x: x + 0.03, y: y + 0.03, width: 0.94, height: 0.94, rx: 0.1, fill: '#171a26' }));
      }
      const T = trace(w, hh, grid);
      /* beams: a wide soft stroke and a bright core */
      for (const [x1, y1, x2, y2, c] of T.segs) {
        const a = { x1: x1 + 0.5, y1: y1 + 0.5, x2: x2 + 0.5, y2: y2 + 0.5 };
        svg.appendChild(svgEl('line', { ...a, stroke: colorOf(c), 'stroke-opacity': 0.28, 'stroke-width': 0.3, 'stroke-linecap': 'round' }));
        svg.appendChild(svgEl('line', { ...a, stroke: colorOf(c), 'stroke-width': 0.1, 'stroke-linecap': 'round', ...(cb() && c === 1 ? { 'stroke-dasharray': '0.22 0.12' } : {}) }));
      }
      for (let i = 0; i < w * hh; i++) {
        const c = grid[i], cx = (i % w) + 0.5, cy = ((i / w) | 0) + 0.5;
        if (c === '#') {
          svg.appendChild(svgEl('rect', { x: cx - 0.44, y: cy - 0.44, width: 0.88, height: 0.88, rx: 0.08, fill: '#3a3f55', stroke: '#565c78', 'stroke-width': 0.04 }));
        } else if ('mnMNst'.includes(c)) {
          const slash = c === 'm' || c === 'M' || c === 's', can = turnable(c) || building;
          const a = slash ? [cx - 0.34, cy + 0.34, cx + 0.34, cy - 0.34] : [cx - 0.34, cy - 0.34, cx + 0.34, cy + 0.34];
          if (turnable(c)) svg.appendChild(svgEl('circle', { cx, cy, r: 0.44, fill: 'none', stroke: 'rgba(255,255,255,.28)', 'stroke-width': 0.04, 'stroke-dasharray': '0.12 0.1' }));
          svg.appendChild(svgEl('line', { x1: a[0], y1: a[1], x2: a[2], y2: a[3], stroke: c === 's' || c === 't' ? '#9fe8ff' : '#e8ecf5', 'stroke-width': 0.14, 'stroke-linecap': 'round', ...(c === 's' || c === 't' ? { 'stroke-dasharray': '0.3 0.1' } : {}) }));
          svg.appendChild(svgEl('circle', { cx, cy, r: 0.07, fill: can ? '#ffd23f' : '#7b8199' }));
          if (c === 'M' || c === 'N') for (const k of [-1, 1]) svg.appendChild(svgEl('circle', { cx: a[0] + (a[2] - a[0]) * (k + 1) / 2, cy: a[1] + (a[3] - a[1]) * (k + 1) / 2, r: 0.05, fill: '#7b8199' }));
        } else if (isSource(c)) {
          const col = sourceColor(c), dir = [1, 3, 0, 2][(+c - 1) % 4];
          const round = col === 0;
          svg.appendChild(round ? svgEl('circle', { cx, cy, r: 0.32, fill: colorOf(col), stroke: '#0d0f16', 'stroke-width': 0.05 })
            : svgEl('rect', { x: cx - 0.3, y: cy - 0.3, width: 0.6, height: 0.6, fill: colorOf(col), stroke: '#0d0f16', 'stroke-width': 0.05, transform: `rotate(45 ${cx} ${cy})` }));
          const [dx, dy] = DIRS[dir];
          svg.appendChild(svgEl('polygon', { points: `${cx + dx * 0.42},${cy + dy * 0.42} ${cx + dx * 0.16 - dy * 0.14},${cy + dy * 0.16 + dx * 0.14} ${cx + dx * 0.16 + dy * 0.14},${cy + dy * 0.16 - dx * 0.14}`, fill: '#fff' }));
        } else if (isReceiver(c)) {
          const col = receiverColor(c), on = T.lit.has(i);
          const round = col === 0;
          const common = { fill: on ? colorOf(col) : '#0d0f16', 'fill-opacity': on ? 0.95 : 1, stroke: colorOf(col), 'stroke-width': 0.07 };
          svg.appendChild(round ? svgEl('circle', { cx, cy, r: 0.3, ...common }) : svgEl('rect', { x: cx - 0.27, y: cy - 0.27, width: 0.54, height: 0.54, ...common, transform: `rotate(45 ${cx} ${cy})` }));
          svg.appendChild(svgEl('circle', { cx, cy, r: 0.09, fill: on ? '#fff' : colorOf(col) }));
          svg.lastChild.setAttribute('data-lit', on ? '1' : '0');
        }
      }
      if (kbd && !done) {
        const cx = (cursor % w) + 0.5, cy = ((cursor / w) | 0) + 0.5;
        svg.appendChild(svgEl('rect', { x: cx - 0.46, y: cy - 0.46, width: 0.92, height: 0.92, rx: 0.12, fill: 'none', stroke: '#fff', 'stroke-width': 0.06, 'stroke-dasharray': '0.18 0.12' }));
      }
      const rc = receivers(w, hh, grid);
      litV.textContent = `${rc.filter(i => T.lit.has(i)).length}/${rc.length}`;
      svg.setAttribute('aria-label', `Signal Relay board, ${w} by ${hh}. ${litV.textContent} receivers lit.${building ? ' Building.' : ''}`);
      if (!building && level) {
        const par = level.par, key = String(index);
        movesV.textContent = String(moves);
        movesRead.lastChild.textContent = `par ${par}`;
        movesRead.classList.toggle('is-over', moves > par);
        levelV.textContent = custom ? 'Your board' : `${index + 1}/${LEVELS}`;
        bestV.textContent = !custom && cleared[key] != null ? `Best: ${fmtTime(cleared[key])} · ${fewest[key]} turns${fewest[key] <= level.par ? ' ★' : ''}` : '';
        prevBtn.disabled = custom || index <= 0;
        nextBtn.disabled = custom || index >= LEVELS - 1;
      } else {
        movesV.textContent = '–'; movesRead.lastChild.textContent = ''; levelV.textContent = 'Builder'; bestV.textContent = '';
        prevBtn.disabled = nextBtn.disabled = true;
      }
    }

    /* ------------------------------ levels ------------------------------ */
    const clearOverlays = () => { for (const s of ['.pz__cover', '.ng__card', '.ng__levels']) bw.querySelector(s)?.remove(); };
    function persist() { save(GAME, { cur: index, cleared: { ...cleared }, turns: { ...fewest } }); }
    function begin(lv, isCustom) {
      level = lv; custom = !!isCustom; building = false;
      cells = Array.from(lv.cells);
      done = false; moves = 0; started = false; cursor = 0; msg = ''; paused = false;
      clk.stop(); clk.secs = 0; timeV.textContent = '0:00';
      clearOverlays();
      tools.hidden = tools2.hidden = true; buildBtn.setAttribute('aria-pressed', 'false');
      if (!custom) persist();
      paint();
      say(custom ? `Your board: ${lv.w} by ${lv.h}, par ${lv.par}. A board of your own doesn't change your best.`
        : `Level ${index + 1}: light every receiver. Par is ${lv.par} turn${lv.par === 1 ? '' : 's'}.`);
      onScore(0);
    }
    const start = i => { index = Math.max(0, Math.min(LEVELS - 1, i)); begin(makeLevel(index), false); };

    function turn(i) {
      if (dead || paused || done || building) return false;
      if (!turnable(cells[i])) { snd.blip(150, 0.06, 'sawtooth', 0.4); return false; }
      if (!started) { started = true; clk.start(); }
      cells[i] = turned(cells[i]); moves++;
      snd.wake(); snd.blip(380, 0.05, 'triangle', 0.6);
      paint();
      if (isSolved(level.w, level.h, cells)) win();
      return true;
    }
    function win() {
      done = true; clk.stop();
      const secs = Math.max(0.1, secs1(clk.secs)), par = level.par, perfect = moves <= par;
      const solvedAt = index, key = String(solvedAt);
      if (!custom) {
        const prev = cleared[key];
        if (prev == null || secs < prev) cleared[key] = secs;
        if (!fewest[key] || moves < fewest[key]) fewest[key] = moves;
        if (index < LEVELS - 1) index++;
        persist();
      }
      paint();
      const line = perfect ? `Perfect: ${moves} turn${moves === 1 ? '' : 's'}, par ${par}.` : `${moves} turns; par is ${par}.`;
      const what = custom ? 'Your board' : `Level ${solvedAt + 1}`;
      const next = custom ? cardButton('Back to the builder', () => { clearOverlays(); enterBuild(true); }, 'edit-3')
        : solvedAt < LEVELS - 1 ? cardButton('Next level', () => start(index), 'chevron-right') : cardButton('Play level 30 again', () => start(solvedAt), 'refresh');
      bw.appendChild(resultCard(perfect ? 'Signal relayed in par!' : 'Signal relayed!', `${what} in ${fmtTime(secs)}. ${line}`, next));
      say(`Solved in ${fmtTime(secs)}. ${line}`);
      snd.blip(523, 0.1, 'triangle', 0.8); setTimeout(() => !dead && snd.blip(784, 0.16, 'triangle', 0.8), 120);
      onScore(secs);
      onEnd({
        score: secs, won: true,
        detail: custom ? `A board of your own · ${moves} turns, par ${par}` : `Level ${solvedAt + 1} · ${moves} turns, par ${par}${perfect ? ' (perfect)' : ''}`,
        ...(custom ? { assisted: 'A board of your own doesn’t change your best' } : {}),
      });
    }

    /* ------------------------------ the level list ------------------------------ */
    function showLevels() {
      if (building) return;
      const open = bw.querySelector('.ng__levels');
      if (open) { open.remove(); return; }
      const n = Object.keys(cleared).length, p = Object.keys(cleared).filter(k => fewest[k] && fewest[k] <= makeLevel(+k).par).length;
      bw.appendChild(h('div.ng__levels', { role: 'dialog', 'aria-label': 'Levels' },
        h('h4', { text: 'Signal Relay · 30 levels' }), h('p', { text: `${n} of ${LEVELS} cleared · ${p} in par` }),
        levelGrid(LEVELS, custom ? -1 : index, i => {
          const k = String(i), par = makeLevel(i).par, inPar = fewest[k] && fewest[k] <= par;
          return { done: cleared[k] != null, star: inPar, note: inPar ? '★ par' : cleared[k] != null ? '✓' : `par ${par}`, title: `Level ${i + 1}: ${makeLevel(i).w}×${makeLevel(i).h}, par ${par}${cleared[k] != null ? `, cleared in ${fmtTime(cleared[k])}, ${fewest[k]} turns` : ''}` };
        }, i => { if (!dead) start(i); })));
      bw.querySelector('.ng__lv button.is-cur')?.focus({ preventScroll: true });
    }

    /* ------------------------------ the builder ------------------------------ */
    function enterBuild(keep = false) {
      building = true; paused = false; clk.stop(); clearOverlays();
      if (!keep || !draft) draft = level ? { w: level.w, h: level.h, cells: Array.from(done ? level.cells : level.cells) } : { w: 6, h: 6, cells: Array(36).fill('.') };
      cursor = 0;
      tools.hidden = tools2.hidden = false; buildBtn.setAttribute('aria-pressed', 'true');
      paintTools(); msg = ''; paint(); paintFoot();
      say('Builder: pick a part and click cells. Check says whether the board can be solved.');
    }
    function leaveBuild() {
      building = false; tools.hidden = tools2.hidden = true; buildBtn.setAttribute('aria-pressed', 'false');
      if (custom && level) begin(level, true); else start(index);
    }
    function resizeDraft(n) {
      const next = Array(n * n).fill('.');
      for (let y = 0; y < Math.min(n, draft.h); y++) for (let x = 0; x < Math.min(n, draft.w); x++) next[y * n + x] = draft.cells[y * draft.w + x];
      draft = { w: n, h: n, cells: next };
      cursor = Math.min(cursor, n * n - 1);
      paintTools(); paint();
      say(`The board is now ${n} by ${n}.`);
    }
    function place(i) {
      if (!building) return;
      draft.cells[i] = tool;
      snd.wake(); snd.blip(300, 0.04, 'triangle', 0.5);
      paint();
    }
    const draftCode = () => toCode(draft.w, draft.h, draft.cells);
    function checkDraft(thenPlay) {
      const r = parseCode(draftCode());
      if (!r.ok) { say(r.why); return false; }
      if (thenPlay) { begin({ w: r.w, h: r.h, cells: r.cells, par: r.par, turnable: 0 }, true); return true; }
      say(`That board can be solved: par is ${r.par} turn${r.par === 1 ? '' : 's'}.`);
      return true;
    }
    async function copyCode() {
      const grid = building ? draft : { w: level.w, h: level.h, cells: level.cells };
      const code = toCode(grid.w, grid.h, grid.cells);
      if (building) { const r = parseCode(code); if (!r.ok) { say(`Not ready to share: ${r.why}`); return; } }
      codeBar1.input.value = code;
      const okc = await copyText(code);
      say(okc ? 'The board code is copied. A friend opens it with Open code.' : 'The code is in the box: select it and copy it.');
    }
    function openCode(text) {
      const r = parseCode(text);
      if (!r.ok) { say(r.why); codeBar1.input.classList.add('is-bad'); return false; }
      codeBar1.input.classList.remove('is-bad');
      begin({ w: r.w, h: r.h, cells: r.cells, par: r.par, turnable: 0 }, true);
      return true;
    }

    /* ------------------------------ input ------------------------------ */
    const cellAt = e => {
      const r = svg.getBoundingClientRect(), { w, h: hh } = cur();
      if (!r.width) return -1;
      const x = Math.floor((e.clientX - r.left) / r.width * w), y = Math.floor((e.clientY - r.top) / r.height * hh);
      return x < 0 || y < 0 || x >= w || y >= hh ? -1 : y * w + x;
    };
    L.on(svg, 'pointerdown', e => {
      if (dead || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const i = cellAt(e);
      if (i < 0) return;
      e.preventDefault(); kbd = false; cursor = i;
      svg.focus({ preventScroll: true });
      if (building) place(i); else turn(i);
    });
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };
    L.on(window, 'keydown', e => {
      if (dead || paused || !ownsKey(root, e)) return;
      const k = e.key, { w, h: hh } = cur();
      if (k.startsWith('Arrow')) {
        e.preventDefault(); unfocus(); kbd = true;
        const x = cursor % w, y = (cursor / w) | 0;
        const nx = k === 'ArrowLeft' ? x - 1 : k === 'ArrowRight' ? x + 1 : x, ny = k === 'ArrowUp' ? y - 1 : k === 'ArrowDown' ? y + 1 : y;
        if (nx >= 0 && ny >= 0 && nx < w && ny < hh) cursor = ny * w + nx;
        paint();
      } else if (k === ' ' || k === 'Enter') {
        e.preventDefault(); unfocus(); if (e.repeat) return; kbd = true;
        if (building) place(cursor); else if (!done) turn(cursor);
      } else if (building) {
        return;
      } else if (k === 'r' || k === 'R') { e.preventDefault(); begin(level, custom); }
      else if (!custom && (k === 'n' || k === 'N')) { e.preventDefault(); if (index < LEVELS - 1) start(index + 1); }
      else if (!custom && (k === 'p' || k === 'P')) { e.preventDefault(); if (index > 0) start(index - 1); }
    });
    L.on(levelsBtn, 'click', () => { if (!dead) showLevels(); });
    L.on(prevBtn, 'click', () => { if (!dead && index > 0) start(index - 1); });
    L.on(nextBtn, 'click', () => { if (!dead && index < LEVELS - 1) start(index + 1); });
    L.on(resetBtn, 'click', () => { if (dead) return; if (building) { draft.cells.fill('.'); paint(); say('The board is empty.'); } else begin(level, custom); });
    L.on(buildBtn, 'click', () => { if (dead) return; if (building) leaveBuild(); else enterBuild(!!draft); });

    start(index);
    requestAnimationFrame(() => { if (!dead) svg.focus({ preventScroll: true }); });

    return {
      stop() { if (dead) return; dead = true; clk.dispose(); L.clear(); snd.close(); if (!custom) persist(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; clk.stop(); if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); if (started && !done && !building) clk.start(); },
      peek: () => {
        const r = svg.getBoundingClientRect(), { w, h: hh } = cur(), grid = building ? draft.cells : cells;
        const T = trace(w, hh, grid), rc = receivers(w, hh, grid);
        return {
          index, level: index + 1, levels: LEVELS, w, h: hh, cells: grid.join(''), start: level ? level.cells.join('') : '', par: level ? level.par : null, moves, done, paused, building, custom,
          lit: rc.filter(i => T.lit.has(i)).length, receivers: rc.length, solved: isSolved(w, hh, grid), seconds: clk.secs, running: clk.running, tool, cursor,
          cleared: { ...cleared }, fewest: { ...fewest }, palette: cb() ? 'cb' : 'standard', beams: T.segs.length,
          geom: { x: r.left, y: r.top, w: r.width, h: r.height }, draft: draft ? draftCode() : null, message: msg,
        };
      },
      /* test hook — nothing in the game calls it: level(i), solution() -> the cells of the cheapest solution */
      hook(cmd, a) {
        if (cmd === 'level') { start(a); return true; }
        if (cmd === 'solution') return solve(level.w, level.h, level.cells)?.cells.join('') || null;
        return false;
      },
    };
  },
};
