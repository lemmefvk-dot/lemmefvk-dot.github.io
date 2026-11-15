/* ============================================================
   themefile.js — a theme as a file you can keep, send and open again.

   Settings › Themes › Share a theme writes the look you have now to
   a small text file in Files (~/Documents/<name>.staticos-theme.json)
   and reads one back — one you made, a friend's, or any you pick from
   your computer. A theme file is data and nothing else:

     { "format": "staticos-theme", "version": 1, "name": "Midnight",
       "accent": "#8b5cf6",            the accent colour
       "appearance": "dark",           dark | light
       "wallpaper": "pack-drive",      a built-in wallpaper's id (optional)
       "iconStyle": "clay",            glass round sharp flat outline tinted clay
       "dockStyle": "solid",           glass solid minimal
       "barStyle": "compact",          default transparent compact
       "uiFont": "rounded",            default system rounded serif mono
       "soundPack": "soft" }           glass retro soft mech chime …

   What it can't do, by design: it holds no code, no address and no
   file path, so opening one can only choose among looks StaticOS
   already has. Every field is checked against the list of what is
   allowed; anything else is ignored, and a file that isn't a theme
   (or is too big, or from a newer StaticOS) is refused with a reason.
   A picture of your own (from Files) is not part of a theme — it is
   yours, not the theme's — and a theme's wallpaper must be one that
   ships with StaticOS.

     snapshot(name)        the look you have now, as a theme
     validate(text)        { ok, theme } | { ok: false, error }
     describe(theme)       what applying it changes, in words
     apply(theme)          put it on (each part is an ordinary preference)
     save(name)            write it to Files -> the path
     files()               theme files found in Files
   ============================================================ */
import { store } from './store.js';
import { vfs } from './vfs.js';
import * as THEMES from './themes.js';
import * as WP from '../portal/wallpapers.js';
import * as APP from './appearance.js';
import { PACKS as SOUND_PACKS } from './sfx.js';

export const FORMAT = 'staticos-theme';
export const VERSION = 1;
export const EXT = '.staticos-theme.json';
export const MAX_BYTES = 8 * 1024;
export const ICON_STYLES = ['glass', 'round', 'sharp', 'flat', 'outline', 'tinted', 'clay'];

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The look you have now, as a theme. */
export function snapshot(name = 'My theme') {
  const p = store.get('prefs', {}) || {};
  const t = THEMES.themeById(THEMES.canonId(p.accent));
  const wp = store.get(WP.ACTIVE_KEY);
  const out = {
    format: FORMAT, version: VERSION, name: clean(name, 40) || 'My theme',
    accent: t.accent, appearance: p.theme === 'light' ? 'light' : 'dark',
    iconStyle: ICON_STYLES.includes(p.iconStyle) ? p.iconStyle : 'glass',
    dockStyle: APP.DOCK_STYLES.includes(p.dockStyle) ? p.dockStyle : 'glass',
    barStyle: APP.BAR_STYLES.includes(p.barStyle) ? p.barStyle : 'default',
    uiFont: APP.UI_FONTS.includes(p.uiFont) ? p.uiFont : 'default',
    soundPack: SOUND_PACKS.some(x => x.id === p.soundPack) ? p.soundPack : 'glass',
  };
  if (WP.BUILT_IN.some(w => w.id === wp)) out.wallpaper = wp;
  return out;
}

/** Check a theme file's text (or an object). Only allowed values survive. */
export function validate(input) {
  let o = input;
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES) return { ok: false, error: 'That file is too big to be a theme.' };
    try { o = JSON.parse(input); } catch (e) { return { ok: false, error: 'That isn’t a theme file — it isn’t readable as one.' }; }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.format !== FORMAT) return { ok: false, error: 'That isn’t a StaticOS theme file.' };
  if (!Number.isInteger(o.version) || o.version < 1) return { ok: false, error: 'That theme file has no version.' };
  if (o.version > VERSION) return { ok: false, error: 'That theme was made by a newer StaticOS. Update, then try again.' };
  const t = { name: clean(o.name, 40) || 'Imported theme' };
  if (THEMES.isHex(o.accent)) t.accent = String(o.accent).trim().toLowerCase();
  if (o.appearance === 'dark' || o.appearance === 'light') t.appearance = o.appearance;
  if (typeof o.wallpaper === 'string' && WP.BUILT_IN.some(w => w.id === o.wallpaper)) t.wallpaper = o.wallpaper;
  if (ICON_STYLES.includes(o.iconStyle)) t.iconStyle = o.iconStyle;
  if (APP.DOCK_STYLES.includes(o.dockStyle)) t.dockStyle = o.dockStyle;
  if (APP.BAR_STYLES.includes(o.barStyle)) t.barStyle = o.barStyle;
  if (APP.UI_FONTS.includes(o.uiFont)) t.uiFont = o.uiFont;
  if (typeof o.soundPack === 'string' && SOUND_PACKS.some(x => x.id === o.soundPack)) t.soundPack = o.soundPack;
  if (Object.keys(t).length < 2) return { ok: false, error: 'That theme file has nothing in it StaticOS can use.' };
  return { ok: true, theme: t };
}

const NAMES = { dockStyle: 'dock', barStyle: 'top bar', uiFont: 'font', iconStyle: 'icons', soundPack: 'sounds' };
/** What applying it changes, in words. */
export function describe(t) {
  const bits = [];
  if (t.accent) bits.push(`accent ${t.accent}`);
  if (t.appearance) bits.push(t.appearance === 'light' ? 'light mode' : 'dark mode');
  if (t.wallpaper) bits.push(`${WP.BUILT_IN.find(w => w.id === t.wallpaper).name} wallpaper`);
  for (const k of Object.keys(NAMES)) if (t[k]) bits.push(`${NAMES[k]}: ${k === 'soundPack' ? (SOUND_PACKS.find(x => x.id === t[k]) || {}).name : t[k]}`);
  return bits.join(', ');
}

/** Put a validated theme on. Each part is an ordinary preference, so Settings,
    the Store and a reload all see it. */
export function apply(t) {
  /* the wallpaper first: picking one brings its own accent, which the file's own accent then replaces */
  if (t.wallpaper) WP.setActive(store, t.wallpaper);
  const prefs = { ...store.get('prefs', {}) };
  if (t.accent) {
    const known = THEMES.THEMES.find(x => x.accent === t.accent);
    prefs.accent = known ? known.id : t.accent;
  }
  if (t.appearance) { prefs.theme = t.appearance; prefs.themeAuto = false; prefs.themeSun = false; }
  if (t.iconStyle) prefs.iconStyle = t.iconStyle;
  if (t.dockStyle) prefs.dockStyle = t.dockStyle;
  if (t.barStyle) prefs.barStyle = t.barStyle;
  if (t.uiFont) prefs.uiFont = t.uiFont;
  if (t.soundPack) prefs.soundPack = t.soundPack;
  store.set('prefs', prefs);
  if (t.accent) THEMES.apply(prefs.accent);
  return t;
}

/* ---------- Files ---------- */
const DIR = () => `${vfs.HOME}/Documents`;
const fileName = name => `${clean(name, 40).replace(/[\\/:*?"|]/g, '-').replace(/^\.+/, '') || 'My theme'}${EXT}`;

/** Write the current look to ~/Documents. -> the path */
export function save(name) {
  const dir = DIR();
  if (!vfs.node(dir)) vfs.mkdir(dir);
  const base = fileName(name).slice(0, -EXT.length);
  let path = `${dir}/${base}${EXT}`;
  for (let n = 2; vfs.node(path); n++) path = `${dir}/${base} ${n}${EXT}`;
  vfs.write(path, JSON.stringify(snapshot(name), null, 2) + '\n');
  return path;
}

/** Theme files in Files (by name), newest first. */
export function files() {
  const out = [];
  vfs.walk(vfs.HOME, (n, p) => {
    if (n.type === 'file' && n.name.endsWith(EXT) && !/\/Trash\//.test(p)) out.push({ path: p, name: n.name.slice(0, -EXT.length), mtime: n.mtime || '' });
  });
  return out.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
}

export default { FORMAT, VERSION, EXT, snapshot, validate, describe, apply, save, files };
