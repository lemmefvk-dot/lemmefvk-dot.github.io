/* ============================================================
   arcade/keyremap.js — keys a person remapped for one game.

   remapper({ active, map }) listens on window in the capture phase,
   so it sees a key before any game does. While active() says yes,
   a real key press whose code is in map() — { [physical code]:
   game code } — is stopped and the same press is sent again as the
   game's own key (keydown and keyup, with `key` and `code` for the
   game's code, from core/padmap.js's US-layout table). So "use J for
   Space" works in every keyboard game without the game knowing.

   Only real presses are remapped (isTrusted): the controller bridge's
   synthetic keys and our own re-sent ones pass straight through, so
   a swap (A→B, B→A) does not loop. Typing in a text field is never
   touched. A key held when the map changes still gets the right keyup.
   ============================================================ */
import { keyForCode, keyCodeFor, locationFor } from '../core/padmap.js';

export function remapper({ active, map }) {
  const down = new Map();            /* physical code → the code we sent for it */
  const send = (type, code, from, target) => {
    let ev;
    try {
      ev = new KeyboardEvent(type, {
        key: keyForCode(code), code, location: locationFor(code), repeat: from.repeat,
        bubbles: true, cancelable: true, composed: true,
        shiftKey: from.shiftKey, ctrlKey: from.ctrlKey, altKey: from.altKey, metaKey: from.metaKey,
      });
    } catch (e) { return; }
    const kc = keyCodeFor(code);
    if (kc) {
      try {
        Object.defineProperty(ev, 'keyCode', { get: () => kc });
        Object.defineProperty(ev, 'which', { get: () => kc });
      } catch (e) { /* key and code still work */ }
    }
    try { (target && target.dispatchEvent ? target : window).dispatchEvent(ev); } catch (e) { /* nothing to reach */ }
  };
  const typing = t => !!t?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]');
  const onKey = e => {
    if (!e.isTrusted || typing(e.target)) return;
    if (e.type === 'keyup' && down.has(e.code)) {
      const to = down.get(e.code);
      down.delete(e.code);
      e.stopImmediatePropagation();
      e.preventDefault();
      send('keyup', to, e, e.target);
      return;
    }
    if (e.type !== 'keydown' || e.ctrlKey || e.metaKey || e.altKey) return;
    let on = false;
    try { on = !!active(); } catch (err) { on = false; }
    if (!on) return;
    const to = (map() || {})[e.code];
    if (!to || to === e.code) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    down.set(e.code, to);
    send('keydown', to, e, e.target);
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  return {
    /** let go of anything held (leaving the game) */
    release() { for (const [, to] of [...down]) send('keyup', to, { repeat: false }, window); down.clear(); },
    stop() {
      this.release();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    },
  };
}

export default { remapper };
