/* ============================================================
   arcade/art-newgames4.js — the cabinet pictures of Slab Tower, Soft
   Touchdown, Peg Drop, Sky Guard, Rock Drift, Crate Shift, Disc Towers
   and Tread Duel, drawn in code on the 320 × 180 canvas the Arcade
   gives each game (see ART in ../apps/arcade.js: art(g, W, H, C, neon,
   off)). Still pictures: nothing moves, so reduced motion changes
   nothing. Decoration only — no numbers that could read as statistics.
   ============================================================ */
import { rr } from './kit.js';

export const ART_NEWGAMES4 = {
  slabtower(g, W, H) {
    /* a tower of slabs, one cut off and falling, the next sliding in */
    const rows = [[160, 120], [166, 104], [158, 96], [160, 96], [152, 84], [156, 70]];
    rows.forEach(([c, w], i) => {
      g.fillStyle = `hsl(${28 + i * 22},70%,${58 - i * 2}%)`; rr(g, c - w / 2, 156 - i * 20, w, 18, 4); g.fill();
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(c - w / 2 + 3, 158 - i * 20, w - 6, 3);
    });
    g.fillStyle = 'hsl(160,70%,58%)'; rr(g, 188, 30, 74, 18, 4); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(225, 50); g.lineTo(160, 52 + 0); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'hsl(10,70%,55%)'; g.save(); g.translate(246, 100); g.rotate(0.45); g.fillRect(-14, -9, 28, 18); g.restore();
  },
  touchdown(g, W, H) {
    /* a lander over a flat pad on grey ground, stars behind */
    g.fillStyle = '#fff'; for (const [x, y] of [[30, 20], [80, 50], [250, 24], [290, 66], [200, 40], [120, 18]]) g.fillRect(x, y, 2, 2);
    g.fillStyle = '#8f93a3'; g.beginPath(); g.moveTo(0, 180); g.lineTo(0, 140); g.lineTo(60, 128); g.lineTo(110, 150); g.lineTo(150, 150); g.lineTo(215, 150); g.lineTo(260, 120); g.lineTo(320, 134); g.lineTo(320, 180); g.closePath(); g.fill();
    g.fillStyle = '#5ee08a'; g.fillRect(150, 147, 65, 4);
    g.save(); g.translate(182, 100); g.rotate(0.12);
    g.fillStyle = '#ffb347'; g.beginPath(); g.moveTo(-8, 12); g.lineTo(0, 30); g.lineTo(8, 12); g.closePath(); g.fill();
    g.strokeStyle = '#cfd8e3'; g.lineWidth = 3; g.beginPath(); g.moveTo(-9, 8); g.lineTo(-18, 22); g.moveTo(9, 8); g.lineTo(18, 22); g.stroke();
    g.fillStyle = '#e8edf3'; g.beginPath(); g.moveTo(-11, 10); g.lineTo(-13, -4); g.lineTo(0, -16); g.lineTo(13, -4); g.lineTo(11, 10); g.closePath(); g.fill();
    g.fillStyle = '#4aa8ff'; g.beginPath(); g.arc(0, -3, 6, 0, 7); g.fill(); g.restore();
  },
  pegs(g, W, H) {
    /* pegs in rows, a ball with a path, slots with numbers */
    g.fillStyle = '#c9c2f0';
    for (let r = 0; r < 5; r++) for (let i = 0; i < 9 - (r % 2); i++) { g.beginPath(); g.arc(60 + i * 25 + (r % 2) * 12.5, 22 + r * 22, 3.5, 0, 7); g.fill(); }
    g.fillStyle = '#4de08a'; g.beginPath(); g.arc(147.5, 66, 4.5, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,210,63,.55)'; g.lineWidth = 2; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(150, 4); g.lineTo(148, 36); g.lineTo(160, 56); g.lineTo(150, 80); g.lineTo(170, 110); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(172, 118, 7, 0, 7); g.fill();
    [10, 5, 2, 1, 1, 2, 5, 10].forEach((v, i) => { g.fillStyle = `hsl(${305 - v * 14},65%,${24 + v * 2}%)`; g.fillRect(52 + i * 27, 140, 25, 40); g.fillStyle = '#fff'; g.font = '800 13px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.fillText(String(v), 64.5 + i * 27, 164); });
  },
  skyguard(g, W, H) {
    /* rocket trails coming down, a burst, towns and a gun along the ground */
    g.strokeStyle = 'rgba(255,120,100,.7)'; g.lineWidth = 2;
    for (const [x0, x1, y1] of [[40, 90, 110], [150, 120, 70], [250, 220, 90], [300, 270, 120]]) { g.beginPath(); g.moveTo(x0, 0); g.lineTo(x1, y1); g.stroke(); g.fillStyle = '#ff6b5e'; g.fillRect(x1 - 2, y1 - 2, 5, 5); }
    g.fillStyle = '#fff1b0'; g.globalAlpha = 0.85; g.beginPath(); g.arc(150, 96, 26, 0, 7); g.fill(); g.globalAlpha = 1;
    g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(150, 96, 12, 0, 7); g.fill();
    g.fillStyle = '#2d2a3a'; g.fillRect(0, 150, 320, 30);
    g.fillStyle = '#6fd3ff'; for (const x of [40, 80, 220, 260, 290]) { g.fillRect(x - 10, 138, 8, 12); g.fillRect(x - 1, 130, 10, 20); }
    g.fillStyle = '#c9cfe0'; g.beginPath(); g.moveTo(134, 150); g.lineTo(140, 140); g.lineTo(160, 140); g.lineTo(166, 150); g.closePath(); g.fill(); g.fillRect(148, 130, 4, 12);
  },
  rockdrift(g, W, H) {
    /* a ship with a flame, shots, and rocks big and small */
    g.strokeStyle = '#cfe0d8'; g.lineWidth = 3; g.fillStyle = 'rgba(160,190,180,.12)';
    const rock = (x, y, r, k) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * 0.628, q = r * (0.8 + ((i * 7 + k) % 5) * 0.06); i ? g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q) : g.moveTo(x + q, y); } g.closePath(); g.fill(); g.stroke(); };
    rock(80, 56, 34, 1); rock(250, 120, 22, 3); rock(262, 42, 12, 2); rock(40, 140, 12, 4);
    g.save(); g.translate(160, 110); g.rotate(-0.5);
    g.fillStyle = '#ffb347'; g.beginPath(); g.moveTo(-10, -4); g.lineTo(-26, 0); g.lineTo(-10, 4); g.closePath(); g.fill();
    g.fillStyle = 'rgba(80,220,160,.3)'; g.strokeStyle = '#e8f6ee'; g.beginPath(); g.moveTo(20, 0); g.lineTo(-14, 11); g.lineTo(-7, 0); g.lineTo(-14, -11); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.fillStyle = '#ffe28a'; for (const [x, y] of [[188, 94], [206, 82], [224, 70]]) g.fillRect(x, y, 4, 4);
  },
  crateshift(g, W, H) {
    /* a small warehouse: walls, goals, crates and the walker */
    const k = 28, ox = 62, oy = 18, rows = ['#######', '#  .  #', '# $#  #', '#  $. #', '# @   #', '#######'];
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      const px = ox + x * k, py = oy + y * k;
      if (c === '#') { g.fillStyle = '#4a4f66'; g.fillRect(px, py, k, k); g.fillStyle = '#5b617b'; g.fillRect(px + 2, py + 2, k - 4, k / 2 - 3); g.fillRect(px + 2, py + k / 2 + 1, k / 2 - 3, k / 2 - 3); return; }
      g.fillStyle = (x + y) & 1 ? '#202a3c' : '#1b2434'; g.fillRect(px, py, k, k);
      if (c === '.') { g.strokeStyle = '#5ee08a'; g.lineWidth = 2; g.beginPath(); g.moveTo(px + k / 2, py + 7); g.lineTo(px + k - 7, py + k / 2); g.lineTo(px + k / 2, py + k - 7); g.lineTo(px + 7, py + k / 2); g.closePath(); g.stroke(); }
      if (c === '$') { g.fillStyle = '#c98a4b'; rr(g, px + 3, py + 3, k - 6, k - 6, 3); g.fill(); g.strokeStyle = '#7a4a1e'; g.lineWidth = 2; g.strokeRect(px + 6, py + 6, k - 12, k - 12); }
      if (c === '@') { g.fillStyle = '#4aa8ff'; g.beginPath(); g.arc(px + k / 2, py + k / 2, 9, 0, 7); g.fill(); g.fillStyle = '#ffd23f'; g.fillRect(px + 6, py + 5, k - 12, 3); }
    }));
    g.fillStyle = '#7be58f'; rr(g, ox + 4 * k + 3, oy + 3 * k + 3, k - 6, k - 6, 3); g.fill();
  },
  hanoi(g, W, H) {
    /* three pegs, discs stacked on two of them */
    g.fillStyle = '#39405a'; rr(g, 20, 156, 280, 10, 5); g.fill();
    const stacks = [[4, 3, 2], [], [1, 0]];
    [0, 1, 2].forEach(p => {
      const cx = 60 + p * 100;
      g.fillStyle = '#55607f'; rr(g, cx - 3, 34, 6, 124, 3); g.fill();
      stacks[p].forEach((d, k) => { const w = 28 + d * 17; g.fillStyle = `hsl(${200 + d * 52},70%,58%)`; rr(g, cx - w / 2, 142 - k * 18, w, 16, 5); g.fill(); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(cx - w / 2 + 4, 144 - k * 18, w - 8, 3); });
    });
    g.fillStyle = 'hsl(200,70%,58%)'; rr(g, 160 - 14, 34, 28, 14, 5); g.fill();
    g.strokeStyle = '#ffd23f'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(76, 28); g.quadraticCurveTo(118, 6, 154, 28); g.stroke();
  },
  treadduel(g, W, H) {
    /* top-down yard: bricks, steel, two tanks and a shell between them */
    const k = 30, ox = 40, oy = 15;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) & 1 ? '#1a2030' : '#1f2638'; g.fillRect(ox + x * k, oy + y * k, k, k); }
    const brick = (x, y) => { g.fillStyle = '#b5532f'; g.fillRect(ox + x * k + 1, oy + y * k + 1, k - 2, k - 2); g.fillStyle = '#7d3519'; g.fillRect(ox + x * k + 1, oy + y * k + k / 2 - 1, k - 2, 2); g.fillRect(ox + x * k + k / 2 - 1, oy + y * k + 1, 2, k / 2 - 2); };
    const steel = (x, y) => { g.fillStyle = '#6b7691'; g.fillRect(ox + x * k + 1, oy + y * k + 1, k - 2, k - 2); g.fillStyle = '#8b97b4'; g.fillRect(ox + x * k + 3, oy + y * k + 3, k - 6, 3); };
    brick(3, 1); brick(3, 2); brick(4, 4); steel(4, 1); steel(3, 4); brick(5, 3);
    const tank = (x, y, rot, col) => { g.save(); g.translate(ox + (x + 0.5) * k, oy + (y + 0.5) * k); g.rotate(rot); g.fillStyle = '#2b2f3d'; g.fillRect(-11, -10, 4, 20); g.fillRect(7, -10, 4, 20); g.fillStyle = col; rr(g, -8, -9, 16, 18, 3); g.fill(); g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill(); g.fillStyle = '#e7ecf5'; g.fillRect(-1.5, -15, 3, 12); g.restore(); };
    tank(1, 4, Math.PI / 2, '#3ab6ff'); tank(6, 4, -Math.PI / 2, '#ff9a3a');
    g.strokeStyle = '#ffe28a'; g.lineWidth = 3; g.beginPath(); g.moveTo(ox + 1.9 * k, oy + 4.5 * k); g.lineTo(ox + 3.2 * k, oy + 4.5 * k); g.stroke();
  },
};
