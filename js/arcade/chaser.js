/* ============================================================
   arcade/chaser.js — Dot Chaser for Static Arcade.

   You are a little glow-bot in a walled garden of 151 dots. Eat every
   dot to clear the level; four ghosts patrol it, each with its own
   way of hunting you:

     Dusk    (violet)  heads straight for you
     Snare   (gold)    aims four tiles in front of you, to cut you off
     Mirage  (jade)    aims at the spot opposite you across the maze
     Drift   (green)   hunts you when you are far, wanders when close

   · Ghosts follow a scatter / chase timer: they spend a few seconds
     sulking in their own corners, then hunt, and so on.
   · The four big pellets turn the ghosts to static for a few seconds
     (less as levels rise): touch one then and it is eaten for 200, 400,
     800, 1600 and sent home as a pair of eyes.
   · The row through the middle is a tunnel; it wraps round and slows
     ghosts down.
   · A fruit shows up twice a level, for nine seconds.
   · Three lives; a normal ghost's touch costs one. Each level the ghosts
     and you get a little faster and the pellets a little shorter.

   Score: dot 10, pellet 50, fruit 100-1000, ghosts 200..1600.
   Look: StaticOS's own. The walls are raised slabs in the accent colour
   (ctx.accent, so they follow Settings), you are a silver bot, and a
   pellet turns the ghosts to grey static rather than any one colour.
   Keys: arrows / WASD turn. Touch / mouse: swipe a direction, or tap
   the side of the player you want to go to.
   Test hook (el.arcadeHook): inert unless called; see the end of mount().
   ============================================================ */
import { clamp, hsl, FONT, coarse, fitView, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';

const MAZE = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.### # ###.####',
  '####.#       #.####',
  '####.# ##-## #.####',
  '    .  #HHH#  .    ',
  '####.# ##### #.####',
  '####.#       #.####',
  '####.# ##### #.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#...........#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################',
];
const COLS = 19, ROWS = MAZE.length, CELL = 24, HUD = 34;
const VW = COLS * CELL, VH = ROWS * CELL + HUD;
const START = { c: 9, r: 15 }, DOOR = { c: 9, r: 8 }, HOME = { c: 9, r: 9 }, OUT = { c: 9, r: 7 };
const DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]];          /* ties go up, left, down, right */
const GHOSTS = [
  { name: 'Dusk',   hue: 270, corner: [17, 1],  out: 0 },
  { name: 'Snare',  hue: 50,  corner: [1, 1],   out: 2.2 },
  { name: 'Mirage', hue: 158, corner: [17, 19], out: 5 },
  { name: 'Drift',  hue: 100, corner: [1, 19],  out: 8 },
];
const FRUITS = [
  { name: 'plum', pts: 100, hue: 285 }, { name: 'lime', pts: 300, hue: 90 }, { name: 'orange', pts: 500, hue: 28 },
  { name: 'apple', pts: 700, hue: 355 }, { name: 'melon', pts: 1000, hue: 140 },
];
const EAT_PTS = [200, 400, 800, 1600];
const SCHEDULE = [7, 20, 7, 20, 5, 20, 5, Infinity];       /* scatter, chase, scatter, ... */
const TOTAL_DOTS = MAZE.join('').split('').filter(c => c === '.' || c === 'o').length;
const wrapC = c => (c + COLS) % COLS;
const tile = (c, r) => (r < 0 || r >= ROWS ? '#' : MAZE[r][wrapC(c)]);

/* hue and saturation of any CSS colour (the accent may be hex, rgb() or
   a name): the canvas normalises it to #rrggbb or rgba(). */
function hueSat(css) {
  try {
    const g = document.createElement('canvas').getContext('2d');
    g.fillStyle = '#ff456d'; g.fillStyle = css || '#ff456d';
    const v = String(g.fillStyle);
    const [r, gr, b] = v[0] === '#' ? [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16) / 255) : v.match(/[\d.]+/g).slice(0, 3).map(n => +n / 255);
    const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b), d = mx - mn, l = (mx + mn) / 2;
    if (!d) return { h: 0, s: 0 };
    const h = mx === r ? ((gr - b) / d) % 6 : mx === gr ? (b - r) / d + 2 : (r - gr) / d + 4;
    return { h: Math.round((h * 60 + 360) % 360), s: Math.round(100 * d / (1 - Math.abs(2 * l - 1))) };
  } catch { return { h: 347, s: 100 }; }
}

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const AC = hueSat(ctx.accent), AH = AC.h, AS = Math.min(90, AC.s);    /* the walls' colour */
    const S = {
      state: 'ready',                     /* ready | play | dying | clear | over */
      paused: false, manual: false, frozen: false,
      score: 0, lives: 3, level: 1, time: 0, extra: false,
      dots: [], left: 0, eaten: 0,
      p: null, ghosts: [], want: [-1, 0],
      mode: 'scatter', modeI: 0, modeT: 0, fright: 0, chain: 0,
      hold: 0, endT: 0, fruit: null, fruitsShown: 0, pops: [], parts: [], flash: 0,
    };
    const sf = surface(el, 'Dot Chaser field', () => draw());
    let V = fitView(sf, VW, VH);

    /* ------------------------------ set-up ------------------------------ */
    const lvl = () => S.level - 1;
    const pace = () => Math.min(1.4, 1 + 0.05 * lvl());
    const frightLen = () => Math.max(1.6, 7 - 0.9 * lvl());

    function placeActors() {
      S.p = { c: START.c, r: START.r, dx: 0, dy: 0, f: 0, face: [-1, 0], mouth: 0 };
      S.want = [-1, 0];
      S.ghosts = GHOSTS.map((G, i) => ({
        i, ...G, c: i === 0 ? OUT.c : 8 + (i - 1), r: i === 0 ? OUT.r : HOME.r, dx: i === 0 ? -1 : 0, dy: 0, f: 0,
        state: i === 0 ? 'normal' : 'house', wait: G.out * Math.max(0.35, 1 - 0.12 * lvl()), fr: false,
      }));
      S.mode = 'scatter'; S.modeI = 0; S.modeT = SCHEDULE[0] * Math.max(0.5, 1 - 0.1 * lvl());
      S.fright = 0; S.chain = 0; S.fruit = null;
    }
    function newLevel() {
      S.dots = MAZE.map(row => [...row].map(ch => ch === '.' || ch === 'o'));
      S.left = TOTAL_DOTS; S.eaten = 0; S.fruitsShown = 0;
      placeActors();
      S.hold = 1.3;
    }
    newLevel();
    S.hold = 0;
    ctx.onScore(0);

    /* ------------------------------ movement ------------------------------ */
    const openFor = (c, r, kind) => {
      const ch = tile(c, r);
      if (ch === '#') return false;
      if (ch === '-') return kind === 'door';
      if (ch === 'H') return kind === 'door';
      return true;
    };
    const isRev = (e, d) => d[0] === -e.dx && d[1] === -e.dy;

    /* a breadth-first first step from (c,r) toward (tc,tr), doors open */
    function stepToward(c, r, tc, tr) {
      if (c === tc && r === tr) return null;
      const seen = new Map(); const q = [];
      for (const d of DIRS) {
        const nc = wrapC(c + d[0]), nr = r + d[1];
        if (!openFor(nc, nr, 'door')) continue;
        seen.set(nc + ',' + nr, d); q.push([nc, nr]);
      }
      for (let h = 0; h < q.length; h++) {
        const [qc, qr] = q[h];
        if (qc === tc && qr === tr) return seen.get(qc + ',' + qr);
        for (const d of DIRS) {
          const nc = wrapC(qc + d[0]), nr = qr + d[1], k = nc + ',' + nr;
          if (seen.has(k) || !openFor(nc, nr, 'door')) continue;
          seen.set(k, seen.get(qc + ',' + qr)); q.push([nc, nr]);
        }
      }
      return null;
    }

    function advance(e, dist, choose, arrive) {
      let guard = 8;
      while (dist > 1e-6 && guard-- > 0) {
        if (e.dx === 0 && e.dy === 0) {
          const d = choose(e);
          if (!d) return;
          e.dx = d[0]; e.dy = d[1]; e.f = 0;
        }
        const need = 1 - e.f;
        if (dist < need) { e.f += dist; return; }
        dist -= need;
        e.c = wrapC(e.c + e.dx); e.r += e.dy; e.f = 0;
        arrive(e);
        const d = choose(e);
        if (d) { e.dx = d[0]; e.dy = d[1]; } else { e.dx = 0; e.dy = 0; return; }
      }
    }
    /* turn round in the middle of a step */
    function flip(e) {
      if (e.dx === 0 && e.dy === 0) return;
      e.c = wrapC(e.c + e.dx); e.r += e.dy; e.f = 1 - e.f; e.dx = -e.dx; e.dy = -e.dy;
      if (e.f >= 1) e.f = 0.999;
    }
    const px = e => e.c + e.dx * e.f, py = e => e.r + e.dy * e.f;

    /* ------------------------------ the player ------------------------------ */
    function steer(dx, dy) {
      S.want = [dx, dy];
      const p = S.p;
      if (S.state === 'ready') S.state = 'play';
      if (p.dx === -dx && p.dy === -dy && (dx || dy)) flip(p);
      snd.wake();
    }
    const pChoose = e => {
      const w = S.want;
      if (openFor(wrapC(e.c + w[0]), e.r + w[1], 'floor')) { e.face = w.slice(); return w; }
      if ((e.dx || e.dy) && openFor(wrapC(e.c + e.dx), e.r + e.dy, 'floor')) return [e.dx, e.dy];
      return null;
    };
    function eat(e) {
      const { c, r } = e;
      if (S.dots[r]?.[c]) {
        const big = tile(c, r) === 'o';
        S.dots[r][c] = false; S.left--; S.eaten++;
        addScore(big ? 50 : 10);
        snd.blip(big ? 300 : 520 + (S.eaten % 2) * 90, big ? 0.18 : 0.04, 'square', 0.5);
        if (big) frighten();
        if (S.fruitsShown < 2 && S.eaten >= (S.fruitsShown ? 100 : 40)) { S.fruitsShown++; S.fruit = { t: 9, ...FRUITS[Math.min(FRUITS.length - 1, lvl())] }; }
        if (S.left <= 0) levelDone();
      }
      if (S.fruit && c === OUT.c && r === OUT.r) {
        addScore(S.fruit.pts); pop(`${S.fruit.pts}`, c, r, 50);
        snd.blip(700, 0.2, 'triangle', 0.9, 1400);
        S.fruit = null;
      }
    }
    function addScore(n) {
      const before = S.score;
      S.score += n;
      ctx.onScore(S.score);
      if (!S.extra && before < 10000 && S.score >= 10000) { S.extra = true; S.lives++; snd.blip(660, 0.3, 'triangle', 0.9, 1320); }
    }
    function pop(text, c, r, hue) { S.pops.push({ text, x: c + 0.5, y: r, t: 0.9, hue }); }

    function frighten() {
      S.fright = frightLen(); S.chain = 0;
      for (const g of S.ghosts) if (g.state === 'normal' || g.state === 'exit' || g.state === 'house') {
        g.fr = true;
        if (g.state === 'normal') flip(g);
      }
    }

    /* ------------------------------ the ghosts ------------------------------ */
    function target(g) {
      if (S.mode === 'scatter') return g.corner;
      const p = S.p, pc = p.c + p.dx * (p.f > 0.5 ? 1 : 0), pr = p.r + p.dy * (p.f > 0.5 ? 1 : 0);
      const fx = p.face[0], fy = p.face[1];
      if (g.i === 0) return [pc, pr];
      if (g.i === 1) return [pc + fx * 4, pr + fy * 4];
      if (g.i === 2) return [COLS - 1 - pc, ROWS - 1 - pr];
      return Math.hypot(pc - g.c, pr - g.r) > 6 ? [pc, pr] : g.corner;
    }
    const gChoose = g => {
      if (g.state === 'eyes') { const d = stepToward(g.c, g.r, HOME.c, HOME.r); return d; }
      if (g.state === 'exit') return stepToward(g.c, g.r, OUT.c, OUT.r);
      if (g.state === 'house') return null;
      const opts = DIRS.filter(d => openFor(wrapC(g.c + d[0]), g.r + d[1], 'floor') && !isRev(g, d));
      if (!opts.length) { const back = [-g.dx, -g.dy]; return openFor(wrapC(g.c + back[0]), g.r + back[1], 'floor') ? back : null; }
      if (g.fr) return opts[Math.floor(Math.random() * opts.length)];
      if (g.i === 3 && Math.hypot(S.p.c - g.c, S.p.r - g.r) < 4 && Math.random() < 0.5) return opts[Math.floor(Math.random() * opts.length)];
      const [tx, ty] = target(g);
      let best = opts[0], bd = Infinity;
      for (const d of opts) {
        const dd = (wrapC(g.c + d[0]) - tx) ** 2 + (g.r + d[1] - ty) ** 2;
        if (dd < bd) { bd = dd; best = d; }
      }
      return best;
    };
    const gArrive = g => {
      if (g.state === 'eyes' && g.c === HOME.c && g.r === HOME.r) { g.state = 'exit'; g.fr = false; }
      if (g.state === 'exit' && g.c === OUT.c && g.r === OUT.r) g.state = 'normal';
    };
    const gSpeed = g => {
      if (g.state === 'eyes') return 14;
      if (g.state === 'exit' || g.state === 'house') return 4.5;
      if (g.r === 9 && (g.c <= 3 || g.c >= 15)) return 3.4;
      return (g.fr ? 3.8 : 6.3) * pace();
    };

    /* ------------------------------ rules ------------------------------ */
    function levelDone() {
      if (S.state !== 'play') return;
      S.state = 'clear'; S.endT = 0; S.fruit = null;
      snd.blip(880, 0.5, 'square', 0.8, 1760);
    }
    function die() {
      if (S.state !== 'play') return;
      S.state = 'dying'; S.endT = 0; S.lives--;
      S.parts = []; burst(px(S.p) + 0.5, py(S.p) + 0.5, AH, 18);
      snd.blip(300, 0.7, 'sawtooth', 0.9, 40);
    }
    function burst(x, y, hue, n) {
      if (reduced) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 3;
        S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, hue });
      }
    }

    function sub(dt) {
      S.time += dt;
      if (S.state === 'play') {
        if (S.hold > 0) { S.hold -= dt; return; }
        /* scatter / chase, paused while the ghosts are static */
        if (S.fright > 0) {
          S.fright -= dt;
          if (S.fright <= 0) { S.fright = 0; S.chain = 0; for (const g of S.ghosts) g.fr = false; }
        } else if (S.modeI < SCHEDULE.length - 1) {
          S.modeT -= dt;
          if (S.modeT <= 0) {
            S.modeI++;
            S.mode = S.modeI % 2 ? 'chase' : 'scatter';
            const len = SCHEDULE[S.modeI];
            S.modeT = len * (S.mode === 'scatter' ? Math.max(0.5, 1 - 0.1 * lvl()) : 1);
            for (const g of S.ghosts) if (g.state === 'normal') flip(g);
          }
        }
        if (S.fruit && (S.fruit.t -= dt) <= 0) S.fruit = null;
        S.p.mouth += dt;
        advance(S.p, 7.2 * pace() * dt, pChoose, eat);
        if (S.state !== 'play') return;
        if (!S.frozen) for (const g of S.ghosts) {
          if (g.state === 'house') { g.wait -= dt; if (g.wait <= 0) g.state = 'exit'; continue; }
          advance(g, gSpeed(g) * dt, gChoose, gArrive);
        }
        /* contact */
        const ax = px(S.p) + 0.5, ay = py(S.p) + 0.5;
        for (const g of S.ghosts) {
          if (g.state === 'eyes' || g.state === 'house') continue;
          let dx = Math.abs(px(g) + 0.5 - ax); if (dx > COLS / 2) dx = COLS - dx;
          if (Math.hypot(dx, py(g) + 0.5 - ay) > 0.62) continue;
          if (g.fr) {
            const pts = EAT_PTS[Math.min(S.chain, 3)]; S.chain++;
            addScore(pts); pop(`${pts}`, px(g) + 0, py(g) - 0.2, g.hue);
            g.state = 'eyes'; g.fr = false;
            burst(ax, ay, g.hue, 10);
            snd.blip(260, 0.25, 'square', 0.9, 900);
          } else { die(); break; }
        }
      } else if (S.state === 'dying') {
        S.endT += dt;
        if (S.endT >= 1.5) {
          if (S.lives <= 0) {
            S.state = 'over';
            ctx.onEnd({ score: S.score, won: false, detail: `Level ${S.level} · ${S.eaten} of ${TOTAL_DOTS} dots` });
          } else { placeActors(); S.state = 'play'; S.hold = 1.2; }
        }
      } else if (S.state === 'clear') {
        S.endT += dt;
        if (S.endT >= 1.8) { S.level++; newLevel(); S.state = 'play'; }
      }
    }
    function update(dt) {
      const n = Math.max(1, Math.ceil(dt * 60));
      for (let i = 0; i < n; i++) sub(dt / n);
      for (const q of S.pops) { q.t -= dt; q.y -= dt * 0.8; }
      S.pops = S.pops.filter(q => q.t > 0);
      for (const q of S.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.93; q.vy *= 0.93; q.life -= dt; }
      S.parts = S.parts.filter(q => q.life > 0);
    }
    const loop = looper(dt => {
      if (!S.manual) update(dt);
      draw();
      if (S.state === 'over' && !S.parts.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function drawWalls(g) {
      /* raised slabs in the accent colour: each wall tile is a rounded
         block, joined to the wall tiles beside it, lit from above */
      const flash = S.state === 'clear' && !reduced && Math.floor(S.endT * 5) % 2 === 0;
      const wall = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS && MAZE[r][c] === '#';
      const I = 4, R = 6;
      const body = hsl(AH, AS, flash ? 62 : 42), lit = hsl(AH, AS, flash ? 84 : 66), dark = hsl(AH, AS, flash ? 40 : 22);
      const slabs = (dx, dy, fill) => {
        g.fillStyle = fill;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          if (!wall(c, r)) continue;
          const x = c * CELL + dx, y = r * CELL + dy;
          rr(g, x + I, y + I, CELL - 2 * I, CELL - 2 * I, R); g.fill();
          if (wall(c + 1, r)) g.fillRect(x + CELL / 2, y + I, CELL, CELL - 2 * I);
          if (wall(c, r + 1)) g.fillRect(x + I, y + CELL / 2, CELL - 2 * I, CELL);
          if (wall(c + 1, r) && wall(c, r + 1) && wall(c + 1, r + 1)) g.fillRect(x + CELL / 2, y + CELL / 2, CELL, CELL);
        }
      };
      slabs(0, 2, dark);                   /* the slab's lower edge */
      slabs(0, -1, lit);                   /* its lit upper edge */
      slabs(0, 0, body);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (MAZE[r][c] !== '-') continue;
        g.fillStyle = hsl(0, 0, 92, 0.75); g.fillRect(c * CELL + 2, r * CELL + CELL / 2 - 2, CELL - 4, 4);
      }
    }
    function drawDots(g) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (!S.dots[r][c]) continue;
        const cx = c * CELL + CELL / 2, cy = r * CELL + CELL / 2;
        if (MAZE[r][c] === 'o') {
          const k = reduced ? 1 : 0.8 + 0.2 * Math.sin(S.time * 6);
          g.strokeStyle = hsl(AH, AS, 72); g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 6.5 * k, 0, Math.PI * 2); g.stroke();
          g.fillStyle = hsl(0, 0, 96); g.beginPath(); g.arc(cx, cy, 3.6 * k, 0, Math.PI * 2); g.fill();
        } else { g.fillStyle = hsl(AH, 25, 86, 0.9); g.fillRect(cx - 1.6, cy - 1.6, 3.2, 3.2); }
      }
    }
    function drawBot(g, x, y, face, scale, alpha) {
      const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2, R = CELL * 0.4 * scale;
      g.save(); g.globalAlpha = alpha;
      const bob = reduced ? 0 : Math.sin(S.time * 14) * 0.8;
      g.fillStyle = hsl(205, 18, 88); g.beginPath(); g.arc(cx, cy + bob, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = hsl(205, 14, 66); g.beginPath(); g.arc(cx, cy + bob + R * 0.3, R * 0.75, 0.15, Math.PI - 0.15); g.fill();
      g.strokeStyle = hsl(205, 14, 70); g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy + bob - R); g.lineTo(cx + face[0] * 2, cy + bob - R - 5 * scale); g.stroke();
      g.fillStyle = hsl(AH, AS, 66); g.beginPath(); g.arc(cx + face[0] * 2, cy + bob - R - 6 * scale, 2 * scale, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#10141c';
      const ex = face[0] * 3, ey = face[1] * 2;
      g.beginPath(); g.arc(cx - 4 + ex, cy - 2 + ey + bob, 2.4 * scale, 0, Math.PI * 2); g.arc(cx + 4 + ex, cy - 2 + ey + bob, 2.4 * scale, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    function drawGhost(g, gh) {
      let x = px(gh), y = py(gh);
      if (gh.state === 'house' && !reduced) y += Math.sin(S.time * 5 + gh.i) * 0.06;
      const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2, R = CELL * 0.43;
      const blue = gh.fr && gh.state !== 'eyes';                /* edible: grey static */
      const flick = blue && S.fright < 2 && !reduced && Math.floor(S.time * 6) % 2 === 0;
      for (const off of (x < 0.5 ? [0, COLS * CELL] : x > COLS - 1.5 ? [0, -COLS * CELL] : [0])) {
        const ox = cx + off;
        if (gh.state !== 'eyes') {
          g.fillStyle = blue ? (flick ? '#f4f4f4' : hsl(0, 0, 62)) : hsl(gh.hue, 85, 58);
          g.beginPath();
          g.arc(ox, cy - 1, R, Math.PI, 0);
          g.lineTo(ox + R, cy + R - 2);
          const n = 4, w = (R * 2) / n;
          for (let i = 0; i < n; i++) g.quadraticCurveTo(ox + R - w * (i + 0.5), cy + R + (i % 2 ? 1 : -3), ox + R - w * (i + 1), cy + R - 2);
          g.closePath(); g.fill();
          if (blue) {                                     /* static: a few specks that move unless motion is reduced */
            const t = reduced ? 0 : Math.floor(S.time * 12);
            for (let i = 0; i < 9; i++) {
              const n = Math.sin((gh.i * 31 + i * 7.3 + t * 3.1) * 12.9898) * 43758.5453, f = n - Math.floor(n);
              const m = Math.sin((gh.i * 17 + i * 3.7 + t * 1.7) * 78.233) * 12345.678, e = m - Math.floor(m);
              g.fillStyle = i % 2 ? 'rgba(255,255,255,.75)' : 'rgba(20,22,28,.55)';
              g.fillRect(ox - R * 0.8 + f * R * 1.6, cy - R * 0.6 + e * R * 1.4, 2.4, 2.4);
            }
          } else {                                        /* each ghost has its own crest */
            g.fillStyle = hsl(gh.hue, 90, 78);
            if (gh.i === 0) { g.beginPath(); g.moveTo(ox - 5, cy - R + 2); g.lineTo(ox, cy - R - 5); g.lineTo(ox + 5, cy - R + 2); g.fill(); }
            else if (gh.i === 1) { g.beginPath(); g.arc(ox - 7, cy - R + 3, 3, 0, 7); g.arc(ox + 7, cy - R + 3, 3, 0, 7); g.fill(); }
            else if (gh.i === 2) { g.fillRect(ox - 1, cy - R, 2, R * 1.1); }
            else { g.fillRect(ox - 6, cy + 5, 12, 2); }
          }
        }
        /* a visor across the eyes: it is what makes them a ghost of ours */
        g.fillStyle = blue ? '#24262e' : 'rgba(8,8,24,.85)';
        if (gh.state !== 'eyes') rr(g, ox - R * 0.8, cy - 6, R * 1.6, 9, 4); else rr(g, ox - R * 0.7, cy - 6, R * 1.4, 9, 4);
        g.fill();
        g.fillStyle = blue ? '#e8e8e8' : '#ffffff';
        const lx = gh.dx * 2.5, ly = gh.dy * 1.5;
        g.beginPath(); g.arc(ox - 4 + lx, cy - 2 + ly, 2.3, 0, 7); g.arc(ox + 4 + lx, cy - 2 + ly, 2.3, 0, 7); g.fill();
      }
    }
    function drawFruit(g, f, x, y) {
      const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
      g.fillStyle = hsl(f.hue, 80, 52);
      g.beginPath(); g.arc(cx, cy + 1, 7.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = hsl(f.hue, 90, 78, 0.8); g.beginPath(); g.arc(cx - 2.5, cy - 2, 2.2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = hsl(110, 55, 40); g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx, cy - 6); g.quadraticCurveTo(cx + 2, cy - 10, cx + 5, cy - 9); g.stroke();
      if (f.name === 'melon') { g.strokeStyle = hsl(140, 60, 28, 0.7); g.beginPath(); g.moveTo(cx - 4, cy - 4); g.lineTo(cx - 4, cy + 6); g.moveTo(cx + 3, cy - 5); g.lineTo(cx + 3, cy + 7); g.stroke(); }
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 6);
      g.fillStyle = '#04060a'; g.fillRect(0, 0, sf.w, sf.h);
      g.fillStyle = hsl(AH, AS, 5); g.fillRect(V.ox, V.oy, VW * V.s, ROWS * CELL * V.s);   /* the floor, a breath of the accent */
      g.save();
      g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      drawWalls(g); drawDots(g);
      if (S.fruit) drawFruit(g, S.fruit, OUT.c, OUT.r);
      const p = S.p;
      if (S.state === 'dying') {
        const k = clamp(S.endT / 1.2, 0, 1);
        if (k < 1) drawBot(g, px(p), py(p), p.face, reduced ? 1 : 1 - k, reduced ? 1 - k : 1);
      } else if (S.state !== 'over') {
        for (const gh of S.ghosts) drawGhost(g, gh);
        drawBot(g, px(p), py(p), p.face, 1, 1);
      } else if (S.state === 'over') { for (const gh of S.ghosts) drawGhost(g, gh); }
      for (const q of S.parts) { g.fillStyle = hsl(q.hue, 100, 65, clamp(q.life * 2.5, 0, 1)); g.fillRect(q.x * CELL - 2, q.y * CELL - 2, 4, 4); }
      g.font = `700 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const q of S.pops) { g.fillStyle = hsl(q.hue, 100, 78, clamp(q.t * 2, 0, 1)); g.fillText(q.text, q.x * CELL, q.y * CELL + CELL / 2); }

      /* the strip below the maze */
      const by = ROWS * CELL;
      g.fillStyle = '#0a0d12'; g.fillRect(0, by, VW, HUD);
      for (let i = 0; i < Math.max(0, S.lives - (S.state === 'play' || S.state === 'clear' ? 1 : 0)); i++) drawBot(g, 0.3 + i * 1.1, ROWS + 0.2, [1, 0], 0.7, 1);
      g.font = `600 12px ${FONT}`; g.fillStyle = hsl(215, 30, 78); g.textAlign = 'center';
      g.fillText(`LEVEL ${S.level}`, VW / 2, by + HUD / 2);
      g.textAlign = 'right';
      if (S.fright > 0) {
        g.fillStyle = 'rgba(255,255,255,.12)'; rr(g, VW - 150, by + 12, 70, 10, 5); g.fill();
        g.fillStyle = hsl(0, 0, 78); rr(g, VW - 150, by + 12, Math.max(6, 70 * S.fright / frightLen()), 10, 5); g.fill();
      }
      drawFruit(g, FRUITS[Math.min(FRUITS.length - 1, lvl())], COLS - 1.4, ROWS + 0.2);
      g.restore();

      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Swipe to start' : 'Press an arrow key to start', 'Eat every dot. Big pellets turn the ghosts to static.', AH, sf.h * 0.52);
      else if (S.state === 'play' && S.hold > 0) prompt(g, sf, S.level > 1 || S.lives < 3 ? `Level ${S.level}` : 'Go!', null, AH, sf.h * 0.52);
      else if (S.state === 'clear') prompt(g, sf, 'Level clear!', null, 140, sf.h * 0.52);
    }

    /* ------------------------------ input ------------------------------ */
    const KEYS = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const d = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!d) return;
      e.preventDefault();
      if (S.paused || S.state === 'over') return;
      steer(d[0], d[1]);
      if (!loop.on) draw();
    };
    let sw = null;
    const onDown = e => {
      sw = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      snd.wake();
    };
    const onMove = e => {
      if (!sw || e.pointerId !== sw.id) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (Math.hypot(dx, dy) < 22) return;
      sw.moved = true; sw.x = e.clientX; sw.y = e.clientY;
      if (S.paused || S.state === 'over') return;
      if (Math.abs(dx) > Math.abs(dy)) steer(Math.sign(dx), 0); else steer(0, Math.sign(dy));
    };
    const onUp = e => {
      if (sw && e.pointerId === sw.id && !sw.moved && !S.paused && S.state !== 'over') {
        /* a tap: go toward the tapped side of the player */
        const r = sf.cv.getBoundingClientRect();
        const mx = (e.clientX - r.left - V.ox) / V.s / CELL - 0.5, my = (e.clientY - r.top - V.oy) / V.s / CELL - 0.5;
        const dx = mx - px(S.p), dy = my - py(S.p);
        if (Math.abs(dx) > Math.abs(dy)) steer(Math.sign(dx) || 1, 0); else steer(0, Math.sign(dy) || 1);
      }
      sw = null;
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    draw();
    loop.start();

    const snap = () => ({
      state: S.state, paused: S.paused, score: S.score, lives: S.lives, level: S.level, time: S.time,
      left: S.left, total: TOTAL_DOTS, mode: S.mode, fright: S.fright, hasFruit: !!S.fruit, chain: S.chain,
      player: { x: px(S.p), y: py(S.p), c: S.p.c, r: S.p.r, dx: S.p.dx, dy: S.p.dy },
      ghosts: S.ghosts.map(g => ({ name: g.name, i: g.i, x: px(g), y: py(g), c: g.c, r: g.r, state: g.state, fr: g.fr })),
      dotAt: (c, r) => !!S.dots[r]?.[c], maze: MAZE.slice(), cell: CELL, view: { ox: V.ox, oy: V.oy, s: V.s },
    });
    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (dotAt is a function, so use hook('dot', [c, r])) */
      peek() { const s = snap(); delete s.dotAt; return s; },
      /* test hook — nothing in the game calls it:
         step(seconds) · manual(bool: stop the clock, step it by hand) · freeze(bool: ghosts stand still)
         place({ who: 'player' | ghost index, c, r, state?, fr? }) · frighten() · clearDots() · dot([c, r]) · mode('scatter'|'chase') */
      hook(cmd, arg) {
        let out = true;
        if (cmd === 'step') { for (let t = 0; t < arg; t += 1 / 30) update(1 / 30); }
        else if (cmd === 'manual') S.manual = !!arg;
        else if (cmd === 'freeze') S.frozen = !!arg;
        else if (cmd === 'place') {
          const e = arg.who === 'player' ? S.p : S.ghosts[arg.who];
          e.c = arg.c; e.r = arg.r; e.dx = 0; e.dy = 0; e.f = 0;
          if (arg.state) e.state = arg.state;
          if ('fr' in arg) e.fr = !!arg.fr;
        }
        else if (cmd === 'frighten') frighten();
        else if (cmd === 'clearDots') {
          S.dots.forEach(row => row.fill(false)); S.eaten = TOTAL_DOTS; S.left = 0;
          if (S.state === 'ready') S.state = 'play';
          levelDone();
        }
        else if (cmd === 'dot') out = !!S.dots[arg[1]]?.[arg[0]];
        else if (cmd === 'mode') { S.mode = arg; S.modeT = 99; }
        draw();
        return out;
      },
    };
  },
};
