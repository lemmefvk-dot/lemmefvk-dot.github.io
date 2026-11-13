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
   ============================================================ */
import { store } from './store.js';
import { holdFiles } from './vfs.js';
import * as profiles from './profiles.js';

/* the name inside a backup; this person's own database is DB_OPEN */
const DB_NAME = 'staticos';
const DB_OPEN = profiles.idbName() || DB_NAME;
const who = () => profiles.current()?.name || null;
const shared = () => !!who() && profiles.people().length > 1;
const DB_VERSION = 2;
const DB_STORES = ['projects', 'assets', 'clips', 'misc', 'media'];
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
        entries.push({ key: await encode(keys[i]), value: await encode(values[i]) });
      }
      stores.push({ name, entries });
    }
    return { name: DB_NAME, version: db.version, stores };
  } finally {
    db.close();
  }
}

function openDatabaseForRestore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_OPEN, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of DB_STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the saved data database.'));
    request.onblocked = () => reject(new Error('Close other StaticOS tabs before importing this backup.'));
  });
}

async function replaceDatabase(snapshot) {
  const db = await openDatabaseForRestore();
  try {
    const stores = [...db.objectStoreNames];
    const transaction = db.transaction(stores, 'readwrite');
    for (const name of stores) {
      const objectStore = transaction.objectStore(name);
      objectStore.clear();
      const replacement = snapshot.find(store => store.name === name);
      for (const entry of replacement?.entries || []) {
        objectStore.put(decode(entry.value), decode(entry.key));
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
function openClassics() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(profiles.idbName(CLASSICS_BASE), 1);
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

async function replaceClassics(rows) {
  const db = await openClassics();
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

export async function importBackup(file, api) {
  if (!profiles.idbName()) {
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Not in a guest session', message: 'A guest session keeps nothing, so a backup can’t be restored into it. Sign in to your own profile first.' });
    return false;
  }
  let backup;
  try {
    backup = validateBackup(JSON.parse(await file.text()));
  } catch (err) {
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Backup could not be read', message: err.message || 'Choose a valid StaticOS backup JSON file.' });
    return false;
  }
  const friendsNote = backupHasFriendsKey(backup)
    ? ' This backup holds a Friends private key, so afterwards you are that person to their friends.'
    : hasFriendsKey() ? ' Your Friends private key isn’t in this backup, so the friends you have here would be lost.' : '';
  const ok = await api.confirm({
    title: 'Replace saved StaticOS data?',
    message: (shared()
      ? `This replaces ${who()}’s saved data with the backup from ${backup.createdAt || 'an unknown date'}. ${who()}’s settings, files and projects will be removed and replaced; other people on this computer are not touched. This can’t be undone. Close other StaticOS tabs before continuing.`
      : `This replaces the data currently saved in this browser with the backup from ${backup.createdAt || 'an unknown date'}. Existing settings, files, projects, and keys will be removed and replaced. This can’t be undone. Close other StaticOS tabs before continuing.`) + friendsNote,
    ok: 'Replace and reload',
    danger: true,
  });
  if (!ok) return false;

  /* Only this person's keys are cleared, and only theirs (plus, for the
     first profile, the shared keys the backup itself holds) are written —
     never anyone else's. What is there now is kept to put back on failure. */
  const incoming = Object.entries(backup.localStorage)
    .map(([name, value]) => [profiles.importKey(name), value]).filter(([k]) => k);
  const touched = [...new Set([...profiles.keysOf(profiles.ID), ...incoming.map(([k]) => k)])];
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
    previousDatabase = await readDatabase();
    if (backup.classics) previousClassics = await readClassics();
    await replaceDatabase(backup.indexedDB.stores);
    databaseChanged = true;
    if (backup.classics) { await replaceClassics(backup.classics.saves); classicsChanged = true; }
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
        await replaceDatabase(previousDatabase.stores);
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

export async function chooseBackupFile(api, input) {
  const file = input.files?.[0];
  if (!file) return false;
  try {
    return await importBackup(file, api);
  } finally {
    input.value = '';
  }
}

export function downloadBackup(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `staticos-data-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportBackup(api) {
  if (!profiles.idbName()) {
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Nothing to back up', message: 'A guest session keeps nothing once it ends, so there is no data to download.' });
    return false;
  }
  const ok = await api.confirm({
    title: shared() ? `Download ${who()}’s StaticOS data?` : 'Download your StaticOS data?',
    message: (shared() ? `Only ${who()}’s data is included — other people on this computer have their own backups. ` : '') + 'This backup can contain your saved settings, files, projects, account details, and private device keys. Keep the downloaded JSON private. The backup stays on this device unless you choose to share it.'
      + (hasFriendsKey() ? ' It includes your Friends private key: anyone with this file can read what your friends send you and appear to them as you. Treat it like a password.' : ''),
    ok: 'Download backup',
  });
  if (!ok) return false;
  try {
    downloadBackup(await createBackup());
    api.notify({ app: 'StaticOS', icon: 'download', title: 'Data backup downloaded', message: 'Your saved browser data was exported to a JSON file. Keep it somewhere private.' });
    return true;
  } catch (err) {
    console.error('[StaticOS] data backup failed:', err);
    api.notify({ app: 'StaticOS', icon: 'alert', title: 'Could not download data', message: err.message || 'The browser could not read the saved data.' });
    return false;
  }
}

export default { createBackup, downloadBackup, exportBackup, importBackup, chooseBackupFile };
