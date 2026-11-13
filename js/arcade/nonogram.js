/* ============================================================
   arcade/nonogram.js — Nonograms for Static Arcade.

   The numbers beside each row and above each column say how long
   the runs of filled cells in that line are, in order. Fill the
   cells that must be filled; the picture appears. 31 original
   pictures, 5×5 to 15×15 (nonogram.data.js). Every one is checked
   to have exactly one solution, solvable by line logic alone, so
   none ever needs a guess (see nonogramlogic.js and the tests).

   Controls
     mouse   click or drag to fill · right-click or drag to cross
             (a stroke paints the same thing along one row or column)
     touch   tap or drag to fill; the Fill / Cross switch sets what a
             tap does
     keyboard  arrows move · Space or F fills · X crosses ·
             Backspace clears · Z undoes
   A clue goes dim and struck through when its line's filled runs
   match it, so you can see what is settled. Crosses are only your
   own notes: the puzzle is solved when every row and column matches
   its clue.

   Score = seconds from the first mark to the last, lower is better.
   Progress on an unfinished picture, the pictures you've solved and
   your best time on each are saved on this device
   (portal.arcadePuzzles.nonogram). The clock stops while paused and
   the picture is covered then.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { PUZZLES } from './nonogram.data.js';
import { cluesOf, runsOf, sameRuns } from './nonogramlogic.js';

const GAME = 'nonogram';
const byId = id => PUZZLES.find(p => p.id === id) || null;

const CSS = `${BASE}
.pz-ng__stage{touch-action:none}
.pz-ng__wrap{--u:min(calc(100cqw / (var(--w) + var(--cw) * .62)),calc(100cqh / (var(--h) + var(--ch) * .62)));
  display:grid;grid-template-columns:calc(var(--cw) * .62 * var(--u)) calc(var(--w) * var(--u));grid-template-rows:calc(var(--ch) * .62 * var(--u)) calc(var(--h) * var(--u));
  font-family:var(--font,system-ui)}
.pz-ng__cols{display:grid;grid-template-columns:repeat(var(--w),1fr)}
.pz-ng__rows{display:grid;grid-template-rows:repeat(var(--h),1fr)}
.pz-ng__cc{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:calc(var(--u) * .03);padding-bottom:calc(var(--u) * .08);font:700 calc(var(--u) * .4)/1 var(--font,system-ui);color:var(--ink-1,#ddd);font-variant-numeric:tabular-nums}
.pz-ng__rc{display:flex;flex-direction:row;justify-content:flex-end;align-items:center;gap:calc(var(--u) * .2);padding-right:calc(var(--u) * .12);font:700 calc(var(--u) * .4)/1 var(--font,system-ui);color:var(--ink-1,#ddd);font-variant-numeric:tabular-nums}
.pz-ng__cc.is-done,.pz-ng__rc.is-done{color:var(--ink-3,#777);text-decoration:line-through;opacity:.6}
.pz-ng__cc.is-cur,.pz-ng__rc.is-cur{background:color-mix(in srgb,var(--ga) 16%,transparent)}
.pz-ng__board{display:grid;grid-template-columns:repeat(var(--w),1fr);grid-template-rows:repeat(var(--h),1fr);border:2px solid var(--line-2,rgba(255,255,255,.3));border-radius:4px;background:var(--bg-ng,#171320);outline:none;touch-action:none;cursor:crosshair}
.pz-ng__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-ng__c{position:relative;box-shadow:inset 0 0 0 .5px var(--line-1,rgba(255,255,255,.12));display:grid;place-items:center}
.pz-ng__c.r5{box-shadow:inset 0 0 0 .5px var(--line-1,rgba(255,255,255,.12)),inset -2px 0 0 -1px var(--line-2,rgba(255,255,255,.4))}
.pz-ng__c.is-cur{box-shadow:inset 0 0 0 2px var(--ga)}
.pz-ng__c.is-f{background:var(--ga)}
.pz-ng__c.is-x::before,.pz-ng__c.is-x::after{content:"";position:absolute;left:24%;right:24%;top:calc(50% - 1px);height:2px;background:var(--ink-3,#9a9aa8);transform:rotate(45deg);border-radius:2px}
.pz-ng__c.is-x::after{transform:rotate(-45deg)}
.pz-ng__board.is-solved .pz-ng__c.is-f{background:var(--pic,var(--ga))}
.pz-ng__board.is-solved .pz-ng__c.is-x{opacity:0}
.pz-ng__pick{position:absolute;inset:0;z-index:4;overflow:auto;padding:var(--sp-3,10px);background:rgba(12,9,18,.94);border-radius:8px;text-align:left}
.pz-ng__pick h4{margin:10px 0 6px;font:700 12px/1 var(--font,system-ui);color:var(--ink-3,#999);text-transform:uppercase;letter-spacing:.06em}
.pz-ng__pick h4:first-child{margin-top:0}
.pz-ng__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:6px}
.pz-ng__grid button{display:flex;flex-direction:column;gap:3px;align-items:flex-start;padding:8px 10px;border-radius:9px;border:1px solid var(--line-1,rgba(255,255,255,.1));background:var(--fill-1,rgba(255,255,255,.06));color:var(--ink-0,#fff);font:600 13px/1.1 var(--font,system-ui);cursor:pointer;text-align:left}
.pz-ng__grid button small{font:500 11px/1.2 var(--font,system-ui);color:var(--ink-3,#999)}
.pz-ng__grid button.is-solved{border-color:color-mix(in srgb,var(--ga) 55%,transparent)}
.pz-ng__grid button.is-solved small{color:var(--ga)}
.pz-ng__grid button.is-cur{box-shadow:0 0 0 2px var(--ga)}
.pz-ng__grid button:focus-visible{outline:2px solid var(--ga)}
@media (hover:hover){.pz-ng__grid button:hover{background:var(--fill-2,rgba(255,255,255,.12))}}
.pz-ng__title{font:700 14px/1 var(--font,system-ui);color:var(--ink-0,#fff);white-space:nowrap}
.pz-ng__title small{font-weight:500;color:var(--ink-3,#999);margin-left:6px}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    let dead = false, paused = false;
    const sv = load(GAME);
    const solvedMap = { ...(sv.solved || {}) };      /* id → best seconds */
    const prog = { ...(sv.prog || {}) };             /* id → { cells, secs } */

    let P = null, clues = null, cells = [], W = 0, Hh = 0, done = false;
    let cur = 0, mode = 'fill', msg = '';
    const undo = [];
    let nodes = [], rowEls = [], colEls = [];

    /* ---------- chrome ---------- */
    const title = h('div.pz-ng__title');
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const pickBtn = h('button.pz__btn', { type: 'button', title: 'Choose a picture' }, icon('grid-9'), h('span', { text: 'Pictures' }));
    const fillBtn = h('button', { type: 'button', 'aria-pressed': 'true', title: 'Taps and clicks fill' }, 'Fill');
    const crossBtn = h('button', { type: 'button', 'aria-pressed': 'false', title: 'Taps and clicks cross' }, 'Cross');
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Tap mode' }, fillBtn, crossBtn);
    const undoBtn = h('button.pz__btn', { type: 'button', title: 'Undo (Z)' }, icon('rotate-ccw'), h('span.pz__long', { text: 'Undo' }));
    const clearBtn = h('button.pz__btn', { type: 'button', title: 'Clear the grid and start this picture again' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', pickBtn, title, timeRead, seg, undoBtn, clearBtn);
    const stage = h('div.pz__stage.pz-ng__stage');
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, stage, foot, live);
    el.appendChild(root);

    const clk = clock(s => { timeV.textContent = fmtTime(s); });
    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg
      ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'click / drag fill · right-click cross · or <kbd>Space</kbd> fill · <kbd>X</kbd> cross · <kbd>Z</kbd> undo · arrows move' }));

    /* ---------- the puzzle ---------- */
    const idx = (x, y) => y * W + x;
    const lineOf = (kind, k) => (kind === 'r'
      ? Array.from({ length: W }, (_, x) => (cells[idx(x, k)] === 1 ? 1 : 0))
      : Array.from({ length: Hh }, (_, y) => (cells[idx(k, y)] === 1 ? 1 : 0)));
    const rowOk = y => sameRuns(runsOf(lineOf('r', y)), clues.rows[y]);
    const colOk = x => sameRuns(runsOf(lineOf('c', x)), clues.cols[x]);
    const complete = () => { for (let y = 0; y < Hh; y++) if (!rowOk(y)) return false; for (let x = 0; x < W; x++) if (!colOk(x)) return false; return true; };

    function build() {
      stage.replaceChildren();
      const cw = Math.max(...clues.rows.map(r => r.length)), ch = Math.max(...clues.cols.map(c => c.length));
      const wrap = h('div.pz-ng__wrap', { style: { '--w': W, '--h': Hh, '--cw': cw, '--ch': ch } });
      const colBox = h('div.pz-ng__cols', { style: { gridColumn: '2', gridRow: '1' } });
      const rowBox = h('div.pz-ng__rows', { style: { gridColumn: '1', gridRow: '2' } });
      colEls = clues.cols.map(c => { const d = h('div.pz-ng__cc', c.map(n => h('span', { text: String(n) }))); colBox.appendChild(d); return d; });
      rowEls = clues.rows.map(r => { const d = h('div.pz-ng__rc', r.map(n => h('span', { text: String(n) }))); rowBox.appendChild(d); return d; });
      const board = h('div.pz-ng__board', { role: 'grid', tabindex: '0', 'aria-label': `${W} by ${Hh} nonogram`, style: { gridColumn: '2', gridRow: '2', '--pic': `hsl(${(PUZZLES.indexOf(P) * 47) % 360},75%,58%)` } });
      nodes = cells.map((_, i) => {
        const x = i % W, y = Math.floor(i / W);
        const c = h('div.pz-ng__c' + ((x % 5 === 4 && x < W - 1) ? '.r5' : ''), { role: 'gridcell', dataset: { x, y } });
        board.appendChild(c);
        return c;
      });
      wrap.append(colBox, rowBox, board);
      stage.appendChild(wrap);
      stage.board = board;
      attachBoard(board);
    }

    function paintAll() {
      cells.forEach((v, i) => {
        const c = nodes[i];
        c.className = 'pz-ng__c' + (((i % W) % 5 === 4 && (i % W) < W - 1) ? ' r5' : '') + (v === 1 ? ' is-f' : v === 2 ? ' is-x' : '') + (i === cur && !done ? ' is-cur' : '');
        c.setAttribute('aria-label', `Row ${Math.floor(i / W) + 1}, column ${(i % W) + 1}, ${v === 1 ? 'filled' : v === 2 ? 'crossed' : 'empty'}`);
      });
      for (let y = 0; y < Hh; y++) { rowEls[y].classList.toggle('is-done', rowOk(y)); rowEls[y].classList.toggle('is-cur', !done && Math.floor(cur / W) === y); }
      for (let x = 0; x < W; x++) { colEls[x].classList.toggle('is-done', colOk(x)); colEls[x].classList.toggle('is-cur', !done && cur % W === x); }
      title.replaceChildren(done ? `${P.name}` : `Picture ${PUZZLES.indexOf(P) + 1}`, h('small', { text: `${W}×${Hh}` }));
      seg.children[0].setAttribute('aria-pressed', String(mode === 'fill'));
      seg.children[1].setAttribute('aria-pressed', String(mode === 'cross'));
      undoBtn.disabled = !undo.length || done;
      paintFoot();
    }

    function open(id, fresh = false) {
      const p = byId(id) || PUZZLES[0];
      P = p; clues = cluesOf(p.rows); W = clues.w; Hh = clues.h;
      const s = !fresh && prog[p.id];
      cells = s && typeof s.cells === 'string' && s.cells.length === W * Hh ? [...s.cells].map(Number) : new Array(W * Hh).fill(0);
      done = false; undo.length = 0; cur = 0; msg = '';
      paused = false; clk.stop(); clk.secs = s ? s.secs || 0 : 0; timeV.textContent = fmtTime(clk.secs);
      if (s && cells.some(Boolean)) clk.start();
      build(); paintAll();
      save(GAME, { cur: p.id });
      if (s && cells.some(Boolean)) say('Welcome back: your picture is where you left it.');
    }
    function persist() {
      if (!P || done) return;
      if (cells.some(Boolean)) prog[P.id] = { cells: cells.join(''), secs: Math.round(clk.secs) }; else delete prog[P.id];
      save(GAME, { prog, cur: P.id });
    }

    /* ---------- marking ---------- */
    const snap = () => { undo.push(cells.slice()); if (undo.length > 200) undo.shift(); };
    function changed() {
      paintAll();
      if (!done && complete()) win();
    }
    function start() { if (!clk.running && !done && !paused) clk.start(); }
    function win() {
      done = true; clk.stop();
      const secs = Math.max(1, Math.round(clk.secs));
      const prev = solvedMap[P.id];
      const fresh = prev == null || secs < prev;
      if (fresh) solvedMap[P.id] = secs;
      delete prog[P.id];
      save(GAME, { solved: solvedMap, prog, cur: P.id });
      cells = cells.map(v => (v === 1 ? 1 : 0));
      stage.board.classList.add('is-solved');
      paintAll();
      say(`${P.name}! Solved in ${fmtTime(secs)}${fresh && prev != null ? ', a new best for this picture' : ''}.`);
      onScore(secs);
      onEnd({ score: secs, won: true, detail: `${P.name} · ${W}×${Hh}` });
    }
    const canEdit = () => !done && !paused && !dead;
    function setCell(i, v) {
      if (cells[i] === v) return false;
      cells[i] = v; return true;
    }

    /* a stroke: the value painted comes from the cell it starts on */
    let stroke = null;
    const cellAt = (board, e) => {
      const r = board.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * W), y = Math.floor(((e.clientY - r.top) / r.height) * Hh);
      return x < 0 || y < 0 || x >= W || y >= Hh ? -1 : idx(x, y);
    };
    function paintCell(i, v) {
      /* crosses never overwrite a filled cell */
      if (v === 2 && cells[i] === 1) return;
      setCell(i, v);
    }
    function attachBoard(board) {
      L.add(() => { stroke = null; });
      const down = e => {
        if (!canEdit() || (e.button !== 0 && e.button !== 2)) return;
        const i = cellAt(board, e);
        if (i < 0) return;
        e.preventDefault();
        const want = e.button === 2 || mode === 'cross' ? 2 : 1;
        const v = cells[i] === want ? 0 : want;
        snap(); start();
        cur = i;
        stroke = { id: e.pointerId, v, from: i, axis: null, last: i };
        try { board.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
        paintCell(i, v);
        paintAll();
        board.focus({ preventScroll: true });
      };
      const move = e => {
        if (!stroke || e.pointerId !== stroke.id || !canEdit()) return;
        const i = cellAt(board, e);
        if (i < 0 || i === stroke.last) return;
        const [x0, y0] = [stroke.from % W, Math.floor(stroke.from / W)];
        const [x, y] = [i % W, Math.floor(i / W)];
        if (!stroke.axis) stroke.axis = Math.abs(x - x0) >= Math.abs(y - y0) ? 'h' : 'v';
        const tx = stroke.axis === 'h' ? x : x0, ty = stroke.axis === 'v' ? y : y0;
        const [lx, ly] = [stroke.last % W, Math.floor(stroke.last / W)];
        /* every cell between the last one and here along the line, so a fast drag leaves no gaps */
        const n = Math.max(Math.abs(tx - lx), Math.abs(ty - ly));
        for (let k = 1; k <= n; k++) paintCell(idx(lx + Math.sign(tx - lx) * Math.min(k, Math.abs(tx - lx)), ly + Math.sign(ty - ly) * Math.min(k, Math.abs(ty - ly))), stroke.v);
        stroke.last = idx(tx, ty);
        cur = stroke.last;
        paintAll();
      };
      const up = e => {
        if (!stroke || e.pointerId !== stroke.id) return;
        stroke = null;
        persist();
        changed();
      };
      L.on(board, 'pointerdown', down);
      L.on(board, 'pointermove', move);
      L.on(board, 'pointerup', up);
      L.on(board, 'pointercancel', up);
      L.on(board, 'contextmenu', e => e.preventDefault());
    }

    function keyMark(v) {
      if (!canEdit()) return;
      snap(); start();
      const want = v;
      paintCell(cur, cells[cur] === want ? 0 : want);
      persist(); changed();
    }
    function doUndo() {
      if (!undo.length || !canEdit()) return;
      cells = undo.pop();
      persist(); paintAll();
    }

    /* ---------- picker ---------- */
    function showPicker() {
      if (stage.querySelector('.pz-ng__pick')) { stage.querySelector('.pz-ng__pick').remove(); return; }
      if (!paused) { /* the clock keeps its place while you choose */ }
      const sizes = [...new Set(PUZZLES.map(p => p.rows.length))];
      const pick = h('div.pz-ng__pick', { role: 'dialog', 'aria-label': 'Choose a picture' },
        sizes.map(n => [
          h('h4', { text: `${n} × ${n}` }),
          h('div.pz-ng__grid', PUZZLES.filter(p => p.rows.length === n).map(p => {
            const best = solvedMap[p.id], has = prog[p.id] && prog[p.id].cells.includes('1');
            return h('button', {
              type: 'button', dataset: { id: p.id }, class: (best != null ? 'is-solved ' : '') + (P && P.id === p.id ? 'is-cur' : ''),
              onclick: () => { persist(); open(p.id); },
            }, h('span', { text: best != null ? p.name : `Picture ${PUZZLES.indexOf(p) + 1}` }),
            h('small', { text: best != null ? `Solved · ${fmtTime(best)}` : has ? 'In progress' : 'Not solved yet' }));
          })),
        ]));
      stage.appendChild(pick);
      pick.querySelector('button')?.focus({ preventScroll: true });
    }

    /* ---------- wiring ---------- */
    L.on(pickBtn, 'click', showPicker);
    L.on(fillBtn, 'click', () => { mode = 'fill'; paintAll(); });
    L.on(crossBtn, 'click', () => { mode = 'cross'; paintAll(); });
    L.on(undoBtn, 'click', doUndo);
    L.on(clearBtn, 'click', () => { if (!dead) { persist(); delete prog[P.id]; save(GAME, { prog }); open(P.id, true); } });
    const MOVE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    L.on(window, 'keydown', e => {
      if (dead || paused || !P || !ownsKey(root, e)) return;
      if (stage.querySelector('.pz-ng__pick') && !(e.key === 'Escape')) return;
      const k = e.key;
      if (MOVE[k]) {
        e.preventDefault();
        const x = Math.max(0, Math.min(W - 1, (cur % W) + MOVE[k][0])), y = Math.max(0, Math.min(Hh - 1, Math.floor(cur / W) + MOVE[k][1]));
        cur = idx(x, y); paintAll();
        /* Shift held: paint along as you go */
        if (e.shiftKey && canEdit()) { start(); paintCell(cur, mode === 'cross' ? 2 : 1); persist(); changed(); }
      } else if (k === ' ' || k === 'f' || k === 'F') {
        e.preventDefault(); if (!e.repeat) keyMark(mode === 'cross' && k !== 'f' && k !== 'F' ? 2 : 1);
      } else if (k === 'x' || k === 'X') {
        e.preventDefault(); if (!e.repeat) keyMark(2);
      } else if (k === 'Backspace' || k === 'Delete') {
        e.preventDefault();
        if (canEdit() && cells[cur]) { snap(); cells[cur] = 0; persist(); changed(); }
      } else if (k === 'z' || k === 'Z' || k === 'u' || k === 'U') {
        e.preventDefault(); doUndo();
      }
    });

    /* start on the picture you were on, or the next one not yet solved */
    const startId = (() => {
      const c = byId(sv.cur);
      if (c && (prog[c.id] || solvedMap[c.id] == null)) return c.id;
      const from = c ? PUZZLES.indexOf(c) : -1;
      for (let k = 1; k <= PUZZLES.length; k++) {
        const p = PUZZLES[(from + k) % PUZZLES.length];
        if (solvedMap[p.id] == null) return p.id;
      }
      return PUZZLES[0].id;
    })();
    open(startId);
    requestAnimationFrame(() => { if (!dead) stage.board?.focus({ preventScroll: true }); });
    onScore(0);

    return {
      stop() {
        if (dead) return;
        persist();
        dead = true;
        clk.dispose();
        L.clear();
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        paused = true; clk.stop(); persist();
        if (!done) stage.appendChild(h('div.pz__cover', { text: 'Paused' }));
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        stage.querySelector('.pz__cover')?.remove();
        if (!done && cells.some(Boolean)) clk.start();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => P && ({
        id: P.id, name: P.name, w: W, h: Hh, cells: cells.join(''), solution: P.rows.join(''), clues: { rows: clues.rows, cols: clues.cols },
        doneRows: rowEls.map((e, i) => (e.classList.contains('is-done') ? i : -1)).filter(i => i >= 0),
        doneCols: colEls.map((e, i) => (e.classList.contains('is-done') ? i : -1)).filter(i => i >= 0),
        done, paused, secs: clk.secs, cur, mode, solved: { ...solvedMap }, count: PUZZLES.length,
      }),
      /* test hook — nothing in the game calls it: open(id) · prefill(n: fill every needed cell but n) */
      hook(cmd, arg) {
        if (cmd === 'open') open(arg, true);
        else if (cmd === 'prefill') {
          const need = [...P.rows.join('')].map((c, i) => (c === '#' && cells[i] !== 1 ? i : -1)).filter(i => i >= 0);
          for (const i of need.slice(0, Math.max(0, need.length - arg))) cells[i] = 1;
          paintAll();
        }
        return true;
      },
    };
  },
};
