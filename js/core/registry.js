/* ============================================================
   registry.js — the app catalogue
   Apps self-register at import time:

     defineApp({
       id:'files', name:'Files', icon:'folder',
       g1:'#5ea0ff', g2:'#2b62d9',          // glyph gradient
       category:'System', keywords:['finder','browse'],
       pinned:true, dock:true, singleton:false,
       win:{ w:740, h:460, minW:420, minH:280 },
       shortcuts:[['Mod+S', 'Save'], ['Space', 'Play / pause']],
       mount(ctx){ ... return () => cleanup }
     })

   `mount(ctx)` receives { root, win, opts, api } and may return a
   teardown function. See ARCHITECTURE.md for the full contract.

   App modules load on demand. At boot js/core/apploader.js declares
   every app from js/apps/manifest.js — a copy of each defineApp()'s
   metadata — as a stand-in (`lazy: true`) whose mount() loads the
   module first. When the module runs its defineApp(), the stand-in
   BECOMES the real app (same object), so anything already holding it
   (an open window, the dock) sees the real mount from then on.
   ============================================================ */

const apps = new Map();
const order = [];

export function defineApp(def) {
  if (!def || !def.id) throw new Error('defineApp: id required');
  const app = normalise(def);
  const prior = apps.get(app.id);
  if (prior && prior.lazy) {
    Object.assign(prior, app, { lazy: false });
    return prior;
  }
  if (!apps.has(app.id)) order.push(app.id);
  apps.set(app.id, app);
  return app;
}

/** A stand-in for an app whose module has not loaded yet. `mount` is the
    loader's (it fetches the module, then hands over to the real mount).
    An app that already registered for real is left alone. */
export function declareApp(meta, mount) {
  if (!meta || !meta.id) throw new Error('declareApp: id required');
  if (apps.has(meta.id)) return apps.get(meta.id);
  const app = normalise({ ...meta, mount });
  app.lazy = true;
  order.push(app.id);
  apps.set(app.id, app);
  return app;
}

function normalise(def) {
  return {
    id: def.id,
    name: def.name || def.id,
    icon: def.icon || 'box',
    g1: def.g1 || '#4a4a55',
    g2: def.g2 || '#26262e',
    category: def.category || 'Other',
    keywords: def.keywords || [],
    desc: def.desc || '',
    pinned: !!def.pinned,
    dock: !!def.dock,
    singleton: !!def.singleton,
    hidden: !!def.hidden,
    win: { w: 720, h: 460, minW: 320, minH: 200, resizable: true, ...(def.win || {}) },
    mount: def.mount || (() => {}),
    onFile: def.onFile || null,      // called when a file is opened with this app
    handles: def.handles || [],      // vfs kinds this app can open
    exts: def.exts || [],            // file extensions it takes ahead of the kind rule (['json'])
    /* the app's own keys for the shortcut sheet (js/core/keymap.js):
       [['Mod+S', 'Save'], …]. Not copied into manifest.js — the sheet only
       lists the app in front, whose code has loaded by then. */
    shortcuts: Array.isArray(def.shortcuts) ? def.shortcuts : [],
  };
}

export const getApp = id => apps.get(id) || null;
export const hasApp = id => apps.has(id);

export function listApps({ category, includeHidden = false } = {}) {
  return order.map(id => apps.get(id))
    .filter(a => a && (includeHidden || !a.hidden))
    .filter(a => !category || a.category === category);
}

export function categories() {
  const seen = [];
  for (const a of listApps()) if (!seen.includes(a.category)) seen.push(a.category);
  return seen.sort((a, b) => (a === 'System' ? -1 : b === 'System' ? 1 : a.localeCompare(b)));
}

/** The app that has claimed this file's extension (defineApp `exts`), if any. */
export function appForExt(fileNode) {
  const dot = String(fileNode && fileNode.name || '').lastIndexOf('.');
  const ext = dot > 0 ? fileNode.name.slice(dot + 1).toLowerCase() : '';
  if (ext) for (const a of listApps()) if (a.exts.includes(ext)) return a;
  return null;
}

/** Best app for a vfs node, used by Files' double-click and Spotlight. */
export function appForFile(fileNode) {
  if (!fileNode) return null;
  /* an app that names an extension wins over the broader kind rule: .json is
     a 'config' file like .toml, but it has a viewer of its own */
  const byExt = appForExt(fileNode);
  if (byExt) return byExt;
  for (const a of listApps()) if (a.handles.includes(fileNode.kind)) return a;
  return apps.get('notes') || null;
}

/** The plain-data part of an app — what js/apps/manifest.js keeps for
    it — with every value that is just the default left out. */
const DATA_KEYS = ['name', 'icon', 'g1', 'g2', 'category', 'keywords', 'desc', 'pinned', 'dock', 'singleton', 'hidden', 'handles', 'exts'];
export function describeApp(app) {
  const base = normalise({ id: app.id });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const out = { id: app.id };
  for (const k of DATA_KEYS) if (!same(app[k], base[k])) out[k] = app[k];
  const win = {};
  for (const [k, v] of Object.entries(app.win || {})) if (!same(v, base.win[k])) win[k] = v;
  if (Object.keys(win).length) out.win = win;
  return out;
}

export const registry = { defineApp, declareApp, describeApp, getApp, hasApp, listApps, categories, appForFile, appForExt };
export default registry;
