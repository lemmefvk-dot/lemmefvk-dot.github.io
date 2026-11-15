/* ============================================================
   arcade/snake.js — Snake for Static Arcade.

   Grid snake on a canvas, in four modes (ctx.mode; each keeps its
   own best and ghost in the Arcade):
     classic    the WALLS ARE SOLID: touching the edge ends the round.
                The board draws a lit border and the start screen says
                so, so nobody expects wrap-around.
     wrap       no walls: out of one side, in at the other (a dashed,
                open border).
     obstacles  solid walls, plus short bars inside the board laid out
                from the seed. Bars never touch each other or the edge,
                so every free square can still be reached.
     speed      solid walls, a quicker start and a quicker climb.

   · Score = the snake's length (it starts at 3).
   · The tick speeds up as it grows: 150 ms per step → 60 ms (Speed:
     100 ms → 45 ms).
   · Grid lines (ctx.settings.grid) draw lines between the squares
     instead of dots; the shell's on-screen D-pad sends arrow keys.
   · Segments are drawn between grid cells, so movement is smooth
     at any tick rate; the body tapers from head to tail.
   · The grid is 27 × 17 whenever the round has a seed (always, in
     the Arcade), and only scales to the window; on its own, without
     a seed, it is sized once from the shape of the play area.

   Input: arrow keys / WASD (three turns buffered, reversing is
   ignored); swipe with a finger or the mouse. Follows the module
   contract in ./index.js; stop() removes every listener, the frame
   loop and the audio context.

   Seeds and ghosts (index.js SHARED OPTIONS): the food comes from
   ctx.seed on the fixed grid, so a seed is a course — a Beat-this
   link, the weekly challenge or a cup is the same board for everyone,
   whatever their window's shape. Every turn is logged by the step it
   took effect on, and the round ends with onEnd({ replay: { v: 1,
   cols, rows, turns: [[step, dx, dy], …], mode? } }) (no mode: classic,
   as every replay before modes). Played back on the same seed, grid
   and mode those turns give the same snake, step for step:
   ctx.ghost.watch plays it on its own; otherwise it is a see-through
   ghost snake (with its own food) racing alongside. ctx.speed scales
   the clock.
   ============================================================ */

const HUE = 140;          /* the snake and walls */
const FOOD_HUE = 330;     /* food, in a contrasting pink */
const START_LEN = 3;
const DIE_SECS = 0.8;
const MODES = ['classic', 'wrap', 'obstacles', 'speed'];
/* the start screen's second line: what this mode's rules are */
const RULE = {
  classic: 'Walls are solid — eat to grow, don’t touch the edge or your tail',
  wrap: 'No walls — go off one side and come back on the other',
  obstacles: 'Solid walls and bars inside — eat to grow, touch nothing',
  speed: 'Walls are solid, and it starts fast and gets faster',
};

/* Obstacles: short bars, none touching another or the edge (so every free square stays reachable),
   and none in the starting row ahead of the snake */
function layRocks(cols, rows, start, rand) {
  const out = new Set();
  const near = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (out.has(`${x + dx},${y + dy}`)) return true; return false; };
  const want = Math.max(4, Math.round(cols * rows / 60));
  for (let tries = 0, made = 0; made < want && tries < 400; tries++) {
    const across = rand() < 0.5, len = 2 + Math.floor(rand() * 4);
    const x0 = 2 + Math.floor(rand() * (cols - 4 - (across ? len : 1) + 1));
    const y0 = 2 + Math.floor(rand() * (rows - 4 - (across ? 1 : len) + 1));
    const cells = Array.from({ length: len }, (_, i) => [x0 + (across ? i : 0), y0 + (across ? 0 : i)]);
    if (cells.some(([x, y]) => x < 2 || y < 2 || x > cols - 3 || y > rows - 3 || near(x, y) || (Math.abs(y - start.y) <= 1 && x >= start.x - 3))) continue;
    for (const [x, y] of cells) out.add(`${x},${y}`);
    made++;
  }
  return out;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
/* a touch screen is the main pointer: say "tap" and "swipe", not keys */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const seed = Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    const speed = clamp(Number(ctx.speed) || 1, 0.5, 1);
    const MODE = MODES.includes(ctx.mode) ? ctx.mode : 'classic';
    const wrap = MODE === 'wrap';
    /* a replay this module wrote (see the header): watched on its own, or raced as a ghost — only in its own mode */
    const okGhost = d => !!d && d.v === 1 && Number.isInteger(d.cols) && Number.isInteger(d.rows) && d.cols >= 8 && d.cols <= 60 && d.rows >= 8 && d.rows <= 60
      && Array.isArray(d.turns) && d.turns.length < 20000 && (d.mode || 'classic') === MODE;
    const GH = ctx.ghost && okGhost(ctx.ghost.data) ? ctx.ghost : null;
    const watch = !!(GH && GH.watch);
    const S = {
      state: 'ready',            /* ready | play | dying | over */
      paused: false,
      cols: 28, rows: 18,
      body: [], from: [], grew: false,
      dir: { x: 1, y: 0 }, queue: [],
      food: null, acc: 0, time: 0, dieT: 0, cause: '',
      parts: [], n: 0, li: 0, rand: rng(seed), watchT: 0,
    };
    const log = [];              /* [step, dx, dy] for every turn taken: the replay */
    let G = null;                /* the ghost: the same rules on its own body, food and clock */

    const sf = surface(el, 'Snake board', () => draw());

    /* the grid: 27 × 17 for a seeded round (every round in the Arcade), so a seed is one course on any
       screen and any round can be raced, linked or shared; a replay keeps its own. Without a seed (the
       game on its own) it is shaped like the play area. */
    if (GH) { S.cols = GH.data.cols; S.rows = GH.data.rows; }
    else if (Number.isInteger(ctx.seed) || ctx.shared) { S.cols = 27; S.rows = 17; }
    else {
      const aspect = sf.w > 40 && sf.h > 40 ? sf.w / sf.h : 1.6;
      S.rows = clamp(Math.round(Math.sqrt(470 / aspect)), 12, 24);
      S.cols = clamp(Math.round(S.rows * aspect), 12, 36);
    }
    const startCell = () => ({ x: Math.max(START_LEN, Math.floor(S.cols / 3)), y: Math.floor(S.rows / 2) });
    /* Obstacles: bars from their own stream of the seed (so the food still comes from the round's), shared by you and the ghost */
    const rocks = MODE === 'obstacles' ? layRocks(S.cols, S.rows, startCell(), rng((seed ^ 0x5eed0b57) >>> 0)) : new Set();
    const lay = sim => {
      const { x: cx, y: cy } = startCell();
      for (let i = 0; i < START_LEN; i++) sim.body.push({ x: cx - i, y: cy });
      sim.from = sim.body.map(p => ({ ...p }));
      placeFood(sim);
    };
    lay(S);
    if (GH && !watch) { G = { body: [], from: [], grew: false, dir: { x: 1, y: 0 }, food: null, acc: 0, n: 0, li: 0, rand: rng(seed), dead: false, deadT: 0 }; lay(G); }
    ctx.onScore(S.body.length);

    const interval = MODE === 'speed'
      ? (sim = S) => Math.max(45, 100 - (sim.body.length - START_LEN) * 3) / 1000
      : (sim = S) => Math.max(60, 150 - (sim.body.length - START_LEN) * 3) / 1000;

    /* ------------------------------ rules ------------------------------ */
    function placeFood(sim) {
      const taken = new Set([...rocks, ...sim.body.map(p => p.x + ',' + p.y)]);
      const free = [];
      for (let y = 0; y < S.rows; y++) for (let x = 0; x < S.cols; x++) if (!taken.has(x + ',' + y)) free.push({ x, y });
      sim.food = free.length ? free[Math.floor(sim.rand() * free.length)] : null;
    }

    function begin() {
      if (S.state !== 'ready') return;
      S.state = 'play';
      S.acc = 0;
    }

    function turn(dx, dy) {
      if (watch || S.paused || S.state === 'dying' || S.state === 'over') return;
      const last = S.queue.length ? S.queue[S.queue.length - 1] : S.dir;
      const same = dx === last.x && dy === last.y;
      const back = dx === -last.x && dy === -last.y;
      if (!same && !back && S.queue.length < 3) S.queue.push({ x: dx, y: dy });
      begin();
    }

    /* the turns a replay took at this step */
    function replayTurns(sim, turns) {
      while (sim.li < turns.length && turns[sim.li][0] < sim.n) sim.li++;
      while (sim.li < turns.length && turns[sim.li][0] === sim.n) { const t = turns[sim.li++]; sim.dir = { x: Math.sign(t[1]) || 0, y: Math.sign(t[2]) || 0 }; }
    }
    /* one step of the rules for any snake (yours or the ghost): 'wall' | 'rock' | 'self' | 'eat' | 'full' | null */
    function step(sim) {
      const h0 = sim.body[0];
      let nx = h0.x + sim.dir.x, ny = h0.y + sim.dir.y;
      sim.n++;
      if (wrap) { nx = (nx + S.cols) % S.cols; ny = (ny + S.rows) % S.rows; }
      else if (nx < 0 || ny < 0 || nx >= S.cols || ny >= S.rows) return 'wall';
      if (rocks.has(nx + ',' + ny)) return 'rock';
      const eat = !!sim.food && sim.food.x === nx && sim.food.y === ny;
      /* the tail moves out of the way this step unless we are growing */
      const solid = eat ? sim.body : sim.body.slice(0, -1);
      if (solid.some(p => p.x === nx && p.y === ny)) return 'self';
      sim.from = sim.body.map(p => ({ ...p }));
      sim.body.unshift({ x: nx, y: ny });
      sim.grew = eat;
      if (!eat) { sim.body.pop(); return null; }
      placeFood(sim);
      return sim.food ? 'eat' : 'full';
    }

    function tick() {
      if (watch) replayTurns(S, GH.data.turns);
      else if (S.queue.length) { S.dir = S.queue.shift(); log.push([S.n, S.dir.x, S.dir.y]); }
      const r = step(S);
      if (r === 'wall' || r === 'rock' || r === 'self') { die(r); return; }
      if (!r) return;
      const hd = S.body[0];
      ctx.onScore(S.body.length);
      snd.blip(660 + Math.min(600, S.body.length * 8), 0.06, 'square', 0.8, 990 + S.body.length * 8);
      burst(hd.x + 0.5, hd.y + 0.5, FOOD_HUE, 12);
      if (r === 'full') {                          /* the whole board is snake */
        S.state = 'over';
        ctx.onEnd({ score: S.body.length, won: true, detail: 'You filled the whole board', replay: replayOut() });
      }
    }
    const replayOut = () => (watch ? undefined : { v: 1, cols: S.cols, rows: S.rows, turns: log.slice(), ...(MODE !== 'classic' ? { mode: MODE } : {}) });
    function ghostTick() {
      replayTurns(G, GH.data.turns);
      const r = step(G);
      if (r === 'wall' || r === 'rock' || r === 'self' || r === 'full') { G.dead = true; G.deadT = 0; G.from = G.body.map(p => ({ ...p })); G.grew = false; }
    }

    function die(cause) {
      S.state = 'dying';
      S.cause = cause;
      S.dieT = 0;
      S.from = S.body.map(p => ({ ...p }));
      S.grew = false;
      snd.blip(220, 0.25, 'sawtooth', 0.9, 60);
      burst(S.body[0].x + 0.5, S.body[0].y + 0.5, 0, 18);
    }

    function burst(x, y, hue, n) {
      if (reduced) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5;
        S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, hue });
      }
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(raw => {
      const dt = raw * speed;
      S.time += dt;
      /* a replay starts itself after a moment */
      if (watch && S.state === 'ready') { S.watchT += raw; if (S.watchT > 0.7) begin(); }
      if (S.state === 'play') {
        S.acc += dt;
        let iv = interval();
        while (S.acc >= iv && S.state === 'play') { S.acc -= iv; tick(); iv = interval(); }
      } else if (S.state === 'dying') {
        S.dieT += dt;
        if (S.dieT >= DIE_SECS) {
          S.state = 'over';
          ctx.onEnd({
            score: S.body.length, won: false,
            detail: S.cause === 'wall' ? 'Hit the wall' : S.cause === 'rock' ? 'Hit a bar inside the board' : 'Ran into your own tail',
            replay: replayOut(),
          });
        }
      }
      /* the ghost runs on its own clock from the moment you start */
      if (G && S.state !== 'ready') {
        if (!G.dead) {
          G.acc += dt;
          let iv = interval(G);
          while (G.acc >= iv && !G.dead) { G.acc -= iv; ghostTick(); iv = interval(G); }
        } else G.deadT += dt;
      }
      for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt; }
      S.parts = S.parts.filter(p => p.life > 0);
      draw();
      if (S.state === 'over' && !S.parts.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const pad = Math.max(12, Math.min(sf.w, sf.h) * 0.045);
      const cell = Math.max(4, Math.floor(Math.min((sf.w - pad * 2) / S.cols, (sf.h - pad * 2) / S.rows)));
      const bw = cell * S.cols, bh = cell * S.rows;
      return { cell, bw, bh, ox: Math.round((sf.w - bw) / 2), oy: Math.round((sf.h - bh) / 2) };
    }

    /* Wrap: a neighbour across an edge is one square away, not the board's width — q moved next to p */
    const near = (p, q) => {
      if (!wrap) return q;
      let { x, y } = q;
      if (x - p.x > 1) x -= S.cols; else if (p.x - x > 1) x += S.cols;
      if (y - p.y > 1) y -= S.rows; else if (p.y - y > 1) y += S.rows;
      return { x, y };
    };
    /* points along a snake's body (yours, or the ghost's), head first, every `step` cells
       (in Wrap the chain runs on past the edge; draw() shows it again from the other side) */
    function samples(a, step, sim = S) {
      const to = near(sim.from[0], sim.body[0]);
      const head = {
        x: sim.from[0].x + (to.x - sim.from[0].x) * a,
        y: sim.from[0].y + (to.y - sim.from[0].y) * a,
      };
      const path = [head];
      for (const p of sim.from) path.push(near(path[path.length - 1], p));
      const len = sim.grew ? sim.from.length - 1 + a : sim.from.length - 1;
      const out = [head];
      let seg = 0, t = 0, walked = 0;
      while (walked + step <= len + 1e-6 && seg < path.length - 1) {
        let need = step;
        while (need > 0 && seg < path.length - 1) {
          const p = path[seg], q = path[seg + 1];
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          const left = d * (1 - t);
          if (d === 0 || left <= need) { need -= left; seg++; t = 0; continue; }
          t += need / d;
          need = 0;
        }
        walked += step;
        const p = path[Math.min(seg, path.length - 1)], q = path[Math.min(seg + 1, path.length - 1)];
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
      return out;
    }

    function draw() {
      const g = sf.g;
      sf.begin();
      const L = layout();
      const c = L.cell;
      const X = v => L.ox + v * c, Y = v => L.oy + v * c;

      g.fillStyle = '#030805';
      g.fillRect(0, 0, sf.w, sf.h);
      const bg = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.7);
      bg.addColorStop(0, hsl(HUE, 70, 12, 0.55));
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = bg;
      g.fillRect(0, 0, sf.w, sf.h);

      /* board + dot grid, or grid lines (Options) */
      g.fillStyle = '#06100a';
      rr(g, L.ox, L.oy, L.bw, L.bh, 6);
      g.fill();
      if (ctx.settings?.grid) {
        g.strokeStyle = hsl(HUE, 70, 60, 0.13);
        g.lineWidth = 1;
        g.beginPath();
        for (let x = 1; x < S.cols; x++) { g.moveTo(Math.round(X(x)) + 0.5, L.oy); g.lineTo(Math.round(X(x)) + 0.5, L.oy + L.bh); }
        for (let y = 1; y < S.rows; y++) { g.moveTo(L.ox, Math.round(Y(y)) + 0.5); g.lineTo(L.ox + L.bw, Math.round(Y(y)) + 0.5); }
        g.stroke();
      } else {
        g.fillStyle = hsl(HUE, 80, 70, 0.08);
        const dot = Math.max(1, Math.round(c / 12));
        for (let y = 0; y < S.rows; y++) for (let x = 0; x < S.cols; x++) {
          g.fillRect(Math.round(X(x + 0.5)) - dot / 2, Math.round(Y(y + 0.5)) - dot / 2, dot, dot);
        }
      }

      /* the walls: solid and lit, or (Wrap) a dashed, open edge */
      const hot = S.state === 'dying' && (S.cause === 'wall' || S.cause === 'rock') && !reduced;
      g.save();
      g.shadowBlur = wrap ? 6 : 16;
      g.shadowColor = hot ? hsl(0, 100, 55, 0.9) : hsl(HUE, 100, 50, wrap ? 0.5 : 0.85);
      g.strokeStyle = hot ? hsl(0, 100, 65) : hsl(HUE, 100, 62, wrap ? 0.5 : 0.95);
      g.lineWidth = wrap ? 2 : 3;
      if (wrap) g.setLineDash([Math.max(4, c * 0.4), Math.max(4, c * 0.4)]);
      rr(g, L.ox - 3, L.oy - 3, L.bw + 6, L.bh + 6, 8);
      g.stroke();
      g.restore();
      /* Obstacles: the bars inside the board */
      if (rocks.size) {
        g.save();
        g.shadowBlur = 10;
        g.shadowColor = hsl(HUE, 100, 50, 0.6);
        for (const k of rocks) {
          const [rx, ry] = k.split(',').map(Number);
          g.fillStyle = hsl(HUE, 60, 22);
          rr(g, X(rx) + 1, Y(ry) + 1, c - 2, c - 2, Math.max(2, c * 0.18));
          g.fill();
          g.strokeStyle = hsl(HUE, 100, 60, 0.85);
          g.lineWidth = 1.5;
          g.stroke();
        }
        g.restore();
      }

      /* food */
      if (S.food) {
        const pulse = reduced ? 1 : 1 + Math.sin(S.time * 6) * 0.08;
        const fx = X(S.food.x + 0.5), fy = Y(S.food.y + 0.5);
        g.save();
        g.shadowBlur = c * 0.9;
        g.shadowColor = hsl(FOOD_HUE, 100, 60, 0.9);
        g.fillStyle = hsl(FOOD_HUE, 95, 62);
        g.beginPath(); g.arc(fx, fy, c * 0.3 * pulse, 0, Math.PI * 2); g.fill();
        g.restore();
        g.fillStyle = 'rgba(255,255,255,.75)';
        g.beginPath(); g.arc(fx - c * 0.09, fy - c * 0.1, c * 0.08, 0, Math.PI * 2); g.fill();
      }

      /* Wrap: a snake half through an edge is drawn again from the other side, inside the board */
      const copies = wrap ? [[0, 0], [S.cols, 0], [-S.cols, 0], [0, S.rows], [0, -S.rows]] : [[0, 0]];
      if (wrap) { g.save(); rr(g, L.ox, L.oy, L.bw, L.bh, 6); g.clip(); }

      /* the ghost: your best run, see-through, with its own food (a ring) */
      if (G && !(G.dead && G.deadT > 0.8)) {
        const ga = G.dead || S.state === 'ready' ? 0 : clamp(G.acc / interval(G), 0, 1);
        const gp = samples(ga, 0.25, G);
        const fade = G.dead ? clamp(1 - G.deadT / 0.8, 0, 1) : 1;
        g.save();
        g.globalAlpha = 0.5 * fade;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.strokeStyle = 'rgba(225,235,255,.9)';
        g.lineWidth = c * 0.5;
        g.setLineDash([c * 0.35, c * 0.25]);
        for (const [ox, oy] of copies) {
          g.beginPath();
          gp.forEach((p, i) => (i ? g.lineTo(X(p.x + ox + 0.5), Y(p.y + oy + 0.5)) : g.moveTo(X(p.x + ox + 0.5), Y(p.y + oy + 0.5))));
          g.stroke();
        }
        g.setLineDash([]);
        if (G.food && !G.dead && (!S.food || G.food.x !== S.food.x || G.food.y !== S.food.y)) {
          g.lineWidth = 2;
          g.beginPath(); g.arc(X(G.food.x + 0.5), Y(G.food.y + 0.5), c * 0.28, 0, Math.PI * 2); g.stroke();
        }
        g.restore();
      }

      /* the snake: a glow stroke, then tapering beads from tail to head */
      const a = S.state === 'play' ? clamp(S.acc / interval(), 0, 1) : 0;
      const pts = samples(a, 0.2);
      const dead = S.state === 'dying' || (S.state === 'over' && S.cause);
      const flash = dead && !reduced ? Math.floor(S.dieT * 10) % 2 === 0 : dead;
      const bodyHue = flash ? 0 : HUE;
      for (const [ox, oy] of copies) {
        const SX = v => X(v + ox), SY = v => Y(v + oy);
        g.save();
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.shadowBlur = c * 0.8;
        g.shadowColor = hsl(bodyHue, 100, 50, 0.7);
        g.strokeStyle = hsl(bodyHue, 90, 40, 0.5);
        g.lineWidth = c * 0.62;
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(SX(p.x + 0.5), SY(p.y + 0.5)) : g.moveTo(SX(p.x + 0.5), SY(p.y + 0.5))));
        g.stroke();
        g.restore();
        for (let i = pts.length - 1; i >= 0; i--) {
          const t = pts.length > 1 ? i / (pts.length - 1) : 0;
          const p = pts[i];
          g.fillStyle = hsl(bodyHue, 85, 60 - t * 24);
          g.beginPath();
          g.arc(SX(p.x + 0.5), SY(p.y + 0.5), c * (0.42 - t * 0.14), 0, Math.PI * 2);
          g.fill();
        }
        /* head + eyes looking where it is going */
        const hp = pts[0];
        const hx = SX(hp.x + 0.5), hy = SY(hp.y + 0.5);
        g.fillStyle = hsl(bodyHue, 90, 66);
        g.beginPath(); g.arc(hx, hy, c * 0.46, 0, Math.PI * 2); g.fill();
        const d = S.queue[0] && S.state === 'ready' ? S.queue[0] : S.dir;
        const px = -d.y, py = d.x;
        for (const s of [-1, 1]) {
          const ex = hx + (d.x * 0.14 + px * 0.2 * s) * c, ey = hy + (d.y * 0.14 + py * 0.2 * s) * c;
          g.fillStyle = '#eafff1';
          g.beginPath(); g.arc(ex, ey, c * 0.11, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#04140a';
          g.beginPath(); g.arc(ex + d.x * c * 0.04, ey + d.y * c * 0.04, c * 0.055, 0, Math.PI * 2); g.fill();
        }
      }
      if (wrap) g.restore();

      /* sparks */
      for (const p of S.parts) {
        g.fillStyle = hsl(p.hue, 100, 65, clamp(p.life * 2, 0, 1));
        g.fillRect(X(p.x) - 1.5, Y(p.y) - 1.5, 3, 3);
      }

      if (S.state === 'ready') {
        if (watch) prompt(g, sf, 'Replay of your best run', 'Played back from the turns it took', HUE, L.oy + L.bh * 0.74);
        else prompt(g, sf, coarse() ? 'Swipe to start' : 'Arrow keys, WASD or swipe to start', G ? 'Race your ghost — the dashed snake is your best run' : RULE[MODE], HUE, L.oy + L.bh * 0.74);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const KEYS = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const k = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!k) return;
      e.preventDefault();
      snd.wake();
      turn(k[0], k[1]);
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
      if (Math.hypot(dx, dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) turn(Math.sign(dx), 0); else turn(0, Math.sign(dy));
      sw.x = e.clientX; sw.y = e.clientY; sw.moved = true;
    };
    const onUp = e => {
      if (sw && e.pointerId === sw.id && !sw.moved) begin();
      sw = null;
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    loop.start();

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
      /* what a watcher may see (./spectate.js 'snakes'): the body as cell indices, two base-36 digits each, head first */
      spectate: () => {
        const at = p => p.y * S.cols + p.x;
        const inside = p => p.x >= 0 && p.y >= 0 && p.x < S.cols && p.y < S.rows;
        return { k: 'snakes', w: S.cols, h: S.rows, sn: [{ b: S.body.filter(inside).map(p => at(p).toString(36).padStart(2, '0')).join(''), a: S.state !== 'dying' && S.state !== 'over', c: 0 }],
          f: S.food ? at(S.food) : -1, sc: [S.body.length], pl: [{ n: 'You' }], txt: S.state === 'over' ? 'Round over' : S.paused ? 'Paused' : `Length ${S.body.length}`, over: S.state === 'over' };
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        state: S.state, paused: S.paused, cols: S.cols, rows: S.rows, walls: wrap ? 'wrap' : 'solid', mode: MODE,
        rocks: [...rocks].map(k => k.split(',').map(Number)), grid: !!ctx.settings?.grid,
        body: S.body.map(p => ({ x: p.x, y: p.y })), dir: { ...S.dir }, queued: S.queue.length,
        food: S.food ? { ...S.food } : null, score: S.body.length,
        seed, steps: S.n, turns: log.length, watch, speed, time: S.time, reduced, volume: ctx.volume, interval: Math.round(interval() * 1000),
        ghost: G ? { dead: G.dead, steps: G.n, length: G.body.length, head: { ...G.body[0] }, food: G.food ? { ...G.food } : null } : null,
      }),
    };
  },
};

/* ---- module kit (the same few helpers in every built-in Arcade game) ---- */

/* small seeded generator (mulberry32, as in ./kit.js): the same seed gives the same food */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A canvas that fills `el`, backed at devicePixelRatio, refit on resize. */
function surface(el, label, onFit) {
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', label);
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none';
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(cv);
  const s = { cv, g: cv.getContext('2d'), w: 0, h: 0, dpr: 1 };
  let armed = false;                 /* the first fit happens before the game exists */
  const fit = () => {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === s.w && h === s.h && dpr === s.dpr) return;
    s.w = w; s.h = h; s.dpr = dpr;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    if (armed) onFit?.(s);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(el);
  window.addEventListener('resize', fit);
  fit();
  armed = true;
  s.begin = () => s.g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  s.destroy = () => { ro?.disconnect(); window.removeEventListener('resize', fit); cv.remove(); };
  return s;
}

/* Should this keydown drive the game? Not while another window is in
   front, not while typing in a field, and a Space/Enter aimed at a
   button outside the game belongs to that button. */
function ownsKey(el, e) {
  if (!el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return false;
  const win = el.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target;
  if (t && t.closest) {
    if (t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return false;
    if ((e.key === ' ' || e.key === 'Enter') && !el.contains(t) && t.closest('button,a,[role="button"]')) return false;
  }
  return true;
}

/* Tiny synth blips, made on the first input (browsers only start audio
   from a gesture) and closed in stop(). Silent while ctx.sound is off. */
function sounder(ctx) {
  let ac = null, dead = false;
  const get = () => {
    if (dead || ctx.sound === false) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (err) { return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  return {
    wake() { get(); },
    blip(freq, dur = 0.07, type = 'square', vol = 1, to = 0) {
      const c = get();
      if (!c || c.state !== 'running') return;
      try {
        const t = c.currentTime, o = c.createOscillator(), gn = c.createGain();
        const peak = 0.05 * vol * (typeof ctx.volume === 'number' ? ctx.volume : 0.6);
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.linearRampToValueAtTime(peak, t + 0.005);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn).connect(c.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
      } catch (err) { /* audio can fail at any point; the game goes on */ }
    },
    close() {
      dead = true;
      try { ac?.close()?.catch?.(() => {}); } catch (err) { /* already closed */ }
      ac = null;
    },
  };
}

/* requestAnimationFrame loop with a clamped dt; start/stop for pause. */
function looper(step) {
  let raf = 0, last = 0, on = false;
  const tick = now => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt, now);
  };
  return {
    start() { if (on) return; on = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { on = false; cancelAnimationFrame(raf); },
    get on() { return on; },
  };
}

function rr(g, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

/* A two-line hint on a dark pill, centred on (sf.w/2, cy). */
function prompt(g, sf, line1, line2, hue, cy = sf.h / 2) {
  const k = Math.min(1, sf.w / 520);
  const f1 = Math.round(15 * Math.max(0.8, k)), f2 = Math.round(12 * Math.max(0.85, k));
  g.font = `650 ${f1}px ${FONT}`;
  const w1 = g.measureText(line1).width;
  g.font = `500 ${f2}px ${FONT}`;
  const w2 = line2 ? g.measureText(line2).width : 0;
  const w = Math.min(sf.w - 24, Math.max(w1, w2) + 40), h = line2 ? f1 + f2 + 34 : f1 + 26;
  const x = (sf.w - w) / 2, y = cy - h / 2;
  g.save();
  g.fillStyle = 'rgba(4,6,10,.78)';
  g.strokeStyle = hsl(hue, 100, 65, 0.45);
  g.lineWidth = 1;
  rr(g, x, y, w, h, 12);
  g.fill();
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4f7f5';
  g.font = `650 ${f1}px ${FONT}`;
  g.fillText(line1, sf.w / 2, y + 13 + f1 / 2, w - 20);
  if (line2) {
    g.fillStyle = hsl(hue, 60, 78, 0.85);
    g.font = `500 ${f2}px ${FONT}`;
    g.fillText(line2, sf.w / 2, y + 21 + f1 + f2 / 2, w - 20);
  }
  g.restore();
}
