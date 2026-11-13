/* ============================================================
   db.js — a tiny IndexedDB key/value store.

   localStorage (store.js) holds preferences and small state; it is
   capped at ~5 MB and blocks the page on every write. Game projects,
   their version history, sprites and recorded clips are bigger than
   that, so they live here instead.

   kv(name) -> { get(key), set(key, value), del(key), keys(), all() }
   Every call is a Promise and never throws synchronously. If
   IndexedDB is unavailable (some private modes), it falls back to an
   in-memory map for the session and says so via `persistent`.
   ============================================================ */

import { idbName, stopped } from './profiles.js';

/* this person's database (core/profiles.js); null for a guest, whose
   projects and pictures stay in memory and go when the session does */
const DB_NAME = idbName();
const VERSION = 2;                 /* 2: + 'media' (core/media.js) */
const STORES = ['projects', 'assets', 'clips', 'misc', 'media'];

let dbP = null;
function open() {
  if (dbP) return dbP;
  dbP = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    if (!DB_NAME || stopped()) { reject(new Error('This session keeps its data in memory')); return; }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => {
      const db = req.result;
      /* a newer StaticOS in another tab needs to upgrade: let it */
      db.onversionchange = () => { db.close(); dbP = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
  });
  dbP.catch(() => {});
  return dbP;
}

const memory = new Map();          /* fallback when IndexedDB is not there */
export let persistent = true;

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  })).catch(err => {
    persistent = false;
    const m = memory.get(store) || memory.set(store, new Map()).get(store);
    return fn({
      get: k => ({ result: m.get(k) }), put: (v, k) => { m.set(k, v); return null; },
      delete: k => { m.delete(k); return null; },
      getAllKeys: () => ({ result: [...m.keys()] }), getAll: () => ({ result: [...m.values()] }),
    }, true)?.result;
  });
}

export function kv(name) {
  if (!STORES.includes(name)) throw new Error(`db: unknown store "${name}"`);
  return {
    get: key => tx(name, 'readonly', s => s.get(key)),
    set: (key, value) => tx(name, 'readwrite', s => s.put(value, key)).then(() => value),
    del: key => tx(name, 'readwrite', s => s.delete(key)),
    keys: () => tx(name, 'readonly', s => s.getAllKeys()).then(k => k || []),
    all: () => tx(name, 'readonly', s => s.getAll()).then(v => v || []),
  };
}

export default { kv };
