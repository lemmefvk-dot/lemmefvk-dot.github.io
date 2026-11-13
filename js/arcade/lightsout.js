/* ============================================================
   arcade/lightsout.js — Lights Out for Static Arcade.

   A 5×5 grid of lights. Pressing a light flips it and its up, down,
   left and right neighbours. Switch every light off.

   Levels: each level is a fixed puzzle, made by pressing a few
   random cells (chosen by the level's seed) on a dark board, so
   every level is solvable by construction; later levels use more
   presses. "Show solution" solves the board you have right now by
   Gaussian elimination over GF(2) (pressing a cell twice cancels,
   so a solution is a set of cells) and marks the cells to press,
   choosing the shortest of the four solutions a 5×5 board allows.

   Controls
     mouse / touch  press a light
     keyboard       arrows move · Space / Enter presses · H solution
   Score = moves taken to clear the level, lower is better. The
   fewest moves per level and the level you reached are kept on this
   device (portal.arcadePuzzles.lightsout).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, rng } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';

const GAME = 'lightsout';
const N = 5, CELLS = N * N;

/* ---------- rules (pure) ---------- */
/* bitmask (25 bits) of what pressing cell i flips */
const PRESS = Array.from({ length: CELLS }, (_, i) => {
  const r = Math.floor(i / N), c = i % N;
  let m = 1 << i;
  if (r > 0) m |= 1 << (i - N);
  if (r < N - 1) m |= 1 << (i + N);
  if (c > 0) m |= 1 << (i - 1);
  if (c < N - 1) m |= 1 << (i + 1);
  return m;
});
export const pressMask = i => PRESS[i];
const pop = x => { let k = 0; while (x) { x &= x - 1; k++; } return k; };

/* Solve A·x = b over GF(2), where column i of A is PRESS[i]. Returns the
   press set (bitmask) of the fewest presses, or null when unsolvable. */
export function solve(board) {
  /* rows of the augmented matrix: row r holds, for each press i, whether it flips light r */
  const rows = [];
  for (let r = 0; r < CELLS; r++) {
    let m = 0;
    for (let i = 0; i < CELLS; i++) if (PRESS[i] >> r & 1) m |= 1 << i;
    rows.push({ m, b: board >> r & 1 });
  }
  const pivotOf = new Array(CELLS).fill(-1);
  let rank = 0;
  for (let col = 0; col < CELLS && rank < CELLS; col++) {
    let p = -1;
    for (let r = rank; r < CELLS; r++) if (rows[r].m >> col & 1) { p = r; break; }
    if (p < 0) continue;
    [rows[rank], rows[p]] = [rows[p], rows[rank]];
    for (let r = 0; r < CELLS; r++) if (r !== rank && rows[r].m >> col & 1) { rows[r].m ^= rows[rank].m; rows[r].b ^= rows[rank].b; }
    pivotOf[col] = rank++;
  }
  for (let r = rank; r < CELLS; r++) if (rows[r].b) return null;     /* 0 = 1: no solution */
  const free = [];
  for (let col = 0; col < CELLS; col++) if (pivotOf[col] < 0) free.push(col);
  let best = null, bestN = 99;
  for (let f = 0; f < 1 << free.length; f++) {       /* every setting of the free variables */
    let x = 0;
    free.forEach((col, k) => { if (f >> k & 1) x |= 1 << col; });
    for (let col = 0; col < CELLS; col++) {
      if (pivotOf[col] < 0) continue;
      const row = rows[pivotOf[col]];
      let v = row.b;
      for (const fc of free) if ((row.m >> fc & 1) && (x >> fc & 1)) v ^= 1;
      if (v) x |= 1 << col;
    }
    const k = pop(x);
    if (k < bestN) { bestN = k; best = x; }
  }
  return best;
}
export const applyPress = (board, i) => board ^ PRESS[i];
export const applyPresses = (board, set) => { for (let i = 0; i < CELLS; i++) if (set >> i & 1) board ^= PRESS[i]; return board; };

/* level n: the same puzzle for everyone */
export function makeLevel(level) {
  const r = rng(7919 * level + 13);
  const presses = Math.min(14, 3 + Math.floor((level - 1) * 0.7));
  for (let tries = 0; tries < 50; tries++) {
    let board = 0, set = 0;
    while (pop(set) < presses) set |= 1 << Math.floor(r() * CELLS);
    board = applyPresses(0, set);
    if (board) return board;
  }
  return PRESS[12];
}

const CSS = `${BASE}
.pz-lo__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-lo__board{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(5,1fr);gap:calc(100cqmin * .02);
  padding:calc(100cqmin * .02);border-radius:14px;background:#0d0f16;border:2px solid var(--line-2,rgba(255,255,255,.22));outline:none;touch-action:none}
.pz-lo__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-lo__c{position:relative;border:0;border-radius:12px;cursor:pointer;padding:0;background:#222736;box-shadow:inset 0 -3px 0 rgba(0,0,0,.35)}
.pz-lo__c.is-on{background:radial-gradient(circle at 35% 30%,#fff6b8,#ffc933 55%,#e08a00);box-shadow:0 0 18px rgba(255,200,50,.55),inset 0 -3px 0 rgba(0,0,0,.25)}
.pz-lo__c.is-cur{outline:3px solid var(--ga);outline-offset:1px}
.pz-lo__c.is-sol::after{content:"";position:absolute;left:50%;top:50%;width:30%;height:30%;margin:-15% 0 0 -15%;border-radius:50%;background:#3ad1ff;box-shadow:0 0 0 3px rgba(0,0,0,.45)}
.pz:not(.is-reduced) .pz-lo__c{transition:background .12s,box-shadow .12s}
.pz-lo__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);border-radius:12px;text-align:center;padding:16px}
.pz-lo__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-lo__card span{font-size:13px;color:var(--ink-2,#bbb)}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    let dead = false, paused = false;
    const sv = load(GAME);
    const bests = { ...(sv.best || {}) };
    let level = Math.max(1, Math.min(999, Number(sv.level) || 1));
    let board = 0, moves = 0, done = false, showSol = false, cur = 12, kbd = false, msg = '', hints = 0;
    let nodes = [];

    const levelV = h('span', { text: '1' });
    const levelRead = h('div.pz__read', { title: 'Level', 'aria-label': 'Level' }, icon('layers'), levelV);
    const movesV = h('span', { text: '0' });
    const movesRead = h('div.pz__read', { title: 'Moves', 'aria-label': 'Moves' }, icon('grid'), movesV);
    const bestV = h('small', { text: '' });
    const prevBtn = h('button.pz__btn', { type: 'button', title: 'Previous level' }, icon('chevron-left'));
    const nextBtn = h('button.pz__btn', { type: 'button', title: 'Next level' }, icon('chevron-right'));
    const solBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Show solution (H)' }, icon('sparkles'), h('span.pz__long', { text: 'Show solution' }));
    const resetBtn = h('button.pz__btn', { type: 'button', title: 'Start this level again' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', prevBtn, levelRead, nextBtn, movesRead, bestV, solBtn, resetBtn);
    const grid = h('div.pz-lo__board', { role: 'grid', tabindex: '0', 'aria-label': 'Lights Out board' });
    const bw = h('div.pz-lo__bw', grid);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, bw, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'a press flips a light and its four neighbours · <kbd>←↑↓→</kbd> + <kbd>Space</kbd> · <kbd>H</kbd> shows the solution' }));

    for (let i = 0; i < CELLS; i++) {
      const b = h('button.pz-lo__c', { type: 'button', role: 'gridcell', dataset: { i }, tabindex: '-1' });
      L.on(b, 'click', () => { if (!dead) { kbd = false; cur = i; press(i); } });
      nodes.push(b); grid.appendChild(b);
    }
    function paint() {
      const sol = showSol && !done ? solve(board) : null;
      nodes.forEach((b, i) => {
        b.classList.toggle('is-on', !!(board >> i & 1));
        b.classList.toggle('is-sol', !!(sol && sol >> i & 1));
        b.classList.toggle('is-cur', kbd && cur === i);
        b.setAttribute('aria-label', `Row ${Math.floor(i / N) + 1}, column ${i % N + 1}, ${board >> i & 1 ? 'on' : 'off'}${sol && sol >> i & 1 ? ', press here' : ''}`);
      });
      levelV.textContent = String(level);
      movesV.textContent = String(moves);
      bestV.textContent = bests[level] != null ? `Best: ${bests[level]} moves` : '';
      solBtn.setAttribute('aria-pressed', String(showSol));
      prevBtn.disabled = level <= 1;
    }
    function start(lv = level, custom = null) {
      level = lv;
      board = custom != null ? custom : makeLevel(level);
      moves = 0; done = false; paused = false; showSol = false; hints = 0; msg = '';
      bw.querySelector('.pz__cover')?.remove(); bw.querySelector('.pz-lo__card')?.remove();
      save(GAME, { level });
      paint();
      say(`Level ${level}: switch every light off.`);
    }
    const can = () => !dead && !paused && !done;
    function press(i) {
      if (!can()) return false;
      board = applyPress(board, i);
      moves++;
      paint();
      if (!board) win();
      return true;
    }
    function win() {
      done = true; showSol = false;
      const prev = bests[level], fresh = prev == null || moves < prev;
      if (fresh) { bests[level] = moves; save(GAME, { best: bests }); }
      save(GAME, { level: level + 1 > (sv.level || 1) ? level + 1 : sv.level });
      paint();
      bw.appendChild(h('div.pz-lo__card', h('div', h('b', { text: 'Lights out!' }),
        h('span', { text: `Level ${level} in ${moves} moves${fresh ? (prev == null ? '' : ' — a new best') : ''}. Play again for level ${level + 1}.` }))));
      say(`Level ${level} cleared in ${moves} moves.`);
      onScore(moves);
      onEnd({ score: moves, won: true, detail: `Level ${level}${hints ? ' · solution shown' : ''}` });
    }
    const toggleSol = () => { if (!can()) return; showSol = !showSol; if (showSol) hints++; paint(); say(showSol ? 'Blue dots mark a shortest set of cells to press, in any order.' : 'Solution hidden.'); };

    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };   /* a Space aimed at the game must not also click the button you last used */
    const MOVE = { ArrowUp: -N, ArrowDown: N, ArrowLeft: -1, ArrowRight: 1 };
    L.on(window, 'keydown', e => {
      if (!can() || !ownsKey(root, e)) return;
      const k = e.key;
      if (MOVE[k]) {
        e.preventDefault(); kbd = true;
        const r = Math.floor(cur / N), c = cur % N;
        if ((k === 'ArrowLeft' && c === 0) || (k === 'ArrowRight' && c === N - 1)) return paint();
        const nx = cur + MOVE[k];
        if (nx >= 0 && nx < CELLS) cur = nx;
        paint();
      } else if (k === ' ') { e.preventDefault(); unfocus(); if (!e.repeat) { kbd = true; press(cur); } }
      else if (k === 'h' || k === 'H') { e.preventDefault(); toggleSol(); }
    });
    L.on(solBtn, 'click', toggleSol);
    L.on(resetBtn, 'click', () => { if (!dead) start(level); });
    L.on(prevBtn, 'click', () => { if (!dead && level > 1) start(level - 1); });
    L.on(nextBtn, 'click', () => { if (!dead) start(level + 1); });

    start(level);
    requestAnimationFrame(() => { if (!dead) grid.focus({ preventScroll: true }); });
    onScore(0);

    return {
      stop() { if (dead) return; dead = true; L.clear(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); },
      peek: () => ({
        level, board, lights: Array.from({ length: CELLS }, (_, i) => board >> i & 1), moves, done, paused, showSolution: showSol,
        solution: solve(board), hints, best: { ...bests }, solvable: solve(board) !== null,
      }),
      /* test hook — nothing in the game calls it: level(n) · board(bitmask) */
      hook(cmd, arg) {
        if (cmd === 'level') start(arg);
        else if (cmd === 'board') start(level, arg);
        return true;
      },
    };
  },
};
