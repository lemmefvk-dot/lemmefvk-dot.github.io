/* ============================================================
   lookcode.js — a look as a short code, and the places a look
   gets kept.

   StaticOS has no server, so "share your setup" is a code you copy
   and send: your accent, light/dark, wallpaper, icon style, sound
   pack, desktop layout and (new) the Dock or taskbar and the
   launcher style, packed as base64url JSON behind SLOOK1. Pasting
   one shows exactly what it will change and can be undone.
   Decoding is strict — every field is checked against what this
   build knows, a custom wallpaper is only accepted as an https
   image/video URL, and fields an older build does not know are
   simply not there, so older codes still open.

   The same code is what everything else that keeps a "look" keeps:
     · look slots in Static Store ("Study", "Gaming", "Night"),
     · the day look and the night look that switch by themselves
       (core/automations.js),
     · a look sent to a friend (core/friends.js),
     · the look inside a whole-setup profile or Mode (core/setup.js).
   So there is one format, not four.

     encodeLook(store?)       -> 'SLOOK1.…' for the look you have now
     decodeLook(code)         -> look, or throws a plain reason
     describeLook(look)       -> ['Theme: …', …] what it will change
     applyLook(look)          -> undo() — puts back what it changed
     slots() / saveSlot(name) / useSlot(id) / removeSlot(id) / renameSlot(id, name)
     SLOT_NAMES               the suggestions: Study, Gaming, Night
   ============================================================ */
import { store as GSTORE } from './store.js';
import * as THEMES from './themes.js';
import * as WP from '../portal/wallpapers.js';
import sfx from './sfx.js';

export const PREFIX = 'SLOOK1.';
export const ICON_IDS = ['glass', 'round', 'sharp', 'flat', 'outline', 'tinted', 'clay'];
export const LOOK_BOOLS = ['desktopIcons', 'widgetsVisible', 'desktopClock', 'dockMagnify'];
export const SHELLS = ['dock', 'taskbar'];
export const LAUNCHERS = ['panel', 'start'];
export const SLOT_NAMES = ['Study', 'Gaming', 'Night'];
export const MAX_SLOTS = 8;
export const SLOTS_KEY = 'prefs.lookSlots';
export const CODE_MAX = 2400;

const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))));

export function encodeLook(store = GSTORE) {
  const p = store.get('prefs', {}) || {};
  const w = WP.active(store);
  const look = {
    a: THEMES.canonId(p.accent),
    m: p.theme === 'light' ? 'light' : 'dark',
    i: ICON_IDS.includes(p.iconStyle) ? p.iconStyle : 'glass',
    s: sfx.PACKS.some(x => x.id === p.soundPack) ? p.soundPack : 'glass',
    d: Object.fromEntries(LOOK_BOOLS.map(k => [k, p[k] !== false])),
    /* the shell: only written when it is not the usual one, so old codes stay the same */
  };
  if (p.shellLayout === 'taskbar' || p.launcherStyle === 'start') {
    look.o = { s: p.shellLayout === 'taskbar' ? 'taskbar' : 'dock', l: p.launcherStyle === 'start' ? 'start' : 'panel' };
  }
  if (w?.built) look.w = { id: w.id };
  else if (w && /^https:\/\//i.test(w.url || '')) look.w = { url: w.url, name: String(w.name || 'Wallpaper').slice(0, 40), kind: w.kind };
  return PREFIX + b64u(JSON.stringify(look));
}

/** -> a look ({ accent, theme, iconStyle, soundPack, prefs, wallpaper, shell, launcher }) or throws with a plain-language reason */
export function decodeLook(code) {
  const raw = String(code || '').trim();
  if (!raw.startsWith(PREFIX)) throw new Error('That isn’t a StaticOS look code (they start with SLOOK1.).');
  if (raw.length > CODE_MAX) throw new Error('That code is too long to be a look code.');
  let o;
  try { o = JSON.parse(unb64u(raw.slice(PREFIX.length))); } catch (e) { throw new Error('That code is damaged — it may have been cut off when it was copied.'); }
  if (!o || typeof o !== 'object') throw new Error('That code is empty.');
  const look = {};
  if (THEMES.isTheme(o.a) || THEMES.isHex(o.a)) look.accent = THEMES.canonId(o.a);
  if (o.m === 'light' || o.m === 'dark') look.theme = o.m;
  if (ICON_IDS.includes(o.i)) look.iconStyle = o.i;
  if (sfx.PACKS.some(x => x.id === o.s)) look.soundPack = o.s;
  if (o.d && typeof o.d === 'object') {
    look.prefs = {};
    for (const k of LOOK_BOOLS) if (typeof o.d[k] === 'boolean') look.prefs[k] = o.d[k];
  }
  if (o.o && typeof o.o === 'object') {
    if (SHELLS.includes(o.o.s)) look.shell = o.o.s;
    if (LAUNCHERS.includes(o.o.l)) look.launcher = o.o.l;
  }
  if (o.w && typeof o.w === 'object') {
    if (typeof o.w.id === 'string' && WP.BUILT_IN.some(w => w.id === o.w.id)) look.wallpaper = { id: o.w.id };
    else if (typeof o.w.url === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(o.w.url) && o.w.url.length < 600) {
      look.wallpaper = { url: o.w.url, name: String(o.w.name || 'Shared wallpaper').replace(/[<>]/g, '').slice(0, 40), kind: ['image', 'gif', 'video'].includes(o.w.kind) ? o.w.kind : undefined };
    }
  }
  if (!Object.keys(look).length) throw new Error('That code doesn’t contain anything this version of StaticOS understands.');
  return look;
}

/** What applying a look will change, in words (the preview before Apply). */
export function describeLook(L, store = GSTORE) {
  const out = [];
  if (L.accent) out.push(`Theme: ${THEMES.themeById(L.accent).name}${THEMES.isHex(L.accent) ? ` (${L.accent})` : ''}`);
  if (L.theme) out.push(`Appearance: ${L.theme === 'light' ? 'Light' : 'Dark'}`);
  if (L.wallpaper) out.push(`Wallpaper: ${L.wallpaper.id ? (WP.byId(store, L.wallpaper.id)?.name || L.wallpaper.id) : `${L.wallpaper.name} (from ${new URL(L.wallpaper.url).hostname})`}`);
  if (L.iconStyle) out.push(`Icons: ${L.iconStyle.charAt(0).toUpperCase() + L.iconStyle.slice(1)}`);
  if (L.soundPack) out.push(`Sounds: ${sfx.PACKS.find(x => x.id === L.soundPack).name}`);
  if (L.prefs && Object.keys(L.prefs).length) {
    const on = k => (L.prefs[k] === false ? 'off' : 'on');
    out.push(`Desktop: icons ${on('desktopIcons')}, widgets ${on('widgetsVisible')}, clock ${on('desktopClock')}`);
  }
  if (L.shell || L.launcher) out.push(`Shell: ${L.shell === 'taskbar' ? 'taskbar' : 'Dock'}${L.launcher ? `, ${L.launcher === 'start' ? 'Start menu' : 'launcher panel'}` : ''}`);
  return out;
}

/** Put a look on. Returns undo(), which puts back what was there. */
export function applyLook(L, store = GSTORE) {
  const before = { prefs: { ...(store.get('prefs', {}) || {}) }, wallpaper: store.get('wallpaper') };
  const patch = { ...(L.prefs || {}) };
  if (L.accent) patch.accent = L.accent;
  if (L.theme) { patch.theme = L.theme; patch.themeAuto = false; patch.themeSun = false; }
  if (L.iconStyle) patch.iconStyle = L.iconStyle;
  if (L.soundPack) patch.soundPack = L.soundPack;
  if (L.shell) patch.shellLayout = L.shell;
  if (L.launcher) patch.launcherStyle = L.launcher;
  store.set('prefs', { ...(store.get('prefs', {}) || {}), ...patch });
  if (L.wallpaper?.id) WP.setActive(store, L.wallpaper.id);
  else if (L.wallpaper?.url) {
    const existing = WP.custom(store).find(w => w.url === L.wallpaper.url);
    const w = existing || WP.add(store, { name: L.wallpaper.name, url: L.wallpaper.url, kind: L.wallpaper.kind, by: 'look code' });
    WP.setActive(store, w.id);
  }
  /* the accent of a paired wallpaper must not override the look's own accent */
  if (L.accent) store.set('prefs', { ...(store.get('prefs', {}) || {}), accent: L.accent });
  return () => { store.set('prefs', before.prefs); if (before.wallpaper) store.set('wallpaper', before.wallpaper); };
}

/* ---------------- look slots ---------------------------------------
   A slot is a name and a look code, kept in prefs (so it belongs to
   this person and goes in a backup). */
const tidy = s => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
const sid = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function slots(store = GSTORE) {
  const v = store.get(SLOTS_KEY, []);
  return (Array.isArray(v) ? v : []).filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.code === 'string' && s.code.startsWith(PREFIX));
}
const writeSlots = (list, store) => store.set(SLOTS_KEY, list.slice(0, MAX_SLOTS));

/** Keep the look you have now under a name. The same name replaces its slot. */
export function saveSlot(name, store = GSTORE) {
  const n = tidy(name);
  if (!n) throw new Error('Give the look a name first.');
  const list = slots(store);
  const at = list.findIndex(s => s.name.toLowerCase() === n.toLowerCase());
  const slot = { id: at >= 0 ? list[at].id : sid(), name: n, code: encodeLook(store), at: Date.now() };
  if (at >= 0) list[at] = slot;
  else {
    if (list.length >= MAX_SLOTS) throw new Error(`You can keep ${MAX_SLOTS} looks. Remove one first.`);
    list.push(slot);
  }
  writeSlots(list, store);
  return slot;
}
export function removeSlot(id, store = GSTORE) { writeSlots(slots(store).filter(s => s.id !== id), store); }
export function renameSlot(id, name, store = GSTORE) {
  const n = tidy(name);
  if (!n) return false;
  writeSlots(slots(store).map(s => (s.id === id ? { ...s, name: n } : s)), store);
  return true;
}
/** Switch to a slot's look. Returns { slot, look, undo } or null. */
export function useSlot(id, store = GSTORE) {
  const slot = slots(store).find(s => s.id === id);
  if (!slot) return null;
  const look = decodeLook(slot.code);
  return { slot, look, undo: applyLook(look, store) };
}

export default { PREFIX, ICON_IDS, SLOT_NAMES, encodeLook, decodeLook, describeLook, applyLook, slots, saveSlot, removeSlot, renameSlot, useSlot };
