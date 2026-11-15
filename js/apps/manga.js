/* ============================================================
   manga.js — Static Manga: a reader for the manga and comics you
   already have, and a library of complete works whose makers let
   anyone copy them.

   YOURS   CBZ (a zip of pictures), EPUB with pictures, PDF and folders
           of pictures from your files. Right-to-left or left-to-right,
           one page, a two-page spread or a vertical strip (for long-strip
           comics), fit width or height, zoom, a night filter, full screen,
           jump to a page, arrow keys and space, swipe, tap zones you can
           resize, page thumbnails, bookmarks with a thumbnail and a note,
           and the page you stopped on is remembered for each book.
           Each book has its own cover (an EPUB's declared cover, otherwise
           its first page), drawn on this device and kept for this person.
           The shelf can be searched, sorted and filtered to Favourites,
           To read and Finished, and a Your reading panel counts the page
           turns you really made (nothing is guessed).
           Pages are decoded when they come into view; only the page(s)
           on screen and their neighbours stay decoded (the rest are
           released), so a 500-page volume stays light.
   FREE    comics/catalog.json lists works released under licences that
           allow copying (see docs/free-comics.md for the source and the
           licence quote of each), each with its own cover from the same
           source. Read opens one straight away; Download
           saves the whole book as a CBZ in ~/Manga, with a progress bar,
           and it reads offline from then on. The maker's credit line is
           shown with the book.
   OFFICIAL  MANGA Plus and Shonen Jump's free chapters are links only:
           they can't be embedded or downloaded here.
   Everything from files, names and the catalog is set as text, never HTML.
   Saved through the store ('manga') and the files system; nothing else.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import vfs from '../core/vfs.js';
import media from '../core/media.js';
import { kv } from '../core/db.js';
import { makeZip } from '../core/zip.js';
import { openBook, thumbOf, isImageName, natural, BookError } from './manga-book.js';
import { bookFiles } from '../core/mangafind.js';

const BOOK_EXT = new Set(['cbz', 'epub', 'cbr']);
const MANGA_DIRS = ['Manga', 'Comics'];
const DOWNLOAD_DIR = `${vfs.HOME}/Manga`;
const KEEP_AROUND = 2;            /* pages kept decoded on each side of the ones on screen */
const ZOOM_MIN = 1, ZOOM_MAX = 4;
const OFFICIAL = [
  { name: 'MANGA Plus by Shueisha', url: 'https://mangaplus.shueisha.co.jp/', note: 'Free chapters of Shueisha’s current series, officially.' },
  { name: 'Shonen Jump (VIZ)', url: 'https://www.viz.com/shonenjump', note: 'The first and latest chapters of many series, free and official.' },
];

const CSS = `
.mg{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1);font-size:var(--fs-13);position:relative}
.mg *{box-sizing:border-box}
.mg button,.mg input,.mg select{font:inherit;color:inherit}
.mg__top{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.mg__top h1{font-size:var(--fs-15);margin:0;color:var(--ink-0)}
.mg__tabs{display:flex;gap:2px;margin-left:auto;flex-wrap:wrap}
.mg__btn{height:28px;padding:0 var(--sp-4);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.mg__btn[aria-pressed=true],.mg__btn[aria-selected=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.mg .mg__btn--go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff);font-weight:600}
/* the four accents whose white ink reads below 4.5:1 get the dark ink here, as Markets does */
:root:is([data-accent=aether],[data-accent=azure],[data-accent=violet],[data-accent=pink]):not([data-contrast=high]) .mg{--accent-ink:#14060a}
.mg .icon{display:inline-flex;width:16px;height:16px;flex:none}.mg .icon svg{width:100%;height:100%}
.mg__cover .icon{width:36px;height:36px}
.mg__cover img{display:block}
.mg__btn:disabled{opacity:.45;cursor:default}
.mg button:focus-visible,.mg input:focus-visible,.mg select:focus-visible,.mg__stage:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.mg__msg{padding:var(--sp-2) var(--sp-4);font-size:var(--fs-12);background:var(--fill-1);border-bottom:1px solid var(--line-1)}
.mg__msg[hidden]{display:none}
.mg__msg[data-kind=error]{color:var(--danger,#ef5b5b)}
.mg__body{flex:1;min-height:0;overflow:auto;padding:var(--sp-4)}
.mg h2{font-size:var(--fs-13);margin:var(--sp-4) 0 var(--sp-3);color:var(--ink-0)}
.mg__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:var(--sp-4)}
.mg__book{display:flex;flex-direction:column;gap:6px;text-align:left;background:none;border:0;padding:0;cursor:pointer}
.mg__cover{aspect-ratio:2/3;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-2) center/cover no-repeat;display:grid;place-items:center;overflow:hidden;color:var(--ink-2)}
.mg__cover img{width:100%;height:100%;object-fit:cover}
.mg__book b{font-weight:600;color:var(--ink-0);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.mg__book small{color:var(--ink-2)}
.mg__bar{height:4px;border-radius:2px;background:var(--fill-2);overflow:hidden}
.mg__bar i{display:block;height:100%;background:var(--accent)}
.mg__empty{padding:var(--sp-6);text-align:center;color:var(--ink-2)}
.mg__work{border:1px solid var(--line-2);border-radius:var(--r-md,10px);padding:var(--sp-4);margin-bottom:var(--sp-4);background:var(--fill-1)}
.mg__work h3{margin:0 0 2px;font-size:var(--fs-14,14px);color:var(--ink-0)}
.mg__credit{margin:var(--sp-3) 0;padding:var(--sp-2) var(--sp-3);border-left:3px solid var(--accent);background:var(--fill-2);font-size:var(--fs-12)}
.mg__rows{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto;margin-top:var(--sp-3)}
.mg__row{display:flex;align-items:center;gap:var(--sp-3);padding:4px 0;border-top:1px solid var(--line-1)}
.mg__row>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg__row .mg__bar{width:90px}
.mg__tag{font-size:var(--fs-11,11px);padding:1px 7px;border-radius:999px;border:1px solid var(--line-2);color:var(--ink-1)}
.mg__official a{color:var(--accent)}
/* the reader */
.mg__read{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg-1,#111);z-index:2}
.mg__read[hidden]{display:none}
.mg__tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-3);border-bottom:1px solid var(--line-1);background:var(--bg-2,var(--fill-1))}
.mg__tools .mg__title{font-weight:600;color:var(--ink-0);max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg__tools input[type=range]{flex:1;min-width:80px;direction:ltr}
.mg__tools input[type=range].is-rtl{direction:rtl}
.mg__main{flex:1;display:flex;min-height:0}
.mg__side{width:170px;flex:none;border-right:1px solid var(--line-1);display:flex;flex-direction:column;min-height:0}
.mg__side[hidden]{display:none}
.mg__sidetabs{display:flex;gap:2px;padding:6px}
.mg__thumbs{flex:1;overflow:auto;padding:6px;display:flex;flex-direction:column;gap:8px}
.mg__thumb{background:none;border:2px solid transparent;border-radius:6px;padding:2px;cursor:pointer;text-align:center;font-size:var(--fs-11,11px);color:var(--ink-2)}
.mg__thumb[aria-current=true]{border-color:var(--accent)}
.mg__thumb .ph{aspect-ratio:2/3;background:var(--fill-2);display:grid;place-items:center;border-radius:4px;overflow:hidden}
.mg__thumb img{width:100%;height:100%;object-fit:contain}
.mg__stage{flex:1;min-width:0;overflow:auto;background:#0b0b0e;touch-action:pan-y pinch-zoom;display:flex;outline:none;position:relative}
.mg__spread{margin:auto;display:flex;align-items:center;justify-content:center}
.mg__spread[data-dir=rtl]{flex-direction:row-reverse}
.mg__spread[data-fit=height]{height:calc(100% * var(--zoom,1));min-height:0}
.mg__spread[data-fit=height] .mg__pg{height:100%;width:auto;max-width:none}
.mg__spread[data-fit=width]{width:calc(100% * var(--zoom,1));min-width:0;align-items:flex-start}
.mg__spread[data-fit=width] .mg__pg{width:100%;height:auto;flex:1 1 0;min-width:0}
.mg__pg{display:block;background:#1b1b22;user-select:none;-webkit-user-drag:none}
.mg__bad{display:grid;place-items:center;text-align:center;color:#c9c9d3;padding:24px;min-height:240px;min-width:180px;background:#1b1b22;font-size:var(--fs-12)}
.mg__foot{padding:4px var(--sp-4);font-size:var(--fs-12);color:var(--ink-2);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-4)}
.mg__pdf{flex:1;border:0;background:#fff}
.mg__ctl{display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:center;margin:0 0 var(--sp-4)}
.mg__ctl input[type=search],.mg__ctl select{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);padding:0 var(--sp-3);min-width:0}
.mg__ctl input[type=search]{flex:1 1 160px;max-width:300px}
.mg__chips{display:flex;gap:4px;flex-wrap:wrap}
.mg__chip{height:26px;padding:0 var(--sp-3);border-radius:999px;border:1px solid var(--line-2);background:var(--fill-1);cursor:pointer}
.mg__chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.mg__cell{display:flex;flex-direction:column;gap:4px;min-width:0}
.mg__acts{display:flex;gap:4px}
.mg__mini{height:22px;padding:0 6px;border-radius:999px;border:1px solid var(--line-2);background:none;cursor:pointer;font-size:var(--fs-11,11px);color:var(--ink-2);display:inline-flex;align-items:center;gap:3px}
.mg__mini .icon{width:12px;height:12px}
.mg__mini[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
.mg__stats{border:1px solid var(--line-2);border-radius:var(--r-md,10px);background:var(--fill-1);padding:var(--sp-3) var(--sp-4);margin-bottom:var(--sp-4)}
.mg__stats summary{cursor:pointer;font-weight:600;color:var(--ink-0)}
.mg__facts{display:flex;flex-wrap:wrap;gap:var(--sp-5);margin-top:var(--sp-3)}
.mg__facts div{display:flex;flex-direction:column}.mg__facts b{font-size:var(--fs-15);color:var(--ink-0)}.mg__facts small{color:var(--ink-2)}
.mg__guide{margin-top:var(--sp-5);border:1px dashed var(--line-2);border-radius:var(--r-md,10px);padding:var(--sp-3) var(--sp-4)}
.mg__guide summary{cursor:pointer;font-weight:600}
.mg__guide ol{margin:var(--sp-3) 0 0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
.mg__workhead{display:flex;gap:var(--sp-4);align-items:flex-start}
.mg__workhead .mg__cover{width:84px;flex:none}
.mg__workhead>div{min-width:0;flex:1}
.mg__mini-cover{width:24px;height:34px;flex:none;border-radius:3px;background:var(--fill-2);overflow:hidden;display:block}
.mg__mini-cover img{width:100%;height:100%;object-fit:cover;display:block}
.mg__marks{display:flex;flex-direction:column;gap:6px}
.mg__mark{display:flex;flex-direction:column;gap:4px;border:1px solid var(--line-2);border-radius:6px;padding:4px}
.mg__mark>button{display:flex;gap:6px;align-items:center;background:none;border:0;cursor:pointer;text-align:left;padding:0}
.mg__mark .ph{width:44px;aspect-ratio:2/3;background:var(--fill-2);border-radius:3px;overflow:hidden;flex:none;display:grid;place-items:center;font-size:var(--fs-11,11px);color:var(--ink-2)}
.mg__mark .ph img{width:100%;height:100%;object-fit:cover}
.mg__mark input{width:100%;height:24px;border-radius:4px;border:1px solid var(--line-2);background:var(--fill-1);padding:0 6px;font-size:var(--fs-11,11px)}
.mg__pick{display:flex;gap:8px;align-items:center;background:none;border:2px solid transparent;border-radius:6px;padding:3px;cursor:pointer;text-align:left;width:100%}
.mg__pick[aria-current=true]{border-color:var(--accent)}
.mg__pick .mg__mini-cover{width:30px;height:42px}
.mg__pick span{min-width:0;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;font-size:var(--fs-12)}
.mg__jump{width:58px;height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);padding:0 6px}
.mg__read[data-night="1"] .mg__stage{filter:brightness(.78) sepia(.35) saturate(.9)}
.mg__spread[data-mode=strip]{display:block;align-self:flex-start;width:calc(min(100%,860px) * var(--zoom,1));margin:0 auto;height:auto}
.mg__slot{display:block;aspect-ratio:2/3;background:#14141a;margin:0}
.mg__slot .mg__pg{width:100%;height:auto}
.mg__slot .mg__bad{min-height:200px}
@media (max-width:620px){.mg__side{position:absolute;left:0;top:44px;bottom:0;z-index:3;background:var(--bg-1,#111)}}
@media (prefers-reduced-motion:no-preference){.mg__bar i{transition:width .15s}}
`;

const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const baseOf = p => p.split('/').pop();
const stemOf = n => n.replace(/\.[^.]+$/, '');
const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const cleanName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'book';

defineApp({
  id: 'manga',
  name: 'Static Manga',
  icon: 'bookmark',
  g1: '#ff7aa8', g2: '#7a1c63',
  category: 'Media',
  keywords: ['manga', 'comic', 'comics', 'cbz', 'epub', 'pdf', 'reader', 'webcomic', 'pepper and carrot', 'graphic novel', 'read'],
  desc: 'Read manga and comics: CBZ, EPUB and PDF, right-to-left, left-to-right or as a vertical strip, plus a library of free complete comics with covers',
  singleton: true,
  exts: ['cbz', 'epub'],        /* .cbr is left out (RAR can't be unpacked here); .pdf stays with Files' own viewer, which a claim here would replace */
  win: { w: 980, h: 700, minW: 360, minH: 420 },
  shortcuts: [['Left / Right', 'Turn the page (the way the book reads)'], ['Space / Shift+Space', 'Next / previous page'],
    ['D', 'Switch reading direction'], ['S', 'One page or spread'], ['F', 'Fit width or height'], ['Plus / -', 'Zoom in / out'],
    ['B', 'Bookmark this page'], ['T', 'Page thumbnails'], ['V', 'Vertical strip (long-strip comics)'], ['N', 'Night filter'],
    ['Enter', 'Full screen'], ['G', 'Go to a page'], ['Esc', 'Back to the library']],

  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const timers = new Set();
  const urls = new Set();
  const ac = new AbortController();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const mkUrl = blob => { const u = URL.createObjectURL(blob); urls.add(u); return u; };
  const freeUrl = u => { if (urls.delete(u)) URL.revokeObjectURL(u); };

  /* ---------------- saved state (through the store) ---------------- */
  const M = () => store.get('manga') || {};
  const setM = patch => store.set('manga', { ...M(), ...patch });
  const prefs = () => ({ dir: 'ltr', mode: 'single', fit: 'height', strip: false, night: false, zone: 30, ...(M().prefs || {}) });
  const setPrefs = p => setM({ prefs: { ...prefs(), ...p } });
  const posOf = key => (M().pos || {})[key] || null;
  const savePos = (key, v) => setM({ pos: { ...(M().pos || {}), [key]: { ...(posOf(key) || {}), ...v, at: Date.now() } } });
  const marksOf = key => (M().marks || {})[key] || [];
  const noteOf = (key, page) => ((M().notes || {})[key] || {})[page] || '';
  const pctOf = p => (p && p.total ? Math.round(100 * (p.page + 1) / p.total) : 0);
  const isDone = p => !!(p && p.total && p.page >= p.total - 1);
  const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  /* Reading stats come only from page changes the person made: how many, the time between them (a pause
     longer than three minutes counts as three), and the books whose last page they reached. */
  const IDLE_CAP = 180000;
  function countTurn(key) {
    const st = M().stats || {};
    const now = Date.now();
    const days = { ...(st.days || {}) };
    const k = dayKey(now);
    days[k] = (days[k] || 0) + 1;
    for (const d of Object.keys(days).sort().slice(0, -60)) delete days[d];
    const gap = R && R.lastTurn ? Math.min(now - R.lastTurn, IDLE_CAP) : 0;
    if (R) R.lastTurn = now;
    setM({ stats: { ...st, turns: (st.turns || 0) + 1, ms: (st.ms || 0) + gap, days } });
  }
  function countDone(key) {
    const st = M().stats || {};
    if ((st.done || []).includes(key)) return;
    setM({ stats: { ...st, done: [...(st.done || []), key] } });
  }

  /* ---------------- chrome ---------------- */
  const S = { tab: 'library', books: [], catalog: null, catErr: null, dl: new Map(), q: '', sort: 'name', shelf: 'all', fq: '' };
  const msg = h('div.mg__msg', { role: 'status', hidden: true });
  const say = (text, kind) => { msg.textContent = text; msg.dataset.kind = kind || ''; msg.hidden = !text; };
  const body = h('div.mg__body');
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, accept: '.cbz,.cbr,.epub,.pdf,image/*', 'aria-label': 'Add books from your computer', onchange: e => { addFromComputer(e.target.files); e.target.value = ''; } });
  const dirIn = h('input', { type: 'file', hidden: true, webkitdirectory: true, 'aria-label': 'Add a folder of pictures', onchange: e => { addFolderFromComputer(e.target.files); e.target.value = ''; } });
  const tabBtn = (id, label) => h('button.mg__btn', { type: 'button', role: 'tab', 'data-tab': id, onclick: () => setTab(id) }, label);
  const tabs = h('div.mg__tabs', { role: 'tablist', 'aria-label': 'Static Manga' }, tabBtn('library', 'My books'), tabBtn('free', 'Free library'), tabBtn('official', 'Official readers'));
  const top = h('div.mg__top', h('h1', { text: 'Static Manga' }),
    h('button.mg__btn', { type: 'button', 'data-act': 'add', onclick: () => fileIn.click() }, icon('upload'), 'Add books'),
    h('button.mg__btn', { type: 'button', 'data-act': 'add-folder', onclick: () => dirIn.click() }, icon('folder'), 'Add folder'),
    tabs);
  const reader = h('div.mg__read', { hidden: true, role: 'region', 'aria-label': 'Reader' });
  const shell = h('div.mg', h('style', { text: CSS }), top, msg, body, reader, fileIn, dirIn);
  root.append(shell);

  function setTab(id) {
    S.tab = id;
    for (const b of tabs.children) { b.setAttribute('aria-selected', String(b.dataset.tab === id)); }
    paint();
    if (id === 'free' && !S.catalog && !S.catErr) loadCatalog();
  }

  function paint() {
    if (dead) return;
    body.replaceChildren();
    if (S.tab === 'library') paintLibrary();
    else if (S.tab === 'free') paintFree();
    else paintOfficial();
  }

  /* ---------------- my books ---------------- */
  const scanBooks = () => bookFiles(M().shelf || []);

  /* covers: drawn on this device from the book itself (an EPUB's declared cover, else the first page),
     kept per person in the database, and made only for tiles that scroll into view */
  const coverCache = new Map();
  const coverQueue = [];
  let coverBusy = false;
  const coverIo = typeof IntersectionObserver === 'function' ? new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) { coverIo.unobserve(e.target); const f = e.target._cover; e.target._cover = null; if (f) f(); }
  }, { rootMargin: '300px' }) : null;
  const lazyCover = (el, fn) => { if (!coverIo) { fn(); return; } el._cover = fn; coverIo.observe(el); };
  async function coverFor(book) {
    const id = `manga.cover.${book.key}.${book.size}`;
    if (coverCache.has(id)) return coverCache.get(id);
    try { const hit = await kv('misc').get(id); if (hit instanceof Blob) { coverCache.set(id, hit); return hit; } } catch (e) { /* no cache */ }
    return new Promise(res => { coverQueue.push({ id, book, res }); pump(); });
  }
  async function pump() {
    if (coverBusy || dead) return;
    const job = coverQueue.shift();
    if (!job) return;
    coverBusy = true;
    let out = null;
    try {
      const src = await sourceOf(job.book);
      if (src && !(src.blob && extOf(src.name) === 'pdf')) {
        const bk = await openBook(src);
        if (bk.count) { out = await thumbOf(await (bk.cover ? bk.cover() : bk.page(0))); await kv('misc').set(job.id, out).catch(() => {}); coverCache.set(job.id, out); }
      }
    } catch (e) { out = null; }
    coverBusy = false;
    job.res(out);
    pump();
  }

  async function sourceOf(book) {
    const n = vfs.node(book.path);
    if (!n) throw new BookError('That file is no longer in your files.');
    if (n.type === 'dir') {
      return { title: n.name, files: n.children.filter(c => c.type === 'file' && isImageName(c.name)).map(c => ({ name: c.name, read: () => media.blobOf(`${book.path}/${c.name}`) })) };
    }
    const blob = await media.blobOf(book.path);
    if (!blob) throw new BookError(`The bytes for “${n.name}” are missing from this browser.`);
    return { blob, name: n.name };
  }

  const coverImg = src => h('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
  const listHas = (name, key) => (M()[name] || []).includes(key);
  function toggleList(name, key) { const cur = M()[name] || []; setM({ [name]: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key] }); }

  /* a book of yours (free = null) or one read from the free library and not saved (free = { w, bk }) */
  function bookTile(book, free) {
    const pos = posOf(book.key);
    const pct = pctOf(pos);
    const cover = h('div.mg__cover', icon(book.kind === 'pdf' ? 'file-text' : 'image'));
    if (free) { if (free.bk.cover) cover.replaceChildren(coverImg(free.bk.cover.file)); }
    else lazyCover(cover, () => coverFor(book).then(b => { if (b && !dead) { const u = mkUrl(b); cover.replaceChildren(h('img', { src: u, alt: '' })); } }));
    const btn = h('button.mg__book', { type: 'button', 'data-key': book.key, 'aria-label': `${book.name}${pct ? `, ${pct} percent read` : ''}`, onclick: () => (free ? readFree(free.w, free.bk) : openLocal(book)) },
      cover, h('b', { text: stemOf(book.name) }),
      pos && pos.total ? h('div.mg__bar', h('i', { style: { width: `${pct}%` } })) : null,
      h('small', { 'data-info': '', text: `${book.kind === 'folder' ? 'Folder' : book.kind === 'free' ? 'Free library' : book.kind.toUpperCase()}${book.size ? ` · ${fmtSize(book.size)}` : ''}${pct ? ` · ${pct}% read` : ''}` }));
    if (free) return h('div.mg__cell', btn);
    const mini = (name, label, ic) => {
      const b = h('button.mg__mini', { type: 'button', 'data-list': name, 'aria-pressed': String(listHas(name, book.key)), 'aria-label': `${label}: ${stemOf(book.name)}`, title: label,
        onclick: () => { toggleList(name, book.key); b.setAttribute('aria-pressed', String(listHas(name, book.key))); if (S.shelf === (name === 'fav' ? 'fav' : 'toread')) fillShelf(); } }, icon(ic), label);
      return b;
    };
    return h('div.mg__cell', { 'data-cell': book.key }, btn, h('div.mg__acts', mini('fav', 'Favourite', 'star'), mini('toread', 'To read', 'list')));
  }

  const freeLookup = id => {
    for (const w of (S.catalog && S.catalog.works) || []) for (const bk of w.books) if (bk.id === id) return { w, bk };
    return null;
  };
  const SORTS = { name: 'Name', recent: 'Recently read', percent: 'Most read', size: 'Biggest' };
  const SHELVES = [['all', 'All'], ['fav', 'Favourites'], ['toread', 'To read'], ['done', 'Finished']];
  const fmtDur = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

  function statsView() {
    const st = M().stats || {};
    const d = h('details.mg__stats', { 'data-sec': 'stats' }, h('summary', { text: 'Your reading' }));
    if (!st.turns) { d.append(h('p', { text: 'Nothing yet. These numbers come from the pages you turn in Static Manga, and nothing is guessed.' })); return d; }
    const days = st.days || {};
    let week = 0;
    for (let i = 0; i < 7; i++) week += days[dayKey(Date.now() - i * 86400000)] || 0;
    const fact = (v, k) => h('div', h('b', { text: v }), h('small', { text: k }));
    d.append(h('div.mg__facts', fact(String(days[dayKey()] || 0), 'page turns today'), fact(String(week), 'in the last 7 days'), fact(String(st.turns), 'page turns in all'),
      fact(fmtDur(st.ms || 0), 'reading time'), fact(String((st.done || []).length), (st.done || []).length === 1 ? 'book finished' : 'books finished')),
      h('p', { text: 'Reading time is the time between page turns; a break of more than three minutes counts as three.' }));
    return d;
  }

  let shelfHost = null, contHost = null;
  function fillShelf() {
    if (!shelfHost) return;
    let list = S.books.slice();
    const q = S.q.trim().toLowerCase();
    if (q) list = list.filter(b => b.name.toLowerCase().includes(q));
    if (S.shelf === 'fav') list = list.filter(b => listHas('fav', b.key));
    else if (S.shelf === 'toread') list = list.filter(b => listHas('toread', b.key));
    else if (S.shelf === 'done') list = list.filter(b => isDone(posOf(b.key)));
    const at = b => (posOf(b.key) || {}).at || 0;
    if (S.sort === 'recent') list.sort((a, b) => at(b) - at(a));
    else if (S.sort === 'percent') list.sort((a, b) => pctOf(posOf(b.key)) - pctOf(posOf(a.key)));
    else if (S.sort === 'size') list.sort((a, b) => b.size - a.size);
    const label = SHELVES.find(x => x[0] === S.shelf)[1];
    const none = S.shelf === 'fav' ? 'No favourites yet. Press Favourite under a book.' : S.shelf === 'toread' ? 'Nothing is marked To read yet.' : S.shelf === 'done' ? 'No finished books yet. A book is finished when you reach its last page.' : 'No book matches that.';
    shelfHost.replaceChildren(h('h2', { text: `${S.shelf === 'all' && !q ? 'All books' : label} (${list.length})` }),
      list.length ? h('div.mg__grid', { 'data-grid': 'books' }, list.map(b => bookTile(b))) : h('p.mg__empty', { text: none }));
  }

  function paintLibrary() {
    S.books = scanBooks();
    if (!S.books.length) {
      body.append(h('div.mg__empty', h('p', { text: 'No books yet.' }),
        h('p', { text: 'Add a CBZ, EPUB, PDF or a folder of pictures from your computer, double-click one in Files, or take a free comic from the Free library.' }),
        h('button.mg__btn.mg__btn--go', { type: 'button', onclick: () => setTab('free') }, 'Open the Free library')), cbrGuide());
      return;
    }
    /* Continue reading: books of yours and free-library books being read, newest first */
    const pos = M().pos || {};
    const local = new Map(S.books.map(b => [b.key, b]));
    const items = [];
    for (const [key, p] of Object.entries(pos)) {
      if (!p || !p.total || isDone(p)) continue;
      if (local.has(key)) items.push({ at: p.at, tile: () => bookTile(local.get(key)) });
      else if (key.startsWith('free:')) {
        const f = freeLookup(key.slice(5));
        items.push({ at: p.at, tile: () => bookTile({ key, name: p.title || 'Free comic', kind: 'free', size: 0 }, f || { w: null, bk: {} }) });
      }
    }
    if (items.some(i => i.tile) && !S.catalog && !S.catErr && Object.keys(pos).some(k => k.startsWith('free:'))) loadCatalog();
    items.sort((a, b) => b.at - a.at);
    contHost = items.length ? h('section', { 'aria-label': 'Continue reading', 'data-sec': 'continue' }, h('h2', { text: 'Continue reading' }), h('div.mg__grid', items.slice(0, 6).map(i => i.tile()))) : null;

    const search = h('input', { type: 'search', 'data-search': '', placeholder: 'Search your books', 'aria-label': 'Search your books', value: S.q, oninput: e => { S.q = e.target.value; fillShelf(); } });
    const sort = h('select', { 'data-sort': '', 'aria-label': 'Sort books', onchange: e => { S.sort = e.target.value; fillShelf(); } }, Object.entries(SORTS).map(([k, v]) => h('option', { value: k, text: v, selected: S.sort === k })));
    const chips = h('div.mg__chips', { role: 'group', 'aria-label': 'Shelf' }, SHELVES.map(([k, v]) => h('button.mg__chip', { type: 'button', 'data-shelf': k, 'aria-pressed': String(S.shelf === k),
      onclick: () => { S.shelf = k; for (const c of chips.children) c.setAttribute('aria-pressed', String(c.dataset.shelf === k)); fillShelf(); } }, v)));
    shelfHost = h('section', { 'aria-label': 'All books', 'data-sec': 'all' });
    body.append(statsView(), ...(contHost ? [contHost] : []), h('div.mg__ctl', chips, search, sort), shelfHost, cbrGuide());
    fillShelf();
  }

  /* CBR is RAR, which the browser can't unpack; this is how to get the same book in a form that opens */
  function cbrGuide() {
    return h('details.mg__guide', { 'data-guide': 'cbr' }, h('summary', { text: 'Got a CBR file?' }),
      h('p', { text: 'CBR is a RAR archive, and Static Manga can’t open those. The pictures inside are ordinary, so it takes a minute to change the wrapper:' }),
      h('ol', h('li', { text: 'Open the .cbr with a free tool that reads RAR: The Unarchiver or Keka on a Mac, 7-Zip on Windows, or unrar on Linux, and extract the pictures into a folder.' }),
        h('li', { text: 'Either use Add folder above and pick that folder, or zip the pictures (not the folder around them) and rename the .zip to .cbz, then use Add books.' }),
        h('li', { text: 'Keep the pictures’ names in order (001, 002, …). Static Manga sorts them the way you count.' })),
      h('p', { text: 'A PDF works too. Only a CBR is turned away, because it can’t be unpacked here and nothing is uploaded anywhere to do it.' }));
  }

  /* ---------------- adding from the real computer ---------------- */
  async function addFromComputer(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    const imgs = files.filter(f => isImageName(f.name));
    let added = 0;
    for (const f of files) {
      const e = extOf(f.name);
      if (!(BOOK_EXT.has(e) || e === 'pdf')) continue;
      try { await media.save(DOWNLOAD_DIR, f.name, f); added++; } catch (err) { say(`Couldn’t save “${f.name}”: ${err.message}`, 'error'); }
    }
    if (imgs.length) {
      const dir = `${DOWNLOAD_DIR}/${cleanName(imgs.length === 1 ? stemOf(imgs[0].name) : 'Pictures')}`;
      for (const f of imgs) { try { await media.save(dir, f.name, f); } catch (err) { say(String(err.message), 'error'); } }
      added++;
    }
    say(added ? `Added ${added} to your books.` : 'Nothing there is a CBZ, EPUB, PDF or picture.', added ? '' : 'error');
    if (S.tab === 'library') paint();
  }
  async function addFolderFromComputer(list) {
    const files = Array.from(list || []).filter(f => isImageName(f.name));
    if (!files.length) { say('That folder has no pictures in it.', 'error'); return; }
    const folder = cleanName((files[0].webkitRelativePath || '').split('/')[0] || 'Folder');
    const dir = `${DOWNLOAD_DIR}/${folder}`;
    for (const f of files) { try { await media.save(dir, f.name, f); } catch (err) { say(String(err.message), 'error'); return; } }
    say(`Added “${folder}” (${files.length} pages).`);
    if (S.tab === 'library') paint();
  }

  /* ---------------- the free library ---------------- */
  async function loadCatalog() {
    try {
      const r = await fetch('comics/catalog.json', { signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      S.catalog = await r.json();
    } catch (e) { if (dead) return; S.catErr = 'The list of free comics could not be loaded. Check your connection and open this tab again.'; }
    if (!dead && (S.tab === 'free' || (S.tab === 'library' && !R))) paint();
  }
  const dlPath = id => { const p = (M().dl || {})[id]; return p && vfs.node(p) ? p : null; };

  let freeHost = null;
  function paintFree() {
    body.append(h('p', { text: 'Complete works whose makers released them under licences that allow copying, or that are in the public domain. Nothing here is a commercial series, and the credit line travels with every book.' }));
    if (S.catErr) { body.append(h('div.mg__empty', { text: S.catErr })); return; }
    if (!S.catalog) { body.append(h('div.mg__empty', { text: 'Loading the list…' })); return; }
    body.append(h('div.mg__ctl', h('input', { type: 'search', 'data-fsearch': '', placeholder: 'Search the free library', 'aria-label': 'Search the free library', value: S.fq, oninput: e => { S.fq = e.target.value; fillFree(); } })));
    freeHost = h('div');
    body.append(freeHost);
    fillFree();
  }
  function fillFree() {
    if (!freeHost) return;
    const q = S.fq.trim().toLowerCase();
    const hay = w => [w.title, w.author, w.licence, w.summary, ...(w.tags || [])].join(' ').toLowerCase();
    const works = (S.catalog.works || []).filter(w => !q || hay(w).includes(q));
    freeHost.replaceChildren(...(works.length ? works.map(workCard) : [h('p.mg__empty', { text: 'No free comic matches that.' })]));
  }

  function workCard(w) {
    const rows = h('div.mg__rows', { role: 'list' });
    for (const bk of w.books) rows.append(bookRow(w, bk));
    const first = w.books.find(b => b.cover);
    const cover = h('div.mg__cover', { 'data-wcover': w.id }, first ? coverImg(first.cover.file) : icon('image'));
    return h('article.mg__work', { 'data-work': w.id },
      h('div.mg__workhead', cover, h('div',
        h('h3', { text: w.title }),
        h('small', { text: `${w.author}${w.year ? `, ${w.year}` : ''} · ${w.licence} · ${w.books.length} ${w.books.length === 1 ? 'book' : 'books'}` }),
        h('p', { text: w.summary || '' }))),
      h('p.mg__credit', { 'data-credit': w.id }, w.attribution, ' ',
        h('a', { href: w.licenceUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Licence' }), ' · ',
        h('a', { href: w.source, target: '_blank', rel: 'noopener noreferrer', text: 'Source' })),
      rows);
  }

  function bookRow(w, bk) {
    const bar = h('div.mg__bar', { hidden: true, role: 'progressbar', 'aria-label': `Downloading ${bk.title}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('i'));
    const state = h('span.mg__tag', { 'data-state': bk.id });
    const dlBtn = h('button.mg__btn', { type: 'button', 'data-dl': bk.id, 'aria-label': `Download ${bk.title}` }, icon('download'), 'Download');
    const readBtn = h('button.mg__btn.mg__btn--go', { type: 'button', 'data-read': bk.id, 'aria-label': `Read ${bk.title}`, onclick: () => readFree(w, bk) }, 'Read');
    const sync = () => {
      const have = !!dlPath(bk.id);
      state.textContent = have ? 'Downloaded' : fmtSize(bk.bytes);
      state.dataset.have = String(have);
      dlBtn.hidden = have;
    };
    dlBtn.onclick = async () => {
      dlBtn.disabled = true; bar.hidden = false;
      try {
        await downloadFree(w, bk, pct => { bar.firstChild.style.width = `${pct}%`; bar.setAttribute('aria-valuenow', String(Math.round(pct))); state.textContent = `${Math.round(pct)}%`; });
        say(`Saved “${bk.title}” to Manga in your files.`);
      } catch (err) { if (!dead) say(`Couldn’t download “${bk.title}”: ${err.message}`, 'error'); }
      if (dead) return;
      bar.hidden = true; dlBtn.disabled = false; sync();
    };
    sync();
    const pos = posOf(`free:${bk.id}`) || posOf(dlPath(bk.id));
    const pct = pctOf(pos);
    return h('div.mg__row', { role: 'listitem' }, bk.cover ? h('span.mg__mini-cover', { 'data-rowcover': bk.id }, coverImg(bk.cover.file)) : null,
      h('span', { text: bk.title, title: bk.title }), pct ? h('small', { text: isDone(pos) ? 'Finished' : `${pct}%` }) : null, bar, state, dlBtn, readBtn);
  }

  /** Fetch a catalog book, reporting percent. Checks the size the catalog promises. */
  async function fetchBook(bk, onPct) {
    const r = await fetch(bk.file, { signal: ac.signal });
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    const total = Number(r.headers.get('content-length')) || bk.bytes || 0;
    const chunks = [];
    let got = 0;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        chunks.push(value); got += value.length;
        if (onPct && total) onPct(clamp(100 * got / total, 0, 99));
      }
    } else { const b = await r.arrayBuffer(); chunks.push(new Uint8Array(b)); got = b.byteLength; }
    if (bk.bytes && got !== bk.bytes) throw new Error(`it arrived as ${got} bytes but should be ${bk.bytes}; try again`);
    if (onPct) onPct(100);
    return new Blob(chunks, { type: 'application/vnd.comicbook+zip' });
  }

  async function downloadFree(w, bk, onPct) {
    const blob = await fetchBook(bk, onPct);
    const dir = `${DOWNLOAD_DIR}/${cleanName(w.title.replace(/&/g, ' and '))}`;
    const { path } = await media.save(dir, `${cleanName(bk.title)}.cbz`, blob);
    setM({ dl: { ...(M().dl || {}), [bk.id]: path } });
    return path;
  }

  async function readFree(w, bk) {
    if (!w || !bk.id) { say('Open the Free library tab, and the list will load; then press Read again.', 'error'); setTab('free'); return; }
    const have = dlPath(bk.id);
    if (have) { openLocal({ key: have, path: have, name: baseOf(have), kind: 'cbz', size: 0 }, { rtl: !!w.rtl, credit: w.attribution }); return; }
    say(`Opening “${bk.title}”…`);
    try {
      const blob = await fetchBook(bk);
      say('');
      await openIn({ blob, name: `${bk.title}.cbz`, title: bk.title }, `free:${bk.id}`, { rtl: !!w.rtl, credit: w.attribution });
    } catch (err) { if (!dead) say(`Couldn’t open “${bk.title}”: ${err.message}`, 'error'); }
  }

  /* ---------------- official readers ---------------- */
  function paintOfficial() {
    body.append(h('p', { text: 'These are the publishers’ own free readers. They open in a new tab because they can’t be embedded here or downloaded, and Static Manga doesn’t try to get around that.' }));
    for (const o of OFFICIAL) {
      body.append(h('article.mg__work.mg__official', { 'data-official': o.name },
        h('h3', { text: o.name }), h('p', { text: o.note }),
        h('a.mg__btn.mg__btn--go', { href: o.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), 'Open in a new tab')));
    }
  }

  /* ============================================================
     the reader
     ============================================================ */
  let R = null;   /* the open book */

  async function openLocal(book, extra) {
    say(`Opening “${stemOf(book.name)}”…`);
    try { await openIn(await sourceOf(book), book.key, { ...(extra || {}), title: stemOf(book.name) }); say(''); }
    catch (err) {
      if (dead) return;
      /* a text EPUB is not a picture book: hand it to Books, which reads it */
      if (err && err.textBook && book.path) { say(''); api.openApp('books', { path: book.path }); return; }
      say(err.message || 'That book could not be opened.', 'error');
    }
  }

  async function openIn(src, key, extra = {}) {
    closeReader(false);
    const book = await openBook({ ...src, title: extra.title || src.title });
    if (dead) return;
    const saved = posOf(key);
    const p = prefs();
    R = {
      book, key, extra, cur: saved ? clamp(saved.page, 0, Math.max(0, book.count - 1)) : 0,
      dir: (saved && saved.dir) || (extra.rtl ? 'rtl' : p.dir), mode: p.mode, fit: p.fit, zoom: 1, strip: !!p.strip, night: !!p.night, zone: p.zone, lastTurn: Date.now(), vis: new Set(),
      cache: new Map(),         /* index -> { url, w, h, bad, p } */
      shown: [], thumbs: new Map(), panel: 'pages',
    };
    buildReader();
    reader.hidden = false;
    reader.dataset.night = R.night ? '1' : '0';
    await show(R.cur);
    R.opened = true;
    stageEl.focus();
  }

  let stageEl = null, spreadEl = null, rangeEl = null, sideEl = null, thumbsEl = null, footEl = null, bmBtn = null, zoomLbl = null, dirBtn = null, modeBtn = null, fitBtn = null, stripBtn = null, nightBtn = null, jumpEl = null, zoneSel = null;

  function tb(label, ic, fn, extra = {}) {
    return h('button.mg__btn', { type: 'button', 'aria-label': label, title: label, onclick: fn, ...extra }, icon(ic));
  }

  function buildReader() {
    const b = R.book;
    const isPdf = b.kind === 'pdf';
    const back = h('button.mg__btn', { type: 'button', 'data-act': 'back', onclick: () => closeReader(true) }, icon('arrow-left'), 'Library');
    const title = h('span.mg__title', { text: b.title, title: b.title });
    if (isPdf) {
      reader.replaceChildren(h('div.mg__tools', back, title),
        h('iframe.mg__pdf', { src: `${mkUrl(b.pdfBlob)}#navpanes=0`, title: `PDF: ${b.title}` }));
      return;
    }
    dirBtn = h('button.mg__btn', { type: 'button', 'data-act': 'dir', onclick: () => setDir(R.dir === 'rtl' ? 'ltr' : 'rtl') });
    modeBtn = h('button.mg__btn', { type: 'button', 'data-act': 'mode', onclick: () => setMode(R.mode === 'spread' ? 'single' : 'spread') });
    fitBtn = h('button.mg__btn', { type: 'button', 'data-act': 'fit', onclick: () => setFit(R.fit === 'width' ? 'height' : 'width') });
    zoomLbl = h('span', { 'aria-live': 'polite', text: '100%' });
    bmBtn = h('button.mg__btn', { type: 'button', 'data-act': 'bookmark', 'aria-pressed': 'false', 'aria-label': 'Bookmark this page', onclick: toggleMark }, icon('bookmark'));
    rangeEl = h('input', { type: 'range', min: '1', max: String(b.count), value: '1', 'aria-label': 'Page', oninput: e => goto(Number(e.target.value) - 1) });
    stripBtn = h('button.mg__btn', { type: 'button', 'data-act': 'strip', 'aria-pressed': String(R.strip), title: 'Vertical strip: every page in one scroll, for long-strip comics', onclick: () => setStrip(!R.strip) }, 'Strip');
    nightBtn = h('button.mg__btn', { type: 'button', 'data-act': 'night', 'aria-pressed': String(R.night), 'aria-label': 'Night filter', title: 'Night filter: dimmer and warmer', onclick: () => setNight(!R.night) }, icon('moon'));
    const fsBtn = document.fullscreenEnabled ? tb('Full screen', 'maximize', toggleFull, { 'data-act': 'fullscreen' }) : null;
    jumpEl = h('input.mg__jump', { type: 'number', min: '1', max: String(b.count), 'data-act': 'jump', 'aria-label': `Go to page (1 to ${b.count})`, placeholder: 'Go to', title: 'Type a page number and press Enter',
      onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') { const n = parseInt(jumpEl.value, 10); if (n >= 1) { goto(clamp(n, 1, b.count) - 1); jumpEl.value = ''; stageEl.focus(); } } else if (e.key === 'Escape') { jumpEl.value = ''; stageEl.focus(); } } });
    zoneSel = h('select', { 'data-act': 'zones', 'aria-label': 'Tap zones', title: 'How much of each side of the page turns it when you click or tap', onchange: e => setZone(Number(e.target.value)) },
      [[30, 'Tap edges: normal'], [40, 'Tap edges: wide'], [20, 'Tap edges: narrow'], [0, 'Tap edges: off']].map(([v, t]) => h('option', { value: String(v), text: t, selected: R.zone === v })));
    const tools = h('div.mg__tools', back, title,
      tb('Previous page (the way the book reads)', 'arrow-left', () => turn(-1), { 'data-act': 'prev' }),
      rangeEl,
      tb('Next page', 'arrow-right', () => turn(1), { 'data-act': 'next' }),
      dirBtn, modeBtn, fitBtn, stripBtn,
      tb('Zoom out', 'minus', () => setZoom(R.zoom - 0.25), { 'data-act': 'zoom-out' }), zoomLbl,
      tb('Zoom in', 'plus', () => setZoom(R.zoom + 0.25), { 'data-act': 'zoom-in' }),
      bmBtn, nightBtn, fsBtn, jumpEl, zoneSel,
      tb('Page thumbnails, bookmarks and your other books', 'grid', () => { sideEl.hidden = !sideEl.hidden; if (!sideEl.hidden) paintSide(); }, { 'data-act': 'side' }));
    spreadEl = h('div.mg__spread');
    stageEl = h('div.mg__stage', { tabindex: '0', role: 'group', 'aria-label': 'Page', 'aria-roledescription': 'book page' }, spreadEl);
    thumbsEl = h('div.mg__thumbs');
    const pagesTab = h('button.mg__btn', { type: 'button', 'data-side': 'pages', 'aria-selected': 'true', onclick: () => { R.panel = 'pages'; paintSide(); } }, 'Pages');
    const marksTab = h('button.mg__btn', { type: 'button', 'data-side': 'marks', 'aria-selected': 'false', onclick: () => { R.panel = 'marks'; paintSide(); } }, 'Bookmarks');
    const booksTab = h('button.mg__btn', { type: 'button', 'data-side': 'books', 'aria-selected': 'false', onclick: () => { R.panel = 'books'; paintSide(); } }, 'Books');
    sideEl = h('div.mg__side', { hidden: true, 'aria-label': 'Pages' }, h('div.mg__sidetabs', pagesTab, marksTab, booksTab), thumbsEl);
    footEl = h('div.mg__foot', { 'data-foot': '' });
    reader.replaceChildren(tools, h('div.mg__main', sideEl, stageEl), footEl);
    stageEl.addEventListener('keydown', onKey);
    sideEl.addEventListener('keydown', onKey);
    stageEl.addEventListener('click', onStageClick);
    stageEl.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(R.zoom + (e.deltaY < 0 ? 0.25 : -0.25)); } }, { passive: false });
    swipe(stageEl);
    stageEl.addEventListener('scroll', () => { if (R && R.strip && !R.scrollT) R.scrollT = later(() => { if (R) { R.scrollT = 0; stripSync(); } }, 100); }, { passive: true });
    paintControls();
  }

  /* --- decoding: a page is decoded when wanted; only a window is kept --- */
  function load(i) {
    const hit = R.cache.get(i);
    if (hit) return hit.p;
    const entry = { url: null, w: 0, h: 0, bad: null, img: null, p: null };
    R.cache.set(i, entry);
    const book = R.book;
    entry.p = (async () => {
      try {
        const blob = await book.page(i);
        const url = mkUrl(blob);
        entry.url = url;
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();                 /* rejects for a file that is not a picture */
        entry.w = img.naturalWidth; entry.h = img.naturalHeight; entry.img = img;
      } catch (err) {
        entry.bad = err instanceof BookError ? err.message : 'This page couldn’t be read; the picture is damaged or in a format this browser can’t show.';
        if (entry.url) { freeUrl(entry.url); entry.url = null; }
      }
      return entry;
    })();
    return entry.p;
  }
  function release() {
    const keep = new Set();
    for (const i of (R.strip ? [...R.vis] : R.shown)) for (let d = -KEEP_AROUND; d <= KEEP_AROUND; d++) keep.add(i + d);
    for (const [i, e] of [...R.cache]) {
      if (keep.has(i)) continue;
      if (e.url) freeUrl(e.url);
      R.cache.delete(i);
    }
    root.dataset.decoded = String([...R.cache.values()].filter(e => e.url && e.img).length);
  }

  /* which pages are on screen when the first is i */
  async function group(i) {
    if (R.mode !== 'spread' || i <= 0 || i + 1 >= R.book.count) return [i];
    const [a, b] = await Promise.all([load(i), load(i + 1)]);
    const wide = e => e.w > e.h * 1.05;
    return a.bad || b.bad || wide(a) || wide(b) ? [i] : [i, i + 1];
  }

  let showing = 0;
  async function show(i) {
    const token = ++showing;
    i = clamp(i, 0, R.book.count - 1);
    if (R.strip) { showStrip(i); return; }
    spreadEl.removeAttribute('data-mode');
    if (R.mode === 'spread' && i > 0 && i % 2 === 0) i -= 1;      /* spreads begin on odd pages; page 1 stands alone */
    const idx = await group(i);
    const loaded = await Promise.all(idx.map(load));
    if (dead || !R || token !== showing) return;
    const moved = R.opened && R.cur !== i;
    R.cur = i; R.shown = idx;
    const nodes = idx.map((n, k) => {
      const e = loaded[k];
      return e.bad
        ? h('div.mg__bad.mg__pg', { 'data-page': n + 1, 'data-bad': 'true', role: 'img', 'aria-label': `Page ${n + 1} can’t be shown` }, h('div', h('b', { text: `Page ${n + 1}` }), h('p', { text: e.bad })))
        : h('img.mg__pg', { src: e.url, alt: `Page ${n + 1} of ${R.book.count}`, 'data-page': n + 1, draggable: 'false' });
    });
    spreadEl.replaceChildren(...nodes);
    spreadEl.dataset.dir = R.dir; spreadEl.dataset.fit = R.fit; spreadEl.style.setProperty('--zoom', String(R.zoom));
    stageEl.scrollTop = 0; stageEl.scrollLeft = R.dir === 'rtl' ? stageEl.scrollWidth : 0;
    root.dataset.page = String(i + 1);
    savePos(R.key, { page: i, total: R.book.count, dir: R.dir, title: R.book.title });
    if (moved) countTurn(R.key);
    if (idx[idx.length - 1] >= R.book.count - 1) countDone(R.key);
    paintControls();
    release();
    for (const d of [idx[idx.length - 1] + 1, i - 1, idx[idx.length - 1] + 2]) if (d >= 0 && d < R.book.count) load(d);   /* warm the neighbours */
  }

  /* --- the vertical strip: every page is a slot in one scroll; pictures are put in when a slot is near the view
         and taken out again when it is far, so a long strip stays light --- */
  function showStrip(i) {
    const n = R.book.count;
    R.stripIo?.disconnect();
    R.vis = new Set();
    R.cur = i; R.shown = [i];
    spreadEl.dataset.mode = 'strip'; spreadEl.style.setProperty('--zoom', String(R.zoom));
    spreadEl.removeAttribute('data-dir'); spreadEl.removeAttribute('data-fit');
    const slots = Array.from({ length: n }, (_, k) => h('div.mg__slot', { 'data-slot': k + 1 }));
    R.slots = slots;
    spreadEl.replaceChildren(...slots);
    const fill = k => {
      const slot = slots[k];
      if (slot.firstChild) return;
      load(k).then(e => {
        if (dead || !R || !R.strip || R.slots !== slots || slot.firstChild || R.cache.get(k) !== e) return;
        if (e.bad) { slot.replaceChildren(h('div.mg__bad.mg__pg', { 'data-page': k + 1, 'data-bad': 'true', role: 'img', 'aria-label': `Page ${k + 1} can’t be shown` }, h('div', h('b', { text: `Page ${k + 1}` }), h('p', { text: e.bad })))); return; }
        if (e.w && e.h) slot.style.aspectRatio = `${e.w} / ${e.h}`;
        slot.replaceChildren(h('img.mg__pg', { src: e.url, alt: `Page ${k + 1} of ${n}`, 'data-page': k + 1, draggable: 'false' }));
      });
    };
    R.stripIo = new IntersectionObserver(es => {
      for (const e of es) { const k = Number(e.target.dataset.slot) - 1; if (e.isIntersecting) { R.vis.add(k); fill(k); } else R.vis.delete(k); }
      const keep = new Set();
      for (const k of R.vis) for (let d = -KEEP_AROUND; d <= KEEP_AROUND; d++) keep.add(k + d);
      slots.forEach((sl, k) => { if (sl.firstChild && !keep.has(k)) sl.replaceChildren(); });
      for (const k of keep) if (k >= 0 && k < n) fill(k);
      release();
    }, { root: stageEl, rootMargin: '700px 0px' });
    for (const sl of slots) R.stripIo.observe(sl);
    stageEl.scrollTop = 0;
    slots[i].scrollIntoView({ block: 'start' });
    root.dataset.page = String(i + 1);
    savePos(R.key, { page: i, total: R.book.count, dir: R.dir, title: R.book.title });
    paintControls();
  }
  /* which page is at the top of the view, after the person scrolls */
  function stripSync() {
    if (!R || !R.strip || !R.slots) return;
    const probe = stageEl.scrollTop + 4;
    let lo = 0, hi = R.slots.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (R.slots[mid].offsetTop <= probe) lo = mid; else hi = mid - 1; }
    if (lo === R.cur) return;
    R.cur = lo; R.shown = [lo];
    root.dataset.page = String(lo + 1);
    savePos(R.key, { page: lo, total: R.book.count, dir: R.dir, title: R.book.title });
    countTurn(R.key);
    if (lo >= R.book.count - 1) countDone(R.key);
    paintControls();
  }

  const goto = i => {
    if (R && R.strip) {
      i = clamp(i, 0, R.book.count - 1);
      R.slots[i].scrollIntoView({ block: 'start' });
      stripSync();
      if (R.cur !== i) { R.cur = i; R.shown = [i]; root.dataset.page = String(i + 1); savePos(R.key, { page: i, total: R.book.count, dir: R.dir, title: R.book.title }); paintControls(); }
      return Promise.resolve();
    }
    return show(i);
  };
  /* dir +1: the way the book reads forward */
  async function turn(dir) {
    if (!R) return;
    if (R.strip) {
      if (dir > 0 && R.cur >= R.book.count - 1) { flash('End of the book'); return; }
      if (dir < 0 && R.cur <= 0) { flash('This is the first page'); return; }
      goto(R.cur + dir);
      return;
    }
    if (dir > 0) {
      const next = R.shown[R.shown.length - 1] + 1;
      if (next >= R.book.count) { flash('End of the book'); return; }
      await show(next);
    } else {
      if (R.cur <= 0) { flash('This is the first page'); return; }
      await show(R.mode === 'spread' ? Math.max(0, R.cur - 2) : R.cur - 1);
    }
  }
  function flash(t) { if (footEl) { footEl.dataset.note = t; paintControls(); later(() => { if (footEl) { delete footEl.dataset.note; paintControls(); } }, 1500); } }

  function setDir(d) { R.dir = d; setPrefs({ dir: d }); savePos(R.key, { dir: d }); show(R.cur); }
  function setMode(m) { R.mode = m; setPrefs({ mode: m }); show(R.cur); }
  function setFit(f) { R.fit = f; setPrefs({ fit: f }); show(R.cur); }
  function setStrip(on) {
    R.strip = !!on; setPrefs({ strip: R.strip });
    R.stripIo?.disconnect(); R.stripIo = null; R.vis = new Set(); R.slots = null;
    stageEl.scrollTop = 0;
    show(R.cur);
  }
  function setNight(on) { R.night = !!on; setPrefs({ night: R.night }); reader.dataset.night = R.night ? '1' : '0'; paintControls(); }
  function setZone(v) { R.zone = v; setPrefs({ zone: v }); }
  function toggleFull() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else reader.requestFullscreen().catch(() => say('This browser wouldn’t go full screen here.', 'error'));
    } catch (e) { say('This browser wouldn’t go full screen here.', 'error'); }
  }
  function setZoom(z) { R.zoom = clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX); spreadEl.style.setProperty('--zoom', String(R.zoom)); zoomLbl.textContent = `${Math.round(R.zoom * 100)}%`; stageEl.dataset.zoom = String(R.zoom); stageEl.style.touchAction = R.zoom > 1.05 ? 'pan-x pan-y pinch-zoom' : 'pan-y pinch-zoom'; }

  function toggleMark() {
    const page = R.cur;
    const all = M().marks || {};
    const have = (all[R.key] || []).includes(page);
    const next = have ? all[R.key].filter(p => p !== page) : [...(all[R.key] || []), page].sort((a, b) => a - b);
    setM({ marks: { ...all, [R.key]: next } });
    paintControls();
    if (!sideEl.hidden) paintSide();
  }

  function paintControls() {
    if (!R || R.book.kind === 'pdf') return;
    const n = R.book.count, last = R.shown[R.shown.length - 1] ?? R.cur;
    dirBtn.textContent = R.dir === 'rtl' ? 'Right to left' : 'Left to right';
    dirBtn.setAttribute('aria-label', `Reading direction: ${dirBtn.textContent}. Switch`);
    stripBtn.setAttribute('aria-pressed', String(R.strip)); nightBtn.setAttribute('aria-pressed', String(R.night));
    modeBtn.hidden = fitBtn.hidden = dirBtn.hidden = R.strip;
    modeBtn.textContent = R.mode === 'spread' ? 'Two pages' : 'One page';
    modeBtn.setAttribute('aria-label', `Layout: ${modeBtn.textContent}. Switch`);
    fitBtn.textContent = R.fit === 'width' ? 'Fit width' : 'Fit height';
    fitBtn.setAttribute('aria-label', `Fit: ${fitBtn.textContent}. Switch`);
    rangeEl.value = String(R.cur + 1);
    rangeEl.classList.toggle('is-rtl', R.dir === 'rtl');
    const marked = marksOf(R.key).includes(R.cur);
    if (R.panel === 'marks' && !sideEl.hidden) for (const t of sideEl.querySelectorAll('[data-mark]')) t.setAttribute('aria-current', String(Number(t.dataset.mark) - 1 === R.cur));
    bmBtn.setAttribute('aria-pressed', String(marked));
    bmBtn.setAttribute('aria-label', marked ? 'Remove bookmark from this page' : 'Bookmark this page');
    const lbl = R.shown.length > 1 ? `Pages ${R.cur + 1}-${last + 1} of ${n}` : `Page ${R.cur + 1} of ${n}`;
    footEl.replaceChildren(...[h('span', { 'data-pos': '', text: lbl }), R.extra.credit ? h('span', { 'data-credit': '', text: R.extra.credit }) : null,
      footEl.dataset.note ? h('span', { role: 'status', text: footEl.dataset.note }) : null].filter(Boolean));
    for (const t of thumbsEl.querySelectorAll('.mg__thumb')) t.setAttribute('aria-current', String(R.shown.includes(Number(t.dataset.page) - 1)));
  }

  /* --- side panel: thumbnails (made as they scroll into view) and bookmarks --- */
  function paintSide() {
    for (const t of sideEl.querySelectorAll('[data-side]')) t.setAttribute('aria-selected', String(t.dataset.side === R.panel));
    R.thumbIo?.disconnect();
    thumbsEl.replaceChildren();
    if (R.panel === 'marks') {
      const marks = marksOf(R.key);
      if (!marks.length) thumbsEl.append(h('p.mg__empty', { text: 'No bookmarks yet. Press B on a page.' }));
      const list = h('div.mg__marks');
      const pend = [];
      for (const p of marks) {
        const ph = h('div.ph', { text: String(p + 1) });
        const note = h('input', { type: 'text', maxlength: '200', 'data-note': p + 1, placeholder: 'Add a note', 'aria-label': `Note for page ${p + 1}`, value: noteOf(R.key, p),
          onkeydown: e => e.stopPropagation(),
          onchange: e => { const all = M().notes || {}; const mine = { ...(all[R.key] || {}) }; const v = e.target.value.trim().slice(0, 200); if (v) mine[p] = v; else delete mine[p]; setM({ notes: { ...all, [R.key]: mine } }); } });
        list.append(h('div.mg__mark', h('button', { type: 'button', 'data-mark': p + 1, 'aria-current': String(p === R.cur), onclick: () => goto(p) }, ph, h('span', { text: `Page ${p + 1}` })), note));
        pend.push([ph.parentElement, p]);
      }
      thumbsEl.append(list);
      for (const [el, p] of pend) thumbFor(el, p, 90);
      return;
    }
    if (R.panel === 'books') {
      const books = scanBooks();
      if (!books.length) thumbsEl.append(h('p.mg__empty', { text: 'No other books yet.' }));
      for (const bk of books) {
        const c = h('span.mg__mini-cover');
        lazyCover(c, () => coverFor(bk).then(b => { if (b && !dead) c.replaceChildren(h('img', { src: mkUrl(b), alt: '' })); }));
        thumbsEl.append(h('button.mg__pick', { type: 'button', 'data-pick': bk.key, 'aria-current': String(bk.key === R.key), title: stemOf(bk.name), onclick: () => { if (bk.key !== R.key) openLocal(bk); } }, c, h('span', { text: stemOf(bk.name) })));
      }
      return;
    }
    const io = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); thumbFor(e.target); }
    }, { root: thumbsEl, rootMargin: '200px' });
    R.thumbIo?.disconnect();
    R.thumbIo = io;
    for (let i = 0; i < R.book.count; i++) {
      const ph = h('div.ph', { text: String(i + 1) });
      const t = h('button.mg__thumb', { type: 'button', 'data-page': i + 1, 'aria-label': `Go to page ${i + 1}`, 'aria-current': String(R.shown.includes(i)), onclick: () => goto(i) }, ph, h('span', { text: String(i + 1) }));
      thumbsEl.append(t); io.observe(t);
    }
  }
  const thumbQueue = [];
  let thumbBusy = false;
  function thumbFor(el, page, width) { thumbQueue.push({ el, book: R && R.book, page, width }); pumpThumbs(); }
  async function pumpThumbs() {
    if (thumbBusy) return;
    const job = thumbQueue.shift();
    if (!job) return;
    thumbBusy = true;
    try {
      if (job.book === (R && R.book) && job.el.isConnected) {
        const i = job.page ?? Number(job.el.dataset.page) - 1;
        const t = await thumbOf(await job.book.page(i), job.width || 120);
        const u = mkUrl(t);
        (job.page === undefined ? job.el.firstChild : job.el.firstChild).replaceChildren(h('img', { src: u, alt: '' }));
      }
    } catch (e) { /* a page that can't be read keeps its number */ }
    thumbBusy = false;
    if (!dead) pumpThumbs();
  }

  /* --- input --- */
  function onKey(e) {
    if (!R || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const fwd = R.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight', back = R.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let used = true;
    if (k === fwd || k === 'PageDown') turn(1);
    else if (k === back || k === 'PageUp') turn(-1);
    else if (k === ' ') { if (R.strip) stageEl.scrollBy({ top: (e.shiftKey ? -1 : 1) * stageEl.clientHeight * 0.9 }); else turn(e.shiftKey ? -1 : 1); }
    else if (k === 'Home') goto(0);
    else if (k === 'End') goto(R.book.count - 1);
    else if (k === '+' || k === '=') setZoom(R.zoom + 0.25);
    else if (k === '-' || k === '_') setZoom(R.zoom - 0.25);
    else if (k === '0') setZoom(1);
    else if (k === 'd' || k === 'D') setDir(R.dir === 'rtl' ? 'ltr' : 'rtl');
    else if (k === 's' || k === 'S') setMode(R.mode === 'spread' ? 'single' : 'spread');
    else if (k === 'f' || k === 'F') setFit(R.fit === 'width' ? 'height' : 'width');
    else if (k === 'b' || k === 'B') toggleMark();
    else if (k === 't' || k === 'T') { sideEl.hidden = !sideEl.hidden; if (!sideEl.hidden) paintSide(); }
    else if (k === 'v' || k === 'V') setStrip(!R.strip);
    else if (k === 'n' || k === 'N') setNight(!R.night);
    else if (k === 'Enter' && document.fullscreenEnabled) toggleFull();
    else if (k === 'g' || k === 'G') jumpEl.focus();
    else if (k === 'Escape') closeReader(true);
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  function onStageClick(e) {
    if (e.target.closest('a,button')) return;
    const r = stageEl.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (R.zoom > 1.05 || R.strip || !R.zone) return;   /* zoomed in or scrolling: clicks are for moving around; zones can be turned off */
    const z = R.zone / 100;
    if (x < z) turn(R.dir === 'rtl' ? 1 : -1);
    else if (x > 1 - z) turn(R.dir === 'rtl' ? -1 : 1);
  }
  function swipe(el) {
    /* Timed with the events' own timestamps (when the browser received each touch), not with
       when this handler ran: a busy page or a slow test machine delays the handler, and that
       delay is not the person's slow finger. Fallback pointermove coordinates cover a touch
       that ends without a position. */
    let s = null;
    el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') s = { x: e.clientX, y: e.clientY, t: e.timeStamp, lx: e.clientX, ly: e.clientY }; });
    el.addEventListener('pointermove', e => { if (s && e.pointerType !== 'mouse') { s.lx = e.clientX; s.ly = e.clientY; } });
    const end = e => {
      if (!s) return;
      const ex = e.clientX || s.lx, ey = e.clientY || s.ly;
      const dx = ex - s.x, dy = ey - s.y, dt = e.timeStamp - s.t;
      s = null;
      root.dataset.swipe = `${Math.round(dx)},${Math.round(dy)},${Math.round(dt)}`;
      if (R && R.zoom <= 1.05 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 900) {
        /* a left-to-right book is turned by dragging the page left; a right-to-left one by dragging it right */
        const forward = R.dir === 'rtl' ? dx > 0 : dx < 0;
        turn(forward ? 1 : -1);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', e => { root.dataset.swipe = `cancel@${Math.round(e.clientX - (s ? s.x : 0))}`; s = null; });
  }

  function closeReader(repaint) {
    if (R) {
      R.thumbIo?.disconnect();
      R.stripIo?.disconnect();
      if (document.fullscreenElement === reader) { try { document.exitFullscreen(); } catch (e) { /* gone */ } }
      for (const e of R.cache.values()) if (e.url) freeUrl(e.url);
      R.book.close();
      R = null;
    }
    thumbQueue.length = 0;
    showing++;
    reader.hidden = true;
    reader.replaceChildren();
    delete root.dataset.page; delete root.dataset.decoded;
    if (repaint && !dead) { paint(); top.querySelector('[data-act=add]')?.focus(); }
  }

  /* opened from Files, or again while open */
  function openPath(p) {
    const n = vfs.node(p);
    if (!n || n.type !== 'file') return;
    openLocal({ key: n && p, path: p, name: n.name, kind: extOf(n.name), size: n.size || 0 });
  }
  win.onReopen && win.onReopen(o => { if (o && typeof o.path === 'string') openPath(o.path); });
  const offFs = api.bus.on('fs:change', () => { if (!dead && !R && S.tab === 'library') { clearTimeout(fsT); fsT = later(paint, 250); } });
  let fsT = 0;

  setTab('library');
  if (opts && typeof opts.path === 'string') openPath(opts.path);

  return () => {
    dead = true;
    ac.abort();
    for (const t of timers) clearTimeout(t);
    if (typeof offFs === 'function') offFs();
    closeReader(false);
    coverIo?.disconnect();
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    root.replaceChildren();
  };
}
