/* Coast Dash — a Static Forge template (original code and art).
   A top-down road race against the clock: steer a little roadster
   through slower traffic along a sunny coast, grab the time bonus at
   each checkpoint and cross the finish line before the clock runs out.
   Bumping a car costs a life and most of your speed; close passes score.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const LEN = K.clamp(N(P.length, 3000), 200, 20000);        /* metres to the finish */
  const TIME = K.clamp(N(P.time, 32), 5, 300);               /* seconds on the clock at the start */
  const BONUS = K.clamp(N(P.checkpointTime, 10), 0, 60);     /* seconds added at each quarter */
  const LIVES = Math.round(K.clamp(N(P.lives, 3), 1, 9));
  const TOP = K.clamp(N(P.topSpeed, 80), 30, 160);           /* metres per second */
  const TRAFFIC = K.clamp(N(P.traffic, 1), 0, 2.5);
  const LANES = 4;
  const PXM = 7;                                              /* pixels per metre along the road */
  const CAR_LEN = 6;                                          /* metres, for bumping */
  const CARS = ['#ef4444', '#f59e0b', '#a855f7', '#10b981', '#e5e7eb', '#38bdf8'];

  let x, speed, dist, left, lives, cars, nextRow, inv, extra, passed, banner, cpDone, roadL, laneW, roadW, py;

  function layout() {
    roadW = K.clamp(Math.min(K.W * 0.86, 420), 160, 520);
    laneW = roadW / LANES;
    roadL = (K.W - roadW) / 2;
    py = K.H * 0.78;
  }
  const lx = lane => roadL + (lane + 0.5) * laneW;
  const sy = d => py - (d - dist) * PXM;

  function spawn() {
    while (TRAFFIC > 0 && nextRow < dist + 240 && nextRow < LEN - 40) {
      const free = K.ri(0, LANES - 1);
      const n = Math.min(LANES - 1, 1 + (Math.random() < 0.35 * TRAFFIC ? 1 : 0) + (Math.random() < 0.15 * TRAFFIC ? 1 : 0));
      const lanes = [0, 1, 2, 3].filter(l => l !== free).sort(() => Math.random() - 0.5).slice(0, n);
      for (const l of lanes) cars.push({ lane: l, d: nextRow, c: K.pick(CARS), pass: false });
      nextRow += K.rnd(34, 62) / Math.max(0.4, TRAFFIC);
    }
  }

  function bump(c) {
    cars.splice(cars.indexOf(c), 1);
    lives--;
    speed *= 0.25;
    inv = 1.6;
    K.shake(10);
    K.sfx('hurt');
    K.burst(lx(x), py, ['#fde68a', '#f97316', '#fff'], 24, 260, { life: 0.5 });
    K.flash('#ef4444', 0.25);
    if (lives <= 0) K.over('Wrecked!');
  }

  const carShape = (g, cx, cy, w, h, color, glow) => {
    g.fillStyle = 'rgba(0,0,0,.28)';
    K.rr(g, cx - w / 2 + 3, cy - h / 2 + 4, w, h, 7); g.fill();
    g.fillStyle = color;
    K.rr(g, cx - w / 2, cy - h / 2, w, h, 7); g.fill();
    g.fillStyle = 'rgba(15,23,42,.8)';
    K.rr(g, cx - w * 0.36, cy - h * 0.2, w * 0.72, h * 0.22, 3); g.fill();
    K.rr(g, cx - w * 0.34, cy + h * 0.2, w * 0.68, h * 0.16, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.fillRect(cx - w * 0.04, cy - h / 2 + 2, w * 0.08, h - 4);
    if (glow) { g.fillStyle = '#fde68a'; g.fillRect(cx - w / 2 + 3, cy - h / 2, 5, 3); g.fillRect(cx + w / 2 - 8, cy - h / 2, 5, 3); }
  };

  return {
    title: 'Coast Dash',
    tagline: 'Beat the clock to the finish line.',
    controls: ['Left / Right or A / D: steer   ·   Down or S: brake', 'Touch or mouse: drag to steer   ·   P: pause', 'Checkpoints add time; every bump costs a life'],
    accent: '#fb923c',
    bg: '#0e7490',
    resize() { layout(); },
    reset() {
      layout();
      x = 1; speed = 0; dist = 0; left = TIME; lives = LIVES; cars = []; nextRow = 90; inv = 0; extra = 0; banner = null; cpDone = 0;
      spawn();
    },
    update(dt) {
      const brake = K.held('ArrowDown', 'KeyS');
      const target = brake ? 0 : TOP;
      speed += (target - speed) * Math.min(1, dt * (brake ? 2.2 : 0.7));
      if (brake && speed < 0.5) speed = 0;   /* only braking: from a standstill the first step is under 0.5 at 60 frames a second, and the car would never pull away */
      let steer = K.ax();
      const p = K.primary();
      if (p) {
        const want = K.clamp((p.x - roadL) / laneW - 0.5, 0, LANES - 1);
        steer = K.clamp((want - x) * 3, -1, 1);
      }
      x = K.clamp(x + steer * 3.4 * dt, 0, LANES - 1);
      dist += speed * dt;
      left -= dt;
      inv = Math.max(0, inv - dt);
      for (const c of cars) c.d += 26 * dt;
      spawn();
      cars = cars.filter(c => c.d > dist - 40);
      for (const c of cars) {
        const gap = c.d - dist;
        if (inv <= 0 && Math.abs(c.lane - x) < 0.72 && Math.abs(gap) < CAR_LEN) { bump(c); if (K.state !== 'play') return; break; }
        if (!c.pass && gap < -CAR_LEN) {
          c.pass = true;
          if (Math.abs(c.lane - x) < 1.15 && Math.abs(c.lane - x) >= 0.72) { extra += 25; K.float(lx(x), py - 60, 'Close pass +25', '#fde68a', 16); K.sfx('coin'); }
        }
      }
      /* a checkpoint at each quarter of the road */
      while (cpDone < 3 && dist >= LEN * (cpDone + 1) / 4) {
        cpDone++;
        left += BONUS;
        banner = { t: 1.8, text: 'Checkpoint  +' + Math.round(BONUS) + ' s' };
        K.sfx('power');
      }
      if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      K.score = Math.floor(dist / 10) + extra;
      if (dist >= LEN) {
        dist = LEN;
        K.score += Math.round(Math.max(0, left) * 20);
        K.win('Finish line!');
        return;
      }
      if (left <= 0) { left = 0; K.over('Out of time'); }
    },
    draw(g) {
      /* sea and sand either side, then the road */
      const sea = g.createLinearGradient(0, 0, K.W, 0);
      sea.addColorStop(0, '#0e7490'); sea.addColorStop(0.18, '#22b8cf'); sea.addColorStop(0.3, '#f3d9a4'); sea.addColorStop(0.7, '#f3d9a4'); sea.addColorStop(1, '#4ade80');
      g.fillStyle = sea; g.fillRect(0, 0, K.W, K.H);
      const off = dist * PXM;
      g.fillStyle = '#334155'; g.fillRect(roadL - 6, 0, roadW + 12, K.H);
      g.fillStyle = '#475569'; g.fillRect(roadL, 0, roadW, K.H);
      /* roadside palms, posts and lane dashes all scroll down with the road */
      const wrap = Math.ceil((K.H + 120) / 90) * 90;
      for (let i = 0; i < wrap / 90; i++) {
        const yy = ((i * 90 + off) % wrap) - 60;
        g.fillStyle = '#7c5a3a'; g.fillRect(roadL - 34, yy, 5, 18);
        g.fillStyle = '#16a34a'; g.beginPath(); g.ellipse(roadL - 31, yy, 14, 7, 0.3, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.fillRect(roadL + roadW + 14, yy, 5, 24);
      }
      const wrap2 = Math.ceil((K.H + 120) / 60) * 60;
      g.fillStyle = 'rgba(255,255,255,.7)';
      for (let i = 0; i < wrap2 / 60; i++) {
        const yy = ((i * 60 + off) % wrap2) - 60;
        for (let l = 1; l < LANES; l++) g.fillRect(roadL + l * laneW - 2, yy, 4, 30);
      }
      /* checkpoint gates and the finish line */
      for (let q = 1; q <= 4; q++) {
        const d = LEN * q / 4;
        const y = sy(d);
        if (y < -40 || y > K.H + 40) continue;
        if (q === 4) {
          const sq = laneW / 4;
          for (let i = 0; i < LANES * 4; i++) for (let r = 0; r < 2; r++) { g.fillStyle = (i + r) % 2 ? '#fff' : '#111827'; g.fillRect(roadL + i * sq, y - 14 + r * 14, sq, 14); }
        } else {
          g.fillStyle = cpDone >= q ? '#4ade80' : '#facc15';
          g.fillRect(roadL - 6, y - 4, roadW + 12, 8);
        }
      }
      for (const c of cars) {
        const y = sy(c.d);
        if (y < -60 || y > K.H + 60) continue;
        carShape(g, lx(c.lane), y, laneW * 0.56, 46, c.c, false);
      }
      if (inv <= 0 || Math.floor(K.t * 14) % 2) carShape(g, lx(x), py, laneW * 0.58, 48, K.accent, true);
      K.fx(g);
    },
    hud(g) {
      K.pill(g, 'Time ' + Math.max(0, left).toFixed(1), 12, 12, left < 8 ? '#f87171' : '#fff');
      K.pill(g, 'Lives ' + lives, 12, 46, '#fda4af');
      K.pill(g, 'Score ' + K.score, K.W - 12, 12, '#fff', 'right');
      K.pill(g, Math.round(speed * 3.6) + ' km/h', K.W - 12, 46, K.accent, 'right');
      /* progress to the finish */
      const bx = K.W / 2 - 80;
      g.fillStyle = 'rgba(6,8,16,.55)'; K.rr(g, bx, 18, 160, 10, 5); g.fill();
      g.fillStyle = K.accent; K.rr(g, bx, 18, Math.max(10, 160 * dist / LEN), 10, 5); g.fill();
      if (banner) K.txt(g, banner.text, K.W / 2, K.H * 0.3, 28, '#fde68a', 'center', 900);
      if (K.state === 'play' && dist < 60) K.txt(g, 'Steer with the arrows, or drag', K.W / 2, K.H * 0.9, 15, 'rgba(255,255,255,.8)', 'center', 700);
    },
    info() {
      return {
        x, lane: Math.round(x), speed, dist, left, lives, cp: cpDone,
        cars: cars.filter(c => c.d - dist > -CAR_LEN && c.d - dist < 120).map(c => ({ lane: c.lane, ahead: c.d - dist })),
      };
    },
  };
}

export default {
  id: 'coast-dash',
  name: 'Coast Dash',
  icon: 'gauge',
  genre: 'racing',
  desc: 'A top-down road race against the clock: weave through traffic, grab the time bonus at each checkpoint and cross the finish line before time runs out.',
  controls: 'Arrows or A/D steer · Down brakes · drag to steer on touch · P pauses',
  season: null,
  colors: ['#0e7490', '#fb923c'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Coast Dash' },
    { k: 'length', label: 'Race length (metres)', type: 'range', min: 500, max: 8000, step: 100, value: 3000 },
    { k: 'time', label: 'Starting time (s)', type: 'range', min: 10, max: 120, step: 1, value: 32 },
    { k: 'checkpointTime', label: 'Checkpoint bonus (s)', type: 'range', min: 0, max: 30, step: 1, value: 10 },
    { k: 'lives', label: 'Lives', type: 'range', min: 1, max: 9, step: 1, value: 3 },
    { k: 'topSpeed', label: 'Top speed (m/s)', type: 'range', min: 40, max: 120, step: 5, value: 80 },
    { k: 'traffic', label: 'Traffic', type: 'range', min: 0, max: 2.5, step: 0.1, value: 1 },
    { k: 'accent', label: 'Car colour', type: 'color', value: '#fb923c' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'ArrowRight', ms: 400, field: 'x', dir: 1, drag: { dx: 170, dy: 0, field: 'x', dir: 1 } },
  game,
  art(g, w, h) {
    const sea = g.createLinearGradient(0, 0, w, 0);
    sea.addColorStop(0, '#0e7490'); sea.addColorStop(0.2, '#22b8cf'); sea.addColorStop(0.32, '#f3d9a4'); sea.addColorStop(0.68, '#f3d9a4'); sea.addColorStop(1, '#4ade80');
    g.fillStyle = sea; g.fillRect(0, 0, w, h);
    g.fillStyle = '#475569'; g.fillRect(w * 0.3, 0, w * 0.4, h);
    g.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 6; i++) { g.fillRect(w * 0.4 - 1, i * 36, 3, 18); g.fillRect(w * 0.5 - 1, i * 36, 3, 18); g.fillRect(w * 0.6 - 1, i * 36, 3, 18); }
    const car = (cx, cy, c) => {
      g.fillStyle = c; g.beginPath(); g.roundRect(cx - 13, cy - 24, 26, 48, 7); g.fill();
      g.fillStyle = 'rgba(15,23,42,.8)'; g.fillRect(cx - 9, cy - 10, 18, 9); g.fillRect(cx - 9, cy + 8, 18, 7);
    };
    car(w * 0.35, 50, '#a855f7'); car(w * 0.55, 30, '#10b981'); car(w * 0.45, 130, '#fb923c');
    g.fillStyle = '#facc15'; g.fillRect(w * 0.3, 78, w * 0.4, 5);
  },
};
