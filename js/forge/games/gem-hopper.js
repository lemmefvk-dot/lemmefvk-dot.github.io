/* Gem Hopper — a Static Forge template (original code and art).
   A one-screen-at-a-time platformer: each room has gems to collect and
   a door that opens once the last one is yours. Jump between ledges,
   hop over spikes, stomp the wandering blobs and watch the pits. Five
   rooms, three lives; clear the last door to win. Every ledge is within
   a normal jump, and the jump height and gravity are settings.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  const RUN = K.clamp(N(P.runSpeed, 190), 80, 400);
  const JUMP = K.clamp(N(P.jump, 560), 380, 900);
  const GRAV = K.clamp(N(P.gravity, 1500), 800, 3000);
  const LIVES = Math.round(K.clamp(N(P.lives, 3), 1, 9));
  const ROOMS_N = Math.round(K.clamp(N(P.rooms, 5), 1, 5));
  const FIRST = Math.min(ROOMS_N - 1, Math.round(K.clamp(N(P.startRoom, 1), 1, 5)) - 1);
  const T = 32, COLS = 20, ROWS = 12, VW = COLS * T, VH = ROWS * T;
  /* # solid   . air   g gem   s spikes   P start   E door   b blob (walks the floor) */
  const ROOMS = [
    ['....................', '....................', '....................', '....................', '....................', '....................',
     '....................', '....................', '....................', '.P....g....g....g.E.', '####################', '####################'],
    ['....................', '....................', '....................', '..g..............g..', '..###..........###..', '....................',
     '....g..........g....', '...####......####...', '....................', '..P......ss.......E.', '####################', '####################'],
    ['....................', '....................', '....................', '....................', '...g...........g....', '..####.......####...',
     '....................', '.......g.....g......', '......####..####....', '.P..b.........b...E.', '####################', '####################'],
    ['....................', '....................', '....................', '....................', '....................', '....................',
     '.......g.....g......', '......###...###.....', '....................', '.P.ss....g.......g.E', '######...###...#####', '######...###...#####'],
    ['....................', '....................', '.g.......gg.......g.', '.###....####....###.', '....................', '....................',
     '....###......###....', '....................', '....................', '.P...b.ss....b..s.E.', '####################', '####################'],
  ];
  const NAMES = ['First steps', 'Up and over', 'Wanderers', 'Pit stops', 'The long way'];
  const PW = 20, PH = 28;

  let room, grid, gems, blobs, exit, start, p, lives, inv, roomT, gemsLeft, clearT, prevJump, coyote, buffer, lay, left, right, jumpHeld, shake0;

  const tile = (c, r) => (c < 0 || c >= COLS ? '#' : r < 0 ? '.' : r >= ROWS ? '.' : grid[r][c]);
  const solid = (c, r) => tile(c, r) === '#';
  const hitsSolid = (x, y, w, h) => {
    for (let r = Math.floor(y / T); r <= Math.floor((y + h - 0.01) / T); r++)
      for (let c = Math.floor(x / T); c <= Math.floor((x + w - 0.01) / T); c++) if (solid(c, r)) return true;
    return false;
  };
  function load(i) {
    room = i;
    grid = ROOMS[i].map(r => r.split(''));
    gems = []; blobs = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const ch = grid[r][c];
      if (ch === 'g') gems.push({ x: c * T + T / 2, y: r * T + T / 2, got: false });
      else if (ch === 'P') start = { x: c * T + (T - PW) / 2, y: (r + 1) * T - PH };
      else if (ch === 'E') exit = { x: c * T + T / 2, y: r * T + T / 2 };
      else if (ch === 'b') blobs.push({ x: c * T + 4, y: (r + 1) * T - 20, w: 24, h: 20, dir: 1, dead: false });
      if (ch === 'g' || ch === 'P' || ch === 'E' || ch === 'b') grid[r][c] = '.';
    }
    gemsLeft = gems.length;
    roomT = 0; clearT = 0;
    respawn();
  }
  function respawn() {
    p = { x: start.x, y: start.y, vx: 0, vy: 0, on: false, face: 1 };
    inv = 1.4; coyote = 0; buffer = 0;
  }
  function hurt(why) {
    if (inv > 0 || K.state !== 'play') return;
    lives--;
    K.shake(9); K.flash('#ef4444', 0.28); K.sfx('hurt');
    K.burst(p.x + PW / 2, p.y + PH / 2, ['#fde68a', '#f87171', '#fff'], 22, 240, { life: 0.5 });
    if (lives <= 0) { K.over(why === 'fall' ? 'Lost in the pit' : 'Out of lives'); return; }
    respawn();
  }
  function geometry() {
    const f = K.fit(VW, VH);
    lay = f;
    const B = K.clamp(Math.min(K.W, K.H) * 0.09, 28, 46);
    lay.btn = {
      r: B,
      left: { x: K.W * 0.1, y: K.H * 0.86 }, right: { x: K.W * 0.24, y: K.H * 0.86 }, jump: { x: K.W * 0.9, y: K.H * 0.86 },
    };
  }
  function pads() {
    left = right = jumpHeld = false;
    const b = lay.btn;
    for (const q of K.ptrs.values()) {
      if (K.dist(q.x, q.y, b.left.x, b.left.y) < b.r * 1.5) left = true;
      if (K.dist(q.x, q.y, b.right.x, b.right.y) < b.r * 1.5) right = true;
      if (K.dist(q.x, q.y, b.jump.x, b.jump.y) < b.r * 1.7) jumpHeld = true;
    }
  }

  return {
    title: 'Gem Hopper',
    tagline: 'Collect every gem, then reach the door.',
    controls: ['Left / Right or A / D: run   ·   Space, Up or W: jump', 'Touch: the round buttons at the bottom   ·   P: pause', 'Land on blobs to stomp them; spikes and pits cost a life'],
    accent: '#34d399',
    bg: '#10223a',
    resize() { geometry(); },
    reset() { geometry(); lives = LIVES; shake0 = 0; pads(); prevJump = jumpHeld; load(FIRST); },
    update(dt) {
      pads();
      roomT += dt;
      inv = Math.max(0, inv - dt);
      if (clearT > 0) {
        clearT -= dt;
        if (clearT <= 0) { load(room + 1); }
        return;
      }
      /* running */
      const dir = (K.held('ArrowRight', 'KeyD') || right ? 1 : 0) - (K.held('ArrowLeft', 'KeyA') || left ? 1 : 0);
      p.vx = dir * RUN;
      if (dir) p.face = dir;
      /* jumping, with a little forgiveness at ledges and just before landing */
      const jumpNow = K.held('Space', 'ArrowUp', 'KeyW') || jumpHeld;
      /* a fresh press. The one that started the game is not also a jump: that key press is cleared
         as the game begins, and a finger already on the button counts as held since then */
      if (K.hit('Space', 'ArrowUp', 'KeyW') || (jumpHeld && !prevJump)) buffer = 0.12;
      buffer = Math.max(0, buffer - dt);
      coyote = p.on ? 0.09 : Math.max(0, coyote - dt);
      if (buffer > 0 && coyote > 0) { p.vy = -JUMP; p.on = false; coyote = 0; buffer = 0; K.sfx('jump'); }
      if (!jumpNow && p.vy < -JUMP * 0.4) p.vy = -JUMP * 0.4;
      prevJump = jumpHeld;
      p.vy = Math.min(900, p.vy + GRAV * dt);
      /* move one axis at a time against the tiles */
      p.x += p.vx * dt;
      if (hitsSolid(p.x, p.y, PW, PH)) { p.x = p.vx > 0 ? Math.floor((p.x + PW) / T) * T - PW - 0.01 : Math.floor(p.x / T + 1) * T + 0.01; }
      p.y += p.vy * dt;
      p.on = false;
      if (hitsSolid(p.x, p.y, PW, PH)) {
        if (p.vy > 0) { p.y = Math.floor((p.y + PH) / T) * T - PH - 0.01; p.on = true; }
        else p.y = Math.floor(p.y / T + 1) * T + 0.01;
        p.vy = 0;
      }
      p.x = K.clamp(p.x, 0, VW - PW);
      if (p.y > VH + 40) { if (inv > 0) respawn(); else hurt('fall'); if (K.state !== 'play') return; }
      /* spikes: the lower half of the tile */
      for (let r = Math.floor(p.y / T); r <= Math.floor((p.y + PH - 1) / T); r++)
        for (let c = Math.floor(p.x / T); c <= Math.floor((p.x + PW - 1) / T); c++) {
          if (tile(c, r) === 's' && p.y + PH > r * T + 14 && p.x + PW > c * T + 4 && p.x < c * T + T - 4) { hurt('spikes'); if (K.state !== 'play') return; }
        }
      /* gems */
      for (const gm of gems) {
        if (!gm.got && Math.abs(p.x + PW / 2 - gm.x) < 17 && Math.abs(p.y + PH / 2 - gm.y) < 20) {
          gm.got = true; gemsLeft--;
          K.add(10, gm.x, gm.y - 14, '#a7f3d0'); K.sfx('coin');
          K.burst(gm.x, gm.y, ['#a7f3d0', '#fff'], 8, 120, { life: 0.35 });
        }
      }
      /* blobs walk until a wall, a ledge or spikes, then turn around */
      for (const b of blobs) {
        if (b.dead) continue;
        b.x += b.dir * 46 * dt;
        const ahead = b.dir > 0 ? b.x + b.w : b.x;
        const c = Math.floor(ahead / T), r = Math.floor((b.y + b.h - 1) / T);
        if (solid(c, r) || tile(c, r) === 's' || !solid(c, r + 1) || ahead < 0 || ahead > VW) { b.dir = -b.dir; b.x += b.dir * 46 * dt * 2; }
        if (p.x + PW > b.x + 2 && p.x < b.x + b.w - 2 && p.y + PH > b.y && p.y < b.y + b.h) {
          if (p.vy > 60 && p.y + PH - b.y < 16) {
            b.dead = true; p.vy = -JUMP * 0.62; p.on = false;
            K.add(50, b.x + b.w / 2, b.y - 10, '#fde68a'); K.sfx('hit');
            K.burst(b.x + b.w / 2, b.y + 10, ['#86efac', '#fff'], 14, 200, { life: 0.4 });
          } else { hurt('blob'); if (K.state !== 'play') return; }
        }
      }
      /* the door */
      if (gemsLeft === 0 && Math.abs(p.x + PW / 2 - exit.x) < 16 && Math.abs(p.y + PH / 2 - exit.y) < 22) {
        const bonus = 100 + Math.round(Math.max(0, 30 - roomT) * 5);
        K.add(bonus, exit.x, exit.y - 30, '#fde68a'); K.sfx('power'); K.flash('#fff', 0.2);
        if (room + 1 >= ROOMS_N) { K.win('All rooms cleared!'); return; }
        clearT = 1.0;
      }
    },
    draw(g) {
      if (!lay) geometry();
      const { s, ox, oy } = lay;
      const sky = g.createLinearGradient(0, 0, 0, K.H);
      sky.addColorStop(0, '#10223a'); sky.addColorStop(1, '#264b6e');
      g.fillStyle = sky; g.fillRect(0, 0, K.W, K.H);
      g.save();
      g.translate(ox, oy); g.scale(s, s);
      g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(0, 0, VW, VH);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const ch = grid[r][c];
        if (ch === '#') {
          const up = !solid(c, r - 1);
          g.fillStyle = '#3b5b4a'; g.fillRect(c * T, r * T, T, T);
          g.fillStyle = '#2b4437'; g.fillRect(c * T + 2, r * T + 2, T - 4, T - 4);
          if (up) { g.fillStyle = '#4ade80'; g.fillRect(c * T, r * T, T, 6); g.fillStyle = '#86efac'; g.fillRect(c * T, r * T, T, 2); }
        } else if (ch === 's') {
          g.fillStyle = '#e5e7eb';
          for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(c * T + k * 10 + 1, (r + 1) * T); g.lineTo(c * T + k * 10 + 6, (r + 1) * T - 16); g.lineTo(c * T + k * 10 + 11, (r + 1) * T); g.fill(); }
        }
      }
      /* the door: dim while gems remain, bright and open at the end */
      const open = gemsLeft === 0;
      g.fillStyle = open ? '#fde68a' : '#475569';
      K.rr(g, exit.x - 14, exit.y - 20, 28, 36, 9); g.fill();
      g.fillStyle = open ? '#fff7d6' : '#1e293b';
      K.rr(g, exit.x - 9, exit.y - 15, 18, 31, 6); g.fill();
      if (open) { g.fillStyle = 'rgba(253,230,138,.25)'; g.beginPath(); g.arc(exit.x, exit.y, 26 + 3 * Math.sin(K.t * 5), 0, 7); g.fill(); }
      for (const gm of gems) {
        if (gm.got) continue;
        const bob = Math.sin(K.t * 3 + gm.x) * 2.5;
        g.save(); g.translate(gm.x, gm.y + bob);
        g.fillStyle = '#34d399'; g.beginPath(); g.moveTo(0, -11); g.lineTo(10, 0); g.lineTo(0, 11); g.lineTo(-10, 0); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(0, -11); g.lineTo(-10, 0); g.lineTo(0, -2); g.closePath(); g.fill();
        g.restore();
      }
      for (const b of blobs) {
        if (b.dead) continue;
        const sq = 1 + 0.06 * Math.sin(K.t * 8 + b.x);
        g.fillStyle = '#a3e635';
        g.beginPath(); g.ellipse(b.x + b.w / 2, b.y + b.h, b.w / 2 * sq, b.h * 0.95 / sq, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#fff'; g.fillRect(b.x + 6, b.y + 6, 4, 5); g.fillRect(b.x + 14, b.y + 6, 4, 5);
        g.fillStyle = '#111827'; g.fillRect(b.x + 7 + b.dir, b.y + 8, 2, 3); g.fillRect(b.x + 15 + b.dir, b.y + 8, 2, 3);
      }
      if (inv <= 0 || Math.floor(K.t * 14) % 2) {
        g.save(); g.translate(p.x + PW / 2, p.y + PH);
        g.fillStyle = K.accent; K.rr(g, -PW / 2, -PH, PW, PH - 4, 7); g.fill();
        g.fillStyle = '#0f172a'; K.rr(g, -PW / 2 + 2 + (p.face > 0 ? 6 : 0), -PH + 6, 10, 8, 3); g.fill();
        g.fillStyle = '#fff'; g.fillRect(-PW / 2 + 5 + (p.face > 0 ? 6 : 0), -PH + 8, 3, 4);
        g.fillStyle = '#065f46'; g.fillRect(-PW / 2 + 2, -4, 6, 4); g.fillRect(PW / 2 - 8, -4, 6, 4);
        g.restore();
      }
      K.fx(g);
      g.restore();
      /* touch buttons */
      const b = lay.btn;
      g.globalAlpha = K.touch ? 0.6 : 0.22;
      const btn = (q, label, on) => {
        g.fillStyle = on ? '#fff' : 'rgba(255,255,255,.28)';
        g.beginPath(); g.arc(q.x, q.y, b.r, 0, 7); g.fill();
        K.txt(g, label, q.x, q.y + 1, b.r * 0.9, '#0f172a', 'center', 900);
      };
      btn(b.left, '<', left); btn(b.right, '>', right); btn(b.jump, '^', jumpHeld);
      g.globalAlpha = 1;
    },
    hud(g) {
      K.pill(g, 'Room ' + (room + 1) + ' / ' + ROOMS_N + ' · ' + NAMES[room], 12, 12, '#fff');
      K.pill(g, 'Score ' + K.score, K.W - 12, 12, '#fff', 'right');
      K.pill(g, 'Lives ' + lives, 12, 46, '#fda4af');
      K.pill(g, gemsLeft ? 'Gems left ' + gemsLeft : 'Door open!', K.W - 12, 46, gemsLeft ? '#a7f3d0' : '#fde68a', 'right');
      if (clearT > 0) K.txt(g, 'Room cleared!', K.W / 2, K.H * 0.4, 32, '#fde68a', 'center', 900);
    },
    info() {
      return {
        x: p.x, y: p.y, vy: p.vy, on: p.on, room: room + 1, lives, gemsLeft, inv,
        gems: gems.filter(q => !q.got).map(q => ({ x: q.x, y: q.y })),
        blobs: blobs.filter(b => !b.dead).map(b => ({ x: b.x, y: b.y })),
        exit: { x: exit.x, y: exit.y, open: gemsLeft === 0 },
      };
    },
  };
}

export default {
  id: 'gem-hopper',
  name: 'Gem Hopper',
  icon: 'diamond',
  genre: 'platformer',
  desc: 'A room-by-room platformer: hop between ledges, collect every gem, stomp wandering blobs, dodge spikes and pits, then reach the door. Five rooms and three lives.',
  controls: 'Arrows/A D run, Space/Up/W jump · touch buttons on screen · P pauses',
  season: null,
  colors: ['#10223a', '#34d399'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Gem Hopper' },
    { k: 'rooms', label: 'Rooms to clear', type: 'range', min: 1, max: 5, step: 1, value: 5 },
    { k: 'startRoom', label: 'Start in room', type: 'range', min: 1, max: 5, step: 1, value: 1 },
    { k: 'lives', label: 'Lives', type: 'range', min: 1, max: 9, step: 1, value: 3 },
    { k: 'runSpeed', label: 'Run speed', type: 'range', min: 100, max: 320, step: 10, value: 190 },
    { k: 'jump', label: 'Jump strength', type: 'range', min: 450, max: 760, step: 10, value: 560 },
    { k: 'gravity', label: 'Gravity', type: 'range', min: 1000, max: 2400, step: 50, value: 1500 },
    { k: 'accent', label: 'Hero colour', type: 'color', value: '#34d399' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'ArrowRight', ms: 400, field: 'x', dir: 1, drag: { dx: 0, dy: 0, field: 'x', dir: 1, at: [0.24, 0.86] } },
  game,
  art(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#10223a'); sky.addColorStop(1, '#264b6e');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const slab = (x, y, ww) => { g.fillStyle = '#2b4437'; g.fillRect(x, y, ww, 16); g.fillStyle = '#4ade80'; g.fillRect(x, y, ww, 5); };
    slab(0, h - 24, w); slab(30, h - 78, 90); slab(190, h - 112, 100); slab(120, h - 60, 50);
    const gem = (x, y) => { g.fillStyle = '#34d399'; g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x + 9, y); g.lineTo(x, y + 10); g.lineTo(x - 9, y); g.closePath(); g.fill(); };
    gem(70, h - 98); gem(240, h - 132); gem(150, h - 80); gem(270, h - 44);
    g.fillStyle = '#34d399'; g.beginPath(); g.roundRect(45, h - 50, 20, 28, 7); g.fill();
    g.fillStyle = '#0f172a'; g.beginPath(); g.roundRect(53, h - 44, 10, 8, 3); g.fill();
    g.fillStyle = '#a3e635'; g.beginPath(); g.ellipse(210, h - 24, 12, 11, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#e5e7eb';
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(240 + k * 10, h - 24); g.lineTo(245 + k * 10, h - 38); g.lineTo(250 + k * 10, h - 24); g.fill(); }
  },
};
