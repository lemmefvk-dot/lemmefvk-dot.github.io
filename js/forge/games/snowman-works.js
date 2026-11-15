/* Snowman Works — a Static Forge template (original code and art).
   A winter clicker: pack snow by tapping, clicking or holding Space, then
   spend it on warm mittens, helpers and a snow cannon so more snow packs
   itself. Score is all the snow you packed before the clock runs out.
   game() is copied into the game file as text: it may only use K and P.
   The round length is a setting; the shop prices are plain numbers below. */
function game(K, P) {
  const N = K.num;
  const ROUND = Math.max(20, N(P.seconds, 90));
  const SHOP = [
    { id: 'mitts', key: 'Digit1', name: 'Warm mittens', desc: '+1 snow per tap', cost: 12, grow: 1.6 },
    { id: 'helper', key: 'Digit2', name: 'Snow helper', desc: '+1 snow every second', cost: 30, grow: 1.5 },
    { id: 'cannon', key: 'Digit3', name: 'Snow cannon', desc: '+6 snow every second', cost: 150, grow: 1.6 },
  ];
  let snow, total, power, rate, left, bought, holdT, pile, boxes, taps;

  const cost = it => Math.ceil(it.cost * Math.pow(it.grow, bought[it.id]));
  function layout() {
    const w = Math.min(K.W - 24, 560), x0 = (K.W - w) / 2, gap = 10, bw = (w - gap * 2) / 3, bh = Math.min(96, K.H * 0.2);
    boxes = SHOP.map((it, i) => ({ it, x: x0 + i * (bw + gap), y: K.H - bh - 14, w: bw, h: bh }));
  }
  function pack(n, x, y) {
    snow += n; total += n; K.score = Math.floor(total);
    pile = Math.min(1.2, pile + 0.18);
    if (x != null) K.burst(x, y, ['#ffffff', '#e0f2fe', '#bae6fd'], 6, 150, { life: 0.4, size: 3 });
    K.sfx('blip');
  }
  function buy(it) {
    const c = cost(it);
    if (snow < c) { K.float(K.W / 2, K.H * 0.5, 'Not enough snow', '#fca5a5', 16); K.sfx('thud'); return; }
    snow -= c; bought[it.id]++;
    if (it.id === 'mitts') power += 1; else if (it.id === 'helper') rate += 1; else rate += 6;
    K.flash('#e0f2fe', 0.2); K.sfx('power');
    K.float(K.W / 2, K.H * 0.4, it.name + '!', '#fde68a', 22);
  }
  const pileXY = () => ({ x: K.W / 2, y: K.H * 0.46 });

  function drawSnowman(g, cx, cy, s, n) {
    const body = (x, y, r) => {
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#bfdbfe');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    };
    body(cx, cy + s * 0.55, s * 0.62);
    if (n >= 1) body(cx, cy - s * 0.1, s * 0.46);
    if (n >= 2) body(cx, cy - s * 0.72, s * 0.32);
    if (n >= 2) {
      g.fillStyle = '#0f172a'; g.beginPath(); g.arc(cx - s * 0.11, cy - s * 0.78, s * 0.04, 0, 7); g.arc(cx + s * 0.11, cy - s * 0.78, s * 0.04, 0, 7); g.fill();
      g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(cx, cy - s * 0.72); g.lineTo(cx + s * 0.32, cy - s * 0.68); g.lineTo(cx, cy - s * 0.64); g.closePath(); g.fill();
    }
    if (n >= 3) { g.fillStyle = '#1e293b'; g.fillRect(cx - s * 0.26, cy - s * 1.1, s * 0.52, s * 0.08); g.fillRect(cx - s * 0.17, cy - s * 1.32, s * 0.34, s * 0.24); }
    if (n >= 4) { g.fillStyle = K.accent; g.fillRect(cx - s * 0.3, cy - s * 0.5, s * 0.6, s * 0.09); }
    if (n >= 1) { g.fillStyle = '#0f172a'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(cx, cy - s * 0.2 + i * s * 0.2, s * 0.035, 0, 7); g.fill(); } }
  }

  return {
    title: 'Snowman Works',
    tagline: 'Pack snow, buy helpers, bury the village in snowmen.',
    controls: ['Click, tap or hold Space: pack snow', '1 2 3 or click a card: buy   ·   P: pause'],
    accent: '#ef4444',
    bg: '#1e3a5f',
    resize() { layout(); },
    reset() {
      layout();
      snow = 0; total = 0; power = 1; rate = 0; left = ROUND; holdT = 0; pile = 0; taps = 0;
      bought = { mitts: 0, helper: 0, cannon: 0 };
    },
    idle(dt) { pile = Math.max(0, pile - dt * 2); },
    update(dt) {
      left -= dt;
      pile = Math.max(0, pile - dt * 2);
      if (rate) { const before = Math.floor(total); snow += rate * dt; total += rate * dt; K.score = Math.floor(total); if (Math.floor(total) > before && Math.random() < 0.3) K.burst(K.rnd(40, K.W - 40), K.rnd(0, K.H * 0.3), ['#fff'], 1, 30, { life: 1.2, size: 3, grav: 120 }); }
      if (K.held('Space', 'Enter')) { holdT += dt; while (holdT >= 0.125) { holdT -= 0.125; pack(power, pileXY().x + K.rnd(-30, 30), pileXY().y - 20); } } else holdT = 0;
      SHOP.forEach(it => { if (K.hit(it.key, 'Numpad' + it.key.slice(-1))) buy(it); });
      if (left <= 0) { left = 0; K.over('Time is up!'); }
    },
    down(p) {
      for (const b of boxes) if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { buy(b.it); p.used = true; return; }
      taps++;
      pack(power, p.x, p.y);
      p.used = true;
    },
    draw(g) {
      const sky = g.createLinearGradient(0, 0, 0, K.H);
      sky.addColorStop(0, '#0f2744'); sky.addColorStop(0.6, '#2b5d8e'); sky.addColorStop(1, '#bfdbfe');
      g.fillStyle = sky; g.fillRect(0, 0, K.W, K.H);
      g.fillStyle = '#e0f2fe'; g.beginPath(); g.moveTo(0, K.H * 0.62);
      for (let x = 0; x <= K.W + 20; x += 20) g.lineTo(x, K.H * 0.62 + Math.sin(x / 70) * 14);
      g.lineTo(K.W, K.H); g.lineTo(0, K.H); g.closePath(); g.fill();
      const { x, y } = pileXY();
      const s = Math.min(K.W, K.H) * 0.22 * (1 + pile * 0.12);
      const n = Math.min(4, Math.floor((total || 0) / 40));
      drawSnowman(g, x, y, s, n);
      boxes.forEach(b => {
        const c = cost(b.it), can = snow >= c;
        g.fillStyle = can ? 'rgba(15,39,68,.88)' : 'rgba(15,39,68,.55)';
        K.rr(g, b.x, b.y, b.w, b.h, 12); g.fill();
        g.strokeStyle = can ? '#fde68a' : 'rgba(255,255,255,.25)'; g.lineWidth = can ? 2 : 1; g.stroke();
        K.txt(g, (SHOP.indexOf(b.it) + 1) + '  ' + b.it.name, b.x + b.w / 2, b.y + b.h * 0.26, Math.min(15, b.w / 10), '#fff', 'center', 800);
        K.txt(g, b.it.desc, b.x + b.w / 2, b.y + b.h * 0.5, Math.min(12, b.w / 13), 'rgba(226,232,255,.8)', 'center', 500);
        K.txt(g, c + ' snow  ·  owned ' + bought[b.it.id], b.x + b.w / 2, b.y + b.h * 0.76, Math.min(13, b.w / 11), can ? '#fde68a' : '#94a3b8', 'center', 700);
      });
      K.fx(g);
    },
    hud(g) {
      K.pill(g, 'Packed ' + K.score, 12, 12, '#fff');
      K.pill(g, Math.ceil(left) + ' s', K.W - 12, 12, left < 10 ? '#fca5a5' : '#fde68a', 'right');
      K.pill(g, 'Snow ' + Math.floor(snow) + (rate ? '   +' + rate + '/s' : ''), K.W / 2, 12, '#bae6fd', 'center');
    },
    info() { return { snow: Math.floor(snow), total: Math.floor(total), power, rate, left: Math.ceil(left), taps }; },
  };
}

export default {
  id: 'snowman-works',
  name: 'Snowman Works',
  icon: 'snowflake',
  genre: 'clicker',
  desc: 'A cosy clicker: pack snow by tapping or holding Space, buy mittens, helpers and a snow cannon, and see how much snow you can pack in a round.',
  controls: 'Click, tap or hold Space to pack snow · 1, 2, 3 or click a card to buy · P pauses',
  season: 'winter',
  colors: ['#1e3a5f', '#ef4444'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Snowman Works' },
    { k: 'seconds', label: 'Round length (seconds)', type: 'range', min: 20, max: 300, step: 10, value: 90 },
    { k: 'accent', label: 'Scarf colour', type: 'color', value: '#ef4444' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  test: { key: 'Space', ms: 500, field: 'total', dir: 1, tap: { field: 'total', dir: 1 } },
  game,
  art(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0f2744'); sky.addColorStop(0.6, '#2b5d8e'); sky.addColorStop(1, '#bfdbfe');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e0f2fe'; g.beginPath(); g.moveTo(0, h * 0.7);
    for (let x = 0; x <= w; x += 10) g.lineTo(x, h * 0.7 + Math.sin(x / 40) * 6);
    g.lineTo(w, h); g.lineTo(0, h); g.fill();
    const ball = (x, y, r) => { const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#bfdbfe'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
    const cx = w / 2;
    ball(cx, h * 0.72, 34); ball(cx, h * 0.46, 25); ball(cx, h * 0.24, 18);
    g.fillStyle = '#0f172a'; g.beginPath(); g.arc(cx - 6, h * 0.22, 2.4, 0, 7); g.arc(cx + 6, h * 0.22, 2.4, 0, 7); g.fill();
    g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(cx, h * 0.25); g.lineTo(cx + 18, h * 0.27); g.lineTo(cx, h * 0.29); g.fill();
    g.fillStyle = '#ef4444'; g.fillRect(cx - 18, h * 0.34, 36, 6);
    g.fillStyle = '#1e293b'; g.fillRect(cx - 15, h * 0.08, 30, 5); g.fillRect(cx - 10, h * 0.01, 20, 14);
    g.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 24; i++) { g.beginPath(); g.arc((i * 53) % w, (i * 37) % (h * 0.7), 1.5 + (i % 3) * 0.6, 0, 7); g.fill(); }
  },
};
