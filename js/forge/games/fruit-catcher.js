/* Fruit Catcher — a Static Forge template (original code and art).
   Catch falling fruit in a basket, dodge the bombs. Catches in a row
   build a combo multiplier; a golden star fruit slows time.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const LIVES = Math.max(1, Math.round(N(P.lives, 3)));
  const FALL = Math.max(40, N(P.fallSpeed, 170));
  const BOMB = K.clamp(N(P.bombChance, 18), 0, 90) / 100;
  const BASKET = Math.max(30, N(P.basketWidth, 96));
  const FRUIT = {
    apple: { pts: 10, r: 17, juice: ['#ef4444', '#fca5a5', '#fde68a'] },
    orange: { pts: 15, r: 17, juice: ['#fb923c', '#fdba74', '#fef3c7'] },
    pear: { pts: 20, r: 17, juice: ['#a3e635', '#d9f99d', '#fef9c3'] },
    cherry: { pts: 25, r: 16, juice: ['#be123c', '#fb7185', '#fecdd3'] },
    melon: { pts: 30, r: 20, juice: ['#f43f5e', '#fda4af', '#4ade80'] },
  };
  const BAG = ['apple', 'apple', 'apple', 'orange', 'orange', 'orange', 'pear', 'pear', 'cherry', 'melon'];

  let U = 1, ground = 0, rimY = 0;
  let basket, items, lives, combo, spawnT, time, slowT, caught, lastKey, sun = 0;
  const canopy = Array.from({ length: 26 }, (_, i) => ({ x: i / 25 + (Math.random() - 0.5) * 0.03, y: Math.random(), r: 0.7 + Math.random() * 0.6, c: ['#14532d', '#166534', '#15803d', '#1a5d36'][i % 4] }));
  const hanging = Array.from({ length: 7 }, () => ({ x: Math.random(), k: ['apple', 'orange', 'pear', 'cherry'][Math.floor(Math.random() * 4)], s: Math.random() * 6 }));
  const grass = Array.from({ length: 90 }, () => ({ x: Math.random(), h: 4 + Math.random() * 8, l: Math.random() }));

  function layout() {
    U = K.clamp(Math.min(K.W / 820, K.H / 580), 0.5, 1.6);
    ground = K.H - 30 * U;
    rimY = ground - 44 * U;
    if (basket) {
      basket.w = BASKET * U;
      basket.x = K.clamp(basket.x, basket.w / 2, K.W - basket.w / 2);
    }
  }
  const mult = () => Math.min(5, 1 + Math.floor(combo / 5));
  const ramp = () => Math.min(1.5, time / 70);

  function spawn() {
    const r0 = Math.random();
    let k;
    if (r0 < 0.025 && !items.some(i => i.k === 'star')) k = 'star';
    else if (r0 < 0.025 + Math.min(0.9, BOMB + Math.min(0.14, time * 0.0018))) k = 'bomb';
    else k = K.pick(BAG);
    const r = (k === 'bomb' ? 17 : k === 'star' ? 19 : FRUIT[k].r) * U;
    items.push({
      k, r, x: K.rnd(r + 10, K.W - r - 10), y: -r - 10, py: -r - 10,
      vy: FALL * U * K.rnd(0.85, 1.15) * (1 + ramp()) * (k === 'star' ? 0.8 : 1),
      rot: K.rnd(0, 6.28), vr: K.rnd(-2, 2), ph: K.rnd(0, 6.28),
    });
  }

  function catchIt(it) {
    if (it.k === 'bomb') {
      lives--;
      combo = 0;
      K.burst(it.x, it.y, ['#f97316', '#fde047', '#fff', '#78716c'], 40, 380, { life: 0.8, size: 5 });
      K.shake(16);
      K.flash('#fff7ed', 0.55);
      K.sfx('boom');
      basket.hurt = 0.6;
      if (lives <= 0) K.over('Kaboom!');
      else K.float(it.x, rimY - 30 * U, 'Ouch!', '#fca5a5', 22);
      return;
    }
    combo++;
    caught++;
    const m = mult();
    if (combo % 5 === 0 && m > 1) { K.float(basket.x, rimY - 70 * U, 'Combo x' + m + '!', K.accent, 24); K.sfx('perfect'); }
    if (it.k === 'star') {
      K.add(100 * m, it.x, rimY - 40 * U, '#fde047');
      slowT = 3.2;
      K.burst(it.x, rimY, ['#fde047', '#fff', '#facc15'], 36, 320, { life: 0.9, size: 4 });
      K.flash('#fde047', 0.25);
      K.sfx('power');
    } else {
      K.add(FRUIT[it.k].pts * m, it.x, rimY - 34 * U, '#fff');
      K.burst(it.x, rimY, FRUIT[it.k].juice, 14, 200, { life: 0.5, grav: 500 });
      K.sfx(combo % 2 ? 'pick' : 'coin');
    }
    basket.bounce = 0.18;
  }

  /* ---------- drawing the fruit ---------- */
  function shine(g, r) {
    g.fillStyle = 'rgba(255,255,255,.45)';
    g.beginPath(); g.ellipse(-r * 0.35, -r * 0.35, r * 0.28, r * 0.16, -0.7, 0, 7); g.fill();
  }
  function leaf(g, x, y, s, a) {
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#22c55e';
    g.beginPath(); g.ellipse(s * 0.5, 0, s * 0.55, s * 0.25, 0, 0, 7); g.fill();
    g.restore();
  }
  function drawItem(g, it) {
    const r = it.r;
    g.save();
    g.translate(it.x, it.y);
    if (it.k !== 'bomb') g.rotate(Math.sin(it.rot) * 0.35);
    if (it.k === 'apple') {
      g.fillStyle = '#dc2626';
      g.beginPath(); g.arc(-r * 0.32, 0, r * 0.78, 0, 7); g.arc(r * 0.32, 0, r * 0.78, 0, 7); g.fill();
      g.fillStyle = '#7c2d12'; g.fillRect(-1.5 * U, -r * 1.05, 3 * U, r * 0.45);
      leaf(g, 1 * U, -r * 0.85, r * 0.7, -0.5);
      shine(g, r);
    } else if (it.k === 'orange') {
      const og = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      og.addColorStop(0, '#fdba74'); og.addColorStop(1, '#ea580c');
      g.fillStyle = og;
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.fillStyle = 'rgba(124,45,18,.35)';
      for (let i = 0; i < 7; i++) g.fillRect(Math.cos(i * 2.4) * r * 0.55, Math.sin(i * 2.4) * r * 0.55, 1.6 * U, 1.6 * U);
      leaf(g, 0, -r * 0.92, r * 0.6, -0.3);
      shine(g, r);
    } else if (it.k === 'pear') {
      g.fillStyle = '#a3e635';
      g.beginPath(); g.arc(0, r * 0.25, r * 0.85, 0, 7); g.arc(0, -r * 0.45, r * 0.55, 0, 7); g.fill();
      g.fillStyle = 'rgba(101,163,13,.55)';
      g.beginPath(); g.arc(r * 0.25, r * 0.4, r * 0.55, 0, 7); g.fill();
      g.fillStyle = '#713f12'; g.fillRect(-1.2 * U, -r * 1.25, 2.4 * U, r * 0.35);
      shine(g, r);
    } else if (it.k === 'cherry') {
      g.strokeStyle = '#65a30d'; g.lineWidth = 2 * U;
      g.beginPath(); g.moveTo(-r * 0.45, r * 0.1); g.quadraticCurveTo(-r * 0.2, -r * 0.9, r * 0.15, -r * 1.1); g.moveTo(r * 0.5, r * 0.25); g.quadraticCurveTo(r * 0.4, -r * 0.6, r * 0.15, -r * 1.1); g.stroke();
      for (const [cx, cy] of [[-r * 0.45, r * 0.35], [r * 0.5, r * 0.5]]) {
        g.fillStyle = '#9f1239';
        g.beginPath(); g.arc(cx, cy, r * 0.55, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,.5)';
        g.beginPath(); g.arc(cx - r * 0.18, cy - r * 0.18, r * 0.14, 0, 7); g.fill();
      }
      leaf(g, r * 0.15, -r * 1.1, r * 0.6, -0.2);
    } else if (it.k === 'melon') {
      g.rotate(it.rot * 0.3);
      g.fillStyle = '#15803d';
      g.beginPath(); g.arc(0, -r * 0.35, r * 1.05, 0.15, Math.PI - 0.15); g.closePath(); g.fill();
      g.fillStyle = '#f0fdf4';
      g.beginPath(); g.arc(0, -r * 0.35, r * 0.92, 0.18, Math.PI - 0.18); g.closePath(); g.fill();
      g.fillStyle = '#f43f5e';
      g.beginPath(); g.arc(0, -r * 0.35, r * 0.82, 0.2, Math.PI - 0.2); g.closePath(); g.fill();
      g.fillStyle = '#1c1917';
      for (const [sx, sy] of [[-0.4, 0.05], [0, 0.18], [0.4, 0.05], [-0.18, -0.1], [0.2, -0.1]]) {
        g.beginPath(); g.ellipse(sx * r, sy * r, 1.6 * U, 2.6 * U, 0, 0, 7); g.fill();
      }
    } else if (it.k === 'star') {
      g.rotate(it.rot);
      g.shadowColor = '#fde047'; g.shadowBlur = 22;
      g.fillStyle = '#facc15';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const rr = i % 2 ? r * 0.48 : r * 1.1;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#fef9c3';
      g.beginPath(); g.arc(-r * 0.15, -r * 0.2, r * 0.2, 0, 7); g.fill();
    } else if (it.k === 'bomb') {
      const bg = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
      bg.addColorStop(0, '#6b7280'); bg.addColorStop(1, '#0a0a0f');
      g.fillStyle = bg;
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = '#374151'; g.fillRect(-r * 0.3, -r * 1.15, r * 0.6, r * 0.3);
      g.strokeStyle = '#d6d3d1'; g.lineWidth = 2 * U;
      g.beginPath(); g.moveTo(0, -r * 1.15); g.quadraticCurveTo(r * 0.3, -r * 1.6, r * 0.6, -r * 1.45); g.stroke();
      const fl = 0.6 + 0.4 * Math.sin(K.t * 40 + it.ph);
      g.fillStyle = '#fde047';
      g.shadowColor = '#f97316'; g.shadowBlur = 14;
      g.beginPath(); g.arc(r * 0.62, -r * 1.47, r * 0.22 * fl + 1, 0, 7); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(r * 0.62, -r * 1.47, r * 0.08, 0, 7); g.fill();
    }
    g.restore();
  }

  function drawBasket(g) {
    const w = basket.w, h = 40 * U;
    const sq = basket.bounce > 0 ? Math.sin(basket.bounce / 0.18 * Math.PI) * 5 * U : 0;
    const x = basket.x, y = rimY + sq;
    g.save();
    if (basket.hurt > 0 && Math.floor(basket.hurt * 20) % 2) g.globalAlpha = 0.5;
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.ellipse(x, ground + 4 * U, w * 0.5, 6 * U, 0, 0, 7); g.fill();
    const bg = g.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, '#ca8a04'); bg.addColorStop(1, '#78350f');
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(x - w / 2, y + 4 * U);
    g.lineTo(x + w / 2, y + 4 * U);
    g.lineTo(x + w * 0.38, y + h);
    g.lineTo(x - w * 0.38, y + h);
    g.closePath(); g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(66,32,6,.55)'; g.lineWidth = 2 * U;
    for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(x + i * w / 10, y); g.lineTo(x + i * w / 10 * 0.76, y + h); g.stroke(); }
    for (let j = 1; j < 4; j++) { g.beginPath(); g.moveTo(x - w, y + 4 * U + j * h / 4); g.lineTo(x + w, y + 4 * U + j * h / 4); g.stroke(); }
    g.restore();
    g.fillStyle = K.accent;
    K.rr(g, x - w / 2 - 4 * U, y - 2 * U, w + 8 * U, 9 * U, 4.5 * U);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';
    K.rr(g, x - w / 2, y - 1 * U, w, 3 * U, 1.5 * U);
    g.fill();
    g.restore();
  }

  return {
    title: 'Fruit Catcher',
    tagline: 'Catch the fruit. Leave the bombs alone.',
    controls: ['Arrow keys / A D, the mouse or a finger: move', 'Golden stars slow time   ·   P: pause'],
    accent: '#fbbf24',
    bg: '#0b3a5a',
    resize() { layout(); },
    reset() {
      layout();
      basket = { x: K.W / 2, vx: 0, w: BASKET * U, bounce: 0, hurt: 0 };
      items = []; lives = LIVES; combo = 0; spawnT = 0.6; time = 0; slowT = 0; caught = 0; lastKey = -1;
    },
    idle(dt) {
      sun += dt;
      if (basket) { basket.bounce = Math.max(0, basket.bounce - dt); basket.hurt = Math.max(0, basket.hurt - dt); }
    },
    update(dt) {
      sun += dt;
      time += dt;
      slowT = Math.max(0, slowT - dt);
      const wdt = slowT > 0 ? dt * 0.45 : dt;
      /* the basket: keys with a little acceleration, or follow the mouse / finger */
      const ax = K.ax();
      if (ax) lastKey = K.t;
      const p = K.primary();
      let target = null;
      if (p) target = p.x;
      else if (K.mouse && K.mouse.t > lastKey) target = K.mouse.x;
      if (target != null) { basket.x = K.lerp(basket.x, target, Math.min(1, dt * 16)); basket.vx = 0; }
      else {
        basket.vx = K.lerp(basket.vx, ax * (640 + 120 * ramp()) * U, Math.min(1, dt * 9));
        basket.x += basket.vx * dt;
      }
      basket.x = K.clamp(basket.x, basket.w / 2, K.W - basket.w / 2);
      basket.bounce = Math.max(0, basket.bounce - dt);
      basket.hurt = Math.max(0, basket.hurt - dt);
      /* spawning */
      spawnT -= wdt;
      if (spawnT <= 0) {
        spawn();
        if (time > 40 && Math.random() < Math.min(0.35, (time - 40) / 150)) spawn();
        spawnT = Math.max(0.3, 1.05 - time * 0.011) * K.rnd(0.7, 1.25);
      }
      /* falling */
      for (const it of items) {
        it.py = it.y;
        it.vy += 26 * U * wdt;
        it.y += it.vy * wdt;
        it.x += Math.sin(K.t * 2 + it.ph) * 12 * U * wdt;
        it.rot += it.vr * wdt;
      }
      items = items.filter(it => {
        if (it.py < rimY && it.y >= rimY && Math.abs(it.x - basket.x) < basket.w / 2 + it.r * 0.1) {
          catchIt(it);
          return false;
        }
        if (it.y - it.r > ground) {
          if (it.k === 'bomb') {
            K.burst(it.x, ground, ['#a8a29e', '#57534e', '#fbbf24'], 14, 160, { life: 0.5, grav: -60 });
            K.sfx('thud');
          } else {
            K.burst(it.x, ground, it.k === 'star' ? ['#fde047', '#fff'] : FRUIT[it.k].juice, 12, 150, { life: 0.5, grav: 400, vy: -80 });
            if (combo >= 5) K.float(it.x, ground - 30 * U, 'Combo lost', '#e2e8f0', 15);
            combo = 0;
            K.sfx('drop');
          }
          return false;
        }
        return true;
      });
    },
    down() { /* the basket follows the finger in update() */ },
    draw(g) {
      /* evening sky, a low sun and hills */
      const sky = g.createLinearGradient(0, 0, 0, K.H);
      sky.addColorStop(0, '#082f49');
      sky.addColorStop(0.6, '#1d6fa3');
      sky.addColorStop(1, '#7dd3fc');
      g.fillStyle = sky;
      g.fillRect(0, 0, K.W, K.H);
      const sx = K.W * 0.78, sy = ground - 78 * U;
      const sg = g.createRadialGradient(sx, sy, 0, sx, sy, 120 * U);
      sg.addColorStop(0, 'rgba(254,240,138,.75)'); sg.addColorStop(0.22, 'rgba(253,224,71,.28)'); sg.addColorStop(1, 'rgba(253,224,71,0)');
      g.fillStyle = sg;
      g.fillRect(0, 0, K.W, K.H);
      g.fillStyle = '#1e4d3a';
      g.beginPath(); g.moveTo(0, ground);
      for (let x = 0; x <= K.W + 20; x += 20) g.lineTo(x, ground - 70 * U - Math.sin(x / 140 + 1) * 26 * U - Math.sin(x / 57) * 8 * U);
      g.lineTo(K.W, ground); g.closePath(); g.fill();
      g.fillStyle = '#166534';
      g.beginPath(); g.moveTo(0, ground);
      for (let x = 0; x <= K.W + 20; x += 20) g.lineTo(x, ground - 30 * U - Math.sin(x / 90 + 3) * 14 * U);
      g.lineTo(K.W, ground); g.closePath(); g.fill();
      /* the ground and grass */
      g.fillStyle = '#14532d';
      g.fillRect(0, ground, K.W, K.H - ground);
      g.strokeStyle = '#22c55e';
      g.lineWidth = 1.5;
      g.beginPath();
      for (const b of grass) { const x = b.x * K.W; g.moveTo(x, ground + 2); g.lineTo(x + Math.sin(sun * 2 + b.l * 9) * 2, ground - b.h * U); }
      g.stroke();
      /* items, then the basket in front of them */
      for (const it of items) drawItem(g, it);
      if (basket) drawBasket(g);
      /* the canopy the fruit drops from */
      for (const h of hanging) {
        drawItem(g, { k: h.k, x: h.x * K.W, y: 34 * U + Math.sin(sun * 1.5 + h.s) * 3, r: 13 * U, rot: Math.sin(sun + h.s) * 0.4, ph: 0 });
      }
      for (const c of canopy) {
        g.fillStyle = c.c;
        g.beginPath(); g.arc(c.x * K.W, -10 * U + c.y * 26 * U, (34 + c.r * 30) * U, 0, 7); g.fill();
      }
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.fillRect(0, 0, K.W, 6 * U);
      if (slowT > 0) {
        g.fillStyle = 'rgba(253,224,71,' + (0.1 + 0.04 * Math.sin(K.t * 10)) + ')';
        g.fillRect(0, 0, K.W, K.H);
      }
      K.fx(g);
    },
    hud(g) {
      const y = 12;
      K.pill(g, 'Score ' + K.score, 12, y, '#fff');
      K.pill(g, lives > 0 ? '♥ '.repeat(Math.min(lives, 6)).trim() + (lives > 6 ? ' +' + (lives - 6) : '') : '♥ 0', K.W - 12, y, '#fb7185', 'right');
      if (combo >= 2) K.pill(g, 'Combo ' + combo + (mult() > 1 ? '  x' + mult() : ''), K.W / 2, y, K.accent, 'center');
      if (slowT > 0) K.pill(g, 'Slow motion ' + Math.ceil(slowT), K.W / 2, y + 34, '#fde047', 'center');
    },
    info() {
      let low = null;
      for (const it of items) if (it.k !== 'bomb' && (!low || it.y > low.y)) low = it;
      return { x: basket.x, w: basket.w, lives, combo, caught, items: items.length, next: low ? Math.round(low.x) : null };
    },
  };
}

export default {
  id: 'fruit-catcher',
  name: 'Fruit Catcher',
  icon: 'heart',
  genre: 'casual',
  desc: 'Fruit tumbles out of the orchard: catch it in your basket, build a combo and grab the golden stars, but never catch a bomb.',
  controls: 'Arrow keys or A/D, the mouse or a finger to move the basket · P pauses',
  season: null,
  colors: ['#0b3a5a', '#fbbf24'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Fruit Catcher' },
    { k: 'lives', label: 'Lives', type: 'range', min: 1, max: 9, step: 1, value: 3 },
    { k: 'fallSpeed', label: 'Fall speed', type: 'range', min: 100, max: 400, step: 10, value: 170 },
    { k: 'bombChance', label: 'Bomb chance (%)', type: 'range', min: 0, max: 50, step: 1, value: 18 },
    { k: 'basketWidth', label: 'Basket width', type: 'range', min: 50, max: 200, step: 5, value: 96 },
    { k: 'accent', label: 'Basket rim colour', type: 'color', value: '#fbbf24' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'ArrowRight', ms: 400, field: 'x', dir: 1, drag: { dx: 200, dy: 0, field: 'x', dir: 1 } },
  game,
  art(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#082f49'); sky.addColorStop(0.65, '#1d6fa3'); sky.addColorStop(1, '#7dd3fc');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#166534';
    g.beginPath(); g.moveTo(0, h - 18);
    for (let x = 0; x <= w; x += 10) g.lineTo(x, h - 34 - Math.sin(x / 40) * 8);
    g.lineTo(w, h - 18); g.closePath(); g.fill();
    g.fillStyle = '#14532d'; g.fillRect(0, h - 18, w, 18);
    for (let i = 0; i < 12; i++) { g.fillStyle = ['#14532d', '#15803d', '#166534'][i % 3]; g.beginPath(); g.arc(i * w / 11, 0, 30, 0, 7); g.fill(); }
    const fruit = [[60, 70, '#dc2626'], [130, 105, '#ea580c'], [205, 60, '#a3e635'], [265, 95, '#9f1239']];
    for (const [x, y, c] of fruit) {
      g.fillStyle = c; g.beginPath(); g.arc(x * w / 320, y * h / 180, 11, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.arc(x * w / 320 - 4, y * h / 180 - 4, 3, 0, 7); g.fill();
    }
    g.fillStyle = '#111'; g.beginPath(); g.arc(w * 0.58, h * 0.36, 10, 0, 7); g.fill();
    g.fillStyle = '#fde047'; g.shadowColor = '#f97316'; g.shadowBlur = 10; g.beginPath(); g.arc(w * 0.58 + 7, h * 0.36 - 14, 3, 0, 7); g.fill(); g.shadowBlur = 0;
    const bx = w / 2, by = h - 52;
    const bg = g.createLinearGradient(0, by, 0, by + 30);
    bg.addColorStop(0, '#ca8a04'); bg.addColorStop(1, '#78350f');
    g.fillStyle = bg;
    g.beginPath(); g.moveTo(bx - 44, by); g.lineTo(bx + 44, by); g.lineTo(bx + 32, by + 30); g.lineTo(bx - 32, by + 30); g.closePath(); g.fill();
    g.fillStyle = '#fbbf24'; g.fillRect(bx - 48, by - 4, 96, 7);
  },
};
