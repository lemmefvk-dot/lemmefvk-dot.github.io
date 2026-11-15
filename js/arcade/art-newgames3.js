/* ============================================================
   arcade/art-newgames3.js — the cabinet pictures of Tile Slide Race,
   Number Chain, Pixel Painter Duel, Beat Blocks, Stack Cafe and Kite
   Runner, drawn in code on the 320 × 180 canvas the Arcade gives each
   game (see ART in ../apps/arcade.js: art(g, W, H, C, neon, off)).
   Still pictures: nothing moves, so reduced motion changes nothing.
   Decoration only — no numbers that could read as statistics.
   ============================================================ */
import { rr } from './kit.js';

const COLS = ['#ff4d6d', '#3b9cff', '#2fd36b', '#ffd23f', '#c77dff', '#ff9a3c'];

export const ART_NEWGAMES3 = {
  tileslide(g, W, H) {
    /* a 5×5 board, one row pushed sideways (the arrows), three yellow in a line */
    const k = 30, ox = 85, oy = 15;
    const rows = ['01203', '12031', '33330', '20142', '41023'];
    g.fillStyle = 'rgba(255,255,255,.07)'; rr(g, ox - 5, oy - 5, k * 5 + 10, k * 5 + 10, 10); g.fill();
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      const hit = y === 2 && x < 4 ? true : false;
      g.fillStyle = COLS[+c]; g.globalAlpha = hit ? 1 : 0.9;
      rr(g, ox + x * k + 2, oy + y * k + 2, k - 4, k - 4, 7); g.fill();
      if (hit) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
      g.globalAlpha = 1;
    }));
    g.strokeStyle = '#ffe28a'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(ox + k * 5 + 14, oy + k * 2.5 - 8); g.lineTo(ox + k * 5 + 34, oy + k * 2.5 - 8); g.lineTo(ox + k * 5 + 28, oy + k * 2.5 - 14); g.moveTo(ox + k * 5 + 34, oy + k * 2.5 - 8); g.lineTo(ox + k * 5 + 28, oy + k * 2.5 - 2); g.stroke();
  },
  numberchain(g, W, H) {
    /* digits, three of them picked in a path that adds to ten: 2 + 3 + 5 */
    const k = 34, ox = 74, oy = 10;
    const d = [[4, 7, 1, 8, 6], [9, 2, 3, 5, 4], [6, 1, 7, 2, 9], [3, 8, 4, 6, 1]];
    const sel = new Set(['1,1', '2,1', '3,1']);
    d.forEach((row, y) => row.forEach((v, x) => {
      const on = sel.has(`${x},${y}`);
      g.fillStyle = `hsl(${[0, 205, 150, 45, 280, 20, 175, 330, 100][v - 1]},70%,${on ? 74 : 60}%)`; rr(g, ox + x * (k + 4), oy + y * (k + 4) + 6, k, k, 8); g.fill();
      if (on) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); }
      g.fillStyle = '#10131c'; g.font = '800 20px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), ox + x * (k + 4) + k / 2, oy + y * (k + 4) + 6 + k / 2 + 1);
    }));
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath();
    [[1, 1], [2, 1], [3, 1]].forEach(([x, y], i) => { const px = ox + x * (k + 4) + k / 2, py = oy + y * (k + 4) + 6 + k / 2; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
    g.fillStyle = '#9be8c0'; g.font = '800 16px Inter,system-ui,sans-serif'; g.textAlign = 'left'; g.fillText('= 10', ox + 5 * (k + 4) + 4, oy + (k + 4) + 6 + k / 2);
  },
  painter(g, W, H) {
    /* a pixel board with two territories growing from opposite corners */
    const n = 10, k = 15, ox = (W - n * k) / 2, oy = 15;
    const mine = new Set(), theirs = new Set();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { if (x + (n - 1 - y) < 5) mine.add(`${x},${y}`); if ((n - 1 - x) + y < 4) theirs.add(`${x},${y}`); }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const key = `${x},${y}`, m = mine.has(key), t = theirs.has(key);
      g.fillStyle = m ? COLS[1] : t ? COLS[0] : COLS[(x * 3 + y * 5 + (x ^ y)) % 6]; g.globalAlpha = m || t ? 1 : 0.55;
      g.fillRect(ox + x * k + 1, oy + y * k + 1, k - 2, k - 2);
      g.globalAlpha = 1;
      if (m) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(ox + x * k + 1.5, oy + y * k + 1.5, k - 3, k - 3); }
      if (t) { g.strokeStyle = '#0a0a10'; g.lineWidth = 2; g.strokeRect(ox + x * k + 2, oy + y * k + 2, k - 4, k - 4); }
    }
  },
  beatblocks(g, W, H) {
    /* a well with settled blocks, a falling bar, and the beat ring closing */
    const k = 18, ox = 50, oy = 12, cols = 7;
    g.fillStyle = 'rgba(255,255,255,.06)'; rr(g, ox - 4, oy - 4, k * cols + 8, k * 9 + 8, 8); g.fill();
    const rows = ['.......', '.......', '.......', '.......', '..3....', '.1.3.2.', '1103.22', '1013322', '0033222'];
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '.') return; g.fillStyle = COLS[+c]; rr(g, ox + x * k + 1, oy + y * k + 1, k - 2, k - 2, 4); g.fill(); }));
    [[2, 1], [3, 1], [4, 1]].forEach(([x, y], i) => { g.fillStyle = [COLS[3], COLS[3], COLS[1]][i]; rr(g, ox + x * k + 1, oy + y * k + 1, k - 2, k - 2, 4); g.fill(); });
    const cx = 232, cy = 92;
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, 24, 0, 7); g.stroke();
    g.strokeStyle = '#d98cff'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 40, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(217,140,255,.4)'; g.beginPath(); g.arc(cx, cy, 54, 0, 7); g.stroke();
    g.fillStyle = '#d98cff'; g.beginPath(); g.arc(cx - 70, cy - 56, 5, 0, 7); g.arc(cx + 38, cy - 62, 3.5, 0, 7); g.fill();
    g.fillRect(cx - 69, cy - 82, 2, 26); g.fillRect(cx + 40, cy - 80, 2, 18);
  },
  stackcafe(g, W, H) {
    /* a plate with a burger stack, and a customer's order bubble */
    const layers = [['#d89a52', 'bun'], ['#7a3b22', ''], ['#ffcf33', ''], ['#4fc25c', ''], ['#e5483a', ''], ['#e8ac62', '']];
    g.fillStyle = '#ececf1'; g.beginPath(); g.ellipse(110, 148, 70, 11, 0, 0, 7); g.fill();
    layers.forEach(([c], i) => { g.fillStyle = c; rr(g, 62, 130 - i * 15, 96, 14, i === 5 ? 9 : 5); g.fill(); });
    g.fillStyle = 'rgba(255,255,255,.1)'; rr(g, 196, 22, 100, 118, 14); g.fill();
    g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(246, 58, 20, 0, 7); g.fill();
    g.fillStyle = '#7a3b22'; g.beginPath(); g.arc(246, 52, 20, Math.PI, 0); g.fill();
    g.fillStyle = '#222'; g.beginPath(); g.arc(239, 60, 2.4, 0, 7); g.arc(253, 60, 2.4, 0, 7); g.fill();
    g.strokeStyle = '#552'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(238, 68); g.quadraticCurveTo(246, 75, 254, 68); g.stroke();
    [['#d89a52'], ['#7a3b22'], ['#ffcf33'], ['#e8ac62']].forEach(([c], i) => { g.fillStyle = c; rr(g, 222, 118 - i * 11, 48, 9, 4); g.fill(); });
    g.fillStyle = '#3ddc84'; rr(g, 208, 134, 76, 5, 3); g.fill();
  },
  kite(g, W, H) {
    /* a kite, its tail, ribbons on a curve and a storm cloud ahead */
    g.fillStyle = 'rgba(255,255,255,.08)'; rr(g, 150, 78, 110, 44, 14); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(162 + i * 6, 88 + i * 9); g.lineTo(190 + i * 6, 88 + i * 9); g.stroke(); }
    const kx = 78, ky = 70;
    g.strokeStyle = '#ff4d6d'; g.lineWidth = 3; g.beginPath(); g.moveTo(kx - 10, ky + 2); g.bezierCurveTo(kx - 30, ky + 20, kx - 28, ky - 6, kx - 52, ky + 14); g.stroke();
    g.fillStyle = '#ff4d6d'; g.beginPath(); g.moveTo(kx, ky - 22); g.lineTo(kx + 17, ky); g.lineTo(kx, ky + 22); g.lineTo(kx - 17, ky); g.closePath(); g.fill();
    g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(kx, ky - 22); g.lineTo(kx + 17, ky); g.lineTo(kx, ky); g.closePath(); g.fill();
    g.fillStyle = '#3b9cff'; g.beginPath(); g.moveTo(kx, ky + 22); g.lineTo(kx - 17, ky); g.lineTo(kx, ky); g.closePath(); g.fill();
    for (let i = 0; i < 5; i++) { const x = 118 + i * 24, y = 62 + Math.sin(i * 0.9) * 20; g.fillStyle = '#ff9ad5'; g.fillRect(x - 8, y - 3, 16, 6); g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(x + 8, y - 3); g.lineTo(x + 13, y - 7); g.lineTo(x + 13, y + 7); g.lineTo(x + 8, y + 3); g.fill(); }
    g.fillStyle = '#3a3550';
    for (const [dx, dy, r] of [[-18, 4, 16], [0, -4, 22], [20, 3, 17], [4, 14, 14]]) { g.beginPath(); g.arc(270 + dx, 110 + dy, r, 0, 7); g.fill(); }
    g.strokeStyle = '#ffe36b'; g.lineWidth = 3; g.beginPath(); g.moveTo(266, 118); g.lineTo(274, 132); g.lineTo(267, 134); g.lineTo(276, 150); g.stroke();
  },
};
