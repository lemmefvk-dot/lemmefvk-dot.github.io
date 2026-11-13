/* ============================================================
   videos.js — Videos: a real player for the videos in your files.

   Library. Every video under the home folder (~/Videos and
   ~/Downloads first, then any other folder that has one; the Trash
   is left out), grouped by folder. A card's picture is a REAL frame:
   the file is loaded muted with preload="metadata", seeked to 10 %
   of its length and drawn to a small canvas. The same pass measures
   the length and the picture size, so every number on a card was
   read from the file. Frames are kept for the session, keyed by the
   file's bytes (so a rename keeps its picture), as small JPEG data
   URLs — nothing to revoke. A file with no bytes behind it (an old
   placeholder) or one this browser can't decode says so on its card.

   Player. One <video> element, reused for every clip, under custom
   controls: play/pause (Space, K), seek bar showing what has been
   buffered, ±5 s (← →), ±10 s (J L), 10 %-steps (0–9), volume and
   mute (↑ ↓, M), speed 0.5–2× (< >), loop, picture-in-picture (P,
   only where the browser allows it), fullscreen on the player (F),
   and an info panel (I) with the real resolution, length, size,
   type and decoded/dropped frame counts. Controls fade while a
   video plays and the pointer is still; never while paused, while
   a menu is open or while focus is in them.

   Volume is the OS volume. Settings writes prefs.volume onto every
   <audio>/<video> on the page (and re-checks every few seconds), so
   a private per-app level would be overwritten; the player's slider
   IS prefs.volume, and prefs.muted mutes it. M is the player's own
   mute; if the system is muted, M turns system sound back on, since
   that is what someone pressing "unmute" wants.

   Errors are honest: an unsupported format (.mkv in Chromium, say)
   names the file and says what does play; a placeholder says it has
   no video data. Import (file picker or drop) saves real bytes with
   core/media.js into ~/Videos.

   opts: { path } plays that file — on a cold open and on reopen (the
   app is a singleton, so opening a second video reuses this window).
   Closing pauses the video, empties its source, leaves fullscreen
   and picture-in-picture, and drops every listener and timer.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-videos-css')) {
  const l = document.createElement('link');
  l.id = 'feat-videos-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-videos.css';
  document.head.appendChild(l);
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const FIRST_DIRS = ['Videos', 'Downloads'];
const POSTER_MAX = 480;               /* longest side of a card frame, px */
const POSTER_TIMEOUT = 15000;
const IDLE_MS = 2600;
const ACCEPT = 'video/*,.mp4,.webm,.mov,.m4v,.ogv,.mkv';
/* what a file's extension implies, for when no MIME type was recorded */
const EXT_MIME = { mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska' };

/* ---------- session cache: real frames + what the file told us ----------
   key -> { src, w, h, dur } | { error: 'nodata'|'missing'|'timeout'|'novideo'|1..4, msg } */
const posters = new Map();
const keyOf = n => `${n.content}#${n.size}`;

const isVideo = n => n && n.type === 'file' && (n.kind === 'video' || media.kindOf(n.name) === 'video');
const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
const stemOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };

/** 83.4 -> "1:23"; a clip under ten seconds keeps tenths ("0:02.5") so it reads honestly. */
function fmtTime(t, ref = t) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const hrs = Math.floor(t / 3600);
  const mins = Math.floor((t % 3600) / 60);
  const secs = t % 60;
  const p2 = n => String(n).padStart(2, '0');
  if (hrs) return `${hrs}:${p2(mins)}:${p2(Math.floor(secs))}`;
  if (Number.isFinite(ref) && ref < 10) {
    const s = Math.floor(secs * 10) / 10;
    return `${mins}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }
  return `${mins}:${p2(Math.floor(secs))}`;
}
/** Card badge: "2.5 s" for short clips, "1:23" otherwise — cut, not rounded, like the player's clock. */
const fmtLen = d => (!Number.isFinite(d) ? '' : d < 60 ? `${(Math.floor(d * 10) / 10).toFixed(1)} s` : fmtTime(d, d));

/* Wait for one event (or an error / timeout) on a media element. */
function once(el, evt, ms = POSTER_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const done = fn => arg => { clearTimeout(t); el.removeEventListener(evt, ok); el.removeEventListener('error', bad); fn(arg); };
    const ok = done(resolve);
    const bad = done(() => reject({ code: el.error?.code || 4, msg: el.error?.message || '' }));
    const t = setTimeout(done(() => reject({ code: 'timeout' })), ms);
    el.addEventListener(evt, ok);
    el.addEventListener('error', bad);
  });
}

/* Some static servers ignore HTTP Range requests (python's http.server
   does). The browser can't seek at all in a file it streams from one of
   them — seekable stays empty even once it is fully downloaded — so every
   jump would land on 0. A clip that ships with StaticOS is small, so when
   that happens it is fetched whole and played from memory instead. */
const seekableOk = v => v.seekable.length > 0 && v.seekable.end(v.seekable.length - 1) > 0;
const isAsset = n => String(n?.content || '').startsWith(media.ASSET);

/* A recording straight out of MediaRecorder has no length in its header
   (duration = Infinity). Seeking far past the end makes the browser read
   to the end and report the real one; then go back to the start. */
async function finiteDuration(v) {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  const got = new Promise((resolve, reject) => {
    const t = setTimeout(() => { v.removeEventListener('durationchange', on); reject({ code: 'timeout' }); }, POSTER_TIMEOUT);
    function on() {
      if (!Number.isFinite(v.duration)) return;
      clearTimeout(t);
      v.removeEventListener('durationchange', on);
      resolve(v.duration);
    }
    v.addEventListener('durationchange', on);
  });
  v.currentTime = 1e101;
  const d = await got;
  v.currentTime = 0;
  return d;
}

/* ==================================================================== */

defineApp({
  id: 'videos',
  name: 'Videos',
  icon: 'film',
  g1: '#bda3ff', g2: '#5427c6',
  category: 'Media',
  keywords: ['video', 'player', 'movies', 'clips', 'mp4', 'webm', 'watch', 'fullscreen', 'picture in picture'],
  desc: 'Play the videos in your files',
  pinned: true,
  singleton: true,
  handles: ['video'],
  win: { w: 780, h: 520, minW: 480, minH: 340 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Space / K', 'Play or pause'],
    ['Left / Right', 'Back / forward 5 seconds'],
    ['J / L', 'Back / forward 10 seconds'],
    ['0 / 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9', 'Jump to 0 %, 10 % … 90 %'],
    ['Home / End', 'The start / the end'],
    ['Up / Down', 'Volume up / down'],
    ['M', 'Mute'],
    ['Shift+, / Shift+.', 'Slower / faster'],
    ['F', 'Full screen'],
    ['P', 'Picture in picture'],
    ['I', 'Video information'],
    ['Shift+N / Shift+P', 'Next / previous video'],
    ['Esc', 'Back to the library'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs, fmt, store, clear } = api;
    const HOME = vfs.HOME;
    const TRASH = `${HOME}/Trash`;
    const tilde = p => (p === HOME ? '~' : p.startsWith(HOME + '/') ? `~${p.slice(HOME.length)}` : p);

    const S = {
      view: 'library',
      path: null, node: null,
      filter: '',
      loop: false, rate: 1, muted: false,
      pop: null,              /* 'settings' | 'info' | null */
      err: null,              /* { kind, title, detail } */
      ended: false,
      seq: 0,                 /* bumps on every load; stale async results check it */
      scrub: null,            /* { was, t } while dragging the seek bar */
      importing: null,        /* { done, total } */
      session: null,          /* our MediaMetadata while we own the media session */
      lastSec: -1,
      dead: false,
    };
    const T = { idle: 0, flash: 0, raf: 0, dl: new Map(), own: null };   /* dl: download URL -> revoke timer */
    const offs = [];
    const listen = (target, evt, fn, o) => { target.addEventListener(evt, fn, o); offs.push(() => target.removeEventListener(evt, fn, o)); };
    const osVol = () => fmt.clamp(Number(store.get('prefs.volume', 62)) || 0, 0, 100);
    const osMuted = () => store.get('prefs.muted', false) === true;
    const reduced = () => !!store.get('prefs.reduceMotion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ================================================================
       posters — a real frame per file, two decoders at a time
       ================================================================ */
    const inflight = new Map();          /* key -> Promise */
    const waiting = [];
    const live = new Map();              /* poster <video> -> abort() */
    let running = 0;

    function posterFor(node) {
      const key = keyOf(node);
      if (posters.has(key)) return Promise.resolve(posters.get(key));
      if (inflight.has(key)) return inflight.get(key);
      const p = new Promise(resolve => { waiting.push({ node, key, resolve }); pump(); });
      inflight.set(key, p);
      return p;
    }

    function pump() {
      while (running < 2 && waiting.length && !S.dead) {
        const job = waiting.shift();
        running++;
        grab(job.node)
          .then(info => info, e => (e && e.code === 'abort' ? null : { error: e?.code ?? 4, msg: e?.msg || '' }))
          .then(info => {
            running--;
            inflight.delete(job.key);
            if (info) posters.set(job.key, info);
            job.resolve(info);
            pump();
          });
      }
    }

    async function grab(node) {
      if (!media.isMedia(node)) throw { code: 'nodata' };
      const url = await media.urlOf(node);
      if (!url) throw { code: 'missing' };
      if (S.dead) throw { code: 'abort' };
      const v = document.createElement('video');
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      v.preload = 'metadata';
      let abort;
      const aborted = new Promise((_, reject) => { abort = () => reject({ code: 'abort' }); });
      live.set(v, abort);
      let own = null;
      const work = (async () => {
        v.src = url;
        await once(v, 'loadedmetadata');
        if (!seekableOk(v) && isAsset(node)) {
          const blob = await media.blobOf(node);
          if (S.dead) throw { code: 'abort' };
          if (blob) {
            own = URL.createObjectURL(blob);
            v.src = own;
            await once(v, 'loadedmetadata');
          }
        }
        const dur = await finiteDuration(v);
        if (!v.videoWidth || !v.videoHeight) throw { code: 'novideo' };
        const at = dur > 0 ? Math.min(dur * 0.1, Math.max(0, dur - 0.05)) : 0;
        const seeked = once(v, 'seeked');
        v.currentTime = at;
        await seeked;
        if (v.readyState < 2) await once(v, 'canplay', 4000).catch(() => {});
        const s = Math.min(1, POSTER_MAX / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(v.videoWidth * s));
        c.height = Math.max(1, Math.round(v.videoHeight * s));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        return { src: c.toDataURL('image/jpeg', 0.82), pw: c.width, ph: c.height, w: v.videoWidth, h: v.videoHeight, dur };
      })();
      try {
        return await Promise.race([work, aborted]);
      } finally {
        work.catch(() => {});
        live.delete(v);
        v.removeAttribute('src');
        try { v.load(); } catch (e) { /* already gone */ }
        if (own) URL.revokeObjectURL(own);
      }
    }

    /* ================================================================
       the library
       ================================================================ */
    function scan() {
      const groups = new Map();
      vfs.walk(HOME, (n, path) => {
        if (!isVideo(n)) return;
        if (path === TRASH || path.startsWith(TRASH + '/')) return;
        if (path.slice(HOME.length).split('/').some(part => part.startsWith('.'))) return;
        const dir = vfs.parentPath(path);
        if (!groups.has(dir)) groups.set(dir, []);
        groups.get(dir).push({ node: n, path, dir });
      });
      const rank = dir => {
        const i = FIRST_DIRS.map(d => `${HOME}/${d}`).indexOf(dir);
        return i < 0 ? FIRST_DIRS.length : i;
      };
      const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      return [...groups.entries()]
        .sort(([a], [b]) => rank(a) - rank(b) || coll.compare(a, b))
        .map(([dir, items]) => ({
          dir,
          items: items.sort((a, b) => (new Date(b.node.mtime) - new Date(a.node.mtime)) || coll.compare(a.node.name, b.node.name)),
        }));
    }
    const flatList = () => scan().flatMap(g => g.items);

    /* ---- chrome ---- */
    const backBtn = h('button.ibtn.tip.tip--below', {
      type: 'button', 'data-tip': 'Library (Esc)', 'aria-label': 'Back to library', onclick: () => showLibrary(),
    }, icon('chevron-left'));

    const fileInput = h('input.sr', {
      type: 'file', accept: ACCEPT, multiple: true, tabindex: '-1', 'aria-hidden': 'true',
      onchange: e => { const files = [...(e.target.files || [])]; e.target.value = ''; importFiles(files); },
    });
    const pickFiles = () => fileInput.click();

    function paintTools() {
      if (S.view === 'library') {
        win.setLead();
        win.setTools(h('button.ibtn.tip.tip--below', {
          type: 'button', 'data-tip': 'Open ~/Videos in Files', 'aria-label': 'Open the Videos folder in Files',
          onclick: () => api.openApp('files', { path: `${HOME}/Videos` }),
        }, icon('folder-open')));
      } else {
        win.setLead(backBtn);
        win.setTools(
          h('button.ibtn.tip.tip--below', {
            type: 'button', 'data-tip': 'Trim', 'aria-label': 'Trim this video', onclick: () => S.path && openTrim(S.path),
          }, icon('crop')),
          h('button.ibtn.tip.tip--below', {
            type: 'button', 'data-tip': 'Download', 'aria-label': 'Download this video to your computer',
            onclick: () => S.path && download(S.path),
          }, icon('download')),
          h('button.ibtn.tip.tip--below', {
            type: 'button', 'data-tip': 'More', 'aria-label': 'More actions', 'aria-haspopup': 'menu',
            onclick: e => S.path && fileMenu(S.path, e.currentTarget),
          }, icon('more-horizontal')));
      }
    }

    /* ---- layout ---- */
    const liveRegion = h('div.sr', { 'aria-live': 'polite', 'aria-atomic': 'true' });
    const libBar = h('div.app__bar.vid-libbar');
    const libBody = h('div.app__content.vid-lib__body');
    const libEl = h('section.vid-lib', { 'aria-label': 'Video library' }, libBar, libBody);
    const dropEl = h('div.vid-drop', { 'aria-hidden': 'true' },
      h('div.vid-drop__card', icon('upload'), h('b', { text: 'Drop to import' }), h('small', { text: 'Videos are copied into ~/Videos' })));
    const dialogHost = h('div.vid-dialoghost');

    /* the player is built once and reused for every clip */
    const P = buildPlayer();

    const app = h('div.app.app--col.vid', libEl, P.el, dropEl, dialogHost, fileInput, liveRegion);
    root.appendChild(app);

    function say(text) { liveRegion.textContent = ''; liveRegion.textContent = text; }

    const filterIn = h('input', {
      type: 'search', placeholder: 'Filter videos', spellcheck: 'false', 'aria-label': 'Filter videos by name',
      oninput: e => { S.filter = e.target.value.trim().toLowerCase(); paintLibraryBody(); },
      onkeydown: e => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; S.filter = ''; paintLibraryBody(); } },
    });
    const filterBox = h('label.field.vid-filter', icon('search'), filterIn);
    const countEl = h('span.vid-libbar__count');
    const importBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: pickFiles }, icon('upload'), h('span', { text: 'Import' }));
    libBar.append(h('div.app__title', { text: 'Library' }), countEl, h('div.grow'), filterBox, importBtn);

    function paintLibraryBody() {
      const groups = scan();
      const all = groups.flatMap(g => g.items);
      const bytes = all.reduce((a, v) => a + (media.isMedia(v.node) ? (v.node.size || 0) : 0), 0);
      countEl.textContent = S.importing
        ? `Importing ${S.importing.done + 1} of ${S.importing.total}…`
        : all.length ? `${all.length} video${all.length === 1 ? '' : 's'} · ${fmt.fmtBytes(bytes)}` : '';
      importBtn.disabled = !!S.importing;

      const q = S.filter;
      const shown = groups.map(g => ({ ...g, items: q ? g.items.filter(v => v.node.name.toLowerCase().includes(q)) : g.items }))
        .filter(g => g.items.length);
      clear(libBody);

      if (!all.length) {
        libBody.append(h('div.empty.vid-empty',
          h('div.vid-empty__glyph', icon('film')),
          h('b', { text: 'No videos yet' }),
          h('small', { text: 'Import a video from your computer, or drop one anywhere in this window. It is copied into ~/Videos and stays in this browser.' }),
          h('button.btn.btn--primary', { type: 'button', onclick: pickFiles }, icon('upload'), h('span', { text: 'Import videos' }))));
        return;
      }
      if (!shown.length) {
        libBody.append(h('div.empty',
          icon('search'),
          h('b', { text: 'No matching videos' }),
          h('small', { text: `No video name contains “${S.filter}”.` }),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { filterIn.value = ''; S.filter = ''; paintLibraryBody(); filterIn.focus(); } }, h('span', { text: 'Clear filter' }))));
        return;
      }

      for (const g of shown) {
        const dirNode = vfs.node(g.dir);
        libBody.append(h('section.vid-group', { 'aria-label': `${vfs.baseName(g.dir)} folder` },
          h('header.vid-group__head',
            h('span.vid-group__ic', icon(vfs.iconFor(dirNode)), null),
            h('h3.vid-group__name', { text: vfs.baseName(g.dir) }),
            h('span.vid-group__path.mono', { text: tilde(g.dir) }),
            h('span.grow'),
            h('span.vid-group__n', { text: `${g.items.length}` }),
            h('button.ibtn.tip', {
              type: 'button', 'data-tip': 'Show in Files', 'aria-label': `Show ${tilde(g.dir)} in Files`,
              onclick: () => api.openApp('files', { path: g.dir }),
            }, icon('folder-open'))),
          h('div.vid-grid', g.items.map(card))));
      }
      libBody.append(h('button.vid-dropzone', { type: 'button', onclick: pickFiles },
        icon('upload'),
        h('span', h('b', { text: 'Add videos' }), h('small', { text: ' — drop files here or choose them from your computer. MP4 and WebM play in most browsers.' }))));
    }

    function card(item) {
      const { node, path } = item;
      const art = h('span.vid-card__art');
      const nameEl = h('b.vid-card__name', { text: node.name });
      const meta = h('small.vid-card__meta');
      const main = h('button.vid-card__main', {
        type: 'button',
        onclick: () => openPath(path),
        oncontextmenu: e => { e.preventDefault(); fileMenu(path, null, e.clientX, e.clientY); },
        onkeydown: e => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault();
            fileMenu(path, e.currentTarget);
          }
        },
      }, art, h('span.vid-card__text', nameEl, meta));
      const more = h('button.vid-card__more', {
        type: 'button', 'aria-label': `More actions for ${node.name}`, 'aria-haspopup': 'menu',
        onclick: e => fileMenu(path, e.currentTarget),
      }, icon('more-horizontal'));
      const el = h('div.vid-card', { dataset: { path } }, main, more);

      const fill = info => {
        clear(art);
        const size = media.isMedia(node) ? fmt.fmtBytes(node.size) : 'No data';
        if (!info) {
          art.append(h('span.vid-card__ph.is-loading', h('i.vid-spin'), h('span.sr', { text: 'Reading the first frames' })));
          meta.textContent = size;
          main.setAttribute('aria-label', `Play ${node.name}, ${size}`);
          return;
        }
        if (info.error) {
          const text = info.error === 'nodata' ? 'No video data'
            : info.error === 'missing' ? 'Video data missing'
            : info.error === 4 ? 'Format not supported here'
            : info.error === 3 ? 'Could not be decoded'
            : info.error === 'novideo' ? 'Sound only, no picture'
            : 'No preview';
          el.classList.add('is-bad');
          art.append(h('span.vid-card__ph', icon(info.error === 'novideo' ? 'music' : 'alert'), h('span', { text })));
          meta.textContent = `${size} · ${(extOf(node.name) || 'file').toUpperCase()}`;
          main.setAttribute('aria-label', `${node.name}: ${text}. Open for details`);
          return;
        }
        art.append(
          h('img.vid-card__img', { src: info.src, alt: '', draggable: 'false', width: String(info.w), height: String(info.h) }),
          h('span.vid-card__play', { 'aria-hidden': 'true' }, icon('play', { fill: true })),
          h('span.vid-card__dur.mono', { text: fmtLen(info.dur) }));
        meta.textContent = `${size} · ${info.w}×${info.h}`;
        main.setAttribute('aria-label', `Play ${node.name}, ${fmtLen(info.dur)}, ${info.w} by ${info.h}, ${size}`);
      };

      const known = posters.get(keyOf(node));
      fill(known || (media.isMedia(node) ? null : { error: 'nodata' }));
      if (!known && media.isMedia(node)) posterFor(node).then(info => { if (info && el.isConnected) fill(info); });
      return el;
    }

    /* ================================================================
       file actions — shared by cards and the player
       ================================================================ */
    function fileMenu(path, anchor, x, y) {
      const n = vfs.node(path);
      if (!n) return;
      if (anchor) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 4; }
      const playing = S.view === 'player' && S.path === path;
      api.menu([
        playing ? null : { label: 'Play', icon: 'play', onClick: () => openPath(path) },
        { label: 'Rename…', icon: 'edit-3', onClick: () => rename(path) },
        { label: 'Trim…', icon: 'crop', disabled: !media.isMedia(n), onClick: () => openTrim(path) },
        { label: 'Download', icon: 'download', disabled: !media.isMedia(n), onClick: () => download(path) },
        { label: 'Show in Files', icon: 'folder-open', onClick: () => api.openApp('files', { path: vfs.parentPath(path) }) },
        /* with a friend: play it in sync (Watch Together), or hand it over (Static Drop) */
        api.getApp('watch-together') && media.isMedia(n) ? { label: 'Watch together…', icon: 'users', onClick: () => api.openApp('watch-together', { path }) } : null,
        api.getApp('drop') && media.isMedia(n) ? { label: 'Send with Drop…', icon: 'send', onClick: () => api.openApp('drop', { send: [path] }) } : null,
        '-',
        { label: 'Move to Trash', icon: 'trash', danger: true, onClick: () => trash(path) },
      ].filter(Boolean), x, y);
    }

    /* the trimmer (js/videos/trimmer.js) lays a panel over this window */
    let trimmer = null;
    async function openTrim(path) {
      const n = vfs.node(path);
      if (!n || !media.isMedia(n) || trimmer) return;
      try { if (loaded()) video.pause(); } catch (e) { /* nothing playing */ }
      const mod = await import('../videos/trimmer.js');
      if (S.dead || trimmer) return;
      trimmer = mod.openTrimmer({ api, host: app, path, onOpenFile: p => openPath(p), onClose: () => { trimmer = null; } });
    }

    async function download(path) {
      const n = vfs.node(path);
      if (!n) return;
      let blob = null;
      try { blob = await media.blobOf(n); } catch (e) { blob = null; }
      if (S.dead) return;
      if (!blob) {
        api.notify({ app: 'Videos', icon: 'alert', title: 'Nothing to download', message: `“${n.name}” has no video data behind it.` });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: n.name, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      a.remove();
      T.dl.set(url, setTimeout(() => { URL.revokeObjectURL(url); T.dl.delete(url); }, 8000));
      say(`Downloading ${n.name}`);
    }

    function trash(path) {
      const n = vfs.node(path);
      if (!n) return;
      const dir = vfs.parentPath(path);
      const name = n.name;
      if (S.path === path) { releaseVideo(); showLibrary(); }
      if (!vfs.rm(path)) {
        api.notify({ app: 'Videos', icon: 'alert', title: 'Could not move to Trash', message: name });
        return;
      }
      api.notify({
        app: 'Videos', icon: 'trash', title: 'Moved to Trash', message: name,
        actions: [{
          label: 'Undo',
          onClick: () => {
            const tr = vfs.node(TRASH);
            if (!tr || !tr.children.includes(n) || !vfs.node(dir)) return;
            if (vfs.node(`${dir}/${name}`)) {
              api.notify({ app: 'Videos', icon: 'alert', title: 'Could not put it back', message: `There is already a “${name}” in ${tilde(dir)}.` });
              return;
            }
            vfs.mv(`${TRASH}/${n.name}`, dir);
            if (n.name !== name) vfs.rename(`${dir}/${n.name}`, name);
          },
        }],
      });
    }

    /* ---- rename sheet (in the window, so it works in every view) ---- */
    let closeDialog = null;
    function rename(path) {
      const n = vfs.node(path);
      if (!n) return;
      closeDialog?.();
      const ext = extOf(n.name);
      const back = document.activeElement;
      const input = h('input', { type: 'text', spellcheck: 'false', 'aria-label': 'New name', value: stemOf(n.name) });
      const err = h('div.vid-dialog__err', { role: 'alert' });
      const done = () => {
        closeDialog = null;
        wrap.remove();
        if (back && back.isConnected) back.focus({ preventScroll: true });
      };
      const submit = () => {
        let stem = input.value.trim();
        if (!stem) { err.textContent = 'Give it a name.'; return; }
        if (/[\\/]/.test(stem)) { err.textContent = 'A name can’t contain / or \\.'; return; }
        if (stem.startsWith('.')) { err.textContent = 'A name can’t start with a dot — the file would be hidden.'; return; }
        if (ext && stem.toLowerCase().endsWith(`.${ext}`)) stem = stem.slice(0, -(ext.length + 1));
        const next = ext ? `${stem}.${ext}` : stem;
        if (next === n.name) { done(); return; }
        const dir = vfs.parentPath(path);
        if (vfs.node(`${dir}/${next}`)) { err.textContent = `There is already a file called “${next}” in ${tilde(dir)}.`; return; }
        if (!vfs.rename(path, next)) { err.textContent = 'That name could not be used.'; return; }
        if (S.path === path) { S.path = `${dir}/${next}`; win.setTitle(next); P.paintTitle(); }
        say(`Renamed to ${next}`);
        done();
      };
      const wrap = h('div.vid-dialog', {
        onpointerdown: e => { if (e.target === wrap) done(); },
        onkeydown: e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
          else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); submit(); }
          else if (e.key === 'Tab') {                       /* keep focus in the sheet */
            const f = [...wrap.querySelectorAll('input,button')];
            const i = f.indexOf(document.activeElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
            else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
          }
        },
      }, h('div.vid-dialog__card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Rename ${n.name}` },
        h('div.vid-dialog__title', { text: 'Rename video' }),
        h('label.field.vid-dialog__field', input, ext ? h('span.vid-dialog__ext.mono', { text: `.${ext}` }) : null),
        err,
        h('div.vid-dialog__row',
          h('button.btn.btn--ghost', { type: 'button', onclick: done }, h('span', { text: 'Cancel' })),
          h('button.btn.btn--primary', { type: 'button', onclick: submit }, h('span', { text: 'Rename' })))));
      dialogHost.appendChild(wrap);
      closeDialog = done;
      input.focus();
      input.select();
    }

    /* ---- import ---- */
    async function importFiles(files) {
      const vids = files.filter(f => media.kindOf(f.type) === 'video' || media.kindOf(f.name) === 'video');
      const skipped = files.length - vids.length;
      if (!vids.length) {
        if (files.length) api.notify({ app: 'Videos', icon: 'film', title: 'Nothing imported', message: `${files.length === 1 ? 'That file isn’t' : 'None of those files are'} a video.` });
        return;
      }
      const dir = `${HOME}/Videos`;
      const saved = [];
      const failed = [];
      S.importing = { done: 0, total: vids.length };
      if (S.view === 'library') paintLibraryBody();
      for (const f of vids) {
        try {
          const out = await media.importFiles(dir, [f]);
          if (out[0]) saved.push(out[0].path);
        } catch (e) {
          failed.push(`${f.name}: ${e?.message || e}`);
        }
        if (S.dead) return;
        S.importing.done++;
        if (S.view === 'library') paintLibraryBody();
      }
      S.importing = null;
      if (S.view === 'library') paintLibraryBody();
      if (failed.length) {
        api.notify({ app: 'Videos', icon: 'alert', title: `${failed.length} video${failed.length === 1 ? '' : 's'} not imported`, message: failed.join('\n'), timeout: 12000 });
      }
      if (saved.length === 1 && !skipped && !failed.length) { openPath(saved[0]); return; }
      if (saved.length) {
        api.notify({
          app: 'Videos', icon: 'film',
          title: `Imported ${saved.length} video${saved.length === 1 ? '' : 's'}`,
          message: `Saved to ~/Videos${skipped ? ` · skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? 'isn’t a video' : 'aren’t videos'}` : ''}.`,
        });
      }
    }

    let dragDepth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    listen(root, 'dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; app.classList.add('is-drop'); });
    listen(root, 'dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    listen(root, 'dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) app.classList.remove('is-drop'); });
    listen(root, 'drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      app.classList.remove('is-drop');
      importFiles([...(e.dataTransfer.files || [])]);
    });

    /* ================================================================
       the player
       ================================================================ */
    function buildPlayer() {
      const E = {};
      const video = h('video.vid-video', { playsinline: '', preload: 'auto', 'aria-label': 'Video' });
      video.controls = false;

      /* a mouse click hands focus back to the stage, so Space keeps meaning
         play/pause; keyboard users stay on the button they pressed */
      const ctlBtn = (cls, tip, label, ic, onclick, extra = {}, keep = false) => h(`button.vid-btn${cls}.tip`, {
        type: 'button', 'data-tip': tip, 'aria-label': label, ...extra,
        onclick: e => { onclick(e); if (e.detail > 0 && !keep) E.stage.focus({ preventScroll: true }); },
      }, ic);

      const skipIc = (dir) => h('span.vid-skip', { 'aria-hidden': 'true' }, icon('rotate-ccw', dir > 0 ? 'vid-skip--fwd' : ''), h('b', { text: '10' }));

      E.play = ctlBtn('.vid-btn--play', 'Play (K)', 'Play', icon('play', { fill: true }), () => toggle());
      E.back = ctlBtn('.vid-hide-narrow', 'Back 10 s (J)', 'Back 10 seconds', skipIc(-1), () => seekBy(-10));
      E.fwd = ctlBtn('.vid-hide-narrow', 'Forward 10 s (L)', 'Forward 10 seconds', skipIc(1), () => seekBy(10));
      E.mute = ctlBtn('', 'Mute (M)', 'Mute', icon('volume-2'), () => toggleMute());
      E.vol = h('input.vid-vol__slider', {
        type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Volume (system)',
        oninput: e => {
          const v = Number(e.target.value);
          if (v > 0 && S.muted) S.muted = false;
          store.set('prefs.volume', v);
          applyAudio();
        },
      });
      E.volWrap = h('div.vid-vol', E.mute, E.vol);
      E.time = h('span.vid-time.mono', { 'aria-hidden': 'true' });
      E.rateBadge = h('span.vid-btn__badge');
      E.settings = ctlBtn('', 'Speed and loop', 'Playback settings', [icon('settings'), E.rateBadge], () => togglePop('settings', E.settings), { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, true);
      E.info = ctlBtn('', 'Info (I)', 'Video info', icon('info'), () => togglePop('info', E.info), { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, true);
      E.pip = ctlBtn('', 'Picture in picture (P)', 'Picture in picture', icon('picture-in-picture'), () => togglePip());
      E.fs = ctlBtn('', 'Fullscreen (F)', 'Fullscreen', icon('maximize'), () => toggleFs());

      /* seek bar: buffered ranges under the played part, a thumb, a hover time */
      E.buf = h('span.vid-seek__buf');
      E.fill = h('span.vid-seek__fill');
      E.thumb = h('span.vid-seek__thumb');
      E.hover = h('span.vid-seek__hover');
      E.tip = h('span.vid-seek__tip.mono', { 'aria-hidden': 'true' });
      E.seek = h('div.vid-seek', {
        role: 'slider', tabindex: '0', 'aria-label': 'Seek', 'aria-valuemin': '0', 'aria-valuemax': '0', 'aria-valuenow': '0',
        onkeydown: e => {
          if (e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); seekBy(10); }
          else if (e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); seekBy(-10); }
        },
      }, h('span.vid-seek__rail', E.buf, E.hover, E.fill, E.thumb), E.tip);

      E.bar = h('div.vid-bar',
        E.play, E.back, E.fwd, E.volWrap, E.time, h('span.grow'),
        E.settings, E.info, E.pip, E.fs);
      E.pop = h('div.vid-pop', { hidden: true });
      E.ctrls = h('div.vid-ctrls', E.seek, E.bar);

      E.big = h('button.vid-big', { type: 'button', 'aria-label': 'Play', onclick: e => { e.stopPropagation(); toggle(); E.stage.focus({ preventScroll: true }); } }, icon('play', { fill: true }));
      E.next = h('button.vid-next', { type: 'button', hidden: true, onclick: e => { e.stopPropagation(); step(1); } });
      E.center = h('div.vid-center', E.big, E.next);
      E.spin = h('div.vid-busy', { 'aria-hidden': 'true' }, h('i.vid-spin'));
      E.flash = h('div.vid-flash', { 'aria-hidden': 'true' });
      E.msg = h('div.vid-msg', { hidden: true });          /* announced through the live region */
      E.pipNote = h('div.vid-pipnote',
        icon('picture-in-picture'),
        h('span', { text: 'Playing in picture-in-picture' }),
        h('button.btn.btn--sm', { type: 'button', onclick: () => togglePip() }, h('span', { text: 'Bring it back' })));
      E.titleText = h('b.trunc');
      E.titleSub = h('small.trunc');
      E.top = h('div.vid-top', h('div.vid-top__text', E.titleText, E.titleSub));

      E.stage = h('div.vid-stage.is-paused.is-loading', { tabindex: '-1' },
        video, E.pipNote, E.center, E.spin, E.flash, E.msg, E.top, E.ctrls, E.pop);
      /* on a phone the video sits at the top and this column follows it:
         title, what the file really is, actions, the other videos */
      E.below = h('div.vid-below');
      E.el = h('section.vid-player', { hidden: true, 'aria-label': 'Video player' }, E.stage, E.below);
      E.video = video;
      E.paintTitle = () => {
        if (!S.node) return;
        E.titleText.textContent = S.node.name;
        E.titleSub.textContent = tilde(vfs.parentPath(S.path));
        paintBelow();
      };
      return E;
    }

    const video = P.video;
    const stage = P.stage;
    const dur = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
    /* currentSrc outlives a removed src attribute in Chromium, so ask the attribute */
    const loaded = () => !!video.getAttribute('src');
    /* seeking to the very end while paused sets video.ended without an 'ended' event */
    const atEnd = () => !S.err && loaded() && video.paused && (S.ended || video.ended || (dur() > 0 && video.currentTime >= dur() - 0.05));

    /* ---- load / release ---- */
    async function openPath(p) {
      const path = vfs.norm(p);
      const n = vfs.node(path);
      if (!n || n.type !== 'file') {
        api.notify({ app: 'Videos', icon: 'alert', title: 'Video not found', message: `${tilde(path)} isn’t there any more.` });
        if (S.view !== 'library') showLibrary();
        return;
      }
      closeDialog?.();
      releaseVideo();
      const seq = ++S.seq;
      S.view = 'player';
      S.path = path;
      S.node = n;
      S.err = null;
      S.ended = false;
      S.lastSec = -1;
      closePop();
      libEl.hidden = true;
      P.el.hidden = false;
      win.setTitle(n.name);
      win.setSubtitle(tilde(vfs.parentPath(path)));
      paintTools();
      P.paintTitle();
      stage.classList.add('is-loading', 'is-paused');
      stage.classList.remove('is-error', 'is-ended', 'is-playing');
      P.msg.hidden = true;
      paintAll();
      stage.focus({ preventScroll: true });

      if (!media.isMedia(n)) { showError('nodata'); return; }
      const url = await media.urlOf(n);
      if (seq !== S.seq || S.dead) return;
      if (!url) { showError('missing'); return; }
      video.src = url;
      video.loop = S.loop;
      applyAudio();
      video.load();
      video.playbackRate = S.rate;
      video.defaultPlaybackRate = S.rate;
      try {
        await once(video, 'loadedmetadata', 30000);
      } catch (e) {
        if (seq !== S.seq || S.dead || S.err) return;
        showError(e?.code === 'timeout' ? 'timeout' : e?.code || 4, e?.msg);
        return;
      }
      if (seq !== S.seq || S.dead) return;
      if (!seekableOk(video) && isAsset(n)) {
        let blob = null;
        try { blob = await media.blobOf(n); } catch (e) { blob = null; }
        if (seq !== S.seq || S.dead) return;
        if (blob) {
          T.own = URL.createObjectURL(blob);
          video.src = T.own;
          video.load();
          video.playbackRate = S.rate;
          try { await once(video, 'loadedmetadata', 30000); } catch (e) {
            if (seq !== S.seq || S.dead || S.err) return;
            showError(e?.code === 'timeout' ? 'timeout' : e?.code || 4, e?.msg);
            return;
          }
          if (seq !== S.seq || S.dead) return;
        }
      }
      if (!Number.isFinite(video.duration)) {
        try { await finiteDuration(video); } catch (e) { /* plays anyway; the bar fills in when the length is known */ }
        if (seq !== S.seq || S.dead) return;
      }
      if (!video.videoWidth) say(`${n.name} has sound but no picture.`);
      stage.classList.remove('is-loading');
      paintAll();
      play();
    }

    function releaseVideo() {
      S.seq++;
      try { video.pause(); } catch (e) {}
      if (video.hasAttribute('src')) {
        video.removeAttribute('src');
        try { video.load(); } catch (e) {}
      }
      if (T.own) { URL.revokeObjectURL(T.own); T.own = null; }
      cancelAnimationFrame(T.raf);
      T.raf = 0;
      releaseSession();
    }

    function play() {
      if (S.err || !loaded()) return;
      const p = video.play();
      if (p && p.catch) {
        p.catch(err => {
          if (S.dead || err?.name === 'AbortError') return;
          /* NotAllowedError: the browser wants a click first. Stay paused
             with the big play button up — nothing is wrong with the file. */
          if (err?.name === 'NotAllowedError') { say('Press play to start the video.'); paintAll(); }
        });
      }
    }
    function toggle() {
      if (S.err || !loaded()) return;
      if (video.paused || video.ended) {
        if (atEnd()) video.currentTime = 0;
        play();
      } else video.pause();
    }
    function seekTo(t) {
      const d = dur();
      if (!d) return;
      video.currentTime = fmt.clamp(t, 0, d);
      S.ended = false;
      paintTime(true);
    }
    function seekBy(sec) {
      const d = dur();
      if (!d || S.err) return;
      const from = video.currentTime;
      const to = fmt.clamp(from + sec, 0, d);
      seekTo(to);
      flash(`${sec < 0 ? '−' : '+'}${Math.abs(sec)} s`, sec < 0 ? 'rotate-ccw' : null);
    }
    function setRate(r) {
      S.rate = r;
      video.playbackRate = r;
      video.defaultPlaybackRate = r;
      paintRate();
      flash(`${r}×`, 'gauge');
      syncPop();
    }
    function stepRate(dir) {
      const i = SPEEDS.indexOf(S.rate);
      const next = SPEEDS[fmt.clamp((i < 0 ? 2 : i) + dir, 0, SPEEDS.length - 1)];
      if (next !== S.rate) setRate(next);
      else flash(`${S.rate}× is the ${dir > 0 ? 'fastest' : 'slowest'}`, 'gauge');
    }
    function setLoop(on) {
      S.loop = on;
      video.loop = on;
      flash(on ? 'Loop on' : 'Loop off', 'repeat');
      syncPop();
      paintRate();
      paintBig();
    }
    function step(dir) {
      const list = flatList().filter(v => media.isMedia(v.node));
      const i = list.findIndex(v => v.path === S.path);
      const next = list[(i < 0 ? 0 : i + dir + list.length) % list.length];
      if (next && next.path !== S.path) openPath(next.path);
    }
    const nextItem = () => {
      const list = flatList().filter(v => media.isMedia(v.node));
      const i = list.findIndex(v => v.path === S.path);
      return list.length > 1 && i >= 0 ? list[(i + 1) % list.length] : null;
    };

    /* ---- volume: prefs.volume is the level, prefs.muted the system mute ---- */
    function applyAudio() {
      video.volume = osVol() / 100;
      video.muted = S.muted || osMuted();
      paintVol();
    }
    function toggleMute() {
      if (osMuted()) {
        S.muted = false;
        store.set('prefs.muted', false);
        if (!osVol()) store.set('prefs.volume', 50);
        applyAudio();
        flash('System sound on', 'volume-2');
        return;
      }
      if (S.muted || !osVol()) {
        S.muted = false;
        if (!osVol()) store.set('prefs.volume', 50);
        applyAudio();
        flash(`Volume ${osVol()}%`, 'volume-2');
      } else {
        S.muted = true;
        applyAudio();
        flash('Muted', 'volume-x');
      }
    }
    function volBy(d) {
      const v = fmt.clamp(osVol() + d, 0, 100);
      if (v > 0) S.muted = false;
      store.set('prefs.volume', v);
      applyAudio();
      flash(osMuted() ? `Volume ${v}% · system muted` : `Volume ${v}%`, v ? 'volume-2' : 'volume-x');
    }
    offs.push(store.sub('prefs', (_v, path) => {
      if (path === 'prefs.volume' || path === 'prefs.muted' || path === 'prefs') applyAudio();
    }));
    /* Settings' sweep writes volume/muted onto every media element; answer
       with ours so the player's own mute survives it. */
    listen(video, 'volumechange', () => {
      const want = S.muted || osMuted();
      if (video.muted !== want) video.muted = want;
      if (Math.abs(video.volume - osVol() / 100) > 0.001) video.volume = osVol() / 100;
      paintVol();
    });

    /* ---- fullscreen / picture-in-picture ---- */
    /* iPhone Safari can't put an element in fullscreen, only the video
       itself (with the system's own controls) — use that where it's all there is */
    const elFs = () => !!document.fullscreenEnabled && typeof stage.requestFullscreen === 'function';
    const nativeFs = () => typeof video.webkitEnterFullscreen === 'function';
    const canFs = () => elFs() || nativeFs();
    const isFs = () => document.fullscreenElement === stage;
    function toggleFs() {
      if (isFs()) { document.exitFullscreen?.().catch(() => {}); return; }
      if (elFs()) {
        stage.requestFullscreen({ navigationUI: 'hide' }).catch(err => flash(`Fullscreen failed: ${err?.message || err}`, 'alert'));
      } else if (nativeFs() && video.readyState >= 1) {
        try { video.webkitEnterFullscreen(); } catch (err) { flash(`Fullscreen failed: ${err?.message || err}`, 'alert'); }
      } else flash('Fullscreen isn’t allowed here', 'alert');
    }
    const canPip = () => !!document.pictureInPictureEnabled && !video.disablePictureInPicture && typeof video.requestPictureInPicture === 'function';
    const inPip = () => document.pictureInPictureElement === video;
    async function togglePip() {
      if (!canPip()) { flash('Picture-in-picture isn’t available in this browser', 'alert'); return; }
      try {
        if (inPip()) await document.exitPictureInPicture();
        else {
          if (video.readyState < 1) { flash('The video is still loading', 'alert'); return; }
          await video.requestPictureInPicture();
        }
      } catch (err) { flash(`Picture-in-picture failed: ${err?.message || err}`, 'alert'); }
    }
    listen(document, 'fullscreenchange', () => { paintFs(); wake(); });
    listen(video, 'enterpictureinpicture', () => { paintPip(); stage.classList.add('is-pip'); });
    listen(video, 'leavepictureinpicture', () => {
      stage.classList.remove('is-pip');
      paintPip();
      /* closed the floating window while browsing the library: stop there */
      if (S.view === 'library' && !S.dead) { releaseVideo(); S.node = null; S.path = null; }
    });

    /* ---- media session: hardware media keys, lock screen ---- */
    const SESSION_ACTIONS = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack', 'previoustrack'];
    function claimSession() {
      const ms = navigator.mediaSession;
      if (!ms || typeof window.MediaMetadata !== 'function' || !S.node) return;
      const node = S.node;
      const info = posters.get(keyOf(node));
      if (!info && media.isMedia(node)) {
        /* no card frame yet (opened straight from Files): make one, then add it */
        posterFor(node).then(i => { if (i?.src && S.session && S.node === node && navigator.mediaSession.metadata === S.session) claimSession(); });
      }
      try {
        S.session = new window.MediaMetadata({
          title: S.node.name, artist: 'Videos', album: tilde(vfs.parentPath(S.path)),
          artwork: info?.src ? [{ src: info.src, sizes: `${info.pw}x${info.ph}`, type: 'image/jpeg' }] : [],
        });
        ms.metadata = S.session;
      } catch (e) { S.session = null; return; }
      const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { /* unsupported action */ } };
      set('play', () => play());
      set('pause', () => video.pause());
      set('seekbackward', d => seekBy(-(d?.seekOffset || 10)));
      set('seekforward', d => seekBy(d?.seekOffset || 10));
      set('seekto', d => { if (Number.isFinite(d?.seekTime)) seekTo(d.seekTime); });
      set('nexttrack', () => step(1));
      set('previoustrack', () => step(-1));
    }
    function releaseSession() {
      const ms = navigator.mediaSession;
      if (!ms || !S.session) return;
      if (ms.metadata === S.session) {
        ms.metadata = null;
        for (const a of SESSION_ACTIONS) { try { ms.setActionHandler(a, null); } catch (e) {} }
      }
      S.session = null;
    }

    /* ---- video events ---- */
    const loopPaint = () => {
      T.raf = 0;
      paintTime();
      if (!video.paused && !S.dead) T.raf = requestAnimationFrame(loopPaint);
    };
    listen(video, 'play', () => { S.ended = false; paintAll(); wake(); claimSession(); });
    listen(video, 'playing', () => {
      stage.classList.remove('is-waiting', 'is-loading');
      if (!T.raf) T.raf = requestAnimationFrame(loopPaint);
    });
    listen(video, 'pause', () => { paintAll(); wake(); });
    listen(video, 'waiting', () => stage.classList.add('is-waiting'));
    listen(video, 'canplay', () => stage.classList.remove('is-waiting'));
    listen(video, 'seeked', () => { stage.classList.remove('is-waiting'); paintAll(); });
    listen(video, 'timeupdate', () => paintTime());
    listen(video, 'progress', () => paintBuffered());
    listen(video, 'durationchange', () => paintTime(true));
    listen(video, 'loadeddata', () => { paintBuffered(); paintPip(); });
    listen(video, 'loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) stage.style.setProperty('--ar', `${video.videoWidth} / ${video.videoHeight}`);
      else stage.style.removeProperty('--ar');
    });
    listen(video, 'durationchange', () => paintBelowMeta());
    listen(video, 'ratechange', () => paintRate());
    listen(video, 'ended', () => { S.ended = true; paintAll(); wake(); });
    listen(video, 'error', () => {
      if (!video.getAttribute('src') || S.err) return;
      showError(video.error?.code || 4, video.error?.message || '');
    });

    /* ---- honest errors ---- */
    function showError(kind, detailMsg = '') {
      const n = S.node;
      const name = n ? n.name : 'this file';
      const ext = n ? (extOf(n.name) || 'file').toUpperCase() : '';
      const E = {
        nodata: {
          title: `“${name}” has no video in it`,
          detail: 'This file is a leftover placeholder: no video was ever stored behind it, so there is nothing to play. Move it to the Trash, or import a real video.',
        },
        missing: {
          title: `The video data for “${name}” is gone`,
          detail: 'Its bytes were kept in this browser’s storage and aren’t there any more — site data may have been cleared. Import the video again to watch it.',
        },
        timeout: {
          title: `“${name}” didn’t load`,
          detail: 'The browser waited 30 seconds without getting the start of the video. Try again, or download it to check the file.',
        },
        1: { title: 'Loading was stopped', detail: 'Try again.' },
        2: {
          title: `“${name}” couldn’t be read`,
          detail: `A network error stopped the download partway${navigator.onLine === false ? ' — this device is offline' : ''}. Try again when you’re connected.`,
        },
        3: {
          title: `“${name}” couldn’t be decoded`,
          detail: 'The file may be damaged, or part of it uses a codec this browser can’t decode.',
        },
        4: {
          title: `This browser can’t play “${name}”`,
          detail: `Its format (${ext}) or the codec inside it isn’t supported here. Most browsers play MP4 (H.264) and WebM (VP8/VP9) video — convert it to one of those, or download it and open it in a desktop player.`,
        },
      }[kind] || { title: `“${name}” can’t be played`, detail: detailMsg || 'The browser reported an error it didn’t explain.' };
      S.err = { kind, ...E };
      closePop();
      try { video.pause(); } catch (e) {}
      if (video.hasAttribute('src')) { video.removeAttribute('src'); try { video.load(); } catch (e) {} }
      if (T.own) { URL.revokeObjectURL(T.own); T.own = null; }
      if (n) posters.set(keyOf(n), { error: kind, msg: detailMsg });
      stage.classList.add('is-error');
      stage.classList.remove('is-loading', 'is-waiting');
      clear(P.msg);
      const retry = kind === 2 || kind === 'timeout' || kind === 1;
      P.msg.append(
        h('div.vid-msg__ic', icon('alert')),
        h('b.vid-msg__title', { text: E.title }),
        h('p.vid-msg__detail', { text: E.detail }),
        detailMsg && kind !== 'nodata' && kind !== 'missing'
          ? h('p.vid-msg__tech.mono', { text: `Browser says: ${detailMsg}` }) : null,
        h('div.vid-msg__row',
          retry ? h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => { posters.delete(keyOf(n)); openPath(S.path); } }, icon('refresh'), h('span', { text: 'Try again' })) : null,
          n && media.isMedia(n) ? h('button.btn.btn--sm', { type: 'button', onclick: () => download(S.path) }, icon('download'), h('span', { text: 'Download' })) : null,
          kind === 'nodata' ? h('button.btn.btn--sm', { type: 'button', onclick: () => trash(S.path) }, icon('trash'), h('span', { text: 'Move to Trash' })) : null,
          h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('files', { path: vfs.parentPath(S.path) }) }, icon('folder-open'), h('span', { text: 'Show in Files' })),
          h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => showLibrary() }, h('span', { text: 'Library' }))));
      P.msg.hidden = false;
      paintAll();
      say(`${E.title}. ${E.detail}`);
    }

    /* ---- painting ---- */
    function paintAll() {
      const paused = video.paused || !!S.err;
      stage.classList.toggle('is-paused', paused);
      stage.classList.toggle('is-playing', !paused);
      stage.classList.toggle('is-ended', atEnd());
      const off = !!S.err || !loaded();
      for (const b of [P.play, P.back, P.fwd, P.settings]) b.disabled = off;
      P.info.disabled = !S.node;
      P.seek.setAttribute('aria-disabled', off ? 'true' : 'false');
      paintPlay(); paintBig(); paintTime(true); paintBuffered(); paintVol(); paintRate(); paintFs(); paintPip();
    }

    function paintPlay() {
      const playing = !video.paused && !S.err;
      const end = atEnd();
      clear(P.play);
      P.play.append(icon(end ? 'rotate-ccw' : playing ? 'pause' : 'play', { fill: !end }));
      const label = end ? 'Replay' : playing ? 'Pause' : 'Play';
      P.play.setAttribute('aria-label', label);
      P.play.dataset.tip = `${label} (K)`;
    }

    function paintBig() {
      clear(P.big);
      const ended = atEnd();
      P.big.append(icon(ended ? 'rotate-ccw' : 'play', { fill: !ended }));
      P.big.setAttribute('aria-label', ended ? 'Replay' : 'Play');
      const nx = ended && !S.loop ? nextItem() : null;
      P.next.hidden = !nx;
      if (nx) {
        clear(P.next);
        P.next.append(h('span.vid-next__k', { text: 'Up next' }), h('span.vid-next__n.trunc', { text: nx.node.name }), icon('chevron-right'));
        P.next.setAttribute('aria-label', `Play next: ${nx.node.name}`);
      }
    }

    function paintTime(force) {
      const d = dur();
      const t = S.scrub ? S.scrub.t : video.currentTime || 0;
      const f = d ? fmt.clamp(t / d, 0, 1) : 0;
      P.fill.style.width = `${(f * 100).toFixed(3)}%`;
      P.thumb.style.left = `${(f * 100).toFixed(3)}%`;
      P.time.textContent = d ? `${fmtTime(t, d)} / ${fmtTime(d, d)}` : (S.err ? '' : '–:–– / –:––');
      const sec = Math.floor(t * 10);
      if (force || sec !== S.lastSec) {
        S.lastSec = sec;
        P.seek.setAttribute('aria-valuemax', String(Math.round(d * 10) / 10));
        P.seek.setAttribute('aria-valuenow', String(Math.round(t * 10) / 10));
        P.seek.setAttribute('aria-valuetext', d ? `${fmtTime(t, d)} of ${fmtTime(d, d)}` : 'Not loaded');
        if (S.pop === 'info') paintInfoLive();
      }
    }

    function paintBuffered() {
      const d = dur();
      const b = video.buffered;
      const spans = [];
      if (d && b) {
        for (let i = 0; i < b.length; i++) {
          const s = b.start(i) / d, e = b.end(i) / d;
          spans.push(h('i', { style: { left: `${(s * 100).toFixed(3)}%`, width: `${Math.max(0, (e - s) * 100).toFixed(3)}%` } }));
        }
      }
      P.buf.replaceChildren(...spans);
    }

    function paintVol() {
      const v = osVol();
      const m = S.muted || osMuted() || v === 0;
      clear(P.mute);
      P.mute.append(icon(m ? 'volume-x' : v < 50 ? 'volume-1' : 'volume-2'));
      const label = osMuted() ? 'Unmute (system sound is muted)' : m ? 'Unmute' : 'Mute';
      P.mute.setAttribute('aria-label', label);
      P.mute.dataset.tip = `${label} (M)`;
      if (document.activeElement !== P.vol) P.vol.value = String(v);
      P.vol.style.setProperty('--v', `${m ? 0 : v}%`);
      P.vol.setAttribute('aria-valuetext', osMuted() ? `${v}%, system sound muted` : S.muted ? `${v}%, muted` : `${v}%`);
      P.volWrap.classList.toggle('is-muted', m);
    }

    function paintRate() {
      P.rateBadge.textContent = S.rate === 1 ? '' : `${S.rate}×`;
      P.settings.classList.toggle('is-on', S.rate !== 1 || S.loop);
    }

    function paintFs() {
      const on = isFs();
      P.fs.hidden = !canFs();
      clear(P.fs);
      P.fs.append(icon(on ? 'minimize-2' : 'maximize'));
      P.fs.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
      P.fs.dataset.tip = on ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
      stage.classList.toggle('is-fs', on);
    }

    function paintPip() {
      P.pip.hidden = !canPip();
      P.pip.classList.toggle('is-on', inPip());
      P.pip.setAttribute('aria-pressed', inPip() ? 'true' : 'false');
      P.pip.disabled = !!S.err || video.readyState < 1;
    }

    /* ---- seek bar pointer ---- */
    const seekFrac = e => {
      const r = P.seek.getBoundingClientRect();
      return fmt.clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
    };
    listen(P.seek, 'pointerdown', e => {
      if (e.button !== 0 || !dur() || S.err) return;
      e.preventDefault();
      P.seek.focus({ preventScroll: true });
      P.seek.setPointerCapture(e.pointerId);
      S.scrub = { was: !video.paused, t: seekFrac(e) * dur() };
      if (S.scrub.was) video.pause();
      stage.classList.add('is-scrubbing');
      video.currentTime = S.scrub.t;
      paintTime(true);
    });
    listen(P.seek, 'pointermove', e => {
      const d = dur();
      if (!d) return;
      const f = seekFrac(e);
      P.tip.textContent = fmtTime(f * d, d);
      P.tip.style.left = `${(f * 100).toFixed(2)}%`;
      P.hover.style.width = `${(f * 100).toFixed(2)}%`;
      if (S.scrub) {
        S.scrub.t = f * d;
        if (typeof video.fastSeek === 'function' && d > 60) video.fastSeek(S.scrub.t);
        else video.currentTime = S.scrub.t;
        paintTime(true);
      }
    });
    const endScrub = () => {
      if (!S.scrub) return;
      const { was, t } = S.scrub;
      S.scrub = null;
      stage.classList.remove('is-scrubbing');
      video.currentTime = t;
      S.ended = false;
      if (was) play();
      paintAll();
    };
    listen(P.seek, 'pointerup', endScrub);
    listen(P.seek, 'pointercancel', endScrub);
    listen(P.seek, 'lostpointercapture', endScrub);

    /* ---- stage pointer: click toggles, double-click fullscreens,
           touch taps show the controls first ---- */
    listen(video, 'click', e => {
      if (S.err) return;
      if (e.pointerType === 'touch' || S.lastPointer === 'touch') {
        if (stage.classList.contains('is-idle')) { wake(); return; }
      }
      toggle();
      flash(video.paused ? 'Paused' : 'Playing', video.paused ? 'pause' : 'play');
    });
    listen(video, 'dblclick', e => { e.preventDefault(); toggleFs(); });
    listen(stage, 'pointerdown', e => { S.lastPointer = e.pointerType; if (S.pop && !P.pop.contains(e.target) && !e.target.closest('[aria-haspopup]')) closePop(); });
    listen(stage, 'pointermove', () => wake());
    listen(stage, 'pointerleave', () => { if (!video.paused) hideSoon(250); });
    listen(stage, 'focusin', () => wake());

    function wake() {
      stage.classList.remove('is-idle');
      hideSoon(IDLE_MS);
    }
    function hideSoon(ms) {
      clearTimeout(T.idle);
      T.idle = setTimeout(() => {
        if (S.dead || video.paused || S.pop || S.scrub || S.err) return;
        const a = document.activeElement;
        if (a && P.ctrls.contains(a) && a.matches(':focus-visible')) return;   /* a keyboard user is in the controls */
        stage.classList.add('is-idle');
      }, ms);
    }

    function flash(text, ic) {
      clearTimeout(T.flash);
      clear(P.flash);
      if (ic) P.flash.append(icon(ic, ic === 'play' || ic === 'pause' ? { fill: true } : undefined));
      P.flash.append(h('span', { text }));
      P.flash.classList.remove('is-on');
      void P.flash.offsetWidth;                 /* restart the fade */
      P.flash.classList.add('is-on');
      T.flash = setTimeout(() => P.flash.classList.remove('is-on'), reduced() ? 900 : 700);
      say(text);
    }

    /* ---- popovers (inside the stage so they work in fullscreen) ---- */
    let popAnchor = null;
    function togglePop(kind, anchor) {
      if (S.pop === kind) { closePop(true); return; }
      S.pop = kind;
      popAnchor = anchor;
      for (const b of [P.settings, P.info]) b.setAttribute('aria-expanded', String(b === anchor));
      paintPop();
      P.pop.hidden = false;
      wake();
      /* settings: land on the chosen speed; info: on the panel itself, so a
         screen reader starts at its heading and Tab reaches the close button */
      const first = kind === 'settings' ? P.pop.querySelector('.vid-speed[aria-checked="true"]') : null;
      (first || P.pop).focus({ preventScroll: true });
    }
    function closePop(refocus) {
      if (!S.pop) return;
      S.pop = null;
      P.pop.hidden = true;
      clear(P.pop);
      for (const b of [P.settings, P.info]) b.setAttribute('aria-expanded', 'false');
      if (refocus && popAnchor && popAnchor.isConnected) popAnchor.focus({ preventScroll: true });
      popAnchor = null;
      hideSoon(IDLE_MS);
    }
    listen(P.pop, 'keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); }
    });

    const popClose = () => h('button.vid-pop__x', { type: 'button', 'aria-label': 'Close', onclick: () => closePop(true) }, icon('x'));
    let infoLive = null;
    function paintPop() {
      clear(P.pop);
      infoLive = null;
      P.pop.setAttribute('tabindex', '-1');
      if (S.pop === 'settings') {
        P.pop.setAttribute('role', 'dialog');
        P.pop.setAttribute('aria-label', 'Playback settings');
        const speeds = h('div.vid-speeds', { role: 'radiogroup', 'aria-label': 'Playback speed' },
          SPEEDS.map(r => h('button.vid-speed', {
            type: 'button', role: 'radio', 'aria-checked': String(r === S.rate), tabindex: r === S.rate ? '0' : '-1', dataset: { rate: String(r) },
            class: r === S.rate ? 'is-on' : null,
            onclick: () => setRate(r),
            onkeydown: e => {
              const i = SPEEDS.indexOf(r);
              let j = -1;
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(SPEEDS.length - 1, i + 1);
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(0, i - 1);
              if (j < 0) return;
              e.preventDefault(); e.stopPropagation();
              setRate(SPEEDS[j]);
              P.pop.querySelector('.vid-speed[aria-checked="true"]')?.focus({ preventScroll: true });
            },
          }, r === 1 ? 'Normal' : `${r}×`)));
        const loopSw = h('button.switch', {
          type: 'button', role: 'switch', 'aria-checked': String(S.loop), 'aria-label': 'Loop', class: S.loop ? 'is-on' : null,
          onclick: () => setLoop(!S.loop),
        });
        P.pop.append(
          h('div.vid-pop__head', h('b', { text: 'Speed' }), h('small', { text: '< > keys' }), popClose()),
          speeds,
          h('div.vid-pop__sep'),
          h('div.vid-pop__line', h('span', h('b', { text: 'Loop' }), h('small', { text: 'Start again at the end' })), loopSw));
        return;
      }
      if (S.pop === 'info') {
        P.pop.setAttribute('role', 'dialog');
        P.pop.setAttribute('aria-label', 'Video info');
        const n = S.node;
        if (!n) return;
        const d = dur();
        const bytes = n.size || 0;
        const rows = [];
        const add = (k, v, cls) => { if (v !== null && v !== undefined && v !== '') rows.push(h('dt', { text: k }), h(`dd${cls || ''}`, { text: v })); };
        const where = media.isMedia(n) ? (String(n.content).startsWith(media.ASSET) ? 'Comes with StaticOS' : 'Kept in this browser (IndexedDB)') : 'No data stored';
        add('Name', n.name);
        add('Folder', tilde(vfs.parentPath(S.path)));
        add('Size', media.isMedia(n) ? `${fmt.fmtBytes(bytes)} (${bytes.toLocaleString()} bytes)` : 'No video data');
        const typeDd = h('dd', { text: '…' });
        rows.push(h('dt', { text: 'Type' }), typeDd);
        const byName = () => (EXT_MIME[extOf(n.name)] ? `${EXT_MIME[extOf(n.name)]} (from the file name)` : 'Not recorded');
        media.mimeOf(n).then(m => { typeDd.textContent = m || byName(); }, () => { typeDd.textContent = byName(); });
        if (video.videoWidth) add('Resolution', `${video.videoWidth} × ${video.videoHeight}`);
        else if (!S.err) add('Resolution', video.readyState < 1 ? 'Loading…' : 'No picture track');
        if (d) add('Length', `${d.toFixed(2)} s${d >= 60 ? ` (${fmtTime(d, d)})` : ''}`);
        if (d && bytes && media.isMedia(n)) add('Average bitrate', `${(bytes * 8 / d / 1e6).toFixed(2)} Mbit/s`, '.vid-info__calc');
        const frames = h('dd.mono');
        if (typeof video.getVideoPlaybackQuality === 'function' && !S.err) rows.push(h('dt', { text: 'Frames' }), frames);
        add('Stored', where);
        if (!n.seed) add('Modified', new Date(n.mtime).toLocaleString());
        infoLive = { frames };
        P.pop.append(
          h('div.vid-pop__head', h('b', { text: 'Video info' }), h('small', { text: 'Read from the file' }), popClose()),
          h('dl.vid-info', rows),
          d && bytes && media.isMedia(n) ? h('p.vid-info__note', { text: 'Average bitrate is the file size divided by its length, so it includes the sound and the container.' }) : null,
          h('div.vid-pop__sep.vid-keys-sep'),
          h('div.vid-keys', { 'aria-label': 'Keyboard shortcuts' },
            [['Space / K', 'Play or pause'], ['← →', '5 s back / forward'], ['J  L', '10 s back / forward'], ['↑ ↓', 'Volume'], ['M', 'Mute'],
              ['< >', 'Speed'], ['F', 'Fullscreen'], ['P', 'Picture in picture'], ['0–9', 'Jump to 0–90 %'], ['Shift N / P', 'Next / previous video']]
              .map(([k, v]) => h('div', h('kbd.mono', { text: k }), h('span', { text: v })))));
        paintInfoLive();
      }
    }
    /* speed / loop changed while the settings popover is open: update it in
       place so keyboard focus stays on the control that was used */
    function syncPop() {
      if (S.pop !== 'settings') return;
      for (const b of P.pop.querySelectorAll('.vid-speed')) {
        const on = b.dataset.rate === String(S.rate);
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      const sw = P.pop.querySelector('.switch');
      if (sw) { sw.classList.toggle('is-on', S.loop); sw.setAttribute('aria-checked', String(S.loop)); }
    }

    function paintInfoLive() {
      if (!infoLive || typeof video.getVideoPlaybackQuality !== 'function') return;
      const q = video.getVideoPlaybackQuality();
      infoLive.frames.textContent = `${q.totalVideoFrames} shown · ${q.droppedVideoFrames} dropped`;
    }

    /* ---- phone layout: details under the video ---- */
    const isPhone = () => document.body.classList.contains('is-mobile');
    let belowMeta = null;
    function paintBelowMeta() {
      if (!belowMeta || !S.node) return;
      const n = S.node;
      const d = dur();
      const info = posters.get(keyOf(n));
      const w = video.videoWidth || info?.w, hh = video.videoHeight || info?.h;
      belowMeta.textContent = [
        d ? fmtLen(d) : info?.dur ? fmtLen(info.dur) : '',
        w && hh ? `${w}×${hh}` : '',
        media.isMedia(n) ? fmt.fmtBytes(n.size) : 'No video data',
        tilde(vfs.parentPath(S.path)),
      ].filter(Boolean).join(' · ');
    }
    function paintBelow() {
      const el = P.below;
      clear(el);
      belowMeta = null;
      if (!isPhone() || !S.node || S.view !== 'player') return;
      const n = S.node;
      const path = S.path;
      belowMeta = h('div.vid-below__meta');
      const act = (ic, label, fn, cls = '') => h(`button.vid-act${cls}`, { type: 'button', onclick: fn }, icon(ic), h('span', { text: label }));
      const others = flatList().filter(v => v.path !== path);
      el.append(
        h('h2.vid-below__title', { text: n.name }),
        belowMeta,
        h('div.vid-below__acts',
          act('download', 'Download', () => download(path)),
          act('edit-3', 'Rename', () => rename(path)),
          act('folder-open', 'Show in Files', () => api.openApp('files', { path: vfs.parentPath(path) })),
          act('trash', 'Trash', () => trash(path), '.vid-act--danger')),
        others.length ? h('div.vid-below__label', { text: 'More videos' }) : null,
        others.length ? h('div.vid-below__list', others.map(row)) : null);
      paintBelowMeta();
    }
    function row(item) {
      const { node, path } = item;
      const thumb = h('span.vid-row__thumb');
      const meta = h('small.vid-row__meta');
      const btn = h('button.vid-row', { type: 'button', onclick: () => openPath(path), 'aria-label': `Play ${node.name}` },
        thumb, h('span.vid-row__text', h('b.vid-row__name', { text: node.name }), meta));
      const fill = info => {
        clear(thumb);
        const size = media.isMedia(node) ? fmt.fmtBytes(node.size) : 'No video data';
        if (info && info.src) {
          thumb.append(h('img', { src: info.src, alt: '', draggable: 'false' }), h('span.vid-row__dur.mono', { text: fmtLen(info.dur) }));
          meta.textContent = `${size} · ${info.w}×${info.h}`;
        } else {
          thumb.append(info ? icon('alert') : h('i.vid-spin'));
          meta.textContent = info ? `${size} · can’t be played here` : size;
        }
      };
      const known = posters.get(keyOf(node));
      fill(known || (media.isMedia(node) ? null : { error: 'nodata' }));
      if (!known && media.isMedia(node)) posterFor(node).then(info => { if (info && btn.isConnected) fill(info); });
      return btn;
    }
    let phoneWas = isPhone();
    let resizeT = 0;
    listen(window, 'resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => { if (isPhone() !== phoneWas) { phoneWas = isPhone(); paintBelow(); } }, 150);
    });

    /* ---- keyboard ---- */
    const isFront = () => win.el.classList.contains('is-active');
    const onKey = e => {
      if (S.view !== 'player' || S.dead || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!isFront() && !isFs()) return;
      const t = e.target;
      const inside = t === document.body || t === document.documentElement || win.el.contains(t);
      if (!inside) return;
      if (closeDialog || trimmer) return;
      const tag = t && t.tagName;
      const typing = tag === 'TEXTAREA' || t.isContentEditable || (tag === 'INPUT' && !['range', 'button', 'checkbox'].includes(t.type));
      if (typing) return;
      const onRange = tag === 'INPUT' && t.type === 'range';
      const onButton = tag === 'BUTTON';
      const inPop = P.pop.contains(t);
      const k = e.key;
      const lower = k.length === 1 ? k.toLowerCase() : k;
      let did = true;
      if (k === 'Escape') {
        if (S.pop) closePop(true);
        else if (isFs()) document.exitFullscreen?.().catch(() => {});
        else showLibrary();
      } else if (k === ' ' || k === 'Spacebar') {
        if (onButton) { did = false; }              /* a focused button presses itself */
        else { toggle(); flash(video.paused ? 'Paused' : 'Playing', video.paused ? 'pause' : 'play'); }
      } else if (lower === 'k') { toggle(); flash(video.paused ? 'Paused' : 'Playing', video.paused ? 'pause' : 'play'); }
      else if (k === 'ArrowLeft' && !onRange && !inPop) seekBy(-5);
      else if (k === 'ArrowRight' && !onRange && !inPop) seekBy(5);
      else if (lower === 'j') seekBy(-10);
      else if (lower === 'l') seekBy(10);
      else if (k === 'ArrowUp' && !onRange && !inPop) volBy(5);
      else if (k === 'ArrowDown' && !onRange && !inPop) volBy(-5);
      else if (lower === 'm') toggleMute();
      else if (lower === 'f') toggleFs();
      else if (lower === 'i') togglePop('info', P.info);
      else if (k === 'N' && e.shiftKey) step(1);
      else if (k === 'P' && e.shiftKey) step(-1);
      else if (lower === 'p') togglePip();
      else if (k === '>' || (k === '.' && e.shiftKey)) stepRate(1);
      else if (k === '<' || (k === ',' && e.shiftKey)) stepRate(-1);
      else if (k === 'Home' && !onRange) { seekTo(0); flash('Start', 'rotate-ccw'); }
      else if (k === 'End' && !onRange) { seekTo(dur()); flash('End'); }
      else if (/^[0-9]$/.test(k) && !onRange) { const d = dur(); if (d) { seekTo(d * Number(k) / 10); flash(`${k}0 %`); } }
      else did = false;
      if (did) { e.preventDefault(); wake(); }
    };
    listen(window, 'keydown', onKey);

    /* ================================================================
       views
       ================================================================ */
    function showLibrary() {
      closeDialog?.();
      closePop();
      if (isFs()) document.exitFullscreen?.().catch(() => {});
      /* keep a picture-in-picture video playing while you browse */
      if (!inPip()) releaseVideo();
      S.view = 'library';
      S.err = null;
      S.path = inPip() ? S.path : null;
      S.node = inPip() ? S.node : null;
      stage.classList.remove('is-error');
      P.msg.hidden = true;
      P.el.hidden = true;
      libEl.hidden = false;
      win.setTitle('Videos');
      win.setSubtitle('');
      paintTools();
      paintLibraryBody();
    }

    /* keep up with the file system: renames, moves, deletes, imports */
    let fsTimer = 0;
    offs.push(api.bus.on('fs:change', () => {
      clearTimeout(fsTimer);
      fsTimer = setTimeout(onFs, 90);
    }));
    function onFs() {
      if (S.dead) return;
      if (S.node) {
        let found = null;
        vfs.walk('/', (n, p) => { if (n === S.node) found = p; });
        if (!found || found.startsWith(TRASH + '/')) {
          const name = S.node.name;
          if (S.view === 'player') {
            releaseVideo();
            S.node = null;
            showLibrary();
            api.notify({ app: 'Videos', icon: 'trash', title: 'Stopped playing', message: `“${name}” was moved to the Trash or deleted.` });
          } else { if (inPip()) document.exitPictureInPicture().catch(() => {}); releaseVideo(); S.node = null; S.path = null; }
        } else if (found !== S.path) {
          S.path = found;
          if (S.view === 'player') { win.setTitle(S.node.name); win.setSubtitle(tilde(vfs.parentPath(found))); P.paintTitle(); }
        }
      }
      if (S.view === 'library') paintLibraryBody();
      else paintBelow();
    }

    function openFromOpts(o) {
      const p = o && (o.path || (o.file && o.file.path));
      if (!p) return false;
      if (o.trim) { if (S.view === 'library') showLibrary(); openTrim(vfs.norm(p)); }
      else openPath(p);
      return true;
    }

    /* ---- boot ---- */
    paintTools();
    if (!openFromOpts(opts)) showLibrary();
    win.onReopen(o => { if (!openFromOpts(o) && S.view === 'library') paintLibraryBody(); });

    /* ---- teardown: the video stops, the camera-light rule for screens ---- */
    return () => {
      if (S.dead) return;
      S.dead = true;
      closeDialog?.();
      trimmer?.close();
      if (inPip()) document.exitPictureInPicture().catch(() => {});
      if (isFs()) document.exitFullscreen?.().catch(() => {});
      releaseVideo();
      for (const abort of live.values()) abort();
      live.clear();
      waiting.length = 0;
      clearTimeout(T.idle); clearTimeout(T.flash); clearTimeout(fsTimer); clearTimeout(resizeT);
      cancelAnimationFrame(T.raf);
      for (const [u, timer] of T.dl) { clearTimeout(timer); URL.revokeObjectURL(u); }
      T.dl.clear();
      offs.splice(0).forEach(off => { try { off(); } catch (e) {} });
    };
  },
});
