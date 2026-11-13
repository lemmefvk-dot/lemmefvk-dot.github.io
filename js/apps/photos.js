/* ============================================================
   Photos — the person's real pictures.

   The library is every image file under ~/Pictures (the vfs,
   walked recursively), newest first and grouped by the day each
   file was added or last changed. Albums are the folders under
   ~/Pictures — Camera and Screenshots, plus any the person makes
   here or in Files. Favourites are paths kept in store
   'portal.photos' { favs, size }.

   Every picture on screen is the file's own bytes. A vfs image is
   a reference (core/media.js) to a Blob in IndexedDB or to a file
   shipped with the site, and media.urlOf() gives a URL for <img>.
   A file with nothing behind it (an empty placeholder) is shown as
   "No image data" instead of being painted with something made up.
   An earlier Photos drew a CSS gradient for every file, listed two
   albums of files that did not exist, and invented camera models,
   lenses, apertures, ISO, shutter speeds and pixel sizes; all of
   that is gone.

   The info panel lists only what can be read or measured: name,
   folder, size in bytes (node.size), type (media.mimeOf), pixel
   dimensions (measured from the decoded image), when the file was
   last changed (node.mtime) and where its bytes are kept.

   Real actions: import (file picker, drag-and-drop, paste), take a
   screenshot (getDisplayMedia, one frame), download, rename, move
   to another album, Move to Trash (with Undo), Show in Files, set
   as wallpaper (1.5 MB at most, because wallpapers are saved with
   the settings in localStorage), favourite, and Mark up (opens the
   picture in js/apps/markup.js to draw on it).

   Object URLs from media.urlOf are shared with every other app and
   owned by media.js, so Photos never revokes them. The only URLs
   it makes itself (for downloads) it revokes itself.

   Edit (the viewer's sliders button, E, or a picture's menu) opens
   js/photos/edit.js over the window: crop, rotate, straighten and
   colour, saved from the file's full-resolution pixels as a copy,
   or over the original once that is confirmed.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import * as profiles from '../core/profiles.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-photos-css')) {
  const l = document.createElement('link');
  l.id = 'feat-photos-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-photos.css';
  document.head.appendChild(l);
}

const SIZES = [['S', 92], ['M', 138], ['L', 208]];
const PREF = 'portal.photos';
const WP_MAX = 1.5 * 1024 * 1024;       /* bytes: what a wallpaper may weigh */
const SHOW_MS = 4000;
const STRIP_MAX = 240;                  /* filmstrip renders a window this wide */
const ALBUM_ORDER = ['Camera', 'Screenshots'];
const TYPE_NAMES = {
  'image/jpeg': 'JPEG image', 'image/png': 'PNG image', 'image/gif': 'GIF image',
  'image/webp': 'WebP image', 'image/avif': 'AVIF image', 'image/svg+xml': 'SVG image',
  'image/bmp': 'BMP image', 'image/heic': 'HEIC image', 'image/tiff': 'TIFF image',
};

const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1) : ''; };
const stemOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; };
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const bytesExact = n => `${Number(n).toLocaleString()} byte${n === 1 ? '' : 's'}`;
const isImageName = n => media.kindOf(n) === 'image';
const pad2 = n => String(n).padStart(2, '0');

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} at ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`;
}

/* "Today", "Yesterday", a weekday within the week, else a short date */
function dayLabel(t) {
  if (!t) return 'Undated';
  const d = new Date(t), now = new Date();
  const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear()
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}
const dayKey = t => { if (!t) return 'none'; const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const fullDate = t => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown');

const readDataUrl = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error || new Error('The picture could not be read.'));
  r.readAsDataURL(blob);
});

defineApp({
  id: 'photos',
  name: 'Photos',
  icon: 'image',
  g1: '#ffc785', g2: '#dd5a20',
  category: 'Media',
  keywords: ['gallery', 'pictures', 'images', 'album', 'screenshots', 'camera roll', 'import', 'favourites'],
  desc: 'Your pictures: import, view, favourite and tidy them',
  pinned: true,
  singleton: true,
  handles: ['image'],
  win: { w: 900, h: 600, minW: 460, minH: 340 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['I', 'Information'],
    ['Left / Right', 'Previous / next photo (viewer)'],
    ['Home / End', 'First / last photo (viewer)'],
    ['Plus / -', 'Zoom in / out (viewer)'],
    ['0 / 1', 'Fit / actual size (viewer)'],
    ['F', 'Favourite (viewer)'],
    ['F2', 'Rename (viewer)'],
    ['Delete', 'Move to the Trash (viewer)'],
    ['Esc', 'Close the viewer'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, render, vfs, fmt, store, bus } = api;
    const BASE = `${vfs.HOME}/Pictures`;
    const TRASH = `${vfs.HOME}/Trash`;

    /* ---------------- preferences ------------- */
    const pref = () => { const v = store.get(PREF); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
    const setPref = patch => store.set(PREF, { ...pref(), ...patch });
    const favs = () => (Array.isArray(pref().favs) ? pref().favs.filter(p => typeof p === 'string') : []);
    const setFavs = list => setPref({ favs: [...new Set(list)] });
    const isFav = p => favs().includes(p);
    const reduced = () => !!store.get('prefs.reduceMotion')
      || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* ---------------- state ------------------- */
    const S = {
      view: 'all',                 /* 'all' | 'fav' | 'dir:<abs path>' */
      size: SIZES.some(s => s[0] === pref().size) ? pref().size : 'M',
      info: false,                 /* grid info panel */
      focus: null,                 /* path of the selected tile */
      lb: null,                    /* the item open in the viewer */
      lbInfo: false,
      show: 0,                     /* slideshow timer */
      renaming: null,              /* path being renamed */
      newAlbum: false,
      busy: '',
      est: null,                   /* navigator.storage.estimate() */
      dead: false,
    };
    let LIB = [], ALBUMS = [], VIEW = [];
    const dims = new Map();        /* content ref -> { w, h } measured */
    const broken = new Set();      /* refs the browser could not decode */
    const missing = new Set();     /* refs whose bytes are gone */
    const mimes = new Map();       /* content ref -> MIME type | null */
    const measuring = new Map();
    const tiles = new Map();       /* item key -> tile record */
    const tileOf = new WeakMap();
    const timers = new Set();
    const streams = new Set();
    const ownUrls = new Set();
    const offs = [];
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); if (!S.dead) fn(); }, ms);
      timers.add(t);
      return t;
    };
    const say = (title, message, extra) => api.notify({ app: 'Photos', icon: 'image', title, message, ...extra });
    const warn = (title, message) => api.notify({ app: 'Photos', icon: 'alert', title, message, timeout: 9000 });

    const tilde = p => (p === vfs.HOME ? '~' : p.startsWith(`${vfs.HOME}/`) ? `~${p.slice(vfs.HOME.length)}` : p);
    const inPics = p => typeof p === 'string' && (p === BASE || p.startsWith(`${BASE}/`));
    const folderName = dir => (dir === BASE ? 'Pictures' : vfs.baseName(dir));
    const albumIcon = name => (name === 'Camera' ? 'camera' : name === 'Screenshots' ? 'monitor' : 'folder');
    const viewDir = () => (S.view.startsWith('dir:') ? S.view.slice(4) : null);
    const importDir = () => viewDir() || BASE;
    const canCapture = () => !!navigator.mediaDevices?.getDisplayMedia;

    /* ---------------- the library ------------- */
    function itemOf(n, p) {
      const t = Date.parse(n.mtime);
      const ref = typeof n.content === 'string' ? n.content : '';
      return { node: n, path: p, name: n.name, dir: vfs.parentPath(p), mtime: Number.isFinite(t) ? t : 0,
        real: media.isMedia(n), ref, key: `${p}\n${ref}` };
    }
    const newestFirst = list => list.sort((a, b) => b.mtime - a.mtime
      || a.name.localeCompare(b.name, undefined, { numeric: true }));

    function scan() {
      const out = [];
      vfs.walk(BASE, (n, p) => {
        if (n.type !== 'file' || !isImageName(n.name) || p.includes('/.')) return;
        out.push(itemOf(n, p));
      });
      LIB = newestFirst(out);
      const rank = n => { const i = ALBUM_ORDER.indexOf(n); return i < 0 ? 99 : i; };
      ALBUMS = vfs.ls(BASE).filter(n => n.type === 'dir')
        .map(n => ({ name: n.name, path: `${BASE}/${n.name}` }))
        .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    }

    function viewItems() {
      if (S.view === 'fav') {
        const f = new Set(favs());
        const inside = LIB.filter(i => f.has(i.path));
        const outside = [...f].filter(p => !inPics(p)).map(p => [vfs.node(p), p])
          .filter(([n]) => n && n.type === 'file' && isImageName(n.name)).map(([n, p]) => itemOf(n, p));
        return newestFirst([...inside, ...outside]);
      }
      const d = viewDir();
      if (d && inPics(d)) return LIB.filter(i => i.path.startsWith(`${d}/`));
      if (d) {
        return newestFirst(vfs.ls(d).filter(n => n.type === 'file' && isImageName(n.name))
          .map(n => itemOf(n, `${d}/${n.name}`)));
      }
      return LIB;
    }

    function viewLabel() {
      if (S.view === 'fav') return 'Favourites';
      const d = viewDir();
      return d ? folderName(d) : 'Library';
    }

    function groups(list) {
      const out = [];
      let cur = null;
      for (const it of list) {
        const k = dayKey(it.mtime);
        if (!cur || cur.k !== k) { cur = { k, label: dayLabel(it.mtime), items: [] }; out.push(cur); }
        cur.items.push(it);
      }
      return out;
    }

    /* ---------------- chrome ------------------ */
    const seg = h('div.seg', { role: 'group', 'aria-label': 'Thumbnail size' }, SIZES.map(([label]) => h('button.tip.tip--below', {
      type: 'button', 'data-tip': `${label === 'S' ? 'Small' : label === 'M' ? 'Medium' : 'Large'} thumbnails`,
      'aria-label': `${label === 'S' ? 'Small' : label === 'M' ? 'Medium' : 'Large'} thumbnails`,
      dataset: { size: label },
      onclick: () => { S.size = label; setPref({ size: label }); paintSeg(); paintGrid(); },
    }, label)));
    const btnInfo = h('button.ibtn.tip.tip--below', {
      type: 'button', 'data-tip': 'Info (I)', 'aria-label': 'Show info', 'aria-pressed': 'false',
      onclick: () => (S.lb ? toggleLbInfo() : toggleInfo()),
    }, icon('info'));
    win.setTools(seg, btnInfo);

    const picker = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
    picker.addEventListener('change', () => {
      const files = [...(picker.files || [])];
      picker.value = '';
      if (files.length) importList(files);
    });

    const side = h('nav.app__side.ph-side', { 'aria-label': 'Albums' });
    const bar = h('div.app__bar.ph-bar');
    const scroller = h('div.ph-scroll', { tabindex: '-1' });
    const foot = h('div.app__bar.app__bar--foot.ph-foot');
    const info = h('aside.ph-info.hidden', { 'aria-label': 'Picture info' });
    const main = h('div.app__main', bar, scroller, foot);
    const app = h('div.app', side, main, info);
    const dropTitle = h('b');
    const drop = h('div.ph-drop', { hidden: true, 'aria-hidden': 'true' },
      h('div.ph-drop__card', icon('upload'), dropTitle, h('small', { text: 'JPEG, PNG, GIF, WebP, AVIF or SVG' })));
    const shell = h('div.ph', app, drop, picker);
    root.appendChild(shell);

    /* thumbnails are asked for only as they come near the view, so a big
       library never has hundreds of URLs requested at once */
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const t = tileOf.get(e.target);
        io.unobserve(e.target);
        if (t) loadThumb(t);
      }
    }, { root: scroller, rootMargin: '600px 0px' });

    /* ---------------- sidebar ----------------- */
    let albumInput = null;
    function paintSide() {
      clear(side);
      const item = (label, ic, key, count) => h('button.side__item', {
        type: 'button', class: key === S.view ? 'is-on' : null, 'aria-current': key === S.view ? 'page' : null,
        onclick: () => go(key),
      }, icon(ic), h('span', { text: label }), count != null ? h('small', { text: count.toLocaleString() }) : null);
      const favN = S.view === 'fav' ? VIEW.length : (() => {
        const f = new Set(favs());
        return LIB.filter(i => f.has(i.path)).length + [...f].filter(p => !inPics(p) && vfs.node(p)).length;
      })();
      side.append(
        h('div.side__group', h('div.side__label', { text: 'Photos' }),
          item('Library', 'image', 'all', LIB.length),
          item('Favourites', 'heart', 'fav', favN)),
        h('div.side__group', h('div.side__label', { text: 'Albums' }),
          ALBUMS.map(a => item(a.name, albumIcon(a.name), `dir:${a.path}`, LIB.filter(i => i.path.startsWith(`${a.path}/`)).length)),
          newAlbumRow()));
      const d = viewDir();
      if (d && !inPics(d)) {
        side.append(h('div.side__group', h('div.side__label', { text: 'Opened' }),
          item(folderName(d), 'folder-open', S.view, VIEW.length)));
      }
      /* in the narrow layout the albums are a scrolling row of pills */
      const on = side.querySelector('.side__item.is-on');
      if (on && side.scrollWidth > side.clientWidth + 1) {
        const a = on.getBoundingClientRect(), b = side.getBoundingClientRect();
        if (a.left < b.left || a.right > b.right) side.scrollLeft += a.left - b.left - 16;
      }
    }

    function newAlbumRow() {
      if (!S.newAlbum) {
        albumInput = null;
        return h('button.side__item.ph-side__new', { type: 'button', onclick: () => { S.newAlbum = true; paintSide(); } },
          icon('plus'), h('span', { text: 'New album' }));
      }
      if (albumInput) return albumInput.wrap;
      const input = h('input', { type: 'text', placeholder: 'Album name', 'aria-label': 'New album name', maxlength: '60', autocomplete: 'off' });
      const err = h('small.ph-side__err', { role: 'alert' });
      const done = () => { S.newAlbum = false; albumInput = null; paintSide(); };
      const make = () => {
        const name = input.value.trim().replace(/\s+/g, ' ');
        if (!name) { done(); return; }
        if (/[\\/]/.test(name) || name.startsWith('.')) { err.textContent = 'Use a name without / or \\ that does not start with a dot.'; return; }
        if (vfs.node(`${BASE}/${name}`)) { err.textContent = `Pictures already has something called “${name}”.`; return; }
        if (!vfs.node(BASE)) vfs.mkdir(BASE);
        if (!vfs.mkdir(`${BASE}/${name}`)) { err.textContent = 'The album folder could not be made.'; return; }
        S.newAlbum = false;
        albumInput = null;
        scan();
        go(`dir:${BASE}/${name}`);
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); make(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
      });
      input.addEventListener('blur', () => later(() => { if (S.newAlbum && albumInput?.input === input && !input.value.trim()) done(); }, 150));
      const wrap = h('div.ph-side__newf', h('div.field', icon('folder'), input), err);
      albumInput = { wrap, input };
      later(() => input.focus(), 0);
      return wrap;
    }

    /* ---------------- top bar ----------------- */
    function paintBar() {
      const real = VIEW.filter(i => i.real);
      const total = real.reduce((s, i) => s + (i.node.size || 0), 0);
      const empty = VIEW.length - real.length;
      const bits = [plural(VIEW.length, 'picture')];
      if (real.length) bits.push(total ? fmt.fmtBytes(total) : '0 bytes');
      if (empty) bits.push(`${empty} with no image data`);
      const d = viewDir();
      render(bar,
        h('div.ph-bar__t', h('h2.app__title', { text: viewLabel() }), h('small', { text: bits.join(' · ') })),
        h('div.grow'),
        S.busy ? h('span.ph-busy', { role: 'status' }, h('i.ph-spin'), h('span', { text: S.busy })) : null,
        d === `${BASE}/Screenshots` && canCapture() && VIEW.length
          ? h('button.btn', { type: 'button', onclick: takeScreenshot, 'aria-label': 'Take a screenshot', title: 'Take a screenshot' }, icon('monitor'), h('span.ph-bar__lbl', { text: 'Take screenshot' })) : null,
        d === `${BASE}/Camera` && VIEW.length
          ? h('button.btn', { type: 'button', onclick: () => api.openApp('camera'), 'aria-label': 'Open Camera', title: 'Open Camera' }, icon('camera'), h('span.ph-bar__lbl', { text: 'Open Camera' })) : null,
        h('button.btn.btn--primary', {
          type: 'button', title: `Import pictures into ${folderName(importDir())}`,
          'aria-label': `Import pictures into ${folderName(importDir())}`, disabled: !!S.busy,
          onclick: () => picker.click(),
        }, icon('upload'), h('span.ph-bar__lbl', { text: 'Import' })));
    }

    function paintFoot() {
      const e = S.est;
      render(foot,
        h('span.dim', { text: `${plural(LIB.length, 'picture')} · ${plural(ALBUMS.length, 'album')}` }),
        h('div.grow'),
        e && Number.isFinite(e.usage) && Number.isFinite(e.quota) && e.quota > 0
          ? h('span.dim.trunc.ph-foot__est', {
            text: `Browser storage: ${e.usage ? fmt.fmtBytes(e.usage) : '0 bytes'} of ~${fmt.fmtBytes(e.quota)} used (estimate)`,
            title: 'navigator.storage.estimate(): what this browser reports StaticOS is using, and roughly how much it allows',
          }) : null);
    }

    function estimate() {
      const p = navigator.storage?.estimate?.();
      if (!p) return;
      p.then(e => { if (S.dead) return; S.est = e; paintFoot(); }).catch(() => {});
    }

    /* ---------------- grid -------------------- */
    function paintSeg() {
      for (const b of seg.children) {
        const on = b.dataset.size === S.size;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }

    function paintGrid() {
      clear(scroller);
      if (!VIEW.length) { scroller.append(emptyState()); return; }
      const px = SIZES.find(s => s[0] === S.size)[1];
      const wrap = h('div.ph-days', { style: { '--ph-tile': `${px}px` } });
      for (const g of groups(VIEW)) {
        wrap.append(h('section.ph-day', { 'aria-label': `${g.label}, ${plural(g.items.length, 'picture')}` },
          h('header.ph-day__head', h('h3', { text: g.label }), h('small', { text: plural(g.items.length, 'picture') })),
          h('div.ph-grid', { role: 'list' }, g.items.map(tileFor))));
      }
      scroller.append(wrap);
      syncRoving();
    }

    function tileFor(item) {
      let t = tiles.get(item.key);
      if (t) { t.item = item; updateTile(t); return t.el; }
      const img = h('img.ph-tile__img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
      const cap = h('span.ph-tile__cap', { text: item.name });
      const open = h('button.ph-tile__open', { type: 'button', tabindex: '-1' }, img, cap);
      const favBtn = h('button.ph-tile__fav', { type: 'button', tabindex: '-1' });
      const el = h('div.ph-tile', { role: 'listitem' }, open, favBtn);
      t = { el, img, open, cap, favBtn, item, state: 'idle', tries: 0 };
      open.addEventListener('click', () => openLb(t.item));
      /* drag a picture into a note (js/apps/notes.js reads the path) */
      open.draggable = true;
      open.addEventListener('dragstart', e => { try { e.dataTransfer.setData('application/x-staticos-path', t.item.path); e.dataTransfer.effectAllowed = 'copy'; } catch (err) {} });
      open.addEventListener('focus', () => select(t.item));
      open.addEventListener('contextmenu', e => { e.preventDefault(); select(t.item); api.menu(menuItems(t.item, true), e.clientX, e.clientY); });
      favBtn.addEventListener('click', e => { e.stopPropagation(); toggleFav(t.item); });
      img.addEventListener('load', () => {
        t.state = 'ok';
        el.classList.add('is-loaded');
        const had = dims.has(t.item.ref);
        dims.set(t.item.ref, { w: img.naturalWidth, h: img.naturalHeight });
        if (!had) refreshFacts();
      });
      img.addEventListener('error', () => {
        if (!img.getAttribute('src')) return;
        /* media.js recycles its oldest object URLs; ask for a fresh one once */
        if (t.tries++ < 2 && img.src.startsWith('blob:')) { t.state = 'idle'; loadThumb(t); return; }
        broken.add(t.item.ref);
        noData(t, 'decode');
        refreshFacts();
      });
      tileOf.set(el, t);
      tiles.set(item.key, t);
      if (!item.real) noData(t, 'empty');
      else io.observe(el);
      updateTile(t);
      return el;
    }

    function loadThumb(t) {
      if (t.state !== 'idle') return;
      t.state = 'loading';
      media.urlOf(t.item.node).then(url => {
        if (S.dead) return;
        if (!url) { missing.add(t.item.ref); noData(t, 'missing'); refreshFacts(); return; }
        t.img.src = url;
      }).catch(() => { if (!S.dead) noData(t, 'missing'); });
    }

    function noData(t, why) {
      t.state = 'none';
      t.el.classList.add('is-none');
      t.el.dataset.none = why;
      t.img.hidden = true;
      t.img.removeAttribute('src');
      t.open.querySelector('.ph-tile__none')?.remove();
      t.open.insertBefore(h('span.ph-tile__none',
        icon(why === 'decode' ? 'alert' : 'image'),
        h('b', { text: why === 'decode' ? 'Can’t display' : 'No image data' }),
        h('small', { text: t.item.name })), t.cap);
      updateTile(t);
    }

    function updateTile(t) {
      const { item } = t;
      const f = isFav(item.path);
      t.el.classList.toggle('is-fav', f);
      t.el.classList.toggle('is-sel', item.path === S.focus);
      t.cap.textContent = item.name;
      clear(t.favBtn);
      t.favBtn.append(icon('heart', { fill: f }));
      t.favBtn.setAttribute('aria-label', f ? `Remove ${item.name} from Favourites` : `Add ${item.name} to Favourites`);
      t.favBtn.title = f ? 'Remove from Favourites' : 'Add to Favourites';
      const state = t.state === 'none' ? (t.el.dataset.none === 'decode' ? ', can’t be displayed' : ', no image data') : '';
      t.open.setAttribute('aria-label', `${item.name}${f ? ', favourite' : ''}${state}, ${dayLabel(item.mtime)}`);
      t.open.title = item.name;
    }

    const tileEls = () => [...scroller.querySelectorAll('.ph-tile')];
    function syncRoving() {
      const els = tileEls();
      if (!els.length) return;
      const cur = els.find(el => tileOf.get(el)?.item.path === S.focus) || els[0];
      for (const el of els) tileOf.get(el).open.tabIndex = el === cur ? 0 : -1;
    }
    function markSel() {
      for (const el of tileEls()) {
        const t = tileOf.get(el);
        el.classList.toggle('is-sel', t.item.path === S.focus);
      }
    }
    /* scroll a tile into view below the sticky day heading */
    function reveal(el, smooth) {
      const r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
      const head = 44;
      let dy = 0;
      if (r.top < s.top + head) dy = r.top - s.top - head;
      else if (r.bottom > s.bottom - 8) dy = r.bottom - s.bottom + 8;
      if (dy) scroller.scrollBy({ top: dy, behavior: smooth && !reduced() ? 'smooth' : 'auto' });
    }
    function focusTile(el) {
      if (!el) return;
      const t = tileOf.get(el);
      for (const x of tileEls()) tileOf.get(x).open.tabIndex = x === el ? 0 : -1;
      t.open.focus({ preventScroll: true });
      reveal(el, true);
    }
    function select(item) {
      if (!item || S.focus === item.path) return;
      S.focus = item.path;
      if (S.renaming && S.renaming !== item.path) S.renaming = null;
      markSel();
      if (S.info) paintInfo();
    }

    /* arrow keys walk the grid by position, across the day sections */
    function neighbour(els, i, key) {
      const r = els[i].getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const down = key === 'ArrowDown';
      const rows = els.map((el, j) => [el.getBoundingClientRect(), j])
        .filter(([b]) => (down ? b.top > r.top + r.height / 2 : b.bottom < r.bottom - r.height / 2));
      if (!rows.length) return null;
      const edge = down ? Math.min(...rows.map(([b]) => b.top)) : Math.max(...rows.map(([b]) => b.top));
      const row = rows.filter(([b]) => Math.abs(b.top - edge) < 2);
      row.sort((a, b) => Math.abs(a[0].left + a[0].width / 2 - cx) - Math.abs(b[0].left + b[0].width / 2 - cx));
      return els[row[0][1]];
    }

    scroller.addEventListener('keydown', e => {
      const open = e.target.closest?.('.ph-tile__open');
      if (!open || e.altKey || e.ctrlKey || e.metaKey) return;
      const els = tileEls();
      const i = els.indexOf(open.closest('.ph-tile'));
      const t = tileOf.get(els[i]);
      let next = null;
      switch (e.key) {
        case 'ArrowRight': next = els[i + 1]; break;
        case 'ArrowLeft': next = els[i - 1]; break;
        case 'ArrowDown': case 'ArrowUp': next = neighbour(els, i, e.key); break;
        case 'Home': next = els[0]; break;
        case 'End': next = els[els.length - 1]; break;
        case 'f': case 'F': toggleFav(t.item); break;
        case 'F2': startRename(t.item); break;
        case 'Delete': case 'Backspace': trash(t.item); break;
        case 'ContextMenu': {
          const r = open.getBoundingClientRect();
          api.menu(menuItems(t.item, true), r.left + r.width / 2, r.top + r.height / 2);
          break;
        }
        default:
          if (e.key === 'F10' && e.shiftKey) {
            const r = open.getBoundingClientRect();
            api.menu(menuItems(t.item, true), r.left + r.width / 2, r.top + r.height / 2);
            break;
          }
          return;
      }
      e.preventDefault();
      if (next) focusTile(next);
    });

    /* ---------------- empty states ------------ */
    function emptyState() {
      const d = viewDir();
      const b = (primary, ic, label, fn) => h(`button.btn${primary ? '.btn--primary' : ''}`, { type: 'button', onclick: fn }, icon(ic), h('span', { text: label }));
      const importBtn = primary => b(primary, 'upload', d ? `Import into ${folderName(d)}` : 'Import pictures', () => picker.click());
      const camBtn = primary => b(primary, 'camera', 'Open Camera', () => api.openApp('camera'));
      const shotBtn = primary => (canCapture() ? b(primary, 'monitor', 'Take a screenshot', takeScreenshot) : null);
      let ic = 'image', title, body, acts;
      if (S.view === 'fav') {
        ic = 'heart';
        title = 'No favourites yet';
        body = 'Press the heart on any picture (or F while it is selected) and it collects here.';
        acts = LIB.length ? [b(false, 'image', 'Go to Library', () => go('all'))] : [importBtn(true)];
      } else if (d === `${BASE}/Camera`) {
        ic = 'camera';
        title = 'No photos from Camera yet';
        body = 'Pictures you take with the Camera app are saved here.';
        acts = [camBtn(true), importBtn(false)];
      } else if (d === `${BASE}/Screenshots`) {
        ic = 'monitor';
        title = 'No screenshots yet';
        body = canCapture()
          ? 'Take one now: your browser asks which screen, window or tab to share, and Photos keeps a single frame of it here.'
          : 'This browser does not let web pages capture the screen. Use your computer’s own screenshot tool, then paste the picture here or import it.';
        acts = [shotBtn(true), importBtn(!canCapture())];
      } else if (d) {
        ic = 'folder';
        title = `${folderName(d)} is empty`;
        body = `Pictures you import or drop here go into ${tilde(d)}.`;
        acts = [importBtn(true)];
      } else {
        title = 'No pictures yet';
        body = 'Bring in pictures from your computer, take one with Camera, or capture your screen.';
        acts = [importBtn(true), camBtn(false), shotBtn(false)];
      }
      return h('div.ph-empty',
        h('div.ph-empty__art', { 'aria-hidden': 'true' }, h('span'), h('span'), h('span', icon(ic))),
        h('h3', { text: title }),
        h('p', { text: body }),
        h('div.ph-empty__acts', acts),
        S.view === 'fav' ? null : h('small', { text: `You can also drop images onto this window, or paste one with ${fmt.modLabel}+V.` }));
    }

    /* ---------------- info panel (grid) ------- */
    function toggleInfo(force) {
      S.info = force === undefined ? !S.info : !!force;
      if (!S.info) S.renaming = null;
      paintInfo();
    }

    function paintInfo() {
      info.classList.toggle('hidden', !S.info);
      shell.classList.toggle('is-info', S.info);
      if (!S.lb) {
        btnInfo.classList.toggle('is-on', S.info);
        btnInfo.setAttribute('aria-pressed', String(S.info));
      }
      if (!S.info) return;
      clear(info);
      const item = VIEW.find(i => i.path === S.focus) || null;
      info.append(h('div.ph-info__head', h('h3', { text: 'Info' }),
        h('button.ibtn', { type: 'button', 'aria-label': 'Close info', title: 'Close info', onclick: () => toggleInfo(false) }, icon('x'))));
      if (!item) {
        info.append(h('div.ph-info__none', icon('info'), h('b', { text: 'Nothing selected' }),
          h('small', { text: VIEW.length ? 'Select a picture to see what its file says about it.' : 'There are no pictures here yet.' })));
        return;
      }
      info.append(factsFor(item, true));
    }

    /* ---------------- facts (both panels) ----- */
    let factRefs = [];
    function factsFor(item, preview) {
      const typeEl = h('span');
      const dimEl = h('span');
      factRefs = factRefs.filter(r => r.dim.isConnected);
      const ref = { item, type: typeEl, dim: dimEl };
      factRefs.push(ref);
      fillFacts(ref);
      if (item.real && !mimes.has(item.ref) && !reading.has(item.ref)) {
        reading.add(item.ref);
        typeOf(item).then(m => { mimes.set(item.ref, m || null); reading.delete(item.ref); refreshFacts(); });
      }
      if (item.real && !dims.has(item.ref)) measure(item).then(refreshFacts);

      const fav = isFav(item.path);
      const kv = h('dl.ph-kv',
        h('dt', { text: 'Folder' }),
        h('dd', h('button.ph-link', { type: 'button', title: 'Show in Files', onclick: () => showInFiles(item) },
          icon('folder-open'), h('span', { text: tilde(item.dir) }))),
        h('dt', { text: 'Size' }),
        h('dd', { text: item.real ? `${item.node.size ? fmt.fmtBytes(item.node.size) : '0 bytes'} (${bytesExact(item.node.size || 0)})` : 'No data' }),
        h('dt', { text: 'Type' }), h('dd', typeEl),
        h('dt', { text: 'Dimensions' }), h('dd', dimEl),
        h('dt', { text: 'Modified' }), h('dd', { text: fullDate(item.mtime) }),
        h('dt', { text: 'Stored' }), h('dd', { text: storedText(item) }));

      return h('div.ph-facts',
        preview ? previewOf(item) : null,
        S.renaming === item.path ? renameForm(item)
          : h('div.ph-facts__name', h('b', { text: item.name }),
            h('button.ibtn', { type: 'button', 'aria-label': `Rename ${item.name}`, title: 'Rename (F2)', onclick: () => startRename(item) }, icon('edit-3'))),
        kv,
        h('div.ph-facts__acts',
          h('button.btn.btn--sm', { type: 'button', 'aria-pressed': String(fav), onclick: () => toggleFav(item) },
            icon('heart', { fill: fav }), h('span', { text: fav ? 'Favourited' : 'Favourite' })),
          h('button.btn.btn--sm', { type: 'button', disabled: !item.real, onclick: () => download(item) }, icon('download'), h('span', { text: 'Download' })),
          h('button.btn.btn--sm', { type: 'button', disabled: !item.real, onclick: () => setWallpaper(item) }, icon('image'), h('span', { text: 'Set as wallpaper' })),
          h('button.btn.btn--sm.ph-danger', { type: 'button', onclick: () => trash(item) }, icon('trash'), h('span', { text: 'Move to Trash' }))));
    }

    function fillFacts(r) {
      const { item } = r;
      if (!item.real) r.type.textContent = 'None: the file is empty';
      else if (!mimes.has(item.ref)) r.type.textContent = 'Reading…';
      else {
        const m = mimes.get(item.ref);
        r.type.textContent = m ? `${TYPE_NAMES[m] || `${m.split('/')[1].toUpperCase()} image`} (${m})` : 'Not recorded';
      }
      r.dim.textContent = dimText(item);
    }
    function refreshFacts() {
      factRefs = factRefs.filter(r => r.dim.isConnected);
      factRefs.forEach(fillFacts);
    }

    function dimText(item) {
      if (!item.real || missing.has(item.ref)) return 'No image data';
      if (broken.has(item.ref)) return 'Can’t be measured: the browser can’t decode it';
      const d = dims.get(item.ref);
      if (!d) return 'Measuring…';
      if (!d.w || !d.h) return 'No fixed pixel size (vector image)';
      const mp = (d.w * d.h) / 1e6;
      return `${d.w.toLocaleString()} × ${d.h.toLocaleString()} px${mp >= 0.1 ? ` · ${mp.toFixed(1)} MP` : ''}`;
    }

    function storedText(item) {
      if (item.ref.startsWith(media.MEDIA)) return missing.has(item.ref) ? 'Was in this browser; the bytes are gone' : 'In this browser (IndexedDB)';
      if (item.ref.startsWith(media.ASSET)) return 'Comes with StaticOS';
      return 'Nowhere: the file is empty';
    }

    /* The type the browser recorded when the file was saved; for a file
       that ships with StaticOS, the Content-Type the server sends for it
       (media.mimeOf reads only the former). */
    const reading = new Set();
    async function typeOf(item) {
      const m = await media.mimeOf(item.node).catch(() => null);
      if (m || !item.ref.startsWith(media.ASSET)) return m;
      try {
        const res = await fetch(item.ref.slice(media.ASSET.length), { method: 'HEAD' });
        return res.ok ? (res.headers.get('content-type') || '').split(';')[0].trim() || null : null;
      } catch (err) { return null; }
    }

    /* the size is read off the decoded picture, never guessed */
    function measure(item) {
      if (!item.real) return Promise.resolve(null);
      if (dims.has(item.ref)) return Promise.resolve(dims.get(item.ref));
      if (measuring.has(item.ref)) return measuring.get(item.ref);
      const p = media.urlOf(item.node).then(url => new Promise(res => {
        if (!url) { missing.add(item.ref); res(null); return; }
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => { const d = { w: im.naturalWidth, h: im.naturalHeight }; dims.set(item.ref, d); res(d); };
        im.onerror = () => { broken.add(item.ref); res(null); };
        im.src = url;
      })).catch(() => null).finally(() => measuring.delete(item.ref));
      measuring.set(item.ref, p);
      return p;
    }

    function previewOf(item) {
      const box = h('button.ph-facts__pv', { type: 'button', 'aria-label': `Open ${item.name}`, onclick: () => openLb(item) });
      if (!item.real) { box.append(icon('image'), h('small', { text: 'No image data' })); return box; }
      media.urlOf(item.node).then(u => {
        if (S.dead) return;
        if (!u) { box.append(icon('image'), h('small', { text: 'No image data' })); return; }
        box.append(h('img', { src: u, alt: '', decoding: 'async' }));
      }).catch(() => {});
      return box;
    }

    /* ---------------- rename ------------------ */
    let renameEl = null;
    function startRename(item) {
      if (!item) return;
      S.renaming = item.path;
      renameEl = null;
      if (S.lb) { S.lbInfo = true; paintLbInfo(); }
      else { S.focus = item.path; markSel(); S.info = true; paintInfo(); }
    }

    function renameForm(item) {
      if (renameEl && renameEl.path === item.path) return renameEl.form;
      const input = h('input.ph-rename__in', { type: 'text', value: item.name, 'aria-label': `New name for ${item.name}`, spellcheck: 'false', autocomplete: 'off' });
      const err = h('div.ph-rename__err', { role: 'alert' });
      const cancel = () => { S.renaming = null; renameEl = null; repaintPanels(); };
      const form = h('form.ph-rename', {
        onsubmit: e => {
          e.preventDefault();
          const res = doRename(item, input.value);
          if (res === true) { S.renaming = null; renameEl = null; repaintPanels(); }
          else { err.textContent = res; input.focus(); }
        },
      },
        h('label.ph-rename__l', { text: 'Name' }),
        h('div.field', input),
        err,
        h('div.ph-rename__acts',
          h('button.btn.btn--sm.btn--ghost', { type: 'button', text: 'Cancel', onclick: cancel }),
          h('button.btn.btn--sm.btn--primary', { type: 'submit', text: 'Rename' })));
      input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } });
      renameEl = { path: item.path, form };
      later(() => { input.focus(); input.setSelectionRange(0, stemOf(item.name).length); }, 0);
      return form;
    }

    function doRename(item, raw) {
      let name = String(raw || '').trim().replace(/\s+/g, ' ');
      if (!name || name === item.name) return true;
      if (/[\\/]/.test(name)) return 'A name can’t contain / or \\.';
      if (name.startsWith('.')) return 'A name that starts with a dot would hide the file.';
      if (!isImageName(name)) {
        if (!extOf(name) || !/^[a-z0-9]{1,5}$/i.test(extOf(name))) name = `${name}.${extOf(item.name) || 'png'}`;
        if (!isImageName(name)) return `Keep a picture extension such as .${extOf(item.name) || 'png'}, so Photos and Files know it is an image.`;
      }
      if (vfs.node(`${item.dir}/${name}`)) return `${folderName(item.dir)} already has a file called “${name}”.`;
      const old = item.path;
      if (!vfs.rename(old, name)) return 'The file could not be renamed.';
      const next = `${item.dir}/${name}`;
      if (isFav(old)) setFavs(favs().map(p => (p === old ? next : p)));
      if (S.focus === old) S.focus = next;
      return true;
    }

    function repaintPanels() {
      if (S.lb) paintLbInfo();
      paintInfo();
    }

    /* ---------------- actions ----------------- */
    function toggleFav(item) {
      if (!item) return;
      const f = favs();
      setFavs(f.includes(item.path) ? f.filter(p => p !== item.path) : [...f, item.path]);
    }

    function showInFiles(item) { api.openApp('files', { path: item.dir }); }

    /* Edit: js/photos/edit.js (loaded on first use) covers the window until it closes */
    let editor = null;
    async function editPhoto(item) {
      if (!item?.real || editor || S.dead) return;
      stopShow();
      editor = {};
      let mod;
      try { mod = await import('../photos/edit.js'); } catch (err) {
        editor = null;
        warn('Couldn’t open the editor', 'Its code didn’t load. Check the connection and try again.');
        return;
      }
      if (S.dead) { editor = null; return; }
      editor = mod.openEditor({
        host: shell, path: item.path, api,
        onClose: () => { editor = null; if (!S.dead) (S.lb ? LB.stage : scroller).focus({ preventScroll: true }); },
        onSaved: ({ path }) => { if (!S.dead) { scan(); openPath(path); } },
      });
    }

    async function download(item) {
      const blob = item.real ? await media.blobOf(item.node).catch(() => null) : null;
      if (!blob) { warn('Nothing to download', `“${item.name}” has no image data behind it.`); return; }
      const url = URL.createObjectURL(blob);
      ownUrls.add(url);
      const a = h('a', { href: url, download: item.name, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      a.remove();
      later(() => { URL.revokeObjectURL(url); ownUrls.delete(url); }, 4000);
    }

    async function setWallpaper(item) {
      const blob = item.real ? await media.blobOf(item.node).catch(() => null) : null;
      if (S.dead) return;
      if (!blob) { warn('Can’t set as wallpaper', `“${item.name}” has no image data behind it.`); return; }
      if (blob.size > WP_MAX) {
        warn('Too large for a wallpaper', `“${item.name}” is ${fmt.fmtBytes(blob.size)}. A picture wallpaper is saved with your settings in this browser’s local storage, which only has room for about 1.5 MB. A smaller copy (a screenshot of it, say) will work.`);
        return;
      }
      let dataUrl;
      try { dataUrl = await readDataUrl(blob); } catch (err) { warn('Can’t set as wallpaper', err.message); return; }
      if (S.dead) return;
      const WP = await import('../portal/wallpapers.js');
      const before = store.get(WP.ACTIVE_KEY);
      let entry;
      try {
        entry = WP.custom(store).find(w => w.url === dataUrl) || WP.add(store, { name: stemOf(item.name), url: dataUrl, kind: 'image' });
        WP.setActive(store, entry.id);
      } catch (err) { warn('Can’t set as wallpaper', err.message); return; }
      /* the store saves quietly; if the browser refused (storage full), undo
         it rather than leave settings that can no longer be saved. Success
         is only announced once the save is confirmed. */
      const check = (tries) => later(() => {
        let saved = false;
        try { saved = JSON.parse(profiles.local.getItem(profiles.key('staticos.state.v3')) || '{}')?.portal?.wallpapers?.some(w => w.id === entry.id); } catch (err) { saved = false; }
        if (saved) { say('Wallpaper set', `“${item.name}” is on your desktop.`); return; }
        if (tries > 0) { check(tries - 1); return; }
        WP.remove(store, entry.id);
        if (before && WP.byId(store, before)) WP.setActive(store, before);
        warn('Not enough room to keep that wallpaper', 'This browser’s storage for StaticOS settings is full, so the picture was taken off the desktop again. Removing other custom wallpapers in Settings frees room.');
      }, 700);
      check(3);
    }

    async function trash(item) {
      if (!item) return;
      const ok = await api.confirm({
        title: `Move “${item.name}” to Trash?`,
        message: 'You can put it back from the Trash in Files, or with Undo.',
        ok: 'Move to Trash', danger: true,
      });
      if (!ok) return;
      const { node, dir, name, path } = item;
      if (S.lb && S.lb.node === node) {
        const at = VIEW.indexOf(S.lb);
        LB.after = VIEW[at + 1] || VIEW[at - 1] || null;
      }
      if (!vfs.rm(path)) { warn('Couldn’t move to Trash', `“${name}” is no longer at ${tilde(dir)}.`); return; }
      if (isFav(path)) setFavs(favs().filter(p => p !== path));
      api.notify({ app: 'Photos', icon: 'trash', title: 'Moved to Trash', message: name,
        actions: [{ label: 'Undo', onClick: () => untrash(node, dir, name) }] });
    }

    function untrash(node, dir, name) {
      const bin = vfs.node(TRASH);
      if (!bin || !bin.children.includes(node)) { warn('Can’t undo', `“${name}” is no longer in the Trash.`); return; }
      if (!vfs.node(dir) && !vfs.mkdir(dir)) { warn('Can’t undo', `${tilde(dir)} no longer exists.`); return; }
      if (vfs.node(`${dir}/${name}`)) { warn('Can’t undo', `${folderName(dir)} already has a file called “${name}”.`); return; }
      const inBin = node.name;
      if (!vfs.mv(`${TRASH}/${inBin}`, dir)) { warn('Can’t undo', 'The file could not be moved back.'); return; }
      if (inBin !== name) vfs.rename(`${dir}/${inBin}`, name);
    }

    function moveTo(item, dir) {
      if (vfs.node(`${dir}/${item.name}`)) { warn('Can’t move', `${folderName(dir)} already has a file called “${item.name}”.`); return; }
      const wasFav = isFav(item.path);
      if (!vfs.mv(item.path, dir)) { warn('Can’t move', `${tilde(dir)} is not a folder any more.`); return; }
      const next = `${dir}/${item.name}`;
      if (wasFav) setFavs(favs().map(p => (p === item.path ? next : p)));
      if (S.focus === item.path) S.focus = next;
      say(`Moved to ${folderName(dir)}`, item.name);
    }

    /* draw arrows, boxes, text and blur on it (js/apps/markup.js) */
    function markUp(item) { if (item?.real) api.openApp('markup', { path: item.path }); }

    function menuItems(item, grid) {
      const f = isFav(item.path);
      const dests = [{ name: 'Pictures', path: BASE }, ...ALBUMS].filter(d => d.path !== item.dir);
      return [
        grid && { label: 'Open', icon: 'expand', onClick: () => openLb(item) },
        { label: f ? 'Remove from Favourites' : 'Add to Favourites', icon: 'heart', hint: 'F', onClick: () => toggleFav(item) },
        grid && { label: 'Get Info', icon: 'info', hint: 'I', onClick: () => { select(item); toggleInfo(true); } },
        '-',
        { label: 'Mark up', icon: 'edit-3', disabled: !item.real, onClick: () => markUp(item) },
        { label: 'Picture tools', icon: 'sparkles', disabled: !item.real,
          items: [['meme', 'Make a meme'], ['collage', 'Add to a collage'], ['convert', 'Resize or convert'], ['ascii', 'Turn into ASCII art'], ['gif', 'Make a GIF'], ['slideshow', 'Add to a slideshow']]
            .map(([tool, label]) => ({ label, onClick: () => api.openApp('picturetools', { tool, path: item.path }) })) },
        { label: 'Rename…', icon: 'edit-3', hint: 'F2', onClick: () => startRename(item) },
        { label: 'Move to Album', icon: 'folder', disabled: !dests.length,
          items: dests.map(d => ({ label: d.name, icon: d.path === BASE ? 'image' : albumIcon(d.name), onClick: () => moveTo(item, d.path) })) },
        { label: 'Edit…', icon: 'sliders', hint: 'E', disabled: !item.real, onClick: () => editPhoto(item) },
        { label: 'Download', icon: 'download', disabled: !item.real, onClick: () => download(item) },
        { label: 'Set as Wallpaper', icon: 'wallpaper', disabled: !item.real, onClick: () => setWallpaper(item) },
        { label: 'Show in Files', icon: 'folder-open', onClick: () => showInFiles(item) },
        '-',
        { label: 'Move to Trash', icon: 'trash', danger: true, onClick: () => trash(item) },
      ].filter(Boolean);
    }

    /* ---------------- import ------------------ */
    /* a picture keeps a name Photos and Files recognise; a format the
       library can't list (HEIC, TIFF…) is skipped and said so */
    function prepare(f) {
      if ((media.kindOf(f.type) || media.kindOf(f.name)) !== 'image') return null;
      if (isImageName(f.name)) return f;
      const sub = (f.type.split('/')[1] || '').toLowerCase();
      const ext = [media.extFor(f.type), sub].find(x => x && isImageName(`x.${x}`));
      return ext ? new File([f], `${f.name || 'Picture'}.${ext}`, { type: f.type, lastModified: f.lastModified }) : null;
    }

    async function importList(files, dir = importDir()) {
      const all = [...files];
      const pics = all.map(prepare).filter(Boolean);
      const skipped = all.length - pics.length;
      if (!pics.length) {
        warn('Nothing imported', all.length
          ? `${all.length === 1 ? 'That file isn’t a picture' : `None of those ${all.length} files are pictures`} in a format Photos can show. It imports JPEG, PNG, GIF, WebP, AVIF, BMP and SVG images.`
          : 'No files came through.');
        return [];
      }
      const done = [];
      let error = null;
      for (let i = 0; i < pics.length; i++) {
        S.busy = pics.length > 1 ? `Importing ${i + 1} of ${pics.length}…` : 'Importing…';
        if (!S.dead) paintBar();
        try { done.push(...await media.importFiles(dir, [pics[i]])); }
        catch (err) { error = err; break; }
      }
      S.busy = '';
      if (!S.dead) { paintBar(); estimate(); }
      const where = folderName(dir);
      const skip = skipped ? ` ${skipped} ${skipped === 1 ? 'file was' : 'files were'} skipped (not a picture format Photos can show).` : '';
      if (error) {
        const full = /quota/i.test(`${error.name} ${error.message}`);
        warn(done.length ? `Imported ${done.length} of ${pics.length}` : 'Import failed', full
          ? `This browser has run out of room for StaticOS’s files. Emptying the Trash in Files frees space.${skip}`
          : `${error.message || 'The picture could not be saved.'}${skip}`);
      } else {
        say(`Imported ${plural(done.length, 'picture')}`, `Into ${where}.${skip}`);
      }
      if (done.length && !S.dead) {
        S.focus = done[done.length - 1].path;
        later(() => { if (!S.lb) { markSel(); syncRoving(); if (S.info) paintInfo(); } }, 32);
      }
      return done;
    }

    /* drag-and-drop onto the window */
    let dragDepth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    const onDragEnter = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      dropTitle.textContent = `Drop to import into ${folderName(importDir())}`;
      drop.hidden = false;
    };
    const onDragOver = e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; drop.hidden = false; };
    const onDragLeave = e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.hidden = true; };
    const onDrop = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      drop.hidden = true;
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) importList(files);
    };
    root.addEventListener('dragenter', onDragEnter);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);

    /* paste an image from the clipboard */
    const onPaste = e => {
      if (S.dead || !win.el.classList.contains('is-active')) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const files = [...(e.clipboardData?.items || [])]
        .filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      const when = stamp();
      importList(files.map((f, i) => new File([f], `Pasted image ${when}${files.length > 1 ? ` ${i + 1}` : ''}.${media.extFor(f.type) || 'png'}`, { type: f.type })));
    };
    document.addEventListener('paste', onPaste);

    /* ---------------- screenshot -------------- */
    async function takeScreenshot() {
      if (!canCapture()) {
        warn('Can’t capture the screen here', 'This browser does not let web pages capture the screen. Use your computer’s screenshot tool, then paste the picture into Photos.');
        return;
      }
      let stream;
      try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); }
      catch (err) {
        if (S.dead) return;
        warn(err.name === 'NotAllowedError' ? 'No screenshot taken' : 'Screen capture failed', err.name === 'NotAllowedError'
          ? 'Capture was cancelled or is turned off on this device. Your computer’s own screenshot tool still works: paste the result here.'
          : (err.message || 'The browser refused to capture the screen.'));
        return;
      }
      streams.add(stream);
      try {
        const canvas = await frameOf(stream);
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        if (!blob) throw new Error('The captured frame could not be turned into a picture.');
        const { path } = await media.save(`${BASE}/Screenshots`, `Screenshot ${stamp()}.png`, blob);
        say('Screenshot saved', `${vfs.baseName(path)} · ${canvas.width} × ${canvas.height} px`, {
          actions: [{ label: 'Open', onClick: () => api.openFile(path) }, { label: 'Mark up', onClick: () => api.openApp('markup', { path }) }],
        });
      } catch (err) {
        if (!S.dead) warn('Screenshot failed', err.message || 'No picture arrived from the capture.');
      } finally {
        stream.getTracks().forEach(t => t.stop());
        streams.delete(stream);
      }
    }

    async function frameOf(stream) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      try {
        await v.play().catch(() => {});
        if (!v.videoWidth) {
          await new Promise((res, rej) => {
            const to = setTimeout(() => rej(new Error('No picture arrived from the capture.')), 5000);
            v.addEventListener('loadeddata', () => { clearTimeout(to); res(); }, { once: true });
          });
        }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const c = document.createElement('canvas');
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        if (!c.width || !c.height) throw new Error('The capture had no picture in it.');
        c.getContext('2d').drawImage(v, 0, 0);
        return c;
      } finally {
        v.pause();
        v.srcObject = null;
      }
    }

    /* ================= the viewer ================= */
    const LB = { el: null };
    const Z = { nat: null, vector: false, scale: 1, fit: 1, x: 0, y: 0, dx: 0 };
    let stripIo = null;
    let ro = null;

    function ib(ic, label, fn, cls = '') {
      return h(`button.ibtn.tip.tip--below${cls}`, { type: 'button', 'data-tip': label, 'aria-label': label, onclick: fn }, icon(ic));
    }

    function buildLb() {
      if (LB.el) return;
      LB.img = h('img.ph-lb__img', { alt: '', draggable: 'false', decoding: 'async', hidden: true });
      LB.msg = h('div.ph-lb__msg', { hidden: true, role: 'status' });
      LB.prev = h('button.ph-lb__nav.ph-lb__nav--prev', { type: 'button', 'aria-label': 'Previous picture', title: 'Previous (←)', onclick: () => step(-1) }, icon('chevron-left'));
      LB.next = h('button.ph-lb__nav.ph-lb__nav--next', { type: 'button', 'aria-label': 'Next picture', title: 'Next (→)', onclick: () => step(1) }, icon('chevron-right'));
      LB.stage = h('div.ph-lb__stage', { tabindex: '0', 'aria-label': 'Picture. Arrow keys move between pictures, plus and minus zoom, 0 fits, Escape closes.' },
        LB.img, LB.msg, LB.prev, LB.next);
      LB.title = h('b');
      LB.sub = h('small');
      LB.zOut = ib('minus', 'Zoom out (−)', () => zoomBy(1 / 1.25), '.ph-zoom__step');
      LB.zIn = ib('plus', 'Zoom in (+)', () => zoomBy(1.25), '.ph-zoom__step');
      LB.zLbl = h('button.ph-zoom__lbl', { type: 'button', onclick: () => { stopShow(); toggleZoom(); } });
      LB.favBtn = h('button.ibtn.tip.tip--below', { type: 'button', onclick: () => toggleFav(S.lb) });
      LB.showBtn = h('button.ibtn.tip.tip--below.ph-lb__show', { type: 'button', onclick: toggleShow });
      LB.infoBtn = ib('info', 'Info (I)', () => toggleLbInfo());
      LB.markBtn = ib('edit-3', 'Mark up', () => markUp(S.lb), '.ph-lb__mark');
      LB.moreBtn = ib('more-horizontal', 'More', e => {
        const r = e.currentTarget.getBoundingClientRect();
        if (S.lb) api.menu(menuItems(S.lb, false), r.left, r.bottom + 6);
      });
      LB.info = h('aside.ph-lb__info', { hidden: true, 'aria-label': 'Picture info' });
      LB.strip = h('div.ph-strip', { 'aria-hidden': 'true' });
      LB.live = h('div.ph-sr', { 'aria-live': 'polite' });
      LB.el = h('div.ph-lb', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Picture viewer', hidden: true },
        h('div.ph-lb__top',
          ib('chevron-left', 'Back to pictures (Esc)', closeLb, '.ph-lb__back'),
          h('div.ph-lb__t', LB.title, LB.sub),
          h('div.grow'),
          LB.zoom = h('div.ph-zoom', { role: 'group', 'aria-label': 'Zoom' }, LB.zOut, LB.zLbl, LB.zIn),
          LB.favBtn, LB.showBtn, LB.markBtn, LB.infoBtn, LB.moreBtn),
        h('div.ph-lb__body', LB.stage, LB.info),
        LB.strip,
        LB.live);
      shell.appendChild(LB.el);
      /* Edit sits before Info in the viewer's toolbar */
      LB.editBtn = ib('sliders', 'Edit (E)', () => editPhoto(S.lb), '.ph-lb__edit');
      LB.infoBtn.before(LB.editBtn);

      LB.stage.addEventListener('pointerdown', onDown);
      LB.stage.addEventListener('pointermove', onMove);
      LB.stage.addEventListener('pointerup', onUp);
      LB.stage.addEventListener('pointercancel', onUp);
      LB.stage.addEventListener('wheel', onWheel, { passive: false });
      LB.stage.addEventListener('dblclick', e => {
        if (e.target.closest('button') || !Z.nat) return;
        const [x, y] = local(e);
        stopShow();
        toggleZoom(x, y);
      });
      ro = new ResizeObserver(() => {
        if (!S.lb || !Z.nat) return;
        const wasFit = !zoomed();
        Z.fit = fitScale();
        Z.scale = wasFit ? Z.fit : Math.max(Z.scale, Z.fit);
        clampPan();
        applyZ();
      });
      ro.observe(LB.stage);
      stripIo = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          stripIo.unobserve(e.target);
          const rec = LB.stripRec?.get(e.target);
          if (!rec) continue;
          media.urlOf(rec.item.node).then(u => {
            if (S.dead) return;
            if (u) rec.img.src = u; else e.target.classList.add('is-none');
          }).catch(() => {});
        }
      }, { root: LB.strip, rootMargin: '0px 480px' });
    }

    function openLb(item) {
      if (!item) return;
      buildLb();
      stopShow();
      S.lb = VIEW.find(i => i.node === item.node);
      if (!S.lb) return;
      S.renaming = null;
      renameEl = null;
      LB.shown = null;
      LB.el.hidden = false;
      app.inert = true;
      seg.style.display = 'none';
      paintStrip();
      showItem();
      paintLbInfo();
      paintLbInfoBtn();
      requestAnimationFrame(() => { if (S.lb) LB.stage.focus({ preventScroll: true }); });
    }

    function closeLb() {
      if (!S.lb) return;
      const item = S.lb;
      stopShow();
      S.lb = null;
      LB.token = (LB.token || 0) + 1;
      LB.shown = null;
      LB.el.hidden = true;
      LB.img.hidden = true;
      LB.img.removeAttribute('src');
      Z.nat = null;
      app.inert = false;
      seg.style.display = '';
      if (S.renaming) { S.renaming = null; renameEl = null; }
      win.setSubtitle(viewLabel());
      btnInfo.classList.toggle('is-on', S.info);
      btnInfo.setAttribute('aria-pressed', String(S.info));
      S.focus = item.path;
      markSel();
      syncRoving();
      paintInfo();
      const t = tiles.get(item.key);
      if (t?.el.isConnected) {
        t.open.focus({ preventScroll: true });
        reveal(t.el, false);
      } else scroller.focus({ preventScroll: true });
    }

    function step(d, auto) {
      if (!S.lb || VIEW.length < 2) return;
      if (!auto) stopShow();
      const at = VIEW.indexOf(S.lb);
      S.lb = VIEW[(at + d + VIEW.length) % VIEW.length];
      S.renaming = null;
      renameEl = null;
      Z.dx = 0;
      showItem();
      if (S.lbInfo) paintLbInfo();
    }

    function showItem() {
      const item = S.lb;
      if (!item) return;
      const n = VIEW.length;
      const at = Math.max(0, VIEW.indexOf(item));
      LB.title.textContent = item.name;
      LB.title.title = item.name;
      LB.sub.textContent = `${at + 1} of ${n.toLocaleString()} · ${folderName(item.dir)}`;
      LB.live.textContent = `${item.name}, ${at + 1} of ${n}`;
      LB.lastAt = at;
      LB.stage.setAttribute('aria-label', `${item.name}. Arrow keys move between pictures, plus and minus zoom, 0 fits, Escape closes.`);
      win.setSubtitle(item.name);
      LB.prev.hidden = LB.next.hidden = n < 2;
      LB.showBtn.hidden = n < 2;
      LB.markBtn.disabled = !item.real;
      paintLbFav();
      paintShowBtn();
      markStrip();
      LB.editBtn.disabled = !item.real;
      if (LB.shown !== item.node || LB.shownRef !== item.ref) {
        LB.shown = item.node;
        LB.shownRef = item.ref;
        loadMain(item);
      }
      if (n > 1) preload(VIEW[(at + 1) % n]);
    }

    function paintLbFav() {
      if (!LB.el || !S.lb) return;
      const f = isFav(S.lb.path);
      clear(LB.favBtn);
      LB.favBtn.append(icon('heart', { fill: f }));
      LB.favBtn.classList.toggle('is-on', f);
      LB.favBtn.setAttribute('aria-pressed', String(f));
      LB.favBtn.setAttribute('aria-label', f ? 'Remove from Favourites (F)' : 'Add to Favourites (F)');
      LB.favBtn.dataset.tip = f ? 'Favourite (F)' : 'Add to Favourites (F)';
    }

    function paintShowBtn() {
      if (!LB.el) return;
      clear(LB.showBtn);
      LB.showBtn.append(icon(S.show ? 'pause' : 'play'));
      LB.showBtn.classList.toggle('is-on', !!S.show);
      LB.showBtn.setAttribute('aria-pressed', String(!!S.show));
      LB.showBtn.setAttribute('aria-label', S.show ? 'Stop slideshow' : 'Play slideshow');
      LB.showBtn.dataset.tip = S.show ? 'Stop slideshow' : 'Slideshow';
    }

    function paintLbInfoBtn() {
      if (!LB.el) return;
      LB.infoBtn.classList.toggle('is-on', S.lbInfo);
      LB.infoBtn.setAttribute('aria-pressed', String(S.lbInfo));
      btnInfo.classList.toggle('is-on', S.lbInfo);
      btnInfo.setAttribute('aria-pressed', String(S.lbInfo));
    }

    function toggleLbInfo(force) {
      S.lbInfo = force === undefined ? !S.lbInfo : !!force;
      if (!S.lbInfo && S.renaming) { S.renaming = null; renameEl = null; }
      paintLbInfo();
    }

    function paintLbInfo() {
      if (!LB.el) return;
      paintLbInfoBtn();
      LB.info.hidden = !S.lbInfo;
      if (!S.lbInfo || !S.lb) return;
      clear(LB.info);
      LB.info.append(
        h('div.ph-info__head', h('h3', { text: 'Info' }),
          h('button.ibtn', { type: 'button', 'aria-label': 'Close info', title: 'Close info', onclick: () => toggleLbInfo(false) }, icon('x'))),
        factsFor(S.lb, false));
    }

    function loadMain(item) {
      const tok = LB.token = (LB.token || 0) + 1;
      const img = LB.img;
      Z.nat = null;
      Z.dx = 0;
      img.hidden = true;
      img.onload = img.onerror = null;
      img.removeAttribute('src');
      img.classList.remove('is-in');
      LB.stage.classList.remove('is-zoomed');
      setMsg(null);
      LB.zLbl.textContent = '–';
      LB.zLbl.disabled = LB.zIn.disabled = LB.zOut.disabled = true;
      LB.zoom.style.visibility = 'hidden';
      if (!item.real) { setMsg('empty', item); return; }
      later(() => { if (tok === LB.token && !Z.nat && LB.msg.hidden) setMsg('loading', item); }, 200);
      let retried = false;
      media.urlOf(item.node).catch(() => null).then(url => {
        if (tok !== LB.token || S.dead) return;
        if (!url) { missing.add(item.ref); setMsg('missing', item); refreshFacts(); return; }
        img.onload = () => {
          if (tok !== LB.token) return;
          const w = img.naturalWidth, hh = img.naturalHeight;
          dims.set(item.ref, { w, h: hh });
          Z.vector = !w || !hh;
          if (Z.vector) {
            const s = stageBox();
            Z.nat = { w: Math.max(1, s.w - PAD() * 2), h: Math.max(1, s.h - PAD() * 2) };
          } else Z.nat = { w, h: hh };
          setMsg(null);
          img.hidden = false;
          LB.zLbl.disabled = false;
          LB.zoom.style.visibility = '';
          fitNow();
          if (!reduced()) { void img.offsetWidth; img.classList.add('is-in'); }
          refreshFacts();
        };
        img.onerror = () => {
          if (tok !== LB.token) return;
          if (!retried && url.startsWith('blob:')) {
            retried = true;
            media.urlOf(item.node).then(u => { if (tok === LB.token && u) img.src = u; else if (tok === LB.token) setMsg('decode', item); }).catch(() => {});
            return;
          }
          broken.add(item.ref);
          setMsg('decode', item);
          refreshFacts();
        };
        img.src = url;
      });
    }

    function preload(item) {
      if (!item?.real || dims.has(item.ref)) return;
      measure(item);
    }

    function setMsg(kind, item) {
      const m = LB.msg;
      clear(m);
      m.hidden = !kind;
      if (!kind) return;
      if (kind === 'loading') { m.append(h('i.ph-spin'), h('span', { text: 'Opening…' })); return; }
      const mime = mimes.get(item.ref);
      const T = {
        empty: ['No image data', `“${item.name}” is an empty file: no picture was ever saved in it (an older StaticOS made screenshot files like this). Moving it to the Trash is safe.`],
        missing: ['No image data', `The picture behind “${item.name}” is no longer in this browser’s storage, perhaps because site data was cleared. Only the file name is left.`],
        decode: ['Can’t show this picture', `This browser can’t decode “${item.name}”${mime ? ` (${mime})` : ''}. It may be damaged, or in a format the browser doesn’t support. You can still download it and open it elsewhere.`],
      }[kind];
      const btn = (ic, label, fn, cls = '') => h(`button.btn${cls}`, { type: 'button', onclick: fn }, icon(ic), h('span', { text: label }));
      m.append(
        h('div.ph-lb__msgic', icon(kind === 'decode' ? 'alert' : 'image')),
        h('b', { text: T[0] }),
        h('p', { text: T[1] }),
        h('div.ph-lb__msgacts',
          kind === 'decode' ? btn('download', 'Download', () => download(item), '.btn--primary') : btn('trash', 'Move to Trash', () => trash(item)),
          btn('folder-open', 'Show in Files', () => showInFiles(item))));
    }

    /* ---------------- filmstrip --------------- */
    function paintStrip() {
      if (!LB.el) return;
      stripIo.disconnect();
      clear(LB.strip);
      LB.stripEls = new Map();
      LB.stripRec = new WeakMap();
      LB.strip.hidden = VIEW.length < 2;
      if (VIEW.length < 2) return;
      const at = Math.max(0, VIEW.indexOf(S.lb));
      let lo = 0, hi = VIEW.length;
      if (VIEW.length > STRIP_MAX) { lo = Math.max(0, Math.min(at - STRIP_MAX / 2, VIEW.length - STRIP_MAX)); hi = lo + STRIP_MAX; }
      for (let i = lo; i < hi; i++) {
        const it = VIEW[i];
        const img = h('img', { alt: '', decoding: 'async', draggable: 'false' });
        img.addEventListener('error', () => { img.hidden = true; b.classList.add('is-none'); });
        const b = h('button.ph-strip__i', { type: 'button', tabindex: '-1', title: it.name, onclick: () => { stopShow(); S.lb = it; showItem(); if (S.lbInfo) paintLbInfo(); } }, img);
        LB.stripEls.set(it.node, b);
        LB.stripRec.set(b, { item: it, img });
        if (!it.real) b.classList.add('is-none');
        else stripIo.observe(b);
        LB.strip.append(b);
      }
    }

    function markStrip() {
      if (!LB.stripEls || LB.strip.hidden) return;
      const cur = LB.stripEls.get(S.lb?.node);
      if (!cur && VIEW.length > STRIP_MAX) { paintStrip(); if (LB.stripEls.get(S.lb?.node)) markStrip(); return; }
      LB.stripOn?.classList.remove('is-on');
      LB.stripOn = cur || null;
      if (!cur) return;
      cur.classList.add('is-on');
      const s = LB.strip;
      const left = cur.offsetLeft - s.clientWidth / 2 + cur.offsetWidth / 2;
      s.scrollTo({ left, behavior: reduced() || LB.el.hidden ? 'auto' : 'smooth' });
    }

    /* ---------------- zoom & pan -------------- */
    const stageBox = () => ({ w: LB.stage.clientWidth, h: LB.stage.clientHeight });
    const PAD = () => (shell.clientWidth < 640 ? 0 : 28);
    const zoomed = () => !!Z.nat && Z.scale > Z.fit * 1.001;
    const maxScale = () => Math.max(8, Z.fit);

    function fitScale() {
      const { w, h: hh } = stageBox();
      if (!Z.nat || !w || !hh) return 1;
      const p = PAD();
      return Math.max(0.01, Math.min((w - p * 2) / Z.nat.w, (hh - p * 2) / Z.nat.h, 1));
    }
    function clampPan() {
      if (!Z.nat) return;
      const { w, h: hh } = stageBox();
      const iw = Z.nat.w * Z.scale, ih = Z.nat.h * Z.scale;
      Z.x = iw <= w ? (w - iw) / 2 : fmt.clamp(Z.x, w - iw, 0);
      Z.y = ih <= hh ? (hh - ih) / 2 : fmt.clamp(Z.y, hh - ih, 0);
    }
    function applyZ(anim) {
      const img = LB.img;
      if (!Z.nat) return;
      const a = !!anim && !reduced();
      img.classList.toggle('is-anim', a);
      img.style.width = `${Z.nat.w * Z.scale}px`;
      img.style.height = `${Z.nat.h * Z.scale}px`;
      img.style.transform = `translate3d(${Z.x + Z.dx}px, ${Z.y}px, 0)`;
      img.classList.toggle('is-pix', !Z.vector && Z.scale >= 3);
      const z = zoomed();
      LB.stage.classList.toggle('is-zoomed', z);
      const pct = Math.round(Z.scale * 100);
      LB.zLbl.textContent = z ? `${pct}%` : `Fit · ${pct}%`;
      LB.zLbl.setAttribute('aria-label', z ? `Zoomed to ${pct}%. Press to fit` : `Fitted at ${pct}%. Press for ${Z.fit >= 1 ? '200' : '100'}%`);
      LB.zLbl.title = z ? 'Fit (0)' : 'Actual size (1)';
      LB.zOut.disabled = !z;
      LB.zIn.disabled = Z.scale >= maxScale() - 1e-6;
      if (a) later(() => img.classList.remove('is-anim'), 240);
    }
    function fitNow(anim) {
      Z.fit = fitScale();
      Z.scale = Z.fit;
      Z.dx = 0;
      clampPan();
      applyZ(anim);
    }
    function zoomAt(s, cx, cy, anim) {
      if (!Z.nat) return;
      const next = fmt.clamp(s, Z.fit, maxScale());
      const k = next / Z.scale;
      Z.x = cx - (cx - Z.x) * k;
      Z.y = cy - (cy - Z.y) * k;
      Z.scale = next;
      clampPan();
      applyZ(anim);
    }
    const centre = () => { const b = stageBox(); return [b.w / 2, b.h / 2]; };
    function zoomBy(f) {
      if (!Z.nat) return;
      stopShow();
      let s = Z.scale * f;
      if (Math.abs(s - 1) < 0.06) s = 1;
      zoomAt(s, ...centre(), true);
    }
    function zoomTo(s) { if (!Z.nat) return; stopShow(); zoomAt(s, ...centre(), true); }
    function toggleZoom(cx, cy) {
      if (!Z.nat) return;
      if (zoomed()) { fitNow(true); return; }
      const [x, y] = cx == null ? centre() : [cx, cy];
      zoomAt(Z.fit >= 1 ? 2 : 1, x, y, true);
    }

    const ptrs = new Map();
    let G = null;
    let lastTap = null;
    const local = e => { const r = LB.stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    function onDown(e) {
      if (!Z.nat || e.target.closest('button')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { LB.stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      ptrs.set(e.pointerId, local(e));
      stopShow();
      if (ptrs.size === 1) G = { kind: 'drag', start: local(e), zx: Z.x, zy: Z.y, moved: false };
      else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        G = { kind: 'pinch', d: dist(a, b) || 1, s: Z.scale, mid: mid(a, b) };
        Z.dx = 0;
      }
    }
    function onMove(e) {
      if (!ptrs.has(e.pointerId) || !G) return;
      ptrs.set(e.pointerId, local(e));
      if (G.kind === 'pinch' && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const m = mid(a, b);
        zoomAt(G.s * dist(a, b) / G.d, m[0], m[1]);
        Z.x += m[0] - G.mid[0];
        Z.y += m[1] - G.mid[1];
        G.mid = m;
        clampPan();
        applyZ();
        return;
      }
      if (G.kind !== 'drag') return;
      const p = local(e);
      const dx = p[0] - G.start[0], dy = p[1] - G.start[1];
      if (!G.moved && Math.hypot(dx, dy) < 5) return;
      G.moved = true;
      if (zoomed()) {
        Z.x = G.zx + dx;
        Z.y = G.zy + dy;
        clampPan();
        LB.stage.classList.add('is-panning');
        applyZ();
      } else if (VIEW.length > 1) {
        Z.dx = dx;
        applyZ();
      }
    }
    function onUp(e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      LB.stage.classList.remove('is-panning');
      if (!G) return;
      if (G.kind === 'pinch') {
        if (ptrs.size === 1) { const [p] = [...ptrs.values()]; G = { kind: 'drag', start: p, zx: Z.x, zy: Z.y, moved: true }; }
        else G = null;
        return;
      }
      const p = local(e);
      const dx = p[0] - G.start[0], dy = p[1] - G.start[1];
      if (!G.moved) {
        if (e.pointerType !== 'mouse' && e.type === 'pointerup') {
          const now = performance.now();
          if (lastTap && now - lastTap.t < 320 && dist(p, lastTap.p) < 30) { toggleZoom(p[0], p[1]); lastTap = null; }
          else lastTap = { t: now, p };
        }
      } else if (!zoomed() && Z.dx) {
        const swipe = e.type === 'pointerup' && Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.2;
        Z.dx = 0;
        if (swipe) step(dx < 0 ? 1 : -1);
        else applyZ(true);
      }
      G = null;
    }
    function onWheel(e) {
      if (!Z.nat) return;
      e.preventDefault();
      stopShow();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const [x, y] = local(e);
      zoomAt(Z.scale * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0022)), x, y);
    }

    /* ---------------- slideshow --------------- */
    function stopShow() {
      if (!S.show) return;
      clearInterval(S.show);
      S.show = 0;
      paintShowBtn();
    }
    function toggleShow() {
      if (S.show) { stopShow(); return; }
      if (!S.lb || VIEW.length < 2) return;
      if (zoomed()) fitNow();
      S.show = setInterval(() => { if (S.dead || !S.lb) { stopShow(); return; } step(1, true); }, SHOW_MS);
      paintShowBtn();
    }

    /* ================= wiring ================= */
    function paintAll() {
      if (!S.lb) win.setSubtitle(viewLabel());
      paintSide();
      paintBar();
      paintGrid();
      paintInfo();
      paintFoot();
    }

    function go(key) {
      if (S.lb) closeLb();
      S.view = key;
      S.focus = null;
      S.renaming = null;
      renameEl = null;
      VIEW = viewItems();
      scroller.scrollTop = 0;
      paintAll();
    }

    function refresh() {
      scan();
      const d = viewDir();
      if (d && !(vfs.node(d)?.type === 'dir')) S.view = 'all';
      VIEW = viewItems();
      /* let go of tiles for files that are gone */
      const keep = new Set([...LIB, ...VIEW].map(i => i.key));
      for (const [k, t] of tiles) if (!keep.has(k)) { io.unobserve(t.el); tiles.delete(k); }
      if (S.renaming && !VIEW.some(i => i.path === S.renaming)) { S.renaming = null; renameEl = null; }
      paintAll();
      if (!S.lb) return;
      let cur = VIEW.find(i => i.node === S.lb.node);
      if (!cur) {
        const after = LB.after && VIEW.find(i => i.node === LB.after.node);
        cur = after || VIEW[Math.min(LB.lastAt || 0, VIEW.length - 1)] || null;
      }
      LB.after = null;
      if (!cur) { closeLb(); return; }
      S.lb = cur;
      paintStrip();
      showItem();
      paintLbInfo();
    }

    let rq = 0;
    const queueRefresh = () => {
      if (rq || S.dead) return;
      rq = requestAnimationFrame(() => { rq = 0; if (!S.dead) { refresh(); estimate(); } });
    };
    const relevant = p => {
      if (typeof p !== 'string') return false;
      if (inPics(p) || p === vfs.HOME) return true;
      const d = viewDir();
      if (d && (p === d || p.startsWith(`${d}/`))) return true;
      return favs().some(f => f === p || vfs.parentPath(f) === p);
    };
    offs.push(bus.on('fs:change', (dir, path) => { if (relevant(dir) || relevant(path)) queueRefresh(); }));
    offs.push(bus.on('media:change', e => { if (relevant(e?.path)) queueRefresh(); }));
    offs.push(store.sub(PREF, () => {
      if (S.dead) return;
      if (S.view === 'fav') { queueRefresh(); return; }
      for (const t of tiles.values()) updateTile(t);
      paintSide();
      paintInfo();
      if (S.lb) { paintLbFav(); if (S.lbInfo && !S.renaming) paintLbInfo(); }
    }));

    /* the viewer and the grid's shortcuts; typing in a field is left alone */
    const onKey = e => {
      if (S.dead || editor || !win.el.classList.contains('is-active')) return;
      const t = e.target;
      if (t !== document.body && !root.contains(t)) return;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (S.lb) {
        switch (e.key) {
          case 'Escape': closeLb(); break;
          case 'ArrowRight': step(1); break;
          case 'ArrowLeft': step(-1); break;
          case 'Home': if (VIEW.length > 1) { stopShow(); S.lb = VIEW[0]; showItem(); if (S.lbInfo) paintLbInfo(); } break;
          case 'End': if (VIEW.length > 1) { stopShow(); S.lb = VIEW[VIEW.length - 1]; showItem(); if (S.lbInfo) paintLbInfo(); } break;
          case '+': case '=': zoomBy(1.25); break;
          case '-': case '_': zoomBy(1 / 1.25); break;
          case '0': stopShow(); fitNow(true); break;
          case '1': zoomTo(1); break;
          case 'i': case 'I': toggleLbInfo(); break;
          case 'f': case 'F': toggleFav(S.lb); break;
          case 'e': case 'E': editPhoto(S.lb); break;
          case 'F2': startRename(S.lb); break;
          case 'Delete': case 'Backspace': trash(S.lb); break;
          default: return;
        }
        e.preventDefault();
        return;
      }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); toggleInfo(); }
      else if (e.key === 'Escape' && S.info) { e.preventDefault(); toggleInfo(false); }
    };
    window.addEventListener('keydown', onKey);

    function openPath(path) {
      const p = vfs.norm(path);
      const n = vfs.node(p);
      if (!n || n.type !== 'file') { warn('Picture not found', `${tilde(p)} is no longer there.`); return false; }
      if (!isImageName(n.name)) return false;
      const dir = vfs.parentPath(p);
      if (S.lb) closeLb();
      /* open among its neighbours: the album it is in, the whole library
         for loose pictures, or the folder it came from outside ~/Pictures */
      const album = ALBUMS.find(a => p.startsWith(`${a.path}/`));
      S.view = album ? `dir:${album.path}` : inPics(p) ? 'all' : `dir:${dir}`;
      S.focus = p;
      VIEW = viewItems();
      paintAll();
      const item = VIEW.find(i => i.path === p) || itemOf(n, p);
      openLb(item);
      return true;
    }
    win.onReopen(o => { if (o?.path && !S.dead) openPath(o.path); });

    /* ---------------- first paint ------------- */
    scan();
    VIEW = viewItems();
    paintSeg();
    paintAll();
    estimate();
    if (opts?.path) openPath(opts.path);

    return () => {
      if (S.dead) return;
      S.dead = true;
      stopShow();
      editor?.close?.();
      if (rq) cancelAnimationFrame(rq);
      timers.forEach(clearTimeout);
      timers.clear();
      offs.forEach(off => off());
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
      root.removeEventListener('dragenter', onDragEnter);
      root.removeEventListener('dragover', onDragOver);
      root.removeEventListener('dragleave', onDragLeave);
      root.removeEventListener('drop', onDrop);
      io.disconnect();
      stripIo?.disconnect();
      ro?.disconnect();
      streams.forEach(s => s.getTracks().forEach(t => t.stop()));
      streams.clear();
      ownUrls.forEach(u => URL.revokeObjectURL(u));
      ownUrls.clear();
      if (LB.img) { LB.img.onload = LB.img.onerror = null; LB.img.removeAttribute('src'); }
      tiles.clear();
    };
  },
});
