/* ============================================================
   arcade/nonogram.js — Nonograms for Static Arcade.

   The numbers beside each row and above each column say how long
   the runs of filled cells in that line are, in order. Fill the
   cells that must be filled; the picture appears. 31 original
   pictures, 5×5 to 15×15 (nonogram.data.js). Every one is checked
   to have exactly one solution, solvable by line logic alone, so
   none ever needs a guess (see nonogramlogic.js and the tests).

   Make: draw your own picture (5×5, 10×10 or 15×15) with its clues
   worked out as you draw, then Check & share. A picture is only given
   a code once a search has proved its clues have exactly one solution
   (nonogramcode.js); with several, the editor says so and marks the
   squares that could go either way. A friend's code opens in the same
   place; a code that doesn't read says so, and a code whose picture
   has several solutions isn't played. Pictures from codes keep their
   own times and don't change the Arcade's best.

   Gallery: every picture you have finished, drawn as it came out,
   with its name and best time; tap one to play it again.

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
   your best time on each, your drawing in progress and the pictures
   you opened from codes are saved on this device
   (portal.arcadePuzzles.nonogram). The clock stops while paused and
   the picture is covered then.

   ONLINE RACE (ctx.online.kit, ./race.js): the room's seed picks one
   of the 10×10 pictures, the same on both screens, and the clock runs
   from the start. No Pictures, Gallery, Make or Restart in a race, and
   nothing is saved; the share of the picture filled goes to the
   friend's bar.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { PUZZLES } from './nonogram.data.js';
import { cluesOf, runsOf, sameRuns } from './nonogramlogic.js';
import { encodePicture, decodePicture, checkPicture, cleanName, SIZES, MAX_NAME } from './nonogramcode.js';
import { hash32 } from './challenge.js';

const GAME = 'nonogram';
const MADE_MAX = 40;
const byId = id => PUZZLES.find(p => p.id === id) || null;
const hueOf = p => (PUZZLES.includes(p) ? (PUZZLES.indexOf(p) * 47) % 360 : hash32(p.id) % 360);

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
.pz-ng__board.is-edit{border-style:dashed;border-color:color-mix(in srgb,var(--ga) 60%,transparent)}
.pz-ng__c{position:relative;box-shadow:inset 0 0 0 .5px var(--line-1,rgba(255,255,255,.12));display:grid;place-items:center}
.pz-ng__c.r5{box-shadow:inset 0 0 0 .5px var(--line-1,rgba(255,255,255,.12)),inset -2px 0 0 -1px var(--line-2,rgba(255,255,255,.4))}
.pz-ng__c.is-cur{box-shadow:inset 0 0 0 2px var(--ga)}
.pz-ng__c.is-f{background:var(--ga)}
.pz-ng__c.is-amb{box-shadow:inset 0 0 0 2px #ffd166}
.pz-ng__c.is-amb::after{content:"?";font:800 calc(var(--u) * .5)/1 var(--font,system-ui);color:#ffd166}
.pz-ng__c.is-x::before,.pz-ng__c.is-x::after{content:"";position:absolute;left:24%;right:24%;top:calc(50% - 1px);height:2px;background:var(--ink-3,#9a9aa8);transform:rotate(45deg);border-radius:2px}
.pz-ng__c.is-x::after{transform:rotate(-45deg)}
.pz-ng__board.is-solved .pz-ng__c.is-f{background:var(--pic,var(--ga))}
.pz-ng__board.is-solved .pz-ng__c.is-x{opacity:0}
.pz-ng__pick,.pz-ng__gal{position:absolute;inset:0;z-index:4;overflow:auto;padding:var(--sp-3,10px);background:rgba(12,9,18,.94);border-radius:8px;text-align:left}
.pz-ng__pick h4,.pz-ng__gal h4{margin:10px 0 6px;font:700 12px/1 var(--font,system-ui);color:var(--ink-3,#999);text-transform:uppercase;letter-spacing:.06em}
.pz-ng__pick h4:first-child,.pz-ng__gal h4:first-child{margin-top:0}
.pz-ng__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:6px}
.pz-ng__grid button,.pz-ng__tiles button{display:flex;flex-direction:column;gap:3px;align-items:flex-start;padding:8px 10px;border-radius:9px;border:1px solid var(--line-1,rgba(255,255,255,.1));background:var(--fill-1,rgba(255,255,255,.06));color:var(--ink-0,#fff);font:600 13px/1.1 var(--font,system-ui);cursor:pointer;text-align:left}
.pz-ng__grid button small,.pz-ng__tiles button small{font:500 11px/1.2 var(--font,system-ui);color:var(--ink-3,#999)}
.pz-ng__grid button.is-solved{border-color:color-mix(in srgb,var(--ga) 55%,transparent)}
.pz-ng__grid button.is-solved small{color:var(--ga)}
.pz-ng__grid button.is-cur{box-shadow:0 0 0 2px var(--ga)}
.pz-ng__grid button:focus-visible,.pz-ng__tiles button:focus-visible{outline:2px solid var(--ga)}
@media (hover:hover){.pz-ng__grid button:hover,.pz-ng__tiles button:hover{background:var(--fill-2,rgba(255,255,255,.12))}}
.pz-ng__tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
.pz-ng__tiles button{align-items:center;text-align:center}
.pz-ng__tiles canvas{width:72px;height:72px;image-rendering:pixelated;border-radius:4px;background:#100c18}
.pz-ng__empty{font-size:13px;color:var(--ink-2,#bbb);padding:6px 2px}
.pz-ng__title{font:700 14px/1 var(--font,system-ui);color:var(--ink-0,#fff);white-space:nowrap}
.pz-ng__title small{font-weight:500;color:var(--ink-3,#999);margin-left:6px}
.pz-ng__name{font:600 13px/1 var(--font,system-ui);color:var(--ink-0,#fff);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.12));border-radius:var(--r-md,11px);padding:7px 10px;width:13em;min-width:0}
.pz-ng__name:focus-visible{outline:2px solid var(--ga);outline-offset:1px}
.pz-ng__code{font:600 12px/1 var(--mono,ui-monospace,monospace);color:var(--ink-0,#fff);background:var(--fill-0,rgba(255,255,255,.03));border:1px solid var(--line-1,rgba(255,255,255,.12));border-radius:var(--r-md,11px);padding:7px 10px;width:min(26em,60vw);min-width:0}
.pz-ng__share[hidden]{display:none}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    let dead = false, paused = false;
    /* an online race: a 10×10 picture from the room's seed, nothing saved */
    const NET = ctx.online?.kit && Number.isInteger(ctx.online.seed) ? ctx.online : null;
    const RACE_PICS = PUZZLES.filter(p => p.rows.length === 10 && p.rows[0].length === 10);
    const sv = NET ? {} : load(GAME);
    const solvedMap = { ...(sv.solved || {}) };      /* id → best seconds */
    const prog = { ...(sv.prog || {}) };             /* id → { cells, secs } */
    /* pictures opened from codes (and your own, tried): id → { code, best?, at } */
    const made = Object.fromEntries(Object.entries(sv.made && typeof sv.made === 'object' ? sv.made : {}).filter(([, m]) => m && typeof m.code === 'string'));

    let P = null, clues = null, cells = [], W = 0, Hh = 0, done = false;
    let cur = 0, mode = 'fill', msg = '';
    /* the editor: null while playing, else { size, name } (the drawing is `cells`) */
    let E = null, amb = new Set(), checked = null;
    const undo = [];
    let nodes = [], rowEls = [], colEls = [], wrapEl = null;

    /* ---------- chrome ---------- */
    const title = h('div.pz-ng__title');
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const pickBtn = h('button.pz__btn', { type: 'button', title: 'Choose a picture' }, icon('grid-9'), h('span', { text: 'Pictures' }));
    const galBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'gallery' }, title: 'The pictures you have finished' }, icon('image'), h('span.pz__long', { text: 'Gallery' }));
    const makeBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'make' }, title: 'Draw your own picture and share it as a code, or open a friend’s code' }, icon('edit-3'), h('span.pz__long', { text: 'Make' }));
    const fillBtn = h('button', { type: 'button', 'aria-pressed': 'true', title: 'Taps and clicks fill' }, 'Fill');
    const crossBtn = h('button', { type: 'button', 'aria-pressed': 'false', title: 'Taps and clicks cross' }, 'Cross');
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Tap mode' }, fillBtn, crossBtn);
    const undoBtn = h('button.pz__btn', { type: 'button', title: 'Undo (Z)' }, icon('rotate-ccw'), h('span.pz__long', { text: 'Undo' }));
    const clearBtn = h('button.pz__btn', { type: 'button', title: 'Clear the grid and start this picture again' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', pickBtn, galBtn, makeBtn, title, timeRead, seg, undoBtn, clearBtn);
    if (NET) for (const b of [pickBtn, galBtn, makeBtn, clearBtn]) b.hidden = true;
    /* the editor's bars */
    const sizeBtns = SIZES.map(n => h('button', { type: 'button', dataset: { size: n }, 'aria-pressed': 'false', title: `${n} by ${n} squares` }, `${n}×${n}`));
    const sizeSeg = h('div.pz__seg', { role: 'group', 'aria-label': 'Picture size' }, sizeBtns);
    const nameIn = h('input.pz-ng__name', { type: 'text', maxlength: String(MAX_NAME), placeholder: 'Name your picture', 'aria-label': 'Picture name', spellcheck: 'false', autocomplete: 'off' });
    const checkBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'check' }, title: 'Check the clues have one solution, then get a code to share' }, icon('check'), h('span', { text: 'Check & share' }));
    const tryBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'try' }, title: 'Play your picture from its clues' }, icon('play'), h('span.pz__long', { text: 'Try it' }));
    const wipeBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'wipe' }, title: 'Clear the drawing' }, icon('trash'), h('span.pz__long', { text: 'Clear' }));
    const backBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'back' }, title: 'Back to the pictures' }, icon('chevron-left'), h('span', { text: 'Done' }));
    const editTop = h('div.pz__top', { hidden: true }, backBtn, sizeSeg, nameIn, checkBtn, tryBtn, wipeBtn);
    const codeIn = h('input.pz-ng__code', { type: 'text', placeholder: 'Paste a friend’s code (NONO-…)', 'aria-label': 'A picture code', spellcheck: 'false', autocomplete: 'off' });
    const openBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'open-code' }, title: 'Play the picture in this code' }, h('span', { text: 'Open code' }));
    const codeOut = h('input.pz-ng__code', { type: 'text', readonly: true, 'aria-label': 'Your picture’s code' });
    const copyBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'copy' }, title: 'Copy the code' }, icon('copy'), h('span', { text: 'Copy' }));
    const shareRow = h('div.pz__bar.pz-ng__share', { hidden: true }, h('small.pz__note', { text: 'Your code:' }), codeOut, copyBtn);
    const editBar = h('div.pz__bar', { hidden: true }, codeIn, openBtn);
    const stage = h('div.pz__stage.pz-ng__stage');
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, editTop, stage, shareRow, editBar, foot, live);
    el.appendChild(root);

    const clk = clock(s => { timeV.textContent = fmtTime(s); });
    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg
      ? h('span', { text: msg })
      : h('span.pz__hint', { html: E ? 'click / drag to draw · right-click erases · the clues follow your drawing' : 'click / drag fill · right-click cross · or <kbd>Space</kbd> fill · <kbd>X</kbd> cross · <kbd>Z</kbd> undo · arrows move' }));

    /* ---------- the puzzle ---------- */
    const idx = (x, y) => y * W + x;
    const lineOf = (kind, k) => (kind === 'r'
      ? Array.from({ length: W }, (_, x) => (cells[idx(x, k)] === 1 ? 1 : 0))
      : Array.from({ length: Hh }, (_, y) => (cells[idx(k, y)] === 1 ? 1 : 0)));
    const rowOk = y => sameRuns(runsOf(lineOf('r', y)), clues.rows[y]);
    const colOk = x => sameRuns(runsOf(lineOf('c', x)), clues.cols[x]);
    const complete = () => { for (let y = 0; y < Hh; y++) if (!rowOk(y)) return false; for (let x = 0; x < W; x++) if (!colOk(x)) return false; return true; };
    const drawing = () => Array.from({ length: Hh }, (_, y) => Array.from({ length: W }, (_, x) => (cells[idx(x, y)] === 1 ? '#' : '.')).join(''));
    const numOf = p => PUZZLES.indexOf(p) + 1;

    function build() {
      stage.replaceChildren();
      const cw = Math.max(...clues.rows.map(r => r.length)), ch = Math.max(...clues.cols.map(c => c.length));
      const wrap = h('div.pz-ng__wrap', { style: { '--w': W, '--h': Hh, '--cw': cw, '--ch': ch } });
      wrapEl = wrap;
      const colBox = h('div.pz-ng__cols', { style: { gridColumn: '2', gridRow: '1' } });
      const rowBox = h('div.pz-ng__rows', { style: { gridColumn: '1', gridRow: '2' } });
      colEls = clues.cols.map(c => { const d = h('div.pz-ng__cc', c.map(n => h('span', { text: String(n) }))); colBox.appendChild(d); return d; });
      rowEls = clues.rows.map(r => { const d = h('div.pz-ng__rc', r.map(n => h('span', { text: String(n) }))); rowBox.appendChild(d); return d; });
      const board = h('div.pz-ng__board' + (E ? '.is-edit' : ''), { role: 'grid', tabindex: '0', 'aria-label': E ? `${W} by ${Hh} drawing` : `${W} by ${Hh} nonogram`, style: { gridColumn: '2', gridRow: '2', '--pic': E ? 'var(--ga)' : `hsl(${hueOf(P)},75%,58%)` } });
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
    /* the editor's clues follow the drawing */
    function relabel() {
      clues = cluesOf(drawing());
      wrapEl.style.setProperty('--cw', Math.max(...clues.rows.map(r => r.length)));
      wrapEl.style.setProperty('--ch', Math.max(...clues.cols.map(c => c.length)));
      const fill = (els, list) => els.forEach((d, k) => { const t = list[k].join(' '); if (d.dataset.t !== t) { d.dataset.t = t; d.replaceChildren(...list[k].map(n => h('span', { text: String(n) }))); } });
      fill(rowEls, clues.rows); fill(colEls, clues.cols);
    }

    function paintAll() {
      if (E) relabel();
      cells.forEach((v, i) => {
        const c = nodes[i];
        c.className = 'pz-ng__c' + (((i % W) % 5 === 4 && (i % W) < W - 1) ? ' r5' : '') + (v === 1 ? ' is-f' : v === 2 ? ' is-x' : '') + (i === cur && !done ? ' is-cur' : '') + (amb.has(i) ? ' is-amb' : '');
        c.setAttribute('aria-label', `Row ${Math.floor(i / W) + 1}, column ${(i % W) + 1}, ${v === 1 ? 'filled' : v === 2 ? 'crossed' : 'empty'}${amb.has(i) ? ', could go either way' : ''}`);
      });
      if (!E) {
        for (let y = 0; y < Hh; y++) { rowEls[y].classList.toggle('is-done', rowOk(y)); rowEls[y].classList.toggle('is-cur', !done && Math.floor(cur / W) === y); }
        for (let x = 0; x < W; x++) { colEls[x].classList.toggle('is-done', colOk(x)); colEls[x].classList.toggle('is-cur', !done && cur % W === x); }
        title.replaceChildren(done ? `${P.name}` : P.custom ? 'A picture from a code' : `Picture ${numOf(P)}`, h('small', { text: `${W}×${Hh}` }));
      }
      seg.children[0].setAttribute('aria-pressed', String(mode === 'fill'));
      seg.children[1].setAttribute('aria-pressed', String(mode === 'cross'));
      sizeBtns.forEach(b => b.setAttribute('aria-pressed', String(!!E && Number(b.dataset.size) === E.size)));
      undoBtn.disabled = !undo.length || done;
      top.hidden = !!E; editTop.hidden = !E; editBar.hidden = !E;
      if (!E) shareRow.hidden = true;
      paintFoot();
    }

    /* a picture to play: a bundled one, or one from a code ({ id, name, rows, code, custom }) */
    const fromMade = id => {
      const m = made[id];
      if (!m) return null;
      const d = decodePicture(m.code);
      return d.ok ? { id, name: d.name || 'A friend’s picture', rows: d.rows, code: d.code, custom: true } : null;
    };
    const findPic = id => byId(id) || fromMade(id);
    function open(id, fresh = false, pic = null) {
      E = null; amb = new Set(); checked = null;
      const p = pic || findPic(id) || PUZZLES[0];
      P = p; clues = cluesOf(p.rows); W = clues.w; Hh = clues.h;
      const s = !fresh && prog[p.id];
      cells = s && typeof s.cells === 'string' && s.cells.length === W * Hh ? [...s.cells].map(Number) : new Array(W * Hh).fill(0);
      done = false; undo.length = 0; cur = 0; msg = '';
      paused = false; clk.stop(); clk.secs = s ? s.secs || 0 : 0; timeV.textContent = fmtTime(clk.secs);
      /* a race's clock runs from the start, the same moment on both screens */
      if ((s && cells.some(Boolean)) || NET) clk.start();
      build(); paintAll();
      if (!NET) save(GAME, { cur: p.id });
      if (s && cells.some(Boolean)) say('Welcome back: your picture is where you left it.');
    }
    function persist() {
      if (NET) return;
      if (E) { save(GAME, { draft: { size: E.size, name: E.name, cells: cells.map(v => (v === 1 ? 1 : 0)).join('') } }); return; }
      if (!P || done) return;
      if (cells.some(Boolean)) prog[P.id] = { cells: cells.join(''), secs: Math.round(clk.secs) }; else delete prog[P.id];
      save(GAME, { prog, cur: P.id });
    }

    /* ---------- marking ---------- */
    const snap = () => { undo.push(cells.slice()); if (undo.length > 200) undo.shift(); };
    /* the race's progress: squares filled against the picture's count (right or not — the
       bar on your own screen must not work as a check), never all of it until it's solved */
    function progress() {
      if (!NET || !P || E) return;
      const need = [...P.rows.join('')].filter(c => c === '#').length;
      const filled = cells.filter(v => v === 1).length;
      NET.progress(done ? 1 : Math.min(0.99, filled / Math.max(1, need)));
    }
    function changed() {
      if (E) { amb = new Set(); checked = null; shareRow.hidden = true; }
      paintAll();
      progress();
      if (!E && !done && complete()) win();
    }
    function start() { if (!E && !clk.running && !done && !paused) clk.start(); }
    function win() {
      done = true; clk.stop();
      const secs = Math.max(1, Math.round(clk.secs));
      if (NET) {
        cells = cells.map(v => (v === 1 ? 1 : 0));
        stage.board.classList.add('is-solved');
        paintAll();
        say(`${P.name}! Solved in ${fmtTime(secs)}.`);
        NET.progress(1);
        onScore(secs);
        onEnd({ score: secs, won: true, detail: `Race · ${P.name} · ${W}×${Hh}`, race: { done: true, ms: Math.round(clk.secs * 1000), p: 1 } });
        return;
      }
      const custom = !!P.custom;
      const prev = custom ? made[P.id]?.best : solvedMap[P.id];
      const fresh = prev == null || secs < prev;
      if (custom) { if (fresh && made[P.id]) made[P.id] = { ...made[P.id], best: secs }; }
      else if (fresh) solvedMap[P.id] = secs;
      delete prog[P.id];
      save(GAME, { solved: solvedMap, prog, made, cur: P.id });
      cells = cells.map(v => (v === 1 ? 1 : 0));
      stage.board.classList.add('is-solved');
      paintAll();
      say(`${P.name}! Solved in ${fmtTime(secs)}${fresh && prev != null ? ', a new best for this picture' : ''}.`);
      onScore(secs);
      onEnd({ score: secs, won: true, detail: `${P.name} · ${W}×${Hh}${custom ? ' · from a code' : ''}`, ...(custom ? { assisted: 'A picture from a code doesn’t change your best' } : {}) });
    }
    const canEdit = () => (E ? !paused && !dead : !done && !paused && !dead);
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
        /* drawing: a click fills or empties; right-click empties */
        const want = E ? (e.button === 2 ? 0 : 1) : e.button === 2 || mode === 'cross' ? 2 : 1;
        const v = E ? (e.button === 2 ? 0 : cells[i] === 1 ? 0 : 1) : cells[i] === want ? 0 : want;
        snap(); start();
        cur = i;
        stroke = { id: e.pointerId, v, from: i, axis: null, last: i };
        try { board.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
        paintCell(i, v);
        if (E) changed(); else paintAll();
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
        if (E) changed(); else paintAll();
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
      if (E) cells[cur] = v === 2 ? 0 : cells[cur] === 1 ? 0 : 1;
      else paintCell(cur, cells[cur] === v ? 0 : v);
      persist(); changed();
    }
    function doUndo() {
      if (!undo.length || !canEdit()) return;
      cells = undo.pop();
      persist();
      if (E) changed(); else paintAll();
    }

    /* ---------- the editor ---------- */
    function edit(size = null) {
      if (!E && P && !done) persist();
      clk.stop();
      const d = load(GAME).draft;
      const n = SIZES.includes(size) ? size : SIZES.includes(d?.size) ? d.size : 10;
      const keep = d && d.size === n && typeof d.cells === 'string' && d.cells.length === n * n;
      E = { size: n, name: cleanName(E?.name ?? d?.name ?? '') };
      W = Hh = n;
      cells = keep ? [...d.cells].map(c => (c === '1' ? 1 : 0)) : new Array(n * n).fill(0);
      done = false; undo.length = 0; cur = 0; amb = new Set(); checked = null; paused = false;
      clues = cluesOf(drawing());
      nameIn.value = E.name;
      shareRow.hidden = true;
      build(); paintAll();
      persist();
      say(keep && cells.some(Boolean) ? 'Your drawing is where you left it.' : `Draw a ${n}×${n} picture: the clues follow as you draw. Check & share makes a code once the clues have only one answer.`);
    }
    function runCheck() {
      const c = checkPicture(drawing());
      checked = c;
      amb = new Set(c.differ);
      paintAll();
      return c;
    }
    function share() {
      if (!E) return;
      const c = runCheck();
      if (!c.ok) { shareRow.hidden = true; say(c.why); return; }
      codeOut.value = encodePicture({ rows: drawing(), name: E.name });
      shareRow.hidden = false;
      say(`${c.why} Here is its code to share.`);
      codeOut.focus({ preventScroll: true }); codeOut.select();
    }
    /* play a picture from a code, or your own drawing */
    function playPicture(rows, name, code) {
      const id = `code-${hash32(code).toString(36)}`;
      made[id] = { ...(made[id] || {}), code, at: Date.now() };
      const ids = Object.keys(made).sort((a, b) => (made[b].best != null) - (made[a].best != null) || made[b].at - made[a].at);
      for (const k of ids.slice(MADE_MAX)) delete made[k];
      save(GAME, { made });
      open(id, false, { id, name: name || 'A friend’s picture', rows, code, custom: true });
    }
    function tryIt() {
      if (!E) return;
      const c = runCheck();
      if (!c.ok) { say(c.why); return; }
      persist();
      playPicture(drawing(), E.name || 'Your picture', encodePicture({ rows: drawing(), name: E.name || 'Your picture' }));
      say(`Your picture, from its clues alone. ${c.lineLogic ? '' : 'It needs some trial and error.'}`.trim());
    }
    function openCode() {
      const d = decodePicture(codeIn.value);
      if (!d.ok) { say(d.error); codeIn.focus({ preventScroll: true }); return; }
      const c = checkPicture(d.rows);
      if (!c.ok) { say(c.unique === false ? 'That code reads, but its picture has more than one solution, so it can’t be played fairly.' : `That code reads, but it can’t be played: ${c.why}`); return; }
      if (E) persist();
      codeIn.value = '';
      playPicture(d.rows, d.name, d.code);
      say(`A ${d.w}×${d.h} picture from a code. ${c.lineLogic ? 'Line logic alone solves it.' : 'It needs some trial and error.'} Its name shows once it’s solved.`);
    }

    /* ---------- picker ---------- */
    function closeOverlays() { stage.querySelector('.pz-ng__pick')?.remove(); stage.querySelector('.pz-ng__gal')?.remove(); }
    function showPicker() {
      if (stage.querySelector('.pz-ng__pick')) { stage.querySelector('.pz-ng__pick').remove(); return; }
      closeOverlays();
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
    /* ---------- gallery: the finished pictures, drawn ---------- */
    function thumb(rows, hue) {
      const n = rows.length, s = 6;
      const cv = h('canvas', { width: n * s, height: n * s, 'aria-hidden': 'true' });
      const g = cv.getContext('2d');
      if (g) {
        g.fillStyle = `hsl(${hue},75%,58%)`;
        rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') g.fillRect(x * s, y * s, s, s); }));
      }
      return cv;
    }
    function showGallery() {
      if (stage.querySelector('.pz-ng__gal')) { stage.querySelector('.pz-ng__gal').remove(); return; }
      closeOverlays();
      const mine = PUZZLES.filter(p => solvedMap[p.id] != null);
      const codes = Object.keys(made).map(fromMade).filter(p => p && made[p.id].best != null);
      const tile = (p, best) => h('button', { type: 'button', dataset: { id: p.id }, title: `Play ${p.name} again`, onclick: () => { persist(); open(p.id, true, p.custom ? p : null); } },
        thumb(p.rows, hueOf(p)), h('span', { text: p.name }), h('small', { text: `${p.rows.length}×${p.rows.length} · ${fmtTime(best)}` }));
      const gal = h('div.pz-ng__gal', { role: 'dialog', 'aria-label': 'Gallery of finished pictures' },
        h('h4', { text: `Finished · ${mine.length} of ${PUZZLES.length}` }),
        mine.length ? h('div.pz-ng__tiles', mine.map(p => tile(p, solvedMap[p.id]))) : h('p.pz-ng__empty', { text: 'Finish a picture and it appears here, drawn as it came out.' }),
        codes.length ? [h('h4', { text: `From codes · ${codes.length}` }), h('div.pz-ng__tiles', codes.map(p => tile(p, made[p.id].best)))] : null);
      stage.appendChild(gal);
      gal.querySelector('button')?.focus({ preventScroll: true });
    }

    /* ---------- wiring ---------- */
    L.on(pickBtn, 'click', showPicker);
    L.on(galBtn, 'click', showGallery);
    L.on(makeBtn, 'click', () => { if (!NET) edit(); });
    L.on(fillBtn, 'click', () => { mode = 'fill'; paintAll(); });
    L.on(crossBtn, 'click', () => { mode = 'cross'; paintAll(); });
    L.on(undoBtn, 'click', doUndo);
    L.on(clearBtn, 'click', () => { if (!dead && !NET) { persist(); delete prog[P.id]; save(GAME, { prog }); open(P.id, true, P.custom ? P : null); } });
    L.on(sizeSeg, 'click', e => { const b = e.target.closest?.('button[data-size]'); if (b && E && Number(b.dataset.size) !== E.size) { persist(); edit(Number(b.dataset.size)); } });
    L.on(nameIn, 'input', () => { if (!E) return; E.name = cleanName(nameIn.value); shareRow.hidden = true; persist(); });
    L.on(checkBtn, 'click', share);
    L.on(tryBtn, 'click', tryIt);
    L.on(wipeBtn, 'click', () => { if (!E || !cells.some(Boolean)) return; snap(); cells.fill(0); persist(); changed(); say('Cleared. Undo brings the drawing back.'); });
    L.on(backBtn, 'click', () => { if (!E) return; persist(); open(P && !P.custom ? P.id : sv.cur || PUZZLES[0].id, false, P && P.custom ? P : null); });
    L.on(openBtn, 'click', openCode);
    L.on(codeIn, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); openCode(); } });
    L.on(copyBtn, 'click', async () => {
      codeOut.select();
      let okc = false;
      try { await navigator.clipboard.writeText(codeOut.value); okc = true; } catch (err) { /* the field is there to copy from */ }
      say(okc ? 'Code copied. A friend opens it with Make → Open code.' : 'Select the code and copy it.');
    });
    const MOVE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    L.on(window, 'keydown', e => {
      if (dead || paused || !P || !ownsKey(root, e)) return;
      if (e.target && e.target.closest?.('input')) return;               /* typing a name or a code */
      if ((stage.querySelector('.pz-ng__pick') || stage.querySelector('.pz-ng__gal')) && !(e.key === 'Escape')) return;
      const k = e.key;
      if (MOVE[k]) {
        e.preventDefault();
        const x = Math.max(0, Math.min(W - 1, (cur % W) + MOVE[k][0])), y = Math.max(0, Math.min(Hh - 1, Math.floor(cur / W) + MOVE[k][1]));
        cur = idx(x, y); paintAll();
        /* Shift held: paint along as you go */
        if (e.shiftKey && canEdit()) { start(); paintCell(cur, E ? 1 : mode === 'cross' ? 2 : 1); persist(); changed(); }
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
      if (!c && fromMade(sv.cur) && prog[sv.cur]) return sv.cur;
      if (c && (prog[c.id] || solvedMap[c.id] == null)) return c.id;
      const from = c ? PUZZLES.indexOf(c) : -1;
      for (let k = 1; k <= PUZZLES.length; k++) {
        const p = PUZZLES[(from + k) % PUZZLES.length];
        if (solvedMap[p.id] == null) return p.id;
      }
      return PUZZLES[0].id;
    })();
    if (NET) {
      const pic = RACE_PICS[(NET.seed >>> 0) % RACE_PICS.length];
      open(pic.id, true);
      say(`Race: the same ${W}×${Hh} picture as ${NET.peer?.name || 'your friend'}. The faster finish wins.`);
      progress();
    } else open(startId);
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
        if (!E && !done && cells.some(Boolean)) clk.start();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => P && ({
        id: E ? null : P.id, name: P.name, w: W, h: Hh, cells: cells.join(''), solution: E ? drawing().join('') : P.rows.join(''), clues: { rows: clues.rows, cols: clues.cols },
        doneRows: rowEls.map((e, i) => (e.classList.contains('is-done') ? i : -1)).filter(i => i >= 0),
        doneCols: colEls.map((e, i) => (e.classList.contains('is-done') ? i : -1)).filter(i => i >= 0),
        done, paused, secs: clk.secs, cur, mode, solved: { ...solvedMap }, count: PUZZLES.length,
        editing: !!E, size: E?.size ?? null, editName: E?.name ?? null, custom: !!P.custom, code: shareRow.hidden ? null : codeOut.value,
        checked: checked && { ok: checked.ok, unique: checked.unique, lineLogic: checked.lineLogic }, amb: [...amb], msg,
        made: Object.fromEntries(Object.entries(made).map(([k, m]) => [k, { best: m.best ?? null }])),
        race: NET ? { seed: NET.seed >>> 0, id: P.id } : null,
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
