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

if (typeof document !== 'undefined' && !document.getElementById('feat-files-css')) {
  const l = document.createElement('link');
  l.id = 'feat-files-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-files.css';
  document.head.appendChild(l);
}

const FAVS = [
  ['Home',      '',            'home'],
  ['Desktop',   'Desktop',     'monitor'],
  ['Documents', 'Documents',   'file-text'],
  ['Downloads', 'Downloads',   'download'],
  ['Pictures',  'Pictures',    'image'],
  ['Music',     'Music',       'music'],
  ['Videos',    'Videos',      'film'],
  ['Projects',  'Projects',    'folder-git'],
  ['Trash',     'Trash',       'trash'],
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
  jpg: 'JPEG image', jpeg: 'JPEG image', png: 'PNG image', gif: 'GIF image', webp: 'WebP image',
  avif: 'AVIF image', svg: 'SVG image', bmp: 'BMP image',
  mp4: 'MP4 video', webm: 'WebM video', mov: 'QuickTime video', m4v: 'MPEG-4 video',
  mkv: 'Matroska video', ogv: 'Ogg video',
  mp3: 'MP3 audio', wav: 'WAV audio', ogg: 'Ogg audio', oga: 'Ogg audio', m4a: 'AAC audio',
  aac: 'AAC audio', flac: 'FLAC audio', opus: 'Opus audio', weba: 'WebM audio',
  txt: 'Plain text', md: 'Markdown', json: 'JSON', js: 'JavaScript', ts: 'TypeScript',
  css: 'CSS', html: 'HTML page', csv: 'CSV table', tsv: 'TSV table', sheet: 'Static Sheets workbook', log: 'Log', xml: 'XML',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'Settings', conf: 'Settings', sh: 'Shell script',
  py: 'Python', rs: 'Rust', c: 'C source', h: 'C header', pdf: 'PDF document',
  zip: 'ZIP archive', tar: 'Tar archive', gz: 'Gzip archive', '7z': '7-Zip archive', rar: 'RAR archive',
  doc: 'Word document', docx: 'Word document', xls: 'Excel workbook', xlsx: 'Excel workbook',
  ppt: 'PowerPoint deck', pptx: 'PowerPoint deck', odt: 'OpenDocument text', rtf: 'Rich text',
  pages: 'Pages document', key: 'Keynote deck', numbers: 'Numbers sheet', epub: 'EPUB book',
  ttf: 'Font', otf: 'Font', woff: 'Web font', woff2: 'Web font', ico: 'Icon', heic: 'HEIC image',
  dmg: 'Disk image', iso: 'Disk image', exe: 'Windows program', msi: 'Windows installer', apk: 'Android package',
  aethergame: 'Game shortcut', aether: 'Theme', aetherclip: 'Clip',
};

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const bytes = n => (n ? fmtBytes(n) : '0 B');
const byteLen = s => new TextEncoder().encode(s || '').length;
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
  if (n.type === 'dir') return 'Folder';
  const e = extOf(n.name);
  return TYPE_NAMES[e] || (e ? `${e.toUpperCase()} file` : 'File');
}
function fullDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function mediaErr(err) {
  switch (err?.code) {
    case 4: return 'Its format or codec is not supported by this browser.';
    case 3: return 'It could not be decoded.';
    case 2: return 'It could not be loaded.';
    case 1: return 'Loading was stopped.';
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
  keywords: ['finder', 'explorer', 'browse', 'folder', 'import', 'download', 'upload', 'pdf', 'preview', 'viewer', 'drop'],
  desc: 'Browse, import, preview and download your files',
  pinned: true, dock: true,
  /* PDFs open in Files' own viewer (Quick Look); Notes can't show one */
  handles: ['doc'],
  win: { w: 760, h: 520, minW: 470, minH: 300 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Mod+F', 'Filter this folder'],
    ['Left / Right / Up / Down', 'Move the selection'],
    ['Enter / Mod+O / Mod+Down', 'Open the selected item'],
    ['Space', 'Quick Look the selected item (arrows step through, Z zooms)'],
    ['Backspace / Mod+Up', 'Up to the folder above'],
    ['Delete / Mod+Backspace', 'Move to the Trash'],
    ['F2', 'Rename'],
    ['Home / End', 'First / last item'],
    ['Esc', 'Clear the selection or the filter'],
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
      sort: store.get('prefs.filesSort', 'name'),
      hidden: false,
      sel: new Set(),
      lead: null,                    /* the item the keyboard is on (and Shift-click's anchor) */
      filter: '',
      back: [], fwd: [],
      list: [],
      renaming: null, renameDraft: null, renameEl: null, renameHold: false,
      tag: null, tagSel: null,       /* a tag's list is open (sidebar › Tags): its name, and the path picked in it */
      importing: false,
      storage: null,
      painted: null,
    };
    if (!['name', 'size', 'mtime', 'kind'].includes(S.sort)) S.sort = 'name';
    if (S.view !== 'grid' && S.view !== 'list') S.view = 'grid';

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
    const btnBack = h('button.ibtn.tip', { 'data-tip': 'Back', 'aria-label': 'Back',
      onclick: () => goBack() }, icon('chevron-left'));
    const btnFwd  = h('button.ibtn.tip', { 'data-tip': 'Forward', 'aria-label': 'Forward',
      onclick: () => goFwd() }, icon('chevron-right'));
    win.setLead(btnBack, btnFwd);

    const search = h('input', { type: 'search', placeholder: 'Filter…', spellcheck: 'false', 'aria-label': 'Filter this folder by name',
      oninput: e => { S.filter = e.target.value.trim().toLowerCase(); paint(); },
      onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFilter(); } } });
    const searchBox = h('div.field', { style: { width: '150px', height: '24px' } }, icon('search'), search);
    searchBox.classList.add('hidden');
    const filterBtn = h('button.ibtn.tip', { 'data-tip': 'Filter', 'aria-label': 'Filter', 'aria-expanded': 'false',
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
    const seg = h('div.seg', { role: 'group', 'aria-label': 'View' }, segBtn('grid', 'grid', 'Icons'), segBtn('list', 'list', 'List'));
    function setView(mode) { S.view = mode; store.set('prefs.filesView', mode); paintSeg(); paint(); }

    win.setTools(
      filterBtn,
      searchBox,
      h('button.ibtn.tip', { 'data-tip': 'Import from computer', 'aria-label': 'Import from computer', onclick: () => pickFiles() }, icon('upload')),
      h('button.ibtn.tip', { 'data-tip': 'New folder', 'aria-label': 'New folder', onclick: () => newFolder() }, icon('plus')),
      h('button.ibtn.tip', { 'data-tip': 'Sort', 'aria-label': 'Sort', onclick: e => sortMenu(e) }, icon('filter')),
      seg,
    );

    /* ---------------- layout --------------- */
    const side = h('aside.app__side', { 'aria-label': 'Places' });
    const crumbs = h('nav.crumbs', { 'aria-label': 'Folder path' });
    const barExtra = h('div.fx-barx');
    const content = h('div.app__content.fx-content');
    const report = h('div.fx-report', { hidden: true, role: 'region', 'aria-label': 'Import' });
    const status = h('div.app__bar.app__bar--foot.fx-status');
    const flashEl = h('span.fx-flash', { role: 'status', 'aria-live': 'polite' });
    const upBtn = h('button.ibtn.tip', { 'data-tip': 'Up one level', 'aria-label': 'Up one level',
      onclick: () => go(S.tag ? HOME : vfs.parentPath(S.path)) }, icon('arrow-up'));
    const main = h('div.app__main',
      h('div.app__bar', crumbs, h('div.grow'), barExtra, upBtn),
      content, report, status);
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

    content.addEventListener('click', e => { if (!S.tag && !e.target.closest('[data-name]')) select(null); });
    content.addEventListener('contextmenu', e => {
      if (S.tag || e.target.closest('[data-name]')) return;
      e.preventDefault();
      const trashKids = isTrash(S.path) ? vfs.ls(TRASH, { hidden: true }).length : 0;
      api.menu([
        { label: 'New folder', icon: 'plus', onClick: newFolder },
        { label: 'New text file', icon: 'file-text', onClick: newFile },
        { label: 'Import from computer…', icon: 'upload', onClick: pickFiles },
        '-',
        { label: S.view === 'grid' ? 'Show as list' : 'Show as icons', icon: S.view === 'grid' ? 'list' : 'grid',
          onClick: () => setView(S.view === 'grid' ? 'list' : 'grid') },
        { label: S.hidden ? 'Hide dotfiles' : 'Show dotfiles', icon: 'eye',
          onClick: () => { S.hidden = !S.hidden; paint(); } },
        trashKids ? '-' : null,
        trashKids ? { label: 'Empty Trash', icon: 'trash', danger: true, onClick: emptyTrash } : null,
        deskterm.available() ? '-' : null,
        deskterm.available()
          ? { label: 'Open in Terminal', icon: 'terminal', onClick: () => api.openApp('terminal', { cwd: S.path }) }
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
    const driveEl = h('button.side__item', { onclick: () => go('/') }, icon('hard-drive'), h('span', { text: 'Static Drive' }));
    const meter = h('div.side__meter.fx-meter');
    const tagsEl = h('div.side__group.fx-tags', { 'aria-label': 'Tags' });
    side.append(
      h('div.side__group', h('div.side__label', { text: 'Favorites' }), favs.map(f => f.el)),
      tagsEl,
      h('div.side__group.fx-storage', h('div.side__label', { text: 'Storage' }), driveEl, meter));

    function paintSide() {
      for (const f of favs) {
        const on = !S.tag && f.p === S.path;
        f.el.classList.toggle('is-on', on);
        if (on) f.el.setAttribute('aria-current', 'page'); else f.el.removeAttribute('aria-current');
        if (f.rel === 'Trash') {
          const n = vfs.ls(f.p, { hidden: true }).length;
          f.count.textContent = n ? String(n) : '';
          f.el.setAttribute('aria-label', n ? `Trash, ${plural(n, 'item')}` : 'Trash, empty');
        }
      }
      driveEl.classList.toggle('is-on', !S.tag && S.path === '/');
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
        h('div.side__label', { text: 'Tags' }),
        list.map(t => {
          const el = h('button.side__item.fx-tag' + (S.tag && S.tag.toLowerCase() === t.name.toLowerCase() ? '.is-on' : ''), {
            type: 'button', dataset: { tag: t.name }, 'aria-label': `${t.name} tag, ${plural(t.count, 'item')}`,
            'aria-current': S.tag && S.tag.toLowerCase() === t.name.toLowerCase() ? 'page' : null,
            onclick: () => openTag(t.name),
            oncontextmenu: e => {
              e.preventDefault();
              api.menu([
                { label: `Show “${t.name}” items`, icon: 'tag', onClick: () => openTag(t.name) },
                !t.builtin && '-',
                !t.builtin && { label: 'Delete tag', icon: 'trash', danger: true, onClick: () => deleteTag(t) },
              ].filter(Boolean), e.clientX, e.clientY);
            },
          }, h('i.fx-side-dot', { style: { background: t.css } }), h('span', { text: t.name }), h('small', { text: t.count ? String(t.count) : '' }));
          return el;
        }),
        h('button.side__item.fx-tag-new', { type: 'button', 'aria-label': 'New tag', onclick: () => newTagDialog() }, icon('plus'), h('span', { text: 'New tag…' })));
    }
    async function deleteTag(t) {
      const ok = await api.confirm({ title: `Delete the tag “${t.name}”?`, message: 'It is taken off every file and folder. The files themselves stay.', ok: 'Delete tag', danger: true });
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
        { label: 'New tag…', icon: 'plus', onClick: () => newTagDialog(name => { for (const p of paths) tags.add(p, name); done(); }) },
        nodes.some(n => tags.tagsOf(n).length) && { label: 'Remove all tags', icon: 'x', onClick: () => { for (const p of paths) tags.clear(p); done(); } },
      ].filter(Boolean);
    }
    /** A small sheet: a name and one of the seven colours. */
    function newTagDialog(then) {
      app.querySelector('.fx-tagnew')?.remove();
      let color = 'blue';
      const err = h('div.fx-tagnew__err', { role: 'alert' });
      const input = h('input', { type: 'text', maxlength: '30', placeholder: 'Tag name', 'aria-label': 'Tag name', spellcheck: 'false', autocomplete: 'off',
        onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); make(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } } });
      const dots = tags.COLORS.map(c => h('button.fx-tagnew__c', { type: 'button', style: { background: c.css }, title: c.name, 'aria-label': `${c.name} colour`,
        'aria-pressed': String(c.id === color), onclick: () => { color = c.id; for (const b of dots) b.setAttribute('aria-pressed', String(b === dots[tags.COLORS.indexOf(c)])); } }));
      const sheet = h('div.fx-tagnew', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New tag' },
        h('div.fx-tagnew__card', h('b', { text: 'New tag' }), h('div.field', input), h('div.fx-tagnew__colors', dots), err,
          h('div.fx-tagnew__acts',
            h('button.btn.btn--sm', { type: 'button', onclick: () => close() }, h('span', { text: 'Cancel' })),
            h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => make() }, h('span', { text: 'Create tag' })))));
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
        content.appendChild(h('div.empty', icon('tag'), h('b', { text: `Nothing is tagged ${d.name} yet` }),
          h('small', { text: 'Right-click a file or folder, choose Tags, and pick this one.' })));
      } else {
        const rows = h('div.fx-tagview', { role: 'listbox', 'aria-label': `Items tagged ${d.name}` });
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
                { label: n.type === 'dir' ? 'Open' : 'Open', icon: n.type === 'dir' ? 'folder-open' : 'external-link', onClick: () => openFromTag(path) },
                { label: 'Show in folder', icon: 'folder', onClick: () => reveal(path, n.name) },
                { label: 'Tags', icon: 'tag', items: tagItems([path]) },
                { label: `Remove “${d.name}” tag`, icon: 'x', onClick: () => tags.remove(path, d.name) },
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
    function paintStorage() {
      const st = S.storage;
      meter.removeAttribute('title');
      if (!st) { api.render(meter, h('small', { text: 'Measuring…' })); return; }
      if (st.unsupported) {
        api.render(meter, h('small', { text: 'This browser doesn’t report how much space StaticOS uses.' }));
        return;
      }
      const pct = st.quota ? Math.min(100, (st.usage / st.quota) * 100) : 0;
      meter.title = 'Measured by your browser (navigator.storage.estimate): what StaticOS keeps in IndexedDB and caches — '
        + 'imported pictures, videos and music, game projects. Text files live in localStorage, which this number leaves out.';
      api.render(meter,
        h('b', { text: `${bytes(st.usage)} used` }),
        h('div.bar', { 'aria-hidden': 'true' }, h('i', { style: { width: `${pct.toFixed(2)}%` } })),
        h('small', { text: `of ${bytes(st.quota)} this browser allows · its estimate` }),
        st.persisted
          ? h('small.fx-kept', { text: 'Kept until you clear site data' })
          : canPersist && st.persisted === false
            ? h('button.fx-keep', { type: 'button', onclick: askPersist,
                title: 'Right now the browser may clear StaticOS files if the device runs low on space. This asks it to keep them.' },
                icon('shield'), h('span', { text: 'Ask browser to keep files' }))
            : null);
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
        ? 'Your browser will keep StaticOS files until you clear this site’s data.'
        : 'Your browser said no for now — it decides from how much you use this site. Your files stay, but could be cleared if the device runs very low on space.',
        ok ? '' : 'bad');
    }

    /* ---------------- navigation ----------- */
    function leaveFolder() {
      S.tag = null; S.tagSel = null;
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
      if (S.tag) {
        crumbs.append(h('button', { text: 'Home', onclick: () => go(HOME) }), icon('chevron-right'), h('span', { text: 'Tags' }),
          icon('chevron-right'), h('b', { text: S.tag, 'aria-current': 'page' }));
        win.setTitle(`Tag: ${S.tag}`);
        win.state.reopen = { path: HOME, preview: null, select: null };
        btnBack.disabled = !S.back.length; btnFwd.disabled = !S.fwd.length; upBtn.disabled = false;
        return;
      }
      const rel = inHome(S.path);
      const parts = rel ? S.path.slice(HOME.length).split('/').filter(Boolean) : S.path.split('/').filter(Boolean);
      const base = rel ? HOME : '';
      crumbs.appendChild(parts.length
        ? h('button', { text: rel ? 'Home' : '/', onclick: () => go(base || '/') })
        : h('b', { text: rel ? 'Home' : '/', 'aria-current': 'page' }));
      parts.forEach((p, i) => {
        crumbs.appendChild(icon('chevron-right'));
        const full = `${base}/${parts.slice(0, i + 1).join('/')}`;
        crumbs.appendChild(i === parts.length - 1
          ? h('b', { text: p, 'aria-current': 'page' })
          : h('button', { text: p, onclick: () => go(full) }));
      });
      win.setTitle(parts.length ? parts[parts.length - 1] : (rel ? 'Home' : 'Files'));
      win.state.reopen = { path: S.path, preview: null, select: null };   /* reopened later: this folder (js/core/reopen.js) */
      btnBack.disabled = !S.back.length;
      btnFwd.disabled = !S.fwd.length;
      upBtn.disabled = S.path === '/';
    }

    function paintBarExtra() {
      api.clear(barExtra);
      if (S.path === TRASH && vfs.ls(TRASH, { hidden: true }).length) {
        barExtra.appendChild(h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: emptyTrash },
          icon('trash'), h('span', { text: 'Empty Trash' })));
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
      return `${n.name}, ${typeName(n)}, ${size}${isHollow(n) ? ', no content in this browser' : ''}${tg.length ? `, tagged ${tg.join(', ')}` : ''}`;
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
      api.menu([
        { label: isDir ? 'Open' : n.kind === 'game' ? 'Play' : zip ? 'Browse archive' : here ? 'Open in viewer' : handler ? `Open in ${handler.name}` : 'Open',
          icon: isDir ? 'folder-open' : zip ? 'package' : here ? 'eye' : 'external-link', hint: '↵', onClick: () => openNode(n) },
        !here && { label: 'Quick Look', icon: 'eye', hint: 'Space', onClick: () => qlOpen(n.name) },
        mediaKindOf(n) === 'image' && { label: 'Mark up', icon: 'edit-3', onClick: () => api.openApp('markup', { path: p }) },
        mediaKindOf(n) === 'image' && media.isMedia(n) && { label: 'Picture tools', icon: 'sparkles', items: [['meme', 'Make a meme'], ['collage', 'Add to a collage'], ['convert', 'Resize or convert'], ['ascii', 'Turn into ASCII art'], ['gif', 'Make a GIF'], ['slideshow', 'Add to a slideshow']]
          .map(([tool, label]) => ({ label, onClick: () => api.openApp('picturetools', { tool, path: p }) })) },
        mediaKindOf(n) === 'audio' && media.isMedia(n) && { label: 'Edit audio…', icon: 'crop', onClick: () => api.openApp('audioeditor', { path: p }) },
        mediaKindOf(n) === 'video' && media.isMedia(n) && { label: 'Trim video…', icon: 'crop', onClick: () => api.openApp('videos', { path: p, trim: true }) },
        !isDir && !media.isMedia(n) && { label: 'Open in Code', icon: 'code', onClick: () => api.openFile(p, 'code') },
        zip && '-',
        zip && { label: 'Extract here', icon: 'folder-open', disabled: cantWrite, onClick: () => extract(n, true) },
        zip && { label: `Extract to “${stemOf(n.name)}”`, icon: 'folder', disabled: cantWrite, onClick: () => extract(n, false) },
        '-',
        isDir
          ? { label: 'Folders can’t be downloaded', icon: 'download', disabled: true }
          : hollow
            ? { label: 'Nothing to download (no content)', icon: 'download', disabled: true }
            : { label: 'Download', icon: 'download', onClick: () => download(n) },
        /* Static Drop: straight to a friend's StaticOS, after they accept (js/apps/drop.js) */
        !isDir && !hollow && !inTrash && api.getApp('drop') ? { label: 'Send with Drop…', icon: 'send', onClick: () => api.openApp('drop', { send: [p] }) } : null,
        '-',
        { label: 'Rename…', icon: 'edit-3', hint: 'F2', onClick: () => startRename(n.name) },
        { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(n) },
        { label: 'Compress', icon: 'package', disabled: cantWrite || hollow, onClick: () => compress([n.name]) },
        { label: 'Move to', icon: 'folder', items: moveItems },
        { label: 'Tags', icon: 'tag', items: tagItems([p]) },
        '-',
        { label: inTrash ? 'Delete forever…' : 'Move to Trash', icon: 'trash', danger: true, hint: 'Del', onClick: () => trashNode(n) },
      ].filter(Boolean), e.clientX, e.clientY);
    }
    /** The menu for several selected items. */
    function manyMenu(e) {
      const names = S.list.filter(x => S.sel.has(x.name)).map(x => x.name);
      const inTrash = isTrash(S.path);
      api.menu([
        { label: `Compress ${plural(names.length, 'item')}`, icon: 'package', disabled: !!importBlock(S.path), onClick: () => compress(names) },
        { label: 'Tags', icon: 'tag', items: tagItems(names.map(at)) },
        '-',
        { label: inTrash ? `Delete ${plural(names.length, 'item')} forever…` : `Move ${plural(names.length, 'item')} to Trash`,
          icon: 'trash', danger: true, hint: 'Del', onClick: () => trashMany(names) },
      ], e.clientX, e.clientY, { label: `${plural(names.length, 'item')} selected` });
    }

    /* ---------------- rename (inline) ------ */
    function nameProblem(next, old) {
      if (next.includes('/')) return 'Names can’t contain “/”.';
      if (next === '.' || next === '..') return `“${next}” is reserved.`;
      if (next.length > 200) return 'That name is too long.';
      if (next !== old && vfs.node(at(next))) return `There’s already an item named “${next}” here.`;
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
      const ok = vfs.rename(at(old), next);
      if (!ok) say(`Couldn’t rename “${old}”.`, 'bad');
      else if (next.startsWith('.') && !S.hidden) say(`“${next}” is now a hidden dotfile — right-click › Show dotfiles to see it.`);
      endRename(ok ? next : old);
    }
    function renameInput(n) {
      const name = n.name;
      const input = h('input.fx-rename', {
        type: 'text', value: S.renameDraft ?? name, spellcheck: 'false', autocomplete: 'off',
        'aria-label': `New name for ${name}`,
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
    /** name, or "name 2", "name 3"… — whichever is free in dir. */
    function uniqueIn(dir, name) {
      const inDir = x => `${dir === '/' ? '' : dir}/${x}`;
      if (!vfs.node(inDir(name))) return name;
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let i = 2;
      while (vfs.node(inDir(`${stem} ${i}${ext}`))) i++;
      return `${stem} ${i}${ext}`;
    }
    const uniqueHere = name => uniqueIn(S.path, name);
    function newFolder() {
      let name = 'untitled folder', i = 1;
      while (vfs.node(at(name))) name = `untitled folder ${++i}`;
      if (!vfs.mkdir(at(name))) { say('A folder can’t be made here.', 'bad'); return; }
      startRename(name);
    }
    function newFile() {
      let name = 'untitled.txt', i = 1;
      while (vfs.node(at(name))) name = `untitled ${++i}.txt`;
      if (!vfs.touch(at(name), '')) { say('A file can’t be made here.', 'bad'); return; }
      startRename(name);
    }

    /* A copy points at the same bytes (media blobs never change, and
       media.gc keeps a blob while any file still points at it), and its
       size is what it really holds: the media size, or the text's bytes. */
    function cloneInto(n, dest) {
      if (n.type === 'dir') {
        const d = vfs.mkdir(dest);
        if (!d) return null;
        for (const c of [...n.children]) cloneInto(c, `${dest}/${c.name}`);
        return d;
      }
      const f = vfs.touch(dest, typeof n.content === 'string' ? n.content : '');
      if (!f) return null;
      f.size = media.isMedia(n) ? (n.size || 0) : byteLen(f.content);
      return f;
    }
    function duplicate(n) {
      const dot = n.type === 'file' ? n.name.lastIndexOf('.') : -1;
      const want = dot > 0 ? `${n.name.slice(0, dot)} copy${n.name.slice(dot)}` : `${n.name} copy`;
      const name = uniqueHere(want);
      quiet = true;
      let made = null;
      try { made = cloneInto(n, at(name)); } finally { quiet = false; }
      if (!made) { say(`Couldn’t duplicate “${n.name}”.`, 'bad'); paint(); return; }
      if (isHollow(n)) say(`“${name}” is empty — the original had no content in this browser to copy.`);
      S.sel = new Set([name]);
      paint();
      focusSel();
    }
    function moveTo(n, from, dir) {
      if (vfs.node(`${dir}/${n.name}`)) { say(`${folderLabel(dir)} already has an item named “${n.name}”.`, 'bad'); return; }
      if (n.type === 'dir' && (dir === from || dir.startsWith(`${from}/`))) { say('A folder can’t go inside itself.', 'bad'); return; }
      if (!vfs.mv(from, dir)) { say(`Couldn’t move “${n.name}”.`, 'bad'); return; }
      say(`Moved “${n.name}” to ${folderLabel(dir)}.`);
    }
    async function freeSpace() {
      /* never while our own import, compress or extract is mid-save: gc
         could see a stored blob before its file exists and drop it */
      if (!S.importing && !zipBusy) { try { await media.gc(); } catch (e) { /* storage unavailable */ } }
      refreshSoon();
    }
    async function trashNode(n) {
      const p = at(n.name);
      const inTrash = isTrash(S.path);
      const ok = await api.confirm(inTrash
        ? { title: `Delete “${n.name}” forever?`, message: 'It will be removed from this browser. This can’t be undone.', ok: 'Delete forever', danger: true }
        : { title: `Move “${n.name}” to Trash?`, message: 'It stays in the Trash until the Trash is emptied.', ok: 'Move to Trash' });
      if (!ok || !alive || !vfs.node(p)) return;
      const idx = S.list.findIndex(x => x.name === n.name);
      vfs.rm(p);
      /* keep the keyboard where it was: select whatever took its place */
      const next = S.list[Math.min(Math.max(0, idx), S.list.length - 1)];
      if (next && S.path === vfs.parentPath(p)) select(next.name, { focus: true });
      if (inTrash) { say(`Deleted “${n.name}”.`); await freeSpace(); }
      else api.notify({ app: 'Files', icon: 'trash', title: 'Moved to Trash', message: n.name });
    }
    async function trashMany(names) {
      const dir = S.path;
      const list = names.filter(nm => vfs.node(at(nm)));
      if (list.length < 2) { if (list.length) trashNode(vfs.node(at(list[0]))); return; }
      const inTrash = isTrash(dir);
      const ok = await api.confirm(inTrash
        ? { title: `Delete ${plural(list.length, 'item')} forever?`, message: 'They will be removed from this browser. This can’t be undone.', ok: 'Delete forever', danger: true }
        : { title: `Move ${plural(list.length, 'item')} to Trash?`, message: 'They stay in the Trash until the Trash is emptied.', ok: 'Move to Trash' });
      if (!ok || !alive) return;
      for (const nm of list) vfs.rm(`${dir === '/' ? '' : dir}/${nm}`);
      if (S.path === dir) select(null);
      if (inTrash) { say(`Deleted ${plural(list.length, 'item')}.`); await freeSpace(); }
      else api.notify({ app: 'Files', icon: 'trash', title: 'Moved to Trash', message: plural(list.length, 'item') });
    }
    async function emptyTrash() {
      const kids = vfs.ls(TRASH, { hidden: true });
      if (!kids.length) return;
      const ok = await api.confirm({ title: 'Empty the Trash?',
        message: `${plural(kids.length, 'item')} will be deleted from this browser for good.`, ok: 'Empty Trash', danger: true });
      if (!ok || !alive) return;
      for (const k of kids) vfs.rm(`${TRASH}/${k.name}`);
      api.bus.emit('trash:emptied', { count: kids.length });
      say(`Trash emptied — ${plural(kids.length, 'item')} deleted.`);
      await freeSpace();
    }

    function sortMenu(e) {
      const pick = k => () => setSort(k);
      api.menu([
        { label: 'Sort by name', icon: S.sort === 'name' ? 'check' : 'type', onClick: pick('name') },
        { label: 'Sort by size', icon: S.sort === 'size' ? 'check' : 'bar-chart', onClick: pick('size') },
        { label: 'Sort by date', icon: S.sort === 'mtime' ? 'check' : 'clock', onClick: pick('mtime') },
        { label: 'Sort by kind', icon: S.sort === 'kind' ? 'check' : 'tag', onClick: pick('kind') },
      ], e.clientX, e.clientY);
    }
    function setSort(k) { S.sort = k; store.set('prefs.filesSort', k); paint(); focusSel(); }

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
      if (n.type === 'dir') { say('Folders can’t be downloaded — open it and download the files inside one at a time.', 'bad'); return; }
      let blob = null;
      try {
        if (media.isMedia(n)) {
          blob = await media.blobOf(n);
          if (!blob) { say(`The bytes for “${n.name}” are missing from this browser, so there is nothing to download.`, 'bad'); return; }
        } else if (hasText(n)) {
          blob = new Blob([n.content], { type: `${TEXT_MIME[extOf(n.name)] || 'text/plain'};charset=utf-8` });
        } else if (!n.size) {
          blob = new Blob([], { type: 'text/plain' });
        } else {
          say(`“${n.name}” has no content in this browser, so there is nothing to download.`, 'bad');
          return;
        }
      } catch (err) {
        say(`Couldn’t read “${n.name}” (${err?.message || err}).`, 'bad');
        return;
      }
      if (!alive) return;
      saveBlob(blob, n.name);
      say(`Sent “${n.name}” (${bytes(blob.size)}) to your browser’s downloads.`);
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
          working ? null : h('button.ibtn', { type: 'button', 'aria-label': 'Dismiss report', onclick: hideReport }, icon('x'))),
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
        zipReport({ working: true, title, sub: `${last.index} of ${last.total}${last.name ? ` — ${last.name}` : ''}`, pct });
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
      if (zipBusy) { say('Still working on the last archive — try again when it finishes.', 'bad'); return; }
      zipBusy = true;
      const dir = S.path;
      const prog = progressFor(names.length === 1 ? `Compressing “${names[0]}”` : `Compressing ${plural(names.length, 'item')}`);
      let res = null, err = null;
      try { res = await archive.compress(dir, names, { onProgress: p => prog.update(p) }); }
      catch (e) { err = e; }
      finally { prog.end(); zipBusy = false; }
      if (!alive) return;
      if (err) { zipReport({ title: 'Nothing was compressed', sub: err.message || String(err), problems: true }); return; }
      const left = res.skipped.length;
      zipReport({
        title: `Made “${res.name}” — ${bytes(res.size)}`,
        sub: `${plural(res.files, 'file')}${res.folders ? ` in ${plural(res.folders, 'folder')}` : ''}`
          + (left ? ` · ${plural(left, 'item')} left out — see why below` : ' · saved in this browser'),
        rows: res.skipped, problems: left > 0,
      });
      if (S.path === dir && !S.renaming && vfs.node(res.path)) { select(res.name, { focus: true }); }
      refreshSoon();
    }
    async function extract(n, here) {
      const dir = S.path;
      const why = importBlock(dir);
      if (why) { say(why, 'bad'); return; }
      if (zipBusy) { say('Still working on the last archive — try again when it finishes.', 'bad'); return; }
      zipBusy = true;
      const prog = progressFor(`Extracting “${n.name}”`);
      let res = null, err = null;
      quiet = true;                       /* one repaint at the end, not one per file */
      try { res = await archive.extract(at(n.name), { here, onProgress: p => prog.update(p) }); }
      catch (e) { err = e; }
      finally { quiet = false; prog.end(); zipBusy = false; }
      if (!alive) return;
      paint();
      if (err) { zipReport({ title: `Couldn’t extract “${n.name}”`, sub: err.message || String(err), problems: true }); return; }
      const left = res.skipped.length;
      const where = res.folder ? `into “${vfs.baseName(res.folder)}”` : `into ${folderLabel(res.dir)}`;
      zipReport({
        title: res.files || res.folders ? `Extracted ${plural(res.files, 'file')} ${where}` : 'Nothing was extracted',
        sub: left ? `${plural(left, 'item')} skipped — see why below` : `${bytes(res.bytes)} unpacked · saved in this browser`,
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
      if (S.importing) { say('Still importing the last batch — try again when it finishes.', 'bad'); return; }
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
        ? `Importing into ${label} — ${index} of ${total}`
        : !ok ? 'Nothing was imported'
        : no ? `Imported ${ok} of ${all} into ${label}`
        : `Imported ${plural(ok, 'file')} into ${label}`;
      const session = results.some(r => r.ok && r.session);
      const sub = phase === 'working' ? current
        : no ? `${plural(no, 'file')} couldn’t be kept — see why below.`
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
          phase === 'done' ? h('button.ibtn', { type: 'button', 'aria-label': 'Dismiss import report', onclick: hideReport }, icon('x')) : null),
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
    function say(msg, tone = '') {
      cancel(flashT);
      flashEl.textContent = msg;
      flashEl.title = msg;
      flashEl.className = `fx-flash${tone ? ` is-${tone}` : ''}`;
      status.classList.add('has-flash');
      if (tone === 'bad' && !win.el.classList.contains('is-active')) api.notify({ app: 'Files', icon: 'alert', title: 'Files', message: msg });
      flashT = later(() => { flashEl.textContent = ''; flashEl.title = ''; status.classList.remove('has-flash'); }, tone === 'bad' ? 9000 : 5000);
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
    const noData = () => h('span.fx-nodata', { text: 'no data', title: 'This file has no content in this browser' });
    /** A media file whose stored bytes are gone (site data cleared): say so on the tile. */
    function markMissing(box, mode, what) {
      box.classList.add('is-broken');
      box.title = `The bytes for this ${what} are missing from this browser`;
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
        class: isHollow(n) ? 'is-hollow' : null,
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
        /* a picture can be dragged into a note (js/apps/notes.js reads the path) */
        ...(mediaKindOf(n) === 'image' ? { draggable: 'true', ondragstart: e => { try { e.dataTransfer.setData('application/x-staticos-path', at(n.name)); e.dataTransfer.effectAllowed = 'copy'; } catch (err) {} } } : null),
        ...extra,
      };
    }
    /* in the Trash, with the 30-day Trash on (Settings › Storage): how long an item has left */
    const delLabel = n => {
      if (S.path !== TRASH) return null;
      const d = trashx.daysLeft(n);
      return d === null ? null : d === 0 ? 'deletes today' : `deletes in ${plural(d, 'day')}`;
    };
    function tileFor(n) {
      const meta = n.type === 'dir' ? plural(n.children.length, 'item') : bytes(n.size);
      const del = delLabel(n);
      return h('div.tile.fx-item', itemProps(n),
        gridVisual(n),
        S.renaming === n.name ? renameInput(n) : h('div.tile__n', { text: n.name }),
        h('div.tile__m', { text: meta }),
        del ? h('div.tile__m.fx-del', { text: del }) : null,
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
          isHollow(n) ? noData() : null),
        h('small.fx-c-mod', { text: fmt.fmtAgo(n.mtime), title: fullDate(n.mtime) }),
        h('small.fx-c-size', { text: n.type === 'dir' ? '—' : bytes(n.size) }),
        h('small.fx-c-kind', { text: typeName(n) }));
    }
    function sortHead(key, label, cls) {
      const on = S.sort === key;
      return h(`button.fx-sort${cls ? `.${cls}` : ''}`, {
        type: 'button', 'aria-pressed': on ? 'true' : 'false', title: `Sort by ${label.toLowerCase()}`,
        onclick: () => setSort(key),
      }, h('span', { text: label }), on ? icon(key === 'size' || key === 'mtime' ? 'chevron-down' : 'chevron-up') : null);
    }

    function emptyState() {
      if (S.filter) {
        return h('div.empty', icon('search'), h('b', { text: 'No matches' }),
          h('small', { text: `Nothing in this folder matches “${S.filter}”.` }));
      }
      if (S.path === TRASH) {
        return h('div.empty', icon('trash'), h('b', { text: 'The Trash is empty' }),
          h('small', { text: 'Things you delete wait here until you empty it.' }));
      }
      const can = !importBlock(S.path);
      return h('div.empty.fx-empty', icon('folder-open'), h('b', { text: 'This folder is empty' }),
        h('small', { text: can
          ? 'Drop files here from your computer, or import them. Right-click for a new folder or text file.'
          : 'Right-click to create something.' }),
        can ? h('button.btn.btn--sm', { type: 'button', onclick: pickFiles }, icon('upload'), h('span', { text: 'Import from computer' })) : null);
    }

    function paint() {
      if (!alive) return;
      if (S.tag) { paintTagView(); return; }
      const here = vfs.node(S.path);
      if (!here || here.type !== 'dir') {
        let p = S.path;
        while (p !== '/' && !(vfs.node(p)?.type === 'dir')) p = vfs.parentPath(p);
        S.path = p;
        S.sel = new Set();
        paintCrumbs();
      }
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
      content.classList.toggle('app__content--flush', S.view === 'list');

      if (!list.length) {
        content.appendChild(emptyState());
      } else if (S.view === 'grid') {
        const grid = h('div.tiles.fx-grid', { role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': `Contents of ${folderLabel(S.path)}` });
        for (const n of list) { const el = tileFor(n); itemEls.set(n.name, el); grid.appendChild(el); }
        content.appendChild(grid);
      } else {
        const body = h('div.fx-rowlist', { role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': `Contents of ${folderLabel(S.path)}` });
        for (const n of list) { const el = rowFor(n); itemEls.set(n.name, el); body.appendChild(el); }
        content.appendChild(h('div.rows',
          h('div.rows__head', sortHead('name', 'Name'), sortHead('mtime', 'Modified', 'fx-c-mod'),
            sortHead('size', 'Size', 'fx-c-size'), sortHead('kind', 'Kind', 'fx-c-kind')),
          body));
      }
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
    }
    function rangeSel(name) {
      const L = S.list;
      const a = L.findIndex(x => x.name === S.lead), b = L.findIndex(x => x.name === name);
      if (a < 0 || b < 0) { select(name, { focus: true }); return; }
      S.sel = new Set(L.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.name));
      syncSel();
      itemEls.get(name)?.focus({ preventScroll: true });
      paintStatus();
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
      if (QL.el && name) qlRender(name);
    }

    function paintStatus() {
      const list = S.list;
      const many = S.sel.size > 1;
      const n = many ? null : selected();
      const st = S.storage;
      const free = st && !st.unsupported && st.quota ? Math.max(0, st.quota - st.usage) : null;
      const manyBytes = many ? [...S.sel].reduce((a, nm) => a + vfs.size(vfs.node(at(nm))), 0) : 0;
      api.render(status,
        h('span.dim', { text: plural(list.length, 'item') }),
        n || many ? h('span.dim.fx-status__dot', { text: '·' }) : null,
        many ? h('span.dim.fx-status__sel', { text: `${S.sel.size} selected — ${bytes(manyBytes)}` }) : null,
        n ? h('span.dim.fx-status__sel', { text: `${n.name} — ${n.type === 'dir'
          ? (n.children.length ? `${plural(n.children.length, 'item')}, ${bytes(vfs.size(n))}` : 'empty folder')
          : bytes(n.size)}${isHollow(n) ? ' (no content here)' : ''}` }) : null,
        flashEl,
        h('div.grow'),
        free !== null ? h('span.dim.fx-status__free', {
          text: `${bytes(free)} free · estimate`,
          title: 'How much more this browser says StaticOS may store here (navigator.storage.estimate).',
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
        api.render(btn, icon(QL.zoom ? 'zoom-out' : 'zoom-in'), h('span', { text: QL.zoom ? 'Fit' : 'Actual size' }));
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

      const crumbs = h('nav.fx-zip__crumbs', { 'aria-label': 'Folder inside the archive' });
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
            h('small', { text: e.problem ? why(e) : e.method === 8 ? `${bytes(e.csize)} packed` : 'stored' }),
            h('small.fx-zip__sz', { text: bytes(e.size) })));
        }
        if (!rows.length) rows.push(h('div.fx-zip__empty', { text: 'Nothing in here.' }));
        api.render(list, rows);
        list.scrollTop = 0;
      };
      stage.classList.add('fx-ql__stage--doc');
      stage.append(h('div.fx-zip', { role: 'region', 'aria-label': `Inside ${n.name}` }, crumbs, list));
      show([top]);
      setFacts(plural(files, 'file'), folders ? plural(folders, 'folder') : null,
        `${bytes(unpacked)} unpacked`, `${bytes(info.size)} packed`, bad ? `${bad} can’t be extracted` : null);
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
      const openLabel = isDir ? 'Open folder' : n.kind === 'game' ? 'Play' : handler ? `Open in ${handler.name}` : 'Open';

      const stage = h('div.fx-ql__stage');
      const facts = h('div.fx-ql__facts', { 'aria-live': 'polite' });
      const setFacts = (...bits) => {
        const b = bits.filter(Boolean);
        api.render(facts, b.map((t, i) => [i ? h('i', { 'aria-hidden': 'true' }) : null, h('span', { text: t })]));
      };
      const closeBtn = h('button.ibtn', { type: 'button', 'aria-label': 'Close Quick Look', title: 'Close (Esc)', onclick: () => qlClose() }, icon('x'));
      const prevBtn = h('button.ibtn', { type: 'button', 'aria-label': 'Previous item', title: 'Previous (←)', disabled: idx <= 0, onclick: () => qlStep(-1) }, icon('chevron-left'));
      const nextBtn = h('button.ibtn', { type: 'button', 'aria-label': 'Next item', title: 'Next (→)', disabled: idx < 0 || idx >= L.length - 1, onclick: () => qlStep(1) }, icon('chevron-right'));
      const pos = idx >= 0 && L.length > 1 ? h('span.fx-ql__pos', { text: `${idx + 1} of ${L.length}`, 'aria-label': `Item ${idx + 1} of ${L.length}` }) : null;
      const zoomBtn = h('button.btn.btn--sm.fx-ql__zoom', { type: 'button', hidden: true, 'aria-pressed': 'false', onclick: () => qlZoom() });
      /* an archive: shown once its contents have been read */
      const extractBtn = archive.isZip(n) && media.isMedia(n)
        ? h('button.btn.btn--sm.fx-ql__extract', { type: 'button', hidden: true, onclick: () => { qlClose(false); extract(n, false); } },
          icon('package'), h('span', { text: 'Extract all' }))
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
            api.menu(tagItems([path], paintQlTags), r.left, r.bottom + 4, { label: `Tags for ${n.name}` });
          } }, icon('tag'), h('span', { text: 'Tags' })),
          here ? null : h('button.btn.btn--sm', { type: 'button', onclick: () => { qlClose(false); openNode(n); } },
            icon(isDir ? 'folder-open' : 'external-link'), h('span', { text: openLabel })),
          !isDir && !hollow ? h('button.btn.btn--sm', { type: 'button', onclick: () => download(n) },
            icon('download'), h('span', { text: 'Download' })) : null,
          closeBtn));
      api.render(QL.el, h('div.fx-ql__card', head, stage, facts));
      paintQlTags();
      QL.el.setAttribute('aria-label', `Quick Look: ${n.name}`);
      /* focus the sheet itself (not a button: the Space that opened it is
         still held, and its keyup would press whatever button had focus) */
      if (first || (hadFocus && !QL.el.contains(document.activeElement))) QL.el.focus({ preventScroll: true });

      if (isDir) {
        const count = n.children.length;
        stage.append(qlNote(vfs.iconFor(n), count ? plural(count, 'item') : 'Empty folder',
          `${bytes(vfs.size(n))} in total`, 'dir'));
        setFacts('Folder');
        return;
      }

      if (media.isMedia(n)) {
        stage.append(h('div.fx-ql__wait', { text: 'Loading…' }));
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
            stage.append(h('iframe.fx-ql__pdf', { src: `${purl}#navpanes=0`, title: `PDF: ${n.name}` }));
          } else {
            stage.append(h('div.fx-ql__note',
              h('div.fx-ql__big', { dataset: { kind: 'doc' } }, icon('file-text')),
              h('b', { text: 'This browser doesn’t show PDFs inside a page' }),
              h('small', { text: 'Open it in a new tab to read it with the browser’s own viewer, or download it.' }),
              h('button.btn.btn--sm', { type: 'button', onclick: () => { try { window.open(purl, '_blank', 'noopener'); } catch (e) { /* popup blocked */ } } },
                icon('external-link'), h('span', { text: 'Open in a new tab' }))));
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
          stage.append(h('pre.fx-ql__text', { text, tabindex: '0', 'aria-label': `Contents of ${n.name}` }));
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
        stage.append(h('pre.fx-ql__text', { text: shown, tabindex: '0', 'aria-label': `Contents of ${n.name}` }));
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

    /* ---------------- start ---------------- */
    paintSeg();
    paintStorage();
    paintAll();
    if (S.sel.size) { const el = itemEls.get(selName()); if (el) revealEl(el); }
    refreshStorage();
    /* a phone shows only the focused sheet, so the strip has no size until then */
    win.onFocus(() => keepChip());
    const chipRaf = requestAnimationFrame(() => keepChip());

    const offFs = api.bus.on('fs:change', dir => {
      if (quiet || !alive) return;
      if (S.tag) { paint(); return; }
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
      if (k === ' ') { e.preventDefault(); if (n) qlOpen(n.name); else say('Select something first, then press Space to look inside it.'); return; }
      if (k === 'F2') { if (n) { e.preventDefault(); startRename(n.name); } return; }
      if (k === 'Escape') { if (S.filter) { e.preventDefault(); closeFilter(); } else if (n) select(null); return; }
      if (mod || e.altKey) return;
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
      offFs(); offMedia();
      window.removeEventListener('keydown', onKey);
      app.removeEventListener('dragenter', onDragEnter);
      app.removeEventListener('dragover', onDragOver);
      app.removeEventListener('dragleave', onDragLeave);
      app.removeEventListener('drop', onDrop);
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
