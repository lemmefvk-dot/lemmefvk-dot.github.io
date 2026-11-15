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
     keepPrevious(on)   ask the worker to keep the build before the
                        current one (off unless the person turns it on)
     usePrevious()      start that older build for one load, then go
                        back to the newest (Settings › About)
     appsSaved()        which apps' code is in this build's saved copy,
                        read from the copy itself
   ============================================================ */
import { APP_MODULES } from '../apps/manifest.js';
import { store } from './store.js';
import * as SAVER from './datasaver.js';
import * as PICS from './piccache.js';


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
      if (sw) {
        /* Data saver: the copy is not downloaded all at once; it fills in as things are used */
        if (!SAVER.on()) sw.postMessage({ type: 'staticos:warm' });
        sw.postMessage({ type: 'staticos:keep', on: store.get('prefs.keepPrevious', false) === true });
        /* game and anime pictures this person has seen, kept in their own cache (js/core/piccache.js) */
        PICS.register(sw);
      }
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

const SHELL = 'staticos-shell-';

/** Keep (or stop keeping) the build before the current one. It takes a second copy of the shell on this device. */
export const keepPrevious = on => ask({ type: 'staticos:keep', on: !!on }, 1500);

/** Start the build that was current before this one, for one load: the load after it goes
    to the newest again. false when there is no kept copy to start. */
export async function usePrevious() {
  const st = await status();
  if (!st || !st.previous || typeof caches === 'undefined') return false;
  let stamp = null;
  try {
    const hit = await (await caches.open(SHELL + st.previous)).match('/build.json');
    stamp = hit ? await hit.json() : null;
  } catch (err) { /* no stamp kept */ }
  if (!stamp || !stamp.build) return false;
  const done = await ask({ type: 'staticos:adopt', stamp, once: true }, 2000);
  if (!done) return false;
  try { sessionStorage.setItem('aether.restarting', '1'); } catch (err) { /* the full splash, then */ }
  location.reload();
  return true;
}

/** Which apps have their code in this build's saved copy. `online` are the Internet apps:
    their code is saved, but what they show comes from the network. Read from the cache, not guessed. */
export async function appsSaved() {
  const st = await status();
  if (!st || !st.supported || !st.active || typeof caches === 'undefined') return null;
  let cache;
  try { cache = await caches.open(SHELL + st.active); } catch (err) { return null; }
  const works = [];
  const online = [];
  const missing = [];
  for (const [mod, metas] of APP_MODULES) {
    const have = !!(await cache.match(`/js/apps/${mod}.js`).catch(() => null));
    for (const m of metas) {
      if (m.hidden) continue;
      const row = { id: m.id, name: m.name, category: m.category };
      if (!have) missing.push(row);
      else if (m.category === 'Internet') online.push(row);
      else works.push(row);
    }
  }
  return { complete: !!st.complete, build: st.active, works, online, missing };
}

/* for the console, the Developer Room and the test suites */
if (typeof window !== 'undefined' && window.Static) { window.Static.offline = { start, status, adopt, supported, keepPrevious, usePrevious, appsSaved }; window.Static.pics = PICS; }

export default { start, status, adopt, supported, keepPrevious, usePrevious, appsSaved };
