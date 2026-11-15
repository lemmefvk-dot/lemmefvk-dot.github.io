/* ============================================================
   cheatsheet.js — hold ⌘ (Ctrl on Windows, ChromeOS, Linux) for
   about a second to see every keyboard shortcut.

   It lists the shortcuts of the app in front (its defineApp's
   `shortcuts`) and then the ones that work everywhere — all read
   from js/core/keymap.js, the same list Help › Keyboard Shortcuts
   and Settings › Shortcuts show.

     · It goes away when the key is let go.
     · Any other key pressed while holding cancels it, so ⌘C, ⌘K and
       friends never flash it — and that key still does its job.
     · A click, a scroll, leaving the tab or the boot / lock screen
       cancels it too. Phones (js/shell/mobile.js) never get it.
     · Focus never moves: what you were typing in keeps the caret.

   Help › Keyboard Shortcuts opens the same sheet to stay up (bus
   'shortcuts:show'); Esc, the close button or a click outside it
   puts it away.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { covered } from '../core/cover.js';
import * as wm from '../core/wm.js';
import * as L from '../core/layers.js';
import * as KM from '../core/keymap.js';
import { appTile } from '../core/appart.js';
import * as SL from '../core/shortcutlist.js';
import { t } from '../core/i18n.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-cheatsheet-css')) {
  const l = document.createElement('link');
  l.id = 'feat-cheatsheet-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-cheatsheet.css';
  document.head.appendChild(l);
}

/** how long the modifier has to be held on its own */
export const HOLD_MS = 900;
const MODS = ['Control', 'Meta'];

export function mountCheatSheet(host) {
  const { h, icon } = api;
  const mac = api.fmt.isMac;
  let held = null;               /* 'Control' | 'Meta' while a hold is being timed */
  let timer = 0;
  let sheet = null, pinned = false, release = null;

  const phone = () => document.body.classList.contains('is-mobile');

  function keyRow({ keys, label }) {
    const alts = KM.combos(keys, mac);
    const chips = [];
    alts.forEach((c, i) => {
      if (i) chips.push(h('span.csheet__or', { text: '/' }));
      chips.push(h('kbd.kbd', { text: mac ? c.join('') : c.join('+') }));
    });
    return h('li.csheet__row', h('span.csheet__keys', chips), h('span.csheet__what', { text: label }));
  }

  function section(title, rows, glyph) {
    return h('section.csheet__sec',
      h('h3.csheet__h', glyph || null, h('span', { text: title })),
      h('ul.csheet__list', rows.map(keyRow)));
  }

  /* the text a search looks in: the keys as written on this computer, what they do, the section */
  const hay = (r, title) => `${KM.keysText(r.keys, mac)} ${r.keys} ${r.label} ${title}`.toLowerCase();

  function build() {
    const w = wm.getActive();
    const app = w && !w.min ? w.app : null;
    const own = KM.appRows(app);
    const rows = KM.globalRows(mac);
    const groups = [];
    if (own.length) groups.push({ title: app.name, rows: own, glyph: appTile(app, { gs: '18px', sel: 'span.glyph.csheet__glyph' }) });
    for (const g of KM.GROUPS) {
      const list = rows.filter(r => r.group === g);
      if (list.length) groups.push({ title: g, rows: list });
    }
    const modName = mac ? '⌘' : 'Ctrl';
    const body = h('div.csheet__body', { tabindex: pinned ? '0' : null, 'aria-label': pinned ? t('Shortcut list') : null });
    const status = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    /* every section, or only the rows that match what was typed (words, any order) */
    function paintBody(q = '') {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const secs = [];
      let n = 0;
      for (const g of groups) {
        const list = words.length ? g.rows.filter(r => words.every(x => hay(r, g.title).includes(x))) : g.rows;
        if (list.length) { secs.push(section(g.title, list, g.glyph ? g.glyph.cloneNode(true) : null)); n += list.length; }
      }
      body.replaceChildren(...[
        own.length || words.length ? null : h('p.csheet__none', { text: app ? t('{name} has no shortcuts of its own.', { name: app.name }) : t('No window is in front.') }),
        words.length && !n ? h('p.csheet__empty', { text: `No shortcut matches “${q.trim()}”.` }) : null,
        ...secs,
      ].filter(Boolean));
      status.textContent = words.length ? (n ? `${n} shortcut${n === 1 ? '' : 's'} match` : 'No shortcut matches') : '';
    }
    paintBody();
    /* search and save only in the sheet that stays: the hold-to-peek one never takes focus */
    const find = pinned ? h('input.input.csheet__find', {
      type: 'search', placeholder: t('Search shortcuts…'), 'aria-label': t('Search shortcuts'),
      oninput: e => paintBody(e.target.value),
    }) : null;
    const secsNow = () => SL.sections(mac, app);
    const bar = pinned ? h('div.csheet__bar', find,
      h('button.btn.btn--sm.csheet__note', { type: 'button', onclick: () => { SL.saveAsNote(secsNow()); hide(); } }, icon('sticky-note'), h('span', { text: t('Save as note') })),
      h('button.btn.btn--sm.csheet__pdf', { type: 'button', onclick: () => { hide(true); SL.printList(secsNow()); } }, icon('printer'), h('span', { text: t('Save as PDF') }))) : null;
    const el = h('div.csheet' + (pinned ? '.is-pinned' : ''), {
      role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'csheet-title',
    },
      h('div.csheet__head',
        icon('keyboard'),
        h('h2.csheet__title#csheet-title', { text: t('Keyboard shortcuts') }),
        h('small.csheet__sub', { text: pinned ? t('Esc to close') : t('Let go of {modName} to close', { modName }) }),
        pinned ? h('button.ibtn.csheet__x', { type: 'button', 'aria-label': t('Close keyboard shortcuts'), onclick: () => hide() }, icon('x')) : null),
      bar, status, body);
    return el;
  }

  function show({ pin = false } = {}) {
    if (sheet) hide(true);
    if (covered() || phone()) return;
    pinned = pin;
    sheet = build();
    host.appendChild(sheet);
    release = L.push({ name: 'shortcuts', el: sheet, close: () => hide() });
    if (pin) sheet.querySelector('.csheet__find')?.focus({ preventScroll: true });
    bus.emit('a11y:say', pin ? 'Keyboard shortcuts. Escape closes.' : 'Keyboard shortcuts. Let go to close.');
  }

  function hide(now = false) {
    if (!sheet) return;
    const el = sheet;
    sheet = null;
    pinned = false;
    release?.({ restoreFocus: false });
    release = null;
    if (now) { el.remove(); return; }
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 160);
  }

  function cancel() {
    held = null;
    clearTimeout(timer);
    timer = 0;
  }

  const onDown = e => {
    if (KM.isCapturing()) { cancel(); return; }   /* Settings › Shortcuts is recording keys */
    if (MODS.includes(e.key)) {
      if (e.repeat) return;                       /* Windows repeats a held Ctrl */
      /* a second modifier (Ctrl+Shift, ⌘⌥…) is the start of a shortcut */
      const other = e.shiftKey || e.altKey || (e.key === 'Control' ? e.metaKey : e.ctrlKey);
      if (other) { cancel(); if (sheet && !pinned) hide(); return; }
      if (covered() || phone() || (sheet && pinned)) return;
      cancel();
      held = e.key;
      timer = setTimeout(() => { timer = 0; if (held && !covered()) show(); }, HOLD_MS);
      return;
    }
    /* any other key: it was a shortcut, not a hold — and the key goes on
       to do its job */
    cancel();
    if (sheet && !pinned) hide();
  };
  const onUp = e => {
    if (!MODS.includes(e.key)) return;
    cancel();
    if (sheet && !pinned) hide();
  };
  const onPointer = e => {
    cancel();
    if (!sheet) return;
    if (!pinned) { hide(); return; }
    if (e.type === 'pointerdown' && !sheet.contains(e.target)) hide();
  };
  const onLeave = () => { cancel(); if (sheet && !pinned) hide(); };

  const offs = [
    api.on(window, 'keydown', onDown, true),
    api.on(window, 'keyup', onUp, true),
    api.on(window, 'pointerdown', onPointer, true),
    api.on(window, 'wheel', e => { if (!sheet?.contains(e.target)) onPointer(e); }, { capture: true, passive: true }),
    api.on(window, 'blur', onLeave),
    api.on(document, 'visibilitychange', onLeave),
    bus.on('shortcuts:show', () => show({ pin: true })),
    bus.on('shortcuts:hide', () => hide()),
  ];

  return () => {
    cancel();
    hide(true);
    offs.forEach(off => { try { off?.(); } catch (e) {} });
  };
}

export default mountCheatSheet;
