/* ============================================================
   celebrate.js — New Year's, birthdays, Valentine's and spring.

   js/core/season.js decides WHEN (and whether Settings ›
   Celebrations has each one on); js/core/celebrate.js keeps what
   has already played this year. This module draws, on ONE canvas
   (shell/seasonfx.js, the machine winter's snow and spooky's
   leaves use), so four seasons never fight over the page:

     fireworks   New Year's, at midnight on January 1, once
     confetti    your birthday, once, on the day
     hearts      February 1–14, drifting up over the wallpaper
     blossoms    March and April, cherry blossoms drifting down

   WHO WINS when dates overlap — one rule, everywhere:
     1. a one-shot (fireworks, then confetti) takes the canvas; the
        slow weather underneath it (hearts, blossoms) is not drawn
        while it plays and carries on where it was afterwards;
     2. fireworks beat confetti: if both are due (a birthday on
        January 1) the confetti waits its turn, it is not lost;
     3. a one-shot is claimed (js/core/celebrate.js) the moment it
        starts, so a reload, a second tick or a clock set back
        never plays it twice;
     4. winter's snow is its own canvas and is left alone — it is
        weather, not an event, and the show plays over it.

   Other things this module owns:
   · the New Year countdown: the last ten minutes, in a pill at
     the top of the desktop, from the device clock only. It never
     counts up: a clock set back hides it until the moment passes.
   · the birthday card, once a year, claimed when it first shows
     (so a reload doesn't bring it back) and closable;
   · under reduced motion a STILL stands in for every animation: a
     frozen scatter of hearts or blossoms, a frozen burst or a
     frozen spill of confetti, drawn from the same shapes;
   · no canvas and no frame outside the days: seasonfx removes the
     canvas when nothing is wanted.

   Nothing here touches the network. The birthday is
   prefs.birthday ('MM-DD', no year) and stays on this device.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as SEASON from '../core/season.js';
import * as CEL from '../core/celebrate.js';
import { seasonCanvas, reducedMotion } from './seasonfx.js';

/* shapes, in a 24-unit box centred on 0,0 — canvas (Path2D) and the SVG stills share them */
export const HEART = 'M0 8 C-13 -1 -9.5 -11 -4.6 -9.6 C-2.2 -8.8 -0.7 -7 0 -5.6 C0.7 -7 2.2 -8.8 4.6 -9.6 C9.5 -11 13 -1 0 8Z';
export const PETAL = 'M0 0 C-4.6 -3 -5.6 -9.4 -2.4 -11.4 L0 -9.4 L2.4 -11.4 C5.6 -9.4 4.6 -3 0 0Z';
const HEARTS = ['#ff5fa2', '#ff8fb8', '#ff3d85', '#ffc2d9'];
const PINKS = ['#ffd1e0', '#ffb7cf', '#fff0f5', '#ffc4d8'];
const CONFETTI = ['#ff5fa2', '#ffd24a', '#4ad8c4', '#7a8bff', '#ff8a4a', '#9be15d', '#ffffff'];
const SPARKS = ['#ffd24a', '#ff6a5c', '#7ad0ff', '#c58bff', '#8dffb0', '#ffffff', '#ff9ad0'];

const FAST = Math.max(1, Math.min(20, Number(globalThis.__STATICOS_FX_SPEED) || 1));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
/* a small seeded generator: the stills must look the same every time */
const seeded = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export function mountCelebrate(host) {
  const { h } = api;
  const offs = [];
  const F = { w: 0, h: 0, dpr: 1, sprites: null, hearts: [], blossoms: [], wind: 0, windT: 0, show: null };
  let pill = null, pillSecs = Infinity, pillHeld = false;
  let card = null;
  let still = null, stillKind = '';

  /* ---------------- what is on stage ---------------- */
  const ambient = () => (SEASON.part('valentine', 'effects') ? 'hearts' : SEASON.part('spring', 'effects') ? 'blossoms' : null);
  const scene = () => (F.show ? F.show.kind : ambient());

  /* ================================================================
     sprites
     ================================================================ */
  function sprite(size, paint) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);
    g.scale(size / 26, size / 26);
    paint(g);
    return c;
  }
  function makeSprites(dpr) {
    const S = Math.round(26 * dpr);
    const heart = new Path2D(HEART), petal = new Path2D(PETAL);
    return {
      hearts: HEARTS.map(col => sprite(S, g => { g.translate(0, 1); g.fillStyle = col; g.fill(heart); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(-4.2, -6, 2.4, 1.5, -0.6, 0, Math.PI * 2); g.fill(); })),
      flowers: PINKS.map(col => sprite(S, g => {
        g.fillStyle = col;
        for (let i = 0; i < 5; i++) { g.save(); g.rotate(i * 1.2566); g.fill(petal); g.restore(); }
        g.fillStyle = '#ff7aa5';
        g.beginPath(); g.arc(0, 0, 1.7, 0, Math.PI * 2); g.fill();
      })),
      petals: PINKS.map(col => sprite(S, g => { g.translate(0, 5); g.fillStyle = col; g.fill(petal); })),
    };
  }

  /* ================================================================
     slow weather: hearts rise, blossoms fall
     ================================================================ */
  function heart(anywhere) {
    const depth = Math.random();
    return {
      x: rnd(0, F.w), y: anywhere ? rnd(0, F.h) : F.h + rnd(10, 60),
      s: 9 + depth * 16, vy: -(14 + depth * 34), sway: rnd(8, 26), hz: rnd(0.1, 0.32), ph: rnd(0, 6.283),
      a: 0.28 + depth * 0.5, tilt: rnd(-0.4, 0.4), k: Math.floor(rnd(0, HEARTS.length)),
    };
  }
  function blossom(anywhere) {
    const depth = Math.random();
    return {
      x: rnd(-20, F.w + 20), y: anywhere ? rnd(-20, F.h) : rnd(-60, -8),
      s: 8 + depth * 13, vy: 20 + depth * 36, sway: rnd(14, 38), hz: rnd(0.08, 0.26), ph: rnd(0, 6.283),
      a: 0.45 + depth * 0.5, rot: rnd(0, 6.283), spin: rnd(-1.4, 1.4), flower: Math.random() < 0.3,
      k: Math.floor(rnd(0, PINKS.length)), depth,
    };
  }
  function fillWeather() {
    const n = Math.round(Math.max(18, Math.min(46, (F.w * F.h) / 26000)));
    while (F.hearts.length < n) F.hearts.push(heart(true));
    F.hearts.length = n;
    const m = Math.round(Math.max(30, Math.min(80, (F.w * F.h) / 15000)));
    while (F.blossoms.length < m) F.blossoms.push(blossom(true));
    F.blossoms.length = m;
  }

  function drawHearts(g, dt) {
    for (const p of F.hearts) {
      p.ph += dt * p.hz * 6.283;
      p.y += p.vy * dt;
      if (p.y < -30) Object.assign(p, heart(false));
      g.globalAlpha = p.a * Math.min(1, Math.max(0, (p.y + 20) / 80));
      g.save();
      g.translate(p.x + Math.sin(p.ph) * p.sway, p.y);
      g.rotate(p.tilt + Math.sin(p.ph) * 0.25);
      g.drawImage(F.sprites.hearts[p.k], -p.s, -p.s, p.s * 2, p.s * 2);
      g.restore();
    }
  }
  function drawBlossoms(g, dt) {
    F.windT += dt;
    F.wind = 10 + Math.sin(F.windT * 0.17) * 14 + Math.sin(F.windT * 0.05) * 8;
    for (const p of F.blossoms) {
      p.ph += dt * p.hz * 6.283;
      p.y += p.vy * dt;
      p.x += F.wind * (0.3 + p.depth) * dt;
      p.rot += p.spin * dt;
      if (p.y > F.h + 20 || p.x > F.w + 50) Object.assign(p, blossom(false));
      g.globalAlpha = p.a;
      g.save();
      g.translate(p.x + Math.sin(p.ph) * p.sway, p.y);
      g.rotate(p.rot);
      g.drawImage((p.flower ? F.sprites.flowers : F.sprites.petals)[p.k], -p.s, -p.s, p.s * 2, p.s * 2);
      g.restore();
    }
  }

  /* ================================================================
     one-shots
     ================================================================ */
  const newShow = (kind, dur) => ({ kind, t: 0, dur, born: Date.now(), parts: [], rockets: [], next: 0.2, finale: false });

  function launch(sh, big) {
    const k = Math.min(F.w, F.h) / 800;
    sh.rockets.push({
      x: rnd(F.w * 0.12, F.w * 0.88), y: F.h + 6, ty: rnd(F.h * 0.12, F.h * 0.5),
      vy: rnd(430, 560) * Math.max(0.7, F.h / 860), vx: rnd(-26, 26), col: pick(SPARKS), k, big,
    });
  }
  function burst(sh, r) {
    const n = r.big ? 110 : Math.round(rnd(60, 90)), sp = rnd(110, 250) * Math.max(0.6, r.k);
    const two = Math.random() < 0.35 ? pick(SPARKS) : null;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rnd(-0.05, 0.05), v = sp * (Math.random() < 0.5 ? 1 : rnd(0.55, 0.95));
      sh.parts.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(1.1, 1.9), max: 1.9, col: two && i % 2 ? two : r.col });
    }
  }
  function drawFireworks(g, dt) {
    const sh = F.show;
    sh.t += dt;
    while (sh.t >= sh.next && sh.next < sh.dur - 3) { launch(sh, false); sh.next += rnd(0.3, 0.75); }
    if (!sh.finale && sh.t >= sh.dur - 3) { sh.finale = true; for (let i = 0; i < 7; i++) setTimeout(() => { if (F.show === sh) launch(sh, true); }, i * 160); }
    g.lineCap = 'round';
    for (let i = sh.rockets.length - 1; i >= 0; i--) {
      const r = sh.rockets[i];
      r.y -= r.vy * dt; r.x += r.vx * dt; r.vy -= 150 * dt;
      g.globalAlpha = 1;
      g.strokeStyle = r.col; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(r.x - r.vx * 0.06, r.y + r.vy * 0.06); g.lineTo(r.x, r.y); g.stroke();
      if (r.y <= r.ty || r.vy < 60) { burst(sh, r); sh.rockets.splice(i, 1); }
    }
    /* sparks are batched into one path per colour and fade step: a few strokes a frame, not hundreds */
    const batch = new Map();
    for (let i = sh.parts.length - 1; i >= 0; i--) {
      const p = sh.parts[i];
      p.life -= dt;
      if (p.life <= 0) { sh.parts.splice(i, 1); continue; }
      p.vx *= Math.exp(-1.1 * dt); p.vy = p.vy * Math.exp(-1.1 * dt) + 70 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const a = p.life > 0.7 ? 1 : p.life > 0.4 ? 0.6 : 0.3;
      const k = p.col + a;
      let b = batch.get(k);
      if (!b) batch.set(k, b = { col: p.col, a, path: new Path2D() });
      b.path.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); b.path.lineTo(p.x, p.y);
    }
    g.lineWidth = 2;
    for (const b of batch.values()) { g.globalAlpha = b.a; g.strokeStyle = b.col; g.stroke(b.path); }
    if ((sh.t >= sh.dur && !sh.rockets.length && !sh.parts.length) || sh.t > sh.dur + 8) endShow();
  }

  function startConfetti(sh) {
    for (const side of [0, 1]) {
      const x0 = side ? F.w * 0.94 : F.w * 0.06;
      for (let i = 0; i < 80; i++) {
        const a = -Math.PI / 2 + (side ? -1 : 1) * rnd(0.05, 0.75), v = rnd(520, 1000) * Math.max(0.7, F.h / 860);
        sh.parts.push({ x: x0, y: F.h + 8, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(6, 11), h: rnd(3, 6), rot: rnd(0, 6.283), spin: rnd(-9, 9), ph: rnd(0, 6.283), col: pick(CONFETTI) });
      }
    }
  }
  function drawConfetti(g, dt) {
    const sh = F.show;
    sh.t += dt;
    let alive = 0;
    const fade = Math.min(1, Math.max(0, (sh.dur - sh.t) / 1.2));
    for (const p of sh.parts) {
      if (p.y > F.h + 24 && p.vy > 0) continue;
      alive++;
      p.vx *= Math.exp(-1.6 * dt); p.vy = p.vy * Math.exp(-1.6 * dt) + 270 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt; p.ph += dt * 9;
      g.globalAlpha = fade;
      g.save();
      g.translate(p.x, p.y); g.rotate(p.rot);
      g.fillStyle = p.col;
      g.fillRect(-p.w / 2, -p.h / 2 * Math.cos(p.ph), p.w, p.h * Math.max(0.15, Math.abs(Math.cos(p.ph))));
      g.restore();
    }
    if (!alive || sh.t >= sh.dur) endShow();
  }

  function endShow() {
    if (!F.show) return;
    F.show = null;
    /* the canvas goes away (or goes back to the hearts and blossoms) once this frame is done */
    queueMicrotask(() => { weather.sync(); syncStill(); });
  }

  /* ================================================================
     the canvas
     ================================================================ */
  const weather = seasonCanvas(host, {
    className: 'celebrate-fx',
    wanted: () => !!scene(),
    start() { F.sprites = null; F.hearts = []; F.blossoms = []; F.windT = 0; },
    resize(S) {
      F.w = S.w; F.h = S.h; F.dpr = S.dpr;
      F.sprites = makeSprites(S.dpr);
      fillWeather();
      if (F.show?.kind === 'confetti' && !F.show.parts.length) startConfetti(F.show);
    },
    draw(g, dt, now, S) {
      /* tests run the clock faster (set before the page loads); people never do */
      dt *= FAST;
      const sc = scene();
      /* what is on the canvas right now: 'fireworks' | 'confetti' | 'hearts' | 'blossoms' */
      if (S.cv.dataset.scene !== sc) S.cv.dataset.scene = sc || '';
      if (F.show) {
        if (F.show.kind === 'fireworks') drawFireworks(g, dt); else drawConfetti(g, dt);
      } else if (sc === 'hearts') drawHearts(g, dt);
      else if (sc === 'blossoms') drawBlossoms(g, dt);
    },
    stop() { F.sprites = null; F.hearts = []; F.blossoms = []; },
  });

  function startShow(kind) {
    F.show = newShow(kind, kind === 'fireworks' ? CEL.FIREWORKS_S : CEL.CONFETTI_S);
    if (kind === 'confetti' && F.w) startConfetti(F.show);
    weather.sync();
    syncStill();
  }

  /* ================================================================
     stills: what reduced motion gets instead of the movement
     ================================================================ */
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  function stillArt(kind) {
    const rand = seeded(kind.length * 7919 + 13);
    const svg = el('svg', { width: '100%', height: '100%', 'aria-hidden': 'true', focusable: 'false' });
    const put = (x, y, size, build) => {
      const s = el('svg', { x: x + '%', y: y + '%', width: size, height: size, viewBox: '-13 -13 26 26', overflow: 'visible' });
      build(s); svg.append(s);
    };
    if (kind === 'hearts') {
      for (let i = 0; i < 18; i++) put(rand() * 96, rand() * 92, 18 + rand() * 26, s => s.append(el('path', { d: HEART, fill: HEARTS[i % HEARTS.length], opacity: 0.28 + rand() * 0.4, transform: `rotate(${Math.round(rand() * 50 - 25)})` })));
    } else if (kind === 'blossoms') {
      for (let i = 0; i < 18; i++) put(rand() * 96, rand() * 92, 16 + rand() * 24, s => {
        const g = el('g', { opacity: 0.45 + rand() * 0.45, transform: `rotate(${Math.round(rand() * 72)})` });
        for (let k = 0; k < 5; k++) g.append(el('path', { d: PETAL, fill: PINKS[i % PINKS.length], transform: `rotate(${k * 72})` }));
        g.append(el('circle', { r: 1.7, fill: '#ff7aa5' }));
        s.append(g);
      });
    } else if (kind === 'confetti') {
      for (let i = 0; i < 70; i++) put(rand() * 98, rand() * 90, 14, s => s.append(el('rect', { x: -5, y: -2.5, width: 10, height: 5, fill: CONFETTI[i % CONFETTI.length], transform: `rotate(${Math.round(rand() * 180)})` })));
    } else {
      for (let b = 0; b < 5; b++) {
        const cx = 14 + b * 18 + rand() * 6, cy = 14 + rand() * 30, col = SPARKS[(b * 2) % SPARKS.length];
        put(cx, cy, 120, s => { for (let i = 0; i < 18; i++) { const a = (i / 18) * 6.283; s.append(el('line', { x1: Math.cos(a) * 3, y1: Math.sin(a) * 3, x2: Math.cos(a) * 12, y2: Math.sin(a) * 12, stroke: col, 'stroke-width': 1.1, 'stroke-linecap': 'round' })); } });
      }
    }
    return svg;
  }
  function syncStill() {
    const mobile = document.body.classList.contains('is-mobile');
    const kind = reducedMotion() && !mobile ? scene() || '' : '';
    if (kind === stillKind && (kind ? still?.isConnected : !still)) return;
    still?.remove(); still = null; stillKind = '';
    if (!kind) return;
    const d = host.querySelector('.desktop');
    if (!d) return;
    still = h('div.celebrate-still', { 'aria-hidden': 'true', dataset: { kind } });
    still.append(stillArt(kind));
    const wp = d.querySelector('.wp');
    let at = wp ? wp.nextSibling : d.firstChild;
    while (at && (at.classList?.contains('os-skin') || at.classList?.contains('wp-vis'))) at = at.nextSibling;
    d.insertBefore(still, at);
    stillKind = kind;
  }

  /* ================================================================
     the New Year countdown
     ================================================================ */
  const word = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function paintPill(now) {
    const n = CEL.nye(now);
    let text = '', label = '';
    if (SEASON.part('newyear', 'countdown', now)) {
      if (n.phase === 'count') {
        /* it only ever counts down: a clock set back hides it until midnight has passed */
        if (n.secs > pillSecs + 1) pillHeld = true;
        pillSecs = Math.min(pillSecs, n.secs);
        if (CEL.claimed('newyear', n.year)) pillHeld = true;
        if (!pillHeld) {
          const m = Math.floor(n.secs / 60), s = n.secs % 60;
          text = `${m}:${String(s).padStart(2, '0')}`;
          label = `${word(m, 'minute', 'minutes')} and ${word(s, 'second', 'seconds')} until ${n.year}`;
        }
      } else {
        pillSecs = Infinity; pillHeld = false;
        if (n.phase === 'show') { text = `Happy ${n.year}!`; label = `Happy New Year ${n.year}`; }
      }
    } else { pillSecs = Infinity; pillHeld = false; }
    if (!text) { if (pill) { pill.remove(); pill = null; } return; }
    if (!pill) {
      pill = h('div.nye-pill', { role: 'timer' }, h('small', { text: 'New Year’s Eve' }), h('b'));
      host.appendChild(pill);
    }
    const b = pill.querySelector('b');
    if (b.textContent !== text) b.textContent = text;
    if (pill.getAttribute('aria-label') !== label) pill.setAttribute('aria-label', label);
    pill.querySelector('small').textContent = n.phase === 'show' ? 'Midnight' : 'New Year’s Eve';
  }

  /* ================================================================
     the birthday card
     ================================================================ */
  function showCard(now) {
    const name = String(store.get('session.user.name') || store.get('session.user.username') || '').trim();
    const cake = el('svg', { viewBox: '0 0 48 48', width: 44, height: 44, 'aria-hidden': 'true' });
    cake.append(
      el('rect', { x: 8, y: 28, width: 32, height: 14, rx: 3, fill: '#ff8fb8' }),
      el('rect', { x: 8, y: 26, width: 32, height: 6, rx: 3, fill: '#fff0f5' }),
      el('rect', { x: 14, y: 16, width: 3, height: 10, rx: 1.2, fill: '#7ad0ff' }),
      el('rect', { x: 22.5, y: 14, width: 3, height: 12, rx: 1.2, fill: '#ffd24a' }),
      el('rect', { x: 31, y: 16, width: 3, height: 10, rx: 1.2, fill: '#8dffb0' }),
      el('path', { d: 'M15.5 8c-2 2.5-1.4 4.6 0 5.6 1.4-1 2-3.1 0-5.6z', fill: '#ffb23a' }),
      el('path', { d: 'M24 6c-2 2.5-1.4 4.6 0 5.6 1.4-1 2-3.1 0-5.6z', fill: '#ffb23a' }),
      el('path', { d: 'M32.5 8c-2 2.5-1.4 4.6 0 5.6 1.4-1 2-3.1 0-5.6z', fill: '#ffb23a' }));
    card = h('div.bday-card', { role: 'region', 'aria-label': 'Happy birthday' },
      h('div.bday-card__art', { 'aria-hidden': 'true' }, cake),
      h('div.bday-card__t',
        h('b', { text: name ? `Happy birthday, ${name}!` : 'Happy birthday!' }),
        h('small', { text: 'Hope it is a good one. The date stays on this device — it is never sent anywhere.' })),
      h('button.btn.btn--sm.bday-card__x', { type: 'button', 'aria-label': 'Close the birthday card', onclick: () => closeCard() }, 'Thanks!'));
    host.appendChild(card);
  }
  function closeCard() { card?.remove(); card = null; }

  /* ================================================================
     the clock: one look a second, nothing drawn between days
     ================================================================ */
  function check() {
    const now = new Date();
    paintPill(now);

    /* an old show the page never got to draw (hidden tab, phone layout) must not linger */
    if (F.show && Math.abs(Date.now() - F.show.born) > (F.show.dur + (weather.canvas ? 40 : 0)) * 1000) endShow();

    if (!F.show) {
      const n = CEL.nye(now);
      if (n.phase === 'show' && SEASON.part('newyear', 'effects', now) && CEL.claim('newyear', n.year)) startShow('fireworks');
    }
    /* the birthday: the card, then the confetti once the stage is free */
    if (SEASON.part('birthday', 'card', now) && !card && !CEL.claimed('card', now.getFullYear()) && CEL.claim('card', now.getFullYear())) showCard(now);
    if (!F.show && SEASON.part('birthday', 'effects', now) && CEL.claim('confetti', now.getFullYear())) startShow('confetti');
    if (card && !SEASON.part('birthday', 'card', now)) closeCard();
  }

  function sync() { check(); weather.sync(); syncStill(); }
  sync();
  offs.push(
    bus.on('tick:1s', check),
    bus.on('tick:5s', syncStill),
    bus.on('season:change', sync),
    store.sub('prefs', sync),
  );

  return () => {
    offs.forEach(f => { try { f(); } catch (e) {} });
    F.show = null;
    weather.destroy();
    still?.remove(); pill?.remove(); card?.remove();
    still = pill = card = null;
  };
}

export default mountCelebrate;
