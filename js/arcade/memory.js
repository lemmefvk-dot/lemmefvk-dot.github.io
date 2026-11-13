/* ============================================================
   arcade/memory.js — Memory: 16 cards, 8 pairs.

   Flip two cards; a pair stays up, anything else turns back over.
   One player: score = moves (one move = two cards turned), lower is
   better; the clock is shown for interest but is not the score.
   Two players take turns on the same screen; finding a pair earns
   another turn, and whoever holds more pairs at the end wins (the
   result names the winner, or a draw).

   Every card is a real <button> with a spoken label ("Card 6, row 2
   column 2, face down" → "Card 6, star"), arrow keys move between
   cards and Enter/Space turns one over, and a live region reads each
   outcome. With two cards showing that don't match, turning a third
   card flips them back straight away — nobody has to wait out the
   reveal timer.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';

const SIZE = 4;
const REVEAL_MS = 900;

/* shape + hue both differ, so no pair relies on colour alone */
const SYMBOLS = [
  { icon: 'heart', name: 'heart', hue: '#fb7185' },
  { icon: 'star', name: 'star', hue: '#fbbf24' },
  { icon: 'zap', name: 'lightning bolt', hue: '#a3e635' },
  { icon: 'music', name: 'music note', hue: '#c084fc' },
  { icon: 'moon', name: 'moon', hue: '#cbd5e1' },
  { icon: 'flame', name: 'flame', hue: '#fb923c' },
  { icon: 'droplet', name: 'water drop', hue: '#22d3ee' },
  { icon: 'globe', name: 'globe', hue: '#60a5fa' },
];
const P2 = '#38bdf8';

const CSS = `
.arx-mem{position:relative;width:100%;height:100%;min-height:340px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-4,12px);padding:var(--sp-5,16px);
  box-sizing:border-box;font-family:var(--font,system-ui);color:var(--ink-1,#eee);container-type:size;user-select:none;-webkit-user-select:none}
.arx-mem *{box-sizing:border-box}
.arx-mem__top{width:min(100%,calc(100cqh - 96px),640px);display:flex;align-items:stretch;gap:var(--sp-3,8px)}
.arx-mem__stat{flex:1;padding:var(--sp-3,8px) var(--sp-4,12px);border-radius:var(--r-md,11px);background:var(--fill-0,rgba(255,255,255,.03));border:1px solid var(--line-0,rgba(255,255,255,.05));min-width:0}
.arx-mem__stat span{display:block;font-size:var(--fs-10,10px);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arx-mem__stat b{display:block;font-size:clamp(15px,3.4cqmin,22px);font-weight:700;color:var(--ink-0,#fff);font-variant-numeric:tabular-nums;white-space:nowrap}
.arx-mem__stat b small{font-size:.62em;font-weight:600;color:var(--ink-2,#aaa);margin-left:2px}
.arx-mem__pl{--pc:var(--ga);position:relative;transition:border-color .2s,background .2s}
.arx-mem__pl span{display:flex;align-items:center;gap:6px}
.arx-mem__pl span::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--pc);flex:0 0 auto}
.arx-mem__pl.is-turn{border-color:color-mix(in srgb,var(--pc) 65%,transparent);background:color-mix(in srgb,var(--pc) 14%,transparent)}
.arx-mem__pl.is-turn span{color:var(--ink-0,#fff)}
.arx-mem__pl.is-p2{--pc:${P2}}
.arx-mem__pl b{display:flex;align-items:baseline;gap:2px}
.arx-mem__turn{margin-left:auto;align-self:center;font-style:normal;font-size:var(--fs-10,10px);font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  padding:3px 7px;border-radius:99px;background:var(--pc);color:var(--accent-ink,#fff)}
.arx-mem__pl.is-p2 .arx-mem__turn{color:#04121c}
.arx-mem__board{position:relative;width:min(100%,calc(100cqh - 96px),640px);aspect-ratio:1;display:grid;grid-template-columns:repeat(${SIZE},1fr);gap:clamp(6px,1.6cqmin,12px);perspective:900px}
.arx-mem__card{position:relative;border:0;padding:0;background:none;border-radius:var(--r-lg,15px);cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.arx-mem__card:focus-visible{outline:3px solid var(--ink-0,#fff);outline-offset:3px}
.arx-mem__in{position:absolute;inset:0;transform-style:preserve-3d;transition:transform .42s cubic-bezier(.3,1.25,.5,1);border-radius:inherit}
.arx-mem__card.is-up .arx-mem__in{transform:rotateY(180deg)}
.arx-mem__side{position:absolute;inset:0;border-radius:inherit;backface-visibility:hidden;-webkit-backface-visibility:hidden;display:grid;place-items:center;overflow:hidden}
.arx-mem__back{border:1px solid color-mix(in srgb,var(--ga) 45%,transparent);
  background:
    radial-gradient(circle at 30% 20%,rgba(255,255,255,.18),transparent 55%),
    repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0 6px,transparent 6px 12px),
    linear-gradient(150deg,color-mix(in srgb,var(--ga) 85%,#fff 0%),color-mix(in srgb,var(--ga) 55%,#000));
  box-shadow:0 6px 16px -8px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.2)}
.arx-mem__back .icon{width:28%;height:28%;color:rgba(255,255,255,.55)}
@media (hover:hover){.arx-mem__card:hover:not(.is-up) .arx-mem__back{filter:brightness(1.1)}}
/* card faces are dark tiles in every theme: the pale symbols (moon) need it */
.arx-mem__face{transform:rotateY(180deg);background:#1a1016;border:1px solid color-mix(in srgb,var(--sym) 45%,transparent);
  background-image:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--sym) 26%,transparent),transparent 70%)}
.arx-mem__face .icon{width:48%;height:48%;color:var(--sym);filter:drop-shadow(0 0 10px color-mix(in srgb,var(--sym) 55%,transparent))}
.arx-mem__face .icon svg{stroke-width:2}
.arx-mem__card.is-done .arx-mem__face{border-color:var(--sym);box-shadow:0 0 0 1px var(--sym),0 0 22px -4px color-mix(in srgb,var(--sym) 70%,transparent)}
.arx-mem__card.is-done{cursor:default}
.arx-mem__card.is-miss .arx-mem__face{border-color:#f87171}
.arx-mem__own{position:absolute;right:7px;top:7px;width:9px;height:9px;border-radius:50%;background:var(--pc,var(--ga));box-shadow:0 0 0 2px #1a1016}
.arx-mem.is-reduced .arx-mem__in{transition:none}
.arx-mem__end{position:absolute;inset:-6px;display:grid;place-items:center;pointer-events:none;border-radius:var(--r-xl,20px);
  background:radial-gradient(closest-side,rgba(0,0,0,.45),rgba(0,0,0,.12))}
.arx-mem__endcard{pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:6px;padding:var(--sp-6,20px) var(--sp-7,28px);border-radius:var(--r-xl,20px);text-align:center;
  background:rgba(22,13,19,.94);border:1px solid rgba(255,255,255,.12);box-shadow:var(--sh-4,0 30px 80px rgba(0,0,0,.6));color:#fff;
  -webkit-backdrop-filter:var(--blur-2,blur(20px));backdrop-filter:var(--blur-2,blur(20px));max-width:90%}
.arx-mem__kicker{font-size:var(--fs-11,11px);letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--ga)}
.arx-mem__big{font-size:clamp(30px,8cqmin,56px);font-weight:800;letter-spacing:-.03em;line-height:1.05;color:#fff;font-variant-numeric:tabular-nums}
.arx-mem__sub{font-size:var(--fs-13,13px);color:rgba(255,255,255,.7)}
.arx-mem.is-reduced .arx-mem__pl{transition:none}
@container (max-width:520px){.arx-mem{padding:var(--sp-3,8px);gap:var(--sp-3,8px)}.arx-mem__stat{padding:6px 8px}.arx-mem__top,.arx-mem__board{width:min(100%,calc(100cqh - 80px))}}
`;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clock = ms => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const two = Number(ctx.players) === 2;

    let dead = false, paused = false, over = false;
    const deck = shuffle([...SYMBOLS.keys(), ...SYMBOLS.keys()]);
    const up = new Set();        // face up, not yet matched
    const done = new Set();      // matched
    const owner = [];            // who found each matched card (2P)
    let showing = null;          // [a, b] a mismatched pair on display
    let hideTimer = 0, ticker = 0;
    let moves = 0;
    let turn = 0;                // 0 = player 1, 1 = player 2
    const pairs = [0, 0];
    let startAt = 0, banked = 0, started = false;
    const offs = [];
    const listen = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); };

    /* ---- header ---- */
    const statBox = (label, cls = '') => { const b = h('b', '0'); const s = h('span', { text: label }); return [h('div.arx-mem__stat' + cls, s, b), b, s]; };
    let top, vMoves, vPairs, vTime, pl = [];
    if (two) {
      const a = statBox('Player 1', '.arx-mem__pl');
      const b = statBox('Player 2', '.arx-mem__pl.is-p2');
      pl = [a, b];
      const [sM, vM] = statBox('Moves');
      vMoves = vM;
      top = h('div.arx-mem__top', a[0], b[0], sM);
    } else {
      const [sM, vM] = statBox('Moves');
      const [sP, vP] = statBox('Pairs');
      const [sT, vT] = statBox('Time');
      vMoves = vM; vPairs = vP; vTime = vT;
      top = h('div.arx-mem__top', sM, sP, sT);
    }

    const live = h('div', { 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' } });
    const cards = deck.map((sym, i) => {
      const S = SYMBOLS[sym];
      const btn = h('button.arx-mem__card', { type: 'button', dataset: { i: String(i) }, style: { '--sym': S.hue } },
        h('span.arx-mem__in',
          h('span.arx-mem__side.arx-mem__back', icon('diamond')),
          h('span.arx-mem__side.arx-mem__face', icon(S.icon))));
      return btn;
    });
    const board = h('div.arx-mem__board', { role: 'group', 'aria-label': 'Memory cards, 4 by 4' }, cards);
    const reduced = !!ctx.reduced || document.body.classList.contains('reduce-motion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const root = h('div.arx-mem' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, board, live);
    el.appendChild(root);

    const say = msg => { live.textContent = ''; live.textContent = msg; };
    const elapsed = () => banked + (started && !over && !paused ? performance.now() - startAt : 0);

    function label(i) {
      const S = SYMBOLS[deck[i]];
      const where = `row ${Math.floor(i / SIZE) + 1} column ${(i % SIZE) + 1}`;
      if (done.has(i)) return `Card ${i + 1}, ${S.name}, matched${two ? ` by player ${owner[i] + 1}` : ''}`;
      if (up.has(i)) return `Card ${i + 1}, ${S.name}`;
      return `Card ${i + 1}, ${where}, face down`;
    }

    function paintCard(i) {
      const c = cards[i];
      const isUp = up.has(i) || done.has(i);
      c.classList.toggle('is-up', isUp);
      c.classList.toggle('is-done', done.has(i));
      c.classList.toggle('is-miss', !!showing && showing.includes(i));
      c.setAttribute('aria-label', label(i));
      c.setAttribute('aria-disabled', done.has(i) || up.has(i) ? 'true' : 'false');
      const face = c.querySelector('.arx-mem__face');
      face.querySelector('.arx-mem__own')?.remove();
      if (two && done.has(i)) face.appendChild(h('i.arx-mem__own', { style: { '--pc': owner[i] ? P2 : 'var(--ga)' } }));
    }

    function paintTop() {
      vMoves.textContent = String(moves);
      if (two) {
        pl.forEach(([box, val, lab], p) => {
          const mine = !over && turn === p;
          /* (replaceChildren would print a null child as the text "null") */
          val.replaceChildren(...[String(pairs[p]), h('small', { text: pairs[p] === 1 ? 'pair' : 'pairs' }),
            mine ? h('em.arx-mem__turn', { text: 'Turn' }) : null].filter(Boolean));
          box.classList.toggle('is-turn', mine);
          box.setAttribute('aria-label', `Player ${p + 1}, ${pairs[p]} ${pairs[p] === 1 ? 'pair' : 'pairs'}${mine ? ', their turn' : ''}`);
        });
      } else {
        vPairs.replaceChildren(String(done.size / 2), h('small', { text: `/ ${deck.length / 2}` }));
        vTime.textContent = clock(elapsed());
      }
    }

    function flipBack() {
      clearTimeout(hideTimer); hideTimer = 0;
      if (!showing) return;
      const [a, b] = showing;
      showing = null;
      up.delete(a); up.delete(b);
      paintCard(a); paintCard(b);
      if (two) {
        turn = 1 - turn;
        say(`Player ${turn + 1}'s turn`);
      }
      paintTop();
    }

    function flip(i) {
      if (dead || paused || over) return;
      if (showing) flipBack();
      if (done.has(i) || up.has(i)) return;
      if (!started) { started = true; startAt = performance.now(); if (!two) ticker = setInterval(() => { if (!dead && !paused && !over) paintTop(); }, 500); }
      up.add(i);
      paintCard(i);
      if (up.size < 2) { say(`${SYMBOLS[deck[i]].name}`); return; }

      const [a, b] = [...up];
      moves++;
      if (deck[a] === deck[b]) {
        up.clear();
        done.add(a); done.add(b);
        owner[a] = owner[b] = turn;
        pairs[turn]++;
        paintCard(a); paintCard(b);
        paintTop();
        onScore(moves);
        if (done.size === deck.length) return finish();
        say(`Match, ${SYMBOLS[deck[a]].name}.${two ? ` Player ${turn + 1} goes again.` : ''}`);
      } else {
        showing = [a, b];
        paintCard(a); paintCard(b);
        paintTop();
        onScore(moves);
        say(`${SYMBOLS[deck[a]].name} and ${SYMBOLS[deck[b]].name}, no match.`);
        hideTimer = setTimeout(flipBack, REVEAL_MS);
      }
    }

    function finish() {
      banked = elapsed();
      over = true;
      clearInterval(ticker); ticker = 0;
      paintTop();
      const time = clock(banked);
      let kicker, big, sub, detail, winner = 0;
      if (two) {
        winner = pairs[0] === pairs[1] ? 0 : pairs[0] > pairs[1] ? 1 : 2;
        kicker = 'All pairs found';
        big = winner ? `Player ${winner} wins` : 'It’s a draw';
        sub = `${pairs[0]}–${pairs[1]} in pairs · ${moves} moves`;
        detail = winner ? `Player ${winner} wins ${Math.max(...pairs)}–${Math.min(...pairs)} · ${moves} moves` : `Draw ${pairs[0]}–${pairs[1]} · ${moves} moves`;
      } else {
        kicker = 'Solved';
        big = `${moves} moves`;
        sub = `${deck.length / 2} pairs in ${time}${moves === deck.length / 2 ? ' · a perfect game' : ''}`;
        detail = `${deck.length / 2} pairs in ${moves} moves · ${time}`;
      }
      const endCard = h('div.arx-mem__end', h('div.arx-mem__endcard', { role: 'status' },
        h('div.arx-mem__kicker', { text: kicker }),
        h('div.arx-mem__big', { text: big, style: two && winner === 2 ? { color: P2 } : null }),
        h('div.arx-mem__sub', { text: sub })));
      board.appendChild(endCard);
      say(`${big}. ${sub}.`);
      onEnd({ score: moves, won: true, detail, winner: two ? winner : undefined, pairs: two ? pairs.slice() : undefined, ms: Math.round(banked) });
    }

    listen(board, 'click', e => {
      const c = e.target.closest?.('.arx-mem__card');
      if (!c || !board.contains(c)) return;
      flip(Number(c.dataset.i));
    });
    /* arrow keys walk the grid; Home/End jump to the ends */
    function neighbour(i, key) {
      const r = Math.floor(i / SIZE), col = i % SIZE;
      if (key === 'ArrowRight') return r * SIZE + Math.min(SIZE - 1, col + 1);
      if (key === 'ArrowLeft') return r * SIZE + Math.max(0, col - 1);
      if (key === 'ArrowDown') return Math.min(SIZE - 1, r + 1) * SIZE + col;
      if (key === 'ArrowUp') return Math.max(0, r - 1) * SIZE + col;
      if (key === 'Home') return 0;
      if (key === 'End') return deck.length - 1;
      return null;
    }
    listen(board, 'keydown', e => {
      const c = e.target.closest?.('.arx-mem__card');
      if (!c) return;
      const n = neighbour(Number(c.dataset.i), e.key);
      if (n == null) return;
      e.preventDefault();
      cards[n].focus();
    });

    /* Keys that never pass through a card: after a pause the Arcade
       focuses its own stage, and the controller bridge (core/padmap.js)
       dispatches straight to window, where neither the grid's keydown nor
       a button's native Enter/Space can see them. From there an arrow
       walks on from the focused card (or brings focus back to the last
       one), and Space/Enter turn the focused card over — so a D-pad and
       the A button play the whole game. */
    let lastCard = 0;
    listen(board, 'focusin', e => { const c = e.target.closest?.('.arx-mem__card'); if (c) lastCard = Number(c.dataset.i); });
    listen(window, 'keydown', e => {
      if (dead || paused || over) return;
      if (e.target instanceof Node && board.contains(e.target)) return;   // the card's own handlers have it
      const act = e.key === ' ' || e.key === 'Enter';
      if (!act && neighbour(0, e.key) == null) return;
      if (!ownsKey(root, e)) return;
      e.preventDefault();
      const at = cards.indexOf(document.activeElement);
      if (at < 0) { cards[lastCard].focus({ preventScroll: true }); return; }
      if (act) { if (!e.repeat) flip(at); return; }
      cards[neighbour(at, e.key)].focus({ preventScroll: true });
    });

    cards.forEach((_, i) => paintCard(i));
    paintTop();
    if (two) say('Player 1 starts.');
    requestAnimationFrame(() => { if (!dead) cards[0].focus({ preventScroll: true }); });

    return {
      stop() {
        if (dead) return;
        dead = true;
        clearTimeout(hideTimer); clearInterval(ticker);
        offs.splice(0).forEach(off => off());
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        if (started && !over) banked += performance.now() - startAt;
        paused = true;
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        if (started && !over) startAt = performance.now();
      },
    };
  },
};

/* Keys reach the game only while its window is the active one and focus
   is not parked on some other control (a shell button, a text field).
   The controller bridge (core/padmap.js) dispatches its synthetic keys
   straight to window, so for those the focused element stands in for
   the target (Node.contains(window) would throw). */
function ownsKey(root, e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (!root.isConnected || !root.getClientRects().length) return false;
  const win = root.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target instanceof Element ? e.target : document.activeElement;
  if (!t || t === document.body || t === document.documentElement || root.contains(t)) return true;
  if (t.closest('input,textarea,select,button,a[href],[contenteditable="true"],[role="button"]')) return false;
  return !win || win.contains(t);
}
