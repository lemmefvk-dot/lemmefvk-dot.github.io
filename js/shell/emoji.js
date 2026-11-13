/* ============================================================
   emoji.js — the emoji and symbol picker: ⌘ / Ctrl + . while
   typing in any text field (an input, a textarea or anything
   contenteditable), in every app.

   A popover opens by the caret with a search box, the recently
   used ones, common symbols (→ • © ™ ° ± × ÷ ≠ ≤ ≥ ∞ π √ ✓ ★ ♥ ♪ …)
   and every emoji by group. The field keeps the keyboard and the
   caret while it's open — typing goes into the picker's search,
   so a field that acts when it loses focus (a rename box) isn't
   disturbed:

     type             search (Backspace takes a letter back)
     ← → ↑ ↓          choose · Home / End the first and last
     Tab / ⇧Tab       the next / previous group
     Enter or a click insert it at the caret, over the selection,
                      as real typing (an input event, undoable),
                      and put the picker away
     Esc, ⌘ / Ctrl+.  put it away; the field is as it was

   A field whose own key handler already takes ⌘ / Ctrl + . keeps
   it (it calls preventDefault first, and this listens after it);
   an embedded page (the proxy, a game, Forge's preview) never
   sends its keys here at all. The emoji list (js/shell/emoji.data.js,
   made by tools/emoji-data.py) loads the first time it opens.
   Recently used: store 'session.emojiRecent'.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { covered } from '../core/cover.js';
import * as L from '../core/layers.js';
import * as KM from '../core/keymap.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-emoji-css')) {
  const l = document.createElement('link');
  l.id = 'feat-emoji-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-emoji.css';
  document.head.appendChild(l);
}

const RECENT_KEY = 'session.emojiRecent';
const RECENT_MAX = 27;
const COLS = 9;
const TEXT_TYPES = new Set(['', 'text', 'search', 'url', 'tel']);

/** Can the picker type into this element? */
export function editable(el) {
  if (!el || el.disabled) return false;
  if (el.tagName === 'TEXTAREA') return !el.readOnly;
  if (el.tagName === 'INPUT') return !el.readOnly && TEXT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
  return !!el.isContentEditable;
}

/* ---------- the data, loaded once ---------------------------------- */
let DATA = null;
async function load() {
  if (DATA) return DATA;
  const mod = await import('./emoji.data.js');
  const groups = mod.GROUPS.map(g => ({
    id: g.id, name: g.name, glyph: g.glyph,
    items: g.items.split('\n').filter(Boolean).map(line => {
      const [ch, name, more = ''] = line.split('\t');
      const split = t => t.toLowerCase().split(/[\s-]+/).filter(Boolean);
      return { ch, name, sym: g.id === 'symbols', nw: split(name), kw: split(more), find: ` ${name} ${more} `.toLowerCase() };
    }),
  }));
  const byChar = new Map();
  for (const g of groups) for (const it of g.items) if (!byChar.has(it.ch)) byChar.set(it.ch, it);
  DATA = { groups, byChar };
  return DATA;
}

/** Every item whose name or keywords hold each word of the query, best first:
      1. each word is a whole word of the name ("heart" → ❤️ red heart), shortest name first
      2. … a whole keyword ("lol" → 😂), the emoji with fewer keywords first
         ("pumpkin" is more what 🎃 is about than what 🥧 is)
      3. each word starts a word of the name, shortest first
      4. … starts a keyword, fewer keywords first
      5. it's in there somewhere */
function search(q) {
  const words = q.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (!words.length) return [];
  const tiers = [[], [], [], [], []];
  const starts = (list, w) => list.some(x => x.startsWith(w));
  for (const g of DATA.groups) for (const it of g.items) {
    if (!words.every(w => it.find.includes(w))) continue;
    const tier = words.every(w => it.nw.includes(w)) ? 0
      : words.every(w => it.nw.includes(w) || it.kw.includes(w)) ? 1
        : words.every(w => starts(it.nw, w)) ? 2
          : words.every(w => starts(it.nw, w) || starts(it.kw, w)) ? 3 : 4;
    tiers[tier].push(it);
  }
  const byName = (x, y) => x.name.length - y.name.length;
  const byWords = (x, y) => x.kw.length - y.kw.length;
  [byName, byWords, byName, byWords].forEach((f, i) => tiers[i].sort(f));
  const seen = new Set();
  return tiers.flat().filter(it => !seen.has(it.ch) && seen.add(it.ch)).slice(0, 300);
}

/* ---------- where the caret is ------------------------------------- */
const MIRROR = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'letterSpacing',
  'wordSpacing', 'lineHeight', 'textTransform', 'textIndent', 'tabSize', 'direction'];

/** The caret's box on screen: { left, top, bottom }. */
function caretBox(el) {
  const box = el.getBoundingClientRect();
  const clampTo = r => ({
    left: Math.min(Math.max(r.left, box.left), box.right),
    top: Math.min(Math.max(r.top, box.top), box.bottom),
    bottom: Math.min(Math.max(r.bottom, box.top), box.bottom),
  });
  try {
    if (el.isContentEditable) {
      const sel = getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).cloneRange();
        r.collapse(false);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (rect && (rect.height || rect.width)) return clampTo(rect);
      }
      return { left: box.left + 8, top: box.top, bottom: Math.min(box.bottom, box.top + 24) };
    }
    const cs = getComputedStyle(el);
    const div = document.createElement('div');
    for (const p of MIRROR) div.style[p] = cs[p];
    Object.assign(div.style, {
      position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden', overflow: 'hidden',
      whiteSpace: el.tagName === 'INPUT' ? 'pre' : 'pre-wrap', overflowWrap: 'break-word',
    });
    const at = el.selectionEnd ?? el.value.length;
    div.textContent = el.value.slice(0, at);
    const mark = document.createElement('span');
    mark.textContent = el.value.slice(at) || '.';
    div.appendChild(mark);
    document.body.appendChild(div);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3 || 16;
    const left = box.left + mark.offsetLeft + (parseFloat(cs.borderLeftWidth) || 0) - el.scrollLeft;
    const top = box.top + mark.offsetTop + (parseFloat(cs.borderTopWidth) || 0) - el.scrollTop;
    div.remove();
    return clampTo({ left, top, bottom: top + lh });
  } catch (e) {
    return { left: box.left, top: box.top, bottom: box.bottom };
  }
}

/* ---------- the picker --------------------------------------------- */
export function mountEmoji(host) {
  const { h, icon } = api;
  let S = null;        /* the open picker's state */
  let opening = 0;

  const say = text => bus.emit('a11y:say', text);
  const recent = () => (store.get(RECENT_KEY, []) || []).filter(c => typeof c === 'string');

  async function open(field) {
    const my = ++opening;
    const sel = saveSelection(field);
    try { await load(); } catch (err) {
      console.warn('[StaticOS] emoji list did not load', err);
      api.notify({ app: 'StaticOS', icon: 'alert', title: 'Emoji aren’t available', message: 'The emoji list could not be loaded. Try again when you’re back online.' });
      return;
    }
    if (my !== opening || S || !field.isConnected || document.activeElement !== field) return;

    const input = h('input.emo__q', {
      type: 'search', placeholder: 'Search emoji and symbols', spellcheck: 'false', autocomplete: 'off',
      'aria-label': 'Search emoji and symbols', 'aria-controls': 'emo-grid',
      oninput: () => { S.q = input.value; S.sel = 0; paintGrid(); },
    });
    const tabs = h('div.emo__tabs', { role: 'tablist', 'aria-label': 'Groups' });
    const grid = h('div.emo__grid#emo-grid', { role: 'listbox', 'aria-label': 'Emoji' });
    const big = h('span.emo__big', { 'aria-hidden': 'true' });
    const name = h('span.emo__name');
    const pop = h('div.emo', { role: 'dialog', 'aria-label': 'Emoji and symbols' },
      h('div.field.emo__search', icon('search'), input),
      tabs, grid,
      h('div.emo__foot', big, name, h('small.emo__keys', { text: '↵ insert · Tab group · Esc close' })));

    S = { field, sel: 0, q: '', tab: recent().length ? 'recent' : 'smileys', items: [], saved: sel, pop, input, grid, tabs, big, name, offs: [] };

    /* the pointer never takes focus from the field — except into the search box */
    pop.addEventListener('pointerdown', e => { if (e.target !== input) e.preventDefault(); });
    pop.addEventListener('mousedown', e => { if (e.target !== input) e.preventDefault(); });
    grid.addEventListener('click', e => {
      const cell = e.target.closest('.emo__cell');
      if (cell) pick(S.items[Number(cell.dataset.i)]);
    });
    /* hover chooses — but only a pointer that moved: results repainting
       under a resting pointer must not steal the choice from the keyboard */
    let at = '';
    grid.addEventListener('pointermove', e => {
      const here = `${e.clientX},${e.clientY}`;
      if (here === at) return;
      at = here;
      const cell = e.target.closest('.emo__cell');
      if (cell && Number(cell.dataset.i) !== S.sel) { S.sel = Number(cell.dataset.i); mark(false); }
    });

    paintTabs();
    paintGrid();
    host.appendChild(pop);
    place();
    S.release = L.push({ name: 'emoji', el: pop, close: () => close(true) });
    S.offs.push(
      api.on(window, 'keydown', onKey, true),
      api.on(window, 'pointerdown', e => { if (S && !S.pop.contains(e.target)) close(false); }, true),
      api.on(window, 'focusin', e => { if (S && e.target !== S.field && !S.pop.contains(e.target)) close(false); }, true),
      api.on(window, 'scroll', e => { if (S && !S.pop.contains(e.target)) close(false); }, true),
      api.on(window, 'resize', () => close(false)),
      bus.on('win:close', () => { if (S && !S.field.isConnected) close(false); }),
    );
    say('Emoji and symbols. Type to search, arrow keys to choose, Enter to insert, Escape to close.');
  }

  function saveSelection(el) {
    if (el.isContentEditable) {
      const s = getSelection();
      return s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    }
    return { start: el.selectionStart, end: el.selectionEnd, dir: el.selectionDirection };
  }
  function restoreSelection(el, saved) {
    if (!saved) return;
    try {
      if (el.isContentEditable) {
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(saved);
      } else {
        el.setSelectionRange(saved.start, saved.end, saved.dir || 'none');
      }
    } catch (e) { /* the text changed under it: the caret stays where the browser put it */ }
  }

  function place() {
    const c = caretBox(S.field);
    const W = S.pop.offsetWidth || 340, H = S.pop.offsetHeight || 380;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = c.bottom + 6;
    if (top + H > vh - 8 && c.top - H - 6 >= 8) top = c.top - H - 6;
    top = Math.max(8, Math.min(top, vh - H - 8));
    const left = Math.max(8, Math.min(c.left - 18, vw - W - 8));
    S.pop.style.left = `${Math.round(left)}px`;
    S.pop.style.top = `${Math.round(top)}px`;
  }

  /* ---- painting ---- */
  function tabList() {
    return [{ id: 'recent', name: 'Recently used', glyph: null }, ...DATA.groups.map(g => ({ id: g.id, name: g.name, glyph: g.glyph }))];
  }
  function paintTabs() {
    const searching = !!S.q.trim();
    S.tabs.replaceChildren(...tabList().map(t => h('button.emo__tab' + (!searching && t.id === S.tab ? '.is-on' : ''), {
      type: 'button', role: 'tab', tabindex: '-1', 'aria-selected': String(!searching && t.id === S.tab),
      'aria-label': t.name, title: t.name, dataset: { tab: t.id },
      onclick: () => setTab(t.id),
    }, t.glyph ? h('span', { text: t.glyph, 'aria-hidden': 'true' }) : icon('clock'))));
  }
  function itemsNow() {
    if (S.q.trim()) return search(S.q.trim());
    if (S.tab === 'recent') return recent().map(ch => DATA.byChar.get(ch) || { ch, name: ch, nw: [], kw: [], find: '' });
    return DATA.groups.find(g => g.id === S.tab)?.items || [];
  }
  function paintGrid() {
    S.items = itemsNow();
    if (S.sel >= S.items.length) S.sel = Math.max(0, S.items.length - 1);
    const label = S.q.trim() ? `Results for ${S.q.trim()}` : tabList().find(t => t.id === S.tab)?.name || 'Emoji';
    S.grid.setAttribute('aria-label', label);
    if (!S.items.length) {
      S.grid.replaceChildren(h('p.emo__empty', { text: S.q.trim() ? `Nothing called “${S.q.trim()}”.` : 'Nothing used yet — what you pick shows up here.' }));
    } else {
      S.grid.replaceChildren(...S.items.map((it, i) => h('div.emo__cell' + (it.sym ? '.emo__cell--sym' : ''), {
        role: 'option', id: `emo-opt-${i}`, 'aria-selected': 'false', 'aria-label': it.name, title: it.name,
        dataset: { i: String(i) }, text: it.ch,
      })));
    }
    S.grid.scrollTop = 0;
    paintTabs();
    mark(true);
  }
  function mark(scroll) {
    const cells = S.grid.children;
    for (const c of S.grid.querySelectorAll('.emo__cell.is-on')) { c.classList.remove('is-on'); c.setAttribute('aria-selected', 'false'); }
    const it = S.items[S.sel];
    const cell = it ? cells[S.sel] : null;
    if (cell) {
      cell.classList.add('is-on');
      cell.setAttribute('aria-selected', 'true');
      if (scroll) cell.scrollIntoView({ block: 'nearest' });
      S.input.setAttribute('aria-activedescendant', cell.id);
    } else S.input.removeAttribute('aria-activedescendant');
    S.big.textContent = it ? it.ch : '';
    S.name.textContent = it ? it.name : '';
  }
  function move(by) {
    if (!S.items.length) return;
    S.sel = Math.max(0, Math.min(S.items.length - 1, S.sel + by));
    mark(true);
    /* the field keeps focus, so say what is chosen */
    const it = S.items[S.sel];
    if (it && document.activeElement !== S.input) say(it.name);
  }
  function setTab(id) {
    S.tab = id;
    S.q = '';
    S.input.value = '';
    S.sel = 0;
    paintGrid();
    say(tabList().find(t => t.id === id)?.name || '');
  }
  function stepTab(dir) {
    const ids = tabList().map(t => t.id);
    const at = S.q.trim() ? (dir > 0 ? -1 : 0) : ids.indexOf(S.tab);
    setTab(ids[(at + dir + ids.length) % ids.length]);
  }

  /* ---- choosing ---- */
  function pick(it) {
    if (!S || !it) return;
    const { field, saved } = S;
    const back = document.activeElement !== field;
    close(false);
    if (!field.isConnected) return;
    if (back) { try { field.focus({ preventScroll: true }); } catch (e) {} restoreSelection(field, saved); }
    insert(field, it.ch);
    store.set(RECENT_KEY, [it.ch, ...recent().filter(c => c !== it.ch)].slice(0, RECENT_MAX));
  }

  function insert(field, text) {
    let done = false;
    /* typing's own path: beforeinput + input events, and ⌘Z undoes it */
    try { done = document.execCommand('insertText', false, text); } catch (e) { done = false; }
    if (done) return;
    /* no execCommand here: put it in by hand and say so the same way typing would */
    if (field.isContentEditable) {
      const s = getSelection();
      if (!s.rangeCount) return;
      const r = s.getRangeAt(0);
      r.deleteContents();
      const t = document.createTextNode(text);
      r.insertNode(t);
      r.setStartAfter(t);
      r.collapse(true);
      s.removeAllRanges();
      s.addRange(r);
    } else {
      field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
    }
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  function close(refocus) {
    if (!S) return;
    const { field, pop, offs, release, saved } = S;
    S = null;
    offs.forEach(off => { try { off(); } catch (e) {} });
    release?.({ restoreFocus: false });
    pop.remove();
    if (refocus && field.isConnected && document.activeElement !== field) {
      try { field.focus({ preventScroll: true }); } catch (e) {}
      restoreSelection(field, saved);
    }
  }

  /* ---- the keyboard, while it's open (capture: before the app's own keys) ---- */
  const MODIFIERS = ['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'OS'];
  function onKey(e) {
    if (!S || e.isComposing || MODIFIERS.includes(e.key)) return;   /* a modifier on its own is not a key yet */
    const inSearch = document.activeElement === S.input;
    const own = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    /* AltGr arrives as Ctrl+Alt on Windows and types letters (ą, @, €) */
    const altGr = !!e.getModifierState?.('AltGraph');
    if (KM.matches(e, 'emoji')) { own(); close(true); return; }
    if ((e.ctrlKey || e.metaKey) && !altGr) {
      /* a shortcut: the search box keeps its own (copy, select all …);
         anywhere else the picker steps aside and the shortcut runs */
      if (!inSearch) close(false);
      return;
    }
    switch (e.key) {
      case 'ArrowLeft': own(); move(-1); return;
      case 'ArrowRight': own(); move(1); return;
      case 'ArrowUp': own(); move(-COLS); return;
      case 'ArrowDown': own(); move(COLS); return;
      case 'PageUp': own(); move(-COLS * 5); return;
      case 'PageDown': own(); move(COLS * 5); return;
      case 'Home': if (!inSearch) { own(); S.sel = 0; mark(true); } return;
      case 'End': if (!inSearch) { own(); S.sel = Math.max(0, S.items.length - 1); mark(true); } return;
      case 'Enter': own(); pick(S.items[S.sel]); return;
      case 'Tab': own(); stepTab(e.shiftKey ? -1 : 1); return;
      case 'Escape': own(); close(true); return;
      case 'Backspace':
        if (inSearch) { e.stopImmediatePropagation(); return; }
        own();
        if (S.q) { S.q = S.q.slice(0, -1); S.input.value = S.q; S.sel = 0; paintGrid(); }
        return;
      case 'Delete':
        if (!inSearch) own(); else e.stopImmediatePropagation();
        return;
      default:
        if ([...e.key].length === 1) {
          /* a character: it's for the search, not the field */
          if (inSearch) { e.stopImmediatePropagation(); return; }
          own();
          S.q += e.key;
          S.input.value = S.q;
          S.sel = 0;
          paintGrid();
        }
    }
  }

  /* ---- opening it ---- */
  const offs = [
    api.on(window, 'keydown', e => {
      /* ⌘ / Ctrl + . unless changed in Settings › Shortcuts (js/core/keymap.js) */
      if (!KM.matches(e, 'emoji') || e.repeat) return;
      if (e.defaultPrevented || S || covered()) return;   /* the field took it, or the picker is up */
      const el = document.activeElement;
      if (!editable(el)) return;
      e.preventDefault();
      open(el);
    }),
    bus.on('emoji:close', () => close(true)),
    /* a button beside a field (Social's status emoji) opens it for that field */
    bus.on('emoji:open', el => { if (S || covered() || !editable(el)) return; el.focus(); open(el); }),
  ];

  /* for tests and the console */
  if (window.Static) window.Static.emoji = { open: el => open(el || document.activeElement), close: () => close(true), isOpen: () => !!S };

  return () => {
    close(false);
    offs.forEach(off => { try { off(); } catch (e) {} });
  };
}

export default mountEmoji;
