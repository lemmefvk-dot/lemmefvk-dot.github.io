/* ============================================================
   arcade/options.js — the Arcade's shared options, kept per person
   (store 'portal.arcade', which core/profiles.js keeps per person).

     opts:  { palette: 'standard'|'cb', bigText, calm, hudBig, volume }
            for every game: colour-blind colours, larger letters,
            fewer flashes, bigger HUD text, and one game volume
            (0–100, on top of the system volume)
     games: { [id]: { speed, oneButton, keys: { [code]: code }, cursor, touch, mode, set } }
            per game: game speed 0.5–1, one-button mode, remapped keys,
            the controller cursor and on-screen buttons
            (cursor / touch: true, false, or absent = automatic), the
            mode last picked and the game's own settings (./modes.js)

   What each game does with them is in js/arcade/index.js (SHARED
   OPTIONS); the shell offers an option only where a game reads it.
   ============================================================ */
import { store } from '../core/store.js';

export const KEY = 'portal.arcade';
export const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1];
const read = () => { const v = store.get(KEY, null); return v && typeof v === 'object' ? v : {}; };
const CODE = /^[A-Za-z0-9]{1,24}$/;

export function prefs() {
  const o = read().opts || {};
  const vol = Number(o.volume);
  return {
    palette: o.palette === 'cb' ? 'cb' : 'standard',
    bigText: o.bigText === true,
    calm: o.calm === true,
    hudBig: o.hudBig === true,
    volume: Number.isFinite(vol) ? Math.max(0, Math.min(100, Math.round(vol))) : 100,
  };
}
export function setPref(k, v) {
  const cur = read();
  store.set(KEY, { ...cur, opts: { ...(cur.opts || {}), [k]: v } });
}

const cleanKeys = m => {
  const out = {};
  if (m && typeof m === 'object') for (const [a, b] of Object.entries(m)) if (CODE.test(a) && CODE.test(b) && a !== b) out[a] = b;
  return out;
};
export function gamePrefs(id) {
  const g = (read().games || {})[id] || {};
  const sp = typeof g.speed === 'number' ? g.speed : NaN;
  return {
    speed: Number.isFinite(sp) ? Math.max(0.5, Math.min(1, Math.round(sp * 100) / 100)) : 1,
    oneButton: g.oneButton === true,
    keys: cleanKeys(g.keys),
    cursor: typeof g.cursor === 'boolean' ? g.cursor : null,
    touch: typeof g.touch === 'boolean' ? g.touch : null,
    mode: typeof g.mode === 'string' && /^[a-z0-9-]{1,16}$/.test(g.mode) ? g.mode : null,
    set: g.set && typeof g.set === 'object' && !Array.isArray(g.set) ? { ...g.set } : {},
  };
}
/** one of a game's own settings (./modes.js SETTINGS) */
export function setSetting(id, k, v) {
  setGamePref(id, 'set', { ...gamePrefs(id).set, [k]: v });
}
export function setGamePref(id, k, v) {
  const cur = read();
  const games = { ...(cur.games || {}) };
  const g = { ...(games[id] || {}) };
  if (v === null || v === undefined) delete g[k]; else g[k] = v;
  games[id] = g;
  store.set(KEY, { ...cur, games });
}
export function setKey(id, from, to) {
  const keys = gamePrefs(id).keys;
  if (!CODE.test(from || '')) return;
  if (!to || to === from) delete keys[from]; else keys[from] = to;
  setGamePref(id, 'keys', keys);
}

export default { KEY, SPEEDS, prefs, setPref, gamePrefs, setGamePref, setSetting, setKey };
