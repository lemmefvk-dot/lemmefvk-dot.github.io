/* ============================================================
   readaloud.js — select text anywhere, and StaticOS reads it to you.

   Three ways in:
   · Right-click on selected text. "Read aloud" goes on top of the
     menu the app opens there, or — where the app has no menu of its
     own — a small one opens with Read aloud and Copy. In a text field
     (Notes, a search box) the browser's own menu is replaced only
     while text is selected in it, by Read aloud, Cut, Copy and Paste;
     ⇧ right-click still brings up the browser's menu (spelling and
     all). Nothing changes for a right-click that isn't on a selection.
   · Ctrl+Alt+S (⌃⌥S on a Mac) reads the selection; pressed again with
     nothing selected, it stops. AltGr (which is Ctrl+Alt on Windows
     and types letters on many layouts) is left alone.
   · Spotlight: "Read Selection Aloud" and "Stop Reading Aloud"
     (bus 'speech:read-selection', 'speech:stop'). Opening Spotlight
     moves focus and so clears a page selection; the last one is kept
     for it here.

   The player is a small floating panel: the text, sentence by
   sentence, with the one being read highlighted (and the word, where
   the browser sends boundary events — js/core/speech.js), Play/Pause,
   Stop, a way to Settings › Accessibility, and Close. It never takes
   focus when it appears, so the text you were reading stays put.
   Where the browser can't speak, the player says why instead.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { covered } from '../core/cover.js';
import * as SP from '../core/speech.js';
import * as KM from '../core/keymap.js';

const TEXTY = /^(text|search|url|email|tel)$/i;

/* the text selected right now: inside a focused field, or on the page */
function selectedText(where = document.activeElement) {
  const a = where;
  if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && TEXTY.test(a.type || 'text')))) {
    try {
      const s = a.selectionStart, e = a.selectionEnd;
      return s != null && e > s ? a.value.slice(s, e) : '';
    } catch (err) { return ''; }
  }
  if (a && a.tagName === 'INPUT') return '';           /* a password field, a checkbox… */
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  return sel ? String(sel) : '';
}

export function mountReadAloud(host) {
  const { h, icon, on, fmt } = api;
  const KEYS = fmt.isMac ? '⌃⌥S' : 'Ctrl+Alt+S';
  const offs = [];

  /* ---------------- the last selection ---------------- */
  /* kept while focus has only gone into Spotlight or this player, so
     "read selection" there still knows what was selected */
  let last = '';
  const note = () => {
    const a = document.activeElement;
    const inside = a && a.closest && a.closest('.spot-wrap, .ra');
    const t = inside ? '' : selectedText().trim();
    if (t) last = t;
    else if (!inside) last = '';
  };
  offs.push(on(document, 'selectionchange', note));
  offs.push(on(document, 'select', note, true));        /* a field's own selection */
  /* selectionchange arrives a frame late and can merge with Spotlight's own
     focus change; a selection made with the mouse or keys is also noted the
     moment the button or key comes up */
  offs.push(on(document, 'mouseup', note, true));
  offs.push(on(document, 'keyup', e => { if (e.shiftKey || e.key === 'Shift' || e.key === 'a' || e.key === 'A') note(); }, true));

  /* what is selected right now (nothing, while focus is in Spotlight or the player) */
  function live() {
    const a = document.activeElement;
    return a && a.closest && a.closest('.spot-wrap, .ra') ? '' : selectedText().trim();
  }

  /* ---------------- reading ---------------- */
  function read(text) {
    const t = String(text || '').trim();
    open();
    if (!t) {
      SP.clear();
      paint({ hint: 'Select some text first — in any app — then choose Read aloud, press ' + KEYS + ', or ask Spotlight to “read selection”.' });
      return;
    }
    SP.speak(t);
  }
  /* Spotlight: opening it moved focus and emptied the page's selection,
     so what was selected before it opened is what it means */
  const readSelection = () => read(live() || last);

  /* ---------------- the context menu ---------------- */
  /* A right-click on selected text: remembered for this one event, so the
     menu the app opens can carry Read aloud ('menu:extend', from
     js/shell/contextmenu.js); if no menu opens, ours does. */
  let pending = null;
  function onSelection(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return null;
    const field = t.closest('textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (field && (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT')) {
      if (field.tagName === 'INPUT' && !TEXTY.test(field.type || 'text')) return null;
      const text = selectedText(field).trim();
      return text ? { text, field } : null;
    }
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = String(sel).trim();
    if (!text) return null;
    /* only when the click lands on the selection itself */
    const rects = [...sel.getRangeAt(0).getClientRects()];
    const hit = rects.some(b => e.clientX >= b.left - 4 && e.clientX <= b.right + 4 && e.clientY >= b.top - 4 && e.clientY <= b.bottom + 4);
    return hit ? { text, field: field || null } : null;
  }

  function copyIt(c) {
    const value = c.text;
    let done = false;
    try {
      if (c.field && c.field.isConnected) c.field.focus({ preventScroll: true });
      /* the selection is still there: a real copy, which Static Clipboard records */
      if (selectedText().trim() === value) done = document.execCommand('copy');
    } catch (e) { done = false; }
    if (done) return;
    try {
      const p = navigator.clipboard && navigator.clipboard.writeText(value);
      if (p && p.then) {
        p.then(() => bus.emit('clipboard:add', { text: value, source: 'Read aloud' }),
          () => api.notify({ icon: 'alert', title: 'Could not copy', message: 'The browser refused to write to the clipboard.' }));
      }
    } catch (e) { /* nothing more to try */ }
  }
  function editIt(c, cmd) {
    if (!c.field || !c.field.isConnected) return;
    c.field.focus({ preventScroll: true });
    if (cmd === 'paste') {
      const r = navigator.clipboard && navigator.clipboard.readText && navigator.clipboard.readText();
      if (r && r.then) {
        r.then(text => { c.field.focus({ preventScroll: true }); document.execCommand('insertText', false, text); },
          () => api.notify({ icon: 'clipboard', title: 'Paste with the keyboard', message: `The browser wouldn’t let StaticOS read the clipboard. Press ${fmt.modLabel}V instead.` }));
      }
      return;
    }
    try { document.execCommand(cmd); } catch (e) { /* fine */ }
  }

  const readItem = c => ({ label: 'Read aloud', icon: 'volume-2', hint: KEYS, onClick: () => read(c.text) });
  function ownMenu(c) {
    const items = [readItem(c), '-'];
    if (c.field) {
      const ro = !!(c.field.readOnly || c.field.disabled);
      items.push(
        { label: 'Cut', icon: 'x', hint: `${fmt.modLabel}X`, disabled: ro, onClick: () => editIt(c, 'cut') },
        { label: 'Copy', icon: 'copy', hint: `${fmt.modLabel}C`, onClick: () => copyIt(c) },
        { label: 'Paste', icon: 'clipboard', hint: `${fmt.modLabel}V`, disabled: ro, onClick: () => editIt(c, 'paste') },
        '-',
        { header: true, label: '⇧ right-click: the browser’s menu' });
    } else {
      items.push({ label: 'Copy', icon: 'copy', hint: `${fmt.modLabel}C`, onClick: () => copyIt(c) });
    }
    api.menu(items, c.x, c.y, { label: 'Selected text' });
  }

  offs.push(on(window, 'contextmenu', e => {
    pending = null;
    if (covered()) return;
    const c = onSelection(e);
    if (!c || (c.field && e.shiftKey)) return;          /* ⇧: the browser's own menu */
    if (c.field) e.preventDefault();                     /* main.js lets fields keep the browser's menu */
    pending = { ...c, x: e.clientX, y: e.clientY, used: false };
    const mine = pending;
    setTimeout(() => {
      if (pending === mine) pending = null;
      if (!mine.used) ownMenu(mine);
    }, 0);
  }, true));
  offs.push(bus.on('menu:extend', o => {
    if (!pending || pending.used || !o || !Array.isArray(o.extra)) return;
    pending.used = true;
    o.extra.push(readItem(pending));
  }));

  /* ---------------- the shortcut ---------------- */
  offs.push(on(window, 'keydown', e => {
    /* Ctrl+Alt+S unless changed in Settings › Shortcuts; never AltGr (js/core/keymap.js) */
    if (!KM.matches(e, 'readaloud') || covered()) return;
    e.preventDefault();
    e.stopPropagation();                                 /* an app's own Ctrl+S must not save too */
    const t = live();
    const st = SP.state().status;
    if (!t && (st === 'speaking' || st === 'paused')) { SP.stop(); return; }
    read(t);
  }, true));

  offs.push(bus.on('speech:read-selection', readSelection));
  offs.push(bus.on('speech:read', text => read(text)));          /* Settings' "Try it" */
  offs.push(bus.on('speech:stop', () => SP.stop()));

  /* ---------------- the player ---------------- */
  let box = null;
  let hint = '';
  const P = {};
  function build() {
    P.text = h('div.ra__text');
    P.msg = h('div.ra__msg', { role: 'status', 'aria-live': 'polite' });
    P.count = h('small.ra__count');
    P.play = h('button.ra__btn.ra__btn--main', { type: 'button', onclick: () => SP.toggle() });
    P.stop = h('button.ra__btn.tip', { type: 'button', 'aria-label': 'Stop reading', 'data-tip': 'Stop', onclick: () => SP.stop() }, icon('square'));
    P.prefs = h('button.ra__btn.tip', { type: 'button', 'aria-label': 'Voice, speed and pitch (Settings)', 'data-tip': 'Voice & speed',
      onclick: () => api.openApp('settings', { section: 'accessibility' }) }, icon('settings'));
    P.close = h('button.ra__btn.tip', { type: 'button', 'aria-label': 'Close the reader', 'data-tip': 'Close', onclick: close }, icon('x'));
    P.word = h('span.ra__word');
    box = h('section.ra', { role: 'region', 'aria-label': 'Read aloud', 'data-sfx': 'off' },
      h('div.ra__head', h('span.ra__g', { 'aria-hidden': 'true' }, icon('volume-2')),
        h('b', { text: 'Read aloud' }), P.count, h('div.grow'), P.prefs, P.close),
      P.text, P.msg,
      h('div.ra__bar', P.play, P.stop, h('div.grow'), P.word));
    /* click a sentence to read from there */
    P.text.addEventListener('click', e => {
      const s = e.target instanceof Element ? e.target.closest('.ra__s') : null;
      if (s && SP.supported()) SP.from(Number(s.dataset.i));
    });
  }
  function open() {
    if (!box) build();
    if (!box.isConnected) host.appendChild(box);
    hint = '';
  }
  function close() {
    SP.clear();
    hint = '';
    box?.remove();
  }

  let painted = { parts: null, index: -2 };
  function paint(extra = {}) {
    if (!box || !box.isConnected) return;
    if (extra.hint !== undefined) hint = extra.hint;
    const st = SP.state();
    const speaking = st.status === 'speaking';
    /* the sentences: rebuilt when the text changes, re-marked as reading moves on */
    if (painted.parts !== st.parts.join('\u0000')) {
      painted.parts = st.parts.join('\u0000');
      api.render(P.text, st.parts.map((s, i) => h('span.ra__s', { dataset: { i: String(i) }, text: s + ' ' })));
      painted.index = -2;
    }
    const spans = P.text.children;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      const now = i === st.index && (speaking || st.status === 'paused');
      s.classList.toggle('is-now', now);
      s.classList.toggle('is-read', st.status === 'done' || i < st.index);
      if (now) s.setAttribute('aria-current', 'true'); else s.removeAttribute('aria-current');
      /* the word, where the browser says which one it is on */
      if (now && st.word) {
        const t = st.parts[i];
        api.render(s, t.slice(0, st.word.start), h('mark.ra__w', { text: t.slice(st.word.start, st.word.start + st.word.len) }), t.slice(st.word.start + st.word.len) + ' ');
        s.dataset.w = '1';
      } else if (s.dataset.w) {
        s.textContent = st.parts[i] + ' ';
        delete s.dataset.w;
      }
    }
    if (st.index !== painted.index) {
      painted.index = st.index;
      spans[st.index]?.scrollIntoView({ block: 'nearest' });
    }
    const n = st.parts.length;
    const many = `${n} sentence${n === 1 ? '' : 's'}`;
    P.count.textContent = !n || st.status === 'error' ? ''
      : st.status === 'done' ? `${many} · finished`
      : speaking || st.status === 'paused' ? `Sentence ${Math.min(n, st.index + 1)} of ${n}` : many;
    api.render(P.play, icon(speaking ? 'pause' : 'play', { fill: !speaking }), h('span', { text: speaking ? 'Pause' : st.status === 'paused' ? 'Resume' : 'Play' }));
    P.play.setAttribute('aria-label', speaking ? 'Pause reading' : st.status === 'paused' ? 'Resume reading' : 'Read aloud from the start');
    P.play.disabled = !st.supported || !n;
    P.stop.disabled = !(speaking || st.status === 'paused');
    const msg = st.error || hint || (st.muted && (speaking || st.status === 'paused') ? 'StaticOS is muted — turn Mute off to hear it.' : '');
    P.msg.textContent = msg;
    P.msg.classList.toggle('is-bad', !!st.error);
    P.msg.classList.toggle('hidden', !msg);
    P.text.classList.toggle('hidden', !n);
    P.word.textContent = speaking && st.parts.length ? (st.boundary ? 'Following each word' : 'Highlighting sentences') : '';
    box.classList.toggle('is-speaking', speaking);
  }
  offs.push(bus.on('speech:change', () => paint()));

  return () => { offs.forEach(off => off()); close(); };
}

export default mountReadAloud;
