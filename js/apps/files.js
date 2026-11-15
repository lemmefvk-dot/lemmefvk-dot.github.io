/* ============================================================
   Files — the reference app, and the one place a person sees
   what is really kept on this computer.

   The shape is unchanged: one .app root, sidebar + main column,
   toolbar injected into the window title bar, everything else from
   css/apps.css (css/feat-files.css only adds what Files alone has).

   What is real, and how:
   · Thumbnails are the pictures themselves (media.urlOf) and a frame
     read out of each video with its measured length — only for files
     that have bytes behind them (media.isMedia). A file that is
     listed with a size but holds nothing (StaticOS still ships a few,
     e.g. Projects/aether-term/term.rs) is marked "no data" and never
     gets a picture invented for it.
   · Import (toolbar, right-click, or drop files from the computer —
     on this window or on the desktop) saves into the folder on screen
     by the rules in core/fileimport.js: plain text up to 200 KB into
     the vfs, editable; everything else (pictures, videos, music, PDFs,
     any other file) as a real blob in IndexedDB, with its own name,
     MIME type and byte size. A file bigger than the space the browser
     has left is turned away by name, with both sizes.
   · Download hands the real bytes to the browser — the blob for media,
     the text for text. Folders can't be downloaded, and it says so.
   · Quick Look (Space, or opening a PDF) is the viewer: it shows the
     picture (fit, or actual size), plays the video or song, shows a
     PDF in the browser's own PDF viewer, or prints the text; ← → step
     through the folder and Esc closes. A file with nothing behind it
     says "This file has no content in this browser".
   · Compress (right-click; ⌘/Ctrl- or Shift-click picks several) packs
     files and folders into a real .zip beside them. A .zip opens in the
     viewer as the folders and files inside it; Extract all, Extract here
     and Extract to unpack it (core/archive.js, core/zip.js).
   · Tags (core/filetags.js): seven colours and tags you name, from the
     right-click menu or Quick Look; dots show on items, the sidebar's
     Tags list opens everything wearing one. The Trash view says how many
     days an item has left when Settings › Storage turns on the 30-day Trash.
   · Put Back, Undo, Cut / Copy / Paste and batch rename come from core/fsops.js,
     the same module Static Downloads uses: Put Back returns an item to the
     folder it came from (remembered, so it works after a reload), and ⌘/Ctrl+Z
     takes back the last Move to Trash, Move to, rename, batch rename or paste.
   · Get Info (⌘/Ctrl+I) walks the item: a folder's size is every file inside
     it, and files that list a size but hold nothing are counted apart.
   · Smart folders (Today, This week, Images, Documents), Largest files and
     "What uses space" are real searches and sums over Home; typing in the
     filter also looks in subfolders, with Show in folder.
   · Column view, a second pane (copy or move between panes), Go to folder
     (⌘/Ctrl+Shift+G), new files from templates, and a sort order that is
     remembered for each folder.
   · Sizes are node.size as stored. The storage meter is the browser's
     own navigator.storage.estimate(), labelled as its estimate — the
     old "282 GB of 512 GB used" and "230 GB free" were made up.
   ============================================================ */
import { defineApp, appForExt } from '../core/registry.js';
import * as deskterm from '../shell/deskterm.js';
import media from '../core/media.js';
import * as fileimport from '../core/fileimport.js';
import * as archive from '../core/archive.js';
import { fmtBytes, fmtDur } from '../core/util.js';
import * as tags from '../core/filetags.js';
import * as trashx from '../core/trashexpiry.js';
import * as ops from '../core/fsops.js';
import { t as tr, plural as plu, isEnglish, locale } from '../core/i18n.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-files-css')) {
  const l = document.createElement('link');
  l.id = 'feat-files-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-files.css';
  document.head.appendChild(l);
}

const FAVS = [
  [tr('Home'),      '',            'home'],
  [tr('Desktop'),   'Desktop',     'monitor'],
  [tr('Documents'), 'Documents',   'file-text'],
  [tr('Downloads'), 'Downloads',   'download'],
  [tr('Pictures'),  'Pictures',    'image'],
  [tr('Music'),     'Music',       'music'],
  [tr('Videos'),    'Videos',      'film'],
  [tr('Projects'),  'Projects',    'folder-git'],
  [tr('Trash'),     'Trash',       'trash'],
];

/* What may be imported, and where it is kept, is decided in one place
   (core/fileimport.js) for Files and the desktop alike. */
const { importBlock } = fileimport;
const TEXT_MAX = fileimport.TEXT_MAX;

const TEXT_MIME = {
  md: 'text/markdown', json: 'application/json', js: 'text/javascript', css: 'text/css',
  html: 'text/html', csv: 'text/csv', xml: 'application/xml', tsv: 'text/tab-separated-values',
};

const TYPE_NAMES = {
  jpg: tr('JPEG image'), jpeg: tr('JPEG image'), png: tr('PNG image'), gif: tr('GIF image'), webp: tr('WebP image'),
  avif: tr('AVIF image'), svg: tr('SVG image'), bmp: tr('BMP image'),
  mp4: tr('MP4 video'), webm: tr('WebM video'), mov: tr('QuickTime video'), m4v: tr('MPEG-4 video'),
  mkv: tr('Matroska video'), ogv: tr('Ogg video'),
  mp3: tr('MP3 audio'), wav: tr('WAV audio'), ogg: tr('Ogg audio'), oga: tr('Ogg audio'), m4a: tr('AAC audio'),
  aac: tr('AAC audio'), flac: tr('FLAC audio'), opus: tr('Opus audio'), weba: tr('WebM audio'),
  txt: tr('Plain text'), md: tr('Markdown'), json: tr('JSON'), js: tr('JavaScript'), ts: tr('TypeScript'),
  css: tr('CSS'), html: tr('HTML page'), csv: tr('CSV table'), tsv: tr('TSV table'), sheet: tr('Static Sheets workbook'), slides: tr('Static Slides deck'), log: tr('Log'), xml: tr('XML'),
  yml: tr('YAML'), yaml: tr('YAML'), toml: tr('TOML'), ini: tr('Settings'), conf: tr('Settings'), sh: tr('Shell script'),
  py: tr('Python'), rs: tr('Rust'), c: tr('C source'), h: tr('C header'), pdf: tr('PDF document'),
  zip: tr('ZIP archive'), tar: tr('Tar archive'), gz: tr('Gzip archive'), '7z': '7-Zip archive', rar: tr('RAR archive'),
  doc: tr('Word document'), docx: tr('Word document'), xls: tr('Excel workbook'), xlsx: tr('Excel workbook'),
  ppt: tr('PowerPoint deck'), pptx: tr('PowerPoint deck'), odt: tr('OpenDocument text'), rtf: tr('Rich text'),
  pages: tr('Pages document'), key: tr('Keynote deck'), numbers: tr('Numbers sheet'), epub: tr('EPUB book'),
  ttf: tr('Font'), otf: tr('Font'), woff: tr('Web font'), woff2: tr('Web font'), ico: tr('Icon'), heic: tr('HEIC image'),
  dmg: tr('Disk image'), iso: tr('Disk image'), exe: tr('Windows program'), msi: tr('Windows installer'), apk: tr('Android package'),
  aethergame: tr('Game shortcut'), staticgame: tr('Game shortcut'), staticapp: tr('App shortcut'), aether: tr('Theme'), aetherclip: tr('Clip'),
};

const PLURALS = { item: ['{n} item', '{n} items'], file: ['{n} file', '{n} files'], folder: ['{n} folder', '{n} folders'], day: ['{n} day', '{n} days'], name: ['{n} name', '{n} names'], match: ['{n} match', '{n} matches'] };
const plural = (n, w) => (isEnglish() || !PLURALS[w] ? `${n} ${w}${n === 1 ? '' : 's'}` : plu(n, ...PLURALS[w]));
const bytes = n => (n ? fmtBytes(n) : '0 B');
const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
const stemOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
/** A measured length: tenths for short clips ("2.5 s"), m:ss otherwise. */
const lengthOf = s => (s < 10 ? `${(Math.floor(s * 10) / 10).toFixed(1)} s` : fmtDur(s));

/* ---- what a vfs file really holds ---------------------------------- */
const hasText = n => n.type === 'file' && !media.isMedia(n) && typeof n.content === 'string' && n.content.length > 0;
/** Listed with a size, but no bytes are stored for it anywhere. */
const isHollow = n => n.type === 'file' && !media.isMedia(n) && !hasText(n) && (n.size || 0) > 0;
/** 'image' | 'video' | 'audio' | null — only for files with real bytes. */
function mediaKindOf(n) {
  if (!n || n.type !== 'file' || !media.isMedia(n)) return null;
  const c = n.content;
  return media.kindOf(n.name) || (c.startsWith(media.ASSET) ? media.kindOf(c.slice(media.ASSET.length)) : null);
}
/** A file whose bytes are a blob in IndexedDB but that Photos, Videos and
    Music don't open: a PDF, an archive, big text kept read-only, an .avif…
    The Files viewer is its home (api.openFile sends it here too). */
const isOtherBlob = n => !!n && n.type === 'file' && String(n.content || '').startsWith(media.MEDIA)
  && !['image', 'video', 'audio'].includes(n.kind) && !appForExt(n);   /* a viewer that claimed the extension (.json) opens it itself */
const isPdf = n => !!n && n.type === 'file' && extOf(n.name) === 'pdf';
const TEXTISH = new Set([...fileimport.TEXT_EXT, 'rs', 'c', 'h']);
/** Opened in Files' own viewer rather than handed to another app. */
const viewsHere = n => !!n && n.type === 'file' && (isPdf(n) || isOtherBlob(n));
/* Chrome, Edge, Brave, Firefox and Safari report true when they can show a
   PDF inside a page; a browser that says false gets "open in a new tab" */
const pdfInline = () => typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false;

function typeName(n) {
  if (n.type === 'dir') return tr('Folder');
  const e = extOf(n.name);
  return TYPE_NAMES[e] || (e ? tr('{ext} file', { ext: e.toUpperCase() }) : tr('File'));
}
function fullDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function mediaErr(err) {
  switch (err?.code) {
    case 4: return tr('Its format or codec is not supported by this browser.');
    case 3: return tr('It could not be decoded.');
    case 2: return tr('It could not be loaded.');
    case 1: return tr('Loading was stopped.');
    default: return '';
  }
}

/* ---- thumbnails, shared by every Files window ----------------------
   A media reference never changes what it points at, so what we learn
   about one (its URL, its size in pixels, a video frame) is kept for the
   session and a repaint shows it instantly instead of flashing. */
const thumbUrls = new Map();   /* media ref -> URL that worked */
const thumbDims = new Map();   /* media ref -> { w, h } measured from the picture */
const frames = new Map();      /* video ref -> { src, w, h, duration } | { error } */
const jobs = new Map();        /* video ref -> frame grab in flight */
const FRAME_CAP = 160;
const queue = [];
let running = 0;

/** Read one real frame (and the real length) out of a video. */
function grabFrame(url, job) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    let done = false;
    const finish = out => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.onloadeddata = v.onseeked = v.onerror = null;
      v.removeAttribute('src');
      try { v.load(); } catch (e) { /* already released */ }
      resolve(out);
    };
    const timer = setTimeout(() => finish({ error: 'timed out' }), 12000);
    job.abort = () => finish(null);
    const draw = () => {
      const w = v.videoWidth, h = v.videoHeight;
      const duration = Number.isFinite(v.duration) ? v.duration : null;
      if (!w || !h) { finish({ error: 'no picture', duration }); return; }
      const W = 208, H = Math.max(1, Math.round(W * h / w));
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      try {
        c.getContext('2d').drawImage(v, 0, 0, W, H);
        finish({ src: c.toDataURL('image/jpeg', 0.82), w, h, duration });
      } catch (err) { finish({ error: String(err?.message || err), w, h, duration }); }
    };
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      const t = d > 0 ? Math.min(1.2, d / 3) : 0;
      if (t > 0.05) v.currentTime = t; else draw();
    };
    v.onseeked = draw;
    v.onerror = () => finish({ error: mediaErr(v.error) || 'unplayable' });
    v.src = url;
  });
}

function frameOf(n, owner) {
  const ref = n.content;
  if (frames.has(ref)) return Promise.resolve(frames.get(ref));
  let job = jobs.get(ref);
  if (!job) {
    job = { ref, owners: new Set(), cancelled: false, abort: null };
    job.promise = new Promise(res => { job.resolve = res; });
    job.run = async () => {
      let out = null;
      try {
        const url = await media.urlOf(n);
        if (!job.cancelled) out = url ? await grabFrame(url, job) : { error: 'missing' };
      } catch (err) { out = { error: String(err?.message || err) }; }
      if (jobs.get(ref) === job) jobs.delete(ref);
      if (!job.cancelled && out) {
        frames.set(ref, out);
        while (frames.size > FRAME_CAP) frames.delete(frames.keys().next().value);
      }
      job.resolve(job.cancelled ? null : out);
    };
    jobs.set(ref, job);
    queue.push(job);
    pump();
  }
  job.owners.add(owner);
  return job.promise;
}
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift();
    if (job.cancelled) continue;
    running++;
    job.run().finally(() => { running--; pump(); });
  }
}
/** A window closed: stop grabbing frames nobody else is waiting for. */
function releaseJobs(owner) {
  for (const job of [...jobs.values()]) {
    job.owners.delete(owner);
    if (job.owners.size) continue;
    job.cancelled = true;
    job.abort?.();
    jobs.delete(job.ref);
    job.resolve(null);
  }
}

defineApp({
  id: 'files',
  name: 'Files',
  icon: 'folder',
  g1: '#8cc2ff', g2: '#1e52c7',
  category: 'System',
  keywords: ['finder', 'explorer', 'browse', 'folder', 'import', 'download', 'upload', 'pdf', 'preview', 'viewer', 'drop',
    'undo', 'put back', 'trash', 'rename', 'copy', 'paste', 'info', 'storage', 'largest', 'clean up', 'columns'],
  desc: tr('Browse, import, preview and download your files'),
  pinned: true, dock: true,
  /* PDFs open in Files' own viewer (Quick Look); Notes can't show one */
  handles: ['doc'],
  win: { w: 760, h: 520, minW: 470, minH: 300 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Mod+F', tr('Filter this folder')],
    ['Left / Right / Up / Down', tr('Move the selection')],
    ['Enter / Mod+O / Mod+Down', tr('Open the selected item')],
    ['Space', tr('Quick Look the selected item (arrows step through, Z zooms)')],
    ['Backspace / Mod+Up', tr('Up to the folder above')],
    ['Delete / Mod+Backspace', tr('Move to the Trash')],
    ['Mod+Z', tr('Undo the last move, rename or paste')],
    ['Mod+X / Mod+C / Mod+V', tr('Cut, copy and paste files and folders')],
    ['Mod+I', tr('Get Info')],
    ['Mod+Shift+G', tr('Go to a folder')],
    ['F2', tr('Rename (several selected: rename them together)')],
    ['Home / End', tr('First / last item')],
    ['Esc', tr('Clear the selection or the filter')],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs, fmt, store } = api;
    const HOME = vfs.HOME;
    const TRASH = `${HOME}/Trash`;
    const owner = {};
    let alive = true;

    /* timers we own, so teardown can stop every one of them */
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const cancel = t => { if (t) { clearTimeout(t); timers.delete(t); } };
    const downloads = new Map();          /* timer -> object URL handed to <a download> */

    /* ---------------- state ---------------- */
    const S = {
      path: HOME,
      view: store.get('prefs.filesView', 'grid'),
      sort: 'name',
      hidden: false,
      sel: new Set(),
      lead: null,                    /* the item the keyboard is on (and Shift-click's anchor) */
      filter: '',
      back: [], fwd: [],
      list: [],
      renaming: null, renameDraft: null, renameEl: null, renameHold: false,
      tag: null, tagSel: null,       /* a tag's list is open (sidebar › Tags): its name, and the path picked in it */
      smart: null, rsel: null,       /* a smart folder, Largest files or the storage map is open: its id, and the path picked in it */
      mapPath: HOME,                 /* the folder the storage map is showing */
      deep: true, deepSel: null,     /* the filter also looks in subfolders; the path picked among those hits */
      two: false, p2: { path: HOME, sel: null },   /* the second pane */
      sortFor: null,                 /* the folder S.sort was last read for */
      importing: false,
      storage: null,
      painted: null,
    };
    S.sort = ['name', 'size', 'mtime', 'kind'].includes(store.get('prefs.filesSort', 'name')) ? store.get('prefs.filesSort', 'name') : 'name';
    if (!['grid', 'list', 'columns'].includes(S.view)) S.view = 'grid';
    const MOD = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+';

    const at = name => `${S.path === '/' ? '' : S.path}/${name}`;
    const selName = () => (S.lead && S.sel.has(S.lead) ? S.lead : [...S.sel][0] || null);
    const selected = () => { const s = selName(); return s ? vfs.node(at(s)) : null; };
    const inHome = p => p === HOME || p.startsWith(`${HOME}/`);
    const isTrash = p => p === TRASH || p.startsWith(`${TRASH}/`);
    const folderLabel = p => (p === HOME ? 'Home' : p === '/' ? 'Static Drive' : vfs.baseName(p));

    /** Put a path on screen: a folder opens, a file opens its folder with it selected. */
    function target(p, pick) {
      if (!p) return null;
      const n = vfs.node(p);
      if (!n) return null;
      if (n.type === 'dir') return { dir: vfs.norm(p), sel: pick || null };
      return { dir: vfs.parentPath(p), sel: n.name };
    }
    {
      const t = target(opts?.path, opts?.select);
      if (t) { S.path = t.dir; if (t.sel) S.sel = new Set([t.sel]); }
    }

    /* ---------------- chrome --------------- */
    const btnBack = h('button.ibtn.tip', { 'data-tip': tr('Back'), 'aria-label': tr('Back'),
      onclick: () => goBack() }, icon('chevron-left'));
    const btnFwd  = h('button.ibtn.tip', { 'data-tip': tr('Forward'), 'aria-label': tr('Forward'),
      onclick: () => goFwd() }, icon('chevron-right'));
    win.setLead(btnBack, btnFwd);

    const search = h('input', { type: 'search', placeholder: tr('Filter…'), spellcheck: 'false', 'aria-label': tr('Filter this folder by name'),
      oninput: e => { S.filter = e.target.value.trim().toLowerCase(); paint(); },
      onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFilter(); } } });
    const deepBtn = h('button.fx-deepbtn.tip', { type: 'button', 'aria-pressed': 'true', 'data-tip': tr('Also search subfolders'), 'aria-label': tr('Also search subfolders'),
      onclick: () => { S.deep = !S.deep; deepBtn.setAttribute('aria-pressed', String(S.deep)); paint(); } }, icon('folder'));
    const searchBox = h('div.field', { style: { width: '178px', height: '24px' } }, icon('search'), search, deepBtn);
    searchBox.classList.add('hidden');
    const filterBtn = h('button.ibtn.tip', { 'data-tip': tr('Filter'), 'aria-label': tr('Filter'), 'aria-expanded': 'false',
      onclick: () => (searchBox.classList.contains('hidden') ? openFilter() : closeFilter()) }, icon('search'));
    function openFilter() {
      searchBox.classList.remove('hidden');
      filterBtn.setAttribute('aria-expanded', 'true');
      search.focus();
      search.select();
    }
    function closeFilter() {
      searchBox.classList.add('hidden');
      filterBtn.setAttribute('aria-expanded', 'false');
      const had = S.filter;
      S.filter = ''; search.value = '';
      if (had) paint();
      focusSel();
    }

    const segBtn = (mode, ic, tip) => h('button.tip', {
      'data-tip': tip, 'aria-label': tip, dataset: { view: mode },
      onclick: () => setView(mode),
    }, icon(ic));
    const seg = h('div.seg', { role: 'group', 'aria-label': tr('View') }, segBtn('grid', 'grid', tr('Icons')), segBtn('list', 'list', tr('List')), segBtn('columns', 'sidebar', tr('Columns')));
    function setView(mode) { S.view = mode; store.set('prefs.filesView', mode); paintSeg(); paint(); }
    const undoBtn = h('button.ibtn.tip', { 'data-tip': tr('Nothing to undo'), 'aria-label': tr('Undo'), disabled: true, onclick: () => doUndo() }, icon('undo'));
    const twoBtn = h('button.ibtn.tip.fx-twobtn', { 'data-tip': tr('Two panes'), 'aria-label': tr('Two panes'), 'aria-pressed': 'false', onclick: () => setTwo(!S.two) }, icon('layers'));

    win.setTools(
      filterBtn,
      searchBox,
      h('button.ibtn.tip', { 'data-tip': tr('Import from computer'), 'aria-label': tr('Import from computer'), onclick: () => pickFiles() }, icon('upload')),
      h('button.ibtn.tip', { 'data-tip': tr('New folder'), 'aria-label': tr('New folder'), onclick: () => newFolder() }, icon('plus')),
      h('button.ibtn.tip', { 'data-tip': tr('Sort'), 'aria-label': tr('Sort'), onclick: e => sortMenu(e) }, icon('filter')),
      undoBtn,
      twoBtn,
      seg,
    );

    /* ---------------- layout --------------- */
    const side = h('aside.app__side', { 'aria-label': tr('Places') });
    const crumbs = h('nav.crumbs', { 'aria-label': tr('Folder path') });
    const barExtra = h('div.fx-barx');
    const content = h('div.app__content.fx-content');
    const report = h('div.fx-report', { hidden: true, role: 'region', 'aria-label': tr('Import') });
    const status = h('div.app__bar.app__bar--foot.fx-status');
    const flashEl = h('span.fx-flash', { role: 'status', 'aria-live': 'polite' });
    const upBtn = h('button.ibtn.tip', { 'data-tip': tr('Up one level'), 'aria-label': tr('Up one level'),
      onclick: () => go(S.tag || S.smart ? HOME : vfs.parentPath(S.path)) }, icon('arrow-up'));
    const pane2 = h('div.fx-pane2', { hidden: true, role: 'region', 'aria-label': tr('Second pane') });
    const split = h('div.fx-split', content, pane2);
    const main = h('div.app__main',
      h('div.app__bar', crumbs, h('div.grow'), barExtra, upBtn),
      split, report, status);
    const dropTitle = h('b');
    const dropNote = h('small');
    const drop = h('div.fx-drop', { 'aria-hidden': 'true' },
      h('div.fx-drop__card', icon('upload'), dropTitle, dropNote));
    const picker = h('input.fx-picker', {
      type: 'file', multiple: true, hidden: true, tabindex: '-1', 'aria-hidden': 'true',
      onchange: () => { const files = [...(picker.files || [])]; picker.value = ''; importInto(S.path, files); },
    });
    const app = h('div.app.fx', side, main, drop, picker);
    root.appendChild(app);

    content.addEventListener('click', e => { if (!S.tag && !S.smart && !e.target.closest('[data-name],.fx-tagrow,.fx-colitem')) select(null); });
    content.addEventListener('contextmenu', e => {
      if (S.tag || S.smart || e.target.closest('[data-name],.fx-tagrow')) return;
      e.preventDefault();
      const trashKids = isTrash(S.path) ? vfs.ls(TRASH, { hidden: true }).length : 0;
      const roomHere = !importBlock(S.path);
      api.menu([
        { label: tr('New folder'), icon: 'plus', onClick: newFolder },
        { label: tr('New text file'), icon: 'file-text', onClick: newFile },
        { label: tr('New file from template'), icon: 'file-code', disabled: !roomHere,
          items: ops.TEMPLATES.map(t => ({ label: t.label, icon: t.icon, onClick: () => newFromTemplate(t.id) })) },
        { label: tr('Import from computer…'), icon: 'upload', onClick: pickFiles },
        '-',
        { label: ops.clipCount() ? tr('Paste {count}', { count: plural(ops.clipCount(), 'item') }) : tr('Paste'), icon: 'clipboard', hint: `${MOD}V`, disabled: !ops.clipCount() || !roomHere, onClick: pasteHere },
        { label: ops.canUndo() ? tr('Undo {what}', { what: ops.undoLabel() }) : tr('Undo'), icon: 'undo', hint: `${MOD}Z`, disabled: !ops.canUndo(), onClick: doUndo },
        { label: tr('Get Info'), icon: 'info', hint: `${MOD}I`, onClick: () => getInfo([S.path]) },
        '-',
        { label: tr('View'), icon: 'grid', items: [['grid', tr('As icons'), 'grid'], ['list', tr('As a list'), 'list'], ['columns', tr('In columns'), 'sidebar']]
          .map(([m, label, ic]) => ({ label, icon: ic, checked: S.view === m, onClick: () => setView(m) })) },
        { label: S.hidden ? tr('Hide dotfiles') : tr('Show dotfiles'), icon: 'eye',
          onClick: () => { S.hidden = !S.hidden; paint(); } },
        trashKids ? '-' : null,
        trashKids ? { label: tr('Empty Trash'), icon: 'trash', danger: true, onClick: emptyTrash } : null,
        deskterm.available() ? '-' : null,
        deskterm.available()
          ? { label: tr('Open in Terminal'), icon: 'terminal', onClick: () => api.openApp('terminal', { cwd: S.path }) }
          : null,
      ].filter(Boolean), e.clientX, e.clientY);
    });

    /* ---------------- sidebar -------------- */
    const favs = FAVS.map(([label, rel, ic]) => {
      const p = rel ? `${HOME}/${rel}` : HOME;
      const count = h('small');
      const el = h('button.side__item', { onclick: () => go(p) }, icon(ic), h('span', { text: label }), count);
      return { el, p, rel, count };
    });
    const driveEl = h('button.side__item', { onclick: () => go('/') }, icon('hard-drive'), h('span', { text: tr('Static Drive') }));
    const meter = h('div.side__meter.fx-meter');
    const smartEls = ops.SMART.map(sm => ({ id: sm.id, el: h('button.side__item', { type: 'button', dataset: { smart: sm.id }, onclick: () => openSmart(sm.id) }, icon(sm.icon), h('span', { text: sm.label })) }));
    const largestEl = h('button.side__item', { type: 'button', dataset: { smart: 'largest' }, onclick: () => openSmart('largest') }, icon('bar-chart'), h('span', { text: tr('Largest files') }));
    const mapEl = h('button.side__item', { type: 'button', dataset: { smart: 'map' }, onclick: () => openSmart('map') }, icon('pie-chart'), h('span', { text: tr('What uses space') }));
    const tagsEl = h('div.side__group.fx-tags', { 'aria-label': tr('Tags') });
    side.append(
      h('div.side__group', h('div.side__label', { text: tr('Favorites') }), favs.map(f => f.el)),
      h('div.side__group.fx-smart', { 'aria-label': tr('Smart folders') }, h('div.side__label', { text: tr('Smart folders') }), smartEls.map(x => x.el)),
      tagsEl,
      h('div.side__group.fx-storage', h('div.side__label', { text: tr('Storage') }), driveEl, largestEl, mapEl, meter));

    function paintSide() {
      for (const x of [...smartEls, { id: 'largest', el: largestEl }, { id: 'map', el: mapEl }]) {
        const on = S.smart === x.id;
        x.el.classList.toggle('is-on', on);
        if (on) x.el.setAttribute('aria-current', 'page'); else x.el.removeAttribute('aria-current');
      }
      for (const f of favs) {
        const on = !S.tag && !S.smart && f.p === S.path;
        f.el.classList.toggle('is-on', on);
        if (on) f.el.setAttribute('aria-current', 'page'); else f.el.removeAttribute('aria-current');
        if (f.rel === 'Trash') {
          const n = vfs.ls(f.p, { hidden: true }).length;
          f.count.textContent = n ? String(n) : '';
          f.el.setAttribute('aria-label', n ? tr('Trash, {count}', { count: plural(n, 'item') }) : tr('Trash, empty'));
        }
      }
      driveEl.classList.toggle('is-on', !S.tag && !S.smart && S.path === '/');
      paintTags();
      keepChip();
    }

    /* ---------------- tags ----------------- */
    const dotsFor = n => {
      const t = tags.tagsOf(n);
      return t.length ? h('span.fx-dots', { 'aria-hidden': 'true' }, t.slice(0, 4).map(x => h('i.fx-dot', { style: { background: tags.cssOf(x) }, title: x }))) : null;
    };
    let tagSig = '';
    function paintTags() {
      const list = tags.counts();
      /* a repaint that changes nothing here must not rebuild the buttons (focus, hover) */
      const sig = JSON.stringify([list.map(t => [t.name, t.color, t.count]), S.tag]);
      if (sig === tagSig && tagsEl.firstChild) return;
      tagSig = sig;
      api.render(tagsEl,
        h('div.side__label', { text: tr('Tags') }),
        list.map(t => {
          const el = h('button.side__item.fx-tag' + (S.tag && S.tag.toLowerCase() === t.name.toLowerCase() ? '.is-on' : ''), {
            type: 'button', dataset: { tag: t.name }, 'aria-label': tr('{name} tag, {count}', { name: t.name, count: plural(t.count, 'item') }),
            'aria-current': S.tag && S.tag.toLowerCase() === t.name.toLowerCase() ? 'page' : null,
            onclick: () => openTag(t.name),
            oncontextmenu: e => {
              e.preventDefault();
              api.menu([
                { label: tr('Show “{name}” items', { name: t.name }), icon: 'tag', onClick: () => openTag(t.name) },
                !t.builtin && '-',
                !t.builtin && { label: tr('Delete tag'), icon: 'trash', danger: true, onClick: () => deleteTag(t) },
              ].filter(Boolean), e.clientX, e.clientY);
            },
          }, h('i.fx-side-dot', { style: { background: t.css } }), h('span', { text: t.name }), h('small', { text: t.count ? String(t.count) : '' }));
          return el;
        }),
        h('button.side__item.fx-tag-new', { type: 'button', 'aria-label': tr('New tag'), onclick: () => newTagDialog() }, icon('plus'), h('span', { text: tr('New tag…') })));
    }
    async function deleteTag(t) {
      const ok = await api.confirm({ title: tr('Delete the tag “{name}”?', { name: t.name }), message: tr('It is taken off every file and folder. The files themselves stay.'), ok: tr('Delete tag'), danger: true });
      if (!ok || !alive) return;
      if (S.tag && S.tag.toLowerCase() === t.name.toLowerCase()) go(HOME);
      tags.deleteTag(t.name);
      paintAll();
    }
    function openTag(name) {
      leaveFolder();
      S.tag = name; S.tagSel = null;
      paintAll();
    }
    /** The tags submenu for these paths: a tick where every one of them has the tag. */
    function tagItems(paths, after) {
      const nodes = paths.map(p => vfs.node(p)).filter(Boolean);
      const every = d => nodes.length > 0 && nodes.every(n => tags.hasTag(n, d.name));
      const done = () => { after?.(); };
      return [
        ...tags.defs().map(d => ({ label: d.name, icon: 'tag', checked: every(d),
          onClick: () => { const on = every(d); for (const p of paths) on ? tags.remove(p, d.name) : tags.add(p, d.name); done(); } })),
        '-',
        { label: tr('New tag…'), icon: 'plus', onClick: () => newTagDialog(name => { for (const p of paths) tags.add(p, name); done(); }) },
        nodes.some(n => tags.tagsOf(n).length) && { label: tr('Remove all tags'), icon: 'x', onClick: () => { for (const p of paths) tags.clear(p); done(); } },
      ].filter(Boolean);
    }
    /** A small sheet: a name and one of the seven colours. */
    function newTagDialog(then) {
      app.querySelector('.fx-tagnew')?.remove();
      let color = 'blue';
      const err = h('div.fx-tagnew__err', { role: 'alert' });
      const input = h('input', { type: 'text', maxlength: '30', placeholder: tr('Tag name'), 'aria-label': tr('Tag name'), spellcheck: 'false', autocomplete: 'off',
        onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); make(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } } });
      const dots = tags.COLORS.map(c => h('button.fx-tagnew__c', { type: 'button', style: { background: c.css }, title: c.name, 'aria-label': tr('{name} colour', { name: c.name }),
        'aria-pressed': String(c.id === color), onclick: () => { color = c.id; for (const b of dots) b.setAttribute('aria-pressed', String(b === dots[tags.COLORS.indexOf(c)])); } }));
      const sheet = h('div.fx-tagnew', { role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('New tag') },
        h('div.fx-tagnew__card', h('b', { text: tr('New tag') }), h('div.field', input), h('div.fx-tagnew__colors', dots), err,
          h('div.fx-tagnew__acts',
            h('button.btn.btn--sm', { type: 'button', onclick: () => close() }, h('span', { text: tr('Cancel') })),
            h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => make() }, h('span', { text: tr('Create tag') })))));
      sheet.addEventListener('pointerdown', e => { if (e.target === sheet) close(); });
      function close() { sheet.remove(); focusSel(); }
      function make() {
        const bad = tags.nameProblem(input.value);
        if (bad) { err.textContent = bad; return; }
        const t = tags.create(input.value, color);
        sheet.remove();
        if (t) then?.(t.name);
        paintAll();
      }
      app.appendChild(sheet);
      input.focus();
    }
    /** What a path looks like in the tag list: where it lives. */
    const whereIs = p => folderLabel(vfs.parentPath(p)) + (isTrash(p) ? ' (in the Trash)' : '');
    function openFromTag(path) {
      const n = vfs.node(path);
      if (!n) return;
      if (n.type === 'dir') { go(path); return; }
      if (viewsHere(n)) { reveal(path, n.name); qlOpen(n.name); return; }
      api.openFile(path);
    }
    function paintTagView() {
      const name = S.tag;
      const d = tags.def(name);
      if (!d) { S.tag = null; paintAll(); return; }
      const hits = tags.withTag(d.name);
      S.list = [];
      itemEls = new Map();
      S.renaming = null; S.renameEl = null;
      if (S.tagSel && !hits.some(x => x.path === S.tagSel)) S.tagSel = null;
      api.clear(content);
      content.classList.add('app__content--flush');
      if (!hits.length) {
        content.appendChild(h('div.empty', icon('tag'), h('b', { text: tr('Nothing is tagged {name} yet', { name: d.name }) }),
          h('small', { text: tr('Right-click a file or folder, choose Tags, and pick this one.') })));
      } else {
        const rows = h('div.fx-tagview', { role: 'listbox', 'aria-label': tr('Items tagged {name}', { name: d.name }) });
        for (const { node: n, path } of hits) {
          rows.appendChild(h('div.fx-tagrow' + (S.tagSel === path ? '.is-sel' : ''), {
            role: 'option', tabindex: '0', 'aria-selected': String(S.tagSel === path), dataset: { path },
            'aria-label': `${n.name}, in ${whereIs(path)}`,
            onclick: () => { S.tagSel = path; for (const r of rows.children) { const on = r.dataset.path === path; r.classList.toggle('is-sel', on); r.setAttribute('aria-selected', String(on)); } paintStatus(); },
            ondblclick: () => openFromTag(path),
            onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); openFromTag(path); } },
            oncontextmenu: e => {
              e.preventDefault(); e.stopPropagation();
              api.menu([
                { label: n.type === 'dir' ? tr('Open') : tr('Open'), icon: n.type === 'dir' ? 'folder-open' : 'external-link', onClick: () => openFromTag(path) },
                { label: tr('Show in folder'), icon: 'folder', onClick: () => reveal(path, n.name) },
                { label: tr('Tags'), icon: 'tag', items: tagItems([path]) },
                { label: tr('Remove “{name}” tag', { name: d.name }), icon: 'x', onClick: () => tags.remove(path, d.name) },
              ], e.clientX, e.clientY);
            },
          }, icon(vfs.iconFor(n)), h('span.fx-tagrow__n', { text: n.name }), dotsFor(n), h('small', { text: whereIs(path) })));
        }
        content.appendChild(rows);
      }
      S.painted = null;
      paintStatus();
      paintSide();
      paintBarExtra();
    }
    /* on a phone the places are a sideways strip: keep the current one in view */
    function keepChip() {
      if (!alive || !document.body.classList.contains('is-mobile')) return;
      const on = side.querySelector('.side__item.is-on');
      if (!on || !side.clientWidth) return;
      const l = on.offsetLeft - side.offsetLeft, r = l + on.offsetWidth;
      if (l < side.scrollLeft || r > side.scrollLeft + side.clientWidth) side.scrollLeft = Math.max(0, l - 24);
    }

    const canPersist = !!navigator.storage?.persist;
    const cleanBtn = h('button.fx-keep.fx-cleanup', { type: 'button', onclick: () => cleanUp(),
      title: tr('Empty the Trash, free stored data nothing points at, and see the biggest files') }, icon('sparkles'), h('span', { text: tr('Clean up…') }));
    function paintStorage() {
      const st = S.storage;
      meter.removeAttribute('title');
      if (!st) { api.render(meter, h('small', { text: tr('Measuring…') }), cleanBtn); return; }
      if (st.unsupported) {
        api.render(meter, h('small', { text: tr('This browser doesn’t report how much space StaticOS uses.') }), cleanBtn);
        return;
      }
      const pct = st.quota ? Math.min(100, (st.usage / st.quota) * 100) : 0;
      meter.title = 'Measured by your browser (navigator.storage.estimate): what StaticOS keeps in IndexedDB and caches — '
        + 'imported pictures, videos and music, game projects. Text files live in localStorage, which this number leaves out.';
      api.render(meter,
        h('b', { text: tr('{size} used', { size: bytes(st.usage) }) }),
        h('div.bar', { 'aria-hidden': 'true' }, h('i', { style: { width: `${pct.toFixed(2)}%` } })),
        h('small', { text: tr('of {size} this browser allows · its estimate', { size: bytes(st.quota) }) }),
        st.persisted
          ? h('small.fx-kept', { text: tr('Kept until you clear site data') })
          : canPersist && st.persisted === false
            ? h('button.fx-keep', { type: 'button', onclick: askPersist,
                title: tr('Right now the browser may clear StaticOS files if the device runs low on space. This asks it to keep them.') },
                icon('shield'), h('span', { text: tr('Ask browser to keep files') }))
            : null,
        cleanBtn);
    }

    async function refreshStorage() {
      if (!navigator.storage?.estimate) { S.storage = { unsupported: true }; paintStorage(); paintStatus(); return; }
      try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        let persisted = null;
        try { persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { persisted = null; }
        if (!alive) return;
        S.storage = { usage, quota, persisted };
      } catch (err) {
        if (!alive) return;
        S.storage = { unsupported: true };
      }
      paintStorage();
      paintStatus();
    }
    let storageT = 0;
    const refreshSoon = () => { cancel(storageT); storageT = later(refreshStorage, 700); };

    async function askPersist() {
      let ok = false;
      try { ok = await navigator.storage.persist(); } catch (e) { ok = false; }
      if (!alive) return;
      await refreshStorage();
      say(ok
        ? tr('Your browser will keep StaticOS files until you clear this site’s data.')
        : tr('Your browser said no for now — it decides from how much you use this site. Your files stay, but could be cleared if the device runs very low on space.'),
        ok ? '' : 'bad');
    }

    /* ---------------- navigation ----------- */
    function leaveFolder() {
      S.tag = null; S.tagSel = null; S.smart = null; S.rsel = null; S.deepSel = null;
      if (QL.el) qlClose(false);
      S.renaming = null; S.renameDraft = null;
      S.sel = new Set();
    }
    function go(path, record = true) {
      const n = vfs.node(path);
      if (!n || n.type !== 'dir') return;
      const next = vfs.norm(path);
      const from = S.path;
      if (record && next !== from) { S.back.push(from); S.fwd.length = 0; }
      leaveFolder();
      S.path = next;
      /* going up lands on the folder you came out of, not the top of the list */
      const base = next === '/' ? '/' : `${next}/`;
      if (next !== from && from.startsWith(base)) S.sel = new Set([from.slice(base.length).split('/')[0]]);
      paintAll();
    }
    function goBack() { if (S.back.length) { S.fwd.push(S.path); leaveFolder(); S.path = S.back.pop(); paintAll(); } }
    function goFwd()  { if (S.fwd.length)  { S.back.push(S.path); leaveFolder(); S.path = S.fwd.pop(); paintAll(); } }
    function reveal(p, pick) {
      const t = target(p, pick);
      if (!t) return;
      go(t.dir);
      if (t.sel) { S.sel = new Set([t.sel]); syncSel(); focusSel(); paintStatus(); }
    }

    function paintCrumbs() {
      api.clear(crumbs);
      if (S.smart) {
        const sm = smartInfo(S.smart);
        crumbs.append(h('button', { text: tr('Home'), onclick: () => go(HOME) }), icon('chevron-right'), h('span', { text: tr('Smart folders') }),
          icon('chevron-right'), h('b', { text: sm.label, 'aria-current': 'page' }));
        win.setTitle(sm.label);
        win.state.reopen = { path: HOME, preview: null, select: null };
        btnBack.disabled = !S.back.length; btnFwd.disabled = !S.fwd.length; upBtn.disabled = false;
        return;
      }
      if (S.tag) {
        crumbs.append(h('button', { text: tr('Home'), onclick: () => go(HOME) }), icon('chevron-right'), h('span', { text: tr('Tags') }),
          icon('chevron-right'), h('b', { text: S.tag, 'aria-current': 'page' }));
        win.setTitle(tr('Tag: {name}', { name: S.tag }));
        win.state.reopen = { path: HOME, preview: null, select: null };
        btnBack.disabled = !S.back.length; btnFwd.disabled = !S.fwd.length; upBtn.disabled = false;
        return;
      }
      const rel = inHome(S.path);
      const parts = rel ? S.path.slice(HOME.length).split('/').filter(Boolean) : S.path.split('/').filter(Boolean);
      const base = rel ? HOME : '';
      crumbs.appendChild(parts.length
        ? h('button', { text: rel ? tr('Home') : '/', onclick: () => go(base || '/') })
        : h('b', { text: rel ? tr('Home') : '/', 'aria-current': 'page' }));
      parts.forEach((p, i) => {
        crumbs.appendChild(icon('chevron-right'));
        const full = `${base}/${parts.slice(0, i + 1).join('/')}`;
        crumbs.appendChild(i === parts.length - 1
          ? h('b', { text: p, 'aria-current': 'page' })
          : h('button', { text: p, onclick: () => go(full) }));
      });
      win.setTitle(parts.length ? parts[parts.length - 1] : (rel ? tr('Home') : tr('Files')));
      win.state.reopen = { path: S.path, preview: null, select: null };   /* reopened later: this folder (js/core/reopen.js) */
      btnBack.disabled = !S.back.length;
      btnFwd.disabled = !S.fwd.length;
      upBtn.disabled = S.path === '/';
    }

    let barSig = '';
    function paintBarExtra() {
      const inT = !S.tag && !S.smart && S.path === TRASH;
      const kids = inT ? vfs.ls(TRASH, { hidden: true }).length : 0;
      const pickN = inT ? [...S.sel].filter(nm => vfs.node(at(nm))).length : 0;
      const sig = `${inT}|${kids}|${pickN}|${S.two && !S.tag && !S.smart ? S.sel.size : -1}|${S.p2.path}`;
      if (sig === barSig && barExtra.firstChild !== null) return;
      barSig = sig;
      api.clear(barExtra);
      if (inT && kids) {
        const can = pickN > 0;
        barExtra.appendChild(h('button.btn.btn--sm.fx-putback', { type: 'button', disabled: !can, 'aria-label': tr('Put Back'),
          title: can ? tr('Put the selected items back in the folders they came from') : tr('Select something in the Trash to put it back'),
          onclick: () => putBackSel() }, icon('rotate-ccw'), h('span', { text: tr('Put Back') })));
        barExtra.appendChild(h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: emptyTrash },
          icon('trash'), h('span', { text: tr('Empty Trash') })));
      }
      if (S.two && !S.tag && !S.smart) {
        const can = S.sel.size > 0;
        barExtra.appendChild(h('button.btn.btn--sm.fx-xfer', { type: 'button', disabled: !can, dataset: { xfer: 'copy' }, onclick: () => transfer('main', 'copy'),
          title: tr('Copy the selection into {folder} (the other pane)', { folder: folderLabel(S.p2.path) }) }, icon('copy'), h('span', { text: tr('Copy →') })));
        barExtra.appendChild(h('button.btn.btn--sm.fx-xfer', { type: 'button', disabled: !can, dataset: { xfer: 'move' }, onclick: () => transfer('main', 'move'),
          title: tr('Move the selection into {folder} (the other pane)', { folder: folderLabel(S.p2.path) }) }, icon('arrow-right'), h('span', { text: tr('Move →') })));
      }
    }

    /* ---------------- entries -------------- */
    const entries = () => vfs.ls(S.path, { hidden: S.hidden, sort: S.sort })
      .filter(n => !S.filter || n.name.toLowerCase().includes(S.filter));

    function openNode(n) {
      const p = at(n.name);
      if (n.type === 'dir') go(p);
      /* PDFs and other kept files have no app but this one: look at them right here */
      else if (viewsHere(n)) qlOpen(n.name);
      else api.openFile(p);
    }

    function describe(n) {
      const size = n.type === 'dir' ? plural(n.children.length, 'item') : bytes(n.size);
      const tg = tags.tagsOf(n);
      return `${n.name}, ${typeName(n)}, ${size}${isHollow(n) ? ', ' + tr('no content in this browser') : ''}${tg.length ? ', ' + tr('tagged {tags}', { tags: tg.join(', ') }) : ''}`;
    }

    function itemMenu(e, n) {
      e.preventDefault(); e.stopPropagation();
      /* right-clicking one of several selected items acts on all of them */
      if (S.sel.size > 1 && S.sel.has(n.name)) { manyMenu(e); return; }
      const p = at(n.name);
      select(n.name, { focus: true });
      const isDir = n.type === 'dir';
      const hollow = isHollow(n);
      const handler = isDir ? null : api.appForFile(n);
      const inTrash = isTrash(S.path);
      const moveItems = FAVS.filter(([, rel]) => rel !== 'Trash').map(([label, rel, ic]) => {
        const dest = rel ? `${HOME}/${rel}` : HOME;
        const self = isDir && (dest === p || dest.startsWith(`${p}/`));
        return { label, icon: ic, disabled: dest === S.path || self || !vfs.node(dest), onClick: () => moveTo(n, p, dest) };
      });
      const here = viewsHere(n);
      const zip = archive.isZip(n) && media.isMedia(n);
      const cantWrite = !!importBlock(S.path);
      const origin = inTrash ? ops.originOf(n) : null;
      api.menu([
        inTrash && { label: tr('Put Back'), icon: 'rotate-ccw', disabled: !origin,
          hint: origin ? folderLabel(vfs.parentPath(origin)) : 'folder unknown', onClick: () => putBackSel([n.name]) },
        inTrash && '-',
        { label: isDir ? tr('Open') : n.kind === 'game' ? tr('Play') : zip ? tr('Browse archive') : here ? tr('Open in viewer') : handler ? tr('Open in {name}', { name: handler.name }) : tr('Open'),
          icon: isDir ? 'folder-open' : zip ? 'package' : here ? 'eye' : 'external-link', hint: '↵', onClick: () => openNode(n) },
        !here && { label: tr('Quick Look'), icon: 'eye', hint: 'Space', onClick: () => qlOpen(n.name) },
        mediaKindOf(n) === 'image' && { label: tr('Mark up'), icon: 'edit-3', onClick: () => api.openApp('markup', { path: p }) },
        isPdf(n) && media.isMedia(n) && { label: tr('Mark up, sign or split…'), icon: 'edit-3', onClick: () => api.openApp('pdftools', { path: p }) },
        !isDir && extOf(n.name) === 'epub' && media.isMedia(n) && { label: tr('Read in Books'), icon: 'note', onClick: () => api.openApp('books', { path: p }) },
        mediaKindOf(n) === 'image' && media.isMedia(n) && { label: tr('Picture tools'), icon: 'sparkles', items: [['meme', tr('Make a meme')], ['collage', tr('Add to a collage')], ['convert', tr('Resize or convert')], ['ascii', tr('Turn into ASCII art')], ['gif', tr('Make a GIF')], ['slideshow', 'Add to a slideshow']]
          .map(([tool, label]) => ({ label, onClick: () => api.openApp('picturetools', { tool, path: p }) })) },
        mediaKindOf(n) === 'audio' && media.isMedia(n) && { label: tr('Edit audio…'), icon: 'crop', onClick: () => api.openApp('audioeditor', { path: p }) },
        mediaKindOf(n) === 'video' && media.isMedia(n) && { label: tr('Trim video…'), icon: 'crop', onClick: () => api.openApp('videos', { path: p, trim: true }) },
        !isDir && !media.isMedia(n) && { label: tr('Open in Code'), icon: 'code', onClick: () => api.openFile(p, 'code') },
        zip && '-',
        zip && { label: tr('Extract here'), icon: 'folder-open', disabled: cantWrite, onClick: () => extract(n, true) },
        zip && { label: tr('Extract to “{name}”', { name: stemOf(n.name) }), icon: 'folder', disabled: cantWrite, onClick: () => extract(n, false) },
        '-',
        isDir
          ? { label: tr('Folders can’t be downloaded'), icon: 'download', disabled: true }
          : hollow
            ? { label: tr('Nothing to download (no content)'), icon: 'download', disabled: true }
            : { label: tr('Download'), icon: 'download', onClick: () => download(n) },
        /* Static Drop: straight to a friend's StaticOS, after they accept (js/apps/drop.js) */
        !isDir && !hollow && !inTrash && api.getApp('drop') ? { label: tr('Send with Drop…'), icon: 'send', onClick: () => api.openApp('drop', { send: [p] }) } : null,
        '-',
        { label: tr('Rename…'), icon: 'edit-3', hint: 'F2', onClick: () => startRename(n.name) },
        { label: tr('Duplicate'), icon: 'copy', onClick: () => duplicate(n) },
        { label: tr('Cut'), icon: 'crop', hint: `${MOD}X`, disabled: inTrash, onClick: () => cutSel() },
        { label: tr('Copy'), icon: 'copy', hint: `${MOD}C`, onClick: () => copySel() },
        isDir && ops.clipCount() && { label: tr('Paste into “{name}”', { name: n.name }), icon: 'clipboard', disabled: !!importBlock(p), onClick: () => pasteHere(p) },
        { label: tr('Get Info'), icon: 'info', hint: `${MOD}I`, onClick: () => getInfo([p]) },
        { label: tr('Compress'), icon: 'package', disabled: cantWrite || hollow, onClick: () => compress([n.name]) },
        { label: tr('Move to'), icon: 'folder', items: moveItems },
        { label: tr('Tags'), icon: 'tag', items: tagItems([p]) },
        '-',
        { label: inTrash ? tr('Delete forever…') : tr('Move to Trash'), icon: 'trash', danger: true, hint: 'Del', onClick: () => trashNode(n) },
      ].filter(Boolean), e.clientX, e.clientY);
    }
    /** The menu for several selected items. */
    function manyMenu(e) {
      const names = S.list.filter(x => S.sel.has(x.name)).map(x => x.name);
      const inTrash = isTrash(S.path);
      api.menu([
        inTrash && { label: tr('Put Back'), icon: 'rotate-ccw', onClick: () => putBackSel(names) },
        { label: tr('Rename {count}…', { count: plural(names.length, 'item') }), icon: 'edit-3', hint: 'F2', disabled: inTrash, onClick: () => batchRename(names) },
        { label: tr('Cut'), icon: 'crop', hint: `${MOD}X`, disabled: inTrash, onClick: () => cutSel() },
        { label: tr('Copy'), icon: 'copy', hint: `${MOD}C`, onClick: () => copySel() },
        { label: tr('Get Info'), icon: 'info', hint: `${MOD}I`, onClick: () => getInfo(names.map(at)) },
        '-',
        { label: tr('Compress {count}', { count: plural(names.length, 'item') }), icon: 'package', disabled: !!importBlock(S.path), onClick: () => compress(names) },
        { label: tr('Tags'), icon: 'tag', items: tagItems(names.map(at)) },
        '-',
        { label: inTrash ? tr('Delete {count} forever…', { count: plural(names.length, 'item') }) : tr('Move {count} to Trash', { count: plural(names.length, 'item') }),
          icon: 'trash', danger: true, hint: 'Del', onClick: () => trashMany(names) },
      ].filter(Boolean), e.clientX, e.clientY, { label: tr('{count} selected', { count: plural(names.length, 'item') }) });
    }

    /* ---------------- rename (inline) ------ */
    function nameProblem(next, old) {
      if (next.includes('/')) return 'Names can’t contain “/”.';
      if (next === '.' || next === '..') return tr('“{name}” is reserved.', { name: next });
      if (next.length > 200) return 'That name is too long.';
      if (next !== old && vfs.node(at(next))) return tr('There’s already an item named “{name}” here.', { name: next });
      return null;
    }
    function startRename(name) {
      if (!vfs.node(at(name))) return;
      if (QL.el) qlClose(false);
      S.sel = new Set([name]);
      S.renaming = name; S.renameDraft = null;
      paint();
    }
    function endRename(keepName) {
      S.renaming = null; S.renameDraft = null;
      if (keepName) S.sel = new Set([keepName]);
      paint();
      focusSel();
    }
    function commitRename(old, raw, fromBlur = false) {
      if (S.renaming !== old) return;
      const next = String(raw || '').trim();
      if (!next || next === old) { endRename(old); return; }
      const bad = nameProblem(next, old);
      if (bad) {
        say(bad, 'bad');
        if (fromBlur) { endRename(old); return; }
        const input = S.renameEl;
        if (input) {
          input.classList.add('is-bad');
          input.setAttribute('aria-invalid', 'true');
          input.parentElement?.querySelector('.fx-rename-err')?.remove();
          input.insertAdjacentElement('afterend', h('div.fx-rename-err', { role: 'alert', text: bad }));
        }
        return;
      }
      quiet = true;
      let ok = false;
      try { ok = ops.renameMany(S.path, [[old, next]]).done.length > 0; } finally { quiet = false; }
      if (!ok) say(tr('Couldn’t rename “{old}”.', { old }), 'bad');
      else if (next.startsWith('.') && !S.hidden) say(tr('“{next}” is now a hidden dotfile — right-click › Show dotfiles to see it.', { next }));
      endRename(ok ? next : old);
    }
    function renameInput(n) {
      const name = n.name;
      const input = h('input.fx-rename', {
        type: 'text', value: S.renameDraft ?? name, spellcheck: 'false', autocomplete: 'off',
        'aria-label': tr('New name for {name}', { name }),
        oninput: e => {
          S.renameDraft = e.target.value;
          input.classList.remove('is-bad');
          input.removeAttribute('aria-invalid');
          input.parentElement?.querySelector('.fx-rename-err')?.remove();
        },
        onkeydown: e => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commitRename(name, input.value); }
          else if (e.key === 'Escape') { e.preventDefault(); endRename(name); }
        },
        onblur: () => { if (!S.renameHold && S.renaming === name) commitRename(name, input.value, true); },
        onclick: e => e.stopPropagation(),
        ondblclick: e => e.stopPropagation(),
        oncontextmenu: e => e.stopPropagation(),
      });
      S.renameEl = input;
      return input;
    }

    /* ---------------- file operations ------ */
    function newFolder() {
      let name = 'untitled folder', i = 1;
      while (vfs.node(at(name))) name = `untitled folder ${++i}`;
      if (!vfs.mkdir(at(name))) { say(tr('A folder can’t be made here.'), 'bad'); return; }
      startRename(name);
    }
    function newFile() {
      let name = 'untitled.txt', i = 1;
      while (vfs.node(at(name))) name = `untitled ${++i}.txt`;
      if (!vfs.touch(at(name), '')) { say(tr('A file can’t be made here.'), 'bad'); return; }
      startRename(name);
    }

    function newFromTemplate(id) {
      const why = importBlock(S.path);
      if (why) { say(why, 'bad'); return; }
      const name = ops.newFromTemplate(S.path, id);
      if (!name) { say(tr('A file can’t be made here.'), 'bad'); return; }
      startRename(name);
    }
    function duplicate(n) {
      const r = ops.copyInto([at(n.name)], S.path);
      if (!r.made.length) { say(tr('Couldn’t duplicate “{name}”.', { name: n.name }), 'bad'); paint(); return; }
      const name = r.made[0].name;
      if (r.made[0].hollow) say(tr('“{name}” is empty — the original had no content in this browser to copy.', { name }));
      else say(tr('Duplicated “{name}”.', { name: n.name }), '', undoAct());
      S.sel = new Set([name]);
      paint();
      focusSel();
    }
    function moveTo(n, from, dir) {
      if (vfs.node(`${dir}/${n.name}`)) { say(tr('{folder} already has an item named “{name}”.', { folder: folderLabel(dir), name: n.name }), 'bad'); return; }
      if (n.type === 'dir' && (dir === from || dir.startsWith(`${from}/`))) { say(tr('A folder can’t go inside itself.'), 'bad'); return; }
      if (!ops.moveInto([from], dir).moved.length) { say(tr('Couldn’t move “{name}”.', { name: n.name }), 'bad'); return; }
      say(tr('Moved “{name}” to {folder}.', { name: n.name, folder: folderLabel(dir) }), '', undoAct());
    }
    async function freeSpace() {
      /* never while our own import, compress or extract is mid-save: gc
         could see a stored blob before its file exists and drop it */
      ops.prune();
      if (!S.importing && !zipBusy) { try { await media.gc(); } catch (e) { /* storage unavailable */ } }
      refreshSoon();
    }
    async function trashNode(n) {
      const p = at(n.name);
      const inTrash = isTrash(S.path);
      const ok = await api.confirm(inTrash
        ? { title: tr('Delete “{name}” forever?', { name: n.name }), message: tr('It will be removed from this browser. This can’t be undone.'), ok: tr('Delete forever'), danger: true }
        : { title: tr('Move “{name}” to Trash?', { name: n.name }), message: tr('It stays in the Trash until the Trash is emptied.'), ok: tr('Move to Trash') });
      if (!ok || !alive || !vfs.node(p)) return;
      const idx = S.list.findIndex(x => x.name === n.name);
      if (inTrash) vfs.rm(p); else ops.trash([p]);
      /* keep the keyboard where it was: select whatever took its place */
      const next = S.list[Math.min(Math.max(0, idx), S.list.length - 1)];
      if (next && S.path === vfs.parentPath(p)) select(next.name, { focus: true });
      if (inTrash) { say(tr('Deleted “{name}”.', { name: n.name })); await freeSpace(); }
      else { say(tr('Moved “{name}” to the Trash.', { name: n.name }), '', undoAct()); api.notify({ app: 'Files', icon: 'trash', title: tr('Moved to Trash'), message: n.name }); }
    }
    async function trashMany(names) {
      const dir = S.path;
      const list = names.filter(nm => vfs.node(at(nm)));
      if (list.length < 2) { if (list.length) trashNode(vfs.node(at(list[0]))); return; }
      const inTrash = isTrash(dir);
      const ok = await api.confirm(inTrash
        ? { title: tr('Delete {count} forever?', { count: plural(list.length, 'item') }), message: tr('They will be removed from this browser. This can’t be undone.'), ok: tr('Delete forever'), danger: true }
        : { title: tr('Move {count} to Trash?', { count: plural(list.length, 'item') }), message: tr('They stay in the Trash until the Trash is emptied.'), ok: tr('Move to Trash') });
      if (!ok || !alive) return;
      if (inTrash) for (const nm of list) vfs.rm(`${dir === '/' ? '' : dir}/${nm}`);
      else ops.trash(list.map(nm => `${dir === '/' ? '' : dir}/${nm}`));
      if (S.path === dir) select(null);
      if (inTrash) { say(tr('Deleted {count}.', { count: plural(list.length, 'item') })); await freeSpace(); }
      else { say(tr('Moved {count} to the Trash.', { count: plural(list.length, 'item') }), '', undoAct()); api.notify({ app: 'Files', icon: 'trash', title: tr('Moved to Trash'), message: plural(list.length, 'item') }); }
    }
    async function emptyTrash() {
      const kids = vfs.ls(TRASH, { hidden: true });
      if (!kids.length) return;
      const ok = await api.confirm({ title: tr('Empty the Trash?'),
        message: tr('{count} will be deleted from this browser for good.', { count: plural(kids.length, 'item') }), ok: tr('Empty Trash'), danger: true });
      if (!ok || !alive) return;
      for (const k of kids) vfs.rm(`${TRASH}/${k.name}`);
      api.bus.emit('trash:emptied', { count: kids.length });
      say(tr('Trash emptied — {count} deleted.', { count: plural(kids.length, 'item') }));
      await freeSpace();
    }

    /* The order is remembered for each folder (prefs.filesSortByDir); a folder
       never sorted keeps the default (prefs.filesSort, "name" until changed). */
    const SORTS = ['name', 'size', 'mtime', 'kind'];
    const sortMap = () => { const v = store.get('prefs.filesSortByDir'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
    const defaultSort = () => { const v = store.get('prefs.filesSort', 'name'); return SORTS.includes(v) ? v : 'name'; };
    const sortFor = path => { const v = sortMap()[path]; return SORTS.includes(v) ? v : defaultSort(); };
    function sortMenu(e) {
      const pick = k => () => setSort(k);
      const own = !!sortMap()[S.path] && !S.tag && !S.smart;
      api.menu([
        { label: tr('Sort by name'), icon: S.sort === 'name' ? 'check' : 'type', onClick: pick('name') },
        { label: tr('Sort by size'), icon: S.sort === 'size' ? 'check' : 'bar-chart', onClick: pick('size') },
        { label: tr('Sort by date'), icon: S.sort === 'mtime' ? 'check' : 'clock', onClick: pick('mtime') },
        { label: tr('Sort by kind'), icon: S.sort === 'kind' ? 'check' : 'tag', onClick: pick('kind') },
        own ? '-' : null,
        own ? { label: tr('Use the default order here'), icon: 'refresh', onClick: () => forgetSort() } : null,
      ].filter(Boolean), e.clientX, e.clientY, { label: tr('Order for {folder}', { folder: folderLabel(S.path) }) });
    }
    function setSort(k) {
      S.sort = k;
      if (!S.tag && !S.smart) {
        const m = { ...sortMap(), [S.path]: k };
        const keys = Object.keys(m);
        if (keys.length > 300) delete m[keys[0]];       /* a long-lived profile can't grow this without end */
        store.set('prefs.filesSortByDir', m);
      }
      paint(); focusSel();
    }
    function forgetSort() {
      const m = { ...sortMap() };
      delete m[S.path];
      store.set('prefs.filesSortByDir', m);
      S.sort = defaultSort();
      paint(); focusSel();
    }

    /* ---------------- download ------------- */
    function saveBlob(blob, name) {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name, hidden: true });
      document.body.appendChild(a);
      a.click();
      a.remove();
      const t = setTimeout(() => { downloads.delete(t); URL.revokeObjectURL(url); }, 30000);
      downloads.set(t, url);
    }
    async function download(n) {
      if (n.type === 'dir') { say(tr('Folders can’t be downloaded — open it and download the files inside one at a time.'), 'bad'); return; }
      let blob = null;
      try {
        if (media.isMedia(n)) {
          blob = await media.blobOf(n);
          if (!blob) { say(tr('The bytes for “{name}” are missing from this browser, so there is nothing to download.', { name: n.name }), 'bad'); return; }
        } else if (hasText(n)) {
          blob = new Blob([n.content], { type: `${TEXT_MIME[extOf(n.name)] || 'text/plain'};charset=utf-8` });
        } else if (!n.size) {
          blob = new Blob([], { type: 'text/plain' });
        } else {
          say(tr('“{name}” has no content in this browser, so there is nothing to download.', { name: n.name }), 'bad');
          return;
        }
      } catch (err) {
        say(tr('Couldn’t read “{name}” ({error}).', { name: n.name, error: err?.message || err }), 'bad');
        return;
      }
      if (!alive) return;
      saveBlob(blob, n.name);
      say(tr('Sent “{name}” ({size}) to your browser’s downloads.', { name: n.name, size: bytes(blob.size) }));
    }

    /* ---------------- zip archives ---------- */
    /* Compress and Extract (core/archive.js) report in the same strip as an
       import: a progress bar once a job has run for a moment, then what was
       made and, by name, anything left out and why. */
    let zipBusy = false;
    function zipReport({ working = false, title, sub = '', pct = null, rows = [], problems = false }) {
      cancel(reportT);
      api.render(report,
        h('div.fx-report__head',
          icon(working ? 'package' : problems ? 'alert' : 'check-circle'),
          h('div.fx-report__t', h('b', { text: title }), h('small', { text: sub })),
          h('div.grow'),
          working ? null : h('button.ibtn', { type: 'button', 'aria-label': tr('Dismiss report'), onclick: hideReport }, icon('x'))),
        pct === null ? null : h('div.fx-report__bar', {
          role: 'progressbar', 'aria-label': title, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)),
        }, h('i', { style: { width: `${Math.max(0, Math.min(100, pct)).toFixed(1)}%` } })),
        rows.length ? h('div.fx-report__list', rows.map(r => h('div.fx-report__row.is-no',
          icon('x-circle'), h('b', { text: r.name, title: r.name }), h('small', { text: r.why })))) : null);
      report.classList.toggle('is-working', working);
      report.classList.toggle('has-problems', !working && problems);
      report.hidden = false;
      if (!working && !problems) reportT = later(() => { if (!report.contains(document.activeElement)) hideReport(); }, 7000);
    }
    /** Progress for a job that takes more than a moment; small ones just finish. */
    function progressFor(title) {
      let last = null, shown = false, at0 = 0;
      const draw = () => {
        if (!alive || !last) return;
        at0 = performance.now();
        const pct = last.bytes ? (100 * last.done) / last.bytes : (100 * (last.index - 1)) / Math.max(1, last.total);
        zipReport({ working: true, title, sub: tr('{index} of {total}', { index: last.index, total: last.total }) + (last.name ? ` — ${last.name}` : ''), pct });
      };
      const t = later(() => { shown = true; draw(); }, 300);
      return {
        update(p) { last = p; if (shown && performance.now() - at0 > 90) draw(); },
        end() { cancel(t); },
      };
    }
    async function compress(names) {
      const why = importBlock(S.path);
      if (why) { say(why, 'bad'); return; }
      if (zipBusy) { say(tr('Still working on the last archive — try again when it finishes.'), 'bad'); return; }
      zipBusy = true;
      const dir = S.path;
      const prog = progressFor(names.length === 1 ? tr('Compressing “{name}”', { name: names[0] }) : tr('Compressing {count}', { count: plural(names.length, 'item') }));
      let res = null, err = null;
      try { res = await archive.compress(dir, names, { onProgress: p => prog.update(p) }); }
      catch (e) { err = e; }
      finally { prog.end(); zipBusy = false; }
      if (!alive) return;
      if (err) { zipReport({ title: tr('Nothing was compressed'), sub: err.message || String(err), problems: true }); return; }
      const left = res.skipped.length;
      zipReport({
        title: tr('Made “{name}” — {size}', { name: res.name, size: bytes(res.size) }),
        sub: plural(res.files, 'file') + (res.folders ? ' ' + tr('in {count}', { count: plural(res.folders, 'folder') }) : '')
          + (left ? ' · ' + tr('{count} left out — see why below', { count: plural(left, 'item') }) : ' · ' + tr('saved in this browser')),
        rows: res.skipped, problems: left > 0,
      });
      if (S.path === dir && !S.renaming && vfs.node(res.path)) { select(res.name, { focus: true }); }
      refreshSoon();
    }
    async function extract(n, here) {
      const dir = S.path;
      const why = importBlock(dir);
      if (why) { say(why, 'bad'); return; }
      if (zipBusy) { say(tr('Still working on the last archive — try again when it finishes.'), 'bad'); return; }
      zipBusy = true;
      const prog = progressFor(tr('Extracting “{name}”', { name: n.name }));
      let res = null, err = null;
      quiet = true;                       /* one repaint at the end, not one per file */
      try { res = await archive.extract(at(n.name), { here, onProgress: p => prog.update(p) }); }
      catch (e) { err = e; }
      finally { quiet = false; prog.end(); zipBusy = false; }
      if (!alive) return;
      paint();
      if (err) { zipReport({ title: tr('Couldn’t extract “{name}”', { name: n.name }), sub: err.message || String(err), problems: true }); return; }
      const left = res.skipped.length;
      const where = res.folder ? tr('into “{name}”', { name: vfs.baseName(res.folder) }) : tr('into {folder}', { folder: folderLabel(res.dir) });
      zipReport({
        title: res.files || res.folders ? tr('Extracted {count} {where}', { count: plural(res.files, 'file'), where }) : tr('Nothing was extracted'),
        sub: left ? tr('{count} skipped — see why below', { count: plural(left, 'item') }) : tr('{size} unpacked · saved in this browser', { size: bytes(res.bytes) }),
        rows: res.skipped, problems: left > 0,
      });
      if (res.folder && S.path === dir && !S.renaming) select(vfs.baseName(res.folder), { focus: true });
      refreshSoon();
    }

    /* ---------------- import --------------- */
    function pickFiles() {
      const why = importBlock(S.path);
      if (why) { say(why, 'bad'); return; }
      picker.click();
    }
    let reportT = 0;
    async function importInto(dir, list, folders = []) {
      const files = Array.from(list || []);
      if (!files.length && !folders.length) return;
      if (S.importing) { say(tr('Still importing the last batch — try again when it finishes.'), 'bad'); return; }
      const label = folderLabel(dir);
      S.importing = true;
      let results;
      try {
        results = await fileimport.importFiles(dir, files, {
          folders,
          onProgress: ({ index, total, current, results: sofar }) => {
            if (alive) showReport({ phase: 'working', label, total, index, current, results: sofar });
          },
        });
      } finally { S.importing = false; }
      if (!alive) return;
      showReport({ phase: 'done', label, results });
      const first = results.find(r => r.ok);
      /* show what arrived — unless the person is busy renaming something */
      if (first && dir === S.path && !S.renaming) { S.sel = new Set([first.as]); paint(); if (content.contains(document.activeElement) || document.activeElement === document.body) focusSel(); }
      refreshSoon();
    }

    function showReport({ phase, label, total = 0, index = 0, current = '', results }) {
      cancel(reportT);
      const ok = results.filter(r => r.ok).length;
      const no = results.length - ok;
      const all = phase === 'done' ? results.length : total;
      const title = phase === 'working'
        ? tr('Importing into {label} — {index} of {total}', { label, index, total })
        : !ok ? 'Nothing was imported'
        : no ? tr('Imported {ok} of {all} into {label}', { ok, all, label })
        : tr('Imported {count} into {label}', { count: plural(ok, 'file'), label });
      const session = results.some(r => r.ok && r.session);
      const sub = phase === 'working' ? current
        : no ? tr('{count} couldn’t be kept — see why below.', { count: plural(no, 'file') })
        : session ? 'Kept for this session only — this browser isn’t letting StaticOS store files.'
        : 'Saved in this browser.';
      const rows = results.map(r => h(`div.fx-report__row.${r.ok ? 'is-ok' : 'is-no'}`,
        icon(r.ok ? 'check-circle' : 'x-circle'),
        h('b', { text: r.ok ? r.as : r.name }),
        h('small', { text: r.ok
          ? `${bytes(r.size)} · ${r.kind}${r.as !== r.name ? ` · renamed from “${r.name}”` : ''}${r.note ? ` · ${r.note}` : ''}`
          : r.why })));
      api.render(report,
        h('div.fx-report__head',
          icon(phase === 'working' ? 'upload' : no ? 'alert' : 'check-circle'),
          h('div.fx-report__t', h('b', { text: title }), h('small', { text: sub })),
          h('div.grow'),
          phase === 'done' ? h('button.ibtn', { type: 'button', 'aria-label': tr('Dismiss import report'), onclick: hideReport }, icon('x')) : null),
        rows.length ? h('div.fx-report__list', rows) : null);
      report.classList.toggle('is-working', phase === 'working');
      report.classList.toggle('has-problems', phase === 'done' && (no > 0 || session));
      report.hidden = false;
      /* an all-good report tidies itself away; one with refusals or notes waits to be read */
      const notes = results.some(r => r.ok && r.note);
      if (phase === 'done' && !no && !notes) reportT = later(() => { if (!report.contains(document.activeElement)) hideReport(); }, 7000);
      if (phase === 'done' && no && document.activeElement === document.body) report.querySelector('.ibtn')?.focus({ preventScroll: true });
    }
    function hideReport() {
      cancel(reportT);
      const hadFocus = report.contains(document.activeElement);
      report.hidden = true;
      api.clear(report);
      if (hadFocus) focusSel();
    }

    /* ---------------- drop from the computer */
    let dragDepth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    function showDrop() {
      const why = importBlock(S.path);
      dropTitle.textContent = why ? 'Can’t import here' : `Drop to import into ${folderLabel(S.path)}`;
      dropNote.textContent = why || 'Any file from your computer is kept in this browser. Text up to 200 KB stays editable.';
      drop.classList.toggle('is-blocked', !!why);
      app.classList.add('is-dropping');
    }
    function hideDrop() { dragDepth = 0; app.classList.remove('is-dropping'); }
    const onDragEnter = e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; showDrop(); };
    const onDragOver = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = importBlock(S.path) ? 'none' : 'copy';
      if (!app.classList.contains('is-dropping')) showDrop();
    };
    const onDragLeave = e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hideDrop(); };
    const onDrop = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      hideDrop();
      const { files, folders } = fileimport.fromDrop(e.dataTransfer);
      importInto(S.path, files, folders);
    };
    app.addEventListener('dragenter', onDragEnter);
    app.addEventListener('dragover', onDragOver);
    app.addEventListener('dragleave', onDragLeave);
    app.addEventListener('drop', onDrop);

    /* ---------------- messages ------------- */
    let flashT = 0;
    /** act: { label, run } adds a button after the message (Undo, Show…). */
    function say(msg, tone = '', act = null) {
      cancel(flashT);
      flashEl.textContent = msg;
      flashEl.title = msg;
      if (act) flashEl.append(h('button.fx-flash__act', { type: 'button', onclick: () => { act.run(); flashEl.textContent = ''; status.classList.remove('has-flash'); } }, act.label));
      flashEl.className = `fx-flash${tone ? ` is-${tone}` : ''}`;
      status.classList.add('has-flash');
      if (tone === 'bad' && !win.el.classList.contains('is-active')) api.notify({ app: 'Files', icon: 'alert', title: tr('Files'), message: msg });
      flashT = later(() => { flashEl.textContent = ''; flashEl.title = ''; status.classList.remove('has-flash'); }, tone === 'bad' || act ? 9000 : 5000);
    }

    /* ---------------- thumbnails ----------- */
    let io = null;
    const lazyJobs = new WeakMap();
    function lazy(el, fn) {
      if (typeof IntersectionObserver === 'undefined') { fn(); return; }
      if (!io) {
        io = new IntersectionObserver(ents => {
          for (const e of ents) {
            if (!e.isIntersecting) continue;
            io.unobserve(e.target);
            const f = lazyJobs.get(e.target);
            lazyJobs.delete(e.target);
            f?.();
          }
        }, { root: content, rootMargin: '200px' });
      }
      lazyJobs.set(el, fn);
      io.observe(el);
    }
    function fit(box, w, hgt, mode) {
      if (mode !== 'grid' || !w || !hgt) return;
      const s = Math.min(80 / w, 58 / hgt);
      box.style.width = `${Math.max(16, Math.round(w * s))}px`;
      box.style.height = `${Math.max(16, Math.round(hgt * s))}px`;
    }
    function imageThumb(n, mode) {
      const ref = n.content;
      const box = h(`div.fx-thumb.fx-thumb--${mode}`, { dataset: { kind: 'image' } }, icon('image'));
      const img = h('img', { alt: '', draggable: 'false', decoding: 'async' });
      let retried = false;
      const load = async () => {
        let u = null;
        try { u = await media.urlOf(n); } catch (e) { u = null; }
        if (!alive) return;
        if (u) { thumbUrls.set(ref, u); img.src = u; }
        else markMissing(box, mode, 'picture');
      };
      img.addEventListener('load', () => {
        thumbDims.set(ref, { w: img.naturalWidth, h: img.naturalHeight });
        fit(box, img.naturalWidth, img.naturalHeight, mode);
        box.classList.add('is-ready');
      });
      img.addEventListener('error', () => {
        thumbUrls.delete(ref);
        if (!retried) { retried = true; load(); return; }      /* a revoked object URL: ask again once */
        box.classList.add('is-broken');
        box.title = 'Your browser couldn’t read this picture';
      });
      box.appendChild(img);
      const d = thumbDims.get(ref);
      if (d) fit(box, d.w, d.h, mode);
      const known = thumbUrls.get(ref);
      if (known) img.src = known; else lazy(box, load);
      return box;
    }
    function videoThumb(n) {
      const ref = n.content;
      const box = h('div.fx-thumb.fx-thumb--grid.fx-thumb--video', { dataset: { kind: 'video' } }, icon('film'));
      const play = h('span.fx-thumb__play', { 'aria-hidden': 'true' }, icon('play', { fill: true }));
      const dur = h('span.fx-thumb__dur');
      box.append(play, dur);
      const show = f => {
        if (!f || !alive) return;
        if (Number.isFinite(f.duration) && f.duration > 0) dur.textContent = lengthOf(f.duration);
        if (f.src) {
          box.insertBefore(h('img', { alt: '', src: f.src, draggable: 'false' }), play);
          fit(box, f.w, f.h, 'grid');
          box.classList.add('is-ready');
        } else if (f.error === 'missing') {
          markMissing(box, 'grid', 'video');
        } else {
          box.classList.add('is-broken');
          box.title = 'This browser can’t read a frame from this video — it may not be able to play it';
        }
      };
      const f = frames.get(ref);
      if (f) show(f); else lazy(box, () => frameOf(n, owner).then(show));
      return box;
    }
    const noData = () => h('span.fx-nodata', { text: tr('no data'), title: tr('This file has no content in this browser') });
    /** A media file whose stored bytes are gone (site data cleared): say so on the tile. */
    function markMissing(box, mode, what) {
      box.classList.add('is-broken');
      box.title = tr('The bytes for this {what} are missing from this browser', { what });
      if (mode !== 'grid') return;
      /* a cached result arrives before the thumbnail is placed in its tile */
      queueMicrotask(() => {
        const vis = box.parentElement;
        if (vis && !vis.querySelector('.fx-nodata')) vis.appendChild(h('span.fx-nodata', { text: 'missing', title: box.title }));
      });
    }
    function gridVisual(n) {
      const mk = mediaKindOf(n);
      if (mk === 'image') return h('div.fx-vis', imageThumb(n, 'grid'));
      if (mk === 'video') return h('div.fx-vis', videoThumb(n));
      return h('div.fx-vis',
        h('div.tile__ico', { dataset: { kind: n.type === 'dir' ? 'dir' : n.kind } }, icon(vfs.iconFor(n))),
        isHollow(n) ? noData() : null);
    }

    /* ---------------- paint ---------------- */
    let itemEls = new Map();
    let quiet = false;

    function paintSeg() {
      for (const b of seg.children) {
        const on = b.dataset.view === S.view;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    function itemProps(n, extra) {
      return {
        role: 'option', tabindex: '-1', 'aria-selected': 'false', 'aria-label': describe(n),
        dataset: { name: n.name },
        class: [isHollow(n) && 'is-hollow', S.cutSet?.has(n.name) && 'is-cut'].filter(Boolean).join(' ') || null,
        onclick: e => {
          if (S.renaming === n.name) return;
          const touch = e.pointerType === 'touch';
          /* ⌘/Ctrl-click adds or removes one; Shift-click takes the run from the last one picked */
          if (!touch && (e.metaKey || e.ctrlKey)) { toggleSel(n.name); return; }
          if (!touch && e.shiftKey && S.lead) { rangeSel(n.name); return; }
          select(n.name, { focus: true });
          if (touch) openNode(n);          /* phones: one tap opens, like any file app */
        },
        ondblclick: () => { if (S.renaming !== n.name) openNode(n); },
        oncontextmenu: e => itemMenu(e, n),
        /* anything can be dragged to a folder or the other pane; a picture can also be dragged into a note (js/apps/notes.js reads the path) */
        draggable: S.renaming === n.name ? null : 'true',
        ondragstart: e => {
          try {
            const names = S.sel.has(n.name) ? S.list.filter(x => S.sel.has(x.name)).map(x => x.name) : [n.name];
            e.dataTransfer.setData(FXDRAG, JSON.stringify({ paths: names.map(at) }));
            if (mediaKindOf(n) === 'image') e.dataTransfer.setData('application/x-staticos-path', at(n.name));
            e.dataTransfer.effectAllowed = 'copyMove';
          } catch (err) { /* no drag data */ }
        },
        ...extra,
      };
    }
    /* in the Trash, with the 30-day Trash on (Settings › Storage): how long an item has left */
    const delLabel = n => {
      if (S.path !== TRASH) return null;
      const d = trashx.daysLeft(n);
      return d === null ? null : d === 0 ? 'deletes today' : `deletes in ${plural(d, 'day')}`;
    };
    /* in the Trash: the folder an item came from (what Put Back will do) */
    const fromLabel = n => {
      if (S.path !== TRASH) return null;
      const o = ops.originOf(n);
      return o ? `from ${folderLabel(vfs.parentPath(o))}` : null;
    };
    function tileFor(n) {
      const meta = n.type === 'dir' ? plural(n.children.length, 'item') : bytes(n.size);
      const del = delLabel(n);
      return h('div.tile.fx-item', itemProps(n),
        gridVisual(n),
        S.renaming === n.name ? renameInput(n) : h('div.tile__n', { text: n.name }),
        h('div.tile__m', { text: meta }),
        del ? h('div.tile__m.fx-del', { text: del }) : null,
        fromLabel(n) ? h('div.tile__m.fx-from', { text: fromLabel(n) }) : null,
        dotsFor(n));
    }
    function rowFor(n) {
      const mk = mediaKindOf(n);
      return h('div.row-item.fx-item', itemProps(n),
        h('div.row-item__n', { dataset: { kind: n.type === 'dir' ? 'dir' : n.kind } },
          mk === 'image' ? imageThumb(n, 'list') : icon(vfs.iconFor(n)),
          S.renaming === n.name ? renameInput(n) : h('span', { text: n.name }),
          dotsFor(n),
          delLabel(n) ? h('small.fx-del', { text: delLabel(n) }) : null,
          fromLabel(n) ? h('small.fx-from', { text: fromLabel(n) }) : null,
          isHollow(n) ? noData() : null),
        h('small.fx-c-mod', { text: fmt.fmtAgo(n.mtime), title: fullDate(n.mtime) }),
        h('small.fx-c-size', { text: n.type === 'dir' ? '—' : bytes(n.size) }),
        h('small.fx-c-kind', { text: typeName(n) }));
    }
    function sortHead(key, label, cls) {
      const on = S.sort === key;
      return h(`button.fx-sort${cls ? `.${cls}` : ''}`, {
        type: 'button', 'aria-pressed': on ? 'true' : 'false', title: tr('Sort by {how}', { how: label.toLowerCase() }),
        onclick: () => setSort(key),
      }, h('span', { text: label }), on ? icon(key === 'size' || key === 'mtime' ? 'chevron-down' : 'chevron-up') : null);
    }

    function emptyState() {
      if (S.filter) {
        return h('div.empty', icon('search'), h('b', { text: tr('No matches') }),
          h('small', { text: tr('Nothing in this folder matches “{filter}”.', { filter: S.filter }) }));
      }
      if (S.path === TRASH) {
        return h('div.empty', icon('trash'), h('b', { text: tr('The Trash is empty') }),
          h('small', { text: tr('Things you delete wait here until you empty it.') }));
      }
      const can = !importBlock(S.path);
      return h('div.empty.fx-empty', icon('folder-open'), h('b', { text: tr('This folder is empty') }),
        h('small', { text: can
          ? 'Drop files here from your computer, or import them. Right-click for a new folder or text file.'
          : 'Right-click to create something.' }),
        can ? h('button.btn.btn--sm', { type: 'button', onclick: pickFiles }, icon('upload'), h('span', { text: tr('Import from computer') })) : null);
    }

    function paint() {
      if (!alive) return;
      if (S.tag) { paintTagView(); return; }
      if (S.smart) { paintSmartView(); return; }
      const here = vfs.node(S.path);
      if (!here || here.type !== 'dir') {
        let p = S.path;
        while (p !== '/' && !(vfs.node(p)?.type === 'dir')) p = vfs.parentPath(p);
        S.path = p;
        S.sel = new Set();
        paintCrumbs();
      }
      if (S.sortFor !== S.path) { S.sortFor = S.path; S.sort = sortFor(S.path); }
      S.cutSet = cutNames();
      const list = entries();
      S.list = list;
      if (S.sel.size) { const names = new Set(list.map(n => n.name)); S.sel = new Set([...S.sel].filter(nm => names.has(nm))); }
      if (S.renaming && !list.some(n => n.name === S.renaming)) { S.renaming = null; S.renameDraft = null; }

      const ae = document.activeElement;
      const hadFocus = !!ae && content.contains(ae) && !ae.classList.contains('fx-rename');
      const samePlace = S.painted === S.path;
      const top = content.scrollTop;
      io?.disconnect();
      itemEls = new Map();
      S.renameEl = null;
      S.renameHold = true;
      api.clear(content);
      S.renameHold = false;
      content.classList.toggle('app__content--flush', S.view !== 'grid');
      const deep = S.filter && S.deep ? deepHits() : [];
      S.deepList = deep;
      if (S.deepSel && !deep.some(x => x.path === S.deepSel)) S.deepSel = null;

      if (S.view === 'columns') {
        paintColumns(list);
      } else if (!list.length) {
        if (!deep.length) content.appendChild(emptyState());
      } else if (S.view === 'grid') {
        const grid = h('div.tiles.fx-grid', { role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': `Contents of ${folderLabel(S.path)}` });
        for (const n of list) { const el = tileFor(n); itemEls.set(n.name, el); grid.appendChild(el); }
        content.appendChild(grid);
      } else {
        const body = h('div.fx-rowlist', { role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': `Contents of ${folderLabel(S.path)}` });
        for (const n of list) { const el = rowFor(n); itemEls.set(n.name, el); body.appendChild(el); }
        content.appendChild(h('div.rows',
          h('div.rows__head', sortHead('name', tr('Name')), sortHead('mtime', tr('Modified'), 'fx-c-mod'),
            sortHead('size', tr('Size'), 'fx-c-size'), sortHead('kind', tr('Kind'), 'fx-c-kind')),
          body));
      }
      if (deep.length && S.view !== 'columns') content.appendChild(deepBlock(deep, !list.length));
      content.scrollTop = samePlace ? top : 0;
      S.painted = S.path;
      syncSel();

      if (S.renameEl) {
        const input = S.renameEl;
        input.focus({ preventScroll: true });
        if (S.renameDraft === null) {
          const nm = S.renaming;
          const n = vfs.node(at(nm));
          const dot = nm.lastIndexOf('.');
          input.setSelectionRange(0, n?.type === 'file' && dot > 0 ? dot : nm.length);
          S.renameDraft = nm;
        }
        const el = itemEls.get(S.renaming);
        if (el) revealEl(el);
      } else if (hadFocus) focusSel();

      paintStatus();
      paintSide();
      paintBarExtra();
      paintUndo();
      if (S.two) paintPane2();
      if (QL.el && !(QL.name && itemEls.has(QL.name))) qlClose(false);
    }

    function syncSel() {
      const name = selName();
      let first = true;
      for (const [nm, el] of itemEls) {
        const on = S.sel.has(nm);
        el.classList.toggle('is-sel', on);
        el.setAttribute('aria-selected', on ? 'true' : 'false');
        el.tabIndex = nm === name || (!name && first) ? 0 : -1;
        first = false;
      }
    }
    function toggleSel(name) {
      const next = new Set(S.sel);
      if (next.has(name)) next.delete(name); else next.add(name);
      S.sel = next;
      S.lead = name;
      syncSel();
      itemEls.get(name)?.focus({ preventScroll: true });
      paintStatus();
      if (S.view === 'columns') refreshTail();
    }
    function rangeSel(name) {
      const L = S.list;
      const a = L.findIndex(x => x.name === S.lead), b = L.findIndex(x => x.name === name);
      if (a < 0 || b < 0) { select(name, { focus: true }); return; }
      S.sel = new Set(L.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.name));
      syncSel();
      itemEls.get(name)?.focus({ preventScroll: true });
      paintStatus();
      if (S.view === 'columns') refreshTail();
    }
    function revealEl(el) {
      const r = el.getBoundingClientRect(), c = content.getBoundingClientRect();
      const padTop = S.view === 'list' ? 30 : 6;
      if (r.top < c.top + padTop) content.scrollTop -= (c.top + padTop - r.top);
      else if (r.bottom > c.bottom - 6) content.scrollTop += r.bottom - (c.bottom - 6);
    }
    function focusSel() {
      if (!alive) return;
      const el = itemEls.get(selName()) || itemEls.values().next().value;
      if (el) { el.focus({ preventScroll: true }); revealEl(el); }
    }
    function select(name, { focus = false } = {}) {
      S.sel = new Set(name ? [name] : []);
      S.lead = name || null;
      syncSel();
      const el = name ? itemEls.get(name) : null;
      if (el) { if (focus) el.focus({ preventScroll: true }); revealEl(el); }
      paintStatus();
      if (S.view === 'columns') refreshTail();
      if (QL.el && name) qlRender(name);
    }

    function paintStatus() {
      const list = S.list;
      const many = S.sel.size > 1;
      const n = many ? null : selected();
      const st = S.storage;
      const free = st && !st.unsupported && st.quota ? Math.max(0, st.quota - st.usage) : null;
      const manyBytes = many ? [...S.sel].reduce((a, nm) => a + vfs.size(vfs.node(at(nm))), 0) : 0;
      if (S.path === TRASH || S.two) paintBarExtra();
      api.render(status,
        h('span.dim', { text: plural(S.smart ? (S.resultN || 0) : list.length, 'item') }),
        n || many ? h('span.dim.fx-status__dot', { text: '·' }) : null,
        many ? h('span.dim.fx-status__sel', { text: tr('{n} selected — {size}', { n: S.sel.size, size: bytes(manyBytes) }) }) : null,
        n ? h('span.dim.fx-status__sel', { text: `${n.name} — ${n.type === 'dir'
          ? (n.children.length ? `${plural(n.children.length, 'item')}, ${bytes(vfs.size(n))}` : tr('empty folder'))
          : bytes(n.size)}${isHollow(n) ? ' ' + tr('(no content here)') : ''}` }) : null,
        flashEl,
        h('div.grow'),
        free !== null ? h('span.dim.fx-status__free', {
          text: tr('{size} free · estimate', { size: bytes(free) }),
          title: tr('How much more this browser says StaticOS may store here (navigator.storage.estimate).'),
        }) : null);
    }

    function paintAll() { paintCrumbs(); paint(); }

    /* ---------------- Quick Look ----------- */
    /* The viewer. One sheet over the folder: ← → step through it, Esc
       (or Space) closes, Z or a click on a picture switches between
       fitting it to the sheet and its actual size. */
    const QL = { el: null, name: null, token: 0, media: null, url: null, zoom: false };

    function qlOpen(name) {
      if (!name || !vfs.node(at(name))) return;
      if (S.renaming) return;
      if (!QL.el) {
        QL.el = h('div.fx-ql', { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
        QL.el.addEventListener('pointerdown', e => { if (e.target === QL.el) qlClose(); });
        app.appendChild(QL.el);
      }
      if (!S.sel.has(name)) { S.sel = new Set([name]); syncSel(); paintStatus(); }
      qlRender(name, true);
    }
    function qlRelease() {
      QL.token++;
      const m = QL.media;
      QL.media = null;
      if (m) {
        try { m.pause(); } catch (e) { /* not playing */ }
        m.removeAttribute('src');
        try { m.load(); } catch (e) { /* released */ }
      }
      /* a PDF gets its own typed object URL; let it go with the page that used it */
      if (QL.url) {
        const u = QL.url;
        QL.url = null;
        if (alive) later(() => URL.revokeObjectURL(u), 1000); else URL.revokeObjectURL(u);   /* teardown clears our timers */
      }
    }
    function qlClose(refocus = true) {
      qlRelease();
      QL.el?.remove();
      QL.el = null;
      QL.name = null;
      QL.zoom = false;
      if (refocus) focusSel();
    }
    function qlStep(d) {
      const L = S.list;
      const i = L.findIndex(x => x.name === QL.name);
      const next = L[Math.max(0, Math.min(L.length - 1, i + d))];
      if (next && next.name !== QL.name) { QL.zoom = false; select(next.name, { focus: false }); }
    }
    function qlNote(ic, title, body, kind) {
      return h('div.fx-ql__note',
        h('div.fx-ql__big', { dataset: kind ? { kind } : {} }, icon(ic)),
        h('b', { text: title }),
        body ? h('small', { text: body }) : null);
    }
    /** Picture: fit to the sheet, or actual size (scrolls). */
    function qlZoom(on) {
      const stage = QL.el?.querySelector('.fx-ql__stage');
      const btn = QL.el?.querySelector('.fx-ql__zoom');
      if (!stage || !stage.querySelector('.fx-ql__img')) return;
      QL.zoom = on === undefined ? !QL.zoom : !!on;
      stage.classList.toggle('is-zoomed', QL.zoom);
      if (btn) {
        api.render(btn, icon(QL.zoom ? 'zoom-out' : 'zoom-in'), h('span', { text: QL.zoom ? tr('Fit') : tr('Actual size') }));
        btn.setAttribute('aria-pressed', QL.zoom ? 'true' : 'false');
        btn.title = QL.zoom ? 'Fit to the window (Z)' : 'Show at actual size (Z)';
      }
    }

    /** An archive: its folders and files as they are inside it, read from
        its own table of contents, with what can't be unpacked marked. */
    const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
    async function zipView(n, stage, setFacts, token, extractBtn) {
      let info = null, err = null;
      try { info = await archive.listing(at(n.name)); } catch (e) { err = e; }
      if (token !== QL.token || !QL.el) return;
      api.clear(stage);
      if (err) {
        stage.append(qlNote('alert', 'Files can’t open this archive',
          `${err.message || err} Download it to open it in another program.`, 'archive'));
        setFacts(typeName(n), bytes(n.size));
        return;
      }
      const mkDir = name => ({ name, dirs: new Map(), files: [] });
      const top = mkDir('');
      let files = 0, unpacked = 0, packed = 0, bad = 0;
      for (const e of info.entries) {
        if (e.problem) bad++;
        if (!e.dir) { files++; unpacked += e.size; packed += e.csize; }
        if (!e.parts.length) { top.files.push(e); continue; }      /* an unsafe name: listed, never unpacked */
        let cur = top;
        for (const part of e.dir ? e.parts : e.parts.slice(0, -1)) {
          if (!cur.dirs.has(part)) cur.dirs.set(part, mkDir(part));
          cur = cur.dirs.get(part);
        }
        if (!e.dir) cur.files.push(e);
      }
      let folders = 0;
      const tally = d => { let s = 0; for (const x of d.dirs.values()) { folders++; s += tally(x); } for (const e of d.files) s += e.size; d.bytes = s; return s; };
      tally(top);
      const why = e => (!e.parts.length ? 'unsafe name' : e.encrypted ? 'encrypted' : 'can’t unpack');

      const crumbs = h('nav.fx-zip__crumbs', { 'aria-label': tr('Folder inside the archive') });
      const list = h('div.fx-zip__list', { role: 'list' });
      const show = trail => {
        const d = trail[trail.length - 1];
        api.clear(crumbs);
        trail.forEach((x, i) => {
          if (i) crumbs.append(icon('chevron-right'));
          const label = i ? x.name : n.name;
          crumbs.append(i === trail.length - 1
            ? h('b', { text: label, 'aria-current': 'location' })
            : h('button', { type: 'button', text: label, onclick: () => show(trail.slice(0, i + 1)) }));
        });
        const rows = [];
        for (const x of [...d.dirs.values()].sort((a, b) => byName(a.name, b.name))) {
          rows.push(h('div', { role: 'listitem' }, h('button.fx-zip__row', { type: 'button', onclick: () => show([...trail, x]) },
            h('span.fx-zip__ico', { dataset: { kind: 'dir' } }, icon('folder')), h('span.fx-zip__n', { text: x.name }),
            h('small', { text: plural(x.dirs.size + x.files.length, 'item') }), h('small.fx-zip__sz', { text: bytes(x.bytes) }))));
        }
        for (const e of [...d.files].sort((a, b) => byName(a.name, b.name))) {
          const nm = e.parts.length ? e.parts[e.parts.length - 1] : e.name;
          const kind = vfs.kindOf(nm);
          rows.push(h(`div.fx-zip__row${e.problem ? '.is-bad' : ''}`, { role: 'listitem', title: e.problem || e.name },
            h('span.fx-zip__ico', { dataset: { kind: e.problem ? 'bad' : kind } }, icon(e.problem ? 'alert' : vfs.iconFor({ type: 'file', kind, name: nm }))),
            h('span.fx-zip__n', { text: nm }),
            h('small', { text: e.problem ? why(e) : e.method === 8 ? tr('{size} packed', { size: bytes(e.csize) }) : tr('stored') }),
            h('small.fx-zip__sz', { text: bytes(e.size) })));
        }
        if (!rows.length) rows.push(h('div.fx-zip__empty', { text: tr('Nothing in here.') }));
        api.render(list, rows);
        list.scrollTop = 0;
      };
      stage.classList.add('fx-ql__stage--doc');
      stage.append(h('div.fx-zip', { role: 'region', 'aria-label': tr('Inside {name}', { name: n.name }) }, crumbs, list));
      show([top]);
      setFacts(plural(files, 'file'), folders ? plural(folders, 'folder') : null,
        tr('{size} unpacked', { size: bytes(unpacked) }), tr('{size} packed', { size: bytes(info.size) }), bad ? tr('{n} can’t be extracted', { n: bad }) : null);
      if (files - bad > 0 || folders) {
        const block = importBlock(S.path);
        extractBtn.hidden = false;
        extractBtn.disabled = !!block;
        extractBtn.title = block || `Unpack everything into a folder named “${stemOf(n.name)}”`;
      }
    }

    /** The tag names under the title in Quick Look, from the item's tags now. */
    function paintQlTags() {
      const el = QL.el?.querySelector('.fx-ql__tags');
      const n = QL.name ? vfs.node(at(QL.name)) : null;
      if (!el || !n) return;
      api.render(el, tags.tagsOf(n).map(t => h('span.fx-ql__tagchip', { title: t },
        h('i.fx-dot', { style: { background: tags.cssOf(t) } }), h('span', { text: t }))));
    }

    async function qlRender(name, first = false) {
      if (!QL.el) return;
      const path = at(name);
      const n = vfs.node(path);
      if (!n) { qlClose(); return; }
      const hadFocus = QL.el.contains(document.activeElement);
      qlRelease();
      const token = QL.token;
      QL.name = name;
      const L = S.list;
      const idx = L.findIndex(x => x.name === name);
      const isDir = n.type === 'dir';
      const hollow = isHollow(n);
      const here = viewsHere(n);
      const handler = isDir || here ? null : api.appForFile(n);
      const openLabel = isDir ? tr('Open folder') : n.kind === 'game' ? tr('Play') : handler ? tr('Open in {name}', { name: handler.name }) : tr('Open');

      const stage = h('div.fx-ql__stage');
      const facts = h('div.fx-ql__facts', { 'aria-live': 'polite' });
      const setFacts = (...bits) => {
        const b = bits.filter(Boolean);
        api.render(facts, b.map((t, i) => [i ? h('i', { 'aria-hidden': 'true' }) : null, h('span', { text: t })]));
      };
      const closeBtn = h('button.ibtn', { type: 'button', 'aria-label': tr('Close Quick Look'), title: tr('Close (Esc)'), onclick: () => qlClose() }, icon('x'));
      const prevBtn = h('button.ibtn', { type: 'button', 'aria-label': tr('Previous item'), title: tr('Previous (←)'), disabled: idx <= 0, onclick: () => qlStep(-1) }, icon('chevron-left'));
      const nextBtn = h('button.ibtn', { type: 'button', 'aria-label': tr('Next item'), title: tr('Next (→)'), disabled: idx < 0 || idx >= L.length - 1, onclick: () => qlStep(1) }, icon('chevron-right'));
      const pos = idx >= 0 && L.length > 1 ? h('span.fx-ql__pos', { text: tr('{n} of {total}', { n: idx + 1, total: L.length }), 'aria-label': tr('Item {n} of {total}', { n: idx + 1, total: L.length }) }) : null;
      const zoomBtn = h('button.btn.btn--sm.fx-ql__zoom', { type: 'button', hidden: true, 'aria-pressed': 'false', onclick: () => qlZoom() });
      /* an archive: shown once its contents have been read */
      const extractBtn = archive.isZip(n) && media.isMedia(n)
        ? h('button.btn.btn--sm.fx-ql__extract', { type: 'button', hidden: true, onclick: () => { qlClose(false); extract(n, false); } },
          icon('package'), h('span', { text: tr('Extract all') }))
        : null;
      const meta = `${typeName(n)} · ${isDir ? plural(n.children.length, 'item') : bytes(n.size)} · Modified ${fullDate(n.mtime)}`;
      const head = h('div.fx-ql__head',
        h('div.fx-ql__glyph', { dataset: { kind: isDir ? 'dir' : n.kind } }, icon(vfs.iconFor(n))),
        h('div.fx-ql__t', h('b', { text: n.name, title: path }), h('small', { text: meta }), h('span.fx-ql__tags')),
        h('div.fx-ql__acts',
          h('div.fx-ql__nav', prevBtn, pos, nextBtn),
          zoomBtn,
          extractBtn,
          h('button.btn.btn--sm.fx-ql__tag', { type: 'button', 'aria-haspopup': 'menu', onclick: e => {
            const r = e.currentTarget.getBoundingClientRect();
            api.menu(tagItems([path], paintQlTags), r.left, r.bottom + 4, { label: tr('Tags for {name}', { name: n.name }) });
          } }, icon('tag'), h('span', { text: tr('Tags') })),
          here ? null : h('button.btn.btn--sm', { type: 'button', onclick: () => { qlClose(false); openNode(n); } },
            icon(isDir ? 'folder-open' : 'external-link'), h('span', { text: openLabel })),
          !isDir && !hollow ? h('button.btn.btn--sm', { type: 'button', onclick: () => download(n) },
            icon('download'), h('span', { text: tr('Download') })) : null,
          closeBtn));
      api.render(QL.el, h('div.fx-ql__card', head, stage, facts));
      paintQlTags();
      QL.el.setAttribute('aria-label', `Quick Look: ${n.name}`);
      /* focus the sheet itself (not a button: the Space that opened it is
         still held, and its keyup would press whatever button had focus) */
      if (first || (hadFocus && !QL.el.contains(document.activeElement))) QL.el.focus({ preventScroll: true });

      if (isDir) {
        const count = n.children.length;
        stage.append(qlNote(vfs.iconFor(n), count ? plural(count, 'item') : tr('Empty folder'),
          tr('{size} in total', { size: bytes(vfs.size(n)) }), 'dir'));
        setFacts(tr('Folder'));
        return;
      }

      if (media.isMedia(n)) {
        stage.append(h('div.fx-ql__wait', { text: tr('Loading…') }));
        let url = null;
        let mk = mediaKindOf(n);
        let mime = null;
        try {
          url = await media.urlOf(n);
          if (url && !mk) { mime = await media.mimeOf(n); mk = media.kindOf(mime || ''); }
        } catch (e) { url = null; }
        if (token !== QL.token || !QL.el) return;
        api.clear(stage);
        if (!url) {
          stage.append(qlNote('alert', 'The bytes for this file are missing',
            'StaticOS lists this file, but this browser no longer holds its data — the site’s storage may have been cleared.'));
          setFacts('No data');
          return;
        }
        if (mk === 'image') {
          const img = h('img.fx-ql__img', { alt: n.name, src: url, decoding: 'async', draggable: 'false' });
          img.addEventListener('load', () => {
            if (token !== QL.token) return;
            setFacts(`${img.naturalWidth} × ${img.naturalHeight} pixels`);
            zoomBtn.hidden = false;
            qlZoom(QL.zoom);
          });
          img.addEventListener('click', () => { if (token === QL.token) qlZoom(); });
          img.addEventListener('error', () => {
            if (token !== QL.token) return;
            zoomBtn.hidden = true;
            api.render(stage, qlNote('alert', 'Your browser couldn’t decode this picture',
              'It may be damaged or in a format this browser doesn’t read. Download it to open it elsewhere.'));
          });
          stage.append(img);
          return;
        }
        if (mk === 'video' || mk === 'audio') {
          const el = mk === 'video'
            ? h('video.fx-ql__video', { src: url, controls: true, playsinline: true, preload: 'metadata', 'aria-label': n.name })
            : h('audio.fx-ql__audio', { src: url, controls: true, preload: 'metadata', 'aria-label': n.name });
          QL.media = el;
          el.addEventListener('loadedmetadata', () => {
            if (token !== QL.token) return;
            const len = Number.isFinite(el.duration) && el.duration > 0 ? lengthOf(el.duration) : null;
            setFacts(mk === 'video' && el.videoWidth ? `${el.videoWidth} × ${el.videoHeight} pixels` : null, len ? `${len} long` : null);
          });
          el.addEventListener('error', () => {
            if (token !== QL.token || !QL.el) return;
            const why = mediaErr(el.error);
            QL.media = null;
            el.removeAttribute('src');
            api.render(stage, qlNote('alert', `This browser can’t play this ${mk === 'video' ? 'video' : 'song'}`,
              `${why ? `${why} ` : ''}Download it to play it in another app.`));
          });
          if (mk === 'video') stage.append(el);
          else stage.append(h('div.fx-ql__note.fx-ql__note--audio',
            h('div.fx-ql__big', { dataset: { kind: 'audio' } }, icon('music')),
            h('b', { text: stemOf(n.name) }), el));
          return;
        }
        if (extractBtn) { await zipView(n, stage, setFacts, token, extractBtn); return; }
        if (isPdf(n) || mime === 'application/pdf') {
          let blob = null;
          try { blob = await media.blobOf(n); } catch (e) { blob = null; }
          if (token !== QL.token || !QL.el) return;
          if (!blob) {
            stage.append(qlNote('alert', 'The bytes for this PDF are missing', 'This browser no longer holds its data.'));
            setFacts('No data');
            return;
          }
          /* the browser's PDF viewer only takes a blob it knows is a PDF */
          const typed = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
          const purl = URL.createObjectURL(typed);
          QL.url = purl;
          const head5 = await typed.slice(0, 5).text().catch(() => '');
          if (token !== QL.token || !QL.el) return;
          setFacts('PDF document', bytes(typed.size), head5 !== '%PDF-' ? 'doesn’t start like a PDF — it may not open' : null);
          if (pdfInline()) {
            stage.classList.add('fx-ql__stage--doc');
            stage.append(h('iframe.fx-ql__pdf', { src: `${purl}#navpanes=0`, title: tr('PDF: {name}', { name: n.name }) }));
          } else {
            stage.append(h('div.fx-ql__note',
              h('div.fx-ql__big', { dataset: { kind: 'doc' } }, icon('file-text')),
              h('b', { text: tr('This browser doesn’t show PDFs inside a page') }),
              h('small', { text: tr('Open it in a new tab to read it with the browser’s own viewer, or download it.') }),
              h('button.btn.btn--sm', { type: 'button', onclick: () => { try { window.open(purl, '_blank', 'noopener'); } catch (e) { /* popup blocked */ } } },
                icon('external-link'), h('span', { text: tr('Open in a new tab') }))));
          }
          return;
        }
        if (TEXTISH.has(extOf(n.name))) {
          /* text too big to edit here, kept read-only as a file: show the start of it */
          let text = null, total = n.size || 0;
          try {
            const blob = await media.blobOf(n);
            total = blob ? blob.size : total;
            text = blob ? await blob.slice(0, TEXT_MAX).text() : null;
          } catch (e) { text = null; }
          if (token !== QL.token || !QL.el) return;
          if (text === null) { stage.append(qlNote('alert', 'Your browser couldn’t read this file', 'Download it to open it elsewhere.')); return; }
          stage.append(h('pre.fx-ql__text', { text, tabindex: '0', 'aria-label': tr('Contents of {name}', { name: n.name }) }));
          setFacts('Read-only — kept as a file, not as editable text', total > TEXT_MAX ? `showing the first ${bytes(TEXT_MAX)} of ${bytes(total)}` : bytes(total));
          return;
        }
        stage.append(qlNote(vfs.iconFor(n), 'Files can’t preview this kind of file',
          `It’s kept in this browser (${bytes(n.size)}). Download it to open it in another program.`, n.kind));
        setFacts(typeName(n), mime || null);
        return;
      }

      if (hasText(n)) {
        const text = n.content;
        const LIMIT = 200000;
        const shown = text.length > LIMIT ? text.slice(0, LIMIT) : text;
        stage.append(h('pre.fx-ql__text', { text: shown, tabindex: '0', 'aria-label': tr('Contents of {name}', { name: n.name }) }));
        const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
        setFacts(plural(Math.max(1, lines), 'line'), `${text.length.toLocaleString()} characters`,
          shown !== text ? 'showing the first 200,000' : null);
        return;
      }

      if (hollow) {
        stage.append(qlNote(vfs.iconFor(n), 'This file has no content in this browser',
          `It is listed at ${bytes(n.size)}, but no bytes are stored for it here — there is nothing to show, play or download.`, n.kind));
        setFacts('No data');
        return;
      }
      stage.append(qlNote(vfs.iconFor(n), 'This file is empty', 'It has nothing in it yet (0 bytes).', n.kind));
      setFacts('0 bytes');
    }

    /* ================= Undo, Put Back, Cut / Copy / Paste ================= */
    const undoAct = () => ({ label: tr('Undo'), run: () => doUndo() });
    function paintUndo() {
      const can = ops.canUndo();
      undoBtn.disabled = !can;
      const t = can ? tr('Undo {what}', { what: ops.undoLabel() }) : tr('Nothing to undo');
      undoBtn.dataset.tip = t;
      undoBtn.setAttribute('aria-label', can ? t : 'Undo');
    }
    function doUndo() {
      const r = ops.undo();
      if (!r) { say(tr('Nothing to undo.')); return; }
      const bad = r.problems[0];
      if (bad) say(tr('Couldn’t fully undo “{label}”: “{name}” — {why}.', { label: r.label, name: bad.name, why: bad.why }), 'bad');
      else say(tr('Undid: {label}.', { label: r.label }));
      paintAll();
      refreshSoon();
    }
    function putBackSel(names) {
      const list = (names || [...S.sel]).filter(nm => vfs.node(at(nm)));
      if (!list.length) { say(tr('Select something in the Trash first.'), 'bad'); return; }
      const r = ops.putBack(list);
      if (!r.back.length) { say(tr('Couldn’t put “{name}” back: {why}.', { name: r.problems[0].name, why: r.problems[0].why }), 'bad'); return; }
      const where = new Set(r.back.map(b => b.dir));
      let msg = r.back.length === 1
        ? tr('Put “{name}” back in {folder}', { name: r.back[0].name, folder: folderLabel(r.back[0].dir) }) + (r.back[0].renamed ? ' ' + tr('— the name “{from}” was taken', { from: r.back[0].from }) : '') + '.'
        : tr('Put {count} back', { count: plural(r.back.length, 'item') }) + (where.size === 1 ? ' ' + tr('in {folder}', { folder: folderLabel([...where][0]) }) : '') + '.';
      if (r.problems.length) msg += ' ' + tr('{count} couldn’t go back: {why}.', { count: plural(r.problems.length, 'item'), why: r.problems[0].why });
      say(msg, r.problems.length ? 'bad' : '', undoAct());
      S.sel = new Set(); S.lead = null;
      paint();
      refreshSoon();
    }
    const selPaths = () => S.list.filter(x => S.sel.has(x.name)).map(x => at(x.name));
    function cutSel() {
      const p = selPaths();
      if (!p.length) { say(tr('Select something first, then cut it.')); return; }
      if (isTrash(S.path)) { say(tr('Things in the Trash can’t be cut — use Put Back or Move to.'), 'bad'); return; }
      ops.setClipboard('cut', p);
      say(tr('Cut {count} — open a folder and paste.', { count: plural(p.length, 'item') }));
    }
    function copySel() {
      const p = selPaths();
      if (!p.length) { say(tr('Select something first, then copy it.')); return; }
      ops.setClipboard('copy', p);
      say(tr('Copied {count} — open a folder and paste.', { count: plural(p.length, 'item') }));
    }
    function pasteHere(dir = S.path) {
      const why = importBlock(dir);
      if (why) { say(why, 'bad'); return; }
      if (!ops.clipCount()) { say(tr('Nothing to paste — cut or copy something first.')); return; }
      const mode = ops.clipboard().mode;
      let r;
      quiet = true;
      try { r = ops.paste(dir); } finally { quiet = false; }
      if (!r.names.length) {
        say(r.same ? tr('It is already in this folder.') : r.problems[0] ? tr('Couldn’t paste “{name}”: {why}.', { name: r.problems[0].name, why: r.problems[0].why }) : tr('Nothing was pasted.'), 'bad');
        paint();
        return;
      }
      let msg = mode === 'cut' ? tr('Moved {count} to {folder}.', { count: plural(r.names.length, 'item'), folder: folderLabel(dir) }) : tr('Pasted {count} into {folder}.', { count: plural(r.names.length, 'item'), folder: folderLabel(dir) });
      if (r.hollow) msg += ' ' + (r.hollow === 1 ? tr('1 copy is empty — the original had no content in this browser.') : tr('{n} copies are empty — the original had no content in this browser.', { n: r.hollow }));
      if (r.problems.length) msg += ` “${r.problems[0].name}” couldn’t be pasted: ${r.problems[0].why}.`;
      say(msg, r.problems.length ? 'bad' : '', undoAct());
      if (dir === S.path) { S.sel = new Set(r.names); S.lead = r.names[0]; }
      paint();
      if (dir === S.path) focusSel();
      refreshSoon();
    }
    const cutNames = () => {
      const c = ops.clipboard();
      return c.mode === 'cut' ? new Set(c.paths.filter(p => vfs.parentPath(p) === S.path).map(vfs.baseName)) : new Set();
    };

    /* ================= sheets: Get Info, Go to folder, batch rename, Clean up ================= */
    function openSheet(label, build, { wide = false } = {}) {
      app.querySelector('.fx-tagnew')?.remove();
      const el = h('div.fx-tagnew', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
      const card = h(`div.fx-tagnew__card${wide ? '.fx-sheet--wide' : ''}`);
      const close = () => { el.remove(); if (alive) focusSel(); };
      el.addEventListener('pointerdown', e => { if (e.target === el) close(); });
      el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
      el.appendChild(card);
      build(card, close);
      app.appendChild(el);
      if (!el.contains(document.activeElement)) { el.tabIndex = -1; el.focus({ preventScroll: true }); }   /* Esc has to reach the sheet */
      return { el, card, close };
    }
    const sheetBtn = (text, fn, cls = '') => h(`button.btn.btn--sm${cls}`, { type: 'button', onclick: fn }, h('span', { text }));
    const homeRel = p => (p === HOME ? '~' : p.startsWith(`${HOME}/`) ? `~${p.slice(HOME.length)}` : p);

    function getInfo(paths) {
      const live = paths.filter(p => vfs.node(p));
      if (!live.length) return;
      const nodes = live.map(p => vfs.node(p));
      const one = nodes.length === 1 ? nodes[0] : null;
      const r = ops.info(live);
      const dirs = nodes.filter(n => n.type === 'dir').length;
      const rows = [];
      const row = (k, label, v) => { if (v !== null && v !== undefined && v !== '') rows.push(h('div.fx-info__row', { dataset: { k } }, h('dt', { text: label }), h('dd', { text: v }))); };
      row('kind', tr('Kind'), one ? typeName(one) : `${plural(nodes.length, 'item')}${dirs ? ` (${plural(dirs, 'folder')})` : ''}`);
      row('size', tr('Size'), `${bytes(r.bytes)}${r.bytes >= 1024 ? ` (${r.bytes.toLocaleString()} bytes)` : ''}`);
      if (dirs || nodes.length > 1) row('contains', dirs ? tr('Inside') : tr('Files'), `${plural(r.files, 'file')}${dirs ? `, ${plural(r.folders, 'folder')}` : ''}`);
      if (one) row('where', tr('Where'), live[0] === '/' ? '/' : homeRel(vfs.parentPath(live[0])));
      if (one) row('modified', tr('Modified'), fullDate(one.mtime));
      else if (r.newest) row('modified', 'Latest change', fullDate(new Date(r.newest).toISOString()));
      if (one && tags.tagsOf(one).length) row('tags', 'Tags', tags.tagsOf(one).join(', '));
      if (one && isTrash(live[0]) && ops.originOf(one)) row('from', 'Put Back goes to', homeRel(vfs.parentPath(ops.originOf(one))));
      if (r.hollow) row('nodata', 'No data', `${plural(r.hollow, 'file')} list ${bytes(r.hollowBytes)} but hold nothing in this browser, so that is not counted above.`);
      const name = one ? one.name : plural(nodes.length, 'item');
      openSheet(`Info: ${name}`, (card, close) => {
        card.append(
          h('div.fx-info__head', h('div.fx-ql__glyph', { dataset: { kind: one ? (one.type === 'dir' ? 'dir' : one.kind) : 'dir' } }, icon(one ? vfs.iconFor(one) : 'folder')),
            h('div.fx-info__t', h('b', { text: name, title: name }), h('small', { text: one ? typeName(one) : tr('Selection') }))),
          h('dl.fx-info', rows),
          h('div.fx-tagnew__acts', sheetBtn('Close', close, '.btn--primary')));
      });
    }

    /* Go to folder: a path, absolute or from Home ("~/Documents", "Pictures/Camera") */
    function resolveGo(raw) {
      let t = String(raw || '').trim();
      if (!t) return { err: 'Type a path, like ~/Documents.' };
      if (t === '~') t = HOME;
      else if (t.startsWith('~/')) t = `${HOME}/${t.slice(2)}`;
      const n = vfs.node(t);
      if (!n) return { err: `There is no folder or file at “${t}”.` };
      return { path: vfs.norm(t), node: n };
    }
    function goToFolder() {
      const hint = [];
      vfs.walk(HOME, (n, p) => { if (n.type === 'dir' && !isTrash(p) && !p.slice(HOME.length + 1).split('/').some(x => x.startsWith('.'))) hint.push(homeRel(p)); }, 3);
      openSheet('Go to folder', (card, close) => {
        const err = h('div.fx-tagnew__err', { role: 'alert' });
        const listId = `fxgo-${Math.random().toString(36).slice(2, 7)}`;
        const run = () => {
          const r = resolveGo(input.value);
          if (r.err) { err.textContent = r.err; return; }
          close();
          if (r.node.type === 'dir') go(r.path); else reveal(r.path, r.node.name);
        };
        const input = h('input', { type: 'text', placeholder: tr('~/Documents'), 'aria-label': tr('Folder path'), spellcheck: 'false', autocomplete: 'off', list: listId,
          onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); run(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } } });
        card.append(h('b', { text: tr('Go to folder') }),
          h('div.field', input), h('datalist', { id: listId }, hint.sort().map(v => h('option', { value: v }))), err,
          h('div.fx-tagnew__acts', sheetBtn('Cancel', close), sheetBtn('Go', run, '.btn--primary')));
        later(() => input.focus(), 0);
      });
    }

    /* batch rename: one rule for all, and what every name would become before anything changes */
    function batchRename(names0) {
      const names = S.list.filter(x => names0.includes(x.name)).map(x => x.name);
      if (names.length < 2) { if (names[0]) startRename(names[0]); return; }
      const spec = { mode: 'replace', find: '', replace: '', ignoreCase: false, prefix: '', suffix: '', base: 'File', start: 1, digits: 2, sep: ' ' };
      openSheet(tr('Rename {n} items', { n: names.length }), (card, close) => {
        const fields = h('div.fx-bren__fields');
        const list = h('div.fx-bren__list', { role: 'list', 'aria-label': tr('New names') });
        const sum = h('div.fx-bren__sum', { role: 'status', 'aria-live': 'polite' });
        const goBtn = h('button.btn.btn--sm.btn--primary.fx-bren__go', { type: 'button', disabled: true, onclick: () => apply() }, h('span', { text: tr('Rename') }));
        const modes = [['replace', 'Find and replace'], ['prefix', 'Add text'], ['number', 'Numbers']];
        const tabs = h('div.seg.fx-bren__tabs', { role: 'group', 'aria-label': tr('How to rename') }, modes.map(([m, label]) =>
          h('button', { type: 'button', dataset: { mode: m }, 'aria-pressed': String(spec.mode === m), onclick: () => { spec.mode = m; drawFields(); } }, h('span', { text: label }))));
        const inp = (label, key, o = {}) => {
          const el = h('input', { type: o.type || 'text', value: String(spec[key]), spellcheck: 'false', autocomplete: 'off', 'aria-label': label, min: o.min, max: o.max,
            onkeydown: e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } },
            oninput: e => { spec[key] = e.target.value; plan(); } });
          return h('label.fx-bren__f', h('span', { text: label }), h('div.field', el));
        };
        let rows = [];
        function plan() {
          rows = ops.planRename(S.path, names, spec);
          api.render(list, rows.map(r => h(`div.fx-bren__row.is-${r.state}`, { role: 'listitem', dataset: { state: r.state } },
            h('span.fx-bren__old', { text: r.name, title: r.name }), icon('arrow-right'),
            h('b.fx-bren__new', { text: r.state === 'same' ? tr('(unchanged)') : r.next, title: r.state === 'bad' ? `${r.next} — ${r.why}` : r.next }),
            r.state === 'bad' ? h('small', { text: r.why }) : null)));
          const ok = rows.filter(r => r.state === 'ok').length, bad = rows.filter(r => r.state === 'bad').length;
          sum.textContent = bad ? `${plural(bad, 'name')} can’t be used — fix that to rename.` : ok ? `${ok} of ${rows.length} will change.` : 'Nothing would change yet.';
          sum.classList.toggle('is-bad', bad > 0);
          goBtn.disabled = !ok || bad > 0;
        }
        function drawFields() {
          for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.mode === spec.mode));
          api.render(fields,
            spec.mode === 'replace' ? [inp('Find', 'find'), inp('Replace with', 'replace'),
              h('label.fx-bren__chk', h('input', { type: 'checkbox', checked: spec.ignoreCase, 'aria-label': tr('Ignore case'), onchange: e => { spec.ignoreCase = e.target.checked; plan(); } }), h('span', { text: tr('Ignore case') }))]
              : spec.mode === 'prefix' ? [inp('Text before the name', 'prefix'), inp('Text after the name', 'suffix')]
                : [inp('Name', 'base'), inp('Start at', 'start', { type: 'number', min: '0' }), inp('Digits', 'digits', { type: 'number', min: '1', max: '8' }),
                  h('label.fx-bren__f', h('span', { text: tr('Between') }), h('select.select', { 'aria-label': tr('Separator'), onchange: e => { spec.sep = e.target.value; plan(); } },
                    [[' ', 'a space'], ['-', 'a dash'], ['_', 'an underscore'], ['', 'nothing']].map(([v, t]) => h('option', { value: v, text: t, selected: spec.sep === v }))))]);
          plan();
        }
        function apply() {
          const pairs = rows.filter(r => r.state === 'ok').map(r => [r.name, r.next]);
          if (!pairs.length) return;
          quiet = true;
          let res;
          try { res = ops.renameMany(S.path, pairs); } finally { quiet = false; }
          close();
          S.sel = new Set(res.done.map(d => d[1])); S.lead = res.done[0]?.[1] || null;
          paint();
          say(res.failed.length ? tr('Renamed {n}; “{name}” couldn’t be: {why}.', { n: res.done.length, name: res.failed[0].name, why: res.failed[0].why }) : tr('Renamed {count}.', { count: plural(res.done.length, 'item') }), res.failed.length ? 'bad' : '', undoAct());
        }
        card.append(h('b', { text: tr('Rename {length} items', { length: names.length }) }), tabs, fields, list, sum,
          h('div.fx-tagnew__acts', sheetBtn('Cancel', close), goBtn));
        drawFields();
      }, { wide: true });
    }

    /* Clean up: what can be freed, said with the real numbers */
    function cleanUp() {
      const sh = openSheet('Clean up', (card, close) => {
        const body = h('div.fx-clean');
        let note = '';
        const draw = () => {
          const t = ops.trashInfo();
          const big = ops.largest(5);
          api.render(body,
            h('div.fx-clean__row', { dataset: { k: 'trash' } }, icon('trash'),
              h('div.fx-clean__t', h('b', { text: tr('Trash') }), h('small', { text: t.count ? `${plural(t.count, 'item')} · ${bytes(t.bytes)}` : tr('Empty') })),
              h('button.btn.btn--sm.btn--danger.fx-clean__empty', { type: 'button', disabled: !t.count, onclick: async () => { await emptyTrash(); if (alive && sh.el.isConnected) draw(); } }, h('span', { text: tr('Empty Trash') }))),
            h('div.fx-clean__row', { dataset: { k: 'unused' } }, icon('package'),
              h('div.fx-clean__t', h('b', { text: tr('Unused stored data') }), h('small', { text: note || tr('Pictures, videos and files no file points at any more. This checks now and frees them.') })),
              h('button.btn.btn--sm.fx-clean__free', { type: 'button', onclick: async () => {
                let n = 0;
                try { n = await media.gc(); } catch (e) { note = 'The browser wouldn’t let StaticOS look at its stored data.'; draw(); return; }
                note = n ? `Freed ${plural(n, 'stored item')}.` : 'Nothing unused — everything stored belongs to a file.';
                refreshSoon();
                if (alive && sh.el.isConnected) draw();
              } }, h('span', { text: tr('Free unused data') }))),
            h('div.fx-clean__big', h('b', { text: tr('Biggest files') }),
              big.length ? big.map(x => h('div.fx-clean__file', icon(vfs.iconFor(x.node)), h('span', { text: x.node.name, title: x.path }), h('small', { text: `${bytes(x.bytes)} · ${whereIs(x.path)}` })))
                : h('small', { text: tr('No files with stored bytes yet.') }),
              h('button.btn.btn--sm.fx-clean__all', { type: 'button', onclick: () => { close(); openSmart('largest'); } }, icon('bar-chart'), h('span', { text: tr('See the largest files') }))));
        };
        card.append(h('b', { text: tr('Clean up') }), body, h('div.fx-tagnew__acts', sheetBtn('Done', close, '.btn--primary')));
        draw();
      }, { wide: true });
    }

    /* ================= results: smart folders, Largest files, the storage map ================= */
    const SMART_INFO = [...ops.SMART,
      { id: 'largest', label: tr('Largest files'), icon: 'bar-chart', note: 'The 50 biggest files that hold real bytes, anywhere in Home.' },
      { id: 'map', label: tr('What uses space'), icon: 'pie-chart', note: '' }];
    const smartInfo = id => SMART_INFO.find(x => x.id === id) || SMART_INFO[0];
    function openSmart(id) {
      leaveFolder();
      S.smart = id; S.rsel = null;
      if (id === 'map') S.mapPath = HOME;
      paintAll();
    }
    function resultRow({ node: n, path }, key, size) {
      const sel = () => S[key] === path;
      const row = h(`div.fx-tagrow.fx-result${sel() ? '.is-sel' : ''}`, {
        role: 'option', tabindex: '0', 'aria-selected': String(sel()), dataset: { path },
        'aria-label': `${n.name}, in ${whereIs(path)}`,
        onclick: () => {
          S[key] = path;
          for (const r of row.parentElement.querySelectorAll('.fx-result')) { const on = r.dataset.path === path; r.classList.toggle('is-sel', on); r.setAttribute('aria-selected', String(on)); }
        },
        ondblclick: () => openFromTag(path),
        onkeydown: e => {
          if (e.key === 'Enter') { e.preventDefault(); openFromTag(path); }
          else if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); e.stopPropagation(); getInfo([path]); }
          else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.stopPropagation(); trashPaths([path]); }
        },
        oncontextmenu: e => {
          e.preventDefault(); e.stopPropagation();
          api.menu([
            { label: tr('Open'), icon: n.type === 'dir' ? 'folder-open' : 'external-link', onClick: () => openFromTag(path) },
            { label: tr('Show in folder'), icon: 'folder', onClick: () => reveal(path, n.name) },
            { label: tr('Get Info'), icon: 'info', hint: `${MOD}I`, onClick: () => getInfo([path]) },
            '-',
            { label: isTrash(path) ? tr('Already in the Trash') : tr('Move to Trash'), icon: 'trash', danger: true, disabled: isTrash(path), onClick: () => trashPaths([path]) },
          ], e.clientX, e.clientY);
        },
      }, icon(vfs.iconFor(n)), h('span.fx-tagrow__n', { text: n.name, title: path }), dotsFor(n),
      h('small', { text: size ? `${bytes(size)} · ${whereIs(path)}` : whereIs(path) }),
      h('button.btn.btn--sm.btn--ghost.fx-show', { type: 'button', tabindex: '-1', 'aria-label': tr('Show {name} in its folder', { name: n.name }), onclick: e => { e.stopPropagation(); reveal(path, n.name); } },
        icon('folder'), h('span', { text: tr('Show in folder') })));
      return row;
    }
    function trashPaths(paths) {
      const r = ops.trash(paths);
      if (!r.done) { say(tr('Nothing was moved to the Trash.'), 'bad'); return; }
      say(tr('Moved {what} to the Trash.', { what: r.done === 1 ? `“${r.names[0]}”` : plural(r.done, 'item') }), '', undoAct());
      refreshSoon();
    }
    function paintSmartView() {
      const id = S.smart;
      const sm = smartInfo(id);
      S.list = [];
      itemEls = new Map();
      S.renaming = null; S.renameEl = null;
      api.clear(content);
      content.classList.add('app__content--flush');
      S.resultN = 0;
      if (id === 'map') paintMap();
      else {
        const hits = id === 'largest' ? ops.largest(50) : ops.smart(id);
        S.resultN = hits.length;
        if (S.rsel && !hits.some(x => x.path === S.rsel)) S.rsel = null;
        if (!hits.length) {
          content.appendChild(h('div.empty', icon(sm.icon), h('b', { text: id === 'today' ? tr('Nothing made or changed today') : id === 'week' ? tr('Nothing made or changed this week') : id === 'images' ? tr('No pictures yet') : id === 'documents' ? tr('No documents yet') : tr('No files yet') }),
            h('small', { text: sm.note })));
        } else {
          content.appendChild(h('div.fx-tagview.fx-results', { role: 'listbox', 'aria-label': sm.label },
            h('div.fx-results__note', { text: `${sm.note} ${plural(hits.length, 'file')}.` }),
            hits.map(x => resultRow(x, 'rsel', id === 'largest' ? x.bytes : 0))));
        }
      }
      S.painted = null;
      paintStatus();
      paintSide();
      paintBarExtra();
      paintUndo();
    }

    /* squarified treemap: rectangles for values, as close to square as they get */
    function squarify(items, W, H) {
      const total = items.reduce((a, i) => a + i.v, 0);
      const out = [];
      if (!total) return out;
      const k = (W * H) / total;
      let rest = [...items], x = 0, y = 0, w = W, hh = H;
      const worst = (row, side) => {
        const s = row.reduce((a, i) => a + i.v * k, 0);
        let mx = 0, mn = Infinity;
        for (const i of row) { const a = i.v * k; mx = Math.max(mx, a); mn = Math.min(mn, a); }
        return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
      };
      while (rest.length) {
        const side = Math.min(w, hh);
        const row = [rest[0]];
        let i = 1;
        while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
        const s = row.reduce((a, it) => a + it.v * k, 0);
        if (w >= hh) {
          const cw = s / hh; let cy = y;
          for (const it of row) { const ch = (it.v * k) / cw; out.push({ it, x, y: cy, w: cw, h: ch }); cy += ch; }
          x += cw; w -= cw;
        } else {
          const rh = s / w; let cx = x;
          for (const it of row) { const cw2 = (it.v * k) / rh; out.push({ it, x: cx, y, w: cw2, h: rh }); cx += cw2; }
          y += rh; hh -= rh;
        }
        rest = rest.slice(row.length);
      }
      return out;
    }
    const KIND_HUE = { Pictures: 205, Videos: 275, Music: 330, Documents: 40, Archives: 20, Other: 160 };
    const kindName = nm => {
      const e = vfs.extOf(nm);
      return /^(png|jpe?g|gif|webp|avif|svg|bmp|heic|ico)$/.test(e) ? 'Pictures' : /^(mp4|webm|mov|m4v|mkv|ogv)$/.test(e) ? 'Videos'
        : /^(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/.test(e) ? 'Music' : /^(zip|tar|gz|7z|rar)$/.test(e) ? 'Archives'
          : /^(txt|md|pdf|docx?|odt|rtf|csv|tsv|sheet|xlsx?|pptx?)$/.test(e) ? 'Documents' : 'Other';
    };
    function paintMap() {
      let dir = S.mapPath;
      if (!vfs.node(dir) || vfs.node(dir).type !== 'dir' || !inHome(dir)) dir = S.mapPath = HOME;
      const u = ops.usage(dir);
      S.resultN = u.children.length;
      const parts = dir === HOME ? [] : dir.slice(HOME.length + 1).split('/');
      const trail = h('nav.fx-map__trail', { 'aria-label': tr('Folder shown in the map') },
        parts.length ? h('button', { type: 'button', text: tr('Home'), onclick: () => { S.mapPath = HOME; paint(); } }) : h('b', { text: tr('Home') }),
        parts.map((p, i) => {
          const full = `${HOME}/${parts.slice(0, i + 1).join('/')}`;
          return [icon('chevron-right'), i === parts.length - 1 ? h('b', { text: p, 'aria-current': 'location' }) : h('button', { type: 'button', text: p, onclick: () => { S.mapPath = full; paint(); } })];
        }));
      const items = u.children.filter(c => c.bytes > 0).map(c => ({ ...c, v: c.bytes }));
      const rects = squarify(items, 150, 100);
      const tiles = rects.map(({ it, x, y, w, h: hh }, i) => {
        const big = w > 18 && hh > 16;
        const pct = u.total ? (100 * it.bytes) / u.total : 0;
        const hue = it.dir ? (i * 47 + 210) % 360 : (KIND_HUE[kindName(it.name)] ?? 160);
        return h('button.fx-maptile', {
          type: 'button', dataset: { path: it.path, kind: it.dir ? 'dir' : 'file' },
          style: { left: `${(x / 150) * 100}%`, top: `${y}%`, width: `${(w / 150) * 100}%`, height: `${hh}%`, '--hue': String(hue) },
          'aria-label': `${it.name}, ${bytes(it.bytes)}${it.dir ? `, ${plural(it.files, 'file')}, open it in the map` : ''}`,
          title: `${it.name} — ${bytes(it.bytes)} (${pct.toFixed(1)}%)`,
          onclick: () => { if (it.dir) { S.mapPath = it.path; paint(); } else reveal(it.path, it.name); },
        }, big ? [h('b', { text: it.name }), h('small', { text: bytes(it.bytes) })] : null);
      });
      const kindsBar = u.total ? h('div.fx-map__kinds', { role: 'img', 'aria-label': tr('By kind: {kinds}', { kinds: u.kinds.map(([k, b]) => `${k} ${bytes(b)}`).join(', ') }) },
        u.kinds.map(([k, b]) => h('i', { style: { flex: `${b} 1 0`, '--hue': String(KIND_HUE[k] ?? 160) }, title: `${k}: ${bytes(b)}` }))) : null;
      const legend = u.kinds.length ? h('div.fx-map__legend', u.kinds.map(([k, b]) => h('span', { style: { '--hue': String(KIND_HUE[k] ?? 160) } }, h('i'), h('b', { text: k }), h('small', { text: bytes(b) })))) : null;
      const top = u.children.filter(c => c.bytes > 0).slice(0, 8);
      content.appendChild(h('div.fx-map', { role: 'region', 'aria-label': tr('What uses space') },
        h('div.fx-map__head', trail, h('span.fx-map__total', { text: tr('{size} in this folder', { size: bytes(u.total) }) })),
        u.total ? [h('div.fx-map__board', { role: 'group', 'aria-label': tr('Folders and files, drawn by size') }, tiles), kindsBar, legend,
          h('div.fx-map__list', top.map(c => h('button.fx-map__row', { type: 'button', dataset: { path: c.path }, onclick: () => { if (c.dir) { S.mapPath = c.path; paint(); } else reveal(c.path, c.name); } },
            icon(c.dir ? 'folder' : vfs.iconFor({ type: 'file', kind: vfs.kindOf(c.name), name: c.name })), h('span', { text: c.name }),
            h('div.fx-map__bar', h('i', { style: { width: `${Math.max(1, (100 * c.bytes) / u.total).toFixed(1)}%` } })),
            h('small', { text: `${bytes(c.bytes)} · ${((100 * c.bytes) / u.total).toFixed(1)}%` }))))]
          : h('div.empty', icon('pie-chart'), h('b', { text: tr('Nothing stored in this folder') }), h('small', { text: tr('Pick another folder from the path above.') })),
        h('p.fx-map__note', { text: `Sizes are what StaticOS has stored for each file, added up.${u.hollow ? ` ${plural(u.hollow, 'file')} list ${bytes(u.hollowBytes)} but hold nothing in this browser, so ${u.hollow === 1 ? 'it is' : 'they are'} left out.` : ''}` })));
    }

    /* ================= search inside subfolders ================= */
    function deepHits() {
      const t = S.filter;
      const base = S.path;
      const out = [];
      const tagged = n => Array.isArray(n.tags) && n.tags.some(g => String(g).toLowerCase().includes(t));
      vfs.walk(base, (n, path) => {
        if (path === base || vfs.parentPath(path) === base) return;           /* what is directly here is already listed above */
        if (!isTrash(base) && isTrash(path)) return;
        if (!S.hidden && path.slice(base === '/' ? 1 : base.length + 1).split('/').some(x => x.startsWith('.'))) return;
        if (n.name.toLowerCase().includes(t) || tagged(n)) out.push({ node: n, path });
      });
      const depth = p => p.split('/').length;
      out.sort((a, b) => depth(a.path) - depth(b.path) || a.node.name.localeCompare(b.node.name, undefined, { numeric: true }));
      return out.slice(0, 200);
    }
    function deepBlock(hits, only) {
      return h('div.fx-deep', { role: 'region', 'aria-label': tr('Matches in subfolders') },
        h('div.fx-deep__h', { text: `${only ? `Nothing directly in ${folderLabel(S.path)} matches — ` : ''}${plural(hits.length, 'match', 'matches')} in subfolders${hits.length >= 200 ? ' (the first 200)' : ''}` }),
        h('div.fx-tagview.fx-deep__rows', { role: 'listbox', 'aria-label': tr('Matches in subfolders') }, hits.map(x => resultRow(x, 'deepSel', 0))));
    }

    /* ================= column view ================= */
    /* One column for every folder from Home (or /) down to the one open; the last is
       the live one (selection, keyboard, menus). Pick a folder in an earlier column
       and that is where you are; select a folder in the last and its contents show
       in a column beside it; select a file and its details do. */
    /** Beside the live column: what the selected folder holds, or the selected file's details. */
    function columnTail() {
      const one = S.sel.size === 1 ? selected() : null;
      if (one && one.type === 'dir') {
        const p = at(one.name);
        const peek = h('div.fx-col.fx-peek', { role: 'listbox', 'aria-label': tr('Inside {name}', { name: one.name }), dataset: { dir: p } });
        const kids = vfs.ls(p, { hidden: S.hidden, sort: S.sort });
        for (const c of kids) {
          peek.appendChild(h('button.fx-colitem', { type: 'button', 'aria-label': describe(c), onclick: () => reveal(p, c.name) },
            icon(vfs.iconFor(c)), h('span.fx-colitem__n', { text: c.name }), c.type === 'dir' ? icon('chevron-right') : null));
        }
        if (!kids.length) peek.appendChild(h('div.fx-col__empty', { text: tr('Empty folder') }));
        return peek;
      } else if (one) {
        const mk = mediaKindOf(one);
        return h('div.fx-col.fx-preview', { role: 'region', 'aria-label': tr('Details of {name}', { name: one.name }) },
          h('div.fx-preview__pic', mk === 'image' ? imageThumb(one, 'grid') : mk === 'video' ? videoThumb(one)
            : h('div.tile__ico', { dataset: { kind: one.kind } }, icon(vfs.iconFor(one)))),
          h('b', { text: one.name }),
          h('small', { text: `${typeName(one)} · ${bytes(one.size)}${isHollow(one) ? ' · no content here' : ''}` }),
          h('small', { text: tr('Modified {date}', { date: fullDate(one.mtime) }) }),
          h('div.fx-preview__acts',
            h('button.btn.btn--sm', { type: 'button', onclick: () => openNode(one) }, icon('external-link'), h('span', { text: tr('Open') })),
            h('button.btn.btn--sm', { type: 'button', onclick: () => getInfo([at(one.name)]) }, icon('info'), h('span', { text: tr('Get Info') }))));
      }
      return null;
    }
    function refreshTail() {
      const wrap = content.querySelector('.fx-cols');
      if (!wrap) return;
      wrap.querySelector('.fx-peek,.fx-preview')?.remove();
      const t = columnTail();
      if (t) { wrap.appendChild(t); wrap.scrollLeft = wrap.scrollWidth; }
    }
    function paintColumns(list) {
      const base = inHome(S.path) ? HOME : '/';
      const rel = S.path === base ? [] : S.path.slice(base === '/' ? 1 : base.length + 1).split('/');
      const chain = [base];
      for (const part of rel) chain.push(chain[chain.length - 1] === '/' ? `/${part}` : `${chain[chain.length - 1]}/${part}`);
      const wrap = h('div.fx-cols', { role: 'group', 'aria-label': tr('Folders, one column for each level') });
      const sub = (dir, nm) => (dir === '/' ? '' : dir) + '/' + nm;
      chain.forEach((dir, i) => {
        const last = i === chain.length - 1;
        const col = h(`div.fx-col${last ? '.is-last' : ''}`, { role: 'listbox', 'aria-multiselectable': last ? 'true' : null, 'aria-label': `Contents of ${folderLabel(dir)}`, dataset: { dir } });
        const kids = last ? list : vfs.ls(dir, { hidden: S.hidden, sort: S.sort });
        for (const n of kids) {
          if (last) {
            const el = h('div.fx-colitem.fx-item', itemProps(n),
              icon(vfs.iconFor(n)),
              S.renaming === n.name ? renameInput(n) : h('span.fx-colitem__n', { text: n.name }),
              dotsFor(n),
              n.type === 'dir' ? icon('chevron-right') : null);
            itemEls.set(n.name, el);
            col.appendChild(el);
          } else {
            const p = sub(dir, n.name);
            col.appendChild(h(`button.fx-colitem${p === chain[i + 1] ? '.is-path' : ''}`, { type: 'button', 'aria-label': describe(n),
              onclick: () => { if (n.type === 'dir') go(p); else reveal(p, n.name); } },
            icon(vfs.iconFor(n)), h('span.fx-colitem__n', { text: n.name }), n.type === 'dir' ? icon('chevron-right') : null));
          }
        }
        if (last && !kids.length) col.appendChild(h('div.fx-col__empty', { text: S.filter ? tr('Nothing matches “{filter}”', { filter: S.filter }) : tr('Empty folder') }));
        wrap.appendChild(col);
      });
      const t = columnTail();
      if (t) wrap.appendChild(t);
      content.appendChild(wrap);
      wrap.scrollLeft = wrap.scrollWidth;
    }

    /* ================= two panes ================= */
    /* The second pane is its own folder, kept simple: a list you can open, select in,
       and move or copy to and from the main pane (buttons, or drag; Alt copies). */
    const FXDRAG = 'application/x-staticos-fx';
    function setTwo(on) {
      S.two = on;
      split.classList.toggle('is-two', on);
      pane2.hidden = !on;
      twoBtn.classList.toggle('is-on', on);
      twoBtn.setAttribute('aria-pressed', String(on));
      if (on) {
        /* the first time, it starts in the folder on screen, so there is somewhere to go from */
        if (!S.p2.used) S.p2 = { path: S.tag || S.smart ? HOME : S.path, sel: new Set(), used: true };
        const n = vfs.node(S.p2.path);
        if (!n || n.type !== 'dir') S.p2.path = HOME;
        paintPane2();
      }
      barSig = '';
      paintBarExtra();
    }
    const at2 = nm => `${S.p2.path === '/' ? '' : S.p2.path}/${nm}`;
    function p2go(path) {
      const n = vfs.node(path);
      if (!n || n.type !== 'dir') return;
      S.p2 = { path: vfs.norm(path), sel: new Set(), used: true };
      paintPane2();
      barSig = ''; paintBarExtra();
    }
    function paintPane2() {
      if (!S.two || !alive) return;
      let p = S.p2.path;
      while (p !== '/' && vfs.node(p)?.type !== 'dir') p = vfs.parentPath(p);
      S.p2.path = p;
      const kids = vfs.ls(p, { hidden: S.hidden, sort: 'name' });
      const sel = S.p2.sel instanceof Set ? S.p2.sel : (S.p2.sel = new Set());
      for (const nm of [...sel]) if (!kids.some(k => k.name === nm)) sel.delete(nm);
      const here = p === HOME ? 'Home' : p === '/' ? 'Static Drive' : vfs.baseName(p);
      const go2 = (mode) => transfer('p2', mode);
      api.render(pane2,
        h('div.fx-pane2__bar',
          h('button.ibtn.tip', { type: 'button', 'data-tip': tr('Up one level'), 'aria-label': tr('Up one level in the second pane'), disabled: p === '/', onclick: () => p2go(vfs.parentPath(p)) }, icon('arrow-up')),
          h('b.fx-pane2__path', { text: here, title: p }),
          h('div.grow'),
          h('button.btn.btn--sm.fx-xfer', { type: 'button', disabled: !sel.size, dataset: { xfer: 'copy-left' }, onclick: () => go2('copy'), title: tr('Copy the selection into the main pane’s folder') }, icon('copy'), h('span', { text: tr('← Copy') })),
          h('button.btn.btn--sm.fx-xfer', { type: 'button', disabled: !sel.size, dataset: { xfer: 'move-left' }, onclick: () => go2('move'), title: tr('Move the selection into the main pane’s folder') }, icon('arrow-right'), h('span', { text: tr('← Move') }))),
        h('div.fx-pane2__list', { role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': tr('Contents of {here}, second pane', { here }), dataset: { dir: p } },
          kids.length ? kids.map(n => h(`div.fx-p2row${sel.has(n.name) ? '.is-sel' : ''}`, {
            role: 'option', tabindex: '0', 'aria-selected': String(sel.has(n.name)), dataset: { name: n.name }, draggable: 'true', 'aria-label': describe(n),
            onclick: e => {
              if (e.metaKey || e.ctrlKey) { if (sel.has(n.name)) sel.delete(n.name); else sel.add(n.name); } else { sel.clear(); sel.add(n.name); }
              paintPane2(); barSig = ''; paintBarExtra();
            },
            ondblclick: () => { if (n.type === 'dir') p2go(at2(n.name)); else openFrom(at2(n.name), n); },
            onkeydown: e => {
              if (e.key === 'Enter') { e.preventDefault(); if (n.type === 'dir') p2go(at2(n.name)); else openFrom(at2(n.name), n); }
              else if (e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }
            },
            ondragstart: e => {
              const names = sel.has(n.name) ? [...sel] : [n.name];
              try { e.dataTransfer.setData(FXDRAG, JSON.stringify({ paths: names.map(at2) })); e.dataTransfer.effectAllowed = 'copyMove'; } catch (err) { /* no drag data */ }
            },
          }, icon(vfs.iconFor(n)), h('span.fx-p2row__n', { text: n.name }), dotsFor(n), h('small', { text: n.type === 'dir' ? plural(n.children.length, 'item') : bytes(n.size) })))
            : h('div.fx-col__empty', { text: tr('Empty folder') })));
    }
    function openFrom(path, n) {
      if (viewsHere(n)) { reveal(path, n.name); qlOpen(n.name); } else api.openFile(path);
    }
    /** Copy or move between the panes. from: 'main' → into the second pane's folder; 'p2' → into the main pane's. */
    function transfer(from, mode) {
      const paths = from === 'main' ? selPaths() : [...S.p2.sel].map(at2);
      const dest = from === 'main' ? S.p2.path : S.path;
      sendTo(paths, dest, mode);
    }
    function sendTo(paths, dest, mode) {
      if (!paths.length) { say(tr('Select something first.')); return; }
      const why = importBlock(dest);
      if (why) { say(why, 'bad'); return; }
      quiet = true;
      let r;
      try { r = mode === 'copy' ? ops.copyInto(paths, dest) : ops.moveInto(paths, dest); } finally { quiet = false; }
      const n = mode === 'copy' ? r.made.length : r.moved.length;
      const same = r.problems.filter(x => x.why === 'it is already in that folder').length;
      const bad = r.problems.find(x => x.why !== 'it is already in that folder');
      if (!n) { say(same ? tr('Both panes show the same folder — pick another one in the second pane.') : bad ? tr('Couldn’t {mode} “{name}”: {why}.', { mode, name: bad.name, why: bad.why }) : tr('Nothing was moved.'), 'bad'); paint(); return; }
      say(tr(mode === 'copy' ? 'Copied {count} to {folder}.' : 'Moved {count} to {folder}.', { count: plural(n, 'item'), folder: folderLabel(dest) }) + (bad ? ' ' + tr('“{name}” couldn’t be: {why}.', { name: bad.name, why: bad.why }) : ''), bad ? 'bad' : '', undoAct());
      paint();
      refreshSoon();
    }
    /* dragging items (in either pane) onto a folder, a pane, or the folder on screen */
    const hasFx = e => [...(e.dataTransfer?.types || [])].includes(FXDRAG);
    function dropTarget(e, fallback) {
      const el = e.target.closest?.('.fx-item[data-name],.fx-p2row[data-name]');
      if (el) {
        const dir = el.closest('.fx-pane2') ? S.p2.path : S.path;
        const n = vfs.node(`${dir === '/' ? '' : dir}/${el.dataset.name}`);
        if (n && n.type === 'dir') return `${dir === '/' ? '' : dir}/${n.name}`;
      }
      return fallback;
    }
    const onFxOver = fb => e => { if (!hasFx(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'; };
    const onFxDrop = fb => e => {
      if (!hasFx(e)) return;
      e.preventDefault(); e.stopPropagation();
      let data = null;
      try { data = JSON.parse(e.dataTransfer.getData(FXDRAG)); } catch (err) { data = null; }
      if (!data || !Array.isArray(data.paths)) return;
      sendTo(data.paths, dropTarget(e, fb()), e.altKey ? 'copy' : 'move');
    };
    const mainOver = onFxOver(() => S.path), mainDrop = onFxDrop(() => S.path);
    const p2Over = onFxOver(() => S.p2.path), p2Drop = onFxDrop(() => S.p2.path);
    content.addEventListener('dragover', mainOver);
    content.addEventListener('drop', mainDrop);
    pane2.addEventListener('dragover', p2Over);
    pane2.addEventListener('drop', p2Drop);

    /* ---------------- start ---------------- */
    paintSeg();
    paintStorage();
    paintUndo();
    paintAll();
    if (S.sel.size) { const el = itemEls.get(selName()); if (el) revealEl(el); }
    refreshStorage();
    /* a phone shows only the focused sheet, so the strip has no size until then */
    win.onFocus(() => keepChip());
    const chipRaf = requestAnimationFrame(() => keepChip());

    const offUndo = api.bus.on('fsundo:change', () => { if (alive) paintUndo(); });
    const offClip = api.bus.on('fsclip:change', () => { if (alive && !S.tag && !S.smart) paint(); });
    const offFs = api.bus.on('fs:change', dir => {
      if (quiet || !alive) return;
      if (S.two) paintPane2();
      if (S.tag || S.smart) { paint(); return; }
      if (dir === S.path || dir === vfs.parentPath(S.path) || !vfs.node(S.path)) paint();
      else { paintSide(); paintBarExtra(); }
    });
    const offMedia = api.bus.on('media:change', () => refreshSoon());
    /* opened to look at a file (a PDF from the desktop, Spotlight…): show it */
    const wantsLook = o => !!o && (o.preview === true || (o.file?.type === 'file' && viewsHere(o.file)));
    if (wantsLook(opts) && S.sel.size) qlOpen(selName());
    win.onReopen(o => {
      if (!o?.path) return;
      reveal(o.path, o.select);
      if (wantsLook(o) && S.sel.size) qlOpen(selName());
    });

    /* ---------------- keyboard ------------- */
    let typed = '', typedT = 0;
    function moveSel(fn) {
      const L = S.list;
      if (!L.length) return;
      const cur = L.findIndex(n => S.sel.has(n.name));
      const i = Math.max(0, Math.min(L.length - 1, fn(cur)));
      select(L[i].name, { focus: true });
    }
    function cols() {
      if (S.view !== 'grid') return 1;
      let c = 0, top = null;
      for (const el of itemEls.values()) {
        if (top === null) top = el.offsetTop;
        if (el.offsetTop !== top) break;
        c++;
      }
      return Math.max(1, c);
    }
    const onKey = e => {
      if (!alive || !win.el.classList.contains('is-active')) return;
      const ae = document.activeElement;
      if (ae && ae !== document.body && !win.el.contains(ae)) return;   /* a menu, a dialog, another surface */
      if (app.querySelector('.fx-tagnew')) return;                      /* one of Files' own sheets is open: it has its own keys */
      const tag = ae?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openFilter(); return; }
      if (typing) return;
      const onItem = !!ae?.classList?.contains('fx-item');
      const onMedia = tag === 'VIDEO' || tag === 'AUDIO' || !!ae?.classList?.contains('fx-ql__text');
      const onControl = !onItem && (tag === 'BUTTON' || tag === 'A' || onMedia);

      if (QL.el) {
        if (e.key === 'Escape') { e.preventDefault(); qlClose(); return; }
        if (onMedia) return;
        if ((e.key === ' ' || e.key === 'Enter') && (tag === 'BUTTON' || tag === 'A')) return;   /* the button handles it */
        if (e.key === ' ') { e.preventDefault(); qlClose(); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); qlStep(e.key === 'ArrowUp' && S.view === 'grid' ? -cols() : -1); return; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); qlStep(e.key === 'ArrowDown' && S.view === 'grid' ? cols() : 1); return; }
        if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); qlStep(e.key === 'Home' ? -S.list.length : S.list.length); return; }
        if (!mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); qlZoom(); return; }
        return;
      }
      if (onControl && (e.key === 'Enter' || e.key === ' ')) return;

      const n = selected();
      const k = e.key;
      if (mod && !e.altKey && !e.shiftKey && (k === 'z' || k === 'Z')) { e.preventDefault(); doUndo(); return; }
      if (ae?.closest?.('.fx-pane2')) return;          /* keys in the second pane are its own: they must not act on the main pane's selection */
      if (mod && !e.altKey && !e.shiftKey && (k === 'c' || k === 'C')) { if (S.sel.size) { e.preventDefault(); copySel(); } return; }
      if (mod && !e.altKey && !e.shiftKey && (k === 'x' || k === 'X')) { if (S.sel.size) { e.preventDefault(); cutSel(); } return; }
      if (mod && !e.altKey && !e.shiftKey && (k === 'v' || k === 'V')) { if (!S.tag && !S.smart) { e.preventDefault(); pasteHere(); } return; }
      if (mod && !e.altKey && !e.shiftKey && (k === 'i' || k === 'I')) {
        e.preventDefault();
        if (S.sel.size) getInfo(selPaths()); else if (!S.tag && !S.smart) getInfo([S.path]);
        return;
      }
      if (mod && !e.altKey && e.shiftKey && (k === 'g' || k === 'G')) { e.preventDefault(); goToFolder(); return; }
      const trashSel = () => (S.sel.size > 1 ? trashMany(S.list.filter(x => S.sel.has(x.name)).map(x => x.name)) : trashNode(n));
      if (k === 'Backspace' && mod) { if (n) { e.preventDefault(); trashSel(); } return; }
      if (k === 'Delete') { if (n) { e.preventDefault(); trashSel(); } return; }
      if (mod && !e.shiftKey && !e.altKey && (k === 'a' || k === 'A')) {
        if (S.list.length) {
          e.preventDefault();
          S.sel = new Set(S.list.map(x => x.name));
          if (!S.lead || !S.sel.has(S.lead)) S.lead = S.list[0].name;
          syncSel();
          paintStatus();
        }
        return;
      }
      if (k === 'Backspace' || (mod && k === 'ArrowUp')) { e.preventDefault(); go(vfs.parentPath(S.path)); return; }
      if ((k === 'Enter' && !mod) || (mod && (k === 'ArrowDown' || k === 'o' || k === 'O'))) { if (n) { e.preventDefault(); openNode(n); } return; }
      if (k === ' ') { e.preventDefault(); if (n) qlOpen(n.name); else say(tr('Select something first, then press Space to look inside it.')); return; }
      if (k === 'F2') {
        if (S.sel.size > 1) { e.preventDefault(); batchRename([...S.sel]); }
        else if (n) { e.preventDefault(); startRename(n.name); }
        return;
      }
      if (k === 'Escape') { if (S.filter) { e.preventDefault(); closeFilter(); } else if (n) select(null); return; }
      if (mod || e.altKey) return;
      if (S.view === 'columns' && !S.tag && !S.smart) {
        if (k === 'ArrowRight') { e.preventDefault(); if (n && n.type === 'dir') go(at(n.name)); return; }
        if (k === 'ArrowLeft') { e.preventDefault(); go(vfs.parentPath(S.path)); return; }
      }
      const gridCols = cols();
      if (k === 'ArrowRight' && S.view === 'grid') { e.preventDefault(); moveSel(c => (c < 0 ? 0 : c + 1)); return; }
      if (k === 'ArrowLeft' && S.view === 'grid') { e.preventDefault(); moveSel(c => (c < 0 ? 0 : c - 1)); return; }
      if (k === 'ArrowDown') { e.preventDefault(); moveSel(c => (c < 0 ? 0 : c + gridCols)); return; }
      if (k === 'ArrowUp') { e.preventDefault(); moveSel(c => (c < 0 ? 0 : c - gridCols)); return; }
      if (k === 'Home') { e.preventDefault(); moveSel(() => 0); return; }
      if (k === 'End') { e.preventDefault(); moveSel(() => S.list.length - 1); return; }
      /* type the start of a name to jump to it */
      if (k.length === 1 && k !== ' ' && (onItem || ae === document.body || content.contains(ae))) {
        cancel(typedT);
        typed += k.toLowerCase();
        typedT = later(() => { typed = ''; }, 800);
        const hit = S.list.find(x => x.name.toLowerCase().startsWith(typed));
        if (hit) { e.preventDefault(); select(hit.name, { focus: true }); }
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      alive = false;
      cancelAnimationFrame(chipRaf);
      offFs(); offMedia(); offUndo(); offClip();
      window.removeEventListener('keydown', onKey);
      app.removeEventListener('dragenter', onDragEnter);
      app.removeEventListener('dragover', onDragOver);
      app.removeEventListener('dragleave', onDragLeave);
      app.removeEventListener('drop', onDrop);
      content.removeEventListener('dragover', mainOver);
      content.removeEventListener('drop', mainDrop);
      pane2.removeEventListener('dragover', p2Over);
      pane2.removeEventListener('drop', p2Drop);
      io?.disconnect();
      io = null;
      qlRelease();
      releaseJobs(owner);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const [t, url] of downloads) { clearTimeout(t); URL.revokeObjectURL(url); }
      downloads.clear();
    };
  },
});
