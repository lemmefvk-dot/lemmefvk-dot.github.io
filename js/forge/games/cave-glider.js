/* Cave Glider — a Static Forge template (original code and art).
   One button: hold to thrust up, let go to fall. The cave wanders,
   narrows and speeds up the deeper you fly; spikes poke in from
   the walls and crystals are worth a detour.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const GRAV = N(P.gravity, 800);
  const THRUST = N(P.thrust, 1300);
  const GAP0 = Math.max(60, N(P.startGap, 300));
  const GAP1 = Math.max(60, Math.min(GAP0, N(P.minGap, 120)));
  const SPEED = Math.max(40, N(P.speed, 230));
  const CAVE = /^#[0-9a-f]{6}$/i.test(P.caveColor || '') ? P.caveColor : '#3b2a5a';
  const SEG = 16;
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'; };
  const ROCK_LO = mix(CAVE, '#000000', 0.55);
  const ROCK_MID = mix(CAVE, '#000000', 0.1);
  const ROCK_HI = mix(CAVE, '#ffffff', 0.12);
  const RIM = mix(CAVE, '#ffffff', 0.55);
  const SPECK = mix(CAVE, '#ffffff', 0.3);
  const FAR = mix(CAVE, '#07040e', 0.68);
  const NEAR = mix(CAVE, '#07040e', 0.45);

  let cols, base, cam, ship, ready, spikes, gems, wander, nextSpike, nextGem, metres, gemCount, thrustWas, dead;
  const motes = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.6 + 0.4, z: Math.random() * 0.5 + 0.15 }));
  const hash = i => { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
  const gx = () => Math.max(60, Math.min(K.W * 0.24, 300));
  const sz = () => K.clamp(Math.min(K.W, K.H) / 520, 0.95, 1.6);   /* the glider grows a little on big screens */

  /* the cave is a list of columns SEG px apart: a wandering centre (-1..1) and a gap */
  const gapAt = i => GAP1 + (GAP0 - GAP1) * Math.exp(-i * SEG / 14000);
  function gen(i) {
    let off = 0;
    if (i > 36) {
      if (Math.abs(wander.off - wander.tgt) < 0.05) wander.tgt = K.rnd(-1, 1);
      const slope = 0.02 + Math.min(0.03, i * SEG / 260000);
      wander.v = K.lerp(wander.v, K.clamp((wander.tgt - wander.off) * 0.3, -slope, slope), 0.12);
      wander.off = K.clamp(wander.off + wander.v, -1, 1);
      off = wander.off;
    }
    const c = { off, gap: gapAt(i) };
    if (i > 70 && i >= nextSpike) {
      const w = K.ri(3, 5);
      spikes.push({ x0: i * SEG, w: w * SEG, side: Math.random() < 0.5 ? -1 : 1, len: K.rnd(0.3, 0.42) });
      nextSpike = i + w + K.ri(Math.max(14, 34 - Math.floor(i / 250)), Math.max(26, 62 - Math.floor(i / 200)));
    } else if (i > 30 && i >= nextGem) {
      gems.push({ x: i * SEG, t: K.rnd(0.28, 0.72), taken: false, ph: Math.random() * 6 });
      nextGem = i + K.ri(18, 42);
    }
    return c;
  }
  function fill() {
    while ((base + cols.length) * SEG < cam + K.W + SEG * 4) cols.push(gen(base + cols.length));
    while (cols.length > 4 && (base + 2) * SEG < cam - SEG * 3) { cols.shift(); base++; }
    spikes = spikes.filter(s => s.x0 + s.w > cam - 40);
    gems = gems.filter(g => g.x > cam - 40);
  }
  /* top and bottom of the cave at a world x, for the window as it is now */
  function caveAt(x, H) {
    H = H || K.H;
    const f = x / SEG - base;
    const i = Math.max(0, Math.min(cols.length - 2, Math.floor(f)));
    const t = K.clamp(f - i, 0, 1);
    const a = cols[i], b = cols[i + 1] || a;
    const gap = Math.max(50, Math.min(K.lerp(a.gap, b.gap, t), H - 70));
    const amp = Math.max(0, (H - gap) / 2 - 16);
    const mid = H / 2 + 8 + K.lerp(a.off, b.off, t) * amp;
    return { top: mid - gap / 2, bot: mid + gap / 2, gap };
  }
  function spikeDepth(s, x, gap) {
    if (x < s.x0 || x > s.x0 + s.w) return 0;
    const mid = s.x0 + s.w / 2;
    return s.len * gap * (1 - Math.abs(x - mid) / (s.w / 2));
  }
  function solid(x, y) {
    const c = caveAt(x);
    if (y < c.top + 1 || y > c.bot - 1) return true;
    for (const s of spikes) {
      const d = spikeDepth(s, x, c.gap);
      if (d > 0 && (s.side < 0 ? y < c.top + d : y > c.bot - d)) return true;
    }
    return false;
  }

  function crash() {
    dead = true;
    const sx = gx();
    K.burst(sx, ship.y, [K.accent, '#fde68a', '#ffffff', '#fb923c'], 46, 340, { life: 0.9, size: 4 });
    K.burst(sx, ship.y, [RIM, SPECK], 18, 180, { life: 1.2, size: 5, grav: 300 });
    K.shake(16);
    K.flash('#ffffff', 0.45);
    K.sfx('boom');
    K.over('Crashed at ' + metres + ' m');
  }

  function attract(dt) {
    cam += 90 * dt;
    fill();
    const c = caveAt(cam + gx());
    ship.bob += dt;
    ship.y = K.lerp(ship.y, (c.top + c.bot) / 2 + Math.sin(ship.bob * 2.4) * 10, Math.min(1, dt * 3));
    ship.a = Math.sin(ship.bob * 2.4 + 1.2) * 0.12;
  }

  let lastH = 0;
  return {
    title: 'Cave Glider',
    tagline: 'One button. One cave. How deep can you go?',
    controls: ['Hold Space, Up, W, the mouse button or a finger to fly up', 'Let go to glide down   ·   P: pause'],
    accent: '#f472b6',
    bg: '#07040e',
    resize() {
      /* keep the glider at the same place across the cave, so a new window size is never a crash */
      if (ship && cols && cols.length > 1 && lastH && K.H !== lastH) {
        const x = cam + gx();
        const was = caveAt(x, lastH), now = caveAt(x, K.H);
        const t = (ship.y - was.top) / Math.max(1, was.bot - was.top);
        ship.y = now.top + t * (now.bot - now.top);
        ship.y0 = ship.y;
        ship.vy *= (now.bot - now.top) / Math.max(1, was.bot - was.top);
      }
      lastH = K.H;
    },
    reset() {
      cols = []; base = 0; cam = 0; spikes = []; gems = [];
      wander = { off: 0, tgt: 0, v: 0 };
      nextSpike = 70; nextGem = 34;
      metres = 0; gemCount = 0; thrustWas = false; dead = false; ready = true;
      lastH = K.H;
      fill();
      const c = caveAt(gx());
      ship = { y: (c.top + c.bot) / 2, y0: (c.top + c.bot) / 2, vy: 0, a: 0, bob: 0 };
    },
    idle(dt) { if (K.state === 'start') attract(dt); },
    update(dt) {
      if (dead) return;
      const thr = K.held('Space', 'ArrowUp', 'KeyW') || !!K.primary();
      if (ready) {
        /* hover until the first press, so nobody crashes while reading */
        ship.bob += dt;
        const c = caveAt(cam + gx());
        ship.y0 = K.lerp(ship.y0, (c.top + c.bot) / 2, Math.min(1, dt * 4));
        ship.y = ship.y0 + Math.sin(ship.bob * 3) * 6;
        ship.a = 0;
        if (!thr) return;
        ready = false;
        K.sfx('jump');
      }
      if (thr && !thrustWas) ship.vy = Math.min(ship.vy * 0.3, -90);   /* a press always answers at once */
      thrustWas = thr;
      const spd = SPEED * (1 + Math.min(0.6, cam / 40000));
      cam += spd * dt;
      ship.vy = K.clamp(ship.vy + (GRAV - (thr ? THRUST : 0)) * dt, -520, 640);
      ship.y += ship.vy * dt;
      ship.a = Math.atan2(ship.vy, spd) * 0.8;
      fill();
      const sx = gx();
      const ca = Math.cos(ship.a), sa = Math.sin(ship.a);
      if (thr) K.burst(sx - 11 * ca, ship.y - 11 * sa, [K.accent, '#fde68a', '#fb923c'], 2, 70, { vx: -spd * 0.9, life: 0.35, size: 3, drag: 1 });
      else if (Math.random() < 0.3) K.burst(sx - 11 * ca, ship.y - 11 * sa, ['rgba(255,255,255,.5)'], 1, 20, { vx: -spd * 0.9, life: 0.3, size: 2 });
      const m = Math.floor(cam / 10);
      if (m > metres) {
        if (Math.floor(m / 100) > Math.floor(metres / 100)) { K.float(sx + 40, ship.y - 30, m + ' m', '#e0e7ff', 15); K.sfx('blip'); }
        K.add(m - metres);
        metres = m;
      }
      /* crystals */
      const wx = cam + sx;
      for (const gm of gems) {
        if (gm.taken) continue;
        const c = caveAt(gm.x);
        const gy = c.top + gm.t * (c.bot - c.top);
        if (Math.abs(gm.x - wx) < 20 && Math.abs(gy - ship.y) < 20) {
          gm.taken = true;
          gemCount++;
          K.add(25, sx, gy - 14, '#67e8f9');
          K.burst(sx, gy, ['#67e8f9', '#ffffff', '#a5f3fc'], 16, 200, { life: 0.5, vx: -spd * 0.5 });
          K.sfx('coin');
        }
      }
      /* the nose, the tail and the belly/back must all stay in the open */
      const k = sz() / 1.2;
      const pts = [[17 * k, 0], [-12 * k, -9 * k], [-12 * k, 9 * k], [0, -6 * k], [0, 6 * k]];
      for (const [px, py] of pts) {
        if (solid(wx + px * ca - py * sa, ship.y + px * sa + py * ca)) { crash(); return; }
      }
    },
    down() { /* the held finger is read in update() */ },
    draw(g) {
      const bg = g.createLinearGradient(0, 0, 0, K.H);
      bg.addColorStop(0, '#0d0719');
      bg.addColorStop(0.5, '#120a24');
      bg.addColorStop(1, '#07040e');
      g.fillStyle = bg;
      g.fillRect(0, 0, K.W, K.H);
      /* distant stalactites and stalagmites (decoration, slower than the cave) */
      for (const [k, col, len, step] of [[0.22, FAR, 0.36, 30], [0.5, NEAR, 0.27, 44]]) {
        g.fillStyle = col;
        const off = cam * k;
        const i0 = Math.floor(off / step) - 1;
        g.beginPath();
        for (let i = i0; i < i0 + K.W / step + 3; i++) {
          const h = hash(i * 7 + Math.round(k * 100));
          const x = i * step - off;
          const w = step * (0.8 + ((h >>> 16) % 50) / 50);
          const l1 = K.H * len * (0.3 + (h % 100) / 140);
          const l2 = K.H * len * (0.3 + ((h >>> 8) % 100) / 140);
          g.moveTo(x - w / 2, -2); g.lineTo(x + w / 2, -2); g.lineTo(x + (h % 9) - 4, l1); g.closePath();
          const xb = x + step / 2;
          g.moveTo(xb - w / 2, K.H + 2); g.lineTo(xb + w / 2, K.H + 2); g.lineTo(xb + ((h >>> 4) % 9) - 4, K.H - l2); g.closePath();
        }
        g.fill();
      }
      for (const m of motes) {
        const x = ((m.x * K.W - cam * m.z) % K.W + K.W) % K.W;
        g.globalAlpha = 0.25 + 0.2 * Math.sin(K.t * 2 + m.y * 30);
        g.fillStyle = '#e9d5ff';
        g.fillRect(x, m.y * K.H, m.s, m.s);
      }
      g.globalAlpha = 1;
      /* the cave walls */
      const first = Math.floor(cam / SEG) - 1;
      const last = Math.ceil((cam + K.W) / SEG) + 1;
      const tops = [], bots = [];
      for (let i = first; i <= last; i++) {
        const c = caveAt(i * SEG);
        tops.push([i * SEG - cam, c.top, i]);
        bots.push([i * SEG - cam, c.bot, i]);
      }
      for (const [edge, side] of [[tops, -1], [bots, 1]]) {
        const deep = side < 0 ? Math.max(...edge.map(e => e[1])) : Math.min(...edge.map(e => e[1]));
        const gr = g.createLinearGradient(0, side < 0 ? 0 : K.H, 0, deep);
        gr.addColorStop(0, ROCK_LO);
        gr.addColorStop(0.75, ROCK_MID);
        gr.addColorStop(1, ROCK_HI);
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(edge[0][0], side < 0 ? -10 : K.H + 10);
        for (const [x, y] of edge) g.lineTo(x, y);
        g.lineTo(edge[edge.length - 1][0], side < 0 ? -10 : K.H + 10);
        g.closePath();
        g.fill();
        /* speckles fixed to the rock, so it reads as moving stone */
        g.fillStyle = SPECK;
        for (const [x, y, i] of edge) {
          const h = hash(i * 2 + (side < 0 ? 0 : 1));
          if (h % 3) continue;
          const d = 10 + (h >>> 4) % 60;
          g.globalAlpha = 0.25 + ((h >>> 9) % 50) / 100;
          g.fillRect(x + (h >>> 12) % SEG, y - side * d, 2 + (h >>> 20) % 3, 2);
        }
        g.globalAlpha = 1;
        /* a soft bevel just inside the rock, then the lit rim */
        g.save();
        g.globalAlpha = 0.18;
        g.strokeStyle = RIM;
        g.lineWidth = 10;
        g.lineJoin = 'round';
        g.beginPath();
        edge.forEach(([x, y], n) => (n ? g.lineTo(x, y - side * 6) : g.moveTo(x, y - side * 6)));
        g.stroke();
        g.restore();
        g.save();
        g.shadowColor = RIM;
        g.shadowBlur = 10;
        g.strokeStyle = RIM;
        g.lineWidth = 2.5;
        g.lineJoin = 'round';
        g.beginPath();
        edge.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
        g.restore();
      }
      /* spikes */
      for (const s of spikes) {
        const x0 = s.x0 - cam, x1 = x0 + s.w, xm = x0 + s.w / 2;
        if (x1 < -20 || x0 > K.W + 20) continue;
        const a = caveAt(s.x0), b = caveAt(s.x0 + s.w), m = caveAt(s.x0 + s.w / 2);
        const d = s.len * m.gap;
        g.beginPath();
        if (s.side < 0) { g.moveTo(x0, a.top - 2); g.lineTo(xm, m.top + d); g.lineTo(x1, b.top - 2); }
        else { g.moveTo(x0, a.bot + 2); g.lineTo(xm, m.bot - d); g.lineTo(x1, b.bot + 2); }
        g.closePath();
        g.fillStyle = ROCK_MID;
        g.fill();
        g.save();
        g.shadowColor = '#fb7185';
        g.shadowBlur = 8;
        g.strokeStyle = RIM;
        g.lineWidth = 2;
        g.stroke();
        g.restore();
      }
      /* crystals */
      for (const gm of gems) {
        if (gm.taken) continue;
        const x = gm.x - cam;
        if (x < -20 || x > K.W + 20) continue;
        const c = caveAt(gm.x);
        const y = c.top + gm.t * (c.bot - c.top);
        const s = 8 + Math.sin(K.t * 5 + gm.ph) * 1.5;
        g.save();
        g.shadowColor = '#67e8f9';
        g.shadowBlur = 16;
        g.fillStyle = '#22d3ee';
        g.beginPath(); g.moveTo(x, y - s * 1.3); g.lineTo(x + s, y); g.lineTo(x, y + s * 1.3); g.lineTo(x - s, y); g.closePath(); g.fill();
        g.shadowBlur = 0;
        g.fillStyle = '#ecfeff';
        g.beginPath(); g.moveTo(x, y - s * 1.3); g.lineTo(x + s * 0.4, y); g.lineTo(x, y + s * 0.3); g.lineTo(x - s * 0.5, y - s * 0.1); g.closePath(); g.fill();
        g.restore();
      }
      /* the glider */
      if (!dead) {
        g.save();
        g.translate(gx(), ship.y);
        g.rotate(ship.a);
        g.shadowColor = K.accent;
        g.shadowBlur = 18;
        g.fillStyle = K.accent;
        g.scale(sz(), sz());
        g.beginPath(); g.moveTo(15, 0); g.lineTo(-11, -10); g.lineTo(-5, 0); g.lineTo(-11, 10); g.closePath(); g.fill();
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.beginPath(); g.moveTo(13, 0); g.lineTo(-3, -4); g.lineTo(-1, 0); g.closePath(); g.fill();
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.beginPath(); g.moveTo(15, 0); g.lineTo(-5, 0); g.lineTo(-11, 10); g.closePath(); g.fill();
        g.restore();
      }
      K.fx(g);
      if (K.state === 'play' && ready) {
        g.globalAlpha = 0.6 + 0.4 * Math.sin(K.t * 5);
        K.txt(g, K.touch ? 'Hold your finger down to fly' : 'Hold Space to fly', gx() + 20, ship.y + 46, 15, '#fce7f3', 'left', 700);
        g.globalAlpha = 1;
      }
    },
    hud(g) {
      const w = K.pill(g, metres + ' m', 12, 12, '#fff');
      K.pill(g, '◆ ' + gemCount, 18 + w, 12, '#67e8f9');
      K.pill(g, 'Score ' + K.score, K.W - 12, 12, K.accent, 'right');
    },
    info() { const c = caveAt(cam + gx()); return { y: ship.y, vy: ship.vy, top: c.top, bot: c.bot, metres, crystals: gemCount, ready, dead }; },
  };
}

export default {
  id: 'cave-glider',
  name: 'Cave Glider',
  icon: 'wind',
  genre: 'one button',
  desc: 'A one-button flyer: hold to climb, let go to dive through a cave that keeps getting narrower and faster. Grab crystals on the way.',
  controls: 'Hold Space, Up, W, the mouse button or a finger to fly up; let go to glide down · P pauses',
  season: null,
  colors: ['#07040e', '#f472b6'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Cave Glider' },
    { k: 'gravity', label: 'Gravity', type: 'range', min: 400, max: 1400, step: 20, value: 800 },
    { k: 'thrust', label: 'Thrust', type: 'range', min: 600, max: 2000, step: 20, value: 1300 },
    { k: 'startGap', label: 'Cave height at the start', type: 'range', min: 160, max: 420, step: 10, value: 300 },
    { k: 'minGap', label: 'Narrowest cave', type: 'range', min: 90, max: 260, step: 10, value: 120 },
    { k: 'speed', label: 'Flying speed', type: 'range', min: 150, max: 450, step: 10, value: 230 },
    { k: 'accent', label: 'Glider colour', type: 'color', value: '#f472b6' },
    { k: 'caveColor', label: 'Rock colour', type: 'color', value: '#3b2a5a' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'Space', ms: 400, field: 'y', dir: -1 },
  game,
  art(g, w, h) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#120a24'); bg.addColorStop(1, '#07040e');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const top = x => 34 + Math.sin(x * 0.03) * 14 + Math.sin(x * 0.011 + 1) * 10;
    const bot = x => h - 34 + Math.sin(x * 0.025 + 2) * 14 + Math.sin(x * 0.013) * 8;
    for (const [f, s] of [[top, -1], [bot, 1]]) {
      g.fillStyle = '#2a1d42';
      g.beginPath(); g.moveTo(0, s < 0 ? 0 : h);
      for (let x = 0; x <= w; x += 8) g.lineTo(x, f(x));
      g.lineTo(w, s < 0 ? 0 : h); g.closePath(); g.fill();
      g.shadowColor = '#c4b5fd'; g.shadowBlur = 8; g.strokeStyle = '#a78bfa'; g.lineWidth = 2;
      g.beginPath(); for (let x = 0; x <= w; x += 8) (x ? g.lineTo(x, f(x)) : g.moveTo(x, f(x))); g.stroke();
      g.shadowBlur = 0;
    }
    g.fillStyle = '#2a1d42';
    g.beginPath(); g.moveTo(w * 0.62, top(w * 0.62) - 4); g.lineTo(w * 0.67, top(w * 0.67) + 44); g.lineTo(w * 0.72, top(w * 0.72) - 4); g.fill();
    g.shadowColor = '#67e8f9'; g.shadowBlur = 12; g.fillStyle = '#22d3ee';
    for (const [x, y] of [[w * 0.5, h * 0.42], [w * 0.82, h * 0.6]]) {
      g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 7, y); g.lineTo(x, y + 9); g.lineTo(x - 7, y); g.fill();
    }
    g.globalAlpha = 0.7;
    for (let i = 1; i < 14; i++) {
      g.fillStyle = i % 2 ? '#fb923c' : '#fde68a';
      g.fillRect(w * 0.3 - i * 7, h * 0.55 + i * 1.6 + Math.sin(i) * 2, 3, 3);
    }
    g.globalAlpha = 1;
    g.save(); g.translate(w * 0.3, h * 0.55); g.rotate(-0.2);
    g.shadowColor = '#f472b6'; g.shadowBlur = 16; g.fillStyle = '#f472b6';
    g.beginPath(); g.moveTo(16, 0); g.lineTo(-12, -11); g.lineTo(-5, 0); g.lineTo(-12, 11); g.closePath(); g.fill();
    g.restore();
  },
};
