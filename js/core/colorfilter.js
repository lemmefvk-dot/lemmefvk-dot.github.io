/* ============================================================
   colorfilter.js — Settings › Accessibility › Colour filters.

   One SVG <feColorMatrix> on <html>, so everything StaticOS draws —
   windows, the video wallpaper, canvases, games, the proxy's pages —
   goes through it. Apps still read and save their real colours: the
   filter is how the screen is shown, not what a canvas holds.

   Two kinds, and the pane says which is which:
     · Simulate — the screen as someone with that colour vision sees
       it (Machado, Oliveira & Fernandes 2009, severity 1.0; the
       matrices are for linear RGB, which is the space the filter runs
       in). For checking that a design still reads.
     · Correct ("daltonize") — moves the difference such an eye loses
       into colours it can still tell apart (Fidaner, Lin & Ozguven
       2005): result = c + E·(c − simulate(c)). Protan and deutan push
       the lost red into green and blue; tritan pushes the lost blue
       into red and green. It is one 3×3 matrix, so it costs no more
       than the simulation.
   Grayscale is the luminance of the colour (Rec. 709 weights, linear).
   Strength mixes each matrix with the identity: 0% is no change.
   ============================================================ */

const SVG_ID = 'static-cvd-svg';
export const FILTER_ID = 'static-cvd';

export const TYPES = ['none', 'grayscale', 'protan', 'deutan', 'tritan'];
export const MODES = ['correct', 'simulate'];

/* Machado et al. 2009, severity 1.0 */
export const SIM = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
/* where the lost difference goes (rows: what is added to R, G, B) */
const SHIFT = {
  protan: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]],
  deutan: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]],
  tritan: [[1, 0, 0.7], [0, 1, 0.7], [0, 0, 0]],
};
const GRAY = [[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]];
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const mul = (a, b) => a.map((row, i) => b[0].map((_, j) => row.reduce((s, _v, k) => s + a[i][k] * b[k][j], 0)));
const add = (a, b) => a.map((row, i) => row.map((v, j) => v + b[i][j]));
const sub = (a, b) => a.map((row, i) => row.map((v, j) => v - b[i][j]));
const scale = (a, s) => a.map(row => row.map(v => v * s));

/** The 3×3 matrix for a filter, before strength. */
export function base(type, mode = 'correct') {
  if (type === 'grayscale') return GRAY;
  if (!SIM[type]) return I3;
  if (mode === 'simulate') return SIM[type];
  return add(I3, mul(SHIFT[type], sub(I3, SIM[type])));
}

/** The matrix at a strength (0…100). */
export function matrix(type, mode = 'correct', strength = 100) {
  const s = Math.max(0, Math.min(100, Number(strength) || 0)) / 100;
  return add(I3, scale(sub(base(type, mode), I3), s));
}

/** feColorMatrix values="…": 4 rows of R G B A offset, alpha untouched */
export const values = m => [...m.map(r => [...r.map(v => +v.toFixed(6)), 0, 0]), [0, 0, 0, 1, 0]].map(r => r.join(' ')).join('  ');

export const active = (type, strength) => TYPES.includes(type) && type !== 'none' && Number(strength) > 0;

/** Put the filter in the page (or take it out) and return the CSS filter
    value <html> needs for it: 'url(#static-cvd)' or ''. */
export function apply({ type = 'none', mode = 'correct', strength = 100 } = {}) {
  if (typeof document === 'undefined') return '';
  let svg = document.getElementById(SVG_ID);
  if (!active(type, strength)) { svg?.remove(); return ''; }
  if (!svg) {
    const NS = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(NS, 'svg');
    svg.id = SVG_ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    /* not display:none — a filter inside a hidden <svg> stops working in some browsers */
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
    const f = document.createElementNS(NS, 'filter');
    f.id = FILTER_ID;
    f.setAttribute('color-interpolation-filters', 'linearRGB');
    const cm = document.createElementNS(NS, 'feColorMatrix');
    cm.setAttribute('type', 'matrix');
    f.appendChild(cm);
    svg.appendChild(f);
    document.body.appendChild(svg);
  }
  const v = values(matrix(type, mode, strength));
  const cm = svg.querySelector('feColorMatrix');
  if (cm.getAttribute('values') !== v) cm.setAttribute('values', v);
  return `url(#${FILTER_ID})`;
}

export default { TYPES, MODES, SIM, base, matrix, values, active, apply, FILTER_ID };
