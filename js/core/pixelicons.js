/* ============================================================
   pixelicons.js — "Pixel icons": every glyph from icons.js drawn
   on a coarse grid, with hard edges.

   How: each SVG glyph is rasterised ONCE, on a canvas at 8x the
   grid, and every cell is kept when enough of it is covered
   (a coverage threshold, with the stroke drawn a little heavier
   than the normal icons so thin lines survive the grid). The
   result is a few hundred bytes of rows per glyph. Those rows
   become a crisp-edged SVG mask, and ONE injected stylesheet maps
   each icon name to its mask through a custom property:

       .icon[data-icon="folder"]  { --px: url(mask) }
       .icon[data-icon] svg       { background: currentColor; mask: var(--px) }

   so nothing is done per icon instance: an icon built a second
   from now, in a window that opens later, is pixelated by the same
   rules, it follows `currentColor` (the mask is only the shape),
   and taking the stylesheet away puts back the untouched SVGs —
   the DOM is never edited, so accessible names are never touched.
   Coloured glyphs (brand-*) keep their colours: the cell colours
   go in as a background image instead of currentColor.

   Costs: when the preference is off this module is never even
   imported (appearance.js). When on, the rows are cached in
   localStorage under a signature of the glyph set, so a reload
   only builds a string; the canvas pass runs once per glyph set.
   ============================================================ */
import { iconNames, iconSvg } from './icons.js';

export const GRID = 14;          // cells across (a 14 px icon is 1:1, the dock's 26 px is about 2x)
const SS = 8;                    // samples per cell each way
const STROKE = 2.35;             // viewBox units; the normal icons use 1.65
const THRESH = 0.34;             // share of a cell that must be covered to light it
const CACHE_KEY = 'staticos.pixicons.v1';
const STYLE_ID = 'staticos-pixel-icons';

const cmap = new Map();          // 'name' / 'name+fill' -> { rows, cols|null } (this page's cache)

const bodyOf = name => iconSvg(name).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const isColour = body => /fill="#|stroke="#|fill='#/i.test(body);

/* a name -> the glyph it draws (aliases share a glyph); two names that
   draw the same body share one raster */
function families() {
  const by = new Map();
  for (const n of iconNames()) {
    const b = bodyOf(n);
    if (!by.has(b)) by.set(b, []);
    by.get(b).push(n);
  }
  return [...by].map(([body, names]) => ({ body, names, colour: isColour(body) }));
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
const signature = fams => hash(`${GRID}|${SS}|${STROKE}|${THRESH}|` + fams.map(f => f.names[0] + f.body).join(''));

const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/* one glyph -> { rows: ['..xx..', ...], cols: ['#aabbcc', ...]|null } */
async function raster(body, colour, fill) {
  const px = GRID * SS;
  const style = colour ? 'stroke:none' : fill ? 'fill:#000;stroke:none' : `fill:none;stroke:#000;stroke-width:${STROKE};stroke-linecap:round;stroke-linejoin:round`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${px}" height="${px}" color="#000" style="${style}">${body}</svg>`;
  const img = await load('data:image/svg+xml,' + encodeURIComponent(svg));
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, px, px);
  const d = cx.getImageData(0, 0, px, px).data;
  const rows = [];
  const cols = colour ? [] : null;
  for (let gy = 0; gy < GRID; gy++) {
    let row = '';
    for (let gx = 0; gx < GRID; gx++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let y = 0; y < SS; y++) for (let x = 0; x < SS; x++) {
        const i = ((gy * SS + y) * px + gx * SS + x) * 4;
        const al = d[i + 3];
        a += al; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al;
      }
      const cover = a / 255 / (SS * SS);
      if (cover >= (colour ? 0.4 : THRESH)) {
        row += 'x';
        if (colour) { const h2 = v => Math.round(v / a).toString(16).padStart(2, '0'); cols.push('#' + h2(r) + h2(g) + h2(b)); }
      } else row += '.';
    }
    rows.push(row);
  }
  return { rows: rows.join(''), cols };
}

/* the whole set; the fill variant only for mono glyphs */
async function rasteriseAll(fams) {
  const out = {};
  await Promise.all(fams.map(async f => {
    const k = f.names[0];
    out[k] = await raster(f.body, f.colour, false);
    if (!f.colour) out[k + '+fill'] = await raster(f.body, false, true);
  }));
  return out;
}

/* ---- rows -> a crisp SVG data URL -------------------------------------- */
function runs(rows, cols, only) {
  /* horizontal runs as path commands; for colour glyphs, runs of one colour */
  const by = new Map();
  let ci = 0;
  for (let y = 0; y < GRID; y++) {
    let x = 0;
    while (x < GRID) {
      if (rows[y * GRID + x] !== 'x') { x++; continue; }
      const col = cols ? cols[ci] : '#000';
      let w = 1;
      while (x + w < GRID && rows[y * GRID + x + w] === 'x' && (!cols || cols[ci + w] === col)) w++;
      if (!by.has(col)) by.set(col, '');
      by.set(col, by.get(col) + `M${x} ${y}h${w}v1h-${w}z`);
      ci += w; x += w;
    }
  }
  return by;
}
const enc = s => s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'");
function url(rows, cols) {
  const paths = [...runs(rows, cols)].map(([c, d]) => `<path d='${d}'${cols ? ` fill='${c}'` : ''}/>`).join('');
  return `url("data:image/svg+xml,${enc(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${GRID} ${GRID}' shape-rendering='crispEdges'>${paths}</svg>`)}")`;
}

/* ---- the stylesheet ------------------------------------------------------ */
function buildCss(fams, data) {
  const A = 'html[data-pixelicons="on"]';
  const parts = [
    `${A} .icon[data-icon] svg{background:var(--pxbg,currentColor);-webkit-mask:var(--px) center/100% 100% no-repeat;mask:var(--px) center/100% 100% no-repeat}`,
    `${A} .icon[data-icon] svg>*{display:none}`,
  ];
  const full = 'linear-gradient(#000,#000)';
  /* unknown names draw icons.js's fallback dot, so they do here */
  const dot = rasterDot();
  parts.push(`${A} .icon[data-icon]{--px:${url(dot, null)}}`);
  for (const f of fams) {
    const k = f.names[0];
    const g = data[k];
    if (!g) continue;
    const sel = f.names.map(n => `${A} .icon[data-icon="${n}"]`).join(',');
    if (g.cols) parts.push(`${sel}{--px:${full};--pxbg:${url(g.rows, g.cols)}}`);
    else parts.push(`${sel}{--px:${url(g.rows, null)}}`);
    const gf = data[k + '+fill'];
    if (gf) parts.push(f.names.map(n => `${A} .icon.icon--fill[data-icon="${n}"]`).join(',') + `{--px:${url(gf.rows, null)}}`);
  }
  return parts.join('\n');
}
/* the fallback circle (r=3 on a 24 grid), by distance */
function rasterDot() {
  let s = '';
  const c = (GRID - 1) / 2, r = 3 / 24 * GRID;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) s += Math.hypot(x - c, y - c) <= r + 0.2 ? 'x' : '.';
  return s;
}

/* ---- on / off --------------------------------------------------------- */
let busy = null;
let cssText = '';             // the built stylesheet, kept so switching back on is free
export const stats = { rasterised: 0, builds: 0, passes: 0, fromCache: 0 };

function readCache(sig) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.sig === sig && c.data) return c.data;
  } catch (e) { /* private window or damaged: rebuild */ }
  return null;
}
function writeCache(sig, data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ sig, data })); } catch (e) { /* full or blocked: it is only a cache */ }
}

let wanted = false;
/** Turn the look on or off. Resolves when the stylesheet is in (or out). */
export async function set(on) {
  wanted = !!on;
  const root = document.documentElement;
  if (!on) {
    document.getElementById(STYLE_ID)?.remove();
    delete root.dataset.pixelicons;
    return false;
  }
  if (document.getElementById(STYLE_ID)) { root.dataset.pixelicons = 'on'; return true; }
  if (!busy) {
    busy = cssText ? Promise.resolve(cssText) : (async () => {
      const fams = families();
      const sig = signature(fams);
      let d = cmap.size ? Object.fromEntries(cmap) : readCache(sig);
      if (d && !cmap.size) stats.fromCache++;
      if (!d) { stats.passes++; d = await rasteriseAll(fams); stats.rasterised += Object.keys(d).length; writeCache(sig, d); }
      for (const k in d) cmap.set(k, d[k]);
      return (cssText = buildCss(fams, d));
    })().finally(() => { busy = null; });
  }
  const css = await busy;
  if (!wanted) return false;                  // switched off while the raster ran
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
    stats.builds++;
  }
  root.dataset.pixelicons = 'on';
  return true;
}

export const isOn = () => !!document.getElementById(STYLE_ID);
export default { set, isOn, GRID, stats };
