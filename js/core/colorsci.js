/* ============================================================
   colorsci.js (core) — the colour science behind Static Color.
   Pure: no DOM, no store. Colours are { r, g, b } in 0–255.

   · sRGB ↔ linear light: the IEC 61966-2-1 transfer curve.
   · WCAG 2.1 relative luminance and contrast ratio, exactly as the
     Recommendation writes them (0.03928 knee, + 0.05 flare).
   · nearestReadable(fg, bg): the text colour closest to fg — same hue
     and saturation, the lightness moved as little as it can be — whose
     contrast with bg really is at least 4.5:1 (WCAG AA, normal text).
     Every candidate is checked as the 8-bit colour it rounds to, so the
     answer passes as shown. Black or white always reaches 4.58:1 against
     any background, so there always is one.
   · simulate(rgb, kind): colour-vision deficiency previews with the
     matrices of Machado, Oliveira & Fernandes, "A Physiologically-based
     Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6),
     2009 — severity 1.0 (protanopia, deuteranopia, tritanopia), applied
     to linear RGB. Achromatopsia is shown as luminance alone (ITU-R
     BT.709 weights, the Y of sRGB). A simulation, not anyone's eyes.
   · nearestNamed(rgb): the closest of the CSS named colours (CSS Color
     Module Level 4, §6.1: the 148 names, aliases like gray/grey kept
     together) by CIEDE2000 colour difference (Sharma, Wu & Dalal,
     Color Research & Application 30(1), 2005) in CIELAB under D65.
   · mix(a, b, t): straight sRGB mixing, as CSS color-mix(in srgb) does
     — the tints and shades.
   ============================================================ */

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const to8 = x => Math.round(clamp01(x) * 255);
export const hexOf = ({ r, g, b }) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
export function rgbOf(hex) {
  let s = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(s)) s = s.slice(0, 3).split('').map(c => c + c).join('');
  if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

/* ---- sRGB transfer (IEC 61966-2-1) ---- */
export const lin = c8 => { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const enc = l => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

/* ---- WCAG 2.1 ---- */
export function luminance({ r, g, b }) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
export const AA = 4.5;

/* ---- HSL (for moving lightness alone) ---- */
export function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  const l = (max + min) / 2;
  return { h: (h + 360) % 360, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
}
export function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: to8(r + m), g: to8(g + m), b: to8(b + m) };
}

/** The readable text colour nearest to fg on bg: { rgb, hex, ratio, lighter } or null when fg already reads. */
export function nearestReadable(fg, bg, min = AA) {
  if (contrast(fg, bg) >= min) return null;
  const { h, s, l } = toHsl(fg);
  for (let step = 1; step <= 1000; step++) {
    for (const dir of [-1, 1]) {
      const L = l + dir * step / 1000;
      if (L < 0 || L > 1) continue;
      const rgb = fromHsl(h, s, L);
      const ratio = contrast(rgb, bg);
      if (ratio >= min) return { rgb, hex: hexOf(rgb), ratio, lighter: dir > 0 };
    }
  }
  /* unreachable in practice: black or white always passes */
  const bw = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }].sort((a, b2) => contrast(b2, bg) - contrast(a, bg))[0];
  return { rgb: bw, hex: hexOf(bw), ratio: contrast(bw, bg), lighter: bw.r === 255 };
}

/* ---- colour-vision deficiency (Machado et al. 2009, severity 1.0) ---- */
export const CVD = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export const VISION = [
  ['normal', 'Typical colour vision', ''],
  ['protanopia', 'Protanopia', 'no red cones (about 1% of men)'],
  ['deuteranopia', 'Deuteranopia', 'no green cones (about 1% of men)'],
  ['tritanopia', 'Tritanopia', 'no blue cones (rare)'],
  ['achromatopsia', 'Achromatopsia', 'no colour at all (very rare)'],
];
/** How { r, g, b } might look with the given deficiency. */
export function simulate(rgb, kind) {
  if (kind === 'normal' || !kind) return { ...rgb };
  const L = [lin(rgb.r), lin(rgb.g), lin(rgb.b)];
  if (kind === 'achromatopsia') {
    const y = enc(0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2]);
    return { r: to8(y), g: to8(y), b: to8(y) };
  }
  const M = CVD[kind];
  if (!M) return { ...rgb };
  const o = M.map(row => enc(clamp01(row[0] * L[0] + row[1] * L[1] + row[2] * L[2])));
  return { r: to8(o[0]), g: to8(o[1]), b: to8(o[2]) };
}

/* ---- CIELAB (D65) and CIEDE2000 ---- */
export function lab({ r, g, b }) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, deg = 180 / Math.PI, p7 = 25 ** 7;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + p7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1 = Math.hypot(a1p, b1), C2 = Math.hypot(a2p, b2);
  const hue = (b, a) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) * deg + 360) % 360);
  const h1 = hue(b1, a1p), h2 = hue(b2, a2p);
  let dh = 0;
  if (C1 * C2 !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dL = L2 - L1, dC = C2 - C1, dH = 2 * Math.sqrt(C1 * C2) * Math.sin(dh / 2 * rad);
  const Lb = (L1 + L2) / 2, Cbp = (C1 + C2) / 2;
  let hb = h1 + h2;
  if (C1 * C2 !== 0) hb = Math.abs(h1 - h2) <= 180 ? hb / 2 : hb < 360 ? (hb + 360) / 2 : (hb - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.20 * Math.cos((4 * hb - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + p7));
  const Sl = 1 + 0.015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/* ---- the CSS named colours (CSS Color Module Level 4, §6.1) ---- */
const NAMED_SRC = 'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 '
  + 'blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e '
  + 'coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b '
  + 'darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 '
  + 'darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f '
  + 'darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff '
  + 'firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 '
  + 'gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 '
  + 'khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 '
  + 'lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a '
  + 'lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 '
  + 'lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 '
  + 'mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc '
  + 'mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 '
  + 'oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 '
  + 'paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 '
  + 'purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 '
  + 'seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 '
  + 'snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee '
  + 'wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32';
/** [name, '#RRGGBB'] for all 148 names, in alphabetical order */
export const NAMED = (() => { const t = NAMED_SRC.split(' '); const out = []; for (let i = 0; i < t.length; i += 2) out.push([t[i], '#' + t[i + 1].toUpperCase()]); return out; })();
/* one entry per colour, its other names kept as aliases */
const UNIQUE = (() => {
  const by = new Map();
  for (const [n, hx] of NAMED) { if (by.has(hx)) by.get(hx).aliases.push(n); else by.set(hx, { name: n, hex: hx, aliases: [], lab: lab(rgbOf(hx)) }); }
  return [...by.values()];
})();
/** The nearest CSS named colour: { name, hex, aliases, de } — de 0 means it is that colour exactly. */
export function nearestNamed(rgb) {
  const L = lab(rgb);
  let best = null;
  for (const u of UNIQUE) {
    const de = deltaE2000(L, u.lab);
    if (!best || de < best.de) best = { name: u.name, hex: u.hex, aliases: u.aliases, de };
  }
  if (best && best.hex === hexOf(rgb)) best.de = 0;
  return best;
}

/* ---- mixing ---- */
export const mix = (a, b, t) => ({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) });
const WHITE = { r: 255, g: 255, b: 255 }, BLACK = { r: 0, g: 0, b: 0 };
/** 10 steps toward white (tints) and toward black (shades): 0%, 10% … 90%. */
export const tints = rgb => Array.from({ length: 10 }, (_, i) => ({ pct: i * 10, rgb: mix(rgb, WHITE, i / 10) }));
export const shades = rgb => Array.from({ length: 10 }, (_, i) => ({ pct: i * 10, rgb: mix(rgb, BLACK, i / 10) }));

/* ---- lists of colours in and out ---- */
/** Every hex code in some text: #RGB, #RRGGBB, #RRGGBBAA with a #, or 6/8 digits without one;
    a GIMP palette's "R G B name" rows too. -> ['#RRGGBB', …] in order, duplicates kept out. */
export function parseList(text) {
  const out = [];
  const add = hx => { if (hx && !out.includes(hx)) out.push(hx); };
  const src = String(text || '').slice(0, 200000);
  if (/^\s*GIMP Palette/.test(src)) {
    for (const ln of src.split(/\r?\n/)) {
      const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s|$)/.exec(ln);
      if (m && [m[1], m[2], m[3]].every(v => +v <= 255)) add(hexOf({ r: +m[1], g: +m[2], b: +m[3] }));
    }
    return out;
  }
  for (const m of src.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z])|(?<![0-9a-z#])([0-9a-f]{8}|[0-9a-f]{6})(?![0-9a-z])/gi)) {
    const c = rgbOf(m[1] || m[2]);
    if (c) add(hexOf(c));
  }
  return out;
}
/** A GIMP palette file (.gpl), which GIMP, Inkscape and Krita read. */
export function toGpl(list, name = 'Static Color') {
  const rows = list.map(hx => { const c = rgbOf(hx); return `${String(c.r).padStart(3)} ${String(c.g).padStart(3)} ${String(c.b).padStart(3)}\t${hx.toUpperCase()}`; });
  return ['GIMP Palette', `Name: ${String(name).replace(/[\r\n]+/g, ' ')}`, `Columns: ${Math.min(16, Math.max(1, list.length))}`, '#', ...rows, ''].join('\n');
}
export const toCssVars = (list, prefix = 'color') => `:root {\n${list.map((hx, i) => `  --${prefix}-${i + 1}: ${hx};`).join('\n')}\n}`;
export const toJson = list => JSON.stringify(list, null, 2);

export default { hexOf, rgbOf, lin, enc, luminance, contrast, AA, toHsl, fromHsl, nearestReadable, CVD, VISION, simulate, lab, deltaE2000, NAMED, nearestNamed, mix, tints, shades, parseList, toGpl, toCssVars, toJson };
