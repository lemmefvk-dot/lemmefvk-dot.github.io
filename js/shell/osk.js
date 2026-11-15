/* ============================================================
   osk.js — the on-screen keyboard (Settings › Accessibility ›
   On-screen keyboard, or the accessibility button in the status bar).

   A keyboard you click or touch, for anyone who can't use a physical
   one. It types into whatever text field you were last in: pressing a
   key never takes focus from it (the buttons swallow the pointer-down),
   and if focus did leave, the field is focused again first.

   Every key goes out as a real keydown and keyup on that field, so a
   game or a terminal listening for keys hears them, and then — unless
   the page cancelled the keydown — the character is typed the way the
   browser itself would (undo works). Backspace, Enter and the arrow keys
   do their jobs in a single-line field, a text box and a document alike.

   Shift is "one capital"; press it twice for Caps Lock. 123 swaps to
   numbers and symbols. The header drags it out of the way; ✕ puts the
   preference off.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';

const ROWS = {
  letters: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'],
  ],
  symbols: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
    ['#', '%', '+', '=', '*', '!', '?', "'", '_'],
  ],
};
const NAMES = { ' ': 'Space', ',': 'comma', '.': 'full stop', '-': 'hyphen', '/': 'slash', ':': 'colon', ';': 'semicolon',
  '(': 'open bracket', ')': 'close bracket', '$': 'dollar', '&': 'ampersand', '@': 'at', '"': 'quote', '#': 'hash', '%': 'percent',
  '+': 'plus', '=': 'equals', '*': 'star', '!': 'exclamation mark', '?': 'question mark', "'": 'apostrophe', '_': 'underscore' };

/** Is this something you can type into? */
export const isEditable = el => !!el && el.nodeType === 1 && !el.closest?.('.osk') && (
  el.isContentEditable
  || (el.tagName === 'TEXTAREA' && !el.readOnly && !el.disabled)
  || (el.tagName === 'INPUT' && !el.readOnly && !el.disabled
      && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes((el.type || 'text').toLowerCase())));

/** Type `text` into `el` the way the browser would (undo and input events work). */
export function typeInto(el, text) {
  if (!el) return false;
  try { if (document.execCommand('insertText', false, text)) return true; } catch (e) { /* fall through */ }
  if ('setRangeText' in el && typeof el.selectionStart === 'number') {
    el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  }
  return false;
}

function backspace(el) {
  try { if (document.execCommand('delete')) return true; } catch (e) { /* fall through */ }
  if ('setRangeText' in el && typeof el.selectionStart === 'number') {
    let a = el.selectionStart, b = el.selectionEnd;
    if (a === b && a > 0) a -= 1;
    el.setRangeText('', a, b, 'end');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    return true;
  }
  return false;
}

function moveCaret(el, dir) {
  if (typeof el.selectionStart === 'number' && 'setSelectionRange' in el) {
    const p = Math.max(0, Math.min(el.value.length, (dir < 0 ? el.selectionStart : el.selectionEnd) + dir));
    el.setSelectionRange(p, p);
  } else {
    window.getSelection()?.modify?.('move', dir < 0 ? 'backward' : 'forward', 'character');
  }
}

export function mountOsk(host) {
  const { h, icon } = api;
  const offs = [];
  const S = { shift: false, caps: false, sym: false, target: null };

  /* the field you were last in: keys go there even if focus wandered */
  const remember = e => { const t = e.target; if (isEditable(t)) S.target = t; };
  offs.push(api.on(document, 'focusin', remember, true));
  if (isEditable(document.activeElement)) S.target = document.activeElement;
  const field = () => {
    const t = S.target;
    if (!t || !t.isConnected) return null;
    if (document.activeElement !== t) t.focus({ preventScroll: true });
    return t;
  };

  /* one key: keydown, the character, keyup */
  function press(key, text) {
    const el = field() || document.activeElement || document.body;
    const init = { key, bubbles: true, cancelable: true, composed: true,
      shiftKey: S.shift || S.caps, code: /^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : undefined };
    const down = el.dispatchEvent(new KeyboardEvent('keydown', init));
    if (down) {
      if (key === 'Backspace') backspace(el);
      else if (key === 'Enter') {
        if (el.tagName === 'TEXTAREA' || el.isContentEditable) typeInto(el, '\n');
        else el.dispatchEvent(new KeyboardEvent('keypress', init));
      } else if (key === 'ArrowLeft') moveCaret(el, -1);
      else if (key === 'ArrowRight') moveCaret(el, 1);
      else if (text != null && isEditable(el)) typeInto(el, text);
    }
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  /* ---------------- the keys ---------------- */
  const keys = [];          /* { el, ch } for the letter keys, to redraw on Shift */
  const mk = (cls, label, aria, onPress, props = {}) => h(`button.osk__k${cls}`, {
    type: 'button', 'aria-label': aria, tabindex: '0', ...props,
    /* the pointer-down must not take focus off the text field */
    onpointerdown: e => e.preventDefault(),
    onmousedown: e => e.preventDefault(),
    onclick: onPress,
  }, label);

  const el = h('div.osk', { role: 'group', 'aria-label': 'On-screen keyboard' });
  const head = h('div.osk__head',
    icon('keyboard'),
    h('span.osk__title', { text: 'On-screen keyboard' }),
    h('span.grow'),
    h('button.ibtn.osk__x', { type: 'button', 'aria-label': 'Close the on-screen keyboard', onpointerdown: e => e.preventDefault(),
      onclick: () => store.set('prefs.osk', false) }, icon('x')));
  const body = h('div.osk__body');
  el.append(head, body);

  const shown = ch => (/^[a-z]$/.test(ch) && (S.shift || S.caps) ? ch.toUpperCase() : ch);
  function paint() {
    keys.length = 0;
    body.replaceChildren();
    const layer = ROWS[S.sym ? 'symbols' : 'letters'];
    layer.forEach((row, i) => {
      const r = h('div.osk__row');
      if (i === 2) {
        r.appendChild(S.sym ? mk('.is-wide', '', '', () => {}, { disabled: true, 'aria-hidden': 'true', tabindex: '-1' })
          : mk('.is-wide' + (S.shift || S.caps ? '.is-on' : ''), S.caps ? 'Caps' : 'Shift', S.caps ? 'Caps Lock, on' : 'Shift', () => {
            if (S.caps) { S.caps = false; S.shift = false; } else if (S.shift) { S.caps = true; } else { S.shift = true; }
            paint();
            bus.emit('a11y:say', S.caps ? 'Caps Lock on' : S.shift ? 'Shift on' : 'Shift off');
          }, { 'aria-pressed': String(S.shift || S.caps) }));
      }
      for (const ch of row) {
        const k = mk('', shown(ch), NAMES[ch] || shown(ch), () => {
          const out = shown(ch);
          press(out, out);
          if (S.shift && !S.caps) { S.shift = false; paint(); }
        });
        k.dataset.k = ch;
        r.appendChild(k);
      }
      if (i === 2) r.appendChild(mk('.is-wide', icon('arrow-left'), 'Backspace', () => press('Backspace')));
      body.appendChild(r);
    });
    body.appendChild(h('div.osk__row',
      mk('.is-wide' + (S.sym ? '.is-on' : ''), S.sym ? 'ABC' : '123', S.sym ? 'Letters' : 'Numbers and symbols', () => { S.sym = !S.sym; paint(); },
        { 'aria-pressed': String(S.sym) }),
      mk('.is-arrow', icon('chevron-left'), 'Left arrow', () => press('ArrowLeft')),
      mk('.is-space', 'Space', 'Space', () => press(' ', ' ')),
      mk('.is-arrow', icon('chevron-right'), 'Right arrow', () => press('ArrowRight')),
      mk('.is-wide.is-enter', 'Enter', 'Enter', () => press('Enter'))));
  }
  paint();
  host.appendChild(el);

  /* ---------------- drag by the header ---------------- */
  let drag = null;
  offs.push(api.on(head, 'pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }));
  offs.push(api.on(head, 'pointermove', e => {
    if (!drag) return;
    const x = Math.max(0, Math.min(innerWidth - 80, e.clientX - drag.dx));
    const y = Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.dy));
    Object.assign(el.style, { left: x + 'px', top: y + 'px', bottom: 'auto', transform: 'none' });
  }));
  offs.push(api.on(head, 'pointerup', () => { drag = null; }));

  bus.emit('a11y:say', 'On-screen keyboard open. It types into the text field you were last in.');
  return () => {
    offs.forEach(off => off());
    el.remove();
  };
}

export default { mountOsk, isEditable, typeInto };
