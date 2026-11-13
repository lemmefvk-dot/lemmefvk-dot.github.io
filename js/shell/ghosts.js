/* ============================================================
   ghosts.js (shell) — the Halloween ghost hunt, on screen.

   Thirteen little ghosts hide in places people actually visit:
   the desktop, the Dock, the top bar, the Launcher, Spotlight,
   Control Centre, the Notification Centre, and the Files,
   Settings, Static Play, Browser, Music and Pumpkin Carver
   windows. js/core/ghosts.js keeps the list and the catches.

   Every hiding place is an element the shell or the window manager
   owns (a window's title bar, a panel's footer), or one an app builds
   once (Files' header bar, Settings' sidebar) — never content an app
   repaints, so a ghost stays put whatever the app shows. App windows
   get theirs as they open (win:open); panels built on demand (the
   Launcher, Spotlight, Control Centre, the Notification Centre) are
   seen by one MutationObserver, which only runs while a ghost is
   left to show. A surface that rebuilds its children (the Dock on
   every window change, Control Centre on every toggle) gets its
   ghost back in the same observer callback, before the next paint,
   so it never blinks.

   A ghost never covers a control: it takes its own place in a row
   (title bar, footer, header, sidebar, Dock) or sits in an empty
   corner — on the desktop under every icon, widget and window, so
   anything there wins; in Control Centre beside its title.

   A ghost is a real button with a name, so the keyboard and screen
   readers find it too (Spotlight lets Tab reach its footer for this).
   Click it: a little poof, it is counted once ("Ghost 4 of 13"), and
   it stays caught. Under reduced motion (prefs.reduceMotion or the
   system setting, both followed live by the CSS) ghosts hold still
   and the poof is a quick fade.

   Only while season.js spooky('ghosts') says so — in season, with
   Spooky Season and the hunt switched on. Otherwise nothing here
   touches the page.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as G from '../core/ghosts.js';
import * as HW from '../core/halloween.js';

const CSS_ID = 'feat-halloween-css';

const kid = (c, sel) => c.querySelector(`:scope > ${sel}`);
const after = (c, sel) => kid(c, sel)?.nextSibling ?? null;
/* a window on another desktop is hidden (.is-away): its ghost waits for you there */
const win = app => `.win[data-app="${app}"]:not(.is-away)`;
const titleBar = app => ({ sel: `${win(app)} > .win__bar`, before: c => kid(c, '.win__tools'), cls: 'gh--title' });

/* Where each ghost goes: its container (the first match in the OS), the
   child it sits in front of (none = at the end) and a placement class. */
const PLACES = {
  desktop: { sel: '.desktop', before: c => after(c, '.wp'), cls: 'gh--desk' },
  dock: { sel: 'nav.dock', cls: 'gh--dock' },
  topbar: { sel: 'header.topbar', before: c => kid(c, '.topbar__tray'), cls: 'gh--top' },
  launcher: { sel: 'section.launcher:not(.is-closing) > .launcher__foot', before: c => kid(c, '.launcher__acts'), cls: 'gh--row' },
  spotlight: { sel: '.spot > .spot__foot', before: c => after(c, '.grow'), cls: 'gh--row' },
  control: { sel: '.menu.cc', cls: 'gh--cc' },
  noti: { sel: '.noti > .noti__head', before: c => after(c, '.grow'), cls: 'gh--row' },
  files: { sel: `${win('files')} > .win__body > .app > .app__main > .app__bar:first-child`, before: c => after(c, '.grow'), cls: 'gh--row' },
  settings: { sel: `${win('settings')} > .win__body > .app > .app__side`, cls: 'gh--side' },
  play: titleBar('play'),
  browser: titleBar('browser'),
  music: titleBar('music'),
  pumpkin: titleBar('pumpkin'),
};

const reduced = () => !!store.get('prefs.reduceMotion')
  || document.body.classList.contains('reduce-motion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

function loadCss() {
  if (document.getElementById(CSS_ID)) return;
  document.head.appendChild(Object.assign(document.createElement('link'), { id: CSS_ID, rel: 'stylesheet', href: 'css/feat-halloween.css' }));
}

export function mountGhosts(host) {
  const { h } = api;
  const els = new Map();            /* spot id -> its button, made on first need */
  const homes = new Map();          /* spot id -> the container it was last put in */
  const wanted = new Set();         /* ids that should be on screen right now */
  const art = HW.artUrl('sticker', 'ghost');
  let timer = 0;
  let watching = false;

  function ghostEl(id) {
    const el = h('button.gh', {
      type: 'button', class: PLACES[id].cls,
      dataset: { ghost: id },
      'aria-label': 'A hiding ghost — catch it',
      title: 'Boo!',
      onclick: e => { e.stopPropagation(); caught(id, el); },
      ondblclick: e => e.stopPropagation(),
    }, h('img', { src: art, alt: '', draggable: 'false' }));
    return el;
  }

  function put(id, c) {
    let el = els.get(id);
    if (!el) { el = ghostEl(id); els.set(id, el); }
    const p = PLACES[id];
    c.insertBefore(el, p.before ? p.before(c) : null);
    homes.set(id, c);
  }

  /* ---------------- catching ---------------- */
  function poof(el) {
    /* a keyboard catch: focus goes back to the panel's field, not to nowhere */
    if (el === document.activeElement) el.closest('.spot,.launcher')?.querySelector('input')?.focus();
    el.disabled = true;
    el.classList.add('is-caught');
    const calm = reduced();
    const r = el.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    if (!calm && r.width) {
      const puff = h('div.gh-poof', { 'aria-hidden': 'true', style: { left: `${r.left - hr.left + r.width / 2}px`, top: `${r.top - hr.top + r.height / 2}px` } },
        ...[[-18, -14], [16, -16], [-14, 12], [18, 10], [0, -22]].map(([x, y]) => h('i', { style: { '--dx': `${x}px`, '--dy': `${y}px` } })));
      host.appendChild(puff);
      setTimeout(() => puff.remove(), 700);
    }
    if (typeof el.animate === 'function') {
      el.animate(calm
        ? [{ opacity: 0.5 }, { opacity: 0 }]
        : [{ opacity: 0.8, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.7) translateY(-6px)' }],
      { duration: calm ? 180 : 380, easing: 'ease-out', fill: 'forwards' });
    }
    setTimeout(() => el.remove(), calm ? 200 : 400);
  }

  function caught(id, el) {
    const r = G.find(id);
    if (!r) return;
    wanted.delete(id);
    poof(el);
    api.notify({
      app: 'Ghost hunt', icon: 'ghost', timeout: r.all ? 9000 : 5000,
      title: r.all ? `Ghost ${r.n} of ${r.total} — you found them all!` : `Ghost ${r.n} of ${r.total}`,
      message: r.all
        ? `The last one was hiding ${r.where}. Happy Halloween!`
        : `Caught ${r.where}. ${r.total - r.n} still hiding in apps, menus and corners.`,
      actions: [{ label: 'Progress', onClick: () => api.openApp('settings', { section: 'halloween' }) }],
    });
  }

  /* ---------------- placing ---------------- */
  /** The full look: is the hunt on, which ghosts are left, where can each go. */
  function place() {
    clearTimeout(timer);
    timer = 0;
    wanted.clear();
    if (!G.active()) {
      for (const el of els.values()) if (!el.classList.contains('is-caught')) el.remove();
      watch(false);
      return;
    }
    loadCss();
    const found = G.state().found;
    for (const s of G.SPOTS) {
      const el = els.get(s.id);
      if (found[s.id]) {
        if (el && !el.classList.contains('is-caught')) el.remove();
        continue;
      }
      wanted.add(s.id);
      const p = PLACES[s.id];
      if (el?.isConnected && el.parentElement.matches(p.sel)) continue;
      const c = host.querySelector(p.sel);
      if (c) put(s.id, c); else el?.remove();
    }
    watch(wanted.size > 0);
  }

  const soon = () => { if (!timer) timer = setTimeout(place, 50); };

  /* Runs before the browser paints: a ghost whose surface just rebuilt its
     children goes straight back; anything new is left to place(). */
  function onMutate() {
    for (const id of wanted) {
      const el = els.get(id);
      if (el?.isConnected) continue;
      const c = homes.get(id);
      if (c?.isConnected && c.matches(PLACES[id].sel)) put(id, c);
    }
    soon();
  }

  const mo = typeof MutationObserver === 'function' ? new MutationObserver(onMutate) : null;
  function watch(on) {
    if (!mo || on === watching) return;
    watching = on;
    if (on) mo.observe(host, { childList: true, subtree: true });
    else mo.disconnect();
  }

  /* ---------------- wiring ---------------- */
  const offs = [
    bus.on('win:open', soon),
    bus.on('desktop:switch', soon),         /* windows on the other desktops come and go */
    bus.on('win:desk', soon),
    bus.on('season:change', soon),
    store.sub('prefs', soon),               /* the hunt's switch, Spooky Season's */
    store.sub('portal.ghosts', soon),
  ];
  place();

  return () => {
    offs.forEach(off => off());
    clearTimeout(timer);
    watch(false);
    for (const el of els.values()) el.remove();
    els.clear();
    homes.clear();
    wanted.clear();
  };
}

export default mountGhosts;
