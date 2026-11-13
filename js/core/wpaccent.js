/* ============================================================
   wpaccent.js — the accent picked out of the wallpaper.

   Settings › Themes › Auto (from wallpaper) sets prefs.accent to
   'auto'. From then on, whenever the wallpaper on screen changes —
   picked by hand, a desktop with its own, rotation putting up the
   next picture, the Day and Night scene moving into a new light —
   this module looks at the picture and keeps its most vivid
   common colour in prefs.accentAuto. themes.js then fits that
   colour so text on it passes WCAG AA, and paints it.

   How the colour is found: the picture is drawn into a canvas of
   at most 64 px a side, and its pixels are grouped into six
   colours (k-means, seeded the same way every time, so the same
   picture always gives the same colour). Each group scores by how
   much of the picture it covers and how colourful it is; very dark
   and very pale groups count for less. A video wallpaper is read
   from its poster (its first frame), or from the playing frame
   when it has none; a gradient from its own colour stops.

   What it can't read, it says so (portal.wpAccentFrom.why) and
   keeps the last colour: the drawn Aurora Ridge scene (it is made
   of your accent), or a picture on another site that doesn't let
   pages read its pixels.

   Spooky season: the season's orange wins over every accent (its
   CSS is !important), Auto included; Auto keeps following your
   own wallpaper underneath and is back the moment the season ends.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as THEMES from './themes.js';
import * as WP from '../portal/wallpapers.js';
import * as DAY from './daycycle.js';
import * as ROTATE from './wprotate.js';

export const FROM = 'portal.wpAccentFrom';     /* { id, name, hex|null, why|null } */
export const isAuto = () => store.get('prefs.accent') === THEMES.AUTO;

/* ---------- colour maths ---------------------------------------- */
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  return [0, l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn), l];
}

/** The most vivid common colour of a set of [r, g, b, weight] samples. */
export function dominant(samples, k = 6) {
  const pts = samples.filter(s => s[3] > 0);
  if (!pts.length) return null;
  /* seeds: the weighted mean, then each next one as far as possible from the rest */
  const W = pts.reduce((a, p) => a + p[3], 0);
  const mean = [0, 1, 2].map(i => pts.reduce((a, p) => a + p[i] * p[3], 0) / W);
  const cent = [mean];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  while (cent.length < Math.min(k, pts.length)) {
    let best = null, bd = -1;
    for (const p of pts) { const d = Math.min(...cent.map(c => d2(p, c))); if (d > bd) { bd = d; best = p; } }
    if (bd <= 0) break;
    cent.push(best.slice(0, 3));
  }
  let groups = [];
  for (let it = 0; it < 10; it++) {
    groups = cent.map(() => ({ n: 0, s: [0, 0, 0] }));
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < cent.length; i++) { const d = d2(p, cent[i]); if (d < bd) { bd = d; bi = i; } }
      const g = groups[bi];
      g.n += p[3]; g.s[0] += p[0] * p[3]; g.s[1] += p[1] * p[3]; g.s[2] += p[2] * p[3];
    }
    groups.forEach((g, i) => { if (g.n) cent[i] = g.s.map(v => v / g.n); });
  }
  let best = null, bs = -1;
  groups.forEach((g, i) => {
    if (!g.n) return;
    const c = cent[i];
    const [, s, l] = hsl(c);
    const chroma = (Math.max(...c) - Math.min(...c)) / 255;
    const share = g.n / W;
    const light = l < 0.1 ? 0.25 : l < 0.18 ? 0.6 : l > 0.92 ? 0.35 : 1;
    const score = Math.sqrt(share) * (0.04 + chroma) ** 1.6 * (0.5 + s * 0.5) * light;
    if (score > bs) { bs = score; best = c; }
  });
  return best ? hex(best) : null;
}

/* ---------- reading a wallpaper's pixels ------------------------ */
const sameOrigin = u => { try { return new URL(u, location.href).origin === location.origin; } catch (e) { return true; } };
const local = u => /^(data|blob):/i.test(u) || sameOrigin(u);

function loadImage(url, ms = 12000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!local(url)) img.crossOrigin = 'anonymous';
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); reject(new Error('load')); };
    img.src = url;
  });
}

/** Pixels of an image or a video frame, at most 64 px a side, as [r,g,b,1] samples. */
function sample(src, w, h) {
  if (!w || !h) throw new Error('empty');
  const s = Math.min(1, 64 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, cw, ch);
  const d = g.getImageData(0, 0, cw, ch).data;      /* throws on a picture from a site that doesn't share it */
  const out = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) out.push([d[i], d[i + 1], d[i + 2], 1]);
  return out;
}

async function fromUrl(url) {
  const img = await loadImage(url);
  return dominant(sample(img, img.naturalWidth || img.width, img.naturalHeight || img.height));
}

async function fromVideo() {
  const v = document.querySelector('.desktop .wp > video.wp__video');
  if (!v) throw new Error('no frame');
  if (v.readyState < 2) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no frame')), 8000);
      v.addEventListener('loadeddata', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
  return dominant(sample(v, v.videoWidth, v.videoHeight));
}

/** A gradient's colour stops (literal colours only — never the accent's own). */
function fromCss(css) {
  const out = [];
  for (const m of String(css || '').matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b|rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)/gi)) {
    if (m[1]) {
      let x = m[1];
      if (x.length === 3) x = [...x].map(c => c + c).join('');
      out.push([parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16), 1]);
    } else out.push([+m[2], +m[3], +m[4], m[5] == null ? 1 : +m[5]]);
  }
  return dominant(out);
}

/** -> { hex } | { why } for a wallpaper object (as the desktop paints it). */
export async function colourOf(w) {
  if (!w) return { why: 'There’s no wallpaper to read.' };
  try {
    if (w.kind === 'scene') return { why: `${w.name} is drawn in your accent, so it has no colour of its own to give.` };
    if (w.kind === 'css') {
      const c = fromCss(w.css);
      return c ? { hex: c } : { why: `${w.name} is drawn in your accent, so it has no colour of its own to give.` };
    }
    if (w.kind === 'daycycle') return { hex: await fromUrl(DAY.currentArt()) };
    if (w.kind === 'video') {
      if (w.poster) return { hex: await fromUrl(w.poster) };
      return { hex: await fromVideo() };
    }
    return { hex: await fromUrl(w.url) };
  } catch (e) {
    return { why: e && e.name === 'SecurityError'
      ? `The site ${w.name} comes from doesn’t let pages read its colours.`
      : `${w.name} couldn’t be opened to read its colours.` };
  }
}

/* ---------- following the wallpaper ----------------------------- */
let shownWp = null;      /* the wallpaper the desktop last said it painted */
let ticket = 0;

/** The wallpaper on screen, as the desktop chose it (rotation included). */
function onScreen() {
  if (shownWp) return shownWp;
  /* before the desktop has said anything since this module started: what it marked on <body> */
  const id = typeof document !== 'undefined' ? document.body?.dataset.wp : '';
  if (id && id.startsWith('rot:')) return ROTATE.shown() || WP.active(store);
  return (id && WP.byId(store, id)) || WP.active(store);
}
const keyOf = w => (w ? `${w.id}|${w.url || w.poster || w.css || ''}|${w.kind === 'daycycle' ? DAY.state().phase : ''}` : '');
let lastKey = '';

/** Read the wallpaper on screen and keep its colour, if Auto is on. */
export async function update(force = false) {
  if (!isAuto()) return null;
  const w = onScreen();
  const key = keyOf(w);
  if (!force && key === lastKey) return null;
  lastKey = key;
  const my = ++ticket;
  const r = await colourOf(w);
  if (my !== ticket || !isAuto()) return null;
  store.set(FROM, { id: w?.id || null, name: w?.name || null, hex: r.hex || null, why: r.why || null, at: Date.now() });
  if (r.hex && r.hex !== store.get('prefs.accentAuto')) {
    /* prefs.* changes reach main.js, which repaints the accent (themes.js
       fits it for contrast); Settings and the boot skin hear it too */
    store.set('prefs.accentAuto', r.hex);
  }
  bus.emit('wpaccent:change', r);
  return r;
}

let inited = false;
export function init() {
  if (inited) return;
  inited = true;
  bus.on('wallpaper:shown', w => { shownWp = w || null; update(); });
  bus.on('daycycle:phase', () => update());
  /* 'prefs', not 'prefs.accent': a wallpaper with a paired theme writes the whole prefs object */
  let acc = store.get('prefs.accent');
  store.sub('prefs', () => {
    const a = store.get('prefs.accent');
    if (a === acc) return;
    acc = a;
    if (isAuto()) update(true); else lastKey = '';
  });
  if (isAuto()) update(true);
}

export default { FROM, isAuto, dominant, colourOf, update, init };
