/* ============================================================
   vfs.js — in-memory virtual filesystem
   Shape:  { name, type:'dir'|'file', kind, mtime, size, children[], content }
   Paths are POSIX-ish: '/home/static/Documents/notes.md'
   Mutations emit bus 'fs:change' with the affected directory.
   ============================================================ */
import { bus } from './bus.js';
import { key, local } from './profiles.js';

const now = Date.now();
const ago = (mins) => new Date(now - mins * 60000).toISOString();

const KINDS = {
  txt: 'text', md: 'text', log: 'text', conf: 'config', toml: 'config', json: 'config',
  yml: 'config', yaml: 'config', ini: 'config', sh: 'code', js: 'code', ts: 'code',
  css: 'code', html: 'code', py: 'code', rs: 'code', c: 'code', h: 'code',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', svg: 'image', gif: 'image',
  mp3: 'audio', flac: 'audio', wav: 'audio', ogg: 'audio',
  mp4: 'video', mkv: 'video', mov: 'video', webm: 'video',
  zip: 'archive', tar: 'archive', gz: 'archive', apk: 'archive', pkg: 'archive',
  pdf: 'doc', aether: 'theme', aethergame: 'game', aetherclip: 'clip', mindmap: 'mindmap', geo: 'geometry',
  csv: 'sheet', tsv: 'sheet', sheet: 'sheet',
};

const ICONS = {
  text: 'file-text', config: 'sliders', code: 'file-code', image: 'image',
  audio: 'music', video: 'film', archive: 'package', doc: 'file-text',
  theme: 'palette', game: 'gamepad', sheet: 'table', mindmap: 'network', geometry: 'compass', bin: 'file',
};

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}
export const kindOf = name => KINDS[extOf(name)] || 'bin';

/* Seeded files are furniture: they live in their folders for the Files app
   to show, but they carry `seed` so recents (launcher, widgets, Spotlight)
   only ever list files the person actually made or edited. */
const f = (name, size, mins, content = '') => ({
  name, type: 'file', kind: kindOf(name), size, mtime: ago(mins), content, seed: true,
});
const d = (name, mins, children = []) => ({
  name, type: 'dir', kind: 'dir', mtime: ago(mins), children,
});

/* ------------------------------------------------------------------ */
/*  seed tree                                                         */
/* ------------------------------------------------------------------ */
const NEBULA = `# Project Nebula

The StaticOS shell.

## Goals
- [x] Compositor handshake (Wayland)
- [x] Glass surfaces with backdrop blur
- [x] Widget rail + dock magnification
- [ ] Per-app accent tinting
- [ ] Wire the shell up to real system telemetry

## Notes
The window manager keeps a flat z-stack; focus is the only
thing that reorders it. Snapping happens on pointer-up so a
drag can always be cancelled with Esc.
`;

const SHELLCONF = `# /etc/aether/shell.conf
[shell]
theme        = aether-dark
accent       = "#ff456d"
density      = normal
animations   = true
blur_radius  = 26

[dock]
position   = bottom
magnify    = true
autohide   = false

[widgets]
enabled = ["clock","weather","monitor","media","gamemode","community"]
`;

const GREET = `#!/usr/bin/env staticsh
# first-run greeting
echo "welcome to StaticOS — taste the spaghetti code"
aether theme set aether-dark
aether dock reset
`;

const OVERVIEW = `StaticOS — Overview
=======================

StaticOS is a desktop shell built around three ideas:

1. Everything is a surface. Windows, widgets, the dock and the
   launcher are all glass panels over one wallpaper.
2. Everything is addressable. Apps, files and settings are all
   reachable from one search field (press ${'⌘'}K).
3. Everything is themed from one place. One accent token drives
   the whole system.

Shipped apps: Files, Browser, Store, Settings, Music, Photos,
Videos, Code, Notes, Calculator, Calendar, Weather, Clock, Lens,
System Monitor, Camera. The terminal is part of the Linux drive's
desktop — boot Linux and it is on the wallpaper.
`;

const root = d('/', 600, [
  d('home', 12, [
    d('static', 6, [
      d('Desktop', 40, [
        /* .aethergame files are launchers: the desktop draws each with the
           host's own title card and opens it straight into the play stage. */
        f('Subway Surfers.aethergame', 264, 30, `{
  "id": "subway-surfers",
  "title": "Subway Surfers",
  "art": "https://www.madkidgames.com/games/subway-surfers/thumb_1.jpg",
  "open": "https://www.madkidgames.com/game/subway-surfers",
  "studio": "madkidgames.com",
  "url": "static://games/subway-surfers"
}`),
        f('Geometry Dash.aethergame', 259, 30, `{
  "id": "geometry-dash",
  "title": "Geometry Dash",
  "art": "https://www.madkidgames.com/games/geometry-dash/thumb_1.jpg",
  "open": "https://www.madkidgames.com/game/geometry-dash",
  "studio": "madkidgames.com",
  "url": "static://games/geometry-dash"
}`),
        f('Smash Karts.aethergame', 137, 30, `{
  "id": "smash-karts",
  "title": "Smash Karts",
  "art": null,
  "open": null,
  "studio": "",
  "url": "static://games/smash-karts"
}`),
        f('Poly Track.aethergame', 134, 30, `{
  "id": "poly-track",
  "title": "Poly Track",
  "art": null,
  "open": null,
  "studio": "",
  "url": "static://games/poly-track"
}`),
      ]),
      d('Documents', 55, [
        f('Welcome.md', 2048, 40, '# Welcome to StaticOS\n\nDouble-click anything. Right-click the desktop.\nPress ⌘K to search the whole system.\n'),
        f('shortcuts.txt', 640, 120, 'Cmd+K  search\nCmd+W  close window\nCmd+M  minimize\nCmd+Tab  cycle windows\nCmd+`  overview\n'),
        f('Project Nebula.md', 4096, 2, NEBULA),
        f('StaticOS Overview.txt', 3120, 1680, OVERVIEW),
        f('budget.csv', 8800, 300, 'item,cost\ncompositor,0\nglass,0\nvibes,priceless\n'),
        f('changelog.md', 5400, 480, '## 3.0.1\n- dock magnification\n- aether accent as default\n\n## 3.0.0\n- new shell\n'),
        d('Invoices', 900, [f('2026-08.pdf', 184320, 900), f('2026-09.pdf', 176400, 210)]),
      ]),
      /* Media folders hold real files only. The pictures and clips below
         ship with the site (assets/wallpapers) and open for real; anything
         Camera, a screenshot or Import adds is kept in IndexedDB
         (core/media.js). Sizes are the true byte counts. */
      d('Downloads', 8, []),
      d('Music', 200, []),
      d('Pictures', 90, [
        f('Canopy.jpg', 56224, 90, 'staticos-asset:assets/wallpapers/canopy.jpg'),
        f('Earthrise.jpg', 209977, 300, 'staticos-asset:assets/wallpapers/earthrise.jpg'),
        f('Lamplight.jpg', 68231, 720, 'staticos-asset:assets/wallpapers/lamplight.jpg'),
        f('Sakura Moon.jpg', 58884, 1500, 'staticos-asset:assets/wallpapers/sakura-moon.jpg'),
        d('Screenshots', 30, []),
        d('Camera', 30, []),
      ]),
      d('Videos', 700, [
        f('StaticOS Bubbles.mp4', 28719459, 5, 'staticos-asset:staticos-bubbles.mp4'),
        f('StaticOS Tour.mp4', 12452897, 6, 'staticos-asset:staticos-tour.mp4'),
        f('StaticOS Halloween.mp4', 29366426, 4, 'staticos-asset:staticos-halloween.mp4'),
        f('Canopy.mp4', 667821, 700, 'staticos-asset:assets/wallpapers/canopy.mp4'),
        f('Earthrise.mp4', 862431, 800, 'staticos-asset:assets/wallpapers/earthrise.mp4'),
        f('Lamplight.mp4', 325698, 900, 'staticos-asset:assets/wallpapers/lamplight.mp4'),
        f('Sakura Moon.mp4', 1121874, 1000, 'staticos-asset:assets/wallpapers/sakura-moon.mp4'),
      ]),
      d('Projects', 3, [
        d('nebula-shell', 3, [
          f('main.js', 12400, 3, "import { boot } from './boot.js'\n\nboot({ theme: 'aether-dark' })\n"),
          f('shell.css', 9800, 14),
          f('README.md', 1400, 60, '# nebula-shell\n\nThe Static shell for StaticOS.\n'),
        ]),
        d('aether-term', 180, [f('term.rs', 22400, 180), f('Cargo.toml', 620, 180)]),
      ]),
      d('Themes', 1500, [
        f('aether-dark.aether', 40960, 1500),
        f('aether-light.aether', 39936, 1500),
        f('midnight-violet.aether', 38912, 4000),
      ]),
      d('Wallpapers', 1500, [
        f('aurora-ridge.png', 8388608, 1500),
        f('crimson-lake.png', 7864320, 1500),
        f('planetfall.png', 9437184, 4000),
      ]),
      d('Misc', 2600, [
        f('Terminal Config.conf', 2200, 180, SHELLCONF),
        f('greet.sh', 480, 2600, GREET),
        f('scratch.txt', 220, 2600, 'todo: ship it\n'),
      ]),
      d('.config', 500, [d('static', 500, [f('shell.conf', 2200, 500, SHELLCONF)])]),
      d('Trash', 4000, []),
    ]),
  ]),
  d('etc', 4000, [
    d('static', 500, [f('shell.conf', 2200, 500, SHELLCONF), f('apps.d', 4000, 4000)]),
    f('hostname', 12, 4000, 'staticos\n'),
    f('os-release', 320, 4000, 'NAME="StaticOS"\nVERSION="3.0 (aether)"\nID=aether\n'),
  ]),
  d('usr', 6000, [d('bin', 6000, [
    f('staticsh', 1048576, 6000), f('aether-term', 2097152, 6000),
    f('neofetch', 65536, 6000), f('aether', 524288, 6000),
  ])]),
  d('var', 3000, [d('log', 20, [
    f('aether.log', 148000, 20, '[compositor] frame budget 6.9ms\n[shell] widgets mounted in 34ms\n[dock] magnify=on\n'),
    f('boot.log', 9800, 200, '[ok] mounted /home\n[ok] started aether-compositor\n[ok] started aether-shell\n'),
  ])]),
]);

/* ------------------------------------------------------------------ */
/*  api                                                              */
/* ------------------------------------------------------------------ */
export const HOME = '/home/static';

export function norm(p) {
  if (!p) return '/';
  const abs = p.startsWith('/') ? p : `${HOME}/${p}`;
  const out = [];
  for (const part of abs.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function node(p) {
  const path = norm(p);
  if (path === '/') return root;
  let cur = root;
  for (const part of path.slice(1).split('/')) {
    if (cur.type !== 'dir') return null;
    cur = cur.children.find(c => c.name === part);
    if (!cur) return null;
  }
  return cur;
}

export const parentPath = p => {
  const n = norm(p);
  return n === '/' ? '/' : (n.slice(0, n.lastIndexOf('/')) || '/');
};
export const baseName = p => norm(p).split('/').pop() || '/';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function ls(p, { hidden = false, sort = 'name' } = {}) {
  const n = node(p);
  if (!n || n.type !== 'dir') return [];
  let kids = n.children.filter(c => hidden || !c.name.startsWith('.'));
  kids = [...kids].sort((a, b) => {
    if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
    if (sort === 'size') return (b.size || 0) - (a.size || 0);
    if (sort === 'mtime') return new Date(b.mtime) - new Date(a.mtime);
    if (sort === 'kind') return collator.compare(a.kind, b.kind) || collator.compare(a.name, b.name);
    return collator.compare(a.name, b.name);
  });
  return kids;
}

export function read(p) { const n = node(p); return n && n.type === 'file' ? (n.content || '') : null; }

/* A file's size is the bytes it really takes, not the number of JavaScript
   characters. String.length counts UTF-16 units, so "héllo — café ☕" came
   out as 14 when the file is 20 bytes — every accented or emoji-bearing
   file was reported smaller than it is, and smaller than the same file
   downloads as. */
const byteLen = (text) => {
  const s = String(text ?? '');
  try { return new TextEncoder().encode(s).length; } catch (e) { return s.length; }
};

export function write(p, content) {
  const path = norm(p);
  let n = node(path);
  if (!n) { n = touch(path, content); }
  else { n.content = content; n.size = byteLen(content); n.mtime = new Date().toISOString(); delete n.seed; }
  bus.emit('fs:change', parentPath(path), path);
  return n;
}

export function mkdir(p) {
  const path = norm(p);
  if (node(path)) return node(path);
  const par = node(parentPath(path));
  if (!par || par.type !== 'dir') return null;
  const n = d(baseName(path), 0);
  n.mtime = new Date().toISOString();
  par.children.push(n);
  bus.emit('fs:change', parentPath(path), path);
  return n;
}

export function touch(p, content = '') {
  const path = norm(p);
  const exist = node(path);
  if (exist) return exist;
  const par = node(parentPath(path));
  if (!par || par.type !== 'dir') return null;
  const n = { name: baseName(path), type: 'file', kind: kindOf(baseName(path)),
              size: byteLen(content), mtime: new Date().toISOString(), content };
  par.children.push(n);
  bus.emit('fs:change', parentPath(path), path);
  return n;
}

/** Delete to Trash — or for good with { permanent: true } (used for files
    the OS manages itself, like Game Projects shortcuts). */
export function rm(p, { permanent = false } = {}) {
  const path = norm(p);
  const par = node(parentPath(path));
  if (!par || par.type !== 'dir') return false;
  const i = par.children.findIndex(c => c.name === baseName(path));
  if (i < 0) return false;
  const [gone] = par.children.splice(i, 1);
  const trash = node(`${HOME}/Trash`);
  if (!permanent && trash && !path.startsWith(`${HOME}/Trash`)) {
    let name = gone.name, k = 1;
    while (trash.children.some(c => c.name === name)) name = `${gone.name} (${++k})`;
    gone.name = name;
    gone.trashedAt = Date.now();      /* Settings > Storage can empty the Trash after 30 days (core/trashexpiry.js) */
    trash.children.push(gone);
  }
  bus.emit('fs:change', parentPath(path), path);
  return true;
}

export function rename(p, next) {
  const n = node(p);
  if (!n) return false;
  const par = node(parentPath(p));
  if (par.children.some(c => c.name === next)) return false;
  n.name = next;
  if (n.type === 'file') n.kind = kindOf(next);
  n.mtime = new Date().toISOString();
  bus.emit('fs:change', parentPath(p), norm(`${parentPath(p)}/${next}`));
  return true;
}

export function mv(from, to) {
  const n = node(from);
  const dest = node(to);
  if (!n || !dest || dest.type !== 'dir') return false;
  const par = node(parentPath(from));
  par.children.splice(par.children.findIndex(c => c === n), 1);
  dest.children.push(n);
  /* the Trash date belongs to a stay in the Trash: moving out ends it, moving in starts one */
  const toTrash = (p => p === `${HOME}/Trash` || p.startsWith(`${HOME}/Trash/`))(norm(to));
  if (toTrash && !n.trashedAt) n.trashedAt = Date.now();
  else if (!toTrash) delete n.trashedAt;
  bus.emit('fs:change', parentPath(from));
  bus.emit('fs:change', norm(to));
  return true;
}

export function size(n) {
  if (!n) return 0;
  return n.type === 'file' ? (n.size || 0) : n.children.reduce((a, c) => a + size(c), 0);
}

export function iconFor(n) {
  if (!n) return 'file';
  if (n.type === 'dir') {
    const special = {
      Desktop: 'monitor', Documents: 'file-text', Downloads: 'download', Music: 'music',
      Pictures: 'image', Videos: 'film', Projects: 'folder-git', Themes: 'palette',
      Wallpapers: 'image', Trash: 'trash', Screenshots: 'camera', Invoices: 'file-text',
      Games: 'gamepad', 'Game Projects': 'sparkles', Replays: 'film',
    };
    return special[n.name] || 'folder';
  }
  if (n.kind === 'game') return 'gamepad';
  if (n.kind === 'clip') return 'film';
  return ICONS[n.kind] || 'file';
}

/** Flat walk — used by search, recents and the terminal's `find`. */
export function walk(start = HOME, fn, depth = 12) {
  const n = node(start);
  if (!n) return;
  const stack = [[n, norm(start), 0]];
  while (stack.length) {
    const [cur, path, lvl] = stack.pop();
    fn(cur, path);
    if (cur.type === 'dir' && lvl < depth) {
      for (const c of cur.children) stack.push([c, `${path === '/' ? '' : path}/${c.name}`, lvl + 1]);
    }
  }
}

/** Find by name. With { tags: true } an item also matches when one of its
    file tags (core/filetags.js) contains the term; name matches come first. */
export function search(term, { limit = 40, start = '/', tags = false } = {}) {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const hits = [];
  const tagged = n => tags && Array.isArray(n.tags) && n.tags.some(g => String(g).toLowerCase().includes(t));
  walk(start, (n, path) => {
    if (hits.length >= limit * 3) return;
    if (n.name.toLowerCase().includes(t) || tagged(n)) hits.push({ node: n, path });
  });
  const pos = n => { const i = n.name.toLowerCase().indexOf(t); return i < 0 ? 1e6 : i; };
  return hits
    .sort((a, b) => pos(a.node) - pos(b.node)
      || a.node.name.length - b.node.name.length)
    .slice(0, limit);
}

export function recent(limit = 8, start = HOME) {
  const hits = [];
  walk(start, (n, path) => { if (n.type === 'file' && !n.seed && !n.name.startsWith('.')) hits.push({ node: n, path }); });
  return hits.sort((a, b) => new Date(b.node.mtime) - new Date(a.node.mtime)).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/*  persistence                                                        */
/* ------------------------------------------------------------------ */
/* The tree used to be re-seeded on every load, so a note, a desktop
   shortcut or a deleted file never survived a reload. Now everything
   under HOME is snapshotted to localStorage after each change (debounced)
   and restored here, synchronously, before anything renders. Seeded
   files that are still untouched at their original path are stored as a
   reference, not a copy — the content comes from the seed on restore. */
const PERSIST_KEY = key('staticos.vfs.v1');   /* this person's (core/profiles.js) */

/* Real places for game things (section 31). They start empty; what lands
   in them is real — shortcuts you pin, your creations and clips
   (js/core/gamefiles.js keeps Game Projects and Replays in step). */
export const GAME_DIRS = ['Games', 'Game Projects', 'Replays'];
{
  const home = node(HOME);
  for (const name of GAME_DIRS) if (home && !home.children.some(c => c.name === name)) home.children.push(d(name, 0));
}
const PERSIST_MAX = 2_500_000;          /* characters; localStorage is ~5 MB */

const seedAt = new Map();               /* original path -> seeded content */
walk(HOME, (n, path) => { if (n.type === 'file' && n.seed) seedAt.set(path, n.content || ''); });

/* Snapshot format version. 2 = the media folders hold real files (4.0);
   3 = the StaticOS videos in ~/Videos; 4 = the Halloween video. A
   snapshot older than a real file gets that file added once on restore;
   a newer one already had it, so a file the user deleted stays deleted. */
const SNAP_V = 4;
const ADDED_IN = {
  'staticos-asset:staticos-bubbles.mp4': 3, 'staticos-asset:staticos-tour.mp4': 3,
  'staticos-asset:staticos-halloween.mp4': 4,
};
const realSeeds = [];
walk(HOME, (n, path) => {
  if (n.type === 'file' && n.seed && String(n.content || '').startsWith('staticos-asset:')) realSeeds.push({ path, n: { ...n }, v: ADDED_IN[n.content] || 2 });
});

/* file tags (g) and the date an item went into the Trash (ta) ride along in the snapshot */
const extras = n => ({
  ...(Array.isArray(n.tags) && n.tags.length ? { g: n.tags } : null),
  ...(n.trashedAt ? { ta: n.trashedAt } : null),
});
const unextras = (o, n) => {
  if (Array.isArray(o.g) && o.g.length) n.tags = o.g.filter(t => typeof t === 'string');
  if (Number.isFinite(o.ta)) n.trashedAt = o.ta;
  return n;
};

function snap(n, path) {
  if (n.type === 'dir') {
    return { n: n.name, t: 'd', m: n.mtime, c: (n.children || []).map(k => snap(k, `${path}/${k.name}`)), ...extras(n) };
  }
  if (n.seed && seedAt.has(path) && seedAt.get(path) === (n.content || '')) {
    return { n: n.name, t: 's', m: n.mtime, z: n.size, ...extras(n) };
  }
  return { n: n.name, t: 'f', m: n.mtime, z: n.size, k: n.kind, x: n.content || '', ...extras(n) };
}

function unsnap(o, path) {
  if (!o || typeof o.n !== 'string') return null;
  if (o.t === 'd') {
    return unextras(o, { name: o.n, type: 'dir', kind: 'dir', mtime: o.m, children: (o.c || []).map(k => unsnap(k, `${path}/${k.n}`)).filter(Boolean) });
  }
  if (o.t === 's') {
    if (!seedAt.has(path)) return null;          /* the seed file is gone from this build */
    return unextras(o, { name: o.n, type: 'file', kind: kindOf(o.n), size: o.z, mtime: o.m, content: seedAt.get(path), seed: true });
  }
  /* a stored 'bin' is "no kind known yet" — a later build may know it (.csv became 'sheet') */
  return unextras(o, { name: o.n, type: 'file', kind: o.k && o.k !== 'bin' ? o.k : kindOf(o.n), size: o.z ?? byteLen(o.x || ''), mtime: o.m, content: o.x || '' });
}

(function restore() {
  try {
    const raw = local.getItem(PERSIST_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const home = node(HOME);
    const fresh = saved && saved.t === 'd' ? unsnap(saved, HOME) : null;
    if (home && fresh) home.children = fresh.children;
    if (home && fresh && (saved.v || 1) < SNAP_V) {
      for (const { path, n, v } of realSeeds) {
        if ((saved.v || 1) >= v) continue;
        const dir = node(parentPath(path));
        if (dir && dir.type === 'dir' && !dir.children.some(c => c.name === n.name)) dir.children.push({ ...n });
      }
    }
    /* folders this build added since the snapshot was taken */
    for (const name of GAME_DIRS) if (home && !home.children.some(c => c.name === name)) home.children.push(d(name, 0));
  } catch (err) { console.warn('[vfs] could not restore saved files', err); }
})();

let saveTimer = 0;
let wiping = false;
function save() {
  saveTimer = 0;
  if (wiping) return;
  try {
    const out = JSON.stringify({ ...snap(node(HOME), HOME), v: SNAP_V });
    if (out.length > PERSIST_MAX) { console.warn('[vfs] files too large to save in this browser'); return; }
    local.setItem(PERSIST_KEY, out);
  } catch (err) { console.warn('[vfs] could not save files', err); }
}
bus.on('fs:change', () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); });
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); save(); } });

/** Stop (or, with false, resume) saving files: a data restore has just written
    another copy into localStorage and the page is about to reload. */
export function holdFiles(on = true) {
  wiping = !!on;
  if (on) clearTimeout(saveTimer);
}

/** Put the file system back to the seeded state (Settings › Privacy). */
export function resetFiles() {
  wiping = true;
  clearTimeout(saveTimer);
  try { local.removeItem(PERSIST_KEY); } catch (err) {}
}

/** Put back a file that ships with StaticOS (one of the real media files
    seeded above) at its original path, if it was deleted. The start-up
    video card uses it so "Watch" works after the video was thrown away. */
export function restoreSeed(p) {
  const path = norm(p);
  if (node(path)) return node(path);
  const s = realSeeds.find(r => r.path === path);
  const dir = s && mkdir(parentPath(path));
  if (!dir || dir.type !== 'dir') return null;
  const n = { ...s.n, mtime: new Date().toISOString() };
  dir.children.push(n);
  bus.emit('fs:change', parentPath(path), path);
  return n;
}

export const vfs = {
  root, HOME, node, ls, read, write, mkdir, touch, rm, rename, mv, size,
  iconFor, kindOf, extOf, norm, parentPath, baseName, walk, search, recent, resetFiles, holdFiles, restoreSeed,
};
export default vfs;
