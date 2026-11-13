/* ============================================================
   pumpkin.js — Pumpkin Carver: carve a jack-o'-lantern, light
   it, and put it on your desktop.

   CARVING
   · Knife: press and drag to draw a shape; let go and it is cut
     out (the outline closes itself). A scribble too small to be a
     shape is ignored, and the hint line says why.
   · Stamps: a triangle, circle, diamond, star, crescent and a
     toothy grin. Click (or tap) to stamp one at its usual size,
     or drag a box to size it — drag upward or leftward to flip it.
     Arrow keys move a stamp cursor and Enter stamps there, so a
     face can be carved from the keyboard too.
   · Mirror copies every cut to the other side of the pumpkin.
   · Faces drops in a ready-made face (Classic, Spooky, Happy) as
     one step. Undo / Redo step through cuts (Ctrl/⌘ Z, ⇧ Z or Y);
     Reset clears the pumpkin, and Undo straight after brings it
     back. Shape picks a round, tall or wide pumpkin; cuts are
     kept in the pumpkin's own units, so they survive a change.
   Cuts are clipped to the pumpkin's skin: nothing is cut outside
   it. Each hole shows its cut wall (paler flesh along the bottom
   edge) and the inside of the pumpkin.

   LIGHT
   The candle (L) lights the inside: the holes glow from a point
   low in the pumpkin, the glow spills onto the ground, and it
   flickers — steadily, with no flicker, under reduced motion.
   The flicker loop only runs while the candle is lit and the tab
   is visible; an unlit pumpkin is drawn only when something
   changes.

   SAVING
   · Set as wallpaper renders a 1920×1080 scene (what you see,
     lit or not, without the flicker) as a JPEG and saves it with
     the existing wallpaper list (portal/wallpapers.js: add +
     setActive), the same way Photos does — wallpapers live in
     localStorage, so only the newest carving is kept as a
     wallpaper and an older one is replaced. If the browser does
     not keep the setting (storage full), it is taken off again
     and the old wallpaper comes back.
   · Save to Pictures writes a real 1920×1080 PNG to ~/Pictures
     (core/media.js), which then opens in Photos.
   Both need at least one cut. Either one, once it has succeeded,
   emits bus 'pumpkin:carved' { to: 'wallpaper'|'pictures', cuts,
   path? } — the achievements listen for it.

   STORAGE
   The carving (shape, cuts, candle) is kept in IndexedDB
   (db.js kv('misc') 'pumpkin.doc') so closing the window keeps
   it; tool, stamp and mirror live in store 'portal.pumpkin'.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { save as mediaSave } from '../core/media.js';
import { kv } from '../core/db.js';
import * as WP from '../portal/wallpapers.js';
import * as profiles from '../core/profiles.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-pumpkin-css')) {
  const l = document.createElement('link');
  l.id = 'feat-pumpkin-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-pumpkin.css';
  document.head.appendChild(l);
}

const misc = kv('misc');
const DOC_KEY = 'pumpkin.doc';
const PREF_KEY = 'portal.pumpkin';
const WP_NAME = 'Jack-o’-lantern';
const WP_BY = 'Pumpkin Carver';
const WP_MAX = 1.4 * 1024 * 1024;     /* a wallpaper data URL is saved in localStorage */
const OUT_W = 1920, OUT_H = 1080;
const MAX_STEPS = 240;
const DEPTH = 9;                       /* how much cut wall shows, in pumpkin units */

const SHAPES = {
  round: { label: 'Round', rx: 300, ry: 236, lobes: 5 },
  tall:  { label: 'Tall',  rx: 238, ry: 292, lobes: 5 },
  wide:  { label: 'Wide',  rx: 350, ry: 198, lobes: 7 },
};

/* stamp outlines in a unit box (-1..1); `w`/`h` = half-size at a click */
const ring = (n = 32) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; });
function starPts(n = 5, inner = 0.45) {
  const out = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? inner : 1;
    out.push([Math.cos(a) * r, Math.sin(a) * r * 1.05 + 0.08]);
  }
  return out;
}
function crescentPts() {
  const out = [];
  for (let i = 0; i <= 20; i++) { const t = -Math.PI / 2 + (i / 20) * Math.PI; out.push([-Math.cos(t), Math.sin(t)]); }
  for (let i = 20; i >= 0; i--) { const t = -Math.PI / 2 + (i / 20) * Math.PI; out.push([-Math.cos(t) * 0.38, Math.sin(t) * 0.92]); }
  return out.map(([x, y]) => [x * 1.4 + 0.3, y]);
}
function grinPts() {
  const top = x => -0.6 + 0.5 * (1 - x * x), bot = x => -0.6 + 1.5 * (1 - x * x);
  const teeth = [[-0.42, -0.2], [0.2, 0.42]], fang = [-0.11, 0.11];
  const out = [];
  const xs = [];
  for (let i = 0; i <= 24; i++) xs.push(-1 + (i / 24) * 2);
  for (const [a, b] of [...teeth]) xs.push(a, a + 1e-4, b, b + 1e-4);
  xs.sort((a, b) => a - b);
  for (const x of xs) {
    const inTooth = teeth.some(([a, b]) => x > a && x <= b);
    out.push([x, top(x) + (inTooth ? 0.32 : 0)]);
  }
  const ys = [];
  for (let i = 24; i >= 0; i--) ys.push(-1 + (i / 24) * 2);
  ys.push(fang[1] + 1e-4, fang[1], fang[0] + 1e-4, fang[0]);
  ys.sort((a, b) => b - a);
  for (const x of ys) {
    const inFang = x > fang[0] && x <= fang[1];
    out.push([x, bot(x) - (inFang ? 0.3 : 0)]);
  }
  return out.map(([x, y]) => [x, (y - 0.15) / 0.75]);
}
const STAMPS = [
  { id: 'tri',     label: 'Triangle', w: 34, h: 30, svg: '<path d="M12 4 21 19H3z"/>', unit: () => [[0, -1], [1, 1], [-1, 1]] },
  { id: 'circle',  label: 'Circle',   w: 26, h: 26, svg: '<circle cx="12" cy="12" r="8"/>', unit: () => ring(36) },
  { id: 'diamond', label: 'Diamond',  w: 24, h: 30, svg: '<path d="M12 3 19 12 12 21 5 12z"/>', unit: () => [[0, -1], [1, 0], [0, 1], [-1, 0]] },
  { id: 'star',    label: 'Star',     w: 34, h: 34, svg: '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6-4.5-4.1 6-.7z"/>', unit: () => starPts() },
  { id: 'moon',    label: 'Crescent', w: 26, h: 32, svg: '<path d="M15 3.5a8.5 8.5 0 1 0 0 17 6.8 6.8 0 0 1 0-17z"/>', unit: () => crescentPts() },
  { id: 'grin',    label: 'Grin',     w: 110, h: 52, svg: '<path d="M3 9c3 4 15 4 18 0-1 7-5 10-9 10S4 16 3 9z"/><path d="M8 11.5v2.5M16 11.5v2.5"/>', unit: () => grinPts() },
];
const stampOf = id => STAMPS.find(s => s.id === id) || STAMPS[0];

const KNIFE_SVG = '<path d="M20 3 8.5 14.5"/><path d="M20 3c.6 2.8-.8 6.2-3.6 9l-3.3 3.3-2.2-2.2"/><path d="m8.5 14.5-4.7 4.7a1.4 1.4 0 0 0 2 2l4.7-4.7"/>';
const STAMP_SVG = '<rect x="4" y="15" width="16" height="5" rx="1.5"/><path d="M9 15v-3.5a3 3 0 1 1 6 0V15"/>';
const MIRROR_SVG = '<path d="M12 3v18" stroke-dasharray="2 2.4"/><path d="M9 7 4 12l5 5V7z"/><path d="M15 7l5 5-5 5V7z"/>';
const REDO_SVG = '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>';
const FACE_SVG = '<circle cx="12" cy="12" r="9"/><path d="M8 10h.01M16 10h.01M8 14.5c2.2 2 5.8 2 8 0"/>';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const svgOf = body => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------------------------------------------------------------
   geometry
   --------------------------------------------------------------- */
function stampPts(id, cx, cy, hw, hh, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return stampOf(id).unit().map(([ux, uy]) => {
    const x = ux * hw, y = uy * hh;
    return [Math.round((cx + x * c - y * s) * 10) / 10, Math.round((cy + x * s + y * c) * 10) / 10];
  });
}

function area(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}

/* Ramer–Douglas–Peucker: keeps a freehand outline small to store */
function simplify(pts, eps) {
  if (pts.length < 4) return pts.slice();
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
    t = clamp(t, 0, 1);
    const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return x * x + y * y;
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, at = -1;
    for (let i = a + 1; i < b; i++) { const d = d2(pts[i], pts[a], pts[b]); if (d > max) { max = d; at = i; } }
    if (at >= 0 && max > eps * eps) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

const mirrored = pts => pts.map(([x, y]) => [-x, y]).reverse();

function lobes(sh) {
  const n = sh.lobes, lw = sh.rx * (n > 5 ? 0.34 : 0.42), out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const cx = t * (sh.rx - lw);
    const ry = sh.ry * (1 - Math.abs(t) * 0.1);
    out.push({ cx, rx: lw * (1 - Math.abs(t) * 0.06), ry, t });
  }
  /* outer lobes first, the middle one on top */
  return out.sort((a, b) => Math.abs(b.t) - Math.abs(a.t));
}

/* the pumpkin's outline (a union of lobes), in pumpkin units, scaled */
function bodyPath(g, sh, s = 1) {
  g.beginPath();
  for (const l of lobes(sh)) {
    g.moveTo(l.cx * s + l.rx * s, 0);
    g.ellipse(l.cx * s, 0, l.rx * s, l.ry * s, 0, 0, Math.PI * 2);
  }
}

/* ---------------------------------------------------------------
   painting — shared by the screen and the 1920×1080 export.
   T = { k, cx, cy }: pumpkin units → pixels.
   --------------------------------------------------------------- */
function paintScene(g, W, H, T, sh) {
  const groundY = T.cy + sh.ry * T.k * 0.9;
  const sky = g.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#05030c');
  sky.addColorStop(0.6, '#150b26');
  sky.addColorStop(1, '#2c1430');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const n = Math.round((W * H) / 9000);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(240,230,255,${0.18 + hash(i + 3) * 0.55})`;
    const s = hash(i + 8) < 0.1 ? 2 : 1.2;
    g.fillRect(hash(i) * W, hash(i + 41) * groundY * 0.8, s, s);
  }
  /* the moon, up and to the left */
  const mr = Math.min(W, H) * 0.065, mx = W * 0.16, my = H * 0.2;
  const halo = g.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 5);
  halo.addColorStop(0, 'rgba(255,238,200,.26)');
  halo.addColorStop(0.4, 'rgba(150,110,220,.08)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);
  const moon = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
  moon.addColorStop(0, '#fffbea');
  moon.addColorStop(1, '#e6d6a8');
  g.fillStyle = moon;
  g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(150,130,90,.2)';
  for (const [a, b, s] of [[-0.3, -0.2, 0.2], [0.28, 0.18, 0.15], [0.02, 0.45, 0.1]]) {
    g.beginPath(); g.arc(mx + a * mr, my + b * mr, s * mr, 0, Math.PI * 2); g.fill();
  }
  /* hills and two bare trees */
  const hill = (base, amp, col, seed) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, groundY + 2);
    for (let x = 0; x <= W + 24; x += 24) g.lineTo(x, base + Math.sin(x * 0.004 + seed) * amp + Math.sin(x * 0.011 + seed * 3) * amp * 0.4);
    g.lineTo(W, groundY + 2);
    g.closePath();
    g.fill();
  };
  hill(groundY - H * 0.12, H * 0.03, '#120a20', 1.7);
  hill(groundY - H * 0.05, H * 0.02, '#0c0716', 5.2);
  g.strokeStyle = '#07040d';
  g.lineCap = 'round';
  const branch = (x, y, len, ang, w, depth, seed) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    if (depth <= 0) return;
    const k = hash(depth * 7 + seed);
    branch(x2, y2, len * 0.7, ang - 0.4 - k * 0.25, w * 0.65, depth - 1, seed + 1);
    branch(x2, y2, len * 0.64, ang + 0.34 + k * 0.3, w * 0.6, depth - 1, seed + 2);
  };
  const tl = Math.min(H * 0.2, W * 0.12);
  /* the trees stand on the side away from the pumpkin */
  const tx = T.cx > W * 0.6 ? [0.07, 0.24] : [0.86, 0.95];
  branch(W * tx[0], groundY - H * 0.03, tl, -Math.PI / 2 + 0.08, Math.max(3, tl * 0.08), 6, 3);
  branch(W * tx[1], groundY - H * 0.04, tl * 0.7, -Math.PI / 2 - 0.1, Math.max(2, tl * 0.06), 5, 9);
  /* bats */
  g.fillStyle = '#07040d';
  for (const [bx, by, s] of [[0.68, 0.14, 1], [0.74, 0.2, 0.7], [0.3, 0.1, 0.6]]) {
    const x = W * bx, y = H * by, r = Math.min(W, H) * 0.014 * s;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x - r * 0.6, y - r * 0.9, x - r * 1.6, y - r * 0.3);
    g.quadraticCurveTo(x - r, y, x - r * 0.4, y + r * 0.25);
    g.quadraticCurveTo(x, y, x + r * 0.4, y + r * 0.25);
    g.quadraticCurveTo(x + r, y, x + r * 1.6, y - r * 0.3);
    g.quadraticCurveTo(x + r * 0.6, y - r * 0.9, x, y);
    g.fill();
  }
  /* ground */
  const ground = g.createLinearGradient(0, groundY, 0, H);
  ground.addColorStop(0, '#1c0f17');
  ground.addColorStop(1, '#08040a');
  g.fillStyle = ground;
  g.fillRect(0, groundY, W, H - groundY);
  g.fillStyle = 'rgba(255,190,140,.07)';
  g.fillRect(0, groundY, W, 1.5);
  for (let i = 0; i < Math.round(W / 40); i++) {
    g.fillStyle = `hsla(${12 + hash(i + 70) * 30},70%,${22 + hash(i + 71) * 14}%,.75)`;
    g.beginPath();
    g.ellipse(hash(i + 72) * W, groundY + 8 + hash(i + 73) * (H - groundY - 12), 5 + hash(i) * 5, 2.5 + hash(i + 1) * 2, hash(i) * 3, 0, Math.PI * 2);
    g.fill();
  }
  /* the pumpkin's shadow */
  const sh2 = g.createRadialGradient(T.cx, groundY, 0, T.cx, groundY, sh.rx * T.k * 1.25);
  sh2.addColorStop(0, 'rgba(0,0,0,.6)');
  sh2.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.translate(T.cx, groundY);
  g.scale(1, 0.18);
  g.translate(-T.cx, -groundY);
  g.fillStyle = sh2;
  g.beginPath(); g.arc(T.cx, groundY, sh.rx * T.k * 1.25, 0, Math.PI * 2); g.fill();
  g.restore();
}

function paintBody(g, T, sh) {
  g.save();
  g.translate(T.cx, T.cy);
  g.scale(T.k, T.k);
  /* stem first, so the top lobes overlap its base */
  g.save();
  const sy = -sh.ry * 0.92;
  const stem = g.createLinearGradient(-20, sy - 80, 22, sy);
  stem.addColorStop(0, '#7d8a3a');
  stem.addColorStop(0.5, '#56632a');
  stem.addColorStop(1, '#2f3816');
  g.fillStyle = stem;
  g.beginPath();
  g.moveTo(-24, sy + 14);
  g.bezierCurveTo(-22, sy - 30, -16, sy - 62, -2, sy - 86);
  g.quadraticCurveTo(14, sy - 98, 26, sy - 84);
  g.quadraticCurveTo(14, sy - 76, 10, sy - 62);
  g.bezierCurveTo(4, sy - 40, 12, sy - 14, 22, sy + 14);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(30,36,10,.55)';
  g.lineWidth = 2;
  for (const o of [-10, 0, 9]) {
    g.beginPath(); g.moveTo(o, sy + 10); g.bezierCurveTo(o - 2, sy - 20, o * 0.6 - 4, sy - 50, o * 0.3 + 2, sy - 80); g.stroke();
  }
  /* a curly vine */
  g.strokeStyle = '#4b5a22';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(16, sy - 4);
  g.bezierCurveTo(60, sy - 40, 100, sy - 10, 92, sy + 12);
  g.bezierCurveTo(86, sy + 30, 64, sy + 20, 70, sy + 6);
  g.bezierCurveTo(76, sy - 6, 92, sy - 2, 90, sy + 8);
  g.stroke();
  /* a leaf */
  g.fillStyle = '#3f5a1f';
  g.beginPath();
  g.moveTo(-18, sy - 2);
  g.bezierCurveTo(-60, sy - 34, -96, sy - 10, -104, sy + 8);
  g.bezierCurveTo(-80, sy + 2, -50, sy + 16, -18, sy - 2);
  g.fill();
  g.strokeStyle = 'rgba(160,200,90,.35)';
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(-20, sy - 2); g.quadraticCurveTo(-60, sy - 8, -100, sy + 6); g.stroke();
  g.restore();

  /* lobes, back to front */
  for (const l of lobes(sh)) {
    const edge = Math.abs(l.t);
    const grd = g.createRadialGradient(l.cx - l.rx * 0.25, -l.ry * 0.3, l.rx * 0.1, l.cx, 0, Math.max(l.rx, l.ry) * 1.05);
    grd.addColorStop(0, `hsl(${30 - edge * 2},96%,${60 - edge * 6}%)`);
    grd.addColorStop(0.55, `hsl(${24 - edge * 2},92%,${48 - edge * 6}%)`);
    grd.addColorStop(1, `hsl(${16},88%,${26 - edge * 4}%)`);
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(l.cx, 0, l.rx, l.ry, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(90,30,0,.38)';
    g.lineWidth = 3;
    g.stroke();
  }
  /* overall light: moonlight from the upper left, shade underneath */
  g.save();
  bodyPath(g, sh);
  g.clip();
  const shade = g.createLinearGradient(0, -sh.ry, 0, sh.ry);
  shade.addColorStop(0, 'rgba(255,240,220,.10)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(40,8,0,.42)');
  g.fillStyle = shade;
  g.fillRect(-sh.rx * 1.2, -sh.ry * 1.2, sh.rx * 2.4, sh.ry * 2.4);
  for (const l of lobes(sh)) {
    if (Math.abs(l.t) > 0.75) continue;
    const hl = g.createRadialGradient(l.cx - l.rx * 0.35, -l.ry * 0.5, 0, l.cx - l.rx * 0.35, -l.ry * 0.5, l.rx * 0.55);
    hl.addColorStop(0, 'rgba(255,245,225,.20)');
    hl.addColorStop(1, 'rgba(255,245,225,0)');
    g.fillStyle = hl;
    g.fillRect(l.cx - l.rx, -l.ry, l.rx * 2, l.ry);
  }
  g.restore();
  g.restore();
}

/* A canvas the size of the output, drawn in pixel units. */
function layer(W, H, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W * dpr));
  c.height = Math.max(1, Math.round(H * dpr));
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, g };
}

/* The carved holes, unlit and lit, plus the glow they throw. */
function buildCarve(W, H, dpr, T, sh, cuts) {
  const mask = layer(W, H, dpr);
  const mg = mask.g;
  mg.save();
  mg.translate(T.cx, T.cy);
  mg.scale(T.k, T.k);
  mg.fillStyle = '#fff';
  for (const cut of cuts) {
    if (!cut.length) continue;
    mg.beginPath();
    cut.forEach(([x, y], i) => (i ? mg.lineTo(x, y) : mg.moveTo(x, y)));
    mg.closePath();
    mg.fill();
  }
  /* only through the skin: clip to a slightly smaller pumpkin */
  mg.globalCompositeOperation = 'destination-in';
  mg.fillStyle = '#fff';
  bodyPath(mg, sh, 0.955);
  mg.fill();
  mg.restore();

  const d = DEPTH * T.k;
  const candle = { x: T.cx, y: T.cy + sh.ry * T.k * 0.38 };
  const make = lit => {
    const L = layer(W, H, dpr);
    const g = L.g;
    /* the cut wall: pale flesh */
    if (lit) {
      const f = g.createRadialGradient(candle.x, candle.y, 0, candle.x, candle.y, sh.ry * T.k * 1.6);
      f.addColorStop(0, '#ffdf8f');
      f.addColorStop(1, '#ee9a3c');
      g.fillStyle = f;
    } else g.fillStyle = '#b9773a';
    g.fillRect(0, 0, W, H);
    /* the inside, seen through the hole: the hole shifted up by the wall's depth */
    const I = layer(W, H, dpr);
    if (lit) {
      const r = sh.ry * T.k * 1.7;
      const gi = I.g.createRadialGradient(candle.x, candle.y, 0, candle.x, candle.y, r);
      gi.addColorStop(0, '#fff0b0');
      gi.addColorStop(0.2, '#ffd04a');
      gi.addColorStop(0.55, '#ff9418');
      gi.addColorStop(1, '#b84300');
      I.g.fillStyle = gi;
    } else {
      const gi = I.g.createLinearGradient(0, T.cy - sh.ry * T.k, 0, T.cy + sh.ry * T.k);
      gi.addColorStop(0, '#1a0a03');
      gi.addColorStop(1, '#2e1306');
      I.g.fillStyle = gi;
    }
    I.g.fillRect(0, 0, W, H);
    I.g.globalCompositeOperation = 'destination-in';
    I.g.drawImage(mask.c, 0, -d, W, H);
    g.drawImage(I.c, 0, 0, W, H);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask.c, 0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    return L.c;
  };
  const dark = make(false), lit = make(true);
  /* the glow: the holes, blurred and warm (the shadow of an image drawn off-canvas) */
  const glow = layer(W, H, dpr);
  const off = W * 2;
  glow.g.shadowColor = 'rgba(255,150,40,1)';
  glow.g.shadowBlur = Math.max(8, 26 * T.k * dpr);
  glow.g.shadowOffsetX = off * dpr;
  glow.g.drawImage(mask.c, -off, 0, W, H);
  glow.g.shadowBlur = Math.max(4, 8 * T.k * dpr);
  glow.g.shadowColor = 'rgba(255,210,110,1)';
  glow.g.drawImage(mask.c, -off, 0, W, H);
  return { dark, lit, glow: glow.c, candle };
}

/* Put it all together: scene, light on the ground, body, holes, glow. */
function compose(g, W, H, T, sh, L, lit, flick) {
  g.drawImage(L.scene, 0, 0, W, H);
  const a = clamp(lit * flick, 0, 1.2);
  if (a > 0.01) {
    const groundY = T.cy + sh.ry * T.k * 0.9;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const r = sh.rx * T.k * 2.6;
    const gl = g.createRadialGradient(T.cx, groundY, 0, T.cx, groundY, r);
    gl.addColorStop(0, `rgba(255,140,40,${0.3 * a})`);
    gl.addColorStop(0.5, `rgba(255,110,20,${0.1 * a})`);
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gl;
    g.translate(T.cx, groundY);
    g.scale(1, 0.32);
    g.translate(-T.cx, -groundY);
    g.beginPath(); g.arc(T.cx, groundY, r, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.drawImage(L.body, 0, 0, W, H);
  if (L.carve) {
    g.drawImage(L.carve.dark, 0, 0, W, H);
    if (lit > 0.001) {
      g.save();
      g.globalAlpha = clamp(lit * (0.82 + 0.18 * flick), 0, 1);
      g.drawImage(L.carve.lit, 0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(a * 0.72, 0, 1);
      g.drawImage(L.carve.glow, 0, 0, W, H);
      g.restore();
    }
  }
}

/* ==================================================================== */
defineApp({
  id: 'pumpkin',
  name: 'Pumpkin Carver',
  icon: 'pumpkin',
  g1: '#ffa53a', g2: '#a3360a',
  category: 'Media',
  keywords: ['pumpkin', 'carve', 'carving', 'halloween', 'jack-o-lantern', 'jack o lantern', 'lantern', 'candle', 'spooky', 'wallpaper', 'draw'],
  desc: 'Carve a jack-o’-lantern, light the candle, make it your wallpaper',
  singleton: true,
  win: { w: 980, h: 700, minW: 400, minH: 460 },

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store, vfs, bus } = api;
    const notify = n => api.notify({ app: 'Pumpkin Carver', icon: 'pumpkin', ...n });
    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    const saved = store.get(PREF_KEY);
    const pref = saved && typeof saved === 'object' ? saved : {};
    const S = {
      dead: false,
      shape: 'round',
      steps: [],              /* each step: an array of cuts; each cut: [[x,y], …] */
      undone: [],
      resetFrom: null,        /* what Reset cleared, until something else happens */
      tool: pref.tool === 'stamp' ? 'stamp' : 'knife',
      stamp: STAMPS.some(s => s.id === pref.stamp) ? pref.stamp : 'tri',
      mirror: pref.mirror === true,
      lit: true, litV: 1,
      drag: null,             /* live knife path or stamp box */
      kbd: null,              /* the keyboard stamp cursor, in pumpkin units */
      busy: false,
      loaded: false,
    };
    const cuts = () => S.steps.flat();

    /* ---------------- DOM ---------------- */
    const cv = h('canvas.pmk__canvas', { tabindex: '0', role: 'img', 'aria-label': 'Pumpkin' });
    const stage = h('div.pmk__stage', cv);
    const tip = (label, key) => (key ? `${label} · ${key}` : label);
    const toolBtn = (id, label, svg, key) => h('button.pmk__tool.tip', {
      type: 'button', dataset: { tool: id }, 'aria-pressed': 'false', 'aria-label': `${label} (${key})`, 'data-tip': tip(label, key),
      onclick: () => setTool(id),
    }, h('span.icon', { html: svgOf(svg) }));
    const knifeBtn = toolBtn('knife', 'Knife — draw a shape to cut', KNIFE_SVG, 'K');
    const stampBtn = toolBtn('stamp', 'Stamp a shape', STAMP_SVG, 'S');
    const stampBtns = STAMPS.map((s, i) => h('button.pmk__stamp.tip', {
      type: 'button', dataset: { stamp: s.id }, 'aria-pressed': 'false', 'aria-label': `${s.label} stamp (${i + 1})`, 'data-tip': tip(s.label, String(i + 1)),
      onclick: () => { S.stamp = s.id; setTool('stamp'); },
    }, h('span.icon', { html: svgOf(s.svg) })));
    const mirrorBtn = h('button.pmk__tool.tip', {
      type: 'button', 'aria-pressed': 'false', 'aria-label': 'Mirror cuts to the other side (M)', 'data-tip': tip('Mirror', 'M'),
      onclick: () => { S.mirror = !S.mirror; savePrefs(); paintBar(); },
    }, h('span.icon', { html: svgOf(MIRROR_SVG) }));
    const facesBtn = h('button.pmk__btn', {
      type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Add a ready-made face',
      onclick: () => { const r = facesBtn.getBoundingClientRect(); facesMenu(r.left, r.bottom + 4); },
    }, h('span.icon', { html: svgOf(FACE_SVG) }), h('span', { text: 'Faces' }), icon('chevron-down'));
    const shapeSel = h('select.pmk__sel', { 'aria-label': 'Pumpkin shape', onchange: e => setShape(e.target.value) },
      Object.entries(SHAPES).map(([id, s]) => h('option', { value: id, text: s.label })));

    const undoBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Undo', 'data-tip': 'Undo · Ctrl/⌘ Z', onclick: () => undo() }, icon('rotate-ccw'));
    const redoBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Redo', 'data-tip': 'Redo · Ctrl/⌘ ⇧ Z', onclick: () => redo() }, h('span.icon', { html: svgOf(REDO_SVG) }));
    const resetBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Reset: a fresh pumpkin', 'data-tip': 'Reset', onclick: () => reset() }, icon('trash'));
    const lightBtn = h('button.pmk__btn.pmk__light', { type: 'button', 'aria-pressed': 'true', onclick: () => setLit(!S.lit) });
    const wpBtn = h('button.pmk__btn.pmk__btn--primary', { type: 'button', onclick: () => saveWallpaper() },
      icon('wallpaper'), h('span', { text: 'Set as wallpaper' }));
    const picBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Save a PNG to Pictures', 'data-tip': 'Save to Pictures', onclick: () => savePicture() }, icon('save'));

    const bar = h('div.pmk__bar',
      h('div.pmk__group', h('div.pmk__seg', { role: 'toolbar', 'aria-label': 'Tools' }, knifeBtn, stampBtn), mirrorBtn),
      h('div.pmk__group.pmk__stamps', { role: 'toolbar', 'aria-label': 'Stamps' }, stampBtns),
      h('div.pmk__group', facesBtn, shapeSel),
      h('div.pmk__spring'),
      h('div.pmk__group', undoBtn, redoBtn, resetBtn),
      h('div.pmk__group', lightBtn, picBtn, wpBtn));
    const hint = h('span.pmk__hint', { 'aria-live': 'polite' });
    const count = h('span.pmk__count');
    const dock = h('div.pmk__dock', hint, count);
    const pmk = h('div.pmk', bar, stage, dock);
    root.appendChild(h('div.app.app--col', pmk));

    /* ---------------- layout + layers ---------------- */
    const V = { w: 0, h: 0, dpr: 1, T: null, L: null };
    const sh = () => SHAPES[S.shape] || SHAPES.round;
    function screenT(w, hgt) {
      const s = sh();
      const k = Math.max(0.05, Math.min((w - 36) / (s.rx * 2 + 70), (hgt - 30) / (s.ry * 2 + 150)));
      return { k, cx: w / 2, cy: hgt / 2 + 46 * k };
    }
    /* the wallpaper: the pumpkin in the right third, clear of the desktop's
       clock in the middle and the icons down the left */
    const exportT = () => {
      const s = sh();
      const k = (OUT_H * 0.54) / (s.ry * 2 + 130);
      return { k, cx: OUT_W * 0.73, cy: OUT_H * 0.62 };
    };

    function fit() {
      const w = Math.max(1, stage.clientWidth), hgt = Math.max(1, stage.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (w === V.w && hgt === V.h && dpr === V.dpr && V.L) return;
      V.w = w; V.h = hgt; V.dpr = dpr;
      cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
      rebuild(true);
    }

    function rebuild(all) {
      if (!V.w) return;
      V.T = screenT(V.w, V.h);
      if (all || !V.L) {
        const sc = layer(V.w, V.h, V.dpr);
        paintScene(sc.g, V.w, V.h, V.T, sh());
        const bd = layer(V.w, V.h, V.dpr);
        paintBody(bd.g, V.T, sh());
        V.L = { scene: sc.c, body: bd.c, carve: null };
      }
      const list = cuts();
      V.L.carve = list.length ? buildCarve(V.w, V.h, V.dpr, V.T, sh(), list) : null;
      draw();
    }

    /* ---------------- drawing ---------------- */
    let raf = 0, flick = 1, fT = 0, last = 0, nap = 0;
    /* minimised (the window manager hides it) or tab in the background:
       no one can see the flame, so stop drawing it and look again later */
    const unseen = () => document.hidden || win.el?.style.visibility === 'hidden';
    function frame(now) {
      raf = 0;
      if (S.dead) return;
      if (unseen()) { last = 0; clearTimeout(nap); nap = setTimeout(schedule, 500); return; }
      const dt = Math.min(0.05, Math.max(0, (now - (last || now)) / 1000));
      last = now;
      const target = S.lit ? 1 : 0;
      if (S.litV !== target) {
        S.litV = reduced() ? target : clamp(S.litV + (target ? dt * 2.2 : -dt * 3), 0, 1);
      }
      if (S.litV > 0 && !reduced()) {
        fT += dt;
        /* layered sines and a little noise: a candle, not a strobe */
        flick = 0.9 + Math.sin(fT * 9.1) * 0.035 + Math.sin(fT * 15.7 + 1.3) * 0.025 + Math.sin(fT * 3.3) * 0.03 + (Math.random() - 0.5) * 0.04;
      } else flick = 1;
      draw();
      if ((S.litV > 0 && !reduced()) || S.litV !== target) schedule();
      else last = 0;
    }
    function schedule() {
      if (raf || S.dead || document.hidden) return;
      raf = requestAnimationFrame(frame);
    }

    function draw() {
      if (!V.L || S.dead) return;
      const g = cv.getContext('2d');
      g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      compose(g, V.w, V.h, V.T, sh(), V.L, S.litV, flick);
      overlay(g);
    }

    /* what you are doing right now: the knife's line, the stamp's box */
    function overlay(g) {
      const T = V.T;
      const P = ([x, y]) => [T.cx + x * T.k, T.cy + y * T.k];
      if (S.drag?.kind === 'knife' && S.drag.pts.length > 1) {
        const pts = S.drag.pts.map(P);
        g.save();
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.strokeStyle = 'rgba(30,8,0,.55)';
        g.lineWidth = 5;
        g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
        g.strokeStyle = '#ffe9c4';
        g.lineWidth = 2;
        g.setLineDash([7, 5]);
        g.lineDashOffset = -(performance.now() / 40) % 12;
        g.stroke();
        g.setLineDash([3, 6]);
        g.strokeStyle = 'rgba(255,233,196,.45)';
        g.beginPath(); g.moveTo(...pts[pts.length - 1]); g.lineTo(...pts[0]); g.stroke();
        g.setLineDash([]);
        const [tx, ty] = pts[pts.length - 1];
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(tx, ty, 3.5, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      const preview = S.drag?.kind === 'stamp' ? S.drag.preview : S.kbd && S.tool === 'stamp' && document.activeElement === cv ? kbdStamp() : null;
      if (preview) {
        g.save();
        g.strokeStyle = '#ffe9c4';
        g.fillStyle = 'rgba(255,220,160,.16)';
        g.lineWidth = 2;
        g.setLineDash([6, 4]);
        for (const cut of preview) {
          g.beginPath();
          cut.map(P).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.closePath();
          g.fill();
          g.stroke();
        }
        g.restore();
      }
    }

    /* ---------------- editing ---------------- */
    function commit(step, say) {
      if (!step.length) return;
      S.steps.push(step);
      if (S.steps.length > MAX_STEPS) S.steps.splice(0, S.steps.length - MAX_STEPS);
      S.undone = [];
      S.resetFrom = null;
      afterEdit();
      sound('carve');
      if (say) setHint(say);
    }
    const withMirror = cut => (S.mirror ? [cut, mirrored(cut)] : [cut]);

    function undo() {
      if (S.steps.length) S.undone.push(S.steps.pop());
      else if (S.resetFrom) { S.steps = S.resetFrom; S.resetFrom = null; setHint('Your carving is back.'); }
      else return;
      afterEdit();
    }
    function redo() {
      if (!S.undone.length) return;
      S.steps.push(S.undone.pop());
      afterEdit();
    }
    function reset() {
      if (!S.steps.length) return;
      S.resetFrom = S.steps;
      S.steps = [];
      S.undone = [];
      afterEdit();
      setHint('A fresh pumpkin. Undo brings the old carving back.');
    }
    function afterEdit() {
      rebuild(false);
      paintBar();
      persist();
    }

    function setTool(id) {
      S.tool = id === 'stamp' ? 'stamp' : 'knife';
      savePrefs();
      paintBar();
      setHint();
      draw();
    }
    function setShape(id) {
      if (!SHAPES[id] || id === S.shape) return;
      S.shape = id;
      rebuild(true);
      paintBar();
      persist();
    }
    function setLit(on) {
      S.lit = !!on;
      if (on) sound('light'); else sound('out');
      paintBar();
      persist();
      if (reduced()) { S.litV = S.lit ? 1 : 0; draw(); } else schedule();
      setHint(on ? 'The candle is lit.' : 'Candle out. Light it again to see it glow.');
    }

    function facesMenu(x, y) {
      api.menu([
        { header: true, label: 'Add a face' },
        { label: 'Classic', onClick: () => addFace('classic') },
        { label: 'Spooky', onClick: () => addFace('spooky') },
        { label: 'Happy', onClick: () => addFace('happy') },
      ], x, y);
    }
    function addFace(kind) {
      const s = sh(), rx = s.rx, ry = s.ry;
      const ex = rx * 0.36, eyY = -ry * 0.24;
      const step = [];
      if (kind === 'classic') {
        step.push(stampPts('tri', -ex, eyY, rx * 0.13, ry * 0.12), stampPts('tri', ex, eyY, rx * 0.13, ry * 0.12));
        step.push(stampPts('tri', 0, ry * 0.03, rx * 0.07, ry * 0.07));
        step.push(stampPts('grin', 0, ry * 0.38, rx * 0.52, ry * 0.2));
      } else if (kind === 'spooky') {
        step.push(stampPts('tri', -ex, eyY, rx * 0.15, ry * 0.1, 0.42), stampPts('tri', ex, eyY, rx * 0.15, ry * 0.1, -0.42));
        step.push(stampPts('diamond', 0, ry * 0.04, rx * 0.05, ry * 0.08));
        step.push(stampPts('grin', 0, ry * 0.4, rx * 0.58, ry * 0.26));
      } else {
        step.push(stampPts('circle', -ex, eyY, rx * 0.1, rx * 0.1), stampPts('circle', ex, eyY, rx * 0.1, rx * 0.1));
        step.push(stampPts('tri', 0, ry * 0.05, rx * 0.06, -ry * 0.06));
        step.push(stampPts('moon', 0, ry * 0.36, rx * 0.22, ry * 0.32, -Math.PI / 2));
      }
      commit(step, `${kind[0].toUpperCase()}${kind.slice(1)} face added. Undo takes it off again.`);
    }

    /* ---------------- pointer: knife + stamps ---------------- */
    const toUnits = e => {
      const r = cv.getBoundingClientRect();
      return [(e.clientX - r.left - V.T.cx) / V.T.k, (e.clientY - r.top - V.T.cy) / V.T.k];
    };
    function stampBox(a, b, click) {
      const s = stampOf(S.stamp);
      if (click) return withMirror(stampPts(S.stamp, a[0], a[1], s.w, s.h));
      const hw = (b[0] - a[0]) / 2, hh = (b[1] - a[1]) / 2;
      /* at least a few units across, so a tiny drag still makes a shape */
      const fx = Math.sign(hw) || 1, fy = Math.sign(hh) || 1;
      const w = Math.max(8, Math.abs(hw)) * fx, hgt = Math.max(8, Math.abs(hh)) * fy;
      return withMirror(stampPts(S.stamp, a[0] + hw, a[1] + hh, w, hgt));
    }
    function kbdStamp() {
      const s = stampOf(S.stamp);
      return withMirror(stampPts(S.stamp, S.kbd[0], S.kbd[1], s.w, s.h));
    }

    function onDown(e) {
      if (e.button > 0 || !V.T || S.busy) return;
      e.preventDefault();
      cv.focus({ preventScroll: true });
      wake();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      const p = toUnits(e);
      S.kbd = null;
      if (S.tool === 'knife') S.drag = { kind: 'knife', id: e.pointerId, pts: [p] };
      else S.drag = { kind: 'stamp', id: e.pointerId, a: p, sx: e.clientX, sy: e.clientY, moved: false, preview: stampBox(p, p, true) };
      draw();
    }
    function onMove(e) {
      const d = S.drag;
      if (!d || e.pointerId !== d.id) return;
      const p = toUnits(e);
      if (d.kind === 'knife') {
        const q = d.pts[d.pts.length - 1];
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) * V.T.k >= 2.5) d.pts.push(p);
      } else {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) d.moved = true;
        d.preview = stampBox(d.a, p, !d.moved);
      }
      draw();
      if (d.kind === 'knife') schedule();
    }
    function onUp(e) {
      const d = S.drag;
      if (!d || e.pointerId !== d.id) return;
      S.drag = null;
      if (e.type === 'pointercancel') { draw(); return; }
      if (d.kind === 'knife') {
        const pts = simplify(d.pts, 0.9);
        if (pts.length < 3 || area(pts) < 90) {
          setHint('Too small to cut — drag the knife around a shape, then let go.');
          draw();
          return;
        }
        commit(withMirror(pts));
      } else {
        commit(d.preview);
      }
    }
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);

    /* ---------------- keyboard ---------------- */
    function onKey(e) {
      if (S.dead || !win.el.classList.contains('is-active')) return;
      const t = e.target;
      if (t && t.closest && t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && !e.altKey && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && !e.altKey && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod || e.altKey) return;
      if (t && t !== cv && t.closest && t.closest('button,a,[role="button"]') && (e.key === ' ' || e.key === 'Enter')) return;
      if (k === 'l') { e.preventDefault(); setLit(!S.lit); return; }
      if (k === 'm') { e.preventDefault(); S.mirror = !S.mirror; savePrefs(); paintBar(); draw(); return; }
      if (k === 'k') { e.preventDefault(); setTool('knife'); return; }
      if (k === 's') { e.preventDefault(); setTool('stamp'); return; }
      if (/^[1-6]$/.test(k)) { e.preventDefault(); S.stamp = STAMPS[Number(k) - 1].id; setTool('stamp'); return; }
      if (t !== cv) return;
      const ARROWS = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (ARROWS[k]) {
        e.preventDefault();
        if (S.tool !== 'stamp') setTool('stamp');
        const s = sh();
        if (!S.kbd) S.kbd = [0, -s.ry * 0.2];
        const stp = e.shiftKey ? 30 : 10;
        S.kbd = [clamp(S.kbd[0] + ARROWS[k][0] * stp, -s.rx, s.rx), clamp(S.kbd[1] + ARROWS[k][1] * stp, -s.ry, s.ry)];
        setHint('Arrows move the stamp · Enter cuts it · 1–6 change the shape');
        draw();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && S.tool === 'stamp') {
        e.preventDefault();
        if (!S.kbd) { S.kbd = [0, -sh().ry * 0.2]; draw(); return; }
        commit(kbdStamp());
      }
    }
    window.addEventListener('keydown', onKey);
    cv.addEventListener('blur', () => { if (!S.dead) draw(); });

    /* ---------------- bar state + hints ---------------- */
    function paintBar() {
      knifeBtn.setAttribute('aria-pressed', String(S.tool === 'knife'));
      stampBtn.setAttribute('aria-pressed', String(S.tool === 'stamp'));
      for (const b of stampBtns) b.setAttribute('aria-pressed', String(S.tool === 'stamp' && b.dataset.stamp === S.stamp));
      mirrorBtn.setAttribute('aria-pressed', String(S.mirror));
      shapeSel.value = S.shape;
      undoBtn.disabled = !S.steps.length && !S.resetFrom;
      redoBtn.disabled = !S.undone.length;
      resetBtn.disabled = !S.steps.length;
      const n = cuts().length;
      wpBtn.disabled = !n || S.busy;
      picBtn.disabled = !n || S.busy;
      wpBtn.title = n ? 'Make this the desktop wallpaper' : 'Carve something first';
      picBtn.setAttribute('data-tip', n ? 'Save to Pictures' : 'Carve something first');
      api.render(lightBtn, icon('flame', { fill: S.lit }), h('span', { text: S.lit ? 'Blow out' : 'Light candle' }));
      lightBtn.setAttribute('aria-pressed', String(S.lit));
      lightBtn.setAttribute('aria-label', S.lit ? 'Blow out the candle (L)' : 'Light the candle (L)');
      lightBtn.classList.toggle('is-on', S.lit);
      count.textContent = n ? plural(n, 'cut') : 'Not carved yet';
      cv.dataset.tool = S.tool;
      cv.setAttribute('aria-label', `A ${sh().label.toLowerCase()} pumpkin, ${n ? plural(n, 'cut') : 'not carved yet'}, candle ${S.lit ? 'lit' : 'out'}. ${S.tool === 'knife' ? 'Drag to cut a shape out.' : 'Click to stamp, drag to size it; arrow keys and Enter work too.'}`);
    }
    function setHint(text) {
      hint.textContent = text || (S.tool === 'knife'
        ? 'Knife: drag around a shape and let go to cut it out.'
        : `${stampOf(S.stamp).label}: click to stamp it, or drag a box to size it (drag up to flip).`) + (text || !S.mirror ? '' : ' Mirror is on.');
    }

    /* ---------------- sound ---------------- */
    let ac = null;
    function wake() {
      if (store.get('prefs.muted', false)) return null;
      try {
        if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ac = new AC(); }
        if (ac?.state === 'suspended') ac.resume().catch(() => {});
      } catch (err) { ac = null; }
      return ac;
    }
    function sound(kind) {
      const c = wake();
      if (!c || c.state !== 'running') return;
      const vol = clamp((store.get('prefs.volume', 62) || 0) / 100, 0, 1) * 0.5;
      try {
        const t = c.currentTime;
        const noise = (dur, f, q, peak, type = 'bandpass') => {
          const n = Math.round(c.sampleRate * dur);
          const buf = c.createBuffer(1, n, c.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
          const src = c.createBufferSource();
          src.buffer = buf;
          const flt = c.createBiquadFilter();
          flt.type = type; flt.frequency.value = f; flt.Q.value = q;
          const gn = c.createGain();
          gn.gain.setValueAtTime(peak * vol, t);
          gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          src.connect(flt).connect(gn).connect(c.destination);
          src.start(t);
        };
        const tone = (f0, f1, dur, peak, type = 'sine') => {
          const o = c.createOscillator(), gn = c.createGain();
          o.type = type;
          o.frequency.setValueAtTime(f0, t);
          o.frequency.exponentialRampToValueAtTime(f1, t + dur);
          gn.gain.setValueAtTime(0.0001, t);
          gn.gain.linearRampToValueAtTime(peak * vol, t + 0.01);
          gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(gn).connect(c.destination);
          o.start(t); o.stop(t + dur + 0.02);
        };
        if (kind === 'carve') { noise(0.16, 1600, 1.2, 0.5); tone(220, 140, 0.12, 0.12, 'triangle'); }
        else if (kind === 'light') { noise(0.12, 3200, 0.7, 0.4, 'highpass'); tone(110, 70, 0.45, 0.25); }
        else if (kind === 'out') { noise(0.25, 900, 0.6, 0.25, 'lowpass'); }
      } catch (err) { /* sound is a nicety */ }
    }

    /* ---------------- saving ---------------- */
    function renderOut() {
      const s = sh(), T = exportT();
      const sc = layer(OUT_W, OUT_H, 1);
      paintScene(sc.g, OUT_W, OUT_H, T, s);
      const bd = layer(OUT_W, OUT_H, 1);
      paintBody(bd.g, T, s);
      const list = cuts();
      const L = { scene: sc.c, body: bd.c, carve: list.length ? buildCarve(OUT_W, OUT_H, 1, T, s, list) : null };
      const out = layer(OUT_W, OUT_H, 1);
      compose(out.g, OUT_W, OUT_H, T, s, L, S.lit ? 1 : 0, 1);
      return out.c;
    }
    function stamp() {
      const d = new Date(), p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }
    function busy(on) { S.busy = on; pmk.classList.toggle('is-busy', on); paintBar(); }

    async function saveWallpaper() {
      const n = cuts().length;
      if (!n || S.busy) return;
      busy(true);
      try {
        await new Promise(r => setTimeout(r, 30));      /* let the button show it is working */
        if (S.dead) return;
        const out = renderOut();
        let url = '';
        for (const q of [0.9, 0.82, 0.72, 0.6]) { url = out.toDataURL('image/jpeg', q); if (url.length <= WP_MAX) break; }
        if (!url.startsWith('data:image/') || url.length > WP_MAX) throw new Error('The picture came out too large to keep as a wallpaper.');
        const before = store.get(WP.ACTIVE_KEY);
        const old = WP.custom(store).filter(w => w.by === WP_BY);
        const entry = WP.add(store, { name: WP_NAME, url, kind: 'image', by: WP_BY });
        WP.setActive(store, entry.id);
        for (const o of old) WP.remove(store, o.id);
        bus.emit('wallpaper:changed');
        /* the store saves quietly; only call it done once the browser kept it */
        let kept = false;
        for (let i = 0; i < 6 && !kept; i++) {
          await new Promise(r => setTimeout(r, 300));
          try { kept = !!JSON.parse(profiles.local.getItem(profiles.key('staticos.state.v3')) || '{}')?.portal?.wallpapers?.some(w => w.id === entry.id); } catch (err) { kept = false; }
        }
        if (!kept) {
          WP.remove(store, entry.id);
          if (before && WP.byId(store, before)) WP.setActive(store, before);
          bus.emit('wallpaper:changed');
          throw new Error('This browser’s storage for StaticOS settings is full, so the wallpaper could not be kept. Removing other custom wallpapers in Settings frees room.');
        }
        bus.emit('pumpkin:carved', { to: 'wallpaper', cuts: n });
        notify({ title: 'Your pumpkin is on the desktop', message: `${plural(n, 'cut')}${S.lit ? ', candle lit' : ''}. Change it any time in Settings › Wallpaper.` });
        setHint('Wallpaper set. Keep carving — saving again replaces it.');
      } catch (err) {
        notify({ icon: 'alert', title: 'Couldn’t set the wallpaper', message: String(err?.message || err) });
      } finally {
        if (!S.dead) busy(false);
      }
    }

    async function savePicture() {
      const n = cuts().length;
      if (!n || S.busy) return;
      busy(true);
      try {
        await new Promise(r => setTimeout(r, 30));
        if (S.dead) return;
        const out = renderOut();
        const blob = await new Promise(res => out.toBlob(res, 'image/png'));
        if (!blob) throw new Error('The picture could not be encoded.');
        const { path } = await mediaSave(`${vfs.HOME}/Pictures`, `Pumpkin ${stamp()}.png`, blob);
        bus.emit('pumpkin:carved', { to: 'pictures', cuts: n, path });
        notify({ title: 'Saved to Pictures', message: path, actions: [{ label: 'Open in Photos', onClick: () => api.openFile(path) }] });
        setHint(`Saved ${path.split('/').pop()}.`);
      } catch (err) {
        notify({ icon: 'alert', title: 'Couldn’t save the picture', message: String(err?.message || err) });
      } finally {
        if (!S.dead) busy(false);
      }
    }

    /* ---------------- persistence ---------------- */
    let saveT = 0;
    function persist() {
      if (!S.loaded) return;
      clearTimeout(saveT);
      saveT = setTimeout(flush, 400);
    }
    function flush() {
      clearTimeout(saveT);
      saveT = 0;
      misc.set(DOC_KEY, { v: 1, shape: S.shape, steps: S.steps, lit: S.lit }).catch(() => {});
    }
    function savePrefs() {
      store.set(PREF_KEY, { tool: S.tool, stamp: S.stamp, mirror: S.mirror });
    }
    const validCut = c => Array.isArray(c) && c.length >= 3 && c.length <= 2000 && c.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));

    /* ---------------- start ---------------- */
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    ro?.observe(stage);
    const onVis = () => { if (!document.hidden) schedule(); };
    document.addEventListener('visibilitychange', onVis);
    const offReduce = store.sub('prefs.reduceMotion', () => { if (!S.dead) { S.litV = S.lit ? 1 : 0; schedule(); draw(); } });
    paintBar();
    setHint();
    fit();
    misc.get(DOC_KEY).then(doc => {
      if (S.dead) return;
      /* a carving begun in the moment before this arrived wins */
      if (doc && typeof doc === 'object' && !S.steps.length && !S.undone.length) {
        if (SHAPES[doc.shape]) S.shape = doc.shape;
        if (Array.isArray(doc.steps)) S.steps = doc.steps.filter(Array.isArray).map(st => st.filter(validCut)).filter(st => st.length).slice(-MAX_STEPS);
        if (typeof doc.lit === 'boolean') { S.lit = doc.lit; S.litV = doc.lit ? 1 : 0; }
      }
      S.loaded = true;
      if (S.steps.length) persist();
      rebuild(true);
      paintBar();
      schedule();
    }).catch(() => { S.loaded = true; schedule(); });
    schedule();

    return () => {
      if (S.dead) return;
      if (saveT) flush();
      S.dead = true;
      cancelAnimationFrame(raf);
      clearTimeout(nap);
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('keydown', onKey);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      offReduce?.();
      try { ac?.close()?.catch?.(() => {}); } catch (err) { /* already closed */ }
      ac = null;
    };
  },
});
