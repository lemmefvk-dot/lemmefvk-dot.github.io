/* ============================================================
   arcade/jigsaw-art.js — pictures for Photo Jigsaw drawn in code,
   for anyone with no photo to hand. No image files and nothing
   fetched: each scene is painted on a canvas from a fixed seed, so
   it is the same picture every time, at any size.

     PICTURES                 [{ id, name }]
     drawPicture(id, w, h)    a canvas w × h with the scene, or null

   Every scene is busy enough to be pieced together: many shapes and
   colours, so no two pieces look alike.
   ============================================================ */
import { rng } from './kit.js';

export const PICTURES = [
  { id: 'valley', name: 'Sunset Valley' },
  { id: 'reef', name: 'Coral Reef' },
  { id: 'city', name: 'Night City' },
  { id: 'balloons', name: 'Balloon Festival' },
  { id: 'quilt', name: 'Patchwork Quilt' },
];
export const isPicture = id => PICTURES.some(p => p.id === id);

const lin = (g, x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
const ridge = (r, w, n) => { const a = Array.from({ length: n }, () => [r() * 6.28, 0.5 + r() * 2.5, r()]); return x => a.reduce((s, [p, f, k]) => s + Math.sin(x / w * 6.28 * f + p) * (0.4 + k) / n, 0); };

function valley(g, w, h, r) {
  g.fillStyle = lin(g, 0, 0, 0, h * 0.7, [[0, '#2b1f5c'], [0.45, '#a3407a'], [0.8, '#ff8a4c'], [1, '#ffd27a']]);
  g.fillRect(0, 0, w, h);
  const sx = w * 0.68, sy = h * 0.52, sr = h * 0.11;
  const glow = g.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 4);
  glow.addColorStop(0, 'rgba(255,240,180,.75)'); glow.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = glow; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff2c4'; g.beginPath(); g.arc(sx, sy, sr, 0, 7); g.fill();
  /* clouds in bands */
  g.fillStyle = 'rgba(255,190,170,.35)';
  for (let k = 0; k < 7; k++) { const y = h * (0.12 + r() * 0.3), x = r() * w, L = w * (0.15 + r() * 0.25); g.beginPath(); g.ellipse(x, y, L / 2, h * 0.012 + r() * h * 0.01, 0, 0, 7); g.fill(); }
  /* ridges, far to near */
  const cols = ['#8a4d8f', '#64397a', '#432a5e', '#2a1d40'];
  cols.forEach((c, k) => {
    const f = ridge(r, w, 4), base = h * (0.55 + k * 0.1), amp = h * (0.12 - k * 0.015);
    g.fillStyle = c; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, base + f(x) * amp);
    g.lineTo(w, h); g.closePath(); g.fill();
    if (k === 3) {
      /* pines along the nearest ridge */
      g.fillStyle = '#170f26';
      for (let i = 0; i < 26; i++) {
        const x = r() * w, y = base + f(x) * amp + 4, th = h * (0.05 + r() * 0.07);
        g.beginPath(); g.moveTo(x, y - th); g.lineTo(x - th * 0.28, y); g.lineTo(x + th * 0.28, y); g.closePath(); g.fill();
      }
    }
  });
  /* a lake with the sun's reflection */
  g.fillStyle = lin(g, 0, h * 0.86, 0, h, [[0, '#3b2c5e'], [1, '#1b1430']]);
  g.fillRect(0, h * 0.88, w, h * 0.12);
  g.fillStyle = 'rgba(255,220,150,.55)';
  for (let k = 0; k < 9; k++) { const y = h * (0.9 + k * 0.011), L = sr * (1.6 - k * 0.12); g.fillRect(sx - L / 2 + (r() - 0.5) * 10, y, L, 2); }
  /* birds */
  g.strokeStyle = '#2a1d40'; g.lineWidth = Math.max(1.5, w / 500);
  for (let i = 0; i < 9; i++) { const x = w * (0.15 + r() * 0.45), y = h * (0.18 + r() * 0.25), s = w * (0.008 + r() * 0.008); g.beginPath(); g.moveTo(x - s, y); g.quadraticCurveTo(x - s / 2, y - s * 0.7, x, y); g.quadraticCurveTo(x + s / 2, y - s * 0.7, x + s, y); g.stroke(); }
}

function reef(g, w, h, r) {
  g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#4fd2e8'], [0.4, '#1a8fc0'], [1, '#0b3463']]);
  g.fillRect(0, 0, w, h);
  /* light rays */
  for (let k = 0; k < 6; k++) { const x = r() * w; g.fillStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w * 0.06, 0); g.lineTo(x + w * 0.2, h); g.lineTo(x + w * 0.08, h); g.closePath(); g.fill(); }
  /* the sea floor */
  const f = ridge(r, w, 3);
  g.fillStyle = '#e8c98a'; g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 6) g.lineTo(x, h * 0.84 + f(x) * h * 0.04);
  g.lineTo(w, h); g.fill();
  g.fillStyle = 'rgba(160,120,70,.35)';
  for (let i = 0; i < 70; i++) { g.beginPath(); g.arc(r() * w, h * (0.86 + r() * 0.14), 1 + r() * 3, 0, 7); g.fill(); }
  /* seaweed */
  for (let i = 0; i < 14; i++) {
    const x = r() * w, len = h * (0.2 + r() * 0.3), ph = r() * 6;
    g.strokeStyle = ['#2e9b57', '#4fbf6a', '#1f7a4a'][i % 3]; g.lineWidth = w * 0.006; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, h * 0.88);
    for (let t = 0; t <= 1; t += 0.05) g.lineTo(x + Math.sin(t * 9 + ph) * w * 0.012, h * 0.88 - t * len);
    g.stroke();
  }
  /* branching corals */
  const branch = (x, y, a, len, d, col) => {
    if (d === 0 || len < 3) return;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    g.strokeStyle = col; g.lineWidth = Math.max(2, d * w * 0.0028); g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    branch(x2, y2, a - 0.35 - r() * 0.3, len * 0.74, d - 1, col);
    branch(x2, y2, a + 0.35 + r() * 0.3, len * 0.74, d - 1, col);
  };
  const corals = ['#ff6f91', '#ff9f43', '#c56cf0', '#ff4757', '#ffd166'];
  for (let i = 0; i < 9; i++) branch(w * (0.05 + i * 0.11 + r() * 0.04), h * 0.88, -Math.PI / 2 + (r() - 0.5) * 0.4, h * (0.07 + r() * 0.05), 6, corals[i % corals.length]);
  /* brain corals */
  for (let i = 0; i < 5; i++) { const x = r() * w, y = h * 0.88; g.fillStyle = ['#f78fb3', '#f5cd79', '#a29bfe'][i % 3]; g.beginPath(); g.ellipse(x, y, w * 0.04, h * 0.045, 0, Math.PI, 0); g.fill(); }
  /* fish */
  const fishCols = [['#ffb142', '#ffffff'], ['#ff5252', '#ffd32a'], ['#34ace0', '#ffffff'], ['#ffda79', '#33d9b2'], ['#706fd3', '#ff793f']];
  for (let i = 0; i < 16; i++) {
    const x = r() * w, y = h * (0.12 + r() * 0.6), s = w * (0.018 + r() * 0.025), dir = r() < 0.5 ? -1 : 1, [c1, c2] = fishCols[i % fishCols.length];
    g.save(); g.translate(x, y); g.scale(dir, 1);
    g.fillStyle = c1; g.beginPath(); g.ellipse(0, 0, s, s * 0.55, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-s * 0.8, 0); g.lineTo(-s * 1.5, -s * 0.5); g.lineTo(-s * 1.5, s * 0.5); g.closePath(); g.fill();
    g.fillStyle = c2; g.fillRect(-s * 0.15, -s * 0.5, s * 0.22, s);
    g.fillStyle = '#111'; g.beginPath(); g.arc(s * 0.55, -s * 0.12, s * 0.1, 0, 7); g.fill();
    g.restore();
  }
  /* bubbles */
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.5;
  for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(r() * w, r() * h * 0.8, 2 + r() * 7, 0, 7); g.stroke(); }
}

function city(g, w, h, r) {
  g.fillStyle = lin(g, 0, 0, 0, h * 0.75, [[0, '#0b1030'], [0.6, '#2a1f5e'], [1, '#7b3f8c']]);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 220; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; g.fillRect(r() * w, r() * h * 0.5, 1 + r() * 1.6, 1 + r() * 1.6); }
  /* the moon */
  g.fillStyle = '#fdf3c8'; g.beginPath(); g.arc(w * 0.18, h * 0.16, h * 0.07, 0, 7); g.fill();
  g.fillStyle = '#141a45'; g.beginPath(); g.arc(w * 0.18 + h * 0.03, h * 0.15, h * 0.065, 0, 7); g.fill();
  /* two rows of towers, back then front */
  const water = h * 0.78;
  const towers = (n, hmin, hmax, shade) => {
    let x = -10;
    while (x < w) {
      const bw = w * (0.04 + r() * 0.07), bh = h * (hmin + r() * (hmax - hmin));
      const hue = 220 + r() * 80;
      g.fillStyle = `hsl(${hue},${25 + r() * 20}%,${shade + r() * 8}%)`;
      g.fillRect(x, water - bh, bw, bh);
      if (r() < 0.3) { g.fillRect(x + bw * 0.4, water - bh - h * 0.04, bw * 0.08, h * 0.04); }
      /* windows */
      const cw = Math.max(4, bw / 7), chh = Math.max(5, h * 0.018);
      for (let yy = water - bh + chh; yy < water - chh; yy += chh * 1.6) for (let xx = x + cw * 0.6; xx < x + bw - cw; xx += cw * 1.5) {
        if (r() < 0.45) { g.fillStyle = ['#ffe28a', '#ffd166', '#9ee7ff', '#ffb3c7'][Math.floor(r() * 4)]; g.fillRect(xx, yy, cw * 0.8, chh * 0.8); }
      }
      x += bw + w * (0.002 + r() * 0.01);
    }
  };
  towers(0, 0.25, 0.5, 18);
  towers(0, 0.12, 0.32, 10);
  /* the river, with the city in it */
  g.fillStyle = lin(g, 0, water, 0, h, [[0, '#1d1a4a'], [1, '#090b20']]);
  g.fillRect(0, water, w, h - water);
  for (let i = 0; i < 160; i++) {
    const x = r() * w, y = water + r() * (h - water), L = w * (0.01 + r() * 0.04);
    g.fillStyle = `rgba(${r() < 0.5 ? '255,214,120' : '158,231,255'},${0.15 + r() * 0.35})`;
    g.fillRect(x, y, L, 2);
  }
  /* a bridge */
  g.strokeStyle = '#ff7eb6'; g.lineWidth = Math.max(2, w / 300);
  g.beginPath(); g.moveTo(w * 0.55, water - 2); g.lineTo(w, water - 2); g.stroke();
  for (let k = 0; k < 2; k++) { const px = w * (0.65 + k * 0.22); g.beginPath(); g.moveTo(px, water - 2); g.lineTo(px, water - h * 0.16); g.stroke(); g.beginPath(); g.moveTo(px - w * 0.1, water - 2); g.quadraticCurveTo(px, water - h * 0.2, px + w * 0.1, water - 2); g.stroke(); }
}

function balloons(g, w, h, r) {
  g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#6ec6ff'], [0.7, '#cdeeff'], [1, '#fff6e0']]);
  g.fillRect(0, 0, w, h);
  /* clouds */
  for (let i = 0; i < 7; i++) {
    const cx = r() * w, cy = h * (0.08 + r() * 0.5), s = w * (0.04 + r() * 0.05);
    g.fillStyle = 'rgba(255,255,255,.9)';
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(cx + (k - 2.5) * s * 0.6, cy + Math.sin(k * 2.1) * s * 0.25, s * (0.5 + r() * 0.35), 0, 7); g.fill(); }
  }
  /* fields */
  const fields = ['#7fc96b', '#a5d66b', '#5fae5a', '#d8c96a', '#8fd18a'];
  for (let k = 0; k < 5; k++) {
    const f = ridge(r, w, 3), base = h * (0.72 + k * 0.06);
    g.fillStyle = fields[k]; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) g.lineTo(x, base + f(x) * h * 0.03);
    g.lineTo(w, h); g.fill();
  }
  /* balloons */
  const pal = [['#ff4d6d', '#ffd166'], ['#3a86ff', '#ffffff'], ['#8338ec', '#ff9f1c'], ['#06d6a0', '#ef476f'], ['#ff6b35', '#004e89'], ['#f72585', '#4cc9f0'], ['#ffbe0b', '#3a0ca3']];
  for (let i = 0; i < 7; i++) {
    const cx = w * (0.08 + i * 0.135 + (r() - 0.5) * 0.05), cy = h * (0.18 + r() * 0.4), R = w * (0.035 + r() * 0.04), [c1, c2] = pal[i];
    const stripes = 6;
    for (let s = 0; s < stripes; s++) {
      g.fillStyle = s % 2 ? c2 : c1;
      g.beginPath();
      const a0 = -1 + (s / stripes) * 2, a1 = -1 + ((s + 1) / stripes) * 2;
      g.moveTo(cx + a0 * R * 0.3, cy + R * 1.1);
      g.bezierCurveTo(cx + a0 * R * 1.5, cy + R * 0.3, cx + a0 * R * 1.2, cy - R * 1.1, cx, cy - R * 1.15);
      g.bezierCurveTo(cx + a1 * R * 1.2, cy - R * 1.1, cx + a1 * R * 1.5, cy + R * 0.3, cx + a1 * R * 0.3, cy + R * 1.1);
      g.closePath(); g.fill();
    }
    g.strokeStyle = '#5b4636'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx - R * 0.3, cy + R * 1.1); g.lineTo(cx - R * 0.18, cy + R * 1.5); g.moveTo(cx + R * 0.3, cy + R * 1.1); g.lineTo(cx + R * 0.18, cy + R * 1.5); g.stroke();
    g.fillStyle = '#8a5a3b'; g.fillRect(cx - R * 0.2, cy + R * 1.5, R * 0.4, R * 0.3);
  }
}

function quilt(g, w, h, r) {
  const pal = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#264653', '#8ecae6', '#ffb4a2', '#6d597a', '#b5e48c', '#ff006e', '#3a86ff', '#ffbe0b'];
  const n = 8, cw = w / n, ch = h / Math.round(n * h / w);
  const rows = Math.round(h / ch);
  for (let y = 0; y < rows; y++) for (let x = 0; x < n; x++) {
    const X = x * cw, Y = y * ch, a = pal[Math.floor(r() * pal.length)], b = pal[Math.floor(r() * pal.length)], kind = Math.floor(r() * 6);
    g.fillStyle = a; g.fillRect(X, Y, cw, ch);
    g.fillStyle = b;
    if (kind === 0) { g.beginPath(); g.moveTo(X, Y); g.lineTo(X + cw, Y + ch); g.lineTo(X, Y + ch); g.fill(); }
    else if (kind === 1) { g.beginPath(); g.arc(X + cw / 2, Y + ch / 2, Math.min(cw, ch) * 0.34, 0, 7); g.fill(); }
    else if (kind === 2) { for (let k = 0; k < 4; k++) g.fillRect(X, Y + k * ch / 4, cw, ch / 8); }
    else if (kind === 3) { g.beginPath(); g.moveTo(X + cw / 2, Y + ch * 0.1); g.lineTo(X + cw * 0.9, Y + ch / 2); g.lineTo(X + cw / 2, Y + ch * 0.9); g.lineTo(X + cw * 0.1, Y + ch / 2); g.fill(); }
    else if (kind === 4) { g.fillRect(X + cw * 0.25, Y, cw * 0.5, ch); g.fillStyle = pal[(pal.indexOf(b) + 3) % pal.length]; g.fillRect(X, Y + ch * 0.25, cw, ch * 0.5); }
    else { for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(X + cw * (0.2 + k * 0.3), Y + ch * (0.25 + (k % 2) * 0.5), Math.min(cw, ch) * 0.12, 0, 7); g.fill(); } }
    /* stitches */
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(1, w / 700); g.setLineDash([w / 160, w / 220]);
    g.strokeRect(X + cw * 0.05, Y + ch * 0.05, cw * 0.9, ch * 0.9); g.setLineDash([]);
  }
}

const SCENES = { valley, reef, city, balloons, quilt };
const SEEDS = { valley: 0x5a11e7, reef: 0xc0a1, city: 0xc17e, balloons: 0xba11, quilt: 0x9417 };

/** the scene `id` painted on a new w × h canvas (the same picture every time), or null */
export function drawPicture(id, w = 1280, h = 960) {
  const scene = SCENES[id];
  if (!scene) return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d');
  if (!g) return null;
  /* drawn on a 1280 × 960 plan and scaled, so a thumbnail is the same picture as the puzzle */
  g.scale(c.width / 1280, c.height / 960);
  scene(g, 1280, 960, rng(SEEDS[id]));
  return c;
}
