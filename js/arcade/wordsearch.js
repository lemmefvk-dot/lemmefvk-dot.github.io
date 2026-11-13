/* ============================================================
   arcade/wordsearch.js — Word Search for Static Arcade.

   Pick a theme (animals, space, food, sports, Halloween, ocean,
   school, weather) and a size. Every round is a new random grid
   built from that theme's bundled word list; words run in all 8
   directions, backwards and diagonal included. The grid for a
   given seed is always the same (wordsearchlogic.js), which is how
   the tests pin one.

   Controls
     mouse / touch  press on the first letter and drag to the last
                    (the line snaps to the nearest of the 8
                    directions); let go to check it
     keyboard       arrows move · Space marks the first letter, then
                    move to the last letter and press Space again ·
                    Backspace cancels
   A word you find is struck through in the list and stays coloured
   in the grid. Finding every word ends the round.

   Score = seconds from the first selection to the last word, lower
   is better. The best time per size is kept on this device
   (portal.arcadePuzzles.wordsearch). The clock stops while paused
   and the grid is covered then.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, randomSeed } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { THEMES, SIZES } from './wordsearch.data.js';
import { makeGrid, lineCells } from './wordsearchlogic.js';

const GAME = 'wordsearch';
const themeById = id => THEMES.find(t => t.id === id) || null;

const CSS = `${BASE}
.pz-ws__main{flex:1 1 auto;min-height:0;width:100%;display:flex;gap:var(--sp-4,12px);align-items:stretch;justify-content:center}
.pz-ws__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;container-type:size;display:grid;place-items:center}
.pz-ws__board{--n:10;position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(var(--n),1fr);grid-template-rows:repeat(var(--n),1fr);
  border:2px solid var(--line-2,rgba(255,255,255,.28));border-radius:10px;background:var(--bg-ws,#171320);container-type:inline-size;outline:none;touch-action:none;overflow:hidden;cursor:pointer}
.pz-ws__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-ws__c{display:grid;place-items:center;font:700 calc(100cqw / var(--n) * .5)/1 var(--font,system-ui);color:var(--ink-1,#e8e8f0);position:relative}
.pz-ws__c.is-found{background:hsl(var(--fh) 70% 45% / .55);color:#fff}
.pz-ws__c.is-sel{background:color-mix(in srgb,var(--ga) 55%,transparent);color:#fff;border-radius:50%}
.pz-ws__c.is-cur{box-shadow:inset 0 0 0 2px var(--ga);border-radius:6px}
.pz-ws__c.is-bad{background:hsl(0 80% 50% / .45)}
.pz-ws__list{flex:0 0 auto;width:170px;display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:10px;background:var(--fill-0,rgba(255,255,255,.04));border:1px solid var(--line-0,rgba(255,255,255,.06));overflow:auto;align-self:center;max-height:100%}
.pz-ws__list li{list-style:none;font:700 13px/1.25 var(--font,system-ui);letter-spacing:.04em;color:var(--ink-0,#fff)}
.pz-ws__list li.is-found{color:var(--ink-3,#888);text-decoration:line-through;text-decoration-thickness:2px}
.pz-ws__list h4{margin:0 0 4px;font:600 11px/1 var(--font,system-ui);color:var(--ink-3,#999);text-transform:uppercase;letter-spacing:.06em}
.pz-ws__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);border-radius:8px;text-align:center;padding:16px}
.pz-ws__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-ws__card span{font-size:13px;color:var(--ink-2,#bbb)}
.pz__sel{font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-1,#ddd);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.1));padding:7px 8px;border-radius:var(--r-md,11px)}
@container (max-width:620px){.pz-ws__main{flex-direction:column;gap:6px}.pz-ws__list{width:100%;flex-direction:row;flex-wrap:wrap;gap:3px 12px;max-height:30%;align-self:stretch}.pz-ws__list h4{width:100%;margin:0}}
.pz:not(.is-reduced) .pz-ws__c.is-found{transition:background .25s}
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
    const prefs = { theme: themeById(sv.theme) ? sv.theme : 'animals', size: SIZES[sv.size] ? sv.size : 'medium' };
    let G = null;                       /* the round: { n, rows, words:[{..., found}], seed, theme, size, done } */
    let sel = null;                     /* { cells: [[x,y]…] } while selecting */
    let anchor = null, cur = [0, 0];     /* keyboard selection */
    let msg = '';
    let nodes = [], listEls = [];

    /* ---------- chrome ---------- */
    const themeSel = h('select.pz__sel', { 'aria-label': 'Theme' }, THEMES.map(t => h('option', { value: t.id, text: t.name })));
    const sizeBtns = Object.entries(SIZES).map(([k, s]) => h('button', { type: 'button', dataset: { size: k }, 'aria-pressed': 'false', title: `${s.n}×${s.n}, ${s.words} words` }, s.name));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Grid size' }, sizeBtns);
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const bestV = h('small', { text: '' });
    const leftV = h('span', { text: '' });
    const leftRead = h('div.pz__read', { title: 'Words left', 'aria-label': 'Words left' }, icon('search'), leftV);
    const newBtn = h('button.pz__btn', { type: 'button', title: 'A new random grid' }, icon('refresh'), h('span.pz__long', { text: 'New grid' }));
    const top = h('div.pz__top', themeSel, seg, leftRead, timeRead, bestV, newBtn);
    const board = h('div.pz-ws__board', { role: 'grid', tabindex: '0', 'aria-label': 'Word search grid' });
    const bw = h('div.pz-ws__bw', board);
    const list = h('ul.pz-ws__list', { 'aria-label': 'Words to find' });
    const main = h('div.pz-ws__main', bw, list);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, main, foot, live);
    el.appendChild(root);

    const clk = clock(s => { timeV.textContent = fmtTime(s); });
    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg
      ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'drag from the first letter to the last · or <kbd>Space</kbd> at each end · arrows move · <kbd>Backspace</kbd> cancels' }));

    /* ---------- the round ---------- */
    function deal(seed = randomSeed(), theme = prefs.theme, size = prefs.size) {
      const t = themeById(theme) || THEMES[0], S = SIZES[size] || SIZES.medium;
      const g = makeGrid(t, S.n, S.words, seed);
      G = { ...g, size, words: g.words.map(w => ({ ...w, found: false, hue: 0 })), done: false, found: 0 };
      prefs.theme = t.id; prefs.size = size;
      save(GAME, { theme: prefs.theme, size: prefs.size });
      sel = null; anchor = null; cur = [0, 0]; msg = '';
      paused = false; bw.querySelector('.pz__cover')?.remove(); bw.querySelector('.pz-ws__card')?.remove();
      clk.stop(); clk.secs = 0; timeV.textContent = '0:00';
      build(); paint();
      say(`${t.name}: find ${g.words.length} words, in any of 8 directions.`);
    }
    function build() {
      board.style.setProperty('--n', G.n);
      board.replaceChildren();
      nodes = [];
      for (let y = 0; y < G.n; y++) for (let x = 0; x < G.n; x++) {
        const c = h('div.pz-ws__c', { role: 'gridcell', dataset: { x, y }, text: G.rows[y][x] });
        nodes.push(c); board.appendChild(c);
      }
      list.replaceChildren(h('h4', { text: 'Find' }));
      listEls = G.words.map(w => { const li = h('li', { dataset: { word: w.word }, text: w.word }); list.appendChild(li); return li; });
    }
    const at = (x, y) => nodes[y * G.n + x];
    function paint() {
      const inSel = new Set((sel ? sel.cells : anchor ? previewKeys() : []).map(([x, y]) => y * G.n + x));
      const hue = new Map();
      G.words.forEach(w => { if (w.found) for (const [x, y] of cellsOf(w)) hue.set(y * G.n + x, w.hue); });
      nodes.forEach((c, i) => {
        const x = i % G.n, y = Math.floor(i / G.n);
        c.className = 'pz-ws__c' + (hue.has(i) ? ' is-found' : '') + (inSel.has(i) ? ' is-sel' : '') + (anchor && cur[0] === x && cur[1] === y ? ' is-cur' : '') + (!anchor && !sel && cur[0] === x && cur[1] === y && keyboardUsed ? ' is-cur' : '');
        if (hue.has(i)) c.style.setProperty('--fh', hue.get(i)); else c.style.removeProperty('--fh');
        if (hue.has(i)) c.dataset.found = '1'; else delete c.dataset.found;
      });
      G.words.forEach((w, i) => listEls[i].classList.toggle('is-found', w.found));
      leftV.textContent = `${G.words.length - G.found} left`;
      bestV.textContent = bests[G.size] != null ? `Best ${SIZES[G.size].name}: ${fmtTime(bests[G.size])}` : '';
      sizeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === G.size)));
      themeSel.value = G.theme;
    }
    const cellsOf = w => Array.from({ length: w.word.length }, (_, i) => [w.x + w.dx * i, w.y + w.dy * i]);
    let keyboardUsed = false;
    const previewKeys = () => (anchor ? lineCells(anchor[0], anchor[1], cur[0], cur[1]) || [anchor] : []);

    /* does this line of cells spell a word that isn't found yet? */
    function check(cells) {
      if (!cells || cells.length < 2 || G.done) return false;
      const str = cells.map(([x, y]) => G.rows[y][x]).join('');
      const back = [...str].reverse().join('');
      const w = G.words.find(w => !w.found && (w.word === str || w.word === back));
      if (!w) {
        const hit = G.words.find(w => w.found && (w.word === str || w.word === back));
        say(hit ? `You already found ${hit.word}.` : `“${str}” isn't on the list.`);
        flashBad(cells);
        return false;
      }
      w.found = true; G.found++;
      w.hue = (G.found * 47 + 190) % 360;
      say(`Found ${w.word}! ${G.words.length - G.found} to go.`);
      paint();
      if (G.found === G.words.length) win();
      return true;
    }
    function flashBad(cells) {
      if (reduced) return;
      for (const [x, y] of cells) at(x, y)?.classList.add('is-bad');
      setTimeout(() => { if (!dead) for (const [x, y] of cells) at(x, y)?.classList.remove('is-bad'); }, 260);
    }
    function win() {
      G.done = true; clk.stop();
      const secs = Math.max(1, Math.round(clk.secs));
      const prev = bests[G.size];
      const fresh = prev == null || secs < prev;
      if (fresh) bests[G.size] = secs;
      save(GAME, { best: bests });
      paint();
      bw.appendChild(h('div.pz-ws__card', h('div', h('b', { text: 'All found!' }),
        h('span', { text: `${G.words.length} words in ${fmtTime(secs)}${fresh ? (prev == null ? ' — your first ' : ' — a new best for ') + SIZES[G.size].name : ''}.` }))));
      say(`All ${G.words.length} words found in ${fmtTime(secs)}.`);
      onScore(secs);
      onEnd({ score: secs, won: true, detail: `${THEMES.find(t => t.id === G.theme)?.name} · ${SIZES[G.size].name} ${G.n}×${G.n}` });
    }
    const can = () => !dead && !paused && G && !G.done;
    const begin = () => { if (!clk.running && can()) clk.start(); };

    /* ---------- pointer: press, drag along one of 8 directions, release ---------- */
    let drag = null;
    const cellPos = e => {
      const r = board.getBoundingClientRect(), w = r.width / G.n;
      return { fx: (e.clientX - r.left) / w, fy: (e.clientY - r.top) / (r.height / G.n) };
    };
    function snap(start, p) {
      const dx = p.fx - (start[0] + 0.5), dy = p.fy - (start[1] + 0.5);
      if (Math.hypot(dx, dy) < 0.6) return [start];
      const k = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
      const sx = Math.round(Math.cos(k * Math.PI / 4)), sy = Math.round(Math.sin(k * Math.PI / 4));
      let n = Math.round((dx * sx + dy * sy) / (sx * sx + sy * sy));
      const out = [];
      for (let i = 0; i <= Math.max(0, n); i++) {
        const x = start[0] + sx * i, y = start[1] + sy * i;
        if (x < 0 || y < 0 || x >= G.n || y >= G.n) break;
        out.push([x, y]);
      }
      return out;
    }
    L.on(board, 'pointerdown', e => {
      if (!can() || e.button !== 0) return;
      const p = cellPos(e);
      const x = Math.floor(p.fx), y = Math.floor(p.fy);
      if (x < 0 || y < 0 || x >= G.n || y >= G.n) return;
      e.preventDefault();
      begin();
      anchor = null; keyboardUsed = false;
      drag = { id: e.pointerId, start: [x, y] };
      sel = { cells: [[x, y]] };
      try { board.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      board.focus({ preventScroll: true });
      paint();
    });
    L.on(board, 'pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      sel = { cells: snap(drag.start, cellPos(e)) };
      paint();
    });
    const release = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const cells = sel && sel.cells;
      drag = null; sel = null;
      if (cells && can()) check(cells);
      paint();
    };
    L.on(board, 'pointerup', release);
    L.on(board, 'pointercancel', e => { if (drag && e.pointerId === drag.id) { drag = null; sel = null; paint(); } });

    /* ---------- keyboard ---------- */
    const MOVE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    L.on(window, 'keydown', e => {
      if (!can() || !ownsKey(root, e)) return;
      const k = e.key;
      if (MOVE[k]) {
        e.preventDefault(); keyboardUsed = true;
        cur = [Math.max(0, Math.min(G.n - 1, cur[0] + MOVE[k][0])), Math.max(0, Math.min(G.n - 1, cur[1] + MOVE[k][1]))];
        paint();
      } else if (k === ' ' || k === 'Enter') {
        if (k === 'Enter') return;                  /* Enter belongs to the Arcade (play again) */
        e.preventDefault(); if (e.repeat) return;
        keyboardUsed = true; begin();
        if (!anchor) { anchor = cur.slice(); say('First letter marked. Move to the last letter and press Space.'); paint(); return; }
        const cells = lineCells(anchor[0], anchor[1], cur[0], cur[1]);
        anchor = null;
        if (!cells || cells.length < 2) { say('Not a straight line. Start again.'); paint(); return; }
        check(cells); paint();
      } else if (k === 'Backspace') {
        e.preventDefault();
        if (anchor) { anchor = null; say('Selection cancelled.'); paint(); }
      }
    });

    L.on(themeSel, 'change', () => { if (!dead) deal(randomSeed(), themeSel.value, prefs.size); });
    L.on(seg, 'click', e => { const b = e.target.closest?.('button[data-size]'); if (b && !dead) deal(randomSeed(), prefs.theme, b.dataset.size); });
    L.on(newBtn, 'click', () => { if (!dead) deal(); });

    deal();
    requestAnimationFrame(() => { if (!dead) board.focus({ preventScroll: true }); });
    onScore(0);

    return {
      stop() {
        if (dead) return;
        dead = true;
        clk.dispose();
        L.clear();
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        paused = true; clk.stop(); drag = null; sel = null; anchor = null;
        if (!G.done) bw.appendChild(h('div.pz__cover', { text: 'Paused' }));
        paint();
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        bw.querySelector('.pz__cover')?.remove();
        if (!G.done && clk.secs > 0) clk.start();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => G && ({
        theme: G.theme, size: G.size, n: G.n, seed: G.seed, rows: G.rows.slice(),
        words: G.words.map(w => ({ word: w.word, x: w.x, y: w.y, dx: w.dx, dy: w.dy, found: w.found })),
        found: G.found, total: G.words.length, done: G.done, paused, secs: clk.secs, best: { ...bests }, anchor: anchor && anchor.slice(), cur: cur.slice(),
        struck: listEls.map((li, i) => (li.classList.contains('is-found') ? G.words[i].word : null)).filter(Boolean),
      }),
      /* test hook — nothing in the game calls it: deal({ seed, theme, size }) */
      hook(cmd, arg) {
        if (cmd === 'deal') deal(arg.seed, arg.theme || prefs.theme, arg.size || prefs.size);
        return true;
      },
    };
  },
};
