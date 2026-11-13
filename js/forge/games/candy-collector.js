/* Candy Collector — a Static Forge template (original code and art).
   A night-time platformer: run, jump and stomp through a level built
   from segments (gaps, steps, floating planks), grab the candy and reach
   the bubbling cauldron. Each level is longer and harder. Gaps and steps
   are sized from the jump settings, so every level stays possible.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const RUN = K.clamp(N(P.runSpeed, 250), 60, 800);
  const JUMP = K.clamp(N(P.jump, 620), 150, 1600);
  const GRAV = K.clamp(N(P.gravity, 1700), 300, 5000);
  const AIRJ = Math.round(K.clamp(N(P.airJumps, 1), 0, 4));
  const LIVES = Math.round(K.clamp(N(P.lives, 3), 1, 9));
  const LEN = Math.round(K.clamp(N(P.levelLength, 5), 2, 20));

  const T = 40, ROWS = 10, VH = ROWS * T, PW = 22, PH = 30;
  /* what a jump can really do with these settings (in tiles) */
  const H1 = JUMP * JUMP / (2 * GRAV);
  const STEP = Math.max(0, Math.min(3, Math.floor(H1 * (1 + 0.81 * AIRJ) / T * 0.8)));
  const AIR = 2 * JUMP / GRAV * (1 + 0.9 * AIRJ);
  const REACH = Math.max(0, Math.min(5, Math.floor(RUN * AIR / T * 0.6)));

  let tiles, COLS, candies, foes, thorns, checkpoint, goal, total;
  let pl, lives, level, got, camX, coyote, buffer, airLeft, cut, inv, dyingT, clearT, banner, showPads, padJumpWas, spawn;
  const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random() * 0.7, s: Math.random() * 1.5 + 0.4, p: Math.random() * 6 }));
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  const at = (c, r) => (c < 0 || c >= COLS ? (r >= -50 ? 1 : 0) : r < 0 || r >= ROWS ? 0 : tiles[r * COLS + c]);
  const solid = (c, r) => { const t = at(c, r); return t === 1 || t === 3; };
  const set = (c, r, v) => { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) tiles[r * COLS + c] = v; };

  function genLevel(n) {
    const diff = Math.min(1, (n - 1) / 6);
    const screens = Math.min(20, LEN + n - 1);
    COLS = screens * 16;
    tiles = new Uint8Array(COLS * ROWS);
    candies = []; foes = []; thorns = []; checkpoint = null;
    const ground = (c0, len, top) => { for (let c = c0; c < c0 + len; c++) for (let r = top; r < ROWS; r++) set(c, r, 1); };
    const candy = (x, y) => candies.push({ x, y, k: Math.random() < 0.15 ? 'pop' : Math.random() < 0.5 ? 'corn' : 'wrap', c: K.pick(['#f472b6', '#facc15', '#4ade80', '#38bdf8', '#c084fc']), ph: Math.random() * 6, got: false });
    const arc = (x0, x1, yTop, n2) => { for (let i = 0; i < n2; i++) { const t = (i + 0.5) / n2; candy(K.lerp(x0, x1, t), yTop + (2 * t - 1) * (2 * t - 1) * T * 1.4); } };
    const pumpkin = (c, top) => foes.push({ k: 'pump', x: c * T + 6, y: top * T - 28, w: 30, h: 28, vx: (Math.random() < 0.5 ? -1 : 1) * (38 + diff * 45 + Math.random() * 20), dead: 0, ph: Math.random() * 6 });
    const bat = (x, y) => foes.push({ k: 'bat', ax: x, ay: y, x, y, w: 30, h: 18, range: 50 + Math.random() * 60, sp: 0.8 + diff * 0.8 + Math.random() * 0.4, ph: Math.random() * 6, dead: 0 });
    let gh = 8;
    ground(0, 10, gh);
    for (let i = 0; i < 3; i++) candy((5 + i) * T + T / 2, (gh - 1) * T + 6);
    let x = 10;
    const end = COLS - 14;
    while (x < end) {
      const roll = Math.random();
      if (!checkpoint && x > COLS * 0.45) {
        ground(x, 5, gh);
        checkpoint = { x: (x + 2) * T + T / 2, y: gh * T, on: false };
        x += 5;
        continue;
      }
      if (roll < 0.26) {                                   /* flat, with a pumpkin or a bramble */
        const len = K.ri(5, 8);
        ground(x, len, gh);
        if (Math.random() < 0.35 + diff * 0.4) pumpkin(x + K.ri(2, len - 2), gh);
        else if (Math.random() < 0.3 + diff * 0.3) thorns.push({ x: (x + K.ri(2, len - 3)) * T + 4, y: gh * T - 18, w: T - 8, h: 18 });
        if (Math.random() < 0.7) for (let i = 1; i < len - 1; i += 2) candy((x + i) * T + T / 2, (gh - 1) * T + 6);
        if (Math.random() < 0.15 + diff * 0.3) bat((x + len / 2) * T, (gh - 3.2) * T);
        x += len;
      } else if (roll < 0.46 && REACH >= 1) {             /* a pit to jump */
        const w = K.ri(1, Math.max(1, Math.min(REACH, 2 + Math.round(diff * 2))));
        ground(x, 2, gh);
        arc((x + 1.5) * T, (x + 2.5 + w) * T, (gh - 1) * T - Math.min(H1, T * 2.2), Math.max(2, w + 1));
        ground(x + 2 + w, 2, gh);
        x += 4 + w;
      } else if (roll < 0.62) {                            /* steps up or down */
        const up = gh > 5 && STEP >= 1 && Math.random() < 0.6;
        const dh = up ? -Math.min(STEP, K.ri(1, 2)) : Math.min(8 - gh, K.ri(1, 2));
        if (dh === 0) { ground(x, 3, gh); x += 3; continue; }
        gh = K.clamp(gh + dh, 5, 8);
        const len = K.ri(3, 5);
        ground(x, len, gh);
        candy((x + 1) * T + T / 2, (gh - 1) * T + 6);
        x += len;
      } else if (roll < 0.82) {                            /* planks over a pit */
        const lift = Math.min(STEP, 2);
        const pitW = K.ri(4, 6);
        ground(x, 2, gh);
        const top = gh - lift;
        let c = x + 2;
        const stop = x + 2 + pitW;
        while (c < stop) {
          const len = Math.min(stop - c, K.ri(2, 3));
          for (let i = 0; i < len; i++) set(c + i, top, 2);
          for (let i = 0; i < len; i++) candy((c + i) * T + T / 2, (top - 1) * T + 6);
          c += len + (REACH >= 2 ? K.ri(1, Math.min(2, REACH - 1)) : 0);
        }
        if (Math.random() < 0.3 + diff * 0.4) bat((x + 2 + pitW / 2) * T, (top - 2.4) * T);
        ground(stop, 3, gh);
        x = stop + 3;
      } else {                                             /* a stone block to hop over */
        const len = K.ri(4, 6);
        ground(x, len, gh);
        const bh = Math.max(1, Math.min(STEP, K.ri(1, 2)));
        if (STEP >= 1) {
          const bc = x + K.ri(1, len - 3);
          for (let r = 1; r <= bh; r++) { set(bc, gh - r, 3); set(bc + 1, gh - r, 3); }
          candy((bc + 1) * T, (gh - bh - 1) * T - 6);
        }
        x += len;
      }
    }
    ground(x, COLS - x, gh);
    if (!checkpoint) checkpoint = { x: (x + 2) * T, y: gh * T, on: false };
    goal = { x: (COLS - 5) * T, y: gh * T, w: 54, h: 46 };
    for (let i = 0; i < 4; i++) candy((COLS - 11 + i) * T + T / 2, (gh - 1) * T + 6);
    total = candies.length;
  }

  function placeAt(px, groundY) {
    pl.x = px - PW / 2;
    pl.y = groundY - PH - 1;
    pl.vx = 0; pl.vy = 0;
    pl.onGround = false;
  }
  function startLevel() {
    genLevel(level);
    got = 0;
    spawn = { x: 3 * T, y: 8 * T };
    placeAt(spawn.x, spawn.y);
    camX = 0;
    banner = { text: 'Level ' + level, sub: 'Grab the candy · reach the cauldron', t: 2.2 };
  }

  /* ---------- moving through tiles ---------- */
  function moveX(dx) {
    pl.x += dx;
    const r0 = Math.floor(pl.y / T), r1 = Math.floor((pl.y + PH - 0.01) / T);
    if (dx > 0) {
      const c = Math.floor((pl.x + PW - 0.01) / T);
      for (let r = r0; r <= r1; r++) if (solid(c, r)) { pl.x = c * T - PW; pl.vx = 0; return; }
    } else if (dx < 0) {
      const c = Math.floor(pl.x / T);
      for (let r = r0; r <= r1; r++) if (solid(c, r)) { pl.x = (c + 1) * T; pl.vx = 0; return; }
    }
  }
  function moveY(dy) {
    const bottom0 = pl.y + PH;
    pl.y += dy;
    const c0 = Math.floor(pl.x / T), c1 = Math.floor((pl.x + PW - 0.01) / T);
    if (dy > 0) {
      const r = Math.floor((pl.y + PH - 0.01) / T);
      for (let c = c0; c <= c1; c++) {
        const t = at(c, r);
        if (t === 1 || t === 3 || (t === 2 && bottom0 <= r * T + 0.5)) { pl.y = r * T - PH; pl.vy = 0; pl.onGround = true; return; }
      }
    } else if (dy < 0) {
      const r = Math.floor(pl.y / T);
      for (let c = c0; c <= c1; c++) if (solid(c, r)) { pl.y = (r + 1) * T; pl.vy = 0; return; }
    }
  }

  /* ---------- screen ---------- */
  function view() {
    const s = Math.min(K.H / VH, K.W / 360);
    return { s, vw: K.W / s, oy: (K.H - VH * s) / 2 };
  }
  const pads = () => {
    const r = K.clamp(Math.min(K.W, K.H) * 0.085, 24, 50);
    const y = K.H - Math.max(r + 16, K.H * 0.14);
    return { r, y, left: K.W * 0.0825, right: K.W * 0.2475, jump: K.W * 0.9 };
  };
  function padInput() {
    const o = { l: false, r: false, j: false };
    for (const p of K.ptrs.values()) {
      if (p.used || p.y < K.H * 0.55) continue;
      if (p.x < K.W * 0.165) o.l = true;
      else if (p.x < K.W * 0.33) o.r = true;
      else if (p.x > K.W * 0.72) o.j = true;
    }
    return o;
  }

  function hurt(why) {
    if (dyingT > 0 || inv > 0 || clearT > 0) return;
    dyingT = 0.8;
    pl.vy = -JUMP * 0.55;
    K.shake(9);
    K.flash('#7c3aed', 0.3);
    K.sfx('hurt');
    K.burst(pl.x + PW / 2, pl.y + PH / 2, ['#c084fc', '#fb923c', '#fff'], 18, 200);
    if (why) K.float(pl.x + PW / 2, pl.y - 10, why, '#fecaca', 14);
  }
  function respawn() {
    lives--;
    if (lives <= 0) { K.over('Out of lives'); return; }
    const sp = checkpoint && checkpoint.on ? checkpoint : spawn;
    placeAt(sp.x, sp.y);
    inv = 1.5;
    camX = Math.max(0, pl.x - view().vw * 0.4);
    K.burst(pl.x + PW / 2, pl.y + PH / 2, ['#e9d5ff', '#fff'], 16, 140);
  }
  const hitBox = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  /* ---------- drawing pieces ---------- */
  function drawCandy(g, cd) {
    const y = cd.y + Math.sin(K.t * 3 + cd.ph) * 2.5;
    g.save(); g.translate(cd.x, y);
    if (cd.k === 'corn') {
      g.rotate(Math.sin(K.t * 2 + cd.ph) * 0.2);
      g.fillStyle = '#facc15'; g.beginPath(); g.moveTo(-8, 7); g.lineTo(8, 7); g.lineTo(0, -11); g.closePath(); g.fill();
      g.fillStyle = '#fb923c'; g.beginPath(); g.moveTo(-5.6, 1); g.lineTo(5.6, 1); g.lineTo(2.6, -5); g.lineTo(-2.6, -5); g.closePath(); g.fill();
      g.fillStyle = '#fff7ed'; g.beginPath(); g.moveTo(-2.6, -5); g.lineTo(2.6, -5); g.lineTo(0, -11); g.closePath(); g.fill();
    } else if (cd.k === 'pop') {
      g.strokeStyle = '#f5f5f4'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 2); g.lineTo(0, 14); g.stroke();
      g.fillStyle = cd.c; g.beginPath(); g.arc(0, -3, 8, 0, 7); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath();
      for (let a = 0; a < 9; a += 0.3) { const r = a * 0.8; if (a) g.lineTo(Math.cos(a + K.t) * r, -3 + Math.sin(a + K.t) * r); else g.moveTo(0, -3); }
      g.stroke();
    } else {
      g.rotate(0.3 + Math.sin(K.t * 2 + cd.ph) * 0.2);
      g.fillStyle = cd.c;
      g.beginPath(); g.moveTo(-6, 0); g.lineTo(-12, -5); g.lineTo(-12, 5); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(6, 0); g.lineTo(12, -5); g.lineTo(12, 5); g.closePath(); g.fill();
      g.beginPath(); g.ellipse(0, 0, 8, 6, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(-2, -2, 3, 1.5, 0, 0, 7); g.fill();
    }
    g.restore();
  }
  function drawFoe(g, f) {
    if (f.k === 'pump') {
      const sq = f.dead ? 0.35 : 1 + Math.sin(f.ph * 8) * 0.04;
      const cx = f.x + f.w / 2, by = f.y + f.h;
      g.save(); g.translate(cx, by); g.scale(f.vx < 0 ? -1 : 1, sq);
      g.fillStyle = '#ea580c';
      for (const dx of [-8, 0, 8]) { g.beginPath(); g.ellipse(dx, -14, 9, 14, 0, 0, 7); g.fill(); }
      g.fillStyle = '#f97316'; g.beginPath(); g.ellipse(0, -14, 8, 14, 0, 0, 7); g.fill();
      g.fillStyle = '#15803d'; g.fillRect(-1.5, -31, 3, 6);
      if (!f.dead) {
        g.fillStyle = '#fde047'; g.shadowColor = '#fde047'; g.shadowBlur = 8;
        g.beginPath(); g.moveTo(-9, -18); g.lineTo(-3, -18); g.lineTo(-6, -23); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(3, -18); g.lineTo(9, -18); g.lineTo(6, -23); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(-9, -10); g.lineTo(9, -10); g.lineTo(6, -6); g.lineTo(3, -8); g.lineTo(0, -5); g.lineTo(-3, -8); g.lineTo(-6, -6); g.closePath(); g.fill();
      }
      g.restore();
    } else {
      const flap = Math.sin(f.ph * 18);
      g.save(); g.translate(f.x + f.w / 2, f.y + f.h / 2);
      if (f.dead) g.scale(1, 0.4);
      g.shadowColor = '#c084fc'; g.shadowBlur = 10;
      g.fillStyle = '#4c1d95';
      g.beginPath(); g.moveTo(-4, 0); g.quadraticCurveTo(-12, -10 * flap - 2, -17, -2 * flap); g.quadraticCurveTo(-11, 2, -4, 4); g.fill();
      g.beginPath(); g.moveTo(4, 0); g.quadraticCurveTo(12, -10 * flap - 2, 17, -2 * flap); g.quadraticCurveTo(11, 2, 4, 4); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#7e22ce'; g.beginPath(); g.ellipse(0, 1, 6, 7, 0, 0, 7); g.fill();
      g.beginPath(); g.moveTo(-5, -4); g.lineTo(-4, -9); g.lineTo(-1, -5); g.moveTo(5, -4); g.lineTo(4, -9); g.lineTo(1, -5); g.fill();
      g.fillStyle = '#fca5a5'; g.fillRect(-3.5, -1, 2.2, 2.2); g.fillRect(1.3, -1, 2.2, 2.2);
      g.restore();
    }
  }
  function drawPlayer(g) {
    if (inv > 0 && Math.floor(K.t * 14) % 2) g.globalAlpha = 0.4;
    const x = pl.x + PW / 2, y = pl.y + PH;
    const run = pl.onGround && Math.abs(pl.vx) > 20;
    const bob = run ? Math.abs(Math.sin(K.t * 16)) * 2 : 0;
    g.save(); g.translate(x, y - bob);
    if (dyingT > 0) { g.rotate((0.8 - dyingT) * 10); g.globalAlpha = Math.max(0.2, dyingT); }
    g.scale(pl.face, 1);
    const st = pl.onGround ? 1 : 1.06;
    g.scale(1 / st, st);
    /* legs */
    g.fillStyle = '#1e1b4b';
    const lg = run ? Math.sin(K.t * 16) * 4 : 0;
    g.fillRect(-6 + lg, -8, 4, 8); g.fillRect(2 - lg, -8, 4, 8);
    /* cape */
    g.fillStyle = '#6d28d9';
    g.beginPath(); g.moveTo(-9, -24); g.lineTo(9, -24); g.lineTo(12 - (run ? 3 : 0), -6); g.lineTo(-12 - (run ? 5 : 0), -5); g.closePath(); g.fill();
    /* face */
    g.fillStyle = '#fcd9b6'; g.beginPath(); g.arc(1, -27, 6.5, 0, 7); g.fill();
    g.fillStyle = '#1e1b4b'; g.fillRect(3, -29, 2, 2.5);
    /* witch hat */
    g.fillStyle = '#2e1065';
    g.beginPath(); g.ellipse(0, -32, 11, 2.8, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-6, -33); g.lineTo(6, -33); g.lineTo(-3, -48); g.closePath(); g.fill();
    g.fillStyle = K.accent; g.fillRect(-6, -35, 12, 2.5);
    /* candy bucket */
    g.fillStyle = '#f97316'; g.beginPath(); g.arc(9, -12, 5, 0, 7); g.fill();
    g.fillStyle = '#1c1917'; g.fillRect(7, -14, 1.6, 1.6); g.fillRect(10, -14, 1.6, 1.6); g.fillRect(7.5, -10.5, 4, 1.2);
    g.restore();
    g.globalAlpha = 1;
  }
  function drawBackdrop(g, v) {
    const sky = g.createLinearGradient(0, 0, 0, K.H);
    sky.addColorStop(0, '#12082a'); sky.addColorStop(0.6, '#2e1550'); sky.addColorStop(1, '#4a1d5e');
    g.fillStyle = sky; g.fillRect(0, 0, K.W, K.H);
    for (const s of stars) {
      g.globalAlpha = 0.35 + 0.35 * Math.sin(K.t * 2 + s.p);
      g.fillStyle = '#e9d5ff';
      g.fillRect(s.x * K.W, s.y * K.H, s.s, s.s);
    }
    g.globalAlpha = 1;
    const mr = Math.min(K.W, K.H) * 0.09;
    const mx = K.W * 0.8 - camX * v.s * 0.03, my = K.H * 0.2;
    g.save(); g.shadowColor = '#fef3c7'; g.shadowBlur = mr * 1.2;
    g.fillStyle = '#fef3c7'; g.beginPath(); g.arc(mx, my, mr, 0, 7); g.fill();
    g.restore();
    g.fillStyle = 'rgba(180,160,120,.25)';
    g.beginPath(); g.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.2, 0, 7); g.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.13, 0, 7); g.fill();
    /* far hills, with a house on one of them */
    const base = v.oy + VH * v.s;
    const hills = (par, col, amp, yb, freq) => {
      const off = camX * v.s * par;
      g.fillStyle = col;
      g.beginPath(); g.moveTo(0, K.H);
      for (let x = 0; x <= K.W + 20; x += 20) {
        const wx = (x + off) / v.s;
        g.lineTo(x, yb - (Math.sin(wx * freq) * 0.6 + Math.sin(wx * freq * 2.3 + 1) * 0.4) * amp * v.s - amp * v.s);
      }
      g.lineTo(K.W, K.H); g.closePath(); g.fill();
      return off;
    };
    const off1 = hills(0.15, '#241038', 34, base - 120 * v.s, 0.004);
    const hx = ((1100 * v.s - off1) % (2600 * v.s) + 2600 * v.s) % (2600 * v.s) - 200 * v.s;
    const hy = base - 150 * v.s;
    const S = v.s;
    g.fillStyle = '#1a0b2a';
    g.beginPath();
    g.moveTo(hx - 50 * S, hy + 20 * S); g.lineTo(hx - 50 * S, hy - 20 * S); g.lineTo(hx - 58 * S, hy - 20 * S); g.lineTo(hx - 25 * S, hy - 50 * S);
    g.lineTo(hx - 10 * S, hy - 38 * S); g.lineTo(hx - 10 * S, hy - 70 * S); g.lineTo(hx, hy - 84 * S); g.lineTo(hx + 10 * S, hy - 70 * S);
    g.lineTo(hx + 10 * S, hy - 40 * S); g.lineTo(hx + 30 * S, hy - 56 * S); g.lineTo(hx + 62 * S, hy - 22 * S); g.lineTo(hx + 52 * S, hy - 22 * S); g.lineTo(hx + 52 * S, hy + 20 * S);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(251,191,36,' + (0.55 + 0.25 * Math.sin(K.t * 3)) + ')';
    for (const [dx, dy] of [[-38, -10], [-22, -10], [24, -10], [38, -10], [-4, -58], [-4, -30]]) g.fillRect(hx + dx * S, hy + dy * S, 7 * S, 9 * S);
    hills(0.3, '#1b0b2c', 26, base - 70 * v.s, 0.007);
    /* bare trees */
    const off2 = camX * v.s * 0.5;
    const sp = 230 * v.s;
    const i0 = Math.floor(off2 / sp) - 1;
    g.strokeStyle = '#130820'; g.lineCap = 'round';
    for (let i = i0; i < i0 + K.W / sp + 3; i++) {
      if (hash(i) < 0.35) continue;
      const tx = i * sp - off2 + hash(i + 7) * sp * 0.5;
      const th = (70 + hash(i + 3) * 60) * v.s;
      const ty = base - 40 * v.s;
      g.lineWidth = 6 * v.s;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx, ty - th); g.stroke();
      g.lineWidth = 3 * v.s;
      for (let b = 0; b < 4; b++) {
        const by = ty - th * (0.45 + b * 0.15), side = b % 2 ? 1 : -1, len = (24 + hash(i * 3 + b) * 20) * v.s;
        g.beginPath(); g.moveTo(tx, by); g.lineTo(tx + side * len, by - len * 0.6); g.lineTo(tx + side * len * 1.3, by - len * 0.5); g.stroke();
      }
    }
    /* mist */
    const mist = g.createLinearGradient(0, base - 80 * v.s, 0, base);
    mist.addColorStop(0, 'rgba(167,139,250,0)'); mist.addColorStop(1, 'rgba(167,139,250,.14)');
    g.fillStyle = mist; g.fillRect(0, base - 80 * v.s, K.W, 80 * v.s);
  }
  function drawTiles(g, c0, c1) {
    for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) {
      for (let r = 0; r < ROWS; r++) {
        const t = tiles[r * COLS + c];
        if (!t) continue;
        const x = c * T, y = r * T;
        if (t === 1) {
          const top = at(c, r - 1) !== 1;
          g.fillStyle = (c + r) % 2 ? '#2a1a14' : '#2c1b15';
          g.fillRect(x, y, T + 0.5, T + 0.5);
          g.fillStyle = 'rgba(0,0,0,.25)';
          if (hash(c * 13 + r) > 0.5) g.fillRect(x + 8 + hash(c + r) * 20, y + 12 + hash(c * 7 + r) * 16, 6, 4);
          if (top) {
            g.fillStyle = '#4c1d95'; g.fillRect(x, y, T + 0.5, 9);
            g.fillStyle = '#6d28d9';
            for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(x + i * 8, y + 2); g.lineTo(x + i * 8 + 3, y - 5 - hash(c * 5 + i) * 4); g.lineTo(x + i * 8 + 6, y + 2); g.fill(); }
          }
          if (at(c - 1, r) !== 1 && c > 0) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y, 4, T); }
          if (at(c + 1, r) !== 1 && c < COLS - 1) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + T - 4, y, 4, T); }
        } else if (t === 3) {
          g.fillStyle = '#4b4560'; g.fillRect(x, y, T, T);
          g.fillStyle = '#5d5775'; g.fillRect(x + 2, y + 2, T - 4, T / 2 - 3); g.fillRect(x + 2, y + T / 2 + 1, T / 2 - 3, T / 2 - 3); g.fillRect(x + T / 2 + 1, y + T / 2 + 1, T / 2 - 3, T / 2 - 3);
        } else if (t === 2) {
          g.fillStyle = '#7c4a21'; g.fillRect(x, y, T + 0.5, 12);
          g.fillStyle = '#9a5b2a'; g.fillRect(x, y, T + 0.5, 3);
          g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + T - 2, y, 2, 12);
          if (at(c - 1, r) !== 2) { g.fillStyle = '#5b3416'; g.fillRect(x + 4, y + 12, 4, 10); }
          if (at(c + 1, r) !== 2) { g.fillStyle = '#5b3416'; g.fillRect(x + T - 8, y + 12, 4, 10); }
        }
      }
    }
  }

  return {
    title: 'Candy Collector',
    tagline: 'Run, jump and stomp your way to the cauldron.',
    controls: ['← → or A D: run   ·   Space / ↑ / W: jump (again in the air)', 'Touch: ◀ ▶ bottom-left, jump bottom-right   ·   P: pause'],
    accent: '#f97316',
    bg: '#12082a',
    reset() {
      pl = { x: 0, y: 0, vx: 0, vy: 0, onGround: false, face: 1 };
      lives = LIVES; level = 1; coyote = 0; buffer = 0; airLeft = AIRJ; cut = false; inv = 0; dyingT = 0; clearT = 0;
      showPads = !!K.touch; padJumpWas = false;
      startLevel();
    },
    idle(dt) { if (banner) banner.t = Math.max(0.5, banner.t); },
    down(p) { if (p.type === 'mouse' && p.y > K.H * 0.55) showPads = true; },
    update(dt) {
      if (K.touch) showPads = true;
      inv = Math.max(0, inv - dt);
      if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      for (const f of foes) { f.ph += dt; if (f.dead) f.dead += dt; }
      foes = foes.filter(f => f.dead < 0.5);
      if (dyingT > 0) {
        dyingT -= dt;
        pl.vy += GRAV * 0.6 * dt;
        pl.y += pl.vy * dt;
        if (dyingT <= 0) respawn();
        return;
      }
      if (clearT > 0) {
        clearT -= dt;
        pl.vx *= 0.9;
        if (clearT <= 0) { level++; startLevel(); K.sfx('blip'); }
        return;
      }
      /* input */
      const pad = padInput();
      const ix = K.clamp(K.ax() + (pad.r ? 1 : 0) - (pad.l ? 1 : 0), -1, 1);
      const jumpHeld = K.held('Space', 'ArrowUp', 'KeyW') || pad.j;
      if (K.hit('Space', 'ArrowUp', 'KeyW') || (pad.j && !padJumpWas)) buffer = 0.13;
      padJumpWas = pad.j;
      if (ix) {
        pl.vx += ix * (pl.onGround ? 2400 : 1500) * dt;
        pl.vx = K.clamp(pl.vx, -RUN, RUN);
        pl.face = ix;
      } else {
        const f = (pl.onGround ? 2600 : 700) * dt;
        pl.vx = Math.abs(pl.vx) <= f ? 0 : pl.vx - Math.sign(pl.vx) * f;
      }
      coyote = pl.onGround ? 0.1 : coyote - dt;
      buffer -= dt;
      if (buffer > 0) {
        if (coyote > 0) {
          pl.vy = -JUMP; coyote = 0; buffer = 0; cut = false; pl.onGround = false;
          K.sfx('jump');
          K.burst(pl.x + PW / 2, pl.y + PH, '#c4b5fd', 6, 80, { life: 0.3 });
        } else if (airLeft > 0) {
          pl.vy = -JUMP * 0.9; airLeft--; buffer = 0; cut = false;
          K.sfx('jump');
          K.burst(pl.x + PW / 2, pl.y + PH, ['#fde68a', K.accent], 10, 120, { life: 0.35 });
        }
      }
      if (!jumpHeld && pl.vy < 0 && !cut) { pl.vy *= 0.45; cut = true; }
      pl.vy = Math.min(900, pl.vy + GRAV * dt);
      const wasAir = !pl.onGround;
      const fallV = pl.vy;
      const steps = Math.ceil(Math.max(Math.abs(pl.vx), Math.abs(pl.vy)) * dt / 14) || 1;
      pl.onGround = false;
      for (let i = 0; i < steps; i++) { moveX(pl.vx * dt / steps); moveY(pl.vy * dt / steps); }
      if (pl.onGround) {
        airLeft = AIRJ;
        if (wasAir && fallV > 420) { K.burst(pl.x + PW / 2, pl.y + PH, '#a78bfa', 8, 90, { life: 0.3 }); K.sfx('thud'); }
      }
      if (pl.y > VH + 80) { hurt('Whoops!'); return; }
      /* candy */
      const box = { x: pl.x, y: pl.y, w: PW, h: PH };
      for (const cd of candies) {
        if (cd.got || cd.x < pl.x - 12 || cd.x > pl.x + PW + 12 || cd.y < pl.y - 14 || cd.y > pl.y + PH + 10) continue;
        cd.got = true;
        got++;
        const pts = cd.k === 'pop' ? 25 : 10;
        K.add(pts, cd.x, cd.y - 12, cd.c);
        K.sfx('coin');
        K.burst(cd.x, cd.y, [cd.c, '#fff'], 8, 110, { life: 0.35 });
      }
      /* brambles */
      for (const th of thorns) if (hitBox(box, { x: th.x + 3, y: th.y + 4, w: th.w - 6, h: th.h - 4 })) { hurt('Ouch, thorns!'); return; }
      /* pumpkins and bats */
      for (const f of foes) {
        if (f.dead) continue;
        if (f.k === 'pump') {
          f.x += f.vx * dt;
          const front = f.vx > 0 ? Math.floor((f.x + f.w) / T) : Math.floor(f.x / T);
          const feet = Math.floor((f.y + f.h + 2) / T), body = Math.floor((f.y + f.h / 2) / T);
          if (!solid(front, feet) || solid(front, body)) { f.vx = -f.vx; f.x += f.vx * dt * 2; }
        } else {
          f.x = f.ax + Math.sin(f.ph * f.sp) * f.range;
          f.y = f.ay + Math.sin(f.ph * f.sp * 3) * 16;
        }
        if (!hitBox(box, f)) continue;
        if (pl.vy > 0 && pl.y + PH - pl.vy * dt <= f.y + 8) {
          f.dead = 0.001;
          pl.vy = -JUMP * 0.62; cut = true; airLeft = AIRJ;
          K.add(50, f.x + f.w / 2, f.y - 6, '#fde68a');
          K.sfx('hit');
          K.shake(4);
          K.burst(f.x + f.w / 2, f.y + f.h / 2, f.k === 'pump' ? ['#f97316', '#fde047'] : ['#7e22ce', '#c4b5fd'], 14, 160);
        } else if (inv <= 0) { hurt(f.k === 'pump' ? 'Bonk!' : 'Eek, a bat!'); return; }
      }
      /* the lantern checkpoint and the cauldron */
      if (checkpoint && !checkpoint.on && pl.x + PW / 2 > checkpoint.x) {
        checkpoint.on = true;
        K.sfx('power');
        K.float(checkpoint.x, checkpoint.y - 70, 'Checkpoint!', '#fde68a', 16);
        K.burst(checkpoint.x, checkpoint.y - 56, ['#fde68a', K.accent], 16, 120);
      }
      /* the cauldron's column counts at any height, so a huge jump cannot skip it */
      if (hitBox(box, { x: goal.x, y: -2000, w: goal.w, h: goal.y + 2000 })) {
        clearT = 1.6;
        const bonus = 150 * level + (got === total ? 300 : 0);
        K.add(bonus, goal.x + goal.w / 2, goal.y - goal.h - 20, '#86efac');
        K.sfx('win');
        K.flash('#4ade80', 0.25);
        K.burst(goal.x + goal.w / 2, goal.y - goal.h, ['#4ade80', '#bbf7d0', K.accent, '#fff'], 50, 300, { life: 1, grav: 200 });
        banner = { text: 'Level ' + level + ' clear!', sub: got === total ? 'Every candy! +300' : got + ' of ' + total + ' candy', t: 1.8 };
      }
      /* camera */
      const v = view();
      const want = K.clamp(pl.x + PW / 2 - v.vw * 0.4, 0, Math.max(0, COLS * T - v.vw));
      camX = K.lerp(camX, want, Math.min(1, dt * 7));
    },
    draw(g) {
      const v = view();
      if (COLS * T < v.vw) camX = (COLS * T - v.vw) / 2;
      drawBackdrop(g, v);
      g.save();
      g.translate(0, v.oy);
      g.scale(v.s, v.s);
      g.translate(-camX, 0);
      const c0 = Math.floor(camX / T) - 1, c1 = c0 + Math.ceil(v.vw / T) + 2;
      const inView = x => x > camX - 80 && x < camX + v.vw + 80;
      drawTiles(g, c0, c1);
      /* brambles */
      for (const th of thorns) {
        if (!inView(th.x)) continue;
        g.fillStyle = '#5b2169';
        g.beginPath(); g.moveTo(th.x, th.y + th.h);
        for (let i = 0; i <= 6; i++) g.lineTo(th.x + i * th.w / 6, th.y + (i % 2 ? 0 : th.h * 0.45));
        g.lineTo(th.x + th.w, th.y + th.h); g.closePath(); g.fill();
        g.strokeStyle = '#f0abfc'; g.lineWidth = 1.5;
        for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(th.x + 4 + i * 7, th.y + th.h * 0.6); g.lineTo(th.x + 2 + i * 7, th.y + th.h * 0.6 - 5); g.stroke(); }
      }
      /* checkpoint lantern post */
      if (checkpoint && inView(checkpoint.x)) {
        const cx = checkpoint.x, cy = checkpoint.y;
        g.fillStyle = '#292524'; g.fillRect(cx - 2, cy - 64, 4, 64); g.fillRect(cx - 2, cy - 64, 14, 3);
        g.fillStyle = '#1c1917'; g.fillRect(cx + 4, cy - 61, 12, 14);
        if (checkpoint.on) { g.save(); g.shadowColor = '#fde68a'; g.shadowBlur = 22; }
        g.fillStyle = checkpoint.on ? '#fde68a' : '#57534e'; g.fillRect(cx + 6, cy - 59, 8, 10);
        if (checkpoint.on) g.restore();
      }
      /* the cauldron */
      if (inView(goal.x)) {
        const gx = goal.x + goal.w / 2, gy = goal.y;
        g.save();
        g.shadowColor = '#4ade80'; g.shadowBlur = 30 + Math.sin(K.t * 4) * 8;
        g.fillStyle = '#4ade80'; g.beginPath(); g.ellipse(gx, gy - goal.h + 8, goal.w / 2 - 2, 7, 0, 0, 7); g.fill();
        g.restore();
        g.fillStyle = '#1c1917';
        g.beginPath(); g.moveTo(gx - goal.w / 2, gy - goal.h + 8); g.quadraticCurveTo(gx - goal.w / 2 - 6, gy, gx - 14, gy); g.lineTo(gx + 14, gy);
        g.quadraticCurveTo(gx + goal.w / 2 + 6, gy, gx + goal.w / 2, gy - goal.h + 8); g.closePath(); g.fill();
        g.fillStyle = '#44403c'; g.fillRect(gx - goal.w / 2 - 3, gy - goal.h + 6, goal.w + 6, 5);
        g.fillStyle = '#bbf7d0';
        for (let i = 0; i < 4; i++) {
          const ph = (K.t * 0.8 + i * 0.25) % 1;
          g.globalAlpha = 1 - ph;
          g.beginPath(); g.arc(gx - 14 + i * 9 + Math.sin(K.t * 3 + i) * 3, gy - goal.h + 4 - ph * 40, 2.5 + ph * 2, 0, 7); g.fill();
        }
        g.globalAlpha = 1;
        K.txt(g, 'GOAL', gx, gy - goal.h - 30, 11, '#bbf7d0', 'center', 900);
      }
      for (const cd of candies) if (!cd.got && inView(cd.x)) drawCandy(g, cd);
      for (const f of foes) if (inView(f.x)) drawFoe(g, f);
      if (lives > 0) drawPlayer(g);
      K.fx(g);
      /* above the top of the screen: show where */
      if (pl.y + PH < 0 && lives > 0) {
        g.fillStyle = K.accent;
        const ax = pl.x + PW / 2;
        g.beginPath(); g.moveTo(ax, 4); g.lineTo(ax - 7, 16); g.lineTo(ax + 7, 16); g.closePath(); g.fill();
      }
      g.restore();
      if (banner && K.state === 'play') {
        g.globalAlpha = Math.min(1, banner.t * 2);
        g.save(); g.shadowColor = K.accent; g.shadowBlur = 18;
        K.txt(g, banner.text, K.W / 2, K.H * 0.32, K.clamp(K.W / 18, 20, 40), K.accent, 'center', 900);
        g.restore();
        K.txt(g, banner.sub, K.W / 2, K.H * 0.32 + K.clamp(K.W / 18, 20, 40) * 0.9, K.clamp(K.W / 40, 12, 17), '#f5f3ff', 'center', 700);
        g.globalAlpha = 1;
      }
    },
    hud(g) {
      K.pill(g, 'Score ' + K.score, 12, 12, '#fff');
      K.pill(g, 'Candy ' + got + '/' + total, 12, 46, '#fde68a');
      K.pill(g, 'Level ' + level, K.W / 2, 12, K.accent, 'center');
      K.pill(g, '♥ '.repeat(Math.min(lives, 6)).trim() + (lives > 6 ? ' +' + (lives - 6) : ''), K.W - 12, 12, '#fb7185', 'right');
      if (showPads && K.state === 'play') {
        const pd = pads();
        const pad = padInput();
        const btn = (x, on, draw) => {
          g.fillStyle = on ? 'rgba(249,115,22,.45)' : 'rgba(255,255,255,.14)';
          g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
          g.beginPath(); g.arc(x, pd.y, pd.r, 0, 7); g.fill(); g.stroke();
          g.fillStyle = '#fff'; draw(x, pd.y, pd.r * 0.4);
        };
        const tri = (x, y, s, d) => { g.beginPath(); g.moveTo(x + d * s, y); g.lineTo(x - d * s * 0.7, y - s); g.lineTo(x - d * s * 0.7, y + s); g.closePath(); g.fill(); };
        btn(pd.left, pad.l, (x, y, s) => tri(x, y, s, -1));
        btn(pd.right, pad.r, (x, y, s) => tri(x, y, s, 1));
        btn(pd.jump, pad.j, (x, y, s) => { g.beginPath(); g.moveTo(x, y - s * 1.1); g.lineTo(x + s, y + s * 0.6); g.lineTo(x - s, y + s * 0.6); g.closePath(); g.fill(); });
      }
    },
    info() {
      const ahead = foes.filter(f => !f.dead && f.x > pl.x).sort((p, q) => p.x - q.x)[0];
      return { x: pl.x, y: pl.y, onGround: pl.onGround, candy: got, total, level, lives, goalX: goal.x, checkpoint: !!(checkpoint && checkpoint.on), cols: COLS,
        foes: foes.filter(f => !f.dead).length, nextFoe: ahead ? { k: ahead.k, x: Math.round(ahead.x) } : null };
    },
  };
}

export default {
  id: 'candy-collector',
  name: 'Candy Collector',
  icon: 'star',
  genre: 'platformer',
  desc: 'Trick-or-treat through a moonlit platformer: grab every candy, stomp pumpkins and bats, and reach the bubbling cauldron. Each level is longer and harder.',
  controls: '← → or A/D to run · Space, ↑ or W to jump (and jump again in the air) · on-screen buttons on touch screens',
  season: 'halloween',
  colors: ['#12082a', '#f97316'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Candy Collector' },
    { k: 'runSpeed', label: 'Run speed', type: 'range', min: 150, max: 400, step: 10, value: 250 },
    { k: 'jump', label: 'Jump power', type: 'range', min: 400, max: 900, step: 10, value: 620 },
    { k: 'gravity', label: 'Gravity', type: 'range', min: 900, max: 2500, step: 50, value: 1700 },
    { k: 'airJumps', label: 'Extra jumps in the air', type: 'range', min: 0, max: 2, step: 1, value: 1 },
    { k: 'lives', label: 'Lives', type: 'range', min: 1, max: 9, step: 1, value: 3 },
    { k: 'levelLength', label: 'Level length (screens)', type: 'range', min: 3, max: 12, step: 1, value: 5 },
    { k: 'accent', label: 'Accent colour', type: 'color', value: '#f97316' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  /* how Forge's test suite checks that the game reacts to input (see neon-breaker.js);
     drag.at is where to press and hold, as fractions of the screen: the ▶ button */
  test: { key: 'ArrowRight', ms: 400, field: 'x', dir: 1, drag: { dx: 0, dy: 0, field: 'x', dir: 1, at: [0.24, 0.86] } },
  game,
  art(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#12082a'); sky.addColorStop(1, '#4a1d5e');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fef3c7'; g.shadowColor = '#fef3c7'; g.shadowBlur = 24;
    g.beginPath(); g.arc(w * 0.82, h * 0.22, 18, 0, 7); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#241038';
    g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.62); g.quadraticCurveTo(w * 0.3, h * 0.45, w * 0.6, h * 0.62); g.quadraticCurveTo(w * 0.85, h * 0.72, w, h * 0.58); g.lineTo(w, h); g.fill();
    g.fillStyle = '#2f1d16'; g.fillRect(0, h * 0.8, w * 0.42, h * 0.2); g.fillRect(w * 0.56, h * 0.8, w * 0.44, h * 0.2);
    g.fillStyle = '#4c1d95'; g.fillRect(0, h * 0.8, w * 0.42, 6); g.fillRect(w * 0.56, h * 0.8, w * 0.44, 6);
    g.fillStyle = '#7c4a21'; g.fillRect(w * 0.43, h * 0.6, w * 0.12, 8);
    const corn = (x, y) => {
      g.fillStyle = '#facc15'; g.beginPath(); g.moveTo(x - 6, y + 5); g.lineTo(x + 6, y + 5); g.lineTo(x, y - 9); g.closePath(); g.fill();
      g.fillStyle = '#fb923c'; g.fillRect(x - 4, y - 3, 8, 4);
    };
    for (let i = 0; i < 5; i++) corn(w * 0.3 + i * 22, h * 0.5 - Math.sin(i / 4 * Math.PI) * 22);
    g.fillStyle = '#f97316';
    for (const dx of [-7, 0, 7]) { g.beginPath(); g.ellipse(w * 0.78 + dx, h * 0.8 - 12, 8, 12, 0, 0, 7); g.fill(); }
    g.fillStyle = '#fde047';
    g.beginPath(); g.moveTo(w * 0.78 - 7, h * 0.8 - 15); g.lineTo(w * 0.78 - 2, h * 0.8 - 15); g.lineTo(w * 0.78 - 4.5, h * 0.8 - 20); g.fill();
    g.beginPath(); g.moveTo(w * 0.78 + 2, h * 0.8 - 15); g.lineTo(w * 0.78 + 7, h * 0.8 - 15); g.lineTo(w * 0.78 + 4.5, h * 0.8 - 20); g.fill();
    const px = w * 0.16, py = h * 0.8;
    g.fillStyle = '#6d28d9'; g.beginPath(); g.moveTo(px - 8, py - 22); g.lineTo(px + 8, py - 22); g.lineTo(px + 10, py - 4); g.lineTo(px - 12, py - 4); g.fill();
    g.fillStyle = '#fcd9b6'; g.beginPath(); g.arc(px + 1, py - 26, 6, 0, 7); g.fill();
    g.fillStyle = '#2e1065'; g.beginPath(); g.moveTo(px - 9, py - 31); g.lineTo(px + 9, py - 31); g.lineTo(px - 3, py - 46); g.fill();
    g.fillStyle = '#f97316'; g.beginPath(); g.arc(px + 10, py - 11, 5, 0, 7); g.fill();
  },
};
