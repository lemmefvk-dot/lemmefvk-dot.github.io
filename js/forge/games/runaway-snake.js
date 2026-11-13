/* Runaway Snake — a Static Forge template (original code and art).
   Snake, but the food has legs: it hops away from your head, so you
   have to herd it into a corner. Golden food is worth more, runs
   faster and does not wait around. The snake speeds up as it grows.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const SPEED0 = K.clamp(N(P.startSpeed, 7), 1, 30);
  const FOOD_SPEED = Math.max(0, N(P.foodSpeed, 2.5));
  const WRAP = P.wrap === true;
  const CELL = K.clamp(N(P.cell, 24), 8, 64);
  const FOOD = /^#[0-9a-f]{6}$/i.test(P.foodColor || '') ? P.foodColor : '#f87171';
  const U = { x: 0, y: -1 }, D = { x: 0, y: 1 }, L = { x: -1, y: 0 }, R = { x: 1, y: 0 };
  const rgb = h => { if (Array.isArray(h)) return h; const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mixA = (a, b, t) => { const A = rgb(a), B = rgb(b); return A.map((v, i) => Math.round(v + (B[i] - v) * t)); };
  const mix = (a, b, t) => 'rgb(' + mixA(a, b, t).join(',') + ')';

  let cols = 20, rows = 14, cs = 24, ox = 0, oy = 0, board = null;
  let snake, prev, dir, queue, acc, foods, eaten, grow, alive, untilGold, tongue;

  /* the board keeps its cells for a whole round; the window only changes the cell size */
  function fitGrid() {
    cs = Math.max(6, Math.floor(Math.min(CELL * 2.2, (K.W - 16) / cols, (K.H - 62) / rows)));
    ox = Math.floor((K.W - cols * cs) / 2);
    oy = Math.floor(52 + (K.H - 58 - rows * cs) / 2);
    try {
      board = document.createElement('canvas');
      board.width = cols * cs; board.height = rows * cs;
      const b = board.getContext('2d');
      b.fillStyle = '#0b231a';
      b.fillRect(0, 0, board.width, board.height);
      b.fillStyle = '#0e2a20';
      for (let y = 0; y < rows; y++) for (let x = (y % 2); x < cols; x += 2) b.fillRect(x * cs, y * cs, cs, cs);
    } catch (e) { board = null; }
  }
  const speed = () => Math.min(SPEED0 * 2.4, SPEED0 + eaten * 0.3);
  const occupied = (x, y) => snake.some(s => s.x === x && s.y === y) || foods.some(f => f.x === x && f.y === y);
  const gap = (a, b, m) => { const d = Math.abs(a - b); return WRAP ? Math.min(d, m - d) : d; };
  const far = (x, y) => gap(x, snake[0].x, cols) + gap(y, snake[0].y, rows);
  function emptyCell(minDist) {
    for (let t = 0; t < 400; t++) {
      const x = K.ri(0, cols - 1), y = K.ri(0, rows - 1);
      if (!occupied(x, y) && far(x, y) >= minDist) return { x, y };
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!occupied(x, y)) return { x, y };
    return null;
  }
  function addFood(goldOne) {
    const c = emptyCell(Math.min(6, Math.floor((cols + rows) / 5)));
    if (!c) return;
    foods.push({ x: c.x, y: c.y, fx: c.x, fy: c.y, hop: 1, acc: Math.random() * 0.5, gold: !!goldOne, life: goldOne ? 9 : Infinity, born: 0, look: { x: -1, y: 0 } });
  }

  /* food hops to the neighbouring cell furthest from the head (mostly); far away it just ambles */
  function hop(f) {
    const opts = [];
    for (const d of [U, D, L, R]) {
      let x = f.x + d.x, y = f.y + d.y;
      if (WRAP) { x = (x + cols) % cols; y = (y + rows) % rows; } else if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (occupied(x, y)) continue;
      opts.push({ x, y, d: far(x, y) });
    }
    const here = far(f.x, f.y);
    if (!opts.length) return;
    let pick;
    if (here > 8) { if (Math.random() < 0.5) return; pick = K.pick(opts); }
    else {
      opts.sort((a, b) => b.d - a.d);
      pick = Math.random() < 0.85 ? opts[0] : K.pick(opts);
      if (pick.d < here && Math.random() < 0.7) return;   /* rather stay put than run towards you */
    }
    f.look = { x: Math.sign(pick.x - f.x) || 0, y: Math.sign(pick.y - f.y) || 0 };
    f.fx = f.x; f.fy = f.y; f.x = pick.x; f.y = pick.y; f.hop = 0;
  }

  function turn(d) {
    if (queue.length >= 2) return;
    const last = queue.length ? queue[queue.length - 1] : dir;
    if ((d.x === last.x && d.y === last.y) || (d.x === -last.x && d.y === -last.y)) return;
    queue.push(d);
  }
  const center = (x, y) => [ox + x * cs + cs / 2, oy + y * cs + cs / 2];

  function die(msg) {
    alive = false;
    if (K.state !== 'play') return;   /* the start screen's demo snake just starts over */
    snake.forEach((s, i) => { if (i % 2 === 0) { const [x, y] = center(s.x, s.y); K.burst(x, y, [K.accent, '#ffffff'], 4, 140, { life: 0.6 }); } });
    K.shake(12);
    K.flash('#f87171', 0.25);
    K.sfx('hurt');
    K.over(msg);
  }
  function eat(f) {
    foods.splice(foods.indexOf(f), 1);
    const [x, y] = center(f.x, f.y);
    eaten++;
    grow += f.gold ? 4 : 2;
    const pts = f.gold ? 50 : 10 + Math.floor(snake.length / 8) * 2;
    if (K.state === 'play') K.add(pts, x, y - cs * 0.6, f.gold ? '#fde047' : '#fff');
    K.burst(x, y, f.gold ? ['#fde047', '#ffffff', '#facc15'] : [FOOD, '#ffffff', '#86efac'], f.gold ? 24 : 14, 200, { life: 0.55 });
    K.sfx(f.gold ? 'coin' : 'pick');
    if (!f.gold) {
      addFood(false);
      if (--untilGold <= 0) { untilGold = K.ri(4, 6); if (!foods.some(o => o.gold)) addFood(true); }
    }
  }
  function step() {
    if (queue.length) dir = queue.shift();
    const h = snake[0];
    let nx = h.x + dir.x, ny = h.y + dir.y;
    if (WRAP) { nx = (nx + cols) % cols; ny = (ny + rows) % rows; }
    else if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) { die('Bonk! That was a wall'); return; }
    const body = grow > 0 ? snake : snake.slice(0, -1);
    if (body.some(s => s.x === nx && s.y === ny)) { die('Tied in a knot'); return; }
    prev = snake.map(s => ({ x: s.x, y: s.y }));
    snake.unshift({ x: nx, y: ny });
    if (grow > 0) { grow--; prev.push({ ...prev[prev.length - 1] }); } else snake.pop();
    for (const f of foods.slice()) if (f.x === nx && f.y === ny) eat(f);
  }
  /* the start screen: the snake chases food on its own */
  function autopilot() {
    const h = snake[0];
    const f = foods[0];
    let best = null, bestD = Infinity;
    for (const d of [U, D, L, R]) {
      if (d.x === -dir.x && d.y === -dir.y) continue;
      let x = h.x + d.x, y = h.y + d.y;
      if (WRAP) { x = (x + cols) % cols; y = (y + rows) % rows; } else if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (snake.slice(0, -1).some(s => s.x === x && s.y === y)) continue;
      const dd = f ? gap(x, f.x, cols) + gap(y, f.y, rows) + Math.random() * 0.5 : Math.random();
      if (dd < bestD) { bestD = dd; best = d; }
    }
    if (!best) return false;
    queue = [best];
    return true;
  }
  function tick(dt, auto) {
    for (const f of foods) {
      f.hop = Math.min(1, f.hop + dt * 7);
      f.born = Math.min(1, f.born + dt * 4);
      const fs = FOOD_SPEED * (f.gold ? 1.7 : 1);
      if (fs > 0) { f.acc += dt * fs; while (f.acc >= 1) { f.acc -= 1; hop(f); } }
      if (f.gold) f.life -= dt;
    }
    foods = foods.filter(f => {
      if (f.life > 0) return true;
      const [x, y] = center(f.x, f.y);
      K.burst(x, y, ['#fde047', 'rgba(255,255,255,.6)'], 10, 90, { life: 0.5 });
      return false;
    });
    if (!foods.some(f => !f.gold)) addFood(false);
    tongue = Math.max(0, tongue - dt);
    if (tongue <= 0 && Math.random() < dt * 0.5) tongue = 0.35;
    acc += dt;
    const iv = 1 / speed();
    while (acc >= iv && alive) {
      acc -= iv;
      if (auto && !autopilot()) { start(); return; }
      step();
      if (auto && !alive) { start(); return; }
    }
  }
  function start() {
    /* as many cells as fit, up to a board of about 720 x 480 px at this cell size:
       on a big window the cells grow instead of the board getting endless */
    cols = K.clamp(Math.min(Math.floor((K.W - 16) / CELL), Math.round(720 / CELL)), 10, 60);
    rows = K.clamp(Math.min(Math.floor((K.H - 62) / CELL), Math.round(480 / CELL)), 8, 40);
    fitGrid();
    const y = Math.floor(rows / 2);
    snake = [{ x: 4, y }, { x: 3, y }, { x: 2, y }, { x: 1, y }];
    prev = snake.map(s => ({ ...s }));
    dir = R; queue = []; acc = 0; foods = []; eaten = 0; grow = 0; alive = true; untilGold = K.ri(4, 6); tongue = 0;
    addFood(false);
  }

  return {
    title: 'Runaway Snake',
    tagline: 'The food has legs. Corner it.',
    controls: ['Arrow keys or W A S D to turn', 'Touch: swipe, or tap beside the head   ·   P: pause'],
    accent: '#4ade80',
    bg: '#03100b',
    resize() { if (snake) fitGrid(); },
    reset() { start(); },
    idle(dt) { if (K.state === 'start') tick(dt, true); },
    update(dt) {
      if (K.hit('ArrowUp', 'KeyW')) turn(U);
      if (K.hit('ArrowDown', 'KeyS')) turn(D);
      if (K.hit('ArrowLeft', 'KeyA')) turn(L);
      if (K.hit('ArrowRight', 'KeyD')) turn(R);
      tick(dt, false);
    },
    move(p) {
      const dx = p.x - p.x0, dy = p.y - p.y0;
      if (Math.hypot(dx, dy) < 26) return;
      turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? R : L) : (dy > 0 ? D : U));
      p.x0 = p.x; p.y0 = p.y; p.swiped = true;
    },
    up(p, tap) {
      if (!tap || p.swiped) return;
      const [hx, hy] = center(snake[0].x, snake[0].y);
      const last = queue.length ? queue[queue.length - 1] : dir;
      if (last.x !== 0) turn(p.y < hy ? U : D);
      else turn(p.x < hx ? L : R);
    },
    draw(g) {
      const bg = g.createLinearGradient(0, 0, 0, K.H);
      bg.addColorStop(0, '#062018');
      bg.addColorStop(1, '#020a07');
      g.fillStyle = bg;
      g.fillRect(0, 0, K.W, K.H);
      /* the board */
      g.save();
      g.shadowColor = 'rgba(0,0,0,.6)';
      g.shadowBlur = 24;
      g.fillStyle = '#0b231a';
      K.rr(g, ox - 6, oy - 6, cols * cs + 12, rows * cs + 12, 10);
      g.fill();
      g.restore();
      if (board) g.drawImage(board, ox, oy);
      g.save();
      g.strokeStyle = WRAP ? 'rgba(134,239,172,.35)' : 'rgba(248,113,113,.45)';
      g.lineWidth = 2;
      if (WRAP) g.setLineDash([6, 6]);
      K.rr(g, ox - 3, oy - 3, cols * cs + 6, rows * cs + 6, 7);
      g.stroke();
      g.restore();
      const f = K.clamp(acc * speed(), 0, 1);
      /* food */
      for (const fd of foods) {
        if (fd.gold && fd.life < 2.5 && Math.floor(K.t * 8) % 2) continue;
        const t = fd.hop;
        let gx = fd.x, gy = fd.y;
        if (gap(fd.fx, fd.x, cols) <= 1 && gap(fd.fy, fd.y, rows) <= 1 && Math.abs(fd.fx - fd.x) <= 1 && Math.abs(fd.fy - fd.y) <= 1) { gx = K.lerp(fd.fx, fd.x, t); gy = K.lerp(fd.fy, fd.y, t); }
        const [cx, cy0] = center(gx, gy);
        const lift = Math.sin(Math.PI * t) * cs * 0.35;
        const cy = cy0 - lift;
        const r = cs * 0.36 * (0.4 + 0.6 * fd.born);
        const col = fd.gold ? '#facc15' : FOOD;
        g.fillStyle = 'rgba(0,0,0,.3)';
        g.beginPath(); g.ellipse(cx, cy0 + cs * 0.32, r * (1 - lift / cs), r * 0.3, 0, 0, 7); g.fill();
        /* legs */
        g.strokeStyle = mix(col, '#000000', 0.45);
        g.lineWidth = Math.max(1.5, cs * 0.07);
        g.lineCap = 'round';
        const kick = Math.sin(K.t * 20) * (t < 1 ? cs * 0.12 : cs * 0.03);
        g.beginPath();
        g.moveTo(cx - r * 0.4, cy + r * 0.7); g.lineTo(cx - r * 0.5 - kick, cy + r * 1.25);
        g.moveTo(cx + r * 0.4, cy + r * 0.7); g.lineTo(cx + r * 0.5 + kick, cy + r * 1.25);
        g.stroke();
        g.save();
        g.shadowColor = col;
        g.shadowBlur = fd.gold ? 22 : 12;
        const fg = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
        fg.addColorStop(0, mix(col, '#ffffff', 0.55));
        fg.addColorStop(1, col);
        g.fillStyle = fg;
        g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
        g.restore();
        /* leaf, and worried eyes looking the way it runs */
        g.fillStyle = fd.gold ? '#fef08a' : '#4ade80';
        g.beginPath(); g.ellipse(cx + r * 0.25, cy - r * 1.05, r * 0.38, r * 0.18, -0.6, 0, 7); g.fill();
        const lx = fd.look.x * r * 0.18, ly = fd.look.y * r * 0.18;
        for (const s of [-1, 1]) {
          g.fillStyle = '#fff';
          g.beginPath(); g.arc(cx + s * r * 0.33, cy - r * 0.1, r * 0.24, 0, 7); g.fill();
          g.fillStyle = '#111827';
          g.beginPath(); g.arc(cx + s * r * 0.33 + lx, cy - r * 0.1 + ly, r * 0.12, 0, 7); g.fill();
        }
      }
      /* the snake: only the head and the tail glide between cells, so corners stay square */
      const glide = (i) => {
        const s0 = snake[i], p = prev[i] || s0;
        if (Math.abs(p.x - s0.x) > 1 || Math.abs(p.y - s0.y) > 1) return center(s0.x, s0.y);
        return center(K.lerp(p.x, s0.x, f), K.lerp(p.y, s0.y, f));
      };
      /* the head's tip, every body cell's centre, then the tail's end */
      const pts = [glide(0), ...snake.slice(1).map(s0 => center(s0.x, s0.y)), glide(snake.length - 1)];
      const n = pts.length;
      const dark = mixA(K.accent, '#022c22', 0.6);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const linked = (a, b) => Math.abs(a[0] - b[0]) <= cs * 1.5 && Math.abs(a[1] - b[1]) <= cs * 1.5;
      for (let i = n - 1; i >= 1; i--) {
        const a = pts[i], b = pts[i - 1];
        if (!linked(a, b)) continue;
        const k = 1 - i / n;
        g.strokeStyle = mix(dark, K.accent, k);
        g.lineWidth = cs * (0.52 + 0.28 * k);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      g.strokeStyle = 'rgba(255,255,255,.16)';
      g.lineWidth = cs * 0.18;
      g.beginPath();
      for (let i = n - 1; i >= 0; i--) {
        if (i < n - 1 && linked(pts[i], pts[i + 1])) g.lineTo(pts[i][0], pts[i][1] - cs * 0.12);
        else g.moveTo(pts[i][0], pts[i][1] - cs * 0.12);
      }
      g.stroke();
      const [hx, hy] = pts[0];
      const look = dir;
      g.save();
      g.shadowColor = K.accent;
      g.shadowBlur = 14;
      g.fillStyle = K.accent;
      g.beginPath(); g.arc(hx, hy, cs * 0.44, 0, 7); g.fill();
      g.restore();
      if (tongue > 0 && alive) {
        const tl = cs * 0.55;
        g.strokeStyle = '#fb7185';
        g.lineWidth = Math.max(1.5, cs * 0.06);
        const tx = hx + look.x * (cs * 0.4 + tl), ty = hy + look.y * (cs * 0.4 + tl);
        g.beginPath();
        g.moveTo(hx + look.x * cs * 0.4, hy + look.y * cs * 0.4); g.lineTo(tx, ty);
        g.lineTo(tx + (look.x ? look.x * 4 : 4), ty + (look.y ? look.y * 4 : 4));
        g.moveTo(tx, ty); g.lineTo(tx + (look.x ? look.x * 4 : -4), ty + (look.y ? look.y * 4 : -4));
        g.stroke();
      }
      const px = -look.y, py = look.x;
      for (const s of [-1, 1]) {
        const ex = hx + look.x * cs * 0.12 + px * s * cs * 0.2, ey = hy + look.y * cs * 0.12 + py * s * cs * 0.2;
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(ex, ey, cs * 0.13, 0, 7); g.fill();
        g.fillStyle = alive ? '#052e16' : '#7f1d1d';
        g.beginPath(); g.arc(ex + look.x * cs * 0.05, ey + look.y * cs * 0.05, cs * 0.065, 0, 7); g.fill();
      }
      K.fx(g);
    },
    hud(g) {
      const w = K.pill(g, 'Score ' + K.score, 12, 12, '#fff');
      K.pill(g, 'Length ' + snake.length, 18 + w, 12, K.accent);
      const gold = foods.find(f => f.gold);
      if (gold) K.pill(g, 'Golden ' + Math.ceil(gold.life) + 's', K.W - 12, 12, '#fde047', 'right');
    },
    info() {
      const f = foods.find(x => !x.gold) || foods[0] || {};
      return { x: snake[0].x, y: snake[0].y, len: snake.length, dir: [dir.x, dir.y], foodX: f.x, foodY: f.y, alive, cols, rows };
    },
  };
}

export default {
  id: 'runaway-snake',
  name: 'Runaway Snake',
  icon: 'activity',
  genre: 'arcade',
  desc: 'Classic snake with a twist: the food runs away from you, so you have to herd it into a corner. Golden food is worth more but runs faster.',
  controls: 'Arrow keys or W/A/S/D to turn · touch: swipe, or tap beside the head · P pauses',
  season: null,
  colors: ['#03100b', '#4ade80'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Runaway Snake' },
    { k: 'startSpeed', label: 'Snake speed (cells a second)', type: 'range', min: 4, max: 14, step: 0.5, value: 7 },
    { k: 'foodSpeed', label: 'Food speed (0 = it stays put)', type: 'range', min: 0, max: 6, step: 0.5, value: 2.5 },
    { k: 'wrap', label: 'Go through walls', type: 'toggle', value: false },
    { k: 'cell', label: 'Cell size', type: 'range', min: 16, max: 40, step: 2, value: 24 },
    { k: 'accent', label: 'Snake colour', type: 'color', value: '#4ade80' },
    { k: 'foodColor', label: 'Food colour', type: 'color', value: '#f87171' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'ArrowUp', ms: 400, field: 'y', dir: -1 },
  game,
  art(g, w, h) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#062018'); bg.addColorStop(1, '#020a07');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const cs = 20, ox = (w - 14 * cs) / 2, oy = (h - 8 * cs) / 2;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 14; x++) { g.fillStyle = (x + y) % 2 ? '#0e2a20' : '#0b231a'; g.fillRect(ox + x * cs, oy + y * cs, cs, cs); }
    const body = [[3, 5], [4, 5], [5, 5], [6, 5], [6, 4], [6, 3], [7, 3], [8, 3]];
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 1; i < body.length; i++) {
      g.strokeStyle = i < 4 ? '#15803d' : '#22c55e'; g.lineWidth = cs * (0.5 + i * 0.03);
      g.beginPath(); g.moveTo(ox + body[i - 1][0] * cs + cs / 2, oy + body[i - 1][1] * cs + cs / 2); g.lineTo(ox + body[i][0] * cs + cs / 2, oy + body[i][1] * cs + cs / 2); g.stroke();
    }
    const hx = ox + 8 * cs + cs / 2, hy = oy + 3 * cs + cs / 2;
    g.shadowColor = '#4ade80'; g.shadowBlur = 12; g.fillStyle = '#4ade80';
    g.beginPath(); g.arc(hx, hy, cs * 0.45, 0, 7); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(hx + 3, hy - 4, 2.6, 0, 7); g.arc(hx + 3, hy + 4, 2.6, 0, 7); g.fill();
    const fx = ox + 11.5 * cs, fy = oy + 2.2 * cs;
    g.strokeStyle = '#7f1d1d'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(fx - 3, fy + 5); g.lineTo(fx - 7, fy + 11); g.moveTo(fx + 3, fy + 5); g.lineTo(fx + 8, fy + 10); g.stroke();
    g.shadowColor = '#f87171'; g.shadowBlur = 12; g.fillStyle = '#f87171';
    g.beginPath(); g.arc(fx, fy, 8, 0, 7); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#4ade80'; g.beginPath(); g.ellipse(fx + 2, fy - 9, 4, 2, -0.6, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 3; i++) g.fillRect(fx - 18 - i * 6, fy + 2 + i * 2, 4, 1.5);
  },
};
