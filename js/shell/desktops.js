/* ============================================================
   desktops.js (shell) — getting around the desktops.

   The model is js/core/desktops.js and the windows move in
   js/core/wm.js; this is the part you touch:

     ⌃← / ⌃→          previous / next desktop (not while typing,
                      where they jump between words)
     ⌃⌘← / ⌃⌘→        the same, and the pair a Mac lets through
     ⌃⌥⇧← / ⌃⌥⇧→      take the front window to the desktop beside
                      this one, and go with it (works while typing:
                      no layout types anything with those). Past the
                      last desktop this makes a new one.
     ⌃↑               the overview, with the desktop strip
     trackpad         a two-finger sideways swipe over the bare
                      desktop follows your fingers; let go past a
                      fifth of the screen (or flick) to go there
     touch            the same with one finger on the bare desktop
     HUD              a moment's strip of names after each switch

   The overview's strip (shell/overview.js) is where desktops are
   added, renamed, removed and given their own wallpaper, and where
   windows are dragged from one desktop to another.
   ============================================================ */
import { bus } from '../core/bus.js';
import { h } from '../core/dom.js';
import { covered } from '../core/cover.js';
import * as wm from '../core/wm.js';
import * as DESK from '../core/desktops.js';
import * as KM from '../core/keymap.js';

/* a widget that moves with ⌃ arrows itself (Static Sheets' grid jumps to the
   edge of the data) says so with data-own-arrows, and counts as typing */
const typingIn = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
  || !!el.closest?.('[data-own-arrows]'));
const mobile = () => document.body.classList.contains('is-mobile');
const overviewOpen = () => !!document.querySelector('#os > .overview');

export function mountDesktops(host) {
  /* ---------------- the HUD -------------- */
  const hud = h('div.desk-hud', { role: 'status', 'aria-live': 'polite' });
  host.appendChild(hud);
  let hudT = 0;
  function showHud() {
    if (overviewOpen()) return;          /* the strip there already says where you are */
    const cur = DESK.current();
    hud.replaceChildren(...DESK.list().map(d =>
      h('span.desk-hud__pill' + (d.id === cur ? '.is-on' : ''), { text: d.label })));
    hud.setAttribute('aria-label', `${DESK.label(cur)}, ${DESK.indexOf(cur) + 1} of ${DESK.count()}`);
    hud.classList.add('is-on');
    clearTimeout(hudT);
    hudT = setTimeout(() => hud.classList.remove('is-on'), 1100);
  }

  /* At either end there is nowhere to go: the windows give a little and
     come back, so the key press visibly did something. */
  function nudge(dir) {
    if (document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const w of wm.onDesktop()) {
      if (w.min || typeof w.el.animate !== 'function') continue;
      w.el.animate([
        { transform: 'none' },
        { transform: `translateX(${-dir * 26}px)`, offset: 0.35 },
        { transform: 'none' },
      ], { duration: 300, easing: 'cubic-bezier(.3,.7,.4,1)' });
    }
  }

  /* ---------------- keys ----------------- */
  /* the keys are the person's own (Settings › Shortcuts): js/core/keymap.js */
  const dirOf = (e, back, fwd) => (KM.matches(e, back) ? -1 : KM.matches(e, fwd) ? 1 : 0);
  function onKey(e) {
    if (covered()) return;
    /* ⌃⌘← / ⌃⌘→ too: a Mac keeps ⌃← / ⌃→ for its own Spaces unless that
       shortcut is turned off, so this pair is the one that reaches the page
       there (on Windows ⌃⊞ arrows are the system's, and ⌃← / ⌃→ arrive) */
    let arrow = dirOf(e, 'desk.prevMac', 'desk.nextMac');
    if (arrow) {
      if (DESK.count() < 2) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!wm.switchBy(arrow)) nudge(arrow);
      return;
    }
    if (KM.matches(e, 'overview.desks') && !typingIn(document.activeElement)) {
      e.preventDefault(); e.stopImmediatePropagation();
      bus.emit('overview:toggle');
      return;
    }
    arrow = dirOf(e, 'desk.takeLeft', 'desk.takeRight');
    if (arrow) {
      if (DESK.count() < 2 && !wm.getActive()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const w = wm.getActive();
      let to = DESK.neighbour(DESK.current(), arrow);
      if (!to && arrow > 0 && w && DESK.count() < DESK.MAX) to = DESK.add()?.id || null;
      if (!to) { nudge(arrow); return; }
      if (w) wm.moveToDesktop(w, to, { follow: true }); else wm.switchDesktop(to);
      return;
    }
    arrow = dirOf(e, 'desk.prev', 'desk.next');
    if (!arrow || typingIn(document.activeElement)) return;
    /* with one desktop there is nowhere to go — leave the keys to the app */
    if (DESK.count() < 2) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!wm.switchBy(arrow)) nudge(arrow);
  }

  /* ---------------- trackpad ------------- */
  const onBare = t => !!t && !!t.closest && !!t.closest('.desktop')
    && !t.closest('.desk-term, .dw-layer, .desk-icon, input, textarea, select, [contenteditable]');
  const onOverview = t => !!t && !!t.closest && !!t.closest('.overview') && !t.closest('input, textarea');

  let wheel = null;   /* one gesture: { mode, drag, dx, vx, t, timer, done } */
  function endWheel() {
    const g = wheel;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.mode === 'follow' && !g.done) { g.done = true; g.drag.end(g.vx); }
    /* the rest of this gesture (macOS keeps sending momentum for a while)
       is swallowed, so one swipe is one switch */
    g.timer = setTimeout(() => { if (wheel === g) wheel = null; }, 260);
    g.ended = true;
  }
  function onWheel(e) {
    if (e.ctrlKey || covered() || mobile()) return;
    const g = wheel;
    if (g && g.ended) {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) e.preventDefault();
      clearTimeout(g.timer);
      g.timer = setTimeout(() => { if (wheel === g) wheel = null; }, 260);
      return;
    }
    const bare = onBare(e.target), ov = !bare && onOverview(e.target);
    if (!g && !bare && !ov) return;
    if (DESK.count() < 2) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
    const px = e.deltaX * unit;
    if (!g && (Math.abs(px) < 1 || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.3)) return;   /* a vertical scroll */
    e.preventDefault();          /* and no browser back / forward swipe */
    /* the event's own time, not when this handler got to run: on a busy
       computer events queue up and arrive together, and gaps measured on
       arrival made a slow swipe look like a flick */
    const now = e.timeStamp || performance.now();
    const cur = g || (wheel = { mode: ov ? 'step' : 'follow', drag: ov ? null : wm.deskDrag(), dx: 0, vx: 0, t: 0, timer: 0 });
    /* fingers moving left scroll right: the desktop on the right comes in */
    cur.dx -= px;
    /* speed (px/ms) from the gaps between events — the first has no gap to measure */
    if (cur.t) cur.vx = cur.vx * 0.6 + (-px / Math.max(4, now - cur.t)) * 0.4;
    cur.t = now;
    clearTimeout(cur.timer);
    if (cur.mode === 'step') {
      if (Math.abs(cur.dx) > 60) { wm.switchBy(cur.dx < 0 ? 1 : -1); endWheel(); return; }
    } else {
      cur.drag.move(cur.dx);
      /* far enough: go now rather than waiting out the momentum */
      if (Math.abs(cur.dx) > cur.drag.width * 0.4) { endWheel(); return; }
    }
    cur.timer = setTimeout(endWheel, 130);
  }

  /* ---------------- touch ---------------- */
  function onPointerDown(e) {
    if (e.pointerType !== 'touch' || !e.isPrimary || covered() || mobile()) return;
    if (!onBare(e.target) || DESK.count() < 2) return;
    const sx = e.clientX, sy = e.clientY, id = e.pointerId;
    let drag = null, lastX = sx, lastT = e.timeStamp || performance.now(), vx = 0;
    const move = ev => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!drag) {
        if (Math.abs(dy) > 28 && Math.abs(dy) > Math.abs(dx)) { done(); return; }   /* not a sideways swipe */
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        drag = wm.deskDrag();
      }
      const now = ev.timeStamp || performance.now();      /* when the finger moved (see onWheel) */
      const dt = Math.max(1, now - lastT);
      vx = vx * 0.5 + ((ev.clientX - lastX) / dt) * 0.5;
      lastX = ev.clientX; lastT = now;
      drag.move(dx);
    };
    const up = ev => {
      if (ev.pointerId !== id) return;
      done();
      if (drag) {
        drag.end(ev.type === 'pointercancel' ? 0 : vx);
        /* the tap that ends a swipe is not a click on the wallpaper */
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 400);
      }
    };
    const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
    function done() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* ---------------- wiring --------------- */
  window.addEventListener('keydown', onKey, true);
  host.addEventListener('wheel', onWheel, { passive: false });
  host.addEventListener('pointerdown', onPointerDown);
  const offs = [
    bus.on('desktop:switch', showHud),
  ];
  return () => {
    window.removeEventListener('keydown', onKey, true);
    host.removeEventListener('wheel', onWheel);
    host.removeEventListener('pointerdown', onPointerDown);
    offs.forEach(off => off());
    clearTimeout(hudT);
    hud.remove();
  };
}

export default mountDesktops;
