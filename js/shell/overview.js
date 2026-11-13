/* ============================================================
   overview.js — mission control (⌘` / ⌃↑ / bus 'overview:toggle')
   Lays the current desktop's non-minimised windows out on a tidy
   grid inside the work area as live, scaled clones. Click one to
   focus it.

   Across the top runs the desktop strip: one thumbnail per desktop
   (its wallpaper and where its windows sit) and a + to add one.
     click a desktop         go there
     double-click its name   rename it
     right-click             rename · its own wallpaper · remove
     ×                       remove it (its windows move next door)
     drag a window onto one  move the window to that desktop
     drag a window onto +    a new desktop with that window on it
   ============================================================ */
import { covered } from '../core/cover.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as wm from '../core/wm.js';
import * as L from '../core/layers.js';
import { roving } from '../core/roving.js';
import * as DESK from '../core/desktops.js';
import * as WP from '../portal/wallpapers.js';
import * as KM from '../core/keymap.js';

const PAD = 28;   /* gutter around the grid            */
const GAP = 18;   /* gap between cells                 */
const FOOT = 64;  /* room kept free for .overview__hint */
const STRIP = 150; /* room kept free for the desktop strip */
const DRAG_SLOP = 6;

/** 1 window → 1 column, 2-4 → 2, 5-9 → 3, else 4. */
const colsFor = n => (n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4);
/* a window grouped as tabs shows once, as its selected tab (js/core/wintabs.js) */
const seen = w => !w.min && !w.tabHidden;

export function mountOverview(host) {
  const { h, icon } = api;

  /* cancelRename: set while a desktop's name is being edited */
  const S = { open: false, release: null, renaming: null, cancelRename: null };
  const strip = h('div.overview__desks', { role: 'list', 'aria-label': 'Desktops' });
  const grid = h('div.overview__grid', { role: 'group', 'aria-label': 'Open windows' });
  /* one Tab stop; arrows move around the grid (this desktop's windows) in reading order */
  roving(grid, { items: '.overview__item', orientation: 'grid', columns: () => colsFor(wm.onDesktop().filter(seen).length) });
  const kbd = t => h('span.kbd', { text: t });
  const hint = h('div.overview__hint',
    h('div.row', kbd('esc'), h('span', { text: 'close' })),
    h('div.row', kbd('click'), h('span', { text: 'a window to focus' })),
    h('div.row', kbd('←↑↓→'), kbd('↵'), h('span', { text: 'choose with the keyboard' })),
    h('div.row', kbd('drag'), h('span', { text: 'a window onto a desktop to move it' })),
    h('div.row', kbd('⌃← ⌃→'), h('span', { text: 'switch desktop' })),
  );
  const wrap = h('div.overview', { role: 'dialog', 'aria-label': 'Window overview',
    onmousedown: e => { if (e.target === wrap || e.target === grid || e.target === strip) close(); },
  }, strip, grid, hint);

  /* ---------------- one window ----------- */
  function shot(w, k) {
    const clone = w.el.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.remove('is-active', 'is-dragging', 'is-snapping', 'is-closing', 'is-max', 'is-min', 'is-away', 'is-leaving', 'is-peek');
    Object.assign(clone.style, {
      position: 'relative', left: '0', top: '0',
      width: w.w + 'px', height: w.h + 'px',
      minWidth: '0', minHeight: '0', zIndex: '0',
      opacity: '1', visibility: 'visible', pointerEvents: 'none',
      transform: `scale(${k})`, transformOrigin: 'top left',
      animation: 'none', transition: 'none',
    });
    return h('div', {
      inert: true, 'aria-hidden': 'true',
      style: { width: Math.round(w.w * k) + 'px', height: Math.round(w.h * k) + 'px',
               overflow: 'hidden', pointerEvents: 'none' },
    }, clone);
  }

  const titleOf = w => {
    const tx = w.el.querySelector('.win__title > span:not(.icon):not(.win__sub)');
    return (tx?.textContent || '').trim() || w.app.name;
  };

  function item(w, k, x, y) {
    const title = titleOf(w);
    const tabs = w.group ? w.group.tabs.length : 0;
    const el = h('button.overview__item', {
      'aria-label': `Focus ${title}${tabs > 1 ? `, ${tabs} tabs` : ''}`,
      dataset: { win: String(w.id) },
      /* base.css's button reset drops border+margin but not the UA's
         padding:1px 6px / text-align:center — both would inset and clip
         the clone inside .overview__item's overflow:hidden. */
      style: { left: Math.round(x) + 'px', top: Math.round(y) + 'px',
               width: Math.round(w.w * k) + 'px', height: Math.round(w.h * k) + 'px',
               padding: '0', textAlign: 'left' },
      onclick: () => { close(); wm.focus(w, { lift: true }); },
    },
      shot(w, k),
      h('div.overview__cap', icon(w.app.icon), h('span.trunc', { text: title }),
        tabs > 1 ? h('span.overview__tabs', { text: `${tabs} tabs` }) : null));
    el.addEventListener('pointerdown', e => dragWindow(e, el, w));
    return el;
  }

  /* ---------------- the desktop strip ---- */
  function wallpaperStyle(deskId) {
    /* spooky season's haunted house stands in for every wallpaper (shell/desktop.js) */
    if (document.querySelector('.wp .wp__spooky')) {
      return { background: '#140827 center bottom / cover no-repeat',
        backgroundImage: ['front', 'house', 'sky'].map(n => `url("assets/spooky/${n}.svg")`).join(',') };
    }
    const id = DESK.wallpaperOf(deskId) || store.get(WP.ACTIVE_KEY);
    const wp = WP.byId(store, id) || WP.BUILT_IN[0];
    const url = wp.poster || ((wp.kind === 'image' || wp.kind === 'gif') ? wp.url : null);
    if (url) return { backgroundImage: `url("${String(url).replace(/"/g, '%22')}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
    if (wp.kind === 'css' && wp.css) return { background: wp.css };
    return null;   /* the scene: the stylesheet's own gradient */
  }

  function thumbW() {
    const n = DESK.count() + (DESK.count() < DESK.MAX ? 1 : 0);
    const room = window.innerWidth - PAD * 2;
    return Math.max(84, Math.min(156, Math.floor((room - (n - 1) * 14) / n)));
  }

  function deskThumb(d, tw) {
    const th = Math.round(tw * window.innerHeight / window.innerWidth);
    const k = tw / window.innerWidth;
    const cur = d.id === DESK.current();
    const mine = wm.onDesktop(d.id).filter(seen).sort((a, b) => a.z - b.z);
    const minis = mine.map(w => h('div.ov-desk__win', {
      style: { left: Math.round(w.x * k) + 'px', top: Math.round(w.y * k) + 'px',
               width: Math.max(6, Math.round(w.w * k)) + 'px', height: Math.max(5, Math.round(w.h * k)) + 'px' },
    }, w.w * k > 22 ? icon(w.app.icon) : null));
    const n = wm.onDesktop(d.id).length;
    const name = h('div.ov-desk__name', { text: d.label, title: 'Double-click to rename' });
    const el = h('div.ov-desk' + (cur ? '.is-current' : ''), {
      role: 'listitem', dataset: { desk: d.id },
    },
      h('button.ov-desk__thumb', {
        style: { width: tw + 'px', height: th + 'px', ...(wallpaperStyle(d.id) || {}) },
        'aria-label': `${d.label}${cur ? ' (current)' : ''}, ${n} window${n === 1 ? '' : 's'}`,
        'aria-current': cur ? 'true' : null,
        onclick: () => { if (S.renaming) return; close(); if (!cur) wm.switchDesktop(d.id); },
        oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); deskMenu(e, d); },
      }, ...minis),
      name,
      DESK.count() > 1 ? h('button.ov-desk__x', {
        'aria-label': `Remove ${d.label}`, title: 'Remove desktop',
        onclick: e => { e.stopPropagation(); wm.removeDesktop(d.id); },
      }, icon('x')) : null);
    name.addEventListener('dblclick', e => { e.stopPropagation(); rename(d, name); });
    return el;
  }

  function addTile(tw) {
    const th = Math.round(tw * window.innerHeight / window.innerWidth);
    return h('div.ov-desk.ov-desk--add', { role: 'listitem', dataset: { desk: '+' } },
      h('button.ov-desk__thumb', {
        style: { width: tw + 'px', height: th + 'px' },
        'aria-label': 'New desktop', title: 'New desktop',
        onclick: () => { wm.addDesktop(); paintStrip(); },
      }, icon('plus')),
      h('div.ov-desk__name', { text: 'New' }));
  }

  function paintStrip() {
    const tw = thumbW();
    const rows = DESK.list().map(d => deskThumb(d, tw));
    if (DESK.count() < DESK.MAX) rows.push(addTile(tw));
    strip.replaceChildren(...rows);
  }

  function rename(d, nameEl) {
    S.renaming = d.id;
    const input = h('input.ov-desk__input', { value: d.name || d.label, 'aria-label': 'Desktop name', maxlength: '32' });
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      S.renaming = null;
      S.cancelRename = null;
      if (keep) DESK.rename(d.id, input.value);
      paintStrip();
    };
    /* Escape reaches core/layers.js first, which hands it to the overview's
       layer; while this field is open that cancels the rename, not the overview */
    S.cancelRename = () => finish(false);
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function deskMenu(e, d) {
    const own = DESK.wallpaperOf(d.id);
    const papers = WP.list(store);
    api.menu([
      { label: 'Rename…', icon: 'edit-3', onClick: () => {
        const el = strip.querySelector(`.ov-desk[data-desk="${d.id}"] .ov-desk__name`);
        if (el) rename(d, el);
      } },
      { label: 'Wallpaper', icon: 'wallpaper', items: [
        { label: 'Same as the others', checked: !own, onClick: () => { DESK.setWallpaper(d.id, null); paintStrip(); } },
        '-',
        ...papers.map(p => ({ label: p.name, checked: own === p.id, onClick: () => { DESK.setWallpaper(d.id, p.id); paintStrip(); } })),
      ] },
      '-',
      { label: 'Remove Desktop', icon: 'trash', danger: true, disabled: DESK.count() < 2,
        onClick: () => wm.removeDesktop(d.id) },
    ], e.clientX, e.clientY);
  }

  /* ---------------- dragging a window between desktops ---------------- */
  function dragWindow(e, el, w) {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, over = null, k = 0.5;
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
        dragging = true;
        /* shrink around the pointer to about a desktop thumbnail's size, so
           the desktop it is over stays in sight */
        const r = el.getBoundingClientRect();
        k = Math.min(0.6, Math.max(0.2, (thumbW() * 1.3) / (r.width || 1)));
        el.style.transformOrigin = `${sx - r.left}px ${sy - r.top}px`;
        el.classList.add('is-dragging');
        wrap.classList.add('is-dragging');
      }
      ev.preventDefault();
      el.style.transform = `translate(${dx}px,${dy}px) scale(${k})`;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.ov-desk');
      if (hit !== over) {
        over?.classList.remove('is-drop');
        over = hit && hit.dataset.desk !== w.desk ? hit : null;
        over?.classList.add('is-drop');
      }
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!dragging) return;
      wrap.classList.remove('is-dragging');
      /* the click that ends a drag is not a click on the window */
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallow, true), 300);
      const target = ev.type === 'pointerup' && over ? over.dataset.desk : null;
      over?.classList.remove('is-drop');
      let to = target === '+' ? (wm.addDesktop()?.id || null) : target;
      if (to && wm.moveToDesktop(w, to, { animate: false })) { paint(); return; }
      el.classList.remove('is-dragging');
      el.style.transform = '';
      el.style.transformOrigin = '';
    };
    const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* ---------------- layout --------------- */
  function paint() {
    paintStrip();
    api.clear(grid);
    const wins = wm.onDesktop().filter(seen);
    if (!wins.length) {
      grid.appendChild(h('div.empty', icon('layers'), h('b', { text: `No open windows on ${DESK.label(DESK.current())}` }),
        h('small', { text: 'Launch something from the dock or press ' + api.fmt.modLabel + 'K.' })));
      return;
    }

    const a = wm.workArea();
    const top = a.y + STRIP;
    const cols = colsFor(wins.length);
    const rows = Math.ceil(wins.length / cols);
    const gw = Math.max(120, a.w - PAD * 2);
    const gh = Math.max(120, a.h - STRIP - PAD - FOOT);
    const cw = (gw - GAP * (cols - 1)) / cols;
    const ch = (gh - GAP * (rows - 1)) / rows;

    wins.forEach((w, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const inRow = Math.min(cols, wins.length - row * cols);
      const band = inRow * cw + (inRow - 1) * GAP;
      const cx = a.x + PAD + (gw - band) / 2 + col * (cw + GAP);
      const cy = top + row * (ch + GAP);
      const k = Math.max(0.1, Math.min(cw / w.w, ch / w.h, 1));
      grid.appendChild(item(w, k, cx + (cw - w.w * k) / 2, cy + (ch - w.h * k) / 2));
    });
  }

  /* ---------------- open / close --------- */
  function open() {
    if (S.open) return;
    S.open = true;
    host.appendChild(wrap);
    S.release = L.push({ name: 'overview', el: wrap, trap: true, close: () => (S.cancelRename ? S.cancelRename() : close()) });
    paint();
    /* start on the window that was in front */
    const act = wm.getActive();
    (act && grid.querySelector(`.overview__item[data-win="${act.id}"]`) || grid.querySelector('.overview__item'))?.focus({ preventScroll: true });
  }
  function close() {
    if (!S.open) return;
    S.open = false;
    S.renaming = null;
    S.cancelRename = null;
    wrap.remove();
    wrap.classList.remove('is-dragging');
    api.clear(grid);
    strip.replaceChildren();
    S.release?.();
    S.release = null;
  }
  const toggle = () => (S.open ? close() : open());
  const repaint = () => { if (S.open && !S.renaming) api.raf('overview:paint', paint); };

  /* ---------------- wiring --------------- */
  const unbind = [
    bus.on('overview:toggle', toggle),
    bus.on('desktop:switch', repaint),
    bus.on('desktops:change', repaint),
    api.on(window, 'keydown', e => {
      /* ⌘` / Ctrl+` unless changed in Settings › Shortcuts (js/core/keymap.js) */
      if (KM.matches(e, 'overview')) { if (covered()) return; e.preventDefault(); toggle(); }
      /* Escape: the overview's layer (core/layers.js) — see open() */
    }, true),
    /* paint() clones every window's DOM — coalesce to one per frame */
    api.on(window, 'resize', repaint),
  ];

  return () => { unbind.forEach(off => off()); close(); };
}

export default mountOverview;
