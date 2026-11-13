/* ============================================================
   wakelock.js — keep the screen awake while something needs it
   (Cook mode, a running workout), where the browser has the Screen
   Wake Lock API. Where it doesn't, or refuses, this does nothing and
   says nothing: `held()` is simply false.

   The browser drops a lock whenever the tab is hidden, so it is asked
   for again when the tab comes back, as long as the caller still wants
   it. Every caller makes its own lock with hold() and must call
   release() (closing a window does).

     const lock = hold();   // starts asking
     lock.held()            // true while the browser has granted it
     lock.release()
   ============================================================ */
export function hold() {
  let want = true;
  let sentinel = null;
  let asking = false;

  async function ask() {
    if (!want || asking || sentinel) return;
    const wl = typeof navigator !== 'undefined' ? navigator.wakeLock : null;
    if (!wl || typeof wl.request !== 'function') return;
    if (document.visibilityState === 'hidden') return;
    asking = true;
    try {
      const s = await wl.request('screen');
      if (!want) { try { await s.release(); } catch (e) { /* already gone */ } return; }
      sentinel = s;
      s.addEventListener?.('release', () => { if (sentinel === s) sentinel = null; });
    } catch (e) { /* refused (low battery, no permission): carry on without */ }
    finally { asking = false; }
  }
  const visible = () => { if (document.visibilityState === 'visible') ask(); };
  document.addEventListener('visibilitychange', visible);
  ask();

  return {
    held: () => !!sentinel,
    release() {
      want = false;
      document.removeEventListener('visibilitychange', visible);
      const s = sentinel;
      sentinel = null;
      if (s) { try { const p = s.release(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
    },
  };
}

export default { hold };
