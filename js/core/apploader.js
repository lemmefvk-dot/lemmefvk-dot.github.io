/* ============================================================
   apploader.js — apps load when they are opened, not at boot.

   StaticOS ships ~60 apps and almost nobody opens more than a few
   in a session, yet every one of them (and everything they import:
   the games portal, the Studio, Settings' proxy tools …) used to be
   downloaded and run before the desktop appeared — about 3 MB of
   script on every visit.

   Now boot declares each app from js/apps/manifest.js (a generated
   copy of its defineApp() metadata), so the dock, launcher, Spotlight
   and desktop know every app by name and icon, and the app's own
   module is imported the first time something mounts it. The window
   opens at once and shows a small "Opening …" state until the code
   arrives; with the offline cache (sw.js) that is a few milliseconds.

     declareApps()      register every app as a stand-in (main.js, once)
     loadApp(id)        → Promise<app>, the real app, loading it if needed
     preloadApp(id)     start loading in the background, never throws
     isLoaded(id)

   Some apps own behaviour that outlives their window. Music is the
   OS-wide player: a play/next/prev sent from the desktop widget,
   Staticum or an automation before Music ever loaded loads it and is
   handed to its exported wake(). See WAKE below.
   ============================================================ */
import { declareApp, getApp } from './registry.js';
import { bus } from './bus.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { APP_MODULES } from '../apps/manifest.js';

const moduleOf = new Map();      /* app id -> module name */
const pending = new Map();       /* module name -> Promise<namespace> */
const loaded = new Set();        /* module names that finished loading */
const retries = new Map();       /* module name -> how many times "Try again" was pressed */

/* events that must reach an app's module even before it has loaded */
const WAKE = {
  music: ['media:play', 'media:next', 'media:prev'],
};

const failures = () => (typeof window !== 'undefined' && window.__staticBoot && window.__staticBoot.failures) || null;

/* Wait for stylesheets an app module added while it ran (most inject a
   <link> for their own CSS), so a window never mounts unstyled. Capped:
   a sheet that never answers must not hold the app hostage. */
function settleStyles(before, ms = 2500) {
  const fresh = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(l => !before.has(l) && !l.sheet);
  if (!fresh.length) return Promise.resolve();
  const done = fresh.map(l => new Promise(r => {
    l.addEventListener('load', r, { once: true });
    l.addEventListener('error', r, { once: true });
  }));
  return Promise.race([Promise.all(done), new Promise(r => setTimeout(r, ms))]);
}

function loadModule(mod) {
  if (pending.has(mod)) return pending.get(mod);
  const before = typeof document !== 'undefined' ? new Set(document.querySelectorAll('link[rel="stylesheet"]')) : new Set();
  /* A module that failed to fetch stays failed under its URL for the rest
     of the page's life, so a retry has to ask under a new one. */
  const n = retries.get(mod) || 0;
  const url = n ? `../apps/${mod}.js?retry=${n}` : `../apps/${mod}.js`;
  const p = import(url)
    .then(async ns => { await settleStyles(before); loaded.add(mod); return ns; })
    .catch(err => {
      pending.delete(mod);
      const list = failures();
      if (list) list.push(`apps/${mod}.js → ${err && err.message}`);
      throw err;
    });
  pending.set(mod, p);
  return p;
}

export function loadApp(id) {
  const mod = moduleOf.get(id);
  if (!mod) return Promise.resolve(getApp(id));
  return loadModule(mod).then(() => {
    const app = getApp(id);
    if (!app || app.lazy) throw new Error(`apps/${mod}.js loaded but did not register "${id}"`);
    return app;
  });
}

export function preloadApp(id) {
  return loadApp(id).catch(err => { console.warn(`[StaticOS] could not preload ${id}:`, err); return null; });
}

export const isLoaded = id => !moduleOf.has(id) || loaded.has(moduleOf.get(id));

/* What a window shows while its app's code loads, or when it can't.
   (.empty centres itself; FILL makes it take the whole window body,
   which lays its child out in a row.) */
const FILL = { flex: '1 1 auto', width: '100%', minWidth: '0' };
function lazyMount(id) {
  const mount = ctx => {
    const { root } = ctx;
    let dead = false;
    let teardown = null;
    const name = (getApp(id) || {}).name || id;
    /* fade in only if it is slow enough to notice */
    const wait = h('div.empty', { style: { ...FILL, opacity: '0', transition: 'opacity .25s' }, 'aria-busy': 'true' },
      h('span.spinner'), h('small', { text: `Opening ${name}…` }));
    root.appendChild(wait);
    const shown = setTimeout(() => { wait.style.opacity = '1'; }, 180);

    const fail = (err, crashed) => {
      clearTimeout(shown);
      wait.remove();
      console.error(`[StaticOS] ${id} ${crashed ? 'crashed on launch' : 'could not load'}`, err);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const box = h('div.empty', { style: FILL }, icon('alert'),
        h('b', { text: crashed ? 'This app crashed on launch' : `${name} couldn’t load` }),
        h('small', { text: crashed ? String((err && err.message) || err)
          : offline ? 'You’re offline, and this app hasn’t been saved for offline use yet. It will be once you’ve been online for a moment.'
            : String((err && err.message) || err) }),
        crashed ? null : h('button.btn', { type: 'button', onclick: () => { box.remove(); const m = moduleOf.get(id); retries.set(m, (retries.get(m) || 0) + 1); start(); } }, 'Try again'));
      root.appendChild(box);
    };

    const start = () => {
      if (!wait.isConnected) root.appendChild(wait);
      loadApp(id).then(app => {
        if (dead) return;
        clearTimeout(shown);
        wait.remove();
        let out;
        try { out = app.mount(ctx); } catch (err) { fail(err, true); return; }
        if (typeof out === 'function') teardown = out;
      }, err => { if (!dead) fail(err, false); });
    };
    start();

    return () => {
      dead = true;
      clearTimeout(shown);
      const t = teardown;
      teardown = null;
      if (t) t();
    };
  };
  return mount;
}

let declared = false;
export function declareApps() {
  if (declared) return;
  declared = true;
  for (const [mod, metas] of APP_MODULES) {
    for (const meta of metas) {
      moduleOf.set(meta.id, mod);
      declareApp(meta, lazyMount(meta.id));
    }
  }
  for (const [mod, events] of Object.entries(WAKE)) {
    for (const evt of events) {
      bus.on(evt, (...args) => {
        if (loaded.has(mod)) return;           /* its own listeners have it now */
        loadModule(mod).then(ns => { if (typeof ns.wake === 'function') ns.wake(evt, ...args); })
          .catch(err => console.warn(`[StaticOS] ${mod} did not wake for ${evt}`, err));
      });
    }
  }
}

/** Every module the manifest lists — for the suite that checks it. */
export const manifestModules = () => APP_MODULES.map(([m]) => m);

export default { declareApps, loadApp, preloadApp, isLoaded, manifestModules };
