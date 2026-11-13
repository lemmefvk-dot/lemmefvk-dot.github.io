/* ============================================================
   packs.js — theme packs: an accent, a wallpaper and an icon
   style made to go together, put on in one click from
   Settings › Themes and taken off again just as easily.

   A pack is only a choice of three things that already exist on
   their own — a named theme (themes.js), a built-in wallpaper
   (portal/wallpapers.js; the art is original, drawn by
   tools/pack-art.mjs) and an icon style (main.js, feat-store.css)
   — so each part can still be changed by itself afterwards, and
   a look code (Store) carries a pack like any other look.

   Reversible: the look from before the first pack is kept in
   store('portal.themePack') = { on, at, before: { accent,
   wallpaper, iconStyle, spookyWallpaper? } } until it is put
   back, so trying one pack after another and then "Put back"
   lands exactly where you started — even after a reload.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as THEMES from './themes.js';
import * as SEASON from './season.js';
import * as WP from '../portal/wallpapers.js';

export const KEY = 'portal.themePack';

export const ICON_STYLES = {
  glass: 'Glass', round: 'Round', sharp: 'Sharp', flat: 'Flat', outline: 'Outline', tinted: 'Tinted',
};

export const PACKS = [
  { id: 'drive', name: 'Night Drive', accent: 'drive', wallpaper: 'pack-drive', icons: 'sharp',
    blurb: 'A striped sunset over a neon grid, cyan glow everywhere, and square-cut icons.' },
  { id: 'glacier', name: 'Glacier', accent: 'glacier', wallpaper: 'pack-glacier', icons: 'round',
    blurb: 'Aurora over snowy peaks, periwinkle ice for the accent, and round icons.' },
  { id: 'grove', name: 'Autumn Grove', accent: 'grove', wallpaper: 'pack-grove', icons: 'flat',
    blurb: 'Hills at dusk with leaves coming down, a rust accent, and flat, quiet icons.' },
  { id: 'abyss', name: 'Deep Sea', accent: 'abyss', wallpaper: 'pack-abyss', icons: 'tinted',
    blurb: 'Light rays, kelp and a jellyfish, with every icon tinted sea-glass teal.' },
  { id: 'matcha', name: 'Matcha', accent: 'matcha', wallpaper: 'pack-matcha', icons: 'outline',
    blurb: 'A raked-sand garden with mossy stones, new-leaf green, and outlined icons.' },
  { id: 'sakura', name: 'Sakura', accent: 'sakura', wallpaper: 'pack-sakura', icons: 'round',
    blurb: 'A blossom branch over a plum dusk, petal pink for the accent, and soft round icons.' },
  { id: 'arcade', name: 'Neon Arcade', accent: 'arcade', wallpaper: 'pack-arcade', icons: 'flat',
    blurb: 'Carpet confetti and glowing pixels, hot magenta for the accent, and bold flat icons.' },
];
export const packById = id => PACKS.find(p => p.id === id) || null;

/** What's on now: { accent, wallpaper, iconStyle } (+ the spooky wallpaper switch in season). */
export function look() {
  const L = {
    accent: THEMES.canonId(store.get('prefs.accent')),
    wallpaper: store.get(WP.ACTIVE_KEY) || WP.BUILT_IN[0].id,
    iconStyle: ICON_STYLES[store.get('prefs.iconStyle')] ? store.get('prefs.iconStyle') : 'glass',
  };
  if (SEASON.spookyOn()) L.spookyWallpaper = store.get('prefs.spookyWallpaper') !== false;
  return L;
}

export function state() {
  const s = store.get(KEY, null);
  if (!s || typeof s !== 'object') return { on: null, at: 0, before: null };
  const b = s.before && typeof s.before === 'object' && typeof s.before.accent === 'string' ? s.before : null;
  return { on: packById(s.on) ? s.on : null, at: Number(s.at) || 0, before: b };
}

/** The pack whose three parts are all in use right now, or null. */
export function current() {
  const L = look();
  return PACKS.find(p => p.accent === L.accent && p.wallpaper === L.wallpaper && p.icons === L.iconStyle) || null;
}

/* Put a look on, part by part, so every listener (Settings, the desktop,
   main.js) hears exactly the key it watches. The accent goes first, so the
   desktop already has it when the wallpaper changes. */
function put(L) {
  if (L.accent) { store.set('prefs.accent', L.accent); THEMES.apply(L.accent); }
  if (L.wallpaper && WP.byId(store, L.wallpaper)) {
    store.set(WP.ACTIVE_KEY, L.wallpaper);
    bus.emit('wallpaper:changed');
  }
  if (L.iconStyle) store.set('prefs.iconStyle', L.iconStyle);
  /* in season, picking a wallpaper switches the haunted house off (desktop.js);
     going back puts that switch back too */
  if (typeof L.spookyWallpaper === 'boolean' && SEASON.isSpookySeason()) store.set('prefs.spookyWallpaper', L.spookyWallpaper);
}

/**
 * Put a pack on. -> { pack, undo } or null. `undo` puts back the look from
 * just before this one (the toast's Undo); revert() goes all the way back to
 * before the first pack.
 */
export function apply(id) {
  const p = packById(id);
  if (!p) return null;
  const was = look();
  const prev = store.get(KEY, null);
  const st = state();
  put({ accent: p.accent, wallpaper: p.wallpaper, iconStyle: p.icons });
  store.set(KEY, { on: p.id, at: Date.now(), before: st.before || was });
  bus.emit('pack:change', p.id);
  return {
    pack: p,
    undo: () => { put(was); store.set(KEY, prev ? { ...prev } : null); bus.emit('pack:change', null); },
  };
}

/** Take the packs off: the look from before the first one comes back. -> whether there was one to put back */
export function revert() {
  const st = state();
  if (!st.before) return false;
  put(st.before);
  store.set(KEY, null);
  bus.emit('pack:change', null);
  return true;
}

/** "Static Crimson · Canopy · Glass icons" — a look in words. */
export function describe(L) {
  if (!L) return '';
  const w = WP.byId(store, L.wallpaper);
  return [THEMES.themeById(L.accent).name, w ? w.name : null, `${ICON_STYLES[L.iconStyle] || 'Glass'} icons`].filter(Boolean).join(' · ');
}

export default { KEY, PACKS, ICON_STYLES, packById, look, state, current, apply, revert, describe };
