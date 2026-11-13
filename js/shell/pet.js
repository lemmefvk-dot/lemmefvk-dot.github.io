/* ============================================================
   pet.js — a little cat that lives on top of the dock.

   It wanders along the dock's top edge while you are using the
   computer, sits down when the pointer has been still for a few
   seconds and curls up to nap after a while longer. Click it (or
   stroke it: move the pointer back and forth across it) and it
   does a little jump with a heart. With the pointer on it, it
   stays put — it never walks out from under a stroke, however
   slow. During spooky season
   (js/core/season.js) it is a small ghost instead; in winter the
   cat wears a scarf.

   Drawn here on a 48×40 canvas — original vector shapes, no
   images — and only redrawn when its pose changes.

   It never gets in the way:
   · only the pet itself takes the pointer (pointer-events on the
     one small element); it stands above the dock, never over it,
     and sits under every window, so a window that reaches down to
     the dock simply covers it;
   · requestAnimationFrame runs only while it is walking or
     jumping, never while the tab is hidden; in Game Mode it naps
     and nothing moves;
   · reduced motion (this OS's switch or the computer's): it sits
     still — no walking, no jump; a click still gets a heart;
   · it is away on a phone-sized screen and while the dock is on a
     side or hides itself.

   prefs.desktopPet (default on) — Settings › Desktop, or
   right-click the pet › Hide the pet.

   Bus in:  pet:pet (Settings' "Pet it" button)
   Bus out: pet:react { kind, how }  — 'click' | 'stroke' | 'button'
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as SEASON from '../core/season.js';

const PREF = 'prefs.desktopPet';
export const SIT_MS = 4000;          /* pointer still this long: it sits */
export const SLEEP_MS = 45000;       /* ...and this long: it naps */
const PW = 48, PH = 40;              /* the sprite's box, CSS px */
const JUMP_MS = 650;

if (typeof document !== 'undefined' && !document.getElementById('feat-pet-css')) {
  document.head.appendChild(Object.assign(document.createElement('link'), { id: 'feat-pet-css', rel: 'stylesheet', href: 'css/feat-pet.css' }));
}

const reducedMotion = () => document.body.classList.contains('reduce-motion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const gameMode = () => document.documentElement.dataset.gamemode === 'on';

/* ---------------- drawing ---------------- */
const INK = '#3a2412';
function drawCat(g, pose, frame, scarf) {
  const fur = '#f2a65a', dark = '#c9762e', belly = '#fff4e4';
  g.lineWidth = 1.3; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round';
  const fillStroke = () => { g.fill(); g.stroke(); };
  const leg = (x, y, h, tilt = 0) => {
    g.save(); g.translate(x, y); g.rotate(tilt);
    g.beginPath(); g.roundRect ? g.roundRect(-1.7, 0, 3.4, h, 1.7) : g.rect(-1.7, 0, 3.4, h);
    g.fillStyle = fur; fillStroke(); g.restore();
  };
  const ear = (x1, y1, x2, y2, x3, y3) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath(); g.fillStyle = fur; fillStroke(); };
  const head = (cx, cy, sleepy) => {
    ear(cx - 5.5, cy - 3, cx - 4, cy - 10, cx - 0.5, cy - 5.5);
    ear(cx + 1, cy - 5.5, cx + 4.5, cy - 10, cx + 6, cy - 2.5);
    g.beginPath(); g.ellipse(cx, cy, 7, 6.2, 0, 0, Math.PI * 2); g.fillStyle = fur; fillStroke();
    g.beginPath(); g.moveTo(cx - 2, cy - 5.6); g.lineTo(cx - 1, cy - 3); g.moveTo(cx + 1, cy - 5.8); g.lineTo(cx + 1, cy - 3.2); g.strokeStyle = dark; g.stroke(); g.strokeStyle = INK;
    if (sleepy) {
      g.beginPath(); g.arc(cx + 2.4, cy - 0.2, 1.5, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    } else {
      g.beginPath(); g.ellipse(cx + 2.6, cy - 0.6, 1.1, 1.6, 0, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
      g.beginPath(); g.arc(cx + 2.9, cy - 1.1, 0.4, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    }
    g.beginPath(); g.moveTo(cx + 6.2, cy + 1.2); g.lineTo(cx + 7.2, cy + 1.6); g.lineTo(cx + 6.4, cy + 2.4); g.closePath(); g.fillStyle = '#f08ca0'; g.fill();
    g.beginPath(); g.moveTo(cx + 5, cy + 3); g.lineTo(cx + 10, cy + 2.4); g.moveTo(cx + 5, cy + 3.8); g.lineTo(cx + 10, cy + 4.4); g.lineWidth = 0.6; g.stroke(); g.lineWidth = 1.3;
  };
  const scarfAt = (cx, cy) => {
    if (!scarf) return;
    g.beginPath(); g.ellipse(cx, cy, 4.6, 2.6, -0.2, 0, Math.PI * 2); g.fillStyle = '#d23a3f'; fillStroke();
    g.beginPath(); g.moveTo(cx - 1, cy + 1); g.lineTo(cx - 3.5, cy + 8); g.lineTo(cx - 0.5, cy + 8.5); g.lineTo(cx + 1.5, cy + 2); g.closePath(); fillStroke();
    g.beginPath(); g.moveTo(cx - 3.2, cy + 6.2); g.lineTo(cx - 0.6, cy + 6.6); g.strokeStyle = '#fff'; g.stroke(); g.strokeStyle = INK;
  };

  if (pose === 'sleep') {
    g.beginPath(); g.moveTo(10, 36); g.quadraticCurveTo(4, 30, 12, 27); g.lineWidth = 3.4; g.strokeStyle = INK; g.stroke();
    g.lineWidth = 2; g.strokeStyle = fur; g.stroke(); g.lineWidth = 1.3; g.strokeStyle = INK;
    g.beginPath(); g.ellipse(23, 31, 14, 7.5, 0, 0, Math.PI * 2); g.fillStyle = fur; fillStroke();
    g.beginPath(); g.arc(20, 30, 4.5, Math.PI * 1.1, Math.PI * 1.9); g.strokeStyle = dark; g.stroke(); g.strokeStyle = INK;
    g.beginPath(); g.moveTo(9.5, 35); g.quadraticCurveTo(22, 41, 34, 36.5); g.lineWidth = 3.4; g.stroke(); g.lineWidth = 2; g.strokeStyle = fur; g.stroke(); g.lineWidth = 1.3; g.strokeStyle = INK;
    head(35, 30, true);
    scarfAt(30.5, 34);
    return;
  }
  if (pose === 'sit') {
    g.beginPath(); g.moveTo(15, 36); g.quadraticCurveTo(10, 38, 8, 33); g.quadraticCurveTo(6, 27, 11, 26); g.lineWidth = 3.4; g.stroke(); g.lineWidth = 2; g.strokeStyle = fur; g.stroke(); g.lineWidth = 1.3; g.strokeStyle = INK;
    g.beginPath(); g.ellipse(21, 29, 9, 8.5, 0, 0, Math.PI * 2); g.fillStyle = fur; fillStroke();
    g.beginPath(); g.ellipse(27, 23, 6, 9.5, -0.15, 0, Math.PI * 2); g.fillStyle = fur; fillStroke();
    g.beginPath(); g.ellipse(29, 25, 3, 6, -0.15, 0, Math.PI * 2); g.fillStyle = belly; g.fill();
    g.beginPath(); g.arc(19, 27, 4.5, Math.PI * 1.1, Math.PI * 1.9); g.strokeStyle = dark; g.stroke(); g.strokeStyle = INK;
    leg(27, 29, 9); leg(31, 29, 9);
    head(30, 13, false);
    scarfAt(28.5, 18.5);
    return;
  }
  /* walking, standing and jumping: side on */
  const swish = pose === 'walk' ? Math.sin(frame * Math.PI / 2) * 2 : 0;
  g.beginPath(); g.moveTo(11, 25); g.quadraticCurveTo(4, 22 + swish, 5, 13 + swish); g.lineWidth = 3.4; g.stroke(); g.lineWidth = 2; g.strokeStyle = fur; g.stroke(); g.lineWidth = 1.3; g.strokeStyle = INK;
  const bob = pose === 'walk' && frame % 2 ? -0.8 : 0;
  if (pose === 'jump') {
    leg(13, 27, 9, 0.9); leg(16, 28, 9, 0.7); leg(30, 27, 9, -0.8); leg(33, 26, 9, -1);
  } else {
    const k = pose === 'walk' ? [[-2, 2, 2, -2], [0, 0, 0, 0], [2, -2, -2, 2], [0, 0, 0, 0]][frame % 4] : [0, 0, 0, 0];
    leg(14 + k[0], 29 + bob, 8.5 - (k[0] > 0 ? 1.2 : 0)); leg(18 + k[1], 29 + bob, 8.5 - (k[1] > 0 ? 1.2 : 0));
    leg(28 + k[2], 29 + bob, 8.5 - (k[2] > 0 ? 1.2 : 0)); leg(32 + k[3], 29 + bob, 8.5 - (k[3] > 0 ? 1.2 : 0));
  }
  g.save();
  if (pose === 'jump') { g.translate(23, 25); g.rotate(-0.18); g.translate(-23, -25); }
  g.beginPath(); g.ellipse(23, 25 + bob, 13, 7, 0, 0, Math.PI * 2); g.fillStyle = fur; fillStroke();
  g.beginPath(); g.ellipse(30, 28 + bob, 5, 3, 0, 0, Math.PI * 2); g.fillStyle = belly; g.fill();
  g.strokeStyle = dark;
  for (const x of [16, 20, 24]) { g.beginPath(); g.moveTo(x, 18.6 + bob); g.quadraticCurveTo(x + 1.5, 22 + bob, x, 25 + bob); g.stroke(); }
  g.strokeStyle = INK;
  head(36, 17 + bob, false);
  scarfAt(32.5, 22 + bob);
  g.restore();
}

function drawGhost(g, pose, frame) {
  const sleepy = pose === 'sleep';
  const happy = pose === 'jump';
  const y0 = pose === 'sit' || sleepy ? 6 : 2;
  const wave = (frame % 4) * (Math.PI / 2);
  g.globalAlpha = sleepy ? 0.78 : 0.95;
  g.beginPath();
  g.moveTo(11, y0 + 30);
  g.lineTo(11, y0 + 14);
  g.arc(24, y0 + 14, 13, Math.PI, 0);
  g.lineTo(37, y0 + 30);
  for (let i = 0; i <= 4; i++) {
    const x = 37 - (26 / 4) * i;
    g.lineTo(x, y0 + 30 + Math.sin(wave + i * 1.6) * 2.4 + (i % 2 ? 3 : 0));
  }
  g.closePath();
  g.fillStyle = '#f6f3ff'; g.fill();
  g.lineWidth = 1.3; g.strokeStyle = '#4b3f73'; g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = '#231a3a'; g.strokeStyle = '#231a3a'; g.lineCap = 'round';
  if (sleepy) {
    g.beginPath(); g.arc(20, y0 + 14, 2, 0.15 * Math.PI, 0.85 * Math.PI); g.moveTo(30, y0 + 14.5); g.arc(28, y0 + 14, 2, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  } else if (happy) {
    g.beginPath(); g.arc(20, y0 + 15, 2.2, 1.15 * Math.PI, 1.85 * Math.PI); g.moveTo(30.2, y0 + 15); g.arc(28, y0 + 15, 2.2, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke();
  } else {
    g.beginPath(); g.ellipse(20, y0 + 13.5, 1.8, 2.7, 0, 0, Math.PI * 2); g.ellipse(28, y0 + 13.5, 1.8, 2.7, 0, 0, Math.PI * 2); g.fill();
  }
  g.beginPath(); g.ellipse(24, y0 + 20, 1.8, sleepy ? 1 : 2.2, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,143,177,.45)';
  g.beginPath(); g.arc(16.5, y0 + 18, 2, 0, Math.PI * 2); g.arc(31.5, y0 + 18, 2, 0, Math.PI * 2); g.fill();
}

/* ---------------- the pet ---------------- */
export function mountPet(host) {
  const { h, icon } = api;
  const cv = h('canvas.pet__sprite', { width: PW, height: PH, 'aria-hidden': 'true' });
  const el = h('div.pet', { role: 'img', dataset: { state: 'sit', kind: 'cat' } }, cv);
  el.hidden = true;
  const g = cv.getContext('2d');

  const P = {
    x: 0, y: 0, dir: 1, state: 'sit', frame: 0, dist: 0, target: 0,
    lastMove: 0, nextWalk: 0, raf: 0, last: 0, jumpAt: 0, after: 'sit',
    range: [0, 0], drawn: '', dpr: 1, stroke: 0, strokeX: null, strokeAt: 0, over: false,
  };

  /* it arrives sitting: the nap comes SLEEP_MS after the last movement, or after it arrived */
  P.lastMove = Date.now() - SIT_MS;
  const dockEl = () => host.querySelector('.dock');
  const kind = () => (SEASON.spooky('theme') ? 'ghost' : 'cat');
  const still = () => reducedMotion() || gameMode();

  /* where it may stand: along the dock's top edge, in the host's coordinates */
  function measure() {
    const d = dockEl();
    if (!d) return false;
    const r = d.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    if (!r.width) return false;
    P.range = [r.left - hr.left + 10, r.right - hr.left - 10 - PW];
    P.y = r.top - hr.top - PH + 2;
    if (P.range[1] < P.range[0]) P.range[1] = P.range[0];
    P.x = Math.max(P.range[0], Math.min(P.range[1], P.x || (P.range[0] + (P.range[1] - P.range[0]) * Math.random())));
    return true;
  }

  function wanted() {
    if (store.get(PREF, true) === false) return false;
    if (document.body.classList.contains('is-mobile')) return false;
    const d = dockEl();
    if (!d || d.classList.contains('is-autohide')) return false;
    if (d.dataset.pos === 'left' || d.dataset.pos === 'right') return false;
    return true;
  }

  function draw() {
    const k = kind();
    const scarf = k === 'cat' && SEASON.winter('theme');
    const key = `${k}|${P.state}|${P.frame}|${P.dir}|${scarf}|${window.devicePixelRatio || 1}`;
    if (key === P.drawn) return;
    P.drawn = key;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (dpr !== P.dpr || cv.width !== Math.round(PW * dpr)) { P.dpr = dpr; cv.width = Math.round(PW * dpr); cv.height = Math.round(PH * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, PW, PH);
    if (P.dir < 0) { g.translate(PW, 0); g.scale(-1, 1); }
    const pose = P.state === 'stand' ? 'walk' : P.state;
    const frame = P.state === 'stand' ? 1 : P.frame;
    if (k === 'ghost') drawGhost(g, pose, frame); else drawCat(g, pose, frame, scarf);
    el.dataset.kind = k;
  }

  const SAY = {
    walk: 'walking along the dock', stand: 'looking around', sit: 'sitting on the dock',
    sleep: 'napping on the dock', jump: 'jumping for joy',
  };
  function place() {
    const lift = P.state === 'jump' ? Math.sin(Math.min(1, (performance.now() - P.jumpAt) / JUMP_MS) * Math.PI) * (kind() === 'ghost' ? 18 : 24) : 0;
    el.style.transform = `translate(${Math.round(P.x)}px, ${Math.round(P.y - lift)}px)`;
  }
  function setState(s) {
    if (P.state === s) return;
    P.state = s;
    el.dataset.state = s;
    el.setAttribute('aria-label', `Your desktop ${kind()}, ${SAY[s]}`);
    if (s === 'sleep') zzz(); else el.querySelector('.pet__z')?.remove();
    draw();
  }
  function zzz() {
    if (el.querySelector('.pet__z')) return;
    el.appendChild(h('span.pet__z', { 'aria-hidden': 'true', text: 'z' }));
  }

  /* ---- motion: rAF only while walking or jumping ---- */
  const moving = () => P.state === 'walk' || P.state === 'jump';
  /* data-anim marks a running loop (set when it starts, cleared when it stops — not per frame) */
  const stopped = () => { P.last = 0; delete el.dataset.anim; };
  function frame(now) {
    P.raf = 0;
    if (el.hidden || document.hidden || gameMode() || !moving()) { stopped(); return; }
    const dt = P.last ? Math.min(0.05, (now - P.last) / 1000) : 0;
    P.last = now;
    if (P.state === 'walk') {
      if (still()) { setState('sit'); stopped(); return; }
      const speed = kind() === 'ghost' ? 30 : 40;
      const step = Math.min(Math.abs(P.target - P.x), speed * dt);
      P.x += step * P.dir;
      P.dist += step;
      const f = Math.floor(P.dist / 6) % 4;
      if (f !== P.frame) { P.frame = f; draw(); }
      if (Math.abs(P.target - P.x) < 0.5) {
        P.x = P.target;
        setState('stand');
        P.nextWalk = Date.now() + 1500 + Math.random() * 3500;
      }
    } else if (P.state === 'jump' && performance.now() - P.jumpAt >= JUMP_MS) {
      setState(P.after);
    }
    place();
    if (moving()) P.raf = requestAnimationFrame(frame);
    else stopped();
  }
  const kick = () => {
    if (P.raf || !moving() || el.hidden || document.hidden || gameMode()) return;
    P.last = 0;
    el.dataset.anim = 'on';
    P.raf = requestAnimationFrame(frame);
  };

  function walk() {
    if (still() || !measure()) return;
    const [a, b] = P.range;
    if (b - a < 24) { setState('stand'); return; }
    let t = a + Math.random() * (b - a);
    if (Math.abs(t - P.x) < 40) t = P.x < (a + b) / 2 ? Math.min(b, P.x + 60 + Math.random() * 120) : Math.max(a, P.x - 60 - Math.random() * 120);
    P.target = t;
    P.dir = t >= P.x ? 1 : -1;
    P.drawn = '';
    setState('walk');
    draw();
    kick();
  }

  /* ---- the clock: sit, nap, get up, wander ---- */
  function tick() {
    if (el.hidden) return;
    const idle = Date.now() - P.lastMove;
    /* a jump the loop couldn't finish (Game Mode came on, the tab was hidden) lands here */
    if (P.state === 'jump') {
      if (performance.now() - P.jumpAt < JUMP_MS + 250 && !gameMode()) return;
      setState(P.after);
      place();
    }
    if (gameMode()) { if (P.state !== 'sleep') setState('sleep'); return; }
    if (idle >= SLEEP_MS) { if (P.state !== 'sleep') setState('sleep'); return; }
    if (idle >= SIT_MS) { if (P.state !== 'sit' && P.state !== 'sleep') setState('sit'); return; }
    /* the pointer is moving */
    if (reducedMotion()) { if (P.state !== 'sit') setState('sit'); return; }
    if (P.state === 'sleep' || P.state === 'sit') { setState('stand'); P.nextWalk = Date.now() + 900; return; }
    if (P.state === 'stand' && Date.now() >= P.nextWalk && !P.over) walk();
  }

  function onMove(e) {
    const now = Date.now();
    if (now - P.lastMove < 200 && !(P.state === 'sleep' || P.state === 'sit')) return;
    P.lastMove = now;
    if (!el.hidden && (P.state === 'sleep' || P.state === 'sit')) tick();
  }

  /* ---- reacting ---- */
  function heart() {
    const hrt = h('span.pet__heart', { 'aria-hidden': 'true' }, icon('heart'));
    el.appendChild(hrt);
    setTimeout(() => hrt.remove(), 1300);
  }
  function react(how) {
    if (el.hidden) return false;
    heart();
    bus.emit('pet:react', { kind: kind(), how });
    if (still()) return true;
    measure();
    P.after = Date.now() - P.lastMove >= SIT_MS ? 'sit' : 'stand';
    if (P.state === 'walk') P.after = 'stand';
    P.jumpAt = performance.now();
    P.nextWalk = Date.now() + 1500;
    setState('jump');
    kick();
    return true;
  }

  el.addEventListener('click', e => { e.stopPropagation(); react('click'); });
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    api.menu([
      { label: `Pet the ${kind()}`, icon: 'heart', onClick: () => react('menu') },
      { label: 'Hide the pet', icon: 'eye', onClick: () => {
        store.set(PREF, false);
        api.notify({ app: 'Desktop', icon: 'cat', title: 'Pet hidden', message: 'Bring it back in Settings → Desktop.',
          actions: [{ label: 'Undo', onClick: () => store.set(PREF, true) }] });
      } },
      { label: 'Pet settings…', icon: 'settings', onClick: () => api.openApp('settings', { section: 'desktop' }) },
    ], e.clientX, e.clientY);
  });
  /* stroking: the pointer going back and forth across it. A walking pet
     stops under the pointer (and starts no walk while it is there), so a
     slow stroke isn't lost to it wandering off mid-stroke. */
  const hold = () => {
    P.over = true;
    if (P.state === 'walk') { setState('stand'); place(); }
  };
  el.addEventListener('pointerenter', hold);
  el.addEventListener('pointermove', e => {
    if (!P.over || P.state === 'walk') hold();
    if (P.strokeX !== null) {
      const dx = Math.abs(e.clientX - P.strokeX);
      P.stroke += dx;
    }
    P.strokeX = e.clientX;
    if (P.stroke > 110 && Date.now() - P.strokeAt > 1600) { P.strokeAt = Date.now(); P.stroke = 0; react('stroke'); }
  });
  el.addEventListener('pointerleave', () => {
    P.strokeX = null; P.stroke = 0; P.over = false;
    if (P.state === 'stand') P.nextWalk = Math.max(P.nextWalk, Date.now() + 900);
  });

  /* ---- showing and hiding ---- */
  function sync() {
    const want = wanted();
    if (want && !el.isConnected) {
      const d = dockEl();
      /* before the dock in the DOM, and under every window (css/feat-pet.css) */
      host.insertBefore(el, d || null);
    }
    if (!want) {
      el.hidden = true;
      P.over = false;                       /* no pointerleave comes from a hidden element */
      cancelAnimationFrame(P.raf); P.raf = 0;
      stopped();
      return;
    }
    const was = el.hidden;
    el.hidden = false;
    if (!measure()) { el.hidden = true; return; }
    if (was) { P.drawn = ''; setState(gameMode() ? 'sleep' : 'sit'); el.setAttribute('aria-label', `Your desktop ${kind()}, ${SAY[P.state]}`); }
    if (still() && P.state === 'walk') setState('sit');
    P.drawn = '';
    draw();
    place();
    kick();
  }

  const offs = [
    store.sub(PREF, sync),
    store.sub('prefs', () => requestAnimationFrame(sync)),       /* dock side, auto-hide, reduce motion */
    bus.on('season:change', () => { P.drawn = ''; draw(); }),
    bus.on('gamemode:change', () => { tick(); sync(); }),
    bus.on('tick:1s', tick),
    bus.on('tick:5s', () => { if (!el.hidden && !moving()) { measure(); place(); } }),
    bus.on('pet:pet', () => react('button')),
    bus.on('win:list', () => { if (!el.hidden && !moving()) { measure(); place(); } }),
    api.on(window, 'pointermove', onMove, { passive: true }),
    api.on(window, 'resize', () => { measure(); place(); sync(); }),
    api.on(document, 'visibilitychange', kick),
  ];
  /* the dock is painted a moment after the shell mounts */
  requestAnimationFrame(() => requestAnimationFrame(sync));
  setTimeout(sync, 400);

  return () => {
    offs.forEach(f => { try { f?.(); } catch (e) {} });
    cancelAnimationFrame(P.raf);
    el.remove();
  };
}

export default mountPet;
