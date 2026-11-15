/* ============================================================
   radiofinds.js — songs you hearted while they were on the radio.

   A station plays whatever SomaFM is broadcasting, so a song you like is
   gone in four minutes. The heart on an on-air song keeps its title,
   artist, album and the station it came from, on this device, so there is
   a list of finds to look the songs up later. Nothing is downloaded or
   fetched, only the words SomaFM itself printed. Kept in Static Radio's
   own store ('portal.radio' › finds), so Music and Radio share one list.

     list()             newest first
     has(song)          is it already kept
     toggle(song, stationId) -> true when it is now kept
     remove(id) / clear()
     keyOf(song)        the same song twice (on two stations) is one find
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

const KEY = 'portal.radio';
export const MAX = 300;
const line = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export const keyOf = s => `${line(s?.artist, 120).toLowerCase()}|${line(s?.title, 160).toLowerCase()}`;

function rec() {
  const o = store.get(KEY);
  return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
}
export function list() {
  const seen = new Set();
  return (Array.isArray(rec().finds) ? rec().finds : [])
    .filter(f => f && line(f.title, 160) && Number.isFinite(Number(f.at)))
    .map(f => ({ id: String(f.id || ''), title: line(f.title, 160), artist: line(f.artist, 120), album: line(f.album, 120), station: line(f.station, 40), at: Number(f.at) }))
    .filter(f => { const k = keyOf(f); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.at - a.at);
}
const write = finds => { store.set(KEY, { ...rec(), finds: finds.slice(0, MAX) }); bus.emit('radiofinds:change'); };
export const has = song => !!song && list().some(f => keyOf(f) === keyOf(song));
export function toggle(song, stationId = '') {
  const title = line(song?.title, 160);
  if (!title) return false;
  const k = keyOf(song);
  const all = list();
  if (all.some(f => keyOf(f) === k)) { write(all.filter(f => keyOf(f) !== k)); return false; }
  write([{ id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, title, artist: line(song.artist, 120), album: line(song.album, 120), station: line(stationId, 40), at: Date.now() }, ...all]);
  return true;
}
export function remove(id) { write(list().filter(f => f.id !== id)); }
export function clear() { write([]); }

export default { list, has, toggle, remove, clear, keyOf, MAX };
