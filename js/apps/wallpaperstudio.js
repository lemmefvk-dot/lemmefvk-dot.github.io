/* ============================================================
   wallpaperstudio.js — Wallpaper studio: make your own gradient or
   pattern and put it on the desktop.

   A wallpaper is a gradient (linear, radial or conic, two or three
   colours, any angle) with an optional pattern on top (dots, stripes,
   grid, waves, checks, triangles, rings) in its own colour and strength.
   renderWallpaper() draws it on any canvas, so the live preview and the
   saved picture are the same drawing; it is saved at 1920 x 1080 and the
   desktop covers the screen with it, like any picture.

   "Use as wallpaper" writes a PNG into ~/Pictures/Wallpapers, adds it to
   Settings → Wallpaper through core wallpapers.js addFile() — the same
   list as every other picture, so it can be favourited, rotated, removed
   there — and makes it the one showing. "Add to Settings" does the same
   without switching. Designs you want to come back to are kept in
   'portal.wpstudio' (a recipe is a few hundred bytes).

   Keys: R  surprise me     S  keep this design     Enter on a button  does what it says.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as WP from '../portal/wallpapers.js';
import { saveBlob } from '../photos/pt-common.js';
import { makerCss, blobOf, clamp, stemName } from '../core/makerkit.js';

makerCss();
const KEY = 'portal.wpstudio';
const OUT_W = 1920, OUT_H = 1080;
const HEX = /^#[0-9a-f]{6}$/i;
const hexOr = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
export const PATTERNS = ['none', 'dots', 'stripes', 'grid', 'waves', 'checks', 'triangles', 'rings'];
export const SHAPES = ['linear', 'radial', 'conic'];

export const DEFAULT = () => ({ shape: 'linear', angle: 135, stops: ['#2a1a3e', '#a83f5b', '#f2b24d'], three: true, pattern: 'dots', scale: 40, pcolor: '#ffffff', alpha: 0.18, angleP: 0 });

export function cleanRecipe(r) {
  r = r && typeof r === 'object' ? r : {};
  const d = DEFAULT(), st = Array.isArray(r.stops) ? r.stops : d.stops;
  return {
    shape: SHAPES.includes(r.shape) ? r.shape : d.shape,
    angle: clamp(Math.round(+r.angle) || 0, 0, 360),
    stops: [0, 1, 2].map(i => hexOr(st[i], d.stops[i])),
    three: r.three !== false,
    pattern: PATTERNS.includes(r.pattern) ? r.pattern : 'none',
    scale: clamp(Math.round(+r.scale) || d.scale, 8, 200),
    pcolor: hexOr(r.pcolor, d.pcolor),
    alpha: clamp(Number.isFinite(+r.alpha) ? +r.alpha : d.alpha, 0, 1),
    angleP: clamp(Math.round(+r.angleP) || 0, 0, 180),
  };
}

/** Draw a recipe on a canvas of any size (sizes are relative to a 1920-wide picture). */
export function renderWallpaper(canvas, recipe) {
  const r = cleanRecipe(recipe), W = canvas.width, H = canvas.height, g = canvas.getContext('2d');
  const k = W / OUT_W;
  const cols = r.three ? r.stops : [r.stops[0], r.stops[2]];
  let grad;
  if (r.shape === 'radial') grad = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
  else if (r.shape === 'conic' && g.createConicGradient) grad = g.createConicGradient((r.angle - 90) * Math.PI / 180, W / 2, H / 2);
  else {
    const a = (r.angle - 90) * Math.PI / 180, half = (Math.abs(Math.cos(a)) * W + Math.abs(Math.sin(a)) * H) / 2;
    grad = g.createLinearGradient(W / 2 - Math.cos(a) * half, H / 2 - Math.sin(a) * half, W / 2 + Math.cos(a) * half, H / 2 + Math.sin(a) * half);
  }
  cols.forEach((c, i) => grad.addColorStop(i / (cols.length - 1), c));
  /* a conic gradient that comes round to its first colour has no seam */
  if (r.shape === 'conic') grad.addColorStop(1, cols[0]);
  g.globalAlpha = 1; g.fillStyle = grad; g.fillRect(0, 0, W, H);
  if (r.pattern === 'none' || r.alpha <= 0) return;

  const s = r.scale * k;
  g.save();
  g.globalAlpha = r.alpha; g.fillStyle = g.strokeStyle = r.pcolor; g.lineWidth = Math.max(1, s / 8);
  g.translate(W / 2, H / 2); g.rotate(r.angleP * Math.PI / 180);
  const R = Math.hypot(W, H) / 2 + s;                      /* cover the canvas whatever the turn */
  const n = Math.ceil(R / s);
  if (r.pattern === 'dots') {
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { g.beginPath(); g.arc(i * s, j * s, s / 6, 0, 7); g.fill(); }
  } else if (r.pattern === 'stripes') {
    g.lineWidth = s / 2;
    for (let i = -n; i <= n; i++) { g.beginPath(); g.moveTo(-R, i * s); g.lineTo(R, i * s); g.stroke(); }
  } else if (r.pattern === 'grid') {
    for (let i = -n; i <= n; i++) { g.beginPath(); g.moveTo(-R, i * s); g.lineTo(R, i * s); g.moveTo(i * s, -R); g.lineTo(i * s, R); g.stroke(); }
  } else if (r.pattern === 'waves') {
    for (let j = -n; j <= n; j++) { g.beginPath(); for (let x = -R; x <= R; x += s / 4) { const y = j * s + Math.sin(x / s * 2) * s / 4; if (x === -R) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
  } else if (r.pattern === 'checks') {
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if ((i + j) & 1) g.fillRect(i * s, j * s, s, s);
  } else if (r.pattern === 'triangles') {
    const th = s * 0.866;
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const x = i * s + (j & 1 ? s / 2 : 0), y = j * th;
      g.beginPath(); g.moveTo(x, y - th / 2); g.lineTo(x + s / 2, y + th / 2); g.lineTo(x - s / 2, y + th / 2); g.closePath();
      if ((i + j) % 3 === 0) g.fill();
    }
  } else if (r.pattern === 'rings') {
    g.lineWidth = Math.max(1, s / 6);
    for (let i = 1; i <= n * 1.5; i++) { g.beginPath(); g.arc(0, 0, i * s, 0, 7); g.stroke(); }
  }
  g.restore();
}

/** A pleasing random recipe: a base hue, neighbours either side, a quiet pattern. */
export function surprise(rand = Math.random) {
  const hue = rand() * 360, hsl = (hh, s, l) => {
    hh = ((hh % 360) + 360) % 360; s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l), f = n => { const k = (n + hh / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  };
  const spread = 30 + rand() * 50;
  return cleanRecipe({
    shape: SHAPES[Math.floor(rand() * 3)], angle: Math.floor(rand() * 360),
    stops: [hsl(hue, 60 + rand() * 25, 14 + rand() * 12), hsl(hue + spread, 55 + rand() * 30, 32 + rand() * 18), hsl(hue + spread * 2, 65 + rand() * 25, 55 + rand() * 20)],
    three: true, pattern: PATTERNS[Math.floor(rand() * PATTERNS.length)], scale: 24 + Math.floor(rand() * 70), pcolor: rand() < 0.5 ? '#ffffff' : '#000000', alpha: 0.08 + rand() * 0.2, angleP: Math.floor(rand() * 90),
  });
}

defineApp({
  id: 'wallpaperstudio',
  name: 'Wallpaper studio',
  icon: 'wallpaper',
  g1: '#ff9a62', g2: '#8b5cf6',
  category: 'Create',
  keywords: ['wallpaper', 'background', 'gradient', 'pattern', 'desktop', 'dots', 'stripes', 'design', 'make a wallpaper', 'colours'],
  desc: 'Make your own gradient and pattern wallpapers and put them on the desktop',
  singleton: true,
  win: { w: 900, h: 620, minW: 600, minH: 440 },
  shortcuts: [['R', 'Surprise me with a new design'], ['S', 'Keep this design']],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store, bus } = api;

    let r = cleanRecipe(DEFAULT());
    let name = 'My wallpaper', dead = false;
    const keep = () => { const v = store.get(KEY); return Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string').slice(0, 24).map(x => ({ name: stemName(x.name, 'Design'), r: cleanRecipe(x.r) })) : []; };

    const prev = h('canvas.mk-wp__cv', { width: 640, height: 360, role: 'img', 'aria-label': 'Wallpaper preview' });
    const note = h('small.mk-msg', { role: 'status', 'aria-live': 'polite' });
    const say = t => { note.textContent = t; };
    const draw = () => { renderWallpaper(prev, r); };

    /* ---------- controls ---------- */
    const C = {};
    const lbl = (text, el) => h('label.mk-lbl', text, el);
    const set = (k, v) => { r = cleanRecipe({ ...r, [k]: v }); draw(); sync(); };
    const setStop = (i, v) => { const stops = [...r.stops]; stops[i] = v; set('stops', stops); };
    C.shape = h('select', { 'aria-label': 'Gradient shape', onchange: e => set('shape', e.target.value) }, ...SHAPES.map(s => h('option', { value: s, text: s[0].toUpperCase() + s.slice(1) })));
    C.angle = h('input', { type: 'range', min: '0', max: '360', 'aria-label': 'Gradient angle', oninput: e => set('angle', +e.target.value) });
    C.stops = [0, 1, 2].map(i => h('input', { type: 'color', 'aria-label': `Gradient colour ${i + 1}`, oninput: e => setStop(i, e.target.value) }));
    C.three = h('input', { type: 'checkbox', 'aria-label': 'Use three colours', onchange: e => set('three', e.target.checked) });
    C.pattern = h('select', { 'aria-label': 'Pattern', onchange: e => set('pattern', e.target.value) }, ...PATTERNS.map(p => h('option', { value: p, text: p === 'none' ? 'No pattern' : p[0].toUpperCase() + p.slice(1) })));
    C.scale = h('input', { type: 'range', min: '8', max: '200', 'aria-label': 'Pattern size', oninput: e => set('scale', +e.target.value) });
    C.alpha = h('input', { type: 'range', min: '0', max: '100', 'aria-label': 'Pattern strength', oninput: e => set('alpha', +e.target.value / 100) });
    C.angleP = h('input', { type: 'range', min: '0', max: '180', 'aria-label': 'Pattern turn', oninput: e => set('angleP', +e.target.value) });
    C.pcolor = h('input', { type: 'color', 'aria-label': 'Pattern colour', oninput: e => set('pcolor', e.target.value) });
    function sync() {
      C.shape.value = r.shape; C.angle.value = r.angle; C.three.checked = r.three;
      C.stops.forEach((el, i) => { el.value = r.stops[i]; });
      C.stops[1].hidden = !r.three;
      C.pattern.value = r.pattern; C.scale.value = r.scale; C.alpha.value = Math.round(r.alpha * 100); C.angleP.value = r.angleP; C.pcolor.value = r.pcolor;
      for (const k of ['scale', 'alpha', 'angleP', 'pcolor']) C[k].closest('label').hidden = r.pattern === 'none';
      C.angle.closest('label').hidden = r.shape === 'radial';
    }

    /* ---------- saved designs ---------- */
    const mine = h('div.mk-designs', { role: 'list', 'aria-label': 'Your designs' });
    function paintMine() {
      const rows = keep();
      mine.replaceChildren(...rows.map((d, i) => {
        const cv = h('canvas', { width: 96, height: 54, 'aria-hidden': 'true' });
        renderWallpaper(cv, d.r);
        return h('div.mk-design', { role: 'listitem' },
          h('button.mk-design__b', { type: 'button', title: `Open ${d.name}`, 'aria-label': `Open design ${d.name}`, onclick: () => { r = cleanRecipe(d.r); name = d.name; nameIn.value = name; draw(); sync(); say(`Opened “${d.name}”.`); } }, cv, h('span', { text: d.name })),
          h('button.ibtn', { type: 'button', 'aria-label': `Delete design ${d.name}`, onclick: () => { const all = keep(); all.splice(i, 1); store.set(KEY, all); paintMine(); } }, icon('trash')));
      }));
      if (!rows.length) mine.replaceChildren(h('small.mk-hint', { text: 'Designs you keep show up here.' }));
    }
    function keepDesign() {
      const all = keep();
      if (all.length >= 24) return say('You have 24 designs. Delete one first.');
      all.unshift({ name, r }); store.set(KEY, all); paintMine(); say(`Kept “${name}”.`);
    }

    /* ---------- saving into Settings → Wallpaper ---------- */
    async function put(use) {
      try {
        const cv = document.createElement('canvas'); cv.width = OUT_W; cv.height = OUT_H;
        renderWallpaper(cv, r);
        const blob = await blobOf(cv);
        const path = await saveBlob(api, 'Wallpaper studio', `${api.vfs.HOME}/Pictures/Wallpapers`, `${name}.png`, blob, { title: use ? 'Wallpaper set' : 'Wallpaper added', icon: 'wallpaper' });
        const w = WP.addFile(store, path);
        if (use) WP.setActive(store, w.id);
        bus.emit('wallpaper:changed');
        say(use ? `“${w.name}” is your wallpaper now. It is in Settings → Wallpaper too.` : `Added “${w.name}” to Settings → Wallpaper.`);
      } catch (err) { say('Couldn’t make the wallpaper: ' + err.message); }
    }
    const btn = (label, ic, fn, extra = {}) => h('button.btn.btn--sm', { type: 'button', onclick: fn, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));
    const nameIn = h('input', { type: 'text', value: name, maxlength: '40', 'aria-label': 'Wallpaper name', oninput: e => { name = stemName(e.target.value, 'My wallpaper'); } });
    const random = () => { r = surprise(); draw(); sync(); };

    root.classList.add('mk');
    root.replaceChildren(h('div.mk-main',
      h('div.mk-stage', h('div.mk-paper.mk-paper--wide', prev), h('small.mk-hint', { text: `Saved at ${OUT_W} × ${OUT_H}. The desktop covers the screen with it.` }), note),
      h('div.mk-side',
        h('div.mk-group', h('b.label', { text: 'Gradient' }), lbl('Shape', C.shape), lbl('Angle', C.angle),
          h('div.mk-row', ...C.stops, lbl('Three colours', C.three))),
        h('div.mk-group', h('b.label', { text: 'Pattern' }), lbl('Pattern', C.pattern), lbl('Size', C.scale), lbl('Strength', C.alpha), lbl('Turn', C.angleP), lbl('Colour', C.pcolor)),
        h('div.mk-group', h('div.mk-row', btn('Surprise me', 'shuffle', random, { title: 'A new design (R)' }), btn('Keep design', 'save', keepDesign, { title: 'Keep this design (S)' })), lbl('Name', nameIn),
          h('div.mk-row', btn('Use as wallpaper', 'wallpaper', () => put(true), { class: 'btn--primary' }), btn('Add to Settings', 'plus', () => put(false)))),
        h('div.mk-group', h('b.label', { text: 'Your designs' }), mine))));

    const onKey = e => {
      if (!win.el.classList.contains('is-active') || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = document.activeElement, tag = t && t.tagName;
      if ((tag === 'INPUT' && t.type !== 'range' && t.type !== 'color' && t.type !== 'checkbox') || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === 'r') random(); else if (k === 's') keepDesign(); else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    draw(); sync(); paintMine();
    return () => { dead = true; window.removeEventListener('keydown', onKey); };
  },
});
