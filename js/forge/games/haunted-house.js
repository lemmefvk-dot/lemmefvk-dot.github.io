/* Haunted House — a Static Forge template (original code and art).
   Explore a dark old house room by room with a lantern, find the key,
   then get out through the front door. Every run builds a new house:
   rooms joined by a random spanning tree plus a loop or two.
   game() is copied into the game file as text: it may only use K and P. */
function game(K, P) {
  const N = K.num;
  let RXN = Math.round(K.clamp(N(P.roomsX, 3), 1, 6));
  const RYN = Math.round(K.clamp(N(P.roomsY, 3), 1, 6));
  if (RXN * RYN < 3) RXN = Math.max(RXN, 3 - RYN + 1);
  const GHOSTS = Math.round(K.clamp(N(P.ghostsPerRoom, 1), 0, 5));
  const GSPEED = K.clamp(N(P.ghostSpeed, 55), 5, 300);
  const LIGHT = K.clamp(N(P.light, 150), 40, 400);
  const HEARTS = Math.round(K.clamp(N(P.hearts, 3), 1, 9));

  /* one room is 640 x 400 virtual units; the back wall (top) is drawn tall */
  const RW = 640, RH = 400, VW = 660, VH = 504, OX = 10, OY = 60;
  const WT = 56, WS = 20;                       /* back wall depth, other walls */
  const GX0 = 290, GX1 = 350, GY0 = 186, GY1 = 246, MIDY = 216;
  const BX0 = 272, BX1 = 368, BY0 = 172, BY1 = 260;   /* the clear cross between doors */
  const PR = 10, SPEED = 150;
  const QUADS = [[WS, WT, BX0, BY0], [BX1, WT, RW - WS, BY0], [WS, BY1, BX0, RH - WS], [BX1, BY1, RW - WS, RH - WS]];
  const PALS = [
    { wall: '#3b1f4a', wall2: '#4a2860', floor: '#3a2618', floor2: '#2f1e13', rug: '#7f1d1d', rug2: '#b45309' },
    { wall: '#173a3a', wall2: '#1f4d4a', floor: '#352a1f', floor2: '#2a2018', rug: '#1e3a8a', rug2: '#a16207' },
    { wall: '#4a1d27', wall2: '#5e2633', floor: '#33261c', floor2: '#281d15', rug: '#365314', rug2: '#ca8a04' },
    { wall: '#2b2f4a', wall2: '#363b5e', floor: '#3b2a1c', floor2: '#2e2116', rug: '#581c87', rug2: '#d97706' },
    { wall: '#3d3a1c', wall2: '#4d4924', floor: '#30241b', floor2: '#261c15', rug: '#7c2d12', rug2: '#0f766e' },
  ];
  const CANDY = ['#f472b6', '#facc15', '#4ade80', '#38bdf8', '#fb923c', '#c084fc'];
  const BOOKS = ['#7f1d1d', '#1e3a8a', '#14532d', '#713f12', '#581c87', '#0f766e', '#9a3412'];

  let rooms, start, keyRoom, exitRoom, exitSide, cur, pl, hearts, hasKey, elapsed, oilT, inv, fadeT, lockT, banner, visited;
  const cache = document.createElement('canvas');
  const cg = cache.getContext('2d');
  let cacheFor = null, cacheScale = 0;
  const dark = document.createElement('canvas');
  dark.width = RW; dark.height = RH;
  const dg = dark.getContext('2d');

  const R = (x, y) => rooms[y * RXN + x];
  const SIDES = { n: [0, -1, 's'], s: [0, 1, 'n'], e: [1, 0, 'w'], w: [-1, 0, 'e'] };
  const overlap = (a, b, m) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

  function link(a, b) {
    for (const s in SIDES) {
      if (a.x + SIDES[s][0] === b.x && a.y + SIDES[s][1] === b.y) { a.doors[s] = true; b.doors[SIDES[s][2]] = true; }
    }
  }
  function nbrs(r) {
    const out = [];
    for (const s in SIDES) {
      const x = r.x + SIDES[s][0], y = r.y + SIDES[s][1];
      if (x >= 0 && y >= 0 && x < RXN && y < RYN) out.push([s, R(x, y)]);
    }
    return out;
  }
  function bfs(from) {
    const d = new Map([[from, 0]]);
    const q = [from];
    while (q.length) {
      const r = q.shift();
      for (const [s, n] of nbrs(r)) if (r.doors[s] && !d.has(n)) { d.set(n, d.get(r) + 1); q.push(n); }
    }
    return d;
  }
  const outer = r => Object.keys(SIDES).filter(s => !nbrs(r).some(([t]) => t === s));

  function genHouse() {
    rooms = [];
    for (let y = 0; y < RYN; y++) for (let x = 0; x < RXN; x++) rooms.push({ x, y, doors: { n: false, s: false, e: false, w: false } });
    /* a random spanning tree (depth-first), so every room can be reached */
    const seen = new Set();
    const stack = [K.pick(rooms)];
    seen.add(stack[0]);
    while (stack.length) {
      const r = stack[stack.length - 1];
      const open = nbrs(r).filter(([, n]) => !seen.has(n));
      if (!open.length) { stack.pop(); continue; }
      const n = K.pick(open)[1];
      link(r, n);
      seen.add(n);
      stack.push(n);
    }
    /* plus a loop or two, so it is not one long corridor */
    let extra = rooms.length >= 6 ? K.ri(1, 2) : 1;
    for (let tries = 0; extra > 0 && tries < 40; tries++) {
      const r = K.pick(rooms);
      const c = nbrs(r).filter(([s]) => !r.doors[s]);
      if (c.length) { link(r, K.pick(c)[1]); extra--; }
    }
    const corners = rooms.filter(r => (r.x === 0 || r.x === RXN - 1) && (r.y === 0 || r.y === RYN - 1));
    start = K.pick(corners);
    const ds = bfs(start);
    const far = rooms.filter(r => r !== start && outer(r).length).sort((a, b) => ds.get(b) - ds.get(a) || Math.random() - 0.5);
    exitRoom = far[0];
    exitSide = K.pick(outer(exitRoom));
    const de = bfs(exitRoom);
    const mid = rooms.filter(r => r !== start && r !== exitRoom).sort((a, b) => (ds.get(b) + de.get(b) * 0.8) - (ds.get(a) + de.get(a) * 0.8) || Math.random() - 0.5);
    keyRoom = mid[0];
    for (const r of rooms) furnish(r, ds.get(r));
  }

  /* ---------- furnishing a room ---------- */
  const KINDS = [
    { t: 'shelf', w: 104, h: 26, wall: true }, { t: 'table', w: 86, h: 52 }, { t: 'chair', w: 40, h: 40 },
    { t: 'piano', w: 104, h: 58 }, { t: 'coffin', w: 36, h: 78 }, { t: 'clock', w: 30, h: 26, wall: true, top: true },
    { t: 'vase', w: 24, h: 24 }, { t: 'chest', w: 46, h: 30 },
  ];
  function freeSpot(r, avoid) {
    for (let i = 0; i < 80; i++) {
      const p = { x: K.rnd(WS + 24, RW - WS - 24), y: K.rnd(WT + 22, RH - WS - 20) };
      const box = { x: p.x - 14, y: p.y - 14, w: 28, h: 28 };
      if (r.items.some(it => overlap(box, it, 4))) continue;
      /* a clear path straight up or down from the cross keeps it reachable */
      const lane = { x: p.x - 12, y: Math.min(p.y, MIDY), w: 24, h: Math.abs(p.y - MIDY) };
      if (r.items.some(it => overlap(lane, it, 1))) continue;
      if ((avoid || []).some(q => Math.hypot(q.x - p.x, q.y - p.y) < 40)) continue;
      return p;
    }
    return { x: K.rnd(BX0 + 20, BX1 - 20), y: K.rnd(BY0 + 14, BY1 - 14) };
  }
  function furnish(r, dist) {
    r.pal = K.pick(PALS);
    r.items = [];
    for (let qi = 0; qi < 4; qi++) {
      const q = QUADS[qi];
      const want = Math.random() < 0.75 ? (Math.random() < 0.4 ? 2 : 1) : 0;
      for (let n = 0; n < want; n++) {
        for (let tries = 0; tries < 20; tries++) {
          const k = K.pick(KINDS);
          if (k.top && qi > 1) continue;
          if (k.w > q[2] - q[0] - 8 || k.h > q[3] - q[1] - 4) continue;
          const x = K.rnd(q[0] + 4, q[2] - k.w - 4);
          const y = k.wall ? (qi < 2 ? WT : RH - WS - k.h) : K.rnd(q[1] + 6, q[3] - k.h - 4);
          const it = { t: k.t, x, y, w: k.w, h: k.h, c: K.pick(BOOKS), books: Array.from({ length: 14 }, () => K.pick(BOOKS)) };
          if (r.items.some(o => overlap(it, o, 22))) continue;
          r.items.push(it);
          break;
        }
      }
    }
    /* the back wall: sconces, portraits whose eyes follow you, maybe a window */
    r.flames = [];
    r.portraits = [];
    r.window = null;
    const slots = [70, 150, 230, 410, 490, 570].filter(x => !(r.doors.n || (r === exitRoom && exitSide === 'n')) || Math.abs(x - 320) > 70);
    const pickSlot = () => slots.splice(K.ri(0, slots.length - 1), 1)[0];
    for (let i = 0; i < 2 && slots.length; i++) r.flames.push({ x: pickSlot(), y: 30, ph: Math.random() * 9 });
    if (slots.length && Math.random() < 0.5) r.window = { x: pickSlot() };
    for (let i = 0; i < 2 && slots.length; i++) r.portraits.push({ x: pickSlot(), face: K.ri(0, 2) });
    for (const it of r.items) if (it.t === 'table' && Math.random() < 0.6) r.flames.push({ x: it.x + it.w / 2, y: it.y + it.h / 2 - 8, ph: Math.random() * 9, table: true });
    r.webs = [Math.random() < 0.6, Math.random() < 0.6, Math.random() < 0.3, Math.random() < 0.3];
    /* things to find */
    r.loot = [];
    const avoid = [{ x: 320, y: MIDY }];
    const n = K.ri(2, 4);
    for (let i = 0; i < n; i++) { const p = freeSpot(r, avoid); avoid.push(p); r.loot.push({ t: 'candy', x: p.x, y: p.y, c: K.pick(CANDY), a: Math.random() * 6 }); }
    if (r !== start && Math.random() < 0.35) { const p = freeSpot(r, avoid); avoid.push(p); r.loot.push({ t: 'oil', x: p.x, y: p.y }); }
    if (r === keyRoom) { const p = freeSpot(r, avoid); avoid.push(p); r.loot.push({ t: 'key', x: p.x, y: p.y }); }
    /* ghosts: none in the first room, one more in the far rooms */
    r.ghosts = [];
    const count = r === start ? 0 : GHOSTS + (GHOSTS > 0 && dist >= 3 ? 1 : 0);
    for (let i = 0; i < count; i++) addGhost(r);
    r.solids = solids(r);
  }
  function addGhost(r, far) {
    const q = QUADS[K.ri(0, 3)];
    const gh = { x: K.rnd(q[0] + 30, q[2] - 30), y: K.rnd(q[1] + 20, q[3] - 20), vx: 0, vy: 0, a: Math.random() * 6, ph: Math.random() * 6, stun: 0, fade: 0, chase: false };
    if (far) { gh.x = RW - far.x; gh.y = RH + WT - far.y; gh.x = K.clamp(gh.x, 60, RW - 60); gh.y = K.clamp(gh.y, WT + 40, RH - 50); }
    r.ghosts.push(gh);
  }
  function solids(r) {
    const s = [];
    const wall = (x, y, w, h) => s.push({ x, y, w, h });
    const isExit = side => r === exitRoom && side === exitSide;
    const gapH = (side, y, h) => {
      if (r.doors[side] || isExit(side)) { wall(0, y, GX0, h); wall(GX1, y, RW - GX1, h); if (isExit(side)) s.push({ x: GX0, y, w: GX1 - GX0, h, exit: true }); }
      else wall(0, y, RW, h);
    };
    const gapV = (side, x) => {
      if (r.doors[side] || isExit(side)) { wall(x, 0, WS, GY0); wall(x, GY1, WS, RH - GY1); if (isExit(side)) s.push({ x, y: GY0, w: WS, h: GY1 - GY0, exit: true }); }
      else wall(x, 0, WS, RH);
    };
    gapH('n', 0, WT);
    gapH('s', RH - WS, WS);
    gapV('w', 0);
    gapV('e', RW - WS);
    for (const it of r.items) s.push({ x: it.x, y: it.y, w: it.w, h: it.h });
    return s;
  }

  /* ---------- the room's still picture, drawn once per room ---------- */
  function paintRoom(c, r) {
    const p = r.pal;
    c.fillStyle = p.floor;
    c.fillRect(0, 0, RW, RH);
    for (let y = WT, i = 0; y < RH; y += 22, i++) {
      c.fillStyle = i % 2 ? p.floor2 : p.floor;
      c.fillRect(0, y, RW, 22);
      c.fillStyle = 'rgba(0,0,0,.28)';
      c.fillRect(0, y, RW, 1.5);
      for (let x = (i * 97) % 160; x < RW; x += 160) c.fillRect(x, y, 1.5, 22);
    }
    /* rug */
    c.fillStyle = p.rug;
    K.rr(c, 200, 150, 240, 132, 10); c.fill();
    c.strokeStyle = p.rug2; c.lineWidth = 4;
    K.rr(c, 210, 160, 220, 112, 6); c.stroke();
    c.lineWidth = 1.5; c.globalAlpha = 0.6;
    for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse(320, 216, 20 + i * 18, 10 + i * 9, 0, 0, 7); c.stroke(); }
    c.globalAlpha = 1;
    /* back wall with wallpaper, and the side walls */
    c.fillStyle = p.wall; c.fillRect(0, 0, RW, WT);
    c.fillStyle = p.wall2;
    for (let x = 6; x < RW; x += 24) { c.fillRect(x, 0, 6, WT - 8); }
    c.fillStyle = 'rgba(255,255,255,.05)';
    for (let x = 18; x < RW; x += 24) for (let y = 10; y < WT - 10; y += 16) { c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); }
    c.fillStyle = '#1c120c'; c.fillRect(0, WT - 8, RW, 8);
    c.fillStyle = '#2a1b12';
    c.fillRect(0, 0, WS, RH); c.fillRect(RW - WS, 0, WS, RH); c.fillRect(0, RH - WS, RW, WS);
    c.fillStyle = 'rgba(255,255,255,.07)';
    c.fillRect(WS - 2, WT, 2, RH - WT - WS); c.fillRect(RW - WS, WT, 2, RH - WT - WS); c.fillRect(WS, RH - WS, RW - 2 * WS, 2);
    /* doorways */
    if (r.doors.n) {
      c.fillStyle = '#07040b';
      c.beginPath(); c.moveTo(GX0, WT); c.lineTo(GX0, 18); c.quadraticCurveTo(320, -4, GX1, 18); c.lineTo(GX1, WT); c.fill();
      c.strokeStyle = '#5b3a24'; c.lineWidth = 4; c.stroke();
    }
    const thr = (x, y, w, h) => { c.fillStyle = p.floor; c.fillRect(x, y, w, h); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x, y, w, h); };
    if (r.doors.s) thr(GX0, RH - WS, GX1 - GX0, WS);
    if (r.doors.w) thr(0, GY0, WS, GY1 - GY0);
    if (r.doors.e) thr(RW - WS, GY0, WS, GY1 - GY0);
    /* window */
    if (r.window) {
      const x = r.window.x;
      c.fillStyle = '#0b1640'; c.fillRect(x - 18, 8, 36, 34);
      c.fillStyle = '#fef3c7'; c.beginPath(); c.arc(x + 6, 20, 7, 0, 7); c.fill();
      c.fillStyle = '#0b1640'; c.beginPath(); c.arc(x + 9, 18, 6, 0, 7); c.fill();
      c.strokeStyle = '#4a3020'; c.lineWidth = 3; c.strokeRect(x - 18, 8, 36, 34);
      c.beginPath(); c.moveTo(x, 8); c.lineTo(x, 42); c.moveTo(x - 18, 25); c.lineTo(x + 18, 25); c.stroke();
    }
    /* portraits (eyes are drawn live) */
    for (const pt of r.portraits) {
      c.fillStyle = '#a16207'; c.fillRect(pt.x - 15, 6, 30, 38);
      c.fillStyle = '#1f1a2e'; c.fillRect(pt.x - 11, 10, 22, 30);
      c.fillStyle = ['#cbd5e1', '#d6b49a', '#a7f3d0'][pt.face];
      c.beginPath(); c.ellipse(pt.x, 22, 7, 9, 0, 0, 7); c.fill();
      c.fillStyle = '#312e81'; c.fillRect(pt.x - 10, 32, 20, 8);
    }
    /* sconces */
    for (const f of r.flames) {
      if (f.table) continue;
      c.fillStyle = '#b45309'; c.fillRect(f.x - 6, f.y + 6, 12, 3); c.fillRect(f.x - 1.5, f.y + 6, 3, 10);
      c.fillStyle = '#f5f5f4'; c.fillRect(f.x - 3, f.y - 2, 6, 9);
    }
    /* cobwebs in the corners */
    const web = (x, y, sx, sy) => {
      c.strokeStyle = 'rgba(226,232,240,.35)'; c.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { const a = i / 4 * Math.PI / 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + sx * Math.cos(a) * 46, y + sy * Math.sin(a) * 46); c.stroke(); }
      for (let k = 1; k <= 3; k++) {
        c.beginPath();
        for (let i = 0; i <= 4; i++) { const a = i / 4 * Math.PI / 2; const px = x + sx * Math.cos(a) * k * 14, py = y + sy * Math.sin(a) * k * 14; if (i) c.lineTo(px, py); else c.moveTo(px, py); }
        c.stroke();
      }
    };
    if (r.webs[0]) web(WS, WT, 1, 1);
    if (r.webs[1]) web(RW - WS, WT, -1, 1);
    if (r.webs[2]) web(WS, RH - WS, 1, -1);
    if (r.webs[3]) web(RW - WS, RH - WS, -1, -1);
    for (const it of r.items) paintItem(c, it);
  }
  function paintItem(c, it) {
    const { x, y, w, h } = it;
    c.fillStyle = 'rgba(0,0,0,.35)';
    K.rr(c, x + 3, y + 5, w, h, 6); c.fill();
    if (it.t === 'shelf') {
      c.fillStyle = '#3f2a1a'; c.fillRect(x, y, w, h);
      for (let i = 0; i < 13; i++) { c.fillStyle = it.books[i]; c.fillRect(x + 4 + i * 7.4, y + 4 + (i % 3), 6, h - 8 - (i % 3)); }
      c.strokeStyle = '#24170e'; c.lineWidth = 2; c.strokeRect(x, y, w, h);
    } else if (it.t === 'table') {
      c.fillStyle = '#e7e5e4'; c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 7); c.fill();
      c.fillStyle = '#d6d3d1';
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; c.beginPath(); c.arc(x + w / 2 + Math.cos(a) * w / 2, y + h / 2 + Math.sin(a) * h / 2, 5, 0, 7); c.fill(); }
      c.fillStyle = '#5b3a24'; c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2 - 10, h / 2 - 8, 0, 0, 7); c.fill();
      c.fillStyle = '#a8a29e'; c.fillRect(x + w / 2 - 2, y + h / 2 - 8, 4, 12);
    } else if (it.t === 'chair') {
      c.fillStyle = it.c; K.rr(c, x, y, w, h, 10); c.fill();
      c.fillStyle = 'rgba(0,0,0,.25)'; K.rr(c, x + 6, y + 12, w - 12, h - 16, 6); c.fill();
      c.fillStyle = 'rgba(255,255,255,.12)'; K.rr(c, x + 3, y + 2, w - 6, 9, 4); c.fill();
    } else if (it.t === 'piano') {
      c.fillStyle = '#0c0a09';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h * 0.45);
      c.quadraticCurveTo(x + w * 0.55, y + h * 0.5, x + w * 0.45, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
      c.fillStyle = '#f5f5f4'; c.fillRect(x + 3, y + 3, w - 6, 10);
      c.fillStyle = '#0c0a09'; for (let i = 0; i < 14; i++) if (i % 7 !== 2 && i % 7 !== 6) c.fillRect(x + 8 + i * 7, y + 3, 3, 6);
      c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + 8, y + 20); c.lineTo(x + w - 10, y + 20); c.stroke();
    } else if (it.t === 'coffin') {
      const cx = x + w / 2;
      c.fillStyle = '#3b2314';
      c.beginPath(); c.moveTo(cx - w * 0.3, y); c.lineTo(cx + w * 0.3, y); c.lineTo(x + w, y + h * 0.25); c.lineTo(cx + w * 0.32, y + h); c.lineTo(cx - w * 0.32, y + h); c.lineTo(x, y + h * 0.25); c.closePath(); c.fill();
      c.strokeStyle = '#6b4226'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#ca8a04'; c.fillRect(cx - 5, y + h * 0.4, 10, 6);
    } else if (it.t === 'clock') {
      c.fillStyle = '#4a2c17'; c.fillRect(x, y - 30, w, h + 30);
      c.fillStyle = '#fef3c7'; c.beginPath(); c.arc(x + w / 2, y - 16, 9, 0, 7); c.fill();
      c.strokeStyle = '#1c1917'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + w / 2, y - 16); c.lineTo(x + w / 2, y - 23); c.moveTo(x + w / 2, y - 16); c.lineTo(x + w / 2 + 5, y - 14); c.stroke();
      c.fillStyle = '#ca8a04'; c.beginPath(); c.arc(x + w / 2, y + h - 8, 4, 0, 7); c.fill();
    } else if (it.t === 'vase') {
      c.fillStyle = '#0f766e'; c.beginPath(); c.arc(x + w / 2, y + h / 2 + 2, w / 2, 0, 7); c.fill();
      c.strokeStyle = '#57534e'; c.lineWidth = 2; c.beginPath();
      c.moveTo(x + w / 2, y + 4); c.lineTo(x + w / 2 - 6, y - 14); c.moveTo(x + w / 2, y + 4); c.lineTo(x + w / 2 + 8, y - 10); c.moveTo(x + w / 2 + 3, y - 4); c.lineTo(x + w / 2 + 1, y - 20); c.stroke();
    } else if (it.t === 'chest') {
      c.fillStyle = '#7c4a21'; K.rr(c, x, y, w, h, 5); c.fill();
      c.fillStyle = '#3f2a1a'; c.fillRect(x, y + 10, w, 4);
      c.fillStyle = '#ca8a04'; c.fillRect(x + w / 2 - 4, y + 8, 8, 9);
    }
  }

  /* ---------- live pieces ---------- */
  function drawPlayer(c) {
    const moving = Math.hypot(pl.vx, pl.vy) > 10;
    const bob = moving ? Math.sin(K.t * 14) * 1.5 : 0;
    const x = pl.x, y = pl.y + bob;
    if (inv > 0 && Math.floor(K.t * 14) % 2) c.globalAlpha = 0.45;
    c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(pl.x, pl.y + 11, 10, 4, 0, 0, 7); c.fill();
    c.fillStyle = '#4c1d95';
    c.beginPath(); c.moveTo(x - 11, y + 10); c.quadraticCurveTo(x - 10, y - 8, x, y - 14); c.quadraticCurveTo(x + 10, y - 8, x + 11, y + 10); c.closePath(); c.fill();
    c.fillStyle = '#fcd9b6'; c.beginPath(); c.arc(x, y - 4, 6, 0, 7); c.fill();
    c.fillStyle = '#1e1b4b'; c.fillRect(x - 3 + pl.face * 1.5, y - 5, 2, 2.5); c.fillRect(x + 1 + pl.face * 1.5, y - 5, 2, 2.5);
    const lx = x + pl.face * 12, ly = y + 2;
    c.strokeStyle = '#78716c'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + pl.face * 7, y); c.lineTo(lx, ly - 6); c.stroke();
    c.fillStyle = '#292524'; c.fillRect(lx - 4, ly - 6, 8, 10);
    c.save(); c.shadowColor = K.accent; c.shadowBlur = 14; c.fillStyle = K.accent; c.fillRect(lx - 2.5, ly - 4, 5, 6); c.restore();
    c.globalAlpha = 1;
  }
  function drawLoot(c, l) {
    if (l.t === 'candy') {
      c.save(); c.translate(l.x, l.y + Math.sin(K.t * 3 + l.a) * 1.5); c.rotate(0.4 + Math.sin(K.t * 2 + l.a) * 0.15);
      c.fillStyle = l.c;
      c.beginPath(); c.moveTo(-7, 0); c.lineTo(-13, -5); c.lineTo(-13, 5); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(7, 0); c.lineTo(13, -5); c.lineTo(13, 5); c.closePath(); c.fill();
      c.beginPath(); c.ellipse(0, 0, 8, 6, 0, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(-2, -2, 3, 1.6, 0, 0, 7); c.fill();
      c.restore();
    } else if (l.t === 'oil') {
      c.fillStyle = '#e7e5e4'; c.fillRect(l.x - 2, l.y - 12, 4, 4);
      c.fillStyle = 'rgba(253,230,138,.85)'; c.beginPath(); c.arc(l.x, l.y, 8, 0, 7); c.fill();
      c.strokeStyle = '#fef3c7'; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = '#d97706'; c.fillRect(l.x - 6, l.y, 12, 5);
    } else if (l.t === 'key') drawKey(c, l.x, l.y + Math.sin(K.t * 3) * 2, 1);
  }
  function drawKey(c, x, y, s) {
    c.save(); c.translate(x, y); c.scale(s, s); c.rotate(-0.5);
    c.shadowColor = '#fde047'; c.shadowBlur = 12;
    c.strokeStyle = '#facc15'; c.fillStyle = '#facc15'; c.lineWidth = 3;
    c.beginPath(); c.arc(-8, 0, 5, 0, 7); c.stroke();
    c.fillRect(-3, -1.5, 16, 3); c.fillRect(8, 0, 3, 5); c.fillRect(12, 0, 2, 4);
    c.restore();
  }
  function drawGhost(c, gh) {
    const near = Math.hypot(gh.x - pl.x, gh.y - pl.y) < light();
    const wob = Math.sin(gh.ph * 3) * 3;
    c.save();
    c.globalAlpha = gh.fade * (near ? 0.88 : 0.4 + 0.12 * Math.sin(gh.ph * 2)) * (gh.stun > 0 ? 0.5 : 1);
    c.translate(gh.x, gh.y + wob);
    c.shadowColor = '#bfdbfe'; c.shadowBlur = 18;
    c.fillStyle = '#eef2ff';
    c.beginPath(); c.arc(0, -4, 14, Math.PI, 0);
    c.lineTo(14, 12);
    for (let i = 0; i < 4; i++) { const x0 = 14 - i * 7; c.quadraticCurveTo(x0 - 3.5, 12 + (i % 2 ? -5 : 5) * Math.sin(gh.ph * 6 + i), x0 - 7, 12); }
    c.closePath(); c.fill();
    c.shadowBlur = 0;
    const dx = K.clamp((pl.x - gh.x) / 60, -1, 1) * 2, dy = K.clamp((pl.y - gh.y) / 60, -1, 1) * 1.5;
    c.fillStyle = '#1e1b4b';
    c.beginPath(); c.ellipse(-5 + dx, -5 + dy, 2.6, gh.chase ? 4 : 3.2, 0, 0, 7); c.ellipse(5 + dx, -5 + dy, 2.6, gh.chase ? 4 : 3.2, 0, 0, 7); c.fill();
    if (gh.chase) { c.beginPath(); c.ellipse(dx, 3 + dy, 2.5, 3.5, 0, 0, 7); c.fill(); }
    else { c.fillStyle = 'rgba(244,114,182,.5)'; c.beginPath(); c.arc(-9, 0, 2.5, 0, 7); c.arc(9, 0, 2.5, 0, 7); c.fill(); }
    c.restore();
  }
  function exitRect() { return cur.solids.find(s => s.exit) || null; }
  function drawExit(c) {
    const e = exitRect();
    if (!e) return;
    const open = hasKey;
    c.save();
    if (exitSide === 'n' || exitSide === 's') {
      c.fillStyle = open ? '#fde68a' : '#5b3a1c';
      if (open) { c.shadowColor = '#fde68a'; c.shadowBlur = 24; }
      c.fillRect(e.x + 2, e.y + (exitSide === 'n' ? 6 : 0), e.w - 4, e.h - (exitSide === 'n' ? 6 : 0));
      c.shadowBlur = 0;
      if (!open) {
        c.strokeStyle = '#2a1a0c'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(e.x + e.w / 2, e.y + 6); c.lineTo(e.x + e.w / 2, e.y + e.h); c.stroke();
      }
    } else {
      c.fillStyle = open ? '#fde68a' : '#5b3a1c';
      if (open) { c.shadowColor = '#fde68a'; c.shadowBlur = 24; }
      c.fillRect(e.x, e.y + 2, e.w, e.h - 4);
      c.shadowBlur = 0;
    }
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2 + (exitSide === 'n' ? 4 : 0);
    if (!open) {
      c.fillStyle = '#a8a29e'; c.fillRect(cx - 6, cy - 2, 12, 10);
      c.strokeStyle = '#a8a29e'; c.lineWidth = 2.5; c.beginPath(); c.arc(cx, cy - 2, 4, Math.PI, 0); c.stroke();
    }
    c.restore();
    /* a sign: where the way out is */
    const sx = exitSide === 'w' ? e.x + 40 : exitSide === 'e' ? e.x - 20 : cx;
    const sy = exitSide === 'n' ? e.y + e.h + 18 : exitSide === 's' ? e.y - 16 : cy - 44;
    K.txt(c, open ? 'EXIT' : 'LOCKED', sx, sy, 11, open ? '#fde68a' : '#d6d3d1', 'center', 800);
  }
  const light = () => LIGHT * (oilT > 0 ? 1.4 : 1) * (1 + 0.035 * Math.sin(K.t * 13) + 0.02 * Math.sin(K.t * 7.3));

  function paintDark() {
    dg.globalCompositeOperation = 'source-over';
    dg.clearRect(0, 0, RW, RH);
    dg.fillStyle = 'rgba(3,2,10,.95)';
    dg.fillRect(0, 0, RW, RH);
    dg.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => {
      const gr = dg.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(0,0,0,' + a + ')');
      gr.addColorStop(0.55, 'rgba(0,0,0,' + a * 0.85 + ')');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      dg.fillStyle = gr;
      dg.fillRect(x - r, y - r, r * 2, r * 2);
    };
    hole(pl.x, pl.y, light(), 1);
    /* doorways glow faintly, so you can find your way */
    if (cur.doors.n) hole(320, WT - 6, 46, 0.4);
    if (cur.doors.s) hole(320, RH - 8, 46, 0.4);
    if (cur.doors.w) hole(8, MIDY, 46, 0.4);
    if (cur.doors.e) hole(RW - 8, MIDY, 46, 0.4);
    for (const f of cur.flames) hole(f.x, f.y + 4, 52 + Math.sin(K.t * 9 + f.ph) * 4, 0.75);
    if (cur.window) hole(cur.window.x, 30, 60, 0.45);
    const e = exitRect();
    if (e && hasKey) hole(e.x + e.w / 2, e.y + e.h / 2, 90, 0.8);
    dg.globalCompositeOperation = 'source-over';
  }

  /* ---------- moving ---------- */
  function collide(axis, d) {
    if (axis === 'x') pl.x += d; else pl.y += d;
    const box = { x: pl.x - PR, y: pl.y - PR, w: PR * 2, h: PR * 2 };
    for (const s of cur.solids) {
      if (!overlap(box, s, 0)) continue;
      if (s.exit) tryExit();
      if (axis === 'x') pl.x = d > 0 ? s.x - PR : s.x + s.w + PR;
      else pl.y = d > 0 ? s.y - PR : s.y + s.h + PR;
      box.x = pl.x - PR; box.y = pl.y - PR;
    }
  }
  function tryExit() {
    if (K.state !== 'play') return;
    if (hasKey) {
      const par = rooms.length * 25;
      const bonus = Math.max(0, Math.round(par - elapsed)) * 5;
      K.add(500, pl.x, pl.y - 20, '#fde68a');
      if (bonus) K.add(bonus);
      K.burst(pl.x, pl.y, ['#fde68a', K.accent, '#fff'], 40, 260, { life: 0.9 });
      K.win('You escaped!');
    } else if (lockT <= 0) {
      lockT = 1.4;
      K.sfx('thud');
      K.shake(4);
      K.float(pl.x, pl.y - 26, 'Locked! Find the key', '#fde68a', 15);
    }
  }
  function enter(r, side) {
    cur = r;
    visited.add(r);
    fadeT = 0.3;
    if (side === 'w') pl.x = RW - WS - PR - 3;
    if (side === 'e') pl.x = WS + PR + 3;
    if (side === 'n') pl.y = RH - WS - PR - 3;
    if (side === 's') pl.y = WT + PR + 3;
    if (side === 'w' || side === 'e') pl.y = K.clamp(pl.y, GY0 + PR + 1, GY1 - PR - 1);
    else pl.x = K.clamp(pl.x, GX0 + PR + 1, GX1 - PR - 1);
    for (const gh of r.ghosts) {
      if (Math.hypot(gh.x - pl.x, gh.y - pl.y) < 170) { gh.x = K.clamp(RW - pl.x, 60, RW - 60); gh.y = K.clamp(RH + WT - pl.y, WT + 40, RH - 50); }
      gh.fade = 0;
    }
    K.sfx('blip');
  }
  function hurt(gh) {
    hearts--;
    inv = 1.2;
    const d = Math.hypot(pl.x - gh.x, pl.y - gh.y) || 1;
    pl.kx = (pl.x - gh.x) / d * 380;
    pl.ky = (pl.y - gh.y) / d * 380;
    gh.vx = -pl.kx * 0.4; gh.vy = -pl.ky * 0.4; gh.stun = 1.3;
    K.shake(9);
    K.flash('#a78bfa', 0.3);
    K.sfx('hurt');
    K.burst(pl.x, pl.y, ['#c4b5fd', '#eef2ff'], 14, 160);
    if (hearts <= 0) K.over('Too spooked!');
  }

  return {
    title: 'Haunted House',
    tagline: 'Find the key. Find the front door. Don\'t let them catch you.',
    controls: ['Arrow keys / WASD or drag a finger: walk', 'Ghosts chase you in the light   ·   P: pause'],
    accent: '#fb923c',
    bg: '#05030a',
    reset() {
      genHouse();
      cur = start;
      visited = new Set([start]);
      pl = { x: 320, y: MIDY, vx: 0, vy: 0, kx: 0, ky: 0, face: 1 };
      hearts = HEARTS; hasKey = false; elapsed = 0; oilT = 0; inv = 0; fadeT = 0.6; lockT = 0;
      banner = { text: 'Find the key', t: 2.2 };
      cacheFor = null;
    },
    idle(dt) {
      if (!cur) return;
      fadeT = Math.max(0, fadeT - dt);
      for (const gh of cur.ghosts) { gh.ph += dt; gh.fade = Math.min(1, gh.fade + dt); }
    },
    update(dt) {
      elapsed += dt;
      oilT = Math.max(0, oilT - dt);
      inv = Math.max(0, inv - dt);
      lockT = Math.max(0, lockT - dt);
      fadeT = Math.max(0, fadeT - dt);
      if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      /* walk */
      let mx = K.ax(), my = K.ay();
      const st = K.stick(48);
      if (st && st.mag > 0.12) { mx = st.x; my = st.y; }
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      pl.vx = mx * SPEED; pl.vy = my * SPEED;
      if (mx) pl.face = mx > 0 ? 1 : -1;
      pl.kx -= pl.kx * Math.min(1, dt * 7); pl.ky -= pl.ky * Math.min(1, dt * 7);
      collide('x', (pl.vx + pl.kx) * dt);
      collide('y', (pl.vy + pl.ky) * dt);
      /* through a doorway */
      const go = pl.x < 0 ? 'w' : pl.x > RW ? 'e' : pl.y < 0 ? 'n' : pl.y > RH ? 's' : null;
      if (go) {
        const nx = cur.x + SIDES[go][0], ny = cur.y + SIDES[go][1];
        if (nx >= 0 && ny >= 0 && nx < RXN && ny < RYN) enter(R(nx, ny), go);
        else { pl.x = K.clamp(pl.x, PR, RW - PR); pl.y = K.clamp(pl.y, PR, RH - PR); }
      }
      /* pick things up */
      for (let i = cur.loot.length - 1; i >= 0; i--) {
        const l = cur.loot[i];
        if (Math.hypot(l.x - pl.x, l.y - pl.y) > 20) continue;
        cur.loot.splice(i, 1);
        if (l.t === 'candy') { K.add(10, l.x, l.y - 12, l.c); K.sfx('coin'); K.burst(l.x, l.y, [l.c, '#fff'], 10, 120, { life: 0.4 }); }
        else if (l.t === 'oil') { oilT = 15; K.sfx('power'); K.float(l.x, l.y - 18, 'Lantern oil! Brighter light', '#fde68a', 15); K.burst(l.x, l.y, '#fde68a', 16, 140); }
        else if (l.t === 'key') {
          hasKey = true;
          K.add(100, l.x, l.y - 14, '#fde047');
          K.sfx('power');
          K.flash(K.accent, 0.35);
          K.shake(6);
          K.burst(l.x, l.y, ['#fde047', '#fff', K.accent], 30, 220, { life: 0.8 });
          banner = { text: 'Key found! The house wakes up…', t: 2.6 };
          if (GHOSTS > 0) addGhost(cur, pl);
        }
      }
      /* ghosts */
      const ramp = 1 + Math.min(0.6, elapsed / 300) + (hasKey ? 0.25 : 0);
      const sight = Math.max(140, light() * 1.1);
      for (const gh of cur.ghosts) {
        gh.ph += dt;
        gh.fade = Math.min(1, gh.fade + dt * 1.4);
        const sp = GSPEED * ramp;
        if (gh.stun > 0) {
          gh.stun -= dt;
          gh.vx -= gh.vx * Math.min(1, dt * 3); gh.vy -= gh.vy * Math.min(1, dt * 3);
        } else {
          const d = Math.hypot(pl.x - gh.x, pl.y - gh.y) || 1;
          gh.chase = d < sight && gh.fade > 0.8 && fadeT <= 0;
          if (gh.chase) {
            gh.vx = K.lerp(gh.vx, (pl.x - gh.x) / d * sp, Math.min(1, dt * 2.2));
            gh.vy = K.lerp(gh.vy, (pl.y - gh.y) / d * sp, Math.min(1, dt * 2.2));
          } else {
            /* drifting, but slowly drawn towards you: they sense you */
            const want = Math.atan2(pl.y - gh.y, pl.x - gh.x);
            const diff = Math.atan2(Math.sin(want - gh.a), Math.cos(want - gh.a));
            gh.a += K.rnd(-2, 2) * dt + diff * dt * 0.5;
            gh.vx = K.lerp(gh.vx, Math.cos(gh.a) * sp * 0.45, Math.min(1, dt * 1.5));
            gh.vy = K.lerp(gh.vy, Math.sin(gh.a) * sp * 0.45, Math.min(1, dt * 1.5));
          }
          if (gh.fade > 0.6 && inv <= 0 && d < 21) hurt(gh);
        }
        gh.x += gh.vx * dt; gh.y += gh.vy * dt;
        if (gh.x < 44 || gh.x > RW - 44) { gh.x = K.clamp(gh.x, 44, RW - 44); gh.a = Math.PI - gh.a; gh.vx *= -0.5; }
        if (gh.y < WT + 24 || gh.y > RH - 40) { gh.y = K.clamp(gh.y, WT + 24, RH - 40); gh.a = -gh.a; gh.vy *= -0.5; }
      }
    },
    draw(g) {
      const f = K.fit(VW, VH);
      const cs = K.clamp(Math.round(f.s * K.dpr * 2) / 2, 1, 3);
      if (cacheFor !== cur || cacheScale !== cs) {
        cache.width = Math.round(RW * cs); cache.height = Math.round(RH * cs);
        cg.setTransform(cs, 0, 0, cs, 0, 0);
        paintRoom(cg, cur);
        cacheFor = cur; cacheScale = cs;
      }
      g.save();
      g.translate(f.ox + OX * f.s, f.oy + OY * f.s);
      g.scale(f.s, f.s);
      g.beginPath(); g.rect(-2, -2, RW + 4, RH + 4); g.clip();
      g.drawImage(cache, 0, 0, RW, RH);
      /* live: flames, portrait eyes, the exit, loot, you */
      for (const fl of cur.flames) {
        const fh = 7 + Math.sin(K.t * 11 + fl.ph) * 1.5;
        g.fillStyle = '#fbbf24';
        g.beginPath(); g.ellipse(fl.x, fl.y - 4, 3, fh / 2 + 1, 0, 0, 7); g.fill();
        g.fillStyle = '#fff7ed'; g.beginPath(); g.ellipse(fl.x, fl.y - 3, 1.4, fh / 4, 0, 0, 7); g.fill();
      }
      for (const pt of cur.portraits) {
        const dx = K.clamp((pl.x - pt.x) / 200, -1, 1) * 2, dy = K.clamp((pl.y - 22) / 200, 0, 1) * 1.5;
        g.fillStyle = '#fff'; g.fillRect(pt.x - 5, 19, 4, 3); g.fillRect(pt.x + 1, 19, 4, 3);
        g.fillStyle = '#111'; g.fillRect(pt.x - 4 + dx, 19.5 + dy, 1.6, 1.6); g.fillRect(pt.x + 2 + dx, 19.5 + dy, 1.6, 1.6);
      }
      drawExit(g);
      for (const l of cur.loot) drawLoot(g, l);
      drawPlayer(g);
      K.fx(g);
      paintDark();
      g.drawImage(dark, 0, 0, RW, RH);
      g.globalCompositeOperation = 'lighter';
      const L = light();
      const warm = g.createRadialGradient(pl.x, pl.y, 0, pl.x, pl.y, L * 0.8);
      warm.addColorStop(0, 'rgba(251,146,60,.16)');
      warm.addColorStop(1, 'rgba(251,146,60,0)');
      g.fillStyle = warm;
      g.fillRect(pl.x - L, pl.y - L, L * 2, L * 2);
      g.globalCompositeOperation = 'source-over';
      /* glimmers you can see in the dark: the key, and the ghosts */
      for (const l of cur.loot) {
        if (l.t !== 'key') continue;
        g.globalAlpha = 0.35 + 0.35 * Math.sin(K.t * 5);
        g.fillStyle = '#fde047';
        g.beginPath(); g.arc(l.x, l.y, 2.5, 0, 7); g.fill();
        g.globalAlpha = 1;
      }
      for (const gh of cur.ghosts) drawGhost(g, gh);
      if (fadeT > 0) { g.fillStyle = 'rgba(3,2,10,' + Math.min(1, fadeT / 0.3) + ')'; g.fillRect(0, 0, RW, RH); }
      g.restore();
      g.strokeStyle = 'rgba(251,146,60,.18)';
      g.lineWidth = 1;
      g.strokeRect(f.ox + OX * f.s - 1, f.oy + OY * f.s - 1, RW * f.s + 2, RH * f.s + 2);
    },
    hud(g) {
      const w1 = K.pill(g, 'Score ' + K.score, 12, 12, '#fff');
      const s = Math.floor(elapsed);
      K.pill(g, Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'), 18 + w1, 12, 'rgba(226,232,255,.8)');
      let hs = '';
      for (let i = 0; i < HEARTS; i++) hs += i < hearts ? '♥' : '♡';
      K.pill(g, hs + (hasKey ? '  · KEY' : ''), K.W - 12, 12, '#fb7185', 'right');
      /* the map: rooms you have been in, the doors between them */
      const cw = K.W < 520 ? 9 : K.W > 1200 ? 16 : 12, ch = Math.round(cw * 0.75), gap = 3;
      const mw = RXN * (cw + gap) - gap, mh = RYN * (ch + gap) - gap;
      const mx = K.W - 12 - mw - 10, my = 48;
      g.fillStyle = 'rgba(6,8,16,.55)';
      K.rr(g, mx - 6, my - 6, mw + 12 + 4, mh + 12, 7); g.fill();
      for (const r of rooms) {
        const x = mx + r.x * (cw + gap), y = my + r.y * (ch + gap);
        const v = visited.has(r);
        g.fillStyle = r === cur ? K.accent : v ? 'rgba(226,232,255,.55)' : 'rgba(226,232,255,.1)';
        g.fillRect(x, y, cw, ch);
        if (v) {
          g.fillStyle = 'rgba(226,232,255,.4)';
          if (r.doors.e) g.fillRect(x + cw, y + ch / 2 - 1, gap, 2);
          if (r.doors.s) g.fillRect(x + cw / 2 - 1, y + ch, 2, gap);
        }
        if (v && r === keyRoom && !hasKey) { g.fillStyle = '#fde047'; g.beginPath(); g.arc(x + cw / 2, y + ch / 2, 2.2, 0, 7); g.fill(); }
        if (v && r === exitRoom) { g.fillStyle = hasKey ? '#4ade80' : '#a8a29e'; g.fillRect(x + cw / 2 - 2, y + ch / 2 - 2, 4, 4); }
      }
      /* the goal, at the bottom */
      const hint = hasKey ? (visited.has(exitRoom) ? 'Key found! Back to the front door' : 'Key found! Now find the front door') : 'Find the key';
      const f = K.fit(VW, VH);
      K.pill(g, hint, K.W / 2, Math.min(K.H - 32, f.oy + (OY + RH + 6) * f.s), hasKey ? '#fde68a' : 'rgba(226,232,255,.85)', 'center');
      if (banner && K.state === 'play') {
        g.globalAlpha = Math.min(1, banner.t * 2);
        g.save(); g.shadowColor = K.accent; g.shadowBlur = 18;
        K.txt(g, banner.text, K.W / 2, K.H * 0.3, K.clamp(K.W / 22, 16, 30), K.accent, 'center', 900);
        g.restore();
        g.globalAlpha = 1;
      }
      if (oilT > 0) K.pill(g, 'Bright lantern ' + Math.ceil(oilT), 12, 46, '#fde68a');
      K.drawStick(g, 48);
    },
    info() {
      return {
        x: pl.x, y: pl.y, room: [cur.x, cur.y], hasKey, visited: visited.size, hearts,
        keyRoom: [keyRoom.x, keyRoom.y], exitRoom: [exitRoom.x, exitRoom.y], exitSide,
        doors: Object.keys(cur.doors).filter(s => cur.doors[s]).join(''),
        keyAt: (k => (k ? { x: k.x, y: k.y } : null))(cur.loot.find(l => l.t === 'key')),
        ghosts: cur.ghosts.length,
      };
    },
  };
}

export default {
  id: 'haunted-house',
  name: 'Haunted House',
  icon: 'home',
  genre: 'adventure',
  desc: 'Explore a dark old house with only a lantern, find the key and escape through the front door before the ghosts catch you. Every run is a new house.',
  controls: 'Arrow keys or WASD, or drag a finger, to walk · P pauses',
  season: 'halloween',
  colors: ['#05030a', '#fb923c'],
  params: [
    { k: 'title', label: 'Title', type: 'text', value: 'Haunted House' },
    { k: 'roomsX', label: 'Rooms across', type: 'range', min: 2, max: 4, step: 1, value: 3 },
    { k: 'roomsY', label: 'Rooms down', type: 'range', min: 2, max: 4, step: 1, value: 3 },
    { k: 'ghostsPerRoom', label: 'Ghosts per room', type: 'range', min: 0, max: 3, step: 1, value: 1 },
    { k: 'ghostSpeed', label: 'Ghost speed', type: 'range', min: 20, max: 120, step: 5, value: 55 },
    { k: 'light', label: 'Lantern light', type: 'range', min: 90, max: 260, step: 10, value: 150 },
    { k: 'hearts', label: 'Hearts', type: 'range', min: 1, max: 5, step: 1, value: 3 },
    { k: 'accent', label: 'Lantern colour', type: 'color', value: '#fb923c' },
    { k: 'sound', label: 'Sound effects', type: 'toggle', value: true },
  ],
  /* how Forge's test suite checks that the game reacts to input (see neon-breaker.js) */
  test: { key: 'ArrowRight', ms: 400, field: 'x', dir: 1, drag: { dx: 160, dy: 0, field: 'x', dir: 1 } },
  game,
  art(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1e1038'); sky.addColorStop(1, '#07040f');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fef3c7'; g.shadowColor = '#fde68a'; g.shadowBlur = 30;
    g.beginPath(); g.arc(w * 0.8, h * 0.24, 22, 0, 7); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#0b0614';
    const bx = w * 0.3, by = h * 0.92;
    g.beginPath();
    g.moveTo(bx - 70, by); g.lineTo(bx - 70, by - 60); g.lineTo(bx - 85, by - 60); g.lineTo(bx - 40, by - 105);
    g.lineTo(bx - 20, by - 88); g.lineTo(bx - 20, by - 130); g.lineTo(bx - 8, by - 150); g.lineTo(bx + 4, by - 130);
    g.lineTo(bx + 4, by - 90); g.lineTo(bx + 30, by - 112); g.lineTo(bx + 80, by - 64); g.lineTo(bx + 66, by - 64); g.lineTo(bx + 66, by);
    g.closePath(); g.fill();
    g.fillStyle = '#fb923c'; g.shadowColor = '#fb923c'; g.shadowBlur = 12;
    for (const [x, y] of [[-52, -44], [-30, -44], [24, -44], [46, -44], [-12, -118], [36, -84]]) g.fillRect(bx + x, by + y, 10, 13);
    g.fillStyle = '#fde68a'; g.fillRect(bx - 4, by - 26, 16, 26);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(238,242,255,.85)'; g.shadowColor = '#bfdbfe'; g.shadowBlur = 16;
    const gx = w * 0.72, gy = h * 0.62;
    g.beginPath(); g.arc(gx, gy, 20, Math.PI, 0); g.lineTo(gx + 20, gy + 22);
    for (let i = 0; i < 4; i++) g.quadraticCurveTo(gx + 15 - i * 10, gy + (i % 2 ? 16 : 28), gx + 10 - i * 10, gy + 22);
    g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#1e1b4b';
    g.beginPath(); g.ellipse(gx - 7, gy - 4, 3, 5, 0, 0, 7); g.ellipse(gx + 7, gy - 4, 3, 5, 0, 0, 7); g.fill();
  },
};
