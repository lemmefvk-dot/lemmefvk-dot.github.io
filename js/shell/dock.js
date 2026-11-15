/* ============================================================
   dock.js — the floating bottom dock
   launcher button · app items from store 'dock' · Trash
   Every app item carries data-app so wm.js can fly a minimised
   window into it. Magnification follows prefs.dockMagnify.
   Apps dropped onto each other make a folder (shell/dockfolders.js);
   a folder item carries data-folder, and data-apps for wm.js.
   During Halloween (24 Oct – 1 Nov, js/core/halloween.js) a pumpkin
   sits beside the Trash: one trick or treat per day; in winter
   (1 Dec – 1 Jan, js/core/winter.js) a gift opens the advent
   calendar. Neither has data-app, so neither is ever saved into
   the dock order.

   prefs.shellLayout 'taskbar' turns the same bar into a taskbar along the
   whole bottom edge (css/feat-shell.css): the same apps, the same menus and
   dragging, with a name beside each open app and no magnification. The Dock
   stays the default.
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as wm from '../core/wm.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { getApp, listApps } from '../core/registry.js';
import * as HW from '../core/halloween.js';
import * as WINTER from '../core/winter.js';
import { winter } from '../core/season.js';
import { roving } from '../core/roving.js';
import * as F from './dockfolders.js';
import { appTile } from '../core/appart.js';
import { addAppToDesktop } from '../core/shortcuts.js';
import * as TB from './trashbin.js';
import { mountDockPeek } from './dockpeek.js';
import * as WNB from '../core/wnbadge.js';
import { t as tr, plural as tPlural } from '../core/i18n.js';

const { h, icon, vfs, on, raf, clear } = api;

const TRASH = TB.TRASH;
const MAG = { reach: 2.7, lift: 13, grow: 0.3 };

export function mountDock(host) {
  /* Terminal used to be a dock app; it now lives only in the Linux wallpaper
     and is registered hidden. Strip hidden ids from an older saved dock once,
     so Settings › Dock and its counts match what the dock shows. */
  {
    const saved = store.get('dock');
    if (Array.isArray(saved) && saved.some(id => getApp(id)?.hidden)) {
      store.set('dock', saved.filter(id => !getApp(id)?.hidden));
    }
    /* StaticOS 4.0 is built around Static Play: a dock saved by an older
       build gets it once, next to Files. Removing it afterwards sticks. */
    const now = store.get('dock');
    if (!store.get('session.dockPlay') && Array.isArray(now) && getApp('play')) {
      if (!now.includes('play')) {
        const at = now.indexOf('files');
        const next = [...now];
        next.splice(at >= 0 ? at + 1 : Math.min(1, next.length), 0, 'play');
        store.set('dock', next);
      }
      store.set('session.dockPlay', true);
    }
  }
  const S = { mag: !!store.get('prefs.dockMagnify'), offMag: null, dragging: false, paintQueued: false };
  const dock = h('nav.dock', { 'aria-label': tr('Dock') });
  host.appendChild(dock);
  store.sub('prefs', () => { applyPrefs(); paint(); });

  /* ---------------- pieces ---------------- */
  /* the transitions live in the stylesheet (.dock.is-mag follows the pointer
     closely, the rest settles with a spring) — css/features.css */
  const itemStyle = () => ({ transformOrigin: originFor() });
  const originFor = () => (dock.dataset.pos === 'left' ? '0 50%' : dock.dataset.pos === 'right' ? '100% 50%' : '50% 100%');
  const winTitle = w => w.el.getAttribute('aria-label') || w.app.name;
  const plural = TB.plural;

  function launcherItem() {
    return h('button.dock__item', {
      dataset: { app: 'launcher' }, 'aria-label': tr('Launcher'), style: itemStyle(),
      onclick: () => bus.emit('launcher:toggle'),
      oncontextmenu: e => e.preventDefault(),
    },
      appTile({ id: 'launcher', icon: 'diamond', g1: 'var(--aether-300)', g2: 'var(--aether-600)' }),
      h('div.dock__tip', { text: tr('Launcher') }),
      h('div.dock__dot'));
  }

  /* Unread notifications per app, from the notification centre's own log
     (prefs.notiLog, which shell/notifications.js keeps): the same count it shows. */
  function unreadByApp() {
    const by = new Map();
    const rows = store.get('prefs.notiLog');
    if (!Array.isArray(rows)) return by;
    for (const r of rows) {
      if (!r || r.read !== false) continue;
      const id = getApp(String(r.app || '').toLowerCase())?.id;
      if (id) by.set(id, (by.get(id) || 0) + 1);
    }
    return by;
  }

  /* Static Social's badge: friends online now (js/core/friends.js announces it; absent until Friends is in use) */
  let friendsOnline = 0;
  function appItem(app, unread = 0) {
    const open = wm.byApp(app.id);
    const active = wm.getActive();
    /* a screen reader hears what the dot and badge show */
    const fresh = app.id === 'whatsnew' && WNB.hasNew();
    const state = (!open.length ? '' : open.length > 1 ? ', ' + tr('{n} windows open', { n: open.length }) : ', ' + tr('open'))
      + (unread ? ', ' + tPlural(unread, '{n} unread notification', '{n} unread notifications') : '')
      + (app.id === 'social' && friendsOnline ? ', ' + tPlural(friendsOnline, '{n} friend online', '{n} friends online') : '')
      + (fresh ? ', ' + tr('new since you last looked') : '');
    const el = h('button.dock__item', {
      dataset: { app: app.id }, 'aria-label': app.name + state, style: itemStyle(),
      'aria-current': active && active.appId === app.id ? 'true' : null,
      onclick: () => wm.toggleApp(app.id),
      oncontextmenu: e => appMenu(e, app),
    },
      appTile(app),
      open.length > 1 ? h('div.dock__badge', { text: String(open.length) }) : null,
      unread ? h('div.dock__unread', { text: unread > 99 ? '99+' : String(unread), title: tPlural(unread, '{n} unread notification', '{n} unread notifications'), 'aria-hidden': 'true' }) : null,
      fresh ? WNB.mark(h) : null,
      app.id === 'social' && friendsOnline ? h('div.dock__online', { text: String(friendsOnline), title: tPlural(friendsOnline, '{n} friend online', '{n} friends online'), 'aria-hidden': 'true' }) : null,
      h('div.dock__tip', { text: app.name }),
      h('div.dock__dot'));
    if (open.length) el.classList.add('is-running');
    if (active && active.appId === app.id) el.classList.add('is-active');
    makeDraggable(el, app.id);
    /* re-applied on every repaint inside the bounce window, so the keyframe
       survives the repaints that win:open / win:list / win:focus trigger */
    if (launched.id === app.id && Date.now() - launched.at < BOUNCE_MS) {
      el.classList.add('is-launching');
    }
    return el;
  }

  function trashItem() {
    /* hidden:true — emptyTrash() and Spotlight both count dotfiles, so the
       badge and the "Empty Trash" enabled state must count them too */
    const n = TB.trashItems().length;
    return h('button.dock__item', {
      dataset: { app: 'trash' }, 'aria-label': n ? tPlural(n, 'Trash, {n} item', 'Trash, {n} items') : tr('Trash'),
      style: itemStyle(),
      onclick: () => api.openApp('files', { path: TRASH }),
      oncontextmenu: e => trashMenu(e, n),
    },
      appTile({ id: 'trash', icon: 'trash', g1: 'var(--ink-4)', g2: 'var(--bg-2)' }),
      n ? h('div.dock__badge', { text: String(n) }) : null,
      h('div.dock__tip', { text: tr('Trash') }),
      h('div.dock__dot'));
  }

  function pumpkinItem() {
    const done = HW.doneToday();
    const label = done ? tr('Trick or treat — again tomorrow') : tr('Trick or treat');
    const el = h('button.dock__item.dock__item--pumpkin', {
      dataset: { dock: 'pumpkin' }, 'aria-label': label, style: itemStyle(),
      onclick: () => HW.trickOrTreat(),
      oncontextmenu: e => e.preventDefault(),
    },
      appTile({ id: 'pumpkin', icon: 'pumpkin', g1: '#ffb04a', g2: '#c2410c' }),
      done ? null : h('div.dock__treat', { 'aria-hidden': 'true' }),
      h('div.dock__tip', { text: label }),
      h('div.dock__dot'));
    if (done) el.classList.add('is-done');
    return el;
  }

  function adventItem() {
    const n = WINTER.todaysDoor();
    const ready = n && !WINTER.isOpen(n);
    const label = ready ? tr('Advent calendar — door {n} is ready', { n }) : tr('Advent calendar');
    return h('button.dock__item.dock__item--advent', {
      dataset: { dock: 'advent' }, 'aria-label': label, style: itemStyle(),
      onclick: () => bus.emit('winter:advent'),
      oncontextmenu: e => e.preventDefault(),
    },
      appTile({ id: 'gift', icon: 'gift', g1: '#ff9a8a', g2: '#b3262f' }),
      ready ? h('div.dock__treat', { 'aria-hidden': 'true' }) : null,
      h('div.dock__tip', { text: label }),
      h('div.dock__dot'));
  }

  /* ---------------- paint ---------------- */
  /* A launch is a moment, not a state: remember when it happened so the class
     survives however many times the dock repaints inside that window. */
  let launched = { id: null, at: 0 };
  const BOUNCE_MS = 620;

  function paint() {
    /* A repaint during a drag rebuilds every item, which orphans the node
       being dragged — and re-inserting it afterwards leaves a duplicate.
       Defer instead; the drop repaints. */
    if (S.dragging) { S.paintQueued = true; return; }
    clear(dock);
    /* Array.isArray, not .length: an empty list means the user emptied the
       dock in Settings, and must not resurrect every dock:true app */
    const saved = store.get('dock');
    const ids = Array.isArray(saved) ? saved : listApps().filter(a => a.dock).map(a => a.id);
    /* hidden apps (About, and Terminal, which now only lives in the Linux
       wallpaper) never show, even if an older saved dock still lists them */
    const apps = ids
      .filter(id => id !== 'launcher' && id !== 'trash')
      .map(getApp)
      .filter(a => a && !a.hidden);
    dock.append(launcherItem(), h('div.dock__sep'));
    const unread = unreadByApp();
    for (const u of F.units(apps)) dock.appendChild(u.folder ? folders.item(u.folder) : appItem(u.app, unread.get(u.app.id) || 0));
    dock.append(...[h('div.dock__sep'), HW.inSeason() ? pumpkinItem() : null, winter('advent') ? adventItem() : null, trashItem()].filter(Boolean));
    /* a repaint while the pointer is in the dock (an app opened, a window
       closed) used to drop every icon back to rest and grow them again on
       the next move — a visible flicker. The new items start magnified. */
    rest = null;
    if (S.mag && magAt !== null) magnify(magAt);
  }


  /* ---------------- reordering ----------------
     Pointer events rather than HTML5 drag-and-drop: the dock magnifies on
     pointermove, and the native drag API suppresses those events, so the
     two cannot coexist. This also keeps it working on touch.

     Nothing moves until the pointer has travelled a few pixels, so a slow
     click still launches the app instead of starting a drag. */
  const DRAG_SLOP = 5;

  /* kind 'folder': a dock folder (id is its id), which moves but never goes into another */
  function makeDraggable(el, id, kind = 'app') {
    el.addEventListener('pointerdown', down);
    const sel = kind === 'folder' ? `.dock__item[data-folder="${CSS.escape(id)}"]` : `.dock__item[data-app="${CSS.escape(id)}"]`;

    function down(e) {
      if (e.button !== 0) return;
      const startX = e.clientX;
      let dragging = false;
      let aim = null;       /* held over another icon: a folder (shell/dockfolders.js) */
      /* the icon being carried. A repaint between the press and the drag
         (a window opened or closed, a file changed) replaces every icon,
         and the pressed one is no longer in the dock: carry its
         replacement. Re-inserting the old one would show the app twice,
         and capturing the pointer on it throws (InvalidStateError). */
      let item = el;

      const move = ev => {
        if (!dragging) {
          if (Math.abs(ev.clientX - startX) < DRAG_SLOP) return;
          if (!item.isConnected) item = dock.querySelector(sel);
          if (!item) { quit(); return; }                /* the app left the dock meanwhile */
          dragging = true;
          aim = folders.aim(item, id, kind);
          S.dragging = true;
          dock.classList.add('is-reordering');
          item.classList.add('is-dragging');
          try { item.setPointerCapture?.(ev.pointerId); } catch (err) { /* pointer already gone */ }
        }
        ev.preventDefault();
        /* over the middle of another icon: it may take this one in, so hold still */
        if (aim.track(ev)) return;
        /* Insert before whichever sibling the pointer is past the middle of.
           Doing it live means the gap is always where the icon will land. */
        const items = [...dock.querySelectorAll(F.UNIT)].filter(n => n !== item);
        let before = null;
        for (const other of items) {
          const r = other.getBoundingClientRect();
          if (ev.clientX < r.left + r.width / 2) { before = other; break; }
        }
        const endSep = [...dock.querySelectorAll('.dock__sep')].pop();
        dock.insertBefore(item, before || endSep || null);
      };

      function quit() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      }
      const up = ev => {
        quit();
        if (!dragging) return;
        ev.preventDefault();
        ev.stopPropagation();
        dock.classList.remove('is-reordering');
        item.classList.remove('is-dragging');
        S.dragging = false;
        /* Dropped onto an icon it was held over: a folder. Otherwise persist
           the order the DOM now shows (a folder stands for its apps). A new
           array every time — store.set short-circuits on identity. */
        if (!(ev.type === 'pointerup' && aim.drop())) {
          aim.clear();
          store.set('dock', [...F.expand([...dock.querySelectorAll(F.UNIT)])]);
        }
        if (S.paintQueued) { S.paintQueued = false; paint(); }
        /* swallow the click that follows a drag */
        item.addEventListener('click', stop, { capture: true, once: true });
      };

      const stop = ev => { ev.preventDefault(); ev.stopPropagation(); };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
  }

  /* ---------------- placement + auto-hide ----------------
     The dock is a shell surface, so its geometry is a preference rather
     than a layout constant. Everything here reads from prefs and is
     re-applied whenever they change. */
  function applyPrefs() {
    const p = store.get('prefs') || {};
    const size = Math.max(0.7, Math.min(1.4, Number(p.dockSize) || 1));
    const gap = Math.max(0, Math.min(14, Number(p.dockSpacing ?? 6)));
    const taskbar = p.shellLayout === 'taskbar';
    const pos = !taskbar && ['bottom', 'left', 'right'].includes(p.dockPosition) ? p.dockPosition : 'bottom';

    dock.style.setProperty('--dock-scale', String(size));
    dock.style.setProperty('--dock-gap', `${gap}px`);
    dock.dataset.pos = pos;
    dock.classList.toggle('is-autohide', !!p.dockAutohide);
    if (p.dockOpacity != null) {
      dock.style.setProperty('--dock-alpha', String(Math.max(0.2, Math.min(1, Number(p.dockOpacity)))));
    }
    S.mag = !!p.dockMagnify && !taskbar;
  }

  /* ---------------- menus ---------------- */
  function setPinned(id, keep) {
    const list = (store.get('dock') || []).filter(x => x !== id);
    store.set('dock', keep ? [...list, id] : list);
  }

  function appMenu(e, app) {
    e.preventDefault();
    const open = wm.byApp(app.id);
    const pinned = (store.get('dock') || []).includes(app.id);
    api.menu([
      ...open.map(w => ({
        /* a window on another desktop says which; choosing it goes there */
        label: winTitle(w), icon: 'window',
        hint: w.min ? tr('Hidden') : w.tabHidden ? tr('Tab') : w.desk && wm.desktops.count() > 1 && w.desk !== wm.desktops.current() ? wm.desktops.label(w.desk) : null,
        onClick: () => (w.min ? wm.restore(w) : wm.focus(w)),
      })),
      open.length ? '-' : null,
      { label: tr('New Window'), icon: 'plus', onClick: () => wm.open(app.id) },
      { label: pinned ? tr('Remove from Dock') : tr('Keep in Dock'), icon: 'pin',
        onClick: () => setPinned(app.id, !pinned) },
      pinned ? folders.intoMenu(app.id) : null,
      { label: tr('Add to Desktop'), icon: 'monitor', onClick: () => addAppToDesktop(app.id) },
      loginSet ? { label: tr('Open at Login'), icon: 'power', checked: atLogin(app.id),
        hint: loginSet.startupApps().enabled ? null : tr('Off'), onClick: () => toggleLogin(app) } : null,
      { label: tr('Show All Windows'), icon: 'grid', disabled: !open.length,
        onClick: () => bus.emit('overview:toggle') },
      '-',
      { label: tr('Quit'), icon: 'x', danger: true, disabled: !open.length,
        onClick: () => wm.closeApp(app.id) },
    ].filter(Boolean), e.clientX, e.clientY);
  }

  /* "Open at Login" is the start-up automation's own list (Automations › Startup apps) */
  let loginSet = null;
  import('../core/automations.js').then(A => { loginSet = A; }).catch(() => {});
  const atLogin = id => !!loginSet && loginSet.startupApps().apps.includes(id);
  function toggleLogin(app) {
    const set = loginSet.startupApps();
    if (set.apps.includes(app.id)) {
      loginSet.saveStartupApps({ apps: set.apps.filter(x => x !== app.id) });
      api.notify({ app: 'Dock', icon: 'power', title: tr('{name} won’t open at login', { name: app.name }), timeout: 4000 });
      return;
    }
    if (set.apps.length >= loginSet.MAX_STARTUP_APPS) {
      api.notify({ app: 'Dock', icon: 'alert', title: tr('Start-up list is full'), message: tr('At most {MAX_STARTUP_APPS} apps open at login. Take one off in Automations first.', { MAX_STARTUP_APPS: loginSet.MAX_STARTUP_APPS }) });
      return;
    }
    loginSet.saveStartupApps({ apps: [...set.apps, app.id] });
    api.notify({ app: 'Dock', icon: 'power', title: tr('{name} will open at login', { name: app.name }), timeout: 4000,
      message: set.enabled ? '' : tr('Start-up apps are switched off in Automations.') });
  }

  function trashMenu(e, n) {
    e.preventDefault();
    api.menu([
      { label: tr('Open Trash'), icon: 'folder-open', onClick: () => api.openApp('files', { path: TRASH }) },
      '-',
      { label: tr('Empty Trash'), icon: 'trash', danger: true, disabled: !n, onClick: () => TB.emptyTrash() },
    ], e.clientX, e.clientY);
  }

  /* ---------------- magnification ----------------
     Each icon's resting centre is read once — when the pointer comes into
     the dock, or after a repaint — not on every move. Transforms never move
     layout, so those positions stay true while the icons grow, and every
     frame after that is writes only: it used to read each icon's rect and
     write its transform in turn, a forced style-and-layout per icon per
     frame. A transform that hasn't changed isn't written again. */
  const itemEls = () => [...dock.querySelectorAll('.dock__item')];
  let rest = null;        /* [{ el, c, size, tf }] along the dock's axis */
  let magAt = null;       /* the pointer's position along that axis, while inside */
  const vertical = () => dock.dataset.pos === 'left' || dock.dataset.pos === 'right';

  function measure() {
    const v = vertical();
    const box = dock.getBoundingClientRect();
    rest = itemEls().map(el => ({
      el,
      c: v ? box.top + el.offsetTop + el.offsetHeight / 2 : box.left + el.offsetLeft + el.offsetWidth / 2,
      size: (v ? el.offsetHeight : el.offsetWidth) || 44,
      tf: el.style.transform || '',
    }));
  }

  function magnify(p) {
    if (!rest) measure();
    const v = vertical();
    const side = dock.dataset.pos === 'right' ? -1 : 1;
    for (const it of rest) {
      const d = Math.abs(p - it.c) / it.size;
      const t = Math.max(0, 1 - d / MAG.reach);
      const k = t * t * (3 - 2 * t);
      const lift = (MAG.lift * k).toFixed(1), grow = (1 + MAG.grow * k).toFixed(3);
      const tf = k > 0.004 ? (v ? `translateX(${side * lift}px) scale(${grow})` : `translateY(-${lift}px) scale(${grow})`) : '';
      if (tf !== it.tf) { it.el.style.transform = tf; it.tf = tf; }
    }
  }

  function clearMag() {
    magAt = null;
    dock.classList.remove('is-mag');
    for (const el of itemEls()) el.style.transform = '';
    if (rest) rest.forEach(it => { it.tf = ''; });
  }

  function bindMagnify() {
    if (S.offMag) { S.offMag(); S.offMag = null; }
    clearMag();
    if (!S.mag) return;
    const offEnter = on(dock, 'pointerenter', () => { rest = null; });
    const offMove = on(dock, 'pointermove', e => {
      if (S.dragging) return;
      const p = vertical() ? e.clientY : e.clientX;
      magAt = p;
      dock.classList.add('is-mag');
      raf('dock:mag', () => { if (magAt !== null) magnify(magAt); });
    });
    const offLeave = on(dock, 'pointerleave', () => raf('dock:mag', clearMag));
    S.offMag = () => { offEnter(); offMove(); offLeave(); };
  }

  /* ---------------- wiring ---------------- */
  const repaint = () => raf('dock:paint', paint);
  const folders = F.mountFolders({
    dock, host, itemStyle, draggable: makeDraggable,
    launching: ids => ids.includes(launched.id) && Date.now() - launched.at < BOUNCE_MS,
  });

  applyPrefs();
  paint();
  bindMagnify();
  const peek = mountDockPeek({ dock, host });

  /* ---------------- keyboard ----------------
     One Tab stop; arrows move along it (either axis, so a dock on the left
     or right edge works the same). Shift+arrow carries the focused app
     along the dock — the keyboard twin of dragging it. The menu key or
     Shift+F10 opens the same menu as a right-click (js/shell/a11y.js). */
  dock.addEventListener('keydown', e => {
    if (!e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    const at = document.activeElement?.closest?.('.dock__item');
    const id = at?.dataset.app;
    /* with folders in the dock, a folder moves as one */
    if (d && at && (at.dataset.folder || (id && id !== 'launcher' && id !== 'trash' && F.any()))) {
      e.preventDefault();
      e.stopPropagation();
      const moved = F.shift(at.dataset.folder ? 'f:' + at.dataset.folder : id, d);
      if (!moved) return;
      paint();
      dock.querySelector(at.dataset.folder ? `.dock__item[data-folder="${CSS.escape(at.dataset.folder)}"]` : `.dock__item[data-app="${CSS.escape(id)}"]`)?.focus();
      bus.emit('a11y:say', tr('{name} moved to position {pos} of {count}', { name: at.dataset.folder ? tr('Folder') : getApp(id).name, pos: moved.index + 1, count: moved.count }));
      return;
    }
    if (!d || !id || id === 'launcher' || id === 'trash') return;
    e.preventDefault();
    e.stopPropagation();
    /* swap with the visible neighbour inside the full saved list, so apps
       that are not loaded right now keep their places */
    const saved = Array.isArray(store.get('dock')) ? [...store.get('dock')] : listApps().filter(a => a.dock).map(a => a.id);
    const shown = saved.filter(x => getApp(x) && !getApp(x).hidden);
    const i = shown.indexOf(id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= shown.length) return;
    const a = saved.indexOf(id), b = saved.indexOf(shown[j]);
    [saved[a], saved[b]] = [saved[b], saved[a]];
    store.set('dock', saved);
    paint();                                  /* now, so roving follows the item at once */
    dock.querySelector(`.dock__item[data-app="${id}"]`)?.focus();
    bus.emit('a11y:say', tr('{name} moved to position {pos} of {count}', { name: getApp(id).name, pos: j + 1, count: shown.length }));
  }, true);
  const offRove = roving(dock, { items: '.dock__item', orientation: 'both' });

  const seasonNow = () => `${HW.inSeason()}|${winter('advent')}|${HW.dayKey()}`;
  let seasonKey = seasonNow();
  const offs = [
    bus.on('app:launch', id => {
      launched = { id, at: Date.now() };
      repaint();
      setTimeout(repaint, BOUNCE_MS + 40);      // clear it again once it ends
    }),
    bus.on('friends:count', c => { const n = c && c.on ? Math.max(0, c.online | 0) : 0; if (n !== friendsOnline) { friendsOnline = n; repaint(); } }),
    bus.on('win:list', repaint),
    bus.on('win:focus', repaint),
    bus.on('fs:change', repaint),
    store.sub('dock', repaint),
    /* unread badges follow the notification centre's log */
    store.sub('prefs.notiLog', repaint),
    /* What's New's "New" mark (js/core/wnbadge.js) */
    store.sub(WNB.SEEN, repaint),
    store.sub(WNB.LOOKED, repaint),
    store.sub('session.dockFolders', repaint),
    /* the pumpkin: comes and goes with the season, and dims once used today */
    store.sub('portal.halloween', repaint),
    /* the advent gift: comes and goes with winter, loses its dot once today's door is open */
    store.sub('portal.winter', repaint),
    bus.on('tick:5s', () => {
      const k = seasonNow();
      if (k !== seasonKey) { seasonKey = k; repaint(); }
    }),
    store.sub('prefs', p => {
      rest = null;    /* size, spacing or position may have moved the icons */
      const next = !!(p && p.dockMagnify) && p.shellLayout !== 'taskbar';
      if (next === S.mag) return;
      S.mag = next;
      paint();
      bindMagnify();
    }),
    on(window, 'resize', () => { rest = null; }),
  ];

  /* nothing unmounts the shell today; the handles are all here if it ever does */
  return () => {
    offs.forEach(off => off());
    offRove();
    peek();
    folders.destroy();
    if (S.offMag) { S.offMag(); S.offMag = null; }
    dock.remove();
  };
}

export default mountDock;
