/* ============================================================
   trashbin.js — emptying the Trash, shared by the dock's Trash
   and the Trash icon on the desktop. One confirm sheet, one
   notification, the same count both places.
   ============================================================ */
import { bus } from '../core/bus.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { t } from '../core/i18n.js';

const { vfs } = api;
export const TRASH = `${vfs.HOME}/Trash`;
/* hidden:true — dotfiles count too, so a badge and "Empty Trash" agree */
export const trashItems = () => vfs.ls(TRASH, { hidden: true });
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function emptyTrash() {
  const kids = trashItems();
  if (!kids.length) return false;
  const ok = await api.confirm({
    title: t('Empty the Trash?'),
    message: `${plural(kids.length, 'item')} will be deleted permanently.`,
    ok: t('Empty Trash'),
  });
  if (!ok) return false;
  for (const n of kids) vfs.rm(`${TRASH}/${n.name}`);
  bus.emit('trash:emptied', { count: kids.length });   /* the spooky sound pack cackles (shell/spooky.js) */
  api.notify({ app: 'Files', icon: 'trash', title: t('Trash emptied'),
    message: `${plural(kids.length, 'item')} deleted.` });
  return true;
}
