/* ============================================================
   ghosts.js — the Halloween ghost hunt: where the thirteen ghosts
   hide, and which ones you have caught.

   js/shell/ghosts.js puts the ghosts on screen, Settings › Halloween
   fun shows your progress and the hunt's off switch, and
   achievements.js awards Ghost Hunter for all thirteen.

   The hunt runs with the spooky season — 24 October to the end of
   1 November by this device's date — while Spooky Season and the
   hunt's own switch (prefs.ghostHunt) are on: season.js
   spooky('ghosts'). Out of season no ghost shows anywhere.

   State, on this device only:
     portal.ghosts = { year: 2026, found: { <spot id>: <ms caught> } }
   A ghost counts once. Next October starts a new hunt; the badge
   stays yours.

   Emits bus 'ghosts:found' { id, where, n, total, all }
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as SEASON from './season.js';

/* Where they hide. The shell module knows the exact element for each
   id; `where` is how a toast and Settings name the place. */
export const SPOTS = [
  { id: 'desktop', where: 'on the desktop' },
  { id: 'dock', where: 'in the Dock' },
  { id: 'topbar', where: 'in the top bar' },
  { id: 'launcher', where: 'in the Launcher' },
  { id: 'spotlight', where: 'in Spotlight' },
  { id: 'control', where: 'in Control Centre' },
  { id: 'noti', where: 'in the Notification Centre' },
  { id: 'files', where: 'in Files' },
  { id: 'settings', where: 'in Settings' },
  { id: 'play', where: 'in Static Play' },
  { id: 'browser', where: 'in the Browser' },
  { id: 'music', where: 'in Music' },
  { id: 'pumpkin', where: 'in the Pumpkin Carver' },
];
export const TOTAL = SPOTS.length;

const KEY = 'portal.ghosts';
const byId = new Map(SPOTS.map(s => [s.id, s]));

/** Is the hunt on right now (in season, Spooky Season on, the hunt's switch on)? */
export const active = (d = new Date()) => SEASON.spooky('ghosts', d);

/** This year's hunt: { year, found: { id: at } } — only ids that exist. */
export function state(d = new Date()) {
  const year = d.getFullYear();
  const v = store.get(KEY, null);
  const saved = v && typeof v === 'object' && v.year === year && v.found && typeof v.found === 'object' ? v.found : {};
  const found = {};
  for (const s of SPOTS) if (saved[s.id]) found[s.id] = saved[s.id];
  return { year, found };
}

export const foundCount = (d = new Date()) => Object.keys(state(d).found).length;
export const isFound = (id, d = new Date()) => !!state(d).found[id];
export const spot = id => byId.get(id) || null;

/**
 * Catch the ghost at `id`. Counts once: a ghost already caught, an
 * unknown id or a hunt that is off returns null and changes nothing.
 */
export function find(id, d = new Date()) {
  const s = byId.get(id);
  if (!s || !active(d)) return null;
  const cur = state(d);
  if (cur.found[id]) return null;
  const found = { ...cur.found, [id]: Date.now() };
  store.set(KEY, { year: cur.year, found });
  const n = Object.keys(found).length;
  const r = { id, where: s.where, n, total: TOTAL, all: n >= TOTAL };
  bus.emit('ghosts:found', r);
  return r;
}

export default { SPOTS, TOTAL, active, state, foundCount, isFound, spot, find };
