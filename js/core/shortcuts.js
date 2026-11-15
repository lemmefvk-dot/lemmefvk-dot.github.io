/* ============================================================
   shortcuts.js — pin games to the desktop (section 30).

   A shortcut is a real .staticgame file in ~/Desktop (or any
   folder): JSON { kind, id, title, art, url }. The desktop draws it
   with the game's art, double-click launches it (launch.js), and
   because it is an ordinary file it can be moved, renamed, deleted
   and put into folders — and it survives reloads (vfs persistence).
   ============================================================ */
import { vfs } from './vfs.js';
import { bus } from './bus.js';
import { getApp } from './registry.js';
import { t } from './i18n.js';

const safe = s => String(s || 'Game').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Game';

export function shortcutBody(item) {
  return JSON.stringify({
    kind: item.kind || 'web', id: String(item.id), title: String(item.title || item.id),
    art: item.art || null, url: item.kind === 'web' || !item.kind ? (item.url || `static://games/${item.id}`) : null,
  }, null, 2);
}

/** -> { path, already } or null when there is no such folder */
export function addToDesktop(item, folder = `${vfs.HOME}/Desktop`) {
  /* new shortcuts are .staticgame; one saved earlier as .aethergame still counts */
  const old = `${folder}/${safe(item.title)}.aethergame`;
  const path = vfs.node(old) ? old : `${folder}/${safe(item.title)}.staticgame`;
  const already = !!vfs.node(path);
  const node = already ? vfs.node(path) : vfs.touch(path, shortcutBody(item));
  if (!node) return null;
  bus.emit('noti:push', {
    app: 'StaticOS', icon: already ? 'check' : 'monitor', timeout: 4000,
    title: already ? t('Already on your Desktop') : t('Added to Desktop'),
    message: t('{title} — double-click it to play.', { title: safe(item.title) }),
  });
  return { path, already };
}

/** Pin a Library collection (manual or smart) to the desktop: a .staticgame
    file that opens the collection's page in the Library. -> { path, already } | null */
export function addCollectionToDesktop(col, folder = `${vfs.HOME}/Desktop`) {
  const path = `${folder}/${safe(col.name)}.staticgame`;
  const already = !!vfs.node(path);
  const body = JSON.stringify({ kind: 'collection', id: String(col.id), title: String(col.name || 'Collection'), art: null,
    url: `static://library/collections/${encodeURIComponent(col.id)}` }, null, 2);
  const node = already ? vfs.node(path) : vfs.touch(path, body);
  if (!node) return null;
  bus.emit('noti:push', {
    app: 'StaticOS', icon: already ? 'check' : 'monitor', timeout: 4000,
    title: already ? t('Already on your Desktop') : t('Added to Desktop'),
    message: t('{name} — double-click it to open the collection.', { name: safe(col.name) }),
  });
  return { path, already };
}

/* ---------------- app shortcuts ----------------
   A .staticapp file holds { "kind": "app", "id": "<app id>" }. The desktop
   draws it with the app's own tile and opens the app; Files opens it too.
   The file only names the app, so it is the app's own name and art that show,
   in whatever language is on. */

/** The app id a .staticapp node names, or null when it is not one or is unreadable. */
export function appShortcutId(n) {
  if (!n || n.type !== 'file' || !/\.staticapp$/i.test(n.name || '')) return null;
  try {
    const o = JSON.parse(n.content || '{}');
    return o && o.kind === 'app' && typeof o.id === 'string' && o.id ? o.id : null;
  } catch (err) { return null; }
}

/** Open the app a .staticapp names; an app that is not installed gets a notice, never an error. -> the window or null */
export function openAppShortcut(n, openApp) {
  const id = appShortcutId(n);
  if (!id || !getApp(id)) {
    bus.emit('noti:push', { app: 'StaticOS', icon: 'alert', timeout: 5000, title: t('That app isn’t installed'),
      message: t('This shortcut points to an app StaticOS doesn’t have, so there is nothing to open. You can move it to the Trash.') });
    return null;
  }
  try { return openApp(id); } catch (err) { console.warn('[shortcuts] app', err); return null; }
}

/** Pin an app to the desktop (or any folder). Twice makes no second copy, whatever the file is called.
    -> { path, already } | null (no such app or folder). opts.quiet skips the notice. */
export function addAppToDesktop(id, folder = `${vfs.HOME}/Desktop`, opts = {}) {
  const app = getApp(id);
  const dir = vfs.node(folder);
  if (!app || !dir || dir.type !== 'dir') return null;
  const had = (dir.children || []).find(c => appShortcutId(c) === id);
  const path = had ? `${folder}/${had.name}` : `${folder}/${safe(app.name)}.staticapp`;
  const already = !!had || !!vfs.node(path);
  if (!already && !vfs.touch(path, JSON.stringify({ kind: 'app', id }, null, 2))) return null;
  if (!opts.quiet) bus.emit('noti:push', {
    app: 'StaticOS', icon: already ? 'check' : 'monitor', timeout: 4000,
    title: already ? t('Already on your Desktop') : t('Added to Desktop'),
    message: t('{name} — double-click it to open.', { name: app.name }),
  });
  return { path, already };
}

/** The apps a brand-new Desktop starts with (the seed tree in vfs.js lists the same). */
export const STARTER_APPS = ['aether-games', 'arcade', 'music', 'notes'];

/** Settings › Desktop › Put favourite apps on the desktop. -> { added, had } counts */
export function addStarterApps(folder = `${vfs.HOME}/Desktop`) {
  let added = 0, had = 0;
  for (const id of STARTER_APPS) {
    const r = addAppToDesktop(id, folder, { quiet: true });
    if (r) r.already ? had++ : added++;
  }
  return { added, had };
}

export default { addToDesktop, addCollectionToDesktop, shortcutBody, addAppToDesktop, appShortcutId, openAppShortcut, addStarterApps, STARTER_APPS };
