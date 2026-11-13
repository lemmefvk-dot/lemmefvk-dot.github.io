/* ============================================================
   store.js — global OS state, path-addressed + persisted.
     store.get('prefs.accent')
     store.set('prefs.accent', 'aether')      → notifies subs
     store.sub('prefs.accent', fn)            → unsubscribe fn
     store.update('prefs', p => ({...p, x:1}))
   Only keys listed in PERSIST survive a reload.
   ============================================================ */
import { bus } from './bus.js';
/* each person on this computer has their own copy (core/profiles.js) */
import { key, local } from './profiles.js';

const KEY = key('staticos.state.v3');
const PERSIST = ['prefs', 'dock', 'notes', 'noteFolders', 'wallpaper', 'session', 'portal', 'desktops', 'lens', 'markets', 'ai', 'manga'];

const defaults = {
  user: { name: 'Static', handle: 'aether', initials: 'A', role: 'Administrator' },
  prefs: {
    accent: 'aether',
    theme: 'dark',
    density: 'normal',
    h24: false,
    reduceMotion: false,
    wallpaperGrid: true,
    wallpaperGrain: true,
    dockMagnify: true,
    widgetsVisible: true,
    desktopIcons: true,
    gameMode: false,
    volume: 62,
    brightness: 100,
    wifi: true,
    bluetooth: true,
    dnd: false,
    nightShift: false,
    airdrop: false,
    autoUpdate: 'notify',   /* 'notify' | 'reload' | 'off' — see js/core/updater.js */
  },
  dock: ['launcher', 'files', 'play', 'store', 'browser', 'chat', 'aetherium', 'lens', 'code', 'settings', 'music', 'monitor'],
  system: {
    hostname: 'staticos',
    os: 'StaticOS 4.0',
    kernel: 'Linux 4.0.0-static',
    shell: 'staticsh 3.0.1',
    wm: 'Static Compositor (Wayland)',
    de: 'Static Shell 3.0',
    theme: 'static-dark [GTK4]',
    icons: 'Static Icons',
    term: 'static-term',
    cpu: 'AMD Ryzen 7 7840HS',
    gpu: 'AMD Radeon 780M',
    ramTotal: 16,
    resolution: '2560x1440',
    packages: '1412 (rpm), 31 (flatpak)',
    uptimeBase: 2 * 3600 + 36 * 60,
    diskTotal: 512,
    diskUsed: 282,
    battery: 100,
    charging: false,
  },
  live: { cpu: 23, gpu: 45, ram: 38, net: 12, temp: 54 },
  session: { bootedOnce: false },
  notes: null,
  wallpaper: 'canopy',
  /* the portal's own saved state (watchlist, …) — persisted */
  portal: { watchlist: [] },
};

function clone(v) { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }

let state = clone(defaults);
try {
  const raw = local.getItem(KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    for (const k of PERSIST) {
      if (saved[k] === undefined) continue;
      state[k] = (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k]))
        ? { ...state[k], ...saved[k] } : saved[k];
    }
  }
} catch (e) { console.warn('[store] could not restore state', e); }

/* What used to live under top-level keys PERSIST never saved (so it vanished
   on reload) now lives under portal.<the same name>; if an old copy exists
   anywhere (saved JSON or memory) it is moved over once. What is already at
   the new name wins, and a value of the wrong kind is left behind. */
const LEGACY = {
  'roblox.favs': Array, 'roblox.recent': Array, 'browser.marks': Array, 'monitor.tab': 'string',
  'cloud.favs': Array, 'cloud.played': Array, 'cloud.collection': 'string', 'cloud.noLogin': 'boolean',
};
(function migrateLegacy() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
  for (const [from, kind] of Object.entries(LEGACY)) {
    const [a, b] = from.split('.');
    const old = state[a]?.[b] ?? saved?.[a]?.[b];
    if (kind === Array ? !Array.isArray(old) : typeof old !== kind) continue;
    state.portal = state.portal || {};
    state.portal[a] = state.portal[a] || {};
    if (state.portal[a][b] === undefined) state.portal[a][b] = old;
    if (state[a]) { delete state[a][b]; if (!Object.keys(state[a]).length) delete state[a]; }
  }
})();

const subs = new Map();

function dig(path) {
  const parts = path.split('.');
  let o = state;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] === null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  return [o, parts[parts.length - 1]];
}

/* held: a data restore (core/backup.js) has just written another state into
   localStorage and the page is about to reload — this page's own copy must
   not be written over it in the meantime */
let held = false;
const save = (() => {
  let t = 0;
  const flush = () => {
    clearTimeout(t); t = 0;
    if (held) return;
    try {
      const out = {};
      for (const k of PERSIST) out[k] = state[k];
      local.setItem(KEY, JSON.stringify(out));
    } catch (e) { /* private mode / quota — the OS still runs */ }
  };
  /* a change made in the last 220 ms before a reload or a closed tab used
     to be lost; write it out as the page goes away */
  if (typeof window !== 'undefined') {
    const now = () => { if (t) flush(); };
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') now(); });
  }
  return () => {
    clearTimeout(t);
    t = setTimeout(flush, 220);
  };
})();

function notify(path, value) {
  const parts = path.split('.');
  for (let i = parts.length; i > 0; i--) {
    const p = parts.slice(0, i).join('.');
    subs.get(p)?.forEach(fn => { try { fn(store.get(p), path); } catch (e) { console.error(e); } });
  }
  subs.get('*')?.forEach(fn => { try { fn(value, path); } catch (e) { console.error(e); } });
  bus.emit('state:change', path, value);
}

export const store = {
  get raw() { return state; },
  get(path, fallback) {
    if (!path) return state;
    let o = state;
    for (const p of path.split('.')) {
      if (o === null || o === undefined) return fallback;
      o = o[p];
    }
    return o === undefined ? fallback : o;
  },
  set(path, value) {
    const [obj, key] = dig(path);
    if (obj[key] === value) return value;
    obj[key] = value;
    save(); notify(path, value);
    return value;
  },
  update(path, fn) { return store.set(path, fn(store.get(path))); },
  /** Patch an object-valued path without clobbering siblings. */
  patch(path, partial) {
    const cur = store.get(path) || {};
    return store.set(path, { ...cur, ...partial });
  },
  sub(path, fn) {
    (subs.get(path) || subs.set(path, new Set()).get(path)).add(fn);
    return () => subs.get(path)?.delete(fn);
  },
  /** Stop (or, with false, resume) writing this page's state to localStorage. */
  hold(on = true) { held = !!on; },
  reset() {
    try { local.removeItem(KEY); } catch (e) {}
    state = clone(defaults);
    notify('*', state);
  },
  defaults,
};
