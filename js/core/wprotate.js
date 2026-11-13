/* ============================================================
   wprotate.js — a new wallpaper every so often, by itself.

   Settings › Wallpaper › Rotation. The pictures are real files:
   every picture in a folder (~/Pictures unless you pick another,
   and the folders inside it), or a set of wallpapers you tick in
   the picker. Each one is opened before it is shown — a file that
   has no picture in it, or one this browser can't decode, is
   skipped and named in Settings, never painted as a black screen.

   Preferences (prefs.*):
     wpRotate       false        the switch
     wpRotateFrom   'folder'     'folder' | 'set'
     wpRotateFolder ~/Pictures   a folder in Files
     wpRotateSet    []           wallpaper ids, for 'set'
     wpRotateEvery  '1h'         '15m' | '1h' | '1d' | 'login'
     wpRotateOrder  'shuffle'    'shuffle' | 'order' (by name)

   State (portal.wpRotate, kept across reloads): { src, cur, at,
   bag, skipped }. `cur` is what is up now — a file path, or
   'wp:<id>' — and `at` when it went up, so a reload shows the same
   picture until its time is up. 'login' changes it once each time
   StaticOS starts. Shuffle deals every picture once before any
   comes round again.

   Picking a wallpaper yourself (Settings, a pack, an automation)
   turns rotation off, or the pick would seem to do nothing. In
   spooky season, turning rotation on is picking a wallpaper too:
   the haunted house steps aside (prefs.spookyWallpaper), as it
   does for any pick; while the house is up, rotation waits.

   The desktop (js/shell/desktop.js) asks shown() what to paint and
   cross-fades on bus 'wallpaper:rotate'.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import { vfs } from './vfs.js';
import * as MEDIA from './media.js';
import * as SEASON from './season.js';
import * as WP from '../portal/wallpapers.js';

export const STATE = 'portal.wpRotate';
export const EVERY = { '15m': 15 * 60 * 1000, '1h': 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000, login: 0 };
export const EVERY_LABEL = { '15m': 'Every 15 minutes', '1h': 'Every hour', '1d': 'Every day', login: 'Every time StaticOS starts' };
const SKIP_MAX = 30;

export const defaultFolder = () => `${vfs.HOME}/Pictures`;

export function config() {
  const p = store.get('prefs', {}) || {};
  return {
    on: p.wpRotate === true,
    from: p.wpRotateFrom === 'set' ? 'set' : 'folder',
    folder: typeof p.wpRotateFolder === 'string' && p.wpRotateFolder.trim() ? vfs.norm(p.wpRotateFolder) : defaultFolder(),
    set: Array.isArray(p.wpRotateSet) ? p.wpRotateSet.filter(id => typeof id === 'string') : [],
    every: Object.prototype.hasOwnProperty.call(EVERY, p.wpRotateEvery) ? p.wpRotateEvery : '1h',
    order: p.wpRotateOrder === 'order' ? 'order' : 'shuffle',
  };
}
const srcKey = c => (c.from === 'set' ? `set:${c.set.join(',')}` : `folder:${c.folder}`);
const short = p => String(p || '').replace(vfs.HOME, '~');
export const folderLabel = short;

export function state() {
  const s = store.get(STATE, null);
  return s && typeof s === 'object'
    ? { src: s.src || '', cur: s.cur || null, at: Number(s.at) || 0, bag: Array.isArray(s.bag) ? s.bag : [], skipped: Array.isArray(s.skipped) ? s.skipped : [], none: !!s.none }
    : { src: '', cur: null, at: 0, bag: [], skipped: [], none: false };
}
const save = st => store.set(STATE, { ...st, skipped: st.skipped.slice(-SKIP_MAX) });

/** Every picture under a folder (and the folders in it), in name order. */
export function pictures(folder) {
  const out = [];
  const walk = (dir, depth) => {
    for (const n of vfs.ls(dir)) {
      const p = `${dir === '/' ? '' : dir}/${n.name}`;
      if (n.type === 'dir') { if (depth < 3) walk(p, depth + 1); } else if (MEDIA.kindOf(n.name) === 'image') out.push({ ref: p, name: n.name, node: n });
    }
  };
  if (vfs.node(folder)?.type === 'dir') walk(vfs.norm(folder), 0);
  return out.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true, sensitivity: 'base' }));
}

/** What rotation would choose from: [{ ref, name, node? , wp? }] */
export function candidates(c = config()) {
  if (c.from === 'set') {
    return c.set.map(id => WP.byId(store, id)).filter(w => w && WP.isUnlocked(store, w))
      .map(w => ({ ref: `wp:${w.id}`, name: w.name, wp: w }));
  }
  return pictures(c.folder);
}

/** Folders in Files that have pictures in them, for the picker. */
export function pictureFolders() {
  const out = [];
  vfs.walk(vfs.HOME, (n, p) => {
    if (n.type === 'dir' && !/\/\./.test(p) && vfs.ls(p).some(k => k.type === 'file' && MEDIA.kindOf(k.name) === 'image')) out.push(p);
  });
  return [...new Set(out)].sort();
}

const sigOf = it => (it.node ? `${it.node.size || 0}|${it.node.mtime || ''}|${String(it.node.content || '').slice(0, 80)}` : (it.wp?.url || it.wp?.id || ''));
const stem = n => String(n || '').replace(/\.[^./]+$/, '');

/* ---------- opening a picture ----------------------------------- */
class Skip extends Error { constructor(why) { super(why); this.why = why; } }

let held = null;          /* the last decoded picture, kept so it paints from memory */
function decodes(url, ms = 12000) {
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    let done = false;
    const end = ok => { if (done) return; done = true; clearTimeout(t); resolve(ok ? img : null); };
    const t = setTimeout(() => end(false), ms);
    img.onerror = () => end(false);
    img.src = url;
    (img.decode ? img.decode() : new Promise((r, j) => { img.onload = r; img.onerror = j; }))
      .then(() => end(img.naturalWidth > 0 && img.naturalHeight > 0), () => end(false));
  });
}

/** The wallpaper object for one candidate, after making sure it opens. */
async function open(it) {
  if (it.wp) {
    const w = it.wp;
    if (w.kind === 'image' || w.kind === 'gif') {
      const img = await decodes(w.url);
      if (!img) throw new Skip('didn’t load or isn’t a picture this browser can open');
      held = img;
    }
    return w;
  }
  if (!MEDIA.isMedia(it.node)) throw new Skip('has no picture saved in it');
  const url = await MEDIA.urlOf(it.ref);
  if (!url) throw new Skip('its picture data is missing');
  const img = await decodes(url);
  if (!img) throw new Skip('isn’t a picture this browser can open');
  held = img;
  return asWallpaper(it.ref, url);
}
const asWallpaper = (path, url) => ({
  id: `rot:${path}`, name: stem(vfs.baseName(path)), kind: 'image', url, path, rotation: true,
});

/* ---------- what is up now -------------------------------------- */
let current = null;

/** A file's URL without waiting, when it is one StaticOS ships (no IndexedDB read). */
function quick(ref) {
  if (!ref) return null;
  if (ref.startsWith('wp:')) return WP.byId(store, ref.slice(3));
  const n = vfs.node(ref);
  const c = n && typeof n.content === 'string' ? n.content : '';
  return c.startsWith(MEDIA.ASSET) ? asWallpaper(ref, c.slice(MEDIA.ASSET.length)) : null;
}

/** The wallpaper rotation has up, or null (off, or nothing opened yet). */
export function shown() {
  if (!config().on) return null;
  if (!current) current = quick(state().cur);
  return current;
}

const coveredBySeason = () => typeof document !== 'undefined'
  && document.documentElement.dataset.spooky === 'on' && SEASON.spooky('wallpaper');

/* ---------- moving on ------------------------------------------- */
let busy = null;
/** Put up the next picture. -> the wallpaper shown, or null */
export function next() {
  if (!busy) busy = advance().finally(() => { busy = null; });
  return busy;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function advance() {
  const c = config();
  if (!c.on) return null;
  const list = candidates(c);
  const byRef = new Map(list.map(it => [it.ref, it]));
  let st = state();
  const key = srcKey(c);
  if (st.src !== key) st = { src: key, cur: null, at: 0, bag: [], skipped: [], none: false };
  st.skipped = st.skipped.filter(s => byRef.has(s.ref));
  const known = new Map(st.skipped.map(s => [s.ref, s]));
  const bad = it => known.has(it.ref) && known.get(it.ref).sig === sigOf(it);

  /* the order to try them in */
  let tries;
  let bag = [];
  if (c.order === 'order') {
    const i = list.findIndex(it => it.ref === st.cur);
    tries = i < 0 ? list : [...list.slice(i + 1), ...list.slice(0, i)];
  } else {
    bag = st.bag.filter(r => byRef.has(r) && r !== st.cur);
    if (!bag.length) bag = shuffle(list.map(it => it.ref).filter(r => r !== st.cur));
    tries = bag.map(r => byRef.get(r));
  }
  if (!tries.length && st.cur && byRef.has(st.cur)) tries = [byRef.get(st.cur)];

  for (const it of tries) {
    bag = bag.filter(r => r !== it.ref);
    if (bad(it)) continue;
    try {
      const w = await open(it);
      /* the settings may have changed while it was opening */
      if (!config().on || srcKey(config()) !== key) return null;
      current = w;
      save({ ...st, cur: it.ref, at: Date.now(), bag, none: false });
      bus.emit('wallpaper:rotate');
      return w;
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      known.set(it.ref, { ref: it.ref, name: it.name, why: e.why, sig: sigOf(it) });
      st.skipped = [...known.values()];
    }
  }
  /* nothing else opened: keep what is up if it still does, and wait a whole
     interval before trying again rather than retrying every few seconds */
  const keep = st.cur && byRef.has(st.cur) && !bad(byRef.get(st.cur));
  if (!keep) current = null;
  save({ ...st, cur: keep ? st.cur : null, at: Date.now(), bag: [], none: !keep });
  bus.emit('wallpaper:rotate');
  return null;
}

/* ---------- the clock ------------------------------------------- */
function tick() {
  const c = config();
  if (!c.on || busy || (typeof document !== 'undefined' && document.hidden) || coveredBySeason()) return;
  const st = state();
  /* the picture up now was deleted or changed: move on now */
  if (st.cur && !st.cur.startsWith('wp:') && !vfs.node(st.cur)) { next(); return; }
  if (c.every === 'login') return;
  if (Date.now() - st.at >= EVERY[c.every]) next();
}

/** For Settings: everything worth saying about rotation right now. */
export function status() {
  const c = config();
  const st = state();
  const list = candidates(c);
  const refs = new Set(list.map(it => it.ref));
  return {
    ...c,
    count: list.length,
    cur: st.cur,
    name: current?.name || (st.cur ? stem(st.cur.startsWith('wp:') ? WP.byId(store, st.cur.slice(3))?.name : vfs.baseName(st.cur)) : null),
    due: c.on && c.every !== 'login' && st.at ? new Date(st.at + EVERY[c.every]) : null,
    skipped: st.src === srcKey(c) ? st.skipped.filter(s => refs.has(s.ref)) : [],
    none: st.src === srcKey(c) && st.none,
    busy: !!busy,
  };
}

/* ---------- wiring ---------------------------------------------- */
let inited = false;
/* switching on, or another folder or set, puts a picture up now; the order
   and the interval only change what happens next */
const sigCfg = c => `${c.on}|${srcKey(c)}`;

export function init() {
  if (inited) return;
  inited = true;
  let last = config();
  if (last.on) {
    const st = state();
    if (last.every === 'login' || !st.cur || st.src !== srcKey(last)) next();
    else {
      /* the same picture as before the reload — opened again to be sure,
         and (for one kept in IndexedDB) to get its address back */
      const it = candidates(last).find(x => x.ref === st.cur);
      const was = current;
      (it ? open(it) : Promise.reject(new Skip('gone'))).then(w => {
        if (!config().on) return;
        current = w;
        if (!was || was.url !== w.url) bus.emit('wallpaper:rotate');
      }, () => next());
    }
  }
  store.sub('prefs', () => {
    const c = config();
    if (sigCfg(c) === sigCfg(last)) { last = c; return; }
    const turnedOn = c.on && !last.on;
    const wasSet = last.from === 'set';
    last = c;
    if (!c.on) { current = null; bus.emit('wallpaper:rotate'); return; }
    /* ticking another wallpaper into the set doesn't change the one up now */
    if (!turnedOn && wasSet && c.from === 'set') {
      const st = state();
      if (st.cur && candidates(c).some(it => it.ref === st.cur)) { save({ ...st, src: srcKey(c), bag: [] }); return; }
    }
    /* turning it on in season is picking a wallpaper: the house steps aside */
    if (turnedOn && SEASON.spookyOn() && store.get('prefs.spookyWallpaper') !== false) store.set('prefs.spookyWallpaper', false);
    next();
  });
  /* a wallpaper picked by hand (or by a pack) is what the person wants to see */
  store.sub(WP.ACTIVE_KEY, () => { if (config().on) store.set('prefs.wpRotate', false); });
  bus.on('tick:5s', tick);
}

export default { STATE, EVERY, EVERY_LABEL, config, state, candidates, pictures, pictureFolders, shown, next, status, init, defaultFolder, folderLabel };
