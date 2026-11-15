/* ============================================================
   arcade/touchkeys.js — on-screen buttons for keyboard games.

   touchKeys(h, icon, keys, label) -> { el, release() }: a row of
   big buttons laid over the bottom of the stage (keys come from a
   game's `touchKeys` in js/arcade/index.js: { label, code, icon?,
   at: 'left'|'mid'|'right', or 'dpad' with dir: 'up'|'down'|'left'|
   'right' for a four-way cross }). Pressing one sends that key's keydown
   to the page, letting go sends its keyup — the same synthetic keys
   the controller bridge sends (core/padmap.js), so a game sees a held
   button exactly like a held key. Several can be held at once (two
   flippers). A finger that slides off a button lets it go.
   ============================================================ */
import { keyForCode, keyCodeFor, locationFor } from '../core/padmap.js';

function send(type, code) {
  let ev;
  try { ev = new KeyboardEvent(type, { key: keyForCode(code), code, location: locationFor(code), bubbles: true, cancelable: true, composed: true }); } catch (e) { return; }
  const kc = keyCodeFor(code);
  if (kc) { try { Object.defineProperty(ev, 'keyCode', { get: () => kc }); Object.defineProperty(ev, 'which', { get: () => kc }); } catch (e) { /* key and code still work */ } }
  try { window.dispatchEvent(ev); } catch (e) { /* nothing to reach */ }
}

export function touchKeys(h, icon, keys, label) {
  const held = new Map();                /* pointerId → code */
  const up = id => {
    const code = held.get(id);
    if (!code) return;
    held.delete(id);
    if (![...held.values()].includes(code)) send('keyup', code);
    for (const b of el.querySelectorAll(`[data-code="${code}"]`)) if (![...held.values()].includes(code)) b.classList.remove('is-down');
  };
  const btn = k => {
    const b = h('button.arc-tk__btn', {
      type: 'button', 'aria-label': k.label, title: k.label, dataset: { code: k.code, at: k.at || 'mid' },
      /* keyboard and screen-reader users have the real keys; these are for fingers */
      tabindex: '-1',
    }, k.icon ? icon(k.icon) : null, k.icon ? null : h('span', { text: k.label }));
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      const was = [...held.values()].includes(k.code);
      held.set(e.pointerId, k.code);
      b.classList.add('is-down');
      if (!was) send('keydown', k.code);
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, e => up(e.pointerId));
    b.addEventListener('contextmenu', e => e.preventDefault());
    return b;
  };
  const side = at => h(`div.arc-tk__side.arc-tk__side--${at}`, keys.filter(k => (k.at || 'mid') === at).map(btn));
  /* at: 'dpad' with dir: 'up'|'down'|'left'|'right' — a cross of four, bottom left */
  const pad = keys.filter(k => k.at === 'dpad');
  const dpad = pad.length ? h('div.arc-tk__dpad', pad.map(k => { const b = btn(k); b.dataset.dir = k.dir || ''; return b; })) : null;
  const el = h('div.arc-tk', { role: 'group', 'aria-label': label || 'On-screen buttons' }, dpad, side('left'), side('mid'), side('right'));
  return {
    el,
    release() { for (const id of [...held.keys()]) up(id); },
  };
}

export default { touchKeys };
