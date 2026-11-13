/* ============================================================
   a11y.js — the desktop without a mouse.

   Everything the pointer can do to the shell has a keyboard path
   here or in the surface itself:

   · skip links — the first Tab stops on the page jump straight to
     the front window, the dock, the top bar or the desktop
   · a live region — bus 'a11y:say' speaks a short sentence to a
     screen reader (window opened, moved, snapped…)
   · the window menu — the app icon in every title bar, a right-click
     on the title bar, or Ctrl+Alt+Space: restore/maximise, minimise,
     keep on top, Move, Size, snap, a window's tabs, close. Move and
     Size take the arrow keys (Shift = bigger steps), Enter keeps the
     change, Escape puts the window back
   · Ctrl+Alt+P — keep the front window on top of the others (again:
     stop)
   · Ctrl+Alt+. / Ctrl+Alt+, — next / previous window (the browser
     keeps Ctrl+Tab for its own tabs, so that binding never arrives)
   · Ctrl+Alt+O — the window overview; Ctrl+Alt+A — the launcher
   · Shift+F10 — the context menu of whatever has focus (the menu
     key does this natively)
   · desktop icons open with Enter and move with the arrows
   · when the front window closes and focus would fall to <body>,
     it goes to the next window, else the dock

   Escape-closes-the-topmost and focus return live in
   js/core/layers.js; arrows inside the dock, launcher and lists in
   js/core/roving.js.
   ============================================================ */
import { covered } from '../core/cover.js';
import { bus } from '../core/bus.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as wm from '../core/wm.js';
import * as L from '../core/layers.js';
import { roving } from '../core/roving.js';
import * as KM from '../core/keymap.js';
import * as TABS from '../core/wintabs.js';

const isPhone = () => document.body.classList.contains('is-mobile');

export function mountA11y(host) {
  const { h, on } = api;
  const offs = [];

  /* ---------------- which input is in use ----------------
     html[data-input] = keyboard | pointer, for focus styles that should
     only show to someone using the keyboard (see css/feat-a11y.css) */
  const root = document.documentElement;
  offs.push(on(window, 'keydown', e => {
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    if (root.dataset.input !== 'keyboard') root.dataset.input = 'keyboard';
  }, true));
  offs.push(on(window, 'pointerdown', () => { if (root.dataset.input !== 'pointer') root.dataset.input = 'pointer'; }, true));

  /* ---------------- the live region ---------------- */
  const live = h('div.sr#a11y-live', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  host.appendChild(live);
  let sayT = 0;
  function say(text) {
    if (!text) return;
    /* clear first, then write on the next frame: the same sentence twice
       in a row ("moved", "moved") is still announced twice */
    live.textContent = '';
    clearTimeout(sayT);
    sayT = setTimeout(() => { live.textContent = String(text); }, 60);
  }
  offs.push(bus.on('a11y:say', say));

  /* ---------------- skip links ---------------- */
  /* the roving item first, else the first item (querySelector with a
     selector list returns document order, so ask one at a time) */
  const pick = (...sels) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.getClientRects().length && !el.closest('[inert]')) return el;   /* inert can't take focus */
    }
    return null;
  };
  const focusDock = () => {
    const d = isPhone()
      ? pick('.mob-home__grid [tabindex="0"]', '.mob-home__grid button', '.mob-nav__home')   /* under an app: the gesture bar */
      : pick('.dock .dock__item[tabindex="0"]', '.dock .dock__item');
    if (d) { d.focus(); return true; }
    return false;
  };
  const focusWindow = () => {
    /* only a window on this desktop: focusing one on another desktop
       switches to it (js/core/wm.js), which closing a window must not do */
    const here = new Set(wm.onDesktop());
    const w = wm.getActive() || wm.stacked().find(x => !x.min && here.has(x));
    if (!w) return false;
    if (w !== wm.getActive()) wm.focus(w);
    wm.focusInto(w);
    return true;
  };
  const focusBar = () => {
    const m = isPhone() ? pick('.mob-status') : pick('.topbar__menu [tabindex="0"]', '.topbar__menu button', '.topbar__brand');
    if (m) { m.focus(); return true; }
    return false;
  };
  const desktopEl = () => document.querySelector('.desktop');
  const focusDesktop = () => {
    const d = desktopEl();
    if (!d) return false;
    const icon = pick('.desktop .desk-icon[tabindex="0"]', '.desktop .desk-icon');
    if (icon) { icon.focus(); return true; }
    d.focus();
    return true;
  };

  const skip = (label, fn) => h('a.skip', {
    href: '#', text: label,
    onclick: e => { e.preventDefault(); if (!fn()) say(`Nothing to go to: ${label.replace(/^Skip to /, '')}`); },
  });
  const skips = h('nav.skips', { 'aria-label': 'Skip links' },
    skip('Skip to the front window', focusWindow),
    skip('Skip to the dock', focusDock),
    skip('Skip to the top bar', focusBar),
    skip('Skip to the desktop', focusDesktop));
  host.prepend(skips);

  /* the desktop can take focus (from the skip link) so Shift+F10 / the
     menu key opens its menu: wallpaper, widgets, overview */
  function prepDesktop() {
    const d = desktopEl();
    if (!d || d.dataset.a11y) return;
    d.dataset.a11y = '1';
    d.tabIndex = -1;
    d.setAttribute('role', 'region');
    d.setAttribute('aria-label', 'Desktop');
    const icons = d.querySelector('.desk-icons');
    if (icons) offs.push(roving(icons, { items: '.desk-icon', orientation: 'both' }));
  }
  prepDesktop();
  offs.push(bus.on('apps:ready', prepDesktop));

  /* desktop icons are buttons whose click selects and double-click opens;
     Enter is the keyboard's double-click */
  offs.push(on(host, 'keydown', e => {
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey) return;
    const icon = e.target.closest?.('.desk-icon');
    if (!icon) return;
    e.preventDefault();
    icon.click();
    icon.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  }));

  /* ---------------- Shift+F10 = the context menu ----------------
     Capture phase: an open layer (the launcher) keeps its keys to itself
     on the way back up (core/layers.js), and its items have menus too. */
  offs.push(on(window, 'keydown', e => {
    if (!(e.key === 'F10' && e.shiftKey) || covered()) return;
    const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : desktopEl();
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const r = t.getBoundingClientRect();
    t.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2,
      clientX: Math.round(r.left + Math.min(16, r.width / 2)), clientY: Math.round(r.top + Math.min(r.height, 24)),
    }));
  }, true));

  /* ---------------- the window menu ---------------- */
  /* the keys as this person has them (Settings › Shortcuts) */
  const kh = id => KM.hint(id) || undefined;
  const pin = w => {
    if (!w || isPhone()) return;
    wm.setPinned(w, !w.pinned);
    const name = w.el.getAttribute('aria-label') || w.app.name;
    say(w.pinned ? `${name} kept on top` : `${name} no longer kept on top`);
  };
  /* at: { x, y } — a right-click on the title bar opens it at the pointer */
  function windowMenu(w, anchor, at) {
    if (!w) return;
    const r = (anchor || w.el.querySelector('.win__menu') || w.el).getBoundingClientRect();
    const name = w.el.getAttribute('aria-label') || w.app.name;
    const tabs = TABS.tabsOf(w).length;
    api.menu([
      { label: w.max ? 'Restore' : 'Maximize', icon: w.max ? 'minimize-2' : 'maximize-2', hint: kh('win.max'), onClick: () => { wm.toggleMax(w); say(w.max ? `${name} maximized` : `${name} restored`); } },
      { label: 'Minimize', icon: 'minus', onClick: () => { wm.minimize(w); say(`${name} minimized`); } },
      { label: 'Keep on Top', icon: 'pin', checked: !!w.pinned, hint: kh('win.pin'), disabled: isPhone(), onClick: () => pin(w) },
      '-',
      { label: 'Move', icon: 'move', disabled: isPhone(), onClick: () => startMode(w, 'move') },
      { label: 'Size', icon: 'maximize', disabled: isPhone() || w.app.win.resizable === false, onClick: () => startMode(w, 'size') },
      '-',
      { label: 'Snap Left', icon: 'sidebar', hint: kh('snap.left'), disabled: isPhone(), onClick: () => { wm.snap(w, 'left'); say(`${name} snapped left`); } },
      { label: 'Snap Right', icon: 'sidebar', hint: kh('snap.right'), disabled: isPhone(), onClick: () => { wm.snap(w, 'right'); say(`${name} snapped right`); } },
      '-',
      ...(tabs > 1 ? [
        { label: 'Next Tab', icon: 'chevron-right', hint: KM.keysText('Ctrl+Tab'), onClick: () => TABS.step(w, 1) },
        { label: 'Move Tab to New Window', icon: 'external-link', onClick: () => TABS.detach(w) },
        '-',
      ] : []),
      { label: tabs > 1 ? 'Close Tab' : 'Close', icon: 'x', danger: true, hint: kh('win.close.alt'), onClick: () => wm.close(w.id) },
    ], Math.round(at ? at.x : r.left), Math.round(at ? at.y : r.bottom + 4), { label: `${name} window` });
  }
  offs.push(bus.on('win:menu', ({ win, anchor, x, y } = {}) => windowMenu(win, anchor, Number.isFinite(x) ? { x, y } : null)));
  /* a right-click on a title bar or a tab (not on its buttons or fields):
     the same menu, at the pointer — for a tab, that tab's window */
  offs.push(on(host, 'contextmenu', e => {
    if (e.defaultPrevented) return;
    const t = e.target;
    const bar = t.closest?.('.win__bar, .win-tabs');
    if (!bar || t.closest('input, textarea, select, a, [contenteditable], .seg, .tabs, button:not(.win-tab)')) return;
    const tab = t.closest('.win-tab');
    const el = (tab ? null : bar.closest('.win'));
    const w = tab ? wm.get(Number(tab.dataset.win)) : el ? wm.get(Number(el.dataset.win)) : null;
    if (!w) return;
    e.preventDefault();
    windowMenu(w, null, { x: e.clientX, y: e.clientY });
  }));

  /* ---------------- keyboard move / size ---------------- */
  let mode = null;   /* { w, kind, start, hint, release } */
  function startMode(w, kind) {
    endMode(true);
    if (!w || w.min) return;
    wm.focus(w);
    const hint = h('div.win-kbd', { 'aria-hidden': 'true' },   /* say() reads it out instead */
      h('b', { text: kind === 'move' ? 'Move' : 'Size' }),
      h('span', { text: 'arrow keys · Shift for bigger steps · Enter to keep · Esc to undo' }));
    w.el.appendChild(hint);
    w.el.classList.add('is-kbd');
    mode = { w, kind, start: { ...w.rect }, hint };
    mode.release = L.push({ name: 'win:' + kind, el: w.el, close: () => endMode(false) });
    say(`${kind === 'move' ? 'Moving' : 'Resizing'} ${w.el.getAttribute('aria-label') || w.app.name}. Arrow keys, Enter to keep, Escape to undo.`);
  }
  function endMode(keep) {
    if (!mode) return;
    const m = mode;
    mode = null;
    if (!keep && m.w.el.isConnected) wm.setRect(m.w, m.start);
    m.hint.remove();
    m.w.el.classList.remove('is-kbd');
    m.release?.({ restoreFocus: false });
    if (m.w.el.isConnected) wm.focusInto(m.w);
    say(keep ? `${m.kind === 'move' ? 'Position' : 'Size'} kept` : 'Undone');
  }
  offs.push(on(window, 'keydown', e => {
    if (!mode) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.preventDefault(); e.stopImmediatePropagation();
      const step = e.shiftKey ? 64 : 16;
      if (mode.kind === 'move') wm.moveBy(mode.w, d[0] * step, d[1] * step);
      else wm.resizeBy(mode.w, d[0] * step, d[1] * step);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); endMode(true); return; }
    if (e.key === 'Tab') { endMode(true); }
  }, true));
  offs.push(on(window, 'pointerdown', () => { if (mode) endMode(true); }, true));
  offs.push(bus.on('win:close', w => { if (mode && mode.w === w) endMode(false); }));

  /* ---------------- shortcuts ---------------- */
  offs.push(on(window, 'keydown', e => {
    if (covered()) return;
    /* AltGr arrives as Ctrl+Alt on Windows, and on many layouts it types
       letters (Polish ó and ą are AltGr+O and AltGr+A). The browser says
       which it was, and js/core/keymap.js never takes AltGr for a shortcut.
       So these work from inside a text field too — a keyboard user typing
       in Notes still needs a way to the next window — without ever eating
       a character. The keys are the person's own (Settings › Shortcuts). */
    if (KM.matches(e, 'win.menu')) { e.preventDefault(); windowMenu(wm.getActive()); return; }
    const step = KM.matches(e, 'win.next') ? 1 : KM.matches(e, 'win.prev') ? -1 : 0;
    if (step) {
      e.preventDefault();
      wm.cycle(step);
      const w = wm.getActive();
      if (w) say(w.el.getAttribute('aria-label') || w.app.name);
      return;
    }
    if (KM.matches(e, 'overview.alt')) { e.preventDefault(); bus.emit('overview:toggle'); return; }
    if (KM.matches(e, 'win.pin')) { e.preventDefault(); pin(wm.getActive()); return; }
    if (KM.matches(e, 'launcher')) { e.preventDefault(); bus.emit('launcher:toggle'); }
  }));

  /* ---------------- announcements + focus fix-up ---------------- */
  /* the app's name: a window's title can be a folder or a file name */
  const nameOf = w => (w && (w.app?.name || w.el.getAttribute('aria-label'))) || 'Window';
  offs.push(bus.on('win:open', w => say(`${nameOf(w)} opened`)));
  offs.push(bus.on('win:close', w => {
    say(`${nameOf(w)} closed`);
    /* after the window's own close handlers and the wm's refocus: if focus
       fell to <body>, put it somewhere useful */
    setTimeout(() => {
      const a = document.activeElement;
      /* the closing window stays in the page for its exit animation, so
         focus still "inside" it is as good as lost */
      if (a && a !== document.body && a.isConnected && !w.el.contains(a)) return;
      if (L.depth()) return;
      focusWindow() || focusDock();
    }, 0);
  }));
  /* a surface that closed with focus inside it asks for focus to go home */
  offs.push(bus.on('a11y:refocus', () => setTimeout(() => {
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected && !a.closest('.is-out')) return;
    focusWindow() || focusDock();
  }, 0)));
  offs.push(bus.on('win:minimize', w => {
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== document.body && a.isConnected && !w.el.contains(a)) return;
      focusWindow() || focusDock();
    }, 0);
  }));

  return () => {
    offs.forEach(off => off());
    endMode(false);
    skips.remove();
    live.remove();
  };
}

export default mountA11y;
