/* ============================================================
   arcade/colorflood.js — Color Flood for Static Arcade.

   A board of coloured squares. Everything joined to the top-left
   square by one colour is the flood. Pick a colour and the whole
   flood takes it, swallowing every square of that colour that
   touches it. Fill the board with one colour in as few moves as you
   can: the score is your moves, lower is better.

   Par is the fewest moves there are, worked out by the search in
   ./flood-logic.js (never guessed), and shown beside your moves; a
   win at par or under gets a star. Three sizes (6×6 with 4 colours,
   9×9 with 5, 10×10 with 6) each keep their own fewest moves.

   TODAY: a board dealt from the date alone (dailykit.js), the same
   for everyone, 10×10 with 6 colours. Solving it moves the streak on
   (kept on this device). The board is the same all day, so you may
   try again; the streak counts the first win.

   Controls
     mouse / touch  the colour buttons under the board
     keyboard       1–6 pick a colour · ← → move along the colours,
                    Space / Enter plays it · U or Z undo · R restart
                    · N a new board
   With the Arcade's colour-blind colours on (ctx.palette 'cb') every
   colour also carries its own shape, on the board and on its button.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, randomSeed } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag, clock, fmtTime } from './puzzlekit.js';
import * as daily from './dailykit.js';
import { makeBoard, play, floodOf, isDone, solve } from './flood-logic.js';
import { PALETTE_CB } from './index.js';

const GAME = 'colorflood';
export const SIZES = {
  small: { n: 6, k: 4, label: 'Small', tip: '6×6, four colours' },
  medium: { n: 9, k: 5, label: 'Medium', tip: '9×9, five colours' },
  large: { n: 10, k: 6, label: 'Large', tip: '10×10, six colours' },
};
export const DAILY = { n: 10, k: 6 };
/** today's board: the same for everyone on this date */
export const dailyBoard = (day = daily.dayKey()) => ({ day, seed: daily.daySeed(GAME, day), ...DAILY, cells: makeBoard(daily.daySeed(GAME, day), DAILY.n, DAILY.k) });

const STANDARD = ['#ff5c7a', '#ffb02e', '#ffe44d', '#43d17a', '#3ab6ff', '#a37bff'];
const CB = [PALETTE_CB[0], PALETTE_CB[1], PALETTE_CB[2], PALETTE_CB[3], PALETTE_CB[5], PALETTE_CB[6]];
const SHAPES = ['●', '■', '▲', '◆', '★', '✚'];

const CSS = `${BASE}
.pz-cf__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-cf__board{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;gap:calc(100cqmin * .006);padding:calc(100cqmin * .012);
  border-radius:12px;background:#0d0f16;border:2px solid var(--line-2,rgba(255,255,255,.22));touch-action:manipulation}
.pz-cf__c{display:grid;place-items:center;border-radius:calc(100cqmin * .012);font-weight:800;color:rgba(0,0,0,.62);line-height:1;container-type:size;overflow:hidden}
.pz-cf__c.is-in{box-shadow:inset 0 0 0 calc(100cqmin * .004) rgba(255,255,255,.75)}
.pz-cf__c.is-origin::after{content:"";width:34%;height:34%;border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.45)}
.pz:not(.is-reduced) .pz-cf__c{transition:background-color .14s}
.pz-cf__pal{width:min(100%,520px);display:flex;gap:var(--sp-2,6px);justify-content:center;flex:0 0 auto}
.pz-cf__p{flex:1 1 0;max-width:80px;height:46px;border-radius:12px;border:2px solid rgba(255,255,255,.18);cursor:pointer;font:800 15px/1 var(--font,system-ui);color:rgba(0,0,0,.7);display:grid;place-items:center;position:relative}
.pz-cf__p small{position:absolute;left:6px;top:4px;font-size:10px;font-weight:700;opacity:.75}
.pz-cf__p:disabled{opacity:.3;cursor:default}
.pz-cf__p.is-cur{outline:3px solid var(--ga);outline-offset:2px}
.pz-cf__p:focus-visible{outline:3px solid var(--ga);outline-offset:2px}
.pz-cf__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);border-radius:12px;text-align:center;padding:16px}
.pz-cf__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-cf__card span{font-size:13px;color:var(--ink-2,#bbb)}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const sv = load(GAME);
    const bests = { ...(sv.best || {}) };
    let dead = false, paused = false;
    let size = SIZES[sv.size] ? sv.size : 'medium';
    let day = '';                                   /* the date of today's board while it is on the table */
    let n = 9, k = 5, cells = [], start = [], hist = [], par = 0, exact = true, done = false, cur = 0, msg = '', ended = false, thinking = 0;
    const clk = clock(secs => { timeV.textContent = fmtTime(secs); });

    /* ---------- chrome ---------- */
    const sizeBtns = Object.entries(SIZES).map(([id, s]) => h('button', { type: 'button', dataset: { size: id }, 'aria-pressed': 'false', title: s.tip }, s.label));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Board size' }, sizeBtns);
    const dayStreak = h('small');
    const dayBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', dataset: { act: 'daily' }, title: 'Today’s board: the same one for everyone today' }, icon('calendar'), h('span', { text: 'Today' }), dayStreak);
    const movesV = h('span', { text: '0' });
    const parV = h('small', { text: '' });
    const movesRead = h('div.pz__read', { title: 'Moves (par: the fewest moves that fill this board)', 'aria-label': 'Moves' }, icon('grid'), movesV, parV);
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const bestV = h('small', { text: '' });
    const newBtn = h('button.pz__btn', { type: 'button', title: 'Deal a new board (N)' }, icon('refresh'), h('span.pz__long', { text: 'New' }));
    const undoBtn = h('button.pz__btn', { type: 'button', title: 'Take back the last move (U)' }, icon('rotate-ccw'), h('span.pz__long', { text: 'Undo' }));
    const resetBtn = h('button.pz__btn', { type: 'button', title: 'Start this board again (R)' }, icon('rotate-ccw'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', seg, dayBtn, movesRead, timeRead, bestV);
    const bar = h('div.pz__bar', undoBtn, resetBtn, newBtn);
    const grid = h('div.pz-cf__board', { role: 'img', 'aria-label': 'Color Flood board' });
    const bw = h('div.pz-cf__bw', grid);
    const pal = h('div.pz-cf__pal', { role: 'group', 'aria-label': 'Colours' });
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, bw, pal, bar, foot, live);
    el.appendChild(root);
    let nodes = [], pBtns = [];
    const cb = () => ctx.palette === 'cb';
    const colourOf = c => (cb() ? CB : STANDARD)[c];

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'pick a colour: the flood grows · <kbd>1</kbd>–<kbd>6</kbd> pick · <kbd>U</kbd> undo · <kbd>R</kbd> restart' }));

    function build() {
      grid.style.gridTemplateColumns = `repeat(${n},1fr)`;
      grid.style.gridTemplateRows = `repeat(${n},1fr)`;
      nodes = Array.from({ length: n * n }, () => grid.appendChild(h('div.pz-cf__c')));
      pBtns = Array.from({ length: k }, (_, c) => {
        const b = h('button.pz-cf__p', { type: 'button', dataset: { c }, 'aria-label': `Colour ${c + 1}` }, h('small', { text: String(c + 1) }), h('span'));
        L.on(b, 'click', () => { if (!dead) { cur = c; pick(c); } });
        return b;
      });
      grid.replaceChildren(...nodes);
      pal.replaceChildren(...pBtns);
    }
    const sig = () => `${n}x${k}`;
    let built = '';
    function paint() {
      if (built !== sig()) { built = sig(); build(); }
      const fl = new Set(floodOf(cells, n)), shapes = cb();
      nodes.forEach((d, i) => {
        d.style.backgroundColor = colourOf(cells[i]);
        d.className = 'pz-cf__c' + (fl.has(i) ? ' is-in' : '') + (i === 0 ? ' is-origin' : '');
        const t = shapes && i !== 0 ? SHAPES[cells[i]] : '';
        if (d.textContent !== t) d.textContent = t;
        if (shapes) d.style.fontSize = `${Math.max(8, 70 / n)}cqmin`;
      });
      pBtns.forEach((b, c) => {
        b.style.backgroundColor = colourOf(c);
        b.disabled = done || c === cells[0];
        b.classList.toggle('is-cur', c === cur);
        b.lastChild.textContent = shapes ? SHAPES[c] : '';
        b.setAttribute('aria-label', `Colour ${c + 1}${shapes ? ` (${['circle', 'square', 'triangle', 'diamond', 'star', 'cross'][c]})` : ''}${c === cells[0] ? ', the flood is this colour' : ''}`);
      });
      movesV.textContent = String(hist.length);
      parV.textContent = par ? `${exact ? 'par' : 'target'} ${par}` : (thinking ? 'working out par…' : '');
      const key = day ? `d:${day}` : size;
      bestV.textContent = !day && bests[size] != null ? `Best: ${bests[size]} moves` : '';
      void key;
      sizeBtns.forEach(b => b.setAttribute('aria-pressed', String(!day && b.dataset.size === size)));
      const st = daily.status(GAME);
      dayBtn.setAttribute('aria-pressed', String(!!day));
      const sk = st.streak ? `s${st.streak}` : st.solved ? 'ok' : '';
      if (dayStreak.dataset.k !== sk) { dayStreak.dataset.k = sk; dayStreak.replaceChildren(...(st.streak ? [icon('flame'), String(st.streak)] : st.solved ? [icon('check')] : [])); }
      dayBtn.title = `Today’s board: the same one for everyone today${st.solved ? ' · solved' : ''}${st.streak ? ` · ${st.streak}-day streak on this device` : ''}${st.best ? ` · best streak ${st.best}` : ''}`;
      undoBtn.disabled = !hist.length || done;
    }

    /* par: the search is quick, but give the board a frame to show first */
    let parTimer = 0;
    function work(forCells) {
      par = 0; thinking++;
      clearTimeout(parTimer);
      parTimer = setTimeout(() => {
        thinking = Math.max(0, thinking - 1);
        if (dead || forCells !== start) return;
        const r = solve(start, n);
        par = r.par; exact = r.exact;
        paint();
        if (!done) say(`${day ? `Today’s board (${daily.weekday(day)})` : `A ${n}×${n} board`}, ${k} colours. ${exact ? 'Par' : 'A good line'} is ${par} moves.`);
      }, 20);
      paint();
    }
    function deal(board = null) {
      clearTimeout(parTimer);
      if (board) { ({ n, k } = board); cells = board.cells.slice(); day = board.day || ''; }
      else { ({ n, k } = SIZES[size]); cells = makeBoard(randomSeed(), n, k); day = ''; }
      start = cells.slice(); hist = []; done = false; ended = false; paused = false; msg = '';
      bw.querySelector('.pz__cover')?.remove(); bw.querySelector('.pz-cf__card')?.remove();
      clk.dispose(); clk.secs = 0; timeV.textContent = '0:00';
      if (cur >= k) cur = 0;
      onScore(0);
      work(start);
      say(`A fresh ${n}×${n} board with ${k} colours. Working out par…`);
    }
    const setSize = id => { if (dead || !SIZES[id]) return; size = id; save(GAME, { size }); deal(); };
    const playDaily = () => { if (!dead) deal(dailyBoard()); };

    const can = () => !dead && !paused && !done;
    function pick(c) {
      if (!can() || c < 0 || c >= k || c === cells[0]) return false;
      if (!hist.length) clk.start();
      hist.push(cells);
      cells = play(cells, n, c);
      onScore(hist.length);
      paint();
      if (isDone(cells)) win(); else say(`${floodOf(cells, n).length} of ${n * n} squares are flooded.`);
      return true;
    }
    function win() {
      done = true; clk.stop();
      const moves = hist.length, inPar = par > 0 && moves <= par;
      const prev = bests[size], fresh = !day && (prev == null || moves < prev);
      if (fresh) { bests[size] = moves; save(GAME, { best: bests }); }
      let extra = '';
      if (day) {
        const r = daily.solved(GAME, day, clk.secs, 0);
        extra = r.already ? ' You had already solved today’s board, so the streak stays as it was.' : ` Streak: ${r.streak} day${r.streak === 1 ? '' : 's'}.`;
        const dm = { ...(load(GAME).dmoves || {}) };
        if (dm[day] == null || moves < dm[day]) { dm[day] = moves; save(GAME, { dmoves: dm }); }
      }
      paint();
      const line = par ? (inPar ? `In par: ${par} is the fewest moves there are.` : `${exact ? 'Par' : 'A good line'} is ${par}: ${moves - par} more.`) : '';
      bw.appendChild(h('div.pz-cf__card', h('div', h('b', { text: inPar ? 'Flooded, in par!' : 'Flooded!' }),
        h('span', { text: `${moves} moves in ${fmtTime(clk.secs)}${fresh && prev != null ? ' — a new best' : ''}. ${line}${extra}` }))));
      say(`Flooded in ${moves} moves. ${line}${extra}`);
      onScore(moves);
      if (!ended) { ended = true; onEnd({ score: moves, won: true, detail: `${day ? `Today’s board` : `${SIZES[size].label} ${n}×${n}`} · ${par ? `${exact ? 'par' : 'target'} ${par}` : 'no par'}${inPar ? ' (in par)' : ''}`, ...(day ? { assisted: 'Today’s board counts for your streak, not your best' } : {}) }); }
    }
    function undo() {
      if (!can() || !hist.length) return;
      cells = hist.pop();
      onScore(hist.length);
      paint(); say('Last move taken back.');
    }
    function restart() { if (dead) return; const b = day ? { n, k, cells: start, day } : { n, k, cells: start }; clearTimeout(parTimer); cells = b.cells.slice(); hist = []; done = false; ended = false; paused = false; clk.dispose(); clk.secs = 0; timeV.textContent = '0:00'; bw.querySelector('.pz-cf__card')?.remove(); bw.querySelector('.pz__cover')?.remove(); onScore(0); paint(); say('Same board, from the start.'); }

    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      const key = e.key;
      if (/^[1-9]$/.test(key) && !e.repeat) { const c = +key - 1; if (c < k) { e.preventDefault(); unfocus(); cur = c; pick(c); } return; }
      if (!can()) return;
      if (key === 'ArrowRight' || key === 'ArrowLeft') { e.preventDefault(); cur = (cur + (key === 'ArrowRight' ? 1 : k - 1)) % k; paint(); }
      else if (key === ' ' || key === 'Enter') { e.preventDefault(); unfocus(); if (!e.repeat) pick(cur); }
      else if (key === 'u' || key === 'U' || key === 'z' || key === 'Z' || key === 'Backspace') { e.preventDefault(); undo(); }
      else if (key === 'r' || key === 'R') { e.preventDefault(); restart(); }
      else if (key === 'n' || key === 'N') { e.preventDefault(); deal(); }
    });
    sizeBtns.forEach(b => L.on(b, 'click', () => setSize(b.dataset.size)));
    L.on(dayBtn, 'click', playDaily);
    L.on(newBtn, 'click', () => { if (!dead) { if (day) { size = SIZES[size] ? size : 'medium'; } deal(); } });
    L.on(undoBtn, 'click', undo);
    L.on(resetBtn, 'click', restart);

    deal();
    onScore(0);

    return {
      stop() { if (dead) return; dead = true; clearTimeout(parTimer); clk.dispose(); L.clear(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; clk.stop(); if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); if (hist.length && !done) clk.start(); },
      peek: () => ({
        size, n, k, cells: cells.slice(), start: start.slice(), flood: floodOf(cells, n).length, moves: hist.length, par, exact, done, paused, day: day || null,
        best: { ...bests }, palette: cb() ? 'cb' : 'standard', thinking: thinking > 0, secs: clk.secs, daily: daily.status(GAME),
      }),
      /* test hook — nothing in the game calls it: board({ cells, n, k }) deals that exact board */
      hook(cmd, arg) {
        if (cmd === 'board' && arg && Array.isArray(arg.cells)) { size = SIZES[arg.size] ? arg.size : size; deal({ n: arg.n, k: arg.k, cells: arg.cells, day: arg.day || '' }); }
        return true;
      },
    };
  },
};
