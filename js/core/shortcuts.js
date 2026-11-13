/* ============================================================
   shortcuts.js — pin games to the desktop (section 30).

   A shortcut is a real .aethergame file in ~/Desktop (or any
   folder): JSON { kind, id, title, art, url }. The desktop draws it
   with the game's art, double-click launches it (launch.js), and
   because it is an ordinary file it can be moved, renamed, deleted
   and put into folders — and it survives reloads (vfs persistence).
   ============================================================ */
import { vfs } from './vfs.js';
import { bus } from './bus.js';

const safe = s => String(s || 'Game').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Game';

export function shortcutBody(item) {
  return JSON.stringify({
    kind: item.kind || 'web', id: String(item.id), title: String(item.title || item.id),
    art: item.art || null, url: item.kind === 'web' || !item.kind ? (item.url || `static://games/${item.id}`) : null,
  }, null, 2);
}

/** -> { path, already } or null when there is no such folder */
export function addToDesktop(item, folder = `${vfs.HOME}/Desktop`) {
  const path = `${folder}/${safe(item.title)}.aethergame`;
  const already = !!vfs.node(path);
  const node = already ? vfs.node(path) : vfs.touch(path, shortcutBody(item));
  if (!node) return null;
  bus.emit('noti:push', {
    app: 'StaticOS', icon: already ? 'check' : 'monitor', timeout: 4000,
    title: already ? 'Already on your Desktop' : 'Added to Desktop',
    message: `${safe(item.title)} — double-click it to play.`,
  });
  return { path, already };
}

export default { addToDesktop, shortcutBody };
