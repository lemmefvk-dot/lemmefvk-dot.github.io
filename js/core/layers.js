/* ============================================================
   layers.js — one Escape, one surface.

   Menus, popovers, the launcher, Spotlight, the overview, the
   notification centre and the phone's shade and app switcher all
   open on top of each other. Each used to listen for Escape on
   its own, so one press closed every one of them at once and
   left keyboard focus on <body>.

   A surface that opens calls push() and gets back a function to
   call when it closes. While any layer is open, Escape is handled
   here, in the capture phase, and closes only the topmost one.
   Closing a layer puts focus back where it was before the layer
   opened (when focus would otherwise be lost), and a layer opened
   with { trap: true } keeps Tab inside itself, as a modal should.

   No layer open → this listener does nothing, so apps keep their
   own Escape (a game's pause menu, a text field's clear).
   ============================================================ */

const stack = [];

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),'
  + 'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

/** Elements Tab can reach inside `root`, in order, that are actually shown. */
export function focusables(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter(el => {
    if (el.closest('[inert]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
}

/**
 * Register an open surface.
 *   close   called with 'escape' when Escape should close it
 *   el      the surface's element (focus trap + "is focus inside" checks)
 *   trap    keep Tab inside el
 *   name    for debugging / tests
 * Returns release(): call it whenever the surface closes, by any route.
 */
/* The shell repaints some controls wholesale (the top bar's tray redraws on
   every preference change), so the button that opened a layer may have been
   replaced by an identical one by the time the layer closes. Remember how to
   find its twin: same tag, same accessible name, same container. */
function twinOf(el) {
  if (!el || el === document.body || !el.getAttribute) return null;
  const label = el.getAttribute('aria-label');
  const box = el.parentElement;
  if (!label || !box) return null;
  const boxSel = box.id ? `#${CSS.escape(box.id)}` : (box.classList[0] ? `.${CSS.escape(box.classList[0])}` : null);
  return boxSel ? `${boxSel} > ${el.tagName.toLowerCase()}[aria-label="${CSS.escape(label)}"]` : null;
}

export function push({ close, el = null, trap = false, name = '' } = {}) {
  const prev = document.activeElement;
  const layer = { close, el, trap, name, prev: prev && prev !== document.body ? prev : null, twin: twinOf(prev) };
  stack.push(layer);
  /* Keys typed inside a layer belong to it. Several apps listen on window
     for their own shortcuts while their window is in front (Calculator
     takes Enter for "="), and they would otherwise act on keys meant for
     the overview, a menu or the launcher sitting on top of them. Shortcuts
     with Ctrl or ⌘ still travel, for the shell's own global bindings. */
  const keep = e => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); };
  el?.addEventListener('keydown', keep);
  let done = false;
  return function release({ restoreFocus = true } = {}) {
    if (done) return;
    done = true;
    el?.removeEventListener('keydown', keep);
    const i = stack.indexOf(layer);
    if (i > -1) stack.splice(i, 1);
    if (!restoreFocus) return;
    /* only hand focus back when it would otherwise be lost — never steal it
       from something the person moved to on purpose (a window they clicked) */
    const a = document.activeElement;
    const lost = !a || a === document.body || !a.isConnected || (layer.el && layer.el.contains(a));
    let back = layer.prev;
    if (back && !back.isConnected && layer.twin) back = document.querySelector(layer.twin);
    if (lost && back && back.isConnected && typeof back.focus === 'function') {
      try { back.focus({ preventScroll: true }); } catch (e) { /* detached */ }
    }
  };
}

export const top = () => stack[stack.length - 1] || null;
export const depth = () => stack.length;
export const names = () => stack.map(l => l.name);

function onKey(e) {
  if (!stack.length) return;
  const t = top();
  if (e.key === 'Escape') {
    /* an IME composition uses Escape to cancel itself */
    if (e.isComposing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { t.close('escape'); } catch (err) { console.error(err); }
    return;
  }
  if (e.key === 'Tab' && t.trap && t.el && t.el.isConnected) {
    const f = focusables(t.el);
    if (!f.length) { e.preventDefault(); return; }
    const a = document.activeElement;
    const i = f.indexOf(a);
    if (!t.el.contains(a) || i === -1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); return; }
    if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}

if (typeof window !== 'undefined' && !window.__staticLayers) {
  window.__staticLayers = { names, depth };
  window.addEventListener('keydown', onKey, true);
}

export default { push, top, depth, names, focusables };
