/* ============================================================
   thumbs.js — your own thumbs-up and thumbs-down on games.

     of(kind, id)          -> 1 (thumbs-up) | -1 (thumbs-down) | 0
     set(kind, id, v)      -> v; 0 clears it
     toggle(kind, id, v)   -> the new value (pressing the lit thumb again clears it)
     list(v)               -> [{ kind, id, at }] newest first
     isHidden(kind, id)    -> a thumbs-down hides the game in Static Play
     hiddenKeys()          -> Set of 'kind:id'
     sub(fn)               -> unsubscribe

   kind is 'web' (the catalogue) or 'arcade' (the Static Arcade).

   These are THIS DEVICE'S marks and nothing else. StaticOS has no
   server, so there is no "1.2k people liked this": nothing here is
   ever shown as a count of other people. A thumbs-down hides the game
   from every shelf, search and Quick Play pick in Static Play; Home
   lists what you hid so it can be brought back.

   Saved in the store at portal.games.thumbs as
     { 'web:<id>': { v: 1 | -1, at: <ms> }, … }
   so it travels with Settings -> Back up your data like the rest.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const KEY = 'portal.games.thumbs';
const MAX = 2000;           // plenty for one person, and keeps the saved state small
const KINDS = new Set(['web', 'arcade']);

const keyOf = (kind, id) => `${kind}:${id}`;
const okKind = k => KINDS.has(k);

function read() {
  const v = store.get(KEY, null);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/** 1, -1 or 0 for one game. */
export function of(kind, id) {
  const e = read()[keyOf(kind, id)];
  return e && (e.v === 1 || e.v === -1) ? e.v : 0;
}

/** Set (1 / -1) or clear (0) your thumb on a game. */
export function set(kind, id, v) {
  if (!okKind(kind) || typeof id !== 'string' || !id) return 0;
  const val = v === 1 || v === -1 ? v : 0;
  const cur = read();
  const k = keyOf(kind, id);
  const prev = cur[k] && cur[k].v;
  if ((prev || 0) === val) return val;
  const next = { ...cur };
  if (val) next[k] = { v: val, at: Date.now() };
  else delete next[k];
  /* the oldest marks go first if the list ever grows past MAX */
  const keys = Object.keys(next);
  if (keys.length > MAX) {
    keys.sort((a, b) => (next[a].at || 0) - (next[b].at || 0));
    for (const old of keys.slice(0, keys.length - MAX)) delete next[old];
  }
  store.set(KEY, next);
  bus.emit('game:thumb', { kind, id, v: val });
  return val;
}

/** Press a thumb: the lit one goes out, otherwise it lights (and the other goes out). */
export const toggle = (kind, id, v) => set(kind, id, of(kind, id) === v ? 0 : v);

/** Your thumbs-up (v = 1) or thumbs-down (v = -1), newest first. */
export function list(v = 1) {
  const out = [];
  for (const [k, e] of Object.entries(read())) {
    if (!e || e.v !== v) continue;
    const i = k.indexOf(':');
    const kind = k.slice(0, i);
    if (!okKind(kind)) continue;
    out.push({ kind, id: k.slice(i + 1), at: Number(e.at) || 0 });
  }
  return out.sort((a, b) => b.at - a.at);
}

export function hiddenKeys() {
  const s = new Set();
  for (const [k, e] of Object.entries(read())) if (e && e.v === -1) s.add(k);
  return s;
}

export const isHidden = (kind, id) => of(kind, id) === -1;

export const sub = fn => store.sub(KEY, fn);

export default { KEY, of, set, toggle, list, hiddenKeys, isHidden, sub };
