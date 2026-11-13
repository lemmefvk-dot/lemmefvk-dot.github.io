/* ============================================================
   api.js — the surface every app receives as ctx.api
   Apps never import shell modules; they go through this.
   Also published as window.StaticAPI for console poking.
   ============================================================ */
import { h, q, qa, on, render, clear, toggle, placeInView, raf } from './dom.js';
import { icon, iconSvg, hasIcon } from './icons.js';   /* one instance: every other module imports it by this URL */
import { bus } from './bus.js';
import { store } from './store.js';
import * as wmMod from './wm.js';
import vfs from './vfs.js';
import { getApp, listApps, categories, appForFile, appForExt, defineApp } from './registry.js';
import * as fmt from './util.js';
import { launchItem } from './launch.js';

export const api = {
  /* building blocks */
  h, q, qa, on, render, clear, toggle, placeInView, raf,
  icon, iconSvg, hasIcon, fmt,

  /* services */
  bus, store, vfs, wm: wmMod.wm,
  getApp, listApps, categories, appForFile, defineApp,

  /* ---- actions -------------------------------------------- */
  openApp(id, opts) { return wmMod.open(id, opts || {}); },

  /** Open a vfs path with the app that handles its kind. */
  openFile(path, appId) {
    const n = vfs.node(path);
    if (!n) return null;
    if (n.type === 'dir') return wmMod.open('files', { path });
    /* a game shortcut (.aethergame) launches the game itself */
    if (!appId && n.kind === 'game') {
      try {
        const g = JSON.parse(n.content || '{}');
        if (g && g.id) return launchItem(g);
      } catch (err) { /* not a shortcut after all — fall through */ }
    }
    if (!appId && n.kind === 'clip') return wmMod.open('aether-library', {});
    /* a file kept as bytes in IndexedDB that no media app plays (a PDF, an
       archive, big read-only text…) would show up in Notes as its storage
       reference — Files' viewer shows it, or offers the download */
    if (!appId && String(n.content || '').startsWith('staticos-media:') && !['image', 'video', 'audio'].includes(n.kind) && !appForExt(n)) {
      return wmMod.open('files', { path, preview: true });
    }
    const app = appId ? getApp(appId) : appForFile(n);
    if (!app) return null;
    return wmMod.open(app.id, { path, file: n });
  },

  /** notify({app,title,message,icon,actions:[{label,onClick}],timeout}) */
  notify(n) { bus.emit('noti:push', { app: 'StaticOS', icon: 'bell', timeout: 6000, ...n }); },

  /** Context menu: items = [{label,icon,hint,onClick,danger,disabled} | '-'].
      opts (optional): { label } names the menu for screen readers;
      { onEdge(dir) } is called when ←/→ is pressed on the top level, so a
      menu bar can move to its neighbouring menu. */
  menu(items, x, y, opts) { bus.emit('menu:open', { ...(opts || {}), items, x, y }); },

  /** Small yes/no sheet rendered by the shell. */
  confirm(opts) { return new Promise(res => bus.emit('dialog:confirm', { ...opts, resolve: res })); },

  spotlight(query) { bus.emit('spotlight:open', query || ''); },
  lock()   { bus.emit('power:lock'); },
  sleep()  { bus.emit('power:sleep'); },
  restart(){ bus.emit('power:restart'); },
  overview(){ bus.emit('overview:toggle'); },

  /* live telemetry — widgets and Monitor both read this */
  get live() { return store.get('live'); },
  get system() { return store.get('system'); },
  get prefs() { return store.get('prefs'); },
};

if (typeof window !== 'undefined') window.StaticAPI = api;
export default api;
