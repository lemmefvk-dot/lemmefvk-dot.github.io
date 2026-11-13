/* ============================================================
   bus.js — the OS event bus. Shell and apps talk through this
   instead of importing each other.
   Conventions: 'app:open', 'app:close', 'win:focus', 'win:list',
   'file:open', 'noti:push', 'theme:change', 'power:lock', ...
   ============================================================ */
const map = new Map();

export const bus = {
  on(evt, fn) {
    (map.get(evt) || map.set(evt, new Set()).get(evt)).add(fn);
    return () => bus.off(evt, fn);
  },
  once(evt, fn) {
    const off = bus.on(evt, (...a) => { off(); fn(...a); });
    return off;
  },
  off(evt, fn) { map.get(evt)?.delete(fn); },
  emit(evt, ...args) {
    map.get(evt)?.forEach(fn => {
      try { fn(...args); } catch (e) { console.error(`[bus:${evt}]`, e); }
    });
    map.get('*')?.forEach(fn => { try { fn(evt, ...args); } catch (e) { console.error(e); } });
  },
  clear(evt) { evt ? map.delete(evt) : map.clear(); },
};
