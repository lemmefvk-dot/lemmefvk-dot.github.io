/* ============================================================
   life/data.js — where Static Life keeps what you type.

   Everything is under store('portal.life') (the store writes it to this
   browser's saved state, like Tasks and QR do), as
     { tab, habits:[…], money:{ entries, budgets, symbol },
       recipes:[…], workout:{ routines, sound, voice } }
   Nothing here talks to a network; the page makes no request for it.
   Each part is written whole with a fresh object, because store.set()
   ignores a write of the same reference.
   ============================================================ */
import { store } from '../core/store.js';

export const KEY = 'portal.life';

export const read = () => {
  const v = store.get(KEY);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};

export function write(part, value) {
  store.set(KEY, { ...read(), [part]: value });
}

export const uid = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Text that sits in the page: never HTML. */
export const clone = v => JSON.parse(JSON.stringify(v));
