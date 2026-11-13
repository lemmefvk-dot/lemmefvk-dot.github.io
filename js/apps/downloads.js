/* ============================================================
   downloads.js — Static Downloads: everything StaticOS has made
   or saved, in one place.

   Nothing here is invented. Every row is read from a real place
   another part of StaticOS already writes to, through that place's
   own module, and every count on screen is measured from them:

     Files     the vfs under ~/Downloads, ~/Pictures (Screenshots,
               Camera, album folders, pictures saved from Paint,
               Palette and Graph), ~/Music (Piano takes, Beats
               exports, imports) and ~/Videos — vfs.walk plus
               media.isMedia / kindOf / urlOf. Size is node.size,
               date is node.mtime. The pictures and clips StaticOS
               ships with (vfs `seed` files) are left out: nobody
               made or saved them here. Hidden folders are skipped
               and the Trash is never scanned.
     Projects  projects.list() — name, version count, last update.
               The picture is the frame Static Forge captured
               (store portal.forge.thumbs) when there is one.
     Clips     db.kv('clips') — Static Arcade recordings
               { id, game, title, at, mime, blob, durationMs }.
     Assets    db.kv('assets') — the Asset Lab library (keys
               'assetlab:<id>', sprites and sounds). The autosaved
               'assetlab:draft' is work in progress, not a saved
               asset, so it is not listed.

   Views: Recent (everything, newest first, grouped by day) and one
   per kind — Images, Videos, Audio, Game projects, Clips, Assets,
   Other files — each as a list or a grid, searchable and sortable.

   Per item: Quick Look (Space, or a tap on a phone) previews it in
   place; Open (Enter, double-click) hands it to the app that owns
   it; Show in Files selects the real file (for projects and clips,
   the shortcut gamefiles.js keeps in ~/Game Projects and ~/Replays);
   Download to computer hands the real bytes to the browser — the
   blob, the text, the project's current HTML, the sprite sheet PNG
   or the sound WAV; Delete says exactly what it does: files go to
   the Trash and can be put back, while projects, clips and assets
   exist only in this browser's IndexedDB and are removed for good.

   Live: bus 'fs:change' (inside the scanned folders), 'media:change',
   'projects:change', 'clips:change' and 'assets:change' re-read just
   that source, and a repaint only happens when what was read really
   differs. Asset Lab does not announce library saves on the bus, so
   assets are also re-read whenever this window gains focus.

   Thumbnails are the things themselves: pictures by URL, one real
   frame read out of each video and clip (two at a time, only once a
   tile scrolls into view, cached for the session), Forge's capture
   for projects, frame one of a sprite and the stored peaks of a
   sound. Anything with no bytes behind it is marked "No data".

   Sizes are measured, never guessed. A media file in the vfs is a
   reference and the bytes live in IndexedDB, so one read of the
   stored ids says which references still have bytes: a file whose
   bytes are gone says "No data" instead of the size it used to be,
   can't be downloaded, and is left out of every total. A total says
   what it leaves out ("370 B in all · 1 with no data").

   Long lists are paged, never the counts: 300 rows are painted and
   the next page follows as you reach it (or from "Show N more" /
   "Show all", which is what a browser without IntersectionObserver
   gets). Every count on screen — the sidebar, the title, the footer,
   aria-setsize on each row — is still measured over everything.

   Keyboard: arrows / Home / End move, Space previews, Enter opens,
   Delete removes (after a confirm), Shift+F10 or the Menu key opens
   the item menu, Ctrl/⌘+F or / jumps to search. Quick Look: ← → step
   through the list, Esc closes and gives focus back to the row.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import * as Projects from '../core/projects.js';
import * as DB from '../core/db.js';
import { fmtBytes, fmtAgo } from '../core/util.js';

/* self-injected stylesheet, guarded so re-opening never double-adds it */
if (typeof document !== 'undefined' && !document.getElementById('feat-downloads-css')) {
  const l = document.createElement('link');
  l.id = 'feat-downloads-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-downloads.css';
  document.head.appendChild(l);
}

const PKEY = 'portal.downloads';
const NARROW = 620;                    /* below this painted width the sidebar becomes a chip strip */
const ROOTS = ['Downloads', 'Pictures', 'Music', 'Videos'];
const ASSET_KEY = 'assetlab:';
const ASSET_DRAFT = 'assetlab:draft';
const TEXT_PREVIEW_MAX = 64 * 1024;
const FRAME_W = 240;                   /* width of a captured video frame */
const FRAME_CAP = 200;
const PAGE = 300;                      /* rows painted at once; the rest follow as you reach them */

const SECTIONS = [
  { id: 'recent',   label: 'Recent',        icon: 'clock',    group: 'Library' },
  { id: 'images',   label: 'Images',        icon: 'image',    group: 'Kinds' },
  { id: 'videos',   label: 'Videos',        icon: 'film',     group: 'Kinds' },
  { id: 'audio',    label: 'Audio',         icon: 'music',    group: 'Kinds' },
  { id: 'projects', label: 'Game projects', icon: 'sparkles', group: 'Kinds' },
  { id: 'clips',    label: 'Clips',         icon: 'play',     group: 'Kinds' },
  { id: 'assets',   label: 'Assets',        icon: 'layers',   group: 'Kinds' },
  { id: 'other',    label: 'Other files',   icon: 'file',     group: 'Kinds' },
];
const SEC = Object.fromEntries(SECTIONS.map(s => [s.id, s]));
/* the store each kind is read from — for loading and error states */
const SOURCE_OF = { images: 'files', videos: 'files', audio: 'files', other: 'files', projects: 'projects', clips: 'clips', assets: 'assets' };
const SOURCE_NAME = { projects: 'game projects', clips: 'Arcade clips', assets: 'Asset Lab library' };
const GRID_FIRST = new Set(['images', 'videos', 'clips']);
const SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['name', 'Name'], ['size', 'Largest first']];

const TYPE_NAMES = {
  jpg: 'JPEG image', jpeg: 'JPEG image', png: 'PNG image', gif: 'GIF image', webp: 'WebP image',
  avif: 'AVIF image', svg: 'SVG image', bmp: 'BMP image',
  mp4: 'MP4 video', webm: 'WebM video', mov: 'QuickTime video', m4v: 'MPEG-4 video',
  mkv: 'Matroska video', ogv: 'Ogg video',
  mp3: 'MP3 audio', wav: 'WAV audio', ogg: 'Ogg audio', oga: 'Ogg audio', m4a: 'AAC audio',
  aac: 'AAC audio', flac: 'FLAC audio', opus: 'Opus audio', weba: 'WebM audio',
  txt: 'Plain text', md: 'Markdown', json: 'JSON', js: 'JavaScript', ts: 'TypeScript',
  css: 'CSS', html: 'HTML page', csv: 'CSV table', tsv: 'TSV table', log: 'Log', xml: 'XML',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'Settings', conf: 'Settings', sh: 'Shell script',
  py: 'Python', rs: 'Rust', c: 'C source', h: 'C header', pdf: 'PDF document',
  zip: 'ZIP archive', tar: 'Tar archive', gz: 'Gzip archive',
  aethergame: 'Game shortcut', aether: 'Theme', aetherclip: 'Clip shortcut',
};
const TEXT_MIME = {
  md: 'text/markdown', json: 'application/json', js: 'text/javascript', css: 'text/css',
  html: 'text/html', csv: 'text/csv', xml: 'application/xml', tsv: 'text/tab-separated-values',
};

/* ---------- small pure helpers ---------- */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const pad2 = n => String(n).padStart(2, '0');
const plural = (n, w, many = `${w}s`) => `${Number(n).toLocaleString()} ${n === 1 ? w : many}`;
const bytesText = n => (n == null || !Number.isFinite(n) || n < 0 ? 'Size unknown' : n > 0 ? fmtBytes(n) : '0 B');
const extOf = name => { const s = String(name || ''); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(i + 1).toLowerCase() : ''; };
const typeName = name => { const e = extOf(name); return TYPE_NAMES[e] || (e ? `${e.toUpperCase()} file` : 'File'); };
const safeName = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
const num = v => (Number.isFinite(v) ? v : NaN);
const MAX_TIME = 8.64e15;                /* the furthest a Date can go; past it every date call throws */
const realDate = ms => Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME;
const agoText = ms => (realDate(ms) ? fmtAgo(ms) : '—');
const fullDate = ms => (realDate(ms)
  ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : 'Date unknown');
/** "0:12" for a clip; tenths below ten seconds ("2.4 s"), so short ones are not all "0:02" */
function lenText(ms) {
  const s = Number(ms) / 1000;
  if (!Number.isFinite(s) || s <= 0) return '';
  if (s < 10) return `${(Math.floor(s * 10) / 10).toFixed(1)} s`;
  return `${Math.floor(s / 60)}:${pad2(Math.floor(s % 60))}`;
}
function stampOf(ms) {
  const d = new Date(realDate(ms) ? ms : Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}
/** UTF-8 byte length without allocating a copy (a project's HTML can be large) */
function utf8Len(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
/** { mime, base64, body } for a data: URL, or null */
function dataUrlParts(s) {
  if (typeof s !== 'string' || !s.startsWith('data:')) return null;
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const meta = s.slice(5, comma).split(';');
  return { mime: meta[0] || 'application/octet-stream', base64: meta.includes('base64'), body: s.slice(comma + 1) };
}
function dataUrlBytes(s) {
  const p = dataUrlParts(s);
  if (!p) return null;
  if (!p.base64) { try { return utf8Len(decodeURIComponent(p.body)); } catch (e) { return null; } }
  const b = p.body.replace(/\s+/g, '');
  const padding = b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(b.length * 3 / 4) - padding);
}
function dataUrlBlob(s) {
  const p = dataUrlParts(s);
  if (!p) return null;
  try {
    if (!p.base64) return new Blob([decodeURIComponent(p.body)], { type: p.mime });
    const bin = atob(p.body.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return new Blob([out], { type: p.mime });
  } catch (e) { return null; }
}
const isImageDataUrl = s => typeof s === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(s);
function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
/** the day bucket a date falls in, measured from today */
function bucketOf(ms, now) {
  if (!realDate(ms)) return { key: 'unknown', label: 'Date unknown' };
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86400000);
  if (days <= 0) return { key: 'today', label: 'Today' };
  if (days === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (days < 7) return { key: 'week', label: 'Previous 7 days' };
  if (days < 30) return { key: 'month', label: 'Previous 30 days' };
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return { key: `m${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' }) };
}
function mediaErr(err) {
  switch (err?.code) {
    case 4: return 'Its format is not supported by this browser.';
    case 3: return 'It could not be decoded.';
    case 2: return 'It could not be loaded.';
    default: return 'It could not be played.';
  }
}

/* ---------- real video frames, shared by every window this session ----------
   A stored video never changes behind its reference, so a frame read out of
   it once is good for the whole session: a repaint shows it at once. */
const FRAMES = new Map();     /* key -> { src, w, h, duration } | { error } */
function rememberFrame(k, v) {
  FRAMES.set(k, v);
  while (FRAMES.size > FRAME_CAP) FRAMES.delete(FRAMES.keys().next().value);
}
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
      const w = v.videoWidth, hh = v.videoHeight;
      const duration = Number.isFinite(v.duration) ? v.duration : null;
      if (!w || !hh) { finish({ error: 'no picture', duration }); return; }
      const W = FRAME_W, H = Math.max(1, Math.round(FRAME_W * hh / w));
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      try {
        c.getContext('2d').drawImage(v, 0, 0, W, H);
        finish({ src: c.toDataURL('image/jpeg', 0.82), w, h: hh, duration });
      } catch (err) { finish({ error: String(err?.message || err), w, h: hh, duration }); }
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
    v.onerror = () => finish({ error: mediaErr(v.error) });
    v.src = url;
  });
}

/* ---------- a sprite frame as a canvas (the stored RGBA, drawn as it is) ---------- */
function spriteOk(sp) {
  return !!(sp && Number.isInteger(sp.w) && Number.isInteger(sp.h) && sp.w >= 1 && sp.h >= 1 && sp.w <= 512 && sp.h <= 512
    && Array.isArray(sp.frames) && sp.frames.length && sp.frames[0] && sp.frames[0].length === sp.w * sp.h * 4);
}
function spriteCanvas(sp, i = 0) {
  const px = sp.frames[i];
  if (!px || px.length !== sp.w * sp.h * 4) return null;
  const c = document.createElement('canvas');
  c.width = sp.w; c.height = sp.h;
  try { c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), sp.w, sp.h), 0, 0); }
  catch (e) { return null; }
  return c;
}

defineApp({
  id: 'downloads',
  name: 'Static Downloads',
  icon: 'download',
  g1: '#7cf0e0', g2: '#2459d6',
  category: 'System',
  keywords: ['downloads', 'download', 'saved', 'recent', 'recents', 'screenshots', 'recordings', 'exports',
    'captures', 'clips', 'replays', 'projects', 'games', 'assets', 'sprites', 'sounds', 'pictures', 'photos',
    'videos', 'music', 'audio', 'files', 'library', 'trash'],
  desc: 'Everything StaticOS has made or saved, in one place',
  singleton: true,
  win: { w: 900, h: 600, minW: 380, minH: 360 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus, vfs, confirm, menu } = api;
    const HOME = vfs.HOME;
    const TRASH = `${HOME}/Trash`;
    const uid = `dlx${Math.random().toString(36).slice(2, 8)}`;

    /* ---------------- bookkeeping: everything teardown must undo ---------------- */
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!S.dead) fn(); }, ms); timers.add(t); return t; };
    const cancel = t => { if (t) { clearTimeout(t); timers.delete(t); } };
    const offs = [];
    const listen = (el, evt, fn, o) => { el.addEventListener(evt, fn, o); offs.push(() => el.removeEventListener(evt, fn, o)); };
    const ownUrls = new Set();          /* object URLs this window made (clip frames, clip playback) */
    const dlUrls = new Map();           /* timer -> object URL handed to <a download> */

    /* ---------------- prefs ---------------- */
    function readPrefs() {
      const v = store.get(PKEY, null);
      const o = v && typeof v === 'object' ? v : {};
      const views = {};
      if (o.views && typeof o.views === 'object') {
        for (const [k, x] of Object.entries(o.views)) if (SEC[k] && (x === 'grid' || x === 'list')) views[k] = x;
      }
      return { section: SEC[o.section] ? o.section : 'recent', sort: SORTS.some(s => s[0] === o.sort) ? o.sort : 'new', views };
    }
    const P0 = readPrefs();
    const S = {
      dead: false,
      section: SEC[opts?.view] ? opts.view : P0.section,
      sort: P0.sort,
      views: P0.views,
      q: '',
      items: { files: [], projects: [], clips: [], assets: [] },
      loaded: { files: false, projects: false, clips: false, assets: false },
      err: { projects: null, clips: null, assets: null },
      sig: { files: '', projects: '', clips: '', assets: '', bytes: '' },
      tok: { projects: 0, clips: 0, assets: 0 },
      liveIds: null,        /* Set of media ids that really have bytes, once read */
      idsTok: 0,
      brokenClips: 0,
      shown: [],
      limit: PAGE,          /* how many of them are painted right now */
      inSecCount: 0,
      state: 'loading',     /* what the list shows: loading | error | empty | nomatch | list */
      selKey: null,
      narrow: false,
      ql: null,
    };
    const savePrefs = () => store.set(PKEY, { section: S.section, sort: S.sort, views: { ...S.views } });
    const viewOf = sec => S.views[sec] || (GRID_FIRST.has(sec) ? 'grid' : 'list');

    /* ==================================================================== */
    /*  reading the real sources                                            */
    /* ==================================================================== */
    const whereOf = path => {
      const dir = vfs.parentPath(path);
      const rel = dir === HOME ? 'Home' : dir.startsWith(`${HOME}/`) ? dir.slice(HOME.length + 1) : dir;
      return rel.split('/').filter(Boolean).join(' › ');
    };

    function fileItem(n, path) {
      const isM = media.isMedia(n);
      const content = typeof n.content === 'string' ? n.content : '';
      const mk = isM ? (media.kindOf(n.name) || (content.startsWith(media.ASSET) ? media.kindOf(content.slice(media.ASSET.length)) : null)) : null;
      const group = mk === 'image' ? 'images' : mk === 'video' ? 'videos' : mk === 'audio' ? 'audio' : 'other';
      const at = Date.parse(n.mtime);
      const hollow = !isM && !content.length && (n.size || 0) > 0;
      const where = whereOf(path);
      const kindLabel = typeName(n.name);
      return {
        key: `f:${path}`, src: 'file', group, name: n.name, path, node: n, mk, isMedia: isM, hollow,
        mediaId: content.startsWith(media.MEDIA) ? content.slice(media.MEDIA.length) : null,
        ref: isM ? content : null, size: Number.isFinite(n.size) ? n.size : null, at: num(at),
        kindLabel, where, detail: '', glyph: vfs.iconFor(n), tint: mk || n.kind || 'bin',
        hay: `${n.name} ${kindLabel} ${where}`.toLowerCase(),
      };
    }
    /* A media file is a reference; the bytes live in IndexedDB. One read of the
       stored ids says which references still have bytes behind them, so a file
       whose bytes are gone is marked as such instead of showing a size for data
       nobody has. Until that read lands nothing is marked. */
    const noBytes = it => !!(it.mediaId && S.liveIds && !S.liveIds.has(it.mediaId));
    /** true when this item has nothing behind it — never show a size for it */
    const noData = it => !!(it.hollow || noBytes(it));
    const counted = i => !noData(i) && Number.isFinite(i.size) && i.size >= 0;
    const realBytes = list => list.reduce((a, i) => a + (counted(i) ? i.size : 0), 0);
    const missingCount = list => list.reduce((a, i) => a + (noData(i) ? 1 : 0), 0);
    const unsizedCount = list => list.reduce((a, i) => a + (!noData(i) && !counted(i) ? 1 : 0), 0);
    /** "370 B in all", and what the total leaves out — never a total of data that isn't there */
    function totalText(list) {
      const miss = missingCount(list);
      const unsized = unsizedCount(list);
      return `${bytesText(realBytes(list))}${miss ? ` · ${miss} with no data` : ''}${unsized ? ` · ${unsized} of unknown size` : ''}`;
    }
    async function checkBytes() {
      const tok = ++S.idsTok;
      let set = null;
      try { set = new Set(await DB.kv('media').keys()); } catch (e) { set = null; }
      if (S.dead || tok !== S.idsTok) return false;
      S.liveIds = set;
      const sig = set ? S.items.files.filter(noBytes).map(i => i.key).join('\n') : '';
      if (sig === S.sig.bytes) return false;
      S.sig.bytes = sig;
      return true;
    }
    function scanFiles() {
      const out = [];
      for (const r of ROOTS) {
        const base = `${HOME}/${r}`;
        const d = vfs.node(base);
        if (!d || d.type !== 'dir') continue;
        vfs.walk(base, (n, path) => {
          if (!n || n.type !== 'file' || n.seed) return;
          if (path.slice(HOME.length + 1).split('/').some(part => part.startsWith('.'))) return;
          out.push(fileItem(n, path));
        });
      }
      return out;
    }
    function refreshFiles() {
      const items = scanFiles();
      const sig = items.map(i => `${i.path}|${i.size}|${i.node.mtime}|${i.ref || ''}|${i.hollow ? 1 : 0}`).join('\n');
      S.loaded.files = true;
      if (sig === S.sig.files) return false;
      S.items.files = items;
      S.sig.files = sig;
      return true;
    }

    const sourceLabel = p => (p.remixCredit || p.source === 'remix' ? 'Remix'
      : p.source === 'studio' ? 'Static Studio'
        : /^Imported/.test(String(p.versions?.[0]?.note || '')) ? 'Imported' : 'Static Forge');
    function projectItem(p) {
      const versions = Array.isArray(p.versions) ? p.versions : [];
      const head = Number.isInteger(p.head) && versions[p.head] ? p.head : versions.length - 1;
      const html = String(versions[head]?.html || '');
      const name = String(p.name || 'Untitled game').slice(0, 80);
      const where = sourceLabel(p);
      const detail = `${plural(versions.length, 'version')}${p.published ? ' · Published' : ''}`;
      return {
        key: `p:${p.id}`, src: 'project', group: 'projects', name, project: p, versions: versions.length, head,
        size: utf8Len(html), at: num(Number(p.updatedAt)), created: num(Number(p.createdAt)),
        kindLabel: 'Game project', where, detail, glyph: 'sparkles', tint: 'game',
        hay: `${name} game project ${where} ${String(p.prompt || '').slice(0, 200)}`.toLowerCase(),
      };
    }
    function clipItem(key, c) {
      const name = String(c.title || c.game || 'Arcade clip').slice(0, 80);
      const len = lenText(c.durationMs);
      return {
        key: `c:${String(key)}`, src: 'clip', group: 'clips', name, clip: c, clipKey: key,
        size: c.blob.size, at: num(Number(c.at)), kindLabel: 'Arcade clip', where: 'Static Arcade',
        detail: len, glyph: 'play', tint: 'video',
        hay: `${name} ${String(c.game || '')} arcade clip replay recording`.toLowerCase(),
      };
    }
    function assetItem(key, a) {
      const sprite = a.kind === 'sprite';
      const sp = sprite && spriteOk(a.sprite) ? a.sprite : null;
      const name = String(a.name || (sprite ? 'sprite' : 'sound')).slice(0, 80);
      const detail = sprite
        ? (sp ? `${sp.w}×${sp.h}${sp.frames.length > 1 ? ` · ${plural(sp.frames.length, 'frame')}` : ''}` : '')
        : (Number.isFinite(a.dur) && a.dur > 0 ? `${a.dur < 10 ? a.dur.toFixed(2) : a.dur.toFixed(1)} s` : '');
      return {
        key: `a:${key}`, src: 'asset', group: 'assets', name, asset: a, assetKey: key, sprite: sp,
        size: dataUrlBytes(sprite ? a.png : a.wav), at: num(Number(a.updatedAt || a.createdAt)),
        kindLabel: sprite ? 'Sprite' : 'Sound', where: 'Asset Lab', detail,
        glyph: sprite ? 'image' : 'volume', tint: sprite ? 'image' : 'audio',
        hay: `${name} ${sprite ? 'sprite image png pixel' : 'sound sfx wav audio'} asset lab`.toLowerCase(),
      };
    }
    /** keys and values of a store, paired exactly (getAll/getAllKeys share key order;
        if the two reads disagree — a write landed between them — read each key) */
    async function readPairs(name) {
      const s = DB.kv(name);
      const [keys, vals] = await Promise.all([s.keys(), s.all()]);
      if (keys.length === vals.length) return keys.map((k, i) => [k, vals[i]]);
      const again = await Promise.all(keys.map(k => s.get(k)));
      return keys.map((k, i) => [k, again[i]]);
    }
    const errText = err => String(err?.message || err || 'unknown error').slice(0, 160);

    async function loadSource(kind) {
      const tok = ++S.tok[kind];
      let items = null, err = null, broken = S.brokenClips;
      try {
        if (kind === 'projects') {
          const list = await Projects.list();
          items = list.filter(p => p && typeof p === 'object' && p.id).map(projectItem);
        } else if (kind === 'clips') {
          const rows = await readPairs('clips');
          const ok = v => v && typeof v === 'object' && typeof Blob !== 'undefined' && v.blob instanceof Blob && v.blob.size > 0;
          broken = rows.filter(([, v]) => !ok(v)).length;
          items = rows.filter(([, v]) => ok(v)).map(([k, v]) => clipItem(k, v));
        } else if (kind === 'assets') {
          const rows = await readPairs('assets');
          items = rows
            .filter(([k, v]) => typeof k === 'string' && k.startsWith(ASSET_KEY) && k !== ASSET_DRAFT
              && v && typeof v === 'object' && v.app === 'assetlab' && (v.kind === 'sprite' || v.kind === 'sound'))
            .map(([k, v]) => assetItem(k, v));
        }
      } catch (e) { err = errText(e); }
      if (S.dead || tok !== S.tok[kind]) return false;
      const hadErr = S.err[kind];
      S.err[kind] = err;
      S.loaded[kind] = true;
      if (kind === 'clips') S.brokenClips = broken;
      if (err) { S.items[kind] = []; S.sig[kind] = ''; return true; }
      const sig = items.map(i => (kind === 'projects'
        ? `${i.key}|${i.at}|${i.name}|${i.versions}|${i.size}|${i.project.published ? 1 : 0}|${i.head}`
        : kind === 'clips' ? `${i.key}|${i.at}|${i.size}|${i.name}` : `${i.key}|${i.at}|${i.name}|${i.size}`)).join('\n');
      if (sig === S.sig[kind] && !hadErr) return false;
      S.items[kind] = items;
      S.sig[kind] = sig;
      return true;
    }

    const allItems = () => [...S.items.files, ...S.items.projects, ...S.items.clips, ...S.items.assets];
    const findItem = key => (key ? allItems().find(i => i.key === key) || null : null);

    /* ---------------- live refresh: re-read only what changed ---------------- */
    const pending = new Set();
    let reloadT = 0;
    function reload(kind) {
      pending.add(kind);
      if (!reloadT) reloadT = later(runReload, 140);
    }
    async function runReload() {
      reloadT = 0;
      const kinds = [...pending];
      pending.clear();
      let changed = kinds.includes('paint');
      if (kinds.includes('files')) changed = refreshFiles() || changed;
      const jobs = kinds.filter(k => k === 'projects' || k === 'clips' || k === 'assets').map(loadSource);
      if (kinds.includes('files')) jobs.push(checkBytes());
      if (jobs.length) {
        const res = await Promise.all(jobs);
        if (S.dead) return;
        changed = res.some(Boolean) || changed;
      }
      if (changed) render();
    }
    const inScope = dir => {
      if (typeof dir !== 'string') return true;
      const d = vfs.norm(dir);
      if (d === '/' || d === '/home' || d === HOME) return true;
      return ROOTS.some(r => d === `${HOME}/${r}` || d.startsWith(`${HOME}/${r}/`));
    };
    /* the shortcuts gamefiles.js keeps for projects and clips decide whether
       "Show in Files" can work, so a change there only repaints the footer */
    const MIRRORS = [`${HOME}/Game Projects`, `${HOME}/Replays`];
    let footT = 0;
    offs.push(bus.on('fs:change', dir => {
      if (inScope(dir)) reload('files');
      else if (typeof dir === 'string' && MIRRORS.includes(vfs.norm(dir)) && !footT) footT = later(() => { footT = 0; paintFoot(); }, 120);
    }));
    offs.push(bus.on('media:change', () => reload('files')));
    offs.push(bus.on('projects:change', () => reload('projects')));
    offs.push(bus.on('clips:change', () => reload('clips')));
    offs.push(bus.on('assets:change', () => reload('assets')));
    /* Forge's captured thumbnails live in the store; a new one repaints the tiles */
    offs.push(store.sub('portal.forge.thumbs', () => reload('paint')));
    win.onFocus?.(() => { if (!S.dead) reload('assets'); });

    /* ==================================================================== */
    /*  view skeleton (built once; only the list and counts repaint)         */
    /* ==================================================================== */
    const sideEl = h('nav.app__side.dlx-side', { 'aria-label': 'Downloads sections' });
    const titleEl = h('h2.app__title.dlx-title', { id: `${uid}-title` });
    const countEl = h('span.dlx-count');
    const searchIn = h('input', {
      type: 'search', placeholder: 'Search', spellcheck: 'false', autocomplete: 'off',
      'aria-label': 'Search this view', 'aria-controls': `${uid}-lb`,
    });
    const searchBox = h('label.field.dlx-search', icon('search'), searchIn);
    const btnList = h('button', { type: 'button', 'aria-label': 'Show as list', title: 'List', dataset: { v: 'list' } }, icon('list'));
    const btnGrid = h('button', { type: 'button', 'aria-label': 'Show as grid', title: 'Grid', dataset: { v: 'grid' } }, icon('grid'));
    const viewSeg = h('div.tabs.dlx-seg', { role: 'group', 'aria-label': 'View' }, btnList, btnGrid);
    const sortSel = h('select.select.dlx-sort', { 'aria-label': 'Sort by' },
      SORTS.map(([v, label]) => h('option', { value: v, text: label })));
    sortSel.value = S.sort;
    const barEl = h('div.app__bar.dlx-bar',
      h('div.dlx-titlewrap', titleEl, countEl),
      h('div.dlx-tools', searchBox, viewSeg, sortSel));

    const hintId = `${uid}-hint`;
    const listHost = h('div.app__content.app__content--flush.dlx-content');
    const sumEl = h('div.dlx-sum');
    const flashEl = h('div.dlx-flash', { role: 'status', 'aria-live': 'polite' });

    const actBtn = (cls, ic, label, fn) => h(`button.btn.btn--sm.${cls}`, { type: 'button', onclick: fn }, icon(ic), h('span', { text: label }));
    const aLook = actBtn('dlx-a-look', 'eye', 'Quick Look', () => withSel(openQL));
    const aOpen = actBtn('dlx-a-open', 'external-link', 'Open', () => withSel(doOpen));
    const aShow = actBtn('dlx-a-show', 'folder', 'Show in Files', () => withSel(doShow));
    const aDown = actBtn('dlx-a-down', 'download', 'Download', () => withSel(doDownload));
    const aDel = actBtn('dlx-a-del', 'trash', 'Delete', () => withSel(doDelete));
    const aMore = h('button.ibtn.dlx-a-more', {
      type: 'button', 'aria-label': 'More actions', title: 'More actions', 'aria-haspopup': 'menu',
      onclick: e => withSel(it => { const r = e.currentTarget.getBoundingClientRect(); itemMenu(it, r.left, r.bottom + 4); }),
    }, icon('more-horizontal'));
    const actsEl = h('div.dlx-acts', { role: 'toolbar', 'aria-label': 'Selected item' }, aLook, aOpen, aShow, aDown, aDel, aMore);
    const footEl = h('div.app__bar.app__bar--foot.dlx-foot', sumEl, flashEl, actsEl);
    const mainEl = h('div.app__main.dlx-main', barEl, listHost, footEl,
      h('span.sr', { id: hintId, text: 'Space previews, Enter opens, Delete removes, Shift+F10 shows more actions.' }));
    const appEl = h('div.app.dlx', sideEl, mainEl);
    root.appendChild(appEl);

    function withSel(fn) { const it = findItem(S.selKey); if (it) fn(it); }

    /* ---------------- sidebar (built once, counts repaint) ---------------- */
    const sideBtns = new Map();
    {
      let group = null;
      for (const s of SECTIONS) {
        if (!group || group.dataset.g !== s.group) {
          group = h('div.side__group.dlx-side__group', { dataset: { g: s.group } }, h('div.side__label', { text: s.group }));
          sideEl.append(group);
        }
        const count = h('small.dlx-side__n');
        const b = h('button.side__item.dlx-side__item', { type: 'button', dataset: { sec: s.id }, onclick: () => go(s.id) },
          icon(s.icon), h('span', { text: s.label }), count);
        sideBtns.set(s.id, { b, count });
        group.append(b);
      }
    }
    const meterB = h('b');
    const meterS = h('small');
    const storeNote = h('div.dlx-side__note.dlx-side__warn', { hidden: true });
    sideEl.append(h('div.dlx-side__foot',
      h('div.side__meter', meterB, meterS),
      storeNote,
      h('div.dlx-side__note', { text: 'From Downloads, Pictures, Music and Videos, plus your game projects, Arcade clips and Asset Lab library. Files that come with StaticOS aren’t listed.' })));
    /* arrow keys walk the sections too */
    listen(sideEl, 'keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const btns = [...sideEl.querySelectorAll('.dlx-side__item')];
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
      const j = Math.max(0, Math.min(btns.length - 1, i + (fwd ? 1 : -1)));
      e.preventDefault();
      btns[j].focus();
    });

    function paintSide() {
      const counts = { recent: 0 };
      for (const s of SECTIONS) if (s.id !== 'recent') counts[s.id] = 0;
      const all = allItems();
      for (const it of all) counts[it.group]++;
      counts.recent = all.length;
      for (const s of SECTIONS) {
        const { b, count } = sideBtns.get(s.id);
        const on = s.id === S.section;
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
        const src = SOURCE_OF[s.id];
        const waiting = s.id === 'recent' ? !S.loaded.files : src && !S.loaded[src];
        const failed = src && src !== 'files' && S.err[src];
        count.textContent = waiting ? '…' : failed ? '!' : counts[s.id] ? String(counts[s.id]) : '';
        b.setAttribute('aria-label', `${s.label}${waiting ? ', loading' : failed ? ', could not be read' : `, ${plural(counts[s.id], 'item')}`}`);
      }
      meterB.textContent = all.length ? plural(all.length, 'item') : 'Nothing yet';
      meterS.textContent = all.length ? `${totalText(all).replace(/^(\S+ \S+)/, '$1 in all')}` : 'Things you make or save land here.';
      const off = !DB.persistent;
      storeNote.hidden = !off;
      storeNote.textContent = off ? 'This browser isn’t letting StaticOS keep data, so projects, clips and assets last only until StaticOS closes.' : '';
    }

    /* ---------------- bar ---------------- */
    function paintBar() {
      const sec = SEC[S.section];
      titleEl.textContent = sec.label;
      win.setSubtitle?.(sec.label);
      const v = viewOf(S.section);
      for (const b of [btnList, btnGrid]) {
        const on = b.dataset.v === v;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      searchIn.placeholder = S.section === 'recent' ? 'Search everything' : `Search ${sec.label.toLowerCase()}`;
    }
    listen(viewSeg, 'click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      S.views = { ...S.views, [S.section]: b.dataset.v };
      savePrefs();
      paintBar();
      paintList({ keepFocus: false });
    });
    listen(sortSel, 'change', () => {
      S.sort = SORTS.some(s => s[0] === sortSel.value) ? sortSel.value : 'new';
      savePrefs();
      paintList({ keepFocus: false, top: true });
    });
    let searchT = 0;
    listen(searchIn, 'input', () => {
      cancel(searchT);
      searchT = later(() => { S.q = searchIn.value; paintList({ keepFocus: false, top: true }); paintFoot(); }, 70);
    });
    listen(searchIn, 'keydown', e => {
      if (e.key === 'Escape') {
        if (searchIn.value) { e.preventDefault(); e.stopPropagation(); searchIn.value = ''; S.q = ''; paintList({ keepFocus: false }); paintFoot(); }
        else { e.preventDefault(); focusCurrent(); }
      } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
        if (!S.shown.length) return;
        e.preventDefault();
        cancel(searchT);
        if (S.q !== searchIn.value) { S.q = searchIn.value; paintList({ keepFocus: false, top: true }); paintFoot(); }
        const first = S.selKey && S.shown.some(i => i.key === S.selKey) ? S.selKey : S.shown[0]?.key;
        if (first) selectKey(first, { focus: true });
      }
    });

    /* ==================================================================== */
    /*  the list                                                            */
    /* ==================================================================== */
    const thumbOf = new WeakMap();            /* thumb element -> item, for the lazy loader */
    let io = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(entries => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          io.unobserve(en.target);
          if (en.target.classList.contains('dlx-more')) { grow(PAGE, { focus: false }); continue; }
          const it = thumbOf.get(en.target);
          if (it) loadThumb(en.target, it);
        }
      }, { root: listHost, rootMargin: '160px 0px' });
    }

    const sortFns = {
      new: (a, b) => ((Number.isFinite(b.at) ? b.at : -Infinity) - (Number.isFinite(a.at) ? a.at : -Infinity)) || collator.compare(a.name, b.name),
      old: (a, b) => ((Number.isFinite(a.at) ? a.at : Infinity) - (Number.isFinite(b.at) ? b.at : Infinity)) || collator.compare(a.name, b.name),
      name: (a, b) => collator.compare(a.name, b.name) || ((b.at || 0) - (a.at || 0)),
      size: (a, b) => ((Number.isFinite(b.size) ? b.size : -1) - (Number.isFinite(a.size) ? a.size : -1)) || collator.compare(a.name, b.name),
    };
    function visibleItems() {
      const all = allItems();
      const inSec = S.section === 'recent' ? all : all.filter(i => i.group === S.section);
      const terms = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hit = terms.length ? inSec.filter(i => terms.every(t => i.hay.includes(t))) : inSec;
      return { inSec, shown: [...hit].sort(sortFns[S.sort] || sortFns.new) };
    }

    function paintList({ keepFocus = true, top = false } = {}) {
      if (S.dead) return;
      const hadFocus = keepFocus && listHost.contains(document.activeElement);
      const scroll = top ? 0 : listHost.scrollTop;
      io?.disconnect();
      clear(listHost);

      const { inSec, shown } = visibleItems();
      S.shown = shown;
      S.inSecCount = inSec.length;
      countEl.textContent = inSec.length ? plural(inSec.length, 'item') : '';
      /* a fresh view (another section, another sort, a new search) starts at page one */
      if (top) S.limit = PAGE;
      S.limit = Math.max(PAGE, Math.min(S.limit, Math.max(PAGE, shown.length)));
      if (S.selKey && !shown.some(i => i.key === S.selKey)) S.selKey = null;

      const retry = s => () => { S.loaded[s] = false; S.err[s] = null; paintSide(); paintList({ keepFocus: false }); paintFoot(); reload(s); };
      const recent = S.section === 'recent';
      const waiting = recent ? ['projects', 'clips', 'assets'].filter(s => !S.loaded[s]) : [];

      /* banners: sources that could not be read, still reading, clip rows with no video */
      const notes = [];
      if (recent) {
        for (const s of ['projects', 'clips', 'assets']) {
          if (S.err[s]) notes.push(banner('alert', `Couldn’t read your ${SOURCE_NAME[s]}: ${S.err[s]}`, 'Try again', retry(s)));
        }
        if (waiting.length && inSec.length) notes.push(banner('clock', `Still reading your ${waiting.map(s => SOURCE_NAME[s]).join(', ')}…`));
      }
      if ((S.section === 'clips' || recent) && S.brokenClips && !S.err.clips) {
        notes.push(banner('info', `${plural(S.brokenClips, 'saved clip record')} ${S.brokenClips === 1 ? 'has' : 'have'} no video in this browser (a recording that was cut off), so ${S.brokenClips === 1 ? 'it isn’t' : 'they aren’t'} listed.`));
      }
      if (notes.length) listHost.append(h('div.dlx-banners', notes));

      const src = SOURCE_OF[S.section];
      if ((src && src !== 'files' && !S.loaded[src]) || (recent && waiting.length && !inSec.length)) {
        S.state = 'loading';
        const what = recent ? 'everything' : `your ${SOURCE_NAME[src]}`;
        listHost.append(h('div.empty.dlx-empty', { role: 'status' }, h('span.spinner'), h('b', { text: `Reading ${what}…` })));
      } else if (src && src !== 'files' && S.err[src]) {
        S.state = 'error';
        listHost.append(h('div.empty.dlx-empty', icon('alert'),
          h('b', { text: `Couldn’t read your ${SOURCE_NAME[src]}` }),
          h('small', { text: `${S.err[src]}. Nothing was changed.` }),
          h('div.dlx-empty__acts', h('button.btn.btn--sm', { type: 'button', onclick: retry(src) }, icon('refresh'), h('span', { text: 'Try again' })))));
      } else if (!inSec.length) {
        S.state = 'empty';
        listHost.append(emptyState());
      } else if (!shown.length) {
        S.state = 'nomatch';
        listHost.append(noMatches());
      } else {
        S.state = 'list';
        listHost.append(...buildListbox(shown));
      }
      listHost.scrollTop = scroll;
      if (hadFocus) focusCurrent();
    }

    function banner(ic, text, actLabel, act) {
      return h('div.dlx-banner', icon(ic), h('span', { text }),
        actLabel ? h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: act }, h('span', { text: actLabel })) : null);
    }

    function launcher(appId, label, ic, o) {
      const a = api.getApp(appId);
      if (!a) return null;
      return h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp(appId, o || {}) }, icon(ic || a.icon), h('span', { text: label || `Open ${a.name}` }));
    }
    function emptyState() {
      const E = {
        recent: ['download', 'Nothing yet', 'Screenshots, recordings, exports and saved files land here — from Camera, Paint, Piano, Beats, Forge, the Arcade, Asset Lab and anything you import.',
          [launcher('camera'), launcher('forge'), launcher('arcade')]],
        images: ['image', 'No images yet', 'Screenshots, Camera photos and pictures you save from Paint, Palette or Graph land here.', [launcher('camera'), launcher('paint')]],
        videos: ['film', 'No videos yet', 'Camera recordings and videos you import into Videos or Downloads land here.', [launcher('camera'), launcher('videos')]],
        audio: ['music', 'No audio yet', 'Piano takes, Beats exports and songs you import into Music land here.', [launcher('piano'), launcher('beats')]],
        projects: ['sparkles', 'No game projects yet', 'Games you make in Static Forge or Static Studio land here, with their version history.', [launcher('forge'), launcher('studio')]],
        clips: ['play', 'No clips yet', 'Press Record while you play a canvas game in Static Arcade. Clips of up to 30 seconds land here.', [launcher('arcade')]],
        assets: ['layers', 'No assets yet', 'Sprites and sounds you save to the Asset Lab library land here.', [launcher('assetlab', null, null, { tab: 'library' })]],
        other: ['file', 'No other files', 'Anything else you import into Downloads, Pictures, Music or Videos with Files lands here.',
          [api.getApp('files') ? h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('files', { path: `${HOME}/Downloads` }) }, icon('folder'), h('span', { text: 'Open Downloads folder' })) : null]],
      }[S.section];
      const btns = (E[3] || []).filter(Boolean);
      return h('div.empty.dlx-empty', icon(E[0]), h('b', { text: E[1] }), h('small', { text: E[2] }),
        btns.length ? h('div.dlx-empty__acts', btns) : null);
    }
    function noMatches() {
      const sec = SEC[S.section];
      return h('div.empty.dlx-empty', icon('search'),
        h('b', { text: `No matches for “${S.q.trim()}”` }),
        h('small', { text: S.section === 'recent' ? 'Nothing you have made or saved matches. Try another word.' : `Nothing in ${sec.label} matches. Try another word, or search everything.` }),
        h('div.dlx-empty__acts',
          S.section !== 'recent' ? h('button.btn.btn--sm', { type: 'button', onclick: () => go('recent', { keepQuery: true }) }, icon('search'), h('span', { text: 'Search everything' })) : null,
          h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { searchIn.value = ''; S.q = ''; paintList({ keepFocus: false }); paintFoot(); searchIn.focus(); } }, h('span', { text: 'Clear search' }))));
    }

    /** Paint more of the list. Everything off screen is still counted — only the
        rows are held back, so a folder with thousands of files opens at once. */
    function grow(by, { focus = true } = {}) {
      if (S.dead || S.limit >= S.shown.length) return;
      const at = S.limit;
      /* a page arriving must not move the view or drop focus: put focus back on
         the same row afterwards, and never scroll to it */
      const hadKey = document.activeElement?.closest?.('.dlx-opt')?.dataset.key || null;
      S.limit = Math.min(S.shown.length, S.limit + Math.max(1, by));
      paintList({ keepFocus: false });
      paintFoot();
      const more = focus ? listHost.querySelector('.dlx-more button') : null;
      if (more) { more.focus({ preventScroll: true }); return; }
      const back = hadKey ? optFor(hadKey) : null;
      if (back) back.focus({ preventScroll: true });
      else if (focus) { const el = optEls()[at]; if (el) { el.focus({ preventScroll: true }); reveal(el); } }
    }
    /** make sure a given row is painted (Quick Look can step past the painted page) */
    function ensurePainted(key) {
      const i = S.shown.findIndex(x => x.key === key);
      if (i < 0 || i < S.limit) return false;
      S.limit = Math.min(S.shown.length, Math.ceil((i + 1) / PAGE) * PAGE);
      paintList({ keepFocus: true });
      return true;
    }
    function moreRow(total, limit) {
      const left = total - limit;
      const step = Math.min(PAGE, left);
      return h('div.dlx-more',
        h('small', { text: `Showing ${limit.toLocaleString()} of ${total.toLocaleString()}` }),
        h('button.btn.btn--sm', { type: 'button', onclick: () => grow(step) }, icon('chevron-down'), h('span', { text: `Show ${step.toLocaleString()} more` })),
        left > step ? h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => grow(left) }, h('span', { text: `Show all ${total.toLocaleString()}` })) : null);
    }

    /** -> [listbox] or [listbox, more]: only the first page of rows is built,
        and every row still says which of how many it is. */
    function buildListbox(all) {
      const view = viewOf(S.section);
      const shown = all.length > S.limit ? all.slice(0, S.limit) : all;
      const lb = h('div.dlx-lb', {
        role: 'listbox', id: `${uid}-lb`, class: view === 'grid' ? 'is-grid' : 'is-list',
        'aria-label': SEC[S.section].label, 'aria-describedby': hintId,
      });
      const grouped = S.sort === 'new' || S.sort === 'old';
      let n = 0;
      if (grouped) {
        const now = Date.now();
        let cur = null, box = null;
        for (const it of shown) {
          const b = bucketOf(it.at, now);
          if (!cur || cur.key !== b.key) {
            cur = b;
            box = h('div.dlx-grp__items');
            lb.append(h('div.dlx-grp', { role: 'group', 'aria-label': b.label },
              h('div.dlx-grp__h', { 'aria-hidden': 'true', text: b.label }), box));
          }
          box.append(optionEl(it, view, ++n, all.length));
        }
      } else {
        const box = h('div.dlx-grp__items');
        for (const it of shown) box.append(optionEl(it, view, ++n, all.length));
        lb.append(h('div.dlx-grp.dlx-grp--flat', box));
      }
      /* roving tab stop: the selected row, or the first */
      const stop = (S.selKey && lb.querySelector(`[data-key="${CSS.escape(S.selKey)}"]`)) || lb.querySelector('.dlx-opt');
      if (stop) stop.tabIndex = 0;
      if (shown.length >= all.length) return [lb];
      /* the "show more" row sits outside the listbox: it is not one of the options */
      const more = moreRow(all.length, shown.length);
      if (io) io.observe(more);
      return [lb, more];
    }

    function describe(it) {
      return [it.name, `${it.kindLabel}${it.detail ? `, ${it.detail}` : ''}`, noData(it) ? 'no data stored' : bytesText(it.size),
        it.where, Number.isFinite(it.at) ? fullDate(it.at) : 'date unknown'].join('. ');
    }
    function optionEl(it, view, pos, total) {
      const sel = it.key === S.selKey;
      const gone = noData(it);
      const props = {
        role: 'option', tabindex: '-1', 'aria-selected': sel ? 'true' : 'false', 'aria-label': describe(it),
        'aria-posinset': String(pos), 'aria-setsize': String(total),
        dataset: { key: it.key, group: it.group }, class: [sel && 'is-sel', gone && 'is-hollow'].filter(Boolean).join(' ') || null,
      };
      const sub = [it.kindLabel, it.detail, it.where].filter(Boolean).join(' · ');
      if (view === 'grid') {
        return h('div.dlx-opt.dlx-tile', props,
          thumbEl(it, 'tile'),
          h('span.dlx-tile__n', { text: it.name, title: it.name }),
          h('small.dlx-tile__m', { text: `${gone ? 'No data' : bytesText(it.size)} · ${agoText(it.at)}` }));
      }
      return h('div.dlx-opt.dlx-row', props,
        thumbEl(it, 'row'),
        h('span.dlx-row__t',
          h('span.dlx-row__n', h('span', { text: it.name, title: it.name }), gone ? h('span.dlx-nodata', { text: 'No data' }) : null),
          h('small.dlx-row__s', { text: sub }),
          h('small.dlx-row__nm', { text: `${gone ? 'No data' : bytesText(it.size)} · ${agoText(it.at)}` })),
        h('small.dlx-row__size', { text: gone ? 'No data' : bytesText(it.size) }),
        h('small.dlx-row__date', { text: agoText(it.at), title: fullDate(it.at) }));
    }

    /* ---------------- thumbnails ---------------- */
    function forgeThumb(p) {
      const th = store.get('portal.forge.thumbs', null);
      const s = (th && typeof th === 'object' ? th[p.id] : null) || p.published?.thumbnail;
      return isImageDataUrl(s) ? s : null;
    }
    function thumbEl(it, size) {
      const th = h(`span.dlx-th.dlx-th--${size}`, { 'aria-hidden': 'true', dataset: { kind: it.tint } }, icon(it.glyph));
      if (it.src === 'file') {
        if (noData(it)) th.classList.add('is-broken');
        if (noBytes(it)) return th;          /* its bytes are gone: nothing to read a picture out of */
        if (it.isMedia && (it.mk === 'image' || it.mk === 'video')) {
          th.classList.add('is-pic');
          if (it.mk === 'video') th.append(h('span.dlx-th__play', icon('play', { fill: true })), h('span.dlx-th__dur'));
          const known = it.mk === 'video' ? FRAMES.get(it.ref) : null;
          if (known) paintFrame(th, known);
          else if (io) { thumbOf.set(th, it); io.observe(th); } else loadThumb(th, it);
        }
      } else if (it.src === 'clip') {
        th.classList.add('is-pic');
        th.append(h('span.dlx-th__play', icon('play', { fill: true })), h('span.dlx-th__dur', { text: lenText(it.clip.durationMs) }));
        const known = FRAMES.get(clipFrameKey(it));
        if (known) paintFrame(th, known, true);
        else if (io) { thumbOf.set(th, it); io.observe(th); } else loadThumb(th, it);
      } else if (it.src === 'project') {
        const src = forgeThumb(it.project);
        if (src) { th.classList.add('is-pic'); addImg(th, src); }
        else { th.classList.add('dlx-th--mono'); th.append(h('span.dlx-th__mono', { text: (it.name.trim()[0] || '?').toUpperCase() })); }
      } else if (it.src === 'asset') {
        if (it.sprite) {
          const c = spriteCanvas(it.sprite, 0);
          if (c) { th.classList.add('dlx-th--sprite', 'is-ready'); th.append(c); }
          else th.classList.add('is-broken');
        } else if (Array.isArray(it.asset.peaks) && it.asset.peaks.length) {
          th.classList.add('dlx-th--wave', 'is-ready');
          th.append(waveEl(it.asset.peaks, size === 'tile' ? 32 : 12));
        }
        if (!dataUrlParts(it.asset.kind === 'sprite' ? it.asset.png : it.asset.wav)) th.classList.add('is-broken');
      }
      return th;
    }
    const clipFrameKey = it => `clip:${String(it.clipKey)}|${it.size}`;
    function addImg(th, src) {
      const im = h('img', { alt: '', decoding: 'async', draggable: 'false' });
      im.onload = () => th.classList.add('is-ready');
      im.onerror = () => { im.remove(); th.classList.add('is-broken'); };
      im.src = src;
      th.append(im);
    }
    function paintFrame(th, f, isClip) {
      if (!f || f.error || !f.src) { th.classList.add('is-broken'); return; }
      addImg(th, f.src);
      if (!isClip && Number.isFinite(f.duration) && f.duration > 0) {
        const d = th.querySelector('.dlx-th__dur');
        if (d) d.textContent = lenText(f.duration * 1000);
      }
    }
    function loadThumb(th, it) {
      if (S.dead) return;
      if (it.src === 'file' && it.mk === 'image') {
        media.urlOf(it.node).then(url => {
          if (S.dead || !th.isConnected) return;
          if (url) addImg(th, url); else { th.classList.add('is-broken'); th.append(h('span.dlx-nodata.dlx-th__tag', { text: 'No data' })); }
        }, () => { if (!S.dead) th.classList.add('is-broken'); });
      } else if (it.src === 'file' && it.mk === 'video') {
        frameOf(it.ref, () => media.urlOf(it.node), null).then(f => { if (f && !S.dead && th.isConnected) paintFrame(th, f); });
      } else if (it.src === 'clip') {
        const blob = it.clip.blob;
        frameOf(clipFrameKey(it), () => { const u = URL.createObjectURL(blob); ownUrls.add(u); return u; },
          u => { ownUrls.delete(u); try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } })
          .then(f => { if (f && !S.dead && th.isConnected) paintFrame(th, f, true); });
      }
    }
    function waveEl(peaks, bars) {
      const vals = peaks.map(v => Math.max(0, Math.min(1, Number(v) || 0)));
      const out = h('span.dlx-wave');
      const step = vals.length / bars;
      for (let i = 0; i < bars; i++) {
        let m = 0;
        for (let j = Math.floor(i * step); j < Math.max(Math.floor(i * step) + 1, Math.floor((i + 1) * step)); j++) m = Math.max(m, vals[j] || 0);
        out.append(h('i', { style: { height: `${Math.max(6, Math.round(m * 100))}%` } }));
      }
      return out;
    }

    /* frame grabs: two at a time, per window, cancelled at teardown */
    const Q = { waiting: [], running: 0, jobs: new Map() };
    function frameOf(key, getUrl, release) {
      if (FRAMES.has(key)) return Promise.resolve(FRAMES.get(key));
      let job = Q.jobs.get(key);
      if (job) return job.promise;
      job = { key, cancelled: false, abort: null };
      job.promise = new Promise(res => { job.resolve = res; });
      job.run = async () => {
        let out = null, url = null;
        try {
          url = await getUrl();
          if (!job.cancelled) out = url ? await grabFrame(url, job) : { error: 'missing' };
        } catch (err) { out = { error: String(err?.message || err) }; }
        finally { if (url && release) release(url); }
        if (Q.jobs.get(key) === job) Q.jobs.delete(key);
        if (!job.cancelled && out) rememberFrame(key, out);
        job.resolve(job.cancelled ? null : out);
      };
      Q.jobs.set(key, job);
      Q.waiting.push(job);
      pump();
      return job.promise;
    }
    function pump() {
      while (!S.dead && Q.running < 2 && Q.waiting.length) {
        const job = Q.waiting.shift();
        if (job.cancelled) continue;
        Q.running++;
        job.run().finally(() => { Q.running--; pump(); });
      }
    }
    function cancelFrames() {
      for (const job of Q.jobs.values()) { job.cancelled = true; job.abort?.(); job.resolve(null); }
      Q.jobs.clear();
      Q.waiting.length = 0;
    }

    /* ---------------- selection + keyboard ---------------- */
    const optEls = () => [...listHost.querySelectorAll('.dlx-opt')];
    const optFor = key => (key ? listHost.querySelector(`.dlx-opt[data-key="${CSS.escape(key)}"]`) : null);
    function selectKey(key, { focus = false } = {}) {
      S.selKey = key || null;
      for (const el of listHost.querySelectorAll('.dlx-opt.is-sel')) {
        el.classList.remove('is-sel');
        el.setAttribute('aria-selected', 'false');
      }
      for (const el of listHost.querySelectorAll('.dlx-opt[tabindex="0"]')) el.tabIndex = -1;
      const el = optFor(S.selKey);
      if (el) {
        el.classList.add('is-sel');
        el.setAttribute('aria-selected', 'true');
        el.tabIndex = 0;
        if (focus) { el.focus({ preventScroll: true }); reveal(el); }
      } else {
        const first = listHost.querySelector('.dlx-opt');
        if (first) first.tabIndex = 0;
      }
      paintFoot();
    }
    /** scroll the list (only the list — never the window) so a row is in view, below any sticky header */
    function reveal(el) {
      const box = listHost.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const head = el.closest('.dlx-grp')?.querySelector('.dlx-grp__h');
      const pad = (head ? head.getBoundingClientRect().height : 0) + 6;
      if (r.top < box.top + pad) listHost.scrollTop -= (box.top + pad - r.top);
      else if (r.bottom > box.bottom - 6) listHost.scrollTop += (r.bottom - box.bottom + 6);
    }
    function focusCurrent() {
      const el = optFor(S.selKey) || listHost.querySelector('.dlx-opt[tabindex="0"]') || listHost.querySelector('.dlx-opt');
      if (el) { el.focus({ preventScroll: true }); reveal(el); } else searchIn.focus();
    }
    function moveSel(dir) {
      /* End means the end of the whole list, not the end of what is painted */
      if (dir === 'end' && S.limit < S.shown.length) { S.limit = S.shown.length; paintList({ keepFocus: true }); }
      const els = optEls();
      if (!els.length) return;
      const cur = optFor(S.selKey) || (document.activeElement?.closest?.('.dlx-opt')) || null;
      let i = cur ? els.indexOf(cur) : -1;
      let j = i;
      const grid = viewOf(S.section) === 'grid';
      if (dir === 'home') j = 0;
      else if (dir === 'end') j = els.length - 1;
      else if (i < 0) j = 0;
      else if (!grid) {
        if (dir === 'up') j = i - 1; else if (dir === 'down') j = i + 1; else return;
      } else if (dir === 'left') j = i - 1;
      else if (dir === 'right') j = i + 1;
      else {
        /* up/down in a grid: the nearest tile, by position, in the next row */
        const r = els[i].getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const down = dir === 'down';
        let bestRow = null, best = null, bestDx = Infinity;
        for (const el of els) {
          if (el === els[i]) continue;
          const q = el.getBoundingClientRect();
          if (down ? q.top < r.bottom - 2 : q.bottom > r.top + 2) continue;
          const rowY = down ? q.top : q.bottom;
          if (bestRow === null || (down ? rowY < bestRow - 2 : rowY > bestRow + 2)) { bestRow = rowY; best = null; bestDx = Infinity; }
          if (Math.abs(rowY - bestRow) > 2) continue;
          const dx = Math.abs(q.left + q.width / 2 - cx);
          if (dx < bestDx) { bestDx = dx; best = el; }
        }
        if (!best) return stepPastPage(dir);
        j = els.indexOf(best);
      }
      j = Math.max(0, Math.min(els.length - 1, j));
      if (j === i && (dir === 'down' || dir === 'right')) return stepPastPage(dir);
      selectKey(els[j].dataset.key, { focus: true });
    }
    /** at the end of what is painted with more to come: paint the next page and carry on */
    function stepPastPage(dir) {
      if (S.limit >= S.shown.length) return;
      S.limit = Math.min(S.shown.length, S.limit + PAGE);
      paintList({ keepFocus: true });
      moveSel(dir);
    }

    listen(listHost, 'click', e => {
      const opt = e.target.closest('.dlx-opt');
      if (!opt) {
        if (!e.target.closest('button,a,input,select,label')) selectKey(null);
        return;
      }
      selectKey(opt.dataset.key, { focus: true });
      /* phones: one tap previews, like a gallery */
      if (e.pointerType === 'touch') { const it = findItem(opt.dataset.key); if (it) openQL(it); }
    });
    listen(listHost, 'dblclick', e => {
      const opt = e.target.closest('.dlx-opt');
      const it = opt && findItem(opt.dataset.key);
      if (it) doOpen(it);
    });
    listen(listHost, 'contextmenu', e => {
      const opt = e.target.closest('.dlx-opt');
      if (!opt) {
        if (e.target.closest('input,textarea')) return;
        e.preventDefault();
        viewMenu(e.clientX, e.clientY);
        return;
      }
      e.preventDefault();
      selectKey(opt.dataset.key, { focus: true });
      const it = findItem(opt.dataset.key);
      if (it) itemMenu(it, e.clientX, e.clientY);
    });
    listen(listHost, 'keydown', e => {
      const opt = e.target.closest?.('.dlx-opt');
      if (!opt) return;
      const it = findItem(opt.dataset.key);
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
        if (e.altKey || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        moveSel({ ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end' }[k]);
      } else if (k === 'Enter') {
        e.preventDefault();
        if (it) doOpen(it);
      } else if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (it) { selectKey(it.key); openQL(it); }
      } else if (k === 'Delete' || (k === 'Backspace' && (e.metaKey || !e.ctrlKey))) {
        e.preventDefault();
        if (it) doDelete(it);
      } else if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
        e.preventDefault();
        const r = opt.getBoundingClientRect();
        if (it) itemMenu(it, r.left + Math.min(40, r.width / 2), r.top + Math.min(r.height, 36));
      }
    });
    /* Ctrl/⌘+F and / jump to search while this window has focus */
    listen(appEl, 'keydown', e => {
      if (S.ql) return;
      const typing = e.target.closest?.('input,textarea,select');
      if (((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchIn.focus();
        searchIn.select();
      }
    });

    /* ---------------- footer: what is selected, and what you can do with it ---------------- */
    let flashT = 0;
    function flash(text, tone, action) {
      cancel(flashT);
      clear(flashEl);
      flashEl.classList.toggle('is-bad', tone === 'bad');
      flashEl.append(h('span', { text }));
      if (action) flashEl.append(h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { action.run(); clearFlash(); } }, h('span', { text: action.label })));
      footEl.classList.add('has-flash');
      flashT = later(clearFlash, action ? 9000 : 6000);
    }
    function clearFlash() { cancel(flashT); flashT = 0; clear(flashEl); footEl.classList.remove('has-flash'); }

    function paintFoot() {
      const it = S.selKey ? S.shown.find(i => i.key === S.selKey) || null : null;
      clear(sumEl);
      actsEl.hidden = !it;
      footEl.classList.toggle('has-sel', !!it);
      if (it) {
        sumEl.append(h('b', { text: it.name, title: it.name }),
          h('small', { text: [it.kindLabel, noData(it) ? 'No data' : bytesText(it.size), agoText(it.at)].join(' · ') }));
        const t = openTarget(it);
        aOpen.disabled = !t;
        aOpen.title = t ? t.label : openBlocked(it);
        aOpen.setAttribute('aria-label', t ? t.label : 'Open (not available)');
        const f = filesTarget(it);
        aShow.disabled = !f;
        aShow.title = f ? 'Show in Files' : showBlocked(it);
        const canDl = downloadable(it);
        aDown.disabled = !canDl;
        aDown.title = canDl ? 'Download to computer' : 'Nothing to download: no bytes are stored for it';
        aDel.title = it.src === 'file' ? 'Move to Trash' : 'Delete for good';
        aDel.setAttribute('aria-label', it.src === 'file' ? 'Move to Trash' : 'Delete permanently');
        aLook.title = 'Quick Look (Space)';
      } else {
        const shown = S.shown;
        const q = S.q.trim();
        sumEl.append(h('small', {
          text: S.state === 'loading' ? 'Reading…'
            : S.state === 'error' ? 'Couldn’t be read'
              : !S.inSecCount ? 'Nothing here yet'
                : q ? `${shown.length} of ${plural(S.inSecCount, 'item')} match “${q}”`
                  : `${plural(shown.length, 'item')} · ${totalText(shown)}`,
        }));
      }
    }

    /* ==================================================================== */
    /*  actions                                                             */
    /* ==================================================================== */
    function openTarget(it) {
      if (it.src === 'file') {
        const n = vfs.node(it.path);
        if (!n) return null;
        const app = api.appForFile(n);
        return app ? { label: `Open in ${app.name}`, run: () => api.openFile(it.path) } : null;
      }
      if (it.src === 'project') {
        const order = it.project.source === 'studio' ? ['studio', 'forge'] : ['forge', 'studio'];
        const id = order.find(a => api.getApp(a));
        return id ? { label: `Open in ${api.getApp(id).name}`, run: () => api.openApp(id, { project: it.project.id }) } : null;
      }
      if (it.src === 'clip') {
        const lib = api.getApp('aether-library');
        if (lib) return { label: `Play in ${lib.name}`, run: () => api.openApp('aether-library', { url: `static://library/clips/${encodeURIComponent(String(it.clipKey))}` }) };
        const arc = api.getApp('arcade');
        return arc ? { label: `Show in ${arc.name}`, run: () => api.openApp('arcade', { view: 'clips' }) } : null;
      }
      if (it.src === 'asset') {
        const al = api.getApp('assetlab');
        return al ? { label: `Open in ${al.name}`, run: () => api.openApp('assetlab', { tab: 'library' }) } : null;
      }
      return null;
    }
    const openBlocked = it => (it.src === 'file' && !vfs.node(it.path) ? 'It is no longer there' : 'The app that opens this isn’t in this build');
    function mirrorPath(dir, test) {
      for (const n of vfs.ls(dir)) {
        if (n.type !== 'file') continue;
        let j = null;
        try { j = JSON.parse(n.content || '{}'); } catch (e) { continue; }
        if (j && test(j)) return `${dir}/${n.name}`;
      }
      return null;
    }
    function filesTarget(it) {
      if (!api.getApp('files')) return null;
      if (it.src === 'file') return vfs.node(it.path) ? it.path : null;
      if (it.src === 'project') return mirrorPath(`${HOME}/Game Projects`, j => j.kind === 'creation' && j.id === it.project.id);
      if (it.src === 'clip') { const id = it.clip.id || it.clipKey; return mirrorPath(`${HOME}/Replays`, j => j.kind === 'clip' && j.clipId === id); }
      return null;
    }
    function showBlocked(it) {
      if (!api.getApp('files')) return 'Files isn’t in this build';
      if (it.src === 'asset') return 'Asset Lab keeps its library outside Files';
      if (it.src === 'project') return 'Its shortcut isn’t in ~/Game Projects yet';
      if (it.src === 'clip') return 'Its shortcut isn’t in ~/Replays yet';
      return 'It is no longer there';
    }
    function downloadable(it) {
      if (it.src === 'file') return !noData(it);
      if (it.src === 'asset') return !!dataUrlParts(it.asset.kind === 'sprite' ? it.asset.png : it.asset.wav);
      return true;
    }

    function doOpen(it) {
      const t = openTarget(it);
      if (!t) { flash(`Can’t open “${it.name}”: ${openBlocked(it).toLowerCase()}.`, 'bad'); return; }
      try { t.run(); } catch (err) { flash(`Couldn’t open “${it.name}” (${errText(err)}).`, 'bad'); }
    }
    function doShow(it) {
      const p = filesTarget(it);
      if (!p) { flash(`${showBlocked(it)}.`, 'bad'); return; }
      api.openApp('files', { path: p });
    }

    function saveBlob(blob, name) {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name, hidden: true });
      document.body.appendChild(a);
      a.click();
      a.remove();
      const t = setTimeout(() => { dlUrls.delete(t); try { URL.revokeObjectURL(url); } catch (e) { /* gone */ } }, 30000);
      dlUrls.set(t, url);
    }
    async function doDownload(it) {
      let blob = null;
      let name = it.name;
      try {
        if (it.src === 'file') {
          const n = vfs.node(it.path);
          if (!n) { flash(`“${it.name}” is no longer there.`, 'bad'); return; }
          if (media.isMedia(n)) {
            blob = await media.blobOf(n);
            if (!blob) { flash(`The bytes for “${n.name}” are missing from this browser, so there is nothing to download.`, 'bad'); return; }
          } else if (typeof n.content === 'string' && n.content.length) {
            blob = new Blob([n.content], { type: `${TEXT_MIME[extOf(n.name)] || 'text/plain'};charset=utf-8` });
          } else if (!n.size) {
            blob = new Blob([], { type: 'text/plain' });
          } else {
            flash(`“${n.name}” has no content in this browser, so there is nothing to download.`, 'bad');
            return;
          }
          name = n.name;
        } else if (it.src === 'project') {
          const p = (await Projects.get(it.project.id)) || it.project;
          const html = Projects.current(p);
          if (!html) { flash(`“${it.name}” has no HTML saved yet, so there is nothing to download.`, 'bad'); return; }
          blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          name = `${safeName(p.name)}.html`;
        } else if (it.src === 'clip') {
          blob = it.clip.blob;
          const ext = /mp4/.test(blob.type || it.clip.mime || '') ? 'mp4' : 'webm';
          name = `static-arcade-${safeName(it.clip.game || 'clip').replace(/\s+/g, '-')}-${stampOf(it.at)}.${ext}`;
        } else if (it.src === 'asset') {
          const sprite = it.asset.kind === 'sprite';
          blob = dataUrlBlob(sprite ? it.asset.png : it.asset.wav);
          if (!blob) { flash(`“${it.name}” has no ${sprite ? 'PNG' : 'WAV'} stored, so there is nothing to download.`, 'bad'); return; }
          name = `${safeName(it.name)}.${sprite ? 'png' : 'wav'}`;
        }
      } catch (err) {
        flash(`Couldn’t read “${it.name}” (${errText(err)}).`, 'bad');
        return;
      }
      if (S.dead || !blob) return;
      saveBlob(blob, name);
      flash(`Sent “${name}” (${bytesText(blob.size)}) to your browser’s downloads.`);
    }

    async function doDelete(it) {
      let ask;
      if (it.src === 'file') {
        ask = { title: `Move “${it.name}” to the Trash?`, message: `It leaves ${it.where}. You can put it back from the Trash in Files until the Trash is emptied.`, ok: 'Move to Trash', danger: true };
      } else if (it.src === 'project') {
        const p = it.project;
        ask = { title: `Delete “${it.name}” for good?`, message: `The game and all ${plural(it.versions, 'version')} are deleted from this browser${p.published ? ', and it leaves your Workshop' : ''}. Files you exported are not affected. This can’t be undone.`, ok: 'Delete', danger: true };
      } else if (it.src === 'clip') {
        ask = { title: 'Delete this clip for good?', message: `${it.name}${it.detail ? ` · ${it.detail}` : ''} · ${fullDate(it.at)}. Clips are kept only in this browser, so this can’t be undone.`, ok: 'Delete', danger: true };
      } else {
        ask = { title: `Delete “${it.name}” for good?`, message: `The ${it.kindLabel.toLowerCase()} is deleted from your Asset Lab library in this browser. Copies already added to a game project stay there. This can’t be undone.`, ok: 'Delete', danger: true };
      }
      const els = S.shown;
      const at = els.findIndex(i => i.key === it.key);
      const next = at >= 0 ? (els[at + 1] || els[at - 1] || null) : null;
      const ok = await confirm(ask);
      if (S.dead) return;
      if (!ok) {
        /* give focus back to where the question came from */
        if (S.ql) S.ql.wrap.focus({ preventScroll: true }); else focusCurrent();
        return;
      }
      try {
        if (it.src === 'file') {
          /* the very file that was asked about, not whatever is at that path now */
          const now = vfs.node(it.path);
          if (!now) throw new Error('it is no longer there');
          if (it.node && now !== it.node) throw new Error('a different file is at that path now');
          if (!vfs.rm(it.path)) throw new Error('it could not be moved');
        } else if (it.src === 'project') {
          await Projects.remove(it.project.id);
        } else if (it.src === 'clip') {
          await DB.kv('clips').del(it.clipKey);
          bus.emit('clips:change', { id: it.clip.id || it.clipKey, kind: 'delete' });
        } else {
          await DB.kv('assets').del(it.assetKey);
          bus.emit('assets:change', { id: it.asset.id, kind: 'delete' });
        }
      } catch (err) {
        if (!S.dead) flash(`Couldn’t delete “${it.name}” (${errText(err)}).`, 'bad');
        return;
      }
      if (S.dead) return;
      /* take it off screen now; the source re-read that follows confirms it */
      const srcKey = it.src === 'file' ? 'files' : it.src === 'project' ? 'projects' : it.src === 'clip' ? 'clips' : 'assets';
      S.items[srcKey] = S.items[srcKey].filter(i => i.key !== it.key);
      S.sig[srcKey] = '';
      if (S.ql && S.ql.key === it.key) closeQL({ refocus: false });
      S.selKey = next ? next.key : null;
      render();
      focusCurrent();
      if (it.src === 'file') {
        flash(`Moved “${it.name}” to the Trash.`, null, api.getApp('files') ? { label: 'Open Trash', run: () => api.openApp('files', { path: TRASH }) } : null);
      } else {
        flash(`Deleted “${it.name}”.`);
      }
      reload(srcKey);
    }

    function itemMenu(it, x, y) {
      const t = openTarget(it);
      const f = filesTarget(it);
      const alts = [];
      if (it.src === 'project') {
        const primary = it.project.source === 'studio' && api.getApp('studio') ? 'studio' : api.getApp('forge') ? 'forge' : 'studio';
        const other = primary === 'forge' ? 'studio' : 'forge';
        const a = api.getApp(other);
        if (a && t) alts.push({ label: `Open in ${a.name}`, icon: a.icon, onClick: () => api.openApp(other, { project: it.project.id }) });
      }
      if (it.src === 'clip' && api.getApp('arcade') && api.getApp('aether-library')) {
        alts.push({ label: `Show in ${api.getApp('arcade').name}`, icon: 'gamepad', onClick: () => api.openApp('arcade', { view: 'clips' }) });
      }
      menu([
        { label: 'Quick Look', icon: 'eye', hint: 'Space', onClick: () => openQL(it) },
        { label: t ? t.label : 'Open', icon: 'external-link', hint: 'Enter', disabled: !t, onClick: () => doOpen(it) },
        ...alts,
        { label: f ? 'Show in Files' : showBlocked(it), icon: 'folder', disabled: !f, onClick: () => doShow(it) },
        { label: downloadable(it) ? 'Download to computer' : 'Nothing to download', icon: 'download', disabled: !downloadable(it), onClick: () => doDownload(it) },
        '-',
        { label: it.src === 'file' ? 'Move to Trash' : 'Delete permanently…', icon: 'trash', hint: 'Del', danger: true, onClick: () => doDelete(it) },
      ], x, y);
    }
    function viewMenu(x, y) {
      const v = viewOf(S.section);
      const setView = nv => () => { S.views = { ...S.views, [S.section]: nv }; savePrefs(); paintBar(); paintList({ keepFocus: false }); };
      const setSort = ns => () => { S.sort = ns; sortSel.value = ns; savePrefs(); paintList({ keepFocus: false, top: true }); };
      menu([
        { label: 'As list', icon: 'list', checked: v === 'list', onClick: setView('list') },
        { label: 'As grid', icon: 'grid', checked: v === 'grid', onClick: setView('grid') },
        '-',
        ...SORTS.map(([id, label]) => ({ label, checked: S.sort === id, onClick: setSort(id) })),
        '-',
        { label: 'Read everything again', icon: 'refresh', onClick: () => { ['files', 'projects', 'clips', 'assets'].forEach(reload); } },
      ], x, y);
    }

    /* ==================================================================== */
    /*  Quick Look                                                          */
    /* ==================================================================== */
    function releaseQLMedia() {
      const q = S.ql;
      if (!q) return;
      for (const m of q.media) {
        try { m.pause(); } catch (e) { /* not playing */ }
        m.removeAttribute('src');
        try { m.load(); } catch (e) { /* released */ }
      }
      q.media = [];
      for (const u of q.urls) { ownUrls.delete(u); try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }
      q.urls = [];
      q.token++;
    }
    function openQL(it) {
      if (!it) return;
      if (!S.ql) {
        const titleId = `${uid}-qlt`;
        const descId = `${uid}-qld`;
        const wrap = h('div.dlx-ql', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': descId, tabindex: '-1' });
        S.ql = { key: null, wrap, titleId, descId, media: [], urls: [], token: 0 };
        wrap.addEventListener('keydown', onQLKey);
        wrap.addEventListener('pointerdown', e => { if (e.target === wrap) closeQL(); });
        appEl.append(wrap);
      }
      fillQL(it);
      S.ql.wrap.focus({ preventScroll: true });
    }
    function closeQL({ refocus = true } = {}) {
      const q = S.ql;
      if (!q) return;
      releaseQLMedia();
      q.wrap.remove();
      S.ql = null;
      if (refocus && !S.dead) focusCurrent();
    }
    function stepQL(d) {
      const q = S.ql;
      if (!q || !S.shown.length) return;
      const i = S.shown.findIndex(x => x.key === q.key);
      const j = i < 0 ? 0 : (i + d + S.shown.length) % S.shown.length;
      const it = S.shown[j];
      ensurePainted(it.key);
      selectKey(it.key);
      const el = optFor(it.key);
      if (el) reveal(el);
      fillQL(it);
      q.wrap.focus({ preventScroll: true });
    }
    function onQLKey(e) {
      const q = S.ql;
      if (!q) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQL(); return; }
      const inMedia = e.target.closest?.('video,audio,input,select,textarea,pre');
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inMedia) { e.preventDefault(); stepQL(e.key === 'ArrowLeft' ? -1 : 1); return; }
      if (e.key === ' ' && e.target === q.wrap) { e.preventDefault(); closeQL(); return; }
      if (e.key === 'Tab') {
        const f = [...q.wrap.querySelectorAll('button:not([disabled]),[href],video,audio,pre[tabindex],[tabindex="0"]')].filter(el => el.offsetParent !== null || el === document.activeElement);
        if (!f.length) { e.preventDefault(); return; }
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      }
    }

    function fillQL(it) {
      const q = S.ql;
      releaseQLMedia();
      q.key = it.key;
      const token = q.token;
      clear(q.wrap);
      const stage = h('div.dlx-ql__stage');
      const facts = h('div.dlx-ql__facts');
      const addFact = (k, v) => { if (v) facts.append(h('span', h('b', { text: k }), h('span', { text: v }))); };
      const t = openTarget(it);
      const f = filesTarget(it);
      const canDl = downloadable(it);
      const n = S.shown.length;
      const pos = S.shown.findIndex(x => x.key === it.key);

      const head = h('div.dlx-ql__head',
        h('span.dlx-ql__glyph', { dataset: { kind: it.tint }, 'aria-hidden': 'true' }, icon(it.glyph)),
        h('div.dlx-ql__t',
          h('b', { id: q.titleId, text: it.name, title: it.name }),
          h('small', { text: [it.kindLabel, noData(it) ? 'No data' : bytesText(it.size), it.where].filter(Boolean).join(' · ') })),
        h('div.dlx-ql__nav',
          h('button.ibtn', { type: 'button', 'aria-label': 'Previous item', title: 'Previous (←)', disabled: n < 2, onclick: () => stepQL(-1) }, icon('chevron-left')),
          h('span.dlx-ql__pos', { text: pos >= 0 ? `${pos + 1} of ${n}` : '' }),
          h('button.ibtn', { type: 'button', 'aria-label': 'Next item', title: 'Next (→)', disabled: n < 2, onclick: () => stepQL(1) }, icon('chevron-right'))),
        h('button.ibtn.dlx-ql__x', { type: 'button', 'aria-label': 'Close Quick Look', title: 'Close (Esc)', onclick: () => closeQL() }, icon('x')));

      const acts = h('div.dlx-ql__acts',
        h('button.btn.btn--sm.btn--primary', { type: 'button', disabled: !t, title: t ? t.label : openBlocked(it), onclick: () => doOpen(it) }, icon('external-link'), h('span', { text: t ? t.label : 'Open' })),
        h('button.btn.btn--sm', { type: 'button', disabled: !f, title: f ? 'Show in Files' : showBlocked(it), onclick: () => doShow(it) }, icon('folder'), h('span', { text: 'Show in Files' })),
        h('button.btn.btn--sm', { type: 'button', disabled: !canDl, onclick: () => doDownload(it) }, icon('download'), h('span', { text: 'Download' })),
        h('span.dlx-ql__sp'),
        h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: () => doDelete(it) }, icon('trash'), h('span', { text: it.src === 'file' ? 'Move to Trash' : 'Delete' })));

      const card = h('div.dlx-ql__card', head, stage, facts, acts,
        h('span.sr', { id: q.descId, text: 'Left and right arrows move between items. Escape closes.' }));
      q.wrap.append(card);

      const note = (ic, b, s) => h('div.dlx-ql__note', h('span.dlx-ql__big', icon(ic)), h('b', { text: b }), s ? h('small', { text: s }) : null);
      const waiting = () => h('div.dlx-ql__wait', h('span.spinner'), h('span', { text: 'Loading…' }));
      const alive = () => !S.dead && S.ql === q && q.token === token;
      const trackMedia = m => { q.media.push(m); return m; };

      addFact('Kind', `${it.kindLabel}${it.detail ? ` · ${it.detail}` : ''}`);
      addFact('Size', noData(it)
        ? `No data stored${Number.isFinite(it.size) && it.size > 0 ? ` (the file says ${bytesText(it.size)})` : ''}`
        : Number.isFinite(it.size) ? `${bytesText(it.size)}${it.size >= 1024 ? ` (${it.size.toLocaleString()} bytes)` : ''}` : 'Unknown');

      if (it.src === 'file') {
        addFact('Where', `~/${vfs.parentPath(it.path).slice(HOME.length + 1)}`);
        addFact('Modified', fullDate(it.at));
        if (noBytes(it)) {
          stage.append(note(it.glyph, 'The bytes are missing', `This file points at data this browser no longer has${Number.isFinite(it.size) && it.size > 0 ? ` — it is listed at ${bytesText(it.size)}, but none of it is stored here` : ''}, so it can’t be shown or downloaded.`));
        } else if (it.hollow) {
          stage.append(note('file', 'This file has no content in this browser', `It is listed at ${bytesText(it.size)}, but no bytes are stored for it here — there is nothing to show or download.`));
        } else if (it.isMedia && it.mk) {
          stage.append(waiting());
          media.urlOf(it.node).then(url => {
            if (!alive()) return;
            clear(stage);
            if (!url) { stage.append(note(it.glyph, 'The bytes are missing', 'This file points at data this browser no longer has, so it can’t be shown or downloaded.')); return; }
            if (it.mk === 'image') {
              const im = h('img.dlx-ql__img', { alt: it.name, decoding: 'async', draggable: 'false' });
              im.onload = () => { if (alive()) addFact('Pixels', `${im.naturalWidth} × ${im.naturalHeight}`); };
              im.onerror = () => { if (alive()) { clear(stage); stage.append(note('image', 'This picture can’t be shown', 'The browser could not decode it.')); } };
              im.src = url;
              stage.append(im);
            } else if (it.mk === 'video') {
              const v = trackMedia(h('video.dlx-ql__video', { controls: true, playsinline: true, preload: 'metadata', 'aria-label': it.name }));
              v.addEventListener('loadedmetadata', () => { if (alive()) { if (Number.isFinite(v.duration)) addFact('Length', lenText(v.duration * 1000)); if (v.videoWidth) addFact('Frame', `${v.videoWidth} × ${v.videoHeight}`); } }, { once: true });
              v.addEventListener('error', () => { if (alive()) { clear(stage); stage.append(note('film', 'This video can’t be played', mediaErr(v.error))); } }, { once: true });
              v.src = url;
              stage.append(v);
            } else {
              const a = trackMedia(h('audio', { controls: true, preload: 'metadata', 'aria-label': it.name }));
              a.addEventListener('loadedmetadata', () => { if (alive() && Number.isFinite(a.duration)) addFact('Length', lenText(a.duration * 1000)); }, { once: true });
              a.addEventListener('error', () => { if (alive()) { clear(stage); stage.append(note('music', 'This sound can’t be played', mediaErr(a.error))); } }, { once: true });
              a.src = url;
              stage.append(h('div.dlx-ql__note.dlx-ql__note--audio', h('span.dlx-ql__big', { dataset: { kind: 'audio' } }, icon('music')), h('b', { text: it.name }), a));
            }
          }, err => { if (alive()) { clear(stage); stage.append(note('alert', 'Couldn’t read it', errText(err))); } });
        } else {
          const n2 = it.node;
          const text = typeof n2.content === 'string' ? n2.content : '';
          if (it.isMedia) stage.append(note(it.glyph, 'No preview for this kind of file', 'Open it or download it instead.'));
          else if (!text.length) stage.append(note('file', 'This file is empty', 'There is nothing in it yet.'));
          else {
            const pre = h('pre.dlx-ql__text', { tabindex: '0', 'aria-label': `Contents of ${it.name}`, text: text.length > TEXT_PREVIEW_MAX ? `${text.slice(0, TEXT_PREVIEW_MAX)}\n\n… (${bytesText(text.length - TEXT_PREVIEW_MAX)} more — open it to see the rest)` : text });
            stage.append(pre);
          }
        }
      } else if (it.src === 'project') {
        const p = it.project;
        const versions = Array.isArray(p.versions) ? p.versions : [];
        addFact('Made in', it.where);
        addFact('Updated', fullDate(it.at));
        addFact('Created', fullDate(it.created));
        if (p.published) addFact('Published', fullDate(Number(p.published.at)));
        const src = forgeThumb(p);
        const hist = versions.map((v, i) => ({ v, i })).reverse().slice(0, 6);
        stage.append(h('div.dlx-ql__proj',
          src ? h('img.dlx-ql__pimg', { src, alt: `${it.name} — the picture Static Forge captured` })
            : h('div.dlx-ql__pmono', { 'aria-hidden': 'true' }, h('span', { text: (it.name.trim()[0] || '?').toUpperCase() }), icon('gamepad')),
          h('div.dlx-ql__hist',
            h('div.dlx-ql__histh', { text: `${plural(versions.length, 'version')} · showing version ${it.head + 1}` }),
            h('ol.dlx-ql__vers', hist.map(({ v, i }) => h('li', { class: i === it.head ? 'is-head' : null },
              h('b', { text: `v${i + 1}` }),
              h('span', { text: String(v?.note || 'Saved').slice(0, 90) }),
              h('small', { text: `${v?.by === 'ai' ? 'AI' : v?.by === 'revert' ? 'Restore' : 'You'} · ${agoText(Number(v?.at))}`, title: fullDate(Number(v?.at)) })))),
            versions.length > hist.length ? h('small.dlx-ql__more', { text: `…and ${plural(versions.length - hist.length, 'earlier version')}` }) : null)));
      } else if (it.src === 'clip') {
        addFact('Game', String(it.clip.game || ''));
        addFact('Recorded', fullDate(it.at));
        const url = URL.createObjectURL(it.clip.blob);
        ownUrls.add(url);
        q.urls.push(url);
        const v = trackMedia(h('video.dlx-ql__video', { controls: true, playsinline: true, preload: 'metadata', 'aria-label': `${it.name} clip` }));
        /* clips saved before Arcade wrote a duration into the file report an
           endless length: seek to the end once so the player learns it */
        v.addEventListener('loadedmetadata', () => {
          if (!alive()) return;
          if (v.videoWidth) addFact('Frame', `${v.videoWidth} × ${v.videoHeight}`);
          if (v.duration !== Infinity) return;
          const done = () => {
            cancel(tt);
            v.removeEventListener('durationchange', onDur);
            if (Number.isFinite(v.duration) && v.currentTime !== 0) v.currentTime = 0;
            v.controls = true;
          };
          const onDur = () => { if (Number.isFinite(v.duration)) done(); };
          const tt = later(done, 4000);
          v.controls = false;
          v.addEventListener('durationchange', onDur);
          v.currentTime = 1e101;
        }, { once: true });
        v.addEventListener('error', () => { if (alive()) { clear(stage); stage.append(note('film', 'This clip can’t be played', mediaErr(v.error))); } }, { once: true });
        v.src = url;
        stage.append(v);
      } else if (it.src === 'asset') {
        const a = it.asset;
        addFact('Saved', fullDate(it.at));
        if (a.kind === 'sprite') {
          if (it.sprite) {
            const sp = it.sprite;
            if (Number.isFinite(sp.fps) && sp.frames.length > 1) addFact('Speed', `${sp.fps} fps`);
            const big = spriteCanvas(sp, 0);
            const strip = sp.frames.length > 1
              ? h('div.dlx-ql__frames', sp.frames.slice(0, 24).map((_, i) => { const c = spriteCanvas(sp, i); return c ? h('span.dlx-ql__frame.dlx-checker', { title: `Frame ${i + 1}` }, c) : null; }),
                sp.frames.length > 24 ? h('small', { text: `+${sp.frames.length - 24} more` }) : null)
              : null;
            stage.append(h('div.dlx-ql__sprite',
              big ? h('div.dlx-ql__spbig.dlx-checker', { role: 'img', 'aria-label': `${it.name}, frame 1, ${sp.w} by ${sp.h} pixels` }, big) : note('image', 'This sprite can’t be drawn', 'Its pixels are not in a shape Static Downloads can read.'),
              strip));
          } else {
            stage.append(note('image', 'This sprite can’t be drawn', 'Its pixels are not in a shape Static Downloads can read. The PNG may still download.'));
          }
        } else {
          const p = dataUrlParts(a.wav);
          const box = h('div.dlx-ql__note.dlx-ql__note--audio');
          if (Array.isArray(a.peaks) && a.peaks.length) box.append(h('div.dlx-ql__wave', { 'aria-hidden': 'true' }, waveEl(a.peaks, a.peaks.length)));
          else box.append(h('span.dlx-ql__big', { dataset: { kind: 'audio' } }, icon('volume')));
          box.append(h('b', { text: it.name }));
          if (p) {
            const au = trackMedia(h('audio', { controls: true, preload: 'metadata', 'aria-label': it.name }));
            au.addEventListener('error', () => { if (alive()) box.append(h('small', { text: 'This browser could not play the WAV.' })); }, { once: true });
            au.src = a.wav;
            box.append(au);
          } else box.append(h('small', { text: 'No WAV is stored for this sound.' }));
          stage.append(box);
        }
      }
    }

    /* ==================================================================== */
    /*  navigation, render, responsive, opts                                */
    /* ==================================================================== */
    function go(id, { keepQuery = false } = {}) {
      if (!SEC[id]) return;
      if (S.section !== id) {
        S.section = id;
        S.selKey = null;
        savePrefs();
      }
      if (!keepQuery && S.q) { S.q = ''; searchIn.value = ''; }
      clearFlash();
      render({ top: true, keepFocus: false });
      if (S.narrow) keepChip(sideBtns.get(id)?.b);
    }
    /* on a phone the sections are a sideways strip: keep the current one in view
       (by scrolling the strip itself — scrollIntoView could nudge the window) */
    function keepChip(b) {
      if (!b || !sideEl.clientWidth) return;
      const r = b.getBoundingClientRect();
      const s = sideEl.getBoundingClientRect();
      if (r.left < s.left) sideEl.scrollLeft -= (s.left - r.left) + 16;
      else if (r.right > s.right) sideEl.scrollLeft += (r.right - s.right) + 16;
    }

    function render({ top = false, keepFocus = true } = {}) {
      if (S.dead) return;
      paintSide();
      paintBar();
      paintList({ top, keepFocus });
      paintFoot();
      if (S.ql && !findItem(S.ql.key)) {
        closeQL({ refocus: false });
        flash('The item you were looking at is gone.');
      }
    }

    let ro = null;
    const setNarrow = w => {
      const n = (w > 0 && w < NARROW) || document.body.classList.contains('is-mobile');
      if (n === S.narrow) return;
      S.narrow = n;
      appEl.classList.toggle('is-narrow', n);
    };
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => { if (!S.dead) setNarrow(entries[0]?.contentRect?.width || appEl.clientWidth); });
      ro.observe(appEl);
    } else setNarrow(appEl.clientWidth || win.w || 900);

    function applyOpts(o) {
      if (!o || typeof o !== 'object' || S.dead) return;
      if (typeof o.q === 'string') { searchIn.value = o.q.slice(0, 120); S.q = searchIn.value; }
      if (SEC[o.view]) go(o.view, { keepQuery: typeof o.q === 'string' });
      else if (typeof o.q === 'string') render({ top: true, keepFocus: false });
      if (typeof o.path === 'string') {
        const key = `f:${vfs.norm(o.path)}`;
        const it = S.items.files.find(i => i.key === key);
        if (it) {
          if (S.section !== 'recent' && S.section !== it.group) go(it.group);
          selectKey(key, { focus: true });
        }
      }
    }
    win.onReopen?.(o => applyOpts(o));

    /* ---------------- first paint: files now, the rest as it arrives ---------------- */
    refreshFiles();
    render({ top: true, keepFocus: false });
    checkBytes().then(ch => { if (ch && !S.dead) render(); });
    for (const k of ['projects', 'clips', 'assets']) {
      loadSource(k).then(() => { if (!S.dead) render(); });
    }
    if (opts && (opts.q || opts.path)) applyOpts({ q: opts.q, path: opts.path });

    /* ---------------- teardown ---------------- */
    return () => {
      if (S.dead) return;
      closeQL({ refocus: false });
      S.dead = true;
      cancelFrames();
      io?.disconnect();
      io = null;
      if (ro) { try { ro.disconnect(); } catch (e) { /* gone */ } ro = null; }
      for (const t of timers) clearTimeout(t);
      timers.clear();
      offs.splice(0).forEach(off => { try { off(); } catch (e) { /* already off */ } });
      for (const u of ownUrls) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }
      ownUrls.clear();
      for (const [t, u] of dlUrls) { clearTimeout(t); try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }
      dlUrls.clear();
    };
  },
});
