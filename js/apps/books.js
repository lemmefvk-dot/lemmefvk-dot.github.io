/* ============================================================
   books.js — Books: a reader for text EPUBs, the books you already
   have (Static Manga reads picture books; this reads the ones made of
   words).

   Your books are the .epub files in Files (anywhere under Home); Add a
   book copies one in from the computer to ~/Books. The shelf shows each
   book's own cover and title, read from the file on this device, and how
   far you are. A book opens as a chapter at a time in a frame that is
   both sandboxed (no scripts can run in it) and fed only clean HTML (see
   core/epub.js): the book's own styles, scripts, frames and forms are
   left out, its pictures come from inside the file, and nothing is
   fetched from the network.

   The look is yours: text size, serif or sans, light, sepia or dark. The
   place you stopped (chapter and how far down it) and your size are
   remembered, through the store, for each book. The contents list jumps to
   a chapter or a heading. Keys: Space / PageDown scroll (the end of a
   chapter goes on to the next), Left / Right or [ ] change chapter, + / -
   change the size, T the contents, Esc the shelf.
   Everything from a file or its names is set as text, never HTML.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import vfs from '../core/vfs.js';
import media from '../core/media.js';
import { openEpub, EpubError } from '../core/epub.js';

const DIR = `${vfs.HOME}/Books`;
const SIZE = { min: 12, max: 34, step: 2, def: 18 };
const THEMES = { light: ['#ffffff', '#1c1c1e', 'Light'], sepia: ['#f4ecd8', '#433422', 'Sepia'], dark: ['#16161a', '#d8d8de', 'Dark'] };
const KEY = 'portal.books';

const CSS = `
.bk{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1);font-size:var(--fs-13);position:relative}
.bk *{box-sizing:border-box}
.bk button,.bk input,.bk select{font:inherit;color:inherit}
.bk__top{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.bk__top h1{font-size:var(--fs-15);margin:0;color:var(--ink-0)}
.bk__top input[type=search]{flex:1 1 160px;max-width:300px;height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);padding:0 var(--sp-3);min-width:0;margin-left:auto}
.bk__btn{height:28px;padding:0 var(--sp-4);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.bk__btn:disabled{opacity:.45;cursor:default}
.bk__btn[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.bk .bk__btn--go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff);font-weight:600}
/* the four accents whose white ink reads below 4.5:1 get the dark ink here, as Markets does */
:root:is([data-accent=aether],[data-accent=azure],[data-accent=violet],[data-accent=pink]):not([data-contrast=high]) .bk{--accent-ink:#14060a}
.bk .icon{display:inline-flex;width:16px;height:16px;flex:none}.bk .icon svg{width:100%;height:100%}
.bk button:focus-visible,.bk input:focus-visible,.bk select:focus-visible,.bk__frame:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.bk__msg{padding:var(--sp-2) var(--sp-4);font-size:var(--fs-12);background:var(--fill-1);border-bottom:1px solid var(--line-1)}
.bk__msg[hidden]{display:none}
.bk__msg[data-kind=error]{color:var(--danger,#ef5b5b)}
.bk__body{flex:1;min-height:0;overflow:auto;padding:var(--sp-4)}
.bk h2{font-size:var(--fs-13);margin:var(--sp-4) 0 var(--sp-3);color:var(--ink-0)}
.bk__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:var(--sp-4)}
.bk__book{display:flex;flex-direction:column;gap:6px;text-align:left;background:none;border:0;padding:0;cursor:pointer}
.bk__cover{aspect-ratio:2/3;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-2);display:grid;place-items:center;overflow:hidden;color:var(--ink-2);padding:var(--sp-3);text-align:center;font-size:var(--fs-12)}
.bk__cover img{width:100%;height:100%;object-fit:cover;display:block;margin:calc(var(--sp-3) * -1);width:calc(100% + var(--sp-3) * 2);height:calc(100% + var(--sp-3) * 2);max-width:none}
.bk__book b{font-weight:600;color:var(--ink-0);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.bk__book small{color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bk__bar{height:4px;border-radius:2px;background:var(--fill-2);overflow:hidden}
.bk__bar i{display:block;height:100%;background:var(--accent)}
.bk__empty{padding:var(--sp-6);text-align:center;color:var(--ink-2)}
.bk__empty p{margin:var(--sp-3) 0}
.bk__read{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg-1,#111);z-index:2}
.bk__read[hidden]{display:none}
.bk__tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-3);border-bottom:1px solid var(--line-1);background:var(--bg-2,var(--fill-1))}
.bk__title{font-weight:600;color:var(--ink-0);flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bk__tools select{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);padding:0 6px}
.bk__main{flex:1;display:flex;min-height:0}
.bk__side{width:230px;flex:none;border-right:1px solid var(--line-1);overflow:auto;padding:6px}
.bk__side[hidden]{display:none}
.bk__toc{display:block;width:100%;text-align:left;background:none;border:0;border-radius:var(--r-sm);padding:5px 8px;cursor:pointer;color:var(--ink-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bk__toc:hover{background:var(--fill-2)}
.bk__toc[aria-current=true]{background:var(--accent);color:var(--accent-ink,#fff)}
.bk__frame{flex:1;min-width:0;border:0;background:#fff}
.bk__foot{padding:4px var(--sp-4);font-size:var(--fs-12);color:var(--ink-2);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-4);align-items:center}
.bk__foot .bk__bar{flex:1}
@media (max-width:620px){.bk__side{position:absolute;left:0;top:44px;bottom:0;z-index:3;background:var(--bg-1,#111)}}
`;

const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const stemOf = n => n.replace(/\.[^.]+$/, '');
const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const cleanName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'book';

defineApp({
  id: 'books',
  name: 'Books',
  icon: 'note',
  g1: '#c98b4a', g2: '#6b3a1a',
  category: 'Media',
  keywords: ['books', 'book', 'epub', 'ebook', 'e-book', 'reader', 'read', 'novel', 'library', 'text book', 'kindle'],
  desc: 'Read your own EPUB books: chapters, contents, text size, light, sepia or dark, and it remembers where you stopped',
  singleton: true,
  win: { w: 900, h: 680, minW: 360, minH: 400 },
  shortcuts: [['Space / PageDown', 'Scroll down (the end goes to the next chapter)'], ['Left / Right', 'Previous / next chapter'],
    ['Plus / -', 'Bigger / smaller text'], ['T', 'Contents'], ['Esc', 'Back to the shelf']],

  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const timers = new Set();
  const urls = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const mkUrl = blob => { const u = URL.createObjectURL(blob); urls.add(u); return u; };

  /* ---------------- saved state ---------------- */
  const B = () => store.get(KEY) || {};
  const setB = patch => store.set(KEY, { ...B(), ...patch });
  const prefs = () => ({ size: SIZE.def, theme: 'light', font: 'serif', ...(B().prefs || {}) });
  const setPrefs = p => setB({ prefs: { ...prefs(), ...p } });
  const posOf = key => (B().pos || {})[key] || null;
  const savePos = (key, v) => setB({ pos: { ...(B().pos || {}), [key]: { ...(posOf(key) || {}), ...v, at: Date.now() } } });

  /* ---------------- the shell ---------------- */
  const msg = h('div.bk__msg', { hidden: true, role: 'status' });
  const say = (text, kind) => { msg.hidden = !text; msg.textContent = text || ''; msg.dataset.kind = kind || ''; };
  const fileIn = h('input', { type: 'file', accept: '.epub,application/epub+zip', multiple: true, hidden: true, 'aria-label': 'Choose EPUB books' });
  const search = h('input', { type: 'search', placeholder: 'Search your books', 'aria-label': 'Search your books', oninput: () => paint() });
  const addBtn = h('button.bk__btn.bk__btn--go', { type: 'button', 'data-act': 'add', onclick: () => fileIn.click() }, icon('plus'), 'Add a book');
  const top = h('div.bk__top', h('h1', { text: 'Books' }), addBtn, search);
  const body = h('div.bk__body');
  const reader = h('div.bk__read', { hidden: true });
  const shell = h('div.bk', h('style', { text: CSS }), top, msg, body, reader, fileIn);
  root.replaceChildren(shell);

  /* ---------------- the shelf ---------------- */
  const meta = new Map();       /* path -> { title, author, cover url, failed } read from the file, this session */
  let queue = [];
  let running = false;

  const epubs = () => {
    const out = [];
    vfs.walk(vfs.HOME, (n, path) => {
      if (path.startsWith(`${vfs.HOME}/Trash`)) return;
      if (n.type === 'file' && extOf(n.name) === 'epub') out.push({ path, name: n.name, size: n.size || 0 });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  };

  async function blobAt(path) {
    const blob = await media.blobOf(path);
    if (!blob) throw new EpubError('The bytes of this book are missing from this browser.');
    return blob;
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length && !dead) {
      const path = queue.shift();
      if (meta.has(path)) continue;
      try {
        const bk = await openEpub(await blobAt(path));
        const cover = await bk.coverBlob().catch(() => null);
        meta.set(path, { title: bk.title, author: bk.author, cover: cover ? mkUrl(cover) : '', chapters: bk.chapters.length });
      } catch (err) { meta.set(path, { failed: err.message }); }
      if (!dead && !R) paint();
    }
    running = false;
  }

  const pctOf = (path, m) => {
    const p = posOf(path);
    if (!p || p.pct == null) return 0;
    return clamp(Math.round(p.pct), 0, 100);
  };

  function paint() {
    if (dead || R) return;
    const all = epubs();
    const want = search.value.trim().toLowerCase();
    const list = want ? all.filter(b => `${b.name} ${(meta.get(b.path) || {}).title || ''} ${(meta.get(b.path) || {}).author || ''}`.toLowerCase().includes(want)) : all;
    for (const b of all) if (!meta.has(b.path) && !queue.includes(b.path)) queue.push(b.path);
    pump();
    body.replaceChildren();
    if (!all.length) {
      body.append(h('div.bk__empty', h('p', { text: 'No books yet.' }),
        h('p', { text: 'Add an .epub from your computer, or put one anywhere in Files. Picture books (comics and manga) open in Static Manga.' }),
        h('button.bk__btn.bk__btn--go', { type: 'button', onclick: () => fileIn.click() }, icon('plus'), 'Add a book')));
      return;
    }
    if (!list.length) { body.append(h('div.bk__empty', h('p', { text: 'No book matches that.' }))); return; }
    const recent = all.map(b => ({ b, p: posOf(b.path) })).filter(x => x.p && x.p.at).sort((a, c) => c.p.at - a.p.at)[0];
    if (recent && !want) {
      body.append(h('h2', { text: 'Continue reading' }),
        h('button.bk__btn.bk__btn--go', { type: 'button', 'data-continue': recent.b.path, onclick: () => openPath(recent.b.path) }, icon('play'),
          `${(meta.get(recent.b.path) || {}).title || stemOf(recent.b.name)} · ${pctOf(recent.b.path)}%`));
    }
    body.append(h('h2', { text: `Your books · ${list.length}` }));
    const grid = h('div.bk__grid');
    for (const b of list) {
      const m = meta.get(b.path) || {};
      const pct = pctOf(b.path, m);
      const cover = h('div.bk__cover', m.cover ? h('img', { src: m.cover, alt: '' }) : icon('note'));
      grid.append(h('button.bk__book', { type: 'button', 'data-path': b.path, title: m.failed || '', onclick: () => openPath(b.path) },
        cover,
        h('b', { text: m.title || stemOf(b.name) }),
        h('small', { text: m.failed ? 'Can’t be opened' : [m.author, fmtSize(b.size)].filter(Boolean).join(' · ') }),
        pct ? h('div.bk__bar', { role: 'img', 'aria-label': `${pct}% read` }, h('i', { style: { width: `${pct}%` } })) : null));
    }
    body.append(grid);
  }

  /* add books from the computer */
  fileIn.addEventListener('change', async () => {
    const files = [...fileIn.files].filter(f => extOf(f.name) === 'epub');
    fileIn.value = '';
    if (!files.length) { say('Choose a file ending in .epub.', 'error'); return; }
    let added = 0;
    for (const f of files) {
      try { await media.save(DIR, f.name, f); added++; } catch (err) { say(`Couldn’t save “${f.name}”: ${err.message}`, 'error'); return; }
    }
    say(`Added ${added} ${added === 1 ? 'book' : 'books'} to Books.`);
    paint();
  });

  /* ---------------- the reader ---------------- */
  let R = null;     /* { book, path, ch, frame, toc, ... } */
  let frameEl = null, sideEl = null, footEl = null, barEl = null, titleEl = null, tocBtn = null, themeSel = null, fontSel = null;
  let saveT = 0;

  async function openPath(path) {
    const n = vfs.node(path);
    if (!n || n.type !== 'file') { say('That book is no longer in Files.', 'error'); return; }
    say(`Opening “${stemOf(n.name)}”…`);
    try {
      const book = await openEpub(await blobAt(path));
      if (dead) return;
      say('');
      startReader(book, path, n.name);
    } catch (err) {
      if (!dead) say(err instanceof EpubError ? err.message : 'That book could not be opened.', 'error');
    }
  }

  function startReader(book, path, name) {
    closeReader(false);
    const saved = posOf(path);
    R = { book, path, ch: saved ? clamp(saved.ch | 0, 0, book.chapters.length - 1) : 0, frac: saved ? clamp(Number(saved.frac) || 0, 0, 1) : 0, token: 0, side: false };
    buildReader(name);
    reader.hidden = false;
    loadChapter(R.ch, R.frac);
  }

  function tbtn(label, ic, fn, extra = {}) {
    return h('button.bk__btn', { type: 'button', 'aria-label': label, title: label, onclick: fn, ...extra }, icon(ic));
  }

  function buildReader(name) {
    const b = R.book;
    const p = prefs();
    titleEl = h('span.bk__title', { text: b.title || stemOf(name), title: [b.title, b.author].filter(Boolean).join(' — ') });
    tocBtn = h('button.bk__btn', { type: 'button', 'data-act': 'toc', 'aria-pressed': 'false', 'aria-label': 'Contents', title: 'Contents (T)', onclick: () => toggleSide() }, icon('list'), 'Contents');
    themeSel = h('select', { 'aria-label': 'Page colour', 'data-act': 'theme', onchange: () => { setPrefs({ theme: themeSel.value }); applyLook(); } },
      Object.entries(THEMES).map(([k, v]) => h('option', { value: k, text: v[2], selected: p.theme === k })));
    fontSel = h('select', { 'aria-label': 'Typeface', 'data-act': 'font', onchange: () => { setPrefs({ font: fontSel.value }); applyLook(); } },
      [['serif', 'Serif'], ['sans', 'Sans']].map(([k, t]) => h('option', { value: k, text: t, selected: p.font === k })));
    const tools = h('div.bk__tools',
      h('button.bk__btn', { type: 'button', 'data-act': 'back', onclick: () => closeReader(true) }, icon('arrow-left'), 'Shelf'),
      titleEl, tocBtn,
      tbtn('Smaller text', 'minus', () => bump(-SIZE.step), { 'data-act': 'smaller' }),
      h('span', { 'data-size': '', text: `${p.size}`, title: 'Text size' }),
      tbtn('Bigger text', 'plus', () => bump(SIZE.step), { 'data-act': 'bigger' }),
      fontSel, themeSel,
      tbtn('Previous chapter', 'chevron-left', () => go(R.ch - 1), { 'data-act': 'prev' }),
      tbtn('Next chapter', 'chevron-right', () => go(R.ch + 1), { 'data-act': 'next' }));
    sideEl = h('div.bk__side', { hidden: true, 'aria-label': 'Contents' });
    frameEl = h('iframe.bk__frame', {
      title: `Book: ${b.title || name}`, tabindex: '0',
      /* no allow-scripts: nothing in a book can run. allow-same-origin only lets this page read its height and position. */
      sandbox: 'allow-same-origin',
    });
    frameEl.addEventListener('load', onFrameLoad);
    footEl = h('span', { 'data-pos': '' });
    barEl = h('div.bk__bar', h('i'));
    reader.replaceChildren(tools, h('div.bk__main', sideEl, frameEl), h('div.bk__foot', footEl, barEl));
    paintToc();
  }

  function paintToc() {
    const b = R.book;
    sideEl.replaceChildren();
    const rows = b.toc.length ? b.toc : b.chapters.map((c, i) => ({ title: `Section ${i + 1}`, chapter: i, hash: '', level: 0 }));
    rows.forEach((t, i) => {
      const it = h('button.bk__toc', { type: 'button', 'data-ch': String(t.chapter), 'data-i': String(i), style: { paddingLeft: `${8 + 12 * Math.min(t.level, 4)}px` }, title: t.title, text: t.title,
        onclick: () => { go(t.chapter, t.hash); if (matchMedia('(max-width:620px)').matches) toggleSide(false); } });
      sideEl.append(it);
    });
  }
  function markToc() {
    if (!sideEl) return;
    let on = null;
    for (const el of sideEl.children) {
      const here = Number(el.dataset.ch) === R.ch;
      if (here && !on) on = el;
      el.setAttribute('aria-current', 'false');
    }
    if (on) on.setAttribute('aria-current', 'true');
  }
  function toggleSide(force) {
    R.side = force === undefined ? !R.side : force;
    sideEl.hidden = !R.side;
    tocBtn.setAttribute('aria-pressed', String(R.side));
  }

  const lookCss = () => {
    const p = prefs();
    const [bg, fg] = THEMES[THEMES[p.theme] ? p.theme : 'light'];
    return { bg, fg, family: p.font === 'sans' ? 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' : 'Georgia,"Iowan Old Style","Times New Roman",serif', size: p.size };
  };
  function applyLook() {
    const L = lookCss();
    const d = frameEl && frameEl.contentDocument;
    if (d && d.documentElement) {
      const s = d.documentElement.style;
      s.setProperty('--bg', L.bg); s.setProperty('--fg', L.fg); s.setProperty('--family', L.family); s.setProperty('--size', `${L.size}px`);
    }
    if (frameEl) frameEl.style.background = L.bg;
    const lab = reader.querySelector('[data-size]');
    if (lab) lab.textContent = String(L.size);
    reader.querySelector('[data-act="smaller"]').disabled = L.size <= SIZE.min;
    reader.querySelector('[data-act="bigger"]').disabled = L.size >= SIZE.max;
  }
  function bump(d) {
    const keep = progressNow();
    setPrefs({ size: clamp(prefs().size + d, SIZE.min, SIZE.max) });
    applyLook();
    later(() => scrollToFrac(keep), 30);     /* the text re-flows; stay at the same place in the chapter */
  }

  const docOf = () => frameEl && frameEl.contentDocument;
  const scroller = () => { const d = docOf(); return d && (d.scrollingElement || d.documentElement); };
  function progressNow() {
    const s = scroller();
    if (!s) return R ? R.frac : 0;
    const room = s.scrollHeight - s.clientHeight;
    return room > 4 ? clamp(s.scrollTop / room, 0, 1) : 0;
  }
  function scrollToFrac(f) {
    const s = scroller();
    if (!s) return;
    s.scrollTop = f * Math.max(0, s.scrollHeight - s.clientHeight);
    noteScroll();
  }

  const SHELL = (L, body, tok) => `<!doctype html><html lang="en" data-tok="${tok}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
:root{--bg:${L.bg};--fg:${L.fg};--family:${L.family};--size:${L.size}px}
html{background:var(--bg);color:var(--fg)}
body{margin:0 auto;max-width:42em;padding:28px 24px 80px;font-family:var(--family);font-size:var(--size);line-height:1.65;overflow-wrap:break-word;hyphens:auto}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.4em 0 .5em}
p{margin:0 0 .9em}
img{max-width:100%;height:auto;display:block;margin:1em auto}
a{color:inherit;text-decoration:underline;text-underline-offset:2px}
blockquote{margin:1em 0 1em 1em;padding-left:1em;border-left:3px solid currentColor;opacity:.85}
pre{white-space:pre-wrap;font-size:.9em}
table{border-collapse:collapse;max-width:100%}td,th{border:1px solid;padding:.25em .5em}
hr{border:0;border-top:1px solid;opacity:.4;margin:1.5em 0}
</style></head><body>${body}</body></html>`;

  async function loadChapter(i, frac = 0, hash = '') {
    if (dead || !R) return;
    const tok = ++R.token;
    R.ch = clamp(i, 0, R.book.chapters.length - 1);
    R.frac = frac;
    R.hash = hash;
    R.ready = false;
    markToc();
    let html;
    try { html = await R.book.chapterHtml(R.ch); } catch (err) {
      if (tok !== R.token || dead) return;
      html = `<p>${(err.message || 'This chapter could not be read.').replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]))}</p>`;
    }
    if (tok !== R.token || dead) return;
    frameEl.srcdoc = SHELL(lookCss(), html, tok);
    applyLook();
    paintFoot();
  }

  function onFrameLoad() {
    if (dead || !R) return;
    const d = docOf();
    if (!d || !d.body || !frameEl.srcdoc) return;
    if (d.documentElement.dataset.tok !== String(R.token)) return;      /* a chapter that has since been replaced */
    R.ready = true;
    frameEl.dataset.loads = String((Number(frameEl.dataset.loads) || 0) + 1);
    applyLook();
    d.addEventListener('keydown', onKey);
    d.addEventListener('scroll', noteScroll, { passive: true });
    d.addEventListener('click', onFrameClick);
    if (R.hash) {
      let el = null;
      try { el = d.getElementById(R.hash); } catch (e) { /* ignore */ }
      if (el) el.scrollIntoView();
      R.hash = '';
    } else scrollToFrac(R.frac);
    noteScroll();
    frameEl.focus();
  }

  function onFrameClick(e) {
    const a = e.target.closest && e.target.closest('a');
    if (!a) return;
    if (a.dataset.ext) { e.preventDefault(); window.open(a.dataset.ext, '_blank', 'noopener,noreferrer'); return; }
    if (a.dataset.ch !== undefined) { e.preventDefault(); go(Number(a.dataset.ch), a.dataset.hash || ''); }
  }

  function noteScroll() {
    if (dead || !R || !R.ready) return;
    R.frac = progressNow();
    paintFoot();
    clearTimeout(saveT);
    saveT = later(saveNow, 400);
  }
  function overall() {
    const w = R.book.weights;
    let before = 0;
    for (let i = 0; i < R.ch; i++) before += w[i];
    return 100 * (before + w[R.ch] * R.frac);
  }
  function saveNow() {
    if (!R) return;
    savePos(R.path, { ch: R.ch, frac: R.frac, pct: overall() });
  }
  function paintFoot() {
    if (!R) return;
    const pct = Math.round(overall());
    footEl.textContent = `Chapter ${R.ch + 1} of ${R.book.chapters.length} · ${pct}%`;
    barEl.firstChild.style.width = `${pct}%`;
    reader.querySelector('[data-act="prev"]').disabled = R.ch <= 0;
    reader.querySelector('[data-act="next"]').disabled = R.ch >= R.book.chapters.length - 1;
  }

  function go(i, hash = '') {
    if (!R || i < 0 || i >= R.book.chapters.length) return;
    saveNow();
    loadChapter(i, 0, hash);
  }

  function scrollPage(dir) {
    const s = scroller();
    if (!s) return;
    const room = s.scrollHeight - s.clientHeight;
    if (dir > 0 && s.scrollTop >= room - 4) { go(R.ch + 1); return; }
    if (dir < 0 && s.scrollTop <= 4) { if (R.ch > 0) loadChapter(R.ch - 1, 1); return; }
    s.scrollTop += dir * Math.max(80, s.clientHeight * 0.9);
  }

  function onKey(e) {
    if (!R || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key;
    let used = true;
    if (k === ' ' || k === 'PageDown') scrollPage(e.shiftKey ? -1 : 1);
    else if (k === 'PageUp') scrollPage(-1);
    else if (k === 'ArrowRight' || k === ']') go(R.ch + 1);
    else if (k === 'ArrowLeft' || k === '[') go(R.ch - 1);
    else if (k === '+' || k === '=') bump(SIZE.step);
    else if (k === '-' || k === '_') bump(-SIZE.step);
    else if (k === 't' || k === 'T') toggleSide();
    else if (k === 'Escape') closeReader(true);
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  reader.addEventListener('keydown', onKey);

  function closeReader(repaint) {
    if (!R) return;
    clearTimeout(saveT);
    saveNow();
    R = null;
    frameEl = sideEl = footEl = barEl = titleEl = tocBtn = themeSel = fontSel = null;
    reader.replaceChildren();
    reader.hidden = true;
    win.setSubtitle && win.setSubtitle('');
    if (repaint) paint();
  }

  win.onReopen && win.onReopen(o => { if (o && typeof o.path === 'string') openPath(o.path); });
  const offFs = api.bus.on('fs:change', () => { if (!dead && !R) later(paint, 250); });

  paint();
  if (opts && typeof opts.path === 'string') openPath(opts.path);

  return () => {
    dead = true;
    for (const t of timers) clearTimeout(t);
    if (typeof offFs === 'function') offFs();
    closeReader(false);
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    root.replaceChildren();
  };
}
