/* ============================================================
   updater.js — the site notices when it has been rebuilt.

   `build.json` is stamped by tools/bump.mjs (and re-stamped by
   ./watch.sh on every save, or by your deploy). This module
   remembers the build id it started with, polls for a new one,
   and surfaces it as a real StaticOS notification instead of a
   silently stale tab.

   prefs.autoUpdate:
    'notify'  show "Update available", restart on click  (default)
    'reload'  restart the moment a new build appears     (dev)
     'off'     never check

   It falls back to a HEAD on index.html (ETag / Last-Modified)
   when build.json is missing, so it still works on a plain
   static host with no build step.

   With the offline copy (sw.js) a page can start from a build
   that is older than what the server has now — offline, or when
   the network was too slow to ask. So the baseline is asked as
   build.json?running, which the worker answers with the stamp of
   the copy this tab is actually running (and the network answers
   like any other build.json when there is no worker). A restart
   tells the worker which build to serve before it reloads.
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';

const STAMP_URL = 'build.json';
const INDEX_URL = 'index.html';
const POLL_MS = 20000;
const FOCUS_THROTTLE_MS = 5000;

let current = null;      // {build, version} we are running
let fallback = null;     // {etag, modified} when build.json is absent
let timer = null;
let lastCheck = 0;
let announced = null;    // build id we have already told the user about
let pending = null;      // a newer build we know about but have not loaded
let stopped = false;

async function readStamp(running = false) {
  try {
    const res = await fetch(`${STAMP_URL}?${running ? 'running&' : ''}t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.build ? json : null;
  } catch (err) {
    return null;
  }
}

async function readIndexSignature() {
  try {
    const res = await fetch(`${INDEX_URL}?t=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return null;
    return {
      etag: res.headers.get('etag') || '',
      modified: res.headers.get('last-modified') || '',
    };
  } catch (err) {
    return null;
  }
}

async function restart() {
  /* keep the session flag so the boot splash stays short on the way back */
  try {
    sessionStorage.setItem('aether.restarting', '1');
    if (pending && pending.version) sessionStorage.setItem('aether.updateTo', String(pending.version));
  } catch (err) {}
  /* the offline copy serves the reload; make sure it serves the new build */
  if (pending && pending.build && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    try { await (await import('./offline.js')).adopt(pending); } catch (err) { /* reload anyway */ }
  }
  location.reload();
}

/* `force` is set by an explicit "Check for Updates": once a toast has been
   dismissed, `announced` would otherwise silence that build forever and the
   button would do nothing visible. */
function announce(next, force = false) {
  const mode = store.get('prefs.autoUpdate', 'notify');
  if (mode === 'reload') {
    bus.emit('noti:push', {
      app: 'StaticOS', icon: 'download', timeout: 1600,
      title: 'New build — restarting', message: `build ${next.build || 'updated'}`,
    });
    setTimeout(restart, 700);
    return;
  }
  if (!force && announced === (next.build || 'index')) return;
  announced = next.build || 'index';
  pending = next;
  bus.emit('noti:push', {
    app: 'StaticOS', icon: 'download', timeout: 0,
    title: 'Update available',
    message: next.version && current && next.version !== current.version
      ? `Version ${next.version} is ready. Restart to load it.`
      : 'A newer build of StaticOS is ready. Restart to load it.',
    actions: [
      { label: 'Restart now', onClick: restart },
      { label: 'Later', onClick: () => {} },
    ],
  });
  bus.emit('update:available', next);
}

async function check(reason = 'poll') {
  const force = reason === 'manual';
  if (stopped) return null;
  /* When checking is off we still take a baseline on boot, otherwise switching
     it back on later would silently adopt whatever build is being served and
     never report the update the user turned it on to find. */
  const off = store.get('prefs.autoUpdate', 'notify') === 'off';
  if (off && reason !== 'boot' && !force) return null;
  lastCheck = Date.now();

  const stamp = await readStamp(!current);
  if (stamp) {
    if (!current) { current = stamp; return null; }
    if (off) return null;
    if (stamp.build !== current.build) { announce(stamp, force); return stamp; }
    pending = null;
    return null;
  }

  /* no build.json — compare what the server says about index.html */
  const sig = await readIndexSignature();
  if (!sig) return null;
  if (!fallback) { fallback = sig; return null; }
  if (off) return null;
  if ((sig.etag && sig.etag !== fallback.etag)
      || (sig.modified && sig.modified !== fallback.modified)) {
    fallback = sig;
    announce({ build: sig.etag || sig.modified }, force);
    return sig;
  }
  if (force && pending) { announce(pending, true); return pending; }
  return null;
}

export function mountUpdater() {
  /* record the build we booted with before anything can change it */
  check('boot');

  clearInterval(timer);
  timer = setInterval(() => check('poll'), POLL_MS);

  /* coming back to the tab is the moment a stale build is most obvious */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastCheck > FOCUS_THROTTLE_MS) check('focus');
  });
  window.addEventListener('online', () => check('online'));

  /* Settings can ask for an immediate check */
  bus.on('update:check', () => check('manual').then(found => {
    if (found) return;                      // announce() already spoke
    /* Distinguish "checked, nothing new" from "could not check": a null return
       also happens when the updater is stopped or build.json is unreachable,
       and claiming "up to date" in those cases would be a lie. */
    if (stopped) return;
    if (!current && !fallback) {
      bus.emit('noti:push', {
        app: 'StaticOS', icon: 'alert', timeout: 5000,
        title: 'Could not check for updates',
        message: 'build.json is not reachable from here.',
      });
      return;
    }
    bus.emit('noti:push', {
      app: 'StaticOS', icon: 'check-circle', timeout: 4000,
      title: 'StaticOS is up to date',
      message: current ? `build ${current.build} \u00b7 ${current.version}` : 'No newer build found.',
    });
  }));

  return {
    check,
    get current() { return current; },
    get pending() { return pending; },
    stop() { stopped = true; clearInterval(timer); },
  };
}

export const updater = {
  mountUpdater, check,
  get current() { return current; },
  get pending() { return pending; },
};
export default updater;
