/* ============================================================
   arcade/numberchain.js — Number Chain for Static Arcade.

   Join neighbouring digits that add up to ten before the minute
   runs out. Pick two to four squares in a path, each touching the
   one before along a side: the moment they add to ten they clear,
   the squares above fall and new digits come in. Clears that follow
   each other within three seconds build a combo. Rules and points are
   in ./numberchain-logic.js; the score is points.

   Controls
     mouse / touch  press a square, then press its neighbours one by
                    one, or drag across them · press the first square
                    again to let go of the path
     keyboard       arrows move the cursor · Space or Enter picks the
                    square under it · Backspace lets go of the path
   A path that goes over ten is dropped. The digits are also written
   in words for a screen reader, and the Arcade's big-text option
   enlarges them (ctx.bigText).

   ONLINE RACE (ctx.online.kit, js/arcade/race.js): the room's seed
   deals both of you the same digits, a minute each, and the higher
   score wins. The Arcade's race strip shows both scores as you go.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { rng, ownsKey, sounder } from './kit.js';
import { CSS as BASE, reducedMotion, bag } from './puzzlekit.js';
import { W, H, TARGET, COMBO_MS, newGame, check, clear, areNeighbours, findMove } from './numberchain-logic.js';

export const SECONDS = 60;
const HUES = [0, 205, 150, 45, 280, 20, 175, 330, 100];

const CSS = `${BASE}
.pz-nc__bw{position:relative;flex:1 1 auto;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-nc__board{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(${W},1fr);grid-template-rows:repeat(${H},1fr);gap:5px;padding:6px;border-radius:14px;background:#0d0f16;border:2px solid var(--line-2,rgba(255,255,255,.22));touch-action:none;outline:none}
.pz-nc__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-nc__c{display:grid;place-items:center;border-radius:11px;font:800 clamp(18px,7cqmin,38px)/1 var(--font,system-ui);color:#10131c;cursor:pointer}
.pz-nc__board.is-big .pz-nc__c{font-size:clamp(24px,9cqmin,50px)}
.pz-nc__c.is-sel{outline:3px solid #fff;outline-offset:-3px;filter:brightness(1.25)}
.pz-nc__c.is-cur::after{content:"";position:absolute}
.pz-nc__c.is-cur{box-shadow:inset 0 0 0 2px var(--ga)}
.pz-nc__c.is-pop{animation:pz-nc-pop .25s ease-out}
.pz-nc__board.is-bad{animation:pz-nc-bad .2s}
.pz-nc.is-reduced .pz-nc__c,.pz-nc.is-reduced .pz-nc__board{animation:none}
@keyframes pz-nc-pop{0%{transform:scale(.7);opacity:.4}100%{transform:scale(1);opacity:1}}
@keyframes pz-nc-bad{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.pz-nc__card{pointer-events:none;position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.82);border-radius:12px;text-align:center;padding:16px}
.pz-nc__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-nc__card span{font-size:13px;color:var(--ink-2,#bbb)}
.pz-nc__sum{min-width:90px}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    const RACE = ctx.online?.kit && Number.isInteger(ctx.online.seed) ? ctx.online : null;
    const seed = RACE ? RACE.seed >>> 0 : Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : (rng(Date.now() >>> 0)() * 2 ** 32) >>> 0;
    const g = newGame(seed);
    let dead = false, paused = false, over = false, cursor = 0, path = [], msg = '';
    let left = SECONDS * 1000, lastTick = performance.now(), lastClear = -1e9, combo = 0, tickT = 0, endT = 0, down = false;

    const timeV = h('span', { text: `${SECONDS}` });
    const scoreV = h('span', { text: '0' });
    const sumV = h('span', { text: '0' });
    const comboV = h('span', { text: '' });
    const read = (label, ic, v, cls = '') => h('div.pz__read' + cls, { title: label, 'aria-label': label }, icon(ic), v);
    const top = h('div.pz__top', read('Time left, in seconds', 'clock', timeV), read('Score', 'sparkles', scoreV), read(`Sum of the squares you picked (aim for ${TARGET})`, 'plus', sumV, '.pz-nc__sum', ), comboV);
    const cells = Array.from({ length: W * H }, (_, i) => h('div.pz-nc__c', { role: 'button', dataset: { i } }));
    const board = h('div.pz-nc__board' + (ctx.bigText ? '.is-big' : ''), { tabindex: '0', role: 'application', 'aria-label': 'Number Chain board' }, ...cells);
    const bw = h('div.pz-nc__bw', board);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz.pz-nc' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } }, h('style', { text: CSS }), top, bw, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: `join neighbours that add up to ${TARGET} · <kbd>←↑↓→</kbd> move · <kbd>Space</kbd> picks · <kbd>Backspace</kbd> lets go` }));
    const sumOf = () => path.reduce((a, i) => a + g.cells[i], 0);

    function paint(fresh = []) {
      cells.forEach((c, i) => {
        const v = g.cells[i];
        c.textContent = String(v);
        c.style.background = `hsl(${HUES[v - 1]},70%,${path.includes(i) ? 72 : 62}%)`;
        c.classList.toggle('is-sel', path.includes(i));
        c.classList.toggle('is-cur', i === cursor && !over);
        c.setAttribute('aria-label', `${v}, row ${Math.floor(i / W) + 1} column ${(i % W) + 1}${path.includes(i) ? ', picked' : ''}`);
        c.setAttribute('aria-pressed', String(path.includes(i)));
        c.classList.remove('is-pop');
      });
      if (!reduced) for (const i of fresh) { cells[i].offsetWidth; cells[i].classList.add('is-pop'); }
      scoreV.textContent = String(g.score);
      sumV.textContent = String(sumOf());
      comboV.replaceChildren(combo > 0 ? h('div.pz__read', { title: 'Clears in a row inside three seconds' }, icon('zap'), h('span', { text: `×${combo + 1}` })) : '');
      timeV.textContent = String(Math.max(0, Math.ceil(left / 1000)));
    }

    function bad(text) {
      path = [];
      snd.blip(150, 0.08, 'sawtooth', 0.4);
      if (!reduced) { board.classList.remove('is-bad'); board.offsetWidth; board.classList.add('is-bad'); }
      say(text);
      paint();
    }

    /* the one way a square joins the path (a click, a drag, or the keyboard) */
    function pick(i, drag = false) {
      if (dead || paused || over || i < 0 || i >= W * H) return;
      snd.wake();
      const last = path[path.length - 1];
      if (path.length >= 2 && path[path.length - 2] === i) { path.pop(); paint(); return; }      /* back over the last square: take it off */
      if (path.includes(i)) { if (!drag && path.length === 1 && path[0] === i) { path = []; say('Let go.'); paint(); } return; }
      if (last === undefined || (!drag && !areNeighbours(last, i))) path = [i];
      else if (areNeighbours(last, i)) path.push(i);
      else return;
      const sum = sumOf();
      if (sum === TARGET && path.length >= 2) return finishPath();
      if (sum > TARGET) return bad(`${sum} is over ${TARGET}: the path is dropped.`);
      if (path.length >= 4) return bad('Four squares and still not ten: the path is dropped.');
      snd.blip(300 + 40 * sum, 0.04, 'sine', 0.5);
      say(`${sum} so far.`);
      paint();
    }

    function finishPath() {
      const now = performance.now();
      combo = now - lastClear <= COMBO_MS ? combo + 1 : 0;
      lastClear = now;
      const used = path.slice();
      const r = clear(g, used, combo);
      path = [];
      if (!r.ok) return bad('That is not a ten.');
      paint(used);
      snd.blip(520 + 70 * Math.min(6, combo), 0.1, 'triangle', 0.9, 880 + 70 * Math.min(6, combo));
      say(`Ten! +${r.gained}${combo ? `, combo ×${combo + 1}` : ''}${r.redealt ? '. No ten was left, so the board was dealt again' : ''}.`);
      onScore(g.score);
    }

    function tick() {
      if (dead || paused || over) { lastTick = performance.now(); return; }
      const now = performance.now();
      left -= now - lastTick;
      lastTick = now;
      if (combo > 0 && now - lastClear > COMBO_MS) { combo = 0; paint(); }
      timeV.textContent = String(Math.max(0, Math.ceil(left / 1000)));
      RACE?.progress(1 - Math.max(0, left) / (SECONDS * 1000));
      if (left <= 0) finish();
    }

    function finish() {
      if (over) return;
      over = true; left = 0; path = []; paint();
      const detail = `${g.score} points · ${g.pairs} tens${g.longest > 2 ? ` · longest ${g.longest} squares` : ''}`;
      bw.appendChild(h('div.pz-nc__card', h('div', h('b', { text: RACE ? 'Time!' : `${g.score} points` }), h('span', { text: RACE ? `${detail}. Waiting for the result…` : detail }))));
      say('Time is up.');
      onEnd({ score: g.score, won: true, detail, ...(RACE ? { race: { done: true, ms: SECONDS * 1000, sc: g.score, n: g.pairs, p: 1 } } : {}) });
    }

    /* keyboard */
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      const A = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
      if (A) {
        e.preventDefault();
        if (paused || over) return;
        cursor = Math.max(0, Math.min(H - 1, Math.floor(cursor / W) + A[1])) * W + Math.max(0, Math.min(W - 1, (cursor % W) + A[0]));
        paint();
      } else if (e.code === 'Space' || e.code === 'Enter') {
        if (e.code === 'Enter') return;                  /* Enter belongs to the Arcade's play-again */
        e.preventDefault();
        if (!e.repeat) pick(cursor);
      } else if (e.code === 'Backspace') {
        e.preventDefault();
        if (path.length) { path = []; say('Let go.'); paint(); }
      }
    });
    /* pointer: a press picks; dragging over neighbours adds them */
    const cellOf = e => { const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.pz-nc__c'); return t && board.contains(t) ? Number(t.dataset.i) : -1; };
    L.on(board, 'pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const i = cellOf(e);
      if (i < 0) return;
      e.preventDefault();
      cursor = i; down = true;
      board.focus({ preventScroll: true });
      try { board.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
      pick(i);
    });
    L.on(board, 'pointermove', e => {
      if (!down) return;
      const i = cellOf(e);
      if (i >= 0 && i !== path[path.length - 1] && path.length) { cursor = i; pick(i, true); }
    });
    const up = () => { down = false; };
    L.on(board, 'pointerup', up);
    L.on(board, 'pointercancel', up);

    tickT = setInterval(tick, 100);
    paint(); paintFoot(); onScore(0);
    requestAnimationFrame(() => { if (!dead) board.focus({ preventScroll: true }); });

    return {
      stop() { if (dead) return; dead = true; clearInterval(tickT); clearTimeout(endT); L.clear(); snd.close(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; down = false; if (!over) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; lastTick = performance.now(); bw.querySelector('.pz__cover')?.remove(); board.focus({ preventScroll: true }); },
      peek: () => ({
        seed, cells: g.cells.slice(), path: path.slice(), sum: sumOf(), score: g.score, pairs: g.pairs, longest: g.longest, combo, left: Math.ceil(left / 1000),
        over, paused, cursor, move: findMove(g.cells), race: RACE ? { seed: RACE.seed } : null,
        geom: cells.map(c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }),
      }),
      /* test hook — nothing in the game calls it: time(seconds left) */
      hook(cmd, a) {
        if (cmd === 'time') { left = Math.max(0, Number(a) || 0) * 1000; lastTick = performance.now(); return true; }
        return false;
      },
    };
  },
};
