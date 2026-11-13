/* ============================================================
   themes.js — the accent system, named.

   The brief is specific about this: the layout must not change
   between themes, only the accent. So a theme here is exactly
   four values — the accent, a lighter companion for icons and
   links, its RGB triplet for translucent fills, and the ink
   colour that sits legibly on top of it.

   Everything else in the interface — the near-black canvas, the
   glass surfaces, the spacing, the motion — is shared. That is
   what keeps a themed Static recognisably Static rather than a
   different skin per colour.

   The values live twice on purpose: here, so the picker can
   render a swatch for a theme that is not currently applied and
   therefore has no token of its own to read; and in tokens.css
   as `:root[data-accent="<id>"]` blocks, so the right colours are
   painted on the very first frame instead of after a script runs.
   The ids must match between the two. THEMES is the list the UI
   renders from, so adding one here and a matching block there is
   the whole job.
   ============================================================ */
import { store } from './store.js';

export const THEMES = [
  {
    id: 'aether', name: 'Static Crimson', accent: '#ff456d', soft: '#ff7a98',
    rgb: '255 69 109', ink: '#fff',
    note: 'The default. A neon sign in a dark room.',
  },
  {
    id: 'azure', name: 'Static Blue', accent: '#3b82f6', soft: '#93c5fd',
    rgb: '59 130 246', ink: '#fff',
    note: 'Cooler and calmer. Reads as a workstation.',
  },
  {
    id: 'violet', name: 'Static Violet', accent: '#8b5cf6', soft: '#c4b5fd',
    rgb: '139 92 246', ink: '#fff',
    note: 'Closest in feel to the default without being red.',
  },
  {
    id: 'mint', name: 'Static Emerald', accent: '#10b981', soft: '#6ee7b7',
    rgb: '16 185 129', ink: '#04211a',
    note: 'The only theme where status greens and the accent agree.',
  },
  {
    id: 'amber', name: 'Static Amber', accent: '#f59e0b', soft: '#fcd34d',
    rgb: '245 158 11', ink: '#241500',
    note: 'Warm. Pairs with the dark canvas like lamplight.',
  },
  {
    id: 'pink', name: 'Static Pink', accent: '#ec4899', soft: '#f9a8d4',
    rgb: '236 72 153', ink: '#fff',
    note: 'Brighter and less red than Crimson.',
  },
  /* the wallpaper themes — each is picked out of its clip, and choosing
     that wallpaper applies it (wallpapers.js, `theme:`) */
  {
    id: 'moonwalk', name: 'Moonwalk', accent: '#e4d41f', soft: '#f3ea8c',
    rgb: '228 212 31', ink: '#1d1a00',
    note: 'The yellow suit on the Moon. Pairs with Earthrise.',
  },
  {
    id: 'nocturne', name: 'Nocturne', accent: '#cfd6e0', soft: '#9ba5b3',
    rgb: '207 214 224', ink: '#0b0d11',
    note: 'Streetlamp silver with a little moonlight in it. Pairs with Lamplight.',
  },
  {
    id: 'sakura', name: 'Sakura', accent: '#eea3c3', soft: '#f7cadc',
    rgb: '238 163 195', ink: '#2a0d19',
    note: 'Petal pink against a green night. Pairs with Sakura Moon.',
  },
  {
    id: 'mono', name: 'Static Mono', accent: '#e7e2e4', soft: '#b9b1b5',
    rgb: '231 226 228', ink: '#0b0407',
    note: 'No colour at all. Everything reads by shape and weight.',
  },
  /* the theme packs' accents — each pack (js/core/packs.js) is one of these,
     its own wallpaper (wallpapers.js, `theme:`) and an icon style */
  {
    id: 'drive', name: 'Night Drive', accent: '#22d3ee', soft: '#a5f3fc',
    rgb: '34 211 238', ink: '#03222a', pack: 'drive',
    note: 'Neon cyan from a striped sunset. Part of the Night Drive pack.',
  },
  {
    id: 'glacier', name: 'Glacier', accent: '#8ab4ff', soft: '#c7dbff',
    rgb: '138 180 255', ink: '#0a1530', pack: 'glacier',
    note: 'Periwinkle ice under an aurora. Part of the Glacier pack.',
  },
  {
    id: 'grove', name: 'Autumn Grove', accent: '#e8613c', soft: '#f6a58a',
    rgb: '232 97 60', ink: '#250a03', pack: 'grove',
    note: 'Rust and falling leaves. Part of the Autumn Grove pack.',
  },
  {
    id: 'abyss', name: 'Deep Sea', accent: '#2dd4bf', soft: '#99f6e4',
    rgb: '45 212 191', ink: '#022c27', pack: 'abyss',
    note: 'Teal light from far above. Part of the Deep Sea pack.',
  },
  {
    id: 'matcha', name: 'Matcha', accent: '#a3e635', soft: '#d9f99d',
    rgb: '163 230 53', ink: '#1a2e05', pack: 'matcha',
    note: 'New-leaf green on raked sand. Part of the Matcha pack.',
  },
  {
    id: 'arcade', name: 'Neon Arcade', accent: '#ff4fd8', soft: '#ffa3ec',
    rgb: '255 79 216', ink: '#2a0624', pack: 'arcade',
    note: 'Hot magenta from the arcade carpet. Part of the Neon Arcade pack.',
  },
];

export const DEFAULT_THEME = 'aether';


/* ---------- custom accent ---------------------------------- *
 * A hex value can stand in anywhere a theme id can. Persisted as
 * prefs.accent = '#rrggbb', it flows through apply(), themeById()
 * and swatch() untouched, so the picker needs no special path in
 * main.js or Settings beyond writing the hex. The soft/rgb/ink
 * companions are derived so the one colour drives the whole set.
 * ---------------------------------------------------------- */
export const isHex = v => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim());

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
const toHex = (r, g, b) => '#' + [r, g, b]
  .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Build a full theme from one hex: a lighter companion, the rgb triplet
    for translucent fills, and an ink colour with real contrast on top. */
export function deriveTheme(hex) {
  const [r, g, b] = hexToRgb(hex);
  /* soft = the accent lifted toward white, for icons and links */
  const soft = toHex(r + (255 - r) * 0.42, g + (255 - g) * 0.42, b + (255 - b) * 0.42);
  /* WCAG-ish relative luminance decides whether text on the accent is
     black or white — a bright custom colour must not get white ink */
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return {
    id: hex.toLowerCase(), name: 'Custom', accent: hex.toLowerCase(), soft,
    rgb: `${r} ${g} ${b}`, ink: lum > 0.5 ? '#140a11' : '#fff',
    note: 'Your own colour.',
  };
}

/* ---------- auto accent (from the wallpaper) ----------------- *
 * prefs.accent = 'auto' stands for "whatever colour the wallpaper
 * has". js/core/wpaccent.js picks that colour out of the picture and
 * keeps it in prefs.accentAuto (as found, '#rrggbb'); here it is fitted
 * before it is painted, so text on the accent always meets WCAG AA
 * (4.5:1). Only its lightness moves — the hue and saturation are the
 * wallpaper's — until its luminance is at least 0.24: the ink on it is
 * near-black (5.4:1 or better), as are a primary button's label
 * (base.css) and the ink Increased contrast puts on every accent; and
 * as text on the dark canvas it is 5.6:1 or better. On the light
 * appearance it is also kept at or under 0.55, so a pale wallpaper
 * still gives a colour that shows on white; Increased contrast there
 * deepens it and puts white on it, as it does for every accent
 * (css/feat-a11y.css). Until a colour is found it stands in with
 * Static Crimson's.
 * ---------------------------------------------------------- */
export const AUTO = 'auto';
const lumOf = ([r, g, b]) => {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
export const AUTO_INK = '#140a11';
/** The colour moved in lightness only, until text on it passes AA in this appearance. */
export function fitAccent(hex, mode = 'dark') {
  const [h, s, l0] = toHsl(hexToRgb(isHex(hex) ? hex : '#ff456d'));
  let l = l0;
  while (l < 1 && lumOf(fromHsl(h, s, l)) < 0.24) l += 0.005;
  if (mode === 'light') while (l > 0 && lumOf(fromHsl(h, s, l)) > 0.55) l -= 0.005;
  return toHex(...fromHsl(h, s, Math.max(0, Math.min(1, l))));
}
const appearance = root => ((root || (typeof document !== 'undefined' ? document.documentElement : null))?.dataset.theme === 'light' ? 'light' : 'dark');
/** The whole accent set for 'auto', in the appearance `root` is in. */
export function autoTheme(root) {
  const raw = store.get('prefs.accentAuto');
  const mode = appearance(root);
  const accent = fitAccent(isHex(raw) ? raw : '#ff456d', mode);
  const [r, g, b] = hexToRgb(accent);
  const soft = toHex(r + (255 - r) * 0.42, g + (255 - g) * 0.42, b + (255 - b) * 0.42);
  return {
    id: AUTO, name: 'Auto (from wallpaper)', accent, soft, rgb: `${r} ${g} ${b}`,
    ink: AUTO_INK, raw: isHex(raw) ? raw.toLowerCase() : null,
    note: 'Picked out of your wallpaper, and changes with it.',
  };
}

const byId = new Map(THEMES.map(t => [t.id, t]));
export const themeById = id => (id === AUTO ? autoTheme() : isHex(id) ? deriveTheme(id) : (byId.get(id) || byId.get(DEFAULT_THEME)));
export const isTheme = id => byId.has(id);

/* Older builds stored a couple of names that have since been renamed. */
const ALIASES = { Static: 'aether', crimson: 'aether', blue: 'azure', emerald: 'mint', green: 'mint' };
export const canonId = id => {
  const s = String(id || '').trim();
  if (s === AUTO) return AUTO;
  if (isHex(s)) return s.toLowerCase();
  if (byId.has(s)) return s;
  if (ALIASES[s] && byId.has(ALIASES[s])) return ALIASES[s];
  const low = s.toLowerCase();
  if (byId.has(low)) return low;
  return DEFAULT_THEME;
};

/**
 * Apply a theme to the document.
 *
 * The data attribute does the real work — the matching block in
 * tokens.css wins on the first paint. The inline custom properties are
 * belt and braces for a theme added at runtime that has no CSS block
 * yet, and they cost nothing when the CSS already agrees.
 */
export function apply(id, root = document.documentElement) {
  const c = canonId(id);
  const t = c === AUTO ? autoTheme(root) : themeById(c);
  root.dataset.accent = t.id;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-soft', t.soft);
  root.style.setProperty('--accent-rgb', t.rgb);
  root.style.setProperty('--accent-ink', t.ink);
  return t;
}

/** The colours to paint a swatch with, for a theme that is not applied. */
export const swatch = id => {
  const t = themeById(canonId(id));
  return `linear-gradient(140deg, ${t.soft} 0%, ${t.accent} 62%)`;
};

export default { THEMES, DEFAULT_THEME, AUTO, themeById, isTheme, canonId, apply, swatch, fitAccent, autoTheme };
