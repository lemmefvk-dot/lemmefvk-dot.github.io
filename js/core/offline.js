/* ============================================================
   offline.js — the page's side of StaticOS's offline copy.

   sw.js (the site's one service worker, which also runs the
   proxy) keeps a copy of the app shell — index.html, js/, css/ —
   for each build, so a return visit starts without waiting on the
   network and the desktop, Files, Notes and the Arcade work with no
   connection at all. See the second half of sw.js for how.

   main.js calls start() once the desktop is up. It registers the
   worker (the proxy registers the very same /sw.js, so there is
   only ever one) and asks it to fill in this build's copy in the
   background — after start-up, never during it.

     start()            → Promise<registration | null>
     status()           → Promise<{ supported, active, complete,
                                     running, builds[] } | null>
     adopt(stamp)       tell the worker a newer build is the one to
                        serve, right before a restart (updater.js)
   ============================================================ */

const SW_URL = '/sw.js';

export const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  && typeof window !== 'undefined' && window.isSecureContext;

let starting = null;

export function start() {
  if (!supported()) return Promise.resolve(null);
  if (starting) return starting;
  starting = (async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
      await navigator.serviceWorker.ready;
      const sw = reg.active || navigator.serviceWorker.controller;
      if (sw) sw.postMessage({ type: 'staticos:warm' });
      return reg;
    } catch (err) {
      console.warn('[StaticOS] offline copy unavailable:', err && err.message);
      return null;
    }
  })();
  return starting;
}

/* ask the worker something and wait (briefly) for its answer */
async function ask(msg, ms = 3000) {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/').catch(() => null);
  const sw = navigator.serviceWorker.controller || (reg && reg.active);
  if (!sw) return null;
  return new Promise(resolve => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = e => { clearTimeout(t); resolve(e.data); };
    sw.postMessage(msg, [ch.port2]);
  });
}

export async function status() {
  if (!supported()) return { supported: false };
  const s = await ask({ type: 'staticos:status' });
  return s ? { supported: true, ...s } : { supported: true, active: null, complete: false, running: null, builds: [] };
}

/** Before a restart into a new build: have the worker serve that build to
    the reload, even if the reload's own check of build.json is slow. */
export function adopt(stamp) {
  if (!stamp || !stamp.build) return Promise.resolve(null);
  return ask({ type: 'staticos:adopt', stamp }, 1500);
}

/* for the console, the Developer Room and the test suites */
if (typeof window !== 'undefined' && window.Static) window.Static.offline = { start, status, adopt, supported };

export default { start, status, adopt, supported };
