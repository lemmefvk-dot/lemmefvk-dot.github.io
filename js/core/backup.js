/* ============================================================
   backup.js — Settings › Privacy › Back up your data.

   A backup holds ONE person's data (core/profiles.js): their
   localStorage keys, stored under the names the first profile uses,
   and their IndexedDB database. So a backup made by anyone can be
   restored by anyone, and restoring it touches nobody else.
   The first profile keeps what a backup always held: every key in
   this browser that is not another person's. A guest has nothing
   kept, so a guest cannot back up or restore.

   Old Games' saved games are in a database of their own
   (js/classics/runner.js), so a backup carries them in `classics`.
   A backup made before they existed has no `classics`, and restoring
   it leaves them alone.

   A backup holds whatever private keys the person has, Friends' among
   them (core/friends.js keeps it in their state). The sheet says so.

   Also here: an optional passphrase (the file is then AES-GCM encrypted
   with a key derived from it by PBKDF2; a lost passphrase can't be
   recovered by anyone), a preview of what a file holds with a choice of
   what to restore (everything, settings, files or notes), adding a file
   as a new profile, when the last backup was and whether files or notes
   have changed since, and a reminder after some days without one.
   The daily snapshots in core/snapshots.js stay out of backups.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import { holdFiles } from './vfs.js';
import * as profiles from './profiles.js';
import { h } from './dom.js';

/* the name inside a backup; this person's own database is DB_OPEN */
const DB_NAME = 'staticos';
const DB_OPEN = profiles.idbName() || DB_NAME;
const who = () => profiles.current()?.name || null;
const shared = () => !!who() && profiles.people().length > 1;
const DB_VERSION = 2;
const DB_STORES = ['projects', 'assets', 'clips', 'misc', 'media'];
/* the daily snapshots (core/snapshots.js) live in the 'misc' store under these names */
const isSnapshotKey = k => typeof k === 'string' && k.startsWith('snapshot:');
const CLASSICS_BASE = 'staticos-classics';
const CLASSICS_STORE = 'saves';
const TYPED_ARRAYS = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
};
if (typeof BigInt64Array !== 'undefined') {
  TYPED_ARRAYS.BigInt64Array = BigInt64Array;
  TYPED_ARRAYS.BigUint64Array = BigUint64Array;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function encode(value, stack = new WeakSet()) {
  if (value === undefined) return { $type: 'undefined' };
  if (typeof value === 'bigint') return { $type: 'BigInt', value: String(value) };
  if (value === null || typeof value !== 'object') return value;
  if (stack.has(value)) throw new Error('A saved item contains a circular reference and could not be backed up.');
  stack.add(value);
  try {
    if (value instanceof Blob) {
      const bytes = new Uint8Array(await value.arrayBuffer());
      const isFile = typeof File !== 'undefined' && value instanceof File;
      return {
        $type: isFile ? 'File' : 'Blob',
        name: isFile ? value.name : undefined,
        lastModified: isFile ? value.lastModified : undefined,
        mime: value.type,
        data: bytesToBase64(bytes),
      };
    }
    if (value instanceof ArrayBuffer) {
      return { $type: 'ArrayBuffer', data: bytesToBase64(new Uint8Array(value)) };
    }
    if (ArrayBuffer.isView(value)) {
      return {
        $type: value.constructor.name,
        data: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
      };
    }
    if (value instanceof Date) return { $type: 'Date', value: value.toISOString() };
    if (value instanceof Map) {
      const entries = [];
      for (const [key, item] of value) entries.push([await encode(key, stack), await encode(item, stack)]);
      return { $type: 'Map', entries };
    }
    if (value instanceof Set) {
      const values = [];
      for (const item of value) values.push(await encode(item, stack));
      return { $type: 'Set', values };
    }
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) items.push(await encode(item, stack));
      return items;
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = await encode(item, stack);
    return out;
  } finally {
    stack.delete(value);
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed.'));
  });
}

function validateBackup(data) {
  if (!data || data.format !== 'StaticOS data backup' || data.version !== 1) {
    throw new Error('This is not a supported StaticOS data backup.');
  }
  if (!data.localStorage || typeof data.localStorage !== 'object' || Array.isArray(data.localStorage)
      || Object.values(data.localStorage).some(value => typeof value !== 'string')) {
    throw new Error('The backup’s browser storage section is invalid.');
  }
  if (!data.indexedDB || data.indexedDB.name !== DB_NAME || !Array.isArray(data.indexedDB.stores)) {
    throw new Error('The backup’s saved database section is invalid.');
  }
  if (data.classics !== undefined && (!data.classics || data.classics.name !== CLASSICS_BASE || !Array.isArray(data.classics.saves)
      || data.classics.saves.some(row => !row || typeof row.game !== 'string' || typeof row.path !== 'string'))) {
    throw new Error('The backup’s Old Games saves are invalid.');
  }
  const seen = new Set();
  for (const store of data.indexedDB.stores) {
    if (!store || !DB_STORES.includes(store.name) || seen.has(store.name) || !Array.isArray(store.entries)) {
      throw new Error('The backup contains an unknown or invalid database store.');
    }
    seen.add(store.name);
    for (const entry of store.entries) {
      if (!entry || !Object.hasOwn(entry, 'key') || !Object.hasOwn(entry, 'value')) {
        throw new Error(`An entry in the “${store.name}” store is invalid.`);
      }
    }
  }
  return data;
}

function decodeBase64(data) {
  if (typeof data !== 'string') throw new Error('A binary item in the backup is invalid.');
  let binary;
  try { binary = atob(data); } catch (err) { throw new Error('A binary item in the backup is corrupted.'); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$type === 'string') {
    switch (value.$type) {
      case 'undefined': return undefined;
      case 'BigInt': return BigInt(value.value);
      case 'Date': {
        const date = new Date(value.value);
        if (!Number.isFinite(date.getTime())) throw new Error('The backup contains an invalid date.');
        return date;
      }
      case 'Blob': return new Blob([decodeBase64(value.data)], { type: value.mime || '' });
      case 'File': return new File([decodeBase64(value.data)], value.name || 'backup-file', {
        type: value.mime || '', lastModified: Number(value.lastModified) || 0,
      });
      case 'ArrayBuffer': return decodeBase64(value.data).buffer;
      case 'Map': {
        if (!Array.isArray(value.entries)) throw new Error('The backup contains an invalid map.');
        return new Map(value.entries.map(([key, item]) => [decode(key), decode(item)]));
      }
      case 'Set': {
        if (!Array.isArray(value.values)) throw new Error('The backup contains an invalid set.');
        return new Set(value.values.map(decode));
      }
      case 'DataView': {
        const bytes = decodeBase64(value.data);
        return new DataView(bytes.buffer);
      }
      default: {
        const ArrayType = TYPED_ARRAYS[value.$type];
        if (!ArrayType) break;
        const bytes = decodeBase64(value.data);
        if (bytes.byteLength % ArrayType.BYTES_PER_ELEMENT) {
          throw new Error('A typed array in the backup has an invalid size.');
        }
        return new ArrayType(bytes.buffer);
      }
    }
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error('The backup contains an unsafe object key.');
    }
    result[key] = decode(item);
  }
  return result;
}

async function readDatabase() {
  if (typeof indexedDB === 'undefined') throw new Error('This browser does not provide IndexedDB.');
  if (typeof indexedDB.databases === 'function') {
    const list = await indexedDB.databases();
    if (!list.some(db => db.name === DB_OPEN)) return { name: DB_NAME, stores: [] };
  }

  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_OPEN);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open saved browser data.'));
    request.onblocked = () => reject(new Error('Close other StaticOS tabs and try the backup again.'));
  });

  try {
    const stores = [];
    for (const name of db.objectStoreNames) {
      const tx = db.transaction(name, 'readonly');
      const store = tx.objectStore(name);
      const [keys, values] = await Promise.all([
        requestResult(store.getAllKeys()),
        requestResult(store.getAll()),
      ]);
      const entries = [];
      for (let i = 0; i < keys.length; i++) {
        if (name === 'misc' && isSnapshotKey(keys[i])) continue;      /* core/snapshots.js: not part of a backup */
        entries.push({ key: await encode(keys[i]), value: await encode(values[i]) });
      }
      stores.push({ name, entries });
    }
    return { name: DB_NAME, version: db.version, stores };
  } finally {
    db.close();
  }
}

function openDatabaseForRestore(name = DB_OPEN) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of DB_STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the saved data database.'));
    request.onblocked = () => reject(new Error('Close other StaticOS tabs before importing this backup.'));
  });
}

async function replaceDatabase(snapshot, dbName = DB_OPEN, only = null) {
  const db = await openDatabaseForRestore(dbName);
  try {
    const stores = [...db.objectStoreNames];
    const transaction = db.transaction(stores, 'readwrite');
    for (const name of stores) {
      if (only && !only.includes(name)) continue;
      const objectStore = transaction.objectStore(name);
      const replacement = snapshot.find(store => store.name === name);
      const put = () => { for (const entry of replacement?.entries || []) objectStore.put(decode(entry.value), decode(entry.key)); };
      if (name === 'misc') {
        /* the snapshots are this person's safety net and not in the backup: a restore leaves them be */
        objectStore.getAllKeys().onsuccess = e => {
          for (const k of e.target.result) if (!isSnapshotKey(k)) objectStore.delete(k);
          put();
        };
      } else {
        objectStore.clear();
        put();
      }
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not write the restored data.'));
      transaction.onabort = () => reject(transaction.error || new Error('Restoring the data was cancelled.'));
    });
  } finally {
    db.close();
  }
}

/* ---- Old Games' saved games ------------------------------------------- */
function openClassics(name = profiles.idbName(CLASSICS_BASE)) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(CLASSICS_STORE, { keyPath: ['game', 'path'] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the Old Games saves.'));
    request.onblocked = () => reject(new Error('Close other StaticOS tabs and try again.'));
  });
}

/** This person's Old Games saves for a backup, or null when they have none. */
async function readClassics() {
  if (typeof indexedDB.databases === 'function') {
    const list = await indexedDB.databases();
    if (!list.some(db => db.name === profiles.idbName(CLASSICS_BASE))) return null;
  }
  const db = await openClassics();
  try {
    const rows = await requestResult(db.transaction(CLASSICS_STORE).objectStore(CLASSICS_STORE).getAll());
    const saves = [];
    for (const row of rows) saves.push(await encode(row));
    return { name: CLASSICS_BASE, saves };
  } finally {
    db.close();
  }
}

async function replaceClassics(rows, name = profiles.idbName(CLASSICS_BASE)) {
  const db = await openClassics(name);
  try {
    const transaction = db.transaction(CLASSICS_STORE, 'readwrite');
    const saves = transaction.objectStore(CLASSICS_STORE);
    saves.clear();
    for (const row of rows) saves.put(decode(row));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not write the restored Old Games saves.'));
      transaction.onabort = () => reject(transaction.error || new Error('Restoring the Old Games saves was cancelled.'));
    });
  } finally {
    db.close();
  }
}

/* ---- the Friends private key ------------------------------------------ */
const hasFriendsKey = () => !!store.get('portal.friends', null)?.me?.priv;
function backupHasFriendsKey(backup) {
  try { return !!JSON.parse(backup.localStorage[profiles.BASES[0]] || 'null')?.portal?.friends?.me?.priv; } catch (err) { return false; }
}

/* ---- a passphrase on the file ------------------------------------------
   AES-256-GCM, with the key made from the passphrase by PBKDF2 (SHA-256,
   310,000 rounds, a random salt). Nothing about the passphrase is kept: not
   in the file, not on this computer. So a lost passphrase can't be
   recovered by anyone, and the file can't be opened without it. */
export const ENCRYPTED = 'StaticOS data backup (encrypted)';
const KDF_ITER = 310000;
const KDF_MIN = 8;
const te = new TextEncoder();
const td = new TextDecoder();
export const isSealed = d => !!d && d.format === ENCRYPTED;
const aad = () => te.encode(`${ENCRYPTED}|1`);
async function passphraseKey(pass, salt, iter) {
  if (!globalThis.crypto?.subtle) throw new Error('This browser can only protect a backup on a secure (https) page.');
  const raw = await crypto.subtle.importKey('raw', te.encode(String(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealBackup(backup, passphrase) {
  if (String(passphrase || '').length < KDF_MIN) throw new Error(`Use at least ${KDF_MIN} characters for the passphrase.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passphraseKey(passphrase, salt, KDF_ITER);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad() }, key, te.encode(JSON.stringify(backup))));
  return {
    format: ENCRYPTED, version: 1, createdAt: backup.createdAt,
    kdf: 'PBKDF2-SHA256', iterations: KDF_ITER, cipher: 'AES-256-GCM',
    salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(cipher),
  };
}
export async function unsealBackup(file, passphrase) {
  if (!isSealed(file) || file.version !== 1 || file.kdf !== 'PBKDF2-SHA256' || file.cipher !== 'AES-256-GCM'
      || !Number.isInteger(file.iterations) || file.iterations < 1000 || file.iterations > 5e6) {
    throw new Error('This protected backup is in a format this StaticOS does not know.');
  }
  const key = await passphraseKey(passphrase, decodeBase64(file.salt), file.iterations);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(file.iv), additionalData: aad() }, key, decodeBase64(file.data));
  } catch (err) {
    throw new Error('That passphrase is not right, or the file was changed.');
  }
  return JSON.parse(td.decode(plain));
}

/* ---- what is inside a backup -------------------------------------------- */
const NOTE_ROOTS = ['notes', 'noteFolders'];
const parse = text => { try { return JSON.parse(text); } catch (err) { return null; } };
function countFiles(node) {
  if (!node || typeof node !== 'object') return 0;
  if (node.t === 'f') return 1;
  return Array.isArray(node.c) ? node.c.reduce((n, k) => n + countFiles(k), 0) : 0;
}
/** What a backup holds, counted from the file itself. */
export function summarize(backup) {
  const state = parse(backup.localStorage[profiles.BASES[0]]) || {};
  const stores = Object.fromEntries((backup.indexedDB?.stores || []).map(s => [s.name, s.entries.length]));
  return {
    createdAt: backup.createdAt || '',
    profile: backup.profile?.name || '',
    settings: state.prefs && typeof state.prefs === 'object' ? Object.keys(state.prefs).length : 0,
    notes: Array.isArray(state.notes) ? state.notes.length : 0,
    files: countFiles(parse(backup.localStorage[profiles.BASES[1]])),
    projects: stores.projects || 0,
    media: (stores.media || 0) + (stores.assets || 0) + (stores.clips || 0),
    classics: backup.classics?.saves?.length || 0,
    friends: backupHasFriendsKey(backup),
  };
}
const dateText = iso => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'an unknown date'; };
const many = (n, one, more = one + 's') => `${n} ${n === 1 ? one : more}`;

/* ---- the dialogs --------------------------------------------------------- */
const field = (label, attrs) => {
  const input = h('input.acct-field__in', { spellcheck: 'false', autocomplete: 'off', ...attrs });
  return { input, el: h('label.acct-field', h('span', { text: label }), input) };
};
function previewBody(sum, pick) {
  const line = (label, text) => h('div.bk-line', h('span', { text: label }), h('b', { text }));
  const parts = [
    ['all', 'Everything', 'Replaces all of it: settings, files, notes, projects and the rest.'],
    ['settings', 'Only settings', 'Keeps your current files and notes.'],
    ['files', 'Only files and projects', 'Keeps your current settings and notes. Includes pictures, clips and Old Games saves.'],
    ['notes', 'Only notes', 'Keeps your current settings and files.'],
  ];
  const have = { all: true, settings: sum.settings > 0, files: sum.files + sum.projects + sum.media + sum.classics > 0, notes: sum.notes > 0 };
  return h('div.bk-preview',
    h('div.bk-list', { 'aria-label': 'What is in this backup' },
      line('Made', dateText(sum.createdAt)),
      sum.profile ? line('For', sum.profile) : null,
      line('Settings', many(sum.settings, 'saved setting')),
      line('Files', many(sum.files, 'file')),
      line('Notes', many(sum.notes, 'note')),
      line('Projects', many(sum.projects, 'project')),
      line('Pictures, clips and media', many(sum.media, 'item')),
      sum.classics ? line('Old Games', many(sum.classics, 'save')) : null),
    h('div.bk-parts', { role: 'radiogroup', 'aria-label': 'What to restore' }, parts.map(([id, label, hint]) => {
      const input = h('input', { type: 'radio', name: 'bk-part', value: id, checked: id === 'all', disabled: !have[id], onchange: () => pick(id) });
      return h('label.bk-part' + (have[id] ? '' : '.is-off'), input,
        h('span', h('b', { text: label }), h('small', { text: have[id] ? hint : 'This backup has none.' })));
    })));
}

/** The file as a backup object, asking for the passphrase when it has one; null when cancelled or unreadable. */
async function readFile(file, api) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (err) {
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Backup could not be read', message: 'Choose a valid StaticOS backup JSON file.' });
    return null;
  }
  try {
    if (isSealed(data)) {
      const pass = field('Passphrase', { type: 'password', name: 'passphrase', 'aria-label': 'Backup passphrase' });
      let opened = null;
      const ok = await api.confirm({
        title: 'This backup is protected',
        message: 'Type the passphrase you chose when you made it. A lost passphrase can’t be recovered by anyone, StaticOS included.',
        body: pass.el, ok: 'Open backup',
        validate: async () => {
          try { opened = await unsealBackup(data, pass.input.value); return ''; } catch (err) { return err.message; }
        },
      });
      if (!ok || !opened) return null;
      data = opened;
    }
    return validateBackup(data);
  } catch (err) {
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Backup could not be read', message: err.message || 'Choose a valid StaticOS backup JSON file.' });
    return null;
  }
}

/* ---- when you last backed up, and what changed since ---------------------
   Only files and notes are compared: settings and screen time change
   all the time and would make "changed" always true. */
const LAST = 'session.lastBackup';
const fnv = text => {
  let x = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x.toString(16);
};
const vfsKey = () => profiles.key(profiles.BASES[1]);
/** A short fingerprint of this person's files and notes right now. */
export function fingerprint() {
  let files = '';
  try { files = profiles.local.getItem(vfsKey()) || ''; } catch (err) { /* unreadable */ }
  return fnv(files + '\u0000' + JSON.stringify([store.get('notes', null), store.get('noteFolders', null)]));
}
/** { at: ISO date, sig } of the last backup downloaded from here, or null. */
export const lastBackup = () => { const v = store.get(LAST, null); return v && typeof v.at === 'string' ? v : null; };
/** 'never' (no backup yet), 'changed' (files or notes differ from it) or 'same'. */
export function changesSince() {
  const last = lastBackup();
  if (!last) return 'never';
  return last.sig === fingerprint() ? 'same' : 'changed';
}
export function agoText(iso, now = Date.now()) {
  const days = Math.floor((now - Date.parse(iso)) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

export async function createBackup() {
  if (!profiles.idbName()) throw new Error('A guest session keeps nothing, so there is nothing to back up.');
  const local = {};
  for (const [stored, name] of profiles.backupKeys()) {
    const value = localStorage.getItem(stored);
    if (value !== null) local[name] = value;
  }
  const indexed = await readDatabase();
  const classics = await readClassics();
  return {
    format: 'StaticOS data backup',
    version: 1,
    createdAt: new Date().toISOString(),
    origin: location.origin,
    ...(who() ? { profile: { name: who() } } : {}),
    localStorage: local,
    indexedDB: indexed,
    ...(classics ? { classics } : {}),
  };
}

/* what a restore of `part` writes, and what it clears first */
function planRestore(backup, part) {
  const keyFor = name => profiles.importKey(name);
  if (part === 'files') {
    const k = keyFor(profiles.BASES[1]);
    const v = backup.localStorage[profiles.BASES[1]];
    return { incoming: k && v !== undefined ? [[k, v]] : [], clear: k ? [k] : [], database: true, classics: !!backup.classics };
  }
  if (part === 'settings' || part === 'notes') {
    const k = keyFor(profiles.BASES[0]);
    const cur = parse(localStorage.getItem(k)) || {};
    const inc = parse(backup.localStorage[profiles.BASES[0]]) || {};
    const out = part === 'notes' ? { ...cur } : { ...inc };
    const from = part === 'notes' ? inc : cur;
    for (const root of NOTE_ROOTS) { if (root in from) out[root] = from[root]; else delete out[root]; }
    return { incoming: k ? [[k, JSON.stringify(out)]] : [], clear: [], database: false, classics: false };
  }
  const incoming = Object.entries(backup.localStorage).map(([name, value]) => [keyFor(name), value]).filter(([k]) => k);
  return { incoming, clear: profiles.keysOf(profiles.ID), database: true, classics: !!backup.classics };
}

export async function importBackup(file, api) {
  if (!profiles.idbName()) {
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Not in a guest session', message: 'A guest session keeps nothing, so a backup can’t be restored into it. Sign in to your own profile first.' });
    return false;
  }
  const backup = await readFile(file, api);
  if (!backup) return false;
  const sum = summarize(backup);
  const friendsNote = sum.friends
    ? ' This backup holds a Friends private key, so afterwards you are that person to their friends.'
    : hasFriendsKey() ? ' Your Friends private key isn’t in this backup, so the friends you have here would be lost.' : '';
  let part = 'all';
  const choice = await api.confirm({
    title: 'Replace saved StaticOS data?',
    message: (shared()
      ? `This replaces ${who()}’s saved data with the backup from ${backup.createdAt || 'an unknown date'}. ${who()}’s settings, files and projects will be removed and replaced; other people on this computer are not touched. This can’t be undone. Close other StaticOS tabs before continuing.`
      : `This replaces the data currently saved in this browser with the backup from ${backup.createdAt || 'an unknown date'}. Existing settings, files, projects, and keys will be removed and replaced. This can’t be undone. Close other StaticOS tabs before continuing.`) + friendsNote
      + ' Choose below what to replace.',
    body: previewBody(sum, id => { part = id; }),
    collect: () => part,
    ok: 'Replace and reload',
    danger: true,
  });
  if (!choice) return false;
  part = typeof choice === 'string' ? choice : 'all';

  /* Only this person's keys are cleared, and only theirs (plus, for the
     first profile, the shared keys the backup itself holds) are written —
     never anyone else's. What is there now is kept to put back on failure. */
  const plan = planRestore(backup, part);
  const incoming = plan.incoming;
  const touched = [...new Set([...plan.clear, ...incoming.map(([k]) => k)])];
  const previousLocal = {};
  for (const k of touched) { const v = localStorage.getItem(k); if (v !== null) previousLocal[k] = v; }
  const putBack = () => {
    for (const k of touched) localStorage.removeItem(k);
    for (const [key, value] of Object.entries(previousLocal)) localStorage.setItem(key, value);
  };
  let previousDatabase;
  let previousClassics = null;
  let classicsChanged = false;
  let databaseChanged = false;
  /* from here on this page must not write its own settings or files over the
     restored ones (a pending save, or one made while the page goes away) */
  const hold = on => { try { store.hold(on); holdFiles(on); } catch (err) { /* not loaded */ } };
  hold(true);
  try {
    if (plan.database) previousDatabase = await readDatabase();
    if (plan.classics) previousClassics = await readClassics();
    if (plan.database) { await replaceDatabase(backup.indexedDB.stores); databaseChanged = true; }
    if (plan.classics) { await replaceClassics(backup.classics.saves); classicsChanged = true; }
    try {
      for (const key of touched) localStorage.removeItem(key);
      for (const [key, value] of incoming) localStorage.setItem(key, value);
    } catch (err) {
      try {
        putBack();
      } catch (restoreError) {
        throw new Error(`${err.message || 'Local storage could not be written.'} Previous browser data could not be fully restored: ${restoreError.message || restoreError}`);
      }
      try {
        if (databaseChanged) await replaceDatabase(previousDatabase.stores);
        if (classicsChanged) await replaceClassics(previousClassics?.saves || []);
        databaseChanged = false;
      } catch (restoreError) {
        throw new Error(`${err.message || 'Local storage could not be written.'} Previous database data could not be restored: ${restoreError.message || restoreError}`);
      }
      throw err;
    }
  } catch (err) {
    hold(false);
    console.error('[StaticOS] data restore failed:', err);
    api.notify({
      app: 'StaticOS', icon: 'alert',
      title: databaseChanged ? 'Data restore was incomplete' : 'Could not restore data',
      message: err.message || 'The browser could not replace its saved data.',
    });
    return false;
  }
  api.notify({ app: 'StaticOS', icon: 'check', title: 'Data restored', message: 'Reloading StaticOS with the imported data.' });
  /* hold() above stopped the store and the files; this stops everything else
     saved per person (screen time, focus) before the page reloads */
  profiles.freeze();
  setTimeout(() => location.reload(), 700);
  return true;
}

/** Add a backup file as a new profile on this computer: its settings, files, notes and
    projects, under a name of its own. Nobody else's data is touched. A PIN is not in a
    backup, so the new profile has none; set one in Users. */
export async function importAsProfile(file, api) {
  if (!profiles.idbName()) {
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Not in a guest session', message: 'Sign in to your own profile to add one.' });
    return null;
  }
  if (profiles.people().length >= profiles.MAX) {
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'No room for another profile', message: `There is room for ${profiles.MAX} people on this computer.` });
    return null;
  }
  const backup = await readFile(file, api);
  if (!backup) return null;
  const sum = summarize(backup);
  const name = sum.profile || `Imported ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const ok = await api.confirm({
    title: 'Add this as a new profile?',
    message: `This adds “${name}” to this computer from the backup made ${dateText(sum.createdAt)}: ${many(sum.files, 'file')}, ${many(sum.notes, 'note')} and ${many(sum.projects, 'project')}. Nothing of anyone who is here now is changed. The profile starts without a PIN.`
      + (sum.friends ? ' The backup holds a Friends private key, so this profile will be that person to their friends.' : ''),
    ok: 'Add profile',
  });
  if (!ok) return null;
  let made = null;
  try {
    const solo = !profiles.people().length;
    made = await profiles.createFrom({
      name, files: backup.localStorage,
      first: solo ? { name: String(store.get('session.user')?.name || 'Me'), pic: null } : undefined,
    });
    await replaceDatabase(backup.indexedDB.stores, profiles.idbNameOf(made.id));
    if (backup.classics) await replaceClassics(backup.classics.saves, profiles.idbNameOf(made.id, CLASSICS_BASE));
  } catch (err) {
    if (made) { try { await profiles.remove(made.id); } catch (x) { /* the half-made profile is left for Users to delete */ } }
    console.error('[StaticOS] adding a profile from a backup failed:', err);
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Could not add the profile', message: err.message || 'The browser could not write the data.' });
    return null;
  }
  api.notify({ app: 'StaticOS', icon: 'users', title: `${made.name} was added`, message: 'Switch to them from Users. They have no PIN yet.' });
  return made;
}

export async function chooseBackupFile(api, input, as = 'restore') {
  const file = input.files?.[0];
  if (!file) return false;
  try {
    return as === 'profile' ? !!(await importAsProfile(file, api)) : await importBackup(file, api);
  } finally {
    input.value = '';
  }
}

export async function downloadBackup(data, passphrase = '') {
  const body = passphrase ? await sealBackup(data, passphrase) : data;
  const blob = new Blob([JSON.stringify(body, null, passphrase ? 0 : 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `staticos-data-${new Date().toISOString().slice(0, 10)}${passphrase ? '-protected' : ''}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Download a backup. { protect: true } asks for a passphrase first and encrypts the file. */
export async function exportBackup(api, { protect = false } = {}) {
  if (!profiles.idbName()) {
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Nothing to back up', message: 'A guest session keeps nothing once it ends, so there is no data to download.' });
    return false;
  }
  const lead = (shared() ? `Only ${who()}’s data is included — other people on this computer have their own backups. ` : '')
    + 'This backup can contain your saved settings, files, projects, account details, and private device keys. Keep the downloaded JSON private. The backup stays on this device unless you choose to share it.'
    + (hasFriendsKey() ? ' It includes your Friends private key: anyone with this file can read what your friends send you and appear to them as you. Treat it like a password.' : '');
  let pass = '';
  if (protect) {
    const a = field('Passphrase', { type: 'password', name: 'passphrase', autocomplete: 'new-password', 'aria-label': 'Passphrase' });
    const b = field('The same again', { type: 'password', name: 'passphrase2', autocomplete: 'new-password', 'aria-label': 'Passphrase again' });
    const ok = await api.confirm({
      title: shared() ? `Download ${who()}’s protected backup?` : 'Download a protected backup?',
      message: lead + ` The file is encrypted with your passphrase (AES-256-GCM). If you lose the passphrase, nobody can open the backup — not you, not StaticOS — and it can’t be recovered. It is not stored anywhere. Use at least ${KDF_MIN} characters.`,
      body: h('div', a.el, b.el),
      ok: 'Download backup',
      validate: () => (a.input.value.length < KDF_MIN ? `Use at least ${KDF_MIN} characters for the passphrase.` : a.input.value !== b.input.value ? 'The two passphrases don’t match.' : ''),
      collect: () => a.input.value,
    });
    if (!ok) return false;
    pass = String(ok);
  } else {
    const ok = await api.confirm({
      title: shared() ? `Download ${who()}’s StaticOS data?` : 'Download your StaticOS data?',
      message: lead,
      ok: 'Download backup',
    });
    if (!ok) return false;
  }
  const before = store.get(LAST, null);
  try {
    const at = new Date().toISOString();
    const stamp = { at, sig: fingerprint() };
    const data = await createBackup();
    /* the copy carries its own date, so restoring it brings "last backup" back as it was */
    const state = parse(data.localStorage[profiles.BASES[0]]);
    if (state) { state.session = { ...(state.session || {}), lastBackup: stamp }; data.localStorage[profiles.BASES[0]] = JSON.stringify(state); }
    await downloadBackup(data, pass);
    store.set(LAST, stamp);
    bus.emit('backup:done');                            /* Backed Up (core/achievements.js) */
    api.notify({ app: 'StaticOS', icon: 'download', title: pass ? 'Protected backup downloaded' : 'Data backup downloaded', message: pass ? 'Keep the file and the passphrase safe. Without the passphrase it can’t be opened.' : 'Your saved browser data was exported to a JSON file. Keep it somewhere private.' });
    return true;
  } catch (err) {
    store.set(LAST, before);
    console.error('[StaticOS] data backup failed:', err);
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Could not download data', message: err.message || 'The browser could not read the saved data.' });
    return false;
  }
}

/** Before signing out or ending a guest session: say so when work would not be backed up.
    Resolves true to carry on. Nothing is ever erased by signing out of a profile; a guest session is. */
export async function confirmLeaving(api) {
  if (profiles.MODE === 'guest') {
    if (!profiles.guestHasData()) return true;
    return !!(await api.confirm({
      title: 'End the guest session?',
      message: 'Nothing here is saved. The files and settings from this session are erased when it ends, and can’t be brought back. To keep them, cancel and use “Make a profile from this session”.',
      ok: 'End session', danger: true,
    }));
  }
  const state = changesSince();
  const hasFiles = state === 'never' && profiles.local.getItem(vfsKey()) !== null;
  if (state === 'same' || (state === 'never' && !hasFiles)) return true;
  const last = lastBackup();
  const why = state === 'never' ? 'You haven’t made a backup of your files and notes yet.' : `Your files or notes changed since your last backup (${agoText(last.at)}).`;
  const again = h('button.btn.btn--sm', { type: 'button', dataset: { act: 'backup-first' }, onclick: () => exportBackup(api) }, 'Download a backup first');
  return !!(await api.confirm({
    title: 'You have changes that aren’t backed up',
    message: `${why} Signing out keeps everything on this computer, but a backup is the copy you can keep safe or move.`,
    body: h('div.bk-leave', again),
    ok: 'Sign out anyway',
  }));
}

/* ---- the reminder -------------------------------------------------------- */
const DAY = 86400000;
export const REMIND_CHOICES = [0, 7, 14, 30];
/** Choose how many days without a backup before StaticOS says so (0 = never). */
export function setReminder(days) {
  const n = REMIND_CHOICES.includes(Number(days)) ? Number(days) : 0;
  store.set('prefs.backupRemindDays', n);
  /* counting starts now when there has never been a backup */
  if (n && !lastBackup() && !store.get('session.backupRemindFrom')) store.set('session.backupRemindFrom', new Date().toISOString());
}
/** Is a reminder due? Never in a guest session, never twice in a day. */
export function reminderDue(now = Date.now()) {
  const n = Number(store.get('prefs.backupRemindDays', 0)) || 0;
  if (!n || !profiles.idbName()) return false;
  const base = Date.parse(lastBackup()?.at || store.get('session.backupRemindFrom') || '');
  if (!Number.isFinite(base)) return false;
  const told = Date.parse(store.get('session.backupRemindedAt') || '');
  return now - base >= n * DAY && !(Number.isFinite(told) && now - told < DAY);
}
let remindTimer = 0;
/** Check now and every hour. Do Not Disturb holds the reminder back until it is off. */
export function startReminder(api) {
  const check = () => {
    if (!reminderDue() || store.get('prefs.dnd')) return false;
    store.set('session.backupRemindedAt', new Date().toISOString());
    const last = lastBackup();
    api.notify({
      app: 'StaticOS', icon: 'download', timeout: 0,
      title: 'Time for a backup?',
      message: last ? `Your last backup was ${agoText(last.at)}.` : 'You haven’t made a backup yet.',
      actions: [{ label: 'Back up now', onClick: () => exportBackup(api) }, { label: 'Later', onClick: () => {} }],
    });
    return true;
  };
  clearInterval(remindTimer);
  remindTimer = setInterval(check, 3600000);
  setTimeout(check, 4000);
  return check;
}

export default { createBackup, downloadBackup, exportBackup, importBackup, importAsProfile, chooseBackupFile, summarize, sealBackup, unsealBackup, lastBackup, changesSince, confirmLeaving, setReminder, reminderDue, startReminder };
