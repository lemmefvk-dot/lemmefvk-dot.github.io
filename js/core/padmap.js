/* ============================================================
   padmap.js — the gamepad → keyboard bridge.

   Lets a controller drive something that only understands the
   keyboard. While a bridge runs it polls navigator.getGamepads()
   once per animation frame, turns each mapped button / stick
   direction into a key, and dispatches synthetic KeyboardEvents
   ('keydown' on press, 'keyup' on release — edge-detected, so a
   held button is one keydown, not sixty a second) to a target.

     import * as padmap from './core/padmap.js';
     padmap.start({ target: window });   // Arcade, while a game runs
     padmap.stop();                      // releases every held key
     padmap.isActive();                  // started and not stopped
     padmap.isSending();                 // … and its gate is open right now
     padmap.isEnabled();                 // the person's on/off toggle

   start() does nothing visible unless the toggle ("Play keyboard
   games with a controller", portal.controller.bridge) is on; it
   follows the toggle live, so switching it off mid-game releases
   the keys at once.

   THE GATE — keys only flow while the thing that started the bridge
   is in front, like a keyboard's. Each frame the bridge checks, in
   this order, whatever start() was given:
     app    the id of a StaticOS app: one of its windows must be the
            active one (not minimised, not behind another window).
     scope  an element (or () => element) instead: ITS window must
            be the active one and the element must be on screen.
     when   () => boolean, any extra condition of the caller's.
   With `app` or `scope`, focus must also be inside that window (or
   nowhere): with it parked in Spotlight, the dock or another window
   the keys stay back, exactly as a keyboard's would go elsewhere.
   A hidden tab, or a target that resolves to nothing (null, or a
   function returning null), shuts the gate too — nothing ever falls
   back to window. While shut, every held key gets its keyup, and a
   control still held when the gate opens again must be let go and
   pressed again (no surprise keydown when you click back in). The
   same holds for a control already held when the bridge starts or
   the toggle is switched back on.
   start() with none of the three uses app: 'arcade' — the Static
   Arcade is the bridge's only user today; anything else that starts
   it must pass its own app / scope / when.

   WHAT IT CAN AND CANNOT REACH — synthetic events are ordinary DOM
   events with isTrusted === false. So:
   · It works for script in THIS page that listens for keydown /
     keyup on the target or an ancestor of it (window, document, or
     a game's own element — pass that as `target`, or a function
     returning the element to use at dispatch time).
   · It cannot reach a cross-origin iframe or the opaque-origin
     sandbox iframes (sandbox.js): the browser does not let one
     origin dispatch events into another's document. So it does
     NOT help the web games in Games (static://games/…, hosted
     elsewhere), Forge creations, or sites in the Browser — only
     StaticOS's own pages, such as the Static Arcade.
   · It never triggers default actions: it does not type into text
     fields, scroll, press buttons or reach other tabs or the OS.
   · Code that ignores untrusted events (checks isTrusted) will not
     react to it.

   Dead zone: stick axes get a scaled radial dead zone (the same
   one the Controller Center draws), then a direction counts as
   pressed past 0.5 and released below 0.35 (hysteresis, so a
   stick resting near the threshold does not chatter).

   Keys: the mapping stores KeyboardEvent.code values; `key` is
   derived from the US layout (KeyZ → 'z'). keyCode / which are
   set too for older game code that still reads them.

   Store: portal.controller = { deadzone, bridge, mapping:{id:code} }
   (the Controller Center also keeps `labels` there).
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const KEY = 'portal.controller';

/* The standard gamepad layout (w3c "standard" mapping). `button` is
   the index in gamepad.buttons; stick directions read an axis pair. */
export const INPUTS = [
  { id: 'a',       group: 'face',   button: 0,  name: 'Bottom face button' },
  { id: 'b',       group: 'face',   button: 1,  name: 'Right face button' },
  { id: 'x',       group: 'face',   button: 2,  name: 'Left face button' },
  { id: 'y',       group: 'face',   button: 3,  name: 'Top face button' },
  { id: 'lb',      group: 'shoulder', button: 4, name: 'Left bumper' },
  { id: 'rb',      group: 'shoulder', button: 5, name: 'Right bumper' },
  { id: 'lt',      group: 'shoulder', button: 6, name: 'Left trigger', analog: true },
  { id: 'rt',      group: 'shoulder', button: 7, name: 'Right trigger', analog: true },
  { id: 'select',  group: 'center', button: 8,  name: 'Select / Back' },
  { id: 'start',   group: 'center', button: 9,  name: 'Start / Menu' },
  { id: 'l3',      group: 'center', button: 10, name: 'Left stick press' },
  { id: 'r3',      group: 'center', button: 11, name: 'Right stick press' },
  { id: 'up',      group: 'dpad',   button: 12, name: 'D-pad up' },
  { id: 'down',    group: 'dpad',   button: 13, name: 'D-pad down' },
  { id: 'left',    group: 'dpad',   button: 14, name: 'D-pad left' },
  { id: 'right',   group: 'dpad',   button: 15, name: 'D-pad right' },
  { id: 'home',    group: 'center', button: 16, name: 'Home / Guide' },
  { id: 'lsUp',    group: 'lstick', axes: [0, 1], axis: 1, dir: -1, name: 'Left stick up' },
  { id: 'lsDown',  group: 'lstick', axes: [0, 1], axis: 1, dir: 1,  name: 'Left stick down' },
  { id: 'lsLeft',  group: 'lstick', axes: [0, 1], axis: 0, dir: -1, name: 'Left stick left' },
  { id: 'lsRight', group: 'lstick', axes: [0, 1], axis: 0, dir: 1,  name: 'Left stick right' },
  { id: 'rsUp',    group: 'rstick', axes: [2, 3], axis: 3, dir: -1, name: 'Right stick up' },
  { id: 'rsDown',  group: 'rstick', axes: [2, 3], axis: 3, dir: 1,  name: 'Right stick down' },
  { id: 'rsLeft',  group: 'rstick', axes: [2, 3], axis: 2, dir: -1, name: 'Right stick left' },
  { id: 'rsRight', group: 'rstick', axes: [2, 3], axis: 2, dir: 1,  name: 'Right stick right' },
];
export const inputById = id => INPUTS.find(i => i.id === id) || null;

export const DEFAULT_MAPPING = Object.freeze({
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  lsUp: 'ArrowUp', lsDown: 'ArrowDown', lsLeft: 'ArrowLeft', lsRight: 'ArrowRight',
  a: 'Space', b: 'Escape', x: 'KeyZ', y: 'KeyX', start: 'Enter',
});
export const DEFAULT_DEADZONE = 0.15;
export const MAX_DEADZONE = 0.6;

const PRESS = 0.5;     /* a direction / trigger turns on past this … */
const RELEASE = 0.35;  /* … and off only below this */
const REPEAT_DELAY = 450;
const REPEAT_EVERY = 45;

/* ---------- config ------------------------------------------------ */
export function getConfig() {
  const c = store.get(KEY) || {};
  const dz = Number(c.deadzone);
  return {
    ...c,
    deadzone: Number.isFinite(dz) ? Math.min(MAX_DEADZONE, Math.max(0, dz)) : DEFAULT_DEADZONE,
    bridge: !!c.bridge,
    mapping: { ...DEFAULT_MAPPING, ...(c.mapping && typeof c.mapping === 'object' ? c.mapping : {}) },
  };
}
/** Merge `partial` into portal.controller (always a NEW object — store.set
    short-circuits on identical references). */
export function setConfig(partial) {
  const cur = store.get(KEY) || {};
  return store.set(KEY, { ...cur, ...partial });
}
export function setMapping(id, code) {
  const cur = store.get(KEY) || {};
  return store.set(KEY, { ...cur, mapping: { ...(cur.mapping || {}), [id]: code || '' } });
}
export function resetMapping() {
  const cur = store.get(KEY) || {};
  return store.set(KEY, { ...cur, mapping: { ...DEFAULT_MAPPING } });
}
export const isEnabled = () => getConfig().bridge;
export const setEnabled = on => setConfig({ bridge: !!on });

/* ---------- keys --------------------------------------------------- */
const NAMED_KEY = {
  Space: ' ', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Control', ControlRight: 'Control',
  AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Meta', MetaRight: 'Meta', CapsLock: 'CapsLock',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', IntlBackslash: '\\',
  NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.',
  ContextMenu: 'ContextMenu', PrintScreen: 'PrintScreen', ScrollLock: 'ScrollLock', Pause: 'Pause', NumLock: 'NumLock',
};
const KEYCODE = {
  Backspace: 8, Tab: 9, Enter: 13, NumpadEnter: 13, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17,
  AltLeft: 18, AltRight: 18, Pause: 19, CapsLock: 20, Escape: 27, Space: 32, PageUp: 33, PageDown: 34, End: 35,
  Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, PrintScreen: 44, Insert: 45, Delete: 46,
  MetaLeft: 91, MetaRight: 92, ContextMenu: 93, NumpadMultiply: 106, NumpadAdd: 107, NumpadSubtract: 109,
  NumpadDecimal: 110, NumpadDivide: 111, NumLock: 144, ScrollLock: 145, Semicolon: 186, Equal: 187, Comma: 188,
  Minus: 189, Period: 190, Slash: 191, Backquote: 192, BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222,
};
const MODIFIER = { Shift: 'shiftKey', Control: 'ctrlKey', Alt: 'altKey', Meta: 'metaKey' };

/** The `key` a US-layout keyboard produces for a physical `code`. */
export function keyForCode(code) {
  if (!code) return '';
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m) return m[1];
  if (/^F\d{1,2}$/.test(code)) return code;
  return NAMED_KEY[code] || code;
}
export function keyCodeFor(code) {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].charCodeAt(0);
  m = /^Digit(\d)$/.exec(code);
  if (m) return 48 + Number(m[1]);
  m = /^Numpad(\d)$/.exec(code);
  if (m) return 96 + Number(m[1]);
  m = /^F(\d{1,2})$/.exec(code);
  if (m) return 111 + Number(m[1]);
  return KEYCODE[code] || 0;
}
export function locationFor(code) {
  if (/Left$/.test(code) && !/^Arrow/.test(code) && code !== 'BracketLeft') return 1;
  if (/Right$/.test(code) && !/^Arrow/.test(code) && code !== 'BracketRight') return 2;
  if (/^Numpad/.test(code)) return 3;
  return 0;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const LABEL = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: isMac ? 'Left Option' : 'Left Alt', AltRight: isMac ? 'Right Option' : 'Right Alt',
  MetaLeft: isMac ? 'Left ⌘' : 'Left Win', MetaRight: isMac ? 'Right ⌘' : 'Right Win',
  CapsLock: 'Caps Lock', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  ContextMenu: 'Menu', PrintScreen: 'Print Screen', ScrollLock: 'Scroll Lock', Pause: 'Pause', NumLock: 'Num Lock',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×', NumpadDivide: 'Num ÷', NumpadDecimal: 'Num .',
  IntlBackslash: '\\ (ISO)',
};
/** A short human label for a code: 'KeyZ' → 'Z', 'ArrowUp' → '↑'. */
export function codeLabel(code) {
  if (!code) return '';
  if (LABEL[code]) return LABEL[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return 'Num ' + m[1];
  const k = NAMED_KEY[code];
  return k && k.length === 1 ? k : code;
}

/* ---------- reading a pad ------------------------------------------- */
/** Scaled radial dead zone: inside `dz` reads 0, the rest is stretched
    back to the full 0..1 range so small tilts past the ring still count. */
export function applyDeadzone(x, y, dz) {
  const m = Math.hypot(x, y);
  if (!(m > dz) || !Number.isFinite(m)) return [0, 0];
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * s, y * s];
}

export function connectedPads() {
  let list = [];
  try { list = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { list = []; }
  return [...(list || [])].filter(g => g && g.connected !== false);
}

const btnValue = b => (b && typeof b === 'object' ? (Number(b.value) || 0) : Number(b) || 0);
const btnPressed = b => (b && typeof b === 'object' ? !!b.pressed : Number(b) > 0.5);

/** Analog amount 0..1 an input is pushed on this pad, dead zone applied. */
export function inputAmount(gp, inp, dz) {
  if (inp.button !== undefined) {
    const b = gp.buttons?.[inp.button];
    if (!b) return 0;
    const v = btnValue(b);
    /* a digital trigger may report pressed with value 0 */
    if (inp.analog) return v > 0 ? Math.min(1, v) : (btnPressed(b) ? 1 : 0);
    return btnPressed(b) ? 1 : Math.min(1, v);
  }
  const ax = gp.axes || [];
  const [x, y] = applyDeadzone(Number(ax[inp.axes[0]]) || 0, Number(ax[inp.axes[1]]) || 0, dz);
  const v = inp.axis === inp.axes[0] ? x : y;
  return Math.max(0, v * inp.dir);
}

/** Is `inp` on, given whether it was on last frame (hysteresis). */
export function inputOn(gp, inp, dz, was = false) {
  if (inp.button !== undefined && !inp.analog) {
    const b = gp.buttons?.[inp.button];
    return !!b && (btnPressed(b) || btnValue(b) > PRESS);
  }
  const v = inputAmount(gp, inp, dz);
  return was ? v > RELEASE : v >= PRESS;
}

/* ---------- the gate ------------------------------------------------ */
/** The active StaticOS window, or null. */
const activeWindow = () => (typeof document !== 'undefined' ? document.querySelector('.win.is-active') : null);
/** Focus is inside `box`, or parked nowhere (the page body). */
function focusWithin(box) {
  const a = document.activeElement;
  return !a || a === document.body || a === document.documentElement || box.contains(a);
}
/** Is `app`'s window in front with focus in it (see THE GATE above)? */
export function appInFront(app) {
  const w = activeWindow();
  return !!w && w.dataset.app === String(app) && focusWithin(w);
}
/** Is `el` on screen in the window in front, with focus in that window? */
export function elementInFront(el) {
  if (!el || !el.isConnected || !el.getClientRects().length) return false;
  const w = el.closest('.win');
  if (w && !w.classList.contains('is-active')) return false;
  return focusWithin(w || el);
}

/* ---------- a bridge -------------------------------------------------
   createBridge() is the engine; the module-level start/stop drive one
   shared instance for the Arcade. The Controller Center runs a private
   preview instance (requireToggle:false, scope: its own window) that
   dispatches into its own panel only.
     target        window | Document | Element | () => one of those;
                   null, or a function returning nothing, sends nothing
     app / scope / when   the gate (see THE GATE above); none = no gate
     requireToggle only act while portal.controller.bridge is on
     repeat        send keyboard-style auto-repeat keydowns while held
     onKey({type,key,code,repeat})   after each dispatch
     onFrame({active:Set<inputId>, held:[code], pads, live})  every
                   polled frame; `live` = the gate was open            */
export function createBridge({
  target = window, app = null, scope = null, when = null,
  requireToggle = true, repeat = false, onKey = null, onFrame = null,
} = {}) {
  let running = false;
  let rafId = 0;
  let cfg = getConfig();
  const was = new Map();          /* "padIndex:inputId" → on last frame */
  const muted = new Set();        /* "padIndex:inputId" held while the gate was shut */
  const held = new Map();         /* code → { target, since, lastRepeat } */
  /* true until the first frame after start() or a release-all (toggle
     off, tab hidden): a control already held then counts as muted, so
     switching the bridge back on mid-press sends nothing until it is
     let go and pressed again — the same rule as the gate */
  let fresh = true;
  const offs = [];

  /* where keys go now — never a fallback: nothing resolved, nothing sent */
  const resolve = () => {
    let t = null;
    try { t = typeof target === 'function' ? target() : target; } catch (e) { t = null; }
    return t && typeof t.dispatchEvent === 'function' ? t : null;
  };
  function allowed() {
    try {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
      if (app && !appInFront(app)) return false;
      if (scope && !elementInFront(typeof scope === 'function' ? scope() : scope)) return false;
      if (when && !when()) return false;
      return true;
    } catch (e) {
      return false;               /* a broken gate stays shut */
    }
  }
  const mods = () => {
    const m = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
    for (const code of held.keys()) { const f = MODIFIER[keyForCode(code)]; if (f) m[f] = true; }
    return m;
  };

  function send(type, code, t, rep = false) {
    const key = keyForCode(code);
    let ev;
    try {
      ev = new KeyboardEvent(type, {
        key, code, location: locationFor(code), repeat: rep,
        bubbles: true, cancelable: true, composed: true, ...mods(),
      });
    } catch (e) { return; }
    const kc = keyCodeFor(code);
    if (kc) {
      try {
        Object.defineProperty(ev, 'keyCode', { get: () => kc });
        Object.defineProperty(ev, 'which', { get: () => kc });
      } catch (e) { /* read-only in some engine — key and code still work */ }
    }
    try { t?.dispatchEvent(ev); } catch (e) { console.warn('[padmap] dispatch failed', e); }
    try { onKey?.({ type, key, code, repeat: rep }); } catch (e) { console.error(e); }
  }

  function releaseAll() {
    /* a keyup always goes where its keydown went, gate or not */
    for (const [code, h] of [...held]) { held.delete(code); send('keyup', code, h.target); }
    was.clear();
    muted.clear();
    fresh = true;
  }

  function frame() {
    rafId = 0;
    if (!running) return;
    if (requireToggle && !cfg.bridge) { releaseAll(); return; }   /* store.sub restarts it */

    const pads = connectedPads();
    const t = resolve();
    const open = !!t && allowed();
    const active = new Set();
    const want = new Set();
    const seen = new Set();
    const first = fresh;
    fresh = false;
    for (const gp of pads) {
      for (const inp of INPUTS) {
        const k = gp.index + ':' + inp.id;
        seen.add(k);
        const on = inputOn(gp, inp, cfg.deadzone, was.get(k));
        was.set(k, on);
        if (!on) { muted.delete(k); continue; }
        active.add(inp.id);
        /* held while the gate is shut, or already held when the bridge
           (re)started: it has to be let go and pressed again before it
           sends anything */
        if (!open || first) { muted.add(k); continue; }
        if (muted.has(k)) continue;
        const code = cfg.mapping[inp.id];
        if (code) want.add(code);
      }
    }
    for (const k of [...was.keys()]) if (!seen.has(k)) { was.delete(k); muted.delete(k); }   /* unplugged */

    const now = performance.now();
    for (const [code, h] of [...held]) {
      if (!want.has(code)) { held.delete(code); send('keyup', code, h.target); }
    }
    for (const code of want) {             /* empty while the gate is shut */
      const h = held.get(code);
      if (!h) {
        held.set(code, { target: t, since: now, lastRepeat: now });
        send('keydown', code, t);
      } else if (repeat && now - h.since >= REPEAT_DELAY && now - h.lastRepeat >= REPEAT_EVERY) {
        h.lastRepeat = now;
        send('keydown', code, h.target, true);
      }
    }
    try { onFrame?.({ active, held: [...held.keys()], pads: pads.length, live: open }); } catch (e) { console.error(e); }

    /* keep polling while a pad is present; otherwise wait for one */
    if (pads.length || held.size) rafId = requestAnimationFrame(frame);
  }

  const kick = () => { if (running && !rafId) rafId = requestAnimationFrame(frame); };
  const onHidden = () => { if (document.visibilityState === 'hidden') releaseAll(); else kick(); };

  return {
    start() {
      if (running) return this;
      running = true;
      fresh = true;
      cfg = getConfig();
      offs.push(store.sub(KEY, () => { cfg = getConfig(); kick(); }));
      const onConn = () => kick();
      window.addEventListener('gamepadconnected', onConn);
      window.addEventListener('gamepaddisconnected', onConn);
      document.addEventListener('visibilitychange', onHidden);
      offs.push(() => {
        window.removeEventListener('gamepadconnected', onConn);
        window.removeEventListener('gamepaddisconnected', onConn);
        document.removeEventListener('visibilitychange', onHidden);
      });
      kick();
      return this;
    },
    stop() {
      if (!running) return;
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      releaseAll();
      offs.splice(0).forEach(off => { try { off(); } catch (e) {} });
    },
    isActive: () => running,
    /** running, switched on, and the gate is open right now */
    isSending: () => running && (!requireToggle || cfg.bridge) && !!resolve() && allowed(),
    held: () => [...held.keys()],
  };
}

/* ---------- the shared instance ------------------------------------- */
let main = null;

/** Start the shared bridge (stops a previous one first). Without an
    app / scope / when of its own it gates on the Arcade (THE GATE). */
export function start({ target = window, repeat = false, app, scope = null, when = null } = {}) {
  if (main) main.stop();
  if (app === undefined) app = scope || when ? null : 'arcade';
  main = createBridge({ target, repeat, app, scope, when, requireToggle: true }).start();
  bus.emit('padmap:change', { active: true });
  return main;
}
/** Stop it and release every key it is holding down. */
export function stop() {
  if (!main) return;
  main.stop();
  main = null;
  bus.emit('padmap:change', { active: false });
}
export const isActive = () => !!main && main.isActive();
export const isSending = () => !!main && main.isSending();

export default { start, stop, isActive, isSending, isEnabled, setEnabled, getConfig, setConfig, setMapping, resetMapping,
  createBridge, appInFront, elementInFront, applyDeadzone, connectedPads, inputOn, inputAmount, keyForCode, keyCodeFor,
  codeLabel, INPUTS, DEFAULT_MAPPING };
