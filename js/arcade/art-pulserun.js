/* ============================================================
   arcade/art-pulserun.js — the cabinet picture of Pulse Run, drawn in
   code on the 320 × 180 canvas the Arcade gives each game (see ART in
   ../apps/arcade.js: art(g, W, H, C, neon, off)).
   Still picture: nothing moves, so reduced motion changes nothing.
   Decoration only: no numbers that could read as statistics.
   ============================================================ */
export const ART_PULSERUN = {
  pulserun(g, W, H) {
    /* the beat bars of the backdrop */
    g.fillStyle = '#6fd6ff';
    for (let i = 0; i < 16; i++) { const h = 24 + ((i * 37) % 53); g.globalAlpha = 0.13; g.fillRect(8 + i * 20, 148 - h, 14, h); }
    g.globalAlpha = 1;
    /* the floor, with a neon edge, a pit and two spikes */
    const top = 130;
    g.fillStyle = '#1b2a4d'; g.fillRect(0, top, 118, 50); g.fillRect(168, top, 160, 50);
    g.fillStyle = '#7fb2ff'; g.fillRect(0, top, 118, 3); g.fillRect(168, top, 160, 3);
    g.fillStyle = '#ff5577';
    for (const x of [214, 238]) { g.beginPath(); g.moveTo(x - 10, top); g.lineTo(x, top - 22); g.lineTo(x + 10, top); g.closePath(); g.fill(); }
    /* a pad */
    g.fillStyle = '#ffd23f'; g.fillRect(26, top - 7, 36, 7); g.fillRect(34, top - 12, 20, 5);
    /* the bead's jump over the pit, and its trail */
    g.strokeStyle = 'rgba(255,244,194,.35)'; g.lineWidth = 3; g.setLineDash([2, 7]); g.lineCap = 'round';
    g.beginPath(); g.moveTo(52, top - 14); g.quadraticCurveTo(110, 4, 168, top - 18); g.stroke(); g.setLineDash([]);
    const bx = 142, by = 52;
    g.fillStyle = 'rgba(255,244,194,.22)'; g.beginPath(); g.arc(bx, by, 22, 0, 7); g.fill();
    g.fillStyle = '#fff4c2'; g.beginPath(); g.arc(bx, by, 14, 0, 7); g.fill();
    g.strokeStyle = '#10131c'; g.lineWidth = 3; g.beginPath(); g.moveTo(bx - 8, by - 5); g.lineTo(bx + 8, by + 5); g.stroke();
    g.beginPath(); g.arc(bx, by, 3, 0, 7); g.stroke();
    /* a gravity gate */
    g.strokeStyle = '#7be0ff'; g.lineWidth = 3;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(290, 38 + i * 22, 9, 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(123,224,255,.14)'; g.fillRect(280, 28, 20, 92);
  },
};
