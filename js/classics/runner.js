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

   A game can only write under its own id, within the limits below: the
   frame's messages are checked here rather than trusted. Removing the
   iframe is what stops a game: its code, timers and audio all go with it.
   ============================================================ */
import { classicById } from './catalog.js';
import { FILES } from './files.js';
import { wasmDocument, pageDocument } from './frame.js';
import { idbName, stopped as profileStopped } from '../core/profiles.js';

const CACHE = 'staticos-classics';
const DB_NAME = idbName('staticos-classics');     /* null: this person keeps nothing (a guest) */
const STORE = 'saves';
const MAX_FILE = 16 * 1024 * 1024;
const MAX_GAME = 64 * 1024 * 1024;
const MAX_PATH = 200;

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

const fileUrl = path => {
  const f = FILES[path];
  if (!f) throw new Error(`Not a Free Classics file: ${path}`);
  return `${path}?v=${f.sha256.slice(0, 12)}`;
};

/** This game's paths from files.js, each once. */
export function filesOf(game) {
  const r = game.run;
  const paths = r.type === 'page' ? [r.page] : [r.glue, r.wasm, ...r.mount.map(m => m.file)];
  return [...new Set(paths)];
}
export const downloadBytes = game => filesOf(game).reduce((n, p) => n + (FILES[p]?.bytes || 0), 0);

/** What this device holds for a game, for its card. */
export async function deviceState(game) {
  /* asks first: looking at the shelf must not create an empty database and cache */
  let saves = 0;
  try {
    const known = !DB_NAME || !indexedDB.databases || (await indexedDB.databases()).some(d => d.name === DB_NAME);
    if (known) saves = (await listSaves(game.id)).length;
  } catch (err) { /* no database: nothing kept */ }
  let downloaded = false;
  try {
    if (self.caches && await caches.has(CACHE)) {
      const c = await caches.open(CACHE);
      downloaded = (await Promise.all(filesOf(game).map(p => c.match(fileUrl(p))))).every(Boolean);
    }
  } catch (err) { /* no cache: nothing kept */ }
  return { saves, downloaded };
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
  if (self.caches) {
    const c = await caches.open(CACHE);
    await Promise.all(filesOf(game).map(p => c.delete(fileUrl(p))));
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

/** The members of a zip file, from its central directory. */
async function unzip(bytes) {
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
    if (!name.endsWith('/')) {
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
 * Returns { stop(), setMuted(on), focus(), frame() }. stop() is final and safe to repeat.
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
    const paths = filesOf(game);
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
        const bytes = content.get(m.file);
        if (m.unzip) for (const z of await unzip(bytes)) files.push({ path: `${m.unzip}/${z.name}`, data: z.data.buffer });
        else files.push({ path: m.to, data: bytes.buffer });
      }
      if (stopped) return;
      const glue = new TextDecoder().decode(content.get(r.glue));
      const wasm = content.get(r.wasm).buffer;
      const saveFiles = saves.filter(s => s.data instanceof ArrayBuffer).map(s => ({ path: s.path, data: s.data }));
      bootMessage = {
        message: { t: 'boot', glue, wasm, files, saves: saveFiles, args: r.args, watch: r.watch, aspect: r.aspect || null },
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
    focus() { if (frame) { frame.focus(); toFrame({ t: 'focus' }); } },
    frame: () => frame,
  };
}
