/* ============================================================
   dockpeek.js — what an app has open, one hover away.

   Rest the pointer on a running app in the dock and a small card
   opens beside it with a live picture of each of its windows (the
   same scaled clones the overview draws) and the window's title.
   Click one to bring that window forward (a hidden one comes back,
   one on another desktop takes you there). Never on touch, never
   while a dock icon is being dragged, and it goes as soon as the
   pointer leaves the dock and the card.

   Also here: dropping a file on an app tile opens it with that app.
   A file dragged from the desktop is handled by the icon layer
   (shell/deskicons.js, which asks canDockDrop); this takes files
   dragged in from the computer (they are saved to Downloads first,
   by the same rules as Files' Import) and paths dragged out of
   Files (application/x-staticos-path).
   ============================================================ */
import { h, on } from '../core/dom.js';
import { bus } from '../core/bus.js';
import * as wm from '../core/wm.js';
import { icon } from '../core/icons.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as fileimport from '../core/fileimport.js';
import * as FS from '../core/deskfs.js';
import { shotOf } from '../core/winshot.js';
import { t } from '../core/i18n.js';

const SHOW_DELAY = 380;
const HIDE_DELAY = 220;
const THUMB_W = 188;
const THUMB_H = 118;

export function mountDockPeek({ dock, host }) {
  const card = h('div.dock-peek', { role: 'group', 'aria-label': t('Open windows') });
  let appId = null;
  let showT = 0, hideT = 0;
  let dragging = false;
  const offs = [];

  const titleOf = w => {
    const tx = w.el.querySelector('.win__title > span:not(.icon):not(.win__sub)');
    return (tx?.textContent || '').trim() || w.app.name;
  };

  const shot = w => shotOf(w, THUMB_W, THUMB_H, 'dock-peek__shot');

  function paint() {
    const list = wm.byApp(appId).filter(w => !w.tabHidden);
    if (!list.length) { hide(); return; }
    card.replaceChildren(...list.map(w => h('button.dock-peek__win', {
      type: 'button', dataset: { win: String(w.id) }, 'aria-label': `Show ${titleOf(w)}`,
      onclick: () => { hide(); if (w.min) wm.restore(w); else wm.focus(w, { lift: true }); },
    }, shot(w), h('span.dock-peek__cap', icon(w.app.icon), h('span.trunc', { text: titleOf(w) + (w.min ? ' (hidden)' : '') })))));
  }

  function place(item) {
    const r = item.getBoundingClientRect();
    const pos = dock.dataset.pos || 'bottom';
    const cw = card.offsetWidth, ch = card.offsetHeight;
    if (pos === 'bottom') {
      card.style.left = Math.max(8, Math.min(innerWidth - cw - 8, r.left + r.width / 2 - cw / 2)) + 'px';
      card.style.top = Math.max(8, r.top - ch - 16) + 'px';
    } else {
      card.style.top = Math.max(8, Math.min(innerHeight - ch - 8, r.top + r.height / 2 - ch / 2)) + 'px';
      card.style.left = (pos === 'left' ? r.right + 16 : Math.max(8, r.left - cw - 16)) + 'px';
    }
  }

  function show(item) {
    const id = item.dataset.app;
    if (!id || !wm.byApp(id).length) return;
    appId = id;
    paint();
    if (!card.isConnected) host.appendChild(card);
    place(item);
    card.classList.add('is-on');
    dock.classList.add('is-peeking');
  }
  function hide() {
    clearTimeout(showT); clearTimeout(hideT);
    appId = null;
    card.classList.remove('is-on');
    dock.classList.remove('is-peeking');
    card.remove();
  }
  const open = () => card.isConnected && appId;

  const itemOf = t => t?.closest?.('.dock__item[data-app]');
  offs.push(on(dock, 'pointerover', e => {
    if (e.pointerType === 'touch' || dragging || document.body.classList.contains('is-mobile')) return;
    const item = itemOf(e.target);
    clearTimeout(hideT);
    if (!item || !item.classList.contains('is-running')) return;
    if (open() && appId === item.dataset.app) return;
    clearTimeout(showT);
    showT = setTimeout(() => { if (item.isConnected && item.matches(':hover')) show(item); }, open() ? 60 : SHOW_DELAY);
  }));
  offs.push(on(dock, 'pointerout', e => {
    clearTimeout(showT);
    if (card.contains(e.relatedTarget)) return;
    if (itemOf(e.relatedTarget)?.classList.contains('is-running')) return;
    hideT = setTimeout(() => { if (!card.matches(':hover') && !dock.matches(':hover')) hide(); }, HIDE_DELAY);
  }));
  offs.push(on(card, 'pointerleave', () => {
    hideT = setTimeout(() => { if (!card.matches(':hover') && !dock.matches(':hover')) hide(); }, HIDE_DELAY);
  }));
  offs.push(on(dock, 'pointerdown', () => { dragging = true; hide(); }, true));
  offs.push(on(window, 'pointerup', () => { dragging = false; }, true));
  /* windows come and go while it is open */
  offs.push(bus.on('win:list', () => { if (open()) paint(); }));
  offs.push(bus.on('win:close', () => { if (open()) setTimeout(() => { if (open()) paint(); }, 260); }));
  offs.push(on(window, 'keydown', e => { if (e.key === 'Escape' && open()) hide(); }, true));

  /* ---------------- dropping a file on an app tile ---------------- */
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  const hasPath = e => [...(e.dataTransfer?.types || [])].includes('application/x-staticos-path');
  const tileOf = e => { const t = itemOf(e.target); return t && api.getApp(t.dataset.app) ? t : null; };
  let lit = null;
  const unlit = () => { lit?.classList.remove('is-drop'); lit = null; };
  offs.push(on(dock, 'dragover', e => {
    if (!hasFiles(e) && !hasPath(e)) return;
    const t = tileOf(e);
    if (!t) { unlit(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (t !== lit) { unlit(); lit = t; t.classList.add('is-drop'); }
  }));
  offs.push(on(dock, 'dragleave', e => { if (!dock.contains(e.relatedTarget)) unlit(); }));
  offs.push(on(dock, 'drop', async e => {
    const t = tileOf(e);
    unlit();
    if (!t || (!hasFiles(e) && !hasPath(e))) return;
    e.preventDefault();
    e.stopPropagation();
    const id = t.dataset.app;
    const app = api.getApp(id);
    const paths = [];
    if (hasPath(e)) { const p = e.dataTransfer.getData('application/x-staticos-path'); if (p && api.vfs.node(p)) paths.push(p); }
    if (hasFiles(e)) {
      const { files, folders } = fileimport.fromDrop(e.dataTransfer);
      if (files.length || folders.length) {
        let results = [];
        try { results = await fileimport.importFiles(`${api.vfs.HOME}/Downloads`, files, { folders }); }
        catch (err) { results = files.map(f => ({ ok: false, name: f.name, why: String(err?.message || err) })); }
        for (const r of results) if (r.ok && r.path) paths.push(r.path);
        const bad = results.filter(r => !r.ok);
        if (bad.length) api.notify({ app: 'Dock', icon: 'alert', title: `Not opened: ${bad[0].name}`, message: bad[0].why, timeout: 7000 });
      }
    }
    /* a folder dragged out of Files onto Static Drop is sent as a zip */
    if (id === 'drop') {
      const dirs = paths.filter(p => api.vfs.node(p)?.type === 'dir');
      if (dirs.length) { FS.usedApp(id); api.openApp('drop', { send: dirs, go: true }); return; }
    }
    const files = paths.filter(p => api.vfs.node(p)?.type === 'file');
    if (!files.length) return;
    FS.usedApp(id);
    for (const p of files) api.openFile(p, id);
    bus.emit('a11y:say', `Opening ${files.length === 1 ? 'the file' : files.length + ' files'} in ${app.name}`);
  }));

  return () => { offs.forEach(f => f()); hide(); };
}
