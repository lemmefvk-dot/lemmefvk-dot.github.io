/* ============================================================
   arcade/art-newgames2.js — the cabinet pictures of Color Flood,
   Pond Hopper, Clockwork Heist, Tiny Tactics, Cave Diver, Gravity
   Garden and Orbit Keeper, drawn in code on the 320 × 180 canvas the
   Arcade gives each game (see ART in ../apps/arcade.js:
   art(g, W, H, C, neon, off)). Still pictures: nothing moves.
   ============================================================ */
import { rr } from './kit.js';

export const ART_NEWGAMES2 = {
  colorflood(g, W, H, C, neon, off) {
    /* an 8 × 6 board; the flood in the corner is outlined */
    const cols = ['#ff5c7a', '#ffb02e', '#ffe44d', '#43d17a', '#3ab6ff', '#a37bff'];
    const k = 30, ox = 40, oy = 0;
    const layout = [
      4, 4, 4, 1, 2, 5, 0, 3,
      4, 4, 0, 1, 2, 2, 5, 3,
      4, 3, 0, 0, 1, 5, 5, 0,
      2, 3, 3, 5, 1, 1, 0, 0,
      2, 2, 3, 5, 5, 4, 4, 0,
      1, 2, 2, 0, 3, 3, 4, 4];
    layout.forEach((c, i) => {
      const x = ox + (i % 8) * k, y = oy + 4 + Math.floor(i / 8) * k;
      g.fillStyle = cols[c]; rr(g, x + 1.5, y + 1.5, k - 3, k - 3, 5); g.fill();
    });
    neon(14, 70, 200); g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath();
    g.moveTo(ox + 2, oy + 6); g.lineTo(ox + 3 * k - 2, oy + 6); g.lineTo(ox + 3 * k - 2, oy + 4 + k); g.lineTo(ox + 2 * k - 2, oy + 4 + k); g.lineTo(ox + 2 * k - 2, oy + 4 + 3 * k - 2);
    g.lineTo(ox + 2, oy + 4 + 3 * k - 2); g.closePath(); g.stroke(); off();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(ox + k / 2, oy + 4 + k / 2, 5, 0, 7); g.fill();
  },

  pondhopper(g, W, H, C, neon, off) {
    /* lily pads on dark water, a frog and the knight-move hops between them */
    g.fillStyle = 'rgba(40,120,150,.25)'; g.fillRect(0, 0, W, H);
    const pads = [[60, 50], [130, 30], [200, 50], [260, 100], [200, 140], [130, 100], [60, 130], [150, 160]];
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 2; g.setLineDash([5, 5]); g.beginPath();
    pads.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.setLineDash([]);
    pads.forEach(([x, y], i) => {
      g.fillStyle = i === 0 ? '#2f9e5b' : '#3fbf6d';
      g.beginPath(); g.ellipse(x, y, 26, 18, 0, 0.35, Math.PI * 2 - 0.35); g.lineTo(x, y); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.ellipse(x - 6, y - 5, 9, 4, -0.3, 0, 7); g.fill();
    });
    neon(12, 65, 150);
    g.fillStyle = '#9be564'; g.beginPath(); g.ellipse(130, 28, 13, 10, 0, 0, 7); g.fill(); off();
    g.fillStyle = '#9be564'; g.beginPath(); g.arc(124, 19, 5, 0, 7); g.arc(136, 19, 5, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(124, 19, 2.6, 0, 7); g.arc(136, 19, 2.6, 0, 7); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(124, 19.5, 1.3, 0, 7); g.arc(136, 19.5, 1.3, 0, 7); g.fill();
    g.fillStyle = '#ffb3d1'; g.beginPath(); g.arc(262, 90, 5, 0, 7); g.fill();
  },

  heist(g, W, H, C, neon, off) {
    /* a floor plan: walls, a patrol robot with its sight line, a gem, the thief and the exit */
    const k = 30, ox = 50, oy = 15, cols = 7, rows = 5;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      g.fillStyle = (r + c) % 2 ? '#1c2130' : '#212738'; g.fillRect(ox + c * k, oy + r * k, k, k);
    }
    g.fillStyle = '#5b6584';
    [[2, 1], [2, 2], [4, 2], [4, 3], [5, 0]].forEach(([c, r]) => { rr(g, ox + c * k + 1, oy + r * k + 1, k - 2, k - 2, 4); g.fill(); });
    g.fillStyle = 'rgba(255,70,70,.28)'; g.fillRect(ox + 0 * k, oy + 4 * k, 5 * k, k);
    neon(10, 62, 350); g.fillStyle = '#ff5b5b'; g.beginPath(); g.arc(ox + 5 * k + 15, oy + 4 * k + 15, 10, 0, 7); g.fill(); off();
    g.fillStyle = '#220a0a'; g.fillRect(ox + 5 * k + 9, oy + 4 * k + 11, 12, 5);
    g.fillStyle = '#fff'; g.fillRect(ox + 5 * k + 10, oy + 4 * k + 12, 3, 3);
    neon(10, 70, 48); g.fillStyle = '#ffd24a'; g.beginPath(); g.moveTo(ox + 3 * k + 15, oy + 0 * k + 7); g.lineTo(ox + 3 * k + 23, oy + 0 * k + 15); g.lineTo(ox + 3 * k + 15, oy + 0 * k + 23); g.lineTo(ox + 3 * k + 7, oy + 0 * k + 15); g.closePath(); g.fill(); off();
    g.fillStyle = '#3ad6c4'; g.beginPath(); g.arc(ox + 1 * k + 15, oy + 1 * k + 17, 8, 0, 7); g.fill(); g.fillStyle = '#0d2a27'; g.beginPath(); g.arc(ox + 1 * k + 15, oy + 1 * k + 12, 6, Math.PI, 0); g.fill();
    g.strokeStyle = '#8affc1'; g.lineWidth = 3; rr(g, ox + 6 * k + 3, oy + 2 * k + 3, k - 6, k - 6, 5); g.stroke();
  },

  tactics(g, W, H, C, neon, off) {
    /* a 6 × 6 field: four blue and four orange pieces, a hit marked */
    const k = 27, ox = 79, oy = 9, n = 6;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { g.fillStyle = (r + c) % 2 ? '#222a3a' : '#2a3347'; g.fillRect(ox + c * k, oy + r * k, k, k); }
    g.fillStyle = '#566079'; rr(g, ox + 2 * k + 3, oy + 2 * k + 3, k - 6, k - 6, 4); g.fill(); rr(g, ox + 3 * k + 3, oy + 3 * k + 3, k - 6, k - 6, 4); g.fill();
    const piece = (c, r, shape, col) => {
      const x = ox + c * k + k / 2, y = oy + r * k + k / 2;
      g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.5; g.beginPath();
      if (shape === 0) { g.rect(x - 8, y - 8, 16, 16); }
      else if (shape === 1) { g.moveTo(x, y - 10); g.lineTo(x + 9, y + 8); g.lineTo(x - 9, y + 8); g.closePath(); }
      else if (shape === 2) { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? 4.5 : 10; g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); } g.closePath(); }
      else g.arc(x, y, 8, 0, 7);
      g.fill(); g.stroke();
    };
    neon(8, 60, 205);
    [[1, 4, 0], [2, 5, 1], [3, 4, 2], [4, 5, 3]].forEach(([c, r, s]) => piece(c, r, s, '#3ab6ff')); off();
    neon(8, 60, 28);
    [[1, 0, 3], [2, 1, 2], [3, 0, 1], [4, 1, 0]].forEach(([c, r, s]) => piece(c, r, s, '#ff9a3a')); off();
    g.strokeStyle = '#ff4466'; g.lineWidth = 2.5; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(ox + 3.5 * k, oy + 4 * k); g.lineTo(ox + 3.5 * k, oy + 1.4 * k); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fff'; g.font = '800 12px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('-2', ox + 3.5 * k, oy + 1.2 * k);
  },

  cavediver(g, W, H, C, neon, off) {
    /* a dark shaft, one pool of light around the diver, a tank in it */
    g.fillStyle = '#05080d'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#26303d';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(90, 0); g.quadraticCurveTo(110, 70, 96, 110); g.quadraticCurveTo(84, 150, 110, H); g.lineTo(0, H); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(W, 0); g.lineTo(240, 0); g.quadraticCurveTo(220, 50, 236, 90); g.quadraticCurveTo(250, 140, 226, H); g.lineTo(W, H); g.closePath(); g.fill();
    const lg = g.createRadialGradient(165, 90, 4, 165, 90, 78);
    lg.addColorStop(0, 'rgba(120,220,255,.55)'); lg.addColorStop(1, 'rgba(120,220,255,0)');
    g.fillStyle = lg; g.fillRect(70, 10, 190, 170);
    g.fillStyle = '#3a4656'; g.beginPath(); g.ellipse(190, 55, 13, 10, 0.3, 0, 7); g.fill();
    neon(10, 65, 150); g.fillStyle = '#58f2a2'; rr(g, 199, 104, 12, 22, 5); g.fill(); off();
    g.fillStyle = '#0a2a1a'; g.fillRect(202, 108, 6, 3);
    neon(10, 70, 190); g.fillStyle = '#ffd24a'; g.beginPath(); g.ellipse(160, 92, 9, 12, 0.2, 0, 7); g.fill(); off();
    g.fillStyle = '#7fe3ff'; g.beginPath(); g.arc(163, 86, 4, 0, 7); g.fill();
    g.strokeStyle = 'rgba(180,240,255,.6)'; g.lineWidth = 1.5; [[150, 70, 3], [158, 56, 2], [148, 44, 2.5]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); });
  },

  garden(g, W, H, C, neon, off) {
    /* water falls from a tap, slides off a leaf and reaches a flower; a sun melts ice */
    g.fillStyle = '#5b6584'; g.fillRect(40, 118, 60, 14); g.fillRect(228, 100, 60, 14);
    g.fillStyle = '#7f98b8'; rr(g, 118, 66, 30, 30, 5); g.fill();
    g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(124, 72, 8, 4);
    neon(8, 60, 200); g.fillStyle = '#4db6ff';
    g.fillRect(70, 0, 7, 70); g.fillRect(70, 70, 60, 7); g.fillRect(124, 70, 7, 10);
    g.fillRect(196, 0, 7, 60); g.fillRect(196, 60, 50, 7); g.fillRect(240, 60, 7, 40); off();
    g.fillStyle = '#43d17a'; g.beginPath(); g.ellipse(70, 100, 34, 8, -0.2, 0, 7); g.fill();
    g.beginPath(); g.ellipse(196, 58, 30, 8, 0.15, 0, 7); g.fill();
    const flower = (x, y, hue) => {
      g.fillStyle = '#2f9e5b'; g.fillRect(x - 1.5, y, 3, 22);
      neon(8, 65, hue); g.fillStyle = `hsl(${hue},85%,62%)`;
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.arc(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 6, 0, 7); g.fill(); }
      off(); g.fillStyle = '#ffe44d'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
    };
    flower(70, 128, 330); flower(258, 90, 280);
    neon(18, 70, 48); g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(280, 30, 14, 0, 7); g.fill(); off();
    g.strokeStyle = '#ffd24a'; g.lineWidth = 2.5; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(280 + Math.cos(a) * 19, 30 + Math.sin(a) * 19); g.lineTo(280 + Math.cos(a) * 26, 30 + Math.sin(a) * 26); g.stroke(); }
  },

  orbit(g, W, H, C, neon, off) {
    /* a planet, three rings, a ship, fuel and debris */
    const cx = W / 2, cy = H / 2;
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1.5;
    [38, 62, 86].forEach(r => { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); });
    const pg = g.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 22);
    pg.addColorStop(0, '#9fd8ff'); pg.addColorStop(1, '#2a5f9e');
    g.fillStyle = pg; g.beginPath(); g.arc(cx, cy, 22, 0, 7); g.fill();
    const at = (r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    neon(12, 70, 160); g.fillStyle = '#58f2a2'; { const [x, y] = at(62, -2.2); rr(g, x - 6, y - 8, 12, 16, 4); g.fill(); } off();
    g.fillStyle = '#9a8f86'; { const [x, y] = at(86, 0.4); g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x - 3, y - 8); g.lineTo(x + 7, y - 5); g.lineTo(x + 8, y + 5); g.lineTo(x - 2, y + 8); g.closePath(); g.fill(); }
    { const [x, y] = at(38, 2.4); g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.closePath(); g.fill(); }
    neon(14, 70, 190); g.fillStyle = '#fff'; { const [x, y] = at(62, 0.8); g.save(); g.translate(x, y); g.rotate(0.8 + Math.PI / 2); g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 4); g.lineTo(-6, 7); g.closePath(); g.fill(); g.restore(); } off();
  },
};
