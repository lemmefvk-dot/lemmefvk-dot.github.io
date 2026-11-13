/* ============================================================
   arcade/lettergrid.js — Letter Grid for Static Arcade.

   Shake the dice and find words in the grid of letters: a word is a
   chain of touching cells (sides or corners), each cell used once
   per word, three letters or more. You have three minutes. Longer
   words score more (3 letters 1 point, 4 → 2, 5 → 4, 6 → 6, 7 → 9,
   8 and up 12+). Pick a 4×4 or a 5×5 grid. When time is up, the words
   you missed are listed (click one to see where it hides).

   The rules, the dice and the search that rejects weak grids are in
   lettergridlogic.js; the word list (words.js) is fetched when this
   game opens, offensive words already taken out of it.

   Controls
     mouse / touch  drag across the letters and let go, or tap them one
                    by one and tap the last one again (or press Submit)
     keyboard       type the word and press Enter · or arrows move,
                    Space adds the cell under the cursor · Backspace
                    removes the last letter
   "Shake": the grid tumbles as the round starts, and trembles for the
   last ten seconds. With reduced motion both stop: the letters just
   appear, and the warning is the clock turning red.

   Score = points, higher is better; the best per grid size is kept on
   this device (portal.arcadePuzzles.lettergrid).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, randomSeed, sounder } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { loadWords } from './words.js';
import { makeGrid, pathFor, spell, wordPoints, touching, SIZES, ROUND_SECONDS, MIN_LEN } from './lettergridlogic.js';

const GAME = 'lettergrid';
const SHAKE_MS = 800;
const LOW_SECONDS = 10;

const CSS = `${BASE}
.pz-lg__main{flex:1 1 auto;min-height:0;width:100%;display:flex;gap:var(--sp-4,12px);align-items:stretch;justify-content:center}
.pz-lg__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;container-type:size;display:grid;place-items:center}
.pz-lg__board{--n:4;position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(var(--n),1fr);grid-template-rows:repeat(var(--n),1fr);gap:calc(100cqw / var(--n) * .06);
  padding:calc(100cqw / var(--n) * .06);border:2px solid var(--line-2,rgba(255,255,255,.28));border-radius:14px;background:var(--bg-lg,#1a1526);container-type:inline-size;outline:none;touch-action:none;cursor:pointer;box-sizing:border-box}
.pz-lg__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-lg__c{display:grid;place-items:center;border-radius:calc(100cqw / var(--n) * .16);background:var(--fill-2,rgba(255,255,255,.1));font:800 calc(100cqw / var(--n) * .46)/1 var(--font,system-ui);color:var(--ink-0,#fff);position:relative;pointer-events:none}
.pz-lg__c.is-path{background:color-mix(in srgb,var(--ga) 62%,transparent);color:#fff}
.pz-lg__c.is-last{background:var(--ga);box-shadow:0 0 0 2px #fff inset}
.pz-lg__c.is-cur{box-shadow:inset 0 0 0 3px #ffd166}
.pz-lg__c.is-miss{background:hsl(160 60% 38% / .75);color:#fff}
.pz-lg__c b{position:absolute;right:8%;bottom:4%;font:700 calc(100cqw / var(--n) * .17)/1 var(--font,system-ui);opacity:.75}
.pz-lg__board.is-shaking{animation:lg-shake .16s linear infinite}
.pz-lg__board.is-low{animation:lg-tremble .5s ease-in-out infinite}
@keyframes lg-shake{0%{transform:translate(0,0) rotate(0)}20%{transform:translate(-4px,2px) rotate(-1.2deg)}40%{transform:translate(3px,-3px) rotate(1deg)}60%{transform:translate(-3px,-2px) rotate(-.8deg)}80%{transform:translate(4px,3px) rotate(1.2deg)}100%{transform:translate(0,0) rotate(0)}}
@keyframes lg-tremble{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}
.pz.is-reduced .pz-lg__board{animation:none!important}
.pz-lg__side{flex:0 0 auto;width:210px;display:flex;flex-direction:column;gap:8px;min-height:0;align-self:stretch}
.pz-lg__word{min-height:44px;display:grid;place-items:center;border-radius:10px;background:var(--fill-0,rgba(255,255,255,.04));border:1px solid var(--line-1,rgba(255,255,255,.1));
  font:800 22px/1 var(--font,system-ui);letter-spacing:.12em;color:var(--ink-0,#fff);text-transform:uppercase;word-break:break-all;text-align:center;padding:6px}
.pz-lg__word.is-bad{color:#ff8a8a;border-color:#ff6b6b}
.pz-lg__word.is-good{color:#8ef0b4;border-color:#4fd68a}
.pz-lg__acts{display:flex;gap:6px}.pz-lg__acts .pz__btn{flex:1}
.pz-lg__list{flex:1 1 auto;min-height:60px;overflow:auto;display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px;padding:8px;border-radius:10px;background:var(--fill-0,rgba(255,255,255,.04));border:1px solid var(--line-0,rgba(255,255,255,.06))}
.pz-lg__list h4{width:100%;margin:0 0 2px;font:600 11px/1 var(--font,system-ui);color:var(--ink-3,#999);text-transform:uppercase;letter-spacing:.06em}
.pz-lg__chip{font:700 12px/1 var(--font,system-ui);letter-spacing:.05em;text-transform:uppercase;padding:5px 7px;border-radius:7px;background:var(--fill-1,rgba(255,255,255,.07));color:var(--ink-0,#fff);border:0}
.pz-lg__chip small{font-weight:600;opacity:.65;margin-left:4px}
button.pz-lg__chip{cursor:pointer}button.pz-lg__chip:focus-visible{outline:2px solid var(--ga)}
.pz-lg__chip.is-missed{background:color-mix(in srgb,hsl(160 60% 38%) 35%,transparent)}
.pz-lg__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.97);border-radius:12px;text-align:center;padding:16px}
.pz-lg__card div{max-width:34ch;display:flex;flex-direction:column;gap:10px;align-items:center}
.pz-lg__card b{font-size:22px;color:#fff}
.pz-lg__card div>span{font-size:13px;color:var(--ink-2,#bbb);line-height:1.5}
.pz-lg__done{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px;text-align:center;background:var(--fill-1,rgba(255,255,255,.07));border:1px solid var(--line-1,rgba(255,255,255,.1));border-radius:10px}
.pz-lg__done b{font-size:20px;color:#fff}.pz-lg__done>span{font-size:12px;color:var(--ink-2,#bbb);max-width:44ch}
.pz.is-low .pz__read.is-clock{color:#ff7b7b}
@container (max-width:620px){.pz-lg__main{flex-direction:column;gap:6px}.pz-lg__side{width:100%;flex:0 0 auto;max-height:42%}.pz-lg__list{min-height:40px}}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    let reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false;
    const sv = load(GAME);
    const bests = { ...(sv.best || {}) };
    const prefs = { size: SIZES[sv.size] ? sv.size : '4' };
    let lex = null;
    let G = null;                       /* the grid: { size, n, seed, cells, found: Map(all words -> path), grade } */
    let phase = 'loading';              /* loading · ready · shaking · play · review · done */
    let score = 0, mine = new Map();    /* words found this round: word -> points */
    let path = [];                      /* the chain being built (cell indexes) */
    let typed = null;                   /* the word being typed, or null when building by clicks / arrows */
    let cursor = 0, keyUsed = false, showPath = null, msg = '', failed = '';
    let missedList = [];
    let rollTimer = 0, shakeTimer = 0;

    /* ---------- chrome ---------- */
    const sizeBtns = Object.entries(SIZES).map(([k, s]) => h('button', { type: 'button', dataset: { size: k }, 'aria-pressed': 'false', title: `${s.n}×${s.n} grid` }, `${s.n}×${s.n}`));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Grid size' }, sizeBtns);
    const scoreV = h('span', { text: '0' });
    const scoreRead = h('div.pz__read', { title: 'Score', 'aria-label': 'Score' }, icon('star'), scoreV);
    const countV = h('span', { text: '0 words' });
    const countRead = h('div.pz__read', { title: 'Words found', 'aria-label': 'Words found' }, icon('list'), countV);
    const timeV = h('span', { text: fmtTime(ROUND_SECONDS) });
    const timeRead = h('div.pz__read.is-clock', { title: 'Time left', 'aria-label': 'Time left' }, icon('clock'), timeV);
    const bestV = h('small', { text: '' });
    const newBtn = h('button.pz__btn', { type: 'button', title: 'A new grid' }, icon('refresh'), h('span.pz__long', { text: 'New grid' }));
    const top = h('div.pz__top', seg, scoreRead, countRead, timeRead, bestV, newBtn);
    const board = h('div.pz-lg__board', { role: 'grid', tabindex: '0', 'aria-label': 'Letter grid' });
    const bw = h('div.pz-lg__bw', board);
    const wordEl = h('div.pz-lg__word', { 'aria-live': 'off', dataset: { role: 'current' } });
    const submitBtn = h('button.pz__btn', { type: 'button', title: 'Submit the word (Enter)' }, icon('check'), h('span', { text: 'Submit' }));
    const clearBtn = h('button.pz__btn', { type: 'button', title: 'Clear the word (Backspace removes one letter)' }, icon('x'), h('span', { text: 'Clear' }));
    const list = h('div.pz-lg__list', { 'aria-label': 'Words found' });
    const side = h('div.pz-lg__side', wordEl, h('div.pz-lg__acts', submitBtn, clearBtn), list);
    const main = h('div.pz-lg__main', bw, side);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, main, foot, live);
    el.appendChild(root);

    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg
      ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'drag across touching letters · or type a word and press <kbd>Enter</kbd> · arrows + <kbd>Space</kbd> pick cells · <kbd>Backspace</kbd> undoes' }));

    /* ---------- time ---------- */
    const clk = clock(secs => {
      const left = Math.max(0, ROUND_SECONDS - secs);
      timeV.textContent = fmtTime(Math.ceil(left));
      const low = phase === 'play' && left <= LOW_SECONDS;
      root.classList.toggle('is-low', low);
      board.classList.toggle('is-low', low && !reduced);
      if (phase === 'play' && left <= 0) endRound();
    });

    /* ---------- the grid on screen ---------- */
    let nodes = [];
    function build() {
      board.style.setProperty('--n', G.n);
      board.replaceChildren();
      nodes = G.cells.map((ch, i) => {
        const c = h('div.pz-lg__c', { role: 'gridcell', dataset: { i }, text: ch });
        board.appendChild(c);
        return c;
      });
    }
    const current = () => (typed !== null ? typed : spell(G.cells, path));
    function paint() {
      if (!G) return;
      const inPath = new Set(showPath || path);
      const last = (showPath || path)[(showPath || path).length - 1];
      nodes.forEach((c, i) => {
        c.className = 'pz-lg__c' + (showPath ? (inPath.has(i) ? ' is-miss' : '') : (inPath.has(i) ? (i === last ? ' is-path is-last' : ' is-path') : ''))
          + (keyUsed && typed === null && i === cursor && phase === 'play' ? ' is-cur' : '');
        const order = (showPath || path).indexOf(i);
        const tag = c.querySelector('b');
        if (order >= 0 && (showPath || path).length > 1) { if (tag) tag.textContent = String(order + 1); else c.appendChild(h('b', { text: String(order + 1) })); } else tag?.remove();
      });
      const text = showPath ? spell(G.cells, showPath) : current();
      wordEl.textContent = text || (phase === 'play' ? '…' : '');
      wordEl.className = 'pz-lg__word' + (typed !== null && typed && !path.length ? ' is-bad' : '') + (failed ? ' is-bad' : '');
      scoreV.textContent = String(score);
      countV.textContent = `${mine.size} word${mine.size === 1 ? '' : 's'}`;
      bestV.textContent = bests[G.size] != null ? `Best ${SIZES[G.size].n}×${SIZES[G.size].n}: ${bests[G.size]}` : '';
      sizeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === G.size)));
      const live1 = phase === 'play';
      submitBtn.disabled = !live1; clearBtn.disabled = !live1;
    }
    function paintList() {
      list.replaceChildren(h('h4', { text: phase === 'review' || phase === 'done' ? `Missed (${missedList.length})` : 'Found' }));
      if (phase === 'review' || phase === 'done') {
        for (const w of missedList.slice(0, 120)) {
          list.appendChild(h('button.pz-lg__chip.is-missed', { type: 'button', dataset: { word: w }, title: 'Show where it hides', onclick: () => { showPath = G.found.get(w); paint(); } }, w, h('small', { text: String(wordPoints(w.length)) })));
        }
        if (missedList.length > 120) list.appendChild(h('span.pz__note', { text: `and ${missedList.length - 120} more` }));
        return;
      }
      for (const [w, p] of [...mine].reverse()) list.appendChild(h('span.pz-lg__chip', { dataset: { word: w } }, w, h('small', { text: `+${p}` })));
    }
    function card(title, text, button) {
      bw.querySelector('.pz-lg__card')?.remove();
      if (!title) return;
      bw.appendChild(h('div.pz-lg__card', h('div', h('b', { text: title }), h('span', { text }), button || null)));
    }

    /* ---------- a round ---------- */
    function deal(size = prefs.size, seed = randomSeed()) {
      clearInterval(rollTimer); clearTimeout(shakeTimer);
      clk.stop(); clk.secs = 0;
      G = makeGrid(lex, size, seed);
      prefs.size = size; save(GAME, { size });
      score = 0; mine = new Map(); path = []; typed = null; showPath = null; failed = ''; missedList = []; cursor = 0; keyUsed = false;
      paused = false; phase = 'ready';
      side.querySelector('.pz-lg__done')?.remove();
      root.classList.remove('is-low'); board.classList.remove('is-low', 'is-shaking');
      timeV.textContent = fmtTime(ROUND_SECONDS);
      build(); paint(); paintList(); onScore(0);
      /* the letters stay hidden until the shake */
      nodes.forEach(c => { c.textContent = ' '; });
      const go = h('button.btn.btn--primary', { type: 'button', dataset: { act: 'shake' }, onclick: () => start() }, icon('play', { fill: true }), h('span', { text: 'Shake the grid' }));
      card('Ready?', `${ROUND_SECONDS / 60} minutes. Find words of ${MIN_LEN}+ touching letters. Longer words score more.`, go);
      say(`${SIZES[size].n}×${SIZES[size].n} grid ready. Press Enter or Space to shake it and start.`);
      setTimeout(() => { if (!dead && phase === 'ready') go.focus({ preventScroll: true }); }, 30);
    }
    function start() {
      if (dead || phase !== 'ready') return;
      snd.wake();
      card(null);
      reduced = reducedMotion(ctx);
      root.classList.toggle('is-reduced', reduced);
      const reveal = () => {
        nodes.forEach((c, i) => { c.textContent = G.cells[i]; });
        board.classList.remove('is-shaking');
        phase = 'play'; paint(); paintList();
        clk.start();
        say('Go! Find words in the grid.');
        board.focus({ preventScroll: true });
      };
      if (reduced) { reveal(); return; }
      phase = 'shaking';
      board.classList.add('is-shaking');
      const A = 'AEIOURSTLNDCHMPBGFWYVKJX';
      rollTimer = setInterval(() => { nodes.forEach(c => { c.textContent = A[Math.floor(Math.random() * A.length)]; }); snd.blip(180 + Math.random() * 120, 0.03, 'square', 0.3); }, 70);
      shakeTimer = setTimeout(() => { clearInterval(rollTimer); if (!dead) reveal(); }, SHAKE_MS);
    }
    function endRound() {
      if (phase !== 'play') return;
      phase = 'review';
      clk.stop();
      path = []; typed = null; failed = '';
      root.classList.remove('is-low'); board.classList.remove('is-low');
      timeV.textContent = fmtTime(0);
      missedList = [...G.found.keys()].filter(w => !mine.has(w)).sort((a, b) => wordPoints(b.length) - wordPoints(a.length) || a.localeCompare(b));
      const total = G.grade.words;
      const fin = h('button.btn.btn--primary', { type: 'button', dataset: { act: 'finish' }, onclick: () => finish() }, icon('check'), h('span', { text: 'See my score' }));
      card(null);
      paint(); paintList();
      side.insertBefore(h('div.pz-lg__done', h('b', { text: 'Time!' }), h('span', { text: `You found ${mine.size} of the ${total} words in this grid, for ${score} points. The ${missedList.length} you missed are listed — click one to see it.` }), fin), list);
      say(`Time is up. ${mine.size} of ${total} words, ${score} points.`);
      snd.blip(300, 0.2, 'triangle', 0.8, 150);
      setTimeout(() => { if (!dead && phase === 'review') fin.focus({ preventScroll: true }); }, 30);
    }
    function finish() {
      if (dead || phase !== 'review') return;
      phase = 'done';
      const prev = bests[G.size];
      if (prev == null || score > prev) { bests[G.size] = score; save(GAME, { best: bests }); }
      side.querySelector('.pz-lg__done')?.remove();
      paint();
      onScore(score);
      onEnd({ score, won: true, detail: `${SIZES[G.size].n}×${SIZES[G.size].n} grid · ${mine.size} of ${G.grade.words} words${[...mine.keys()].length ? ` · longest ${[...mine.keys()].sort((a, b) => b.length - a.length)[0]}` : ''}` });
    }

    /* ---------- words ---------- */
    function submit() {
      if (phase !== 'play' || paused) return;
      let p = path;
      if (typed !== null) { p = typed ? pathFor(G.cells, G.n, typed) : null; if (!p && typed) { fail(`“${typed.toUpperCase()}” can't be traced in this grid.`); return; } }
      if (!p || !p.length) return;
      const w = spell(G.cells, p);
      if (w.length < MIN_LEN) { fail('Words need at least 3 letters.'); return; }
      if (mine.has(w)) { fail(`You already found ${w.toUpperCase()}.`); return; }
      if (!lex.has(w)) { fail(`${w.toUpperCase()} is not in the word list.`); return; }
      const pts = wordPoints(w.length);
      mine.set(w, pts); score += pts;
      path = []; typed = null; failed = '';
      snd.blip(440 + Math.min(8, w.length) * 60, 0.09, 'triangle', 0.8); if (w.length >= 6) snd.blip(880, 0.12, 'triangle', 0.6);
      say(`${w.toUpperCase()}! +${pts}${w.length >= 6 ? ' — a long one' : ''}.`);
      onScore(score); paint(); paintList();
      wordEl.classList.add('is-good'); setTimeout(() => wordEl.classList.remove('is-good'), 350);
    }
    function fail(m) {
      failed = m; say(m); snd.blip(150, 0.12, 'sawtooth', 0.4, 110);
      path = []; typed = null; paint();
      failed = '';
    }
    const clearWord = () => { path = []; typed = null; failed = ''; showPath = null; paint(); };

    /* ---------- pointer ---------- */
    /* the cell under the pointer: its middle counts, its corners don't (so a diagonal step is easy to make) */
    const cellAt = e => {
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].getBoundingClientRect();
        if (Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) <= r.width * 0.5) return i;
      }
      return -1;
    };
    let drag = null;
    L.on(board, 'pointerdown', e => {
      if (phase !== 'play' || paused || e.button !== 0) return;
      const i = cellAt(e);
      if (i < 0) return;
      e.preventDefault();
      snd.wake(); keyUsed = false; typed = null; showPath = null;
      const last = path[path.length - 1];
      if (path.length && i === last) { submit(); return; }
      const at = path.indexOf(i);
      if (at >= 0) path = path.slice(0, at + 1);
      else if (path.length && touching(G.n, last, i)) path.push(i);
      else path = [i];
      snd.blip(300 + path.length * 25, 0.03, 'square', 0.3);
      drag = { id: e.pointerId, moved: false };
      try { board.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      board.focus({ preventScroll: true });
      paint();
    });
    L.on(board, 'pointermove', e => {
      if (!drag || e.pointerId !== drag.id || phase !== 'play') return;
      const i = cellAt(e);
      if (i < 0) return;
      const last = path[path.length - 1];
      if (i === last) return;
      if (path.length > 1 && i === path[path.length - 2]) { path.pop(); drag.moved = true; }
      else if (!path.includes(i) && touching(G.n, last, i)) { path.push(i); drag.moved = true; snd.blip(300 + path.length * 25, 0.03, 'square', 0.3); }
      else return;
      paint();
    });
    const release = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      if (moved && path.length >= 2) submit();
    };
    L.on(board, 'pointerup', release);
    L.on(board, 'pointercancel', e => { if (drag && e.pointerId === drag.id) { drag = null; clearWord(); } });
    L.on(submitBtn, 'click', () => { submit(); board.focus({ preventScroll: true }); });
    L.on(clearBtn, 'click', () => { clearWord(); board.focus({ preventScroll: true }); });

    /* ---------- keyboard ---------- */
    const MOVE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    L.on(window, 'keydown', e => {
      if (dead || !ownsKey(root, e)) return;
      const k = e.key;
      if (phase === 'ready') {
        if (k === 'Enter' || k === ' ') { e.preventDefault(); if (!e.repeat) start(); }
        return;
      }
      if (phase === 'review') {
        if (k === 'Enter' || k === ' ') { e.preventDefault(); if (!e.repeat) finish(); }
        return;
      }
      if (phase !== 'play' || paused) return;
      if (/^[a-zA-Z]$/.test(k)) {
        e.preventDefault();                         /* P is a word letter here, not the Arcade's pause key */
        if (typed === null) { typed = ''; path = []; }
        showPath = null;
        if (typed.length < 16) typed += k.toLowerCase();
        const p = pathFor(G.cells, G.n, typed);
        path = p || [];
        snd.blip(320 + typed.length * 20, 0.025, 'square', 0.25);
        paint();
      } else if (MOVE[k]) {
        e.preventDefault(); keyUsed = true;
        if (typed !== null) { typed = null; path = []; }
        const x = Math.max(0, Math.min(G.n - 1, cursor % G.n + MOVE[k][0])), y = Math.max(0, Math.min(G.n - 1, Math.floor(cursor / G.n) + MOVE[k][1]));
        cursor = y * G.n + x; paint();
      } else if (k === ' ') {
        e.preventDefault(); if (e.repeat) return;
        keyUsed = true; showPath = null;
        if (typed !== null) { typed = null; path = []; }
        const last = path[path.length - 1];
        if (cursor === last) path.pop();
        else if (!path.includes(cursor) && (!path.length || touching(G.n, last, cursor))) path.push(cursor);
        else { say('That cell does not touch the last one.'); }
        paint();
      } else if (k === 'Enter') {
        e.preventDefault(); if (!e.repeat) submit();
      } else if (k === 'Backspace') {
        e.preventDefault();
        if (typed !== null) { typed = typed.slice(0, -1); path = typed ? (pathFor(G.cells, G.n, typed) || []) : []; if (!typed) typed = null; }
        else path.pop();
        paint();
      }
    });

    L.on(seg, 'click', e => { const b = e.target.closest?.('button[data-size]'); if (b && !dead && lex) deal(b.dataset.size); });
    L.on(newBtn, 'click', () => { if (!dead && lex) deal(); });

    /* ---------- boot: the word list loads first ---------- */
    paintFoot(); paintList(); onScore(0);
    board.style.setProperty('--n', 4);
    card('Loading the word list…', 'About 300 KB; the browser keeps a copy for next time.');
    const loadIt = () => loadWords().then(l => { if (dead) return; lex = l; deal(); }).catch(err => {
      if (dead) return;
      card('The word list did not load', 'The first time, it needs the network. Check your connection and try again.',
        h('button.btn.btn--primary', { type: 'button', onclick: () => { card('Loading the word list…', ''); loadIt(); } }, icon('refresh'), h('span', { text: 'Try again' })));
      say(`The word list did not load (${err.message}).`);
    });
    loadIt();

    return {
      stop() {
        if (dead) return;
        dead = true;
        clearInterval(rollTimer); clearTimeout(shakeTimer);
        clk.dispose();
        L.clear();
        snd.close();
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        paused = true; drag = null;
        if (phase === 'play') { clk.stop(); board.classList.remove('is-low'); bw.appendChild(h('div.pz__cover', { text: 'Paused' })); }
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        bw.querySelector('.pz__cover')?.remove();
        if (phase === 'play') clk.start();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => G && ({
        phase, size: G.size, n: G.n, seed: G.seed, cells: G.cells.slice(), score, secs: clk.secs, left: Math.max(0, ROUND_SECONDS - clk.secs), paused,
        found: [...mine.keys()], points: Object.fromEntries(mine), path: path.slice(), typed, current: current(), total: G.grade.words, grade: G.grade, rolls: G.rolls,
        all: [...G.found].map(([w, p]) => ({ word: w, path: p })), missed: missedList.slice(), best: { ...bests }, reduced,
        shaking: board.classList.contains('is-shaking'), low: board.classList.contains('is-low'), anim: getComputedStyle(board).animationName,
        loaded: !!lex,
      }),
      /* test hook — nothing in the game calls it: deal({ size, seed }), time({ secs }) */
      hook(cmd, arg) {
        if (cmd === 'deal' && lex) deal(arg?.size || prefs.size, arg?.seed ?? randomSeed());
        else if (cmd === 'time' && phase === 'play') { clk.secs = arg.secs; }
        return true;
      },
    };
  },
};
