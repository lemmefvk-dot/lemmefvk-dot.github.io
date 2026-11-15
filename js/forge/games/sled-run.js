/* Sled Run — a Static Forge template (original code and art).
   A winter runner: steer a sled down a snowy slope, dodge the trees and
   rocks, scoop up the presents. The slope gets faster the longer you last.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const LIVES = Math.max(1, Math.round(N(P.lives, 3)));
  const SPEED = Math.max(80, N(P.speed, 230));
  const TREES = K.clamp(N(P.trees, 55), 10, 90) / 100;

  let U = 1, sled, items, lives, spawnT, time, dist, bonus, hurtT, lastKey, gifts;
  const flakes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2, v: 25 + Math.random() * 50 }));

  function layout() {
    U = K.clamp(Math.min(K.W / 820, K.H / 580), 0.5, 1.6);
    if (sled) { sled.y = K.H - 96 * U; sled.w = 46 * U; sled.x = K.clamp(sled.x, sled.w / 2, K.W - sled.w / 2); }
  }
  const speed = () => SPEED * U * (1 + Math.min(1.6, time / 55));

  function spawn() {
    const r0 = Math.random();
    const k = r0 < TREES ? 'tree' : r0 < TREES + 0.15 ? 'rock' : 'gift';
    const r = (k === 'tree' ? 26 : k === 'rock' ? 17 : 15) * U;
    items.push({ k, r, x: K.rnd(r + 8, K.W - r - 8), y: -r - 10, ph: K.rnd(0, 6.28), c: K.pick(['#ef4444', '#22c55e', '#3b82f6', '#f59e0b']) });
  }
  function hit(it) {
    if (it.k === 'gift') {
      gifts++;
      bonus += 25;
      K.float(it.x, sled.y - 30 * U, '+25', '#fde68a', 20);
      K.burst(it.x, it.y, [it.c, '#fff', '#fde68a'], 18, 240, { life: 0.6, size: 4 });
      K.sfx('coin');
      return;
    }
    lives--;
    hurtT = 0.9;
    K.burst(it.x, it.y, ['#e0f2fe', '#fff', '#94a3b8'], 26, 320, { life: 0.7, size: 5 });
    K.shake(14);
    K.flash('#e0f2fe', 0.4);
    K.sfx('thud');
    if (lives <= 0) K.over('Wiped out!');
  }
  function drawItem(g, it) {
    g.save();
    g.translate(it.x, it.y);
    const r = it.r;
    if (it.k === 'tree') {
      g.fillStyle = '#5b3a1e'; g.fillRect(-r * 0.12, r * 0.6, r * 0.24, r * 0.5);
      for (let i = 0; i < 3; i++) {
        g.fillStyle = i % 2 ? '#15803d' : '#166534';
        g.beginPath(); g.moveTo(0, -r * 1.3 + i * r * 0.5); g.lineTo(r * (0.55 + i * 0.22), r * 0.15 + i * r * 0.28); g.lineTo(-r * (0.55 + i * 0.22), r * 0.15 + i * r * 0.28); g.closePath(); g.fill();
        g.fillStyle = '#f8fafc'; g.beginPath(); g.moveTo(0, -r * 1.3 + i * r * 0.5); g.lineTo(r * 0.22, -r * 0.9 + i * r * 0.5); g.lineTo(-r * 0.22, -r * 0.9 + i * r * 0.5); g.closePath(); g.fill();
      }
    } else if (it.k === 'rock') {
      g.fillStyle = '#64748b'; g.beginPath(); g.ellipse(0, 0, r, r * 0.75, 0, 0, 7); g.fill();
      g.fillStyle = '#94a3b8'; g.beginPath(); g.ellipse(-r * 0.2, -r * 0.2, r * 0.5, r * 0.3, -0.4, 0, 7); g.fill();
      g.fillStyle = '#f8fafc'; g.beginPath(); g.ellipse(0, -r * 0.55, r * 0.7, r * 0.25, 0, 0, 7); g.fill();
    } else {
      const s = r * 1.5, bob = Math.sin(K.t * 4 + it.ph) * 2;
      g.translate(0, bob);
      g.fillStyle = it.c; g.fillRect(-s / 2, -s / 2, s, s);
      g.fillStyle = '#fef3c7'; g.fillRect(-s * 0.1, -s / 2, s * 0.2, s); g.fillRect(-s / 2, -s * 0.1, s, s * 0.2);
      g.beginPath(); g.arc(-s * 0.18, -s * 0.62, s * 0.2, 0, 7); g.arc(s * 0.18, -s * 0.62, s * 0.2, 0, 7); g.fill();
    }
    g.restore();
  }
  function drawSled(g) {
    const x = sled.x, y = sled.y, w = sled.w;
    g.save();
    if (hurtT > 0 && Math.floor(hurtT * 16) % 2) g.globalAlpha = 0.45;
    g.translate(x, y);
    g.rotate(sled.vx * 0.00035);
    g.fillStyle = 'rgba(30,58,138,.25)'; g.beginPath(); g.ellipse(0, 20 * U, w * 0.7, 7 * U, 0, 0, 7); g.fill();
    g.strokeStyle = '#475569'; g.lineWidth = 3 * U; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-w * 0.55, 18 * U); g.lineTo(w * 0.55, 18 * U); g.quadraticCurveTo(w * 0.8, 18 * U, w * 0.7, 6 * U); g.stroke();
    g.fillStyle = '#b91c1c'; K.rr(g, -w / 2, -2 * U, w, 18 * U, 5 * U); g.fill();
    g.fillStyle = '#fca5a5'; g.fillRect(-w / 2 + 3, 2 * U, w - 6, 2 * U);
    g.fillStyle = K.accent; g.beginPath(); g.arc(0, -10 * U, 11 * U, 0, 7); g.fill();
    g.fillStyle = '#fde68a'; g.beginPath(); g.arc(0, -8 * U, 7 * U, 0, 7); g.fill();
    g.fillStyle = '#0f172a'; g.fillRect(-3 * U, -10 * U, 2 * U, 2 * U); g.fillRect(2 * U, -10 * U, 2 * U, 2 * U);
    g.fillStyle = '#f8fafc'; g.beginPath(); g.arc(0, -21 * U, 3.5 * U, 0, 7); g.fill();
    g.restore();
  }

  return {
    title: 'Sled Run',
    tagline: 'Down the mountain. Dodge the trees, grab the presents.',
    controls: ['Arrow keys / A D, the mouse or a finger: steer', 'Presents are worth 25   ·   P: pause'],
    accent: '#38bdf8',
    bg: '#dbeafe',
    resize() { layout(); },
    reset() {
      layout();
      sled = { x: K.W / 2, vx: 0, w: 46 * U, y: K.H - 96 * U };
      items = []; lives = LIVES; spawnT = 0.5; time = 0; dist = 0; bonus = 0; hurtT = 0; lastKey = -1; gifts = 0;
    },
    idle(dt) { dist += dt * 40; },
    update(dt) {
      time += dt;
      hurtT = Math.max(0, hurtT - dt);
      const v = speed();
      dist += v * dt;
      K.score = Math.floor(dist / 40) + bonus;
      const ax = K.ax();
      if (ax) lastKey = K.t;
      const p = K.primary();
      let target = null;
      if (p) target = p.x;
      else if (K.mouse && K.mouse.t > lastKey) target = K.mouse.x;
      if (target != null) { sled.vx = (target - sled.x) * 8; sled.x = K.lerp(sled.x, target, Math.min(1, dt * 12)); }
      else { sled.vx = K.lerp(sled.vx, ax * 560 * U, Math.min(1, dt * 8)); sled.x += sled.vx * dt; }
      sled.x = K.clamp(sled.x, sled.w / 2, K.W - sled.w / 2);
      spawnT -= dt;
      if (spawnT <= 0) { spawn(); spawnT = Math.max(0.28, 0.95 - time * 0.009) * K.rnd(0.7, 1.2); }
      for (const it of items) it.y += v * dt;
      items = items.filter(it => {
        if (Math.abs(it.y - sled.y) < it.r + 14 * U && Math.abs(it.x - sled.x) < it.r * 0.8 + sled.w * 0.45) {
          if (it.k !== 'gift' && hurtT > 0) return true;
          hit(it);
          return false;
        }
        return it.y - it.r < K.H + 20;
      });
    },
    down() { /* the sled follows the finger in update() */ },
    draw(g) {
      const sky = g.createLinearGradient(0, 0, 0, K.H);
      sky.addColorStop(0, '#bfdbfe'); sky.addColorStop(1, '#f8fafc');
      g.fillStyle = sky; g.fillRect(0, 0, K.W, K.H);
      /* ski tracks and drifts scroll past with the distance */
      g.strokeStyle = 'rgba(148,163,184,.35)'; g.lineWidth = 2;
      const off = (dist * 0.6) % 90;
      for (let y = -90 + off; y < K.H + 90; y += 90) {
        g.beginPath(); g.moveTo(K.W * 0.1, y); g.quadraticCurveTo(K.W * 0.3, y + 22, K.W * 0.5, y); g.quadraticCurveTo(K.W * 0.7, y - 22, K.W * 0.9, y); g.stroke();
      }
      for (const it of items || []) drawItem(g, it);
      if (sled) drawSled(g);
      g.fillStyle = 'rgba(255,255,255,.85)';
      for (const f of flakes) {
        f.y += f.v / 600; if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
        g.beginPath(); g.arc(f.x * K.W + Math.sin(K.t + f.x * 9) * 6, f.y * K.H, f.r, 0, 7); g.fill();
      }
      K.fx(g);
    },
    hud(g) {
      K.pill(g, 'Score ' + K.score, 12, 12, '#0f172a');
      K.pill(g, lives > 0 ? '♥ '.repeat(Math.min(lives, 6)).trim() : '♥ 0', K.W - 12, 12, '#dc2626', 'right');
    },
    info() { return { x: sled.x, lives, gifts, items: items.length, distance: Math.floor(dist / 40) }; },
  };
}

export default {
  id: 'sled-run',
  name: 'Sled Run',
  icon: 'snowflake',
  genre: 'runner',
  desc: 'Race a sled down a snowy mountain: weave between the trees and rocks, scoop up presents, and hang on as the slope speeds up.',
  controls: 'Arrow keys or A/D, the mouse or a finger to steer · P pauses',
  season: 'winter',
  colors: ['#dbeafe', '#38bdf8'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Sled Run' },
    { k: 'lives', label: 'Lives', type: 'range', min: 1, max: 9, step: 1, value: 3 },
    { k: 'speed', label: 'Slope speed', type: 'range', min: 100, max: 450, step: 10, value: 230 },
    { k: 'trees', label: 'Trees and rocks (%)', type: 'range', min: 10, max: 90, step: 5, value: 55 },
    { k: 'accent', label: 'Rider colour', type: 'color', value: '#38bdf8' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'ArrowRight', ms: 400, field: 'x', dir: 1, drag: { dx: 200, dy: 0, field: 'x', dir: 1 } },
  game,
  art(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#93c5fd'); sky.addColorStop(1, '#f8fafc');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(148,163,184,.5)'; g.lineWidth = 2;
    for (let y = 20; y < h; y += 40) { g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(w / 2, y + 14, w, y); g.stroke(); }
    const tree = (x, y, s) => {
      g.fillStyle = '#5b3a1e'; g.fillRect(x - 3, y + s * 0.6, 6, s * 0.4);
      for (let i = 0; i < 3; i++) { g.fillStyle = i % 2 ? '#15803d' : '#166534'; g.beginPath(); g.moveTo(x, y - s + i * s * 0.4); g.lineTo(x + s * (0.5 + i * 0.2), y + s * 0.2 + i * s * 0.2); g.lineTo(x - s * (0.5 + i * 0.2), y + s * 0.2 + i * s * 0.2); g.fill(); }
    };
    tree(w * 0.18, h * 0.38, 30); tree(w * 0.8, h * 0.3, 26); tree(w * 0.68, h * 0.7, 34);
    g.fillStyle = '#ef4444'; g.fillRect(w * 0.3, h * 0.25, 18, 18); g.fillStyle = '#fef3c7'; g.fillRect(w * 0.3 + 7, h * 0.25, 4, 18); g.fillRect(w * 0.3, h * 0.25 + 7, 18, 4);
    const sx = w * 0.5, sy = h * 0.74;
    g.strokeStyle = '#475569'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(sx - 30, sy + 18); g.lineTo(sx + 30, sy + 18); g.stroke();
    g.fillStyle = '#b91c1c'; g.fillRect(sx - 26, sy, 52, 18);
    g.fillStyle = '#38bdf8'; g.beginPath(); g.arc(sx, sy - 12, 13, 0, 7); g.fill();
    g.fillStyle = '#fde68a'; g.beginPath(); g.arc(sx, sy - 10, 8, 0, 7); g.fill();
    g.fillStyle = '#f8fafc'; g.beginPath(); g.arc(sx, sy - 25, 4, 0, 7); g.fill();
  },
};
