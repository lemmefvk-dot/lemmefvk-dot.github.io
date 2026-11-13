/* ============================================================
   arcade/art-sports2.js — the cabinet pictures of Darts 501,
   Around the Clock, 8-Ball Pool, Archery and Lap Rush, drawn in
   code on the 320 × 180 canvas the Arcade gives each game
   (see ART in ../apps/arcade.js: art(g, W, H, C, neon, off)).
   ============================================================ */
import { rr } from './kit.js';

const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

function board(g, cx, cy, R, hi) {
  g.fillStyle = '#0c0e13'; g.beginPath(); g.arc(cx, cy, R * 1.22, 0, 7); g.fill();
  for (let i = 0; i < 20; i++) {
    const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180, a1 = a0 + Math.PI / 10, even = i % 2 === 0;
    const ring = (r0, r1, col) => { g.fillStyle = col; g.beginPath(); g.arc(cx, cy, R * r1, a0, a1); g.arc(cx, cy, R * r0, a1, a0, true); g.closePath(); g.fill(); };
    ring(0.09, 0.58, hi === ORDER[i] ? '#ffe28a' : even ? '#15171c' : '#eadfc4');
    ring(0.58, 0.63, even ? '#c8312f' : '#1f8a4a'); ring(0.95, 1, even ? '#c8312f' : '#1f8a4a');
  }
  g.fillStyle = '#1f8a4a'; g.beginPath(); g.arc(cx, cy, R * 0.09, 0, 7); g.fill();
  g.fillStyle = '#c8312f'; g.beginPath(); g.arc(cx, cy, R * 0.04, 0, 7); g.fill();
}
function dart(g, x, y, k = 1) {
  g.save(); g.translate(x, y); g.scale(k, k);
  g.fillStyle = '#e9eef7'; g.beginPath(); g.arc(0, 0, 2.6, 0, 7); g.fill();
  g.strokeStyle = '#3ad6ff'; g.lineWidth = 2.4; g.lineCap = 'round';
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; g.beginPath(); g.moveTo(Math.cos(a) * 2, Math.sin(a) * 2); g.lineTo(Math.cos(a) * 8, Math.sin(a) * 8); g.stroke(); }
  g.restore();
}

export const ART_SPORTS2 = {
  darts(g, W, H) {
    g.fillStyle = '#10131a'; g.fillRect(0, 0, W, H);
    board(g, 130, 92, 70);
    dart(g, 130 + 4, 92 - 41, 1.6); dart(g, 130 - 22, 92 - 9, 1.4); dart(g, 130 + 5, 92 - 4, 1.4);
    g.fillStyle = '#f6f3ea'; g.font = '800 44px Inter,system-ui,sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('501', 216, 70);
    g.fillStyle = '#9be8a8'; g.font = '700 12px Inter,system-ui,sans-serif'; g.fillText('T20 T20 D25', 216, 104);
  },
  'darts-clock'(g, W, H) {
    g.fillStyle = '#10131a'; g.fillRect(0, 0, W, H);
    board(g, 100, 92, 70, 7);
    dart(g, 100 + 45 * Math.sin(-1.3), 92 - 45 * Math.cos(-1.3), 1.6);
    g.font = '700 13px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let t = 0; t < 9; t++) {
      const x = 196 + (t % 3) * 38, y = 58 + Math.floor(t / 3) * 34;
      g.fillStyle = t < 6 ? 'rgba(80,200,120,.4)' : t === 6 ? 'rgba(255,226,138,.4)' : 'rgba(255,255,255,.07)';
      rr(g, x, y, 32, 28, 7); g.fill();
      g.fillStyle = t < 6 ? '#b7f2c4' : t === 6 ? '#ffe28a' : 'rgba(255,255,255,.5)'; g.fillText(String(t + 1), x + 16, y + 15);
    }
  },
  pool(g, W, H) {
    g.fillStyle = '#4a2e18'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a8f55'; rr(g, 16, 18, W - 32, H - 36, 10); g.fill();
    g.fillStyle = '#05080a';
    for (const [x, y] of [[16, 18], [W / 2, 17], [W - 16, 18], [16, H - 18], [W / 2, H - 17], [W - 16, H - 18]]) { g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); }
    const ball = (x, y, col, stripe, n) => {
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(x + 1.5, y + 2, 8.5, 0, 7); g.fill();
      g.fillStyle = stripe ? '#f4f4ee' : col; g.beginPath(); g.arc(x, y, 8.5, 0, 7); g.fill();
      if (stripe) { g.save(); g.beginPath(); g.arc(x, y, 8.5, 0, 7); g.clip(); g.fillStyle = col; g.fillRect(x - 9, y - 4.5, 18, 9); g.restore(); }
      if (n) { g.fillStyle = '#f4f4ee'; g.beginPath(); g.arc(x, y, 4.2, 0, 7); g.fill(); g.fillStyle = '#15161a'; g.font = '700 6px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), x, y + 0.5); }
      const gr = g.createRadialGradient(x - 3, y - 3.5, 0.5, x, y, 8.5); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.4, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.25)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, 8.5, 0, 7); g.fill();
    };
    const cols = ['#f2c230', '#2b6fd1', '#d8322f', '#6a3fb0', '#f08a24', '#1f9a4a', '#8a1f2a'];
    let n = 0;
    for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) { const i = n++; ball(212 + r * 15, 90 + (k - r / 2) * 17, i === 4 ? '#15161a' : cols[i % 7], i % 3 === 2, i === 4 ? 8 : i + 1); }
    ball(80, 96, '#f4f4ee', false, 0);
    g.setLineDash([5, 5]); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(90, 96); g.lineTo(190, 92); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#d9b27a'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(70, 97); g.lineTo(20, 100); g.stroke();
  },
  archery(g, W, H) {
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#16314d'); sky.addColorStop(0.7, '#3f6f8e'); sky.addColorStop(1, '#2d5a35');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2d5a35'; g.fillRect(0, 132, W, H);
    g.fillStyle = '#5a4630'; g.fillRect(206, 96, 5, 50);
    ['#f4f4ee', '#1d1f24', '#2b7fd1', '#d8322f', '#f2c230'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(208, 78, 34 - i * 7, 0, 7); g.fill(); });
    g.strokeStyle = '#d9d4c0'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(40, 120); g.lineTo(200, 83); g.stroke();
    g.fillStyle = '#e24b4b'; g.beginPath(); g.moveTo(40, 120); g.lineTo(52, 113); g.lineTo(50, 123); g.fill();
    g.strokeStyle = '#7be0ff'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(20, 40); g.lineTo(76, 40); g.moveTo(76, 40); g.lineTo(67, 35); g.moveTo(76, 40); g.lineTo(67, 45); g.stroke();
    g.fillStyle = '#d8e4f0'; g.font = '700 11px Inter,system-ui,sans-serif'; g.textAlign = 'left'; g.fillText('WIND 6.2 m/s', 20, 58);
  },
  laprush(g, W, H) {
    g.fillStyle = '#14261c'; g.fillRect(0, 0, W, H);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); g.moveTo(60, 100); g.bezierCurveTo(50, 40, 120, 30, 160, 60); g.bezierCurveTo(200, 90, 240, 20, 270, 60); g.bezierCurveTo(300, 110, 230, 160, 160, 140); g.bezierCurveTo(100, 126, 70, 160, 60, 100); g.closePath(); };
    g.strokeStyle = '#d6372f'; g.lineWidth = 36; path(); g.stroke();
    g.strokeStyle = '#2a2e38'; g.lineWidth = 28; path(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 2; g.setLineDash([8, 12]); path(); g.stroke(); g.setLineDash([]);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) & 1 ? '#111' : '#f4f4f4'; g.fillRect(48 + j * 6, 88 + i * 6.5, 6, 6.5); }
    const car = (x, y, a, col, alpha) => { g.save(); g.translate(x, y); g.rotate(a); g.globalAlpha = alpha; g.fillStyle = col; rr(g, -9, -5, 19, 10, 3); g.fill(); g.fillStyle = 'rgba(255,255,255,.55)'; rr(g, -1, -3.2, 7, 6.4, 2); g.fill(); g.restore(); };
    car(104, 38, 0.1, '#6fe3ff', 0.45); car(124, 40, 0.3, '#ff4fd8', 1);
    g.fillStyle = '#7dffa0'; g.font = '800 15px Inter,system-ui,sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('−0.31', 150, 98);
  },
};
