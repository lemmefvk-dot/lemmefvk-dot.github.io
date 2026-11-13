/* ============================================================
   arcade/sudoku.js — Sudoku for Static Arcade.

   Easy, Medium and Hard. Every puzzle is dealt by sudokulogic.js,
   which only keeps a puzzle that an exhaustive search proves has
   exactly one solution, and grades it by the techniques a person
   needs (Easy: singles only; Medium: pairs or locked candidates;
   Hard: triples, X-Wing, XY-Wing or Swordfish). The number of
   givens is shown too, but the grade is the techniques, and the
   card says so.

   Controls
     mouse / touch  tap a cell, then a number on the pad (or Erase)
     keyboard       arrows move · 1–9 enter · Backspace / Delete / 0
                    erase · N pencil notes · H hint · Z undo
   Pencil notes: in notes mode a number toggles a small note. Notes
   that a placed number rules out are removed from its row, column
   and box (switch off with "Clean notes"). "Show mistakes" marks
   entries that don't match the solution. A hint fills one cell and
   is counted; a puzzle solved with hints finishes but sets no best
   time. Undo steps back through entries, notes and erases.

   Score = seconds from the deal to the last cell, lower is better.
   The best time per difficulty is kept on this device
   (portal.arcadePuzzles.sudoku); an unfinished puzzle is saved and
   picked up again after a reload. The clock stops while paused, and
   the board is covered then, so a pause can't be used to think.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, rng, randomSeed } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { generate, findSingle, NAMES, LEVELS, TIER, PEERS, row, col, box } from './sudokulogic.js';

const GAME = 'sudoku';
const LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const WHY = { naked: 'it is the only number that fits there', row: 'it is the only place for that number in its row', col: 'it is the only place for that number in its column', box: 'it is the only place for that number in its box' };

const CSS = `${BASE}
.pz-sd__board{--g:1px;position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(9,1fr);grid-template-rows:repeat(9,1fr);gap:var(--g);
  background:var(--line-2,rgba(255,255,255,.28));border:2px solid var(--line-2,rgba(255,255,255,.28));border-radius:8px;container-type:inline-size;outline:none;touch-action:manipulation;overflow:hidden}
.pz-sd__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-sd__c{position:relative;display:grid;place-items:center;min-width:0;min-height:0;background:var(--bg-sd,#171320);font:600 calc(100cqw / 9 * .56)/1 var(--font,system-ui);color:#9ec5ff;cursor:pointer;font-variant-numeric:tabular-nums}
.pz-sd__c.is-given{color:var(--ink-0,#fff);font-weight:800}
.pz-sd__c.bR{margin-right:2px}.pz-sd__c.bB{margin-bottom:2px}
.pz-sd__c.is-peer{background:color-mix(in srgb,var(--ga) 9%,var(--bg-sd,#171320))}
.pz-sd__c.is-same{background:color-mix(in srgb,var(--ga) 24%,var(--bg-sd,#171320))}
.pz-sd__c.is-sel{background:color-mix(in srgb,var(--ga) 42%,var(--bg-sd,#171320));box-shadow:inset 0 0 0 2px var(--ga)}
.pz-sd__c.is-wrong{color:#ff6b6b;background:color-mix(in srgb,#dc2626 28%,var(--bg-sd,#171320))}
.pz-sd__c.is-wrong::after{content:"";position:absolute;right:6%;top:6%;width:14%;height:14%;border-radius:50%;background:#ff6b6b}
.pz-sd__c.is-hint{box-shadow:inset 0 0 0 2px #ffd166}
.pz-sd__n{position:absolute;inset:2px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);font:600 calc(100cqw / 9 * .22)/1 var(--font,system-ui);color:var(--ink-2,#aab);text-align:center;place-items:center}
.pz-sd__n b{font-weight:600}
.pz-sd__pad{width:min(100%,560px);display:grid;grid-template-columns:repeat(9,1fr);gap:5px;flex:0 0 auto}
.pz-sd__pad button{position:relative;padding:8px 0 10px;font:700 clamp(15px,4.2cqw,22px)/1 var(--font,system-ui);color:var(--ink-0,#fff);background:var(--fill-1,rgba(255,255,255,.07));border:1px solid var(--line-1,rgba(255,255,255,.1));border-radius:9px;cursor:pointer}
.pz-sd__pad button small{position:absolute;right:4px;bottom:2px;font:600 9px/1 var(--font,system-ui);color:var(--ink-3,#999)}
.pz-sd__pad button:disabled{opacity:.3;cursor:default}
.pz-sd__pad button:focus-visible{outline:2px solid var(--ga);outline-offset:1px}
@media (hover:hover){.pz-sd__pad button:not(:disabled):hover{background:var(--fill-2,rgba(255,255,255,.13))}}
.pz-sd__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);border-radius:8px;text-align:center;padding:16px}
.pz-sd__card div{max-width:34ch}
.pz-sd__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-sd__card span{font-size:13px;color:var(--ink-2,#bbb);line-height:1.5}
.pz.is-reduced .pz-sd__c{transition:none}
.pz:not(.is-reduced) .pz-sd__c{transition:background .12s}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    let dead = false, paused = false;
    const saved = load(GAME);
    const bests = { ...(saved.best || {}) };
    const prefs = { level: LEVELS.includes(saved.level) ? saved.level : 'easy', show: !!saved.show, clean: saved.clean !== false };
    /* G: the game on the board */
    let G = null;
    let sel = -1, notesMode = false, hintCell = -1, msg = '';
    const undo = [];

    /* ---------- chrome ---------- */
    const levelBtns = LEVELS.map(k => h('button', { type: 'button', dataset: { level: k }, 'aria-pressed': 'false' }, LABEL[k]));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Difficulty' }, levelBtns);
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const bestV = h('small', { text: '' });
    const newBtn = h('button.pz__btn', { type: 'button', title: 'Deal a new puzzle', 'aria-label': 'New puzzle' }, icon('refresh'), h('span.pz__long', { text: 'New' }));
    const top = h('div.pz__top', seg, timeRead, bestV, newBtn);
    const board = h('div.pz-sd__board', { role: 'grid', tabindex: '0', 'aria-label': 'Sudoku board' });
    const cells = Array.from({ length: 81 }, (_, i) => {
      const c = h('div.pz-sd__c' + (col(i) % 3 === 2 && col(i) < 8 ? '.bR' : '') + (row(i) % 3 === 2 && row(i) < 8 ? '.bB' : ''), { role: 'gridcell', dataset: { i } });
      board.appendChild(c);
      return c;
    });
    const stage = h('div.pz__stage', board);
    const padBtns = Array.from({ length: 9 }, (_, k) => h('button', { type: 'button', dataset: { digit: k + 1 }, 'aria-label': `Enter ${k + 1}` }, String(k + 1), h('small', { text: '9' })));
    const pad = h('div.pz-sd__pad', padBtns);
    const eraseBtn = h('button.pz__btn', { type: 'button', title: 'Erase the cell (Backspace)' }, h('span', { text: 'Erase' }));
    const undoBtn = h('button.pz__btn', { type: 'button', title: 'Undo (Z)' }, icon('rotate-ccw'), h('span', { text: 'Undo' }));
    const notesBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Pencil notes (N)' }, h('span', { text: 'Notes' }));
    const hintBtn = h('button.pz__btn', { type: 'button', title: 'Fill one cell (H). Counted, and a puzzle solved with hints sets no best time.' }, icon('sparkles'), h('span', { text: 'Hint' }), h('small', { text: '0' }));
    const fillBtn = h('button.pz__btn', { type: 'button', title: 'Pencil in every candidate that still fits' }, h('span', { text: 'Fill notes' }));
    const mistakeBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Mark entries that are wrong' }, icon('eye'), h('span.pz__long', { text: 'Show mistakes' }));
    const cleanBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Remove a placed number from the notes in its row, column and box' }, h('span', { text: 'Clean notes' }));
    const bar = h('div.pz__bar', undoBtn, eraseBtn, notesBtn, hintBtn, fillBtn, mistakeBtn, cleanBtn);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, stage, pad, bar, foot, live);
    el.appendChild(root);

    const say = m => { live.textContent = ''; live.textContent = m; msg = m; paintFoot(); };
    const clk = clock(s => { timeV.textContent = fmtTime(s); });
    const paintFoot = () => {
      foot.replaceChildren(msg
        ? h('span', { text: msg })
        : h('span.pz__hint', { html: '<kbd>1</kbd>–<kbd>9</kbd> enter · <kbd>N</kbd> notes · <kbd>H</kbd> hint · <kbd>Z</kbd> undo · arrows move' }));
    };

    /* ---------- state helpers ---------- */
    const vals = () => G.vals;
    const solved = () => G.vals.every((v, i) => v === G.sol[i]);
    const snapshot = () => ({ v: G.vals.slice(), n: G.notes.slice() });
    const pushUndo = () => { undo.push(snapshot()); if (undo.length > 300) undo.shift(); };
    const persist = () => {
      if (!G || G.done) return;
      save(GAME, { game: { seed: G.seed, level: G.level, tier: G.tier, puz: G.puz.join(''), sol: G.sol.join(''), vals: G.vals.join(''), notes: G.notes.slice(), secs: Math.round(clk.secs), hints: G.hints } });
    };
    const persistPrefs = () => save(GAME, { level: prefs.level, show: prefs.show, clean: prefs.clean });

    function adopt(d) {
      G = {
        seed: d.seed, level: d.level, tier: d.tier, hints: d.hints || 0, done: false,
        puz: d.puz, sol: d.sol, givens: d.puz.filter(Boolean).length,
        vals: d.vals || d.puz.slice(), notes: d.notes || new Array(81).fill(0),
        used: d.used || {},
      };
      undo.length = 0; sel = -1; hintCell = -1; notesMode = false; msg = '';
      prefs.level = d.level;
      clk.secs = d.secs || 0;
      paused = false;
      stage.querySelector('.pz__cover')?.remove();
      stage.querySelector('.pz-sd__card')?.remove();
      clk.start();
      render();
      persistPrefs();
      persist();
    }
    const parse = s => [...s].map(Number);
    function deal(level, seed = randomSeed()) {
      const r = generate(seed, level, rng(seed ^ (TIER[level] * 0x9e3779b1)));
      adopt({ seed, level, tier: r.tier, puz: r.puzzle, sol: r.solution, used: r.used });
      const honest = r.tier === TIER[level] ? '' : ` (the closest to ${LABEL[level]} this deal could find)`;
      say(`${NAMES[r.tier] || LABEL[level]} puzzle, ${G.givens} givens${honest}.`);
    }

    /* ---------- render ---------- */
    function counts() {
      const c = new Array(10).fill(0);
      G.vals.forEach((v, i) => { if (v && v === G.sol[i]) c[v]++; });
      return c;
    }
    function render() {
      if (!G) return;
      const sv = sel >= 0 ? G.vals[sel] : 0;
      cells.forEach((c, i) => {
        const v = G.vals[i], given = !!G.puz[i];
        const wrong = prefs.show && v && !given && v !== G.sol[i];
        const peer = sel >= 0 && i !== sel && (row(i) === row(sel) || col(i) === col(sel) || box(i) === box(sel));
        c.className = 'pz-sd__c' + (col(i) % 3 === 2 && col(i) < 8 ? ' bR' : '') + (row(i) % 3 === 2 && row(i) < 8 ? ' bB' : '')
          + (given ? ' is-given' : '') + (i === sel ? ' is-sel' : peer ? ' is-peer' : '')
          + (sv && v === sv && i !== sel ? ' is-same' : '') + (wrong ? ' is-wrong' : '') + (i === hintCell ? ' is-hint' : '');
        const m = G.notes[i];
        if (v) { if (c.dataset.k !== 'v' + v) { c.replaceChildren(String(v)); c.dataset.k = 'v' + v; } }
        else if (m) {
          if (c.dataset.k !== 'n' + m) {
            c.replaceChildren(h('div.pz-sd__n', Array.from({ length: 9 }, (_, d) => h('b', { text: m & (1 << d) ? String(d + 1) : '' }))));
            c.dataset.k = 'n' + m;
          }
        } else if (c.dataset.k) { c.replaceChildren(); c.dataset.k = ''; }
        c.setAttribute('aria-label', `Row ${row(i) + 1}, column ${col(i) + 1}, ${v ? v + (given ? ', given' : '') : m ? 'notes' : 'empty'}${wrong ? ', wrong' : ''}`);
        if (i === sel) c.setAttribute('aria-selected', 'true'); else c.removeAttribute('aria-selected');
      });
      const left = counts();
      padBtns.forEach((b, k) => { const r = 9 - left[k + 1]; b.lastChild.textContent = String(Math.max(0, r)); b.disabled = r <= 0 || G.done; });
      levelBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === G.level)));
      notesBtn.setAttribute('aria-pressed', String(notesMode));
      mistakeBtn.setAttribute('aria-pressed', String(prefs.show));
      cleanBtn.setAttribute('aria-pressed', String(prefs.clean));
      hintBtn.lastChild.textContent = String(G.hints);
      undoBtn.disabled = !undo.length || G.done;
      bestV.textContent = bests[G.level] != null ? `Best ${LABEL[G.level]}: ${fmtTime(bests[G.level])}` : `No ${LABEL[G.level]} time yet`;
      paintFoot();
    }

    /* ---------- moves ---------- */
    const editable = i => i >= 0 && !G.done && !paused && !G.puz[i];
    function setValue(i, d) {
      if (!editable(i)) return;
      pushUndo();
      G.vals[i] = G.vals[i] === d ? 0 : d;
      G.notes[i] = 0;
      if (G.vals[i] && prefs.clean) for (const p of PEERS[i]) G.notes[p] &= ~(1 << (d - 1));
      hintCell = -1; msg = '';
      afterChange();
    }
    function toggleNote(i, d) {
      if (!editable(i) || G.vals[i]) return;
      pushUndo();
      G.notes[i] ^= 1 << (d - 1);
      hintCell = -1; msg = '';
      afterChange();
    }
    function erase(i) {
      if (!editable(i) || (!G.vals[i] && !G.notes[i])) return;
      pushUndo();
      G.vals[i] = 0; G.notes[i] = 0; hintCell = -1; msg = '';
      afterChange();
    }
    function enter(d) {
      if (sel < 0) { sel = G.vals.findIndex((v, i) => !G.puz[i] && !v); if (sel < 0) return; }
      if (notesMode) toggleNote(sel, d); else setValue(sel, d);
    }
    function afterChange() {
      render();
      persist();
      if (G.vals.every(Boolean)) {
        if (solved()) win();
        else say(prefs.show ? 'The board is full, but the red cells are wrong.' : 'The board is full, but something is not right. Try "Show mistakes".');
      }
    }
    function doUndo() {
      if (!undo.length || G.done || paused) return;
      const s = undo.pop();
      G.vals = s.v; G.notes = s.n; hintCell = -1; msg = '';
      render(); persist();
    }
    function hint() {
      if (G.done || paused) return;
      const good = G.vals.map((v, i) => (v && v === G.sol[i] ? v : 0));
      let i, d, why = '';
      const bad = i2 => !G.puz[i2] && G.vals[i2] !== G.sol[i2];
      if (sel >= 0 && bad(sel)) {
        i = sel; d = G.sol[i];
        const s = findSingle(good, i);
        if (s && s.i === i && s.d === d) why = `: ${WHY[s.why]}`;
      } else {
        const s = findSingle(good, -1);
        if (s) { i = s.i; d = s.d; why = `: ${WHY[s.why]}`; }
        else { i = G.vals.findIndex((v, k) => bad(k)); if (i < 0) return; d = G.sol[i]; }
      }
      pushUndo();
      G.vals[i] = d; G.notes[i] = 0; G.hints++; sel = i; hintCell = i;
      if (prefs.clean) for (const p of PEERS[i]) G.notes[p] &= ~(1 << (d - 1));
      say(`Hint ${G.hints}: row ${row(i) + 1}, column ${col(i) + 1} is ${d}${why}.`);
      afterChange();
    }
    function fillNotes() {
      if (G.done || paused) return;
      pushUndo();
      G.vals.forEach((v, i) => {
        if (v) { G.notes[i] = 0; return; }
        let m = 511;
        for (const p of PEERS[i]) if (G.vals[p]) m &= ~(1 << (G.vals[p] - 1));
        G.notes[i] = m;
      });
      render(); persist();
    }

    function win() {
      G.done = true; clk.stop();
      const secs = Math.max(1, Math.round(clk.secs));
      const clean = G.hints === 0;
      const prev = bests[G.level];
      const fresh = clean && (prev == null || secs < prev);
      if (fresh) bests[G.level] = secs;
      save(GAME, { best: bests, game: null });
      hintCell = -1;
      render();
      stage.appendChild(h('div.pz-sd__card', h('div', h('b', { text: 'Solved!' }),
        h('span', { text: `${LABEL[G.level]} in ${fmtTime(secs)}${G.hints ? `, ${G.hints} hint${G.hints > 1 ? 's' : ''} (no best time with hints)` : fresh ? (prev == null ? ' — your first ' : ' — a new best for ') + LABEL[G.level] : ''}.` }))));
      say(`Solved in ${fmtTime(secs)}.`);
      onScore(secs);
      onEnd({ score: clean ? secs : null, won: true, detail: `${LABEL[G.level]} · ${G.givens} givens · ${NAMES[G.tier] || ''} techniques${G.hints ? ` · ${G.hints} hint${G.hints > 1 ? 's' : ''}` : ''}` });
    }

    /* ---------- input ---------- */
    L.on(seg, 'click', e => {
      const b = e.target.closest?.('button[data-level]');
      if (b && !dead) deal(b.dataset.level);
    });
    L.on(newBtn, 'click', () => { if (!dead) deal(G ? G.level : prefs.level); });
    L.on(board, 'pointerdown', e => {
      const c = e.target.closest?.('.pz-sd__c');
      if (!c || paused) return;
      sel = Number(c.dataset.i);
      render();
    });
    L.on(pad, 'click', e => { const b = e.target.closest?.('button[data-digit]'); if (b && !paused && !G.done) enter(Number(b.dataset.digit)); });
    L.on(eraseBtn, 'click', () => erase(sel));
    L.on(undoBtn, 'click', doUndo);
    L.on(notesBtn, 'click', () => { notesMode = !notesMode; render(); });
    L.on(hintBtn, 'click', hint);
    L.on(fillBtn, 'click', fillNotes);
    L.on(mistakeBtn, 'click', () => { prefs.show = !prefs.show; persistPrefs(); render(); });
    L.on(cleanBtn, 'click', () => { prefs.clean = !prefs.clean; persistPrefs(); render(); });
    const MOVE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    L.on(window, 'keydown', e => {
      if (dead || paused || !G || !ownsKey(root, e)) return;
      const k = e.key;
      if (MOVE[k]) {
        e.preventDefault();
        if (G.done) return;
        if (sel < 0) sel = 40;
        else sel = Math.max(0, Math.min(8, row(sel) + MOVE[k][0])) * 9 + Math.max(0, Math.min(8, col(sel) + MOVE[k][1]));
        render();
      } else if (k >= '1' && k <= '9' && !e.shiftKey) {
        e.preventDefault(); if (!e.repeat) enter(Number(k));
      } else if (k === 'Backspace' || k === 'Delete' || k === '0') {
        e.preventDefault(); erase(sel);
      } else if (k === 'n' || k === 'N') {
        e.preventDefault(); if (!e.repeat) { notesMode = !notesMode; render(); }
      } else if (k === 'h' || k === 'H') {
        e.preventDefault(); if (!e.repeat) hint();
      } else if (k === 'z' || k === 'Z' || k === 'u' || k === 'U') {
        e.preventDefault(); doUndo();
      }
    });

    /* ---------- start: pick up the saved puzzle, or deal one ---------- */
    const g0 = saved.game;
    if (g0 && typeof g0.puz === 'string' && g0.puz.length === 81 && typeof g0.sol === 'string' && g0.sol.length === 81 && LEVELS.includes(g0.level)) {
      adopt({ seed: g0.seed, level: g0.level, tier: g0.tier, puz: parse(g0.puz), sol: parse(g0.sol), vals: parse(String(g0.vals || g0.puz)), notes: Array.isArray(g0.notes) && g0.notes.length === 81 ? g0.notes.map(n => n | 0) : null, secs: g0.secs, hints: g0.hints });
      say('Welcome back: your puzzle is where you left it.');
    } else deal(prefs.level);
    requestAnimationFrame(() => { if (!dead) board.focus({ preventScroll: true }); });
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
        if (!G.done) stage.appendChild(h('div.pz__cover', { text: 'Paused' }));
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        stage.querySelector('.pz__cover')?.remove();
        if (!G.done) clk.start();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => G && ({
        level: G.level, tier: G.tier, tierName: NAMES[G.tier] || null, givens: G.givens, techniques: { ...G.used }, seed: G.seed,
        puzzle: G.puz.join(''), solution: G.sol.join(''), vals: G.vals.join(''), notes: G.notes.slice(), sel, notesMode,
        hints: G.hints, done: G.done, paused, secs: clk.secs, show: prefs.show, clean: prefs.clean, best: { ...bests },
        wrong: cells.map((c, i) => (c.classList.contains('is-wrong') ? i : -1)).filter(i => i >= 0),
        msg, undo: undo.length,
      }),
      /* test hook — nothing in the game calls it:
         deal({ level, seed }) · prefill(n: fill every cell but n correctly) · secs(n: set the clock) */
      hook(cmd, arg) {
        if (cmd === 'deal') deal(arg.level || G.level, arg.seed);
        else if (cmd === 'prefill') {
          const empties = G.vals.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
          for (const i of empties.slice(0, Math.max(0, empties.length - arg))) G.vals[i] = G.sol[i];
          render();
        } else if (cmd === 'secs') { clk.secs = arg; timeV.textContent = fmtTime(arg); }
        return true;
      },
    };
  },
};
