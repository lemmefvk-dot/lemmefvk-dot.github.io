/* ============================================================
   dockfolders.js — folders in the dock.

   Drag a dock icon onto the middle of another one and hold it there
   a moment (the one underneath swells and rings): letting go makes a
   folder of the two, named after their category. Drop more apps onto
   a folder the same way to add them. Click a folder for a grid of its
   apps: click one to open it, or drag one off the grid to take it out
   (onto the dock it lands where you let go; anywhere else, right after
   the folder). A folder left with one app goes away and leaves that
   app in its place. The name at the top of the grid is the folder's:
   type to rename it.

   Keyboard: a folder is a dock item like the rest (the arrows reach
   it, Enter opens it, Shift+arrow moves it); in the grid the arrows
   move, Enter opens, Shift+F10 on an app has "Take Out of Folder",
   and Escape closes it. A dock app's own menu has "Put in a Folder
   With" — the keyboard's way in.

   Saved: the dock's order (store 'dock') still lists every app, the
   ones in folders too, so whatever asks "is this app in the dock?"
   still gets the right answer. store 'session.dockFolders' says which
   of them share a folder: [{ id, name, apps }]. A folder sits where
   its first app is in the dock's order.
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as wm from '../core/wm.js';
import * as L from '../core/layers.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { getApp, listApps } from '../core/registry.js';
import { roving } from '../core/roving.js';
import { appTile } from '../core/appart.js';

const { h, icon } = api;

const KEY = 'session.dockFolders';
const NAME_MAX = 32;
/** dock items a drag moves among: apps and folders (the launcher and Trash stay put) */
export const UNIT = '.dock__item[data-app]:not([data-app="launcher"]):not([data-app="trash"]), .dock__item[data-folder]';
const DWELL = 320;        /* ms held over an icon before it takes the dragged one in */
const MID = 0.22;         /* how near the middle of an icon (share of its width) */
const SLOP = 6;

const say = t => bus.emit('a11y:say', t);
const visible = id => { const a = getApp(id); return !!a && !a.hidden; };
const dockIds = () => {
  const s = store.get('dock');
  return Array.isArray(s) ? s.slice() : listApps().filter(a => a.dock).map(a => a.id);
};
let seq = 0;
const newId = () => `f${Date.now().toString(36)}${(++seq).toString(36)}`;

/* ---------- the model ------------------------------------------------- */
/** Folders as the dock shows them: apps that are in the dock now, each in
    one folder only; a folder with fewer than two of those is not one. */
export function folders(ids = dockIds()) {
  const inDock = new Set(ids.filter(visible));
  const seen = new Set();
  const raw = store.get(KEY);
  return (Array.isArray(raw) ? raw : [])
    .filter(f => f && typeof f.id === 'string' && Array.isArray(f.apps))
    .map(f => ({
      id: f.id,
      name: typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, NAME_MAX) : null,
      apps: f.apps.filter(id => typeof id === 'string' && inDock.has(id) && !seen.has(id) && seen.add(id)),
    }))
    .filter(f => f.apps.length >= 2);
}

/** The category most of its apps share (the first app's when they differ). */
function category(ids) {
  const n = new Map();
  for (const id of ids) { const c = getApp(id)?.category; if (c) n.set(c, (n.get(c) || 0) + 1); }
  let best = getApp(ids[0])?.category || 'Apps';
  for (const [c, k] of n) if (k > (n.get(best) || 0)) best = c;
  return best;
}
export const labelOf = f => (f && (f.name || category(f.apps))) || 'Folder';

/** The dock, left to right, as units: app ids, and 'f:<id>' for a folder. */
export function unitKeys(ids = dockIds()) {
  const vis = ids.filter(visible);
  const of = new Map();
  folders(ids).forEach(f => f.apps.forEach(id => of.set(id, f)));
  const out = [];
  for (const id of vis) {
    const f = of.get(id);
    const k = f ? 'f:' + f.id : id;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** What the dock paints: [{ app } | { folder }], from its apps in order. */
export function units(apps) {
  const of = new Map();
  folders(apps.map(a => a.id)).forEach(f => f.apps.forEach(id => of.set(id, f)));
  const out = [];
  const done = new Set();
  for (const a of apps) {
    const f = of.get(a.id);
    if (!f) out.push({ app: a });
    else if (!done.has(f.id)) { done.add(f.id); out.push({ folder: f }); }
  }
  return out;
}

/** Dock items in the order they stand → the dock's app order (a folder opens into its apps). */
export function expand(nodes) {
  const fs = new Map(folders().map(f => [f.id, f.apps]));
  return nodes.flatMap(n => (n.dataset.folder ? fs.get(n.dataset.folder) || [] : [n.dataset.app]));
}

/* Save a new set of folders and the dock order the units make. An app
   named as a unit of its own wins over the folder it used to be in; apps
   the dock does not show right now keep their place at the end. */
function commit(fs, keys) {
  const now = new Map(fs.map(f => [f.id, f.apps]));
  const was = new Map(folders().map(f => [f.id, f.apps]));
  const solo = new Set(keys.filter(k => !k.startsWith('f:')));
  const out = [];
  const put = id => { if (!out.includes(id)) out.push(id); };
  for (const k of keys) {
    if (!k.startsWith('f:')) { put(k); continue; }
    const id = k.slice(2);
    (now.get(id) || was.get(id) || []).filter(a => !solo.has(a)).forEach(put);
  }
  dockIds().forEach(put);
  store.set(KEY, fs.map(f => ({ id: f.id, name: f.name, apps: [...f.apps] })));
  store.set('dock', out);
}

/** A folder of `targetId` and `appId`, where `targetId` stands. */
export function make(targetId, appId) {
  if (!targetId || !appId || targetId === appId || !visible(targetId) || !visible(appId)) return null;
  const cur = folders().map(f => ({ ...f, apps: f.apps.filter(id => id !== appId && id !== targetId) })).filter(f => f.apps.length >= 2);
  const f = { id: newId(), name: category([targetId, appId]), apps: [targetId, appId] };
  const keys = unitKeys().filter(k => k !== appId).map(k => (k === targetId ? 'f:' + f.id : k));
  commit([...cur, f], keys);
  return f;
}

/** Add an app to a folder. */
export function add(folderId, appId) {
  const cur = folders();
  const f = cur.find(x => x.id === folderId);
  if (!f || !visible(appId) || f.apps.includes(appId)) return false;
  const fs = cur.map(x => (x.id === folderId ? { ...x, apps: [...x.apps, appId] } : { ...x, apps: x.apps.filter(id => id !== appId) }))
    .filter(x => x.apps.length >= 2);
  commit(fs, unitKeys().filter(k => k !== appId));
  return true;
}

/** Take an app out of its folder, to dock position `at` (a unit index;
    null: right after the folder). One app left: the folder goes. */
export function takeOut(appId, at = null) {
  const cur = folders();
  const f = cur.find(x => x.apps.includes(appId));
  if (!f) return false;
  const fs = cur.map(x => (x === f ? { ...x, apps: x.apps.filter(id => id !== appId) } : x)).filter(x => x.apps.length >= 2);
  const keys = unitKeys();
  const i = at === null || !Number.isFinite(at) ? keys.indexOf('f:' + f.id) + 1 : Math.max(0, Math.min(keys.length, at));
  keys.splice(i, 0, appId);
  commit(fs, keys);
  return true;
}

/** Every app back on the dock, where the folder was. */
export function dissolve(folderId) {
  const cur = folders();
  const f = cur.find(x => x.id === folderId);
  if (!f) return false;
  commit(cur.filter(x => x !== f), unitKeys().flatMap(k => (k === 'f:' + f.id ? f.apps : [k])));
  return true;
}

export function rename(folderId, name) {
  const n = String(name ?? '').trim().slice(0, NAME_MAX);
  const cur = folders();
  if (!cur.some(f => f.id === folderId)) return;
  /* clearing it, or typing the automatic name, goes back to the category */
  store.set(KEY, cur.map(f => ({ id: f.id, apps: [...f.apps],
    name: f.id === folderId ? (n && n !== category(f.apps) ? n : category(f.apps)) : f.name })));
}

/** Move a dock unit (app id or 'f:<id>') one place along; { index, count } or null. */
export function shift(key, d) {
  const keys = unitKeys();
  const i = keys.indexOf(key), j = i + d;
  if (i < 0 || j < 0 || j >= keys.length) return null;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  commit(folders(), keys);
  return { index: j, count: keys.length };
}

export const any = () => folders().length > 0;

/* ---------- the dock's side --------------------------------------------
   dock.js paints the dock; this draws folders into it, the grid that
   opens from one, and the "drop onto an icon" part of a dock drag.
     draggable(el, id, kind)  the dock's drag-to-reorder, for a folder
     launching(ids)           true while one of these apps' launch bounce plays
     itemStyle()              the dock's per-item style */
export function mountFolders({ dock, host, itemStyle, draggable, launching }) {
  let pop = null;      /* the open grid: { el, id, release, offRove, outside } */

  const tileOf = id => dock.querySelector(`.dock__item[data-folder="${CSS.escape(id)}"]`);
  const vertical = () => dock.dataset.pos === 'left' || dock.dataset.pos === 'right';

  /* ---------------- the folder in the dock ---------------- */
  function item(f) {
    const label = labelOf(f);
    const open = f.apps.reduce((n, id) => n + wm.byApp(id).length, 0);
    const active = wm.getActive();
    const el = h('button.dock__item.dock__item--folder', {
      dataset: { folder: f.id, key: 'folder:' + f.id, apps: f.apps.join(' ') },
      'aria-label': `${label} folder, ${f.apps.length} apps${open ? `, ${open} open` : ''}`,
      'aria-haspopup': 'dialog', 'aria-expanded': pop && pop.id === f.id ? 'true' : 'false',
      style: itemStyle(),
      onclick: () => (pop && pop.id === f.id ? close() : openFolder(f.id)),
      oncontextmenu: e => folderMenu(e, f),
    },
      h('div.glyph.dock-folder__tile', f.apps.slice(0, 4).map(id => {
        const a = getApp(id);
        return appTile(a, { sel: 'span.dock-folder__mini' });
      })),
      h('div.dock__tip', { text: label }),
      h('div.dock__dot'));
    if (open) el.classList.add('is-running');
    if (active && f.apps.includes(active.appId)) el.classList.add('is-active');
    if (launching(f.apps)) el.classList.add('is-launching');
    draggable(el, f.id, 'folder');
    return el;
  }

  function folderMenu(e, f) {
    e.preventDefault();
    api.menu([
      { label: 'Open', icon: 'folder-open', onClick: () => openFolder(f.id) },
      { label: 'Rename…', icon: 'edit-3', onClick: () => {
        openFolder(f.id, { focus: false });
        const input = pop && pop.el.querySelector('.dock-folder__name');
        if (input) { input.focus(); input.select(); }
      } },
      '-',
      { label: 'Ungroup Folder', icon: 'grid', onClick: () => { close(); dissolve(f.id); say(`${labelOf(f)} folder ungrouped`); } },
    ], e.clientX, e.clientY);
  }

  /** "Put in a Folder With" for a dock app's menu, or null. */
  function intoMenu(appId) {
    const fs = new Map(folders().map(f => [f.id, f]));
    const items = unitKeys().filter(k => k !== appId).map(k => {
      if (k.startsWith('f:')) {
        const f = fs.get(k.slice(2));
        return { label: labelOf(f), icon: 'folder', onClick: () => { add(f.id, appId); say(`${getApp(appId).name} added to ${labelOf(f)}`); } };
      }
      const a = getApp(k);
      return { label: a.name, icon: a.icon, onClick: () => { const f = make(k, appId); if (f) say(`New folder ${labelOf(f)}`); } };
    });
    return items.length ? { label: 'Put in a Folder With', icon: 'folder', items } : null;
  }

  /* ---------------- the grid ---------------- */
  function folderApp(appId) {
    const a = getApp(appId);
    const running = wm.byApp(appId).length > 0;
    const el = h('button.dock-folder__app', {
      type: 'button', dataset: { app: appId }, 'aria-label': a.name + (running ? ', open' : ''),
      onclick: () => { close(); wm.toggleApp(appId); },
      oncontextmenu: e => {
        e.preventDefault();
        e.stopPropagation();
        api.menu([
          { label: running ? 'Show' : 'Open', icon: 'external-link', onClick: () => { close(); wm.toggleApp(appId); } },
          { label: 'Take Out of Folder', icon: 'folder-open', onClick: () => { close(); takeOut(appId); say(`${a.name} taken out of the folder`); } },
        ], e.clientX, e.clientY);
      },
    },
      appTile(a),
      h('span.dock-folder__label', { text: a.name }),
      running ? h('span.dock-folder__dot', { 'aria-hidden': 'true' }) : null);
    el.addEventListener('pointerdown', e => dragOut(e, el, appId));
    return el;
  }

  function place(el, tile) {
    const r = tile.getBoundingClientRect();
    const pw = el.offsetWidth, ph = el.offsetHeight;
    const pos = dock.dataset.pos;
    let x, y;
    if (pos === 'left') { x = r.right + 14; y = r.top + r.height / 2 - ph / 2; }
    else if (pos === 'right') { x = r.left - 14 - pw; y = r.top + r.height / 2 - ph / 2; }
    else { x = r.left + r.width / 2 - pw / 2; y = r.top - 16 - ph; }
    el.style.left = Math.round(Math.max(8, Math.min(x, window.innerWidth - pw - 8))) + 'px';
    el.style.top = Math.round(Math.max(8, Math.min(y, window.innerHeight - ph - 8))) + 'px';
  }

  function openFolder(id, { focus = true } = {}) {
    close();
    const f = folders().find(x => x.id === id);
    const tile = tileOf(id);
    if (!f || !tile) return;
    const name = labelOf(f);
    const input = h('input.dock-folder__name', { value: name, 'aria-label': 'Folder name', maxlength: String(NAME_MAX), spellcheck: 'false' });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      rename(id, input.value);
      pop?.el.querySelector('.dock-folder__app')?.focus({ preventScroll: true });
    });
    input.addEventListener('change', () => rename(id, input.value));
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(f.apps.length))));
    const grid = h('div.dock-folder__grid', { role: 'group', 'aria-label': `Apps in ${name}`, style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } },
      f.apps.map(folderApp));
    const el = h('div.dock-folder', { role: 'dialog', 'aria-label': `${name} folder` }, input, grid);
    host.appendChild(el);
    place(el, tile);
    const offRove = roving(grid, { items: '.dock-folder__app', orientation: 'grid', columns: () => cols });
    /* a press anywhere else closes it — a press on its own dock icon toggles it there */
    const outside = e => {
      if (el.contains(e.target) || e.target.closest?.(`.dock__item[data-folder="${CSS.escape(id)}"]`)) return;
      close();
    };
    const release = L.push({ name: 'dock-folder', el, close: () => close() });
    document.addEventListener('pointerdown', outside, true);
    pop = { el, id, release, offRove, outside };
    tile.setAttribute('aria-expanded', 'true');
    if (typeof el.animate === 'function' && !document.body.classList.contains('reduce-motion')) {
      el.animate([{ opacity: 0, transform: 'translateY(8px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    if (focus) grid.querySelector('.dock-folder__app')?.focus({ preventScroll: true });
  }

  function close() {
    if (!pop) return;
    const p = pop;
    pop = null;
    document.removeEventListener('pointerdown', p.outside, true);
    p.offRove();
    p.el.remove();
    tileOf(p.id)?.setAttribute('aria-expanded', 'false');
    p.release();
  }

  /* an app dragged off the grid: out of the folder */
  function dragOut(e, el, appId) {
    if (e.button !== 0 || !pop) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null;
    const inside = ev => {
      const r = pop && pop.el.getBoundingClientRect();
      return !!r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    };
    const move = ev => {
      if (!ghost) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < SLOP) return;
        ghost = el.querySelector('.glyph').cloneNode(true);
        ghost.classList.add('dock-folder__ghost');
        ghost.setAttribute('aria-hidden', 'true');
        host.appendChild(ghost);
        el.classList.add('is-lifted');
        try { el.setPointerCapture?.(ev.pointerId); } catch (err) { /* pointer already gone */ }
      }
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX - 23}px,${ev.clientY - 23}px)`;
      ghost.classList.toggle('is-out', !inside(ev));
    };
    const up = ev => {
      quit();
      if (!ghost) return;
      ghost.remove();
      el.classList.remove('is-lifted');
      /* the click that ends a drag is not a click on the app */
      const swallow = c => { c.preventDefault(); c.stopPropagation(); };
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallow, true), 300);
      if (ev.type !== 'pointerup' || inside(ev)) return;
      const at = dockIndexAt(ev);
      close();
      takeOut(appId, at);
      say(`${getApp(appId).name} taken out of the folder`);
    };
    const quit = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Over the dock: the unit index to land at; elsewhere null. */
  function dockIndexAt(ev) {
    const r = dock.getBoundingClientRect();
    if (ev.clientX < r.left - 24 || ev.clientX > r.right + 24 || ev.clientY < r.top - 24 || ev.clientY > r.bottom + 24) return null;
    const v = vertical();
    const p = v ? ev.clientY : ev.clientX;
    const all = [...dock.querySelectorAll(UNIT)];
    const i = all.findIndex(n => { const b = n.getBoundingClientRect(); return p < (v ? b.top + b.height / 2 : b.left + b.width / 2); });
    return i < 0 ? all.length : i;
  }

  /* ---------------- dropping a dragged dock app onto an icon ----------------
     aim(item, id, kind) for one drag: track(ev) is true while the pointer is
     over the middle of another icon — the dock then holds still — and after
     DWELL that icon takes the app in on drop(). */
  function aim(item, id, kind) {
    let el = null, armed = false, t = 0;
    const clear = () => {
      clearTimeout(t);
      t = 0;
      if (el) el.classList.remove('is-drop-into');
      el = null;
      armed = false;
    };
    function track(ev) {
      if (kind !== 'app') return false;
      const v = vertical();
      const p = v ? ev.clientY : ev.clientX, q = v ? ev.clientX : ev.clientY;
      let hit = null;
      for (const n of dock.querySelectorAll(UNIT)) {
        if (n === item) continue;
        const r = n.getBoundingClientRect();
        const c = v ? r.top + r.height / 2 : r.left + r.width / 2;
        const size = v ? r.height : r.width;
        const across = v ? q >= r.left - 12 && q <= r.right + 12 : q >= r.top - 16 && q <= r.bottom + 12;
        if (across && Math.abs(p - c) <= size * MID) { hit = n; break; }
      }
      if (!hit) { clear(); return false; }
      if (hit !== el) {
        clear();
        el = hit;
        t = setTimeout(() => { armed = true; if (el) el.classList.add('is-drop-into'); }, DWELL);
      }
      return true;
    }
    function drop() {
      const target = armed && el && el.isConnected ? el : null;
      clear();
      if (!target) return false;
      if (target.dataset.folder) {
        const ok = add(target.dataset.folder, id);
        if (ok) say(`${getApp(id).name} added to ${labelOf(folders().find(f => f.id === target.dataset.folder))}`);
        return ok;
      }
      const f = make(target.dataset.app, id);
      if (f) say(`New folder ${labelOf(f)}, with ${getApp(target.dataset.app).name} and ${getApp(id).name}`);
      return !!f;
    }
    return { track, drop, clear };
  }

  const offs = [
    store.sub(KEY, () => { if (pop && !folders().some(f => f.id === pop.id)) close(); }),
    bus.on('power:lock', close),
  ];
  return { item, aim, intoMenu, open: openFolder, close, destroy: () => { close(); offs.forEach(off => off()); } };
}

export default { folders, units, unitKeys, expand, make, add, takeOut, dissolve, rename, shift, any, labelOf, mountFolders, UNIT };
