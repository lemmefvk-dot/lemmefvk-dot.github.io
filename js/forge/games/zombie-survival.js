/* Zombie Survival — a Static Forge template (original code and art).
   A moonlit graveyard, a flashlight and waves of cartoon zombies:
   walkers, then runners, then brutes. Gravestones block feet and
   bullets. Pickups: hearts, rapid fire, spread shot.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const VW = 800, VH = 500;
  const HEARTS = K.clamp(Math.round(N(P.hearts, 5)), 1, 20);
  const ZSPEED = Math.max(10, N(P.zombieSpeed, 55));
  const WAVE1 = Math.max(1, Math.round(N(P.waveSize, 6)));
  const FIRE = K.clamp(N(P.fireRate, 7), 0.5, 30);
  const PSPEED = Math.max(40, N(P.playerSpeed, 190));
  const RANGE = 380;
  const TYPES = {
    walker: { r: 15, hp: 2, sp: 1, pts: 10, body: '#65a30d', dark: '#3f6212' },
    runner: { r: 12, hp: 1, sp: 1.85, pts: 15, body: '#a3e635', dark: '#4d7c0f' },
    brute: { r: 25, hp: 9, sp: 0.62, pts: 60, body: '#4d7c0f', dark: '#1a2e05' },
  };
  const GOO = ['#84cc16', '#a3e635', '#4d7c0f', '#bef264'];
  const PICK = {
    heart: { color: '#fb7185', label: '♥', name: '+1 heart' },
    rapid: { color: '#facc15', label: 'R', name: 'Rapid fire' },
    spread: { color: '#38bdf8', label: 'S', name: 'Spread shot' },
  };

  let F = { s: 1, ox: 0, oy: 0 };
  let pl, zs, bullets, drops, stones, wave, toSpawn, spawnT, breakT, banner, fireT, rapidT, spreadT, kills, muzzle, ground = null;
  const dark = document.createElement('canvas');
  dark.width = VW / 2; dark.height = VH / 2;
  const dg = dark.getContext('2d');

  const toWorld = (x, y) => ({ x: (x - F.ox) / F.s, y: (y - F.oy) / F.s });

  /* ---------- the graveyard ---------- */
  function makeStones() {
    const out = [];
    for (let tries = 0; out.length < 7 && tries < 400; tries++) {
      const big = out.length === 0;
      const w = big ? 70 : K.ri(28, 38), h = big ? 52 : K.ri(22, 30);
      const x = K.rnd(56, VW - 56 - w), y = K.rnd(50, VH - 50 - h);
      if (K.dist(x + w / 2, y + h / 2, VW / 2, VH / 2) < 150) continue;
      if (out.some(s => x < s.x + s.w + 50 && x + w + 50 > s.x && y < s.y + s.h + 50 && y + h + 50 > s.y)) continue;
      out.push({ x, y, w, h, big, tilt: K.rnd(-0.08, 0.08) });
    }
    return out;
  }
  function paintGround() {
    ground = document.createElement('canvas');
    ground.width = VW; ground.height = VH;
    const c = ground.getContext('2d');
    const gr = c.createRadialGradient(VW * 0.75, VH * 0.2, 40, VW * 0.5, VH * 0.5, VW * 0.75);
    gr.addColorStop(0, '#2c4a3c'); gr.addColorStop(1, '#14231b');
    c.fillStyle = gr;
    c.fillRect(0, 0, VW, VH);
    /* a winding dirt path */
    c.strokeStyle = 'rgba(120,98,70,.35)';
    c.lineWidth = 46;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(-20, VH * 0.7);
    c.bezierCurveTo(VW * 0.3, VH * 0.45, VW * 0.55, VH * 0.85, VW + 20, VH * 0.35);
    c.stroke();
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * VW, y = Math.random() * VH;
      c.fillStyle = Math.random() < 0.5 ? 'rgba(74,124,89,.35)' : 'rgba(10,20,14,.35)';
      c.beginPath(); c.ellipse(x, y, K.rnd(2, 9), K.rnd(1, 5), Math.random() * 3, 0, 7); c.fill();
    }
    c.strokeStyle = 'rgba(110,170,120,.35)';
    c.lineWidth = 1.2;
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * VW, y = Math.random() * VH;
      c.beginPath();
      for (let j = -1; j <= 1; j++) { c.moveTo(x, y); c.lineTo(x + j * 3, y - K.rnd(4, 8)); }
      c.stroke();
    }
  }

  /* keeps a circle out of the gravestones; returns the push direction of the last hit, or null */
  function pushOut(o) {
    let hit = null;
    for (const s of stones) {
      const cx = K.clamp(o.x, s.x, s.x + s.w), cy = K.clamp(o.y, s.y, s.y + s.h);
      const dx = o.x - cx, dy = o.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= o.r * o.r) continue;
      if (d2 > 1e-4) { const d = Math.sqrt(d2); o.x = cx + dx / d * o.r; o.y = cy + dy / d * o.r; hit = { nx: dx / d, ny: dy / d }; }
      else {
        const l = o.x - s.x, r = s.x + s.w - o.x, t = o.y - s.y, b = s.y + s.h - o.y;
        const m = Math.min(l, r, t, b);
        if (m === l) { o.x = s.x - o.r; hit = { nx: -1, ny: 0 }; } else if (m === r) { o.x = s.x + s.w + o.r; hit = { nx: 1, ny: 0 }; }
        else if (m === t) { o.y = s.y - o.r; hit = { nx: 0, ny: -1 }; } else { o.y = s.y + s.h + o.r; hit = { nx: 0, ny: 1 }; }
      }
    }
    return hit;
  }
  const inStone = (x, y) => stones.some(s => x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h);

  /* ---------- waves ---------- */
  function startWave(n) {
    wave = n;
    toSpawn = Math.round(WAVE1 + (n - 1) * 3 + (n - 1) * (n - 1) * 0.25);
    spawnT = 1.4;
    banner = { text: 'Wave ' + n, sub: n === 1 ? 'Survive the night' : n === 3 ? 'Runners are coming' : n === 5 ? 'Brutes are coming' : 'They keep coming', t: 2.2 };
  }
  function spawnZombie() {
    const roll = Math.random();
    let type = 'walker';
    if (wave >= 5 && roll < Math.min(0.28, 0.1 + (wave - 5) * 0.03)) type = 'brute';
    else if (wave >= 3 && roll < Math.min(0.5, 0.25 + (wave - 3) * 0.05)) type = 'runner';
    const T = TYPES[type];
    let best = null;
    for (let i = 0; i < 6; i++) {
      const side = K.ri(0, 3);
      const p = side === 0 ? { x: K.rnd(0, VW), y: -30 } : side === 1 ? { x: VW + 30, y: K.rnd(0, VH) } : side === 2 ? { x: K.rnd(0, VW), y: VH + 30 } : { x: -30, y: K.rnd(0, VH) };
      const d = K.dist(p.x, p.y, pl.x, pl.y);
      if (!best || d > best.d) best = { ...p, d };
      if (d > 300) break;
    }
    zs.push({ type, x: best.x, y: best.y, r: T.r, hp: T.hp, max: T.hp, sp: ZSPEED * T.sp * K.rnd(0.85, 1.15) * (1 + Math.min(0.8, (wave - 1) * 0.05)),
      a: 0, ph: K.rnd(0, 6.28), flash: 0, inside: false, kx: 0, ky: 0 });
  }
  /* no gravestone on the straight line from the player to (x, y) */
  function sight(x, y) {
    const d = K.dist(pl.x, pl.y, x, y), n = Math.ceil(d / 10);
    for (let i = 1; i < n; i++) if (inStone(pl.x + (x - pl.x) * i / n, pl.y + (y - pl.y) * i / n)) return false;
    return true;
  }
  /* the closest zombie the gun can see (else the closest one at all) */
  function nearest(maxD) {
    let best = null, bd = maxD, seen = false;
    for (const z of zs) {
      if (!z.inside) continue;
      const d = K.dist(z.x, z.y, pl.x, pl.y);
      if (d > maxD) continue;
      const v = sight(z.x, z.y);
      if ((v && !seen) || (v === seen && d < bd)) { bd = d; best = z; seen = v; }
    }
    return best;
  }

  function fire(a) {
    fireT = 1 / (FIRE * (rapidT > 0 ? 2 : 1));
    const spread = spreadT > 0 ? [-0.2, 0, 0.2] : [0];
    for (const da of spread) {
      const b = a + da + K.rnd(-0.03, 0.03);
      bullets.push({ x: pl.x + Math.cos(a) * 20, y: pl.y + Math.sin(a) * 20, vx: Math.cos(b) * 780, vy: Math.sin(b) * 780, life: 0.8 });
    }
    muzzle = 0.06;
    pl.face = a;
    K.sfx('shoot');
  }

  function kill(z) {
    const T = TYPES[z.type];
    zs.splice(zs.indexOf(z), 1);
    kills++;
    K.add(T.pts * (1 + Math.floor((wave - 1) / 3)), z.x, z.y - 22, '#d9f99d');
    K.burst(z.x, z.y, GOO, z.type === 'brute' ? 36 : 18, z.type === 'brute' ? 260 : 190, { life: 0.6, size: 4 });
    K.sfx('thud');
    if (z.type === 'brute') K.shake(6);
    const chance = z.type === 'brute' ? 0.55 : 0.08;
    if (Math.random() < chance) {
      const bag = pl.hp < HEARTS ? ['heart', 'heart', 'rapid', 'spread'] : ['rapid', 'spread'];
      drops.push({ kind: K.pick(bag), x: K.clamp(z.x, 20, VW - 20), y: K.clamp(z.y, 20, VH - 20), t: 9 });
    }
  }

  function hurt(z) {
    pl.hp--;
    pl.inv = 1.1;
    const d = K.dist(z.x, z.y, pl.x, pl.y) || 1;
    pl.kx = (pl.x - z.x) / d * 420;
    pl.ky = (pl.y - z.y) / d * 420;
    z.kx = -pl.kx * 0.5; z.ky = -pl.ky * 0.5;
    K.shake(12);
    K.flash('#ef4444', 0.3);
    K.sfx('hurt');
    if (pl.hp <= 0) {
      K.burst(pl.x, pl.y, [K.accent, '#fff'], 30, 260, { life: 0.8 });
      K.over('Overrun on wave ' + wave);
    }
  }

  /* ---------- drawing ---------- */
  function drawStone(g, s) {
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(s.x + s.w / 2 + 6, s.y + s.h / 2 + 8, s.w * 0.6, s.h * 0.55, 0, 0, 7); g.fill();
    g.save();
    g.translate(s.x + s.w / 2, s.y + s.h / 2);
    g.rotate(s.tilt);
    const gr = g.createLinearGradient(0, -s.h / 2, 0, s.h / 2);
    gr.addColorStop(0, '#9ca3af'); gr.addColorStop(1, '#4b5563');
    g.fillStyle = gr;
    K.rr(g, -s.w / 2, -s.h / 2, s.w, s.h, s.big ? 8 : 10);
    g.fill();
    g.strokeStyle = 'rgba(17,24,39,.55)';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = 'rgba(31,41,55,.6)';
    if (s.big) { g.fillRect(-4, -s.h / 2 + 8, 8, s.h - 16); g.fillRect(-s.w / 2 + 14, -6, s.w - 28, 8); }
    else { g.font = '700 9px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RIP', 0, 1); }
    g.fillStyle = 'rgba(132,204,22,.35)';
    g.beginPath(); g.arc(-s.w / 2 + 5, s.h / 2 - 4, 5, 0, 7); g.fill();
    g.restore();
  }
  function drawZombie(g, z) {
    const T = TYPES[z.type];
    const wob = Math.sin(K.t * 6 + z.ph) * 0.18;
    g.fillStyle = 'rgba(0,0,0,.3)';
    g.beginPath(); g.ellipse(z.x + 3, z.y + 5, z.r * 1.05, z.r * 0.8, 0, 0, 7); g.fill();
    g.save();
    g.translate(z.x, z.y);
    g.rotate(z.a);
    /* arms reaching forward */
    g.fillStyle = T.dark;
    K.rr(g, z.r * 0.2, -z.r * 0.95 + wob * z.r, z.r * 1.25, z.r * 0.42, z.r * 0.2); g.fill();
    K.rr(g, z.r * 0.2, z.r * 0.53 - wob * z.r, z.r * 1.25, z.r * 0.42, z.r * 0.2); g.fill();
    g.fillStyle = z.flash > 0 ? '#f7fee7' : T.body;
    g.beginPath(); g.ellipse(0, 0, z.r * 0.85, z.r, 0, 0, 7); g.fill();
    g.strokeStyle = T.dark; g.lineWidth = 2; g.stroke();
    g.fillStyle = z.flash > 0 ? '#ffffff' : T.dark;
    g.beginPath(); g.arc(z.r * 0.15, 0, z.r * 0.55, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.arc(-z.r * 0.3, z.r * 0.35, z.r * 0.18, 0, 7); g.fill();
    g.restore();
  }
  function drawEyes(g, z) {
    const ex = z.x + Math.cos(z.a) * z.r * 0.45, ey = z.y + Math.sin(z.a) * z.r * 0.45;
    const px = -Math.sin(z.a) * z.r * 0.25, py = Math.cos(z.a) * z.r * 0.25;
    g.fillStyle = z.type === 'brute' ? '#f87171' : '#fde047';
    g.beginPath(); g.arc(ex + px, ey + py, z.r * 0.12 + 0.8, 0, 7); g.arc(ex - px, ey - py, z.r * 0.12 + 0.8, 0, 7); g.fill();
  }
  function drawPlayer(g) {
    if (pl.inv > 0 && Math.floor(pl.inv * 12) % 2) return;
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(pl.x + 3, pl.y + 5, 15, 12, 0, 0, 7); g.fill();
    g.save();
    g.translate(pl.x, pl.y);
    g.rotate(pl.face);
    g.fillStyle = '#1f2937';
    g.fillRect(6, -3, 22, 6);
    if (muzzle > 0) {
      g.fillStyle = '#fde68a';
      g.beginPath(); g.moveTo(28, 0); g.lineTo(42, -7); g.lineTo(38, 0); g.lineTo(42, 7); g.closePath(); g.fill();
    }
    g.fillStyle = K.accent;
    g.beginPath(); g.ellipse(0, 0, 11, 15, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#fcd9b6';
    g.beginPath(); g.arc(2, 0, 8, 0, 7); g.fill();
    g.fillStyle = '#7c2d12';
    g.beginPath(); g.arc(-1, 0, 7, Math.PI * 0.5, Math.PI * 1.5); g.fill();
    g.restore();
  }
  function drawDrop(g, d) {
    if (d.t < 2 && Math.floor(d.t * 8) % 2) return;
    const pk = PICK[d.kind];
    const y = d.y + Math.sin(K.t * 4 + d.x) * 3;
    g.save();
    g.shadowColor = pk.color; g.shadowBlur = 16;
    g.fillStyle = pk.color;
    g.beginPath(); g.arc(d.x, y, 11, 0, 7); g.fill();
    g.restore();
    K.txt(g, pk.label, d.x, y + 1, 13, '#111827', 'center', 900);
  }
  function lighting() {
    dg.setTransform(1, 0, 0, 1, 0, 0);
    dg.globalCompositeOperation = 'source-over';
    dg.clearRect(0, 0, dark.width, dark.height);
    dg.fillStyle = 'rgba(2,6,18,.74)';
    dg.fillRect(0, 0, dark.width, dark.height);
    dg.globalCompositeOperation = 'destination-out';
    dg.setTransform(0.5, 0, 0, 0.5, 0, 0);
    const lamp = dg.createRadialGradient(pl.x, pl.y, 10, pl.x, pl.y, muzzle > 0 ? 170 : 115);
    lamp.addColorStop(0, 'rgba(0,0,0,.95)'); lamp.addColorStop(1, 'rgba(0,0,0,0)');
    dg.fillStyle = lamp;
    dg.fillRect(pl.x - 200, pl.y - 200, 400, 400);
    const cone = dg.createRadialGradient(pl.x, pl.y, 20, pl.x, pl.y, RANGE + 20);
    cone.addColorStop(0, 'rgba(0,0,0,.95)'); cone.addColorStop(0.7, 'rgba(0,0,0,.6)'); cone.addColorStop(1, 'rgba(0,0,0,0)');
    dg.fillStyle = cone;
    dg.beginPath();
    dg.moveTo(pl.x, pl.y);
    dg.arc(pl.x, pl.y, RANGE + 20, pl.face - 0.45, pl.face + 0.45);
    dg.closePath();
    dg.fill();
    for (const d of drops) {
      const gl = dg.createRadialGradient(d.x, d.y, 2, d.x, d.y, 40);
      gl.addColorStop(0, 'rgba(0,0,0,.8)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      dg.fillStyle = gl;
      dg.fillRect(d.x - 40, d.y - 40, 80, 80);
    }
    /* the moon over the top-right corner */
    const moon = dg.createRadialGradient(VW * 0.85, VH * 0.08, 10, VW * 0.85, VH * 0.08, 360);
    moon.addColorStop(0, 'rgba(0,0,0,.45)'); moon.addColorStop(1, 'rgba(0,0,0,0)');
    dg.fillStyle = moon;
    dg.fillRect(0, 0, VW, VH);
  }

  return {
    title: 'Zombie Survival',
    tagline: 'Hold the graveyard until sunrise. It never comes.',
    controls: ['WASD / arrows: move  ·  aim with the mouse, click or Space: fire', 'Touch: drag to move, the gun fires itself  ·  P: pause'],
    accent: '#a3e635',
    bg: '#050806',
    resize() { F = K.fit(VW, VH); },
    reset() {
      F = K.fit(VW, VH);
      if (!ground) paintGround();
      stones = makeStones();
      pl = { x: VW / 2, y: VH / 2, r: 13, hp: HEARTS, inv: 0, kx: 0, ky: 0, face: -Math.PI / 2 };
      zs = []; bullets = []; drops = [];
      fireT = 0; rapidT = 0; spreadT = 0; kills = 0; muzzle = 0; breakT = 0;
      startWave(1);
    },
    idle(dt) {
      if (banner && K.state === 'over') banner = null;
      pl.inv = Math.max(0, pl.inv - dt);
    },
    update(dt) {
      F = K.fit(VW, VH);
      /* --- the player --- */
      let mx = K.ax(), my = K.ay();
      let mousePtr = null, touchPtr = null;
      for (const p of K.ptrs.values()) {
        if (p.used) continue;
        if (p.type === 'mouse') mousePtr = p; else if (!touchPtr) touchPtr = p;
      }
      if (touchPtr) {
        let dx = touchPtr.x - touchPtr.x0, dy = touchPtr.y - touchPtr.y0;
        const m = Math.hypot(dx, dy), R = 60;
        if (m > R) { touchPtr.x0 = touchPtr.x - dx / m * R; touchPtr.y0 = touchPtr.y - dy / m * R; dx = dx / m * R; dy = dy / m * R; }
        if (m > 6) { mx = dx / R; my = dy / R; }
      }
      const ml = Math.hypot(mx, my);
      if (ml > 1) { mx /= ml; my /= ml; }
      pl.x += (mx * PSPEED + pl.kx) * dt;
      pl.y += (my * PSPEED + pl.ky) * dt;
      pl.kx *= Math.pow(0.002, dt); pl.ky *= Math.pow(0.002, dt);
      pushOut(pl);
      pl.x = K.clamp(pl.x, pl.r, VW - pl.r);
      pl.y = K.clamp(pl.y, pl.r, VH - pl.r);
      pl.inv = Math.max(0, pl.inv - dt);
      /* --- aiming and firing --- */
      const mouseRecent = K.mouse && K.t - K.mouse.t < 2.5;
      let aim = null;
      if (mousePtr) { const w = toWorld(mousePtr.x, mousePtr.y); aim = Math.atan2(w.y - pl.y, w.x - pl.x); }
      else if (K.held('Space', 'Enter')) {
        if (mouseRecent) { const w = toWorld(K.mouse.x, K.mouse.y); aim = Math.atan2(w.y - pl.y, w.x - pl.x); }
        else { const z = nearest(9999); aim = z ? Math.atan2(z.y - pl.y, z.x - pl.x) : pl.face; }
      } else if (K.touch) {
        const z = nearest(RANGE);
        if (z) aim = Math.atan2(z.y - pl.y, z.x - pl.x);
      }
      if (aim == null) {
        if (mouseRecent && !K.touch) { const w = toWorld(K.mouse.x, K.mouse.y); pl.face = Math.atan2(w.y - pl.y, w.x - pl.x); }
        else if (mx || my) pl.face = K.lerp(pl.face, pl.face + Math.atan2(Math.sin(Math.atan2(my, mx) - pl.face), Math.cos(Math.atan2(my, mx) - pl.face)), Math.min(1, dt * 12));
      }
      fireT -= dt;
      muzzle = Math.max(0, muzzle - dt);
      rapidT = Math.max(0, rapidT - dt);
      spreadT = Math.max(0, spreadT - dt);
      if (aim != null) { pl.face = aim; if (fireT <= 0) fire(aim); }
      /* --- bullets --- */
      for (const b of bullets) {
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        if (inStone(b.x, b.y)) { b.life = 0; K.burst(b.x, b.y, ['#9ca3af', '#d1d5db'], 5, 90, { life: 0.3 }); continue; }
        for (const z of zs) {
          if (K.dist(b.x, b.y, z.x, z.y) > z.r + 3) continue;
          b.life = 0;
          z.hp--;
          z.flash = 0.08;
          const k = z.type === 'brute' ? 60 : 200;
          z.kx += b.vx / 780 * k; z.ky += b.vy / 780 * k;
          K.burst(b.x, b.y, GOO, 6, 120, { life: 0.35 });
          if (z.hp <= 0) kill(z); else K.sfx('hit');
          break;
        }
      }
      bullets = bullets.filter(b => b.life > 0 && b.x > -20 && b.x < VW + 20 && b.y > -20 && b.y < VH + 20);
      /* --- zombies --- */
      for (const z of zs) {
        const want = Math.atan2(pl.y - z.y, pl.x - z.x) + Math.sin(K.t * 1.7 + z.ph) * 0.45;
        z.a = Math.atan2(pl.y - z.y, pl.x - z.x);
        let dx = Math.cos(want), dy = Math.sin(want);
        if (z.slide > 0) { z.slide -= dt; dx = z.sx; dy = z.sy; }
        z.x += (dx * z.sp + z.kx) * dt;
        z.y += (dy * z.sp + z.ky) * dt;
        z.kx *= Math.pow(0.01, dt); z.ky *= Math.pow(0.01, dt);
        z.flash = Math.max(0, z.flash - dt);
        if (!z.inside && z.x > z.r && z.x < VW - z.r && z.y > z.r && z.y < VH - z.r) z.inside = true;
        if (z.inside) {
          const hit = pushOut(z);
          /* bumped into a gravestone: shuffle along its edge for a moment, towards the player's side */
          if (hit && !(z.slide > 0)) {
            const tx = pl.x - z.x, ty = pl.y - z.y;
            const d1 = -hit.ny * tx + hit.nx * ty;
            const left = Math.abs(d1) < 8 ? z.ph > Math.PI : d1 > 0;
            z.sx = left ? -hit.ny : hit.ny;
            z.sy = left ? hit.nx : -hit.nx;
            z.slide = 0.5;
          }
          z.x = K.clamp(z.x, z.r, VW - z.r); z.y = K.clamp(z.y, z.r, VH - z.r);
        }
        if (pl.inv <= 0 && pl.hp > 0 && K.dist(z.x, z.y, pl.x, pl.y) < z.r + pl.r - 3) hurt(z);
      }
      for (let i = 0; i < zs.length; i++) {
        for (let j = i + 1; j < zs.length; j++) {
          const a = zs[i], b = zs[j];
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
          if (d > 0 && d < m) {
            const push = (m - d) / 2;
            a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push;
          }
        }
      }
      if (K.state !== 'play') return;
      /* --- pickups --- */
      for (const d of drops) d.t -= dt;
      drops = drops.filter(d => {
        if (K.dist(d.x, d.y, pl.x, pl.y) < 26) {
          if (d.kind === 'heart') pl.hp = Math.min(HEARTS + 2, pl.hp + 1);
          else if (d.kind === 'rapid') rapidT = 6;
          else spreadT = 6;
          K.float(d.x, d.y - 24, PICK[d.kind].name, PICK[d.kind].color, 16);
          K.burst(d.x, d.y, [PICK[d.kind].color, '#fff'], 16, 160, { life: 0.5 });
          K.sfx('power');
          return false;
        }
        return d.t > 0;
      });
      /* --- the wave --- */
      if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      if (breakT > 0) {
        breakT -= dt;
        if (breakT <= 0) startWave(wave + 1);
      } else {
        spawnT -= dt;
        if (toSpawn > 0 && spawnT <= 0) {
          spawnZombie();
          toSpawn--;
          spawnT = Math.max(0.22, 1.1 - wave * 0.06) * K.rnd(0.6, 1.25);
        }
        if (toSpawn === 0 && zs.length === 0) {
          breakT = 2.6;
          K.add(50 * wave, pl.x, pl.y - 40, K.accent);
          banner = { text: 'Wave ' + wave + ' cleared', sub: 'Catch your breath', t: 2.4 };
          K.sfx('win');
        }
      }
    },
    draw(g) {
      F = K.fit(VW, VH);
      g.save();
      g.translate(F.ox, F.oy);
      g.scale(F.s, F.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      if (ground) g.drawImage(ground, 0, 0);
      for (const d of drops) drawDrop(g, d);
      for (const s of stones) drawStone(g, s);
      for (const z of zs) drawZombie(g, z);
      drawPlayer(g);
      g.fillStyle = '#fef08a';
      for (const b of bullets) { g.fillRect(b.x - 2, b.y - 2, 4, 4); }
      lighting();
      g.drawImage(dark, 0, 0, VW, VH);
      for (const z of zs) drawEyes(g, z);
      /* an iron fence around the yard */
      g.strokeStyle = 'rgba(30,41,59,.9)';
      g.lineWidth = 3;
      g.strokeRect(4, 4, VW - 8, VH - 8);
      g.fillStyle = 'rgba(30,41,59,.9)';
      for (let x = 14; x < VW; x += 22) { g.fillRect(x, 0, 3, 10); g.fillRect(x, VH - 10, 3, 10); }
      for (let y = 14; y < VH; y += 22) { g.fillRect(0, y, 10, 3); g.fillRect(VW - 10, y, 10, 3); }
      K.fx(g);
      /* vignette */
      const v = g.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VW * 0.65);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
      g.fillStyle = v;
      g.fillRect(0, 0, VW, VH);
      g.restore();
      if (banner && K.state === 'play') {
        const a = Math.min(1, banner.t * 2);
        g.globalAlpha = a;
        g.save();
        g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 10;
        K.txt(g, banner.text, K.W / 2, K.H * 0.36, K.clamp(F.s * 44, 24, 60), K.accent, 'center', 900);
        if (banner.sub) K.txt(g, banner.sub, K.W / 2, K.H * 0.36 + K.clamp(F.s * 40, 24, 50), K.clamp(F.s * 17, 13, 22), '#e5e7eb', 'center', 600);
        g.restore();
        g.globalAlpha = 1;
      }
      /* the touch stick */
      for (const p of K.ptrs.values()) {
        if (p.used || p.type === 'mouse' || K.state !== 'play') continue;
        g.globalAlpha = 0.35; g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x0, p.y0, 60, 0, 7); g.stroke();
        g.globalAlpha = 0.5; g.fillStyle = '#fff';
        g.beginPath(); g.arc(p.x, p.y, 18, 0, 7); g.fill();
        g.globalAlpha = 1;
        break;
      }
    },
    hud(g) {
      const hp = Math.max(0, pl.hp);
      const full = '♥'.repeat(Math.min(hp, 10));
      const empty = '♡'.repeat(Math.max(0, Math.min(HEARTS, 10) - hp));
      K.pill(g, (full + empty) || '♡', 12, 12, '#fb7185');
      K.pill(g, 'Wave ' + wave, K.W / 2, 12, K.accent, 'center');
      K.pill(g, 'Score ' + K.score, K.W - 12, 12, '#fff', 'right');
      const left = zs.length + toSpawn;
      if (left > 0 && K.state === 'play') K.txt(g, left + ' left', K.W / 2, 54, 12, 'rgba(226,232,240,.75)', 'center', 700);
      let x = 12;
      if (rapidT > 0) x += K.pill(g, 'Rapid ' + Math.ceil(rapidT), x, 46, PICK.rapid.color) + 6;
      if (spreadT > 0) K.pill(g, 'Spread ' + Math.ceil(spreadT), x, 46, PICK.spread.color);
    },
    info() {
      return { x: pl.x, y: pl.y, wave, zombies: zs.length, hp: pl.hp, kills, bullets: bullets.length };
    },
  };
}

export default {
  id: 'zombie-survival',
  name: 'Zombie Survival',
  icon: 'shield',
  genre: 'horror',
  desc: 'Hold a moonlit graveyard against waves of cartoon zombies with a flashlight and a pistol. Runners and brutes join later; gravestones are your only cover.',
  controls: 'WASD or arrow keys to move · aim with the mouse, click or hold Space to fire (Space auto-aims without a mouse) · touch: drag to move, the gun fires itself · P pauses',
  season: 'halloween',
  colors: ['#050806', '#a3e635'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Zombie Survival' },
    { k: 'hearts', label: 'Hearts', type: 'range', min: 3, max: 10, step: 1, value: 5 },
    { k: 'zombieSpeed', label: 'Zombie speed', type: 'range', min: 30, max: 120, step: 5, value: 55 },
    { k: 'waveSize', label: 'Zombies in wave 1', type: 'range', min: 3, max: 15, step: 1, value: 6 },
    { k: 'fireRate', label: 'Shots per second', type: 'range', min: 2, max: 15, step: 1, value: 7 },
    { k: 'playerSpeed', label: 'Player speed', type: 'range', min: 100, max: 320, step: 10, value: 190 },
    { k: 'accent', label: 'Jacket colour', type: 'color', value: '#a3e635' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  /* the drag must be a touch drag (pointerType 'touch'): a held mouse button aims and fires instead */
  test: { key: 'ArrowRight', ms: 400, field: 'x', dir: 1, drag: { dx: 160, dy: 0, field: 'x', dir: 1, touch: true } },
  game,
  art(g, w, h) {
    const gr = g.createRadialGradient(w * 0.7, h * 0.2, 10, w / 2, h / 2, w * 0.7);
    gr.addColorStop(0, '#2c4a3c'); gr.addColorStop(1, '#0c1510');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const stone = (x, y, sw, sh) => {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x + sw / 2 + 4, y + sh / 2 + 5, sw * 0.6, sh * 0.55, 0, 0, 7); g.fill();
      g.fillStyle = '#6b7280'; g.fillRect(x, y, sw, sh);
      g.fillStyle = '#374151'; g.fillRect(x + sw / 2 - 2, y + 4, 4, sh - 8); g.fillRect(x + 5, y + sh / 2 - 3, sw - 10, 4);
    };
    stone(36, 30, 30, 24); stone(240, 120, 34, 26); stone(60, 128, 26, 20);
    g.fillStyle = 'rgba(255,250,220,.16)';
    g.beginPath(); g.moveTo(w / 2, h / 2); g.arc(w / 2, h / 2, 170, -0.5, 0.35); g.closePath(); g.fill();
    const zom = (x, y, r, c) => {
      g.fillStyle = '#3f6212';
      g.fillRect(x - r - 10, y - r * 0.9, r + 4, r * 0.4); g.fillRect(x - r - 10, y + r * 0.5, r + 4, r * 0.4);
      g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.fillStyle = '#fde047'; g.beginPath(); g.arc(x - r * 0.45, y - r * 0.25, 2, 0, 7); g.arc(x - r * 0.45, y + r * 0.25, 2, 0, 7); g.fill();
    };
    zom(250, 70, 13, '#65a30d'); zom(282, 104, 11, '#a3e635'); zom(212, 140, 18, '#4d7c0f');
    g.fillStyle = '#1f2937'; g.fillRect(w / 2, h / 2 - 3, 22, 6);
    g.fillStyle = '#a3e635'; g.beginPath(); g.ellipse(w / 2, h / 2, 10, 14, 0, 0, 7); g.fill();
    g.fillStyle = '#fcd9b6'; g.beginPath(); g.arc(w / 2 + 2, h / 2, 7, 0, 7); g.fill();
    g.fillStyle = '#fef08a'; g.fillRect(w / 2 + 50, h / 2 - 9, 4, 4); g.fillRect(w / 2 + 84, h / 2 - 16, 4, 4);
    const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.6);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  },
};
