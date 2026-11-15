/* ============================================================
   clipboard.js — Static Clipboard: a clipboard manager.

   The history itself lives in js/core/clipboard.js (the engine
   the lead starts at boot; this app also calls its idempotent
   init() so capture is on the moment the app is first opened).
   This file is only the window onto it:

   · A list of recent items, newest first, each with where it
     came from (the app whose window it was copied in, "System
     clipboard" for Paste, or whatever StaticOS code sent it) and
     when. Click a row to copy it back; it then becomes the
     newest item, because it is what is on the clipboard now.
   · Pin / unpin, delete, search, filters for All / Pinned /
     each source. Pinned items always sit in their own section at
     the top and are never pushed out by newer copies.
   · Search matches every word you type (in any order) against
     the text and where it came from — "double quotes" keep a
     phrase together — and highlights what matched. The same
     search powers Spotlight's "clip …" scope (js/core/clipboard.js
     search()).
   · Clearing: with pins, the bar's button is "Clear unpinned"
     and keeps them; "Clear all…" is in the ⋯ menu. Both confirm
     with exactly what goes — and say the system clipboard itself
     is untouched.
   · Paste from clipboard: navigator.clipboard.readText() runs
     only when the button is clicked (the browser may ask first),
     and ⌘V / Ctrl+V inside this window does the same through the
     paste event. Every failure mode (unsupported, blocked, empty,
     not text) gets its own honest message.
   · A note says plainly what a web page can and cannot see: it
     is not allowed to read the system clipboard in the
     background, so copies made in other tabs and programs only
     arrive via Paste. StaticOS's own Copy buttons do land here:
     the engine wraps navigator.clipboard.writeText() for this
     page.

   Sensitive items (passwords, keys/tokens, card numbers, one-time
   codes — the engine decides) are shown as a blurred mask until
   clicked, so the secret is not even in the DOM until then. They
   can be copied without revealing, can't be pinned, are never
   saved, and a live countdown shows when they clear (2 minutes).

   Also here: quick transforms (copy a clip as UPPERCASE, lowercase,
   Title Case or trimmed), a Snippets tab of pinned items you have
   named (or typed in), "Select" to combine several clips into one,
   Send to Notes and Make a task, a character and word count on every
   text clip, "Unpinned items expire" (never, an hour, a day, a week),
   picture clips with thumbnails, and Export history. Picture clips
   only come from StaticOS's own copy paths (QR's Copy image, Paint's
   Copy picture) or a Paste you press: a web page can't read the system
   clipboard in the background, so a picture copied in another program
   never arrives on its own. Export, Send to Notes, Make a task,
   transforms and combine never touch the hidden sensitive items.

   Everything on screen is measured from the engine's list; empty
   states say what is actually true. Keyboard: ↑/↓/Home/End move
   between items, Enter or ⌘C copies (Enter reveals a hidden
   one first), P pins, Delete removes, / or ⌘F searches,
   Shift+F10 opens a row's menu, ⌘V adds from the clipboard.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as CB from '../core/clipboard.js';
import * as NF from '../core/notesfmt.js';
import * as TASKS from '../core/tasks.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-clipboard-css')) {
  const l = document.createElement('link');
  l.id = 'feat-clipboard-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-clipboard.css';
  document.head.appendChild(l);
}

const NARROW = 560;           /* below this painted width the sidebar becomes a chip strip */
const PREVIEW_CHARS = 600;    /* a collapsed row puts at most this much text in the DOM */
const MASK = '••••••••••••••••';
const nf = new Intl.NumberFormat();
const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : (many || one + 's')}`;
const oneLine = (s, max = 80) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };

function isColor(t) {
  if (t.length > 60) return false;
  if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) && !/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)$/i.test(t)) return false;
  try { return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', t); } catch (e) { return false; }
}
function looksLikeCode(t) {
  if (t.length < 12) return false;
  let score = 0;
  if (/[{};]\s*$/m.test(t)) score++;
  if (/^(?: {2,}|\t+)\S/m.test(t)) score++;
  if (/=>|\b(?:function|const|let|var|return|import|export|class|def|elif|lambda|public|static|void|SELECT|FROM|WHERE)\b|#include/.test(t)) score++;
  if (/[A-Za-z_$][\w$]*\([^()]*\)/.test(t)) score++;
  if (/<\/?[a-z][\w-]*(?:\s[^<>]*)?>/i.test(t)) score++;
  return score >= 2;
}
/** what an item is, for its glyph and a few extras (never shown for a sensitive item) */
function kindOf(it) {
  if (it.sensitive) return { key: 'secret', icon: 'lock', label: 'Sensitive', mono: true };
  if (it.image) return { key: 'image', icon: 'image', label: 'Picture' };
  const t = it.text.trim();
  if (/^https?:\/\/[^\s]+$/i.test(t)) return { key: 'link', icon: 'link', label: 'Link', url: t };
  if (/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(t)) return { key: 'email', icon: 'send', label: 'Email address' };
  if (isColor(t)) return { key: 'color', icon: 'palette', label: 'Colour', color: t };
  if (/^[-+]?\d[\d,]*(?:\.\d+)?%?$/.test(t)) return { key: 'number', icon: 'calculator', label: 'Number', mono: true };
  if (looksLikeCode(t)) return { key: 'code', icon: 'code', label: 'Code', mono: true };
  if (/^(?:~|\.{1,2})?\/\S*$/.test(t)) return { key: 'path', icon: 'folder', label: 'Path', mono: true };
  return { key: 'text', icon: 'file-text', label: 'Text' };
}

defineApp({
  id: 'clipboard',
  name: 'Static Clipboard',
  icon: 'clipboard',
  g1: '#ffdf8a', g2: '#b8680f',
  category: 'Utilities',
  keywords: ['clipboard', 'copy', 'paste', 'cut', 'history', 'clips', 'snippets', 'pasteboard', 'copied', 'pin'],
  desc: 'A history of what you copy and cut in StaticOS',
  singleton: true,
  win: { w: 780, h: 560, minW: 360, minH: 360 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, confirm, menu, fmt } = api;
    const MOD = fmt.modLabel === '⌘' ? '⌘' : 'Ctrl+';
    const LIM = CB.LIMITS;

    CB.init();    /* idempotent — capture may already be running since boot */

    const uiPrefs = () => { const v = store.get(CB.KEY); return (v && typeof v === 'object' && v.ui && typeof v.ui === 'object') ? v.ui : {}; };
    const saveUi = patch => {
      const cur = store.get(CB.KEY);
      const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {};
      store.set(CB.KEY, { ...base, ui: { ...uiPrefs(), ...patch } });
    };

    const S = {
      items: CB.list(),
      view: 'all',              /* 'all' | 'pinned' | 'snippets' | 'src:<source name>' */
      picking: false,           /* "Select" is on: rows get a checkbox, for Combine */
      picked: new Set(),        /* item ids ticked, in the order they were ticked */
      sep: '\n',                /* what Combine puts between clips */
      snip: null,               /* the snippet form: { id|null, name, text } while it is open */
      q: '',
      revealed: new Set(),      /* sensitive items shown in the clear, this window only */
      open: new Set(),          /* rows showing their whole text */
      copiedId: null,
      flashId: null,
      noteHidden: !!uiPrefs().noteHidden,
      busyPaste: false,
      narrow: false,
      dead: false,
      focusAfter: null,         /* data-fkey to focus after the next render */
    };
    if (opts && typeof opts.view === 'string') S.view = opts.view;
    if (opts && typeof opts.q === 'string') S.q = opts.q;

    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!S.dead) fn(); }, ms); timers.add(t); return t; };
    const cancel = t => { if (t) { clearTimeout(t); timers.delete(t); } };
    let measureRaf = 0;

    /* ================================================================ */
    /*  static chrome (built once, so typing in search never loses focus) */
    /* ================================================================ */
    const sideEl = h('aside.app__side.clip__side', { 'aria-label': 'Clipboard filters' });
    const titleEl = h('div.app__title.clip-title', { text: 'All items' });
    const countEl = h('span.clip-count.dim');
    const searchIn = h('input', {
      type: 'search', placeholder: 'Search clipboard', spellcheck: 'false', autocomplete: 'off',
      'aria-label': 'Search clipboard history — every word must match', value: S.q,
      oninput: e => { S.q = e.target.value; renderBody(); syncBar(); },
      onkeydown: e => {
        if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; S.q = ''; renderBody(); syncBar(); }
        else if (e.key === 'ArrowDown') { const first = bodyEl.querySelector('.clip-row__main'); if (first) { e.preventDefault(); first.focus(); } }
      },
    });
    const searchField = h('label.field.clip-search', icon('search'), searchIn);
    const pasteBtn = h('button.btn.btn--sm.btn--primary.clip-paste', {
      type: 'button', 'aria-label': 'Paste from clipboard', title: 'Add what is on your clipboard now (the browser may ask first)', onclick: () => pasteFromSystem(),
    }, icon('clipboard'), h('span', { text: 'Paste' }));
    const clearText = h('span.clip-clear__t', { text: 'Clear all' });
    const clearBtn = h('button.btn.btn--sm.clip-clear', {
      type: 'button', 'aria-label': 'Clear all', title: 'Clear all',
      onclick: () => (clearKeepsPins() ? clearUnpinned() : clearAll()),
    }, icon('trash'), clearText);
    /* with pins (and something else to clear) the bar's button keeps them; Clear all is in ⋯ */
    const clearKeepsPins = () => { const p = S.items.filter(i => i.pinned).length; return p > 0 && p < S.items.length; };
    const moreBtn = h('button.ibtn.clip-more', {
      type: 'button', 'aria-label': 'More options', 'aria-haspopup': 'menu', title: 'More', onclick: () => openMore(),
    }, icon('more-horizontal'));
    const selectBtn = h('button.btn.btn--sm.clip-select', {
      type: 'button', 'aria-pressed': 'false', title: 'Tick several clips to join them into one', onclick: () => setPicking(!S.picking),
    }, icon('check-circle'), h('span', { text: 'Select' }));
    const barEl = h('div.app__bar.clip-bar',
      h('div.clip-bar__head', titleEl, countEl),
      h('span.clip-spacer'),
      searchField, pasteBtn, selectBtn, clearBtn, moreBtn);

    /* the Combine tray: shown while "Select" is on */
    const sepSel = h('select.select.clip-sep', {
      'aria-label': 'Put between the clips', onchange: e => { S.sep = e.target.value === 'blank' ? '\n\n' : e.target.value === 'space' ? ' ' : e.target.value === 'comma' ? ', ' : '\n'; },
    },
    h('option', { value: 'line', text: 'New line between' }), h('option', { value: 'blank', text: 'Blank line between' }),
    h('option', { value: 'space', text: 'Space between' }), h('option', { value: 'comma', text: 'Comma between' }));
    const pickCount = h('span.clip-pick__n');
    const combineBtn = h('button.btn.btn--sm.btn--primary.clip-combine', { type: 'button', onclick: () => combineClips() }, icon('layers'), h('span', { text: 'Combine' }));
    const pickEl = h('div.clip-pick', { role: 'toolbar', 'aria-label': 'Combine clips', hidden: true },
      pickCount, h('span.clip-spacer'), sepSel, combineBtn,
      h('button.btn.btn--sm', { type: 'button', onclick: () => setPicking(false) }, h('span', { text: 'Done' })));

    const noteEl = h('div.clip-note', { role: 'note' },
      icon('info'),
      h('div.clip-note__t',
        h('p', h('b', { text: 'Copy or cut anything inside StaticOS — including an app’s own Copy button — and it lands here.' }),
          ` Web pages can’t read your clipboard in the background, so anything copied in another tab, another program or an embedded game only arrives when you press Paste (your browser may ask) or ${MOD}V in this window.`),
        h('p.clip-note__s', { text: 'Passwords, keys, card numbers and one-time codes stay blurred, are never saved, never exported, and clear after 2 minutes.' }),
        h('p.clip-note__s', { text: 'Pictures only arrive from StaticOS’s own copy buttons (QR, Paint) or when you paste one here — a page can’t watch the system clipboard for pictures either.' })),
      h('button.ibtn.clip-note__x', { type: 'button', 'aria-label': 'Hide this note', title: 'Hide', onclick: () => setNote(false) }, icon('x')));

    const bodyEl = h('div.app__content.app__content--flush.clip-body');
    const toastEl = h('div.clip-toast', { role: 'status', 'aria-live': 'polite' });
    const mainEl = h('div.app__main.clip__main', barEl, noteEl, bodyEl, pickEl, toastEl);
    const appEl = h('div.app.clip', sideEl, mainEl);
    root.appendChild(appEl);

    /* ================================================================ */
    /*  data helpers                                                    */
    /* ================================================================ */
    const find = id => S.items.find(i => i.id === id) || null;
    const ago = at => (at ? fmt.fmtAgo(at) : '');
    const fullDate = at => (at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
    const leftLabel = exp => {
      const s = Math.max(0, Math.ceil((exp - Date.now()) / 1000));
      return `clears in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    function sourcesOf(list) {
      const m = new Map();
      for (const i of list) m.set(i.source, (m.get(i.source) || 0) + 1);
      return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    }
    function sourceIcon(name) {
      if (name === 'System clipboard') return 'clipboard';
      if (name === 'StaticOS') return 'monitor';
      const app = api.listApps({ includeHidden: true }).find(a => a.name === name);
      return app && api.hasIcon(app.icon) ? app.icon : 'grid-9';
    }
    /* every word must match (the engine's own rule, shared with Spotlight);
       a sensitive item's text is never searched — only its source and label */
    const termsOf = q => CB.searchTerms(q);
    const matches = (it, q) => CB.matchesItem(it, termsOf(q));
    /** text with every search hit wrapped in <mark>, built from text nodes only */
    function marked(text, terms) {
      const t = String(text);
      if (!terms.length || !t) return [t];
      const low = t.toLowerCase();
      if (low.length !== t.length) return [t];          /* a case fold changed the length — don't guess at offsets */
      const spans = [];
      for (const term of terms) {
        for (let i = low.indexOf(term); i !== -1 && spans.length < 400; i = low.indexOf(term, i + term.length)) spans.push([i, i + term.length]);
      }
      if (!spans.length) return [t];
      spans.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of spans) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      const out = [];
      let at = 0;
      for (const [a, b] of merged) {
        if (a > at) out.push(t.slice(at, a));
        out.push(h('mark.clip-hit', { text: t.slice(a, b) }));
        at = b;
      }
      if (at < t.length) out.push(t.slice(at));
      return out;
    }
    function inView(it) {
      if (S.view === 'pinned') return it.pinned;
      if (S.view === 'snippets') return it.pinned && !!it.name;
      if (S.view.startsWith('src:')) return it.source === S.view.slice(4);
      return true;
    }
    const visible = () => { const terms = termsOf(S.q); return S.items.filter(it => inView(it) && CB.matchesItem(it, terms)); };
    function viewTitle() {
      if (S.view === 'pinned') return 'Pinned';
      if (S.view === 'snippets') return 'Snippets';
      if (S.view.startsWith('src:')) return S.view.slice(4);
      return 'All items';
    }

    /* ================================================================ */
    /*  actions                                                         */
    /* ================================================================ */
    let toastT = 0;
    function toast(msg, tone) {
      cancel(toastT);
      toastEl.textContent = msg;
      toastEl.classList.toggle('is-bad', tone === 'bad');
      toastEl.classList.add('is-on');
      toastT = later(() => toastEl.classList.remove('is-on'), tone === 'bad' ? 5200 : 2400);
    }

    let flashT = 0;
    function flash(id) {
      S.flashId = id;
      cancel(flashT);
      flashT = later(() => { S.flashId = null; bodyEl.querySelector('.clip-row.is-flash')?.classList.remove('is-flash'); }, 1600);
    }

    /** write to the system clipboard; the async API first, the legacy command as a fallback */
    async function writeClipboard(text) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (e) { /* blocked or the page lost focus — try the older way */ }
      const prev = document.activeElement;
      /* data-clip-ignore: the engine must not record this helper's own copy event */
      const ta = h('textarea', { 'data-clip-ignore': '', 'aria-hidden': 'true', tabindex: '-1', readonly: '',
        style: { position: 'fixed', top: '0', left: '-9999px', width: '1px', height: '1px', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      let ok = false;
      try { ta.select(); ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      try { if (prev && typeof prev.focus === 'function' && prev.isConnected) prev.focus({ preventScroll: true }); } catch (e) { /* nothing to restore */ }
      return !!ok;
    }

    let copiedT = 0;
    async function copyItem(id) {
      const it = find(id);
      if (!it) return;
      if (it.image) { await copyPicture(it); return; }
      const ok = await writeClipboard(it.text);
      if (S.dead) return;
      if (!ok) {
        /* a real keyboard copy still works where scripted writes are blocked — see onCopy below */
        const main = [...bodyEl.querySelectorAll('.clip-row__main')].find(b => b.dataset.fkey === `row:${id}:main`);
        if (main) main.focus();
        toast(`Your browser blocked copying from a click. The item is selected — press ${MOD}C to copy it.`, 'bad');
        return;
      }
      S.copiedId = id;
      cancel(copiedT);
      copiedT = later(() => { S.copiedId = null; render(); }, 1400);
      /* now the newest — the engine's change repaints the list (and focus follows the row) */
      if (!CB.bump(id)) render();
      const cut = it.len > it.text.length;
      toast(cut ? `Copied the first ${nf.format(it.text.length)} characters — that is all that was kept` : 'Copied to the clipboard');
    }

    /** a picture clip goes back on the clipboard as a PNG (the only picture type browsers let a page write) */
    async function copyPicture(it) {
      try {
        const img = new Image();
        img.src = it.image.url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        const blob = await new Promise(res => c.toBlob(res, 'image/png'));
        if (!blob) throw new Error('encode');
        await CB.writeImageUnrecorded(blob);
      } catch (e) {
        if (!S.dead) toast('Your browser blocked copying a picture from a click, or doesn’t allow pages to copy pictures.', 'bad');
        return;
      }
      if (S.dead) return;
      S.copiedId = it.id;
      cancel(copiedT);
      copiedT = later(() => { S.copiedId = null; render(); }, 1400);
      if (!CB.bump(it.id)) render();
      toast(`Copied the picture — it was kept at ${it.image.w} × ${it.image.h}, which is what you get back`);
    }

    /* ---------- quick transforms ---------- */
    async function copyTransformed(id, kind) {
      const it = find(id);
      if (!it || it.sensitive || it.image) return;
      const label = CB.TRANSFORMS.find(t => t.id === kind)?.label || kind;
      const out = CB.transform(it.text, kind);
      if (out === it.text) { toast(`Already ${label}`); return; }
      if (!out.trim()) { toast('That would leave nothing.', 'bad'); return; }
      const ok = await writeClipboard(out);
      if (S.dead) return;
      if (!ok) { toast('Your browser blocked copying from a click.', 'bad'); return; }
      /* a fallback copy is invisible to the engine's writeText wrapper: add it ourselves */
      if (!S.items.some(i => i.text === out)) CB.add(out, it.source, { via: 'app' });
      toast(`Copied as ${label} — added to your history${it.len > it.text.length ? ` (only the first ${nf.format(it.text.length)} characters were kept)` : ''}`);
    }

    /* ---------- Send to Notes / Make a task: the clip's text only, never a hidden one ---------- */
    function sendToNotes(id) {
      const it = find(id);
      if (!it || it.sensitive || it.image) return;
      const first = it.text.split('\n').find(l => l.trim()) || 'Clip';
      const title = oneLine(first, 40);
      const cur = store.get('notes');
      const list = Array.isArray(cur) ? [...cur] : [];
      const noteId = `note-${Date.now().toString(36)}-clip`;
      list.push({ id: noteId, title, body: NF.fromPlain(it.text), fmt: NF.FMT, mtime: new Date().toISOString() });
      store.set('notes', list);
      toast(`Made the note “${title}” in Notes`);
      if (api.getApp('notes')) api.notify({ app: 'Static Clipboard', icon: 'sticky-note', title: 'Saved to Notes', message: title, actions: [{ label: 'Open', onClick: () => api.openApp('notes', { noteId }) }] });
    }
    function makeTask(id) {
      const it = find(id);
      if (!it || it.sensitive || it.image) return;
      const text = it.text.replace(/\s+/g, ' ').trim().slice(0, TASKS.TEXT_MAX);
      if (!text) return;
      const data = TASKS.read();
      let list = data.lists.find(l => l.id === data.activeId) || data.lists[0];
      if (!list) { list = TASKS.normList({ name: 'Tasks' }); data.lists.push(list); data.activeId = list.id; }
      list.tasks = [...list.tasks, TASKS.normTask({ text })];
      TASKS.write(data);
      toast(`Added a task to “${list.name}”`);
      if (api.getApp('tasks')) api.notify({ app: 'Static Clipboard', icon: 'check-circle', title: 'Task added', message: oneLine(text, 60), actions: [{ label: 'Open', onClick: () => api.openApp('tasks') }] });
    }

    /* ---------- snippets ---------- */
    function openSnippetForm(id) {
      const it = id ? find(id) : null;
      if (id && (!it || it.sensitive || it.image)) return;
      S.snip = { id: it ? it.id : null, name: it ? it.name : '', text: it ? it.text : '' };
      S.view = 'snippets';
      S.focusAfter = 'snip-name';
      render();
    }
    function saveSnippetForm() {
      const f = S.snip;
      if (!f) return;
      const nm = f.name.trim();
      if (!nm) { toast('Give the snippet a name.', 'bad'); return; }
      let r;
      if (f.id) r = CB.name(f.id, nm);
      else r = CB.addSnippet(nm, f.text);
      if (!r.ok) {
        toast(r.reason === 'sensitive' ? 'That looks like a password, key or code — Static Clipboard doesn’t keep those.'
          : r.reason === 'full' ? `You can pin up to ${LIM.pinned} items. Unpin one first.`
            : r.reason === 'empty' ? 'Type the text to keep.' : 'That item is no longer here.', 'bad');
        return;
      }
      S.snip = null;
      S.focusAfter = 'search';
      render();
      toast(`Saved the snippet “${CB.list().find(i => i.name === nm)?.name || nm}”`);
    }

    /* ---------- combine ---------- */
    function setPicking(on) {
      S.picking = !!on;
      if (!on) S.picked.clear();
      render();
    }
    function togglePicked(id) {
      const it = find(id);
      if (!it || it.sensitive || it.image) return;
      if (S.picked.has(id)) S.picked.delete(id); else S.picked.add(id);
      S.focusAfter = `row:${id}:main`;
      render();
    }
    function combineClips() {
      /* in the order they are listed on screen, which is the order a person sees them in */
      const order = visible().map(i => i.id).filter(id => S.picked.has(id));
      const r = CB.combine(order, S.sep);
      if (!r.ok) { toast('Tick at least two text clips.', 'bad'); return; }
      S.picked.clear();
      S.picking = false;
      if (r.item) { S.view = 'all'; if (S.q && !matches(r.item, S.q)) { S.q = ''; searchIn.value = ''; } flash(r.item.id); S.focusAfter = `row:${r.item.id}:main`; }
      render();
      toast(`Joined ${plural(r.used, 'clip')} into one${r.cut ? ` — the first ${nf.format(LIM.chars)} characters were kept` : ''}`);
    }

    /* ---------- export: never the hidden sensitive items ---------- */
    function exportHistory(kind) {
      const rows = CB.exportItems();
      const hidden = S.items.filter(i => i.sensitive).length;
      if (!rows.length) { toast('There is nothing to export yet.'); return; }
      const json = kind === 'json';
      const body = json ? CB.exportJSON() : CB.exportText();
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(new Blob([body], { type: json ? 'application/json' : 'text/plain' }));
      const a = h('a', { href: url, download: `Static Clipboard ${stamp}.${json ? 'json' : 'txt'}` });
      document.body.appendChild(a); a.click(); a.remove();
      later(() => URL.revokeObjectURL(url), 8000);
      const pics = rows.filter(r => r.image).length;
      toast(`Exported ${plural(rows.length - (json ? 0 : pics), 'item')}${hidden ? ` — ${plural(hidden, 'hidden sensitive item')} left out` : ' — hidden sensitive items are never included'}${!json && pics ? `; ${plural(pics, 'picture')} only go in the JSON file` : ''}`);
    }

    async function addPicture(blob) {
      const it = await CB.addImage(blob, 'System clipboard');
      if (S.dead) return;
      if (!it) { toast('That picture couldn’t be kept — it may be damaged or too detailed to store small.', 'bad'); return; }
      if (S.view !== 'all' && !inView(it)) S.view = 'all';
      flash(it.id);
      S.focusAfter = `row:${it.id}:main`;
      render();
      toast(`Added the picture — kept at ${it.image.w} × ${it.image.h}`);
    }

    function addExternal(text) {
      if (typeof text !== 'string' || !text.trim()) {
        toast('Your clipboard has no text right now — it may be empty, or hold an image or file.', 'bad');
        return;
      }
      const kept = text.length > LIM.chars ? text.slice(0, LIM.chars) : text;
      const existed = S.items.some(i => i.text === kept || (kept.length === LIM.chars && i.text === kept.slice(0, -1)));
      const it = CB.add(text, 'System clipboard', { via: 'paste' });
      if (!it || S.dead) return;
      /* make sure the new item is actually on screen */
      if (!inView(it)) S.view = 'all';
      if (S.q && !matches(it, S.q)) { S.q = ''; searchIn.value = ''; }
      flash(it.id);
      S.focusAfter = `row:${it.id}:main`;
      render();
      if (it.sensitive) toast(`${it.sensitive.label} — kept hidden, not saved, and cleared in 2 minutes.`);
      else toast(existed ? 'Already in your history — moved it to the top' : 'Added from your clipboard');
    }

    async function pasteFromSystem() {
      if (S.busyPaste) return;
      const cb = typeof navigator !== 'undefined' ? navigator.clipboard : null;
      if (!cb || typeof cb.readText !== 'function') {
        toast(`This browser doesn’t let web pages read the clipboard. Press ${MOD}V in this window instead.`, 'bad');
        return;
      }
      S.busyPaste = true;
      syncBar();
      let text = null, err = null, pic = null;
      try { text = await cb.readText(); } catch (e) { err = e; }
      /* nothing in it as text: it may be a picture */
      if (!err && !(text && text.trim()) && typeof cb.read === 'function') {
        try {
          for (const ci of await cb.read()) {
            const type = ci.types.find(t => /^image\//.test(t));
            if (type) { pic = await ci.getType(type); break; }
          }
        } catch (e) { /* no picture, or not allowed: the empty-text message says what it can */ }
      }
      S.busyPaste = false;
      if (S.dead) return;
      syncBar();
      if (pic) { addPicture(pic); return; }
      if (err) {
        const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        toast(blocked
          ? `Clipboard access was blocked. Allow it for this site in your browser, or press ${MOD}V in this window.`
          : `Couldn’t read the clipboard${err && err.message ? ` (${err.message})` : ''}.`, 'bad');
        return;
      }
      addExternal(text);
    }

    function toggleReveal(id) {
      const it = find(id);
      if (!it || !it.sensitive) return;
      if (S.revealed.has(id)) S.revealed.delete(id); else S.revealed.add(id);
      render();
    }

    async function togglePin(id) {
      const it = find(id);
      if (!it) return;
      if (it.sensitive) { toast('Sensitive items can’t be pinned — they’re never saved.', 'bad'); return; }
      if (it.image) { toast('Pictures can’t be pinned — only the 8 newest are kept.', 'bad'); return; }
      if (it.pinned) {
        if (CB.wouldDropOnUnpin(id)) {
          const ok = await confirm({
            title: 'Unpin and remove?',
            message: `This item is older than your ${LIM.recent} most recent copies, so unpinning it removes it from the history.`,
            ok: 'Unpin', danger: true,
          });
          if (!ok || S.dead) return;
        }
        const r = CB.unpin(id);
        if (r.removed) { S.focusAfter = 'search'; render(); }
        toast(r.removed ? 'Unpinned and removed' : 'Unpinned');
      } else {
        const r = CB.pin(id);
        if (!r.ok) toast(r.reason === 'full' ? `You can pin up to ${LIM.pinned} items. Unpin one first.` : 'That item is no longer here.', 'bad');
        else toast('Pinned — kept on this device until you unpin it');
      }
    }

    /** the row to focus once `id` is gone: the next one, else the previous one */
    function neighbourKey(id) {
      const rows = [...bodyEl.querySelectorAll('.clip-row')];
      const i = rows.findIndex(r => r.dataset.id === id);
      const n = rows[i + 1] || rows[i - 1];
      return n ? `row:${n.dataset.id}:main` : 'search';
    }

    async function removeItem(id) {
      const it = find(id);
      if (!it) return;
      if (it.pinned) {
        const ok = await confirm({
          title: 'Delete this pinned item?',
          message: `“${oneLine(it.text, 60)}” will be removed from this device.`,
          ok: 'Delete', danger: true,
        });
        if (!ok || S.dead) return;
      }
      S.focusAfter = neighbourKey(id);
      S.revealed.delete(id);
      S.open.delete(id);
      if (!CB.remove(id)) render();
    }

    async function clearAll() {
      const n = S.items.length;
      if (!n) { toast('There is nothing to clear.'); return; }
      const pinned = S.items.filter(i => i.pinned).length;
      const ok = await confirm({
        title: 'Clear all clipboard history?',
        message: `${plural(n, 'item')} will be removed from Static Clipboard on this device${pinned ? `, including ${plural(pinned, 'pinned item')}` : ''}. Whatever is on your system clipboard right now stays there.`,
        ok: 'Clear all', danger: true,
      });
      if (!ok || S.dead) return;
      S.revealed.clear();
      S.open.clear();
      S.view = 'all';
      S.focusAfter = 'paste';
      const gone = CB.clear();    /* the engine's change repaints */
      toast(`Cleared ${plural(gone, 'item')}`);
    }

    async function clearUnpinned() {
      const unpinned = S.items.filter(i => !i.pinned).length;
      const pinned = S.items.length - unpinned;
      if (!unpinned) return;
      const ok = await confirm({
        title: 'Clear unpinned items?',
        message: `${plural(unpinned, 'item')} will be removed from this device. Your ${plural(pinned, 'pinned item')} stay${pinned === 1 ? 's' : ''}.`,
        ok: 'Clear', danger: true,
      });
      if (!ok || S.dead) return;
      S.revealed.clear();
      S.open.clear();
      const gone = CB.clear({ keepPinned: true });
      toast(`Cleared ${plural(gone, 'item')} — ${plural(pinned, 'pinned item')} kept`);
    }

    function setNote(show) {
      S.noteHidden = !show;
      saveUi({ noteHidden: S.noteHidden });
      noteEl.hidden = S.noteHidden;
      if (!show) moreBtn.focus({ preventScroll: true });
    }

    function openMore() {
      const r = moreBtn.getBoundingClientRect();
      const n = S.items.length;
      const pinned = S.items.filter(i => i.pinned).length;
      menu([
        { label: 'Paste from clipboard', icon: 'clipboard', hint: `${MOD}V`, onClick: pasteFromSystem },
        { label: S.noteHidden ? 'Show how capture works' : 'Hide the capture note', icon: 'info', onClick: () => setNote(S.noteHidden) },
        '-',
        { label: 'New snippet…', icon: 'bookmark', onClick: () => openSnippetForm(null) },
        { label: 'Export history (JSON)', icon: 'download', disabled: !n, onClick: () => exportHistory('json') },
        { label: 'Export history (text)', icon: 'download', disabled: !n, onClick: () => exportHistory('text') },
        '-',
        { label: 'Unpinned items expire', icon: 'clock', items: CB.EXPIRIES.map(x => ({ label: x.label, icon: CB.expiry() === x.id ? 'check' : null, onClick: () => { CB.setExpiry(x.id); toast(x.id === 'never' ? 'Unpinned items stay until you clear them' : `Unpinned items now go ${x.label.toLowerCase()}`); } })) },
        '-',
        { label: 'Clear unpinned…', icon: 'x-circle', disabled: !pinned || pinned === n, onClick: clearUnpinned },
        { label: 'Clear all…', icon: 'trash', danger: true, disabled: !n, onClick: clearAll },
      ], Math.round(r.right - 200), Math.round(r.bottom + 4));
    }

    function rowMenu(id, x, y) {
      const it = find(id);
      if (!it) return;
      const k = kindOf(it);
      const hidden = it.sensitive && !S.revealed.has(id);
      menu([
        { label: 'Copy', icon: 'copy', onClick: () => copyItem(id) },
        it.sensitive ? { label: hidden ? 'Reveal' : 'Hide', icon: 'eye', onClick: () => toggleReveal(id) } : null,
        k.url && api.getApp('browser') ? { label: 'Open in Browser', icon: 'external-link', onClick: () => api.openApp('browser', { url: k.url }) } : null,
        it.sensitive ? { label: 'Can’t pin sensitive items', icon: 'pin', disabled: true }
          : it.image ? { label: 'Pictures can’t be pinned', icon: 'pin', disabled: true }
            : { label: it.pinned ? 'Unpin' : 'Pin', icon: 'pin', hint: 'P', onClick: () => togglePin(id) },
        !it.sensitive && !it.image ? { label: it.name ? 'Rename snippet…' : 'Make a snippet…', icon: 'bookmark', onClick: () => openSnippetForm(id) } : null,
        !it.sensitive && !it.image ? { label: 'Copy as…', icon: 'type', items: CB.TRANSFORMS.map(t => ({ label: t.label, onClick: () => copyTransformed(id, t.id) })) } : null,
        !it.sensitive && !it.image ? { label: 'Send to Notes', icon: 'sticky-note', onClick: () => sendToNotes(id) } : null,
        !it.sensitive && !it.image ? { label: 'Make a task', icon: 'check-circle', onClick: () => makeTask(id) } : null,
        '-',
        { label: 'Delete', icon: 'trash', danger: true, hint: 'Del', onClick: () => removeItem(id) },
      ].filter(Boolean), x, y);
    }

    /* ================================================================ */
    /*  view                                                            */
    /* ================================================================ */
    function sideItem(view, ic, label, n) {
      const on = S.view === view;
      return h('button.side__item', {
        type: 'button', class: on ? 'is-on' : null, 'aria-current': on ? 'true' : null,
        dataset: { fkey: `side:${view}` },
        onclick: () => { if (S.view !== view) { S.view = view; S.open.clear(); render(); } },
      }, icon(ic), h('span', { text: label }), h('small', { text: nf.format(n) }));
    }

    function renderSide() {
      clear(sideEl);
      const all = S.items;
      const pinned = all.filter(i => i.pinned).length;
      const secret = all.filter(i => i.sensitive).length;
      const views = h('div.side__group',
        h('div.side__label', { text: 'Clipboard' }),
        sideItem('all', 'clipboard', 'All items', all.length),
        sideItem('pinned', 'pin', 'Pinned', pinned),
        sideItem('snippets', 'bookmark', 'Snippets', all.filter(i => i.pinned && i.name).length));
      const srcs = sourcesOf(all);
      const from = srcs.length
        ? h('div.side__group',
            h('div.side__label', { text: 'Copied from' }),
            srcs.map(s => sideItem(`src:${s.name}`, sourceIcon(s.name), s.name, s.n)))
        : null;
      const bits = [];
      if (pinned) bits.push(`${nf.format(pinned)} pinned`);
      if (secret) bits.push(`${nf.format(secret)} sensitive`);
      sideEl.append(
        h('div.clip-side__scroll', views, from),
        h('div.clip-side__foot',
          h('div.side__meter',
            h('b', { text: all.length ? plural(all.length, 'item') : 'Empty' }),
            h('small', { text: all.length ? (bits.join(' · ') || 'None pinned') : 'Nothing copied yet' })),
          h('label.clip-side__exp',
            h('span', { text: 'Unpinned items expire' }),
            h('select.select', {
              'aria-label': 'Unpinned items expire', dataset: { fkey: 'expiry' },
              onchange: e => { const was = S.items.length; CB.setExpiry(e.target.value); const gone = was - CB.list().length; if (gone > 0) toast(`${plural(gone, 'item')} older than that went`); },
            }, CB.EXPIRIES.map(x => h('option', { value: x.id, text: x.label, selected: CB.expiry() === x.id ? true : null })))),
          h('div.clip-side__note', { text: `Saved on this device only: pinned items and the ${LIM.recent} latest. Sensitive items never are.` })));
    }

    function metaFor(it, k) {
      const dot = () => h('i.clip-dot', { 'aria-hidden': 'true' });
      const parts = [];
      if (it.sensitive) {
        parts.push(h('span.clip-badge', icon('lock'), h('span', { text: 'Sensitive' })));
        parts.push(h('span.clip-why', { text: it.sensitive.label }), dot());
        parts.push(h('span.clip-src', { text: it.source }));
        /* a chip, not another "· part", so it wraps cleanly on a phone */
        parts.push(h('span.clip-exp', icon('clock'), h('span', { dataset: { exp: String(it.expires) }, text: leftLabel(it.expires) })));
        return parts;
      }
      if (it.pinned) parts.push(h('span.clip-pinned', icon('pin'), h('span', { text: it.name ? 'Snippet' : 'Pinned' })), dot());
      parts.push(h('span.clip-src', marked(it.source, termsOf(S.q))));
      if (it.at) parts.push(dot(), h('time.clip-ago', { dataset: { at: String(it.at) }, datetime: new Date(it.at).toISOString(), title: fullDate(it.at), text: ago(it.at) }));
      if (it.image) { parts.push(dot(), h('span.clip-count-line', { text: `${it.image.w} × ${it.image.h}` })); return parts; }
      if (it.len > it.text.length) parts.push(dot(), h('span.clip-cut', { text: `first ${nf.format(it.text.length)} of ${nf.format(it.len)} characters kept` }));
      else {
        const c = CB.countOf(it.text);
        parts.push(dot(), h('span.clip-count-line', { text: `${plural(c.words, 'word')} · ${plural(c.chars, 'character')}` }));
      }
      return parts;
    }

    function rowFor(it) {
      const k = kindOf(it);
      const secret = !!it.sensitive;
      const hidden = secret && !S.revealed.has(it.id);
      const open = S.open.has(it.id);
      const clean = it.text.replace(/^\s*\n/, '').replace(/\s+$/, '') || it.text;
      const longByChars = clean.length > PREVIEW_CHARS;
      const shown = open || !longByChars ? clean : clean.slice(0, PREVIEW_CHARS) + '…';

      const terms = termsOf(S.q);
      const textEl = hidden
        ? h('span.clip-text.clip-text--mask', { 'aria-hidden': 'true', text: MASK })
        : h('span.clip-text', { class: [k.mono ? 'is-mono' : '', open ? 'is-open' : ''].filter(Boolean).join(' ') || null }, marked(shown, terms));
      const pickable = S.picking && !secret && !it.image;
      const picked = pickable && S.picked.has(it.id);
      const kindEl = picked
        ? h('span.clip-kind.clip-kind--picked', { 'aria-hidden': 'true' }, icon('check'))
        : k.color
          ? h('span.clip-kind.clip-kind--swatch', { 'aria-hidden': 'true', style: { background: k.color } })
          : h('span.clip-kind', { 'aria-hidden': 'true', dataset: { kind: k.key } }, icon(k.icon));

      const label = hidden
        ? `Hidden sensitive item from ${it.source}: ${it.sensitive.label.charAt(0).toLowerCase()}${it.sensitive.label.slice(1)}. Press to reveal.`
        : `${secret ? 'Sensitive item: ' : ''}${oneLine(clean)}. From ${it.source}${it.at && !secret ? `, ${ago(it.at)}` : ''}${it.pinned ? ', pinned' : ''}. Press to copy.`;

      const main = h('button.clip-row__main', {
        type: 'button', 'aria-label': pickable ? `${picked ? 'Selected' : 'Not selected'}: ${label.replace(/ Press to copy\.$/, '')} Press to ${picked ? 'unselect' : 'select'}.` : label,
        'aria-pressed': pickable ? (picked ? 'true' : 'false') : null, dataset: { fkey: `row:${it.id}:main` },
        onclick: () => (pickable ? togglePicked(it.id) : hidden ? toggleReveal(it.id) : copyItem(it.id)),
      }, kindEl, h('span.clip-row__body',
        it.name ? h('span.clip-name', { text: it.name }) : null,
        it.image ? h('span.clip-text', { text: `Picture ${it.image.w} × ${it.image.h}` }) : textEl,
        it.image ? h('img.clip-thumb', { src: it.image.url, alt: `Picture copied in ${it.source}`, width: it.image.w, height: it.image.h }) : null,
        h('span.clip-meta', metaFor(it, k))));

      const act = (ic, text, key, onclick, extra = {}) => h('button.ibtn.clip-act', {
        type: 'button', 'aria-label': text, title: text, dataset: { fkey: `row:${it.id}:${key}` }, onclick, ...extra,
      }, icon(ic));
      const copied = S.copiedId === it.id;
      const acts = h('div.clip-row__act',
        k.url && api.getApp('browser') ? act('external-link', 'Open in Browser', 'open', () => api.openApp('browser', { url: k.url })) : null,
        secret ? act('eye', hidden ? 'Reveal' : 'Hide', 'eye', () => toggleReveal(it.id), { 'aria-pressed': hidden ? 'false' : 'true', class: hidden ? null : 'is-on' }) : null,
        act(copied ? 'check' : 'copy', copied ? 'Copied' : 'Copy', 'copy', () => copyItem(it.id), { class: copied ? 'is-ok' : null }),
        secret || it.image ? null : act('pin', it.pinned ? 'Unpin' : 'Pin', 'pin', () => togglePin(it.id), { 'aria-pressed': it.pinned ? 'true' : 'false', class: it.pinned ? 'is-on' : null }),
        act('trash', 'Delete', 'del', () => removeItem(it.id), { class: 'clip-act--del' }));

      const more = hidden || it.image ? null : h('button.clip-row__more', {
        type: 'button', 'aria-expanded': open ? 'true' : 'false', dataset: { fkey: `row:${it.id}:more` },
        onclick: () => { if (S.open.has(it.id)) S.open.delete(it.id); else S.open.add(it.id); render(); },
      }, icon(open ? 'chevron-up' : 'chevron-down'), h('span', { text: open ? 'Show less' : `Show all · ${plural(clean.length, 'character')}` }));

      const cls = [
        it.pinned && 'is-pinned', secret && 'is-secret', hidden && 'is-hidden', open && 'is-open', picked && 'is-picked', it.image && 'is-pic',
        (open || longByChars) && 'is-long', S.flashId === it.id && 'is-flash',
      ].filter(Boolean).join(' ');
      return h('div.clip-row', {
        role: 'listitem', class: cls || null, dataset: { id: it.id },
        oncontextmenu: e => { e.preventDefault(); rowMenu(it.id, e.clientX, e.clientY); },
      }, main, acts, more);
    }

    function emptyState(ic, title, text, btn) {
      return h('div.empty.clip-empty', icon(ic), h('b', { text: title }), h('small', { text }), btn || null);
    }

    /** the Snippets tab's form: a new snippet, or a name for an item that is already there */
    function snippetForm() {
      const f = S.snip;
      if (!f) {
        return h('div.clip-snipbar',
          h('small', { text: 'A snippet is a pinned clip with a name — text you paste again and again. Pinned snippets never expire.' }),
          h('button.btn.btn--sm', { type: 'button', dataset: { fkey: 'snip-new' }, onclick: () => openSnippetForm(null) }, icon('plus'), h('span', { text: 'New snippet' })));
      }
      const nameIn = h('input', {
        type: 'text', value: f.name, maxlength: String(LIM.name), placeholder: 'Name, like “My email”', 'aria-label': 'Snippet name', dataset: { fkey: 'snip-name' },
        oninput: e => { f.name = e.target.value; },
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); saveSnippetForm(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); S.snip = null; render(); } },
      });
      const textIn = f.id ? null : h('textarea', {
        rows: '3', placeholder: 'The text to keep', 'aria-label': 'Snippet text', spellcheck: 'false', maxlength: String(LIM.chars), dataset: { fkey: 'snip-text' },
        oninput: e => { f.text = e.target.value; },
      });
      if (textIn) textIn.value = f.text;
      return h('form.clip-snipform', { onsubmit: e => { e.preventDefault(); saveSnippetForm(); } },
        h('b', { text: f.id ? 'Name this snippet' : 'New snippet' }),
        h('div.field', nameIn),
        textIn ? h('div.field.clip-snipform__t', textIn) : h('small.dim', { text: oneLine(f.text, 120) }),
        h('div.clip-snipform__b',
          h('button.btn.btn--sm.btn--primary', { type: 'submit', dataset: { fkey: 'snip-save' } }, icon('check'), h('span', { text: 'Save snippet' })),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.snip = null; render(); } }, h('span', { text: 'Cancel' }))));
    }

    function renderBody() {
      clear(bodyEl);
      const all = S.items;
      if (S.view === 'snippets') bodyEl.append(snippetForm());
      if (!all.length && S.view !== 'snippets') {
        bodyEl.append(emptyState('clipboard', 'Nothing copied yet',
          `Select text anywhere in StaticOS and copy or cut it, and it appears here. For a Copy button, another tab, or anything outside StaticOS, press Paste or ${MOD}V.`,
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fkey: 'empty:paste' }, onclick: () => pasteFromSystem() }, icon('clipboard'), h('span', { text: 'Paste from clipboard' }))));
        return;
      }
      const vis = visible();
      if (!vis.length) {
        if (S.q.trim()) {
          bodyEl.append(emptyState('search', `No matches for “${oneLine(S.q, 40)}”`,
            'Every word has to match the text or where it came from. Hidden sensitive items aren’t searched.',
            h('button.btn.btn--sm', { type: 'button', onclick: () => { S.q = ''; searchIn.value = ''; render(); searchIn.focus(); } }, h('span', { text: 'Clear search' }))));
        } else if (S.view === 'snippets') {
          bodyEl.append(emptyState('bookmark', 'No snippets yet',
            'Name a clip from its ⋯ menu (right-click a row), or press New snippet and type one. Snippets are pinned, so they stay.'));
        } else if (S.view === 'pinned') {
          bodyEl.append(emptyState('pin', 'Nothing pinned',
            `Pin an item to keep it past the ${LIM.recent} most recent copies. Pinned items are saved on this device until you unpin them.`,
            h('button.btn.btn--sm', { type: 'button', onclick: () => { S.view = 'all'; render(); } }, h('span', { text: 'Show all items' }))));
        } else {
          bodyEl.append(emptyState('clipboard', 'Nothing here', 'No items match this filter.',
            h('button.btn.btn--sm', { type: 'button', onclick: () => { S.view = 'all'; render(); } }, h('span', { text: 'Show all items' }))));
        }
        return;
      }
      /* pinned items get their own section at the top of every view (and of
         search results): a real heading, then its own list */
      const wrap = h('div.clip-lists');
      const section = (title, rows) => {
        wrap.append(
          h('div.clip-sec', { role: 'heading', 'aria-level': '3' }, h('span', { text: title }), h('small', { text: nf.format(rows.length) })),
          h('div.clip-list', { role: 'list', 'aria-label': title }, rows.map(rowFor)));
      };
      const pinned = S.view !== 'pinned' && S.view !== 'snippets' ? vis.filter(i => i.pinned) : [];
      if (pinned.length) {
        const rest = vis.filter(i => !i.pinned);
        section('Pinned', pinned);
        if (rest.length) section('Recent', rest);
      } else {
        wrap.append(h('div.clip-list', { role: 'list', 'aria-label': `${viewTitle()} — clipboard history` }, vis.map(rowFor)));
      }
      bodyEl.append(wrap);
      scheduleMeasure();
    }

    function syncBar() {
      titleEl.textContent = viewTitle();
      const total = S.items.filter(inView).length;
      const shown = visible().length;
      countEl.textContent = S.q.trim() ? `${nf.format(shown)} of ${nf.format(total)}` : nf.format(total);
      clearBtn.disabled = !S.items.length;
      const keep = clearKeepsPins();
      const clearLabel = keep ? 'Clear unpinned' : 'Clear all';
      clearText.textContent = clearLabel;
      clearBtn.setAttribute('aria-label', keep ? 'Clear unpinned items — pinned ones stay' : 'Clear all');
      clearBtn.title = keep ? 'Clear unpinned items (pinned ones stay)' : 'Clear all';
      pasteBtn.disabled = S.busyPaste;
      pasteBtn.setAttribute('aria-busy', S.busyPaste ? 'true' : 'false');
      noteEl.hidden = S.noteHidden;
      selectBtn.setAttribute('aria-pressed', S.picking ? 'true' : 'false');
      selectBtn.classList.toggle('is-on', S.picking);
      selectBtn.disabled = !S.items.some(i => !i.sensitive && !i.image);
      pickEl.hidden = !S.picking;
      const n = S.picked.size;
      pickCount.textContent = n ? `${plural(n, 'clip')} selected` : 'Tick the clips to join';
      combineBtn.disabled = n < 2;
    }

    /** reveal "Show all" only on rows whose text is really cut off at this width */
    function scheduleMeasure() {
      cancelAnimationFrame(measureRaf);
      measureRaf = requestAnimationFrame(() => {
        measureRaf = 0;
        if (S.dead) return;
        for (const row of bodyEl.querySelectorAll('.clip-row:not(.is-hidden):not(.is-open)')) {
          const t = row.querySelector('.clip-text');
          if (!t) continue;
          const over = t.scrollHeight > t.clientHeight + 1 || t.textContent.length > PREVIEW_CHARS;
          row.classList.toggle('is-long', over);
        }
      });
    }

    function render() {
      if (S.dead) return;
      /* a source filter whose items are all gone falls back to everything */
      if (S.view.startsWith('src:') && !S.items.some(inView)) S.view = 'all';
      if (S.view !== 'all' && S.view !== 'pinned' && S.view !== 'snippets' && !S.view.startsWith('src:')) S.view = 'all';
      if (S.view !== 'snippets') S.snip = null;
      for (const id of [...S.picked]) { const p = find(id); if (!p || p.sensitive || p.image) S.picked.delete(id); }
      if (S.picking && !S.items.some(i => !i.sensitive && !i.image)) { S.picking = false; S.picked.clear(); }
      for (const id of [...S.revealed]) if (!find(id)) S.revealed.delete(id);
      for (const id of [...S.open]) if (!find(id)) S.open.delete(id);

      const ae = document.activeElement;
      const keepKey = S.focusAfter || (ae && appEl.contains(ae) && ae.dataset ? ae.dataset.fkey : null);
      S.focusAfter = null;

      renderSide();
      renderBody();
      syncBar();

      if (keepKey) {
        let target = null;
        if (keepKey === 'search') target = searchIn;
        else if (keepKey === 'paste') target = pasteBtn;
        else for (const el of appEl.querySelectorAll('[data-fkey]')) if (el.dataset.fkey === keepKey) { target = el; break; }
        if (!target && keepKey.startsWith('row:')) target = bodyEl.querySelector('.clip-row__main') || searchIn;
        if (target && target !== document.activeElement) { try { target.focus(); } catch (e) { /* detached */ } }
      }
    }

    /* ================================================================ */
    /*  input                                                           */
    /* ================================================================ */
    bodyEl.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('.clip-snipform')) return;    /* typing in the snippet form */
      const rowEl = e.target.closest ? e.target.closest('.clip-row') : null;
      const mod = e.metaKey || e.ctrlKey || e.altKey;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        const mains = [...bodyEl.querySelectorAll('.clip-row__main')];
        if (!mains.length || mod) return;
        const cur = rowEl ? mains.indexOf(rowEl.querySelector('.clip-row__main')) : -1;
        let next = cur;
        if (e.key === 'ArrowDown') next = Math.min(mains.length - 1, cur + 1);
        else if (e.key === 'ArrowUp') { if (cur <= 0) { e.preventDefault(); searchIn.focus(); return; } next = cur - 1; }
        else if (e.key === 'Home') next = 0;
        else next = mains.length - 1;
        e.preventDefault();
        mains[next].focus();
        return;
      }
      if (!rowEl || mod) return;
      const id = rowEl.dataset.id;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(id); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePin(id); }
      else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        const r = (e.target.getBoundingClientRect ? e.target : rowEl).getBoundingClientRect();
        rowMenu(id, Math.round(r.left + 24), Math.round(r.bottom - 4));
      }
    });

    appEl.addEventListener('keydown', e => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) || (!typing && e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        searchIn.focus();
        searchIn.select();
      }
    });

    /* ⌘C / Ctrl+C on a focused row copies that item. With nothing selected, Chromium and WebKit
       only fire 'copy' when a 'beforecopy' handler asks for it, so ask — but never over a real
       text selection, which copies natively (and the engine records it as usual). */
    const focusedRowId = () => {
      const ae = document.activeElement;
      const r = ae && appEl.contains(ae) && ae.closest ? ae.closest('.clip-row') : null;
      return r ? r.dataset.id : null;
    };
    const hasSelection = () => { try { const s = window.getSelection(); return !!(s && !s.isCollapsed && String(s)); } catch (e) { return false; } };
    const onBeforeCopy = e => { if (focusedRowId() && !hasSelection()) e.preventDefault(); };
    const onCopy = e => {
      const id = focusedRowId();
      const it = id ? find(id) : null;
      if (!it || hasSelection() || !e.clipboardData) return;
      e.clipboardData.setData('text/plain', it.text);
      e.preventDefault();
      /* it is already in the history: bump() keeps its real source instead of re-recording it here */
      e.stopPropagation();
      S.copiedId = id;
      cancel(copiedT);
      copiedT = later(() => { S.copiedId = null; render(); }, 1400);
      if (!CB.bump(id)) render();
      toast(it.len > it.text.length ? `Copied the first ${nf.format(it.text.length)} characters — that is all that was kept` : 'Copied to the clipboard');
    };
    appEl.addEventListener('beforecopy', onBeforeCopy);
    appEl.addEventListener('copy', onCopy);

    /* ⌘V / Ctrl+V anywhere in this window except a text field: the browser hands us the clipboard */
    const onPaste = e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      let text = '';
      try { text = e.clipboardData ? e.clipboardData.getData('text/plain') : ''; } catch (err) { text = ''; }
      if (!text.trim()) {
        /* no text: a picture the person copied somewhere else, handed over by this very paste */
        const file = [...(e.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
        if (file) { addPicture(file); return; }
      }
      addExternal(text);
    };
    appEl.addEventListener('paste', onPaste);

    /* live parts: countdowns every second, "5m ago" every 15 s */
    let tickN = 0;
    const offTick = api.bus.on('tick:1s', () => {
      if (S.dead) return;
      for (const el of bodyEl.querySelectorAll('[data-exp]')) {
        const s = leftLabel(Number(el.dataset.exp));
        if (el.textContent !== s) el.textContent = s;
      }
      if (++tickN % 15 === 0) {
        for (const el of bodyEl.querySelectorAll('[data-at]')) {
          const s = ago(Number(el.dataset.at));
          if (el.textContent !== s) el.textContent = s;
        }
      }
    });

    const offChange = CB.onChange(list => {
      if (S.dead) return;
      S.items = list;
      render();
    });

    /* responsive: react to the real painted width */
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect?.width || appEl.clientWidth;
        const n = w > 0 && w < NARROW;
        if (n !== S.narrow) { S.narrow = n; appEl.classList.toggle('is-narrow', n); }
        scheduleMeasure();
      });
      ro.observe(appEl);
    } else {
      S.narrow = (appEl.clientWidth || win.w || 780) < NARROW;
      appEl.classList.toggle('is-narrow', S.narrow);
    }

    win.onReopen(o => {
      if (S.dead || !o) return;
      if (typeof o.view === 'string') S.view = o.view;
      if (typeof o.q === 'string') { S.q = o.q; searchIn.value = o.q; }
      render();
    });

    render();

    /* ---------- teardown ---------- */
    return () => {
      S.dead = true;
      offChange();
      offTick();
      appEl.removeEventListener('paste', onPaste);
      appEl.removeEventListener('beforecopy', onBeforeCopy);
      appEl.removeEventListener('copy', onCopy);
      if (ro) { try { ro.disconnect(); } catch (e) { /* already gone */ } ro = null; }
      cancelAnimationFrame(measureRaf);
      measureRaf = 0;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      S.revealed.clear();
    };
  },
});
