/* ============================================================
   arcade/sliding.js — Sliding Puzzle for Static Arcade.

   Put the numbered tiles in order, blank last, on a 3×3, 4×4, 5×5
   or 6×6 board. Every shuffle is a solvable one: tiles are shuffled
   at random and the permutation parity is checked against the
   board's width and the blank's row (the classic rule); an
   unsolvable shuffle is fixed by swapping two tiles.

   Tiles: plain numbers, or a picture cut into tiles (one of the
   scenes drawn in code for Photo Jigsaw, ./jigsaw-art.js, cropped
   square), each still carrying its number small in a corner.

   Controls
     mouse / touch  click a tile: it slides into the blank, and
                    every tile between it and the blank (same row
                    or column) slides with it
     keyboard       arrows slide a tile that way (← slides the tile
                    to the right of the blank left, and so on)
   Score = seconds from your first move to the finished board, lower
   is better. The game also keeps your fewest moves, per size
   (portal.arcadePuzzles.sliding). The clock stands still while paused.

   ONLINE RACE (ctx.online.kit, js/arcade/race.js): the standard 4×4
   with numbers, shuffled from the room's seed, so both screens get the
   same board; the clock runs from the start, size, picture and Shuffle
   are hidden, nothing is saved. Fewest moves wins, then the faster.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, rng, randomSeed } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { PICTURES, drawPicture, isPicture } from './jigsaw-art.js';

const GAME = 'sliding';
const SIZES = { 3: '3×3', 4: '4×4', 5: '5×5', 6: '6×6' };
/* a drawn scene, cropped to the middle square: the picture the tiles are cut from */
function squarePicture(id, side = 720) {
  const src = drawPicture(id, 1280, 960);
  if (!src) return '';
  const c = document.createElement('canvas');
  c.width = c.height = side;
  c.getContext('2d').drawImage(src, 160, 0, 960, 960, 0, 0, side, side);
  return c.toDataURL('image/jpeg', 0.86);
}

/* ---------- rules (pure) ---------- */
export const solvedBoard = n => Array.from({ length: n * n }, (_, i) => (i + 1) % (n * n));   /* 1…n²-1, then 0 = blank */
export const isSolved = t => t.every((v, i) => v === (i + 1) % t.length);
/* the classic test: count inversions among the tiles; on an odd-width board
   the count must be even, on an even-width board the inversions plus the
   blank's row from the bottom (1-based) must be odd */
export function solvable(t, n) {
  const a = t.filter(v => v);
  let inv = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (a[i] > a[j]) inv++;
  if (n % 2 === 1) return inv % 2 === 0;
  const rowFromBottom = n - Math.floor(t.indexOf(0) / n);
  return (inv + rowFromBottom) % 2 === 1;
}
export function shuffled(n, seed) {
  const r = rng(seed);
  let t;
  do {
    t = solvedBoard(n);
    for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
    if (!solvable(t, n)) {                       /* swap two tiles (not the blank) to flip the parity */
      const a = t.findIndex(v => v), b = t.findIndex((v, i) => v && i !== a);
      [t[a], t[b]] = [t[b], t[a]];
    }
  } while (isSolved(t));
  return t;
}
/* the tiles (indexes) that slide when index i is chosen: from i toward the blank, or [] */
export function slideSet(t, n, i) {
  const z = t.indexOf(0), r = Math.floor(i / n), c = i % n, zr = Math.floor(z / n), zc = z % n;
  if (i === z || (r !== zr && c !== zc)) return [];
  const step = r === zr ? (zc > c ? 1 : -1) : (zr > r ? n : -n);
  const out = [];
  for (let k = i; k !== z; k += step) out.push(k);
  return out;
}
export function slide(t, n, i) {                  /* returns the new board, or null */
  const set = slideSet(t, n, i);
  if (!set.length) return null;
  const u = t.slice();
  let to = t.indexOf(0);
  for (let k = set.length - 1; k >= 0; k--) { u[to] = t[set[k]]; to = set[k]; }
  u[to] = 0;
  return u;
}

const CSS = `${BASE}
.pz-sl__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.pz-sl__board{--n:4;position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(var(--n),1fr);grid-template-rows:repeat(var(--n),1fr);gap:calc(100cqmin * .012);
  padding:calc(100cqmin * .012);border-radius:14px;background:var(--bg-sl,#14161f);border:2px solid var(--line-2,rgba(255,255,255,.22));outline:none;touch-action:none;container-type:size}
.pz-sl__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-sl__t{display:grid;place-items:center;border:0;border-radius:10px;cursor:pointer;color:#fff;font:800 calc(100cqw / var(--n) * .42)/1 var(--font,system-ui);
  background:hsl(var(--th) 62% 46%);box-shadow:inset 0 -4px 0 rgba(0,0,0,.25),inset 0 2px 0 rgba(255,255,255,.25);text-shadow:0 1px 2px rgba(0,0,0,.4);padding:0}
.pz-sl__t.is-ok{box-shadow:inset 0 -4px 0 rgba(0,0,0,.25),inset 0 0 0 3px rgba(255,255,255,.5)}
.pz-sl__t.is-blank{visibility:hidden;pointer-events:none}
.pz-sl__board.is-pic .pz-sl__t{position:relative;background-image:var(--pic);background-size:calc(var(--n) * 100%) calc(var(--n) * 100%);background-color:#222;color:transparent;text-shadow:none;border-radius:6px}
.pz-sl__board.is-pic .pz-sl__t::after{content:attr(data-v);position:absolute;left:5%;top:4%;min-width:1.3em;padding:1px 3px;border-radius:5px;background:rgba(0,0,0,.55);color:#fff;font:700 calc(100cqw / var(--n) * .16)/1.2 var(--font,system-ui);text-align:center}
.pz-sl__board.is-pic.is-done .pz-sl__t::after{display:none}
.pz-sl__t:focus-visible{outline:2px solid #fff;outline-offset:-4px}
.pz-sl__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);border-radius:12px;text-align:center;padding:16px}
.pz-sl__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-sl__card span{font-size:13px;color:var(--ink-2,#bbb)}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    let dead = false, paused = false;
    /* an online race: the shell's race kit, the room's seed */
    const RACE = ctx.online?.kit && Number.isInteger(ctx.online.seed) ? ctx.online : null;
    const sv = RACE ? {} : load(GAME);
    const bests = { time: { ...(sv.bestTime || {}) }, moves: { ...(sv.bestMoves || {}) } };
    let n = RACE ? 4 : SIZES[sv.size] ? Number(sv.size) : 4;
    let t = [], moves = 0, done = false, seed = 0, msg = '';
    let nodes = [];
    /* the tiles: '' numbers, or a drawn picture's id; its square image is made once */
    let pic = isPicture(sv.pic) ? sv.pic : '';
    const picUrls = {};
    const picUrl = id => (picUrls[id] ??= squarePicture(id));

    const sizeBtns = Object.entries(SIZES).map(([k, name]) => h('button', { type: 'button', dataset: { size: k }, 'aria-pressed': 'false', title: `${name}, ${k * k - 1} tiles` }, name));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Board size' }, sizeBtns);
    const picSel = h('select.pz__sel', { 'aria-label': 'Tiles', title: 'Numbers, or a picture cut into tiles' },
      h('option', { value: '', text: 'Numbers' }), PICTURES.map(p => h('option', { value: p.id, text: `Picture: ${p.name}` })));
    const movesV = h('span', { text: '0' });
    const movesRead = h('div.pz__read', { title: 'Moves', 'aria-label': 'Moves' }, icon('grid'), movesV);
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const bestV = h('small', { text: '' });
    const newBtn = h('button.pz__btn', { type: 'button', title: 'Shuffle a new board' }, icon('shuffle'), h('span.pz__long', { text: 'Shuffle' }));
    const top = h('div.pz__top', seg, picSel, movesRead, timeRead, bestV, newBtn);
    const sel0 = h('style', { text: '.pz__sel{font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-1,#ddd);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.1));padding:7px 8px;border-radius:var(--r-md,11px)}' });
    const board = h('div.pz-sl__board', { role: 'grid', tabindex: '0', 'aria-label': 'Sliding puzzle board' });
    const bw = h('div.pz-sl__bw', board);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), sel0, top, bw, foot, live);
    el.appendChild(root);
    if (RACE) { seg.hidden = true; picSel.hidden = true; newBtn.hidden = true; bestV.hidden = true; }
    /* tiles in their place, of all the tiles: the friend's progress bar */
    const inPlace = () => t.filter((v, i) => v && v === i + 1).length / (n * n - 1);

    const clk = clock(s => { timeV.textContent = fmtTime(s); });
    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'click a tile to slide it (and the ones in line) · <kbd>←↑↓→</kbd> slide a tile that way' }));

    function build() {
      board.style.setProperty('--n', n);
      board.replaceChildren();
      nodes = [];
      for (let i = 0; i < n * n; i++) {
        const b = h('button.pz-sl__t', { type: 'button', role: 'gridcell', dataset: { i } });
        L.on(b, 'click', () => { if (!dead) tryMove(Number(b.dataset.i)); });
        nodes.push(b); board.appendChild(b);
      }
    }
    function paint() {
      const url = pic ? picUrl(pic) : '';
      board.classList.toggle('is-pic', !!url);
      board.classList.toggle('is-done', done);
      if (url) board.style.setProperty('--pic', `url("${url}")`); else board.style.removeProperty('--pic');
      nodes.forEach((b, i) => {
        const v = t[i];
        b.textContent = v ? String(v) : '';
        b.dataset.v = v ? String(v) : '';
        b.classList.toggle('is-blank', !v && !(done && url));
        b.classList.toggle('is-ok', !!v && v === i + 1);
        b.style.setProperty('--th', String((Math.round(((v - 1) % n) / n * 120 + Math.floor((v - 1) / n) * 28) + 190) % 360));
        /* a picture tile shows the part of the picture from its home square (the blank's, once solved) */
        const home = v ? v - 1 : n * n - 1;
        if (url) b.style.backgroundPosition = `${(home % n) / (n - 1) * 100}% ${Math.floor(home / n) / (n - 1) * 100}%`; else b.style.removeProperty('background-position');
        b.setAttribute('aria-label', v ? `Tile ${v}` : 'Blank');
        b.tabIndex = -1;
      });
      picSel.value = pic;
      movesV.textContent = String(moves);
      const bt = bests.time[n], bm = bests.moves[n];
      bestV.textContent = bt != null ? `Best ${SIZES[n]}: ${fmtTime(bt)}${bm != null ? ` · ${bm} moves` : ''}` : '';
      sizeBtns.forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.size) === n)));
    }
    function deal(size = n, s = randomSeed(), tiles = null) {
      n = size; seed = s;
      t = tiles ? tiles.slice() : shuffled(n, seed);
      moves = 0; done = false; paused = false; msg = '';
      bw.querySelector('.pz__cover')?.remove(); bw.querySelector('.pz-sl__card')?.remove();
      clk.stop(); clk.secs = 0; timeV.textContent = '0:00';
      if (!RACE) save(GAME, { size: String(n) });
      build(); paint();
      say(RACE ? `A race: the same ${SIZES[n]} board as ${RACE.peer?.name || 'your friend'}. Fewest moves wins.` : `${SIZES[n]}: put the tiles in order, 1 first, with the blank last.`);
      /* in a race the clock runs from the start, the same for both */
      if (RACE) { clk.start(); RACE.progress(inPlace()); }
    }
    const can = () => !dead && !paused && !done;
    function tryMove(i) {
      if (!can()) return false;
      const u = slide(t, n, i);
      if (!u) return false;
      t = u; moves++;
      if (!clk.running) clk.start();
      paint();
      RACE?.progress(inPlace());
      if (isSolved(t)) win();
      return true;
    }
    function win() {
      done = true; clk.stop();
      if (RACE) {
        const ms = Math.round(clk.secs * 1000);
        paint();
        bw.appendChild(h('div.pz-sl__card', h('div', h('b', { text: 'Solved!' }), h('span', { text: `${moves} moves in ${fmtTime(clk.secs)}.` }))));
        say(`Solved in ${moves} moves, ${fmtTime(clk.secs)}.`);
        onScore(moves);
        onEnd({ score: moves, won: true, detail: `${SIZES[n]} · ${moves} moves`, race: { done: true, ms, mv: moves, p: 1 } });
        return;
      }
      const secs = Math.max(1, Math.round(clk.secs));
      const bt = bests.time[n], bm = bests.moves[n];
      const freshT = bt == null || secs < bt, freshM = bm == null || moves < bm;
      if (freshT) bests.time[n] = secs;
      if (freshM) bests.moves[n] = moves;
      save(GAME, { bestTime: bests.time, bestMoves: bests.moves });
      paint();
      const pname = pic ? PICTURES.find(p => p.id === pic)?.name : '';
      /* with a picture, the whole of it shows for a moment before the card */
      const card = () => bw.appendChild(h('div.pz-sl__card', h('div', h('b', { text: 'Solved!' }),
        h('span', { text: `${pname ? `${pname}: ` : ''}${moves} moves in ${fmtTime(secs)}${freshT || freshM ? ' — a new best' : ''}.` }))));
      if (pic && !reduced) setTimeout(() => { if (!dead && done) card(); }, 700); else card();
      say(`Solved in ${moves} moves, ${fmtTime(secs)}.`);
      onScore(secs);
      onEnd({ score: secs, won: true, detail: `${SIZES[n]}${pname ? ` · ${pname}` : ''} · ${moves} moves` });
    }

    /* where the tile comes FROM, relative to the blank (dc, dr): ← slides the tile right of the blank */
    const FROM = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [1, 0], ArrowRight: [-1, 0] };
    L.on(window, 'keydown', e => {
      if (!can() || !ownsKey(root, e) || !FROM[e.key]) return;
      e.preventDefault();
      const z = t.indexOf(0), zr = Math.floor(z / n), zc = z % n;
      const [dc, dr] = FROM[e.key], c = zc + dc, r = zr + dr;
      if (c < 0 || r < 0 || c >= n || r >= n) return;
      tryMove(r * n + c);
    });
    L.on(seg, 'click', e => { const b = e.target.closest?.('button[data-size]'); if (b && !dead) deal(Number(b.dataset.size)); });
    L.on(newBtn, 'click', () => { if (!dead) deal(n); });
    /* changing the tiles keeps the board as it is: only the look changes */
    L.on(picSel, 'change', () => {
      if (dead) return;
      pic = isPicture(picSel.value) ? picSel.value : '';
      save(GAME, { pic });
      paint();
      board.focus({ preventScroll: true });
      say(pic ? `Picture tiles: ${PICTURES.find(p => p.id === pic).name}. The small numbers say where each goes.` : 'Number tiles.');
    });

    deal(n, RACE ? RACE.seed >>> 0 : undefined);
    requestAnimationFrame(() => { if (!dead) board.focus({ preventScroll: true }); });
    onScore(0);

    return {
      stop() { if (dead) return; dead = true; clk.dispose(); L.clear(); root.remove(); },
      pause() {
        if (dead || paused) return;
        paused = true; clk.stop();
        if (!done) bw.appendChild(h('div.pz__cover', { text: 'Paused' }));
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        bw.querySelector('.pz__cover')?.remove();
        if (!done && moves > 0) clk.start();
      },
      peek: () => ({ n, tiles: t.slice(), moves, done, paused, secs: clk.secs, seed, solvable: solvable(t, n), best: { time: { ...bests.time }, moves: { ...bests.moves } }, pic,
        bgs: nodes.map(b => b.style.backgroundPosition || ''), race: RACE ? { seed: RACE.seed, progress: inPlace() } : null }),
      /* test hook — nothing in the game calls it: deal({ n, seed }) · board({ n, tiles }) */
      hook(cmd, arg) {
        if (cmd === 'deal') deal(arg.n || n, arg.seed ?? randomSeed());
        else if (cmd === 'board') deal(arg.n, 1, arg.tiles);
        return true;
      },
    };
  },
};
