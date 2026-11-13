/* ============================================================
   arcade/sumgrid.js — Sum Grid for Static Arcade.

   A number-logic puzzle in the Killer Sudoku family, on a board small
   enough for any window: fill every square with a digit so that no
   digit repeats in a row, a column or a box (the thicker lines), and
   the squares inside each dashed cage hold different digits that add
   up to the small number in the cage's corner.

   Easy is 4×4 with digits 1–4; Medium and Hard are 6×6 with digits
   1–6. Medium leaves a few cages of a single square (a given digit);
   Hard has none, and bigger cages. Every puzzle is dealt by
   sumgridlogic.js, which only keeps one that an exhaustive search
   proves has exactly one solution.

   Controls
     mouse / touch  tap a square, then a digit on the pad (or Erase)
     keyboard       arrows move · digits enter · Backspace / Delete / 0
                    erase · N pencil notes · H hint · Z undo
   Notes mode puts small candidate digits in a square; entering a digit
   clears it from the notes in its row, column and box. Digits that
   break a rule (a repeat, or a cage already over its sum) turn red as
   you play; "Show mistakes" also marks digits that are simply not
   the solution. A hint fills one square and is counted; a puzzle
   solved with hints finishes but sets no best time.

   Score = seconds, lower is better. The best per level is kept on
   this device (portal.arcadePuzzles.sumgrid); an unfinished puzzle is
   saved (level, seed and your entries) and comes back after a reload.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, randomSeed, sounder } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { generate, conflicts, isSolved, combos, LEVELS, LEVEL, rowOf, colOf, boxOf } from './sumgridlogic.js';

const GAME = 'sumgrid';
const LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const CSS = `${BASE}
.pz-sg__board{--n:6;position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(var(--n),1fr);grid-template-rows:repeat(var(--n),1fr);gap:1px;
  background:var(--line-2,rgba(255,255,255,.3));border:2px solid var(--line-2,rgba(255,255,255,.3));border-radius:8px;container-type:inline-size;outline:none;touch-action:manipulation;overflow:hidden}
.pz-sg__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-sg__c{position:relative;display:grid;place-items:center;min-width:0;min-height:0;background:var(--bg-sg,#171320);font:700 calc(100cqw / var(--n) * .5)/1 var(--font,system-ui);color:#9ec5ff;cursor:pointer;font-variant-numeric:tabular-nums}
.pz-sg__c.bR{margin-right:2px}.pz-sg__c.bB{margin-bottom:2px}
.pz-sg__c::before{content:"";position:absolute;inset:3px;border:0 dashed var(--ink-2,#aab);pointer-events:none}
.pz-sg__c.cT::before{border-top-width:2px}.pz-sg__c.cR::before{border-right-width:2px}.pz-sg__c.cB::before{border-bottom-width:2px}.pz-sg__c.cL::before{border-left-width:2px}
.pz-sg__c.is-given{color:var(--ink-0,#fff);font-weight:800}
.pz-sg__c.is-peer{background:color-mix(in srgb,var(--ga) 9%,var(--bg-sg,#171320))}
.pz-sg__c.is-cage{background:color-mix(in srgb,var(--ga) 16%,var(--bg-sg,#171320))}
.pz-sg__c.is-same{background:color-mix(in srgb,var(--ga) 26%,var(--bg-sg,#171320))}
.pz-sg__c.is-sel{background:color-mix(in srgb,var(--ga) 44%,var(--bg-sg,#171320));box-shadow:inset 0 0 0 2px var(--ga)}
.pz-sg__c.is-clash{color:#ff6b6b}
.pz-sg__c.is-wrong{color:#ff6b6b;background:color-mix(in srgb,#dc2626 28%,var(--bg-sg,#171320))}
.pz-sg__c.is-hint{box-shadow:inset 0 0 0 2px #ffd166}
.pz-sg__s{position:absolute;left:calc(100cqw / var(--n) * .08);top:calc(100cqw / var(--n) * .04);font:700 calc(100cqw / var(--n) * .2)/1 var(--font,system-ui);font-style:normal;color:var(--ink-0,#fff);background:var(--bg-sg,#171320);padding:1px 3px;border-radius:3px;z-index:1}
.pz-sg__n{position:absolute;left:calc(100cqw / var(--n) * .1);right:calc(100cqw / var(--n) * .1);bottom:calc(100cqw / var(--n) * .06);display:grid;grid-template-columns:repeat(3,1fr);font:600 calc(100cqw / var(--n) * .19)/1.1 var(--font,system-ui);color:var(--ink-2,#aab);text-align:center}
.pz-sg__n b{font-weight:600}
.pz-sg__pad{width:min(100%,460px);display:grid;grid-template-columns:repeat(var(--k,6),1fr);gap:5px;flex:0 0 auto}
.pz-sg__pad button{padding:9px 0 10px;font:700 clamp(15px,4.2cqw,22px)/1 var(--font,system-ui);color:var(--ink-0,#fff);background:var(--fill-1,rgba(255,255,255,.07));border:1px solid var(--line-1,rgba(255,255,255,.1));border-radius:9px;cursor:pointer}
.pz-sg__pad button:focus-visible{outline:2px solid var(--ga);outline-offset:1px}
@media (hover:hover){.pz-sg__pad button:hover{background:var(--fill-2,rgba(255,255,255,.13))}}
.pz-sg__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);border-radius:8px;text-align:center;padding:16px}
.pz-sg__card div{max-width:34ch}
.pz-sg__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-sg__card div>span{font-size:13px;color:var(--ink-2,#bbb);line-height:1.5}
.pz.is-reduced .pz-sg__c{transition:none}
.pz:not(.is-reduced) .pz-sg__c{transition:background .12s}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false;
    const saved = load(GAME);
    const bests = { ...(saved.best || {}) };
    const prefs = { level: LEVELS.includes(saved.level) ? saved.level : 'easy', show: !!saved.show };
    let P = null;                       /* the puzzle (sumgridlogic.generate) */
    let G = null;                       /* the game on the board: { vals, notes, hints, done } */
    let sel = -1, notesMode = false, hintCell = -1, msg = '';
    const undo = [];
    let nodes = [], padBtns = [];

    /* ---------- chrome ---------- */
    const levelBtns = LEVELS.map(k => h('button', { type: 'button', dataset: { level: k }, 'aria-pressed': 'false', title: `${LEVEL[k].n}×${LEVEL[k].n}` }, LABEL[k]));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Difficulty' }, levelBtns);
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const bestV = h('small', { text: '' });
    const newBtn = h('button.pz__btn', { type: 'button', title: 'Deal a new puzzle', 'aria-label': 'New puzzle' }, icon('refresh'), h('span.pz__long', { text: 'New' }));
    const top = h('div.pz__top', seg, timeRead, bestV, newBtn);
    const board = h('div.pz-sg__board', { role: 'grid', tabindex: '0', 'aria-label': 'Sum Grid board' });
    const stage = h('div.pz__stage', board);
    const pad = h('div.pz-sg__pad');
    const eraseBtn = h('button.pz__btn', { type: 'button', title: 'Erase the square (Backspace)' }, h('span', { text: 'Erase' }));
    const undoBtn = h('button.pz__btn', { type: 'button', title: 'Undo (Z)' }, icon('rotate-ccw'), h('span', { text: 'Undo' }));
    const notesBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Pencil notes (N)' }, h('span', { text: 'Notes' }));
    const hintBtn = h('button.pz__btn', { type: 'button', title: 'Fill one square (H). Counted, and a puzzle solved with hints sets no best time.' }, icon('sparkles'), h('span', { text: 'Hint' }), h('small', { text: '0' }));
    const mistakeBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Mark digits that are not the solution' }, icon('eye'), h('span.pz__long', { text: 'Show mistakes' }));
    const bar = h('div.pz__bar', undoBtn, eraseBtn, notesBtn, hintBtn, mistakeBtn);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, stage, pad, bar, foot, live);
    el.appendChild(root);

    const say = m => { live.textContent = ''; live.textContent = m; msg = m; paintFoot(); };
    const clk = clock(s => { timeV.textContent = fmtTime(s); });
    const cageInfo = () => {
      if (sel < 0) return '';
      const c = P.cages[P.cageOf[sel]];
      const cs = combos(P.n, c.cells.length, c.sum);
      return `Cage ${c.sum} in ${c.cells.length} square${c.cells.length === 1 ? '' : 's'}: ${cs.length > 6 ? `${cs.length} ways` : cs.map(x => x.join('+')).join(' · ')}`;
    };
    const paintFoot = () => foot.replaceChildren(msg
      ? h('span', { text: msg })
      : sel >= 0 && P ? h('span', { text: cageInfo() })
        : h('span.pz__hint', { html: 'digits fill a square · <kbd>N</kbd> notes · <kbd>H</kbd> hint · <kbd>Z</kbd> undo · arrows move' }));

    /* ---------- state helpers ---------- */
    const snapshot = () => ({ v: G.vals.slice(), n: G.notes.slice() });
    const pushUndo = () => { undo.push(snapshot()); if (undo.length > 300) undo.shift(); };
    const persist = () => {
      if (!G || G.done) return;
      save(GAME, { game: { level: P.level, seed: P.seed, vals: G.vals.join(''), notes: G.notes.slice(), secs: Math.round(clk.secs), hints: G.hints } });
    };
    const persistPrefs = () => save(GAME, { level: prefs.level, show: prefs.show });

    function adopt(puzzle, d = {}) {
      P = puzzle;
      /* a cage of one square is a given digit: it starts filled in */
      const start = new Array(P.n * P.n).fill(0);
      P.cages.forEach(c => { if (c.cells.length === 1) start[c.cells[0]] = c.sum; });
      G = { vals: d.vals ? [...d.vals].map(Number) : start, notes: d.notes || new Array(P.n * P.n).fill(0), hints: d.hints || 0, done: false };
      undo.length = 0; sel = -1; hintCell = -1; notesMode = false; msg = '';
      prefs.level = P.level;
      clk.secs = d.secs || 0; timeV.textContent = fmtTime(clk.secs);
      paused = false;
      stage.querySelector('.pz__cover')?.remove();
      stage.querySelector('.pz-sg__card')?.remove();
      build();
      if (d.vals && clk.secs > 0) clk.start(); else clk.stop();
      render(); persistPrefs(); persist();
    }
    function build() {
      const n = P.n;
      board.style.setProperty('--n', n);
      pad.style.setProperty('--k', n + 0);
      board.replaceChildren();
      nodes = Array.from({ length: n * n }, (_, i) => {
        const c = h('div.pz-sg__c', { role: 'gridcell', dataset: { i } });
        const cg = P.cages[P.cageOf[i]];
        if (Math.min(...cg.cells) === i) c.appendChild(h('i.pz-sg__s', { text: String(cg.sum) }));
        board.appendChild(c);
        return c;
      });
      pad.replaceChildren(...Array.from({ length: n }, (_, k) => h('button', { type: 'button', dataset: { digit: k + 1 }, 'aria-label': `Enter ${k + 1}`, text: String(k + 1) })));
      padBtns = [...pad.children];
    }
    function deal(level, seed = randomSeed()) {
      const p = generate(level, seed);
      adopt(p);
      say(`${LABEL[level]}: ${LEVEL[level].n}×${LEVEL[level].n}, ${p.cages.length} cages, one solution.`);
    }

    /* ---------- render ---------- */
    function render() {
      if (!G) return;
      const n = P.n, bad = conflicts(P, G.vals);
      const sv = sel >= 0 ? G.vals[sel] : 0, selCage = sel >= 0 ? P.cageOf[sel] : -1;
      nodes.forEach((c, i) => {
        const v = G.vals[i], given = P.cages[P.cageOf[i]].cells.length === 1;
        const wrong = prefs.show && v && v !== P.sol[i];
        const r = rowOf(n, i), cl = colOf(n, i), ck = P.cageOf[i];
        const same = j => j >= 0 && P.cageOf[j] === ck;
        const peer = sel >= 0 && i !== sel && (rowOf(n, sel) === r || colOf(n, sel) === cl || boxOf(P, sel) === boxOf(P, i));
        c.className = 'pz-sg__c' + (cl % P.boxC === P.boxC - 1 && cl < n - 1 ? ' bR' : '') + (r % P.boxR === P.boxR - 1 && r < n - 1 ? ' bB' : '')
          + (r === 0 || !same(i - n) ? ' cT' : '') + (r === n - 1 || !same(i + n) ? ' cB' : '') + (cl === 0 || !same(i - 1) ? ' cL' : '') + (cl === n - 1 || !same(i + 1) ? ' cR' : '')
          + (given ? ' is-given' : '') + (i === sel ? ' is-sel' : i !== sel && ck === selCage ? ' is-cage' : peer ? ' is-peer' : '')
          + (sv && v === sv && i !== sel ? ' is-same' : '') + (bad.has(i) ? ' is-clash' : '') + (wrong ? ' is-wrong' : '') + (i === hintCell ? ' is-hint' : '');
        const m = G.notes[i];
        const key = v ? `v${v}` : m ? `n${m}` : '';
        if (c.dataset.k !== key) {
          c.querySelector('.pz-sg__v')?.remove(); c.querySelector('.pz-sg__n')?.remove();
          if (v) c.appendChild(h('span.pz-sg__v', { text: String(v) }));
          else if (m) c.appendChild(h('div.pz-sg__n', Array.from({ length: n }, (_, d) => h('b', { text: m & (1 << d) ? String(d + 1) : '' }))));
          c.dataset.k = key;
        }
        c.setAttribute('aria-label', `Row ${r + 1}, column ${cl + 1}, cage ${P.cages[ck].sum}, ${v ? v : m ? 'notes' : 'empty'}${bad.has(i) ? ', breaks a rule' : ''}`);
        if (i === sel) c.setAttribute('aria-selected', 'true'); else c.removeAttribute('aria-selected');
      });
      levelBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === P.level)));
      notesBtn.setAttribute('aria-pressed', String(notesMode));
      mistakeBtn.setAttribute('aria-pressed', String(prefs.show));
      hintBtn.lastChild.textContent = String(G.hints);
      undoBtn.disabled = !undo.length || G.done;
      padBtns.forEach(b => { b.disabled = G.done; });
      bestV.textContent = bests[P.level] != null ? `Best ${LABEL[P.level]}: ${fmtTime(bests[P.level])}` : `No ${LABEL[P.level]} time yet`;
      paintFoot();
    }

    /* ---------- moves ---------- */
    const editable = i => i >= 0 && !G.done && !paused && P.cages[P.cageOf[i]].cells.length > 1;
    const peersOf = i => { const out = []; for (let j = 0; j < P.n * P.n; j++) if (j !== i && (rowOf(P.n, j) === rowOf(P.n, i) || colOf(P.n, j) === colOf(P.n, i) || boxOf(P, j) === boxOf(P, i))) out.push(j); return out; };
    const begin = () => { if (!clk.running && !G.done && !paused) clk.start(); };
    function setValue(i, d) {
      if (!editable(i)) return;
      begin(); pushUndo(); snd.wake();
      G.vals[i] = G.vals[i] === d ? 0 : d;
      G.notes[i] = 0;
      if (G.vals[i]) for (const p of peersOf(i)) G.notes[p] &= ~(1 << (d - 1));
      hintCell = -1; msg = '';
      if (G.vals[i]) snd.blip(340 + d * 45, 0.05, 'triangle', 0.5);
      afterChange();
      if (G.vals[i] && !G.done && conflicts(P, G.vals).has(i)) snd.blip(160, 0.1, 'sawtooth', 0.35, 120);
    }
    function toggleNote(i, d) {
      if (!editable(i) || G.vals[i]) return;
      begin(); pushUndo();
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
      if (d < 1 || d > P.n) return;
      if (sel < 0) { sel = G.vals.findIndex((v, i) => editable(i) && !v); if (sel < 0) return; }
      if (notesMode) toggleNote(sel, d); else setValue(sel, d);
    }
    function afterChange() {
      render();
      persist();
      if (G.vals.every(Boolean)) {
        if (isSolved(P, G.vals)) win();
        else say(prefs.show ? 'The board is full, but the red squares are wrong.' : 'The board is full, but a rule is broken — look for red digits.');
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
      const wrongOrEmpty = i => editable(i) && G.vals[i] !== P.sol[i];
      let i = sel >= 0 && wrongOrEmpty(sel) ? sel : G.vals.findIndex((v, k) => wrongOrEmpty(k) && !v);
      if (i < 0) i = G.vals.findIndex((v, k) => wrongOrEmpty(k));
      if (i < 0) return;
      begin(); pushUndo();
      const d = P.sol[i];
      G.vals[i] = d; G.notes[i] = 0; G.hints++; sel = i; hintCell = i;
      for (const p of peersOf(i)) G.notes[p] &= ~(1 << (d - 1));
      say(`Hint ${G.hints}: row ${rowOf(P.n, i) + 1}, column ${colOf(P.n, i) + 1} is ${d}.`);
      afterChange();
    }
    function win() {
      G.done = true; clk.stop();
      const secs = Math.max(1, Math.round(clk.secs));
      const clean = G.hints === 0;
      const prev = bests[P.level];
      const fresh = clean && (prev == null || secs < prev);
      if (fresh) bests[P.level] = secs;
      save(GAME, { best: bests, game: null });
      snd.blip(520, 0.09, 'triangle', 0.8); snd.blip(780, 0.12, 'triangle', 0.7);
      render();
      stage.appendChild(h('div.pz-sg__card', h('div', h('b', { text: 'Solved!' }),
        h('span', { text: `${LABEL[P.level]} in ${fmtTime(secs)}${G.hints ? ` with ${G.hints} hint${G.hints === 1 ? '' : 's'} — no best time` : fresh ? (prev == null ? ' — your first ' : ' — a new best for ') + LABEL[P.level] : ''}.` }))));
      say(`Solved in ${fmtTime(secs)}.`);
      onScore(secs);
      onEnd({ score: clean ? secs : null, won: true, detail: `${LABEL[P.level]} ${P.n}×${P.n} · ${P.cages.length} cages${G.hints ? ` · ${G.hints} hint${G.hints === 1 ? '' : 's'}` : ''}` });
    }

    /* ---------- input ---------- */
    L.on(board, 'pointerdown', e => {
      const c = e.target.closest?.('.pz-sg__c');
      if (!c || paused || G.done) return;
      sel = +c.dataset.i; msg = '';
      render(); board.focus({ preventScroll: true });
    });
    L.on(pad, 'click', e => { const b = e.target.closest?.('button[data-digit]'); if (b) { enter(+b.dataset.digit); board.focus({ preventScroll: true }); } });
    L.on(eraseBtn, 'click', () => { erase(sel); board.focus({ preventScroll: true }); });
    L.on(undoBtn, 'click', () => { doUndo(); board.focus({ preventScroll: true }); });
    L.on(notesBtn, 'click', () => { notesMode = !notesMode; render(); board.focus({ preventScroll: true }); });
    L.on(hintBtn, 'click', () => { hint(); board.focus({ preventScroll: true }); });
    L.on(mistakeBtn, 'click', () => { prefs.show = !prefs.show; persistPrefs(); render(); board.focus({ preventScroll: true }); });
    L.on(seg, 'click', e => { const b = e.target.closest?.('button[data-level]'); if (b && !dead && b.dataset.level !== P.level) deal(b.dataset.level); });
    L.on(newBtn, 'click', () => { if (!dead) deal(P.level); });
    const MOVE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    L.on(window, 'keydown', e => {
      if (dead || paused || !ownsKey(root, e)) return;
      const k = e.key;
      if (MOVE[k]) {
        if (G.done) return;
        e.preventDefault();
        const n = P.n, r0 = sel < 0 ? 0 : rowOf(n, sel), c0 = sel < 0 ? 0 : colOf(n, sel);
        sel = sel < 0 ? 0 : Math.max(0, Math.min(n - 1, r0 + MOVE[k][0])) * n + Math.max(0, Math.min(n - 1, c0 + MOVE[k][1]));
        msg = ''; render();
      } else if (/^[1-9]$/.test(k)) { e.preventDefault(); enter(+k); }
      else if (k === 'Backspace' || k === 'Delete' || k === '0') { e.preventDefault(); erase(sel); }
      else if (k === 'n' || k === 'N') { e.preventDefault(); notesMode = !notesMode; render(); }
      else if (k === 'h' || k === 'H') { e.preventDefault(); hint(); }
      else if (k === 'z' || k === 'Z') { e.preventDefault(); doUndo(); }
    });

    /* ---------- start: the saved puzzle if there is one ---------- */
    const sg = saved.game;
    let resumed = false;
    if (sg && LEVELS.includes(sg.level) && Number.isFinite(sg.seed) && typeof sg.vals === 'string') {
      try {
        const p = generate(sg.level, sg.seed);
        if (sg.vals.length === p.n * p.n) { adopt(p, { vals: sg.vals, notes: Array.isArray(sg.notes) && sg.notes.length === p.n * p.n ? sg.notes : null, secs: sg.secs, hints: sg.hints }); resumed = true; }
      } catch (err) { /* a puzzle that will not regenerate is just not resumed */ }
    }
    if (resumed) say(`Welcome back: your ${LABEL[P.level]} puzzle, as you left it.`);
    else deal(prefs.level);
    requestAnimationFrame(() => { if (!dead) board.focus({ preventScroll: true }); });
    onScore(0);

    return {
      stop() {
        if (dead) return;
        persist();
        dead = true;
        clk.dispose();
        L.clear();
        snd.close();
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        paused = true; clk.stop();
        if (!G.done) stage.appendChild(h('div.pz__cover', { text: 'Paused' }));
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        stage.querySelector('.pz__cover')?.remove();
        if (!G.done && clk.secs > 0) clk.start();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => P && ({
        level: P.level, seed: P.seed, n: P.n, boxR: P.boxR, boxC: P.boxC, cages: P.cages.map(c => ({ cells: c.cells.slice(), sum: c.sum })), sol: P.sol.slice(),
        vals: G.vals.slice(), notes: G.notes.slice(), sel, notesMode, hints: G.hints, done: G.done, paused, secs: clk.secs, best: { ...bests }, running: clk.running,
        clash: [...conflicts(P, G.vals)], undo: undo.length, resumed,
        shown: nodes.map(c => c.querySelector('.pz-sg__v')?.textContent || '').join(''),
      }),
      /* test hook — nothing in the game calls it: deal({ level, seed }) */
      hook(cmd, arg) {
        if (cmd === 'deal') deal(arg.level || prefs.level, arg.seed ?? randomSeed());
        return true;
      },
    };
  },
};
