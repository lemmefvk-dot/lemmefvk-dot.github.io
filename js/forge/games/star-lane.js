/* Star Lane — a Static Forge template (original code and art).
   A vertical shoot-'em-up: your little ship patrols the bottom of the
   screen while waves of drones, zig-zaggers and gunners come down the
   lane. Every fifth kill drops a spark for triple shot. After the last
   wave a guardian ship takes the lane: beat it to win. Lose all your
   lives and the lane is closed. Waves, lives, enemy fire and the
   guardian's strength are settings.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const WAVES = Math.round(K.clamp(N(P.waves, 4), 0, 8));
  const LIVES = Math.round(K.clamp(N(P.lives, 3), 1, 9));
  const BOSS_HP = Math.round(K.clamp(N(P.bossHealth, 40), 3, 200));
  const FIRE = K.clamp(N(P.enemyFire, 1), 0, 3);
  const VW = 560, VH = 420;
  const SPEED = 330, RATE = 0.17;

  let ship, bullets, foes, shots, sparks, queue, spawnT, wave, between, lives, inv, cool, kills, power, boss, stars, lay, drag, fired, t0;

  const fight = () => !boss || boss.hp > 0;
  function makeWave(w) {
    const n = 5 + w * 2;
    queue = [];
    for (let i = 0; i < n; i++) {
      const roll = (i + w) % 5;
      const type = w >= 2 && roll === 4 ? 'gunner' : w >= 1 && roll === 2 ? 'zig' : 'drone';
      queue.push({ type, x: 60 + ((i * 97 + w * 53) % (VW - 120)), phase: i * 0.9 });
    }
    spawnT = 0.6;
  }
  function spawnFoe(q) {
    const hp = q.type === 'drone' ? 1 : 2;
    foes.push({ type: q.type, x: q.x, bx: q.x, y: -20, hp, phase: q.phase, age: 0, fire: K.rnd(0.8, 2), hold: 0 });
  }
  function enemyShot(x, y, angle, sp) { shots.push({ x, y, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp }); }
  function hurt() {
    if (inv > 0 || K.state !== 'play') return;
    lives--;
    inv = 1.8; power = 0;
    K.shake(9); K.flash('#ef4444', 0.25); K.sfx('hurt');
    K.burst(ship.x, ship.y, ['#fde68a', '#fb7185', '#fff'], 24, 260, { life: 0.5 });
    if (lives <= 0) K.over('The lane is closed');
  }
  function kill(f) {
    kills++;
    const pts = f.type === 'drone' ? 10 : f.type === 'zig' ? 20 : 30;
    K.add(pts, f.x, f.y - 12, '#fde68a');
    K.sfx('hit');
    K.burst(f.x, f.y, ['#fdba74', '#fff', '#f87171'], 14, 200, { life: 0.4 });
    if (kills % 5 === 0) sparks.push({ x: f.x, y: f.y });
  }
  function geometry() { lay = K.fit(VW, VH); }

  return {
    title: 'Star Lane',
    tagline: 'Clear the waves, then beat the guardian.',
    controls: ['Arrows or WASD: fly   ·   hold Space: fire', 'Touch or mouse: drag to fly, your ship fires while you hold', 'Every fifth kill drops a spark: triple shot   ·   P: pause'],
    accent: '#38bdf8',
    bg: '#050818',
    resize() { geometry(); },
    reset() {
      geometry();
      ship = { x: VW / 2, y: VH - 50 };
      bullets = []; foes = []; shots = []; sparks = []; queue = [];
      wave = 0; between = 1.2; lives = LIVES; inv = 1; cool = 0; kills = 0; power = 0; boss = null; drag = null; fired = 0;
      stars = Array.from({ length: 60 }, () => ({ x: Math.random() * VW, y: Math.random() * VH, s: Math.random() * 1.6 + 0.4, v: 20 + Math.random() * 80 }));
      if (WAVES > 0) makeWave(0);
      else startBoss();
    },
    idle(dt) { if (stars) for (const s of stars) { s.y += s.v * dt; if (s.y > VH) { s.y = 0; s.x = Math.random() * VW; } } },
    update(dt) {
      for (const s of stars) { s.y += s.v * dt * (boss ? 1.6 : 1); if (s.y > VH) { s.y = 0; s.x = Math.random() * VW; } }
      inv = Math.max(0, inv - dt);
      power = Math.max(0, power - dt);
      /* flying: keys, or the first finger / held mouse button as a drag */
      const p = K.primary();
      if (p) {
        if (!drag || drag.id !== p.id) drag = { id: p.id, sx: ship.x, sy: ship.y, px: p.x, py: p.y };
        const tx = drag.sx + (p.x - drag.px) / lay.s, ty = drag.sy + (p.y - drag.py) / lay.s;
        ship.x += K.clamp(tx - ship.x, -SPEED * 1.6 * dt, SPEED * 1.6 * dt);
        ship.y += K.clamp(ty - ship.y, -SPEED * 1.6 * dt, SPEED * 1.6 * dt);
      } else {
        drag = null;
        ship.x += K.ax() * SPEED * dt;
        ship.y += K.ay() * SPEED * dt;
      }
      ship.x = K.clamp(ship.x, 20, VW - 20);
      ship.y = K.clamp(ship.y, VH * 0.55, VH - 26);
      /* firing */
      cool -= dt;
      if ((K.held('Space') || p) && cool <= 0) {
        cool = RATE;
        bullets.push({ x: ship.x, y: ship.y - 18, vx: 0 });
        if (power > 0) { bullets.push({ x: ship.x - 10, y: ship.y - 12, vx: -90 }); bullets.push({ x: ship.x + 10, y: ship.y - 12, vx: 90 }); }
        fired++;
        K.tone(880, 330, 0.06, 'square', 0.025);
      }
      for (const b of bullets) { b.y -= 640 * dt; b.x += b.vx * dt; }
      bullets = bullets.filter(b => b.y > -20 && b.x > -10 && b.x < VW + 10);
      /* waves */
      if (!boss) {
        if (queue.length) {
          spawnT -= dt;
          if (spawnT <= 0) { spawnFoe(queue.shift()); spawnT = Math.max(0.35, 0.9 - wave * 0.07); }
        } else if (!foes.length) {
          between -= dt;
          if (between <= 0) {
            K.add(100, VW / 2, VH * 0.4, '#a7f3d0');
            wave++;
            if (wave >= WAVES) startBoss(); else { makeWave(wave); between = 1.4; }
          }
        } else between = 1.4;
      }
      for (const f of foes) {
        f.age += dt;
        if (f.type === 'gunner') {
          if (f.hold <= 0 && f.y < 90) f.y += 90 * dt; else { f.hold += dt; f.x = f.bx + Math.sin(f.age * 1.3 + f.phase) * 90; if (f.hold > 8) f.y += 120 * dt; }
          f.fire -= dt * FIRE;
          if (f.fire <= 0 && f.hold > 0.2) { f.fire = 1.7; enemyShot(f.x, f.y + 12, Math.atan2(ship.y - f.y, ship.x - f.x), 190); }
        } else if (f.type === 'zig') {
          f.y += (80 + wave * 8) * dt; f.x = f.bx + Math.sin(f.age * 3.2 + f.phase) * 110;
        } else { f.y += (70 + wave * 8) * dt; f.x = f.bx + Math.sin(f.age * 1.8 + f.phase) * 55; }
        f.x = K.clamp(f.x, 16, VW - 16);
        if (K.dist(f.x, f.y, ship.x, ship.y) < 24 && inv <= 0) { f.hp = 0; kill(f); hurt(); if (K.state !== 'play') return; }
      }
      /* player bullets against foes and the guardian */
      for (const b of bullets) {
        for (const f of foes) {
          if (f.hp > 0 && !b.dead && Math.abs(b.x - f.x) < 16 && Math.abs(b.y - f.y) < 16) { b.dead = true; f.hp--; K.burst(b.x, b.y, '#fff', 3, 90, { life: 0.2 }); if (f.hp <= 0) kill(f); }
        }
        if (boss && boss.hp > 0 && !b.dead && Math.abs(b.x - boss.x) < 62 && Math.abs(b.y - boss.y) < 26) {
          b.dead = true; boss.hp--; boss.flash = 0.08;
          K.burst(b.x, b.y, ['#fff', '#fdba74'], 3, 100, { life: 0.2 });
          K.score += 2;
          if (boss.hp <= 0) {
            K.add(500, boss.x, boss.y - 20, '#fde68a');
            K.burst(boss.x, boss.y, ['#fdba74', '#fff', '#f87171', '#fde68a'], 70, 380, { life: 0.9, size: 5 });
            K.sfx('boom'); K.shake(14);
            K.win('Guardian destroyed!');
            return;
          }
        }
      }
      bullets = bullets.filter(b => !b.dead);
      foes = foes.filter(f => f.hp > 0 && f.y < VH + 30);
      /* the guardian */
      if (boss && boss.hp > 0) {
        boss.age += dt; boss.flash = Math.max(0, boss.flash - dt);
        if (boss.y < 80) boss.y += 60 * dt;
        boss.x = VW / 2 + Math.sin(boss.age * 0.9) * (VW / 2 - 90);
        boss.fire -= dt * FIRE;
        boss.aim -= dt * FIRE;
        if (boss.fire <= 0 && boss.y >= 80) {
          boss.fire = 1.25;
          for (let i = -2; i <= 2; i++) enemyShot(boss.x + i * 18, boss.y + 22, Math.PI / 2 + i * 0.22, 170);
        }
        if (boss.aim <= 0 && boss.y >= 80) { boss.aim = 3.2; for (let i = 0; i < 3; i++) enemyShot(boss.x, boss.y + 22, Math.atan2(ship.y - boss.y, ship.x - boss.x) + (i - 1) * 0.12, 230); }
      }
      for (const s of shots) {
        s.x += s.vx * dt; s.y += s.vy * dt;
        if (inv <= 0 && K.dist(s.x, s.y, ship.x, ship.y) < 14) { s.dead = true; hurt(); if (K.state !== 'play') return; }
      }
      shots = shots.filter(s => !s.dead && s.y < VH + 20 && s.y > -20 && s.x > -20 && s.x < VW + 20);
      for (const sp of sparks) {
        sp.y += 90 * dt;
        if (K.dist(sp.x, sp.y, ship.x, ship.y) < 26) { sp.got = true; power = 9; K.sfx('power'); K.float(ship.x, ship.y - 30, 'Triple shot!', '#fde68a', 16); }
      }
      sparks = sparks.filter(sp => !sp.got && sp.y < VH + 20);
    },
    draw(g) {
      if (!lay) geometry();
      g.fillStyle = '#0a1030'; g.fillRect(0, 0, K.W, K.H);
      g.save();
      g.translate(lay.ox, lay.oy); g.scale(lay.s, lay.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      const bg = g.createLinearGradient(0, 0, 0, VH);
      bg.addColorStop(0, '#050818'); bg.addColorStop(1, '#1b1f4d');
      g.fillStyle = bg; g.fillRect(0, 0, VW, VH);
      g.fillStyle = '#c7d2fe';
      for (const s of stars) { g.globalAlpha = 0.35 + s.s / 3; g.fillRect(s.x, s.y, s.s, s.s * (1 + s.v / 80)); }
      g.globalAlpha = 1;
      for (const sp of sparks) { g.fillStyle = '#fde68a'; g.beginPath(); g.arc(sp.x, sp.y, 8 + Math.sin(K.t * 8) * 1.5, 0, 7); g.fill(); K.txt(g, '3', sp.x, sp.y + 1, 11, '#78350f', 'center', 900); }
      for (const b of bullets) { g.fillStyle = '#7dd3fc'; K.rr(g, b.x - 2, b.y - 8, 4, 14, 2); g.fill(); }
      for (const s of shots) { g.fillStyle = '#fb7185'; g.beginPath(); g.arc(s.x, s.y, 5, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x, s.y, 2, 0, 7); g.fill(); }
      for (const f of foes) {
        g.save(); g.translate(f.x, f.y);
        if (f.type === 'drone') { g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(0, 14); g.lineTo(-14, -8); g.lineTo(0, -3); g.lineTo(14, -8); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.fillRect(-2, -2, 4, 6); }
        else if (f.type === 'zig') { g.fillStyle = '#a78bfa'; g.beginPath(); g.moveTo(0, 15); g.lineTo(-16, 0); g.lineTo(-8, -12); g.lineTo(8, -12); g.lineTo(16, 0); g.closePath(); g.fill(); g.fillStyle = '#ede9fe'; g.beginPath(); g.arc(0, -1, 4, 0, 7); g.fill(); }
        else { g.fillStyle = '#f43f5e'; K.rr(g, -16, -12, 32, 24, 6); g.fill(); g.fillStyle = '#1e1b4b'; g.fillRect(-10, -4, 20, 6); g.fillStyle = '#fde68a'; g.fillRect(-3, 8, 6, 8); }
        g.restore();
      }
      if (boss && boss.hp > 0) {
        g.save(); g.translate(boss.x, boss.y);
        g.fillStyle = boss.flash > 0 ? '#fff' : '#6366f1';
        g.beginPath(); g.moveTo(-64, -10); g.lineTo(-34, -26); g.lineTo(34, -26); g.lineTo(64, -10); g.lineTo(40, 22); g.lineTo(-40, 22); g.closePath(); g.fill();
        g.fillStyle = '#312e81'; K.rr(g, -22, -14, 44, 24, 8); g.fill();
        g.fillStyle = '#f43f5e'; g.beginPath(); g.arc(0, -2, 8 + Math.sin(K.t * 6), 0, 7); g.fill();
        g.fillStyle = '#fde68a'; g.fillRect(-52, 12, 8, 10); g.fillRect(44, 12, 8, 10);
        g.restore();
      }
      if (inv <= 0 || Math.floor(K.t * 14) % 2) {
        g.save(); g.translate(ship.x, ship.y);
        if (power > 0) { g.strokeStyle = 'rgba(253,230,138,.6)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 22, 0, 7); g.stroke(); }
        g.fillStyle = K.accent;
        g.beginPath(); g.moveTo(0, -20); g.lineTo(14, 12); g.lineTo(0, 6); g.lineTo(-14, 12); g.closePath(); g.fill();
        g.fillStyle = '#e0f2fe'; g.beginPath(); g.ellipse(0, -2, 3.5, 7, 0, 0, 7); g.fill();
        g.fillStyle = '#fb923c'; g.fillRect(-3, 8, 6, 5 + Math.random() * 6);
        g.restore();
      }
      K.fx(g);
      g.restore();
    },
    hud(g) {
      K.pill(g, 'Score ' + K.score, 12, 12, '#fff');
      K.pill(g, 'Lives ' + lives, K.W - 12, 12, '#fda4af', 'right');
      K.pill(g, boss ? 'Guardian' : 'Wave ' + Math.min(WAVES, wave + 1) + ' / ' + WAVES, 12, 46, '#fff');
      if (boss && boss.hp > 0) {
        const w = Math.min(260, K.W - 40), x = (K.W - w) / 2;
        g.fillStyle = 'rgba(6,8,16,.6)'; K.rr(g, x, K.H - 24, w, 10, 5); g.fill();
        g.fillStyle = '#f43f5e'; K.rr(g, x, K.H - 24, Math.max(8, w * boss.hp / BOSS_HP), 10, 5); g.fill();
      }
      if (power > 0) K.pill(g, 'Triple shot ' + Math.ceil(power), K.W - 12, 46, '#fde68a', 'right');
      if (!boss && between > 0 && !queue.length && !foes.length) K.txt(g, wave === 0 ? 'Wave 1' : 'Wave cleared', K.W / 2, K.H * 0.4, 30, '#a7f3d0', 'center', 900);
    },
    info() {
      return {
        x: ship.x, y: ship.y, lives, wave: wave + 1, power, fired, kills, inv,
        foes: foes.map(f => ({ x: f.x, y: f.y, type: f.type })),
        boss: boss && boss.hp > 0 ? { x: boss.x, y: boss.y, hp: boss.hp } : null,
        shots: shots.length,
      };
    },
  };

  function startBoss() { boss = { x: VW / 2, y: -40, hp: BOSS_HP, age: 0, fire: 1.5, aim: 3, flash: 0 }; foes = []; queue = []; }
}

export default {
  id: 'star-lane',
  name: 'Star Lane',
  icon: 'zap',
  genre: 'shooter',
  desc: 'A vertical shoot-’em-up: fly the lane, blast waves of drones, zig-zaggers and gunners, grab triple-shot sparks and take down the guardian ship at the end.',
  controls: 'Arrows/WASD fly, hold Space to fire · drag to fly on touch (it fires while you hold) · P pauses',
  season: null,
  colors: ['#050818', '#38bdf8'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Star Lane' },
    { k: 'waves', label: 'Waves before the guardian', type: 'range', min: 0, max: 8, step: 1, value: 4 },
    { k: 'lives', label: 'Lives', type: 'range', min: 1, max: 9, step: 1, value: 3 },
    { k: 'enemyFire', label: 'Enemy fire rate (x)', type: 'range', min: 0, max: 3, step: 0.25, value: 1 },
    { k: 'bossHealth', label: 'Guardian health', type: 'range', min: 5, max: 120, step: 5, value: 40 },
    { k: 'accent', label: 'Ship colour', type: 'color', value: '#38bdf8' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'ArrowRight', ms: 400, field: 'x', dir: 1, drag: { dx: 150, dy: 0, field: 'x', dir: 1, touch: true } },
  game,
  art(g, w, h) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#050818'); bg.addColorStop(1, '#1b1f4d');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c7d2fe';
    for (let i = 0; i < 40; i++) g.fillRect((i * 83) % w, (i * 47) % h, 1.5, 1.5);
    g.fillStyle = '#6366f1';
    g.beginPath(); g.moveTo(w / 2 - 54, 34); g.lineTo(w / 2 - 28, 18); g.lineTo(w / 2 + 28, 18); g.lineTo(w / 2 + 54, 34); g.lineTo(w / 2 + 34, 56); g.lineTo(w / 2 - 34, 56); g.closePath(); g.fill();
    g.fillStyle = '#f43f5e'; g.beginPath(); g.arc(w / 2, 36, 8, 0, 7); g.fill();
    g.fillStyle = '#f97316';
    for (const x of [70, 120, 200, 250]) { g.beginPath(); g.moveTo(x, 100); g.lineTo(x - 12, 78); g.lineTo(x, 83); g.lineTo(x + 12, 78); g.closePath(); g.fill(); }
    g.fillStyle = '#7dd3fc'; g.fillRect(w / 2 - 2, 92, 4, 14); g.fillRect(w / 2 - 2, 66, 4, 14);
    g.fillStyle = '#38bdf8';
    g.beginPath(); g.moveTo(w / 2, h - 52); g.lineTo(w / 2 + 16, h - 18); g.lineTo(w / 2, h - 25); g.lineTo(w / 2 - 16, h - 18); g.closePath(); g.fill();
  },
};
