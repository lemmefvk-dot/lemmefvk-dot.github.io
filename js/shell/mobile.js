/* ============================================================
   mobile.js — StaticOS as a phone OS.

   On a phone-sized screen (760px wide or less, or a touch screen
   held sideways that is 500px tall or less) the desktop metaphor
   stops making sense, so the shell becomes a phone:

   · a status bar on top — pull it down (or tap it) for the shade:
     quick settings (the same Control Centre the desktop uses) over
     the notification list
   · a home screen — every app in a grid, a search pill, and a dock
     of four favourites (the first four apps of the desktop dock)
   · apps open full-screen, with a gesture bar under them:
       swipe up            → home
       swipe up and hold   → the app switcher
       swipe left / right  → the next / previous recent app
     and three real buttons on the same bar (recent apps, home,
     last app), so every gesture also works by tap, by keyboard
     and from a screen reader
   · an app switcher — every open app as a card: tap to open,
     swipe a card up (or press its ×) to close, Close all

   Everything is additive: body.is-mobile plus our own elements,
   all removed again on the way back to a wide screen, so the
   desktop is never mutated. Layout lives in css/feat-mobile.css,
   scoped under body.is-mobile. The window manager is untouched;
   its windows are restyled into full-screen sheets.
   ============================================================ */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { listApps, getApp } from '../core/registry.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { wm } from '../core/wm.js';
import * as L from '../core/layers.js';
import { roving } from '../core/roving.js';
import { appTile } from '../core/appart.js';

/* The stylesheet is linked from index.html; this covers a page that
   lost the <link> (an old cached index.html after an update). */
function ensureStyles() {
  if (document.querySelector('link[href*="feat-mobile.css"]')) return;
  document.head.appendChild(h('link', { id: 'feat-mobile-css', rel: 'stylesheet', href: 'css/feat-mobile.css' }));
}

/* Phone mode: narrow, or a touch screen too short for a desktop (a phone
   on its side). Kept at 760px rather than 600px: apps already key their
   narrow layouts off body.is-mobile, and 600–760px is a big phone or a
   small tablet in portrait, which wants the phone shell too. */
export const PHONE_QUERY = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)';

const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

const DOCK_N = 4;
/* inert, and marked so: js/core/cover.js wakes every shell surface up when
   the boot or lock screen goes away, except those that carry data-inert */
function setInert(el, on) {
  if (!el) return;
  el.inert = !!on;
  if (on) el.dataset.inert = 'phone'; else delete el.dataset.inert;
}
const HOLD_MS = 280;     /* a pause this long, part-way up the screen, means "show me my apps" */

export function mountMobile(host) {
  ensureStyles();

  const mq = matchMedia(PHONE_QUERY);
  const S = {
    els: [], offs: [], rove: [],
    home: null, grid: null, dock: null, bar: null, status: null,
    switcher: null, switchRelease: null,
    recents: [],                 /* window ids, most recent first */
    frozen: null,                /* { order, idx, until } while flicking between apps */
    shade: null,                 /* the notification centre element, when it is our shade */
  };
  const on = () => document.body.classList.contains('is-mobile');

  /* ---------------- the recents list ---------------- */
  function touch(w) {
    if (!w) return;
    S.recents = [w.id, ...S.recents.filter(id => id !== w.id)];
  }
  function drop(w) { S.recents = S.recents.filter(id => id !== w.id); }
  const liveRecents = () => S.recents.map(id => wm.get(id)).filter(Boolean);
  /* the order a sideways flick walks: frozen for a moment after a flick,
     so flick-flick-flick goes back through several apps instead of
     ping-ponging between the last two (as Android and iOS both do) */
  function flickOrder() {
    if (S.frozen && Date.now() < S.frozen.until) {
      const order = S.frozen.order.map(id => wm.get(id)).filter(Boolean);
      if (order.length) return { order, idx: Math.min(S.frozen.idx, order.length - 1) };
    }
    /* the pause after a run of flicks is over: the app it landed on is now
       the most recent one */
    if (S.frozen) { S.frozen = null; touch(current()); }
    const order = liveRecents();
    const act = current();
    return { order, idx: act ? Math.max(0, order.indexOf(act)) : -1 };
  }

  /* ---------------- open / home / switch ---------------- */
  const current = () => { const a = wm.getActive(); return a && !a.min ? a : null; };

  function openApp(id, from) {
    const open = wm.byApp(id);
    if (open.length) {
      const w = open.sort((a, b) => b.z - a.z)[0];
      if (w.min) wm.restore(w); else wm.focus(w);
      zoomFrom(w, from);
      return w;
    }
    S.pendingFrom = from || null;
    const w = wm.open(id);
    S.pendingFrom = undefined;
    return w;
  }
  /* Home: the app shrinks back into its icon, then every sheet is put away
     so the home screen shows. */
  function goHome() {
    closeSwitcher();
    const w = current();
    const away = () => {
      wm.list().filter(x => !x.min).forEach(x => wm.minimize(x));
      requestAnimationFrame(() => {
        if (!S.home || S.home.contains(document.activeElement)) return;
        S.grid?.querySelector('[tabindex="0"]')?.focus?.({ preventScroll: true });
      });
    };
    if (!w || reduced() || typeof w.el.animate !== 'function') { if (w) settle(w, false); away(); return; }
    const icon = S.grid?.querySelector(`.mob-app[data-app="${w.appId}"] .glyph`);
    const box = w.el.getBoundingClientRect();
    const r = icon && icon.getClientRects().length ? icon.getBoundingClientRect() : null;
    const to = r
      ? { translate: `${(r.left + r.width / 2) - (box.left + box.width / 2)}px ${(r.top + r.height / 2) - (box.top + box.height / 2)}px`, scale: String(Math.max(0.1, r.width / box.width)) }
      : { translate: '0 40%', scale: '0.5' };
    const from = { translate: w.el.style.translate || '0 0', scale: w.el.style.scale || '1', opacity: 1, borderRadius: '24px' };
    const a = w.el.animate([from, { ...to, opacity: 0, borderRadius: '28px' }], { duration: 240, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    let done = false;
    const finish = () => { if (done) return; done = true; away(); requestAnimationFrame(() => { a.cancel(); settle(w, false); }); };
    a.finished.then(finish, finish);
    setTimeout(finish, 400);
  }
  function switchTo(w, dir) {
    if (!w) return;
    if (w.min) wm.restore(w); else wm.focus(w);
    slideIn(w, dir);
  }
  /* dir +1 = an older app (finger moved right), -1 = a newer one */
  function flick(dir) {
    const { order, idx } = flickOrder();
    if (!order.length) return false;
    const j = idx + dir;
    if (j < 0 || j >= order.length) { nudge(dir); return false; }
    S.frozen = { order: order.map(w => w.id), idx: j, until: Date.now() + 3000 };
    switchTo(order[j], dir);
    const w = order[j];
    bus.emit('a11y:say', `${w.el.getAttribute('aria-label') || w.app.name}`);
    return true;
  }

  /* ---------------- motion ---------------- */
  /* individual `translate` / `scale` properties, not `transform`: the
     sheets pin transform:none !important so the wm's own minimise and
     launch animations (which aim at a dock that is not there) stay off */
  function zoomFrom(w, from) {
    if (!w || reduced() || typeof w.el.animate !== 'function') return;
    const r = from?.getBoundingClientRect?.();
    const box = w.el.getBoundingClientRect();
    const k = r ? Math.max(0.12, r.width / box.width) : 0.86;
    const dx = r ? (r.left + r.width / 2) - (box.left + box.width / 2) : 0;
    const dy = r ? (r.top + r.height / 2) - (box.top + box.height / 2) : 40;
    w.el.animate([
      { translate: `${dx}px ${dy}px`, scale: `${k}`, opacity: 0, borderRadius: '28px' },
      { translate: '0 0', scale: '1', opacity: 1, borderRadius: '0' },
    ], { duration: 300, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  function slideIn(w, dir) {
    if (reduced() || typeof w.el.animate !== 'function') return;
    w.el.animate([{ translate: `${-dir * 100}% 0` }, { translate: '0 0' }],
      { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  function nudge(dir) {
    const w = current();
    if (!w || reduced() || typeof w.el.animate !== 'function') return;
    w.el.animate([{ translate: '0 0' }, { translate: `${dir * 24}px 0` }, { translate: '0 0' }], { duration: 260, easing: 'ease-out' });
  }
  function follow(w, x, y, k) {
    if (!w) return;
    w.el.style.translate = `${x}px ${y}px`;
    w.el.style.scale = String(k);
    w.el.style.borderRadius = k < 1 ? '24px' : '';
  }
  function settle(w, animate) {
    if (!w) return;
    const from = { translate: w.el.style.translate || '0 0', scale: w.el.style.scale || '1' };
    w.el.style.translate = ''; w.el.style.scale = ''; w.el.style.borderRadius = '';
    if (animate && !reduced() && typeof w.el.animate === 'function') {
      w.el.animate([from, { translate: '0 0', scale: '1' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }

  /* ---------------- home screen ---------------- */
  const glyph = app => appTile(app);
  function appBtn(app, cls = '') {
    const b = h('button.mob-app' + cls, {
      type: 'button', 'aria-label': app.name, dataset: { app: app.id },
      onclick: () => openApp(app.id, b.querySelector('.glyph')),
    }, glyph(app), h('span.mob-app__name', { text: app.name, 'aria-hidden': 'true' }));
    return b;
  }
  function dockIds() {
    const saved = store.get('dock');
    const ids = Array.isArray(saved) ? saved : listApps().filter(a => a.dock).map(a => a.id);
    return ids.filter(id => getApp(id) && !getApp(id).hidden).slice(0, DOCK_N);
  }
  function paintHome() {
    if (!S.grid) return;
    clear(S.grid);
    for (const app of listApps()) S.grid.appendChild(appBtn(app));
    clear(S.dock);
    for (const id of dockIds()) S.dock.appendChild(appBtn(getApp(id), '.mob-app--dock'));
  }
  /* the grid's real column count, for ↑/↓ */
  const gridCols = () => {
    const kids = S.grid ? [...S.grid.children] : [];
    if (kids.length < 2) return 1;
    const top = kids[0].offsetTop;
    const n = kids.findIndex(k => k.offsetTop !== top);
    return n > 0 ? n : kids.length;
  };

  /* ---------------- status bar + shade ---------------- */
  function openShade() {
    if (S.shade) return;
    bus.emit('noti:toggle');        /* notifications.js builds it; 'noti:open' hands it to us */
  }
  function closeShade() {
    if (!S.shade) return;
    bus.emit('noti:toggle');
  }
  /* notifications.js opened its centre: on a phone it becomes the shade,
     with the Control Centre on top (painted by topbar.js) */
  function adoptShade({ el } = {}) {
    if (!on() || !el) return;
    S.shade = el;
    el.classList.add('noti--shade');
    const qs = h('div.mob-qs', { role: 'group', 'aria-label': 'Quick settings' });
    const head = h('div.mob-shade__head',
      h('div.mob-shade__time', { 'aria-hidden': 'true' }),
      h('div.grow'),
      h('button.mob-shade__btn', { type: 'button', 'aria-label': 'Close', onclick: closeShade }, icon('chevron-up')));
    paintTime(head.firstChild);
    el.prepend(head, qs);
    bus.emit('cc:render', qs);
    S.status?.setAttribute('aria-expanded', 'true');
    /* the shade itself can be pushed back up */
    swipeToClose(el);
    closeSwitcher();
  }
  function paintTime(el) {
    if (!el) return;
    const d = new Date();
    el.replaceChildren(
      h('b', { text: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }),
      h('small', { text: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) }));
  }
  function swipeToClose(el) {
    let y0 = null, id = null, dy = 0;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.target.closest('input,button,a,.noti__list,.noti__ach')) return;
      y0 = e.clientY; id = e.pointerId; dy = 0;
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== id || y0 == null) return;
      dy = Math.min(0, e.clientY - y0);
      el.style.translate = `0 ${dy}px`;
    });
    const end = e => {
      if (e.pointerId !== id || y0 == null) return;
      y0 = null;
      el.style.translate = '';
      if (dy < -60) closeShade();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /* pull the status bar down: the shade opens once the finger has come
     down far enough, and follows it while it does */
  function statusGestures(el) {
    let g = null;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      g = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, opened: false };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      const dy = e.clientY - g.y;
      if (!g.moved && Math.abs(dy) > 8) g.moved = true;
      if (!g.moved) return;
      if (dy > 24 && !g.opened) { g.opened = true; openShade(); }
      if (S.shade && g.opened) {
        const h0 = S.shade.offsetHeight || 400;
        S.shade.style.translate = `0 ${Math.min(0, dy - h0 * 0.9 + 24)}px`;
      }
    });
    const end = e => {
      if (!g || e.pointerId !== g.id) return;
      const dy = e.clientY - g.y;
      const was = g;
      g = null;
      if (S.shade) {
        S.shade.style.translate = '';
        if (was.opened && dy < 70) closeShade();
      }
      if (!was.moved && e.type === 'pointerup') { S.shade ? closeShade() : openShade(); el.dataset.tapped = '1'; }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    /* a pointer tap was handled above; Enter / Space arrive as a click */
    el.addEventListener('click', () => {
      if (el.dataset.tapped) { delete el.dataset.tapped; return; }
      S.shade ? closeShade() : openShade();
    });
  }

  /* ---------------- the gesture bar ---------------- */
  function barGestures(el) {
    let g = null;
    const H = () => window.innerHeight;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      g = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, axis: null, w: current(), still: 0, lastY: e.clientY, lastT: performance.now(), hold: false };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        g.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      }
      const now = performance.now();
      if (g.axis === 'y') {
        const up = Math.max(0, -dy);
        /* a finger that stops part-way up is asking for the switcher. A
           still finger sends no moves at all, so a timer notices the pause. */
        if (Math.abs(e.clientY - g.lastY) > 3) {
          g.lastY = e.clientY; g.lastT = now; g.hold = false;
          el.classList.remove('is-hold');
          clearTimeout(g.holdT);
          const cur = g;
          if (up > 70) g.holdT = setTimeout(() => { if (g === cur) { cur.hold = true; el.classList.add('is-hold'); } }, HOLD_MS);
        }
        if (g.w) follow(g.w, 0, -up * 0.6, Math.max(0.55, 1 - up / (H() * 0.9)));
      } else if (g.w) {
        follow(g.w, dx, 0, 1);
      }
    });
    const end = e => {
      if (!g || e.pointerId !== g.id) return;
      const was = g; g = null;
      clearTimeout(was.holdT);
      el.classList.remove('is-hold');
      if (e.type === 'pointercancel') { settle(was.w, true); return; }
      const dx = e.clientX - was.x, dy = e.clientY - was.y;
      const dt = Math.max(1, performance.now() - was.t);
      const fast = Math.hypot(dx, dy) / dt > 0.5;
      if (was.axis === 'y' && -dy > 70 && performance.now() - was.lastT >= HOLD_MS) was.hold = true;
      if (!was.axis) return;                         /* a tap: the button under it gets the click */
      el.dataset.swiped = String(Date.now());
      if (was.axis === 'y') {
        const up = -dy;
        if (was.hold || up > H() * 0.45) { settle(was.w, false); openSwitcher(); return; }
        if (up > 60 || (up > 24 && fast)) {
          if (was.w) goHome();                      /* shrinks from where the finger left it */
          else openSwitcher();                      /* on the home screen, up means recents */
          return;
        }
        settle(was.w, true);
      } else {
        const go = Math.abs(dx) > 70 || (Math.abs(dx) > 30 && fast);
        settle(was.w, !go);
        if (go) flick(dx > 0 ? 1 : -1);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    /* the click that follows a swipe is not a tap */
    el.addEventListener('click', e => {
      if (el.dataset.swiped && Date.now() - Number(el.dataset.swiped) < 400) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  /* ---------------- the app switcher ---------------- */
  function snapshot(w) {
    /* a still copy of the window, without the parts that would start again
       if cloned (frames, media) or that come out blank (canvas) */
    const clone = w.el.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('iframe,video,audio,canvas,object,embed').forEach(n => n.replaceWith(h('div.mob-card__ph')));
    clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    clone.classList.remove('is-active');
    clone.classList.add('mob-card__clone');
    clone.style.cssText = '';
    const r = w.el.getBoundingClientRect();
    clone.dataset.w = String(Math.round(r.width) || window.innerWidth);
    clone.dataset.h = String(Math.round(r.height) || Math.round(window.innerHeight * 0.85));
    return h('div.mob-card__shot', { inert: true, 'aria-hidden': 'true' }, clone);
  }
  function card(w) {
    const name = w.el.getAttribute('aria-label') || w.app.name;
    const kill = () => {
      cardEl.classList.add('is-gone');
      setTimeout(() => { wm.close(w.id); paintSwitcher(); }, reduced() ? 0 : 180);
      bus.emit('a11y:say', `${name} closed`);
    };
    const open = h('button.mob-card__open', {
      type: 'button', 'aria-label': `Open ${name}`, dataset: { win: String(w.id) },
      onclick: () => { closeSwitcher(); switchTo(w, 0); },
      onkeydown: e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); kill(); } },
    }, snapshot(w));
    const cardEl = h('div.mob-card', { role: 'listitem' },
      h('div.mob-card__head',
        appTile(w.app),
        h('span.mob-card__name', { text: name }),
        h('button.mob-card__x', { type: 'button', 'aria-label': `Close ${name}`, onclick: kill }, icon('x'))),
      open);
    /* swipe a card up (or sideways) to close it */
    let s = null;
    open.addEventListener('pointerdown', e => { s = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; });
    open.addEventListener('pointermove', e => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x, dy = Math.min(0, e.clientY - s.y);
      if (!s.moved && Math.hypot(dx, dy) < 10) return;
      s.moved = true;
      open.setPointerCapture?.(e.pointerId);
      cardEl.style.translate = `${dx}px ${dy}px`;
      cardEl.style.opacity = String(Math.max(0.2, 1 - (Math.abs(dx) + Math.abs(dy)) / 240));
    });
    const up = e => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      const moved = s.moved; s = null;
      cardEl.style.translate = ''; cardEl.style.opacity = '';
      if (!moved) return;
      open.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
      if (dy < -90 || Math.abs(dx) > 120) kill();
    };
    open.addEventListener('pointerup', up);
    open.addEventListener('pointercancel', up);
    return cardEl;
  }
  function paintSwitcher() {
    const sw = S.switcher;
    if (!sw) return;
    const list = sw.querySelector('.mob-switch__list');
    const wins = liveRecents().concat(wm.list().filter(w => !S.recents.includes(w.id)));
    clear(list);
    sw.querySelector('.mob-switch__clear').hidden = !wins.length;
    if (!wins.length) {
      list.appendChild(h('div.mob-switch__empty', icon('layers'), h('b', { text: 'No recent apps' }),
        h('small', { text: 'Apps you open show up here.' })));
      return;
    }
    for (const w of wins) list.appendChild(card(w));
    /* each snapshot is the window at full size, scaled to its card */
    for (const shot of list.querySelectorAll('.mob-card__shot')) {
      const c = shot.firstElementChild;
      const cw = Number(c.dataset.w) || 390, ch = Number(c.dataset.h) || 700;
      shot.style.aspectRatio = `${cw} / ${ch}`;
      c.style.setProperty('--cw', cw + 'px');
      c.style.setProperty('--ch', ch + 'px');
      c.style.setProperty('--k', String((shot.clientWidth || 160) / cw));
    }
    const first = list.querySelector('.mob-card__open');
    if (sw.contains(document.activeElement) && document.activeElement !== sw.querySelector('.mob-switch__clear')) return;
    first?.focus({ preventScroll: true });
  }
  function openSwitcher() {
    if (!on()) return;
    if (S.switcher) { paintSwitcher(); return; }
    closeShade();
    const sw = h('div.mob-switch', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Recent apps' },
      h('div.mob-switch__top',
        h('b', { text: 'Recent apps' }),
        h('button.btn.mob-switch__clear', { type: 'button', onclick: () => { wm.list().forEach(w => wm.close(w.id)); closeSwitcher(); bus.emit('a11y:say', 'All apps closed'); } },
          icon('x'), h('span', { text: 'Close all' }))),
      h('div.mob-switch__list', { role: 'list', 'aria-label': 'Open apps' }));
    sw.addEventListener('click', e => { if (e.target === sw || e.target.classList.contains('mob-switch__list')) closeSwitcher(); });
    host.appendChild(sw);
    S.switcher = sw;
    document.body.classList.add('mob-switching');
    S.switchRelease = L.push({ name: 'switcher', el: sw, trap: true, close: closeSwitcher });
    S.rove.push(roving(sw.querySelector('.mob-switch__list'), { items: '.mob-card__open', orientation: 'both' }));
    paintSwitcher();
    S.bar?.querySelector('.mob-nav__recents')?.setAttribute('aria-expanded', 'true');
  }
  function closeSwitcher() {
    if (!S.switcher) return;
    S.switcher.remove();
    S.switcher = null;
    document.body.classList.remove('mob-switching');
    S.switchRelease?.();
    S.switchRelease = null;
    S.bar?.querySelector('.mob-nav__recents')?.setAttribute('aria-expanded', 'false');
  }

  /* ---------------- banners ----------------
     A notification drops in at the top; flick it up (or sideways) to put
     it away, as on a phone. It stays in the shade either way. */
  function toastSwipes() {
    let t = null;
    const down = e => {
      const el = on() && e.target.closest?.('.toast');
      /* the banner's body is itself a button (it opens what it is about);
         its × and action buttons are not swipe handles */
      if (!el || e.target.closest('.toast__x,.toast__acts,a,input')) return;
      t = { el, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    };
    const move = e => {
      if (!t || e.pointerId !== t.id) return;
      const dx = e.clientX - t.x, dy = Math.min(0, e.clientY - t.y);
      if (!t.moved && Math.hypot(dx, dy) < 8) return;
      t.moved = true;
      t.el.style.translate = `${dx}px ${dy}px`;
      t.el.style.opacity = String(Math.max(0.2, 1 - (Math.abs(dx) - dy) / 200));
    };
    const up = e => {
      if (!t || e.pointerId !== t.id) return;
      const dx = e.clientX - t.x, dy = e.clientY - t.y;
      const { el, moved } = t; t = null;
      el.style.translate = ''; el.style.opacity = '';
      if (!moved) return;                                  /* a tap: the banner's own click */
      if (dy < -36 || Math.abs(dx) > 90) el.querySelector('.toast__x')?.click();
      /* the click that ends a swipe must not also open the notification */
      const block = ev => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener('click', block, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', block, true), 400);
    };
    host.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }
  const offToasts = toastSwipes();

  /* ---------------- state ---------------- */
  function sync() {
    const cur = current();
    document.body.classList.toggle('mob-has-win', !!cur);
    setInert(S.home, !!cur);          /* behind a full-screen app: out of Tab order and the a11y tree */
    setInert(S.dock, !!cur);
    const last = S.bar?.querySelector('.mob-nav__last');
    if (last) {
      const { order, idx } = flickOrder();
      const target = order[idx + 1] || (!cur && order[0]) || null;
      last.disabled = !target;
      last.setAttribute('aria-label', target ? `Switch to ${target.el.getAttribute('aria-label') || target.app.name}` : 'Switch to the last app');
    }
    if (S.switcher) paintSwitcher();
  }

  /* ---------------- build / teardown ---------------- */
  function build() {
    /* home */
    const search = h('button.mob-search', { type: 'button', onclick: () => bus.emit('spotlight:open', '') },
      icon('search'), h('span', { text: 'Search apps, files and games' }));
    S.grid = h('div.mob-home__grid', { role: 'group', 'aria-label': 'Apps' });
    S.home = h('section.mob-home', { 'aria-label': 'Home screen' }, search, S.grid);
    S.dock = h('nav.mob-dock', { 'aria-label': 'Favourites' });

    /* status bar hit area (over the top bar, which goes inert on a phone) */
    S.status = h('button.mob-status', {
      type: 'button', 'aria-label': 'Notifications and quick settings', 'aria-expanded': 'false', 'aria-haspopup': 'dialog',
    });
    statusGestures(S.status);

    /* gesture bar */
    const recents = h('button.mob-nav__btn.mob-nav__recents', { type: 'button', 'aria-label': 'Recent apps', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => (S.switcher ? closeSwitcher() : openSwitcher()) }, icon('layers'));
    const home = h('button.mob-nav__home', { type: 'button', 'aria-label': 'Home', onclick: goHome }, h('span.mob-nav__pill', { 'aria-hidden': 'true' }));
    const last = h('button.mob-nav__btn.mob-nav__last', { type: 'button', 'aria-label': 'Switch to the last app', onclick: () => { if (!flick(1) && !current()) { const w = liveRecents()[0]; if (w) switchTo(w, 1); } } }, icon('repeat'));
    S.bar = h('nav.mob-nav', { 'aria-label': 'Navigation — swipe up for home, sideways to switch apps' }, recents, home, last);
    barGestures(S.bar);

    host.append(S.home, S.dock, S.status, S.bar);
    S.els = [S.home, S.dock, S.status, S.bar];
    paintHome();
    S.rove.push(roving(S.grid, { items: '.mob-app', orientation: 'grid', columns: gridCols }));
    S.rove.push(roving(S.dock, { items: '.mob-app', orientation: 'horizontal' }));
  }

  function enable() {
    if (on()) return;
    document.body.classList.add('is-mobile');
    build();
    /* the desktop's top bar is only a status bar here: our hit area above it
       is the one control, so its own buttons leave the Tab order. The shell
       mounts in parallel, so the bar may not exist yet — wait for it. */
    const markTop = () => { const tb = host.querySelector('.topbar'); setInert(tb, true); return !!tb; };
    if (!markTop()) {
      const mo = new MutationObserver(() => { if (markTop()) mo.disconnect(); });
      mo.observe(host, { childList: true });
      S.waitTop = () => mo.disconnect();
    }
    S.recents = wm.stacked().filter(w => !w.min).map(w => w.id);
    S.offs = [
      bus.on('win:open', w => {
        touch(w);
        S.frozen = null;
        zoomFrom(w, S.pendingFrom || null);
        S.pendingFrom = undefined;
        closeSwitcher();
        closeShade();
        sync();
      }),
      bus.on('win:focus', w => { if (w && !(S.frozen && Date.now() < S.frozen.until)) touch(w); sync(); }),
      bus.on('win:close', w => { drop(w); sync(); }),
      bus.on('win:list', sync),
      bus.on('win:minimize', sync),
      bus.on('win:restore', sync),
      bus.on('noti:open', adoptShade),
      bus.on('noti:closed', () => { S.shade = null; S.status?.setAttribute('aria-expanded', 'false'); }),
      bus.on('apps:ready', paintHome),
      store.sub('dock', paintHome),
      bus.on('tick:5s', () => { if (S.shade) paintTime(S.shade.querySelector('.mob-shade__time')); }),
      bus.on('power:lock', () => { closeShade(); closeSwitcher(); }),
      bus.on('mobile:switcher', openSwitcher),
      bus.on('mobile:home', goHome),
    ];
    sync();
  }

  function disable() {
    if (!on()) return;
    closeSwitcher();
    closeShade();
    document.body.classList.remove('is-mobile', 'mob-has-win', 'mob-switching');
    S.offs.forEach(off => off()); S.offs = [];
    S.rove.forEach(off => off()); S.rove = [];
    S.els.forEach(el => el.remove()); S.els = [];
    S.home = S.grid = S.dock = S.bar = S.status = null;
    S.waitTop?.(); S.waitTop = null;
    const tb = host.querySelector('.topbar');
    setInert(tb, false);
    /* a sheet that was mid-gesture keeps no inline motion */
    wm.list().forEach(w => { w.el.style.translate = ''; w.el.style.scale = ''; w.el.style.borderRadius = ''; });
  }

  const apply = () => (mq.matches ? enable() : disable());
  /* Safari <14 only has the deprecated listener API. */
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else mq.addListener(apply);
  apply();

  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', apply); else mq.removeListener(apply);
    disable();
    offToasts();
  };
}

export default mountMobile;
