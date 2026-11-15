/* ============================================================
   arcade/levelkit.js — what the level-by-level puzzles of batch
   newgames4 (Crate Shift, Disc Towers) share: a bar with Previous and
   Next, the level and its par, Undo, Hint and Restart, a canvas that
   redraws only when something changed (there is no frame loop, so a
   hidden or paused window costs nothing), progress kept on this device
   (portal.arcadePuzzles.<game>: the level you are on and your fewest
   moves on each), and a result when a level is solved.

   levelGame(def) -> { mount(el, ctx) } for Static Arcade. The def:
     game, title, hue, levels: [{ par, … }]
     init(level) -> state            apply(level, state, action) -> state | null
     solved(level, state)            hint(level, state) -> action | null
     keyAction(code, level, state, ui) -> action | null
     pointerAction(x, y, w, h, level, state, ui) -> action | null
     draw(g, w, h, level, state, X)  X = { hint, ui, reduced, solved }
     newUi() -> {} (per level)       peek(level, state, ui) -> {}
     help: the line under the board
   A move is whatever apply() accepts: the number of accepted actions
   is the score (lower is better). A hint shows the next move of a
   shortest solution; a level finished with a hint sets no best.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, surface, clamp } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';

const CSS = `${BASE}
.lk__stage{position:relative;flex:1 1 auto;min-height:200px;width:100%;max-width:760px;border-radius:14px;overflow:hidden;border:2px solid var(--line-2,rgba(255,255,255,.22));background:#0e1420;outline:none}
.lk__stage:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.lk__card{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:4;padding:9px 14px;border-radius:12px;background:rgba(10,14,22,.9);border:1px solid var(--ga);color:#fff;font-size:13px;font-weight:650;text-align:center;max-width:92%}
.lk__card small{display:block;font-weight:500;color:var(--ink-2,#bbb);margin-top:2px}
`;

export function levelGame(def) {
  return {
    mount(el, ctx = {}) {
      const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
      const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
      const reduced = reducedMotion(ctx);
      const L = bag();
      const sv = load(def.game);
      const bests = { ...(sv.best || {}) };
      const N = def.levels.length;
      let dead = false;
      let lvl = clamp(Number(sv.level) || 0, 0, N - 1);
      let hist = [], ui = {}, hintAct = null, hints = 0, done = false, kept = 0;

      const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous level (PageUp)', dataset: { act: 'prev' } }, icon('chevron-left'));
      const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next level (PageDown)', dataset: { act: 'next' } }, icon('chevron-right'));
      const levelV = h('span', { text: '1' });
      const levelRead = h('div.pz__read', { title: 'Level', 'aria-label': 'Level' }, icon('layers'), levelV, h('small', { text: `/ ${N}` }));
      const parV = h('span', { text: '0' });
      const parRead = h('div.pz__read', { title: 'The fewest moves there are', 'aria-label': 'Par' }, icon('star'), parV, h('small', { text: 'par' }));
      const movesV = h('span', { text: '0' });
      const movesRead = h('div.pz__read', { title: 'Your moves', 'aria-label': 'Moves' }, icon('box'), movesV, h('small', { text: 'moves' }));
      const bestV = h('small.pz__note', { text: '' });
      const undoBtn = h('button.pz__btn', { type: 'button', title: 'Take back the last move (U or Z)', dataset: { act: 'undo' } }, icon('rotate-ccw'), h('span.pz__long', { text: 'Undo' }));
      const hintBtn = h('button.pz__btn', { type: 'button', title: 'Show the next move of a shortest solution (H). A level finished with a hint sets no best.', dataset: { act: 'hint' } }, icon('sparkles'), h('span.pz__long', { text: 'Hint' }));
      const resetBtn = h('button.pz__btn', { type: 'button', title: 'Start this level again (R)', dataset: { act: 'restart' } }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
      const top = h('div.pz__top', prevBtn, levelRead, nextBtn, parRead, movesRead);
      const bar = h('div.pz__bar', undoBtn, hintBtn, resetBtn, bestV);
      const stage = h('div.lk__stage', { tabindex: '0', role: 'application', 'aria-label': def.title });
      const card = h('div.lk__card', { hidden: true });
      stage.appendChild(card);
      const foot = h('div.pz__foot', { text: def.help });
      const live = h('div.pz__live', { 'aria-live': 'polite' });
      const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } }, h('style', { text: CSS }), top, stage, bar, foot, live);
      el.appendChild(root);
      const sf = surface(stage, def.title, () => draw());
      const say = m => { live.textContent = ''; live.textContent = m; ctx.announce?.(m); };

      const cur = () => hist[hist.length - 1];
      const level = () => def.levels[lvl];
      function load_(i, keep) {
        lvl = clamp(i, 0, N - 1);
        hist = [def.init(level())]; ui = def.newUi ? def.newUi() : {}; hintAct = null; hints = 0; done = false;
        card.hidden = true;
        save(def.game, { level: lvl });
        refresh();
        onScore(0);
        if (!keep) say(`Level ${lvl + 1}, par ${level().par}.`);
      }
      function refresh() {
        levelV.textContent = String(lvl + 1); parV.textContent = String(level().par); movesV.textContent = String(hist.length - 1);
        prevBtn.disabled = lvl === 0; nextBtn.disabled = lvl >= N - 1;
        undoBtn.disabled = hist.length < 2 || done; hintBtn.disabled = done;
        bestV.textContent = bests[lvl] ? `best ${bests[lvl]}` : '';
        draw();
      }
      function draw() {
        if (dead) return;
        sf.begin();
        const g = sf.g;
        g.clearRect(0, 0, sf.w, sf.h);
        def.draw(g, sf.w, sf.h, level(), cur(), { hint: hintAct, ui, reduced, solved: done, hue: def.hue });
      }
      function act(a) {
        if (done || a == null) return false;
        const next = def.apply(level(), cur(), a);
        if (!next) { return false; }
        hist.push(next); hintAct = null;
        const n = hist.length - 1;
        onScore(n);
        if (def.solved(level(), next)) win(n);
        refresh();
        return true;
      }
      function win(n) {
        done = true;
        const par = level().par;
        if (!hints && (!bests[lvl] || n < bests[lvl])) { bests[lvl] = n; save(def.game, { best: bests }); }
        /* Play again on the result card then opens the next level */
        save(def.game, { level: Math.min(N - 1, lvl + 1) });
        const msg = n === par ? `Solved in ${n} moves: par!` : `Solved in ${n} moves (par ${par})`;
        card.hidden = false; card.textContent = '';
        card.append(msg, h('small', { text: lvl < N - 1 ? 'Press PageDown or the arrow for the next level' : 'That was the last level: try for par on the rest' }));
        say(msg);
        kept = n;
        {
          onEnd({ score: n, won: true, detail: `Level ${lvl + 1} · ${n} moves, par ${par}${n === par ? ' (par)' : ''}${hints ? ` · ${hints} hint${hints === 1 ? '' : 's'}` : ''}`, ...(hints ? { assisted: true } : {}) });
        }
      }
      function undo() {
        if (done || hist.length < 2) return;
        hist.pop(); hintAct = null; ui = def.newUi ? def.newUi() : {};
        onScore(hist.length - 1);
        refresh();
      }
      function hint() {
        if (done) return;
        const a = def.hint(level(), cur());
        if (a == null) { say('No way to finish from here: take a move back.'); return; }
        hints++; hintAct = a;
        say(def.hintText ? def.hintText(a) : 'Hint shown.');
        draw();
      }
      const restart = () => load_(lvl, true);

      L.on(prevBtn, 'click', () => load_(lvl - 1));
      L.on(nextBtn, 'click', () => load_(lvl + 1));
      L.on(undoBtn, 'click', undo); L.on(hintBtn, 'click', hint); L.on(resetBtn, 'click', restart);
      L.on(window, 'keydown', e => {
        if (!ownsKey(el, e)) return;
        const c = e.code;
        if (c === 'KeyU' || c === 'KeyZ' || c === 'Backspace') { e.preventDefault(); undo(); return; }
        if (c === 'KeyH') { e.preventDefault(); hint(); return; }
        if (c === 'KeyR') { e.preventDefault(); restart(); return; }
        if (c === 'PageUp') { e.preventDefault(); load_(lvl - 1); return; }
        if (c === 'PageDown') { e.preventDefault(); load_(lvl + 1); return; }
        const a = def.keyAction(c, level(), cur(), ui);
        if (a !== undefined) e.preventDefault();
        if (a == null || !act(a)) draw();
      });
      L.on(sf.cv, 'pointerdown', e => {
        if (e.button > 0) return;
        e.preventDefault(); stage.focus({ preventScroll: true });
        const r = sf.cv.getBoundingClientRect();
        const a = def.pointerAction(e.clientX - r.left, e.clientY - r.top, sf.w, sf.h, level(), cur(), ui);
        if (a == null || !act(a)) draw();
      });
      load_(lvl, true);
      stage.focus({ preventScroll: true });

      return {
        stop() { if (dead) return; dead = true; L.clear(); sf.destroy(); root.remove(); },
        pause() { /* nothing runs on its own: there is nothing to stop */ },
        resume() { draw(); },
        peek: () => ({
          level: lvl, par: level().par, moves: hist.length - 1, solved: done, hints, hint: hintAct, best: bests[lvl] || 0, kept,
          ...def.peek?.(level(), cur(), ui),
        }),
        hook(cmd, a) { if (cmd === 'level') { load_(Number(a) || 0, true); return true; } return false; },
      };
    },
  };
}
