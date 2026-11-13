/* ============================================================
   winter.js — the moving parts of winter (December 1 – January 1).

   js/core/season.js decides WHEN (and whether Settings › Winter
   is on); css/feat-winter.css paints the warm accent and the snowy
   village wallpaper; the Christmas countdown is a seasonal desktop
   widget (shell/deskwidgets.js). This module does the rest:

   · snow falling over the wallpaper: one canvas, kept by
     shell/seasonfx.js — it exists only in season with the switch
     on and without reduced motion, and draws only while the tab is
     visible, outside Game Mode, with wallpaper motion on;
   · the advent calendar (js/core/winter.js keeps the doors): the
     gift in the dock opens a panel of 24 doors. Today's door and
     the ones before it open; tomorrow's stay shut. Each gives its
     treat on the spot, with a button that puts it to use.

   Outside the season nothing here is on the page.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as L from '../core/layers.js';
import * as SEASON from '../core/season.js';
import * as WINTER from '../core/winter.js';
import * as HW from '../core/halloween.js';
import { seasonCanvas } from './seasonfx.js';

/* the doors' places on the calendar: shuffled, as on a real one */
export const LAYOUT = [7, 15, 1, 22, 10, 18, 3, 13, 24, 5, 20, 9, 16, 2, 12, 19, 6, 23, 11, 4, 17, 8, 21, 14];

const rnd = (a, b) => a + Math.random() * (b - a);

export function mountWinter(host) {
  const { h, icon } = api;
  const offs = [];

  /* ================================================================
     snow
     ================================================================ */
  const snow = { w: 0, h: 0, flakes: [], crystal: null, wind: 0, windT: 0 };

  /* a six-armed crystal, drawn once per canvas and stamped for the big flakes */
  function makeCrystal(dpr) {
    const S = Math.round(24 * dpr);
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    g.scale(S / 24, S / 24);
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.lineWidth = 1.4;
    g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      g.save();
      g.rotate((Math.PI / 3) * i);
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(0, -10);
      g.moveTo(0, -5); g.lineTo(-3, -8); g.moveTo(0, -5); g.lineTo(3, -8);
      g.stroke();
      g.restore();
    }
    return c;
  }

  function flake(anywhere) {
    const depth = Math.random();                 /* 0 far … 1 near */
    const big = depth > 0.93;
    return {
      x: rnd(-20, snow.w + 20),
      y: anywhere ? rnd(-20, snow.h) : rnd(-60, -8),
      r: big ? rnd(5, 8) : 0.7 + depth * 2.6,
      vy: 16 + depth * 48,                       /* px per second: the near ones fall faster */
      sway: rnd(6, 22) * (0.4 + depth), swayHz: rnd(0.08, 0.3), phase: rnd(0, Math.PI * 2),
      alpha: big ? rnd(0.65, 0.9) : 0.35 + depth * 0.55,
      big, spin: rnd(-0.6, 0.6), rot: rnd(0, Math.PI),
      depth,
    };
  }

  const weather = seasonCanvas(host, {
    className: 'winter-fx',
    wanted: () => SEASON.winter('effects'),
    start() { snow.flakes = []; snow.wind = 0; snow.windT = 0; },
    resize(S) {
      snow.w = S.w; snow.h = S.h;
      snow.crystal = makeCrystal(S.dpr);
      const want = Math.round(Math.max(50, Math.min(150, (snow.w * snow.h) / 9000)));
      while (snow.flakes.length < want) snow.flakes.push(flake(true));
      snow.flakes.length = want;
    },
    draw(g, dt) {
      /* a slow breeze that comes and goes */
      snow.windT += dt;
      snow.wind = Math.sin(snow.windT * 0.13) * 14 + Math.sin(snow.windT * 0.041) * 10;
      g.fillStyle = '#fff';
      for (const p of snow.flakes) {
        p.phase += dt * p.swayHz * Math.PI * 2;
        p.y += p.vy * dt;
        p.x += snow.wind * (0.3 + p.depth) * dt;
        if (p.y > snow.h + 12 || p.x < -40 || p.x > snow.w + 40) Object.assign(p, flake(false));
        const x = p.x + Math.sin(p.phase) * p.sway;
        g.globalAlpha = p.alpha;
        if (p.big) {
          p.rot += p.spin * dt;
          g.save();
          g.translate(x, p.y);
          g.rotate(p.rot);
          g.drawImage(snow.crystal, -p.r * 1.6, -p.r * 1.6, p.r * 3.2, p.r * 3.2);
          g.restore();
        } else {
          g.beginPath();
          g.arc(x, p.y, p.r, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
    stop() { snow.flakes = []; snow.crystal = null; },
  });

  /* ================================================================
     the advent calendar
     ================================================================ */
  let panel = null;
  let release = null;
  let shown = 0;                  /* the door whose treat is on show below the grid */
  const grid = h('div.advent__grid', { role: 'group', 'aria-label': 'Doors 1 to 24' });
  const got = h('div.advent__got', { 'aria-live': 'polite' });
  const sub = h('small.advent__sub');

  const dayName = n => new Date(new Date().getFullYear(), 11, n).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  /* what a treat does, as a button */
  function useButton(t) {
    const btn = (ic, label, fn) => h('button.btn.btn--sm.btn--primary.advent__use', { type: 'button', onclick: fn }, icon(ic), label);
    switch (t.type) {
      case 'wallpaper': return btn('image', 'Use as wallpaper', () => { WINTER.useWallpaper(t.id); paintGot(); });
      case 'cursor': return store.get('prefs.cursorSkin') === t.id
        ? btn('mouse-pointer', 'Take it off', () => { WINTER.setCursor('none'); paintGot(); })
        : btn('mouse-pointer', 'Wear it', () => { WINTER.setCursor(t.id); paintGot(); });
      case 'sticker': return btn('sparkles', 'Put it on the desktop', () => { HW.placeSticker(t.id); });
      case 'sound': return store.get('prefs.notiTone') === t.id
        ? btn('bell', 'Use the usual sound', () => { WINTER.setTone('none'); paintGot(); })
        : btn('bell', 'Use for notifications', () => { WINTER.setTone(t.id); paintGot(); });
      default: return null;
    }
  }

  function paintGot() {
    if (!shown || !WINTER.isOpen(shown)) {
      got.replaceChildren(h('p.advent__hint', { text: 'One door a day, by this computer’s date. Every treat stays yours after the season, in Settings › Winter.' }));
      return;
    }
    const t = WINTER.doorTreat(shown);
    got.replaceChildren(
      h('img.advent__art', { src: WINTER.artUrl(t.type, t.id), alt: '' }),
      h('div.advent__what',
        h('b', { text: `Door ${t.n}: ${t.name}` }),
        h('small', { text: `A ${WINTER.TYPE_LABEL[t.type]}, yours to keep — it works all year.` }),
        h('div.advent__acts',
          useButton(t),
          t.type === 'sound' ? h('button.btn.btn--sm', { type: 'button', onclick: () => import('../core/sfx.js').then(m => { m.unlock(); m.previewTone(t.id); }).catch(() => {}) }, icon('play'), 'Hear it') : null)));
  }

  function paintDoors() {
    const now = new Date();
    const upTo = WINTER.openUpTo(now);
    const today = WINTER.todaysDoor(now);
    const left = SEASON.christmas(now);
    sub.textContent = today && !WINTER.isOpen(today)
      ? `Door ${today} is ready to open.`
      : !left.passed ? `${left.days >= 2 ? `${left.days} days to Christmas` : left.days === 1 ? '1 day to Christmas' : 'Christmas starts at midnight'}. ${WINTER.openedCount()} of 24 doors open.`
        : `${WINTER.openedCount()} of 24 doors open.`;
    grid.replaceChildren(...LAYOUT.map(n => {
      const open = WINTER.isOpen(n);
      const locked = n > upTo;
      const t = WINTER.doorTreat(n);
      const label = open ? `Door ${n}, open: ${t.name}`
        : locked ? `Door ${n}, opens ${dayName(n)}`
          : n === today ? `Door ${n}, today’s door — open it` : `Door ${n} — open it`;
      return h('button.advent__door', {
        type: 'button',
        class: [open ? 'is-open' : '', locked ? 'is-locked' : '', n === today ? 'is-today' : '', n === shown ? 'is-shown' : ''].filter(Boolean).join(' ') || null,
        dataset: { door: String(n) },
        'aria-label': label,
        'aria-disabled': locked ? 'true' : null,
        title: locked ? `Opens ${dayName(n)}` : null,
        onclick: () => knock(n),
      },
        open ? h('img', { src: WINTER.artUrl(t.type, t.id), alt: '' }) : null,
        h('span.advent__n', { text: String(n) }),
        locked ? h('span.advent__lock', { 'aria-hidden': 'true' }, icon('lock')) : null);
    }));
  }

  function knock(n) {
    const r = WINTER.openDoor(n);
    if (r.kind === 'locked') {
      sub.textContent = `Door ${n} opens ${dayName(n)} — no peeking.`;
      grid.querySelector(`[data-door="${n}"]`)?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
        { duration: document.body.classList.contains('reduce-motion') ? 0 : 260 });
      return;
    }
    if (r.kind === 'closed' || r.kind === 'none') { close(); return; }
    shown = n;
    paintDoors();
    paintGot();
    grid.querySelector(`[data-door="${n}"]`)?.focus();
  }

  function open() {
    if (!SEASON.winter('advent')) return;
    if (panel) { close(); return; }
    const today = WINTER.todaysDoor();
    shown = today && WINTER.isOpen(today) ? today : 0;
    panel = h('div.advent', {
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'advent-title',
      onclick: e => { if (e.target === panel) close(); },
    },
      h('div.advent__card',
        h('div.advent__head',
          h('span.advent__badge', { 'aria-hidden': 'true' }, icon('gift')),
          h('div.advent__t', h('b#advent-title', { text: 'Advent calendar' }), sub),
          h('button.ibtn.advent__x', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x'))),
        grid,
        got));
    paintDoors();
    paintGot();
    host.appendChild(panel);
    release = L.push({ name: 'advent', el: panel, trap: true, close: () => close() });
    requestAnimationFrame(() => {
      const first = grid.querySelector('.advent__door.is-today:not(.is-open)') || grid.querySelector('.advent__door:not(.is-locked):not(.is-open)') || grid.querySelector('.advent__door');
      first?.focus();
    });
  }

  function close() {
    if (!panel) return;
    panel.remove();
    panel = null;
    const r = release; release = null;
    r?.();
  }

  /* ================================================================
     wiring
     ================================================================ */
  const sync = () => {
    weather.sync();
    if (panel && !SEASON.winter('advent')) close();
  };
  sync();
  offs.push(
    bus.on('winter:advent', open),
    bus.on('season:change', sync),
    store.sub('prefs', sync),
    store.sub('portal.winter', () => { if (panel) { paintDoors(); paintGot(); } }),
    /* the person's own cursor or tone changed elsewhere: the button follows */
    store.sub('prefs.cursorSkin', () => { if (panel) paintGot(); }),
    store.sub('prefs.notiTone', () => { if (panel) paintGot(); }),
  );

  return () => {
    offs.forEach(f => { try { f(); } catch (e) {} });
    weather.destroy();
    close();
  };
}

export default mountWinter;
