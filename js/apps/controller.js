/* ============================================================
   controller.js — Controller Center: every input device, tested
   live, plus the gamepad → keyboard bridge settings.

   Five tabs, each a real measurement of what the browser reports:

   · Controllers — navigator.getGamepads(), polled once per frame
     while the tab is open. A standard-layout diagram (triggers fill
     with their analog value, sticks show the raw position as a dot
     and the dead-zoned position as the cap, inside a ring the size
     of the dead zone), a larger plot of each stick beside the dead
     zone slider (so its effect is visible at rest), the raw
     button/axis values, the mapping the browser reports, and a
     rumble test only where the browser exposes vibrationActuator.
     Browsers reveal a gamepad only after a button is pressed, and
     the empty state says exactly that.
   · Keyboard — an ANSI layout lit by KeyboardEvent.code, key /
     code / location / legacy keyCode for the last key, how many
     keys are held at once (rollover) and the last 10 events. While
     focus is in this tab, keys stop at the app root so they cannot
     trigger StaticOS shortcuts — except Cmd/Ctrl combos, which stay
     OS-level. Esc twice leaves the tester (it swallows Tab).
   · Mouse — buttons 0-4, wheel deltas and mode, pointer type,
     movement, double-click spacing and a measured event rate:
     pointermove events in the last second, plus the coalesced raw
     samples inside them (closer to the mouse's real polling rate).
   · Button mapping — which key each control sends through
     js/core/padmap.js, the "Play keyboard games with a controller"
     toggle, and a live preview bridge that dispatches into this
     panel only, so you can see the exact events a game would get.
   · Compatibility — the Static Arcade games, from their declared
     input: a game that reads the keyboard can be driven by the
     bridge; mouse/touch-only games cannot. Each has a Play button
     that opens it in the Arcade.

   opts.tab picks the tab ('pads' | 'keys' | 'mouse' | 'map' |
   'compat', or aliases like 'mapping'); reopening the singleton
   with a tab switches to it.

   Store: portal.controller = { deadzone, bridge, mapping, labels }
   (shape owned by padmap.js). Nothing here is simulated: with no
   controller connected, the Controllers tab shows no numbers.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as PM from '../core/padmap.js';
import { ARCADE } from '../arcade/index.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-controller-css')) {
  const l = document.createElement('link');
  l.id = 'feat-controller-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-controller.css';
  document.head.appendChild(l);
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/* ---------- svg -------------------------------------------------------- */
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  if (attrs && (attrs.nodeType || typeof attrs !== 'object')) { kids.unshift(attrs); attrs = {}; }
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
let seq = 0;

/* ---------- label styles ----------------------------------------------
   The standard mapping is positional (button 0 is the BOTTOM face
   button on every pad), so only the printed names differ. */
const STYLES = {
  xbox: { name: 'Xbox', a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT',
    select: 'View', start: 'Menu', home: 'Guide', l3: 'LS', r3: 'RS',
    tint: { a: '#6ad46a', b: '#ff6b6b', x: '#62a8ff', y: '#ffd35c' } },
  ps: { name: 'PlayStation', a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2',
    select: 'Share', start: 'Options', home: 'PS', l3: 'L3', r3: 'R3',
    tint: { a: '#8fb0ff', b: '#ff7a86', x: '#f59bd6', y: '#5fe0b4' } },
  nintendo: { name: 'Nintendo', a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR',
    select: '−', start: '+', home: 'Home', l3: 'LS', r3: 'RS', tint: {} },
};
/* the style a pad's name gives away, or null when it says nothing */
function detectStyle(id = '') {
  const t = String(id).toLowerCase();
  if (/045e|xbox|xinput/.test(t)) return 'xbox';     /* "Xbox Wireless Controller" — before Sony's plain "Wireless Controller" */
  if (/054c|playstation|dualsense|dualshock|^wireless controller|\bps[345]\b/.test(t)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con|switch/.test(t)) return 'nintendo';
  return null;
}
/* the person's choice, else the guess, else Xbox names (and the
   Controllers tab says it did not guess) */
const styleKey = gp => {
  const pref = PM.getConfig().labels;
  return STYLES[pref] ? pref : detectStyle(gp?.id) || 'xbox';
};

/* what each control is called in a given style */
const ARROW = { Up: '↑', Down: '↓', Left: '←', Right: '→' };
function inputLabel(inp, st) {
  if (st[inp.id]) return st[inp.id];
  if (inp.group === 'dpad') return 'D-pad ' + ARROW[inp.id[0].toUpperCase() + inp.id.slice(1)];
  const m = /^(ls|rs)(Up|Down|Left|Right)$/.exec(inp.id);
  if (m) return (m[1] === 'ls' ? 'Left stick ' : 'Right stick ') + ARROW[m[2]];
  return inp.name;
}

/* "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)" or
   Firefox's "054c-09cc-Wireless Controller" → { name, vendor, product } */
function parseId(id = '') {
  let vendor = '', product = '', name = String(id);
  let m = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(name);
  if (m) { vendor = m[1]; product = m[2]; }
  m = /^([0-9a-f]{4})-([0-9a-f]{4})-(.*)$/i.exec(name);
  if (m) { vendor = m[1]; product = m[2]; name = m[3]; }
  name = name.replace(/\s*\([^()]*(STANDARD GAMEPAD|Vendor:)[^()]*\)\s*$/i, '').trim() || 'Game controller';
  return { name, vendor: vendor.toLowerCase(), product: product.toLowerCase() };
}

/* Pads already announced on the bus ('gamepad:connected' { id, index }),
   keyed "index|id". Module-level so reopening the app does not announce
   a controller that never went away; a pad that disconnects is dropped
   from the set, so plugging it back in announces it again. */
const announced = new Set();

const fix = (v, d = 2) => (Number.isFinite(v) ? v : 0).toFixed(d);
const signed = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
const pct = v => Math.round(v * 100) + '%';

/* ======================================================================
   the controller diagram (viewBox 600×400) — shared by the empty state
   ====================================================================== */
const BODY = 'M175 76C225 66 375 66 425 76C490 86 520 112 535 160C556 228 572 300 556 346C542 382 494 386 470 356'
  + 'C446 326 428 312 396 310L204 310C172 312 154 326 130 356C106 386 58 382 44 346C28 300 44 228 65 160C80 112 110 86 175 76Z';
const LB_PATH = 'M112 94C128 70 172 56 244 56L246 73C182 73 148 83 128 102Z';
const RB_PATH = 'M488 94C472 70 428 56 356 56L354 73C418 73 452 83 472 102Z';
const T_TRAVEL = 26;

function diagram(stKey, { idle = false } = {}) {
  const st = STYLES[stKey] || STYLES.xbox;
  const id = 'ccd' + (++seq);
  const parts = {};
  const trig = {};
  const sticks = {};
  const defs = s('defs', {},
    s('linearGradient', { id: id + '-body', x1: '0', y1: '0', x2: '0', y2: '1' },
      s('stop', { offset: '0', class: 'cc-dia__g0' }), s('stop', { offset: '1', class: 'cc-dia__g1' })));
  const svg = s('svg', { viewBox: '0 0 600 400', class: 'cc-dia' + (idle ? ' is-idle' : ''), 'aria-hidden': 'true', focusable: 'false' }, defs);

  /* triggers, behind everything */
  for (const [key, x] of [['lt', 150], ['rt', 362]]) {
    defs.append(s('clipPath', { id: `${id}-${key}` }, s('rect', { x, y: 4, width: 88, height: 46, rx: 13 })));
    const fill = s('rect', { x, y: 50, width: 88, height: 0, class: 'cc-dia__tfill', 'clip-path': `url(#${id}-${key})` });
    const val = s('text', { x: x + 44, y: 40, class: 'cc-dia__tval' }, '');
    const g = s('g', { class: 'cc-dia__trig' },
      s('rect', { x, y: 4, width: 88, height: 46, rx: 13, class: 'cc-dia__tbase' }), fill,
      s('text', { x: x + 44, y: 24, class: 'cc-dia__lbl' }, st[key]), val);
    parts[key] = g;
    trig[key] = { fill, val, last: -1 };
    svg.append(g);
  }
  svg.append(s('path', { d: BODY, class: 'cc-dia__base' }));
  svg.append(s('path', { d: BODY, class: 'cc-dia__body', fill: `url(#${id}-body)` }));
  svg.append(s('path', { d: BODY, class: 'cc-dia__rim', transform: 'translate(300 222) scale(.94) translate(-300 -222)' }));
  /* bumpers ride the top edge, over the shell */
  for (const [key, d, tx] of [['lb', LB_PATH, 186], ['rb', RB_PATH, 414]]) {
    const g = s('g', { class: 'cc-dia__bump' }, s('path', { d }), s('text', { x: tx, y: 69, class: 'cc-dia__lbl cc-dia__lbl--sm' }, st[key]));
    parts[key] = g;
    svg.append(g);
  }

  /* sticks: well, travel limit, dead zone ring, raw dot, cap */
  for (const [key, cx, cy, press] of [['ls', 180, 168, 'l3'], ['rs', 365, 256, 'r3']]) {
    const dz = s('circle', { cx, cy, r: 0, class: 'cc-dia__dz' });
    const raw = s('circle', { cx, cy, r: 3.2, class: 'cc-dia__raw' });
    /* a plain cap with a grip ring: a printed "LS" here would sit under
       the raw-position dot. Pressing the stick (L3/R3) lights the cap. */
    const cap = s('g', { class: 'cc-dia__cap' }, s('circle', { cx, cy, r: 14 }), s('circle', { cx, cy, r: 9, class: 'cc-dia__grip' }));
    const g = s('g', { class: 'cc-dia__stick' },
      s('circle', { cx, cy, r: 40, class: 'cc-dia__well' }),
      s('circle', { cx, cy, r: T_TRAVEL, class: 'cc-dia__travel' }),
      s('path', { d: `M${cx - 34} ${cy}H${cx + 34}M${cx} ${cy - 34}V${cy + 34}`, class: 'cc-dia__cross' }),
      dz, cap, raw);
    parts[press] = cap;
    sticks[key] = { cx, cy, dz, raw, cap, last: '' };
    svg.append(g);
  }

  /* d-pad */
  {
    const cx = 235, cy = 256, a = 13, r = 38;
    svg.append(s('path', {
      class: 'cc-dia__plus',
      d: `M${cx - a} ${cy - r}H${cx + a}V${cy - a}H${cx + r}V${cy + a}H${cx + a}V${cy + r}H${cx - a}V${cy + a}H${cx - r}V${cy - a}H${cx - a}Z`,
    }));
    const arm = (key, x, y, ww, hh, tri) => {
      const g = s('g', { class: 'cc-dia__btn cc-dia__dpad' }, s('rect', { x, y, width: ww, height: hh, rx: 4 }), s('path', { d: tri, class: 'cc-dia__tri' }));
      parts[key] = g;
      svg.append(g);
    };
    arm('up', cx - 11, cy - 36, 22, 24, `M${cx - 5} ${cy - 19}L${cx} ${cy - 26}L${cx + 5} ${cy - 19}Z`);
    arm('down', cx - 11, cy + 12, 22, 24, `M${cx - 5} ${cy + 19}L${cx} ${cy + 26}L${cx + 5} ${cy + 19}Z`);
    arm('left', cx - 36, cy - 11, 24, 22, `M${cx - 19} ${cy - 5}L${cx - 26} ${cy}L${cx - 19} ${cy + 5}Z`);
    arm('right', cx + 12, cy - 11, 24, 22, `M${cx + 19} ${cy - 5}L${cx + 26} ${cy}L${cx + 19} ${cy + 5}Z`);
  }

  /* face buttons */
  {
    const fx = 420, fy = 168, o = 34;
    for (const [key, x, y] of [['a', fx, fy + o], ['b', fx + o, fy], ['x', fx - o, fy], ['y', fx, fy - o]]) {
      const tint = st.tint[key];
      const g = s('g', { class: 'cc-dia__btn cc-dia__face' },
        s('circle', { cx: x, cy: y, r: 16 }),
        s('text', { x, y: y + 5, class: 'cc-dia__glyph', style: tint ? `--tint:${tint}` : null }, st[key]));
      parts[key] = g;
      svg.append(g);
    }
  }

  /* select / start / home */
  for (const [key, x, y, r] of [['select', 258, 170, 11], ['start', 342, 170, 11], ['home', 300, 124, 15]]) {
    const g = s('g', { class: 'cc-dia__btn cc-dia__meta' }, s('circle', { cx: x, cy: y, r }));
    parts[key] = g;
    svg.append(g, s('text', { x, y: y + r + 14, class: 'cc-dia__cap-lbl' }, st[key]));
  }

  const lastOn = {};
  let lastDz = -1;
  function setDeadzone(dz) {
    if (dz === lastDz) return;
    lastDz = dz;
    for (const k of Object.keys(sticks)) sticks[k].dz.setAttribute('r', String(Math.max(0, dz * T_TRAVEL)));
  }
  function update(gp, dz) {
    setDeadzone(dz);
    for (const inp of PM.INPUTS) {
      if (inp.button === undefined) continue;
      const el = parts[inp.id];
      if (!el) continue;
      const on = PM.inputAmount(gp, inp, dz) > (inp.analog ? 0.04 : 0.5);
      if (lastOn[inp.id] !== on) { lastOn[inp.id] = on; el.classList.toggle('is-on', on); }
    }
    for (const key of ['lt', 'rt']) {
      const inp = PM.inputById(key);
      const v = Math.round(PM.inputAmount(gp, inp, dz) * 100) / 100;
      const t = trig[key];
      if (t.last === v) continue;
      t.last = v;
      t.fill.setAttribute('y', String(50 - 46 * v));
      t.fill.setAttribute('height', String(46 * v));
      t.val.textContent = v > 0 ? pct(v) : '';
    }
    const ax = gp.axes || [];
    for (const [key, ix, iy] of [['ls', 0, 1], ['rs', 2, 3]]) {
      const k = sticks[key];
      const rx = Math.max(-1, Math.min(1, Number(ax[ix]) || 0));
      const ry = Math.max(-1, Math.min(1, Number(ax[iy]) || 0));
      const [ax2, ay2] = PM.applyDeadzone(rx, ry, dz);
      const sig = `${rx.toFixed(3)},${ry.toFixed(3)},${dz}`;
      if (k.last === sig) continue;
      k.last = sig;
      k.raw.setAttribute('cx', String(k.cx + rx * T_TRAVEL));
      k.raw.setAttribute('cy', String(k.cy + ry * T_TRAVEL));
      k.cap.setAttribute('transform', `translate(${(ax2 * T_TRAVEL).toFixed(2)} ${(ay2 * T_TRAVEL).toFixed(2)})`);
      k.cap.classList.toggle('is-moved', ax2 !== 0 || ay2 !== 0);
    }
  }
  return { el: svg, update, setDeadzone };
}

/* ======================================================================
   a stick plot — one stick at a readable size, next to the dead-zone
   slider: the full range, the dead zone as a disc, the raw position
   (dot) and where the stick counts as pointing after the dead zone
   (ring, with its vector from the centre)
   ====================================================================== */
const PLOT_R = 46;
function stickPlot(h, name) {
  const dzEl = s('circle', { cx: 0, cy: 0, r: 0, class: 'cc-plot__dz' });
  const vec = s('path', { d: 'M0 0', class: 'cc-plot__vec' });
  const out = s('circle', { cx: 0, cy: 0, r: 6, class: 'cc-plot__out' });
  const raw = s('circle', { cx: 0, cy: 0, r: 2.8, class: 'cc-plot__raw' });
  const svg = s('svg', { viewBox: '-54 -54 108 108', class: 'cc-plot__svg', 'aria-hidden': 'true', focusable: 'false' },
    s('circle', { cx: 0, cy: 0, r: PLOT_R, class: 'cc-plot__bound' }),
    s('path', { d: `M${-PLOT_R} 0H${PLOT_R}M0 ${-PLOT_R}V${PLOT_R}`, class: 'cc-plot__cross' }),
    dzEl, vec, out, raw);
  const state = h('span.cc-plot__state');
  const el = h('figure.cc-plot', svg, h('figcaption', h('b', { text: name }), state));
  let last = '';
  let lastDz = -1;
  function setDeadzone(dz) {
    if (dz === lastDz) return;
    lastDz = dz;
    dzEl.setAttribute('r', String(Math.max(0, dz * PLOT_R)));
  }
  function update(rx, ry, dz) {
    setDeadzone(dz);
    const sig = `${rx.toFixed(3)},${ry.toFixed(3)},${dz}`;
    if (sig === last) return;
    last = sig;
    const [x, y] = PM.applyDeadzone(rx, ry, dz);
    const mag = Math.min(1, Math.hypot(x, y));
    raw.setAttribute('cx', (rx * PLOT_R).toFixed(2));
    raw.setAttribute('cy', (ry * PLOT_R).toFixed(2));
    out.setAttribute('cx', (x * PLOT_R).toFixed(2));
    out.setAttribute('cy', (y * PLOT_R).toFixed(2));
    vec.setAttribute('d', `M0 0L${(x * PLOT_R).toFixed(2)} ${(y * PLOT_R).toFixed(2)}`);
    el.classList.toggle('is-moved', mag > 0);
    const rawMag = Math.hypot(rx, ry);
    state.textContent = mag > 0 ? `${pct(mag)} tilt` : rawMag >= 0.005 ? 'inside dead zone' : 'centred';
  }
  return { el, update, setDeadzone };
}

/* ======================================================================
   keyboard layout (ANSI, in key units)
   ====================================================================== */
const SHIFTED = {
  Backquote: '~', Digit1: '!', Digit2: '@', Digit3: '#', Digit4: '$', Digit5: '%', Digit6: '^', Digit7: '&',
  Digit8: '*', Digit9: '(', Digit0: ')', Minus: '_', Equal: '+', BracketLeft: '{', BracketRight: '}',
  Backslash: '|', Semicolon: ':', Quote: '"', Comma: '<', Period: '>', Slash: '?',
};
function kbLayout(numpad) {
  const out = [];
  const row = (y, x0, keys) => {
    let x = x0;
    for (const k of keys) {
      if (typeof k === 'number') { x += k; continue; }
      const [code, label, w = 1, hh = 1] = k;
      out.push({ code, label, x, y, w, h: hh });
      x += w;
    }
  };
  const letters = str => [...str].map(c => [`Key${c}`, c]);
  const F = n => [`F${n}`, `F${n}`];
  const meta = isMac ? '⌘' : 'Win';
  const alt = isMac ? '⌥' : 'Alt';
  row(0, 0, [['Escape', 'Esc'], 1, F(1), F(2), F(3), F(4), 0.5, F(5), F(6), F(7), F(8), 0.5, F(9), F(10), F(11), F(12)]);
  row(0, 15.25, [['PrintScreen', 'PrtSc'], ['ScrollLock', 'ScrLk'], ['Pause', 'Pause']]);
  row(1.25, 0, [['Backquote', '`'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(n => [`Digit${n}`, String(n)]),
    ['Minus', '-'], ['Equal', '='], ['Backspace', 'Backspace', 2]]);
  row(1.25, 15.25, [['Insert', 'Ins'], ['Home', 'Home'], ['PageUp', 'PgUp']]);
  row(2.25, 0, [['Tab', 'Tab', 1.5], ...letters('QWERTYUIOP'), ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\', 1.5]]);
  row(2.25, 15.25, [['Delete', 'Del'], ['End', 'End'], ['PageDown', 'PgDn']]);
  row(3.25, 0, [['CapsLock', 'Caps', 1.75], ...letters('ASDFGHJKL'), ['Semicolon', ';'], ['Quote', "'"], ['Enter', 'Enter', 2.25]]);
  row(4.25, 0, [['ShiftLeft', 'Shift', 2.25], ...letters('ZXCVBNM'), ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', 'Shift', 2.75]]);
  row(4.25, 16.25, [['ArrowUp', '↑']]);
  row(5.25, 0, [['ControlLeft', 'Ctrl', 1.25], ['MetaLeft', meta, 1.25], ['AltLeft', alt, 1.25], ['Space', '', 6.25],
    ['AltRight', alt, 1.25], ['MetaRight', meta, 1.25], ['ContextMenu', 'Menu', 1.25], ['ControlRight', 'Ctrl', 1.25]]);
  row(5.25, 15.25, [['ArrowLeft', '←'], ['ArrowDown', '↓'], ['ArrowRight', '→']]);
  if (numpad) {
    row(1.25, 18.5, [['NumLock', 'Num'], ['NumpadDivide', '/'], ['NumpadMultiply', '*'], ['NumpadSubtract', '−']]);
    row(2.25, 18.5, [['Numpad7', '7'], ['Numpad8', '8'], ['Numpad9', '9'], ['NumpadAdd', '+', 1, 2]]);
    row(3.25, 18.5, [['Numpad4', '4'], ['Numpad5', '5'], ['Numpad6', '6']]);
    row(4.25, 18.5, [['Numpad1', '1'], ['Numpad2', '2'], ['Numpad3', '3'], ['NumpadEnter', 'Enter', 1, 2]]);
    row(5.25, 18.5, [['Numpad0', '0', 2], ['NumpadDecimal', '.']]);
  }
  return { keys: out, W: numpad ? 22.5 : 18.25, H: 6.25 };
}
/* what a key says when the keyboard is drawn very small */
const SHORT = {
  Backspace: '⌫', PrintScreen: 'Prt', ScrollLock: 'Scr', Pause: 'Brk', Insert: 'Ins', Home: 'Hm', PageUp: 'PU',
  PageDown: 'PD', Delete: 'Del', End: 'End', ContextMenu: '☰', NumLock: 'Num', CapsLock: 'Cap', NumpadEnter: '↵', Enter: '↵',
};
const LOCATION = ['Standard', 'Left', 'Right', 'Numpad'];

/* Arrow keys inside a role="radiogroup": move to the next radio and
   choose it (the WAI-ARIA radio pattern). Radios use a roving tabindex,
   so the group is one Tab stop. */
function radioNav(e) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  const radios = [...e.currentTarget.querySelectorAll('[role="radio"]')];
  const i = radios.indexOf(document.activeElement);
  if (i < 0) return;
  let next = null;
  if (step) next = radios[(i + step + radios.length) % radios.length];
  else if (e.key === 'Home') next = radios[0];
  else if (e.key === 'End') next = radios[radios.length - 1];
  if (!next) return;
  e.preventDefault();
  e.stopPropagation();
  next.focus();
  next.click();
}
const rove = (btn, on) => { btn.tabIndex = on ? 0 : -1; };
const showKey = k => (k === ' ' ? 'Space' : k === '' ? '(none)' : k);

/* ======================================================================
   Arcade compatibility data
   ----------------------------------------------------------------------
   js/arcade/index.js says WHICH input a game reads; these are the keys
   each game's code actually listens for (js/arcade/<id>.js), so the
   tab can say whether the current mapping reaches them. Each control
   is [label, ...slots]; a slot is met when any pad input is mapped to
   one of its codes (a slot may be a function of the config, for keys
   that follow the mapping). A keyboard game missing from this table is
   shown as "check its controls" rather than guessed at.
   Memory and Mines are listed as mouse / touch games in index.js, but
   their code reads the keyboard too — arrows walk the board, Space /
   Enter act, and Mines flags with F or whatever key the pad's X sends —
   so the bridge plays them; the tab says so (and why) below.
   ====================================================================== */
const K_UP = ['ArrowUp', 'KeyW'], K_DOWN = ['ArrowDown', 'KeyS'], K_LEFT = ['ArrowLeft', 'KeyA'], K_RIGHT = ['ArrowRight', 'KeyD'];
const K_ACT = ['Space', 'Enter', 'NumpadEnter'];
const ARROWS = [['ArrowUp'], ['ArrowDown'], ['ArrowLeft'], ['ArrowRight']];
const GAME_KEYS = {
  snake:    [['Move', K_UP, K_DOWN, K_LEFT, K_RIGHT]],
  pong:     [['Paddle', K_UP, K_DOWN], ['Serve', ['Space']]],
  breakout: [['Move', K_LEFT, K_RIGHT], ['Launch', ['Space', 'ArrowUp', 'KeyW']]],
  flap:     [['Flap', ['Space', 'ArrowUp', 'KeyW']]],
  racer:    [['Steer', K_LEFT, K_RIGHT]],            /* steering starts a run too; Space is optional */
  g2048:    [['Slide', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Undo (once a round)', ['KeyZ', 'KeyU', 'Backspace']]],
  /* Block Fit: arrows move the shape, Space / Enter puts it down, Z / X (or 1 2 3) pick another */
  blocks:   [['Move', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Place', K_ACT], ['Switch shape', ['KeyZ', 'KeyX', 'KeyQ', 'KeyE', 'Comma', 'Period', 'Digit1', 'Digit2', 'Digit3']]],
  /* Stacker: ← → move, ↓ soft drop, ↑ / X turn, Z turn back, Space hard drop, C / Shift hold */
  stacker:  [['Move', K_LEFT, K_RIGHT], ['Soft drop', K_DOWN], ['Turn', K_UP, ['KeyX', 'KeyZ']], ['Hard drop', ['Space']], ['Hold', ['KeyC', 'ShiftLeft', 'ShiftRight']]],
  defenders: [['Move', K_LEFT, K_RIGHT], ['Fire', ['Space', 'ArrowUp', 'KeyW']]],
  hopper:   [['Hop', K_UP, K_DOWN, K_LEFT, K_RIGHT]],
  bubbles:  [['Aim', K_LEFT, K_RIGHT], ['Fire', ['Space', 'ArrowUp', 'KeyW']], ['Swap', ['KeyC', 'KeyX', 'ArrowDown', 'ShiftLeft']]],
  /* Gem Swap: arrows move the cursor, Space picks a gem up, an arrow then swaps it */
  gems:     [['Move / swap', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Pick up', ['Space']], ['Hint', ['KeyH']]],
  /* Sudoku: arrows move, digits enter, Backspace erases, N notes, H hint, Z undo */
  sudoku:   [['Move', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Number', ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']], ['Erase', ['Backspace', 'Delete']], ['Notes', ['KeyN']], ['Hint', ['KeyH']], ['Undo', ['KeyZ']]],
  nonogram: [['Move', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Fill', ['Space', 'KeyF']], ['Cross', ['KeyX']], ['Undo', ['KeyZ']]],
  wordsearch: [['Move', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Mark first / last letter', ['Space']], ['Cancel', ['Backspace']]],
  mahjong:  [['Choose a tile', ...ARROWS], ['Pick', K_ACT], ['Undo', ['KeyU', 'KeyZ', 'Backspace']], ['Hint', ['KeyH']], ['Shuffle', ['KeyS']]],
  reversi:  [['Move the cursor', ...ARROWS], ['Place a disc', K_ACT], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  ttt:      [['Move the cursor', ...ARROWS], ['Place a mark', K_ACT], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  dnb:      [['Move to the next line', ...ARROWS], ['Draw the line', K_ACT], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  checkers: [['Move the cursor', ...ARROWS], ['Pick up / put down', K_ACT], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  gomoku:   [['Move the cursor', ...ARROWS], ['Place a stone', K_ACT], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  go:       [['Move the cursor', ...ARROWS], ['Place a stone / mark a group', K_ACT], ['Pass / Done', ['KeyP']], ['Play on', ['KeyR']], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  fivedice: [['Roll', ['Space', 'KeyR']], ['Keep / release a die', ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']], ['Choose a box', ['ArrowUp'], ['ArrowDown']], ['Score it', ['Enter', 'NumpadEnter']]],
  dominoes: [['Choose a tile', ['ArrowLeft'], ['ArrowRight']], ['Play it', K_ACT], ['Draw', ['KeyD']], ['Pass', ['KeyP']], ['Next round', ['KeyN']], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  /* Battleship: arrows move the aim (or the picked ship), Enter / Space fires (or starts), R turns a ship, 1–5 pick one */
  battleship: [['Aim / move ship', ['ArrowUp'], ['ArrowDown'], ['ArrowLeft'], ['ArrowRight']], ['Fire / start', ['Enter', 'Space']], ['Turn ship', ['KeyR']]],
  /* Mini Golf: ← → turn the aim, hold Space to charge the putt and let go to hit, ↑ ↓ change the club power */
  minigolf: [['Aim', K_LEFT, K_RIGHT], ['Putt (hold)', ['Space', 'Enter']]],
  /* Pinball: Space / ↓ pull the plunger, Z / ← and X / → flip, ↑ nudges */
  pinball:  [['Left flipper', ['ArrowLeft', 'KeyZ', 'KeyA']], ['Right flipper', ['ArrowRight', 'KeyX', 'KeyD', 'Slash']], ['Plunger', ['Space', 'ArrowDown']], ['Nudge', ['ArrowUp', 'KeyW']]],
  /* Snake Battle: you steer one snake with the arrows or W A S D (two on one keyboard: P1 W A S D, P2 the arrows) */
  snakebattle: [['Turn', K_UP, K_DOWN, K_LEFT, K_RIGHT]],
  /* Air Hockey: the mallet follows the mouse; W A S D / the arrows move it too, and Space serves; 1 2 3 pick the level */
  airhockey: [['Move the mallet', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Serve', ['Space']], ['Level (before serving)', ['Digit1', 'Digit2', 'Digit3']]],
  /* Bowling: ← → aim, A D slide the ball, Q E hook, hold Space to build power and let go to throw */
  bowling:  [['Aim', ['ArrowLeft'], ['ArrowRight']], ['Move the ball', ['KeyA'], ['KeyD']], ['Hook', ['KeyQ'], ['KeyE']], ['Throw (hold)', ['Space', 'Enter']]],
  /* Basketball: one button releases the shot when the meter is in the green */
  basketball: [['Shoot', ['Space', 'Enter', 'ArrowUp', 'KeyW']]],
  skyhop:   [['Steer', K_LEFT, K_RIGHT]],
  darts:    [['Aim', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Throw', K_ACT]],
  'darts-clock': [['Aim', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Throw', K_ACT]],
  pool:     [['Aim', K_LEFT, K_RIGHT], ['Shoot (hold)', K_ACT]],
  archery:  [['Aim', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Loose', K_ACT], ['Steady', ['ShiftLeft', 'ShiftRight']]],
  laprush:  [['Steer', K_LEFT, K_RIGHT], ['Throttle', K_UP], ['Brake', K_DOWN]],
  jumper:   [['Run', K_LEFT, K_RIGHT], ['Jump (hold for higher)', ['Space', 'ArrowUp', 'KeyW']], ['Restart level', ['KeyR']]],
  reaction: [['React', K_ACT]],
  /* pads 1–4 sit top / right / bottom / left: the digits or the arrows */
  echo:     [['Pads', ['ArrowUp', 'Digit1', 'Numpad1'], ['ArrowRight', 'Digit2', 'Numpad2'], ['ArrowDown', 'Digit3', 'Numpad3'], ['ArrowLeft', 'Digit4', 'Numpad4']], ['Start', K_ACT]],
  memory:   [['Move', ...ARROWS], ['Flip', K_ACT]],
  mines:    [['Move', ...ARROWS], ['Open', K_ACT], ['Flag', cfg => ['KeyF', cfg.mapping.x]]],
  /* the card games: arrows choose a pile, Space / Enter pick up and put down, U or Z undo */
  solitaire: [['Choose a pile', ...ARROWS], ['Pick up / put down', K_ACT], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  spider:    [['Choose a pile', ...ARROWS], ['Pick up / put down', K_ACT], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  freecell:  [['Choose a pile', ...ARROWS], ['Pick up / put down', K_ACT], ['Undo', ['KeyU', 'KeyZ', 'Backspace']]],
  /* the reflex games */
  chaser:   [['Turn', K_UP, K_DOWN, K_LEFT, K_RIGHT]],
  runner:   [['Jump (hold for higher)', ['Space', 'ArrowUp', 'KeyW']], ['Duck', ['ArrowDown', 'KeyS']]],
  moles:    [['Whack hole 1-9', ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']], ['Start', K_ACT]],
  slicer:   [['Move cursor', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Slice (hold to cut)', ['Space']]],
  /* Rhythm Tap: D F J K are the four lanes, Space starts */
  rhythm:   [['Lanes', ['KeyD'], ['KeyF'], ['KeyJ'], ['KeyK']], ['Start', ['Space']]],
  sliding:  [['Slide a tile', ...ARROWS]],
  lightsout: [['Move', ...ARROWS], ['Press', ['Space']], ['Show solution', ['KeyH']]],
  pipelink: [['Move / draw', ...ARROWS], ['Pick up / put down', K_ACT], ['Restart level', ['KeyR']]],
  jigsaw:   [['Move on the board', ...ARROWS], ['Place piece', K_ACT], ['Next / previous piece', ['KeyN'], ['KeyP']], ['Preview', ['KeyV']]],
  clicker:  [['Tune the signal', K_ACT], ['Buy a generator 1-9', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ['Digit' + n])], ['Buy an upgrade', ['KeyU']], ['Buy amount', ['KeyB']]],
  /* Sum Grid: arrows move, digits enter, Backspace erases, N notes, H hint, Z undo */
  sumgrid:  [['Move', K_UP, K_DOWN, K_LEFT, K_RIGHT], ['Number', ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']], ['Erase', ['Backspace', 'Delete']], ['Notes', ['KeyN']], ['Hint', ['KeyH']], ['Undo', ['KeyZ']]],
  towerdefense: [['Move', ...ARROWS], ['Build / select', K_ACT], ['Towers', ['Digit1'], ['Digit2'], ['Digit3']], ['Upgrade', ['KeyU']], ['Sell', ['KeyX']], ['Next wave', ['KeyN']], ['Speed', ['KeyF']]],
};
/* keyboard games the bridge cannot play, and why */
const TEXT_ONLY = {
  hangman: 'Hangman is played with the letters A to Z. A controller only sends the few keys you map, so use the on-screen keyboard with a mouse or touch.',
  lettergrid: 'Letter Grid is played by typing words or by dragging across letters. A controller only sends the few keys you map, so use the keyboard, or a mouse or touch.',
  unscramble: 'Unscramble is played by typing the letters. A controller only sends the few keys you map, so use the keyboard, or tap the tiles with a mouse or touch.',
  crossword: 'Mini Crosswords is played by typing letters. A controller only sends the few keys you map, so use the keyboard, or the letter pad on a touch screen.',
  typing: 'Type Rush needs whole words typed into its text field. A controller only sends the few keys you map, and synthetic key events cannot type into a focused field.',
};
/* the Arcade's own keys, in every game (js/apps/arcade.js) */
const SHELL_KEYS = [['Pause', ['Escape', 'KeyP']], ['Play again', ['Enter', 'NumpadEnter']]];
const GROUP_NAME = { dpad: 'D-pad', lstick: 'Left stick', rstick: 'Right stick' };

/* ======================================================================
   the app
   ====================================================================== */
defineApp({
  id: 'controller',
  name: 'Controller Center',
  icon: 'gamepad',
  g1: '#8b9bff', g2: '#3b2bb8',
  category: 'System',
  keywords: ['gamepad', 'controller', 'joystick', 'xbox', 'playstation', 'dualsense', 'switch', 'input',
    'keyboard test', 'key tester', 'rollover', 'mouse test', 'polling rate', 'dead zone', 'deadzone',
    'button mapping', 'remap', 'rumble', 'vibration', 'devices'],
  desc: 'Test controllers, keyboard and mouse, and play keyboard games with a gamepad',
  singleton: true,
  win: { w: 900, h: 600, minW: 380, minH: 440 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus } = api;
    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const hasGamepadAPI = typeof navigator.getGamepads === 'function';
    const secure = typeof window.isSecureContext !== 'boolean' || window.isSecureContext;
    /* a phone or tablet with no mouse or trackpad attached */
    const touchOnly = typeof matchMedia === 'function'
      && matchMedia('(any-pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
    const callout = text => h('p.cc-callout', icon('info'), h('span', { text }));

    const TABS = [
      { id: 'pads', label: 'Controllers', icon: 'gamepad', build: buildPads },
      { id: 'keys', label: 'Keyboard', icon: 'keyboard', build: buildKeys },
      { id: 'mouse', label: 'Mouse', icon: 'mouse-pointer', build: buildMouse },
      { id: 'map', label: 'Button mapping', icon: 'sliders', build: buildMap },
      { id: 'compat', label: 'Compatibility', icon: 'grid', build: buildCompat },
    ];
    /* opts.tab: a tab id, or a readable alias ({ tab: 'mapping' }) */
    const ALIAS = { controllers: 'pads', gamepad: 'pads', keyboard: 'keys', mapping: 'map', bridge: 'map', compatibility: 'compat', arcade: 'compat' };
    const tabId = t => (TABS.some(x => x.id === t) ? t : ALIAS[t] || null);
    const S = { tab: tabId(opts?.tab) || 'pads', off: null, dead: false };
    const uid = 'cc' + (++seq);

    /* ------------------------------ shell ------------------------------ */
    const tabBtns = {};
    const counts = {};
    const nav = h('nav.cc__nav', { role: 'tablist', 'aria-label': 'Input devices', 'aria-orientation': 'vertical', onkeydown: navKeys },
      TABS.map(t => {
        counts[t.id] = h('small.cc__count');
        tabBtns[t.id] = h('button.cc__tab', {
          type: 'button', role: 'tab', id: `${uid}-tab-${t.id}`, 'aria-controls': `${uid}-panel`,
          onclick: () => select(t.id, { focusInto: true }),
        }, icon(t.icon), h('span', { text: t.label }), counts[t.id]);
        return tabBtns[t.id];
      }));
    const bridgeState = h('b');
    const bridgeFoot = h('button.cc__foot', { type: 'button', onclick: () => select('map', { focusInto: true }) },
      h('span.cc__foot-ic', icon('zap')), h('span.cc__foot-tx', h('small', { text: 'Key bridge' }), bridgeState));
    const side = h('aside.cc__side', nav, bridgeFoot);
    const panel = h('section.cc__panel', { role: 'tabpanel', id: `${uid}-panel`, tabindex: '-1' });
    const shell = h('div.cc', side, h('main.cc__main', panel));
    const host = h('div.app.cc-host', shell);
    root.appendChild(host);
    /* the rail turns into a horizontal strip in narrow windows (the CSS
       container query at 680px): say so to assistive technology too */
    const navRO = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
      const w = entries[entries.length - 1]?.contentRect.width || 0;
      if (w) nav.setAttribute('aria-orientation', w <= 680 ? 'horizontal' : 'vertical');
    }) : null;
    navRO?.observe(host);

    function navKeys(e) {
      const ids = TABS.map(t => t.id);
      const i = ids.indexOf(S.tab);
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      let next = null;
      if (step) next = ids[(i + step + ids.length) % ids.length];
      else if (e.key === 'Home') next = ids[0];
      else if (e.key === 'End') next = ids[ids.length - 1];
      if (!next) return;
      e.preventDefault();
      select(next);
      tabBtns[next].focus();
    }

    function select(id, { focusInto = false } = {}) {
      if (!TABS.some(t => t.id === id)) return;
      if (S.tab === id && S.off) { if (focusInto) focusPanel(); return; }
      S.tab = id;
      for (const t of TABS) {
        const on = t.id === id;
        tabBtns[t.id].classList.toggle('is-on', on);
        tabBtns[t.id].setAttribute('aria-selected', on ? 'true' : 'false');
        tabBtns[t.id].tabIndex = on ? 0 : -1;
      }
      panel.setAttribute('aria-labelledby', `${uid}-tab-${id}`);
      try { S.off?.(); } catch (err) { console.error(err); }
      S.off = null;
      clear(panel);
      panel.dataset.tab = id;
      panel.scrollTop = 0;
      S.off = TABS.find(t => t.id === id).build(panel) || null;
      if (focusInto) focusPanel();
    }
    function focusPanel() {
      const target = panel.querySelector('[data-autofocus]');
      (target || panel).focus({ preventScroll: true });
    }

    /* tell the rest of StaticOS (achievements) about each pad that appears */
    function announce(pads) {
      const keys = new Set(pads.map(p => p.index + '|' + p.id));
      for (const k of [...announced]) if (!keys.has(k)) announced.delete(k);
      for (const gp of pads) {
        const k = gp.index + '|' + gp.id;
        if (announced.has(k)) continue;
        announced.add(k);
        bus.emit('gamepad:connected', { id: gp.id, index: gp.index });
      }
    }

    function paintChrome() {
      const pads = PM.connectedPads();
      if (!S.dead) announce(pads);
      const n = pads.length;
      counts.pads.textContent = n ? String(n) : '';
      const on = PM.isEnabled();
      bridgeState.textContent = on ? (PM.isActive() ? 'On · running' : 'On') : 'Off';
      bridgeFoot.classList.toggle('is-on', on);
      bridgeFoot.setAttribute('aria-label', `Key bridge ${on ? 'on' : 'off'}. Open button mapping.`);
    }
    const onPadEvent = () => paintChrome();
    window.addEventListener('gamepadconnected', onPadEvent);
    window.addEventListener('gamepaddisconnected', onPadEvent);
    const offCfg = store.sub(PM.KEY, paintChrome);
    const offBus = bus.on('padmap:change', paintChrome);

    function head(title, sub, ...actions) {
      const subEl = h('p.cc-head__sub', { text: sub });
      const el = h('header.cc-head',
        h('div.cc-head__text', h('h2.cc-head__title', { text: title }), subEl),
        actions.length ? h('div.cc-head__actions', ...actions) : null);
      return { el, subEl };
    }

    /* ==================================================================
       Controllers
       ================================================================== */
    function buildPads(el) {
      const hd = head('Controllers', '');
      const body = h('div.cc-pads');
      el.append(hd.el, body);

      let rafId = 0;
      let sig = null;
      let view = null;           /* { index, update(gp) } */
      let chips = [];            /* [{ index, dot }] */
      let dz = PM.getConfig().deadzone;
      const V = { sel: null };

      let labels = PM.getConfig().labels;
      const offStore = store.sub(PM.KEY, () => {
        const c = PM.getConfig();
        dz = c.deadzone;
        view?.setDeadzone(dz);
        /* a new label style rebuilds the view; a dead-zone drag must not */
        if (c.labels !== labels) { labels = c.labels; sig = null; kick(); }
      });

      function paint(pads) {
        /* a rebuild (new pad, other pad chosen, label style changed) must
           not drop keyboard focus: put it back on the same control */
        const fk = body.contains(document.activeElement) ? document.activeElement.closest('[data-fk]')?.dataset.fk : null;
        clear(body);
        view = null;
        chips = [];
        paintInto(pads);
        if (fk) (body.querySelector(`[data-fk="${fk}"]`) || panel).focus({ preventScroll: true });
      }
      function paintInto(pads) {
        /* checked first: on an http page some browsers remove the Gamepad
           API entirely, which is not the same as not supporting it */
        if (!secure) {
          hd.subEl.textContent = 'Needs a secure page';
          body.append(emptyState('Controllers need a secure (https) page',
            'Browsers only share gamepads with pages loaded over https. Open StaticOS from its https address.'));
          return;
        }
        if (!hasGamepadAPI) {
          hd.subEl.textContent = 'Not available in this browser';
          body.append(emptyState('This browser cannot see controllers',
            'It does not support the Gamepad API, so no page can read a game controller here. Chrome, Edge and Firefox do.'));
          return;
        }
        if (!pads.length) {
          hd.subEl.textContent = 'None detected yet';
          body.append(emptyState('Press any button on the controller',
            'Browsers only reveal a gamepad after it is used — plugging it in is not enough. Press a button and it shows up here.',
            touchOnly
              ? ['Pair it in your phone or tablet’s Bluetooth settings first, or plug it in (a USB-C or Lightning adapter may be needed).',
                'Keep StaticOS on screen while you press — browsers only pass controller input to the page you are looking at.',
                'Browsers differ in which controllers they recognise; on phones and tablets, recent Xbox and PlayStation pads are the most likely to work.']
              : ['Connect it by USB, or pair it over Bluetooth in your computer’s settings first.',
                'Keep this window in front while you press — pages only get controller input while focused.',
                'Browsers differ in which controllers they recognise; most Xbox, PlayStation and Switch Pro pads work in Chrome and Edge.']));
          return;
        }
        hd.subEl.textContent = `${pads.length} connected · live at your screen’s refresh rate`;
        if (V.sel === null || !pads.some(p => p.index === V.sel)) V.sel = pads[0].index;

        if (pads.length > 1) {
          body.append(h('div.cc-chips', { role: 'radiogroup', 'aria-label': 'Choose a controller', onkeydown: radioNav },
            pads.map(gp => {
              const dot = h('i.cc-chip__dot');
              const on = gp.index === V.sel;
              chips.push({ index: gp.index, dot });
              const b = h('button.cc-chip', {
                type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: on ? 'is-on' : '',
                dataset: { fk: 'pad-' + gp.index },
                onclick: () => { if (V.sel !== gp.index) { V.sel = gp.index; sig = null; kick(); } },
              }, dot, h('b', { text: String(gp.index + 1) }), h('span', { text: parseId(gp.id).name }));
              rove(b, on);
              return b;
            })));
        }
        const gp = pads.find(p => p.index === V.sel);
        view = padView(gp);
        body.append(view.el);
      }

      function emptyState(title, text, tips) {
        const d = diagram('xbox', { idle: true });
        return h('div.cc-empty',
          h('div.cc-empty__art', d.el),
          h('h3.cc-empty__title', { text: title }),
          h('p.cc-empty__text', { text }),
          tips ? h('ul.cc-empty__tips', tips.map(t => h('li', icon('info'), h('span', { text: t })))) : null);
      }

      function padView(gp) {
        const stKey = styleKey(gp);
        const st = STYLES[stKey];
        const info = parseId(gp.id);
        const dia = diagram(stKey);
        dia.setDeadzone(dz);
        const standard = gp.mapping === 'standard';
        /* one plot per stick the pad reports (axes 0/1 and 2/3) */
        const plots = [['Left stick', 0], ['Right stick', 2]]
          .filter(([, i]) => gp.axes.length >= i + 2)
          .map(([name, i]) => ({ i, p: stickPlot(h, standard ? name : `Axes ${i}/${i + 1}`) }));
        for (const { p } of plots) p.setDeadzone(dz);

        /* dead zone */
        const dzOut = h('output.cc-dz__val', { text: pct(dz) });
        const slider = h('input.slider.cc-dz__range', {
          type: 'range', min: '0', max: String(PM.MAX_DEADZONE), step: '0.01', value: String(dz),
          'aria-label': 'Stick dead zone', 'aria-valuetext': pct(dz), dataset: { fk: 'dz' },
          oninput: e => {
            const v = Math.round(Number(e.target.value) * 100) / 100;
            dzOut.textContent = pct(v);
            e.target.setAttribute('aria-valuetext', pct(v));
            PM.setConfig({ deadzone: v });
          },
        });

        /* rumble */
        const rumbleNote = h('p.cc-card__note', { 'aria-live': 'polite' });
        const act = gp.vibrationActuator;
        const effects = act ? (Array.isArray(act.effects) ? act.effects : ['dual-rumble']) : [];
        const rumble = async (type) => {
          const pad = PM.connectedPads().find(p => p.index === gp.index);
          const a = pad?.vibrationActuator;
          if (!a) { rumbleNote.textContent = 'The controller is gone.'; return; }
          rumbleNote.textContent = 'Playing…';
          try {
            const params = type === 'trigger-rumble'
              ? { duration: 450, leftTrigger: 0.8, rightTrigger: 0.8 }
              : { duration: 450, strongMagnitude: 1, weakMagnitude: 0.6 };
            const r = await a.playEffect(type, { startDelay: 0, ...params });
            rumbleNote.textContent = r === 'complete' ? 'Done — did it buzz? If not, the controller ignores rumble in this browser.' : `The browser reported: ${r}.`;
          } catch (err) {
            rumbleNote.textContent = `The browser refused: ${err.message || err.name}.`;
          }
        };
        const rumbleCard = h('div.cc-card',
          h('div.cc-card__title', icon('activity'), h('span', { text: 'Vibration' })),
          act
            ? h('div.cc-card__row',
              effects.includes('dual-rumble') || !effects.length
                ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'rumble' }, onclick: () => rumble('dual-rumble') }, h('span', { text: 'Test rumble' })) : null,
              effects.includes('trigger-rumble')
                ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'trumble' }, onclick: () => rumble('trigger-rumble') }, h('span', { text: 'Trigger rumble' })) : null)
            : null,
          act ? rumbleNote : h('p.cc-card__note', { text: 'Not available: this browser does not expose vibration for this controller.' }));

        /* label style */
        const pref = PM.getConfig().labels;
        const cur = STYLES[pref] ? pref : 'auto';
        const seg = h('div.seg.cc-seg', { role: 'radiogroup', 'aria-label': 'Button labels', onkeydown: radioNav },
          [['auto', 'Auto'], ['xbox', 'Xbox'], ['ps', 'PlayStation'], ['nintendo', 'Nintendo']].map(([k, label]) => {
            const b = h('button', {
              type: 'button', role: 'radio', 'aria-checked': k === cur ? 'true' : 'false', class: k === cur ? 'is-on' : '',
              dataset: { fk: 'labels-' + k },
              text: label, onclick: () => { if (k !== cur) PM.setConfig({ labels: k }); },
            });
            rove(b, k === cur);
            return b;
          }));

        const side = h('div.cc-pad__side',
          h('div.cc-card',
            h('div.cc-card__title', icon('gamepad'), h('span', { text: info.name, title: gp.id })),
            h('dl.cc-dl',
              h('dt', { text: 'Slot' }), h('dd', { text: `#${gp.index + 1}` }),
              info.vendor ? [h('dt', { text: 'USB ID' }), h('dd.cc-mono', { text: `${info.vendor}:${info.product}` })] : null,
              h('dt', { text: 'Layout' }),
              h('dd', h('span', { class: 'badge ' + (standard ? 'badge--ok' : 'badge--warn'), text: standard ? 'standard' : (gp.mapping ? gp.mapping : 'not standard') })),
              h('dt', { text: 'Reports' }), h('dd', { text: `${gp.buttons.length} buttons · ${gp.axes.length} axes` })),
            standard ? null : h('p.cc-card__note.cc-card__note--warn', {
              text: 'The browser does not know this controller’s layout, so the diagram may not match its buttons. The raw values below are exact.',
            })),
          h('div.cc-card',
            h('div.cc-card__title', icon('scan'), h('span', { text: 'Stick dead zone' }), dzOut),
            plots.length ? h('div.cc-plots', plots.map(x => x.p.el)) : null,
            slider,
            h('p.cc-card__note', { text: 'Stick movement inside the dashed circle is ignored — it hides drift from worn sticks. Used by this display and by the key bridge.' }),
            h('div.cc-legend', h('span', h('i.cc-legend__raw'), 'raw position'), h('span', h('i.cc-legend__cap'), 'after dead zone'), h('span', h('i.cc-legend__dz'), 'dead zone'))),
          rumbleCard,
          h('div.cc-card',
            h('div.cc-card__title', icon('type'), h('span', { text: 'Button labels' })),
            seg,
            h('p.cc-card__note', {
              text: pref && STYLES[pref] ? `Showing ${STYLES[pref].name} names.`
                : detectStyle(gp.id) ? `Guessed from the controller’s name: ${st.name}.`
                  : 'The controller’s name doesn’t say what kind it is, so Xbox names are shown. Pick another style if they don’t match.',
            })));

        const raw = rawView(gp, st, standard);
        /* grid areas: wide windows put the raw readout under the diagram,
           beside the cards; narrow ones stack diagram, cards, raw */
        const wrap = h('div.cc-pad',
          h('div.cc-stage', dia.el, standard ? null : h('span.cc-stage__tag', { text: 'layout unknown — diagram is a guess' })),
          side,
          raw.el);
        const clampAxis = v => Math.max(-1, Math.min(1, Number(v) || 0));
        return {
          el: wrap, gp, style: stKey,
          setDeadzone: v => { dia.setDeadzone(v); for (const { p } of plots) p.setDeadzone(v); },
          update(pad) {
            dia.update(pad, dz);
            raw.update(pad, dz);
            const ax = pad.axes || [];
            for (const { i, p } of plots) p.update(clampAxis(ax[i]), clampAxis(ax[i + 1]), dz);
          },
        };
      }

      function rawView(gp, st, standard) {
        const btnCells = [];
        const axisRows = [];
        const nameOfButton = i => {
          if (!standard) return '';
          const inp = PM.INPUTS.find(x => x.button === i);
          return inp ? inputLabel(inp, st) : '';
        };
        const AXIS = ['Left stick X', 'Left stick Y', 'Right stick X', 'Right stick Y'];
        const btns = h('div.cc-raw__btns', gp.buttons.map((b, i) => {
          const fill = h('u');
          const out = h('output', { text: '0.00' });
          const cell = h('div.cc-raw__btn', h('div.cc-raw__top', h('b', { text: `B${i}` }), h('span', { text: nameOfButton(i) })), h('i.cc-raw__bar', fill), out);
          btnCells.push({ cell, fill, out, last: null });
          return cell;
        }));
        const axes = h('div.cc-raw__axes', gp.axes.map((a, i) => {
          const fill = h('u');
          const out = h('output', { text: '+0.00' });
          const adj = h('small');
          const row = h('div.cc-raw__axis',
            h('div.cc-raw__top', h('b', { text: `Axis ${i}` }), h('span', { text: standard && AXIS[i] ? AXIS[i] : '' })),
            h('i.cc-raw__track', h('i.cc-raw__mid'), fill), out, adj);
          axisRows.push({ fill, out, adj, last: null });
          return row;
        }));
        const el = h('div.cc-raw',
          h('div.cc-raw__head', h('h3', { text: 'Raw input' }), h('small', { text: 'Exactly what the browser reports, updated every frame.' })),
          h('div.cc-raw__sub', { text: `Buttons · ${gp.buttons.length}` }),
          btns,
          gp.axes.length ? h('div.cc-raw__sub', { text: `Axes · ${gp.axes.length}` }) : null,
          axes);
        return {
          el,
          update(pad, dzv) {
            pad.buttons.forEach((b, i) => {
              const c = btnCells[i];
              if (!c) return;
              const v = typeof b === 'object' ? Number(b.value) || 0 : Number(b) || 0;
              const pressed = typeof b === 'object' ? !!b.pressed : v > 0.5;
              const key = v.toFixed(2) + pressed;
              if (c.last === key) return;
              c.last = key;
              c.fill.style.width = Math.round(Math.min(1, v || (pressed ? 1 : 0)) * 100) + '%';
              c.out.textContent = v.toFixed(2);
              c.cell.classList.toggle('is-on', pressed);
            });
            const ax = pad.axes || [];
            ax.forEach((a, i) => {
              const r = axisRows[i];
              if (!r) return;
              const v = Math.max(-1, Math.min(1, Number(a) || 0));
              /* the dead zone is radial, so it is applied to the stick pair */
              let adjV = null;
              if (standard && i < 4) {
                const base = i < 2 ? 0 : 2;
                const [x, y] = PM.applyDeadzone(Number(ax[base]) || 0, Number(ax[base + 1]) || 0, dzv);
                adjV = i % 2 ? y : x;
              }
              const key = v.toFixed(3) + '|' + (adjV === null ? '' : adjV.toFixed(2));
              if (r.last === key) return;
              r.last = key;
              r.fill.style.left = (v < 0 ? 50 + v * 50 : 50) + '%';
              r.fill.style.width = Math.abs(v) * 50 + '%';
              r.out.textContent = signed(v);
              r.adj.textContent = adjV === null ? '' : `after dead zone ${signed(adjV)}`;
            });
          },
        };
      }

      function tick() {
        rafId = 0;
        if (S.dead) return;
        const pads = hasGamepadAPI ? PM.connectedPads() : [];
        const next = pads.map(p => `${p.index}|${p.id}|${p.mapping}|${p.buttons.length}|${p.axes.length}`).join(',') + '#' + V.sel;
        if (next !== sig) { sig = next; paint(pads); paintChrome(); }
        if (view) {
          const gp = pads.find(p => p.index === V.sel);
          if (gp) view.update(gp);
        }
        for (const c of chips) {
          const gp = pads.find(p => p.index === c.index);
          const busy = !!gp && (gp.buttons.some(b => (typeof b === 'object' ? b.pressed : b > 0.5))
            || gp.axes.some(a => Math.abs(a) > Math.max(0.3, dz)));
          c.dot.classList.toggle('is-on', busy);
        }
        if (pads.length) rafId = requestAnimationFrame(tick);
      }
      const kick = () => { if (!rafId) rafId = requestAnimationFrame(tick); };
      const onConn = () => kick();
      window.addEventListener('gamepadconnected', onConn);
      window.addEventListener('gamepaddisconnected', onConn);
      tick();

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        offStore();
        window.removeEventListener('gamepadconnected', onConn);
        window.removeEventListener('gamepaddisconnected', onConn);
      };
    }

    /* ==================================================================
       Keyboard
       ================================================================== */
    function buildKeys(el) {
      const K = {
        held: new Map(),          /* code → key */
        /* keys that went down on the panel's own controls (Enter on
           Reset, arrows in the size switch): their keyup is not a test,
           even when it lands on the tester after focus moves there */
        foreign: new Set(),
        tested: new Set(),
        max: 0,
        count: 0,
        log: [],
        last: null,
        lastT: 0,
        escAt: 0,
        numpad: el.clientWidth ? el.clientWidth >= 560 : true,
        chosen: false,            /* the person picked a size */
      };
      const statHeld = h('b', { text: '0' });
      const statMax = h('b', { text: '0' });
      const statTested = h('b', { text: '0' });
      const statCount = h('b', { text: '0' });
      const live = h('div.cc-sr', { 'aria-live': 'polite', id: `${uid}-kb-live` });

      const board = h('div.cc-kb__board', { 'aria-hidden': 'true' });
      const keyEls = new Map();
      const stage = h('div.cc-kb', {
        tabindex: '0', role: 'application', 'data-autofocus': '',
        'aria-label': 'Keyboard tester. Press any key to test it. Press Escape twice to leave.',
        'aria-describedby': live.id,
      }, board, h('div.cc-kb__hint', icon('keyboard'), h('span', { text: 'Click here, then press keys' })));

      const segBtns = {};
      const seg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Keyboard size', onkeydown: radioNav },
        [['full', 'Full'], ['tkl', 'No numpad']].map(([k, label]) => {
          segBtns[k] = h('button', { type: 'button', role: 'radio', text: label, onclick: () => { K.chosen = true; K.numpad = k === 'full'; drawBoard(); } });
          return segBtns[k];
        }));
      const resetBtn = h('button.btn.btn--sm', { type: 'button', onclick: reset }, icon('rotate-ccw'), h('span', { text: 'Reset' }));
      const hd = head('Keyboard tester', `Keys light up by physical position (event.code). Cmd/Ctrl shortcuts still reach StaticOS; everything else stays here. Esc twice to leave.`, seg, resetBtn);

      const dKey = h('dd'), dCode = h('dd.cc-mono'), dLoc = h('dd'), dKc = h('dd.cc-mono'), dRep = h('dd');
      const modEls = {};
      const mods = h('div.cc-mods', ['Shift', 'Ctrl', 'Alt', isMac ? '⌘' : 'Meta'].map(m => (modEls[m] = h('span.cc-mod', { text: m }))));
      const offLayout = h('p.cc-card__note');
      const details = h('div.cc-card.cc-kd',
        h('div.cc-card__title', icon('keyboard'), h('span', { text: 'Last key' })),
        h('div.cc-kd__big', { text: '—' }),
        h('dl.cc-dl',
          h('dt', { text: 'key' }), dKey, h('dt', { text: 'code' }), dCode, h('dt', { text: 'location' }), dLoc,
          h('dt', { text: 'keyCode' }), dKc, h('dt', { text: 'repeat' }), dRep),
        mods, offLayout);
      const logList = h('ol.cc-log', { 'aria-label': 'Last 10 key events' });
      const logCard = h('div.cc-card.cc-klog',
        h('div.cc-card__title', icon('list'), h('span', { text: 'Last 10 events' })), logList);

      el.append(hd.el,
        ...(touchOnly ? [callout('This looks like a touch screen. On-screen keyboards do not report physical keys, so this tester needs a hardware keyboard (USB or Bluetooth).')] : []),
        h('div.cc-stats',
          h('div.cc-stat', statHeld, h('small', { text: 'held now' })),
          h('div.cc-stat', statMax, h('small', { text: 'most at once' })),
          h('div.cc-stat', statTested, h('small', { text: 'keys tested' })),
          h('div.cc-stat', statCount, h('small', { text: 'events' }))),
        stage,
        h('p.cc-fine', { text: 'Rollover: some keyboards cannot report every combination (ghosting) — if a key stays dark while others are held, that is the keyboard’s limit, not StaticOS. Keys the browser keeps for itself (like Cmd+Q or the Windows key) may never arrive.' }),
        h('div.cc-kgrid', details, logCard),
        live);

      function drawBoard() {
        for (const [k, b] of Object.entries(segBtns)) {
          const on = (k === 'full') === K.numpad;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
          rove(b, on);
        }
        const { keys, W, H } = kbLayout(K.numpad);
        clear(board);
        keyEls.clear();
        board.style.aspectRatio = `${W} / ${H}`;
        for (const k of keys) {
          const top = SHIFTED[k.code];
          const cap = h('span.cc-kb__cap',
            top ? h('small', { text: top }) : null,
            SHORT[k.code]
              ? [h('span.cc-kb__long', { text: k.label }), h('span.cc-kb__short', { text: SHORT[k.code] })]
              : h('span', { text: k.label }));
          const keyEl = h('div.cc-kb__key', {
            dataset: { code: k.code },
            class: [k.w >= 1.75 ? 'is-wide' : '', /^F\d/.test(k.code) || k.code === 'Escape' ? 'is-fn' : ''].filter(Boolean).join(' '),
            style: {
              left: (k.x / W * 100) + '%', top: (k.y / H * 100) + '%',
              width: (k.w / W * 100) + '%', height: (k.h / H * 100) + '%',
            },
          }, cap);
          if (K.held.has(k.code)) keyEl.classList.add('is-down');
          if (K.tested.has(k.code)) keyEl.classList.add('is-tested');
          keyEls.set(k.code, keyEl);
          board.append(keyEl);
        }
      }

      let paintQueued = false;
      function paint() {
        if (paintQueued) return;
        paintQueued = true;
        requestAnimationFrame(() => {
          paintQueued = false;
          if (S.dead) return;
          statHeld.textContent = String(K.held.size);
          statMax.textContent = String(K.max);
          statTested.textContent = String(K.tested.size);
          statCount.textContent = String(K.count);
          const l = K.last;
          if (l) {
            details.querySelector('.cc-kd__big').textContent = showKey(l.key);
            dKey.textContent = l.key === ' ' ? '" " (Space)' : JSON.stringify(l.key);
            dCode.textContent = l.code || '(empty)';
            dLoc.textContent = `${l.location} · ${LOCATION[l.location] || '?'}`;
            dKc.textContent = `${l.keyCode} (legacy)`;
            dRep.textContent = l.repeat ? 'yes — held down' : 'no';
            modEls.Shift.classList.toggle('is-on', l.shift);
            modEls.Ctrl.classList.toggle('is-on', l.ctrl);
            modEls.Alt.classList.toggle('is-on', l.alt);
            modEls[isMac ? '⌘' : 'Meta'].classList.toggle('is-on', l.meta);
            offLayout.textContent = l.code && !keyEls.has(l.code) ? 'This key is not on the drawn layout.' : '';
          }
          clear(logList);
          if (!K.log.length) logList.append(h('li.cc-log__empty', { text: 'Nothing yet — press a key.' }));
          for (const r of K.log) {
            logList.append(h('li', { class: r.type === 'keydown' ? 'is-down' : 'is-up' },
              h('span.cc-log__t', { text: r.type === 'keydown' ? '↓ down' : '↑ up' }),
              h('b', { text: showKey(r.key) }),
              h('span.cc-mono', { text: r.code || '(no code)' }),
              r.times > 1 ? h('span.cc-log__rep', { text: `repeat ×${r.times}` }) : null,
              h('span.cc-log__dt', { text: r.dt === null ? '' : `+${Math.round(r.dt)} ms` })));
          }
        });
      }

      function releaseAll() {
        for (const code of K.held.keys()) keyEls.get(code)?.classList.remove('is-down');
        K.held.clear();
        K.foreign.clear();
        paint();
      }

      function record(e, down) {
        const id = e.code || `key:${e.key}`;
        const now = performance.now();
        K.count++;
        if (down) {
          if (!K.held.has(id)) K.held.set(id, e.key);
          K.max = Math.max(K.max, K.held.size);
          K.tested.add(id);
          const k = keyEls.get(id);
          k?.classList.add('is-down', 'is-tested');
        } else {
          K.held.delete(id);
          keyEls.get(id)?.classList.remove('is-down');
          /* macOS never sends keyup for keys released while ⌘ is held */
          if (isMac && e.key === 'Meta') {
            for (const [code, key] of [...K.held]) if (!['Shift', 'Control', 'Alt', 'Meta'].includes(key)) { K.held.delete(code); keyEls.get(code)?.classList.remove('is-down'); }
          }
        }
        const type = down ? 'keydown' : 'keyup';
        const top = K.log[0];
        if (down && e.repeat && top && top.type === 'keydown' && top.code === e.code) {
          top.times++;
        } else {
          K.log.unshift({ type, key: e.key, code: e.code, times: 1, dt: K.lastT ? now - K.lastT : null });
          if (K.log.length > 10) K.log.length = 10;
        }
        K.lastT = now;
        if (down) {
          K.last = {
            key: e.key, code: e.code, location: e.location, keyCode: e.keyCode, repeat: e.repeat,
            shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey,
          };
          if (!e.repeat) live.textContent = `${showKey(e.key)}, code ${e.code || 'none'}`;
        }
        paint();
      }

      /* Keys stop here so they cannot trigger StaticOS shortcuts —
         except Cmd/Ctrl combos, which stay OS-level (close, switch…).
         Only keys aimed at the tester itself are recorded: the panel's
         Reset button and size switch are ordinary controls. */
      const onKey = e => {
        if (!el.contains(e.target)) return;
        const down = e.type === 'keydown';
        const osCombo = e.metaKey || e.ctrlKey;
        if (!osCombo) e.stopPropagation();
        const id = e.code || `key:${e.key}`;
        if (e.target !== stage) {
          if (down) K.foreign.add(id); else K.foreign.delete(id);
          return;
        }
        if (!down && K.foreign.delete(id)) return;
        if (down && e.key === 'Escape' && !e.repeat) {
          const now = performance.now();
          if (now - K.escAt < 700) {
            K.escAt = 0;
            e.preventDefault();
            record(e, down);
            releaseAll();
            tabBtns.keys.focus();
            return;
          }
          K.escAt = now;
        }
        if (!osCombo) e.preventDefault();
        record(e, down);
      };
      el.addEventListener('keydown', onKey);
      el.addEventListener('keyup', onKey);
      /* the tester losing focus (to Reset, or out of the window) lets go
         of every key: their keyups will not come here */
      const onFocusOut = e => { if (e.target === stage || !el.contains(e.relatedTarget)) releaseAll(); };
      el.addEventListener('focusout', onFocusOut);
      const onWinBlur = () => releaseAll();
      window.addEventListener('blur', onWinBlur);
      stage.addEventListener('pointerdown', () => { if (document.activeElement !== stage) setTimeout(() => stage.focus({ preventScroll: true }), 0); });

      function reset() {
        K.tested.clear();
        K.held.clear();
        K.max = 0;
        K.count = 0;
        K.log = [];
        K.last = null;
        K.lastT = 0;
        for (const k of keyEls.values()) k.classList.remove('is-down', 'is-tested');
        details.querySelector('.cc-kd__big').textContent = '—';
        for (const d of [dKey, dCode, dLoc, dKc, dRep]) d.textContent = '';
        for (const m of Object.values(modEls)) m.classList.remove('is-on');
        offLayout.textContent = '';
        paint();
        stage.focus({ preventScroll: true });
      }

      drawBoard();
      paint();
      /* opened straight onto this tab, the panel has no width until the
         window is laid out: pick the size again once it has one */
      const sizeId = requestAnimationFrame(() => {
        if (S.dead || K.chosen || !el.isConnected || !el.clientWidth) return;
        const want = el.clientWidth >= 560;
        if (want !== K.numpad) { K.numpad = want; drawBoard(); }
      });
      return () => {
        cancelAnimationFrame(sizeId);
        el.removeEventListener('keydown', onKey);
        el.removeEventListener('keyup', onKey);
        el.removeEventListener('focusout', onFocusOut);
        window.removeEventListener('blur', onWinBlur);
      };
    }

    /* ==================================================================
       Mouse
       ================================================================== */
    function buildMouse(el) {
      const BTN = ['Left', 'Middle', 'Right', 'Back', 'Forward'];
      const M = {
        down: new Set(), presses: [0, 0, 0, 0, 0],
        wheel: { n: 0, dx: 0, dy: 0, dz: 0, mode: 0, dir: 0 },
        type: '', pressure: null, mx: 0, my: 0, dist: 0, x: null, y: null,
        lastDown: 0, dbl: null,
        moves: [], samples: [], peak: 0, peakRaw: 0,
        trail: [], rings: [],
        hasCoalesced: typeof PointerEvent !== 'undefined' && 'getCoalescedEvents' in PointerEvent.prototype,
      };
      const hd = head('Mouse tester', 'Move, click and scroll inside the pad. Right-click, middle-click and the side buttons are caught here, so they will not open menus or go back.');

      /* the pad */
      const canvas = h('canvas.cc-mpad__trail', { 'aria-hidden': 'true' });
      const posEl = h('span.cc-mpad__pos.cc-mono');
      const pad = h('div.cc-mpad', { role: 'application', 'aria-label': 'Mouse test area. Move, click and scroll the mouse here.' },
        canvas,
        h('div.cc-mpad__hint', icon('mouse-pointer'), h('span', { text: touchOnly ? 'Touch and drag here' : 'Move, click and scroll here' })),
        posEl);

      /* mouse picture */
      const mparts = {};
      const msvg = s('svg', { viewBox: '0 0 120 180', class: 'cc-mouse', 'aria-hidden': 'true', focusable: 'false' },
        s('path', { d: 'M60 8C95 8 108 40 108 80V120C108 155 88 172 60 172C32 172 12 155 12 120V80C12 40 25 8 60 8Z', class: 'cc-mouse__body' }),
        (mparts[0] = s('path', { d: 'M58 11C31 12 15 36 14 74H58Z', class: 'cc-mouse__btn' })),
        (mparts[2] = s('path', { d: 'M62 11C89 12 105 36 106 74H62Z', class: 'cc-mouse__btn' })),
        (mparts[1] = s('rect', { x: 53, y: 24, width: 14, height: 30, rx: 7, class: 'cc-mouse__btn cc-mouse__wheel' })),
        (mparts.up = s('path', { d: 'M55 20L60 14L65 20Z', class: 'cc-mouse__arrow' })),
        (mparts.dn = s('path', { d: 'M55 58L60 64L65 58Z', class: 'cc-mouse__arrow' })),
        (mparts[4] = s('rect', { x: 7, y: 80, width: 8, height: 20, rx: 3, class: 'cc-mouse__btn cc-mouse__side' })),
        (mparts[3] = s('rect', { x: 7, y: 104, width: 8, height: 20, rx: 3, class: 'cc-mouse__btn cc-mouse__side' })));

      const btnChips = BTN.map((name, i) => {
        const n = h('small', { text: '0' });
        const c = h('span.cc-mbtn', h('span', { text: name }), n);
        return { c, n };
      });

      const rateBig = h('b', { text: '0' });
      const rateRaw = h('b', { text: M.hasCoalesced ? '0' : '—' });
      const peakEl = h('small');
      const vals = {};
      const row = (k, label) => [h('dt', { text: label }), (vals[k] = h('dd', { text: '—' }))];

      el.append(hd.el,
        ...(touchOnly ? [callout('No mouse or trackpad detected. Touches still show pointer type, movement and the event rate; the buttons, wheel and double-click need a mouse.')] : []),
        h('div.cc-mgrid',
          pad,
          h('div.cc-mside',
            h('div.cc-card.cc-mcard',
              msvg,
              h('div.cc-mbtns', btnChips.map(b => b.c))),
            h('div.cc-card.cc-rate',
              h('div.cc-rate__row',
                h('div.cc-rate__cell', rateBig, h('small', { text: 'pointermove / s' })),
                h('div.cc-rate__cell', rateRaw, h('small', { text: 'raw samples / s' }))),
              peakEl,
              h('p.cc-card__note', {
                text: 'Measured over the last second while you move. Pages get at most one pointermove per frame; the raw (coalesced) samples inside them come closer to the mouse’s real polling rate.'
                  + (M.hasCoalesced ? '' : ' This browser does not expose coalesced events, so raw samples cannot be counted.'),
              })),
            h('div.cc-card',
              h('dl.cc-dl.cc-dl--wide',
                row('wheel', 'Wheel'), row('wheelMode', 'Wheel unit'), row('type', 'Pointer'), row('move', 'Movement'),
                row('dist', 'Distance'), row('dbl', 'Double-click'))))));

      /* ---- measuring ---- */
      const inPad = e => e.target instanceof Node && pad.contains(e.target);
      const onDown = e => {
        if (!inPad(e)) return;
        if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();   /* autoscroll / back / forward */
        M.down.add(e.button);
        if (e.button >= 0 && e.button < 5) M.presses[e.button]++;
        if (e.button === 0) {
          const now = performance.now();
          if (e.detail >= 2 && M.lastDown) M.dbl = now - M.lastDown;
          M.lastDown = now;
        }
        const r = pad.getBoundingClientRect();
        M.rings.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now(), b: e.button });
        paint();
        kickDraw();
      };
      const onUp = e => {
        if (inPad(e) && (e.button === 3 || e.button === 4 || e.button === 1)) e.preventDefault();
        M.down.delete(e.button);
        paint();
      };
      const onAux = e => { if (inPad(e) && e.button !== 0) e.preventDefault(); };
      const onCtx = e => { if (inPad(e)) e.preventDefault(); };
      const onWheel = e => {
        e.preventDefault();
        M.wheel = { n: M.wheel.n + 1, dx: e.deltaX, dy: e.deltaY, dz: e.deltaZ, mode: e.deltaMode, dir: Math.sign(e.deltaY) };
        paint();
        flashWheel(Math.sign(e.deltaY));
      };
      const onMove = e => {
        const now = performance.now();
        pad.classList.add('is-used');
        M.type = e.pointerType || 'mouse';
        M.pressure = e.pointerType === 'pen' ? e.pressure : null;
        M.mx = e.movementX || 0;
        M.my = e.movementY || 0;
        const r = pad.getBoundingClientRect();
        const pts = M.hasCoalesced ? e.getCoalescedEvents() : [];
        const list = pts.length ? pts : [e];
        for (const p of list) {
          const x = p.clientX - r.left, y = p.clientY - r.top;
          if (M.x !== null) M.dist += Math.hypot(x - M.x, y - M.y);
          M.x = x; M.y = y;
          M.trail.push({ x, y, t: now });
        }
        if (M.trail.length > 400) M.trail.splice(0, M.trail.length - 400);
        M.moves.push(now);
        M.samples.push([now, list.length]);
        paint();
        kickDraw();
      };
      /* leaving the pad brings its hint back */
      const onLeave = () => { M.x = null; M.y = null; pad.classList.remove('is-used'); paint(); };
      const onPtr = e => { M.type = e.pointerType || M.type; };

      pad.addEventListener('pointermove', onMove);
      pad.addEventListener('pointerdown', onPtr);
      pad.addEventListener('pointerleave', onLeave);
      pad.addEventListener('wheel', onWheel, { passive: false });
      pad.addEventListener('contextmenu', onCtx);
      pad.addEventListener('auxclick', onAux);
      pad.addEventListener('mousedown', onDown);
      window.addEventListener('mouseup', onUp, true);

      /* rate: counted over the trailing second, refreshed 4× a second */
      const rateTimer = setInterval(() => {
        const now = performance.now();
        while (M.moves.length && M.moves[0] < now - 1000) M.moves.shift();
        while (M.samples.length && M.samples[0][0] < now - 1000) M.samples.shift();
        const n = M.moves.length;
        const raw = M.samples.reduce((a, [, c]) => a + c, 0);
        M.peak = Math.max(M.peak, n);
        M.peakRaw = Math.max(M.peakRaw, raw);
        rateBig.textContent = String(n);
        if (M.hasCoalesced) rateRaw.textContent = String(raw);
        peakEl.textContent = M.peak ? `Highest so far: ${M.peak} events/s${M.hasCoalesced ? ` · ${M.peakRaw} raw samples/s` : ''}` : 'Move the mouse in the pad to measure.';
      }, 250);

      let wheelTimer = 0;
      function flashWheel(dir) {
        mparts.up.classList.toggle('is-on', dir < 0);
        mparts.dn.classList.toggle('is-on', dir > 0);
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { mparts.up.classList.remove('is-on'); mparts.dn.classList.remove('is-on'); }, 160);
      }

      const MODE = ['pixels', 'lines', 'pages'];
      let pq = false;
      function paint() {
        if (pq) return;
        pq = true;
        requestAnimationFrame(() => {
          pq = false;
          if (S.dead) return;
          BTN.forEach((_, i) => {
            const on = M.down.has(i);
            mparts[i]?.classList.toggle('is-on', on);
            btnChips[i].c.classList.toggle('is-on', on);
            btnChips[i].n.textContent = String(M.presses[i]);
          });
          const w = M.wheel;
          vals.wheel.textContent = w.n ? `ΔY ${fix(w.dy, w.mode ? 2 : 0)} · ΔX ${fix(w.dx, w.mode ? 2 : 0)}${w.dz ? ` · ΔZ ${fix(w.dz, 0)}` : ''} (${w.n} event${w.n === 1 ? '' : 's'})` : '—';
          vals.wheelMode.textContent = w.n ? MODE[w.mode] || String(w.mode) : '—';
          vals.type.textContent = M.type ? M.type + (M.pressure !== null ? ` · pressure ${fix(M.pressure)}` : '') : '—';
          vals.move.textContent = M.type ? `${M.mx >= 0 ? '+' : ''}${M.mx}, ${M.my >= 0 ? '+' : ''}${M.my} px (movementX/Y)` : '—';
          vals.dist.textContent = M.dist ? `${Math.round(M.dist).toLocaleString()} px in the pad` : '—';
          vals.dbl.textContent = M.dbl !== null ? `${Math.round(M.dbl)} ms between the two presses` : 'Double-click to measure';
          posEl.textContent = M.x !== null ? `${Math.round(M.x)}, ${Math.round(M.y)}` : '';
        });
      }

      /* trail: each coalesced sample is a dot, so the spacing shows the rate */
      const g = canvas.getContext('2d');
      let drawId = 0;
      let cw = 0, ch = 0;
      const ro = new ResizeObserver(() => {
        const r = pad.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        cw = r.width; ch = r.height;
        canvas.width = Math.max(1, Math.round(cw * dpr));
        canvas.height = Math.max(1, Math.round(ch * dpr));
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        kickDraw();
      });
      ro.observe(pad);
      function kickDraw() { if (!drawId) drawId = requestAnimationFrame(draw); }
      function draw() {
        drawId = 0;
        if (S.dead) return;
        const now = performance.now();
        const life = reduced() ? 1200 : 700;
        M.trail = M.trail.filter(p => now - p.t < life);
        M.rings = M.rings.filter(r => now - r.t < 600);
        g.clearRect(0, 0, cw, ch);
        const rgb = getComputedStyle(pad).getPropertyValue('--accent-rgb').trim() || '255 69 109';
        const fade = p => (reduced() ? 0.8 : Math.max(0, 1 - (now - p.t) / life));
        for (let i = 1; i < M.trail.length; i++) {
          const a = M.trail[i - 1], b = M.trail[i];
          g.strokeStyle = `rgb(${rgb} / ${fade(b) * 0.35})`;
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
        for (const p of M.trail) {
          g.fillStyle = `rgb(${rgb} / ${fade(p)})`;
          g.beginPath(); g.arc(p.x, p.y, 2.2, 0, Math.PI * 2); g.fill();
        }
        for (const r of M.rings) {
          const k = (now - r.t) / 600;
          g.strokeStyle = `rgb(${rgb} / ${1 - k})`;
          g.lineWidth = 2;
          g.beginPath(); g.arc(r.x, r.y, reduced() ? 10 : 6 + k * 18, 0, Math.PI * 2); g.stroke();
        }
        if (M.trail.length || M.rings.length) drawId = requestAnimationFrame(draw);
      }

      paint();
      return () => {
        clearInterval(rateTimer);
        clearTimeout(wheelTimer);
        if (drawId) cancelAnimationFrame(drawId);
        ro.disconnect();
        pad.removeEventListener('pointermove', onMove);
        pad.removeEventListener('pointerdown', onPtr);
        pad.removeEventListener('pointerleave', onLeave);
        pad.removeEventListener('wheel', onWheel, { passive: false });
        pad.removeEventListener('contextmenu', onCtx);
        pad.removeEventListener('auxclick', onAux);
        pad.removeEventListener('mousedown', onDown);
        window.removeEventListener('mouseup', onUp, true);
      };
    }

    /* ==================================================================
       Button mapping
       ================================================================== */
    function buildMap(el) {
      const GROUPS = [
        ['face', 'Face buttons'], ['dpad', 'D-pad'], ['lstick', 'Left stick'], ['rstick', 'Right stick'],
        ['shoulder', 'Bumpers & triggers'], ['center', 'Menu buttons & stick presses'],
      ];
      let listening = null;
      /* the code of the key that was just assigned, until its keyup: a
         button activates on Space keyup, which must not start listening
         again (keyboard clicks have detail 0; mouse clicks always work) */
      let assigning = null;
      /* a modifier pressed while listening: assigned on its keyup if it
         was pressed alone, so Shift+Tab can still cancel */
      let pendingMod = null;
      const MOD_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'];
      const rows = {};

      const sw = h('button.switch', { type: 'button', role: 'switch', 'aria-label': 'Play keyboard games with a controller', onclick: () => PM.setEnabled(!PM.isEnabled()) });
      const bridgeNote = h('p.cc-bridge__state');
      const bridge = h('div.cc-card.cc-bridge',
        h('span.cc-bridge__ic', icon('gamepad')),
        h('div.cc-bridge__text',
          h('b', { text: 'Play keyboard games with a controller' }),
          h('p', { text: 'Static Arcade games that read the keyboard receive these keys from your controller, only while the Arcade window is in front. Other apps never get them, and neither do web games, Forge creations (they run in a sealed frame), websites in the Browser or other tabs.' }),
          bridgeNote),
        sw);

      const list = h('div.cc-map__list');
      const resetBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => { PM.resetMapping(); api.notify({ app: 'Controller Center', icon: 'gamepad', title: 'Mapping reset', message: 'D-pad and left stick send arrows, A Space, B Escape, X Z, Y X, Start Enter.', timeout: 3500 }); } },
        icon('rotate-ccw'), h('span', { text: 'Reset to defaults' }));
      const hd = head('Button mapping', 'Choose the key each control sends: select a key, then press the key you want. Select it again, or press Tab, to cancel. Cmd/Ctrl shortcuts cancel too and still reach StaticOS.', resetBtn);

      /* live preview: a private bridge that dispatches into this panel only */
      const heldEl = h('div.cc-try__held', { 'aria-live': 'polite' });
      const tryLog = h('ol.cc-log.cc-log--try');
      const tryState = h('p.cc-card__note');
      const sink = h('div.cc-sink', { tabindex: '-1', 'aria-hidden': 'true' });
      const tryLines = [];
      const trySink = e => {
        e.stopPropagation();
        tryLines.unshift({ type: e.type, key: e.key, code: e.code, kc: e.keyCode });
        if (tryLines.length > 8) tryLines.length = 8;
        paintTry();
      };
      sink.addEventListener('keydown', trySink);
      sink.addEventListener('keyup', trySink);
      const tryCard = h('div.cc-card.cc-try',
        h('div.cc-card__title', icon('play'), h('span', { text: 'Try it' })),
        tryState, heldEl, tryLog, sink);

      el.append(hd.el, bridge, h('div.cc-map__grid', list, h('div.cc-map__side', tryCard,
        h('p.cc-fine', { text: 'Every connected controller sends the same keys. Key names follow the US layout. The dead zone from the Controllers tab applies to the sticks here too.' }))));

      let lastPads = -1;
      let heldNow = [];
      function paintTry(pads = lastPads) {
        clear(heldEl);
        if (heldNow.length) heldEl.append(...heldNow.map(c => h('span.cc-keycap', { text: PM.codeLabel(c) })));
        else heldEl.append(h('span.cc-try__idle', { text: pads > 0 ? 'Press a button on the controller' : 'No keys held' }));
        clear(tryLog);
        for (const l of tryLines) {
          tryLog.append(h('li', { class: l.type === 'keydown' ? 'is-down' : 'is-up' },
            h('span.cc-log__t', { text: l.type === 'keydown' ? '↓ keydown' : '↑ keyup' }),
            h('b', { text: showKey(l.key) }), h('span.cc-mono', { text: l.code, title: `keyCode ${l.kc}` })));
        }
      }
      let lastLive = true;
      function paintTryState(pads, live = lastLive) {
        tryState.textContent = !secure ? 'Browsers only share controllers with https pages, so the bridge cannot run on this page.'
          : !hasGamepadAPI ? 'This browser cannot read controllers, so the bridge cannot run here.'
          : pads > 0 && !live ? 'Held back: keys only go out while Controller Center is in front with focus in it.'
          : pads > 0 ? `${pads} controller${pads === 1 ? '' : 's'} connected. These are the real events the bridge sends — here they go to this panel only.`
            : 'No controller yet. Press a button on it — browsers only reveal a gamepad after it is used.';
      }

      /* the preview obeys the same gate as the Arcade's bridge, scoped to
         this window: nothing is sent while another window is in front */
      const preview = hasGamepadAPI ? PM.createBridge({
        target: sink, requireToggle: false, scope: root,
        onFrame: ({ active, held, pads, live }) => {
          for (const [id, r] of Object.entries(rows)) {
            const on = active.has(id);
            if (r.live !== on) { r.live = on; r.row.classList.toggle('is-live', on); }
          }
          const hs = held.join(',');
          if (hs !== heldNow.join(',')) { heldNow = held; paintTry(pads); }
          if (pads !== lastPads || live !== lastLive) {
            const padsChanged = pads !== lastPads;
            lastPads = pads;
            lastLive = live;
            paintTryState(pads, live);
            paintTry(pads);
            if (padsChanged && styleKey(PM.connectedPads()[0]) !== styleNow) paintList();
          }
        },
      }) : null;
      paintTryState(0);
      paintTry(0);

      function stopListening() {
        const was = listening;
        listening = null;
        pendingMod = null;
        if (was && rows[was]) paintRow(was);
      }
      function paintRow(id) {
        const r = rows[id];
        const code = PM.getConfig().mapping[id];
        const on = listening === id;
        r.key.classList.toggle('is-listening', on);
        r.key.classList.toggle('is-empty', !code && !on);
        r.key.textContent = on ? 'Press a key…' : code ? PM.codeLabel(code) : 'Not set';
        r.key.setAttribute('aria-label', `${r.label}: ${on ? 'press the key to assign, or Tab to cancel' : code ? `sends ${PM.codeLabel(code)} (${code})` : 'no key'}`);
        r.key.title = code ? code : '';
        r.clear.disabled = !code;
      }
      function paintList() {
        const pads = PM.connectedPads();
        styleNow = styleKey(pads[0]);
        const st = STYLES[styleNow];
        const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('[data-input]')?.dataset.input : null;
        clear(list);
        for (const [g, title] of GROUPS) {
          const items = PM.INPUTS.filter(i => i.group === g);
          list.append(h('div.cc-map__group',
            h('h3.cc-map__gtitle', { text: title }),
            items.map(inp => {
              const label = inputLabel(inp, st);
              const gtext = glyphFor(inp, st);
              const glyph = h('span.cc-glyph-slot', h('span.cc-glyph', {
                class: gtext.length > 2 ? 'is-word' : '', text: gtext,
                style: st.tint[inp.id] ? { '--tint': st.tint[inp.id] } : null,
              }));
              const key = h('button.cc-keybtn', {
                type: 'button',
                onclick: e => {
                  if (assigning && e.detail === 0) return;
                  assigning = null;
                  if (listening === inp.id) { stopListening(); return; }
                  const prev = listening;
                  listening = inp.id;
                  if (prev) paintRow(prev);
                  paintRow(inp.id);
                },
                onkeydown: e => {
                  if (listening !== inp.id) return;
                  /* Tab (and Shift+Tab) cancel and move focus as usual —
                     the keyboard way out; no Arcade game reads Tab */
                  if (e.key === 'Tab') { stopListening(); return; }
                  /* a Cmd/Ctrl combo (⌘W, Ctrl+K…) is StaticOS's, as in the
                     Keyboard tester: stop listening and let it through.
                     Ctrl or ⌘ pressed alone can still be assigned below. */
                  if ((e.metaKey || e.ctrlKey) && !MOD_KEYS.includes(e.key)) { stopListening(); return; }
                  e.preventDefault();
                  e.stopPropagation();
                  if (!e.code || e.code === 'Unidentified') { key.textContent = 'That key has no code — try another'; return; }
                  if (MOD_KEYS.includes(e.key)) { if (!e.repeat) pendingMod = e.code; return; }
                  pendingMod = null;
                  assigning = e.code;
                  listening = null;
                  PM.setMapping(inp.id, e.code);
                },
                onkeyup: e => {
                  if (listening === inp.id && pendingMod && e.code === pendingMod) {
                    /* a modifier pressed and released on its own */
                    e.preventDefault();
                    e.stopPropagation();
                    const code = pendingMod;
                    pendingMod = null;
                    listening = null;
                    PM.setMapping(inp.id, code);
                    return;
                  }
                  if (!assigning || e.code !== assigning) return;
                  e.preventDefault();          /* no Space-keyup click */
                  e.stopPropagation();
                  setTimeout(() => { if (assigning === e.code) assigning = null; }, 0);
                },
                onblur: () => { if (listening === inp.id) stopListening(); },
              });
              const clr = h('button.cc-clear', { type: 'button', 'aria-label': `Clear ${label}`, title: 'Clear', onclick: () => PM.setMapping(inp.id, '') }, icon('x'));
              const row = h('div.cc-map__row', { dataset: { input: inp.id } },
                glyph, h('div.cc-map__name', h('b', { text: label }), h('small', { text: inp.name })), key, clr);
              rows[inp.id] = { row, key, clear: clr, label, live: false };
              paintRow(inp.id);
              return row;
            })));
        }
        if (focusedId) rows[focusedId]?.key.focus({ preventScroll: true });
      }
      function glyphFor(inp, st) {
        if (st[inp.id]) return st[inp.id];
        if (inp.group === 'dpad') return ARROW[inp.id[0].toUpperCase() + inp.id.slice(1)];
        const m = /^(ls|rs)(Up|Down|Left|Right)$/.exec(inp.id);
        return m ? (m[1] === 'ls' ? 'L' : 'R') + ARROW[m[2]] : '•';
      }
      function paintBridge() {
        const on = PM.isEnabled();
        sw.classList.toggle('is-on', on);
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
        bridgeNote.textContent = !on
          ? 'Off — games only see the keyboard.'
          : PM.isActive() ? 'On · a game is open in the Arcade; its keys go out while the Arcade is in front.'
            : 'On · it starts when a game that reads the keyboard is running.';
        bridge.classList.toggle('is-on', on);
      }

      /* repaint rows in place (keeps focus on the key just assigned);
         rebuild only when the printed names change */
      let styleNow = null;
      const offStore = store.sub(PM.KEY, () => {
        paintBridge();
        if (styleKey(PM.connectedPads()[0]) !== styleNow) paintList();
        else for (const id of Object.keys(rows)) paintRow(id);
      });
      const offBus2 = bus.on('padmap:change', paintBridge);
      /* the printed names follow the first pad — also when one controller
         is swapped for another between two frames of the preview */
      const onPads = () => { if (styleKey(PM.connectedPads()[0]) !== styleNow) paintList(); };
      window.addEventListener('gamepadconnected', onPads);
      window.addEventListener('gamepaddisconnected', onPads);
      paintBridge();
      paintList();
      preview?.start();

      return () => {
        preview?.stop();
        offStore();
        offBus2();
        window.removeEventListener('gamepadconnected', onPads);
        window.removeEventListener('gamepaddisconnected', onPads);
        sink.removeEventListener('keydown', trySink);
        sink.removeEventListener('keyup', trySink);
      };
    }

    /* ==================================================================
       Compatibility
       ================================================================== */
    function buildCompat(el) {
      const INPUT_ICON = { keyboard: 'keyboard', mouse: 'mouse-pointer' };
      /* the icon set has no touch glyph: a phone outline in the same stroke style */
      const inputIcon = i => (i === 'touch'
        ? h('span.icon', s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
          s('rect', { x: 6.5, y: 2.5, width: 11, height: 19, rx: 2.5 }), s('path', { d: 'M10.5 18h3' })))
        : INPUT_ICON[i] ? icon(INPUT_ICON[i]) : null);
      const hd = head('Arcade compatibility', 'Which Static Arcade games a controller can play through the key bridge, with the mapping you have now.');

      const sw = h('button.switch', { type: 'button', role: 'switch', 'aria-label': 'Key bridge: play keyboard games with a controller', onclick: () => PM.setEnabled(!PM.isEnabled()) });
      const swText = h('span.cc-sum__swtx');
      const big = h('b');
      const sumTitle = h('b');
      const sumText = h('p');
      const shellCtls = h('div.cc-ctls');
      const list = h('ul.cc-games');
      /* games whose code reads keys the Arcade's list leaves out */
      const alsoKeys = ARCADE.filter(g => !(g.input || []).includes('keyboard') && GAME_KEYS[g.id]).map(g => g.title);
      const andList = a => a.join(', ').replace(/, ([^,]*)$/, ' and $1');
      el.append(hd.el,
        h('div.cc-card.cc-sum',
          h('div.cc-sum__top',
            h('div.cc-sum__big', big, h('span', { text: `/ ${ARCADE.length}` })),
            h('div.cc-sum__text', sumTitle, sumText),
            h('div.cc-sum__act',
              h('label.cc-sum__sw', swText, sw),
              h('button.btn.btn--sm', { type: 'button', onclick: () => select('map', { focusInto: true }) }, icon('sliders'), h('span', { text: 'Mapping' })))),
          h('div.cc-sum__shell', h('small', { text: 'In every game' }), shellCtls)),
        list,
        h('p.cc-fine', {
          text: 'Game inputs are what each game declares'
            + (alsoKeys.length ? `, plus the keyboard for ${andList(alsoKeys)}: the Arcade lists ${alsoKeys.length === 1 ? 'it as a mouse and touch game' : 'them as mouse and touch games'}, but ${alsoKeys.length === 1 ? 'its' : 'their'} code reads the arrow keys, Space and Enter too` : '')
            + '. The keys are the ones each game’s code listens for. A game ignores keys it does not use, so a button mapped to anything else does nothing there. Like the keyboard, the controller only reaches a game while the Arcade window is in front. Every controller sends the same keys, so a second player in Pong still needs the keyboard (W / S).',
        }));

      /* what drives one control: the pad inputs whose key is in its slots */
      function drive(slots, cfg, st) {
        const by = new Map();      /* display name → true, in INPUTS order */
        let met = 0;
        for (const slot of slots) {
          const codes = (typeof slot === 'function' ? slot(cfg) : slot).filter(Boolean);
          const ins = PM.INPUTS.filter(i => cfg.mapping[i.id] && codes.includes(cfg.mapping[i.id]));
          if (ins.length) met++;
          /* one key (Flap, Serve…): name the exact input, "D-pad ↑";
             several (Move): the device part, "D-pad" */
          for (const i of ins) by.set(slots.length > 1 && GROUP_NAME[i.group] ? GROUP_NAME[i.group] : inputLabel(i, st), true);
        }
        return { ok: met === slots.length, met, names: [...by.keys()] };
      }
      function ctlChip(label, d, total) {
        return h('span.cc-ctl', { class: d.ok ? '' : 'is-miss' },
          h('small', { text: label }),
          d.names.length && d.ok
            ? d.names.slice(0, 3).map(n => h('b', { text: n }))
            : h('b', { text: d.met ? `${d.met} of ${total} mapped` : 'not mapped' }));
      }

      function paint() {
        const cfg = PM.getConfig();
        const pads = PM.connectedPads();
        const st = STYLES[styleKey(pads[0])];
        const on = cfg.bridge;
        sw.classList.toggle('is-on', on);
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
        swText.textContent = on ? 'Key bridge on' : 'Key bridge off';

        const rows = ARCADE.map(g => {
          const listed = g.input || [];
          /* the Arcade's own list, or the key table above for a game whose
             code reads keys the list leaves out */
          const keyed = listed.includes('keyboard') || !!GAME_KEYS[g.id];
          const inputs = keyed && !listed.includes('keyboard') ? [...listed, 'keyboard'] : listed;
          const ctls = keyed && !TEXT_ONLY[g.id] ? (GAME_KEYS[g.id] || null) : null;
          const res = ctls ? ctls.map(([label, ...slots]) => ({ label, slots, d: drive(slots, cfg, st) })) : [];
          const verdict = !keyed ? 'no' : TEXT_ONLY[g.id] ? 'text' : !ctls ? 'unknown' : res.every(r => r.d.ok) ? 'ok' : 'map';
          return { g, res, verdict, inputs, extraKeys: inputs !== listed };
        });
        const ready = rows.filter(r => r.verdict === 'ok');
        const needMap = rows.filter(r => r.verdict === 'map');
        const pointer = rows.filter(r => r.verdict === 'no');
        const typing = rows.filter(r => r.verdict === 'text');
        big.textContent = String(ready.length);
        sumTitle.textContent = `${ready.length} of ${ARCADE.length} games are ready to play with a controller${on ? '.' : ' once the key bridge is on.'}`;
        const names = list => andList(list.map(r => r.g.title));
        const verb = list => (list.length === 1 ? 'needs' : 'need');
        const cannot = [
          pointer.length ? `${names(pointer)} ${verb(pointer)} a mouse or touch screen` : '',
          typing.length ? `${names(typing)} ${verb(typing)} real typing` : '',
        ].filter(Boolean);
        sumText.textContent = [
          needMap.length ? `${names(needMap)} ${verb(needMap)} a few keys mapped first.` : '',
          cannot.length ? `${cannot.join(', and ')} — a controller cannot stand in for ${cannot.length > 1 ? 'either' : 'that'}.` : '',
        ].filter(Boolean).join(' ');

        clear(shellCtls);
        shellCtls.append(...SHELL_KEYS.map(([label, ...slots]) => ctlChip(label, drive(slots, cfg, st), slots.length)));

        /* a rebuild keeps keyboard focus on the same button of the same game */
        const fb = list.contains(document.activeElement) ? document.activeElement : null;
        const fGame = fb?.closest('[data-game]')?.dataset.game;
        const fCls = fb ? (fb.classList.contains('cc-game__fix') ? 'cc-game__fix' : 'cc-game__play') : null;
        clear(list);
        for (const { g, res, verdict, inputs, extraKeys } of rows) {
          const ok = verdict === 'ok';
          const no = verdict === 'no' || verdict === 'text';
          const missing = res.filter(r => !r.d.ok).map(r => r.label);
          list.append(h('li.cc-game', { class: ok ? 'is-ok' : no ? 'is-no' : 'is-warn', dataset: { game: g.id, verdict } },
            h('span.cc-game__art', { style: { '--hue': String(g.hue) } }, icon(g.icon)),
            h('div.cc-game__body',
              h('div.cc-game__top', h('b', { text: g.title }), g.players.includes(2) ? h('span.cc-game__pl', { text: '1–2 players' }) : null),
              h('p', { text: g.blurb }),
              h('div.cc-game__inputs', inputs.map(i => h('span.cc-in', {
                class: i === 'keyboard' ? 'is-key' : '',
                title: i === 'keyboard' && extraKeys ? 'Not in the Arcade’s list, but the game’s code reads these keys' : null,
              }, inputIcon(i), h('span', { text: i })))),
              res.length ? h('div.cc-ctls', res.map(r => ctlChip(r.label, r.d, r.slots.length))) : null),
            h('div.cc-game__foot',
              h('div.cc-game__verdict',
                icon(ok ? 'check-circle' : no ? 'x-circle' : 'alert'),
                h('span', {
                  text: ok ? 'Ready with your mapping'
                    : verdict === 'no' ? 'Needs mouse or touch'
                      : verdict === 'text' ? 'Needs typing'
                        : verdict === 'unknown' ? 'Reads the keyboard — check its controls'
                          : `Map ${missing.join(', ').toLowerCase()} first`,
                })),
              h('div.cc-game__acts',
                verdict === 'map' ? h('button.btn.btn--sm.cc-game__fix', {
                  type: 'button', 'aria-label': `Open button mapping to set up ${g.title}`,
                  onclick: () => select('map', { focusInto: true }),
                }, icon('sliders'), h('span', { text: 'Mapping' })) : null,
                h('button.btn.btn--sm.cc-game__play', {
                  type: 'button', 'aria-label': `Play ${g.title} in the Arcade`,
                  onclick: () => api.openApp('arcade', { game: g.id }),
                }, icon('play'), h('span', { text: 'Play' })))),
            verdict === 'text' ? h('p.cc-game__caveat', { text: TEXT_ONLY[g.id] }) : null));
        }
        if (fGame) (list.querySelector(`[data-game="${fGame}"] .${fCls}`) || list.querySelector(`[data-game="${fGame}"] .cc-game__play`))?.focus({ preventScroll: true });
      }
      paint();
      const off = store.sub(PM.KEY, paint);
      /* the printed button names follow the first pad (A / ✕ / B) */
      let lastStyle = styleKey(PM.connectedPads()[0]);
      const onPads = () => {
        const next = styleKey(PM.connectedPads()[0]);
        if (next !== lastStyle) { lastStyle = next; paint(); }
      };
      window.addEventListener('gamepadconnected', onPads);
      window.addEventListener('gamepaddisconnected', onPads);
      return () => {
        off();
        window.removeEventListener('gamepadconnected', onPads);
        window.removeEventListener('gamepaddisconnected', onPads);
      };
    }

    /* ------------------------------ lifecycle ------------------------------ */
    win.onReopen?.(o => { const t = tabId(o?.tab); if (t) select(t, { focusInto: true }); });
    paintChrome();
    /* opened straight onto a tab ({ tab: 'keys' }): focus goes into it, as
       when the tab is clicked, so the Keyboard tester gets the very first
       key. Checked again once the window is up, in case whatever opened
       us took focus back meanwhile. */
    const askedTab = !!tabId(opts?.tab);
    select(S.tab, { focusInto: askedTab });
    let focusId = askedTab ? requestAnimationFrame(() => {
      focusId = 0;
      if (!S.dead && !root.contains(document.activeElement)) focusPanel();
    }) : 0;

    return () => {
      if (S.dead) return;
      S.dead = true;
      if (focusId) cancelAnimationFrame(focusId);
      focusId = 0;
      try { S.off?.(); } catch (err) { console.error(err); }
      S.off = null;
      navRO?.disconnect();
      window.removeEventListener('gamepadconnected', onPadEvent);
      window.removeEventListener('gamepaddisconnected', onPadEvent);
      offCfg();
      offBus();
    };
  },
});
