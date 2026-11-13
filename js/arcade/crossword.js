/* ============================================================
   arcade/crossword.js — Mini Crosswords for Static Arcade.

   Fifty small hand-made crosswords (crosswords.data.js), from 4×4
   frames to 5×7 grids, each with its own clues. Pick any puzzle from
   the list; the ones you have finished carry a tick.

   Controls
     mouse / touch  tap a square to select it, tap the selected square
                    again to switch between across and down; tap a clue
                    to jump to its word (touch screens get a letter pad)
     keyboard       type to fill a square and move on · Backspace clears
                    (and steps back from an empty square) · arrows move
                    (an arrow along the other axis first turns the
                    word) · Tab / Shift+Tab next / previous clue · Space
                    switches across / down · Delete clears the square
   Check marks the wrong letters (a mark goes when you change that
   square); Reveal shows one letter, the word or the whole puzzle;
   Clear starts the puzzle over (press it twice).

   Every puzzle keeps its own progress (portal.arcadePuzzles.crossword)
   and picks up where you left off after a reload. Score = seconds from
   your first letter to the last, lower is better; a puzzle finished
   after using Reveal still counts as solved but sets no time.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, coarse, sounder } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { PUZZLES } from './crosswords.data.js';
import { parseGrid, clueOf, blank, put, isSolved, isFilled, filledCount, wrongCells, entriesAt, dirAt, firstCell, arrow, advance, backspace, stepEntry, reveal, solutionOf } from './crosswordlogic.js';

const GAME = 'crossword';

const CSS = `${BASE}
.pz-cw__main{flex:1 1 auto;min-height:0;width:100%;display:flex;gap:var(--sp-4,12px);align-items:stretch;justify-content:center}
.pz-cw__left{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px;align-items:center}
.pz-cw__clue{flex:0 0 auto;width:100%;min-height:42px;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.1));font:600 15px/1.3 var(--font,system-ui);color:var(--ink-0,#fff)}
.pz-cw__clue b{flex:0 0 auto;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3,#999)}
.pz-cw__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-cw__board{--w:5;--h:5;position:relative;width:min(100cqw,calc(100cqh * var(--w) / var(--h)));aspect-ratio:var(--w) / var(--h);display:grid;grid-template-columns:repeat(var(--w),1fr);grid-template-rows:repeat(var(--h),1fr);gap:2px;
  background:var(--ink-0,#fff);border:2px solid var(--ink-0,#fff);border-radius:6px;container-type:inline-size;outline:none;touch-action:manipulation;overflow:hidden}
.pz-cw__board:focus-visible{box-shadow:0 0 0 3px var(--ga)}
.pz-cw__c{position:relative;display:grid;place-items:center;min-width:0;min-height:0;background:var(--bg-cw,#f6f3ea);color:#1b1730;font:800 calc(100cqw / var(--w) * .5)/1 var(--font,system-ui);cursor:pointer;text-transform:uppercase}
.pz-cw__c.is-black{background:#15121f;cursor:default}
.pz-cw__c.is-word{background:color-mix(in srgb,var(--ga) 22%,#f6f3ea)}
.pz-cw__c.is-sel{background:color-mix(in srgb,var(--ga) 62%,#f6f3ea);box-shadow:inset 0 0 0 3px var(--ga)}
.pz-cw__c.is-wrong{color:#c4161c}
.pz-cw__c.is-wrong::after{content:"";position:absolute;left:6%;right:6%;top:50%;height:2px;background:#c4161c;transform:rotate(-32deg)}
.pz-cw__c small{position:absolute;left:6%;top:3%;font:700 calc(100cqw / var(--w) * .2)/1 var(--font,system-ui);color:#4a4466}
.pz-cw__lists{flex:0 0 auto;width:min(300px,34%);display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;align-self:stretch}
.pz-cw__lists h4{margin:0 0 3px;font:600 11px/1 var(--font,system-ui);color:var(--ink-3,#999);text-transform:uppercase;letter-spacing:.06em}
.pz-cw__lists ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.pz-cw__lists button{width:100%;text-align:left;display:flex;gap:7px;padding:5px 7px;border-radius:7px;background:none;border:0;color:var(--ink-1,#ddd);font:500 13px/1.3 var(--font,system-ui);cursor:pointer}
.pz-cw__lists button b{flex:0 0 auto;min-width:16px;color:var(--ink-3,#999)}
.pz-cw__lists button.is-cur{background:color-mix(in srgb,var(--ga) 28%,transparent);color:var(--ink-0,#fff)}
.pz-cw__lists button.is-done{opacity:.55;text-decoration:line-through}
.pz-cw__lists button:focus-visible{outline:2px solid var(--ga)}
.pz-cw__pad{flex:0 0 auto;width:min(100%,520px);display:flex;flex-direction:column;gap:5px}
.pz-cw__pad div{display:flex;justify-content:center;gap:4px}
.pz-cw__pad button{flex:1 1 0;max-width:44px;padding:9px 0;font:700 16px/1 var(--font,system-ui);color:var(--ink-0,#fff);background:var(--fill-2,rgba(255,255,255,.1));border:1px solid var(--line-1,rgba(255,255,255,.1));border-radius:7px;cursor:pointer}
.pz-cw__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.8);border-radius:6px;text-align:center;padding:12px}
.pz-cw__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-cw__card div>span{font-size:13px;color:var(--ink-2,#bbb)}
@container (max-width:700px){.pz-cw__main{flex-direction:column;gap:6px}.pz-cw__lists{width:100%;flex-direction:row;max-height:34%}.pz-cw__lists>div{flex:1 1 0;min-width:0}}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false;
    const sv = load(GAME);
    const progress = { ...(sv.progress || {}) };            /* id -> { s: letters, secs, rev, done } */
    const bests = { ...(sv.best || {}) };                   /* id -> seconds */
    const isDone = id => !!progress[id]?.done;
    let n = 0, puz = PUZZLES[0], g = parseGrid(puz.grid);
    let state = '', sel = 0, dir = 'A', rev = 0, done = false, msg = '';
    let wrong = new Set(), clearArmed = 0;
    let nodes = [], clueBtns = {};

    /* ---------- chrome ---------- */
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous puzzle', 'aria-label': 'Previous puzzle' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next puzzle', 'aria-label': 'Next puzzle' }, icon('chevron-right'));
    const pick = h('select.pz__sel', { 'aria-label': 'Puzzle' }, PUZZLES.map((p, i) => h('option', { value: String(i), text: `Puzzle ${i + 1}` })));
    const solvedV = h('small', { text: '' });
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const checkBtn = h('button.pz__btn', { type: 'button', title: 'Mark the letters that are wrong' }, icon('check'), h('span.pz__long', { text: 'Check' }));
    const revLetter = h('button.pz__btn', { type: 'button', title: 'Show the letter in the selected square' }, h('span', { text: 'Letter' }));
    const revWord = h('button.pz__btn', { type: 'button', title: 'Show the whole word' }, h('span', { text: 'Word' }));
    const revAll = h('button.pz__btn', { type: 'button', title: 'Show the whole puzzle' }, h('span', { text: 'Puzzle' }));
    const revGroup = h('div.pz__seg', { role: 'group', 'aria-label': 'Reveal' }, h('small.pz__note', { style: { padding: '0 6px', alignSelf: 'center' }, text: 'Reveal' }), revLetter, revWord, revAll);
    const clearBtn = h('button.pz__btn', { type: 'button', title: 'Start this puzzle over' }, icon('trash'), h('span', { text: 'Clear' }));
    const top = h('div.pz__top', prevBtn, pick, nextBtn, solvedV, timeRead, checkBtn, revGroup, clearBtn);
    const clueBar = h('div.pz-cw__clue', { 'aria-live': 'polite' });
    const board = h('div.pz-cw__board', { role: 'grid', tabindex: '0', 'aria-label': 'Crossword grid' });
    const bw = h('div.pz-cw__bw', board);
    const padEl = coarse() ? h('div.pz-cw__pad', ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM⌫'].map(row => h('div', [...row].map(ch => h('button', { type: 'button', dataset: { key: ch }, 'aria-label': ch === '⌫' ? 'Backspace' : ch, text: ch }))))) : null;
    const left = h('div.pz-cw__left', clueBar, bw, padEl);
    const across = h('ul'), down = h('ul');
    const lists = h('div.pz-cw__lists', h('div', h('h4', { text: 'Across' }), across), h('div', h('h4', { text: 'Down' }), down));
    const main = h('div.pz-cw__main', left, lists);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, main, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'type to fill · arrows move · <kbd>Tab</kbd> next clue · <kbd>Space</kbd> across / down · <kbd>Backspace</kbd> clears' }));
    const clk = clock(secs => { timeV.textContent = fmtTime(secs); });

    /* ---------- saved progress ---------- */
    let lastSave = 0;
    const persist = (force = false) => {
      const now = Date.now();
      if (!force && now - lastSave < 1500) return;
      lastSave = now;
      progress[puz.id] = { s: state, secs: Math.round(clk.secs), rev, done };
      save(GAME, { cur: puz.id, progress, best: bests });
    };

    /* ---------- the puzzle on screen ---------- */
    function open(i, fresh = false) {
      clk.stop();
      n = Math.max(0, Math.min(PUZZLES.length - 1, i));
      puz = PUZZLES[n]; g = parseGrid(puz.grid);
      const p = fresh ? null : progress[puz.id];
      state = blank(puz, p?.s); rev = p?.rev || 0; done = !!p?.done && isSolved(puz, state);
      if (fresh) { done = false; }
      clk.secs = p?.secs || 0; timeV.textContent = fmtTime(clk.secs);
      wrong = new Set(); clearArmed = 0; paused = false; msg = '';
      sel = firstCell(g); dir = dirAt(g, sel, 'A') || 'D';
      const empty = g.cells.findIndex((ch, k) => ch !== '#' && state[k] === '.');
      if (empty >= 0 && !done) { sel = empty; dir = dirAt(g, sel, dir) || dir; }
      board.style.setProperty('--w', g.w); board.style.setProperty('--h', g.h);
      board.replaceChildren();
      nodes = g.cells.map((ch, k) => {
        const c = h('div.pz-cw__c' + (ch === '#' ? '.is-black' : ''), { role: 'gridcell', dataset: { i: k } });
        if (g.numberAt[k]) c.appendChild(h('small', { text: String(g.numberAt[k]) }));
        c.appendChild(h('span.pz-cw__l'));
        if (ch !== '#') c.addEventListener('click', () => clickCell(k));
        board.appendChild(c);
        return c;
      });
      clueBtns = {};
      for (const [ul, d] of [[across, 'A'], [down, 'D']]) {
        ul.replaceChildren();
        for (const e of g.entries.filter(x => x.dir === d)) {
          const b = h('button', { type: 'button', dataset: { key: e.key }, onclick: () => goEntry(e) }, h('b', { text: String(e.n) }), h('span', { text: clueOf(puz, e) }));
          clueBtns[e.key] = b; ul.appendChild(h('li', b));
        }
      }
      pick.value = String(n);
      bw.querySelector('.pz-cw__card')?.remove();
      paint();
      if (done) showDone(true);
      onScore(done ? Math.round(clk.secs) : 0);
      say(done ? `Puzzle ${n + 1} is solved.` : `Puzzle ${n + 1}: ${g.entries.length} clues.`);
    }
    function paint() {
      const e = entriesAt(g, sel)[dir];
      const inWord = new Set(e ? e.cells : []);
      nodes.forEach((c, k) => {
        if (g.cells[k] === '#') return;
        c.className = 'pz-cw__c' + (k === sel ? ' is-sel' : inWord.has(k) ? ' is-word' : '') + (wrong.has(k) ? ' is-wrong' : '');
        c.querySelector('.pz-cw__l').textContent = state[k] === '.' ? '' : state[k];
        c.setAttribute('aria-label', `Row ${Math.floor(k / g.w) + 1}, column ${k % g.w + 1}${g.numberAt[k] ? `, clue number ${g.numberAt[k]}` : ''}, ${state[k] === '.' ? 'empty' : state[k]}${wrong.has(k) ? ', marked wrong' : ''}`);
        if (k === sel) c.setAttribute('aria-selected', 'true'); else c.removeAttribute('aria-selected');
      });
      clueBar.replaceChildren(e
        ? h('div', { style: { display: 'contents' } }, h('b', { text: `${e.n} ${e.dir === 'A' ? 'Across' : 'Down'}` }), h('span', { text: clueOf(puz, e) }))
        : h('span', { text: '' }));
      for (const [key, b] of Object.entries(clueBtns)) {
        const en = g.entries.find(x => x.key === key);
        b.classList.toggle('is-cur', !!e && e.key === key);
        b.classList.toggle('is-done', en.cells.every(k => state[k] !== '.'));
      }
      clueBtns[e?.key]?.scrollIntoView?.({ block: 'nearest' });
      solvedV.textContent = `${PUZZLES.filter(p => isDone(p.id)).length} of ${PUZZLES.length} solved${isDone(puz.id) ? ' · this one ✓' : ''}`;
      [...pick.options].forEach((o, i) => { o.textContent = `Puzzle ${i + 1}${isDone(PUZZLES[i].id) ? ' ✓' : ''}`; });
      prevBtn.disabled = n === 0; nextBtn.disabled = n === PUZZLES.length - 1;
      const can = !done;
      [checkBtn, revLetter, revWord, revAll].forEach(b => { b.disabled = !can; });
    }
    function showDone(already) {
      bw.querySelector('.pz-cw__card')?.remove();
      bw.appendChild(h('div.pz-cw__card', { dataset: { role: 'solved' } }, h('div', h('b', { text: 'Solved!' }),
        h('span', { text: `${fmtTime(clk.secs)}${rev ? ' · with help, so no time is kept' : bests[puz.id] != null && !already ? ` · best ${fmtTime(bests[puz.id])}` : ''}${already && bests[puz.id] != null ? ` · your best ${fmtTime(bests[puz.id])}` : ''}` }))));
    }

    /* ---------- moves ---------- */
    const live1 = () => !dead && !paused && !done;
    const begin = () => { if (!clk.running && live1()) clk.start(); };
    function goEntry(e) {
      if (!live1()) return;
      sel = e.cells.find(k => state[k] === '.') ?? e.cells[0]; dir = e.dir;
      paint(); board.focus({ preventScroll: true });
    }
    function clickCell(k) {
      if (!live1() || g.cells[k] === '#') return;
      if (k === sel) { const other = dir === 'A' ? 'D' : 'A'; if (entriesAt(g, k)[other]) dir = other; }
      else { sel = k; dir = dirAt(g, k, dir) || dir; }
      paint(); board.focus({ preventScroll: true });
    }
    function afterChange() {
      persist();
      paint();
      if (isSolved(puz, state)) solve();
      else if (isFilled(state)) say('The grid is full, but something is wrong. Try Check.');
    }
    function type(ch) {
      if (!live1() || g.cells[sel] === '#') return;
      begin(); snd.wake(); snd.blip(430 + (ch.charCodeAt(0) - 65) * 8, 0.035, 'triangle', 0.45);
      state = put(state, sel, ch);
      wrong.delete(sel);
      sel = advance(g, state, sel, dir);
      afterChange();
    }
    function erase() {
      if (!live1()) return;
      begin();
      const r = backspace(g, state, sel, dir);
      wrong.delete(r.i); state = r.state; sel = r.i;
      afterChange();
    }
    function solve() {
      done = true; clk.stop();
      const secs = Math.max(1, Math.round(clk.secs));
      const helped = rev > 0;
      if (!helped && (bests[puz.id] == null || secs < bests[puz.id])) bests[puz.id] = secs;
      persist(true);
      paint(); showDone(false);
      snd.blip(520, 0.09, 'triangle', 0.8); snd.blip(780, 0.12, 'triangle', 0.7);
      say(helped ? 'Solved, with help.' : `Solved in ${fmtTime(secs)}.`);
      onScore(secs);
      onEnd({ score: helped ? null : secs, won: true, detail: `Puzzle ${n + 1} · ${fmtTime(secs)}${helped ? ' · with help' : ''}` });
    }
    function doCheck() {
      if (!live1()) return;
      const bad = wrongCells(puz, state);
      wrong = new Set(bad);
      snd.blip(bad.length ? 170 : 600, 0.1, bad.length ? 'sawtooth' : 'triangle', 0.4, bad.length ? 120 : 0);
      paint();
      say(bad.length ? `${bad.length} letter${bad.length === 1 ? ' is' : 's are'} wrong.` : filledCount(state) ? 'Every letter so far is right.' : 'Nothing to check yet.');
    }
    function doReveal(what) {
      if (!live1() || g.cells[sel] === '#') return;
      begin();
      const before = state;
      state = reveal(puz, state, what, sel, dir);
      let changed = 0; for (let k = 0; k < state.length; k++) if (state[k] !== before[k]) { changed++; wrong.delete(k); }
      if (!changed) { say('Nothing to reveal there.'); return; }
      rev += changed;
      say(what === 'cell' ? 'Revealed a letter.' : what === 'word' ? 'Revealed the word.' : 'Revealed the puzzle.');
      afterChange();
    }
    function doClear() {
      if (dead) return;
      if (!clearArmed || Date.now() - clearArmed > 3500) {
        clearArmed = Date.now();
        clearBtn.querySelector('span').textContent = 'Sure?';
        setTimeout(() => { if (!dead) { clearBtn.querySelector('span').textContent = 'Clear'; if (Date.now() - clearArmed > 3000) clearArmed = 0; } }, 3600);
        say('Press Clear again to start this puzzle over.');
        return;
      }
      clearArmed = 0; clearBtn.querySelector('span').textContent = 'Clear';
      delete progress[puz.id];
      open(n, true);
      persist(true);
      say(`Puzzle ${n + 1} cleared.`);
    }
    L.on(checkBtn, 'click', doCheck);
    L.on(revLetter, 'click', () => doReveal('cell'));
    L.on(revWord, 'click', () => doReveal('word'));
    L.on(revAll, 'click', () => doReveal('all'));
    L.on(clearBtn, 'click', doClear);
    L.on(prevBtn, 'click', () => { persist(true); open(n - 1); });
    L.on(nextBtn, 'click', () => { persist(true); open(n + 1); });
    L.on(pick, 'change', () => { persist(true); open(+pick.value); board.focus({ preventScroll: true }); });
    if (padEl) L.on(padEl, 'click', e => {
      const b = e.target.closest?.('button[data-key]');
      if (!b) return;
      if (b.dataset.key === '⌫') erase(); else type(b.dataset.key);
    });

    /* ---------- keyboard ---------- */
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e) || !live1()) return;
      const k = e.key;
      if (/^[a-zA-Z]$/.test(k)) { e.preventDefault(); type(k.toUpperCase()); return; }   /* P is a letter here, not the Arcade's pause key */
      if (k === 'Backspace') { e.preventDefault(); erase(); }
      else if (k === 'Delete') { e.preventDefault(); if (state[sel] !== '.') { state = put(state, sel, '.'); wrong.delete(sel); afterChange(); } }
      else if (k.startsWith('Arrow')) { e.preventDefault(); const r = arrow(g, sel, dir, k); sel = r.i; dir = r.dir; paint(); }
      else if (k === 'Tab') { e.preventDefault(); const r = stepEntry(g, state, sel, dir, e.shiftKey); sel = r.i; dir = r.dir; paint(); }
      else if (k === ' ') { e.preventDefault(); if (!e.repeat) { const o = dir === 'A' ? 'D' : 'A'; if (entriesAt(g, sel)[o]) { dir = o; paint(); } } }
    });

    /* ---------- boot ---------- */
    paintFoot();
    const startId = PUZZLES.some(p => p.id === sv.cur) ? sv.cur : PUZZLES[0].id;
    let start = PUZZLES.findIndex(p => p.id === startId);
    if (isDone(PUZZLES[start].id)) {                       /* a finished puzzle was the last one: go on to the next unsolved */
      const nxt = PUZZLES.findIndex((p, i) => i > start && !isDone(p.id));
      const any = PUZZLES.findIndex(p => !isDone(p.id));
      start = nxt >= 0 ? nxt : any >= 0 ? any : start;
    }
    open(start);
    requestAnimationFrame(() => { if (!dead) board.focus({ preventScroll: true }); });

    return {
      stop() {
        if (dead) return;
        persist(true);
        dead = true;
        clk.dispose();
        L.clear();
        snd.close();
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        paused = true; clk.stop(); persist(true);
        if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' }));
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        bw.querySelector('.pz__cover')?.remove();
        if (!done && clk.secs > 0 && filledCount(state) > 0) clk.start();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        n, id: puz.id, w: g.w, h: g.h, state, sel, dir, entry: entriesAt(g, sel)[dir]?.key || null, clue: clueBar.textContent, done, rev, secs: clk.secs, paused,
        wrong: [...wrong], solution: solutionOf(puz), solvedCount: PUZZLES.filter(p => isDone(p.id)).length, best: { ...bests }, keypad: !!padEl,
        message: msg, running: clk.running,
        shown: nodes.map(c => c.querySelector('.pz-cw__l')?.textContent || (c.classList.contains('is-black') ? '#' : '.')).join(''),
      }),
      /* test hook — nothing in the game calls it: open({ n }) */
      hook(cmd, arg) {
        if (cmd === 'open') { persist(true); open(arg.n); }
        return true;
      },
    };
  },
};
