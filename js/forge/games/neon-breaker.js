/* Neon Breaker — a Static Forge template (original code and art).
   Brick breaker: five wall patterns that repeat tougher, power-up
   capsules, a combo for hits between paddle touches.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const BASE_SPEED = N(P.ballSpeed, 400);
  const PADDLE_W = N(P.paddleWidth, 120);
  const LIVES = Math.max(1, Math.round(N(P.lives, 3)));
  const ROWS = Math.max(1, Math.round(N(P.rows, 6)));
  const POWER = N(P.powerChance, 18) / 100;
  const HUES = ['#f472b6', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa', '#f87171', '#2dd4bf', '#e879f9'];
  const POWERS = {
    wide: { color: '#4ade80', label: 'W', name: 'Wide paddle' },
    multi: { color: '#38bdf8', label: '3', name: 'Multi-ball' },
    slow: { color: '#facc15', label: 'S', name: 'Slow ball' },
    pierce: { color: '#f472b6', label: 'P', name: 'Piercing ball' },
    life: { color: '#f87171', label: '+', name: 'Extra life' },
  };
  const POWER_BAG = ['wide', 'wide', 'multi', 'multi', 'slow', 'pierce', 'pierce', 'life'];

  let L = {};                    /* layout, from the window size */
  let pad, balls, bricks, drops, lives, level, combo, wideT, slowT, pierceT, banner, lastKey;
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.6 + 0.3 }));

  function layout() {
    const fw = Math.min(K.W - 24, 860);
    const cols = K.clamp(Math.round(fw / 74), 6, 12);
    L = { fx: (K.W - fw) / 2, fw, top: 56, cols, bw: fw / cols, bh: Math.max(14, Math.min(24, K.H / 26)), py: K.H - 42 };
    L.by = L.top + 34;
  }
  const brickRect = b => ({ x: L.fx + b.c * L.bw + 3, y: L.by + b.r * (L.bh + 6), w: L.bw - 6, h: L.bh });

  function pattern(lv) {
    const out = [];
    const kind = (lv - 1) % 5;
    const tough = Math.min(3, 1 + Math.floor((lv - 1) / 3));
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < L.cols; c++) {
        const mid = (L.cols - 1) / 2;
        let on = true;
        if (kind === 1) on = (r + c) % 2 === 0;
        else if (kind === 2) on = Math.abs(c - mid) <= (r + 1) * L.cols / (2 * ROWS) + 0.5;
        else if (kind === 3) on = Math.abs(c - mid) / (L.cols / 2) + Math.abs(r - (ROWS - 1) / 2) / (ROWS / 2) <= 1.05;
        else if (kind === 4) on = r % 3 !== 2 && c % 4 !== 3;
        if (!on) continue;
        const hp = Math.max(1, Math.min(3, tough + (r < ROWS / 3 ? 1 : 0) - (lv === 1 ? 1 : 0)));
        out.push({ c, r, hp, max: hp, color: HUES[(r + lv) % HUES.length], hit: 0 });
      }
    }
    return out;
  }
  const speed = () => BASE_SPEED * (1 + 0.06 * (level - 1)) * (slowT > 0 ? 0.68 : 1);
  function newBall() { balls = [{ x: pad.x, y: L.py - 12, vx: 0, vy: 0, r: 7, stuck: true, trail: [] }]; }
  function startLevel() {
    bricks = pattern(level);
    drops = [];
    combo = 0;
    newBall();
    banner = { text: 'Level ' + level, t: 1.6 };
  }
  function launch() {
    for (const b of balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const a = K.rnd(-0.35, 0.35);
      b.vx = Math.sin(a) * speed();
      b.vy = -Math.cos(a) * speed();
      K.sfx('blip');
    }
  }
  function setSpeed(b) {
    const m = Math.hypot(b.vx, b.vy) || 1;
    b.vx = b.vx / m * speed();
    b.vy = b.vy / m * speed();
    if (Math.abs(b.vy) < speed() * 0.25) b.vy = (b.vy < 0 ? -1 : 1) * speed() * 0.25;
  }

  function power(kind, x, y) {
    K.sfx('power');
    K.float(x, y - 20, POWERS[kind].name, POWERS[kind].color, 16);
    if (kind === 'wide') wideT = 12;
    else if (kind === 'slow') { slowT = 8; balls.forEach(setSpeed); }
    else if (kind === 'pierce') pierceT = 7;
    else if (kind === 'life') lives = Math.min(9, lives + 1);
    else if (kind === 'multi') {
      const more = [];
      for (const b of balls.slice(0, 6)) {
        if (b.stuck) continue;
        for (const da of [-0.35, 0.35]) {
          const a = Math.atan2(b.vy, b.vx) + da;
          more.push({ x: b.x, y: b.y, vx: Math.cos(a) * speed(), vy: Math.sin(a) * speed(), r: 7, stuck: false, trail: [] });
        }
      }
      balls.push(...more);
    }
  }

  function hitBrick(b, br) {
    br.hp--;
    br.hit = 0.15;
    combo++;
    const R = brickRect(br);
    if (br.hp <= 0) {
      bricks.splice(bricks.indexOf(br), 1);
      K.add(10 * br.max * Math.min(8, combo), R.x + R.w / 2, R.y, br.color);
      K.burst(R.x + R.w / 2, R.y + R.h / 2, [br.color, '#fff'], 16, 220, { life: 0.5 });
      K.sfx('pick');
      if (Math.random() < POWER) drops.push({ x: R.x + R.w / 2, y: R.y + R.h / 2, kind: K.pick(POWER_BAG) });
    } else {
      K.add(5, null);
      K.sfx('hit');
    }
    K.shake(br.hp <= 0 ? 4 : 2);
  }

  function stepBall(b, dt) {
    if (b.stuck) { b.x = pad.x; b.y = L.py - b.r - 1; return true; }
    const steps = Math.ceil(Math.hypot(b.vx, b.vy) * dt / 5);
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      b.x += b.vx * h;
      b.y += b.vy * h;
      if (b.x - b.r < L.fx) { b.x = L.fx + b.r; b.vx = Math.abs(b.vx); K.sfx('blip'); }
      if (b.x + b.r > L.fx + L.fw) { b.x = L.fx + L.fw - b.r; b.vx = -Math.abs(b.vx); K.sfx('blip'); }
      if (b.y - b.r < L.top) { b.y = L.top + b.r; b.vy = Math.abs(b.vy); K.sfx('blip'); }
      /* paddle */
      const pw = pad.w / 2;
      if (b.vy > 0 && b.y + b.r >= L.py && b.y + b.r <= L.py + 16 && b.x > pad.x - pw - b.r && b.x < pad.x + pw + b.r) {
        const a = K.clamp((b.x - pad.x) / pw, -1, 1) * 1.05;
        b.vx = Math.sin(a) * speed();
        b.vy = -Math.cos(a) * speed();
        b.y = L.py - b.r;
        combo = 0;
        pad.squash = 0.12;
        K.sfx('hit');
        K.burst(b.x, L.py, K.accent, 6, 120, { life: 0.3 });
      }
      /* bricks: the deepest overlap decides which side it bounced off */
      for (const br of bricks) {
        const R = brickRect(br);
        const cx = K.clamp(b.x, R.x, R.x + R.w);
        const cy = K.clamp(b.y, R.y, R.y + R.h);
        const dx = b.x - cx, dy = b.y - cy;
        if (dx * dx + dy * dy > b.r * b.r) continue;
        if (pierceT <= 0) {
          const ox = Math.min(b.x + b.r - R.x, R.x + R.w - (b.x - b.r));
          const oy = Math.min(b.y + b.r - R.y, R.y + R.h - (b.y - b.r));
          if (ox < oy) { b.vx = b.x < R.x + R.w / 2 ? -Math.abs(b.vx) : Math.abs(b.vx); }
          else { b.vy = b.y < R.y + R.h / 2 ? -Math.abs(b.vy) : Math.abs(b.vy); }
        }
        hitBrick(b, br);
        break;
      }
      if (b.y - b.r > K.H) return false;
    }
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 10) b.trail.shift();
    return true;
  }

  function movePaddle(dt) {
    const ax = K.ax();
    if (ax) lastKey = K.t;
    const p = K.primary();
    let target = null;
    if (p) target = p.x;
    else if (K.mouse && K.mouse.t > lastKey) target = K.mouse.x;
    if (target != null) pad.x = K.lerp(pad.x, target, Math.min(1, dt * 18));
    else pad.vx = K.lerp(pad.vx, ax * 820, Math.min(1, dt * 14));
    if (target == null) pad.x += pad.vx * dt;
    else pad.vx = 0;
    pad.w = K.lerp(pad.w, PADDLE_W * (wideT > 0 ? 1.6 : 1), Math.min(1, dt * 8));
    pad.x = K.clamp(pad.x, L.fx + pad.w / 2, L.fx + L.fw - pad.w / 2);
  }

  return {
    title: 'Neon Breaker',
    tagline: 'Smash every brick. Catch the capsules.',
    controls: ['Arrow keys / A D, the mouse or a finger: move', 'Space or tap: launch the ball   ·   P: pause'],
    accent: '#38bdf8',
    bg: '#060716',
    resize() { layout(); },
    reset() {
      layout();
      pad = { x: K.W / 2, w: PADDLE_W, vx: 0, squash: 0 };
      lives = LIVES; level = 1; wideT = 0; slowT = 0; pierceT = 0; lastKey = -1;
      startLevel();
    },
    idle(dt) { if (banner) banner.t = Math.max(0, banner.t - dt); },
    update(dt) {
      movePaddle(dt);
      if (K.hit('Space', 'ArrowUp', 'KeyW')) launch();
      wideT = Math.max(0, wideT - dt);
      pierceT = Math.max(0, pierceT - dt);
      if (slowT > 0) { slowT -= dt; if (slowT <= 0) balls.forEach(setSpeed); }
      pad.squash = Math.max(0, pad.squash - dt);
      if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      for (const br of bricks) br.hit = Math.max(0, br.hit - dt);
      balls = balls.filter(b => stepBall(b, dt));
      for (const d of drops) d.y += 150 * dt;
      drops = drops.filter(d => {
        if (d.y > L.py - 8 && d.y < L.py + 18 && Math.abs(d.x - pad.x) < pad.w / 2 + 14) { power(d.kind, d.x, d.y); return false; }
        return d.y < K.H + 20;
      });
      if (!balls.length) {
        lives--;
        K.shake(10);
        K.flash('#f87171', 0.25);
        K.sfx('hurt');
        if (lives <= 0) { K.over('Out of balls'); return; }
        wideT = 0; pierceT = 0; slowT = 0; drops = [];
        newBall();
      }
      if (!bricks.length) {
        K.add(250 * level, K.W / 2, K.H / 2, K.accent);
        K.sfx('win');
        K.burst(K.W / 2, K.H / 2, HUES, 60, 360, { life: 1 });
        level++;
        startLevel();
      }
    },
    down() { launch(); },
    draw(g) {
      const bg = g.createLinearGradient(0, 0, 0, K.H);
      bg.addColorStop(0, '#0b0b26');
      bg.addColorStop(1, '#03030b');
      g.fillStyle = bg;
      g.fillRect(0, 0, K.W, K.H);
      for (const s of stars) {
        g.globalAlpha = 0.25 + 0.25 * Math.sin(K.t * 1.5 + s.x * 40);
        g.fillStyle = '#c7d2fe';
        g.fillRect(s.x * K.W, s.y * K.H, s.s, s.s);
      }
      g.globalAlpha = 1;
      /* the field: a faint frame and a perspective grid at the bottom */
      g.strokeStyle = 'rgba(148,163,255,.16)';
      g.lineWidth = 2;
      g.strokeRect(L.fx - 1, L.top - 1, L.fw + 2, K.H - L.top + 4);
      g.strokeStyle = 'rgba(56,189,248,.07)';
      g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const y = K.H - 8 - i * i * 7;
        g.beginPath(); g.moveTo(L.fx, y); g.lineTo(L.fx + L.fw, y); g.stroke();
      }
      /* bricks */
      for (const br of bricks) {
        const R = brickRect(br);
        g.save();
        g.shadowColor = br.color;
        g.shadowBlur = br.hit > 0 ? 22 : 10;
        const gr = g.createLinearGradient(0, R.y, 0, R.y + R.h);
        gr.addColorStop(0, br.hit > 0 ? '#ffffff' : br.color);
        gr.addColorStop(1, br.hp < br.max ? 'rgba(20,20,40,.9)' : 'rgba(0,0,0,.35)');
        g.fillStyle = br.color;
        K.rr(g, R.x, R.y, R.w, R.h, 5);
        g.fill();
        g.shadowBlur = 0;
        g.fillStyle = gr;
        g.globalAlpha = 0.55;
        g.fill();
        g.globalAlpha = 1;
        if (br.max > 1) {
          for (let i = 0; i < br.hp; i++) { g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(R.x + 6 + i * 7, R.y + R.h - 6, 4, 3); }
        }
        g.restore();
      }
      /* capsules */
      for (const d of drops) {
        const pw = POWERS[d.kind];
        g.save();
        g.shadowColor = pw.color;
        g.shadowBlur = 14;
        g.fillStyle = pw.color;
        K.rr(g, d.x - 16, d.y - 8, 32, 16, 8);
        g.fill();
        g.restore();
        K.txt(g, pw.label, d.x, d.y + 1, 12, '#0b0b1a', 'center', 900);
      }
      /* paddle */
      const sq = pad.squash > 0 ? pad.squash * 30 : 0;
      g.save();
      g.shadowColor = K.accent;
      g.shadowBlur = 20;
      const pg = g.createLinearGradient(0, L.py, 0, L.py + 14);
      pg.addColorStop(0, '#ffffff');
      pg.addColorStop(0.35, K.accent);
      pg.addColorStop(1, K.accent);
      g.fillStyle = pg;
      K.rr(g, pad.x - pad.w / 2 - sq / 2, L.py + sq / 6, pad.w + sq, 14 - sq / 3, 7);
      g.fill();
      g.restore();
      /* balls */
      for (const b of balls) {
        b.trail.forEach((t, i) => {
          g.globalAlpha = (i / b.trail.length) * 0.35;
          g.fillStyle = pierceT > 0 ? '#f472b6' : K.accent;
          g.beginPath(); g.arc(t.x, t.y, b.r * (i / b.trail.length), 0, 7); g.fill();
        });
        g.globalAlpha = 1;
        g.save();
        g.shadowColor = pierceT > 0 ? '#f472b6' : K.accent;
        g.shadowBlur = 18;
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(b.x, b.y, b.r, 0, 7); g.fill();
        g.restore();
      }
      K.fx(g);
      if (K.state === 'play' && balls.some(b => b.stuck) && !banner) {
        g.globalAlpha = 0.6 + 0.4 * Math.sin(K.t * 5);
        K.txt(g, K.touch ? 'Tap to launch' : 'Space to launch', K.W / 2, L.py - 46, 15, '#e0e7ff', 'center', 700);
        g.globalAlpha = 1;
      }
      if (banner && K.state === 'play') {
        g.globalAlpha = Math.min(1, banner.t * 2);
        K.txt(g, banner.text, K.W / 2, K.H * 0.58, 34, K.accent, 'center', 900);
        g.globalAlpha = 1;
      }
    },
    hud(g) {
      K.pill(g, 'Score ' + K.score, 12, 12, '#fff');
      K.pill(g, 'Level ' + level, K.W / 2, 12, K.accent, 'center');
      K.pill(g, '♥ '.repeat(Math.min(lives, 6)).trim() + (lives > 6 ? ' +' + (lives - 6) : ''), K.W - 12, 12, '#fb7185', 'right');
      let x = 12;
      const timers = [[wideT, 'Wide', POWERS.wide.color], [slowT, 'Slow', POWERS.slow.color], [pierceT, 'Pierce', POWERS.pierce.color]];
      for (const [t, name, c] of timers) if (t > 0) x += K.pill(g, name + ' ' + Math.ceil(t), x, 46, c) + 6;
    },
    info() {
      return { x: pad.x, w: pad.w, balls: balls.length, stuck: balls.some(b => b.stuck), bricks: bricks.length, level, lives };
    },
  };
}

export default {
  id: 'neon-breaker',
  name: 'Neon Breaker',
  icon: 'grid',
  genre: 'arcade',
  desc: 'Smash walls of glowing bricks, catch power-up capsules and keep the ball alive. Every wall you clear comes back tougher.',
  controls: 'Arrow keys or A/D, the mouse or a finger to move the paddle · Space or tap to launch · P pauses',
  season: null,
  colors: ['#060716', '#38bdf8'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Neon Breaker' },
    { k: 'ballSpeed', label: 'Ball speed', type: 'range', min: 250, max: 700, step: 10, value: 400 },
    { k: 'paddleWidth', label: 'Paddle width', type: 'range', min: 60, max: 220, step: 5, value: 120 },
    { k: 'lives', label: 'Lives', type: 'range', min: 1, max: 9, step: 1, value: 3 },
    { k: 'rows', label: 'Brick rows', type: 'range', min: 3, max: 9, step: 1, value: 6 },
    { k: 'powerChance', label: 'Power-up chance (%)', type: 'range', min: 0, max: 60, step: 5, value: 18 },
    { k: 'accent', label: 'Glow colour', type: 'color', value: '#38bdf8' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  /* how Forge's test suite checks that the game reacts to input: hold `key`
     for `ms` after starting and info()[field] must move in `dir`; then the
     same for a pointer drag of (dx, dy) from the middle of the screen */
  test: { key: 'ArrowRight', ms: 400, field: 'x', dir: 1, drag: { dx: 220, dy: 0, field: 'x', dir: 1 } },
  game,
  art(g, w, h) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0d0d2e'); bg.addColorStop(1, '#03030b');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const hues = ['#f472b6', '#fb923c', '#facc15', '#4ade80', '#38bdf8'];
    const bw = w / 9;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 9; c++) {
        if ((r === 2 && c % 3 === 1) || (r === 3 && c % 2)) continue;
        g.shadowColor = hues[r]; g.shadowBlur = 8; g.fillStyle = hues[r];
        g.fillRect(c * bw + 4, 22 + r * 18, bw - 8, 12);
      }
    }
    g.shadowColor = '#38bdf8'; g.shadowBlur = 16;
    g.fillStyle = '#38bdf8'; g.fillRect(w / 2 - 34, h - 26, 68, 9);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2 + 22, h - 64, 6, 0, 7); g.fill();
    g.shadowBlur = 0;
    g.globalAlpha = 0.3; g.fillStyle = '#38bdf8';
    for (let i = 1; i < 6; i++) { g.beginPath(); g.arc(w / 2 + 22 - i * 9, h - 64 + i * 7, 6 - i, 0, 7); g.fill(); }
    g.globalAlpha = 1;
  },
};
