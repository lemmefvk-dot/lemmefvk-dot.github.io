/* ============================================================
   classics/runner.js — downloads a Free Classics game and runs it in
   a sandboxed frame (see frame.js for why it is sandboxed).

   Where things live, all on this device:
     Cache Storage 'staticos-classics'   the downloaded game files, so the
                                         second play needs no network. Not
                                         sw.js's offline copy: nothing here
                                         is fetched until someone presses Play.
                                         Shared by everyone in this browser,
                                         guests too: they are nobody's own.
     IndexedDB 'staticos-classics'       saved games, store 'saves', one row
                                         per file, { game, path, data }.
                                         A database of its own, so it never
                                         mixes with StaticOS's ('staticos'),
                                         and per person: core/profiles.js
                                         names it. A guest's saves stay in
                                         this page's memory and go with it.
     IndexedDB 'staticos-classics-own'   "play your own old copy": the game
                                         files a person chose to keep, store
                                         'files', { game, path, data }, and
                                         one row at path '' saying what they
                                         are. Only when they tick "Keep";
                                         per person, and never for a guest.
                                         Not in backups: they are the
                                         person's own copy, and big.

   A game can only write under its own id, within the limits below: the
   frame's messages are checked here rather than trusted. Removing the
   iframe is what stops a game: its code, timers and audio all go with it.
   A player's own files go into the frame the same way the free games'
   files do, and nowhere else: nothing here uploads them.
   ============================================================ */
import { CLASSICS, classicById } from './catalog.js';
import { FILES } from './files.js';
import { wasmDocument, pageDocument } from './frame.js';
import { idbName, stopped as profileStopped } from '../core/profiles.js';

const CACHE = 'staticos-classics';
const DB_NAME = idbName('staticos-classics');     /* null: this person keeps nothing (a guest) */
const OWN_DB = idbName('staticos-classics-own');
const STORE = 'saves';
const OWN_STORE = 'files';
const MAX_FILE = 16 * 1024 * 1024;
const MAX_GAME = 64 * 1024 * 1024;
const MAX_PATH = 200;
/* a player's own game: what a browser tab can comfortably hold in memory */
export const MAX_OWN = 1024 * 1024 * 1024;
export const MAX_OWN_FILES = 4000;

/* ------------------------------ saved games ------------------------------ */
let dbOpen = null;
function db() {
  if (profileStopped()) return Promise.reject(new Error('This profile has stopped saving.'));
  if (!dbOpen) {
    dbOpen = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: ['game', 'path'] });
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); dbOpen = null; };
        resolve(req.result);
      };
      req.onerror = () => { dbOpen = null; reject(req.error); };
    });
  }
  return dbOpen;
}
const asPromise = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const gameRange = game => IDBKeyRange.bound([game, ''], [game, '￿']);

/* a guest's saves. A copy each time: a boot message transfers its buffers away */
const memory = new Map();
const memoryKey = (game, path) => `${game}\n${path}`;
const copyRow = r => ({ ...r, data: r.data instanceof ArrayBuffer ? r.data.slice(0) : r.data });

/** Does this person keep saves beyond this page? A guest doesn't. */
export const savesKept = () => !!DB_NAME;

export async function listSaves(game) {
  if (!DB_NAME) return [...memory.values()].filter(r => r.game === game).map(copyRow);
  const d = await db();
  return asPromise(d.transaction(STORE).objectStore(STORE).getAll(gameRange(game)));
}
async function putSave(game, path, data) {
  if (!DB_NAME) { memory.set(memoryKey(game, path), { game, path, data, at: Date.now() }); return; }
  const d = await db();
  await asPromise(d.transaction(STORE, 'readwrite').objectStore(STORE).put({ game, path, data, at: Date.now() }));
}
async function delSave(game, path) {
  if (!DB_NAME) { memory.delete(memoryKey(game, path)); return; }
  const d = await db();
  await asPromise(d.transaction(STORE, 'readwrite').objectStore(STORE).delete([game, path]));
}

/** Deletes a game's saved games and nothing else: the download stays. */
export async function resetSaves(game) {
  const id = typeof game === 'string' ? game : game.id;
  if (!DB_NAME) {
    for (const r of [...memory.values()]) if (r.game === id) memory.delete(memoryKey(r.game, r.path));
    return;
  }
  const d = await db();
  await asPromise(d.transaction(STORE, 'readwrite').objectStore(STORE).delete(gameRange(id)));
}

/* ------------------------- a player's own game files ------------------------- */
let ownOpen = null;
function ownDb() {
  if (!OWN_DB) return Promise.reject(new Error('A guest keeps nothing.'));
  if (profileStopped()) return Promise.reject(new Error('This profile has stopped saving.'));
  if (!ownOpen) {
    ownOpen = new Promise((resolve, reject) => {
      const req = indexedDB.open(OWN_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(OWN_STORE, { keyPath: ['game', 'path'] });
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); ownOpen = null; };
        resolve(req.result);
      };
      req.onerror = () => { ownOpen = null; reject(req.error); };
    });
  }
  return ownOpen;
}
const ownKnown = async () => {
  if (!OWN_DB) return false;
  try { return !indexedDB.databases || (await indexedDB.databases()).some(d => d.name === OWN_DB); } catch (err) { return false; }
};

/** Can this person keep their own game files here? A guest can't. */
export const ownKept = () => !!OWN_DB;

/** What this person keeps of their own game for `game`: { label, count, bytes, at } or null. */
export async function keptInfo(game) {
  if (!(await ownKnown())) return null;
  const d = await ownDb();
  const meta = await asPromise(d.transaction(OWN_STORE).objectStore(OWN_STORE).get([game.id, '']));
  return meta ? { label: meta.label, count: meta.count, bytes: meta.bytes, at: meta.at, names: meta.names || [] } : null;
}
/** The kept files themselves, [{ path, data }], for the frame. */
export async function keptFiles(game) {
  const d = await ownDb();
  const rows = await asPromise(d.transaction(OWN_STORE).objectStore(OWN_STORE).getAll(gameRange(game.id)));
  return rows.filter(r => r.path).map(r => ({ path: r.path, data: r.data }));
}
/** Keeps a player's own files for next time (each file is copied: a boot transfers its buffer away). */
export async function keepFiles(game, label, files, names = []) {
  const d = await ownDb();
  const tx = d.transaction(OWN_STORE, 'readwrite');
  const st = tx.objectStore(OWN_STORE);
  st.delete(gameRange(game.id));
  let bytes = 0;
  for (const f of files) { bytes += f.data.byteLength; st.put({ game: game.id, path: f.path, data: f.data.slice(0) }); }
  st.put({ game: game.id, path: '', label: String(label).slice(0, 120), count: files.length, bytes, at: Date.now(), names: names.slice(0, 4) });
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Not kept: the browser said no.')); });
}
/** Forgets the files kept for `game` (saved games stay). */
export async function forgetFiles(game) {
  if (!(await ownKnown())) return;
  const d = await ownDb();
  await asPromise(d.transaction(OWN_STORE, 'readwrite').objectStore(OWN_STORE).delete(gameRange(game.id)));
}

/** A path from a file picker, made safe for the game's folder: 'MONKEY/MONKEY.000' → 'MONKEY.000'. */
export function ownPath(rel, strip) {
  const parts = String(rel).split(/[\\/]+/).filter(p => p && p !== '.' && p !== '..');
  if (strip && parts.length > 1) parts.shift();
  const clean = parts.map(p => p.replace(/[\0-\x1f]/g, '').slice(0, 80)).filter(Boolean);
  return clean.length ? clean.join('/').slice(0, MAX_PATH - 20) : '';
}

const fileUrl = path => {
  const f = FILES[path];
  if (!f) throw new Error(`Not a Free Classics file: ${path}`);
  return `${path}?v=${f.sha256.slice(0, 12)}`;
};

/** This game's paths from files.js, each once. With `own`, the free game data the player's copy replaces is left out. */
export function filesOf(game, own = false) {
  const r = game.run;
  const paths = r.type === 'page' ? [r.page] : [r.glue, r.wasm, ...r.mount.filter(m => !(own && m.free)).map(m => m.file)];
  return [...new Set(paths)];
}
export const downloadBytes = (game, own = false) => filesOf(game, own).reduce((n, p) => n + (FILES[p]?.bytes || 0), 0);

/** What this device holds for a game, for its card. lastSaved: when a save was last written, or 0. */
export async function deviceState(game) {
  /* asks first: looking at the shelf must not create an empty database and cache */
  let saves = 0;
  let lastSaved = 0;
  try {
    const known = !DB_NAME || !indexedDB.databases || (await indexedDB.databases()).some(d => d.name === DB_NAME);
    if (known) {
      const rows = await listSaves(game.id);
      saves = rows.length;
      lastSaved = rows.reduce((t, r) => Math.max(t, Number.isFinite(r.at) ? r.at : 0), 0);
    }
  } catch (err) { /* no database: nothing kept */ }
  let downloaded = false;
  try {
    if (self.caches && await caches.has(CACHE)) {
      const c = await caches.open(CACHE);
      downloaded = (await Promise.all(filesOf(game, !!game.own?.only).map(p => c.match(fileUrl(p))))).every(Boolean);
    }
  } catch (err) { /* no cache: nothing kept */ }
  let kept = null;
  try { if (game.own) kept = await keptInfo(game); } catch (err) { kept = null; }
  return { saves, lastSaved, downloaded, kept };
}

/** Removes a game's saved games and its downloaded files from this device.
    A guest's own saves only: the files are everyone's, and they keep nothing else. */
export async function removeFromDevice(game) {
  if (!DB_NAME) {
    for (const r of [...memory.values()]) if (r.game === game.id) memory.delete(memoryKey(r.game, r.path));
    return;
  }
  const d = await db();
  await asPromise(d.transaction(STORE, 'readwrite').objectStore(STORE).delete(gameRange(game.id)));
  if (game.own) await forgetFiles(game);
  if (self.caches) {
    const c = await caches.open(CACHE);
    /* an engine another game on the shelf shares stays for it */
    const others = new Set(CLASSICS.filter(g => g.id !== game.id).flatMap(g => filesOf(g)));
    await Promise.all(filesOf(game).filter(p => !others.has(p)).map(p => c.delete(fileUrl(p))));
  }
}

/* ------------------------------ downloads ------------------------------ */
const isGzip = b => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

async function inflate(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* A host may or may not take the .gz off on the way here, so go by the bytes. */
const decoded = async bytes => (isGzip(bytes) ? inflate(bytes, 'gzip') : bytes);

async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** One file: from the cache if this device has it, or the network with progress as it arrives. */
async function getFile(path, signal, onBytes) {
  const f = FILES[path];
  const key = fileUrl(path);
  let cache = null;
  try { if (self.caches) cache = await caches.open(CACHE); } catch (err) { cache = null; }
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    onBytes(f.bytes);
    const out = await decoded(bytes);
    if (!crypto.subtle || await digest(out) === f.sha256) return out;
    await cache.delete(key).catch(() => {});       /* damaged: fetch it again */
    onBytes(-f.bytes);
  }
  const res = await fetch(key, { signal });
  if (!res.ok) throw new Error(`The server answered ${res.status} for ${path.split('/').pop()}.`);
  const parts = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onBytes(value.length);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  const out = await decoded(bytes);
  /* crypto.subtle needs a secure context: it is there on the site and on localhost */
  if (crypto.subtle && await digest(out) !== f.sha256) throw new Error(`${path.split('/').pop()} did not arrive intact.`);
  if (cache) cache.put(key, new Response(bytes)).catch(() => {});
  return out;
}

/** The members of a zip file, from its central directory, less any whose name a `skip` pattern matches. */
async function unzip(bytes, skip = []) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('A game file is not a zip.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = [];
  const text = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = text.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (!name.endsWith('/') && !skip.some(re => re.test(name))) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + size);
      if (method !== 0 && method !== 8) throw new Error('A game file uses an unknown zip method.');
      out.push({ name, data: method === 8 ? await inflate(raw, 'deflate-raw') : raw.slice() });
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const validPath = p => typeof p === 'string' && p.length > 0 && p.length <= MAX_PATH && !p.includes('..');
const sizeOf = d => (typeof d === 'string' ? d.length : d.byteLength);

/* A link clicked in a game opens beside StaticOS, never inside the frame. */
async function openLink(gameId, href) {
  if (typeof href !== 'string') return;
  if (/^https?:\/\//i.test(href)) { window.open(href, '_blank', 'noopener,noreferrer'); return; }
  /* "Take Picture" in Micropolis: its own PNG, shown as a PNG and nothing else */
  if (/^data:image\/png;base64,/.test(href)) {
    const bytes = Uint8Array.from(atob(href.slice(href.indexOf(',') + 1)), c => c.charCodeAt(0));
    window.open(URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), '_blank', 'noopener,noreferrer');
    return;
  }
  /* the game's own notice pages */
  if (/^[\w.-]+\.(html|txt)(#[\w-]*)?$/.test(href)) window.open(`classics/${gameId}/${href}`, '_blank', 'noopener,noreferrer');
}

/**
 * Downloads and starts a game inside `host`.
 *   hooks.onProgress({ done, total, phase })   phase 'download' | 'starting'
 *   hooks.onRunning()    hooks.onError(message)    hooks.onSaveProblem(message)
 *   hooks.onExit()       hooks.onNoGame(): the engine found no game it knows in the files
 *   hooks.own     { files: [{ path, data }], names }: the player's own copy, put under
 *                 game.own.to (the free game data it replaces is not downloaded)
 *   hooks.scale   'fit' | 'sharp' | 'stretch': how the canvas fills the frame
 * Returns { stop(), setMuted(on), setScale(mode), focus(), frame() }. stop() is final and safe to repeat.
 */
export function startClassic(id, host, hooks) {
  const game = classicById(id);
  if (!game) throw new Error(`No such classic: ${id}`);
  const ctl = new AbortController();
  let frame = null;
  let source = null;       /* the frame's window, kept after stop() so a save already sent still counts */
  let stopped = false;
  let running = false;
  let muted = !!hooks.muted;
  const sizes = new Map();

  const tell = (name, ...args) => { if (!stopped && hooks[name]) hooks[name](...args); };
  const toFrame = (m, transfer) => { if (frame && frame.contentWindow) frame.contentWindow.postMessage(m, '*', transfer || []); };

  let bootMessage = null;
  const onMessage = e => {
    if (!source || e.source !== source) return;
    const m = e.data;
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'ready':
        if (bootMessage) { const b = bootMessage; bootMessage = null; toFrame(b.message, b.transfer); }
        break;
      case 'running':
        if (!running) {
          running = true;
          tell('onRunning');
        }
        break;
      case 'error':
        tell('onError', String(m.message));
        break;
      case 'problem':
        if (!running) tell('onError', String(m.message));
        break;
      case 'save': {
        const fits = typeof m.data === 'string' || m.data instanceof ArrayBuffer;
        if (!validPath(m.path) || !fits || sizeOf(m.data) > MAX_FILE) return;
        const total = [...sizes.entries()].reduce((n, [p, s]) => n + (p === m.path ? 0 : s), 0) + sizeOf(m.data);
        if (total > MAX_GAME) { hooks.onSaveProblem?.('This game’s saves have reached their limit on this device.'); return; }
        sizes.set(m.path, sizeOf(m.data));
        /* after stop() too: see `source` */
        putSave(game.id, m.path, m.data).catch(err => hooks.onSaveProblem?.(`Could not keep your save: ${err?.message || err}`));
        break;
      }
      case 'del':
        if (!validPath(m.path)) return;
        sizes.delete(m.path);
        delSave(game.id, m.path).catch(() => {});
        break;
      case 'link':
        openLink(game.id, m.href).catch(() => {});
        break;
      case 'exit':
        tell('onExit');
        break;
      case 'nogame':
        tell('onNoGame');
        break;
      default:
    }
  };
  window.addEventListener('message', onMessage);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    ctl.abort();
    /* the message listener stays a moment, for a save already posted */
    setTimeout(() => window.removeEventListener('message', onMessage), 1500);
    if (frame) { frame.remove(); frame = null; }
  };

  (async () => {
    const own = hooks.own && game.own ? hooks.own : null;
    const paths = filesOf(game, !!own);
    const total = paths.reduce((n, p) => n + FILES[p].bytes, 0);
    let done = 0;
    const onBytes = n => { done = Math.max(0, done + n); tell('onProgress', { done: Math.min(done, total), total, phase: 'download' }); };
    tell('onProgress', { done: 0, total, phase: 'download' });
    const got = await Promise.all(paths.map(p => getFile(p, ctl.signal, onBytes)));
    if (stopped) return;
    tell('onProgress', { done: total, total, phase: 'starting' });
    const content = new Map(paths.map((p, i) => [p, got[i]]));

    let saves = [];
    try { saves = await listSaves(game.id); }
    catch (err) { hooks.onSaveProblem?.('This browser is not letting StaticOS keep saves, so yours will last only until you close the game.'); }
    if (stopped) return;
    for (const s of saves) sizes.set(s.path, sizeOf(s.data));

    const r = game.run;
    frame = document.createElement('iframe');
    frame.className = 'arc-clp__frame';
    frame.title = `${game.title}, running in a sandboxed frame`;
    frame.setAttribute('sandbox', r.sandbox);
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('referrerpolicy', 'no-referrer');

    if (r.type === 'page') {
      const saved = {};
      for (const s of saves) {
        if (s.path.startsWith('localStorage/') && typeof s.data === 'string') saved[s.path.slice(13)] = s.data;
      }
      const html = new TextDecoder().decode(content.get(r.page));
      frame.srcdoc = pageDocument(html, { type: 'page', muted, localStorage: !!r.localStorage, saved });
    } else {
      const files = [];
      for (const m of r.mount) {
        if (own && m.free) continue;
        const bytes = content.get(m.file);
        if (m.unzip) for (const z of await unzip(bytes, m.skip)) files.push({ path: `${m.unzip}/${z.name}`, data: z.data.buffer });
        else files.push({ path: m.to, data: bytes.buffer });
      }
      /* the player's own files, from their device: into the game's folder, as they were */
      if (own) for (const f of own.files) files.push({ path: `${game.own.to}/${f.path}`, data: f.data });
      if (stopped) return;
      const glue = new TextDecoder().decode(content.get(r.glue));
      const wasm = content.get(r.wasm).buffer;
      const saveFiles = saves.filter(s => s.data instanceof ArrayBuffer).map(s => ({ path: s.path, data: s.data }));
      const names = own?.names || [];
      const args = own && game.own.args ? game.own.args(names) : r.args;
      const cwd = own && game.own.cwd ? game.own.cwd(names) : r.cwd || null;
      bootMessage = {
        message: { t: 'boot', glue, wasm, files, saves: saveFiles, args, watch: r.watch, cwd, aspect: r.aspect || null, scale: hooks.scale || 'fit' },
        transfer: [wasm, ...files.map(f => f.data), ...saveFiles.map(f => f.data)],
      };
      frame.srcdoc = wasmDocument({ type: 'wasm', muted });
    }
    host.appendChild(frame);
    source = frame.contentWindow;
  })().catch(err => {
    if (err?.name === 'AbortError' || stopped) return;
    tell('onError', err?.message || String(err));
  });

  return {
    stop,
    setMuted(on) { muted = !!on; toFrame({ t: 'mute', on: muted }); },
    setScale(mode) { toFrame({ t: 'scale', mode }); },
    focus() { if (frame) { frame.focus(); toFrame({ t: 'focus' }); } },
    frame: () => frame,
  };
}
