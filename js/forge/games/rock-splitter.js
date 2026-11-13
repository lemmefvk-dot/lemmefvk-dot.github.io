/* Rock Splitter — a Static Forge template (original code and art).
   Fly, turn and shoot in a wrap-around field: big rocks split into
   two middling ones, those into two small ones. Clear the field and
   the next wave brings one more rock. A rare spark gives triple shot.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const LIVES = Math.max(1, Math.round(N(P.lives, 3)));
  const START = Math.max(1, Math.round(N(P.startRocks, 4)));
  const RSPEED = Math.max(10, N(P.rockSpeed, 80));
  const THRUST = Math.max(50, N(P.thrust, 320));
  const RATE = Math.max(1, N(P.fireRate, 6));
  const RADIUS = [0, 14, 27, 46];          /* by size: 1 small, 2 middling, 3 big */
  const POINTS = [0, 100, 50, 20];
  const ROCK_TINTS = [['#a8977f', '#5b4d3d'], ['#94a3b8', '#475263'], ['#b39aab', '#5e4a58']];
  const stars = Array.from({ length: 130 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.6 + 0.3, tw: Math.random() * 6 }));

  let ship, bullets, rocks, sparks, lives, wave, cool, tripleT, respawnT, waveT, banner, flame;
  const sc = () => K.clamp(Math.min(K.W, K.H) / 640, 0.6, 1.3);
  const wrap = (v, m) => ((v % m) + m) % m;

  function newShip() { return { x: K.W / 2, y: K.H / 2, vx: 0, vy: 0, a: -Math.PI / 2, inv: 2.2, alive: true, thrust: 0 }; }
  function makeRock(size, x, y, vx, vy) {
    const n = 9 + K.ri(0, 4);
    return {
      size, x, y, vx, vy, rot: Math.random() * 6.28, spin: K.rnd(-1.2, 1.2),
      shape: Array.from({ length: n }, () => 0.7 + Math.random() * 0.38),
      craters: Array.from({ length: size + 1 }, () => ({ a: Math.random() * 6.28, d: Math.random() * 0.45, r: 0.1 + Math.random() * 0.12 })),
      tint: K.ri(0, ROCK_TINTS.length - 1), hit: 0,
    };
  }
  function spawnWave() {
    const n = START + wave - 1;
    for (let i = 0; i < n; i++) {
      /* from the edges, never on top of the ship */
      const e = K.ri(0, 3);
      const x = e === 0 ? 0 : e === 1 ? K.W : Math.random() * K.W;
      const y = e === 2 ? 0 : e === 3 ? K.H : Math.random() * K.H;
      const a = Math.random() * Math.PI * 2;
      const v = RSPEED * (1 + (wave - 1) * 0.07) * K.rnd(0.6, 1.2);
      rocks.push(makeRock(3, x, y, Math.cos(a) * v, Math.sin(a) * v));
    }
    banner = { text: 'Wave ' + wave, t: 1.6 };
  }
  function shoot() {
    const angles = tripleT > 0 ? [-0.18, 0, 0.18] : [0];
    const nose = 16 * sc();
    for (const d of angles) {
      const a = ship.a + d;
      bullets.push({ x: ship.x + Math.cos(ship.a) * nose, y: ship.y + Math.sin(ship.a) * nose,
        vx: Math.cos(a) * 620 + ship.vx * 0.5, vy: Math.sin(a) * 620 + ship.vy * 0.5, life: 0.95 * Math.max(1, sc()) });
    }
    K.sfx('shoot');
  }
  function split(r, i, bvx, bvy) {
    rocks.splice(i, 1);
    const R = RADIUS[r.size] * sc();
    K.add(POINTS[r.size], r.x, r.y - R * 0.4, r.size === 1 ? '#fde68a' : '#e2e8f0');
    K.burst(r.x, r.y, [ROCK_TINTS[r.tint][0], '#e2e8f0', ROCK_TINTS[r.tint][1]], 8 + r.size * 6, 90 + r.size * 50, { life: 0.7, size: 2 + r.size });
    K.shake(r.size * 2.5);
    K.sfx(r.size === 3 ? 'boom' : r.size === 2 ? 'thud' : 'hit');
    if (r.size > 1) {
      const base = Math.atan2(r.vy + bvy * 0.08, r.vx + bvx * 0.08);
      const v = Math.hypot(r.vx, r.vy) * 1.25 + 20;
      for (const s of [-1, 1]) {
        const a = base + s * K.rnd(0.45, 1.0);
        rocks.push(makeRock(r.size - 1, r.x + Math.cos(a) * R * 0.3, r.y + Math.sin(a) * R * 0.3, Math.cos(a) * v, Math.sin(a) * v));
      }
    } else if (Math.random() < 0.12) {
      sparks.push({ x: r.x, y: r.y, vx: r.vx * 0.3, vy: r.vy * 0.3, life: 8 });
    }
  }
  function die() {
    ship.alive = false;
    lives--;
    K.burst(ship.x, ship.y, [K.accent, '#ffffff', '#fb923c', '#fde68a'], 40, 300, { life: 0.9, size: 3 });
    K.shake(16);
    K.flash('#f87171', 0.3);
    K.sfx('boom');
    K.sfx('hurt');
    respawnT = 1.4;
    if (lives <= 0) K.over('Your ship is space dust');
  }

  /* draw something at every wrap-around copy that can be seen */
  function each(x, y, r, fn) {
    for (const ox of [0, -K.W, K.W]) {
      for (const oy of [0, -K.H, K.H]) {
        const X = x + ox, Y = y + oy;
        if (X + r < 0 || X - r > K.W || Y + r < 0 || Y - r > K.H) continue;
        fn(X, Y);
      }
    }
  }
  function drawRock(g, r, X, Y) {
    const R = RADIUS[r.size] * sc();
    const [light, dark] = ROCK_TINTS[r.tint];
    g.save();
    g.translate(X, Y);
    g.rotate(r.rot);
    g.beginPath();
    r.shape.forEach((k, i) => {
      const a = (i / r.shape.length) * Math.PI * 2;
      const px = Math.cos(a) * R * k, py = Math.sin(a) * R * k;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    });
    g.closePath();
    const gr = g.createRadialGradient(-R * 0.35, -R * 0.35, R * 0.1, 0, 0, R * 1.1);
    gr.addColorStop(0, r.hit > 0 ? '#ffffff' : light);
    gr.addColorStop(1, dark);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,.22)';
    for (const c of r.craters) {
      g.beginPath();
      g.arc(Math.cos(c.a) * R * c.d, Math.sin(c.a) * R * c.d, R * c.r, 0, 7);
      g.fill();
    }
    g.restore();
  }
  function drawShip(g, X, Y, a, s, thrust) {
    g.save();
    g.translate(X, Y);
    g.rotate(a);
    g.scale(s, s);
    if (thrust > 0) {
      const f = 10 + thrust * (10 + Math.random() * 10);
      g.fillStyle = Math.random() < 0.5 ? '#fb923c' : '#fde68a';
      g.beginPath(); g.moveTo(-7, -5); g.lineTo(-7 - f, 0); g.lineTo(-7, 5); g.closePath(); g.fill();
    }
    g.shadowColor = K.accent;
    g.shadowBlur = 14;
    g.beginPath(); g.moveTo(16, 0); g.lineTo(-11, -11); g.lineTo(-6, 0); g.lineTo(-11, 11); g.closePath();
    g.fillStyle = '#0b1022';
    g.fill();
    g.lineWidth = 2.2;
    g.lineJoin = 'round';
    g.strokeStyle = K.accent;
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = K.accent;
    g.beginPath(); g.arc(4, 0, 2.6, 0, 7); g.fill();
    g.restore();
  }

  let lastW = 0, lastH = 0;
  return {
    title: 'Rock Splitter',
    tagline: 'Every rock you hit becomes two smaller ones.',
    controls: ['Left / Right or A D: turn   ·   Up or W: thrust   ·   Space: fire', 'Touch or mouse: press and drag to steer — it fires while held'],
    accent: '#7dd3fc',
    bg: '#03040b',
    resize() {
      /* everything keeps its place relative to the window */
      if (ship && lastW && lastH && (K.W !== lastW || K.H !== lastH)) {
        const kx = K.W / lastW, ky = K.H / lastH;
        for (const o of [ship, ...rocks, ...bullets, ...sparks]) { o.x *= kx; o.y *= ky; }
      }
      lastW = K.W; lastH = K.H;
    },
    reset() {
      lastW = K.W; lastH = K.H;
      ship = newShip();
      bullets = []; rocks = []; sparks = [];
      lives = LIVES; wave = 1; cool = 0; tripleT = 0; respawnT = 0; waveT = 0; flame = 0;
      spawnWave();
    },
    idle(dt) {
      if (K.state !== 'start') return;
      for (const r of rocks) { r.x = wrap(r.x + r.vx * dt, K.W); r.y = wrap(r.y + r.vy * dt, K.H); r.rot += r.spin * dt; }
    },
    update(dt) {
      const s = sc();
      if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      tripleT = Math.max(0, tripleT - dt);
      /* the ship */
      if (!ship.alive) {
        respawnT -= dt;
        if (respawnT <= 0 && lives > 0) ship = newShip();
      } else {
        let thrust = K.held('ArrowUp', 'KeyW') ? 1 : 0;
        let fire = K.held('Space');
        ship.a += K.ax() * 4.4 * dt;
        const st = K.stick(70);
        if (st) {
          fire = true;
          if (st.mag > 0.2) {
            let d = Math.atan2(st.y, st.x) - ship.a;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            ship.a += K.clamp(d, -7 * dt, 7 * dt);
            /* thrust once it roughly faces the way you are dragging */
            thrust = Math.max(thrust, (st.mag - 0.2) / 0.8 * Math.max(0, Math.cos(d)));
          }
        }
        ship.thrust = thrust;
        if (thrust > 0) {
          ship.vx += Math.cos(ship.a) * THRUST * thrust * dt;
          ship.vy += Math.sin(ship.a) * THRUST * thrust * dt;
          if (Math.random() < 0.6) {
            K.burst(ship.x - Math.cos(ship.a) * 10 * s, ship.y - Math.sin(ship.a) * 10 * s, ['#fb923c', '#fde68a'], 1, 60,
              { vx: -Math.cos(ship.a) * 160, vy: -Math.sin(ship.a) * 160, life: 0.35, size: 2.5 });
          }
        }
        const drag = Math.max(0, 1 - 0.45 * dt);
        ship.vx *= drag; ship.vy *= drag;
        const v = Math.hypot(ship.vx, ship.vy);
        if (v > 480) { ship.vx *= 480 / v; ship.vy *= 480 / v; }
        ship.x = wrap(ship.x + ship.vx * dt, K.W);
        ship.y = wrap(ship.y + ship.vy * dt, K.H);
        ship.inv = Math.max(0, ship.inv - dt);
        cool -= dt;
        if (fire && cool <= 0) { shoot(); cool = 1 / RATE; }
      }
      /* bullets */
      for (const b of bullets) { b.x = wrap(b.x + b.vx * dt, K.W); b.y = wrap(b.y + b.vy * dt, K.H); b.life -= dt; }
      bullets = bullets.filter(b => b.life > 0);
      /* rocks */
      for (const r of rocks) { r.x = wrap(r.x + r.vx * dt, K.W); r.y = wrap(r.y + r.vy * dt, K.H); r.rot += r.spin * dt; r.hit = Math.max(0, r.hit - dt); }
      const near = (ax, ay, bx, by) => {
        let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
        dx = Math.min(dx, K.W - dx); dy = Math.min(dy, K.H - dy);
        return Math.hypot(dx, dy);
      };
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        for (let j = rocks.length - 1; j >= 0; j--) {
          const r = rocks[j];
          if (near(b.x, b.y, r.x, r.y) < RADIUS[r.size] * s * 0.95) {
            bullets.splice(i, 1);
            split(r, j, b.vx, b.vy);
            break;
          }
        }
      }
      if (ship.alive && ship.inv <= 0) {
        for (const r of rocks) {
          if (near(ship.x, ship.y, r.x, r.y) < RADIUS[r.size] * s * 0.85 + 9 * s) { die(); break; }
        }
      }
      if (K.state !== 'play') return;
      /* sparks: triple shot */
      for (const sp of sparks) { sp.x = wrap(sp.x + sp.vx * dt, K.W); sp.y = wrap(sp.y + sp.vy * dt, K.H); sp.life -= dt; }
      sparks = sparks.filter(sp => {
        if (ship.alive && near(ship.x, ship.y, sp.x, sp.y) < 24 * s) {
          tripleT = 6;
          K.float(sp.x, sp.y - 20, 'Triple shot!', '#fde047', 16);
          K.burst(sp.x, sp.y, ['#fde047', '#ffffff'], 18, 200, { life: 0.5 });
          K.sfx('power');
          return false;
        }
        return sp.life > 0;
      });
      /* next wave */
      if (!rocks.length) {
        if (waveT <= 0) { waveT = 1.6; K.add(100 * wave, K.W / 2, K.H / 2 - 40, K.accent); K.sfx('win'); }
        waveT -= dt;
        if (waveT <= 0) { wave++; spawnWave(); }
      }
    },
    draw(g) {
      const bg = g.createRadialGradient(K.W * 0.7, K.H * 0.25, 10, K.W * 0.7, K.H * 0.25, Math.max(K.W, K.H) * 0.8);
      bg.addColorStop(0, '#141836');
      bg.addColorStop(0.5, '#080a1c');
      bg.addColorStop(1, '#03040b');
      g.fillStyle = bg;
      g.fillRect(0, 0, K.W, K.H);
      const neb = g.createRadialGradient(K.W * 0.2, K.H * 0.8, 10, K.W * 0.2, K.H * 0.8, Math.max(K.W, K.H) * 0.45);
      neb.addColorStop(0, 'rgba(168,85,247,.12)');
      neb.addColorStop(1, 'rgba(168,85,247,0)');
      g.fillStyle = neb;
      g.fillRect(0, 0, K.W, K.H);
      for (const st of stars) {
        g.globalAlpha = 0.3 + 0.35 * Math.sin(K.t * 1.7 + st.tw);
        g.fillStyle = '#dbeafe';
        g.fillRect(st.x * K.W, st.y * K.H, st.s, st.s);
      }
      g.globalAlpha = 1;
      const s = sc();
      for (const r of rocks) each(r.x, r.y, RADIUS[r.size] * s, (X, Y) => drawRock(g, r, X, Y));
      for (const sp of sparks) {
        if (sp.life < 2 && Math.floor(K.t * 8) % 2) continue;
        each(sp.x, sp.y, 14, (X, Y) => {
          g.save();
          g.translate(X, Y);
          g.rotate(K.t * 3);
          g.shadowColor = '#fde047';
          g.shadowBlur = 16;
          g.fillStyle = '#fde047';
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2, rr = i % 2 ? 4 : 10;
            if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          g.closePath();
          g.fill();
          g.restore();
        });
      }
      g.save();
      g.shadowColor = K.accent;
      g.shadowBlur = 10;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      for (const b of bullets) {
        const m = Math.hypot(b.vx, b.vy) || 1;
        g.globalAlpha = Math.min(1, b.life * 4);
        g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - b.vx / m * 9, b.y - b.vy / m * 9); g.stroke();
      }
      g.restore();
      if (ship.alive && !(ship.inv > 0 && Math.floor(K.t * 10) % 2)) {
        each(ship.x, ship.y, 20 * s, (X, Y) => drawShip(g, X, Y, ship.a, s, K.state === 'play' ? ship.thrust : 0));
      }
      K.fx(g);
      if (K.state === 'play') K.drawStick(g, 70);
      if (banner && K.state === 'play') {
        g.globalAlpha = Math.min(1, banner.t * 2);
        K.txt(g, banner.text, K.W / 2, K.H * 0.32, Math.min(38, K.W / 12), K.accent, 'center', 900);
        g.globalAlpha = 1;
      }
    },
    hud(g) {
      K.pill(g, 'Score ' + K.score, 12, 12, '#fff');
      K.pill(g, 'Wave ' + wave, K.W / 2, 12, K.accent, 'center');
      const n = Math.min(lives, 6);
      const w = 22 + n * 20;
      g.fillStyle = 'rgba(6,8,16,.55)';
      K.rr(g, K.W - 12 - w, 12, w, 28, 14);
      g.fill();
      for (let i = 0; i < n; i++) drawShip(g, K.W - 12 - w + 21 + i * 20, 26, -Math.PI / 2, 0.55, 0);
      if (tripleT > 0) K.pill(g, 'Triple shot ' + Math.ceil(tripleT), 12, 46, '#fde047');
    },
    info() {
      return { x: ship.x, y: ship.y, angle: ship.a, vx: ship.vx, vy: ship.vy, alive: ship.alive, rocks: rocks.length, wave, lives };
    },
  };
}

export default {
  id: 'rock-splitter',
  name: 'Rock Splitter',
  icon: 'star',
  genre: 'shooter',
  desc: 'Steer a little ship through a field of drifting rocks: every hit splits a rock in two. Clear the field to bring on a bigger wave.',
  controls: 'Left/Right or A/D turn, Up or W thrusts, Space fires · touch or mouse: press and drag to steer and fire · P pauses',
  season: null,
  colors: ['#03040b', '#7dd3fc'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Rock Splitter' },
    { k: 'lives', label: 'Lives', type: 'range', min: 1, max: 9, step: 1, value: 3 },
    { k: 'startRocks', label: 'Rocks in the first wave', type: 'range', min: 2, max: 8, step: 1, value: 4 },
    { k: 'rockSpeed', label: 'Rock speed', type: 'range', min: 40, max: 200, step: 5, value: 80 },
    { k: 'thrust', label: 'Engine power', type: 'range', min: 150, max: 600, step: 10, value: 320 },
    { k: 'fireRate', label: 'Shots per second', type: 'range', min: 3, max: 12, step: 1, value: 6 },
    { k: 'accent', label: 'Ship colour', type: 'color', value: '#7dd3fc' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'ArrowLeft', ms: 400, field: 'angle', dir: -1, drag: { dx: 0, dy: -150, field: 'y', dir: -1 } },
  game,
  art(g, w, h) {
    const bg = g.createRadialGradient(w * 0.7, h * 0.3, 5, w * 0.7, h * 0.3, w * 0.8);
    bg.addColorStop(0, '#161a3a'); bg.addColorStop(1, '#03040b');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(219,234,254,' + (0.2 + (i % 5) / 8) + ')'; g.fillRect((i * 97) % w, (i * 57) % h, 1.5, 1.5); }
    const rock = (x, y, r, seed) => {
      g.beginPath();
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2, k = 0.75 + ((seed * (i + 3) * 37) % 25) / 100;
        if (i) g.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k); else g.moveTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
      }
      g.closePath();
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
      gr.addColorStop(0, '#a8977f'); gr.addColorStop(1, '#4b3f33');
      g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.5; g.stroke();
    };
    rock(w * 0.72, h * 0.38, 34, 3); rock(w * 0.86, h * 0.72, 18, 7); rock(w * 0.2, h * 0.25, 14, 5); rock(w * 0.52, h * 0.78, 20, 11);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.shadowColor = '#7dd3fc'; g.shadowBlur = 8;
    for (const [x, y] of [[w * 0.45, h * 0.47], [w * 0.55, h * 0.43]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x - 8, y + 3.5); g.stroke(); }
    g.save(); g.translate(w * 0.3, h * 0.58); g.rotate(-0.38);
    g.fillStyle = '#fb923c'; g.beginPath(); g.moveTo(-8, -5); g.lineTo(-24, 0); g.lineTo(-8, 5); g.fill();
    g.beginPath(); g.moveTo(17, 0); g.lineTo(-11, -12); g.lineTo(-6, 0); g.lineTo(-11, 12); g.closePath();
    g.fillStyle = '#0b1022'; g.fill(); g.strokeStyle = '#7dd3fc'; g.lineWidth = 2.4; g.stroke();
    g.restore();
  },
};
