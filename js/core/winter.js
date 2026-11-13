/* ============================================================
   winter.js — the advent calendar: 24 doors, one small treat each.

   During winter (December 1 – January 1, js/core/season.js) a gift
   in the dock opens the calendar (js/shell/winter.js draws it).
   Door N opens on December N by this device's LOCAL date — today's
   door and every earlier one you missed; tomorrow's stays shut.
   From December 24 to January 1 all 24 can be opened.

   Each door always gives the same treat (DOORS below), and every
   treat is real and keeps working all year, like Halloween's:
     wallpaper  added to the wallpaper picker (portal.wallpapers)
     cursor     a pointer to wear (prefs.cursorSkin, the one
                Halloween's cursors use — js/shell/halloween-fun.js
                draws them all)
     sticker    a desktop sticker (Halloween's sticker layer)
     sound      a notification tone (prefs.notiTone, js/core/sfx.js)
   js/core/halloween.js looks winter's stickers and cursors up here,
   so its stickers, cursor and "owns" checks work for both.

   State, per device:
     portal.winter = { doors: { '1': <ms opened>, … } }

   Emits bus 'winter:door' { n, treat, opened } when a door opens.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as WP from '../portal/wallpapers.js';
import { isWinterSeason } from './season.js';
import * as ART from './winter-art.js';

const KEY = 'portal.winter';
export const DOOR_COUNT = 24;

export const svgUrl = svg => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

export const CATALOG = { wallpaper: ART.WALLPAPERS, cursor: ART.CURSORS, sticker: ART.STICKERS, sound: ART.SOUNDS };
export const TYPE_LABEL = { wallpaper: 'wallpaper', cursor: 'cursor', sticker: 'sticker', sound: 'notification sound' };
export const find = (type, id) => (CATALOG[type] || []).find(t => t.id === id) || null;

/* which door gives what: four wallpapers, four cursors, four sounds and
   twelve stickers, mixed so most weeks bring a bit of everything */
export const DOORS = [
  ['sticker', 'snowflake'], ['cursor', 'frost'], ['sticker', 'mitten'], ['sound', 'sleigh-bells'],
  ['sticker', 'cocoa'], ['wallpaper', 'snowflakes'], ['sticker', 'gingerbread'], ['cursor', 'candy-cane'],
  ['sticker', 'holly'], ['sticker', 'snowman'], ['sound', 'music-box'], ['wallpaper', 'snowy-pines'],
  ['sticker', 'penguin'], ['cursor', 'gingerbread'], ['sticker', 'candy-cane'], ['sound', 'icicle-chimes'],
  ['sticker', 'ornament'], ['wallpaper', 'cocoa-window'], ['sticker', 'gift'], ['cursor', 'evergreen'],
  ['sticker', 'star'], ['sound', 'carol-bells'], ['sticker', 'pine'], ['wallpaper', 'northern-lights'],
].map(([type, id], i) => ({ n: i + 1, type, id }));

/** What door n gives: { n, type, id, name }. */
export function doorTreat(n) {
  const d = DOORS[n - 1];
  if (!d) return null;
  return { n: d.n, type: d.type, id: d.id, name: find(d.type, d.id).name };
}

/* data URLs are built once per item, on first use */
const urls = new Map();
export function artUrl(type, id) {
  const k = `${type}:${id}`;
  if (!urls.has(k)) {
    const t = find(type, id);
    urls.set(k, t ? svgUrl(t.svg()) : '');
  }
  return urls.get(k);
}

/* ---------------- dates ---------------- */
/** The highest door that may be opened on date d: December d's date (up to
    24), all 24 on January 1, none outside winter. */
export function openUpTo(d = new Date()) {
  if (!isWinterSeason(d)) return 0;
  return d.getMonth() === 11 ? Math.min(DOOR_COUNT, d.getDate()) : DOOR_COUNT;
}
/** The door that belongs to today, or 0 (outside December 1–24). */
export const todaysDoor = (d = new Date()) => (d.getMonth() === 11 && d.getDate() <= DOOR_COUNT ? d.getDate() : 0);

/* ---------------- state ---------------- */
export function state() {
  const v = store.get(KEY, null) || {};
  const doors = {};
  if (v.doors && typeof v.doors === 'object') {
    for (const [k, at] of Object.entries(v.doors)) {
      const n = Number(k);
      if (Number.isInteger(n) && n >= 1 && n <= DOOR_COUNT) doors[n] = Number(at) || 0;
    }
  }
  return { doors };
}
export const isOpen = n => !!state().doors[n];
export const openedCount = () => Object.keys(state().doors).length;
export const ownsAny = () => openedCount() > 0;

export function owns(type, id) {
  const st = state();
  return DOORS.some(d => d.type === type && d.id === id && st.doors[d.n]);
}
/** The treats of one type you have, in door order. */
export const ownedList = type => DOORS.filter(d => d.type === type && state().doors[d.n]).map(d => find(type, d.id));

/* ---------------- what a treat does ---------------- */
const wpCode = id => `WINTER-${id.toUpperCase()}`;
/** The picker id of a winter wallpaper you own, or null. */
export function wallpaperId(id) {
  const code = wpCode(id).toLowerCase();
  const hit = WP.custom(store).find(w => String(w.code || '').toLowerCase() === code);
  return hit ? hit.id : null;
}
function addWallpaper(id) {
  const t = find('wallpaper', id);
  if (!t) return null;
  if (!wallpaperId(id)) WP.add(store, { name: t.name, url: svgUrl(t.svg()), kind: 'image', code: wpCode(id), by: 'Advent calendar' });
  WP.redeem(store, wpCode(id));
  return wallpaperId(id);
}
export function useWallpaper(id) {
  if (!owns('wallpaper', id)) return false;
  const wid = wallpaperId(id) || addWallpaper(id);
  if (!wid) return false;
  const ok = !!WP.setActive(store, wid);
  if (ok) bus.emit('wallpaper:changed');
  return ok;
}

/** Wear a winter cursor ('none' puts the usual one back). */
export function setCursor(id) {
  const want = id && id !== 'none' && owns('cursor', id) ? id : 'none';
  store.set('prefs.cursorSkin', want);
  return want;
}

/** Use a winter sound for notifications ('none' puts the pack's own back). */
export function setTone(id) {
  const want = id && id !== 'none' && owns('sound', id) ? id : 'none';
  store.set('prefs.notiTone', want);
  return want;
}

/* ---------------- opening a door ---------------- */
/**
 * Open door n. Returns, and announces when a door really opens:
 *   { kind: 'closed' }                     not winter: the calendar is put away
 *   { kind: 'locked', n, opensOn }         a door from the future
 *   { kind: 'open', n, treat }             it was already open
 *   { kind: 'treat', n, treat, opened }    opened just now
 */
export function openDoor(n, { now = new Date() } = {}) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1 || n > DOOR_COUNT) return { kind: 'none' };
  if (!isWinterSeason(now)) return { kind: 'closed' };
  const treat = doorTreat(n);
  if (n > openUpTo(now)) return { kind: 'locked', n, opensOn: new Date(now.getFullYear(), 11, n) };
  const st = state();
  if (st.doors[n]) return { kind: 'open', n, treat };
  store.set(KEY, { doors: { ...st.doors, [n]: now.getTime() } });
  if (treat.type === 'wallpaper') addWallpaper(treat.id);
  const r = { kind: 'treat', n, treat, opened: openedCount() };
  bus.emit('winter:door', r);
  return r;
}

export default {
  DOORS, DOOR_COUNT, CATALOG, TYPE_LABEL, find, doorTreat, artUrl, openUpTo, todaysDoor,
  state, isOpen, openedCount, ownsAny, owns, ownedList, wallpaperId, useWallpaper, setCursor, setTone, openDoor,
};
