/* ============================================================
   arcade/tileslide.js — Tile Slide Race for Static Arcade.

   Push a whole row or column of a 5 × 5 board one step (the tile
   that falls off one end comes back on the other) to line up three
   or more of a colour. Lines clear, new tiles drop in, and a clear
   that sets up another is a chain that pays more. Twenty moves; the
   score is points (rules in ./tileslide-logic.js).

   Controls
     mouse / touch  drag a tile: sideways pushes its row, up or down
                    pushes its column
     keyboard       arrows move the cursor · W A S D push the cursor's
                    row or column (Shift + an arrow does the same)
   Every tile carries a shape as well as a colour, and the Arcade's
   colour-blind colours (ctx.palette 'cb') swap the colours.

   One screen, two players (ctx.players 2): the same seeded board
   twice. Player 1 plays their twenty moves, then player 2 plays the
   very same board, and the higher score wins.

   ONLINE RACE (ctx.online.kit, js/arcade/race.js): the room's seed
   deals both of you the same board and the same refills. Twenty
   moves each, the higher score wins; the Arcade's race strip shows
   both scores as you go.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { rng, ownsKey, sounder } from './kit.js';
import { CSS as BASE, reducedMotion, bag } from './puzzlekit.js';
import { PALETTE_CB } from './index.js';
import { N, MOVES, newGame, push } from './tileslide-logic.js';

const COLORS = ['#ff4d6d', '#3b9cff', '#2fd36b', '#ffd23f', '#c77dff'];
const CB = [PALETTE_CB[5], PALETTE_CB[1], PALETTE_CB[2], PALETTE_CB[3], PALETTE_CB[6]];
const SHAPES = ['●', '■', '▲', '◆', '★'];
const NAMES = ['red', 'blue', 'green', 'yellow', 'purple'];
const CB_NAMES = ['orange-red', 'sky blue', 'green', 'yellow', 'pink'];

const CSS = `${BASE}
.pz-ts__bw{position:relative;flex:1 1 auto;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-ts__board{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(${N},1fr);grid-template-rows:repeat(${N},1fr);gap:5px;padding:6px;border-radius:14px;background:#0d0f16;border:2px solid var(--line-2,rgba(255,255,255,.22));touch-action:none;outline:none}
.pz-ts__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-ts__t{display:grid;place-items:center;border-radius:12px;font:800 clamp(18px,7cqmin,40px)/1 var(--font,system-ui);color:rgba(0,0,0,.55);cursor:grab;transition:transform .12s}
.pz-ts__t.is-cur{outline:3px solid #fff;outline-offset:-3px}
.pz-ts__t.is-pop{animation:pz-ts-pop .28s ease-out}
.pz-ts__t.is-hit{transform:translateX(0)}
.pz-ts__board.is-reduced .pz-ts__t,.pz.is-reduced .pz-ts__t{transition:none;animation:none}
@keyframes pz-ts-pop{0%{transform:scale(1.18);filter:brightness(1.5)}100%{transform:scale(1)}}
.pz-ts__card{pointer-events:none;position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.82);border-radius:12px;text-align:center;padding:16px}
.pz-ts__card button{pointer-events:auto}
.pz-ts__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-ts__card span{font-size:13px;color:var(--ink-2,#bbb)}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    const RACE = ctx.online?.kit && Number.isInteger(ctx.online.seed) ? ctx.online : null;
    const TWO = !RACE && ctx.players === 2;
    const seed = RACE ? RACE.seed >>> 0 : Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : (rng(Date.now() >>> 0)() * 2 ** 32) >>> 0;
    let dead = false, paused = false, over = false, who = 0, cursor = 12, g = newGame(seed), t0 = performance.now();
    const totals = [null, null];
    let endT = 0, msg = '', drag = null;
    const cb = () => ctx.palette === 'cb';

    const movesV = h('span', { text: String(MOVES) });
    const scoreV = h('span', { text: '0' });
    const chainV = h('span', { text: '0' });
    const read = (label, ic, v) => h('div.pz__read', { title: label, 'aria-label': label }, icon(ic), v);
    const turnV = h('div.pz__read', { hidden: !TWO, title: 'Whose turn' }, icon('user'), h('span', { text: 'Player 1' }));
    const top = h('div.pz__top', turnV, read('Moves left', 'refresh', movesV), read('Score', 'sparkles', scoreV), read('Best chain', 'link', chainV));
    const board = h('div.pz-ts__board' + (reduced ? '.is-reduced' : ''), { tabindex: '0', role: 'application', 'aria-label': 'Tile Slide board' });
    const tiles = Array.from({ length: N * N }, (_, i) => h('div.pz-ts__t', { role: 'img', dataset: { i } }));
    board.append(...tiles);
    const bw = h('div.pz-ts__bw', board);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, bw, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'drag a tile to push its row or column · <kbd>←↑↓→</kbd> move · <kbd>W A S D</kbd> push' }));

    function paint(popped = []) {
      const pal = cb() ? CB : COLORS;
      tiles.forEach((t, i) => {
        const c = g.cells[i];
        t.style.background = pal[c];
        t.textContent = SHAPES[c];
        t.setAttribute('aria-label', `${cb() ? CB_NAMES[c] : NAMES[c]} ${SHAPES[c]}, row ${Math.floor(i / N) + 1} column ${(i % N) + 1}`);
        t.classList.toggle('is-cur', i === cursor && !over);
        t.classList.remove('is-pop');
      });
      if (!reduced) for (const i of popped) { tiles[i].offsetWidth; tiles[i].classList.add('is-pop'); }
      movesV.textContent = String(g.left);
      scoreV.textContent = String(g.score);
      chainV.textContent = String(g.bestChain);
      board.setAttribute('aria-label', `Tile Slide board. ${g.left} moves left, ${g.score} points.`);
    }

    function newBoard() {
      g = newGame(seed);
      over = false; msg = ''; t0 = performance.now();
      bw.querySelector('.pz-ts__card')?.remove();
      paint();
      onScore(0);
      RACE?.progress(0);
      paintFoot();
    }

    function move(axis, index, dir) {
      if (dead || paused || over) return false;
      const r = push(g, axis, index, dir);
      if (!r.ok) return false;
      const hit = r.steps.flatMap(s => s.cells);
      paint(hit);
      if (r.gained) {
        snd.wake(); snd.blip(380 + 90 * r.steps.length, 0.09, 'triangle', 0.8, 620 + 90 * r.steps.length);
        say(`${hit.length} tiles cleared${r.steps.length > 1 ? `, a chain of ${r.steps.length}` : ''}: +${r.gained}.`);
      } else { snd.wake(); snd.blip(200, 0.05, 'sine', 0.4); say('Nothing lined up.'); }
      onScore(g.score);
      RACE?.progress((g.moves - g.left) / g.moves);
      if (g.left <= 0) endT = setTimeout(finish, reduced ? 80 : 450);
      return true;
    }

    function finish() {
      if (dead || over) return;
      over = true;
      const detail = `${g.score} points · ${g.cleared} tiles cleared · best chain ${g.bestChain}`;
      if (RACE) {
        bw.appendChild(h('div.pz-ts__card', h('div', h('b', { text: 'Done!' }), h('span', { text: `${detail}. Waiting for the result…` }))));
        onEnd({ score: g.score, won: true, detail, race: { done: true, ms: Math.round(performance.now() - t0), sc: g.score, n: g.cleared, p: 1 } });
        return;
      }
      if (TWO) {
        totals[who] = g.score;
        if (who === 0) {
          bw.appendChild(h('div.pz-ts__card', h('div', h('b', { text: `Player 1: ${g.score}` }),
            h('span', { text: 'Now player 2 plays the very same board.' }), h('div', h('button.pz__btn', { type: 'button', dataset: { act: 'p2' }, onclick: () => { who = 1; turnV.lastChild.textContent = 'Player 2'; newBoard(); focusBoard(); } }, 'Start player 2')))));
          paint();
          return;
        }
        const [a, b] = totals;
        const text = a === b ? `A draw, ${a} each.` : `Player ${a > b ? 1 : 2} wins, ${Math.max(a, b)} to ${Math.min(a, b)}.`;
        bw.appendChild(h('div.pz-ts__card', h('div', h('b', { text: a === b ? 'A draw' : `Player ${a > b ? 1 : 2} wins` }), h('span', { text: text }))));
        onEnd({ score: null, detail: text });
        return;
      }
      bw.appendChild(h('div.pz-ts__card', h('div', h('b', { text: `${g.score} points` }), h('span', { text: detail }))));
      onEnd({ score: g.score, won: true, detail });
    }

    const focusBoard = () => board.focus({ preventScroll: true });
    const DIRS = { KeyA: ['r', -1], KeyD: ['r', 1], KeyW: ['c', -1], KeyS: ['c', 1] };
    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      if (ARROWS[e.code] && !e.shiftKey) {
        e.preventDefault();
        if (paused || over) return;
        const [dx, dy] = ARROWS[e.code];
        const x = Math.max(0, Math.min(N - 1, (cursor % N) + dx)), y = Math.max(0, Math.min(N - 1, Math.floor(cursor / N) + dy));
        cursor = y * N + x; paint();
      } else if (ARROWS[e.code] && e.shiftKey) {
        e.preventDefault();
        const [dx, dy] = ARROWS[e.code];
        if (dx) move('r', Math.floor(cursor / N), dx); else move('c', cursor % N, dy);
      } else if (DIRS[e.code]) {
        e.preventDefault();
        if (e.repeat) return;
        const [axis, dir] = DIRS[e.code];
        move(axis, axis === 'r' ? Math.floor(cursor / N) : cursor % N, dir);
      }
    });
    /* a drag on a tile: the dominant direction pushes that tile's row or column */
    const tileAt = e => { const t = e.target.closest?.('.pz-ts__t'); return t ? Number(t.dataset.i) : -1; };
    L.on(board, 'pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const i = tileAt(e);
      if (i < 0) return;
      cursor = i; paint(); focusBoard();
      drag = { i, x: e.clientX, y: e.clientY, id: e.pointerId };
      try { board.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
    });
    const release = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      const dx = e.clientX - d.x, dy = e.clientY - d.y, size = tiles[0].getBoundingClientRect().width || 40;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < size * 0.3) return;
      if (Math.abs(dx) >= Math.abs(dy)) move('r', Math.floor(d.i / N), dx > 0 ? 1 : -1);
      else move('c', d.i % N, dy > 0 ? 1 : -1);
    };
    L.on(board, 'pointerup', release);
    L.on(board, 'pointercancel', () => { drag = null; });

    paint(); paintFoot();
    onScore(0);
    requestAnimationFrame(() => { if (!dead) focusBoard(); });

    return {
      stop() { if (dead) return; dead = true; clearTimeout(endT); L.clear(); snd.close(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; drag = null; if (!over) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); focusBoard(); },
      peek: () => ({
        seed, cells: g.cells.slice(), left: g.left, moves: g.moves, score: g.score, cleared: g.cleared, bestChain: g.bestChain, cursor, over, paused,
        player: who + 1, two: TWO, totals: totals.slice(), log: g.log.map(m => m.slice()), palette: cb() ? 'cb' : 'standard',
        race: RACE ? { seed: RACE.seed } : null,
        geom: tiles.map(t => { const r = t.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }),
      }),
    };
  },
};
