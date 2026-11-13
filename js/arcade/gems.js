/* ============================================================
   arcade/gems.js — Gem Swap for Static Arcade: match three on an
   8×8 board.

   Swap two neighbouring gems. A swap that makes a line of three or
   more is allowed and the line clears; any other swap slides over
   and bounces back, and costs nothing. Gems above a cleared gap fall,
   new ones drop in from the top, and a new match made that way is a
   cascade, worth more (x1, x2, x3 …).
   Special gems:
     · a line of 4 leaves a LINE gem (arrows show which way): when it
       is cleared in a match it also clears its whole row or column
       (a horizontal four clears a column, a vertical four a row)
     · a line of 5 or more leaves a COLOUR BOMB: swap it with any gem
       and every gem of that colour goes (two bombs clear the board)
   Specials caught in another special's blast go off too.
   When no swap can make a match the board shuffles itself. After
   6 seconds without a move the game points at one (H shows it at
   once). Each gem has its own shape as well as its own colour.

   Two ways to play: Timed (60 seconds from your first swap) or
   Moves (25 swaps). Score = points, higher is better; the best for
   each mode is kept on this device (portal.arcadePuzzles.gems).

   Controls
     mouse / touch  drag a gem toward a neighbour, or tap one gem and
                    then a neighbour
     keyboard       arrows move the cursor · Space picks a gem up ·
                    an arrow then swaps it that way · H hint
   Reduced motion: gems jump to their places, nothing pulses.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { clamp, hsl, FONT, fitView, surface, ownsKey, sounder, looper, rr, rng, randomSeed } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';

const GAME = 'gems';
const N = 8, CELL = 48, VW = N * CELL, VH = N * CELL;
const KINDS = 6;
const HUES = [352, 28, 52, 128, 200, 282];
const NAMES = ['ruby', 'amber', 'topaz', 'emerald', 'sapphire', 'amethyst'];
const MODES = { timed: { name: 'Timed', total: 60, tip: '60 seconds from your first swap' }, moves: { name: 'Moves', total: 25, tip: '25 swaps' } };
const HINT_AFTER = 6;
const ROWCLEAR = 1, COLCLEAR = 2, BOMB = 3;

const CSS = `${BASE}
.pz-gm__stage{touch-action:none}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    const sv = load(GAME);
    const bests = { ...(sv.best || {}) };
    let mode = MODES[sv.mode] ? sv.mode : 'timed';

    /* ---------- chrome ---------- */
    const modeBtns = Object.entries(MODES).map(([k, m]) => h('button', { type: 'button', dataset: { mode: k }, 'aria-pressed': 'false', title: m.tip }, m.name));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Game mode' }, modeBtns);
    const leftV = h('span', { text: '' });
    const leftRead = h('div.pz__read', { title: 'Time or moves left', 'aria-label': 'Left' }, icon('clock'), leftV);
    const scoreV = h('span', { text: '0' });
    const scoreRead = h('div.pz__read', { title: 'Score', 'aria-label': 'Score' }, icon('star'), scoreV);
    const bestV = h('small', { text: '' });
    const hintBtn = h('button.pz__btn', { type: 'button', title: 'Show a move (H)' }, icon('sparkles'), h('span.pz__long', { text: 'Hint' }));
    const newBtn = h('button.pz__btn', { type: 'button', title: 'New board' }, icon('refresh'), h('span.pz__long', { text: 'New' }));
    const top = h('div.pz__top', seg, scoreRead, leftRead, bestV, hintBtn, newBtn);
    const stage = h('div.pz__stage.pz-gm__stage');
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), h('style', { text: CSS }), top, stage, foot, live);
    el.appendChild(root);
    const sf = surface(stage, 'Gem Swap board', () => draw());
    let V = fitView(sf, VW, VH, 6);

    /* ---------- state ---------- */
    let seed = randomSeed(), rand = rng(seed);
    const S = {
      phase: 'idle',                  /* idle | swap | back | clear | fall */
      b: [], score: 0, moves: 0, time: 0, started: false, over: false, paused: false,
      casc: 0, idle: 0, hint: null, sel: null, cur: [3, 3], kbd: false, swapped: null, forced: [],
      t: 0, parts: [], bounces: 0, specials: 0, cleared: 0, ending: false, msg: '', shuffles: 0, bombSet: null,
    };
    const gem = (t, s = 0) => ({ t, s, x: 0, y: 0, v: 0, k: 1, dead: false });
    const spawn = () => gem(S.forced.length ? S.forced.shift() : Math.floor(rand() * KINDS));
    const place = (g, r, c) => { g.r = r; g.c = c; S.b[r][c] = g; };
    const snapAll = () => { for (const row of S.b) for (const g of row) if (g) { g.x = g.c; g.y = g.r; g.v = 0; } };
    const gems = () => S.b.flat().filter(Boolean);
    const say = m => { S.msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(S.msg ? h('span', { text: S.msg })
      : h('span.pz__hint', { html: 'drag or tap two neighbours · <kbd>←↑↓→</kbd> + <kbd>Space</kbd> · <kbd>H</kbd> hint · 4 in a line makes a line gem, 5 a colour bomb' }));

    /* ---------- rules ---------- */
    const tOf = (b, r, c) => { const g = b[r]?.[c]; return g ? (g.s === BOMB ? -1 : g.t) : -2; };
    /* runs of 3+ in a grid of gems: [{ cells: [[r,c]…], dir: 'h'|'v' }] */
    function runs(b) {
      const out = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N;) {
        const t = tOf(b, r, c);
        let e = c + 1;
        while (t >= 0 && e < N && tOf(b, r, e) === t) e++;
        if (t >= 0 && e - c >= 3) out.push({ dir: 'h', cells: Array.from({ length: e - c }, (_, i) => [r, c + i]) });
        c = e;
      }
      for (let c = 0; c < N; c++) for (let r = 0; r < N;) {
        const t = tOf(b, r, c);
        let e = r + 1;
        while (t >= 0 && e < N && tOf(b, e, c) === t) e++;
        if (t >= 0 && e - r >= 3) out.push({ dir: 'v', cells: Array.from({ length: e - r }, (_, i) => [r + i, c]) });
        r = e;
      }
      return out;
    }
    const swapIn = (b, a, d) => { const t = b[a[0]][a[1]]; b[a[0]][a[1]] = b[d[0]][d[1]]; b[d[0]][d[1]] = t; };
    /* would swapping a and d be a legal move? */
    function legal(a, d) {
      const x = S.b[a[0]][a[1]], y = S.b[d[0]][d[1]];
      if (!x || !y) return false;
      if (x.s === BOMB || y.s === BOMB) return true;
      swapIn(S.b, a, d);
      const ok = runs(S.b).length > 0;
      swapIn(S.b, a, d);
      return ok;
    }
    function findMove() {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (c + 1 < N && legal([r, c], [r, c + 1])) return [[r, c], [r, c + 1]];
        if (r + 1 < N && legal([r, c], [r + 1, c])) return [[r, c], [r + 1, c]];
      }
      return null;
    }
    function fresh() {
      for (let tries = 0; tries < 200; tries++) {
        S.b = Array.from({ length: N }, () => new Array(N).fill(null));
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
          let t, k = 0;
          do { t = Math.floor(rand() * KINDS); k++; }
          while (k < 30 && ((c >= 2 && tOf(S.b, r, c - 1) === t && tOf(S.b, r, c - 2) === t) || (r >= 2 && tOf(S.b, r - 1, c) === t && tOf(S.b, r - 2, c) === t)));
          place(gem(t), r, c);
        }
        if (!runs(S.b).length && findMove()) break;
      }
      snapAll();
    }

    /* ---------- a turn ---------- */
    const MODE_TOTAL = () => MODES[mode].total;
    function newGame(s = randomSeed()) {
      seed = s; rand = rng(seed);
      Object.assign(S, { phase: 'idle', score: 0, moves: MODE_TOTAL(), time: MODE_TOTAL(), started: false, over: false, paused: false, casc: 0, idle: 0, hint: null, sel: null, swapped: null, forced: [], parts: [], bounces: 0, specials: 0, cleared: 0, ending: false, msg: '', shuffles: 0, bombSet: null });
      fresh();
      onScore(0);
      loop.start();
      paintBar(); draw();
    }
    function trySwap(a, d) {
      if (S.phase !== 'idle' || S.over || S.paused) return;
      if (Math.abs(a[0] - d[0]) + Math.abs(a[1] - d[1]) !== 1) return;
      S.sel = null; S.hint = null; S.idle = 0; S.msg = ''; S.kbd = S.kbd;
      swapIn(S.b, a, d);
      S.b[a[0]][a[1]].r = a[0]; S.b[a[0]][a[1]].c = a[1];
      S.b[d[0]][d[1]].r = d[0]; S.b[d[0]][d[1]].c = d[1];
      S.swapped = { a, d };
      S.phase = 'swap';
      snd.wake(); snd.blip(440, 0.05, 'triangle', 0.6);
      if (reduced) snapAll();
    }
    /* the swap has landed: does it do anything? */
    function afterSwap() {
      const { a, d } = S.swapped;
      const x = S.b[a[0]][a[1]], y = S.b[d[0]][d[1]];
      let forced = null;
      if (x.s === BOMB || y.s === BOMB) {
        forced = new Set();
        if (x.s === BOMB && y.s === BOMB) gems().forEach(g => forced.add(g.r * N + g.c));
        else {
          const bomb = x.s === BOMB ? x : y, other = bomb === x ? y : x;
          forced.add(bomb.r * N + bomb.c);
          for (const g of gems()) if (g.s !== BOMB && g.t === other.t) forced.add(g.r * N + g.c);
        }
      } else if (!runs(S.b).length) {
        /* nothing: slide back */
        swapIn(S.b, a, d);
        S.b[a[0]][a[1]].r = a[0]; S.b[a[0]][a[1]].c = a[1];
        S.b[d[0]][d[1]].r = d[0]; S.b[d[0]][d[1]].c = d[1];
        S.phase = 'back'; S.bounces++;
        snd.blip(180, 0.12, 'sawtooth', 0.5, 120);
        say('No match there: it bounces back.');
        if (reduced) snapAll();
        return;
      }
      /* a legal move */
      S.started = true;
      if (mode === 'moves') S.moves--;
      S.casc = 0;
      resolve(S.swapped, forced);
      S.swapped = null;
    }
    /* clear what matches (or the forced set), mark what is made */
    function resolve(swap, forced) {
      const rs = forced ? [] : runs(S.b);
      if (!forced && !rs.length) { settle(); return; }
      const clear = new Set(forced || []);
      const make = [];                      /* special gems left behind: { r, c, t, s } */
      for (const run of rs) {
        run.cells.forEach(([r, c]) => clear.add(r * N + c));
        if (run.cells.length >= 4) {
          let at = run.cells[Math.floor(run.cells.length / 2)];
          if (swap) for (const sc of [swap.a, swap.d]) if (run.cells.some(([r, c]) => r === sc[0] && c === sc[1])) at = sc;
          const g = S.b[at[0]][at[1]];
          make.push({ r: at[0], c: at[1], t: g.t, s: run.cells.length >= 5 ? BOMB : run.dir === 'h' ? COLCLEAR : ROWCLEAR });
        }
      }
      /* line gems in the blast set off their lines, and so on */
      const todo = [...clear];
      while (todo.length) {
        const i = todo.pop(), g = S.b[Math.floor(i / N)][i % N];
        if (!g || (g.s !== ROWCLEAR && g.s !== COLCLEAR)) continue;
        for (let k = 0; k < N; k++) {
          const j = g.s === ROWCLEAR ? g.r * N + k : k * N + g.c;
          if (!clear.has(j)) { clear.add(j); todo.push(j); }
        }
      }
      for (const m of make) clear.delete(m.r * N + m.c);
      const n = clear.size;
      const pts = Math.round(n * 10 * (1 + S.casc * 0.5)) + make.length * 20;
      S.score += pts; S.cleared += n; S.specials += make.length;
      onScore(S.score);
      for (const i of clear) {
        const g = S.b[Math.floor(i / N)][i % N];
        if (!g) continue;
        g.dead = true;
        if (!reduced) for (let q = 0; q < 3; q++) S.parts.push({ x: g.c + 0.5, y: g.r + 0.5, vx: (rand() - 0.5) * 5, vy: (rand() - 0.7) * 5, life: 0.45, hue: g.s === BOMB ? 0 : HUES[g.t] });
      }
      for (const m of make) { const g = S.b[m.r][m.c]; g.s = m.s; if (m.s === BOMB) g.t = -1; }
      S.make = make;
      S.t = reduced ? 0.02 : 0.22;
      S.phase = 'clear';
      snd.blip(520 + S.casc * 110, 0.1, 'triangle', 0.8, 700 + S.casc * 140);
      if (make.length) snd.blip(900, 0.2, 'square', 0.5, 1500);
      if (S.casc > 0) say(`Cascade x${S.casc + 1}!`);
    }
    function drop() {
      /* remove the cleared gems, let the rest fall, deal new ones from above */
      for (let c = 0; c < N; c++) {
        const col = [];
        for (let r = N - 1; r >= 0; r--) { const g = S.b[r][c]; if (g && !g.dead) col.push(g); }
        for (let r = N - 1, i = 0; r >= 0; r--, i++) {
          if (i < col.length) place(col[i], r, c);
          else { const g = spawn(); g.x = c; g.y = -1 - (r < 0 ? 0 : (N - 1 - r) * 0) - (N - 1 - i) * 0 - (i - col.length); place(g, r, c); }
        }
      }
      if (reduced) snapAll();
      S.casc++;
      S.phase = 'fall';
    }
    /* nothing left to match: the turn is over */
    function settle() {
      S.phase = 'idle'; S.casc = 0; S.idle = 0;
      if (S.ending || (mode === 'moves' && S.moves <= 0 && S.started)) { finish(); return; }
      if (!findMove()) {
        /* no move left: shuffle the gems we have until there is one and nothing already matches */
        S.shuffles++;
        const all = gems();
        for (let tries = 0; tries < 300; tries++) {
          for (let k = all.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [all[k], all[j]] = [all[j], all[k]]; }
          all.forEach((g, i) => place(g, Math.floor(i / N), i % N));
          if (!runs(S.b).length && findMove()) break;
        }
        if (reduced) snapAll();
        say('No moves left: shuffling.');
        S.phase = 'fall';
      }
    }
    function finish() {
      if (S.over) return;
      S.over = true; S.phase = 'idle';
      const prev = bests[mode];
      if (prev == null || S.score > prev) { bests[mode] = S.score; save(GAME, { best: bests }); }
      loop.stop();
      paintBar(); draw();
      onEnd({ score: S.score, won: false, detail: `${MODES[mode].name} · ${S.cleared} gems cleared${S.specials ? ` · ${S.specials} special${S.specials > 1 ? 's' : ''}` : ''}` });
    }

    /* ---------- time ---------- */
    function update(dt) {
      if (S.paused || S.over) return;
      if (mode === 'timed' && S.started && !S.ending) {
        S.time = Math.max(0, S.time - dt);
        if (S.time <= 0) { S.ending = true; if (S.phase === 'idle') finish(); }
      }
      /* gems glide toward their cells */
      let moving = false;
      for (const g of gems()) {
        const dx = g.c - g.x;
        if (Math.abs(dx) > 0.001) { g.x += Math.sign(dx) * Math.min(Math.abs(dx), 10 * dt); moving = true; } else g.x = g.c;
        if (g.y < g.r - 0.001) { g.v = Math.min(22, g.v + 46 * dt); g.y = Math.min(g.r, g.y + g.v * dt); moving = true; }
        else if (g.y > g.r + 0.001) { g.y = Math.max(g.r, g.y - 10 * dt); moving = true; } else { g.y = g.r; g.v = 0; }
      }
      if (S.phase === 'swap' && !moving) afterSwap();
      else if (S.phase === 'back' && !moving) { S.phase = 'idle'; S.swapped = null; }
      else if (S.phase === 'clear') {
        S.t -= dt;
        for (const g of gems()) if (g.dead) g.k = Math.max(0, S.t / 0.22);
        if (S.t <= 0) { drop(); }
      } else if (S.phase === 'fall' && !moving) resolve(null, null);
      else if (S.phase === 'idle') {
        S.idle += dt;
        if (S.idle > HINT_AFTER && !S.hint) S.hint = findMove();
      }
      for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 12 * dt; p.life -= dt; }
      S.parts = S.parts.filter(p => p.life > 0);
      if (S.phase === 'idle' && S.ending && !S.over) finish();
      S.tick = (S.tick || 0) + dt;
      if (S.tick > 0.25) { S.tick = 0; paintBar(); }
    }
    const loop = looper(dt => { update(dt); draw(); });
    function paintBar() {
      scoreV.textContent = String(S.score);
      leftV.textContent = mode === 'timed' ? `${Math.ceil(S.time)} s` : `${S.moves} moves`;
      bestV.textContent = bests[mode] != null ? `Best ${MODES[mode].name}: ${bests[mode]}` : '';
      modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      paintFoot();
    }

    /* ---------- drawing ---------- */
    function shape(g, t, cx, cy, R) {
      g.beginPath();
      if (t === 0) g.arc(cx, cy, R, 0, Math.PI * 2);
      else if (t === 1) { g.moveTo(cx, cy - R * 1.1); g.lineTo(cx + R * 1.1, cy); g.lineTo(cx, cy + R * 1.1); g.lineTo(cx - R * 1.1, cy); g.closePath(); }
      else if (t === 2) { rr(g, cx - R * 0.9, cy - R * 0.9, R * 1.8, R * 1.8, R * 0.35); }
      else if (t === 3) { g.moveTo(cx, cy - R * 1.05); g.lineTo(cx + R * 1.1, cy + R * 0.85); g.lineTo(cx - R * 1.1, cy + R * 0.85); g.closePath(); }
      else if (t === 4) { for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * R * 1.08, cy + Math.sin(a) * R * 1.08); } g.closePath(); }
      else { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + Math.PI / 5 * i, rad = i % 2 ? R * 0.55 : R * 1.15; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } g.closePath(); }
    }
    function drawGem(g, o) {
      const cx = (o.x + 0.5) * CELL, cy = (o.y + 0.5) * CELL, R = CELL * 0.34 * (reduced ? (o.dead ? 0 : 1) : o.k);
      if (R <= 0.5) return;
      if (o.s === BOMB) {
        const gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 1, cx, cy, R * 1.1);
        gr.addColorStop(0, '#5a5f7a'); gr.addColorStop(1, '#14161f');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 1.1, 0, Math.PI * 2); g.fill();
        for (let i = 0; i < KINDS; i++) { g.strokeStyle = hsl(HUES[i], 90, 62); g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R * 0.82, i * Math.PI / 3, (i + 0.85) * Math.PI / 3); g.stroke(); }
        g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, R * 0.22, 0, Math.PI * 2); g.fill();
        return;
      }
      const hu = HUES[o.t];
      const gr = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, 1, cx, cy, R * 1.2);
      gr.addColorStop(0, hsl(hu, 90, 74)); gr.addColorStop(1, hsl(hu, 80, 40));
      g.fillStyle = gr; shape(g, o.t, cx, cy, R); g.fill();
      g.strokeStyle = hsl(hu, 90, 82, 0.8); g.lineWidth = 1.5; g.stroke();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(cx - R * 0.35, cy - R * 0.4, R * 0.16, 0, Math.PI * 2); g.fill();
      if (o.s === ROWCLEAR || o.s === COLCLEAR) {
        g.strokeStyle = '#fff'; g.lineWidth = 2.4; g.lineCap = 'round';
        const v = o.s === ROWCLEAR ? [1, 0] : [0, 1], L2 = R * 0.95;
        g.beginPath();
        g.moveTo(cx - v[0] * L2, cy - v[1] * L2); g.lineTo(cx + v[0] * L2, cy + v[1] * L2);
        g.moveTo(cx + v[0] * L2, cy + v[1] * L2); g.lineTo(cx + v[0] * (L2 - 6) + v[1] * 5, cy + v[1] * (L2 - 6) + v[0] * 5);
        g.moveTo(cx + v[0] * L2, cy + v[1] * L2); g.lineTo(cx + v[0] * (L2 - 6) - v[1] * 5, cy + v[1] * (L2 - 6) - v[0] * 5);
        g.moveTo(cx - v[0] * L2, cy - v[1] * L2); g.lineTo(cx - v[0] * (L2 - 6) + v[1] * 5, cy - v[1] * (L2 - 6) + v[0] * 5);
        g.moveTo(cx - v[0] * L2, cy - v[1] * L2); g.lineTo(cx - v[0] * (L2 - 6) - v[1] * 5, cy - v[1] * (L2 - 6) - v[0] * 5);
        g.stroke();
      }
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 6);
      g.fillStyle = '#04060a'; g.fillRect(0, 0, sf.w, sf.h);
      g.save(); g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.fillStyle = '#0e0b18'; rr(g, -4, -4, VW + 8, VH + 8, 10); g.fill();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { g.fillStyle = (r + c) % 2 ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.07)'; g.fillRect(c * CELL, r * CELL, CELL, CELL); }
      g.save(); g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      for (const o of gems()) drawGem(g, o);
      for (const p of S.parts) { g.fillStyle = hsl(p.hue, 90, 70, clamp(p.life * 3, 0, 1)); g.fillRect(p.x * CELL - 2, p.y * CELL - 2, 4, 4); }
      g.restore();
      /* hint, selection, cursor */
      const ring = (r, c, col, w, pad = 2) => { g.strokeStyle = col; g.lineWidth = w; rr(g, c * CELL + pad, r * CELL + pad, CELL - pad * 2, CELL - pad * 2, 8); g.stroke(); };
      if (S.hint && S.phase === 'idle' && !S.over) {
        const a = reduced ? 0.9 : 0.5 + 0.5 * Math.sin(performance.now() / 180);
        for (const [r, c] of S.hint) ring(r, c, `rgba(255,224,120,${a})`, 3);
      }
      if (S.sel) ring(S.sel[0], S.sel[1], '#fff', 3);
      if (S.kbd && !S.over) ring(S.cur[0], S.cur[1], 'rgba(120,200,255,.9)', 2, 4);
      g.restore();
      if (S.over) {
        g.fillStyle = 'rgba(4,6,10,.55)'; g.fillRect(0, 0, sf.w, sf.h);
      }
    }

    /* ---------- input ---------- */
    const cellAt = e => {
      const r = sf.cv.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left - V.ox) / V.s) / CELL), y = Math.floor(((e.clientY - r.top - V.oy) / V.s) / CELL);
      return x < 0 || y < 0 || x >= N || y >= N ? null : [y, x];
    };
    let drag = null;
    L.on(sf.cv, 'pointerdown', e => {
      if (S.over || S.paused || S.phase !== 'idle') return;
      const c = cellAt(e);
      if (!c) return;
      e.preventDefault();
      S.kbd = false; S.hint = null; S.idle = 0;
      snd.wake();
      if (S.sel && Math.abs(S.sel[0] - c[0]) + Math.abs(S.sel[1] - c[1]) === 1) { trySwap(S.sel, c); return; }
      const was = S.sel && S.sel[0] === c[0] && S.sel[1] === c[1];
      S.sel = c;
      drag = { id: e.pointerId, c, x: e.clientX, y: e.clientY, was };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      if (!loop.on) draw();
    });
    L.on(sf.cv, 'pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      const need = CELL * V.s * 0.4;
      if (Math.hypot(dx, dy) < need) return;
      const d = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
      const to = [drag.c[0] + d[0], drag.c[1] + d[1]];
      const from = drag.c;
      drag = null;
      if (to[0] >= 0 && to[1] >= 0 && to[0] < N && to[1] < N) trySwap(from, to);
    });
    const up = e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.was) S.sel = null;
      drag = null;
    };
    L.on(sf.cv, 'pointerup', up);
    L.on(sf.cv, 'pointercancel', up);
    const MOVE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    L.on(window, 'keydown', e => {
      if (S.over || S.paused || !ownsKey(root, e)) return;
      const k = e.key;
      if (MOVE[k]) {
        e.preventDefault(); S.kbd = true; S.idle = 0; S.hint = null; snd.wake();
        const d = MOVE[k];
        if (S.sel) { const from = S.sel, to = [from[0] + d[0], from[1] + d[1]]; if (to[0] >= 0 && to[1] >= 0 && to[0] < N && to[1] < N) { S.cur = to; trySwap(from, to); } }
        else S.cur = [clamp(S.cur[0] + d[0], 0, N - 1), clamp(S.cur[1] + d[1], 0, N - 1)];
      } else if (k === ' ') {
        e.preventDefault(); if (e.repeat || S.phase !== 'idle') return;
        S.kbd = true; S.idle = 0; S.hint = null; snd.wake();
        S.sel = S.sel && S.sel[0] === S.cur[0] && S.sel[1] === S.cur[1] ? null : S.cur.slice();
      } else if (k === 'h' || k === 'H') {
        e.preventDefault(); if (!e.repeat && S.phase === 'idle') { S.hint = findMove(); S.idle = 0; }
      } else return;
      if (!loop.on) draw();
    });
    L.on(seg, 'click', e => { const b = e.target.closest?.('button[data-mode]'); if (b && b.dataset.mode !== mode) { mode = b.dataset.mode; save(GAME, { mode }); newGame(); } });
    L.on(hintBtn, 'click', () => { if (S.phase === 'idle' && !S.over && !S.paused) { S.hint = findMove(); S.idle = 0; if (!loop.on) draw(); } });
    L.on(newBtn, 'click', () => newGame());

    newGame();
    say(`Swap two neighbouring gems to make a line of three. ${MODES[mode].tip}.`);

    return {
      stop() {
        loop.stop();
        L.clear();
        snd.close();
        sf.destroy();
        root.remove();
      },
      pause() { S.paused = true; loop.stop(); draw(); },
      resume() { S.paused = false; if (!S.over) loop.start(); },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        phase: S.phase, score: S.score, moves: S.moves, time: S.time, mode, started: S.started, over: S.over, paused: S.paused, casc: S.casc,
        grid: S.b.map(row => row.map(g => (g ? { t: g.t, s: g.s } : null))), hint: S.hint, sel: S.sel, cur: S.cur,
        bounces: S.bounces, specials: S.specials, cleared: S.cleared, shuffles: S.shuffles, seed, best: { ...bests },
        geom: { ox: V.ox, oy: V.oy, cell: CELL * V.s },
      }),
      /* test hook — nothing in the game calls it:
         board(rows of 8 digits 0–5) · special({ r, c, s: 1 row | 2 column | 3 bomb }) · queue([types]) · seed(n) ·
         moves(n) · time(s) · step(seconds) · mode('timed'|'moves') · settle() */
      hook(cmd, arg) {
        if (cmd === 'board') {
          S.b = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => { const g = gem(Number(arg[r][c])); g.r = r; g.c = c; return g; }));
          snapAll(); S.phase = 'idle'; S.sel = null; S.hint = null; S.idle = 0; S.parts = [];
        } else if (cmd === 'special') { const g = S.b[arg.r][arg.c]; g.s = arg.s; if (arg.s === BOMB) g.t = -1; }
        else if (cmd === 'queue') S.forced = arg.slice();
        else if (cmd === 'seed') newGame(arg);
        else if (cmd === 'moves') S.moves = arg;
        else if (cmd === 'time') S.time = arg;
        else if (cmd === 'step') { for (let t = 0; t < arg; t += 1 / 60) update(1 / 60); }
        else if (cmd === 'settle') settle();
        else if (cmd === 'mode') { mode = arg; save(GAME, { mode }); newGame(); }
        draw();
        return true;
      },
    };
  },
};
