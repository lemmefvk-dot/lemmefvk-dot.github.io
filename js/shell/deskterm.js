/* ============================================================
   deskterm.js — the Linux wallpaper terminal.

   StaticOS has exactly one terminal, and it lives on the desktop of
   the Linux drive. There is no Terminal window any more: the app is
   registered hidden (js/apps/terminal.js) purely so its engine — the
   whole staticsh shell over the vfs — can be mounted here, into the
   wallpaper, through a stand-in for the window object.

   Where it sits: a layer appended LAST inside .desktop (above the
   wallpaper, the Linux skin and the icons; below widgets, windows,
   the dock). Never inside .os-skin — that is aria-hidden, takes no
   pointer events, and is only visible on the default wallpaper. The
   terminal shows on the Linux drive whatever the wallpaper, and gets
   a dark scrim when the wallpaper is not the Linux skin.

   Opening "terminal" from anywhere (a menu, a command, Spotlight,
   Staticum) goes through wm.open, which is redirected here: on Linux
   it focuses this terminal and applies cwd/run; elsewhere it says
   where the terminal lives and opens nothing.

   Keyboard: while you type here no window is active (wm.blur), and
   keys stop at this layer so window shortcuts (⌘W) and app handlers
   (Files' Backspace) never act on a window behind. ⌘Tab still cycles
   windows; Esc leaves the terminal.

   Not on phones: the mobile home screen covers the desktop, so there
   the Linux drive simply has no terminal.
   ============================================================ */
import { h } from '../core/dom.js';
import { getApp } from '../core/registry.js';
import * as wm from '../core/wm.js';
import { bus } from '../core/bus.js';

/* the neofetch art for this drive: Tux, not the StaticOS diamond */
const TUX = [
  '        .--.',
  '       |o_o |',
  '       |:_/ |',
  '      //   \\ \\',
  '     (|     | )',
  "    /'\\_   _/`\\",
  '    \\___)=(___/',
];

/* neofetch's colour row: the eight ANSI colours, as a real terminal shows */
const ANSI = ['#1d1f21', '#cc342b', '#198844', '#fba922', '#3971ed', '#a36ac7', '#3fb2b8', '#c5c8c6'];

let wanted = false;      /* the Linux drive is active */
let host = null;         /* .desk-term, created once */
let off = null;          /* the engine's teardown while mounted */
let shim = null;         /* the stand-in window the engine talks to */
let respawnTimer = 0;
let iconsObs = null;
let lastNotice = 0;
let atBottom = true;     /* was the scrollback pinned to the prompt? */

const isMobile = () => document.body.classList.contains('is-mobile');

/** true while the wallpaper terminal is mounted and usable */
export const available = () => !!off;

/* ---------- the engine, through a stand-in window ------------------- */
function mountEngine(opts = {}) {
  const app = getApp('terminal');
  if (!app || !host) return false;
  if (off) unmountEngine();      /* never orphan a running engine's listeners */
  const hooks = { focus: [], reopen: [], blur: [], close: [] };
  shim = {
    appId: 'terminal', embedded: true, el: host, state: {}, hooks,
    setTitle() {}, setSubtitle() {}, setLead() {}, setTools() {}, setBarClass() {},
    onClose: f => hooks.close.push(f), onResize() {}, onBlur: f => hooks.blur.push(f),
    onFocus: f => hooks.focus.push(f),
    onReopen: f => hooks.reopen.push(f),
    /* `exit` and ⌃D on an empty line: log out and start a fresh session —
       the wallpaper itself never closes */
    close: () => respawn(),
  };
  host.replaceChildren();
  try {
    const t = app.mount({
      root: host, win: shim,
      opts: { embedded: true, who: 'static@linux', art: TUX, palette: ANSI, ...opts },
      api: window.StaticAPI,
    });
    off = typeof t === 'function' ? t : () => {};
    return true;
  } catch (err) {
    console.error('[deskterm] the terminal engine failed to mount', err);
    off = null;
    host.replaceChildren();
    return false;
  }
}

function unmountEngine() {
  clearTimeout(respawnTimer);
  if (shim) shim.hooks.close.forEach(f => { try { f(); } catch (e) {} });
  try { off?.(); } catch (err) { /* already gone */ }
  off = null;
  shim = null;
}

function respawn() {
  clearTimeout(respawnTimer);
  const had = host?.contains(document.activeElement);
  unmountEngine();
  host?.replaceChildren(h('div.desk-term__bye', { text: 'logout' }));
  respawnTimer = setTimeout(() => {
    if (!wanted || !host?.isConnected || off) return;   /* enable() may have remounted already */
    mountEngine();
    /* take focus back only if the person has not moved on meanwhile */
    const idle = !document.activeElement || document.activeElement === document.body;
    if (had && idle && !wm.getActive()) host.querySelector('.term__in input')?.focus();
  }, 700);
}

/* ---------- placement ------------------------------------------------
   Left edge: just right of the desktop icon grid, which grows a column at
   a time as files land on the Desktop — but never so far that the terminal
   drops under the widget rail; it overlaps the last icon columns instead.
   Right edge: clear of whatever actually occupies the right-hand column
   (the widget rail, or the sign-in card), else the screen edge. */
const MIN_W = 320;
function place() {
  if (!host) return;
  const desk = document.querySelector('.desktop');
  if (!desk) return;
  const d = desk.getBoundingClientRect();
  const icons = desk.querySelector('.desk-icons');
  const ir = icons?.getBoundingClientRect();
  const rail = [...document.querySelectorAll('.widgets, .wg-lock')]
    .map(el => el.getBoundingClientRect())
    .find(r => r.width > 0 && r.height > 0);
  const right = rail ? Math.round(d.right - rail.left) + 24 : 24;
  const wantLeft = ir && ir.width ? Math.round(ir.right - d.left) + 28 : 124;
  const left = Math.max(16, Math.min(wantLeft, Math.round(d.width - right - MIN_W)));
  host.style.setProperty('--dt-left', `${left}px`);
  host.style.setProperty('--dt-right', `${right}px`);
}

function track() {
  iconsObs?.disconnect();
  if (typeof ResizeObserver !== 'function') { place(); return; }
  iconsObs = new ResizeObserver(() => {
    place();
    /* keep the prompt in view when the box changes size */
    const out = host?.querySelector('.term__out');
    if (out && atBottom) out.scrollTop = out.scrollHeight;
  });
  const icons = document.querySelector('.desktop .desk-icons');
  if (icons) iconsObs.observe(icons);
  for (const el of document.querySelectorAll('.widgets, .wg-lock')) iconsObs.observe(el);
  iconsObs.observe(host);
  place();
}

/* ---------- in front of windows, or behind them ---------------------
   It lives in the wallpaper, under every window. When it is called (an
   "Open in Terminal", a click on it) it comes forward over the windows
   with a solid backing, and goes back down when a window is picked or Esc
   is pressed — so it is never typed into while hidden. */
function raise() {
  const os = document.getElementById('os');
  if (!host || !os || host.classList.contains('is-raised')) return;
  const hadFocus = host.contains(document.activeElement);
  const input = hadFocus ? document.activeElement : null;
  os.appendChild(host);
  host.classList.add('is-raised');
  if (input && !host.contains(document.activeElement)) input.focus({ preventScroll: true });
}

function lower() {
  const desk = document.querySelector('.desktop');
  if (!host || !desk || !host.classList.contains('is-raised')) return;
  host.classList.remove('is-raised');
  desk.appendChild(host);
}

/* ---------- on / off ------------------------------------------------- */
function enable() {
  const desk = document.querySelector('.desktop');
  if (!desk) return;
  if (!host) host = buildHost();
  if (!host.isConnected) desk.appendChild(host);   /* last child: above icons */
  document.body.classList.add('has-deskterm');
  track();
  clearTimeout(respawnTimer);                      /* a pending logout is superseded */
  if (!off) mountEngine();
}

function disable() {
  unmountEngine();
  iconsObs?.disconnect();
  iconsObs = null;
  if (host?.contains(document.activeElement)) document.activeElement.blur();
  host?.classList.remove('is-raised');
  host?.remove();
  document.body.classList.remove('has-deskterm');
}

function sync() {
  const on = wanted && !isMobile();
  if (on) enable();
  else if (host?.isConnected || off) disable();
}

/** Called by bootpicker.applyOS on every drive change (and on every
    wallpaper change, so it must be cheap and idempotent). */
export function setDrive(id) {
  wanted = id === 'linux';
  sync();
}

/* ---------- the layer ------------------------------------------------ */
function buildHost() {
  const el = h('div.desk-term', {
    role: 'region', 'aria-label': 'Terminal',
    /* right-click inside keeps the browser's own menu (copy / paste) —
       honoured by the global contextmenu handler in main.js */
    'data-native-menu': '',
  });
  /* typing here must not drive a window behind the wallpaper; a click on
     it also brings it forward, as it would a window */
  el.addEventListener('pointerdown', () => { wm.blur(); raise(); });
  el.addEventListener('focusin', () => { wm.blur(); el.classList.add('is-focus'); });
  el.addEventListener('focusout', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('is-focus'); });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      document.activeElement?.blur?.();
      lower();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Tab') return;                            /* window cycling */
    if (mod && e.ctrlKey && (e.key === 'q' || e.key === 'Q')) return;  /* lock screen */
    e.stopPropagation();
  });
  /* is the scrollback pinned to the prompt? (scroll does not bubble) */
  el.addEventListener('scroll', e => {
    const o = e.target;
    if (o.classList?.contains('term__out')) atBottom = o.scrollHeight - o.clientHeight - o.scrollTop < 24;
  }, true);
  return el;
}

/* A short glow when something asks for the terminal — it may be under
   windows, and this says where it is. */
function call() {
  if (!host) return;
  host.classList.remove('is-called');
  void host.offsetWidth;
  host.classList.add('is-called');
  setTimeout(() => host?.classList.remove('is-called'), 1200);
}

/* ---------- every open('terminal') lands here ------------------------ */
wm.redirectApp('terminal', opts => {
  if (!off || !shim) {
    if (Date.now() - lastNotice < 5000) return null;   /* one notice, not a stack */
    lastNotice = Date.now();
    bus.emit('noti:push', {
      app: 'Terminal', icon: 'terminal', timeout: 5000,
      title: 'The terminal lives on Linux',
      message: isMobile() && wanted
        ? 'It is part of the Linux desktop, which a phone-sized screen does not show.'
        : 'Boot the Linux drive (Settings › Desktop › Startup) — it is right on the wallpaper.',
    });
    return null;
  }
  raise();      /* never focus a shell the person cannot see */
  shim.hooks.reopen.forEach(fn => { try { fn(opts || {}); } catch (err) { console.error(err); } });
  call();
  return shim;
});

/* A window picked (title bar, ⌘Tab, the dock) takes the keyboard back and
   the terminal returns behind the windows. wm.blur() emits null — ignore. */
bus.on('win:focus', w => {
  if (!w || !host) return;
  if (host.contains(document.activeElement)) document.activeElement.blur();
  lower();
});
/* the right-hand column comes and goes with sign-in and the widget pref */
bus.on('state:change', path => {
  if (host?.isConnected && /^(prefs(\.widgetsVisible)?|session(\.user)?)$/.test(path)) requestAnimationFrame(place);
});
window.addEventListener('resize', () => { if (host?.isConnected) place(); });

/* The phone layout comes and goes with the window size (mobile.js toggles
   body.is-mobile); follow it. */
if (typeof MutationObserver === 'function' && document.body) {
  let was = isMobile();
  new MutationObserver(() => {
    const now = isMobile();
    if (now !== was) { was = now; sync(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

export default { setDrive, available };

