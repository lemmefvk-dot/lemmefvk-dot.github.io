/* ============================================================
   seasons-more.js — the moving parts of the rest of the year.

   js/core/season.js decides WHEN (and whether Settings ›
   Celebrations has each one on); js/core/seasonkit.js keeps what
   has to be exact (the gratitude list, π, the clovers, the kit);
   js/core/firstsnow.js finds the first snow. This module draws and
   asks:

     autumn     leaves falling over the wallpaper; the gratitude
                list, with a card on Thanksgiving
     lunar      lanterns rising from Lunar New Year's Eve to the
                Lantern Festival, and fireworks once on the day
     stpatrick  nine clovers lying on the desktop, one with four
                leaves; a pill counts them
     piday      a card, and the digit challenge and puzzles
     earth      seeds and leaves drifting up
     summer     sun glints and bubbles drifting up
     school     the back-to-school planner kit (a checklist that
                opens the study apps)
     firstsnow  flakes over the wallpaper, the day it snows

   The weather runs on ONE canvas kept by shell/seasonfx.js — the
   machine winter's snow and spooky's leaves use — so it is only
   there while a season's effects are on, never with reduced motion
   (a still scatter stands in), never with the tab hidden, in Game
   Mode or with wallpaper motion off, and it never takes a click.
   Its shapes are drawn from the path strings below, so the canvas
   and the SVG stills are the same art, and all of it is original.

   A season on trial (Settings › Celebrations › Try it for a minute)
   looks the same and claims nothing: no show is used up, no card is
   spent, no clover is kept. A pill says how long is left.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import * as SEASON from '../core/season.js';
import * as CEL from '../core/celebrate.js';
import * as KIT from '../core/seasonkit.js';
import * as SNOW from '../core/firstsnow.js';
import { seasonCanvas, reducedMotion } from './seasonfx.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seeded = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const FAST = Math.max(1, Math.min(20, Number(globalThis.__STATICOS_FX_SPEED) || 1));

/* ---------- the shapes: a 26-unit box centred on 0,0 ----------
   fill / stroke 'c' means the particle's own colour */
export const SHAPES = {
  leaf: [
    { d: 'M0 -11 C7 -7 8 3 0 11 C-8 3 -7 -7 0 -11Z', fill: 'c' },
    { d: 'M0 -9 L0 10', stroke: 'rgba(0,0,0,.28)', lw: 1 },
  ],
  lantern: [
    { d: 'M-1 -13 L-1 -9 L1 -9 L1 -13Z', fill: '#e8b84a' },
    { d: 'M-5 -9 L5 -9 L5 -7 L-5 -7Z', fill: '#e8b84a' },
    { d: 'M-5 -7 C-11 -3 -11 5 -5 8 L5 8 C11 5 11 -3 5 -7Z', fill: 'c' },
    { d: 'M-5 8 L5 8 L5 10 L-5 10Z', fill: '#e8b84a' },
    { d: 'M0 10 L0 15', stroke: '#e8b84a', lw: 1.2 },
    { d: 'M-5 -7 C-2 -3 -2 5 -5 8 M5 -7 C2 -3 2 5 5 8', stroke: 'rgba(255,220,150,.55)', lw: 0.9 },
  ],
  seed: [
    { d: 'M0 8 L0 -3', stroke: 'rgba(255,255,255,.85)', lw: 1 },
    { d: 'M0 -3 L-4 -8 M0 -3 L0 -10 M0 -3 L4 -8 M0 -3 L-7 -5 M0 -3 L7 -5', stroke: 'rgba(255,255,255,.7)', lw: 0.8 },
    { d: 'M-1.7 9 a1.7 1.7 0 1 0 3.4 0 a1.7 1.7 0 1 0 -3.4 0', fill: 'c' },
  ],
  sparkle: [{ d: 'M0 -10 L2.4 -2.4 L10 0 L2.4 2.4 L0 10 L-2.4 2.4 L-10 0 L-2.4 -2.4Z', fill: 'c' }],
  bubble: [
    { d: 'M-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0', stroke: 'c', lw: 1.3 },
    { d: 'M-5 -3.5 a5.5 5.5 0 0 1 3.4 -2.4', stroke: 'rgba(255,255,255,.9)', lw: 1.3 },
  ],
  flake: [{ d: 'M0 -10 L0 10 M-8.7 -5 L8.7 5 M-8.7 5 L8.7 -5 M-2.4 -8.2 L0 -5.6 L2.4 -8.2 M-2.4 8.2 L0 5.6 L2.4 8.2', stroke: 'c', lw: 1.4 }],
  dot: [{ d: 'M-4.5 0 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0', fill: 'c' }],
};
const PATHS = {};
const pathOf = d => PATHS[d] || (PATHS[d] = new Path2D(d));

function paintShape(g, shape, colour) {
  for (const op of SHAPES[shape]) {
    const p = pathOf(op.d);
    if (op.fill) { g.fillStyle = op.fill === 'c' ? colour : op.fill; g.fill(p); }
    if (op.stroke) { g.strokeStyle = op.stroke === 'c' ? colour : op.stroke; g.lineWidth = op.lw || 1; g.lineCap = 'round'; g.stroke(p); }
  }
}

/* what falls or rises, per scene (each is a season's `effects`) */
const SCENES = {
  snow: { season: 'firstsnow', shapes: ['flake', 'flake', 'dot'], colours: ['#ffffff', '#e4f1ff', '#cfe3ff'], dir: 1, vy: [26, 70], size: [6, 13], sway: [10, 30], spin: 0.5, alpha: [0.5, 0.95], per: 17000, min: 40, max: 110 },
  lantern: { season: 'lunar', shapes: ['lantern'], colours: ['#e53935', '#ff5a4a', '#d62d2d', '#ff7043'], dir: -1, vy: [10, 28], size: [10, 19], sway: [6, 20], spin: 0.08, alpha: [0.6, 0.95], per: 52000, min: 12, max: 30 },
  leaf: { season: 'autumn', shapes: ['leaf'], colours: ['#e8883a', '#c8501e', '#f0b23c', '#a63d1a', '#d9a441', '#8f3a14'], dir: 1, vy: [26, 70], size: [7, 15], sway: [18, 46], spin: 1.6, alpha: [0.55, 0.95], per: 22000, min: 26, max: 62 },
  seed: { season: 'earth', shapes: ['seed', 'leaf', 'seed'], colours: ['#6fd08c', '#3fb27f', '#a6e3a1', '#7fd3c4'], dir: -1, vy: [10, 30], size: [8, 15], sway: [14, 36], spin: 0.7, alpha: [0.5, 0.9], per: 26000, min: 24, max: 52 },
  glint: { season: 'summer', shapes: ['sparkle', 'bubble', 'bubble'], colours: ['#ffffff', '#ffe08a', '#9ff5ee'], dir: -1, vy: [14, 40], size: [6, 14], sway: [10, 26], spin: 0.3, alpha: [0.4, 0.9], per: 30000, min: 20, max: 46 },
};
const ORDER = ['snow', 'lantern', 'leaf', 'seed', 'glint'];
const ID_TO_SCENE = Object.fromEntries(ORDER.map(k => [SCENES[k].season, k]));
const SPARKS = ['#ffd24a', '#ff6a5c', '#ffb23a', '#ffffff', '#ff8a4a'];

export function mountSeasonsMore(host) {
  const { h, icon } = api;
  const offs = [];
  const F = { w: 0, h: 0, ps: [], scene: null, show: null, trialShown: false, trialCards: new Set() };
  let still = null, stillKind = '';
  let pill = null, hunt = null, tryPill = null, card = null, dlg = null;
  let trialFound = [];

  const mobile = () => document.body.classList.contains('is-mobile');
  const trialId = () => SEASON.trying()?.id || null;

  /* ---------------- which weather ---------------- */
  function sceneOf() {
    const t = trialId();
    const order = ORDER.slice().sort((a, b) => (SCENES[b].season === t) - (SCENES[a].season === t));
    return order.find(k => SEASON.part(SCENES[k].season, 'effects')) || null;
  }

  /* ---------------- particles ---------------- */
  function spawn(sc, anywhere) {
    const depth = Math.random();
    const down = sc.dir > 0;
    return {
      x: rnd(-10, F.w + 10),
      y: anywhere ? rnd(0, F.h) : down ? rnd(-40, -8) : F.h + rnd(10, 50),
      s: sc.size[0] + depth * (sc.size[1] - sc.size[0]),
      vy: sc.dir * (sc.vy[0] + depth * (sc.vy[1] - sc.vy[0])),
      sway: rnd(sc.sway[0], sc.sway[1]), hz: rnd(0.08, 0.28), ph: rnd(0, 6.283),
      a: sc.alpha[0] + depth * (sc.alpha[1] - sc.alpha[0]),
      rot: rnd(0, 6.283), spin: rnd(-sc.spin, sc.spin),
      shape: pick(sc.shapes), col: pick(sc.colours),
    };
  }
  function fill() {
    const sc = SCENES[F.scene];
    if (!sc) { F.ps = []; return; }
    const n = Math.round(clamp((F.w * F.h) / sc.per, sc.min, sc.max));
    while (F.ps.length < n) F.ps.push(spawn(sc, true));
    F.ps.length = n;
  }

  /* ---------------- the lantern festival's fireworks ---------------- */
  function startShow() {
    F.show = { born: performance.now(), dur: 14, next: 0, rockets: [], sparks: [], t: 0 };
  }
  function endShow() { F.show = null; }
  function drawShow(g, dt) {
    const sh = F.show;
    sh.t += dt * FAST;
    if (sh.t < sh.dur - 3 && sh.t >= sh.next) {
      sh.next = sh.t + rnd(0.5, 1.0);
      const x = rnd(F.w * 0.15, F.w * 0.85);
      sh.rockets.push({ x, y: F.h, ty: rnd(F.h * 0.14, F.h * 0.45), col: pick(SPARKS), age: 0 });
    }
    g.globalCompositeOperation = 'lighter';
    sh.rockets = sh.rockets.filter(r => {
      r.age += dt * FAST;
      r.y -= (F.h * 0.9) * dt * FAST;
      g.fillStyle = 'rgba(255,230,170,.9)'; g.fillRect(r.x - 1, r.y, 2, 9);
      if (r.y > r.ty) return true;
      for (let i = 0; i < 30; i++) { const a = (i / 30) * 6.283 + rnd(-0.1, 0.1), v = rnd(60, 150); sh.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rnd(1.1, 1.8), col: r.col }); }
      return false;
    });
    sh.sparks = sh.sparks.filter(p => {
      p.life += dt * FAST;
      if (p.life > p.max) return false;
      p.vy += 55 * dt * FAST; p.vx *= 0.985; p.x += p.vx * dt * FAST; p.y += p.vy * dt * FAST;
      g.globalAlpha = 1 - p.life / p.max;
      g.fillStyle = p.col; g.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
      return true;
    });
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (sh.t >= sh.dur) endShow();
  }

  /* ---------------- the one canvas ---------------- */
  const weather = seasonCanvas(host, {
    className: 'sm-fx',
    wanted: () => !!sceneOf(),
    start: S => { S.cv.dataset.scene = F.scene = sceneOf(); },
    resize: S => { F.w = S.w; F.h = S.h; F.ps = []; fill(); },
    draw: (g, dt, now, S) => {
      const now2 = sceneOf();
      if (now2 !== F.scene) { F.scene = now2; S.cv.dataset.scene = now2 || ''; F.ps = []; fill(); }
      const sc = SCENES[F.scene];
      if (sc) {
        for (const p of F.ps) {
          p.ph += dt * p.hz * 6.283;
          p.y += p.vy * dt;
          p.rot += p.spin * dt;
          const gone = sc.dir > 0 ? p.y > F.h + 30 : p.y < -40;
          if (gone) { Object.assign(p, spawn(sc, false)); continue; }
          const edge = sc.dir > 0 ? Math.min(1, (p.y + 20) / 80) : Math.min(1, (F.h + 40 - p.y) / 80);
          g.globalAlpha = p.a * Math.max(0, edge);
          g.save();
          g.translate(p.x + Math.sin(p.ph) * p.sway, p.y);
          g.rotate(sc.shapes[0] === 'lantern' ? Math.sin(p.ph) * 0.18 : p.rot + Math.sin(p.ph) * 0.3);
          g.scale(p.s / 13, p.s / 13);
          paintShape(g, p.shape, p.col);
          g.restore();
        }
        g.globalAlpha = 1;
      }
      if (F.show) drawShow(g, dt);
    },
    stop: () => { F.ps = []; endShow(); },
  });

  /* ---------------- stills, for reduced motion ---------------- */
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  function shapeSvg(shape, colour) {
    const g = el('g', {});
    for (const op of SHAPES[shape]) {
      const a = { d: op.d };
      a.fill = op.fill ? (op.fill === 'c' ? colour : op.fill) : 'none';
      if (op.stroke) { a.stroke = op.stroke === 'c' ? colour : op.stroke; a['stroke-width'] = op.lw || 1; a['stroke-linecap'] = 'round'; }
      g.append(el('path', a));
    }
    return g;
  }
  function stillArt(kind) {
    const sc = SCENES[kind];
    const rand = seeded(kind.length * 7919 + 29);
    const svg = el('svg', { width: '100%', height: '100%', 'aria-hidden': 'true', focusable: 'false' });
    for (let i = 0; i < 22; i++) {
      const size = sc.size[0] + rand() * (sc.size[1] - sc.size[0]);
      const s = el('svg', { x: rand() * 96 + '%', y: rand() * 92 + '%', width: size * 2.2, height: size * 2.2, viewBox: '-13 -16 26 32', overflow: 'visible' });
      const g = shapeSvg(sc.shapes[i % sc.shapes.length], sc.colours[i % sc.colours.length]);
      g.setAttribute('opacity', String(sc.alpha[0] + rand() * (sc.alpha[1] - sc.alpha[0])));
      g.setAttribute('transform', `rotate(${sc.shapes[0] === 'lantern' ? Math.round(rand() * 20 - 10) : Math.round(rand() * 360)})`);
      s.append(g); svg.append(s);
    }
    if (kind === 'lantern' && (SEASON.isLunarDay() || trialId() === 'lunar')) {
      for (let b = 0; b < 3; b++) {
        const cx = 20 + b * 28 + rand() * 6, cy = 14 + rand() * 24, col = SPARKS[b];
        const s = el('svg', { x: cx + '%', y: cy + '%', width: 120, height: 120, viewBox: '-13 -13 26 26', overflow: 'visible' });
        for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283; s.append(el('line', { x1: Math.cos(a) * 3, y1: Math.sin(a) * 3, x2: Math.cos(a) * 12, y2: Math.sin(a) * 12, stroke: col, 'stroke-width': 1.1, 'stroke-linecap': 'round' })); }
        svg.append(s);
      }
    }
    return svg;
  }
  function syncStill() {
    const kind = reducedMotion() && !mobile() ? sceneOf() || '' : '';
    if (kind === stillKind && (kind ? still?.isConnected : !still)) return;
    still?.remove(); still = null; stillKind = '';
    if (!kind) return;
    const d = host.querySelector('.desktop');
    if (!d) return;
    still = h('div.sm-still', { 'aria-hidden': 'true', dataset: { kind } });
    still.append(stillArt(kind));
    const wp = d.querySelector('.wp');
    let at = wp ? wp.nextSibling : d.firstChild;
    while (at && (at.classList?.contains('os-skin') || at.classList?.contains('wp-vis'))) at = at.nextSibling;
    d.insertBefore(still, at);
    stillKind = kind;
  }

  /* ================================================================
     a dialog and a card, for the things you do rather than watch
     ================================================================ */
  function closeDialog() { dlg?.remove(); dlg = null; document.removeEventListener('keydown', onKey, true); }
  function onKey(e) { if (e.key === 'Escape' && dlg) { e.stopPropagation(); closeDialog(); } }
  function dialog(title, ic, ...kids) {
    closeDialog();
    const box = h('div.sm-dialog__box', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sm-dialog__h', icon(ic), h('b', { text: title }),
        h('button.ibtn', { type: 'button', 'aria-label': `Close ${title}`, onclick: closeDialog }, icon('x'))),
      ...kids);
    dlg = h('div.sm-dialog', { dataset: { fk: 'sm-dialog' }, onclick: e => { if (e.target === dlg) closeDialog(); } }, box);
    host.appendChild(dlg);
    document.addEventListener('keydown', onKey, true);
    return box;
  }
  function showCard(key, ic, title, text, label, run) {
    card?.remove();
    card = h('div.sm-card', { role: 'region', 'aria-label': title, dataset: { card: key } },
      h('div.sm-card__art', { 'aria-hidden': 'true' }, icon(ic, { size: 34 })),
      h('div.sm-card__t', h('b', { text: title }), h('small', { text })),
      h('div.sm-card__b',
        h('button.btn.btn--sm', { type: 'button', onclick: () => { card?.remove(); card = null; } }, 'Not now'),
        h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => { card?.remove(); card = null; run(); } }, label)));
    host.appendChild(card);
  }

  /* ---- the gratitude list ---- */
  function openGratitude() {
    const list = h('ul.sm-list', { 'aria-label': 'Things you are grateful for' });
    const input = h('input', { type: 'text', maxlength: String(KIT.GRATITUDE_LEN), placeholder: 'Something you are grateful for', 'aria-label': 'Something you are grateful for', dataset: { fk: 'grat-in' },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
    const msg = h('small', { role: 'status', 'aria-live': 'polite' });
    function paint() {
      const items = KIT.gratitude();
      list.replaceChildren(...(items.length ? items.map(x => h('li', { dataset: { id: x.id } },
        h('span', { text: x.text }),
        h('button.ibtn', { type: 'button', 'aria-label': `Remove “${x.text}”`, onclick: () => { KIT.removeGratitude(x.id); paint(); } }, icon('trash')))) : [h('li', h('span', { text: 'Nothing here yet. One thing is enough.' }))]));
      msg.textContent = items.length ? `${items.length} thing${items.length === 1 ? '' : 's'}. They stay on this device.` : 'They stay on this device.';
    }
    function add() {
      const e = KIT.addGratitude(input.value);
      if (e) { input.value = ''; paint(); } else if (input.value.trim()) msg.textContent = 'The list is full (100). Remove one to add another.';
      input.focus();
    }
    paint();
    dialog(SEASON.isThanksgiving() ? 'Happy Thanksgiving' : 'Gratitude list', 'heart',
      h('p', { text: 'What are you grateful for? Add a line whenever one comes to mind.' }),
      h('div.sm-row', h('div.field', input), h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'grat-add' }, onclick: add }, icon('plus'), h('span', { text: 'Add' }))),
      list, msg);
    input.focus();
  }

  /* ---- Pi Day ---- */
  function openPi(tab = 'digits') {
    const year = new Date().getFullYear();
    const body = h('div.col', { style: { gap: 'var(--sp-3)' } });
    const tabs = h('div.tabs', { role: 'group', 'aria-label': 'Pi Day' },
      ...[['digits', 'Digits'], ['puzzles', 'Puzzles']].map(([id, label]) => h('button', { type: 'button', text: label, dataset: { v: id }, onclick: () => show(id) })));
    function show(id) {
      [...tabs.children].forEach(b => { const on = b.dataset.v === id; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      body.replaceChildren(...(id === 'digits' ? digits() : puzzles()));
    }
    function digits() {
      const view = h('div.sm-digits', { 'aria-live': 'polite', dataset: { fk: 'pi-view' } });
      const say = h('small', { role: 'status', dataset: { fk: 'pi-say' } });
      const best = h('small', { text: KIT.piBest() ? `Your best: ${KIT.piBest()} digits.` : 'No score yet.' });
      const peek = h('div.sm-digits', { hidden: true, text: `3.${KIT.PI_DIGITS}` });
      const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', placeholder: '3.14…', 'aria-label': 'Digits of pi, after 3 point', dataset: { fk: 'pi-in' },
        oninput: update });
      function update() {
        const r = KIT.checkDigits(input.value);
        view.replaceChildren(h('span', { text: '3.' }), h('span.ok', { text: r.typed.slice(0, r.right) }), r.wrong !== null || r.nonDigit ? h('span.bad', { text: r.typed.slice(r.right) }) : r.typed.slice(r.right));
        say.textContent = r.done ? `All ${r.right} digits. That is the whole list here.`
          : r.nonDigit ? `Digits only, please. ${r.right} right so far.`
          : r.wrong !== null ? `Digit ${r.wrong + 1} is wrong; it is ${r.next}. You had ${r.right} right.`
          : r.right ? `${r.right} right so far.` : 'Type from memory, no spaces needed.';
        if (r.right) KIT.savePiScore(r.right);
        best.textContent = KIT.piBest() ? `Your best: ${KIT.piBest()} digits.` : 'No score yet.';
      }
      update();
      return [
        h('p', { text: 'How many digits of π do you know? Type them after “3.” — each right digit turns green, and your best is kept on this device.' }),
        h('div.sm-row', h('div.field', input), h('button.btn.btn--sm', { type: 'button', onclick: () => { input.value = ''; update(); input.focus(); } }, icon('rotate-ccw'), h('span', { text: 'Start over' }))),
        view, say, best,
        h('button.btn.btn--sm', { type: 'button', 'aria-expanded': 'false', onclick: e => { peek.hidden = !peek.hidden; e.currentTarget.setAttribute('aria-expanded', String(!peek.hidden)); } }, icon('eye'), h('span', { text: 'Peek at the first 50' })),
        peek,
      ];
    }
    function puzzles() {
      const qs = KIT.piPuzzles(year);
      let right = 0;
      const score = h('small', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'pi-score' }, text: 'Five questions. Answers are whole numbers.' });
      const done = new Set();
      return [
        h('p', { text: 'Five short questions about circles — the same five for everyone today.' }),
        ...qs.map((q, i) => {
          const box = h('div.sm-q', { dataset: { q: String(i) } });
          const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `Answer to question ${i + 1}`, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(); } } });
          const res = h('small', { 'aria-live': 'polite' });
          function go() {
            if (done.has(i) || !input.value.trim()) return;
            const ok = KIT.piAnswerOk(q, input.value);
            res.textContent = ok ? `Right. ${q.note}` : `Not quite. ${q.note} The answer is ${q.a}.`;
            box.classList.add(ok ? 'is-right' : 'is-wrong');
            input.disabled = true; done.add(i);
            if (ok) right++;
            score.textContent = done.size === qs.length ? `${right} of ${qs.length} right.` : `${right} right so far, ${qs.length - done.size} to go.`;
          }
          box.append(h('b', { text: `${i + 1}. ${q.q}` }), h('div.sm-row', h('div.field', input), h('button.btn.btn--sm', { type: 'button', onclick: go }, 'Check')), res);
          return box;
        }),
        score,
      ];
    }
    dialog('Pi Day', 'calculator', tabs, body);
    show(tab);
  }

  /* ---- back to school ---- */
  function openKit() {
    const year = new Date().getFullYear();
    const list = h('ul.sm-list', { 'aria-label': 'Back-to-school checklist' });
    const prog = h('small', { role: 'status', 'aria-live': 'polite' });
    function paint() {
      const done = KIT.kitDone(year);
      list.replaceChildren(...KIT.KIT.map(k => {
        const on = done.includes(k.id);
        const have = k.app && api.getApp?.(k.app);
        return h('li', { class: on ? 'is-done' : '', dataset: { id: k.id } },
          h('button.switch' + (on ? '.is-on' : ''), { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': k.text, onclick: () => { KIT.kitToggle(year, k.id); paint(); } }),
          h('span', { text: k.text }),
          have ? h('button.btn.btn--sm', { type: 'button', onclick: () => { closeDialog(); api.openApp(k.app); } }, k.go) : null);
      }));
      prog.textContent = `${done.length} of ${KIT.KIT.length} done`;
    }
    paint();
    dialog('Back-to-school kit', 'file-text',
      h('p', { text: 'A short list for the first week. Tick a step when it is done; the buttons open the app for it.' }), list, prog);
  }

  const OPEN = { gratitude: openGratitude, pi: openPi, kit: openKit };
  offs.push(bus.on('seasons:open', which => { try { OPEN[which]?.(); } catch (e) { console.warn('[StaticOS] seasons', e); } }));

  /* ================================================================
     the clover hunt
     ================================================================ */
  const cloverSvg = four => {
    const s = el('svg', { viewBox: '-14 -14 28 28', 'aria-hidden': 'true', focusable: 'false' });
    const n = four ? 4 : 3;
    for (let i = 0; i < n; i++) {
      s.append(el('path', { d: 'M0 0 C-6 -3 -10 -11 -4.6 -13 C-1.6 -14 0 -11 0 -8.6 C0 -11 1.6 -14 4.6 -13 C10 -11 6 -3 0 0Z', fill: four ? '#35d97a' : '#2fb866', stroke: '#126b36', 'stroke-width': 0.8, transform: `rotate(${(360 / n) * i + (four ? 45 : 0)})` }));
    }
    s.append(el('path', { d: 'M0 0 C1 5 3 9 6 12', fill: 'none', stroke: '#126b36', 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
    return s;
  };
  let huntKey = '';
  const huntYear = () => new Date().getFullYear();
  const foundNow = () => (trialId() === 'stpatrick' ? trialFound : KIT.cloversFound(huntYear()));

  function paintHuntPill(announce) {
    const found = foundNow().length;
    const all = found >= KIT.CLOVERS;
    const text = all ? 'Found them all!' : `${found} of ${KIT.CLOVERS}`;
    if (!pill) { pill = h('div.sm-pill', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'clover-pill' } }, icon('sparkles'), h('span', { text: 'Clover hunt' }), h('b')); host.appendChild(pill); }
    pill.querySelector('b').textContent = text;
    if (announce) pill.setAttribute('aria-label', `Clover hunt: ${text}`);
  }
  function syncHunt() {
    const want = SEASON.part('stpatrick', 'hunt') && !mobile();
    const d = host.querySelector('.desktop');
    if (!want || !d) {
      if (hunt) { hunt.remove(); hunt = null; huntKey = ''; }
      if (pill && !want) { pill.remove(); pill = null; }
      return;
    }
    const key = `${huntYear()}|${trialId() === 'stpatrick'}`;
    if (hunt && huntKey === key && hunt.isConnected) { paintHuntPill(false); return; }
    hunt?.remove();
    huntKey = key;
    hunt = h('div.clover-hunt', { dataset: { fk: 'clover-hunt' } });
    const found = foundNow();
    for (const c of KIT.cloverSet(huntYear())) {
      if (found.includes(c.i)) continue;
      hunt.append(h('button.clover', {
        type: 'button', style: { left: `${(c.x * 100).toFixed(2)}%`, top: `${(c.y * 100).toFixed(2)}%` },
        'aria-label': c.four ? 'Four-leaf clover' : 'Clover', dataset: { i: String(c.i), four: c.four ? '1' : '0' },
        onclick: e => {
          const b = e.currentTarget;
          if (b.classList.contains('is-found')) return;
          if (trialId() === 'stpatrick') { if (!trialFound.includes(c.i)) trialFound = [...trialFound, c.i]; }
          else KIT.findClover(huntYear(), c.i);
          b.classList.add('is-found');
          b.disabled = true;
          setTimeout(() => b.remove(), reducedMotion() ? 0 : 340);
          paintHuntPill(true);
          if (foundNow().length >= KIT.CLOVERS) api.notify({ icon: 'sparkles', title: 'You found every clover', message: 'All nine, including the lucky four-leaf one.', timeout: 5000 });
        },
      }, cloverSvg(c.four)));
    }
    const wp = d.querySelector('.wp');
    let at = wp ? wp.nextSibling : d.firstChild;
    while (at && (at.classList?.contains('os-skin') || at.classList?.contains('wp-vis') || at.classList?.contains('sm-fx') || at.classList?.contains('sm-still'))) at = at.nextSibling;
    d.insertBefore(hunt, at);
    paintHuntPill(false);
  }

  /* ================================================================
     the clock: cards and shows, claimed so they play once
     ================================================================ */
  function check() {
    const now = new Date();
    const year = now.getFullYear();
    const t = trialId();
    /* Lunar New Year: fireworks once on the day (or once per trial, claiming nothing) */
    if (!F.show && weather.canvas) {
      if (t === 'lunar') { if (!F.trialShown) { F.trialShown = true; startShow(); } }
      else if (SEASON.isLunarDay(now) && SEASON.part('lunar', 'effects', now) && CEL.claim('lunar', year)) startShow();
    }
    if (t !== 'lunar') F.trialShown = false;
    if (F.show && Math.abs(performance.now() - F.show.born) > 60_000) endShow();
    /* cards, once a year (a trial shows them and spends nothing) */
    const once = (id, season, part, ok, run) => {
      if (card || !SEASON.part(season, part, now) || !ok) return;
      if (t === season) { if (!F.trialCards.has(id)) { F.trialCards.add(id); run(); } return; }
      if (!CEL.claimed(id, year) && CEL.claim(id, year)) run();
    };
    if (!t) F.trialCards.clear();
    if (!card) {
      once('thanks', 'autumn', 'gratitude', SEASON.isThanksgiving(now) || t === 'autumn', () => showCard('thanks', 'heart', 'Happy Thanksgiving', 'Want to write down what you are grateful for? It stays on this device.', 'Open the list', openGratitude));
      once('pi', 'piday', 'challenge', true, () => showCard('pi', 'calculator', 'Happy Pi Day', 'How many digits of π can you type from memory? There are five circle puzzles too.', 'Try it', () => openPi()));
      once('kit', 'school', 'kit', true, () => showCard('kit', 'file-text', 'Back to school', 'A short checklist for the first week, with the study apps a click away.', 'Open the kit', openKit));
    }
    paintTry();
  }

  /* ---- the "trying" pill ---- */
  function paintTry() {
    const t = SEASON.trying();
    if (!t) { tryPill?.remove(); tryPill = null; return; }
    const left = Math.max(0, Math.ceil((t.until - Date.now()) / 1000));
    if (!tryPill) {
      tryPill = h('div.sm-pill.sm-pill--try', { role: 'status', dataset: { fk: 'try-pill' } },
        icon('eye'), h('span'), h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'try-stop' }, onclick: () => SEASON.stopTrying() }, 'Stop'));
      host.appendChild(tryPill);
    }
    tryPill.querySelector('span').textContent = `Trying ${SEASON.SEASONS[t.id]?.name || t.id} — ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
  }

  function sync() {
    check(); weather.sync(); syncStill(); syncHunt();
    if (!trialId()) trialFound = [];
  }
  sync();
  offs.push(
    bus.on('tick:1s', check),
    bus.on('tick:5s', () => { syncStill(); syncHunt(); }),
    bus.on('season:change', sync),
    bus.on('season:try', sync),
    bus.on('firstsnow:found', e => {
      api.notify({ icon: 'snowflake', title: 'First snow', message: `It’s snowing near ${e?.place || 'you'}. Flakes are on your desktop for today.`, timeout: 7000 });
      sync();
    }),
    api.store.sub('prefs', sync),
  );
  SNOW.init();

  return () => {
    offs.forEach(f => { try { f(); } catch (e) {} });
    weather.destroy();
    still?.remove(); pill?.remove(); hunt?.remove(); tryPill?.remove(); card?.remove(); closeDialog();
  };
}

export default mountSeasonsMore;
