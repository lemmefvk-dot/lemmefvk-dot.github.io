/* ============================================================
   tour.js — the guided tour: a short walk round the real desktop.

   It runs on its own once, right after first-run setup
   (js/shell/onboarding.js says 'onboarding:done'), and any time from
   Help › Take the Tour or Settings › Desktop (bus 'tour:start').

   Each step dims everything except one real element (a cut-out in the
   dimmed backdrop, measured from the element itself, so it follows a
   resize) and puts a caption beside it with Back, Next and Skip.
     → ↓ Enter   next          ← ↑   back          Esc   end
   A step whose element is not on screen is left out (no window open,
   one desktop only…), and a phone gets its own, shorter tour of the
   parts a phone has.

   Start-up order (the whole chain, in main.js order):
     1. first-run setup   2. this tour   3. the video card and What's New
     (js/shell/introvideo.js, whatsnew-sheet.js)   4. a tip (tips.js)
   The tour holds cover('tour') while it is up, which the later ones
   already wait on (they all stand down while covered()), and it never
   starts under the lock screen or the boot screens: it waits for them.

   session.toured is set as the automatic run starts, so a tab closed
   half-way through is not asked again.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { cover, covered } from '../core/cover.js';
import * as L from '../core/layers.js';
import { globalRows, keysText } from '../core/keymap.js';
import { hasIcon } from '../core/icons.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-tour-css')) {
  const l = document.createElement('link');
  l.id = 'feat-tour-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-tour.css';
  document.head.appendChild(l);
}

const KEY = 'session.toured';
const PAD = 6;                 /* breathing room around the element, px */

/* a shortcut as this computer writes it, and as this person has it (Settings › Shortcuts) */
const key = label => {
  const r = globalRows().find(x => x.label === label || x.label.startsWith(label));
  return r ? keysText(r.keys.split(' / ')[0]) : null;
};

export const DESKTOP_STEPS = [
  { id: 'topbar', sel: '.topbar', title: 'The top bar',
    text: () => 'Menus for the app in front on the left, the clock in the middle, and quick controls on the right: sound, network, Control Centre and more.' },
  { id: 'dock', sel: '.dock', title: 'The dock',
    text: () => 'Your favourite apps. Click one to open it, drag icons to reorder them, and a dot shows what is running.' },
  { id: 'launcher', sel: '.dock__item[data-app="launcher"]', title: 'The launcher',
    text: () => `Every app in one place, with your recent files.${key('Open the launcher') ? ` From the keyboard: ${key('Open the launcher')}.` : ''}` },
  { id: 'spotlight', sel: '.topbar__menu [data-key="Help"]', title: 'Search',
    text: () => `${key('Static Search') || 'Search'} finds apps, files, settings and games, and answers sums and unit conversions. It is also in the Help menu.` },
  { id: 'windows', sel: '.win:not(.is-min) .light--max', title: 'Windows and snapping',
    text: () => `Hover this green button for snap layouts, or press ${key('Snap layouts for the front window') || 'the snap shortcut'}. Drag a window to a screen edge to snap it.` },
  { id: 'desktops', sel: '.tray-btn[data-pop="desk"], .topbar__menu [data-key="View"]', title: 'Desktops',
    text: () => `Keep different jobs on different desktops. ${key('Window overview') || 'The overview'} shows every window and lets you add a desktop (View › Show Overview).` },
  { id: 'notifications', sel: '.tray-btn[data-tip="Notifications"], .tray-btn[data-tip="Do Not Disturb"]', title: 'Notification centre',
    text: () => 'Alerts land here, with an Achievements tab. Do Not Disturb silences most pop-ups but keeps the list.' },
  { id: 'settings', sel: '.dock__item[data-app="settings"]', title: 'Settings',
    text: () => 'Accent colour, wallpaper, dock, shortcuts, accessibility, Screen Time and more. You can run this tour again from there.' },
  { id: 'play', sel: '.dock__item[data-app="play"]', title: 'Static Play',
    text: () => 'The home for your games: pick up where you left off, discover something new, or let Quick Play choose.' },
];

export const PHONE_STEPS = [
  { id: 'm-home', sel: '.mob-home__grid', title: 'Your apps',
    text: () => 'Tap an app to open it. It fills the screen, like on any phone.' },
  { id: 'm-search', sel: '.mob-search', title: 'Search',
    text: () => 'Search apps, files and games from the home screen.' },
  { id: 'm-dock', sel: '.mob-dock', title: 'Favourites',
    text: () => 'Your favourite apps stay in reach at the bottom of the home screen.' },
  { id: 'm-status', sel: '.mob-status', title: 'Notifications and quick settings',
    text: () => 'Tap the top of the screen, or swipe down from it, for notifications, sound and brightness.' },
  { id: 'm-nav', sel: '.mob-nav', title: 'Getting around',
    text: () => 'Swipe up from the bar for Home, swipe sideways to switch apps, and the left button shows your recent apps.' },
];

const usable = el => {
  if (!el || !el.isConnected) return false;
  const r = rectOf(el);
  if (r.width < 2 || r.height < 2) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  return getComputedStyle(el).visibility !== 'hidden';
};

/** What of an element can be seen: its box cut by every scrolling or clipping
    ancestor (a long list inside a scroller shows only its window). */
export function rectOf(el) {
  const r = el.getBoundingClientRect();
  let l = r.left, t = r.top, rr = r.right, b = r.bottom;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
    const c = p.getBoundingClientRect();
    l = Math.max(l, c.left); t = Math.max(t, c.top); rr = Math.min(rr, c.right); b = Math.min(b, c.bottom);
  }
  return { left: l, top: t, right: Math.max(l, rr), bottom: Math.max(t, b), width: Math.max(0, rr - l), height: Math.max(0, b - t) };
}

/** The element a step points at, or null when it is not on screen now. */
export function find(step, root = document) {
  for (const el of root.querySelectorAll(step.sel)) if (usable(el)) return el;
  return null;
}

export const isPhone = () => document.body.classList.contains('is-mobile');
export const stepsNow = () => (isPhone() ? PHONE_STEPS : DESKTOP_STEPS).filter(s => find(s));

export function mountTour(host) {
  const { h, icon } = api;
  const ico = n => icon(hasIcon(n) ? n : 'sparkles');
  let run = null;        /* the tour on screen, if any */
  let waitTimer = 0, dead = false;

  const blocked = () => covered() || !!document.querySelector('.lock, .bp, .bootos, .boot');

  /** Start the tour — now, or as soon as no lock or boot screen is up. */
  function start({ auto = false } = {}) {
    if (dead || run) return false;
    if (auto) store.set(KEY, true);
    clearTimeout(waitTimer);
    const attempt = () => {
      waitTimer = 0;
      if (dead || run) return;
      if (blocked()) { waitTimer = setTimeout(attempt, 600); return; }
      begin();
    };
    attempt();
    return true;
  }

  function begin() {
    if (isPhone()) bus.emit('mobile:home');
    bus.emit('launcher:close');
    const phone = isPhone();
    /* let the home screen / a closing panel settle before measuring */
    setTimeout(() => { if (!dead && !run) open(phone); }, phone ? 380 : 120);
  }

  function open(phone) {
    let list = stepsNow();
    if (!list.length) return;
    let at = 0;
    let raf = 0, ro = null;
    const offs = [];
    let ended = false;

    const title = h('h2.tour__t', { id: 'tour-title' });
    const text = h('p.tour__p', { id: 'tour-text' });
    const count = h('span.tour__n', { 'aria-live': 'polite' });
    const back = h('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Back', onclick: () => go(at - 1) });
    const next = h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => go(at + 1) });
    const skip = h('button.tour__skip', { type: 'button', text: 'Skip', 'aria-label': 'Skip the tour', onclick: () => end() });
    const card = h('div.tour__card', {
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title', 'aria-describedby': 'tour-text', tabindex: '-1',
    },
      h('div.tour__head', h('span.tour__ico', ico('compass')), count, h('div.grow'), skip),
      title, text,
      h('div.tour__foot', back, h('div.grow'), next));
    const hole = h('div.tour__hole', { 'aria-hidden': 'true' });
    const root = h('div.tour' + (phone ? '.tour--phone' : ''), hole, card);
    root.dataset.step = '';

    const release = L.push({ name: 'tour', el: card, trap: true, close: () => end() });
    cover('tour', true);
    host.appendChild(root);

    function place() {
      raf = 0;
      if (ended) return;
      const s = list[at];
      const el = s && find(s);
      if (!el) {
        /* what it pointed at is gone (a window closed, the viewport changed shape) */
        if (isPhone() !== phone) { end({ quiet: true }); return; }
        list = list.filter((x, i) => i !== at && find(x));
        if (!list.length) { end({ quiet: true }); return; }
        at = Math.min(at, list.length - 1);
        paint();
        return;
      }
      const r = rectOf(el);
      const vw = innerWidth, vh = innerHeight;
      const x = Math.max(0, r.left - PAD), y = Math.max(0, r.top - PAD);
      const w = Math.min(vw, r.right + PAD) - x, hh = Math.min(vh, r.bottom + PAD) - y;
      Object.assign(hole.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });

      const cw = Math.min(340, vw - 24);
      card.style.width = cw + 'px';
      const ch = card.offsetHeight;
      const gap = 14;
      let cy;
      if (y + hh + gap + ch <= vh - 8) cy = y + hh + gap;                 /* below */
      else if (y - gap - ch >= 8) cy = y - gap - ch;                      /* above */
      else cy = Math.max(8, vh - ch - 16);                                /* over a big target: bottom of the screen */
      let cx = x + w / 2 - cw / 2;
      cx = Math.max(12, Math.min(cx, vw - cw - 12));
      card.style.left = Math.round(cx) + 'px';
      card.style.top = Math.round(cy) + 'px';
    }
    const queue = () => { if (!raf && !ended) raf = requestAnimationFrame(place); };

    function paint() {
      const s = list[at];
      title.textContent = s.title;
      text.textContent = s.text();
      count.textContent = `${at + 1} of ${list.length}`;
      back.style.visibility = at ? 'visible' : 'hidden';
      next.textContent = at === list.length - 1 ? 'Done' : 'Next';
      root.dataset.step = s.id;
      ro?.disconnect();
      const el = find(s);
      if (el && typeof ResizeObserver === 'function') { ro = new ResizeObserver(queue); ro.observe(el); }
      place();
    }

    function go(to) {
      if (to >= list.length) { end(); return; }
      at = Math.max(0, to);
      paint();
      /* keep the caret where a keyboard user left it: on the button they used */
      if (!card.contains(document.activeElement)) next.focus({ preventScroll: true });
    }

    function end({ quiet = false } = {}) {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      offs.splice(0).forEach(off => { try { off(); } catch (e) {} });
      run = null;
      root.classList.add('is-out');
      const gone = () => root.remove();
      if (document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) gone();
      else setTimeout(gone, 180);
      /* uncover first: the layer can only hand focus back to something that is no longer inert */
      cover('tour', false);
      release();
      if (!document.activeElement || document.activeElement === document.body) bus.emit('a11y:refocus');
      if (!quiet) bus.emit('tour:done');
    }

    const onKey = e => {
      if (ended || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); go(at + 1); next.focus({ preventScroll: true }); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); go(at - 1); next.focus({ preventScroll: true }); }
      else if (e.key === 'Enter' && !(e.target && e.target.closest && e.target.closest('button'))) { e.preventDefault(); e.stopPropagation(); go(at + 1); next.focus({ preventScroll: true }); }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', queue);
    offs.push(
      () => window.removeEventListener('keydown', onKey, true),
      () => window.removeEventListener('resize', queue),
      /* a click on the dimmed part is not a click on the desktop under it */
    );

    run = { end, root, card, get step() { return list[at]?.id; }, get steps() { return list.map(s => s.id); } };
    paint();
    next.focus({ preventScroll: true });
    bus.emit('tour:open');
  }

  const offs = [
    bus.on('tour:start', () => start()),
    /* first-run setup is done: this is the next thing, a moment after its card leaves */
    bus.on('onboarding:done', () => {
      if (store.get(KEY, false)) return;
      setTimeout(() => start({ auto: true }), 500);
    }),
  ];

  return () => {
    dead = true;
    clearTimeout(waitTimer);
    offs.forEach(off => { try { off?.(); } catch (e) {} });
    run?.end({ quiet: true });
  };
}

export default mountTour;
