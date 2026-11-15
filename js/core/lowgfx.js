/* ============================================================
   lowgfx.js — Low graphics mode: one preset over everything that costs frames.

   On: reduced motion, no background blur, no deep shadows, no wallpaper
   grain. Off puts those four back to their defaults. It only writes the
   same four prefs Settings › Performance shows as separate switches
   (appearance.js and main.js apply them), so it lives here, in core:
   Settings, the Control Centre and the slow-device check (smoothcheck.js)
   all use it, and none of them needs another's window.
   ============================================================ */
import { store } from './store.js';

/* what Low graphics mode sets */
export const LOW_GFX = { reduceMotion: true, uiBlur: false, uiShadows: false, wallpaperGrain: false };
/* the same four prefs at their defaults (what "off" restores) */
export const DEFAULTS = { reduceMotion: false, uiBlur: true, uiShadows: true, wallpaperGrain: true };

const val = k => {
  const v = store.get('prefs.' + k);
  return v === undefined ? DEFAULTS[k] : v;
};

/** Is every one of the four at its Low graphics value? */
export const isOn = () => Object.entries(LOW_GFX).every(([k, v]) => !!val(k) === !!v);

/** Turn it on, or put the four prefs back to their defaults. */
export function set(on) {
  for (const [k, v] of Object.entries(LOW_GFX)) store.set('prefs.' + k, on ? v : DEFAULTS[k]);
}

export default { LOW_GFX, DEFAULTS, isOn, set };
