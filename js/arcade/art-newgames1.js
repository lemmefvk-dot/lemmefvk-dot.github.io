/* ============================================================
   arcade/art-newgames1.js — the cabinet pictures of Signal Relay,
   Hex Claim, Word Ladder, Robo Tiles, Bridge Builder, Cannon Crush
   and Rail Switch, drawn in code on the 320 × 180 canvas the Arcade
   gives each game (see ART in ../apps/arcade.js:
   art(g, W, H, C, neon, off)). Nothing is animated.
   ============================================================ */
import { rr } from './kit.js';

const hexPath = (g, x, y, s) => {
  g.beginPath();
  for (let k = 0; k < 6; k++) { const a = (Math.PI / 180) * (-90 + 60 * k); const px = x + Math.cos(a) * s, py = y + Math.sin(a) * s; k ? g.lineTo(px, py) : g.moveTo(px, py); }
  g.closePath();
};

export const ART_NEWGAMES1 = {
  signalrelay(g, W, H, C, neon, off) {
    const k = 28, ox = 66, oy = 22;
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { rr(g, ox + i * k + 1, oy + j * k + 1, k - 2, k - 2, 4); g.fill(); }
    const c = (i, j) => [ox + i * k + k / 2, oy + j * k + k / 2];
    const beam = (pts, col, blur) => {
      neon(blur, 58, col); g.strokeStyle = `hsl(${col},90%,62%)`; g.lineWidth = 4; g.beginPath();
      pts.forEach(([i, j], n) => { const [x, y] = c(i, j); n ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); off();
    };
    beam([[0, 1], [3, 1], [3, 3], [1, 3]], 350, 12);
    beam([[4, 0], [4, 2], [2, 2]], 205, 10);
    g.strokeStyle = '#eef2fa'; g.lineWidth = 4; g.lineCap = 'round';
    for (const [i, j, s] of [[3, 1, -1], [3, 3, 1], [4, 2, 1]]) { const [x, y] = c(i, j); g.beginPath(); g.moveTo(x - 9, y + 9 * s); g.lineTo(x + 9, y - 9 * s); g.stroke(); }
    g.fillStyle = `hsl(350,90%,62%)`; g.beginPath(); g.arc(...c(0, 1), 8, 0, 7); g.fill();
    g.fillStyle = `hsl(205,90%,62%)`; g.save(); g.translate(...c(4, 0)); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.restore();
    neon(14, 60, 350); g.strokeStyle = 'hsl(350,90%,62%)'; g.lineWidth = 3; g.beginPath(); g.arc(...c(1, 3), 10, 0, 7); g.stroke(); off();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(...c(1, 3), 3.5, 0, 7); g.fill();
  },

  hexclaim(g, W, H, C, neon, off) {
    const s = 17, dx = Math.sqrt(3) * s, n = 5, ox = 78, oy = 36;
    const at = (r, c) => [ox + (c + r / 2) * dx, oy + r * 1.5 * s];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const [x, y] = at(r, c);
      hexPath(g, x, y, s * 0.96); g.fillStyle = (r + c) % 2 ? '#232c4d' : '#1f2748'; g.fill(); g.strokeStyle = 'rgba(160,180,255,.35)'; g.lineWidth = 1; g.stroke();
    }
    g.lineWidth = 4; g.lineCap = 'round';
    g.strokeStyle = '#ffa62b'; g.beginPath(); g.moveTo(...at(0, 0).map((v, i) => v + (i ? -s : -dx / 2))); g.lineTo(...at(0, n - 1).map((v, i) => v + (i ? -s : dx / 2))); g.stroke();
    g.beginPath(); g.moveTo(...at(n - 1, 0).map((v, i) => v + (i ? s : -dx / 2))); g.lineTo(...at(n - 1, n - 1).map((v, i) => v + (i ? s : dx / 2))); g.stroke();
    g.strokeStyle = '#38a8ff'; g.beginPath(); g.moveTo(...at(0, 0).map((v, i) => v + (i ? -s : -dx / 2))); g.lineTo(...at(n - 1, 0).map((v, i) => v + (i ? s : -dx / 2))); g.stroke();
    g.beginPath(); g.moveTo(...at(0, n - 1).map((v, i) => v + (i ? -s : dx / 2))); g.lineTo(...at(n - 1, n - 1).map((v, i) => v + (i ? s : dx / 2))); g.stroke();
    const stone = (r, c, col) => { const [x, y] = at(r, c); neon(8, 55, col === 'o' ? 35 : 205); g.fillStyle = col === 'o' ? '#ffa62b' : '#38a8ff'; g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill(); off(); };
    for (const [r, c] of [[0, 2], [1, 2], [2, 1], [3, 1], [4, 1]]) stone(r, c, 'o');
    for (const [r, c] of [[1, 0], [2, 3], [3, 3], [2, 2]]) stone(r, c, 'b');
  },

  wordladder(g, W, H, C, neon, off) {
    const words = ['COLD', 'CORD', 'CARD', 'WARD', 'WARM'];
    g.font = '800 20px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    words.forEach((w, r) => {
      const y = 24 + r * 33, x0 = 112;
      for (let i = 0; i < 4; i++) {
        const lit = r > 0 && w[i] !== words[r - 1][i];
        g.fillStyle = lit ? 'hsla(48,100%,55%,.9)' : 'rgba(255,255,255,.1)'; rr(g, x0 + i * 26, y - 12, 23, 25, 5); g.fill();
        g.fillStyle = lit ? '#2a1f00' : '#e9edf5'; g.fillText(w[i], x0 + i * 26 + 11.5, y + 1);
      }
    });
  },

  robotiles(g, W, H, C, neon, off) {
    const k = 30, ox = 70, oy = 16, rows = ['.#...', '.#.#.', '...#G', '.##..', 'S....'];
    rows.forEach((row, j) => [...row].forEach((ch, i) => {
      const x = ox + i * k, y = oy + j * k;
      g.fillStyle = ch === '#' ? '#3a3f55' : 'rgba(255,255,255,.07)'; rr(g, x + 1, y + 1, k - 2, k - 2, 5); g.fill();
      if (ch === 'G') { neon(10, 60, 140); g.fillStyle = 'hsl(140,80%,55%)'; g.beginPath(); g.arc(x + k / 2, y + k / 2, 8, 0, 7); g.fill(); off(); }
    }));
    neon(10, 55, 190); g.fillStyle = 'hsl(190,85%,60%)'; rr(g, ox + 7, oy + 4 * k + 7, 16, 16, 4); g.fill(); off();
    g.fillStyle = '#06161c'; g.beginPath(); g.arc(ox + 12, oy + 4 * k + 14, 2, 0, 7); g.arc(ox + 18, oy + 4 * k + 14, 2, 0, 7); g.fill();
    g.strokeStyle = 'hsla(190,85%,70%,.7)'; g.lineWidth = 3; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(ox + 15, oy + 4 * k + 15); g.lineTo(ox + 4 * k + 15, oy + 4 * k + 15); g.lineTo(ox + 4 * k + 15, oy + 2 * k + 15); g.stroke(); g.setLineDash([]);
    for (let i = 0; i < 5; i++) { g.fillStyle = i < 3 ? 'hsl(190,85%,60%)' : 'rgba(255,255,255,.14)'; rr(g, ox + 232 - 70 + i * 14, 160, 11, 11, 3); g.fill(); }
  },

  bridgebuilder(g, W, H, C, neon, off) {
    g.fillStyle = '#2b2f45'; g.fillRect(0, 120, 80, 60); g.fillRect(240, 120, 80, 60);
    g.fillStyle = '#10131f'; g.fillRect(80, 150, 160, 30);
    const J = [[80, 120], [120, 120], [160, 120], [200, 120], [240, 120], [120, 92], [160, 84], [200, 92]];
    const M = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 4], [1, 5], [5, 2], [2, 6], [2, 7], [3, 7]];
    neon(8, 55, 28); g.strokeStyle = 'hsl(28,90%,62%)'; g.lineWidth = 4;
    for (const [a, b] of M) { g.beginPath(); g.moveTo(...J[a]); g.lineTo(...J[b]); g.stroke(); }
    off(); g.fillStyle = '#eef2fa'; for (const p of J) { g.beginPath(); g.arc(p[0], p[1], 4, 0, 7); g.fill(); }
    g.fillStyle = 'hsl(350,80%,58%)'; rr(g, 128, 99, 36, 15, 4); g.fill(); g.fillStyle = '#10131f';
    g.beginPath(); g.arc(138, 116, 5, 0, 7); g.arc(156, 116, 5, 0, 7); g.fill();
  },

  cannoncrush(g, W, H, C, neon, off) {
    g.fillStyle = '#2b2f45'; g.beginPath(); g.moveTo(0, 180); g.lineTo(0, 118); g.quadraticCurveTo(60, 100, 110, 128); g.lineTo(150, 150); g.quadraticCurveTo(170, 160, 190, 140); g.quadraticCurveTo(250, 90, 320, 110); g.lineTo(320, 180); g.closePath(); g.fill();
    const cannon = (x, y, a, col) => { g.save(); g.translate(x, y); g.fillStyle = `hsl(${col},80%,58%)`; g.beginPath(); g.arc(0, 0, 11, Math.PI, 0); g.fill(); g.rotate(a); g.fillRect(0, -3.5, 22, 7); g.restore(); };
    cannon(48, 114, -0.7, 190); cannon(272, 106, -Math.PI + 0.7, 350);
    neon(6, 60, 48); g.strokeStyle = 'hsla(48,100%,70%,.8)'; g.lineWidth = 2; g.setLineDash([2, 6]); g.beginPath(); g.moveTo(64, 100); g.quadraticCurveTo(150, 10, 250, 96); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'hsl(48,100%,66%)'; g.beginPath(); g.arc(250, 98, 5, 0, 7); g.fill(); off();
  },

  railswitch(g, W, H, C, neon, off) {
    const track = (pts, col) => { g.strokeStyle = col; g.lineWidth = 7; g.lineJoin = 'round'; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
    g.lineCap = 'round';
    track([[30, 90], [110, 90], [170, 50], [250, 50]], 'rgba(255,255,255,.16)');
    track([[110, 90], [170, 130], [250, 130]], 'rgba(255,255,255,.16)');
    neon(8, 58, 350); track([[110, 90], [170, 50], [250, 50]], 'hsl(350,85%,62%)'); off();
    g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(110, 90, 7, 0, 7); g.fill();
    g.fillStyle = 'hsl(205,85%,60%)'; rr(g, 40, 80, 26, 18, 5); g.fill(); g.fillStyle = 'hsl(350,85%,62%)'; rr(g, 70, 80, 26, 18, 5); g.fill();
    g.fillStyle = 'hsl(350,85%,62%)'; rr(g, 250, 38, 30, 24, 5); g.fill(); g.fillStyle = 'hsl(205,85%,60%)'; rr(g, 250, 118, 30, 24, 5); g.fill();
  },
};
