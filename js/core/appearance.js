/* ============================================================
   appearance.js — the preferences that act all session, whether
   or not Settings is open:

     · text scale, contrast, transparency, blur, shadows and focus
       outlines, pushed onto <html> as data attributes (the CSS in
       css/features.css does the rest, so they are right on the
       first painted frame after a reload)
     · the reading font and its line, letter and word spacing
       (css/feat-access.css), and <html>'s filter: Night Shift and the
       colour filters (js/core/colorfilter.js)
     · volume and mute, applied to every <audio>/<video>
     · "match system appearance", which has to watch the media
       query for the whole session
     · the "recently changed" list Settings shows, recorded here so
       a change made from the Control Centre or a shortcut lands in
       it too

   This used to run at Settings' own module scope, which forced the
   whole Settings app and everything it imports to load at boot.
   main.js calls init() once; Settings imports the same functions.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as CF from './colorfilter.js';

/* Defaults for the preferences above. store.js carries the shell's own
   defaults; these are the ones only Settings presents. */
export const APPEARANCE_DEFAULTS = {
  themeAuto: false,
  textScale: 'normal',
  contrast: 'normal',
  uiTransparency: 'full',
  uiBlur: true,
  uiShadows: true,
  focusRings: false,
  pixelIcons: false,
  muted: false,
  /* Settings › Accessibility: magnifier (js/shell/magnifier.js) */
  magnifier: false,
  magZoom: 2,
  magSize: 280,
  magFollow: 'both',          /* 'both' | 'pointer' | 'focus' */
  magMode: 'lens',            /* 'lens' | 'full' (full screen) */
  /* colour filters (js/core/colorfilter.js) */
  colorFilter: 'none',        /* 'none' | 'grayscale' | 'protan' | 'deutan' | 'tritan' */
  colorFilterMode: 'correct', /* 'correct' (daltonize) | 'simulate' */
  colorFilterStrength: 100,
  /* reading: the font and its spacing (css/feat-access.css); 0 = as designed */
  fontFace: 'default',        /* 'default' | 'dyslexic' | 'hyperlegible' */
  lineHeight: 0,
  letterSpacing: 0,
  wordSpacing: 0,
};

/* the spacing sliders' ranges — Settings draws them, applyChrome clamps to them */
export const SPACING = {
  lineHeight: { min: 1.2, max: 2.4, step: 0.1 },      /* 1.2 = as designed */
  letterSpacing: { min: 0, max: 0.2, step: 0.01 },    /* em */
  wordSpacing: { min: 0, max: 0.4, step: 0.02 },      /* em */
};

const dflt = key => (APPEARANCE_DEFAULTS[key] !== undefined ? APPEARANCE_DEFAULTS[key] : store.defaults?.prefs?.[key]);
const P = key => store.get('prefs.' + key, dflt(key));

export function applyChrome() {
  const r = document.documentElement;
  r.dataset.motion = store.get('prefs.reduceMotion') ? 'reduced' : 'full';
  r.dataset.textscale = P('textScale');
  r.dataset.contrast = P('contrast');
  r.dataset.transparency = P('uiTransparency');
  r.dataset.blur = P('uiBlur') ? 'on' : 'off';
  r.dataset.shadows = P('uiShadows') ? 'on' : 'off';
  r.dataset.focusrings = P('focusRings') ? 'always' : 'auto';
  applyReading(r);
  /* <html>'s filter: Night Shift's warmth, then a colour filter */
  const cf = CF.apply({ type: P('colorFilter'), mode: P('colorFilterMode'), strength: P('colorFilterStrength') });
  const filter = [store.get('prefs.nightShift') ? 'sepia(.16) saturate(1.08)' : '', cf].filter(Boolean).join(' ');
  if (r.style.filter !== filter) r.style.filter = filter;
  /* a full-screen window sits in the top layer, where <html>'s filter does
     not reach: css/feat-access.css hands it the same one */
  if (filter) r.style.setProperty('--root-filter', filter); else r.style.removeProperty('--root-filter');
  if (cf) r.dataset.colorfilter = P('colorFilter'); else delete r.dataset.colorfilter;
}

/* The reading font and spacing: a data attribute each, and the value as a
   custom property the stylesheet hands to every app (css/feat-access.css).
   At "as designed" the attribute is gone and nothing is overridden. */
function applyReading(r) {
  const face = P('fontFace');
  r.dataset.font = ['dyslexic', 'hyperlegible'].includes(face) ? face : 'default';
  const one = (attr, prop, key, unit) => {
    const R = SPACING[key];
    const v = Math.min(R.max, Number(P(key)) || 0);
    const on = v > R.min + 1e-6;
    if (on) { r.setAttribute(attr, ''); r.style.setProperty(prop, v.toFixed(2) + unit); }
    else { r.removeAttribute(attr); r.style.removeProperty(prop); }
  };
  one('data-lh', '--read-lh', 'lineHeight', '');
  one('data-ls', '--read-ls', 'letterSpacing', 'em');
  one('data-ws', '--read-ws', 'wordSpacing', 'em');
}

/* Volume is a preference several apps read, but nothing else applies it
   to the elements that actually make sound. Only ever unmute what we
   muted — the wallpaper layer plays a muted video, and unmuting that
   would put a soundtrack on the desktop. */
const mutedByUs = new WeakSet();
export function applyVolume() {
  const vol = Math.max(0, Math.min(100, Number(store.get('prefs.volume', 62)) || 0)) / 100;
  const mute = !!P('muted');
  for (const el of document.querySelectorAll('audio,video')) {
    try {
      el.volume = vol;
      if (mute && !el.muted) { el.muted = true; mutedByUs.add(el); }
      else if (!mute && mutedByUs.has(el)) { el.muted = false; mutedByUs.delete(el); }
    } catch (err) { /* a detached or not-yet-ready element */ }
  }
}

export const mqDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
export function syncAutoTheme() {
  if (!P('themeAuto') || !mqDark) return;
  store.set('prefs.theme', mqDark.matches ? 'dark' : 'light');
}

/* ---- recently changed ------------------------------------------------
   Settings shows the entries it has a row for (and ignores the rest), so
   this keeps a few more than it shows. */
export const RECENT_KEY = 'prefs.recent';
const RECENT_KEEP = 24;

export function remember(id) {
  if (!id || id === 'recent') return;
  const prev = store.get(RECENT_KEY, []) || [];
  const next = [{ id, at: Date.now() }, ...prev.filter(r => r && r.id !== id)].slice(0, RECENT_KEEP);
  store.set(RECENT_KEY, next);               // a NEW array: store.set compares by identity
}

/* Pixel icons (core/pixelicons.js). The module is imported only once the
   preference is on — with it off nothing is loaded, built or watched. */
let pixelLoaded = null;
export function applyPixelIcons() {
  const on = !!P('pixelIcons');
  if (!on && !pixelLoaded) return Promise.resolve(false);
  pixelLoaded = pixelLoaded || import('./pixelicons.js');
  return pixelLoaded.then(m => m.set(P('pixelIcons'))).catch(() => false);
}

let started = false;
export function init() {
  if (started || typeof document === 'undefined') return;
  started = true;
  applyChrome();
  syncAutoTheme();
  applyVolume();
  applyPixelIcons();
  mqDark?.addEventListener?.('change', syncAutoTheme);
  store.sub('prefs', (_v, path) => {
    applyChrome();
    const key = typeof path === 'string' && path.startsWith('prefs.') ? path.slice(6) : '';
    if (key === 'volume' || key === 'muted') applyVolume();
    if (key === 'themeAuto') syncAutoTheme();
    if (key === 'pixelIcons') applyPixelIcons();
    if (key) remember(key);
  });
  store.sub('dock', () => remember('dock.order'));
  store.sub('wallpaper', () => remember('wp.active'));
  /* Media elements are created long after a volume change; a five-second
     sweep is cheap and catches whatever started playing since. */
  bus.on('tick:5s', applyVolume);
}

export default { init, applyPixelIcons, applyChrome, applyVolume, syncAutoTheme, remember, mqDark, APPEARANCE_DEFAULTS, RECENT_KEY, SPACING };
